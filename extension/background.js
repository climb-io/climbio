// 按下工具列的圖示：讀目前這一頁 → 轉成紅點貓的格式 → 交給電腦上的紅點貓（handoff.js：開一個紅點貓分頁，頁面把資料拿走存進去）。全部在使用者的瀏覽器裡做，不經過 Climbio 的伺服器。
// 進度顯示在頁面右下角的面板（三個步驟、各自的張數、總進度條），跟紅點貓收岩場的進度同一種感覺。
import { extractPage, convert, pageVersion, setIdOf } from './thecrag.js';
import { idbStore, open as openBundle, pending, serve } from './handoff.js';
import { pool } from './sourcekit/pool.js';
import { panel } from './panel.js';
import { siteOf } from './sites.js';
import { discover, loadAreas, prepare as prepareArea } from './climbio-site.js';
import { loadUnits, prepare as prepareCrag } from './openclimbing.js';
import { extractPage as extractHk, prepare as prepareHk, usablePhotos } from './hkclimbing.js';
import { fitImage } from './sourcekit/photo-size.js';
import { buildSheet } from './sourcekit/preview-sheet.js';

const COLLECTION = ['Climbio'];   // 收藏的路徑根（最後一層是岩場 id）
const REDPOINT = 'https://climbio.app/redpoint/';   // 收好後打開的紅點貓；測試別的站：在擴充的背景頁 chrome.storage.local.set({ redpointUrl })
const store = idbStore();
const open = (path) => openBundle(store, path);
const STEPS = ['讀取頁面', '下載 Topo 圖片', '交給紅點貓'];
const WEIGHT = [0.05, 0.35, 0.6];   // 三個步驟佔總進度的比例
const WRITES = 6;                   // 同時處理幾個檔案
const VERSION = chrome.runtime.getManifest()?.version || '0.2.1';

/** 進度：照三個步驟的比例算總進度，每次更新送一次面板 */
function progressOf(tabId) {
  const steps = STEPS.map((label) => ({ label, status: 'todo', count: '' }));
  const state = { kind: 'busy', title: '', steps, progress: 0, version: VERSION };
  const send = () => chrome.scripting.executeScript({ target: { tabId }, func: panel, args: [state] }).catch(() => {});
  return {
    state,
    /** 第 i 步做到 done／total（total 是 0 或沒給就是這一步只有開始） */
    step(i, done = 0, total = 0) {
      steps.forEach((s, k) => { s.status = k < i ? 'done' : k === i ? 'doing' : 'todo'; if (k !== i) s.count = k < i ? s.count : ''; });
      steps[i].count = total ? `${done}／${total}` : '';
      state.progress = WEIGHT.slice(0, i).reduce((a, b) => a + b, 0) + (total ? WEIGHT[i] * (done / total) : 0);
      return send();
    },
    /** 開始進度：三個步驟都從頭（可以接在導引、勾選之後） */
    begin(title) {
      steps.forEach((s) => Object.assign(s, { status: 'todo', count: '' }));
      Object.assign(state, { kind: 'busy', title, steps, progress: 0, message: '', hint: '', options: undefined });
      return send();
    },
    /** 勾選：options 是 [{ id, label, sub, disabled }]，面板按下按鈕送 { type: 'pick', ids } 給背景程式 */
    pick(title, options) {
      Object.assign(state, { kind: 'pick', title, options, cta: '收藏', steps: [], progress: 0, message: '', hint: '沒有 Topo（路線圖）的區不收藏。' });
      return send();
    },
    /** 導引：這一頁不能收藏時，說明要怎麼做（沒有進度） */
    notice(title, message, hint) {
      Object.assign(state, { kind: 'notice', title, message, hint, steps: [], progress: 0 });
      return send();
    },
    done(title, message, hint) {
      steps.forEach((s) => { s.status = 'done'; });
      Object.assign(state, { kind: 'done', title, message, hint, progress: 1 });
      return send();
    },
    fail(message) {
      Object.assign(state, { kind: 'error', message });
      return send();
    },
    title(title) { state.title = title; return send(); },
  };
}

/** 圖片抓回來：照 sourcekit/photo-size.js 縮到長邊 1600 以內（size 給了就縮成剛好這個大小），回傳 { blob, w, h }（座標照這個大小） */
async function loadImage(url, size) {
  return fitImage(await fetchBlob(url), { size });
}

async function fetchBlob(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`圖片 ${res.status}：${url}`);
  return res.blob();
}

