// Climbio Studio 的 Crag 工作區：一本 Guidebook（左邊岩壁地圖、右邊岩壁、照片與路線）、畫 Topo（一張照片）；首頁（專案清單）在 ../。
// 步驟列：岩場資訊 → 區域圖 → 路線清單（grid.js）→ 路線圖 → 發佈。
// 網址的 #<組合 id> 是打開的那本，#<組合 id>/<照片畫面 id> 是在畫那張照片的 Topo；#new 在瀏覽器裡開新的一本、#site 匯入岩場站（#site=<網址> 直接匯入那個網址）、#edit=<岩場 id> 打開那本最新的一版、#inbox=<id> 接手首頁交過來的資料夾或照片（../store.js 的收件匣）。
// 資料放在專案資料夾（store.js）。
import * as M from './model.js';
import { $, el } from './dom.js';
import * as store from './store.js';
import { fields, parseTable, guessColumns, toRoutes, decodeText, COLUMNS, shownColumns, cellText, cellPatch, STYLE_LABEL, GRADES, gradeSysOf } from './table.js';
import { Grid } from './grid.js';
import { SITES, crawl, fromV2, checkUrl, entryOf, sameSource, publishedId } from './site.js';
import { fromOutline, AI_PROMPT, AI_MAP_PROMPT } from './outline.js';
import { readBookFiles, BOOK_IMAGE, assetKey, findAsset, sourceName, newRecord, OUTLINE } from './convert.js';
import { outlineReport, bookReport, reasonText } from './report.js';
import { TopoScreen } from './topo.js';
import { traceBlob, traceDiffBlobs } from './trace.js';
import { findOriginals } from './pair.js';
import { WallMap } from './map.js';
import { located, photoWedge } from './geo.js';
import { features as analyze } from './match.js';   // 找原圖用的特徵點
import * as P from './publish.js';
import * as V from './versions.js';
import { createPublishUI } from '../publish-ui.js';
import * as K from '../publisher.js';
const newProjectId = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => '0123456789abcdefghijklmnopqrstuvwxyz'[b % 36]).join('');

const T = (...a) => globalThis.AppKit.i18n.t(...a);   // 文字在呼叫時才查
globalThis.AppKit.i18n.apply();   // index.html 的 data-i18n

const ICON = {
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>',
};

let state = null;          // 打開的 Guidebook：{ book, map, photos, layers }
let topo = null;           // 畫 Topo 的畫面（TopoScreen）與照片的 object URL：{ screen, url, photo }
let wallMap = null;
let activeWall = null;
const thumbs = new Map();  // 照片畫面 id → 縮圖的 object URL
const fullUrls = new Map(); // 照片畫面 id → 原圖預覽的 object URL
let popPhotoId = null;

function ensurePhotoPop(anchor) {
  let pop = $('#photoPop');
  if (!pop) {
    pop = el('div', { id: 'photoPop', hidden: true }, el('img', { alt: '' }), el('span'));
    pop.setAttribute('popover', 'manual');
    document.body.append(pop);
  }
  const host = anchor?.closest?.('dialog[open]') || document.body;
  if (pop.parentElement !== host) host.append(pop);
  return pop;
}
function hidePhotoPop() {
  popPhotoId = null;
  const pop = $('#photoPop');
  if (pop) {
    pop.hidden = true;
    try { if (pop.matches?.(':popover-open')) pop.hidePopover(); } catch {}
  }
}
function placePhotoPop(anchor) {
  const pop = $('#photoPop');
  if (!pop || pop.hidden) return;
  const r = anchor.getBoundingClientRect();
  const inDlg = !!anchor.closest?.('dialog[open]');
  const img = pop.querySelector('img');
  const sideEl = !inDlg && step === 'map' && anchor.closest?.('#side');
  const sideRect = sideEl ? sideEl.getBoundingClientRect() : null;
  if (sideRect && sideRect.left >= 260) {
    // 區域圖左右排列：放大預覽固定顯示在左側地圖區，完全不遮擋右側縮圖與區域清單
    const availW = Math.max(240, Math.min(820, sideRect.left - 24));
    pop.style.width = `${availW}px`;
    if (img) img.style.maxHeight = 'min(82vh, 760px)';
    const pw = pop.offsetWidth || availW, ph = pop.offsetHeight || 480;
    const left = Math.max(12, sideRect.left - pw - 12);
    const top = Math.max(12, Math.min(innerHeight - ph - 12, r.top + r.height / 2 - ph / 2));
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    return;
  }
  if (sideRect && sideRect.top >= 180) {
    // 區域圖上下排列：放大預覽顯示在上方地圖區，不遮擋下方縮圖區
    const availW = Math.max(240, Math.min(680, innerWidth - 24));
    const availH = Math.max(140, sideRect.top - 24);
    pop.style.width = `${availW}px`;
    if (img) img.style.maxHeight = `${Math.max(100, availH - 46)}px`;
    const pw = pop.offsetWidth || availW, ph = pop.offsetHeight || availH;
    const left = Math.max(12, Math.round((innerWidth - pw) / 2));
    const top = Math.max(12, sideRect.top - ph - 12);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    return;
  }
  if (img) img.style.maxHeight = 'min(82vh, 760px)';
  const spaceLeft = r.left - 24, spaceRight = innerWidth - r.right - 24;
  const useLeft = inDlg ? spaceLeft >= spaceRight : (spaceLeft >= spaceRight || spaceLeft >= 360);
  const availW = Math.max(280, Math.min(inDlg ? 680 : 820, useLeft ? spaceLeft : spaceRight));
  pop.style.width = `${availW}px`;
  const pw = pop.offsetWidth || availW, ph = pop.offsetHeight || 480;
  const left = useLeft ? Math.max(12, r.left - pw - 12) : Math.min(innerWidth - pw - 12, r.right + 12);
  const top = Math.max(12, Math.min(innerHeight - ph - 12, r.top + r.height / 2 - ph / 2));
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}
async function showPhotoPop(anchor, v, wallName = '') {
  const u = fullUrls.get(v.id) || thumbs.get(v.id);
  if (!u) return;
  popPhotoId = v.id;
  const pop = ensurePhotoPop(anchor);
  const img = pop.querySelector('img'), cap = pop.querySelector('span');
  img.src = u;
  cap.textContent = [wallName, M.text(v.name) || T('cgPhoto')].filter(Boolean).join(' · ');
  pop.hidden = false;
  try {
    if (pop.matches?.(':popover-open')) pop.hidePopover();
    pop.showPopover?.();
  } catch {}
  placePhotoPop(anchor);
  if (!fullUrls.has(v.id)) {
    const blob = await store.getImage(v).catch(() => null);
    if (blob && state?.photos.has(v.id)) {
      const full = URL.createObjectURL(blob);
      fullUrls.set(v.id, full);
      if (popPhotoId === v.id) {
        img.src = full;
        img.onload = () => { if (popPhotoId === v.id) placePhotoPop(anchor); };
      }
    }
  }
}
function bindPhotoHover(btn, v, wallName = '') {
  btn.addEventListener('mouseenter', () => showPhotoPop(btn, v, wallName));
  btn.addEventListener('mouseleave', hidePhotoPop);
  btn.addEventListener('mousedown', hidePhotoPop);
  btn.addEventListener('dragstart', hidePhotoPop);
}

// ---- 小元件：toast、確認（AppKit.ui）、選單 ----
const { photo: Photo, ui: UI } = globalThis.AppKit;
const toast = (msg) => UI.toast(msg, { ms: 3200 });
/** 刪除這類的確認：紅色按鈕 */
const askConfirm = (title, text, ok) => UI.confirm(text, { title, ok, danger: true });

function openMenu(anchor, items) {
  closeMenu();
  const menu = el('div', { className: 'menu' });
  for (const it of items) {
    if (it === '-') { menu.append(el('hr')); continue; }
    const b = el('button', { textContent: it.label, className: it.danger ? 'danger' : '' });
    b.addEventListener('click', () => { closeMenu(); it.run(); });
    menu.append(b);
  }
  document.body.append(menu);
  const r = anchor.getBoundingClientRect(), w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(r.right - w, innerWidth - w - 8))}px`;
  menu.style.top = `${r.bottom + h + 8 > innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;
  setTimeout(() => document.addEventListener('pointerdown', outside), 0);
}
function outside(e) { if (!e.target.closest('.menu')) closeMenu(); }
function closeMenu() { document.querySelector('.menu')?.remove(); document.removeEventListener('pointerdown', outside); }

// 頂列只有返回和名稱；匯入照片、路線、發佈、匯出、設定都在步驟裡（路線圖的照片條、路線清單的工具列、發佈、岩場資訊）
const BOOK_BUTTONS = ['bookName'];
const home = () => { location.replace('../'); };
/** 岩場頁（沒有打開哪一本）：岩場的作品清單（studio/library.js，路線書轉換來的也在這裡）；新增在首頁的「加資料」 */
function showLibrary() {
  closeBook();
  state = null;
  $('#steps').hidden = true;
  for (const k of BOOK_BUTTONS) $(`#${k}`).hidden = true;
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('on', v.id === 'lib');
  document.title = `${T('stCrag')} · Climbio Studio`;
  StudioLibrary.render($('#lib'), { line: 'crag', open: (r) => StudioLibrary.openRecent(r, toast) });
}

/** 開一本新的（name）並打開：dir 是首頁選的資料夾，沒有就放在瀏覽器裡 */
const SKETCH_LABEL = T('cgSketch');

async function newBook(name, dir = null) {
  const s = M.newBook(name, Date.now());
  await store.create(s.book, [s.map], dir);
  history.replaceState(null, '', '#' + s.book.id);
  await route();
}

// ---- 一本 Guidebook ----
function closeBook() {
  hidePhotoPop();
  closeTopo(false);
  wallMap?.destroy(); wallMap = null;
  if (sketchUrl) URL.revokeObjectURL(sketchUrl);
  sketchUrl = '';
  state = null; activeWall = null; mapUndo = [];
  collapsedAreas.clear();
  for (const u of thumbs.values()) URL.revokeObjectURL(u);
  thumbs.clear();
  for (const u of fullUrls.values()) URL.revokeObjectURL(u);
  fullUrls.clear();
}

async function showBook(id) {
  let loaded = null;
  try { loaded = await store.open(id) && await store.loadBook(); } catch (e) {
    // 資料不完整（檔案缺了、壞了）：說原因，不要停在空白畫面
    console.error('打開', id, e);
    await UI.alert(T('cgIncomplete'), { title: T('cgCantOpenBook') });
    home();
    return;
  }
  if (!loaded) { home(); return; }
  closeBook();
  state = loaded;
  try {
    const savedStep = sessionStorage.getItem(`climbio.studio.step.${id}`);
    step = (savedStep && ['info', 'map', 'walls'].includes(savedStep)) ? savedStep : 'walls';
  } catch {
    step = 'walls';
  }
  // 線尾在兩顆確保站之間橫走的（舊資料、描紅線），打開時就停在確保站中間
  const fixed = [...state.layers.values()].filter(l => M.endAtAnchors(l)).map(l => l.id);
  if (fixed.length) await persist([], fixed);
  if (await store.readRecord()) store.markBook();   // 路線書轉換來的：岩場清單上標「路線書」
  if (P.publishState(state).fromSig === 'open') { P.setPublishState(state, { fromSig: sigNow() }); await persist([], [], state.book.t); }   // 匯入的那一版的內容指紋（開檔的整理做完之後）
  await applyAdopt();
  $('#lib').classList.remove('on');
  $('#book').classList.add('on');
  $('#stepPage').classList.remove('on');
  for (const k of BOOK_BUTTONS) $(`#${k}`).hidden = false;
  $('#steps').hidden = false;
  $('#book').dataset.focus = step === 'map' ? 'map' : step === 'info' ? 'info' : 'side';
  $('#bookName').value = state.book.name || '';
  document.title = `${state.book.name || T('cgUntitled')} · Crag · Climbio Studio`;
  wallMap = new WallMap($('#map'));
  wallMap.sketchBtn.title = wallMap.sketchBtn.ariaLabel = SKETCH_LABEL;
  wallMap.addEventListener('pick', (e) => setActive(e.detail.id, true));
  wallMap.addEventListener('photo', (e) => { location.hash = `${state.book.id}/${e.detail.id}`; });   // 點地圖上照片的視錐：打開那張的路線圖
  // 區域圖（編輯模式）：改形狀前記復原點，改好的存起來；刪掉、畫新的、復原會動到節點，整個重畫
  wallMap.addEventListener('editstart', () => remember());
  wallMap.addEventListener('shape', async (e) => { M.setShape(state, e.detail.mark); await persist(); renderWalls(); });
  wallMap.addEventListener('remove', async (e) => {
    const mark = e.detail.mark;
    const node = mark?.node && state.book.nodes.find(n => n.id === mark.node);
    if (node?.type === 'area') M.deleteArea(state, node.id);
    else M.removeShape(state, mark);
    if (areaPicked === node?.id) areaPicked = null;
    await persist();
    render();
  });
  wallMap.addEventListener('draw', (e) => drawShape(e.detail));
  wallMap.addEventListener('shapeselect', (e) => {
    areaPicked = e.detail.id;
    if (areaPicked) activeWall = areaPicked;
    markArea(true);
  });
  wallMap.addEventListener('undo', () => undoMap());
  wallMap.addEventListener('hint', (e) => toast(e.detail));
  wallMap.addEventListener('sketch', async (e) => { M.setSketch(state, { ...M.sketchOf(state), ...e.detail }); await persist(); });
  wallMap.sketchBtn.addEventListener('click', () => sketchMenu(wallMap.sketchBtn));
  wallMap.setEditing(step === 'map');
  if (step === 'info') renderInfo();
  await showSketch();
  await loadThumbs([...state.photos.keys()]);
  render();
  if (step === 'map') wallMap?.fit();
}

async function loadThumbs(ids) {
  for (const id of ids) {
    if (thumbs.has(id)) continue;
    const t = await store.getThumb(id);
    if (t) thumbs.set(id, URL.createObjectURL(t));
  }
}

/** 存回本機：組合、地圖和給的照片畫面、圖層（t 換成現在） */
async function persist(photoIds = [], layerIds = [], t = Date.now()) {
  state.book.t = t; state.map.t = t;
  const docs = [...photoIds.map(id => state.photos.get(id)), ...layerIds.map(id => state.layers.get(id))].filter(Boolean);
  for (const d of docs) d.t = t;
  await store.saveDocs([state.book, state.map, ...docs]);
}

// ---- 復原（區域圖、路線表格）：改之前記下標註和節點，復原就換回去 ----
let mapUndo = [];
function remember() {
  mapUndo.push(structuredClone({ marks: state.map.marks, nodes: state.book.nodes }));
  if (mapUndo.length > 50) mapUndo.shift();
}
async function undoMap() {
  const last = mapUndo.pop();
  if (!last) { toast(T('cgNothingToUndo')); return; }
  state.map.marks = last.marks; state.book.nodes = last.nodes;
  await persist();
  render();
}

