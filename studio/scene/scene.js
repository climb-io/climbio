// 3D 場景（/studio/scene/）：岩場的 3D 模型加上每張照片的相機視錐（細白線），點一個視錐就飛到那張照片拍的位置、方向，照片淡入；
// 下方是照片膠卷（照拍的地方接著排，cameras.js 的 stripOrder）。模型用 Crag3DKit 打包的 three.js＋Spark（只讀 crag3dkit/vendor，不改那個 Kit），視錐畫在上面一層 2D canvas（1px 細線、好點選）。
// 資料（網址的 #）：crag=<專案 id> 是 Crag 專案（模型畫面＋照片畫面的 props.model 鏡頭，照片和模型從專案資料夾讀）；
// src=dapao（預設）是開放資料集 climbio/crag3d-lab 的大砲岩（3D 重建流程的照片位置 frames.json 與模型）。換算在 cameras.js。
import { Scene, PerspectiveCamera, WebGLRenderer, Vector3, SRGBColorSpace, SparkRenderer, SplatMesh, GLTFLoader, MeshBasicMaterial, DoubleSide } from '../../crag3dkit/vendor/three-splat.js';
import { camerasFrom, cameraFromView, frustum, viewOf, overview, upright, turn, stripOrder, subjectDistance, rayHit } from './cameras.js';

const T = (...a) => globalThis.AppKit.i18n.t(...a);
globalThis.AppKit.i18n.apply();   // index.html 的 data-i18n
const UI = globalThis.AppKit.ui;
const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

const HF = 'https://huggingface.co/datasets/climbio/crag3d-lab/resolve/main';
// 開放資料集的兩個：岩館（原岩明德的 3D 牆，網格模型＋COLMAP 的照片位置，已換到成品牆的座標）、天然岩場（大砲岩，高斯潑濺）
const WALL3D = 'https://huggingface.co/datasets/climbio/wall3d-lab/resolve/main', WALLS3D = 'https://huggingface.co/datasets/climbio/walls3d/resolve/main';
const SOURCES = {
  mingde: { name: 'scMingde', kind: 'gym', frames: `${WALL3D}/pipeline/frames-product.json`, images: `${WALL3D}/pipeline/images/`, model: `${WALLS3D}/walls3d/d1c27twdlbyor9cs/wall-d8f5d6e67515.glb`, wall: `${WALLS3D}/walls3d/d1c27twdlbyor9cs/wall.json`, mime: 'model/gltf-binary' },
  dapao: { name: 'scDapao', kind: 'crag', frames: `${HF}/experiments/worldlabs/atlas64/frames.json`, images: `${HF}/experiments/worldlabs/atlas64/img/`, model: `${HF}/models/ours/crop-show.spz`, mime: 'model/x-spz' },
};

/** 開放資料集的一組照片位置：{ title, up（模型座標的上方；室內牆讀 wall.json）, cams（每台加 src：照片網址）, model(onProgress)：模型的位元組 } */
async function fromDataset(key) {
  const src = SOURCES[key] || SOURCES.dapao;
  const doc = await (await fetch(src.frames)).json();
  const up = src.wall ? (await (await fetch(src.wall)).json()).up : null;
  return { key: SOURCES[key] ? key : 'dapao', title: T(src.name), up, mime: src.mime, cams: camerasFrom(doc).map(c => ({ ...c, src: `${src.images}${c.file || `${c.name}.jpg`}` })), model: (onProgress) => fetchBytes(src.model, onProgress) };
}

