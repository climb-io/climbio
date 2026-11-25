// RouteKit image：整條路線畫成一張圖——原尺寸的路線圖、路線小卡、取景範圍、岩點亮起的順序。
// 瀏覽器用 <script> 依序載入，掛在全域 RouteKit；Node 用 require。不依賴任何 App 的狀態，資料都從參數傳入。
// English: RouteKit image: render a whole route as one image, thumbnails, framing, reveal order.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./geometry.js'), require('./base.js'), require('./labels.js'));
  else Object.assign(root.RouteKit || (root.RouteKit = {}), factory(root.RouteKit, root.RouteKit, root.RouteKit));
})(typeof self !== 'undefined' ? self : this, function (G, B, L) {
  'use strict';
  // 路線用到的岩點：路線自帶的外框（route.shapes），沒有的用牆上那顆（holds）；兩邊都沒有的略過
  function routeHolds(r, holds) {
    const s = r.shapes || {};
    let byId = null;
    return Object.keys(r.holds).map(id => s[id] || (byId || (byId = new Map(holds.map(h => [h.id, h])))).get(id)).filter(Boolean);
  }
  // 路線岩點的外接框；沒有岩點回傳 null
  function routeBounds(routeHolds) {
    if (!routeHolds.length) return null;
    return routeHolds.map(h => G.bbox(h.poly)).reduce((a, c) => ({ x0: Math.min(a.x0, c.x0), y0: Math.min(a.y0, c.y0), x1: Math.max(a.x1, c.x1), y1: Math.max(a.y1, c.y1) }));
  }
  // 路線岩點的範圍（含標籤的空間）往外加一圈，盡量延伸成 aspect（寬／高）的比例，不超出照片（PW×PH）
  function cropAround(routeHolds, PW, PH, aspect) {
    const b = routeBounds(routeHolds);
    if (!b) return { x: 0, y: 0, w: PW, h: PH };
    const pad = Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.18 + Math.max(PW, PH) * 0.04;
    let w = Math.min(PW, b.x1 - b.x0 + 2 * pad), h = Math.min(PH, b.y1 - b.y0 + 2 * pad);
    if (w / h < aspect) w = Math.min(PW, h * aspect); else h = Math.min(PH, w / aspect);
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const x = Math.max(0, Math.min(PW - w, cx - w / 2)), y = Math.max(0, Math.min(PH - h, cy - h / 2));
    return { x, y, w, h };
  }
  // 分段播放：把出手順序切成連續的幾段。沒有手順、或 8 手以內（一次讀得完）就是一段。
  // 更長的路線自己決定段長，不接受外層指定幾手一段：
  //  1. 目標段長在 5～8 手（一次看得完的長度）。挑讓「段數＝四捨五入(總手數／候選)」的平均段長落在 5～8、而且最接近 6.5 的那個；一樣近就取較短的。
  //  2. 近距離重複：同一顆岩點兩次出手的索引差 ≤ 4（中間最多 3 手，例如換手再抓）必須留在同一段，編號一起顯示。
  //  3. 遠距離重複：索引差 > 4（走遠了又回來）不能出現在同一段，否則一顆點上會同時標兩組離很遠的號碼。
  //  4. 用動態規劃切，每段長度盡量在目標 ±2 以內，讓各段跟目標的差的平方加總最小。近距離重複若被理想切點切開，切點就往前或往後挪到重複的外面。
  //     這樣切不出來才放寬，每次一格、最多 3 格。還是不行就改用由左到右的保底切法（仍然避開遠距離重複、盡量不切開近距離重複）。
  // 回傳 [{ from, to }]，是 seq 的索引，to 不含。English: split a move order into segments. Length and cuts are chosen here; callers do not pass a size.
  const SEGMENT_SHORT = 8, SEGMENT_NEAR = 4, SEGMENT_SLACK = 2, SEGMENT_RELAX = 3;
  function segmentTarget(n) {
    let best = 6, score = Infinity, tie = Infinity;
    for (let t = 5; t <= 8; t++) {
      const k = Math.max(1, Math.round(n / t)), avg = n / k, outside = avg < 5 || avg > 8 ? 5 : 0, s = Math.abs(avg - 6.5) + outside, d = Math.abs(t - 6.5);
      if (s < score || (s === score && d < tie)) { score = s; tie = d; best = t; }
    }
    return best;
  }
  function nearAtoms(seq) {
    const last = new Map(), spans = [];
    seq.forEach((id, i) => {
      const p = last.get(id);
      if (p !== undefined && i - p <= SEGMENT_NEAR) spans.push([p, i]);
      last.set(id, i);
    });
    spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const out = [];
    for (const [a, b] of spans) {
      const tail = out[out.length - 1];
      if (tail && a <= tail[1]) tail[1] = Math.max(tail[1], b);
      else out.push([a, b]);
    }
    return out;
  }
  const atomHolds = (atoms, p, i) => atoms.some(([a, b]) => a <= p && b >= i);
  function segmentOk(seq, from, to, atoms) {
    for (const [a, b] of atoms) {
      const inside = from <= a && b < to, outside = to <= a || from > b;
      if (!inside && !outside) return false;
    }
    const first = new Map();
    for (let i = from; i < to; i++) {
      const id = seq[i], p = first.get(id);
      if (p !== undefined && i - p > SEGMENT_NEAR && !atomHolds(atoms, p, i)) return false;
      if (p === undefined) first.set(id, i);
    }
    return true;
  }
  function segmentSolve(seq, atoms, target, minL, maxL) {
    const n = seq.length, inf = 1e15, cost = new Array(n + 1).fill(inf), prev = new Array(n + 1).fill(-1);
    cost[0] = 0;
    for (let i = 0; i < n; i++) {
      if (cost[i] >= inf) continue;
      for (let j = i + minL; j <= Math.min(n, i + maxL); j++) {
        if (!segmentOk(seq, i, j, atoms)) continue;
        const c = cost[i] + (j - i - target) ** 2;
        if (c < cost[j]) { cost[j] = c; prev[j] = i; }
      }
    }
    if (cost[n] >= inf) return null;
    const parts = [];
    for (let j = n; j > 0; j = prev[j]) parts.push({ from: prev[j], to: j });
    parts.reverse();
    return parts;
  }
  function segmentFallback(seq, atoms, target) {
    const n = seq.length, parts = [];
    let i = 0;
    while (i < n) {
      let j = Math.min(n, i + target);
      for (const [a, b] of atoms) if (a >= i && a < j && b >= j) j = Math.min(n, b + 1);
      const first = new Map();
      for (let k = i; k < j; k++) {
        const id = seq[k], p = first.get(id);
        if (p !== undefined && k - p > SEGMENT_NEAR && !atomHolds(atoms, p, k)) { j = k; break; }
        if (p === undefined) first.set(id, k);
      }
      if (j <= i) j = Math.min(n, i + 1);
      parts.push({ from: i, to: j });
      i = j;
    }
    return parts;
  }
  function segmentSeq(seq) {
    if (!seq || !seq.length) return [];
    const n = seq.length;
    if (n <= SEGMENT_SHORT) return [{ from: 0, to: n }];
    const target = segmentTarget(n), atoms = nearAtoms(seq);
    for (let relax = 0; relax <= SEGMENT_RELAX; relax++) {
      const parts = segmentSolve(seq, atoms, target, Math.max(1, target - SEGMENT_SLACK - relax), target + SEGMENT_SLACK + relax);
      if (parts) return parts;
    }
    return segmentFallback(seq, atoms, target);
  }
  // 第 index 段要畫什麼。numbers：這一段每個岩點的出手號碼（從 1 起，只含這一段；同一顆在這一段用了兩次就兩個號碼）。
  // past：這一段之前用過、這一段沒再用的岩點。futureAnchors：還沒爬到的起攀、完攀（全程留著當開頭和結尾）。
  function segmentFrame(route, index = 0) {
    const seq = route && route.seq || [], parts = segmentSeq(seq);
    if (!parts.length) return null;
    const i = Math.max(0, Math.min(parts.length - 1, index | 0)), { from, to } = parts[i];
    const numbers = {}, current = [], seen = new Set();
    for (let k = from; k < to; k++) {
      const id = seq[k];
      (numbers[id] || (numbers[id] = [])).push(k + 1);
      if (!seen.has(id)) { seen.add(id); current.push(id); }
    }
    const past = [];
    for (const id of seq.slice(0, from)) if (!seen.has(id) && !past.includes(id)) past.push(id);
    const holds = route.holds || {};
    const futureAnchors = Object.keys(holds).filter((id) => (holds[id] === 's' || holds[id] === 't') && !seen.has(id) && !past.includes(id));
    return { index: i, count: parts.length, from, to, parts, numbers, current, past, futureAnchors };
  }
  // 岩點一顆一顆亮起的順序（短影片、看路線的動畫）：起攀和腳點先、接著手點照出手順序（沒排到的由下往上）、最後完攀。回傳 [[岩點…], …]
  function revealSteps(r, routeHolds) {
    const byId = new Map(routeHolds.map(h => [h.id, h])), seen = new Set(), steps = [];
    const step = (hs) => { hs = hs.filter(h => h && !seen.has(h.id)); hs.forEach(h => seen.add(h.id)); if (hs.length) steps.push(hs); };
    step(routeHolds.filter(h => r.holds[h.id] === 's' || r.holds[h.id] === 'f'));
    const low = (a, b) => G.bbox(b.poly).y1 - G.bbox(a.poly).y1;
    const hands = [...(r.seq || []).map(id => byId.get(id)), ...routeHolds.filter(h => r.holds[h.id] === 'h').sort(low)];   // 排了順序的先，沒排到的手點接著由下往上
    for (const h of hands) step([h]);
    step(routeHolds.filter(h => r.holds[h.id] !== 't'));   // 其他還沒亮的（不該有，保險）在完攀之前
    step(routeHolds.filter(h => r.holds[h.id] === 't'));
    return steps;
  }
  // 整條路線畫在 g 上（g 已設好照片座標的轉換）：路線圖的底（scene 的快取）＋膠帶標示＋出手順序。
  // unit：標示的大小（照片像素）；hands：手點也貼短膠帶；mode、tint、glow 見 drawRouteBase
  function drawRoute(g, scene, r, routeHolds, { unit = Math.max(scene.w, scene.h) / 1000, mode = 'gray', tint = true, hands = false, tape = true, theme, glow } = {}) {
    if (!routeHolds.length) { g.drawImage(scene.img, 0, 0); return; }
    scene.drawBase(g, routeHolds, { mode, tint, glow });
    if (glow && glow.outline !== false) {   // 光暈只是外圍一圈淡的，岩點的外框用角色色的細線描清楚（跟定線畫面一樣；outline: false 不描，看路線圖用）
      const k = g.getTransform().a, px = (s) => s * 0.65 / k * (glow.dpr || 1);
      g.lineJoin = 'round';
      for (const h of routeHolds) L.strokeRouteHold(g, h.poly, r.holds[h.id], px, theme);
    }
    const labels = scene.labels(routeHolds, r, unit, hands, theme);
    if (tape) L.drawTypeLabels(g, labels, unit, theme);   // tape: false＝不貼膠帶標示（暗彩有光暈外框時）
    L.drawSeq(g, scene, r, unit, labels, routeHolds, theme);
  }
  // 原尺寸的路線圖（分享、連結預覽的素材）：灰階底、路線岩點原色、起攀／完攀／腳點膠帶、出手順序；不帶任何品牌
  function renderRouteImage(scene, r, routeHolds, { theme } = {}) {
    const c = document.createElement('canvas'); c.width = scene.w; c.height = scene.h;
    const g = c.getContext('2d'), unit = Math.max(scene.w, scene.h) / 1000;
    if (!routeHolds.length) { g.drawImage(scene.img, 0, 0); return c; }
    scene.drawBase(g, routeHolds, { mode: 'gray' });
    g.lineJoin = 'round';
    const labels = scene.labels(routeHolds, r, unit, false, theme);
    L.drawTypeLabels(g, labels, unit, theme);
    L.drawSeq(g, scene, r, unit, labels, routeHolds, theme);
    return c;
  }
  // 路線小卡裁照片（W×H）的哪一塊：路線岩點的範圍外加三成，至少照片短邊的四分之一，正方形、不超出照片。回傳 { sx, sy, side }（照片座標）
  function thumbCrop(W, H, routeHolds) {
    const b = routeBounds(routeHolds) || { x0: 0, y0: 0, x1: W, y1: H };
    let side = Math.max(b.x1 - b.x0, b.y1 - b.y0) * 1.3;
    side = Math.min(Math.max(side, Math.min(W, H) / 4), W, H);
    return { sx: Math.min(Math.max((b.x0 + b.x1) / 2 - side / 2, 0), W - side), sy: Math.min(Math.max((b.y0 + b.y1) / 2 - side / 2, 0), H - side), side };
  }
  // 路線小卡（S×S，預設跟路線圖同一個灰階底），裁的範圍見 thumbCrop；回傳的畫布帶 crop。
  // mode：'dim' 暗彩；route（有就畫光暈）、theme：跟看線、定線畫面同一套暗彩＋光暈。沒給就是灰階
  function routeThumb(scene, routeHolds, S = 300, { mode = 'gray', route, theme } = {}) {
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'), { sx, sy, side } = c.crop = thumbCrop(scene.w, scene.h, routeHolds), k = S / side;
    if (mode !== 'gray') {
      g.setTransform(k, 0, 0, k, -sx * k, -sy * k);
      scene.drawBase(g, routeHolds, { mode, tint: false, glow: route ? { roles: route.holds, colors: (theme || L.THEME).colors } : undefined });
      return c;
    }
    g.drawImage(scene.plain('gray'), sx, sy, side, side, 0, 0, S, S);   // 跟路線圖同一個底：點進路線圖時那一塊顏色不會變
    // 路線岩點換回原色：跟路線圖同一個遮罩（鎖在上面、沒選進路線的塗成 volume 的顏色，見 routeMask）
    const m = document.createElement('canvas'); m.width = m.height = S;
    const mg = m.getContext('2d'); mg.setTransform(k, 0, 0, k, -sx * k, -sy * k);
    const cover = B.routeMask(mg, routeHolds, scene.holds);
    mg.setTransform(1, 0, 0, 1, 0, 0); mg.globalCompositeOperation = 'source-in'; mg.drawImage(scene.img, sx, sy, side, side, 0, 0, S, S);
    mg.setTransform(k, 0, 0, k, -sx * k, -sy * k); cover(scene.img);
    g.drawImage(m, 0, 0);
    return c;
  }
  return { routeHolds, cropAround, revealSteps, segmentSeq, segmentFrame, drawRoute, renderRouteImage, thumbCrop, routeThumb };
});
