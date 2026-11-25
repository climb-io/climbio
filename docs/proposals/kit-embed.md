# Kit 內嵌（iframe）提案

## 目標

讓任何不想公開前端原始碼的網站（岩館的路線系統、商業岩館的 App 網頁）用一個 `<iframe>` 嵌入 Climbio 的看圖、編輯畫面：不安裝、不註冊、不用金鑰，只提供畫面。資料只有一種來源：Climbio 官方發佈的網址（Studio 發布後的牆面與路線，放在 Hugging Face 的 `climbio/walls` 與 climbio.app），外層在 `init` 給網址，改了再用訊息傳回去；外層不打包任何 Kit 程式。適合願意和岩友一起分享路線的岩館；路線和岩點貓一樣，使用者怎麼對應到路線由岩館 App 自己決定。

**所有有畫面的 Kit 用同一套做法**（網址、訊息外框、事件、版本、託管、文件），只有資料內容各自照 Kit 的資料格式。第一個實作是 routekit，之後 topokit、mapkit、wall3dkit、crag3dkit 照同一個模板加。`holdkit`、`holdscan` 是演算法、沒有畫面，不在範圍。

## 為什麼是 iframe

Kit 是 AGPL-3.0：把 Kit 打包進自己的前端，那一部分前端要照 AGPL 開放原始碼（[open-source.md](../open-source.md)）。閉源的網站要用 Kit，只剩連結或 `<iframe>` 託管畫面這條路。Web Component 適合願意公開前端、或要完全融進自己版面的站，兩者並存、互不取代。

## 非目標

- 不改各 Kit 現有公開 API、不發佈 npm 套件：iframe 的程式由靜態主機提供，外層只放標籤，與 npm 無關。`@climbio/routekit` 目前在 npm 查不到（實測 registry 回 Not found）；要不要發佈是打包使用的另一件事。
- 不經手使用者資料：內嵌頁是靜態頁，只讀外層在 `init` 給的官方網址（climbio.app 的 `/p/`、`/w/`、`/r/` 與 Hugging Face 的 `climbio/walls`，別的網址一律不收，訊息直接帶資料也不收），不帶 cookie、不記錄、不寫入 Climbio 後端；定線的結果只在使用者的瀏覽器裡，由訊息傳回外層。
- 不做看圖、編輯以外的功能（名稱、難度、介紹、發佈由外層自己的表單處理）。

## 現況

- climbio.app 全站標頭 `Content-Security-Policy: frame-ancestors 'self'`（`firebase.json`），別人的網站嵌不了。
- 沒有專給外部嵌的頁面；`routekit/demo.html` 沒有跟外層溝通的介面。
- 各 Kit 的 Viewer／Editor 已有看圖、點選、變動事件，內嵌頁直接用，不另寫畫圖與點選。

## 設計（所有 UI Kit 共通）

### 網址

`https://embed.climbio.app/<kit>/v1/`，例如 `https://embed.climbio.app/routekit/v2/`（自己的網域，以 CNAME 指到靜態主機，之後換主機網址不變；repo 裡的檔案在 `embed/<kit>/v1/`，發佈時以 `embed/` 當站台根目錄）。路徑帶版本：商業岩館上線後不能被我們的改動打壞；不相容的改動新增 `v2/`，`v1/` 保留。查詢字串只放顯示選項（不含資料）：

| 參數 | 說明 |
|---|---|
| `mode` | `view`（預設）、`edit` |
| 各 Kit 自己的顯示選項 | 例如 routekit 的 `type`（`s`、`h`、`t`）、`base`（`gray`、`dim`），列在該 Kit 的 README |

### 訊息（`postMessage`）外框

所有訊息是 `{ climbio: '<kit>', v: 1, type, … }`，只認自己的 `climbio` 與 `v: 1`。所有 Kit 共用同一份程式（`embed/shared/`）處理外框與來源檢查，各內嵌頁只寫自己的資料。

