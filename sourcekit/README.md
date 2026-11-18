# sourcekit（@climbio/sourcekit）

[English](README.en.md) | 繁體中文

## 1. 用途

外部資料來源（站台、瀏覽器擴充、匯入器）共用的純函式：Topo 照片尺寸規則、合成預覽圖版面與畫布、來源 id、Topo 照片上的路線描線與號碼牌辨識、OpenClimbing／OSM／Wikimedia Commons 的讀取。

- 該用：要把外站的岩場轉成 Climbio 格式 v2（見 [format/](../format/README.md)）、要從 Topo 照片抽出路線線段、要算同一個來源在擴充與 App 都一樣的 id。
- 不該用：要讀寫或驗證 Climbio 檔案（用 `format/`）、要在 App 內畫路線（用 `routekit/`）。

## 2. 授權與依賴規則

- 授權：AGPL-3.0（`LICENSE`、`NOTICE`）。`badge-digits.js` 的數字樣板：0、2～9 是 Liberation Sans Bold（SIL OFL 1.1，Copyright Red Hat, Inc.）字形縮成 16×24 的格子，1 是從路線書號碼牌取的平均；其餘無第三方程式、模型或資料。
- 沒有相依套件、沒有建置步驟，ESM（`"type": "module"`）。
- 可以 import 的只有本資料夾自己的檔案與瀏覽器／Node 的標準全域。不可以 import 或引用 AGPL 的程式（App 的 `js/`、`holdscan/`）、產品（`studio/`、`redpoint/`、`extension/`）、Climbio 後端或其他 kit。
- 被複製到別處：`tools/sync-extension.mjs` 把本資料夾的全部 `.js` 複製到 `extension/sourcekit/`（擴充打包成 ZIP 時不能往外 import），檔頭加一行「這是複製」的橫幅。**改了 `sourcekit/` 要跑 `node tools/sync-extension.mjs`**；不要直接改 `extension/sourcekit/`。`node tools/sync-extension.mjs --check` 只檢查有沒有同步。
- `index.js` 只把純運算的部分轉出（`photo-size`、`preview-layout`、`trace`、`ids`）；要畫布的 `preview-sheet.js`、讀網路的 `openclimbing-read.js`、`badge-digits.js` 各自單獨 import。

## 3. 檔案地圖

| 檔案 | 責任 |
|---|---|
| `index.js` | 轉出 `photo-size`、`preview-layout`、`trace`、`ids` |
| `index.d.ts` | 型別：轉出 `ids`、`photo-size`、`preview-layout`、`trace` |
| `ids.js`、`ids.d.ts` | 來源字串 → 16 碼 id（`idOf`） |
| `pool.js` | `pool(items, n, work)` 並行池與 `sha256`；瀏覽器擴充也用 |
| `photo-size.js`、`photo-size.d.ts` | Topo 照片尺寸規則：長邊上限、下限、縮圖（`fitSize`、`fitImage`…） |
| `preview-layout.js`、`preview-layout.d.ts` | 合成預覽圖 `preview.jpg` 的版面常數與位置計算（不碰畫布） |
| `preview-sheet.js`、`preview-sheet.d.ts` | 用 `OffscreenCanvas` 畫預覽圖、裁入口照片；同時轉出 `preview-layout.js` |
| `trace.js`、`trace.d.ts` | 路線描線：像素（RGBA）→ 折線，另有號碼牌偵測 |
| `badge-digits.js`、`badge-digits.d.ts` | 號碼牌白色數字 0～9 的樣板比對（`readBadgeText`、`DIGIT_CELLS`），`trace.js` 內部使用 |
| `openclimbing-read.js`、`openclimbing-read.d.ts` | OpenClimbing／OSM／Wikimedia Commons 的唯讀轉換：岩場、路線、Topo 照片、線 |

## 4. 公開 API

### ids（`index.js`）

