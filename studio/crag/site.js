// 匯入岩場站：讀任何岩場站的 v2 出口（組合樹：岩場 → 區的組合 → 地圖、Topo 照片與圖層），變成一本 Guidebook。
//   節點（岩場、區、分區、路線）照原本的樹與 id 收進組合的 nodes；各區的岩壁地圖併成一張（步道、區域、地點一起），交通圖原樣另存；Topo 的照片畫面和圖層原樣收進 items。
//   岩場站自己的詞彙（站名:欄位）原樣留著；路線另外補順序。
//   署名：匯入的檔案保留原本的 attribution、license，並寫 derivedFrom（原本的網址與 id）；組合的 derivedFrom 是出口的入口。
import { newBook, newId, text, markOrigin, endAtAnchors, importSettings } from './model.js';

const T = (...a) => globalThis.AppKit.i18n.t(...a);   // 文字在呼叫時才查（Node 測試也載入這個檔）

/** 常用的岩場站出口 */
export const SITES = [{ get name() { return T('cgSiteLongdong'); }, url: 'https://longdong.web.app/climbio/longdong.json', thumb: 'https://longdong.web.app/og/home.png' }];

/** 只收 https（本機測試的同一個網站也收）；不合格就丟錯 */
export function checkUrl(url, self) {
  let u;
  try { u = new URL(url); } catch { throw new Error(T('cgBadUrl', url)); }
  if (u.protocol !== 'https:' && u.origin !== self) throw new Error(T('cgHttpsOnly', url));
  return u.href;
}

/** 分享的連結 → 岩場的入口網址：App 網址 ?topo=<網址> 取出那個網址；其他原樣 */
export function entryOf(url) {
  let u;
  try { u = new URL(url); } catch { return url; }
  return u.searchParams.get('topo') || u.href;
}

/** 兩個來源是不是同一個岩場：Climbio 發佈的看 /p/<id>/（開發版、正式版、climbio.app 都一樣），其他看網址 */
export function sameSource(a, b) {
  const key = (u) => /\/p\/([0-9a-z]{16})\//.exec(u)?.[1] ?? u;
  return key(a) === key(b);
}

/** 從入口順著 items 讀下去（同一層一起讀）：getJson(網址) → 檔案；onDoc(檔案, 網址) 每讀到一份新的就叫一次；回傳 { root, docs（id → 檔案，照讀到的順序）, urls（id → 網址）, base } */
export async function crawl(url, getJson, { onProgress, onDoc, self } = {}) {
  const base = checkUrl(url, self);
  const docs = new Map(), urls = new Map(), seen = new Set([base]);
  let level = [base], root, pack = null;
  const dir = base.slice(0, base.lastIndexOf('/') + 1);
  // 入口的 props.pack 指到合併檔 pack.json（同一層所有 JSON）：讀一次，其餘檔案從裡面拿，不用一份一份請求（一本上百個請求太慢）
  const read = async (at) => {
    if (pack && at.startsWith(dir) && pack[at.slice(dir.length)]) return structuredClone(pack[at.slice(dir.length)]);
    const doc = await getJson(at);
    if (at === base && doc?.props?.pack?.href) {
      try { pack = (await getJson(checkUrl(new URL(doc.props.pack.href, at).href, self)))?.docs ?? null; } catch { pack = null; }   // 讀不到就一份一份讀
    }
    return doc;
  };
  while (level.length) {
    const got = await Promise.all(level.map(async (at) => [at, await read(at)]));
    const next = [];
    for (const [at, doc] of got) {
      if (doc?.climbio !== 2 || !doc.id) throw new Error(T('cgNotV2', at));
      root ||= doc;
      if (docs.has(doc.id)) continue;
      docs.set(doc.id, doc);
      urls.set(doc.id, at);
      onDoc?.(doc, at);
      for (const item of doc.items || []) {
        const href = checkUrl(new URL(item.href, at).href, self);
        if (/\.json$/.test(item.href) && !seen.has(href)) { seen.add(href); next.push(href); }
      }
    }
    onProgress?.(docs.size);
    level = next;
  }
  return { root, docs, urls, base };
}

const lineOf = (g) => (g.type === 'MultiLineString' && g.coordinates.length === 1 ? { type: 'LineString', coordinates: g.coordinates[0] } : g);
/** 收下的檔案：署名、授權照原本的，derivedFrom 指向原本那份 */
function keep(doc, url) {
  // derivedFrom.url 格式規定 https：不是 https 的來源不記，署名與授權照原本的
  const out = { attribution: doc.attribution || '', ...(/^https:/.test(url) ? { derivedFrom: { url, id: doc.id, ...(doc.t ? { t: doc.t } : {}) } } : {}) };
  if (doc.license) out.license = doc.license;
  return out;
}

