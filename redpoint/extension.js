// 紅點貓收藏（瀏覽器擴充 extension/）：擴充把收好的岩場放在它自己的暫存，開一個紅點貓分頁（網址 #collect）；
// 這裡連進擴充（externally_connectable）把檔案一塊一塊拿過來，匯入成功才通知擴充刪掉。協定見 extension/handoff.js。
export const EXTENSION_ID = 'clpjfehckclgenaackpklkceejlbcbnh';   // 自行載入的版本：由 extension/manifest.json 的 key 算出來，固定不變
export const STORE_EXTENSION_ID = '';   // Chrome 線上應用程式商店的版本（商店上傳的 manifest 不帶 key，ID 由商店決定）：拿到 ID 後填在這裡
/** 要試的擴充 ID（依序）：自己開發擴充（載入未封裝項目、ID 不同）時 localStorage 設 redpoint.extensionId 蓋掉 */
export function extensionIds() {
  let own = '';
  try { own = localStorage.getItem('redpoint.extensionId') || ''; } catch { /* 沒有 localStorage */ }
  return own ? [own] : [EXTENSION_ID, STORE_EXTENSION_ID].filter(Boolean);
}
/** 這個瀏覽器有沒有可能連到擴充（Chrome／Edge 的電腦版，而且擴充的 externally_connectable 放行這個網站） */
export const available = () => typeof globalThis.chrome?.runtime?.connect === 'function';

const bytesOf = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/**
 * 把擴充裡等著的岩場全部拿過來：回 { bundles: [{ id, name, v, files: [{ path, blob }] }], ack(ids) }；沒有就是空陣列。
 * onProgress(拿到的位元組, 總共)；connect 可換成假的（測試）。擴充沒裝、沒放行、中途斷線都丟錯。
 * 依序試每個擴充 ID（自行載入版、商店版），第一個連得上的為準；都連不上丟最後一個錯。
 */
export async function pullCollected({ id, ...opts } = {}) {
  const ids = id ? [id] : extensionIds();
  let last = new Error('extension not installed');
  for (const x of ids) {
    try { return await pullFrom({ ...opts, id: x }); } catch (e) { last = e; }
  }
  throw last;
}

function pullFrom({ connect = (id, o) => globalThis.chrome.runtime.connect(id, o), id, onProgress = () => {}, wait = 20000 }) {
  return new Promise((ok, no) => {
    let port, timer, done = false, got = 0, total = 0;
    const bundles = new Map(), left = new Set(), acks = new Map();
    const fail = (e) => { if (done) return; done = true; clearTimeout(timer); try { port?.disconnect(); } catch { /* 已經斷了 */ } no(e instanceof Error ? e : new Error(String(e))); };
    const bump = () => { clearTimeout(timer); timer = setTimeout(() => fail(new Error('extension timeout')), wait); };
    try { port = connect(id, { name: 'collect' }); } catch (e) { return fail(e); }
    const finish = () => {
      if (done) return; done = true; clearTimeout(timer);
      const list = [...bundles.values()].map((b) => ({ id: b.id, name: b.name, v: b.v, files: [...b.files].map(([path, f]) => ({ path, blob: new Blob(f.chunks, { type: f.mime || 'application/octet-stream' }) })) }));
      ok({
        bundles: list,
        ack: (ids) => new Promise((resolve) => {
          const todo = new Set(ids);
          if (!todo.size) { try { port.disconnect(); } catch { /* 已經斷了 */ } return resolve(); }
          for (const x of todo) acks.set(x, () => { todo.delete(x); if (!todo.size) { try { port.disconnect(); } catch { /* 已經斷了 */ } resolve(); } });
          for (const x of todo) port.postMessage({ op: 'ack', id: x });
          setTimeout(resolve, 5000);   // 擴充沒回也不卡住
        }),
      });
    };
    port.onMessage.addListener((m) => {
      bump();
      if (m.type === 'list') {
        total = m.bundles.reduce((n, b) => n + b.bytes, 0);
        for (const b of m.bundles) { bundles.set(b.id, { id: b.id, name: b.name, v: b.v, files: new Map() }); left.add(b.id); port.postMessage({ op: 'get', id: b.id }); }
        if (!left.size) finish();
      } else if (m.type === 'chunk') {
        const b = bundles.get(m.id);
        if (!b) return;
        const f = b.files.get(m.path) ?? b.files.set(m.path, { chunks: [], mime: m.mime }).get(m.path), bytes = bytesOf(m.data);
        f.chunks.push(bytes); got += bytes.length; onProgress(got, total);
      } else if (m.type === 'end') {
        left.delete(m.id);
        if (!left.size) finish();
      } else if (m.type === 'ack') acks.get(m.id)?.();
      else if (m.type === 'error') fail(new Error(m.error || 'extension error'));
    });
    port.onDisconnect.addListener(() => { if (!done) fail(new Error(globalThis.chrome?.runtime?.lastError?.message || 'extension disconnected')); });
    bump();
    port.postMessage({ op: 'list' });
  });
}
