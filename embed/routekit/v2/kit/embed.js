// Climbio 內嵌頁共用（所有有畫面的 Kit 一套）：訊息外框、來源檢查、原生 App 橋接、請求／回覆、自備資料網址、全畫面。
// 外層用 <iframe> 嵌入內嵌頁，或原生 App（iOS／Android／React Native／Flutter）的 WebView 直接開內嵌頁。
// 資料由外層自備（v2 init 的物件、照片，或 https 網址，見 resolveInitV2）；內嵌頁不帶 cookie、不記錄、不寫入任何後端。
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
  function connect({ kit, handlers, win = self, parent = win.parent, v = VERSION }) {   // v：訊息版本（預設 1；通用內嵌頁 v2 傳 2）
    const framed = !!parent && parent !== win;
    let pinned = null, started = false;
    const send = (type, data) => {
      const m = { climbio: kit, v, type, ...data };
      if (framed) {
        if (type !== 'ready' && pinned === null) return;
        parent.postMessage(m, pinned === null || pinned === 'null' ? '*' : pinned);
      } else if (type === 'ready' || started) {
        const b = bridgeOf(win);
        if (b) b(m);
      }
    };
    const valid = (m) => !!m && typeof m === 'object' && m.climbio === kit && m.v === v && typeof m.type === 'string';
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

  // ---- v2：能力宣告、請求／回覆（requestId、sessionId）、自備資料網址 ----
  const CAPS = ['holdEdit', 'refine', 'wallEdit'], MAX_WAIT = 60000;
  // init.capabilities：只收已知能力的字串陣列；沒宣告＝沒有（不發額外請求）
  function capsOf(list) {
    if (list === undefined) return new Set();
    if (!Array.isArray(list) || list.some((c) => !CAPS.includes(c))) throw new Error(`capabilities 只能是 ${CAPS.join('、')}`);
    return new Set(list);
  }
  // 請求管理：begin 送出請求並等回覆；settle 只接受「目前 session、還在等、requestId 對得上」的回覆，遲到、重複、換牆換線後的回覆一律忽略
  // 逾時有上限（MAX_WAIT）；newSession／cancelAll 清掉所有等待（換牆、換線、destroy）；每個請求帶 AbortSignal 給呼叫端用
  function createRequests({ send, timeoutMs = 15000, newId = () => Math.random().toString(36).slice(2, 12) }) {
    const pending = new Map(); let session = newId();
    const wait = Math.min(MAX_WAIT, Math.max(1, timeoutMs));
    const end = (id, how, val) => { const p = pending.get(id); if (!p) return false; pending.delete(id); clearTimeout(p.timer); how === 'ok' ? p.resolve(val) : p.reject(val); return true; };
    return {
      get sessionId() { return session; },
      get size() { return pending.size; },
      begin(type, payload = {}) {
        const requestId = newId(), ac = typeof AbortController === 'function' ? new AbortController() : null;
        return {
          requestId, signal: ac && ac.signal,
          result: new Promise((resolve, reject) => {
            const timer = setTimeout(() => { if (end(requestId, 'err', new Error('逾時'))) ac && ac.abort(); }, wait);
            pending.set(requestId, { resolve, reject, timer, ac, type });
            send(type, { ...payload, requestId, sessionId: session });
          }),
        };
      },
      // type：這個回覆是回哪一種請求（refineHold、holdEditCommit）；requestId 對得上但種類不符也忽略
      settle(m, type) {
        if (!m || m.sessionId !== session || typeof m.requestId !== 'string' || !pending.has(m.requestId)) return false;
        if (type !== undefined && pending.get(m.requestId).type !== type) return false;
        return m.error !== undefined ? end(m.requestId, 'err', new Error(String(m.error).slice(0, 200))) : end(m.requestId, 'ok', m.result);
      },
      cancel(requestId) { const p = pending.get(requestId); if (p && end(requestId, 'err', new Error('已取消'))) p.ac && p.ac.abort(); },
      cancelAll(why = '已取消') { for (const [id, p] of [...pending]) if (end(id, 'err', new Error(why))) p.ac && p.ac.abort(); },
      newSession() { this.cancelAll('換了牆或路線'); session = newId(); return session; },
    };
  }
  // v2 的自備資料網址：https（或 init 以外的同站相對網址 base）、沒有帳密；不收 http、javascript:、data:、blob: 等
  function urlV2(u, what, base) {
    let url;
    try { url = new URL(String(u), base); } catch (e) { throw new Error(`${what} 要是完整的網址（https://…）`); }
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`${what} 只收 https 網址（不可帶帳號密碼）`);
    return url.href;
  }
  // 讀自備資料：不帶 cookie、不送來源網址；重導後的最終網址也要符合規則；大小有上限（先看 content-length，再看實際讀到的）
  async function fetchV2(u, what, max, { f = typeof fetch === 'function' ? fetch : null, base } = {}) {
    if (!f) throw new Error('這個環境沒有 fetch');
    const href = urlV2(u, what, base);
    let res;
    try { res = await f(href, { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'follow', mode: 'cors' }); } catch (e) { throw new Error(`${what} 讀不到（網址不通或沒開 CORS）`); }
    if (res.url) urlV2(res.url, `${what} 重導後的網址`);
    if (!res.ok) throw new Error(`${what} 讀取失敗（HTTP ${res.status}）`);
    const len = Number(res.headers && res.headers.get && res.headers.get('content-length'));
    if (len && len > max) throw new Error(`${what} 太大（上限 ${Math.round(max / 1048576)} MB）`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > max) throw new Error(`${what} 太大（上限 ${Math.round(max / 1048576)} MB）`);
    return { buf, type: (res.headers && res.headers.get && res.headers.get('content-type')) || '' };
  }

  // v2 init 的資料，每一項只能用一種給法：
  //   畫面：view（公開格式 v2 的畫面物件）｜viewUrl；路線圖層：layers（物件陣列，可不給）｜layerUrls；
  //   照片：photo（Blob 或 ArrayBuffer，iframe 用）｜photoBase64＋photoType（image/jpeg｜png｜webp，原生 JSON 橋接用）｜photoUrl。
  // 網址只收 https（見 urlV2），相對網址以 base 補齊；內嵌的物件、照片都有大小上限；回傳 { view, layers, photo }（photo 是 Blob，之後 decodePhoto）
  const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const sizeOf = (o, what) => { let n; try { n = JSON.stringify(o).length; } catch (e) { throw new Error(`${what} 要是可轉成 JSON 的物件`); } if (n > MAX_JSON) throw new Error(`${what} 太大（上限 ${MAX_JSON / 1048576} MB）`); };
  async function resolveInitV2(m, { f, base } = {}) {
    const one = (names, what) => { const given = names.filter((k) => m[k] !== undefined); if (given.length !== 1) throw new Error(`init 的${what}要在 ${names.join('、')} 之中給一個`); return given[0]; };
    const vk = one(['view', 'viewUrl'], '畫面'), pk = one(['photo', 'photoBase64', 'photoUrl'], '照片');
    if (m.layers !== undefined && m.layerUrls !== undefined) throw new Error('init 的路線圖層要在 layers、layerUrls 之中給一個');
    const lk = m.layers !== undefined ? 'layers' : m.layerUrls !== undefined ? 'layerUrls' : null;
    if (lk && !Array.isArray(m[lk])) throw new Error(`${lk} 要是陣列`);
    if (lk && m[lk].length > 50) throw new Error(`${lk} 最多 50 個`);
    if (vk === 'view') { if (!m.view || typeof m.view !== 'object') throw new Error('view 要是物件'); sizeOf(m.view, 'view'); } else urlV2(m.viewUrl, 'viewUrl', base);
    if (lk === 'layers') m.layers.forEach((l, i) => { if (!l || typeof l !== 'object') throw new Error(`layers[${i}] 要是物件`); sizeOf(l, `layers[${i}]`); });
    if (lk === 'layerUrls') m.layerUrls.forEach((u, i) => urlV2(u, `layerUrls[${i}]`, base));
    if (pk === 'photoUrl') urlV2(m.photoUrl, 'photoUrl', base);
    const json = async (u, what) => { const { buf } = await fetchV2(u, what, MAX_JSON, { f, base }); try { return JSON.parse(new TextDecoder().decode(buf)); } catch (e) { throw new Error(`${what} 不是 JSON`); } };
    const photoOf = async () => {
      if (pk === 'photoUrl') { const { buf, type } = await fetchV2(m.photoUrl, 'photoUrl', MAX_PHOTO, { f, base }); return new Blob([buf], { type: type.split(';')[0] || undefined }); }
      if (pk === 'photoBase64') {
        if (!PHOTO_TYPES.includes(m.photoType)) throw new Error(`photoType 要是 ${PHOTO_TYPES.join('、')}`);
        if (typeof m.photoBase64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(m.photoBase64) || m.photoBase64.length > Math.ceil(MAX_PHOTO * 4 / 3) + 4) throw new Error('photoBase64 不是 base64，或照片超過 10 MB');
        const bin = typeof atob === 'function' ? atob(m.photoBase64) : Buffer.from(m.photoBase64, 'base64').toString('binary');
        return new Blob([Uint8Array.from(bin, (c) => c.charCodeAt(0))], { type: m.photoType });
      }
      if (m.photo instanceof ArrayBuffer) return new Blob([m.photo]);
      return m.photo;   // Blob：decodePhoto 檢查型別與大小
    };
    const [view, layers, photo] = await Promise.all([
      vk === 'view' ? m.view : json(m.viewUrl, 'viewUrl'),
      lk === 'layers' ? m.layers : lk === 'layerUrls' ? Promise.all(m.layerUrls.map((u, i) => json(u, `layerUrls[${i}]`).catch((e) => { if (m.layerOptional === true) return null; throw e; }))).then((l) => l.filter(Boolean)) : [],
      photoOf(),
    ]);
    return { view, layers, photo };
  }

  return { VERSION, CAPS, MAX_PHOTO, MAX_JSON, connect, native, decodePhoto, fullscreen, capsOf, createRequests, urlV2, fetchV2, resolveInitV2 };
});
