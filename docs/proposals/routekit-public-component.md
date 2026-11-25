# RouteKit 公開元件：統一 UI、擴充與發布

狀態：設計規格（尚未實作或發布）。適用範圍：RouteKit、岩點貓的室內 2D 看線／定線、RouteKit iframe／WebView。Topo、地圖、3D 與其他 Kit 暫不遷移；既有 3D 及牆面編輯行為不得退化。

## 1. 邊界

RouteKit 是可獨立使用的公開元件，Climbio（包含岩點貓）也是它的使用方，不是執行時依賴。

- RouteKit 負責所有室內 2D 看線、定線 UI 與手勢：繪圖、取景、縮放、平移、點選、重疊選點、長按、自由畫、放大鏡、定線工具列、順序與回饋。通用的岩點外框調整 UI（選取、拖頂點、畫圈、取消、完成、重描按鈕的狀態）亦在 Kit；不含辨識演算法。
- 使用方提供照片、岩點、路線、規則選項與資料更新介面；負責帳號、資料儲存、牆面擁有權、跨路線導覽資料、同步、公開發佈。RouteKit 不 import App 的 js/、HoldKit、HoldScan、AppKit、Firebase 或任何特定站台。
- HoldKit／HoldScan 負責牆面資料生成與 AI 重描；岩點貓透過公開 hook 接上 HoldRefiner，不讓 RouteKit 知道模型、網路或 App 狀態。
- 預設自由畫只改 route.shapes；修改牆的岩點檔須有使用方明確提供的能力與儲存介面。Kit 不自行修改持久化牆面，既有岩點 id 與舊路線的相容性由使用方保留。

## 2. 同一套控制器，三種使用方式

`RouteScene + RouteViewer / RouteEditor + EditorUI` 是唯一的 UI 與手勢來源。現有純函式 API、Web Component 保留；不另造一個 editor。

| 使用方式 | 接線 |
| --- | --- |
| 岩點貓 | 使用上述控制器及公開 hook，提供本機資料、語言、震動、儲存、HoldRefiner |
| 其他可相容授權的前端 | 直接引用套件或 Web Component；使用相同 hook |
| iframe／WebView | 同一套控制器；薄層將 hook 與資料更新轉成版本化訊息，外層可接自己的儲存與增強功能 |

岩點貓現況是 js/mobile.js 自行辨識長按、平移與縮放，js/edit.js 自行接點選與單點編輯，僅共用部分 RouteKit 規則和 EditorUI；這不是完成態。遷移後 2D 定線模式只能由 RouteKit 擁有這些事件，不得同一 canvas 同時有兩套定線手勢。岩點貓的跨頁導覽及 3D 手勢暫留在 App，透過明確的模式切換避免互相攔截。若須先抽取共用 gesture controller，RouteEditor 與岩點貓的過渡接線均使用同一份，不複製 timer 或命中判斷；最終 2D 接入 RouteEditor／RouteViewer。

## 3. 公開擴充契約（擬定）

在既有 RouteEditor options 上相容新增；以下是設計名稱，實作時以 index.d.ts 與測試為準。

| Hook／方法 | 責任 |
| --- | --- |
| onLongPress(context) | 已辨識的長按，提供照片像素 x/y、hitHoldId（可無）、routeId、目前定線類型與 pointerType；可觀察，不需重新綁 pointer |
| holdEdit 能力（opt-in） | 允許 Kit 以自身 UI 開啟岩點調整；預設關閉。不提供時維持目前長按空白自由畫行為 |
| onRefineHold(request, signal) | 選用非同步 AI／其他外框處理，回傳候選多邊形；沒有 hook 時仍可手動調整，不出現無功能的重描鈕 |
| onHoldEditCommit(change, signal) | 只有具牆面修改能力的宿主才接；宿主決定是否接受，保留 id 並更新資料；Kit 顯示成功、取消或拒絕 |
| setHolds(holds) / setRoute(route) | 使用方換入資料，Kit 更新 scene、命中區與快取；沿用既有 setRoute，新增 setHolds 前先確認型別與實作 |
| onChange / onDone / onCancel / onOrderAsk / onView | 沿用現有語意；新增功能不破壞現有使用方 |

長按分派固定：順序模式且按中有編號岩點優先 → 啟用 holdEdit 時進入共用岩點調整 → 未啟用時依既有 draw 選項在空白自由畫 → 其餘不動。長按計時、移動容差、多指取消、pointercancel 與抑制 click 都只有 Kit 決定。外層只提供能力、資料與結果；不讓非同步 hook 阻塞手勢或重複接管 pointer。既有岩點、空白、新補岩點分開處理；不允許模型結果直接刪除他人舊路線指向的岩點。Kit 驗證候選幾何（有限數值、照片範圍、頂點與大小限制），拒絕或失敗時保留手動畫結果；取消恢復快照，過期回覆不得覆蓋新牆、新路線或新編輯。

## 4. iframe／WebView

公開通用內嵌頁與官方發佈介面分離，內嵌頁本身只做 UI、資料讀取／交換與訊息橋接。外層不能注入 JS、不能直接存取內部 DOM；擴充只能透過明確列出的 JSON 訊息。

