// 岩場的匯出與匯入：手機裡的岩場（含個人收藏）打包成一個 ZIP，每個岩場一個資料夾，內容是公開格式 v2
// （index.json 是組合，其他檔案用相對路徑）；匯入讀同樣的 ZIP。
// 不看 origin 放行：個人收藏是使用者自己的備份，匯入後畫面的 origin 原樣保留（personal 還是沒有分享鈕）；沒有 origin 的照片（紙本、來源不明）不放進去。
// English: multi-crag ZIP export/import (one folder per crag, Climbio format v2 files).

const IMG_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'model/gltf-binary': 'glb', 'model/x-spz': 'spz' };   // 照片和 3D 模型（匯出檔的副檔名）
const COVER = /^cover\.(jpe?g|png|webp)$/i;
const COVER_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export const itemId = (item) => item.id ?? item.href.replace(/\.json$/, '').split('/').pop();

const folderName = (id) => String(id).replace(/[^\w.-]+/g, '_');

/**
 * 打包：sets 是要匯出的組合（岩場）；docs 是手機裡全部的檔案；photoOf(id) 讀手機裡的照片；
 * zip(檔案清單) 做出 ZIP。回傳 { blob, crags: 放進去的組合, empty: 一張能匯出的照片都沒有而略過的組合, left: 沒放進去的照片數（沒有 origin） }。
 */
export async function exportCrags(sets, { docs, photoOf, zip }) {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const layersOn = (viewId) => docs.filter((d) => d.kind === 'layer' && d.on === viewId);
  const json = (doc) => new Blob([JSON.stringify(doc)], { type: 'application/json' });
  const files = [], crags = [], empty = [], dirs = new Set();
  let left = 0;
  for (const set of sets) {
    const out = [], items = [];
    let photos = 0;
    for (const item of set.items) {
      const id = itemId(item), doc = byId.get(id);
      if (!doc) continue;
      if (doc.kind !== 'view') {
        out.push({ name: `${id}.json`, blob: json(doc) });
        items.push({ ...item, href: `${id}.json`, id });
        continue;
      }
      if (!doc.origin) {
        left++;
        continue;
      }
      const blob = doc.surface === 'photo' || doc.surface === 'model' ? await photoOf(id) : undefined;
      const name = blob ? `${id}.${IMG_EXT[blob.type] ?? IMG_EXT[doc.mime] ?? 'jpg'}` : undefined;
      if (name) {
        out.push({ name, blob });
        photos++;
      }
      const { features: _, ...props } = doc.props ?? {};   // 辨識用的特徵點檔不放進去
      const view = { ...doc, ...(name ? { href: name } : {}), props };
      if (!Object.keys(view.props).length) delete view.props;
      out.push({ name: `${id}.json`, blob: json(view) });
      items.push({ ...item, href: `${id}.json`, id });
      for (const l of layersOn(id)) out.push({ name: `${l.id}.json`, blob: json(l) });
    }
    if (!photos) {
      empty.push(set);
      continue;
    }
    const cover = await photoOf(set.id);
    if (cover) out.push({ name: `cover.${IMG_EXT[cover.type] ?? 'jpg'}`, blob: cover });
    out.push({ name: 'index.json', blob: json({ ...set, items }) });
    let dir = folderName(set.id);
    for (let n = 2; dirs.has(dir); n++) dir = `${folderName(set.id)}-${n}`;
    dirs.add(dir);
    files.push(...out.map((e) => ({ ...e, name: `${dir}/${e.name}` })));
    crags.push(set);
  }
  if (!crags.length) throw new Error(left || empty.length ? '紙本或來源不明的照片只留在這支手機，不能匯出' : '沒有可以匯出的岩場');
  return { blob: await zip(files), crags, empty, left };
}

/**
 * 找出 ZIP 裡的岩場：有 index.json 的資料夾（不管第幾層；根目錄有 index.json 也算，例如分享出去的 ZIP）。
 * entries：unzip 的結果 [{ name, blob }]。回傳 { crags: [{ dir, set, files: Map<資料夾內的檔名, Blob> }], bad: [說明] }；index.json 不合格或不是組合的略過並列在 bad。
 */
export async function readCrags(entries, check) {
  const real = entries.filter((e) => !e.name.endsWith('/') && !/(^|\/)(__MACOSX\/|\.DS_Store$)/.test(e.name));
  const crags = [], bad = [];
  for (const root of real.filter((e) => e.name.split('/').pop() === 'index.json')) {
    const dir = root.name.slice(0, root.name.length - 'index.json'.length);
    const where = dir || 'index.json';
    try {
      const set = check(JSON.parse(await root.blob.text()), where);
      if (set.kind !== 'set') throw new Error(`${where} 不是岩場（組合）`);
      const files = new Map(real.filter((e) => e.name.startsWith(dir) && !e.name.slice(dir.length).includes('/')).map((e) => [e.name.slice(dir.length), e.blob]));
      crags.push({ dir, set, files });
    } catch (e) {
      bad.push(e.message);
    }
  }
  return { crags, bad };
}

/**
 * 把一個岩場存進手機：先存照片，再存檔案、加進首頁，中途失敗不會有只有一半的岩場。
 * local：putDocs、putPhoto、addToHome；check：驗證。
 * 回傳 { docs: 存進去的檔案, skipped: [說明] }；一份檔案不合格只跳過它，照片不在檔案裡就留著原本的網址（沒有網址的之後補不回來，列在 skipped）。
 */
export async function importCrag({ set, files }, { local, check, crop }) {
  const docs = [{ ...set }], photos = new Map(), skipped = [];
  for (const [name, blob] of files) {
    if (name === 'index.json' || !/\.json$/i.test(name)) continue;
    try {
      docs.push(check(JSON.parse(await blob.text()), name));
    } catch (e) {
      skipped.push(e.message);
    }
  }
  for (const doc of docs.filter((d) => d.kind === 'view' && (d.surface === 'photo' || d.surface === 'model'))) {
    const blob = files.get(doc.href);
    if (blob) photos.set(doc.id, blob.type ? blob : new Blob([blob], { type: doc.mime }));
    else if (!/^https:/.test(doc.href)) skipped.push(`照片 ${doc.href} 不在檔案裡`);
  }
  // 入口照片：合成預覽圖的上半裁下來（裁不出來就算了，岩場頁改用第一張照片）；舊的收藏是單獨的 cover.*
  const sheet = crop && set.props?.preview && files.get(set.props.preview.href);
  if (sheet) { try { photos.set(set.id, await crop(sheet.type ? sheet : new Blob([sheet], { type: 'image/jpeg' }), set.props.preview)); } catch (e) { console.warn('入口照片', e); } }
  const cover = !photos.has(set.id) && [...files].find(([name]) => COVER.test(name));
  if (cover) photos.set(set.id, cover[1].type ? cover[1] : new Blob([cover[1]], { type: COVER_MIME[cover[0].split('.').pop().toLowerCase()] }));
  for (const [id, blob] of photos) await local.putPhoto(id, blob);
  await local.putDocs(docs);
  await local.addToHome(set);
  return { docs, skipped };
}
