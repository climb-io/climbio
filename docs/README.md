# 產品規格

## AI Agent 與現行文件入口

- 共用規範：[AGENTS.md](../AGENTS.md)。
- Studio 現況：[studio.md](studio.md)；Agent CLI、交接：[studio-work.md](studio-work.md)。
- 架構：[architecture.md](architecture.md)；測試：[testing.md](testing.md)；外部貢獻：[CONTRIBUTING.md](../CONTRIBUTING.md)。
- 歷史設計不作為實作依據；需要追查決策時才讀 [歷史提案歸檔](archive/README.md)。

## 目前產品與工程規格

| 文件 | 內容 |
|---|---|
| [architecture.md](architecture.md) | 程式架構：檔案分工、資料流、哪些狀態可以改 |
| [brand.md](brand.md) | Climbio 品牌、色票、標誌與角色原則 |
| [holdcat.md](holdcat.md) | 岩點貓：照片裡的岩點長出耳朵和臉；新增牆面醒來；完攀時爪印壓下去、路線岩點跟著震 |
| [mascot-motion.md](mascot-motion.md) | 果凍岩點貓動作規格：果凍身體動作、收耳收臉變岩點（不是舊版教學動畫） |
| [style.md](style.md) | 介面風格：顏色、字、元件、版面、動態、文字，以及改介面前後的檢查清單 |
| [app.md](app.md) | 介面與操作：首頁、新增牆面、定線、看線、攀爬紀錄 |
| [route-image.md](route-image.md) | 路線圖與起攀／完攀／腳點標示的畫法 |
| [hold-data.md](hold-data.md) | 三份岩點資料（原始岩點檔、我的岩點檔、路線自帶外框）、看線上色、重描輪廓、效能目標、演算法概要 |
| [hold-recognition.md](hold-recognition.md) | 認點流程：偵測、重描、SAM2、AI 檢查、人工檢查；每一步的找到、外框貼、多認，AI 檢查和人工的對照 |
| [studio-design.md](studio-design.md) | Climbio Studio：首頁的新專案（快速掃描、選自動處理）、手動輸入、共用外殼與步驟列 |
| [studio-wall.md](studio-wall.md) | Studio 的 Wall：精修牆面專案的岩點外框（SAM2 重描、長按補點與重描、合併、裁切） |
| [embed.md](embed.md) | 內嵌（iframe）：閉源網站嵌入有畫面的 Kit，資料只讀 Climbio 官方發佈的網址（Studio 發布後），定線結果經 `postMessage` 傳回；訊息外框、來源檢查、版本、託管 |
| [studio-crag.md](studio-crag.md) | Studio 的 Crag（戶外岩場）：匯入照片、自動歸岩壁、岩壁地圖、路線表格、畫 Topo、轉換路線書、匯入岩場站、發佈 Guidebook；路線用像試算表的表格改 |
| [guidebook-convert.md](guidebook-convert.md) | 教學：天然岩場的維護者把路線書（Google 文件、Word、網頁）轉成開放格式，大綱的寫法、補原圖 |
| [岩點貓完整使用說明](../guides/hold-manual.html) | 面向室內岩友：安裝、拍攝建牆、岩點辨識與修正、定線、看線、完攀、分享、找牆面、備份與 FAQ |
| [redpoint-data-blueprint.md](redpoint-data-blueprint.md) | 紅點貓資料藍圖：收藏岩場、轉換路線書、串接網站的統一文案與視覺風格、首頁入口、資料權利、推廣階段及驗收清單 |
| [紅點貓完整使用說明](../guides/redpoint-manual.html) | 面向岩友：安裝、世界、下載離線、Topo／3D、地圖、紀錄、收藏、分享、備份與 FAQ |
| [redpoint.md](redpoint.md) | 紅點貓（最簡單好用的 Guidebook 閱讀器）：畫面、世界、收岩場（開箱）、分享、備份、資料（v2 存在手機）、照片來源、收與送、畫面 |
| [redpoint-sites.md](redpoint-sites.md) | 讓你的網站支援紅點貓：放一個入口網址，CORS、照片長邊 1600、預覽圖、合併檔，龍洞當範本 |
| [sharing.md](sharing.md) | 公開分享、公開索引、接收、刪除與舊版後端相容 |
| [route-format.md](route-format.md) | 公開資料的網址（公開格式 v2 的牆、路線圖層、站和總目錄）：任何 App、任何伺服器的路線連結都能收 |
| [glossary.md](glossary.md) | 名詞：Wall、Crag 工作區，組合的 `type`（`walls`、`guidebook`），岩館 `gym` |
| [deploy.md](deploy.md) | 接自己的 Firebase 後端：設定、部署、防濫用 |
| [development.md](development.md) | 本機驗證的案例選擇 |
| [testing.md](testing.md) | 測試指令、使用情境覆蓋表、Android／iOS 與實機驗證範圍 |
| [gyms.md](gyms.md) | 岩館清單：OpenStreetMap＋台灣清單、名稱規則、怎麼更新、資料出處 |
| [open-source.md](open-source.md) | 開源：各部分的授權、怎麼架自己的站（後端、名稱、圖示、吉祥物）、改程式時要注意的 |

## 歷史文件（預設不讀）

- [歸檔索引](archive/README.md)：舊版提案、設計背景與決策脈絡。只在追查歷史或相容性時閱讀。
