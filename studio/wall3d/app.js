// Climbio Studio 的 3D 牆：打開 3D 牆的資料包資料夾（3D 重建流程的輸出），精修後按「發佈」烘焙成成品包、放進開放資料集 climbio/walls3d，
// 畫面、操作照岩點貓的定線：深色、正面滿版、浮在畫面上的圓鈕；拖曳平移、滾輪往游標那點縮放、右鍵拖小角度轉（離正面 45° 內）。
// 不分模式：點一下去掉或放回那一塊（點在岩點上是那顆岩點標成不是岩點／還原，點在牆上是那一面牆隱藏／打開，點在切掉的地方是拿掉那條切線）；
// 去掉的淡淡顯示（才點得回來）。長按岩點修外框、長按牆面補一顆（跟岩點貓的修點一樣：記當時的鏡頭＋畫面上的多邊形，
// 存在 wall.json 的 edits，岩點貓載入時套上，見 wall3dkit/stage.js 的 setEdits）。「切直線」畫一條直線切掉一側（加一個裁切平面，畫完回到點選）；每一步都能復原（⌘Z），⌘S 存檔。懸空物在重建流程自動隱藏。存檔只改 wall.json 的 surfaces（hidden、frame.planes）與 holds[].off；模型、貼圖、岩點標籤不動。
// 岩點在不在的規則跟岩點貓同一份（wall3dkit/stage.js）
import { Scene, PerspectiveCamera, WebGLRenderer, MeshBasicMaterial, BufferGeometry, BufferAttribute, Raycaster, Vector2, Vector3, Box3, Color, DoubleSide, SRGBColorSpace, DataTexture, NearestFilter, UnsignedByteType, MeshBVH, acceleratedRaycast } from '../../wall3dkit/vendor/three.js';
import { createPublishUI } from '../publish-ui.js';
import { enabled as backendEnabled } from '../backend.js';
import { publishAnonymous, publishText } from '../publisher.js';
import { openDb } from '../published.js';
import { applyPatch } from './patch.js';
import { YAW_MAX } from '../../wall3dkit/walkcam.js';
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
// 檔案輸入（沒有畫面、只給程式放檔案）：工作檔（wall.json、模型、面標籤，有的話 base-wall.json、thumb.jpg）放進瀏覽器私有檔案系統（OPFS）再打開。
// 資料夾選擇器要使用者真的點，自動化工具（代理）做不到；檔案輸入可以直接放檔案，不用本機網址、不用本機資料夾。
// 可以分幾次放（自動化工具一次有大小上限）：收齊 wall.json 和它指到的模型、面標籤就打開
const given = new Map();
$('files').onchange = async () => {
  try {
    for (const f of $('files').files) given.set(f.name, f);
    $('files').value = '';
    const wall = given.get('wall.json'); if (!wall) return;
    const doc = JSON.parse(await wall.text());
    if (!/^[0-9a-z]{16}$/.test(doc.id || '') || !doc.model || !doc.faces) throw new Error('not a pack');
    if (!given.has(doc.model) || !given.has(doc.faces)) return;
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(`wall3d-${doc.id}`, { create: true });
    for (const f of given.values()) { const w = await (await dir.getFileHandle(f.name, { create: true })).createWritable(); await w.write(f); await w.close(); }
    given.clear();
    await open(dir);
  } catch (e) { given.clear(); gateError(e); }
};
// 從已發佈的版本接著精修：下載基底（原模型、原始岩點與分面）加那一版的 patch，在選的空資料夾重建工作檔。要有 patch（這個機制之後發佈的版本才有）
let srcOut = null;   // 一鍵試用：存檔同時寫回哪裡（本機伺服器的網址，或同步服務的 { url, pid, token }）
async function writeBack(name, text) {
  if (!srcOut) return;
  let r;
  if (typeof srcOut === 'string') r = await fetch(srcOut + name, { method: 'PUT', body: text });
  else if (name === 'feedback3d.json') r = await fetch(srcOut.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Trial': srcOut.token }, body: JSON.stringify({ op: 'feedback', pid: srcOut.pid, text }) });
  else throw new Error(T('w3TrialReadOnly'));   // 手機試用連結只能回報，不能改牆
  if (!r.ok) throw new Error(`${name}：HTTP ${r.status}`);
}
const RESTORE_BASE = 'https://huggingface.co/datasets/climbio/walls3d/resolve/main/walls3d';   // 公開資料集 climbio/walls3d 的固定網址
async function restore(pid, given) {
  const dir = given || await showDirectoryPicker({ mode: 'readwrite', id: 'climbio-wall3d' });
  const b = StudioShell.busy(T('w3Restoring'));
  try {
    const get = async (name, json) => { const r = await fetch(`${RESTORE_BASE}/${pid}/${name}`); if (!r.ok) throw Object.assign(new Error(r.status === 404 ? 'no patch' : `HTTP ${r.status}`), { status: r.status }); return json ? r.json() : new Uint8Array(await r.arrayBuffer()); };
    const patch = await get('patch.json', true), baseBytes = await get('base-wall.json'), doc = JSON.parse(new TextDecoder().decode(baseBytes));
    const files = [['base-wall.json', baseBytes], [doc.model, await get(`base-${doc.model}`)], [doc.faces, await get(`base-${doc.faces}`)]];
    // 工作檔 = 基底加最終決定：隱藏的面、裁切平面、不是岩點、修點（都是完整的最終狀態，不是差異）
    applyPatch(doc, patch);
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
// 一鍵試用 #src=<工作資料夾的網址>&step=try（tools/studio.mjs try3d 在本機開的伺服器）：不用選資料夾，工作檔放進瀏覽器的私有檔案系統（OPFS）打開；
// 存檔（wall.json）和試用的回報（feedback3d.json）同時寫回那個網址（PUT），代理在資料夾裡就讀得到
const srcHash = new URLSearchParams(location.hash.slice(1)), srcBase = srcHash.get('src');
let srcStep = srcHash.get('step');
// 手機也能試用 #sync=<專案 id>&t=<試用權杖>&step=try（&u=<同步服務網址>，沒有就是 Climbio 的）：tools/studio.mjs try3d 在接了同步服務的專案發的連結，
// 檔案從同步服務下載，回報寫回同步服務（代理 pull 就拿到）；權杖只能讀這個專案、寫回回報
const TRIAL_DIR = 'trial';   // 代理先烘好的試用成品（tools/studio.mjs try3d）
const SYNC_DEFAULT = 'https://asia-east1-firebase-climbio.cloudfunctions.net/studioSync';
const syncPid = srcHash.get('sync'), syncToken = srcHash.get('t'), syncUrl = srcHash.get('u') || SYNC_DEFAULT;
async function syncGetter() {
  const head = { 'X-Studio-Trial': syncToken };
  const r = await fetch(syncUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', ...head }, body: JSON.stringify({ op: 'pull', pid: syncPid }) });
  if (!r.ok) throw new Error(r.status === 401 ? T('w3TrialExpired') : `HTTP ${r.status}`);
  const files = (await r.json()).project.files || {};
  const get = async (name, need) => {
    const f = files[name];
    if (!f) { if (need) throw new Error(`${name}：沒有`); return null; }
    const one = async (q, ok404) => {   // 照內容（sha）下載的內容不會變，讓瀏覽器快取；照路徑的不快取
      const url = `${syncUrl}?pid=${syncPid}&${q}`, sha = q.startsWith('sha=');
      const x = await fetch(url, { headers: head, cache: sha ? 'default' : 'no-store' }).catch((e) => { if (!sha) throw e; return fetch(url, { headers: head, cache: 'reload' }); });   // 快取裡是別的網域存的（CORS 不過）：略過快取重抓一次
      if (x.status === 404 && ok404) return null;
      if (!x.ok) throw new Error(`${name}：HTTP ${x.status}`); return new Uint8Array(await x.arrayBuffer());
    };
    if (!f.parts) return (f.sha256 && await one(`sha=${f.sha256}`, true)) || one(`path=${encodeURIComponent(name)}`);   // 早期的檔存在路徑上，照內容找不到再照路徑
    const parts = await Promise.all(f.parts.map(sha => one(`sha=${sha}`)));   // 大檔（模型）分段同時下載再接起來
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };
  return { get, size: (name) => files[name]?.size };   // 大小：手機上已經有同一個檔就不重抓
}
// 檔名帶內容雜湊的檔（model-<12 碼>.glb 這類）：名字一樣、大小一樣就是同一份
const HASHED = /-[0-9a-f]{12}\.\w+$/, KEEP = Symbol('keep');
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 私密瀏覽等存不了：只是下次要重抓 */ } };
if ((srcBase && /^\/[\w./-]*\/$/.test(srcBase)) || (syncPid && /^[0-9a-z]{16}$/.test(syncPid) && syncToken)) (async () => {
  const b = syncPid ? StudioShell.busy(T('w3Restoring')) : null;
  try {
    const src = syncPid ? await syncGetter() : { get: async (name, need) => { const r = await fetch(srcBase + name, { cache: 'no-store' }); if (r.ok) return new Uint8Array(await r.arrayBuffer()); if (need) throw new Error(`${name}：HTTP ${r.status}`); return null; } };
    const root = await navigator.storage.getDirectory(), put = async (d, name, data) => { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); };
    // 上次從這個連結開過的牆（私有檔案系統的資料夾），檔名帶雜湊、大小也對的就不重抓
    const hint = syncPid && lsGet(`w3sync-${syncPid}`), hintDir = /^[0-9a-z]{16}$/.test(hint || '') ? await root.getDirectoryHandle(`wall3d-${hint}`).catch(() => null) : null;
    const have = async (d, name, path) => { const sz = src.size?.(path); if (!d || sz == null || !HASHED.test(name)) return false; try { return (await (await d.getFileHandle(name)).getFile()).size === sz; } catch { return false; } };
    const fetchKeep = async (d, name, path, need) => (await have(d, name, path)) ? KEEP : src.get(path, need);
    // 代理先烘好的試用成品（trial/，照 manifest 的清單；同步服務裡還留著舊版的）：跟 wall.json、工作檔同時下載
    const trialP = (async () => {
      const man = await src.get(`${TRIAL_DIR}/manifest.json`, false).catch(() => null), list = man && JSON.parse(new TextDecoder().decode(man)).files;
      if (!Array.isArray(list) || !list.every(n => /^[\w.-]+$/.test(n))) return null;
      const tdir = hintDir && await hintDir.getDirectoryHandle(TRIAL_DIR).catch(() => null);
      return [['manifest.json', man], ...await Promise.all(list.map(async n => [n, await fetchKeep(tdir, n, `${TRIAL_DIR}/${n}`, true)]))];
    })();
    trialP.catch(() => {});   // 下面 await 時才報錯
    const wall = await src.get('wall.json', true), doc = JSON.parse(new TextDecoder().decode(wall));
    if (!/^[0-9a-z]{16}$/.test(doc.id || '') || !doc.model || !doc.faces) throw new Error('not a pack');
    const dir = await root.getDirectoryHandle(`wall3d-${doc.id}`, { create: true });
    if (syncPid) lsSet(`w3sync-${syncPid}`, doc.id);
    const names = [doc.model, doc.faces, 'review3d.json', 'feedback3d.json', ...ClimbioWall3dReport.FILES.map(n => `${n}-summary.json`)];
    const files = [['wall.json', wall], ...await Promise.all(names.map(async n => [n, await fetchKeep(dir, n, n, n === doc.model || n === doc.faces)]))];
    for (const [name, data] of files) {
      if (data === KEEP) continue;
      if (!data) { await dir.removeEntry(name).catch(() => {}); continue; }   // 資料夾裡沒有的，私有檔案系統裡上次的也拿掉
      await put(dir, name, data);
    }
    const trial = await trialP;
    if (trial) {   // 試用直接打開，不用在手機上烘；上次留下、這一版沒有的檔拿掉
      const tdir = await dir.getDirectoryHandle(TRIAL_DIR, { create: true }), want = new Set(trial.map(([n]) => n));
      const old = []; for await (const n of tdir.keys()) if (!want.has(n)) old.push(n);   // 先列完再刪（邊列邊刪會漏）
      for (const n of old) await tdir.removeEntry(n).catch(() => {});
      for (const [n, data] of trial) {
        if (data === KEEP && hint === doc.id) continue;
        await put(tdir, n, data === KEEP ? await src.get(`${TRIAL_DIR}/${n}`, true) : data);
      }
    } else await dir.removeEntry(TRIAL_DIR, { recursive: true }).catch(() => {});
    srcOut = syncPid ? { url: syncUrl, pid: syncPid, token: syncToken } : srcBase;
    // 下載完還要開模型、掛上試用的牆：下載中一直留到牆出來才關（先關會露出選資料夾的畫面幾秒，像是壞了）
    const shown = srcStep === 'try' ? new Promise(r => { tryShown = r; }) : null;
    await open(dir);
    if (shown) await shown;
    b?.close();
  } catch (e) { b?.close(); tryShown = null; gateError(e); }
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
// 3D 重建流程的量測（四份 *-summary.json，studio/wall3d/report.js）、AI 逐顆檢查的紀錄（review3d.json，review.js）：有才出「報告」步驟
async function measurements(dir) {
  const F = ClimbioWall3dReport.FILES;
  try { const got = await Promise.all(F.map(n => bytes(dir, `${n}-summary.json`))); return Object.fromEntries(F.map((n, i) => [n, JSON.parse(new TextDecoder().decode(got[i]))])); }
  catch (e) { if (e.name === 'NotFoundError') return null; throw e; }
}
measurements.review = async (dir) => { try { return JSON.parse(new TextDecoder().decode(await bytes(dir, 'review3d.json'))); } catch (e) { if (e.name === 'NotFoundError') return null; throw e; } };
// 人試用的回報（feedback3d.json，feedback.js）：沒有就是空的
measurements.feedback = async (dir) => { try { return JSON.parse(new TextDecoder().decode(await bytes(dir, 'feedback3d.json'))); } catch (e) { if (e.name === 'NotFoundError') return ClimbioWall3dFeedback.empty(); throw e; } };

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
  const report = await measurements(dir), review = await measurements.review(dir), fb = await measurements.feedback(dir);
  S = { report, review, fb, lab, dir, doc, faceLabels, faceSurfaces, surface, scene, byHold, tris, framed, cent, base: faceLabels.slice(), edits: new Map((doc.edits || []).map(e => [e.id, e.m3])), added: [] };
  for (const id of S.edits.keys()) if (!doc.holds.some(h => h.id === id)) S.added.push(id);
  reapply();
  S.bySurface = doc.surfaces.list.map(() => []);
  for (let f = 0; f < tris; f++) S.bySurface[faceSurfaces[f]].push(f);
  handles.put(doc.id, dir);
  setupView();
  $('wallName').textContent = doc.name || doc.id;
  $('gate').hidden = true; $('work').hidden = false; $('steps').hidden = false;
  stage = doc.surfaces.frame.planes.length || doc.surfaces.list.some(x => x.hidden) ? 'holds' : 'model';   // 還沒切過先切模型；切過的（含接著精修的公開版本）直接修岩點
  if (srcStep === 'try') { stage = 'try'; srcStep = null; }   // 一鍵試用的連結直接到試用
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
// 從目前鏡頭看 target：第一個打到、沒被藏或切掉的面是不是 faces 裡的（截圖選鏡頭用）
function sees(target, faces) {
  ray.firstHitOnly = false;
  ray.set(camera.position, target.clone().sub(camera.position).normalize());
  const inv = S.surface.matrixWorld.clone().invert(), planes = S.doc.surfaces.frame.planes;
  const h = ray.intersectObject(S.surface, false).find((x) => {
    if (S.doc.surfaces.list[S.faceSurfaces[x.faceIndex]]?.hidden) return false;
    const p = x.point.clone().applyMatrix4(inv).toArray();
    return !planes.some((q) => outside(q, p));
  });
  ray.firstHitOnly = true;
  return !!h && faces.has(h.faceIndex);
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
    // 裝在上面的小岩點（量體上的 chip）留給它自己，規則跟 wall3dkit 的 applyEdit 一樣：別顆的面六成以上在多邊形裡、不到多邊形裡的一半
    const cand = [], tot = new Map(), ins = new Map();
    let insAll = 0;
    for (let f = 0; f < S.tris; f++) {
      w.set(c[f * 3], c[f * 3 + 1], c[f * 3 + 2]).applyMatrix4(mw);
      const q = w.project(cam), x = (q.x + 1) / 2, y = (1 - q.y) / 2;
      if (q.z < -1 || q.z > 1 || x < x0 - 0.03 || x > x1 + 0.03 || y < y0 - 0.03 || y > y1 + 0.03) continue;
      const inP = inside(x, y, poly), l = F[f];
      cand.push(f, inP ? 1 : 0); if (inP) insAll++;
      if (l && l !== idx) { tot.set(l, (tot.get(l) || 0) + 1); if (inP) ins.set(l, (ins.get(l) || 0) + 1); }
    }
    const guest = new Set([...ins].filter(([l, k]) => k >= 0.6 * tot.get(l) && k < 0.5 * insAll).map(([l]) => l));
    for (let k = 0; k < cand.length; k += 2) {
      const f = cand[k];
      w.set(c[f * 3], c[f * 3 + 1], c[f * 3 + 2]).applyMatrix4(mw);
      const dist = dir.subVectors(w, cam.position).length(); look.set(cam.position, dir.normalize());
      const hit = look.intersectObject(S.surface, false)[0];
      if (hit && hit.faceIndex !== f && hit.distance < dist - 0.003) continue;   // 從那個角度被擋住的不動
      if (cand[k + 1]) { if (!guest.has(F[f])) F[f] = idx; } else if (F[f] === idx) F[f] = 0;
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
  if (stage === 'try') { if (k === 'escape') tryPick(null); return; }   // 試用只看、回報，不改（操作在成品舞台上）
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
// 階段：模型（切直線、隱藏牆面）、岩點（精修岩點）、報告（有量測才有）；步驟列跟著換
function setStage(st, first = false) {
  if (edit) return;
  stage = st; sel = null; hot = null; mode = 'pick';
  for (const b of document.querySelectorAll('#toolbar button')) b.hidden = b.dataset.stage !== st;
  setMode('pick'); syncBar(); renderSteps();
  $('report').hidden = st !== 'report';
  $('histbar').hidden = st === 'try'; $('tryList').hidden = st !== 'try'; $('holdInfo').hidden = st === 'try';   // 試用只看、回報，不改；畫面只留牆和這一輪的回報
  tryPick(null);
  if (st === 'try') { renderTry(); tryOpen().catch((e) => { console.error(e); $('saveState').textContent = T('w3SaveFailed', e.message); }).finally(() => { tryShown?.(); tryShown = null; }); } else tryClose();
  if (st === 'report') { const r = ClimbioWall3dReport.build(S.report, T, S.review && ClimbioWall3dReview.status(S.doc, S.review)); ClimbioReportFrame.steps($('rpSteps'), r.steps); ClimbioReportFrame.notes($('rpNotes'), { defn: r.defn }); }
  if (S && !first) { paint(); draw(); }
}
function renderSteps() {
  StudioShell.steps($('steps'), [{ id: 'model', label: T('w3StepModel'), on: stage === 'model' }, { id: 'holds', label: T('w3StepHolds'), on: stage === 'holds' },
    ...(S?.report || S?.review ? [{ id: 'report', label: T('w3StepReport'), on: stage === 'report' }] : []), { id: 'try', label: T('w3StepTry'), on: stage === 'try' }, { id: 'publish', label: T('w3Publish') }],
    id => { if (id === 'publish') openPublish(); else setStage(id); });
  $('steps').querySelector('[data-step="publish"]').id = 'publish';
}

// ---- 試用（發佈前人看過這一版）：跟發佈後在岩點貓定線看到的一樣——工作檔在瀏覽器裡烘成成品（bakePack，跟發佈同一份），
// 用岩點貓同一個舞台（wall3dkit 的 Stage）和沿牆鏡頭：從整面牆飛進牆前，拖曳沿牆走、捏合／滾輪靠近、兩指左右（滑鼠右鍵）調角度，放手彈回。
// 點岩點亮它的光暈，寫一句哪裡不對（feedback3d.json，feedback.js）；點牆上其他地方也能回報（例如漏了一顆）。代理修完再試用；看完沒問題按「試用完」 ----
const Fb = globalThis.ClimbioWall3dFeedback;
let tryAt = null;   // 要回報的地方 { hold：岩點 id（牆上沒有岩點的地方是 null）, point：模型座標, camera：當時的鏡頭 }
let trial = null;   // 烘好的成品舞台 { sig, stage, view, inside }
const TRY_FLY_MS = 1400, tryEase = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - (1 - x) ** 3);
function tryPaint() {
  if (!trial) return;
  const on = !!(tryAt && tryAt.hold);   // 跟岩點貓定線一樣：選了岩點底圖換暗彩，那顆原色加光暈
  trial.stage.paint({ holds: on ? { [tryAt.hold]: 'sel' } : {}, mode: on ? 'dim' : 'photo', colors: { sel: '#D4FF4F' } });
}
function tryPick(at) {
  tryAt = at;
  $('tryBar').hidden = !at;
  if (at) {
    // 只有兩種：點不到想點的那顆（量體上的小點、漏掉的岩點）、外框不對（光暈溢出、缺一塊、兩顆連在一起、不是岩點）；一點就回報
    $('tryChips').replaceChildren(...['cantPick', 'outline'].map((k) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: T('w3Try_' + k) });
      b.onclick = () => sendTry(T('w3Try_' + k), k);
      return b;
    }));
    // 放在點的地方旁邊，不蓋住岩點：避開整顆岩點在畫面上的範圍（下方放不下改上方，都放不下放空間大的那邊、蓋到最少）
    const bar = $('tryBar'), host = $('tryStage'), W = host.clientWidth, H = host.clientHeight;
    bar.style.left = '0px'; bar.style.top = '0px'; bar.style.transform = 'none';
    const bw = bar.offsetWidth, bh = bar.offsetHeight, [x, y] = at.at || [W / 2, H / 2], gap = 12;
    const box = (at.hold && trial && trial.stage.screenBox(at.hold)) || [x - 16, y - 16, x + 16, y + 16];
    const top = 12, bottom = H - 64 - bh, below = box[3] + gap, above = box[1] - gap - bh;
    bar.style.left = `${Math.min(Math.max(x - bw / 2, 12), W - bw - 12)}px`;
    bar.style.top = `${below <= bottom ? below : above >= top ? above : H - box[3] > box[1] ? bottom : top}px`;
  }
  tryPaint();
}
// 這一版的成品舞台：代理先烘好的（工作資料夾的 trial/，tools/studio.mjs try3d 放的，manifest.json 的 sig 對得上這一版）直接打開；
// 沒有或過期才在瀏覽器裡烘（跟發佈同一份成品）；試用、AI 看光暈都用它
async function prebaked(sig) {
  try {
    const d = await S.dir.getDirectoryHandle(TRIAL_DIR), m = JSON.parse(new TextDecoder().decode(await bytes(d, 'manifest.json')));
    if (m.sig !== sig || !Array.isArray(m.files)) return null;
    return new Map(await Promise.all(m.files.map(async n => [n, await bytes(d, n)])));
  } catch { return null; }
}
async function bakeTrial(busy = true) {
  const sig = Fb.sig({ ...S.doc, edits: [...S.edits].map(([id, m3]) => ({ id, m3 })) });
  if (!trial || trial.sig !== sig) {
    if (trial) { trial.stage.dispose(); trial = null; }
    let files = await prebaked(sig);
    if (!files && syncPid) throw new Error(T('w3TrialStale'));   // 試用連結只看代理在電腦上烘好的成品（tools/studio.mjs try3d），不在手機、電腦上現場烘（大模型會吃光記憶體）
    const b = busy && !files ? StudioShell.busy(T('w3TryBaking')) : { close() {} };
    try {
      const { openStageWith } = await import('../../wall3dkit/stage.js');
      if (!files) {
        const { bakePack } = await import('../../wall3dkit/bakepack.js');
        const [glb, faces] = await Promise.all([bytes(S.dir, S.doc.model), bytes(S.dir, S.doc.faces)]);
        const doc = { ...S.doc, ...(S.edits.size ? { edits: [...S.edits].map(([id, m3]) => ({ id, m3 })) } : {}) };
        files = new Map((await bakePack({ doc, glb, faces })).files.map(f => [f.path, f.bytes]));
      }
      const pack = JSON.parse(new TextDecoder().decode(files.get('wall.json')));
      const stage = await openStageWith(pack, async (path, json) => { const x = files.get(path); if (!x) throw new Error(path); return json ? JSON.parse(new TextDecoder().decode(x)) : x; });
      trial = { sig, stage, files, view: null, inside: null };
    } finally { b.close(); }
  }
  return trial;
}
// 代理先烘好試用的成品（tools/studio.mjs try3d）：{ sig, files: { 路徑: base64 } }
async function trialPack() {
  const t = await bakeTrial(false), b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
  return { sig: t.sig, files: Object.fromEntries([...t.files].map(([n, x]) => [n, b64(x)])) };
}
// 進試用：掛上成品舞台、從整面牆飛進牆前。tryShown：試用連結進來時，牆出來了通知關掉「下載中」
let tryShown = null;
async function tryOpen() {
  await bakeTrial();
  if (stage !== 'try') return;
  const host = $('tryStage'), st = trial.stage;
  host.hidden = false; st.mount(host);
  const W = host.clientWidth, H = host.clientHeight, bw = Math.min(W, H * st.snapW / st.snapH);
  trial.view = { s: 1, tx: (W - bw) / 2, ty: (H - bw * st.snapH / st.snapW) / 2, bw };
  st.glide = null; st.setView(trial.view); tryPaint(); tryShown?.(); tryShown = null;
  if (!st.along) return;
  const t0 = performance.now();
  const v1 = await st.flyIn({ ...trial.view }, () => tryEase((performance.now() - t0) / TRY_FLY_MS), null).catch(() => null);
  if (v1) { trial.view = { ...trial.view, ...v1 }; st.setView(trial.view); trial.inside = { ...v1 }; Object.assign(st.glide || (st.glide = {}), { s: v1.s, tx: v1.tx, ty: v1.ty }); }
}
function tryClose() { if (trial) trial.stage.unmount(); $('tryStage').hidden = true; }
// 手勢換成 2D 視角的變化，再換成沿牆走（岩點貓 js/wall3d.js 的 walk 同一套：手指按著的牆跟著手指，走到盡頭退回上一個）
function tryWalk(at = null) {
  const st = trial && trial.stage; if (!st) return;
  const n = st.walk(trial.view, at);
  if (n === false) { if (trial.inside) trial.view = { ...trial.view, ...trial.inside }; }
  else if (n) trial.view = { ...trial.view, ...n };
  trial.inside = { s: trial.view.s, tx: trial.view.tx, ty: trial.view.ty };
  if (st.glide) Object.assign(st.glide, trial.inside);
  st.setView(trial.view);
}
(() => {
  const host = $('tryStage'), pts = new Map();
  let start = null, moved = false, angle = false, last = null;
  const xy = (e) => { const r = host.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  host.addEventListener('contextmenu', e => e.preventDefault());
  host.addEventListener('pointerdown', (e) => {
    if (!trial) return;
    host.setPointerCapture(e.pointerId); pts.set(e.pointerId, xy(e));
    if (pts.size === 1) { start = { at: xy(e), t: performance.now() }; moved = false; angle = e.button === 2; }
    last = [...pts.values()].map(p => [...p]);
  });
  host.addEventListener('pointermove', (e) => {
    if (!trial || !pts.has(e.pointerId)) return;
    pts.set(e.pointerId, xy(e));
    const now = [...pts.values()], v = trial.view, st = trial.stage;
    if (start && Math.hypot(now[0][0] - start.at[0], now[0][1] - start.at[1]) > 6) moved = true;
    if (!moved || !last || last.length !== now.length) { last = now.map(p => [...p]); return; }
    if (now.length === 1) {
      const dx = now[0][0] - last[0][0], dy = now[0][1] - last[0][1];
      if (angle) st.angle(dx); else { v.tx += dx; v.ty += dy; tryWalk(now[0]); }
    } else {
      const d0 = Math.hypot(last[1][0] - last[0][0], last[1][1] - last[0][1]), d1 = Math.hypot(now[1][0] - now[0][0], now[1][1] - now[0][1]);
      const m0 = [(last[0][0] + last[1][0]) / 2, (last[0][1] + last[1][1]) / 2], m1 = [(now[0][0] + now[1][0]) / 2, (now[0][1] + now[1][1]) / 2], k = d1 / Math.max(d0, 1);
      if (Math.abs(Math.log(k)) < 0.004 && Math.abs(m1[0] - m0[0]) > Math.abs(m1[1] - m0[1])) { angle = true; st.angle(m1[0] - m0[0]); }   // 兩指同向左右：調角度
      else { v.tx = m1[0] - (m0[0] - v.tx) * k; v.ty = m1[1] - (m0[1] - v.ty) * k; v.s *= k; tryWalk(m1); }
    }
    last = now.map(p => [...p]);
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId); last = [...pts.values()].map(p => [...p]);
    if (pts.size) return;
    const st = trial && trial.stage;
    if (st && angle) st.settle();   // 偷看放手：彈回軌道
    if (st && st.wc && st.wc.coarse) { st.wc.coarse = false; st.wc.clamp(); tryWalk(); }
    if (st && start && !moved && performance.now() - start.t < 500 && e.type === 'pointerup') tryTap(...start.at);
    start = null; angle = false;
  };
  host.addEventListener('pointerup', up); host.addEventListener('pointercancel', up);
  host.addEventListener('wheel', (e) => {
    if (!trial) return;
    e.preventDefault();
    const at = xy(e), v = trial.view, k = Math.exp(-e.deltaY * 0.002);
    v.tx = at[0] - (at[0] - v.tx) * k; v.ty = at[1] - (at[1] - v.ty) * k; v.s *= k; tryWalk(at);
  }, { passive: false });
})();
// 點一下：點到岩點就是回報那顆（亮光暈），點到牆上其他地方記那一點
function tryTap(x, y) {
  const st = trial.stage, r5 = v => +v.toFixed(5), id = st.pick(x, y);
  st.aimRay(trial.view, x, y); const h = st.firstHit();
  if (!id && !h) { tryPick(null); return; }
  const cam = st.camera;
  tryPick({ at: [x, y], hold: id || null, point: h ? h.point.toArray().map(r5) : null, camera: [...cam.position.toArray(), ...cam.quaternion.toArray()].map(r5), aspect: r5(cam.aspect) });
}
async function saveFb() {
  const w = await (await S.dir.getFileHandle('feedback3d.json', { create: true })).createWritable();
  await w.write(JSON.stringify(S.fb, null, 1)); await w.close();
  await writeBack('feedback3d.json', JSON.stringify(S.fb, null, 1));
}
async function sendTry(text, kind) {
  if (!text || !tryAt) return;
  S.fb = Fb.add(S.fb, { ...(tryAt.hold ? { hold: tryAt.hold } : {}), kind, point: tryAt.point, camera: tryAt.camera, aspect: tryAt.aspect, text });
  try { await saveFb(); $('saveState').textContent = T('w3TrySaved'); } catch (e) { $('saveState').textContent = T('w3SaveFailed', e.message); }
  tryPick(null); renderTry();
}
$('tryDone').onclick = async () => {
  try {
    if (dirty) { await saveDoc(); $('save').disabled = true; }   // 試用的是存好的這一版
    S.fb = Fb.markTried(S.fb, S.doc); await saveFb(); $('saveState').textContent = T('w3Tried');
  } catch (e) { $('saveState').textContent = T('w3SaveFailed', e.message); }
  renderTry();
};
// 回報清單：平常收成右上一個「回報 N」，點開才列（不擋牆）；點一筆回到那顆，還沒處理的可以收回
let tryListOpen = false;
function renderTry() {
  const st = Fb.status(S.doc, S.fb), list = $('tryList');
  $('tryDone').textContent = T(st.tried ? 'w3TriedAlready' : 'w3TryDone');
  $('tryDone').disabled = st.tried || st.open.length > 0;
  list.replaceChildren();
  if (!st.open.length) { tryListOpen = false; return; }
  const head = Object.assign(document.createElement('button'), { type: 'button', className: 'tryHead', textContent: T('w3TryCount', st.open.length) });
  head.setAttribute('aria-expanded', String(tryListOpen));
  head.onclick = () => { tryListOpen = !tryListOpen; renderTry(); };
  list.append(head);
  if (!tryListOpen) return;
  for (const it of st.open) {
    const row = document.createElement('div'); row.className = 'tryItem';
    const go = Object.assign(document.createElement('button'), { type: 'button', className: 'tryGo', textContent: it.text });
    go.onclick = () => {   // 回到那顆：沿牆鏡頭走到框住它的位置，亮它的光暈
      if (!trial || !it.hold) return;
      tryListOpen = false; renderTry();
      tryAt = { hold: it.hold }; tryPaint();
      trial.stage.frameTo([it.hold]).then((v) => { if (v) { trial.view = { ...trial.view, ...v }; trial.inside = { ...v }; if (trial.stage.glide) Object.assign(trial.stage.glide, v); trial.stage.setView(trial.view); } });
    };
    const del = Object.assign(document.createElement('button'), { type: 'button', className: 'tryDel', textContent: T('w3TryRemove') });
    del.onclick = async () => { S.fb.items = S.fb.items.filter(x => x.id !== it.id); await saveFb().catch(() => {}); renderTry(); };
    row.append(go, del);
    list.append(row);
  }
}

// ---- 存檔：只寫回 wall.json ----
async function saveDoc() {
  if (S.edits.size) S.doc.edits = [...S.edits].map(([id, m3]) => ({ id, m3 })); else delete S.doc.edits;
  const w = await (await S.dir.getFileHandle('wall.json')).createWritable();
  await w.write(JSON.stringify(S.doc)); await w.close();
  await writeBack('wall.json', JSON.stringify(S.doc));
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
    pubUI.set({ link: `${location.origin.replace(/^http:\/\/(127\.0\.0\.1|localhost).*/, 'https://climbio.app')}/hold/?m3d=${id}`, summary: null, message: T('w3Published', res.version), go: { hidden: true } });
  },
});
function openPublish() {
  if (!S) return;
  gymInput.value = S.doc.gym || '';
  pubUI.set({ message: backendEnabled ? '' : T('stPubOff'), summary: { intro: T('w3PubIntro'), items: [T('w3PubItemModel'), T('w3PubItemBase'), T('w3PubItemLicense')] }, go: { text: T('w3Publish'), hidden: false, disabled: !backendEnabled } });
  pubUI.open();
}
// 步驟列（跟 Wall 同一種）：牆面回 Wall、岩點是這一頁、發佈打開發佈對話框
addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });


