// AppKit errors：測試版的錯誤回報。只在測試版網站（開發版、Eric 的站、它們的預覽頻道）開，都是內部在用；正式版、本機、自架的站不送。
// 沒接住的錯誤（error、unhandledrejection）和 console.error 帶的 Error 送到雲端函式 clientError（functions/client-errors.js），
// 在 Google Cloud 主控台的 Error Reporting 看（同樣的錯誤歸成一組）。只送錯誤訊息、出錯的位置、App、頁面路徑（不含 # 和 ?）、版本、瀏覽器；
// 同一個錯誤一頁只送一次，一頁最多 10 筆。在 <head> 同步載入，越早越好。
// English: AppKit errors: on internal test sites only, report uncaught errors to the clientError function (Google Cloud Error Reporting).
(function (root) {
  'use strict';
  const ENDPOINT = 'https://asia-east1-firebase-climbio.cloudfunctions.net/clientError';
  if (!/^climbio-(dev|eric)(--[a-z0-9-]+)?\.web\.app$/.test(location.hostname) || !navigator.sendBeacon) return;
  const app = location.pathname.split('/')[1] || 'home', seen = new Set();
  let left = 10;
  function send(kind, err, file, line) {
    try {
      const msg = String(err?.message || err || '').slice(0, 500), stack = String(err?.stack || '').slice(0, 4000);
      const key = `${msg}|${file || ''}|${line || ''}`;
      if (!left || (!msg && !stack) || seen.has(key)) return;
      seen.add(key); left--;
      const v = String(root.CLIMBIO_VERSION || document.querySelector('meta[name="app-version"]')?.content || '').replace(/^climbio-/, '');
      const body = { app, v, page: location.pathname, kind, msg, stack, file, line, ua: navigator.userAgent };
      navigator.sendBeacon(ENDPOINT, new Blob([JSON.stringify(body)], { type: 'text/plain' }));   // text/plain：不用 CORS 預檢，關分頁也送得出去
    } catch (e) { /* 回報失敗不影響 App */ }
  }
  root.addEventListener('error', (e) => { if (e.error || e.message) send('error', e.error || e.message, e.filename, e.lineno); });
  root.addEventListener('unhandledrejection', (e) => send('unhandledrejection', e.reason));
  // App 自己接住、只印出來的錯誤（console.error('同步', err)）也送：測試時最常被吞掉的就是這種
  const orig = console.error;
  console.error = function (...a) {
    const err = a.find(x => x instanceof Error);
    if (err) send('console', Object.assign(new Error(`${a.filter(x => typeof x === 'string').join(' ')} ${err.message}`.trim()), { stack: err.stack }));
    return orig.apply(this, a);
  };
})(typeof self !== 'undefined' ? self : this);
