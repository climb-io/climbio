# Climbio Studio — 共用工作台設計規範

> **現行產品分界（2026-11-16）**：`/studio/` 是正式天然岩場 Guidebook 編輯入口，以 Crag 為主要工作區；岩點精修與 3D 牆編輯工具仍存在，但首頁將其歸在 `/lab/` 研究入口，並非已完成的正式 Wall Studio 發佈流程。`/studio/` 已取代 `/find/`、`/author/`。
> 下面「Shared Studio Shell」的左樹／中央畫布／右 Inspector 是目標版面，還沒做；已做的見「首頁與新專案」「步驟列」。
> 品牌唯一來源：[brand.md](brand.md)；格式唯一來源：[format/README.md](../format/README.md)。

## Goal

**Climbio Studio** 是唯一的正式內容工作台，目前對外提供一個主要工作區：

- **Crag 工作區**：匯入岩壁照片、GPS 輔助地理標定、岩場／岩壁／路線管理、Topo、Guidebook 維護與發布，供紅點貓與其他 TopoKit／MapKit Viewer 使用。

Studio 是資料製作與長期維護端；岩點貓／紅點貓是手機隨時使用、探索與分享端。所有產出以 Open Format v2 交換，儲存可自由選擇。

## Brand Identity — 已確認

1. **Climbio Studio 不另設計 Logo**。直接引用正式母品牌原稿：
   - \`design/brand/logo/climbio-mark.svg\`
   - \`design/brand/logo/climbio-horizontal-light.svg\`／\`climbio-horizontal-dark.svg\`
   - 需要 PWA 圖示時重用既有 \`design/brand/icons/\` 的正式母品牌來源。
2. 標題以母品牌 Logo **加排版文字「Studio」** 呈現；「Studio」是產品名稱，不是新的圖形、浮水印或重新描繪的字標。
3. **工作區不各自擁有 Logo 或 App Icon**，只作工作區名稱、導航項目與標籤；可用輔助色、文字和內容區分。
4. 岩點貓、紅點貓的正式 SVG 原樣保留；Studio 不保留獨立專業工具角色或 App Icon。
5. 不使用多貓疊影、線稿變身、山峰、掃描框、閃電或外加工具列當作新母品牌標誌。
6. **logo 與 Workspaces 不可混淆**：Climbio 與 Climbio Studio 可共用同一個 Logo，必須依產品名稱、介面及上下文區分。

### Color Tokens

- Studio Shell：以 Climbio 母品牌 \`#F7F9FB\`、\`#08263A\`、\`#B6F000\`、\`#0FADEA\` 為基礎；色碼依 \`css/brand-tokens.css\`。
- Crag 可輔以深海藍；未來增加正式工作區時，應維持共用操作語意。**目前不能宣稱 Crag 與 Lab 已完成相同的三欄 Shell。**
- 資料層的路線類型、起攀／完攀、難度等有獨立語意色，不可由品牌主色任意覆寫。
- 亮色與深色 Shell 可作未來偏好設定，不應因切換工作區而突然替換全部操作方式或讓已開的面板移位。

## 介面語言（繁體中文、英文）

- Studio 的介面有繁體中文與英文兩版（App 另有七種）。語言包在 `i18n/studio/`（共用：首頁、帳號選單、專案資料夾）與各工作區的包：`studio-crag`（介面）、`studio-crag-data`（資料層的訊息與預設名稱）、`studio-wall`、`studio-wall3d`、`studio-convert`；key 依包加前綴（st、cg、cd、hl、w3、cv），多個包同時載入時依序找 key。
- 頁面用 `studio/i18n-boot.js` 載入（`data-packs` 列要載入的包，共用名詞自動加上）；語言依這台的選擇（localStorage `climbio.studio.lang`）或瀏覽器語言，在頁首帳號選單切換，換完重新載入頁面。
- 輸入格式不翻：路線書大綱的標題與欄位關鍵字、匯入表格的欄位別名、給 AI 的提示詞全文維持中文（解析端只認這些），英文介面只在說明裡補上對應。資料層產生的預設名稱（岩壁 N、區域 N…）在建立當下依語言產生，之後就是使用者資料。
- Node 測試用 `tools/studio-i18n.mjs` 載入繁體中文包；Studio 的程式只在呼叫時才查文字，不在載入當下組字串。

## 首頁與新專案（`studio/index.html`、`studio/home.js`、`studio/album.js`）

- **新專案**：以多張照片為主要輸入。拖進或選照片、資料夾、ZIP（ZIP 展開；公開格式的畫面檔、路線表 CSV 一起收），或貼上 **Google 相簿分享連結**（`photos.app.goo.gl`／`photos.google.com/share`，透過擴充功能或 `/album` 雲端函式轉發，下載 `=d` 原始照片並保留完整 EXIF 與 GPS，預設以相簿名稱作為專案名稱；匯入說明與掃描結果無位置時會提醒在相簿「選項」開啟「分享相片位置資訊」）。
- **快速掃描**（幾秒內完成，不做偵測）：讀每張照片檔頭的 EXIF（有沒有拍照位置）、資料夾名稱、機器取的檔名（IMG_1234、iPhone 的 UUID）；過半照片有拍照位置時再抽最多 40 張小圖找紅筆（很鮮的紅色）。
- **列出可以自動處理的選項讓使用者挑**：先依掃描結果選好工作區（過半照片有拍照位置建議 Crag，否則仍進 Crag，可以改），填好專案名稱（拖進一個資料夾用資料夾名），再列這個工作區能自動做的項目（預設都勾，Crag 的描路線只在找到紅筆時預設勾）：

| 工作區 | 項目（有條件的才出現） | 對應 |
|---|---|---|
| Crag | 沒有位置的照片照拍攝時間歸岩壁（有沒位置的照片）、從照片描路線（紅筆、跟原圖相減）、匯入路線表（有 CSV） | 建立時做一次（[studio-crag.md](studio-crag.md)） |

- 按「建立」：檔案和選項放進收件匣（IndexedDB `climbio-studio` 的 `inbox`，`studio/store.js`），轉到 `crag/#inbox=<id>`，工作區取出（取了就刪）建專案。Chrome 拖進一個資料夾時，專案直接存在那個資料夾（按建立時要寫入權限，見下面的「專案資料夾」）。
- **正式編輯入口**：新的 Guidebook（`crag/#new`）、轉換路線書（`crag/#book`，可讀 Word、文字型 PDF、網頁與大綱；見 [guidebook-convert.md](guidebook-convert.md)）、匯入岩場站（`crag/#site`）。`studio/wall3d/` 技術路徑保留，但對外由 `/lab/` 說明，不屬於正式 Studio 新專案發佈流程。
- **最近的專案**：`climbio-studio` 的 `recent`，新到舊，寫著放在哪個資料夾（或「這台裝置的瀏覽器」）；存在瀏覽器裡的可以在這裡刪，資料夾是使用者自己的，不刪。資料夾專案點了先要回授權再打開。
- 工作區頁面沒有專案（網址沒有 `#`）就回首頁；網址是專案 id，重整直接接續。