/** Crag 專案（studio/crag/store.js）：模型畫面，和記著這個模型鏡頭的照片；資料夾專案要先在 Studio 首頁打開過（瀏覽器的授權） */
async function fromCrag(id) {
  const S = await import('../crag/store.js');
  if (!(await S.open(id))) throw new Error(T('scNeedOpen'));
  const { book, photos, extras } = await S.loadBook();
  const model = [...extras.values()].find(d => d.surface === 'model');
  if (!model) throw new Error(T('scNoModel'));
  const cams = [];
  for (const v of photos.values()) {
    const c = cameraFromView(v, model.id), blob = c && await S.getImage(v);
    if (blob) cams.push({ ...c, src: URL.createObjectURL(blob) });
  }
  const name = typeof book.name === 'string' ? book.name : (book.name?.['zh-Hant'] ?? Object.values(book.name || {})[0] ?? '');
  return { title: name, cams, mime: model.mime, model: async () => { const b = await S.getImage(model); if (!b) throw new Error(T('scNoModel')); return b.arrayBuffer(); } };
}
let frustumM = 1.6;   // 視錐畫多深（公尺）：照相機散開的範圍算（大砲岩幾十公尺、室內牆幾公尺），載入時設
let subjectM = 3;     // 照片離拍的東西大約多遠（subjectDistance），載入時設；網格模型改用射線量每一張（lookDistance）
let tris = null;      // 網格模型的三角面（世界座標），量照片看的那一點用；高斯潑濺沒有
const FLY_MS = 900;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- 畫面 ----
const host = $('#stage'), overlay = $('#lines'), ctx = overlay.getContext('2d');
const renderer = new WebGLRenderer({ antialias: false, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputColorSpace = SRGBColorSpace;
host.prepend(renderer.domElement);
const scene = new Scene();
const spark = new SparkRenderer({ renderer, enableLod: false });
scene.add(spark);
const cam = new PerspectiveCamera(50, 1, 0.05, 2000);

let cams = [], hover = -1, sel = -1, viewing = false, splat = null, dead = false, raf = 0;
// 軌道鏡頭：看著 target，從 yaw、pitch 的方向、dist 公尺外
const orbit = { target: new Vector3(), yaw: 0, pitch: 0.3, dist: 30, fov: 50 };
let fly = null;

function place() {
  const { target: t, yaw, pitch, dist } = orbit;
  cam.position.set(t.x + dist * Math.cos(pitch) * Math.sin(yaw), t.y + dist * Math.sin(pitch), t.z + dist * Math.cos(pitch) * Math.cos(yaw));
  cam.fov = orbit.fov;
  cam.up.set(0, 1, 0);
  cam.lookAt(t);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
}
/**
 * 照片看的那一點有多遠：網格模型用射線量，打不到或高斯潑濺用整體的估計。
 * 進照片後軌道繞這一點轉，拖一下就是繞著照片拍的那塊岩壁看（以前固定 10 公尺，室內牆會繞到牆後很遠的點、一轉就飛走）
 */
function lookDistance(c) {
  const t = tris ? rayHit(tris, c.position, c.forward) : Infinity;
  return t < subjectM * 20 ? t : subjectM;
}
/**
 * 整區鏡頭：overview 是照橫的畫面算的；直的畫面（手機）兩邊會切掉，照畫面比例往後拉一些（寬／高 1.4 以下才拉，拉的倍數取平方根：手機約 1.5 倍）
 */
function home() {
  const o = overview(cams), k = Math.sqrt(Math.max(1, 1.4 / Math.max(0.3, host.clientWidth / Math.max(1, host.clientHeight))));
  return { ...o, position: o.target.map((t, i) => t + (o.position[i] - t) * k) };
}
/** 縮放最近到繞的那一點多遠：照片拍的距離的 5% */
const minDist = () => subjectM * 0.05;
/** 鏡頭 { position, target, fov } → 軌道參數 */
function poseToOrbit({ position: p, target: t, fov }) {
  const d = [p[0] - t[0], p[1] - t[1], p[2] - t[2]], dist = Math.hypot(...d) || 1e-6;
  return { target: new Vector3(...t), dist, yaw: Math.atan2(d[0], d[2]), pitch: Math.asin(Math.max(-1, Math.min(1, d[1] / dist))), fov };
}
function setOrbit(o) { orbit.target.copy(o.target); orbit.yaw = o.yaw; orbit.pitch = o.pitch; orbit.dist = o.dist; orbit.fov = o.fov; }

/** 飛到某個鏡頭：軌道參數插值（yaw 走短的一邊），減少動態效果時直接跳過去 */
function flyTo(pose, then) {
  const to = poseToOrbit(pose), from = { target: orbit.target.clone(), yaw: orbit.yaw, pitch: orbit.pitch, dist: orbit.dist, fov: orbit.fov };
  let dy = to.yaw - from.yaw; dy -= Math.round(dy / (2 * Math.PI)) * 2 * Math.PI;
  if (reduced) { setOrbit(to); then?.(); return; }
  const t0 = performance.now(), ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
  fly = (now) => {
    const k = Math.min(1, (now - t0) / FLY_MS), e = ease(k);
    orbit.target.lerpVectors(from.target, to.target, e);
    orbit.yaw = from.yaw + dy * e; orbit.pitch = from.pitch + (to.pitch - from.pitch) * e;
    orbit.dist = from.dist + (to.dist - from.dist) * e; orbit.fov = from.fov + (to.fov - from.fov) * e;
    if (k >= 1) { fly = null; then?.(); }
  };
}

// ---- 視錐（2D 疊層） ----
const v3 = new Vector3();
/** 模型座標 → 疊層上的像素；在鏡頭後面回 null */
function screen(p) {
  v3.set(p[0], p[1], p[2]).project(cam);
  if (v3.z > 1 || v3.z < -1) return null;
  return [(v3.x + 1) / 2 * overlay.clientWidth, (1 - v3.y) / 2 * overlay.clientHeight];
}
let shapes = [];   // 每個視錐在畫面上的位置（點選用）
function drawLines() {
  const w = overlay.clientWidth, h = overlay.clientHeight, r = Math.min(devicePixelRatio || 1, 2);
  const bw = Math.round(w * r), bh = Math.round(h * r);
  if (overlay.width !== bw || overlay.height !== bh) { overlay.width = bw; overlay.height = bh; }
  ctx.setTransform(r, 0, 0, r, 0, 0);
  ctx.clearRect(0, 0, w, h);
  shapes = [];
  if (viewing) return;
  const css = getComputedStyle(document.documentElement);
  const line = css.getPropertyValue('--text').trim(), on = css.getPropertyValue('--accent').trim();
  cams.forEach((c, i) => {
    const f = frustum(c, frustumM), a = screen(f.apex), q = f.corners.map(screen);
    if (!a || q.some(x => !x)) return;
    shapes[i] = { a, q };
    const hot = i === sel || i === hover;
    const path = () => {
      ctx.beginPath();
      for (const p of q) { ctx.moveTo(a[0], a[1]); ctx.lineTo(p[0], p[1]); }
      ctx.moveTo(q[3][0], q[3][1]);
      for (const p of q) ctx.lineTo(p[0], p[1]);
    };
    // 模型有亮有暗（岩壁、天空）：細線底下先描一圈深色的暈，哪裡都看得到
    ctx.globalAlpha = hot ? 0.7 : 0.45;
    path(); ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.stroke();
    ctx.globalAlpha = hot ? 1 : 0.75;
    path(); ctx.strokeStyle = hot ? on : line; ctx.lineWidth = hot ? 1.5 : 1; ctx.stroke();
  });
  ctx.globalAlpha = 1;
}
/** 點到哪一個視錐：畫面四角圍起來的範圍裡、離中心最近的；都沒有就找頂點 14px 內的 */
function pick(x, y) {
  const inside = (q) => { let s = 0; for (let i = 0; i < 4; i++) { const [a, b] = [q[i], q[(i + 1) % 4]]; s += Math.sign((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])); } return Math.abs(s) === 4; };
  let best = -1, bd = Infinity;
  shapes.forEach((s, i) => {
    if (!s) return;
    const cx = s.q.reduce((t, p) => t + p[0], 0) / 4, cy = s.q.reduce((t, p) => t + p[1], 0) / 4, d = Math.hypot(cx - x, cy - y);
    if (inside(s.q) && d < bd) { bd = d; best = i; }
  });
  if (best >= 0) return best;
  shapes.forEach((s, i) => { if (s) { const d = Math.hypot(s.a[0] - x, s.a[1] - y); if (d < 14 && d < bd) { bd = d; best = i; } } });
  return best;
}

// ---- 一張照片 ----
function open(i) {
  sel = i; viewing = false;
  $('#photo').classList.remove('on');
  markStrip();
  flyTo(viewOf(cams[i], lookDistance(cams[i])), () => {
    viewing = true;
    const img = $('#photoImg');
    img.src = cams[i].src;
    $('#photoName').textContent = cams[i].name;
    $('#photoFov').textContent = `FOV ${Math.round(cams[i].fov)}°`;
    $('#viewing').hidden = false;
    fitPhoto();
    $('#photo').classList.add('on');
  });
}
function close() {
  if (!viewing) return;
  viewing = false;
  $('#photo').classList.remove('on');
  $('#viewing').hidden = true;
  // 鏡頭留在原地：拖曳、縮放從照片的畫面接著動，不跳開（以前往後拉 6 公尺，室內牆一下就變很小）
}
/** 照片照相機的比例放在畫面中間（跟 3D 的視角對齊：高度填滿） */
function fitPhoto() {
  const c = cams[sel], H = host.clientHeight, W = H * c.aspect;
  Object.assign($('#photoImg').style, { width: `${W}px`, height: `${H}px` });
}

// ---- 膠卷 ----
function buildStrip() {
  $('#strip').replaceChildren(...cams.map((c, i) => el('button', { type: 'button', className: 'sc-frame', onclick: () => open(i), ariaLabel: c.name },
    el('img', { src: c.src, alt: '', loading: 'lazy', decoding: 'async' }))));
}
function markStrip() {
  [...$('#strip').children].forEach((b, i) => b.classList.toggle('on', i === sel));
  $('#strip').children[sel]?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduced ? 'auto' : 'smooth' });
  $('#count').textContent = sel >= 0 ? T('scOf', sel + 1, cams.length) : T('scPhotos', cams.length);
}

