// Climbio Studio 的 Service Worker（範圍 /studio/：首頁、wall/、crag/）：核心在 appkit/sw.js，先問網路（慢過 3 秒或沒網路才用存的），拿到就存一份；裝成 App 後離線也打得開。
// 模型（.onnx）、別的網域、公開資料（/r/、/w/、/p/、/dir/、climbio.json）、登入（/__/）不經過這裡。
importScripts('../appkit/sw.js');
const ROOT = new URL('../', self.location).pathname;
AppKit.sw({   // 同一個網站的快取是共用的：只動自己開頭的
  cache: 'climbio-studio-v2',
  bypass: (url) => url.pathname.endsWith('.onnx') || ['r/', 'w/', 'g/', 'dir/', 'climbio.json', 'album', 'studio/webgpu/'].some(p => url.pathname.startsWith(ROOT + p)),
});
