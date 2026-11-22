// 這台發佈過的 3D 牆版本記錄（瀏覽器的 IndexedDB climbio-wall3d，3D 牆工作區讀寫）。
export const STORES = ['dirs', 'published'];
export const openDb = () => new Promise((res, rej) => {
  const r = indexedDB.open('climbio-wall3d', 2);
  r.onupgradeneeded = () => { for (const n of STORES) if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});

