// AppKit install：加到主畫面。判斷平台、攔下 Android Chrome 的安裝事件、記住「裝過」「按掉了」；畫面由 App 自己畫。
// - Android 的 Chrome 只有還沒裝、可以裝時才發出 beforeinstallprompt：攔下來，prompt() 跳原生安裝；沒有這個事件＝已經裝了（或裝不了）
// - iPhone、iPad 只能手動：分享 → 加入主畫面 → 右上角「新增」
// - LINE、Messenger、IG 等 App 的內建瀏覽器裝不了：請改用 Safari／Chrome 打開（Android 可以用 intent 交給系統）
// - 從主畫面打開的（standalone）、裝好過、按過 × 的，不再出現；記在這台的 localStorage（Android 的 App 跟 Chrome 共用資料）
// English: AppKit install: add-to-home-screen state (platform, deferred install prompt, installed/dismissed flags). Apps draw their own UI.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.AppKit || (root.AppKit = {})).install = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  /** 這個瀏覽器的平台：ios（iPadOS 用 Mac 的 UA，用觸控點分辨）、android、inApp（App 內建的瀏覽器）、standalone（從主畫面打開） */
  function platform(ua = navigator.userAgent, touch = navigator.maxTouchPoints) {
    return {
      ios: /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch > 1),
      android: /Android/.test(ua),
      inApp: /FBAN|FBAV|Instagram|Line\/|MicroMessenger|KAKAOTALK/i.test(ua),
      standalone: typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
    };
  }
  /** Android：把網址交給系統打開（裝了 App 就開 App，不然是預設瀏覽器）；拿掉 LINE 的 openExternalBrowser 參數 */
  function intentUrl(href) {
    const u = new URL(String(href).replace(/([?&])openExternalBrowser=1&?/, '$1').replace(/[?&]$/, ''));
    return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;end`;
  }

  /**
   * 開始追蹤加到主畫面的狀態。dismissedKey、installedKey：localStorage 的 key；onChange()：狀態變了（安裝事件來了、裝好了、按掉了）；
   * onInstalled()：這次裝好了。回傳的物件：平台旗標、canPrompt、installed、dismissed、offer（該不該建議安裝）、prompt()、dismiss()
   */
  function track({ dismissedKey, installedKey, onChange = () => {}, onInstalled = () => {} }) {
    const p = platform();
    let event = null;
    const get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
    const set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 私密瀏覽等情況，只在這次有效 */ } };
    if (p.standalone) set(installedKey, 'true');
    addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); event = e; onChange(); });
    addEventListener('appinstalled', () => { event = null; set(installedKey, 'true'); onInstalled(); onChange(); });
    return {
      ...p,
      intentUrl,
      get canPrompt() { return !!event; },
      get installed() { return p.standalone || get(installedKey) === 'true'; },
      get dismissed() { return !!get(dismissedKey); },
      /** 該不該建議加到主畫面：還沒裝、沒按掉，而且裝得了（Android 的 Chrome 要有安裝事件） */
      get offer() { return !this.installed && !this.dismissed && (!p.android || p.inApp || !!event); },
      /** 有安裝事件就跳原生安裝，回傳 'accepted'／'dismissed'；沒有回傳 null（App 改顯示手動步驟） */
      async prompt() {
        const e = event;
        if (!e) return null;
        event = null;
        await e.prompt();
        const { outcome } = await e.userChoice;
        onChange();
        return outcome;
      },
      /** 按了 ×：這台不再建議 */
      dismiss() { set(dismissedKey, String(Date.now())); onChange(); },
    };
  }

  return { platform, intentUrl, track };
});
