# RouteKit 公開元件重構｜Agent 交接

日期：2026-11-25。目標分支：dev。此文件為未完成實作的交接，不代表功能已合併、測試已通過或已發布。

## 規格與工作範圍

以 [RouteKit 公開元件設計規格](routekit-public-component.md) 為唯一設計基準。RouteKit 是第一個對外發布的樣板；Climbio（岩點貓）也是使用方。統一 2D 看線、定線 UI、手勢及擴充契約，原生套件與 iframe/WebView 使用相同核心。宿主只接資料、儲存、岩點重描及官方發佈等能力，不另綁定 2D 定線手勢。Topo、Map、3D 及其他 Kit 暫不遷移，保留既有 3D、牆面編輯及 iframe v1 行為。AppKit/SourceKit 不需要單獨發布。

## 上一工作階段狀態

- 上一階段報告已準備共用長按辨識器、onLongPress hook、岩點貓接線修改腳本及局部測試，報告 10/10 單元及隔離測試通過。
- 因當時執行環境不能 clone 私有 repo，並未提交實作至 dev，也沒有執行完整整合測試。完整 UI 遷移與 iframe 雙向 hook 尚未完成。
- 上一階段的 routekit-refactor-phase1.zip 目前未能從當前執行環境或檔案搜尋取回，故本 PR 不含該 ZIP 或其程式碼及測試紀錄；10/10 是先前回報，不是本 PR 的可重現驗證。若可從原對話下載 ZIP，先核對基準版本、檢查差異並重跑測試；否則依下列規格重新實作。不要假設補丁已存在於 GitHub。
- 本次僅新增交接文件，不變動產品程式碼或發布設定，不合併 dev。

## 接手實作順序

1. 拉最新 dev 並檢查設計規格、AGENTS 指引、package.json、現有測試及相關變動；不要覆蓋其他工作階段。以 RouteKit 的 RouteEditor/RouteViewer（viewer.js）、EditorUI、公開入口與 index.d.ts、岩點貓 js/mobile.js、js/edit.js 為起點，定位實際路徑及事件所有權。
2. 把長按辨識集中於 RouteKit：pointer id、單指移動容差、計時器、第二指取消、pointerup/cancel、lostpointercapture、失焦、contextmenu 與長按後 click 抑制。計時參數以既有行為及測試為準，不任意改 UI。建立可解除註冊的 controller，保證一次觸發、取消後無殘留。公開 onLongPress(context) 以照片像素座標、hitHoldId、routeId、模式、pointerType 等資料通知宿主。長按順序模式優先，holdEdit opt-in 次之，未啟用時保留既有空白自由畫。不要讓 hook 非同步結果接管 pointer 或阻塞辨識。
3. 將岩點貓 2D 定線 UI 接至同一 RouteEditor/RouteViewer，最終移除其獨立 2D 長按 timer、點選/平移/縮放控制與重複修點 UI；保留 App 導覽及 3D 手勢，明確區隔模式所有權。RouteKit 的通用修點 UI 使用 onRefineHold(request, signal)、onHoldEditCommit(change, signal)；岩點貓在外層呼叫 HoldKit MobileSAM，Kit 不 import 模型、AppKit、Firebase 或 App js。手動路線自由畫不修改牆面原始岩點。驗證候選幾何、ID 穩定、取消快照、拒絕與過期回覆。資料更新介面和型別依既有 API 調整。
4. 建立通用 iframe v2 薄 bridge：以同一套 Kit 對外提供 init、change/done、longPress、refineHold/refineHoldResult、holdEditCommit/holdEditResult 等版本化訊息；能力宣告、origin/source 校驗、requestId/sessionId、schema/size、逾時、取消及 stale/duplicate response 必須測試。支援自備資料及符合 CORS 的 HTTPS 資源。官方公開發佈適配層獨立，通用包不載入 App Check 或依賴 Climbio；既有 v1 保持相容。
5. 以現有 tools/build-embed.mjs 擴充共用發布流程，從同一版本產生 npm pack 及可自架的完整靜態 ZIP（相對資源路徑、授權、對應原始碼方式、型別/協定與 checksum）。僅 RouteKit 做第一個樣板，不另為各 Kit 建 pipeline。GitHub Releases 為固定版本靜態包的發布入口；Climbio host 只是選用便利入口。AGPL 與資料授權義務維持。正式發布與部署不在本次交接授權內。

