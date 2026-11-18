// App 版本：部署到 Firebase Hosting 時自動寫入（1000＋部署次數），平常不用改。
// （這裡的數字只有本機測試和手動部署時有用）頁面和 Service Worker 都讀這個檔，
// 頁面用它判斷等待中的新 Service Worker 是不是跟自己同一版（同一版就直接換，不用提示更新）。
// Service Worker 用 importScripts 載入，這個檔有變動就會被視為新版本。
self.CLIMBIO_VERSION = 'climbio-v151';
