// AppKit shareImage：分享用的風格圖片（限時動態 9:16、貼文 4:5；滿版、卡片），岩點貓、紅點貓共用同一套版面。
// 兩款 App 各自畫好「照片＋路線」的底圖（岩點貓是岩點外框，紅點貓是 Topo 的線與編號牌），這裡只管版面：
// 照片以路線為中心裁切、上面難度＋名稱、右下署名和 logo；路線放不進滿版就自動用卡片。
//
// 用法：
//   const { blob, name } = await AppKit.shareImage.make({ size: { w, h }, base: () => canvas, focus: [{ x0, y0, x1, y1 }], grade, name, by, fmt: 'story', logo: AppKit.shareImage.symbolLogo(symbolEl), lang });
//   size：底圖的像素大小；base：底圖（畫布或回傳畫布的函式，字型載好才呼叫）；focus：路線佔的範圍（底圖像素，一個岩點或一段線一個框，空陣列＝整張）；
//   logo：(邊長) → 畫布；current：() → false 就放棄（過時的工作不配置大畫布）。
//   AppKit.shareImage.loadFonts('full', text, cap)、capFont(lang)：字型（膠帶短句用）。
// English: Shared share-image layout for both apps (story 9:16, post 4:5; full-bleed or card). Callers draw the photo+route base; this lays it out.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else (root.AppKit || (root.AppKit = {})).shareImage = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const FALLBACK = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang TC", "Noto Sans TC", "Segoe UI", sans-serif';
  const STYLES = {
    full: { grade: ['italic 800', 'Barlow Condensed'], name: ['900', 'Noto Sans TC'], by: ['700', 'Noto Sans TC'], ink: '#fff' },
    card: { grade: ['800', 'Outfit'], name: ['900', 'Noto Sans TC'], by: ['700', 'Noto Sans TC'], ink: '#fff' },
  };
  // 字型從 Google Fonts 載入：CSS 裡的字型名稱改成「cb …」，不影響介面的字型；中文字型切成很多片，只下載用到的字。沒網路就用系統字型
  const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@1,800&family=Outfit:wght@800&family=Noto+Sans+TC:wght@700;900&family=Huninn&family=Permanent+Marker&display=block';
  const font = ([spec, fam], px) => `${spec} ${px}px "cb ${fam}", ${FALLBACK}`;
  // 難度的大字：段級是漢字（窄體斜字沒有），改用粗的黑體、小一點
  const gradeFont = (st, g, px) => /[^\x00-\x7f]/.test(g) ? `900 ${Math.round(px * 0.8)}px "Climbio Dan", ${FALLBACK}` : font(st.grade, px);
  // 短句的字型：中文、日文用 jf open 粉圓（Huninn，圓潤、有假名），英文用 Permanent Marker（麥克筆寫在牆上的感覺）
  const capFont = (lang) => ['en', 'fr', 'es', 'de'].includes(lang) ? ['400', 'Permanent Marker'] : ['400', 'Huninn'];
  let fontCss = null;
  async function loadFonts(styleName, text, cap = '', lang = 'zh') {
    const st = STYLES[styleName];
    fontCss = fontCss || fetch(FONT_CSS).then(res => res.ok ? res.text() : Promise.reject(new Error(res.status))).then(css => {
      const s = document.createElement('style'); s.textContent = css.replace(/font-family: '([^']+)'/g, "font-family: 'cb $1'"); document.head.append(s);
    }).catch(() => { fontCss = null; });
    await Promise.race([fontCss.then(() => Promise.all([...['grade', 'name', 'by'].map(k => document.fonts.load(font(st[k], 40), text).catch(() => {})),
      cap && document.fonts.load(font(capFont(lang), 40), cap).catch(() => {}), document.fonts.load('900 40px "Climbio Dan"', text).catch(() => {})])), new Promise(r => setTimeout(r, 5000))]);
  }

  // ---------- logo：各 App 用自己的貓 ----------
  // 品牌 SVG（<symbol>，tools/brand-icons.mjs 從 design/brand/ 產生）直接畫到畫布：路徑與矩陣照 SVG，Canvas、介面與 PWA 共用同一設計來源
  function drawBrand(g, symbol) {
    function paint(el, stroke = false) {
      if (el.tagName === 'defs') return;
      g.save();
      const matrix = el.transform?.baseVal.consolidate()?.matrix;
      if (matrix) g.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
      if (el.hasAttribute('fill')) g.fillStyle = el.getAttribute('fill');
      if (el.hasAttribute('stroke')) { stroke = el.getAttribute('stroke') !== 'none'; g.strokeStyle = el.getAttribute('stroke'); }
      if (el.hasAttribute('stroke-width')) g.lineWidth = +el.getAttribute('stroke-width');
      if (el.hasAttribute('stroke-linejoin')) g.lineJoin = el.getAttribute('stroke-linejoin');
      const clip = el.getAttribute('clip-path');
      if (clip) {
        const path = document.getElementById(clip.slice(5, -1)).querySelector('path');
        g.clip(new Path2D(path.getAttribute('d')), path.getAttribute('clip-rule') || 'nonzero');
      }
      if (el.tagName === 'path') {
        const path = new Path2D(el.getAttribute('d'));
        g.fill(path, el.getAttribute('fill-rule') || 'nonzero');
        if (stroke) g.stroke(path);
      } else if (el.tagName === 'ellipse') {
        g.beginPath(); g.ellipse(+el.getAttribute('cx'), +el.getAttribute('cy'), +el.getAttribute('rx'), +el.getAttribute('ry'), 0, 0, Math.PI * 2); g.fill();
      } else for (const child of el.children) paint(child, stroke);
      g.restore();
    }
    g.save(); g.fillStyle = '#000';
    for (const child of symbol.children) paint(child);
    g.restore();
  }
  /** 用頁面裡的 <symbol>（viewBox 1024 見方）做 logo */
  const symbolLogo = (symbol) => (s) => {
    const m = document.createElement('canvas'); m.width = m.height = Math.ceil(s);
    const c = m.getContext('2d'); c.scale(s / 1024, s / 1024); drawBrand(c, symbol);
    return m;
  };
  /** 用已經載好的圖片做 logo */
  const imageLogo = (img) => (s) => {
    const m = document.createElement('canvas'); m.width = m.height = Math.ceil(s);
    m.getContext('2d').drawImage(img, 0, 0, m.width, m.height);
    return m;
  };

  const fitText = (g, text, w) => { if (g.measureText(text).width <= w) return text; let s = text; while (s.length > 1 && g.measureText(s + '…').width > w) s = s.slice(0, -1); return s + '…'; };
  // 署名放右邊，後面接 logo，兩個對齊同一條中線；沒有署名就只放 logo，往上靠近照片（不然一顆 logo 浮在下面）。xr＝右緣，y＝署名的基線
  function sign(g, st, logo, by, xr, y, size, maxW) {
    const ls = size * 1.5, mid = y - size * (by ? 0.36 : 0.85), xt = xr - ls - size * 0.2;
    g.textAlign = 'right'; g.textBaseline = 'alphabetic'; g.fillStyle = st.ink;
    if (by) { g.font = font(st.by, size); g.fillText(fitText(g, by, maxW - ls), xt, y); }
    if (logo) g.drawImage(logo(ls), xr - ls, mid - ls / 2);
  }

  // ---------- 取景 ----------
  const W = 1080;
  // 滿版：上下留給文字的範圍；路線放得下嗎（照片放大到路線剛好塞進去，照片高度要填滿上下留字之間的範圍，不然只剩中間一條）。放不下就只能用卡片
  const fullBand = (fmt) => fmt === 'post' ? { H: 1350, T: 220, B: 110 } : { H: 1920, T: 360, B: 300 };
  const union = (boxes) => boxes.reduce((a, c) => ({ x0: Math.min(a.x0, c.x0), y0: Math.min(a.y0, c.y0), x1: Math.max(a.x1, c.x1), y1: Math.max(a.y1, c.y1) }));
  // 路線的範圍（含標籤的空間）往外加一圈，盡量延伸成 aspect（寬／高）的比例，不超出照片（PW×PH）
  // （跟 routekit 的 cropAround 同一個算法，只是吃外框而不是岩點：Kit 不能依賴 AppKit）
  function cropAround(boxes, PW, PH, aspect) {
    if (!boxes.length) return { x: 0, y: 0, w: PW, h: PH };
    const b = union(boxes), pad = Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.18 + Math.max(PW, PH) * 0.04;
    let w = Math.min(PW, b.x1 - b.x0 + 2 * pad), h = Math.min(PH, b.y1 - b.y0 + 2 * pad);
    if (w / h < aspect) w = Math.min(PW, h * aspect); else h = Math.min(PH, w / aspect);
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    return { x: Math.max(0, Math.min(PW - w, cx - w / 2)), y: Math.max(0, Math.min(PH - h, cy - h / 2)), w, h };
  }
  // 等比例放大蓋滿整張的取景：以路線（外加標籤的留白）的中心為中心，一定把路線整個框進來；框不進來（路線比畫面大）回傳 null
  function coverBox(boxes, Wc, Hc, PW, PH) {
    const sc = Math.max(Wc / PW, Hc / PH), w = Wc / sc, h = Hc / sc, m = 64 / sc;
    if (!boxes.length) return { sc, x: (PW - w) / 2, y: (PH - h) / 2, w, h };
    const b = union(boxes);
    if (b.x1 - b.x0 + 2 * m > w || b.y1 - b.y0 + 2 * m > h) return null;
    const place = (c0, c1, len, PL) => Math.min(PL - len, Math.max(0, c1 + m - len, Math.min(c0 - m, (c0 + c1) / 2 - len / 2)));   // 路線在框內留 m 的邊；貼著照片邊緣時只能不出照片
    return { sc, x: place(b.x0, b.x1, w, PW), y: place(b.y0, b.y1, h, PH), w, h };
  }
  function fullFits(focus, fmt, PW, PH) {
    const { H, T, B } = fullBand(fmt), b = cropAround(focus, PW, PH, W / (H - T - B)), s = Math.min(W / b.w, (H - T - B) / b.h);
    return PH * s >= (H - T - B) * 0.95 && !!coverBox(focus, W, H, PW, PH);
  }
  const autoStyle = (focus, fmt, PW, PH) => fullFits(focus, fmt, PW, PH) ? 'full' : 'card';

  // 模糊的底：照片鋪滿 W×H 後一半一半縮到 1/32，再一倍一倍放大回來（每一步都平滑，才不會有馬賽克）。
  // iPhone、iPad 的 Safari 畫布不支援 filter，不能用 blur()
  function softCover(src, Wc, Hc) {
    const make = (w, h, from) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
      const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(from, 0, 0, c.width, c.height); return x.canvas; };
    const cover = Math.max(Wc / src.width, Hc / src.height), base = document.createElement('canvas'); base.width = Wc; base.height = Hc;
    base.getContext('2d').drawImage(src, (Wc - src.width * cover) / 2, (Hc - src.height * cover) / 2, src.width * cover, src.height * cover);
    let c = base;
    while (c.width > Wc / 32) c = make(c.width / 2, c.height / 2, c);
    while (c.width < Wc / 2) c = make(c.width * 2, c.height * 2, c);
    return make(Wc, Hc, c);
  }

  // ---------- 版面 ----------
  // 照片以路線為中心裁切（路線都在畫面內），上面難度＋名稱，下面右邊署名和小 logo；限時動態下方留空給 IG 的連結貼紙。
  function socialImage(src, { focus, grade, name, by, logo, fmt, st }) {
    const story = fmt === 'story', H = story ? 1920 : 1350, M = 64;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'), style = STYLES[st];
    const { T, B } = fullBand(fmt);   // 滿版：上下留給文字的範圍
    if (st === 'full') { g.fillStyle = '#0e0e0f'; g.fillRect(0, 0, W, H); }   // 滿版：照片蓋不到的地方是深色底（不用模糊的同一張照片，岩點才不會出現兩次）
    else {   // 卡片：照片模糊放大當底，再蓋一層黑讓字看得清楚
      g.drawImage(softCover(src, W, H), 0, 0);
      g.fillStyle = 'rgba(0,0,0,0.58)'; g.fillRect(0, 0, W, H);
    }
    g.shadowColor = 'rgba(0,0,0,0.4)'; g.shadowBlur = 24;
    if (st === 'full') {
      // 滿版：路線放在上下留給文字的範圍之間（字壓在漸層上，可以跟照片重疊一些），照片往外延伸鋪滿；照片不夠的地方淡出到深色底
      const b = cropAround(focus, src.width, src.height, W / (H - T - B));
      const s = Math.min(W / b.w, (H - T - B) / b.h), dx = (W - b.w * s) / 2, dy = T + (H - T - B - b.h * s) / 2;
      // 照片不夠蓋到邊：往回推（路線可以移進上下留字的範圍，但不出畫面），推不夠的才露出底
      const shift = (v, len, PL, lo, hi) => len >= PL ? v : Math.max(v - lo, Math.min(v + hi, Math.max(0, Math.min(PL - len, v))));
      const box = { x: b.x - dx / s, y: b.y - dy / s, w: W / s, h: H / s };
      box.x = shift(box.x, box.w, src.width, dx / s, dx / s);
      box.y = shift(box.y, box.h, src.height, Math.max(0, H - 60 - dy - b.h * s) / s, Math.max(0, dy - T * 0.6) / s);
      // 照片的邊在畫面裡面：邊緣淡出到底，不留硬邊
      const ph = document.createElement('canvas'); ph.width = W; ph.height = H;
      const q = ph.getContext('2d'), F = 160;
      const cover = coverBox(focus, W, H, src.width, src.height), sc = cover.sc;   // 等比例放大蓋滿整張，路線整個在畫面內（不出照片）
      q.drawImage(src, cover.x, cover.y, cover.w, cover.h, 0, 0, W, H);   // 淡出線仍畫在照片剛好塞進路線時的邊緣，形成井字形的暗線
      q.globalCompositeOperation = 'destination-out';
      const fade = (x0, y0, x1, y1) => { const l = q.createLinearGradient(x0, y0, x1, y1); l.addColorStop(0, 'rgba(0,0,0,0)'); l.addColorStop(1, '#000'); q.fillStyle = l; q.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0) || W, Math.abs(y1 - y0) || H); };
      const L0 = -box.x * s, R0 = (src.width - box.x) * s, T0 = -box.y * s, B0 = (src.height - box.y) * s;
      if (T0 > 0) fade(0, T0 + F, 0, T0);
      if (B0 < H) fade(0, B0 - F, 0, B0);
      if (L0 > 0) fade(L0 + F, 0, L0, 0);
      if (R0 < W) fade(R0 - F, 0, R0, 0);
      g.save(); g.shadowColor = 'transparent'; g.drawImage(ph, 0, 0);
      // 路線（含起攀、完攀標籤）壓在暗線上面：把這一小塊沒被壓暗的照片柔邊貼回去
      const keep = document.createElement('canvas'); keep.width = W; keep.height = H;
      const kg = keep.getContext('2d');
      for (const bb of focus) {
        const R = (Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) * 0.8 + 30) * sc, cx = ((bb.x0 + bb.x1) / 2 - cover.x) * sc, cy = ((bb.y0 + bb.y1) / 2 - cover.y) * sc;
        const l = kg.createRadialGradient(cx, cy, R * 0.55, cx, cy, R); l.addColorStop(0, '#000'); l.addColorStop(1, 'rgba(0,0,0,0)');
        kg.fillStyle = l; kg.fillRect(cx - R, cy - R, 2 * R, 2 * R);
      }
      kg.globalCompositeOperation = 'source-in'; kg.drawImage(src, cover.x, cover.y, cover.w, cover.h, 0, 0, W, H);
      g.drawImage(keep, 0, 0);
      const shade = (y0, y1, a0, a1) => { const l = g.createLinearGradient(0, y0, 0, y1); l.addColorStop(0, `rgba(0,0,0,${a0})`); l.addColorStop(1, `rgba(0,0,0,${a1})`); g.fillStyle = l; g.fillRect(0, y0, W, y1 - y0); };
      shade(0, T + 120, 0.6, 0); shade(H - B - 200, H, 0, 0.6);
      g.restore();
      const gs = story ? 220 : 180, gy = (story ? 230 : 60) + gs * 0.74;
      g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = style.ink;
      g.font = gradeFont(style, grade, gs); g.fillText(grade, M - 6, gy);
      if (name) { g.font = font(style.name, 60); g.fillText(fitText(g, name, W - 2 * M), M, gy + 96); }
      sign(g, style, logo, by, W - M, H - (story ? 330 : 76), 44, W - 2 * M);
      return c;
    }
    // 卡片：照片放在中間的框裡
    const top = story ? 300 : 190, bottom = story ? 1600 : 1230, rad = 28;   // 框的上下範圍：直式照片才不會被高度卡住、左右留一大片
    const box = cropAround(focus, src.width, src.height, (W - 2 * M) / (bottom - top));
    const k = Math.min((W - 2 * M) / box.w, (bottom - top) / box.h), iw = box.w * k, ih = box.h * k;
    const ix = (W - iw) / 2, iy = top + (bottom - top - ih) / 2;
    const frame = () => { g.beginPath(); g.roundRect ? g.roundRect(ix, iy, iw, ih, rad) : g.rect(ix, iy, iw, ih); };
    g.save(); g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = 40; g.shadowOffsetY = 0; frame(); g.fill(); g.restore();
    g.save(); g.shadowColor = 'transparent'; frame(); g.clip(); g.drawImage(src, box.x, box.y, box.w, box.h, ix, iy, iw, ih); g.restore();
    g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = style.ink;
    const gy = iy - 40;
    g.font = gradeFont(style, grade, 132); g.fillText(grade, M, gy);
    const gw = g.measureText(grade).width;
    if (name) { g.font = font(style.name, 48); g.fillText(fitText(g, name, W - 2 * M - gw - 28), M + gw + 28, gy); }
    sign(g, style, logo, by, ix + iw, iy + ih + 84, 40, iw);   // 對齊照片右緣
    return c;
  }

  /**
   * 產一張分享圖。size：底圖像素大小；base：底圖（畫布或函式）；focus：路線的範圍（底圖像素的框）；
   * 回傳 { blob, name }（JPEG）。過時（current() 為 false）丟 AbortError。
   */
  async function make({ size, base, focus = [], grade = '', name = '', by = '', fmt = 'story', logo, lang = 'zh', quality, current = () => true }) {
    const st = autoStyle(focus, fmt, size.w, size.h);
    await api.loadFonts(st, grade + name + by + '…', '', lang);
    // 等字型時可能已換路線或選項；過時工作不配置大畫布，也不再繪製。
    if (!current()) throw new DOMException('預覽已更新', 'AbortError');
    const src = typeof base === 'function' ? base() : base;
    const c = socialImage(src, { focus, grade, name, by, logo, fmt, st });
    const q = quality ?? (root.AppKit && root.AppKit.photo ? root.AppKit.photo.QUALITY.full : 0.92);
    const label = [grade, (name || 'route').replace(/[\\/:*?"<>|]/g, '')].filter(Boolean).join('_');
    return new Promise(res => c.toBlob(b => res({ blob: b, name: `${label}.jpg` }), 'image/jpeg', q));
  }

  const api = { make, loadFonts, capFont, symbolLogo, imageLogo, STYLES };   // make 經由 api 呼叫 loadFonts，測試可以換掉字型等待
  return api;
});
