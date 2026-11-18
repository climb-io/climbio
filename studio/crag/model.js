// 一本 Guidebook 的資料：就是 v2（format/README.md）。不碰畫面、不碰 IndexedDB，Node 也能跑。
//   組合（kind set、type guidebook）：岩壁是 nodes 裡 type wall（或 sector）的節點（props.aspect 是朝向）；
//     路線是 type route 的節點，parent 是岩壁（沒有就是還沒分配），props.order 是在同一面岩壁裡的順序；
//     區、岩場這類上層也是節點（層數不限）；items 是岩壁地圖、照片和疊在照片上的圖層（Topo）
//   圖層（kind layer，on 是照片畫面）：Topo 的線段（指向路線節點）與 bolt（bolt／anchor 節點，name 是位置 B01、A01）
//   地圖畫面（surface map）：每面岩壁一段牆線，標註的 node 指向岩壁節點
//   照片畫面（surface photo）：camera 是拍照資料，props.node 是拍的是哪面岩壁
// Studio Crag自己的設定與狀態放在 props 的「author:」欄位，匯出時拿掉。
import { previewProps } from '../../sourcekit/preview-sheet.js';
import { pickWall, estimateWall, lineAspect, located, WALL_DISTANCE, GROUP_TIME } from './geo.js';

export const LICENSE = 'CC-BY-SA-4.0';
/** 不開放改編：發佈時「開放其他人改編」關掉 */
export const LICENSE_ND = 'CC-BY-ND-4.0';
const LOCAL = 'author:';

/** 新的檔案 id、全域節點 id：16 碼小寫英數 */
export const newId = () => AppKit.files.rid(16);

/** 新的 Guidebook：組合加上一張空的岩壁地圖；extras 是匯入時原樣帶著的其他地圖畫面（例如交通圖，props.purpose: approach），Studio Crag不改、發佈時照樣放進去 */
export function newBook(name, t = Date.now()) {
  const mapId = newId();
  const book = { climbio: 2, kind: 'set', type: 'guidebook', id: newId(), name, t, license: LICENSE, attribution: '', items: [{ href: `${mapId}.json`, id: mapId }], nodes: [], props: {} };
  const map = { climbio: 2, kind: 'view', surface: 'map', id: mapId, t, license: LICENSE, attribution: '', origin: 'self', marks: [] };
  return { book, map, photos: new Map(), layers: new Map(), extras: new Map() };
}

/** 名稱、說明可以是字串或多語物件：顯示用的文字 */
export const text = (v) => (v == null ? '' : typeof v === 'string' ? v : (v['zh-Hant'] ?? Object.values(v)[0] ?? ''));
/** 改文字：多語物件只換中文（沒有中文就換第一個語言），其他語言留著 */
export function withText(old, value) {
  if (!old || typeof old !== 'object') return value;
  const k = 'zh-Hant' in old ? 'zh-Hant' : Object.keys(old)[0];
  return { ...old, [k]: value };
}

/** 照片畫面（AppKit.photo.view：自己拍的、有位置就帶 camera）；raw 是 AppKit.photo.readExif 讀到的拍照資料 */
/** origin 不給 = 自己拍的（'self'）；路線書轉換抽出的內嵌圖傳 null：來源不明，不能發佈，換上作者的原圖才放行 */
export function newPhoto({ id = newId(), name, w, h, sha256, raw, attribution = '', declination = 0, t = Date.now(), origin = 'self' }) {
  const view = { ...globalThis.AppKit.photo.view({ id, name, t, license: LICENSE, attribution, w, h, sha256, raw, declination, origin }), props: {} };
  if (!view.camera && Number.isFinite(raw?.time)) view.props[`${LOCAL}time`] = Math.round(raw.time);   // 沒有位置時 camera 不存在，拍攝時間另外留著歸岩壁用
  // 磁北的朝向留著原值：之後改磁偏角時重算
  if (view.camera && raw.headingRef === 'M' && typeof raw.heading === 'number') view.props[`${LOCAL}magnetic`] = raw.heading;
  return view;
}

export const GRADE_SYSTEMS = ['yds', 'french', 'uiaa', 'british', 'v', 'font', 'dan'];
/** 岩場所在國家（ISO 3166-1 alpha-2，小寫）：世界的第一層分組。使用者在岩場資訊自己選，沒選就不發佈這個欄位 */
export const COUNTRIES = 'ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bl bm bn bo bq br bs bt bv bw by bz ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg eh er es et fi fj fk fm fo fr ga gb gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir is it je jm jo jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mf mg mh mk ml mm mn mo mp mq mr ms mt mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro rs ru rw sa sb sc sd se sg sh si sj sk sl sm sn so sr ss st sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt tv tw tz ua ug um us uy uz va vc ve vg vi vn vu wf ws ye yt za zm zw'.split(' ');
export const settings = (state) => ({
  country: state.book.props[`${LOCAL}country`] ?? '',   // 沒選是空字串
  distance: state.book.props[`${LOCAL}distance`] ?? WALL_DISTANCE,
  declination: state.book.props[`${LOCAL}declination`] ?? 0,
  grade: state.book.props[`${LOCAL}grade`] ?? 'yds',
  columns: state.book.props[`${LOCAL}columns`],   // 路線表格顯示的欄位（table.js 的 shownColumns）；沒選過是 undefined
  pack: state.book.props[`${LOCAL}pack`] ?? [],   // 發佈時附上的底圖（publish.js 的 PACKABLE：ortho、contours）
  numbering: state.book.props[`${LOCAL}numbering`] ?? 'wall',   // 路線編號：wall（每面岩壁從 1）、area（每個大區域從 1）、manual（自己填，路線的 props.number）
});

/** 放路線的岩壁：wall，或岩場站的分區（sector） */
export const WALL_TYPES = ['wall', 'sector'];
export const walls = (state) => state.book.nodes.filter(n => WALL_TYPES.includes(n.type));
export const wallLine = (state, wallId) => {
  const g = state.map.marks.find(m => m.node === wallId)?.geometry;
  return g?.type === 'LineString' ? g.coordinates : undefined;
};
/** 一面岩壁的照片，照 items 的順序 */
export function photosOf(state, wallId) {
  return state.book.items.map(i => state.photos.get(i.id)).filter(v => v && v.props.node === wallId);
}

/** 新的一面岩壁；沒給名稱就叫「岩壁 n」 */
export function addWall(state, name) {
  const names = new Set(walls(state).map(w => text(w.name)));
  let n = walls(state).length + 1;
  while (names.has(T('cdWallN', n))) n++;
  const wall = { id: newId(), type: 'wall', name: name || T('cdWallN', n) };
  state.book.nodes.push(wall);
  return wall.id;
}

