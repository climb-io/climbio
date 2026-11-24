// 離線快取：核心在 appkit/sw.js（開 App 網路優先、離線用存好的；帶 ?v= 版本的資源快取優先），這裡只列岩點貓自己的部分：
// - 整個版本一起裝好（install 時一次下載完，存成帶版本的網址，同一版的檔案不會混到別版）：岩館訊號差、沒網路也一樣馬上開，定線不用等
// - 新版本：開 App 就問網路拿最新的頁面，新的 Service Worker 裝好就接手；開著不動的頁面由 js/main.js 的版本檢查提示更新
// - 大檔（偵測模型 holdscan/models、重描模型 holdkit/models、onnxruntime-web 的程式與 wasm，共約 57 MB；3D 牆的模型）用到才下載，另存一個只跟 holdkit 版本走的快取：
//   App 更新不用重新下載（定線的人更新完沒網路也能重描），換 holdkit 版本才清掉。模型網址不帶 ?v=（要穩定，才不會每次部署重下載），onnxruntime 的網址本身帶版本
// English: Service Worker for Hold Cat: shared core in appkit/sw.js; whole version precached under versioned URLs; heavy models in a holdkit-versioned cache.
importScripts('../version.js', '../appkit/i18n.js', '../appkit/sw.js');   // 版本號在網站根目錄的 version.js（頁面也讀同一個檔）；語言包的檔案清單在 AppKit.i18n
const VERSION = self.CLIMBIO_VERSION;
const ROOT = new URL('../', self.location).pathname;   // 網站根目錄：公開資料、共用的程式和圖示在這裡（網站放在子路徑，例如 GitHub Pages 的 /climbio/hold/ 也對）
const MODELS = 'hold-models' + ((VERSION.match(/-hk[^-]+$/) || [''])[0]);   // 部署的版本號結尾是 holdkit 版本（-hk1.2.0）
const SHELL = ['../appkit/backup.mjs', '../appkit/backup-ui.mjs', './', '../css/desktop.css', '../css/brand-tokens.css', '../appkit/ui.css', '../appkit/components.css', '../appkit/update.js', '../appkit/idb.js', '../appkit/backstack.js', '../appkit/nearby.js', '../appkit/qr/qrcode.js', '../appkit/qr/jsQR.js', '../appkit/recover.js', '../css/app.css', '../js/rename.js', '../appkit/i18n.js', '../appkit/install.js', '../appkit/photo.js', '../appkit/files.js', '../appkit/store.js', '../appkit/gesture.js', '../appkit/timing.js', '../appkit/ui.js', '../appkit/account.js', '../appkit/share.js', '../appkit/share-image.js', '../js/boot.js', '../js/mascot-motion.js', '../js/holdcat.js', '../js/app.js', '../js/home.js', '../js/profile.js', '../js/add-wall.js', '../js/edit.js', '../js/wall.js', '../js/sync.js', '../js/draw.js', '../js/export.js', '../js/mobile.js', '../js/wall3d.js', '../gyms/index.json', '../js/main.js', '../holdkit/holdkit.js', '../routekit/geometry.js', '../routekit/labels.js', '../routekit/base.js', '../routekit/scene.js', '../routekit/image.js', '../routekit/editor.js', '../routekit/fit.js', '../routekit/viewport.js', '../routekit/viewer.js', '../routekit/ui.js', '../routekit/format.js', '../format/format.js', '../holdkit/samrefine.js', '../holdkit/samworker.js', '../holdkit/ort.js', 'manifest.webmanifest', 'manifest-dev.webmanifest', '../icons/cats/hold-cat-192.png', '../icons/cats/hold-cat-180.png', '../icons/cats/hold-cat-512.png', '../icons/cats/hold-cat-maskable-192.png', '../icons/cats/hold-cat-maskable-512.png', '../icons/cats/hold-cat.svg', '../fonts/barlow-condensed-700i.woff2', '../fonts/mplus1-900-dan.woff2', '../site.js', '../host-redirect.js', '../appkit/share-tools.js', '../backend/firebase.js', '../holdscan/browser/holdscan.js', '../holdscan/browser/worker.js', '../holdscan/core/detect-core.js', '../version.js',
  ...self.AppKit.i18n.cacheList('hold')];   // 語言包（共用名詞＋岩點貓）都快取：頁面只載入目前語言，離線時也能切換

const isHeavy = (url) =>
  url.pathname.endsWith('.onnx') ||
  /\/(p|walls3d\/resolve\/main\/walls3d)\/[0-9a-z]{16}\/(model|wall|faces|labels|overlay|snapshot|walk)-[0-9a-f]{12}\./.test(url.pathname) ||   // 3D 牆資料包裡檔名帶雜湊的檔（模型、標籤、快照、鏡頭）：存了就直接用，不用再問網路
  (url.hostname === 'cdn.jsdelivr.net' && url.pathname.startsWith('/npm/onnxruntime-web@'));

AppKit.sw({
  cache: 'hold-' + VERSION, prefix: 'hold-', keep: [MODELS], home: './', shell: SHELL, version: VERSION,
  // 登入（/__/）、路線連結頁（/r/）、會變的公開牆面清單（climbio.json、/w/、總目錄 /dir/）直接問網路：存進版本快取的話，要等下一次部署才會更新；它們由伺服器的 Cache-Control 控制快取多久
  bypass: (url) => ['r/', 'w/', 'dir/', 'climbio.json'].some(p => url.pathname.startsWith(ROOT + p)),
  // 3D 牆的資料包（wall.json，約 2 MB）一律等網路，離線才用存的：慢過 timeout 就用舊的，舊的指向已經換掉的模型、面標籤，打不開
  handle: (url, req) => /\/(p|walls3d\/resolve\/main\/walls3d)\/[0-9a-z]{16}\/wall\.json$/.test(url.pathname) ? caches.open(MODELS).then(c => AppKit.swFetch(req).then(res => {
    if (res.ok) c.put(req, res.clone());
    return res;
  }, async (e) => (await c.match(req)) || Promise.reject(e))) : !isHeavy(url) ? null : caches.open(MODELS).then(async c => {
    const hit = await c.match(req);
    if (hit) return hit;
    const res = await AppKit.swFetch(req);
    if (res.ok || res.type === 'opaque') c.put(req, res.clone());
    return res;
  }),
});
