# Climbio Studio — 共用工作台設計規範

> **先讀 [studio.md](studio.md)**：Studio 現在的定位（AI 做工作、人只判斷）、架構、現況與不能破的規則在那裡；這份是首頁、步驟列、專案資料夾、發佈與外觀的細節。
> **現行產品分界**：`/studio/` 是正式天然岩場 Guidebook 編輯入口，以 Crag 為主要工作區；岩點精修與 3D 牆編輯工具仍存在，但首頁將其歸在 `/lab/` 研究入口，並非已完成的正式 Wall Studio 發佈流程。`/studio/` 已取代 `/find/`、`/author/`。
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

- Studio Shell **固定深色**（`css/brand-tokens.css` 的 `studio` 主題：比岩點貓更冷的中性深灰，分 `--chrome`（導覽與外圍）、`--bg`（內容面板）、`--surface`／`--surface-2`（卡片、控制）、`--sunken`（輸入框）幾層；操作色 `#D4FF4F` 只給主要動作、焦點與目前所在；地圖線用亮一階的層次藍 `#4FB3F0`）。
- **設計系統在 `studio/shell.css`**（每個 Studio 頁面都載入）：內文 14px，標題大而緊（區段 17–19px、首頁主標到 96px、字距收緊）；控制高 34（觸控 40）、圓角 10，卡片圓角 12–22；按鈕細框加一點上緣反光，主要動作是實心操作色加一圈光（`--glow`），卡片滑過會浮起來（`--lift`）（`.btn`、`.primary`、`.ghost`、`.small`、`.large`），輸入框凹下去、焦點是操作色細框加淡光（`.field`），分段（`.seg`）、標籤（`.tag`）、區段小標（`.st-label`）；AppKit 的對話框、清單、提示在 Studio 主題下改成同一套（只蓋 `[data-climbio-theme="studio"]`，手機 App 不受影響）。頁面自己的樣式只排版面，不再重寫按鈕、輸入框。
- 版面：左側導覽是最深的一層，內容是嵌進去的一塊圓角面板（電腦、iPad；手機是整頁加底部一排）。導覽外圍有一點操作色與層次藍的光，面板裡用 1px 細線分層、不用陰影；浮在畫面上的東西（工具列 `studio/chrome.css` 的 `.tbar`、照片上的工具、選單、對話框）才有陰影與毛玻璃。開著的工具是淡底操作色，實心操作色只給主要動作。風格是「資料就是畫面」：照片、Topo、地圖、3D 佔滿面板；未來感只來自真實資料畫出來的東西（照片位置、視錐、點雲），不加只為好看的特效。
- Crag 可輔以深海藍；未來增加正式工作區時，應維持共用操作語意。**目前不能宣稱 Crag 與 Lab 已完成相同的三欄 Shell。**
- 資料層的路線類型、起攀／完攀、難度等有獨立語意色，不可由品牌主色任意覆寫。
- 沒有亮色版：切換工作區不換配色，只換工作區色（--ws：Crag 層次藍、Wall 室內綠、3D 牆青藍）。

## 介面語言（繁體中文、英文）

- Studio 的介面有繁體中文與英文兩版（App 另有七種）。語言包在 `i18n/studio/`（共用：首頁、帳號選單、專案資料夾）與各工作區的包：`studio-crag`（介面）、`studio-crag-data`（資料層的訊息與預設名稱）、`studio-wall`、`studio-wall3d`、`studio-convert`；key 依包加前綴（st、cg、cd、hl、w3、cv），多個包同時載入時依序找 key。
- 頁面用 `studio/i18n-boot.js` 載入（`data-packs` 列要載入的包，共用名詞自動加上）；語言只跟瀏覽器語言（繁中、英），沒有手動選擇。
- 輸入格式不翻：路線書大綱的標題與欄位關鍵字、匯入表格的欄位別名、給 AI 的提示詞全文維持中文（解析端只認這些），英文介面只在說明裡補上對應。資料層產生的預設名稱（岩壁 N、區域 N…）在建立當下依語言產生，之後就是使用者資料。
- Node 測試用 `tools/studio-i18n.mjs` 載入繁體中文包；Studio 的程式只在呼叫時才查文字，不在載入當下組字串。