/**
 * 寫進一個岩場的收藏：合成預覽圖最先（紅點貓一下就有東西先顯示）、圖片、其他檔案、index.json 最後
 * （紅點貓看到 index.json 時，其他檔案都已經在了）。sheet：{ path, blob }（可以沒有）；photos：[{ path, blob }]；files：[{ path, json }]。
 * tick() 每寫好一個檔案叫一次。
 */
async function writeAll(dir, { sheet, photos, files }, tick) {
  if (sheet) { await dir.put(sheet.path, sheet.blob); await tick(); }
  await pool(photos, WRITES, async (p) => { await dir.put(p.path, p.blob, { overwrite: false }); await tick(); });
  // 合併檔 pack.json：入口以外的 JSON 全放進去（紅點貓匯入一次讀回，不逐檔讀）；逐檔的照發佈
  const json = (path, doc) => dir.put(path, new Blob([JSON.stringify(doc)], { type: 'application/json' }));
  const rest = files.filter((f) => f.path !== 'index.json'), entry = files.find((f) => f.path === 'index.json');
  await pool(rest, WRITES, async (f) => { await json(f.path, f.json); await tick(); });
  await json('pack.json', { docs: Object.fromEntries(rest.map((f) => [f.path, f.json])) });
  await tick();
  await json('index.json', { ...entry.json, props: { ...entry.json.props, pack: { href: 'pack.json' } } });
  await tick();
}

const guide = (title, message, hint) => ({ notice: true, title, message, hint, version: VERSION });

/** 按下圖示：辨識已支援的來源，其他網址只顯示一般導引。 */
async function save(tab, ui) {
  const site = siteOf(tab.url);
  if (!site) {
    // 不在清單裡的網站：頁面有 <link rel="climbio"> 就是支援「用紅點貓收藏」的網站，網站自己公開資料，不用更新擴充功能
    const [{ result: root } = {}] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: discover }).catch(() => []);
    if (root) return offer(tab, ui, 'climbio', await climbioSource(root), root);
    return guide('這個網站還不能收藏', '目前支援 theCrag、OpenClimbing、香港攀岩，以及有提供紅點貓收藏的網站。', '請手動打開支援的網站上你要收藏的岩場頁，再按一次。');
  }
  if (site.id === 'hkclimbing') return startHk(tab, ui);
  if (site.id === 'openclimbing') return startOpenClimbing(tab, ui);
  if (site.id === 'hkclimbing') return startHk(tab, ui);
  return saveTheCrag(tab, ui);
}

async function saveTheCrag(tab, ui) {
  // 先安靜地讀頁面：不是岩場頁、或沒有 Topo（路線圖）就只給導引，不顯示進度、不下載
  const [{ result: page }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPage });
  if (!page?.routes?.length) return guide('這一頁不是岩場頁', '請手動打開你要收藏的岩場頁（有路線清單的頁面），再按一次「紅點貓收藏」。', '區域頁底下有很多岩場，請先從清單點進其中一個岩場。');
  if (!page.topos.some((t) => t.image && t.marks.length)) return guide('這一頁沒有 Topo', '這個岩場頁沒有路線圖（Topo），所以不收藏。', '請手動打開有路線圖的岩場頁，再按一次「紅點貓收藏」。');
  await ui.begin(page.name);
  await ui.step(0);

  // 內容指紋跟還在等紅點貓拿走的那份一樣：什麼都不用做
  const v = await pageVersion(page), dir = await open([...COLLECTION, setIdOf(page)]);
  if (dir.version() === v) {
    return { title: page.name, message: '已經在等紅點貓拿走了', hint: `${page.routes.length} 條路線、${page.topos.length} 張 Topo，內容沒有變動；到紅點貓打開就會匯入` };
  }

  // 圖片：同一張圖只抓一次；抓不到的那張 Topo 略過
  const pics = new Map(), images = {}, urls = [...new Set(page.topos.map((t) => t.image).filter(Boolean))];
  let failed = 0, got = 0;
  await ui.step(1, 0, urls.length);
  await pool(urls, 3, async (url) => {
    try { pics.set(url, await loadImage(url)); } catch (e) { failed++; console.warn('圖片', url, e); }
    await ui.step(1, ++got, urls.length);
  });
  for (const topo of page.topos) if (pics.has(topo.image)) images[topo.id] = pics.get(topo.image);

  const out = convert(page, images, Date.now(), v);
  const writes = out.photos.length + out.files.length + 1 + (out.sheet ? 1 : 0);
  let wrote = 0;
  await ui.step(2, 0, writes);
  await writeAll(dir, {
    sheet: out.sheet && { path: out.sheet.path, blob: await buildSheet(out.sheet.urls.map((u) => pics.get(u).blob)) },
    photos: out.photos.map((p) => ({ path: p.path, blob: pics.get(p.url).blob })),
    files: out.files,
  }, () => ui.step(2, ++wrote, writes));
  if (!failed) { await dir.setVersion(v, page.name); await deliver(); }   // 全部好了才交出去；有圖片讀不到就不交，下次會重收
  return {
    title: page.name,
    message: failed ? '已收藏，有圖片讀不到' : '已交給紅點貓',
    hint: `${page.routes.length} 條路線、${out.photos.length} 張 Topo${failed ? `（${failed} 張圖片讀不到，這次沒有交給紅點貓，請再按一次）` : '。紅點貓已在新分頁打開，會自動匯入'}`,
  };
}

