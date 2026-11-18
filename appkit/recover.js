// AppKit recover：載入失敗時自動修復。部署後舊的 Service Worker／快取還在提供舊檔，新舊混在一起、檔案 404 時，
// 解除 Service Worker、清掉 App 的快取（不清大型模型快取）再重新整理一次，使用者不用手動清資料。
// 10 分鐘內只做一次，避免真的壞掉時無限重新整理。在 <head> 同步載入，所有網站都開（不像 errors.js 只在測試版）。
// 開機看門狗（頁面在 script 標籤加 data-boot 才開，例如紅點貓）：快取優先的 App 一旦存到壞掉的主程式，
// 更新提示也在主程式裡出不來，重新整理也只是再跑一次壞的版本。所以開機完成前：
// - 自家網域腳本的任何錯誤（下載失敗、語法錯誤、執行例外）都算開機失敗
// - 主程式啟動完成要呼叫 akBooted()；頁面載入後 data-boot 毫秒內沒呼叫，也算開機失敗
// - 開機失敗：有等待中的新版 Service Worker 就叫它接手（SKIP_WAITING），接手後重新整理；
//   沒有就解除 Service Worker、刪掉 data-cache 開頭的快取再重新整理。只清快取，不動 IndexedDB（收藏、紀錄在那裡）
// English: AppKit recover: on a failed script load (or, with data-boot, any own-script error / missing boot heartbeat), activate a waiting worker or clear caches and reload once.
(function (root) {
  'use strict';
  if (!root.document || !navigator.serviceWorker) return;
  const KEY = 'ak-recover', GAP = 10 * 60 * 1000;
  const tag = document.currentScript, bootMs = +(tag?.dataset.boot || 0), cachePrefix = tag?.dataset.cache || '';
  let running = false, booted = !bootMs;
  const clearAndReload = async () => {
    try {
      await Promise.all((await navigator.serviceWorker.getRegistrations()).map(r => r.unregister()));
      if (root.caches) await Promise.all((await caches.keys()).filter(k => cachePrefix ? k.startsWith(cachePrefix) : !/models/.test(k)).map(k => caches.delete(k)));
    } catch (e) { /* 清不掉也照樣重新整理一次 */ }
    location.reload();
  };
  async function recover() {
    if (running || navigator.onLine === false) return;
    try { const last = +sessionStorage.getItem(KEY) || 0; if (Date.now() - last < GAP) return; sessionStorage.setItem(KEY, String(Date.now())); } catch (e) { return; }
    running = true;
    if (bootMs) {   // 先試等待中的新版：它就是修好的那版，叫它接手就好，不用整個清掉重下載
      const waiting = await navigator.serviceWorker.getRegistration().then(r => r?.waiting, () => null);
      if (waiting) {
        navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
        waiting.postMessage('SKIP_WAITING');
        setTimeout(clearAndReload, 4000);   // 4 秒內沒接手就改成清快取
        return;
      }
    }
    clearAndReload();
  }
  const sameOrigin = (u) => { try { return new URL(u, location.href).origin === location.origin; } catch (e) { return false; } };
  root.akBooted = () => { booted = true; };
  root.addEventListener('unhandledrejection', (e) => {
    if (/dynamically imported module|Importing a module script failed|error loading dynamically imported/i.test(String(e.reason?.message || e.reason || ''))) recover();
    else if (!booted) recover();
  });
  // 必要的靜態腳本載入失敗才修復；非同步下載的選用功能由載入者處理與重試。
  // 資源事件不冒泡，要用捕獲。開機看門狗開著時，開機完成前自家腳本的語法、執行錯誤（ErrorEvent，帶檔名）也修復
  root.addEventListener('error', (e) => {
    const t = e.target;
    if (t && t.tagName === 'SCRIPT' && t.src && !t.async && sameOrigin(t.src)) recover();
    else if (!booted && e.filename && sameOrigin(e.filename)) recover();
  }, true);
  if (bootMs) root.addEventListener('load', () => setTimeout(() => { if (!booted) recover(); }, bootMs));
})(typeof self !== 'undefined' ? self : this);
