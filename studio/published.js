// 這台發佈過的 3D 牆版本記錄（瀏覽器的 IndexedDB climbio-wall3d，3D 牆工作區寫入）。發佈不認人，所以「我的牆」靠這份本機記錄。
export const STORES = ['dirs', 'published'];
export const openDb = () => new Promise((res, rej) => {
  const r = indexedDB.open('climbio-wall3d', 2);
  r.onupgradeneeded = () => { for (const n of STORES) if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});

/** 這台發佈過的 3D 牆，每面牆一筆（最新發佈的版本）：[{ wallId, pid, name, gym, t, kind: '3d' }]；讀不到就是空的 */
export async function localWalls3d() {
  try {
    const db = await openDb(), store = db.transaction('published').objectStore('published');
    const keys = await new Promise((res, rej) => { const q = store.getAllKeys(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    const vals = await new Promise((res, rej) => { const q = store.getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    return vals.flatMap((v, i) => { const last = v.list[v.list.length - 1]; return last ? [{ wallId: keys[i], pid: last.id, name: last.name, gym: last.gym, t: last.t, kind: '3d' }] : []; }).sort((a, b) => b.t - a.t);
  } catch (e) { return []; }
}
