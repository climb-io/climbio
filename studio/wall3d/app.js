// Climbio Studio 的 3D 牆：打開 3D 牆的資料包資料夾（3D 重建流程的輸出），精修後按「發佈」烘焙成成品包、放進開放資料集 climbio/walls3d，
// 畫面、操作照岩點貓的定線：深色、正面滿版、浮在畫面上的圓鈕；拖曳平移、滾輪往游標那點縮放、右鍵拖小角度轉（離正面 45° 內）。
// 不分模式：點一下去掉或放回那一塊（點在岩點上是那顆岩點標成不是岩點／還原，點在牆上是那一面牆隱藏／打開，點在切掉的地方是拿掉那條切線）；
// 去掉的淡淡顯示（才點得回來）。長按岩點修外框、長按牆面補一顆（跟岩點貓的修點一樣：記當時的鏡頭＋畫面上的多邊形，
// 存在 wall.json 的 edits，岩點貓載入時套上，見 wall3dkit/stage.js 的 setEdits）。「切直線」畫一條直線切掉一側（加一個裁切平面，畫完回到點選）；每一步都能復原（⌘Z），⌘S 存檔。懸空物在重建流程自動隱藏。存檔只改 wall.json 的 surfaces（hidden、frame.planes）與 holds[].off；模型、貼圖、岩點標籤不動。
// 岩點在不在的規則跟岩點貓同一份（wall3dkit/stage.js）
import { Scene, PerspectiveCamera, WebGLRenderer, MeshBasicMaterial, BufferGeometry, BufferAttribute, Raycaster, Vector2, Vector3, Box3, Color, DoubleSide, SRGBColorSpace, DataTexture, NearestFilter, UnsignedByteType, MeshBVH, acceleratedRaycast } from '../../wall3dkit/vendor/three.js';
import { createPublishUI } from '../publish-ui.js';
import { publishAnonymous, publishText } from '../publisher.js';
import { openDb } from '../published.js';
import { packSurfaces, goneHolds, parseModel, u16, frameShader, FRAME_MAX, hull, simplify, inside } from '../../wall3dkit/stage.js';