| 名稱 | 簽章 | 說明 |
|---|---|---|
| `idOf` | `(seed: string) => string` | 同樣的來源字串（例如 `osm:relation:123`）永遠得到同樣的 16 碼小寫英數 id（cyrb53 加兩個 seed）；擴充與 App 要算出同一個 id，只放這一份 |

### photo-size（`index.js`）

| 名稱 | 簽章 | 說明 |
|---|---|---|
| `TOPO_EDGE` | `number` = 1600 | 外部 Topo 照片長邊上限（像素） |
| `MIN_EDGE` | `number` = 800 | 長邊下限；再小的圖放大到手機會糊，不收 |
| `COMMONS_REQUEST_WIDTH` | `number` = 1920 | 向 Commons 要的縮圖寬度（Commons 只出標準寬度） |
| `QUALITY` | `number` = 0.85 | 縮圖 JPEG 品質 |
| `fitSize` | `(w, h, edge = TOPO_EDGE) => { w, h }` | 長邊縮到 `edge` 以內、不放大；寬高不是正數就原樣回傳 |
| `isUsableSize` | `(w, h) => boolean` | 長邊是否 >= `MIN_EDGE`；缺值視為不夠 |
| `fitImage` | `(blob: Blob, { edge?, size? }?) => Promise<{ blob, w, h }>` | 縮圖：長邊超過就縮，非 JPEG／PNG 轉 JPEG；`size` 給了就縮成剛好這個大小。需要 `createImageBitmap`、`OffscreenCanvas`。錯誤：圖片解不開時丟出 `createImageBitmap` 的錯 |

### preview-layout（`index.js`；`preview-sheet.js` 也轉出）

| 名稱 | 簽章 | 說明 |
|---|---|---|
| `PREVIEW` | `'preview.jpg'` | 預覽圖檔名 |
| `PREVIEW_W`、`COVER_H`、`TILE_W`、`TILE_H`、`TILE_COLS` | `720`、`540`、`120`、`90`、`6` | 版面常數 |
| `THUMB`、`THUMB_W`、`THUMB_H` | `'thumb.jpg'`、`240`、`180` | 世界地圖圖釘用的縮圖（只有入口照片） |
| `COVER_RECT` | `{ x: 0, y: 0, w: 720, h: 540 }` | 入口照片位置（上半） |
| `previewSize` | `(n) => { w, h }` | `n` 張照片的預覽圖大小 |
| `previewProps` | `(n, href = PREVIEW) => PreviewProps` | 組合的 `props.preview`：`{ href, w, h, count, tile: { w, h, cols, y } }` |
| `tileRect` | `(i) => Rect` | 第 `i` 張（從 0）小圖的格子位置 |

### preview-sheet（單獨 import `./preview-sheet.js`，需要 `OffscreenCanvas`、`createImageBitmap`）

| 名稱 | 簽章 | 說明 |
|---|---|---|
| `drawFit` | `(g, bmp, x, y, w, h) => void` | 照片填滿矩形、多的置中裁掉 |
| `newSheet` | `(n) => { canvas, g }` | `n` 張照片的空白預覽畫布（底色已塗） |
| `paintSheet` | `({ g }, i, bmp) => void` | 第 `i` 張畫上去；第 0 張同時畫入口照片 |
| `buildSheet` | `(blobs: Blob[], quality = 0.8) => Promise<Blob>` | 依序解開照片（同時只解一張）→ 預覽圖 JPEG |
| `cropCover` | `(blob, preview, quality = 0.88) => Promise<Blob>` | 預覽圖上半（`preview.w` × `preview.tile.y`）裁成入口照片 JPEG |

### trace（`index.js`）

輸入 `image` 是 `{ data: Uint8ClampedArray | Uint8Array, width, height }`（RGBA，可以先縮小到 `TRACE_EDGE`）；輸出座標乘 `scale` 回到原圖。`expected` 是照片上預期的路線數（0 表示不知道）。