## 首頁與新專案（`studio/index.html`、`studio/home.js`、`studio/album.js`）

- **首頁介面**：Studio 是給 AI 代理做事、人來確認的工作台，**沒有給人手動新增的入口**（2026-11-22 拿掉「加資料」、拖放、建立空白岩場）。最上面是主畫面，接著是「交給 AI」（`#aiBox`，這頁唯一的螢光綠區塊，導覽的「交給 AI」連到 `#ai`，舊的 `#add` 也到這裡）：三步——**設定一次**（準備能在電腦上執行程式的 AI 代理，把 Climbio 的 GitHub 專案交給它，它照專案裡的說明自己處理；網站與 Studio 不抄安裝指令，見 site-content.md）、**交代任務**（岩館牆、岩場照片、路線書、3D 牆各一句可以複製的話，換成自己的資料夾或網址；「只有發佈要問我」）、**你來確認**（「打開專案」選代理說的專案資料夾：`SS.claim` 認得是 Studio 專案就記進最近的專案、進那條線的工作頁；要電腦的 Chrome、Edge，其他瀏覽器只顯示說明）。再來是「繼續編輯」（最近的專案），最下面三條線（岩館、岩場、3D）各一張同一版型的說明卡（工作區色的圖示；「輸入 → AI → 你判斷」三步，最後一步用工作區色），只有 3D 另有看的入口（「3D 場景」、「3D 牆」）。路線書不是另一條線：轉出來的就是岩場的 Guidebook，寫在岩場卡的輸入裡。寬的三欄、窄的一欄。
- **匯入的程式還在，只是人看不到入口**（代理的工具在背景用）：首頁隱藏的 `#addInput`（`tools/guidebook.mjs` 收原生的包）與 `#import=<網址>`（岩場站、Google 相簿）。內容決定交給誰：資料夾已經是 Crag 專案就打開；有 `wall.json` 和它指到的模型、面標籤是 3D 牆（放進瀏覽器私有檔案系統，進 `wall3d/#p=<id>`）；Climbio 原生資料包進 Crag；Word、PDF、網頁、路線表（CSV、TSV）進路線書轉換（`crag/#bookInbox`）；岩場網址、Google 相簿照網址判斷；照片（含只有照片的 ZIP）先快速掃描，猜岩館或岩場（`intake/workspaces.js` 的 `suggest`），整理畫面確認專案名稱和「岩館／岩場」，分組、挑照片、處理項目都自動；建立後岩館進 Wall（`wall/#inbox=`），岩場進 Crag。
- **專案裡的加入**：Crag 路線清單的工具列「加入資料」選單：這本匯入照片、貼上表格（手機沒有這顆）；新的一本、路線書、岩場站由 AI 代理做。Wall 沒有專案時是作品清單（沒有作品就連到「交給 AI」），已開的專案裡「加牆面照片」照舊（確認時補照片用）。
- **說明頁不在 Studio 裡**：轉換路線書、把路線書變成 3D 版的說明在 `/guides/convert/`、`/guides/crag3d.html`；Studio 的頁面一律是工具。
- **新專案**：以多張照片為主要輸入。拖進或選照片、資料夾、ZIP（只有照片的 ZIP 展開整理；有文件、表格的 ZIP 進路線書轉換），或貼上 **Google 相簿分享連結**（`photos.app.goo.gl`／`photos.google.com/share`，透過擴充功能或 `/album` 雲端函式轉發，下載 `=d` 原始照片並保留完整 EXIF 與 GPS，預設以相簿名稱作為專案名稱；匯入說明與掃描結果無位置時會提醒在相簿「選項」開啟「分享相片位置資訊」）。
- **快速掃描**（幾秒內完成，不做偵測）：讀每張照片檔頭的 EXIF（有沒有拍照位置）、資料夾名稱、機器取的檔名（IMG_1234、iPhone 的 UUID）；過半照片有拍照位置時再抽最多 40 張小圖找紅筆（很鮮的紅色）。
- **自動處理**（人不勾）：工作區照掃描結果決定（`intake/workspaces.js` 的 `auto`）。專案名稱預設：拖進一個資料夾用資料夾名，否則用照片所在的資料夾名或日期。

