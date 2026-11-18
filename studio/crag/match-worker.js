// 照片辨識（Web Worker）：OpenCV.js 在這裡跑。它的 Embind 要用 new Function，頁面的 CSP 不允許；
// Worker 用自己回應的 CSP（網站只送 frame-ancestors），而且算特徵點、比對時畫面不會卡住。
//   features：照片（ImageData，長邊 ≤ 800）→ AKAZE 特徵點，留反應最強的 1500 個
//   match：漢明距離最近兩個的比值 < 0.75，單應性 RANSAC（5 px）的內點數是分數
// English: OpenCV.js runs in this worker (Embind needs eval, which the page CSP forbids).
const CV = '../../redpoint/vendor/opencv-4.10.0.js';
const KEEP = 1500, RATIO = 0.75, RANSAC_PX = 5;
let ready;

/** 載入 OpenCV.js，等 WebAssembly 初始化完（回傳 { cv }：cv 自己有 then，直接當 Promise 的結果會被當成 thenable 卡住） */
async function load() {
  importScripts(CV);
  for (let i = 0; i < 300 && !self.cv.Mat; i++) await new Promise((r) => setTimeout(r, 100));
  if (!self.cv.Mat) throw new Error('init-timeout');
  return { cv: self.cv };
}

function features(cv, image) {
  const src = cv.matFromImageData(image), gray = new cv.Mat(), none = new cv.Mat(), kps = new cv.KeyPointVector(), desc = new cv.Mat();
  const akaze = new cv.AKAZE();
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    akaze.setThreshold(0.0005);
    akaze.detectAndCompute(gray, none, kps, desc);
    const keep = Array.from({ length: kps.size() }, (_, i) => [i, kps.get(i)]).sort((a, b) => b[1].response - a[1].response).slice(0, KEEP);
    const cols = desc.cols, pts = new Float32Array(keep.length * 2), d = new Uint8Array(keep.length * cols);
    keep.forEach(([i, kp], j) => {
      pts[2 * j] = kp.pt.x;
      pts[2 * j + 1] = kp.pt.y;
      d.set(desc.data.subarray(i * cols, (i + 1) * cols), j * cols);
    });
    return { n: keep.length, cols, pts, desc: d };
  } finally {
    for (const m of [src, gray, none, kps, desc, akaze]) m.delete();
  }
}

const descMat = (cv, f) => cv.matFromArray(f.n, f.cols, cv.CV_8U, f.desc);

/** 比值檢定過的對應點（便宜：只比描述子）：{ src, dst }，座標是縮圖座標 */
function pairsOf(cv, bf, r, q, qd) {
  const out = { src: [], dst: [] };
  if (r.n < 8 || q.n < 8) return out;
  const rd = descMat(cv, r), pairs = new cv.DMatchVectorVector(), { src, dst } = out;
  try {
    bf.knnMatch(rd, qd, pairs, 2);
    for (let i = 0; i < pairs.size(); i++) {
      const p = pairs.get(i);
      if (p.size() < 2) continue;
      const a = p.get(0), b = p.get(1);
      if (a.distance >= RATIO * b.distance) continue;
      src.push(r.pts[2 * a.queryIdx], r.pts[2 * a.queryIdx + 1]);
      dst.push(q.pts[2 * a.trainIdx], q.pts[2 * a.trainIdx + 1]);
    }
  } finally {
    rd.delete();
    pairs.delete();
  }
  return out;
}

/** 單應性 RANSAC（比較貴，只對對應點最多的幾張做）：{ inliers, H }，H 是縮圖座標之間的單應性（3×3，列優先） */
function ransac(cv, { src, dst }) {
  if (src.length < 16) return { inliers: 0 };
  const s = cv.matFromArray(src.length / 2, 1, cv.CV_32FC2, src), d = cv.matFromArray(dst.length / 2, 1, cv.CV_32FC2, dst), mask = new cv.Mat();
  try {
    const H = cv.findHomography(s, d, cv.RANSAC, RANSAC_PX, mask);
    const h = H.empty() ? null : Array.from(H.data64F);
    H.delete();
    return h ? { inliers: mask.data.reduce((n, v) => n + (v ? 1 : 0), 0), H: h } : { inliers: 0 };
  } finally {
    for (const m of [s, d, mask]) m.delete();
  }
}

/** 粗比：每張只用最強的 COARSE 個特徵點（特徵點是照反應由強到弱排的），數比值檢定過的對應點；比完整比對快 COARSE²／n² 倍 */
const COARSE = 300;
function coarseCount(cv, bf, r, qdCoarse) {
  const n = Math.min(COARSE, r.n);
  if (n < 8) return 0;
  const rd = cv.matFromArray(n, r.cols, cv.CV_8U, r.desc.subarray(0, n * r.cols)), pairs = new cv.DMatchVectorVector();
  let count = 0;
  try {
    bf.knnMatch(rd, qdCoarse, pairs, 2);
    for (let i = 0; i < pairs.size(); i++) {
      const p = pairs.get(i);
      if (p.size() >= 2 && p.get(0).distance < RATIO * p.get(1).distance) count++;
    }
  } finally {
    rd.delete();
    pairs.delete();
  }
  return count;
}

/** 手機上最貴的就是這裡，所以分兩段：先粗比所有參考照片，只對最像的 TOP_K 張（呼叫的人可以給 topK）做完整比對和 RANSAC；其他的內點算 0（反正排在後面） */
const TOP_K = 4;
function match(cv, q, refs, topK = TOP_K) {
  const nq = Math.min(COARSE, q.n), qdCoarse = cv.matFromArray(nq, q.cols, cv.CV_8U, q.desc.subarray(0, nq * q.cols));
  const qd = descMat(cv, q), bf = new cv.BFMatcher(cv.NORM_HAMMING, false);
  try {
    const coarse = refs.map(({ id, f }) => ({ id, f, count: q.n < 8 ? 0 : coarseCount(cv, bf, f, qdCoarse) }));
    const top = new Map(coarse.sort((a, b) => b.count - a.count).slice(0, topK).map((x) => [x.id, x.f]));
    return refs.map(({ id }) => ({ id, ...(top.has(id) ? ransac(cv, pairsOf(cv, bf, top.get(id), q, qd)) : { inliers: 0 }) }));
  } finally {
    qdCoarse.delete();
    qd.delete();
    bf.delete();
  }
}

self.onmessage = async ({ data: { id, op, image, q, refs, top } }) => {
  let cv;
  try {
    ({ cv } = await (ready ??= load()));
  } catch (e) {
    ready = undefined;
    return self.postMessage({ id, error: e.message, code: 'offline', kind: 'load' });
  }
  try {
    if (op === 'features') {
      const f = features(cv, image);
      self.postMessage({ id, result: f }, [f.pts.buffer, f.desc.buffer]);
    } else self.postMessage({ id, result: match(cv, q, refs, top) });
  } catch (e) {
    self.postMessage(typeof e === 'number' ? { id, error: e, kind: 'cv' } : { id, error: e.message });
  }
};