## 步驟列（`studio/shell.js` 的 `steps`、`studio/shell.css`）

頂列下方一排步驟，點了到那一步；步驟旁的小字是現況。工作區給內容與動作，外殼只畫。

| Crag | 做什麼 |
|---|---|
| 岩場資訊 | 岩場資訊對話框：名稱、署名、難度系統 |
| 區域圖 | 地圖的編輯模式：地圖放寬，調整、畫岩石、岩壁、區域、步道（只有這一步能改地圖）；小字是幾區、幾面 |
| 路線清單 | 只有路線表格（不放區域圖、照片），工具列：復原、新增、搜尋，選到路線才有上移、下移、移到、刪除；難度、種類用選的 |
| 路線圖 | 畫 Topo：先開還沒有圖層的照片；小字是畫過線的路線／全部 |
| 發佈 | 發佈 Guidebook |

Wall 的步驟：牆面、岩點、發佈（見 [studio-wall.md](studio-wall.md)）。

## Shared Studio Shell — Single Interface

### 結構

| 固定區域 | Crag 工作區 |
|---|---|
| Topbar | 同樣位置與語意 |
| Left Project Tree | 岩場／區域／岩壁／路線 |
| Center Canvas | 地圖、照片、Topo、路線 |
| Context Toolbar | 同樣通用工具位置；領域工具在相同插槽 |
| Right Inspector | 路線、Bolt、GPS、來源、授權 |
| Bottom Status | 檢查、版本與發布狀態 |