- 內嵌頁只處理 `event.source === window.parent` 的訊息；第一個 `init` 的 `event.origin` 記下來，之後只對這個 origin 回傳、只收這個 origin 的訊息（外層導向別的網站後不會收到資料）。
- **資料一律是 Climbio 公開格式 v2**（[format/README.md](../../format/README.md)）：牆是照片畫面（`kind: view`，岩點是節點加多邊形標註），路線是疊在牆上的圖層（`kind: layer`）；所有 Kit 同一種，外層只要懂這一種格式。資料只在 `init` 給官方網址，內嵌頁自己讀，收到後先用 `@climbio/format` 的 `validate` 驗證（外框至少三點、在照片內），照片最大 10 MB、只當圖片解碼。
- Kit 原生資料與 v2 的轉換在內嵌頁裡做（routekit 用既有的 `RouteKit.fromFormat`、`RouteKit.routesLayer`），外層不接觸 Kit 原生格式；協定因此不隨 Kit 內部改版而變。

共通的訊息類型：

| 方向 | `type` | 內容 |
|---|---|---|
| 內嵌頁 → 外層 | `ready` | 載入完成，可以送 `init` |
| | `change` | 使用者改了資料：`layer`（v2 圖層，內容是改過的那條路線或標註） |
| | `error` | `message`（資料格式不對、尺寸太大） |
| 外層 → 內嵌頁 | `init` | `viewUrl`（v2 照片畫面的官方網址）、`layerUrls`（v2 圖層的官方網址，可省略）、`photoUrl`（畫面 `href` 指的那張照片的官方網址） |
| | `set…` | 該 Kit 的更新（例如 routekit 的 `setRoute`、`setType`） |

routekit 的內容：一次只畫一條路線，圖層裡有幾條由外層用 `init` 或 `setRoute` 的 `routeId` 指定（內嵌頁沒有自己的切換）；`setRoute` 帶 `routeId`（圖層裡的路線節點 id）；`setType` 帶 `holdType`（`s`、`h`、`t`；欄位不叫 `type`，免得跟訊息外框的 `type` 撞名）；`change` 的 `layer` 是 `RouteKit.routesLayer` 產生的 v2 圖層（路線節點的 `props.holds` 是 `{ 岩點 id: 's'｜'h'｜'f'｜'t' }`，有出手順序時帶 `props.seq`）。不輸出圈點格式（x、y、t、r）：外層要圈點時，自己用 `RouteKit.toCircles` 或依格式規格換算；內嵌頁不替外層算它自己的座標系。岩點貓公開牆的畫面本來就是 v2，官方網址直接就是它。

### 縮放

各 Kit 的 Viewer／Editor 刻意只做取景與點選。內嵌頁沒有外層可以補，所以**第一版就包含**：由共用程式統一加雙指縮放、拖曳平移（只在內嵌頁，不改 Kit 的公開 API）。

### 給 AI 讀的整合文件

GitHub 上的文件要讓 AI 讀了就能整合，所以每個 Kit 同一個寫法：

- `docs/embed.md`：通用指南（網址、訊息外框、事件順序、來源檢查、版本、託管位置、最簡範例）。
- 每個有畫面的 Kit 的 `README.md`、`README.en.md` 加一個固定章節「內嵌（iframe）」：該 Kit 的網址、顯示選項、`init`／`change`／`set…` 的資料格式、最小範例。這是 [AGENTS.md](../../AGENTS.md) 的 README 章節規則的新增項目，採用後 AGENTS.md 要同步更新。
- `embed/<kit>/messages.d.ts`：訊息的 TypeScript 型別，是格式的唯一依據；README 與範例以它為準。
- 網頁（`kits/content/<元件>.mjs`）給人看的版本同步加一段，照現有規則由 `node tools/build-kits.mjs` 產生。

### 最簡整合（外層）

