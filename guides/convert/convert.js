// 轉換路線書說明頁：給 AI 的提示放進頁面（提示只有 studio/crag/ai-prompt.js 一份），按鈕複製；
// 上半部讀開放資料集 climbio/crags：有 source/（Studio 發佈時附上的原始檔與轉換紀錄 convert.json）的岩場列成清單，選一個看同一張照片轉換前後（滑桿對照）與各步驟的數字。
import { AI_PROMPT, AI_MAP_PROMPT } from '../../studio/crag/ai-prompt.js';
import { TopoViewer } from '../../topokit/index.js';

const T = AppKit.i18n.t;
AppKit.i18n.apply();

document.getElementById('promptOutline').textContent = AI_PROMPT;
document.getElementById('promptMap').textContent = AI_MAP_PROMPT;
const copyText = async (b, text) => {
  const label = b.textContent;
  try { await navigator.clipboard.writeText(text); b.textContent = T('cvCopied'); } catch { b.textContent = T('cvCopyFailed'); }
  setTimeout(() => { b.textContent = label; }, 1800);
};
for (const b of document.querySelectorAll('.copy')) b.addEventListener('click', () => copyText(b, document.getElementById(b.dataset.copy).textContent));

// ---- 新舊對照與清單 ----
const HF = 'https://huggingface.co/datasets/climbio/crags';
const RAW = `${HF}/resolve/main/`;
const $ = (id) => document.getElementById(id);
const getJson = async (url) => { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); };
const text = (v) => (typeof v === 'string' ? v : v ? v[AppKit.i18n.lang === 'en' ? 'en' : 'zh'] || Object.values(v)[0] || '' : '');
const bytes = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const siteRoot = new URL('../../', location.href).href.replace(/\/$/, '');

let viewer = null, crag = null, at = 0;

/** 目錄裡有原始檔的岩場；同一本書的舊版本（被別的列當 origin 的）不列 */
async function sourceRows() {
  const txt = await fetch(`${RAW}crags.jsonl`, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); });
  const rows = txt.split('\n').filter(Boolean).map(l => JSON.parse(l));
  const older = new Set(rows.map(r => r.origin).filter(Boolean));
  return rows.filter(r => r.source && !older.has(r.id)).sort((a, b) => b.t - a.t);
}

/** 一本：組合、所有文件、轉換紀錄；Topo＝疊了路線圖層的照片，照組合的順序 */
async function loadCrag(row) {
  const base = RAW + row.dir;
  const [book, rec] = await Promise.all([getJson(`${base}index.json`), getJson(`${base}source/convert.json`)]);
  const docs = book.props?.pack?.href ? Object.values((await getJson(base + book.props.pack.href)).docs) : await Promise.all(book.items.map(i => getJson(base + i.href)));
  const byId = new Map(docs.map(d => [d.id, d]));
  const layersOn = (id) => docs.filter(d => d.kind === 'layer' && d.on === id);
  const topos = book.items.map(i => byId.get(i.id)).filter(d => d?.surface === 'photo' && layersOn(d.id).length)
    .map(view => ({ view, layers: layersOn(view.id), fig: rec.topos.find(t => t.photo === view.sha256) || rec.topos.find(t => t.name && t.name === text(view.name)) }));
  return { row, base, book, rec, topos };
}

function renderFlow({ row, book, rec, topos }) {
  const c = rec.counts || {}, routes = book.nodes.filter(n => n.type === 'route').length;
  const has = (n) => n != null;
  // 每一步：[大字, 小字]；紀錄沒有的步驟（例如沒換過原圖）留空
  const lines = {
    read: [has(c.files) && T('cvNFiles', c.files), has(c.images) && T('cvNImages', c.images)],
    outline: [has(c.routes) && T('cvNRoutes', c.routes), has(c.walls) && T('cvNAreaWall', c.areas || 0, c.walls)],
    photos: [has(c.photos) && T('cvNPhotos', c.photos)],
    trace: [has(c.traced) && T('cvNTraced', c.traced), c.stubs ? T('cvNStubs', c.stubs) : ''],
    swap: [has(c.swapped) && T('cvNSwapped', c.swapped)],
    final: [T('cvNRoutes', routes), `${T('cvNTopos', topos.length)} · ${T('cvNVersion', row.version)}`],
  };
  for (const span of document.querySelectorAll('#cvFlow .num')) {
    const [main, sub] = lines[span.dataset.k];
    const big = document.createElement('strong');
    big.textContent = main || '';
    span.replaceChildren(...(main ? [big, sub || ''] : []));
  }
}

