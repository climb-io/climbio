# 開源

目標是完全開源，讓任何人都能架自己的 Climbio 站。岩點偵測（`holdscan/`）、岩點分析（`holdkit/`）、看線定線（`routekit/`）都在這個 repo 裡。

## 授權

| 部分 | 授權 |
|---|---|
| App 與整個 repo（含 `holdscan/`：偵測模型是 AGPL） | AGPL-3.0（LICENSE），其他元件見 NOTICE |
| `holdkit/`、`routekit/`、`topokit/`、`mapkit/`、`appkit/`、`sourcekit/`、`wall3dkit/`、`crag3dkit/` | AGPL-3.0；岩館、社群免費用，閉源的商業軟體不能直接使用 |
| `format/`（Schema、驗證器）、公開資料的網址（`docs/route-format.md`） | Apache-2.0，任何 App 都能照格式實作，不受 AGPL 影響 |
| Climbio 的 Logo 與貓咪角色（`design/brand/` 和它派生的圖示、動畫） | CC BY 4.0，見 [design/brand/LICENSE](../design/brand/LICENSE) |
| 「Climbio」這個名稱 | 沒有註冊商標，只請求別的站不要叫 Climbio，見 [TRADEMARKS.md](../TRADEMARKS.md) |
| 岩館清單 | ODbL（OpenStreetMap）與政府資料開放授權，出處見 [gyms.md](gyms.md) 和 about.html |

## 給其他 App 用

不架整個站、只拿零件放進自己的網站或 App（例如岩館自己的路線網站）。Kit 是 AGPL-3.0：把 Kit 打包進自己的前端，那一部分前端要照 AGPL 開放原始碼；不想開放的，用 climbio.app 託管的畫面（連結或 `<iframe>`）就不受影響。

| 要做的事 | 用什麼 | 授權 |
|---|---|---|
| 看線、定線、輸出路線圖 | npm 套件 `@climbio/routekit`：函式、`RouteViewer`／`RouteEditor`、Web Component `<routekit-viewer>`／`<routekit-editor>`，附型別；圈點格式（例如 RouteMake）用 `fromCircles`／`toCircles` 轉。見 [routekit/README.md](../routekit/README.md) | AGPL-3.0 |
| 岩場的向量地圖（岩壁、步道、區域、地名、救援點；畫線、改形狀、岩壁面朝向、復原） | npm 套件 `@climbio/mapkit`：`MapViewer`／`MapEditor`、Web Component `<climbio-map>`，純 ES module、不用建置，附型別；資料是 v2 的地圖畫面＋圖層（經緯度），輸出也是圖層。見 [mapkit/README.md](../mapkit/README.md) | AGPL-3.0 |
| 戶外 Topo 的看圖與編輯（照片上的線段、bolt、編號牌；畫線、放 bolt、復原） | npm 套件 `@climbio/topokit`：`TopoViewer`／`TopoEditor`、Web Component `<climbio-topo>`，純 ES module、不用建置，附型別；資料是 v2 的照片畫面＋圖層（座標是照片像素），輸出也是圖層。見 [topokit/README.md](../topokit/README.md) | AGPL-3.0 |
| 框 → 岩點外框、顏色、MobileSAM 重描 | npm 套件 `@climbio/holdkit`。見 [holdkit/README.md](../holdkit/README.md) | AGPL-3.0 |
| 照片 → 岩點（照片固定的網站） | `holdscan/cli/analyze.js` 在自己電腦上離線跑，存下岩點資料包（可以順便把圈點路線對到岩點） | 指令 AGPL-3.0，產生的資料不受影響 |
| 讀別人分享的路線、牆面 | [format/](../format/README.md) 的畫面、圖層，網址見 [route-format.md](route-format.md) | Apache-2.0 |
| 室內 3D 牆的看線、沿牆鏡頭與離線烘焙 | npm 套件 `@climbio/wall3dkit`。見 [wall3dkit/README.md](../wall3dkit/README.md) | AGPL-3.0 |
| 戶外 3D 岩場的高斯潑濺檢視與視線遮擋表 | npm 套件 `@climbio/crag3dkit`。見 [crag3dkit/README.md](../crag3dkit/README.md) | AGPL-3.0 |
| 讀寫、驗證公開格式 v2（畫面、圖層、組合） | npm 套件 `@climbio/format`：JSON Schema（`climbio.schema.json`）、`validate`、樣本。見 [format/README.md](../format/README.md) | Apache-2.0 |

九個 npm 套件就是 repo 裡的 `format/`、`routekit/`、`topokit/`、`mapkit/`、`holdkit/`、`sourcekit/`、`appkit/`、`wall3dkit/`、`crag3dkit/` 資料夾（各有 `package.json`；`holdscan/` 是獨立的偵測工具，不發 npm），在資料夾裡 `npm publish --access public` 發布。**版本採語意版本**：公開 API 或格式有不相容的改動升主版本（先提設計案，見 CONTRIBUTING），相容的新增升次版本，修正升修訂版本；`holdkit/package.json` 的版本跟 `holdkit.js` 的 `VERSION` 一起改；`format/package.json` 的主版本號就是格式版本（`format.js` 的 `VERSION`），改了 `format.js` 的 `SCHEMA` 要重新輸出 `climbio.schema.json`（指令在 `tools/format.test.mjs`）；詞彙（`format/VOCABULARY.md`）增加不升版本。

## 架自己的站

