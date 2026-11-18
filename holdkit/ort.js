// onnxruntime-web（只有 CPU 的版本）從 CDN 載入，先核對內容（SRI）才執行。給 Worker 用：importScripts 本檔，再 await loadOrt()。
// importScripts、ORT 自己載入 .mjs、.wasm 都不能帶 integrity，所以先用 fetch 帶 integrity 下載、轉成 blob 網址再交給它。
// 換版本：改 ORT_VERSION，三個雜湊照 docs/open-source.md 的指令重算。
// English: loads onnxruntime-web from the CDN only after checking Subresource Integrity hashes; Workers call `await loadOrt()`.
(() => {
  const ORT_VERSION = '1.30.0';
  const CDN = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
  const FILES = {
    js: ['ort.wasm.min.js', 'sha384-Bw6URI+Gvoadw0do7/QrSHUC9D1vCYYK5OSqChFyhyV5mzPL4oe2rOAFljAnS8Sq'],
    mjs: ['ort-wasm-simd-threaded.mjs', 'sha384-XcXA/MtAf0WpB8e023xQH9CM7RIjiugakT7x99DIwpFf7k56BIFFcAPerIF7FDad'],
    wasm: ['ort-wasm-simd-threaded.wasm', 'sha384-vjBJ1z7qrhkTyYsNqKeF6c7N+nOJSU94czEo+tvZcu8G75JparGq9kB+kTnEUNVM'],
  };
  self.ortFiles = () => [FILES.js, FILES.mjs, FILES.wasm].map(([name, integrity]) => [CDN + name, integrity]);   // 網頁預先下載用（js/add-wall.js 存進 Cache API）
  // 網頁先下載好存在 Cache API 的就直接用（核對雜湊），沒有才從 CDN 下載
  const cached = async (url, integrity) => {
    try {
      const hit = await caches.match(url);
      if (!hit) return null;
      const buf = await hit.arrayBuffer(), hash = new Uint8Array(await crypto.subtle.digest('SHA-384', buf));
      return integrity === 'sha384-' + btoa(String.fromCharCode(...hash)) ? new Blob([buf], { type: hit.headers.get('content-type') || '' }) : null;
    } catch (e) { return null; }
  };
  const verified = async ([name, integrity]) => {
    const hit = await cached(CDN + name, integrity);
    if (hit) return URL.createObjectURL(hit);
    const r = await fetch(CDN + name, { integrity });
    if (!r.ok) throw new Error(`onnxruntime HTTP ${r.status}`);
    return URL.createObjectURL(await r.blob());
  };
  let ready = null;
  self.loadOrt = () => ready || (ready = (async () => {
    const [js, mjs, wasm] = await Promise.all([FILES.js, FILES.mjs, FILES.wasm].map(verified));
    importScripts(js);
    ort.env.wasm.wasmPaths = { mjs, wasm };
    ort.env.wasm.numThreads = 1;   // 多執行緒要 crossOriginIsolated，這個站沒開
    return ort;
  })().catch(e => { ready = null; throw e; }));
})();
