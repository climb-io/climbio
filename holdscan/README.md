# holdscan

English: [README.en.md](README.en.md)

## 1. 用途

岩點偵測：照片 → 岩點框 `[x0, y0, x1, y1, score]`。三種用法：瀏覽器版（模型在手機上跑）、雲端／自架的 HTTP 服務、離線 CLI（照片 → 岩點資料包）。

- **該用**：要在網頁裡偵測岩點、自己架偵測服務，或把固定的牆面照片離線分析成岩點資料包。
- **不該用**：外框描繪、顏色、MobileSAM 重描（那是 `holdkit/`）。

## 2. 授權與依賴規則

- **AGPL-3.0**（`LICENSE`、`NOTICE`）：偵測模型 [jwlarocque/yolov8n-freeclimbs-detect-2](https://huggingface.co/jwlarocque/yolov8n-freeclimbs-detect-2) 是從 Ultralytics YOLOv8 微調的，只能用 AGPL-3.0（見 `models/README.md`）。依 AGPL-3.0，改過的版本透過網路提供服務時，要讓使用者取得你的原始碼（回傳的 `source` 改成你的 repo）。
- 這個資料夾可以讀 `holdkit/`；反過來不行：Kit（`holdkit/`、`routekit/` 等）不引用 `holdscan/`、App 的 `js/`，保持各自獨立。
- 不是 npm 套件（沒有根目錄的 `package.json`），直接拷貝檔案使用。
- 各部分的依賴：
  - 瀏覽器版：`core/detect-core.js`、`holdkit/ort.js`（onnxruntime-web，從 jsDelivr 核對雜湊後載入，要連網）、模型。
  - 雲端／自架服務：`functions/package.json`（express、onnxruntime-node、sharp；Firebase 版另有 firebase-admin、firebase-functions）。
  - CLI：`cli/package.json`（onnxruntime-node、sharp），並用到同層的 `holdkit/`、`routekit/` 和 `functions/tidy.js`（repo 根目錄的 `functions/`）。
- CLI 產生的岩點資料不受 AGPL 影響。

## 3. 檔案地圖

| 路徑 | 責任 |
|---|---|
| `core/detect-core.js` | 前處理、後處理（分數門檻、去重複框），雲端版和瀏覽器版共用；全域 `HoldDetectCore`（Worker）或 `module.exports`（Node） |
| `browser/holdscan.js` | 瀏覽器版 API：全域 `HoldScan` |
| `browser/worker.js` | Worker：onnxruntime-web（CPU）跑偵測，前後處理用 `core/detect-core.js` |
| `browser/example.html` | 瀏覽器版最小範例頁 |
| `models/freeclimbs.onnx` | 偵測模型（AGPL-3.0）；`models/README.md` 說明來源與重新匯出 |
| `functions/handler.js` | 雲端偵測 `detect` 的 HTTP 處理與 `detect(buf, size)`，跟平台無關 |
| `functions/index.js` | Firebase 版外殼（asia-east1，CPU；驗證、App Check、每帳號每天 30 次） |
| `functions/server.js` | 一般 Node 伺服器版外殼（Docker、Cloud Run、Fly、自己的機器） |
| `functions/vendor/` | 部署時從 `core/`、`models/` 複製進來的副本（沒有就直接讀 repo 的 `core/`、`models/`） |
| `cli/analyze.js` | 離線分析：照片 → 岩點資料包 |
| `Dockerfile` | `server.js` 的容器映像 |

## 4. 公開 API

### 4.1 瀏覽器版 `HoldScan`（`browser/holdscan.js`）

用 `<script src=".../holdscan.js">` 載入，掛在 `self.HoldScan`。

| 名稱 | 簽章 | 說明 |
|---|---|---|
| `configure({ cache })` | `void` | `cache`：模型的 Cache API 名稱；網頁先下載好存在那裡，Worker 直接讀；不設就由 Worker 自己下載 |
| `warm()` | `Promise<void>` | 背景下載並載入 onnxruntime 和模型（約 12 MB，之後由瀏覽器快取）；失敗不丟錯（真的偵測時會再試、再回報） |
| `detect(canvas, status?, { size }?)` | `Promise<{ boxes }>` | `boxes`：`[[x0, y0, x1, y1, score], …]`，座標是 `canvas` 的像素；`status(key)` 收到 `'detDownload'`（下載模型）、`'detFinding'`（偵測中）。`size`：模型輸入大小，`1280`（預設）、`2048`、`2560`；長邊 3000 px 左右的岩館照片用 2560 小岩點抓得比較多（約慢 6 倍） |

錯誤：`detect` 失敗時 reject 一個 `Error`，`error.download === true` 表示下載模型（或載入 onnxruntime）失敗；Worker 本身載入失敗時所有進行中的呼叫都 reject，下一次呼叫會重開 Worker。副作用：建立 Worker、`createImageBitmap(canvas)`（轉移所有權）、下載模型。

### 4.2 `HoldDetectCore`（`core/detect-core.js`）

| 名稱 | 說明 |
|---|---|
| `MODEL` | `'freeclimbs'`（模型檔名） |
| `MODEL_SIZE` | `1280`（預設輸入大小） |
| `SIZES` | `[1280, 2048, 2560]`（接受的輸入大小） |
| `scaleFor(w, h, S = MODEL_SIZE)` | 縮放比例 `S / max(w, h)`（等比縮放、貼到左上，其餘補灰 114） |
| `toTensorData(rgba, S = MODEL_SIZE)` | 已縮好貼在左上的 S×S RGBA → NCHW float32（0–1），長度 `3·S·S` |
| `postprocess(data, r)` | 模型輸出 `[1, 5, N]`（cx, cy, w, h, score）→ 照片座標的框 `[x0, y0, x1, y1, score]`，已套用分數門檻與去重複框；`r` 是 `scaleFor` 的值 |

### 4.3 Node：`functions/handler.js`

| 名稱 | 說明 |
|---|---|
| `detect(buf, S = 1280)` | `Promise<{ boxes, w, h, ms }>`。`buf`：JPEG／PNG 位元組；`sharp` 解碼、縮放，onnxruntime-node（CPU）推論；`w`、`h` 是原照片大小。第一次呼叫載入模型 |
| `createHandler({ verify, takeQuota?, allowOrigin })` | 回傳 Express 風格的 `(req, res)`：`verify(req)` 回傳 uid、失敗要丟錯（回 401）；`takeQuota(uid)` 回傳 `false` 就回 429（沒給就不限）；`allowOrigin(origin)` 決定 CORS |
| `CPUS` | 推論執行緒數（環境變數 `DETECT_CPUS`，預設 2） |

### 4.4 HTTP 介面

`POST <你自架的網址>`（Climbio 不再提供公開的雲端偵測端點，網站改用手機上的瀏覽器版）

- 標頭：`Authorization: Bearer <token>`。部署成 Firebase 函式時要非匿名帳號的 ID token（匿名登入回 401）和 `X-Firebase-AppCheck`；自架版 `AUTH=key` 時是 `API_KEY`。
- 內容：`{ "img": "<JPEG 或 PNG 的 base64>", "size": 1280 }`。`size` 是 `1280`（預設）、`2048`、`2560`，越大小岩點抓得越多、越慢；傳原尺寸，長邊建議最多 2048（用戶端先縮小再壓 JPEG 會漏掉分數接近門檻的岩點）。圖片最大 6 MB。
- 回傳：`{ "model": "freeclimbs-1280", "boxes": [[x0, y0, x1, y1, score], …], "w", "h", "ms", "source": "<原始碼網址>" }`，框是收到的照片座標。
- 狀態碼：400 格式錯（`img` 不是字串或 `size` 不在 `SIZES`）、401 驗證失敗、413 圖片太大、429 超過每日次數（Firebase 版每帳號每天 30 次，`{ "error": "quota" }`）、405 非 POST／GET／OPTIONS、500 偵測失敗（詳細原因只在伺服器紀錄）。
- `GET` 同一網址＝預熱：載入模型後回 204（不帶照片、不用登入、不算次數）。
- 照片只在記憶體中處理，不存檔、不留紀錄、不用來訓練。

自架（`functions/server.js`，不需要 Firebase；記憶體至少 2 GB）：

```bash
docker build -t holdscan-detect .
docker run -p 8080:8080 -e API_KEY=換成你的密鑰 -e ORIGINS=https://你的網站 holdscan-detect
# 不用 Docker：cd functions && npm install && API_KEY=換成你的密鑰 node server.js
```

| 環境變數 | 說明 |
|---|---|
| `AUTH` | `key`（預設，`Authorization: Bearer` 要等於 `API_KEY`）、`firebase`（非匿名帳號的 ID token）或 `none`（只在本機或私人網路用） |
| `API_KEY` | `AUTH=key` 的密鑰 |
| `ORIGINS` | 允許跨網域呼叫的網站，逗號分隔；`*` 是全部 |
| `DETECT_CPUS` | 推論執行緒數，照分到的 vCPU 設（預設 2） |
| `PORT` | 預設 8080 |

一般伺服器版沒有每日次數限制；公開架設時用 `AUTH=key`，或在前面的閘道限流。

### 4.5 離線 CLI（`cli/analyze.js`）

```bash
cd holdscan/cli && npm install
node analyze.js 牆面照片.jpg [--routes routes.json] [--size 1280|2048|2560] > holds.json
```

| 參數 | 說明 |
|---|---|
| 第一個非旗標參數 | 照片路徑（必填；多給會丟 `unknown argument`） |
| `--size` | 偵測輸入大小，必須在 `SIZES` 內；手機廣角、岩點小的照片用大一點 |
| `--routes` | 圈點格式的路線（例如 RouteMake：`[{ id, name, …, holds: [{ x, y, t, r }] }]`，或 `{ routes: [...] }`；`x`、`y` 是百分比座標，`r` 是圈圈大小） |

- 流程：偵測 → 依顏色描外框（holdkit）→ MobileSAM 整面牆重描 → 整理外框（`functions/tidy.js`）。圈圈中心沒對到偵測到的岩點，就用圈圈範圍多描一顆（id `c1`、`c2`…）。
- 輸出（stdout，一行 JSON）：`{ w, h, thumb: '', holds }`，格式見 `holdkit/SPEC.md`；有 `--routes` 時多一個 `routes`，每條的 `holds` 換成岩點 id（其他欄位照抄，由 `routekit/circles.js` 轉換），交給 RouteKit 就能畫。
- 失敗：訊息印到 stderr、結束碼 1（例如 `--routes: expected [{ holds: [{ x, y, t, r }] }]`、`--size must be one of …`）。
- 在整個 repo 裡跑，或只複製 `holdscan/`、`holdkit/`、`routekit/` 和 `functions/tidy.js`（相對位置不變）。`npm install` 時 npm 若提示 `onnxruntime-node` 的 install script 沒執行，可以忽略。
- 資源：一面 1500 px 的牆、600 多顆岩點，M1 約 50 秒、記憶體約 1 GB；`SAM_CPUS` 是重描的解碼 Worker 數（預設 2）。
- 模組匯出：`require('./analyze.js').analyze({ photo, routes, size })`，回傳 Promise（資料包物件）。

## 5. 資料格式與不變條件

- **框**：`[x0, y0, x1, y1, score]`，`x0 < x1`、`y0 < y1`；座標是收到的照片（或畫布）像素；`score` ≥ 0.25。
- **模型**：輸入 `images` `[1, 3, S, S]` float32（RGB、0–1、等比縮放貼左上、補灰 114）；輸出 `output0` `[1, 5, N]` = cx, cy, w, h, score；`S` 可變，接受 1280、2048、2560。
- **後處理**（`core/detect-core.js`）：分數門檻 0.25；重疊比例（IoU）超過 0.5，或一個框有 75% 落在另一個面積比小於 2.5 的框裡，視為同一顆岩點，留分數高的。門檻與去重複規則雲端版、瀏覽器版、CLI 共用。
- 瀏覽器版的縮圖用瀏覽器的 canvas，雲端版用 sharp，結果會差一兩顆。
- 輸出的岩點資料包格式見 `holdkit/SPEC.md`（`source` 都是 `detect`）。

## 6. 最小可跑範例

瀏覽器（把下面五個檔案原樣放在網站上，相對位置不變，再開頁面）：

```
holdkit/ort.js
holdscan/browser/holdscan.js
holdscan/browser/worker.js
holdscan/core/detect-core.js
holdscan/models/freeclimbs.onnx
```

```html
<script src="holdscan/browser/holdscan.js"></script>
<script>
  HoldScan.warm();   // 選照片前先在背景載入
  async function run(canvas) {
    const { boxes } = await HoldScan.detect(canvas, (key) => console.log(key));
    return boxes;    // [[x0, y0, x1, y1, score], ...]，canvas 的座標
  }
</script>
```

repo 裡可以直接跑的版本是 `browser/example.html`：在 repo 根目錄 `python3 -m http.server 8765`，打開 `http://localhost:8765/holdscan/browser/example.html`，選一張岩牆照片就畫出框。

Node（`cd holdscan/functions && npm install` 之後；存成 `detect.js`，放在 repo 根目錄（`holdscan/` 的上一層）執行）：

```js
const fs = require('fs');
const { detect } = require('./holdscan/functions/handler.js');
detect(fs.readFileSync('wall.jpg')).then(({ boxes, w, h }) => { console.log(`${boxes.length} holds in ${w}x${h}`); process.exit(0); });
```

## 7. 限制與已知取捨

- **外部需求**：模型檔（約 12 MB）；瀏覽器版要連到 jsDelivr 載入 onnxruntime-web；CLI 與服務要 Node 22 與 `npm install`（`functions/`、`cli/` 各自有 `package-lock.json`）。
- 瀏覽器版只有 CPU（wasm、單執行緒，因為站台沒開 `crossOriginIsolated`）、輸入固定 1280，沒有 `size` 選項；雲端版與 CLI 才能選 2048、2560。
- `HoldScan` 用 `document.currentScript.src` 找 `worker.js`：必須用一般 `<script src>` 載入，不能用動態 `import` 或打包。
- Worker 內用 `importScripts('../../holdkit/ort.js', '../core/detect-core.js')`，相對位置不能變。
- Firebase 版（`functions/index.js`）部署時把 `core/`、`models/` 複製進 `functions/vendor/`；`server.js` 與 CLI 沒有 `vendor/` 時直接讀 repo 的 `core/`、`models/`。
- 一般伺服器版沒有每日次數限制。
- 分數門檻提高會漏掉跟牆面顏色接近的岩點，降低多出來的大多是牆上的字和岩點的影子（用岩館實際照片看過）。
- 模型作者公開的是 freeclimbs v2 測試成績，訓練資料未公開，無法重現（見 `models/README.md`）。

## 8. 驗證

holdscan 沒有單元測試，驗證靠一個瀏覽器案例（需要網路：onnxruntime-web 從 jsDelivr 載入、CLI 要 `npm install`，連不到會跳過；模型推論是重工作，一次只跑一個）：

| 檢查 | 指令 |
|---|---|
| 瀏覽器版：只用本 README 列的五個檔案，範例頁偵測示範牆；CLI：在只有 `holdscan/`、`holdkit/`、`routekit/`、`functions/tidy.js` 的複本裡，照片 → 岩點資料包 | 內部 e2e 案例（Windows 用 `python`） |
| Worker 與瀏覽器檔案的語法（`holdscan/browser/*.js`、`core/detect-core.js`） | `node tools/check.mjs` |
