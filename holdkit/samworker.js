// 重描輪廓用的 Worker：跑 MobileSAM（CPU），照片特徵一般由雲端算好（見 samrefine.js），沒有雲端時在這裡用編碼器算；不會卡住畫面。
// 主程式（samrefine.js）傳訊息進來：
//   init { dec, cache }                 載入 onnxruntime（ort.js，核對內容後才執行）、下載解碼器；下載中回報 { type: 'progress', bytes }
//   initEnc { enc, cache }              下載、載入編碼器（沒有雲端時才用）；下載中一樣回報 progress
//   encode { rgb, w, h }                分析照片（長邊 1024、H×W×3、0–255），換成這張照片的特徵，回傳存檔用的 int8 版本 { q, lo, sc }
//   setEmb { q, lo, sc }           換成這張照片的特徵（int8：每個通道 lo + q × sc）
//   decode { box | point, w, h, region }   框（或一個點：沒偵測到的岩點，點在岩點上）當提示切出岩點，只回傳 region 範圍的遮罩（Uint8Array）
// English: Worker that runs MobileSAM on CPU (decoder; encoder only without the cloud).
importScripts('ort.js');
let dec = null, enc = null, emb = null;

// cache：Cache API 的名稱（網頁和 Service Worker 共用）；先讀，沒有才下載，下載完整才寫進去（半個檔案不進快取），寫入失敗不影響使用
async function fetchModel(url, report, cache) {
  const store = cache ? await caches.open(cache).catch(() => null) : null, hit = store && await store.match(url).catch(() => null);
  if (hit) return new Uint8Array(await hit.arrayBuffer());
  const out = await download(url, report);
  if (store) await store.put(url, new Response(out, { headers: { 'Content-Type': 'application/octet-stream' } })).catch(() => {});
  return out;
}
async function download(url, report) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  if (!r.body || !r.body.getReader) return new Uint8Array(await r.arrayBuffer());
  const rd = r.body.getReader(), parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    parts.push(value); n += value.length; report(n);
  }
  const out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const handlers = {
  async init(m) {
    const t0 = performance.now();
    await loadOrt();
    let last = 0;
    const d = await fetchModel(m.dec, (n) => { if (performance.now() - last > 200) { last = performance.now(); postMessage({ type: 'progress', bytes: n }); } }, m.cache);
    const t1 = performance.now();
    dec = await ort.InferenceSession.create(d, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    return { dl: t1 - t0, load: performance.now() - t1 };
  },
  async initEnc(m) {
    if (enc) return {};
    let last = 0;
    const d = await fetchModel(m.enc, (n) => { if (performance.now() - last > 200) { last = performance.now(); postMessage({ type: 'progress', bytes: n }); } }, m.cache);
    enc = await ort.InferenceSession.create(d, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    return {};
  },
  async encode(m) {
    const t0 = performance.now();
    emb = (await enc.run({ input_image: new ort.Tensor('float32', m.rgb, [m.h, m.w, 3]) })).image_embeddings.data;
    // 存檔用的跟雲端同一種格式：每個通道 lo + q × sc
    const N = 64 * 64, q = new Uint8Array(256 * N), lo = new Float32Array(256), sc = new Float32Array(256);
    for (let c = 0; c < 256; c++) {
      let a = Infinity, b = -Infinity;
      for (let k = c * N, e = k + N; k < e; k++) { a = Math.min(a, emb[k]); b = Math.max(b, emb[k]); }
      lo[c] = a; sc[c] = (b - a) / 255 || 1;
      for (let k = c * N, e = k + N; k < e; k++) q[k] = Math.round((emb[k] - a) / sc[c]);
    }
    return { q, lo, sc, ms: performance.now() - t0, transfer: [q.buffer] };
  },
  async setEmb(m) {
    const N = 64 * 64;
    emb = new Float32Array(256 * N);
    for (let c = 0; c < 256; c++) for (let k = c * N, e = k + N; k < e; k++) emb[k] = m.lo[c] + m.q[k] * m.sc[c];
    return {};
  },
  async decode(m) {
    const t0 = performance.now();
    const out = await dec.run({
      image_embeddings: new ort.Tensor('float32', emb, [1, 256, 64, 64]),
      // 框：左上、右下兩點（標記 2、3）；一個點：前景點（1）加一個補位的點（-1，沒有框時模型要的）
      point_coords: new ort.Tensor('float32', new Float32Array(m.point ? [m.point[0], m.point[1], 0, 0] : m.box), [1, 2, 2]),
      point_labels: new ort.Tensor('float32', new Float32Array(m.point ? [1, -1] : [2, 3]), [1, 2]),
      mask_input: new ort.Tensor('float32', new Float32Array(256 * 256), [1, 1, 256, 256]),
      has_mask_input: new ort.Tensor('float32', new Float32Array([0]), [1]),
      orig_im_size: new ort.Tensor('float32', new Float32Array([m.h, m.w]), [2]),
    });
    const d = out.masks.data, { rx0, ry0, rw, rh } = m.region, mask = new Uint8Array(rw * rh);
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) mask[y * rw + x] = d[(ry0 + y) * m.w + rx0 + x] > 0 ? 1 : 0;
    return { mask, ms: performance.now() - t0, transfer: [mask.buffer] };
  },
};

self.onmessage = async (e) => {
  const m = e.data;
  try {
    const r = await handlers[m.type](m);
    const transfer = r.transfer || []; delete r.transfer;
    postMessage({ id: m.id, ...r }, transfer);
  } catch (err) {
    postMessage({ id: m.id, error: String((err && err.message) || err) });
  }
};