const shotsOf = (state, wallId) => photosOf(state, wallId).map(v => ({ camera: v.camera, portrait: v.h > v.w }));

/** 放進新照片：放進 wallId；沒給就自動歸到拍照位置與朝向相近的岩壁，沒有就開一面新的 */
export function addPhoto(state, view, wallId) {
  const target = wallId || pickWall(view.camera, walls(state).map(w => ({ id: w.id, cameras: photosOf(state, w.id).map(p => p.camera) })));
  view.props.node = target || addWall(state);
  state.photos.set(view.id, view);
  state.book.items.push({ href: view.href.replace(/\.jpg$/, '.json'), id: view.id });
  refreshWall(state, view.props.node);
  return view.props.node;
}

/**
 * 疊在岩壁地圖底下的示意圖（例如手畫的岩場配置），用來對著它拖牆線：
 * { id（圖檔在本機的鍵）, w, h（像素）, center: [經度, 緯度], width（公尺）, rotation（度，順時針） }。只是Studio Crag的工具，不匯出
 */
export const sketchOf = (state) => state.book.props[`${LOCAL}sketch`];
export function setSketch(state, sketch) {
  if (sketch) state.book.props[`${LOCAL}sketch`] = sketch;
  else delete state.book.props[`${LOCAL}sketch`];
}

/**
 * 沒有拍照位置或位置不準的照片照拍攝時間歸岩壁：先歸到 GROUP_TIME 內時間最接近、位置用得上的照片的岩壁；
 * 附近沒有這種照片的，跟前一張 GROUP_TIME 內連拍的同類照片歸同一面。回傳歸進去的張數
 */
export function placeByTime(state, ids) {
  const anchors = [...state.photos.values()].filter(v => located(v.camera) && Number.isFinite(v.camera.t));
  const timeOf = (v) => v.camera?.t ?? v.props[`${LOCAL}time`];
  const loose = ids.map(id => state.photos.get(id)).filter(v => v && !located(v.camera) && Number.isFinite(timeOf(v)));
  let placed = 0;
  const rest = [];
  for (const v of loose) {
    let best, bestDt = GROUP_TIME;
    for (const o of anchors) { const dt = Math.abs(o.camera.t - timeOf(v)); if (dt <= bestDt) { best = o; bestDt = dt; } }
    if (!best) { rest.push(v); continue; }
    if (best.props.node !== v.props.node) movePhotos(state, [v.id], best.props.node);
    placed++;
  }
  rest.sort((a, b) => timeOf(a) - timeOf(b));
  for (let i = 1; i < rest.length; i++) {
    const v = rest[i], prev = rest[i - 1];
    if (timeOf(v) - timeOf(prev) > GROUP_TIME) continue;
    if (prev.props.node !== v.props.node) movePhotos(state, [v.id], prev.props.node);
    placed++;
  }
  return placed;
}

/** 從照片重新推估一面岩壁的牆線與朝向；手動改過的線不動，除非 force */
export function refreshWall(state, wallId, { force = false } = {}) {
  const wall = state.book.nodes.find(n => n.id === wallId);
  if (!wall) return;
  const at = state.map.marks.findIndex(m => m.node === wallId);
  const manual = at >= 0 && state.map.marks[at].props?.[`${LOCAL}manual`];
  if (manual && !force) return;
  const est = estimateWall(shotsOf(state, wallId), settings(state).distance);
  if (!est && manual) return;   // 沒有照片可以算（例如匯入的牆線）：留著
  if (at >= 0) state.map.marks.splice(at, 1);
  if (!est) { if (wall.props) delete wall.props.aspect; return; }
  state.map.marks.push({ node: wallId, geometry: { type: 'LineString', coordinates: est.line } });
  wall.props = { ...wall.props, aspect: est.aspect };
}

const lineLength = (l) => l.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - l[i][0], (p[1] - l[i][1]) * 1.1), 0);

/** 岩場節點（匯入的、轉換路線書建的才有）：位置 geo 記在它身上 */
export const cragOf = (state) => state.book.nodes.find(n => n.type === 'crag');
export const cragPosition = (state) => cragOf(state)?.geo?.coordinates;
/** 貼上的位置 → [經度, 緯度]：Google 地圖複製的「緯度, 經度」；範圍不對回 undefined */
export function parsePosition(input) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,，\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(input || '');
  if (!m) return undefined;
  const [lat, lng] = [+m[1], +m[2]];
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6] : undefined;
}
/** 原始資料的網址（組合的 source.url：作者的路線書文件，紅點貓岩場頁右上有連結）；只收 https，不是就回 false；空的清掉 */
export const sourceOf = (state) => state.book.source?.url || '';
export function setSource(state, url) {
  if (!url) { delete state.book.source; return true; }
  if (!/^https:\/\/\S+$/.test(url)) return false;
  state.book.source = { ...state.book.source, url };
  return true;
}
/** 岩場的交通說明（岩場節點的 props.approach，紅點貓的交通頁）；只有有岩場節點的書才有，空的清掉 */
export const approachOf = (state) => cragOf(state)?.props?.approach || '';
export function setApproach(state, text) {
  const crag = cragOf(state);
  if (!crag) return;
  if (text) crag.props = { ...crag.props, approach: text };
  else if (crag.props) { delete crag.props.approach; if (!Object.keys(crag.props).length) delete crag.props; }
}
/** 設定岩場位置（undefined 就清掉） */
export function setCragPosition(state, position) {
  const crag = cragOf(state);
  if (!crag) return;
  if (position) crag.geo = { type: 'Point', coordinates: position }; else delete crag.geo;
}

/** 區域圖改過的形狀（地圖畫面的標註，已經改在 mark.geometry 上）：岩壁、岩石記成手動改過（照片不再重算），岩壁的線另外重算朝向 */
export function setShape(state, mark) {
  const wall = walls(state).find(w => w.id === mark.node);
  if (!wall) return;
  mark.props = { ...mark.props, [`${LOCAL}manual`]: true };
  const g = mark.geometry;
  if (!/LineString/.test(g.type)) return;
  const lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
  const aspect = lineAspect(lines.map(l => [l, lineLength(l)]).sort((a, b) => b[1] - a[1])[0][0]);
  if (aspect !== undefined) wall.props = { ...wall.props, aspect };
}

/** 區域圖刪掉的形狀：只拿掉標註，岩壁、區域節點（和上面的路線）留著 */
export function removeShape(state, mark) {
  state.map.marks = state.map.marks.filter(m => m !== mark);
}

