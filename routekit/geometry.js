// RouteKit geometry：外框（poly＝[[x, y], ...]，照片像素）的幾何與描邊
// 瀏覽器用 <script> 依序載入，掛在全域 RouteKit；Node 用 require。不依賴任何 App 的狀態，資料都從參數傳入。
// English: RouteKit geometry: hold outline (poly) geometry and stroking. AGPL-3.0, no app state.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else Object.assign(root.RouteKit || (root.RouteKit = {}), factory());
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function bbox(poly) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { x0, y0, x1, y1 };
  }
  function tracePoly(c, poly) {
    c.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) c.lineTo(poly[i][0], poly[i][1]);
    c.closePath();
  }
  function inPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function area(poly) {
    let a = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
    return Math.abs(a / 2);
  }
  // 岩點在這個方向上最外側的點（外框頂點裡投影最大的）：膠帶從這裡接出，水平就是最右／最左點，斜的就是那個角；
  // 不用「中心往外射出」的交點：凹形岩點的中心可能在岩點外，膠帶會穿過岩點中間
  function edgePoint(poly, dx, dy, centerEdge = false) {
    let best = poly[0], m = -Infinity;
    for (const p of poly) { const v = p[0] * dx + p[1] * dy; if (v > m) { m = v; best = p; } }
    // 腳點遇到平直的外緣時貼在邊的中間，避免只碰到角落。
    if (centerEdge) {
      let longest = 0;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[j], b = poly[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (Math.abs(a[0] * dx + a[1] * dy - m) < 1e-6 && Math.abs(b[0] * dx + b[1] * dy - m) < 1e-6 && len > longest) {
          best = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; longest = len;
        }
      }
    }
    return best;
  }
  // 膠帶有寬度：中心線從最外側的點接出時，膠帶兩側會蓋到岩點（方向沒有垂直岩點邊緣時特別明顯）。
  // 所以看膠帶寬度範圍內（中心線左右 w）岩點最外側在哪裡，從那裡接出；c 是中心線在垂直方向上的位置
  function stripTip(poly, dx, dy, c, w) {
    const nx = -dy, ny = dx; let m = -Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [ax, ay] = poly[j], [bx, by] = poly[i];
      for (let q = 0; q < 4; q++) {
        const x = ax + (bx - ax) * q / 4, y = ay + (by - ay) * q / 4;
        if (Math.abs(x * nx + y * ny - c) <= w) m = Math.max(m, x * dx + y * dy);
      }
    }
    return m === -Infinity ? null : [c * nx + m * dx, c * ny + m * dy];
  }
  // 岩點邊緣在 (x, y) 附近的走向：把半徑 R 內的邊加起來（外框的頂點順序一致，局部不會互相抵消），回傳 [單位切線, 直度]；
  // 直度＝加起來的長度／各段長度和，直的邊是 1，角落（邊在這裡轉彎）比較小
  function edgeTangent(poly, x, y, R) {
    let tx = 0, ty = 0, sum = 0, nd = Infinity, near = null;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [ax, ay] = poly[j], [bx, by] = poly[i], mx = (ax + bx) / 2, my = (ay + by) / 2, dd = Math.hypot(mx - x, my - y);
      if (dd <= R) { tx += bx - ax; ty += by - ay; sum += Math.hypot(bx - ax, by - ay); }
      if (dd < nd) { nd = dd; near = [bx - ax, by - ay]; }
    }
    if (!sum && near) { [tx, ty] = near; sum = Math.hypot(tx, ty); }
    const l = Math.hypot(tx, ty) || 1;
    return [tx / l, ty / l, sum ? l / sum : 1];
  }
  // 外框線只畫在外框的外側，不壓到岩點：把外框裡面裁掉，線寬加倍
  function strokeOutside(c, poly, width) {
    c.save();
    c.beginPath(); c.rect(-1e5, -1e5, 2e5, 2e5); tracePoly(c, poly); c.clip('evenodd');
    c.beginPath(); tracePoly(c, poly); c.lineWidth = width * 2; c.stroke();
    c.restore();
  }

  // (x, y) 點到的岩點：外框包住這一點的岩點裡最小的那顆（大岩點、volume 上的小點點得到）；沒有回傳 null
  function holdAt(holds, x, y) {
    let best = null, bestA = Infinity;
    for (const h of holds) if (inPoly(x, y, h.poly)) { const a = area(h.poly); if (a < bestA) { bestA = a; best = h; } }
    return best;
  }
  return { bbox, tracePoly, inPoly, area, edgePoint, stripTip, edgeTangent, strokeOutside, holdAt };
});
