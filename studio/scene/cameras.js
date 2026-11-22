// 照片的相機：拍攝位置、方向、視角 → 3D 場景裡畫的視錐與「飛到這張」的鏡頭。只有數學，不碰畫面（Node 也能用，單元測試在 tools/studio-scene.test.mjs）。
// 座標都是模型座標（公尺，y 朝上），跟公開格式 v2 的模型畫面一樣（format/VOCABULARY.md 的「3D 岩場」）。
//
// 相機：{ id, name, position: [x, y, z], forward, up, right（單位向量）, fov（垂直視角，度）, aspect（寬／高）, cover?, image? }

/** 四元數 [x, y, z, w] 轉動向量 v */
export function rotate([qx, qy, qz, qw], [vx, vy, vz]) {
  // v' = v + 2w(q×v) + 2q×(q×v)
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
  return [vx + qw * tx + (qy * tz - qz * ty), vy + qw * ty + (qz * tx - qx * tz), vz + qw * tz + (qx * ty - qy * tx)];
}
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const deg = (r) => (r * 180) / Math.PI;

/**
 * 3D 重建流程的一張照片（frames.json 的一筆：position、quaternion 是 rub——相機 x 右、y 上、z 往後，intrinsics 是像素焦距）→ 相機。
 * 垂直視角照焦距與畫面高度算：2·atan(cy／fy)
 */
export function cameraFromFrame(f) {
  const { width, height, fy, cy } = f.intrinsics;
  return {
    id: f.name, name: f.name, position: f.position,
    forward: rotate(f.quaternion, [0, 0, -1]), up: rotate(f.quaternion, [0, 1, 0]), right: rotate(f.quaternion, [1, 0, 0]),
    fov: deg(2 * Math.atan((cy ?? height / 2) / fy)), aspect: width / height,
    ...(f.cover != null ? { cover: f.cover } : {}),
  };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v) => { const n = Math.hypot(...v) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };

/**
 * 公開格式 v2 的照片畫面 → 相機：照片的 props.model 記著模型上的鏡頭 { position, target, fov }（format/VOCABULARY.md）；
 * 沒有記、或記的不是這個模型回 null。畫面的上方照世界的 y 朝上（照片不歪）
 */
export function cameraFromView(view, modelId) {
  const m = view?.props?.model, c = m?.camera;
  if (!c || (modelId && m.id !== modelId) || !Array.isArray(c.position) || !Array.isArray(c.target) || !(c.fov > 0)) return null;
  const forward = unit(sub(c.target, c.position)), right = unit(cross(forward, [0, 1, 0]));
  return { id: view.id, name: typeof view.name === 'string' && view.name ? view.name : view.id, position: c.position, forward, up: cross(right, forward), right, fov: c.fov, aspect: view.w && view.h ? view.w / view.h : 3 / 4 };
}

/** 相機 → v2 照片畫面的 props.model（模型 id 與鏡頭；target 在前方 dist 公尺）：3D 重建流程的照片位置收進專案時用 */
export function modelCamera(c, modelId, dist = 10) {
  const r = (v) => v.map(x => Math.round(x * 1e4) / 1e4);
  return { id: modelId, camera: { position: r(c.position), target: r(add(c.position, c.forward, dist)), fov: Math.round(c.fov * 100) / 100 } };
}

/**
 * COLMAP 慣例的一張照片（x_cam = R·X + t；相機 x 右、y 下、z 往前；SIMPLE_RADIAL 內參）→ 相機。
 * 拍照位置是 -Rᵀt，Rᵀ 的三行就是相機的右、下、前；垂直視角 2·atan(cy／f)
 */
export function cameraFromColmap(f) {
  const [r0, r1, r2] = f.R, t = f.t;
  const position = [0, 1, 2].map(i => -(r0[i] * t[0] + r1[i] * t[1] + r2[i] * t[2]));
  const { width, height, f: fy, cy } = f.camera;
  return { id: f.name, name: f.name.replace(/\.[a-z]+$/i, ''), file: f.name, position, forward: [...r2], up: r1.map(v => -v), right: [...r0], fov: deg(2 * Math.atan((cy ?? height / 2) / fy)), aspect: width / height };
}