/**
 * 網站上能分開收的單位（龍洞的各區、OpenClimbing 區域底下的各岩場）：src 是 { title, noun, none, extra, list: [{ id, name, topos, prepare }] }。
 * 有 Topo 的只有一個就直接收；有好幾個讓使用者勾選（面板按下按鈕會送 { type: 'pick', ids }，見最下面的 onMessage，
 * 哪個網站記在 chrome.storage.session 的 pending）；一個都沒有就只給導引。
 */
async function offer(tab, ui, site, src, url = tab.url) {
  const ready = src.list.filter((x) => x.topos);
  if (!ready.length) return guide(...src.none);
  if (ready.length === 1) return saveUnits(ui, src.title, ready, src.extra);
  await chrome.storage.session.set({ pending: { site, url } });
  await ui.pick(`${src.title}：要收藏哪幾個${src.noun}？`, src.list.map((x) => ({ id: x.id, label: x.name, sub: x.topos ? `${x.topos} 張 Topo` : '沒有 Topo，不收藏', disabled: !x.topos })));
  return { picking: true };
}

/** 網站公開的 Climbio 格式出口（任何網站，入口網址是頁面 <link rel="climbio"> 指到的）：讀現場的資料 */
async function climbioSource(root) {
  const areas = await loadAreas({ root });
  const top = await fetch(root).then((r) => r.json()).catch(() => ({}));
  const title = (typeof top.name === 'string' ? top.name : top.name?.['zh-Hant'] ?? top.name?.en) || new URL(root).hostname;
  return {
    title, noun: '區', none: [`${title}還沒有 Topo`, '這個網站上還沒有路線圖（Topo），沒有可以收藏的。', '網站加上 Topo 之後再按一次。'],
    list: areas.map((a) => ({ id: a.id, name: a.name, topos: a.topos, prepare: () => prepareArea(a) })),
  };
}

/** OpenClimbing 的岩場或區域頁：讀 OSM 與 Wikimedia Commons 的公開資料 */
async function openclimbingSource(url) {
  const { root, units, skipped } = await loadUnits(url, { keepEmpty: true });
  return {
    title: root.name || 'OpenClimbing', noun: '岩場',
    none: ['這個岩場沒有 Topo', '這一頁在 OpenClimbing 上還沒有畫在照片上的路線圖（Topo），或照片的授權不能收，所以不收藏。', '請手動打開有路線圖的岩場或區域頁，再按一次。'],
    extra: skipped ? `${skipped} 張照片的授權不是 CC 或公眾領域，沒收` : '',
    list: units.map((u) => ({ id: String(u.rel.id), name: u.name, topos: u.topos, prepare: () => prepareCrag(u) })),
  };
}

/** 香港攀岩網站的岩場頁：路線是文字、線畫在照片裡，所以要有路線也要有照片 */
async function startHk(tab, ui) {
  const [{ result: page }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractHk });
  if (!page?.routes?.length) return guide('這一頁不是岩場頁', '請手動打開 hongkongclimbing.com 上有路線清單的岩壁頁，再按一次「紅點貓收藏」。', '區域頁底下有很多岩壁，請先從清單點進其中一頁。');
  if (!usablePhotos(page).length) return guide('這一頁沒有夠大的照片', '這個岩壁頁沒有 Topo 照片，或照片長邊不到 800 像素（放大後看不清楚線），所以不收藏。', '請手動打開有照片的岩壁頁，再按一次「紅點貓收藏」。');
  return offer(tab, ui, 'hkclimbing', { title: page.name, noun: '岩場', none: [], list: [{ id: page.url, name: page.name, topos: usablePhotos(page).length, prepare: () => prepareHk(page) }] });
}