/** 組合樹 → Guidebook 的狀態，加上要下載的照片、3D 模型檔 [{ id, url }]（images、models） */
/** 一般匯入是改編別人的：原本的署名拿不掉、只能加上自己的，來源記在 derivedFrom。 */
export function fromV2({ root, docs, urls, base }, t = Date.now()) {
  const state = newBook(text(root.name) || T('cgImportedBook'), t);
  const { book, map } = state;
  book.attribution = root.attribution || '';
  markOrigin(state);   // 原本的署名留著，改編的人只能加上自己的
  importSettings(state, root.props?.settings);   // 岩場的設定（路線編號、難度系統……）照發佈的資料；沒寫的用預設
  book.license = root.license || book.license;
  if (/^https:/.test(base)) book.derivedFrom = { url: base, id: root.id, ...(root.t ? { t: root.t } : {}) };
  if (root.source) book.source = structuredClone(root.source);   // 原始資料的連結跟著走（紅點貓岩場頁右上）
  const files = [...docs.values()];
  const urlOf = (doc) => urls.get(doc.id);
  const keepDoc = (doc, url) => keep(doc, url);
  // 改編的換新 id（同一台裝置匯入兩次各存一份）
  const mint = () => newId();

  // 節點：各組合的節點照讀到的順序收進來（同一個 id 只收一次）
  const seen = new Set();
  for (const doc of files.filter(d => d.kind === 'set')) {
    for (const n of doc.nodes || []) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      book.nodes.push(structuredClone(n));
    }
  }
  // 路線在上層裡的順序：沒有就照原本的順序
  const count = new Map();
  for (const r of book.nodes.filter(n => n.type === 'route')) {
    const p = (r.props ||= {});
    if (p.order === undefined) { const k = r.parent || ''; count.set(k, (count.get(k) || 0) + 1); p.order = count.get(k); }
  }

  // 岩壁地圖：各區的地圖畫面併成一張，署名跟第一張（只有一張時名稱、範圍等 props 也照原本的）；牆線當成手動畫的，之後加照片也不重算。
  // 交通圖（props.purpose: approach）不併：授權常不同（例如 OpenStreetMap 的 ODbL），原樣另存一份
  const all = files.filter(d => d.kind === 'view' && d.surface === 'map');
  const maps = all.filter(d => d.props?.purpose !== 'approach');
  if (maps.length) Object.assign(map, keepDoc(maps[0], urlOf(maps[0])));
  if (maps.length === 1) Object.assign(map, { ...(maps[0].name ? { name: structuredClone(maps[0].name) } : {}), props: { ...structuredClone(maps[0].props || {}) } });
  for (const v of all.filter(d => !maps.includes(d))) {
    const doc = { ...structuredClone(v), id: mint(v.id), ...keepDoc(v, urlOf(v)) };
    state.extras.set(doc.id, doc);
    book.items.push({ href: `${doc.id}.json`, id: doc.id });
  }
  for (const v of maps) {
    // 地圖自己的節點（地點、只在地圖上的區域）跟著地圖；組合裡已經有的不重複
    for (const n of v.nodes || []) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      (map.nodes ||= []).push(structuredClone(n));
    }
    for (const m of v.marks || []) {
      const mark = { ...structuredClone(m), geometry: lineOf(m.geometry) };
      if (mark.geometry.type === 'LineString') mark.props = { ...mark.props, 'author:manual': true };
      map.marks.push(mark);
    }
  }

  // 3D 模型（surface: model）和模型上的路線圖層：Studio Crag 不編輯，原樣帶著（換新的 id），發佈時連模型檔一起放進去
  const layers = files.filter(d => d.kind === 'layer');
  const models = [], modelId = new Map();
  for (const v of files.filter(d => d.kind === 'view' && d.surface === 'model')) {
    const view = { ...structuredClone(v), id: mint(v.id), ...keepDoc(v, urlOf(v)) };
    view.href = `${view.id}${(v.href.match(/\.[a-z0-9]+$/i) || [''])[0]}`;
    modelId.set(v.id, view.id);
    state.extras.set(view.id, view);
    book.items.push({ href: `${view.id}.json`, id: view.id });
    models.push({ id: view.id, url: new URL(v.href, urlOf(v)).href });
    for (const l of layers.filter(l => l.on === v.id)) {
      const layer = { ...structuredClone(l), id: mint(l.id), on: view.id, href: `${view.id}.json`, ...keepDoc(l, urlOf(l)) };
      state.extras.set(layer.id, layer);
      book.items.push({ href: `${layer.id}.json`, id: layer.id });
    }
  }

  // Topo：照片畫面和圖層原樣收進來（換新的檔案 id：同一台裝置匯入兩次各存一份）；
  // 照片拍的是哪面岩壁（props.node）由圖層上的路線所在的分區決定；從 3D 模型拍的快照（props.model）指到換過 id 的模型
  const parentOf = new Map(book.nodes.map(n => [n.id, n.parent]));
  const images = [];
  for (const v of files.filter(d => d.kind === 'view' && d.surface === 'photo')) {
    const view = { ...structuredClone(v), id: mint(v.id), ...keepDoc(v, urlOf(v)) };
    view.href = `${view.id}${(v.href.match(/\.[a-z0-9]+$/i) || [''])[0]}`;
    const votes = new Map();
    for (const l of layers.filter(l => l.on === v.id)) {
      for (const m of l.marks || []) {
        const wall = parentOf.get(m.node);
        if (wall) votes.set(wall, (votes.get(wall) || 0) + 1);
      }
    }
    const wall = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (wall) view.props = { ...view.props, node: wall };
    if (modelId.has(view.props?.model?.id)) view.props.model.id = modelId.get(view.props.model.id);
    state.photos.set(view.id, view);
    book.items.push({ href: `${view.id}.json`, id: view.id });
    images.push({ id: view.id, url: new URL(v.href, urlOf(v)).href });
    for (const l of layers.filter(l => l.on === v.id)) {
      const layer = { ...structuredClone(l), id: mint(l.id), on: view.id, href: `${view.id}.json`, ...keepDoc(l, urlOf(l)) };
      endAtAnchors(layer);   // 線尾在兩顆確保站之間橫走的，停在確保站中間
      state.layers.set(layer.id, layer);
      book.items.push({ href: `${layer.id}.json`, id: layer.id });
    }
  }
  return { state, images, models };
}
