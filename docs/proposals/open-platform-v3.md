# Open Platform V3 — Format / Kits / Storage

> **架構方向已確認，對外相容性需測試才可宣稱。** 以現有 [format v2](../../format/README.md) 為準；本文件不直接修改 Schema 或元件 API。

## Goal

任何開發者或岩場資料作者，能在不部署 Climbio 官方後端、不登入官方帳號的情況下，建立、驗證、顯示、編輯、保存及交換攀岩資料。

## Single Source of Truth — Open Format v2

既有 [format/README.md](../../format/README.md)、[VOCABULARY.md](../../format/VOCABULARY.md) 和 JSON Schema 定義資料契約，不另外引入 Studio 專屬公開格式。

- **view**：照片／向量／地圖；照片座標是像素，地理座標 WGS84（經度在前）。
- **layer**：疊加於 view 的標註、路線、Topo，引用底層節點而非複製資料。
- **set**：照片群、岩館、區域、Guidebook、總目錄，可遞迴組合。
- **nodes / marks**：路線／岩點／Bolt／岩壁等語意，以及 Point、LineString、Polygon 等幾何。
- **ownership / provenance**：license、attribution、author、source、derivedFrom；參考來源權利不可因匯入或輸出而消失。
- **extensibility**：不認得的新 type／props 可忽略；核心結構變更才考慮版本升級。

### 多照片關聯

每張照片保留自己的 id、像素座標、可獨立查看的 view；以 set（例如 type: photos）的 items 及對齊 links 組成照片群。跨照片路線引用外部 id，不破壞既有岩點 id，也不要求合併成巨大圖片。

### 修改與版本

view 是相對穩定的來源，常修改的路線／Topo 放 layer；已存在的引用不可因 UI 重新編排而改變。使用者應能匯出和重新匯入，保持 id、座標、署名及授權。不得以「檔案較新」為唯一跨來源覆寫準則；不同作者／來源撞 id 時要保留或明確解決衝突。

## Open Kits

| Kit | 主責 | 公開元件 | 不負責 |
|---|---|---|---|
| [RouteKit](../../routekit/README.md) | 室內岩點、路線顯示與定線 | RouteViewer / RouteEditor, Web Components | 帳號／儲存／發布 |
| [TopoKit](../../topokit/README.md) | 戶外 Topo 顯示與線段編輯 | TopoViewer / TopoEditor, Web Component | Guidebook 版本／雲端 |
| [MapKit](../../mapkit/README.md) | 岩場地圖與地理幾何編輯 | MapViewer / MapEditor, Web Component | 地理位置的真實性驗證 |
| [HoldKit](../../holdkit/SPEC.md) | 岩點輪廓和影像精修相關幾何 | 函式層能力，視具體 API | 強制與上述 Viewer/Editor 同形介面 |

**Viewer**：只讀顯示，支援 resize、zoom、選取、無後端運作；不需要編輯權限。  
**Editor**：在本地維護編輯與 undo/redo，輸出變更或 layer，由宿主保存。  
**App / Studio**：使用 Kit，負責專案、權限、發布、通知與編輯 UI 的跨模組協調。  
**Storage Adapter**：接管 IO，不能嵌入 Viewer／Editor 的核心。

### 組合契約（擬定，不改既有 API）

為多元件工作台定義**宿主層**的共同 selection，而不是強行更動各 Kit 公開介面：

- selection = { viewId, nodeId?, layerId? }，所有值均取自 Format v2。
- 選取及變更由宿主轉譯為各 Kit 的現有事件。
- 宿主以單一資料狀態為準，元件不直接讀寫彼此內部 state。
- 新 adapter API 先在示範中驗證，獨立 Review 後再考慮發布為穩定 API。

### Web / Third-party Integration

- 支援純 HTML + ES module / Web Component 的獨立 Demo，無 Firebase。
- 套件有 TypeScript 型別、清楚 README、版本／相容性說明。
- React、Vue 等框架可直接使用 Web Component 或寫輕量包裝；原生 Android / iOS 需透過 WebView 或各自重寫，不宣稱 JS 元件原生跨所有平台。
- 範例要在相容的不同網站來源、不同 viewport 和離線條件下驗證。

## Storage & Publishing

可支援的載體：本機 JSON + 照片、資料夾、ZIP、HTTPS 靜態網站、Google Drive／物件儲存等適配器。

- **Read**：從 File／ZIP 或符合條件的 HTTPS URL 載入，驗證格式、大小、類型、hash（如有）；忽略陌生擴充欄位。
- **Write**：先產生可獨立驗證的標準檔案，再交由宿主保存。失敗保留未發布本機版本。
- **Publish**：公開之前顯示內容、來源、授權、照片及相機 GPS／方向等敏感資料；取得明確同意後才傳至儲存端。
- **Resolve**：相對 href 必須以所在 JSON 的目錄為基準，防止路徑穿越；遠端只使用 HTTPS 和正確 CORS，不能假設任何私人雲端網址都可公開讀取。
- **Unpublish**：只移除相應平台的公開索引／副本；不能聲稱能撤回他人已下載的內容。

官方 Firebase 可以提供便利服務，但只是**可選 Adapter**，不可成為格式或 Viewer／Editor 必要依賴。

## Data Rights / Security

- 程式授權與使用者內容授權分開。Format 維持 Apache-2.0；RouteKit、TopoKit、MapKit 等 Kit 為 AGPL-3.0，以各自 LICENSE／NOTICE 為準；主專案及偵測模型依原授權；品牌素材 CC BY 4.0。
- view 的 origin 應符合現行格式要求：自己的照片或確實取得授權的照片才可公開。紙本 Guidebook／來源不明素材可以本機私用但不得繞過發布檢查。
- 不自動上傳 GPS／EXIF；拍照點和岩壁位置不是同一件事。
- JSON 字串只能當作資料與文字，不解析為 HTML／執行腳本；外部圖片與 SVG 應以安全的圖片方式顯示。
- 編輯／驗證不依賴網路；遠端下載及首次安裝／資源快取依環境而定。

## Non-Goals

- 不另創 Open Format v3 或導入必須連網的中央 registry。
- 不承諾跨服務的即時雙向同步、多人協同編輯、跨原生平台「零改動」。
- 不強迫第三方使用 Climbio UI、Logo、帳號或主網 URL。

## Tasks / Verification / Exit

1. 以現有 v2 fixture 進行格式 round-trip、跨照片引用、layer 合併、未知詞彙、授權保存與衝突測試。
2. 各 Kit 提供獨立 viewer／editor demo，至少一份不連官方服務的完整範例。
3. 建立跨元件選取的宿主示範，驗證 Map↔Topo↔Route 清單的雙向聚焦（只實作需要的組合，不耦合核心）。
4. 驗證 ZIP、靜態 URL、本機編輯及可選發布 Adapter；測試無網路／無後端場景。
5. 補齊 API、事件、型別、版本、授權、安全及第三方整合文件。

**退出條件**：第三方只按照文檔即可在獨立網站讀取 v2 範例、顯示並編輯至少一種路線、重新驗證輸出，且不依賴官方後端。

**Review Owner**：Format 與 Kit 維護者 + 獨立安全／授權 Review；涉及公開 API／Schema 的 PR 需獨立、不可與 Studio UI 的 PR 混在一起。
