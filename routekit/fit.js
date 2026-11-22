// RouteKit fit：看路線圖的起始視角（路線視角）——岩點貓與內嵌頁同一份算法。
// 路線（所在那一組）的岩點加上起攀、完攀的標籤（圓和膠帶）剛好放進畫面（四周留邊、上面避開工具列），最多放大到照片填滿畫面，路線放中間。
// 橫的照片在直的手機上不會上下大片黑邊；很寬的路線放大得少，最寬就是整張照片。
// 路線視角分組：照左右滑的順序把相鄰路線併成一組，共用整組岩點範圍的視角，同一組滑動時照片大小、位置都不變。
// 併進來後組裡每條都還保留自己視角至少 KEEP（0.7）的放大才併，範圍差很多的路線（大牆的不同區）照樣各自放大；沒有岩點的路線看整張、自成一組。
// 純函式、不碰畫面：幾何（W、H、bw、bh、maxScale）由外層給（Viewport 的 geo，或岩點貓自己的視角）。
// English: RouteKit fit: the route view (initial framing of a route) shared by Hold Cat and the embed page: route holds plus start/top labels fit the screen, adjacent routes grouped.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./geometry.js'), require('./image.js'));
  else Object.assign(root.RouteKit || (root.RouteKit = {}), factory(root.RouteKit, root.RouteKit));
})(typeof self !== 'undefined' ? self : this, function (G, I) {
  'use strict';
  const KEEP = 0.7;
  const union = (a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
  /**
   * 把照片上的範圍 b（四周留 side、上面讓出 topInset）放進畫面的視角（還沒套邊界），最多放大到照片填滿畫面。
   * g：{ W, H, bw, bh, maxScale }（框的大小、s=1 時照片的大小、最大放大）；photoW：照片寬（像素）。回傳 { s, tx, ty }（s 是相對 s=1 的倍數）。
   */
  function fitBoxIn(b, g, { photoW, topInset = 0, side = 32 }) {
    const k = g.bw / photoW;
    const s = Math.min(g.maxScale, Math.max(1, Math.min(Math.max(g.W / g.bw, g.H / g.bh), (g.W - 2 * side) / ((b.x1 - b.x0) * k), (g.H - topInset - side) / ((b.y1 - b.y0) * k))));
    const k1 = k * s;
    return { s, tx: g.W / 2 - (b.x0 + b.x1) / 2 * k1, ty: (topInset + g.H - side) / 2 - (b.y0 + b.y1) / 2 * k1 };
  }
  /**
   * 路線 r 所在那一組的岩點範圍（照片座標）；沒有岩點、不在 routes 裡回傳 null。
   * routes：照左右滑的順序排好的路線；holdsOf(q)：路線 q 要算進視角的岩點；labelRects(holds, q)：標籤的範圍（要把標籤也放進畫面才給，回傳 [{ x0, y0, x1, y1 }]）；
   * fit(box)：回傳 { s }（這個範圍的視角倍數，併組時比較用）
   */
  function groupBox(routes, r, { holdsOf, labelRects = null, fit }) {
    let box = null, keep = 0, found = false;
    const grow = (b, q, hs) => (!b || !labelRects ? b : labelRects(hs, q).reduce(union, b));
    for (const q of routes) {
      const hs = holdsOf(q), b = hs.length ? grow(G.bbox(hs.flatMap((h) => h.poly)), q, hs) : null, own = b ? fit(b).s : 0;
      const u = b && box && union(box, b);
      if (u && fit(u).s >= KEEP * Math.max(keep, own)) { box = u; keep = Math.max(keep, own); }
      else { if (found) break; box = b; keep = own; }
      if (q === r) found = true;
    }
    return found ? box : null;
  }
  /**
   * 路線視角：{ s, tx, ty }，沒有岩點回傳 null（外層用整張照片）。
   * scene：RouteScene（用它排標籤）；routes：照左右滑的順序排好的路線（只有一條就傳 [route]）；g：幾何（見 fitBoxIn）；
   * opts：{ topInset（上面工具列蓋住的高度）、side（四周留邊，預設 32）、holdsOf（預設：路線用到的岩點）、fit（自己算視角倍數，岩點貓要先套邊界）}
   */
  function routeFit(scene, routes, r, g, { topInset = 0, side = 32, holdsOf = null, fit = null } = {}) {
    const hof = holdsOf || ((q) => I.routeHolds(q, scene.holds)), fitB = fit || ((b) => fitBoxIn(b, g, { photoW: scene.w, topInset, side }));
    const unitOf = (q) => labelUnitOf(scene, routes, q, g, { topInset, side, holdsOf: hof, fit: fitB });
    const labelRects = (hs, q) => scene.labels(hs, q, unitOf(q), true).flatMap((l) => (l.foot ? [l.rect] : [l.rect, l.tape]));
    const b = groupBox(routes, r, { holdsOf: hof, labelRects, fit: fitB });
    return b ? fitB(b) : null;
  }
  /**
   * 路線 q 的標籤（起攀、完攀膠帶、順序標記）大小（照片像素）：路線視角時是固定的螢幕大小，跟目前縮到哪無關（放大時跟著照片一起放大，像真的貼在牆上）。
   * 看線、定線、左右滑的下一頁、分享圖都用同一個值，靜態畫面才會一樣。要看「只有岩點」的視角（不含標籤），不然算標籤大小時又回頭問視角，繞圈。
   */
  function labelUnitOf(scene, routes, q, g, { topInset = 0, side = 32, holdsOf = null, fit = null } = {}) {
    const hof = holdsOf || ((x) => I.routeHolds(x, scene.holds)), fitB = fit || ((b) => fitBoxIn(b, g, { photoW: scene.w, topInset, side }));
    const hb = groupBox(routes, q, { holdsOf: hof, fit: fitB });
    return Math.max(Math.max(scene.w, scene.h) / 1000, scene.w / (g.bw * (hb ? fitB(hb).s : 1)) * 0.85);
  }
  return { fitBoxIn, groupBox, routeFit, labelUnitOf, FIT_KEEP: KEEP };
});
