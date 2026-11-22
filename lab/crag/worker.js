// 戶外岩場現場照片認牆 Worker：載入 OpenCV 4.10.0 WASM，對 9 區搜尋包執行粗細兩階段 AKAZE + PnP 定位與路線投影。
'use strict';

importScripts('../../redpoint/vendor/opencv-4.10.0.js');

const WORDS = 16;
const PACK_SCHEMA = 'climbio-3d-wall-pack/1';
const BUNDLE_SCHEMA = 'climbio-3d-wall-bundle/1';
const COARSE_POINTS = 360;
const MAX_FEATURES = 3000;
const COARSE_QUERY = 480;
const COARSE_RATIO = 0.78;
const COARSE_MAX_DIST = 128;
const FINE_RATIO = 0.82;
const TOP_WALLS = 3;
const MIN_INLIERS = 25;
const MIN_SPREAD = 0.015;
const PX = 5.5;
const ITERS = 1000;
const FOCAL_TRIES = [0.42, 0.52, 0.65, 0.75, 0.88, 1.02, 1.18];

const POP = Uint8Array.from({ length: 256 }, (_, i) => {
  let c = 0;
  for (let x = i; x; x >>= 1) c += x & 1;
  return c;
});
const popcount = (x) => POP[x & 255] + POP[(x >>> 8) & 255] + POP[(x >>> 16) & 255] + POP[x >>> 24];

let cvReadyPromise = null;
let packs = [];