不用建置、不用伺服器：整個資料夾放上任何靜態網站空間就是一個站。**climbio.app 以外的網域預設不接後端**：`site.js` 的 `backend` 是 `none`、不用雲端加速，資料只存在裝置上；Climbio Studio 也照這個設定，不登入、不發佈，可以匯出 ZIP。不用改設定；要接自己的後端見 [deploy.md](deploy.md)。

1. **Fork** 這個 repo。
2. **改名**：`node tools/rebrand.mjs 你的名字 https://你的帳號.github.io/climbio`（網址是站之後的網址，用在連結預覽的圖片），提交。名稱請不要叫 Climbio（見 [TRADEMARKS.md](../TRADEMARKS.md)）。
3. **上線**：GitHub 的 Settings → Pages → Source 選「Deploy from a branch」，分支 `main`、資料夾 `/ (root)`，幾分鐘後 `https://你的帳號.github.io/climbio/`（首頁）、`…/climbio/hold/`（岩點貓）就能用。Netlify、Cloudflare Pages 選這個 repo、不填建置指令也一樣。

這樣的站能拍牆、在手機上偵測岩點、編輯岩點、定線、看線、記錄攀爬、輸出路線圖，也能收任何站分享的路線連結、從總目錄找別的站的牆。要後端的功能（官方公開發佈、公開路線連結、自己站的公開牆面）不顯示；資料只存在手機。

### 之後更新站：每次部署都要升版本號

App 是 PWA，版本號變了才會換成新的 Service Worker：**版本號沒變，已經打開過的人可能一直拿到舊檔**。紅點貓是整版預先快取、打開先用快取（「打開不等網路」），所以沒升版本就幾乎一定仍是舊檔；岩點貓與 Studio 開 App 是網路優先，有網路時較容易拿到新頁面，但沒升版本仍可能混到舊資源（見 [architecture.md](architecture.md) 的「更新與離線」）。

所以每次推上站之前：

```bash
node tools/bump-version.mjs
```

它把 `version.js` 和 `hold/index.html` 的版本號一起加 1（兩個要一樣）。提交、推上站之後，下次打開 App 就是新版（開 App 時網路優先）；開著不動的畫面會提示「更新」，按了才重新載入。主網的部署流程會自動寫入版本號，自架站沒有這一步，要自己跑。

### 外部程式的雜湊（SRI）

從 CDN 載入的程式都帶 SRI 雜湊，內容被換掉瀏覽器就不執行：onnxruntime-web 的三個檔在 `holdkit/ort.js`，Wall 的 HEIC 解碼器 heic-to 在 `studio/wall/store.js`。換版本時重算：

```bash
curl -sL https://cdn.jsdelivr.net/npm/<套件>@<版本>/<檔案> | openssl dgst -sha384 -binary | openssl base64 -A
```

`hold/index.html` 的 CSP 只放行這些檔的網址，換版本時一起改。Firebase SDK（`backend/firebase.js`，用 `import()` 載入）瀏覽器不支援 SRI，CSP 放行整個 `www.gstatic.com`。

本機預覽（`localhost`、`127.0.0.1`）也一樣不接後端，clone 下來直接開就能用。

### 再調整

- **圖示**：準備 `mark.svg`、`wordmark.svg`、`icon.svg`、`icon-maskable.svg`，執行 `node tools/brand-icons.mjs --brand 你的資料夾`，換掉 `hold/index.html` 內嵌的 logo 和岩點貓的圖示（`icons/cats/hold-cat*`）。首頁的母品牌和其他三隻貓：換掉 `design/brand/` 的原稿再執行一次。
- **顏色**：`css/app.css` 開頭的 `--accent` 等變數。
- **吉祥物**：岩點貓可以直接用（標示「岩點貓 © Climbio」），也可以換成自己的：`js/holdcat.js`（照片裡的岩點醒來）、`js/mascot-motion.js`（說明卡的動畫）照同樣的介面改。
- **關於、隱私權政策、服務條款**：`about.html`、`privacy.html`、`terms.html` 是主網的，換成自己的。
- **接自己的後端**：`site.js` 的 `MAIN` 改成自己的網域、`backend: 'firebase'`，`backend/firebase.js` 的 `FIREBASE` 換成自己專案的設定，雲端函式的允許來源（`functions/site.js` 的 `HOSTS`／`ORIGINS`）加上自己的網域；部署見 [deploy.md](deploy.md)。`cloud` 的重描、附近交換網址留空就不用：偵測在手機上做，重描留著顏色描的外框。`directory` 是找牆面用的總目錄（預設主網的），`listed` 決定要不要登記進去（站要有公開牆面檔才會被收）。各功能怎麼跟著後端出現或隱藏見 [sharing.md](sharing.md) 的「後端」。
- 小寫的 `climbio`（網域、資料庫名稱、牆面檔欄位、`climbio.*` 這類識別字）不要改。

## 改程式時

- 使用者看得到的品牌名稱一律寫 `Climbio`（首字大寫），別人換名字時才找得到；各 App 安裝後的名稱是貓的角色名（見 [brand.md](brand.md)），不跟著換；識別字照舊用小寫 `climbio`。
- 品牌色用 CSS 變數 `--accent` 系列，不直接寫色碼。
- 新的品牌美術放 `design/brand/`，經 `tools/brand-icons.mjs` 產生衍生檔。
- 新功能先想沒有伺服器時怎麼運作，伺服器只當主網的加速；要用後端的功能加進 `Backend.caps`。
