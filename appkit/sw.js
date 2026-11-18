// AppKit Service Worker 核心（岩點貓、Studio Crag 共用）：開 App 一律先問網路，離線才用存好的。
// - 開 App（導覽請求）：網路優先；網路慢過 timeout（預設 3 秒）或沒網路就用存好的頁面，所以部署新版後第一次打開就是新版，離線也馬上開得起來
// - 資源網址帶版本（?v=<版本>，部署時由 tools/stamp-assets.mjs 寫進頁面）：快取優先，網址本身就分了版，頁面和資源永遠同一版、不會混到別版
// - 其他資源（沒帶版本）：網路優先，拿到就存一份，離線用存的（本機開發、沒經過部署的頁面也都是這一條，永遠是最新的）
// - 有 shell（岩點貓）：install 時把整版檔案以「帶版本的網址」存好（一個都不能少，下載不完整就裝不起來、舊版繼續用）；沒有 shell 的 App 邊用邊存
// - 新的 Service Worker 裝好就接手（不用等使用者按更新）；啟用時清掉別版的快取
// English: shared service worker core: network-first navigations with a timeout, cache-first for ?v=-versioned URLs, network-first for the rest.
(function (g) {
  'use strict';
  /**
   * cache：這一版的快取名；prefix：這個 App 的快取名開頭（啟用時只清自己開頭、又不是 cache 與 keep 的）；keep：不清的快取名
   * home：App 首頁的網址（相對 Service Worker），開 App 的導覽請求（含 ?s= 這類查詢）一律對應它
   * shell：要預先快取的檔案（相對 Service Worker）；version：有 shell 時的版本號，網址後綴 ?v= 用它（去掉 climbio- 開頭）
   * waiting：true＝新版等使用者按更新才接手（離線優先的 App 用，整版快取、不混版）；bypass(url)：不經過這裡的網址；handle(url, req)：自己處理的請求（回傳 Response 的 Promise），不處理回 null
   */
  g.AppKit = g.AppKit || {};
  // 同源的 /p/<id>/…（Hosting 轉址到開放資料集）：iOS Safari 帶憑證抓會 Load failed（無憑證正常）；資料都是公開的，這類請求一律不帶憑證
  g.AppKit.swFetch = (req) => {
    const u = new URL(req.url);
    return u.origin === self.location.origin && /^\/p\/[0-9a-z]{16}\//.test(u.pathname) ? fetch(new Request(req, { credentials: 'omit' })) : fetch(req);
  };
  g.AppKit.sw = function ({ cache, prefix = cache, keep = [], home = '', shell = [], version = '', bypass = () => false, handle = () => null, timeout = 3000, waiting = false }) {
    const here = self.location, q = version ? '?v=' + version.replace(/^climbio-/, '') : '';
    const homeUrl = home ? new URL(home, here).href : '';
    const homeDir = homeUrl && new URL('.', homeUrl).pathname;
    const keyed = (u) => u.origin + u.pathname + q;   // 預先快取的網址：檔案路徑＋版本後綴
    const timer = (ms) => new Promise((_, no) => setTimeout(() => no(new Error('slow')), ms));

    // waiting：新版裝好後等著，頁面（AppKit.update）顯示「更新」、使用者按了才傳 SKIP_WAITING 接手；沒設定就裝好馬上接手
    self.addEventListener('install', (e) => {
      if (!waiting) self.skipWaiting();
      if (!shell.length) return;
      e.waitUntil(caches.open(cache).then(c => Promise.all(shell.map(f => {
        const u = new URL(f, here), key = u.href === homeUrl ? u.href : keyed(u);
        return fetch(new Request(u, { cache: 'no-cache' })).then(res => { if (!res.ok) throw new Error(f); return c.put(key, res); });
      }))));
    });

    self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

    self.addEventListener('activate', (e) => {
      e.waitUntil(caches.keys()
        .then(keys => Promise.all(keys.filter(k => k.startsWith(prefix) && k !== cache && !keep.includes(k)).map(k => caches.delete(k))))
        .then(() => self.clients.claim()));
    });

    // 先問網路；慢過 timeout 或失敗就用存好的（等到網路回來照樣存起來，下次用）
    const networkFirst = (e, req, lookup, store) => {
      const fresh = g.AppKit.swFetch(req).then(res => {
        if (res.ok && store) { const copy = res.clone(); caches.open(cache).then(c => c.put(store, copy)); }
        return res;
      });
      e.waitUntil(fresh.catch(() => {}));
      const hit = lookup();
      return Promise.race([fresh, timer(timeout)]).catch(async () => (await hit) || fresh);
    };

    self.addEventListener('fetch', (e) => {
      const req = e.request;
      if (req.method !== 'GET') return;
      const url = new URL(req.url), own = handle(url, req);
      if (own) return e.respondWith(own);
      // 檢查版本（?check）、登入（/__/）、公開資料等由網路與伺服器的 Cache-Control 管的，不經過這裡
      if (url.origin !== here.origin || url.searchParams.has('check') || url.pathname.startsWith('/__/') || bypass(url)) return;
      if (homeUrl && req.mode === 'navigate' && (url.pathname === homeDir || url.pathname === homeDir + 'index.html')) {
        return e.respondWith(networkFirst(e, req, () => caches.match(homeUrl), homeUrl));
      }
      if (q && url.searchParams.has('v')) {   // 帶版本的網址：存好的就是這一版
        return e.respondWith(caches.match(req).then(hit => hit || g.AppKit.swFetch(req).then(res => {
          if (res.ok) { const copy = res.clone(); caches.open(cache).then(c => c.put(req, copy)); }
          return res;
        })));
      }
      const store = url.search ? null : req;
      e.respondWith(networkFirst(e, req, () => caches.match(req).then(hit => hit || (q && caches.match(keyed(url))) || caches.match(req, { ignoreSearch: true })), store));
    });
  };
})(self);
