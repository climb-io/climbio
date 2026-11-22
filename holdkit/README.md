# holdkit

English: [README.en.md](README.en.md)

## 1. 用途

攀岩牆岩點階段的分析：偵測框 → 岩點外框、MobileSAM 重描外框、顏色名稱、建議裁切；岩點資料包的格式（[SPEC.md](SPEC.md)）也在這裡。

- **該用**：手上有岩點偵測框（`[x0, y0, x1, y1]`，座標是照片像素），要變成岩點外框 `poly`、算顏色名稱、建議裁切範圍；或要自己架 MobileSAM 重描服務。
- **不該用**：照片 → 偵測框（那是 `holdscan/`，AGPL-3.0，holdkit 不含也不呼叫它）；路線怎麼畫（`routekit/`）；一般影像處理。

## 2. 授權與依賴規則

- AGPL-3.0（`LICENSE`）。第三方元件（MobileSAM、Acly 的 ONNX 匯出、ONNX Runtime）見 `NOTICE`、`models/README.md`、`models/LICENSE-MobileSAM`。
- 可以 import：只有瀏覽器／Node 內建與本資料夾的檔案；`holdkit.js` 沒有任何依賴。
- 不可以 import：`holdscan/`、App 的 `js/`（AGPL-3.0）、其他 kit（kit 彼此獨立）。
- 不用 `state`、DOM 元素 id、IndexedDB 以外的 App 狀態、品牌；照片、框、外框都從參數傳入。
- `functions/`（雲端重描服務）有自己的 `package.json` 與相依套件（express、onnxruntime-node、sharp…），不屬於 npm 套件內容。

## 3. 檔案地圖

| 路徑 | 責任 |
|---|---|
| `holdkit.js` | 分析函式：外框、顏色、裁切建議。UMD：瀏覽器全域 `HoldKit`，Node `require` |
| `index.mjs`、`index.d.ts` | ESM 入口（具名匯出與 `holdkit.js` 相同）與型別 |
| `samrefine.js`、`samrefine.d.ts` | 瀏覽器的 MobileSAM 重描（全域 `HoldRefiner`）；載入就有副作用 |
| `samworker.js` | Worker：跑 MobileSAM 解碼器（CPU） |
| `ort.js` | 從 jsDelivr 載入 onnxruntime-web（先核對 SRI 雜湊）；Worker 用 `importScripts` + `await loadOrt()` |
| `models/` | `mobilesam-decoder.onnx`（16 MB，瀏覽器下載）、`mobilesam-encoder.onnx`（28 MB，雲端用；沒有雲端時瀏覽器下載）、`README.md`、`LICENSE-MobileSAM` |
| `functions/` | 雲端重描 `retrace`：`handler.js`（跟平台無關）、`index.js`（Firebase 版）、`server.js`（一般 Node 伺服器版）、`sam.js`、`decode.js` |
| `Dockerfile` | `server.js` 的容器映像 |
| `SPEC.md` | 岩點資料包 v2 的格式 |

npm 套件（`@climbio/holdkit`）的 `files` 清單：`holdkit.js`、`index.mjs`、`index.d.ts`、`samrefine.js`、`samrefine.d.ts`、`samworker.js`、`ort.js`、`models/mobilesam-decoder.onnx`、`models/mobilesam-encoder.onnx`、`models/README.md`、`models/LICENSE-MobileSAM`、`SPEC.md`、`README.md`、`README.en.md`、`LICENSE`、`NOTICE`。`functions/` 不在套件裡。

## 4. 公開 API

座標一律是照片像素；外框 `poly` ＝ `[[x, y], …]`。

### 4.1 `HoldKit`（`holdkit.js`，`import HoldKit from '@climbio/holdkit'` 或具名匯出）

