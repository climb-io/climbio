# 程式架構

> **資料邊界（2026-11-17 `dev`）**：本機修改先落在裝置，沒有自動帳號同步；備份由使用者手動存成 `.climbio` 檔（沒有雲端備份），裝置之間用「我的裝置」配對同步。公開分享的牆與岩場放進 Climbio 的開放資料集（Hugging Face，CC BY-SA 4.0），伺服器只留索引。Firebase Storage 與舊分享函式仍為正式版相容而存在，見 [分享與同步](sharing.md)、[部署](deploy.md)。

沒有建置步驟、沒有框架：岩點貓的 `hold/index.html` 依序載入一般的 `<script>`，所有檔案共用同一個全域範圍。載入當下只能用前面檔案宣告的東西，所以啟動和事件綁定放在最後的 `js/main.js`。新增檔案要加進 `index.html`（唯一的載入清單）和 `sw.js` 的 `SHELL`（離線快取），`node tools/check.mjs` 會檢查。

## 網站入口

同一個網站放岩點貓、紅點貓和 Climbio Studio，各有獨立的 manifest 和 Service Worker，可各自加到主畫面；同一網域下的共用暱稱由兩款 App 使用，本機資料依 App 及瀏覽器儲存空間管理。

| 網址 | 內容 |
|---|---|
| `/`（`index.html`、`entry.js`、`home-reel.js`、`css/home.css`；繁中另加 `css/warm.css`） | 單一視窗滿版輪播，八語共用腳本與版面。繁中首頁的文案、照片與暖色調整只在根目錄 `index.html` 與 `css/warm.css`，其他語言首頁不套用。每幕用一張照片和一段文字，前四幕各有對應入口。最後一幕的文案先出現，接著原地展開應用、Studio、文件與 Lab 的入口；GitHub、使用條款、隱私權在畫面左下角。文件頁集中開發工具與岩場資料。帶著 App 參數進來時，`entry.js` 在畫面出來前依內容轉進對應的 App（`?topo=` 給紅點貓，路線連結的 `?p=` 給岩點貓） |
| `/lab/`、`/lab/en/` | 岩點精修、3D 重建與開放資料集。Hold Lab 比較工具在 `/lab/hold-lab/`（岩點報告跟 Studio Wall 共用，見 docs/studio-wall.md 的「岩點報告」） |
| `/guides/`、`/en/guides/` | 文件索引、App 操作手冊、Studio 指南及開發資源；`/kits/` 與 `/kits/en/` 由 `tools/build-kits.mjs` 產生 |
| `/en/` | 英文首頁，首頁依裝置語言自動選擇繁中或英文，文件頁依瀏覽器語言自動導向 |
| `/hold/` | 岩點貓（室內手機）：`hold/index.html`、`hold/sw.js`、`hold/manifest*.webmanifest`；程式、樣式和其他共用的檔案在網站根目錄 |
| `/studio/` | Climbio Studio（電腦、平板；手機只匯入岩場站、接著編 Crag）：一個 PWA（`studio/manifest.webmanifest`、`studio/sw.js`，範圍 `/studio/`）。首頁 `studio/index.html`（新專案、手動輸入、最近的專案）；正式工作區 `/studio/crag/`（戶外岩場，ES module，見 [studio-crag.md](studio-crag.md)）；專案資料夾 `studio/store.js`、共用外殼 `studio/shell.js`、`shell.css`（見 [studio-design.md](studio-design.md)）；Wall 與 3D 牆現由 `/lab/` 對外介紹為研究工具，相關舊技術入口仍可開啟；Wall 手機也能用（`ak-handset` 換手機版面：底部面板，見 [studio-wall.md](studio-wall.md)）；首頁和 Crag 在手機照常打開，`html` 加 `ak-handset` 換手機版面 |
| `/redpoint/` | 紅點貓（戶外手機，見 [redpoint.md](redpoint.md)）：`redpoint/` 裡是自己的頁面、程式（ES module）、`sw.js`、manifest |
| `/r/…`、`/w/…`、`/dir/…`、`/climbio.json` | 公開資料與分享連結，由岩點貓、紅點貓與 Climbio Studio 共用（見 [route-format.md](route-format.md)） |
| 其他找不到的網址 | Firebase Hosting 回根目錄的 `404.html`（母品牌淺底、連回首頁；`firebase.json` 只把公開資料的路徑交給雲端函式，沒有整站導到一頁的規則） |

根目錄的 `sw.js` 只負責註銷岩點貓搬到 `/hold/` 前裝在根目錄的 Service Worker。