/** 照片位置檔（3D 重建流程的兩種：frames.json 的陣列、COLMAP 的 climbio-wall3d-frames/1）→ 相機 */
export function camerasFrom(doc) {
  if (Array.isArray(doc)) return doc.map(cameraFromFrame);
  if (doc?.format === 'climbio-wall3d-frames/1') return doc.frames.map(cameraFromColmap);
  throw new Error(`不認得的照片位置檔：${doc?.format ?? typeof doc}`);
}

/**
 * 把模型座標的上方 up 轉到 y 的四元數（室內牆成品座標的上方記在 wall.json 的 up，不是 y）；
 * 沒給或已經朝上回 null，不轉。相機和模型套同一個轉動
 */
export function upright(up) {
  if (!up) return null;
  const a = unit(up);
  if (a[1] > 0.9999) return null;
  const [x, y, z] = cross(a, [0, 1, 0]), w = 1 + a[1], n = Math.hypot(x, y, z, w);
  return n < 1e-9 ? [1, 0, 0, 0] : [x / n, y / n, z / n, w / n];   // 正好朝下：繞 x 轉半圈
}
/** 相機套上轉動 q（位置、三個方向一起轉） */
export const turn = (c, q) => ({ ...c, position: rotate(q, c.position), forward: rotate(q, c.forward), up: rotate(q, c.up), right: rotate(q, c.right) });

/** 視錐：相機位置（頂點）和 depth 公尺外的畫面四角（左上、右上、右下、左下） */
export function frustum(c, depth) {
  const h = Math.tan((c.fov * Math.PI) / 360) * depth, w = h * c.aspect;
  const center = add(c.position, c.forward, depth);
  return { apex: c.position, corners: [[-w, h], [w, h], [w, -h], [-w, -h]].map(([x, y]) => add(add(center, c.right, x), c.up, y)) };
}

/** 「飛到這張」的鏡頭：站在拍照的位置、看拍照的方向，用照片的視角（target 在前方 dist 公尺） */
export const viewOf = (c, dist = 10) => ({ position: c.position, target: add(c.position, c.forward, dist), fov: c.fov });

/** 所有相機的中心與範圍：一開始從斜上方看整群相機和模型 */
export function overview(cams) {
  const n = cams.length || 1, mid = [0, 1, 2].map(i => cams.reduce((s, c) => s + c.position[i], 0) / n);
  const reach = Math.max(2,...cams.map(c => Math.hypot(c.position[0] - mid[0], c.position[2] - mid[2])));
  // 從相機群平均看的方向的背後、往上拉：看得到相機和它們看的岩壁
  const look = cams.reduce((s, c) => add(s, c.forward), [0, 0, 0]), len = Math.hypot(look[0], look[2]) || 1;
  const dir = [look[0] / len, 0, look[2] / len];
  return { position: [mid[0] - dir[0] * reach * 1.6, mid[1] + reach * 0.9, mid[2] - dir[2] * reach * 1.6], target: add(mid, dir, reach * 0.6), fov: 50 };
}

/**
 * 照片離拍的東西大約多遠（公尺）：相機群（水平面）到中心的中位距離，至少 0.5。
 * 沒有模型可以量的時候當「看的那一點」的距離（岩館牆約 1.5 m、大砲岩約 9 m）
 */
export function subjectDistance(cams) {
  const n = cams.length;
  if (!n) return 3;
  const mid = [0, 2].map(i => cams.reduce((s, c) => s + c.position[i], 0) / n);
  const dists = cams.map(c => Math.hypot(c.position[0] - mid[0], c.position[2] - mid[1])).sort((a, b) => a - b);
  return Math.max(dists[n >> 1], 0.5);
}

/**
 * 射線打到三角面的距離（Möller–Trumbore）：tris 是世界座標的三角面頂點（每 9 個數一面），
 * 回傳最近的正距離，沒打到回 Infinity。網格模型用它量照片看的那一點有多遠（three 的 Raycaster 不在 Kit 打包的匯出裡）
 */
