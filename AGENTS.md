# Climbio：給 AI 代理的工作規範

攀岩 App **Climbio**（PWA，純前端，沒有建置步驟；正式版 https://climbio.app）。這份是所有 AI 代理（Claude Code、Codex 等）共用的規範，`CLAUDE.md` 引入本檔。產品規格在 [docs/](docs/README.md)，程式架構在 [docs/architecture.md](docs/architecture.md)；要送 PR 先看 [CONTRIBUTING.md](CONTRIBUTING.md)，哪些可以直接修、哪些要先提設計案寫在那裡。


## 語言

- 程式碼識別字用英文；程式碼註解、`docs/` 的規格用繁體中文為主。
- **對外的內容要有繁體中文和英文兩版**：README、網站頁面（`kits/`、`guides/`、介紹頁）、Climbio Studio 的介面與說明。兩版一起寫，內容對應、不是逐字翻譯；英文版用 `*.en.md`、`en/` 資料夾或語言包。既有只有中文的檔案，改到時順手補英文版。App（岩點貓、紅點貓）介面支援七種語言（語言包）。
- 元件（`format/`、`routekit/` 等）的說明：**網頁給人看**（`kits/content/<元件>.mjs` 是內容，`node tools/build-kits.mjs` 產生 `kits/`、`kits/en/`，頁面不手改）；**GitHub 文件給 AI 讀**（元件資料夾的 `README.md`、`README.en.md`，章節固定：用途、授權與依賴規則、檔案地圖、公開 API、資料格式與不變條件、最小範例、限制、驗證）。改了公開 API，README 兩版與網頁內容一起更新。

## 專案地圖

- App：岩點貓（`/hold/`，室內：拍牆、岩點、定線、看線、分享）、紅點貓（`/redpoint/`，戶外：收岩場、離線看 Topo）；Climbio Studio（`/studio/`，整理資料的工作台）；開放格式（`format/`）與各 Kit（`routekit/`、`topokit/`、`crag3dkit/`、`wall3dkit/`、`mapkit/`、`holdkit/`、`holdscan/`、`sourcekit/`、`appkit/`）。
- 資料流：App 在手機上偵測岩點（`holdscan/`）→ `holdkit/` 算外框、重描，組成岩點資料包 → 存在手機，公開分享才傳到後端（Climbio 的開放資料集）；備份是使用者手動存的 `.climbio` 檔。
- **名詞**：Hold Lab、Crag 是工作區；發佈的組合 `type` 是 `walls` 或 `guidebook`；小寫 `gym` 一律是岩館。改名、加功能前先看 [docs/glossary.md](docs/glossary.md)。
- **授權邊界（不能破）**：整個 repo 是 AGPL-3.0，包含所有 Kit；不提供商業授權，貢獻者依 AGPL 進來、不簽 CLA。`format/` 和 `docs/route-format.md` 維持 Apache-2.0，裡面不能引用 AGPL 的程式或模型。
- **伺服器只是主網的加速**：完全開源，沒有私有程式。接不接後端由 `site.js` 決定：主網（climbio.app）接，**其他網域（自己架的站、本機預覽）預設不接**（`backend: 'none'`，Studio 也照這個設定不登入、不發佈）。新功能先要在沒有伺服器時能用；要用後端的功能加進 `Backend.caps`，不把 Firebase 專屬的東西寫進核心流程。

## 工作原則

