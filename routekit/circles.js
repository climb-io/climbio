// RouteKit circles：圈點格式的路線（例如 RouteMake：照片上一顆一個圈）和 RouteKit 路線互轉。
// 圈點 { x, y, t, r }：x、y 是圈圈中心，佔照片寬／高的百分比；t 是 s 起攀、h 手點、t 完攀；r 是 1 小、2 中、3 大，直徑佔照片寬的 4.5%／7%／10%。
// 瀏覽器用 <script> 依序載入，掛在全域 RouteKit；Node 用 require。
// English: RouteKit circles: convert circle-marked routes ({ x, y, t, r } in percent, e.g. RouteMake) to and from RouteKit routes.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./geometry.js'), require('./image.js'));
  else Object.assign(root.RouteKit || (root.RouteKit = {}), factory(root.RouteKit, root.RouteKit));
})(typeof self !== 'undefined' ? self : this, function (G, I) {
  'use strict';
  const CIRCLE_DIAMETER = { 1: 0.045, 2: 0.07, 3: 0.10 };   // 佔照片寬
  const SIDES = 24;
  const circlePoly = (cx, cy, rad) => Array.from({ length: SIDES }, (_, i) => {
    const a = (i / SIDES) * 2 * Math.PI;
    return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
  });
  // 圈點 → 路線 { holds, shapes }（w×h：照片像素）。holds：牆上的岩點 [{ id, poly }]，給了就把圈圈中心對到包住它的岩點；
  // 對不到（或沒給）的用圓形外框放進 shapes，id 是 c0、c1…（照圈點的順序）。不認得的 t 當手點
  function fromCircles(circles, w, h, { holds = [] } = {}) {
    const route = { holds: {}, shapes: {} };
    circles.forEach((c, i) => {
      const x = c.x / 100 * w, y = c.y / 100 * h, t = c.t === 's' || c.t === 't' ? c.t : 'h';
      let hold = G.holdAt(holds, x, y);
      if (!hold) {
        hold = { id: `c${i}`, poly: circlePoly(x, y, (CIRCLE_DIAMETER[c.r] || CIRCLE_DIAMETER[2]) * w / 2) };
        route.shapes[hold.id] = hold;
      }
      if (route.holds[hold.id] !== 's' && route.holds[hold.id] !== 't') route.holds[hold.id] = t;   // 兩個圈點在同一顆：起攀、完攀優先
    });
    if (!Object.keys(route.shapes).length) delete route.shapes;
    return route;
  }
  // 路線 → 圈點（holds：牆上的岩點；w×h：照片像素）。圈圈放在岩點外框的外接框中心，大小取最接近的 r；
  // 腳點（f）圈點格式沒有，當手點；出手順序（seq）帶不過去
  function toCircles(route, holds, w, h) {
    const round = (v) => Math.round(v * 100) / 100;
    return I.routeHolds(route, holds).map((hold) => {
      const b = G.bbox(hold.poly), d = Math.max(b.x1 - b.x0, b.y1 - b.y0) / w;
      const r = +Object.keys(CIRCLE_DIAMETER).reduce((a, k) => Math.abs(CIRCLE_DIAMETER[k] - d) < Math.abs(CIRCLE_DIAMETER[a] - d) ? k : a);
      const t = route.holds[hold.id];
      return { x: round((b.x0 + b.x1) / 2 / w * 100), y: round((b.y0 + b.y1) / 2 / h * 100), t: t === 's' || t === 't' ? t : 'h', r };
    });
  }
  return { CIRCLE_DIAMETER, fromCircles, toCircles };
});
