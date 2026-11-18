// 站對外的公開資料改寫成 Climbio 公開格式 v2（format/README.md、VOCABULARY.md）：
//   牆＝照片畫面（照片＋原始岩點檔的岩點，id 是照片編號）；路線＝疊在牆上的圖層（route 節點：props.holds、seq、grade）；
//   站的清單、岩館的公開牆面、總目錄＝組合。
// 路線自帶的外框（route.shapes）跟畫面上那顆一樣就不寫；不一樣的寫成圖層的標註，props.route 是只用在哪條路線；
// 畫面沒有的岩點（自己畫的）是圖層的 hold 節點。畫面只跟照片和原始岩點檔有關，內容不會變。
const { createHash } = require('node:crypto');
const LICENSE = 'CC-BY-SA-4.0';
const FILE_ID = /^[0-9a-z]{12,64}$/, NODE_ID = /^[0-9a-z][0-9a-z_-]{0,63}$/, ROLES = ['s', 'h', 'f', 't'];
// 沒有隨機 id 的東西（站、岩館清單、路線圖層）：從網址算固定的 16 碼，每次輸出都一樣
const fixedId = (...parts) => createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 16);
const fileId = (id) => (FILE_ID.test(id || '') ? { id } : {});
const validPoly = (poly) => Array.isArray(poly) && poly.length >= 3 && poly.every(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
const samePoly = (a, b) => a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);
// 多邊形：第一點和最後一點相同；畫面上的座標夾在照片範圍內
const polygon = (poly, w, h) => {
  const ring = poly.map(p => [Math.min(w, Math.max(0, p[0])), Math.min(h, Math.max(0, p[1]))]);
  return { type: 'Polygon', coordinates: [[...ring, ring[0].slice()]] };
};
// 難度字串 → { 系統: 值 }：V 級、段級（dan，Climbio 自己的詞彙）、其他當 Fontainebleau
const gradeOf = (g) => (!g ? undefined : /^V(B|\d+)$/.test(g) ? { v: g } : /[級段]$/.test(g) ? { dan: g } : { font: g });

// 牆的照片畫面。base：原始岩點檔 { name, w, h, holds }；attribution：照片的署名（第一個分享這面牆的人）；t：第一次分享的時間
function wallView({ pid, base, attribution, t }) {
  const holds = (base.holds || []).filter(x => x && NODE_ID.test(x.id || '') && validPoly(x.poly));
  return {
    climbio: 2, kind: 'view', surface: 'photo', id: pid, ...(base.name ? { name: String(base.name) } : {}), t, license: LICENSE,
    attribution: attribution || 'Climbio', origin: 'self', href: 'photo.jpg', w: base.w, h: base.h, mime: 'image/jpeg',
    ...(base.thumb ? { props: { thumb: 'thumb.jpg' } } : {}),
    nodes: holds.map(x => ({ id: x.id, type: 'hold' })),
    marks: holds.map(x => ({ node: x.id, geometry: polygon(x.poly, base.w, base.h) })),
  };
}

// 疊在牆上的路線圖層。routes：[{ route（App 的路線：id、name、grade、holds、seq、shapes、author、t、u）, gym }]，最新的在前。
// thumb：牆的縮圖網址、preview：極小預覽圖（data: 網址）：收線的人拿到圖層就能先畫，牆和縮圖同時下載
function routesLayer({ id, pid, href, base, routes, thumb = '', preview = '' }) {
  const inView = new Map((base.holds || []).map(x => [x.id, x.poly])), nodes = [], marks = [], extra = new Set();
  for (const { route: r } of routes) {
    const holds = Object.fromEntries(Object.entries(r.holds || {}).filter(([k, v]) => NODE_ID.test(k) && ROLES.includes(v)));
    const seq = Array.isArray(r.seq) ? r.seq.filter(k => k in holds) : [];
    nodes.push({ id: r.id, type: 'route', ...(r.name ? { name: String(r.name) } : {}), ...(r.author ? { author: String(r.author) } : {}), t: Number(r.t) || 0,
      props: { ...(gradeOf(r.grade) ? { grade: gradeOf(r.grade) } : {}), holds, ...(seq.length ? { seq } : {}), ...(r.u ? { 'climbio:device': String(r.u) } : {}) } });
    for (const [k, s] of Object.entries(r.shapes || {})) {
      if (!(k in holds) || !s || !validPoly(s.poly) || (inView.has(k) && samePoly(inView.get(k), s.poly))) continue;
      if (!inView.has(k)) extra.add(k);
      marks.push({ node: k, geometry: polygon(s.poly, base.w, base.h), props: { route: r.id, ...(s.source ? { source: s.source } : {}) } });
    }
  }
  const gym = routes.length ? String(routes[0].gym || '') : '';
  const props = { ...(gym ? { gym } : {}), ...(thumb ? { thumb } : {}), ...(preview ? { preview } : {}) };
  return {
    climbio: 2, kind: 'layer', id, on: pid, href, t: Math.max(0, ...nodes.map(n => n.t)), license: LICENSE,
    ...(Object.keys(props).length ? { props } : {}),
    nodes: [...[...extra].map(k => ({ id: k, type: 'hold' })), ...nodes], marks,
  };
}

// 組合：站（/climbio.json）、岩館的公開牆面（/w/gym/{岩館}.json）、總目錄（/dir/gyms.json）
const set = (type, id, name, items, props) => ({
  climbio: 2, kind: 'set', type, id, name, t: Math.max(0, ...items.map(x => x.t || 0)), license: LICENSE, ...(props ? { props } : {}), items,
});
// gyms：[{ gym, n: 公開牆面數, t }]
const siteSet = ({ origin, listed, gyms }) => set('site', fixedId(origin), 'Climbio',
  gyms.map(g => ({ href: `w/gym/${encodeURIComponent(g.gym)}.json`, name: g.gym, t: g.t, props: { walls: g.n } })), { url: origin, listed });
// walls：[{ pid, name, thumb, routes: 公開路線數, t, href }]；href＝這面牆從哪裡收（路線圖層，或開放資料集裡發佈的畫面）
const gymSet = ({ origin, gym, walls }) => set('walls', fixedId(origin, 'gym', gym), gym,
  walls.map(x => ({ href: x.href, ...fileId(x.pid), name: x.name, t: x.t, props: { ...(x.thumb ? { thumb: x.thumb } : {}), routes: x.routes } })));
// gyms：[{ gym, n, t, href: 那個站的岩館清單, site: 站名 }]
const directorySet = ({ origin, gyms }) => set('directory', fixedId(origin, 'directory'), 'Climbio',
  gyms.map(g => ({ href: g.href, name: g.gym, t: g.t, props: { walls: g.n, site: g.site } })));

module.exports = { LICENSE, fixedId, gradeOf, wallView, routesLayer, siteSet, gymSet, directorySet };