/** 點在多邊形裡（經緯度，射線法） */
const inside = (pt, ring) => ring.reduce((hit, a, i) => {
  const b = ring[(i + 1) % ring.length];
  return (a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0] ? !hit : hit;
}, false);
const polygonsOf = (g) => (g?.type === 'Polygon' ? [g.coordinates[0]] : g?.type === 'MultiPolygon' ? g.coordinates.map(q => q[0]) : []);

/**
 * 區域圖畫的新形狀：kind 是 rock（岩石，多邊形）、wall（岩壁，線）、area（區域，多邊形）、trail（步道，線）。
 * 岩石、岩壁是新的岩壁節點（在哪個區域裡就放進那個區域），區域是新的區域節點（跟其他區域同一層），步道只有標註。回傳新節點的 id
 */
export function addShape(state, kind, geometry, name, nodeId) {
  if (kind === 'trail') { state.map.marks.push({ geometry, props: { kind: 'trail' } }); return undefined; }
  // 替已有的節點（例如匯入的區域、還沒畫牆線的岩壁）畫：只加標註
  if (nodeId && state.book.nodes.some(n => n.id === nodeId)) {
    const mark = { node: nodeId, geometry };
    state.map.marks.push(mark);
    setShape(state, mark);
    return nodeId;
  }
  if (kind === 'rock' && !name) {
    const names = new Set(walls(state).map(w => text(w.name)));
    let n = 1;
    while (names.has(T('cdRockN', n))) n++;
    name = T('cdRockN', n);
  }
  if (kind === 'area') {
    const sibling = state.book.nodes.find(n => n.type === 'area');
    const area = { id: newId(), type: 'area', name: name || T('cdAreaN', state.book.nodes.filter(n => n.type === 'area').length + 1), ...(sibling?.parent ? { parent: sibling.parent } : {}) };
    state.book.nodes.push(area);
    state.map.marks.push({ node: area.id, geometry });
    // 框到的岩壁、岩石（中心在裡面、還不在別的區域裡）放進這個區域
    const areaIds = new Set(state.book.nodes.filter(n => ['area', 'crag'].includes(n.type) && n.id !== area.parent).map(n => n.id));
    for (const w of walls(state)) {
      const g = state.map.marks.find(m => m.node === w.id)?.geometry;
      if (!g || areaIds.has(w.parent)) continue;
      const pts = g.type === 'Polygon' ? g.coordinates[0].slice(0, -1) : g.type === 'LineString' ? g.coordinates : [];
      if (!pts.length) continue;
      const mid = [pts.reduce((sum, p) => sum + p[0], 0) / pts.length, pts.reduce((sum, p) => sum + p[1], 0) / pts.length];
      if (polygonsOf(geometry).some(r => inside(mid, r))) w.parent = area.id;
    }
    return area.id;
  }
  const id = addWall(state, name);
  const pts = geometry.type === 'Polygon' ? geometry.coordinates[0].slice(0, -1) : geometry.coordinates;
  const mid = [pts.reduce((sum, p) => sum + p[0], 0) / pts.length, pts.reduce((sum, p) => sum + p[1], 0) / pts.length];
  const area = state.map.marks.find(m => state.book.nodes.find(n => n.id === m.node)?.type === 'area' && polygonsOf(m.geometry).some(r => inside(mid, r)));
  if (area) state.book.nodes.find(n => n.id === id).parent = area.node;
  const mark = { node: id, geometry };
  state.map.marks.push(mark);
  setShape(state, mark);
  return id;
}

/** 拿掉這幾面裡空掉的岩壁（沒有照片、也沒有路線或其他下層節點） */
function dropEmptyWalls(state, ids) {
  const used = new Set([...[...state.photos.values()].map(v => v.props.node), ...state.book.nodes.map(n => n.parent)]);
  const empty = walls(state).filter(w => ids.has(w.id) && !used.has(w.id)).map(w => w.id);
  state.book.nodes = state.book.nodes.filter(n => !empty.includes(n.id));
  state.map.marks = state.map.marks.filter(m => !empty.includes(m.node));
}

/** 把照片移到另一面岩壁；wallId 沒給就拆成一面新的。空掉的岩壁拿掉 */
export function movePhotos(state, ids, wallId) {
  const target = wallId || addWall(state);
  const touched = new Set([target]);
  for (const id of ids) {
    const v = state.photos.get(id);
    if (!v) continue;
    touched.add(v.props.node);
    v.props.node = target;
  }
  dropEmptyWalls(state, touched);
  for (const w of touched) refreshWall(state, w);
  return target;
}

/** 合併：from 的照片、路線（接在後面）和其他下層節點併進 into，from 拿掉 */
export function mergeWalls(state, from, into) {
  moveRoutes(state, routesOf(state, from).map(r => r.id), into);
  for (const n of state.book.nodes) if (n.parent === from) n.parent = into;
  movePhotos(state, photosOf(state, from).map(v => v.id), into);
  dropEmptyWalls(state, new Set([from]));
}

/** 刪除岩壁：照片和上面的圖層一起刪（回傳它們的 id，檔案由呼叫的人刪），路線改成還沒分配 */
export function deleteWall(state, wallId) {
  const photoIds = photosOf(state, wallId).map(v => v.id);
  moveRoutes(state, routesOf(state, wallId).map(r => r.id), null);
  for (const n of state.book.nodes) if (n.parent === wallId) delete n.parent;
  const layerIds = removePhotos(state, photoIds);
  state.book.nodes = state.book.nodes.filter(n => n.id !== wallId);
  state.map.marks = state.map.marks.filter(m => m.node !== wallId);
  return [...photoIds, ...layerIds];
}

/** 刪除區域：底下的岩壁與子節點移回上一層（保留所有岩壁、照片與路線），拿掉區域節點與它的地圖範圍 */
export function deleteArea(state, areaId) {
  const area = state.book.nodes.find(n => n.id === areaId);
  if (!area) return;
  for (const n of state.book.nodes) {
    if (n.parent === areaId) {
      if (area.parent) n.parent = area.parent;
      else delete n.parent;
    }
  }
  state.book.nodes = state.book.nodes.filter(n => n.id !== areaId);
  state.map.marks = state.map.marks.filter(m => m.node !== areaId);
}

/** 匯入的檔案（寫了 derivedFrom 或 source）：署名、授權照原本的 */
const imported = (doc) => !!(doc.derivedFrom || doc.source);

