// 網站根目錄的 Service Worker：岩點貓搬到 /hold/ 之前裝在根目錄（範圍是整個網站）的 Service Worker 會一直用快取裡的舊 App 蓋住首頁。
// 瀏覽器檢查更新時拿到這個檔：裝好就接手、註銷自己、重新載入它控制的頁面，之後首頁和各 App 都直接走網路或各自的 Service Worker。
// 舊的版本快取（climbio-v…）留給 /hold/ 的 Service Worker 啟用時清。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(self.registration.unregister()
    .then(() => self.clients.matchAll({ type: 'window' }))
    .then(clients => Promise.all(clients.map(c => c.navigate(c.url).catch(() => {})))));
});
