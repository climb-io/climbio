import { collectionGroups, collectionRestorePlan, exportCollections } from '../appkit/collection-backup.mjs';
import { createBackupUI } from '../appkit/backup-ui.mjs';
import { database } from './db.js';
// 紅點貓：最簡單好用的 Guidebook 閱讀器。版面照岩點貓（docs/style.md），顏色是戶外白底深海藍（css/brand-tokens.css 的 outdoor），對話框、提示用 AppKit。
//   首頁：收到的岩場是卡片，點了照片飛進下一頁、長按出現動作；右下「＋」展開朋友互傳和「世界」（Climbio Studio 發佈的岩場與 OpenClimbing 全球 Topo 岩場）。
//   右上頭像：共用 AppKit 帳號選單、全來源岩壁／路線統計、加到主畫面、備份與復原；不放簽名設定。
//   收岩場像岩點貓收線的開箱：先問、入口照片從骨架到清楚、每面岩壁的小圖一張張到齊、揭曉。
// 資料全部是 Climbio 公開格式 v2，存在這支手機（db.js）；收送見 io.js。不登入也能完整使用。
// English: Redpoint — a minimal guidebook reader: browse crags from the world, open topos, track ticks; v2 documents stored in IndexedDB.
import '../topokit/element.js';
import { renderLines } from '../topokit/render.js';
import { CSS as TOPO_CSS } from '../topokit/style.js';
import { fitSize } from '../topokit/viewport.js';
import { pickGrade } from '../topokit/data.js';
import { readCrag3d, cragModelIds, mountCrag3d } from '../crag3dkit/index.js';
import { allDocs, deleteDocs, deletePhotos, getDoc, getMeta, getPhoto, putDocs, putPhoto, setMeta } from './db.js';
import { publishDataset } from '../studio/dataset-publish.js';
import { datasetOps } from '../studio/service.js';
import { importCrag, itemId, readCrags } from '../appkit/crags.mjs';
import { cropCover as cropTop } from '../sourcekit/preview-sheet.js';   // 預覽圖的上半（入口照片）裁成一張 JPEG
import { check, credit, fromUrl, send, sendLink, shareable, toFiles } from './io.js';
import { pullCollected } from './extension.js';
import { sourceLabel } from './source-credit.mjs';
import { fromOpenClimbing, fromOpenClimbingGroup, isOpenClimbing, idOf as ocIdOf, OC_DATA } from './openclimbing.js';
import { groupOpenClimbingCrags, cragDisplayName, UNNAMED_PLACES } from './openclimbing-group.mjs';
import { theCragUrl, theCragLinks } from './thecrag-links.mjs';
import { autoMergeCandidates } from './auto-merge.mjs';
import { layout, layers, mergeWorld, worldItemsFrom } from './world-stacks.mjs';
import { buildWorldFile, hydrateWorld } from './world-data.mjs';
import '../mapkit/element.js';

const $ = (id) => document.getElementById(id);
const LICENSE = 'CC-BY-SA-4.0';
const { ui: UI } = globalThis.AppKit;
// 對話框開著時多一層返回紀錄：返回鍵先關對話框，不會直接退頁（跟岩點貓同一套，appkit/backstack.js）
UI.configure({ backStack: globalThis.AppKit.backstack });
const T = (...args) => globalThis.AppKit.i18n.t(...args);
const langTag = () => (globalThis.AppKit.i18n.lang === 'zh' ? 'zh-TW' : globalThis.AppKit.i18n.lang);
globalThis.AppKit.i18n.apply();
globalThis.applyPageMeta();
const Backend = () => globalThis.Backend ?? { caps: {} };
const state = { home: '', urls: [], pack: '', topo: '', user: null };

// ── 小工具 ──
const nameOf = (doc) => (typeof doc?.name === 'string' ? doc.name : doc?.name?.['zh-Hant'] ?? Object.values(doc?.name ?? {})[0]) || T('unnamed');
const now = () => Date.now();
const reduceMotion = AppKit.ui.reducedMotion;
const toast = (text, ms) => UI.toast(text, { ms });
const ask = (o) => UI.ask(o);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids.filter((k) => k != null && k !== false));
  return n;
};
const icon = (id) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.innerHTML = `<use href="#i-${id}"/>`;
  return s;
};

// ── 頁面：一次一頁；開了就多一筆瀏覽紀錄，左上返回和返回手勢都是 history.back()，關最上面那頁 ──
// 換頁是岩點貓的 Zoom & Morph（js/wall.js 的 flyBetween）：卡片的照片變成新頁裡照片的位置，整個新頁跟著等比縮放、用 clip-path 裁成卡片的樣子再展開到全螢幕；
// 返回時反過來縮回那張卡片。只動 transform 和 clip-path（合成層），舊頁一直留在底下，沒有空白、不閃
const nav = [];
const scrolls = new Map();   // 頁面 id → 離開時的捲動位置：返回時回到原處（頁面一藏起來捲動位置就掉了）
const FAB_PAGES = ['home'];
// 電腦、平板橫放（寬度 ≥ 900px）的雙欄工作區：岩場頁固定在左欄，Topo、路線清單開在右欄（岩場頁留著、不換頁、不做 Zoom & Morph）
const wide = matchMedia('(min-width: 900px)');
const RIGHT_PANE = ['topo', 'ticks'];
const splitOpen = () => wide.matches && RIGHT_PANE.includes(nav.at(-1)?.id) && nav.some((n) => n.id === 'pack');
function syncSplit() {
  const on = splitOpen();
  document.body.classList.toggle('split', on);
  // 雙欄縮回單欄時只保留目前頁面；否則左側岩場會繼續留在 DOM 中並接收操作。
  if (on) $('pack').hidden = false;
  else if (nav.at(-1)?.id !== 'pack') $('pack').hidden = true;
}
wide.onchange = syncSplit;
const visiblePage = () => [...document.querySelectorAll('.page')].find((p) => !p.hidden);
function leave() {
  const cur = visiblePage();
  if (cur) scrolls.set(cur.id, cur.scrollTop);
}
function showPage(id) {
  for (const p of document.querySelectorAll('.page')) p.hidden = p.id !== id;
  $('fab').hidden = !FAB_PAGES.includes(id);
  $(id).scrollTop = scrolls.get(id) ?? 0;
}

const MORPH_MS = 380, MORPH_EASE = 'cubic-bezier(.2,.8,.2,1)';
/**
 * Zoom & Morph：src 是照片，from 是它在卡片上的位置、to 是它在新頁上的位置（DOMRect）；page 是新頁（返回時是要關掉的頁）。
 * 照片（hero）疊在最上面、停在 to 的位置，從 from 的大小和裁切變成 to；page 同一套縮放和裁切，從卡片展開到全螢幕。
 * reverse：倒著播（關頁，縮回卡片）。每一格分開算內容（to 那一塊等比放大、置中蓋滿 from）和看得到的範圍（畫面座標的長方形），都從起點直線走到終點。
 */
