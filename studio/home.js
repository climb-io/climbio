// Climbio Studio 的首頁：Studio 是給 AI 代理做事、人來確認的工作台，所以沒有給人手動新增的入口；首頁教人「交給 AI」（設定代理、交代任務、打開它做好的專案確認），加上最近的專案。
// 匯入的程式還在、只是人看不到入口：代理的工具在背景用隱藏的 #addInput（tools/guidebook.mjs 收原生的包）與 #import=<網址>（岩場站、Google 相簿）；
// 內容依種類交給岩館、岩場、路線書、3D 牆，照片先快速掃描、猜工作區。專案建在工作區頁面：這裡把資料夾、檔案和選項放進收件匣（store.js），轉到工作區接手。
// 專案存在這台電腦（或自己選的資料夾），要換電腦用匯出 ZIP。要人判斷的題目由代理在 AI 對話裡問，首頁不列。
import { classifyImageData, groupPhotos, STATUS_LABEL } from './classify.js';
import { WS, OPEN, suggestWs } from './intake/workspaces.js';
import { located } from './crag/geo.js';
const { photo: Photo, ui: UI } = globalThis.AppKit;
const T = globalThis.AppKit.i18n.t;
globalThis.AppKit.i18n.apply();   // index.html 的 data-i18n
const SS = globalThis.StudioStore, inbox = SS.inbox;
const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const toast = (t) => UI.toast(t, { ms: 4000 });
const IMG = /\.(jpe?g|png|webp|hei[cf])$/i, TABLE = /\.(csv|tsv|txt)$/i;
const machine = (n) => /^[0-9a-f]{8}-[0-9a-f]{4}-|^(img|dsc|dscn|pxl|p)[_-]?\d{3,}/i.test(n || '');

async function withZips(items) {
  const out = [];
  for (const it of items) {
    if (!/\.zip$/i.test(it.file.name)) { out.push(it); continue; }
    try {
      out.push(...(await AppKit.files.unzip(it.file)).map(x => {
        const p = x.name.split('/'), name = p.pop();
        return { dir: p.pop() || '', file: new File([x.blob], name, { type: IMG.test(name) ? 'image/' + (/png$/i.test(name) ? 'png' : /webp$/i.test(name) ? 'webp' : 'jpeg') : 'application/json' }) };
      }));
    } catch (e) { toast(T('stFileError', it.file.name, e.message)); }
  }
  return out;
}

// ---- 快速掃描：讀檔頭的 EXIF 與一張小圖，自動分組並檢查畫面（乾淨岩壁 vs 有人物／有繩索／非岩壁） ----
// 紅筆：很鮮的紅色佔小圖一定比例（路線書的照片），跟 crag/trace.js 認的顏色一樣嚴格
function countRedPen(d) {
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 170 && d[i] - d[i + 1] > 110 && d[i] - d[i + 2] > 90) n++;
  return n / (d.length / 4) > 0.002;
}
async function inspectThumb(file) {
  try {
    const bmp = await createImageBitmap(file, { resizeWidth: 160, resizeQuality: 'low' });
    const w = bmp.width, h = bmp.height;
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    bmp.close();
    const d = g.getImageData(0, 0, w, h).data;
    return { ...classifyImageData(d, w, h), red: countRedPen(d), w, h };
  } catch {
    return { status: 'clean', label: STATUS_LABEL.clean, clean: true, reasons: [], red: false, w: 0, h: 0 };
  }
}
async function scan(items, onProgress) {
  const imgs = items.filter(i => IMG.test(i.file.name)), r = { photos: imgs.length, gps: 0, red: 0, clean: 0, flagged: 0, machine: 0, dirs: new Set(), tables: items.filter(i => TABLE.test(i.file.name)).length, views: items.filter(i => /\.json$/i.test(i.file.name) && !/^index\.json$/i.test(i.file.name)).length };
  for (const [k, it] of imgs.entries()) {
    onProgress(k + 1, imgs.length);
    if (it.dir) r.dirs.add(it.dir);
    if (machine(it.file.name.replace(/\.[^.]+$/, ''))) r.machine++;
    try {
      const exif = Photo.readExif(await it.file.slice(0, 256 * 1024).arrayBuffer());
      const cam = Photo.toCamera(exif);
      it.camera = cam || undefined;
      it.time = cam?.t ?? (Number.isFinite(exif?.time) ? Math.round(exif.time) : undefined);
      if (cam && located(cam)) r.gps++;
    } catch { /* 讀不到 EXIF：當成沒有位置 */ }
    const info = await inspectThumb(it.file);
    Object.assign(it, info);
    if (info.clean) r.clean++; else r.flagged++;
  }
  // 有拍照位置的照片才看紅筆（抽最多 40 張；岩館的牆常有紅色岩點）
  if (r.gps * 2 >= r.photos) for (const it of imgs.slice(0, 40)) if (it.red) r.red++;
  // 預設勾選乾淨岩壁；若全部照片都被標記（例如只有草稿或測試圖），就全勾避免空專案
  const defaultOnlyClean = r.clean > 0;
  for (const it of imgs) it.selected = defaultOnlyClean ? it.clean : true;
  return r;
}