- 保留既有 v1 頁、既有訊息與公開發佈行為，避免現有岩館整合被打壞。通用靜態包若移除官方限定來源或改變 submit 語意，作為 v2；訊息外框沿用 { climbio: 'routekit', v: 2, type, … }。
- init 支援自備的公開格式 v2 view、layers、照片（明確定義可接受的編碼、尺寸和大小），或使用方提供的 HTTPS 資料網址；同站相對網址可用。網址讀取需 CORS、credentials omit、禁止任意轉發代理、拒絕不安全協定與憑證型 URL、驗證重導及資源大小。私有資料由宿主自行讀取後傳入，不把 token 或私密網址傳給第三方。
- 以 options 宣告能力（holdEdit、refine、wallEdit）；未宣告時無額外請求。longPress 是觀察事件；refineHold、holdEditCommit 為請求事件，帶 requestId、sessionId、routeId、holdId／候選外框及需要的照片座標。宿主以 refineHoldResult／holdEditResult 回覆，僅接受當前未完成請求。資料內容使用公開格式 v2 的穩定結構或明確定義的照片像素座標，不將 JS 函式跨 frame 傳輸。
- 兩端的來源與視窗驗證、訊息版本、能力檢查、資料 schema、尺寸限制及 requestId 都是必需；原生 WebView 另由宿主限制允許載入的頁面／導覽及 bridge。取消、換牆、換線、destroy、逾時（有上限）都清除等待狀態；遲到、重複或錯誤來源回覆忽略。照片不因長按自動傳送。
- Kit 與 iframe 使用同一種 hook 語意與失敗回退，不能另造手勢或選點規則。iframe 內的資料變更輸出既有 change／done 的公開格式 v2 圖層；牆面變更另走明確的 wallEdit 契約，不混成路線私有外框。
- 公開寫入由選用的 Climbio 發佈適配層處理；通用包不載入 App Check、不呼叫 Climbio API。官方入口可組合該適配層保留既有服務。自架通用包使用方可自行儲存或另接自己的服務；不為了發佈而把私鑰寫入前端包。

## 5. 發布（第一個樣板）

保留同一 GitHub repo、同一份原始碼。只對 RouteKit 建立這次完整發布樣板，其他 Kit 不拆、不各寫一套。

- 直接整合：`@climbio/routekit` 的既有 package.json、ESM／CJS、型別與 Web Component。使用 npm pack 檢查交付內容，再發布固定語意版本；是否已上 registry 另行確認。
- 內嵌整合：從同一版本 Kit 產生完整靜態 ZIP（HTML、JS、樣式、型別／協定、LICENSE、NOTICE、原始碼或對應原始碼取得方式）；全部相對資源路徑，可放任意相容靜態主機，使用方不必經 Climbio。以 GitHub Releases 固定版本發布；官方託管只是便利入口。需要公共 iframe 託管時選明確允許的靜態主機，不假設 JS CDN 能正確提供 HTML。
- 同一支發布工具從宣告式清單產生 npm 包、靜態包與校驗資訊；沿用 tools/build-embed.mjs，不在每個 Kit 各造 pipeline。先讓 RouteKit 通過全部驗證，再複用給其他有外部用途的 Kit。
- AGPL 授權保持不變，套件直連須遵守相容的授權義務；獨立 iframe／WebView 透過公開訊息交互，不假定整個宿主一定免除授權義務。保留授權、第三方聲明及對應原始碼提供方式。資料授權與程式授權分開。
- AppKit、SourceKit 仍開源，這階段不做獨立對外發布；Topo、Map、3D、牆面偵測的公開包另階段處理。正式發布、npm 發布、公開 repo 推送不屬本次設計交付。

## 6. 實作順序與驗收閘門

1. 固定現有 RouteEditor、岩點貓、iframe 的長按／縮放／重疊點選／順序測試；定義公開 hook 型別及共用手勢控制器。
2. RouteKit 增加可選的岩點調整 UI 及擴充點；預設行為保持不變。岩點貓接上 HoldRefiner、牆面資料、儲存、取消與導覽；移除 2D 定線重複手勢及 UI。不改 3D 的既有行為。
3. 通用 iframe／WebView 僅做 bridge；新增自備資料、能力宣告、請求／回覆、安全與逾時；保留 v1。
4. 產生同版 npm pack 與靜態 ZIP。以全新外部專案安裝測試，將 ZIP 放另一個 origin，封鎖所有 Climbio 網域並提供自備資料；本機看線、定線、長按手動補點、宿主 hook 回傳外框、取消及儲存全部成功。另測 hook 拒絕／逾時／切換路線、錯誤來源／重複回覆、觸控／滑鼠／多指、WebView 橋接、官方 v1 發佈既有相容性。
5. 檢查 2D 定線只有一套事件所有權；確認 Kit 沒有品牌、App 狀態、後端與模型依賴。更新雙語 README、docs/embed.md、gym-onboarding.md、公開 API 型別、網站給人的元件摘要。執行 node tools/check.mjs、受影響 unit/e2e 與發布前 npm run test:quick。

完成定義：岩點貓不再自行辨識 2D 定線長按，外部 App 直接引用及 iframe 都能用同一份 Kit 並透過同一語意擴充，Climbio 停止服務時通用靜態包及已安裝的套件仍可用（使用方須備妥資料）。官方公開發佈服務不在這項可用性保證內。
