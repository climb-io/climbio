// RouteKit base：路線圖的底：灰階／暗彩、路線岩點的原色、路線上 volume 的染色、小卡與收線卡片的底
// 瀏覽器用 <script> 依序載入，掛在全域 RouteKit；Node 用 require。不依賴任何 App 的狀態，資料都從參數傳入。
// English: RouteKit base: route image backgrounds (gray / muted), route holds in original color, volume tint.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./geometry.js'));
  else Object.assign(root.RouteKit || (root.RouteKit = {}), factory(root.RouteKit));
})(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';
  const { bbox, inPoly, area, tracePoly } = G;
  // 路線圖的底：灰階＋一層冷灰的底色（gray），或暗彩（dim），再把路線岩點的彩色疊回去。
  // 每條路線都用同一個冷灰底：路線頁、牆面頁的小卡、收線的卡片、分享的圖都一樣（小卡一排看起來整齊，轉場也不會有色差）。
  // 灰階先壓成固定的亮度範圍（×0.6＋50，黑色拉亮、白色稍微壓暗，深色的牆也不會太暗），再用 color 混合只換色相、保留照片明暗
  const TINT = { a: 0.75, lift: [0.6, 50], shadow: 38 };
  function lchToRgb(L, C, hDeg) {
    const h = hDeg * Math.PI / 180, fy = (L + 16) / 116, fx = fy + C * Math.cos(h) / 500, fz = fy - C * Math.sin(h) / 200;
    const fi = (t) => t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787;
    const X = 0.9505 * fi(fx), Y = fi(fy), Z = 1.089 * fi(fz);
    const g = (v) => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)));
    return [g(3.2406 * X - 1.5372 * Y - 0.4986 * Z), g(-0.9689 * X + 1.8758 * Y + 0.0415 * Z), g(0.0557 * X - 0.2040 * Y + 1.0570 * Z)];
  }
  const BASE_TINT = lchToRgb(60, 6, 240);   // 冷灰
  // 灰階（係數同 CSS 的 grayscale：跟 tintCard 一樣）
  function grayOf(img) {
    const g = document.createElement('canvas'); g.width = img.width; g.height = img.height;
    const gc = g.getContext('2d');
    // 有 canvas 濾鏡（GPU 算，很快）就用 grayscale；舊的 Safari 沒有，才逐點算
    if ('filter' in gc) { gc.filter = 'grayscale(1)'; gc.drawImage(img, 0, 0); gc.filter = 'none'; }
    else {
      gc.drawImage(img, 0, 0);
      const id = gc.getImageData(0, 0, g.width, g.height), d = id.data;
      for (let i = 0; i < d.length; i += 4) { const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = y; }   // 係數同 CSS 的 grayscale：跟收線卡片（tintCard）一樣，飛進路線圖時顏色不會變
      gc.putImageData(id, 0, 0);
    }
    return g;
  }
  // 暗彩：飽和度降到 MUTE_SAT、亮度乘 MUTE_LIGHT（係數同 CSS 的 saturate、brightness）——牆不會暗得像沒開燈，其他岩點的顏色認得出來，
  // 路線岩點（照片原色）是整張唯一鮮豔的。整張算一次存在 scene.plain('dim')（scene.release() 放掉）
  // 照片本身偏暗（室內、背光的牆）時再壓就像沒開燈：亮度係數隨照片平均亮度調，平均亮度壓到 MUTE_MEAN，最低 MUTE_LIGHT（亮的牆照舊）、最高 MUTE_LIFT
  const MUTE_SAT = 0.45, MUTE_LIGHT = 0.72, MUTE_MEAN = 75, MUTE_LIFT = 1.6;
  function mutedLight(img) {
    const s = document.createElement('canvas'); s.width = s.height = 64;
    const sc = s.getContext('2d', { willReadFrequently: true }); sc.drawImage(img, 0, 0, 64, 64);
    const d = sc.getImageData(0, 0, 64, 64).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return Math.min(MUTE_LIFT, Math.max(MUTE_LIGHT, MUTE_MEAN / Math.max(1, sum / (d.length / 4))));
  }
  function mutedOf(img) {
    const g = document.createElement('canvas'); g.width = img.width; g.height = img.height;
    const gc = g.getContext('2d'), light = mutedLight(img);
    // 有 canvas 濾鏡就用（GPU 算，很快）；iPhone 的畫布沒有，逐點算
    if ('filter' in gc) { gc.filter = `saturate(${MUTE_SAT}) brightness(${light})`; gc.drawImage(img, 0, 0); gc.filter = 'none'; return g; }
    gc.drawImage(img, 0, 0);
    const id = gc.getImageData(0, 0, g.width, g.height), d = id.data, s = MUTE_SAT, k = light;
    const m = [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s].map(v => v * k);
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      d[i] = m[0] * r + m[1] * gg + m[2] * b; d[i + 1] = m[3] * r + m[4] * gg + m[5] * b; d[i + 2] = m[6] * r + m[7] * gg + m[8] * b;
    }
    gc.putImageData(id, 0, 0);
    return g;
  }
  // 灰階畫面壓到固定亮度範圍、再上一層冷灰（路線圖的底、路線小卡、收線畫面的卡片共用，看起來一模一樣）
  // 先把暗部往上提（screen：越黑提越多、亮的幾乎不動）：牆上沒選的黑色岩點不再黑得像路線上的黑點，路線岩點用原色放在上面才認得出來
  function liftTint(c, W, H, rgb = BASE_TINT) {
    c.save(); c.globalCompositeOperation = 'screen'; c.fillStyle = `rgb(${TINT.shadow},${TINT.shadow},${TINT.shadow})`; c.fillRect(0, 0, W, H); c.restore();
    const [k, add] = TINT.lift, v = Math.round(add / (1 - k));
    c.fillStyle = `rgba(${v},${v},${v},${1 - k})`; c.fillRect(0, 0, W, H);
    c.save(); c.globalCompositeOperation = 'color'; c.globalAlpha = TINT.a;
    c.fillStyle = `rgb(${rgb.join(',')})`; c.fillRect(0, 0, W, H);
    c.restore();
  }
  // 收線畫面的卡片：畫好的照片（S×S）換成跟路線圖一樣的底（逐點算灰階：iPhone 的畫布沒有濾鏡；係數同 CSS 的 grayscale）
  function tintCard(g, S) {
    const id = g.getImageData(0, 0, S, S), d = id.data;
    for (let i = 0; i < d.length; i += 4) { const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = y; }
    g.putImageData(id, 0, 0);
    liftTint(g, S, S);
  }
  // 路線岩點上色：路線岩點用原色。路線上的 volume（面積是岩點中位數的 8 倍以上，或上面鎖著沒選進路線的岩點）整顆染成自己的顏色
  // （保留照片的明暗，只換色相、彩度）：上面沒選的、沒偵測到的岩點都變成 volume 的顏色，看起來才不像也能用；
  // 選進路線、鎖在別顆路線岩點上的（on）不染，照樣原色。
  // 「鎖在上面」：六成以上的面積落在那顆路線岩點裡，而且比它小（不到 0.9 倍：大顆的岩點鎖在 volume 上、一部分超出去的也算）。
  // 只有邊緣壓到一小塊的是外框畫得不準，不算
  function routeLayers(routeHolds, all) {
    const big = routeHolds.map(h => ({ h, b: bbox(h.poly), a: area(h.poly) })).sort((p, q) => p.a - q.a);
    const hostOf = (q, skip) => {   // 疊在好幾顆上（例如 volume 疊在 volume 上）：算最小、最貼近的那顆
      const qb = bbox(q.poly), qa = area(q.poly);
      let pts = null;   // q 外框內的取樣點（外接框切 8×8 格，取格子中心）
      const f = big.find(({ h, b, a }) => {
        if (h === skip || h.id === q.id || qa >= a * 0.9 || qb.x1 <= b.x0 || qb.x0 >= b.x1 || qb.y1 <= b.y0 || qb.y0 >= b.y1) return false;
        if (!pts) {
          pts = [];
          for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
            const x = qb.x0 + (i + 0.5) * (qb.x1 - qb.x0) / 8, y = qb.y0 + (j + 0.5) * (qb.y1 - qb.y0) / 8;
            if (inPoly(x, y, q.poly)) pts.push([x, y]);
          }
        }
        return pts.length > 0 && pts.filter(([x, y]) => inPoly(x, y, h.poly)).length >= pts.length * 0.6;
      });
      return f && f.h;
    };
    const ids = new Set(routeHolds.map(h => h.id)), on = routeHolds.filter(h => hostOf(h, h)), riders = [];
    for (const q of all) { const host = !ids.has(q.id) && hostOf(q); if (host) riders.push({ h: q, host }); }
    const hosts = new Set(riders.map(r => r.host));
    const areas = all.map(h => area(h.poly)).sort((p, q) => p - q), med = areas[areas.length >> 1] || Infinity;
    // volume 由大到小：疊在別顆 volume 上的後染，蓋過底下那顆的顏色。選進路線、疊在別顆上的要夠大、上面也有點才算（手點上重疊偵測到的小點不算），否則是原色
    const volumes = big.filter(({ h, a }) => on.includes(h) ? hosts.has(h) && a >= med * 8 : hosts.has(h) || a >= med * 8).map(({ h }) => h).reverse();
    return { base: routeHolds.filter(h => !on.includes(h)), riders, on, volumes };
  }

  // 放大看重疊時，顯示同一個底座上的其他岩點，但只替原本點到的候選畫圓點。
  function overlapNeighbors(holds, candidates) {
    const host = candidates.at(-1);
    if (!host) return [];
    const b = bbox(host.poly), picked = new Set(candidates.map(h => h.id));
    const nearby = holds.filter(h => {
      if (picked.has(h.id)) return false;
      const q = bbox(h.poly);
      return q.x0 < b.x1 && q.x1 > b.x0 && q.y0 < b.y1 && q.y1 > b.y0;
    });
    return nearby.length ? routeLayers([host], nearby).riders.map(({ h }) => h) : [];
  }

  // 共用同一份放大範圍和提示位置。k 是每個照片像素佔的螢幕像素，最大倍率由呼叫端限制。
  function prepareOverlapPick(candidates, all, { w, h, width, height }) {
    const neighbors = overlapNeighbors(all, candidates), spots = G.overlapSpots(candidates, w, h, neighbors);
    const b = bbox([...candidates, ...neighbors].flatMap(hold => hold.poly).concat([...spots.values()].map(s => [s.x, s.y])));
    const k = Math.min(width * (neighbors.length ? 0.88 : 0.7) / Math.max(1, b.x1 - b.x0), height * (neighbors.length ? 0.65 : 0.5) / Math.max(1, b.y1 - b.y0));
    return { holds: candidates, neighbors, spots, k, cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2 };
  }
  // volume 的顏色：外框內、上面那些岩點以外的像素裡最多的顏色（縮到 64 px 量；記在外框上，外框改了重算）。
  // 回傳 { c, odd }：odd＝表面上看起來是別顆點的比例（色相差很多的鮮豔像素、淺 volume 上很深的、深 volume 上很亮的）
  const surfaceColors = new WeakMap();
  function surfaceColor(img, host, atop) {
    const e = surfaceColors.get(host.poly);
    if (e && e.img === img && e.n === atop.length) return e.s;
    const b = bbox(host.poly), bw = b.x1 - b.x0, bh = b.y1 - b.y0, k = Math.min(1, 64 / Math.max(bw, bh, 1));
    const w = Math.max(1, Math.round(bw * k)), h = Math.max(1, Math.round(bh * k));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, b.x0, b.y0, bw, bh, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data, bare = [], any = [], inside = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const px = b.x0 + (x + 0.5) * bw / w, py = b.y0 + (y + 0.5) * bh / h;
      if (!inPoly(px, py, host.poly)) continue;
      inside[y * w + x] = 1;
      const i = (y * w + x) * 4, to = atop.some(q => inPoly(px, py, q.poly)) ? any : bare;
      to.push(i);
    }
    // 各色版切 8 段分格，取像素最多的那格平均：沒偵測到的點很多時，中位數會混進點的顏色
    const bins = new Map(), px = bare.length ? bare : any, luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
    for (const i of px) {
      const key = (d[i] >> 5) * 64 + (d[i + 1] >> 5) * 8 + (d[i + 2] >> 5), e = bins.get(key) || [0, 0, 0, 0];
      e[0] += d[i]; e[1] += d[i + 1]; e[2] += d[i + 2]; e[3]++; bins.set(key, e);
    }
    const top = [...bins.values()].reduce((p, q) => (q[3] > p[3] ? q : p), [0, 0, 0, 1]).map((x, _, e) => x / e[3]);
    // 明暗取同色像素（色相相近、亮度在一半到三倍之間）的中位數：兩面受光不同的 volume，最多的那格常是背光面，
    // 直接用會整顆變暗；也不能取全部的中位數，深色 volume 上沒偵測到的亮色點會把它拉亮
    const t = luma(...top), hue = (r, g, b) => { const s = r + g + b || 1; return [r / s, g / s, b / s]; }, h0 = hue(...top), lum = [];
    for (const i of px) {
      const l = luma(d[i], d[i + 1], d[i + 2]), h = hue(d[i], d[i + 1], d[i + 2]);
      if (l >= t / 2 && l <= t * 3 && Math.abs(h[0] - h0[0]) + Math.abs(h[1] - h0[1]) + Math.abs(h[2] - h0[2]) < 0.1) lum.push(l);
    }
    lum.sort((p, q) => p - q);
    const f = t > 0 && lum.length ? lum[lum.length >> 1] / t : 1;
    const rgb = top.slice(0, 3).map(x => Math.min(255, Math.round(x * f)));
    // 別顆點的比例：離外框 2 格以內的不算（外框畫得不準會混進牆面）；反光是白的、背光面色相不變，都不算
    const hsv = (r, g, b) => {
      const mx = Math.max(r, g, b), c = mx - Math.min(r, g, b);
      const hh = !c ? 0 : mx === r ? ((g - b) / c + 6) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4;
      return [hh * 60, mx ? c / mx : 0, mx / 255];
    };
    const [h1, s1, v1] = hsv(...rgb), deep = (x, y) => x >= 0 && y >= 0 && x < w && y < h && inside[y * w + x];
    let n = 0, o = 0;
    for (const i of bare) {
      const x = (i >> 2) % w, y = ((i >> 2) / w) | 0;
      if (!deep(x - 2, y) || !deep(x + 2, y) || !deep(x, y - 2) || !deep(x, y + 2)) continue;
      const [hh, ss, vv] = hsv(d[i], d[i + 1], d[i + 2]), dh = Math.min(Math.abs(hh - h1), 360 - Math.abs(hh - h1));
      n++;
      if ((ss > 0.35 && vv > 0.2 && (s1 < 0.25 || dh > 35)) || (v1 > 0.5 && vv < v1 * 0.3) || (v1 < 0.3 && vv > 0.7)) o++;
    }
    const res = { c: `rgb(${rgb.join(',')})`, odd: n ? o / n : 1 };
    surfaceColors.set(host.poly, { img, n: atop.length, s: res });
    return res;
  }
  // 路線岩點要上原色的範圍畫成黑色（m 已設好座標轉換）。回傳染色：照片換進遮罩（source-in）之後、同樣的座標轉換下呼叫，
  // 把 volume 染成自己的顏色（混合模式 color：色相、彩度用 volume 的，明暗用照片的），選進路線、鎖在上面的不染
  function routeMask(m, routeHolds, all) {
    const L = routeLayers(routeHolds, all);
    m.fillStyle = '#000';
    for (const h of routeHolds) { m.beginPath(); tracePoly(m, h.poly); m.fill(); }
    return (img) => {
      if (!L.volumes.length) return;
      // 遮罩共用一張畫布：出錯也要還原狀態（留著 clip、混合模式，之後每張底圖都會壞），路線岩點照樣是原色、只是沒染
      m.save();
      try { tintVolumes(m, img, L, routeHolds); } catch (e) { console.error('volume 染色失敗', e); }
      m.restore();
    };
  }
  function tintVolumes(m, img, L, routeHolds) {
    m.globalCompositeOperation = 'color';
    for (const v of L.volumes) {
      const unused = L.riders.filter(r => r.host === v).map(r => r.h), atop = unused.concat(routeHolds.filter(h => h !== v));
      const s = surfaceColor(img, v, atop);
      // 上面沒有沒選的點、表面也看不出別顆點（例如藍 volume 上沒偵測到的藍點）就不染：照片原本的樣子最自然
      if (!unused.length && s.odd < 0.008) continue;
      m.beginPath(); tracePoly(m, v.poly);
      m.fillStyle = s.c; m.fill();
      // 再蓋六成 volume 的顏色：明暗的對比降成四成，黑 volume 上的淺色點、淺 volume 上的深色點都淡掉，紋理還在
      m.globalCompositeOperation = 'source-over'; m.globalAlpha = 0.6; m.fill();
      m.globalCompositeOperation = 'color'; m.globalAlpha = 1;
    }
    // 選進路線、跟 volume 重疊的（不是 volume 的）換回原色：中心沒落在 volume 上、只壓到一角的也算
    const vb = L.volumes.map(v => bbox(v.poly));
    const keep = routeHolds.filter(h => {
      if (L.volumes.includes(h)) return false;
      const b = bbox(h.poly);
      return vb.some(q => b.x0 < q.x1 && b.x1 > q.x0 && b.y0 < q.y1 && b.y1 > q.y0);
    });
    m.globalCompositeOperation = 'source-over';
    for (const h of keep) { m.save(); m.beginPath(); tracePoly(m, h.poly); m.clip(); m.drawImage(img, 0, 0); m.restore(); }
  }
  // 灰階底（gray）：灰階壓到固定亮度範圍再上一層冷灰。整面牆算一張（scene.plain），每條路線、小卡都從這張拿
  function plainGrayOf(img) {
    const g = grayOf(img);
    liftTint(g.getContext('2d'), g.width, g.height);
    return g;
  }
  // 路線岩點的原色圖層：只有路線岩點的外接框（加 2 px 給柔邊）那麼大，疊在共用的底上（drawRouteBase）。
  // 路線岩點整個外框用照片原本的顏色（外框就是岩點：重描過、改過、手畫的都準），邊緣 1 px 柔邊；路線上的 volume 整顆染成自己的顏色（見 routeLayers）。
  // tint：volume 染色（定線時不染，看得到 volume 上的點）。回傳 { c, x, y }（c 放在照片的 x, y）；沒有岩點回傳 null
  function routeLayer(img, routeHolds, all, { tint = true } = {}) {
    if (!routeHolds.length) return null;
    const bs = routeHolds.map(h => bbox(h.poly));
    const x = Math.max(0, Math.floor(Math.min(...bs.map(b => b.x0))) - 2), y = Math.max(0, Math.floor(Math.min(...bs.map(b => b.y0))) - 2);
    const x1 = Math.min(img.width, Math.ceil(Math.max(...bs.map(b => b.x1))) + 2), y1 = Math.min(img.height, Math.ceil(Math.max(...bs.map(b => b.y1))) + 2);
    const c = document.createElement('canvas'); c.width = Math.max(1, x1 - x); c.height = Math.max(1, y1 - y);
    const m = c.getContext('2d'), at = () => m.setTransform(1, 0, 0, 1, -x, -y), id = () => m.setTransform(1, 0, 0, 1, 0, 0);
    // 先一顆一顆填（重疊的照樣是聯集），最後整塊模糊一次：開著濾鏡填，每填一顆就模糊一次（11 顆要半秒以上）
    at(); const cover = routeMask(m, routeHolds, all); id();
    m.globalCompositeOperation = 'copy'; m.filter = 'blur(1px)'; m.drawImage(c, 0, 0); m.filter = 'none';
    m.globalCompositeOperation = 'source-in'; m.drawImage(img, x, y, c.width, c.height, 0, 0, c.width, c.height);
    if (tint) { at(); cover(img); id(); }
    return { c, x, y };
  }
  // 路線岩點外圍一圈角色色的光暈（跟 3D 牆一樣：底變暗、路線岩點原色、外圍角色色的光暈）。roles：{ 岩點 id: 角色 }；colors：角色色；
  // dpr：畫布的裝置像素比。模糊寬度用螢幕像素（放大縮小一樣寬），兩層：外圈淡而柔（標準差約 3.5 點，節制、不散開）、內圈窄而亮；岩點是重點，光暈只是外圍一小圈。
  // 畫在共用的底上、路線岩點的原色圖層之前：岩點裡面之後被原色蓋住，只留外圈
  // 光暈做在縮小的畫布上（先畫角色色的岩點，再模糊），然後放大蓋到畫面上：縮放、平移每一格都要重畫，
  // 直接在大畫布上用 shadowBlur 一格要 20 多毫秒，這樣只要幾毫秒。一層窄的淡（縮成二分之一），外框的細線由畫的人另外描（strokeRouteHold）。
  // 畫布沒有 filter（iPhone）就退回 shadowBlur
  const GLOW_PASSES = [{ sigma: 7, alpha: 1, small: 2 }, { sigma: 2.4, alpha: 1, small: 2 }];   // 一層寬的、一層貼著岩點的亮邊   // sigma：標準差（螢幕點）
  const GLOW_GROW = 6;   // 光暈來源的岩點外擴的寬度（螢幕點，內外各一半）
  const glowCanvases = [];
  const glowCanvas = (i, w, h) => {
    const c = glowCanvases[i] || (glowCanvases[i] = document.createElement('canvas'));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return c;
  };
  function drawGlow(c, routeHolds, roles, colors, dpr = 1) {
    const W = c.canvas.width, H = c.canvas.height, T = c.getTransform();
    if (!('filter' in c)) { drawGlowShadow(c, routeHolds, roles, colors, dpr); return; }
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
    GLOW_PASSES.forEach(({ sigma, alpha, small: k }, i) => {
      const w = Math.max(1, Math.ceil(W / k)), h = Math.max(1, Math.ceil(H / k)), src = glowCanvas(i * 2, w, h), dst = glowCanvas(i * 2 + 1, w, h);
      const sc = src.getContext('2d'), dc = dst.getContext('2d');
      sc.setTransform(1, 0, 0, 1, 0, 0); sc.clearRect(0, 0, w, h);
      sc.setTransform(T.a / k, T.b / k, T.c / k, T.d / k, T.e / k, T.f / k);
      for (const hold of routeHolds) {
        const col = colors[roles[hold.id]];
        if (!col) continue;
        sc.fillStyle = sc.strokeStyle = col; sc.lineJoin = 'round'; sc.lineWidth = GLOW_GROW * dpr / (T.a || 1); sc.beginPath(); tracePoly(sc, hold.poly); sc.fill(); sc.stroke();   // 外擴一圈再模糊：外圈才夠亮
      }
      dc.setTransform(1, 0, 0, 1, 0, 0); dc.clearRect(0, 0, w, h);
      dc.filter = `blur(${sigma * dpr / k}px)`; dc.drawImage(src, 0, 0); dc.filter = 'none';
      c.globalAlpha = alpha; c.drawImage(dst, 0, 0, W, H);
    });
    c.restore();
  }
  function drawGlowShadow(c, routeHolds, roles, colors, dpr) {
    c.save();
    for (const [blur, alpha] of [[9, 0.8], [3, 0.9]]) {
      c.shadowBlur = blur * dpr; c.globalAlpha = alpha;
      for (const h of routeHolds) {
        const col = colors[roles[h.id]];
        if (!col) continue;
        c.shadowColor = col; c.fillStyle = col;
        c.beginPath(); tracePoly(c, h.poly); c.fill();
      }
    }
    c.restore();
  }
  // 路線圖的底：共用的底（灰階或暗彩）＋（選用）光暈＋路線岩點的原色圖層。scene：RouteScene（plain、routeLayer 都記在 scene 上）；
  // mode：'gray' 灰階、'dim' 暗彩；tint 見 routeLayer；glow：{ roles, colors, dpr? }，沒給就沒有光暈
  function drawRouteBase(c, scene, routeHolds, { mode = 'gray', tint = true, glow } = {}) {
    c.drawImage(scene.plain(mode), 0, 0);
    glowLayered(c, routeHolds, glow, scene.routeLayer(routeHolds, { tint }));
  }
  // 疊在別顆路線岩點上的路線岩點（例如 volume 上的點）：它的光暈在 volume 的原色圖層下面會被蓋掉，
  // 所以這些點的光暈改畫在圖層上面，岩點裡面不蓋（挖掉外框內側），只留外圈
  function nestedHolds(routeHolds) {
    return routeHolds.filter(h => {
      const b = bbox(h.poly), x = (b.x0 + b.x1) / 2, y = (b.y0 + b.y1) / 2, a = area(h.poly);
      return routeHolds.some(o => o !== h && area(o.poly) > a && inPoly(x, y, o.poly));
    });
  }
  function glowLayered(c, routeHolds, glow, layer) {
    const nest = glow ? nestedHolds(routeHolds) : [], outer = nest.length ? routeHolds.filter(h => !nest.includes(h)) : routeHolds;
    if (glow) drawGlow(c, outer, glow.roles, glow.colors, glow.dpr);
    if (layer) c.drawImage(layer.c, layer.x, layer.y);
    if (!nest.length) return;
    c.save();
    c.beginPath(); c.rect(-1e6, -1e6, 2e6, 2e6);
    for (const h of nest) tracePoly(c, h.poly);
    c.clip('evenodd');
    drawGlow(c, nest, glow.roles, glow.colors, glow.dpr);
    c.restore();
  }

  // 畫在線條層（螢幕解析度、照片座標的轉換）上的光暈：順序跟 drawRouteBase 一樣——光暈在下、路線岩點的原色圖層（layer，沒給就不蓋）蓋在上面，
  // 岩點不挖洞、邊緣照原色圖層的柔邊，看起來自然。
  // 寬度照螢幕點算，放大縮小一樣寬（底圖是照片大小的畫布、用 CSS 縮放時，光暈要畫在這一層才不會跟著照片變粗變細）
  function glowAround(c, routeHolds, roles, colors, dpr = 1, layer = null) {
    if (!routeHolds.length) return;
    glowLayered(c, routeHolds, { roles, colors, dpr }, layer);
  }

  return { liftTint, tintCard, grayOf, plainGrayOf, mutedOf, routeLayers, prepareOverlapPick, routeMask, routeLayer, drawRouteBase, glowAround };
});
