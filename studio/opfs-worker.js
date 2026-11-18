// Climbio Studio：沒有 createWritable 的瀏覽器（舊的 Safari）寫私有檔案系統（OPFS）的檔案。{ id, path: OPFS 根目錄起的路徑, data: 字串或 Blob } → { id, err? }
'use strict';
const CHUNK = 8 << 20;   // 大檔（模型 300 MB）分段讀進來寫，不一次佔滿記憶體
onmessage = async ({ data: { id, path, data } }) => {
  let h = null;
  try {
    let d = await navigator.storage.getDirectory();
    for (const p of path.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
    h = await (await d.getFileHandle(path[path.length - 1], { create: true })).createSyncAccessHandle();
    h.truncate(0);
    if (typeof data === 'string') h.write(new TextEncoder().encode(data), { at: 0 });
    else for (let at = 0; at < data.size; at += CHUNK) h.write(new Uint8Array(await data.slice(at, at + CHUNK).arrayBuffer()), { at });
    h.flush();
    postMessage({ id });
  } catch (e) { postMessage({ id, err: e.message }); }
  finally { if (h) h.close(); }
};