| 名稱 | 簽章 | 說明 |
|---|---|---|
| `TRACE_EDGE` | `number` = 1200 | 描線前建議縮到的長邊（像素） |
| `traceRed` | `(image, scale = 1, expected = 0) => TracedLine[]` | 紅筆（含黃色接線）；紅筆找不到或比預期少時改用 `tracePen` 補 |
| `traceDiff` | `(annotated, original, scale = 1, expected = 0) => TracedLine[]` | 標註圖減去對齊後的原圖：任何顏色的筆，也找得出 bolt、確保站 |
| `tracePen` | `(image, scale = 1, expected = 0, report?) => TracedLine[]` | 沒有原圖時找細長飽和的任何顏色（白色只當備援）；`report` 傳入陣列可收診斷資料 |
| `traceDashes` | `(image, scale = 1, blocked = []) => TracedLine[]` | 白色虛線；`blocked` 是不用看的範圍 `[{ x, y, size }]`（例如號碼牌） |
| `traceBadges` | `(image, scale = 1) => { point, size, color, text }[]` | 號碼牌（平塗圓角方塊加白字）；`text` 是比對樣板讀到的數字，由左到右排，不是 OCR |
| `traceTopo` | `(image, scale = 1, expected = 0) => { lines, badges }` | 線加號碼牌；每個號碼牌配起點最近的線（`badge.line` 是 `lines` 的索引，沒有就是 `null`） |

`TracedLine = { points: [x, y][], bolts?: [x, y][], anchors?: [x, y][] }`：起點在下面（起攀）；`bolts` 由下往上、`anchors` 由左到右；只標了確保站的路線 `points` 是空的。

### badge-digits（單獨 import `./badge-digits.js`）

| 名稱 | 簽章 | 說明 |
|---|---|---|
| `readBadgeText` | `(image, cx, cy, size) => string` | 讀號碼牌（中心 `cx, cy`、邊長 `size`，同一個像素座標）上的白色數字；沒有字或字太小回傳 `''` |
| `DIGIT_CELLS` | `Record<0..9, { aspect, cells }>` | 樣板（16×24 灰階格子的十六進位字串），測試用 |

### openclimbing-read（單獨 import `./openclimbing-read.js`，需要 `fetch`）

| 名稱 | 簽章 | 說明 |
|---|---|---|
| `isOpenClimbing` | `(url) => boolean` | 是不是 OpenClimbing／OSM 的 node、way、relation 網址，或 `osm:relation:<id>` |
| `parseUrl` | `(url) => { type, id } \| null` | 解析網址；失敗回 `null`，不丟錯 |
| `photosOf` | `(tags) => { title, path }[]` | OSM 標籤裡的 `wikimedia_commons` 照片與線的路徑 |
| `parsePath` | `(path) => [x, y][]` | OpenClimbing 的線字串 → 0..1 的點；任何一段不合格回傳 `[]` |
| `spdxOf` | `(name) => string \| null` | Commons 授權名稱 → SPDX；只認 CC0、公眾領域、CC BY、CC BY-SA，其他是 `null` |
| `commonsInfo` | `(titles, get?, signal?) => Promise<{ info: Map, skipped: number }>` | 批次查 Commons 照片的網址、大小（算成 `TOPO_EDGE` 以內）、授權、作者；授權不收的算進 `skipped` |
| `loadUnits` | `(url, { get?, signal?, keepEmpty? }?) => Promise<{ root, units, skipped }>` | 讀 relation 與它底下的岩場、路線、照片。錯誤：不是 relation 丟 `Error`（`guide: true`，訊息「這一頁不是岩場或區域」）；找不到 relation 丟 `Error`；HTTP 非 2xx 丟 `Error`。`get(url, signal)` 預設用 `fetch`，可注入以便測試 |
| `routeProps` | `(tags) => props` | OSM 路線標籤 → `grade`、`length`、`style`、`description`（沒有的欄位不出現） |

副作用：除 `fitImage`、`preview-sheet.js`（畫布）與 `openclimbing-read.js`（網路請求）之外，全部是純函式，不碰 DOM、不寫儲存。

## 5. 資料格式與不變條件