| 名稱 | 簽章 | 說明 |
|---|---|---|
| `VERSION` | `string` | 與 `package.json` 的版本一致（目前 `1.9.0`） |
| `SAME_DE` | `number` | 選同色的色差門檻，14 |
| `COLOR` | `Record<string, [r, g, b]>` | 顏色名稱 → 代表 RGB。key 是中文：白、灰、黑、黃、橙、紅、粉、紫、藍、蒂芬妮、綠（顯示時由呼叫端翻譯） |
| `bbox(poly)` | `{ x0, y0, x1, y1 }` | 外框的邊界框 |
| `centroid(poly)` | `[x, y]` | 頂點平均（不是面積重心） |
| `tracePoly(ctx, poly)` | `void` | 在 Canvas 2D context 上 `moveTo`／`lineTo`／`closePath`；不 `beginPath`、不填色 |
| `simplifyPoly(poly)` | `Poly` | 合併太近的頂點（小於外框大小 8%），再 Douglas–Peucker（偏差小於 3.5%）；4 點以下原樣回傳 |
| `toLab(data, n)` | `Float32Array`（每像素 3 個數） | RGBA 像素 → Lab；回傳的 **L 乘了 0.5** |
| `repColor(lab, n, use)` | `[L, a, b] \| 0` | `use(pixelIndex)` 為真的像素中彩度最高的一半取中位數；回傳整數且 **L 已換回真值**；用到的像素少於 3 個回傳 `0` |
| `colorName([L, a, b])` | `string` | 代表色 → `COLOR` 的 key。L 要是真值，所以從 `toLab` 來的要乘 2 |
| `analysis(img, W, H, createCanvas?)` | `{ data, w, h, s }` | 分析用縮圖：長邊最多 1200，`s` ＝ 縮圖 ÷ 照片。`img` 是 `CanvasImageSource`；預設用 `document.createElement('canvas')`，沒有 `document` 用 `OffscreenCanvas`，Node 傳 `createCanvas`（如 node-canvas）；也可以自己組出同形狀的物件 |
| `outlineContext(ana, boxes)` | `OutlineContext` | 整張 Lab（第一次算好存在 `ana.lab`）與每個像素被幾個框蓋到；同一張照片的所有框共用一份 |
| `boxToPoly(x0, y0, x1, y1, ctx)` | `Poly` | 偵測框 → 外框（凸包，座標小數 1 位）。不丟錯：框在縮圖上小於 5 像素、岩點像素少於 30、最大連通區域小於框的 10% 時，回傳框的內切橢圓（20 點，半徑 90%） |
| `cropSuggest(boxes, W, H)` | `{ x, y, w, h } \| null` | 建議裁切（牆面範圍）。少於 30 個框回傳 `null`；`boxes[i][4]`（分數）≥ 0.4 的有 10 個以上才只看它們，否則全部；四邊取 2%／98% 分位數，再外留照片寬高的 4% |

型別（`index.d.ts`）：`Point`、`Poly`、`DetectBox`（`[x0, y0, x1, y1, ...number[]]`）、`Lab`、`HoldPackHold`、`HoldPack`、`Analysis`、`OutlineContext`。

### 4.2 `HoldRefiner`（`samrefine.js`，只在瀏覽器；`import '@climbio/holdkit/samrefine.js'`）

載入後掛在 `globalThis.HoldRefiner`（Node `require` 不會丟錯，但沒有 DOM 不能用）。

