// 開頁就要決定的事（在頁面最後、defer 的主程式之前同步載入；畫面由 hold/index.html 的啟動畫面蓋著，主程式畫好首頁才拿掉）：版面的 class、測試版的名稱與 manifest、語言包。
// 不寫在 index.html 裡：內容安全政策（CSP）不允許內嵌的程式。
// English: Runs synchronously before the deferred app scripts, behind the boot splash: layout classes, dev-site name, language pack. Not inline because the CSP forbids inline scripts.
  // iPhone、iPad 從主畫面打開：系統在狀態列下方疊一段模糊，頂端的按鈕要往下移（css 的 html.ios-app）
  if (navigator.standalone === true || (matchMedia('(display-mode: standalone)').matches && /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)) document.documentElement.classList.add('ios-app');
  // 手機、平板和電腦都直接使用 App；?pc 只供預覽電腦介紹頁。
  (function () { try {
    var app = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    if (!app && /[?&]pc\b/.test(location.search)) document.documentElement.classList.add('lite-boot', 'pcland');
    // 第一次打開（沒登入、這台沒有牆：climbio.hasWalls，js/home.js 記的）：一開始就是開場畫面，不先畫首頁（js/mobile.js 的 welcomeBoot 接手）
    else if (localStorage.getItem('climbio.hasWalls') !== 'true' && !/[?&](p|wall)=/.test(location.search)) document.documentElement.classList.add('welcome-boot');
  } catch (e) { /* 判斷不了就照一般的 App */ } })();
  if (['climbio-dev.web.app', 'climbio-dev.firebaseapp.com', 'climbio-eric.web.app', 'localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    document.documentElement.classList.add('env-dev');
    document.title = '岩點貓 Beta';
    document.querySelector('meta[name="apple-mobile-web-app-title"]').content = '岩點貓 Beta';
    document.querySelector('link[rel="manifest"]').href = 'manifest-dev.webmanifest';
  }
  // 語言包：只載入目前語言（i18n/common、i18n/hold 的 <語言>.js，見 appkit/i18n.js），在主程式之前執行完
  AppKit.i18n.boot({ app: 'hold', key: 'climbio.lang' });
