// RouteKit format：Climbio 公開格式 v2（@climbio/format）的牆和路線 ↔ RouteKit 用的資料（fromFormat 讀、wallView／routesLayer 寫）。
// 牆＝照片畫面（hold 節點加 Polygon 標註）；路線＝疊在牆上的圖層（route 節點：props.holds、seq、grade）。
// 圖層的標註帶 props.route 的是只用在那條路線的外框（同一顆岩點在那條路線形狀不一樣，或畫面上沒有這顆）。
// 只轉換、不檢查：讀別人的檔案先用 @climbio/format 的 validate。
// 寫出去時，路線自帶的外框跟畫面上那顆一樣就不寫；不一樣的寫成圖層的標註；畫面沒有的岩點（自己畫的）是圖層的 hold 節點。
// English: Converts between a Climbio format v2 photo view (wall) with route layers and RouteKit holds and routes.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else Object.assign(root.RouteKit || (root.RouteKit = {}), factory());
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // 名稱：字串，或語言代碼 → 字串（取第一個）
  const text = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? String(Object.values(v)[0] || '') : '');
  // 難度 { 系統: 值 } → 字串（V 級、Fontainebleau、段級優先）
  const grade = (g) => (g && typeof g === 'object' ? String(g.v || g.font || g.dan || Object.values(g)[0] || '') : '');
  const polyOf = (m) => (m.geometry && m.geometry.type === 'Polygon' ? m.geometry.coordinates[0].slice(0, -1).map(p => [p[0], p[1]]) : null);
  const sourceOf = (x) => (x && x.props && x.props.source) || undefined;
  const retiredOf = (x) => !!(x && x.props && x.props.retired);   // 停用的岩點：公開過、之後被刪掉或合併掉；留在畫面裡讓別人的舊路線指得到，新路線看不到
  const hold = (id, poly, source, retired) => ({ id, poly, ...(source ? { source } : {}), ...(retired ? { retired: true } : {}) });

  // view：照片畫面；layers：疊在它上面的路線圖層 → { w, h, holds: [{ id, poly, source? }], routes: [{ id, name, grade, holds, seq?, shapes, author, t, u? }] }
  function fromFormat(view, layers = []) {
    const kinds = new Map((view.nodes || []).map(n => [n.id, n])), holds = [], at = new Map();
    for (const m of view.marks || []) {
      const n = kinds.get(m.node), poly = polyOf(m);
      if (!n || n.type !== 'hold' || !poly || at.has(n.id)) continue;
      const h = hold(n.id, poly, sourceOf(n), retiredOf(n)); holds.push(h); at.set(h.id, h);
    }
    const routes = [];
    for (const layer of layers) {
      const own = new Map();   // 路線 id → 岩點 id → 這條路線自己的外框
      for (const m of layer.marks || []) {
        const rid = m.props && m.props.route, poly = polyOf(m);
        if (!rid || !m.node || !poly) continue;
        if (!own.has(rid)) own.set(rid, new Map());
        own.get(rid).set(m.node, hold(m.node, poly, sourceOf(m)));
      }
      for (const n of layer.nodes || []) {
        if (n.type !== 'route') continue;
        const p = n.props || {}, hs = p.holds && typeof p.holds === 'object' ? { ...p.holds } : {}, mine = own.get(n.id) || new Map(), shapes = {};
        for (const id of Object.keys(hs)) { const s = mine.get(id) || at.get(id); if (s) { const { retired, ...rest } = s; shapes[id] = { ...rest, poly: s.poly.map(q => q.slice()) }; } }
        routes.push({ id: n.id, name: text(n.name), grade: grade(p.grade), holds: hs, ...(Array.isArray(p.seq) ? { seq: p.seq.slice() } : {}), shapes,
          author: n.author || '', t: n.t || 0, ...(p['climbio:device'] ? { u: String(p['climbio:device']) } : {}), ...(p['climbio:color'] ? { color: String(p['climbio:color']) } : {}) });
      }
    }
    return { w: view.w, h: view.h, holds, routes };
  }

  const LICENSE = 'CC-BY-SA-4.0', NODE_ID = /^[0-9a-z][0-9a-z_-]{0,63}$/, ROLES = ['s', 'h', 'f', 't'];
  const validPoly = (poly) => Array.isArray(poly) && poly.length >= 3 && poly.every(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  const samePoly = (a, b) => a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);
  // 多邊形：第一點和最後一點相同；座標夾在照片範圍內
  const polygon = (poly, w, h) => {
    const ring = poly.map(p => [Math.min(w, Math.max(0, p[0])), Math.min(h, Math.max(0, p[1]))]);
    return { type: 'Polygon', coordinates: [[...ring, ring[0].slice()]] };
  };
  // 難度字串 → { 系統: 值 }：V 級、段級（dan）、其他當 Fontainebleau
  const gradeOf = (g) => (!g ? undefined : /^V(B|\d+)$/.test(g) ? { v: g } : /[級段]$/.test(g) ? { dan: g } : { font: g });

  // 牆的照片畫面。holds：原始岩點檔的岩點（x.source：怎麼來的，可不給）；href：照片；thumb：縮圖（相對路徑或網址，可不給）；
  // attribution：照片的署名；license、author、sha256（照片的雜湊）、props（其他要帶的，例如裁切範圍）都可不給
  function wallView({ pid, name = '', w, h, holds = [], href, thumb = '', attribution = '', t = 0, license = LICENSE, author = '', sha256 = '', props = {} }) {
    const hs = holds.filter(x => x && NODE_ID.test(x.id || '') && validPoly(x.poly));
    const p = { ...(thumb ? { thumb } : {}), ...props };
    return {
      climbio: 2, kind: 'view', surface: 'photo', id: pid, ...(name ? { name: String(name) } : {}), t, license,
      attribution: attribution || 'Climbio', ...(author ? { author } : {}), origin: 'self', href, w, h, mime: 'image/jpeg', ...(sha256 ? { sha256 } : {}),
      ...(Object.keys(p).length ? { props: p } : {}),
      nodes: hs.map(x => ({ id: x.id, type: 'hold', ...(x.source || x.retired ? { props: { ...(x.source ? { source: x.source } : {}), ...(x.retired ? { retired: true } : {}) } } : {}) })),
      marks: hs.map(x => ({ node: x.id, geometry: polygon(x.poly, w, h) })),
    };
  }

  // 疊在牆上的路線圖層。holds：畫面上的岩點（原始岩點檔）；routes：App 的路線（id、name、grade、holds、seq、shapes、author、t、u）；
  // gym：這面牆的岩館；thumb：牆的縮圖；props：其他要帶的（例如版本）
  function routesLayer({ id, pid, href, w, h, holds = [], routes = [], gym = '', thumb = '', props = {}, attribution = '', name = '', t, license = LICENSE, author = '' }) {
    const inView = new Map(holds.map(x => [x.id, x.poly])), nodes = [], marks = [], extra = new Set();
    for (const r of routes) {
      const hs = Object.fromEntries(Object.entries(r.holds || {}).filter(([k, v]) => NODE_ID.test(k) && ROLES.includes(v)));
      const seq = Array.isArray(r.seq) ? r.seq.filter(k => k in hs) : [];
      nodes.push({ id: r.id, type: 'route', ...(r.name ? { name: String(r.name) } : {}), ...(r.author ? { author: String(r.author) } : {}), t: Number(r.t) || 0,
        props: { ...(gradeOf(r.grade) ? { grade: gradeOf(r.grade) } : {}), holds: hs, ...(seq.length ? { seq } : {}), ...(r.u ? { 'climbio:device': String(r.u) } : {}), ...(r.color ? { 'climbio:color': String(r.color) } : {}) } });
      for (const [k, s] of Object.entries(r.shapes || {})) {
        if (!(k in hs) || !s || !validPoly(s.poly) || (inView.has(k) && samePoly(inView.get(k), s.poly))) continue;
        if (!inView.has(k)) extra.add(k);
        marks.push({ node: k, geometry: polygon(s.poly, w, h), props: { route: r.id, ...(s.source ? { source: s.source } : {}) } });
      }
    }
    const p = { ...(gym ? { gym } : {}), ...(thumb ? { thumb } : {}), ...props };
    return {
      climbio: 2, kind: 'layer', id, on: pid, href, ...(name ? { name: String(name) } : {}), t: t === undefined ? Math.max(0, ...nodes.map(n => n.t)) : t, license, attribution: attribution || 'Climbio', ...(author ? { author } : {}),
      ...(Object.keys(p).length ? { props: p } : {}),
      nodes: [...[...extra].map(k => ({ id: k, type: 'hold' })), ...nodes], marks,
    };
  }

  const bytesOf = (o) => new TextEncoder().encode(JSON.stringify(o));
  const thumbPathOf = (pid) => `${pid}.thumb.jpg`;

  // 一面牆發佈時的檔案（Wall 發佈、岩點貓分享共用）：照片畫面 `{pid}.json`、照片 `{pid}.jpg`、縮圖 `{pid}.thumb.jpg`（可不給）、
  // 路線圖層 `{layerId}.json`（layerId 沒給就沒有圖層）。畫面和圖層的 props.thumb 指到縮圖，讀的人（找牆面、岩點貓）優先用它。
  // photo、thumb：Uint8Array（JPEG）；view、layer：額外要帶的欄位（license、author、sha256、props、name、t…）
  // → { files: [{ path, bytes }], view, layer, entry（找牆面的入口：有圖層是圖層，沒有是畫面）, thumbPath }
  function wallFiles({ pid, layerId = '', name = '', w, h, holds = [], routes = [], gym = '', photo, thumb = null, attribution = '', t = 0, view: v = {}, layer: l = {} }) {
    const thumbPath = thumb ? thumbPathOf(pid) : '';
    const view = wallView({ pid, name, w, h, holds, href: `${pid}.jpg`, thumb: thumbPath, attribution, t, ...v });
    const layer = layerId ? routesLayer({ id: layerId, pid, href: `${pid}.json`, w, h, holds, routes, gym, thumb: thumbPath, attribution, ...l }) : null;
    const files = [{ path: `${pid}.json`, bytes: bytesOf(view) }, { path: `${pid}.jpg`, bytes: photo },
      ...(thumb ? [{ path: thumbPath, bytes: thumb }] : []), ...(layer ? [{ path: `${layerId}.json`, bytes: bytesOf(layer) }] : [])];
    return { files, view, layer, entry: layer ? `${layerId}.json` : `${pid}.json`, thumbPath };
  }

  return { fromFormat, wallView, routesLayer, wallFiles, thumbPathOf };
});
