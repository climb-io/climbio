// RouteKit viewer：給其他 App 直接用的看路線（RouteViewer）和定線（RouteEditor）元件，畫在一個 <canvas> 上。
// 預設只做最基本的：照畫布大小取景、點岩點；要跟岩點貓一樣的縮放、平移（雙指縮放、拖曳、點兩下、滾輪，邊界也一樣）就開 zoom: true（見 viewport.js）；
// 轉場由 App 自己做（App 的畫面也可以直接用同一套繪製函式）。
// English: RouteKit viewer: ready-made RouteViewer and RouteEditor components drawn on a canvas.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./geometry.js'), require('./labels.js'), require('./image.js'), require('./editor.js'), require('./viewport.js'), require('./fit.js'), require('./base.js'));
  else Object.assign(root.RouteKit || (root.RouteKit = {}), factory(root.RouteKit, root.RouteKit, root.RouteKit, root.RouteKit, root.RouteKit, root.RouteKit, root.RouteKit));
})(typeof self !== 'undefined' ? self : this, function (G, L, I, E, VP, F, B) {
  'use strict';
  // 畫布的大小跟著顯示大小（裝置像素），回傳照片座標 → 畫布的轉換；box＝要放進畫布的照片範圍
  function fitCanvas(canvas, box) {
    const dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1;
    const W = Math.max(1, Math.round(canvas.clientWidth * dpr)), H = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const k = Math.min(W / box.w, H / box.h);
    return { k, tx: (W - box.w * k) / 2 - box.x * k, ty: (H - box.h * k) / 2 - box.y * k };
  }
  // 外層（Viewport）給的轉換是螢幕 CSS 像素：換成畫布的裝置像素，畫布大小一樣跟著顯示大小
  function deviceTransform(canvas, t) {
    const dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1;
    const W = Math.max(1, Math.round(canvas.clientWidth * dpr)), H = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    return { k: t.k * dpr, tx: t.tx * dpr, ty: t.ty * dpr };
  }
  const dprOf = () => (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1;
  const baseOf = (m) => (m === 'gray' ? 'gray' : 'dim');   // 路線圖的底：灰階、暗彩（預設）
  // 分段播放在每一段停多久（毫秒）。中間那格是預設；慢一點、快一點各移一格，沒有別的時間選項。
  const SEGMENT_MS = [700, 1100, 1600, 2400, 3600], SEGMENT_SPEED = 2, PAST_ALPHA = 0.4, ANCHOR_ALPHA = 0.66;
  function paintAlpha(g, img, holds, alpha) {
    if (!holds.length) return;
    g.save();
    g.globalAlpha = alpha;
    for (const h of holds) {
      g.save();
      g.beginPath();
      G.tracePoly(g, h.poly);
      g.clip();
      g.drawImage(img, 0, 0);
      g.restore();
    }
    g.restore();
  }
  // 分段播放的一格：這一段原色（光暈、外框照原來的 mode、glow），之前的手點變淡，起攀和完攀全程留著（不在這一段就淡一點）並只給這兩種貼膠帶。
  // 編號只畫這一段裡的出手；同一顆在這一段用了兩次，號碼寫在一起。
  function renderSegment(view) {
    const { canvas, scene, route } = view, frame = I.segmentFrame(route, view.segIndex);
    const byId = new Map(view.routeHolds.map((h) => [h.id, h])), pick = (ids) => (ids || []).map((id) => byId.get(id)).filter(Boolean);
    const current = pick(frame && frame.current), past = pick(frame && frame.past), future = pick(frame && frame.futureAnchors);
    const role = (h) => route.holds[h.id], isAnchor = (h) => role(h) === 's' || role(h) === 't';
    const anchors = view.routeHolds.filter(isAnchor), focus = current.length ? current : view.routeHolds;
    view.t = view.fixed ? deviceTransform(canvas, view.fixed) : fitCanvas(canvas, I.cropAround(focus, scene.w, scene.h, canvas.clientWidth / Math.max(1, canvas.clientHeight)));
    const g = canvas.getContext('2d'), glow = view.glow ? { roles: route.holds, colors: (view.theme || L.THEME).colors, dpr: dprOf() } : undefined;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height);
    g.setTransform(view.t.k, 0, 0, view.t.k, view.t.tx, view.t.ty);
    if (current.length) scene.drawBase(g, current, { mode: view.mode, tint: !view.glow, glow });
    else g.drawImage(scene.plain(baseOf(view.mode)), 0, 0);
    paintAlpha(g, scene.img, past.filter((h) => !isAnchor(h)), PAST_ALPHA);
    paintAlpha(g, scene.img, past.filter(isAnchor).concat(future), ANCHOR_ALPHA);
    if (glow) {
      const k = g.getTransform().a, px = (s) => s * 0.65 / k * (glow.dpr || 1);
      g.lineJoin = 'round';
      for (const h of current) L.strokeRouteHold(g, h.poly, role(h), px, view.theme);
    }
    const unit = view.labelUnit(), labels = anchors.length ? scene.labels(anchors, route, unit, false, view.theme) : [];
    if (anchors.length) L.drawTypeLabels(g, labels, unit, view.theme);
    if (frame) L.drawSeq(g, scene, route, unit, labels, current, view.theme, { from: frame.from, to: frame.to });
  }
  class View {
    // scene：RouteScene；route：路線（holds、seq、shapes）；theme：顏色、字型、S／T 的字；
    // zoom：跟岩點貓一樣的縮放、平移（預設不開）；pads()：[上, 下] 浮在畫布上的工具列蓋住的高度，之後可以多拖那兩段
    // onView(視角｜null)：縮放、平移之後（關掉縮放時是 null）呼叫，給外層顯示目前的放大倍數
    constructor(canvas, { scene, route, theme, glow, zoom, pads, onView, groupRoutes, topInset, segment, onSegment } = {}) {
      Object.assign(this, { canvas, scene, route, theme, glow: !!glow, pads: pads || (() => [0, 0]), onView: onView || null, groupRoutes: groupRoutes || null, topInset: topInset || null, vp: null, fixed: null });
      this.ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => (this.vp && this.vp.enabled ? this.vp.resized() : this.render())) : null;
      if (this.ro) this.ro.observe(canvas);
      this.zoomOn = !!zoom;
      // 分段播放（選擇加入）。段長由 segmentSeq 決定，這裡只有播不播、停多久、跳到相鄰的那一段。
      Object.assign(this, { segmentOn: !!segment, parts: [], segIndex: 0, speedIndex: SEGMENT_SPEED, playing: false, stay: false, userGo: false, follow: true, framing: false, onSegment: onSegment || null, _segTimer: 0, _frameT: 0 });
      // 自己拖曳、滾輪縮放之後，自動換段不再把畫面拉走；點一下（進全螢幕、點兩下）不算
      this.userDown = null;
      this.onUserDown = (e) => { this.userDown = { x: e.clientX, y: e.clientY }; };
      this.onUserMove = (e) => { if (this.userDown && this.vp && this.vp.enabled && Math.hypot(e.clientX - this.userDown.x, e.clientY - this.userDown.y) > 8) this.follow = false; };
      this.onUserWheel = () => { if (this.vp && this.vp.enabled) this.follow = false; };
      canvas.addEventListener('pointerdown', this.onUserDown);
      canvas.addEventListener('pointermove', this.onUserMove);
      canvas.addEventListener('wheel', this.onUserWheel, { passive: true });
    }
    // 縮放、平移開關：關掉就回到自動取景，畫布的手勢交還給瀏覽器
    setZoom(on) {
      if (on && !this.vp) {
        this.vp = new VP.Viewport(this.canvas, { w: this.scene.w, h: this.scene.h }, {
          onChange: (t) => { this.fixed = t; this.render(); if (this.onView) this.onView(t); }, pads: () => this.pads(), home: (g) => this.homeView(g), canZoomAt: (x, y) => this.canZoomAt(x, y), guard: (e) => this.guard(e),
        });
      }
      if (!this.vp) return;
      this.vp.enable(on);
      if (on) { this.framing = true; this.vp.reset(); this.framing = false; } else { this.fixed = null; this.render(); if (this.onView) this.onView(null); }
    }
    get zoomed() { return !!(this.vp && this.vp.enabled); }
    zoomStep(dir) { this.follow = false; if (this.vp && this.vp.enabled) this.vp.zoomStep(dir); }
    resetView() { if (this.vp && this.vp.enabled) this.vp.flyTo(this.vp.home()); }
    homeView(g) { return this.segmentHome(g); }   // 起始視角：預設整張照片置中（RouteViewer 換成路線視角）；分段播放中是這一段
    // 這一段的岩點放進畫面（上下讓出工具列）。沒在分段、或這一段沒有畫得出來的岩點，回傳 null。
    segmentHome(g) {
      if (!this.segmentOn || !this.parts.length || !g) return null;
      const frame = I.segmentFrame(this.route, this.segIndex);
      if (!frame) return null;
      const byId = new Map(this.routeHolds.map((h) => [h.id, h]));
      const holds = frame.current.map((id) => byId.get(id)).filter(Boolean);
      if (!holds.length) return null;
      const b = holds.map((h) => G.bbox(h.poly)).reduce((a, c) => ({ x0: Math.min(a.x0, c.x0), y0: Math.min(a.y0, c.y0), x1: Math.max(a.x1, c.x1), y1: Math.max(a.y1, c.y1) }));
      const [top, bottom] = this.pads();
      return F.fitBoxIn(b, g, { photoW: this.scene.w, topInset: top, bottomInset: bottom, side: 28 });
    }
    canZoomAt() { return true; }
    guard() { return false; }                // 這根手指交給別的手勢（RouteEditor 的畫圈）就回傳 true
    get routeHolds() { return I.routeHolds(this.route, this.scene.holds); }
    // 路線視角和標籤大小用的框幾何（跟岩點貓同一份算法，fit.js）：topInset()＝上面工具列蓋住的高度（沒給就用 pads 的上面那段）
    fitGeo() {
      const W = Math.max(1, this.canvas.clientWidth), H = Math.max(1, this.canvas.clientHeight);
      const g = this.vp && this.vp.enabled ? this.vp.geo : { W, H, ...VP.fitOf(W, H, this.scene.w, this.scene.h), pads: this.pads() };
      return { g: { W, H, bw: g.bw, bh: g.bh, maxScale: VP.maxScaleOf(this.scene.w, g.bw) }, topInset: this.topInset ? this.topInset() : g.pads[0] };
    }
    groupOf() { return this.groupRoutes ? this.groupRoutes() : [this.route]; }
    // 標籤大小（路線視角時固定的螢幕大小，跟岩點貓的 labelUnit 同一份）
    labelUnit() { const { g, topInset } = this.fitGeo(); return F.labelUnitOf(this.scene, this.groupOf(), this.route, g, { topInset }); }
    setRoute(route) {
      this.route = route; this.segIndex = 0; this.rebuildParts();
      if (this.vp && this.vp.enabled) { if (this.segmentOn) { this.follow = true; this.reframe(); } else this.vp.reset(); }
      else this.render();
      if (this.playing) this.arm();
      this.notify();
    }
    // 路線圖的底：gray 灰階、dim 暗彩
    setMode(mode) { this.mode = baseOf(mode); this.render(); }
    destroy() {
      this.playing = false; clearTimeout(this._segTimer); clearTimeout(this._frameT);
      this.canvas.removeEventListener('pointerdown', this.onUserDown);
      this.canvas.removeEventListener('pointermove', this.onUserMove);
      this.canvas.removeEventListener('wheel', this.onUserWheel);
      if (this.ro) this.ro.disconnect(); if (this.vp) this.vp.destroy();
    }
    prefersReduced() { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; }
    rebuildParts() { this.parts = I.segmentSeq(this.route && this.route.seq); if (this.segIndex >= this.parts.length) this.segIndex = 0; }
    get segmentIndex() { return this.segIndex; }
    get segmentCount() { return this.parts.length; }
    get speed() { return this.speedIndex; }
    get speedSteps() { return SEGMENT_MS.length; }
    get segmentInfo() { return { on: !!this.segmentOn, index: this.segIndex, count: this.parts.length, playing: !!this.playing, speed: this.speedIndex, speeds: SEGMENT_MS.length }; }
    notify() { if (this.onSegment) this.onSegment(this.segmentInfo); }
    // 開或關分段播放。已經是那個狀態就不動（既有的看線不會因為多這個方法而改）。
    setSegmented(on) {
      const next = !!on;
      if (next === this.segmentOn) return;
      this.segmentOn = next; this.segIndex = 0; this.follow = true; this.stay = false; this.userGo = false; this.rebuildParts();
      if (!next) { this.playing = false; clearTimeout(this._segTimer); this.showSegment(); this.notify(); return; }
      this.showSegment();
      if (!this.prefersReduced()) this.play();
      if (!this.playing) this.notify();
    }
    reframe() {
      if (!(this.vp && this.vp.enabled)) { this.render(); return; }
      this.framing = true; this.vp.flyTo(this.vp.home());
      clearTimeout(this._frameT); this._frameT = setTimeout(() => { this.framing = false; }, 280);
    }
    showSegment() { if (this.vp && this.vp.enabled && this.follow) this.reframe(); else this.render(); }
    arm() {
      clearTimeout(this._segTimer);
      if (!this.playing || !this.segmentOn) return;
      this._segTimer = setTimeout(() => { if (this.playing) this.advance(1, false); }, SEGMENT_MS[this.speedIndex]);
    }
    advance(dir, fromUser) {
      const n = this.parts.length;
      if (n < 2) { this.notify(); return; }
      this.segIndex = (this.segIndex + (dir < 0 ? -1 : 1) + n) % n;
      if (fromUser) this.follow = true;
      this.showSegment(); this.arm(); this.notify();
    }
    // play、pause：給捲動進畫面才播的呼叫端（IntersectionObserver）。使用者按了暫停之後，play 不會自己再打開。
    play() {
      if (!this.segmentOn || this.stay || (this.prefersReduced() && !this.userGo) || this.parts.length < 2 || this.playing) return;
      this.playing = true; this.arm(); this.notify();
    }
    pause() { if (!this.playing) return; this.playing = false; clearTimeout(this._segTimer); this.notify(); }
    // 畫面上的暫停／繼續。跟 play、pause 分開，才不會跟「滑出畫面就停」打架。
    setPaused(on) { this.stay = !!on; if (on) this.pause(); else { this.userGo = true; this.play(); } if (!this.playing) this.notify(); }
    faster() { this.bumpSpeed(-1); }
    slower() { this.bumpSpeed(1); }
    bumpSpeed(d) {
      const i = Math.max(0, Math.min(SEGMENT_MS.length - 1, this.speedIndex + d));
      if (i === this.speedIndex) return;
      this.speedIndex = i; if (this.playing) this.arm(); this.notify();
    }
    nextSegment() { this.advance(1, true); }
    prevSegment() { this.advance(-1, true); }
  }
  // 看路線：路線圖（灰階底、路線岩點原色、膠帶、出手順序），以路線為中心取景
  class RouteViewer extends View {
    constructor(canvas, opts) {
      super(canvas, opts); this.mode = opts.mode || 'gray'; this.rebuildParts(); this.render(); if (this.zoomOn) this.setZoom(true);
      if (this.segmentOn && !this.prefersReduced()) this.play();
      if (this.segmentOn && !this.playing) this.notify();
    }
    // 起始視角（點兩下放大後回到這裡）：路線的岩點和標籤剛好放進畫面，路線放中間
    // 跟岩點貓同一份算法（fit.js）：路線所在那一組的岩點加標籤放進畫面，上面讓出工具列；groupRoutes()＝照左右滑的順序排好的路線（沒給就只有這一條）
    homeView(g) {
      const seg = super.homeView(g);
      if (this.segmentOn) return seg;
      const f = F.routeFit(this.scene, this.groupOf(), this.route, { W: g.W, H: g.H, bw: g.bw, bh: g.bh, maxScale: g.maxScale }, { topInset: this.topInset ? this.topInset() : g.pads[0] });
      if (f) return f;
      const b = I.cropAround(this.routeHolds, this.scene.w, this.scene.h, g.W / g.H), k = Math.min(g.W / b.w, g.H / b.h);   // 沒有岩點：整張照片
      return { s: k / g.kFit, tx: g.W / 2 - (b.x + b.w / 2) * k, ty: g.H / 2 - (b.y + b.h / 2) * k };
    }
    render() {
      if (this.segmentOn && this.parts.length) { renderSegment(this); return; }
      const { canvas, scene } = this, hs = this.routeHolds;
      const t = this.fixed ? deviceTransform(canvas, this.fixed) : fitCanvas(canvas, I.cropAround(hs, scene.w, scene.h, canvas.clientWidth / Math.max(1, canvas.clientHeight)));
      const g = canvas.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height);
      g.setTransform(t.k, 0, 0, t.k, t.tx, t.ty);
      I.drawRoute(g, scene, this.route, hs, { unit: this.labelUnit(), mode: this.mode, tint: !this.glow, hands: !this.glow, theme: this.theme, glow: this.glow ? { roles: this.route.holds, colors: (this.theme || L.THEME).colors, dpr: dprOf() } : undefined });
    }
  }
  // 定線：整張照片（底預設暗彩，mode: 'gray' 是灰階；路線岩點原色、類型外框），點岩點用 type（s／h／f／t，或 n＝出手順序）加進路線、改類型、拿掉。
  // 改了就呼叫 onChange(route)；route 直接修改（要保留原本的先自己複製一份）。
  // maxStart（起攀上限，預設 2，有的岩館規定 4）：起攀滿了，新的點改成手點（onType 通知外層）；已在路線上的點不能改成起攀，不動並呼叫 onLimit()；setMaxStart 可以隨時改
  // 還沒選點是原本的照片，選了第一個點才換成底色；點到好幾顆重疊的地方（要開縮放）自動放大那一塊讓人選；
  // setShowAll(true)：顯示所有岩點的外框，其他路線（heatRoutes）用過的照次數畫成粉紅到洋紅；
  // 順序模式（type 'n'）：每次點選追加一手，長按有編號的岩點呼叫 onOrderAsk({ id, nums })，外層問「在第 n 手之後插入／刪掉第 n 手」再呼叫 orderInsertAfter／orderRemove；
  // 這些規則和岩點貓是同一份（editor.js、geometry.js、labels.js），外層只管按鈕和對話框
  class RouteEditor extends View {
    constructor(canvas, opts) {
      super(canvas, opts);
      this.type = opts.type || 's';
      this.mode = baseOf(opts.mode);
      this.maxStart = opts.maxStart;
      this.onLimit = opts.onLimit || (() => {});
      this.onChange = opts.onChange || (() => {});
      this.onType = opts.onType || (() => {});   // 規則自動換了類型（起攀滿了切到手點、不限腳切掉腳點）：外層的類型列跟著換
      this.onOrder = opts.onOrder || (() => {});   // 順序有變（追加、插入、刪除、復原、清除、游標）：外層重畫順序列
      this.onOrderAsk = opts.onOrderAsk || (() => {});
      this.heatRoutes = opts.heatRoutes || [];
      this.showAll = !!opts.showAll;
      this.pick = null;   // 重疊岩點的選擇：{ holds, spots, back }
      this.tapAt = { id: null, t: 0 };
      this.order = E.orderSession();
      this.onTap = (e) => this.tap(e);
      this.skipClick = false;
      // 長按修點（選用，預設關）：holdEdit: true 才有。長按岩點出現調整列；onRefineHold(request, signal) 回傳候選外框（沒給就沒有「重描」）、
      // onHoldEditCommit(change, signal) 回傳 { accepted, poly?, reason? }（沒給就只預覽、不能套用）。Kit 不載入任何模型或 App 程式，重描、存檔都由外層提供
      this.holdEdit = !!opts.holdEdit; this.onRefineHold = opts.onRefineHold || null; this.onHoldEditCommit = opts.onHoldEditCommit || null;
      this.lang = opts.lang === 'en' ? 'en' : 'zh'; this.he = null; this.heBar = null;
      this.onLongPress = opts.onLongPress || null;   // 長按成立時通知外層（觀察用，不接管手勢）：{ x, y（照片像素）, hitHoldId, routeId, type, pointerType, action: 'order'｜'draw'｜'none' }
      // 自由畫（觸控長按空白處）：手指不放繼續畫一圈，有放大鏡；放開就把軌跡簡化成多邊形，成為這條路線自己的岩點外框，照目前的類型加進路線
      this.drawOn = !!opts.draw; this.dr = null; this.own = new Set();
      this.onCtx = (e) => { if (this.drawOn) e.preventDefault(); };
      canvas.addEventListener('contextmenu', this.onCtx);
      this.onMoveP = (e) => this.pressMove(e); this.onUpP = (e) => this.pressUp(e);
      this.lp = new VP.LongPress(canvas, { accept: (e) => this.pressAccept(e), onFire: (c, e) => this.pressFire(c, e) });   // 長按只在這裡辨識（計時、容差、多指、取消、失焦）
      canvas.addEventListener('click', this.onTap);
      canvas.addEventListener('pointermove', this.onMoveP);
      canvas.addEventListener('pointerup', this.onUpP); canvas.addEventListener('pointercancel', this.onUpP);
      this.rebuildParts();
      this.render();
      if (this.zoomOn) this.setZoom(true);
      if (this.segmentOn && !this.prefersReduced()) this.play();
      if (this.segmentOn && !this.playing) this.notify();
    }
    // 定線時點兩下空白處才是放大；點在岩點上是選點
    canZoomAt(x, y) {
      const t = this.vp.transform, px = (x - t.tx) / t.k, py = (y - t.ty) / t.k;
      return !G.holdAt(this.scene.holds.concat(Object.values(this.route.shapes || {})), px, py);
    }
    setType(type) {
      if (this.type === 'n' && type !== 'n') this.order.reset();   // 離開順序模式：別的類型會改順序，復原紀錄作廢
      this.type = type; this.onOrder();
    }
    setRoute(route) { this.endHoldEdit(); this.order.reset(); this.pick = null; this.dr = null; this.own.clear(); super.setRoute(route); this.onOrder(); }
    setShowAll(on) { this.showAll = !!on; this.render(); }
    setHeatRoutes(routes) { this.heatRoutes = routes || []; this.render(); }
    setMaxStart(maxStart) { this.maxStart = maxStart; }
    // ---- 出手順序（跟岩點貓同一份規則：editor.js 的 orderSession）----
    get orderInfo() { return { len: this.route.seq ? this.route.seq.length : 0, insertAt: this.order.insertAt(this.route), canUndo: this.order.canUndo(this.route) }; }
    get canUndoSeq() { return this.order.canUndo(this.route); }
    undoSeq() { if (!this.order.undo(this.route)) return false; this.render(); this.onChange(this.route); this.onOrder(); return true; }
    orderInsertAfter(n) { this.order.startInsert(this.route, n); this.onOrder(); }   // n＝0：插在最前面
    orderEndInsert() { this.order.endInsert(); this.onOrder(); }
    orderRemove(n) { this.order.remove(this.route, n); this.render(); this.onChange(this.route); this.onOrder(); }
    orderClear() { this.order.clear(this.route); this.render(); this.onChange(this.route); this.onOrder(); }
    // ---- 不限腳：長按腳點切換。要開而路線上已經有腳點時回傳 'confirm'（外層問過再用 { clear: true } 呼叫，會清掉腳點）----
    toggleFeetFree({ clear = false } = {}) {
      const r = this.route;
      if (!r.feetFree && Object.values(r.holds).includes('f')) { if (!clear) return 'confirm'; E.clearFeet(r); this.order.reset(); }
      E.toggleFeetFree(r);
      if (r.feetFree && this.type === 'f') { this.type = 'h'; this.onType('h'); }   // 不限腳就不再選腳點，切回手點
      this.render(); this.onChange(this.route); this.onOrder();
      return r.feetFree ? 'on' : 'off';
    }
    // ---- 自由畫（觸控長按空白處）----
    setDrawMode(on) { this.drawOn = !!on; if (!on) this.dr = null; }
    guard() { return !!this.dr; }   // 畫的時候別的手指不拖照片
    eatClick() { this.skipClick = true; clearTimeout(this.eatT); this.eatT = setTimeout(() => { this.skipClick = false; }, 80); }   // 手指放開後緊接著來的 click 不算點選；拖過的手勢瀏覽器不送 click，所以不留著擋下一次點選
    drawFinger(e) { const r = this.canvas.getBoundingClientRect(), dpr = this.canvas.width / Math.max(1, r.width); return { fx: (e.clientX - r.left) * dpr, fy: (e.clientY - r.top) * dpr, dpr }; }
    drawStart(pt, e) {
      const vp = this.vp; if (vp) { vp.pts.clear(); vp.gesture = null; vp.suppress = true; setTimeout(() => { vp.suppress = false; }, 80); }   // 長按剛開始的那根手指不再拖照片
      const f = this.drawFinger(e);
      this.dr = { pid: e.pointerId, pts: [[pt.x, pt.y]], fx: f.fx, fy: f.fy };
      this.eatClick();
      try { this.canvas.setPointerCapture(e.pointerId); } catch (er) { /* 指標已經放開 */ }
      this.render();
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(12);
    }
    drawMove(e) {
      const d = this.dr, pt = this.photoPoint(e), f = this.drawFinger(e), l = d.pts[d.pts.length - 1];
      d.fx = f.fx; d.fy = f.fy;
      if (pt && Math.hypot(pt.x - l[0], pt.y - l[1]) * this.t.k >= 2 * f.dpr) d.pts.push([pt.x, pt.y]);   // 離上一點不到 2 個螢幕像素的不記
      this.render();
    }
    // 放開：軌跡簡化成多邊形，成為這條路線自己的岩點外框（route.shapes），類型照目前選的（規則同點岩點：起攀滿了不加）；畫得太小就當沒畫
    drawEnd() {
      const d = this.dr; if (!d) return;
      this.dr = null; this.eatClick();
      const k = this.t.k, dpr = this.canvas.width / Math.max(1, this.canvas.getBoundingClientRect().width);
      const poly = G.freehandPoly(d.pts, this.scene.w, this.scene.h, { minTol: 1.5 * dpr / k, minSize: 8 * dpr / k });
      if (poly) {
        const id = `cc${Math.random().toString(36).slice(2, 8)}`, shapes = this.route.shapes || (this.route.shapes = {});
        shapes[id] = { id, poly, source: 'manual' };
        this.own.add(id);
        this.apply(shapes[id]);
        if (!this.route.holds[id]) { delete shapes[id]; this.own.delete(id); }   // 沒加進去（起攀滿了、不限腳）：外框也不留
      }
      this.render();
    }
    drawTrail(g, px) {
      const pts = this.dr.pts; if (pts.length < 2) return;
      g.save(); g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.lineWidth = px(5); g.strokeStyle = 'rgba(0,0,0,.55)'; g.stroke();
      g.lineWidth = px(2.5); g.strokeStyle = '#facc15'; g.stroke();
      g.restore();
    }
    // 放大鏡：畫在手指上方（太靠上放下方），看手指正在畫的地方
    drawLoupe(g, k, dpr) {
      const d = this.dr, c = d.pts[d.pts.length - 1], S = 120 * dpr, W = this.canvas.width;
      const left = Math.min(W - S - 4 * dpr, Math.max(4 * dpr, d.fx - S / 2)), up = d.fy - S - 60 * dpr, top = up < 4 * dpr ? d.fy + 60 * dpr : up;
      const z = Math.max(k * 1.5, Math.min(k * 2.5, 3 * dpr));
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
      g.beginPath(); g.rect(left, top, S, S); g.clip(); g.fillStyle = '#000'; g.fill();
      g.translate(left + S / 2 - c[0] * z, top + S / 2 - c[1] * z); g.scale(z, z);
      g.drawImage(this.scene.img, 0, 0);
      g.beginPath(); g.moveTo(d.pts[0][0], d.pts[0][1]); for (const q of d.pts) g.lineTo(q[0], q[1]);
      g.lineJoin = 'round'; g.lineWidth = 1.5 * dpr / z; g.strokeStyle = '#facc15'; g.stroke();
      g.restore();
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.lineWidth = 1.5 * dpr; g.strokeStyle = '#fff'; g.strokeRect(left, top, S, S);
      const mx = left + S / 2, my = top + S / 2, q = 9 * dpr;
      g.beginPath(); g.moveTo(mx - q, my); g.lineTo(mx + q, my); g.moveTo(mx, my - q); g.lineTo(mx, my + q); g.stroke();
      g.restore();
    }
    // ---- 長按有編號的岩點（順序模式）／長按空白處自由畫 ----
    // 這次按下要不要開始長按計時：順序模式按中有編號的岩點＝問順序；觸控按在空白處且開了 draw＝自由畫；其餘只有外層要觀察（onLongPress）才計時
    pressAccept(e) {
      if (this.dr) return null;
      this.skipClick = false;
      const pt = this.photoPoint(e);
      if (!pt || pt.x < 0 || pt.y < 0 || pt.x > this.scene.w || pt.y > this.scene.h) return null;
      const hit = G.holdAt(this.liveHolds(), pt.x, pt.y) || null;
      let action = 'none';
      if (this.type === 'n') { if (hit && this.order.numbers(this.route, hit.id).length) action = 'order'; }
      else if (this.drawOn && e.pointerType !== 'mouse' && !this.pick && !hit) action = 'draw';
      return action === 'none' && !this.onLongPress && !this.holdEdit ? null : { pt, hit, action };
    }
    // 長按成立：先通知外層（同步、只觀察），再照分派做：順序 → 自由畫 → 不動
    pressFire({ pt, hit, action }, e) {
      if (this.onLongPress) { try { this.onLongPress({ x: pt.x, y: pt.y, hitHoldId: hit ? hit.id : null, routeId: this.route.id == null ? null : this.route.id, type: this.type, pointerType: e.pointerType, action }); } catch (er) { /* 外層出錯不影響定線 */ } }
      if (action === 'order') { this.skipClick = true; this.onOrderAsk({ id: hit.id, nums: this.order.numbers(this.route, hit.id) }); }
      else if (action === 'draw') this.drawStart(pt, e);
      else if (this.holdEdit && hit && this.scene.holds.includes(hit)) { this.skipClick = true; this.openHoldEdit(hit, pt); }   // 順序模式、自由畫優先；沒開 holdEdit 就什麼都不做
    }
    // ---- 長按修點（選用）：調整列 → 重描（外層給候選外框，Kit 驗證）→ 套用（外層決定接不接受）----
    setHoldEdit(o = {}) {
      if ('holdEdit' in o) { this.holdEdit = !!o.holdEdit; if (!this.holdEdit) this.endHoldEdit(); }
      if ('lang' in o) this.lang = o.lang === 'en' ? 'en' : 'zh';
      if ('onRefineHold' in o) this.onRefineHold = o.onRefineHold || null;
      if ('onHoldEditCommit' in o) this.onHoldEditCommit = o.onHoldEditCommit || null;
      if (this.he) this.heShow();
    }
    heText(zh, en) { return this.lang === 'en' ? en : zh; }
    openHoldEdit(hold, pt) {
      this.endHoldEdit();
      this.he = { hold, id: hold.id, poly: hold.poly.map((q) => [q[0], q[1]]), cand: null, busy: false, ctl: null, x: pt.x, y: pt.y, msg: '' };
      this.heShow(this.heText('岩點調整', 'Adjust hold'));
    }
    endHoldEdit() {
      const he = this.he; if (!he) return;
      this.he = null; if (he.ctl) he.ctl.abort();
      this.heShow();
    }
    heBarEl() {
      if (this.heBar || typeof document === 'undefined') return this.heBar;
      const parent = this.canvas.parentNode; if (!parent) return null;
      const el = document.createElement('div');
      el.id = 'he'; el.setAttribute('role', 'group'); el.hidden = true; el.style.display = 'none';
      el.style.cssText = 'position:absolute;left:50%;bottom:14px;transform:translateX(-50%);gap:8px;align-items:center;max-width:calc(100% - 24px);padding:8px 10px;border-radius:12px;background:rgba(15,20,18,.92);color:#e5ebe6;font:14px/1.3 system-ui,sans-serif;z-index:5';
      const mk = (tag, id, css) => { const n = document.createElement(tag); n.id = id; if (tag === 'button') { n.type = 'button'; n.style.cssText = `min-height:36px;padding:0 14px;border:0;border-radius:9px;background:#2f3b34;color:#fff;font:inherit;${css || ''}`; } return n; };
      this.heMsgEl = mk('span', 'he-msg'); this.heRefine = mk('button', 'he-refine'); this.heApply = mk('button', 'he-apply', 'background:#facc15;color:#111'); this.heClose = mk('button', 'he-close');
      el.append(this.heMsgEl, this.heRefine, this.heApply, this.heClose);
      this.heRefine.addEventListener('click', () => this.heAskRefine());
      this.heApply.addEventListener('click', () => this.heAskApply());
      this.heClose.addEventListener('click', () => this.endHoldEdit());
      const cs = typeof getComputedStyle === 'function' ? getComputedStyle(parent) : null;
      if (cs && cs.position === 'static') parent.style.position = 'relative';
      parent.appendChild(el);
      return (this.heBar = el);
    }
    heShow(msg) {
      const he = this.he, bar = he || this.heBar ? this.heBarEl() : null;
      if (bar) {
        bar.hidden = !he; bar.style.display = he ? 'flex' : 'none';
        if (he) {
          if (msg !== undefined) he.msg = msg;
          this.heMsgEl.textContent = he.msg;
          this.heRefine.hidden = !this.onRefineHold || !!he.cand; this.heRefine.disabled = he.busy; this.heRefine.textContent = this.heText('重描', 'Refine');
          this.heApply.hidden = !(he.cand && this.onHoldEditCommit); this.heApply.disabled = he.busy; this.heApply.textContent = this.heText('套用', 'Apply');
          this.heClose.textContent = he.cand && !this.onHoldEditCommit ? this.heText('關閉', 'Close') : this.heText('取消', 'Cancel');
        }
      }
      this.render();
    }
    async heCall(fn, payload) {   // 外層的非同步回覆：只接受目前這一次調整；過時（取消、換線、換牆）的結果一律丟掉
      const cur = this.he; if (!cur || cur.busy) return undefined;
      cur.busy = true; cur.ctl = typeof AbortController === 'function' ? new AbortController() : { signal: undefined, abort() {} };
      this.heShow(this.heText('等待外層回覆…', 'Waiting for the host…'));
      try {
        const r = await fn(payload, cur.ctl.signal);
        if (this.he !== cur) return undefined;
        cur.busy = false; return { cur, r };
      } catch (e) {
        if (this.he === cur) { cur.busy = false; this.heShow(String((e && e.message) || e)); }
        return undefined;
      }
    }
    async heAskRefine() {
      const cur = this.he; if (!cur || cur.busy || !this.onRefineHold) return;
      const { w, h } = this.scene;
      const got = await this.heCall(this.onRefineHold, { routeId: this.route.id == null ? null : this.route.id, holdId: cur.id, poly: cur.poly, x: cur.x, y: cur.y, w, h });
      if (!got) return;
      const cand = G.candidatePoly(got.r, w, h);
      if (!cand) return this.heShow(this.heText('外層回的外框不合格，沒有改動', 'The returned outline is not valid; nothing changed'));
      got.cur.cand = cand; this.heShow(this.heText('候選外框（黃線）', 'Candidate outline (yellow)'));
    }
    async heAskApply() {
      const cur = this.he; if (!cur || !cur.cand || cur.busy || !this.onHoldEditCommit) return;
      const got = await this.heCall(this.onHoldEditCommit, { routeId: this.route.id == null ? null : this.route.id, holdId: cur.id, poly: cur.cand });
      if (!got) return;
      const r = got.r;
      if (!r || r.accepted !== true) return this.heShow(this.heText('外層沒有接受', 'The host rejected it') + (r && typeof r.reason === 'string' ? `：${r.reason.slice(0, 80)}` : ''));
      const next = G.candidatePoly(r.poly === undefined ? cur.cand : r.poly, this.scene.w, this.scene.h);   // 外層可以回它實際存下的外框
      if (!next) return this.heShow(this.heText('外層回的外框不合格，沒有改動', 'The returned outline is not valid; nothing changed'));
      cur.hold.poly = next; this.scene.touch();
      this.endHoldEdit();
    }
    heDraw(g, px) {   // 原外框白色虛線、候選外框黃線（畫在畫布上，跟著縮放平移）
      const he = this.he; if (!he) return;
      const path = (poly) => { g.beginPath(); poly.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };
      g.save(); g.lineJoin = 'round';
      path(he.poly); g.lineWidth = px(2); g.strokeStyle = '#ffffff'; g.setLineDash([px(6), px(4)]); g.stroke();
      if (he.cand) { path(he.cand); g.setLineDash([]); g.lineWidth = px(3); g.strokeStyle = '#facc15'; g.stroke(); }
      g.restore();
    }
    pressMove(e) { if (this.dr && e.pointerId === this.dr.pid) this.drawMove(e); }
    pressUp(e) { if (this.dr && e && e.pointerId === this.dr.pid) this.drawEnd(); }
    destroy() {
      this.endHoldEdit(); if (this.heBar) { this.heBar.remove(); this.heBar = null; }
      super.destroy(); this.lp.destroy();
      const c = this.canvas; c.removeEventListener('contextmenu', this.onCtx);
      c.removeEventListener('click', this.onTap); c.removeEventListener('pointermove', this.onMoveP);
      c.removeEventListener('pointerup', this.onUpP); c.removeEventListener('pointercancel', this.onUpP);
    }
    liveHolds() { return this.scene.holds.filter((h) => !h.retired).concat(Object.values(this.route.shapes || {})); }
    photoPoint(e) {
      if (!this.t) return null;
      const r = this.canvas.getBoundingClientRect(), dpr = this.canvas.width / Math.max(1, r.width);
      return { x: ((e.clientX - r.left) * dpr - this.t.tx) / this.t.k, y: ((e.clientY - r.top) * dpr - this.t.ty) / this.t.k, dpr };
    }
    render() {
      if (this.segmentOn && this.parts.length) { renderSegment(this); return; }
      const { canvas, scene, route } = this, hs = this.routeHolds;
      this.t = this.fixed ? deviceTransform(canvas, this.fixed) : fitCanvas(canvas, { x: 0, y: 0, w: scene.w, h: scene.h });
      const g = canvas.getContext('2d'), k = this.t.k;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height);
      g.setTransform(k, 0, 0, k, this.t.tx, this.t.ty);
      if (hs.length) scene.drawBase(g, hs, { mode: this.mode, tint: false, glow: this.glow ? { roles: route.holds, colors: (this.theme || L.THEME).colors, dpr: dprOf() } : undefined });
      else g.drawImage(scene.img, 0, 0);   // 還沒選點：原本的照片，選了第一個點才換成暗彩／灰階（跟岩點貓一樣）
      g.lineJoin = 'round';
      const px = (s) => s / k * ((typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);   // 螢幕像素 → 照片像素
      const vis = { x0: -this.t.tx / k, y0: -this.t.ty / k, x1: (canvas.width - this.t.tx) / k, y1: (canvas.height - this.t.ty) / k };
      if (this.showAll) {   // 顯示所有岩點：每顆畫外框，同時是這面牆的熱圖
        const heat = E.holdUse(typeof this.heatRoutes === 'function' ? this.heatRoutes() : this.heatRoutes, route), inRoute = route.holds || {};
        const big = typeof innerWidth === 'number' ? Math.min(1.5, Math.max(1, Math.min(innerWidth, innerHeight) / 560)) : 1, viewScale = this.vp && this.vp.enabled ? this.vp.v.s : 1;
        for (const h of scene.holds) {
          if (h.retired || inRoute[h.id]) continue;
          const b = G.bbox(h.poly); if (b.x1 < vis.x0 || b.x0 > vis.x1 || b.y1 < vis.y0 || b.y0 > vis.y1) continue;
          L.strokeHoldOutline(g, h.poly, { k: E.heatLevel(heat, h.id), viewScale, big, L: px });
        }
      }
      for (const h of hs) L.strokeRouteHold(g, h.poly, route.holds[h.id], (s) => px(s * 0.65), this.theme);
      L.drawSeq(g, scene, route, this.labelUnit(), [], hs, this.theme);
      if (this.pick) L.drawOverlapPick(g, { img: scene.img, holds: this.pick.holds, spots: this.pick.spots, preferred: this.pick.preferred, neighbors: this.pick.neighbors, vis, L: px, routeHolds: hs, route, theme: this.theme });
      if (this.he) this.heDraw(g, px);
      if (this.dr) { this.drawTrail(g, px); this.drawLoupe(g, k, dprOf()); }
    }
    // 套用一次點選（點到單一岩點、或從重疊的候選裡選好）：規則在 editor.js
    apply(hit) {
      if (this.type === 'n') {
        const n = this.order.tap(this.route, hit.id);
        this.render(); this.onChange(this.route); this.onOrder({ added: n });
        return;
      }
      if (this.type === 'f' && this.route.feetFree) return;   // 不限腳：不能點腳點
      const now = Date.now(), res = E.tapHold(this.route, hit.id, this.type, { ...(this.maxStart === undefined ? {} : { maxStart: this.maxStart }), justAdded: this.tapAt.id === hit.id && now - this.tapAt.t < 400 });
      if (res === 'full') { this.onLimit(); return; }
      if (res === 'ignored') return;
      if (res === 'removed' && this.own.has(hit.id)) { delete this.route.shapes[hit.id]; this.own.delete(hit.id); }   // 自己畫的圓拿掉：外框也不留
      if (res !== 'removed') this.tapAt = { id: hit.id, t: now };
      const nt = E.nextType(this.route, this.type, this.maxStart === undefined ? undefined : this.maxStart);
      if (nt !== this.type) { this.type = nt; this.onType(nt); }   // 起攀滿了：之後新的點是手點（跟岩點貓一樣）
      this.render();
      this.onChange(this.route);
    }
    // 重疊的地方：放大那一塊讓人選，選好（或點候選以外取消）就飛回原本的縮放和位置
    openPick(under, preferred) {
      const vp = this.vp, g = vp.geo, { w, h } = this.scene;
      const pick = B.prepareOverlapPick(under, this.scene.holds.filter(hold => !hold.retired), { w, h, width: g.W, height: g.H });
      const s = Math.min(pick.k / g.kFit, g.maxScale), k = g.kFit * s;
      this.pick = { ...pick, preferred, back: { ...vp.v } };
      vp.flyTo({ s, tx: g.W / 2 - pick.cx * k, ty: g.H / 2 - pick.cy * k });
      this.render();
    }
    tap(e) {
      if (this.skipClick) { this.skipClick = false; return; }   // 長按剛處理過，接著來的 click 不算點選
      const pt = this.photoPoint(e); if (!pt) return;
      const { x, y, dpr } = pt;
      if (this.pick) {   // 重疊的選擇進行中
        const p = this.pick, direct = G.holdAt(this.liveHolds(), x, y);
        const h = G.pickOverlap(p.holds, p.spots, x, y, 16 * dpr / this.t.k, direct);
        this.pick = null; this.vp.flyTo(p.back); this.render();
        if (h) this.apply(h);
        return;
      }
      const all = this.liveHolds();
      let hit = G.holdAt(all, x, y);
      if (!hit) return;
      // 重疊的地方：只重疊一部分的相鄰岩點直接決定（tapCandidates，岩點貓同一份），Volume 上的點、重複的外框才放大讓人選
      const candidates = G.tapCandidates(this.scene.holds.filter(h => !h.retired), x, y);
      if (candidates.length >= 2 && this.type !== 'n' && this.vp?.enabled) { this.openPick(candidates, candidates[0]); return; }
      if (candidates.length === 1) hit = all.find(h => h.id === candidates[0].id) || candidates[0];
      this.apply(hit);
    }
  }
  return { RouteViewer, RouteEditor };
});