## 驗收清單（均需重新驗證）

- [ ] 既有 RouteEditor、岩點貓與 iframe v1 的回歸測試。
- [ ] 長按 unit：短按、正常長按、多指、拖曳、pointercancel/lost capture、失焦、滑鼠/觸控、解除註冊、click 抑制及一次性分派。
- [ ] 長按順序模式與空白自由畫；手動修點、AI 重描成功/拒絕/取消/過期；牆面 ID 與舊路線相容。
- [ ] 岩點貓室內 2D 定線只有一套手勢所有權；3D 與牆面編輯不退化。
- [ ] iframe v2 真實跨 origin 資料與 hook 來回；錯誤來源、非法資料、逾時、換牆/線、重複回覆拒絕；v1 仍可運作。
- [ ] npm pack 安裝於乾淨外部專案；靜態 ZIP 解壓至非 Climbio origin。封鎖所有 Climbio 網域，以宿主自備資料測看線、定線、手動補點、hook 及宿主儲存均成功。
- [ ] node tools/check.mjs、受影響 unit/e2e、npm run test:quick；記錄命令、結果及剩餘問題，既有失敗與新回歸分開。
- [ ] 更新雙語 README、docs/embed.md、gym-onboarding.md、公開 API 型別及網站給人看的元件摘要。

接手 Agent 可直接在本 PR 分支繼續實作；如 dev 已有新變更，先同步並重新驗證。未通過驗收前保持 draft，不自動合併或部署。

## 進度（接手後）

日期：2026-11-25。補丁 ZIP 取不回，依規格重做第一階段，以下是本分支實際提交且已驗證的部分：

- 已完成：`routekit/viewport.js` 新增 `LongPress` 控制器（單一主要指標、8 px 容差、第二指／放開／`pointercancel`／`lostpointercapture`／失焦取消、一次觸發、`armClick`、`destroy`）；`RouteEditor` 改用它並新增 `onLongPress` 觀察 hook；岩點貓 `js/mobile.js` 的定線長按改用同一個控制器（`delay: 500`，條件不變）；型別、雙語 README、內嵌頁 kit 副本（`node tools/build-embed.mjs`）已同步。
- 測試：`tools/longpress.test.mjs` 12/12；`node tools/check.mjs` 全過；`hold`＋`kits` 的 Node 測試 239/239；`routekit`、`embed`、`hold-edit`、`hold-interactions`、`seq-tap`、`wall-phone`、`route-card` 瀏覽器案例 107/108。
- 既有偶發失敗（與本改動無關，改動前同樣出現）：`embed.spec.mjs:263`（拖曳放開不選岩點，改動前 6 次失敗 3 次）、`author-routes.spec.mjs:61`（改動前 3 次失敗 1 次）。
- 未完成（驗收清單其餘項目都還沒做）：岩點貓 2D 定線的點選／平移／縮放與修點 UI 遷到 RouteEditor（`js/edit.js`、`js/mobile.js` 仍有自己的手勢）、通用修點 UI 與 `onRefineHold`／`onHoldEditCommit`、`holdEdit` opt-in、iframe v2 bridge、npm pack ＋靜態 ZIP、外部 origin 與封鎖 Climbio 網域的獨立性測試、`docs/embed.md`／`gym-onboarding.md`／網站摘要、`npm run test:quick`。
- 在 Windows 直接跑 Playwright 要設 `CLIMBIO_E2E_PYTHON=python`（`python3` 是商店替身）。

### 第二批（同一分支）

