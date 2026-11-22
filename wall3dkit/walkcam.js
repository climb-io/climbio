// 沿著牆走的 3D 鏡頭：牆的水平走向（profile，一條會轉彎的線）當軌道，鏡頭停在牆前距離 d、高度 v、沿線位置 s，永遠正對牆。
// 手指左右拖＝沿著牆走（s），上下拖＝升降（v），捏合＝靠近／拉遠（d）：跟 2D 照片的平移、縮放一一對應，畫面還是真的 3D 模型（有立體、視差）。
// 轉角處鏡頭的位置和朝向沿線做高斯平滑，拉得越遠平滑得越寬（遠看時幾乎是一條直線，不會在內角擠成一點、外角甩一大圈）。
// 邊界在牆面座標裡算（看得到的半寬、半高＝d·tan(fov/2)），拖到盡頭就停，不露出牆外、不上下跳。不針對哪一面牆調參數。
// English: a wall-following camera — 2D pan/zoom gestures mapped to (s, v, d) along the wall's smoothed horizontal profile.
import { Vector3, WebGLRenderTarget, MeshBasicMaterial, Color, GLTFLoader } from './vendor/three.js';

export const STEP = 0.05;   // 軌道取樣間距（公尺）
export const YAW_MAX = Math.PI / 6;   // 兩指調角度的範圍：±30°
export const YAW_RATE = 0.5;   // 回程角度沿牆每走 1 公尺最多變 YAW_RATE／d 弧度（見 WalkCam.yawAt）
const YAW_COARSE = 0.05;   // 調角度途中算範圍用的角度刻度（弧度，約 3°）
const COARSE_D = 0.25;   // 捏合中算上下、左右範圍用的距離刻度（公尺）
const V_STEP = 0.1;   // 高度範圍（vRange）沿牆取樣的間距（公尺）
const V_SLOPE = 1, V_REACH = 12;   // 高度範圍沿牆的坡度限制：每走 1 公尺最多變 1 公尺，看前後 12 格（1.2 公尺）
const HOLD_R = 0.08;   // 岩點「完整出現在畫面」：中心離可用畫面的左右邊至少這麼遠（公尺，約一般岩點的半徑；拉得很近時最多留可用畫面的 1/8）
const EYE = 1.5;   // 人眼離牆腳的高度（公尺）：沿牆鏡頭像人站在牆前，鏡頭固定在這個高度，看上看下是抬頭、低頭
const FOOT_SLACK = 0.1;   // 人的模式低頭時容許看到牆腳下面一點（公尺，看的高度），牆腳的腳點才點得到
const HOLD_RV = 0.03;   // 上下只要點得到：中心離可用畫面的上下邊這麼遠就好。牆最上、最下那排岩點不必整顆進畫面，鏡頭才不用為了它們露出牆外
const SIDE = 0.6;     // 離正面牆面超過這麼遠的岩點算側牆上的（靠調角度看，不擴大左右、上下範圍）
const SLOPE = 1;     // 沿牆走時自動靠近、退回的快慢：每走 1 公尺距離最多變 1 公尺

export async function loadGlb(url, { maxTex = 0 } = {}) {
  let buf = await (await fetch(url, { credentials: 'omit' })).arrayBuffer();
  if (maxTex) buf = await shrinkTextures(buf, maxTex);
  return new Promise((ok, no) => new GLTFLoader().parse(buf, '', ok, no));
}
// 手機的記憶體放不下大岩場（八張 4K 貼圖）：載入前把 glb 裡的貼圖一張一張縮到最長邊 maxTex，重新打包（其他資料原樣）
async function shrinkTextures(buf, maxTex) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf), jlen = dv.getUint32(12, true), json = JSON.parse(new TextDecoder().decode(u8.subarray(20, 20 + jlen)));
  const binStart = 20 + jlen + 8, bin = u8.subarray(binStart, binStart + dv.getUint32(20 + jlen, true));
  const imgViews = new Map((json.images || []).filter(i => i.bufferView !== undefined).map(i => [i.bufferView, i]));
  const parts = [], align = (n) => (n + 3) & ~3; let off = 0;
  for (let v = 0; v < json.bufferViews.length; v++) {
    const bv = json.bufferViews[v]; let data = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    const img = imgViews.get(v);
    if (img) {
      const bmp = await createImageBitmap(new Blob([data], { type: img.mimeType || 'image/jpeg' }));
      const k = Math.min(1, maxTex / Math.max(bmp.width, bmp.height));
      if (k < 1) {
        const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k)); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        data = new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 })).arrayBuffer()); img.mimeType = 'image/jpeg';
      }
      bmp.close();
    }
    bv.byteOffset = off; bv.byteLength = data.byteLength; bv.buffer = 0; parts.push([off, data]); off = align(off + data.byteLength);
  }
  json.buffers = [{ byteLength: off }];
  const jb = new TextEncoder().encode(JSON.stringify(json)), jl = align(jb.length), out = new Uint8Array(12 + 8 + jl + 8 + off), o = new DataView(out.buffer);
  o.setUint32(0, 0x46546c67, true); o.setUint32(4, 2, true); o.setUint32(8, out.length, true);
  o.setUint32(12, jl, true); o.setUint32(16, 0x4e4f534a, true); out.set(jb, 20); out.fill(0x20, 20 + jb.length, 20 + jl);
  o.setUint32(20 + jl, off, true); o.setUint32(24 + jl, 0x004e4942, true);
  for (const [at, d] of parts) out.set(d, 28 + jl + at);
  return out.buffer;
}

// 模型裡每個網格：世界座標的位置、UV、索引、材質的貼圖
export function meshesOf(gltf) {
  const out = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry, P = g.attributes.position, n = P.count, pos = new Float32Array(n * 3), v = new Vector3();
    for (let i = 0; i < n; i++) { v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld); pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z; }
    const uv = g.attributes.uv ? Float32Array.from({ length: n * 2 }, (_, k) => k % 2 ? g.attributes.uv.getY(k >> 1) : g.attributes.uv.getX(k >> 1)) : null;
    const index = g.index ? Uint32Array.from(g.index.array) : Uint32Array.from({ length: n }, (_, i) => i);
    out.push({ pos, uv, index, map: o.material.map || null });
  });
  return out;
}

// 牆的水平走向：牆腳附近（高度 10%～60% 那一段）的頂點投到水平面，用「主曲線」（一串節點：每個點歸給最近的節點，節點移到歸給它的點的中心，
// 同時被左右兩個節點拉著保持平滑）找出一條會轉彎的線：V 字、L 字的內角、側牆都跟得上（只用左右方向分段取深度的話，側牆整段會擠在一兩格）。
export function profile(meshes, up, front, { nodes = 60, iters = 60, stiff = 6 } = {}) {
  const right = up.clone().cross(front).normalize(), f = right.clone().cross(up).normalize();
  const hs = [];
  for (const m of meshes) for (let i = 0; i < m.pos.length; i += 30) hs.push(m.pos[i] * up.x + m.pos[i + 1] * up.y + m.pos[i + 2] * up.z);
  hs.sort((p, q) => p - q);
  const h0 = hs[Math.floor(hs.length * 0.1)], h1 = hs[Math.floor(hs.length * 0.6)];
  const P = [];
  for (const m of meshes) for (let i = 0; i < m.pos.length; i += 9) {
    const x = m.pos[i], y = m.pos[i + 1], z = m.pos[i + 2], h = x * up.x + y * up.y + z * up.z;
    if (h < h0 || h > h1) continue;
    P.push(x * right.x + y * right.y + z * right.z, x * f.x + y * f.y + z * f.z);
  }
  let lo = Infinity, hi = -Infinity, ds = [];
  for (let i = 0; i < P.length; i += 2) { lo = Math.min(lo, P[i]); hi = Math.max(hi, P[i]); ds.push(P[i + 1]); }
  ds.sort((p, q) => p - q);
  const d0 = ds[ds.length >> 1];
  let N = Array.from({ length: nodes }, (_, i) => [lo + (hi - lo) * i / (nodes - 1), d0]);
  const n = P.length / 2, own = new Int32Array(n);
  for (let it = 0; it < iters; it++) {
    for (let k = 0; k < n; k++) {
      const a = P[k * 2], d = P[k * 2 + 1]; let b = 0, bd = Infinity;
      for (let j = 0; j < nodes; j++) { const e = (N[j][0] - a) ** 2 + (N[j][1] - d) ** 2; if (e < bd) { bd = e; b = j; } }
      own[k] = b;
    }
    const sum = N.map(() => [0, 0, 0]);
    for (let k = 0; k < n; k++) { const q = sum[own[k]]; q[0] += P[k * 2]; q[1] += P[k * 2 + 1]; q[2]++; }
    const avg = n / nodes, lam = stiff * avg;
    N = N.map((p, j) => {
      const nb = [N[j - 1], N[j + 1]].filter(Boolean), c = sum[j][2];
      const nx = nb.reduce((s, q) => s + q[0], 0), nd = nb.reduce((s, q) => s + q[1], 0);
      if (!c && !nb.length) return p;
      return [(sum[j][0] + lam * nx) / (c + lam * nb.length), (sum[j][1] + lam * nd) / (c + lam * nb.length)];
    });
    // 再平滑一次（三點平均兩次）：節點被岩點、大岩塊拉歪時不要變成鋸齒
    for (let r = 0; r < 2; r++) N = N.map((p, j) => j === 0 || j === nodes - 1 ? p : [(N[j - 1][0] + 2 * p[0] + N[j + 1][0]) / 4, (N[j - 1][1] + 2 * p[1] + N[j + 1][1]) / 4]);
  }
  // 依沿線長度重新取等距的點，兩端各往外延伸一點（端點外的頂點才有地方投）
  const len = [0]; for (let i = 1; i < N.length; i++) len.push(len[i - 1] + Math.hypot(N[i][0] - N[i - 1][0], N[i][1] - N[i - 1][1]));
  const ext = (A, B, k) => [A[0] + (A[0] - B[0]) * k, A[1] + (A[1] - B[1]) * k];
  const pts = [ext(N[0], N[1], 3), ...N, ext(N.at(-1), N.at(-2), 3)], L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  // 法線朝看的那一側：沿線方向轉 90° 後，平均要指向 front
  let dot = 0; for (let i = 1; i < pts.length; i++) dot += -(pts[i][1] - pts[i - 1][1]) * 0 + (pts[i][0] - pts[i - 1][0]);
  const flip = dot < 0 ? -1 : 1;
  return { right, f, up, pts, len: L, flip };
}