// ---- 路線表格（步驟「路線清單」）：像試算表一樣直接改，欄位照龍洞的路線 Sheet，顯示哪些欄位在岩場資訊的進階設定 ----
const columnKeys = () => shownColumns(M.settings(state).columns, M.routes(state), M.settings(state).numbering === 'manual');
// 手機（appkit/landing.js 加的 ak-handset）：只接著編匯入的岩場，不加照片；路線清單不是試算表，每條路線一列只看編號、名稱、難度，點一列打開路線表單
const handset = document.documentElement.classList.contains('ak-handset');
const tableKeys = () => (handset ? columnKeys().filter(k => ['number', 'name', 'grade'].includes(k)) : columnKeys());
const nodeOf = (id) => state.book.nodes.find(n => n.id === id);
const grid = new Grid($('#walls'), {
  keys: tableKeys,
  off: () => handset,
  text: (row, k) => (row.startsWith('add:') ? '' : cellText(nodeOf(row), k, M.settings(state).grade)),
  // 難度、路線種類用選的（打幾個字縮小範圍，↑↓、Enter 選），不用手打；抱石的難度是抱石的系統
  choices: (k, row) => (k === 'grade' ? GRADES[gradeSysOf(row?.startsWith('add:') ? null : nodeOf(row), M.settings(state).grade)] : k === 'style' ? Object.values(STYLE_LABEL) : null),
  undo: () => undoMap(),
  apply: (changes) => applyCells(changes),
  shift: (d) => shiftRows(d),
  selected: () => renderListBar(),
});
/** 改表格的格子：{ row（路線 id，或 add:<岩壁 id>[#n] 是新的路線）, k, text } */
async function applyCells(changes) {
  const sys = M.settings(state).grade;
  let bad = 0;
  remember();
  const fresh = new Map();   // 新的一列 → { parent, name, props }
  for (const { row, k, text } of changes) {
    if (row.startsWith('add:')) {
      const item = fresh.get(row) || fresh.set(row, { parent: row.slice(4).split('#')[0] || null, name: '', props: {} }).get(row);
      const patch = cellPatch(item, k, text, sys);
      if (patch?.name) item.name = patch.name; else if (patch) item.props = patch.props; else if (text.trim()) bad++;
      continue;
    }
    const r = nodeOf(row);
    const patch = r && cellPatch(r, k, text, sys);
    if (!patch) { bad++; continue; }
    M.updateRoute(state, row, patch.name ? { name: patch.name } : { props: patch.props });
  }
  const rows = [...fresh.keys()].filter(k => fresh.get(k).name);
  const ids = M.addRoutes(state, rows.map(k => fresh.get(k)));
  // 在新增那列打完名稱按 Tab：游標移到新路線的下一格
  const made = rows.indexOf(grid.at?.row);
  if (made >= 0 && grid.at.k !== 'name') grid.at = grid.anchor = { row: ids[made], k: grid.at.k };
  await persist();
  render();
  const nameless = fresh.size - rows.length;
  if (bad || nameless) toast([bad && T('cgBadCells', bad), nameless && T('cgNamelessRows', nameless)].filter(Boolean).join(T('cgSemicolon')));
}
/** 「新增路線」：插在目前那列的下面（沒有選到就接在目前岩壁的最後），名稱框選好直接打 */
async function addRoute() {
  const at = grid.at && !grid.at.row.startsWith('add:') ? nodeOf(grid.at.row) : null;
  const known = new Set(M.walls(state).map(w => w.id));
  // 沒選到路線：加在看得到的岩壁（目前的岩壁，不然是第一面）
  const vis = [...document.querySelectorAll('#walls .wall-card[data-id]')].map(c => c.dataset.id);
  const wall = at ? (known.has(at.parent) ? at.parent : null)
    : vis.length ? (vis.includes(activeWall) ? activeWall : vis[0]) : (known.has(activeWall) ? activeWall : M.walls(state)[0]?.id ?? null);
  if (handset) { openRoute(null, { wall }); return; }
  remember();
  const [id] = M.addRoutes(state, [{ name: T('cgNewRoute'), parent: wall }]);
  if (at) {
    const list = M.routesOf(state, wall), next = list[list.findIndex(r => r.id === at.id) + 1];
    if (next && next.id !== id) M.moveRoutes(state, [id], wall, next.id);
  }
  $('#listSearch').value = '';
  render();
  // 先讓名稱框可以打字，再存檔（不然存檔的時候打的字會不見）
  grid.at = grid.anchor = { row: id, k: 'name' };
  grid.paint();
  grid.edit(true);
  grid.input.select();
  await persist();
}
/** 選到的路線（同一面岩壁、連在一起）往上或往下移一列：路線的順序就是編號 */
async function shiftRows(d) {
  const ids = grid.selectedRows();
  const rows = ids.map(nodeOf).filter(Boolean);
  const known = new Set(M.walls(state).map(w => w.id)), wallOf = (r) => (known.has(r.parent) ? r.parent : null);
  if (!rows.length || rows.some(r => wallOf(r) !== wallOf(rows[0]))) return;
  const wall = wallOf(rows[0]), list = M.routesOf(state, wall);
  const at = ids.map(id => list.findIndex(r => r.id === id)).sort((a, b) => a - b);
  if (d < 0 ? at[0] === 0 : at[at.length - 1] === list.length - 1) return;
  const before = d < 0 ? list[at[0] - 1].id : list[at[at.length - 1] + 2]?.id;
  remember();
  M.moveRoutes(state, at.map(i => list[i].id), wall, before);
  await persist();
  render();
}
async function deleteRows() {
  const ids = grid.selectedRows();
  if (!ids.length || !(await askConfirm(T('cgDeleteRoutesQ', ids.length), T('cgRouteDeleteNote'), T('cgDelete')))) return;
  remember();
  const layers = M.removeRoutes(state, ids);
  await persist([], layers);
  render();
}
// ---- 拖曳換位置（路線清單）：用 SortableJS（MIT，studio/vendor/）。拖的東西跟著游標走，其他的即時讓位，放開才存 ----
//   路線：長按一列（選整列，選了好幾列就一起）按著拖，可以拖到別面岩壁、未分配、新岩壁（拖的時候才出現）；
//   岩壁、區域：按著標題拖（名稱框、按鈕以外），區域連底下的岩壁一起搬、在同一層換位置；岩壁可以拖進別的區域
//   靠近清單上下緣會捲動
const HOLD_MS = 450;   // 跟 grid.js 長按選整列一樣久
function sortable() {
  const S = globalThis.Sortable;
  const common = { animation: 150, forceFallback: true, fallbackOnBody: true, fallbackTolerance: 4, scroll: true, scrollSensitivity: 60, bubbleScroll: true, ghostClass: 'drag-ghost', chosenClass: 'drag-chosen', dragClass: 'drag-float' };
  // 路線
  let ids = [];
  for (const body of document.querySelectorAll('#walls tbody[data-wall]')) {
    S.create(body, {
      ...common, group: 'routes', draggable: 'tr.route', filter: '.grid-input.on', preventOnFilter: false, delay: HOLD_MS, delayOnTouchOnly: false, touchStartThreshold: 6,
      onStart: (e) => {
        const id = e.item.dataset.row, sel = grid.selectedRows();
        ids = sel.length > 1 && sel.includes(id) ? sel : [id];
        // 放置區（沒有路線的未分配、新岩壁）放在最下面才出現：上面的列不會跳
        for (const x of document.querySelectorAll('#walls .wall-card.loose[hidden], #walls .new-wall')) { x.hidden = false; $('#walls').append(x); }
        document.body.classList.add('row-drag');
      },
      onEnd: async (e) => {
        document.body.classList.remove('row-drag');
        const to = e.to;   // 拖的途中存檔重畫過，拖的列可能已經不在畫面上：照 Sortable 記的容器
        if (e.from === to && e.oldIndex === e.newIndex) { render(); return; }
        let next = e.item.nextElementSibling;
        while (next && (!next.matches('tr.route') || ids.includes(next.dataset.row))) next = next.nextElementSibling;
        remember();
        await moveRoutesTo(ids, to.dataset.wall || null, to.dataset.wall === 'new' ? undefined : next?.dataset.row);   // 會重畫
      },
    });
  }
  // 岩壁、區域
  for (const box of document.querySelectorAll('#walls .wall-tree, #walls .area-body')) {
    S.create(box, {
      ...common, group: { name: 'nodes', put: (to, from, item) => item.matches('.wall-card') },   // 別的容器只收岩壁卡（區域在同一層換位置，路線列不收）
      draggable: '.wall-card[data-id], section.area', handle: '.whead, h4.group',
      filter: 'input, select, button', preventOnFilter: false,
      onEnd: async (e) => {
        if (e.from === e.to && e.oldIndex === e.newIndex) return;
        const id = e.item.dataset.id, parent = e.to.dataset.parent || null;
        // 放在後面第一個看得到的兄弟前面；最後面就接在前面那個後面（中間可能有清單上沒列的節點）
        let next = e.item.nextElementSibling;
        while (next && (next.hidden || !next.dataset.id)) next = next.nextElementSibling;
        let before = next?.dataset.id;
        if (!before) {
          let prev = e.item.previousElementSibling;
          while (prev && (prev.hidden || !prev.dataset.id)) prev = prev.previousElementSibling;
          const sibs = M.childrenOf(state, parent).filter(n => n.id !== id), i = prev ? sibs.findIndex(n => n.id === prev.dataset.id) : -1;
          before = prev ? sibs[i + 1]?.id : sibs[0]?.id;
        }
        remember();
        M.moveNode(state, id, parent, before);
        await persist();
        render();
      },
    });
  }
}

/** 搜尋：名稱、難度、首攀、說明……任何一格有這段字的路線；沒有符合的岩壁整張藏起來 */
/** 搜尋和篩選：藏起不符合的路線，沒有符合的岩壁、區域標題也藏起來 */
function applySearch() {
  const q = $('#listSearch').value.trim().toLowerCase();
  const on = !!q || filter.bands.length + filter.styles.length > 0 || filter.undrawn;
  for (const tr of document.querySelectorAll('#walls tr.route')) {
    const r = nodeOf(tr.dataset.row);
    tr.hidden = (!!q && !tr.textContent.toLowerCase().includes(q)) || (r && !passFilter(r));
  }
  for (const c of document.querySelectorAll('#walls .wall-card')) if (c.querySelector('tr.route')) c.hidden = on && !c.querySelector('tr.route:not([hidden])');
  for (const h of document.querySelectorAll('#walls .group')) h.hidden = on;
}
function renderListBar() {
  const n = grid.selectedRows().length;
  $('#lDel').hidden = !n;
  $('#lDel').title = n ? T('cgDeleteNRoutes', n) : '';
}
$('#lUndo').addEventListener('click', () => undoMap());
$('#lAdd').addEventListener('click', () => addRoute());
// 這本加資料：照片、貼上路線表（手機都沒有）；新的一本、路線書、岩場站從 Studio 的「加資料」進
$('#lImport').hidden = handset;
$('#lImport').addEventListener('click', async () => {
  const pick = (await UI.ask({ title: T('cgImport'), choices: [{ label: T('cgImportPhotos'), value: 'photos' }, { label: T('cgPasteTable'), value: 'table' }], buttons: [{ label: T('cancel') }] }))?.button;
  if (pick === 'photos') $('#fileInput').click();
  else if (pick === 'table') openPaste();
});
if (handset) $('#walls').addEventListener('click', (e) => { const tr = e.target.closest('tr.route'); if (tr && !document.body.classList.contains('row-drag')) openRoute(tr.dataset.row); });
$('#pasteCsv').addEventListener('click', () => $('#csvInput').click());
$('#lDel').addEventListener('click', () => deleteRows());
// 搜尋時看全部的大區域：有沒有搜尋字變了才重畫
let searching = false;
$('#listSearch').addEventListener('input', () => {
  const q = !!$('#listSearch').value.trim();
  if (q !== searching) { searching = q; renderWalls(); return; }
  applySearch();
  grid.paint();
});
document.addEventListener('keydown', (e) => {
  if (!state || topo || step !== 'walls' || !(e.ctrlKey || e.metaKey) || document.querySelector('dialog[open]')) return;
  if (e.key.toLowerCase() === 'f') { e.preventDefault(); $('#listSearch').focus(); $('#listSearch').select(); }   // 找路線
  else if (e.key === 'Enter') { e.preventDefault(); addRoute(); }   // Ctrl＋Enter 新增一條
});
/** 區域圖畫好的形狀：替已有的節點畫的就接上去；新的用預設名稱（區域 n、岩壁 n、岩石 n），在右邊的清單直接改名；步道只有標註 */
async function drawShape({ kind, geometry, node }) {
  remember();
  const id = M.addShape(state, kind, geometry, '', node);
  await persist();
  render();
  if (!id) return;
  wallMap.selectNode(id);
  if (!node) { const input = document.querySelector(`#areas .area-row[data-id="${id}"] input`); input?.focus(); input?.select(); }
}

// ---- 區域圖的右邊：區域清單（不放路線）。區域、岩壁、岩石照節點樹；點一列選地圖上的形狀，點地圖這裡跟著亮；還沒有形狀的「畫範圍／畫牆線」；每面岩壁底下顯示歸入的照片縮圖；最上面「上傳場館配置圖」與「新增區域」 ----
let areaPicked = null;
const collapsedAreas = new Set();

function renderAreas() {
  const box = $('#areas');
  if (step !== 'map' || topo) { box.hidden = true; return; }
  box.hidden = false;
  const byId = new Map(state.book.nodes.map(n => [n.id, n]));
  const shaped = new Set(state.map.marks.filter(m => m.node).map(m => m.node));
  const isWall = (n) => ['wall', 'sector'].includes(n.type);
  const collapsibleIds = [];
  const GRIP_SVG = '<svg viewBox="0 0 24 24"><circle cx="9" cy="5" r="1.8"/><circle cx="15" cy="5" r="1.8"/><circle cx="9" cy="12" r="1.8"/><circle cx="15" cy="12" r="1.8"/><circle cx="9" cy="19" r="1.8"/><circle cx="15" cy="19" r="1.8"/></svg>';
  const FOLD_OPEN_SVG = '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>';
  const FOLD_CLOSED_SVG = '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>';

  const walk = (parentId, depth, into) => {
    const sibs = M.childrenOf(state, parentId).filter(x => ['area', 'crag', 'wall', 'sector'].includes(x.type));
    for (const n of sibs) {
      const mark = state.map.marks.find(m => m.node === n.id);
      const rock = isWall(n) && /Polygon/.test(mark?.geometry?.type ?? '');
      const wallPhotos = isWall(n) ? M.photosOf(state, n.id) : [];
      const childNodes = !isWall(n) ? M.childrenOf(state, n.id).filter(x => ['area', 'crag', 'wall', 'sector'].includes(x.type)) : [];
      const canCollapse = isWall(n) ? wallPhotos.length > 0 : childNodes.length > 0;
      if (canCollapse) collapsibleIds.push(n.id);
      const isCollapsed = collapsedAreas.has(n.id);

      const grip = el('span', { className: 'drag-grip', innerHTML: GRIP_SVG, title: T('cgDragWallTip') });
      const foldBtn = canCollapse ? (() => {
        const b = el('button', {
          type: 'button',
          className: 'fold',
          innerHTML: isCollapsed ? FOLD_CLOSED_SVG : FOLD_OPEN_SVG,
          title: isCollapsed ? T('cgExpandPhotos') : T('cgCollapsePhotos'),
          ariaLabel: isCollapsed ? T('cgExpand') : T('cgCollapse'),
          ariaExpanded: String(!isCollapsed),
        });
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          if (collapsedAreas.has(n.id)) collapsedAreas.delete(n.id);
          else collapsedAreas.add(n.id);
          renderAreas();
        });
        return b;
      })() : null;

      const dot = el('span', { className: 'dot', title: T('cgDragTip') });
      const name = el('input', { value: M.text(n.name), ariaLabel: T('cgName'), maxLength: 80 });
      name.addEventListener('focus', () => pickArea(n.id));
      name.addEventListener('change', async () => { remember(); const node = byId.get(n.id); node.name = M.withText(node.name, name.value.trim() || M.text(node.name)); await persist(); render(); });
      const kindText = isWall(n) ? (rock ? T('cgRock') : T('cgPhotosN', wallPhotos.length)) : T('cgArea');
      const kids = [grip, ...(foldBtn ? [foldBtn] : []), dot, name, el('span', { className: 'kind', textContent: kindText })];
      const more = el('button', { className: 'icon-btn more', type: 'button', innerHTML: ICON.more, ariaLabel: isWall(n) ? T('cgWallActions') : T('cgAreaActions') });
      more.addEventListener('click', (e) => { e.stopPropagation(); if (isWall(n)) wallMenu(more, n); else areaMenu(more, n); });
      kids.push(more);
      if (!shaped.has(n.id)) {
        const draw = el('button', { className: 'draw', type: 'button', textContent: isWall(n) ? T('cgDrawWall') : T('cgDrawArea') });
        draw.addEventListener('click', (e) => { e.stopPropagation(); wallMap.startDraw(isWall(n) ? 'wall' : 'area', n.id); });
        kids.push(draw);
      }
      const row = el('div', { className: `area-row${isWall(n) ? ' wall' : ''}${depth === 0 ? ' top' : ''}${n.id === areaPicked ? ' on' : ''}`, dataset: { id: n.id, parent: parentId || '' } }, ...kids);
      row.style.setProperty('--depth', depth);
      if (tint.has(n.id)) row.style.setProperty('--wc', tint.get(n.id));
      row.addEventListener('click', (e) => { if (e.target === row || e.target.closest('.drag-grip') || e.target.classList.contains('dot') || e.target.classList.contains('kind')) pickArea(n.id); });

      const item = el('div', { className: `area-item${isWall(n) ? ' wall-item' : ' area-group'}`, dataset: { id: n.id } }, row);

      if (isWall(n)) {
        const bindWallDrop = (target) => {
          target.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('text/climbio-photo')) { e.preventDefault(); target.classList.add('on'); } });
          target.addEventListener('dragleave', () => { target.classList.toggle('on', target === row && n.id === areaPicked); });
          target.addEventListener('drop', (e) => {
            const pid = e.dataTransfer?.getData('text/climbio-photo');
            if (!pid) return;
            e.preventDefault(); e.stopPropagation();
            target.classList.toggle('on', target === row && n.id === areaPicked);
            moveTo([pid], n.id);
          });
        };
        bindWallDrop(row);
        if (wallPhotos.length && !isCollapsed) {
          const strip = el('div', { className: 'area-photos', dataset: { wall: n.id } }, ...wallPhotos.map(v => {
            const b = el('button', { type: 'button', className: 'aphoto', draggable: true, title: T('cgPhotoTip', M.text(v.name) || T('cgPhoto')), dataset: { photo: v.id } });
            if (thumbs.get(v.id)) b.style.backgroundImage = `url("${thumbs.get(v.id)}")`;
            bindPhotoHover(b, v, M.text(n.name));
            b.addEventListener('click', (e) => { e.stopPropagation(); hidePhotoPop(); pickArea(n.id); photoMenu(v.id, b); });
            b.addEventListener('dblclick', (e) => { e.stopPropagation(); closeMenu(); hidePhotoPop(); location.hash = `${state.book.id}/${v.id}`; });
            b.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); hidePhotoPop(); photoMenu(v.id, b); });
            b.addEventListener('dragstart', (e) => { closeMenu(); hidePhotoPop(); e.dataTransfer.setData('text/climbio-photo', v.id); });
            return b;
          }));
          strip.style.setProperty('--depth', depth);
          bindWallDrop(strip);
          item.append(strip);
        }
      } else if (!isCollapsed) {
        const sub = el('div', { className: 'area-children', dataset: { parent: n.id } });
        walk(n.id, depth + 1, sub);
        item.append(sub);
      }
      into.append(item);
    }
  };
  tint = M.colors(state);
  const rootList = el('div', { className: 'area-list', dataset: { parent: '' } });
  walk(null, 0, rootList);
  const foldAllBtn = collapsibleIds.length > 0 ? (() => {
    const anyExpanded = collapsibleIds.some(id => !collapsedAreas.has(id));
    const b = el('button', {
      className: 'btn fold-all-btn',
      type: 'button',
      textContent: anyExpanded ? T('cgCollapseAll') : T('cgExpandAll'),
    });
    b.addEventListener('click', () => {
      if (anyExpanded) for (const id of collapsibleIds) collapsedAreas.add(id);
      else collapsedAreas.clear();
      renderAreas();
    });
    return b;
  })() : null;
  const add = el('button', { className: 'btn add', type: 'button' });
  add.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>' + T('cgAddArea');
  add.addEventListener('click', () => wallMap.startDraw('area'));
  const actBar = el('div', { className: 'area-acts' }, ...(foldAllBtn ? [foldAllBtn] : []), add);
  box.replaceChildren(actBar, ...cragPositionRow(), rootList);

  const S = globalThis.Sortable;
  if (S) {
    const common = {
      animation: 150,
      forceFallback: true,
      fallbackOnBody: true,
      fallbackTolerance: 4,
      scroll: true,
      scrollSensitivity: 60,
      bubbleScroll: true,
      ghostClass: 'drag-ghost',
      chosenClass: 'drag-chosen',
      dragClass: 'drag-float',
    };
    for (const listEl of box.querySelectorAll('.area-list, .area-children')) {
      S.create(listEl, {
        ...common,
        group: { name: 'area-nodes', put: (to, from, item) => item.matches('.area-item.wall-item') || to === from },
        draggable: '.area-item',
        handle: '.area-row',
        filter: 'input, select, button',
        preventOnFilter: false,
        onEnd: async (e) => {
          if (e.from === e.to && e.oldIndex === e.newIndex) return;
          const id = e.item.dataset.id;
          const parent = e.to.dataset.parent || null;
          let next = e.item.nextElementSibling;
          while (next && (!next.classList.contains('area-item') || !next.dataset.id)) next = next.nextElementSibling;
          const before = next?.dataset.id;
          remember();
          M.moveNode(state, id, parent, before);
          await persist();
          render();
        },
      });
    }
  }
}
/** 岩場位置：貼 Google 地圖複製的「緯度, 經度」，發佈時照片沒有拍攝位置就用它放紅點貓的世界地圖；只有有岩場節點的書才有 */
function cragPositionRow() {
  if (!M.cragOf(state)) return [];
  const [lng, lat] = M.cragPosition(state) ?? [];
  const input = el('input', { className: 'field', value: lat === undefined ? '' : `${lat}, ${lng}`, placeholder: T('cgLatLng'), ariaLabel: T('cgCragPos'), spellcheck: false, autocomplete: 'off' });
  input.addEventListener('change', async () => {
    const text = input.value.trim();
    const position = M.parsePosition(text);
    if (text && !position) { toast(T('cgPosFormat')); input.value = lat === undefined ? '' : `${lat}, ${lng}`; return; }
    remember();
    M.setCragPosition(state, position);
    await persist();
  });
  return [el('label', { className: 'crag-pos' }, el('span', { textContent: T('cgCragPos') }), input)];
}
/** 清單選一列：地圖選到它的形狀（沒有形狀就只亮這列） */
function pickArea(id) {
  if (areaPicked === id) return;
  areaPicked = id;
  markArea(false);
  wallMap?.selectNode(id);
}
function markArea(toTop = false) {
  for (const r of document.querySelectorAll('#areas .area-row')) r.classList.toggle('on', r.dataset.id === areaPicked);
  for (const p of document.querySelectorAll('#areas .area-photos')) p.classList.toggle('on', p.dataset.wall === areaPicked);
  const row = document.querySelector(`#areas .area-row[data-id="${areaPicked}"]`);
  if (!row) return;
  if (toTop) {
    const box = $('#areas');
    const actH = box?.querySelector('.area-acts')?.offsetHeight || 0;
    if (box) box.scrollTo({ top: Math.max(0, row.offsetTop - actH - 8), behavior: 'smooth' });
  } else {
    row.scrollIntoView({ block: 'nearest' });
  }
}

function render() {
  renderWalls();
  renderMap();
  renderAreas();
  renderSteps();
}