```html
<script>
  // 先註冊 message 監聽，再放 iframe：內嵌頁的 ready 只送一次，監聽太晚會漏掉
  addEventListener('message', (e) => {
    const frame = document.getElementById('rk');
    if (e.source !== frame.contentWindow || e.data?.climbio !== 'routekit') return;
    if (e.data.type === 'ready') frame.contentWindow.postMessage({ climbio: 'routekit', v: 2, type: 'init', view, layers, photo }, '*');   // view、layers：Climbio 公開格式 v2
    if (e.data.type === 'change') save(e.data.layer);
  });
</script>
<iframe id="rk" src="https://embed.climbio.app/routekit/v2/?mode=edit" title="定線"></iframe>
```

沒有帳號、沒有金鑰、沒有後端。

## 託管位置

內嵌頁是自給自足的靜態檔，全用相對路徑，不依賴 climbio.app 或任何伺服器，所以放在哪個靜態主機都能跑。**程式與文件放在 GitHub 公開 repo（給 AI 與人讀）；靜態託管是另一件事，下面是查到的事實。**

| 項目 | GitHub Pages | Cloudflare Pages | Netlify（免費） | Firebase Hosting（現有專案的第二個站台） |
|---|---|---|---|---|
| 自訂標頭（放行 iframe） | 文件沒提到，不能確定 | 有（`_headers`） | 有（`_headers`） | 有（`firebase.json`，每個站台各自設定） |
| 預設會不會擋 iframe | 實測 `pages.github.com` 的回應沒有 `X-Frame-Options` | 文件沒說 | 文件沒說 | 該站台自己設定 |
| 流量 | 軟上限約 100 GB／月，超過可能回 429 | 限制頁沒寫流量上限 | 每月 300 點上限，流量 1 GB 約 20 點，約 15 GB／月（依文件換算） | 依方案計價，沒查證 |
| 商業用途 | 條款不准當成經營生意、電商或 SaaS 的免費主機；沒提到嵌入，我們這種「免費畫面被商業站嵌入」屬灰色地帶，文件建議不確定時問 GitHub Support | 沒查到明文 | 沒查到明文 | 現有專案已在用 |
| 現況 | `climb-io.github.io/climbio/` 目前回 404（未啟用） | 要新建 | 要新建；原岩本來就用 Netlify | 已有專案與交付工具 |

來源：GitHub Docs「GitHub Pages limits」與「GitHub Terms for Additional Products and Features」、Cloudflare Pages 的 limits 與 headers 文件、Netlify 的 credit-based pricing 與 headers 文件（2026-11-19 查）。jsDelivr 的 GitHub 靜態 HTML 是否以 `text/html` 供應沒查到，不列入。

**建議**：

1. **預設放 Firebase Hosting 的第二個站台**（例如 `climbio-embed`，網址用 `embed.climbio.app` 以 CNAME 指過去，已決定用自己的網域；DNS 要維護者加一筆）：標頭只放行這個站台，不動 climbio.app 的 `frame-ancestors 'self'`；沿用現有交付工具、不新增廠商與條款；費用依 Firebase 計價（沒查證，這個頁面很小、不含使用者資料）。
2. GitHub Pages 因為商業用途條款有灰色地帶、流量有軟上限、標頭不確定，不當預設；岩館自己想放也可以。
3. 想控制可嵌入網域、固定版本、不依賴外部服務的岩館：下載 `embed/<kit>/v1/` 資料夾放進自己的靜態主機（建議獨立子網域）；要照 AGPL 保留 LICENSE、NOTICE，改了程式要依第 13 條提供原始碼。
4. 實作前先用一次實驗確認 Firebase Hosting 多站台各自的標頭設定確實互不影響（`climbio` 站台維持 `'self'`）。

### 授權