const $ = (id) => document.getElementById(id);
const T = AppKit.i18n.t;
AppKit.i18n.apply();
for (const b of document.querySelectorAll('[data-ak-copy]')) b.dataset.akCopy = T('w3LdCopied');   // appkit/landing.js 複製後的提示
// 去掉的（隱藏的面、切掉的、不是岩點的）壓暗；游標指到的鋪螢光綠（--accent）
const TINT = { hidden: [0.05, 0.05, 0.06, 0.72], off: [0.05, 0.05, 0.06, 0.72], hot: [0.83, 1, 0.23, 0.45] };
{ const m = /^#([0-9a-f]{6})$/i.exec(getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()); if (m) TINT.hot = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255).concat(0.45); }

const [, want = '', wantPid = want] = /^#([0-9a-z]{16})(?:\/([0-9a-z]{16}))?$/.exec(location.hash) || [];   // Wall 的「我的岩點貓牆面」選了這面 3D 牆：#<工作檔的牆 id>/<發佈的版本 id>
let S = null;   // 打開的牆：{ dir, doc, faceLabels, faceSurfaces, ... }
let mode = 'pick', hot = null, dirty = false;
let stage = 'holds', sel = null;   // 階段：model（切割模型：切直線、隱藏牆面）、holds（岩點精修）；sel：選到的岩點（index，補的點接在 holds 後面）
const redos = [];
const undos = [];   // 每一步之前的樣子（隱藏、不是岩點、裁切平面）

// 精修過的牆記住資料夾（每面牆一個，存在瀏覽器的 IndexedDB）：從 Wall 的「我的岩點貓牆面」選了這面牆，只要這台選過它的資料夾，按一下就進編輯
const handles = {
  db: openDb,
  async get(id) { try { const db = await this.db(); return await new Promise(res => { const q = db.transaction('dirs').objectStore('dirs').get(id); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch (e) { return null; } },
  async put(id, h) { try { if (typeof FileSystemDirectoryHandle === 'undefined' || !(h instanceof FileSystemDirectoryHandle)) return; const db = await this.db(); db.transaction('dirs', 'readwrite').objectStore('dirs').put(h, id); } catch (e) { console.warn(e); } },
};
const gateError = (e) => {
  console.error(e); $('gateErr').textContent = e.message === 'not a pack' ? T('w3NotWall') : e.message === 'wrong wall' ? T('w3WrongWall') : e.message; $('gateErr').hidden = false;
};
// 這台發佈過的版本（每面牆：{ last: 最新發佈的 id, list: [{ id, name, gym, t }] }）：沒有擁有者，所以「我的牆」和下一版的 origin 都靠這份本機記錄
const published = {
  async get(wallId) { const none = { last: '', list: [] }; try { const db = await handles.db(); return await new Promise(res => { const q = db.transaction('published').objectStore('published').get(wallId); q.onsuccess = () => res(q.result || none); q.onerror = () => res(none); }); } catch (e) { return none; } },
  async add(wallId, v) { try { const db = await handles.db(), cur = await this.get(wallId); db.transaction('published', 'readwrite').objectStore('published').put({ last: v.id, list: [...cur.list, v] }, wallId); } catch (e) { console.warn(e); } },
};
const newId = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => '0123456789abcdefghijklmnopqrstuvwxyz'[b % 36]).join('');
let remembered = null;   // 這面牆上次選的資料夾
$('open').onclick = async () => {
  try {
    if (remembered) {
      // 點擊裡才能要權限；沒給或資料夾不見了就退回選資料夾
      if (await remembered.requestPermission({ mode: 'readwrite' }) === 'granted') {
        try { await open(remembered); return; } catch (e) { if (e.message !== 'not a pack' && e.name !== 'NotFoundError') throw e; }
      }
      remembered = null; $('open').textContent = T('w3OpenFolder');
    }
    await open(await showDirectoryPicker({ mode: 'readwrite', id: 'climbio-wall3d' }));
  } catch (e) {
    if (e.name === 'AbortError') return;
    gateError(e);
  }
};
// 從已發佈的版本接著精修：下載基底（原模型、原始岩點與分面）加那一版的 patch，在選的空資料夾重建工作檔。要有 patch（這個機制之後發佈的版本才有）
const RESTORE_BASE = /^http:\/\/(127\.0\.0\.1|localhost)/.test(location.origin) ? 'https://climbio.app' : location.origin;
async function restore(pid, given) {
  const dir = given || await showDirectoryPicker({ mode: 'readwrite', id: 'climbio-wall3d' });
  const b = StudioShell.busy(T('w3Restoring'));
  try {
    const get = async (name, json) => { const r = await fetch(`${RESTORE_BASE}/p/${pid}/${name}`); if (!r.ok) throw Object.assign(new Error(r.status === 404 ? 'no patch' : `HTTP ${r.status}`), { status: r.status }); return json ? r.json() : new Uint8Array(await r.arrayBuffer()); };
    const patch = await get('patch.json', true), baseBytes = await get('base-wall.json'), doc = JSON.parse(new TextDecoder().decode(baseBytes));
    const files = [['base-wall.json', baseBytes], [doc.model, await get(`base-${doc.model}`)], [doc.faces, await get(`base-${doc.faces}`)]];
    // 工作檔 = 基底加最終決定：隱藏的面、裁切平面、不是岩點、修點（都是完整的最終狀態，不是差異）
    const hidden = new Set(patch.hidden), off = new Set(patch.off);
    doc.surfaces.list.forEach((x, i) => { if (hidden.has(i)) x.hidden = true; else delete x.hidden; });
    doc.surfaces.frame.planes = patch.planes;
    doc.holds.forEach(h => { if (off.has(h.id)) h.off = 1; else delete h.off; });
    if (patch.edits?.length) doc.edits = patch.edits; else delete doc.edits;
    if (patch.gym) doc.gym = patch.gym;
    files.push(['wall.json', new TextEncoder().encode(JSON.stringify(doc))]);
    for (const [name, data] of files) { const w = await (await dir.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); }
    if (!(await published.get(doc.id)).last) await published.add(doc.id, { id: pid, name: doc.name || '', gym: doc.gym || '', t: Date.now() });   // 下一版的 origin 接在這一版後面
  } finally { b.close(); }
  await open(dir);
}
$('restore').onclick = async () => {
  try { await restore(wantPid); } catch (e) { if (e.name === 'AbortError') return; gateError(e.message === 'no patch' ? new Error(T('w3NoPatch')) : e); }
};
if (want) $('restore').hidden = false;
// 固定連結 #p=<公開版本 id>：不用選資料夾，從公開資料下載到瀏覽器的私有檔案系統（OPFS）接著精修；同一版再開直接用上次的工作檔
const [, linkPid = ''] = /^#p=([0-9a-z]{16})$/.exec(location.hash) || [];
if (linkPid) (async () => {
  try {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(`wall3d-${linkPid}`, { create: true });
    try { await dir.getFileHandle('wall.json'); await open(dir); }
    catch (e) { if (e.name !== 'NotFoundError') throw e; await restore(linkPid, dir); }
  } catch (e) { gateError(e.message === 'no patch' ? new Error(T('w3NoPatch')) : e); }
})();
if (want) handles.get(want).then(h => { if (h && $('gate') && !$('gate').hidden) { remembered = h; $('open').textContent = T('w3OpenRemembered', h.name); } });

// 岩點的範圍照貼圖空間的標籤畫（跟岩點貓一樣，邊緣不受三角面大小影響）；修過的、新補的岩點沒有貼圖標籤，照三角面上色
const RG_FORMAT = 1030, RED_FORMAT = 1028, FLAG_W = 2048;   // three.js 的 RGFormat、RedFormat（打包時沒匯出）
const unz = async (b64) => new Uint8Array(await new Response(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
function labelUniforms(labels, size, holds) {
  const tex = new DataTexture(new Uint8Array(labels.buffer), size, size, RG_FORMAT, UnsignedByteType);
  tex.magFilter = tex.minFilter = NearestFilter; tex.generateMipmaps = false; tex.unpackAlignment = 1; tex.needsUpdate = true;
  if (holds + 2 > FLAG_W) throw new Error(T('w3TooManyHolds'));
  const flags = new Uint8Array(FLAG_W), ft = new DataTexture(flags, FLAG_W, 1, RED_FORMAT, UnsignedByteType);
  ft.magFilter = ft.minFilter = NearestFilter; ft.generateMipmaps = false; ft.unpackAlignment = 1; ft.needsUpdate = true;
  return { flags, tex: ft, uniforms: { studioLabels: { value: tex }, studioFlags: { value: ft }, studioSize: { value: size }, studioHot: { value: 0 }, studioOff: { value: new Color(TINT.off.slice(0, 3)) }, studioHotColor: { value: new Color(...TINT.hot.slice(0, 3)) } } };
}
const LABEL_SHADER = `uniform sampler2D studioLabels;uniform sampler2D studioFlags;uniform float studioSize;uniform float studioHot;uniform vec3 studioOff;uniform vec3 studioHotColor;
vec2 studioAt(ivec2 p){p=clamp(p,ivec2(0),ivec2(int(studioSize)-1));vec2 t=texelFetch(studioLabels,p,0).rg*255.;float l=t.x+t.y*256.;return vec2(studioHot>.5&&abs(l-studioHot)<.5?1.:0.,l>.5?texelFetch(studioFlags,ivec2(int(l),0),0).r*255.:0.);}
vec2 studioWeight(vec2 uv){vec2 p=uv*studioSize-.5;ivec2 i=ivec2(floor(p));vec2 f=fract(p);return mix(mix(studioAt(i),studioAt(i+ivec2(1,0)),f.x),mix(studioAt(i+ivec2(0,1)),studioAt(i+ivec2(1,1)),f.x),f.y);}
`;
async function bytes(dir, name) { return new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer()); }

async function open(dir) {
  let doc;
  try { doc = JSON.parse(new TextDecoder().decode(await bytes(dir, 'wall.json'))); } catch (e) { throw new Error('not a pack'); }
  if (doc.format !== 'climbio-3d-wall/1' || !doc.surfaces?.frame) throw new Error('not a pack');
  if (want && doc.id !== want) throw new Error('wrong wall');   // 從 Wall 的「我的岩點貓牆面」進來：資料夾要是選的那面牆
  const [glb, faces, faceSurfaces] = await Promise.all([bytes(dir, doc.model), bytes(dir, doc.faces), packSurfaces(doc)]);
  const gltf = await parseModel(glb);
  let surface = null;
  gltf.scene.traverse(o => { if (o.isMesh) surface = o; });
  const geo = surface.geometry, faceLabels = u16(faces), tris = geo.index.count / 3;
  if (faceLabels.length !== tris || faceSurfaces.length !== tris) throw new Error(T('w3FaceMismatch'));
  // 每個面三個頂點各自一份（不共用），顏色才能一面一面上：隱藏的面、不在的岩點、游標指到的混進貼圖顏色
  const P = geo.attributes.position, UV = geo.attributes.uv, I = geo.index, pos = new Float32Array(tris * 9), uv = new Float32Array(tris * 6);
  for (let k = 0; k < tris * 3; k++) { const v = I.getX(k); pos[k * 3] = P.getX(v); pos[k * 3 + 1] = P.getY(v); pos[k * 3 + 2] = P.getZ(v); uv[k * 2] = UV.getX(v); uv[k * 2 + 1] = UV.getY(v); }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3)); g.setAttribute('uv', new BufferAttribute(uv, 2)); g.setAttribute('color', new BufferAttribute(new Float32Array(tris * 12), 4));
  const lab = labelUniforms(u16(await unz(doc.holdLabels.data)), doc.holdLabels.size, doc.holds.length);
  const mat = new MeshBasicMaterial({ map: surface.material.map, side: DoubleSide, vertexColors: true });
  // 裁切框外（岩點貓不畫的）跟隱藏的面一樣蓋紅色
  const framed = frameShader(doc, `diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${TINT.hidden.slice(0, 3).join(',')}), ${TINT.hidden[3]});`);
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, lab.uniforms);
    sh.fragmentShader = LABEL_SHADER + sh.fragmentShader.replace('#include <color_fragment>', `diffuseColor.rgb = mix(diffuseColor.rgb, vColor.rgb, vColor.a);
      vec2 so=vec2(.6/studioSize);vec2 sw=(studioWeight(vMapUv+so)+studioWeight(vMapUv-so)+studioWeight(vMapUv+vec2(so.x,-so.y))+studioWeight(vMapUv+vec2(-so.x,so.y)))*.25;
      vec2 sa=max(fwidth(sw),vec2(.001));vec2 sc=smoothstep(.5-sa,.5+sa,sw);
      diffuseColor.rgb=mix(diffuseColor.rgb,studioOff,${TINT.off[3]}*sc.y);diffuseColor.rgb=mix(diffuseColor.rgb,studioHotColor,${TINT.hot[3]}*sc.x);`);
    framed(sh);
  };
  geo.dispose(); surface.geometry = g; surface.material = mat;
  g.boundsTree = new MeshBVH(g, { indirect: true }); surface.raycast = acceleratedRaycast;
  gltf.scene.updateMatrixWorld(true);
  const scene = new Scene(); scene.background = new Color('#0e0e0f'); scene.add(gltf.scene);
  // 每一面、每顆岩點有哪些面
  const byHold = doc.holds.map(() => []);
  for (let f = 0; f < tris; f++) if (faceLabels[f]) byHold[faceLabels[f] - 1]?.push(f);
  const cent = new Float32Array(tris * 3);   // 每個面的中心（模型座標）：點到切掉的地方時找出同一條切線切掉的面
  for (let f = 0; f < tris; f++) for (let j = 0; j < 3; j++) cent[f * 3 + j] = (pos[f * 9 + j] + pos[f * 9 + 3 + j] + pos[f * 9 + 6 + j]) / 3;
  S = { lab, dir, doc, faceLabels, faceSurfaces, surface, scene, byHold, tris, framed, cent, base: faceLabels.slice(), edits: new Map((doc.edits || []).map(e => [e.id, e.m3])), added: [] };
  for (const id of S.edits.keys()) if (!doc.holds.some(h => h.id === id)) S.added.push(id);
  reapply();
  S.bySurface = doc.surfaces.list.map(() => []);
  for (let f = 0; f < tris; f++) S.bySurface[faceSurfaces[f]].push(f);
  handles.put(doc.id, dir);
  setupView();
  $('wallName').textContent = doc.name || doc.id;
  $('gate').hidden = true; $('work').hidden = false; $('steps').hidden = false;
  stage = doc.surfaces.frame.planes.length || doc.surfaces.list.some(x => x.hidden) ? 'holds' : 'model';   // 還沒切過先切模型；切過的（含接著精修的公開版本）直接修岩點
  setStage(stage, true);
  paint(); fit(); draw();
}