// 從模型算出軌道和範圍：meshes 是 meshesOf 的結果，up、front 是 Vector3
export function wallPath(meshes, up, front) {
  const pr = profile(meshes, up, front), { right, f, pts, len, flip } = pr;
  // 沿線每 STEP 公尺取一個點（水平面上的 x＝right、y＝f）
  const total = len.at(-1), n = Math.floor(total / STEP) + 1, X = new Float32Array(n), Y = new Float32Array(n);
  for (let i = 0, k = 0; i < n; i++) {
    const s = i * STEP; while (k < len.length - 2 && len[k + 1] < s) k++;
    const u = (s - len[k]) / (len[k + 1] - len[k] || 1); X[i] = pts[k][0] + (pts[k + 1][0] - pts[k][0]) * u; Y[i] = pts[k][1] + (pts[k + 1][1] - pts[k][1]) * u;
  }
  // 牆的範圍：頂點投到線上（沿線位置 s、離線距離 t、高度 v），只算牆面和往鏡頭凸出的（外傾、屋簷），牆後面的不算（從前面看它們比較小，算進來邊緣會露空）。
  // 沿線每 10 公分一段：那一段牆面從多低到多高（2%～98%）。左右範圍＝牆面高度夠（全高的六成以上）的段；
  // 上下範圍對所有段都一樣（不隨左右位置變，拖動時才不會上下跳）：大部分段（八成）都有牆面的那一截
  const BIN = 0.1, cols = new Map(), surf = new Map(), seg = Math.max(1, Math.round(0.2 / STEP));
  for (const m of meshes) for (let i = 0; i < m.pos.length; i += 7 * 3) {
    const x = m.pos[i], y = m.pos[i + 1], z = m.pos[i + 2], a = x * right.x + y * right.y + z * right.z, d = x * f.x + y * f.y + z * f.z;
    let best = Infinity, bs = 0;
    for (let j = 0; j < n; j += seg) { const e = (X[j] - a) ** 2 + (Y[j] - d) ** 2; if (e < best) { best = e; bs = j; } }
    for (let j = Math.max(0, bs - seg); j <= Math.min(n - 1, bs + seg); j++) { const e = (X[j] - a) ** 2 + (Y[j] - d) ** 2; if (e < best) { best = e; bs = j; } }
    if (bs === 0 || bs === n - 1) continue;   // 落在軌道端點外
    const a0 = Math.max(0, bs - 1), b0 = Math.min(n - 1, bs + 1), tx = X[b0] - X[a0], ty = Y[b0] - Y[a0], tl = Math.hypot(tx, ty) || 1;
    const t = flip * ((a - X[bs]) * -ty + (d - Y[bs]) * tx) / tl;   // 往鏡頭為正
    if (t < -1.5 || t > 4) continue;
    const k = Math.floor(bs * STEP / BIN), h = x * up.x + y * up.y + z * up.z; let c = cols.get(k); if (!c) cols.set(k, c = []); c.push([h, t]);
    const key = k * 4096 + Math.floor(h / BIN) + 2048; let u = surf.get(key); if (!u) surf.set(key, u = []); u.push(t);
  }
  // 每段的牆腳、牆頂：高度（2%、98%）和那裡的深度 t（最低、最高 5% 的點的中位數）。鏡頭水平看時，深度 t 的地方畫面邊緣在
  // v ± (d − t)·tan：牆腳往後縮（t<0）要多抬一點才不露出下面，屋簷往前凸（t>0）可以多看一點。換成跟 d 無關的「有效」上下界：lo − t·tan、hi + t·tan
  const q = (B, p) => B[Math.floor(p * (B.length - 1))], med = (A) => A.map(a => a[1]).sort((a, b) => a - b)[A.length >> 1];
  const col = [...cols].filter(([, c]) => c.length >= 20).map(([k, c]) => {
    c.sort((a, b) => a[0] - b[0]); const m = Math.max(1, Math.floor(c.length * 0.05));
    return { k, lo: q(c, 0.02)[0], loT: med(c.slice(0, m)), hi: q(c, 0.98)[0], hiT: med(c.slice(-m)) };
  }).sort((a, b) => a.k - b.k);
  const span = q(col.map(c => c.hi - c.lo).sort((a, b) => a - b), 0.9), wall = col.filter(c => c.hi - c.lo >= 0.6 * span);
  return { right, f, up: up.clone(), flip, X, Y, n, smin: wall[0].k * BIN, smax: (wall.at(-1).k + 1) * BIN, cols: wall, bin: BIN,
    // 牆面在每段、每個高度（10 公分見方）離基準線多遠：偏前面的 85%（岩點、凸出的部分也算進去，鏡頭不撞牆）和中位數（一般的牆面，拖動跟手照它）：外傾的上半部往鏡頭凸出，鏡頭要跟著退
    surf: [...surf].map(([key, u]) => { u.sort((a, b) => a - b); return [Math.floor(key / 4096), key % 4096 - 2048, u[Math.floor(u.length * 0.85)], u.length, u[u.length >> 1]]; }).filter(e => e[3] >= 3) };
}

