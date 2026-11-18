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
  // unit：標示的大小（照片像素）；hands：手點也貼短膠帶；mode、tint 見 drawRouteBase
  function drawRoute(g, scene, r, routeHolds, { unit = Math.max(scene.w, scene.h) / 1000, mode = 'gray', tint = true, hands = false, theme } = {}) {
    if (!routeHolds.length) { g.drawImage(scene.img, 0, 0); return; }
    scene.drawBase(g, routeHolds, { mode, tint });
    const labels = scene.labels(routeHolds, r, unit, hands, theme);
    L.drawTypeLabels(g, labels, unit, theme);
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
  // 路線小卡（S×S，跟路線圖同一個灰階底），裁的範圍見 thumbCrop；回傳的畫布帶 crop
  function routeThumb(scene, routeHolds, S = 300) {
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'), { sx, sy, side } = c.crop = thumbCrop(scene.w, scene.h, routeHolds), k = S / side;
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
  return { routeHolds, cropAround, revealSteps, drawRoute, renderRouteImage, thumbCrop, routeThumb };
});
