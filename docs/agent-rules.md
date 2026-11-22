# Agent 共用規則（跨模組才讀）

只改一個模組時，讀 [AGENTS.md](../AGENTS.md) 的「按任務讀文件」那一列就夠，模組自己的規則寫在那些文件裡。這份只放跨模組都適用的規則：改到共用層、或一次動到好幾個模組時才讀。

## 語言

- 程式碼識別字用英文；程式碼註解、`docs/` 的規格用繁體中文為主。
- **對外的內容要有繁體中文和英文兩版**：README、網站頁面（`kits/`、`guides/`、介紹頁）、Climbio Studio 的介面與說明。兩版一起寫，內容對應、不是逐字翻譯；英文版用 `*.en.md`、`en/` 資料夾或語言包。既有只有中文的檔案，改到時順手補英文版。App（岩點貓、紅點貓）介面支援七種語言（語言包）。
- 元件（`format/`、`routekit/` 等）的說明：**網頁給人看**（`kits/content/<元件>.mjs` 是內容，`node tools/build-kits.mjs` 產生 `kits/`、`kits/en/`，頁面不手改）；**GitHub 文件給 AI 讀**（元件資料夾的 `README.md`、`README.en.md`，章節固定：用途、授權與依賴規則、檔案地圖、公開 API、資料格式與不變條件、最小範例、限制、驗證；有畫面的 Kit 最後加「內嵌（iframe）」，見 [embed.md](embed.md)）。改了公開 API，README 兩版與網頁內容一起更新。

## 專案地圖

- App：岩點貓（`/hold/`，室內：拍牆、岩點、定線、看線、分享）、紅點貓（`/redpoint/`，戶外：收岩場、離線看 Topo）；Climbio Studio（`/studio/`，整理資料的工作台：岩館、岩場、路線書、3D 四條線）；開放格式（`format/`）與各 Kit（`routekit/`、`topokit/`、`crag3dkit/`、`wall3dkit/`、`mapkit/`、`holdkit/`、`holdscan/`、`sourcekit/`、`appkit/`）；內嵌頁 `embed/<kit>/v1/`（給閉源網站用 `<iframe>` 嵌入有畫面的 Kit，見 [embed.md](embed.md)；`kit/` 是產物，改了 Kit 跑 `node tools/build-embed.mjs`）。
- 資料流：App 在手機上偵測岩點（`holdscan/`）→ `holdkit/` 算外框、重描，組成岩點資料包 → 存在手機，公開分享才傳到後端（Climbio 的開放資料集）；備份是使用者手動存的 `.climbio` 檔。
- **名詞**：發佈的組合 `type` 是 `walls` 或 `guidebook`；小寫 `gym` 一律是岩館。改名、加功能前先看 [glossary.md](glossary.md)。
- **授權邊界（不能破）**：整個 repo 是 AGPL-3.0，包含所有 Kit；不提供商業授權，貢獻者依 AGPL 進來、不簽 CLA。`format/` 和 `docs/route-format.md` 維持 Apache-2.0，裡面不能引用 AGPL 的程式或模型。
- **伺服器只是主網的加速**：完全開源，沒有私有程式。接不接後端由 `site.js` 決定：主網（climbio.app）接，**其他網域（自己架的站、本機預覽）預設不接**（`backend: 'none'`，Studio 也照這個設定不登入、不發佈）。新功能先要在沒有伺服器時能用；要用後端的功能加進 `Backend.caps`，不把 Firebase 專屬的東西寫進核心流程。

## 工作原則

- 架構用第一原理分析；程式遵循 DRY、KISS、SOLID、YAGNI。架構要簡單，一次修改只動一筆資料。遵循既有約定，命名即文件，只替複雜邏輯寫註解。
- **相容性**：公開的開放格式（`format/`）與各 Kit 的公開 API 採**語意版本**：不相容的改動要升主版本，並且先提設計案；相容的新增升次版本。App 自己的內部資料與沒公開的介面不做向後相容（不留舊格式、搬移程式和相容分支）。
- 不硬編碼密鑰（Firebase 前端設定與 API key 是公開設定，權限由規則控管）；外部輸入要校驗；錯誤要明確處理，不能靜默失敗。
- **零假設**：產品行為、預設值有歧義時，列出選項讓維護者決定，不自己挑。外部資料先用實際資料確認欄位與語意，寫完再用實際輸出核對。
- **能用一次實驗決定的不拿來問**：跑一次、看結果再報結論。演算法的前提先用真實資料量化再寫，不憑印象（岩點、岩館的例子見 [hold-recognition.md](hold-recognition.md) 的「演算法的前提」）。
- 每一行 diff 都要對應明確的需求：沒點名的特性、彈性、抽象不加，不順手重構無關的程式。無關的死碼只提醒不刪；自己改動產生的孤兒要清乾淨。commit message 寫「改了什麼、為什麼」。
- 只寫「現在是什麼樣子」，不寫歷史、改版紀錄和日期（歷史看 git log）。

## 共用的程式規則

- 不用瀏覽器的 confirm／alert／prompt，一律用 App 的對話框（`askConfirm`、`showAlert`、`askText`）。
- **函式參數不要跟同一個檔案的模組層級名稱同名**：避免遮蔽變數導致少數分支才失敗；修改授權或裝置簽章的程式時，要補對應的真實 API 與失敗情境測試。
- **要使用者回報的診斷訊息要一鍵複製**：用 `askConfirm(診斷文字, { ok: '複製' })`，按下去 `navigator.clipboard.writeText`；診斷是暫時的，查出原因就移除。
- **來源與授權由使用者負責**：工具不判斷照片、路線書、外站資料的來源與授權，不為此新增攔截、題目或檢查；責任寫在服務條款（`terms.html`）與發佈時的聲明。格式要的欄位（`origin`、`license`、`attribution`）照填，使用者轉換、匯入的內容視為使用者聲明有權利。
- **沒有私人發佈**：發佈就是公開（放進開放資料集）；不想公開的用匯出 ZIP 自己託管、附近交換或手動備份。
- 算過的結果要存起來，在岩點階段就算好，不要等到看的時候才算。
- **內部識別字一律用 climbio**（`climbio.*`、`climbio-db`、`CLIMBIO_*`、`climbio-v…`）；舊名 `spraywall` 只剩 `js/rename.js` 搬舊資料。
- 介面、文案、長時間工作的過場一律照 [style.md](style.md)（第 7 節文字、第 8 節檢查清單）。

## 驗證

| 改動 | 必跑 |
|---|---|
| 任何程式碼 | 開發階段提交前跑 `node tools/check.mjs`；推正式版／`main` 前跑 `npm run test:quick`＋受影響的案例；只動單一產品時用 `npm run test:product -- <產品> --e2e`（[development.md](development.md)） |
| 介面 | 本機預覽用手機寬度實際操作並截圖（[style.md](style.md) 第 8 節） |
| 較長的介面文字 | 手機寬度打開，在 console 載入 `tools/textfit.js` 後跑 `await textFit()` |
| 岩點、顏色、標籤的演算法 | 用實際的牆比較改前改後（數字或截圖） |
| 路線書轉換 | `npm run eval:convert` 比較固定測試組的數字（`tests/convert/`） |
| 開放格式、Kit 的公開 API | 對應的 Kit 測試（`npm run test:product -- kits`）；不相容的改動升主版本 |
| 行為改動 | 對應的 docs 和 README 已更新 |