內嵌頁是 AGPL-3.0 的程式，由 Climbio 提供；畫面上不放授權標示或原始碼連結（使用者要求拿掉；原始碼在公開 repo）。外層網站只含 `<iframe>` 標籤與 `postMessage` 呼叫，不含 Kit 程式。這是 [open-source.md](../open-source.md) 既有說法的實作，不是新承諾；不提供商業授權、不簽 CLA 不變。

## 相容性

- 新增網址與訊息協定，不改各 Kit 的函式與 Web Component 介面，不升 Kit 版本。
- 訊息協定有 `v`，網址有版本；不相容的改動升 `v` 並保留舊版一段時間。

## 驗證

- 單元：參數解析、`init` 資料驗證、訊息外框與版本檢查、只收父視窗與第一個 `init` 的 origin（共用程式測一次，各 Kit 測自己的資料）。
- 瀏覽器：父頁（另一個來源，例如 `127.0.0.1` 對 `localhost`）內嵌，確認 `ready`、`init`、`change`、`set…`；外層導向別的網站後收不到資料；確認內嵌頁沒有任何對外請求；把 `embed/<kit>/v1/` 複製到另一個來源的靜態伺服器，照樣能跑。
- 標頭：站台部署後，從另一個網站嵌入，確認沒有被擋；climbio.app 其他頁面仍然不能被嵌。
- 實機：手機寬度的看圖與編輯、雙指縮放。

## 內嵌頁的功能（v1 上線前追加）

- **大小**：iframe 大小自己設，畫面和按鈕跟著框調整（測試涵蓋 180×120 到 900×300）。
- **原生 App**：WebView 直接開內嵌頁，用橋接收發（iOS、Android、React Native、Flutter），資料一樣讀官方網址。
- **小畫面是預覽，點一下進全螢幕**：預覽沒有工具壓住畫面；全螢幕才有工具（暗彩／黑白、縮放等）、縮放平移與定線。全螢幕用瀏覽器的 Fullscreen API，不行（iPhone Safari、原生 App）就送 `fullscreen` 請外層放大並用 `setFullscreen` 回報，沒回報 0.7 秒後原地互動；`tap=edit`、`controls=0` 直接原地互動。
- **縮放、平移跟岩點貓同一套**，內建在 Kit（`viewport.js`、`zoom: true`），不只內嵌頁，所有用 RouteKit 的人都有同樣體驗。
- **定線可以真的操作**：全螢幕上方左取消、右完成（送 `cancel`、`done`），沒有難度、名稱（外層的表單處理）；起攀／手點／完攀／腳點／順序（跟岩點貓同一排，腳點、順序可用 `foot`、`order` 選項關掉，預設都顯示；起攀顯示數量與上限；岩點貓沒有的工具不放，所以沒有復原、清除，再點一次已選的岩點就拿掉），`change` 隨編輯送出 v2 圖層。
- **起攀點數上限**：`maxStart`（預設 2＝岩點貓，有的岩館規定 4）；起攀滿了，新的點改成手點，已在路線上的點不能改成起攀（不動並送 `limit`）。Kit 的 `RouteEditor` 新增 `maxStart`（`tapHold` 本來就有），相容的新增。
- 細節在 [docs/embed.md](../embed.md) 與 routekit README；v1 尚無外部整合者，所以這些追加不算改動 v1 的相容性。

## 已決定

- **網址**：用自己的網域 `embed.climbio.app`。
- **圈點輸出**：routekit 的 `change` 不給圈點格式，只給原生路線。
- **縮放**：雙指縮放、拖曳平移進第一版。
- **託管**：Firebase Hosting 第二個站台（部署前要建立站台與加 DNS，先問維護者）。
- **資料只讀官方網址**：不收訊息直接帶的資料，也不收別的網址；`init`／`change` 一律用 Climbio 公開格式 v2（畫面與圖層）；有版本、有驗證器，所有 Kit 同一種，協定不隨 Kit 內部改版而變。
- **README 固定章節「內嵌（iframe）」**：採用，AGENTS.md 的章節規則同步更新。