// ---- 示意圖：疊在岩壁地圖底下，對準後照著拖牆線 ----
let sketchUrl = '';
async function showSketch() {
  if (sketchUrl) URL.revokeObjectURL(sketchUrl);
  const s = M.sketchOf(state), img = s && await store.getImage(s);
  sketchUrl = img ? URL.createObjectURL(img) : '';
  wallMap?.setSketch(sketchUrl ? s : null, sketchUrl);
}

async function pasteSketchFromClipboard() {
  const label = SKETCH_LABEL.toLowerCase();
  if (!navigator.clipboard?.read) { toast(T('cgPressPaste', label)); return; }
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find(t => t.startsWith('image/'));
      if (type) {
        const blob = await item.getType(type);
        await applySketchFile(new File([blob], `sketch.${type.split('/')[1] || 'png'}`, { type }));
        toast(T('cgPastedClip', label));
        return;
      }
    }
    toast(T('cgNoImageClip'));
  } catch {
    toast(T('cgPressPasteKb', label));
  }
}

function sketchMenu(anchor) {
  if (wallMap.aligning) { wallMap.alignSketch(false); return; }
  const label = SKETCH_LABEL.toLowerCase();
  if (!M.sketchOf(state)) {
    openMenu(anchor, [
      { label: T('cgSketchPick', label), run: () => $('#sketchInput').click() },
      { label: T('cgSketchPaste', label), run: () => pasteSketchFromClipboard() },
    ]);
    return;
  }
  openMenu(anchor, [
    { label: T('cgSketchAlign', label), run: () => wallMap.alignSketch(true) },
    { label: T('cgSketchReplace', label), run: () => $('#sketchInput').click() },
    { label: T('cgSketchPaste', label), run: () => pasteSketchFromClipboard() },
    '-',
    { label: T('cgSketchRemove', label), danger: true, run: async () => {
      const old = M.sketchOf(state);
      M.setSketch(state, undefined);
      await persist(); await store.removeDocs([old.id]);
      await showSketch();
      renderAreas();
    } },
  ]);
}

async function applySketchFile(file) {
  if (!file || !state) return;
  const frame = wallMap?.frame() || { center: [121.535, 25.042], width: 60 };
  let p;
  try { p = await Photo.prepare(file); } catch (err) { console.warn('示意圖', err); toast(T('cgReadImageFail')); return; }
  const old = M.sketchOf(state), id = M.newId();
  await store.saveImage({ id }, p.image);
  // 換圖時沿用原本的位置、寬度與旋轉；第一次放在畫面中間，寬度是畫面的八成
  M.setSketch(state, old ? { ...old, id, w: p.w, h: p.h } : { id, w: p.w, h: p.h, center: frame.center, width: Math.round(frame.width * 8) / 10, rotation: 0 });
  await persist();
  if (old) await store.removeDocs([old.id]);
  if (!wallMap?.frame()) renderMap();
  await showSketch();
  wallMap?.alignSketch(true);
  renderAreas();
}
$('#sketchInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  await applySketchFile(file);
});

function renderMap() {
  if (!wallMap) return;
  wallMap.setData({
    map: state.map,
    nodes: state.book.nodes,
    shots: [...state.photos.values()].filter(p => located(p.camera)).map(p => p.camera.position.slice(0, 2)),
    wedges: [...state.photos.values()].map(p => { const w = photoWedge(p.camera, p.h > p.w); return w && { id: p.id, wall: p.props?.node, ...w }; }).filter(Boolean),
    sketch: M.sketchOf(state),
  });
  wallMap.select(activeWall);
}

