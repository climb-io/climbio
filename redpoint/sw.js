// 紅點貓的 Service Worker（範圍 /redpoint/）：離線優先，核心是共用的 appkit/sw.js（waiting 模式）。岩場的訊號常常很差，所有功能都要在沒網路時能用：
// - 整版一起裝好（install 時一次下載完，一個檔案都不能少，同一版的檔案不會混到別版），之後一律先用快取：打開 App、看岩場都不等網路
// - 新版本：版本號（version.js）變了才有新的 Service Worker，裝好等著；頁面（AppKit.update）顯示「更新」，使用者按了才接手並重新載入。開機失敗時 `appkit/recover.js` 的看門狗也可以送 `SKIP_WAITING`，或清掉 `redpoint-cat` 快取後重載
// - 別的網域（收來的 Topo、照片）不經過這裡，照片另外存在 IndexedDB
// English: offline-first service worker on the shared AppKit.sw core: whole version precached, cache-first, new version waits for the user's Update tap. On boot failure, recover.js may send SKIP_WAITING or clear the redpoint-cat caches and reload.
importScripts('../version.js', '../appkit/i18n.js', '../appkit/sw.js');   // 語言包的檔案清單在 AppKit.i18n
const VERSION = self.CLIMBIO_VERSION, CACHE = `redpoint-cat-${VERSION}`;
const ROOT = new URL('../', self.location).pathname;

const SHELL = ['../appkit/collection-backup.mjs', '../appkit/backup.mjs', '../appkit/backup-ui.mjs', './', 'app.js', 'extension.js', 'source-credit.mjs', 'sources.html', 'sources-boot.js', 'sources.js', 'boot.js', 'openclimbing.js', '../sourcekit/openclimbing-read.js', '../sourcekit/photo-size.js', '../sourcekit/ids.js', '../sourcekit/preview-layout.js', '../sourcekit/preview-sheet.js', 'openclimbing-group.mjs', 'thecrag-links.mjs', 'auto-merge.mjs', 'world-stacks.mjs', 'world-data.mjs', '../appkit/crags.mjs', 'db.js', 'io.js', 'manifest.webmanifest', 'manifest-dev.webmanifest', 'taiwan.json', '../studio/dataset-publish.js', '../studio/service.js', '../js/rename.js', '../site.js', '../host-redirect.js', '../version.js', '../format/format.js', '../appkit/share-tools.js', '../backend/firebase.js',
  '../css/desktop.css', '../css/brand-tokens.css', '../fonts/barlow-condensed-700i.woff2', '../appkit/ui.css', '../appkit/components.css', '../appkit/update.js', '../appkit/idb.js', '../appkit/store.js', '../appkit/gesture.js', '../appkit/backstack.js', '../appkit/nearby.js', '../appkit/qr/qrcode.js', '../appkit/qr/jsQR.js', '../appkit/recover.js', '../appkit/i18n.js', '../appkit/install.js', '../appkit/photo.js', '../appkit/files.js', '../appkit/ui.js', '../appkit/account.js', '../appkit/share.js', '../appkit/share-image.js',
  ...['element', 'editor', 'view', 'viewport', 'data', 'lines', 'render', 'style', 'annotate'].map(f => `../topokit/${f}.js`),
  ...['index', 'player', 'read', 'sight', 'text', 'style'].map(f => `../crag3dkit/${f}.js`), '../crag3dkit/vendor/three-splat.js',
  ...['element', 'editor', 'view', 'viewport', 'data', 'render', 'style', 'labels', 'tiles'].map(f => `../mapkit/${f}.js`),
  '../icons/cats/redpoint-cat-192.png', '../icons/cats/redpoint-cat-180.png', '../icons/cats/redpoint-cat-maskable-192.png', '../icons/cats/redpoint-cat-maskable-512.png', '../icons/cats/redpoint-cat.svg', '../icons/cats/redpoint-cat-wordmark.svg',
  ...self.AppKit.i18n.cacheList('redpoint')];   // 語言包（共用名詞＋紅點貓）全部語言都快取：頁面只載入目前語言，離線時也能切換

const SCOPE = SHELL.map(f => new URL(f, self.location).pathname);
// OpenClimbing 的資料在開放資料集（跨網域，同 redpoint/openclimbing.js 的 OC_DATA）：先用存好的、背景更新，離線也看得到；存在不隨版本清掉的 DATA 快取
const OC_DATA = 'https://huggingface.co/datasets/climbio/crags/resolve/main/openclimbing/', DATA = 'redpoint-cat-data';
const mine = (url) => url.origin === self.location.origin && !url.pathname.startsWith('/__/') && (url.pathname.startsWith(ROOT + 'redpoint/') || SCOPE.includes(url.pathname));

AppKit.sw({
  cache: CACHE, prefix: 'redpoint-cat', keep: [DATA], shell: SHELL, waiting: true,
  bypass: (url) => !mine(url),
  // 一律先用存好的（?topo= 的連結也開同一個頁面；頁面和程式同一版，不會混）；沒存的才問網路，拿到就補存進這一版
  handle: (url, req) => {
    if (url.href.startsWith(OC_DATA)) {
      return caches.open(DATA).then(async (c) => {
        const hit = await c.match(url.href), fresh = fetch(req).then((res) => { if (res.ok) c.put(url.href, res.clone()); return res; });
        if (!hit) return fresh;
        fresh.catch(() => {});
        return hit;
      });
    }
    if (!mine(url)) return null;
    return caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && !url.search) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }));
  },
});
