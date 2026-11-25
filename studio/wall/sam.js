// Studio Wall 的 SAM2.1 base+（onnxruntime-web）：點一下描岩點、整面牆逐顆描外框、手畫貼齊邊緣。
// 編碼器放在 Hugging Face（onnx-community，Apache-2.0），
// 第一次下載後存在瀏覽器的私有檔案系統（OPFS）；解碼器是自己匯出的，放在 refine/models/。
// 有 WebGPU 用 WebGPU（約 2.3 秒編碼一個 1024 視窗），沒有（或建不起來，例如 iPad 的 Safari）就用 WASM（約 5.5 秒）。onnxruntime-web 第一次載入模型時才下載；需要先載入 geometry.js。
(function (root) {
  'use strict';
  const G = root.RefineGeo, T = root.AppKit.i18n.t;
  const HF = 'https://huggingface.co/onnx-community/sam2.1-hiera-base-plus-ONNX/resolve/main/onnx/';
  const ENC = 'vision_encoder';   // fp32；fp16 的 WebGPU 特徵有 5% 誤差，沒量過對外框的影響，先用 fp32
  const SIDE = 1024, POOL_MAX = 6, STEP = 256;
  // 有些顯示卡（例如 Windows 的 Intel 內顯）用 WebGPU 建模型、第一次編碼會一直卡住、不報錯：等太久就當成跑不動，改用 WASM
  // 卡住的 WebGPU 模型還佔著 onnxruntime，同一頁不能再建 WASM 的（Session already started）：記住這台不用 WebGPU，請人重新整理
  const GPU_WAIT = 90000, NO_GPU = 'climbio.sam.noGpu';
  const stuck = () => { try { localStorage.setItem(NO_GPU, '1'); } catch (e) { /* 存不了就下次再等一次 */ } const e = new Error(T('hlSamGpuStuck')); e.stuck = true; return e; };
  const slow = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(stuck()), ms))]);
  const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
  let enc = null, decS = null, decM = null, ep = '', photo = null, toWasm = null;   // toWasm：WebGPU 跑不動時改建 WASM 的編碼器   // photo：目前這次推論用的照片 { key, w, h, ctx（整張照片的畫布）}
  // 可以同時放幾張照片（編輯器的 edit、背景整批的 batch），推論時才切換；編碼結果用「照片＋視窗」當鍵
  const photos = new Map(), use = key => { photo = photos.get(key); if (!photo) throw new Error(T('hlPhotoNotLoaded')); };
  const pool = new Map();   // 照片＋視窗 → 編碼結果，最近用過的 POOL_MAX 個
  let chain = Promise.resolve();   // 一次只跑一個推論（WebGPU、WASM 都不能同時跑同一個 session）
  const serial = fn => (chain = chain.then(fn, fn));

  // 下載（有快取就讀快取）→ Uint8Array。Cache Storage 放不下 300 MB 的單一檔案（put 回 Unexpected internal error），
  // 改存瀏覽器的私有檔案系統（OPFS）：寫完才記一個完成標記，下載到一半被中斷的檔案不會被當成快取。
  async function cached(url, onBytes) {
    const name = url.split('/').pop();
    let dir = null; try { dir = await navigator.storage.getDirectory(); } catch (e) { dir = null; }
    if (dir) {
      try {
        const size = +await (await (await dir.getFileHandle(name + '.ok')).getFile()).text(), f = await (await dir.getFileHandle(name)).getFile();
        if (f.size === size) { const b = new Uint8Array(await f.arrayBuffer()); onBytes && onBytes(b.length, b.length); return b; }
      } catch (e) { /* 沒有快取 */ }
    }
    const r = await fetch(url);
    if (!r.ok) throw new Error(T('hlModelHttp', r.status));
    const total = +r.headers.get('content-length') || 0, rd = r.body.getReader(), parts = []; let got = 0;
    for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; onBytes && onBytes(got, total); }
    const all = new Uint8Array(got); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
    if (dir) {
      try {
        await root.StudioStore.write(dir, name, all);   // 沒有 createWritable 的 Safari 由它轉給 Worker 寫
        await root.StudioStore.write(dir, name + '.ok', String(got));
      } catch (e) { console.warn('模型沒存進瀏覽器：', e.message); }
    }
    return all;
  }

  // onnxruntime-web 第一次要用 SAM2 才載入（頁面一打開就載會擋住畫面）；帶 SRI，內容被換掉就不執行
  const ORT = ['https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.webgpu.min.js', 'sha384-kLVmxu3ZkURUzln+3FiMoTAFDFOD8PoImWtQkQG9BudtlZyzyFAfNErJUTSB7at7'];
  let ortP = null;
  const loadOrt = () => root.ort ? Promise.resolve() : ortP || (ortP = new Promise((res, rej) => {
    const s = Object.assign(document.createElement('script'), { src: ORT[0], integrity: ORT[1], crossOrigin: 'anonymous' });
    s.onload = res; s.onerror = () => { ortP = null; rej(new Error(T('hlSamLibFail'))); };
    document.head.append(s);
  }));

  // 載入模型。progress(文字, 0–1)
  async function load(progress = () => {}) {
    if (enc) return ep;
    await loadOrt();
    let gpu = false; try { gpu = localStorage.getItem(NO_GPU) !== '1' && !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch (e) { gpu = false; }
    ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 1);
    const [m, d] = await Promise.all([cached(`${HF}${ENC}.onnx`), cached(`${HF}${ENC}.onnx_data`, (a, t) => progress(T('hlSamDownload'), t ? a / t : 0))]);
    progress(T('hlSamLoading'), 1);
    const make = p => ort.InferenceSession.create(m, { executionProviders: [p], externalData: [{ path: `${ENC}.onnx_data`, data: d }] });
    ep = gpu ? 'webgpu' : 'wasm';
    toWasm = async e => { console.warn('WebGPU 跑不動，改用 WASM：', e.message); ep = 'wasm'; toWasm = null; enc = await make(ep); };
    try { enc = gpu ? await slow(make(ep), GPU_WAIT) : await make(ep); } catch (e) { if (!gpu || e.stuck) { if (e.stuck) toWasm = null; throw e; } await toWasm(e); }
    const dec = async f => ort.InferenceSession.create(await (await fetch((root.SITE && SITE.models ? SITE.models : 'models/') + f)).arrayBuffer(), { executionProviders: ['wasm'] });
    [decS, decM] = await Promise.all([dec('decoder_single.onnx'), dec('decoder_multi.onnx')]);
    return ep;
  }

  function setPhoto(img, key = 'edit') {   // img：已載入的 Image／ImageBitmap／畫布
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
    photos.set(key, { key, w: img.width, h: img.height, ctx });
    for (const k of [...pool.keys()]) if (k.startsWith(key + '|')) pool.delete(k);
  }

  // 以點為中心、邊長 size 的視窗（位置貼著 256 px 格線，貼著照片邊界時往內移）→ [x0, y0, x1, y1]
  function windowAt(pt, size, ph = photo) {
    const w = Math.min(size, ph.w), h = Math.min(size, ph.h);
    const x0 = Math.min(Math.max(Math.round((pt[0] - w / 2) / STEP) * STEP, 0), ph.w - w);
    const y0 = Math.min(Math.max(Math.round((pt[1] - h / 2) / STEP) * STEP, 0), ph.h - h);
    return [x0, y0, x0 + w, y0 + h];
  }

  // 視窗縮成長邊 1024、貼左上、其餘補灰 114（ultralytics 的 LetterBox）、正規化 → 編碼
  async function encode(win) {
    const key = photo.key + '|' + win.join(',');
    if (pool.has(key)) { const v = pool.get(key); pool.delete(key); pool.set(key, v); return v; }
    const [x0, y0, x1, y1] = win, w = x1 - x0, h = y1 - y0, s = SIDE / Math.max(w, h), rw = Math.round(w * s), rh = Math.round(h * s);
    const c = new OffscreenCanvas(SIDE, SIDE), cx = c.getContext('2d', { willReadFrequently: true });
    cx.fillStyle = 'rgb(114,114,114)'; cx.fillRect(0, 0, SIDE, SIDE);
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(photo.ctx.canvas, x0, y0, w, h, 0, 0, rw, rh);
    const px = cx.getImageData(0, 0, SIDE, SIDE).data, x = new Float32Array(3 * SIDE * SIDE), n = SIDE * SIDE;
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) x[k * n + i] = (px[i * 4 + k] / 255 - MEAN[k]) / STD[k];
    const feed = () => enc.run({ pixel_values: new ort.Tensor('float32', x, [1, 3, SIDE, SIDE]) });
    let o; try { o = await (ep === 'webgpu' && toWasm ? slow(feed(), GPU_WAIT) : feed()); } catch (e) { if (ep !== 'webgpu' || !toWasm || e.stuck) throw e; await toWasm(e); o = await feed(); }
    toWasm = null;   // 跑過一次就不用再留著模型的位元組（300 MB）
    const v = { win, s, f: [o['image_embeddings.0'], o['image_embeddings.1'], o['image_embeddings.2']] };
    pool.set(key, v);
    while (pool.size > POOL_MAX) pool.delete(pool.keys().next().value);
    return v;
  }

  // 解碼：points（視窗座標，[[x, y, 標籤]]）→ 遮罩們 [{ w, h, d }]（視窗大小，logits > 0）
  // region（視窗座標 [rx0, ry0, rx1, ry1]）：只算這一塊，遮罩就是這塊的大小；不給就是整個視窗
  async function decode(v, session, pts, region) {
    const [x0, y0, x1, y1] = v.win, W = x1 - x0, H = y1 - y0, [rx0, ry0, rx1, ry1] = region || [0, 0, W, H], w = rx1 - rx0, h = ry1 - ry0, n = pts.length, P = new Float32Array(n * 2), L = new Int32Array(n);
    pts.forEach((p, i) => { P[2 * i] = p[0] * v.s; P[2 * i + 1] = p[1] * v.s; L[i] = p[2]; });
    const o = await session.run({ f0: v.f[0], f1: v.f[1], embed: v.f[2], points: new ort.Tensor('float32', P, [1, n, 2]), labels: new ort.Tensor('int32', L, [1, n]) });
    const lg = o.masks.data, k = o.masks.dims[1], out = [];
    for (let c = 0; c < k; c++) {
      const m = G.mk(w, h), base = c * 65536;
      for (let y = 0; y < h; y++) {
        const fy = ((y + ry0 + 0.5) * v.s - 0.5 + 0.5) / 4 - 0.5, iy = Math.floor(fy), ty = fy - iy, ya = Math.max(0, Math.min(255, iy)), yb = Math.max(0, Math.min(255, iy + 1));
        for (let x = 0; x < w; x++) {
          const fx = ((x + rx0 + 0.5) * v.s - 0.5 + 0.5) / 4 - 0.5, ix = Math.floor(fx), tx = fx - ix, xa = Math.max(0, Math.min(255, ix)), xb = Math.max(0, Math.min(255, ix + 1));
          const val = (lg[base + ya * 256 + xa] * (1 - tx) + lg[base + ya * 256 + xb] * tx) * (1 - ty) + (lg[base + yb * 256 + xa] * (1 - tx) + lg[base + yb * 256 + xb] * tx) * ty;
          m.d[y * w + x] = val > 0 ? 1 : 0;
        }
      }
      out.push(m);
    }
    return out;
  }

  // 遮罩裁到有東西的範圍（外面留 16 格）：後面的補洞、開運算、輪廓都只算這一小塊，不用掃整個視窗
  function crop(m) {
    let x0 = m.w, y0 = m.h, x1 = -1, y1 = -1;
    for (let y = 0; y < m.h; y++) { const r = y * m.w; for (let x = 0; x < m.w; x++) if (m.d[r + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
    if (x1 < 0) return null;
    x0 = Math.max(0, x0 - 16); y0 = Math.max(0, y0 - 16); x1 = Math.min(m.w - 1, x1 + 16); y1 = Math.min(m.h - 1, y1 + 16);
    const o = G.mk(x1 - x0 + 1, y1 - y0 + 1);
    for (let y = y0; y <= y1; y++) o.d.set(m.d.subarray(y * m.w + x0, y * m.w + x1 + 1), (y - y0) * o.w);
    return { m: o, ox: x0, oy: y0 };
  }

  // 點一下就描：先用 1024 視窗（原解析度）算幾個大小不同的候選；最大的碰到視窗邊界（比視窗大的 Volume）再加 2048 視窗的候選
  const trace = pt => serial(async () => {
    use('edit');
    const out = [];
    for (const size of [1024, 2048]) {
      const win = windowAt(pt, size), v = await encode(win), p = [pt[0] - win[0], pt[1] - win[1]];
      let touch = false;
      const W = win[2] - win[0], H = win[3] - win[1];
      for (const raw of await decode(v, decM, [[p[0], p[1], 1]])) {
        const c = crop(raw); if (!c) continue;
        const m = G.cleanMask(c.m, [p[0] - c.ox, p[1] - c.oy]); if (!m) continue;
        let x0 = m.w, y0 = m.h, x1 = -1, y1 = -1;
        for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.d[y * m.w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        touch = touch || x0 + c.ox <= 1 || y0 + c.oy <= 1 || x1 + c.ox >= W - 2 || y1 + c.oy >= H - 2;
        const poly = G.maskToPoly(m, 1, win[0] + c.ox, win[1] + c.oy); if (poly) out.push({ poly, area: G.count(m) });
      }
      if (!touch) break;
    }
    out.sort((a, b) => a.area - b.area);
    const keep = []; for (const c of out) if (!keep.length || c.area > keep[keep.length - 1].area * 1.08) keep.push(c);   // 面積差不到 8% 當同一個
    return { cands: keep };
  });

  const warm = pt => serial(async () => { use('edit'); await encode(windowAt(pt, 1024)); });

  // 手畫的大概範圍 → 貼齊邊緣：外框當框、範圍裡離邊界最遠的幾個點當正向提示；描出來跟手畫的重疊不到 6 成就回 null
  const fit = poly => serial(async () => {
    use('edit');
    const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]), lo = [Math.min(...xs), Math.min(...ys)], hi = [Math.max(...xs), Math.max(...ys)];
    const side = Math.max(hi[0] - lo[0], hi[1] - lo[1]), size = side * 1.25 <= 1024 ? 1024 : side * 1.25 <= 2048 ? 2048 : 3072;
    const win = windowAt([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2], size), v = await encode(win), ox = win[0], oy = win[1], W = win[2] - ox, H = win[3] - oy;
    const L = poly.map(p => [p[0] - ox, p[1] - oy]), m0 = G.fillPoly(G.mk(W, H), L);
    const dist = chamfer(m0), pts = [];
    for (let k = 0; k < 4; k++) {   // 範圍裡離邊界最遠的幾個點（彼此隔開）
      let bi = 0, bv = -1; for (let i = 0; i < dist.length; i++) if (dist[i] > bv) { bv = dist[i]; bi = i; }
      if (bv < 3) break;
      const x = bi % W, y = (bi - x) / W; pts.push([x, y]);
      const rr = Math.max(8, Math.floor(bv));
      for (let yy = Math.max(0, y - rr); yy <= Math.min(H - 1, y + rr); yy++) for (let xx = Math.max(0, x - rr); xx <= Math.min(W - 1, x + rr); xx++) if ((xx - x) ** 2 + (yy - y) ** 2 <= rr * rr) dist[yy * W + xx] = 0;
    }
    if (!pts.length) return null;
    const pad = 0.04 * side, box = [Math.min(...L.map(p => p[0])) - pad, Math.min(...L.map(p => p[1])) - pad, Math.max(...L.map(p => p[0])) + pad, Math.max(...L.map(p => p[1])) + pad];
    const raw = (await decode(v, decS, [[box[0], box[1], 2], [box[2], box[3], 3], ...pts.map(p => [p[0], p[1], 1])]))[0];
    const c = crop(raw); if (!c) return null;
    const m = G.cleanMask(c.m, [pts[0][0] - c.ox, pts[0][1] - c.oy]);
    if (!m) return null;
    let i = 0, u = 0;   // 跟手畫範圍（在整個視窗座標）算重疊
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const a = m0.d[y * W + x], b = x >= c.ox && y >= c.oy && x < c.ox + m.w && y < c.oy + m.h ? m.d[(y - c.oy) * m.w + x - c.ox] : 0; i += a & b; u += a | b; }
    if (i / Math.max(1, u) < 0.6) return null;
    return G.maskToPoly(m, 1, ox + c.ox, oy + c.oy);
  });

  function chamfer(m) {   // 到背景的距離（3-4 倒角，單位 px）
    const W = m.w, H = m.h, d = new Float32Array(W * H);
    for (let i = 0; i < d.length; i++) d[i] = m.d[i] ? 1e6 : 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!d[i]) continue;
      let v = d[i];
      v = Math.min(v, x > 0 ? d[i - 1] + 3 : 3, y > 0 ? d[i - W] + 3 : 3, x > 0 && y > 0 ? d[i - W - 1] + 4 : 4, x < W - 1 && y > 0 ? d[i - W + 1] + 4 : 4);
      d[i] = v;
    }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x; if (!d[i]) continue;
      let v = d[i];
      v = Math.min(v, x < W - 1 ? d[i + 1] + 3 : 3, y < H - 1 ? d[i + W] + 3 : 3, x < W - 1 && y < H - 1 ? d[i + W + 1] + 4 : 4, x > 0 && y < H - 1 ? d[i + W - 1] + 4 : 4);
      d[i] = v;
    }
    for (let i = 0; i < d.length; i++) d[i] /= 3;
    return d;
  }

  // 讓出主執行緒用 MessageChannel：setTimeout 在背景分頁會被限制成每秒一次（久了更慢），整批會跟著慢到 1/4
  const yieldNow = () => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => { c.port1.close(); r(); }; c.port2.postMessage(0); });

  // 整面牆逐顆重描：偵測框 [[x0, y0, x1, y1, score], …]（照片座標）→ [{ id, poly, source, score, flags }]。
  // 框依視窗分組，同一個視窗只編碼一次（最近用過的 4 個視窗留著）；每顆用「框＋框中心的點」解碼，再用只有框解碼一次，
  // 兩個遮罩對不上（重疊低於 0.97，小岩點低於 0.98）就標旗，低於 0.8 的標「候選對不上」、其餘「邊緣不確定」，描不出來退回框內切橢圓並標「退回橢圓」，框跟遮罩外接框對不上標「分數低」。
  // key：用哪張照片（setPhoto 的 key）；onItem(第幾個框, 結果)：每描完一顆就給，存起來，下次只描沒描過的；旗標要全部描完再用 flagAll 補
  // 偵測框要的視窗大小：框的 1.5 倍放得進 1024 就用 1024，不然 2048、3072
  const sizeFor = b => { const side = Math.max(b[2] - b[0], b[3] - b[1]); return side * 1.5 <= 1024 ? 1024 : side * 1.25 <= 2048 ? 2048 : 3072; };
  // 整面牆重描要編碼幾個視窗（每個約 2.3 秒 WebGPU、5.5 秒 WASM），事先估時間用
  async function estimate(boxes, w, h) {
    const wins = new Set(boxes.map(b => windowAt([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], sizeFor(b), { w, h }).join(','))).size;
    let gpu = false; try { gpu = localStorage.getItem(NO_GPU) !== '1' && !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch (e) { gpu = false; }
    return { windows: wins, seconds: wins * (gpu ? 2.3 : 5.5), gpu };
  }
  // 模型（編碼器）下載過了沒
  async function isCached() {
    try {
      const dir = await navigator.storage.getDirectory();
      for (const n of [`${ENC}.onnx`, `${ENC}.onnx_data`]) { const size = +await (await (await dir.getFileHandle(n + '.ok')).getFile()).text(); if ((await (await dir.getFileHandle(n)).getFile()).size !== size) return false; }
      return true;
    } catch (e) { return false; }
  }

  async function refineBoxes(boxes, progress = () => {}, shouldStop = () => false, { key = 'batch', onItem = () => {} } = {}) {
    const ph = photos.get(key); if (!ph) throw new Error(T('hlPhotoNotLoaded'));
    const items = boxes.map((b, i) => {
      const size = sizeFor(b);
      return { b, i, size, win: windowAt([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], size, ph) };
    }).sort((p, q) => p.size - q.size || p.win[1] - q.win[1] || p.win[0] - q.win[0]);
    const out = new Array(boxes.length); let done = 0;
    for (const it of items) {
      if (shouldStop()) throw Object.assign(new Error(T('hlStopped')), { stopped: true });
      out[it.i] = await serial(async () => {
        use(key);
        const v = await encode(it.win), [bx0, by0, bx1, by1] = it.b, ox = it.win[0], oy = it.win[1], W = it.win[2] - ox, H = it.win[3] - oy;
        const bw = bx1 - bx0, bh = by1 - by0, mg = Math.max(16, 0.25 * Math.max(bw, bh));
        const reg = [Math.max(0, Math.floor(bx0 - ox - mg)), Math.max(0, Math.floor(by0 - oy - mg)), Math.min(W, Math.ceil(bx1 - ox + mg)), Math.min(H, Math.ceil(by1 - oy + mg))];
        const box = [bx0 - ox, by0 - oy, bx1 - ox, by1 - oy], ctr = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
        const prompt = extra => [[box[0], box[1], 2], [box[2], box[3], 3], ...extra];
        const a = (await decode(v, decS, prompt([[ctr[0], ctr[1], 1]]), reg))[0], c = (await decode(v, decS, prompt([]), reg))[0];
        const cc = [ctr[0] - reg[0], ctr[1] - reg[1]], flags = [];
        const ma = G.cleanMask(a, cc), mc = G.cleanMask(c, cc);
        let poly = ma && G.maskToPoly(ma, 1, ox + reg[0], oy + reg[1]), score = 0;
        if (!poly) {
          const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2; poly = Array.from({ length: 16 }, (_, k) => [Math.round((cx + bw / 2 * Math.cos(k * Math.PI / 8)) * 10) / 10, Math.round((cy + bh / 2 * Math.sin(k * Math.PI / 8)) * 10) / 10]);
          flags.push('退回橢圓');
        } else {
          let i = 0, u = 0; for (let k = 0; k < ma.d.length; k++) { const q = mc ? mc.d[k] : 0; i += ma.d[k] & q; u += ma.d[k] | q; }
          score = mc ? i / Math.max(1, u) : 0;
          const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]), iw = Math.min(Math.max(...xs), bx1) - Math.max(Math.min(...xs), bx0), ih = Math.min(Math.max(...ys), by1) - Math.max(Math.min(...ys), by0);
          const uni = (Math.max(Math.max(...xs), bx1) - Math.min(Math.min(...xs), bx0)) * (Math.max(Math.max(...ys), by1) - Math.min(Math.min(...ys), by0));
          if (iw <= 0 || ih <= 0 || iw * ih / uni < 0.5) flags.push('分數低');
        }
        return { poly, score: Math.round(score * 1000) / 1000, det: it.b[4], flags };
      });
      onItem(it.i, out[it.i]);
      progress(++done, items.length);
      await yieldNow();   // 讓出主執行緒，進度和按鈕才會動
    }
    return out;
  }
  // 整面牆描完才標的旗標（要整面牆的面積中位數）：results 是 refineBoxes 的結果，直接改它的 flags
  function flagAll(out) {
    // 旗標：兩次解碼的重疊（score）是最準的訊號。南港實測（跟人工答案差超過兩成的 81 顆）：score < 0.97 標 55 顆、抓到 42 顆、精確率 76%；
    // 再加「小岩點（面積不到中位數的 0.7）且 score < 0.98」共標 63 顆、抓到 47 顆。跟周圍岩點重疊、顏色對比、邊緣強度都沒有幫助
    const areas = out.map(r => Math.abs(G.area(r.poly))).sort((p, q) => p - q), med = areas[areas.length >> 1];
    for (const r of out) {
      if (r.det < 0.6) r.flags.push('偵測信心低');
      if (r.flags.includes('退回橢圓')) continue;
      const small = Math.abs(G.area(r.poly)) < 0.7 * med;
      if (r.score < 0.97 || (small && r.score < 0.98)) r.flags.push(r.score < 0.8 ? '候選對不上' : '邊緣不確定');
    }
    return out;
  }

  root.RefineSam = { refineBoxes, flagAll, estimate, isCached, load, setPhoto, trace, warm, fit, get provider() { return ep; } };
})(globalThis);
