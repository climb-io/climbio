// RouteKit scene：一張照片＋牆上的岩點，和跟著它的快取（共用的底、路線圖層、標籤位置）。
// 瀏覽器用 <script> 依序載入，掛在全域 RouteKit；Node 用 require。不依賴任何 App 的狀態，資料都從參數傳入。
// English: RouteKit scene: a photo plus its holds and the caches that go with it.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./base.js'), require('./labels.js'));
  else Object.assign(root.RouteKit || (root.RouteKit = {}), factory(root.RouteKit, root.RouteKit));
})(typeof self !== 'undefined' ? self : this, function (B, L) {
  'use strict';
  // 版本號跨 scene 不重複：同一面牆關掉再打開（新的 scene）也不會拿到舊的快取鍵
  let nextVersion = 1;
  const pause = () => new Promise(r => setTimeout(r, 0));
  // img：照片（img 或 canvas，原尺寸）；holds：牆上所有岩點 [{ id, poly }]，或回傳它的函式（岩點陣列會被換掉時用）
  class RouteScene {
    constructor(img, holds) {
      this.img = img; this.w = img.width; this.h = img.height;
      this.holds = holds;
      this.version = nextVersion++;
      this._plain = this._muted = null;
      this.layers = new Map();    // 路線岩點的原色圖層（只有路線範圍那麼大），留最近 3 條（目前這條和左右兩條）
      this.labelCache = new Map();
    }
    get holds() { return typeof this._holds === 'function' ? this._holds() : this._holds; }
    set holds(v) { this._holds = v; }
    // 共用的底：gray＝灰階壓亮度再上一層冷灰、dim＝暗彩。照片大小，整面牆一張，每條路線、小卡都用它；第一次用到才算
    plain(mode = 'gray') {
      if (mode === 'dim') return this._muted || (this._muted = B.mutedOf(this.img));
      return this._plain || (this._plain = B.plainGrayOf(this.img));
    }
    get muted() { return this.plain('dim'); }
    // 岩點外框改了（拖頂點、重描、補點、刪點）：路線圖層、標籤位置之後重算
    touch() { this.version = nextVersion++; }
    // 放掉照片大小的畫布（共用的底，每張幾十 MB），手機的畫布記憶體才不會被吃滿；用到時再算
    release() {
      this._plain = this._muted = this._deep = null;
      this.layers.clear();
    }
    // 系統清掉了畫布內容（iOS 放到背景）：路線圖層之後重畫，暗彩被清掉的下次用到再算；lost(canvas)：這張畫布是不是被清掉了。
    // 回傳灰階底是不是也被清掉（要從照片重建一個 scene）
    recover(lost) {
      this.layers.clear();
      if (this._muted && lost(this._muted)) this._muted = null;
      return !!this._plain && lost(this._plain);
    }
    // 路線岩點的原色圖層（見 base.js 的 routeLayer）：同樣的岩點、外框沒改過就直接拿
    routeLayer(routeHolds, { tint = true } = {}) {
      const key = `${this.version}|${this.holds.length}|${tint}|${routeHolds.map(h => h.id).join(',')}`;
      let v = this.layers.get(key);
      if (v === undefined) v = B.routeLayer(this.img, routeHolds, this.holds, { tint });
      this.layers.delete(key); this.layers.set(key, v);
      if (this.layers.size > 3) this.layers.delete(this.layers.keys().next().value);
      return v;
    }
    // 畫路線圖的底（共用的底＋路線岩點的原色圖層），見 base.js 的 drawRouteBase
    drawBase(c, routeHolds, opts) { B.drawRouteBase(c, this, routeHolds, opts); }
    // 標籤位置（typeLabels）算一次就記住：同樣的岩點、類型和大小直接拿來用，重畫、左右滑都不用重算
    labels(routeHolds, r, unit, hands = false, theme) {
      const key = [this.version, this.holds.length, unit.toFixed(3), hands, routeHolds.map(h => `${h.id}:${r.holds[h.id]}`).join(',')].join('|');
      let v = this.labelCache.get(key);
      if (!v) {
        v = L.typeLabels(this, routeHolds, r, unit, hands, theme);
        this.labelCache.set(key, v);
        if (this.labelCache.size > 60) this.labelCache.delete(this.labelCache.keys().next().value);
      }
      return v;
    }
    // 閒下來時先畫好接下來可能看的路線（路線圖層、標籤），切換時直接拿來用；每畫一條就讓出來，alive() 回 false 就停。
    // jobs：[{ routeHolds, r, unit, mode, tint, hands }]
    async prefetch(jobs, alive = () => true) {
      for (const j of jobs) {
        if (!alive()) return;
        if (!j.routeHolds.length) continue;
        this.plain(j.mode); this.routeLayer(j.routeHolds, { tint: j.tint });
        this.labels(j.routeHolds, j.r, j.unit, j.hands);
        await pause();
      }
    }
  }
  const scene = (img, holds) => new RouteScene(img, holds);
  return { RouteScene, scene };
});