export class WalkCam {
  constructor(path, camera) {
    this.p = path; this.cam = camera; this.W = 1; this.H = 1;
    if (path.baked) this.load(path.baked); else this.bounds();
    this.v = (this.lo[this.lo.length >> 1] + this.hi[this.hi.length >> 1]) / 2;
    this.v0 = this.v;   // 鏡頭路徑（等距線）照這個高度的牆面算：上下拖時鏡頭只升降，不前後移（畫面大小穩定）
    this.s = (path.smin + path.smax) / 2; this.d = Infinity; this.yaw = 0; this.auto = null; this.pass = false; this.passFrom = null; this.passK = 0; this.atEnd = 0;
    this.clamp();
  }
  // 烘焙好的（packWalk）：牆腳、牆頂、牆面深度的格子直接讀，不用模型
  load(b) {
    const F = (a) => Float32Array.from(a);
    [this.lo, this.loT, this.hi, this.hiT, this.T, this.Tm] = [b.lo, b.loT, b.hi, b.hiT, b.T, b.Tm || b.T].map(F);
    Object.assign(this, { k0: b.k0, j0: b.j0, M: b.M, hTyp: b.hTyp, far: null });
  }
  // 每段（10 公分）的牆腳、牆頂（高度和深度），缺的段用旁邊的補，再沿線高斯平滑（σ 30 公分）：上下界隨左右位置慢慢變
  bounds() {
    const p = this.p, k0 = p.cols[0].k, N = p.cols.at(-1).k - k0 + 1, R = ['lo', 'loT', 'hi', 'hiT'].map(() => new Float32Array(N).fill(NaN));
    for (const c of p.cols) [c.lo, c.loT, c.hi, c.hiT].forEach((x, q) => { R[q][c.k - k0] = x; });
    for (const A of R) for (let i = 0; i < N; i++) if (isNaN(A[i])) { let j = 1; while (isNaN(A[i - j] ?? NaN) && isNaN(A[i + j] ?? NaN)) j++; A[i] = isNaN(A[i - j] ?? NaN) ? A[i + j] : A[i - j]; }
    const sm = (A) => { const r = 3, o = new Float32Array(N); for (let i = 0; i < N; i++) { let s = 0, w = 0; for (let j = Math.max(0, i - 3 * r); j <= Math.min(N - 1, i + 3 * r); j++) { const g = Math.exp(-((j - i) ** 2) / (2 * r * r)); s += A[j] * g; w += g; } o[i] = s / w; } return o; };
    [this.lo, this.loT, this.hi, this.hiT] = R.map(sm); this.k0 = k0;
    const hs = Array.from(this.hi, (h, i) => h - this.lo[i]).sort((a, b) => a - b); this.hTyp = hs[hs.length >> 1];
    this.far = null;
    // 牆面深度的格子：段 × 高度，缺的格子用同一段最近的高度補，再兩個方向高斯平滑（σ 40 公分，鏡頭前後移動要平順）
    let j0 = Infinity, j1 = -Infinity; for (const e of p.surf) { j0 = Math.min(j0, e[1]); j1 = Math.max(j1, e[1]); }
    const M = j1 - j0 + 1, grid = (q) => { const T = new Float32Array(N * M).fill(NaN); for (const e of p.surf) if (e[0] >= k0 && e[0] < k0 + N) T[(e[0] - k0) * M + e[1] - j0] = e[q]; return fill(T); };
    const fill = (T) => {
    for (let i = 0; i < N; i++) { const row = T.subarray(i * M, i * M + M), ok = []; row.forEach((t, j) => { if (!isNaN(t)) ok.push(j); }); if (!ok.length) continue; for (let j = 0; j < M; j++) if (isNaN(row[j])) row[j] = row[ok.reduce((b, q) => Math.abs(q - j) < Math.abs(b - j) ? q : b, ok[0])]; }
    for (let i = 0; i < N; i++) if (isNaN(T[i * M])) { let j = 1; while (i - j >= 0 && isNaN(T[(i - j) * M]) && (i + j >= N || isNaN(T[(i + j) * M]))) j++; const src = i - j >= 0 && !isNaN(T[(i - j) * M]) ? i - j : i + j; T.copyWithin(i * M, src * M, src * M + M); }
    return T; };
    const blur = (A, n, m, along) => { const r = 4, o = new Float32Array(A.length); for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { let s = 0, w = 0; for (let q = -3 * r; q <= 3 * r; q++) { const ii = along ? i + q : i, jj = along ? j : j + q; if (ii < 0 || ii >= n || jj < 0 || jj >= m) continue; const g = Math.exp(-(q * q) / (2 * r * r)); s += A[ii * m + jj] * g; w += g; } o[i * m + j] = s / w; } return o; };
    // 先取附近（±30 公分）最凸出的，再平滑：鏡頭不會插進突然凸出的屋簷裡
    const dil = (A, n, m) => { const o = new Float32Array(A.length); for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { let x = -Infinity; for (let a = Math.max(0, i - 3); a <= Math.min(n - 1, i + 3); a++) for (let c = Math.max(0, j - 3); c <= Math.min(m - 1, j + 3); c++) x = Math.max(x, A[a * m + c]); o[i * m + j] = x; } return o; };
    this.T = blur(blur(dil(grid(2), N, M), N, M, true), N, M, false); this.Tm = blur(blur(grid(4), N, M, true), N, M, false); this.M = M; this.j0 = j0;
  }
  // 牆面在 (s, v) 離基準線多遠（往鏡頭為正），雙線性內插；T 預設是偏前面的（鏡頭的位置），this.Tm 是一般的牆面
  depth(s, v, T = this.T) {
    const b = this.p.bin, N = this.lo.length, M = this.M;
    const x = Math.max(0, Math.min(N - 1.001, s / b - this.k0 - 0.5)), y = Math.max(0, Math.min(M - 1.001, v / b - this.j0 - 0.5)), i = Math.floor(x), j = Math.floor(y), u = x - i, w = y - j;
    return (T[i * M + j] * (1 - u) + T[(i + 1) * M + j] * u) * (1 - w) + (T[i * M + j + 1] * (1 - u) + T[(i + 1) * M + j + 1] * u) * w;
  }
  // 最遠的距離：沿牆各處「看得到的那一段上下都有牆」的高度，取低的那兩成也塞得滿畫面（看得到的寬度跟距離有關，迭代幾次）
  get dMax() {
    if (this.person) return this.dFar();
    if (this.table) return this.sees ? this.dFill : Math.max(...this.reach);
    if (this.far && this.far[0] === this.W && this.far[1] === this.H) return this.far[2];
    const p = this.p, a = this.W / this.H; let d = Math.min(this.hTyp / 2, (p.smax - p.smin) / 2 / a) / this.tan;
    for (let it = 0; it < 4; it++) {
      const hw = d * this.tan * a, hs = [];
      for (let s = p.smin + hw; s <= p.smax - hw; s += p.bin) { const [lo, hi] = this.vlim(s, hw, (this.lo[0] + this.hi[0]) / 2); hs.push(hi - lo); }
      if (!hs.length) break;
      hs.sort((x, y) => x - y); d = Math.min(hs[Math.floor(hs.length * 0.2)] / 2, (p.smax - p.smin) / 2 / a) / this.tan;
    }
    this.far = [this.W, this.H, d]; return d;
  }
  // 畫面看得到的這一段（s ± hw）上下都有牆的範圍（鏡頭在高度 v、離牆面 d、水平看）：v−d·tan 以下、v+d·tan 以上要還在牆上。
  // 鏡頭在基準線前 c＝depth(s,v)+d，深度 t 的地方畫面下緣在 v−(c−t)·tan：牆腳（lo、loT）要在它下面 → v−d·tan ≥ lo+(depth−loT)·tan；牆頂同理
  vlim(s, hw, v) {
    const b = this.p.bin, tan = this.tan, N = this.lo.length, i0 = Math.max(0, Math.min(N - 1, Math.floor((s - hw) / b) - this.k0)), i1 = Math.max(i0, Math.min(N - 1, Math.ceil((s + hw) / b) - this.k0));   // 整段在牆外時用最近的一段
    let lo = -Infinity, hi = Infinity;
    for (let i = i0; i <= i1; i++) { const t = this.depth((i + this.k0 + 0.5) * b, v); lo = Math.max(lo, this.lo[i] + (t - this.loT[i]) * tan); hi = Math.min(hi, this.hi[i] - (t - this.hiT[i]) * tan); }
    return [lo, hi];
  }
  get wide() { return this.W > this.H; }
  // 距離 d 時讓整面牆左右置中的位置：兩端在畫面上的橫向位置（-1～1）剛好對稱（V 字牆站在中點兩端不對稱）。回傳 [s, 左端, 右端]
  centerAt(d) {
    const p = this.p, q = new Vector3(), hw = this.tan * this.W / this.H, E = [p.smin, p.smax].map(s => this.world(this.pose(s, d).look, this.v0));
    const x = (s) => { this.place(s, d); return E.map(e => { q.copy(e).applyMatrix4(this.cam.matrixWorldInverse); return q.z < 0 ? q.x / -q.z / hw : NaN; }); };
    let lo = p.smin, hi = p.smax; for (let k = 0; k < 16; k++) { const m = (lo + hi) / 2, [a, b] = x(m); if (a + b > 0) lo = m; else hi = m; }   // 往右走兩端都往左移
    const s = (lo + hi) / 2; return [s, ...x(s)];
  }
  // 人的模式最遠的距離：平視（看眼睛高度）時，可用畫面的下緣剛好碰到牆腳；再遠就只是看到更多地面，不會看到更多牆。
  // 不受 clamp 限制（算的時候直接設 d）
  get dPerson() {
    const t = this.table, bottom = this.wide || !t ? 0 : t.bottom;
    if (this.sees) {
      // 用模型打射線：沿牆幾個位置各找「平視時可用畫面的下緣還打在牆上」的最遠距離，取中位數（牆往外傾時牆腳比較深，不能只用高度算）
      const key = [this.W, this.H].join('|'); if (this.dp && this.dp[0] === key) return this.dp[1];
      const keep = ['s', 'v', 'd'].map(k => [k, this[k]]), p = this.p, out = [];
      for (let k = 1; k <= 5; k++) {
        this.s = p.smin + (p.smax - p.smin) * k / 6; let lo = this.dMin, hi = 8;
        const ok = (d) => { this.d = d; this.vf = null; return this.vFoot() <= this.eye + 1e-3; };
        if (!ok(lo)) { out.push(lo); continue; }
        for (let it = 0; it < 12; it++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
        out.push(lo);
      }
      for (const [k, x] of keep) this[k] = x; this.vf = null;
      out.sort((a, b) => a - b); this.dp = [key, out[out.length >> 1]]; return this.dp[1];
    }
    return Math.max(this.dMin, (this.eye - this.floor) / (this.tan * (1 - 2 * bottom)));
  }
  // 人的模式實際的最遠距離：dPerson 再收到每顆岩點都點得到（定線的標準之一；cave、內角的牆腳在最遠時常常走不到）。算的時候 dMax 先用 dPerson
  dFar() {
    const key = [this.W, this.H].join('|'); if (this.df && this.df[0] === key) return this.df[1];
    if (this.dfBusy || !this.holds || !this.holds.length || !this.sees) return this.dPerson;
    this.dfBusy = true;
    try {
      let hi = this.dPerson, lo = this.dMin;
      if (this.missedHolds(hi).length) { for (let k = 0; k < 6; k++) { const m = (lo + hi) / 2; if (this.missedHolds(m).length) hi = m; else lo = m; } hi = lo; }
      this.df = [key, hi]; return hi;
    } finally { this.dfBusy = false; }
  }
  // 人的模式看的高度範圍：最低到牆腳附近的岩點、最高到最上面的岩點（抬頭、低頭到看得到它們在畫面中間）
  vSpan() {
    if (this.vs) return this.vs;
    const H = this.holds, up = this.p.up; let lo = this.floor + 0.3, hi = this.eye;
    if (H && H.length) for (const P of H) { const h = P.dot(up); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    return (this.vs = [lo, hi]);
  }
  // 人的模式低頭的下限：可用畫面的下緣剛好到牆腳（再低頭只多看到切掉的地面）。鏡頭在眼睛高度、離看的那一點水平距離 D
  vFoot() {
    const t = this.table, bottom = this.wide || !t ? 0 : t.bottom;
    if (this.sees) {
      // 用模型打射線：可用畫面下緣中間那條線剛好還打在牆上的最低看的高度（每 5 公分、每個距離刻度記著）
      const key = [Math.round(this.s / STEP), this.dQuant(this.d), this.yawKey(), this.W, this.H].join('|'), m = this.vf || (this.vf = new Map());
      if (m.has(key)) return m.get(key);
      const v0 = this.v, c = this.cam, f = new Vector3(), u = new Vector3(), ty = this.tan * (1 - 2 * bottom);
      const hits = (v) => { this.v = v; this.place(this.s, this.d); c.getWorldDirection(f); u.setFromMatrixColumn(c.matrixWorld, 1); return this.sees(c.position.clone(), f.clone().addScaledVector(u, -ty).normalize()); };
      let lo = this.vSpan()[0] - 1, hi = this.eye + 0.5, r;
      if (hits(lo)) r = lo; else if (!hits(hi)) r = this.eye; else { for (let k = 0; k < 12; k++) { const mid = (lo + hi) / 2; if (hits(mid)) hi = mid; else lo = mid; } r = hi; }
      this.v = v0; if (m.size > 4000) m.clear(); m.set(key, r); return r;
    }
    const { cam, look } = this.pose(this.s, this.d), D = Math.hypot(cam[0] - look[0], cam[1] - look[1]) || this.d, half = Math.atan(this.tan * (1 - 2 * bottom));
    return this.eye - D * Math.tan(Math.atan2(this.eye - this.floor, D) - half);
  }
  // 最遠的距離（定線的標準之三，各種畫面比例都一樣）：牆上有一段（連續一個畫面寬）走過去畫面四邊都是牆（vRange；不看到牆外），不為了牆角、最外側的岩點拉近。
  // 邊界表是 Studio 校正的另一套鏡頭，照實際比例在 App 裡算
  get dFill() {
    if (this.fill && this.fill[0] === this.W && this.fill[1] === this.H) return this.fill[2];
    return this.keepCam(() => this.dFill0());
  }
  dFill0() {
    const { yaw, pass, passFrom, vr } = this; this.yaw = 0; this.pass = false; this.passFrom = null;   // 照正常角度算
    // 牆上有一段連續一個畫面寬的地方，走過去畫面四邊都是牆（第一段夠長的就停）
    const ok = (d) => { const p = this.p, w = 2 * d * this.tan * this.W / this.H; let run = -Infinity; for (let s = p.smin; s <= p.smax; s += V_STEP / 2) { const r = this.vRange(s, d, true); if (!r || r[0] > r[1]) run = -Infinity; else if (run === -Infinity) run = s; else if (s - run >= w) return true; } return false; };
    let lo = 0.5, hi = 2 * Math.max(...this.reach); for (let k = 0; k < 10; k++) { const d = (lo + hi) / 2; if (ok(d)) lo = d; else hi = d; }
    Object.assign(this, { yaw, pass, passFrom, vr }); this.fill = [this.W, this.H, lo]; return lo;
  }
  // 定線標準的檢查（巡檢用）：距離 d 時點不到的岩點。每顆找左右範圍裡讓它最靠近畫面中央的位置（每 5 公分看一次）、鏡頭高度對準它，經過 clamp
  // （實際走得到的範圍）後要完整出現在可用畫面（直的畫面扣掉上下兩塊、離邊 HOLD_R）；側牆上的再試 ±30° 內的角度（標準之四）。回傳點不到的岩點
  missedHolds(d) { return this.keepCam(() => this.missed0(d)); }
  missed0(d) {
    const H = this.holds; if (!H || !H.length) return [];
    const p = this.p, F = new Set(this.front()), t = this.table, [top, bottom] = this.wide || !t ? [0, 0] : [t.top, t.bottom];
    const keep = ['s', 'v', 'd', 'yaw', 'pass', 'passFrom', 'passK'].map(k => [k, this[k]]); this.pass = false; this.passFrom = null; this.passK = 0;
    let left = H.map(P => ({ P, h: P.dot(p.up), side: !F.has(P) }));
    for (const yaw of [0, 1, -1, 2, -2, 3, -3].map(k => k * YAW_MAX / 3)) {
      const todo = left.filter(o => !yaw || o.side || this.person); if (!todo.length) continue;   // 人的模式：走到盡頭再滑會轉頭（endTurn），盡頭附近的岩點轉過去看得到也算
      this.yaw = yaw; this.d = d; const [A, B] = this.sRange();
      for (let s = A; s <= B + 1e-9; s = s < B && s + STEP > B ? B : s + STEP) {
        this.place(s, d);
        for (const o of todo) { const g = this.inFrame(o.P); if (g && !(Math.abs(g.nx) >= Math.abs(o.nx ?? Infinity))) { o.nx = g.nx; o.s = s; } }
      }
      const ok = new Set(todo.filter(o => {
        if (o.s === undefined) return false;
        this.s = o.s; this.v = o.h; this.d = d; this.clamp(); this.apply(); o.nx = undefined;
        const g = this.inFrame(o.P);
        const e = 2 / this.H;   // 一個像素的容許：needCell 每 STEP 取樣，岩點的最佳位置在取樣點之間時，最低、最高的岩點會差不到半個像素
        return g && Math.abs(g.nx) <= 1 - g.mx && g.ny >= -1 + 2 * bottom + g.my - e && g.ny <= 1 - 2 * top - g.my + e;
      }));
      left = left.filter(o => !ok.has(o));
    }
    for (const [k, x] of keep) this[k] = x;
    return left.map(o => o.P);
  }
  // 算範圍時要把鏡頭擺到別的位置試；算完放回原處（App 每一格直接拿這個相機畫，不能留在試的位置）
  // 做完把鏡頭放回原來的樣子。可以疊著用：外層已經在保存了，裡面的就直接做（vRange 一排上百格，每格都複製一次鏡頭的位置、方向很浪費）
  keepCam(fn) {
    if (this.kept) return fn();
    const c = this.cam, P = c.position.clone(), Q = c.quaternion.clone(), n = c.near, f = c.far;
    this.kept = true;
    try { return fn(); } finally { this.kept = false; c.position.copy(P); c.quaternion.copy(Q); c.near = n; c.far = f; c.updateProjectionMatrix(); c.updateMatrixWorld(); }
  }
  resize(W, H) { this.W = W; this.H = H; this.cam.aspect = W / H; this.cam.updateProjectionMatrix(); this.clamp(); }
  get tan() { return Math.tan(this.cam.fov * Math.PI / 360); }
  // 牆面上每個螢幕點幾公尺：鏡頭離最凸出的地方 d，一般的牆面再往後一點
  get mpp() { return 2 * (this.d + Math.max(0, this.depth(this.s, this.v) - this.depth(this.s, this.v, this.Tm))) * this.tan / this.H; }   // 量在一般的牆面上（岩點、凸出的部分在它前面）：拖動時牆面跟手
  // 最遠：牆的高度剛好填滿畫面（牆比畫面窄時，寬度填滿）；最近：0.5 公尺
  get dMin() { return this.table ? 0.5 : Math.min(0.5, this.dMax); }
  // ---- 實拍的表（calibrate 產生，Studio 烘焙時存進成品包）----
  // 表：沿牆每 step 公尺一個取樣點（s0 起），幾個距離 levels（由遠到近）；每個距離、每個取樣點：鏡頭在那裡時「畫面四邊都是牆」的
  // 看得到的牆的下邊 lo、上邊 hi（鏡頭中心的高度限制 ∓ 半高；null＝那個距離在那裡塞不滿畫面），和整面牆左右兩端看得到的邊 sa、sb。
  useTable(t) {
    this.table = t; const n = t.lo[0].length, L = t.levels;
    // 像人站在牆前：地面＝牆腳（各段牆腳高度的中位數），鏡頭在地面上 EYE；看的高度 v 只決定抬頭多少
    const foot = Array.from(this.lo).sort((a, b) => a - b); this.floor = foot[foot.length >> 1]; this.eye = this.floor + Math.min(EYE, 0.55 * this.hTyp); this.person = true;   // 模型的尺度不一定準：矮的牆照牆高的 55% 算
    // 每個取樣點最遠能拉到多遠：從最近的距離往遠找，到第一個塞不滿的為止（在那個距離的兩端之外的不算：那是牆的盡頭，由左右範圍管）
    const inside = (r, i) => { const x = t.s0 + i * t.step, hw = L[r] * this.tan * t.aspect; return x >= t.sa[r] + hw - 1e-6 && x <= t.sb[r] - hw + 1e-6; };
    this.reach = Array.from({ length: n }, (_, i) => { let f = this.dMin; for (let r = L.length - 1; r >= 0 && (t.lo[r][i] !== null || !inside(r, i)); r--) f = L[r]; return f; });
    this.reach = this.reach.map((f, i, F) => Math.min(f, F[Math.max(0, i - 1)], F[Math.min(n - 1, i + 1)]));
    // 斜率限制：每走 1 公尺最多拉近（或拉遠）SLOPE 公尺（下包絡）。快到轉角、缺口前就開始慢慢靠近，不會拖一下就突然放大
    const R = this.reach; this.reach = R.map((_, i) => { let f = Infinity; for (let j = 0; j < n; j++) f = Math.min(f, R[j] + SLOPE * Math.abs(i - j) * t.step); return f; });
  }
  // 距離 d 時鏡頭到牆端要留的半寬：比表上最近的距離還近時照最近的那個算（沒有實拍過，轉角附近往外推會看到側牆）
  reachHw(d) { return Math.max(d, this.table.levels.at(-1)) * this.tan * this.W / this.H; }
  // 距離 d 時整面牆左右兩端看得到的邊（各距離之間內插；遠的時候轉角那段塞不滿畫面，邊會往內縮）
  ends(d) {
    const t = this.table, L = t.levels; let k = L.findIndex(x => x <= d);
    if (k < 0) return [t.sa.at(-1), t.sb.at(-1)]; if (k === 0) return [t.sa[0], t.sb[0]];
    const w = (L[k - 1] - d) / (L[k - 1] - L[k]); return [t.sa[k - 1] + (t.sa[k] - t.sa[k - 1]) * w, t.sb[k - 1] + (t.sb[k] - t.sb[k - 1]) * w];
  }
  // 位置 s 最遠能拉到多遠（那裡和左右鄰居都塞得滿畫面的最遠距離）
  farAt(s) {
    const t = this.table, x = Math.max(0, Math.min(this.reach.length - 1.001, (s - t.s0) / t.step)), i = Math.floor(x), u = x - i; return this.reach[i] + (this.reach[i + 1] - this.reach[i]) * u;
  }
  // 位置 s、距離 d 時看得到的牆的下邊、上邊：同一個取樣點上下兩個距離（都塞得滿的）之間內插，再在兩個取樣點之間內插
  vEdges(s, d) {
    const t = this.table, L = t.levels, x = Math.max(0, Math.min(t.lo[0].length - 1.001, (s - t.s0) / t.step)), i = Math.floor(x), u = x - i;
    const at = (k) => {
      let A = -1, B = -1; for (let r = 0; r < L.length; r++) if (t.lo[r][k] !== null) { if (L[r] >= d) A = r; else if (B < 0) B = r; }
      if (A < 0 && B < 0) return null; if (A < 0) A = B; if (B < 0) B = A;
      const w = L[A] === L[B] ? 0 : (L[A] - d) / (L[A] - L[B]); return [t.lo[A][k] + (t.lo[B][k] - t.lo[A][k]) * w, t.hi[A][k] + (t.hi[B][k] - t.hi[A][k]) * w];
    };
    // 往左、往右找最近有資料的取樣點，兩點之間內插（中間塞不滿的點跳過，上下界連續變化）
    const near = (k, dir) => { for (let j = k; j >= 0 && j < t.lo[0].length; j += dir) { const e = at(j); if (e) return [j, e]; } return null; };
    const A = near(i, -1), B = near(i + 1, 1); if (!A || !B) return (A || B || [0, null])[1];
    const w = (x - A[0]) / (B[0] - A[0]); return [A[1][0] + (B[1][0] - A[1][0]) * w, A[1][1] + (B[1][1] - A[1][1]) * w];
  }
  clamp() {
    const p = this.p; this.d = Math.max(this.dMin, Math.min(this.dMax, this.d));
    if (this.person) {
      const [lo, hi] = this.sRange(); this.s = lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, this.s));
      const [a, b] = this.vSpan(), vl = Math.max(a, this.vFoot() - FOOT_SLACK); this.v = Math.max(Math.min(vl, b), Math.min(b, this.v));
      return;
    }
    if (this.table) {
      // 距離只限在最近、最遠之間（走到哪裡都不自動拉近）；高度照邊界表：畫面上下都是牆（塞不滿就停在中間）
      for (let it = 0; it < 2; it++) {
        const [lo, hi] = this.sRange(); this.s = lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, this.s));
        const r = this.sees && this.vRange(this.s, this.d);
        if (r) { this.v = r[0] > r[1] ? (r[0] + r[1]) / 2 : Math.max(r[0], Math.min(r[1], this.v)); continue; }
        const hh = this.d * this.tan, e = this.vEdges(this.s, this.d);
        if (e) this.v = e[1] - e[0] <= 2 * hh ? (e[0] + e[1]) / 2 : Math.max(e[0] + hh, Math.min(e[1] - hh, this.v));
      }
      return;
    }
    const hh = this.d * this.tan, hw = hh * this.W / this.H;
    this.s = p.smax - p.smin <= 2 * hw ? (p.smin + p.smax) / 2 : Math.max(p.smin + hw, Math.min(p.smax - hw, this.s));
    for (let it = 0; it < 3; it++) {   // 上下界跟鏡頭高度有關（外傾處鏡頭跟著退）：迭代幾次就穩
      const [lo, hi] = this.vlim(this.s, hw, this.v);
      this.v = hi - lo <= 2 * hh ? (lo + hi) / 2 : Math.max(lo + hh, Math.min(hi - hh, this.v));
    }
  }
  // 實拍校正（Studio 烘焙時做）：在幾個距離、沿牆每個取樣點，用小張的離屏渲染（牆畫白、背景黑）找出「畫面四邊都是牆」的鏡頭高度範圍，
  // 兩端走到哪裡為止也一樣。頂點統計在轉角、側牆、外傾的斜邊、岩壁的缺口附近估不準，實拍的就是畫面會看到的。回傳表（可以存起來，useTable 讀回）
  // top、bottom：畫面上下各有多少（比例）不必是牆：上面允許露出牆頂上方的一點空間，下面是工具列擋住的地方（最低的腳點停在工具列上面）
  calibrate(renderer, scene, { levels = [1.25, 1.1, 0.95, 0.82, 0.7, 0.6, 0.5, 0.42, 0.35, 0.28, 0.24, 0.2], iters = 5, px = 24, top = 0, bottom = 0 } = {}) {
    const W = px, H = Math.round(px * this.H / this.W), rt = new WebGLRenderTarget(W, H), buf = new Uint8Array(W * H * 4);
    const white = new MeshBasicMaterial({ color: 0xffffff, side: 2 }), bg = scene.background, om = scene.overrideMaterial, keep = [this.s, this.v, this.d];
    scene.background = new Color(0); scene.overrideMaterial = white; this.table = null;
    let renders = 0;
    // 畫面四邊（讀回來第 0 列是最下；上下扣掉 top、bottom）各 97% 以上是牆
    const yb = Math.round(H * bottom), yt = H - 1 - Math.round(H * top), rows = yt - yb + 1;
    const full = (s, v, d) => {
      this.s = s; this.v = v; this.d = d; this.apply(); renderer.setRenderTarget(rt); renderer.render(scene, this.cam); renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf); renderer.setRenderTarget(null); renders++;
      const px = (x, y) => buf[(y * W + x) * 4] > 128; let b = 0, t = 0, l = 0, r = 0;
      for (let x = 0; x < W; x++) { b += px(x, yb); t += px(x, yt); } for (let y = yb; y <= yt; y++) { l += px(0, y); r += px(W - 1, y); }
      return b >= W * 0.97 && t >= W * 0.97 && l >= rows * 0.97 && r >= rows * 0.97;
    };
    const p = this.p, a = this.W / this.H, dm = Math.min(this.hTyp / 2, (p.smax - p.smin) / 2 / a) / this.tan;
    const step = Math.max(0.25, (p.smax - p.smin) / 120), s0 = p.smin - 0.5, n = Math.ceil((p.smax - p.smin + 1) / step) + 1;
    const L = levels.map(l => dm * l).filter(d => d >= this.dMin * 0.9), T = { aspect: a, step, s0, levels: L, lo: [], hi: [], top, bottom };
    let guess = new Array(n).fill(null);   // 上一個距離在同一點可以的高度：先試它，通常一次就中
    for (const d of L) {
      const hh = d * this.tan, hw = hh * a, lo = new Array(n).fill(null), hi = new Array(n).fill(null);
      for (let i = 0; i < n; i++) {
        const s = s0 + i * step, [l0, h0] = this.vlim(s, hw, this.v), c = (l0 + h0) / 2, tries = [guess[i], c]; for (let k = 1; k <= 3; k++) tries.push(c + k * hh / 2, c - k * hh / 2);
        const ok = tries.find(v => v !== null && full(s, v, d)); if (ok === undefined) continue;
        let x = ok - 3, y = ok; for (let k = 0; k < iters; k++) { const m = (x + y) / 2; if (full(s, m, d)) y = m; else x = m; } const vlo = y;
        x = ok; y = ok + 3; for (let k = 0; k < iters; k++) { const m = (x + y) / 2; if (full(s, m, d)) x = m; else y = m; }
        lo[i] = vlo - hh; hi[i] = x + hh; guess[i] = (vlo + x) / 2;
      }
      // 取樣點之間是線性內插：下邊取左右鄰居的最高、上邊取最低（保守）
      const nb = (A, f) => A.map((x, i) => x === null ? null : f(...[A[i - 1], x, A[i + 1]].filter(y => y !== null && y !== undefined)));
      // 孤立的一點（左右都塞不滿，常在轉角、側牆前）不算：兩端從它往外量會把側牆算進來，走過去上下界也會一下跳到那一點的範圍
      for (let i = 0; i < n; i++) if (lo[i] !== null && lo[i - 1] == null && lo[i + 1] == null) lo[i] = hi[i] = null;
      T.lo.push(nb(lo, Math.max)); T.hi.push(nb(hi, Math.min));
    }
    // 每個距離整面牆的兩端：最外面可以的取樣點往外二分（那一點能到的最低、最高都要整個畫面是牆），存成看得到的牆的邊
    T.sa = []; T.sb = [];
    L.forEach((d, r) => {
      const hh = d * this.tan, hw = hh * a, ok = T.lo[r].map((x, i) => x === null ? -1 : i).filter(i => i >= 0);
      if (!ok.length) { T.sa.push(Infinity); T.sb.push(-Infinity); return; }
      const end = (k, dir) => { let x = s0 + k * step, y = x + dir * step; const vs = [T.lo[r][k] + hh, T.hi[r][k] - hh]; for (let i = 0; i < iters; i++) { const m = (x + y) / 2; if (vs.every(v => full(m, v, d))) x = m; else y = m; } return x; };
      T.sa.push(end(ok[0], -1) - hw); T.sb.push(end(ok.at(-1), 1) + hw);
    });
    // 塞不滿的距離（一個取樣點都沒有）不要
    const keepR = L.map((_, r) => T.sa[r] < T.sb[r]); ['levels', 'lo', 'hi', 'sa', 'sb'].forEach(k => { T[k] = T[k].filter((_, r) => keepR[r]); });
    rt.dispose(); white.dispose(); scene.background = bg; scene.overrideMaterial = om; [this.s, this.v, this.d] = keep;
    this.renders = renders; this.far = null; this.useTable(T);
    return T;
  }
  // 拖：沿牆走、升降。距離（縮放）固定，拖動時畫面大小不變；鏡頭照等距線走（offset），內角那裡停在角落前面只轉向，左右走到畫面邊緣碰到牆的盡頭為止（sRange）
  // P：手指底下那一點（世界座標，呼叫端打射線找的；沒給就用畫面中央的牆面）
  pan(dx, dy, P = null) {
    const m = this.mpp;
    if (!this.table) { this.v += dy * m; this.s -= dx * m; this.clamp(); return; }
    const A = P || this.anchor(), [x, y] = this.screenOf(A);
    this.track(A, x + dx, y + dy, -dx * m, dy * m);
    if (dx) this.turnPass();
  }
  // 捏合：以 (px, py) 為中心縮放 k 倍（k>1 放大＝靠近）。P：縮放前 (px, py) 底下那一點（世界座標，沒給用估的），縮放後還在 (px, py)
  zoomAt(k, px, py, P = null) {
    const A = P || this.pointAt(px, py), d0 = this.d;
    this.d /= k; this.clamp(); this.want = this.d;
    this.track(A, px, py, 0, 0, false, Math.abs(d0 - this.d));   // 找不到就不動 s、v（只縮放）；距離變多少，鏡頭位置可能要跟著移那麼多（轉角、牆端附近）
  }
  // 世界座標的點在目前鏡頭畫面上的位置（螢幕點）
  screenOf(P) { this.apply(); const q = P.clone().project(this.cam); return [(q.x + 1) / 2 * this.W, (1 - q.y) / 2 * this.H]; }
  // 畫面 (px, py) 底下牆面上的點（估的：畫面中央那一點照每像素幾公尺平移）
  pointAt(px, py) {
    const m = this.mpp, c = this.anchor(); this.apply();
    const r = new Vector3().setFromMatrixColumn(this.cam.matrixWorld, 0), u = new Vector3().setFromMatrixColumn(this.cam.matrixWorld, 1);
    return c.addScaledVector(r, (px - this.W / 2) * m).addScaledVector(u, -(py - this.H / 2) * m);
  }
  // 跟手：解出沿牆位置 s、高度 v，讓世界座標的點 P 正好落在畫面 (x, y)（手指底下那一點跟著手指）。左右只動 s、上下只動 v，各自在附近找，交替兩次。
  // 只在這一格手指移動量（縮放時是距離的變化 far）的附近找（找太遠會跳到牆的另一頭）；附近找不到就照一般的速度走 fs、fv。onlyV：只解高度
  track(P, x, y, fs = 0, fv = 0, onlyV = false, far = 0) {
    const f = [() => this.screenOf(P)[0] - x, () => this.screenOf(P)[1] - y], m = Math.max(1e-4, this.mpp);
    const solve = (key, fn, guess, reach) => {
      const x0 = this[key], f0 = fn(); if (!isFinite(f0)) { this[key] = x0 + guess; return; } if (Math.abs(f0) < 0.3) return;
      let best = null;   // 往兩邊各走幾步（步長加倍，最遠 reach），找最靠近 x0 的變號
      for (const dir of [1, -1]) {
        let a = x0, fa = f0;
        for (let h = reach / 64; h <= reach * 1.001; h *= 2) { const b = x0 + dir * h; this[key] = b; const fb = fn(); if (!isFinite(fb)) break; if (Math.sign(fb) !== Math.sign(fa)) { if (!best || h < best.h) best = { a, b, fa, h }; break; } a = b; fa = fb; }
      }
      if (!best) { this[key] = x0 + guess; return; }
      let { a, b, fa } = best;
      for (let j = 0; j < 24; j++) { const mid = (a + b) / 2; this[key] = mid; const fm = fn(); if (Math.sign(fm) === Math.sign(fa)) { a = mid; fa = fm; } else b = mid; }
      this[key] = (a + b) / 2;
    };
    const reach = Math.max(Math.abs(fs), Math.abs(fv), m * 4, far) * 4;
    for (let it = 0; it < 2; it++) { if (!onlyV) solve('s', f[0], it ? 0 : fs, reach); solve('v', f[1], it ? 0 : fv, reach); }
    this.clamp();
  }
  // ---- 鏡頭路徑：跟正在看的那段牆保持距離 d ----
  // 沿牆每個取樣點：牆面點 R（基準線往前 depth，σ 15 公分去雜訊成 L）。看的方向是牆面線平滑 1 公尺的法線 N（轉角處慢慢轉），
  // 鏡頭在 L＋d·N、看沿 −N 打到真正牆面線的那一點 S。內角那裡等距線會打結（兩段交叉）：交叉中間那一段鏡頭從交叉點沿 −N 看出去，
  // 往前走到離看的那片牆 d 為止（往角落裡走再出來），看的方向從進來時平均轉到出去時，鏡頭不往回走。外角那裡鏡頭繞著走
  offset(d) {
    const v = this.v0, key = d.toFixed(4); if (this.off && this.off.key === key) return this.off;
    const p = this.p, n = p.n, R = new Float32Array(2 * n), r0 = Math.max(1, Math.round(0.15 / STEP));
    for (let i = 0; i < n; i++) {
      let tx = 0, ty = 0;
      for (let j = Math.max(1, i - 3 * r0); j <= Math.min(n - 1, i + 3 * r0 + 1); j++) { const g = Math.exp(-((j - 0.5 - i) ** 2) / (2 * r0 * r0)); tx += (p.X[j] - p.X[j - 1]) * g; ty += (p.Y[j] - p.Y[j - 1]) * g; }
      const l = Math.hypot(tx, ty) || 1, t = this.depth(i * STEP, v); R[2 * i] = p.X[i] + p.flip * -ty / l * t; R[2 * i + 1] = p.Y[i] + p.flip * tx / l * t;
    }
    const sm = (A, sg) => { const r = sg / STEP, B = new Float32Array(2 * n); for (let i = 0; i < n; i++) { let x = 0, y = 0, w = 0; for (let j = Math.max(0, Math.floor(i - 3 * r)); j <= Math.min(n - 1, Math.ceil(i + 3 * r)); j++) { const g = Math.exp(-((j - i) ** 2) / (2 * r * r)); x += A[2 * j] * g; y += A[2 * j + 1] * g; w += g; } B[2 * i] = x / w; B[2 * i + 1] = y / w; } return B; };
    const L = sm(R, 0.15), M = sm(R, 1), N = new Float32Array(2 * n), O = new Float32Array(2 * n), S = new Float32Array(2 * n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1), tx = M[2 * b] - M[2 * a], ty = M[2 * b + 1] - M[2 * a + 1], l = Math.hypot(tx, ty) || 1;
      N[2 * i] = p.flip * -ty / l; N[2 * i + 1] = p.flip * tx / l; O[2 * i] = L[2 * i] + N[2 * i] * d; O[2 * i + 1] = L[2 * i + 1] + N[2 * i + 1] * d;
    }
    const hit = (ox, oy, dx, dy) => this.rayWall(R, ox, oy, dx, dy);
    for (let i = 0; i < n; i++) { const t = hit(O[2 * i], O[2 * i + 1], -N[2 * i], -N[2 * i + 1]); S[2 * i] = t < Infinity ? O[2 * i] - N[2 * i] * t : L[2 * i]; S[2 * i + 1] = t < Infinity ? O[2 * i + 1] - N[2 * i + 1] * t : L[2 * i + 1]; }
    // 等距線的線段 i、j 交叉的點
    const cross = (i, j) => { const ax = O[2 * i], ay = O[2 * i + 1], bx = O[2 * i + 2] - ax, by = O[2 * i + 3] - ay, cx = O[2 * j], cy = O[2 * j + 1], ex = O[2 * j + 2] - cx, ey = O[2 * j + 3] - cy, den = bx * ey - by * ex; if (Math.abs(den) < 1e-12) return null; const t = ((cx - ax) * ey - (cy - ay) * ex) / den, u = ((cx - ax) * by - (cy - ay) * bx) / den; return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [ax + bx * t, ay + by * t] : null; };
    for (let i = 0; i < n - 3; i++) {
      let X = null, j = Math.min(n - 2, i + Math.ceil(4 * d / STEP)); for (; j >= i + 2 && !(X = cross(i, j)); j--);
      if (!X) continue;
      // 看的方向從進來時（i）平均轉到出去時（j+1）：一路往同一邊轉（平滑的法線在這裡不一定單調，來回轉畫面會反著跑）
      let a0 = Math.atan2(-N[2 * i + 1], -N[2 * i]), a1 = Math.atan2(-N[2 * j + 3], -N[2 * j + 2]); while (a1 - a0 > Math.PI) a1 -= 2 * Math.PI; while (a1 - a0 < -Math.PI) a1 += 2 * Math.PI;
      for (let k = i + 1; k <= j; k++) {
        const a = a0 + (a1 - a0) * (k - i) / (j + 1 - i), dx = Math.cos(a), dy = Math.sin(a), t = hit(X[0], X[1], dx, dy), f = t < Infinity ? Math.max(0, t - d) : 0;
        N[2 * k] = -dx; N[2 * k + 1] = -dy; O[2 * k] = X[0] + dx * f; O[2 * k + 1] = X[1] + dy * f; if (t < Infinity) { S[2 * k] = X[0] + dx * t; S[2 * k + 1] = X[1] + dy * t; }
      }
      i = j - 1;
    }
    // 外角那裡鏡頭繞著走，一步走的比牆面點多很多（繞到側牆、牆的後面）：從中間往兩邊走，鏡頭移動超過牆面點的 1.5 倍就停在那裡，再往外只轉頭
    const mid = (n - 1) >> 1, step = (i, j) => Math.hypot(O[2 * i] - O[2 * j], O[2 * i + 1] - O[2 * j + 1]) > 1.5 * Math.hypot(S[2 * i] - S[2 * j], S[2 * i + 1] - S[2 * j + 1]) + 0.02;
    let fl = 0, fr = n - 1;
    for (let i = mid; i > 0; i--) if (step(i, i - 1)) { fl = i; break; }
    for (let i = mid; i < n - 1; i++) if (step(i, i + 1)) { fr = i; break; }
    return (this.off = { key, R, S, N, O, fl, fr });
  }
  // 沿牆位置 s：鏡頭的水平位置 cam、看的點 look（都是水平面上的 [right, f] 座標）。
  // 鏡頭只在牆面範圍（smin～smax）裡走，外角那裡也不繞過去（offset 的 fl、fr）：看的點走出去時鏡頭站在端點轉頭看，不會看到牆的後面
  pose(s, d = this.d) {
    const o = this.offset(d), sf = this.stops(o);
    return this.posePath(s, d, o, sf);
  }
  // 鏡頭沿等距線走到哪裡為止：牆面範圍（smin～smax）、外角不繞過去（offset 的 fl、fr）
  stops(o) { return [Math.max(this.p.smin, o.fl * STEP), Math.min(this.p.smax, o.fr * STEP)]; }
  posePath(s, d, o, sf) {
    const sc = Math.max(sf[0], Math.min(sf[1], s)), n = this.p.n, x = Math.max(0, Math.min(n - 1, s / STEP)), i = Math.min(n - 2, Math.floor(x)), u = x - i;
    let c = this.cam0(sc, d);
    // 過了停點（轉進 cave、側牆）：鏡頭不停在原地只轉頭（越看越斜），照停點前走的方向繼續直走、看的點照樣沿牆走，所以邊走邊往那一側轉；
    // 走到離前面的牆 d 為止，不走進去（人在現場就是這樣看側牆的下半部）
    if (Math.abs(sc - s) > 1e-6) {
      const left = s < sc, e = this.beyond(o, d, left ? -1 : 1, sf), span = left ? sc : (this.p.n - 1) * STEP - sc;
      const t = e.max * Math.min(1, Math.abs(sc - s) / Math.max(span, 1e-6));   // 停點外那段牆走完時剛好走滿
      c = [c[0] + e.dir[0] * t, c[1] + e.dir[1] * t];
    }
    return { cam: c, look: [o.S[2 * i] + (o.S[2 * i + 2] - o.S[2 * i]) * u, o.S[2 * i + 1] + (o.S[2 * i + 3] - o.S[2 * i + 1]) * u] };
  }
  // 停點外的直走：沿主牆的左右方向（軌道座標的 right 軸）走，像人沿著牆由右向左走；
  // 最多走到停點外那段牆最外側的位置（cave 最裡面那面牆的左右位置），不會再往前走到牆的外面
  beyond(o, d, side, sf) {
    const key = side < 0 ? 'bl' : 'br'; if (o[key]) return o[key];
    const n = this.p.n, i = Math.max(0, Math.min(n - 1, Math.round((side < 0 ? sf[0] : sf[1]) / STEP))), R = o.R, cx = o.O[2 * i];
    let ext = cx;
    for (let k = side < 0 ? 0 : i; side < 0 ? k <= i : k < n; k++) ext = side < 0 ? Math.min(ext, R[2 * k]) : Math.max(ext, R[2 * k]);
    return (o[key] = { dir: [side, 0], max: Math.max(0, side < 0 ? cx - ext : ext - cx) });
  }
  cam0(s, d) {
    const O = this.offset(d).O, n = this.p.n, x = Math.max(0, Math.min(n - 1, s / STEP)), i = Math.min(n - 2, Math.floor(x)), u = x - i;
    return [O[2 * i] + (O[2 * i + 2] - O[2 * i]) * u, O[2 * i + 1] + (O[2 * i + 3] - O[2 * i + 1]) * u];
  }
  // 水平面上從 (ox, oy) 往 (dx, dy) 打到牆面線 R 多遠（打不到 Infinity）
  rayWall(R, ox, oy, dx, dy) {
    let best = Infinity;
    for (let j = 0; j < this.p.n - 1; j++) { const ax = R[2 * j], ay = R[2 * j + 1], ex = R[2 * j + 2] - ax, ey = R[2 * j + 3] - ay, den = dx * ey - dy * ex; if (Math.abs(den) < 1e-9) continue; const t = ((ax - ox) * ey - (ay - oy) * ex) / den, u = ((ax - ox) * dy - (ay - oy) * dx) / den; if (t > 0.05 && u >= 0 && u <= 1 && t < best) best = t; }
    return best;
  }
  // 這個位置的角度：兩指調的 yaw 加上回程角度 auto（沿牆每個取樣點一個，stage.planAngles 算好的：去程正常角度被擋住的岩點，回程換這個角度看得到）。
  // 滑到一端再往回滑（turnPass）時漸漸換成回程角度；到另一端再往回就漸漸換回來。繞點轉 δ 鏡頭橫移約 d·δ，跟沿牆走一樣會帶著畫面跑：
  // 每走 1 公尺角度最多變 YAW_RATE／d（橫移最多是拖動的一半，畫面維持手指的 0.5～1.5 倍），所以換滿 ±30° 要走 YAW_MAX·d／YAW_RATE
  yawAt(s) {
    let y = this.yaw; const a = this.auto;
    if (a && this.passFrom !== null) {
      const k = this.blend(s);
      if (k > 0) { const x = Math.max(0, Math.min(a.length - 1.001, s / STEP)), i = Math.floor(x); y += k * (a[i] + (a[i + 1] - a[i]) * (x - i)); }
    }
    return Math.max(-YAW_MAX, Math.min(YAW_MAX, y));
  }
  // 回程角度用了幾成（0＝正常角度、1＝回程角度）：從換趟的地方（passFrom，當時是 passK）往這一趟的目標漸變
  blend(s) {
    if (this.passFrom === null) return 0;
    const w = Math.min(1, Math.abs(s - this.passFrom) * YAW_RATE / (YAW_MAX * this.d));
    return this.passK + ((this.pass ? 1 : 0) - this.passK) * w;
  }
  // 滑到左右範圍的盡頭再往回：換一趟（正常角度 ↔ 回程角度），從當下的角度接著漸變（同一端來回、還沒換完時不會一下跳到底）
  turnPass() {
    const [lo, hi] = this.sRange(), e = this.s <= lo + 1e-3 ? -1 : this.s >= hi - 1e-3 ? 1 : 0;
    if (e) this.atEnd = e; else if (this.atEnd) { this.passK = this.blend(this.s); this.pass = !this.pass; this.passFrom = this.atEnd < 0 ? lo : hi; this.atEnd = 0; }
  }
  // 鏡頭繞著看的點 look 水平轉 yaw，距離不變。轉過去會碰到牆（離牆面不到 30 公分、或跟看的點中間隔著牆面線）就轉少一點
  orbit(cam, look, d, yaw) {
    if (!yaw) return cam;
    const R = this.offset(d).R, n = this.p.n, cx = cam[0] - look[0], cy = cam[1] - look[1];
    const at = (a) => [look[0] + cx * Math.cos(a) - cy * Math.sin(a), look[1] + cx * Math.sin(a) + cy * Math.cos(a)];
    const free = (c) => {
      const ax = look[0] + (c[0] - look[0]) * 0.1, ay = look[1] + (c[1] - look[1]) * 0.1, bx = c[0] - ax, by = c[1] - ay;
      for (let j = 0; j < n - 1; j++) {
        const px = R[2 * j], py = R[2 * j + 1], ex = R[2 * j + 2] - px, ey = R[2 * j + 3] - py, ll = ex * ex + ey * ey || 1e-9;
        const k = Math.max(0, Math.min(1, ((c[0] - px) * ex + (c[1] - py) * ey) / ll)); if (Math.hypot(c[0] - px - ex * k, c[1] - py - ey * k) < 0.3) return false;
        const den = bx * ey - by * ex; if (Math.abs(den) < 1e-9) continue;
        const t = ((px - ax) * ey - (py - ay) * ex) / den, u = ((px - ax) * by - (py - ay) * bx) / den; if (t > 0 && t < 1 && u >= 0 && u <= 1) return false;
      }
      return true;
    };
    if (free(at(yaw))) return at(yaw);
    let lo = 0, hi = 1; for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2; if (free(at(yaw * m))) lo = m; else hi = m; }
    return at(yaw * lo);
  }
  // 左右走到哪裡停：畫面左右邊緣碰到牆面範圍的端點、而且邊緣看出去還打得到模型。不同螢幕的視角不同，都照這一條算（兩端的內角、側牆上的岩點靠調角度、回程角度看）
  // 範圍快取用的角度：調角度途中（coarse）每格角度都在變，照細的刻度每格都要重算整排範圍（上萬次射線，一格幾十毫秒）；用粗刻度（約 3°），放手後回細的
  yawKey() { return this.coarse ? 'c' + Math.round(this.yaw / YAW_COARSE) : this.yaw.toFixed(4); }
  sRange() {
    const key = [(this.coarse ? 'c' + Math.round(this.d / COARSE_D) * COARSE_D : this.d.toFixed(4)), this.W, this.H, this.yawKey(), this.pass, this.passFrom, this.passK, !!this.auto].join('|'); if (this.sr && this.sr.key === key) return this.sr.r;   // 跟高度無關：上下拖時左右的範圍不變（不會被夾著跳）
    const r = this.keepCam(() => this.sRange0());
    this.sr = { key, r }; return r;
  }
  sRange0() {
    const p = this.p, n = (p.n - 1) * STEP, q = new Vector3(), hw = this.tan * this.W / this.H;
    const ndc = (s, E) => { this.place(s, this.d); q.copy(E).applyMatrix4(this.cam.matrixWorldInverse); return q.z >= 0 ? null : q.x / -q.z / hw; };   // 照自己的視角算（不管相機目前的投影、裁切）
    // c(s) 在 a、b 兩頭不一樣（單調）：二分找交界；兩頭一樣回 null
    const bound = (c, a, b, it = 14) => { const ca = c(a); if (ca === c(b)) return null; let lo = a, hi = b; for (let k = 0; k < it; k++) { const m = (lo + hi) / 2; if (c(m) === ca) lo = m; else hi = m; } return (lo + hi) / 2; };
    // 牆面：畫面邊緣碰到牆面範圍的端點就停（鏡頭在範圍裡走）
    const EA = this.world(this.pose(p.smin).look, this.v0), EB = this.world(this.pose(p.smax).look, this.v0);
    let A = bound((s) => { const x = ndc(s, EA); return x !== null && x > -1; }, 0, p.smax) ?? p.smin;
    let B = bound((s) => { const x = ndc(s, EB); return x !== null && x < 1; }, p.smin, n) ?? p.smax;
    // 畫面四邊也要都是牆（sees：用模型打射線，岩點貓的 stage 給）：從中間往兩邊走，到找不到讓四邊都是牆的高度（vRange）就停；
    // 中間不會留一段走得進去、卻沒有這種高度的地方（那裡高度沒有依據，會露出牆外、換規則時跳）。中間就塞不滿（距離太遠）照只看左右邊緣的範圍
    if ((this.sees && !this.coarse) || this.person) {   // 捏合中跳過（每個距離刻度要上萬次射線）；放手後的第一次才補上四邊都是牆的範圍
      if (!this.person) {   // 人的模式抬頭、低頭會看到牆外，不要求四邊都是牆，只看左右（上面）和岩點
        const fits = (s) => { const r = this.vRange(s, this.d, true); return !!r && r[0] <= r[1]; }, m = (A + B) / 2, h = V_STEP / 2;
        if (fits(m)) { let a = m, b = m; while (a - h >= A && fits(a - h)) a -= h; while (b + h <= B && fits(b + h)) b += h; A = a; B = b; }
      }
      this.wallS = [A, B];
      // 定線的標準之一：每顆正面牆上的岩點都要點得到。最外側的岩點在範圍外時，只往外延伸到它剛好完整出現在畫面邊上（那一段允許露出牆外）
      const F = this.front();
      if (F.length) {
        const out = (s, dir) => { this.place(s, this.d); return F.filter(P => { const g = this.inFrame(P); return g && dir * g.nx > 1 - g.mx; }); };
        const reach = (s, dir, lim) => {   // 往 dir 延伸到 L 裡每顆都不再超出那一邊（s 往外走，岩點往畫面裡移）
          const L0 = out(s, dir); this.place(lim, this.d);
          const L = L0.filter(P => { const g = this.inFrame(P); return g && dir * g.nx <= 1 - g.mx; }); if (!L.length) return s;   // 走到軌道盡頭都進不來的不算（標準檢查會列出來）
          const okAt = (x) => { this.place(x, this.d); return L.every(P => { const g = this.inFrame(P); return g && dir * g.nx <= 1 - g.mx - 0.05; }); };   // 多進來一點（5%），上下範圍那邊才算得到它
          let a = s, b = lim; for (let k = 0; k < 14; k++) { const m = (a + b) / 2; if (okAt(m)) b = m; else a = m; } return b;
        };
        A = reach(A, -1, 0); B = reach(B, 1, n);
      }
    }
    // 停點外轉進 cave、側牆（posePath 的直走）：走得進去的那段都在範圍裡，側牆的岩點才走得到
    const o = this.offset(this.d), sf = this.stops(o), bl = this.beyond(o, this.d, -1, sf), br = this.beyond(o, this.d, 1, sf);
    if (bl.max > 0) A = Math.min(A, this.person ? this.aimEnd(A, sf[0], -1) : 0);   // 人的模式：只走到畫面中央還看得到牆的地方（再走下去整個畫面對著牆外）
    if (br.max > 0) B = Math.max(B, this.person ? this.aimEnd(B, sf[1], 1) : n);
    return [A, B];
  }
  // 停點外往 dir 走：從 from 往外每 STEP 看一次，畫面中央那條線打得到牆就繼續，回傳最後一個打得到的位置（沒有 sees 時走到底）
  aimEnd(A, from, dir) {
    const n = (this.p.n - 1) * STEP, end = dir < 0 ? 0 : n, c = this.cam, f = new Vector3(); let last = dir < 0 ? Math.min(A, from) : Math.max(A, from);
    if (!this.sees) return end;
    const rays = [0, -0.75, 0.75], hw = this.tan * this.W / this.H, r = new Vector3();
    for (let s = last; dir < 0 ? s >= end : s <= end; s += dir * STEP) {
      this.place(s, this.d); c.getWorldDirection(f); r.setFromMatrixColumn(c.matrixWorld, 0);
      if (!rays.every(x => this.sees(c.position.clone(), f.clone().addScaledVector(r, x * hw).normalize()))) break;   // 畫面中間和左右四分之三的地方都要打得到牆
      last = s;
    }
    return last;
  }
  // 正面牆上的岩點（holds，stage 給；側牆上的另外靠調角度）：離那個位置、高度的一般牆面不超過 SIDE
  front() {
    const H = this.holds; if (!H || !H.length) return [];
    if (this.fr && this.fr.H === H) return this.fr.F;
    const p = this.p, F = H.filter(P => {
      const x = P.dot(p.right), y = P.dot(p.f), h = P.dot(p.up);
      let k = 0, e = Infinity; for (let i = 0; i < p.n; i++) { const g = (p.X[i] - x) ** 2 + (p.Y[i] - y) ** 2; if (g < e) { e = g; k = i; } }
      const a = Math.max(0, k - 1), b = Math.min(p.n - 1, k + 1), tx = p.X[b] - p.X[a], ty = p.Y[b] - p.Y[a], l = Math.hypot(tx, ty) || 1, t = this.depth(k * STEP, h, this.Tm);
      return k > 0 && k < p.n - 1 && Math.hypot(x - p.X[k] - p.flip * -ty / l * t, y - p.Y[k] - p.flip * tx / l * t) <= SIDE;   // 在軌道兩端外面的也算側牆
    });
    this.fr = { H, F }; return F;
  }
  // 岩點在目前鏡頭（place 過的）畫面上的位置：nx、ny（可用畫面 -1～1 之前的原始比例）、離邊要留的 mx、my（HOLD_R 換成比例），和距離 z；在鏡頭後面回 null
  inFrame(P) {
    const q = (this._q || (this._q = new Vector3())).copy(P).applyMatrix4(this.cam.matrixWorldInverse), z = -q.z, tx = this.tan * this.W / this.H, ty = this.tan;
    return z > 0 ? { nx: q.x / (z * tx), ny: q.y / (z * ty), mx: Math.min(0.25, HOLD_R / (z * tx)), my: Math.min(0.25, HOLD_RV / (z * ty)), z, y: q.y } : null;
  }
  // 位置 s、距離 d 時鏡頭高度的範圍：畫面上緣（扣掉表的 top）、下緣（扣掉 bottom）那一排和左右邊緣（中間和上下各一半的地方）看出去都打得到看得到的牆（sees：模型射線）；沿牆的變化有坡度限制（每走 1 公尺最多變 1 公尺），鏡頭高度不會換格時一下被壓下去。
  // 邊界表是 Studio 用另一套鏡頭校正的，跟現在的路線（等距線、調角度）對不上，兩端特別明顯。沿牆每 V_STEP 一格算好存起來
  // wall：只看四邊都是牆（左右範圍用它）；不然再照標準之一放寬到看得到這裡畫面裡的岩點（見 needCell）
  // 距離的刻度：捏合中距離每一格都在變，照細的刻度每格都要重算整排（每格上萬次射線，手機上慢到跟不上手指）；捏合中用粗刻度，放手後回細的
  dQuant(d) { const q = this.coarse ? COARSE_D : 0.02; return Math.round(d / q) * q; }
  // 這個距離刻度的格子（沿牆每 V_STEP 一格，算過的記著）。同時留最近用過的幾個刻度：捏合來回、預先算（prefetch）都用得到
  vCells(d) {
    const key = [d.toFixed(2), this.W, this.H, this.yawKey(), this.pass, this.passFrom, this.passK, !!this.auto].join('|'), m = this.vrs || (this.vrs = new Map());
    let rows = m.get(key); if (rows) m.delete(key); else rows = { at: new Map(), w: new Map(), n: new Map() };
    m.set(key, rows); if (m.size > 8) m.delete(m.keys().next().value);
    const memo = (map, k, f) => { if (!map.has(k)) map.set(k, this.keepCam(f)); return map.get(k); };
    const raw = (k) => memo(rows.at, k, () => this.vCell(k * V_STEP, d));
    return { rows, raw, cell: (k) => memo(rows.w, k, () => this.wallCell(k, raw)), need: (k) => memo(rows.n, k, () => this.needCell(k, d)) };
  }
  // 捏合途中趁畫面之間的空檔，把相鄰距離刻度在目前位置附近的格子先算好（一次最多 ms 毫秒），換刻度時不用一次算整排、卡一下。回傳還有沒有沒算完的
  // idle：還沒捏合（手指沒在縮放）時也先算好目前距離的粗刻度和相鄰兩個，第一次捏合的第一格不用從零算整排。
  // 調角度途中角度跨進新的粗刻度（約 3°）也要從零算整排，所以相鄰的角度刻度（照轉的方向）一樣先算
  prefetch(ms = 3, idle = false) {
    if (this.person || !this.sees || !this.table || (!idle && !this.coarse)) return false;
    const was = this.coarse, yaw = this.yaw; this.coarse = true;
    try {
      const dir = Math.sign(this.d - (this.pfD ?? this.d)) || this.pfDir || 1, q = COARSE_D, base = this.dQuant(this.d); this.pfD = this.d; this.pfDir = dir;
      const yd = Math.sign(yaw - (this.pfY ?? yaw)) || this.pfYDir || 1, yb = Math.round(yaw / YAW_COARSE); this.pfY = yaw; this.pfYDir = yd;
      const t0 = performance.now(), k = Math.floor(this.s / V_STEP);
      const targets = [...(idle ? [[base, yaw]] : []), [base + dir * q, yaw], [base, (yb + yd) * YAW_COARSE], [base - dir * q, yaw], [base, (yb - yd) * YAW_COARSE]];
      return this.keepCam(() => {
        for (const [dT, yT] of targets) {
          if (dT < this.dMin || dT > this.dMax || Math.abs(yT) > YAW_MAX + 1e-6) continue;
          this.yaw = yT;   // 格子照這個角度算（刻度中心）
          const { rows, cell, need } = this.vCells(dT);
          for (let j = k - V_REACH; j <= k + 1 + V_REACH; j++) for (const [map, f] of [[rows.w, cell], [rows.n, need]]) if (!map.has(j)) { f(j); if (performance.now() - t0 > ms) return true; }
        }
        return false;
      });
    } finally { this.coarse = was; this.yaw = yaw; }
  }
  vRange(s, d, wall = false) { return this.keepCam(() => this.vRange0(s, d, wall)); }
  vRange0(s, d, wall = false) {
    const { raw, cell: wcell, need } = this.vCells(this.dQuant(d)), cell = wall ? raw : wcell;
    const k = Math.floor(s / V_STEP), a = cell(k), b = cell(k + 1);
    if (!a || !b) return null;
    // 坡度限制：附近的格子每離一公尺放寬 V_SLOPE 公尺（下包絡）。前面的範圍突然變低（或變高），鏡頭高度提早慢慢跟著變，不會換格時一下被壓下去
    let lo = Math.max(a[0], b[0]), hi = Math.min(a[1], b[1]);   // 兩格都要塞得滿（取交集：格子之間不內插，牆端那一格塞不滿時不會被另一格帶過去）
    const slack = (j) => { if (j === k || j === k + 1) return 0; const x = Math.max(0, Math.abs(s - j * V_STEP) - V_STEP) / (V_REACH * V_STEP); return x >= 1 ? Infinity : x * V_REACH * V_STEP * V_SLOPE / (1 - x); };   // x 0～1：到看的範圍邊緣是 1，放寬到無限大（格子進出範圍時不會突然收緊）
    for (let j = k - V_REACH; j <= k + 1 + V_REACH; j++) { const c = j === k || j === k + 1 ? null : cell(j), g = slack(j); if (c) { lo = Math.max(lo, c[0] - g); hi = Math.min(hi, c[1] + g); } }
    // 標準之一：放寬到附近畫面裡的岩點都能上下完整出現（一樣有坡度：岩點進出畫面時範圍慢慢變）
    if (!wall) for (let j = k - V_REACH; j <= k + 1 + V_REACH; j++) { const c = need(j), g = slack(j); if (c) { lo = Math.min(lo, c[0] + g); hi = Math.max(hi, c[1] - g); } }
    return [lo, hi];
  }
  // 四邊都是牆的範圍；這格沒有（牆端外面、牆比畫面矮的地方）就接著最近有的那格（一樣近先看往牆中間的）；塞不滿（下界比上界高）就只有中間那個高度
  wallCell(k, raw) {
    const p = this.p, dir = k * V_STEP < (p.smin + p.smax) / 2 ? 1 : -1;
    for (let i = 0; i < 400; i++) {
      const j = k + (i % 2 ? -1 : 1) * dir * Math.ceil(i / 2), c = raw(j);
      if (c) return c[0] <= c[1] ? c : [(c[0] + c[1]) / 2, (c[0] + c[1]) / 2];
    }
    return null;
  }
  // 鏡頭在這格（任一處）時畫面裡（左右）的正面岩點要上下完整出現，鏡頭高度至少要能到哪裡：最低的岩點停在可用畫面下緣、最高的停在上緣（[可以低到, 可以高到]；沒有岩點 null）
  needCell(k, d) {
    const F = this.front(); if (!F.length) return null;
    const t = this.table, [top, bottom] = this.wide || !t ? [0, 0] : [t.top, t.bottom], v = this.v;
    let lo = Infinity, hi = -Infinity;
    // 這格的兩端和中間（每 STEP）各看一次：轉角附近有些岩點只在很窄的位置進得了畫面
    for (let x = k * V_STEP; x <= (k + 1) * V_STEP + 1e-9; x += STEP) {
      this.v = 0; this.place(x, d); this.v = v;   // 高度 0、水平看：岩點在畫面上的高度 y 就是它的高度，鏡頭在 v 時是 y − v
      for (const P of F) {
        const g = this.inFrame(P); if (!g || Math.abs(g.nx) > 1 - g.mx) continue;
        const h = g.z * this.tan, m = g.my * h; lo = Math.min(lo, g.y + (1 - 2 * bottom) * h - m); hi = Math.max(hi, g.y - (1 - 2 * top) * h + m);
      }
    }
    return lo < Infinity ? [lo, hi] : null;
  }
  vCell(s, d) {
    const t = this.table, v = this.v, e = this.vEdges(s, d); this.v = 0; this.place(s, d); this.v = v;   // 鏡頭水平看：射線的方向跟高度無關，高度只把起點往上移
    const c = this.cam.position.clone(), up = this.p.up, o = new Vector3();
    // 射線照沿牆鏡頭的視角算（FOV、畫面比例），不讀相機當下的投影：進場動畫時裁切還在變，第一次算到的最遠距離（dFill）會錯
    const e3 = this.cam.matrixWorld.elements, X = new Vector3(e3[0], e3[1], e3[2]), Y = new Vector3(e3[4], e3[5], e3[6]), Z = new Vector3(e3[8], e3[9], e3[10]), ty = this.tan, tx = ty * this.W / this.H;
    const ray = (x, y) => Z.clone().negate().addScaledVector(X, x * tx).addScaledVector(Y, y * ty).normalize();
    const row = (y) => [-1, -0.5, 0, 0.5, 1].map(x => ray(x, y));
    const [top, bottom] = this.wide ? [0, 0] : [t.top, t.bottom];   // 橫的畫面（電腦）工具列是浮著的小膠囊：上下也都要是牆，不露出牆外
    const mid = [-1, 1].flatMap(x => [-0.5, 0, 0.5].map(y => ray(x, y))), lo = [...row(-1 + 2 * bottom), ...mid], hi = [...row(1 - 2 * top), ...mid], ok = (R, h) => R.every(r => this.sees(o.copy(c).addScaledVector(up, h), r));
    // 從看得到的高度 g 往 dir 每次 25 公分走到看不到，再二分找交界
    const edge = (R, g, dir) => { let b = g; for (let k = 0; k < 24 && ok(R, b); k++) { g = b; b += dir * 0.25; } if (ok(R, b)) return b; for (let k = 0; k < 5; k++) { const m = (g + b) / 2; if (ok(R, m)) g = m; else b = m; } return g; };
    // 每一排看得到的高度是一段（牆的左右緣是斜的：上排太低、下排太高也會打出牆外），兩段取交集
    const span = (R) => { const m = e ? (e[0] + e[1]) / 2 : this.v0; for (let k = 0; k <= 16; k++) { const h = m + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.25; if (ok(R, h)) return [edge(R, h, -1), edge(R, h, 1)]; } return null; };
    const a = span(lo), b = a && span(hi); return b ? [Math.max(a[0], b[0]) + 0.03, Math.min(a[1], b[1]) - 0.03] : null;   // 牆的邊緣不整齊：留 3 公分
  }
  world(xy, h) { const p = this.p; return new Vector3().addScaledVector(p.right, xy[0]).addScaledVector(p.f, xy[1]).addScaledVector(p.up, h); }
  // 畫面中央在一般的牆面上的那一點（世界座標）
  anchor() {
    if (!this.table) { const p = this.p, { x, y, nx, ny } = this.frame(), t = this.depth(this.s, this.v, this.Tm); return new Vector3().addScaledVector(p.right, x + nx * t).addScaledVector(p.f, y + ny * t).addScaledVector(p.up, this.v); }
    return this.world(this.pose(this.s).look, this.v);
  }
  // 沿線位置 s 附近（高斯，寬度隨距離變寬）平均的位置和法線。朝向平滑得比位置寬（轉角處鏡頭慢慢轉，畫面各處移動的量比較一致、跟手）；
  // 位置只稍微平滑（凸出的轉角不會被平均到牆後面）
  frame() {
    const p = this.p, c = this.s / STEP, avg = (sg, f) => {
      const r = Math.ceil(3 * sg / STEP); let a0 = 0, a1 = 0, w = 0;
      for (let i = Math.max(0, Math.floor(c) - r); i <= Math.min(p.n - 1, Math.ceil(c) + r); i++) { const g = Math.exp(-(((i - c) * STEP) ** 2) / (2 * sg * sg)), [u, v] = f(i); a0 += u * g; a1 += v * g; w += g; }
      return [a0 / w, a1 / w];
    };
    const [x, y] = avg(0.3 + 0.35 * this.d, (i) => [p.X[i], p.Y[i]]);
    const [tx, ty] = avg(0.8 + 0.35 * this.d, (i) => { const a = Math.max(0, i - 1), b = Math.min(p.n - 1, i + 1); return [p.X[b] - p.X[a], p.Y[b] - p.Y[a]]; });
    const tl = Math.hypot(tx, ty) || 1;
    return { x, y, nx: p.flip * -ty / tl, ny: p.flip * tx / tl };
  }
  // 把鏡頭擺好：水平看著牆上 (s, v) 那一點；有邊界表（Studio 烘焙的）時鏡頭在等距線上（pose），沒有時照平滑的軌道、離牆面 d
  apply() { this.place(this.s, this.d); }
  place(sAt, dAt) {
    let C, T;
    if (this.table) { const { cam, look } = this.pose(sAt, dAt); C = this.world(this.orbit(cam, look, dAt, this.yawAt(sAt)), this.person ? this.eye : this.v); T = this.world(look, this.v); }   // 人的模式：鏡頭在眼睛高度，看 v 那裡（抬頭、低頭）
    else {
      const s0 = this.s, d0 = this.d; this.s = sAt; this.d = dAt;
      const p = this.p, { x, y, nx, ny } = this.frame(), t = this.depth(this.s, this.v);
      T = this.world([x + nx * t, y + ny * t], this.v); C = this.world([x + nx * (t + this.d), y + ny * (t + this.d)], this.v);
      this.s = s0; this.d = d0;
    }
    this.cam.up.copy(this.p.up); this.cam.position.copy(C);
    this.cam.near = Math.max(0.02, dAt * 0.05); this.cam.far = dAt + 50; this.cam.updateProjectionMatrix();
    this.cam.lookAt(T); this.cam.updateMatrixWorld();
  }
}

