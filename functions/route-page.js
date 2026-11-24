// 路線連結 /r/{照片編號}/{路線 id}/（Hosting 轉給雲端函式 routePage）：給 LINE、FB 等的爬蟲一頁帶這條路線預覽圖、標題的 HTML，
// 人打開就轉進 App 收這條線（/?p=照片編號&r=路線 id）。只用 JavaScript 轉：Facebook 的爬蟲會跟著 meta refresh 走到 App 首頁、拿不到這條路線的預覽圖。
// 預覽頁：標題是路線名稱與難度，說明是岩館、牆、岩點數、定線者（share-preview.js），圖是牆的縮圖；3D 牆的線打開後進 3D 牆。
// 同一個網址後面接 route.json 是給任何 App 收線的公開資料（不用登入、允許跨網域）：這條路線疊在牆上的圖層（Climbio 公開格式 v2），
// 圖層的 href 指到開放資料集裡牆的畫面；從 routes.json 切出這一條。
// /p/{專案 id}（岩場、3D 牆的固定分享網址）的預覽頁也由這個函式回。全部只讀資料集的固定網址（index/world.json、routes.json、crags/），不查資料庫、不寫入。
const { fixedId } = require('./open-format');
const { routePreview, wallPreview, cragPreview, model3dPreview } = require('./share-preview');
const PID = /^[0-9a-z]{8,40}$/, RID = /^[0-9a-z]{1,40}$/, ITEM = /^[0-9a-z]{1,40}$/;
const WALLS = 'https://huggingface.co/datasets/climbio/walls/resolve/main/', CRAGS = 'https://huggingface.co/datasets/climbio/crags/resolve/main/';
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// { pid, rid, file: ''（預覽頁）| 'route.json' }
function parsePath(path) {
  const m = /^\/r\/([^/]+)\/([^/]+)(?:\/(route\.json)?)?$/.exec(path || '');
  return m && PID.test(m[1]) && RID.test(m[2]) ? { pid: m[1], rid: m[2], file: m[3] || '' } : null;
}
// 牆的連結 /r/{照片編號}/（沒有路線 id）：一面公開牆的預覽頁，人打開就轉進 App 收這面牆
const parseWallPath = (path) => { const m = /^\/r\/([^/]+)\/?$/.exec(path || ''); return m && PID.test(m[1]) ? { pid: m[1] } : null; };
// 固定分享網址 /p/{專案 id}（岩場 Guidebook 或 3D 牆）的預覽頁；/p/{id}/{檔} 由 Hosting 直接導向資料集，不經過這裡
const parseHomePath = (path) => { const m = /^\/p\/([0-9a-z]{16})\/?$/.exec(path || ''); return m ? { id: m[1] } : null; };
const DATA_CACHE = 'public, max-age=86400', REVALIDATE = 'public, no-cache, s-maxage=60';

// 只讀資料集（Hugging Face 的固定網址）：不查資料庫。同一個網址在這個執行個體記 60 秒；讀不到（404、逾時）回 null
const memo = new Map();
function getJson(url) {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 60e3) return hit.p;
  const p = fetch(url, { signal: AbortSignal.timeout(4000) }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  memo.set(url, { at: Date.now(), p });
  if (memo.size > 200) memo.delete(memo.keys().next().value);
  return p;
}
const rowOf = async (get, pid) => (((await get(`${WALLS}index/world.json`)) || {}).walls || []).find(w => w.id.endsWith(`/${pid}`)) || null;
const thumbOf = (row, pid) => (row.m3d ? `${row.base}thumb.jpg` : `${WALLS}walls/${row.id.split('/')[0]}/current/${pid}.thumb.jpg`);