// ---- 畫面 ----
let renderer, camera, target = new Vector3(), radius = 1;
const facing = new Vector3();   // 正面：鏡頭從這個方向看牆，轉角度只能離它 45° 內
const up = new Vector3();
function setupView() {
  const view = $('view');
  renderer = new WebGLRenderer({ antialias: true }); renderer.outputColorSpace = SRGBColorSpace; renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  view.append(renderer.domElement);
  camera = new PerspectiveCamera(50, 1, 0.005, 100);
  up.fromArray(S.doc.up).normalize(); camera.up.copy(up);
  const lc = document.createElement('canvas'); lc.id = 'cutLine'; view.append(lc);
  new ResizeObserver(draw).observe(view);
  controls(view);
}
// 正面：岩點範圍的中心，從資料包的正面方向看，整面放進畫面
function fit() {
  const pts = S.doc.holds.map(h => new Vector3(...h.position)), box = new Box3().setFromPoints(pts);
  box.getCenter(target); radius = box.getSize(new Vector3()).length() * 0.75;
  const ref = new Vector3(...S.doc.reference.position).sub(target).normalize();
  const front = S.doc.front ? new Vector3(...S.doc.front).normalize() : ref;
  facing.copy(front.add(up.clone().multiplyScalar(-0.15)).normalize());
  camera.position.copy(target).add(facing.clone().multiplyScalar(radius * 1.15)); camera.up.copy(up); camera.lookAt(target);
}
function draw() {
  if (!renderer) return;
  const v = $('view'), W = v.clientWidth, H = v.clientHeight;
  if (!W || !H) return;
  renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix();
  const lc = $('cutLine'); if (lc.width !== W || lc.height !== H) { lc.width = W; lc.height = H; }
  renderer.render(S.scene, camera);
}
// 左鍵／右鍵拖＝旋轉（切直線時左鍵是畫線），Shift／Alt＋左鍵或中鍵拖＝平移，滾輪＝往游標那一點縮放；沒拖動的點一下是選取
function controls(view) {
  let drag = null;
  view.addEventListener('contextmenu', e => e.preventDefault());
  view.addEventListener('pointerdown', (e) => {
    try { view.setPointerCapture(e.pointerId); } catch (err) { /* 抓不到指標就照常，只是拖出畫面外會斷 */ }
    const r = view.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (edit) { drag = { vertex: grab(x, y) }; return; }   // 修外框：鏡頭不動，只拖頂點
    const isCutLine = mode === 'cut' && e.button === 0 && !e.shiftKey && !e.altKey;
    const isFree = mode === 'draw' && e.button === 0 && !e.shiftKey && !e.altKey;
    const isPan = e.button === 1 || e.shiftKey || e.altKey;
    const isTurn = !isCutLine && !isFree && !isPan && (e.button === 0 || e.button === 2);
    drag = { x: e.clientX, y: e.clientY, turn: isTurn, moved: false,
      line: isCutLine ? [[x, y]] : null, free: isFree ? [[x, y]] : null };
    // 長按（不動 0.45 秒）：岩點上是修外框，牆上是補一顆（只在岩點精修階段）
    if (stage === 'holds' && mode === 'pick' && e.button === 0 && !isPan) { const d = drag; d.timer = setTimeout(() => { if (drag === d && !d.moved) { d.long = true; startEdit(e); } }, 450); }
  });
  view.addEventListener('pointermove', (e) => {
    if (drag && drag.vertex !== undefined) {
      if (drag.vertex >= 0) { const r = view.getBoundingClientRect(); edit.poly[drag.vertex] = [e.clientX - r.left, e.clientY - r.top]; outline(); }
      return;
    }
    if (!drag) { if (!edit) hover(e); return; }
    if (drag.free) { const r = view.getBoundingClientRect(), q = [e.clientX - r.left, e.clientY - r.top], l = drag.free[drag.free.length - 1]; if (Math.hypot(q[0] - l[0], q[1] - l[1]) >= 3) { drag.free.push(q); drag.moved = true; freeLine(drag.free); } return; }
    if (drag.line) { const r = view.getBoundingClientRect(); drag.line[1] = [e.clientX - r.left, e.clientY - r.top]; drag.moved = true; cutLine(drag.line); return; }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      if (drag.turn) {
        const h = wallHit(0, 0);
        if (h) target.copy(h.point);
      }
    }
    drag.x = e.clientX; drag.y = e.clientY;
    const off = camera.position.clone().sub(target), right = new Vector3().crossVectors(up, off).normalize(), screenUp = new Vector3().crossVectors(off, right).normalize();
    if (!drag.turn) {
      // 平移：畫面上拖多少，牆跟著手走多少（照目標那一層的距離換算）
      const k = 2 * off.length() * Math.tan(camera.fov * Math.PI / 360) / $('view').clientHeight;
      const move = right.multiplyScalar(-dx * k).add(screenUp.multiplyScalar(dy * k));
      target.add(move); camera.position.add(move);
    } else {
      const H = Math.max(240, $('view').clientHeight), k = Math.PI / H;
      const flat = (v) => v.clone().sub(up.clone().multiplyScalar(v.dot(up))).normalize();
      const faceFlat = flat(facing), next = off.clone();
      if (Math.abs(dx) > 1e-5) {
        const cand = next.clone().applyAxisAngle(up, -dx * k);
        if (flat(cand).angleTo(faceFlat) < 1.25 || flat(cand).angleTo(faceFlat) < flat(next).angleTo(faceFlat)) next.copy(cand);
      }
      if (Math.abs(dy) > 1e-5) {
        const axis = new Vector3().crossVectors(up, next).normalize();
        if (axis.lengthSq() > 0.5) {
          const cand = next.clone().applyAxisAngle(axis, -dy * k);
          if (Math.abs(cand.clone().normalize().dot(up)) < 0.92) next.copy(cand);
        }
      }
      camera.position.copy(target).add(next);
      camera.up.copy(up);
    }
    camera.lookAt(target); draw();
  });
  view.addEventListener('pointerup', (e) => {
    const d = drag; drag = null;
    if (d) clearTimeout(d.timer);
    if (!d || d.vertex !== undefined || d.long) return;
    if (d && d.free) { freeLine(null); finishFree(d.free); return; }
    if (d && d.line) { cutLine(null); if (d.line[1] && Math.hypot(d.line[1][0] - d.line[0][0], d.line[1][1] - d.line[0][1]) > 10) cut(d.line[0], d.line[1]); return; }
    if (d && !d.moved && e.button === 0) click(e);
  });
  view.addEventListener('dblclick', (e) => {   // 修外框：點兩下頂點拿掉（至少留 3 個）
    if (!edit || edit.poly.length <= 3) return;
    const r = view.getBoundingClientRect(), i = near(e.clientX - r.left, e.clientY - r.top);
    if (i >= 0) { edit.poly.splice(i, 1); outline(); }
  });
  view.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (edit) return;
    const r = view.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width * 2 - 1, ny = -(e.clientY - r.top) / r.height * 2 + 1;
    const h = wallHit(nx, ny), at = h ? h.point : ray.ray.at(camera.position.distanceTo(target), new Vector3());
    const k = Math.exp(e.deltaY * 0.0012), len = camera.position.distanceTo(at) * k;
    if (len < radius * 0.03 || len > radius * 4) return;
    camera.position.sub(at).multiplyScalar(k).add(at); target.sub(at).multiplyScalar(k).add(at);
    const ch = wallHit(0, 0);
    if (ch) target.copy(ch.point);
    draw();
  }, { passive: false });
}

