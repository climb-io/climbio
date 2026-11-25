# Climbio

[English](README.en.md)

攀岩用的開放平台：兩款 App 給岩友，一個工作台給整理資料的人；路線、照片和 Topo 用同一份開放格式，人看得懂，AI 也讀得懂。

- **岩點貓**（`/hold/`，室內）：拍一張岩牆照片，自動找岩點、點選定線，分享路線圖或連結；不用登入就能用。見 [介面與操作](docs/app.md)、[分享](docs/sharing.md)、[備份與復原](docs/backup.md)、[3D 牆](docs/3d-wall.md)（3D 相機追蹤測試在 `/3d/`，見 [docs/3d-tracking.md](docs/3d-tracking.md)）。
- **紅點貓**（`/redpoint/`，戶外）：從世界收下岩場，下載後離線看 Topo、路線與 3D，記錄完攀。見 [docs/redpoint.md](docs/redpoint.md)。
- **Climbio Studio**（`/studio/`）：把照片、舊路線書整理成 Guidebook 並發佈。見 [docs/studio-crag.md](docs/studio-crag.md)。
- **開放格式與 Kit**：`format/` 和各 Kit 可以單獨用在你的網站或 App，見下面的「資料夾」。

正式版是 **https://climbio.app**。資料預設只存在自己的裝置；climbio.app 以外的站預設不接後端，整個資料夾放上任何靜態網站空間就能用（見 [docs/open-source.md](docs/open-source.md)）。

要參與開發：人看 [CONTRIBUTING.zh-Hant.md](CONTRIBUTING.zh-Hant.md)，AI 代理先讀 [AGENTS.md](AGENTS.md)。


## 文件

[網站文件](https://climbio.app/guides/) 提供一般使用者操作說明與 Studio 指南；[專案頁](https://climbio.app/project/) 說明進度與如何用 AI Agent 把 Climbio 放進現有的岩館 App。技術規格、安裝方式與工作文件統一以本 GitHub 倉庫的 `AGENTS.md`、`docs/` 和各 Kit README 為準。

產品規格見 [docs/README.md](docs/README.md)；路線書轉換也能不開 Studio、用命令列 `tools/guidebook.mjs` 做（讀檔、檢查、建立、局部修正、驗證，每一步產生同一份問題清單 `report.json`；AI 代理也用這個），見 [docs/guidebook-convert-format.md](docs/guidebook-convert-format.md) 的「命令列」，`npm run eval:convert` 比較 `tests/convert/` 的固定案例；程式架構（檔案分工、資料流）見 [docs/architecture.md](docs/architecture.md)；開發與測試見 [docs/development.md](docs/development.md)。

## 開發

需要 Node.js 22 以上和 Python 3。沒有建置步驟，第一次照下面做：

```bash
npm ci && npm ci --prefix functions   # 測試用的套件（雲端函式的測試要 functions/ 的套件）
npx playwright install chromium       # 瀏覽器測試用的 Chromium
python3 tools/serve-test.py 8765       # 本機伺服器，會一直佔住這個終端
```

打開 http://localhost:8765/hold/ ：第一次是開場畫面，按「開始拍」選一張岩牆照片就能偵測、定線（電腦瀏覽器可直接使用，版面依視窗寬度調整）。本機不接後端，資料只存在這個瀏覽器。

Windows 用 `python` 代替 `python3`。請使用專案的伺服器：它會為 `.mjs` 提供正確的 JavaScript 類型，避免紅點貓和備份功能載入失敗。

另開一個終端跑檢查：

```bash
npm run test:quick                                                              # 語法、語言包、Node 測試
npm run test:smoke                                                              # 瀏覽器冒煙測試（自己起 8876 埠的伺服器，CI 也跑這組）
```

之後依改動選瀏覽器案例，見 [docs/development.md](docs/development.md)。

驗證與部署見 [docs/development.md](docs/development.md)、[docs/deploy.md](docs/deploy.md)。

## 資料夾

- `holdscan/`（AGPL-3.0）：岩點偵測。App 在手機上偵測（主網也是）；雲端版給想用伺服器偵測的站，見 [holdscan/README.md](holdscan/README.md)。
- `holdkit/`（AGPL-3.0）：岩點外框、重描與岩點資料包格式，見 [holdkit/README.md](holdkit/README.md)。
- `routekit/`（AGPL-3.0）：看線、定線、輸出路線圖，見 [routekit/README.md](routekit/README.md)。
- `mapkit/`（AGPL-3.0）：岩場的向量地圖，看圖與編輯（地圖畫面＋圖層進、圖層出），原生 SVG、不用建置，見 [mapkit/README.md](mapkit/README.md)。
- `topokit/`（AGPL-3.0）：戶外 Topo 的看圖與編輯（照片畫面＋路線圖層進、圖層出），原生 SVG、不用建置，見 [topokit/README.md](topokit/README.md)。
- `wall3dkit/`、`crag3dkit/`（AGPL-3.0）：室內 3D 牆與戶外 3D 岩場檢視器，見 [wall3dkit/README.md](wall3dkit/README.md)、[crag3dkit/README.md](crag3dkit/README.md)。
- `arkit/`（AGPL-3.0）：AR 看線，手機瀏覽器開相機即時認出 2D 牆、把路線岩點疊回相機畫面，見 [arkit/README.md](arkit/README.md)。
- `sourcekit/`、`appkit/`（AGPL-3.0）：第三方資料匯入與 App 共用元件（含語言包、對話框、朋友互傳與分享圖）。
- `embed/`（AGPL-3.0）：供外部網站以 `<iframe>` 嵌入的獨立靜態頁，見 [docs/embed.md](docs/embed.md)。
- `format/`（Apache-2.0）：公開格式 v2（畫面、圖層、組合，室內戶外通用）的 JSON Schema 與驗證器，詞彙見 [format/VOCABULARY.md](format/VOCABULARY.md)，規格見 [format/README.md](format/README.md)。

## 授權

GNU AGPL-3.0（見 [LICENSE](LICENSE)），包含 `holdkit/`、`routekit/`、`topokit/`、`mapkit/`、`wall3dkit/`、`crag3dkit/`、`arkit/`、`appkit/`、`sourcekit/` 等所有程式；只有 `format/`（格式規格與驗證器）和路線格式規格是 Apache-2.0，讓任何 App 都能照著實作。其他元件見 [NOTICE](NOTICE)，開源規劃見 [docs/open-source.md](docs/open-source.md)。Climbio 的 Logo 與貓咪角色以 CC BY 4.0 授權（見 [design/brand/LICENSE](design/brand/LICENSE)），「Climbio」名稱的使用請求見 [TRADEMARKS.md](TRADEMARKS.md)。

岩點貓與紅點貓左上使用各自的貓圖案加 Climbio 向量字，開場與首頁一致。
