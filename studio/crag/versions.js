// 已發佈 Guidebook 的版本紀錄：同一本書的所有版本、每一版跟它的上一版差在哪裡。純運算，不碰畫面（app.js 的版本視窗、測試共用）。
//   版本：公開專案清單（Backend.listGuidebooks）同一個 root 的一列，列本身加 others 就是全部版本；每版的 lineage 是從第一版到它上一版的 id，最後一個就是它從哪一版改的。
//   比對：兩版的入口（index.json）加所有文件（crawl 讀回的 Map）。各版之間節點（岩場、區域、岩壁、路線）的 id 不變（匯入保留，site.js 的 fromV2），
//         照片換了 id 但 sha256 一樣，路線圖的線掛在照片上（layer 的 on），所以：節點照 id、照片照 sha256、線照「哪張照片的哪條路線」比。

/** 跟這本書有關的 id（自己發佈過的、匯入來源、這本的第一版）在清單裡是哪一本：→ { name, root, versions: [{ id, n, t, dl, url, origin }]（舊到新，n 從 1 起） }，找不到回 null */
export function versionsOf(rows, ids) {
  const want = new Set(ids.filter(Boolean));
  const row = rows.find(p => [p.id, p.root, ...(p.others || []).map(o => o.id)].some(id => want.has(id)));
  if (!row) return null;
  const all = [row, ...(row.others || [])].map(v => ({ id: v.id, t: v.t || 0, dl: v.dl || 0, url: v.url || '', origin: (v.lineage || []).at(-1) || '' }));
  all.sort((a, b) => a.t - b.t);
  all.forEach((v, i) => { v.n = i + 1; });
  return { name: row.name || '', root: row.root || row.id, versions: all };
}

const text = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? (v.zh ?? v.en ?? Object.values(v)[0] ?? '') : v ?? '');
/** 比對時節點的欄位：名稱、在哪一層、props 的每個欄位（順序另外算，拖動排序也是改） */
function fieldsOf(n) {
  const out = { name: text(n.name), parent: n.parent || '' };
  for (const [k, v] of Object.entries(n.props || {})) out[k] = v;
  return out;
}
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** 一版的內容：節點（入口與各組合的 nodes）、照片（sha256 → 畫面）、每張照片每條路線的線、地圖上每個節點的形狀 */
function contentOf({ root, docs }) {
  const nodes = new Map();
  for (const d of [root, ...docs.values()]) if (d?.kind === 'set') for (const n of d.nodes || []) if (!nodes.has(n.id)) nodes.set(n.id, n);
  const views = [...docs.values()].filter(d => d.kind === 'view');
  const photos = new Map(), bySha = new Map();
  for (const v of views.filter(v => v.surface === 'photo')) { const k = v.sha256 || v.href || v.id; photos.set(k, v); bySha.set(v.id, k); }
  // 線：圖層的 marks 照它屬於哪條路線分（路線本身的線、路線底下的鉤環與確保站）
  const lines = new Map();
  for (const l of [...docs.values()].filter(d => d.kind === 'layer' && bySha.has(d.on))) {
    const owner = new Map((l.nodes || []).map(n => [n.id, n.parent]));
    const per = new Map();
    for (const m of l.marks || []) {
      const route = nodes.has(m.node) ? m.node : owner.get(m.node) || m.node;
      if (!per.has(route)) per.set(route, []);
      per.get(route).push({ node: m.node, geometry: m.geometry, props: m.props || {} });
    }
    for (const [route, marks] of per) lines.set(`${bySha.get(l.on)}|${route}`, { photo: bySha.get(l.on), route, marks: marks.sort((a, b) => String(a.node).localeCompare(String(b.node))) });
  }
  const map = new Map();
  for (const v of views.filter(v => v.surface === 'map')) for (const m of v.marks || []) if (m.node) map.set(m.node, { geometry: m.geometry, props: m.props || {} });
  return { root, nodes, photos, lines, map };
}

const INFO = ['name', 'attribution', 'license', 'source'];

/**
 * 兩版差在哪：a 是上一版（沒有就是 null：第一版全部算新增），b 是這一版。
 * → { info: [{ key, from, to }], nodes: { added, removed, changed: [{ id, type, name, fields: [{ key, from, to }] }] },
 *     photos: { added, removed }（[{ name, key }]）, lines: { added, removed, changed }（[{ route, name, photo }]）, map: 改了形狀的節點數 }
 */