function waitOpenCv() {
  if (cvReadyPromise) return cvReadyPromise;
  cvReadyPromise = (async () => {
    for (let i = 0; i < 400 && !(self.cv && self.cv.AKAZE); i++) {
      await new Promise((r) => setTimeout(r, 40));
    }
    if (!(self.cv && self.cv.AKAZE)) throw new Error('OpenCV WASM 初始化逾時');
    try { delete self.cv.then; } catch (_) { /* 避免 Emscripten Module thenable 卡死 */ }
    return self.cv;
  })();
  return cvReadyPromise;
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodePack(raw) {
  if (!raw || raw.schema !== PACK_SCHEMA) throw new Error('不支援的岩牆搜尋包格式');
  const n = Number(raw.pointCount);
  if (!Number.isInteger(n) || n <= 0) throw new Error('搜尋包特徵點數量無效');
  const coarseN = Math.min(n, Math.max(1, Number(raw.coarseCount) || Math.min(n, COARSE_POINTS)));
  const xyzBytes = base64ToBytes(raw.xyz);
  const descBytes = base64ToBytes(raw.desc);
  const xyzView = new DataView(xyzBytes.buffer, xyzBytes.byteOffset, xyzBytes.byteLength);
  const descView = new DataView(descBytes.buffer, descBytes.byteOffset, descBytes.byteLength);
  const xyz = new Float64Array(n * 3);
  const desc = new Uint32Array(n * WORDS);
  for (let i = 0; i < n * 3; i++) xyz[i] = xyzView.getFloat32(i * 4, true);
  for (let i = 0; i < n * WORDS; i++) desc[i] = descView.getUint32(i * 4, true);
  const routes = Array.isArray(raw.routes)
    ? raw.routes
        .filter((r) => Array.isArray(r && r.points3d) && r.points3d.length >= 2)
        .map((r, idx) => ({
          id: String(r.id || `r${idx + 1}`),
          label: r.label != null ? String(r.label) : String(idx + 1),
          name: String(r.name || ''),
          grade: String(r.grade || ''),
          kind: r.style === 'sport' ? 'sport' : 'other',
          stroke: r.stroke ? String(r.stroke) : undefined,
          points3d: r.points3d.map((p) => [Number(p[0]), Number(p[1]), Number(p[2])]),
        }))
    : [];
  return {
    wallId: String(raw.wallId),
    name: String(raw.name || raw.wallId),
    sectorNodeId: raw.sectorNodeId ? String(raw.sectorNodeId) : null,
    sectorName: raw.sectorName ? String(raw.sectorName) : String(raw.name || raw.wallId),
    focalRatio: Number(raw.focalRatio) || 0.75,
    n,
    coarseN,
    xyz,
    desc,
    coarseDesc: desc.subarray(0, coarseN * WORDS),
    routes,
  };
}

function parseBundle(data) {
  const obj = typeof data === 'string' ? JSON.parse(data) : data;
  if (Array.isArray(obj)) return obj.map(decodePack);
  if (obj && obj.schema === BUNDLE_SCHEMA && Array.isArray(obj.packs)) return obj.packs.map(decodePack);
  if (obj && obj.schema === PACK_SCHEMA) return [decodePack(obj)];
  throw new Error('搜尋包結構不符');
}

function cpuKnn(qDesc, tDesc) {
  const nq = qDesc.length / WORDS;
  const nt = tDesc.length / WORDS;
  const out = new Uint32Array(nq * 3);
  for (let i = 0; i < nq; i++) {
    let b1 = 0xffff;
    let b2 = 0xffff;
    let bi = 0;
    const qi = i * WORDS;
    for (let j = 0; j < nt; j++) {
      let d = 0;
      const tj = j * WORDS;
      for (let k = 0; k < WORDS; k++) d += popcount(qDesc[qi + k] ^ tDesc[tj + k]);
      if (d < b1) { b2 = b1; b1 = d; bi = j; } else if (d < b2) b2 = d;
    }
    out[i * 3] = bi;
    out[i * 3 + 1] = b1;
    out[i * 3 + 2] = b2;
  }
  return out;
}

function mutual(ab, ba, ratio) {
  const pairs = [];
  for (let i = 0; i < ab.length / 3; i++) {
    const j = ab[i * 3];
    if (ab[i * 3 + 1] < ratio * ab[i * 3 + 2] && ba[j * 3] === i) pairs.push([i, j]);
  }
  return pairs;
}

function applyPose(R, t, X) {
  return [
    R[0] * X[0] + R[1] * X[1] + R[2] * X[2] + t[0],
    R[3] * X[0] + R[4] * X[1] + R[5] * X[2] + t[1],
    R[6] * X[0] + R[7] * X[1] + R[8] * X[2] + t[2],
  ];
}

function toPixel(pose, X, w, h) {
  const c = applyPose(pose.R, pose.t, X);
  if (c[2] <= 0.15) return null;
  return [pose.f * (c[0] / c[2]) + w / 2, pose.f * (c[1] / c[2]) + h / 2];
}

function inlierSpread(imgPts, w, h) {
  const count = imgPts.length / 2;
  if (count < 4 || !(w > 0 && h > 0)) return 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = imgPts[i * 2], y = imgPts[i * 2 + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return ((maxX - minX) * (maxY - minY)) / (w * h);
}

function extractFeatures(cv, grayBytes, width, height) {
  const gray = cv.matFromArray(height, width, cv.CV_8UC1, grayBytes);
  const mask = new cv.Mat();
  const keys = new cv.KeyPointVector();
  const desc = new cv.Mat();
  const akaze = new cv.AKAZE();
  try {
    akaze.setThreshold(0.0005);
    akaze.detectAndCompute(gray, mask, keys, desc);
    const order = Array.from({ length: keys.size() }, (_, i) => i)
      .sort((a, b) => keys.get(b).response - keys.get(a).response)
      .slice(0, MAX_FEATURES);
    const cols = desc.cols;
    const xy = new Float64Array(order.length * 2);
    const bytes = new Uint8Array(order.length * 64);
    for (let j = 0; j < order.length; j++) {
      const i = order[j];
      const kp = keys.get(i);
      xy[j * 2] = kp.pt.x;
      xy[j * 2 + 1] = kp.pt.y;
      bytes.set(desc.data.subarray(i * cols, i * cols + cols), j * 64);
    }
    return { xy, desc: new Uint32Array(bytes.buffer) };
  } finally {
    for (const m of [gray, mask, keys, desc, akaze]) m.delete();
  }
}

function solvePnp(cv, obj, img, fi, w, h) {
  const n = obj.length / 3;
  const O = cv.matFromArray(n, 3, cv.CV_64F, obj);
  const P = cv.matFromArray(n, 2, cv.CV_64F, img);
  const Km = cv.matFromArray(3, 3, cv.CV_64F, [fi, 0, w / 2, 0, fi, h / 2, 0, 0, 1]);
  const D = cv.matFromArray(4, 1, cv.CV_64F, [0, 0, 0, 0]);
  const inl = new cv.Mat();
  const Rm = new cv.Mat();
  const rv = new cv.Mat();
  const tv = new cv.Mat();
  try {
    if (!cv.solvePnPRansac(O, P, Km, D, rv, tv, false, ITERS, PX, 0.995, inl, cv.SOLVEPNP_EPNP) || inl.rows < 20) {
      return null;
    }
    const ids = Array.from(inl.data32S);
    const O2 = cv.matFromArray(ids.length, 3, cv.CV_64F, ids.flatMap((j) => obj.slice(j * 3, j * 3 + 3)));
    const P2 = cv.matFromArray(ids.length, 2, cv.CV_64F, ids.flatMap((j) => img.slice(j * 2, j * 2 + 2)));
    cv.solvePnP(O2, P2, Km, D, rv, tv, true, cv.SOLVEPNP_ITERATIVE);
    O2.delete();
    P2.delete();
    cv.Rodrigues(rv, Rm);
    const R = Array.from(Rm.data64F);
    const t = Array.from(tv.data64F);
    const keptImg = [];
    for (let i = 0; i < n; i++) {
      const q = toPixel({ R, t, f: fi }, [obj[i * 3], obj[i * 3 + 1], obj[i * 3 + 2]], w, h);
      if (q && Math.hypot(q[0] - img[i * 2], q[1] - img[i * 2 + 1]) < PX) {
        keptImg.push(img[i * 2], img[i * 2 + 1]);
      }
    }
    const inliers = keptImg.length / 2;
    if (inliers < MIN_INLIERS) return null;
    const spread = inlierSpread(keptImg, w, h);
    if (spread < MIN_SPREAD) return null;
    return { R, t, f: fi, inliers, spread };
  } finally {
    for (const m of [O, P, Km, D, inl, Rm, rv, tv]) if (!m.isDeleted()) m.delete();
  }
}

function densify3d(pts, step) {
  if (!pts || pts.length < 2) return pts || [];
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dist = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let s = 1; s <= n; s++) {
      const k = s / n;
      out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]);
    }
  }
  return out;
}