// ---- 手勢：拖曳轉、滾輪或兩指縮放、右鍵或兩指平移；點一下選視錐 ----
const TURN = 0.0025;   // 拖曳轉動：每像素 0.0025 弧度（拖 200 px 約轉 29°；以前 0.005 太快，近看岩壁一拖就轉過頭）
const pts = new Map();
let down = null, moved = false, pinch = 0;
host.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.sc-pill')) return;   // 浮在畫面上的膠囊（整區、品牌）自己處理點擊，不能被畫面接走
  try { host.setPointerCapture(e.pointerId); } catch { /* 指標已經放開（例如觸控取消）：照樣當一般的按下 */ }
  pts.set(e.pointerId, [e.clientX, e.clientY]);
  down = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey, slop: e.pointerType === 'touch' ? 10 : 6 };   // 手指點一下會晃，晃不到 slop 像素算點選
  moved = false; fly = null;
  if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); }
});
host.addEventListener('pointermove', (e) => {
  if (!pts.has(e.pointerId)) {   // 滑鼠停在視錐上：亮起來
    const r = host.getBoundingClientRect(), i = pick(e.clientX - r.left, e.clientY - r.top);
    if (i !== hover) { hover = i; host.style.cursor = i >= 0 ? 'pointer' : 'grab'; }
    return;
  }
  const last = pts.get(e.pointerId), dx = e.clientX - last[0], dy = e.clientY - last[1];
  pts.set(e.pointerId, [e.clientX, e.clientY]);
  if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > down.slop) moved = true;
  if (!moved) return;
  if (viewing) close();
  if (pts.size === 2) {
    const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (pinch) orbit.dist = Math.max(minDist(), orbit.dist * (pinch / d));
    pinch = d;
    pan(dx / 2, dy / 2);
  } else if (down.pan) pan(dx, dy);
  else { orbit.yaw -= dx * TURN; orbit.pitch = Math.max(-1.2, Math.min(1.45, orbit.pitch + dy * TURN)); }
});
const up = (e) => {
  pts.delete(e.pointerId);
  if (pts.size < 2) pinch = 0;
  if (!moved && down && e.type === 'pointerup' && pts.size === 0) {
    const r = host.getBoundingClientRect(), i = pick(e.clientX - r.left, e.clientY - r.top);
    if (i >= 0) open(i); else if (viewing) close();
  }
  if (!pts.size) down = null;
};
host.addEventListener('pointerup', up);
host.addEventListener('pointercancel', up);
host.addEventListener('contextmenu', (e) => e.preventDefault());
host.addEventListener('wheel', (e) => { e.preventDefault(); fly = null; if (viewing) close(); orbit.dist = Math.max(minDist(), orbit.dist * Math.exp(e.deltaY * 0.001)); }, { passive: false });
function pan(dx, dy) {
  const k = orbit.dist * Math.tan((orbit.fov * Math.PI) / 360) * 2 / host.clientHeight;
  const right = new Vector3().setFromMatrixColumn(cam.matrixWorld, 0), upv = new Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
  orbit.target.addScaledVector(right, -dx * k).addScaledVector(upv, dy * k);
}
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, dialog')) return;
  if (e.key === 'Escape') close();
  else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && cams.length) { e.preventDefault(); open(((sel < 0 ? 0 : sel + (e.key === 'ArrowRight' ? 1 : -1)) + cams.length) % cams.length); }
});
$('#home').onclick = () => { close(); sel = -1; markStrip(); flyTo(home()); };