- 已完成：`embed/shared/embed.js` 新增 v2 共用層——`connect({ v: 2 })` 訊息外框、`capsOf`（能力宣告）、`createRequests`（requestId／sessionId、逾時上限 60 秒、取消、換牆換線清除、遲到與重複回覆忽略、AbortSignal）、`urlV2`／`fetchV2`（自備 https 資料網址，不帶 cookie、驗重導與大小）；`routekit/geometry.js` 新增 `candidatePoly`（候選外框驗證）；`tools/release-routekit.mjs` 產生 npm 包、靜態 ZIP（相對路徑、授權、SOURCE.txt、型別）與 SHA256SUMS，只產檔不發布。
- 測試：`tools/embed-v2.test.mjs`、`tools/release-routekit.test.mjs`（含乾淨資料夾安裝 npm 包）通過；`npm test` 全部 Node 測試過。
- 仍未做：v2 內嵌頁本身（用上述共用層把 RouteEditor 的 onLongPress、refineHold、holdEditCommit 轉成訊息，目前只有共用零件，沒有頁面）；通用修點 UI 與 `holdEdit` opt-in；岩點貓 2D 定線點選／平移／縮放遷到 RouteEditor；跨 origin 且封鎖 Climbio 網域的獨立性測試（要等 v2 內嵌頁才有東西可測，v1 頁只收官方網址）；`docs/embed.md`／`gym-onboarding.md`／網站摘要；`npm run test:quick`。

### 第三批：v2 通用內嵌頁

- 已完成：`embed/routekit/v2/`（`index.html`、`app.js`、`messages.d.ts`）。資料自備（`view`／`layers`／`photo`｜`photoBase64`｜網址）、`capabilities` 宣告、`longPress` 通知、`refineHold`／`holdEditCommit` 請求與 `refineHoldResult`／`holdEditResult` 回覆（requestId、sessionId、種類比對、逾時 15 秒、換牆換線取消、遲到與重複忽略）、候選外框經 `candidatePoly` 驗證、頁內調整列與候選預覽；不載入 App Check、不呼叫 Climbio；v1 不動。`tools/build-embed.mjs` 同一份 Kit 複製到 v1、v2 兩個 `kit/`；`tools/release-routekit.mjs` 的靜態 ZIP 改裝 v2 頁；`docs/embed.md` 補 v2 一節。
- 測試：`tests/e2e/embed-v2.spec.mjs` 8/8（自備資料、https 網址、http 網址拒絕、v1 init 忽略、無能力時不發請求、重描→套用→接受、錯 session／超出照片／重複／拒絕、換路線作廢、發布的 ZIP 解壓放在另一個 origin 並封鎖所有其他網域）；`tools/embed-v2.test.mjs` 14/14；`npm test` 716/716。
- 既有失敗（與本改動無關，PR 最初提交 116f0ce4 就失敗）：`static-parity.spec.mjs` 5 個逐像素比對案例。
- 仍未做：岩點貓 2D 定線的點選、平移、縮放與修點 UI 遷到 RouteEditor（`js/edit.js`、`js/mobile.js`）；岩點貓端的 HoldKit 重描接到 `onRefineHold`；v2 頁目前只有頁內簡易調整列（不是岩點貓那套修點 UI）；`gym-onboarding.md`、網站元件摘要；npm pack 的「乾淨外部專案」已測安裝與 import，尚未測在真實外部 App 的打包器；`npm run test:quick`。

### 第四批：文件與既有失敗

- 已完成：`docs/gym-onboarding.md` 第 2 步補「自備資料、不經過 Climbio」（v2 頁）；網站 RouteKit 頁（`kits/content/routekit.mjs`，zh／en）補通用版內嵌頁摘要並重新產生 Kit 網頁；`npm run test:quick`（嚴格檢查＋全部 Node 測試）通過，716/716。
- `tests/e2e/static-parity.spec.mjs`：測試本身過時（對 v1 頁送內嵌資料、內嵌頁已固定暗彩）。改成對 v2 頁送 `photoBase64`、岩點貓也用暗彩後，5 個案例從全失敗變成 3 過 2 失敗；剩下 2 個（看路線圖、看路線圖有出手順序）壞像素比例 0.93%／0.96%，門檻 0.8%，差異在暗彩光暈的粗細（岩點貓與 RouteViewer 繪製不同），不是本分支造成；沒有放寬門檻。

