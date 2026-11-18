// 電腦版精修頁的外框幾何：遮罩 ↔ 多邊形、平滑、合併、找重複、修自交。
// 瀏覽器和 Node 都能跑（refine/geometry.test.js 用 Node 測）。
// 遮罩一律是 { w, h, d: Uint8Array }（0／1）；多邊形是 [[x, y], …]（原圖座標）。
(function (root) {
  'use strict';
  const mk = (w, h) => ({ w, h, d: new Uint8Array(w * h) });
  const count = m => { let n = 0; for (let i = 0; i < m.d.length; i++) n += m.d[i]; return n; };

  // ---- 多邊形 → 遮罩（同 cv2.fillPoly：邊界上的像素也算在裡面）----
  function fillPoly(m, poly, ox = 0, oy = 0) {
    const P = poly.map(p => [Math.round(p[0] - ox), Math.round(p[1] - oy)]), n = P.length;
    const set = (x, y) => { if (x >= 0 && y >= 0 && x < m.w && y < m.h) m.d[y * m.w + x] = 1; };
    for (let y = 0; y < m.h; y++) {   // 掃描線填色（奇偶規則）
      const xs = [];
      for (let i = 0; i < n; i++) {
        const a = P[i], b = P[(i + 1) % n];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) set(x, y);
    }
    for (let i = 0; i < n; i++) {   // 邊線
      let [x0, y0] = P[i]; const [x1, y1] = P[(i + 1) % n], dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let e = dx + dy;
      for (;;) { set(x0, y0); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
    }
    return m;
  }
  // 多邊形的遮罩，外面多留 pad 格 → { m, ox, oy }（同 poly_mask）
  function polyMask(poly, W, H, pad = 2) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of poly) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    const ox = Math.max(Math.floor(x0) - pad, 0), oy = Math.max(Math.floor(y0) - pad, 0), ex = Math.min(Math.ceil(x1) + pad, W), ey = Math.min(Math.ceil(y1) + pad, H);
    return { m: fillPoly(mk(ex - ox, ey - oy), poly, ox, oy), ox, oy };
  }

  // ---- 連通塊、補洞 ----
  function components(m) {   // 4 連通 → { lab: Int32Array, n（含背景 0）, size: [] }
    const lab = new Int32Array(m.w * m.h), size = [0]; let n = 1; const st = [];
    for (let s = 0; s < lab.length; s++) {
      if (!m.d[s] || lab[s]) continue;
      let c = 0; lab[s] = n; st.push(s);
      while (st.length) {
        const i = st.pop(); c++; const x = i % m.w, y = (i - x) / m.w;
        if (x > 0 && m.d[i - 1] && !lab[i - 1]) { lab[i - 1] = n; st.push(i - 1); }
        if (x < m.w - 1 && m.d[i + 1] && !lab[i + 1]) { lab[i + 1] = n; st.push(i + 1); }
        if (y > 0 && m.d[i - m.w] && !lab[i - m.w]) { lab[i - m.w] = n; st.push(i - m.w); }
        if (y < m.h - 1 && m.d[i + m.w] && !lab[i + m.w]) { lab[i + m.w] = n; st.push(i + m.w); }
      }
      size.push(c); n++;
    }
    return { lab, n, size };
  }
  function keepBiggest(m) {
    const { lab, n, size } = components(m);
    if (n <= 1) return m;
    let k = 1; for (let i = 2; i < n; i++) if (size[i] > size[k]) k = i;
    const o = mk(m.w, m.h); for (let i = 0; i < lab.length; i++) o.d[i] = lab[i] === k ? 1 : 0;
    return o;
  }
  function fillHoles(m) {   // 從外面灌水，灌不到的就是洞
    const W = m.w + 2, H = m.h + 2, out = new Uint8Array(W * H).fill(1);   // 1＝背景或洞
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) out[(y + 1) * W + x + 1] = m.d[y * m.w + x] ? 0 : 1;
    const st = [0]; out[0] = 2;
    while (st.length) {
      const i = st.pop(), x = i % W, y = (i - x) / W;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) if (j >= 0 && out[j] === 1) { out[j] = 2; st.push(j); }
    }
    const o = mk(m.w, m.h);
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) o.d[y * m.w + x] = out[(y + 1) * W + x + 1] === 2 ? 0 : 1;
    return o;
  }
  // 同 clean_mask：補洞、只留蓋到中心（或最大）的那一塊；沒有任何像素回 null
  function cleanMask(m, ctr) {
    const { lab, n, size } = components(m);
    if (n <= 1) return null;
    let k = lab[Math.floor(ctr[1]) * m.w + Math.floor(ctr[0])];
    if (!k) { k = 1; for (let i = 2; i < n; i++) if (size[i] > size[k]) k = i; }
    const o = mk(m.w, m.h); for (let i = 0; i < lab.length; i++) o.d[i] = lab[i] === k ? 1 : 0;
    return fillHoles(o);
  }

  // ---- 形態學：橢圓核（跟 cv2.getStructuringElement(MORPH_ELLIPSE, (2r+1, 2r+1)) 的列寬一樣）的膨脹、侵蝕 ----
  // 第 dy 列的半寬 = round(√(r² − dy²))；先對每個半寬各做一次水平膨脹（前綴和），再依列位移疊起來
  function dilate(m, r) {
    const W = m.w, H = m.h, o = mk(W, H), hd = new Map();
    const horiz = dx => {
      if (hd.has(dx)) return hd.get(dx);
      const out = new Uint8Array(W * H), pre = new Int32Array(W + 1);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) pre[x + 1] = pre[x] + m.d[y * W + x];
        for (let x = 0; x < W; x++) out[y * W + x] = pre[Math.min(W, x + dx + 1)] - pre[Math.max(0, x - dx)] > 0 ? 1 : 0;
      }
      hd.set(dx, out); return out;
    };
    for (let dy = -r; dy <= r; dy++) {
      const h = horiz(Math.round(Math.sqrt(r * r - dy * dy)));
      for (let y = 0; y < H; y++) { const sy = y - dy; if (sy < 0 || sy >= H) continue; for (let x = 0; x < W; x++) o.d[y * W + x] |= h[sy * W + x]; }
    }
    return o;
  }
  function erode(m, r) {   // 邊界外不算背景（同 cv2 的侵蝕）
    const inv = mk(m.w, m.h); for (let i = 0; i < inv.d.length; i++) inv.d[i] = m.d[i] ^ 1;
    const o = dilate(inv, r); for (let i = 0; i < o.d.length; i++) o.d[i] ^= 1;
    return o;
  }
  const open = (m, r) => dilate(erode(m, r), r);
  const close = (m, r) => erode(dilate(m, r), r);
  const and = (a, b) => { const o = mk(a.w, a.h); for (let i = 0; i < o.d.length; i++) o.d[i] = a.d[i] & b.d[i]; return o; };
  const bboxOf = m => { let x0 = m.w, y0 = m.h, x1 = -1, y1 = -1; for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.d[y * m.w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return x1 < 0 ? null : { w: x1 - x0 + 1, h: y1 - y0 + 1 }; };
  const spikeR = m => { const b = bboxOf(m); return b && Math.max(1, Math.floor(0.03 * Math.min(b.w, b.h))); };

  function despike(m) {   // 去小突起：用最小邊 3% 的圓開運算，只留最大的一塊
    const r = spikeR(m); if (!r) return m;
    const o = open(m, r);
    return components(o).n <= 1 ? m : keepBiggest(o);
  }
  function trimSpikes(m) {   // 只削細突起：原遮罩 ∩ 開運算結果再膨脹
    const r = spikeR(m); if (!r) return m;
    return and(m, dilate(open(m, r), r));
  }

  // ---- 輪廓 → 多邊形 ----
  function contour(m) {   // 最大外輪廓（Moore 鄰域追蹤，像素中心），回傳 [[x, y], …]
    const W = m.w, H = m.h, at = (x, y) => x >= 0 && y >= 0 && x < W && y < H && m.d[y * W + x] === 1;
    const D = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]], seen = new Uint8Array(W * H);
    let best = null, bestArea = -1;
    for (let sy = 0; sy < H; sy++) for (let sx = 0; sx < W; sx++) {
      if (!at(sx, sy) || at(sx - 1, sy) || seen[sy * W + sx]) continue;   // 外輪廓的起點：左邊是背景的第一個像素
      const pts = []; let x = sx, y = sy, dir = 6, guard = 0, first = -1;
      for (;;) {
        pts.push([x, y]); seen[y * W + x] = 1;
        let d = -1;
        for (let k = 0; k < 8; k++) { const c = (dir + 6 + k) % 8; if (at(x + D[c][0], y + D[c][1])) { d = c; break; } }
        if (d < 0) break;   // 單獨一個像素
        if (first < 0) first = d; else if (x === sx && y === sy && d === first) { pts.pop(); break; }   // 回到起點又走同一方向：繞完一圈
        x += D[d][0]; y += D[d][1]; dir = d;
        if (++guard > W * H * 4) break;
      }
      const a = Math.abs(area(pts)) + pts.length;
      if (a > bestArea) { bestArea = a; best = pts; }
    }
    return best;
  }
  const area = p => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
  const arcLen = p => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += Math.hypot(a[0] - b[0], a[1] - b[1]); } return s; };
  function dpOpen(p, eps) {   // 開折線的 Douglas–Peucker（含頭尾）
    if (p.length < 3) return p.slice();
    const a = p[0], b = p[p.length - 1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    let mi = 0, md = -1;
    for (let i = 1; i < p.length - 1; i++) {
      const d = L ? Math.abs(dy * p[i][0] - dx * p[i][1] + b[0] * a[1] - b[1] * a[0]) / L : Math.hypot(p[i][0] - a[0], p[i][1] - a[1]);
      if (d > md) { md = d; mi = i; }
    }
    return md > eps ? [...dpOpen(p.slice(0, mi + 1), eps).slice(0, -1), ...dpOpen(p.slice(mi), eps)] : [a, b];
  }
  function approxPoly(p, eps) {   // 封閉多邊形的 Douglas–Peucker：從最遠的兩點切開（同 cv2.approxPolyDP 的做法）
    if (p.length <= 3) return p.slice();
    let i0 = 0, i1 = 0, md = -1;
    for (let i = 1; i < p.length; i++) { const d = Math.hypot(p[i][0] - p[0][0], p[i][1] - p[0][1]); if (d > md) { md = d; i1 = i; } }
    const lo = Math.min(i0, i1), hi = Math.max(i0, i1);
    const a = dpOpen(p.slice(lo, hi + 1), eps), b = dpOpen([...p.slice(hi), ...p.slice(0, lo + 1)], eps);
    return [...a.slice(0, -1), ...b.slice(0, -1)];
  }
  const round1 = v => Math.round(v * 10) / 10;
  // 遮罩 → 原圖座標的多邊形（先去小突起，再 DP 精簡，偏差約外框周長的 1%）；沒東西回 null
  function maskToPoly(m, scale, ox, oy, spikes = true) {
    const c = contour(spikes ? despike(m) : m); if (!c || c.length < 3) return null;
    const a = approxPoly(c, Math.max(1, 0.01 * arcLen(c)));
    return a.map(q => [round1(q[0] / scale + ox), round1(q[1] / scale + oy)]);
  }
  // 合併太近的頂點、拿掉幾乎在同一直線上的點（同 simplify_poly）
  function simplifyPoly(poly, near = 0.015, flat = 0.005) {
    const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]), size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const minD = Math.max(2, near * size), eps = Math.max(1, flat * size), out = [];
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    for (const q of poly) { if (out.length && dist(q, out[out.length - 1]) < minD) { const l = out[out.length - 1]; out[out.length - 1] = [(l[0] + q[0]) / 2, (l[1] + q[1]) / 2]; } else out.push(q.slice()); }
    while (out.length > 3 && dist(out[0], out[out.length - 1]) < minD) { const l = out.pop(); out[0] = [(out[0][0] + l[0]) / 2, (out[0][1] + l[1]) / 2]; }
    if (out.length < 3) return poly;
    const a = approxPoly(out, eps);
    return (a.length >= 3 ? a : out).map(q => [round1(q[0]), round1(q[1])]);
  }
  const iouOf = (a, b) => { let i = 0, u = 0; for (let k = 0; k < a.d.length; k++) { i += a.d[k] & b.d[k]; u += a.d[k] | b.d[k]; } return i / Math.max(1, u); };

  // ---- 編輯運算（同 poly_op）：多邊形 → 遮罩（合併時先閉運算把縫補起來、補洞）→ 新的多邊形 ----
  function polyOp(polys, { close: cl = 0, trim = false } = {}) {
    const all = polys.flat();
    const lo = [Math.floor(Math.min(...all.map(p => p[0]))) - 8, Math.floor(Math.min(...all.map(p => p[1]))) - 8];
    const hi = [Math.ceil(Math.max(...all.map(p => p[0]))) + 8, Math.ceil(Math.max(...all.map(p => p[1]))) + 8];
    let m = mk(hi[0] - lo[0], hi[1] - lo[1]);
    for (const p of polys) fillPoly(m, p, lo[0], lo[1]);
    if (cl) m = close(m, Math.max(2, Math.floor(cl * Math.min(m.w, m.h))));
    m = fillHoles(m);
    if (!trim) return maskToPoly(m, 1, lo[0], lo[1]);
    let t = trimSpikes(m);
    if (components(t).n > 1) t = keepBiggest(t);
    const iou = iouOf(m, t), first = polys[0];
    // 沒有突起就不動外形；會削掉超過 15% 的不是「小突起」，也不動。之後都再合併太近、同一直線的點
    const out = iou >= 0.995 || iou < 0.85 ? first : maskToPoly(t, 1, lo[0], lo[1], false);
    const simple = simplifyPoly(out);
    const sm = fillPoly(mk(m.w, m.h), simple, lo[0], lo[1]), ref = fillPoly(mk(m.w, m.h), out, lo[0], lo[1]);
    const keep = iouOf(sm, ref) < 0.98 ? out : simple;   // 合併點會讓外形變超過 2% 就不合併
    return keep.length < first.length || out !== first ? keep : first;
  }

  // ---- 檢查（同 functions/defaults.js 的 validPoly）----
  function validPoly(p, w, h) {
    if (!(Array.isArray(p) && p.length >= 3 && p.length <= 500)) return false;
    if (!p.every(q => Array.isArray(q) && q.length === 2 && q.every(Number.isFinite) && q[0] >= -2 && q[0] <= w + 2 && q[1] >= -2 && q[1] <= h + 2)) return false;
    const a = Math.abs(area(p));
    if (a < 12 || a > 0.4 * w * h) return false;
    const o = (a1, b1, c1) => (b1[0] - a1[0]) * (c1[1] - a1[1]) - (b1[1] - a1[1]) * (c1[0] - a1[0]), n = p.length;
    for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const a1 = p[i], b1 = p[(i + 1) % n], c1 = p[j], d1 = p[(j + 1) % n];
      if (Math.sign(o(a1, b1, c1)) * Math.sign(o(a1, b1, d1)) < 0 && Math.sign(o(c1, d1, a1)) * Math.sign(o(c1, d1, b1)) < 0) return false;
    }
    return true;
  }
  // 發佈前把不合格的外框修好：自己交叉的畫成遮罩再取外輪廓；修不好的列出來 → { holds, fixed, bad }
  function repair(holds, w, h) {
    const fixed = [], bad = [];
    for (const ho of holds) {
      if (validPoly(ho.poly, w, h)) continue;
      let np = null; try { np = polyOp([ho.poly]); } catch (e) { np = null; }
      if (np && validPoly(np, w, h)) { ho.poly = np; fixed.push(ho.id); } else bad.push(ho.id);
    }
    return { holds, fixed, bad };
  }
  // 可能是同一顆的多個框：重疊佔較小那顆的 5 成以上、大小差不到 4 倍
  function dupPairs(holds, W, H) {
    const ms = holds.map(h => polyMask(h.poly, W, H)), areas = ms.map(x => count(x.m)), out = [];
    for (let i = 0; i < holds.length; i++) for (let j = i + 1; j < holds.length; j++) {
      const a = ms[i], b = ms[j];
      if (a.ox + a.m.w <= b.ox || b.ox + b.m.w <= a.ox || a.oy + a.m.h <= b.oy || b.oy + b.m.h <= a.oy) continue;
      const x0 = Math.max(a.ox, b.ox), x1 = Math.min(a.ox + a.m.w, b.ox + b.m.w), y0 = Math.max(a.oy, b.oy), y1 = Math.min(a.oy + a.m.h, b.oy + b.m.h);
      let n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) n += a.m.d[(y - a.oy) * a.m.w + x - a.ox] & b.m.d[(y - b.oy) * b.m.w + x - b.ox];
      const lo = Math.min(areas[i], areas[j]), hi = Math.max(areas[i], areas[j]);
      if (n && n / lo >= 0.5 && hi / lo < 4) out.push([holds[i].id, holds[j].id]);
    }
    return out;
  }

  const api = { mk, count, fillPoly, polyMask, components, keepBiggest, fillHoles, cleanMask, erode, dilate, open, close, despike, trimSpikes, contour, approxPoly, maskToPoly, simplifyPoly, polyOp, validPoly, repair, dupPairs, area };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RefineGeo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