// ---- 每一格 ----
function resize() {
  const w = host.clientWidth, h = host.clientHeight;
  renderer.setSize(w, h, false);
  cam.aspect = w / h;
  if (viewing) fitPhoto();
}
new ResizeObserver(resize).observe(host);
function frame(now) {
  if (dead) return;
  if (fly) fly(now);
  place();
  renderer.render(scene, cam);
  drawLines();
  raf = requestAnimationFrame(frame);
}

// ---- 載入 ----
/** 模型放進場景：高斯潑濺（.spz），或網格（.glb：照片貼圖、不打光，跟 Crag3DKit 一樣）；rot 是跟相機一起轉正的轉動 */
async function addModel(bytes, mime, rot) {
  let obj;
  if (mime === 'model/gltf-binary') {
    obj = (await new GLTFLoader().parseAsync(bytes, '')).scene;
    obj.traverse((o) => { if (o.isMesh) { const old = o.material; o.material = new MeshBasicMaterial({ map: old.map, side: DoubleSide }); old.dispose(); } });
  } else obj = new SplatMesh({ fileBytes: bytes });
  if (rot) obj.quaternion.set(...rot);
  if (mime === 'model/gltf-binary') tris = trianglesOf(obj);   // 節點轉動和轉正的 rot 都在 matrixWorld 裡
  splat = obj;   // 離開頁面時釋放
  scene.add(obj);
  await obj.initialized;
}

