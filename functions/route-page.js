// 路線連結 /r/{照片編號}/{路線 id}/（Hosting 轉給雲端函式 routePage）：給 LINE、FB 等的爬蟲一頁帶這條路線預覽圖、標題的 HTML，
// 人打開就轉進 App 收這條線（/?p=照片編號&r=路線 id）。只用 JavaScript 轉：Facebook 的爬蟲會跟著 meta refresh 走到 App 首頁、拿不到這條路線的預覽圖。
// 預覽頁：標題是路線名稱與難度，說明是岩館、牆、岩點數、定線者（share-preview.js），圖是牆的縮圖；3D 牆的線打開後進 3D 牆。
// 同一個網址後面接 route.json 是給任何 App 收線的公開資料（不用登入、允許跨網域）：這條路線疊在牆上的圖層（Climbio 公開格式 v2），
// 圖層的 href 指到開放資料集裡牆的畫面（見 site-data.js）。
// 站的公開牆面（/climbio.json、/w/**）也由這個函式回，見 site-data.js。
const { parseDataPath, sendSiteData, routesData } = require('./site-data');
const { HF_BASE, hfBase } = require('./projects');
const { routePreview, wallPreview } = require('./share-preview');
const PID = /^[0-9a-z]{8,40}$/, RID = /^[0-9a-z]{1,40}$/;
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// { pid, rid, file: ''（預覽頁）| 'route.json' }
function parsePath(path) {
  const m = /^\/r\/([^/]+)\/([^/]+)(?:\/(route\.json)?)?$/.exec(path || '');
  return m && PID.test(m[1]) && RID.test(m[2]) ? { pid: m[1], rid: m[2], file: m[3] || '' } : null;
}
// 牆的連結 /r/{照片編號}/（沒有路線 id）：一面公開牆的預覽頁，人打開就轉進 App 收這面牆
const parseWallPath = (path) => { const m = /^\/r\/([^/]+)\/?$/.exec(path || ''); return m && PID.test(m[1]) ? { pid: m[1] } : null; };
const DATA_CACHE = 'public, max-age=86400';
// 收線的資料：這條路線的圖層
const routeData = ({ db, origin, pid, rid }) => routesData({ db, origin, pid, rid });
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

// 牆的預覽：名稱、岩館、公開路線數、縮圖都在 gymWalls；沒有這面牆回 null
async function wallMeta({ db, origin, pid }) {
  const g = await db.collection('gymWalls').doc(pid).get();
  if (!g.exists) return null;
  const m3d = !!g.get('m3d'), src = g.get('src') || {};
  const target = m3d ? `${origin}/hold/?m3d=${pid}` : `${origin}/hold/?wall=${src.project}/${src.path}`;
  const thumb = m3d ? `${hfBase({ repo: g.get('repo') })}${g.get('hf')}thumb.jpg` : `${HF_BASE}${g.get('hf')}${pid}.thumb.jpg`;
  return { ...wallPreview({ name: g.get('name') || '', gym: g.get('gym') || '', n: g.get('n') || 0 }), image: { url: thumb }, target };
}

// 路線的預覽：路線節點在 wallRoutes，牆的名稱、岩館、縮圖在 gymWalls；讀不到的欄位省略，不讓預覽失敗
async function routeMeta({ db, origin, pid, rid }) {
  const [w, g] = await Promise.all([db.collection('wallRoutes').doc(pid).get(), db.collection('gymWalls').doc(pid).get()]);
  const x = w.exists && (w.get('routes') || {})[rid];
  let node = null;
  if (x) try { node = (JSON.parse(x.r).nodes || []).find(n => n.id === rid) || null; } catch (e) { /* 讀不出來用預設內容 */ }
  const m3d = g.exists && !!g.get('m3d'), wall = g.exists ? { name: g.get('name') || '', gym: g.get('gym') || '' } : {};
  const thumb = g.exists ? (m3d ? `${hfBase({ repo: g.get('repo') })}${g.get('hf')}thumb.jpg` : `${HF_BASE}${g.get('hf')}${pid}.thumb.jpg`) : `${origin}/icons/cats/hold-cat-512.png`;
  return { ...routePreview({ node, wall }), image: { url: thumb }, ...(m3d ? { target: `${origin}/hold/?m3d=${pid}&rid=${encodeURIComponent(rid)}` } : {}) };
}

// hosts：站台網域（site.js 的 HOSTS），第一個是正式站的主要網址（只有它的 climbio.json 列進總目錄）
function createPageHandler({ db, hosts }) {
  return async (req, res) => {
    const p = parsePath(req.path), host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
    const origin = `https://${hosts.includes(host) ? host : hosts[0]}`;
    const data = parseDataPath(req.path);
    // 各站共用資料：只有正式站的主要網址列進總目錄，免得同一面牆出現兩次
    if (data) return sendSiteData(res, { db, origin, listed: host === hosts[0], p: data });
    const wp = !p && parseWallPath(req.path);
    if (wp) {
      try {
        const meta = await wallMeta({ db, origin, ...wp });
        if (meta) return res.set('Cache-Control', 'public, max-age=300').status(200).send(previewPage({ url: `${origin}/r/${wp.pid}/`, line: true, ...meta }));
      } catch (e) { console.error('牆連結頁失敗', e); }
      return res.redirect(302, `${origin}/`);
    }
    if (!p) return res.redirect(302, `${origin}/`);
    if (p.file) return sendData(res, { db, origin, ...p });
    try {
      const [meta, layer] = await Promise.all([routeMeta({ db, origin, ...p }), routeData({ db, origin, ...p }).catch(() => null)]);
      res.set('Cache-Control', 'public, max-age=300');
      return res.status(200).send(page({ origin, ...p, ...meta, ...(layer ? { handoff: { url: routeFiles(origin, p.pid, p.rid)[0], doc: layer } } : {}) }));
    } catch (e) {
      console.error('路線連結頁失敗', e);
      return res.redirect(302, `${origin}/?p=${p.pid}&r=${encodeURIComponent(p.rid)}`);   // 預覽做不出來也照常收線
    }
  };
}

async function sendData(res, { db, origin, pid, rid }) {
  res.set('Access-Control-Allow-Origin', '*');
  try {
    const data = await routeData({ db, origin, pid, rid });
    if (!data) return res.set('Cache-Control', 'no-store').status(404).json({ error: 'not found' });
    return res.set('Cache-Control', DATA_CACHE).json(data);
  } catch (e) {
    console.error('收線資料失敗', e);
    return res.set('Cache-Control', 'no-store').status(500).json({ error: 'unavailable' });
  }
}

module.exports = { parsePath, parseWallPath, page, previewPage, routeData, createPageHandler };