function setActive(id, scroll) {
  activeWall = id;
  wallMap?.select(id);
  for (const c of document.querySelectorAll('.wall-card')) c.classList.toggle('on', c.dataset.id === id);
  if (scroll && id) document.querySelector(`.wall-card[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

let done = new Map();   // 畫過線的路線（M.drawn）：renderWalls 時算一次
let tint = new Map();   // 區域、岩壁的顏色（M.colors）
let bigArea = null, bigFor = null;   // 路線清單看哪個大區域；目前的岩壁換了（例如從路線圖回來）就換到它的大區域
/** 大區域：從最上層往下，第一層分成兩個以上（底下有岩壁）的節點；只有岩壁、沒有區域就不分 */
function bigAreas(walls) {
  const byId = new Map(state.book.nodes.map(n => [n.id, n]));
  const holds = new Set(), wallIds = new Set(walls.map(w => w.id));
  for (const w of walls) for (let n = w, guard = 0; n && guard < 50; n = byId.get(n.parent), guard++) holds.add(n.id);
  let kids = M.childrenOf(state, null).filter(n => holds.has(n.id));
  for (let guard = 0; kids.length === 1 && !wallIds.has(kids[0].id) && guard < 50; guard++) kids = M.childrenOf(state, kids[0].id).filter(n => holds.has(n.id));
  return kids.length > 1 && kids.some(n => !wallIds.has(n.id)) ? kids : [];
}
function renderWalls() {
  const list = $('#walls');
  done = M.drawn(state);
  tint = M.colors(state);
  const walls = M.walls(state);
  const loose = M.routesOf(state, null);
  // 還沒有岩壁：匯入照片，或直接在「未分配」的表格打路線
  const start = [];
  if (!walls.length) {
    const b = el('button', { className: 'btn primary', textContent: T('cgImportPhotos') });
    b.addEventListener('click', () => $('#fileInput').click());
    if (!loose.length && !handset) start.push(el('div', { className: 'empty' }, b));
  }
  const byId = new Map(state.book.nodes.map(n => [n.id, n]));
  const inside = (id, areaId) => { for (let n = byId.get(id), guard = 0; n && guard < 50; n = byId.get(n.parent), guard++) if (n.id === areaId) return true; return false; };
  // 分大區域看（兩個以上才分）：上面一排大區域，一次看一個；搜尋時看全部
  const tabs = $('#listSearch').value.trim() ? [] : bigAreas(walls);
  const own = tabs.find(t => activeWall && inside(activeWall, t.id));
  if (own && activeWall !== bigFor) bigArea = own.id;
  bigFor = activeWall;
  if (tabs.length && !tabs.some(t => t.id === bigArea)) bigArea = tabs[0].id;
  const cur = tabs.find(t => t.id === bigArea);
  const shown = cur ? walls.filter(w => inside(w.id, cur.id)) : walls;
  // 岩壁照節點樹排：區、岩場這類上層是一個區塊（標題＋底下的岩壁、區域；只列底下有岩壁的），層數不限；目前的大區域和它上面的不重複當標題。
  // 每一層的容器記著上層的 id（data-parent），拖曳換位置時照容器決定放進哪裡
  const tree = el('div', { className: 'wall-tree', dataset: { parent: cur?.id || '' } });
  {
    const wallIds = new Set(shown.map(w => w.id));
    const above = new Set(), skip = new Set();
    for (const w of shown) for (let p = byId.get(w.parent), guard = 0; p && guard < 50; p = byId.get(p.parent), guard++) above.add(p.id);
    for (let p = cur, guard = 0; p && guard < 50; p = byId.get(p.parent), guard++) skip.add(p.id);
    const walk = (parentId, depth, into) => {
      for (const n of M.childrenOf(state, parentId)) {
        if (wallIds.has(n.id)) into.append(wallCard(n));
        else if (skip.has(n.id)) walk(n.id, depth, into);
        else if (above.has(n.id)) {
          const h = el('h4', { className: `group d${Math.min(depth, 2)}`, textContent: M.text(n.name) || T('cgUntitled') });
          const body = el('div', { className: 'area-body', dataset: { parent: n.id } });
          const sec = el('section', { className: 'area', dataset: { id: n.id } }, h, body);
          if (tint.has(n.id)) h.style.setProperty('--wc', tint.get(n.id));
          into.append(sec);
          walk(n.id, depth + 1, body);
        }
      }
    };
    walk(null, 0, tree);
  }
  const looseCard = el('div', { className: 'wall-card loose', hidden: !loose.length && walls.length > 0 },
    el('div', { className: 'whead' }, el('span', { className: 'title', textContent: T('cgUnassigned') }), el('span', { className: 'count', textContent: loose.length ? T('cgRoutesN', loose.length) : '' })),
    routeTable(null, loose));
  // 拖曳路線時才出現：放到這裡開一面新的岩壁
  const fresh = el('div', { className: 'new-wall', hidden: true }, el('span', { textContent: T('cgNewWall') }), el('table', {}, el('tbody', { dataset: { wall: 'new' } })));
  const head = gridHead();
  const chips = filterBar([...loose, ...shown.flatMap(w => M.routesOf(state, w.id))]);
  if (chips) head.prepend(chips);
  if (tabs.length) head.prepend(el('div', { className: 'area-tabs', role: 'tablist' }, ...tabs.map(t => {
    const n = walls.filter(w => inside(w.id, t.id)).reduce((s, w) => s + M.routesOf(state, w.id).length, 0);
    const b = el('button', { type: 'button', role: 'tab', className: t.id === bigArea ? 'on' : '', ariaSelected: String(t.id === bigArea), dataset: { id: t.id } },
      el('span', { className: 'dot' }), el('span', { textContent: M.text(t.name) || T('cgUntitled') }), el('small', { textContent: String(n) }));
    if (tint.has(t.id)) b.style.setProperty('--wc', tint.get(t.id));
    b.addEventListener('click', () => { bigArea = t.id; renderWalls(); list.scrollTop = 0; });
    return b;
  })));
  list.replaceChildren(...start, ...(start.length ? [] : [head, looseCard]), tree, fresh);   // 空的專案：主畫面只有匯入（工具列的新增照樣能直接打路線）
  applySearch();
  sortable();
  grid.paint();
}

/** 岩壁卡（路線清單）：名稱、照片小圖預覽、路線數和路線表格。岩壁的合併與刪除在區域圖 */
function wallCard(w) {
  const name = el('input', { value: M.text(w.name), ariaLabel: T('cgWallName'), maxLength: 80 });
  name.addEventListener('change', async () => { M.renameWall(state, w.id, name.value.trim()); await persist(); renderMap(); });
  const routes = M.routesOf(state, w.id);
  const photos = M.photosOf(state, w.id).map(v => {
    const b = el('button', { type: 'button', className: 'wphoto', title: M.text(v.name) || T('cgPhoto'), dataset: { photo: v.id } });
    if (thumbs.get(v.id)) b.style.backgroundImage = `url("${thumbs.get(v.id)}")`;
    bindPhotoHover(b, v, M.text(w.name));
    b.addEventListener('click', (e) => { e.stopPropagation(); hidePhotoPop(); location.hash = `${state.book.id}/${v.id}`; });
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); hidePhotoPop(); photoMenu(v.id, b); });
    return b;
  });
  const head = el('div', { className: 'whead' }, name, ...photos, el('span', { className: 'count', textContent: routes.length ? T('cgRoutesN', routes.length) : '' }));
  const card = el('div', { className: `wall-card${w.id === activeWall ? ' on' : ''}`, dataset: { id: w.id } }, head, routeTable(w.id, routes));
  if (tint.has(w.id)) card.style.setProperty('--wc', tint.get(w.id));
  return card;
}

/** 欄寬：每個表格（每面岩壁一個）和上面的欄名用同一組，欄才會對齊；至少放得下欄名；路線資訊描述吃剩下的寬度，側欄太窄才橫向捲動 */
const labelW = (s) => Math.ceil([...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 13 : 7.5), 0) + 18);
const colW = (k) => { const c = COLUMNS.find(x => x.key === k); return Math.max(c.width, labelW(c.label)); };
const NUM_W = 52, DRAWN_W = labelW(T('cgTopo'));
const fluid = (k) => k === 'description' || (handset && k === 'name');   // 剩下的寬度給這欄（手機的名稱：表格剛好是螢幕寬）
const colgroup = (keys) => {
  const col = (w) => { const c = el('col'); if (w) c.style.width = `${w}px`; return c; };
  return el('colgroup', {}, col(NUM_W), ...keys.map(k => col(fluid(k) ? 0 : colW(k))), col(DRAWN_W));
};
const gridTable = (keys, ...kids) => {
  const t = el('table', { className: 'grid' }, colgroup(keys), ...kids);
  t.style.minWidth = `${NUM_W + DRAWN_W + keys.reduce((s, k) => s + (handset && fluid(k) ? 0 : colW(k)), 0)}px`;
  return t;
};
function gridHead() {
  const keys = tableKeys();
  return el('div', { className: 'grid-head' }, gridTable(keys,
    el('thead', {}, el('tr', {}, el('th'), ...keys.map(k => el('th', { textContent: COLUMNS.find(x => x.key === k).label })), el('th', { textContent: T('cgTopo') })))));
}

// ---- 篩選（跟龍洞一樣的膠囊，可複選；同一組任一個、不同組都要符合）：難度區間、路線種類、還沒畫路線圖。只列這一區有的，兩個以上才列 ----
let filter = { bands: [], styles: [], undrawn: false };
/** 難度區間：YDS 5.9-／5.10／5.11／5.12／5.13+；V 每三級一段；Font 6A–6C 這樣一段（跟法式分得開）；其他照開頭的數字（≤5、6、7、8+） */
function gradeBand(g, sys) {
  if (!g) return '';
  if (sys === 'font') { const n = Number(/^(\d+)/.exec(g)?.[1]); return !n ? '' : n <= 5 ? '5+-' : n >= 8 ? '8A+' : `${n}A–${n}C`; }
  if (sys === 'yds') { const n = Number(/^5\.(\d+)/.exec(g)?.[1]); return !n ? '' : n <= 9 ? '5.9-' : n >= 13 ? '5.13+' : `5.${n}`; }
  if (sys === 'v') { const n = Number(/^V(\d+)/i.exec(g)?.[1]); if (Number.isNaN(n) || !/^V\d/i.test(g)) return ''; const lo = Math.min(9, Math.floor(n / 3) * 3); return lo >= 9 ? 'V9+' : `V${lo}–V${lo + 2}`; }
  const n = Number(/^(\d+)/.exec(g)?.[1]);
  return !n ? '' : n <= 5 ? '5-' : n >= 8 ? '8+' : String(n);
}
function filterBar(routes) {
  const sys = M.settings(state).grade;
  const styleLabels = STYLE_LABEL;
  const bandOf = (r) => gradeBand(cellText(r, 'grade', sys), gradeSysOf(r, sys));
  const have = new Set(routes.map(bandOf));
  const order = [sys, gradeSysOf({ props: { style: 'boulder' } }, sys)].flatMap(s => (GRADES[s] || []).map(g => gradeBand(g, s)));   // 上攀的區間在前、抱石的在後
  const bands = [...new Set([...order, ...have])].filter(b => b && have.has(b));
  const styles = Object.keys(styleLabels).filter(k => routes.some(r => r.props?.style === k));
  const undrawn = routes.some(r => !done.has(r.id)) && routes.some(r => done.has(r.id));
  // 這一區沒有的選項：從篩選拿掉（不然藏起來的條件還在作用）
  filter = { bands: filter.bands.filter(b => bands.includes(b)), styles: filter.styles.filter(k => styles.includes(k)), undrawn: filter.undrawn && undrawn };
  const groups = [];
  const chip = (label, on, toggle) => {
    const b = el('button', { type: 'button', className: 'chip', textContent: label });
    b.setAttribute('aria-pressed', String(on));
    b.addEventListener('click', () => { toggle(); b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); applySearch(); grid.paint(); });
    return b;
  };
  const flip = (list, v) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);
  if (bands.length > 1) groups.push(bands.map(v => chip(v, filter.bands.includes(v), () => { filter.bands = flip(filter.bands, v); })));
  if (styles.length > 1) groups.push(styles.map(k => chip(styleLabels[k], filter.styles.includes(k), () => { filter.styles = flip(filter.styles, k); })));
  if (undrawn) groups.push([chip(T('cgNoTopo'), filter.undrawn, () => { filter.undrawn = !filter.undrawn; })]);
  if (!groups.length) return null;
  return el('div', { className: 'chips', role: 'group', ariaLabel: T('cgFilter') }, ...groups.flatMap((g, i) => (i ? [el('span', { className: 'chip-sep' }), ...g] : g)));
}
function passFilter(r) {
  const sys = M.settings(state).grade;
  if (filter.bands.length && !filter.bands.includes(gradeBand(cellText(r, 'grade', sys), gradeSysOf(r, sys)))) return false;
  if (filter.styles.length && !filter.styles.includes(r.props?.style)) return false;
  if (filter.undrawn && done.has(r.id)) return false;
  return true;
}

function routeTable(wallId, routes) {
  const keys = tableKeys();
  return gridTable(keys, el('tbody', { dataset: { wall: wallId || '' } }, ...routes.map((r, i) => routeRow(r, i, keys))));
}

function routeRow(r, i, keys) {
  const sys = M.settings(state).grade;
  const CLASS = { name: 'rname', grade: 'grade' };
  // 編號那格：點了選整列（手動編號時編號在「路線編號」欄，這格空著）
  const manual = M.settings(state).numbering === 'manual';
  return el('tr', { className: 'route', dataset: { id: r.id, row: r.id } }, el('td', { className: 'num', textContent: manual ? '' : M.routeNumber(state, r.id) ?? `${i + 1}` }),
    ...keys.map(k => el('td', { className: CLASS[k] || '', textContent: cellText(r, k, sys), dataset: { k } })),
    el('td', { className: `dr${done.has(r.id) ? ' here' : ''}`, textContent: done.has(r.id) ? '✓' : '', title: done.has(r.id) ? T('cgTopoDone') : T('cgTopoNotDrawn') }));
}

async function moveTo(ids, wallId) {
  const target = M.movePhotos(state, ids, wallId);
  activeWall = target;
  await persist(ids);
  render();
}

/** 路線移到岩壁（null：未分配；'new'：開一面新的），插在 before 前面 */
async function moveRoutesTo(ids, wallId, before) {
  const target = wallId === 'new' ? M.addWall(state) : wallId;
  const dups = ids.map(id => state.book.nodes.find(n => n.id === id)).filter(r => r && M.findDuplicate(state, r.name, target, r.id) && !ids.includes(M.findDuplicate(state, r.name, target, r.id).id));
  M.moveRoutes(state, ids, target, before);
  if (target) activeWall = target;
  await persist();
  render();
  if (dups.length) toast(dups.length === 1 ? T('cgDupOne', M.text(dups[0].name)) : T('cgDupMany', dups.length));
}

function areaMenu(anchor, area) {
  const mark = state.map.marks.find(m => m.node === area.id);
  openMenu(anchor, [
    ...(mark ? [
      { label: T('cgRedrawArea'), run: async () => { remember(); M.removeShape(state, mark); await persist(); render(); wallMap.startDraw('area', area.id); } },
      { label: T('cgRemoveShape'), run: async () => { remember(); M.removeShape(state, mark); await persist(); render(); } },
      '-',
    ] : []),
    { label: T('cgDeleteArea'), danger: true, run: async () => {
      remember();
      M.deleteArea(state, area.id);
      if (areaPicked === area.id) areaPicked = null;
      await persist();
      render();
    } },
  ]);
}

function wallMenu(anchor, wall) {
  const others = M.walls(state).filter(w => w.id !== wall.id);
  const areas = state.book.nodes.filter(n => n.type === 'area' && n.id !== wall.parent);
  const inArea = wall.parent && state.book.nodes.some(n => n.id === wall.parent && n.type === 'area');
  const wallPhotos = M.photosOf(state, wall.id);
  const isCollapsed = collapsedAreas.has(wall.id);
  openMenu(anchor, [
    ...(wallPhotos.length ? [
      { label: isCollapsed ? T('cgExpandPhotosN', wallPhotos.length) : T('cgCollapsePhotosN', wallPhotos.length), run: () => {
        if (collapsedAreas.has(wall.id)) collapsedAreas.delete(wall.id);
        else collapsedAreas.add(wall.id);
        renderAreas();
      } },
      '-',
    ] : []),
    ...(inArea ? [{ label: T('cgOutOfArea'), run: async () => { remember(); delete wall.parent; await persist(); render(); } }] : []),
    ...areas.map(a => ({ label: T('cgMoveInto', M.text(a.name) || T('cgArea')), run: async () => { remember(); wall.parent = a.id; await persist(); render(); } })),
    ...((inArea || areas.length) && others.length ? ['-'] : []),
    ...others.map(o => ({ label: T('cgMergeInto', M.text(o.name) || T('cgUntitled')), run: async () => {
      const ids = M.photosOf(state, wall.id).map(v => v.id);
      M.mergeWalls(state, wall.id, o.id);
      activeWall = o.id;
      await persist(ids); render();
    } })),
    ...(others.length || inArea || areas.length ? ['-'] : []),
    { label: T('cgDeleteWall'), danger: true, run: async () => {
      const n = M.photosOf(state, wall.id).length, r = M.routesOf(state, wall.id).length;
      const detail = [n && T('cgWallDeletePhotos', n), r && T('cgWallRoutesMove', r)].filter(Boolean).join(T('cgSentenceSep'));
      if ((n || r) && !(await askConfirm(T('cgDeleteQ', M.text(wall.name) || T('cgUntitled')), detail, T('cgDelete')))) return;
      const ids = M.deleteWall(state, wall.id);
      await dropPhotos(ids);
    } },
  ]);
}

/** 照片已經從資料拿掉之後：清選取與縮圖、存檔、刪圖 */
async function dropPhotos(ids) {
  for (const id of ids) if (thumbs.has(id)) { URL.revokeObjectURL(thumbs.get(id)); thumbs.delete(id); }
  await persist();
  await store.removeDocs(ids);
  render();
}

async function removePhotos(ids) {
  const layers = M.removePhotos(state, ids);
  await dropPhotos([...ids, ...layers]);
}

$('#bookName').addEventListener('change', async () => {
  state.book.name = $('#bookName').value.trim() || T('cgUntitled');
  $('#bookName').value = state.book.name;
  document.title = `${state.book.name} · Crag · Climbio Studio`;
  await persist();
});

// ---- 匯入照片：選檔、拍照，或拖進來 ----
$('#fileInput').addEventListener('change', (e) => { importFiles([...e.target.files]); e.target.value = ''; });
for (const zone of ['#map', '#side']) {
  const node = $(zone);
  const files = (e) => e.dataTransfer.types.includes('Files');
  node.addEventListener('dragover', (e) => { if (!files(e) || !state) return; e.preventDefault(); node.classList.add('drop'); });
  node.addEventListener('dragleave', (e) => { if (!node.contains(e.relatedTarget)) node.classList.remove('drop'); });
  node.addEventListener('drop', (e) => {
    node.classList.remove('drop');
    if (!files(e) || !state) return;
    e.preventDefault();
    importFiles([...e.dataTransfer.files]);
  });
}

let importing = false, importNote = '';
const importQueue = [];   // 匯入中又拖進來的照片：這批做完接著匯入
async function importFiles(files, { byTime: timeOk = true, walls: wallNames = null } = {}) {
  const table = files.find(f => /\.(csv|tsv|txt)$/i.test(f.name) || f.type === 'text/csv');
  if (table && state) { openPaste(decodeText(new Uint8Array(await table.arrayBuffer()))); return; }
  const images = files.filter(f => f.type.startsWith('image/') || /\.(jpe?g|heic|heif|png|webp)$/i.test(f.name));
  if (!images.length || !state) return;
  if (importing) { importQueue.push(...images); return; }
  importing = true;
  const book = state.book.id;
  const { declination } = M.settings(state);
  let failed = 0, noGps = 0, byTime = 0, swapped = 0, last;
  const added = [], raws = new Map();
  const wallByName = new Map();
  try {
    for (const [i, file] of images.entries()) {
      importNote = T('cgImporting', i + 1, images.length); renderSteps();   // 步驟列的「路線圖」顯示進度
      let p;
      try { p = await Photo.prepare(file); } catch (err) { console.warn(T('cgImportPhotos'), file.name, err); failed++; continue; }
      if (!state || state.book.id !== book) { importQueue.length = 0; return; }
      const view = M.newPhoto({ name: file.name.replace(/\.[^.]+$/, ''), w: p.w, h: p.h, sha256: p.sha256, raw: p.raw, attribution: state.book.attribution, declination });
      if (!located(view.camera)) noGps++;
      await store.saveImage(view, p.image, p.thumb);
      thumbs.set(view.id, URL.createObjectURL(p.thumb));
      const wName = wallNames?.[i]?.trim();
      const targetWall = wName ? (wallByName.get(wName) || wallByName.set(wName, M.addWall(state, wName)).get(wName)) : undefined;
      last = M.addPhoto(state, view, targetWall);
      added.push(view.id);
      raws.set(view.id, file);
      await persist([view.id]);
      render();
    }
    if (noGps && timeOk && !wallByName.size) {
      byTime = M.placeByTime(state, added);
      if (byTime) { await persist(added); render(); }
    }
    swapped = await takeOriginals(added, raws);
    if (last && state?.photos.get(added[added.length - 1])) setActive(state.photos.get(added[added.length - 1]).props.node, true);
    wallMap?.fit();
  } finally {
    importing = false;
    importNote = ''; if (state) renderSteps();
  }
  const msg = [swapped && T('cgSwapped', swapped), failed && T('cgUnreadable', failed), noGps && !swapped && T('cgNoGps', noGps) + (byTime ? T('cgByTime', byTime) : '')].filter(Boolean).join(T('cgComma'));
  if (msg) toast(msg);
  if (importQueue.length) importFiles(importQueue.splice(0), { byTime: timeOk });
}

/**
 * 補上的原圖：換掉同一次快門、已經畫好 Topo 的照片（通常是路線書的圖），Topo 照對位搬過去。回傳換了幾張。
 * 還沒畫 Topo 的不換：路線可能還沒建，等「從照片描路線」拿它跟原圖相減再換
 */
async function takeOriginals(added, raws) {
  const up = await upgradeOriginals(added, { drawnOnly: true, raws });
  if (up.swapped) render();
  return up.swapped;
}

/**
 * 找原圖並換上（pair.js）：這本的照片裡同一次快門的大小兩張，小的（路線書的圖，可以是裁切、縮小、調過亮度的）換成大的（原圖）。
 * 小的已經畫了 Topo：圖層照對位搬到原圖上；還沒畫：兩張對齊相減取出作者的筆跡（線、bolt、確保站），回傳在 diffs 讓呼叫的人照順序配給路線。
 * involve：只找跟這些照片有關的配對（匯入時是新的照片）；notGuides：只能當原圖的照片（預設就是 involve：匯入的照片只拿來換別張）；drawnOnly：只換已經畫了 Topo 的。回傳 { swapped（換了幾張）, diffs: Map<換上的原圖 id, 相減描出的線（搬了圖層的是空的）> }
 */
async function upgradeOriginals(involve, { drawnOnly = false, notGuides = involve, raws = null } = {}) {
  const book = state.book.id, photos = state.book.items.map(i => state.photos.get(i.id)).filter(v => v && !M.isOverview(state, v));
  const none = { swapped: 0, diffs: new Map() };
  if (photos.length < 2) return none;
  let pairs = await findOriginals(photos, {
    image: (v) => store.getImage(v), feats: featuresOf, involve, notGuides,
    onProgress: (what, i, n) => UI.toast(`${what} ${i}/${n}`, { busy: true }),
  });
  UI.hideToast();
  if (!state || state.book.id !== book) return none;
  if (drawnOnly) pairs = pairs.filter(p => M.layersOn(state, p.guide.id).length);
  if (!pairs.length) return none;
  const diffs = new Map(), layers = [];
  for (const p of pairs) {
    diffs.set(p.original.id, []);   // 換上的原圖不再找紅筆（是乾淨的）
    if (!M.layersOn(state, p.guide.id).length) {
      try { diffs.set(p.original.id, await traceDiffBlobs(await store.getImage(p.guide), await store.getImage(p.original), p.H, p.guide.w, p.original.w, p.guide.props.routes?.length)); }
      catch (err) { console.warn('原圖相減', p.guide.name, err); }
    }
    layers.push(...M.takeOriginal(state, p.guide.id, p.original.id, p.H));
  }
  await recordOriginals(pairs, raws);
  await persist(pairs.map(p => p.original.id), layers);
  await dropPhotos(pairs.map(p => p.guide.id));
  return { swapped: pairs.length, diffs };
}

/**
 * 轉換來的書（有轉換紀錄）換原圖時記下來：路線書那張存成 source/fig-…（對照用）、對位 H 記進 topos；
 * 後來才加的原圖（raws：照片 id → 選的檔案）照原樣存進 source/，重跑時一起選
 */
async function recordOriginals(pairs, raws) {
  const rec = await store.readRecord();
  if (!rec) return;
  const taken = new Set(rec.files.map(f => f.path.slice('source/'.length).toLowerCase()));
  for (const p of pairs) {
    const img = await store.getImage(p.guide);
    if (img) {
      const figure = `fig-${(p.guide.sha256 || p.guide.id).slice(0, 16)}.${/png/.test(img.type) ? 'png' : 'jpg'}`;
      await store.saveSource(figure, img);
      rec.topos = [...rec.topos.filter(x => x.photo !== p.original.sha256), { photo: p.original.sha256, name: M.text(p.original.name), figure: `source/${figure}`, H: p.H }];
    }
    const raw = raws?.get(p.original.id);
    if (raw && !rec.files.some(f => f.name === raw.name && f.size === raw.size)) {
      const name = sourceName(raw.name, taken);
      await store.saveSource(name, raw);
      rec.files.push({ path: `source/${name}`, name: raw.name, size: raw.size });
    }
  }
  rec.counts = { ...rec.counts, swapped: rec.topos.length };
  await store.saveRecord(rec);
}

/** 照片的特徵點（studio/crag/match.js）：找原圖用，同一張照片（sha256 和寬）不重算 */
const featuresCache = new Map();
function featuresOf(v) {
  const key = `${v.sha256 || v.id}:${v.w}`;
  if (!featuresCache.has(key)) {
    const job = store.getImage(v).then(img => { if (!img) throw new Error(T('cgPhotoMissing', M.text(v.name) || v.id)); return analyze(img, v.w); });
    featuresCache.set(key, job);
    job.catch(() => featuresCache.delete(key));
  }
  return featuresCache.get(key);
}

// ---- 設定 ----
/** 署名欄：改編的（從別人的版本來）上面列出原本的署名，欄位只填自己的 */
function authorField(k) {
  const origin = M.originAttribution(state);
  $(`#${k}Origin`).hidden = !origin;
  $(`#${k}Origin`).textContent = origin ? T('cgOriginCredit', origin) : '';
  $(`#${k}AuthorLabel`).textContent = origin !== undefined ? T('cgYourCredit') : T('cgAuthor');
  $(`#${k}Author`).value = M.ownAttribution(state);
}
// ---- 岩場資訊：一整頁（步驟列的第一步、頂列的設定），所有選項都看得到，改了就存 ----
function renderInfo() {
  $('#setName').value = state.book.name || '';
  authorField('set');
  $('#setGrade').value = M.settings(state).grade;
  $('#setCountry').value = M.settings(state).country;
  $('#setSource').value = M.sourceOf(state);
  $('#setApproachRow').hidden = !M.cragOf(state);   // 交通寫在岩場節點上，只有有岩場節點的書才有
  $('#setApproach').value = M.approachOf(state);
  for (const r of document.querySelectorAll('#setNumbering input')) r.checked = r.value === M.settings(state).numbering;
  const shown = new Set(columnKeys());
  $('#setCols').replaceChildren(...COLUMNS.filter(c => c.key !== 'name' && c.key !== 'number').map(c => el('label', {}, el('input', { type: 'checkbox', value: c.key, checked: shown.has(c.key) }), c.label)));
  const pack = new Set(M.settings(state).pack);
  // 只列授權允許打包的底圖（OpenStreetMap 不允許，不列出來）
  $('#setPack').replaceChildren(el('span', { className: 'lead', textContent: T('cgPackAria') }), ...Object.entries(P.PACKABLE).filter(([, x]) => x.ok).map(([k, x]) => el('label', { title: T('cgPackTitle', x.license, x.credit) },
    el('input', { type: 'checkbox', value: k, checked: pack.has(k) }), x.label)));
}
async function saveInfo() {
  const name = $('#setName').value.trim();
  if (name) { state.book.name = name; $('#bookName').value = name; document.title = `${name} · Crag · Climbio Studio`; }
  M.setAttribution(state, $('#setAuthor').value.trim());
  if (!M.setSource(state, $('#setSource').value.trim())) { toast(T('cgSourceHttps')); $('#setSource').value = M.sourceOf(state); }
  M.setApproach(state, $('#setApproach').value.trim());
  const columns = [...$('#setCols').querySelectorAll('input:checked')].map(i => i.value);
  M.setSettings(state, {
    grade: $('#setGrade').value,
    country: $('#setCountry').value,
    numbering: $('#setNumbering input:checked')?.value,
    ...(columns.join() !== columnKeys().filter(k => k !== 'name' && k !== 'number').join() ? { columns } : {}),
    pack: [...$('#setPack').querySelectorAll('input:checked')].map(i => i.value),
  });
  // 編號方式改了：圖層上的編號牌跟著換
  for (const l of state.layers.values()) M.syncLabels(state, l);
  await persist([...state.photos.keys()], [...state.layers.keys()]);
  renderWalls();
  renderSteps();
}
$('#info').addEventListener('change', (e) => { if (e.target.closest('input, select, textarea')) saveInfo(); });

/** 匯出、發佈的圖檔 [{ path, blob }]：照片、合成預覽圖（上面入口照片 4:3、720×540，下面每張照片的小圖；紅點貓收這本時下載照片前先看，卡片和圖釘也用它，不另存縮圖） */
/** onStep(i, n, v, img)：第 i 張開始整理（發佈的過場畫面用；沒給就用提示條） */
async function packImages(onStep) {
  const out = [];
  let first = false;
  const views = state.book.items.map(i => state.photos.get(i.id)).filter(Boolean);
  // 合成預覽圖：上面入口照片，下面每張照片的小圖（跟 exportDocs 的 props.tile 同一個順序）
  const size = M.previewSize(views.length), sheet = el('canvas', { width: size.w, height: size.h });
  const sheetCtx = sheet.getContext('2d');
  const thumb = el('canvas', { width: M.THUMB_W, height: M.THUMB_H }), thumbCtx = thumb.getContext('2d');   // 世界地圖圖釘用的縮圖：只有入口照片
  sheetCtx.fillStyle = '#e9eff4';
  sheetCtx.fillRect(0, 0, size.w, size.h);
  for (const [i, v] of views.entries()) {
    const img = await store.getImage(v);
    if (!img) throw new Error(T('cgPhotoMissing', M.text(v.name) || v.id));
    out.push({ path: v.href, blob: img });
    const bmp = await createImageBitmap(img);
    if (!first) {
      drawFit(sheetCtx, bmp, 0, 0, M.PREVIEW_W, M.COVER_H);
      drawFit(thumbCtx, bmp, 0, 0, M.THUMB_W, M.THUMB_H);
      first = true;
    }
    drawFit(sheetCtx, bmp, (i % M.TILE_COLS) * M.TILE_W, M.COVER_H + Math.floor(i / M.TILE_COLS) * M.TILE_H, M.TILE_W, M.TILE_H);
    bmp.close();
    if (onStep) onStep(i, views.length, v, img); else UI.toast(T('cgPreparing', i + 1, views.length), { busy: true });
  }
  if (first) out.push({ path: M.PREVIEW, blob: await Photo.jpeg(sheet, 0.8) }, { path: M.THUMB, blob: await Photo.jpeg(thumb, 0.8) });
  // 3D 模型檔照原樣附上
  for (const v of state.extras.values()) {
    if (v.surface !== 'model') continue;
    const blob = await store.getImage(v);
    if (!blob) throw new Error(T('cgModelMissing', M.text(v.name) || v.id));
    out.push({ path: v.href, blob });
  }
  if (!onStep) UI.hideToast();
  return { images: out };
}

/** 照片裁成 w×h（蓋滿、置中）畫到 g 的 (x, y) */
function drawFit(g, bmp, x, y, w, h) {
  const k = Math.max(w / bmp.width, h / bmp.height);
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.drawImage(bmp, x + (w - bmp.width * k) / 2, y + (h - bmp.height * k) / 2, bmp.width * k, bmp.height * k);
  g.restore();
}
// ---- 發佈的畫面：共用的發佈對話框與過場（studio/publish-ui.js），這裡只放 Guidebook 自己的欄位 ----
const pubBlocked = el('div', { id: 'pubBlocked', hidden: true }, el('p', { textContent: T('cgBlockedPhotos') }), el('ul'));
const pubWho = el('div', { id: 'pubWho' }, el('p', { id: 'pubOrigin', className: 'origin', hidden: true }), el('label', { className: 'dk-field' }, el('span', { id: 'pubAuthorLabel', textContent: T('cgAuthor') }), el('input', { id: 'pubAuthor', className: 'field', maxLength: 80 })),
  // 不列入世界：世界地圖、清單、資料集目錄都沒有，只有拿到連結的人打得開（檔案照樣在開放資料集）；寫在組合的 props.unlisted，別人接著改的下一版預設照舊
  el('label', { id: 'pubUnlistedRow' }, el('input', { type: 'checkbox', id: 'pubUnlisted' }), el('span', {}, T('cgUnlisted'), el('small', { textContent: T('cgUnlistedHint') }))));
const pubUI = createPublishUI({
  text: K.publishText(), extras: [pubBlocked, pubWho], visibility: false,   // 發佈就是公開（要私下給人用匯出 ZIP 或備份）
  actions: [el('button', { id: 'pubFix', className: 'dk-btn', hidden: true }), el('button', { id: 'pubEditLink', className: 'dk-btn', hidden: true, textContent: T('cgCopyEditLink') })],
  onGo: () => afterPublish(runPublish),
  onCopy: () => toast(T('cgCopied')),
});

// ---- 匯出（發佈頁的「匯出 ZIP」）：ZIP（index.json、各畫面的 JSON、照片、小圖、入口照片），每份都先過 validate ----
async function exportZip() {
  let pack;
  try { pack = await packImages(); } catch (e) { toast(T('cgExportFailed', e.message)); return; }
  const docs = M.exportDocs(state);
  const errors = docs.flatMap(({ path, doc }) => ClimbioFormat.validate(doc).map(e => `${path} ${e}`));
  if (errors.length) { console.error(errors); toast(T('cgExportFailed', errors[0])); return; }
  const files = docs.map(({ path, doc }) => ({ name: path, blob: new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' }) }));
  for (const { path, blob } of pack.images) files.push({ name: path, blob });
  for (const { path, blob } of await store.readSource()) files.push({ name: path, blob });
  const url = URL.createObjectURL(await AppKit.files.zip(files));
  const a = el('a', { href: url, download: `${(state.book.name || 'guidebook').replace(/[\\/:*?"<>|]/g, '_')}.zip` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast(T('cgExported'));
}


/** 發佈、下架做完（或失敗）都重畫對話框的狀態；訊息先清掉 */
async function afterPublish(fn) {
  pub.msg = '';
  try { await fn(); } finally { if (state) { renderPublish(); if (step === 'publish') renderPubPage(); } }
}
// ---- 發佈：公開放進開放資料集 climbio/crags、網址 /p/<專案 id>（publish.js、../publisher.js）；第一次列出會公開的內容，之後不再問 ----
const pub = { status: 'checking', msg: '' };
const STATUS_MSG = { checking: '', off: T('cgPubOff'), paused: T('cgPubPaused') };

/**
 * 發佈前一定要對、不對就擋下的（回要改什麼，都對回 ''）。Studio 打開書時不自己補資料，在這裡擋：
 *   國家（紅點貓世界的第一層，沒有就進最後的「其他」）、署名不重複（「楊礎豪；楊礎豪 改編」，按「整理署名」改）、
 *   自己的書要開放改編（公開資料集一律 CC BY-SA 4.0，按「改成開放改編」改）
 */
function mustFix() {
  if (!M.settings(state).country) return T('cgNeedCountry');
  if (M.tidyAttribution(state.book.attribution) !== (state.book.attribution || '')) return T('cgAttrDup', state.book.attribution, M.tidyAttribution(state.book.attribution));
  if (M.originAttribution(state) === undefined && !M.remix(state)) return T('cgNeedRemix');
  // 大改發成新的一本：名稱要跟原本那本不同，世界裡才分得出來
  if (pub.big?.reasons.length && M.text(state.book.name).trim() === pub.big.name.trim()) return T('cgBigRename', bigWhy(pub.big.reasons), pub.big.name);
  return '';
}
/** 大改的理由給人看：刪 5 條路線、少 4 張照片 */
const bigWhy = (reasons) => reasons.map(r => T({ routes: 'cgVerRoutesDel', walls: 'cgVerWallsDel', photos: 'cgVerPhotosDel' }[r.kind], r.n)).join('、');
/**
 * 打開發佈對話框時跟上一版比（versions.js 的 bigChange）：一次刪很多就是大改，發成新的一本。
 * 上一版：自己上一次發佈的，沒有就是匯入的那一版；都沒有（新建的書）不用比。讀不到上一版（離線）照小改，發佈本來就要連線
 */
async function checkBig() {
  pub.big = null;
  const ps = P.publishState(state), from = ps.project || publishedId(state.book.derivedFrom?.url);
  if (!from) return;
  try {
    const docs = P.publishDocs(state, { validate: ClimbioFormat.validate });
    const base = await loadVersion({ id: from });
    pub.big = { reasons: V.bigChange(base, { root: docs[0].doc, docs: new Map(docs.slice(1).map(d => [d.path, d.doc])) }), name: M.text(base.root.name) || '' };
  } catch (e) { console.warn('比不到上一版', e); }
}
/** 有沒有可以發佈的修改：發佈過的跟上一次發佈比；從公開版本匯入、還沒發佈過的跟匯入的那一版比；自己新建的都算 */
function hasChanges(ps) {
  if (!ps.version) return !(ps.fromSig && ps.fromSig !== 'open' && ps.fromSig === sigNow());
  return ps.sig ? sigNow() !== ps.sig : !ps.at || state.book.t > ps.at;   // 舊的沒有指紋：看組合的 t
}
/** 內容指紋（P.contentSig）：同一次存檔只算一次（發佈時進度訊息會一直重畫） */
let sigMemo = { id: '', t: -1, sig: '' };
function sigNow() {
  if (sigMemo.id !== state.book.id || sigMemo.t !== state.book.t) sigMemo = { id: state.book.id, t: state.book.t, sig: P.contentSig(state) };
  return sigMemo.sig;
}
/** 編輯連結：/studio/crag/#edit=<這本書的 root>，打開就是這本最新的一版（fromEditLink；跟發佈的站同一個網域） */
// 這個站的根目錄：Crag 在 /studio/crag/，往上兩層（ShareTools.homeSite 是往上一層，給 /hold/ 這類 App 用）；本機測試照它接開發版
const siteRoot = () => (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? ShareTools.homeSite() : new URL('../../', location.href).href.replace(/\/$/, ''));
const editLink = (id) => `${siteRoot()}/studio/crag/#edit=${id}`;

function renderPublish() {
  const ps = P.publishState(state), bad = P.blocked(state), sum = P.summary(state);
  pubBlocked.hidden = !bad.length;
  pubBlocked.querySelector('ul').replaceChildren(...bad.map(b => el('li', { textContent: b.name })));
  // 開放改編而且發佈過：多一個「複製改編連結」，貼給別人打開就匯入這本接著編（/studio/crag/#edit=<岩場 id>，點開是最新的一版）
  $('#pubEditLink').hidden = !(ps.url && M.remix(state));
  // 擋下的是署名重複、沒開放改編：給一顆按鈕，人按了才改（國家要到岩場資訊選）
  const fix = !M.settings(state).country ? '' : M.tidyAttribution(state.book.attribution) !== (state.book.attribution || '') ? 'attr' : M.originAttribution(state) === undefined && !M.remix(state) ? 'remix' : '';
  $('#pubFix').hidden = !fix;
  $('#pubFix').dataset.fix = fix;
  $('#pubUnlisted').checked = !!state.book.props?.unlisted;
  $('#pubFix').textContent = fix === 'attr' ? T('cgAttrFix') : fix === 'remix' ? T('cgRemixFix') : '';
  const base = {
    link: ps.link || ps.url || '',
    summary: { hidden: ps.consent, intro: T('cgPubIntro'), items: [
      T('cgSumPhotos', sum.photos), T('cgSumRoutes', sum.routes), T('cgSumTopos', sum.topos), T('cgSumWallMap', sum.walls),
      T('cgSumCameras', sum.cameras), T('cgSumLicense', { 'CC-BY-SA-4.0': 'CC BY-SA 4.0', 'CC-BY-ND-4.0': T('cgLicenseND') }[state.book.license] ?? state.book.license),
    ] },
  };
  if (M.noDerivs(state)) { pubUI.set({ ...base, go: { hidden: true }, message: T('cgNoDerivsMsg') }); return; }
  // 發佈後內容沒改過（指紋跟發佈時一樣；舊的沒有指紋，看組合的 t）就沒有下一版可以發。開檔、同步、存檔沒改內容都不算
  const changed = hasChanges(ps);
  pubUI.set({
    ...base,
    go: { hidden: !changed, disabled: bad.length > 0 || P.needsPosition(state) || !!mustFix() || pub.status !== 'ok', text: ps.version && !pub.big?.reasons.length ? T('cgPublishVer', ps.version + 1) : T('cgPublish') },
    // 發佈前一定要對的（mustFix）：國家、署名不重複、自己的書開放改編；Studio 不在背景自己改，擋下來說要改什麼
    message: (P.needsPosition(state) && P.NO_POSITION) || pub.msg || STATUS_MSG[pub.status] || mustFix() || (changed && pub.big?.reasons.length ? T('cgBigNew', bigWhy(pub.big.reasons), pub.big.name) : '') || (ps.version ? (changed ? T('cgCurrentVer', ps.version) : T('cgVerUnchanged', ps.version)) : changed ? '' : T('cgSameAsSource')),
  });
}

async function openPublish() {
  pub.msg = ''; pub.status = 'checking';
  authorField('pub');
  renderPublish();
  pubUI.open();
  [pub.status] = await Promise.all([K.getService().ping(), checkBig()]);
  renderPublish();
}

/** 發佈的過場：照片小圖一開始都亮著，分析到的框起來，傳出去的往上飛走；封面是入口照片（畫面與進度條在共用的 pubUI.run） */
const run = {
  open() {
    const views = state.book.items.map(i => state.photos.get(i.id)).filter(Boolean);
    pubUI.run.open({ name: M.text(state.book.name) || 'Guidebook', tiles: views.map(v => ({ key: v.href, thumb: () => store.getThumb(v.id) })) });
  },
  step: (text, n, total) => pubUI.run.step(text, n, total),
  analyze: (i, n, v, img) => { pubUI.run.scan(v.href, i === 0 ? img : null); pubUI.run.step(T('cgPreparePhotos'), i + 1, n); },
  sent: (path) => pubUI.run.sent(path),
  close: () => pubUI.run.close(),
};

async function runPublish() {
  const own = $('#pubAuthor').value.trim();
  if (own !== M.ownAttribution(state)) M.setAttribution(state, own);   // 署名欄的字還沒存（沒離開輸入框）也照填的發佈
  if (!P.publishState(state).consent) P.setPublishState(state, { consent: true });
  const book = state.book.id;
  run.open();
  try { await publishing(book); } finally { run.close(); }
}

async function publishing(book) {
  const { images } = await packImages((i, n, v, img) => run.analyze(i, n, v, img));
  const docs = P.publishDocs(state, { validate: ClimbioFormat.validate });
  // 附上底圖：岩場範圍的圖磚跟資料一起發佈，地圖畫面的 props.tiles 寫它們在哪
  const kinds = M.settings(state).pack;
  if (kinds.length) {
    run.step(T('cgDownloadTiles'));
    const packed = await P.packTiles(state, kinds, { onProgress: (n, total) => run.step(T('cgDownloadTiles'), n, total) });
    const map = docs.find(d => d.doc.surface === 'map' && d.doc.id === state.map.id)?.doc;
    if (map && packed.tiles.length) { map.props = { ...map.props, tiles: packed.tiles }; images.push(...packed.files); }
  }
  // 不認人（docs/proposals/crag-open-versions.md）：每次發佈是新的專案 id，origin 指到上一版（自己上一次發佈的，沒有就是收下的那一版），root 是這本書的第一版；已發佈的 id 不能再改
  // 大改（checkBig）：不接在原本那本後面，沒有 origin、自己是 root，從第 1 版算起；署名的來源（derivedFrom）照舊留著
  const ps = P.publishState(state), pubId = newProjectId(), big = !!pub.big?.reasons.length;
  const version = big ? 1 : (ps.version || 0) + 1;   // 這本書的第幾版（伺服器的每個專案都是第 1 版）
  const originId = big ? '' : ps.project || publishedId(state.book.derivedFrom?.url);
  const root = big ? pubId : ps.root || state.book.props?.root || originId || pubId;
  docs[0].doc.props = { ...docs[0].doc.props, root };   // 紅點貓靠它找「這本書現在最好的版本」
  const country = M.settings(state).country, unlisted = !!state.book.props?.unlisted;
  const meta = { attribution: state.book.attribution || '', listed: !unlisted, ...(country ? { cc: country } : {}), ...(originId ? { origin: originId } : {}) };
  const res = await P.publish({
    state, docs, images, sources: await store.readSource(),
    dataset: (o) => K.publishAnonymous({ ...o, id: pubId, type: 'guidebook', meta }),   // 照片直接傳給 Hub，檔案放開放資料集
    onProgress: (n, total) => (n < total ? run.step(T('cgUpload'), n, total) : run.step(T('cgRegister'))),
    onFile: (path) => run.sent(path),
  });
  run.step(T('cgMakeLink'));
  if (!state || state.book.id !== book) return;
  // 分享網址：固定網址 /p/<專案 id>（發佈完就有，每一版都一樣，打開是紅點貓收這本）
  const link = `${siteRoot()}/p/${res.project}`;
  if (!state || state.book.id !== book) return;
  const t = Date.now();   // 發佈的時間跟存檔的 t 一樣：之後有改（t 變大）才能發下一版
  P.setPublishState(state, { version, url: res.url, link, files: res.files, manifest: res.manifest, project: res.project, root, at: t, sig: P.contentSig(state) });
  pub.big = null;
  await persist([], [], t);
  pub.msg = big ? T('cgPublishedNew') : T('cgPublishedVer', version);
  if (unlisted) pub.msg = `${pub.msg} ${T('cgPublishedUnlisted')}`;
  else checkWorld(res.project, country, pub.msg);   // 背景確認世界清單重建了、這一版在對的國家底下   // 對話框換成連結（發佈鈕藏起來，沒改過就沒有下一版）
}

// 署名每次發佈都看得到、改了就存（算一次修改，才有下一版可以發）
$('#pubAuthor').addEventListener('change', async () => {
  const own = $('#pubAuthor').value.trim();
  if (own === M.ownAttribution(state)) return;
  M.setAttribution(state, own);
  await persist([...state.photos.keys()], [...state.layers.keys()]);
  renderPublish();
});
$('#pubUnlisted').addEventListener('change', async () => {
  const props = { ...state.book.props };
  if ($('#pubUnlisted').checked) props.unlisted = true; else delete props.unlisted;
  state.book.props = props;   // 換列不列入算一次修改，才有下一版可以發
  await persist([], []);
  renderPublish();
});
$('#pubFix').addEventListener('click', async () => {
  const fix = $('#pubFix').dataset.fix;
  if (fix === 'attr') { M.tidyBookAttribution(state); await persist([], []); authorField('pub'); }
  else if (fix === 'remix') { M.setRemix(state, true); await persist([...state.photos.keys()], [...state.layers.keys()]); }
  renderPublish();
});
$('#pubEditLink').addEventListener('click', () => { navigator.clipboard?.writeText(editLink(P.publishState(state).root || P.publishState(state).project)).then(() => toast(T('cgEditLinkCopied')), () => {}); });

// ---- 版本紀錄（studio/crag/versions.js）：這本書所有已發佈的版本，每一版跟它的上一版差在哪裡；可以從任何一版開始改 ----
const idOfUrl = publishedId;
/** 這本書跟公開版本有關的 id：自己發佈過的（最新那版、第一版）、匯入來源 */
function versionIds() { const ps = P.publishState(state); return [ps.project, ps.root, state.book.props?.root, idOfUrl(state.book.derivedFrom?.url)]; }
const verCache = new Map();   // id → Promise<{ root, docs }>：發佈過的版本不會再改，讀過就留著
function loadVersion(v) {
  if (!verCache.has(v.id)) {
    const url = v.url || `${siteRoot()}/p/${v.id}/index.json`;
    const getJson = async (at) => { const r = await fetch(at, { cache: 'force-cache' }); if (!r.ok) throw new Error(`${r.status} ${at}`); return r.json(); };
    verCache.set(v.id, crawl(url, getJson, { self: location.origin }).then(({ root, docs }) => ({ root, docs })).catch((e) => { verCache.delete(v.id); throw e; }));
  }
  return verCache.get(v.id);
}
/** 一句話的摘要：+3 條路線 · 改 2 條路線 · 4 條線 · 岩壁地圖 1 處 */
function verSummary(c) {
  const parts = [];
  for (const [k, key] of [['routes', 'Routes'], ['walls', 'Walls'], ['areas', 'Areas']]) {
    const [a, r, m] = c[k];
    if (a) parts.push(T(`cgVer${key}Add`, a));
    if (r) parts.push(T(`cgVer${key}Del`, r));
    if (m) parts.push(T(`cgVer${key}Mod`, m));
  }
  if (c.photos[0]) parts.push(T('cgVerPhotosAdd', c.photos[0]));
  if (c.photos[1]) parts.push(T('cgVerPhotosDel', c.photos[1]));
  if (c.lines) parts.push(T('cgVerLines', c.lines));
  if (c.map) parts.push(T('cgVerMap', c.map));
  if (c.info) parts.push(T('cgVerInfo'));
  return parts.join(' · ');
}
/** 改了什麼的明細：岩場資訊、新增／刪掉／改了的節點（改的列欄位前後）、照片、線 */
function verDetail(d) {
  const types = T('cgVerTypes'), labels = T('cgVerFields');
  const who = (n) => `${types[n.type] || n.type} ${n.name || ''}`.trim();
  const field = (f) => el('span', { className: 'chg' }, `${labels[f.key] || f.key}：`, el('del', { textContent: V.show(f.from) }), ` → ${V.show(f.to)}`);
  const out = [];
  const sec = (title, items) => { if (items.length) out.push(el('h4', { textContent: title }), el('ul', {}, ...items)); };
  sec(T('cgVerInfo'), d.info.map(f => el('li', {}, field(f))));
  sec(T('cgVerAdded'), d.nodes.added.map(n => el('li', { textContent: who(n) })));
  sec(T('cgVerRemoved'), d.nodes.removed.map(n => el('li', { textContent: who(n) })));
  sec(T('cgVerChanged'), d.nodes.changed.map(n => el('li', {}, `${who(n)}　`, ...n.fields.flatMap((f, i) => (i ? ['、', field(f)] : [field(f)])))));
  sec(T('cgVerPhotos'), [...d.photos.added.map(p => el('li', { textContent: `+ ${p.name}` })), ...d.photos.removed.map(p => el('li', { textContent: `− ${p.name}` }))]);
  const line = (sign) => (l) => el('li', { textContent: `${sign} ${T('cgVerLineOn', l.name || l.route, l.photo)}` });
  sec(T('cgVerLineHead'), [...d.lines.added.map(line('+')), ...d.lines.changed.map(line('~')), ...d.lines.removed.map(line('−'))]);
  return out;
}

async function openVersions() {
  const dlg = $('#verDlg'), list = $('#verList'), msg = $('#verMsg');
  list.replaceChildren(); msg.hidden = true;
  $('#verTitle').textContent = T('cgVerTitle', M.text(state.book.name) || 'Guidebook');
  dlg.showModal();
  const say = (text) => { msg.textContent = text; msg.hidden = false; };
  const rows = await bookRows(versionIds());
  if (!rows) { say(T('cgVerOffline')); return; }
  const g = V.versionsOf(rows, versionIds());
  if (!g) { say(T('cgVerNone')); return; }
  const mine = P.publishState(state).project, from = idOfUrl(state.book.derivedFrom?.url);
  const byId = new Map(g.versions.map(v => [v.id, v]));
  const items = [...g.versions].reverse().map((v) => {
    const sum = el('span', { className: 'sum', textContent: T('cgVerLoading') });
    const tag = v.id === mine ? T('cgVerThis') : v.id === from && !mine ? T('cgVerBase') : '';
    const origin = byId.get(v.origin);
    const meta = [new Date(v.t).toLocaleString(), origin ? T('cgVerFrom', origin.n) : T('cgVerFirst'), T('cgVerDl', v.dl)].join(' · ');
    const head = el('button', { type: 'button', className: 'ver-head' }, el('b', { textContent: T('cgVerN', v.n) }), el('span', { className: 'meta', textContent: meta }), tag ? el('span', { className: 'tag', textContent: tag }) : el('span'), sum);
    head.setAttribute('aria-expanded', 'false');
    const body = el('div', { className: 'ver-body', hidden: true });
    const li = el('li', {}, head, body);
    head.onclick = () => { body.hidden = !body.hidden; li.classList.toggle('open', !body.hidden); head.setAttribute('aria-expanded', String(!body.hidden)); };
    return { v, origin, li, sum, body, mine: v.id === mine };
  });
  list.replaceChildren(...items.map(x => x.li));
  // 新到舊一版一版比（讀過的版本留著，比下一版時不用再讀）；視窗關了就停
  for (const x of items) {
    if (!dlg.open) return;
    try {
      const [b, a] = await Promise.all([loadVersion(x.v), x.origin ? loadVersion(x.origin) : null]);
      const d = V.diffVersions(a, b), c = V.counts(d);
      const same = !!x.origin && V.isEmpty(c);
      x.sum.textContent = same ? T('cgVerSame') : verSummary(c);
      x.sum.classList.toggle('same', same);
      const view = el('a', { className: 'btn', href: `${siteRoot()}/p/${x.v.id}`, target: '_blank', rel: 'noopener', textContent: T('cgVerView') });
      const edit = el('button', { type: 'button', className: 'btn primary', textContent: T('cgVerEdit'), hidden: x.mine });
      // 從這一版開始改：匯入那一版成新專案（同一版匯入過就打開那本，見 importSite）；網址用開放資料集的（每一版都讀得到）
      edit.onclick = () => { dlg.close(); pubUI.close(); location.hash = `site=${encodeURIComponent(x.v.url || `${siteRoot()}/p/${x.v.id}/index.json`)}`; };
      x.body.replaceChildren(...(x.origin ? verDetail(d) : []), el('div', { className: 'acts' }, view, edit));   // 第一版全部是新增：摘要就夠，不列每一條
    } catch (e) {
      console.warn('版本讀不到', x.v.id, e);
      x.sum.textContent = T('cgVerFail');
    }
  }
}
$('#verClose').addEventListener('click', () => $('#verDlg').close());

/** 發佈後確認世界清單（public/projects.json，發佈時伺服器重寫）有這一版、國家對：等最多約 1 分鐘，結果接在發佈訊息後面 */
async function checkWorld(id, cc, base) {
  const name = countryName.of(cc.toUpperCase());
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000));
    let rows = null;
    try { rows = await globalThis.Backend?.listGuidebooks?.({ fresh: true }); } catch { rows = null; }
    const row = rows?.find(p => p.id === id || (p.others || []).some(o => o.id === id));
    if (row) { pub.msg = `${base} ${row.cc === cc ? T('cgWorldOk', name) : T('cgWorldWrong', row.cc || '—')}`; break; }
    if (i === 11) pub.msg = `${base} ${T('cgWorldLate')}`;
  }
  if (P.publishState(state)?.project === id) renderPublish();
}

/** 公開清單，加上不列入世界的這本：清單裡找不到 ids 的書，就問伺服器這本所有的版本（Backend.guidebookVersions）；都讀不到回 null */
async function bookRows(ids, opt) {
  let rows = null;
  try { rows = await globalThis.Backend?.listGuidebooks?.(opt); } catch { rows = null; }
  const id = ids.find(Boolean);
  if (!id || (rows && V.versionsOf(rows, ids))) return rows;
  try { return [...(rows || []), ...((await globalThis.Backend?.guidebookVersions?.(id)) || [])]; } catch { return rows; }
}
/**
 * 編輯連結 #edit=<id>（任何一版的 id，通常是第一版 root）：從公開清單找這本最新的一版；這台已經有那一版的專案就打開，沒有就匯入（#site=）。
 * 連結一直有效，之後有人發新版，點開就是新版；清單讀不到（離線、剛發佈還沒重建）就照 id 那一版
 */
async function fromEditLink(id) {
  history.replaceState(null, '', location.pathname + location.search);
  if (!/^[0-9a-z]{16}$/.test(id)) { showLibrary(); return; }
  const rows = await bookRows([id], { fresh: true });
  const v = rows && V.versionsOf(rows, [id])?.versions.at(-1);
  const have = v && await globalThis.StudioLibrary?.localOf?.([v.id]);
  if (have) { location.hash = have; return; }
  location.hash = `site=${encodeURIComponent(v?.url || `${siteRoot()}/p/${v?.id || id}/index.json`)}`;
}
/**
 * 命令列發佈（tools/guidebook.mjs publish）更新已發佈的書：匯入資料包之前放 { project, root }，下一本打開的書就接在那一版後面
 * （發佈時 origin 是它；一次刪很多照樣算大改、要改名發成新的一本，見 checkBig）
 */
async function applyAdopt() {
  const KEY = 'climbio.studio.adopt';
  let p = null;
  try { p = JSON.parse(sessionStorage.getItem(KEY) || 'null'); sessionStorage.removeItem(KEY); } catch { p = null; }
  if (!/^[0-9a-z]{16}$/.test(p?.project || '') || !/^[0-9a-z]{16}$/.test(p?.root || '')) return;
  P.setPublishState(state, { project: p.project, root: p.root });
  await persist([], [], state.book.t);
}

// ---- 路線：逐條新增與編輯 ----
const EDITABLE = ['grade', 'style', 'length', 'pitches', 'bolts', 'description', 'fa', 'setter', 'code'];
const GRADE_LABEL = { yds: 'YDS', french: 'French', uiaa: 'UIAA', british: 'British', v: 'V', font: 'Font', dan: T('cgGradeDan') };
$('#rSys').replaceChildren(...M.GRADE_SYSTEMS.map(k => el('option', { value: k, textContent: GRADE_LABEL[k] })));
const countryName = new Intl.DisplayNames([AppKit.i18n.lang === 'en' ? 'en' : 'zh-TW'], { type: 'region' });
$('#setCountry').replaceChildren(el('option', { value: '', textContent: '' }), ...M.COUNTRIES.map(c => ({ c, n: countryName.of(c.toUpperCase()) })).sort((a, b) => a.n.localeCompare(b.n)).map(({ c, n }) => el('option', { value: c, textContent: n })));
$('#setGrade').replaceChildren(...M.GRADE_SYSTEMS.map(k => el('option', { value: k, textContent: GRADE_LABEL[k] })));
$('#rStyle').replaceChildren(el('option', { value: '', textContent: '—' }), ...Object.entries(STYLE_LABEL).map(([k, v]) => el('option', { value: k, textContent: v })));

let editing = null;   // { id（新增時 null）, sys（打開時顯示的難度系統）, shown（打開時輸入框的值：沒改的欄位留原值，例如有換行的首攀） }
function wallOptions(select, value) {
  select.replaceChildren(el('option', { value: '', textContent: T('cgUnassigned') }),
    ...M.walls(state).map(w => el('option', { value: w.id, textContent: M.text(w.name) || T('cgUntitled') })));
  select.value = value || '';
}

function openRoute(id, { wall = activeWall, style } = {}) {
  const r = id ? state.book.nodes.find(n => n.id === id) : null;
  const p = r?.props || {};
  const grade = p.grade && typeof p.grade === 'object' ? p.grade : {};
  const def = M.settings(state).grade;
  const sys = def in grade || !Object.keys(grade).length ? def : Object.keys(grade)[0];
  editing = { id, sys };
  const d = $('#routeDlg');
  d.querySelector('h3').textContent = r ? T('cgEditRoute') : T('cgAddRoute');
  $('#rName').value = r ? M.text(r.name) : '';
  $('#rSys').value = sys;
  $('#rGrade').value = grade[sys] ?? '';
  const styleLabels = STYLE_LABEL;
  $('#rStyle').replaceChildren(el('option', { value: '', textContent: '—' }), ...Object.entries(styleLabels).map(([k, v]) => el('option', { value: k, textContent: v })));
  const st = r ? p.style : style;
  if (st && !styleLabels[st] && ![...$('#rStyle').options].some(o => o.value === st)) $('#rStyle').append(el('option', { value: st, textContent: STYLE_LABEL[st] || st }));
  $('#rStyle').value = st || '';
  for (const [k, f] of [['length', '#rLength'], ['pitches', '#rPitches'], ['bolts', '#rBolts'], ['fa', '#rFa'], ['setter', '#rSetter'], ['code', '#rCode']]) $(f).value = p[k] ?? '';
  $('#rDesc').value = M.text(p.description);
  wallOptions($('#rWall'), r ? (M.walls(state).some(w => w.id === r.parent) ? r.parent : '') : wall);
  editing.shown = Object.fromEntries(['#rName', '#rFa', '#rSetter', '#rCode'].map(f => [f, $(f).value]));
  $('#rDelete').hidden = !r;
  $('#rNext').hidden = !!r;
  if (!d.open) d.showModal();
  $('#rName').focus();
}

/** 存對話框的內容；名稱空白就不存，回傳 false */
async function saveRoute() {
  const name = $('#rName').value.trim();
  if (!name) { $('#rName').focus(); return false; }
  const r = editing.id ? state.book.nodes.find(n => n.id === editing.id) : null;
  const props = Object.fromEntries(Object.entries(r?.props || {}).filter(([k]) => !EDITABLE.includes(k) && k !== 'order'));
  const grade = { ...(r?.props?.grade && typeof r.props.grade === 'object' ? r.props.grade : {}) };
  delete grade[editing.sys];
  if ($('#rGrade').value.trim()) grade[$('#rSys').value] = $('#rGrade').value.trim();
  if (Object.keys(grade).length) props.grade = grade;
  if ($('#rStyle').value) props.style = $('#rStyle').value;
  for (const [k, f, int] of [['length', '#rLength'], ['pitches', '#rPitches', true], ['bolts', '#rBolts', true]]) {
    const n = Number($(f).value);
    if ($(f).value !== '' && Number.isFinite(n) && n >= 0) props[k] = int ? Math.round(n) : n;
  }
  for (const [k, f] of [['fa', '#rFa'], ['setter', '#rSetter'], ['code', '#rCode']]) {
    if (r && $(f).value === editing.shown[f]) { if (r.props?.[k] !== undefined) props[k] = r.props[k]; }
    else if ($(f).value.trim()) props[k] = $(f).value.trim();
  }
  if ($('#rDesc').value.trim()) props.description = M.withText(r?.props?.description, $('#rDesc').value.trim());
  const wall = $('#rWall').value || null;
  let id = editing.id;
  if (r) M.updateRoute(state, id, { name: $('#rName').value === editing.shown['#rName'] ? undefined : name, props, parent: wall });
  else [id] = M.addRoutes(state, [{ name, parent: wall, props }]);
  const dup = M.findDuplicate(state, name, wall, id);
  if (wall) activeWall = wall;
  await persist();
  render();
  if (dup) toast(T('cgDupOne', name));
  topo?.screen.routesChanged(r ? undefined : id);
  return true;
}

$('#routeDlg').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const d = $('#routeDlg');
  if (b.id === 'rSave') { if (await saveRoute()) d.close(); }
  else if (b.id === 'rNext') { const keep = { wall: $('#rWall').value, style: $('#rStyle').value }; if (await saveRoute()) openRoute(null, keep); }
  else if (b.id === 'rDelete') {
    d.close();
    if (!(await askConfirm(T('cgDeleteQ', $('#rName').value || T('cgUntitled')), T('cgRouteDeleteNote'), T('cgDelete')))) return;
    const layers = M.removeRoutes(state, [editing.id]);
    await persist([], layers);
    renderWalls();
  } else if (b.value === '') d.close();
});
$('#routeDlg').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing && e.target.matches('input')) { e.preventDefault(); $(editing?.id ? '#rSave' : '#rNext').click(); }
});