### 更新與離線（岩點貓、Climbio Studio 共用 `appkit/sw.js`）

背景預載失敗會保留目前畫面與離線快取，下次預載或實際偵測時重試；偵測腳本本身沒載入時回報下載錯誤。`appkit/recover.js` 只在有網路時修復，不因可重試的非同步腳本失敗而清快取、重載。預設只處理必要靜態腳本的載入失敗。頁面在 script 標籤加上 `data-boot`（紅點貓為 8000 毫秒）時另開開機看門狗：開機完成前，自家網域腳本的下載失敗、語法或執行錯誤，以及主程式沒在時限內呼叫 `akBooted()`，都算開機失敗。失敗時若有等待中的新版 Service Worker 就送 `SKIP_WAITING` 讓它接手再重新整理；沒有就解除 Service Worker、刪掉 `data-cache` 指定前綴的快取（紅點貓是 `redpoint-cat`）再重新整理。只清快取，不動 IndexedDB。十分鐘內最多自動修復一次。

- **開 App 網路優先**：導覽請求先問網路，網路慢過 3 秒或沒網路才用存好的頁面。有網路時打開就是最新版，不先閃舊版、不自動重新載入；岩館沒訊號時 3 秒內也開得起來。
- **資源網址帶版本**：部署時 `tools/stamp-assets.mjs`（`build-site.sh` 呼叫）把 `hold/index.html`、`3d/index.html` 和 Studio 各頁（首頁、`wall/`、`crag/`、`wall3d/`、`scene/`、`work/`）裡本站的 `<script src>`、樣式表 `<link href>` 加上 `?v=<版本>`，語言包也跟著（`appkit/i18n.js` 沿用自己的後綴）。帶版本的網址快取優先，頁面和資源永遠同一版，不必靠重新載入對齊。模組互相 `import` 的網址沒有後綴：頁面已經用帶版本的網址載入過 Service Worker 這一版時，它要的程式、樣式也照這一版的快取（`appkit/sw.js`），頁面是別版的照網路優先，不混版。其他沒帶版本的資源（圖示、Worker、資料）網路優先。資料夾網址（`/studio/wall/` 這類）的頁面一律 `no-cache`（`firebase.json` 的 `**/`），瀏覽器不留舊頁。本機開發沒經過部署、不帶後綴，永遠是最新的。
- **岩點貓預先快取整版**（`hold/sw.js` 的 `SHELL`）：install 時存成帶版本的網址，一個都不能少；新的 Service Worker 裝好就接手，啟用時清掉別版。大檔模型另存只跟 holdkit 版本走的 `MODELS` 快取，網址不帶 `?v=`。Climbio Studio 沒有預先快取，用到才存。
- **大檔下載由頁面排序**（`js/add-wall.js`）：首頁畫好後（第一次打開還要等開場的清晰示範照片載完）在背景依序預先下載偵測模型和它的 onnxruntime、重描的解碼器和編碼器（低優先的 fetch，省流量模式不下載），存進 `MODELS` 快取（名稱同 `hold/sw.js`），下載完整才存；這時只存不載入，Worker 等新增牆面時才建（不佔看線、定線的 CPU 和記憶體），先讀快取。主網的模型是壓縮傳輸，進度用解壓後的大小算。第一次造訪還沒被 Service Worker 控制也只下載一次，快取被清掉（iPhone 久沒開）就自動重新下載；點「開始拍」時還沒好就接著同一個下載，掃描畫面顯示百分比，失敗有訊息可重試。
- **第一次開場不等大照片**（`js/mobile.js`）：示範牆資料（`js/boot.js` 只在開場時先 preload，含 323 px 縮圖）一到就用縮圖放大的預覽演開場，`demo.jpg`（低優先）載好後換成清晰版。
- **開著不動**：`js/main.js` 回到前景、恢復網路時（至少間隔 1 分鐘）抓 `version.js?check=`，版本不同就顯示「有新版本　更新」，按了才 `location.reload()`，不自動打斷。
- 紅點貓的 Service Worker 仍是整版預先快取、離線優先（見 [redpoint.md](redpoint.md)），沒有套用這一套。

## 檔案分工