**共享的不只是 CSS，而是相同的操作邏輯**：選取、批次、編輯、撤銷、保存、審查、發布，全部可預期。

### 一致性與狀態

- 單一 selection 模型；不同 Viewer／Editor 透過宿主適配器交換選取，不能直接操控其他 Kit 的私有 state。
- 主專案、工作區與編輯內容要可分別儲存；切換工作區前提示尚未保存的變更，不默默丟失。
- 共同快捷鍵：Undo／Redo、儲存、縮放、選取規則一致；觸控裝置提供功能等價的可點按控制。
- 同一發布流程骨架：驗證 → 確認來源／授權與個資 → 選擇儲存端 → 輸出 → 取得可讀入口。
- 專業介面的功能品質、錯誤狀態、復原能力優先於動畫。Logo 不變形、不動畫。

### 工作區的分界

**Crag、Wall 是正式 Studio 工作區**；3D 牆維持 Climbio Lab 的研究工具身分。以下為程式分工規則，不代表 Lab 與 Crag 已整合完成同一套正式介面：

- **程式放的位置**：Crag 的在 `studio/crag/`，Wall 的在 `studio/wall/`。共用的 `studio/shell.*`、`store.js`、`publish.js`、`sync.js`、`appkit/` 只放兩頁都用得到、不看工作區的東西；工作區要的差異用參數傳進去，不在共用檔案裡判斷是哪個工作區。
- **首頁匯入**（`studio/home.js`）：工作區的差異在各自資料夾的 `intake.js`（`crag/intake.js`），由 `studio/intake/workspaces.js` 統一成工作區描述（`target`、`groupPrefix`、`newProject`、`suggest`、`options`、`folder`，說明在該檔開頭）。`home.js` 不判斷工作區、不 import 工作區資料夾；共用的分組預覽與放大檢查在 `studio/intake/`。加一個工作區專屬的匯入功能，改該資料夾的 `intake.js`；掛載點不夠用時先在 `workspaces.js` 加一個（預設為空）。
- **樣式不撞名**：新的 class、id 先查 `appkit/ui.css`、`studio/shell.css` 有沒有同名的規則（例如 `appkit/ui.css` 給岩點貓牆面卡片的 `.wall-card:active` 縮放，曾讓 Crag 的岩壁卡片點一下格子就縮）；撞到就換名稱或在自己的頁面明確蓋掉。
- **驗證**：瀏覽器測試除了在該工作區或模式測功能，也要在另一個工作區斷言它沒出現。專屬的元素在另一個工作區是「不存在」，用 `toHaveCount(0)` 斷言，不用 `toBeHidden()`。

**介面文字與樣式**：各工作區的功能都照 [docs/style.md](style.md) 第 7 節；對話框標題、按鈕、選項用名詞或動詞短語，不放說明段落與提示。

### Desktop / iPad

- Desktop：左樹／中央畫布／右屬性，側欄可調整及收合。
- iPad：預設中央畫布，左右面板以抽屜／切換顯示；不得依賴滑鼠 hover、右鍵或硬體鍵盤。
- 狹窄螢幕可瀏覽，重型編輯任務須清楚標示建議桌面／平板，不能提供無法操作的假工具列。

### 3D 牆（`studio/wall3d/`，Climbio Lab 研究工具）

整理照片重建的 3D 牆資料包（見 [3d-wall.md](3d-wall.md)；載入、烘焙用 Wall3DKit）。只做 Chrome：選資料包的資料夾，改完存回同一個資料夾的 `wall.json`，模型、貼圖、岩點標籤不動（修點另外記在 `edits`）。

