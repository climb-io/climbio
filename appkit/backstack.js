// AppKit backstack：蓋在畫面上的對話框、彈窗的返回紀錄（岩點貓、紅點貓共用）。
// 開著時多一層 history，返回（Android 返回鍵、iPhone 邊緣滑動）只關最上面那個，底下的畫面不動（不然在首頁按返回會直接離開 App）。
// - open(id, onBack, state)：開一層；onBack＝被返回關掉時做的事（藏起來、回傳取消）；state＝這一層 history 的 state
// - close(id)：自己關（按鈕、點外面）時用：退掉那一層（連同疊在上面的），等退完才 resolve，接著要開新畫面的放在 then 裡（不然新推的一層會被這次的返回退掉）
// - handle()：App 的 popstate 先問這裡：是 close 自己退的、或返回關掉最上面的對話框，回傳 true，不再當成換頁
// AppKit.ui.configure({ backStack: { open, close } }) 接上，AppKit 的對話框就會跟著這套走。
// English: AppKit backstack: one history entry per open overlay so back closes only the top overlay.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.AppKit || (root.AppKit = {})).backstack = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const overlays = [];
  let skip = 0;

  function open(id, onBack, state = { s: 'dlg' }) {
    if (overlays.some(o => o.id === id)) return;
    overlays.push({ id, onBack });
    history.pushState(state, '');
  }
  function close(id) {
    const i = overlays.findIndex(o => o.id === id);
    if (i < 0) return Promise.resolve();
    const k = overlays.length - i;
    overlays.splice(i); skip++;
    return new Promise(res => { addEventListener('popstate', () => setTimeout(res, 0), { once: true }); history.go(-k); });
  }
  function handle() {
    if (skip) { skip--; return true; }
    const o = overlays.pop();
    if (!o) return false;
    o.onBack();
    return true;
  }
  return { open, close, handle, get depth() { return overlays.length; } };
});
