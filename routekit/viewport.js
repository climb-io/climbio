// RouteKit viewport：照片的縮放、平移——跟岩點貓同一套規則（雙指縮放、一指／滑鼠拖曳平移、點兩下放大或回到起始視角、滾輪縮放、縮放按鈕的階梯），
// 邊界也一樣：整張照片最小（比框小就置中），放大後不讓邊緣露出空白，最大放大到 1 個照片像素＝4 個螢幕點（至少 10 倍）；
// 上下浮著工具列時（pads）可以多拖那兩段，照片最上、最下的岩點都拖得到工具列外面點得到。
// 只算視角、處理手勢，不畫圖：視角（照片座標 → 畫布的轉換，螢幕 CSS 像素）交給 onChange；RouteViewer、RouteEditor 的 zoom 選項用它。
// 瀏覽器用 <script> 依序載入，掛在全域 RouteKit；Node 用 require（只有 clampView、maxScaleOf 等純函式能用）。
// English: RouteKit viewport: pinch/wheel zoom, drag pan, double-tap zoom with the same rules and bounds as Hold Cat.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else Object.assign(root.RouteKit || (root.RouteKit = {}), factory());
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const MIN_SCALE = 1, MAX_SCALE = 10, STEPS = [1, 1.5, 2, 3, 4, 6, 8, 10], DOUBLE_TAP = 2.5, DOUBLE_MS = 350, TAP_PX = 6;
  // 照片整張放進框（contain）的大小（比例 s＝1）
  const fitOf = (W, H, pw, ph) => { const k = Math.min(W / pw, H / ph); return { k, bw: pw * k, bh: ph * k }; };
  // 最大放大：1 個照片像素＝4 個螢幕點（至少 10 倍）：高解析的牆小岩點很多，10 倍還小到調不了外框
  const maxScaleOf = (pw, bw) => Math.max(MAX_SCALE, 4 * pw / Math.max(1, bw));
  // 縮放、位移套上邊界：圖比框小時置中，比框大時不讓邊緣露出空白；上下多留工具列蓋住的那段（pads：[上, 下]）
  // minScale：最小縮放（預設 1；岩點貓的 3D 牆最小縮放比 1 大）；fitPads：[上, 下]，圖剛好放得下時置中在「工具列之間」（電腦寬度的 2D 照片讓出右邊的縮放鈕，預設 [0, 0]＝整個框置中）
  function clampView(s, tx, ty, { W, H, bw, bh, pads = [0, 0], maxScale = MAX_SCALE, minScale = MIN_SCALE, fitPads = [0, 0] }) {
    s = Math.min(maxScale, Math.max(minScale, s));
    const w = bw * s, h = bh * s, [pt, pb] = pads, mid = fitPads[0] + (H - fitPads[0] - fitPads[1] - h) / 2;
    tx = w <= W ? (W - w) / 2 : Math.min(0, Math.max(W - w, tx));
    // 範圍連續：圖剛好放得下、上下工具列高度不同時，不會從置中一下跳到貼邊
    ty = Math.min(Math.max(pt, mid), Math.max(Math.min(H - pb - h, mid), ty));
    return { s, tx, ty };
  }
  // 以框內 (px, py) 這一點不動縮放到 s2
  const zoomAround = (v, s2, px, py) => ({ s: s2, tx: px - (px - v.tx) * s2 / v.s, ty: py - (py - v.ty) * s2 / v.s });

  // canvas：手勢收在這張畫布上；photo：{ w, h } 照片像素；onChange({ s, k, tx, ty })：視角變了（k＝每個照片像素幾個螢幕點）
  // opts.pads()：[上, 下] 工具列蓋住的高度；opts.home()：起始視角 { s, tx, ty }（沒給就是整張照片置中）；
  // opts.canZoomAt(px, py)：這一點點兩下可不可以放大（定線時點在岩點上是選點，不是放大）
  class Viewport {
    constructor(canvas, photo, { onChange, pads = () => [0, 0], home = null, canZoomAt = () => true, guard = null } = {}) {
      Object.assign(this, { canvas, photo, onChange, pads, homeOf: home, canZoomAt, guard });   // guard(e)＝true：這根手指不是縮放、平移（外層自己用，例如畫圈）
      this.v = { s: 1, tx: 0, ty: 0 };
      this.pts = new Map(); this.gesture = null; this.tap = { t: 0, x: 0, y: 0 }; this.suppress = false; this.raf = 0; this.fly = 0;
      this.enabled = false;
      this.handlers = {
        down: (e) => this.down(e), move: (e) => this.move(e), up: (e) => this.up(e), wheel: (e) => this.wheel(e),
        click: (e) => { if (this.suppress) { e.stopImmediatePropagation(); e.preventDefault(); this.suppress = false; } },
        dbl: (e) => { if (this.enabled) e.preventDefault(); },
      };
    }
    get size() { return { W: Math.max(1, this.canvas.clientWidth), H: Math.max(1, this.canvas.clientHeight) }; }
    get geo() {
      const { W, H } = this.size, { k: kFit, bw, bh } = fitOf(W, H, this.photo.w, this.photo.h);
      return { W, H, kFit, bw, bh, pads: this.pads(), maxScale: maxScaleOf(this.photo.w, bw) };
    }
    get transform() { const { kFit } = this.geo; return { s: this.v.s, k: kFit * this.v.s, tx: this.v.tx, ty: this.v.ty }; }
    clamp(v) { return clampView(v.s, v.tx, v.ty, this.geo); }
    // 起始視角：home() 給的，沒有就整張照片置中
    home() {
      const g = this.geo, h = (this.homeOf && this.homeOf(g)) || { s: 1, tx: (g.W - g.bw) / 2, ty: (g.H - g.bh) / 2 };
      return clampView(h.s, h.tx, h.ty, g);
    }
    set(v, silent = false) { this.v = this.clamp(v); if (!silent) this.emit(); }
    emit() { if (this.onChange) this.onChange(this.transform); }
    schedule() { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.emit(); }); }
    reset(silent = false) { this.stop(); this.set(this.home(), silent); }
    // 平滑飛到 target（0.2 秒，先快後慢）
    flyTo(target, ms = 200) {
      this.stop();
      const from = { ...this.v }, to = this.clamp(target), t0 = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - t0) / ms), e = 1 - (1 - p) * (1 - p);
        this.v = { s: from.s + (to.s - from.s) * e, tx: from.tx + (to.tx - from.tx) * e, ty: from.ty + (to.ty - from.ty) * e };
        this.emit();
        this.fly = p < 1 ? requestAnimationFrame(step) : 0;
      };
      this.fly = requestAnimationFrame(step);
    }
    stop() { if (this.fly) { cancelAnimationFrame(this.fly); this.fly = 0; } }
    zoomTo(s, px, py, animate = false) {
      const g = this.geo, t = zoomAround(this.v, Math.min(g.maxScale, Math.max(MIN_SCALE, s)), px, py);
      if (animate) this.flyTo(t); else { this.set(t, true); this.schedule(); }
    }
    // 縮放按鈕：往上、往下一階（以框的中心）
    zoomStep(dir) {
      const { W, H, maxScale } = this.geo, s = this.v.s;
      const next = dir > 0 ? STEPS.find((z) => z > s + 0.01) || maxScale : [...STEPS].reverse().find((z) => z < s - 0.01) || MIN_SCALE;
      this.zoomTo(next, W / 2, H / 2, true);
    }
    // 點兩下：已經放大（比起始視角大）就回到起始視角，不然以點的地方為中心放大 2.5 倍
    doubleTap(px, py) {
      const home = this.home();
      if (this.v.s > home.s * 1.05) this.flyTo(home); else this.zoomTo(this.v.s * DOUBLE_TAP, px, py, true);
    }
    // 開關手勢：關掉時畫布交回給瀏覽器（頁面照常捲動），打開時由這裡處理
    enable(on) {
      on = !!on;
      if (on === this.enabled) return;
      this.enabled = on;
      const c = this.canvas, h = this.handlers;
      if (on) {
        c.style.touchAction = 'none';
        c.addEventListener('click', h.click, true); c.addEventListener('dblclick', h.dbl);
        c.addEventListener('pointerdown', h.down); c.addEventListener('pointermove', h.move);
        c.addEventListener('pointerup', h.up); c.addEventListener('pointercancel', h.up);
        c.addEventListener('wheel', h.wheel, { passive: false });
      } else {
        c.style.touchAction = '';
        c.removeEventListener('click', h.click, true); c.removeEventListener('dblclick', h.dbl);
        c.removeEventListener('pointerdown', h.down); c.removeEventListener('pointermove', h.move);
        c.removeEventListener('pointerup', h.up); c.removeEventListener('pointercancel', h.up);
        c.removeEventListener('wheel', h.wheel);
        this.pts.clear(); this.gesture = null; this.suppress = false;
      }
    }
    local(e) { const r = this.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    down(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (this.guard && this.guard(e)) return;
      this.stop();
      try { this.canvas.setPointerCapture(e.pointerId); } catch (er) { /* 指標已經放開 */ }
      this.pts.set(e.pointerId, this.local(e));
      if (this.pts.size === 1) { const [x, y] = this.pts.get(e.pointerId); this.gesture = { mode: 'pan', x, y, v: { ...this.v }, moved: false, t: e.timeStamp }; }
      else if (this.pts.size === 2) {
        const [a, b] = [...this.pts.values()];
        this.gesture = { mode: 'pinch', d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2, v: { ...this.v }, moved: true };
        this.suppress = true;
      }
    }
    move(e) {
      if (!this.pts.has(e.pointerId) || !this.gesture) return;
      this.pts.set(e.pointerId, this.local(e));
      const g = this.gesture;
      if (g.mode === 'pinch' && this.pts.size >= 2) {
        const [a, b] = [...this.pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        const s = Math.min(this.geo.maxScale, Math.max(MIN_SCALE, g.v.s * d / g.d));
        // 兩指開始時按住的那一點，跟著兩指的中點走
        this.set({ s, tx: mx - (g.mx - g.v.tx) * s / g.v.s, ty: my - (g.my - g.v.ty) * s / g.v.s }, true);
        this.schedule();
      } else if (g.mode === 'pan' && this.pts.size === 1) {
        const [x, y] = this.pts.get(e.pointerId);
        if (!g.moved && Math.hypot(x - g.x, y - g.y) > TAP_PX) { g.moved = true; this.suppress = true; }
        if (g.moved) { this.set({ s: g.v.s, tx: g.v.tx + x - g.x, ty: g.v.ty + y - g.y }, true); this.schedule(); }
      }
    }
    up(e) {
      if (!this.pts.has(e.pointerId)) return;
      const g = this.gesture, [x, y] = this.pts.get(e.pointerId);
      this.pts.delete(e.pointerId);
      if (this.pts.size === 0) {
        // 沒動的一下：兩下夠近、夠快就是點兩下
        if (g && g.mode === 'pan' && !g.moved) {
          const now = e.timeStamp, tp = this.tap;
          if (now - tp.t < DOUBLE_MS && Math.hypot(x - tp.x, y - tp.y) < 30 && this.canZoomAt(x, y)) { this.doubleTap(x, y); this.tap = { t: 0, x: 0, y: 0 }; this.suppress = true; }
          else this.tap = { t: now, x, y };
        }
        this.gesture = null;
        if (this.suppress) setTimeout(() => { this.suppress = false; }, 0);   // click 在 pointerup 之後才來：先擋掉，再放行下一次
      } else if (this.pts.size === 1) {
        // 兩指剩一指：接著當平移，從這一刻的位置算起
        const [px, py] = [...this.pts.values()][0];
        this.gesture = { mode: 'pan', x: px, y: py, v: { ...this.v }, moved: true, t: e.timeStamp };
      }
    }
    wheel(e) {
      e.preventDefault();
      const [x, y] = this.local(e);
      this.zoomTo(this.v.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), x, y);
    }
    // 框的大小變了（旋轉、面板展開）：比例照舊，位置重新套邊界
    resized() { this.set(this.v, true); this.emit(); }
    destroy() { this.enable(false); this.stop(); if (this.raf) cancelAnimationFrame(this.raf); }
  }
  // 長按辨識（2D 看線、定線唯一的長按來源，岩點貓與 RouteEditor 共用）：
  // 只決定「是不是長按」——單一主要指標、移動容差內、計時到、期間沒有第二根手指／放開／取消／失焦；一次按壓最多觸發一次。
  // accept(e)：這次按下要不要開始計時，回傳 context（任意值，原樣交給 onFire）或 falsy＝不計時；
  // onFire(ctx, e)：長按成立（同步呼叫，例外只吞掉不影響手勢；回傳值一律忽略，不接管 pointer）；e 是按下當時的 pointer 事件。
  // 觸發後 eatsClick() 在 clickMs 內回傳 true 一次（放開後緊接的 click 不算點選）；destroy() 解除全部監聽與計時。
  class LongPress {
    constructor(el, { accept, onFire, delay = 520, tolerance = 8, clickMs = 80, win } = {}) {
      Object.assign(this, { el, accept, onFire, delay, tolerance, clickMs });
      this.timer = 0; this.press = null; this.ptrs = new Set(); this.eat = false; this.eatT = 0; this.fired = 0;
      this.win = win || (el.ownerDocument && el.ownerDocument.defaultView) || null;
      this.h = { down: (e) => this.down(e), move: (e) => this.move(e), up: (e) => this.up(e), lost: (e) => this.up(e), blur: () => this.cancel(), ctx: (e) => { if (this.press || this.eat) e.preventDefault(); } };
      el.addEventListener('pointerdown', this.h.down); el.addEventListener('pointermove', this.h.move);
      el.addEventListener('pointerup', this.h.up); el.addEventListener('pointercancel', this.h.up); el.addEventListener('lostpointercapture', this.h.lost);
      el.addEventListener('contextmenu', this.h.ctx);
      if (this.win) this.win.addEventListener('blur', this.h.blur);
    }
    get pending() { return !!this.press; }
    cancel() { if (this.timer) clearTimeout(this.timer); this.timer = 0; this.press = null; }
    down(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) { this.cancel(); return; }
      if (e.isPrimary) this.ptrs.clear();   // 主要指標按下時其他指標都已離開：上一輪沒收到放開就清掉，不然永遠被當成多指
      this.ptrs.add(e.pointerId);
      if (this.ptrs.size > 1) { this.cancel(); return; }   // 第二根手指：縮放、平移，不是長按
      this.cancel();
      const ctx = this.accept ? this.accept(e) : true;
      if (!ctx) return;
      const press = this.press = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.timer = setTimeout(() => {
        if (this.press !== press) return;
        this.timer = 0; this.press = null; this.fired++;
        try { this.onFire(ctx, e); } catch (er) { /* hook 出錯不影響手勢 */ }
      }, this.delay);
    }
    move(e) { const p = this.press; if (p && e.pointerId === p.id && Math.hypot(e.clientX - p.x, e.clientY - p.y) > this.tolerance) this.cancel(); }
    up(e) {
      this.ptrs.delete(e.pointerId);
      if (this.press && e.pointerId === this.press.id) this.cancel();
    }
    // 長按剛處理過：接著來的 click 吃掉一次（clickMs 後失效，不擋下一次點選）；外層在處理了長按（不是只觀察）時呼叫 armClick()
    armClick() { this.eat = true; clearTimeout(this.eatT); this.eatT = setTimeout(() => { this.eat = false; }, this.clickMs); }
    eatsClick() { if (!this.eat) return false; this.eat = false; clearTimeout(this.eatT); return true; }
    destroy() {
      this.cancel(); clearTimeout(this.eatT); this.eat = false; this.ptrs.clear();
      const el = this.el, h = this.h;
      el.removeEventListener('pointerdown', h.down); el.removeEventListener('pointermove', h.move);
      el.removeEventListener('pointerup', h.up); el.removeEventListener('pointercancel', h.up); el.removeEventListener('lostpointercapture', h.lost);
      el.removeEventListener('contextmenu', h.ctx);
      if (this.win) this.win.removeEventListener('blur', h.blur);
    }
  }
  return { Viewport, LongPress, clampView, maxScaleOf, fitOf, zoomAround, ZOOM_STEPS: STEPS, MIN_SCALE, MAX_SCALE, DOUBLE_TAP, DOUBLE_MS };
});