export function diffVersions(a, b) {
  const A = a ? contentOf(a) : { root: {}, nodes: new Map(), photos: new Map(), lines: new Map(), map: new Map() }, B = contentOf(b);
  const info = INFO.filter(k => !same(k === 'name' ? text(A.root[k]) : A.root[k], k === 'name' ? text(B.root[k]) : B.root[k]))
    .filter(() => a)   // 第一版沒有「改了什麼」
    .map(k => ({ key: k, from: A.root[k], to: B.root[k] }));
  const brief = (n) => ({ id: n.id, type: n.type, name: text(n.name), parent: n.parent || '' });
  const nodes = { added: [], removed: [], changed: [] };
  for (const [id, n] of B.nodes) {
    const o = A.nodes.get(id);
    if (!o) { nodes.added.push(brief(n)); continue; }
    const fa = fieldsOf(o), fb = fieldsOf(n);
    // 在哪一層（parent）給人看名稱，不是 id
    const where = (id, nodesOf) => text(nodesOf.get(id)?.name) || id;
    const fields = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].filter(k => !same(fa[k], fb[k]))
      .map(k => (k === 'parent' ? { key: k, from: where(fa[k], A.nodes), to: where(fb[k], B.nodes) } : { key: k, from: fa[k], to: fb[k] }));
    if (fields.length) nodes.changed.push({ ...brief(n), fields });
  }
  for (const [id, n] of A.nodes) if (!B.nodes.has(id)) nodes.removed.push(brief(n));
  const pic = (v, k) => ({ key: k, name: text(v.name) || v.href || '' });
  const photos = { added: [...B.photos].filter(([k]) => !A.photos.has(k)).map(([k, v]) => pic(v, k)), removed: [...A.photos].filter(([k]) => !B.photos.has(k)).map(([k, v]) => pic(v, k)) };
  const nameOf = (id) => text((B.nodes.get(id) || A.nodes.get(id))?.name) || '';
  const photoOf = (k) => text((B.photos.get(k) || A.photos.get(k))?.name) || '';
  const line = (l) => ({ route: l.route, name: nameOf(l.route), photo: photoOf(l.photo) });
  const lines = { added: [], removed: [], changed: [] };
  for (const [k, l] of B.lines) { const o = A.lines.get(k); if (!o) lines.added.push(line(l)); else if (!same(o.marks, l.marks)) lines.changed.push(line(l)); }
  for (const [k, l] of A.lines) if (!B.lines.has(k)) lines.removed.push(line(l));
  let map = 0;
  for (const id of new Set([...A.map.keys(), ...B.map.keys()])) if (!same(A.map.get(id), B.map.get(id))) map++;
  return { info, nodes, photos, lines, map: a ? map : 0 };
}

/** 一句話的摘要用的數字：{ routes: [+, -, 改], walls: [...], areas: [...], photos: [+, -], lines, map, info }；全是 0 代表內容一樣 */
export function counts(d) {
  const by = (list, types) => list.filter(n => types.includes(n.type)).length;
  const three = (types) => [by(d.nodes.added, types), by(d.nodes.removed, types), by(d.nodes.changed, types)];
  return {
    routes: three(['route']), walls: three(['wall', 'sector']), areas: three(['area', 'crag']),
    photos: [d.photos.added.length, d.photos.removed.length],
    lines: d.lines.added.length + d.lines.removed.length + d.lines.changed.length,
    map: d.map, info: d.info.length,
  };
}
export const isEmpty = (c) => !c.routes.some(Boolean) && !c.walls.some(Boolean) && !c.areas.some(Boolean) && !c.photos.some(Boolean) && !c.lines && !c.map && !c.info;

/**
 * 大改：一次刪掉很多（路線超過 3 條、岩壁超過 2 面、照片少了超過 3 張，或超過上一版的 10%，取大的）。
 * 大改不接在這本書後面，Studio 發成新的一本（原本那本照舊，大家預設看到的還是它的最新版），免得一次改爛整本。
 * a 上一版、b 這一版（{ root, docs }）→ 理由 [{ kind: 'routes' | 'walls' | 'photos', n }]，空的就是小改；沒有上一版回 []
 */
export function bigChange(a, b) {
  if (!a) return [];
  const A = contentOf(a), B = contentOf(b), c = counts(diffVersions(a, b));
  const total = (types) => [...A.nodes.values()].filter(n => types.includes(n.type)).length;
  const over = (n, all, min) => n > Math.max(min, Math.ceil(all * 0.1));
  const out = [];
  if (over(c.routes[1], total(['route']), 3)) out.push({ kind: 'routes', n: c.routes[1] });
  if (over(c.walls[1], total(['wall', 'sector']), 2)) out.push({ kind: 'walls', n: c.walls[1] });
  const lost = A.photos.size - B.photos.size;
  if (over(lost, A.photos.size, 3)) out.push({ kind: 'photos', n: lost });
  return out;
}

/** 欄位的值給人看：難度 { yds: '5.11d' } → 5.11d，其他照原樣（太長的截短） */
export function show(v, max = 60) {
  if (v === undefined || v === null || v === '') return '—';
  let s = typeof v === 'object' && !Array.isArray(v) ? (v.zh ?? v.en ?? Object.values(v).filter(x => typeof x !== 'object').join(' / ')) : Array.isArray(v) ? v.join('、') : String(v);
  if (typeof s !== 'string') s = JSON.stringify(s);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