/** 署名：Guidebook 和使用者自己建立、原本跟著 Guidebook 署名（或沒署名）的檔案一起換；匯入的檔案不動 */
/** 從別人的版本改來的（匯入時記下原本的署名）：原本的署名一直留著，自己只能加上去；原創的是 undefined */
export const originAttribution = (state) => state.book.props[`${LOCAL}origin`];
/** 自己的那部分署名（設定、發佈時填的） */
export const ownAttribution = (state) => (originAttribution(state) === undefined ? state.book.attribution || '' : state.book.props[`${LOCAL}own`] || '');
/** 組合的署名：原本的＋「〇〇 改編」 */
const joinAttribution = (origin, own) => [origin, own && T('cdAdapted', own)].filter(Boolean).join(T('cdAttrSep'));
export function markOrigin(state) {
  state.book.props[`${LOCAL}origin`] = state.book.attribution || '';
}

/** 改自己的署名：改編的組合寫成「原本的；自己 改編」，原本的拿不掉 */
export function setAttribution(state, own) {
  const old = state.book.attribution || '', origin = originAttribution(state);
  let name = own;
  if (origin !== undefined) {
    if (own) state.book.props[`${LOCAL}own`] = own; else delete state.book.props[`${LOCAL}own`];
    name = joinAttribution(origin, own);
  }
  state.book.attribution = name;
  for (const doc of [state.map, ...state.photos.values(), ...state.layers.values()]) {
    if (!imported(doc) && (!doc.attribution || doc.attribution === old)) doc.attribution = name;
  }
}

/** 開放其他人改編：CC BY-SA 4.0（預設）；關掉是 CC BY-ND 4.0。只換自己建立的檔案；匯入的 Guidebook 照原作者的授權，不能改 */
export const remix = (state) => state.book.license !== LICENSE_ND;
export function setRemix(state, on) {
  if (originAttribution(state) !== undefined) return;
  const old = state.book.license, want = on ? LICENSE : LICENSE_ND;
  state.book.license = want;
  for (const doc of [state.map, ...state.photos.values(), ...state.layers.values()]) {
    if (!imported(doc) && (!doc.license || doc.license === old)) doc.license = want;
  }
}
/** 匯入的 Guidebook 原作者不開放改編（授權有 ND）：可以看、在這台改，不能發佈 */
export const noDerivs = (state) => originAttribution(state) !== undefined && /-ND-/.test(state.book.license || '');

export function renameWall(state, wallId, name) {
  const wall = state.book.nodes.find(n => n.id === wallId);
  if (wall) wall.name = withText(wall.name, name);
}

// ---- 路線 ----
export const routes = (state) => state.book.nodes.filter(n => n.type === 'route');
const byOrder = (list) => list.map((n, i) => [n, i]).sort((a, b) => (a[0].props?.order ?? Infinity) - (b[0].props?.order ?? Infinity) || a[1] - b[1]).map(x => x[0]);
/** 一面岩壁的路線（wallId 是 null：還沒分配的），照 props.order */
export function routesOf(state, wallId) {
  const known = new Set(walls(state).map(w => w.id));
  return byOrder(routes(state).filter(r => (wallId ? r.parent === wallId : !known.has(r.parent))));
}
// ---- 區域的顏色（照龍洞網站）：大區域各一個顏色，底下的分區、岩壁用同一個顏色由深到淺；節點的 props.color 有寫就用它 ----
const PALETTE = ['#cc0000', '#f7981d', '#f1c232', '#9bc051', '#38761d', '#00b6e6', '#0b5394', '#932259', '#eb0067'];
const HEX = /^#[0-9a-f]{6}$/i;
const mix = (a, b, t) => '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('');
/** 第 i 個（共 n 個）子區域的顏色：上層的顏色由深（-0.3）到淺（+0.45） */
function shade(color, i, n) {
  if (n <= 1) return color;
  const t = -0.3 + (0.75 * i) / (n - 1);
  return mix(color, t < 0 ? '#000000' : '#ffffff', Math.abs(t));
}
/**
 * 每個區域、岩壁的顏色（節點 id → #rrggbb），不存進資料：只算底下有岩壁的節點。
 * 只有一個的上層（例如整個岩場）不上色，往下一層才開始分顏色；沒有區域的小岩場就是每面岩壁一個顏色
 */
export function colors(state) {
  const byId = new Map(state.book.nodes.map(n => [n.id, n]));
  const holds = new Set();
  for (const w of walls(state)) for (let n = w, guard = 0; n && guard < 50; n = byId.get(n.parent), guard++) holds.add(n.id);
  const out = new Map();
  const paint = (parentId, color, depth) => {
    if (depth > 50) return;
    const kids = childrenOf(state, parentId).filter(n => holds.has(n.id));
    kids.forEach((n, i) => {
      const own = HEX.test(n.props?.color ?? '') ? n.props.color.toLowerCase() : undefined;
      const c = own ?? (color ? shade(color, i, kids.length) : kids.length > 1 || walls(state).includes(n) ? PALETTE[i % PALETTE.length] : undefined);
      if (c) out.set(n.id, c);
      paint(n.id, c, depth + 1);
    });
  };
  paint(null, undefined, 0);
  return out;
}

/** 一個節點底下的節點（不含路線），照 props.order，沒有就照原本的順序 */
export const childrenOf = (state, id) => byOrder(state.book.nodes.filter(n => n.type !== 'route' && (id ? n.parent === id : !state.book.nodes.some(p => p.id === n.parent))));

function renumber(list) {
  list.forEach((r, i) => { r.props = { ...r.props, order: i + 1 }; });
}

/** 同名（不分大小寫、前後空白）同岩壁的路線 */
const nameKey = (name) => text(name).trim().toLowerCase();
export function findDuplicate(state, name, wallId, exceptId) {
  const key = nameKey(name);
  return key ? routesOf(state, wallId || null).find(r => r.id !== exceptId && nameKey(r.name) === key) : undefined;
}

/** 新增路線：items 是 [{ name, parent?, props }]，接在各岩壁的最後；回傳新的 id */
export function addRoutes(state, items) {
  return items.map(({ name, parent, props = {} }) => {
    const order = routesOf(state, parent || null).length + 1;
    const nextProps = { ...props, order };
    const node = { id: newId(), type: 'route', name, props: nextProps };
    if (parent) node.parent = parent;
    state.book.nodes.push(node);
    return node.id;
  });
}

/** 改路線：name、props（整份換掉，順序留著）、parent（換岩壁就接到最後） */
export function updateRoute(state, id, { name, props, parent }) {
  const r = state.book.nodes.find(n => n.id === id && n.type === 'route');
  if (!r) return;
  if (name !== undefined) r.name = withText(r.name, name);
  if (props) r.props = { ...props, order: r.props?.order };
  if (parent !== undefined && (parent || null) !== (walls(state).some(w => w.id === r.parent) ? r.parent : null)) moveRoutes(state, [id], parent);
}

