// RouteKit labels：路線的標示：起攀／完攀的 S／T 膠帶、腳點與手點的短膠帶、出手順序的編號、定線時的類型外框
// 瀏覽器用 <script> 依序載入，掛在全域 RouteKit；Node 用 require。不依賴任何 App 的狀態，資料都從參數傳入。
// English: RouteKit labels: start/top tape, foot and hand tape, move-order badges.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./geometry.js'));
  else Object.assign(root.RouteKit || (root.RouteKit = {}), factory(root.RouteKit));
})(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';
  const { bbox, inPoly, edgePoint, stripTip, edgeTangent, strokeOutside } = G;
  /** 兩個外框（x0、y0、x1、y1）的重疊面積 */
  const hit = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  // 預設樣式：colors＝類型的顏色（s 起攀、h 手點、f 腳點、t 完攀）、font＝標示的字型、text＝S／T 標籤的字
  const THEME = {
    colors: { s: '#22c55e', h: '#3b82f6', f: '#facc15', t: '#ef4444' },
    font: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang TC", "Noto Sans TC", "Segoe UI", sans-serif',
    text: { s: 'S', t: 'T' },
  };
  let measureCtx = null;   // 量字寬用的畫布，共用一張
  const measurer = () => measureCtx || (measureCtx = (typeof document === 'object' ? document.createElement('canvas') : new OffscreenCanvas(1, 1)).getContext('2d'));
  // 路線岩點的外框：只用顏色區分（起攀綠、路線點藍、腳點黃、完攀紅），線條一樣，畫面比較乾淨；
  // 攀岩由下往上爬，起攀和完攀的位置本身就看得出來。L(螢幕像素, 匯出時的照片單位) 換算線寬
  function strokeRouteHold(c, poly, type, L, theme = THEME) {
    c.save();
    c.strokeStyle = 'rgba(0,0,0,0.4)'; strokeOutside(c, poly, L(4.6, 4.3));
    c.strokeStyle = theme.colors[type] || theme.colors.h; strokeOutside(c, poly, L(3, 2.8));
    c.restore();
  }
  // 類型標示（分享圖、看路線圖），參考世界盃貼膠帶的樣式：
  // 起攀、完攀：小圓形標籤（S／T）放在岩點外面，一段同色膠帶從岩點在該方向最外側的點（稍微壓進岩點，不留空隙）接到標籤；
  // 腳點：黃色短膠帶放在岩點外側，與起攀、完攀的膠帶同寬，短邊緊貼輪廓、向外延伸；手點（看路線圖開了手點膠帶）一樣，藍色。
  // 完攀的膠帶從岩點上方的角（右上或左上）接出。
  // 方向自動挑：起攀往斜下、完攀往水平（避免正上正下，看起來比較不呆板），腳點優先往下；避開路線岩點、其他標籤和照片邊緣，膠帶越短越好。
  // scene＝{ w, h, holds }：照片尺寸與牆上所有岩點（避開用）；routeHolds＝路線用到的岩點；r＝路線（holds：id → 類型）；unit＝標示的大小單位（照片像素）
  function typeLabels(scene, routeHolds, r, unit, hands = false, theme = THEME) {
    const W = scene.w, H = scene.h, out = [], c = measurer();
    const fs = 10 * unit, tw = 3 * unit;
    c.font = `900 ${fs}px ${theme.font}`;
    const boxes = routeHolds.map(h => bbox(h.poly));
    const footLength = 14 * unit;
    // 先放起攀、完攀（比較大），再放腳點、手點的短膠帶
    const rank = (i) => ({ s: 0, t: 0, f: 1, h: 2 })[r.holds[routeHolds[i].id]] ?? 1;
    const order = routeHolds.map((h, i) => i).filter(i => hands || r.holds[routeHolds[i].id] !== 'h').sort((i, j) => rank(i) - rank(j));
    // 起攀有好幾顆時，每顆的膠帶從起攀群的中心往外放（定線貼膠帶的習慣：上面那顆往上斜、下面那顆往下斜），標籤不會擠在一起
    const ctr = (b) => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
    const starts = order.filter(i => r.holds[routeHolds[i].id] === 's').map(i => ctr(boxes[i]));
    const sc = starts.length > 1 ? [starts.reduce((a, p) => a + p[0], 0) / starts.length, starts.reduce((a, p) => a + p[1], 0) / starts.length] : null;
    // 膠帶、標籤不能蓋到岩點：沿著膠帶（兩側）和圓取點，逐顆用外框判斷（外接矩形太粗，斜的膠帶會被誤判或漏掉）
    // 路線岩點蓋到扣很多，牆上其他岩點也扣一點；只看標籤附近的岩點
    const isRoute = new Set(routeHolds.map(h => h.id)), all = scene.holds || routeHolds;
    const allBoxes = all.map(h => [h, bbox(h.poly)]);
    for (const i of order) {
      const h = routeHolds[i], type = r.holds[h.id], foot = type === 'f' || type === 'h';   // 手點的膠帶跟腳點同一種（顏色不同）
      const reach = 80 * unit, b0 = boxes[i];
      const near = allBoxes.filter(([g, b]) => g !== h && b.x1 > b0.x0 - reach && b.x0 < b0.x1 + reach && b.y1 > b0.y0 - reach && b.y0 < b0.y1 + reach);
      const covered = (pts) => { let n = 0; for (const [x, y] of pts) for (const [g, b] of near) if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && inPoly(x, y, g.poly)) { n += isRoute.has(g.id) ? 1 : 0.08; break; } return n; };
      const [hx, hy] = ctr(boxes[i]), out0 = sc && type === 's' && Math.hypot(hx - sc[0], hy - sc[1]) > unit ? Math.atan2(hy - sc[1], hx - sc[0]) : null;
      const txt = foot ? '' : theme.text[type];
      const d = foot ? footLength : Math.max(16 * unit, c.measureText(txt).width + 6 * unit);   // S／T 圓的直徑，或腳點膠帶的長度
      let best = null;
      for (let k = 0; k < 48; k++) {   // 接點只跟方向有關：每個方向算一次，三種膠帶長度共用
        const a = k * Math.PI / 24, dx = Math.cos(a), dy = Math.sin(a);   // 一圈 48 個方向
        // 完攀：膠帶從岩點上方的角接出（往右就是右上角、往左就是左上角），貼在頂端看起來才像「摸到這顆就完攀」
        const top = type === 't', an = top ? Math.hypot(dx, dy - 1) : 1;
        const [qx, qy] = top ? edgePoint(h.poly, dx / an, (dy - 1) / an) : edgePoint(h.poly, dx, dy, foot);
        // 膠帶整個寬度都在岩點外面才開始，短邊貼齊岩點邊緣（方向跟那段邊緣垂直，不對著角落）
        // 完攀：從上方的角沿著側邊往下找，第一個邊緣跟膠帶垂直的地方（貼在側邊靠上，大圓角的岩點要往下一點）
        const R = Math.max(2 * tw, 6 * unit), align = (x, y) => { const [tx, ty, st] = edgeTangent(h.poly, x, y, R); return Math.asin(Math.min(1, Math.abs(tx * dx + ty * dy))) + (1 - st) * 2; };
        let px = qx, py = qy, mis = foot ? align(qx, qy) : 0;
        if (!foot) {
          const c0 = qx * -dy + qy * dx, b = boxes[i], span = top && Math.abs(dx) > 0.3 ? (b.y1 - b.y0) * 0.5 : 0;
          let bestA = null;
          for (let o = top && span ? tw * 0.6 : 0; o <= Math.max(span, 0); o += tw) {
            const p = stripTip(h.poly, dx, dy, c0 + Math.sign(dx || 1) * o * (top ? 1 : 0), tw / 2); if (!p) continue;
            const m2 = align(p[0], p[1]);
            if (!bestA || m2 < bestA[2] - 0.05) bestA = [p[0], p[1], m2];
            if (m2 < 0.3) break;   // 夠垂直了就用這裡（越上面越好）
            if (!span) break;
          }
          if (bestA) [px, py, mis] = bestA;
        }
        for (const len of foot ? [0] : [24 * unit, 40 * unit, 60 * unit]) {
          const sk = foot ? 0 : unit;
          const sx = px - dx * sk, sy = py - dy * sk;
          const ex = px + dx * len, ey = py + dy * len;
          // 腳點膠帶的短邊緊貼最外緣，不留縫，也不壓進小腳點。
          const rr = d / 2, lx = foot ? sx + dx * d : ex + dx * rr, ly = foot ? sy + dy * d : ey + dy * rr;
          const wx = Math.abs(dy) * tw / 2, wy = Math.abs(dx) * tw / 2;
          const rect = foot
            ? { x0: Math.min(sx, lx) - wx, y0: Math.min(sy, ly) - wy, x1: Math.max(sx, lx) + wx, y1: Math.max(sy, ly) + wy }
            : { x0: lx - rr, y0: ly - rr, x1: lx + rr, y1: ly + rr };
          const tape = foot ? rect : { x0: Math.min(sx, ex) - 3 * unit, y0: Math.min(sy, ey) - 3 * unit, x1: Math.max(sx, ex) + 3 * unit, y1: Math.max(sy, ey) + 3 * unit };
          // 方向偏好：起攀斜下（偏離正下 45° 最好，正下和往上扣分）、完攀水平（左右都可以）、腳點往下；正上正下看起來呆板
          const down = Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2)));   // 跟正下的夾角 0～π
          const flat = Math.min(Math.abs(Math.sin(a)) < 1 ? Math.asin(Math.abs(Math.sin(a))) : Math.PI / 2, Math.PI / 2);   // 跟水平的夾角 0～π/2
          const pen = foot ? down * 0.2 : type === 't' ? flat * 0.8 + (dx < 0 ? 0.35 : 0) + Math.max(0, dy) * 1.5   // 完攀不要往下（往下看起來像起攀）   // 完攀左右都可以，差不多時放右邊
            : out0 !== null ? Math.abs(Math.atan2(Math.sin(a - out0), Math.cos(a - out0))) * 0.3 + Math.max(0, flat - Math.PI / 3) * 1.5   // 往外，但不要正上正下（跟水平超過 60° 扣分）
            : Math.abs(down - Math.PI / 4) * 0.25 + (down > Math.PI / 2 ? 0.3 : 0);
          let cost = pen + len / unit * 0.004;
          // 一般人貼膠帶是順著岩點的邊貼：膠帶的短邊貼齊岩點邊緣，方向跟那段邊緣垂直；斜著對角落貼看起來不自然
          cost += mis;   // 膠帶跟岩點邊緣不垂直、或貼在角落（邊在這裡轉彎）扣分
          if (!foot) {
            const pts = [], st = 3 * unit, n = Math.max(2, Math.ceil(len / st)), nx = -dy * 1.3 * unit, ny = dx * 1.3 * unit;
            for (let q = 1; q <= n; q++) { const x = px + dx * len * q / n, y = py + dy * len * q / n; pts.push([x, y], [x + nx, y + ny], [x - nx, y - ny]); if (inPoly(x, y, h.poly)) cost += 0.6; }   // 也不能穿過自己的岩點
            for (let q = 0; q < 8; q++) { const t2 = q * Math.PI / 4; pts.push([lx + Math.cos(t2) * rr * 0.8, ly + Math.sin(t2) * rr * 0.8]); }
            pts.push([lx, ly]);
            cost += covered(pts) * 0.6;
          }
          const m = 4 * unit, off = Math.max(0, m - rect.x0) + Math.max(0, rect.x1 - W + m) + Math.max(0, m - rect.y0) + Math.max(0, rect.y1 - H + m);
          cost += off / unit * 12;   // 標籤的圓、膠帶要在照片裡：伸出照片會被畫面切掉，比蓋到旁邊的岩點更不能接受
          const area = foot ? d * tw : d * d;
          boxes.forEach((b, j) => { if (j === i) return; cost += (hit(rect, b) * 4 + (foot ? 0 : hit(tape, b) * 1.5)) / area; });
          for (const o of out) cost += (hit(rect, o.rect) + (foot ? 0 : hit(tape, o.rect)) + hit(rect, o.tape)) / area * 8;
          if (!best || cost < best.cost) best = { cost, type, txt, foot, a, sx, sy, lx, ly, d, rect, tape };
        }
      }
      out.push(best);
    }
    return out;
  }
  function drawTypeLabels(c, labels, unit, theme = THEME) {
    const tw = 3 * unit;   // 膠帶寬
    for (const L of labels) {
      const col = theme.colors[L.type] || theme.colors.h;
      c.save();
      c.shadowColor = 'rgba(0,0,0,0.4)'; c.shadowBlur = 3 * unit; c.shadowOffsetY = 1 * unit;
      c.fillStyle = col;
      if (L.foot) {   // 同寬的短膠帶，保留平直切口與起攀、完攀一致
        c.translate(L.sx, L.sy); c.rotate(L.a);
        c.fillRect(0, -tw / 2, L.d, tw);
        c.restore();
        continue;
      }
      c.strokeStyle = col; c.lineWidth = tw; c.lineCap = 'butt';   // 膠帶一路貼到圓心，圓蓋在上面，接縫不會有空白
      c.beginPath(); c.moveTo(L.sx, L.sy); c.lineTo(L.lx, L.ly); c.stroke();
      c.beginPath(); c.arc(L.lx, L.ly, L.d / 2, 0, Math.PI * 2); c.fill();
      c.restore();
      c.save();
      c.font = `900 ${10 * unit}px ${theme.font}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = '#fff';
      c.fillText(L.txt, L.lx, L.ly + 0.8 * unit);
      c.restore();
    }
  }
  // 順序的編號：每顆岩點旁一個小膠囊（同一顆好幾手寫「6, 7」），貼著岩點外框（那個方向上外框最外側的點，不是外接框的角：大岩點、圓的岩點角落是空的）。
  // 先放右上；會蓋到起攀、完攀、腳點的標籤（labels：computeTypeLabels 的結果）、別的編號或超出照片時，依序改放左上、右、左、右下、左下、上、下，
  // 都不行就挑蓋到最少的。routeHolds：路線用到的岩點（{ id, poly }）
  // 挑好的方向記住（同一條路線、同樣的手順）：縮放、轉角度時只跟著岩點的邊走，不換邊跳來跳去
  const seqSides = new WeakMap();   // 畫面（scene）→ 路線 → { key: 手順, side: 岩點 id → 方向 }；分享圖跟畫面上的各記各的
  function seqBadges(c, scene, r, unit, labels, routeHolds) {
    if (!seqSides.has(scene)) seqSides.set(scene, new WeakMap());
    const byRoute = seqSides.get(scene), key = (r.seq || []).join(',') + '|' + labels.length;   // 看線有膠帶、定線沒有：各挑各的
    const memo = byRoute.get(r)?.key === key ? byRoute.get(r) : { key, side: new Map() };
    byRoute.set(r, memo);
    const nums = new Map(), ph = 12 * unit, W = scene.w || Infinity, H = scene.h || Infinity, polys = new Map(routeHolds.map(h => [h.id, h.poly]));
    (r.seq || []).forEach((id, i) => nums.set(id, [...(nums.get(id) || []), i + 1]));
    const taken = labels.flatMap(L => L.foot ? [L.rect] : [L.rect, L.tape]), out = [];
    const rocks = routeHolds.map(h => bbox(h.poly));
    for (const [id, ns] of nums) {
      const poly = polys.get(id); if (!poly) continue;
      const txt = ns.join(', '), w = Math.max(ph, c.measureText(txt).width + 6 * unit), r2 = Math.SQRT1_2;
      const spots = [[r2, -r2], [-r2, -r2], [1, 0], [-1, 0], [r2, r2], [-r2, r2], [0, -1], [0, 1]].map(([dx, dy]) => {
        const [ex, ey] = edgePoint(poly, dx, dy, true);
        // 整個膠囊移到輪廓外側，保留小間距，長編號也不壓進岩點。
        return [ex + Math.sign(dx) * w / 2 + dx * unit, ey + Math.sign(dy) * ph / 2 + dy * unit];
      });
      const at = (k) => { const [x, y] = spots[k]; return { x, y, txt, w, rect: { x0: x - w / 2, y0: y - ph / 2, x1: x + w / 2, y1: y + ph / 2 } }; };
      if (memo.side.has(id)) { out.push(at(memo.side.get(id))); continue; }
      let best = null;
      for (let k = 0; k < spots.length; k++) {
        const b = at(k), rect = b.rect;
        const off = Math.max(0, -rect.x0) + Math.max(0, rect.x1 - W) + Math.max(0, -rect.y0) + Math.max(0, rect.y1 - H);
        const cost = [...taken, ...out.map(o => o.rect)].reduce((s, o) => s + hit(rect, o), 0) + rocks.reduce((s, b) => s + hit(rect, b), 0) + off * ph * 10;
        if (!best || cost < best.cost) best = { ...b, cost, k };
        if (!cost) break;
      }
      memo.side.set(id, best.k);
      out.push(best);
    }
    return out;
  }
  function drawSeq(c, scene, r, unit, labels, routeHolds, theme = THEME) {
    if (!r.seq) return;
    const fs = 9.5 * unit, ph = 12 * unit;
    c.save(); c.font = `700 ${fs}px ${theme.font}`; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    for (const B of seqBadges(c, scene, r, unit, labels, routeHolds)) {
      const m = c.measureText(B.txt), w = B.w;
      c.shadowColor = 'rgba(0,0,0,0.25)'; c.shadowBlur = 1.5 * unit;
      c.fillStyle = 'rgba(10,10,10,0.46)'; c.beginPath(); c.roundRect ? c.roundRect(B.x - w / 2, B.y - ph / 2, w, ph, ph / 2) : c.rect(B.x - w / 2, B.y - ph / 2, w, ph); c.fill();
      // 用數字實際的高度置中（每台裝置的字型不同，middle 基線會偏）
      const asc = m.actualBoundingBoxAscent || fs * 0.72, desc = m.actualBoundingBoxDescent || 0;
      c.shadowBlur = 0; c.fillStyle = '#fff'; c.fillText(B.txt, B.x, B.y + (asc - desc) / 2);
    }
    c.restore();
  }

  return { THEME, typeLabels, drawTypeLabels, seqBadges, drawSeq, strokeRouteHold };
});
