// 公開的岩場放進開放資料集 climbio/crags（雲端函式 datasets 的 prepare、publish hf:true；伺服器端見 functions/crags-dataset.js）。
// 照片由瀏覽器直接傳給 Hugging Face（LFS 上傳網址由 prepare 給，不經過函式），JSON 隨 publish 一起送；沒改的檔案（sha256 跟上一版一樣）不傳。
// 每張照片另外做一張縮圖（長邊 THUMB 像素的 JPEG，檔名 <照片名>.thumb.jpg）放在同一個資料夾，研究與清單不用下載原圖。
// 回傳 { version, url, files, project }。

export const THUMB = 480, UPLOADS = 4;
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
export const sha256 = async bytes => hex(await crypto.subtle.digest('SHA-256', bytes));
const isImage = path => /\.(jpe?g|png|webp)$/i.test(path);
/** 縮圖的檔名：照片不用縮圖的（預覽、岩場縮圖、本來就是縮圖、原始檔 source/）回 null */
export const thumbPath = path => (isImage(path) && !/^(preview|thumb)\.jpg$/.test(path) && !path.endsWith('.thumb.jpg') && !path.startsWith('source/') ? `${path.replace(/\.[^.]+$/, '')}.thumb.jpg` : null);

/** 瀏覽器縮圖：長邊 THUMB 的 JPEG（0.8）；照片比 THUMB 小就維持原尺寸 */
export async function browserThumb(bytes) {
  const bmp = await createImageBitmap(new Blob([bytes]));
  const k = Math.min(1, THUMB / Math.max(bmp.width, bmp.height)), w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = c.convertToBlob ? await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 }) : await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
  return new Uint8Array(await blob.arrayBuffer());
}

const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

/**
 * 發佈一個版本：id、name、type（'guidebook'）、files（[{ path, bytes }]，要有 index.json）、locations、meta（{ attribution, origin, gym }）、
 * service（studio/service.js 的 createService：files、prepare、publishHf）、onProgress(完成數, 總數)、onFile(path)、thumb（測試用，預設 browserThumb）、fetchFn（上傳給 Hub 用）
 */
export async function publishDataset({ id, name, type = 'guidebook', files: list, locations = [], meta = {}, service, onProgress = () => {}, onFile = () => {}, thumb = browserThumb, fetchFn = (...a) => fetch(...a) }) {
  const last = await service.files(meta.origin || id, type), prev = new Map(last.hf ? (last.files || []).map(f => [f.path, f]) : []);   // 上一版不在資料集（Drive）就全部重傳
  const all = [];
  for (const f of list) all.push({ path: f.path, bytes: f.bytes, sha256: await sha256(f.bytes), size: f.bytes.length });
  // 縮圖：照片沒改、上一版有縮圖就沿用（不重新解碼），其他的現做
  for (const f of [...all]) {
    const tp = thumbPath(f.path);
    if (!tp || all.some(x => x.path === tp)) continue;
    const old = prev.get(f.path), oldThumb = prev.get(tp);
    if (old && old.sha256 === f.sha256 && oldThumb && oldThumb.sha256 && oldThumb.size) { all.push({ path: tp, sha256: oldThumb.sha256, size: oldThumb.size }); continue; }
    const bytes = await thumb(f.bytes);
    if (!bytes) continue;   // 做不出縮圖（沒有畫布的環境）就不放
    all.push({ path: tp, bytes, sha256: await sha256(bytes), size: bytes.length });
  }
  const fresh = all.filter(f => prev.get(f.path)?.sha256 !== f.sha256);
  const manifest = all.map(f => ({ path: f.path, sha256: f.sha256, size: f.size }));
  let done = 0;
  for (const f of all) if (!fresh.includes(f)) onFile(f.path);
  const bin = fresh.filter(f => !f.path.endsWith('.json'));
  onProgress(done, fresh.length);
  // 照片直接傳給 Hub：prepare 回要傳的（Hub 已經有同樣內容的不回），同時傳 UPLOADS 張
  const { uploads } = await service.prepare(id, type, manifest);
  const byPath = new Map(bin.map(f => [f.path, f]));
  const todo = [...uploads];
  const worker = async () => {
    for (let u = todo.shift(); u; u = todo.shift()) {
      const f = byPath.get(u.path);
      const put = await fetchFn(u.upload.href, { method: 'PUT', headers: u.upload.header || {}, body: f.bytes });
      if (!put.ok) throw Object.assign(new Error(`upload ${u.path} ${put.status}`), { status: put.status });
      if (u.verify) {
        const v = await fetchFn(u.verify.href, { method: 'POST', headers: { ...(u.verify.header || {}), 'Content-Type': 'application/vnd.git-lfs+json' }, body: JSON.stringify({ oid: u.oid, size: u.size }) });
        if (!v.ok) throw Object.assign(new Error(`verify ${u.path} ${v.status}`), { status: v.status });
      }
      onProgress(++done, fresh.length); onFile(u.path);
    }
  };
  await Promise.all(Array.from({ length: Math.min(UPLOADS, todo.length) }, worker));
  // Hub 本來就有的（沒回上傳網址）也算好了
  for (const f of bin) if (!uploads.some(u => u.path === f.path)) { onProgress(++done, fresh.length); onFile(f.path); }
  // JSON 一律帶內容：新的專案 id（沒有擁有者，更新是新的專案）在伺服器上沒有上一版，沒帶的 JSON 它拿不到；照片、模型 Hub 已經有的只送指標
  const res = await service.publishHf({ id, type, name, locations, ...meta, files: manifest.map(m => {
    const f = all.find(x => x.path === m.path);
    return f && f.bytes && f.path.endsWith('.json') ? { ...m, b64: b64(f.bytes) } : m;
  }) });
  for (const f of fresh) if (f.path.endsWith('.json')) { onProgress(++done, fresh.length); onFile(f.path); }
  return { version: res.version, url: res.url, files: res.files, project: res.id };
}