| 工作區 | 自動做的 | 對應 |
|---|---|---|
| Crag | 沒有位置的照片照拍攝時間歸岩壁、有紅筆的照片描路線（紅筆、跟原圖相減） | 建立時做一次（[studio-crag.md](studio-crag.md)） |
| Wall | 每張照片一面牆、分組變分區、偵測岩點 | 接手時做（[studio-wall.md](studio-wall.md)） |

- 按「建立」：檔案和選項放進收件匣（IndexedDB `climbio-studio` 的 `inbox`，`studio/store.js`），轉到工作區的 `#inbox=<id>`（`crag/`、`wall/`），工作區取出（取了就刪）建專案。Chrome 拖進一個資料夾時，專案直接存在那個資料夾（按建立時要寫入權限，見下面的「專案資料夾」）。
- **正式編輯入口**：新的 Guidebook（`crag/#new`）、轉換路線書（代理交給首頁的路線書檔案，`crag/#bookInbox=…` 打開轉換對話框，可讀 Word、文字型 PDF、網頁與大綱；見 [guidebook-convert.md](guidebook-convert.md)）、匯入岩場站（`crag/#site`）。
- **岩館、岩場兩頁是作品清單**（`studio/library.js`）：岩館（`wall/`）、岩場（`crag/`）沒有打開專案時，列這條線「進行中」的專案（這台記得的，點了打開）和「已發佈」的作品（岩館讀開放資料集的公開牆目錄 `walls.jsonl`，點了看那面牆的報告 `#r=`；岩場讀公開專案清單，點了進編輯：這台已經有這本書的專案（自己發佈的看 `author:publish` 的 `project`／`root`，匯入的看 `derivedFrom`、來源網址）就打開它，沒有就用 Crag 的 `#site=` 匯入最新的一版成新專案；Studio 裡看岩場是編輯，不是紅點貓的分享頁）；都沒有就一句說明加「交給 AI」。這兩頁沒有匯入的入口，新的作品由 AI 代理做。路線書轉換來的岩場列在岩場、標「路線書」：進行中的看 `project.json` 的 `book: true`（有轉換紀錄的舊專案打開時補標），已發佈的看岩場目錄 `crags.jsonl` 裡帶原始檔 `source` 的（同一本任何一版是就算）。舊的路線書頁網址 `crag/#book` 換成岩場頁。`studio/wall3d/` 技術路徑保留，但對外由 `/lab/` 說明，不屬於正式 Studio 新專案發佈流程。
- **最近的專案**（首頁的「繼續編輯」，Atlas 的 Library 那種專案卡：工作區色的圖示、名稱、哪一條線 · 放在哪 · 時間，刪除鈕滑過才出現）：`climbio-studio` 的 `recent`，新到舊，寫著放在哪個資料夾（或「這台裝置的瀏覽器」）；存在瀏覽器裡的可以在這裡刪，資料夾是使用者自己的，不刪。資料夾專案點了先要回授權再打開。
- 工作區頁面沒有專案（網址沒有 `#`）就回首頁；網址是專案 id，重整直接接續。

## 統一導覽（`StudioShell.rail`）

