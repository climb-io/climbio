// AppKit share：交給系統的分享與下載（岩點貓、紅點貓共用）：sendLink（分享連結，不行就複製）、sendFile（分享檔案，不行就下載）、download。
// English: AppKit share: system share / download helpers (sendLink falls back to copy, sendFile falls back to download).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.AppKit || (root.AppKit = {})).share = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  /** 下載一個 Blob（隱形連結點一下，過一會兒收回網址） */
  function download(blob, name, revokeAfter = 10000) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), revokeAfter);
  }
  /** 這台能不能用系統分享檔案 */
  function canShareFiles(file = new File([''], 'x.jpg', { type: 'image/jpeg' })) {
    try { return !!(navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) { return false; }
  }
  /**
   * 用系統分享送連結（text 可選），不能分享就複製（有 text 時是「text 換行 url」）。
   * 回傳 'shared'、'copied'、'cancelled'（使用者關掉）、'failed'（連複製都不行）；
   * strictGesture：iOS 要求分享在點擊當下呼叫，等過網路被擋（NotAllowedError）時回 'blocked'，由呼叫端提示再按一次；沒設定就照一般失敗走複製
   */
  async function sendLink(url, { title, text, strictGesture = false } = {}) {
    if (navigator.share) {
      try { await navigator.share({ url, ...(title ? { title } : {}), ...(text ? { text } : {}) }); return 'shared'; }
      catch (e) {
        if (e.name === 'AbortError') return 'cancelled';
        if (e.name === 'NotAllowedError' && strictGesture) return 'blocked';
      }
    }
    try { await navigator.clipboard.writeText(text ? `${text}\n${url}` : url); return 'copied'; } catch (e) { return 'failed'; }
  }
  /**
   * 用系統分享送檔案，不能分享就下載。回傳 'shared'、'cancelled'、'downloaded'；strictGesture 同上，被擋回 'blocked'（不下載）
   */
  async function sendFile(file, { title, strictGesture = false } = {}) {
    if (canShareFiles(file)) {
      try { await navigator.share({ files: [file], title: title ?? file.name.replace(/\.\w+$/, '') }); return 'shared'; }
      catch (e) {
        if (e.name === 'AbortError') return 'cancelled';
        if (e.name === 'NotAllowedError' && strictGesture) return 'blocked';
      }
    }
    download(file, file.name);
    return 'downloaded';
  }
  return { download, canShareFiles, sendLink, sendFile };
});