/** 把路線移到 wallId（null：還沒分配），插在 before 前面（沒給就接在最後）；兩邊的順序重新編號 */
export function moveRoutes(state, ids, wallId, before) {
  const moving = ids.map(id => state.book.nodes.find(n => n.id === id && n.type === 'route')).filter(Boolean);
  if (!moving.length) return;
  const known = new Set(walls(state).map(w => w.id));
  const sources = new Set(moving.map(r => (known.has(r.parent) ? r.parent : null)));
  const target = routesOf(state, wallId || null).filter(r => !moving.includes(r));
  const at = before ? target.findIndex(r => r.id === before) : -1;
  target.splice(at < 0 ? target.length : at, 0, ...moving);
  for (const r of moving) { if (wallId) r.parent = wallId; else delete r.parent; }
  renumber(target);
  for (const s of sources) if ((s || null) !== (wallId || null)) renumber(routesOf(state, s));
}

/** 把岩壁（或區域）移到 parent 底下（null：最上層），插在 before 前面（沒給就接在最後）；兩邊的順序重新編號 */
export function moveNode(state, id, parent, before) {
  const n = state.book.nodes.find(x => x.id === id && x.type !== 'route');
  if (!n) return;
  const from = state.book.nodes.some(p => p.id === n.parent) ? n.parent : null;
  const target = childrenOf(state, parent || null).filter(x => x !== n);
  const at = before ? target.findIndex(x => x.id === before) : -1;
  target.splice(at < 0 ? target.length : at, 0, n);
  if (parent) n.parent = parent; else delete n.parent;
  renumber(target);
  if (from !== (parent || null)) renumber(childrenOf(state, from));
  const seen = new Set();
  const ordered = [];
  const walk = (pid) => {
    for (const c of childrenOf(state, pid)) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      ordered.push(c);
      walk(c.id);
    }
  };
  walk(null);
  for (const x of state.book.nodes) if (x.type !== 'route' && !seen.has(x.id)) ordered.push(x);
  const routeNodes = state.book.nodes.filter(x => x.type === 'route');
  state.book.nodes = [...ordered, ...routeNodes];
}

/** 刪除路線（和掛在路線底下的節點、圖層上這些路線的線段與 bolt）；回傳改到的圖層 id */
export function removeRoutes(state, ids) {
  const gone = new Set(ids);
  const sources = new Set(routes(state).filter(r => gone.has(r.id)).map(r => r.parent || null));
  state.book.nodes = state.book.nodes.filter(n => !gone.has(n.id) && !gone.has(n.parent));
  for (const s of sources) renumber(routesOf(state, s));
  const touched = [];
  for (const layer of state.layers.values()) {
    const drop = new Set((layer.nodes || []).filter(n => gone.has(localId(n.id)) || gone.has(localId(n.parent))).map(n => n.id));
    const marks = (layer.marks || []).filter(m => !gone.has(localId(m.node)) && !drop.has(m.node));
    if (!drop.size && marks.length === (layer.marks || []).length) continue;
    layer.nodes = (layer.nodes || []).filter(n => !drop.has(n.id));
    layer.marks = marks;
    touched.push(layer.id);
  }
  return touched;
}

// ---- Topo：照片上的圖層（kind layer，on 是照片畫面），線段標註指向路線節點，bolt 節點的 name 是位置（B01、A01） ----
const localId = (ref) => (typeof ref === 'string' && ref.includes('#') ? ref.split('#').pop() : ref);

/** 疊在這張照片上的圖層（照 items 的順序） */
export const layersOn = (state, photoId) => state.book.items.map(i => state.layers.get(i.id)).filter(l => l && l.on === photoId);

/** 岩場有在管理 bolt 編號（例如龍洞）：匯入的圖層裡就有 bolt、確保站。這種岩場畫 Topo 時 bolt 牌子帶位置（「× B01」），小岩場只標 × */
export const managesBolts = (state) => [...state.layers.values()].some(l => l.derivedFrom && (l.nodes || []).some(n => n.type === 'bolt' || n.type === 'anchor'));

/** 這張照片要編輯的圖層：已經有就用第一個，沒有就開一個新的（還沒放進 Guidebook，第一次存的時候才放） */
export function topoLayer(state, photoId) {
  const have = layersOn(state, photoId)[0];
  if (have) return have;
  const { book } = state;
  return { climbio: 2, kind: 'layer', id: newId(), on: photoId, href: `${photoId}.json`, t: Date.now(), license: book.license || LICENSE, attribution: book.attribution || '', nodes: [], marks: [] };
}

/**
 * 描紅線的結果自動配給路線：照片照給的順序，每張照片的線（由左到右）依序配給這面岩壁還沒畫線的路線（照清單順序）；
 * 線上有 bolt、確保站的一起放（bolt 由下往上 B01、B02…，確保站 A01、A02…）。路線書通常照照片的順序、由左到右列路線，所以大多配得對；配錯的在畫 Topo 裡修。
 * traced：[[照片 id, [{ points, bolts?, anchors? } 或 { points: [], at, size?, color? }（只找到號碼牌）…]]…]，由左到右。回傳 { drawn（畫了幾條）, left（幾條沒有路線可配）, layers（改到的圖層 id） }
 */
