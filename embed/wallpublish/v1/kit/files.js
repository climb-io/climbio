// AppKit files：檔案小工具。不壓縮的 ZIP 打包與解開（照片本來就是 JPEG，再壓也小不了；解開支援 deflate）、隨機 id、安全的檔名、內容指紋（SHA-256、cyrb53）、Blob 轉 base64。
// 只在瀏覽器（或有 Blob、crypto 的環境）裡做，不依賴任何套件。瀏覽器用 <script> 載入，掛在全域 AppKit.files；Node 用 require。
// English: AppKit files: stored ZIP pack and unpack, random ids, filesystem-safe names.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.AppKit || (root.AppKit = {})).files = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** 隨機 id：n 個 0-9a-z 字元 */
  const rid = (n = 16) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => (b % 36).toString(36)).join('');
  /** 檔名：去掉路徑與系統不收的字元、開頭的點，最長 80 字；空的給「未命名」 */
  const safeName = s => String(s).replace(/[\\/:*?"<>|#\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim().slice(0, 80) || '未命名';

  /** 內容指紋：文字、位元組或 Blob 的 SHA-256 取前 bytes 個位元組，十六進位字串（預設整段 32 位元組） */
  async function sha(data, bytes = 32) {
    const input = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Blob ? await data.arrayBuffer() : data;
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', input)).subarray(0, bytes), b => b.toString(16).padStart(2, '0')).join('');
  }
  /** 字串的 53 位元雜湊（cyrb53，不是密碼學用途，拿來比對內容有沒有變）：回傳數字；seed 不同就是不同的雜湊 */
  function hash53(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
  /** Blob → base64 字串（不含 data: 前綴） */
  const base64 = blob => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = u => { let c = 0xffffffff; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

  /** [{ name, blob }] → ZIP 的 Blob（不壓縮，檔名 UTF-8） */
  async function zip(entries) {
    const enc = new TextEncoder(), parts = [], central = []; let off = 0;
    for (const e of entries) {
      const data = new Uint8Array(await e.blob.arrayBuffer()), name = enc.encode(e.name), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, 0, 2], [12, 0x21, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, name.length, 2], [28, 0, 2]].forEach(([o, v, n]) => n === 4 ? h.setUint32(o, v, true) : h.setUint16(o, v, true));
      const c = new DataView(new ArrayBuffer(46));
      [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, 0, 2], [14, 0x21, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, name.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, off, 4]].forEach(([o, v, n]) => n === 4 ? c.setUint32(o, v, true) : c.setUint16(o, v, true));
      parts.push(h, name, data); central.push(c, name); off += 30 + name.length + data.length;
    }
    const size = central.reduce((s, x) => s + x.byteLength, 0), end = new DataView(new ArrayBuffer(22));
    [[0, 0x06054b50, 4], [8, entries.length, 2], [10, entries.length, 2], [12, size, 4], [16, off, 4]].forEach(([o, v, n]) => n === 4 ? end.setUint32(o, v, true) : end.setUint16(o, v, true));
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  }

  /**
   * ZIP 的 Blob → [{ name, blob }]（不壓縮或 deflate；資料夾項目略過，不是 ZIP 就丟錯）。
   * 只讀結尾與目錄，不壓縮的檔案直接切原本的 Blob（slice）：大 ZIP 不用整包讀進記憶體，選來的檔案切出來的仍指著磁碟上的檔（存進 IndexedDB 不用整包序列化）
   */
  async function unzip(blob) {
    const bytes = async (a, b) => new Uint8Array(await blob.slice(a, b).arrayBuffer());
    const tailAt = Math.max(0, blob.size - 65557), tail = await bytes(tailAt, blob.size), tv = new DataView(tail.buffer), dec = new TextDecoder(), out = [];
    let e = tail.length - 22; while (e >= 0 && tv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('不是 ZIP 檔');
    const n = tv.getUint16(e + 10, true), cdSize = tv.getUint32(e + 12, true), cdAt = tv.getUint32(e + 16, true);
    const u = await bytes(cdAt, cdAt + cdSize), v = new DataView(u.buffer);
    let p = 0;
    for (let i = 0; i < n; i++) {
      const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lo = v.getUint32(p + 42, true);
      const name = dec.decode(u.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
      if (name.endsWith('/')) continue;
      const lh = new DataView((await bytes(lo, lo + 30)).buffer), start = lo + 30 + lh.getUint16(26, true) + lh.getUint16(28, true), raw = blob.slice(start, start + csize);
      if (method === 0) out.push({ name, blob: raw });
      else if (method === 8) out.push({ name, blob: await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob() });
    }
    return out;
  }

  return { rid, safeName, sha, hash53, base64, zip, unzip };
});