每個 Studio 頁面（首頁、Crag、Wall、3D 牆、3D 場景）左邊同一條導覽，像 Atlas：最上面是母品牌標誌（回 Studio 首頁），接著首頁、交給 AI（連到首頁的 `#ai`），再來三條線：岩館（`wall/`）、岩場（`crag/`，路線書轉換來的也在這裡）、3D（`scene/`）。目前所在的那條亮起來（照頁面的資料夾判斷，`wall3d/` 算 3D）。最下面是網站的其他地方：文件、Lab、Climbio 首頁（Studio 的頁面不再放網站導覽）。寬螢幕（1280 以上）帶名稱、品牌是標誌加「Climbio Studio」（開發版、本機在旁邊標 Beta），窄的只有圖示，手機是底部一排（只有 Studio 的五項）。目前所在的一項是操作色的淡漸層底、圖示發光，左緣一條操作色光條。導覽的層級在彈出選單、對話框之下。

**頁首是麵包屑**（Atlas 的「工具 / 專案」）：工作區頁面的 `.st-ws` 換成這條線的圖示和名稱，接「/」和專案名稱（`StudioShell` 的 `crumb`）；首頁用 `.st-topbar`（圖示＋頁名，捲動時毛玻璃留在上面）。右邊是頭像選單。品牌只在導覽最上面。

## 首頁主畫面

首頁最上面一塊是岩館和天然岩場交替：原岩明德的 3D 牆（開放資料集 `climbio/walls3d` 的快照）和大砲岩的 3D 模型（3D 場景的渲染），每 7 秒淡入淡出、慢慢推近；左下是 Studio 標題和現在這一個的標籤，「打開 3D」進那個 3D（兩個都進 3D 場景：明德 `scene/#src=mingde`，大砲岩 `scene/`）。圖在 `studio/hero/`。系統「減少動態效果」時不換、不推。

## 過場（`StudioShell.busy`）

等超過幾秒的工作用全螢幕過場：標題、進度條、數字。AI 處理照片時（例如 Wall 加牆面照片的偵測）呼叫 `show(照片, 點)`：照片壓暗、偵測到的點一顆一顆亮起來（最後一張等它亮完再關）；只用真的處理結果，系統「減少動態效果」時直接全部顯示。

## 步驟列（`studio/shell.js` 的 `steps`、`studio/shell.css`）

頂列下方一排步驟，點了到那一步；步驟旁的小字是現況。工作區給內容與動作，外殼只畫。

| Crag | 做什麼 |
|---|---|
| 岩場資訊 | 岩場資訊對話框：名稱、署名、難度系統 |
| 區域圖 | 地圖的編輯模式：地圖放寬，調整、畫岩石、岩壁、區域、步道（只有這一步能改地圖）；小字是幾區、幾面 |
| 路線清單 | 只有路線表格（不放區域圖、照片），工具列：復原、新增、搜尋，選到路線才有上移、下移、移到、刪除；難度、種類用選的 |
| 路線圖 | 畫 Topo：先開還沒有圖層的照片；小字是畫過線的路線／全部 |
| 檢查 | 一整頁（`StudioShell.checks`）：沒有位置、來源不能公開的照片、路線沒分到岩壁或沒畫線（`report.js` 的 `bookReport`，同一面岩壁同一種問題併成一列）；點了去處理的地方 |
| 發佈 | 一整頁（`StudioShell.pubList`）：這本書一列，狀態（尚未發佈、第幾版、有更新）、匯出 ZIP、發佈（打開共用的發佈對話框） |

Wall 的步驟：牆面、岩點、檢查、發佈（見 [studio-wall.md](studio-wall.md)）；檢查、發佈兩頁跟 Crag 用同一組元件（`studio/shell.js` 的 `checks`、`pubList`、`pubStatus`，樣式在 `shell.css` 的 `.st-page`）。3D 牆：模型、岩點、發佈（不跳到別的工作區）。

工作區色：Crag 深海藍、Wall 室內綠、3D 牆青藍（`data-studio-ws` 是 `crag`／`gym`／`wall3d`）。

## 3D 場景（`studio/scene/`）