/** 掛在岩場或區底下的照片（配置圖、全景）：不是岩壁的 Topo，不描線、不補記號 */
export const isOverview = (state, photo) => ['crag', 'area'].includes(state.book.nodes.find(n => n.id === photo.props.node)?.type);
/** 沒描出線、只補了短線段記號的路線標註（標註的 props）：作者拖到位置或重畫之後就不再是記號 */
export const STUB = 'author:stub';
export function autoTopo(state, traced) {
  const done = drawn(state), out = { drawn: 0, left: 0, stubs: 0, layers: [], photos: [] }, byId = new Map(routes(state).map(r => [r.id, r]));
  const round = ([x, y]) => [Math.round(x), Math.round(y)];
  for (const [photoId, lines] of traced) {
    const photo = state.photos.get(photoId);
    if (!photo || !lines?.length || isOverview(state, photo)) continue;
    // 大綱附了這張照片拍到的路線（由左到右）就只在這幾條裡配；沒有的話，配給這面岩壁還沒畫線的路線
    const queue = (photo.props.routes ? photo.props.routes.map(id => byId.get(id)) : routesOf(state, photo.props.node)).filter(r => r && !done.has(r.id));
    // 只找到號碼牌、讀得到號碼（text）的：先配給編號一樣的路線；其他照順序配
    const owner = new Map(), used = new Set();
    lines.forEach((l, i) => {
      if (!l.at || !l.text) return;
      const r = queue.find(q => !used.has(q.id) && routeNumber(state, q.id) === l.text);
      if (r) { owner.set(i, r); used.add(r.id); }
    });
    const rest = queue.filter(r => !used.has(r.id));
    let next = 0;
    const assigned = lines.map((_, i) => owner.get(i) ?? rest[next++]);   // undefined：沒有路線可配
    const n = assigned.filter(Boolean).length;
    out.left += lines.length - n;
    if (!n) continue;
    const layer = structuredClone(topoLayer(state, photo.id));
    const taken = new Set(layer.nodes.map(x => x.id));
    for (let i = 0; i < lines.length; i++) {
      if (!assigned[i]) continue;
      const route = assigned[i].id;
      // 只標了確保站的路線（傳統攀）沒有線段
      if (lines[i].points.length >= 2) layer.marks.push({ node: route, geometry: { type: 'LineString', coordinates: lines[i].points.map(round) } });
      // 找不到線、只找到照片上印的號碼牌：標出號碼位置（路線號碼），牌子蓋在原牌子上（size）、用原牌子的顏色
      else if (lines[i].at) layer.marks.push({ node: route, geometry: { type: 'Point', coordinates: round(lines[i].at) }, props: { ...(lines[i].size ? { size: lines[i].size } : {}), ...(lines[i].color ? { style: { stroke: lines[i].color } } : {}) } });
      const put = (type, prefix) => (at, k) => {
        const name = `${prefix}${String(k + 1).padStart(2, '0')}`;
        let id = `${route.slice(0, 6)}-${name.toLowerCase()}`;
        while (taken.has(id)) id += 'x';
        taken.add(id);
        layer.nodes.push({ id, type, parent: route, name });
        layer.marks.push({ node: id, geometry: { type: 'Point', coordinates: round(at) } });
      };
      (lines[i].bolts || []).forEach(put('bolt', 'B'));
      (lines[i].anchors || []).forEach(put('anchor', 'A'));
      done.set(route, new Set([photo.id]));
    }
    syncLabels(state, layer);
    layer.t = Date.now();
    saveLayer(state, layer);
    out.drawn += n;
    out.layers.push(layer.id);
  }
  // 照片上有、卻沒描出線的路線（紅線太淡、被擋住、圖上根本沒畫）：補一個短線段記號，紅點貓才有東西可以點；作者在 Topo 上拖到對的位置或重畫
  // 只補確定拍在這張照片上的：大綱附了這張的路線，或這面岩壁只有這一張照片
  const stubbed = new Map();
  for (const photo of state.photos.values()) {
    if (isOverview(state, photo)) continue;
    const sole = [...state.photos.values()].filter(v => v.props.node === photo.props.node).length === 1;
    const want = (photo.props.routes ? photo.props.routes.map(id => byId.get(id)) : sole ? routesOf(state, photo.props.node) : []).filter(r => r && !done.has(r.id));
    if (!want.length) continue;
    const layer = structuredClone(topoLayer(state, photo.id));
    const h = photo.h || 1000, w = photo.w || 1000;
    want.forEach((r, i) => {
      const x = Math.round(w * (i + 1) / (want.length + 1));
      layer.marks.push({ node: r.id, geometry: { type: 'LineString', coordinates: [[x, Math.round(h * 0.7)], [x, Math.round(h * 0.5)]] }, props: { [STUB]: true } });
      done.set(r.id, new Set([photo.id]));
    });
    syncLabels(state, layer);
    layer.t = Date.now();
    saveLayer(state, layer);
    out.stubs += want.length;
    stubbed.set(layer.id, true);
  }
  out.layers = [...new Set([...out.layers, ...stubbed.keys()])];
  // 照片拍到哪些路線只用這一次：用過就拿掉，不留在照片上
  for (const v of state.photos.values()) if (v.props.routes) { delete v.props.routes; out.photos.push(v.id); }
  return out;
}

/** 存編輯後的圖層：接在它的照片（和照片已有的圖層）後面；沒有任何標註就拿掉。回傳 'saved' 或 'removed' */
/**
 * 線停在確保站中間：線的最後兩點剛好是這條路線的兩顆確保站（描紅線、舊資料常把兩顆確保站連起來，線尾就橫著拐一下），
 * 換成兩顆的中間。自動做、不用人調；改了回傳 true
 */
export function endAtAnchors(layer) {
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1.5;
  const nodes = new Map((layer.nodes || []).map(n => [n.id, n]));
  const anchors = new Map();   // 路線 id → 確保站的點
  for (const m of layer.marks || []) {
    const n = nodes.get(m.node);
    if (n?.type !== 'anchor' || m.geometry?.type !== 'Point') continue;
    const r = localId(n.parent);
    if (!anchors.has(r)) anchors.set(r, []);
    anchors.get(r).push(m.geometry.coordinates);
  }
  let changed = false;
  for (const m of layer.marks || []) {
    const line = m.geometry?.type === 'LineString' ? m.geometry.coordinates : null;
    const a = line && anchors.get(localId(m.node));
    if (!a || line.length < 3) continue;
    const [p, q] = line.slice(-2);
    if (near(p, q) || !a.some(x => near(x, p)) || !a.some(x => near(x, q))) continue;
    m.geometry = { ...m.geometry, coordinates: [...line.slice(0, -2), [0, 1].map(i => Math.round(((p[i] + q[i]) / 2) * 10) / 10)] };
    changed = true;
  }
  return changed;
}

/**
 * 相鄰路線的起點對齊：照片上左右相鄰（起點水平距離在照片寬的 GAP 內）、起點高度差在照片高的 DY 內的一群，
 * 起點都截到那一群最高（畫面上最上面）的起點，編號牌就排成一條水平線。只截短、不往下補（不畫進地面）；分岔共用起點的照樣一起截。
 * 自動做、不用人調；改了回傳 true
 */