// 鏡頭對著一顆岩點（faces：這顆的面）：從它的正面（偏回牆的正面一點）看；轉角、側牆、量體下的岩點那個方向會被別的牆面擋住，
// 依序改試它自己的法線、牆的正面、再靠近一點，取第一個看得到這顆的；都看不到照第一個。動的是 Studio 的 camera
function aimHold(faces) {
  const P = S.surface.geometry.attributes.position, mw = S.surface.matrixWorld, v = new Vector3(), a = new Vector3(), b = new Vector3(), n = new Vector3(), box = new Box3();
  for (const f of faces) {
    const p0 = v.fromBufferAttribute(P, f * 3).applyMatrix4(mw).clone(), p1 = a.fromBufferAttribute(P, f * 3 + 1).applyMatrix4(mw).clone(), p2 = b.fromBufferAttribute(P, f * 3 + 2).applyMatrix4(mw).clone();
    box.expandByPoint(p0).expandByPoint(p1).expandByPoint(p2);
    n.add(p1.sub(p0).cross(p2.sub(p0)));   // 面積加權的法線
  }
  const center = box.getCenter(new Vector3()), r = Math.max(box.getSize(new Vector3()).length() / 2, 0.04), dist = (r * 1.7) / Math.tan(Math.PI * 25 / 180);
  camera.aspect = 1; camera.updateProjectionMatrix();
  // 從這顆的正面（偏回牆的正面一點）看；轉角、側牆、量體下的岩點那個方向會被別的牆面擋住，
  // 依序改試它自己的法線、牆的正面、再靠近一點，取第一個看得到這顆的
  const own = n.lengthSq() ? n.clone().normalize() : facing.clone();
  if (own.dot(facing) < 0) own.negate();   // 模型的三角面繞向不一定朝外：轉到朝鏡頭那一側
  const dirs = [own.clone().lerp(facing, 0.3).normalize(), own, facing];
  const mine = new Set(faces), place = (d, k) => { camera.position.copy(center).addScaledVector(d, dist * k); camera.up.copy(up); camera.lookAt(center); camera.updateMatrixWorld(true); };
  let found = false;
  for (const k of [1, 0.6, 0.35]) {
    for (const d of dirs) {
      if (d.dot(own) < -0.1) continue;   // 從背面看不到
      place(d, k); if (sees(center, mine)) { found = true; break; }
    }
    if (found) break;
  }
  if (!found) place(dirs[0], 1);
  return found;
}
// ---- AI 看圖（tools/studio.mjs look3d 用無畫面瀏覽器呼叫）：一顆一張，左邊原樣、右邊畫上外框，從這顆的正面看。
// 鏡頭記下來：AI 在右半張重描的多邊形照這個鏡頭變成修點（edits 的 m3），跟人在這頁修外框是同一種資料 ----
async function shots(ids, size = 256) {
  const all = [...S.doc.holds.map(h => h.id), ...S.added], out = [];
  const tile = Object.assign(document.createElement('canvas'), { width: size * 2, height: size }), g = tile.getContext('2d');
  renderer.setSize(size, size, false); camera.aspect = 1; camera.updateProjectionMatrix();
  const saved = { p: camera.position.clone(), q: camera.quaternion.clone() }, hotWas = S.lab.uniforms.studioHot.value;
  try {
    for (const id of ids) {
      const i = all.indexOf(id), faces = i < 0 ? [] : S.byHold[i], m3 = S.edits.get(id);
      if (m3) {
        // 修過、補畫的：用修的那個鏡頭看，邊線就是那個多邊形（成品照貼圖像素、從這個鏡頭看得到又在多邊形裡的算這顆，跟畫出來的一樣）
        camera.position.fromArray(m3.c, 0); camera.quaternion.fromArray(m3.c, 3); camera.aspect = m3.a || 1; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
      } else {
        if (!faces.length) { out.push({ id, empty: true }); continue; }
        aimHold(faces);
      }
      S.lab.uniforms.studioHot.value = 0; renderer.render(S.scene, camera); g.drawImage(renderer.domElement, 0, 0, size, size);
      if (!m3) {
        // 右邊：原樣的畫面加上這顆實際範圍的邊線（上色跟沒上色的兩張比出範圍，邊界是貼圖像素），岩點本身不被蓋住，偏移、溢出看得出來
        g.drawImage(renderer.domElement, size, 0, size, size);
        const plain = g.getImageData(0, 0, size, size).data;
        S.lab.uniforms.studioHot.value = i + 1; renderer.render(S.scene, camera); g.drawImage(renderer.domElement, size, 0, size, size);
        const lit = g.getImageData(size, 0, size, size), d = lit.data, mask = new Uint8Array(size * size);
        for (let p = 0; p < size * size; p++) mask[p] = Math.abs(d[p * 4] - plain[p * 4]) + Math.abs(d[p * 4 + 1] - plain[p * 4 + 1]) + Math.abs(d[p * 4 + 2] - plain[p * 4 + 2]) > 30 ? 1 : 0;
        d.set(plain);
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          const p = y * size + x;
          if (!mask[p] || (x > 0 && mask[p - 1] && x < size - 1 && mask[p + 1] && y > 0 && mask[p - size] && y < size - 1 && mask[p + size])) continue;
          for (const q of [p, p + 1, p + size]) if (q < size * size) { d[q * 4] = 212; d[q * 4 + 1] = 255; d[q * 4 + 2] = 79; }   // 邊線兩像素寬
        }
        g.putImageData(lit, size, 0);
      } else {
        g.drawImage(renderer.domElement, size, 0, size, size);
        g.save(); g.beginPath(); g.rect(size, 0, size, size); g.clip(); g.beginPath(); m3.p.forEach(([x, y], k) => (k ? g.lineTo(size + x * size, y * size) : g.moveTo(size + x * size, y * size))); g.closePath();
        g.lineWidth = 2; g.strokeStyle = '#D4FF4F'; g.stroke(); g.restore();
      }
      const r5 = x => +x.toFixed(5);
      out.push({ id, c: [...camera.position.toArray(), ...camera.quaternion.toArray()].map(r5), a: camera.aspect, jpg: tile.toDataURL('image/jpeg', 0.85) });
    }
  } finally { camera.position.copy(saved.p); camera.quaternion.copy(saved.q); camera.up.copy(up); S.lab.uniforms.studioHot.value = hotWas; draw(); }
  return out;
}
// 人試用回報的畫面（look3d 給代理看）：照回報時的鏡頭，回報的岩點上色、點的位置畫圈
async function trialShots(items, size = 512) {
  const all = [...S.doc.holds.map(h => h.id), ...S.added], out = [], mw = S.surface.matrixWorld;
  const c = Object.assign(document.createElement('canvas'), { width: size, height: size }), g = c.getContext('2d');
  renderer.setSize(size, size, false);
  const saved = { p: camera.position.clone(), q: camera.quaternion.clone(), a: camera.aspect }, hotWas = S.lab.uniforms.studioHot.value;
  try {
    for (const it of items) {
      camera.position.fromArray(it.camera, 0); camera.quaternion.fromArray(it.camera, 3); camera.aspect = 1; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
      const i = it.hold ? all.indexOf(it.hold) : -1;
      S.lab.uniforms.studioHot.value = i >= 0 ? i + 1 : 0; renderer.render(S.scene, camera); g.drawImage(renderer.domElement, 0, 0, size, size);
      if (it.point) {   // 成品跟工作檔是同一套模型座標（烘焙只切三角形）
        const q = new Vector3(...it.point).applyMatrix4(mw).project(camera);
        g.beginPath(); g.arc((q.x + 1) / 2 * size, (1 - q.y) / 2 * size, size / 20, 0, Math.PI * 2); g.lineWidth = 3; g.strokeStyle = '#FF5C5C'; g.stroke();
      }
      out.push({ id: it.id, jpg: c.toDataURL('image/jpeg', 0.85) });
    }
  } finally { camera.position.copy(saved.p); camera.quaternion.copy(saved.q); camera.aspect = saved.a; camera.updateProjectionMatrix(); S.lab.uniforms.studioHot.value = hotWas; draw(); }
  return out;
}
// AI 看光暈（tools/studio.mjs look3d --glow）：跟岩點貓點選後看到的一樣——烘好的成品、沿牆鏡頭走到框住這顆的位置（看線同一個 frameTo），
// 左邊原樣、右邊點選後（底圖灰階、這顆原色加光暈）。鏡頭記下來：AI 在右半張重描的多邊形照這個鏡頭變成修點
// wide：量體看全形——鏡頭退遠一點（1.2 倍）、裁大一點（亮的範圍三倍、至少畫面的四分之一），只亮到一部分的量體也看得到整個外形，照直線邊描完整
async function glowShots(ids, size = 320, wide = false) {
  const t = await bakeTrial(false), st = t.stage, out = [], R = 960;   // 用 960 渲染，再裁出這顆附近放大（沿牆鏡頭框住一顆時還是退得比較遠）
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:0;top:0;width:${R}px;height:${R}px;z-index:-1`;
  document.body.append(host); st.mount(host);
  const tile = Object.assign(document.createElement('canvas'), { width: size * 2, height: size }), g = tile.getContext('2d');
  const grab = () => { const c = Object.assign(document.createElement('canvas'), { width: R, height: R }), x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(st.renderer.domElement, 0, 0, R, R); return c; };
  const bw = Math.min(R, R * st.snapW / st.snapH), view = { s: 1, tx: (R - bw) / 2, ty: (R - bw * st.snapH / st.snapW) / 2, bw };
  try {
    st.renderer.setPixelRatio(1); st.glide = null; st.setView(view); st.walk(view);   // 站上沿牆鏡頭（frameTo 要從軌道上出發）
    const shoot = (holds, mode) => { st.paint({ holds, mode, colors: { sel: '#D4FF4F' } }); st.draw(); return grab(); };
    // 備用鏡頭（沿牆鏡頭怎麼轉都看不到）：不經過沿牆鏡頭，直接照 st.camera 畫（光暈的後製跟 draw 一樣）
    const fixed = (holds, mode) => {
      st.paint({ holds, mode, colors: { sel: '#D4FF4F' } });
      const r = st.renderer, route = Object.keys(holds).length > 0;
      if (route) st.glowMask(); r.setRenderTarget(null); r.render(st.scene, st.camera); if (route) st.glowComposite();
      return grab();
    };
    const all = [...S.doc.holds.map(h => h.id), ...S.added], saved = { p: camera.position.clone(), q: camera.quaternion.clone() };
    // 每顆都從同一個起點走過去：接著上一顆的位置走，結果會跟著順序變（轉角、cave 附近會停在斜看的地方）
    const home = st.wc && { s: st.wc.s, v: st.wc.v, d: st.wc.d, want: st.wc.want, yaw: st.wc.yaw };
    for (const id of ids) {
      if (home) { Object.assign(st.wc, home); st.wc.clamp(); st.wc.apply(); }
      const v = await st.frameTo([id], null, 1);
      if (!v) { out.push({ id, empty: true }); continue; }
      if (wide && st.wc) { st.wc.d *= 1.2; st.wc.clamp(); st.wc.apply(); }
      // 光暈亮起的範圍（有沒有選這顆的差）→ 這顆在畫面上的位置
      const lighted = (draw = shoot) => {
        const base = draw({}, 'dim'), lit = draw({ [id]: 'sel' }, 'dim');
        const a = base.getContext('2d').getImageData(0, 0, R, R).data, b = lit.getContext('2d').getImageData(0, 0, R, R).data;
        let x0 = R, y0 = R, x1 = -1, y1 = -1;
        for (let p = 0; p < R * R; p++) if (Math.abs(a[p * 4] - b[p * 4]) + Math.abs(a[p * 4 + 1] - b[p * 4 + 1]) + Math.abs(a[p * 4 + 2] - b[p * 4 + 2]) > 30) { const x = p % R, y = (p / R) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        return x1 < 0 ? null : { lit, box: [x0, y0, x1, y1] };
      };
      // 側牆、量體後面的岩點：沿牆鏡頭正面看不到，使用者會調角度（±30°）看——照樣轉過去拍
      let got = lighted();
      for (const k of [1, -1, 0.5, -0.5]) { if (got || !st.wc) break; st.wc.yaw = k * YAW_MAX; st.wc.clamp(); st.wc.apply(); got = lighted(); }
      let photo = shoot({}, 'photo'), via = 'walk';
      // 不在這裡把角度轉回 0：下面記的鏡頭要是拍這張圖的那一個（轉過角度才看得到的，AI 在圖上描的線才會落在對的地方）；下一顆從 home 重新出發
      if (!got) {
        // 岩點貓的沿牆鏡頭看不到這顆（記成 via: 'front'，發佈後點不到，要另外處理）：從它的正面、避開遮擋看，光暈照樣檢查
        const i = all.indexOf(id), faces = i < 0 ? [] : S.byHold[i];
        if (faces.length) {
          aimHold(faces); st.camera.position.copy(camera.position); st.camera.quaternion.copy(camera.quaternion);
          st.camera.aspect = 1; st.camera.updateProjectionMatrix(); st.camera.updateMatrixWorld(true);
          got = lighted(fixed); photo = fixed({}, 'photo'); via = 'front';
        }
      }
      if (!got) { out.push({ id, empty: true }); continue; }   // 怎麼看都看不到這顆
      const { lit, box: [x0, y0, x1, y1] } = got;
      const side = Math.min(R, wide ? Math.max(R * 0.25, (Math.max(x1 - x0, y1 - y0) + 1) * 3) : Math.max(96, (Math.max(x1 - x0, y1 - y0) + 1) * 2)), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const sx = Math.min(Math.max(cx - side / 2, 0), R - side), sy = Math.min(Math.max(cy - side / 2, 0), R - side);
      g.drawImage(photo, sx, sy, side, side, 0, 0, size, size); g.drawImage(lit, sx, sy, side, side, size, 0, size, size);
      const r5 = x => +x.toFixed(5), cam = st.camera;
      // 沿牆鏡頭的投影另有裁切（setViewOffset）、長寬比是快照的：修點只記位置、方向，套用時是 50°、正方形、沒裁切的鏡頭。
      // 同一個位置換投影是畫面上的線性換算：std = [sx, ox, sy, oy]，標準鏡頭的 NDC = (sx·x + ox, sy·y + oy)
      cam.updateMatrixWorld(true);
      const std = new PerspectiveCamera(50, 1, 0.005, 100); std.position.copy(cam.position); std.quaternion.copy(cam.quaternion); std.updateMatrixWorld(true); std.updateProjectionMatrix();
      const [q0, q1] = [[-1, -1], [1, 1]].map(([x, y]) => new Vector3(x, y, 0.5).unproject(cam).project(std));
      const sxk = (q1.x - q0.x) / 2, syk = (q1.y - q0.y) / 2, map = [sxk, q0.x + sxk, syk, q0.y + syk].map(r5);
      // 裁切的範圍記成視窗：AI 在右半張描的多邊形換回整個畫面的比例，再換到標準鏡頭（review3d），跟這個位置一起變成修點
      out.push({ id, via, c: [...cam.position.toArray(), ...cam.quaternion.toArray()].map(r5), a: 1, std: map, crop: [sx / R, sy / R, side / R].map(r5), jpg: tile.toDataURL('image/jpeg', 0.85) });
    }
    camera.position.copy(saved.p); camera.quaternion.copy(saved.q); camera.updateMatrixWorld(true);
  } finally { st.unmount(); host.remove(); }
  return out;
}
// AI 檢查的前兩階段（tools/studio.mjs check3d）：烘好的成品，岩點之前先看牆。
// model：整面牆從正面、低處、左前、右前看，再沿牆腳、牆頂各拍幾張近看——模型完整嗎、上下左右的切口是不是直線、有沒有切太貼岩點、牆腳有沒有糊掉的貼圖。
// path：岩點貓的沿牆鏡頭（直的手機畫面）由右走到左，最遠和中間兩個距離、平視和低頭看下半部各一排——每面牆（內角兩側、cave）的下半部都看得清楚、不會對著牆外。
// 回傳 [{ name, jpg }]，path 另回最遠距離點不到的岩點數
async function checkShots(kind, size = 480) {
  const t = await bakeTrial(false), st = t.stage, out = [];
  const W = kind === 'path' ? 390 : size * 1.5, H = kind === 'path' ? 664 : size;
  const host = document.createElement('div'); host.style.cssText = `position:fixed;left:0;top:0;width:${W}px;height:${H}px;z-index:-1`;
  document.body.append(host); st.mount(host);
  const snap = (name) => { const c = Object.assign(document.createElement('canvas'), { width: W, height: H }); c.getContext('2d').drawImage(st.renderer.domElement, 0, 0, W, H); out.push({ name, jpg: c.toDataURL('image/jpeg', 0.85) }); };
  const render = (cam) => { st.paint({ holds: {}, mode: 'photo' }); st.renderer.setRenderTarget(null); st.renderer.render(st.scene, cam || st.camera); };
  try {
    st.renderer.setPixelRatio(1); st.renderer.setSize(W, H);
    if (kind === 'model') {
      const P = st.holdPos, c = new Vector3(), up = new Vector3(...st.pack.up).normalize(), fr = new Vector3(...st.pack.front).normalize().projectOnPlane(up).normalize(), rt = new Vector3().crossVectors(up, fr).normalize();   // 面對牆時的右手邊
      for (const p of P) c.add(p); c.multiplyScalar(1 / P.length);
      const xs = P.map(p => p.clone().sub(c).dot(rt)), hs = P.map(p => p.clone().sub(c).dot(up)), x0 = Math.min(...xs), x1 = Math.max(...xs), h0 = Math.min(...hs), h1 = Math.max(...hs), span = Math.max(x1 - x0, h1 - h0);
      const cam = new PerspectiveCamera(50, W / H, 0.01, 100);
      const at = (name, x, h, d, lx = x, lh = h, side = 0) => {
        cam.position.copy(c).addScaledVector(rt, x).addScaledVector(up, h).addScaledVector(fr, d).addScaledVector(rt, side);
        cam.up.copy(up); cam.lookAt(c.clone().addScaledVector(rt, lx).addScaledVector(up, lh)); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true); render(cam); snap(name);
      };
      at('整面・正面', 0, 0, span * 1.05); at('整面・低處往上', 0, h0 - 0.3, span * 0.8, 0, 0);
      at('整面・左前', 0, 0, span * 0.75, 0, 0, -span * 0.55); at('整面・右前', 0, 0, span * 0.75, 0, 0, span * 0.55);
      for (let k = 0; k < 4; k++) { const x = x0 + (x1 - x0) * (k + 0.5) / 4; at(`牆腳 ${k + 1}/4`, x, h0 + 0.2, 1.6, x, h0 - 0.1); }
      for (let k = 0; k < 4; k++) { const x = x0 + (x1 - x0) * (k + 0.5) / 4; at(`牆頂 ${k + 1}/4`, x, h1 - 0.3, 1.6, x, h1 + 0.1); }
      at('左端', x0 + 0.3, 0, 1.8, x0 - 0.2, 0); at('右端', x1 - 0.3, 0, 1.8, x1 + 0.2, 0);
      return { shots: out };
    }
    // 沿牆鏡頭（岩點貓同一套）：直的手機畫面
    const bw = Math.min(W, H * st.snapW / st.snapH), view = { s: 1, tx: (W - bw) / 2, ty: (H - bw * st.snapH / st.snapW) / 2, bw };
    st.glide = null; st.setView(view); st.introNext = true; st.walkAlong(view);
    const wc = st.wc; if (!wc) return { shots: out };
    const dMax = wc.dMax, far = [1, 0.7, 0.45].map(k => new Set(wc.missedHolds(Math.max(wc.dMin, dMax * k)))), missed = [...far[0]].filter(P => far.every(S => S.has(P))).length, N = 8;   // 點不到：最遠、七成、四成五的距離都點不到（捏合靠近就點得到的不算）
    for (const [dk, dName] of [[1, '最遠'], [0.6, '中間']]) {
      wc.d = dMax * dk; wc.clamp(); wc.want = wc.d; const [A, B] = wc.sRange();
      for (const [vName, vf] of [['平視', () => wc.eye ?? wc.v0], ['看下半部', () => wc.floor !== undefined ? (wc.floor + wc.eye) / 2 - 0.2 : wc.v0 - 0.5]]) {
        for (let i = 0; i < N; i++) {
          wc.s = B + (A - B) * i / (N - 1); wc.v = vf(); wc.yaw = 0; wc.clamp(); wc.apply();
          const cam = st.camera; cam.clearViewOffset(); cam.aspect = W / H; cam.near = 0.005; cam.far = 100; cam.updateProjectionMatrix(); st.renderer.setSize(W, H); render(); snap(`${dName}・${vName}・由右往左 ${i + 1}/${N}`);   // 照沿牆鏡頭自己的視角（直的手機畫面），不用 2D 畫面留下的投影裁切
        }
      }
    }
    return { shots: out, missed, dMax };
  } finally { st.unmount(); host.remove(); }
}
// 烘好的成品舞台（命令列、量測用）
const trialStage = async () => (await bakeTrial(false)).stage;
export { open, cut, shots, trialShots, glowShots, checkShots, trialStage, trialPack };
export const current = () => S;
export const view = () => ({ camera, target });
export const editing = () => edit;
