# 產品規格

## Climbio V3：產品方向與實作狀態

> **2 Apps + 1 Studio（Crag）+ Open Format + Open Kits**。使用者已確認取消「四隻貓＝四個產品」限制；Climbio Studio 為唯一專業品牌，直接使用母品牌 Logo；Crag 是工作區，`/studio/` 統一入口已建立，共用的三欄操作介面仍在整合。首頁在 `dev` 改為首屏同時展示岩點貓／紅點貓，固定導覽提供「岩場資料」入口，接著是三種資料取得方式、Studio 與完整的 9 元件開發者展示（8 npm 套件＋HoldScan）；`dev` 的 Git 提交不會自行部署，預覽更新由明確授權的 ChatGPT 手動部署通道發布。**下方是 `dev` 現行規格，提案內尚未完成的功能不代表已上線。**

| V3 提案 | 內容 |
|---|---|
| [V3 平台總提案](proposals/climbio-v3.md) | 定位、產品分工、範圍、非目標、責任 |
| [Studio 設計規範](studio-design.md) | 唯一 Studio 品牌、共用 Shell、Crag 工作區與資料相容 |
| [Studio UX V3](proposals/studio-ux-v3.md) | Wall 批次牆面；Crag GPS／地圖／Topo／Guidebook 流程 |
| [Open Platform V3](proposals/open-platform-v3.md) | Format v2、Kits、可攜儲存及第三方整合 |

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
| [studio-design.md](studio-design.md) | Climbio Studio：首頁的新專案（快速掃描、選自動處理）、手動輸入、共用外殼與步驟列 |
| [studio-wall.md](studio-wall.md) | Studio 的 Wall：精修牆面專案的岩點外框（SAM2 重描、手畫、合併、裁切） |
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
