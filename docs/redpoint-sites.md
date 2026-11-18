# 串接岩場網站：讓你整理的資料被帶到現場

> 紅點貓資料藍圖的網站經營者入口。產品故事、三種資料流與視覺規範見 [紅點貓資料藍圖](redpoint-data-blueprint.md)。

現有網站不需要為了紅點貓重做資料庫。原站格式由紅點貓建立對應讀取器；只有主動選擇輸出 Climbio 公開格式時，網站才需要產生符合 v2 的入口檔案。技術可讀與允許再公開是兩件事。

公開頁面是 `redpoint-sites/index.html`（https://climbio.app/redpoint-sites/），給 AI 看的獨立說明是 `redpoint-sites/for-ai.txt`；這份是同樣內容的文件版，改規則時三份一起改。

**資料怎麼轉成紅點貓的格式，是紅點貓的工作**。網站不用改版、不用轉格式，只要資料公開讀得到，再把資料網址和結構告訴我們，紅點貓加上對應的讀取器。

## 網站最少要提供的

1. **讀得到**：https、不用登入，回 `Access-Control-Allow-Origin: *`（資料與照片都要）。格式不限：JSON、GeoJSON、API 回應都可以。
2. **有什麼給什麼**：岩場、岩壁、路線的名稱與難度，照片網址；有 Topo 線的話說明座標怎麼算（照片像素或比例、原點）。沒有的欄位不用補。
3. **署名與授權**：照片與資料的作者、授權條件；沒寫清楚的內容當成不能再分享。

再附上資料網址和一段範例回應，就夠紅點貓寫讀取器。

## 已經是 Climbio 公開格式的站

不用等讀取器，也不用更新任何工具：頁面放 `<link rel="climbio" type="application/json" href="/climbio/入口.json">`，紅點貓收藏擴充功能在那一頁按下圖示就找得到入口（https、回 `Access-Control-Allow-Origin: *`），不必把網站加進擴充功能的清單；使用者也可以貼 `https://climbio.app/?topo=<入口網址>`，網站可以放一顆連到這個網址的「用紅點貓收藏」。格式見 [format/README.md](../format/README.md)，範例是[龍洞岩場站](https://longdong.web.app/climbio/longdong.json)（`scripts/gen-climbio.ts`）。檔案多、照片大時，選用的預覽圖（`props.preview`）、合併檔（`props.pack`）、照片縮到長邊 1600（`@climbio/sourcekit`）可以讓下載快一點，沒有也能收。

站台端不需要為了紅點貓產生這種格式；要自己輸出才這麼做。
