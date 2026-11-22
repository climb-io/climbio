// 照片處理、對話框、個人攀爬紀錄、手感特效、個人資料。
// 依序載入（app → home → profile → add-wall → edit → wall → sync → draw → export → mobile → tour → main），共用同一個全域範圍；載入當下只能用到前面檔案宣告的東西，
// 事件處理、計時器等之後才執行的程式不受限制。啟動與事件綁定放在最後的 main.js。
// English: Photo processing, dialogs, climbing log, haptic effects, profile.
'use strict';
  // ---------- 照片 ----------
  const blobToCanvas = (blob) => AppKit.photo.toCanvas(blob, MAX_SIDE);
  // 首頁卡片用的縮圖（只存在這台，不上傳、不同步）：卡片是 4:3、手機螢幕 3 倍，
  // 原本長邊 480 的 w.thumb 放大後很糊，所以另外從本機原圖裁 4:3、960×720
  const THUMB_HI = [960, 720];
  function hiThumb(src, sw, sh) {
    const [W, H] = THUMB_HI, k = Math.max(W / sw, H / sh), cw = W / k, ch = H / k;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
    g.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, W, H);
    // iOS 記憶體吃緊時畫布可能沒畫上去（透明），存成 JPEG 就是全黑：照片不透明，中間是透明的就當沒做好，下次再做
    if (g.getImageData(W >> 1, H >> 1, 1, 1).data[3] === 0) return null;
    return c.toDataURL('image/jpeg', AppKit.photo.QUALITY.thumb);
  }
  // 「傳給朋友」專用 256×256 方形縮圖，與首頁 4:3 縮圖分開保存。
  function nearbyThumb(src, sw, sh) {
    const S = 256, side = Math.min(sw, sh), c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
    g.drawImage(src, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, S, S);
    if (!g.getImageData(S >> 1, S >> 1, 1, 1).data[3]) { c.width = c.height = 0; return null; }
    const url = c.toDataURL('image/jpeg', AppKit.photo.QUALITY.thumb);
    c.width = c.height = 0;
    return url;
  }
  // 做好的縮圖記這個（照片換過就重做）
  const hiKey = (blob) => `v2:${blob.size}`;
  // 沒有高解析縮圖（或照片換過，用照片檔大小判斷）就在背景一面一面補做，做好直接換掉畫面上的圖
  let hiBusy = false;
  async function fillHiThumbs(walls) {
    if (hiBusy) return; hiBusy = true;
    try {
      for (const w of walls) {
        const blob = await getImage(w.id).catch(() => null);
        if (!blob || (w.thumbHi && w.thumbHiKey === hiKey(blob) && w.nearbyThumb && w.nearbyThumbKey === hiKey(blob))) continue;
        // 先整張畫到畫布（跟打開牆面同一條路）再裁：iPad 直接從 ImageBitmap 裁一塊畫，每次都是空白
        let c; try { c = await blobToCanvas(blob); } catch (e) { continue; }
        const url = hiThumb(c, c.width, c.height), nearby = nearbyThumb(c, c.width, c.height); c.width = c.height = 0;   // 用完馬上放掉：iOS 畫布記憶體很少
        if (!url && !nearby && !w.thumbHi && !w.nearbyThumb) continue;
        // 做不出來：拿掉舊的（可能是全黑的），先用小縮圖，下次再做
        const x = await patchWall(w.id, (r) => { if (url) { r.thumbHi = url; r.thumbHiKey = hiKey(blob); } else delete r.thumbHi; if (nearby) { r.nearbyThumb = nearby; r.nearbyThumbKey = hiKey(blob); } else delete r.nearbyThumb; }).catch(() => null);
        if (!x) continue;
        for (const img of document.querySelectorAll(`img[data-wid="${w.id}"]`)) img.src = url || x.thumb;
        await AppKit.timing.wait(30);   // 讓畫面有空檔，不要一次卡住
      }
    } finally { hiBusy = false; }
  }
  // 牆面資料裡的縮圖（長邊 480，只存在這台）和首頁卡片的高解析縮圖
  function wallThumbs(c) {
    const tc = document.createElement('canvas'), s = 480 / Math.max(c.width, c.height);
    tc.width = Math.round(c.width * s); tc.height = Math.round(c.height * s);
    tc.getContext('2d').drawImage(c, 0, 0, tc.width, tc.height);
    const result = { thumb: tc.toDataURL('image/jpeg', AppKit.photo.QUALITY.tiny), thumbHi: hiThumb(c, c.width, c.height), nearbyThumb: nearbyThumb(c, c.width, c.height) };
    tc.width = tc.height = 0;
    return result;
  }
  // 預設牆名：有岩館叫「岩館名」，同名已有就加流水號（岩館名 2）；沒有岩館叫「牆面 N」。取最小的沒被用掉的號碼
  const wallNameAt = (gym, k) => gym ? (k > 1 ? `${gym} ${k}` : gym) : t('defaultWall', k);
  function uniqueWallName(gym, taken) {
    let k = 1;
    while (taken.includes(wallNameAt(gym, k))) k++;
    return wallNameAt(gym, k);
  }
  const takenWallNames = async (except) => (await listWalls().catch(() => [])).filter(w => w.id !== except).map(w => w.name);
  // 牆名還是沒改過的預設（沒有岩館的「牆面 N」）
  const isDefaultWallName = (name, taken) => Array.from({ length: taken.length + 1 }, (_, i) => t('defaultWall', i + 1)).includes(name);
  function newWallRecord(c, gym, pid = newPid(), name = uniqueWallName(gym, [])) {   // 牆的 id 就是照片編號：同一張照片在哪台、誰手上都是同一面牆
    return {
      id: pid, pid, name, gym: gym || '',
      createdAt: Date.now(), updatedAt: Date.now(), w: c.width, h: c.height,
      ...wallThumbs(c), holds: [], routes: [], nextId: 1,
    };
  }
  // 收到的牆面資料：只取認得的欄位，對方檔案裡多塞的東西不存
  function cleanWall(inc) {
    if (!inc || typeof inc.id !== 'string' || (inc.holds != null && !Array.isArray(inc.holds)) || !Array.isArray(inc.routes)) throw new Error('bad wall file');
    const { id, name, gym, createdAt, w: W, h: H, thumb, holds, routes, pv, pub, grp } = inc;
    return { id, name: String(name || ''), gym: String(gym || '').slice(0, 30), createdAt, w: W, h: H, thumb: /^data:image\//.test(thumb || '') ? thumb : '', holds: holds || undefined, pv: Number.isFinite(pv) ? pv : 0, pub: pub ? 1 : 0,
      routes: routes.map(r => ({ ...r, shapes: cleanShapes(r) })), ...(cleanGrp(grp) ? { grp: cleanGrp(grp) } : {}) };
  }
  // 同一面牆的幾張照片：{ id, ids: [照片編號…]（照左右排）, links: [{ a, b, H?, dx, dy }] }；格式不對就當沒有
  function cleanGrp(g) {
    if (!g || typeof g.id !== 'string' || !Array.isArray(g.ids) || g.ids.length < 2 || !g.ids.every(x => typeof x === 'string')) return null;
    const ids = new Set(g.ids), num = v => Number.isFinite(v) ? v : 0;
    const links = (Array.isArray(g.links) ? g.links : []).filter(l => l && ids.has(l.a) && ids.has(l.b))
      .map(l => ({ a: l.a, b: l.b, ...(Array.isArray(l.H) && l.H.length === 9 && l.H.every(Number.isFinite) ? { H: l.H } : {}), dx: num(l.dx), dy: num(l.dy) }));
    return { id: g.id, axis: g.axis === 'v' ? 'v' : 'h', ids: [...g.ids], links };
  }
  // 路線自帶的外框：只留路線用到、格式對的
  const SOURCES = ['detect', 'edited', 'manual'];
  function cleanShapes(r) {
    const out = {};
    for (const [id, x] of Object.entries((r && r.shapes) || {})) {
      if (!r.holds || !r.holds[id] || !x || !Array.isArray(x.poly) || x.poly.length < 3 || !x.poly.every(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))) continue;
      out[id] = { id, poly: x.poly.map(p => [p[0], p[1]]), source: SOURCES.includes(x.source) ? x.source : 'manual' };
    }
    return out;
  }
  // 正在看的牆被同步更新後重畫；選取中的岩點如果被換掉或刪掉就取消選取
  function refreshOpenWall() {
    const w = state.wall; if (!w) return;
    const holds = new Set(w.holds);
    for (const k of ['selected', 'current', 'hover']) if (state[k] && !holds.has(state[k])) state[k] = null;
    if (document.activeElement !== $('wallName')) $('wallName').value = w.name;
    if (!$('editor').hidden) { if (state.mode === 'route' && !route() && w.routes.length) state.routeId = sortedRoutes()[0].id; refreshUi(); render(); }
    else renderOverview();
  }

  // 對話框（AppKit.ui，App 自己的樣子）：輸入文字 askText 回傳文字（取消 null）、確認 askConfirm 回傳 true／false（danger＝紅色按鈕；
  // title：粗體標題，message 每一行是一條清單）、提示 showAlert 只有一個「確定」。接上返回紀錄：返回鍵先關對話框
  AppKit.ui.configure({ backStack: { open: openOverlay, close: closeOverlay } });
  const { prompt: askText, confirm: askConfirm, alert: showAlert } = AppKit.ui;

  // ---------- 個人攀爬紀錄 ----------
  // 完攀記在路線上（r.sent = 1，跟著牆存在這台，由手動備份保存與復原），只有完攀、沒完攀兩種，用來過濾爬過／還沒爬。
  // 統計 climbio.stats = { 難度: 完攀條數 }：完攀＋1、取消－1，刪牆、公開牆下架都不動它；只是參考的數字，大小固定
  const STATS_KEY = 'climbio.stats';
  let stats = lsGet(STATS_KEY, {});
  const isSent = (r) => !!(r && r.sent);
  let sentBusy = false;
  // 按一下完攀、再按一下取消（沒有次數，不會重複記）
  async function toggleSent(r = route(), w = state.wall) {
    if (!r || !w || sentBusy) return;
    const on = !isSent(r), g = r.grade || '?', n = stats[g] || 0;
    const set = (sent, count) => { if (sent) r.sent = 1; else delete r.sent; if (count > 0) stats[g] = count; else delete stats[g]; };
    set(on, n + (on ? 1 : -1));
    if (!lsSet(STATS_KEY, stats)) { set(!on, n); toast(t('saveFailed')); return; }
    HoldCat.stop(); renderLog();
    stampFab(on);
    if (on) celebrate(r, w);
    sentBusy = true;
    try { await putWall(w); if (r.xfer) await writeBackXfer(w); }
    catch (e) { set(!on, n); lsSet(STATS_KEY, stats); renderLog(); toast(t('saveFailed')); }
    finally { sentBusy = false; }
  }

  // ---------- 手感：點岩點的波紋、記錄完攀的特效（Android 加短震動；系統設定減少動態時不放特效）----------
  const calm = AppKit.ui.reducedMotion;
  const buzz = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { /* 不支援就算了 */ } };
  // 點岩點：在點的位置擴散一圈這個類型的顏色（拿掉時是灰色）
  function tapFx(x, y, type) {
    buzz(type ? 8 : 4);
    if (calm()) return;
    const d = document.createElement('i'); d.className = 'tap-ripple';
    d.style.cssText = `left:${x}px;top:${y}px;--c:${TYPE_COLOR[type] || '#9a9a9f'}`;
    d.onanimationend = () => d.remove();
    document.body.append(d);
  }
  // 完攀鈕像蓋印章：壓下去再彈起來，完攀時往外擴散一圈萊姆綠；取消只輕輕縮一下
  function stampFab(on) {
    const fab = $('vwFab');
    if (calm() || !fab.offsetParent) return;
    fab.animate(on ? [{ transform: 'none' }, { transform: 'scale(.78,.72)', offset: .3 }, { transform: 'scale(1.12)', offset: .62 }, { transform: 'none' }]
      : [{ transform: 'none' }, { transform: 'scale(.9)', offset: .4 }, { transform: 'none' }], { duration: on ? 420 : 260, easing: 'ease-out' });
    if (!on) return;
    const b = fab.getBoundingClientRect(), d = document.createElement('i'); d.className = 'tap-ripple fab-ripple';
    d.style.cssText = `left:${b.left + b.width / 2}px;top:${b.top + b.height / 2}px;--c:var(--accent)`;
    d.onanimationend = () => d.remove();
    document.body.append(d);
  }
  // 完攀後，畫面中間壓下一個大爪印，路線岩點跟著震（js/holdcat.js）
  function celebrate(r, w) {
    buzz(12);
    if (state.wall !== w || state.routeId !== r.id || $('editor').hidden || state.mode !== 'route' || !state.routeView) return;
    const sr = $('stage').getBoundingClientRect(), cr = cv.getBoundingClientRect();
    HoldCat.celebrate({ host: $('stage'), rect: { left: cr.left - sr.left, top: cr.top - sr.top, width: cr.width, height: cr.height }, src: cv, holds: holdsOf(r).map(h => ({ poly: h.poly })), w: state.w });
  }

  // 路線列表上的標示：完攀打勾
  function logMark(r) {
    if (!isSent(r)) return null;
    const m = document.createElement('span'); m.className = 'log-mark'; m.title = t('logSend');
    m.innerHTML = '<svg><use href="#i-paw"/></svg>';
    return m;
  }
  function renderLog() {
    renderLogBtns();
    if (!$('wall').hidden) renderOverview();
  }
  // 只更新按鈕（refreshUi 每次都呼叫，不重畫列表）。看路線圖：名稱旁的小標記；右下的 ✓：按一下完攀，再按一下取消
  function renderLogBtns() {
    const r = route(), on = isSent(r);
    $('vwMark').hidden = !on;
    $('vwFab').setAttribute('aria-pressed', on);
    $('vwFab').setAttribute('aria-label', t(on ? 'logClear' : 'logSend'));
  }
  // ---------- 個人資料：分享貢獻優先，攀爬紀錄收在下方 ----------
  // 自己出的路線：公開牆上讀下來的看伺服器記的帳號（own）；其他的看有沒有出線者（自己出的不帶 author），或記的出線手機是這台（見 sync.js 的 pubRoute）
  const mineRoute = (r) => 'own' in r ? !!r.own : !('author' in r) || (!!r.u && (r.u === deviceId() || lsGet(OLD_DEVICES_KEY, []).includes(r.u)));
  // 我出的線（示範牆除外）：[{ w, r }]，難度高的在前，一樣的新的在前
  const myRoutes = (walls) => walls.filter(w => !localOnly(w)).flatMap(w => w.routes.filter(mineRoute).map(r => ({ w, r })))
    .sort((a, b) => (GRADE_RANK[b.r.grade] ?? -1) - (GRADE_RANK[a.r.grade] ?? -1) || (b.r.t || 0) - (a.r.t || 0));
  // 累計：牆面、路線、定線（這台手機上的，示範牆除外；不連伺服器）
  async function loadTotals() {
    const own = (await listWalls().catch(() => [])).filter(w => !isDemoPid(w.pid));   // 3D 牆也算（只留在這台，但是自己的牆）
    return { walls: own.length, routes: own.reduce((n, w) => n + w.routes.length, 0), set: own.reduce((n, w) => n + w.routes.filter(mineRoute).length, 0) };
  }
  // 看路線圖：右上「⋯」選單裡有編輯路線、分享（js/main.js）；右下的 ✓ 只管記錄（按一下完攀，再按一下取消）
  $('vwFab').onclick = () => toggleSent();
  $('vwEdit').onclick = () => enterRouteEdit();
  $('vwBack').onclick = () => history.back();
  $('vwShare').onclick = () => { HoldCat.stop(); shareRoute(); };