| 名稱 | 簽章 | 說明 |
|---|---|---|
| `configure(cfg)` | 回傳目前設定 | 第一次用之前呼叫。`t(key, ...args)` 訊息翻譯（不給用內建英文）；`db` IndexedDB 名稱（預設 `holdkit-sam`）；`cloudUrl`（網址，或回傳網址的函式；空的＝這次不用雲端）、`idToken(forceRefresh?)`、`appCheck(forceRefresh?)` 雲端重描；`base` holdkit 資料夾網址（`samworker.js`、`ort.js` 所在，不給就用載入 `samrefine.js` 的 `<script>` 所在資料夾，打包工具 import 時必須給）；`decoder`、`encoder` 解碼器、編碼器模型網址（預設 `base` 底下 `models/mobilesam-decoder.onnx`、`models/mobilesam-encoder.onnx`）；`modelCache` Cache API 名稱（模型下載完整才存，下次先讀） |
| `traceWall(src, key, items, status?, { onHolds?, localFallback? })` | `Promise<{ id, poly \| null }[]>` | 整面牆重描：有雲端送雲端；沒有雲端（`cloudUrl` 空的或沒給 `idToken`）或雲端失敗（重試完仍失敗、超過次數）就在 Worker 裡下載編碼器分析照片（存過不再下載），再一顆顆解碼。`localFallback: false`：有雲端時，雲端失敗就丟錯，不在這台描整面牆（`items` 為空陣列時照舊在這台分析照片）。雲端失敗過的 `key` 在這個頁面開著時不再問雲端（`traceWall`、`refine` 直接在這台分析照片；`localFallback: false` 的整面牆重描丟 `samCloudFailed`），`forget(key)`、`clear()` 或重新載入頁面才再試。`src` 是畫布／圖片／ImageBitmap；`key` 是這張照片的識別（例如牆面 id，照片特徵存在 IndexedDB 用它當 key）；`items` ＝ `[{ id, poly, box? }]`（`box` 是提示框，不給用 `poly` 的外框；`items` 為空陣列＝只要照片特徵）。雲端時照片縮成長邊 1024 JPEG 上傳；`onHolds(part)` 每 0.3 秒收到一批；全部描完才 resolve，切不出來的 `poly` 是 `null` |
| `refine(src, key, poly, status?, { box?, point? })` | `Promise<Poly \| null>` | 單顆重描（Worker，只跑解碼器）。提示用 `poly` 的外框，或 `box`，或 `point: [x, y]`（沒偵測到的岩點，此時 `poly` 傳 `null`）。這張照片沒有特徵就先向雲端要（沒有雲端就在 Worker 裡分析）。同一張照片、同一個提示共用同一個 Promise。一次只做一顆，照順序排隊 |
| `warm()` | `void` | 背景下載、載入解碼器，接著編碼器（雲端不能用時在這台分析照片）；失敗不丟錯 |
| `hasEmb(key)` | `Promise<boolean>` | 有沒有這張照片的特徵 |
| `forget(key)` | `Promise<void>` | 刪掉一張照片的特徵 |
| `clear()` | `Promise<void>` | 刪掉全部 |
| `stats` | 物件 | `download`、`load`、`decode`（最近一顆）、`decodes`、`cloud`（雲端各段時間）、`encode`、`local`（沒有雲端時分析照片、整面牆的時間） |

`status(text, progress)`：`progress` 是 0–1 或 `null`，下載模型、向雲端要特徵時回報。

錯誤（`Error.message`）：
- `HoldRefiner: base not configured`：找不到 `base`。
- 離線：用雲端時 `traceWall` 丟 `samOffline` 訊息；`navigator.onLine === false` 時不送出。沒有雲端時模型存過就不用網路。
- `retrace: stream cut`、`retrace: no embedding`、`retrace: bad embedding`：雲端回傳不完整或格式不對。
- HTTP 失敗以 `HTTP <狀態碼>` 的 Error 丟出。`traceWall` 遇到 401 先強制更新權杖重送一次；超過每日次數（429 `{ "error": "quota" }`）不重試，丟 `samQuota` 訊息；其他失敗（含其他 429、500、串流中斷）最多重試 3 次（間隔 3、6、12 秒），`HTTP 400`、`401`、`413` 不重試；已描好的岩點不重送。單次請求逾時 290 秒。
- 解碼器逾時：`samTimeout` 訊息。

副作用：寫 IndexedDB（照片特徵 int8，約 1 MB／張）、建立 Worker、下載模型、用雲端時對 `cloudUrl` 發 `fetch`。

### 4.3 雲端重描 HTTP 介面（`functions/`）

`POST <cloudUrl>`

