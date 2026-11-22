// 文件頁（使用說明、專案介紹、紅點收集）依系統語言自動導向對應語言的靜態頁面；沒有語言選單。
// 只掛在繁體中文的根路徑頁面；其他語言頁面（/en/、/ja/ …）是各自的固定網址，不再轉。外部檔案，讓網站的 CSP 允許執行。
(function () {
  var supported = ['zh', 'zh-CN', 'en', 'ja', 'fr', 'ko', 'es', 'de'];
  var route = { 'zh': '', 'zh-CN': 'zh-cn/', 'en': 'en/', 'ja': 'ja/', 'fr': 'fr/', 'ko': 'ko/', 'es': 'es/', 'de': 'de/' };
  var preferred = (navigator.languages && navigator.languages[0]) || navigator.language || '';
  var pick = /^zh[-_](?:hans|cn|sg)(?:$|[-_])/i.test(preferred) ? 'zh-CN'
    : /^zh/i.test(preferred) ? 'zh'
    : supported.find(function (x) { return x !== 'zh' && x !== 'zh-CN' && preferred.toLowerCase().startsWith(x); }) || 'en';
  if (!route[pick]) return;
  location.replace('/' + route[pick] + location.pathname.replace(/^\//, '') + location.search + location.hash);
})();