function morph(src, from, to, { page, reverse = false, r0 = 20 } = {}) {
  if (reduceMotion() || !src || !from?.width || !to?.width) return Promise.resolve();
  const hero = el('img', { className: 'hero-fly', src, alt: '' });
  Object.assign(hero.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px` });
  document.body.append(hero);
  const N = 16, mix = (a, b, p) => a + (b - a) * p;
  const fit = (r) => { const k = Math.max(r.width / to.width, r.height / to.height); return { k, x: r.left + r.width / 2 - k * to.width / 2, y: r.top + r.height / 2 - k * to.height / 2 }; };
  const c0 = fit(from), c1 = fit(to);
  // 照片超出螢幕的部分（例如橫幅被捲到一半）不算在終點的範圍裡
  const win1 = { left: Math.max(to.left, 0), top: Math.max(to.top, 0), right: Math.min(to.left + to.width, innerWidth), bottom: Math.min(to.top + to.height, innerHeight) };
  const frames = (ox, oy, w, h, end, rEnd) => Array.from({ length: N + 1 }, (_, i) => {
    const p = i / N, k = mix(c0.k, c1.k, p), x = mix(c0.x, c1.x, p), y = mix(c0.y, c1.y, p);   // to 的左上角落在畫面 (x, y)、放大 k 倍
    const L = mix(from.left, end.left, p), T = mix(from.top, end.top, p), R = mix(from.left + from.width, end.right, p), B = mix(from.top + from.height, end.bottom, p);
    const tx = x - k * (to.left - ox), ty = y - k * (to.top - oy);   // 元素自己的左上角（版面在 ox, oy）放大後落在畫面的位置
    const rad = [r0, r0, r0, r0].map((v, j) => mix(v, rEnd[j], p) / k + 'px').join(' ');
    return { offset: p, transformOrigin: '0 0', transform: `translate(${tx - ox}px, ${ty - oy}px) scale(${k})`, clipPath: `inset(${(T - ty) / k}px ${w - (R - tx) / k}px ${h - (B - ty) / k}px ${(L - tx) / k}px round ${rad})` };
  });
  const opt = { duration: MORPH_MS, easing: MORPH_EASE, fill: 'both', direction: reverse ? 'reverse' : 'normal' };
  const anims = [hero.animate(frames(to.left, to.top, to.width, to.height, win1, [r0, r0, r0, r0]), opt)];
  // 跟岩點貓一樣：真的頁面（照片、線都畫好了）從卡片長出來，卡片的照片只在一開始疊著、很快淡掉，
  // 結束時看到的就是頁面本身，不會在最後一刻換圖而閃一下；縮回卡片時倒過來，最後才淡入卡片的照片
  anims.push(reverse
    ? hero.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay: MORPH_MS - 220, easing: 'ease-in', fill: 'both' })
    : hero.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-out', fill: 'both' }));
  // 浮在照片上的工具（返回、分享、石頭名稱）不跟著縮放（圓鈕在縮放、裁切中會閃）：展開完才淡入、縮回前先藏起來
  const tools = page?.querySelector(':scope > .vw');
  if (tools) anims.push(tools.animate(reverse ? [{ opacity: 0 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 0, offset: 0.9 }, { opacity: 1 }], { duration: MORPH_MS, fill: 'both' }));
  if (page) {
    page.style.willChange = 'transform, clip-path';   // 全螢幕層先提升成合成層，縮放和裁切不用每格重繪整頁
    anims.push(page.animate(frames(0, 0, innerWidth, innerHeight, { left: 0, top: 0, right: innerWidth, bottom: innerHeight }, [0, 0, 0, 0]), opt));
  }
  return Promise.all(anims.map((a) => a.finished)).catch(() => {}).finally(() => {
    for (const a of anims) a.cancel();
    hero.remove();
    if (page) page.style.willChange = '';
  });
}

/** 卡片：照片所在的卡片（在哪個清單、id），返回時找得回來 */
const cardOf = (pic) => { const c = pic?.closest?.('.card'); return c ? { box: c.parentElement.id, id: c.dataset.id } : null; };
const cardPic = (c) => c && document.querySelector(`#${c.box} .card[data-id="${c.id}"] .pic`);

/**
 * 開頁。zoom：{ from（卡片上的照片元素）, src, rect()（新頁裡照片的位置，頁面顯示後才量）, prepare()（頁面顯示後、量位置前填內容，可以 async）}；
 * 沒有 from 就直接換頁。replace：換掉最上面那頁（不多一筆瀏覽紀錄，開箱完直接換成岩場頁）
 */
async function enter(id, onClose, { from, src, rect, prepare, card } = {}, { replace = false } = {}) {
  // 要換掉的頁：目前最上層那頁（電腦的雙欄裡岩場頁在左欄一直開著，看得到的第一頁不一定是它；Topo 開著時打開路線清單，要換掉的是 Topo）
  const page = $(id), prev = (nav.length && $(nav.at(-1).id)) || visiblePage();
  if (!replace) leave();
  scrolls.delete(id);   // 新開的頁從頂端開始
  if (prepare) page.style.visibility = 'hidden';   // 顯示出來才有大小，可以填內容；填好之前不讓人看到
  page.hidden = false;
  page.scrollTop = 0;
  $('fab').hidden = !FAB_PAGES.includes(id);
  await prepare?.();
  page.style.visibility = '';
  if (replace) nav.pop();
  const zoom = from && src && rect && !(wide.matches && RIGHT_PANE.includes(id) && nav.some((n) => n.id === 'pack')) ? { src, rect, card: card ?? cardOf(from) } : null;   // card：返回時縮回哪張卡片（開箱換過來的，照片不在卡片上，要直接指定）
  nav.push({ id, onClose, zoom });
  if (!replace) history.pushState({ rp: nav.length }, '');
  if (zoom && !reduceMotion()) {
    page.style.zIndex = 30;   // 新頁在最上面（DOM 順序不一定）
    await morph(zoom.src, from.getBoundingClientRect(), zoom.rect(), { page });
    page.style.zIndex = '';
  }
  // 展開的途中就按了返回（這一頁已經不在 nav）：底下的頁已經被顯示回來，不能再藏起來；被換掉的頁（replace）不在 nav，照樣要藏
  if (prev && prev !== page && (nav.some((n) => n.id === id) || !nav.some((n) => n.id === prev.id))) prev.hidden = true;
  syncSplit();
}
const back = () => history.back();
addEventListener('popstate', async () => {
  if (globalThis.AppKit.backstack.handle()) return;   // 關對話框那一層
  const top = nav.pop();
  if (!top) return;
  if (top.level) return top.onClose();   // 世界裡的一層（國家→地區→岩場）：只收回這一層，頁面不換
  state.closing = true;   // render() 不要自己換頁
  try {
    await top.onClose?.();
    const leaving = $(top.id), destId = nav.at(-1)?.id ?? 'home', dest = $(destId);
    dest.hidden = false;   // 底下的頁先顯示，要關的頁還在上面
    dest.scrollTop = scrolls.get(destId) ?? 0;
    $('fab').hidden = !FAB_PAGES.includes(destId);
    const z = top.zoom, pic = z && cardPic(z.card);
    if (pic && !reduceMotion() && !leaving.hidden) {
      pic.scrollIntoView?.({ block: 'nearest' });   // 卡片在畫面外就捲到看得到
      const from = pic.getBoundingClientRect(), to = z.rect();
      pic.style.visibility = 'hidden';   // 照片縮回去之前，卡片上的照片先藏著
      leaving.style.zIndex = 30;
      await morph(z.src, from, to, { page: leaving, reverse: true });
      pic.style.visibility = '';
      leaving.style.zIndex = '';
    }
    leaving.hidden = true;
    syncSplit();
  } finally {
    state.closing = false;
  }
});

// ── 資料 ──
function newSet(name, by) {
  return check({ climbio: 2, kind: 'set', type: 'group', id: AppKit.files.rid(), name, t: now(), license: LICENSE, attribution: by, author: by, items: [] });
}

/** 首頁的組合：收到的岩場、Topo 都放這裡（id 記在 meta.home） */
async function ensureHome() {
  state.home = await getMeta('home');
  if (state.home && (await getDoc(state.home))) return;
  const home = newSet('紅點貓', '我');
  await putDocs([home]);
  await setMeta('home', home.id);
  state.home = home.id;
}

async function addToHome(doc) {
  const g = await getDoc(state.home);
  if (!g.items.some((i) => itemId(i) === doc.id))
    await putDocs([check({ ...g, items: [...g.items, { href: `${doc.id}.json`, id: doc.id, ...(doc.name ? { name: doc.name } : {}), t: now() }], t: now() })]);
  // 收下／匯入時就產生朋友互傳的小圖，不在進入分享清單時處理照片。
  await saveNearbyThumb(doc).catch((e) => console.warn('朋友互傳縮圖', e));
}

/** 照片網址：存在手機的用 blob，沒下載到的用原本的 https 網址。同一張照片的網址留著用（key：p＝照片、c＝岩場入口照片、s＝拍的照片），
 *  換頁、重畫時圖片不會先空白再重載（那就是閃一下）；照片換掉或刪掉時 forgetUrl */
const urlCache = new Map();
async function photoUrl(view) {
  if (urlCache.has(`p:${view.id}`)) return urlCache.get(`p:${view.id}`);
  const blob = await getPhoto(view.id);
  return blob ? keyedUrl(`p:${view.id}`, blob) : /^https:/.test(view.href) ? view.href : '';   // 相對路徑讀不到：回傳空字串，不要出現破圖
}
/** 這張照片手機裡沒有、也沒有網址可以載：下載到一半、檔案遺失 */
const photoMissing = async (view) => !(await getPhoto(view.id)) && !/^https:/.test(view.href);
function keyedUrl(key, blob) {
  if (!urlCache.has(key)) urlCache.set(key, URL.createObjectURL(blob));
  return urlCache.get(key);
}
function forgetUrl(...ids) {
  for (const id of ids) for (const k of ['p', 'c', 's', 'n']) {
    const url = urlCache.get(`${k}:${id}`);
    if (url) URL.revokeObjectURL(url);
    urlCache.delete(`${k}:${id}`);
  }
}
/** 朋友互傳的 256×256 方形縮圖，直接從手機本機儲存讀取。 */
const nearbyThumbKey = (id) => `nearby-thumb:${id}`;
async function nearbyThumbUrl(id) {
  if (urlCache.has(`n:${id}`)) return urlCache.get(`n:${id}`);
  const packed = await getMeta(nearbyThumbKey(id));
  const thumb = packed && await AppKit.idb.unpackBlob(packed);
  return thumb ? keyedUrl(`n:${id}`, thumb) : '';
}
async function saveNearbyThumb(doc) {
  if (!doc) return;
  let blob = null;
  if (doc.kind === 'set') {
    blob = await getPhoto(doc.coverId ?? doc.id);
    if (!blob) {
      const docs = await allDocs();
      for (const view of viewsIn(docs, flatSet(docs, doc))) {
        if (view.surface !== 'photo') continue;
        blob = await getPhoto(view.id);
        if (blob) break;
      }
    }
  } else if (doc.kind === 'view' && doc.surface === 'photo') blob = await getPhoto(doc.id);
  // ZIP 匯入的合法 JPEG 可能沒有 MIME type，讓解碼器判斷，失敗就保留原照片備援。
  if (!blob) return;
  const square = await AppKit.photo.squareThumb(blob);
  await setMeta(nearbyThumbKey(doc.id), await AppKit.idb.packBlob(square));
  // 縮圖更新時，只釋放舊的朋友互傳 URL，不影響頁面上正在看的照片。
  const old = urlCache.get(`n:${doc.id}`);
  if (old) URL.revokeObjectURL(old);
  urlCache.delete(`n:${doc.id}`);
}
/** 舊收藏在首頁開啟後逐筆補圖，不讓朋友互傳畫面等待圖片解碼。 */
async function backfillNearbyThumbs() {
  const home = await getDoc(state.home), docs = await allDocs();
  const byId = new Map(docs.map((d) => [d.id, d]));
  for (const entry of home?.items ?? []) {
    const doc = byId.get(itemId(entry));
    if (!doc || await getMeta(nearbyThumbKey(doc.id))) continue;
    await saveNearbyThumb(doc).catch((e) => console.warn('補做朋友互傳縮圖', e));
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}
/** 沒有 key 的一次性網址（開箱中的預覽） */
function blobUrl(blob) {
  const url = URL.createObjectURL(blob);
  state.urls.push(url);
  return url;
}

const layersOn = (docs, viewId) => docs.filter((d) => d.kind === 'layer' && d.on === viewId);
/** 圖層標註是不是路線的：線段，或路線號碼（沒有線、只標了位置的 Point；指向這個圖層裡 bolt、確保站節點的 Point 不是） */
const isRouteMark = (layer, m) => !!m.node && (m.geometry?.type === 'LineString' || (m.geometry?.type === 'Point' && !(layer.nodes ?? []).some((n) => n.id === m.node && (n.type === 'bolt' || n.type === 'anchor'))));
/** 照片上有哪些路線（id）：有線段的、有路線號碼的、有 bolt 或確保站的（只標確保站的傳統攀也算）。路線節點在整本的 nodes 裡（Studio Crag的格式），圖層只放 bolt、確保站，
 *  所以看圖層標註指到的路線和 bolt、確保站的上層，不是找圖層裡的路線節點 */
function routeIds(docs, viewId) {
  const ids = new Set();
  for (const l of layersOn(docs, viewId)) {
    for (const n of l.nodes ?? []) ids.add(n.type === 'route' ? n.id : n.parent);
    for (const m of l.marks ?? []) if (isRouteMark(l, m)) ids.add(m.node);
  }
  ids.delete(undefined);
  return ids;
}
const routeCount = (docs, viewId) => routeIds(docs, viewId).size;
/** 岩場（組合）裡的照片畫面 */
/** 個人收藏的岩場：裡面只要有一張 personal（外站匯入，只供自己備用），不能分享 */
const personalSet = (docs, set) => { const v = viewsIn(docs, set); return v.some((x) => x.origin === 'personal'); };
/** 合併過的岩場：首頁一張卡片，裡面是原本的幾個岩場（組合 props.merged，items 指到各個岩場）；成員原樣保留，來源網址與自動更新照舊 */
const isMerged = (d) => d?.kind === 'set' && d.props?.merged === true;
const tickOwner = new Map();   // 合併岩場裡的路線 → 它原本的岩場 id：完攀紀錄記在原本的岩場上，拆開後紀錄還在
/** 岩場頁、路線清單用的岩場：合併的把成員的照片、節點接在一起（節點照 id 去重：切成幾包的同一座岩場共用上層區域），其他原樣 */
function flatSet(docs, set) {
  if (!isMerged(set)) return set;
  const members = set.items.map((i) => docs.find((d) => d.id === itemId(i))).filter((d) => d?.kind === 'set');
  for (const m of members) for (const n of m.nodes ?? []) if (n.type === 'route') tickOwner.set(n.id, m.id);
  const nodes = [...new Map(members.flatMap((m) => m.nodes ?? []).map((n) => [n.id, n])).values()];
  return { ...set, attribution: members[0]?.attribution ?? set.attribution, items: members.flatMap((m) => m.items), nodes, source: undefined, coverId: members[0]?.id, members };
}
const viewsIn = (docs, set) => set.items.map((i) => docs.find((d) => d.id === itemId(i))).filter((d) => d?.kind === 'view' && d.surface === 'photo');
/** 岩場的岩壁數、路線數：從組合的 nodes 數（一面岩壁可能有好幾張照片；沒有岩壁節點就算照片）。數量不另外存，一個事實只放一處 */
const wallCount = (docs, set) => (set.nodes ?? []).filter((n) => n.type === 'wall' || n.type === 'sector').length || viewsIn(docs, set).length;
const routeTotal = (docs, set) => (set.nodes ?? []).filter((n) => n.type === 'route').length || new Set(viewsIn(docs, set).flatMap((v) => [...routeIds(docs, v.id)])).size;
// 本機收藏的所有來源都算（Studio Guidebook、外站匯入、手動匯入），不是只算自己分享的。
// 先沿著首頁參照走訪，不把尚未下載的「世界」索引混進來。合併岩場只算成員，靠 node/view ID 全域去重。
function catalogStats(docs, homeId) {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const home = byId.get(homeId);
  const visited = new Set(), walls = new Set(), routes = new Set(), crags = new Set(), topos = new Set();
  const topo = (v) => { if (v?.kind === 'view' && v.surface === 'photo' && routeCount(docs, v.id) > 0) topos.add(v.id); };
  const count = (d) => {
    if (!d || visited.has(d.id)) return;
    visited.add(d.id);
    if (d.kind === 'view' && d.surface === 'photo') {
      walls.add('view:' + d.id);
      topo(d);
      for (const id of routeIds(docs, d.id)) routes.add(id);
      return;
    }
    if (d.kind !== 'set') return;
    // 合集是容器，不另外算一座岩場；成員仍保留來源、避免重複計算。
    const children = (d.items ?? []).map((i) => byId.get(itemId(i))).filter(Boolean);
    if (!isMerged(d) && d.id !== homeId) {
      crags.add(d.id);
      for (const v of children) topo(v);
      const ownWalls = (d.nodes ?? []).filter((n) => n.type === 'wall' || n.type === 'sector');
      const ownRoutes = (d.nodes ?? []).filter((n) => n.type === 'route');
      if (ownWalls.length) for (const w of ownWalls) walls.add('node:' + w.id);
      else for (const v of children) if (v.kind === 'view' && v.surface === 'photo') walls.add('view:' + v.id);
      if (ownRoutes.length) for (const r of ownRoutes) routes.add(r.id);
      else for (const v of children) if (v.kind === 'view' && v.surface === 'photo') {
        for (const id of routeIds(docs, v.id)) routes.add(id);
      }
    }
    for (const child of children) if (child.kind === 'set') count(child);
  };
  for (const entry of home?.items ?? []) count(byId.get(itemId(entry)));
  // 若首頁直接收單張 Topo，該照片也有岩壁／路線而不屬於任何組合。
  return { crags: crags.size, walls: walls.size, routes: routes.size, topos: topos.size };
}

/** 岩場的入口照片：收的時候存的 cover（以組合 id 為 key），沒有就用第一張照片 */
async function coverUrl(docs, set) {
  if (urlCache.has(`c:${set.id}`)) return urlCache.get(`c:${set.id}`);
  const cover = await getPhoto(set.coverId ?? set.id);
  if (cover) return keyedUrl(`c:${set.id}`, cover);
  for (const v of viewsIn(docs, set)) {
    const url = await photoUrl(v);   // 第一張沒下載到，就用下一張有圖的
    if (url) return url;
  }
  return '';
}

// ── 首頁：卡片（收到的岩場、Topo、拍的照片），新的在前 ──
async function render() {
  const [home, docs] = [await getDoc(state.home), await allDocs()];
  const items = home.items.map((i) => docs.find((d) => d.id === itemId(i))).filter((d) => d && (d.kind === 'set' || d.surface === 'photo'));
  // 舊使用者已有收藏，也視為體驗過核心功能；不在第一次空白首頁推安裝。
  if (items.length) AppKit.store.set('redpoint.receivedOnce', true);
  $('homeEmpty').hidden = items.length > 0;
  renderInstallHint();
  const cards = [];
  for (const d of items.reverse()) cards.push(d.kind === 'set' ? await packCard(d, docs) : await topoCard(d, docs));
  syncCards($('cards'), cards);
  if (nav.length || state.closing) return;
  showPage('home');
}

/** 圖片解好再換頁（不然換頁時圖才跳出來）。頁面裡的 <img> 在頁面藏著、瀏覽器沒在繪製時 decode() 可能永遠不回來：
 *  改用一張不在頁面上的同網址圖片解碼（解好的圖瀏覽器共用）；5 秒只是防卡住的上限（每台手機解碼速度不同，不能用短的固定時間猜） */
const settled = (img) => {
  const probe = new Image();
  probe.src = img.currentSrc || img.src;
  return Promise.race([probe.decode().catch(() => {}), new Promise((ok) => setTimeout(ok, 5000))]);
};

/** 卡片只換有變的（id 一樣、內容一樣的留著原來那張）：換頁、返回時整排重建會閃，也會重播進場動畫 */
function syncCards(box, cards) {
  const old = new Map([...box.children].map((c) => [c.dataset.id, c]));
  const next = cards.map((c) => (old.get(c.dataset.id)?.dataset.sig === c.dataset.sig ? old.get(c.dataset.id) : c));
  next.forEach((c, i) => c !== box.children[i] && box.insertBefore(c, box.children[i] ?? null));
  while (box.children.length > next.length) box.lastChild.remove();
}

function card({ id, img, name, sub, sourceTag = '', badge, go = false, cropTop = false, kind = '', onOpen }) {
  const pic = el('img', { className: 'pic', alt: '', ...(img ? { src: img } : {}) });   // 沒有圖不設 src（空字串會被當成這一頁的網址，出現破圖）
  // 圖還沒下載好：卡片先是會閃的灰底，圖到了才淡入（不讓人看到半張圖或破圖）
  if (img && !pic.complete) {
    pic.classList.add('wait');
    const shown = () => pic.classList.remove('wait');
    pic.addEventListener('load', shown, { once: true });
    pic.addEventListener('error', shown, { once: true });
  }
  if (!img) pic.hidden = true;
  if (cropTop) pic.style.objectPosition = 'top';   // 預覽圖（上面入口照片、下面小圖格子）：卡片只露出上半
  // 卡片由上往下：岩場名稱 → 岩壁數 → 來源。來源是最後一行，不做膠囊框。
  const subtitle = sub ? el('span', { className: 'sub', textContent: sub }) : null;
  const source = sourceTag
    ? el('span', { className: 'source-credit' }, icon('database'), el('span', { textContent: sourceTag }))
    : null;
  const b = el('button', { className: 'card ak-photo-card' }, pic,
    el('div', { className: 'meta' }, el('span', { className: 'name', textContent: name }), subtitle, source));
  if (badge) b.append(el('span', { className: go ? 'badge go' : 'badge', textContent: badge }));
  b.classList.toggle('nophoto', !img);
  pic.addEventListener('error', () => { pic.hidden = true; b.classList.add('nophoto'); }, { once: true });   // 載入失敗（沒網路）也不留破圖
  b.dataset.id = id;
  b.dataset.sig = [name, sub, sourceTag, badge, img].join('|');
  b.onclick = () => onOpen(pic);
  if (kind) b.dataset.kind = kind;
  return b;
}

/** 岩場裡有 3D 模型（surface: model）：打開就是 3D */
const has3d = (docs, set) => set.items.some((i) => docs.find((d) => d.id === itemId(i))?.surface === 'model');
async function packCard(set, docs) {
  const flat = flatSet(docs, set), merged = isMerged(set);
  return card({
    id: set.id, img: await coverUrl(docs, flat), name: nameOf(set), kind: 'set',
    sourceTag: merged ? '' : sourceLabel(set),
    sub: !merged && sourceLabel(set) ? T('wallsN', wallCount(docs, flat)) : [merged ? '' : credit(set.attribution), T('wallsN', wallCount(docs, flat))].filter(Boolean).join(' · '),
    badge: [has3d(docs, flat) ? '3D' : '', merged ? T('cragsN', flat.members.length) : personalSet(docs, set) ? T('personal') : ''].filter(Boolean).join(' · '),   // 3D 岩場另外標示
    onOpen: (pic) => openPack(set.id, pic),
  });
}

async function topoCard(view, docs) {
  return card({
    id: view.id, img: await photoUrl(view), name: nameOf(view), kind: 'view', sub: T('routesN', routeCount(docs, view.id)), badge: view.origin === 'personal' ? T('personal') : view.origin ? '' : T('localOnly'),
    onOpen: (pic) => openTopo(view.id, pic),
  });
}

/** 刪除：自己做的連同畫在上面的線；收來的岩場連同裡面的照片和線一起從這支手機刪掉 */
/** 刪一份檔案；岩場是組合裡的每一份；一顆石頭（岩壁節點）是它的每張照片（views） */
async function removeDoc(doc, views = doc.kind === 'set' ? doc.items.map(itemId) : [doc.id], { text, also = [] } = {}) {
  const docs = await allDocs();
  const gone = new Set(doc.kind === 'set' ? [doc.id] : []), byId = new Map(docs.map((d) => [d.id, d])), roots = new Set([doc.id, ...views]);
  // 岩場：組合裡的每一份（照片、地圖、圖層）；組合的層數不限（岩場→區域→照片），要一路往下清；照片連同疊在上面的圖層
  const seen = new Set(), add = (id) => {
    if (seen.has(id)) return;   // 組合若互相包含也不會繞圈
    seen.add(id);
    gone.add(id);
    for (const l of layersOn(docs, id)) { gone.add(l.id); roots.add(l.id); }   // 疊在照片上的圖層跟著照片走，不受「別的組合還在用」保護
    const d = byId.get(id);
    if (d?.kind === 'set') for (const i of d.items) add(itemId(i));
  };
  for (const id of views) add(id);
  // 別的組合（不在這次刪掉的）還在用的下層（合併岩場切成幾包時共用上層區域）不能刪，連同它底下的一起留下
  const keep = (id) => {
    if (!gone.delete(id)) return;
    for (const l of layersOn(docs, id)) gone.delete(l.id);
    const d = byId.get(id);
    if (d?.kind === 'set') for (const i of d.items) keep(itemId(i));
  };
  for (let again = true; again;) {
    again = false;
    for (const s of docs) if (s.kind === 'set' && !gone.has(s.id)) for (const i of s.items) if (gone.has(itemId(i)) && !roots.has(itemId(i))) { keep(itemId(i)); again = true; }
  }
  if (!(await UI.confirm(text ?? T('removeConfirm', nameOf(doc)), { title: T('delete'), ok: T('delete'), danger: true }))) return;
  for (const set of docs.filter(d => d.kind === 'set' && !gone.has(d.id) && d.items.some(i => gone.has(itemId(i))))) {
    await putDocs([{ ...set, items: set.items.filter(i => !gone.has(itemId(i))), t: now() }]);
  }
  await deleteDocs([...gone]);
  await deletePhotos([...gone]);
  await setMeta(nearbyThumbKey(doc.id), null);
  for (const d of also) await setMeta(nearbyThumbKey(d.id), null);
  forgetUrl(...gone);
  const sources = (await getMeta('sources')) ?? {};
  for (const d of [doc, ...also]) delete sources[d.id];
  await setMeta('sources', sources);
  const received = (await getMeta('received')) ?? {};   // 收下的版本也清：不留已刪岩場的紀錄
  for (const d of [doc, ...also]) delete received[d.id];
  await setMeta('received', received);
  if (doc.kind === 'set') {   // 收藏收的是哪一版也清掉：不然指紋沒變，同步收藏不會再收回來
    const collected = (await getMeta('collected')) ?? {};
    for (const d of [doc, ...also]) delete collected[d.id];
    await setMeta('collected', collected);
  }
  toast(T('deleted'));
  if (state.pack) await renderPack();
  await render();
}

const refOf = (d) => ({ href: `${d.id}.json`, id: d.id, ...(d.name ? { name: d.name } : {}), t: now() });

/** Prefer a shared, source-identified ancestor; names alone are not trustworthy. */
function sharedCollectionName(members) {
  if (members.length < 2) return null;
  const paths = members.map((d) => d.props?.sourceHierarchy);
  if (paths.some((p) => !Array.isArray(p) || p.length < 2)) return null;
  const common = [];
  for (let i = 0; i < Math.min(...paths.map((p) => p.length)); i++) {
    const head = paths[0][i];
    if (!head?.id || !head?.name || !paths.every((p) => p[i]?.id === head.id)) break;
    common.push(head);
  }
  // A common leaf is the same crag, not a parent grouping.
  const ancestor = common.at(-1);
  return ancestor && paths.every((p) => p.length > common.length) ? ancestor.name : null;
}

/** Review source-grounded grouping alternatives; nothing changes until final confirmation. */
async function autoMergeHome() {
  closeAcct();
  const home = await getDoc(state.home), docs = await allDocs();
  const proposals = autoMergeCandidates(home, docs);
  if (!proposals.length) return void toast(T('mergeNone'));

  const selected = new Set(), chosen = new Map();
  const list = el('div', { className: 'pick-list' });
  for (const proposal of proposals) {
    // Prefer smaller local groups by default; a broader region is an explicit choice.
    const overlaps = proposals.some((other) => other !== proposal && other.depth > proposal.depth
      && other.ids.every((id) => proposal.ids.includes(id)));
    const input = el('input', { type: 'checkbox', checked: !overlaps });
    if (input.checked) selected.add(proposal.id);
    chosen.set(proposal.id, input);
    input.onchange = () => {
      if (input.checked) {
        // The same crag cannot be merged twice. Selecting Longdong unchecks School Gate.
        for (const other of proposals) {
          if (other.id === proposal.id || !selected.has(other.id)) continue;
          if (other.ids.some((id) => proposal.ids.includes(id))) {
            selected.delete(other.id);
            chosen.get(other.id).checked = false;
          }
        }
        selected.add(proposal.id);
      } else selected.delete(proposal.id);
    };
    list.append(el('label', { className: 'pick-row' },
      input, el('span', {},
        el('b', { textContent: T('mergeInto', proposal.name) }),
        el('small', { textContent: T('mergeRow', proposal.ids.length, proposal.names) }))));
  }
  const preview = await ask({
    title: T('autoMerge'),
    text: T('mergeHint'),
    body: [list],
    buttons: [{ label: T('cancel') }, { label: T('next'), value: 'preview', primary: true }],
  });
  if (preview?.button !== 'preview') return;
  const wanted = proposals.filter((p) => selected.has(p.id));
  if (!wanted.length) return;

  // Recheck against current Home and merged membership immediately before writing.
  const latestHome = await getDoc(state.home), latestDocs = await allDocs();
  const fresh = autoMergeCandidates(latestHome, latestDocs);
  if (wanted.some((p) => !fresh.some((g) => g.id === p.id && g.ids.length === p.ids.length
    && g.ids.every((id) => p.ids.includes(id))))) {
    return void UI.alert(T('mergeStale'));
  }
  const finalText = wanted.map((g) => T('mergeItem', g.name, g.ids.length)).join('\n');
  if (!(await UI.confirm(T('mergeConfirm', finalText), {
    title: T('mergeConfirmTitle'), ok: T('merge'),
  }))) return;

  const memberIds = new Set(), groups = [], placement = new Map();
  for (const p of wanted) {
    const group = { ...newSet(p.name, '我'), props: { merged: true }, items: p.ids.map((id) => {
      const doc = latestDocs.find((d) => d.id === id);
      return refOf(doc);
    }) };
    groups.push(check(group));
    for (const id of p.ids) memberIds.add(id);
    // Place each new group at the position of its last original member.
    const positions = latestHome.items.map((item, i) => p.ids.includes(itemId(item)) ? i : -1);
    placement.set(Math.max(...positions), refOf(group));
  }
  const items = latestHome.items.flatMap((item, i) => [
    ...(!memberIds.has(itemId(item)) ? [item] : []),
    ...(placement.has(i) ? [placement.get(i)] : []),
  ]);
  await putDocs([...groups, check({ ...latestHome, items, t: now() })]);
  toast(T('mergedN', groups.length));
  await render();
}

async function renameMerged(set) {
  const name = await UI.prompt({ title: T('rename'), value: nameOf(set), max: 40 });
  if (!name?.trim()) return;
  await putDocs([check({ ...set, name: name.trim(), props: { ...set.props, nameCustomized: true }, t: now() })]);
  await render();
}

/** 拆開：成員回到首頁各自一張卡片，位置留在原處 */
async function splitMerged(set) {
  const home = await getDoc(state.home);
  const items = home.items.flatMap((i) => (itemId(i) === set.id ? [...set.items].reverse().map((m) => ({ ...m, t: now() })) : [i]));
  await putDocs([check({ ...home, items, t: now() })]);
  await deleteDocs([set.id]);
  await render();
}

/** 刪除合併的岩場：裡面每一個岩場都刪掉 */
async function removeMerged(set, members) {
  await removeDoc(set, [...members.map((m) => m.id), ...members.flatMap((m) => m.items.map(itemId))], {
    text: T('removeMerged', nameOf(set), members.length), also: members,
  });
}

// ── 展開頁右上「更多」：這一頁的動作（分享、重新命名、拆開、刪除）排成一張小選單 ──
let moreMenu = null;
function closeMore() { moreMenu?.menu.remove(); moreMenu = null; }
function openMore(anchor, actions) {
  if (moreMenu?.anchor === anchor) return closeMore();
  closeMore();
  const menu = el('div', { className: 'rp-more', role: 'menu' });
  for (const a of actions) {
    const b = el('button', { className: a.danger ? 'danger' : '', role: 'menuitem' }, icon(a.icon), el('span', { textContent: a.label }));
    b.onclick = () => { closeMore(); Promise.resolve(a.run()).catch((err) => toast(err.message, 5000)); };
    menu.append(b);
  }
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${r.bottom + 6}px`; menu.style.right = `${Math.max(8, innerWidth - r.right)}px`;
  document.body.append(menu);
  moreMenu = { menu, anchor };
}
document.addEventListener('pointerdown', (e) => moreMenu && !moreMenu.menu.contains(e.target) && !moreMenu.anchor.contains(e.target) && closeMore(), true);

/** 岩場頁的動作：合併的岩場可以重新命名、拆開；個人的岩場和合併的不能整組分享（合併的到成員那一層分享） */
async function packActions() {
  const docs = await allDocs(), set = docs.find((d) => d.id === state.pack);
  if (!set) return [];
  const flat = flatSet(docs, set);
  const after = async () => { if (state.pack) await renderPack(); };
  if (isMerged(set)) {
    return [
      { icon: 'edit', label: T('rename'), run: async () => { await renameMerged(set); await after(); } },
      { icon: 'split', label: T('split'), run: async () => { await splitMerged(set); await after(); } },
      { icon: 'trash', label: T('delete'), danger: true, run: () => removeMerged(set, flat.members) },
    ];
  }
  return [...(personalSet(docs, set) ? [] : [{ icon: 'share', label: T('share'), run: () => share(set.id) }]), { icon: 'trash', label: T('delete'), danger: true, run: () => removeDoc(set) }];
}

/** Topo 頁的動作：分享、刪除（區域裡只有這一張照片時，連區域一起刪） */
async function topoActions() {
  const id = state.topo, view = await getDoc(id);
  if (!view) return [];
  const wall = (await topoPlace(id))?.wall;
  return [
    ...(shareable(view) ? [{ icon: 'share', label: T('share'), run: () => shareTopoMenu() }] : []),
    { icon: 'trash', label: T('delete'), danger: true, run: async () => {
      await (wall && wall.views.length === 1 ? removeDoc(wall.node, wall.views.map((v) => v.id)) : removeDoc(view));
      if (!(await getDoc(id))) back();
    } },
  ];
}

/** 岩場被合併進某張卡片時，打開的是那張卡片 */
async function shownId(id) {
  return (await allDocs()).find((d) => isMerged(d) && d.items.some((i) => itemId(i) === id))?.id ?? id;
}

// ── 過場：卡片的照片飛到下一頁那一塊（岩點貓的 flyBetween） ──
/** 換頁照片的位置與 Topo 使用相同縮放規則。 */
function photoRect(box, w, h) {
  const r = box.getBoundingClientRect(), size = fitSize({ w: r.width, h: r.height }, w / h, box.getAttribute('fit'));
  return { left: r.left + (r.width - size.w) / 2, top: r.top + (r.height - size.h) / 2, width: size.w, height: size.h };
}

// ── 岩場頁：入口照片橫幅＋每面岩壁的小卡 ──
async function openPack(id, fromPic, { replace = false, fresh = false } = {}) {   // fresh：剛收下（開箱完），不用再問有沒有新版
  id = await shownId(id);   // 岩場被合併進一張卡片：打開那張卡片
  state.pack = id;
  if (!(await fillPack())) return void (state.pack = '');   // 內容先填好、圖解開，再換頁：先換頁再填會露出上一個岩場或空白
  const docs = await allDocs(), set = docs.find((d) => d.id === id), flat = flatSet(docs, set), model = model3dOf(docs, flat);
  const ids = model ? cragModelIds(cragOf(docs, flat).order.map((vid) => docs.find((d) => d.id === vid))) : [];
  const snap = model && ids.length && (await Promise.all(ids.map(modelUsable))).every(Boolean) ? model : null;   // 離線又沒有模型檔：退回 2D 的岩場頁
  if (snap) await open3d(snap, fromPic, { replace, crag: true });   // 整個岩場是一個 3D 模型：岩場頁就是 3D（岩壁小卡不用了）
  else await enter('pack', packClosed, fromPic ? { from: fromPic, src: fromPic.src, rect: packBannerRect, card: replace ? { box: 'cards', id } : undefined } : {}, { replace });   // 沒有照片可以飛（例如圖釘沒有預覽圖）就直接換頁
  if (!fresh) for (const m of isMerged(set) ? flatSet(docs, set).members : [set]) updatePack(m.id).catch((e) => console.warn('更新岩場', e));
}

// ── 收過的岩場自動更新：打開岩場時在背景問一次來源網址和這本的公開網址（同一個岩場 10 分鐘內只問一次，沒網路不問），
// 組合的 t 比收下的那版新就照新版收下：照片 id 和 sha256 都沒變的不重新下載，舊版有、新版沒有的檔案（連同疊在那些照片上的圖層）刪掉。
// 收下的那版記在 meta 的 received（組合 id → t）：手機裡刪一面岩壁會改組合的 t，不能拿它比
const UPDATE_EVERY = 10 * 60 * 1000;
const checkedAt = new Map();
async function updatePack(id) {
  if (!navigator.onLine || Date.now() - (checkedAt.get(id) ?? 0) < UPDATE_EVERY) return;
  checkedAt.set(id, Date.now());
  const sources = (await getMeta('sources')) ?? {}, local = await getDoc(id);
  if (!sources[id] || /\.zip$/i.test(new URL(sources[id], location.href).pathname) || local?.kind !== 'set') return;
  const received = (await getMeta('received')) ?? {};
  // 不認人的發佈（docs/proposals/crag-open-versions.md）：更新是新的專案，自動換成「收下那一版的後代」裡世界清單排序最前的（最新的一版）；
  // 一次刪很多的大改 Studio 發成另一本（不是後代），不會自動換過去
  const floor = received[id] ?? local.t ?? 0, mine = projectOf(sources[id]);
  const books = mine && Backend().caps.guidebooks ? await Backend().listGuidebooks().catch(() => []) : [];
  // 不列入世界的書（世界清單沒有）：問伺服器這本所有的版本
  const unlisted = mine && Backend().guidebookVersions && !books.some((b) => versionIds(b).has(mine)) ? await Backend().guidebookVersions(mine).catch(() => []) : [];
  const descendants = [...books, ...unlisted].flatMap((b) => [b, ...(b.others ?? [])]).filter((v) => v.id !== mine && (v.lineage ?? []).includes(mine));
  for (const d of descendants) {
    const res = await ShareTools.open(d.url, { cache: 'no-cache' }).catch(() => null), head = res?.ok ? await res.json().catch(() => null) : null;
    if (head?.id === id && head.t > floor) return applyUpdate(id, d.url, sources, received, local);
  }
  // 原本收的網址，加上這本的公開網址（/p/<組合 id>）：以前發佈在 Drive 收的，之後的版本改放公開資料集，只問 Drive 會一直停在舊版。兩邊比，用新的那邊，之後也記那邊
  const heads = await Promise.all([...new Set([sources[id], new URL(`/p/${id}/index.json`, location.href).href])].map(async (u) => {
    const res = await ShareTools.open(u, { cache: 'no-cache' }).catch(() => null);
    const head = res?.ok ? await res.json().catch(() => null) : null;
    return head?.id === id ? { url: u, t: head.t } : null;
  }));
  const best = heads.filter(Boolean).sort((a, b) => b.t - a.t)[0];
  if (!best || !(best.t > floor)) return;
  return applyUpdate(id, best.url, sources, received, local);
}
async function applyUpdate(id, url, sources, received, local) {
  const keep = async (view) => {
    const old = await getDoc(view.id);
    return !!view.sha256 && old?.sha256 === view.sha256 && !!(await getPhoto(view.id));
  };
  const got = await fromUrl(url, { fresh: true, keep });
  if (got.root.id !== id) return;
  // 舊版的檔案：組合沿著 items 往下，圖層帶著它的照片
  const docs = await allDocs(), byId = new Map(docs.map((d) => [d.id, d])), old = new Set();
  const walk = (did) => {
    const d = byId.get(did);
    if (!d || old.has(did)) return;
    old.add(did);
    if (d.kind === 'set') for (const i of d.items) walk(itemId(i));
  };
  walk(id);
  const gone = new Set([...old].filter((x) => !got.docs.has(x)));
  for (const v of [...gone]) for (const l of layersOn(docs, v)) gone.add(l.id);
  await putDocs([...got.docs.values()]);
  for (const [vid, blob] of got.photos) await putPhoto(vid, blob);
  const cover = got.preview ? await cropTop(got.preview, got.root.props.preview).catch(() => null) : null;
  if (cover) await putPhoto(id, cover);
  await saveNearbyThumb(got.root).catch((e) => console.warn('更新朋友互傳縮圖', e));
  await deleteDocs([...gone]);
  await deletePhotos([...gone]);
  forgetUrl(id, ...got.photos.keys(), ...gone);
  await setMeta('received', { ...received, [id]: got.root.t });
  if (url !== sources[id]) await setMeta('sources', { ...((await getMeta('sources')) ?? {}), [id]: url });
  if (state.pack) await renderPack();
  await render();
  toast(T('packUpdated'));
}
/** 3D 模型檔在手機裡、或現在有網路能載才進 3D；離線又沒有檔就不進（進去只會卡在載入） */
const modelUsable = async (id) => !!(await getPhoto(id)) || navigator.onLine !== false;
/** 岩場的每張 Topo 都是 3D 模型的快照（同一模型或分段多模型，而且手機裡有那些模型）：回傳第一面岩壁的快照，不是就回 null */
function model3dOf(docs, set) {
  const views = cragOf(docs, set).order.map((id) => docs.find((d) => d.id === id)), ids = cragModelIds(views);
  return ids.length && ids.every((id) => docs.some((d) => d.id === id)) ? views[0] : null;
}
const packBannerRect = () => $('packBanner').querySelector('img').getBoundingClientRect();
const packClosed = () => {
  state.pack = '';
  return render();
};

/** 重畫目前岩場頁（頁面已經開著） */
async function renderPack() {
  if (!(await fillPack())) back();
}

/**
 * 岩場的組合：照片畫面的 props.node 指到子區域（岩壁、石頭），子區域的上層是分區（上攀區、抱石區）。
 * 回傳 { sections: [{ node?, walls: [{ node, views, routes }] }], loose: 沒有子區域的照片, overview: 掛在岩場、分區上的區域照片, maps: 岩場地圖（地圖畫面）, order: 所有照片 id（岩場頁、左右滑的順序）, nodes }；
 * 分區、子區域照 props.order 排，沒有就照組合裡第一次出現的順序。
 */
function cragOf(docs, set) {
  const nodes = new Map((set.nodes ?? []).map((n) => [n.id, n]));
  const walls = new Map(), loose = [], overview = [];
  for (const v of viewsIn(docs, set)) {
    const w = nodes.get(v.props?.node);
    const hasRoutes = routeCount(docs, v.id) > 0;
    if (w && ['crag', 'area'].includes(w.type) && !hasRoutes && v.props?.model) continue;   // 3D 岩場的全區快照：卡片的封面、第一次進 3D 的第一個畫面，不是區域照片
    if (w && ['crag', 'area'].includes(w.type) && !hasRoutes) { overview.push(v); continue; }   // 沒有路線的區域照片（配置圖、全景）：不是 Topo
    if (!w || !['wall', 'sector', ...(hasRoutes ? ['crag', 'area'] : [])].includes(w.type)) { loose.push(v); continue; }
    if (!walls.has(w.id)) walls.set(w.id, { node: w, views: [], routes: [] });
    walls.get(w.id).views.push(v);
  }
  // 一張照片拍到兩個子區域時，照片只掛在路線多的那一個（props.node）：另一個子區域借用畫著它的路線的那張（只借別面岩壁的照片），才有自己的卡片
  const owned = [...walls.values()].flatMap((w) => w.views);
  for (const n of nodes.values()) {
    if (!['wall', 'sector'].includes(n.type) || walls.has(n.id)) continue;
    const mine = new Set([...nodes.values()].filter((r) => r.type === 'route' && r.parent === n.id).map((r) => r.id));
    const views = mine.size ? owned.filter((v) => [...routeIds(docs, v.id)].some((id) => mine.has(id))) : [];
    if (views.length) walls.set(n.id, { node: n, views, routes: [] });
  }
  for (const n of nodes.values()) if (n.type === 'route' && walls.has(n.parent)) walls.get(n.parent).routes.push(n);
  const allMaps = set.items.map((i) => docs.find((d) => d.id === itemId(i))).filter((d) => d?.kind === 'view' && d.surface === 'map');
  const maps = allMaps.filter((d) => d.props?.purpose !== 'approach'), approach = allMaps.find((d) => d.props?.purpose === 'approach');
  const byOrder = (a, b) => (a.node?.props?.order ?? Infinity) - (b.node?.props?.order ?? Infinity);
  const sections = new Map();
  for (const w of walls.values()) {
    const up = nodes.get(w.node.parent), key = up && ['area', 'sector'].includes(up.type) ? up.id : '';
    if (!sections.has(key)) sections.set(key, { node: key ? up : undefined, walls: [] });
    sections.get(key).walls.push(w);
  }
  const list = [...sections.values()].sort(byOrder);
  // 同一面岩壁、同一顆石頭的幾張 Topo：先放畫了這面岩壁最多路線的（借來的照片，主要內容是別面岩壁的就排後面），再照這面岩壁最小的路線編號排（跟路線書一樣由 1 開始往後）
  const rank = new Map();
  for (const w of walls.values()) {
    const mine = new Set([...nodes.values()].filter((r) => r.type === 'route' && r.parent === w.node.id).map((r) => r.id));
    for (const v of w.views) {
      const ids = layersOn(docs, v.id).flatMap((l) => l.marks ?? []).filter((m) => mine.has(m.node));
      const nums = ids.map((m) => Number(m.props?.label)).filter(Number.isFinite);
      rank.set(`${w.node.id}|${v.id}`, { n: new Set(ids.map((m) => m.node)).size, first: nums.length ? Math.min(...nums) : Infinity });
    }
    w.views.sort((a, b) => {
      const x = rank.get(`${w.node.id}|${a.id}`), y = rank.get(`${w.node.id}|${b.id}`);
      return y.n - x.n || x.first - y.first;
    });
  }
  // 每面岩壁卡片的第一張照片不跟別面重複：照片少的岩壁先選（只有一張可借的先拿走它），其他岩壁換成下一張還沒被當卡片照片的
  const leads = new Set();
  for (const w of [...walls.values()].sort((a, b) => a.views.length - b.views.length)) {
    const i = w.views.findIndex((v) => !leads.has(v.id));
    if (i > 0) w.views.unshift(...w.views.splice(i, 1));
    leads.add(w.views[0].id);
  }
  for (const s of list) {
    s.walls.sort(byOrder);
    for (const w of s.walls) w.routes.sort((a, b) => (a.props?.order ?? 0) - (b.props?.order ?? 0));
  }
  return { sections: list, loose, overview, maps, approach, order: [...new Set([...list.flatMap((s) => s.walls.flatMap((w) => w.views)), ...loose].map((v) => v.id))], nodes };
}

/** 填岩場頁的內容（頁面藏著也行）；找不到這個岩場回 false */
async function fillPack() {
  const docs = await allDocs(), found = docs.find((d) => d.id === state.pack);
  if (!found) return false;
  const set = flatSet(docs, found);
  const views = viewsIn(docs, set), crag = cragOf(docs, set);
  const img = $('packBanner').querySelector('img');
  const cover = await coverUrl(docs, set);
  $('packBanner').classList.toggle('nophoto', !cover);
  img.hidden = !cover;
  if (!cover) img.removeAttribute('src');
  else if (img.getAttribute('src') !== cover) {
    img.src = cover;
    await settled(img);
  }
  $('packBanner').querySelector('b').textContent = nameOf(set);
  $('packTitle').textContent = nameOf(set);
  state.packShareable = !(personalSet(docs, set) || isMerged(set));   // 合併的岩場不能整組分享，到成員那一層分享
  // 地圖鈕：有岩場地圖就開地圖（手繪圖在地圖右上），沒有就開區域照片
  $('packArea').hidden = !crag.maps.length && !crag.overview.length;
  $('packArea').setAttribute('aria-label', T(crag.maps.length ? 'cragMap' : 'areaPhotos'));
  $('packArea').onclick = () => (crag.maps.length ? openMap(set, crag) : openTopo(crag.overview[0].id));
  $('packBanner').querySelector('span').textContent = [sourceLabel(set) || credit(set.attribution), T('wallsN', wallCount(docs, set)), T('routesN', routeTotal(docs, set))].filter(Boolean).join(' · ');
  // 原始資料：組合寫了 source（資料從哪裡來）就在右上放連結
  $('packSource').hidden = !set.source?.url;
  if (set.source?.url) $('packSource').href = set.source.url;
  // 交通：岩場（或分區）節點寫了 props.approach 或位置（geo）才有右上的按鈕；有交通圖就開交通頁（地圖、說明、導航），沒有就跳說明（有位置多一個導航）
  const way = [...crag.nodes.values()].find((n) => ['crag', 'area'].includes(n.type) && (n.props?.approach || n.props?.['thecrag:access'] || n.props?.description || n.geo));
  $('packWay').hidden = !way;
  $('packWay').onclick = () => (crag.approach ? openWay(set, crag.approach, way) : showWay(way));
  // 路線清單（右下爪印）：有路線節點才有
  const routes = [...crag.nodes.values()].filter((n) => n.type === 'route');
  $('packTicks').hidden = !routes.length;
  const have = await Promise.all(views.map((v) => getPhoto(v.id)));
  // 一個分區一段；一顆石頭（岩壁）一張卡，點了打開它的第一張 Topo
  const groups = [...crag.sections.map((s) => ({ id: s.node?.id ?? 'walls', name: crag.sections.length > 1 ? nameOf(s.node) : '', walls: s.walls }))];
  if (crag.loose.length) groups.push({ id: 'loose', name: groups.length ? T('otherPhotos') : '', views: crag.loose });
  const old = new Map([...$('packCards').children].map((s) => [s.dataset.id, s]));
  const secs = [];
  for (const g of groups) {
    const sec = old.get(g.id) ?? el('section', { className: 'pk-sec' }, el('h2', { className: 'pk-head' }, el('b'), el('span')), el('div', { className: 'cards two ak-photo-grid', id: `pk-${g.id}` }));
    sec.dataset.id = g.id;
    sec.querySelector('.pk-head').hidden = !g.name;
    sec.querySelector('.pk-head b').textContent = g.name;
    const n = g.walls ? g.walls.reduce((a, w) => a + w.routes.length, 0) : 0;
    // 大多是抱石的分區算石頭，其他算岩壁
    const boulder = g.walls && g.walls.flatMap((w) => w.routes).filter((r) => r.props?.style === 'boulder').length * 2 > n;
    sec.querySelector('.pk-head span').textContent = g.walls ? `${T(boulder ? 'bouldersN' : 'wallsN', g.walls.length)} · ${T('routesN', n)}` : T('photosN', g.views.length);
    const cards = [];
    for (const w of g.walls ?? []) {
      const done = w.routes.filter((r) => tickOf(set.id, r.id) >= 2).length;
      const c = card({
        id: w.node.id, img: await photoUrl(w.views[0]), name: nameOf(w.node),
        sub: [w.views.length > 1 ? T('toposN', w.views.length) : '', T('routesN', w.routes.length)].filter(Boolean).join(' · '),
        onOpen: (pic) => openTopo(w.views[0].id, pic),
      });
      if (done) c.append(el('span', { className: 'tick', innerHTML: `<svg class="paw"><use href="#i-paw"/></svg>${done}` }));
      c.dataset.sig += `|${done}`;
      cards.push(c);
    }
    for (const v of g.views ?? []) {
      cards.push(card({
        id: v.id, img: await photoUrl(v), name: nameOf(v), sub: T('routesN', routeCount(docs, v.id)),
        onOpen: (pic) => openTopo(v.id, pic),
      }));
    }
    syncCards(sec.querySelector('.cards'), cards);
    secs.push(sec);
  }
  secs.forEach((s, i) => s !== $('packCards').children[i] && $('packCards').insertBefore(s, $('packCards').children[i] ?? null));
  while ($('packCards').children.length > secs.length) $('packCards').lastChild.remove();
  await Promise.all([...$('packCards').querySelectorAll('.card')].slice(0, 8).map((c) => settled(c.querySelector('img'))));   // 最上面幾張先解好
  // 沒下載到的照片（收的時候訊號斷了）：上山前連網補下載，不然到了岩場沒訊號就看不到
  const missing = views.filter((_, i) => !have[i]);
  $('packMissing').hidden = !missing.length;
  $('packMissing').textContent = T('missingPhotos', missing.length);
  // 個人收藏的照片是瀏覽器擴充收的：沒有網址可以補下載，要在原網站再收藏一次
  if (personalSet(docs, set)) {
    $('packMissing').textContent = T('missingPhotosPersonal', missing.length);
    $('packMissing').onclick = null;
    return true;
  }
  $('packMissing').onclick = async () => {
    const btn = $('packMissing');
    btn.disabled = true;
    let done = 0;
    for (const v of missing) {
      btn.textContent = T('downloadingN', done, missing.length);
      try {
        const res = await ShareTools.open(v.href);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await putPhoto(v.id, await res.blob());
        forgetUrl(v.id);
        done++;
      } catch (e) {
        toast(e.name === 'TypeError' ? T('netOffline') : T('downloadFailed', e.message), 4000);
        break;
      }
    }
    btn.disabled = false;
    renderPack();
  };
  return true;
}

// 電腦（滑鼠加寬螢幕）：Topo、地圖開縮放鈕與滾輪縮放
const desktop = matchMedia('(hover: hover) and (pointer: fine) and (min-width: 900px)');
function syncDesktop() {
  const on = desktop.matches;
  $('view').setAttribute('wheel', on ? 'always' : 'ctrl');
  $('view').setAttribute('controls', on ? 'true' : 'false');
  for (const id of ['wayView', 'cmapView']) $(id).setAttribute('controls', on ? 'true' : 'false');
}
desktop.onchange = syncDesktop;
syncDesktop();

// ── 右上頭像：暱稱、加到主畫面（沒有帳號）──
function face(target, user) {
  globalThis.AppKit.account.avatar(target, user);
}
face($('rpHomeAvatar'), null);

let install = null;
// 與岩點貓一致：第一次收下岩場後，在首頁顯示一次非阻擋式提示；主畫面 App 不再提示。
function renderInstallHint() {
  const ready = AppKit.store.get('redpoint.receivedOnce', false) === true;
  $('rpInstallBar').hidden = !ready || !install?.offer || !(install.ios || install.android);
  renderSyncHint(ready);
}
// 同步自己的其他裝置：收下第一個岩場後在首頁提示一次（可關閉）；配對過、不支援、或正在顯示「加到主畫面」時不顯示。入口一直在「更多」選單
const syncHintOff = () => AppKit.store.get('redpoint.syncHintX', false) === true || AppKit.nearby.paired() > 0 || !AppKit.nearby.supported();
function renderSyncHint(ready = AppKit.store.get('redpoint.receivedOnce', false) === true) {
  $('rpSyncBar').hidden = !ready || syncHintOff() || !$('rpInstallBar').hidden;
}
$('rpSyncGo').onclick = () => { AppKit.store.set('redpoint.syncHintX', true); renderSyncHint(); openNearby('devices'); };
$('rpSyncX').onclick = () => { AppKit.store.set('redpoint.syncHintX', true); renderSyncHint(); };
async function installRedpoint() {
  const result = await install.prompt();
  if (result) return;   // Chromium 已顯示原生安裝對話框（接受或拒絕）
  if (install.inApp) return UI.alert(T(install.ios ? 'inAppIos' : 'inAppAndroid'));
  if (install.ios) return UI.alert(`${T('ldIos1')} → ${T('ldIos2')} → ${T('iosAdd')}\n${T('installIosNote')}`);
  return UI.alert(T('installMenu'));
}
$('rpInstallGo').onclick = installRedpoint;
$('rpInstallX').onclick = () => install.dismiss();
async function openAcct() {
  face($('acFace'), null);   // 姓名放在最上面：暱稱（沒設定顯示「未設定」）
  $('acName').textContent = AppKit.nearby.nickname() || T('nicknameUnset');
  $('avatar').setAttribute('aria-expanded', 'true');
  $('acSync').hidden = !AppKit.nearby.supported();
  const nPaired = AppKit.nearby.paired();
  $('acSyncVal').textContent = nPaired ? T('syncPaired').replace('{n}', nPaired) : '';
  $('acInstall').hidden = !install || install.standalone || !(install.ios || install.android);   // 關閉首頁提醒後，仍可從設定自行安裝
  const mergeHomeDoc = await getDoc(state.home), docs = await allDocs();
  const totals = catalogStats(docs, state.home);
  globalThis.AppKit.account.summary($('acStats'), totals);
  $('acStats').hidden = !(totals.crags || totals.topos || totals.routes);   // 沒有紀錄就不顯示
  $('acAutoMerge').hidden = !autoMergeCandidates(mergeHomeDoc, docs).length;
  $('acct').hidden = false;
}
// ── 語言：只跟瀏覽器語言（AppKit.i18n 管），地圖與 Topo 的名稱依目前語言 ──
function syncLang() {
  const l = globalThis.AppKit.i18n.lang, bcp = l === 'zh' ? 'zh-Hant' : l === 'zh-CN' ? 'zh-Hans' : l;
  $('view').setAttribute('lang', bcp);
  for (const id of ['cmapView', 'wayView']) $(id).setAttribute('lang', bcp);
}
const closeAcct = () => {
  $('acct').hidden = true;
  $('avatar').setAttribute('aria-expanded', 'false');
};

// ── 世界：Climbio Studio 發佈的岩場與 OpenClimbing 全球 Topo 岩場 ──
const WORLD_STORE = 'redpoint.world';
/** 合併後的完整世界（記憶體）：{ books, oc, tree }；tree 只依地理分組，不把所在國家排第一（world-data.mjs 的 hydrateWorld） */
let worldPack = null, worldPackWait = null;
/** OpenClimbing 岩場的預覽圖（HF 資料集）：合併的岩場用路線最多的那個區 */
const ocPreview = (crag) => {
  const m = crag.members ? crag.members.filter((x) => x.pv).sort((a, b) => (b.topoRoutes || 0) - (a.topoRoutes || 0))[0] : crag.pv ? crag : null;
  return m ? `${OC_DATA}${m.osmId}/preview.jpg` : '';
};
/** 讀進來的世界補上語系文字：沒有名字的岩場（伺服器合成時不知道語系）叫「未命名」 */
function hydrateStored(file) {
  const pack = hydrateWorld(file);
  if (!pack) return null;
  const unnamed = T('unnamedCrag');
  for (const c of pack.oc) { if (!c.name) c.name = unnamed; for (const m of c.members ?? []) if (!m.name) m.name = unnamed; }
  return pack;
}
/** 取最新的世界檔：主網讀雲端預先合成好的（一個檔案）；沒有雲端服務、或雲端的讀不到時，在手機上用同一份程式從開放資料集合成 */
async function fetchWorldFile() {
  const backend = Backend();
  if (backend.loadWorld) {
    try {
      const stored = AppKit.store.get(WORLD_STORE), have = stored && !Array.isArray(stored) ? stored.wv : '';
      const file = await backend.loadWorld(have);
      if (file === null) return stored;   // index 說世界沒變：用手機上存的（不用再抓整份）
      if (hydrateWorld(file)) return file;
    } catch (e) { /* 改用手機自己合成 */ }
  }
  const [res, books] = await Promise.all([
    fetch(`${OC_DATA}index.json`),
    backend.caps.guidebooks ? backend.listGuidebooks().catch(() => []) : [],
  ]);
  if (!res.ok) throw new Error(res.statusText);
  return buildWorldFile(books, await res.json());
}
/** 讀上次存下的世界檔；舊版存的是 { books, oc }，不算，等這次抓新的 */
function readStoredWorld() {
  const file = AppKit.store.get(WORLD_STORE);
  return file && !Array.isArray(file) ? hydrateStored(file) : null;
}
function packFromStore() {
  if (worldPack) return worldPack;
  const pack = readStoredWorld();
  if (pack) worldPack = pack;
  return pack;
}
/** 抓世界檔、合成記憶體裡的樹並記住；同時只跑一次。refresh 時仍共用進行中的那一次 */
async function loadWorld({ refresh = false } = {}) {
  if (worldPack && !refresh) return worldPack;
  if (worldPackWait) return worldPackWait;
  const run = (async () => {
    const file = await fetchWorldFile();
    worldPack = hydrateStored(file);
    AppKit.store.set(WORLD_STORE, file);   // 存不下就每次重拿
    return worldPack;
  })();
  worldPackWait = run;
  try {
    return await run;
  } finally {
    if (worldPackWait === run) worldPackWait = null;
  }
}
const prefetchWorld = () => { loadWorld().catch(() => {}); };

async function openWorld() {
  enter('world', () => { worldPath = []; worldRects = []; worldQuery = ''; $('worldSearch').value = ''; render(); });   // 離開世界就回到最上層，下次從國家開始（返回紀錄也是一層一層退完才離開）
  worldSig = '';
  const apply = async (pack) => {
    if ($('world').hidden || !pack) return;
    await showWorld(pack.books, pack.oc, pack.tree);
  };
  const ready = packFromStore();
  if (ready) {
    await apply(ready);   // 已有完整樹就直接顯示，背景再更新；所在國家第一格是畫面上才套用
    loadWorld({ refresh: true }).then(apply).catch((e) => {
      if ($('world').hidden || ready.tree?.length) return;
      worldNote(e.code === 'offline' ? T('netOffline') : T('loadFailed', e.message));
    });
    return;
  }
  if (worldTree.length) drawWorld();
  worldNote(T('findingCrags'), true);
  try {
    await apply(await loadWorld());
  } catch (e) {
    if ($('world').hidden) return;
    worldNote(e.code === 'offline' ? T('netOffline') : T('loadFailed', e.message));
  }
}

/** 世界的岩場收過了沒：記下的網址一樣，或是同一本（網址裡的 /p/<id>/ 一樣，climbio.app 與開發版的網址不同） → 手機裡的組合 id */
const projectOf = (url) => /\/p\/([0-9a-z]+)\//.exec(url ?? '')?.[1];
/** 世界清單一列涵蓋的專案 id：自己、血緣（祖先）、其他版本與它們的血緣 */
const versionIds = (b) => new Set([b.id, ...(b.lineage ?? []), ...(b.others ?? []).flatMap((o) => [o.id, ...(o.lineage ?? [])])]);
function groupedBookId(group) {
  return ocIdOf(`osm:area-group:${group.members.map(m => m.osmId).sort((a, b) => a - b).join(',')}`);
}
async function haveBook(b) {
  if (b.members?.length) {
    const id = groupedBookId(b);
    return (await getDoc(id))?.kind === 'set' ? id : null;
  }
  const sources = Object.entries((await getMeta('sources')) ?? {});
  const known = versionIds(b);   // 世界清單每面書只列排序第一的版本：收下的是這本書的哪個版本（自己、祖先、其他版本）都算收過
  const hit = sources.find(([, url]) => url === b.url) ??
    sources.find(([, url]) => projectOf(url) && known.has(projectOf(url))) ??
    (b.osmId && (await getDoc(ocIdOf(`osm:relation:${b.osmId}`))) ? [ocIdOf(`osm:relation:${b.osmId}`)] : null);
  if (hit && (await getDoc(hit[0]))) return hit[0];
  // 朋友互傳收下的沒有來源網址（mem://），但岩場 id 就是專案 id：手機裡有這本書的任何一個版本也算收過，不再下載成第二份
  for (const id of known) if (typeof id === 'string' && (await getDoc(id))?.kind === 'set') return id;
  return null;
}
// ── 世界：立體卡堆。國家 → 地區 → 岩場（分層與排列見 world-stacks.mjs）；GPS 與區域只用來分組、排位置，沒有地圖 ──
let worldBooks = [], worldOc = [], worldTree = [], worldHave = { books: new Map(), sources: new Set(), groups: new Set() };
let worldPath = [];   // 目前在哪一層：[]＝國家；[國家]＝地區（岩場不多的國家直接是岩場）；[國家, 地區]＝岩場
let worldRects = [];   // 每一層點進去的那一疊在畫面上的位置：返回時收回到這裡
let worldQuery = '';   // 搜尋字；有字時顯示跨層的搜尋結果
let worldBusy = false, worldShown = 0, worldIo = null, worldSig = '', worldScroll = 0;
const worldNote = (text, busy = false) => { $('worldNote').hidden = !text; $('worldHead').textContent = text; $('worldNote').classList.toggle('busy', busy); };
const worldItems = () => worldItemsFrom(worldBooks, worldOc);   // Guidebook 在前；同一本書的其他版本也各一筆
async function refreshWorldHave() {
  const books = new Map();
  for (const b of worldBooks) { const id = await haveBook(b); if (id) books.set(b.url, id); }
  const sources = (await getMeta('sources')) ?? {};
  worldHave = { books, sources: new Set(Object.values(sources)), groups: new Set(Object.keys(sources)) };
}
const worldGot = (it) => (it.book ? worldHave.books.has(it.book.url) : it.crag.members ? worldHave.groups.has(groupedBookId(it.crag)) : worldHave.sources.has(it.crag.url));
const countryName = (cc) => { try { return new Intl.DisplayNames([langTag()], { type: 'region' }).of(cc.toUpperCase()) ?? cc.toUpperCase(); } catch { return cc.toUpperCase(); } };
const worldTitleOf = (n) => ('cc' in n ? (n.cc ? countryName(n.cc) : T('worldOther')) : (n.name || T('worldOther')));
const worldCols = () => (innerWidth >= 900 ? 5 : innerWidth >= 700 ? 4 : innerWidth >= 480 ? 3 : 2);   // 手機窄螢幕兩欄：名稱才放得下
/** 使用者自己的國家（語系的地區碼；zh-Hant／zh-TW 當台灣）；看不出來就空字串，不重排 */
const homeCc = () => {
  const l = navigator.languages?.[0] || navigator.language || '', m = l.match(/-([A-Za-z]{2})\b/);
  return m ? m[1].toLowerCase() : /^zh-hant/i.test(l) ? 'tw' : '';
};
/** 國家這一層：自己的國家排第一格，其餘照原本（地理）順序往後遞補 */
function homeFirst(nodes, cols) {
  const cc = homeCc();
  if (!cc) return nodes;
  const ord = [...nodes].sort((a, b) => a.row - b.row || a.col - b.col), h = ord.findIndex((n) => n.cc === cc);
  if (h <= 0) return nodes;
  ord.unshift(...ord.splice(h, 1));
  return ord.map((n, k) => ({ ...n, row: Math.floor(k / cols), col: k % cols }));
}
/** 目前這一層：卡堆（nodes，已排好格子）或岩場（items，Guidebook 在前、其餘依名稱） */
function worldLevel() {
  const country = worldTree.find((c) => c.id === worldPath[0]);
  if (!country) { worldPath = []; return { nodes: homeFirst(layout(worldTree, worldCols()), worldCols()), title: '' }; }
  if (worldPath.length === 1 && country.regions) return { nodes: layout(country.regions, worldCols()), title: worldTitleOf(country) };
  const region = country.regions?.find((r) => r.id === worldPath[1]);
  if (worldPath.length > 1 && !region) { worldPath = [country.id]; return worldLevel(); }
  const group = region ?? country, byName = (a, b) => String(a.crag.name).localeCompare(String(b.crag.name), undefined, { numeric: true });
  return { items: [...group.items.filter((i) => i.book), ...group.items.filter((i) => i.crag).sort(byName)], title: region ? `${worldTitleOf(country)} · ${worldTitleOf(region)}` : worldTitleOf(country) };
}
/** 卡堆的底圖：國家是國旗、地區是地圖標記加等高線圈，放大、淡化當背景；每張依名稱換大小、角度和裁切位置，不像同一個樣板 */
const flagOf = (cc) => String.fromCodePoint(...cc.toUpperCase().split('').map((c) => 0x1F1E6 + c.charCodeAt(0) - 65));
// 每個參數各用一個種子把名稱雜湊開（FNV-1a），不同國家的角度、縮放、裁切、模糊才不會一起變
const seeded = (str, seed) => { let h = 2166136261 ^ seed; for (const c of str) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } h ^= h >>> 15; return (Math.imul(h, 2246822507) >>> 0) / 4294967296; };
// 國旗分類與處理規則：每類保住自己的辨識核心，卡片之間只變傾斜、整體縮放、邊緣淡出與輕微模糊。
//   bands   直條三色／雙色（義、法、愛、比、羅…）：整面寬度都在卡片內（縮放上限 85），三條色帶完整，置中、只微傾。
//   stripes 橫條（德、奧、荷、俄、匈…）：每條橫帶的高度都露出（縮放上限 90），左右邊緣可以裁。
//   emblem  中央或偏左的徽章（西、葡、墨、厄…）：徽章是焦點，固定在卡片上方，可放大。
//   crescent 星月（土、突尼西亞、阿爾及利亞、巴基斯坦…）：星月是焦點。
//   cross   十字（瑞士置中；北歐十字的交叉點偏左；英國米字置中）：十字交叉點是焦點。
//   canton  左上角有區塊（美、澳、紐、台、智、中…）：左上區塊是焦點。
//   其他：以中心為焦點、適中縮放。
// 焦點（fx, fy 佔國旗寬高的比例）對到卡片的 tx／ty；s 是縮放範圍（卡片寬的 %），r 是最大傾斜角度
const FLAG_RULES = {
  bands: { f: [0.5, 0.5], s: [72, 85], r: 7, tx: [47, 53], ty: [36, 42] },
  stripes: { f: [0.5, 0.5], s: [78, 90], r: 8, tx: [42, 58], ty: [36, 42] },
  emblem: { f: [0.5, 0.5], s: [95, 125], r: 12, tx: [40, 60], ty: [32, 40] },
  crescent: { f: [0.4, 0.5], s: [95, 125], r: 12, tx: [40, 60], ty: [32, 40] },
  cross: { f: [0.5, 0.5], s: [90, 120], r: 10, tx: [40, 60], ty: [32, 40] },
  canton: { f: [0.22, 0.27], s: [100, 130], r: 12, tx: [35, 55], ty: [30, 38] },
  other: { f: [0.5, 0.5], s: [85, 110], r: 10, tx: [42, 58], ty: [34, 40] },
};
const FLAG_KIND = Object.fromEntries(Object.entries({
  bands: 'it fr ie be ro md td ml gn ci ng pe ca mx', stripes: 'de at nl ru hu bg ee lt lu am co bo ye sl ga ua pl id mc th ir in eg',
  emblem: 'es pt ec ad sm va bt cy hr rs sk si me ar sv gt ni cr', crescent: 'tr tn dz pk az ly mr', cross: 'ch dk se no fi is gb fo ax ge',
  canton: 'us au nz tw cl uy my gr cn lr to ws fj tv mm',
}).flatMap(([k, list]) => list.split(' ').map((cc) => [cc, k])));
// 同類裡焦點不在預設位置的國旗
const FLAG_FOCUS = { es: [0.32, 0.5], pt: [0.4, 0.5], dk: [0.36, 0.5], se: [0.36, 0.5], no: [0.34, 0.5], fi: [0.36, 0.5], is: [0.34, 0.5], fo: [0.34, 0.5], ax: [0.34, 0.5], cl: [0.17, 0.25], uy: [0.17, 0.25], gr: [0.18, 0.25], cn: [0.17, 0.25], ar: [0.5, 0.5], mx: [0.5, 0.5] };
function pileMark(n) {
  const name = worldTitleOf(n), pick = (seed, lo, hi) => lo + seeded(name, seed) * (hi - lo);
  const vars = (k) => `--s:${pick(k + 1, 80, 150).toFixed(0)};--r:${pick(k + 2, -35, 35).toFixed(0)}deg;--x:${pick(k + 3, -40, 30).toFixed(0)}%;--y:${pick(k + 4, -55, 0).toFixed(0)}%;--b:${pick(k + 5, 0, 3.5).toFixed(1)}px`;
  if ('cc' in n) {
    // 國旗：照分類（FLAG_RULES）放，焦點落在卡片上方，只變傾斜、縮放、邊緣淡出（--m）與模糊
    const rule = FLAG_RULES[FLAG_KIND[n.cc]] ?? FLAG_RULES.other, [fx, fy] = FLAG_FOCUS[n.cc] ?? rule.f;
    const m = el('span', { className: 'mark flag', ariaHidden: 'true', textContent: n.cc ? flagOf(n.cc) : '🌐' });
    m.style.cssText = `--s:${pick(1, ...rule.s).toFixed(0)};--r:${pick(2, -rule.r, rule.r).toFixed(0)}deg;--tx:${pick(3, ...rule.tx).toFixed(0)}%;--ty:${pick(4, ...rule.ty).toFixed(0)}%;--fx:${fx * 100}%;--fy:${fy * 100}%;--b:${pick(5, 0, 1).toFixed(1)}px;--o:${pick(6, 0.36, 0.5).toFixed(2)};--m:${pick(7, 60, 85).toFixed(0)}%`;
    return m;
  }
  // 地區：地圖標記墊在最下面當底圖，等高線圈疊在上面，兩層各自的大小位置
  const pin = el('span', { className: 'mark pin', ariaHidden: 'true' }), rings = el('span', { className: 'mark rings', ariaHidden: 'true' });
  pin.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>';
  pin.style.cssText = vars(0);
  rings.style.cssText = vars(10);
  const f = document.createDocumentFragment();
  f.append(pin, rings);
  return f;
}
function worldPile(n) {
  const title = worldTitleOf(n), b = el('button', { className: `pile${n.items.every(worldGot) ? ' got' : ''}`, ariaLabel: `${title}，${T('cragsN', n.count)}` });
  b.style.setProperty('--col', n.col + 1);
  b.style.setProperty('--row', n.row + 1);
  for (let i = layers(n.count); i >= 1; i--) { const s = el('span', { className: 'sheet' }); s.style.setProperty('--i', i); b.append(s); }
  b.append(el('span', { className: 'face' }, pileMark(n), el('b', { textContent: title }), el('small', { textContent: T('cragsN', n.count) })));
  b.onclick = () => worldDown(n, b);
  return b;
}
function worldCard(it) {
  const got = worldGot(it);
  if (it.book) {
    const b = it.book, pack = worldHave.books.get(b.url);
    return card({
      id: it.key, img: b.preview || b.thumb || '', cropTop: true, name: b.name, sub: got ? T('received') : new Date(b.t).toLocaleDateString(langTag()),
      go: true,   // 點卡片就是下載，不另外放「下載」標籤
      onOpen: (pic) => (pack ? openPack(pack, pic) : receive(b.url, { cover: bookCover(b) })),
    });
  }
  // OpenClimbing 的岩場：預覽圖在 climbio/crags 的 openclimbing/；沒有的灰底；名稱、路線數；點了下載或打開
  const crag = it.crag;
  return card({
    id: it.key, img: ocPreview(crag), cropTop: true, name: crag.name, sub: got ? T('received') : (crag.routes ? T('routesN', crag.routes) : ''), go: true,
    onOpen: () => openOpenClimbingCrag(crag),
  });
}
/** 岩場卡片一批 24 張，捲到底才接著放：只載入看得到的圖 */
function fillCrags(grid, items, count = 24) {
  let shown = 0;
  const sentinel = el('div', { className: 'w-more' });
  const next = (n = 24) => {
    for (const it of items.slice(shown, shown + n)) grid.insertBefore(worldCard(it), sentinel);
    shown = Math.min(items.length, shown + n);
    worldShown = shown;
    if (shown >= items.length) { worldIo?.disconnect(); sentinel.remove(); }
  };
  grid.append(sentinel);
  next(Math.max(24, count));
  if (shown < items.length) {
    worldIo = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && next(), { root: $('worldStage'), rootMargin: '600px' });
    worldIo.observe(sentinel);
  }
}
/** 搜尋：依岩場名稱，或所在國家、地區名稱，跨所有層找出岩場（Guidebook 在前、其餘依名稱） */
function worldSearchItems(q) {
  const norm = (s) => String(s ?? '').toLowerCase(), has = (s) => norm(s).includes(q);
  const seen = new Set(), out = [];
  const add = (items, byGroup) => items.forEach((i) => {
    if (seen.has(i.key) || !(byGroup || has(i.book?.name) || has(i.crag?.name))) return;
    seen.add(i.key);
    out.push(i);
  });
  for (const c of worldTree) {
    const cm = has(worldTitleOf(c)) || has(c.cc);
    if (c.regions) for (const r of c.regions) add(r.items, cm || has(worldTitleOf(r)));
    else add(c.items, cm);
  }
  const byName = (a, b) => String((a.book ?? a.crag).name).localeCompare(String((b.book ?? b.crag).name), undefined, { numeric: true });
  return [...out.filter((i) => i.book).sort(byName), ...out.filter((i) => !i.book).sort(byName)];
}
/** 畫目前這一層（keep：重畫但留在原位，已經放出來的岩場卡片數不變） */
function drawWorld({ keep = false } = {}) {
  worldIo?.disconnect();
  const stage = $('worldStage'), q = worldQuery.trim().toLowerCase(), top = stage.scrollTop, count = worldShown;
  $('worldSearchBox').hidden = !worldTree.length;
  $('world').classList.toggle('has-search', !!worldTree.length);
  if (q) {
    const items = worldSearchItems(q), grid = el('div', { className: 'w-crags' });
    worldNote(items.length ? '' : T('noResults'));
    stage.replaceChildren(grid);
    fillCrags(grid, items, keep ? count : 24);
    stage.scrollTop = keep ? top : 0;
    return;
  }
  const lv = worldLevel();
  worldNote(lv.title);
  if (lv.nodes) {
    const grid = el('div', { className: 'w-piles' });
    grid.style.setProperty('--cols', worldCols());
    grid.append(...lv.nodes.map(worldPile));
    stage.replaceChildren(grid);
  } else {
    const grid = el('div', { className: 'w-crags' });
    stage.replaceChildren(grid);
    fillCrags(grid, lv.items, keep ? count : 24);
  }
  stage.scrollTop = keep ? top : 0;
}
const centerOf = (r) => [r.left + r.width / 2, r.top + r.height / 2];
const FLY = 'cubic-bezier(.2, .85, .24, 1)';
/** 新一層從點的那一疊的位置散開到各自的格子 */
function flyIn(els, from) {
  if (reduceMotion() || !from) return;
  const [fx, fy] = centerOf(from);
  els.forEach((e, i) => { const [x, y] = centerOf(e.getBoundingClientRect()); e.animate([{ transform: `translate(${fx - x}px, ${fy - y}px) scale(.5)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, delay: Math.min(i, 8) * 28, easing: FLY, fill: 'backwards' }); });
}
/** 這一層收回到原來那一疊的位置 */
function flyOut(els, to) {
  if (reduceMotion() || !to) return Promise.resolve();
  const [tx, ty] = centerOf(to);
  return Promise.all(els.map((e, i) => { const [x, y] = centerOf(e.getBoundingClientRect()); return e.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${tx - x}px, ${ty - y}px) scale(.5)`, opacity: 0 }], { duration: 260, delay: Math.min(i, 8) * 18, easing: 'ease-in', fill: 'forwards' }).finished; }));
}
const worldEls = () => [...$('worldStage').querySelectorAll('.pile, .card')];
async function worldDown(n, pile) {
  if (worldBusy) return;
  worldBusy = true;
  const rect = pile.getBoundingClientRect();
  if (!reduceMotion()) await Promise.all(worldEls().map((p) => p.animate({ opacity: [1, 0], scale: [1, p === pile ? 1.06 : .92] }, { duration: 160, fill: 'forwards' }).finished));
  worldRects.push(rect);
  worldPath.push(n.id);
  drawWorld();
  flyIn(worldEls().slice(0, 12), rect);
  nav.push({ id: 'world', level: true, onClose: worldUp });   // 每一層一筆返回紀錄：Android 返回鍵、iPhone 邊緣滑動、左上返回都一層一層退
  history.pushState({ rp: nav.length }, '');
  worldBusy = false;
}
let worldTask = Promise.resolve();
/** 返回一層（只由返回紀錄呼叫）：連按幾次也照順序一層一層收回 */
const worldUp = () => (worldTask = worldTask.then(async () => {
  if (!worldPath.length) return;
  await flyOut(worldEls().slice(0, 12), worldRects.pop());
  worldPath.pop();
  drawWorld();
  if (!reduceMotion()) $('worldStage').firstElementChild.animate({ opacity: [0, 1] }, { duration: 180 });
}));
/** 收了岩場之後：已下載的標記更新，位置與捲動不變 */
async function refreshWorld() {
  await refreshWorldHave();
  worldSig = '';
  drawWorld({ keep: true });
}
$('worldSearch').addEventListener('input', () => { worldQuery = $('worldSearch').value; drawWorld(); });
addEventListener('resize', () => { if (!$('world').hidden && worldTree.length && !worldQuery && $('worldStage').querySelector('.w-piles')?.style.getPropertyValue('--cols') !== String(worldCols())) drawWorld(); });
// 頁面藏起來時裡面的捲動位置會掉：再顯示時放回去
$('worldStage').addEventListener('scroll', () => { if (!$('world').hidden) worldScroll = $('worldStage').scrollTop; }, { passive: true });
new MutationObserver(() => { if (!$('world').hidden) $('worldStage').scrollTop = worldScroll; }).observe($('world'), { attributes: true, attributeFilter: ['hidden'] });

async function showWorld(books, ocCrags = [], tree) {
  worldBooks = books;
  worldOc = ocCrags;
  await refreshWorldHave();
  const items = worldItemsFrom(books, ocCrags), sig = `${items.map((i) => i.key).join()}|${items.filter(worldGot).length}`;
  if (!items.length) return worldNote(T('noPublicCrags'));
  if (sig === worldSig) return;   // 沒變就不重畫
  worldSig = sig;
  worldTree = tree ?? mergeWorld(books, ocCrags);   // 樹是地理分組；homeFirst 在 worldLevel 依當前語系套用
  drawWorld({ keep: worldScroll > 0 });
}

/** 點 OpenClimbing 的岩場：已經收過的直接打開；還沒收的先問要不要下載 */
async function openOpenClimbingCrag(crag) {
  const got = await haveBook(crag);
  if (desktop.matches) {
    const links = theCragLinks(crag);
    if (links.length) {
      const answer = await ask({
        title: crag.name,
        body: links.map((link) => el('p', {}, el('a', {
          href: link.url, target: '_blank', rel: 'noopener noreferrer',
          textContent: links.length === 1 ? 'theCrag' : `${link.name} · theCrag`,
        }))),
        buttons: [{ label: T('cancel') }, { label: got ? T('openCrag') : T('download'), value: 'continue', primary: true }],
      });
      if (answer?.button !== 'continue') return;
    }
  }
  if (got) return openPack(got);
  // 不先查：直接進收岩場頁（整頁擋住操作、顯示連線中），資料讀到就問「收下」，沒有 Topo 或失敗就在頁面上說明
  return receive(crag.url, { ask: true, cover: bookCover(crag), ocGroup: crag.members?.length ? crag : null });
}

/**
 * 把讀進來的岩場或 Topo 存進手機（收連結、附近交換共用）：所有檔案和照片，入口照片以組合 id 存；記下網址（分享時直接傳這個網址，不再上傳）。回傳 { root, coverBlob }。
 * 附近交換收到的（mem://）和 ZIP 沒有可以回頭查更新的網址，不記
 */
async function saveGot(got, url) {
  await putDocs([...got.docs.values()]);
  for (const [id, blob] of got.photos) await putPhoto(id, blob);
  // 入口照片：預覽圖的上半裁下來存（岩場頁的橫幅、首頁的卡片用）；沒有預覽圖的資料用第一張照片
  // 裁不出來（瀏覽器解不了大圖）就不存，岩場頁改用第一張照片
  let coverBlob = got.preview ? await cropTop(got.preview, got.root.props.preview).catch((e) => (console.warn('入口照片', e), null)) : null;
  if (!coverBlob && got.photos?.size) {
    coverBlob = [...got.photos.values()].find((b) => b?.type?.startsWith('image/')) ?? null;
  }
  if (coverBlob) {
    await putPhoto(got.root.id, coverBlob);
    forgetUrl(got.root.id);
  }
  const root = got.root.kind === 'layer' ? got.docs.get(got.root.on) ?? got.root : got.root;
  await addToHome(root);
  const sources = (await getMeta('sources')) ?? {};
  const fullUrl = new URL(url, location.href).href;
  if (!/.zip$/i.test(new URL(fullUrl).pathname) && !fullUrl.startsWith('mem:')) {
    await setMeta('sources', { ...sources, [root.id]: fullUrl });
    if (root.kind === 'set') await setMeta('received', { ...((await getMeta('received')) ?? {}), [root.id]: root.t });   // 收下的版本：之後打開時比對有沒有新版
  }
  return { root, coverBlob };
}

// ── 收岩場（開箱）：ask 時先浮上確認卡（一邊問一邊在背景下載）；入口照片從骨架、模糊到清楚，每面岩壁的小圖一張張到齊；揭曉後「看這個岩場」 ──
const BIG_FILE = 2e6;   // 超過 2 MB 的檔案下載時回報自己的進度
/** 清單已有的圖：開箱一開始就先放（模糊），預覽圖到了再換；縮圖直接蓋滿，預覽圖上半是入口照片 */
const bookCover = (b) => (b.thumb ? { src: b.thumb } : b.preview ? { src: b.preview, top: true } : null);
async function receive(url, { ask: confirmFirst = false, at = null, replace = false, ocGroup = null, cover: known = null } = {}) {
  url = new URL(url, location.href).href;
  // 收過的（同一個網址或同一本 Guidebook）直接打開手機裡的，跟世界一樣不重新下載
  const kept = await haveBook(ocGroup ?? { url, id: projectOf(url) });
  const doc = kept && (await getDoc(kept));
  if (doc?.kind === 'set') {
    await openPack(kept, null, { replace });
    if (at && (await getDoc(at))) await openTopo(at);   // 分享的是岩場裡的一張：打開岩場後直接到那張
    return;
  }
  if (doc) return openTopo(kept, null, { replace });
  const ac = new AbortController();
  let closed = false;
  enter('recv', () => {
    closed = true;
    ac.abort();
    $('rvAsk')?.remove();
    render();
  }, {}, { replace });
  const cardBox = $('rvCard'), cover = cardBox.querySelector('img'), pic = $('rvPic');
  cardBox.classList.add('skel');
  cover.hidden = true;
  cover.removeAttribute('src');
  pic.style.cssText = '';
  if (known) {
    Object.assign(pic.style, { backgroundImage: `url(${known.src})`, backgroundSize: known.top ? '100% auto' : 'cover', backgroundPosition: known.top ? 'top' : 'center', filter: 'blur(14px)' });
    cardBox.classList.remove('skel');
  }
  $('rvName').textContent = '';
  $('rvName').classList.remove('drop');
  $('rvCount').textContent = T('connecting');
  $('rvTiles').replaceChildren();
  $('rvFrom').textContent = '';
  $('rvFace').textContent = '';
  $('rvGo').hidden = true;
  cardBox.querySelector('.rv-tape')?.remove();
  const tiles = [];   // 每張照片的小圖格子，依 props.tile 的順序
  let answered;
  const answer = confirmFirst ? new Promise((ok) => (answered = ok)) : Promise.resolve(true);
  // 確認前只讀目錄；按「收下」才下載照片，取消就中止
  const ready = answer.then((ok) => ok || Promise.reject(Object.assign(new Error(''), { name: 'AbortError' })));
  let info = null, preview = null, counted = '', bigPct = -1;   // counted：「第幾個／共幾個」，bigPct：大檔案的進度
  const isOc = isOpenClimbing(url);
  const job = isOc
    ? (ocGroup ? fromOpenClimbingGroup : fromOpenClimbing)(ocGroup ?? url, {
        signal: ac.signal,
        ready,
        onRoot: (root, base) => {
          const from = sourceLabel(root) || credit(root.attribution) || 'OpenClimbing';
          $('rvFrom').textContent = T('sharedNamed', from, root.name);
          $('rvFace').textContent = 'O';
          const n = root.items.filter((i) => i.id && !i.id.includes(':layer:')).length || 1;
          $('rvCount').textContent = `0／${n}`;
          info = { root, from, base, download: true };
          if (confirmFirst) askReceive(info).then(answered);
        },
        onPreview: (blob) => {
          const u = `url(${blobUrl(blob)})`;
          pic.style.backgroundImage = u;
          pic.style.backgroundSize = 'cover';
          pic.style.backgroundPosition = 'center';
          pic.style.filter = 'blur(14px)';
          cardBox.classList.remove('skel');
        },
        onPhoto: (id, blob, n, total) => {
          $('rvCount').textContent = `${n}／${total}`;
          pic.style.filter = `blur(${Math.round(14 * (1 - n / Math.max(total, 1)))}px)`;
          if (!cover.src && blob?.type?.startsWith('image/')) showCover(blobUrl(blob));
        },
        onBytes: (p) => ($('rvCount').textContent = `${Math.round(p * 100)}%`),
      })
    : fromUrl(url, {
        signal: ac.signal,
        ready,
        onRoot: (root, base) => {
          const from = sourceLabel(root) || credit(root.attribution) || root.author || T('someone');
          $('rvFrom').textContent = T(root.kind === 'set' ? 'sharedCrag' : 'sharedTopo', from);
          $('rvFace').textContent = from[0];
          preview = root.props?.preview;
          const n = root.kind === 'set' ? root.props?.preview?.count ?? root.items.filter((i) => i.props?.tile != null).length : 1;
          $('rvCount').textContent = counted = `0／${n}`;
          // 小圖的格子先排好（還是暗的），預覽圖一到就有圖
          if (preview) {
            $('rvTiles').style.gridTemplateColumns = `repeat(${preview.tile.cols}, 1fr)`;
            for (let i = 0; i < n; i++) $('rvTiles').append((tiles[i] = el('span')));
          }
          info = { root, from, base };
          if (confirmFirst) askReceive(info).then(answered);
        },
        // 預覽圖（一張圖：上面入口照片、下面每張照片的小圖）：收到就放上去，不用等照片
        onPreview: (blob) => {
          const url = `url(${blobUrl(blob)})`;
          pic.style.backgroundImage = url;
          pic.style.backgroundSize = '100% auto';   // 入口照片在最上面、寬度蓋滿，剛好是卡片的 4:3
          pic.style.backgroundPosition = 'top';
          pic.style.filter = 'blur(14px)';
          cardBox.classList.remove('skel');
          const p = preview;
          tiles.forEach((t, i) => {
            const col = i % p.tile.cols, row = Math.floor(i / p.tile.cols);
            Object.assign(t.style, {
              backgroundImage: url,
              backgroundSize: `${(p.w / p.tile.w) * 100}% ${(p.h / p.tile.h) * 100}%`,
              backgroundPosition: `${((col * p.tile.w) / (p.w - p.tile.w)) * 100}% ${((p.tile.y + row * p.tile.h) / (p.h - p.tile.h)) * 100}%`,
            });
          });
        },
        // 下載到哪，小圖就依序亮到哪；入口照片越來越清楚
        onPhoto: (id, blob, n, total) => {
          $('rvCount').textContent = counted = `${n}／${total}`;
          bigPct = -1;
          tiles.slice(0, n).forEach((t) => t.classList.add('got'));
          pic.style.filter = `blur(${Math.round(14 * (1 - n / Math.max(total, 1)))}px)`;
          if (!preview && !cover.src && blob?.type.startsWith('image/')) showCover(blobUrl(blob));   // 沒有預覽圖的資料（例如龍洞）：用第一張照片當入口照片（3D 模型不算）
        },
        onBytes: (p) => ($('rvCount').textContent = `${Math.round(p * 100)}%`),
        // 大檔案（3D 模型）下載中：計數後面接它自己的百分比，不然停在最後一個檔案看起來像當掉
        onProgress: (id, got, size) => {
          if (size < BIG_FILE) return;
          const pct = Math.floor((got / size) * 100);
          if (pct !== bigPct) { bigPct = pct; $('rvCount').textContent = `${counted} · ${pct}%`; }
        },
      });
  function showCover(src) {
    cover.src = src;
    cover.hidden = false;
    cover.onload = () => cardBox.classList.remove('skel');
  }
  let got;
  try {
    [got] = await Promise.all([job, ready]);
  } catch (e) {
    if (closed || e.name === 'AbortError') return closed || back();
    $('rvCount').textContent = e.message;
    return;
  }
  if (closed) return;
  // 存起來：所有檔案和照片、入口照片、記下網址；存不進去要說出來，不能停在那裡
  let coverBlob, root;
  try {
    ({ root, coverBlob } = await saveGot(got, url));
    refreshWorld().catch((e) => console.error('更新世界', e));   // 世界裡的「已收下」標記跟著更新
  } catch (e) {
    console.error('收岩場', e);
    $('rvCount').textContent = T('saveFailed', e.message || e.name);
    return;
  }
  if (closed) return;
  navigator.storage?.persist?.().catch(() => {});   // 收進來的岩場是離線用的：要求瀏覽器不要在空間不夠時清掉
  // 揭曉：照片清楚、名稱落下、貼上膠帶、輕震，出現「看這個岩場」
  if (coverBlob) showCover(blobUrl(coverBlob));
  else if ([...got.photos.values()].some((b) => b.type.startsWith('image/'))) showCover(blobUrl([...got.photos.values()].find((b) => b.type.startsWith('image/'))));
  pic.style.filter = '';
  for (const t of tiles) t.classList.add('got');
  $('rvName').textContent = nameOf(root);
  $('rvName').classList.add('drop');
  $('rvCount').textContent = root.kind === 'set' ? `${T('wallsN', wallCount([...got.docs.values()], root))}${got.skipped.length ? T('skippedN', got.skipped.length) : ''}` : '';
  cardBox.append(el('span', { className: 'rv-tape', textContent: T(root.kind === 'set' ? 'tapeCrag' : 'tapeTopo') }));
  if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(15);
  $('rvGo').textContent = T(root.kind === 'set' ? 'openCrag' : 'openTopo');
  $('rvGo').hidden = false;
  $('rvGo').onclick = async () => {
    if (root.kind === 'set') {
      await openPack(root.id, cover, { replace: true, fresh: true });   // 跟點卡片一樣：3D 岩場直接進 3D，其他進岩場頁
      if (at && got.docs.has(at)) await openTopo(at);   // 分享的是岩場裡的一張：打開岩場後直接到那張
    } else openTopo(root.id, cover, { replace: true });
  };
}

/** 確認卡：入口照片、誰分享的、岩場名稱和數量；「收下」才算數（下載已經在背景開始） */
function askReceive({ root, from, download = false }) {   // download：從世界下載（不是朋友分享），標題用「下載 X？」
  return new Promise((ok) => {
    const nodes = root.nodes ?? [], walls = nodes.filter((n) => n.type === 'wall' || n.type === 'sector').length, routes = nodes.filter((n) => n.type === 'route').length;
    const no = el('button', { className: 'btn', textContent: T('cancel') }), yes = el('button', { className: 'btn primary', textContent: T(download ? 'download' : 'accept') });
    const box = el('div', { className: 'rv-ask', id: 'rvAsk' }, el('div', { className: 'sheet' },
      el('b', { textContent: download ? T('downloadAsk', nameOf(root)) : T(root.kind === 'set' ? 'sharedCrag' : 'sharedTopo', from) }),
      el('div', { textContent: [nameOf(root), walls ? T('wallsN', walls) : '', routes ? T('routesN', routes) : ''].filter(Boolean).join(' · ') }),
      el('div', { className: 'acts' }, no, yes)));
    const done = (v) => {
      box.remove();
      ok(v);
    };
    no.onclick = () => done(false);
    yes.onclick = () => done(true);
    box.onclick = (e) => e.target === box && done(false);
    document.body.append(box);
  });
}

// ── 分享：岩場、Topo 給一個連結；收來的岩場直接傳原本的網址，自己的打包傳上主網 ──
/** 發佈的岩場（/p/<專案 id>/index.json）用固定的分享網址 /p/<專案 id>，發佈完就有、不用登入；其他的傳 /?topo=<網址> */
/** at：收的人打開後直接到岩場裡的這張照片 */
async function shareLink(src, at) {
  const target = `/?topo=${encodeURIComponent(src)}${at ? `&at=${encodeURIComponent(at)}` : ''}`;
  // 公開的岩場（網站的 /p/<id>/index.json，或開放資料集 climbio/crags 裡的 crags/<id>/index.json）：傳短的 /p/<id>
  const published = /^https:\/\/(?:[^/]+\/p|huggingface\.co\/datasets\/climbio\/crags\/resolve\/main\/crags)\/([0-9a-z]{16})\/index\.json$/.exec(src);
  const link = published ? `${location.origin}/p/${published[1]}${at ? `?at=${encodeURIComponent(at)}` : ''}` : location.origin + target;
  const how = await sendLink(link);
  if (how !== 'cancelled') toast(T(how === 'shared' ? 'linkShared' : 'linkCopied'));
}

/** 要傳出去的檔案：一個岩場或一張 Topo 連同它的照片、圖層、節點（分享連結、ZIP、附近交換共用） */
async function bundleOf(id, doc, own = false) {
  return toFiles(id, {
    own,
    docOf: getDoc,
    photoOf: getPhoto,
    layersOn: async (viewId) => layersOn(await allDocs(), viewId),
    nodesOf: async () => new Map((await allDocs()).filter((d) => d.kind === 'set').flatMap((d) => d.nodes ?? []).map((n) => [n.id, n])),
    wrap: (docs) => check({ ...newSet(nameOf(doc), doc.author ?? '我'), items: docs.map((d) => ({ href: `${d.id}.json`, id: d.id })) }),
  });
}

/**
 * 附近交換：同一個網路的朋友互相看得到，確認後自由挑岩場、Topo 互傳（appkit/nearby.js）。
 * 收下是安靜的：存進手機就好（跟收連結同一個 saveGot），回首頁看得到
 */
const nearbyAdapter = {
  app: 'redpoint', label: '紅點貓', suggested: async () => (await getMeta('author')) || '',
    // 朋友互傳可手動選擇個人收藏；只在「我的裝置」自動同步攀登紀錄，且兩種模式都不會公開資料。
    list: async (trusted) => {
      const [home, docs] = [await getDoc(state.home), await allDocs()];
      const picked = home.items.map((i) => docs.find((d) => d.id === itemId(i)))
        .filter((d) => d && (d.kind === 'set' || (d.kind === 'view' && d.surface === 'photo')))
        .reverse();
      const items = await Promise.all(picked.map(async (d) => ({ id: d.id, name: nameOf(d), img: (await nearbyThumbUrl(d.id).catch(() => '')) || (d.kind === 'set' ? await coverUrl(docs, flatSet(docs, d)) : await photoUrl(d)) || '', sub: d.kind === 'set' ? T('crag') : 'Topo', v: [String(d.t ?? 0)], t: d.t ?? 0 })));
      // 攀登記錄（整份）：自己的裝置之間一定同步，不用對方有那個岩場，直接備份到自己的電腦；內容一樣（雜湊相同）就不再傳
      const all = trusted ? logsAll() : {};
      return Object.keys(all).length ? [...items, { id: LOGS_ID, name: T('climbLog'), sub: '', v: [logsHash(all)] }] : items;
    },
    pack: async (id, trusted) => {
      if (id === LOGS_ID) return { entry: 'logs-all.json', files: [{ path: 'logs-all.json', bytes: new TextEncoder().encode(JSON.stringify(logsAll())) }] };
      const { files } = await bundleOf(id, await getDoc(id), true); // 朋友互傳也包含個人收藏；公開分享仍須通過 shareable 規則
      const out = await Promise.all(files.map(async (f) => ({ path: f.name, bytes: new Uint8Array(await f.blob.arrayBuffer()) })));
      const log = trusted ? logsRead()[id] : null;
      if (log) out.push({ path: 'logs.json', bytes: new TextEncoder().encode(JSON.stringify({ id, log })) });
      return { entry: 'index.json', files: out };
    },
    take: async (b, trusted) => {
      if (b.entry === 'logs-all.json') {
        if (!trusted) throw new Error('not trusted');
        const all = JSON.parse(await (await ShareTools.open(b.url)).text());
        for (const [id, log] of Object.entries(all ?? {})) mergeLog({ id, log });
        return;
      }
      await saveGot(await fromUrl(b.url), b.url);
      if (trusted && (b.files ?? []).includes('logs.json')) mergeLog(JSON.parse(await (await ShareTools.open(b.url.replace(/[^/]+$/, 'logs.json'))).text()));
      await render();
    },
};
const openNearby = (mode = 'send') => AppKit.nearby.start(mode, nearbyAdapter);   // 'send'：傳給別人；'devices'：我的裝置（配對、自動同步）

/** 配對的裝置傳來的攀爬紀錄：只增不減（狀態取高的、完攀次數取多的、日期取最早與最近的；刪除不同步） */
function mergeLog({ id, log }) {
  if (typeof id !== 'string' || !log || typeof log.r !== 'object') return;
  const logs = logsRead(), e = logs[id] ?? { t: 0, r: {} };
  for (const [rid, v] of Object.entries(log.r)) {
    if (!Array.isArray(v) || !Number.isFinite(v[0])) continue;
    const o = e.r[rid];
    e.r[rid] = o ? [Math.max(o[0], v[0]), Math.max(o[1] ?? 0, v[1] ?? 0), [o[2], v[2]].filter(Boolean).sort((a, b) => a - b)[0] ?? 0, Math.max(o[3] ?? 0, v[3] ?? 0)] : [v[0], v[1] ?? 0, v[2] ?? 0, v[3] ?? 0];
  }
  e.t = Math.max(e.t ?? 0, log.t ?? 0, Date.now());
  logs[id] = e;
  AppKit.store.set(LOG_KEY, logs);
}

// ── 分享一張 Topo：圖片（版面跟岩點貓同一套，appkit/share-image.js）或連結。有點選路線就以那條路線為主，沒有就是整張 Topo ──
const SHARE_PX = 2400;   // 底圖長邊上限
const SHARE_FONT = 'system-ui, -apple-system, "SF Pro Text", "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif';
/** 底圖：照片＋Topo 的線與編號牌（跟畫面上看到的同一份 renderLines）；回 { size, canvas, focus }，focus 是路線佔的範圍（底圖像素） */
async function topoBase(view, routes, routeId) {
  const img = new Image();
  img.src = view.href;
  await img.decode();
  const s = Math.min(1, SHARE_PX / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
  const k = Math.max(view.w, view.h) / 900;   // 一個螢幕像素＝幾個照片像素
  const lines = renderLines(routes, { photo: { w: view.w, h: view.h }, k, highlight: routeId || undefined, solo: !!routeId, ui: 1.5, naturalEnds: true });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${view.w} ${view.h}"><style>${TOPO_CSS}text{font-family:${SHARE_FONT}}</style><g class="tk">${lines}</g></svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const layer = new Image();
  layer.src = url;
  await layer.decode().finally(() => URL.revokeObjectURL(url));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  g.drawImage(img, 0, 0, w, h);
  g.drawImage(layer, 0, 0, w, h);
  // 路線的範圍：沿著線每隔一小段放一個框（含牌子的留白）
  const line = routes.find((r) => r.id === routeId)?.line ?? [], f = w / view.w, step = Math.max(view.w, view.h) * 0.02, half = Math.max(view.w, view.h) * 0.03 * f, focus = [];
  line.forEach(([x, y], i) => {
    const prev = line[i - 1], n = prev ? Math.max(1, Math.ceil(Math.hypot(x - prev[0], y - prev[1]) / step)) : 1;
    for (let j = 1; j <= n; j++) {
      const cx = (prev ? prev[0] + ((x - prev[0]) * j) / n : x) * f, cy = (prev ? prev[1] + ((y - prev[1]) * j) / n : y) * f;
      focus.push({ x0: cx - half, y0: cy - half, x1: cx + half, y1: cy + half });
    }
  });
  return { size: { w, h }, canvas, focus };
}

/** 一張 Topo 的分享圖：有指定路線就是那條路線的難度與名稱，沒有就是岩壁名稱 */
async function topoShareImage(viewId, routeId) {
  const { view } = await topoData(viewId), routes = topoEl.viewer?.routes ?? [], route = routes.find((r) => r.id === routeId);
  const mark = new Image();
  mark.src = '../icons/cats/redpoint-cat.svg';
  await mark.decode();
  const base = await topoBase(view, routes, route?.id);
  return AppKit.shareImage.make({
    size: base.size, base: base.canvas, focus: base.focus, grade: route?.grade ?? '', name: route ? route.name ?? '' : nameOf(view),
    by: credit(view.attribution), fmt: 'story', logo: AppKit.shareImage.imageLogo(mark), lang: AppKit.i18n.lang,
  });
}

async function shareTopoMenu() {
  const id = state.topo;
  let url = '';
  try {
    UI.toast(T('shareImage'), { busy: true });
    const { blob, name } = await topoShareImage(id, $('view').getAttribute('highlight') ?? '');
    UI.hideToast();
    const file = new File([blob], name, { type: 'image/jpeg' });
    url = URL.createObjectURL(blob);
    const how = await ask({ body: [el('img', { src: url, alt: '', style: 'display:block;max-width:100%;max-height:60vh;margin:0 auto;border-radius:12px' })],
      buttons: [{ label: T('cancel') }, { label: T('shareImage'), value: 'image' }, { label: T('shareLink'), value: 'link', primary: true }] });
    if (how?.button === 'image') { if ((await AppKit.share.sendFile(file, { strictGesture: true })) === 'blocked') toast(T('shareReady'), 4000); }
    else if (how?.button === 'link') await share(id);
  } catch (e) {
    UI.hideToast();
    toast(e.message, 5000);
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

async function share(id) {
  try {
    const doc = await getDoc(id), sources = (await getMeta('sources')) ?? {};
    if (sources[id]) return await shareLink(sources[id]);
    // 收來的岩場裡的照片：傳岩場原本的網址，打開直接到這張（不另外打包上傳；只有自己拍的、還沒在網路上的才上傳）
    const home = (await allDocs()).find((d) => d.kind === 'set' && sources[d.id] && d.items.some((i) => itemId(i) === id));
    if (home) return await shareLink(sources[home.id], id);
    // 已經公開的不再上傳：自己分享過的（記著專案 id），或匯入、附近交換收來的（組合 id 就是原專案 id，公開資料集已有）。沒有編輯功能，重傳只會多出一樣的副本
    const shared = (await getMeta('shared')) ?? {};
    if (shared[id]) return await shareLink(`${location.origin}/p/${shared[id]}/index.json`);
    if (Backend().caps.share && navigator.onLine !== false) {
      const pub = new URL(`/p/${id}/index.json`, location.href).href;
      const res = await ShareTools.open(pub, { cache: 'no-cache' }).catch(() => null), head = res?.ok ? await res.json().catch(() => null) : null;
      if (head?.id === id) return await shareLink(pub);
    }
    const { files, count, left } = await bundleOf(id, doc);
    if (Backend().caps.share) {
      // 直接公開（授權寫在條款）：署名用目前的暱稱，沒設定就用岩場的作者，再沒有就不署名
      const signature = AppKit.nearby.nickname() || (await getMeta('author')) || '';
      const signedFiles = await Promise.all(files.map(async file => {
        if (!/\.json$/i.test(file.name)) return file;
        const data = JSON.parse(await file.blob.text());
        if (file.name !== 'index.json' && data.origin !== 'self') return file;
        return { ...file, blob: new Blob([JSON.stringify({ ...data, author: signature })], { type: 'application/json' }) };
      }));
      UI.toast(T('uploading'), { busy: true });
      const url = await datasetShare(id, nameOf(doc), signedFiles, signature);
      UI.hideToast();
      await setMeta('sources', { ...sources, [id]: url });
      if (left) toast(T('leftLocal', left), 4000);
      return await shareLink(url);
    }
    const how = await send(await AppKit.files.zip(files), `${AppKit.files.safeName(nameOf(doc))}.zip`, nameOf(doc));
    if (how !== 'cancelled') toast(T('zipDone', how, count, left), 4000);
  } catch (e) {
    UI.hideToast();
    toast(e.code === 'offline' ? T('netOffline') : e.message, 5000);
  }
}

/**
 * 把打包好的檔案公開放進開放資料集 climbio/crags（studio/dataset-publish.js），回網址（/p/<專案 id>/index.json，讀的人從資料集讀）；出現在「世界」。
 * 每次分享是新的專案 id（origin 指到上一次分享的），沒改的照片 Hub 已經有、不重傳
 */
async function datasetShare(id, name, files, signature) {
  const B = Backend(), shared = (await getMeta('shared')) ?? {}, last = shared[id];   // last：這一個上次分享出去的專案 id
  const pack = AppKit.files.rid(16);   // 沒有擁有者：已發佈的 id 不能再改，每次分享是新的專案，origin 指到上一次（沒有就是第一次）
  const list = await Promise.all(files.map(async (f) => ({ path: f.name, bytes: new Uint8Array(await f.blob.arrayBuffer()) })));
  const res = await publishDataset({
    id: pack, name, files: list, meta: { attribution: signature, ...(last ? { origin: last } : {}) }, service: datasetOps((body) => B.projectCall(body.op, body)),
    onProgress: (n, total) => total && UI.toast(T('uploadingN', n, total), { busy: true }),
  });
  await setMeta('shared', { ...shared, [id]: res.project });
  return `${location.origin}/p/${res.project}/index.json`;
}

// ── 看與編輯一張 Topo ──
const topoEl = $('view');
let topoNodes = new Map();   // 目前這張 Topo 的路線節點（路線說明從這裡讀）

// ── 攀爬紀錄：紅點貓自己一份（localStorage `redpoint.log`；手動備份／復原），格式和岩點貓的一樣（docs/app.md「攀爬紀錄」），不併進岩點貓的統計 ──
// { 岩場（組合）id: { t: 修改時間, r: { 路線 id: [1 爬了／2 完攀, 完攀次數, 第一次完攀日, 最近一次日] } } }；日＝從 2024-01-01 起算的天數；沒爬就沒有這一筆
const LOG_KEY = 'redpoint.log', DAY0 = Date.UTC(2024, 0, 1);
const logsRead = () => AppKit.store.get(LOG_KEY, {});
const LOGS_ID = '__logs__';
/** 整份攀登記錄（只要有路線紀錄的岩場）；雜湊只看路線紀錄本身，合併時改的修改時間不算，兩台合成一樣就不再互傳 */
const logsAll = () => Object.fromEntries(Object.entries(logsRead()).filter(([, e]) => e && e.r && Object.keys(e.r).length));
const logsHash = (all) => { const j = JSON.stringify(Object.keys(all).sort().map((id) => [id, Object.keys(all[id].r).sort().map((r) => [r, all[id].r[r]])])); let h = 5381; for (let i = 0; i < j.length; i++) h = ((h * 33) ^ j.charCodeAt(i)) >>> 0; return `${j.length}:${h}`; };
/** 路線的狀態：0 沒爬、1 爬了、2 完攀 */
const tickOf = (wid, rid) => Math.min(2, logsRead()[tickOwner.get(rid) ?? wid]?.r[rid]?.[0] ?? 0);

/** 設一條路線的狀態（0 沒爬、1 爬了、2 完攀）。只存在這台，手動備份保存 */
function setTick(wid, rid, s) {
  wid = tickOwner.get(rid) ?? wid;
  const logs = logsRead(), e = logs[wid] ?? { t: 0, r: {} }, v = e.r[rid], d = Math.floor((Date.now() - new Date().getTimezoneOffset() * 6e4 - DAY0) / 864e5);
  if (s === 0) delete e.r[rid];
  else if (s === 2) e.r[rid] = [2, Math.max(1, v?.[1] ?? 0), v?.[2] || d, d];
  else e.r[rid] = [1, 0, 0, d];
  e.t = Date.now();
  logs[wid] = e;
  if (!AppKit.store.set(LOG_KEY, logs)) throw new Error(T('logSaveFailed'));
}


const pickText = (v) => (v && typeof v === 'object' ? v['zh-Hant'] ?? v['zh-TW'] ?? v.zh ?? Object.values(v)[0] : v) || '';
const styleName = (style) => (['sport', 'trad', 'boulder', 'toprope', 'mixed', 'aid'].includes(style) ? T(`style_${style}`) : undefined);
const gradeText = (g) => (g && typeof g === 'object' ? Object.values(g)[0] : g) || '';
// theCrag 顯示 0–3 星；目前收藏轉換器把無星與 0 星都當成缺值，暫不顯示 0。
// 沿用龍洞的金色實心／灰色空心星星樣式，但保留來源原本的三顆星尺度。
const starBadge = (props) => {
  const raw = props?.['thecrag:stars'];
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0 || raw > 3) return null;
  // 僅供顯示：theCrag 的三顆星比例換算為五顆星，不改動原始收藏欄位。
  const score = raw * 5 / 3;
  const fill = el('span', { className: 'filled', textContent: '★★★★★' });
  fill.style.width = `${(raw * 100 / 3).toFixed(2)}%`;
  const badge = el('span', { className: 'stars', title: T('ratingTitle', score.toFixed(1)) },
    el('span', { className: 'star-scale' },
      el('span', { className: 'dim', textContent: '★★★★★' }),
      fill));
  badge.setAttribute('role', 'img');
  badge.setAttribute('aria-label', T('ratingAria', score.toFixed(1)));
  return badge;
};

// ── 路線清單（岩場頁右下的爪印）：一顆石頭一段，一列一條路線；爪印按一下換狀態 沒爬 → 完攀 → 爬了 → 沒爬，一次記完整天 ──
const TICK_NEXT = [2, 0, 1];
const tickWord = (s) => (s ? T(`tick${s}`) : '');
let tickFilter = -1;
async function openTicks() {
  tickFilter = -1;
  await fillTicks();
  await enter('ticks', () => renderPack());
}
async function fillTicks() {
  const docs = await allDocs(), found = docs.find((d) => d.id === state.pack);
  if (!found) return;
  const set = flatSet(docs, found), { rows, all } = routeRows(docs, set, {
    filter: tickFilter,
    go: (r, view) => (view ? openTopo(view, null, { route: r.id }) : toast(T('noTopoYet'), 2500)),   // 還沒畫在照片上的路線（只有路線書的資料）：照樣列出，點了沒有 Topo 可開   // 還沒畫在照片上的路線（只有路線書的資料）：照樣列出，點了沒有 Topo 可開
    ticked: () => { clearTimeout(fillTicks.t); fillTicks.t = setTimeout(() => updateTickSum(set.id, all), 0); },
  });
  const count = [0, 0, 0];
  for (const r of all) count[tickOf(set.id, r.id)]++;
  $('ticksTitle').textContent = nameOf(set);
  $('ticksSum').replaceChildren(...[2, 1, 0].map((s) => {
    const b = el('button', { className: `s${s}` }, el('b', { textContent: count[s] }), el('span', { textContent: T(`tick${s}`) }));
    b.setAttribute('aria-pressed', String(tickFilter === s));
    b.onclick = () => { tickFilter = tickFilter === s ? -1 : s; fillTicks(); };
    return b;
  }));
  $('ticksList').replaceChildren(...rows);
}
/**
 * 路線清單的列（路線清單頁、3D 岩場的清單共用）：一面岩壁一段（還沒有 Topo 的也列：清單要跟路線書一樣完整），照分區、岩壁的 order 排；
 * go(路線, 畫著它的 Topo id)：點一列；ticked()：按了爪印。回傳 { rows, all（所有路線）}
 */
function routeRows(docs, set, { filter = -1, go, ticked }) {
  const crag = cragOf(docs, set), wid = set.id;
  const where = new Map(), label = new Map();   // 路線 → 畫在哪張 Topo（點了打開那張、亮那條）、Topo 上的編號（跟照片上的牌子一樣）
  for (const id of crag.order) {
    for (const r of routeIds(docs, id)) if (!where.has(r)) where.set(r, id);
    for (const l of layersOn(docs, id)) for (const m of l.marks ?? []) if (isRouteMark(l, m) && m.props?.label != null && !label.has(m.node)) label.set(m.node, String(m.props.label));
  }
  const num = (r) => Number(label.get(r.id) ?? r.props?.order ?? Infinity);
  const by = new Map();
  for (const n of crag.nodes.values()) if (n.type === 'route') (by.get(n.parent) ?? by.set(n.parent, []).get(n.parent)).push(n);
  const ord = (n) => n?.props?.order ?? Infinity;
  const walls = [...by.keys()].map((id) => crag.nodes.get(id)).filter((n) => n && ['wall', 'sector', 'crag', 'area'].includes(n.type))
    .sort((a, b) => ord(crag.nodes.get(a.parent)) - ord(crag.nodes.get(b.parent)) || ord(a) - ord(b))
    .map((node) => ({ node, routes: by.get(node.id) }));
  const rows = [];
  for (const w of walls) {
    const list = w.routes.filter((r) => filter < 0 || tickOf(wid, r.id) === filter).sort((a, b) => num(a) - num(b));
    if (!list.length) continue;
    const head = el('div', { className: 'tk-wall' }, el('b', { textContent: nameOf(w.node) }), el('span', { textContent: T('routesShort', w.routes.length) }));
    head.dataset.id = w.node.id;
    rows.push(head);
    for (const r of list) {
      const s = tickOf(wid, r.id), p = r.props ?? {};
      const paw = el('button', { className: 'tk-paw paw', innerHTML: '<svg><use href="#i-paw"/></svg>' }, el('small', { textContent: tickWord(s) }));
      paw.dataset.s = s;
      paw.setAttribute('aria-label', T('tickAria', nameOf(r), T(`tick${s}`)));
      paw.onclick = () => {
        const next = TICK_NEXT[tickOf(wid, r.id)];
        try { setTick(wid, r.id, next); } catch (e) { return toast(e.message, 5000); }
        paw.dataset.s = next;
        paw.querySelector('small').textContent = tickWord(next);
        paw.setAttribute('aria-label', T('tickAria', nameOf(r), T(`tick${next}`)));
        paw.classList.remove('stamp');
        void paw.offsetWidth;
        if (next) paw.classList.add('stamp');
        navigator.vibrate?.(next === 2 ? 18 : 6);
        ticked?.();
      };
      const btn = el('button', { className: 'go' },
        label.has(r.id) ? el('span', { className: 'no', textContent: label.get(r.id) }) : null,
        // 只留名稱、類型與 bolt 數；說明和首攀在 Topo 裡看
        el('span', { className: 'tx' }, el('b', { textContent: nameOf(r) }),
          el('span', { textContent: [styleName(p.style), p.length ? `${p.length} m` : '', p.bolts ? T('boltsN', p.bolts) : ''].filter(Boolean).join(' · ') }),
          starBadge(p)),
        el('span', { className: 'gr', textContent: gradeText(p.grade ?? p['thecrag:grade']) }));
      btn.onclick = () => go(r, where.get(r.id));
      rows.push(el('div', { className: 'tk-row' }, btn, paw));
    }
  }
  return { rows, all: walls.flatMap((w) => w.routes) };
}
/** 只更新上面的數字（按爪印時不重排整個清單，列不會跳） */
function updateTickSum(wid, all) {
  const count = [0, 0, 0];
  for (const r of all) count[tickOf(wid, r.id)]++;
  $('ticksSum').querySelectorAll('button').forEach((b) => (b.querySelector('b').textContent = count[+b.className.slice(1)]));
}

// ── Topo：一次看所有路線（編號＋難度最優先、空間夠才有名稱、放大才有 bolt）；點路線浮出說明；左右滑換這個岩場的前後一張 ──
function hidePop() {
  topoEl.removeAttribute('highlight');
  $('topoPop').hidden = true;
}
function showPop(id) {
  const r = topoEl.viewer?.routes.find((x) => x.id === id);
  if (!r) return hidePop();
  topoEl.setAttribute('highlight', id);
  fillPop($('topoPop'), r, topoNodes.get(id));
}
/** 路線說明（照片 Topo、3D 共用）：r 是 TopoKit 的路線（編號、難度、名稱），n 是路線節點 */
function fillPop(pop, r, n) {
  const p = n?.props ?? {}, stars = starBadge(p);
  const tags = [styleName(p.style), p.length ? `${p.length} m` : '', p.bolts ? T('boltsN', p.bolts) : '', p.fa ? T('firstAscent', p.fa) : ''].filter(Boolean);
  pop.replaceChildren(...[   // 沒有的部分是 null：replaceChildren 會把 null 當成文字，先拿掉
    el('div', { className: 'hd' }, r.label != null ? el('span', { className: 'no', textContent: r.label }) : null, r.grade ? el('span', { className: 'gr', textContent: r.grade }) : null, el('span', { className: 'nm', textContent: r.name ?? '' })),
    stars ? el('div', { className: 'rating' }, stars) : null,
    tags.length ? el('div', { className: 'tags' }, ...tags.map((t) => el('span', { textContent: t }))) : null,
    pickText(p.description) ? el('p', { textContent: pickText(p.description) }) : null,
  ].filter(Boolean));
  pop.hidden = false;
  pop.style.animation = 'none';
  void pop.offsetWidth;
  pop.style.animation = '';
}

// ── 岩場地圖（mapkit 的向量地圖）：點一面岩壁、一顆石頭，打開它的第一張 Topo ──
async function openMap(set, crag) {
  const map = crag.maps[0], walls = new Map(crag.sections.flatMap((s) => s.walls).map((w) => [w.node.id, w]));
  $('cmapName').querySelector('b').textContent = nameOf(set);
  $('cmapSketch').hidden = !crag.overview.length;
  $('cmapSketch').onclick = () => openTopo(crag.overview[0].id);
  const el = $('cmapView');
  mapPick = null;
  // 移動範圍往外放寬（每邊放寬整個範圍的長邊）：直式手機要能看到整個岩場，不然範圍的高度不夠，地圖只能放大看一部分
  const b = map.props?.bounds, pad = b ? Math.max(b[2] - b[0], b[3] - b[1]) : 0;
  const view = { ...map, ...(b ? { props: { ...map.props, bounds: [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad] } } : {}) };
  if (map.attribution === set.attribution) view.attribution = '';   // 岩場作者自己畫的地圖：署名岩場頁已經有，地圖上不重複
  await enter('cmap', () => renderPack(), { prepare: () => { el.data = { view, layers: [], nodes: set.nodes ?? [] }; } });
  // 岩場作者發佈時附上的底圖（航照、等高線的圖磚，跟資料放在一起）：照收的網址畫
  const packed = map.props?.tiles, base = ((await getMeta('sources')) ?? {})[set.id];
  if (packed?.length && base && el.viewer) {
    const dir = base.replace(/[^/]*$/, '');
    el.viewer.set({
      tiles: Object.fromEntries(packed.map((t) => [t.kind, { url: dir + t.href, minZ: t.minZ, maxZ: t.maxZ, have: new Set(t.have), credit: t.credit }])),
      basemap: Object.fromEntries(packed.map((t) => [t.kind, true])),
      attribution: [...(view.attribution ? [{ text: view.attribution }] : []), ...[...new Set(packed.map((t) => t.credit))].map((text) => ({ text }))],
    });
  }
  // 每次打開都從看得到整個岩場開始（頁面顯示後才有大小）
  const h = map.props?.home;
  if (h) el.viewer?.focus({ points: [[h[0], h[1]], [h[2], h[3]]], tight: true });
  mapPick = (node) => {
    const w = walls.get(node);
    if (w) openTopo(w.views[0].id);
    else if (crag.nodes.get(node)) toast(T('noTopoFor', nameOf(crag.nodes.get(node))), 3000);
  };
}
let mapPick = null;

// ── 交通：交通圖（purpose: approach 的地圖畫面）、說明、導航到岩場與交通圖上有名稱的停車場 ──
/** Google 地圖導航到這個位置（經度、緯度） */
const navTo = (lng, lat) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
/** 節點的 geo 是 Point 才有導航網址 */
const navUrl = (node) => (node?.geo?.type === 'Point' ? navTo(...node.geo.coordinates) : '');

/** 交通說明加上封岩／通行限制（thecrag:access）與警示、救援（description）：安全與法規資訊不能只收不顯 */
function wayInfo(node) {
  const p = node?.props ?? {}, t = (v) => (v ? pickText(v) : '');
  return [t(p.approach), p['thecrag:access'] && `${T('wayAccess')}：${t(p['thecrag:access'])}`, p.description && `${T('wayWarn')}：${t(p.description)}`].filter(Boolean).join('\n\n');
}

/** 沒有交通圖：說明對話框；岩場有位置時「導航」直接開 Google 地圖 */
async function showWay(node) {
  const title = T('howToGet', nameOf(node)), text = wayInfo(node), url = navUrl(node);
  if (!url) return UI.alert(text, { title });
  if (await UI.confirm(text, { title, ok: T('navigateTo', nameOf(node)) })) window.open(url, '_blank', 'noopener,noreferrer');
}

async function openWay(set, map, way) {
  $('wayName').querySelector('b').textContent = T('howToGet', nameOf(way));
  $('wayText').textContent = wayInfo(way);
  $('wayText').style.whiteSpace = 'pre-line';
  const at = new Map((map.marks ?? []).filter((m) => m.node && m.geometry?.type === 'Point').map((m) => [m.node, m.geometry.coordinates]));
  const spots = (map.nodes ?? []).filter((n) => n.type === 'poi' && n.props?.kind === 'parking' && n.name && at.has(n.id));
  const targets = [...(navUrl(way) ? [[way, navUrl(way)]] : []), ...spots.map((n) => [n, navTo(...at.get(n.id))])];
  $('wayNav').replaceChildren(...targets.map(([n, href]) => {
    const a = el('a', { href, target: '_blank', rel: 'noopener noreferrer' });
    a.innerHTML = '<svg aria-hidden="true"><use href="#i-nav"/></svg>';
    a.append(el('span', { textContent: T('navigateTo', nameOf(n)) }));
    return a;
  }));
  const mapEl = $('wayView');
  await enter('way', () => renderPack(), { prepare: () => { mapEl.data = { view: map, layers: [], nodes: set.nodes ?? [] }; } });
  const h = map.props?.home;
  if (h) mapEl.viewer?.focus({ points: [[h[0], h[1]], [h[2], h[3]]], tight: true });
}
$('cmapView').addEventListener('pick', (e) => mapPick?.(e.detail.node));
/** 這張 Topo 在岩場的哪裡：石頭名稱、第幾張；前後一張是誰（照岩場頁的順序） */
async function topoPlace(viewId) {
  if (!state.pack) return null;
  const docs = await allDocs(), found = docs.find((d) => d.id === state.pack);
  if (!found) return null;
  const set = flatSet(docs, found);
  const crag = cragOf(docs, set), o = crag.overview.findIndex((v) => v.id === viewId);
  // 區域照片：在區域照片之間左右滑
  if (o >= 0) return { order: crag.overview.map((v) => v.id), i: o, wall: { node: { name: T('areaPhotos') }, views: crag.overview }, k: o };
  const i = crag.order.indexOf(viewId);
  if (i < 0) return null;
  const wall = crag.sections.flatMap((s) => s.walls).find((w) => w.views.some((v) => v.id === viewId));
  return { order: crag.order, i, wall, k: wall ? wall.views.findIndex((v) => v.id === viewId) : 0 };
}
async function showWhere(viewId, bump) {
  const at = await topoPlace(viewId), box = $('topoWhere');
  $('topoPrev').hidden = !at?.order[at.i - 1];
  $('topoNext').hidden = !at?.order[at.i + 1];
  box.hidden = !at?.wall;
  if (!at?.wall) return;
  box.querySelector('b').textContent = nameOf(at.wall.node);
  box.querySelector('span').textContent = at.wall.views.length > 1 ? `${at.k + 1}/${at.wall.views.length}` : '';
  if (bump) {
    box.classList.remove('bump');
    void box.offsetWidth;
    box.classList.add('bump');
  }
}

/** 左右滑：換成岩場裡的前一張、後一張；返回時縮回現在這張所在的石頭卡片 */
async function stepTopo(step) {
  const at = await topoPlace(state.topo), next = at?.order[at.i + step];
  if (!next) return;
  if (await photoMissing(await getDoc(next))) return void toast(T('photoPending'), 3000);
  state.topo = next;
  hidePop();
  const view = await getDoc(next), data = await topoData(next);
  topoEl.data = data;
  topoEl.classList.remove('slide-l', 'slide-r');
  void topoEl.offsetWidth;
  topoEl.classList.add(step > 0 ? 'slide-l' : 'slide-r');
  const top = nav.at(-1), wall = (await topoPlace(next))?.wall;
  if (top?.id === 'topo' && top.zoom) {
    top.zoom.src = data.view.href;
    top.zoom.rect = () => photoRect(topoEl, view.w, view.h);
    if (wall?.node.id && document.querySelector(`#packCards .card[data-id="${wall.node.id}"]`)) top.zoom.card = cardOf(document.querySelector(`#packCards .card[data-id="${wall.node.id}"] .pic`));
  }
  await showWhere(next, true);   // 最後才換「幾分之幾」：看到它換了，這次換張就做完了
}

async function topoData(viewId) {
  const docs = await allDocs();
  const view = docs.find((d) => d.id === viewId);
  const layers = layersOn(docs, viewId);
  const nodes = docs.filter((d) => d.kind === 'set').flatMap((s) => s.nodes ?? []);
  topoNodes = new Map(nodes.map((n) => [n.id, n]));
  return { view: { ...view, href: await photoUrl(view) }, layers, nodes };
}

/** route：打開時就亮這條、浮出說明（從路線清單點進來） */
async function openTopo(viewId, fromPic = null, { replace = false, route } = {}) {
  const view = await getDoc(viewId);
  if (view.props?.model && (await getDoc(view.props.model.id)) && (await modelUsable(view.props.model.id))) return open3d(view, fromPic, { replace, route });   // 3D 模型拍的快照：直接看 3D
  if (await photoMissing(view)) return void toast(T(view.origin === 'personal' ? 'photoPendingPersonal' : 'photoPendingOnline'), 4500);
  state.topo = viewId;
  $('topoPop').hidden = true;
  const data = await topoData(viewId);
  showWhere(viewId);
  await enter('topo', closeTopo, {
    from: fromPic, src: fromPic?.src, card: replace ? { box: 'cards', id: viewId } : undefined,
    // 頁面顯示後才有大小，這時才填；照片載好、解好才開始放大（不然動畫結束那一刻照片才畫出來，看起來會閃一下）
    prepare: async () => {
      topoEl.removeAttribute('highlight');
      topoEl.data = data;
      await new Promise((ok) => { if (topoEl.viewer?.ready) ok(); else { topoEl.addEventListener('ready', ok, { once: true }); setTimeout(ok, 8000); } });   // 等 Topo 畫好（8 秒只是防卡住的上限）
      if (topoEl.viewer?.img) await settled(topoEl.viewer.img);
    },
    rect: () => photoRect(topoEl, view.w, view.h),
  }, { replace });
  if (route) (topoEl.viewer?.routes?.length ? showPop(route) : topoEl.addEventListener('ready', () => showPop(route), { once: true }));
}

// ── 3D：整個岩場是一個模型（一條連續的步道），打開就在岩場裡：先鋪第一面岩壁的快照，模型畫好後換成 3D，路線再出來。
// 底部一排岩壁名稱（點了走過去），往上拉是路線清單（電腦版是左邊一欄），點路線走到它前面、浮出說明。
// 各區＝同一個模型拍的快照所在的岩壁（照岩壁順序），鏡頭用快照的 props.model.camera；路線、說明跟 Topo 一樣 ──
let model3d = null;
let posterRect = () => null;
/** crag：從岩場卡片打開（state.pack 是這個岩場，返回時回首頁） */
async function open3d(view, fromPic = null, { replace = false, route, crag = false } = {}) {
  const m = view.props.model, model = await getDoc(m.id);
  const docs = await allDocs(), pop = $('m3dPop'), where = $('m3dWhere'), sheet = $('m3dSheet');
  const activeSet = state.pack ? docs.find((d) => d.id === state.pack) : docs.find((d) => d.kind === 'set' && d.items?.some((i) => (i.id ?? i.href?.replace(/\.json$/, '')) === view.id));
  const ids = activeSet ? cragModelIds(cragOf(docs, flatSet(docs, activeSet)).order.map((id) => docs.find((d) => d.id === id))) : [model.id];
  const validIds = ids.length && ids.every((id) => docs.some((d) => d.id === id)) ? ids : [model.id];
  // 模型、路線、各面岩壁與鏡頭、全區快照：照格式讀出來（節點只讀包著這些模型的組合：收過同一個岩場的別的版本時，路線 id 可能一樣）
  const { segments: segs, marks, sight, nodes, owners, areas: found, overview: coverShot } = readCrag3d(docs, validIds);
  const byNode = new Map(nodes.map((n) => [n.id, n]));
  const areas = found.map((a) => ({ ...a, name: a.name || T('unnamed') }));
  // 從岩場卡片進來：回到上次離開時最近的那面岩壁（記在這台，存不了就從第一面）；指定路線、Topo 進來的照那張
  const packSet = state.pack && docs.find((d) => d.id === state.pack), set = packSet ? flatSet(docs, packSet) : owners[0];
  const wallKey = `redpoint.wall3d.${set?.id ?? model.id}`, saved = crag && !route ? (() => { try { return areas.findIndex((a) => a.id === localStorage.getItem(wallKey)); } catch { return -1; } })() : -1;
  const start = saved >= 0 ? saved : Math.max(0, areas.findIndex((a) => a.id === view.props.node));
  // 第一次進來（還沒記過停在哪）、橫的螢幕（電腦）：卡片放大成全區快照（岩場封面，掛在岩場節點、記著拍的鏡頭），模型好了從那裡往前飛進第一面，一路只放大不縮小；
  // 直的螢幕（手機）看全區要先縮很小再放大，直接進第一面
  const overview = crag && !route && saved < 0 && innerWidth > innerHeight ? coverShot ?? null : null;
  const poster = overview ?? areas[start]?.snapshot ?? view;
  where.querySelector('b').textContent = nameOf(set ?? view);
  where.querySelector('span').textContent = '';
  // 右上分享、清單上方的原始資料／交通／地圖：跟岩場頁同一組按鈕（岩場頁藏著，內容在 fillPack 填好）
  $('m3dShare').hidden = !packSet || !state.packShareable;
  $('m3dToggle').hidden = !set;
  for (const k of ['Source', 'Way', 'Area']) $(`m3d${k}`).hidden = !packSet || $(`pack${k}`).hidden;
  if (packSet) $('m3dSource').href = $('packSource').href;
  // 岩壁名稱：目前在哪一面就亮那一面
  const chips = areas.map((a, i) => { const b = el('button', { textContent: a.name }); b.onclick = () => { openSheet(false); model3d?.go(i); }; return b; });
  $('m3dWalls').replaceChildren(...chips);
  const onArea = (i) => { try { localStorage.setItem(wallKey, areas[Math.round(i)]?.id ?? ''); } catch { /* 存不了下次就從第一面 */ } chips.forEach((c, k) => { c.setAttribute('aria-current', String(k === Math.round(i))); if (k === Math.round(i)) { const box = $('m3dWalls'); box.scrollTo?.({ left: box.scrollLeft + c.getBoundingClientRect().left - box.getBoundingClientRect().left - (box.clientWidth - c.offsetWidth) / 2, behavior: 'smooth' }); } }); };   // 只捲岩壁分頁這一列（scrollIntoView 會連清單面板一起橫向捲走）
  const rows = !set ? [] : routeRows(docs, set, { go: (r) => { if (!areas.some((a) => a.routes.has(r.id))) return toast(T('noTopoYet'), 2500); openSheet(false); model3d?.route(r.id); } }).rows;   // 路線清單：一列一條，含爪印（完攀記錄）
  $('m3dList').replaceChildren(...rows);
  $('m3dList').parentElement.scrollTop = 0;
  openSheet(false);
  pop.hidden = true;
  const pick = (id) => {
    model3d?.highlight(id);
    const mk = id && marks.find((x) => x.node === id), n = byNode.get(id);
    if (!mk) return void (pop.hidden = true);
    fillPop(pop, { label: mk.props?.label, grade: pickGrade(n?.props?.grade ?? n?.props?.['thecrag:grade']), name: nameOf(n) }, n);
  };
  await enter('m3d', () => { model3d?.destroy(); model3d = null; if (crag) return packClosed(); }, {
    from: fromPic, src: fromPic?.src, card: replace ? { box: 'cards', id: crag ? state.pack : view.id } : undefined,
    prepare: async () => {
      const bgMap = new Map();
      const segments = await Promise.all(segs.map(async (s) => {
        const bgId = s.model.props?.background;
        const bgDoc = bgId && (bgMap.get(bgId) ?? bgMap.set(bgId, await getDoc(bgId)).get(bgId));
        return { id: s.id, url: photoUrl(s.model), mime: s.model.mime, background: bgDoc ? photoUrl(bgDoc) : undefined, sky: s.model.props?.sky, from: s.from, to: s.to };
      }));
      const curSeg = segments.find((s) => start >= s.from && start <= s.to) ?? segments[0];
      const m = model3d = await mountCrag3d($('m3dView'), { url: curSeg.url, mime: curSeg.mime, background: curSeg.background, segments,   // 分段載入：先載目前區段，其餘背景預載
         poster: await photoUrl(poster), marks, sight, nodes, areas,
        start, intro: overview ? { camera: overview.props.model.camera, aspect: overview.w / overview.h } : null, sky: curSeg.sky ?? model.props?.sky, mode: new URLSearchParams(location.search).get('3d') || 'free', onPick: pick, onArea });
      posterRect = () => m.posterRect();   // 返回時 3D 已經關掉，縮回小卡還要用這個位置
      if (route) m.route(route);
    },
    rect: () => posterRect(),
  }, { replace });
}
/** 路線清單（手機）：往上拉開、往下收回；點 3D 畫面也收回 */
function openSheet(on) {
  $('m3dSheet').classList.toggle('open', on);
  $('m3dGrip').setAttribute('aria-expanded', String(on));
  $('m3dToggle').setAttribute('aria-expanded', String(on));
}
{
  let y0 = null;
  $('m3dGrip').onpointerdown = (e) => { y0 = e.clientY; $('m3dGrip').setPointerCapture(e.pointerId); };
  $('m3dGrip').onpointerup = (e) => {
    const dy = y0 == null ? 0 : e.clientY - y0, open = $('m3dSheet').classList.contains('open');
    y0 = null;
    openSheet(Math.abs(dy) < 12 ? !open : dy < 0);
  };
  $('m3dGrip').onclick = (e) => { if (!e.detail) openSheet(!$('m3dSheet').classList.contains('open')); };   // 鍵盤（Enter、空白鍵）
  $('m3dWalls').addEventListener('pointerdown', (e) => { y0 = e.clientY; });
  $('m3dWalls').addEventListener('pointerup', (e) => { if (y0 != null && e.clientY - y0 < -30) openSheet(true); else if (y0 != null && e.clientY - y0 > 30) openSheet(false); y0 = null; });
  $('m3dView').addEventListener('pointerdown', () => openSheet(false));
  $('m3dToggle').onclick = () => openSheet(!$('m3dSheet').classList.contains('open'));   // 右上的清單鈕：開關路線清單
  $('m3dShare').onclick = () => share(state.pack);
  $('m3dWay').onclick = () => $('packWay').click();
  $('m3dArea').onclick = () => $('packArea').click();
}

function closeTopo() {
  state.topo = '';
  if (state.pack) renderPack();
  else render();
}

// ── 事件 ──
const fab = $('fab'), fabBtn = $('fabBtn');
const closeFab = () => {
  fab.removeAttribute('data-open');
  fabBtn.setAttribute('aria-expanded', 'false');
  for (const b of fab.querySelectorAll('.rarc-btn')) b.tabIndex = -1;
};
fabBtn.onclick = () => {
  const open = !fab.hasAttribute('data-open');
  fab.toggleAttribute('data-open', open);
  fabBtn.setAttribute('aria-expanded', String(open));
  for (const b of fab.querySelectorAll('.rarc-btn')) b.tabIndex = open && !b.hidden ? 0 : -1;
};
AppKit.nearby.bind($('worldNearby'), 'send', nearbyAdapter, closeFab);
$('fabWorld').onclick = () => { closeFab(); openWorld().catch((e) => toast(e.message, 5000)); };
$('emptyGo').onclick = () => openWorld().catch((e) => toast(e.message, 5000));
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#fab')) closeFab(); }, true);
// 第一次使用（首頁還沒有岩場）：直接看一個 3D 岩場範例（大砲岩），知道岩場可以做成 3D 路線圖
const DEMO_3D = 'rw9oa7t1taemt9zj';
$('emptyTry3d').onclick = () => receive(`https://huggingface.co/datasets/climbio/crags/resolve/main/crags/${DEMO_3D}/index.json`).catch((e) => toast(e.message, 5000));   // 在 App 裡直接收：不整頁重載（省一次冷啟動）
$('avatar').onclick = () => openAcct();
$('acct').onclick = (e) => e.target === $('acct') && closeAcct();
// ── 匯出、匯入岩場：多個岩場打包成一個 ZIP（每個岩場一個資料夾，見 appkit/crags.mjs），給換手機或同行的人；
//    匯入時 ZIP 裡有幾個岩場就列出來讓使用者勾選。匯入後畫面的 origin 原樣保留：個人收藏還是 personal，沒有分享鈕 ──

/** 多選清單：rows 是 [{ id, name, sub, checked }]，回傳勾選的 id；取消是 null */
async function pickRows({ title, text, rows, ok }) {
  const boxes = rows.map((r) => el('input', { type: 'checkbox', checked: !!r.checked }));
  const list = el('div', { className: 'pick-list' }, ...rows.map((r, i) => el('label', { className: 'pick-row' }, boxes[i], el('span', {}, el('b', { textContent: r.name }), el('small', { textContent: r.sub || '' })))));
  const answer = await ask({ title, text, body: [list], buttons: [{ label: T('cancel') }, { label: ok, value: 'ok', primary: true }] });
  return answer?.button === 'ok' ? rows.filter((_, i) => boxes[i].checked).map((r) => r.id) : null;
}

/** files：ZIP／.climbio 檔；all：不問、全部匯入（擴充交接來的）。回匯入成功的岩場 id */
async function importCollection(files, { all = false } = {}) {
  try {
    UI.toast(T('readingFile'), { busy: true });
    const found = new Map(), bad = [];
    for (const f of files) {
      try {
        const r = await readCrags(await AppKit.files.unzip(f), check);
        for (const c of r.crags) found.set(c.set.id, c);
        bad.push(...r.bad);
      } catch (e) {
        bad.push(`${f.name}：${e.message}`);
      }
    }
    UI.hideToast();
    if (!found.size) return void UI.alert(T('noCragsInFile', bad[0])) ?? [];
    const crags = [...found.values()], have = new Set();
    for (const c of crags) if (await getDoc(c.set.id)) have.add(c.set.id);
    const ids = all ? crags.map((c) => c.set.id) : await pickRows({
      title: T('importCrags'),
      text: bad.length ? T('badFolders', bad.length, bad[0]) : '',
      rows: crags.map(({ set }) => ({
        id: set.id, name: nameOf(set), checked: !have.has(set.id),
        sub: [T('wallsN', (set.nodes ?? []).filter((n) => n.type === 'wall' || n.type === 'sector').length || set.items.length), have.has(set.id) && T('haveOverwrite')].filter(Boolean).join(' · '),
      })),
      ok: T('importData'),
    });
    if (ids == null) return [];
    if (!ids.length) return void toast(T('nonePicked')) ?? [];
    const done = [], problems = [];
    for (const [i, c] of crags.filter((x) => ids.includes(x.set.id)).entries()) {
      UI.toast(T('importingN', i + 1, ids.length, nameOf(c.set)), { busy: true });
      try {
        const r = await importCrag(c, { crop: cropTop, check, local: { putDocs, putPhoto, addToHome } });
        forgetUrl(c.set.id, ...r.docs.map((d) => d.id));
        done.push(c.set);
        problems.push(...r.skipped.map((s) => `${nameOf(c.set)}：${s}`).slice(0, 1));
      } catch (e) {
        problems.push(`${nameOf(c.set)}：${e.message}`);
      }
    }
    UI.hideToast();
    navigator.storage?.persist?.().catch(() => {});
    await render();
    toast(done.length ? T('importedResult', done.length, problems.length, problems[0]) : T('reason', T('importFailed'), problems[0]), problems.length ? 7000 : 3500);
    return done.map((x) => x.id);
  } catch (e) {
    UI.hideToast();
    toast(T('reason', T('importFailed'), e.message), 6000);
    return [];
  }
}

/** 瀏覽器擴充（extension/）收好的岩場：網址 #collect 時連進擴充拿過來，全部匯入，成功的才通知擴充刪掉 */
async function receiveCollected() {
  history.replaceState({ rp: 0 }, '', location.pathname + location.search);
  try {
    UI.toast(T('collectReading'), { busy: true });
    const got = await pullCollected({ onProgress: (n, total) => UI.toast(`${T('collectReading')} ${Math.round((n / Math.max(total, 1)) * 100)}%`, { busy: true }) });
    UI.hideToast();
    if (!got.bundles.length) return void toast(T('collectNone'), 5000);
    const zip = await AppKit.files.zip(got.bundles.flatMap((b) => b.files.map((f) => ({ name: `${b.id}/${f.path}`, blob: f.blob }))));
    const done = new Set(await importCollection([new File([zip], 'collect.zip', { type: 'application/zip' })], { all: true }));
    const ok = got.bundles.filter((b) => done.has(b.id)).map((b) => b.id);
    await got.ack(ok.length || done.size !== got.bundles.length ? ok : got.bundles.map((b) => b.id));
  } catch (e) {
    UI.hideToast();
    toast(T('collectFailed', e.message), 7000);
  }
}
const redpointBackup = createBackupUI({
  app: 'redpoint', database, stores: ['docs', 'photos', 'meta'],
  preferences: ['redpoint.log', 'climbio.nickname', 'climbio.nicknameAt'], nicknameSuggestion: async () => (await getMeta('author')) || '', selective: true, exportGroups: true,
  labels: { backupData: 'exportData', restoreData: 'importData', backupFile: 'localFile', backupWorking: 'exportWorking', backupDone: 'exportDone', backupFailed: 'exportFailed', restoreWorking: 'importWorking', restoreChoose: 'importChoose', restoreFailed: 'importFailed' },
  prepareExport: (snapshot, ids) => exportCollections(snapshot, ids, LOG_KEY),
  importAccept: '.climbio,.zip,application/gzip,application/zip',
  importArchive: importCollection,
  groups: snapshot => collectionGroups(snapshot, { nameOf, otherName: T('backupOtherData') }),
  prepare: (value, store) => store === 'docs' ? check(value) : value,
  prepareRestore: (snapshot, selected, rows, options) => collectionRestorePlan(snapshot, selected, rows, { ...options, logKey: LOG_KEY, check }),

});
$('acMe').onclick = async (e) => {
  closeAcct();
  await AppKit.nearby.ensureNickname({ edit: true, suggested: (await getMeta('author')) || '' });
};
$('acExport').onclick = () => { closeAcct(); redpointBackup.backup(); };
$('acImport').onclick = () => { closeAcct(); redpointBackup.restore(); };
$('acAutoMerge').onclick = () => autoMergeHome().catch((e) => toast(e.message, 5000));
$('acSync').onclick = () => { closeAcct(); openNearby('devices'); };
$('acHelp').onclick = () => { closeAcct(); window.open(AppKit.i18n.guideUrl('redpoint-manual.html'), '_blank', 'noopener,noreferrer'); };
$('acInstall').onclick = () => { closeAcct(); installRedpoint(); };
for (const id of ['packBack', 'worldBack', 'rvClose', 'cmapBack', 'wayBack']) $(id).onclick = back;
$('packMore').onclick = async () => openMore($('packMore'), await packActions());
// 往上滑、主卡捲出去之後，岩場名稱移到「<」右邊
new IntersectionObserver(([e]) => $('pack').querySelector('.bar').classList.toggle('titled', !e.isIntersecting && e.boundingClientRect.top < 80), { root: $('pack'), rootMargin: '-60px 0px 0px 0px' }).observe($('packBanner'));
$('packTicks').onclick = () => openTicks().catch((e) => toast(e.message, 5000));
$('ticksBack').onclick = back;
// 看 Topo：點路線浮出說明（再點一次、點照片別處收起來）；左右滑換前後一張
topoEl.addEventListener('pick', (e) => { (topoEl.getAttribute('highlight') === e.detail.id ? hidePop() : showPop(e.detail.id)); });
topoEl.addEventListener('click', (e) => { if (!e.composedPath().some((n) => n.dataset?.route)) hidePop(); });
// 換張：手機左右滑，電腦兩側的按鈕與鍵盤 ←、→（Esc 返回）；一次換一張，換到一半又按的，等這次換完再換（最後按的那個，不會被吃掉）
let stepping = false, queued = 0;
async function step(n) {
  if (stepping) { queued = n; return; }
  stepping = true;
  try {
    for (let next = n; next; next = queued, queued = 0) await stepTopo(next);
  } catch (err) { toast(err.message, 5000); } finally { stepping = false; queued = 0; }
}
// 左右滑：有點選路線就切下一條／上一條（照編號，到頭就停），沒有選路線才換 Topo
function stepRoute(n) {
  const num = (r) => (Number.isFinite(Number(r.label)) && r.label !== '' && r.label != null ? Number(r.label) : Infinity);
  const routes = [...(topoEl.viewer?.routes ?? [])].map((r, i) => [r, i]).sort(([a, i], [b, j]) => num(a) - num(b) || i - j).map(([r]) => r);
  const at = routes.findIndex((r) => r.id === topoEl.getAttribute('highlight'));
  const next = routes[at + n];
  if (next) showPop(next.id);
}
topoEl.addEventListener('swipedown', back);   // 沒放大時由上往下滑：返回岩場
topoEl.addEventListener('swipe', (e) => (topoEl.getAttribute('highlight') ? stepRoute(e.detail.step) : step(e.detail.step)));
$('topoPrev').onclick = () => step(-1);
$('topoNext').onclick = () => step(1);
// 3D：電腦用兩側的鈕、方向鍵沿著岩壁往前往後走一段（連續的步道，不停靠某一區），Esc 返回
const step3d = (n) => model3d?.walk(n);
document.addEventListener('keydown', (e) => {
  const top = nav.at(-1)?.id;
  if (!['topo', 'm3d'].includes(top) || e.altKey || e.ctrlKey || e.metaKey || e.target.closest?.('input, textarea, [contenteditable]')) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    const n = e.key === 'ArrowLeft' ? -1 : 1;
    if (top === 'topo') step(n); else step3d(n);
  } else if (e.key === 'Escape') back();
});
// 照片的大小：直放的手機照左右貼邊；電腦、橫放的寬螢幕整張放進畫面（不然高度超出被裁掉）
const syncFit = () => topoEl.setAttribute('fit', wide.matches ? 'contain' : 'width');
wide.addEventListener('change', syncFit);
syncFit();
$('closeTopo').onclick = back;
$('closeM3d').onclick = back;
$('topoMore').onclick = async () => openMore($('topoMore'), await topoActions());

