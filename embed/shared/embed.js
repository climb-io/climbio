// Climbio 內嵌頁共用（所有有畫面的 Kit 一套）：訊息外框、來源檢查、原生 App 橋接、官方資料網址、全畫面。
// 外層用 <iframe> 嵌入內嵌頁，或原生 App（iOS／Android／React Native／Flutter）的 WebView 直接開內嵌頁。
// 資料只有一種來源：Climbio 官方發佈的網址（Hugging Face 的 climbio/walls 與 climbio.app 的 /p/、/w/、/r/，見 docs/embed.md）；
// 外層用 init 給 viewUrl、photoUrl、layerUrls，內嵌頁只讀這幾個網址，不帶 cookie、不記錄、不寫入 Climbio 後端；不收別的網址，也不收訊息直接帶的資料。
// 訊息：{ climbio: '<kit>', v: 1, type, … }。內嵌頁載入後送 ready；外層回 init（第一個訊息必須是 init）。
// iframe：只處理父視窗的訊息，並且只收發第一個 init 的來源（外層導向別的網站後，不會收到資料）。
// 原生 WebView（沒有父視窗）：往原生橋接送（window.ReactNativeWebView、webkit.messageHandlers.climbio、ClimbioBridge、flutter_inappwebview），
// 原生端用 window.climbioReceive(訊息或 JSON 字串) 或 window.postMessage 傳進來。
// 瀏覽器用 <script> 載入，掛全域 ClimbioEmbed；Node 用 require。
// English: Shared helpers for Climbio embed pages: message envelope, origin pinning, native WebView bridge, official data URLs and fullscreen.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ClimbioEmbed = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const VERSION = 1, MAX_PHOTO = 10 * 1024 * 1024, MAX_JSON = 16 * 1024 * 1024;

  // 原生 App 的橋接：回傳 (訊息) => void，沒有就 null（橋接可能晚一點才注入，所以每次送的時候才找）
  function bridgeOf(win) {
    if (win.ReactNativeWebView && typeof win.ReactNativeWebView.postMessage === 'function') return (m) => win.ReactNativeWebView.postMessage(JSON.stringify(m));
    const mh = win.webkit && win.webkit.messageHandlers && win.webkit.messageHandlers.climbio;
    if (mh && typeof mh.postMessage === 'function') return (m) => mh.postMessage(m);
    if (win.ClimbioBridge && typeof win.ClimbioBridge.postMessage === 'function') return (m) => win.ClimbioBridge.postMessage(JSON.stringify(m));
    if (win.flutter_inappwebview && typeof win.flutter_inappwebview.callHandler === 'function') return (m) => win.flutter_inappwebview.callHandler('climbio', m);
    return null;
  }

  // 是不是在原生 App 的 WebView 裡直接開的（沒有父視窗、有橋接）：這種情況全畫面等動作交給原生端
  function native(win = self) { return !!win.parent && win.parent === win && !!bridgeOf(win); }

  // 連到父視窗（iframe）或原生橋接（WebView）。handlers：{ init(msg), setXxx(msg), … }（init 之外的訊息要先有 init 才會處理）；
  // 處理時丟出的錯誤送 error 給外層。回傳 { send(type, data), get origin() }；還沒有 init 之前除了 ready 都不送。
  function connect({ kit, handlers, win = self, parent = win.parent }) {
    const framed = !!parent && parent !== win;
    let pinned = null, started = false;
    const send = (type, data) => {
      const m = { climbio: kit, v: VERSION, type, ...data };
      if (framed) {
        if (type !== 'ready' && pinned === null) return;
        parent.postMessage(m, pinned === null || pinned === 'null' ? '*' : pinned);
      } else if (type === 'ready' || started) {
        const b = bridgeOf(win);
        if (b) b(m);
      }
    };
    const valid = (m) => !!m && typeof m === 'object' && m.climbio === kit && m.v === VERSION && typeof m.type === 'string';
    const handle = (m) => {
      if (!valid(m)) return;
      if (!started) { if (m.type !== 'init') return; started = true; }
      const h = Object.prototype.hasOwnProperty.call(handlers, m.type) ? handlers[m.type] : null;
      if (!h) return;
      Promise.resolve().then(() => h(m)).catch((err) => send('error', { message: String((err && err.message) || err) }));
    };
    const parse = (d) => { if (typeof d !== 'string') return d; try { return JSON.parse(d); } catch (e) { return null; } };
    win.addEventListener('message', (e) => {
      if (framed) {
        if (e.source !== parent || !valid(e.data)) return;
        if (pinned === null) { if (e.data.type !== 'init') return; pinned = e.origin; }
        else if (e.origin !== pinned) return;
        handle(e.data);
      } else if (e.source === win) handle(parse(e.data));   // 原生端用 window.postMessage 傳進來
    });
    if (!framed) win.climbioReceive = (m) => handle(parse(m));
    send('ready');
    return { send, get origin() { return pinned; } };
  }

  // 照片：Blob（只當圖片解碼，最大 10 MB）→ 可以畫的圖
  async function decodePhoto(photo) {
    if (typeof Blob !== 'function' || !(photo instanceof Blob)) throw new Error('photo 要是 Blob');
    if (photo.size > MAX_PHOTO) throw new Error('照片超過 10 MB');
    try { return await createImageBitmap(photo); } catch (e) { throw new Error('照片不是可解碼的圖片'); }
  }

  // ---- 資料只從官方網址讀（外層在 init 給的 viewUrl、layerUrls、photoUrl）----
  // 官方網址：https 的 climbio.app（/p/ 牆的畫面、/w/ 公開牆與路線、/r/ 單條路線）或 huggingface.co 的 climbio/walls 資料集（照片、發佈檔）；
  // 不帶 cookie、不送來源網址；大小有上限。
  const OFFICIAL = 'Climbio 官方的網址（https://climbio.app/p/、/w/、/r/，或 Hugging Face 的 climbio/walls）';
  function dataUrl(u, what) {
    let url;
    try { url = new URL(String(u)); } catch (e) { throw new Error(`${what} 要是完整的網址（https://…）`); }
    const ok = url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ((url.hostname === 'climbio.app' && /^\/(p|w|r)\//.test(url.pathname))
        || (url.hostname === 'huggingface.co' && url.pathname.startsWith('/datasets/climbio/walls/')));
    if (!ok) throw new Error(`${what} 只收${OFFICIAL}`);
    return url.href;
  }
  async function fetchData(u, what, max, f = typeof fetch === 'function' ? fetch : null) {
    if (!f) throw new Error('這個環境沒有 fetch');
    const href = dataUrl(u, what);
    let res;
    try { res = await f(href, { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'follow' }); } catch (e) { throw new Error(`${what} 讀不到（網址不通）`); }
    if (!res.ok) throw new Error(`${what} 讀取失敗（HTTP ${res.status}）`);
    const len = Number(res.headers && res.headers.get && res.headers.get('content-length'));
    if (len && len > max) throw new Error(`${what} 太大（上限 ${Math.round(max / 1048576)} MB）`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > max) throw new Error(`${what} 太大（上限 ${Math.round(max / 1048576)} MB）`);
    return { buf, type: (res.headers && res.headers.get && res.headers.get('content-type')) || '' };
  }
  async function fetchJson(u, what, f) {
    const { buf } = await fetchData(u, what, MAX_JSON, f);
    try { return JSON.parse(new TextDecoder().decode(buf)); } catch (e) { throw new Error(`${what} 不是 JSON`); }
  }
  // init 可以只給 wallId（"<包 id>/<牆 id>"）：畫面、照片、整面牆的路線圖層（牆還沒有路線就沒有）的網址由這裡補；明確給的 viewUrl、photoUrl、layerUrls 優先。
  // 畫面和照片直接讀資料集：先讀 walls/<包 id>/current.json 知道現行版，再讀那一版的檔案；讀不到指標檔（還沒補寫）才走 climbio.app/p/（雲端函式查現行版再導向）
  async function expandInit(m, f = typeof fetch === 'function' ? fetch : null) {
    if (m.wallId === undefined) return m;
    if (typeof m.wallId !== 'string' || !/^[0-9a-f]{16}\/[0-9a-z]{8,40}$/.test(m.wallId)) throw new Error('wallId 要是 "包 id/牆 id"');
    const [pack, wall] = m.wallId.split('/'), viaP = { viewUrl: `https://climbio.app/p/${m.wallId}.json`, photoUrl: `https://climbio.app/p/${m.wallId}.jpg` };
    let urls = viaP;
    if (m.viewUrl === undefined || m.photoUrl === undefined) {
      try {
        const v = (await fetchJson(`https://huggingface.co/datasets/climbio/walls/resolve/main/walls/${pack}/current.json`, 'current.json', f)).version;
        if (Number.isInteger(v) && v > 0) { const dir = `https://huggingface.co/datasets/climbio/walls/resolve/main/walls/${pack}/v${v}/${wall}`; urls = { viewUrl: `${dir}.json`, photoUrl: `${dir}.jpg` }; }
      } catch (e) { /* 沒有指標檔：走 /p/ */ }
    }
    return { ...urls, viewHref: viaP.viewUrl, ...(m.layerUrls === undefined ? { layerUrls: [`https://climbio.app/w/${wall}/routes.json`], layerOptional: true } : {}), ...m };
  }
  // init 的資料：viewUrl、photoUrl（或 wallId）必給，layerUrls（路線圖層的網址陣列）選給。回傳 { view, layers, photo }（photo 是 Blob，還要用 decodePhoto 解碼）
  async function resolveInit(m, f) {
    m = await expandInit(m, f);
    if (m.viewUrl === undefined) throw new Error('init 要給 wallId，或 viewUrl 和 photoUrl');
    if (m.photoUrl === undefined) throw new Error('init 要給 photoUrl');
    if (m.layerUrls !== undefined && !Array.isArray(m.layerUrls)) throw new Error('layerUrls 要是網址的陣列');
    dataUrl(m.viewUrl, 'viewUrl'); dataUrl(m.photoUrl, 'photoUrl'); (m.layerUrls || []).forEach((u, i) => dataUrl(u, `layerUrls[${i}]`));   // 有一個不是官方網址就整個不讀
    const [view, layers, photo] = await Promise.all([
      fetchJson(m.viewUrl, 'viewUrl', f),
      Promise.all((m.layerUrls || []).map((u, i) => fetchJson(u, `layerUrls[${i}]`, f).catch((e) => { if (m.layerOptional) return null; throw e; }))).then((l) => l.filter(Boolean)),
      fetchData(m.photoUrl, 'photoUrl', MAX_PHOTO, f).then(({ buf, type }) => new Blob([buf], { type: type.split(';')[0] || undefined })),
    ]);
    return { view, layers, photo };
  }

  // 全畫面：iframe 有 allow="fullscreen" 就用瀏覽器的全畫面；沒有（或在原生 WebView：host() 回傳 true）就送 fullscreen { on } 給外層，由外層把 iframe 放大
  // 外層放大（或縮回）之後要送 setFullscreen { on } 回來；0.7 秒內沒回應就當外層不會處理，照原地互動（畫面還在原來的框裡）。
  // 回傳 { toggle(), set(on), get on() }；onChange(on) 在狀態變了時呼叫
  function fullscreen({ el, send, onChange = () => {}, host = () => false, doc = typeof document === 'object' ? document : null }) {
    let on = false, timer = 0;
    const set = (v) => { clearTimeout(timer); v = !!v; if (v !== on) { on = v; onChange(on); } };
    const canFullscreen = () => !!(doc && doc.fullscreenEnabled && el.requestFullscreen);   // 瀏覽器本身能不能全畫面
    if (doc) doc.addEventListener('fullscreenchange', () => set(!!doc.fullscreenElement));
    return {
      get on() { return on; },
      set,
      toggle() {
        if (!host() && canFullscreen()) {
          const p = on ? doc.exitFullscreen() : el.requestFullscreen();
          return Promise.resolve(p).catch(() => { const want = !on; send('fullscreen', { on: want }); clearTimeout(timer); timer = setTimeout(() => set(want), 700); });   // 被拒絕就請外層處理
        }
        const want = !on;
        send('fullscreen', { on: want });
        clearTimeout(timer); timer = setTimeout(() => set(want), 700);
        return Promise.resolve();
      },
    };
  }

  return { VERSION, MAX_PHOTO, MAX_JSON, connect, native, decodePhoto, dataUrl, fetchData, fetchJson, expandInit, resolveInit, fullscreen };
});
