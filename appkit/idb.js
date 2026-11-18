// AppKit idb：IndexedDB 的共用小工具（岩點貓、紅點貓）。
// - opener({ name, version, upgrade, ready })：回傳「開資料庫」的函式，同一個連線共用；連線被瀏覽器關掉（iPhone 的 Safari 存失敗後會關）
//   或別的分頁要升級時，下次呼叫會重新開，不會一直拿著關掉的連線
// - done(request)：IDBRequest → Promise
// - packBlob／unpackBlob：iPhone（WebKit）把大一點的 Blob 直接存進 IndexedDB 會失敗（Error preparing Blob/File data），
//   所以存成 { $blob, buf: ArrayBuffer, type }，讀出來換回 Blob；之前直接存的 Blob 照樣讀得出來
// English: AppKit idb: reconnecting IndexedDB opener, request-to-promise, and Blob packing that works around iOS Safari's Blob storage failures.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.AppKit || (root.AppKit = {})).idb = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** upgrade(db, oldVersion, tx)：onupgradeneeded 要做的事；ready(db)：開好後、給呼叫端之前要做的事（例如搬舊資料，可以是 async） */
  function opener({ name, version, upgrade, ready }) {
    let opening = null;
    return () => (opening ??= new Promise((ok, bad) => {
      const req = indexedDB.open(name, version);
      req.onupgradeneeded = (e) => upgrade && upgrade(req.result, e.oldVersion, req.transaction);
      req.onsuccess = async () => {
        const db = req.result, reset = () => { if (opening) opening = null; };
        db.onclose = reset;
        db.onversionchange = () => { db.close(); reset(); };
        try { if (ready) await ready(db); ok(db); } catch (e) { bad(e); }
      };
      req.onerror = () => bad(req.error);
    }).catch((e) => { opening = null; throw e; }));
  }

  const done = (req) => new Promise((ok, bad) => { req.onsuccess = () => ok(req.result); req.onerror = () => bad(req.error); });

  const packBlob = async (v) => (v instanceof Blob ? { $blob: true, buf: await v.arrayBuffer(), type: v.type } : v);
  const unpackBlob = (v) => (v && v.$blob ? new Blob([v.buf], { type: v.type }) : v);

  return { opener, done, packBlob, unpackBlob };
});
