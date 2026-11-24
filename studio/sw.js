// Climbio Studio 的 Service Worker（範圍 /studio/：首頁和各工作頁）：核心在 appkit/sw.js。頁面先問網路（慢過 3 秒或沒網路才用存的）；
// 部署時頁面裡的程式、樣式網址帶版本（tools/stamp-assets.mjs），這一版的檔案（含它們 import 的模組）存了就直接用，一進去不用每個檔都等網路；
// 版本號在網站根目錄的 version.js，換版時這個 Service Worker 跟著更新、清掉舊版的快取。裝成 App 後離線也打得開。
// 模型（.onnx）、別的網域、公開資料（/r/、/w/、/p/、/dir/、climbio.json）、登入（/__/）不經過這裡。
//
// 在 Studio 裡換頁（從 Studio 的頁面點到另一頁）像同一個 App：不等網路，直接用這一版存好的頁面——跟正在用的是同一版，程式、樣式也都已存好。
//   從外面打開（書籤、網址列、裝好的 App）照樣先問網路，部署新版後第一次打開就是新版；新版的 Service Worker 接手時清掉舊版快取，之後換頁也是新版。
//   這一版裝好後在背景把各頁和它們帶版本的程式、樣式先存起來（沒去過的頁第一次點也不用等網路）；省流量模式不做。本機開發（頁面沒帶版本）不走這條。
importScripts('../version.js', '../appkit/sw.js');
const ROOT = new URL('../', self.location).pathname, HERE = new URL('./', self.location).href;
const CACHE = 'climbio-studio-' + self.CLIMBIO_VERSION;
const PAGES = ['', 'wall/', 'crag/', 'scene/', 'wall3d/'].map(p => HERE + p);
const STAMPED = !/^(localhost|127.0.0.1|[::1])$/.test(self.location.hostname);
const bypass = (url) => url.pathname.endsWith('.onnx') || ['r/', 'w/', 'g/', 'dir/', 'climbio.json', 'studio/webgpu/'].some(p => url.pathname.startsWith(ROOT + p));
const inApp = (req) => { try { return !!req.referrer && req.referrer.startsWith(HERE); } catch { return false; } };
const page = (url) => url.origin + url.pathname.replace(/index.html$/, '');

AppKit.sw({   // 同一個網站的快取是共用的：只動自己開頭的
  cache: CACHE, prefix: 'climbio-studio-', version: self.CLIMBIO_VERSION, bypass,
  handle: (url, req, e) => {
    if (req.mode === 'navigate') warmOnce(e);
    if (!STAMPED || req.mode !== 'navigate' || url.search || bypass(url) || !inApp(req)) return null;
    return caches.open(CACHE).then(c => c.match(page(url))).then(hit => hit || fetchPage(page(url), req));
  },
});

/** 從網路拿頁面，存成這一版的（轉址的不存：導覽不能用轉址過的回應） */
async function fetchPage(key, req) {
  const res = await fetch(req);
  if (res.ok && !res.redirected && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
  return res;
}

// 各頁和它們帶版本的程式、樣式先存起來：這個 Service Worker 第一次處理導覽時，在背景（頁面先載完）做一次。
// 不放在 activate 的 waitUntil：啟用完成前所有請求都會卡住（實測第一次打開等了 13 秒）
let warming = null;
function warmOnce(e) {
  if (warming || !STAMPED || self.navigator?.connection?.saveData) return;
  warming = new Promise(ok => setTimeout(ok, 4000)).then(warm).catch(() => {});
  e.waitUntil(warming);
}
async function warm() {
  const c = await caches.open(CACHE), seen = new Set();
  for (const p of PAGES) {
    let html = '';
    try {
      const hit = await c.match(p);
      if (hit) html = await hit.text();
      else { const res = await fetch(p, { cache: 'no-cache' }); if (!res.ok || res.redirected) continue; html = await res.clone().text(); await c.put(p, res); }
    } catch { continue; }
    for (const m of html.matchAll(/(?:src|href)="([^"]+?v=[^"]+)"/g)) {
      const u = new URL(m[1], p).href;
      if (seen.has(u)) continue;
      seen.add(u);
      if (await c.match(u)) continue;
      try { const res = await fetch(u); if (res.ok) await c.put(u, res); } catch { /* 下次用到再抓 */ }
    }
  }
}