async function startOpenClimbing(tab, ui) {
  let src;
  try { src = await openclimbingSource(tab.url); } catch (e) {
    if (e.guide) return guide('這一頁不是岩場', '請手動打開 openclimbing.org 上你要收藏的岩場或區域頁（網址是 /relation/…）。', '首頁、地圖、單一路線的頁面不能收藏。');
    throw e;
  }
  return offer(tab, ui, 'openclimbing', src);
}

/**
 * 收藏網站上選好的幾個單位（資料照網站原樣）：內容指紋一樣的跳過；一個單位一份收藏。
 * chosen：[{ name, prepare }]，prepare() → { id, name, files, photos: [{ path, url, size? }], sheet, version }；extra：結果的補充說明
 */
async function saveUnits(ui, title, chosen, extra = '') {
  await ui.begin(title);
  await ui.step(0);
  const todo = [], same = [];
  for (const p of await Promise.all(chosen.map((x) => x.prepare()))) {
    const dir = await open([...COLLECTION, p.id]);
    (dir.version() === p.version ? same : todo).push({ p, dir });
  }
  const names = (list) => list.map(({ p }) => p.name).join('、');
  if (!todo.length) return { title, message: '已經在等紅點貓拿走了', hint: `${names(same)}：內容沒有變動；到紅點貓打開就會匯入` };

  const sizes = new Map(todo.flatMap(({ p }) => p.photos.map((x) => [x.url, x.size]))), urls = [...sizes.keys()], pics = new Map();
  let got = 0;
  await ui.step(1, 0, urls.length);
  await pool(urls, 3, async (url) => {
    const size = sizes.get(url);   // 有 size（OpenClimbing）縮成文件裡寫的大小；沒有（龍洞：站上自己的檔案，座標已經算好）原樣存
    pics.set(url, size ? (await loadImage(url, size)).blob : await fetchBlob(url));
    await ui.step(1, ++got, urls.length);
  });

  // 照片下載好之後才能做的加工（例如讀照片上印的號碼牌，標成路線號碼）：多出來的圖層檔放進這份收藏，組合的 items 也加上
  for (const { p } of todo) {
    if (!p.annotate) continue;
    try {
      const extra = await p.annotate(pics);
      if (!extra.files.length) continue;
      p.files = [...p.files, ...extra.files];
      const entry = p.files.find((f) => f.path === 'index.json');
      entry.json = { ...entry.json, items: [...entry.json.items, ...extra.items] };
    } catch (e) { console.warn('加工', p.name, e); }   // 加工失敗不影響收藏照片與路線文字
  }
  const writes = todo.reduce((n, { p }) => n + p.photos.length + p.files.length + 1 + (p.sheet ? 1 : 0), 0);
  let wrote = 0;
  await ui.step(2, 0, writes);
  for (const { p, dir } of todo) {
    await writeAll(dir, {
      sheet: p.sheet && { path: p.sheet.path, blob: await buildSheet(p.sheet.urls.map((u) => pics.get(u))) },
      photos: p.photos.map((x) => ({ path: x.path, blob: pics.get(x.url) })),
      files: p.files,
    }, () => ui.step(2, ++wrote, writes));
    await dir.setVersion(p.version, p.name);
  }
  await deliver();
  return {
    title,
    message: '已交給紅點貓',
    hint: [`${names(todo)}（${todo.reduce((n, { p }) => n + p.photos.length, 0)} 張 Topo）${same.length ? `；${names(same)} 內容沒變` : ''}`, extra, '紅點貓已在新分頁打開，會自動匯入'].filter(Boolean).join('。'),
  };
}