// ---- 路線：貼上表格、匯入 CSV ----
let paste = null;   // { rows, header, columns }
function openPaste(textIn = '') {
  $('#pasteText').value = textIn;
  wallOptions($('#pasteWall'), activeWall);
  $('#pasteWall').append(el('option', { value: 'new', textContent: T('cgNewWall') }));
  $('#pasteSkip').checked = true;
  reparse();
  $('#pasteDlg').showModal();
  if (!textIn) $('#pasteText').focus();
}

function reparse() {
  const rows = parseTable($('#pasteText').value);
  paste = rows.length ? { rows, ...guessColumns(rows) } : null;
  renderPaste();
}

const keyOf = (name, wall) => `${wall || ''}|${name.trim().toLowerCase()}`;
/** 預覽的每一列：路線、要放的岩壁（id、新岩壁的名稱，或未分配）、是不是重複 */
function pastePlan() {
  if (!paste) return [];
  const body = paste.header ? paste.rows.slice(1) : paste.rows;
  const byName = new Map(M.walls(state).map(w => [M.text(w.name).trim().toLowerCase(), w.id]));
  const chosen = $('#pasteWall').value;
  const seen = new Set();
  return body.map((row) => {
    const route = toRoutes([row], { header: false, columns: paste.columns }, M.settings(state).grade)[0];
    if (!route) return { row };
    const named = route.wall?.trim();
    const wall = named ? (byName.get(named.toLowerCase()) || { name: named }) : (chosen || null);
    const existing = wall === null || (typeof wall === 'string' && wall !== 'new');
    const key = keyOf(route.name, wall?.name ? `new:${wall.name}` : wall);
    const dup = seen.has(key) || (existing && !!M.findDuplicate(state, route.name, wall));
    seen.add(key);
    return { row, route, wall, dup };
  });
}