| 路徑 | 內容 |
|---|---|
| `hold/index.html` | 岩點貓的頁面骨架，依序載入下面的程式（共用的檔案在網站根目錄，用 `../` 引用） |
| `css/app.css` | 樣式 |
| `routekit/` | 看路線、定線、輸出路線圖的共用模組（全域 `RouteKit`，在 app.js 前載入；不依賴 App 的狀態、不帶品牌）：外框幾何、膠帶與出手順序、路線圖的底、`RouteScene`、定線規則、`RouteViewer`／`RouteEditor`。說明在 `routekit/README.md` |
| `mapkit/` | 岩場的向量地圖：看圖與編輯（npm `@climbio/mapkit`，AGPL-3.0）：純 ES module、原生 SVG、不用建置，`MapViewer`／`MapEditor`／`<climbio-map>`；吃 v2 的地圖畫面＋圖層（經緯度）、輸出圖層，底圖圖磚（OSM、航照、等高線）可以開關，不上傳、不連後端，供 Studio Crag、紅點貓及龍洞等宿主使用，實際接入以入口程式為準。說明在 `mapkit/README.md` |
| `topokit/` | 戶外 Topo 的看圖與編輯（npm `@climbio/topokit`，AGPL-3.0）：純 ES module、原生 SVG、不用建置，`TopoViewer`／`TopoEditor`／`<climbio-topo>`；吃 v2 的照片畫面＋圖層（座標是照片像素）、輸出圖層，不上傳、不連後端，紅點貓已在 `redpoint/app.js` 載入 `topokit/element.js`、`viewport.js`、`data.js`；其他宿主各依入口檔案載入。說明在 `topokit/README.md` |
| `appkit/` | 手機 App 與 Studio 共用的一層（npm `@climbio/appkit`，AGPL-3.0，全域 `AppKit`）：語言包載入 `i18n`、兩個 Viewer 共用的帳號頭像／統計摘要與個人資料 `account`、加到主畫面 `install`、照片與 EXIF `photo`、ZIP 與檔名 `files`、對話框與提示 `ui`、系統分享 `share`、電腦版工具的手機介紹頁與手機版面判斷 `landing`、共用樣式 `ui.css`（介面色從 `css/brand-tokens.css` 對過來）。岩點貓、紅點貓與 Studio 工作區已使用。說明在 `appkit/README.md` |
| `format/` | 公開格式 v2（畫面、圖層、組合）的 JSON Schema 與驗證器（npm `@climbio/format`，全域 `ClimbioFormat`）；App 還沒載入。說明在 `format/README.md` |
| `js/rename.js` | 舊名 `spraywall` 搬到 `climbio`：手機裡 `spraywall.*` 的設定、岩點貓的模型快取換到新名稱，舊的快取刪掉（岩點貓、紅點貓最先同步載入）；牆（IndexedDB `spraywall-db` → `climbio-db`）在 `js/app.js` 第一次打開資料庫時搬 |
| `js/boot.js` | 開頁就要決定的事（版面的 class、測試版名稱、語言包），在頁面最後同步載入（其餘程式都是 `defer`、平行下載）；頁面一開始是內嵌樣式的啟動畫面 `#bootSplash`，首頁畫好後 `js/main.js` 拿掉；`hold/index.html` 不放內嵌程式（CSP 不允許） |
| `js/mascot-motion.js` | 果凍岩點貓（操作示範、動畫預覽）的 SVG 局部變形及可取消播放，在 app.js 前載入 |
| `js/holdcat.js` | 岩點貓：照片裡的岩點長出耳朵和臉（新增牆面醒來、完攀表演），在 app.js 前載入 |
| `js/app.js` | 共用核心：常數、語言、儲存（IndexedDB）、復原 |
| `js/home.js` | 首頁：選單、右下「＋」、繼續爬、找牆、兩欄小卡 |
| `js/profile.js` | 照片處理、對話框、攀爬紀錄、手感特效、個人資料 |
| `js/add-wall.js` | 新增牆面：拍照、裁切、分析畫面、岩點輪廓、整面牆重描 |
| `js/edit.js` | 定線與岩點編輯：點擊、類型、畫岩點 |
| `js/wall.js` | 牆面頁、編輯畫面、返回鍵、提示、縮放、首頁卡片 |
| `js/sync.js` | 分享：分享路線、分享畫面、接收分享、公開牆 |
| `js/draw.js` | 繪製：編輯畫面（岩點外框、把手、選擇）、路線底的模式（灰階／暗彩）、岩點檔與路線外框的整理；路線圖本身用 RouteKit |
| `js/export.js` | 輸出：分享的路線圖（Climbio 版面：難度、名稱、署名） |
| `js/mobile.js` | 手機介面 |
| `js/wall3d.js`、`wall3dkit/` | 3D 牆（載入、繪製、沿牆鏡頭、烘焙在 Wall3DKit）：私人連結下載成一面牆、牆頁底圖換成模型、路線連結（見 [3D 牆](3d-wall.md)） |
| `js/main.js` | 啟動與事件綁定、導覽、開著不動時的版本檢查 |
| `site.js` | 站台設定：用哪個後端（`SITE.backend`）、雲端加速、App 網址；主網網域接主網的後端，其他網域和本機預覽自動不接（自架站不用改；瀏覽器測試用 localStorage 的 `climbio.site.main` 接回）；預設的空後端 `window.Backend` |
| `appkit/share-tools.js` | 不需要後端的分享工具：收線、找牆面（讀任何網址的公開格式 v2，先過 `format/format.js` 的 validate）、一面牆的分享包（`wallPackage`）、解析連結、gzip |
| `holdscan/` | 岩點偵測（AGPL-3.0，freeclimbs YOLOv8n）：瀏覽器版（`browser/`，App 在手機上偵測）、共用前後處理（`core/`）、模型、雲端函式 `detect`（`functions/`，設了 `SITE.cloud.detect` 的站才用） |
| `backend/firebase.js` | 主網站的可替換後端（`window.Backend`）：公開資料集的索引（`datasets`／`walls`）、找牆面及舊版相容的 Storage 路徑；分享貢獻數由 App 在本機計算 |
| `functions/` | 主網站的雲端函式（codebase `climbio`）：目前主要負責 `datasets` 公開索引、`walls` 圖層索引、`routePage` 路線連結與公開牆資料、總目錄、選用雲端服務等。部署見 [deploy.md](deploy.md) |
| `gyms/`、`tools/gyms.mjs`、`tools/gyms/` | 岩館清單（每個國家一個檔），由 `tools/gyms.mjs` 產生，不要手改 `gyms/`（見 docs/gyms.md） |
| `i18n/<app>/<語言>.js`、`i18n/common/<語言>.js` | 語言包（中、英、日、法、韓、西、德）：每個 App 一組（岩點貓 `hold/`、紅點貓 `redpoint/`，語言只跟瀏覽器語言），共用名詞（確定、取消、加到主畫面的說明）一組；頁面只載入目前語言（`AppKit.i18n`） |
| `firestore.rules`、`storage.rules`、`storage-cors.json` | Firebase 規則與 Storage 的 CORS |
| `fonts/` | 難度、數字字型 Barlow Condensed；段級用的 M PLUS 1 Black（只留用到的字）；都是 SIL OFL，授權在 `fonts/` |
| `hold/sw.js`、`hold/manifest.webmanifest`、`version.js`、`appkit/sw.js` | 岩點貓的 PWA（範圍 `/hold/`）；版本號部署時自動寫入；`appkit/sw.js` 是三個 App 共用的 Service Worker 核心 |
| `icons/brand/`、`icons/cats/`、`css/brand-tokens.css` | 母品牌 Logo、兩款手機 App 角色及 PWA 圖示（`tools/brand-icons.mjs` 從 `design/brand/` 產生）；品牌色（見 [brand.md](brand.md)） |
| `studio/` | Climbio Studio：首頁（`index.html`、`home.js`）、Google 相簿分享連結匯入（`album.js`）、專案資料夾與收件匣（`store.js`、`opfs-worker.js`）、共用外殼（`shell.js`、`shell.css`）、`manifest.webmanifest`、`sw.js`（先問網路，慢或沒網路用存的）；`crag/`、`holdlab/` 是工作區的頁面與程式 |
| `redpoint/` | 紅點貓（見 [redpoint.md](redpoint.md)）：自己的 `index.html`、`manifest.webmanifest`、`sw.js`；資料是 v2 檔案存在 IndexedDB，看 Topo 用 `topokit/` |
| `about.html`、`privacy.html`、`terms.html` | 關於 Climbio、隱私權政策、服務條款 |
| `google*.html` | 網站搜尋服務的網域驗證檔；公開版本是否包含由交付規則決定 |
| `TRADEMARKS.md`、`design/brand/LICENSE` | 「Climbio」名稱的使用請求；Logo 與貓咪角色的 CC BY 4.0 授權（開源規劃見 docs/open-source.md）。使用者看得到的產品名寫 `Climbio`，品牌綠只用 CSS 變數 |
| `tools/` | `check.mjs`（部署前檢查）、`guidebook.mjs`、`eval-convert.mjs`（不開 Studio 轉換路線書、比較固定測試組，見 docs/guidebook-convert-format.md）、`textfit.js`（文字長度檢查）、`rebrand.mjs`、`bump-version.mjs`（自架站換產品名稱、加版本號） |
| `build-site.sh`、`tools/stamp-assets.mjs` | 打包網站；打包時給頁面資源網址加版本後綴 |
| `holdkit/` | 岩點分析（AGPL-3.0）：框 → 外框（`holdkit.js`）、MobileSAM 重描（`samrefine.js`、`samworker.js`、`models/`）、雲端函式 `retrace`（`functions/`）；岩點資料包格式在 `SPEC.md` |

