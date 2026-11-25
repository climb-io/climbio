// ArKit 的追蹤 Worker（2D 牆）：載入 OpenCV 4.10.0 WASM 與共用幾何檢查，執行多牆 AKAZE 粗篩＋精對、USAC_MAGSAC 單應矩陣與雙向 LK 光流維持。
'use strict';

importScripts('./geometry.js');

const G = self.Wall2dGeometry;
const SCHEMA_CAMERA = 'climbio-2d-tracking-camera/1';
const AKAZE_THRESHOLD = 0.0005;
const REF_MAX_FEATURES = 1600;
const COARSE_COUNT = 320;
const QUERY_MAX_FEATURES = 900;
const SEARCH_COOLDOWN_MS = 180;
const RATIO_FINE = 0.78;
const RATIO_COARSE = 0.80;
const MAX_HAMMING = 140;
const MAX_COARSE_HAMMING = 135;
const REANCHOR_INTERVAL = 45;
const MAX_FLOW_UNANCHORED = 90;
const MAX_TRACKED_POINTS = 90;
// 光流在 480 長邊的灰階上做（低階手機每次 LK 約 12 ms，640 長邊 21×21 視窗約 26 ms）；認牆、重錨仍用 640 長邊的擷取尺寸。
// 對外回報的單應矩陣一律換回擷取尺寸（capW×capH）的座標，主執行緒與重錨 Worker 不用知道光流的尺寸
const TRACK_LONG_SIDE = 480;
const LK_WIN = 15;
const LK_ITERS = 10;
// 補角點（goodFeaturesToTrack 約 17 ms）不每幀做：點數夠就跳過，不太夠時每 REFILL_EVERY 幀補一次
const REFILL_EVERY = 4;

let cv = null;
let walls = [];
let targetWall = 'auto';
let activeWall = null;
let previous = null;
let tracked = null;
let lastPose = null;
let lastSearch = -Infinity;
let framesSinceAnchor = 0;
let currentEpoch = 0;
let bgReanchorActive = false;
let framesSinceRefill = 0;
let yBuf = null;

function decodeBase64(b64, Typed) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Typed(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / Typed.BYTES_PER_ELEMENT));
}