- 畫面、操作照岩點貓的定線（室內主題）：深色、模型正面滿版，上方浮著圓鈕：左上返回、牆名，右上「切直線」「復原」、螢光綠 ✓ 存檔；下方一顆膠囊是岩點數。沒有側欄、沒有牆面清單（分面是程式內部的分類，岩館人員看不懂哪一項是哪裡）。
- 鏡頭：左鍵拖平移、滾輪往游標那一點縮放、右鍵拖小角度轉（離正面 45° 內）。
- 不分模式：點一下去掉或放回那一塊。點在岩點上是那顆標成不是岩點（再點一次還原），點在牆上是那一面牆隱藏或打開，點在切掉的地方是拿掉那條切線；自動切掉的（地面、天花板、外緣）不給點。去掉的壓暗、照樣看得到才點得回來；游標指到的先鋪螢光綠。岩點的範圍照貼圖空間的標籤畫（跟岩點貓一樣，邊緣不受三角面大小影響）；修過的、新補的岩點沒有貼圖標籤，照三角面。
- 長按（不動 0.45 秒）跟岩點貓一樣修點：長按岩點出現它目前的外框（投到畫面上的凸包）和頂點，拖頂點、拖邊的中點加頂點、點兩下頂點拿掉，✓（Enter）完成、Esc 取消、垃圾桶刪掉（原本的岩點標成不是岩點，補的點直接拿掉）；長按牆面補一顆（先給一個小圓）。修外框時鏡頭不動。
  修點跟岩點貓同一種格式（當時的鏡頭＋畫面上的多邊形，另記畫面長寬比 `a`），存在 `wall.json` 的 `edits`；Studio 裡照面預覽，岩點貓載入時照貼圖像素套上。
- 「切直線」：按下後左鍵在牆上畫一條線，切掉岩點少的那側，畫完回到點選（Esc 取消）。線的兩端要畫在牆上。畫得接近直的（20° 內）切成鉛直、跟牆面垂直的面，接近橫的切成水平面，其他穿過這條線、跟牆面垂直；只切線段範圍內（兩端各往外多 2 成），平面才不會延伸出去切到別處。
- 「復原」（⌘Z／Ctrl+Z）一步一步退回隱藏、不是岩點、切線、修點的改動；⌘S 存檔。
- 懸空物一開始就隱藏（重建流程自動整理：離牆面太遠的、只靠細細一段連著牆的、切完以後跟牆不相連的碎塊），地面、天花板由裁切平面切成直線；岩點大部分在隱藏的面上就不算，規則跟岩點貓同一份（`wall3dkit/stage.js` 的 `goneHolds`）。

## Crag Workspace

**一句話：從多張岩壁照片與地理資料，建立可持續維護的 Guidebook。**

主要流程：匯入照片／GPS／路線資料 → 關聯岩壁 → 地圖／岩壁／路線同步編輯 → Topo → 檢查 → 匯出／發布／更新。

- 拍照點 GPS 不等於岩壁 GPS；推估和人工確認需分開標註。
- 地圖、岩壁照片、路線資料共享目前選取狀態。
- 路線資料與照片中的 Topo 幾何分離；多照片可引用同一路線。
- 支援分叉與共用線段，不為了展示方便破壞路線關係。
- 更新 Guidebook 保留來源、授權、作者及版本，不自行對外公開敏感拍照資訊。

## 範圍與處理位置

- **Studio 的主要工作區是 Crag**；岩點貓、紅點貓是手機端的使用與分享 App，不在 Studio 內。
- **所有處理都在本機（電腦、iPad）完成**：偵測、重描外框、外框整理、Topo 對位。專案存在本機資料夾或瀏覽器私有檔案系統，沒有網路、沒有 Climbio 伺服器也能完整做完並匯出。
- **只有公開分享、資料集發佈、找牆面索引和附近裝置配對訊號才用雲端**，編輯工作檔與一般備份都保存在本機。
- **太重的運算是選項，不是前提**：雲端重運算（重描 `retrace`）只在站台設了 `SITE.cloud.*` 時提供，Studio 預設不連、不依賴。手機端岩點貓的雲端重描照舊保留成選項。