export function rayHit(tris, o, d) {
  let best = Infinity;
  for (let k = 0; k < tris.length; k += 9) {
    const ax = tris[k], ay = tris[k + 1], az = tris[k + 2];
    const e1x = tris[k + 3] - ax, e1y = tris[k + 4] - ay, e1z = tris[k + 5] - az;
    const e2x = tris[k + 6] - ax, e2y = tris[k + 7] - ay, e2z = tris[k + 8] - az;
    const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det, tx = o[0] - ax, ty = o[1] - ay, tz = o[2] - az;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t > 1e-4 && t < best) best = t;
  }
  return best;
}

/**
 * 膠卷的順序：相鄰兩張拍的地方盡量接得上，往旁邊滑就是沿著岩壁走（資料檔的順序是重建流程的順序，看起來跳來跳去）。
 * 每張取「看的那一點」（位置往前走相機群到中心的中位距離），排成一條把這些點串起來最短的路：
 * 從起點每次接最近的一張，再把交叉的兩段反過來（2-opt）直到不能再短。
 * 起點：照片大多朝同一邊（岩館牆、一面岩壁：水平朝向平均的長度 ≥ 0.5）取最左邊那張；圍著拍（一顆大石頭）取方位角空最大的地方。
 * 回傳新的陣列，不改原本的
 */
export function stripOrder(cams) {
  const n = cams.length;
  if (n < 3) return [...cams];
  const flat = (v) => { const l = Math.hypot(v[0], v[2]) || 1; return [v[0] / l, v[2] / l]; };
  const d = subjectDistance(cams);
  const look = cams.map(c => add(c.position, c.forward, d));
  const gap = (a, b) => Math.hypot(look[a][0] - look[b][0], look[a][1] - look[b][1], look[a][2] - look[b][2]);
  const [fx, fz] = [0, 1].map(k => cams.reduce((s, c) => s + flat(c.forward)[k], 0) / n);
  let key;
  if (Math.hypot(fx, fz) >= 0.5) key = look.map(p => -fz * p[0] + fx * p[2]);   // 平均朝向 (fx, fz) 的右手方向是 (-fz, fx)
  else {
    const c = [0, 2].map(k => look.reduce((s, p) => s + p[k], 0) / n);
    const ang = cams.map(cm => Math.atan2(cm.position[0] - c[0], cm.position[2] - c[1])), sorted = [...ang].sort((a, b) => a - b);
    let widest = -1, start = sorted[0];
    sorted.forEach((a, i) => { const next = i + 1 < n ? sorted[i + 1] : sorted[0] + 2 * Math.PI; if (next - a > widest) { widest = next - a; start = next; } });
    key = ang.map(a => ((a - start) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI));
  }
  // 從起點每次接最近的
  const first = key.reduce((b, k, i) => (k < key[b] ? i : b), 0), left = new Set(cams.keys());
  left.delete(first);
  const path = [first];
  while (left.size) {
    const last = path.at(-1);
    let best = -1;
    for (const i of left) if (best < 0 || gap(last, i) < gap(last, best)) best = i;
    path.push(best); left.delete(best);
  }
  // 2-opt（終點不固定）：i→i+1 和 j→j+1 兩段換成 i→j、i+1→j+1 比較短就把中間反過來；起點不動
  for (let pass = 0, better = true; better && pass < 50; pass++) {
    better = false;
    for (let i = 0; i < n - 2; i++) for (let j = i + 2; j < n; j++) {
      const a = path[i], b = path[i + 1], c = path[j], e = j + 1 < n ? path[j + 1] : -1;
      if (gap(a, c) + (e < 0 ? 0 : gap(b, e)) < gap(a, b) + (e < 0 ? 0 : gap(c, e)) - 1e-9) {
        for (let x = i + 1, y = j; x < y; x++, y--) [path[x], path[y]] = [path[y], path[x]];
        better = true;
      }
    }
  }
  return path.map(i => cams[i]);
}
