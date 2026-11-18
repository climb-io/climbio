// Climbio Studio 的首頁：新專案（照片、資料夾、ZIP、Google 相簿 → 快速掃描 → 選工作區與要自動處理的項目）、手動輸入、最近的專案。
// 專案建在工作區頁面：這裡把資料夾、檔案和選項放進收件匣（store.js），轉到 crag/ 接手。
// Studio 沒有專案同步：專案存在這台電腦（或自己選的資料夾），要換電腦用匯出 ZIP。
import { fetchAlbum, isAlbumUrl } from './album.js';
import { classifyImageData, groupPhotos, STATUS_LABEL } from './classify.js';
import { WS, OPEN, suggestWs } from './intake/workspaces.js';
import { renderGroupMap } from './intake/group-map.js';
import { createLightbox } from './intake/lightbox.js';
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

// ---- 讀進來的檔案 → [{ dir: 所在資料夾名稱（沒有就是 ''）, file }]；拖進一個資料夾時另外記下它的 handle（專案直接存在那裡） ----
async function readDrop(dt) {
  const out = [], entries = [...dt.items].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  const handles = SS.canPickDir ? await Promise.all([...dt.items].filter(i => i.kind === 'file').map(i => i.getAsFileSystemHandle ? i.getAsFileSystemHandle().catch(() => null) : null)) : [];
  const walk = async (entry, dir) => {
    if (entry.isFile) { await new Promise(res => entry.file(f => { out.push({ dir, file: f }); res(); }, res)); return; }
    const rd = entry.createReader();
    for (;;) { const batch = await new Promise(res => rd.readEntries(res, () => res([]))); if (!batch.length) break; for (const e of batch) await walk(e, entry.name); }
  };
  for (const e of entries) await walk(e, e.isDirectory ? e.name : '');
  const dirs = handles.filter(h => h && h.kind === 'directory');
  return { items: out, dir: entries.length === 1 && dirs.length === 1 ? dirs[0] : null };
}
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
    it.thumbUrl = URL.createObjectURL(it.file);
    if (info.clean) r.clean++; else r.flagged++;
  }
  // 有拍照位置的照片才看紅筆（抽最多 40 張；岩館的牆常有紅色岩點）
  if (r.gps * 2 >= r.photos) for (const it of imgs.slice(0, 40)) if (it.red) r.red++;
  // 預設勾選乾淨岩壁；若全部照片都被標記（例如只有草稿或測試圖），就全勾避免空專案
  const defaultOnlyClean = r.clean > 0;
  for (const it of imgs) it.selected = defaultOnlyClean ? it.clean : true;
  return r;
}

// ---- 掃描結果：工作區與自動處理的項目 ----
let pending = null;   // { items, imgs, groups, manualGroup, dir, scan, ws }
const redrawMap = () => renderGroupMap($('#groupMap'), pending?.groups);

function flatGroupItems() {
  if (!pending?.groups) return [];
  const list = [];
  for (const g of pending.groups) for (const it of g.items) list.push({ g, it });
  return list;
}
const lightbox = createLightbox({ items: flatGroupItems, onToggle: () => renderGroups() });

function clearPending() {
  lightbox.close();
  if (pending?.imgs) for (const it of pending.imgs) if (it.thumbUrl) URL.revokeObjectURL(it.thumbUrl);
  pending = null;
}

