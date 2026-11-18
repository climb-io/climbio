// Crag 的發佈：發佈的檔案（跟匯出 ZIP 一樣：index.json、各畫面與圖層的 JSON、照片），放進開放資料集、登記都用 ../publish.js（Wall、Crag 同一種）。不碰畫面，Node 也能跑。
//   每份 JSON 先過 validate；照片畫面的 camera（拍照位置與方向）照原樣公開，第一次發佈的同意畫面會列出有幾張；origin 不是 self／authorized 的畫面不能發佈。
// 發佈的狀態與設定存在組合的 props「author:publish」（匯出、發佈時拿掉）：{ consent, version, url, link, files, at, sig }；sig 是發佈時內容的指紋（contentSig），內容一樣就不能發下一版（舊的沒有 sig，照 at：發佈時存檔的 t）。
//   url：公開網址（/p/<id>/index.json，任何 App 讀）；link：分享用的網址（/p/<id>，打開就用紅點貓看）
import { exportDocs, text, walls, cragPosition } from './model.js';
import { SOURCES } from '../../mapkit/tiles.js';
const T = (...a) => AppKit.i18n.t(...a);   // 文字在呼叫時才查語言包（Node 測試、命令列也能用）

const KEY = 'author:publish';
export const PUBLIC_ORIGINS = ['self', 'authorized'];

/** 發佈的設定與狀態：consent（同意過了）、version、url、link（分享的網址）、files（上一版的檔案） */
export const publishState = (state) => ({ consent: false, ...(state.book.props?.[KEY] || {}) });
export function setPublishState(state, patch) {
  state.book.props = { ...state.book.props, [KEY]: { ...publishState(state), ...patch } };
}
export function clearPublished(state) {
  const { version, url, link, files, at, sig, ...keep } = publishState(state);
  state.book.props = { ...state.book.props, [KEY]: keep };
}

/** 會發佈的內容的指紋：組合、地圖、照片畫面、圖層，拿掉存檔時間 t 和發佈的紀錄（私人／公開 listed 照算）。存檔、同步不會讓它變，只有內容改了才會 */
export function contentSig(state) {
  const { [KEY]: _pub, ...props } = state.book.props || {};   // 發佈的紀錄不算內容
  const bare = (d) => ({ ...d, t: undefined });
  const byId = (m) => [...m.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(bare);
  const s = JSON.stringify([{ ...bare(state.book), props }, bare(state.map), ...byId(state.photos), ...byId(state.layers)]);
  let h = 0x811c9dc5;   // FNV-1a
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `${(h >>> 0).toString(36)}.${s.length.toString(36)}`;
}

/** 不能發佈的畫面（紙本、來源不明：origin 不是 self／authorized）：[{ id, name }] */
export function blocked(state) {
  return [state.map, ...state.extras.values(), ...state.photos.values()].filter(v => v.kind === 'view' && !PUBLIC_ORIGINS.includes(v.origin)).map(v => ({ id: v.id, name: text(v.name) || v.href || v.id }));
}

/** 同意畫面列出的內容 */
export function summary(state) {
  const photos = [...state.photos.values()];
  return {
    photos: photos.length,
    routes: state.book.nodes.filter(n => n.type === 'route').length,
    topos: state.layers.size,
    walls: walls(state).filter(w => state.map.marks.some(m => m.node === w.id)).length,
    cameras: photos.filter(v => v.camera).length,
  };
}

/** 發佈的 JSON：[{ path, doc }]，跟匯出一樣。validate 有錯就丟錯 */
export function publishDocs(state, { validate }) {
  const docs = exportDocs(state);
  const errors = docs.flatMap(({ path, doc }) => validate(doc).map(e => `${path} ${e}`));
  if (errors.length) throw Object.assign(new Error(T('cdBadFormat', errors[0])), { errors });
  return docs;
}

export const PACK = 'pack.json';

/** 天然岩場的 Guidebook 一定要有位置（世界地圖靠它放圖釘）：照片有拍攝位置，或岩場節點有 geo */
export const NO_POSITION = globalThis.AppKit?.i18n ? T('cdNoPosition') : '';   // 載入當下查文字（頁面的語言包先載入；沒有 AppKit 的 Node 程式用不到）
export const needsPosition = (state) => ![...state.photos.values()].some(v => v.camera?.position) && !cragPosition(state);

/**
 * 合併檔（紅點貓匯入不用一個檔案一次請求，見 redpoint/io.js 的 fromUrl）：docs 的第一份是入口，其餘 JSON 全放進 pack.json 的 docs（檔名 → 文件），
 * 不再逐檔發佈。回傳 { docs, images }：docs 只有入口（多了 props.pack）和 pack.json；images 原樣回傳。
 */
export async function withPack(docs, images) {
  const [entry, ...rest] = docs;
  const pack = { docs: Object.fromEntries(rest.map(({ path, doc }) => [path, doc])) };
  const index = { ...entry.doc, props: { ...entry.doc.props, pack: { href: PACK } } };
  return {
    docs: [{ path: entry.path, doc: index }, { path: PACK, doc: pack }],
    images,
  };
}

/**
 * 發佈一次：docs（publishDocs 的結果）、images（[{ path, blob }]，照片畫面的 href 與圖檔）、
 * dataset({ id, name, files, locations, onProgress, onFile })（放進開放資料集，見 ../dataset-publish.js），不用 drive。回傳 { version, url, files, manifest?, project? }
 */
export async function publish({ state, docs: plain, images: plainImages, dataset, onProgress, onFile }) {
  const enc = new TextEncoder();
  const { docs, images } = await withPack(plain, plainImages);
  const files = [
    ...docs.map(({ path, doc }) => ({ path, bytes: enc.encode(JSON.stringify(doc)) })),
    ...await Promise.all(images.map(async ({ path, blob }) => ({ path, bytes: new Uint8Array(await blob.arrayBuffer()) }))),
  ];
  // 岩場在地圖上的位置：照片的拍攝位置；都沒有拍攝位置（路線書轉的）就用岩場節點的 geo
  const shots = plain.filter(x => x.doc.surface === 'photo' && x.doc.camera?.position).map(x => x.doc.camera.position.slice(0, 2));
  const locations = shots.length ? shots : [cragPosition(state)].filter(Boolean);
  if (!locations.length) throw Object.assign(new Error(T('cdNoPosition')), { code: 'no-position' });
  const name = text(state.book.name) || 'Guidebook';
  return dataset({ id: state.book.id, name, files, locations, onProgress, onFile });
}

/**
 * 發佈時可以附上的底圖（岩場範圍的圖磚放進發佈的資料，紅點貓的岩場地圖用它）：看授權能不能散布。
 * 國土測繪中心的航照、等高線是政府資料開放授權條款（要署名）；OpenStreetMap 的圖磚使用規範不允許打包散布
 */
export const PACKABLE = {
  ortho: { get label() { return T('cdPackOrtho'); }, ok: true, license: '政府資料開放授權條款第 1 版', credit: SOURCES.ortho.credit },
  contours: { get label() { return T('cdPackContours'); }, ok: true, license: '政府資料開放授權條款第 1 版', credit: SOURCES.contours.credit },
  osm: { label: 'OpenStreetMap', ok: false, get why() { return T('cdPackOsmWhy'); } },
};
/** 一種底圖最多幾張圖磚：岩場太大就少放最清楚的那一層 */
const PACK_MAX = 160, PACK_PAD_M = 40;
const tileX = (lng, n) => Math.floor(((lng + 180) / 360) * n);
const tileY = (lat, n) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n); };