export function alignStarts(layer, photo) {
  const W = photo?.w, H = photo?.h;
  if (!W || !H) return false;
  const GAP = 0.12 * W, DY = 0.04 * H;
  const lines = (layer.marks || []).filter(m => m.node && m.geometry?.type === 'LineString' && m.geometry.coordinates.length >= 2)
    .sort((a, b) => a.geometry.coordinates[0][0] - b.geometry.coordinates[0][0]);
  const groups = [];
  for (const m of lines) {
    const g = groups[groups.length - 1], p = m.geometry.coordinates[0], q = g?.[g.length - 1].geometry.coordinates[0];
    if (q && p[0] - q[0] <= GAP && Math.abs(p[1] - q[1]) <= DY) g.push(m); else groups.push([m]);
  }
  let changed = false;
  for (const g of groups) {
    if (g.length < 2) continue;
    const top = Math.min(...g.map(m => m.geometry.coordinates[0][1]));
    for (const m of g) {
      const c = m.geometry.coordinates;
      if (c[0][1] <= top + 0.5) continue;
      const k = c.findIndex(p => p[1] <= top);   // 第一個到那個高度（含以上）的點
      if (k <= 0) continue;
      const a = c[k - 1], b = c[k], t = (a[1] - top) / Math.max(1e-6, a[1] - b[1]);
      const start = [Math.round((a[0] + t * (b[0] - a[0])) * 10) / 10, Math.round(top * 10) / 10];
      m.geometry = { ...m.geometry, coordinates: [start, ...c.slice(k)] };
      changed = true;
    }
  }
  return changed;
}

export function saveLayer(state, layer) {
  endAtAnchors(layer);
  alignStarts(layer, state.photos.get(layer.on));
  const items = state.book.items;
  const at = items.findIndex(i => i.id === layer.id);
  if (!layer.marks?.length) {
    state.layers.delete(layer.id);
    if (at >= 0) items.splice(at, 1);
    return 'removed';
  }
  state.layers.set(layer.id, layer);
  if (at < 0) {
    let pos = items.findIndex(i => i.id === layer.on);
    while (pos >= 0 && pos + 1 < items.length && state.layers.get(items[pos + 1].id)?.on === layer.on) pos++;
    items.splice(pos < 0 ? items.length : pos + 1, 0, { href: `${layer.id}.json`, id: layer.id });
  }
  return 'saved';
}

/** 路線的標註：線段，或路線號碼（指向路線節點的 Point，沒有線的路線；指向 bolt、確保站節點的 Point 不是） */
const routeMark = (m, routeIds) => !!m.node && (m.geometry?.type === 'LineString' || (m.geometry?.type === 'Point' && routeIds.has(localId(m.node))));
const routeIdsOf = (state) => new Set(state.book.nodes.filter(n => n.type === 'route').map(n => n.id));

/** 畫過線（或標了號碼）的路線：路線 id → 有它標註的照片 id */
export function drawn(state) {
  const out = new Map(), routeIds = routeIdsOf(state);
  for (const layer of state.layers.values()) {
    for (const m of layer.marks || []) {
      if (!routeMark(m, routeIds)) continue;
      const id = localId(m.node);
      if (!out.has(id)) out.set(id, new Set());
      out.get(id).add(layer.on);
    }
  }
  return out;
}

/** 這張照片上有路線標註（線段或路線號碼）的路線有幾條 */
export function routeMarkCount(state, photoId) {
  const routeIds = routeIdsOf(state), ids = new Set();
  for (const l of layersOn(state, photoId)) for (const m of l.marks || []) if (routeMark(m, routeIds)) ids.add(localId(m.node));
  return ids.size;
}

/**
 * 路線的編號（字串）：照岩場資訊的設定。wall：在岩壁裡的順序從 1；area：同一個大區域（最近的 area 節點，沒有就是整個岩場）
 * 照岩壁、路線的順序一路編下去；manual：路線的 props.number（自己填，例如龍洞的 568）。還沒分配岩壁的沒有（manual 照填的）
 */
export function routeNumber(state, routeId) {
  const r = state.book.nodes.find(n => n.id === routeId && n.type === 'route');
  if (!r) return undefined;
  const mode = settings(state).numbering;
  if (mode === 'manual') return r.props?.number ? String(r.props.number) : undefined;
  if (!walls(state).some(w => w.id === r.parent)) return undefined;
  if (mode !== 'area') return String(routesOf(state, r.parent).indexOf(r) + 1);
  const byId = new Map(state.book.nodes.map(n => [n.id, n]));
  const areaOf = (id) => { for (let n = byId.get(id), guard = 0; n && guard < 50; n = byId.get(n.parent), guard++) if (n.type === 'area') return n.id; return null; };
  const area = areaOf(r.parent);
  const list = [];
  const walk = (parentId) => {
    for (const n of childrenOf(state, parentId)) {
      if (WALL_TYPES.includes(n.type)) { if (areaOf(n.id) === area) list.push(...routesOf(state, n.id)); }
      else walk(n.id);
    }
  };
  walk(null);
  return String(list.indexOf(r) + 1);
}

/** 圖層線段、路線號碼的編號牌（props.label）照路線現在的編號；回傳有沒有改 */
export function syncLabels(state, layer) {
  let changed = false;
  const routeIds = routeIdsOf(state);
  for (const m of layer.marks || []) {
    if (!routeMark(m, routeIds)) continue;
    const n = routeNumber(state, localId(m.node));
    if (n === undefined || m.props?.label === n) continue;
    m.props = { ...m.props, label: n };
    changed = true;
  }
  return changed;
}

/**
 * 原圖換掉路線書的圖（同一次快門，原圖比較大；路線書的圖可以是裁切、縮放過的）：疊在路線書那張的圖層搬到原圖上，
 * 座標照 H（3×3 單應性，列優先：路線書畫面座標 → 原圖畫面座標，pair.js 找的）換過去；
 * 原圖放進同一面岩壁、排在路線書那張的位置，路線書那張拿掉。回傳搬過去的圖層 id
 */
export function takeOriginal(state, oldId, newId, H) {
  const a = state.photos.get(oldId), o = state.photos.get(newId);
  if (!a || !o || a === o) return [];
  const at = ([x, y]) => { const w = H[6] * x + H[7] * y + H[8]; return [Math.round(((H[0] * x + H[1] * y + H[2]) / w) * 10) / 10, Math.round(((H[3] * x + H[4] * y + H[5]) / w) * 10) / 10]; };
  const scale = (c) => (typeof c[0] === 'number' ? at(c) : c.map(scale));
  const moved = [];
  for (const l of layersOn(state, oldId)) {
    l.on = newId;
    l.href = `${newId}.json`;
    for (const m of l.marks || []) if (m.geometry?.coordinates) m.geometry = { ...m.geometry, coordinates: scale(m.geometry.coordinates) };
    moved.push(l.id);
  }
  const from = o.props.node;
  o.props.node = a.props.node;
  if (a.props.routes) o.props.routes = a.props.routes;   // 路線書那張拍到的路線，原圖接著用
  const items = state.book.items;
  const mine = items.find(i => i.id === newId);
  items.splice(items.indexOf(mine), 1);
  items.splice(items.findIndex(i => i.id === oldId), 1, mine);   // 原圖排在路線書那張的位置，圖層本來就接在後面
  state.photos.delete(oldId);
  dropEmptyWalls(state, new Set([from]));
  for (const w of new Set([from, o.props.node])) if (walls(state).some(x => x.id === w)) refreshWall(state, w);
  return moved;
}

