// 網站首頁收到 App 的連結（路線連結 /r/… 轉來的 ?p=照片編號&r=路線 id）：在畫面出來前轉進對應的 App，帶著原本的參數。
// 依內容選 App 的地方：室內路線給岩點貓（/hold/），戶外的 Topo（?topo=<v2 檔案的網址>）給紅點貓（/redpoint/）。
(function () {
  var q = new URLSearchParams(location.search);
  var app = q.has('topo') ? 'redpoint/' : q.has('p') ? 'hold/' : '';
  if (app) location.replace(app + location.search + location.hash);
})();
