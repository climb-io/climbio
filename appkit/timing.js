// AppKit timing：等待與逾時的共用小工具：wait、timeoutSignal、fetchTimeout。
// 舊版 iOS 沒有 AbortSignal.timeout，這裡退回 AbortController 加計時器，呼叫端不用各自判斷。
// 瀏覽器用 <script> 載入，掛在全域 AppKit.timing；Node 用 require。
// English: AppKit timing: wait, an abort signal that fires after a delay (with a fallback for old iOS), and fetch with a timeout.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.AppKit || (root.AppKit = {})).timing = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** 等 ms 毫秒 */
  const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

  /** ms 毫秒後中止的 AbortSignal */
  function timeoutSignal(ms) {
    if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), ms);
    return ac.signal;
  }

  /** fetch，超過 ms 毫秒就中止（opt 的其他選項照傳；自己給了 signal 就用自己的） */
  const fetchTimeout = (url, opt = {}, ms = 15000) => fetch(url, { signal: timeoutSignal(ms), ...opt });

  return { wait, timeoutSignal, fetchTimeout };
});