function renderPaste() {
  $('#pastePreview').hidden = !paste;
  if (!paste) { $('#pasteAdd').disabled = true; $('#pasteAdd').textContent = T('cgAdd'); return; }
  $('#pasteHeader').checked = paste.header;
  const head = el('tr', {}, el('th'), ...paste.columns.map((key, i) => {
    const s = el('select', { className: 'field', ariaLabel: T('cgColN', i + 1) }, el('option', { value: '', textContent: T('cgSkip') }), ...fields().map(([k, label]) => el('option', { value: k, textContent: label })));
    s.value = key;
    s.addEventListener('change', () => {
      // 同一個欄位只對應一欄：換過來的那欄原本的對應清掉
      paste.columns = paste.columns.map((c, j) => (j === i ? s.value : (c === s.value ? '' : c)));
      renderPaste();
    });
    return el('th', {}, s);
  }));
  const plan = pastePlan();
  const rows = [];
  if (paste.header) rows.push(el('tr', { className: 'hdr' }, el('td'), ...paste.rows[0].map(c => el('td', { textContent: c }))));
  plan.forEach((p) => rows.push(el('tr', { className: !p.route ? 'skip' : p.dup ? 'dup' : '' }, el('td', { className: 'mark', textContent: p.dup ? T('cgDuplicate') : '' }), ...p.row.map(c => el('td', { textContent: c })))));
  $('#pasteTable').replaceChildren(el('thead', {}, head), el('tbody', {}, ...rows));
  const dups = plan.filter(p => p.dup).length;
  $('#pasteSkipWrap').hidden = !dups;
  $('#pasteSkipWrap').querySelector('span').textContent = T('cgSkipDups', dups);
  const n = plan.filter(p => p.route && !(p.dup && $('#pasteSkip').checked)).length;
  $('#pasteAdd').disabled = !n;
  $('#pasteAdd').textContent = n ? T('cgAddN', n) : T('cgAdd');
}

$('#pasteText').addEventListener('input', reparse);
$('#pasteHeader').addEventListener('change', () => {
  if (!paste) return;
  paste.header = $('#pasteHeader').checked;
  renderPaste();
});
$('#pasteWall').addEventListener('change', renderPaste);
$('#pasteSkip').addEventListener('change', renderPaste);
$('#pasteDlg').addEventListener('click', async (e) => {
  const b = e.target.closest('.acts button');
  if (!b) return;
  const d = $('#pasteDlg');
  if (b.id !== 'pasteAdd') { d.close(); return; }
  const plan = pastePlan().filter(p => p.route && !(p.dup && $('#pasteSkip').checked));
  const made = new Map();   // 新岩壁的名稱 → id
  const wallId = (w) => {
    if (w === 'new') return made.get('') || made.set('', M.addWall(state)).get('');
    if (w && typeof w === 'object') return made.get(w.name) || made.set(w.name, M.addWall(state, w.name)).get(w.name);
    return w;
  };
  const ids = M.addRoutes(state, plan.map(p => ({ name: p.route.name, parent: wallId(p.wall), props: p.route.props })));
  d.close();
  const first = state.book.nodes.find(n => n.id === ids[0]);
  if (first?.parent) activeWall = first.parent;
  await persist();
  render();
  toast(T('cgAddedRoutes', ids.length));
});

$('#csvInput').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) openPaste(decodeText(new Uint8Array(await f.arrayBuffer())));
});


