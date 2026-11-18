// 站台網域：路線連結、公開牆面資料產生網址用，也是雲端函式允許的來源。自架改這裡（見 docs/deploy.md）；
// 第一個是正式站的主要網址（列進總目錄，不認得的網域一律導回它），其他是共用同一份資料的站（正式站的其他網域、開發版）
const HOSTS = ['climbio.app', 'climbio.web.app', 'climbio-dev.web.app', 'climbio-eric.web.app'];
const ORIGINS = [...HOSTS.map(h => `https://${h}`), 'http://localhost:8765', 'http://127.0.0.1:8765', 'http://localhost:8766', 'http://127.0.0.1:8766'];
// Hosting 預覽頻道（{站名}--{頻道}.web.app，測試用）
const PREVIEW = HOSTS.filter(h => h.endsWith('.web.app')).map(h => h.slice(0, -'.web.app'.length));
const isPreview = (origin) => PREVIEW.some(site => new RegExp(`^https://${site}--[a-z0-9-]+\\.web\\.app$`).test(origin || ''));
module.exports = { HOSTS, ORIGINS, isPreview };