// ---- 選取 ----
const ray = new Raycaster(); ray.firstHitOnly = true;
function wallHit(nx = 0, ny = 0) {
  camera.updateMatrixWorld(true);
  ray.firstHitOnly = false;
  ray.setFromCamera(new Vector2(nx, ny), camera);
  const inv = S.surface.matrixWorld.clone().invert(), planes = S.doc.surfaces.frame.planes;
  const h = ray.intersectObject(S.surface, false).find((x) => {
    if (S.doc.surfaces.list[S.faceSurfaces[x.faceIndex]]?.hidden) return false;
    const p = x.point.clone().applyMatrix4(inv).toArray();
    return !planes.some((q) => outside(q, p));
  });
  ray.firstHitOnly = true;
  return h || null;
}
function hit(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), camera);
  const h = ray.intersectObject(S.surface, false)[0];
  if (!h) return null;
  const f = h.faceIndex, p = h.point.clone().applyMatrix4(S.surface.matrixWorld.clone().invert()).toArray();
  const planes = S.doc.surfaces.frame.planes, out = planes.flatMap((q, i) => outside(q, p) ? [i] : []);
  if (out.length) return out.every(i => planes[i].kind === 'cut') ? { kind: 'cut', i: out.join(',') } : null;   // 自動切掉的（地面、天花板、外緣）不給點
  return S.faceLabels[f] && stage === 'holds' ? { kind: 'hold', i: S.faceLabels[f] - 1 } : { kind: 'surface', i: S.faceSurfaces[f] };
}
const dot3 = (n, p) => n[0] * p[0] + n[1] * p[1] + n[2] * p[2];
const outside = (q, p) => dot3(q.n, p) < q.d && (!q.bounds || q.bounds.every(([m, e]) => dot3(m, p) >= e));
// 這幾條切線切掉的面（游標指到切掉的地方時亮起來）
function cutFaces(key) {
  const qs = key.split(',').map(i => S.doc.surfaces.frame.planes[+i]), out = [], c = S.cent;
  for (let f = 0; f < S.tris; f++) { const p = [c[f * 3], c[f * 3 + 1], c[f * 3 + 2]]; if (qs.some(q => outside(q, p))) out.push(f); }
  return out;
}
function hover(e) {
  const h = mode === 'cut' || mode === 'draw' ? null : hit(e), same = (a, b) => a === b || (a && b && a.kind === b.kind && a.i === b.i);
  if (same(h, hot)) return;
  hot = h; $('view').classList.toggle('pick', !!h); paint(); draw();
}
function click(e) {
  if (mode === 'add') { setMode('pick'); startEdit(e); return; }   // 新增：點牆上一處補一顆，直接進修外框
  const h = mode === 'cut' || mode === 'draw' ? null : hit(e);
  if (stage === 'holds') {   // 岩點精修：點岩點是選它（X 刪除、Enter 修外框），點別處取消選取
    select(h && h.kind === 'hold' && sel !== h.i ? h.i : null);
    return;
  }
  if (!h) return;
  if (h.kind === 'cut') { remember(); const planes = S.doc.surfaces.frame.planes, drop = new Set(h.i.split(',').map(Number)); S.doc.surfaces.frame.planes = planes.filter((q, i) => !drop.has(i)); S.framed.set(S.doc.surfaces.frame.planes); hot = null; changed(); }
  else if (h.kind === 'surface') toggleSurface(h.i);
}
// ---- 修外框、補點（跟岩點貓的長按一樣）----
let edit = null;   // { id, poly：畫面座標的多邊形 }
const HANDLE = 10;
const near = (x, y) => edit.poly.findIndex(([px, py]) => Math.hypot(px - x, py - y) <= HANDLE);
// 按到頂點就拖它；按到邊的中點就在那裡加一個頂點再拖；其他地方不動
function grab(x, y) {
  const i = near(x, y);
  if (i >= 0) return i;
  const p = edit.poly;
  for (let k = 0; k < p.length; k++) {
    const a = p[k], b = p[(k + 1) % p.length], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (Math.hypot(m[0] - x, m[1] - y) <= HANDLE) { p.splice(k + 1, 0, m); return k + 1; }
  }
  return -1;
}
const toScreen = (w, W, H) => { const v = w.clone().project(camera); return v.z > -1 && v.z < 1 ? [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H] : null; };
function startEdit(e) {
  const r = $('view').getBoundingClientRect();
  beginEdit(hit(e), e.clientX - r.left, e.clientY - r.top);
}
// h：打到的東西（岩點、牆面）；cx、cy：畫面座標（牆上補一顆時圓心的位置）；poly：手畫的外框
function beginEdit(h, cx, cy, drawn = null) {
  const v = $('view'), W = v.clientWidth, H = v.clientHeight;
  if (!drawn && (!h || h.kind === 'cut')) return;
  let id, poly;
  if (drawn) { id = 'm' + Date.now().toString(36); poly = drawn; }
  else if (h.kind === 'hold') {
    // 這顆目前的範圍投到畫面上：面的頂點取凸包（跟岩點貓的外框一樣）
    id = h.i < S.doc.holds.length ? S.doc.holds[h.i].id : S.added[h.i - S.doc.holds.length];
    const P = S.surface.geometry.attributes.position, mw = S.surface.matrixWorld, w = new Vector3(), pts = [];
    for (const f of S.byHold[h.i]) for (let k = 0; k < 3; k++) { const q = toScreen(w.fromBufferAttribute(P, f * 3 + k).applyMatrix4(mw), W, H); if (q) pts.push(q); }
    if (pts.length < 3) return;
    poly = simplify(hull(pts), 16);
  } else {
    // 牆上：補一顆，先給一個小圓
    id = 'm' + Date.now().toString(36);
    poly = Array.from({ length: 8 }, (_, k) => [cx + 24 * Math.cos(k * Math.PI / 4), cy + 24 * Math.sin(k * Math.PI / 4)]);
  }
  edit = { id, poly }; hot = null; sel = null; paint(); draw();
  for (const b of ['modeCut', 'modeAdd', 'modeDraw', 'undo', 'redo', 'save']) $(b).disabled = true;
  syncBar(); outline();
}
function outline() {
  const c = $('cutLine'), g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  if (!edit) return;
  const p = edit.poly;
  g.beginPath(); p.forEach(([x, y], k) => k ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath();
  g.fillStyle = 'rgba(212,255,79,.12)'; g.fill(); g.strokeStyle = '#D4FF4F'; g.lineWidth = 2; g.setLineDash([]); g.stroke();
  for (const [x, y] of p) { g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#0e0e0f'; g.stroke(); }
}
function endEdit(keep) {
  const e = edit; edit = null;
  for (const b of ['modeCut', 'modeAdd', 'modeDraw']) $(b).disabled = false;
  $('undo').disabled = !undos.length; $('redo').disabled = !redos.length; $('save').disabled = !dirty;
  syncBar(); outline();
  if (keep && e && e.poly.length >= 3) {
    const v = $('view'), W = v.clientWidth, H = v.clientHeight, r = (x, n) => +x.toFixed(n);
    remember();
    if (!S.doc.holds.some(h => h.id === e.id) && !S.added.includes(e.id)) S.added.push(e.id);
    S.edits.set(e.id, { c: [...camera.position.toArray(), ...camera.quaternion.toArray()].map(x => r(x, 5)), p: e.poly.map(([x, y]) => [r(x / W, 4), r(y / H, 4)]), a: r(W / H, 4) });
    reapply(); changed();
  } else { paint(); draw(); }
}
function dropAdded(id) { S.added = S.added.filter(x => x !== id); S.edits.delete(id); reapply(); }
$('editOk').onclick = () => endEdit(true);
$('editDel').onclick = () => {   // 修外框時刪掉：原本的岩點標成不是岩點，補的點直接拿掉
  const id = edit.id; endEdit(false); remember();
  const x = S.doc.holds.find(h => h.id === id);
  if (x) x.off = 1; else dropAdded(id);
  changed();
};
// 修點套到面上（預覽用；岩點貓照貼圖像素套，邊界更細）：從記下的鏡頭看得到、中心落在多邊形裡的面算這顆，原本是這顆、落在外面的清掉
function reapply() {
  const F = S.faceLabels; F.set(S.base);
  const n = S.doc.holds.length, ids = [...S.doc.holds.map(h => h.id), ...S.added], mw = S.surface.matrixWorld, c = S.cent, w = new Vector3(), dir = new Vector3();
  const cam = new PerspectiveCamera(50, 1, 0.005, 100), look = new Raycaster(); look.firstHitOnly = true;
  for (const [id, m3] of S.edits) {
    const idx = ids.indexOf(id) + 1;
    if (!idx) continue;
    cam.aspect = m3.a; cam.position.fromArray(m3.c, 0); cam.quaternion.fromArray(m3.c, 3); cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
    const poly = m3.p; let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    for (let f = 0; f < S.tris; f++) {
      w.set(c[f * 3], c[f * 3 + 1], c[f * 3 + 2]).applyMatrix4(mw);
      const q = w.clone().project(cam), x = (q.x + 1) / 2, y = (1 - q.y) / 2;
      if (q.z < -1 || q.z > 1 || x < x0 - 0.03 || x > x1 + 0.03 || y < y0 - 0.03 || y > y1 + 0.03) continue;
      const dist = dir.subVectors(w, cam.position).length(); look.set(cam.position, dir.normalize());
      const hit = look.intersectObject(S.surface, false)[0];
      if (hit && hit.faceIndex !== f && hit.distance < dist - 0.003) continue;   // 從那個角度被擋住的不動
      if (inside(x, y, poly)) F[f] = idx; else if (F[f] === idx) F[f] = 0;
    }
  }
  S.byHold = Array.from({ length: n + S.added.length }, () => []);
  for (let f = 0; f < S.tris; f++) if (F[f]) S.byHold[F[f] - 1]?.push(f);
}
// 切直線：畫在牆上的一條線（兩端打到牆面的兩點）。畫得接近直的切成鉛直、接近橫的切成水平，其他穿過這條線、跟牆面垂直，
// 從哪個角度看都是牆上同一條直線；只切線段範圍內（兩端各一個垂直於線段的平面，往外多 2 成），切掉岩點少的那側
function cutLine(line) {
  const c = $('cutLine'), g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  if (!line || !line[1]) return;
  g.beginPath(); g.moveTo(...line[0]); g.lineTo(...line[1]);
  g.strokeStyle = '#D92D20'; g.lineWidth = 2; g.setLineDash([6, 4]); g.stroke();
}
function cut(a, b) {
  const planes = S.doc.surfaces.frame.planes;
  if (planes.length >= FRAME_MAX) { $('saveState').textContent = T('w3CutTooMany'); return; }
  const v = $('view'), W = v.clientWidth, H = v.clientHeight, inv = S.surface.matrixWorld.clone().invert();
  const at = ([x, y]) => {
    ray.setFromCamera(new Vector2(x / W * 2 - 1, -(y / H * 2 - 1)), camera);
    const h = ray.intersectObject(S.surface, false)[0];
    return h && { p: h.point.clone().applyMatrix4(inv), s: S.faceSurfaces[h.faceIndex] };
  };
  const ha = at(a), hb = at(b);
  if (!ha || !hb) { $('saveState').textContent = T('w3CutOnWall'); return; }
  const along = hb.p.clone().sub(ha.p), wallN = wallNormal(ha.s).add(wallNormal(hb.s)).normalize(), up = new Vector3(...S.doc.up).normalize();
  // 畫得接近直的（20° 內）：鉛直、跟牆面垂直的切面；接近橫的：水平面；其他：穿過這條線、跟牆面垂直
  const dx = Math.abs(b[0] - a[0]), dy = Math.abs(b[1] - a[1]), tan20 = Math.tan(Math.PI / 9);
  let n;
  if (dx < dy * tan20) { const flat = wallN.clone().sub(up.clone().multiplyScalar(wallN.dot(up))); n = up.clone().cross(flat).normalize(); if (n.lengthSq() < 0.5) n = along.clone().cross(wallN).normalize(); }
  else if (dy < dx * tan20) n = up.clone();
  else n = along.clone().cross(wallN).normalize();
  const mid = ha.p.clone().add(hb.p).multiplyScalar(0.5);
  let d = n.dot(mid);
  // 範圍：線段方向（投到切面上）兩端各一個平面，往外多 2 成，畫到牆邊時不留殘塊
  const t = along.clone().sub(n.clone().multiplyScalar(along.dot(n))).normalize(), len = Math.abs(along.dot(t)), ext = len * 0.2;
  const bounds = [[t, t.dot(ha.p) - ext], [t.clone().negate(), -t.dot(hb.p) - ext]];
  const gone = goneHolds(S.doc, S.faceLabels, S.faceSurfaces);
  let keep = 0, drop = 0;
  S.doc.holds.forEach((h, i) => {
    const p = new Vector3(...h.position);
    if (gone.has(i) || !bounds.every(([m, e]) => m.dot(p) >= e)) return;
    if (n.dot(p) >= d) keep++; else drop++;
  });
  if (drop > keep) { n.negate(); d = -d; }
  const r = (x) => +x.toFixed(5), vec = (x) => x.toArray().map(r);
  remember(); setMode('pick');
  planes.push({ kind: 'cut', n: vec(n), d: r(d), bounds: bounds.map(([m, e]) => [vec(m), r(e)]) });
  S.framed.set(planes); changed();
}
// 一面牆的法向：不算岩點的面，面積加權平均（朝鏡頭那側）；算過就記著
const normals = new Map();
function wallNormal(i) {
  if (!normals.has(i)) {
    const P = S.surface.geometry.attributes.position, A = new Vector3(), B = new Vector3(), C = new Vector3(), sum = new Vector3();
    for (const f of S.bySurface[i]) {
      if (S.faceLabels[f]) continue;
      A.fromBufferAttribute(P, f * 3); B.fromBufferAttribute(P, f * 3 + 1); C.fromBufferAttribute(P, f * 3 + 2);
      sum.add(B.sub(A).cross(C.sub(A)));   // 長度＝兩倍面積
    }
    const toCam = camera.position.clone().applyMatrix4(S.surface.matrixWorld.clone().invert()).sub(new Vector3(...S.doc.holds[0].position));
    normals.set(i, sum.dot(toCam) < 0 ? sum.negate().normalize() : sum.normalize());
  }
  return normals.get(i).clone();
}
function toggleSurface(i) { remember(); const s = S.doc.surfaces.list[i]; s.hidden = !s.hidden; changed(); }
function changed() { dirty = true; $('save').disabled = false; $('undo').disabled = !undos.length; $('redo').disabled = !redos.length; $('saveState').textContent = ''; paint(); draw(); }
// 復原：改之前先記下隱藏、不是岩點、裁切平面、修點
const snap = () => JSON.stringify({ hidden: S.doc.surfaces.list.map(x => !!x.hidden), off: S.doc.holds.map(h => !!h.off), planes: S.doc.surfaces.frame.planes, edits: [...S.edits], added: S.added });
function remember() { undos.push(snap()); redos.length = 0; }
function restore1(x) {
  S.doc.surfaces.list.forEach((s, i) => { s.hidden = x.hidden[i]; });
  S.doc.holds.forEach((h, i) => { if (x.off[i]) h.off = 1; else delete h.off; });
  S.doc.surfaces.frame.planes = x.planes; S.framed.set(x.planes);
  if (JSON.stringify([...S.edits]) !== JSON.stringify(x.edits)) { S.edits = new Map(x.edits); S.added = x.added; reapply(); }
  if (sel != null && sel >= S.doc.holds.length + S.added.length) sel = null;
  hot = null; changed();
}
function undo() { if (!undos.length) return; redos.push(snap()); restore1(JSON.parse(undos.pop())); }
function redo() { if (!redos.length) return; undos.push(snap()); restore1(JSON.parse(redos.pop())); }
$('redo').onclick = redo;
$('undo').onclick = undo;
// 快捷鍵跟 Wall 編輯器同一套：N 新增、P 手畫、X／Delete 刪除、Enter 修外框（修的時候是完成）、Esc 取消、J／K 上一顆下一顆、Z 復原、Shift+Z 重做
addEventListener('keydown', (e) => {
  if (!S || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase(), mod = e.metaKey || e.ctrlKey;
  if (mod && k === 's') { e.preventDefault(); if (!$('save').disabled) $('save').click(); return; }
  if (mod && (k === 'z' || k === 'y')) { e.preventDefault(); if (!edit) { if (k === 'y' || e.shiftKey) redo(); else undo(); } return; }
  if (mod || e.altKey) return;
  if (k === 'escape') { if (edit) endEdit(false); else if (mode !== 'pick') setMode('pick'); else if (sel != null) select(null); return; }
  if (k === 'enter') { if (edit) endEdit(true); else if (sel != null) { e.preventDefault(); editSelected(); } return; }
  if (edit) { if (k === 'x' || k === 'delete' || k === 'backspace') { e.preventDefault(); $('editDel').click(); } return; }
  if (k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (stage === 'model') { if (k === 'c') setMode(mode === 'cut' ? 'pick' : 'cut'); return; }
  if (k === 'n') { e.preventDefault(); setMode(mode === 'add' ? 'pick' : 'add'); }
  else if (k === 'p') { e.preventDefault(); setMode(mode === 'draw' ? 'pick' : 'draw'); }
  else if (k === 'x' || k === 'delete' || k === 'backspace') { e.preventDefault(); toggleOff(); }
  else if (k === 'j' || k === 'arrowdown') { e.preventDefault(); step(1); }
  else if (k === 'k' || k === 'arrowup') { e.preventDefault(); step(-1); }
});
// ---- 選岩點（岩點精修階段）：點一顆選它，動作列浮在工具列上方 ----
function select(i) { sel = i; hot = null; syncBar(); paint(); draw(); }
function isOff(i) { return i < S.doc.holds.length && !!S.doc.holds[i].off; }
function toggleOff() {
  if (sel == null) return;
  remember();
  if (sel >= S.doc.holds.length) { const id = S.added[sel - S.doc.holds.length]; sel = null; dropAdded(id); }
  else { const x = S.doc.holds[sel]; if (x.off) delete x.off; else x.off = 1; }
  changed(); syncBar();
}
function editSelected() {
  if (sel == null) return;
  const v = $('view'), P = S.surface.geometry.attributes.position, mw = S.surface.matrixWorld, w = new Vector3(); let n = 0;
  for (const f of S.byHold[sel]) for (let k = 0; k < 3; k++) { w.fromBufferAttribute(P, f * 3 + k).applyMatrix4(mw); if (toScreen(w, v.clientWidth, v.clientHeight)) n++; }
  if (n) beginEdit({ kind: 'hold', i: sel }, 0, 0);
}
// J／K：依畫面上由左到右、由上到下的順序換下一顆（只算有看到、沒標成不是岩點的）
function step(d) {
  const v = $('view'), W = v.clientWidth, H = v.clientHeight, list = [];
  const at = (i, pos) => { const q = toScreen(new Vector3(...pos), W, H); if (q && q[0] >= 0 && q[0] <= W && q[1] >= 0 && q[1] <= H) list.push({ i, x: q[0], y: q[1] }); };
  S.doc.holds.forEach((h, i) => { if (!h.off) at(i, h.position); });
  list.sort((a, b) => Math.round(a.x / 40) - Math.round(b.x / 40) || a.y - b.y);
  if (!list.length) return;
  const cur = list.findIndex(x => x.i === sel);
  select(list[(cur < 0 ? (d > 0 ? 0 : list.length - 1) : (cur + d + list.length) % list.length)].i);
}
// 動作列：選到岩點時是「修外框、刪除（已刪的是還原）」；修外框時是「刪除、完成」
function syncBar() {
  const editing = !!edit, show = editing || (stage === 'holds' && sel != null);
  $('bar').hidden = !show; $('editBar').hidden = !editing; $('selEdit').hidden = $('selDel').hidden = editing;
  if (sel != null && !editing) $('selDel').textContent = T(isOff(sel) ? 'w3Restore1' : 'w3Delete');
}
$('selEdit').onclick = editSelected; $('selDel').onclick = toggleOff;
// 手畫：拖一圈就是外框，放開進修外框
function freeLine(pts) {
  const c = $('cutLine'), g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  if (!pts || pts.length < 2) return;
  g.beginPath(); pts.forEach(([x, y], k) => k ? g.lineTo(x, y) : g.moveTo(x, y));
  g.strokeStyle = '#D4FF4F'; g.lineWidth = 2; g.setLineDash([]); g.stroke();
}
function finishFree(pts) {
  setMode('pick');
  if (pts.length < 8) return;
  const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
  if (Math.max(...xs) - Math.min(...xs) < 12 || Math.max(...ys) - Math.min(...ys) < 12) return;
  beginEdit(null, 0, 0, simplify(pts, 5));
}

// ---- 上色：隱藏的面、不在的岩點、游標指到的 ----
function paint() {
  const C = S.surface.geometry.attributes.color, a = C.array;
  a.fill(0);
  const set = (faces, c) => { for (const f of faces) for (let k = 0; k < 3; k++) a.set(c, (f * 3 + k) * 4); };
  S.doc.surfaces.list.forEach((s, i) => { if (s.hidden) set(S.bySurface[i], TINT.hidden); });
  const gone = goneHolds(S.doc, S.faceLabels, S.faceSurfaces);
  // 沒修過的岩點用貼圖標籤上色（範圍乾淨）；修過的、新補的沒有貼圖標籤，照三角面
  const smooth = (i) => i < S.doc.holds.length && !S.edits.has(S.doc.holds[i].id), flags = S.lab.flags;
  flags.fill(0);
  S.doc.holds.forEach((h, i) => { if (h.off) { if (smooth(i)) flags[i + 1] = 1; else set(S.byHold[i], TINT.off); } });
  S.lab.tex.needsUpdate = true;
  const mark = hot || (stage === 'holds' && sel != null ? { kind: 'hold', i: sel } : null);   // 游標指到的；沒有就是選到的
  const hotHold = mark && mark.kind === 'hold' && smooth(mark.i);
  S.lab.uniforms.studioHot.value = hotHold ? mark.i + 1 : 0;
  if (mark && !hotHold) set(mark.kind === 'surface' ? S.bySurface[mark.i] : mark.kind === 'cut' ? cutFaces(mark.i) : S.byHold[mark.i], TINT.hot);
  C.needsUpdate = true;
  $('holdInfo').textContent = T('w3HoldCount', S.doc.holds.length - gone.size + S.added.length);
}
$('modeCut').onclick = () => setMode(mode === 'cut' ? 'pick' : 'cut');
$('modeAdd').onclick = () => setMode(mode === 'add' ? 'pick' : 'add');
$('modeDraw').onclick = () => setMode(mode === 'draw' ? 'pick' : 'draw');
function setMode(m) {
  mode = m; hot = null;
  for (const [id, k] of [['modeCut', 'cut'], ['modeAdd', 'add'], ['modeDraw', 'draw']]) { $(id).setAttribute('aria-pressed', m === k); $(id).classList.toggle('on', m === k); }
  $('view').classList.toggle('cutting', m === 'cut' || m === 'draw' || m === 'add');
  if (S) { paint(); draw(); }
}
// 兩個階段：模型（切直線、隱藏牆面）、岩點（精修岩點）；步驟列跟著換
function setStage(st, first = false) {
  if (edit) return;
  stage = st; sel = null; hot = null; mode = 'pick';
  for (const b of document.querySelectorAll('#toolbar button')) b.hidden = b.dataset.stage !== st;
  setMode('pick'); syncBar(); renderSteps();
  if (S && !first) { paint(); draw(); }
}
function renderSteps() {
  StudioShell.steps($('steps'), [{ id: 'walls', label: T('w3StepWalls') }, { id: 'model', label: T('w3StepModel'), on: stage === 'model' }, { id: 'holds', label: T('w3StepHolds'), on: stage === 'holds' }, { id: 'publish', label: T('w3Publish') }],
    id => { if (id === 'walls') location.href = '../wall/'; else if (id === 'publish') openPublish(); else setStage(id); });
  $('steps').querySelector('[data-step="publish"]').id = 'publish';
}

// ---- 存檔：只寫回 wall.json ----
async function saveDoc() {
  if (S.edits.size) S.doc.edits = [...S.edits].map(([id, m3]) => ({ id, m3 })); else delete S.doc.edits;
  const w = await (await S.dir.getFileHandle('wall.json')).createWritable();
  await w.write(JSON.stringify(S.doc)); await w.close();
  dirty = false; $('saveState').textContent = T('w3Saved');
}
$('save').onclick = async () => {
  if (!S) return;
  $('save').disabled = true;
  try { await saveDoc(); } catch (e) { console.error(e); $('save').disabled = false; $('saveState').textContent = T('w3SaveFailed', e.message); }
};
// ---- 發佈：整個資料包放進開放資料集（模型直接傳給 Hub）。
// 岩點貓用 /hold/?m3d=<牆 id> 打開：資料在開放資料集 climbio/walls3d。一律公開、網址固定，沒改的檔案不重傳 ----
async function optionalBytes(dir, name) { try { return await bytes(dir, name); } catch (e) { if (e.name === 'NotFoundError') return null; throw e; } }
// 成品存在資料夾的「成品」子資料夾：換過的檔案蓋掉、不在成品裡的舊檔拿掉（檔名帶內容雜湊）
async function saveBaked(files) {
  try {
    const out = await S.dir.getDirectoryHandle('成品', { create: true }), keep = new Set(files.map(f => f.path));
    for (const f of files) { const w = await (await out.getFileHandle(f.path, { create: true })).createWritable(); await w.write(f.bytes); await w.close(); }
    for await (const name of out.keys()) if (!keep.has(name)) await out.removeEntry(name).catch(() => {});
  } catch (e) { console.warn('成品存不進資料夾', e); }
}
// 基底的工作檔：第一次發佈時把當時的 wall.json 存成資料夾裡的 base-wall.json，之後沿用（內容相同，Hub 只存一次）
async function baseWall() {
  const have = await optionalBytes(S.dir, 'base-wall.json');
  if (have) return have;
  const b = await bytes(S.dir, 'wall.json');
  try { const w = await (await S.dir.getFileHandle('base-wall.json', { create: true })).createWritable(); await w.write(b); await w.close(); } catch (e) { console.warn('基底存不進資料夾', e); }
  return b;
}
// patch：只有最終決定（隱藏的面、裁切平面、不是岩點、修點），不記編輯過程；parent 是這台上一次發佈的版本
const patchOf = (parent, name, gym) => ({
  format: 'climbio-3d-patch/1', ...(parent ? { parent } : {}), name, gym,
  hidden: S.doc.surfaces.list.flatMap((x, i) => (x.hidden ? [i] : [])), planes: S.doc.surfaces.frame.planes,
  off: S.doc.holds.filter(h => h.off).map(h => h.id), edits: S.doc.edits || [],
});
const gymInput = document.createElement('input');
gymInput.className = 'field'; gymInput.maxLength = 30; gymInput.setAttribute('aria-label', T('w3Gym'));
const gymField = Object.assign(document.createElement('label'), { className: 'dk-field' });
gymField.append(T('w3Gym'), gymInput);
const pubUI = createPublishUI({
  text: publishText(), title: T('w3PubTitle'), extras: [gymField], visibility: false,
  onCopy: () => { $('saveState').textContent = T('w3LinkCopied'); },
  async onGo() {
    const gym = gymInput.value.trim();
    if (!gym) throw new Error(T('w3NoGym'));
    if (gym !== S.doc.gym) { S.doc.gym = gym; dirty = true; }
    if (dirty) { await saveDoc(); $('save').disabled = true; }   // 發佈的是存好的 wall.json
    // 不認人：每次發佈是新的 id，origin 指到這台上一次發佈的版本（沒發佈過就沒有）；已發佈的 id 不會再改
    const id = newId(), last = (await published.get(S.doc.id)).last, name = S.doc.name || T('w3DefaultName'), thumb = await optionalBytes(S.dir, 'thumb.jpg');
    // 發佈的是成品：工作檔（原模型＋分面、切線、修點）烘焙成岩點貓和別的檢視器直接能用的模型（wall3dkit/bakepack.js）。
    // 成品也存一份在資料夾的「成品」子資料夾（工作檔不動，之後來回調整、再發佈都從工作檔烘）
    pubUI.run.open({ name, tiles: [], cover: !!thumb });
    if (thumb) pubUI.run.scan('', new Blob([thumb], { type: 'image/jpeg' }));
    let res;
    try {
      const { bakePack } = await import('../../wall3dkit/bakepack.js');
      const [glb, faces] = await Promise.all([bytes(S.dir, S.doc.model), bytes(S.dir, S.doc.faces)]);
      pubUI.run.step(T('w3StepBake'));
      const baked = await bakePack({ doc: { ...S.doc, id }, glb, faces, progress: (k) => pubUI.run.step(T('w3Bake_' + k)) });
      const base = await baseWall();
      const files = [
        { path: 'index.json', bytes: new TextEncoder().encode(JSON.stringify({ climbio: 2, type: 'wall3d', id, name, gym, pack: 'wall.json' })) },
        ...baked.files,
        // 基底（原模型、原始岩點與分面；每面牆一份，內容雜湊相同的 Hub 只存一次）與這一版的 patch（只有最終決定）：別人接著精修的起點，岩點貓只讀成品
        { path: 'base-wall.json', bytes: base }, { path: `base-${S.doc.model}`, bytes: glb }, { path: `base-${S.doc.faces}`, bytes: faces },
        { path: 'patch.json', bytes: new TextEncoder().encode(JSON.stringify(patchOf(last, name, gym))) },
      ];
      if (thumb) files.push({ path: 'thumb.jpg', bytes: thumb });
      await saveBaked(baked.files);
      const onProgress = (n, total) => pubUI.run.step(T(n < total ? 'w3StepUpload' : 'w3StepRegister'), n, total);
      // 放進開放資料集 climbio/walls3d（模型直接傳給 Hub）；發佈就是公開
      res = await publishAnonymous({ id, name, type: 'wall3d', files, meta: { gym, ...(last ? { origin: last } : {}) }, onProgress });
      await published.add(S.doc.id, { id, name, gym, t: Date.now() });
    } finally { pubUI.run.close(); }
    pubUI.set({ link: `${location.origin.replace(/^http:\/\/(127\.0\.0\.1|localhost).*/, 'https://climbio.app')}/hold/?m3d=${id}`, summary: null, message: T('w3Published', res.version), go: { text: T('w3PublishAgain') } });
  },
});
function openPublish() {
  if (!S) return;
  gymInput.value = S.doc.gym || '';
  pubUI.set({ message: '', summary: { intro: T('w3PubIntro'), items: [T('w3PubItemModel'), T('w3PubItemBase'), T('w3PubItemLicense')] }, go: { text: T('w3Publish'), disabled: false } });
  pubUI.open();
}
// 步驟列（跟 Wall 同一種）：牆面回 Wall、岩點是這一頁、發佈打開發佈對話框
addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });
export { open, cut };
export const current = () => S;
export const view = () => ({ camera, target });
export const editing = () => edit;