/** 照片在畫面上的位置（TopoViewer 放的 img），舊圖照 H（路線書座標 → 照片座標）疊上去，matrix3d 是 3×3 單應性 */
function placeOld() {
  const t = crag?.topos[at], img = $('cvTopo').querySelector('.topo-frame img'), old = $('cvOldImg');
  if (!t || !img || !img.naturalWidth || !old.naturalWidth) return;
  const host = $('cvView').getBoundingClientRect(), r = img.getBoundingClientRect();
  const s = r.width / t.view.w, ox = r.left - host.left, oy = r.top - host.top;
  const H = t.fig?.H || [1, 0, 0, 0, 1, 0, 0, 0, 1];
  // 圖檔像素就是畫面座標（路線書那張存的就是它的畫面圖），乘上 H 再縮放、平移到照片在畫面上的位置
  const M = [s * H[0] + ox * H[6], s * H[1] + ox * H[7], s * H[2] + ox * H[8], s * H[3] + oy * H[6], s * H[4] + oy * H[7], s * H[5] + oy * H[8], H[6], H[7], H[8]];
  old.style.width = `${old.naturalWidth}px`;
  old.style.transform = `matrix3d(${M[0]},${M[3]},0,${M[6]},${M[1]},${M[4]},0,${M[7]},0,0,1,0,${M[2]},${M[5]},0,${M[8]})`;
}
function setSplit() {
  const v = Number($('cvSlider').value);
  $('cvOld').style.clipPath = `inset(0 ${100 - v}% 0 0)`;
  $('cvSplit').style.left = `${v}%`;
}

function showTopo(i) {
  at = Math.max(0, Math.min(crag.topos.length - 1, i));
  const t = crag.topos[at];
  $('cvPrev').disabled = at === 0;
  $('cvNext').disabled = at === crag.topos.length - 1;
  const wall = crag.book.nodes.find(n => n.id === t.view.props?.node);
  $('cvCap').textContent = [T('cvCapOf', at + 1, crag.topos.length), text(wall?.name) || text(t.view.name)].filter(Boolean).join(' · ');
  viewer ||= new TopoViewer($('cvTopo'), { zoom: false, controls: false, interactive: false, bolts: true, names: false });
  const old = $('cvOldImg');
  old.style.transform = 'scale(0)';
  old.onload = placeOld;
  old.src = crag.base + (t.fig?.figure || t.view.href);
  viewer.setData({ view: { ...t.view, href: crag.base + t.view.href }, layers: t.layers, nodes: crag.book.nodes });
}

async function pick(row, rows) {
  for (const b of $('cvPick').children) b.setAttribute('aria-pressed', String(b.dataset.id === row.id));
  $('cvMsg').hidden = false;
  $('cvMsg').textContent = T('cvLoading');
  try {
    crag = await loadCrag(row);
    renderFlow(crag);
    if (!crag.topos.length) { $('cvMsg').textContent = T('cvNoneYet'); return; }
    $('cvMsg').hidden = true;
    showTopo(0);
  } catch (err) {
    console.error('讀轉換紀錄', err);
    $('cvMsg').textContent = T('cvLoadFail');
  }
}

function renderList(rows) {
  const list = $('cvList');
  list.replaceChildren(...rows.map(r => {
    const item = document.createElement('div'), name = document.createElement('b'), by = document.createElement('span'), size = document.createElement('span'), links = document.createElement('div');
    item.className = 'cv-item';
    name.textContent = r.name;
    by.textContent = [T('cvBy', r.attribution), T('cvNPhotos', r.photos), T('cvNVersion', r.version)].join(' · ');
    size.textContent = T('cvSourceSize', r.source.files, bytes(r.source.bytes));
    links.className = 'links';
    const a = (href, label) => Object.assign(document.createElement('a'), { href, textContent: label, rel: 'noopener' });
    const rerun = Object.assign(document.createElement('button'), { type: 'button', textContent: T('cvRerun') });
    rerun.addEventListener('click', () => copyText(rerun, `hf download climbio/crags --repo-type dataset --include "${r.dir}source/*" --local-dir crags\nnode tools/guidebook.mjs rerun crags/${r.dir} --out pack`));
    links.append(a(`${siteRoot}/p/${r.id}`, T('cvOpen')), a(`${HF}/tree/main/${r.dir}source`, T('cvSource')), rerun);
    item.append(name, by, size, links);
    return item;
  }));
}

async function initCompare() {
  let rows;
  try { rows = await sourceRows(); } catch (err) { console.error('讀目錄', err); $('cvMsg').textContent = T('cvLoadFail'); $('cvList').textContent = T('cvLoadFail'); return; }
  renderList(rows);
  if (!rows.length) { $('cvMsg').textContent = T('cvNoneYet'); $('cvList').textContent = T('cvNoneYet'); return; }
  $('cvPick').hidden = rows.length < 2;
  $('cvPick').replaceChildren(...rows.map(r => {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: r.name });
    b.dataset.id = r.id;
    b.addEventListener('click', () => { history.replaceState(null, '', `#${r.id}`); pick(r, rows); });
    return b;
  }));
  pick(rows.find(r => r.id === location.hash.slice(1)) || rows[0], rows);
}

$('cvSlider').addEventListener('input', setSplit);
$('cvPrev').addEventListener('click', () => showTopo(at - 1));
$('cvNext').addEventListener('click', () => showTopo(at + 1));
new ResizeObserver(() => placeOld()).observe($('cvView'));
// 照片載好（TopoViewer 的 img）才知道位置
$('cvTopo').addEventListener('load', placeOld, true);
setSplit();
initCompare();