// ---- 進定線飛進去停的位置 ----
// 最遠、最接近牆中央（岩點貓 stage.flyIn 從卡片的樣子飛到這裡）
// tables：每種畫面比例的邊界表，停的位置在每一張都要塞得滿（手機打開時照它自己的表夾，才不會一接手就被拉近）；高度取可以的範圍中間
export function introEnd(wc, tables) {
  const t = wc.table, mid = (t.sa.at(-1) + t.sb.at(-1)) / 2; let best = 0;
  wc.reach.forEach((f, i) => { const s = t.s0 + i * t.step, b = t.s0 + best * t.step; if (f > wc.reach[best] + 1e-6 || (Math.abs(f - wc.reach[best]) < 1e-6 && Math.abs(s - mid) < Math.abs(b - mid))) best = i; });
  const s = t.s0 + best * t.step, [W, H] = [wc.W, wc.H];
  const fit = (x, f) => { wc.useTable(x); wc.W = x.aspect * H; wc.H = H; wc.s = s; return f(); };
  const d = Math.min(...tables.map(x => fit(x, () => wc.farAt(s))));
  let lo = -Infinity, hi = Infinity;
  for (const x of tables) fit(x, () => { const e = wc.vEdges(s, d), hh = d * wc.tan; if (e) { lo = Math.max(lo, e[0] + hh); hi = Math.min(hi, e[1] - hh); } });
  wc.useTable(t); wc.W = W; wc.H = H; wc.s = s; wc.d = d; wc.v = lo <= hi ? (lo + hi) / 2 : wc.v; wc.clamp();
  return { s: wc.s, v: wc.v, d: wc.d };
}

