// 任何網站的 Climbio 公開格式出口（v2）的轉接器：網站在頁面放 <link rel="climbio" href="入口.json">，按下圖示就找得到，
// 不用把網站加進擴充功能的清單，所以支援新網站不必更新工具。入口 → 各區的組合 → 照片畫面與路線圖層，
// 這裡讀現場的資料（有 Topo 的區才能收藏），照原樣存進使用者自己的 Drive：一個區一個資料夾，沒有 Topo 的不收。
// 授權與署名照資料檔裡寫的；畫面的 origin 照網站寫的（self、authorized 紅點貓才能再分享）。
import { sha24 } from './hash.js';
import { PREVIEW, previewProps } from './sourcekit/preview-sheet.js';

/** 轉出來的內容改了（欄位、挑選的規則）就加一，已經收藏的區下次存會重存 */
const CONVERTER = 3;   // 3：任何網站的出口，不再只有龍洞

const getJson = async (url) => {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`讀不到 ${url}（HTTP ${res.status}）`);
  return res.json();
};

/** 名稱：字串，或語言代碼 → 字串 */
export const nameOf = (name) => (typeof name === 'string' ? name : name?.['zh-Hant'] ?? name?.en ?? Object.values(name ?? {})[0] ?? '');

/**
 * 在頁面裡執行（chrome.scripting.executeScript 的 func，不能用外面的變數）：找 <link rel="climbio" href>，回傳絕對網址；沒有就是 null。
 * 只收 https：入口與它指到的檔案、照片都要公開讀得到（回 Access-Control-Allow-Origin: *）。
 */
export function discover() {
  const link = document.querySelector('link[rel~="climbio"][href]');
  if (!link) return null;
  try {
    const url = new URL(link.getAttribute('href'), location.href);
    return url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

/**
 * 讀出口現在有哪些區：[{ id, name, set, docs, views, topos }]。
 * docs：區的組合底下的檔案 { href, url, doc }；views：照片畫面；topos：有路線圖層（有畫線）的照片有幾張。
 */
export async function loadAreas({ get = getJson, root } = {}) {
  const top = await get(root), areas = [];
  const sets = [];
  for (const item of top.items ?? []) {
    const url = new URL(item.href, root).href, set = await get(url);
    if (set.kind === 'set') sets.push({ url, set });
  }
  // 入口底下沒有再分區、照片直接放在入口：入口自己就是一個區
  if (!sets.length && top.kind === 'set') sets.push({ url: root, set: top });
  for (const { url, set } of sets) {
    const docs = [];
    for (const i of set.items ?? []) {
      const u = new URL(i.href, url).href;
      docs.push({ href: i.href, url: u, doc: await get(u) });
    }
    const views = docs.filter((d) => d.doc.kind === 'view' && d.doc.surface === 'photo');
    areas.push({ id: set.id, name: nameOf(set.name), set, docs, views, topos: views.filter((v) => layersOf(docs, v).length).length });
  }
  return areas;
}

/** 疊在這張照片上、有畫線的圖層 */
const layersOf = (docs, view) => docs.filter((d) => d.doc.kind === 'layer' && d.doc.on === view.doc.id && d.doc.marks?.length);

/**
 * 一個區要存的東西：只留有 Topo 的照片和它的圖層（沒有路線圖的照片、地圖都不收）。
 * 回傳 { id, name, files: [{ path, json }], photos: [{ path, url }], sheet, version }；index.json 是區的組合（多一個 props.preview 指到合成預覽圖）。
 */
export async function prepare(area) {
  const keep = area.views.filter((v) => layersOf(area.docs, v).length);
  const docs = keep.flatMap((v) => [v, ...layersOf(area.docs, v)]);
  const tileOf = new Map(keep.map((v, i) => [v.href, i]));   // 照片在預覽圖上的第幾格
  const items = area.set.items.filter((i) => docs.some((d) => d.href === i.href)).map((i) => (tileOf.has(i.href) ? { ...i, props: { ...i.props, tile: tileOf.get(i.href) } } : i));
  const files = [
    { path: 'index.json', json: { ...area.set, items, ...(keep.length ? { props: { ...area.set.props, preview: previewProps(keep.length) } } : {}) } },
    ...docs.map((d) => ({ path: d.href, json: d.doc })),
  ];
  const photos = keep.map((v) => ({ path: v.doc.href, url: new URL(v.doc.href, v.url).href, mime: v.doc.mime }));
  const version = await sha24(`${CONVERTER}\n${JSON.stringify(files.map((f) => [f.path, f.json]))}`);
  return { id: area.set.id, name: area.name, files, photos, sheet: photos.length ? { path: PREVIEW, urls: photos.map((p) => p.url) } : null, version };
}
