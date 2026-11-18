// RouteKit viewer：給其他 App 直接用的看路線（RouteViewer）和定線（RouteEditor）元件，畫在一個 <canvas> 上。
// 只做最基本的：照畫布大小取景、點岩點；縮放、拖曳、轉場由 App 自己做（App 的畫面也可以直接用同一套繪製函式）。
// English: RouteKit viewer: ready-made RouteViewer and RouteEditor components drawn on a canvas.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./geometry.js'), require('./labels.js'), require('./image.js'), require('./editor.js'));
  else Object.assign(root.RouteKit || (root.RouteKit = {}), factory(root.RouteKit, root.RouteKit, root.RouteKit, root.RouteKit));
})(typeof self !== 'undefined' ? self : this, function (G, L, I, E) {
  'use strict';
  // 畫布的大小跟著顯示大小（裝置像素），回傳照片座標 → 畫布的轉換；box＝要放進畫布的照片範圍
  function fitCanvas(canvas, box) {
    const dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1;
    const W = Math.max(1, Math.round(canvas.clientWidth * dpr)), H = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const k = Math.min(W / box.w, H / box.h);
    return { k, tx: (W - box.w * k) / 2 - box.x * k, ty: (H - box.h * k) / 2 - box.y * k };
  }
  class View {
    // scene：RouteScene；route：路線（holds、seq、shapes）；theme：顏色、字型、S／T 的字
    constructor(canvas, { scene, route, theme } = {}) {
      Object.assign(this, { canvas, scene, route, theme });
      this.ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.render()) : null;
      if (this.ro) this.ro.observe(canvas);
    }
    get routeHolds() { return I.routeHolds(this.route, this.scene.holds); }
    setRoute(route) { this.route = route; this.render(); }
    destroy() { if (this.ro) this.ro.disconnect(); }
  }
  // 看路線：路線圖（灰階底、路線岩點原色、膠帶、出手順序），以路線為中心取景
  class RouteViewer extends View {
    constructor(canvas, opts) { super(canvas, opts); this.mode = opts.mode || 'gray'; this.render(); }
    render() {
      const { canvas, scene } = this, hs = this.routeHolds;
      const t = fitCanvas(canvas, I.cropAround(hs, scene.w, scene.h, canvas.clientWidth / Math.max(1, canvas.clientHeight)));
      const g = canvas.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height);
      g.setTransform(t.k, 0, 0, t.k, t.tx, t.ty);
      I.drawRoute(g, scene, this.route, hs, { unit: Math.max(scene.w, scene.h) / 1000, mode: this.mode, hands: true, theme: this.theme });
    }
  }
  // 定線：整張照片（暗彩底，路線岩點原色、類型外框），點岩點用 type（s／h／f／t，或 n＝出手順序）加進路線、改類型、拿掉。
  // 改了就呼叫 onChange(route)；route 直接修改（要保留原本的先自己複製一份）
  class RouteEditor extends View {
    constructor(canvas, opts) {
      super(canvas, opts);
      this.type = opts.type || 's';
      this.onChange = opts.onChange || (() => {});
      this.tapAt = { id: null, t: 0 };
      this.onTap = (e) => this.tap(e);
      canvas.addEventListener('click', this.onTap);
      this.render();
    }
    setType(type) { this.type = type; }
    destroy() { super.destroy(); this.canvas.removeEventListener('click', this.onTap); }
    render() {
      const { canvas, scene, route } = this, hs = this.routeHolds;
      this.t = fitCanvas(canvas, { x: 0, y: 0, w: scene.w, h: scene.h });
      const g = canvas.getContext('2d'), k = this.t.k;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height);
      g.setTransform(k, 0, 0, k, this.t.tx, this.t.ty);
      scene.drawBase(g, hs, { mode: 'dim', tint: false });
      g.lineJoin = 'round';
      const px = (s) => s / k * ((typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);   // 螢幕像素 → 照片像素
      for (const h of hs) L.strokeRouteHold(g, h.poly, route.holds[h.id], (s) => px(s * 0.65), this.theme);
      L.drawSeq(g, scene, route, Math.max(scene.w, scene.h) / 1000, [], hs, this.theme);
    }
    tap(e) {
      const r = this.canvas.getBoundingClientRect(), dpr = this.canvas.width / Math.max(1, r.width);
      const x = ((e.clientX - r.left) * dpr - this.t.tx) / this.t.k, y = ((e.clientY - r.top) * dpr - this.t.ty) / this.t.k;
      const hit = G.holdAt(this.scene.holds.concat(Object.values(this.route.shapes || {})), x, y);
      if (!hit) return;
      if (this.type === 'n') E.appendSeq(this.route, hit.id);
      else {
        const now = Date.now(), res = E.tapHold(this.route, hit.id, this.type, { justAdded: this.tapAt.id === hit.id && now - this.tapAt.t < 400 });
        if (res === 'ignored' || res === 'full') return;
        if (res !== 'removed') this.tapAt = { id: hit.id, t: now };
      }
      this.render();
      this.onChange(this.route);
    }
  }
  return { RouteViewer, RouteEditor };
});
