// AppKit landing：電腦版工具（Studio Crag）在手機打開時只有介紹頁，請使用者改用電腦打開（跟岩點貓在電腦只有介紹頁反過來，見 js/boot.js）。
// - 在 <head> 同步載入（CSP 不允許內嵌的程式），畫面出來前在 html 加 ak-phone，App 的畫面整個藏起來，只顯示 .ak-landing（樣式在 ui.css）
// - 手機上拿掉 manifest，瀏覽器不會提示安裝
// - 手機：有觸控、螢幕短邊小於 600（轉橫也一樣；手機的短邊都在 500 以下，iPad mini 是 744、折疊機的內螢幕約 700，都算平板、照常打開）；從主畫面打開的（裝好的 App）照常打開；本機（localhost、127.0.0.1）不判斷，加 ?phone 看；手機測試加 ?app 強制打開工具（記在 sessionStorage，同一分頁換頁也算）
// - 手機也能用的工具在 html 加 data-ak-phone="app"：不顯示介紹頁；手機（本機一樣不判斷，加 ?phone 看）在 html 加 ak-handset，頁面自己換手機版面、藏起手機不適合的功能
// - 介紹頁的內容寫在各 App 的 index.html；[data-ak-url] 顯示這頁的網址，[data-ak-copy] 按了複製網址（data-ak-copy 的值是複製後的提示）
// English: AppKit landing: desktop-only tools show an intro page on phones (touch + short screen edge < 600; tablets incl. iPad mini and foldable inner screens open the tool) asking to open on a computer.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.AppKit || (root.AppKit = {})).landing = factory().boot();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  /** 是不是手機：touch＝觸控點數，coarse＝主要指標是手指，w、h＝螢幕寬高 */
  function isPhone({ touch, coarse, w, h }) { return (touch > 0 || coarse) && Math.min(w, h) < 600; }
  /** 這頁的網址（拿掉 ?phone 等參數和 #） */
  const pageUrl = () => location.origin + location.pathname;

  function wire() {
    for (const e of document.querySelectorAll('[data-ak-url]')) e.textContent = pageUrl();
    for (const b of document.querySelectorAll('[data-ak-copy]')) b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(pageUrl()); } catch (e) { getSelection().selectAllChildren(document.querySelector('[data-ak-url]')); return; }   // 不能寫剪貼簿：選起來讓人自己複製
      if (globalThis.AppKit && AppKit.ui) AppKit.ui.toast(b.dataset.akCopy, { ms: 2500 });
    });
  }

  function boot() {
    const html = document.documentElement;
    try {
      const app = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
      const dev = /^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname);
      const force = /[?&]app\b/.test(location.search) || sessionStorage.getItem('climbio.akApp') === '1';
      if (force) sessionStorage.setItem('climbio.akApp', '1');
      const phone = isPhone({ touch: navigator.maxTouchPoints, coarse: matchMedia('(pointer: coarse)').matches, w: screen.width, h: screen.height });
      const handset = phone && !dev || /[?&]phone\b/.test(location.search);
      if (html.dataset.akPhone === 'app') { if (handset) html.classList.add('ak-handset'); }   // 手機也能用的工具：照常打開，頁面看 ak-handset 換手機版面
      else if (!app && !force && handset) {
        html.classList.add('ak-phone');
        document.querySelector('link[rel="manifest"]')?.remove();   // 手機用不了，就不要跳「安裝」
      }
    } catch (e) { /* 判斷不了就照一般的 App */ }
    document.addEventListener('DOMContentLoaded', wire);
    return api;
  }

  const api = { isPhone, boot };
  return api;
});