// 全部照片描線，依序配給還沒畫線的路線（M.autoTopo）；配錯的在畫 Topo 裡修。
// 先找原圖（upgradeOriginals）：路線書的圖找得到作者的原始照片（同一次快門、比較大，可以是裁切過的）就換成原圖，兩張相減取出的筆跡畫在乾淨的原圖上；
// 其他照片找紅筆。線照照片在這本裡的順序配給路線
async function autoTrace({ quiet = false, originals } = {}) {
  const book = state.book.id;
  const none = { msg: '', drawn: 0, stubs: 0 };
  if (!state.photos.size) { toast(T('cgNoPhotosYet')); return none; }
  const up = await upgradeOriginals(undefined, { notGuides: originals });
  if (!state || state.book.id !== book) return none;
  const photos = state.book.items.map(i => state.photos.get(i.id)).filter(v => v && !M.isOverview(state, v)), traced = [];
  for (const [i, v] of photos.entries()) {
    if (up.diffs.has(v.id)) { traced.push([v.id, up.diffs.get(v.id)]); continue; }
    UI.toast(T('cgTracing', i + 1, photos.length), { busy: true });
    const img = await store.getImage(v);
    if (!img) continue;
    try { traced.push([v.id, await traceBlob(img, v.w, v.props.routes?.length)]); } catch (err) { console.warn('描線', v.name, err); }
    if (!state || state.book.id !== book) return none;
  }
  UI.hideToast();
  const res = M.autoTopo(state, traced);
  await persist(res.photos, res.layers);
  render();
  const pairs = up.swapped ? T('cgPairs', up.swapped) : '';
  const stub = res.stubs ? T('cgStubs', res.stubs) : '';
  const msg = (res.drawn ? T('cgTraced', res.drawn, pairs, res.left ? T('cgTraceLeft', res.left) : '') : up.swapped ? T('cgSwappedNoLines', up.swapped) : T('cgNoLines')) + stub;
  if (!quiet) toast(msg);
  return { msg, drawn: res.drawn, stubs: res.stubs };
}
// 在 Guidebook 裡直接貼上圖片（設為場館配置圖／示意圖）或貼上表格（不在輸入框裡：打開貼上路線）
document.addEventListener('paste', (e) => {
  if (!state || e.target.closest?.('input, textarea, dialog') || document.querySelector('dialog[open]')) return;
  const imgItem = [...(e.clipboardData?.items || [])].find(it => it.type.startsWith('image/'));
  const imgFile = imgItem?.getAsFile() || [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
  if (imgFile) {
    e.preventDefault();
    if (step !== 'map') goStep('map');
    applySketchFile(imgFile).then(() => toast(T('cgSketchPasted')));
    return;
  }
  const textIn = e.clipboardData.getData('text/plain');
  if (!textIn.trim()) return;
  e.preventDefault();
  openPaste(textIn);
});

// ---- 匯入岩場：任何岩場站的 v2 出口 → 一本新的 Guidebook，體驗照紅點貓的收岩場 ----
// 上面貼網址或分享連結（「貼上連結」讀剪貼簿），按了直接匯入；下面是 Climbio 上發佈的岩場（雲端函式 datasets 的 list）和常用的岩場站，
// 選了先看確認卡（封面、名稱、岩壁與路線數），背景已經在下載，按「匯入」才存成一本。下載時封面從模糊變清楚，照片下載到哪小圖就亮到哪。
let site = null;   // 下載中的：{ ctrl, confirm（要不要等按「匯入」）, wanted（按了匯入）, done（下載好的結果）, error }
/** 別的網站的圖：頁面的 CSP 只讓 img 讀自己的網站，所以先下載成 blob 網址（connect-src 收 https）；讀不到回 '' */
const blobUrl = (href, signal) => fetch(href, { signal }).then(r => (r.ok ? r.blob() : null)).then(b => (b?.type.startsWith('image/') ? URL.createObjectURL(b) : ''), () => '');
const siteView = (box) => { $('#sitePick').hidden = box; $('#siteBox').hidden = !box; };
async function openSiteDlg() {
  site?.ctrl.abort(); site = null;
  siteView(false);
  $('#siteOk').hidden = true;
  $('#siteUrl').value = '';
  if (!$('#siteDlg').open) $('#siteDlg').showModal();
  $('#siteUrl').focus();
  const list = $('#siteList');
  list.dataset.empty = T('cgLoading');
  list.replaceChildren();
  const card = (b) => {
    const c = el('button', { className: 'site-card', type: 'button' }, el('div', { className: 'ph' }), el('b', { textContent: b.name }), el('span', { textContent: b.note || '' }));
    // Climbio 發佈的縮圖先下載成 blob（頁面的 CSP 不讓 img 讀別的網站；公開網址有 CORS）；常用岩場站的封面在 CSP 裡放行，直接用（它沒有 CORS）
    if (b.site) c.firstChild.style.backgroundImage = `url("${b.thumb}")`;
    else if (b.thumb || b.preview) blobUrl(b.thumb || b.preview).then(u => { if (u) c.firstChild.style.backgroundImage = `url("${u}")`; });
    c.addEventListener('click', () => importSite(b.url, { confirm: true, preview: b.preview, name: b.name }));
    return c;
  };
  const books = [];   // Studio 沒有帳號，沒有「自己發佈過的」清單（雲端函式也沒有 list）
  if (!$('#siteDlg').open) return;
  const day = (t) => new Date(t).toLocaleDateString(AppKit.i18n.lang === 'en' ? 'en' : 'zh-TW');
  list.dataset.empty = T('cgNoPublished');
  list.replaceChildren(...books.map(b => card({ ...b, note: day(b.t) })), ...SITES.map(x => card({ ...x, site: true, note: T('cgCragSite') })));
}

$('#sitePaste').addEventListener('click', async () => {
  let t = '';
  try { t = await navigator.clipboard.readText(); } catch { toast(T('cgClipUnreadable')); $('#siteUrl').focus(); return; }
  const url = /https?:\/\/\S+/.exec(t)?.[0];   // 分享訊息夾著文字也行
  if (!url) { toast(T('cgNoCragLink')); return; }
  $('#siteUrl').value = url;
  importSite(url);
});
$('#siteGo').addEventListener('click', () => { const u = $('#siteUrl').value.trim(); if (u) importSite(u); else $('#siteUrl').focus(); });
$('#siteUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); $('#siteGo').click(); } });
$('#siteCancel').addEventListener('click', () => {
  site?.ctrl.abort(); site = null;
  $('#siteDlg').close();
  if (!state) home();
});
$('#siteDlg').addEventListener('cancel', () => { site?.ctrl.abort(); site = null; if (!state) setTimeout(home); });
$('#siteOk').addEventListener('click', () => {
  if (!site) return;
  site.wanted = true;
  $('#siteOk').disabled = true;
  if (site.done) finishSite(site);
});

/** 開箱：網址（分享連結、?topo=、v2 入口都行）讀成一本；confirm 時等按「匯入」才存 */
async function importSite(url, { confirm = false, preview, name } = {}) {
  site?.ctrl.abort();
  const job = site = { ctrl: new AbortController(), confirm, wanted: !confirm };
  const { signal } = job.ctrl;
  const box = $('#siteBox'), cover = box.querySelector('.cover'), img = box.querySelector('.img'), tiles = box.querySelector('.tiles');
  siteView(true);
  img.style.backgroundImage = ''; img.style.setProperty('--blur', '12px');
  tiles.replaceChildren();
  box.querySelector('.name').textContent = name || T('cgLoading');
  const meta = box.querySelector('.meta');
  meta.textContent = '';
  $('#siteOk').hidden = !confirm; $('#siteOk').disabled = false;
  const self = location.origin;
  const get = async (at, init) => {
    const res = await ShareTools.open(at, { ...init, signal });   // https 照 fetch
    if (res.status === 404) throw new Error(T('cgNoData', at));
    if (!res.ok) throw new Error(`${res.status} ${at}`);
    return res;
  };
  // 預覽圖（發佈時做的：上面是入口照片，下面每張照片一格小圖）：一到就放上去，封面模糊、小圖暗著
  let pv = null;
  const showPreview = async (href, tile) => {
    if (pv || !href) return;
    pv = { tile };
    const u = await blobUrl(href, signal);
    if (!u || job !== site) return;
    pv.href = u;
    img.style.backgroundImage = `url("${u}")`;
    img.style.backgroundSize = '100% auto'; img.style.backgroundPosition = 'top';
    for (const c of tiles.children) if (c.dataset.k && !c.style.backgroundImage) cut(c, +c.dataset.k);
  };
  // 預覽圖下面的第 k 格小圖
  const cut = (c, k) => {
    const t = pv?.tile, sc = 40 / (t?.w || 1);
    if (!pv?.href || !t) return;
    c.style.backgroundImage = `url("${pv.href}")`;
    c.style.backgroundSize = `${pv.w * sc}px auto`;
    c.style.backgroundPosition = `${-(k % t.cols) * t.w * sc}px ${-(t.y + Math.floor(k / t.cols) * t.h) * sc}px`;
  };
  if (preview) showPreview(preview);
  const nodes = new Map();
  const count = () => {
    const n = [...nodes.values()];
    const walls = n.filter(x => ['wall', 'sector'].includes(x.type)).length, routes = n.filter(x => x.type === 'route').length;
    return [walls && T('cgNWallsA', walls), routes && T('cgNRoutes', routes)].filter(Boolean).join(' · ');
  };
  try {
    const entry = entryOf(url);
    // 同一個岩場匯入過：打開那一本，不再變成兩本（像紅點貓收過的直接打開）
    const had = await store.importedFrom(checkUrl(entry, self), sameSource);
    if (had && job === site) {
      site = null;
      $('#siteDlg').close();
      toast(T('cgAlreadyImported'));
      location.hash = had;
      return;
    }
    const src = await crawl(entry, async (at) => (await get(at, { cache: 'no-cache' })).json(), {
      self,
      onDoc: (doc, at) => {
        if (job !== site) return;
        if (doc.kind === 'set' && !name && box.querySelector('.name').textContent === T('cgLoading')) box.querySelector('.name').textContent = M.text(doc.name) || T('cgCrag');
        const p = doc.kind === 'set' && doc.props?.preview;
        if (p?.href) { if (pv && !pv.tile) pv.tile = p.tile; else showPreview(new URL(p.href, at).href, p.tile); }
        for (const n of doc.nodes || []) nodes.set(n.id, n);
        meta.textContent = count();
      },
    });
    if (job !== site) return;
    const { state: s, images, models } = fromV2(src, Date.now());
    box.querySelector('.name').textContent = M.text(s.book.name) || name || T('cgCrag');
    // 小圖：預覽圖有格子就切它的那一格，沒有就等照片到了放照片
    const tileOf = new Map(s.book.items.filter(i => Number.isInteger(i.props?.tile)).map(i => [i.id, i.props.tile]));
    const cells = images.map((im) => {
      const c = el('i');
      const k = tileOf.get(im.id);
      if (Number.isInteger(k)) { c.dataset.k = k; cut(c, k); }
      return c;
    });
    tiles.replaceChildren(...cells);
    let got = 0;
    const tick = () => { meta.textContent = [count(), images.length && T('cgPhotosProgress', got, images.length)].filter(Boolean).join(' · '); img.style.setProperty('--blur', `${Math.round(12 * (1 - got / Math.max(1, images.length)))}px`); };
    tick();
    // 照片 4 張一起下載（每個檔案經過公開網址要一秒多，一張一張下載太慢）
    const queue = [...images.entries()];
    await Promise.all(Array.from({ length: 4 }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const [i, im] = next;
        const blob = await (await get(checkUrl(im.url, self))).blob();
        if (!blob.type.startsWith('image/')) throw new Error(T('cgNotImage', im.url));
        im.blob = blob;
        if (job !== site) return;
        if (!cells[i].style.backgroundImage) { cells[i].style.backgroundImage = `url("${URL.createObjectURL(blob)}")`; cells[i].style.backgroundSize = 'cover'; }
        if (!img.style.backgroundImage) { img.style.backgroundImage = `url("${URL.createObjectURL(blob)}")`; img.style.backgroundSize = 'cover'; }
        cells[i].classList.add('on');
        got++; tick();
      }
    }));
    if (job !== site) return;
    // 3D 模型檔（Studio Crag 不編輯，原樣存著、發佈時附上）
    for (const [i, m] of models.entries()) {
      meta.textContent = [count(), T('cgModelProgress', i + 1, models.length)].join(' · ');
      m.blob = await (await get(checkUrl(m.url, self))).blob();
      if (job !== site) return;
    }
    job.done = { s, images, models };
    img.style.setProperty('--blur', '0px');
    if (job.wanted) await finishSite(job);
  } catch (err) {
    if (signal.aborted || job !== site) return;
    console.error('匯入岩場', err);
    toast(T('cgImportFailed', err.message));
    site = null;
    siteView(false);
    $('#siteOk').hidden = true;
  }
}

/** 下載好、也按了匯入：存成一本，打開來編 */
async function finishSite(job) {
  if (job !== site || !job.done) return;
  const { s, images, models } = job.done;
  try {
    const meta = $('#siteBox .meta');
    meta.textContent = T('cgSavingDevice');
    P.setPublishState(s, { fromSig: 'open' });   // 從公開版本匯入：第一次打開時記下內容指紋，沒改就不能發佈（不然只是把同一份再發一次）
    await store.create(s.book, [s.map, ...s.extras.values(), ...s.photos.values(), ...s.layers.values()]);
    for (const [i, im] of images.entries()) {
      meta.textContent = T('cgSavingTo', i + 1, images.length);
      await store.saveImage(s.photos.get(im.id), im.blob, await Photo.thumb(im.blob));
    }
    for (const m of models) await store.saveImage(s.extras.get(m.id), m.blob);
  } catch (err) {
    console.error('匯入岩場', err);
    $('#siteBox .meta').textContent = T('cgSaveFailedDevice', err.message);
    $('#siteOk').disabled = false;
    return;
  }
  site = null;
  $('#siteDlg').close();
  location.hash = s.book.id;
}

// ---- 轉換路線書：Word、網頁匯出檔或大綱 → 一本新的 Guidebook（convert.js 讀檔、outline.js 轉換、report.js 問題清單；規則讀不懂的才複製給 AI） ----
const BK_IMG = BOOK_IMAGE;
let bkAssets = new Map();   // 選的檔案裡的圖：路徑、檔名（小寫）→ Blob
let bkMap = null;   // 一起選的岩壁地圖（.geojson，或 ZIP 裡的）：建立時放進地圖畫面
let bkSrc = [];   // 轉換時選的所有檔案：建立時照原樣存進 source/（重跑轉換用）
let bkLoose = [];   // 直接選的照片檔（不在 Word、ZIP 裡）：大綱沒用到的也收進來（例如作者的原圖，建立時配對換上）
const bkKey = assetKey;
const bkAsset = (src) => findAsset(bkAssets, src);

/** 預覽：大綱會變成幾區、幾面岩壁、幾條路線、幾張照片，和要修的地方 */
function bkPreview() {
  const src = $('#bkText').value;
  const r = src.trim() ? fromOutline(src, { map: bkMap }) : null;
  const missing = r ? r.images.filter(i => !i.overview && !/^https:\/\//.test(i.src) && !bkAsset(i.src)) : [];
  const extra = r ? bkExtra(r).length : 0;
  // 岩場位置：大綱裡找得到座標就自動填進來（可以改）；自己填的不被蓋掉；發佈前一定要有
  const pos = $('#bkPos');
  if (!pos.dataset.manual) pos.value = r?.position ? `${r.position.position[1]}, ${r.position.position[0]}` : '';
  const typed = M.parsePosition(pos.value), badPos = pos.value.trim() && !typed;
  pos.setCustomValidity(badPos ? T('cgLatLng') : '');
  $('#bkSum').textContent = r ? [T('cgNAreas', r.count.areas), T('cgNWalls', r.count.walls), T('cgNRoutes', r.count.routes), r.count.images && T('cgNPhotos', r.count.images) + (missing.length ? T('cgMissingFiles', missing.length) : ''), r.count.overview && T('cgNOverviews', r.count.overview), extra && T('cgExtraPhotos', extra)].filter(Boolean).join(T('cgListSep')) : '';
  // 問題清單和命令列 tools/guidebook.mjs 同一份（report.js）；岩場位置在對話框另外填，不列
  const issues = r ? outlineReport(r, { missing: missing.map(i => i.src) }).issues.filter(i => i.code !== 'no-position') : [];
  const warn = [...issues.filter(i => i.code === 'outline'), ...(badPos ? [{ message: T('cgPosFormatLong') }] : []), ...issues.filter(i => i.code !== 'outline')].map(i => i.message);
  $('#bkWarn').replaceChildren(...warn.map(w => el('li', { textContent: w })));
  $('#bkPosHint').textContent = !r ? '' : badPos ? '' : typed ? '' : T('cgPosHint');
  const tiles = r ? [[r.count.areas, T('cgTileAreas')], [r.count.walls, T('cgTileWalls')], [r.count.routes, T('cgTileRoutes')], [r.count.images + (r.count.overview || 0), T('cgTilePhotos')]].filter(([n], i) => n || i < 3) : [];
  $('#bkTiles').replaceChildren(...tiles.map(([n, label]) => { const t = el('div', { className: 'bk-tile' }); t.append(el('b', { textContent: String(n) }), el('span', { textContent: label })); return t; }));
  $('#bkGo').disabled = !r || !(r.count.walls + r.count.routes) || !!badPos;
  return r;
}

/** 直接選了、大綱沒用到的照片 */
const bkExtra = (r) => { const used = new Set(r.images.map(i => bkAsset(i.src))); return bkLoose.filter(f => !used.has(f)); };

/** 步驟：pick 選檔案 → check 確認 → make 建立（下面的按鈕跟著換） */
function bkStep(step) {
  $('#bookDlg').dataset.step = step;
}

/** 建立中：進度條和「3/12」 */
function bkProgress(i, total) {
  $('#bkBar').style.width = `${Math.max(4, Math.round((i / Math.max(1, total)) * 100))}%`;
  $('#bkProg').textContent = `${i}/${total}`;
}

function openBookDlg() {
  bkAssets = new Map(); bkLoose = []; bkSrc = []; bkMap = null;
  $('#bkText').value = ''; $('#bkFiles').textContent = '';
  $('#bkPos').value = ''; delete $('#bkPos').dataset.manual;
  $('#bkAdv').open = false;
  bkStep('pick');
  bkPreview();
  $('#bookDlg').showModal();
}
$('#bkPick').addEventListener('click', () => $('#bkInput').click());
async function bkRead(files) {
  if (!files.length) return;
  $('#bkFiles').textContent = T('cgReading');
  try {
    const got = await readBookFiles(files);
    bkSrc.push(...files);
    for (const [k, v] of got.assets) bkAssets.set(k, v);
    if (got.map) bkMap = got.map;
    bkLoose.push(...files.filter(f => BK_IMG.test(f.name)));
    if (got.text) $('#bkText').value = got.text;
    const imgs = files.filter(f => BK_IMG.test(f.name)).length;
    $('#bkFiles').textContent = [...got.notes, imgs && T('cgNPhotos', imgs)].filter(Boolean).join(' · ');
  } catch (err) { console.error('讀路線書', err); $('#bkFiles').textContent = ''; toast(T('cgCantRead', err.message)); }
  // 讀到大綱就進下一步；只選了照片、還沒有大綱的留在這一步
  if (bkPreview()) bkStep('check'); else if ($('#bkFiles').textContent) $('#bkFiles').textContent += T('cgNeedText');
}
$('#bkInput').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  await bkRead(files);
});
const bkDrop = $('#bkPick');
bkDrop.addEventListener('dragover', (e) => { e.preventDefault(); bkDrop.classList.add('over'); });
bkDrop.addEventListener('dragleave', () => bkDrop.classList.remove('over'));
bkDrop.addEventListener('drop', (e) => { e.preventDefault(); bkDrop.classList.remove('over'); bkRead([...e.dataTransfer.files]); });
$('#bkPaste').addEventListener('click', () => { bkStep('check'); $('#bkAdv').open = true; $('#bkText').focus(); });
let bkTimer;
$('#bkText').addEventListener('input', () => { clearTimeout(bkTimer); bkTimer = setTimeout(bkPreview, 250); });
$('#bkLocate').addEventListener('click', () => {
  if (!navigator.geolocation) return toast(T('cgNoLocation'));
  navigator.geolocation.getCurrentPosition(({ coords }) => {
    $('#bkPos').value = `${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`;
    $('#bkPos').dataset.manual = '1';
    bkPreview();
  }, () => toast(T('cgLocationFailed')), { enableHighAccuracy: true, timeout: 15000 });
});
$('#bkPos').addEventListener('input', () => { $('#bkPos').dataset.manual = $('#bkPos').value.trim() ? '1' : ''; bkPreview(); });
$('#bkAi').addEventListener('click', () => {
  const r = bkPreview();
  const textOut = [AI_PROMPT, r?.warnings.length && `規則讀到的問題：\n${r.warnings.map(w => `- ${w}`).join('\n')}`, `路線書：\n\n${$('#bkText').value.trim()}`].filter(Boolean).join('\n\n');
  navigator.clipboard.writeText(textOut).then(() => toast(T('cgAiCopied')), (err) => toast(T('cgCopyFailed', err.message)));
});
// 手繪的區域圖交給 AI 轉成 GeoJSON：提示加上這本的岩壁標題（地圖的線靠名稱對到岩壁）；回來的 JSON 存成 .geojson，和路線書一起選
$('#bkAiMap').addEventListener('click', () => {
  const r = bkPreview(), walls = r ? r.state.book.nodes.filter(n => n.type === 'wall').map(n => `- ${M.text(n.name)}`) : [];
  const textOut = [AI_MAP_PROMPT, walls.length && `岩壁標題（properties.wall 要一字不差）：\n${walls.join('\n')}`, r?.position && `岩場入口／位置：${r.position.position[1]}, ${r.position.position[0]}（${r.position.from}）`].filter(Boolean).join('\n\n');
  navigator.clipboard.writeText(textOut).then(() => toast(T('cgAiMapCopied')), (err) => toast(T('cgCopyFailed', err.message)));
});
$('#bookDlg').addEventListener('click', (e) => {
  const b = e.target.closest('#bkGo, #bkBack, #bkPublish, #bkLook, .bk-x');
  if (!b) return;
  if (b.id === 'bkGo') createFromBook();
  else if (b.id === 'bkPublish') { $('#bookDlg').close(); goStep('publish'); openPublish(); }
  else if (b.id === 'bkLook') $('#bookDlg').close();
  else if ($('#bkGo').dataset.busy) return;
  else if (b.id === 'bkBack') openBookDlg();
  else { $('#bookDlg').close(); if (!state) home(); }
});

/** 轉換的原始檔存進專案的 source/：選的檔案、按建立時的大綱、轉換紀錄（outline：大綱的數字；換原圖時 recordOriginals 補 topos） */
async function saveSources(outline, photos) {
  const taken = new Set(), files = [];
  for (const f of bkSrc) {
    const name = sourceName(f.name, taken);
    await store.saveSource(name, f);
    files.push({ path: `source/${name}`, name: f.name, size: f.size });
  }
  await store.saveSource(OUTLINE, new Blob([$('#bkText').value], { type: 'text/markdown' }));
  const position = $('#bkPos').dataset.manual ? $('#bkPos').value.trim() : '';
  await store.saveRecord(newRecord({ files, position, counts: { files: bkSrc.length, ...outline, photos } }));
}

