// 站台設定：自己架站時只改這個檔。
// 主網（climbio.app、climbio.web.app、開發版）接主網的後端與雲端加速；其他網域（自己架的站、本機預覽）自動不接，放上任何靜態網站空間就能用。
// 本機要接主網的後端（瀏覽器測試）：localStorage 的 climbio.site.main 設成 '1'
// English: Site config: which backend to use and cloud acceleration. Self-hosted sites usually need no change.
const MAIN = ['climbio.app', 'climbio.web.app', 'climbio-dev.web.app', 'climbio-dev.firebaseapp.com', 'climbio-eric.web.app'].includes(location.hostname)
  || (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) && (() => { try { return localStorage.getItem('climbio.site.main') === '1'; } catch { return false; } })());
window.SITE = {
  // 這個 App 的網址（示範牆的分享連結、路線圖上的網址）：主網固定是正式版；自己架的站是 App 資料夾（/hold/）的上一層（含子路徑，例如 GitHub Pages 的 /climbio）
  url: MAIN ? 'https://climbio.app' : new URL('../', location.href).href.replace(/\/$/, ''),
  // 分享、岩館牆面、統計用哪個後端：'firebase'＝主網（backend/firebase.js）；'none'＝不接後端，資料只存在手機，收線照樣可以
  backend: MAIN ? 'firebase' : 'none',
  // 找牆面：directory＝總目錄（各站的公開牆面合起來，見 docs/route-format.md）；listed＝這個站要不要登記進總目錄（站要有公開牆面檔）
  directory: 'https://climbio.app',
  listed: MAIN,
  // 選配的雲端加速，網址空的就不用：retrace＝整面牆重描（holdkit）、nearby＝附近交換（找同一個網路的人，空的就沒有附近交換）。後端有 idToken 就帶著登入權杖
  cloud: MAIN ? {
    retrace: 'https://asia-east1-firebase-climbio.cloudfunctions.net/retrace',
    nearby: 'https://asia-east1-firebase-climbio.cloudfunctions.net/nearby',
  } : {},
};
// 後端介面：backend/<名稱>.js 啟用時換掉這個空的後端。caps 列出這個後端有的功能（share、gyms、account、stats、topos＝紅點貓的分享連結），沒有的功能 App 不顯示
window.Backend = { name: 'none', caps: {} };