/** 刪除照片和疊在上面的圖層（空掉的岩壁一起拿掉）；回傳刪掉的圖層 id */
export function removePhotos(state, ids) {
  const touched = new Set();
  for (const id of ids) {
    const v = state.photos.get(id);
    if (!v) continue;
    touched.add(v.props.node);
    state.photos.delete(id);
  }
  const layers = [...state.layers.values()].filter(l => ids.includes(l.on)).map(l => l.id);
  for (const id of layers) state.layers.delete(id);
  state.book.items = state.book.items.filter(i => !ids.includes(i.id) && !layers.includes(i.id));
  dropEmptyWalls(state, touched);
  for (const w of touched) refreshWall(state, w);
  return layers;
}

/** 改設定：距離改了重算沒手動改過的牆線；磁偏角改了重算磁北照片的朝向 */
export const NUMBERINGS = ['wall', 'area', 'manual'];
/** 發佈的資料裡的岩場設定（Guidebook 組合的 props.settings，見 format/VOCABULARY.md）；沒選過的欄位（columns）不寫 */
export function exportSettings(state) {
  const { distance, declination, grade, columns, pack, numbering } = settings(state);
  return { numbering, grade, distance, declination, pack, ...(columns ? { columns } : {}) };
}
/** 讀發佈的資料裡的岩場設定：認得的欄位才收，格式不對的略過（用預設） */
export function importSettings(state, s) {
  if (!s || typeof s !== 'object') return;
  const strings = (a) => Array.isArray(a) && a.every(x => typeof x === 'string') ? a : undefined;
  setSettings(state, {
    numbering: s.numbering, grade: s.grade, columns: strings(s.columns), pack: strings(s.pack),
    ...(Number.isFinite(s.distance) ? { distance: s.distance } : {}),
    ...(Number.isFinite(s.declination) ? { declination: s.declination } : {}),
  });
}
export function setSettings(state, { distance, declination, grade, columns, pack, numbering, country }) {
  const p = state.book.props;
  if (country === '') delete p[`${LOCAL}country`];
  else if (COUNTRIES.includes(country)) p[`${LOCAL}country`] = country;
  if (NUMBERINGS.includes(numbering)) p[`${LOCAL}numbering`] = numbering;
  if (GRADE_SYSTEMS.includes(grade)) p[`${LOCAL}grade`] = grade;
  if (Array.isArray(columns)) p[`${LOCAL}columns`] = columns;
  if (Array.isArray(pack)) p[`${LOCAL}pack`] = pack;
  if (declination !== undefined && declination !== settings(state).declination) {
    p[`${LOCAL}declination`] = declination;
    for (const v of state.photos.values()) {
      const m = v.props[`${LOCAL}magnetic`];
      if (typeof m === 'number' && v.camera) v.camera.heading = Math.round((((m + declination) % 360) + 360) % 360 * 10) / 10 % 360;
    }
  }
  if (distance !== undefined) p[`${LOCAL}distance`] = distance;
  for (const w of walls(state)) refreshWall(state, w.id);
}

/** 照照片重新產生整張岩壁地圖（手動改過的線也重算） */
export function regenerate(state) {
  for (const w of walls(state)) refreshWall(state, w.id, { force: true });
}

function clean(doc) {
  const out = structuredClone(doc);
  const strip = (o) => {
    if (!o?.props) return;
    for (const k of Object.keys(o.props)) if (k.startsWith(LOCAL)) delete o.props[k];
    if (!Object.keys(o.props).length) delete o.props;
  };
  strip(out);
  for (const n of out.nodes || []) strip(n);
  for (const m of out.marks || []) strip(m);
  if (out.nodes && !out.nodes.length) delete out.nodes;
  return out;
}

/** 匯出的檔案：入口 index.json（組合，跟專案資料夾一樣）、<id>.json（地圖、照片畫面、圖層）；圖檔（照片、小圖、入口照片）由呼叫的人附上 */
export const ENTRY = 'index.json';
// 下載照片前先看的：整本一張合成預覽圖 preview.jpg（上面是入口照片 4:3，下面是每張照片的小圖排成格子），紅點貓收的時候先下載它，
// 照片下載到哪，小圖就亮到哪；清單上的卡片也用它的上半（不另存入口照片）。組合的 props.preview 記圖檔和格子的位置，照片項目的 props.tile 是第幾格。
// 岩壁數、路線數不存：讀的人從 nodes 數（一個事實只放一處，見 format/README.md 的「放法與連結」）
export { PREVIEW, PREVIEW_W, COVER_H, TILE_W, TILE_H, TILE_COLS, THUMB, THUMB_W, THUMB_H, previewSize } from '../../sourcekit/preview-sheet.js';   // 版面共用（擴充功能的收藏也產同一種預覽圖）
const T = (...a) => AppKit.i18n.t(...a);   // 文字在呼叫時才查語言包（Node 測試、命令列也能用）
export function exportDocs(state) {
  const book = clean(state.book);
  book.props = { ...book.props, settings: exportSettings(state) };   // 岩場的設定跟著資料走：另一個人匯入就有完整的設定
  let tile = 0;
  book.items = book.items.map(i => (state.photos.has(i.id) ? { ...i, props: { ...i.props, tile: tile++ } } : i));
  if (state.photos.size) {
    book.props = { ...book.props, preview: previewProps(state.photos.size) };
  }
  const docs = [{ path: ENTRY, doc: book }, { path: `${state.map.id}.json`, doc: clean(state.map) }];
  for (const item of state.book.items) {
    const photo = state.photos.get(item.id), layer = state.layers.get(item.id);
    if (photo) {
      const doc = clean(photo);
      // 匯入來的照片可能帶著別人的特徵點檔（href 指不到這本）：不附
      if (doc.props?.features) { const { features: _, ...rest } = doc.props; doc.props = rest; if (!Object.keys(rest).length) delete doc.props; }
      docs.push({ path: item.href, doc });
    }
    if (layer) { const doc = clean(layer); syncLabels(state, doc); docs.push({ path: item.href, doc }); }
    if (state.extras.has(item.id)) docs.push({ path: item.href, doc: clean(state.extras.get(item.id)) });
  }
  return docs;
}