- 架構用第一原理分析；程式遵循 DRY、KISS、SOLID、YAGNI。架構要簡單，一次修改只動一筆資料。遵循既有約定，命名即文件，只替複雜邏輯寫註解。
- **相容性**：公開的開放格式（`format/`）與各 Kit 的公開 API 採**語意版本**：不相容的改動要升主版本，並且先提設計案；相容的新增升次版本。App 自己的內部資料與沒公開的介面不做向後相容（不留舊格式、搬移程式和相容分支）。
- 不硬編碼密鑰（Firebase 前端設定與 API key 是公開設定，權限由規則控管）；外部輸入要校驗；錯誤要明確處理，不能靜默失敗。
- **零假設**：產品行為、預設值有歧義時，列出選項讓維護者決定，不自己挑。外部資料先用實際資料確認欄位與語意，寫完再用實際輸出核對。
- **能用一次實驗決定的不拿來問**：跑一次、看結果再報結論。
- **演算法的前提先用資料量化再寫，不憑印象**：路線怎麼標示（岩點顏色、膠帶、圖釘、編號）、一條路線有幾顆岩點這類前提，動手前先用目標岩館的真實資料算數量級（例如「膠帶數 vs 岩點數 vs 路線數」：一條路線 8～15 顆岩點，膠帶不可能每顆都貼，所以膠帶至多標起攀、完攀、難度）。**現代岩館的路線以同色岩點為主流，對岩館一無所知時預設用「同色岩點」分組**，先量岩點有沒有顏色，沒有才說明不適用。同一類前提錯誤出現第二次，就把判別寫進工具並更新這份規範。
- 每一行 diff 都要對應明確的需求：沒點名的特性、彈性、抽象不加，不順手重構無關的程式。無關的死碼只提醒不刪；自己改動產生的孤兒要清乾淨。commit message 寫「改了什麼、為什麼」。
- 只寫「現在是什麼樣子」，不寫歷史、改版紀錄和日期（歷史看 git log）。


## 開發

```bash
python3 -m http.server 8765     # http://localhost:8765：首頁；岩點貓 /hold/、Studio /studio/、紅點貓 /redpoint/
npm ci && npx playwright install chromium
node tools/check.mjs            # 靜態檢查（開發階段提交前跑；部分項目只警告）
npm run test:boot               # 開機檢查（手機瀏覽器打開沒有腳本錯誤；部署前自動跑）
npm run test:quick              # 嚴格檢查＋Node 測試（推正式版／main 前跑）
npm run test:product -- studio --e2e   # 只跑某個產品的測試（產品名稱見 tools/test-groups.mjs）
```

- 結構、資料流、哪些狀態可以改見 [docs/architecture.md](docs/architecture.md)；測試的新增與清理、案例選擇見 [docs/development.md](docs/development.md)。
- **測試只留「功能壞了會失敗」的**：e2e 與單元測試斷言行為（流程走得通、資料存得進去、返回退得回、錯誤有處理），不斷言版面數值、欄數、尺寸、順序、文案、像素基準圖（改一次畫面就要跟著改期望值，這類測試不新增、遇到就刪）。測試資料不進 repo：能用開放資料集的就從資料集下載，其餘由測試程式合成。
- **測試用乾淨的資料**：測試開 `http://127.0.0.1:8765`（跟平常用的 `localhost` 不同來源，資料是空的），或用測試牆，測完清掉。

## 程式規則

