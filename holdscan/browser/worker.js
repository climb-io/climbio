// HoldScan 的 Worker：onnxruntime-web（只有 CPU）跑偵測模型，照片 → 框，不卡住畫面。前後處理跟雲端版共用 core/detect-core.js。
// 訊息：{ type: 'config', cache }＝模型快取（Cache API）的名稱；{ id, type: 'warm' }＝先下載、載入模型；{ id, type: 'detect', image: ImageBitmap }＝偵測。
// 回覆：{ id, type: 'status', key: 'detDownload' | 'detFinding' }、{ id, type: 'done', boxes? }、{ id, type: 'error', message, download（下載失敗） }
// English: HoldScan Worker: runs the detection model with onnxruntime-web (CPU), photo -> boxes.
importScripts('../../holdkit/ort.js', '../core/detect-core.js');   // onnxruntime 核對內容後才載入（holdkit/ort.js）
const Core = self.HoldDetectCore;
let session = null, cacheName = '', modelUrl = '';

// 模型先看 Cache API（名稱由頁面用 configure 傳來；頁面先下載好存在那裡，Service Worker 也從同一個快取拿），沒有才自己下載
async function modelBytes() {
  const url = new URL(modelUrl || `../models/${Core.MODEL}.onnx`, location.href);
  try { const c = cacheName && await caches.open(cacheName), hit = c && await c.match(url); if (hit) return new Uint8Array(await hit.arrayBuffer()); } catch (e) { /* 快取讀不到：照常下載 */ }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`model HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
function load(post) {
  if (!session) {
    post({ type: 'status', key: 'detDownload' });
    session = (async () => {
      let bytes;
      try { await loadOrt(); bytes = await modelBytes(); } catch (e) { throw Object.assign(e instanceof Error ? e : new Error(String(e)), { download: true }); }
      return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    })();
    session.catch(() => { session = null; });   // 下載失敗：下一次重新下載
  }
  return session;
}

// 等比縮放貼到左上、補灰 114（跟雲端版一樣），回傳照片座標的框 [x0, y0, x1, y1, score]
async function detect(s, bmp) {
  const S = Core.MODEL_SIZE, r = Core.scaleFor(bmp.width, bmp.height, S);
  const c = new OffscreenCanvas(S, S), g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = 'rgb(114,114,114)'; g.fillRect(0, 0, S, S);
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, Math.round(bmp.width * r), Math.round(bmp.height * r));
  bmp.close();
  const input = new ort.Tensor('float32', Core.toTensorData(g.getImageData(0, 0, S, S).data, S), [1, 3, S, S]);
  const out = await s.run({ [s.inputNames[0]]: input });
  return Core.postprocess(out[s.outputNames[0]].data, r);
}

onmessage = async ({ data: m }) => {
  if (m.type === 'config') { cacheName = m.cache || ''; modelUrl = m.model || ''; return; }
  const post = (x) => postMessage({ id: m.id, ...x });
  try {
    const s = await load(post);
    if (m.type === 'warm') return post({ type: 'done' });
    post({ type: 'status', key: 'detFinding' });
    post({ type: 'done', boxes: await detect(s, m.image) });
  } catch (e) { post({ type: 'error', message: String((e && e.message) || e), download: !!(e && e.download) }); }
};
