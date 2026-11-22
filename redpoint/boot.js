// 紅點貓的語言包：只載入目前語言（i18n/common、i18n/redpoint 的 <語言>.js，見 appkit/i18n.js），在主程式之前執行完
AppKit.i18n.boot({ app: 'redpoint' });
// 開發版、本機：標示測試版（跟岩點貓一樣）：logo 旁的標籤、分頁標題、加到主畫面的名稱
const dev = ['climbio-dev.web.app', 'climbio-dev.firebaseapp.com', 'climbio-eric.web.app', 'localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
if (dev) {
  document.documentElement.classList.add('env-dev');
  document.querySelector('link[rel="manifest"]')?.setAttribute('href', 'manifest-dev.webmanifest');
}
// 分頁標題、加到主畫面的名稱、頁面說明跟目前語言（換語言時 App 再呼叫一次）；og 標籤給爬蟲，維持中文
globalThis.applyPageMeta = () => {
  const name = AppKit.i18n.t('app') + (dev ? ' DEV' : '');
  document.title = name;
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', name);
  document.querySelector('meta[name="description"]')?.setAttribute('content', AppKit.i18n.t('pageDesc'));
};
// 語言包是 document.write 進來的，這支跑完才執行；第一次由 app.js 開頭呼叫