// ── 開始 ──
AppKit.account.footer($('acFoot'), { version: globalThis.CLIMBIO_VERSION, sourcesHref: 'sources.html' });
syncLang();
const initialHref = location.href;
if ('serviceWorker' in navigator) {
  // updateViaCache: 'none'：檢查新版時 sw.js 和它載入的 version.js 都直接問網路（iPhone 的 Safari 不然會一直用舊版）
  // 新版裝好後等著（sw.js 的 waiting 模式）：畫面下方顯示「有新版本　更新」，使用者按了才接手並重新載入（保留進來時的 ?topo=），不自動打斷
  // 進來時還沒有 Service Worker 接手（第一次開）時，接手不重新載入；按了「更新」就一定重新載入。按的時候新版已經接手（別的分頁按過）就直接重新載入
  let reloaded = false, reg = null, asked = false;
  const reload = () => { if (!reloaded) { reloaded = true; location.replace(initialHref); } };
  const bar = globalThis.AppKit.update.create({ apply: () => { asked = true; if (reg?.waiting) reg.waiting.postMessage('SKIP_WAITING'); else reload(); } });
  const showIfWaiting = () => { if (reg?.waiting && navigator.serviceWorker.controller) bar.show(); };
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => {
    reg = r;
    showIfWaiting();
    r.addEventListener('updatefound', () => {
      const w = r.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed') showIfWaiting(); });
    });
    globalThis.AppKit.update.watch(() => r.update().catch(() => {}));   // 開著不動、從背景回來：回到前景時問一次有沒有新版
  }).catch(() => {});
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (had || asked) reload(); });
}
history.replaceState({ rp: 0 }, '');
face($('rpHomeAvatar'), null);
install = globalThis.AppKit.install.track({ dismissedKey: 'redpoint.installDismissedAt', installedKey: 'redpoint.installed', onChange: renderInstallHint });
renderInstallHint();
// 帳號恢復不擋本機首頁與分享連結；網路慢時仍能先看已存的 Topo。
// 開機就抓 OpenClimbing 與 Guidebook，合成三層樹（不擋首頁與開機檢查）；點連結進來時先讓出頻寬給要收的內容，收完（或收不到）再抓
if (new URLSearchParams(location.search).get('topo')) setTimeout(prefetchWorld, 6000); else prefetchWorld();
await ensureHome();
// 深層連結：?topo= 直接收路線／Guidebook；?world=1 直接打開世界。
// 保留原本的普通 /redpoint/ 首頁；世界是 App 內的一頁，返回仍回到首頁。
const startupParams = new URLSearchParams(location.search);
const link = startupParams.get('topo'), linkAt = startupParams.get('at');
const enterWorld = !link && startupParams.get('world') === '1';
if (link || enterWorld) history.replaceState({ rp: 0 }, '', location.pathname);
await render();
setTimeout(() => backfillNearbyThumbs().catch((e) => console.warn('補做朋友互傳縮圖', e)), 0);
self.akBooted?.();   // 開機完成：告訴 recover.js 的看門狗（沒呼叫到會被當成開機失敗，自動清快取重載）
if (link) receive(link, { at: linkAt });
else if (enterWorld) openWorld().catch((e) => toast(e.message, 5000));
else if (location.hash === '#collect') receiveCollected();