function encodeBase64(typed) {
  const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** 依空間網格分層抽取 AKAZE 特徵：前 coarseCount 點平均覆蓋全牆供粗篩，其餘補滿細節 */
function extractGridAkaze(gray, maxFeatures, gridCols, gridRows, coarseCount = 0) {
  const det = new cv.AKAZE();
  det.setThreshold(AKAZE_THRESHOLD);
  const kps = new cv.KeyPointVector();
  const desc = new cv.Mat();
  const none = new cv.Mat();
  try {
    det.detectAndCompute(gray, none, kps, desc);
    const total = kps.size();
    const cols = desc.cols || 61;
    const w = gray.cols;
    const h = gray.rows;
    const buckets = Array.from({ length: gridCols * gridRows }, () => []);
    for (let i = 0; i < total; i++) {
      const kp = kps.get(i);
      const gx = Math.min(gridCols - 1, Math.max(0, Math.floor((kp.pt.x / w) * gridCols)));
      const gy = Math.min(gridRows - 1, Math.max(0, Math.floor((kp.pt.y / h) * gridRows)));
      buckets[gy * gridCols + gx].push([i, kp.response, kp.pt.x, kp.pt.y]);
    }
    for (const b of buckets) b.sort((a, b) => b[1] - a[1]);

    // 先從每格取最強幾點當作全域均勻粗篩子集，再補進剩餘點
    const selected = [];
    const used = new Set();
    if (coarseCount > 0) {
      const coarsePerCell = Math.max(1, Math.ceil(coarseCount / buckets.length));
      const coarsePool = [];
      for (const b of buckets) {
        for (let k = 0; k < Math.min(coarsePerCell, b.length); k++) coarsePool.push(b[k]);
      }
      coarsePool.sort((a, b) => b[1] - a[1]);
      for (const item of coarsePool.slice(0, coarseCount)) {
        selected.push(item);
        used.add(item[0]);
      }
    }

    const perBucket = Math.ceil(maxFeatures / buckets.length);
    const fineSelected = [];
    const leftover = [];
    for (const b of buckets) {
      let keptInBucket = 0;
      for (const item of b) {
        if (used.has(item[0])) {
          keptInBucket++;
          continue;
        }
        if (keptInBucket < perBucket) {
          fineSelected.push(item);
          keptInBucket++;
        } else {
          leftover.push(item);
        }
      }
    }
    const ordered = [...selected, ...fineSelected];
    if (ordered.length < maxFeatures && leftover.length) {
      leftover.sort((a, b) => b[1] - a[1]);
      for (const item of leftover) {
        if (ordered.length >= maxFeatures) break;
        ordered.push(item);
      }
    } else if (ordered.length > maxFeatures) {
      ordered.length = maxFeatures;
    }

    const xy = new Float32Array(ordered.length * 2);
    const outDesc = new cv.Mat(ordered.length, cols, cv.CV_8U);
    for (let j = 0; j < ordered.length; j++) {
      const [idx, , x, y] = ordered[j];
      xy[j * 2] = x;
      xy[j * 2 + 1] = y;
      outDesc.data.set(desc.data.subarray(idx * cols, idx * cols + cols), j * cols);
    }
    return {
      xy,
      desc: outDesc,
      n: ordered.length,
      cols,
      coarseN: Math.min(coarseCount || ordered.length, ordered.length),
      totalRaw: total,
    };
  } finally {
    det.delete();
    kps.delete();
    desc.delete();
    none.delete();
  }
}

function registerWall({ wallId, name, camera }) {
  if (!camera || camera.schema !== SCHEMA_CAMERA) {
    throw new Error(`不支援的 2D 相機比對格式：${camera?.schema || 'unknown'}`);
  }
  const ref = camera.references?.[0];
  if (!ref || !(ref.n > 0)) throw new Error(`牆面 ${wallId} 沒有參考特徵`);
  const photoW = Number(camera.photoW);
  const photoH = Number(camera.photoH);
  const normXy = decodeBase64(ref.xy, Float32Array);
  const descBytes = decodeBase64(ref.desc, Uint8Array);
  const descCols = Number(camera.descriptorBytes) || 61;
  if (normXy.length !== ref.n * 2 || descBytes.length !== ref.n * descCols) {
    throw new Error(`牆面 ${wallId} 特徵長度不符`);
  }
  // 預先轉成照片像素座標，單應矩陣直接對齊 wall.json 座標
  const xy = new Float32Array(ref.n * 2);
  for (let i = 0; i < ref.n; i++) {
    xy[i * 2] = normXy[i * 2] * photoW;
    xy[i * 2 + 1] = normXy[i * 2 + 1] * photoH;
  }
  const coarseN = Math.min(ref.n, Math.max(1, Number(camera.coarseCount) || COARSE_COUNT));
  const mat = cv.matFromArray(ref.n, descCols, cv.CV_8U, descBytes);
  const coarseMat = cv.matFromArray(coarseN, descCols, cv.CV_8U, descBytes.subarray(0, coarseN * descCols));

  const idx = walls.findIndex((w) => w.wallId === wallId);
  if (idx >= 0) {
    walls[idx].mat.delete();
    walls[idx].coarseMat.delete();
    walls.splice(idx, 1);
  }
  walls.push({
    wallId: String(wallId),
    name: String(name || wallId),
    photoW,
    photoH,
    n: ref.n,
    coarseN,
    xy,
    mat,
    coarseMat,
  });
}

function clearWalls() {
  for (const w of walls) {
    w.mat.delete();
    w.coarseMat.delete();
  }
  walls = [];
  resetTracking();
}

function resetTracking() {
  tracked = null;
  lastPose = null;
  activeWall = null;
  framesSinceAnchor = 0;
  lastSearch = -Infinity;
}

function coarseScore(queryDesc, wall) {
  const nq = Math.min(queryDesc.rows, COARSE_COUNT);
  if (nq < 2) return 0;
  const qSub = queryDesc.rowRange(0, nq);
  const bf = new cv.BFMatcher(cv.NORM_HAMMING, false);
  const knn = new cv.DMatchVectorVector();
  try {
    bf.knnMatch(qSub, wall.coarseMat, knn, 2);
    let hits = 0;
    for (let i = 0; i < knn.size(); i++) {
      const v = knn.get(i);
      if (v.size() === 2) {
        const a = v.get(0);
        const b = v.get(1);
        if (a.distance < RATIO_COARSE * b.distance && a.distance <= MAX_COARSE_HAMMING) hits++;
      }
      v.delete();
    }
    return hits;
  } finally {
    qSub.delete();
    bf.delete();
    knn.delete();
  }
}

function matchWall(qFeat, wall, qW, qH) {
  const bf = new cv.BFMatcher(cv.NORM_HAMMING, false);
  const knn = new cv.DMatchVectorVector();
  // 對同一顆參考特徵只保留距離最近的一次比對，抑制重複圖案（同色岩點、螺絲孔）多對一誤配
  const bestByTrain = new Map();
  try {
    bf.knnMatch(qFeat.desc, wall.mat, knn, 2);
    for (let i = 0; i < knn.size(); i++) {
      const v = knn.get(i);
      if (v.size() === 2) {
        const a = v.get(0);
        const b = v.get(1);
        if (a.distance < RATIO_FINE * b.distance && a.distance <= MAX_HAMMING) {
          const prev = bestByTrain.get(a.trainIdx);
          if (!prev || a.distance < prev.dist) {
            bestByTrain.set(a.trainIdx, { qIdx: a.queryIdx, tIdx: a.trainIdx, dist: a.distance });
          }
        }
      }
      v.delete();
    }
  } finally {
    bf.delete();
    knn.delete();
  }

  const matches = bestByTrain.size;
  if (matches < 16) return { ok: false, reason: 'insufficient_matches', matches };

  const src = [];
  const dst = [];
  for (const m of bestByTrain.values()) {
    src.push(wall.xy[m.tIdx * 2], wall.xy[m.tIdx * 2 + 1]);
    dst.push(qFeat.xy[m.qIdx * 2], qFeat.xy[m.qIdx * 2 + 1]);
  }

  const S = cv.matFromArray(matches, 1, cv.CV_32FC2, src);
  const D = cv.matFromArray(matches, 1, cv.CV_32FC2, dst);
  const mask = new cv.Mat();
  const method = typeof cv.USAC_MAGSAC === 'number' ? cv.USAC_MAGSAC : cv.RANSAC;
  const H = cv.findHomography(S, D, method, Math.max(4, Math.round(Math.max(qW, qH) * 0.009)), mask);
  try {
    if (H.empty() || H.rows !== 3 || H.cols !== 3) {
      return { ok: false, reason: 'homography_empty', matches, inliers: 0 };
    }
    const inlR = [];
    const inlQ = [];
    for (let i = 0; i < mask.rows; i++) {
      if (mask.data[i]) {
        inlR.push(src[i * 2], src[i * 2 + 1]);
        inlQ.push(dst[i * 2], dst[i * 2 + 1]);
      }
    }
    const inliers = inlQ.length / 2;
    if (matches >= 28 && inliers / matches < 0.24) {
      return { ok: false, reason: 'low_inlier_ratio', matches, inliers };
    }
    const Harr = Array.from(H.data64F);
    const v = G.verifyHomography(Harr, wall.photoW, wall.photoH, qW, qH, inlR, inlQ, {
      minInliers: 18,
      minCoverageQ: 0.04,
      minCoverageR: 0.02,
      minCells: 4,
      maxCond: 4.5,
      maxMedianError: 4.5,
    });
    if (!v.ok) {
      return { ok: false, reason: v.reason, matches, inliers, coverage: v.coverage ?? null };
    }
    return {
      ok: true,
      wall,
      H: Harr,
      Hinv: v.Hinv,
      inlR,
      inlQ,
      matches,
      inliers: v.inliers,
      coverage: v.coverage,
      medianError: v.medianError,
      cond: v.cond,
    };
  } finally {
    S.delete();
    D.delete();
    mask.delete();
    H.delete();
  }
}

function seedTrackedPoints(qGray, Hinv, refW, refH, inlR, inlQ, isAnchorArr = null, force = false) {
  const qW = qGray.cols;
  const qH = qGray.rows;
  const usedCells = new Set();
  const outR = [];
  const outQ = [];
  const anchor = [];

  // 先納入現有內點（依 8×6 網格最多每格留 3 點，避免過密）
  const cellCounts = new Map();
  for (let i = 0; i < inlQ.length / 2; i++) {
    const qx = inlQ[i * 2], qy = inlQ[i * 2 + 1];
    const cell = `${Math.floor((qx / qW) * 8)}:${Math.floor((qy / qH) * 6)}`;
    const c = cellCounts.get(cell) || 0;
    if (c >= 3) continue;
    cellCounts.set(cell, c + 1);
    usedCells.add(cell);
    outR.push(inlR[i * 2], inlR[i * 2 + 1]);
    outQ.push(qx, qy);
    anchor.push(isAnchorArr ? isAnchorArr[i] : 1);
    if (anchor.length >= MAX_TRACKED_POINTS) break;
  }

  // 若網格覆蓋不足，補入影像內的 Shi-Tomasi 角點並用 Hinv 映回參考座標：剛定位（force）或點太少時馬上補，
  // 只是略少時每 REFILL_EVERY 幀補一次
  framesSinceRefill++;
  const thin = anchor.length < 30 || usedCells.size < 8;
  const sparse = anchor.length < 55 || usedCells.size < 16;
  if (force || thin || (sparse && framesSinceRefill >= REFILL_EVERY)) {
    framesSinceRefill = 0;
    const corners = new cv.Mat();
    const mask = new cv.Mat();
    try {
      cv.goodFeaturesToTrack(qGray, corners, 120, 0.01, 10, mask, 3, false, 0.04);
      for (let i = 0; i < corners.rows && anchor.length < MAX_TRACKED_POINTS; i++) {
        const qx = corners.data32F[i * 2];
        const qy = corners.data32F[i * 2 + 1];
        if (qx < 10 || qy < 10 || qx > qW - 10 || qy > qH - 10) continue;
        const cell = `${Math.floor((qx / qW) * 8)}:${Math.floor((qy / qH) * 6)}`;
        if (usedCells.has(cell)) continue;
        const refPt = G.applyHomography(Hinv, qx, qy);
        if (!refPt) continue;
        const [rx, ry] = refPt;
        if (rx < 4 || ry < 4 || rx > refW - 4 || ry > refH - 4) continue;
        usedCells.add(cell);
        outR.push(rx, ry);
        outQ.push(qx, qy);
        anchor.push(0);
      }
    } finally {
      corners.delete();
      mask.delete();
    }
  }

  return { r: outR, q: outQ, anchor };
}

function trackOpticalFlow(qGray) {
  const qW = qGray.cols;
  const qH = qGray.rows;
  const n = tracked.q.length / 2;
  if (n < 16) return { ok: false, reason: 'insufficient_tracks' };

  const a = cv.matFromArray(n, 1, cv.CV_32FC2, tracked.q);
  const b = new cv.Mat();
  const st = new cv.Mat();
  const err = new cv.Mat();
  const back = new cv.Mat();
  const bst = new cv.Mat();
  const berr = new cv.Mat();
  const sz = new cv.Size(LK_WIN, LK_WIN);
  const crit = new cv.TermCriteria(cv.TERM_CRITERIA_COUNT + cv.TERM_CRITERIA_EPS, LK_ITERS, 0.01);

  const nextR = [];
  const nextQ = [];
  const nextA = [];
  try {
    cv.calcOpticalFlowPyrLK(previous, qGray, a, b, st, err, sz, 3, crit, 0, 0.0001);
    cv.calcOpticalFlowPyrLK(qGray, previous, b, back, bst, berr, sz, 3, crit, 0, 0.0001);
    for (let i = 0; i < n; i++) {
      const qx = b.data32F[i * 2];
      const qy = b.data32F[i * 2 + 1];
      if (!st.data[i] || !bst.data[i]) continue;
      if (Math.hypot(back.data32F[i * 2] - tracked.q[i * 2], back.data32F[i * 2 + 1] - tracked.q[i * 2 + 1]) > 1.5) continue;
      if (qx < 4 || qy < 4 || qx > qW - 4 || qy > qH - 4) continue;
      nextR.push(tracked.r[i * 2], tracked.r[i * 2 + 1]);
      nextQ.push(qx, qy);
      nextA.push(tracked.anchor[i]);
    }
  } finally {
    for (const m of [a, b, st, err, back, bst, berr]) m.delete();
  }

  const flowCount = nextQ.length / 2;
  if (flowCount < 16) return { ok: false, reason: 'insufficient_tracks', flowPoints: flowCount };

  const S = cv.matFromArray(flowCount, 1, cv.CV_32FC2, nextR);
  const D = cv.matFromArray(flowCount, 1, cv.CV_32FC2, nextQ);
  const mask = new cv.Mat();
  const H = cv.findHomography(S, D, cv.RANSAC, 2.4, mask);
  try {
    if (H.empty() || H.rows !== 3 || H.cols !== 3) {
      return { ok: false, reason: 'flow_homography_empty', flowPoints: flowCount };
    }
    const keepR = [];
    const keepQ = [];
    const keepA = [];
    for (let i = 0; i < mask.rows; i++) {
      if (mask.data[i]) {
        keepR.push(nextR[i * 2], nextR[i * 2 + 1]);
        keepQ.push(nextQ[i * 2], nextQ[i * 2 + 1]);
        keepA.push(nextA[i]);
      }
    }
    const Harr = Array.from(H.data64F);
    const v = G.verifyHomography(Harr, activeWall.photoW, activeWall.photoH, qW, qH, keepR, keepQ, {
      minInliers: 16,
      minCoverageQ: 0.035,
      minCoverageR: 0.015,
      minCells: 4,
      maxCond: 4.5,
      maxMedianError: 3.5,
    });
    if (!v.ok) {
      return { ok: false, reason: v.reason, flowPoints: flowCount, inliers: v.inliers };
    }
    let anchorCount = 0;
    for (const x of keepA) if (x) anchorCount++;
    return {
      ok: true,
      H: Harr,
      Hinv: v.Hinv,
      keepR,
      keepQ,
      keepA,
      flowPoints: flowCount,
      anchorCount,
      inliers: v.inliers,
      coverage: v.coverage,
      medianError: v.medianError,
      cond: v.cond,
    };
  } finally {
    S.delete();
    D.delete();
    mask.delete();
    H.delete();
  }
}

// 3×3 列優先單應矩陣換座標：q' = diag(sx, sy, 1)·q
function scaleQuery(H, sx, sy) {
  return [H[0] * sx, H[1] * sx, H[2] * sx, H[3] * sy, H[4] * sy, H[5] * sy, H[6], H[7], H[8]];
}
// 反矩陣（照片 ← 影格）配合影格座標換尺寸：Hinv' = Hinv·diag(1/sx, 1/sy, 1)
function scaleQueryInv(Hinv, sx, sy) {
  return [Hinv[0] / sx, Hinv[1] / sy, Hinv[2], Hinv[3] / sx, Hinv[4] / sy, Hinv[5], Hinv[6] / sx, Hinv[7] / sy, Hinv[8]];
}
function scalePoints(pts, sx, sy) {
  const out = new Array(pts.length);
  for (let i = 0; i < pts.length; i += 2) {
    out[i] = pts[i] * sx;
    out[i + 1] = pts[i + 1] * sy;
  }
  return out;
}

function copyPlane(dst, buf, offset, stride, rowBytes, rows) {
  if (stride === rowBytes) {
    dst.set(buf.subarray(offset, offset + rowBytes * rows));
    return;
  }
  for (let y = 0; y < rows; y++) dst.set(buf.subarray(offset + y * stride, offset + y * stride + rowBytes), y * rowBytes);
}

// 影格 → 擷取尺寸（capW×capH）的灰階 Mat。相機的 VideoFrame 若是 I420／NV12，直接取 Y 平面當灰階：
// 不經 canvas 讀回（低階 Android 在主執行緒 drawImage＋getImageData 一次約 65 ms，這裡約 2 ms）。
// 其他來源（模擬、測試照片、不支援 VideoFrame 的瀏覽器）仍收主執行緒擷取的 ImageData
async function captureGray(data) {
  if (!data.frame) {
    const src = cv.matFromImageData(data.image);
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    src.delete();
    return gray;
  }
  const f = data.frame;
  try {
    const w = f.visibleRect.width;
    const h = f.visibleRect.height;
    const fmt = String(f.format || '');
    const size = f.allocationSize();
    if (!yBuf || yBuf.length < size) yBuf = new Uint8Array(size);
    const layout = await f.copyTo(yBuf);
    let full;
    if (/^(I420|I420A|I422|I444|NV12)$/.test(fmt)) {
      full = new cv.Mat(h, w, cv.CV_8UC1);
      copyPlane(full.data, yBuf, layout[0].offset, layout[0].stride, w, h);
    } else if (/^(RGBA|RGBX|BGRA|BGRX)$/.test(fmt)) {
      const rgba = new cv.Mat(h, w, cv.CV_8UC4);
      copyPlane(rgba.data, yBuf, layout[0].offset, layout[0].stride, w * 4, h);
      full = new cv.Mat();
      cv.cvtColor(rgba, full, fmt.startsWith('B') ? cv.COLOR_BGRA2GRAY : cv.COLOR_RGBA2GRAY);
      rgba.delete();
    } else {
      throw new Error(`unsupported_frame_format:${fmt}`);
    }
    const capW = data.capW || w;
    const capH = data.capH || h;
    if (capW === w && capH === h) return full;
    const out = new cv.Mat();
    cv.resize(full, out, new cv.Size(capW, capH), 0, 0, cv.INTER_AREA);
    full.delete();
    return out;
  } finally {
    f.close();
  }
}

// 光流用的灰階：長邊縮到 TRACK_LONG_SIDE（新的 Mat，呼叫端負責 delete）
function trackSized(capGray) {
  const s = Math.min(1, TRACK_LONG_SIDE / Math.max(capGray.cols, capGray.rows));
  if (s >= 1) return capGray.clone();
  const out = new cv.Mat();
  cv.resize(capGray, out, new cv.Size(Math.max(1, Math.round(capGray.cols * s)), Math.max(1, Math.round(capGray.rows * s))), 0, 0, cv.INTER_LINEAR);
  return out;
}

function searchWalls(qGray, onlyWall = null) {
  const qW = qGray.cols;
  const qH = qGray.rows;
  const diag = {
    stage: 'search',
    reason: null,
    queryFeatures: 0,
    matchedPairs: 0,
    flowPoints: null,
    maxInliers: 0,
    coverage: null,
    medianError: null,
    coarseHits: [],
  };
  if (!walls.length) {
    diag.reason = 'no_walls';
    return { matched: false, diag };
  }

  const qFeat = extractGridAkaze(qGray, QUERY_MAX_FEATURES, 6, 4, 0);
  diag.queryFeatures = qFeat.n;
  try {
    if (qFeat.n < 16) {
      diag.reason = 'insufficient_features';
      return { matched: false, diag };
    }

    let candidates;
    if (onlyWall) {
      candidates = [onlyWall];
    } else if (targetWall !== 'auto') {
      const w = walls.find((x) => x.wallId === targetWall);
      candidates = w ? [w] : [];
    } else if (walls.length <= 2) {
      candidates = walls;
    } else {
      const scores = walls.map((w) => ({ w, hits: coarseScore(qFeat.desc, w) }));
      scores.sort((a, b) => b.hits - a.hits);
      diag.coarseHits = scores.slice(0, 3).map((s) => [s.w.wallId, s.hits]);
      candidates = scores.filter((s, idx) => idx < 2 && s.hits >= 3).map((s) => s.w);
      if (!candidates.length && scores.length) candidates = [scores[0].w];
    }

    let best = null;
    let lastReason = 'insufficient_matches';
    for (const w of candidates) {
      const m = matchWall(qFeat, w, qW, qH);
      diag.matchedPairs = Math.max(diag.matchedPairs, m.matches || 0);
      diag.maxInliers = Math.max(diag.maxInliers, m.inliers || 0);
      if (!m.ok) {
        lastReason = m.reason;
        continue;
      }
      if (!best || m.inliers > best.inliers) best = m;
      if (best.inliers >= 120) break;
    }

    if (!best) {
      diag.reason = lastReason;
      return { matched: false, diag };
    }
    diag.reason = 'pose';
    diag.coverage = best.coverage;
    diag.medianError = best.medianError;
    return { matched: true, best, diag };
  } finally {
    qFeat.desc.delete();
  }
}

async function waitOpenCv(runtimeUrl) {
  importScripts(runtimeUrl);
  for (let i = 0; i < 400 && !(self.cv && self.cv.AKAZE && self.cv.calcOpticalFlowPyrLK); i++) {
    await new Promise((r) => setTimeout(r, 30));
  }
  if (!(self.cv && self.cv.AKAZE)) throw new Error('OpenCV WASM 初始化逾時');
  try { delete self.cv.then; } catch { /* 避免 Emscripten thenable 阻塞 */ }
  cv = self.cv;
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      await waitOpenCv(data.runtimeUrl || '../redpoint/vendor/opencv-4.10.0.js');
      clearWalls();
      for (const w of data.walls || []) registerWall(w);
      if (data.targetWall) targetWall = data.targetWall;
      bgReanchorActive = !!data.bgReanchor;
      self.postMessage({ type: 'ready', wallCount: walls.length });
      return;
    }
    if (data.type === 'set_bg_reanchor') {
      bgReanchorActive = !!data.enabled;
      return;
    }
    if (data.type === 'apply_anchor') {
      if (!tracked || !activeWall || data.epoch !== currentEpoch || data.wallId !== activeWall.wallId) return;
      const Cinv = G.invert3x3(data.C);
      if (!Cinv) return;
      for (let i = 0; i < tracked.r.length; i += 2) {
        const pt = G.applyHomography(Cinv, tracked.r[i], tracked.r[i + 1]);
        if (pt) {
          tracked.r[i] = pt[0];
          tracked.r[i + 1] = pt[1];
          tracked.anchor[i >> 1] = 1;
        }
      }
      framesSinceAnchor = 0;
      return;
    }
    if (data.type === 'reanchor_frame') {
      const w = walls.find((x) => x.wallId === data.wallId);
      if (!w) {
        data.frame?.close();
        self.postMessage({ type: 'reanchor_result', matched: false, frameId: data.frameId, epoch: data.epoch, wallId: data.wallId });
        return;
      }
      let gray;
      try {
        gray = await captureGray(data);
      } catch {
        self.postMessage({ type: 'reanchor_result', matched: false, frameId: data.frameId, epoch: data.epoch, wallId: data.wallId });
        return;
      }
      try {
        const re = searchWalls(gray, w);
        if (re.matched) {
          const b = re.best;
          self.postMessage({
            type: 'reanchor_result',
            matched: true,
            frameId: data.frameId,
            epoch: data.epoch,
            wallId: b.wall.wallId,
            H: b.H,
            flowH: data.flowH,
            inliers: b.inliers,
            medianError: b.medianError,
          });
        } else {
          self.postMessage({ type: 'reanchor_result', matched: false, frameId: data.frameId, epoch: data.epoch, wallId: data.wallId });
        }
      } finally {
        gray.delete();
      }
      return;
    }
    if (data.type === 'set_target') {
      const next = data.targetWall || 'auto';
      if (next !== targetWall) {
        targetWall = next;
        resetTracking();
      }
      return;
    }
    if (data.type === 'add_wall') {
      registerWall(data.wall);
      lastSearch = -Infinity;
      self.postMessage({ type: 'wall_added', wallId: data.wall.wallId, wallCount: walls.length });
      return;
    }
    if (data.type === 'build_camera') {
      const { gray, width, height, fullWidth, fullHeight, wallId, name } = data;
      const grayMat = cv.matFromArray(height, width, cv.CV_8UC1, gray instanceof Uint8Array ? gray : new Uint8Array(gray));
      try {
        const feat = extractGridAkaze(grayMat, REF_MAX_FEATURES, 8, 6, COARSE_COUNT);
        const normXy = new Float32Array(feat.n * 2);
        for (let i = 0; i < feat.n; i++) {
          normXy[i * 2] = feat.xy[i * 2] / width;
          normXy[i * 2 + 1] = feat.xy[i * 2 + 1] / height;
        }
        const descBytes = feat.desc.data.slice(0, feat.n * feat.cols);
        feat.desc.delete();
        const camera = {
          schema: SCHEMA_CAMERA,
          wall: String(wallId),
          photoW: Number(fullWidth || width),
          photoH: Number(fullHeight || height),
          featureW: width,
          featureH: height,
          detector: 'AKAZE',
          threshold: AKAZE_THRESHOLD,
          descriptorBytes: feat.cols,
          coarseCount: feat.coarseN,
          references: [{
            id: 'frontal',
            n: feat.n,
            xy: encodeBase64(normXy),
            desc: encodeBase64(descBytes),
          }],
        };
        if (data.register !== false) {
          registerWall({ wallId, name: name || wallId, camera });
          lastSearch = -Infinity;
        }
        self.postMessage({ type: 'camera_built', id: data.id, camera });
      } finally {
        grayMat.delete();
      }
      return;
    }
    if (data.type === 'reset') {
      resetTracking();
      return;
    }
    if (data.type !== 'frame') {
      data.frame?.close();
      return;
    }
    currentEpoch = data.epoch ?? currentEpoch;

    const start = performance.now();
    let capGray;
    try {
      capGray = await captureGray(data);
    } catch (err) {
      if (!data.frame) throw err;
      // 這個瀏覽器的 VideoFrame 讀不出來：請主執行緒改用 canvas 擷取
      self.postMessage({ type: 'frame_error', frameId: data.frameId, epoch: data.epoch, error: String(err?.message || err) });
      return;
    }
    const capW = capGray.cols;
    const capH = capGray.rows;
    let gray = null;

    let pose = null;
    let mode = 'searching';
    let diagnostics = {
      stage: 'flow',
      reason: null,
      queryFeatures: null,
      matchedPairs: null,
      flowPoints: null,
      maxInliers: 0,
      coverage: null,
      medianError: null,
      coarseHits: [],
    };

    try {
      gray = trackSized(capGray);
      const qW = gray.cols;
      const qH = gray.rows;
      const sx = qW / capW;
      const sy = qH / capH;
      // 認牆的結果（擷取尺寸座標）換成光流尺寸後重新播種
      const seedFromSearch = (b) => seedTrackedPoints(
        gray, scaleQueryInv(b.Hinv, sx, sy), b.wall.photoW, b.wall.photoH,
        b.inlR, scalePoints(b.inlQ, sx, sy), null, true
      );

      // 1. 優先以雙向 LK 光流延續上一幀定位
      if (tracked && activeWall && previous && previous.cols === qW && previous.rows === qH) {
        const flowRes = trackOpticalFlow(gray);
        diagnostics.flowPoints = flowRes.flowPoints ?? 0;
        diagnostics.maxInliers = flowRes.inliers ?? 0;
        if (flowRes.ok) {
          framesSinceAnchor++;
          const needsAnchor = flowRes.anchorCount < 10 || framesSinceAnchor >= REANCHOR_INTERVAL;
          let anchored = false;
          if (needsAnchor && !bgReanchorActive) {
            const re = searchWalls(capGray, activeWall);
            if (re.matched) {
              const b = re.best;
              tracked = seedFromSearch(b);
              framesSinceAnchor = 0;
              anchored = true;
              mode = 'tracking';
              pose = {
                wallId: b.wall.wallId,
                wallName: b.wall.name,
                H: b.H,
                photoW: b.wall.photoW,
                photoH: b.wall.photoH,
                width: capW,
                height: capH,
                inliers: b.inliers,
                medianError: b.medianError,
                coverage: b.coverage,
                cond: b.cond,
                reanchored: true,
              };
              diagnostics = { ...re.diag, stage: 'reanchor', flowPoints: flowRes.flowPoints };
            }
          }
          if (!anchored) {
            if (framesSinceAnchor >= MAX_FLOW_UNANCHORED) {
              diagnostics.reason = 'unanchored_expired';
              tracked = null;
              activeWall = null;
            } else {
              tracked = seedTrackedPoints(
                gray, flowRes.Hinv, activeWall.photoW, activeWall.photoH,
                flowRes.keepR, flowRes.keepQ, flowRes.keepA
              );
              mode = 'tracking';
              pose = {
                wallId: activeWall.wallId,
                wallName: activeWall.name,
                H: scaleQuery(flowRes.H, 1 / sx, 1 / sy),
                photoW: activeWall.photoW,
                photoH: activeWall.photoH,
                width: capW,
                height: capH,
                inliers: flowRes.inliers,
                medianError: flowRes.medianError / sx,
                coverage: flowRes.coverage,
                cond: flowRes.cond,
                reanchored: false,
                needsAnchor,
              };
              diagnostics.reason = 'pose';
              diagnostics.coverage = flowRes.coverage;
              diagnostics.medianError = flowRes.medianError / sx;
            }
          }
        } else {
          diagnostics.reason = flowRes.reason;
          tracked = null;
          activeWall = null;
        }
      }

      // 2. 光流未定位時，於冷卻時間過後執行 AKAZE 特徵比對與單應矩陣搜尋（擷取尺寸，特徵比光流尺寸多）
      const now = performance.now();
      if (!pose && now - lastSearch >= SEARCH_COOLDOWN_MS) {
        lastSearch = now;
        const found = searchWalls(capGray, null);
        diagnostics = found.diag;
        if (found.matched) {
          const b = found.best;
          activeWall = b.wall;
          tracked = seedFromSearch(b);
          framesSinceAnchor = 0;
          mode = 'localized';
          pose = {
            wallId: b.wall.wallId,
            wallName: b.wall.name,
            H: b.H,
            photoW: b.wall.photoW,
            photoH: b.wall.photoH,
            width: capW,
            height: capH,
            inliers: b.inliers,
            medianError: b.medianError,
            coverage: b.coverage,
            cond: b.cond,
            reanchored: true,
          };
        } else {
          tracked = null;
          activeWall = null;
        }
      } else if (!pose && diagnostics.stage !== 'search') {
        diagnostics.stage = 'cooldown';
        diagnostics.reason = diagnostics.reason || 'search_cooldown';
      }

      lastPose = pose;
      previous?.delete();
      previous = gray;
      gray = null;

      self.postMessage({
        type: 'pose',
        pose,
        mode,
        diagnostics,
        frameId: data.frameId,
        epoch: data.epoch,
        processingMs: performance.now() - start,
      });
    } finally {
      capGray.delete();
      gray?.delete();
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      error: typeof err === 'number' ? `影像辨識失敗（${err}）` : String(err?.message || err),
    });
  }
};
