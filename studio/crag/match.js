// 照片辨識：兩張照片比對特徵點，找出是不是同一面岩壁、算出對位（Studio Crag 找原圖用；紅點貓已不做拍照辨識）。
//   OpenCV.js（redpoint/vendor/opencv-4.10.0.js，10 MB，3D 追蹤也用）在 match-worker.js 裡跑，第一次用到才載入
//   照片縮到長邊 800 算 AKAZE 特徵點；分數是單應性 RANSAC 的內點數
//   判斷：最高 ≥ 30 且至少是第二名的 3 倍才算找到；≥ 12 的列成候選讓人選；都沒有就是找不到。沒把握不硬疊
// English: on-device wall recognition (AKAZE + homography RANSAC in a worker) against reference topos.
const T = (...a) => globalThis.AppKit.i18n.t(...a);
const WORKER = new URL('match-worker.js', import.meta.url).href;
const EDGE = 800, FOUND = 30, LEAD = 3, CANDIDATE = 12;

let worker, seq = 0;
const waiting = new Map();

/** Worker 回報的錯誤文字（Worker 裡沒有語言包：load＝載入失敗、cv＝OpenCV 的錯誤代碼） */
const workerMessage = ({ kind, error }) => (kind === 'load' ? T('cgMatchLoadFailed', error === 'init-timeout' ? T('cgMatchInitTimeout') : error) : kind === 'cv' ? T('cgMatchCvError', error) : error);

function start() {
  const w = new Worker(WORKER);
  w.onmessage = ({ data }) => {
    const p = waiting.get(data.id);
    waiting.delete(data.id);
    if (data.error) p.bad(Object.assign(new Error(workerMessage(data)), { code: data.code }));
    else p.ok(data.result);
  };
  w.onerror = (e) => {
    e.preventDefault();
    for (const p of waiting.values()) p.bad(Object.assign(new Error(T('cgMatchLoadFail')), { code: 'offline' }));
    waiting.clear();
    worker = undefined;
  };
  return w;
}

function call(msg, transfer = []) {
  worker ??= start();
  return new Promise((ok, bad) => {
    const id = ++seq;
    waiting.set(id, { ok, bad });
    worker.postMessage({ id, ...msg }, transfer);
  });
}

/** 照片的特徵點：w 是畫面的寬（座標系），回傳 { k（縮圖／畫面）, n, cols, pts（縮圖座標）, desc } */
export async function features(blob, w) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const s = Math.min(1, EDGE / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const image = g.getImageData(0, 0, c.width, c.height);
  return { k: c.width / w, ...(await call({ op: 'features', image }, [image.data.buffer])) };
}

/**
 * 拍的照片 q 跟每一張參考 [{ id, f }] 比對，回傳 { status: found／unsure／none, best?, candidates }；H 把參考畫面的座標換成拍的照片的座標。
 * min：候選至少幾個內點；top：粗比之後做完整比對的張數（預設 4，手機上快）。Climbio Studio 找原圖時兩個都放寬，之後自己再驗
 */
export async function match(q, refs, { min = CANDIDATE, top } = {}) {
  const scores = (await call({ op: 'match', q, refs, top })).map((s, i) => (s.H ? { ...s, H: toView(s.H, refs[i].f.k, q.k) } : s)).sort((a, b) => b.inliers - a.inliers);
  const candidates = scores.filter((s) => s.inliers >= min).slice(0, 3);
  const [best, second] = scores;
  if (best && best.inliers >= FOUND && best.inliers >= LEAD * (second?.inliers ?? 0)) return { status: 'found', best, candidates };
  return { status: candidates.length ? 'unsure' : 'none', candidates };
}

/** 縮圖座標換回畫面座標：H' = diag(1/kq) · H · diag(kr) */
const toView = (H, kr, kq) => H.map((v, i) => [1 / kq, 1 / kq, 1][Math.floor(i / 3)] * v * [kr, kr, 1][i % 3]);

const apply = (H, [x, y]) => {
  const w = H[6] * x + H[7] * y + H[8];
  return [Math.round(((H[0] * x + H[1] * y + H[2]) / w) * 10) / 10, Math.round(((H[3] * x + H[4] * y + H[5]) / w) * 10) / 10];
};
const mapCoords = (c, f) => (typeof c[0] === 'number' ? f(c) : c.map((x) => mapCoords(x, f)));

/** 參考照片上的標註投影到拍的照片上（其他欄位照舊） */
export const projectMarks = (marks = [], H) => marks.map((m) => ({ ...m, geometry: { ...m.geometry, coordinates: mapCoords(m.geometry.coordinates, (p) => apply(H, p)) } }));