async function takeIn(items, dir = null, defaultName = '', fromAlbum = false, forcedWs = '') {
  clearPending();
  items = await withZips(items);
  const imgs = items.filter(i => IMG.test(i.file.name));
  if (!imgs.length) { toast(T('stNoPhotos')); return; }
  $('#cragDrop').hidden = true; $('#flowStage').hidden = false; $('#scan').hidden = false; $('#result').hidden = true;
  $('#flowStage').scrollIntoView({ behavior: 'smooth', block: 'start' });
  const r = await scan(items, (k, n) => { $('#scanMsg').textContent = T('stScanProgress', k, n); });
  const ws = forcedWs || suggestWs(r);
  const groups = groupPhotos(imgs);
  pending = { items, imgs, groups, manualGroup: false, dir, scan: r, ws, forcedWs };
  $('#pjName').value = defaultName || (dir ? dir.name : [...r.dirs][0] && r.dirs.size === 1 ? [...r.dirs][0] : T('stProjectDefault', new Date().toLocaleDateString()));
  pickWs(ws);
  $('#scan').hidden = true; $('#result').hidden = false;
}
function pickWs(ws) {
  if (pending.forcedWs && ws !== pending.forcedWs) return;
  pending.ws = ws;
  if (!pending.manualGroup) {
    const prefix = WS[ws].groupPrefix;
    pending.groups.forEach((g, i) => {
      if (/^(分區|岩壁|Wall)\s+\d+$/.test(g.name)) g.name = WS[ws].groupName(g) || `${prefix} ${i + 1}`;
    });
  }
  renderGroups();
  $('#opts').replaceChildren(...WS[ws].options(pending.scan).filter(Boolean).map(o => {
    const c = el('input', { type: 'checkbox', checked: o.on !== false, value: o.id });
    if (o.id === 'byTime') c.addEventListener('change', () => {
      if (!pending.manualGroup) {
        pending.groups = groupPhotos(pending.imgs, { byTime: c.checked });
        renderGroups();
      }
    });
    return el('label', { className: 'opt' }, c, el('span', {}, o.label), o.note ? el('small', { textContent: o.note }) : '');
  }));
}
function updateSelCount() {
  if (!pending) return;
  const total = pending.imgs.length;
  const sel = pending.imgs.filter(i => i.selected !== false).length;
  const dropped = total - sel;
  $('#selCount').textContent = T('stSelCount', sel, total, dropped);
  $('#create').disabled = sel === 0 && !pending.scan.tables && !pending.scan.views;
}
function renderGroups() {
  if (!pending) return;
  const { groups } = pending;
  const cards = groups.map((g, gi) => {
    const nameInput = el('input', { value: g.name, ariaLabel: T('stGroupName'), maxLength: 60 });
    nameInput.addEventListener('change', () => {
      g.name = nameInput.value.trim() || g.name;
      nameInput.value = g.name;
      pending.manualGroup = true;
      renderGroups();
    });
    const head = el('div', { className: 'ghead' }, nameInput, el('span', { className: 'gnote', textContent: [g.note, T('stActiveCount', g.items.filter(x => x.selected !== false).length, g.items.length)].filter(Boolean).join(' · ') }));
    const grid = el('div', { className: 'ggrid' }, ...g.items.map(it => {
      const check = el('input', { type: 'checkbox', className: 'pcheck', checked: it.selected !== false, ariaLabel: T('stInclude') });
      const badge = el('span', { className: `pbadge ${it.clean ? 'clean' : 'warn'}`, textContent: it.label || STATUS_LABEL.clean });
      const thumb = el('div', { className: 'thumb' }, check, badge);
      if (it.thumbUrl) thumb.style.backgroundImage = `url("${it.thumbUrl}")`;
      const card = el('div', { className: `pcard ${it.selected !== false ? 'on' : 'off'}` });
      const toggle = (on) => {
        it.selected = on;
        check.checked = on;
        card.className = `pcard ${on ? 'on' : 'off'}`;
        head.querySelector('.gnote').textContent = [g.note, T('stActiveCount', g.items.filter(x => x.selected !== false).length, g.items.length)].filter(Boolean).join(' · ');
        updateSelCount();
        redrawMap();
      };
      check.addEventListener('click', (e) => e.stopPropagation());
      check.addEventListener('change', () => toggle(check.checked));
      thumb.addEventListener('click', () => lightbox.open(it));
      const moveSel = el('select', { ariaLabel: T('stMoveToGroup') }, ...groups.map((og, oi) => el('option', { value: String(oi), textContent: og.name, selected: oi === gi })));
      moveSel.addEventListener('change', () => {
        const targetIdx = Number(moveSel.value);
        if (targetIdx === gi || !groups[targetIdx]) return;
        g.items = g.items.filter(x => x !== it);
        groups[targetIdx].items.push(it);
        pending.groups = groups.filter(x => x.items.length > 0);
        pending.manualGroup = true;
        renderGroups();
      });
      const pname = el('span', { className: 'pname', textContent: it.file.name.replace(/\.[^.]+$/, ''), title: it.file.name });
      pname.addEventListener('click', () => lightbox.open(it));
      const meta = el('div', { className: 'pmeta' }, pname, moveSel);
      card.append(thumb, meta);
      return card;
    }));
    const gcard = el('div', { className: 'gcard' }, head, grid);
    gcard.dataset.groupIdx = String(gi);
    return gcard;
  });
  $('#groups').replaceChildren(...cards);
  redrawMap();
  updateSelCount();
}
$('#selectClean').onclick = () => {
  if (!pending) return;
  for (const it of pending.imgs) it.selected = !!it.clean;
  renderGroups();
};
$('#selectAll').onclick = () => {
  if (!pending) return;
  for (const it of pending.imgs) it.selected = true;
  renderGroups();
};
$('#addGroup').onclick = () => {
  if (!pending) return;
  const prefix = WS[pending.ws].groupPrefix;
  const n = pending.groups.length + 1;
  pending.groups.push({ id: `g${Date.now()}`, name: `${prefix} ${n}`, style: '', note: T('stManualGroup'), items: [] });
  pending.manualGroup = true;
  renderGroups();
};
$('#cancel').onclick = () => { clearPending(); $('#flowStage').hidden = true; $('#result').hidden = true; $('#scan').hidden = true; $('#cragDrop').hidden = false; };
$('#create').onclick = async () => {
  const { items, groups, manualGroup, dir, ws } = pending, name = $('#pjName').value.trim() || T('stUntitled');
  const options = Object.fromEntries([...$('#opts').querySelectorAll('input')].map(c => [c.value, c.checked]));
  if (manualGroup) options.manualGroup = true;
  const targetWs = WS[ws].target;
  $('#create').disabled = true;
  try {
    // 拖進來的是一個資料夾（Chrome）：專案直接存在那裡，照片從資料夾讀；寫入權限只能在點擊時要
    if (dir && !manualGroup && pending.imgs.every(i => i.selected !== false)) {
      if (await dir.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error(T('stNoWriteAccess'));
      location.href = `${targetWs}/#inbox=${await inbox.put({ dir, name, options })}`;
      return;
    }
    const groupOf = new Map();
    for (const g of groups) for (const it of g.items) if (it.selected !== false) groupOf.set(it, g.name);
    const chosen = items.filter(it => !IMG.test(it.file.name) || groupOf.has(it)).map(it => {
      const gName = groupOf.get(it) ?? it.dir;
      return { dir: WS[ws].folder(gName, { options, manualGroup }), file: it.file };
    });
    location.href = `${targetWs}/#inbox=${await inbox.put({ name, items: chosen, options })}`;
  } catch (e) { toast(e.message); $('#create').disabled = false; }
};

// ---- 拖放、選檔、Google 相簿 ----
async function takeAlbum(url, forcedWs = '') {
  $('#cragDrop').hidden = true; $('#flowStage').hidden = false; $('#scan').hidden = false; $('#result').hidden = true;
  $('#scanMsg').textContent = T('stAlbumReading');
  try {
    const { title, files } = await fetchAlbum(url, {
      onProgress: (k, n) => { $('#scanMsg').textContent = n ? T('stAlbumProgress', k, n) : T('stAlbumReading'); },
    });
    await takeIn(files.map(file => ({ dir: '', file })), null, title, true, forcedWs);
  } catch (e) {
    $('#flowStage').hidden = true; $('#scan').hidden = true; $('#cragDrop').hidden = false;
    toast(e.message || String(e));
  }
}
// ---- 天然岩場：單一入口先辨識來源，不要求先挑「網站／ZIP／路線書」 ----
// ZIP 是容器，不能只看副檔名。原生匯出含 index.json（set/guidebook）與其他文件。
const CRAG_DOC = /\.(docx|pdf|html?|md|txt|geojson|csv|tsv)$/i;
const CRAG_IMG = /\.(jpe?g|png|webp|gif|hei[cf])$/i;
const cragStatus = (msg) => { $('#cragStatus').textContent = msg; };
const cragPath = (i) => [i.dir, i.file.name].filter(Boolean).join('/').replace(/\\/g, '/');
const asCragItems = (files) => [...files].map(file => {
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
async function routeCragFiles(items, dir = null) {
  if (!items.length && !dir) return;
  cragStatus(T('stReading'));
  $('#cragFiles').disabled = true;
  try {
    if (dir && await SS.metaIn(dir)) {
      const key = await inbox.put({ dir, options: {} });
      location.href = `crag/#inbox=${key}`;
      return;
    }
    const zip = items.filter(i => /\.zip$/i.test(i.file.name));
    let native = await nativeCrag(items), unpacked = null;
    if (!native && zip.length === 1 && items.length === 1) {
      const entries = await AppKit.files.unzip(zip[0].file);
      unpacked = unpackedItems(entries);
      native = await nativeCrag(unpacked);
    }
    if (native) {
      cragStatus(T('stOpening'));
      const key = await inbox.put({ items: native, sourceKind: 'native' });
      location.href = `crag/#nativeInbox=${key}`;
      return;
    }
    const files = items.map(i => i.file);
    // Pure photo ZIPs need the photo intake path, not the document converter.
    if (unpacked?.length && unpacked.every(i => CRAG_IMG.test(i.file.name))) {
      cragStatus(T('stOrganizing'));
      await takeIn(unpacked, null, zip[0].file.name.replace(/\.zip$/i, ''), false, 'crag');
      return;
    }
    if (files.some(f => CRAG_DOC.test(f.name) || /\.zip$/i.test(f.name))) {
      cragStatus(T('stConverting'));
      const key = await inbox.put({ items, sourceKind: 'guidebook' });
      location.href = `crag/#bookInbox=${key}`;
      return;
    }
    if (files.every(f => CRAG_IMG.test(f.name))) {
      cragStatus(T('stOrganizing'));
      await takeIn(items, dir, '', false, 'crag');
      return;
    }
    throw new Error(T('stUnknownData'));
  } catch (e) { cragStatus(T('stImportFailed', e.message)); }
  finally { $('#cragFiles').disabled = false; }
}
$('#cragFiles').onclick = () => $('#cragInput').click();
$('#cragInput').onchange = (e) => { const items = asCragItems(e.target.files); e.target.value = ''; routeCragFiles(items); };
$('#cragDir').onclick = () => $('#cragFolderInput').click();
$('#cragFolderInput').onchange = (e) => { const items = asCragItems(e.target.files); e.target.value = ''; routeCragFiles(items); };
$('#cragUrlForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const url = $('#cragUrl').value.trim();
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.origin !== location.origin) throw new Error(T('stNeedHttps'));
    if (isAlbumUrl(url)) { takeAlbum(url, 'crag'); return; }
    cragStatus(T('stReading'));
    location.href = `crag/#site=${encodeURIComponent(url)}`;
  } catch (err) { cragStatus(err.message); }
});
const cragDrop = $('#cragDrop');
cragDrop.addEventListener('dragover', e => { e.preventDefault(); cragDrop.classList.add('over'); });
cragDrop.addEventListener('dragleave', e => { if (!cragDrop.contains(e.relatedTarget)) cragDrop.classList.remove('over'); });
cragDrop.addEventListener('drop', async e => {
  e.preventDefault(); cragDrop.classList.remove('over');
  const uri = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
  if (uri?.trim() && /^(https?:\/\/)/i.test(uri.trim()) && !e.dataTransfer.files.length) {
    $('#cragUrl').value = uri.trim();
    $('#cragUrlForm').requestSubmit();
    return;
  }
  const got = await readDrop(e.dataTransfer);
  await routeCragFiles(got.items, got.dir);
});

