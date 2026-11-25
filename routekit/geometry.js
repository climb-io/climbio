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
  // 點到外框邊的最短距離
  function edgeDist(x, y, poly) {
    let m = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [ax, ay] = poly[j], [bx, by] = poly[i], dx = bx - ax, dy = by - ay;
      const k = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      m = Math.min(m, Math.hypot(x - ax - k * dx, y - ay - k * dy));
    }
    return m;
  }
  // 點在裡面的所有岩點，面積小的在前
  function holdsUnder(holds, x, y) {
    return holds.filter(h => inPoly(x, y, h.poly)).map(h => [area(h.poly), h]).sort((a, b) => a[0] - b[0]).map(e => e[1]);
  }
  // 重疊岩點（面積小的在前）各自的圓點：會選到它（不在更小的候選裡）的範圍中，離所有候選邊界最遠的一點；
  // 完全重合或被較小候選覆蓋、沒有獨占區的，改在右側放帶引線的選點。Volume 圓點也避開其他小岩點。
  function overlapSpots(cands, W, H, neighbors = []) {
    const b = bbox(cands.flatMap(h => h.poly)), step = Math.max(b.x1 - b.x0, b.y1 - b.y0) / 40, spots = new Map();
    const targets = new Set(cands);
    const pool = (neighbors.length ? [...cands, ...neighbors].sort((a, b) => area(a.poly) - area(b.poly)) : cands).map(h => ({ h, box: bbox(h.poly) }));
    for (let y = b.y0 + step / 2; y < b.y1; y += step) for (let x = b.x0 + step / 2; x < b.x1; x += step) {
      const h = pool.find(({ h, box }) => x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1 && inPoly(x, y, h.poly))?.h;
      if (!targets.has(h)) continue;
      let d = edgeDist(x, y, h.poly);
      for (const { h: other, box } of pool) {
        if (other === h || x < box.x0 - d || x > box.x1 + d || y < box.y0 - d || y > box.y1 + d) continue;
        d = Math.min(d, edgeDist(x, y, other.poly));
      }
      const s = spots.get(h);
      if (!s || d > s.d) spots.set(h, { x, y, d });
    }
    const hidden = cands.filter(h => !spots.has(h)), pad = Math.min(step * 5, W / 8, H / 8);
    const span = Math.min(H - 2 * pad, Math.max(b.y1 - b.y0, pad * 2 * hidden.length));
    const top = Math.max(pad, Math.min(H - pad - span, (b.y0 + b.y1 - span) / 2));
    hidden.forEach((h, i) => {
      const anchor = edgePoint(h.poly, 1, 0, true);
      spots.set(h, { x: Math.max(pad, Math.min(W - pad, b.x1 + pad)), y: top + span * (i + 0.5) / hidden.length, anchor });
    });
    return spots;
  }
  // 選候選：先看實際畫出來的圓點，再看點在哪顆外框裡；圓點外的容錯區只在沒有點到岩點時使用。
  function pickOverlap(cands, spots, x, y, radius, direct = null) {
    const dots = cands.map(h => ({ h, d: Math.hypot(x - spots.get(h).x, y - spots.get(h).y) })).sort((a, b) => a.d - b.d);
    const dot = dots[0];
    if (!dot) return null;
    if (dot.d <= radius * 10 / 16) return dot.h;
    return direct || cands.find(c => inPoly(x, y, c.poly)) || (dot.d <= radius ? dot.h : null);
  }
  // 手畫的一圈軌跡 → 簡化的多邊形外框（觸控長按「自由畫」用）：限制在 W×H 的照片裡，頭尾自動接起來，
  // Ramer–Douglas–Peucker 簡化（容差＝外接框對角線的 3%，至少 minTol），頂點最多 maxN 個；畫得太小或面積太小回傳 null
  function freehandPoly(pts, W, H, { minTol = 1.5, minSize = 6, maxN = 20 } = {}) {
    const P = [];
    for (const [x, y] of pts) {
      const q = [Math.min(W, Math.max(0, x)), Math.min(H, Math.max(0, y))], l = P[P.length - 1];
      if (!l || l[0] !== q[0] || l[1] !== q[1]) P.push(q);
    }
    if (P.length < 3) return null;
    const b = bbox(P);
    if (b.x1 - b.x0 < minSize || b.y1 - b.y0 < minSize) return null;
    const rdp = (a, eps) => {   // 開放折線；回傳保留的點
      if (a.length < 3) return a;
      const [x0, y0] = a[0], [x1, y1] = a[a.length - 1], dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
      let m = -1, mi = 0;
      for (let i = 1; i < a.length - 1; i++) {
        const d = Math.abs(dy * (a[i][0] - x0) - dx * (a[i][1] - y0)) / len;
        if (d > m) { m = d; mi = i; }
      }
      if (m <= eps) return [a[0], a[a.length - 1]];
      return rdp(a.slice(0, mi + 1), eps).slice(0, -1).concat(rdp(a.slice(mi), eps));
    };
    // 閉合多邊形：從離中心最遠的點切成兩半各自簡化，避免起點剛好落在彎角上被吃掉
    const diag = Math.hypot(b.x1 - b.x0, b.y1 - b.y0), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    let s = 0;
    for (let i = 1; i < P.length; i++) if (Math.hypot(P[i][0] - cx, P[i][1] - cy) > Math.hypot(P[s][0] - cx, P[s][1] - cy)) s = i;
    const R = P.slice(s).concat(P.slice(0, s)); R.push(R[0]);
    let eps = Math.max(minTol, diag * 0.03), out;
    for (let t = 0; t < 12; t++, eps *= 1.3) {
      const half = R.findIndex((p, i) => i > 0 && i >= R.length >> 1);
      out = rdp(R.slice(0, half + 1), eps).slice(0, -1).concat(rdp(R.slice(half), eps)).slice(0, -1);
      if (out.length <= maxN) break;
    }
    if (out.length < 3 || area(out) < minSize * minSize) return null;
    return out.map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]);
  }
  return { bbox, tracePoly, inPoly, area, edgePoint, edgeDist, freehandPoly, holdsUnder, overlapSpots, pickOverlap, stripTip, edgeTangent, strokeOutside, holdAt };
});