// ---- 掃描結果：人只確認專案名稱和工作區（岩館／岩場）；分組、挑照片、要做哪些處理都自動 ----
/** 整理匯入的資料時（掃描、選工作區）收起「交給 AI」和各條線 */
const flow = (on) => { $('#tasks').hidden = on; $('#aiBox').hidden = on; };
let pending = null;   // { items, imgs, groups, dir, scan, ws }

async function takeIn(items, dir = null, defaultName = '') {
  pending = null;
  items = await withZips(items);
  const imgs = items.filter(i => IMG.test(i.file.name));
  if (!imgs.length) { toast(T('stNoPhotos')); return; }
  flow(true); $('#flowStage').hidden = false; $('#scan').hidden = false; $('#result').hidden = true;
  $('#flowStage').scrollIntoView({ behavior: 'smooth', block: 'start' });
  const r = await scan(items, (k, n) => { $('#scanMsg').textContent = T('stScanProgress', k, n); });
  pending = { items, imgs, groups: groupPhotos(imgs), dir, scan: r, ws: suggestWs(r) };
  $('#pjName').value = defaultName || (dir ? dir.name : [...r.dirs][0] && r.dirs.size === 1 ? [...r.dirs][0] : T('stProjectDefault', new Date().toLocaleDateString()));
  pickWs(pending.ws);
  const sel = imgs.filter(i => i.selected).length;
  $('#selCount').textContent = T('stSelCount', sel, imgs.length, imgs.length - sel);
  $('#scan').hidden = true; $('#result').hidden = false;
}
function pickWs(ws) {
  pending.ws = ws;
  for (const b of $('#wsPick').querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.ws === ws));
}
$('#wsPick').onclick = (e) => { const b = e.target.closest('button[data-ws]'); if (b && pending) pickWs(b.dataset.ws); };
$('#cancel').onclick = () => { pending = null; $('#flowStage').hidden = true; $('#result').hidden = true; $('#scan').hidden = true; flow(false); };
$('#create').onclick = async () => {
  const { items, imgs, groups, dir, scan: r, ws } = pending, name = $('#pjName').value.trim() || T('stUntitled');
  const { target: targetWs, inFolder, groupPrefix, auto } = WS[ws], options = auto(r);
  $('#create').disabled = true;
  try {
    // 拖進來的是一個資料夾（Chrome）：專案直接存在那裡，照片從資料夾讀；寫入權限只能在點擊時要
    if (dir && inFolder && imgs.every(i => i.selected)) {
      if (await dir.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error(T('stNoWriteAccess'));
      location.href = `${targetWs}/#inbox=${await inbox.put({ dir, name, options })}`;
      return;
    }
    // 自動分組的名稱照工作區（岩壁 1、牆面 1）；資料夾帶來的名稱照舊
    const groupOf = new Map();
    const fromDirs = imgs.some(i => i.dir?.trim());
    groups.forEach((g, i) => { const gName = fromDirs ? g.name : `${groupPrefix} ${i + 1}`; for (const it of g.items) if (it.selected) groupOf.set(it, gName); });
    const chosen = items.filter(it => groupOf.has(it)).map(it => ({ dir: groupOf.get(it), file: it.file }));
    location.href = `${targetWs}/#inbox=${await inbox.put({ name, items: chosen, options })}`;
  } catch (e) { toast(e.message); $('#create').disabled = false; }
};

// ---- 拖放、選檔 ----
// ---- 匯入（代理的工具在背景用）：先辨識來源再交給對的工作區，不要求先挑「岩館／岩場／路線書／3D」 ----
// ZIP 是容器，不能只看副檔名。原生匯出含 index.json（set/guidebook）與其他文件。
const CRAG_DOC = /\.(docx|pdf|html?|md|txt|geojson|csv|tsv)$/i;
const CRAG_IMG = /\.(jpe?g|png|webp|gif|hei[cf])$/i;
const addStatus = (msg) => { $('#addStatus').textContent = msg; };
const cragPath = (i) => [i.dir, i.file.name].filter(Boolean).join('/').replace(/\\/g, '/');
const asItems = (files) => [...files].map(file => {
  const p = (file.webkitRelativePath || file.name).replace(/\\/g, '/').split('/');
  return { dir: p.slice(0, -1).join('/'), file };
});
const safeCragPath = (p) => !!p && !p.startsWith('/') && !p.split('/').some(x => !x || x === '.' || x === '..' || x.startsWith('.studio'));
function unpackedItems(entries) {
  const files = entries.filter(x => !x.name.endsWith('/') && safeCragPath(x.name));
  // 使用者可能把整本 Guidebook 放在 ZIP 的單一根目錄中。
  const index = files.find(x => /(?:^|\/)index\.json$/i.test(x.name));
  const prefix = index?.name.slice(0, -'index.json'.length) || '';
  return files.filter(x => !prefix || x.name.startsWith(prefix)).map(x => {
    const path = x.name.slice(prefix.length), parts = path.split('/');
    const name = parts.pop();
    return { dir: parts.join('/'), file: new File([x.blob], name, { type: /\.json$/i.test(name) ? 'application/json' : x.blob.type }) };
  });
}
async function nativeCrag(items) {
  let list = items;
  const root = items.find(i => /(?:^|\/)index\.json$/i.test(cragPath(i)));
  if (!root) return null;
  const prefix = cragPath(root).slice(0, -'index.json'.length);
  list = items.filter(i => cragPath(i).startsWith(prefix)).map(i => {
    const path = cragPath(i).slice(prefix.length), parts = path.split('/');
    return { dir: parts.slice(0, -1).join('/'), file: i.file };
  });
  const entry = list.find(i => cragPath(i) === 'index.json');
  let doc;
  try { doc = JSON.parse(await entry.file.text()); } catch { throw new Error(T('stBadIndexJson')); }
  if (doc?.climbio !== 2 || doc.kind !== 'set' || doc.type !== 'guidebook' || !doc.id) {
    throw new Error(T('stNotNativePack'));
  }
  return list;
}
/** 3D 牆的工作檔（wall.json 和它指到的模型、面標籤）：放進瀏覽器私有檔案系統，3D 牆用固定連結打開（同 wall3d/ 的檔案輸入） */
async function wall3dPack(items) {
  const wall = items.find(i => i.file.name === 'wall.json');
  if (!wall) return false;
  let doc;
  try { doc = JSON.parse(await wall.file.text()); } catch { return false; }
  if (!/^[0-9a-z]{16}$/.test(doc?.id || '') || !doc.model || !doc.faces) return false;
  const byName = new Map(items.map(i => [i.file.name, i.file]));
  if (!byName.has(doc.model) || !byName.has(doc.faces)) throw new Error(T('stWall3dMissing'));
  addStatus(T('stOpening'));
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(`wall3d-${doc.id}`, { create: true });
  for (const f of byName.values()) { const w = await (await dir.getFileHandle(f.name, { create: true })).createWritable(); await w.write(f); await w.close(); }
  location.href = `wall3d/#p=${doc.id}`;
  return true;
}
async function routeFiles(items, dir = null) {
  if (!items.length && !dir) return;
  addStatus(T('stReading'));
  try {
    if (dir && await SS.metaIn(dir)) {
      const key = await inbox.put({ dir, options: {} });
      location.href = `crag/#inbox=${key}`;
      return;
    }
    if (await wall3dPack(items)) return;
    const zip = items.filter(i => /\.zip$/i.test(i.file.name));
    let native = await nativeCrag(items), unpacked = null;
    if (!native && zip.length === 1 && items.length === 1) {
      const entries = await AppKit.files.unzip(zip[0].file);
      unpacked = unpackedItems(entries);
      native = await nativeCrag(unpacked);
    }
    if (native) {
      addStatus(T('stOpening'));
      const key = await inbox.put({ items: native, sourceKind: 'native' });
      location.href = `crag/#nativeInbox=${key}`;
      return;
    }
    const files = items.map(i => i.file);
    // 只有照片的 ZIP 走照片的整理，不是路線書轉換
    if (unpacked?.length && unpacked.every(i => CRAG_IMG.test(i.file.name))) {
      addStatus('');
      await takeIn(unpacked, null, zip[0].file.name.replace(/\.zip$/i, ''));
      return;
    }
    if (files.some(f => CRAG_DOC.test(f.name) || /\.zip$/i.test(f.name))) {
      addStatus(T('stConverting'));
      const key = await inbox.put({ items, sourceKind: 'guidebook' });
      location.href = `crag/#bookInbox=${key}`;
      return;
    }
    if (files.every(f => CRAG_IMG.test(f.name))) {
      addStatus('');
      await takeIn(items, dir);
      return;
    }
    throw new Error(T('stUnknownData'));
  } catch (e) { addStatus(T('stImportFailed', e.message)); }
}
$('#addInput').onchange = (e) => { const items = asItems(e.target.files); e.target.value = ''; routeFiles(items); };
$('#addFolderInput').onchange = (e) => { const items = asItems(e.target.files); e.target.value = ''; routeFiles(items); };
function importUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.origin !== location.origin) throw new Error(T('stNeedHttps'));
    addStatus(T('stReading'));
    location.href = `crag/#site=${encodeURIComponent(url)}`;
  } catch (err) { addStatus(err.message); toast(err.message); }
}
// ---- 交給 AI：教人設定自己的 AI 代理、交代任務；代理做好的專案資料夾在這裡打開來確認 ----
// 交代任務的句子：複製給自己的代理（代理照 Climbio 專案的 AGENTS.md 找到對應的工具做）
for (const b of document.querySelectorAll('[data-copy]')) b.onclick = () => {
  const text = b.closest('li')?.querySelector('q')?.textContent || '';
  navigator.clipboard?.writeText(text).then(() => toast(T('stAiCopied')), () => toast(text));
};
/** 打開代理做好的專案：選資料夾（是 Studio 專案、或裡面的「Climbio Studio」是），記進最近的專案、進那條線的工作頁 */
async function openProject() {
  try {
    const { dir, meta } = await SS.claim(await SS.pick());
    if (!meta) { toast(T('stAiNotProject')); return; }
    const p = await SS.open(dir);
    location.href = `${p.ws === 'gym' ? 'wall' : 'crag'}/#${p.id}`;
  } catch (e) { if (e.name !== 'AbortError') toast(e.message); }
}
$('#openProject').hidden = !SS.canPickDir;
$('#openNote').hidden = SS.canPickDir;
$('#openProject').onclick = openProject;
// 網址：#ai 捲到「交給 AI」（導覽每頁都有，舊的 #add 也到這裡）；#import=<網址> 匯入岩場站、Google 相簿（代理與測試用）
function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith('import=')) { history.replaceState(null, '', location.pathname + location.search); importUrl(h.slice(7)); return; }
  if (h === 'add' || h === 'ai') $('#aiBox').scrollIntoView({ block: 'start' });
}
addEventListener('hashchange', route);
route();