- 來源 id：`idOf(seed)` 的結果符合 Climbio 格式的檔案 id 規則（16 碼 `[0-9a-z]`）；`seed` 例如 `osm:relation:<id>`，呼叫端要保證同一個來源永遠給同一個字串。
- Topo 照片：長邊 <= 1600、>= 800；文件裡寫的 `w`、`h` 必須等於實際圖檔大小（`fitImage` 的 `size` 用來讓圖對上已寫好的座標）。
- 預覽圖版面：寬 720；上方入口照片 720×540（4:3）；下方小圖每格 120×90、每列 6 格，起點 `y = 540`；組合的 `props.preview` 與照片項目的 `props.tile` 見 `format/VOCABULARY.md`。站台建置用自己的影像工具時，照 `tileRect` 的位置畫。
- 描線座標：`points`、`bolts`、`anchors` 都是原圖像素（已乘 `scale`），不是 0..1。
- 授權資料：Commons 照片只收 CC0／公眾領域／CC BY／CC BY-SA；路線資料是 ODbL（© OpenStreetMap contributors），輸出時要保留來源。

## 6. 最小可跑範例

純函式部分，Node 18 以上直接跑（`npm install @climbio/sourcekit`，存成 demo.mjs）：

```js
import { idOf, fitSize, isUsableSize, previewProps, tileRect } from '@climbio/sourcekit';
import { parsePath, isOpenClimbing } from '@climbio/sourcekit/openclimbing-read.js';

console.log(idOf('osm:relation:123'));                  // 16 碼，每次都一樣
console.log(fitSize(3200, 2400), isUsableSize(700, 500));   // { w: 1600, h: 1200 } false
console.log(previewProps(9), tileRect(7));              // 預覽圖資訊與第 7 格位置
console.log(isOpenClimbing('https://openclimbing.org/relation/123'));   // true
console.log(parsePath('0.2,0.9B|0.3,0.5|0.35,0.1A'));    // [[0.2,0.9],[0.3,0.5],[0.35,0.1]]
```

## 7. 限制與已知取捨

- 瀏覽器與 Node 都能跑純運算；`fitImage`、`preview-sheet.js` 需要 `createImageBitmap` 與 `OffscreenCanvas`（網頁、擴充的 service worker 可用，Node 沒有）；`openclimbing-read.js` 需要全域 `fetch`（或自己傳 `get`）。
- 描線是啟發式：紅筆最準，`traceDiff` 有原圖時最準；任何顏色的 `tracePen` 在雜亂背景會誤判。`expected` 有給時結果不超過它。結果要讓使用者確認，不當成真值。
- 號碼牌數字是樣板比對，不是 OCR：香港攀岩 2025 年 Miniguide 的 171 個號碼牌，讀到的數字落在該頁路線編號裡的有 91%；字型不同的讀不準，呼叫端要拿頁面上的路線編號對照，對不上就不用。
- `loadUnits` 最多遍歷 400 個 relation，OSM 批次每次 500 個 id、Commons 每次 40 個標題。
- `package.json` 的 `exports` 有 `"./*.js"`，所以各檔可單獨 import；沒有 `files` 欄位，npm 會帶整個資料夾。

## 8. 驗證

```bash
node --test tools/sourcekit.test.mjs tools/author-trace.test.mjs
node tools/sync-extension.mjs --check
```

- `tools/sourcekit.test.mjs`：`fitSize` 與 `TOPO_EDGE`、Commons 縮圖與大小換算、`extension/sourcekit` 與本資料夾同步、預覽圖版面。
- `tools/author-trace.test.mjs`：`trace*` 與號碼牌辨識。
- 使用到 sourcekit 的擴充測試：`tools/extension-openclimbing.test.mjs`、`extension-thecrag.test.mjs`、`extension-hkclimbing.test.mjs`、`extension-climbio-site.test.mjs`。
- 提交前跑一次 `npm run test:quick`（涵蓋以上 Node 測試與語法檢查）。