// ---- 成品包 ----
// 沿牆鏡頭要的東西都在 Studio 烘焙好（packWalk），岩點貓讀回（unpackWalk）就能用，不用從模型算軌道、不用實拍校正。
// tables：幾種畫面比例（直的手機：Safari、加到主畫面）各一張實拍的邊界表，岩點貓挑比例最接近的
const round = (a, k) => Array.from(a, x => +x.toFixed(k));
export function packWalk(wc, tables, intro = null) {
  const p = wc.p;
  return { v: 1, ...(intro ? { intro: { s: +intro.s.toFixed(4), v: +intro.v.toFixed(4), d: +intro.d.toFixed(4) } } : {}), right: round(p.right.toArray(), 6), f: round(p.f.toArray(), 6), up: round(p.up.toArray(), 6), flip: p.flip, X: round(p.X, 4), Y: round(p.Y, 4), bin: p.bin,
    smin: p.smin, smax: p.smax, k0: wc.k0, j0: wc.j0, M: wc.M, hTyp: +wc.hTyp.toFixed(4),
    lo: round(wc.lo, 4), loT: round(wc.loT, 4), hi: round(wc.hi, 4), hiT: round(wc.hiT, 4), T: round(wc.T, 3), Tm: round(wc.Tm, 3),
    tables: tables.map(t => JSON.parse(JSON.stringify(t, (k, v) => typeof v === 'number' ? +v.toFixed(4) : v))) };
}
export function unpackWalk(d) {
  return { right: new Vector3(...d.right), f: new Vector3(...d.f), up: new Vector3(...d.up), flip: d.flip, X: Float32Array.from(d.X), Y: Float32Array.from(d.Y), n: d.X.length,
    bin: d.bin, smin: d.smin, smax: d.smax, baked: d };
}
// 挑畫面比例最接近的那張邊界表
export function tableFor(d, aspect) { return d.tables.reduce((b, t) => Math.abs(t.aspect - aspect) < Math.abs(b.aspect - aspect) ? t : b); }

