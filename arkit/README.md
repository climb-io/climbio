# ArKit（`@climbio/arkit`）

English: [README.en.md](README.en.md)

## 1. 用途

攀岩牆的 AR 看線：手機瀏覽器開相機對著牆，在本機即時認出是哪一面牆、追蹤鏡頭移動，把路線的岩點疊回相機畫面。只需要一張 2D 牆面照片和岩點外框，不需要 3D 模型，也不需要 App。岩點貓的「AR 看線」就是用它。

- **該用**：有一面 2D 牆的照片與岩點外框（或已經算好的相機比對資料），要在網頁裡用相機即時看路線。
- **不該用**：3D 牆（相機定位在 `3d/`，用 3D 模型）；不開相機、只在照片上看線（用 `routekit/`）。

## 2. 授權與依賴規則

- 授權：AGPL-3.0（`LICENSE`、`NOTICE`）。
- 執行時載入 OpenCV 4.10.0 的 WebAssembly 版本（Apache-2.0，約 10 MB，不隨本資料夾散布；預設 `/redpoint/vendor/opencv-4.10.0.js`，可用 `opencvUrl` 改）。
- 可以依賴：瀏覽器的 DOM、`getUserMedia`、Canvas 2D、Worker、IndexedDB（快取本機算好的相機比對資料）。
- 不可以依賴：Climbio App 的 `js/`、`state`、`t()`、Firebase、品牌；其他 Kit。
- 不做任何上傳：照片只在本機算比對資料，不離開裝置。

## 3. 檔案地圖

| 檔案 | 責任 |
|---|---|
| `index.js` | 入口：匯出下面各檔的公開 API、`Geometry`、`trackerWorkerUrl` |
| `view.js` | `createArView()`：開相機（或測試畫面）、開追蹤 Worker、同一格落地的預覽與疊圖、換線、紀錄、開發工具接線 |
| `view.css` | 舞台、相機畫布、認到牆時把相機畫面轉灰、還沒認到牆時的找牆瞄準框 |
| `overlay.js` | `createArOverlay()`：AR 外觀（只負責畫） |
| `tracker-worker.js` | 追蹤 Worker：OpenCV AKAZE 認牆、單應矩陣、雙向 LK 光流、背景重新對位、本機算相機比對資料（`build_camera`） |
| `geometry.js` | 單應矩陣、驗證、外推、牆面與路線解析（瀏覽器全域 `ArKitGeometry`、Worker、Node 都能用） |
| `camera.js` | 選主鏡頭、cover 視埠、直／橫寬高反過來的處理、等第一個影格（3D 追蹤頁也用） |
| `tracking-log.js` | 追蹤紀錄 `climbio-2d-tracking-log/1`（不含影像） |

## 4. 用法

### 用現成的頁面（iframe）

岩點貓的做法：全螢幕 iframe 開 `/lab/wall2d-cam/?ui=2&auto=1&wall=<牆 id>&route=<岩點 id>:<角色>,…`（`auto=1` 一進來就開相機，不顯示開發工具）。這一頁只是用 ArKit 的殼（`lab/wall2d-cam/app.js`）。

- **牆的資料**：`wall` 在頁面的 `manifest.json`（`climbio-2d-tracking/1`）就直接讀；不在的私人牆，頁面向上層送 `climbio-wall2d-request`，上層回 `climbio-wall2d-data`（`wallId`、`name`、`w`、`h`、`holds: [{ id, poly }]`、`photo`：照片 Blob、`updatedAt`），頁面在本機算相機比對資料並存在 IndexedDB。
- **換線**（同源 `postMessage`）：
  - 頁面 → 上層：啟動時 `climbio-ar-hello`；狀態改變時 `climbio-ar-state`（`located` 認到牆、`running`、`error`）。
  - 上層 → 頁面：`climbio-ar-routes`（`routes: ArRoute[]`、`index`、`labels: { s, t }`）；拖曳中 `climbio-ar-drag`（`p`：-1..1，正＝下一條）；換線 `climbio-ar-index`（`index`、`dir`）。
  - 沒收到 `climbio-ar-routes` 時照網址的 `route` 畫一條。

### 自己的頁面

頁面放好 `#stage`（裡面 `#live-video`、`#live-preview`、`#overlay-canvas`、`#ar-reticle`），宿主元素加 `data-arkit`，載入 `view.css`：

```js
import { createArView } from '@climbio/arkit';
const view = await createArView({ params: new URLSearchParams('auto=1&wall=wanhua'), manifestUrl: '/walls/manifest.json' });
view.setRoutes([{ id: 'a', holds: [['h1', 's', 0], ['h2', 'h', 1], ['h3', 't', 2]] }], 0, { s: '起攀', t: '完攀' });
view.showRoute(1, 1);
```

工具列、狀態、路線選單、紀錄視窗等元素（id 見 `lab/wall2d-cam/index.html`）有就接上，沒有就略過。

## 5. 外觀

- 認到牆：相機畫面轉灰、調暗（只改顯示，畫布像素不變），路線岩點用相機畫面原本的顏色畫回來，加細霓虹外框、柔光與底下一圈深色描邊，亮的牆面上也看得清楚。
- 起攀、完攀加會呼吸的瞄準框和小標籤（起攀在下、完攀在上）；排了出手順序的路線，岩點之間有一條流動的細虛線。
- 認到牆的那一下：牆面四角框收攏、一條掃描線由下往上掃過，路線岩點照出手順序一顆顆描出外框；掉追蹤不到 1.5 秒再認回來不重播。
- 還沒認到牆：畫面中間一個在找的瞄準框（`#ar-reticle`）。
- 減少動態效果時不播動畫。

## 6. 相機與效能

- 預覽和送去追蹤的影像一定是同一個相機影格（只從 `<video>` 拿一次），外框才跟畫面對得上；Worker 慢時預覽先放行，外框用外推的姿態。
- Chromium（Android Chrome 等）用 `VideoFrame` 把影格直接交給 Worker 取灰階，主執行緒不讀像素；iPhone 的 Safari 用 VideoFrame 之後預覽會變黑，所以 WebKit 用 canvas 擷取。
- 固定用主鏡頭（後置相機），先問權限再開（`openMainCamera`）：第一次還看不到鏡頭名稱，先開一次取得權限，顯示前就看名稱，開到別顆就先關掉再開主鏡頭；不在開著相機時換鏡頭（iPhone 兩顆同時開、或同一個 `<video>` 換串流都會黑畫面）。主鏡頭記在 `localStorage` 下次先試。
- 光流在長邊 480 px 上算、認牆在 640 px；低階 Android（OPPO CPH2339）每幀約 30 ms、疊圖約 2 ms。數據見 `docs/2d-tracking.md`。

## 7. 測試

- `node --test tools/tracking2d.test.mjs`：幾何、相機比對資料格式、紀錄。
- `npx playwright test --project=android-chromium lab-wall2d-cam.spec.mjs cam-view.spec.mjs`：認牆、移動中對準誤差（p95 < 3 px）、AR 外觀逐像素、岩點貓的換線。
