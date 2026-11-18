// Climbio 輸出：分享的路線圖（限時動態、貼文；滿版、卡片）。
// 依序載入（app → home → profile → add-wall → edit → wall → sync → draw → export → mobile → tour → main），共用同一個全域範圍；載入當下只能用到前面檔案宣告的東西。
// English: Export: shareable route images (Climbio layout).
'use strict';
  // ---------- 輸出 ----------
  const EXPORT_FONT = RouteKit.THEME.font;
  // 直接繪製確認 SVG 的路徑與矩陣；Canvas、介面與 PWA 共用同一設計來源。
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
        const path = $(clip.slice(5, -1)).querySelector('path');
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
  function logoMark(s) {
    const m = document.createElement('canvas'); m.width = m.height = Math.ceil(s);
    const c = m.getContext('2d'); c.scale(s / 1024, s / 1024); drawBrand(c, $('i-brand-mark'));
    return m;
  }
  // 路線圖的風格（自動選）：full＝滿版（照片鋪滿，上下漸層壓字）、card＝卡片（模糊照片當底，照片圓角放中間）；路線放不進滿版就用卡片
  const STYLES = {
    full: { grade: ['italic 800', 'Barlow Condensed'], name: ['900', 'Noto Sans TC'], by: ['700', 'Noto Sans TC'], ink: '#fff', mark: '#c6ff3d' },
    card: { grade: ['800', 'Outfit'], name: ['900', 'Noto Sans TC'], by: ['700', 'Noto Sans TC'], ink: '#fff', mark: '#c6ff3d' },
  };
  // 字型從 Google Fonts 載入：CSS 裡的字型名稱改成「cb …」，不影響介面的字型；中文字型切成很多片，只下載用到的字。沒網路就用系統字型
  const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@1,800&family=Outfit:wght@800&family=Noto+Sans+TC:wght@700;900&family=Huninn&family=Permanent+Marker&display=block';
  const font = ([spec, fam], px) => `${spec} ${px}px "cb ${fam}", ${EXPORT_FONT}`;
  // 難度的大字：段級是漢字（窄體斜字沒有），改用粗的黑體、小一點
  const gradeFont = (st, g, px) => /[^\x00-\x7f]/.test(g) ? `900 ${Math.round(px * 0.8)}px "Climbio Dan", ${EXPORT_FONT}` : font(st.grade, px);
  let fontCss = null;
  // 短句的字型：中文、日文用 jf open 粉圓（Huninn，圓潤、有假名），英文用 Permanent Marker（麥克筆寫在牆上的感覺）
  const capFont = () => ['en', 'fr', 'es', 'de'].includes(lang) ? ['400', 'Permanent Marker'] : ['400', 'Huninn'];
  async function loadFonts(st, text, cap = '') {
    fontCss = fontCss || fetch(FONT_CSS).then(res => res.ok ? res.text() : Promise.reject(new Error(res.status))).then(css => {
      const s = document.createElement('style'); s.textContent = css.replace(/font-family: '([^']+)'/g, "font-family: 'cb $1'"); document.head.append(s);
    }).catch(() => { fontCss = null; });
    await Promise.race([fontCss.then(() => Promise.all([...['grade', 'name', 'by'].map(k => document.fonts.load(font(st[k], 40), text).catch(() => {})),
      cap && document.fonts.load(font(capFont(), 40), cap).catch(() => {}), document.fonts.load('900 40px "Climbio Dan"', text).catch(() => {})])), pause(5000)]);
  }
  // 橫式 Logo 沿用設計原稿的字形與組合
  function drawWordmark(g, st, x, y, px) {
    g.save(); g.translate(x, y - px * .9); g.scale(px * .9 / 280, px * .9 / 280);
    drawBrand(g, $('i-wordmark')); g.restore();
  }
  const fitText = (g, text, w) => { if (g.measureText(text).width <= w) return text; let s = text; while (s.length > 1 && g.measureText(s + '…').width > w) s = s.slice(0, -1); return s + '…'; };
  // 署名放右邊，後面接 logo，兩個對齊同一條中線；沒有署名就只放 logo，往上靠近照片（不然一顆 logo 浮在下面）。xr＝右緣，y＝署名的基線
  function sign(g, st, by, xr, y, size, maxW) {
    const ls = size * 1.5, mid = y - size * (by ? 0.36 : 0.85), xt = xr - ls - size * 0.2;
    g.textAlign = 'right'; g.textBaseline = 'alphabetic'; g.fillStyle = st.ink;
    if (by) { g.font = font(st.by, size); g.fillText(fitText(g, by, maxW - ls), xt, y); }
    g.drawImage(logoMark(ls), xr - ls, mid - ls / 2);
  }
  // 路線圖：fmt＝'story'（IG 限時動態 9:16）、'post'（貼文 4:5）
  async function routeImage(fmt, { current = () => true } = {}) {
    const r = route(), st = STYLES[autoStyle(r, fmt)], by = routeAuthor(r);
    await loadFonts(st, r.grade + (r.name || '') + by + '…');
    // 等字型時可能已換路線或選項；過時工作不配置大畫布，也不再繪製。
    if (!current()) throw new DOMException('預覽已更新', 'AbortError');
    const out = routeBaseCanvas(r);
    const name = `${r.grade}_${(r.name || 'route').replace(/[\\/:*?"<>|]/g, '')}.jpg`;
    const c = socialImage(out, r, fmt, st);
    return new Promise(res => c.toBlob(b => res({ blob: b, name }), 'image/jpeg', AppKit.photo.QUALITY.full));
  }
  // 原尺寸的路線圖（底圖、路線岩點、標籤）只跟路線有關：換尺寸直接沿用，不再重畫整張（低階手機要將近一秒）。
  // 只留目前這一張（照片大小的畫布很佔記憶體），關掉分享畫面就放掉
  // 3D 牆：分享圖畫的是正面快照，用正面外框（W3D.frontHolds）；還沒有正面外框就退回目前的外框
  const exportHolds = (r) => { const f = state.wall.m3d && W3D.frontHolds(state.wall); return f ? RouteKit.routeHolds({ holds: r.holds }, f) : holdsOf(r); };
  let routeBase = null;
  function routeBaseCanvas(r) {
    const key = JSON.stringify([state.scene.version, state.wall.holds.length, r.holds, r.seq, exportHolds(r).map(h => h.poly)]);
    if (routeBase && routeBase.key === key && routeBase.img === state.img) return routeBase.canvas;
    const c = RouteKit.renderRouteImage(state.scene, r, exportHolds(r));
    routeBase = { key, img: state.img, canvas: c };
    return c;
  }
  // 模糊的底：照片鋪滿 W×H 後一半一半縮到 1/32，再一倍一倍放大回來（每一步都平滑，才不會有馬賽克）。
  // iPhone、iPad 的 Safari 畫布不支援 filter，不能用 blur()
  function softCover(src, W, H) {
    const make = (w, h, from) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
      const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(from, 0, 0, c.width, c.height); return c; };
    const cover = Math.max(W / src.width, H / src.height), base = document.createElement('canvas'); base.width = W; base.height = H;
    base.getContext('2d').drawImage(src, (W - src.width * cover) / 2, (H - src.height * cover) / 2, src.width * cover, src.height * cover);
    let c = base;
    while (c.width > W / 32) c = make(c.width / 2, c.height / 2, c);
    while (c.width < W / 2) c = make(c.width * 2, c.height * 2, c);
    return make(W, H, c);
  }
  // 滿版：上下留給文字的範圍；路線放得下嗎（照片放大到路線剛好塞進去，照片高度要填滿上下留字之間的範圍，不然只剩中間一條）。放不下就只能用卡片
  const fullBand = (fmt) => fmt === 'post' ? { H: 1350, T: 220, B: 110 } : { H: 1920, T: 360, B: 300 };
  // 等比例放大蓋滿整張的取景：以路線岩點（外加標籤的留白）的中心為中心，一定把路線整個框進來；框不進來（路線比畫面大）回傳 null
  function coverBox(r, W, H, PW, PH) {
    const hs = exportHolds(r), sc = Math.max(W / PW, H / PH), w = W / sc, h = H / sc, m = 64 / sc;
    if (!hs.length) return { sc, x: (PW - w) / 2, y: (PH - h) / 2, w, h };
    const b = hs.map(h => bbox(h.poly)).reduce((a, c) => ({ x0: Math.min(a.x0, c.x0), y0: Math.min(a.y0, c.y0), x1: Math.max(a.x1, c.x1), y1: Math.max(a.y1, c.y1) }));
    if (b.x1 - b.x0 + 2 * m > w || b.y1 - b.y0 + 2 * m > h) return null;
    const place = (c0, c1, len, PL) => Math.min(PL - len, Math.max(0, c1 + m - len, Math.min(c0 - m, (c0 + c1) / 2 - len / 2)));   // 路線在框內留 m 的邊；貼著照片邊緣時只能不出照片
    return { sc, x: place(b.x0, b.x1, w, PW), y: place(b.y0, b.y1, h, PH), w, h };
  }
  function fullFits(r, fmt, PW = state.w, PH = state.h) {
    const W = 1080, { H, T, B } = fullBand(fmt), b = RouteKit.cropAround(exportHolds(r), PW, PH, W / (H - T - B)), s = Math.min(W / b.w, (H - T - B) / b.h);
    return PH * s >= (H - T - B) * 0.95 && !!coverBox(r, W, H, PW, PH);
  }
  const autoStyle = (r, fmt) => r && !fullFits(r, fmt) ? 'card' : 'full';
  // 社群尺寸（1080 寬）：照片以路線為中心裁切（岩點都在畫面內），上面難度＋名稱，下面右邊署名和小 logo；限時動態下方留空給 IG 的連結貼紙。
  // photo：照片區要畫什麼（預設是路線圖）；回傳的畫布帶 layout（照片在畫布上的位置、裁切範圍和圓角）
  function socialImage(src, r, fmt, st, { photo = src } = {}) {
    const story = fmt === 'story', W = 1080, H = story ? 1920 : 1350, M = 64, by = routeAuthor(r);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const { T, B } = fullBand(fmt);   // 滿版：上下留給文字的範圍
    if (st === STYLES.full && !fullFits(r, fmt, src.width, src.height)) st = STYLES.card;   // 保險：放不下就用卡片（routeImage 已經先選了）
    if (st === STYLES.full) { g.fillStyle = '#0e0e0f'; g.fillRect(0, 0, W, H); }   // 滿版：照片蓋不到的地方是深色底（不用模糊的同一張照片，岩點才不會出現兩次）
    else {   // 卡片：照片模糊放大當底，再蓋一層黑讓字看得清楚
      g.drawImage(softCover(src, W, H), 0, 0);
      g.fillStyle = `rgba(0,0,0,${st === STYLES.full ? 0.5 : 0.58})`; g.fillRect(0, 0, W, H);
    }
    if (st.ink === '#fff') { g.shadowColor = 'rgba(0,0,0,0.4)'; g.shadowBlur = 24; }
    if (st === STYLES.full) {
      // 滿版：路線放在上下留給文字的範圍之間（字壓在漸層上，可以跟照片重疊一些），照片往外延伸鋪滿；照片不夠的地方淡出到深色底
      const b = RouteKit.cropAround(exportHolds(r), src.width, src.height, W / (H - T - B));
      const s = Math.min(W / b.w, (H - T - B) / b.h), dx = (W - b.w * s) / 2, dy = T + (H - T - B - b.h * s) / 2;
      // 照片不夠蓋到邊：往回推（路線可以移進上下留字的範圍，但不出畫面），推不夠的才露出底
      const shift = (v, len, PL, lo, hi) => len >= PL ? v : Math.max(v - lo, Math.min(v + hi, Math.max(0, Math.min(PL - len, v))));
      const box = { x: b.x - dx / s, y: b.y - dy / s, w: W / s, h: H / s };
      box.x = shift(box.x, box.w, src.width, dx / s, dx / s);
      box.y = shift(box.y, box.h, src.height, Math.max(0, H - 60 - dy - b.h * s) / s, Math.max(0, dy - T * 0.6) / s);
      // 照片的邊在畫面裡面：邊緣淡出到底，不留硬邊
      const ph = document.createElement('canvas'); ph.width = W; ph.height = H;
      const q = ph.getContext('2d'), F = 160, cover = {};
      const cb = coverBox(r, W, H, src.width, src.height), sc = cb.sc, cw = cb.w, ch = cb.h;   // 等比例放大到蓋滿整張，路線整個在畫面內（不出照片）
      cover.w = cw; cover.h = ch; cover.x = cb.x; cover.y = cb.y;
      q.drawImage(photo, cover.x, cover.y, cw, ch, 0, 0, W, H);   // 淡出線仍畫在照片剛好塞進路線時的邊緣，形成井字形的暗線
      q.globalCompositeOperation = 'destination-out';
      const fade = (x0, y0, x1, y1) => { const l = q.createLinearGradient(x0, y0, x1, y1); l.addColorStop(0, 'rgba(0,0,0,0)'); l.addColorStop(1, '#000'); q.fillStyle = l; q.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0) || W, Math.abs(y1 - y0) || H); };
      const L0 = -box.x * s, R0 = (src.width - box.x) * s, T0 = -box.y * s, B0 = (src.height - box.y) * s;
      if (T0 > 0) fade(0, T0 + F, 0, T0);
      if (B0 < H) fade(0, B0 - F, 0, B0);
      if (L0 > 0) fade(L0 + F, 0, L0, 0);
      if (R0 < W) fade(R0 - F, 0, R0, 0);
      g.save(); g.shadowColor = 'transparent'; g.drawImage(ph, 0, 0);
      // 路線的岩點（含起攀、完攀標籤）壓在暗線上面：把這一小塊沒被壓暗的照片柔邊貼回去
      const keep = document.createElement('canvas'); keep.width = W; keep.height = H;
      const kg = keep.getContext('2d');
      for (const h of exportHolds(r)) {
        const bb = bbox(h.poly), R = (Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) * 0.8 + 30) * sc, cx = ((bb.x0 + bb.x1) / 2 - cover.x) * sc, cy = ((bb.y0 + bb.y1) / 2 - cover.y) * sc;
        const l = kg.createRadialGradient(cx, cy, R * 0.55, cx, cy, R); l.addColorStop(0, '#000'); l.addColorStop(1, 'rgba(0,0,0,0)');
        kg.fillStyle = l; kg.fillRect(cx - R, cy - R, 2 * R, 2 * R);
      }
      kg.globalCompositeOperation = 'source-in'; kg.drawImage(photo, cover.x, cover.y, cover.w, cover.h, 0, 0, W, H);
      g.drawImage(keep, 0, 0);
      const shade = (y0, y1, a0, a1) => { const l = g.createLinearGradient(0, y0, 0, y1); l.addColorStop(0, `rgba(0,0,0,${a0})`); l.addColorStop(1, `rgba(0,0,0,${a1})`); g.fillStyle = l; g.fillRect(0, y0, W, y1 - y0); };
      shade(0, T + 120, 0.6, 0); shade(H - B - 200, H, 0, 0.6);
      g.restore();
      c.layout = { box: cover, ix: 0, iy: 0, iw: W, ih: H, rad: 0 };
      const gs = story ? 220 : 180, gy = (story ? 230 : 60) + gs * 0.74;
      g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = st.ink;
      g.font = gradeFont(st, r.grade, gs); g.fillText(r.grade, M - 6, gy);
      if (r.name) { g.font = font(st.name, 60); g.fillText(fitText(g, r.name, W - 2 * M), M, gy + 96); }
      sign(g, st, by, W - M, H - (story ? 330 : 76), 44, W - 2 * M);
      return c;
    }
    // 卡片、雜誌：照片放在中間的框裡
    const top = story ? 300 : 190, bottom = story ? 1600 : 1230, rad = 28;   // 框的上下範圍：直式照片才不會被高度卡住、左右留一大片
    const box = RouteKit.cropAround(exportHolds(r), src.width, src.height, (W - 2 * M) / (bottom - top));
    const k = Math.min((W - 2 * M) / box.w, (bottom - top) / box.h), iw = box.w * k, ih = box.h * k;
    const ix = (W - iw) / 2, iy = top + (bottom - top - ih) / 2;
    const frame = () => { g.beginPath(); g.roundRect ? g.roundRect(ix, iy, iw, ih, rad) : g.rect(ix, iy, iw, ih); };
    g.save(); g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = 40; g.shadowOffsetY = 0; frame(); g.fill(); g.restore();
    g.save(); g.shadowColor = 'transparent'; frame(); g.clip(); g.drawImage(photo, box.x, box.y, box.w, box.h, ix, iy, iw, ih); g.restore();
    c.layout = { box, ix, iy, iw, ih, rad };
    g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = st.ink;
    const gy = iy - 40;
    g.font = gradeFont(st, r.grade, 132); g.fillText(r.grade, M, gy);
    const gw = g.measureText(r.grade).width;
    if (r.name) { g.font = font(st.name, 48); g.fillText(fitText(g, r.name, W - 2 * M - gw - 28), M + gw + 28, gy); }
    sign(g, st, by, ix + iw, iy + ih + 84, 40, iw);   // 對齊照片右緣
    return c;
  }
  // 自己出的路線用共用暱稱；別人的作者資訊保留原樣。
  const routeAuthor = (r) => mineRoute(r) ? signName() : r.author;
  const SIGN_KEY = 'climbio.sign', SIGN_AT = 'climbio.signAt'; // 僅供舊備份格式辨識
  const signName = () => AppKit.nearby.nickname() || '';
  async function askSign() {
    if (!await AppKit.nearby.ensureNickname({ edit: true, suggested: '' })) return false;
    fileCache.clear();
    return true;
  }
  const canShareFiles = () => AppKit.share.canShareFiles();
  // iOS 要求 navigator.share 在點擊當下呼叫，先 await 產圖會被擋（NotAllowedError）。
  // 所以圖片依路線內容快取：內容沒變就直接分享；第一次產圖後被擋，就提示再按一次。
  // 每條路線、每個簽名各留一份（最多 12 份，舊的先丟）：換回來不用重做
  const fileCache = new Map();
  const cacheFile = (key, file) => { fileCache.delete(key); fileCache.set(key, file); while (fileCache.size > 12) fileCache.delete(fileCache.keys().next().value); return file; };
  // 預覽和「圖片」都是限時動態尺寸
  const routeKey = () => { const r = route(); return r ? JSON.stringify([state.wall.id, r.id, r.grade, r.name, r.holds, r.seq, routeAuthor(r)]) : ''; };
  // 被擋（iOS 要求在點擊當下分享）回 false，讓呼叫端提示再按一次；其餘情況（分享、取消、改成下載）都算完成
  const shareFile = async (file) => (await AppKit.share.sendFile(file, { strictGesture: true })) !== 'blocked';
  // 路線的分享鈕：分享畫面（登入了連結帶路線；沒登入只分享路線圖，連結是 App 首頁）
  $('shareBtn').onclick = () => { $('edMenu').hidden = true; shareRoute(); };
  const shareRoute = () => {
    if (!state.wall || !route()) return;
    openShare({ kind: 'wall', id: state.wall.id, route: route().id });
  };
  // 同一內容共用進行中的產圖；過時的工作不排隊。
  const preparingFiles = new Map();
  function prepareRouteFile() {
    const key = routeKey();
    if (fileCache.has(key)) return Promise.resolve(fileCache.get(key));
    if (preparingFiles.has(key)) return preparingFiles.get(key);
    const wall = state.wall;
    const current = () => !!shareCtx && state.wall === wall && routeKey() === key;   // 關掉分享畫面就不畫了
    const job = makeRouteFile(key, current).finally(() => preparingFiles.delete(key));
    preparingFiles.set(key, job);
    return job;
  }
  async function makeRouteFile(key, current) {
    // 產圖途中切到背景：iOS 可能清掉畫布，做出來的可能是黑圖，不留（回來再做）
    let hid = document.hidden;
    const onHide = () => { if (document.hidden) hid = true; };
    document.addEventListener('visibilitychange', onHide);
    const x = await routeImage('story', { current }).finally(() => document.removeEventListener('visibilitychange', onHide));
    if (!current() || hid) throw new DOMException('預覽已更新', 'AbortError');
    return cacheFile(key, new File([x.blob], x.name, { type: x.blob.type }));
  }
  // 圖片：只在本機產圖，不上傳、不附連結
  async function shareRouteImage() {
    const key = routeKey(), ctx = shareCtx;
    try {
      const file = fileCache.get(key) || await prepareRouteFile();
      if (shareCtx === ctx && routeKey() === key) sendFile(file);
    } catch (e) {
      if (shareCtx === ctx && routeKey() === key && e.name !== 'AbortError') shStatus(e.message || String(e));
    }
  }
  // 分享路線時附帶的一句：自己出的是挑戰邀請，別人的是揪人一起爬
  const inviteLine = (r) => t(mineRoute(r) ? 'inviteMine' : 'inviteOther', r.grade, r.name || '');
  async function sendFile(file) {
    // 不等待別的非同步工作，保留 iPhone 分享所需的點擊授權
    if (!canShareFiles()) return AppKit.share.download(file, file.name, 1000);   // 不能分享檔案的瀏覽器（部分電腦）：改成下載
    if (!(await shareFile(file))) toast(t('shareReady'));
  }