## Open Format / Open Kits Boundary

- 不另創 工作區私有公開格式；使用既有 Climbio Format v2 的 view／layer／set。
- RouteKit、TopoKit、MapKit 的 Viewer／Editor 持續可獨立存在並自由組合；Studio 只是其中一種宿主。
- 儲存採可替換 Adapter：本機、ZIP、靜態網址、相容的遠端儲存等。不得要求使用者先連接官方 Firebase 才能匯出。
- 圖片、Topo 與 Guidebook 的作者及授權不等同程式授權；匯入、發布均保留來源。

## Route / Migration

- **頁首（`studio/shell.js`、`shell.css`，首頁、Crag 共用）**：開發版網站和本機在「Studio」旁邊標 Beta、分頁標題加「· Beta」（網址清單跟岩點貓的 `js/boot.js` 一樣）。最右邊是選單（三個點）：換成另一種語言、最底是版本與環境。Studio 不登入、沒有帳號。
- **/studio/** 是唯一入口，一個 PWA（`studio/manifest.webmanifest` 用母品牌圖示、`studio/sw.js` 範圍 `/studio/`）；首頁的 Studio 卡片連到這裡。`/find/`、`/author/` 已拿掉（頁面、manifest、Service Worker）。
- 多人同時編輯另外做成選用的同步服務（`Backend.caps`），不當本機功能的前提。專案資料夾可以自己用 Dropbox、git、雲端硬碟同步；Studio 本身沒有跨裝置同步（已移除）。

## 專案資料夾

專案資料夾（`studio/store.js` 的 `StudioStore`），工作區只決定裡面放什麼（`studio/crag/store.js`）。讀的 App 從 `index.json` 開始，看 `type` 就知道是哪一種，兩種放在一起也不會撞名。

| 路徑 | 內容 |
|---|---|
| `index.json` | 最上層的組合：`type` 是 `walls` 或 `guidebook`；它的 `id` 就是專案 id（網址的 `#<id>`） |
| `<id>.json` | 其他的組合、畫面、圖層，全部在同一層、用 id 命名（改名、搬分區只改內容，不搬檔案） |
| `<id>.jpg` | 照片：照片畫面的 `href`（匯入岩場站的照原本的副檔名） |
| `.studio/project.json` | Studio 自己用的：`{ v, id, ws（wall／crag）, name, …工作區的設定 }` |
| `.studio/…` | 進度（`progress/<id>.json`）、縮圖（`thumbs/<id>.jpg`）、只在 Studio 用的圖（Crag 的示意圖 `images/<id>`） |

- **放在哪裡**：能選資料夾的瀏覽器（電腦版 Chrome、Edge）放在使用者選的資料夾：選的已經是專案就打開（是另一個工作區的專案會說）；裡面有照片（第一層或子資料夾）就在裡面建 `Climbio Studio/` 當專案、照片一起匯入；空的直接當專案。不能選的（iPad 的 Safari）、或拖進的是照片和 ZIP，放在瀏覽器的私有檔案系統（OPFS 的 `Climbio Studio/<專案 id>/`），建立時要求持續保存（`navigator.storage.persist`）。沒有 `createWritable` 的舊 Safari 交給 Worker 用同步存取寫（`studio/opfs-worker.js`）。
- **一種格式到處用**：資料夾去掉 `.studio/` 就是公開格式（[format/README.md](../format/README.md)），可以直接放上靜態網站、打包成 ZIP 傳給別人。
- 資料夾的授權記在 IndexedDB `climbio-studio` 的 `recent`，裝成 App 後 Chrome 可以一直記住；沒有授權時要使用者點一下才能要回來（瀏覽器規定）。

## 發佈（`studio/dataset-publish.js`；雲端函式 `functions/projects.js`）

發佈（一面牆的檔案由 `routekit/format.js` 的 `wallFiles` 組，與岩點貓共用）：公開內容經 `studio/dataset-publish.js` 與 `datasets` 寫入 Hugging Face 開放資料集，從 `/p/<專案 id>/index.json` 讀取。個人工作檔留在本機資料夾或 OPFS；讀取 App 依 `index.json` 的 `type` 辨識資料類型。

- **畫面與流程只有一份**：Crag、3D 牆等工作區共用 `studio/publish-ui.js` 的發佈對話框與過場，以及 `studio/publisher.js` 的公開發佈流程；工作區提供各自的公開內容、授權與署名欄位。私人資料存於本機或使用者選定的資料夾。
- **上傳**：公開放進開放資料集（Hugging Face：`climbio/crags`、`walls`、`walls3d`、`crags3d`；見 `studio/dataset-publish.js`、雲端函式 `datasets`）。照片和模型由瀏覽器直接傳給 Hub，JSON 由雲端函式一次 commit；內容跟上一版一樣（SHA-256 相同）的檔案不重傳。上一版的檔案清單 Wall 記在 `.studio/project.json` 的 `publish`，Crag 記在組合的 `props["author:publish"]`（匯出、發佈時拿掉）。Studio 不登入、不記發佈者；發佈就是公開，沒有私人發佈（見 [open-versions.md](proposals/open-versions.md)、[crag-open-versions.md](proposals/crag-open-versions.md)）。
- **登記**（雲端函式 `datasets`）：公開發佈時在 Firestore `datasets/<id>` 記專案種類、名稱、時間、檔案、位置與版本血緣；新版本使用新的專案 id，透過 `origin`、`root`、`lineage` 關聯，公開檔案保存在開放資料集。後端依網路來源限流，可由管理者隱藏不當或重複索引。
- **列名**：`list`（不用登入）列所有發佈的專案；發佈就是公開，沒有不列名的發佈。Studio 的發佈／版本管理依各工作區現有流程。
  **版本排序與來源**：公開發佈可帶來源 `origin` 與素材署名 `attribution`。同一 `root` 的版本在清單中群組，依下載數與發佈時間排序；「世界」呈現群組代表版本，其他版本保留來源資訊。GET 回 `{ ok }`，供發佈服務健康檢查。
- **讀取**：公開的檔案經 `/p/<專案 id>/…`（`projectFiles`）導向開放資料集；沒有 `drive://` 與 `files.json`。
- 自架的站沒有這兩個函式時沒有發佈（`studio/backend.js` 指到的服務留空）；匯出 ZIP 照舊，可以自己放上任何靜態網站。

## Non-Goals

- 這一輪不改格式 Schema、existing Kit API、工作區內部的編輯器與儲存方式。
- 不新增 Studio 的第二套 Logo／App Icon，也不製作兩個獨立 Studio Landing Page。

## Tasks / Acceptance / Review / Ownership / Milestones / Exit

1. **設計**：品牌與首頁更新，驗證唯一 Studio、既有官方 SVG 使用正確、兩個 App 入口保留。
2. **Studio Shell**：建立同一套導航、Inspector、工具列、鍵盤／觸控與發布骨架；工作區切換測試。
3. **領域整合**：以原有 /find/、/author/ 能力逐步遷移到相同 Shell，不重寫已穩定的 Format／Kits。
4. **資料遷移**：測試專案、離線快取、匯出及公開 URL 的完全相容。
5. **發布**：先 Preview，再由獨立 reviewer 以真實岩館與岩場案例檢查。

**Acceptance**：Studio 名稱與官方 Logo 一致；工作區切換不丟資料；操作位置與行為一致；可用無官方後端的格式匯出；完整流程經 Desktop／iPad 實測。

**Owner**：產品／品牌決策者、Studio Shell 負責人、Crag 工具負責人、Open Format／Kits 維護者。

**Review**：設計／可及性、儲存／相容性、授權／隱私，以及各領域實際使用者獨立審查。所有階段的功能必須先達到各自 Exit Criteria，不能因 Logo 或首頁完成就宣稱 Studio 已合併上線。