- **分檔**：`js/` 的檔案依 `hold/index.html` 的順序載入、共用全域範圍。載入當下只能用前面檔案宣告的東西，所以啟動和事件綁定放 `main.js`。
- **routekit/**：路線怎麼畫、怎麼點（不看 App 狀態就能決定的）放這裡，資料從參數傳入（照片和岩點用 `RouteScene`；岩點外框改了呼叫 `touchGeom()`）；不能用 `state`、`t()`、DOM 元素 id、IndexedDB、品牌。App 呼叫繪製函式寫 `RouteKit.…`，幾何（`inPoly`、`area`、`edgePoint`）可以直接用。Kit 不依賴 App 或特定後端。
- **Studio 的工作區分界**（[docs/studio-design.md](docs/studio-design.md)）：各工作區的功能只放在自己的資料夾（`studio/crag/`、`studio/holdlab/`）；共用的 `studio/shell.*`、`store.js`、`publish.js`、`sync.js`、`appkit/` 只放不看工作區的東西；首頁匯入的差異放各自的 `intake.js`。新的 class、id 先查共用樣式（`appkit/ui.css`、`studio/shell.css`）有沒有同名。加了這類功能，瀏覽器測試要在另一個工作區斷言它沒出現。
- **轉換路線書的流程只有一份**：讀檔、大綱、建書、描線的串接放 `studio/crag/convert.js`（不碰 DOM），Studio 的畫面和 `tools/guidebook.mjs` 都呼叫它；問題清單只由 `studio/crag/report.js` 產生，兩邊顯示同一份。
- 不用瀏覽器的 confirm／alert／prompt，一律用 App 的對話框（`askConfirm`、`showAlert`、`askText`）。
- **函式參數不要跟同一個檔案的模組層級名稱同名**：避免遮蔽變數導致少數分支才失敗；修改授權或裝置簽章的程式時，要補對應的真實 API 與失敗情境測試。
- **Topo 的分叉、合併**：v2 沒有共用線段，分岔是複製前段的點，兩端座標相同的線段才視為共用、只畫一次（`topokit/lines.js`）。產生路線線的程式要讓共線的路線共用同一組點。
- **長時間的工作要有過場**：等超過幾秒的（下載、上傳、轉換、發佈）一律用全螢幕過場（標題、進度條和數字，做完才關、中間不能操作；Studio 用 `StudioShell.busy`），見 [docs/style.md](docs/style.md) 4.3 節。打不開、失敗要說原因，不停在空白畫面。
- **要使用者回報的診斷訊息要一鍵複製**：用 `askConfirm(診斷文字, { ok: '複製' })`，按下去 `navigator.clipboard.writeText`；診斷是暫時的，查出原因就移除。
- **天然岩場的 Guidebook 一定要有位置**：來源是照片的拍攝位置（`camera.position`），沒有就用岩場節點的 `geo`；兩者都沒有不能發佈（`studio/crag/publish.js` 的 `needsPosition`）。轉換路線書要先寫好岩場節點的 `geo`。位置、路線、署名、授權一律來自原始資料，不由 AI 推測。
- **紅點貓一次下載、離線看所有資料**：收一本岩場或一組 Topo，JSON 和全部照片一次下載到手機，之後完全離線可看；效能優化只能在這個前提下做，要改這個行為先提設計案。
- **沒有私人發佈**：發佈就是公開（放進開放資料集）；不想公開的用匯出 ZIP 自己託管、附近交換或手動備份。
- 算過的結果要存起來，在岩點階段就算好，不要等到看的時候才算。
- **內部識別字一律用 climbio**（`climbio.*`、`climbio-db`、`CLIMBIO_*`、`climbio-v…`）；舊名 `spraywall` 只剩 `js/rename.js` 搬舊資料。
- 產品風格：輕盈、時尚、好玩，但簡單、乾淨、不搶戲；路線的主角是岩點。**功能越少越好**：本機資料由使用者自己管（沒有回收區、不自動刪），也不做合集、停止分享、岩館管理。改介面一律照 [docs/style.md](docs/style.md) 並跑它的檢查清單。
- **每個獨立頁面都要有社群分享用的 meta**：`description`、`canonical`、`og:*`、`twitter:*`（標題、簡介、網址、縮圖）。新增獨立頁面後執行 `node tools/social-meta.mjs` 補齊（可重複執行；頁面內容由語言包動態填入的，標題與簡介要手動寫進標籤）。簡介寫在頁面的 `description`，缺簡介時先補 `tools/social-meta.mjs` 的 `FALLBACK_DESC`。

## 介面文字

- **不用 emoji 與裝飾符號、不加說明用的 `title`、對話框不放說明段落**（[docs/style.md](docs/style.md) 第 7 節）。
- **不放用過一次就懂的說明**（「按某某就會怎樣」「點選以編輯」），用版面、圖示、按鈕本身表達；只留做決定需要的內容（分享前的同意、錯誤原因）。
- 文字都在語言包，七個一起改；`node tools/check.mjs` 檢查 key 一致、用到的 key 都存在。簡潔、書面、專業，按鈕用動詞；日文用攀岩用語（課題、ホールド、グレード）。
- **新功能文案是交付條件，不是後續潤飾**：寫 UI 前先逐項標記可見文字的用途，只允許「標題／資料名稱」「可執行動作」「動態狀態／結果」「使用者做決定所必需的條件或風險」。不能歸類的教學句、招呼語、鼓勵語、情境故事直接刪掉；空狀態先只寫狀態與必要動作，不預演整套流程。禁止同一資訊在頁面標題、卡片標籤與說明中重複。**即使文案已經短，也不能保留多餘的常駐說明**：例如已顯示各裝置同步狀態，就不再寫「同一網路下，兩台開啟此頁時自動同步」；連線條件放在配對或失敗時提示。
- **附近交換必須保護陌生人隱私**：`appkit/nearby.js` 的 `join` 和 WebRTC `who` 只可傳每次開啟生成的「App 名稱＋匿名代號」；自訂裝置名稱僅可在雙方確認配對的 `pair/paired` 訊息或密鑰驗證成功的 `name` 訊息傳送。配對前不准顯示真實裝置名稱，也不能把未驗證的 `name` 寫入配對記錄；岩點貓、紅點貓必須共用同一實作。
- **共用元件必須跨兩款 App 外觀一致**：輸入框、按鈕、改名、確認對話框等優先使用 `AppKit.ui`；其基礎排版、字級、邊框、焦點樣式必須在 `appkit/ui.css` 自足，不得依賴某一款 App 的私有 CSS。涉及共用元件時至少檢查岩點貓與紅點貓的同一互動。
- **驗收時刪字與看畫面**：每次新增或更動 UI，先檢查每個可見字串是否有上述必要性、是否可直接由控制項或狀態取代；再在手機畫面實際打開空狀態、資料狀態與相關輸入對話框，確認字級、邊框和其他設定一致，才算完成。

## 驗證

| 改動 | 必跑 |
|---|---|
| 任何程式碼 | 開發階段提交前跑 `node tools/check.mjs`；推正式版／`main` 前跑 `npm run test:quick`＋受影響的案例；只動單一產品時用 `npm run test:product -- <產品> --e2e`（[docs/development.md](docs/development.md)） |
| 介面 | 本機預覽用手機寬度實際操作並截圖；電腦打開只有介紹頁，改到它時加 `?pc` 看 |
| 較長的介面文字 | 手機寬度打開，在 console 載入 `tools/textfit.js` 後跑 `await textFit()` |
| 岩點、顏色、標籤的演算法 | 用實際的牆比較改前改後（數字或截圖） |
| 路線書轉換 | `npm run eval:convert` 比較固定測試組的數字（`tests/convert/`） |
| 開放格式、Kit 的公開 API | 對應的 Kit 測試（`npm run test:product -- kits`）；不相容的改動升主版本 |
| 行為改動 | 對應的 docs 和 README 已更新 |

## 任務導覽

不用先理解整個專案；照要做的事，先讀第一欄的文件、跑最後一欄的測試（`npm run test:product -- <產品>`，加 `--e2e` 跑瀏覽器案例）。

| 要做的事 | 先讀 | 測試產品 |
|---|---|---|
| 修改岩點貓 | [docs/app.md](docs/app.md)、[docs/holdcat.md](docs/holdcat.md)、[docs/hold-data.md](docs/hold-data.md) | `hold` |
| 修改紅點貓 | [docs/redpoint.md](docs/redpoint.md) | `redpoint` |
| 修改 Studio | [docs/studio-design.md](docs/studio-design.md)、[docs/studio-crag.md](docs/studio-crag.md) | `studio` |
| 轉換路線書（資料或程式） | [docs/guidebook-convert-format.md](docs/guidebook-convert-format.md) 的「命令列」 | `studio` |
| 調整公開格式 | [format/README.md](format/README.md) | `kits` |
| 改某個 Kit | 該 Kit 的 `README.md` | `kits` |
| 修一個回報的問題 | issue 內容，再照上面找模組；先寫一個修之前會失敗的最小案例 | 依模組 |
| 自己架站、接自己的後端 | [docs/open-source.md](docs/open-source.md)、[docs/deploy.md](docs/deploy.md) | |
