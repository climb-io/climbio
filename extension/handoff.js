// 收藏交給紅點貓：不寫 Google Drive、不用登入。收好的岩場放在擴充自己的 IndexedDB（climbio-collect），
// 開一個紅點貓分頁；紅點貓頁面用 chrome.runtime.connect 連回來，把檔案一塊一塊拿走（redpoint/extension.js），匯入成功才通知刪掉。
// 介面跟以前寫 Drive 的 open() 一樣：open(路徑) → { version, setVersion, put }，各個來源（theCrag、OpenClimbing…）不用改。

export const CHUNK = 3 * 1024 * 1024;   // 一塊最多 3 MB（base64 後約 4 MB，在訊息大小上限之內）

/** 暫存：{ get(id), put(bundle), del(id), all() }；bundle：{ id, name, v, at, files: [{ path, blob }] }。IndexedDB 在擴充的背景程式裡，測試換成記憶體 */
export function idbStore(idb = globalThis.indexedDB) {
  const db = new Promise((ok, no) => {
    const r = idb.open('climbio-collect', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('bundles', { keyPath: 'id' });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
  const run = async (mode, fn) => {
    const d = await db;
    return new Promise((ok, no) => { const t = d.transaction('bundles', mode), r = fn(t.objectStore('bundles')); t.oncomplete = () => ok(r?.result); t.onerror = () => no(t.error); });
  };
  return { get: (id) => run('readonly', (s) => s.get(id)), put: (b) => run('readwrite', (s) => s.put(b)), del: (id) => run('readwrite', (s) => s.delete(id)), all: () => run('readonly', (s) => s.getAll()).then((x) => x ?? []) };
}

export function memoryStore() {
  const m = new Map();
  return { get: async (id) => m.get(id), put: async (b) => { m.set(b.id, b); }, del: async (id) => { m.delete(id); }, all: async () => [...m.values()] };
}

/** 一個岩場一份：path 最後一層是岩場 id。version() 是還沒被紅點貓拿走的那份的內容指紋（同樣的內容不用再存一份） */
export async function open(store, path, now = Date.now) {
  const id = String(path.at(-1)), old = await store.get(id), files = new Map();
  return {
    version: () => old?.v,
    /** 全部寫好之後才算數（有圖片讀不到就不呼叫，下次重收） */
    async setVersion(v, name) { await store.put({ id, name, v, at: now(), files: [...files].map(([path, blob]) => ({ path, blob })) }); },
    async put(name, blob) { files.set(name, blob); return true; },
  };
}

const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

/** 紅點貓連進來：{ op: 'list' } → 有哪些；{ op: 'get', id } → 一個檔案一塊一塊送（chunk）、最後 end；{ op: 'ack', id } → 匯入好了，刪掉 */
export function serve(port, store) {
  port.onMessage.addListener(async (m) => {
    try {
      if (m?.op === 'list') {
        const all = await store.all();
        port.postMessage({ type: 'list', bundles: all.map((b) => ({ id: b.id, name: b.name, v: b.v, files: b.files.length, bytes: b.files.reduce((n, f) => n + f.blob.size, 0) })) });
      } else if (m?.op === 'get') {
        const b = await store.get(String(m.id));
        if (!b) return void port.postMessage({ type: 'error', id: m.id, error: 'not found' });
        for (const f of b.files) {
          const bytes = new Uint8Array(await f.blob.arrayBuffer());
          for (let at = 0, seq = 0; at < bytes.length || seq === 0; at += CHUNK, seq++) {
            port.postMessage({ type: 'chunk', id: b.id, path: f.path, mime: f.blob.type, size: bytes.length, seq, data: b64(bytes.subarray(at, at + CHUNK)) });
          }
        }
        port.postMessage({ type: 'end', id: b.id });
      } else if (m?.op === 'ack') {
        await store.del(String(m.id));
        port.postMessage({ type: 'ack', id: m.id });
      }
    } catch (e) { port.postMessage({ type: 'error', id: m?.id, error: e.message || String(e) }); }
  });
}

/** 有沒有等紅點貓拿走的 */
export const pending = async (store) => (await store.all()).length;