async function createFromBook() {
  const btn = $('#bkGo'), label = btn.textContent;
  let finished = false;
  btn.disabled = true; btn.dataset.busy = '1'; bkStep('make'); bkProgress(0, 1);
  try {
    const r = fromOutline($('#bkText').value, { map: bkMap });
    const typed = M.parsePosition($('#bkPos').value);
    if (typed) M.setCragPosition(r.state, typed);   // 自己填的位置優先
    const s = r.state, prepared = [], extras = bkExtra(r), total = r.images.length + extras.length;
    const n = (type) => s.book.nodes.filter(x => x.type === type).length, outline = { images: r.images.length, areas: n('area'), walls: n('wall'), routes: n('route') };   // 大綱的數字（之後一起選的原圖會各開岩壁，先算）
    for (const [i, img] of r.images.entries()) {
      bkProgress(i + 1, total);
      let blob = bkAsset(img.src);
      if (!blob && /^https:\/\//.test(img.src)) { const res = await fetch(img.src).catch(() => null); if (res?.ok) blob = await res.blob(); }
      if (!blob) continue;
      const file = bkKey(img.src).split('/').pop();
      let p;
      try { p = await Photo.prepare(new File([blob], file, { type: blob.type || `image/${/png$/.test(file) ? 'png' : 'jpeg'}` })); } catch (err) { console.warn('轉換路線書的圖', img.src, err); continue; }
      const view = M.newPhoto({ name: img.alt || file.replace(/\.[^.]+$/, ''), w: p.w, h: p.h, sha256: p.sha256, raw: p.raw, attribution: s.book.attribution, origin: 'authorized' });   // 轉換路線書＝使用者聲明有權利（來源與授權由使用者負責）
      M.addPhoto(s, view, img.wall);   // 區域圖（img.overview）掛在區或岩場上：沒有路線，不描線
      if (img.routes) view.props.routes = img.routes;
      prepared.push([view, p]);
    }
    // 大綱沒用到、直接選的照片（例如作者的原圖）：先各自開岩壁；「從照片描路線」會把它換進同一次快門的路線書圖的岩壁
    const outlineWalls = new Set(M.walls(s).map(w => w.id));
    for (const [i, file] of extras.entries()) {
      bkProgress(r.images.length + i + 1, total);
      let p;
      try { p = await Photo.prepare(file); } catch (err) { console.warn('轉換路線書的照片', file.name, err); continue; }
      const view = M.newPhoto({ name: file.name.replace(/\.[^.]+$/, ''), w: p.w, h: p.h, sha256: p.sha256, raw: p.raw, attribution: s.book.attribution });
      M.addPhoto(s, view);
      prepared.push([view, p]);
    }
    await store.create(s.book, [s.map, ...s.photos.values()], null, { fromBook: true });
    for (const [view, p] of prepared) await store.saveImage(view, p.image, p.thumb);
    await saveSources(outline, prepared.length - extras.length);
    const extraIds = prepared.slice(prepared.length - extras.length).map(([v]) => v.id);
    history.replaceState(null, '', '#' + s.book.id);
    await route();
    let msg = '';
    if (prepared.length) {
      $('#bkProg').textContent = T('cgTracingProg');
      const done = await autoTrace({ quiet: true, originals: extraIds });
      msg = done.msg;
      const rec = await store.readRecord();
      if (rec) await store.saveRecord({ ...rec, counts: { ...rec.counts, traced: done.drawn, stubs: done.stubs, swapped: rec.topos.length } });
    }
    // 一起選的照片是拿來換路線書的圖的：沒配到的不留（不然每張開一面空的岩壁）
    const loose = extraIds.filter(id => state.photos.has(id) && !outlineWalls.has(state.photos.get(id).props.node));
    if (loose.length) {
      const layers = M.removePhotos(state, loose);
      await dropPhotos([...loose, ...layers]);
      msg += T('cgLooseDropped', loose.length);
    }
    $('#bkDoneMsg').textContent = msg.replace(/（[^）]*）| \([^)]*\)/g, '');
    bkStep('done');
    finished = true;
  } catch (err) {
    console.error('轉換路線書', err);
    toast(T('cgConvertFailed', err.message));
  } finally {
    delete btn.dataset.busy;
    btn.disabled = false;
    btn.textContent = label;
    if (!finished && $('#bookDlg').open) bkStep('check');
  }
}

// ---- Studio 首頁單一入口的交接：非原生走現有路線書轉換；原生包完整保留資料 ----
async function fromBookInbox(key) {
  const rec = await StudioStore.inbox.take(key);
  if (!rec?.items?.length) { toast(T('cgNoFileFound')); location.replace('../'); return; }
  // 沿用現有轉換預覽，不提前建立空白專案。
  openBookDlg();
  await bkRead(rec.items.map(i => i.file));
}
async function fromNativeInbox(key) {
  const rec = await StudioStore.inbox.take(key);
  if (!rec?.items?.length) { toast(T('cgNoNativeFound')); location.replace('../'); return; }
  const validPath = path => !!path && !path.startsWith('/') && !path.includes('\\') &&
    !path.split('/').some(part => !part || part === '.' || part === '..' || part === '.studio') && !path.includes(':');
  const packed = new Map();
  try {
    for (const item of rec.items) {
      const path = [item.dir, item.file.name].filter(Boolean).join('/');
      if (!validPath(path) || packed.has(path)) throw new Error(T('cgUnsafePath', path));
      packed.set(path, item.file);
    }
    const entry = packed.get('index.json');
    if (!entry) throw new Error(T('cgMissingEntry'));
    const book = JSON.parse(await entry.text());
    if (book.climbio !== 2 || book.kind !== 'set' || book.type !== 'guidebook' ||
        typeof book.id !== 'string' || !/^[0-9a-z]{16}$/.test(book.id) ||
        !Array.isArray(book.items) || !book.items.length) throw new Error(T('cgNotEditable'));
    const old = await StudioStore.entry(book.id);
    if (old) {
      if (old.ws !== 'crag') throw new Error(T('cgIdClash'));
      toast(T('cgNativeExists'));
      location.replace('#' + book.id);
      return;
    }
    const docs = [];
    for (const item of book.items) {
      if (typeof item.id !== 'string' || !/^[0-9a-z]{16}$/.test(item.id)) throw new Error(T('cgBadScreenId'));
      const name = `${item.id}.json`, file = packed.get(name);
      if (!file) throw new Error(T('cgPackMissing', name));
      const doc = JSON.parse(await file.text());
      if (doc.id !== item.id || doc.climbio !== 2) throw new Error(T('cgIndexMismatch', name));
      docs.push(doc);
      if (doc.surface === 'photo' && doc.href && !packed.has(doc.href)) throw new Error(T('cgPhotoMissingShort', doc.href));
    }
    if (!docs.some(d => d.surface === 'map' && d.props?.purpose !== 'approach')) throw new Error(T('cgNoWallMap'));
    for (const d of [book, ...docs]) {
      const issues = ClimbioFormat.validate(d);
      if (issues.length) throw new Error(T('cgNativeInvalid', issues[0]));
    }
    // 在全部資料都通過驗證後才建立專案；照片與其它原始資源保留原路徑。
    await store.create(book, docs);
    const project = await StudioStore.entry(book.id), dir = await StudioStore.dirOf(project);
    for (const [name, file] of packed) if (name !== 'index.json' && !/^[0-9a-z]{16}\.json$/.test(name)) {
      await StudioStore.write(dir, name, file);
    }
    toast(T('cgNativeImported'));
    location.replace('#' + book.id);
  } catch (err) {
    console.error('原生岩場匯入', err);
    toast(T('cgNativeImportFailed', err.message));
    location.replace('../');
  }
}

// ---- 畫 Topo：一張照片的圖層 ----
let saving = Promise.resolve();   // 存檔一個接一個（拿掉圖層和接著再存不會顛倒）
function saveTopo(layer) {
  const result = M.saveLayer(state, layer);
  const s = state;
  saving = saving.then(async () => {
    if (state !== s) return;
    if (result === 'removed') { await persist(); await store.removeDocs([layer.id]); }
    else await persist([], [layer.id]);
  }).catch((err) => { console.error('儲存 Topo', err); toast(T('cgSaveFailed', err.message)); });
}

async function openTopo(photoId) {
  const photo = state.photos.get(photoId);
  if (!photo) { location.hash = state.book.id; return; }
  if (topo?.photo === photoId) return;
  closeTopo();
  const img = await store.getImage(photo);
  if (!img) { toast(T('cgNoPhotoFile')); location.hash = state.book.id; return; }
  const url = URL.createObjectURL(img);
  topo = { url, photo: photoId };
  $('#book').classList.remove('on');
  $('#stepPage').classList.remove('on');
  $('#topo').classList.add('on');
  activeWall = photo.props.node;
  renderSteps();
  topo.screen = new TopoScreen($('#topo'), { state, photoId, image: url, thumbs, onSave: saveTopo, onPhoto: (id) => { location.hash = `${state.book.id}/${id}`; }, onPhotoMenu: photoMenu,
    onAddPhotos: () => $('#fileInput').click(), onAutoTrace: () => traceFromTopo(), toast });
}

/** 在路線圖按「從照片描路線」：描完重新打開這張，線馬上看得到 */
async function traceFromTopo() {
  const id = topo?.photo;
  await autoTrace();
  if (!id || topo?.photo !== id) return;
  closeTopo(false);
  await openTopo(id);
}

/** 照片選單（區域圖、路線清單、路線圖照片條共用）：移出此分區（新岩壁）、移到別面岩壁、畫路線圖、刪除 */
function photoMenu(id, anchor) {
  const cur = state.photos.get(id)?.props.node;
  const move = async (wallId) => { await moveTo([id], wallId); topo?.screen.renderPhotos(); topo?.screen.renderRoutes(); };
  openMenu(anchor, [
    ...(topo ? [] : [{ label: T('cgOpenTopo'), run: () => { location.hash = `${state.book.id}/${id}`; } }]),
    { label: T('cgMoveOut'), run: () => move(null) },
    '-',
    ...M.walls(state).filter(w => w.id !== cur).map(w => ({ label: T('cgMoveTo', M.text(w.name) || T('cgUntitled')), run: () => move(w.id) })),
    '-',
    { label: T('cgDeletePhoto'), danger: true, run: async () => {
      if (!(await askConfirm(T('cgDeletePhotoQ'), T('cgDeletePhotoNote'), T('cgDelete')))) return;
      const all = state.book.items.map(i => state.photos.get(i.id)).filter(Boolean), at = all.findIndex(v => v.id === id);
      const next = all[at + 1] || all[at - 1];
      await removePhotos([id]);
      if (topo?.photo === id) location.hash = next ? `${state.book.id}/${next.id}` : state.book.id;
      else topo?.screen.renderPhotos();
    } },
  ]);
}

/** 關掉畫 Topo；back 是回到 Guidebook（關掉整本時不用） */
function closeTopo(back = true) {
  if (!topo) return;
  topo.screen?.destroy();
  URL.revokeObjectURL(topo.url);
  topo = null;
  $('#topo').classList.remove('on');
  if (back && state) {
    showPage();
    render();
  }
}

$('#topoAdd').addEventListener('click', () => { if (topo) openRoute(null, { wall: state.photos.get(topo.photo)?.props.node }); });

// ---- 導覽 ----
async function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h === 'new') { await newBook(T('cgNewGuidebook')); $('#bookName').focus(); $('#bookName').select(); return; }
  if (h === 'site') { openSiteDlg(); return; }   // 首頁的「匯入岩場站」
  if (h.startsWith('edit=')) return fromEditLink(h.slice(5));   // 編輯連結 #edit=<岩場 id>：打開這本最新的一版
  if (h.startsWith('site=')) { openSiteDlg(); $('#siteUrl').value = h.slice(5); importSite(h.slice(5)); return; }   // 分享的連結：直接匯入那個岩場，匯入完打開來編
  if (h === 'book') { history.replaceState(null, '', location.pathname); showLibrary(); return; }   // 舊的路線書頁網址：路線書併進岩場了
  if (h === 'convert') { openBookDlg(); return; }
  if (h.startsWith('bookInbox=')) return fromBookInbox(h.slice(10));
  if (h.startsWith('nativeInbox=')) return fromNativeInbox(h.slice(12));
  if (h.startsWith('inbox=')) return fromInbox(h.slice(6));
  const [id, photo] = h.split('/');
  if (!id) { showLibrary(); return; }
  if (state?.book.id !== id) await showBook(id);
  if (state?.book.id !== id) return;
  if (photo) await openTopo(photo); else closeTopo();
}
addEventListener('hashchange', route);

// 首頁掃描過的照片：開一本新的、匯入照片（沒有位置的照拍攝時間歸岩壁），有紅筆的照片描路線（options.trace：首頁照掃描結果決定，人不勾）
async function fromInbox(key) {
  const rec = await StudioStore.inbox.take(key);
  if (!rec) { home(); return; }
  let files = (rec.items || []).map(i => i.file);
  if (rec.dir) {   // 首頁選的資料夾（Chrome）：已經是 Crag 專案就打開，不是就把這本建在那裡，裡面的照片一起匯入
    const c = await StudioStore.claim(rec.dir);
    if (c.meta) { await store.openDir(c.dir); location.replace('#' + c.meta.id); return; }
    files = c.photos.map(p => p.file);
    await newBook(rec.name || rec.dir.name, c.dir);
  } else await newBook(rec.name);
  await importFiles(files);
  if (rec.options?.trace) await autoTrace();
}

// ---- 步驟列：岩場資訊 → 區域圖（改地圖、畫新的）→ 路線清單（含岩點合成）→ 路線圖 → 檢查 → 發佈 ----
const PAGES = ['check', 'publish'];
/** 書的畫面或檢查、發佈頁（照 step） */
function showPage() {
  const page = PAGES.includes(step);
  $('#book').classList.toggle('on', !page);
  $('#stepPage').classList.toggle('on', page);
  if (step === 'check') renderChecks(); else if (step === 'publish') renderPubPage();
  renderSteps();
}
/** 檢查：發佈前要處理的（沒有位置、來源不能公開的照片）和路線的問題（沒分到岩壁、沒畫線），同一面岩壁同一種問題併成一列 */
function renderChecks() {
  const rep = bookReport({ book: state.book, layers: [...state.layers.values()], photos: [...state.photos.values()], map: state.map });
  const items = rep.issues.map(i => ({ title: i.message, tone: 'bad', onClick: () => goStep('info') }));
  for (const b of P.blocked(state)) items.push({ title: b.name, note: T('cgBlockedNote'), tone: 'bad' });
  const groups = new Map();
  for (const r of rep.routes) for (const code of r.reasons.slice(0, 1)) {   // 一條路線只算最先要處理的（沒分到岩壁就先不管線）
    const key = `${r.wall}\u0000${code}`;
    if (!groups.has(key)) groups.set(key, { wall: r.wall, code, ids: [] });
    groups.get(key).ids.push(r.id);
  }
  for (const g of groups.values()) items.push({
    title: g.wall || T('cgUnassigned'), note: `${reasonText(g.code)}：${T('cgNRoutes', g.ids.length)}`,
    onClick: () => {
      const wall = nodeOf(g.ids[0])?.parent, photo = g.code !== 'unassigned' && [...state.photos.values()].find(v => v.props?.node === wall);
      if (photo) location.hash = `${state.book.id}/${photo.id}`; else goStep('walls');
    },
  });
  StudioShell.checks($('#stepPage'), items);
}
/** 發佈頁：這本書一列（狀態、匯出 ZIP、發佈） */
function renderPubPage() {
  const ps = P.publishState(state), changed = hasChanges(ps);
  const cover = state.book.items.map(i => state.photos.get(i.id)).find(Boolean);
  const actions = [{ id: 'pubExport', label: T('cgExportZip'), onClick: () => exportZip() }];
  if (versionIds().some(Boolean)) actions.unshift({ id: 'pubHistory', label: T('cgVersions'), onClick: () => openVersions() });   // 發佈過、或從公開版本匯入的：看這本書的每一版
  if (changed) actions.push({ id: 'pubOpen', label: ps.version ? T('cgPublishVer', ps.version + 1) : T('cgPublish'), primary: true, onClick: () => openPublish() });   // 發佈過、之後沒改：沒有下一版
  StudioShell.pubList($('#stepPage'), [{
    id: state.book.id, name: M.text(state.book.name) || T('cgUntitled'),
    ...(!ps.version && !changed ? { status: T('cgSameAsPublic'), tone: 'ok' } : StudioShell.pubStatus(ps.version, changed)),   // 從公開版本匯入、還沒改：不是「尚未發佈」
    actions, thumb: async (pic) => { const b = cover && await store.getThumb(cover.id); if (b) pic.style.backgroundImage = `url("${URL.createObjectURL(b)}")`; },
  }]);
}
let step = 'walls';
function renderSteps() {
  if (!state) return;
  // 頁首的 3D 場景（studio/scene/）：這本有 3D 模型、有照片記著在這個模型上的鏡頭（props.model）才出現
  const model = [...state.extras.values()].find(d => d.surface === 'model');
  const has3d = !!model && [...state.photos.values()].some(p => p.props?.model?.id === model.id && p.props.model.camera);
  $('#sceneLink').hidden = !has3d;
  if (has3d) $('#sceneLink').href = `../scene/#crag=${state.book.id}`;
  const walls = M.walls(state).length, areas = state.book.nodes.filter(n => n.type === 'area').length, routes = M.routes(state), drawn = M.drawn(state), topoN = routes.filter(r => drawn.has(r.id)).length;
  const on = topo ? 'topo' : step;
  StudioShell.steps($('#steps'), [
    { id: 'info', label: T('cgInfo') },
    { id: 'map', label: T('cgStepMap'), note: [areas && T('cgNAreas', areas), T('cgNWallsShort', walls)].filter(Boolean).join(' · ') },
    { id: 'walls', label: T('cgStepList'), note: routes.length ? T('cgRoutesN', routes.length) : '' },
    { id: 'topo', label: T('cgTopo'), note: importNote || (routes.length ? `${topoN}/${routes.length}` : '') },
    { id: 'check' },
    { id: 'publish', label: T('cgPublish') },
  ].map(x => ({ ...x, on: x.id === on })), goStep);
}
function goStep(id) {
  if (PAGES.includes(id)) {   // 檢查、發佈是一整頁；從路線圖過來先回到書（closeTopo 照 step 打開這一頁）
    step = id;
    if (topo) location.hash = state.book.id; else showPage();
    return;
  }
  if (id === 'topo') {   // 先開還有路線沒畫的照片
    const photos = state.book.items.map(i => state.photos.get(i.id)).filter(Boolean);
    if (!photos.length) { if (!handset) $('#fileInput').click(); return; }   // 還沒有照片：直接選照片（手機不加照片）
    const drawn = new Set([...state.layers.values()].map(l => l.on)), p = photos.find(v => !drawn.has(v.id)) || photos[0];
    location.hash = `${state.book.id}/${p.id}`;
    return;
  }
  step = id;
  showPage();
  if (state?.book?.id) {
    try { sessionStorage.setItem(`climbio.studio.step.${state.book.id}`, id); } catch {}
  }
  if (topo) location.hash = state.book.id;
  $('#book').dataset.focus = id === 'map' ? 'map' : id === 'info' ? 'info' : 'side';
  if (id === 'info') renderInfo();
  wallMap?.setEditing(id === 'map');   // 只有區域圖能改地圖，其他步驟的地圖只能看、點岩壁
  areaPicked = null;
  renderAreas();
  renderSteps();
  wallMap?.fit();
}
route();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('../sw.js').catch(e => console.warn('Service Worker', e));
if (StudioShell.menu) StudioShell.menu(); else fetch('../shell.js', { cache: 'reload' }).catch(() => {});   // 頁首右上的選單（語言、版本）