function projectRoutesToPhoto(pack, pose, smallW, smallH, fullW, fullH) {
  const scale = Math.max(fullW, fullH) / Math.max(smallW, smallH);
  const fullPose = { R: pose.R, t: pose.t, f: pose.f * scale };
  const padX = fullW * 0.08;
  const padY = fullH * 0.08;
  const projected = [];
  for (const r of pack.routes) {
    const dense = densify3d(r.points3d, 0.22);
    let bestRun = [];
    let run = [];
    for (const X of dense) {
      const q = toPixel(fullPose, X, fullW, fullH);
      const inside = q && q[0] >= -padX && q[0] <= fullW + padX && q[1] >= -padY && q[1] <= fullH + padY;
      if (inside) {
        run.push([
          Math.max(0, Math.min(fullW, Math.round(q[0] * 10) / 10)),
          Math.max(0, Math.min(fullH, Math.round(q[1] * 10) / 10)),
        ]);
      } else {
        if (run.length > bestRun.length) bestRun = run;
        run = [];
      }
    }
    if (run.length > bestRun.length) bestRun = run;
    if (bestRun.length >= 2) {
      projected.push({
        id: r.id,
        label: r.label,
        name: r.name,
        grade: r.grade,
        kind: r.kind,
        stroke: r.stroke,
        line: bestRun,
      });
    }
  }
  return projected;
}