// ---- 手動輸入 ----
// 新專案：能選資料夾的瀏覽器存在選的資料夾（已經是專案就打開，裡面有照片就一起加進來），否則存在瀏覽器裡
async function manual(ws) {
  const { target: targetWs, newProject: { hash, options } } = WS[ws];
  if (!SS.canPickDir) { location.href = `${targetWs}/${hash}`; return; }
  try { const dir = await SS.pick(); location.href = `${targetWs}/#inbox=${await inbox.put({ dir, options })}`; }
  catch (e) { if (e.name !== 'AbortError') toast(e.message); }
}
$('#newCrag').onclick = () => manual('crag');

// ---- 最近的專案（StudioStore 記的，新到舊）----
const fmt = new Intl.DateTimeFormat(AppKit.i18n.lang === 'en' ? 'en' : 'zh-Hant', { dateStyle: 'medium' });
async function renderRecent() {
  const rows = (await SS.recent().catch(() => [])).filter(r => r.local || SS.canPickDir).slice(0, 24).map(r => {
    const tag = OPEN[r.ws]?.name || 'Crag';
    const open = el('button', { className: 'open' }, el('span', { className: 'tag', textContent: tag }), el('b', { textContent: r.name || T('stUntitled') }), el('small', { textContent: [r.local ? T('stThisDevice') : r.dir.name, fmt.format(r.at)].join(' · ') }));
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

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service Worker', e));