- 標頭：Firebase 版（`index.js`）以 `X-Firebase-AppCheck` 驗證請求，依網路來源雜湊限流；不要求帳號 token。自架版的 `AUTH=key` 可另外使用 `Authorization: Bearer <API_KEY>`。
- 內容：`{ "img": "<JPEG base64，長邊 1024>", "holds": [{ "id", "box": [x0, y0, x1, y1], "c": [cx, cy] }] }`（座標是送上來的照片座標；`holds` 可為空，最多 3000 顆；請求最大約 6 MB）。
- 回傳：`{ "holds": [{ "id", "poly" }], "emb": { "q": "<base64，256×64×64 個 uint8>", "lo": [256], "sc": [256], "w", "h" }, "ms": {…} }`；`emb` 每個通道 `lo + q × sc`（int8 量化）。
- `Accept: application/x-ndjson`：一行一個 JSON，先 `{ "emb" }`，接著每 0.3 秒一批 `{ "holds": […] }`，最後 `{ "ms" }`；中途出錯是 `{ "error" }`，沒有最後那行就是斷掉。`HoldRefiner.traceWall` 用這個。
- 狀態碼：401 驗證未通過、429 超過每日次數（Firebase 版每個網路來源每天 30 次，`{ "error": "quota" }`）、400 格式錯、413 照片太大、405 非 GET／POST／OPTIONS、500 重描失敗。
- `GET` 同一網址＝預熱，回 204（不帶資料，不計入每日次數）。
- 照片只在記憶體中處理，不存檔、不寫進紀錄。

自己架設（`functions/server.js`，不需要 Firebase；記憶體至少 4 GB）：

```bash
docker build -t holdkit-retrace .
docker run -p 8080:8080 -e API_KEY=換成你的密鑰 -e ORIGINS=https://你的網站 holdkit-retrace
# 不用 Docker：cd functions && npm install && API_KEY=換成你的密鑰 node server.js
```

| 環境變數 | 說明 |
|---|---|
| `AUTH` | `key`（預設，`Authorization: Bearer` 要等於 `API_KEY`）、`firebase`（ID token）或 `none`（只在本機或私人網路用） |
| `API_KEY` | `AUTH=key` 的密鑰 |
| `ORIGINS` | 允許跨網域呼叫的網站，逗號分隔；`*` 是全部 |
| `SAM_CPUS` | encoder 執行緒數和解碼 Worker 數，照分到的 vCPU 設（預設 8） |
| `PORT` | 預設 8080 |

App 端把 `configure` 的 `cloudUrl` 指向服務；Firebase 版使用 App Check 權杖，每個網路來源每天最多 30 次（`functions/retrace-auth.js`）。自架且採 `AUTH=key` 的伺服器則依部署設定提供憑證。

## 5. 資料格式與不變條件

岩點資料包 v2（完整規格見 `SPEC.md`）：

```json
{ "w": 4032, "h": 3024, "thumb": "data:image/jpeg;base64,…",
  "holds": [ { "id": "h12", "poly": [[812.5, 640.1], [850, 652.3], [838.2, 700]], "source": "detect", "t": 1760000000000 } ] }
```

- 座標是照片原尺寸像素，左上角 0,0；`w`、`h` 是照片寬高；`thumb` 是長邊 480 的 `data:image/...` 網址，可以是空字串。
- `holds[].id`：牆內唯一的字串（路線用它指岩點）；`poly`：至少 3 點、小數最多 1 位；`source`：`detect`、`edited`、`manual`；`t`：最後修改毫秒，可省略。
- 外框就是岩點本身：看線時整個外框用照片原本的顏色，不逐像素判斷。
- 讀的人忽略不認得的欄位；欄位意義或結構改了就升版本號。
- 顏色的 Lab：`toLab` 的 L 是減半的（陰影、反光較不會被當成不同顏色）；`repColor` 的輸出、`colorName` 的輸入是真 L。
- 照片特徵（`emb`）每張照片一份，以呼叫端給的 `key` 存在 IndexedDB；`w`、`h` 必須與重描時的照片縮圖大小一致，否則視為壞資料。

## 6. 最小可跑範例

Node（ESM，不需要畫布：自己組分析用縮圖；`npm install @climbio/holdkit` 後存成 `demo.mjs`，`node demo.mjs`，預期印出 `12 紅 null`）：