function locateOnPacks(cv, grayBytes, width, height, fullW, fullH) {
  const t0 = performance.now();
  if (!packs.length) {
    return { matched: false, inliers: 0, matches: 0, ms: 0, projectedRoutes: [] };
  }
  const { xy, desc } = extractFeatures(cv, grayBytes, width, height);
  const nFeat = xy.length / 2;
  if (nFeat < MIN_INLIERS) {
    return { matched: false, inliers: 0, matches: 0, ms: Math.round(performance.now() - t0), projectedRoutes: [] };
  }

  let ranked;
  if (packs.length <= 2) {
    ranked = packs.map((pack) => ({ pack, coarseMatches: MIN_INLIERS }));
  } else {
    const qCoarseN = Math.min(nFeat, COARSE_QUERY);
    const qCoarse = desc.subarray(0, qCoarseN * WORDS);
    const scores = packs.map((pack) => {
      const ab = cpuKnn(qCoarse, pack.coarseDesc);
      let hits = 0;
      for (let i = 0; i < ab.length / 3; i++) {
        const b1 = ab[i * 3 + 1], b2 = ab[i * 3 + 2];
        if (b1 <= COARSE_MAX_DIST && b1 < COARSE_RATIO * b2) hits++;
      }
      return { pack, coarseMatches: hits };
    });
    scores.sort((a, b) => b.coarseMatches - a.coarseMatches);
    ranked = scores.filter((x, i) => i < TOP_WALLS && x.coarseMatches >= 3);
    if (!ranked.length) ranked = scores.slice(0, 1);
  }

  const size = Math.max(width, height);
  let winner = null;
  let maxMatches = 0;
  for (const { pack } of ranked) {
    const pairs = mutual(cpuKnn(desc, pack.desc), cpuKnn(pack.desc, desc), FINE_RATIO);
    if (pairs.length > maxMatches) maxMatches = pairs.length;
    if (pairs.length < MIN_INLIERS) continue;

    const obj = [];
    const img = [];
    for (let k = 0; k < pairs.length; k++) {
      const qi = pairs[k][0], mi = pairs[k][1];
      obj.push(pack.xyz[mi * 3], pack.xyz[mi * 3 + 1], pack.xyz[mi * 3 + 2]);
      img.push(xy[qi * 2], xy[qi * 2 + 1]);
    }
    const tries = [...new Set([pack.focalRatio, ...FOCAL_TRIES].filter((r) => r > 0.3 && r < 2.5))].map((r) => r * size);
    let best = null;
    for (const fi of tries) {
      const solved = solvePnp(cv, obj, img, fi, width, height);
      if (solved && (!best || solved.inliers > best.inliers)) best = solved;
    }
    if (best) {
      for (const mul of [0.94, 0.97, 1.03, 1.06]) {
        const solved = solvePnp(cv, obj, img, best.f * mul, width, height);
        if (solved && solved.inliers > best.inliers) best = solved;
      }
      if (!winner || best.inliers > winner.inliers) {
        winner = { pack, ...best, matches: pairs.length };
      }
      if (best.inliers >= 80) break;
    }
  }

  const ms = Math.round(performance.now() - t0);
  if (!winner) {
    return { matched: false, inliers: 0, matches: maxMatches, ms, projectedRoutes: [] };
  }
  const projectedRoutes = projectRoutesToPhoto(winner.pack, winner, width, height, fullW || width, fullH || height);
  return {
    matched: true,
    wallId: winner.pack.wallId,
    wallName: winner.pack.name,
    sectorNodeId: winner.pack.sectorNodeId,
    sectorName: winner.pack.sectorName,
    inliers: winner.inliers,
    matches: winner.matches,
    spread: +winner.spread.toFixed(4),
    ms,
    projectedRoutes,
  };
}

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  const id = msg.id;
  try {
    const cv = await waitOpenCv();
    if (msg.op === 'ping') {
      self.postMessage({ id, ok: true });
      return;
    }
    if (msg.op === 'set_bundle') {
      packs = parseBundle(msg.bundle);
      self.postMessage({ id, ok: true, wallCount: packs.length });
      return;
    }
    if (msg.op === 'locate') {
      const gray = msg.gray instanceof Uint8Array ? msg.gray : new Uint8Array(msg.gray);
      const res = locateOnPacks(cv, gray, msg.width, msg.height, msg.fullWidth, msg.fullHeight);
      self.postMessage({ id, ok: true, ...res });
      return;
    }
    throw new Error(`不支援的指令：${msg.op}`);
  } catch (err) {
    self.postMessage({ id, ok: false, error: err && err.message ? err.message : String(err) });
  }
};
