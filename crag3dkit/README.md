# Crag3DKit（`@climbio/crag3dkit`）

English: [README.en.md](README.en.md)

## 1. 用途

戶外 3D 岩場的播放與讀取：把一個高斯潑濺（`.spz`）或網格（`.glb`）的岩場模型，加上疊在模型上的 3D 路線（帶編號、難度牌子），讓讀者站在步道上看整面岩壁、沿著岩壁走、點路線。資料是 Climbio 公開格式 v2 的 `surface: model` 畫面加路線圖層（見 [format/VOCABULARY.md](../format/VOCABULARY.md) 的「3D 岩場」）。

- **該用**：有 3D 岩場模型和模型上的路線，要在網頁或 App 裡播放；或要從 v2 的檔案找出一個岩場的模型、各面岩壁和鏡頭。
- **不該用**：要用 2D 照片看戶外 Topo（用 `topokit/`）；室內的 3D 牆（用 `wall3dkit/`，格式不同）；要從照片建出 3D 模型（這裡只播放，不重建，也不算路線的 3D 位置）；要編輯路線（沒有編輯功能）。

## 2. 授權與依賴規則

- 授權：AGPL-3.0（`LICENSE`、`NOTICE`）。`vendor/three-splat.js` 是 three.js r180（MIT）和 Spark 2.4.0（MIT）打包成的單一模組，授權全文在 `vendor/three-splat-LICENSE.txt`。
- 可以依賴：瀏覽器的 DOM、WebGL2、WebAssembly（Spark 的排序）、`fetch`、`DecompressionStream`。讀取與遮擋表（`read.js`、`sight.js`、`text.js`）沒有 DOM 依賴，Node 也能用。
- 不可以依賴：Climbio App 的 `js/`、`state`、`t()`、DOM 元素 id、IndexedDB、Firebase、品牌；其他 Kit（Kit 彼此獨立，不 import 其他 Kit，名稱、難度的取法因此各自一份）。
- 不做任何上傳、不連後端；模型與照片的網址由使用方提供。
- 網頁的 CSP 要放行 WebAssembly（`wasm-unsafe-eval`）和 blob 的 worker（Spark 需要）。

## 3. 檔案地圖

| 檔案 | 責任 |
|---|---|
| `index.js` | 入口：讀取、遮擋表、名稱難度、樣式直接匯出；`mountCrag3d` 在呼叫時才載入播放器（three.js、Spark 約 3 MB） |
| `player.js` | 播放器 `mountCrag3d`：鏡頭、手勢、路線與編號牌、遮擋、載入與淡入 |
| `read.js` | `readCrag3d`、`sharedModelId`：從 v2 的檔案找出模型、路線、各面岩壁與鏡頭、全區快照 |
| `sight.js` | 遮擋表：`readSight`（解碼）、`routeVisibility`（每個點從某個位置看得到嗎） |
| `text.js` | `pickName`、`pickGrade`（名稱、難度的取法，跟 TopoKit 同一套規則） |
| `style.js` | 樣式字串 `CSS`、`injectStyle` |
| `vendor/three-splat.js` | three.js 加 Spark 打包成的單一模組（MIT），授權在 `vendor/three-splat-LICENSE.txt` |
| `build-vendor.mjs` | 重建 `vendor/three-splat.js`（連網下載 three.js 與 Spark，用 esbuild 打包，只匯出 `player.js` 用到的名稱） |
| `index.d.ts` | 型別（手寫） |
| `test/unit.test.mjs` | 單元測試：讀格式、遮擋表、名稱難度 |

## 4. 公開 API

座標是模型的 `[x, y, z]`（公尺，y 朝上）。完整型別見 `index.d.ts`。

