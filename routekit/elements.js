// RouteKit elements：<routekit-viewer>、<routekit-editor> 兩個 Web Component，包住 RouteViewer／RouteEditor，React、Vue、純 HTML 都能直接放。
// 資料用屬性（property）給：photo（載好的 <img> 或 canvas）、holds（牆上的岩點）、route（路線）、theme；
// 或用 src 屬性（attribute）給路線圖層的網址（圖層有好幾條路線時，route-id 指定哪一條，沒有就第一條；loadLayer(網址) 一次拿到全部路線）（Climbio 公開格式 v2，例如分享連結的 route.json；https 或同一個網站），
// 圖層指到的牆（照片畫面）、照片一起讀進來，讀好發 load 事件。
// <routekit-viewer mode="dim">：路線圖的底（gray 灰階、dim 暗彩）。<routekit-editor type="h">：點岩點用的類型，改了路線發 change 事件（detail＝路線）。
// 伺服器端（Node、Next.js 的 SSR）沒有 HTMLElement，載入時什麼都不做。
// English: RouteKit elements: <routekit-viewer> and <routekit-editor> Web Components wrapping RouteViewer / RouteEditor.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./scene.js'), require('./viewer.js'), require('./format.js'));
  else Object.assign(root.RouteKit || (root.RouteKit = {}), factory(root.RouteKit, root.RouteKit, root.RouteKit));
})(typeof self !== 'undefined' ? self : this, function (S, V, F) {
  'use strict';
  if (typeof HTMLElement === 'undefined' || typeof customElements === 'undefined') return {};
  const loadImage = (src) => new Promise((ok, bad) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => ok(img); img.onerror = () => bad(new Error(`photo failed to load: ${src}`));
    img.src = src;
  });
  // 只收 https 或同一個網站
  async function getJson(url) {
    if (url.protocol !== 'https:' && url.origin !== location.origin) throw new Error(`must be https: ${url.href}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url.href}`);
    return res.json();
  }
  // 路線圖層的網址 → { photo, holds, routes }（圖層裡全部的路線）；圖層的 href、牆的 href 照各自的網址解析（相對路徑可以）
  async function loadLayer(src) {
    const url = new URL(src, location.href), layer = await getJson(url);
    if (layer.climbio !== 2 || layer.kind !== 'layer' || !layer.href) throw new Error('not a Climbio v2 route layer');
    const viewUrl = new URL(layer.href, url), view = await getJson(viewUrl);
    if (view.climbio !== 2 || view.kind !== 'view' || view.surface !== 'photo' || view.id !== layer.on) throw new Error('not the wall of this layer');
    const d = F.fromFormat(view, [layer]);
    if (!d.routes.length) throw new Error('no route in this layer');
    return { photo: await loadImage(new URL(view.href, viewUrl).href), holds: d.holds, routes: d.routes };
  }
  // 圖層的網址（加 route-id 就是指定那一條，沒有就第一條）→ { photo, holds, route }
  async function loadRoute(src, routeId) {
    const { photo, holds, routes } = await loadLayer(src), route = routeId ? routes.find((r) => r.id === routeId) : routes[0];
    if (!route) throw new Error(`no route ${routeId} in this layer`);
    return { photo, holds, route };
  }
  class RouteKitElement extends HTMLElement {
    static get observedAttributes() { return ['src', 'route-id']; }
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML = '<style>:host{display:block;height:300px}canvas{display:block;width:100%;height:100%;touch-action:manipulation}</style><canvas part="canvas"></canvas>';
      this.canvas = this.shadowRoot.querySelector('canvas');
      this.data = { photo: null, holds: [], route: null, theme: undefined };
      this.scene = this.view = null;
    }
    get photo() { return this.data.photo; }
    set photo(v) { this.data.photo = v; this.scene = null; this.update(); }
    get holds() { return this.data.holds; }
    set holds(v) { this.data.holds = v || []; this.scene = null; this.update(); }
    get route() { return this.data.route; }
    set route(v) { this.data.route = v; this.update(); }
    get theme() { return this.data.theme; }
    set theme(v) { this.data.theme = v; this.drop(); this.update(); }
    attributeChangedCallback(name, old, v) {
      if ((name !== 'src' && name !== 'route-id') || v === old) return;
      const src = this.getAttribute('src'), id = this.getAttribute('route-id');
      if (!src) return;
      loadRoute(src, id).then((d) => {
        if (this.getAttribute('src') !== src || this.getAttribute('route-id') !== id) return;   // 讀的時候又換了網址或路線
        Object.assign(this.data, d); this.scene = null; this.update();
        this.dispatchEvent(new Event('load'));
      }, (error) => this.dispatchEvent(new ErrorEvent('error', { error, message: error.message })));
    }
    connectedCallback() { this.update(); }
    disconnectedCallback() { this.drop(); }
    drop() { if (this.view) this.view.destroy(); this.view = null; }
    update() {
      const { photo, holds, route, theme } = this.data;
      if (!this.isConnected || !photo || !route) return;
      if (!this.scene) { this.scene = S.scene(photo, holds); this.drop(); }
      if (this.view) this.view.setRoute(route);
      else this.view = this.create({ scene: this.scene, route, theme });
    }
  }
  class RouteKitViewer extends RouteKitElement {
    static get observedAttributes() { return ['src', 'route-id', 'mode', 'segment']; }
    attributeChangedCallback(name, old, v) {
      if (name === 'mode') { this.drop(); this.update(); }
      else if (name === 'segment') { if (this.view && this.view.setSegmented) this.view.setSegmented(this.hasAttribute('segment')); }
      else super.attributeChangedCallback(name, old, v);
    }
    create(opts) { return new V.RouteViewer(this.canvas, { ...opts, mode: this.getAttribute('mode') || 'gray', segment: this.hasAttribute('segment') }); }
  }
  class RouteKitEditor extends RouteKitElement {
    static get observedAttributes() { return ['src', 'route-id', 'type']; }
    attributeChangedCallback(name, old, v) {
      if (name === 'type') { if (this.view) this.view.setType(v || 's'); } else super.attributeChangedCallback(name, old, v);
    }
    create(opts) {
      return new V.RouteEditor(this.canvas, { ...opts, type: this.getAttribute('type') || 's',
        onChange: (route) => this.dispatchEvent(new CustomEvent('change', { detail: route })) });
    }
  }
  if (!customElements.get('routekit-viewer')) customElements.define('routekit-viewer', RouteKitViewer);
  if (!customElements.get('routekit-editor')) customElements.define('routekit-editor', RouteKitEditor);
  return { RouteKitViewer, RouteKitEditor, loadRoute, loadLayer };
});