岩場的 3D 模型滿版，每張照片畫成相機視錐（1px 細白線，滑鼠停在上面或選到的變螢光綠），像在空間裡看到每張照片是從哪裡拍的。

- 下方照片膠卷照拍的地方接著排（相鄰兩張拍的地方接得上，岩館牆從最左邊開始；不照資料檔的順序）。點一個視錐（或膠卷的一張）就飛到那張照片拍的位置和方向，用照片的視角；到了照片淡入，上方膠囊寫「正在看 檔名 FOV 角度」；Esc、拖曳或縮放就退出照片、往後拉一點。左右鍵換上一張、下一張；「整區」飛回一開始的整區鏡頭（從相機群背後的斜上方）。
- 手勢：拖曳轉、滾輪或兩指縮放、右鍵（或 Shift）拖、兩指拖平移；系統「減少動態效果」時不飛、直接跳過去。
- 資料（網址的 `#`）：`crag=<專案 id>` 讀 Crag 專案——模型畫面，和照片畫面 `props.model` 記著的鏡頭（`{ id, camera: { position, target, fov } }`，公開格式 v2）；照片和模型從專案資料夾讀，資料夾專案要先在 Studio 首頁打開過。`src=dapao`（預設）讀開放資料集 `climbio/crag3d-lab` 的大砲岩（3D 重建流程的 `frames.json`：位置、四元數 rub、像素焦距；垂直視角 2·atan(cy／fy)、往 -z 看，高斯潑濺模型）；`src=mingde` 讀 `climbio/wall3d-lab` 的原岩明德（`pipeline/frames-product.json`，格式 `climbio-wall3d-frames/1`，COLMAP 慣例 x_cam = R·X + t、已換到成品牆座標；網格模型 `.glb` 與 `wall.json` 在 `climbio/walls3d`）。成品牆座標的上方是 `wall.json` 的 `up`、不是 y，相機和模型一起轉正（`upright`）。開放資料集的兩個在頁首用膠囊切換（岩館／天然岩場）；視錐深度照相機散開的範圍算。換算都在 `cameras.js`。
- 入口：Crag 頁首的「3D 場景」（這本有模型、有照片記著模型鏡頭才出現）。品牌鈕回到那本的 Crag。3D 重建的照片位置用命令列 `tools/studio.mjs frames` 做成 v2 包，Crag「匯入岩場站」收進來。
- 模型用 Crag3DKit 打包的 three.js＋Spark（`crag3dkit/vendor/three-splat.js`，只讀不改），視錐畫在上面一層 2D canvas；模型下載有全螢幕過場。空的 Crag 專案主畫面只有匯入照片，沒有空的表頭。

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
- **像同一個 App，不像一堆頁面**：各工作頁還是分開的 HTML，靠這幾件事讓啟動和換頁快、導覽不閃：
  - 冷啟動：部署時 `tools/stamp-assets.mjs` 在每頁 `<head>` 最前面加程式、樣式的 `<link rel="preload">`。頁面有 meta CSP 時 Chrome 不預先掃描，不加的話約 30 支程式一支載完才抓下一支（首頁 5 秒）；語言包（`appkit/i18n.js` 的 `boot`）也先寫 preload 再寫 script。
  - 換頁：`studio/sw.js` 對「從 Studio 頁面點過去」的導覽直接用這一版存好的頁面（不等網路）；從外面打開照樣先問網路，部署後第一次打開就是新版。新版 Service Worker 裝好後在背景把各頁和它們帶版本的程式、樣式先存好。任何 Studio 頁都會註冊 Service Worker（`shell.js`）。
  - 導覽列不動：`shell.css` 的跨頁 view transition；支援 Speculation Rules 的瀏覽器游標停在導覽或作品清單上就在背景把那一頁開好（prerender，`shell.js`）。
  - 作品清單的「已發佈」先畫上次存的（localStorage），問到網路再換。
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
