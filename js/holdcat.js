// 岩點貓：照片裡的一顆岩點照自己的形狀和顏色變成一隻貓。新增牆面時幾顆岩點醒來，完攀時路線上的一顆岩點表演。
// 在 app.js 前載入；演出都是可中斷的單次動畫，手指一碰、切頁、回背景就收掉，減少動態時不演。
// English: Holdcats: a hold in the photo grows ears and a face (new wall wake-up, send celebration). Loaded before app.js.
'use strict';
const HoldCat = (() => {
  const calm = AppKit.ui.reducedMotion;
  const svgEl = AppKit.ui.svg;
  const box = (poly) => poly.reduce((b, [x, y]) => ({ x0: Math.min(b.x0, x), y0: Math.min(b.y0, y), x1: Math.max(b.x1, x), y1: Math.max(b.y1, y) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  const pts = (poly) => poly.map(p => p.join(',')).join(' ');
  function topY(poly, x) {
    let y = Infinity;
    poly.forEach((a, i) => { const b = poly[(i + 1) % poly.length]; if (a[0] !== b[0] && (a[0] - x) * (b[0] - x) <= 0) y = Math.min(y, a[1] + (x - a[0]) / (b[0] - a[0]) * (b[1] - a[1])); });
    return y === Infinity ? null : y;
  }
  // 一顆岩點變一隻貓：外框取凸包、重新取樣再磨圓，保留岩點的大小、長寬和歪斜，去掉鋸齒和凹口
  function hull(poly) {
    const p = poly.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const half = (list) => list.reduce((h, q) => { while (h.length > 1 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop(); h.push(q); return h; }, []);
    const lo = half(p), up = half(p.slice().reverse());
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  function smooth(poly, n = 32) {
    const seg = poly.map((a, i) => Math.hypot(...[0, 1].map(j => poly[(i + 1) % poly.length][j] - a[j]))), total = seg.reduce((a, b) => a + b, 0);
    let p = [], i = 0, acc = 0;
    for (let s = 0; s < n; s++) {
      const d = s * total / n;
      while (acc + seg[i] < d) acc += seg[i++];
      const t = (d - acc) / (seg[i] || 1), a = poly[i], b = poly[(i + 1) % poly.length];
      p.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    for (let k = 0; k < 3; k++) p = p.map((q, j) => { const a = p[(j + n - 1) % n], b = p[(j + 1) % n]; return [(a[0] + 2 * q[0] + b[0]) / 4, (a[1] + 2 * q[1] + b[1]) / 4]; });
    return p;
  }
  // 經過各點中點的二次曲線，整圈是平滑的
  const curve = (p) => { const m = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], s = m(p[p.length - 1], p[0]); return `M${s}` + p.map((q, i) => `Q${q} ${m(q, p[(i + 1) % p.length])}`).join('') + 'Z'; };
  const lowY = (poly, x) => { let y = -Infinity; poly.forEach((a, i) => { const b = poly[(i + 1) % poly.length]; if (a[0] !== b[0] && (a[0] - x) * (b[0] - x) <= 0) y = Math.max(y, a[1] + (x - a[0]) / (b[0] - a[0]) * (b[1] - a[1])); }); return y === -Infinity ? null : y; };
  // 跟品牌 logo（design/brand/cats/hold-cat.svg）同一套畫法：平塗、往右下錯位的深色背層、鏤空的耳朵和螺絲孔，
  // 偏左的白臉、兩顆眼睛和鼻子直接用 logo 的形狀。身體換成這顆岩點的外框和顏色，不加鬍鬚、尾巴、漸層或陰影。
  // 臉放的位置依形狀：接近圓或直長的岩點臉在中間偏上（直長的更上面），扁長的岩點臉在比較高的那一端
  const LOGO = { cx: 510, cy: 405, w: 443,
    face: 'M323 360C372 323 464 289 544 274C613 257 682 261 709 299C732 333 700 410 657 460C624 502 602 544 538 549C470 552 380 511 332 478C288 447 289 398 323 360Z',
    nose: 'M514 435C536 426 561 421 574 435C581 447 562 463 553 481C546 495 536 483 532 470C518 461 508 452 514 435Z',
    eyes: [[440, 417, 23, 32], [614, 368, 24, 33]] };
  function catShape(poly) {
    const p = smooth(hull(poly)), b = box(p), w = b.x1 - b.x0, h = b.y1 - b.y0, cx = (b.x0 + b.x1) / 2;
    const span = (x) => [topY(p, x) ?? b.y0, lowY(p, x) ?? b.y1];
    let fx, fw, at = .45;
    if (w / h > 1.35) {
      const L = span(b.x0 + w * .25), R = span(b.x1 - w * .25);
      fw = Math.min(h * 1.05, w * .55);
      fx = L[0] < R[0] ? b.x0 + fw * .62 : b.x1 - fw * .62;
    } else {
      fw = Math.min(w * .8, h * .95); fx = cx - w * .04;
      if (h > w * 1.2) at = .34;
    }
    const [t, l] = span(fx), fy = t + (l - t) * at;
    // 耳朵：圓頭的三角形從外框上緣長出來（左耳稍微往外歪、高一點），中間鏤空一個小三角形
    const ear = (dx, out, tall) => {
      const x = fx + dx * fw, e = fw * tall, y = (topY(p, x) ?? b.y0) + e * .3, bw = fw * .2, tx = x + out * e * .22, ty = y - e;
      const r = e * .16, ux = (tx - (x - bw)) , uy = ty - y, k = r / Math.hypot(ux, uy), vx = tx - (x + bw), vk = r / Math.hypot(vx, uy);
      const d = `M${x - bw} ${y}L${tx - ux * k} ${ty - uy * k}Q${tx} ${ty} ${tx - vx * vk} ${ty - uy * vk}L${x + bw} ${y}Z`;
      const g = [(x - bw + tx + x + bw) / 3, (y + ty + y) / 3 - e * .14], hole = [[x - bw, y], [tx, ty], [x + bw, y]].map(([qx, qy]) => [g[0] + (qx - g[0]) * .42, g[1] + (qy - g[1]) * .42]);
      return { d, hole, top: ty };
    };
    const ears = [ear(-.38, -1, .5), ear(.3, 1, .46)];
    // 螺絲孔：臉下面、身體裡面放得下才放
    const r = fw * .075, sx = fx + fw * .08, fb = fy + fw / LOGO.w * 150, sy = fb + (lowY(p, sx) ?? b.y1) - fb > r * 4 ? (fb + (lowY(p, sx) ?? b.y1)) / 2 : null;
    return { p, b, fx, fy, fw, ears, screw: sy && [sx, sy, r] };
  }
  // 五位主角（設定在 design/brand/holdcats.md）：示範牆上照設計畫的岩點醒來時不照外框推，直接畫角色本人。
  // 座標各自一套（綠綠就是 logo 的座標）；body 是牆上的岩點外形，back 是往右下錯位的深色背層（沒寫就是 body 錯開 off），
  // ears 從身體長出來、holes 是耳朵和螺絲孔的鏤空、pocket 是口袋，face 是白臉的 [x, y, 縮放, 角度]，expr 是表情
  const EYES = [[440, 417], [614, 368]], INK = 'fill="none" stroke="#233238" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"';
  const NOSE = `<path d="${LOGO.nose}" fill="#233238"/>`;
  const EXPR = {
    logo: [LOGO.eyes.map(([cx, cy, rx, ry]) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#233238"/>`).join(''), NOSE],
    // 條條：眼皮蓋一半、眼珠往旁邊瞄，嘴角一邊翹起來
    sly: [EYES.map(([x, y]) => `<path d="M${x - 28} ${y - 6}L${x + 28} ${y - 14}Q${x + 26} ${y + 22} ${x + 4} ${y + 24}Q${x - 22} ${y + 24} ${x - 28} ${y - 6}Z" fill="#233238"/><circle cx="${x + 12}" cy="${y + 8}" r="6" fill="#F7F8F4"/>`).join(''), NOSE + `<path d="M512 505Q548 522 590 486" ${INK}/>`],
    // 圓圓：瞇成兩道彎、臉頰紅紅的
    sleepy: [EYES.map(([x, y]) => `<path d="M${x - 30} ${y - 4}Q${x} ${y + 26} ${x + 30} ${y - 4}" ${INK}/>`).join(''), EYES.map(([x, y]) => `<ellipse cx="${x - 14}" cy="${y + 52}" rx="30" ry="16" fill="#FFB3C1"/>`).join('') + NOSE],
    // 尖尖：眼睛又大又圓、有亮點，嘴巴一個小 o
    wow: [EYES.map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="31" ry="39" fill="#233238"/><circle cx="${x + 10}" cy="${y - 14}" r="10" fill="#F7F8F4"/>`).join(''), `<path d="${LOGO.nose}" transform="translate(0 -12)" fill="#233238"/><ellipse cx="556" cy="505" rx="17" ry="21" fill="#233238"/>`],
    // 洞洞：笑成 ^ ^
    happy: [EYES.map(([x, y]) => `<path d="M${x - 28} ${y + 14}L${x} ${y - 16}L${x + 28} ${y + 14}" ${INK}/>`).join(''), NOSE],
  };
  const CAST = {
    lulu: { color: ['#A4DC2A', '#709F39'], hold: '#9BCF2E', c: [461, 517], expr: 'logo', face: [515, 410, 1, 0], screw: [570, 738, 35],
      body: 'M90 444C104 395 160 345 223 309C330 250 560 172 758 185C803 201 832 229 832 277C832 325 812 369 782 434C739 521 714 582 713 643C713 710 723 764 686 814C656 861 599 874 549 856C481 829 457 765 429 716C408 676 370 647 326 624C258 590 173 571 119 535C88 514 79 480 90 444Z',
      back: 'M234 354C301 295 394 255 502 224C607 193 710 171 801 170C878 167 955 174 969 228C984 285 946 349 884 427C823 507 782 560 754 632C719 719 668 815 610 837C554 865 498 816 457 763C413 700 381 652 328 624C266 593 187 565 147 517C117 481 174 400 234 354Z',
      ears: ['M223 309C239 263 240 204 256 163C266 136 289 135 308 146L437 221L420 300L240 340Z', 'M548 186L643 62C658 43 682 43 696 70L758 185L740 240L560 240Z'],
      holes: ['M283 213Q291 193 305 206L380 251L284 299Z', 'M654 154Q668 134 678 148L708 222L615 219Z'] },
    tiaotiao: { color: ['#FF7A93', '#C4466A'], hold: '#F2708A', c: [512, 205], expr: 'sly', face: [742, 208, .5, -6], screw: [300, 215, 24],
      body: 'M70 250C60 170 180 120 400 105C620 92 860 100 930 160C980 205 950 270 870 285C680 315 330 320 170 305C100 298 75 285 70 250Z',
      ears: ['M584 122L626 14Q638 -8 656 14L716 112Z', 'M756 112L818 14Q834 -6 846 18L872 136Z'], holes: ['M620 100L640 46L670 102Z', 'M790 104L822 50L840 112Z'] },
    yuanyuan: { color: ['#5BB8F5', '#2F7FBF'], hold: '#55AEEA', c: [502, 396], expr: 'sleepy', face: [500, 395, .95, 0], screw: [745, 565, 26],
      body: 'M90 600C70 330 260 130 500 125C740 120 935 320 915 600C912 650 870 668 810 668L195 668C130 668 95 650 90 600Z',
      ears: ['M240 158a82 82 0 1 0 164 0a82 82 0 1 0 -164 0Z', 'M596 158a82 82 0 1 0 164 0a82 82 0 1 0 -164 0Z'], holes: ['M292 150a30 30 0 1 0 60 0a30 30 0 1 0 -60 0Z', 'M648 150a30 30 0 1 0 60 0a30 30 0 1 0 -60 0Z'] },
    jianjian: { color: ['#FFC83D', '#CC9214'], hold: '#F5BE35', c: [400, 500], expr: 'wow', face: [398, 420, .72, 15], screw: [575, 770, 24],
      body: 'M282 190Q292 150 336 150L464 150Q508 150 518 190L760 760Q790 850 690 850L110 850Q10 850 40 760Z',
      ears: ['M262 250L250 70Q250 40 278 54L380 160Z', 'M420 160L522 54Q550 40 550 70L538 250Z'], holes: ['M276 214L270 100L346 160Z', 'M454 160L530 100L524 214Z'] },
    dongdong: { color: ['#A27BFF', '#6C4BCF'], hold: '#9775F2', c: [460, 375], expr: 'happy', face: [458, 418, .6, 12], pocket: [462, 415, 195, 128],
      body: 'M110 400C90 210 250 90 450 90C670 90 830 210 810 410C795 580 650 660 455 660C255 660 125 570 110 400Z',
      ears: ['M196 228Q194 74 300 80Q366 88 386 152Z', 'M548 146Q596 62 690 80Q736 118 724 232Z'], holes: ['M236 188Q240 120 296 124Q330 128 340 156Z', 'M590 150Q616 116 668 122Q690 146 686 196Z'] },
  };
  // 角色擺在牆上的位置：[誰, 中心 x, 中心 y, 縮放, 角度]（照片座標）；岩點外框和醒來的貓都照這個換算
  const castAt = ([who, x, y, s, deg]) => `translate(${x} ${y}) rotate(${deg}) scale(${s}) translate(${-CAST[who].c[0]} ${-CAST[who].c[1]})`;
  function castCat(at, vb) {
    const a = CAST[at[0]], id = 'hc' + AppKit.files.rid(6), [front, back] = a.color, off = 'translate(30 24)';
    const cat = svgEl('svg', { class: 'hc-cat', viewBox: vb, overflow: 'visible' }), art = svgEl('g', { transform: castAt(at) });
    const cut = (a.holes || []).map(d => `<path d="${d}" fill="#000" stroke="#000" stroke-width="8" stroke-linejoin="round"/>`).join('')
      + (a.screw ? `<circle cx="${a.screw[0]}" cy="${a.screw[1]}" r="${a.screw[2]}" fill="#000"/>` : '');
    const ear = (fill, tf = '') => (a.ears || []).map(d => `<path d="${d}" fill="${fill}" stroke="${fill}" stroke-width="10" stroke-linejoin="round"${tf}/>`).join('');
    const p = a.pocket, [eyes, rest] = EXPR[a.expr], [fx, fy, fs, fr] = a.face;
    art.innerHTML = `<mask id="${id}" maskUnits="userSpaceOnUse" x="-600" y="-600" width="2200" height="2200"><rect x="-600" y="-600" width="2200" height="2200" fill="#fff"/>${cut}</mask>`
      + `<g mask="url(#${id})"><path d="${a.back || a.body}" fill="${back}"${a.back ? '' : ` transform="${off}"`}/><g class="hc-ears">${a.back ? '' : ear(back, ` transform="${off}"`)}${ear(front)}</g><path d="${a.body}" fill="${front}"/></g>`
      + (p ? `<ellipse cx="${p[0]}" cy="${p[1]}" rx="${p[2]}" ry="${p[3]}" fill="#233238"/>` : '')
      + `<g class="hc-face"><g transform="translate(${fx} ${fy}) rotate(${fr}) scale(${fs}) translate(${-LOGO.cx} ${-LOGO.cy})"><path d="${LOGO.face}" fill="#F7F8F4"/><g class="hc-eyes">${eyes}</g>${rest}</g></g>`;
    cat.append(art);
    return { cat, ears: art.querySelector('.hc-ears'), mug: art.querySelector('.hc-face'), eyes: art.querySelector('.hc-eyes') };
  }
  const mix = (c, to, t) =>`rgb(${c.map((v, i) => Math.round(v + (to[i] - v) * t)).join(',')})`;
  // 岩點本身的平均顏色，飽和度拉高一點；太白的壓暗一點，白臉才看得出來
  function holdColor(c) {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let r = 0, g = 0, bl = 0, n = 0;
    for (let i = 0; i < d.length; i += 16) if (d[i + 3] > 200) { r += d[i]; g += d[i + 1]; bl += d[i + 2]; n++; }
    if (!n) return [150, 150, 156];
    const m = [r / n, g / n, bl / n], avg = (m[0] + m[1] + m[2]) / 3, dim = avg > 190 ? .8 : 1;
    return m.map(v => Math.max(0, Math.min(255, (avg + (v - avg) * 1.8) * dim)));
  }

  // 演出圖層：疊在照片上，跟照片同一個大小與位置；k 是照片座標換成畫面 px 的比例
  let layer = null, anims = [], timers = [], raf = 0, abort = null;
  function stop() {
    abort?.(); abort = null;
    anims.forEach(a => a.cancel()); anims = [];
    timers.forEach(clearTimeout); timers = []; cancelAnimationFrame(raf);
    layer?.remove(); layer = null;
  }
  // shade：岩點離開原位時留下的影子有多深（暗的掃描畫面要蓋住照片裡同一顆，淺灰的路線圖只要像影子）
  function open(host, rect, shade) {
    stop();
    layer = document.createElement('div'); layer.className = 'hc-layer';
    layer.style.setProperty('--hc-shade', shade);
    Object.assign(layer.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' });
    host.append(layer);
    return layer;
  }
  const play = (el, frames, opts) => { const a = el.animate(frames, { fill: 'both', easing: 'ease-in-out', ...opts }); anims.push(a); return a; };
  // 很多段的關鍵影格：緩動放在每一段上，整段時間軸維持線性，關鍵影格才會落在寫的時間點
  const keyed = (el, frames, opts) => play(el, frames.map(f => ({ easing: 'ease-in-out', ...f })), { ...opts, easing: 'linear' });

  // 一顆岩點演員：原位的影子、從來源裁下來的岩點本身、照這顆岩點形狀畫的貓（平常藏著；asCat 為 false 只是完攀時震動的岩點，不畫貓）。src 是照片或畫好的畫布，scale 是來源 px／照片座標
  // 畫面上太小的岩點，變成貓時跟著放大（腳踩在原地），最多放到 2.4 倍
  const CAT_PX = 66;
  function actor(poly, { src, scale, k, asCat = true, at = null }) {
    const b = box(poly), w = b.x1 - b.x0, h = b.y1 - b.y0, dpr = devicePixelRatio || 1;
    const place = (el) => { Object.assign(el.style, { left: b.x0 * k + 'px', top: b.y0 * k + 'px', width: w * k + 'px', height: h * k + 'px' }); return el; };
    const vb = `${b.x0} ${b.y0} ${w} ${h}`;
    const shade = place(svgEl('svg', { class: 'hc-shade', viewBox: vb, preserveAspectRatio: 'none' }));
    shade.append(svgEl('polygon', { points: pts(poly) }));
    const piece = document.createElement('canvas');
    piece.width = Math.max(1, Math.ceil(w * k * dpr)); piece.height = Math.max(1, Math.ceil(h * k * dpr));
    const g = piece.getContext('2d'), u = piece.width / w;
    g.beginPath(); poly.forEach(([x, y], i) => i ? g.lineTo((x - b.x0) * u, (y - b.y0) * u) : g.moveTo((x - b.x0) * u, (y - b.y0) * u)); g.closePath(); g.clip();
    g.drawImage(src, b.x0 * scale, b.y0 * scale, w * scale, h * scale, 0, 0, piece.width, piece.height);
    const el = place(document.createElement('div')), inner = document.createElement('div');
    el.className = 'hc-actor'; inner.className = 'hc-inner';
    inner.append(piece); el.append(inner); layer.append(shade, el);
    if (!asCat) return { body: el, inner, shade, piece };
    const m = Math.max(1, Math.min(2.4, CAT_PX / (Math.sqrt(w * h) * k)));
    if (at) {
      const { cat, ears, mug, eyes } = castCat(at, vb);
      cat.style.opacity = 0; ears.style.transform = 'scaleY(0)'; mug.style.transform = 'scale(0)';
      inner.append(cat);
      return { body: el, inner, shade, piece, cat, ears, mug, eyes, m: Math.min(m, 1.3), w: w * k, h: h * k };   // 主角照設計擺好了，只稍微放大，不擠出畫面
    }
    const c = catShape(poly), base = holdColor(piece), id = 'hc' + AppKit.files.rid(6), F = c.fw;
    const cat = svgEl('svg', { class: 'hc-cat', viewBox: vb, overflow: 'visible' });
    // 鏤空：耳朵裡的小三角形、螺絲孔，透出後面的照片
    const mask = svgEl('mask', { id, maskUnits: 'userSpaceOnUse', x: b.x0 - w, y: b.y0 - h * 2, width: w * 3, height: h * 4 });
    mask.append(svgEl('rect', { x: b.x0 - w, y: b.y0 - h * 2, width: w * 3, height: h * 4, fill: '#fff' }));
    c.ears.forEach(e => mask.append(svgEl('polygon', { points: pts(e.hole), fill: '#000', stroke: '#000', 'stroke-width': F * .03, 'stroke-linejoin': 'round' })));
    if (c.screw) mask.append(svgEl('circle', { cx: c.screw[0], cy: c.screw[1], r: c.screw[2], fill: '#000' }));
    const front = mix(base, [0, 0, 0], 0), back = mix(base, [0, 0, 0], .34), cut = `url(#${id})`;
    const shape = curve(c.p), backBody = svgEl('path', { d: shape, fill: back, transform: `translate(${F * .2} ${F * .05})`, mask: cut });
    const ears = svgEl('g', { class: 'hc-ears' });
    c.ears.forEach(e => ears.append(svgEl('path', { d: e.d, fill: front, mask: cut })));
    const body = svgEl('path', { d: shape, fill: front, mask: cut });
    const mug = svgEl('g', { class: 'hc-face' }), art = svgEl('g', { transform: `translate(${c.fx} ${c.fy}) scale(${F / LOGO.w}) translate(${-LOGO.cx} ${-LOGO.cy})` }), eyes = svgEl('g', { class: 'hc-eyes' });
    LOGO.eyes.forEach(([cx, cy, rx, ry]) => eyes.append(svgEl('ellipse', { cx, cy, rx, ry, fill: '#233238' })));
    art.append(svgEl('path', { d: LOGO.face, fill: '#F7F8F4' }), eyes, svgEl('path', { d: LOGO.nose, fill: '#233238' }));
    mug.append(art);
    cat.append(mask, backBody, ears, body, mug);
    cat.style.opacity = 0; ears.style.transform = 'scaleY(0)'; mug.style.transform = 'scale(0)';
    inner.append(cat);
    return { body: el, inner, shade, piece, cat, ears, mug, eyes, m, w: w * k, h: h * k };
  }
  // 變身（照 docs/mascot-motion.md 的果凍岩點貓）：岩點先被拉一下，顏色化開變成貓的身體（小岩點順便長大），耳朵冒出來、臉從中心浮上來，眨眼；
  // ms 結束前反過來：耳朵縮回、臉往中心收，變回岩點。長出來和收回去用固定的時間，ms 只決定當貓多久；look 是長好之後左右看一下
  const GROW = 640, SHRINK = 460;
  function catFace(a, ms, delay, { look = false } = {}) {
    const f = (t) => Math.max(0, Math.min(1, t / ms)), out = (t) => f(ms - t), sc = (v) => `scale(${1 + (a.m - 1) * v})`;
    a.piece.style.transformOrigin = '50% 100%';
    keyed(a.piece, [{ transform: 'none', opacity: 1 }, { transform: 'scale(1.08,.9)', opacity: 1, offset: f(120) }, { transform: 'scale(.97,1.05)', opacity: .6, offset: f(260) }, { transform: 'none', opacity: 0, offset: f(380) },
      { transform: 'none', opacity: 0, offset: out(SHRINK * .5) }, { transform: 'scale(1.05,.95)', opacity: 1, offset: out(SHRINK * .1) }, { transform: 'none', opacity: 1 }], { duration: ms, delay });
    keyed(a.cat, [{ opacity: 0, transform: 'scale(.92,.86)' }, { opacity: 0, transform: 'scale(.92,.86)', offset: f(160) }, { opacity: 1, transform: 'scale(1.05,.97)', offset: f(360) }, { opacity: 1, transform: 'scale(.98,1.03)', offset: f(480) }, { opacity: 1, transform: 'none', offset: f(GROW - 60) },
      { opacity: 1, transform: 'none', offset: out(SHRINK * .55) }, { opacity: 0, transform: 'scale(.94,.9)', offset: out(SHRINK * .1) }, { opacity: 0, transform: 'scale(.94,.9)' }], { duration: ms, delay });
    if (a.m > 1) keyed(a.inner, [{ transform: 'none' }, { transform: 'none', offset: f(120) }, { transform: sc(1.06), offset: f(470) }, { transform: sc(1), offset: f(GROW) },
      { transform: sc(1), offset: out(SHRINK * .75) }, { transform: 'none', offset: out(SHRINK * .1) }, { transform: 'none' }], { duration: ms, delay });
    keyed(a.ears, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(0)', offset: f(300) }, { transform: 'scaleY(1.18)', offset: f(450) }, { transform: 'scaleY(.94)', offset: f(540) }, { transform: 'scaleY(1)', offset: f(GROW) },
      { transform: 'scaleY(1)', offset: out(SHRINK) }, { transform: 'scaleY(1.1)', offset: out(SHRINK * .85) }, { transform: 'scaleY(0)', offset: out(SHRINK * .55) }, { transform: 'scaleY(0)' }], { duration: ms, delay });
    keyed(a.mug, [{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(0)', opacity: 0, offset: f(340) }, { transform: 'scale(1.08)', opacity: 1, offset: f(500) }, { transform: 'scale(1)', opacity: 1, offset: f(GROW) },
      { transform: 'scale(1)', opacity: 1, offset: out(SHRINK) }, { transform: 'scale(0)', opacity: 0, offset: out(SHRINK * .65) }, { transform: 'scale(0)', opacity: 0 }], { duration: ms, delay });
    const t0 = GROW + 160, frames = [{ transform: 'none' }, { transform: 'none', offset: f(t0) }, { transform: 'scaleY(.1)', offset: f(t0 + 70) }, { transform: 'none', offset: f(t0 + 150) }];
    if (look) frames.push({ transform: 'none', offset: f(t0 + 260) }, { transform: 'translateX(-10%)', offset: f(t0 + 380) }, { transform: 'translateX(-10%)', offset: f(t0 + 560) }, { transform: 'translateX(10%)', offset: f(t0 + 700) }, { transform: 'translateX(10%)', offset: f(t0 + 880) }, { transform: 'none', offset: f(t0 + 1000) });
    keyed(a.eyes, [...frames.filter(x => x.offset === undefined || x.offset < 1), { transform: 'none' }], { duration: ms, delay });
  }
  const done = () => Promise.all(anims.map(a => a.finished)).then(() => ({ cancelled: false }), () => ({ cancelled: true }));

  // ---------- 新增牆面：偵測到的岩點由上往下帶果凍回彈浮出來，再挑幾顆醒來，最後整面由下往上亮一波 ----------
  // 醒來的岩點：偏大但不是 volume（面積前 4% 不挑）、形狀接近圓，每次隨機挑、彼此不擠在一起
  function pickWake(holds, n) {
    const items = holds.map(h => ({ h, b: box(h.poly) })).map(x => ({ ...x, a: (x.b.x1 - x.b.x0) * (x.b.y1 - x.b.y0), c: [(x.b.x0 + x.b.x1) / 2, (x.b.y0 + x.b.y1) / 2] }));
    const sorted = items.map(x => x.a).sort((a, b) => a - b), lo = sorted[Math.floor(sorted.length * .72)], hi = sorted[Math.floor(sorted.length * .96)];
    const picked = [];
    const cand = items.filter(x => { const r = (x.b.x1 - x.b.x0) / (x.b.y1 - x.b.y0); return !picked.includes(x) && x.a >= lo && x.a <= hi && r > .6 && r < 1.6; });
    for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
    const all = box(holds.flatMap(h => h.poly)), gap = Math.hypot(all.x1 - all.x0, all.y1 - all.y0) * .12;   // 太近的先跳過，不夠再補
    const far = (x) => picked.every(p => Math.hypot(p.c[0] - x.c[0], p.c[1] - x.c[1]) > gap);
    for (const x of cand) if (picked.length < n && far(x)) picked.push(x);
    for (const x of cand) if (picked.length < n && !picked.includes(x)) picked.push(x);
    return picked.map(x => x.h);
  }
  // base：已經畫好的畫布（岩點照原色畫上去）；fx：同大小的畫布，畫正在浮出來的岩點。onCount(n) 回報亮到第幾顆
  // 直接畫好（重描完換外框、減少動態）不打斷正在醒來的岩點
  function reveal({ base, fx, img, holds, w, dur, onCount }) {
    const g = base.getContext('2d'), q = fx.getContext('2d'), k = base.width / w, src = img.width / w;
    const cy = (h) => h.poly.reduce((a, p) => a + p[1], 0) / h.poly.length;
    const list = holds.slice().sort((a, b) => cy(a) - cy(b)), n = list.length, POP = 450;
    const trace = (c, h, s, ox, oy) => { c.beginPath(); h.poly.forEach(([x, y], j) => { const px = ox + (x * k - ox) * s[0], py = oy + (y * k - oy) * s[1]; j ? c.lineTo(px, py) : c.moveTo(px, py); }); c.closePath(); };
    const draw = (c, h, s = [1, 1], edge = 0) => {
      const b = box(h.poly), ox = (b.x0 + b.x1) / 2 * k, oy = b.y1 * k;
      c.save(); trace(c, h, s, ox, oy); c.clip();
      c.translate(ox, oy); c.scale(s[0], s[1]); c.translate(-ox, -oy);
      c.drawImage(img, b.x0 * src, b.y0 * src, (b.x1 - b.x0) * src, (b.y1 - b.y0) * src, b.x0 * k, b.y0 * k, (b.x1 - b.x0) * k, (b.y1 - b.y0) * k);
      c.restore();
      if (edge > 0) { trace(c, h, s, ox, oy); c.lineJoin = 'round'; c.lineWidth = 2.5 * (devicePixelRatio || 1); c.strokeStyle = `rgba(212,255,79,${edge})`; c.stroke(); }
    };
    // 果凍回彈：壓扁浮出 → 拉長 → 小回彈
    const popScale = (p) => p < .3 ? [.15 + p / .3 * 1.03, .15 + p / .3 * .65] : p < .55 ? [1.18 - (p - .3) / .25 * .25, .8 + (p - .3) / .25 * .29] : p < .78 ? [.93 + (p - .55) / .23 * .1, 1.09 - (p - .55) / .23 * .12] : [1.03 - (p - .78) / .22 * .03, .97 + (p - .78) / .22 * .03];
    const at = list.map((h, i) => dur * i / Math.max(1, n));
    if (!dur || calm()) { list.forEach(h => draw(g, h)); onCount(n); return Promise.resolve({ cancelled: false, instant: true }); }
    stop();
    return new Promise(resolve => {
      const t0 = performance.now(); let committed = 0;
      const step = () => {
        const t = performance.now() - t0;
        q.clearRect(0, 0, fx.width, fx.height);
        for (let i = committed; i < n && at[i] <= t; i++) {
          const p = (t - at[i]) / POP;
          if (p >= 1 && i === committed) { draw(g, list[i]); committed++; continue; }
          if (p < 1) draw(q, list[i], popScale(p), 1 - p * .8);
        }
        onCount(Math.min(n, at.filter(x => x <= t).length));
        if (committed < n) raf = requestAnimationFrame(step);
        else { abort = null; resolve({ cancelled: false }); }
      };
      abort = () => resolve({ cancelled: true });
      raf = requestAnimationFrame(step);
    });
  }
  // 醒來：在 host（照片的容器）上疊演員，WAKE_N 隻一隻接一隻醒；做完一波亮光。回傳 Promise
  // cast：照設計畫在牆上的主角 { 岩點 id: [誰, x, y, 縮放, 角度] }（示範牆），這面牆有就是它們醒來，照角色本人畫
  const WAKE_N = 5, WAKE_GAP = 220;
  function wake({ host, rect, img, holds, w, base, cast = {} }) {
    if (calm() || !holds.length) return Promise.resolve({ cancelled: false });
    const k = rect.width / w, src = img.width / w;
    open(host, rect, .8);
    const WAKE = 2600;
    const stars = Object.keys(cast).map(id => holds.find(h => h.id === id)).filter(Boolean), cats = stars.length ? stars : pickWake(holds, WAKE_N);
    cats.forEach((h, i) => catFace(actor(h.poly, { src: img, scale: src, k, at: cast[h.id] }), WAKE, i * WAKE_GAP, { look: true }));
    // 一波亮光：外框由下往上亮過去
    const glow = document.createElement('canvas'); glow.className = 'hc-glow'; glow.width = base.width; glow.height = base.height; layer.append(glow);
    const gc = glow.getContext('2d'), gk = glow.width / w, list = holds.map(h => ({ h, cy: h.poly.reduce((a, p) => a + p[1], 0) / h.poly.length }));
    const startGlow = () => {
      const t0 = performance.now(), GLOW = 700, H = glow.height / gk, band = H * .25;
      const frame = () => {
        const p = Math.min(1, (performance.now() - t0) / GLOW), yb = H + band / 2 - p * (H + band);
        gc.clearRect(0, 0, glow.width, glow.height); gc.lineJoin = 'round'; gc.lineWidth = 3 * (devicePixelRatio || 1);
        for (const { h, cy } of list) {
          const a = Math.max(0, 1 - Math.abs(cy - yb) / band);
          if (!a) continue;
          gc.beginPath(); h.poly.forEach(([x, y], j) => j ? gc.lineTo(x * gk, y * gk) : gc.moveTo(x * gk, y * gk)); gc.closePath();
          gc.strokeStyle = `rgba(212,255,79,${a})`; gc.stroke();
        }
        if (p < 1) raf = requestAnimationFrame(frame); else gc.clearRect(0, 0, glow.width, glow.height);
      };
      raf = requestAnimationFrame(frame);
    };
    timers.push(setTimeout(startGlow, WAKE + (cats.length - 1) * WAKE_GAP - 300));
    return done().then(r => new Promise(ok => timers.push(setTimeout(() => ok(r), 500))));
  }

  // ---------- 完攀：畫面中間壓下一個大爪印，路線岩點跟著震一下，離爪印越遠越晚震 ----------
  // holds：路線岩點 [{ poly }]；src 是畫好的路線圖畫布（座標和照片相同）
  const STAMP = 360, HIT = STAMP * .55, SHAKE = 720, HOLD = 900;
  // 大爪印是一個沾滿止滑粉蓋上去的白色粉印：顆粒感、邊緣毛毛的、旁邊一圈淡淡的粉塵，放在真實的岩壁照片上也協調
  const PAW = 'M30 80C28 66 42 56 58 55C74 54 90 62 92 76C94 90 84 101 72 100C66 99 61 96 54 99C42 104 32 94 30 80Z'
    + 'M12 58C9 49 13 40 21 39C29 38 33 46 32 54C31 62 25 66 19 65C15 64 13 62 12 58Z'
    + 'M33 34C32 24 38 17 46 18C54 19 57 28 55 36C53 44 47 47 41 46C36 45 34 40 33 34Z'
    + 'M65 31C66 22 73 15 81 17C89 19 90 28 87 36C84 43 78 46 72 44C67 42 64 37 65 31Z'
    + 'M90 51C92 43 99 38 106 41C113 44 113 53 109 60C105 66 99 67 95 64C91 61 89 56 90 51Z';
  function chalkPaw() {
    const svg = svgEl('svg', { viewBox: '0 6 120 102' }), f = svgEl('filter', { id: 'hc-chalk', x: '-20%', y: '-20%', width: '140%', height: '140%' });
    // 細顆粒讓邊緣毛毛的、有一點點雜點；大塊的雲紋讓粉有厚有薄，不是均勻的雜訊
    [['feTurbulence', { type: 'fractalNoise', baseFrequency: 1.1, numOctaves: 1, seed: 3, result: 'fine' }],
      ['feTurbulence', { type: 'fractalNoise', baseFrequency: .07, numOctaves: 3, seed: 9, result: 'blot' }],
      ['feDisplacementMap', { in: 'SourceGraphic', in2: 'fine', scale: 5, xChannelSelector: 'R', yChannelSelector: 'G', result: 'rough' }],
      ['feColorMatrix', { in: 'fine', type: 'matrix', values: '0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 1.6 0 0 0 .05', result: 'grain' }],
      ['feColorMatrix', { in: 'blot', type: 'matrix', values: '0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 2.2 0 0 0 -.3', result: 'thick' }],
      ['feComposite', { in: 'rough', in2: 'grain', operator: 'in', result: 'g' }],
      ['feComposite', { in: 'g', in2: 'thick', operator: 'in', result: 'print' }],
      ['feGaussianBlur', { in: 'rough', stdDeviation: 4, result: 'dust' }],
      ['feComponentTransfer', { in: 'dust', result: 'haze' }]].forEach(([tag, at]) => f.append(svgEl(tag, at)));
    f.lastChild.append(svgEl('feFuncA', { type: 'linear', slope: .35 }));
    const merge = svgEl('feMerge'); merge.append(svgEl('feMergeNode', { in: 'haze' }), svgEl('feMergeNode', { in: 'print' })); f.append(merge);
    svg.append(f, svgEl('path', { d: PAW, fill: '#F4F3EE', filter: 'url(#hc-chalk)', opacity: .9 }));
    return svg;
  }
  function celebrate({ host, rect, src, holds, w }) {
    if (calm()) return Promise.resolve({ cancelled: false });
    const k = rect.width / w, scale = src.width / w;
    open(host, rect, .25);
    // 蓋在看得到的畫面中間（照片放大、捲動時也一樣）
    const H = host.getBoundingClientRect(), L = layer.getBoundingClientRect(), x = H.left + H.width / 2 - L.left, y = H.top + H.height / 2 - L.top;
    const far = Math.hypot(H.width, H.height) / 2;
    holds.forEach(h => {
      const a = actor(h.poly, { src, scale, k, asCat: false }), b = box(h.poly), d = Math.hypot((b.x0 + b.x1) / 2 * k - x, (b.y0 + b.y1) / 2 * k - y);
      const j = Math.max(2.75, 6.5 * (1 - .5 * Math.min(1, d / far))), s = Math.random() < .5 ? 1 : -1;
      a.body.style.transformOrigin = '50% 50%';
      keyed(a.body, [{ transform: 'none' }, { transform: `translateY(${j}px) scale(1.09,.88)`, offset: .12 }, { transform: `translateX(${-j * s}px) rotate(${-j * s}deg)`, offset: .3 }, { transform: `translateX(${j * s * .8}px) rotate(${j * s * .8}deg)`, offset: .48 },
        { transform: `translateX(${-j * s * .45}px) rotate(${-j * s * .45}deg)`, offset: .66 }, { transform: `translateX(${j * s * .2}px)`, offset: .83 }, { transform: 'none' }], { duration: SHAKE, delay: HIT + d / far * 220 });
    });
    const size = Math.min(150, H.width * .4), big = document.createElement('span'); big.className = 'hc-paw';
    Object.assign(big.style, { left: x - size / 2 + 'px', top: y - size / 2 + 'px', width: size + 'px', height: size + 'px' });
    const svg = chalkPaw();
    big.append(svg); layer.append(big);
    keyed(big, [{ opacity: 0, transform: 'scale(1.8)' }, { opacity: 1, transform: 'scale(.88)', offset: .55 }, { opacity: 1, transform: 'none' }], { duration: STAMP });
    play(big, [{ opacity: 1 }, { opacity: 0 }], { duration: 400, delay: STAMP + HOLD, fill: 'forwards' });
    return done().then(r => { if (!r.cancelled) stop(); return r; });
  }

  // 手指一碰就收掉正在演的岩點貓（浮出來的掃描不算，那是結果本身）
  for (const ev of ['pointerdown', 'keydown', 'wheel']) addEventListener(ev, () => { if (layer) stop(); }, { capture: true, passive: true });
  for (const ev of ['pagehide', 'popstate']) addEventListener(ev, stop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  return { reveal, wake, celebrate, stop, active: () => !!layer, CAST, castAt };
})();
globalThis.HoldCat = HoldCat;