| 名稱 | 說明 |
|---|---|
| `mountCrag3d(host, options)` | 在 `host` 裡畫一個 3D 岩場；開場快照（`poster`）鋪好就回傳播放器，模型在背景載入。選項：`url`（模型網址或 Promise）、`mime`、`background`（網格時的潑濺背景）、`marks`、`sight`、`nodes`、`areas`（照岩壁順序）、`start`、`intro`（第一次進來：全區快照的鏡頭）、`poster`、`sky`、`onPick(路線 id \| null)`、`onArea(第幾面)` |
| 播放器 | `highlight(id)` 亮起路線、`go(i)` 走到第 i 面、`route(id)` 走到路線前面再 `onPick`、`walk(n)` 沿岩壁往前或往後、`area()`、`posterRect()`、`destroy()` |
| `readCrag3d(docs, modelId, { lang })` | 從這個岩場所有的 v2 檔案找出 `{ model, layers, marks, sight, nodes, owners, areas, overview }`；找不到模型畫面回 `null` |
| `sharedModelId(views)` | Topo 都是同一個模型的快照時回那個模型的 id，否則 `null` |
| `readSight(b64)`、`routeVisibility({ table, spec, pts, from, fill, out })` | 解遮擋表；路線的每個點從 `from` 看得到嗎（回傳 `{ vis, seen }`） |
| `pickName(name, lang)`、`pickGrade(grade, systems)` | 名稱、難度的取法 |
| `CSS`、`injectStyle(host)` | 樣式；路線顏色用 CSS 變數 `--c3d-sport`、`--c3d-sport-on`、`--c3d-other`、`--c3d-other-on` 覆蓋 |

## 5. 資料格式與不變條件

格式寫在 [format/VOCABULARY.md](../format/VOCABULARY.md) 的「3D 岩場」，範例在 `format/examples/crag3d*.json`。播放器依賴的不變條件：

- 模型畫面 `surface: model`，`href` 指到 `.spz`（`mime: model/x-spz`）或 `.glb`（`mime: model/gltf-binary`）；單一檔案 25 MB 以下（Climbio 開放資料集的限制）。
- 路線是模型圖層裡的 `LineString`，座標是模型座標；遮擋表的點數必須等於座標的點數，圖層的 `props.sight` 是規格。沒有遮擋表就不做遮擋。
- 每面岩壁一張快照（`props.model` 記模型 id 和鏡頭），照岩壁節點的 `props.order` 排；岩場（或分區）節點上可有一張全區快照，有就多一段「從全區飛進第一面」的開場。
- 一個岩場一個模型：有路線的 Topo 都是同一個模型的快照，才用 3D 看（`sharedModelId`）。

## 6. 最小範例

讀出一個岩場：

```js
import { readCrag3d } from '@climbio/crag3dkit';

// docs：這個岩場所有的 v2 檔案（組合、畫面、圖層），modelId：模型畫面的 id
const crag = readCrag3d(docs, modelId, { lang: 'en' });
// crag.areas[0]：{ id, name, camera, aspect, routes, snapshot }
```

播放：

```js
import { mountCrag3d } from '@climbio/crag3dkit';

const player = await mountCrag3d(document.querySelector('#view'), {
  url: modelUrl, mime: crag.model.mime, marks: crag.marks, sight: crag.sight, nodes: crag.nodes,
  areas: crag.areas, poster: crag.areas[0].snapshot.href, onPick: (id) => console.log('點到', id),
});
player.route('sample3dr2');   // 走到第二條路線前面
```

## 7. 限制

- 只播放：不從照片建模、不算路線的 3D 位置、不編輯路線。
- 一次載一個模型；一個岩場多個模型（一區一個）還沒有定義。
- 潑濺模型要在手機的記憶體放得下：作者端要裁切、壓小；Android 的點數預算約 100 萬，所以播放器關掉了分層細節（LoD），模型要在這個預算內。
- 路線的 3D 位置靠作者端算好（含遮擋表）；播放器只照資料畫，位置不準要改資料。
- 編號牌、難度籤和線的大小是螢幕上的固定像素：橫的大螢幕（寬大於高）依宿主元素的高度放大（高度 640 px 以上才開始放大，最多 1.9 倍），直放和小視窗維持原尺寸；只在掛載時算一次，掛載後視窗大小改變不會重算。
- 需要 WebGL2、WebAssembly；沒有 WebGL 的環境只會失敗，不會退回 2D（2D 的退路是岩壁快照和 TopoKit）。

## 8. 驗證

- 單元測試：`node --test crag3dkit/test/unit.test.mjs`（也在 `npm run test:quick` 的 `kit-packages`）。
- 型別檔宣告了每個匯出、`package.json` 列的檔案都在、授權檔齊全：`tools/kit-packages.test.mjs`。
- 範例資料合格：`tools/format.test.mjs`（`format/examples/crag3d*.json`）。
- 播放器本身靠瀏覽器：紅點貓的 3D 岩場（`redpoint/`）用它，改了播放器要在手機尺寸實際操作。