```js
import HoldKit from '@climbio/holdkit';

const W = 200, H = 200, data = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const inside = (x - 100) ** 2 + (y - 100) ** 2 < 40 ** 2;
  data.set(inside ? [205, 30, 40, 255] : [200, 200, 195, 255], (y * W + x) * 4);   // 紅色岩點、灰牆
}
const ana = { data, w: W, h: H, s: 1 };
const box = [55, 55, 145, 145];
const ctx = HoldKit.outlineContext(ana, [box]);
const poly = HoldKit.simplifyPoly(HoldKit.boxToPoly(...box, ctx));
const lab = HoldKit.toLab([205, 30, 40, 255], 1);
console.log(poly.length, HoldKit.colorName([lab[0] * 2, lab[1], lab[2]]), HoldKit.cropSuggest([box], W, H));
```

瀏覽器（把套件資料夾放在網站上；`analysis` 吃畫布）：

```html
<script src="holdkit/holdkit.js"></script>
<script src="holdkit/samrefine.js"></script>
<script>
  const ana = HoldKit.analysis(photoCanvas, W, H);
  const octx = HoldKit.outlineContext(ana, boxes);
  const holds = boxes.map(([x0, y0, x1, y1], i) => ({ id: `h${i}`, source: 'detect',
    poly: HoldKit.simplifyPoly(HoldKit.boxToPoly(x0, y0, x1, y1, octx)) }));

  // 選用：MobileSAM 重描（要有 cloudUrl 的重描服務）
  HoldRefiner.configure({ base: '/holdkit/', cloudUrl: RETRACE_URL, idToken: () => token });
  const res = await HoldRefiner.traceWall(photoCanvas, 'wall-1', holds.map((h, i) => ({ id: h.id, poly: h.poly, box: boxes[i] })),
    undefined, { onHolds: (part) => draw(part) });
  const one = await HoldRefiner.refine(photoCanvas, 'wall-1', holds[0].poly);
</script>
```

## 7. 限制與已知取捨

- **畫布**：`analysis` 需要畫布（瀏覽器 `<canvas>`、Worker `OffscreenCanvas`、Node 的 node-canvas 或自己組物件）；`boxToPoly` 與其餘函式是純計算。
- **MobileSAM 重描是選用的**：需要 Worker（`samworker.js`）、ORT 載入器（`ort.js`，從 jsDelivr 載入 onnxruntime-web，要連網）、解碼器模型都放在網站上（`configure({ base })`）；照片特徵要由重描服務（自己架 `functions/` 或用 Climbio 的雲端）算出來，沒有就不要呼叫 `HoldRefiner`，外框照樣可用。
- 解碼只用 CPU（手機 GPU 實測會算錯）；一次一顆，排隊執行。
- 瀏覽器 vs Node：`samrefine.js` 只能在瀏覽器用（需要 `document`、`Worker`、IndexedDB）；`holdkit.js` 兩邊都能用。
- `boxToPoly` 對低對比、岩點與牆同色的框會退回橢圓；是否重新辨識由 App 決定（改了演算法，同版本號的結果固定，不同版本結果不同）。
- 模型超過 jsDelivr 單檔上限，所以 App 依 git 標記（`v1.x.x`）下載整個資料夾，不用 CDN。

## 8. 驗證

| 檢查 | 指令 |
|---|---|
| 套件匯出一致（ESM 具名匯出＝CJS、型別檔宣告每個匯出、`files` 列的檔案都在、版本一致、伺服器端載入不壞） | `node --test tools/kit-packages.test.mjs` |
| 裁切建議 | `node --test tools/crop-suggest.test.mjs` |
| 重描預載（`sam-preload`） | `node --test tools/sam-preload.test.mjs` |
| 外部頁面只裝套件做外框、建議裁切、顏色（需要 Playwright 瀏覽器） | 內部 e2e 案例（Windows 用 `python`） |
| 全部快速檢查 | `node tools/check.mjs && node --test tools/*.test.mjs` |
