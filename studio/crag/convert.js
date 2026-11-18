// 轉換路線書的讀檔：Word、PDF、網頁（.html，或 ZIP 裡的）、大綱（.md、.txt）、區域圖（.geojson）和照片 → 大綱文字與圖。
// 不碰畫面與狀態：Studio 的「轉換路線書」與命令列 tools/guidebook.mjs 都呼叫這裡，讀法只有一份（用到全域的 AppKit.files、AppKit.i18n）。
// English: reads guidebook files (docx, pdf, html, zip, md, geojson, images) into outline text and image assets; shared by Studio and tools/guidebook.mjs.
import { toOutline, blocksFromHtml, blocksFromDocx, readPdf } from './docread.js';
import { decodeText } from './table.js';

const T = (...a) => AppKit.i18n.t(...a);

export const BOOK_IMAGE = /\.(jpe?g|png|webp|gif|hei[cf])$/i;

/** 圖的查表鍵：解開 %xx、去掉開頭的 ./、小寫 */
export const assetKey = (p) => { try { p = decodeURIComponent(p); } catch { /* 照原樣 */ } return p.replace(/^\.?\//, '').toLowerCase(); };

/** 大綱裡的圖檔名 → 選進來的圖（先比完整路徑，再比檔名） */
export const findAsset = (assets, src) => assets.get(assetKey(src)) || assets.get(assetKey(src).split('/').pop());

/**
 * 選的檔案（File 或有 name 的 Blob）→ { text（大綱）, assets: Map<鍵, Blob>, notes（讀到什麼、丟掉什麼）, map（區域圖 GeoJSON，沒有是 null）}。
 * 第一份路線書（Word、PDF、網頁、大綱）當大綱；之後的路線書只收裡面的圖
 */
export async function readBookFiles(files) {
  const assets = new Map(), notes = [];
  let text = '', map = null;
  const put = (path, blob) => { const k = assetKey(path); assets.set(k, blob); const base = k.split('/').pop(); if (!assets.has(base)) assets.set(base, blob); };
  const fromBlocks = (blocks, from) => {
    const o = toOutline(blocks);
    notes.push(T('cgRead', from));
    if (o.dropped) notes.push(T('cgDropped', o.dropped));
    if (o.guessed.length) notes.push(T('cgGuessed', o.guessed));
    return o.text;
  };
  const readMap = async (blob, from) => {
    try { map = JSON.parse(await blob.text()); notes.push(T('cgReadMap', from)); } catch { notes.push(T('cgNotGeoJson', from)); }
  };
  for (const f of files) {
    if (BOOK_IMAGE.test(f.name)) { put(f.name, f); continue; }
    if (/\.geojson$/i.test(f.name)) { await readMap(f, f.name); continue; }
    if (/\.pdf$/i.test(f.name)) { if (!text) text = fromBlocks(await readPdf(f), f.name); continue; }
    if (/\.(docx|zip)$/i.test(f.name)) {
      const entries = await AppKit.files.unzip(f);
      const geo = entries.find(e => /\.geojson$/i.test(e.name));
      if (geo) await readMap(geo.blob, geo.name);
      const get = (p) => entries.find(e => e.name.toLowerCase() === p);
      const docx = get('word/document.xml'), html = entries.find(e => /\.html?$/i.test(e.name)), md = entries.find(e => /\.(md|txt)$/i.test(e.name));
      const base = (html || md)?.name.replace(/[^/]*$/, '') || '';
      for (const e of entries) if (BOOK_IMAGE.test(e.name)) put(docx ? e.name : e.name.slice(e.name.startsWith(base) ? base.length : 0), e.blob);
      if (text) continue;
      if (docx) text = fromBlocks(blocksFromDocx(await docx.blob.text(), (await get('word/_rels/document.xml.rels')?.blob.text()) || '<Relationships/>'), f.name);
      else if (html) text = fromBlocks(blocksFromHtml(await html.blob.text()), f.name);
      else if (md) { text = await md.blob.text(); notes.push(T('cgRead', f.name)); }
    } else if (!text && /\.html?$/i.test(f.name)) text = fromBlocks(blocksFromHtml(await f.text()), f.name);
    else if (!text && /\.(md|txt)$/i.test(f.name)) { text = decodeText(new Uint8Array(await f.arrayBuffer())); notes.push(T('cgRead', f.name)); }
  }
  return { text, assets, notes, map };
}