// 擴充的檔案換了就自動更新（用「載入未封裝項目」載入的擴充，檔案是直接從資料夾讀的）：載入時算一次這些檔案的指紋，每次按下圖示再算一次，
// 不一樣就先說一聲、重新載入，不用再去 chrome://extensions 按重新整理。新增檔案時要加進這個清單。
const FILES = ['manifest.json', 'background.js', 'handoff.js', 'panel.js', 'sites.js', 'hash.js', 'thecrag.js', 'climbio-site.js', 'openclimbing.js', 'hkclimbing.js', 'sourcekit/photo-size.js', 'sourcekit/ids.js', 'sourcekit/pool.js', 'sourcekit/trace.js', 'sourcekit/badge-digits.js', 'sourcekit/openclimbing-read.js', 'sourcekit/preview-layout.js', 'sourcekit/preview-sheet.js'];
async function fingerprint() {
  const parts = await Promise.all(FILES.map(async (f) => (await fetch(chrome.runtime.getURL(f), { cache: 'no-store' })).text()));
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('\0')));
  return Array.from(new Uint8Array(bytes), (n) => n.toString(16).padStart(2, '0')).join('');
}
const loaded = fingerprint().catch(() => null);

chrome.action.onClicked.addListener(async (tab) => {
  const ui = progressOf(tab.id);
  try {
    const [before, now] = [await loaded, await fingerprint().catch(() => null)];
    if (before && now && before !== now) {
      await ui.done('擴充已更新', '已換成新版，請再按一次「紅點貓收藏」', '');
      setTimeout(() => chrome.runtime.reload(), 400);
      return;
    }
    await finish(ui, await save(tab, ui));
  } catch (e) {
    console.error(e);
    await ui.fail(e.message);
  }
});

/** 打開紅點貓分頁，讓它來拿（頁面網址帶 #collect；已經開著的紅點貓分頁也一樣開新的，簡單） */
async function deliver() {
  if (!(await pending(store))) return;
  const { redpointUrl } = await chrome.storage.local.get('redpointUrl');
  await chrome.tabs.create({ url: `${redpointUrl || REDPOINT}#collect` });
}

// 紅點貓分頁連進來拿檔案（externally_connectable 只放 Climbio 的網站與本機測試的網址）
chrome.runtime.onConnectExternal?.addListener((port) => {
  const origin = port.sender?.origin || '';
  if (/^https:\/\/(climbio\.app|climbio\.web\.app|climbio-dev\.web\.app)$/.test(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) serve(port, store);
  else port.disconnect();
});

/** 轉接器的結果顯示在面板：導引、完成；勾選中（面板已經顯示勾選）不用動 */
const finish = (ui, r) => (r.picking ? undefined : r.notice ? ui.notice(r.title, r.message, r.hint) : ui.done(r.title, r.message, r.hint));

// 面板上勾好要收的、按下按鈕：接著收藏（背景程式可能睡著過，所以哪個網站記在 chrome.storage.session、資料重新讀一次，不靠記憶體裡的狀態）
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'pick' || !sender.tab) return;
  const ui = progressOf(sender.tab.id);
  chrome.storage.session.get('pending')
    .then(async ({ pending }) => {
      if (!pending) throw new Error('找不到剛才的選擇，請再按一次「紅點貓收藏」');
      const src = pending.site === 'climbio' ? await climbioSource(pending.url) : await openclimbingSource(pending.url);
      return saveUnits(ui, src.title, src.list.filter((x) => msg.ids.includes(x.id) && x.topos), src.extra);
    })
    .then((r) => finish(ui, r), (e) => { console.error(e); return ui.fail(e.message); });
});

// 給 Climbio Studio 直接抓 Google 相簿分享連結與原始照片（=d），繞過瀏覽器對 Google 相簿的 CORS 限制。
const ALBUM_HOSTS = new Set(['photos.app.goo.gl', 'photos.google.com', 'lh3.googleusercontent.com']);
function checkAlbumTarget(raw) {
  const u = new URL(String(raw || ''));
  if (u.protocol !== 'https:' || !ALBUM_HOSTS.has(u.hostname)) throw new Error('不支援的相簿網址');
  return u.href;
}
function bytesToB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
chrome.runtime.onMessageExternal?.addListener((msg, _sender, sendResponse) => {
  if (!msg || (msg.op !== 'album-text' && msg.op !== 'album-blob')) return false;
  (async () => {
    const url = checkAlbumTarget(msg.url);
    const r = await fetch(url, { credentials: 'omit' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (msg.op === 'album-text') return { ok: true, text: await r.text() };
    const buf = new Uint8Array(await r.arrayBuffer());
    return {
      ok: true,
      b64: bytesToB64(buf),
      type: r.headers.get('content-type') || 'image/jpeg',
      disposition: r.headers.get('content-disposition') || '',
    };
  })().then(sendResponse, (e) => sendResponse({ ok: false, error: e.message || String(e) }));
  return true;
});
