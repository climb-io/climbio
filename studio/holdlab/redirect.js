// 舊網址 /studio/holdlab/ 轉到 /studio/wall/，保留 ?query 和 #專案 id（CSP 不允許內嵌程式，所以放在檔案裡）
location.replace('../wall/' + location.search + location.hash);