### 第五批調查：2D 定線遷移的前提（尚未改程式）

- 岩點貓的點選與重疊選點規則已經共用 Kit（`tapHold`、`prepareOverlapPick`、`pickOverlap`、`orderSession`）；`js/edit.js:42-116` 只剩外層調度，沒有第二套規則。
- `RouteEditor` 自己擁有畫布、場景與 `Viewport`（建構時就 `render()`）；岩點貓的畫布由 `js/draw.js` 的 `render()`、`js/wall.js` 的 `view`、`flyTo`、`W3D` 擁有。要讓 RouteEditor 接管點選，就得讓它接管整個 2D 定線畫面，不能只換點選。
- `js/mobile.js:130-345` 的平移、縮放、左右滑、下拉返回、圈起來、拖頂點與點選共用 `gesture`／`suppressClick`；3D 重疊選點（`W3D.reveal`）RouteEditor 沒有對應功能。
- 可行方向：只在 2D、非 3D、非修點、非圈起來的定線模式用 RouteEditor（另一張畫布），其餘維持現狀；需要實機（OPPO CPH2339，`tools/phone.mjs`）逐項驗證手勢。這是產品取捨，需先決定。

### 第六批：長按修點改成 Kit 的選用功能

- 決定：不遷移岩點貓 2D 手勢（見上一節）；改把修點做成 `RouteEditor` 的選用功能。
- 已完成：`routekit/viewer.js` 新增 `holdEdit`（預設關）、`onRefineHold(request, signal)`、`onHoldEditCommit(change, signal)`、`lang`、`setHoldEdit()`、`endHoldEdit()`；調整列、候選外框預覽、`candidatePoly` 驗證、取消／換線／`destroy` 中止 `signal` 都在 Kit；沒給 `onRefineHold` 沒有重描、沒給 `onHoldEditCommit` 只能預覽。v2 內嵌頁刪掉自己的調整列與疊加畫布，只把兩個回呼轉成 `refineHold`／`holdEditCommit` 訊息。型別、雙語 README 已更新。
- 測試：`embed-v2.spec.mjs` 16/16（android-chromium＋ios-webkit，原有案例未改）；`npm run test:quick` 716/717 通過、0 失敗；`routekit.spec`、`embed.spec` 在 android-chromium 38/39，失敗的是既有的 `embed.spec.mjs:263`。
- 仍未做：岩點貓端接 HoldKit 重描（可選，傳 `holdEdit: true` 即可）、npm 包在真實外部打包器的測試、Android 實機驗證（岩點貓本身未改動，無需）。

### 第七批：外部打包器與岩點貓重描

- npm 包（`tools/release-routekit.mjs` 產生的 `.tgz`）在乾淨資料夾安裝，用 esbuild 打包：ESM（`import`，瀏覽器目標）與 CJS（`require`，Node 目標）都能打包並執行，`RouteEditor`、`candidatePoly`、`setHoldEdit`、`endHoldEdit` 都在；`tsc --strict` 對 `HoldEditOptions`／`HoldEditRequest`／`RouteEditor` 型別檢查通過。本機暫存測試，沒有加進版控。
- 岩點貓重描：不需要接 `onRefineHold`。岩點貓自己的修點已經直接呼叫 `HoldRefiner`／MobileSAM（`js/edit.js` 的「重描」鈕與圈起來），不經 `RouteEditor`；`onRefineHold` 是給外部 App 與 iframe 宿主用的。岩點貓若日後改用 RouteEditor 的修點，才需要在外層包一層呼叫 HoldRefiner。
