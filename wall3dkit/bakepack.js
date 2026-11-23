// 3D 牆成品包：Studio 發佈時，把工作檔（原模型＋wall.json 的分面、切線、修點）烘焙成岩點貓直接讀的成品（climbio-3d-wall/2）。
// 成品：wall-<雜湊>.glb（標準 glTF，已切好）、faces-<雜湊>.bin（每個面第幾顆岩點，deflate）、labels-<雜湊>.bin（貼圖空間的岩點標籤，已套修點，deflate）、
// walk-<雜湊>.json（沿牆鏡頭的軌道、牆面深度、實拍邊界表）、wall.json（岩點、軌道、授權）。岩點貓不再裁切、套 Studio 的修點、算淡出與軌道（stage.js 的 baked 路徑）。
// English: bakes the Studio working files into the finished climbio-3d-wall/2 pack that the phone only reads.
import { openStageFrom, packSurfaces, holdMargin, decode, inflate, parseModel, inside } from './stage.js';
import { bakeMesh, cutOutlines, writeGlb, sourceTexture } from './bake.js';
import { meshesOf, wallPath, WalkCam, packWalk, introEnd } from './walkcam.js';
import { Vector3, Scene, WebGLRenderer, PerspectiveCamera } from './vendor/three.js';

// 沿牆鏡頭的實拍邊界表要烘哪些畫面比例（寬÷高）：直的手機加到主畫面全螢幕（約 390×844）、在 Safari 裡（約 390×699）、寬一點的
const WALK_ASPECTS = [0.46, 0.56, 0.62];
// 畫面上下可以不是牆的比例：上面露一點牆頂上方的空間，下面是工具列（最低的腳點要在工具列上面點得到）
const WALK_MARGIN = { top: 0.2, bottom: 0.14 };