// ---- 最近的專案（StudioStore 記的，新到舊）----
/** 專案卡的圖示：跟統一導覽同一組（岩館、岩場） */
const LIB_ICON = {
  gym: '<path d="M4 20V4h16v16z"/><circle cx="9" cy="9" r="1.6"/><circle cx="15" cy="11" r="1.6"/><circle cx="10" cy="15.5" r="1.6"/>',
  crag: '<path d="M3 20l6-12 4 6 3-4 5 10z"/>',
};
const fmt = new Intl.DateTimeFormat(AppKit.i18n.lang === 'en' ? 'en' : 'zh-Hant', { dateStyle: 'medium' });
async function renderRecent() {
  const rows = (await SS.recent().catch(() => [])).filter(r => r.local || SS.canPickDir).slice(0, 24).map(r => {
    const gym = r.ws === 'gym', icon = el('i', { className: 'lib-icon', ariaHidden: 'true' });
    icon.innerHTML = `<svg viewBox="0 0 24 24">${gym ? LIB_ICON.gym : LIB_ICON.crag}</svg>`;
    const open = el('button', { className: 'open' }, icon, el('b', { textContent: r.name || T('stUntitled') }), el('small', { textContent: [T(gym ? 'stGym' : 'stCrag'), r.local ? T('stThisDevice') : r.dir.name, fmt.format(r.at)].join(' · ') }));
    open.dataset.studioWs = r.ws === 'gym' ? 'gym' : 'crag';
    open.onclick = () => openRecent(r);
    const li = el('li', {}, open);
    if (r.local) {   // 存在瀏覽器裡的只能在這裡刪；資料夾是使用者自己的，不刪
      const del = el('button', { className: 'del', textContent: T('stDelete'), ariaLabel: T('stDeleteName', r.name) });
      del.onclick = () => removeRecent(r);
      li.append(del);
    }
    return li;
  });
  $('#recent').replaceChildren(...rows);
  $('#recentBox').hidden = !rows.length;
}
async function openRecent(r) {
  try {   // 資料夾的授權只能在點擊時要回來
    if (!(await SS.granted(r)) && await r.dir.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error(T('stNoFolderAccess'));
    const targetWs = OPEN[r.ws]?.target || 'crag';
    location.href = `${targetWs}/#${r.id}`;
  } catch (e) { toast(e.name === 'NotFoundError' ? T('stFolderMissing') : e.message); if (e.name === 'NotFoundError') { await SS.forget(r.id); renderRecent(); } }
}
async function removeRecent(r) {
  if (!(await UI.confirm(T('stDeleteBody'), { title: T('stDeleteTitle', r.name), ok: T('stDelete'), danger: true }))) return;
  await SS.removeLocal(r.id);
  renderRecent();
}
renderRecent();

// 頁首右上的選單（語言、版本）
if (globalThis.StudioShell?.menu) globalThis.StudioShell.menu();
else {
  fetch('shell.js', { cache: 'reload' }).catch(() => {});
}

// 主畫面：岩館（原岩明德）和天然岩場（大砲岩）交替；標籤和「打開 3D」跟著換（明德進 3D 牆的固定連結，大砲岩進 3D 場景）
const HERO = [
  { kind: 'gym', ws: 'gym', label: 'stHeroGym', href: 'scene/#src=mingde' },
  { kind: 'crag', ws: 'crag', label: 'stHeroCrag', href: 'scene/' },
];
function hero() {
  const box = $('#hero');
  if (!box || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let i = 0;
  const show = () => {
    const h = HERO[i];
    for (const f of box.querySelectorAll('.hero-scene')) f.classList.toggle('on', f.dataset.kind === h.kind);
    box.querySelectorAll('.hero-dots i').forEach((d, k) => d.classList.toggle('on', k === i));
    $('#heroOpen').href = h.href;
    $('#heroOpen').dataset.studioWs = h.ws;
    $('#heroLabel').textContent = T(h.label);
  };
  show();
  setInterval(() => { if (document.hidden) return; i = (i + 1) % HERO.length; show(); }, 7000);
}
hero();