## 資料流：照片 → 偵測 → 岩點資料 → 定線 → 儲存／同步

1. **照片**（`js/add-wall.js`）：拍照或選照片 → 裁切（`state.img`、`state.w`、`state.h`）。牆的 id 就是照片編號，之後分享、收線、同步都用它認同一面牆。
2. **偵測**（`localDetect`）：在手機上跑 `holdscan/browser/`（`HoldScan.detect`），得到照片座標的框 `[x0, y0, x1, y1, score]`。
3. **岩點資料**（`holdkit/`）：框 → 依顏色描外框（`HoldKit.boxToPoly`），組成岩點 `{ id, poly, source: 'detect' }`；設了 `SITE.cloud.retrace` 再在背景用 MobileSAM 整面重描（`HoldRefiner`，雲端串流回傳），外框一批一批換上。三份岩點資料（原始岩點檔 `w.base`、我的岩點檔 `w.holds`、路線自帶外框 `r.shapes`）誰能改見 [hold-data.md](hold-data.md)。
4. **定線、看線**（`js/edit.js`、`routekit/`）：路線 `{ id, holds: { 岩點 id: 角色 }, shapes, grade, name, t, … }` 存在 `w.routes`。畫路線圖、點岩點的規則在 `RouteKit`，它只從參數拿資料（照片和岩點包成 `RouteScene`，打開的牆是 `state.scene`），不碰 App 的狀態。
5. **儲存**（`js/app.js`）：`putWall(w)`／`putNewWall(w, blob)` 寫進 IndexedDB `climbio-db`。存檔前 `settleWall`（`js/draw.js`）整理原始岩點檔和路線外框；一面牆拆成 `walls`、`holds`、`routes`、`images` 幾筆，只寫這份物件改過的記錄。
6. **同步、分享**（`js/sync.js` → `window.Backend`）：按分享批次傳送的線 `pushWall`（只限 Studio 發佈的公開牆：只把線傳到 Climbio，不上傳牆的照片與岩點；手機自己拍的牆只走附近交換）、讀公開牆 `pullWall`，都經過 `Backend`（主網是 `backend/firebase.js`，沒有後端時是 `site.js` 的空後端）。收線 `fetchShared`（`appkit/share-tools.js`）直接讀連結指到的路線圖層（分享包的圖層，或那台伺服器的 `route.json`）和它疊的牆，不經過後端；圖層轉成 App 的路線用 routekit 的 `fromFormat`。規則見 [sharing.md](sharing.md)，格式見 [route-format.md](route-format.md)。