/** 網格模型的三角面 → 世界座標（matrixWorld 已含模型自己的節點轉動與轉正）；沒有面回 null */
function trianglesOf(obj) {
  const out = [];
  obj.updateMatrixWorld(true);
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position, idx = o.geometry.index, e = o.matrixWorld.elements, n = idx ? idx.count : pos.count;
    for (let k = 0; k < n; k++) {
      const i = idx ? idx.getX(k) : k, x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      out.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
    }
  });
  return out.length ? new Float32Array(out) : null;
}

/** 開放資料集的岩館、天然岩場切換：上方的膠囊，換了就重新載入 */
function pickSource(key) {
  const box = $('#sources');
  box.hidden = false;
  for (const b of box.querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b.dataset.src === key));
    b.onclick = () => { if (b.dataset.src !== key) { location.hash = `src=${b.dataset.src}`; location.reload(); } };
  }
}

/** 讀模型，邊讀邊更新過場的進度 */
async function fetchBytes(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = +res.headers.get('content-length') || 0, reader = res.body.getReader(), parts = [];
  let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; onProgress(got, total); }
  const out = new Uint8Array(got);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out.buffer;
}

async function start() {
  const q = new URLSearchParams(location.hash.slice(1));
  const busy = globalThis.StudioShell.busy(T('scLoading'), { leave: true });   // 只是載入模型：等不及可以直接換到別頁
  try {
    const src = q.get('crag') ? await fromCrag(q.get('crag')) : await fromDataset(q.get('src'));
    $('#title').textContent = src.title;
    if (q.get('crag')) $('#bar .st-brand').href = `../crag/#${q.get('crag')}`;   // 品牌鈕回到這本的 Crag
    if (!src.cams.length) throw new Error(T('scNoCameras'));
    const rot = upright(src.up);
    cams = stripOrder(rot ? src.cams.map(c => turn(c, rot)) : src.cams);   // 膠卷照拍的位置排（沿著岩壁）
    const xs = (i) => cams.map(c => c.position[i]), span = Math.hypot(...[0, 1, 2].map(i => Math.max(...xs(i)) - Math.min(...xs(i))));
    frustumM = Math.min(1.6, Math.max(0.12, span * 0.04));
    subjectM = subjectDistance(cams);
    setOrbit(poseToOrbit(home()));
    buildStrip(); markStrip();
    resize();
    raf = requestAnimationFrame(frame);
    const MB = 1048576;
    const bytes = await src.model((got, total) => busy.step(T('scModelMb'), Math.round(got / MB), Math.round(total / MB)));
    if (dead) return;
    await addModel(bytes, src.mime, rot);
    if (src.key) pickSource(src.key);
  } catch (e) {
    UI.toast(T('scFailed', e.message), { ms: 6000 });
  } finally { busy.close(); }
}
addEventListener('pagehide', () => {
  dead = true;
  cancelAnimationFrame(raf);
  for (const c of cams) if (c.src?.startsWith('blob:')) URL.revokeObjectURL(c.src);
  splat?.dispose?.(); scene.remove(spark); spark.dispose();
  renderer.dispose(); renderer.forceContextLoss();
});
start();