// 這條路線疊在牆上的圖層（Climbio 公開格式 v2）：公開牆是從整面牆的 routes.json 切出這一條（route 節點、它的標記和標記指到的岩點）；
// 3D 牆存的是片段，原樣放進圖層。沒有（不是公開牆、那條線不在）回 null
async function routeData({ get, origin, pid, rid }) {
  const row = await rowOf(get, pid);
  if (!row || !row.n) return null;
  const doc = await get(`${WALLS}walls/${row.id.split('/')[0]}/routes.json`);
  if (!doc) return null;
  const id = fixedId(origin, pid, rid);
  if (row.m3d) {
    const e = (doc.routes || []).find(x => x.id === rid);
    let f = null; try { f = e && JSON.parse(e.r); } catch (x) { f = null; }
    return f ? { climbio: 2, kind: 'layer', id, on: pid, href: `${row.base}index.json`, t: e.t || 0, license: 'CC-BY-SA-4.0', nodes: f.nodes || [], marks: f.marks || [] } : null;
  }
  const node = (doc.nodes || []).find(n => n.id === rid && n.type === 'route');
  if (!node) return null;
  const marks = (doc.marks || []).filter(m => m.props && m.props.route === rid), used = new Set(marks.map(m => m.node));
  return { ...doc, id, t: node.t || 0, nodes: [node, ...(doc.nodes || []).filter(n => n.id !== rid && used.has(n.id))], marks };
}
// 連結預覽頁：給 LINE、FB 等的爬蟲標題、說明、預覽圖，人打開就用 JavaScript 轉到 target（絕對網址）。
// url：og:url 和 canonical。line：在 LINE 的內建瀏覽器打開就在 target 加 openExternalBrowser=1（改用手機的瀏覽器，見 js/sync.js 的 shareUrl）；
// 判斷放在網頁裡，同一個網址的回應不分瀏覽器，CDN 才能快取
const js = (v) => JSON.stringify(v).replace(/</g, '\\u003c');   // 放進 <script> 的字串：不能有 </script>
// files：App 打開後馬上要讀的檔案（收線的路線圖層）：轉進 App 之前就開始下載（keepalive，換頁後不會被停掉），App 用同一個網址、同樣的 fetch 設定讀。
// 實測 Chromium：<link rel="preload">、"prefetch" 在這頁馬上轉走時會被停掉；keepalive 的請求換頁後照樣下載，但只有 App 在它還沒下載完時讀同一個網址才併用
// （下載完時這頁已經不在，回應不進 HTTP 快取）。所以只先下載圖層：App 一打開就讀它；牆、縮圖要等圖層到了才讀，先下載只會重複下載
const fetchAhead = (files) => (files.length ? `${js(files)}.forEach(function(u){try{fetch(u,{keepalive:true}).catch(function(){})}catch(e){}});` : '');
const routeFiles = (origin, pid, rid) => [`${origin}/r/${pid}/${encodeURIComponent(rid)}/route.json`];
// handoff：預覽頁已經查到的文件 { url, doc }（路線圖層、岩場入口），轉進 App 前存進 sessionStorage（預覽頁和 App 同源、同一個分頁），
// App 一開就有路線資料，不用再呼叫一次 route.json；存不進去（無痕、換瀏覽器）就照常下載
const stash = (h) => (h ? `try{sessionStorage.setItem('climbio.handoff',${js(JSON.stringify(h))})}catch(e){}` : '');
function previewPage({ url, target, title, description, image, line = false, files = [], handoff = null }) {
  const go = line
    ? `var u=${js(target)};if(/Line\\//i.test(navigator.userAgent))u+=(u.indexOf('?')<0?'?':'&')+'openExternalBrowser=1';location.replace(u)`
    : `location.replace(${js(target)})`;
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<meta property="og:type" content="website"><meta property="og:site_name" content="Climbio">
<meta property="og:url" content="${esc(url)}"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}"><meta property="og:image" content="${esc(image.url)}">
${image.width ? `<meta property="og:image:width" content="${image.width}"><meta property="og:image:height" content="${image.height}">` : ''}
<meta name="twitter:card" content="${image.width ? 'summary_large_image' : 'summary'}">
<link rel="canonical" href="${esc(url)}">
<style>body{margin:0;background:#0a0a0a;color:#f2f2f2;font:16px/1.4 system-ui,sans-serif;display:flex;justify-content:center}main{width:100%;max-width:480px;padding:72px 16px 0;box-sizing:border-box}
.ph{aspect-ratio:4/3;border-radius:16px;background:#1a1a1a center/cover no-repeat;filter:blur(14px);transform:scale(1.02);overflow:hidden}h1{font-size:20px;margin:20px 0 6px}p{margin:0;color:#9a9a9a;font-size:14px}</style>
</head><body><main><div class="ph" style="background-image:url('${esc(encodeURI(image.url).replace(/'/g, '%27'))}')"></div><h1>${esc(title)}</h1><p>${esc(description)}</p></main><script>${handoff ? stash(handoff) : fetchAhead(files)}${go}</script><noscript><a href="${esc(target)}">Climbio</a></noscript></body></html>`;
}
const page = ({ origin, pid, rid, target = `${origin}/?p=${pid}&r=${encodeURIComponent(rid)}`, ...rest }) => previewPage({ url: `${origin}/r/${pid}/${rid}/`, target, files: routeFiles(origin, pid, rid), ...rest });

// 牆的預覽：名稱、岩館、公開路線數、縮圖都在 index 的那一行；沒有這面牆回 null
async function wallMeta({ get, origin, pid }) {
  const row = await rowOf(get, pid);
  if (!row) return null;
  const target = row.m3d ? `${origin}/hold/?m3d=${pid}` : `${origin}/hold/?wall=${row.id.split('/')[0]}/${pid}.json`;
  return { ...wallPreview({ name: row.name || '', gym: row.gym || '', n: row.n || 0 }), image: { url: thumbOf(row, pid) }, target };
}

// 路線的預覽：路線節點從 routes.json 讀，牆的名稱、岩館、縮圖在 index；讀不到的欄位省略，不讓預覽失敗
async function routeMeta({ get, origin, pid, rid, layer }) {
  const row = await rowOf(get, pid), node = layer && layer.nodes.find(n => n.id === rid);
  const wall = row ? { name: row.name || '', gym: row.gym || '' } : {};
  return { ...routePreview({ node, wall }), image: { url: row ? thumbOf(row, pid) : `${origin}/icons/cats/hold-cat-512.png` }, ...(row && row.m3d ? { target: `${origin}/hold/?m3d=${pid}&rid=${encodeURIComponent(rid)}` } : {}) };
}

// /p/{id} 的預覽：公開的岩場（climbio/crags 的 crags/{id}/index.json，`at` 是其中一張 Topo）或 3D 牆（index 裡 m3d 的那一行）；都不是回 null
async function homeMeta({ get, origin, id, at }) {
  const base = `${CRAGS}crags/${id}/`, set = await get(`${base}index.json`);
  if (set) {
    const item = ITEM.test(at) && (set.items || []).find(i => i.id === at);
    const view = item && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(item.href || '') ? await get(base + item.href) : null;
    const preview = await fetch(`${base}preview.jpg`, { method: 'HEAD', signal: AbortSignal.timeout(3000) }).then(r => r.ok).catch(() => false);
    return { ...cragPreview({ name: set.name || '', set, view }), target: `${origin}/redpoint/?topo=${encodeURIComponent(`${base}index.json`)}${ITEM.test(at) ? `&at=${at}` : ''}`,
      image: { url: preview ? `${base}preview.jpg` : `${origin}/icons/cats/redpoint-cat-512.png` }, handoff: JSON.stringify(set).length < 300e3 ? { url: `${base}index.json`, doc: set } : null, files: [`${base}index.json`] };
  }
  const row = await rowOf(get, id);
  if (!row || !row.m3d) return null;
  return { ...model3dPreview({ type: 'wall3d', name: row.name || '', gym: row.gym || '' }), target: `${origin}/hold/?m3d=${id}`, image: { url: `${row.base}thumb.jpg` }, handoff: null, files: [] };
}

// hosts：站台網域（site.js 的 HOSTS），第一個是正式站的主要網址；get(url) → JSON 或 null（測試可換）
function createPageHandler({ hosts, get = getJson }) {
  return async (req, res) => {
    const p = parsePath(req.path), host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
    const origin = `https://${hosts.includes(host) ? host : hosts[0]}`;
    const hp = !p && parseHomePath(req.path);
    if (hp) {
      try {
        const at = String(req.query?.at ?? ''), meta = await homeMeta({ get, origin, id: hp.id, at });
        if (meta) return res.set('Cache-Control', REVALIDATE).status(200).send(previewPage({ url: `${origin}/p/${hp.id}${at ? `?at=${encodeURIComponent(at)}` : ''}`, line: true, ...meta }));
      } catch (e) { console.error('專案連結頁失敗', e); }
      return res.set('Cache-Control', 'public, max-age=60, s-maxage=60').status(404).type('text/plain').send('not found');
    }
    const wp = !p && parseWallPath(req.path);
    if (wp) {
      try {
        const meta = await wallMeta({ get, origin, ...wp });
        if (meta) return res.set('Cache-Control', 'public, max-age=300').status(200).send(previewPage({ url: `${origin}/r/${wp.pid}/`, line: true, ...meta }));
      } catch (e) { console.error('牆連結頁失敗', e); }
      return res.redirect(302, `${origin}/`);
    }
    if (!p) return res.redirect(302, `${origin}/`);
    if (p.file) return sendData(res, { get, origin, ...p });
    try {
      const layer = await routeData({ get, origin, ...p }).catch(() => null), meta = await routeMeta({ get, origin, ...p, layer });
      res.set('Cache-Control', 'public, max-age=300');
      return res.status(200).send(page({ origin, ...p, ...meta, ...(layer ? { handoff: { url: routeFiles(origin, p.pid, p.rid)[0], doc: layer } } : {}) }));
    } catch (e) {
      console.error('路線連結頁失敗', e);
      return res.redirect(302, `${origin}/?p=${p.pid}&r=${encodeURIComponent(p.rid)}`);   // 預覽做不出來也照常收線
    }
  };
}

async function sendData(res, { get, origin, pid, rid }) {
  res.set('Access-Control-Allow-Origin', '*');
  try {
    const data = await routeData({ get, origin, pid, rid });
    if (!data) return res.set('Cache-Control', 'no-store').status(404).json({ error: 'not found' });
    return res.set('Cache-Control', DATA_CACHE).json(data);
  } catch (e) {
    console.error('收線資料失敗', e);
    return res.set('Cache-Control', 'no-store').status(500).json({ error: 'unavailable' });
  }
}

module.exports = { parsePath, parseWallPath, parseHomePath, page, previewPage, routeData, createPageHandler };