## 狀態：哪些可以改、改了要做什麼

| 狀態 | 在哪裡 | 規則 |
|---|---|---|
| 目前的牆 `state.wall` | `js/app.js` 的 `state` | 就是 IndexedDB 讀出的那份牆面物件；改完呼叫 `putWall` 存檔，不另存副本 |
| 照片、灰階、分析 `state.img`、`state.gray`、`state.ana` | `state` | 換牆時重設；分析結果在岩點階段就算好，不等看線時才算；3D 牆另記 `state.imgOf`（照片是哪一版快照），背景重做快照、照片還沒換上時不畫路線小卡 |
| 路線 `state.routeId`、`state.routeView` | `state` | 目前打開的路線、看線或定線 |
| 岩點外框 | `w.holds`、`r.shapes` | 改了呼叫 `touchGeom()`，`RouteScene` 的快取才會重算；原始岩點檔 `w.base` 只有計算能改 |
| 站台設定 `SITE`、後端 `Backend` | `site.js`、`backend/` | 開頁時決定，執行中不改；要用後端的功能先看 `Backend.caps` |
| 這台的偏好、識別 | `localStorage` 的 `climbio.*` | 名稱沿用舊專案名，改了裝置上的資料會讀不到，不要改 |

## 後端邊界

核心流程不寫 Firebase 專屬的東西：功能先要在 `backend: 'none'` 時能用，要用後端的加進 `Backend.caps`（`share`、`gyms`、`account`、`stats`，見 [sharing.md](sharing.md) 的「後端」）。接自己的 Firebase 見 [deploy.md](deploy.md)。
