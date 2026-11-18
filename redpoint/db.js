// 紅點貓的資料：全部是 Climbio 公開格式 v2 的檔案，存在這支手機的 IndexedDB（資料庫 redpoint）。
//   docs    畫面（照片）、圖層（線段、bolt）、組合（群組，層數不限），以檔案 id 為 key
//   photos  照片檔（存成 ArrayBuffer，讀出來是 Blob，見 packBlob），以畫面 id 為 key；收來的照片也下載一份，離線看得到；岩場的入口照片以組合 id 為 key
//   meta    自己的設定：首頁那個組合的 id（home）、署名（author）、收來的岩場的網址（sources：分享時直接傳）
// English: IndexedDB store of v2 documents (views, layers, sets), photo blobs and local settings.

const { idb } = globalThis.AppKit;
const open = idb.opener({
  name: 'redpoint', version: 4,
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      db.createObjectStore('docs', { keyPath: 'id' });
      db.createObjectStore('photos');
      db.createObjectStore('meta');
    }
    // 4：拿掉拍照找路線與照片分享用的 shots、feats、uploads
    for (const old of ['shots', 'feats', 'uploads']) if (db.objectStoreNames.contains(old)) db.deleteObjectStore(old);
  },
});

const done = (req) => idb.done(req);

async function tx(store, mode, fn) {
  const t = (await open()).transaction(store, mode);
  const out = await fn(t.objectStore(store));
  await new Promise((ok, bad) => ((t.oncomplete = ok), (t.onerror = () => bad(t.error)), (t.onabort = () => bad(t.error))));
  return out;
}

export const getDoc = (id) => tx('docs', 'readonly', (s) => done(s.get(id)));
export const allDocs = () => tx('docs', 'readonly', (s) => done(s.getAll()));
export const putDocs = (docs) => tx('docs', 'readwrite', (s) => Promise.all(docs.map((d) => done(s.put(d)))));
export const deleteDocs = (ids) => tx('docs', 'readwrite', (s) => Promise.all(ids.map((id) => done(s.delete(id)))));
// Blob 的存法（iPhone 大 Blob 會失敗）見 appkit/idb.js 的 packBlob
const { packBlob, unpackBlob } = idb;
export const getPhoto = async (id) => unpackBlob(await tx('photos', 'readonly', (s) => done(s.get(id))));
export const putPhoto = async (id, blob) => {
  const data = await packBlob(blob);   // 先讀好再開交易：交易裡等非同步的事會自動結束
  return tx('photos', 'readwrite', (s) => done(s.put(data, id)));
};
export const deletePhotos = (ids) => tx('photos', 'readwrite', (s) => Promise.all(ids.map((id) => done(s.delete(id)))));
export const getMeta = (key) => tx('meta', 'readonly', (s) => done(s.get(key)));
export const setMeta = (key, value) => tx('meta', 'readwrite', (s) => done(s.put(value, key)));

/** 刪掉這支手機的全部資料（登出用）：三個 store 一起清，要嘛全清、要嘛都不清 */
export async function clearAll() {
  const stores = ['docs', 'photos', 'meta'], t = (await open()).transaction(stores, 'readwrite');
  for (const s of stores) t.objectStore(s).clear();
  await new Promise((ok, bad) => ((t.oncomplete = ok), (t.onerror = () => bad(t.error)), (t.onabort = () => bad(t.error))));
}

// 備份僅取得本地連線，由 appkit/backup.mjs 以單一交易讀取／復原。
export const database = open;