/** 岩場範圍（岩壁、岩石、區域、步道的形狀，往外加一點）在每一層的圖磚 [[z, x, y]…]；超過 PACK_MAX 就拿掉最清楚的層 */
export function packTileList(state, kind) {
  const pts = state.map.marks.flatMap(m => {
    const g = m.geometry;
    if (!g || g.type === 'Point') return [];
    return g.type === 'LineString' ? g.coordinates : g.type === 'Polygon' || g.type === 'MultiLineString' ? g.coordinates.flat() : g.type === 'MultiPolygon' ? g.coordinates.flat(2) : [];
  });
  if (!pts.length) return [];
  const lat = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const dx = PACK_PAD_M / (111320 * Math.cos((lat * Math.PI) / 180)), dy = PACK_PAD_M / 111320;
  const [w, s, e, n] = [Math.min(...pts.map(p => p[0])) - dx, Math.min(...pts.map(p => p[1])) - dy, Math.max(...pts.map(p => p[0])) + dx, Math.max(...pts.map(p => p[1])) + dy];
  const src = SOURCES[kind], levels = [];
  for (let z = src.minZ; z <= src.maxZ; z++) {
    const N = 2 ** z, list = [];
    for (let x = tileX(w, N); x <= tileX(e, N); x++) for (let y = tileY(n, N); y <= tileY(s, N); y++) list.push([z, x, y]);
    levels.push(list);
  }
  while (levels.length > 1 && levels.flat().length > PACK_MAX) levels.pop();
  return levels.flat();
}

/**
 * 下載要附上的底圖圖磚：回傳 { files: [{ path, blob }], tiles }（tiles 放進地圖畫面的 props.tiles，紅點貓照它畫）。
 * 圖磚的檔名同一層（發佈的檔案不能有子資料夾）：tile-<種類>-<z>-<x>-<y>.<jpg|png>；下載不到的那張略過
 */
export async function packTiles(state, kinds, { fetchFn = (...a) => fetch(...a), onProgress = () => {} } = {}) {
  const files = [], tiles = [];
  const jobs = kinds.filter(k => PACKABLE[k]?.ok).map(k => [k, packTileList(state, k)]);
  const total = jobs.reduce((a, [, l]) => a + l.length, 0);
  let done = 0;
  for (const [kind, list] of jobs) {
    const src = SOURCES[kind], have = [];
    let ext = '';
    const queue = [...list];
    await Promise.all(Array.from({ length: 4 }, async () => {
      for (let t = queue.shift(); t; t = queue.shift()) {
        const [z, x, y] = t;
        const res = await fetchFn(src.url.replace('{z}', z).replace('{x}', x).replace('{y}', y)).catch(() => null);
        const blob = res?.ok ? await res.blob() : null;
        onProgress(++done, total);
        if (!blob?.type.startsWith('image/')) continue;
        const e = blob.type === 'image/png' ? 'png' : 'jpg';
        ext ||= e;
        if (e !== ext) continue;
        files.push({ path: `tile-${kind}-${z}-${x}-${y}.${ext}`, blob });
        have.push(`${z}/${x}/${y}`);
      }
    }));
    if (!have.length) continue;
    const zs = have.map(k => Number(k.split('/')[0]));
    tiles.push({ kind, href: `tile-${kind}-{z}-{x}-{y}.${ext}`, minZ: Math.min(...zs), maxZ: Math.max(...zs), have: have.sort(), credit: PACKABLE[kind].credit, license: PACKABLE[kind].license });
  }
  return { files, tiles };
}