const deflate = async (bytes) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(s); };
const f32 = (a) => b64(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
async function hash(bytes) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].slice(0, 6).map(x => x.toString(16).padStart(2, '0')).join(''); }
const u8 = (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

// doc：工作檔的 wall.json（climbio-3d-wall/1，含 surfaces、edits）；glb、faces：原模型和原來的面標籤位元組。
// 回傳 { files: [{ path, bytes }], stats }，files 的第一個是 wall.json
export async function bakePack({ doc, glb, faces, progress = () => {} }) {
  progress('load');
  const surfaces = await packSurfaces(doc), labels = await inflate(decode(doc.holdLabels.data), 'deflate');
  const work = { ...doc, holds: doc.holds.map(h => ({ ...h })) };   // 套修點會往 holds 加補的岩點，不改工作檔
  const stage = await openStageFrom({ pack: work, glb, faces, labels, surfaces });
  stage.cleanVolumes();   // 量體的標籤整理成整塊（光暈不挖洞），見 stage.js
  progress('crop');
  const g = stage.surface.geometry;
  // 修過外框的岩點：網格照描的線切開（bake.js 的 cutOutlines），光暈、點選的範圍就是描的線
  const cut = cutOutlines({ positions: g.attributes.position.array, uvs: g.attributes.uv.array, fade: g.attributes.wallFade.array, index: g.index.array, faceLabels: stage.faceLabels, cuts: outlineCuts(stage), inside });
  paintInside(stage, cut);
  const baked = bakeMesh({ positions: cut.positions, uvs: cut.uvs, fade: cut.fade, index: cut.index, faceLabels: cut.faceLabels, planes: doc.surfaces.frame.planes, margin: holdMargin(doc) });
  const byOld = new Map(), exact = new Map();   // 原本的面編號 → 烘焙後的面編號；修點的外框裡（切好的）的烘焙後面編號，每顆一份
  baked.origin.forEach((o, f) => { const p = cut.parent[o]; (byOld.get(p) || byOld.set(p, []).get(p)).push(f); const k = cut.inside[o]; if (k) (exact.get(k) || exact.set(k, []).get(k)).push(f); });
  const fc = stage.holds.map(h => h.faceCount).sort((a, b) => a - b), bigHold = 5 * fc[fc.length >> 1];   // 量體：面數是中位數 5 倍以上（stage.js 同一條）
  // 岩點：補的岩點（修點新增）沒有位置，取它的面的頂點平均；不在的（標成不是岩點、被切掉、在地面上）標 off
  const sum = work.holds.map(() => [0, 0, 0, 0]);
  for (let f = 0; f < baked.faceLabels.length; f++) {
    const l = baked.faceLabels[f]; if (!l) continue;
    for (let k = 0; k < 3; k++) { const v = baked.index[f * 3 + k], a = sum[l - 1]; a[0] += baked.positions[v * 3]; a[1] += baked.positions[v * 3 + 1]; a[2] += baked.positions[v * 3 + 2]; a[3]++; }
  }
  const holds = stage.holds.map((h, i) => {
    const position = h.position || (sum[i][3] ? sum[i].slice(0, 3).map(x => +(x / sum[i][3]).toFixed(6)) : null);
    const ov = stage.overlays[i], edited = !!(ov && ov.userData.edited);
    // edited：修過外框（光暈照修的範圍）；fill：修過的量體光暈要填的面（修的外框裡面，烘焙後的面編號），量體上裝的小岩點不挖洞
    // 修過外框的：光暈填切好的外框裡面（量體上裝的 chip 也蓋過去，不挖洞），邊就是描的線
    const gl = new Set(ov && ov.userData.guestIds || []), guestFill = edited ? (ov.userData.inPoly || []).filter(f => gl.has(stage.faceLabels[f])).flatMap(f => byOld.get(f) || []) : [];   // chip 從修點的角度看不到的那側也蓋過去
    const fill = edited ? (exact.has(i + 1) ? [...new Set([...exact.get(i + 1), ...guestFill])] : h.faceCount >= bigHold || ov.userData.guests ? (ov.userData.inPoly || []).flatMap(f => byOld.get(f) || []) : null) : null;
    return { id: h.id, position, faceCount: h.faceCount, ...(edited ? { edited: 1 } : {}), ...(fill && fill.length ? { fill } : {}), ...(stage.gone.has(i) || h.off || !position ? { off: 1 } : {}) };
  });
  // 每顆岩點的覆蓋網格要用的面（原本的面編號，往外帶幾圈）換成烘焙後的面編號：切開的面變成好幾個、拿掉的不見
  const offsets = new Uint32Array(work.holds.length + 1), faceList = [];
  stage.overlays.forEach((m, i) => {
    if (exact.has(i + 1)) {
      // 修過外框的：切好的這顆的面（貼圖標籤的鋸齒不會畫到外面），加上修點的鏡頭看不到的這顆原本的面（斜看、背面；照貼圖標籤畫，不然那一側沒有光暈）
      for (let f = 0; f < baked.faceLabels.length; f++) if (baked.faceLabels[f] === i + 1) faceList.push(f);
      const near = new Set(m.userData.near || []);
      for (const f of (m.userData.faces || stage.baseFaces[i] || [])) if (!near.has(f)) for (const nf of byOld.get(f) || []) faceList.push(nf);
    }
    else for (const f of (m.userData.faces || stage.baseFaces[i] || [])) for (const nf of byOld.get(f) || []) faceList.push(nf);
    offsets[i + 1] = faceList.length;
  });
  const overlayBin = await deflate(u8(Uint32Array.from([...offsets, ...faceList])));
  // 快照（牆的「照片」）和正面的岩點外框也烘焙好：手機打開牆不用自己渲染一張、投一輪外框
  progress('snapshot');
  const snap = stage.snapshot(), snapBlob = await new Promise((ok, no) => snap.toBlob(b => b ? ok(b) : no(new Error('snapshot')), 'image/jpeg', 0.9));
  const snapBin = new Uint8Array(await snapBlob.arrayBuffer());
  const outlines = stage.outlines().map(h => [h.id, h.poly.flat()]);
  progress('model');
  const src = sourceTexture(glb);
  const out = writeGlb({ ...baked, image: src.image, mime: src.mime, transform: src.transform, extras: { climbio: { format: 'climbio-3d-wall/2', id: doc.id, name: doc.name || '', up: doc.up, holds: holds.filter(h => !h.off).map(h => ({ id: h.id, position: h.position })) } } });
  // 沿牆走的鏡頭（walkcam.js）：軌道、牆面深度、各畫面比例的實拍邊界表都在這裡算好，岩點貓只讀
  progress('camera');
  const walk = await bakeWalk(out, doc), walkBin = new TextEncoder().encode(JSON.stringify(walk));
  const faceBin = await deflate(u8(baked.faceLabels)), labelBin = await deflate(u8(stage.labels));
  const r = stage.rail;
  const json = {
    format: 'climbio-3d-wall/2', id: doc.id, name: doc.name, ...(doc.gym ? { gym: doc.gym } : {}), scene: doc.scene,
    up: doc.up, front: doc.front, reference: doc.reference, license: doc.license, holds,
    model: '', faces: '', holdLabels: { size: doc.holdLabels.size, file: '', overlay: '', holds: work.holds.length },
    snapshot: { file: '', w: stage.snapW, h: stage.snapH, c: [...stage.homePose.position.toArray(), ...stage.homePose.quaternion.toArray()].map(x => +x.toFixed(6)) },
    outlines,
    walk: { file: '' },
    rail: { lo: r.lo, hi: r.hi, hlo: r.hlo, hhi: r.hhi, r: f32(r.r), e: f32(r.e), d: f32(r.d) },
  };
  const [hm, hf, hl, ho, hs, hw] = await Promise.all([hash(out), hash(faceBin), hash(labelBin), hash(overlayBin), hash(snapBin), hash(walkBin)]);
  const names = { model: `wall-${hm}.glb`, faces: `faces-${hf}.bin`, labels: `labels-${hl}.bin`, overlay: `overlay-${ho}.bin`, snapshot: `snapshot-${hs}.jpg`, walk: `walk-${hw}.json` };
  Object.assign(json, { model: names.model, faces: names.faces }); Object.assign(json.holdLabels, { file: names.labels, overlay: names.overlay });
  json.snapshot.file = names.snapshot; json.walk.file = names.walk;
  stage.dispose();
  return {
    files: [{ path: 'wall.json', bytes: new TextEncoder().encode(JSON.stringify(json)) }, { path: names.model, bytes: out }, { path: names.faces, bytes: faceBin }, { path: names.labels, bytes: labelBin }, { path: names.overlay, bytes: overlayBin }, { path: names.snapshot, bytes: snapBin }, { path: names.walk, bytes: walkBin }],
    stats: { tris: baked.index.length / 3, removed: baked.removed, clipped: baked.clipped, glb: out.length },
  };
}

// 修點的外框換成切網格要的：鏡頭位置、多邊形每個頂點的方向（模型座標）、投影；只切修點時看得到的面（applyEdit 的 near）
function outlineCuts(stage) {
  const mw = stage.surface.matrixWorld, inv = mw.clone().invert(), W = stage.snapW, H = stage.snapH, v = new Vector3(), cuts = [];
  stage.overlays.forEach((m, i) => {
    const m3 = m.userData.edited && m.userData.m3;
    if (!m3 || !m3.p || m3.p.length < 3 || stage.gone.has(i)) return;
    const cam = new PerspectiveCamera(50, m3.a || W / H, 0.005, 100);   // stage.js 的 applyEdit 同一個鏡頭
    cam.position.fromArray(m3.c, 0); cam.quaternion.fromArray(m3.c, 3); cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
    const eye = cam.position.clone().applyMatrix4(inv), P = simplify(m3.p, m3.a || W / H);
    const rays = P.map(([x, y]) => new Vector3(x * 2 - 1, 1 - y * 2, 0.5).unproject(cam).applyMatrix4(inv).sub(eye).toArray());   // 照簡化過的外框切、不補平滑曲線（三角形會多好幾倍，iPhone 撐不住）；外圈的平滑在畫光暈時做（Stage.glowMask 的形狀模糊）
    const project = (p) => { v.fromArray(p).applyMatrix4(mw).project(cam); return v.z > -1 && v.z < 1 ? [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H] : null; };
    cuts.push({ idx: i + 1, seq: m.userData.seq || 0, faces: m.userData.near || [], eye: eye.toArray(), rays, poly: P.map(([x, y]) => [x * W, y * H]), project, guests: m.userData.keepOthers ? { has: (l) => !!l && l !== i + 1 } : new Set(m.userData.guestIds || []), keep: !!m.userData.keepOthers });
  });
  // 照修點套用的先後切（applyEdit 後套的蓋過先套的）：兩個修點的範圍重疊時，切出來的跟修點時的一樣，不會變成岩點編號大的贏
  return cuts.sort((a, b) => a.seq - b.seq);
}
// 切網格用的外框：貼顏色邊界的外框很密（幾十個點），每個點都切會讓模型多出好幾倍的面；
// 照外框大小簡化（Douglas–Peucker，偏差不到外框對角線的 1%），標籤（光暈、點選）仍照原本的密外框
function simplify(p, aspect) {
  if (p.length <= 12) return p;
  const xs = p.map(q => q[0] * aspect), ys = p.map(q => q[1]);
  const eps = 0.01 * Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const keep = new Uint8Array(p.length); keep[0] = 1;
  // 閉合外框：從第一點和離它最遠的點分成兩段
  let o = 0, od = -1; for (let i = 1; i < p.length; i++) { const d = Math.hypot(xs[i] - xs[0], ys[i] - ys[0]); if (d > od) { od = d; o = i; } }
  keep[o] = 1;
  const X = [...xs, xs[0]], Y = [...ys, ys[0]];
  const run = (i0, i1) => { let best = -1, at = -1; const ax = X[i0], ay = Y[i0], dx = X[i1] - ax, dy = Y[i1] - ay, l = Math.hypot(dx, dy) || 1e-12;
    for (let i = i0 + 1; i < i1; i++) { const d = Math.abs((X[i] - ax) * dy - (Y[i] - ay) * dx) / l; if (d > best) { best = d; at = i; } }
    if (best > eps) { keep[at % p.length] = 1; run(i0, at); run(at, i1); } };
  run(0, o); run(o, p.length);
  return p.filter((_, i) => keep[i]);
}
// 切好的外框裡面：貼圖上還空著（標籤 0）的像素補成這顆，邊上不留缺口（外面的像素不在這顆的覆蓋網格上，畫不出來）
function paintInside(stage, cut) {
  const L = stage.labels, s = stage.labelSize, U = cut.uvs, I = cut.index;
  for (let f = 0; f < cut.faceLabels.length; f++) {
    const idx = cut.inside[f]; if (!idx || cut.faceLabels[f] !== idx) continue;
    const [a, b, c] = [I[f * 3], I[f * 3 + 1], I[f * 3 + 2]], ua = U[a * 2] * s, va = U[a * 2 + 1] * s, ub = U[b * 2] * s, vb = U[b * 2 + 1] * s, uc = U[c * 2] * s, vc = U[c * 2 + 1] * s;
    const det = (vb - vc) * (ua - uc) + (uc - ub) * (va - vc); if (Math.abs(det) < 1e-9) continue;
    for (let ty = Math.max(0, Math.floor(Math.min(va, vb, vc))); ty <= Math.min(s - 1, Math.ceil(Math.max(va, vb, vc))); ty++)
      for (let tx = Math.max(0, Math.floor(Math.min(ua, ub, uc))); tx <= Math.min(s - 1, Math.ceil(Math.max(ua, ub, uc))); tx++) {
        const px = tx + 0.5, py = ty + 0.5, w0 = ((vb - vc) * (px - uc) + (uc - ub) * (py - vc)) / det, w1 = ((vc - va) * (px - uc) + (ua - uc) * (py - vc)) / det;
        if (w0 < -1e-4 || w1 < -1e-4 || 1 - w0 - w1 < -1e-4) continue;
        const k = ty * s + tx; if (!L[k]) L[k] = idx;
      }
  }
}

// 用烘好的模型算沿牆鏡頭：軌道、牆面深度，每種畫面比例各實拍校正一次（離屏小張渲染，見 WalkCam.calibrate）
async function bakeWalk(glbBytes, doc) {
  const gltf = await parseModel(glbBytes), path = wallPath(meshesOf(gltf), new Vector3(...doc.up).normalize(), new Vector3(...doc.front).normalize());
  const scene = new Scene(); scene.add(gltf.scene);
  const renderer = new WebGLRenderer(); renderer.setPixelRatio(1);
  const cam = new PerspectiveCamera(50, 1, 0.05, 100), tables = [];
  let wc = null;
  try {
    for (const a of WALK_ASPECTS) { wc = new WalkCam(path, cam); wc.resize(Math.round(1000 * a), 1000); tables.push(wc.calibrate(renderer, scene, WALK_MARGIN)); }
  } finally { renderer.dispose(); renderer.forceContextLoss(); }
  return packWalk(wc, tables, introEnd(wc, tables));   // 進定線飛進去停的位置（walk.intro）：每種畫面比例都塞得滿
}


