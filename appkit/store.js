// AppKit store：localStorage 的 JSON 讀寫。瀏覽器的私密模式、空間滿了、資料壞掉都會丟例外，這裡一律吞掉、回預設值或 false，呼叫端不用各自 try/catch。
// 瀏覽器用 <script> 載入，掛在全域 AppKit.store；Node 用 require。
// English: AppKit store: JSON read/write over localStorage that never throws (private mode, quota, corrupt values).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else (root.AppKit || (root.AppKit = {})).store = factory(root);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** 讀 JSON；沒有、壞了、讀不到都回 fallback */
  const get = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (e) { return fallback; } };
  /** 存成 JSON；存不下回 false */
  const set = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; } };
  const remove = (key) => { try { localStorage.removeItem(key); } catch (e) { /* 沒存就沒得清 */ } };

  return { get, set, remove };
});
