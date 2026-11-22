# TopoKit（`@climbio/topokit`）

English: [README.en.md](README.en.md)

## 1. 用途

戶外 Topo 的看圖與編輯：在岩壁照片上畫路線線段、bolt、編號牌（帶難度與名稱），可縮放、點路線；編輯時畫線、放 bolt、移動與刪除節點、分岔、復原／重做。原生 SVG、純 ES module，沒有建置步驟，不連任何後端。

- **該用**：有岩壁照片（Climbio 公開格式 v2 的「照片畫面」加路線圖層），要顯示路線圖或讓使用者畫線、放 bolt。
- **不該用**：室內噴漆牆的岩點路線（用 `routekit/`）；地圖（用 `mapkit/`）；上傳、提交、歷史版本（由使用的 App 負責，本 kit 輸出的是圖層）；萬分比或 App 舊格式的資料（先自行轉成 v2）。

## 2. 授權與依賴規則

- 授權：AGPL-3.0（`LICENSE`、`NOTICE`）；版面演算法移植自龍洞，MIT 聲明在 `NOTICE`。
- 可以依賴：瀏覽器 DOM／SVG、`fetch`（只有 Web Component 讀網址時用）。核心（`renderLines`、資料轉換、幾何）不需要 DOM，Node 可跑。
- 不可以依賴：Climbio App 的 `js/`、`holdscan/`（AGPL）、App 的 `state`、`t()`、DOM 元素 id、IndexedDB、Firebase、品牌。
- kit 彼此獨立，不 import 其他 kit；資料只靠 Climbio 公開格式 v2 的結構，驗證用 `@climbio/format` 的 `validate`。
- 不做任何上傳、不連後端；提交與歷史版本由使用方負責。

## 3. 檔案地圖

| 檔案 | 責任 |
|---|---|
| `index.js` | 入口，re-export 下列各檔 |
| `data.js` | v2 ↔ 路線模型：`readTopo`、`writeLayer`、`assertView`、`pickName`、`pickGrade`、`newId` |
| `lines.js` | 線段規則：共用線段、加點、分岔、移動共用點、刪點 |
| `render.js` | 把路線模型畫成 SVG 字串：`renderLines`、`renderReveal`（沒有 DOM 也能跑） |
| `annotate.js` | 版面：平滑路徑、文字寬度與換行、`Placer`（牌子避讓） |
| `viewport.js` | 縮放、平移、取景、雙擊、滑動的純函式與常數 |
| `motion.js` | 重畫後的動態：編號牌換位置時滑過去、說明新出現時淡入（`TopoViewer` 內部用） |
| `view.js` | `TopoViewer`：照片＋SVG、手勢、縮放按鈕、事件 |
| `editor.js` | `TopoEditor`（繼承 `TopoViewer`）：工具、編輯、復原／重做 |
| `style.js` | 元件用的 CSS 字串 `CSS` |
| `element.js` | Web Component `<climbio-topo>`（載入即註冊） |
| `index.d.ts`、`element.d.ts` | 型別（手寫） |
| `demo.html` | 示範頁 |
| `test/unit.test.mjs`、`baseline/` | 單元測試；與龍洞逐項一致的場景與截圖基準 |

## 4. 公開 API

座標一律是照片像素。完整型別見 `index.d.ts`、`element.d.ts`。

### TopoViewer

`new TopoViewer(host: HTMLElement, options?: ViewerOptions)`，繼承 `EventTarget`。

| 成員 | 說明 |
|---|---|
| `setData({ view, layers?, nodes? })` | 載入資料；不是 v2 照片畫面、或圖層不是疊在這個畫面上時丟錯 |
| `setOptions(partial)` | 更新選項並重畫 |
| `select(id \| undefined)`、`setView(state)`、`zoomBy(ratio, at?)`、`zoomToRect(rect, { keepZoom?, animate? })` | 選取路線、縮放與平移 |
| `state`、`model`、`routes`、`k`、`host`、`options` | 唯讀：縮放狀態、路線模型、路線陣列、一個螢幕像素等於幾個照片像素 |
| `destroy()` | 解除所有事件監聽、ResizeObserver、計時器，發 `destroy` |

事件（`detail`）：`ready`、`pick`（`{ id }`）、`zoom`（`{ scale }`）、`swipe`（`{ step: 1 \| -1 }`，需 `swipe` 選項）、`swipedown`（需 `swipe` 選項）、`destroy`。

選項（`ViewerOptions`，皆可省略）：

| 選項 | 說明 |
|---|---|
| `highlight` | 亮色的路線 id |
| `bolts` | `true` 全部路線、路線 id 陣列、`'zoom'`（放大 1.8 倍以上才畫全部）；預設只畫 `highlight` 的 |
| `boltCodes` | bolt 牌子帶位置（`× B01`） |
| `names` | `false` 不顯示路線名稱（預設顯示） |
| `gradePill` | 編號牌直接帶難度（預設 `true`）；路線擠時自動精簡，排版優先順序：編號難度＞名稱＞bolt |
| `naturalEnds` | 有 bolt 時線尾停在確保站牌子前（預設 `true`） |
| `solo` | 路線卡片：`highlight` 標編號與說明，其他只標小編號 |
| `reveal`、`revealWidth` | 照片灰階、`highlight` 路線周圍保留原色；帶子寬度預設 0.14 |
| `crop` | 顯示範圍；預設用畫面的 `props.crop`，沒有就整張 |
| `fit` | `'contain'`（預設）、`'cover'`、`'width'` |
| `zoom`、`controls`、`wheel` | 可否縮放（預設 `true`）、縮放按鈕（預設 `true`）、`'ctrl'`（預設，Viewer）或 `'always'` |
| `swipe` | `true` 或 `'page'`；左右滑發 `swipe`、沒放大時由上往下滑發 `swipedown` |
| `interactive`、`ui`、`text`、`lang`、`gradeSystems` | 路線可點、牌子倍率、按鈕說明、名稱語言、難度系統順序 |
| `editing` | 編輯外觀（`TopoEditor` 一律開） |

### TopoEditor

`new TopoEditor(host, options?: EditorOptions)`，繼承 `TopoViewer`，多出選項 `editLayer`（預設 0；沒有圖層時建一個空的）、`tool`、`keys`、`aim`、`positions(routeId)`、`transform(routes, before, id)`。

- 工具 `Tool`：`'select'`、`'edit'`、`'line'`、`'bolt'`、`'number'`、`'crop'`；`setTool(tool)`。
- 路線與線：`addRoute({ id?, label?, name?, kind? }) → id`、`setLine(points)`、`clearRoute()`、`fork(on?)`、`placeAt(point)`、`setBoltPos(pos)`。
- 選取與刪除：`pickPoint(picked)`、`deletePicked()`；唯讀 `selected`、`editable`、`picked`、`forking`、`canFork`、`nextBoltPos`。
- 裁切與平移：`setCrop(rect)`、`cropRect`、`setHand(on)`、`hand`。
- 歷史與輸出：`undo()`、`redo()`、`clearHistory()`、`canUndo`、`canRedo`、`toLayer() → Layer`（複本）、`setLayer(layer)`（整個換掉，可復原）。
- 事件：繼承 Viewer 的，另有 `change`（`{ layer, reason }`）、`history`（`{ canUndo, canRedo }`）、`select`（`{ id }`）、`selectpoint`（`{ picked }`）、`tool`（`{ tool }`）、`fork`（`{ on }`）、`crop`（`{ crop }`）。
- 錯誤：只有編輯圖層（`editLayer`）裡的路線能改；改畫面或別的圖層的路線時丟錯。

### 資料與幾何函式

| 名稱 | 簽章 |
|---|---|
| `readTopo` | `({ view, layers?, nodes? }, { lang?, gradeSystems? }?) → TopoModel` |
| `writeLayer` | `(layer, routes, index, known?: Set<string>) → Layer`，編輯後的路線寫回圖層 |
| `assertView` | `(view) → void`，不是 v2 照片畫面就丟錯 |
| `pickName`、`pickGrade`、`newId` | 名稱（依語言）、難度（依系統順序）、產生節點 id |
| `renderLines` | `(routes, RenderOptions) → string`（SVG 字串） |
| `renderReveal` | `(line, { photo, width, id }) → string`（灰階遮罩 SVG；不到兩點回空字串） |
| `drawnRuns`、`ownRuns`、`segmentAt`、`addLinePoint`、`forkLine`、`moveSharedPoint`、`removeLinePoint` | 共用線段與編輯規則，見 `index.d.ts` |
| `smoothPath`、`pathLength`、`pointAlong`、`textWidth`、`wrapText`、`Placer` | 版面工具 |
| `clampView`、`moveView`、`focusView`、`fitSize`、`routeCrop`、`isSketch`、`doubleTapView`、`isDoubleTap`、`swipeStep`、`swipeDown`、`IDENTITY`、`MAX_SCALE`、`DOUBLE_TAP_SCALE`、`DRAG_PX`、`CSS` | 視角純函式與常數 |

### Web Component `<climbio-topo>`

`import '@climbio/topokit/element'`（載入即註冊；伺服器端沒有 `HTMLElement` 時什麼都不做）。

| 屬性 | 說明 |
|---|---|
| `view`、`layers` | 照片畫面、圖層的網址（`layers` 空白分隔）；只收 https 或同站，相對路徑照頁面網址解析；畫面的相對 `href` 照畫面檔案的網址解析；圖層的 `on` 要等於畫面的 `id` |
| `mode` | `view`（預設）或 `edit` |
| `tool` | 編輯時的工具 |
| `highlight`、`bolts`（有屬性＝全部；`bolts="zoom"`）、`solo`、`names="false"`、`grade-pill="false"`、`controls="false"`、`wheel="always"`（編輯模式一律 always）、`fit`（`contain`／`cover`／`width`）、`swipe`（`swipe="page"`；編輯模式不開）、`lang` | 對應同名選項 |

- JS 屬性：`data`（`{ view, layers, nodes }`，設了就重畫）、`viewer`（目前的 `TopoViewer` 或 `TopoEditor`）、`editor`（`mode="edit"` 時的 `TopoEditor`，其他是 `undefined`）。
- 事件：轉出 `ready`、`pick`、`zoom`、`swipe`、`swipedown`、`change`、`history`、`select`、`selectpoint`、`tool`（`detail` 同原事件）；另有 `load`（網址載好）、`error`（`CustomEvent`，`detail.error`）。`crop`、`fork` 不轉出，要用 `el.editor.addEventListener`。
- 從頁面拿掉元件時所有監聽與觀察器解除，再放回來會重建。預設 `display: block; height: 300px`。

## 5. 資料格式與不變條件

輸入與輸出都是 Climbio 公開格式 v2：照片畫面（`kind: view`、`surface: photo`）加路線圖層（`kind: layer`、`on` 是畫面 id）。詞彙見 `format/VOCABULARY.md`。

| v2 | 畫成 |
|---|---|
| `type: route` 節點，指向它的 `LineString` 標註 | 路線的線段（第一點是起攀點） |
| 線段標註的 `props.label`、`props.style.stroke` | 編號牌文字、覆蓋線的顏色 |
| 路線節點的 `props.style`（`sport` 藍，其他紅）、`name`、`props.grade` | 線色；編號旁的難度與名稱 |
| `type: bolt`／`anchor` 節點（`parent` 是路線，`name` 是位置 `B01`…／`A01`…）的 `Point` 標註 | bolt、anchor 牌子；標註的 `props.label` 是材質說明 |
| 指向 `type: route` 節點的 `Point` 標註（沒有線的路線號碼；路線有線時不畫也不寫） | 編號牌，中心是該位置；`props.label`、`props.style.stroke`、`props.size`（照片像素，有就以 1.2 倍邊長蓋住照片上印的號碼牌） |
| 畫面的 `props.crop` | 顯示範圍，標註座標不受影響 |

不變條件：

- v2 沒有共用線段；分岔是複製前段的點。兩端座標相同的線段視為共用、只畫一次。產生路線線的程式要讓共線路線共用同一組點，各自簡化會讓共用段座標差一點而各畫各的。
- 在共用線段加點、移動共用點，分岔的路線一起動。
- 畫了線的路線一定有編號牌，放不下也放在第一個位置。
- 編號牌是路線色的圓（白字），難度是圓下面的小白籤（`5.11a` 縮成 `11a`），圓的上緣接著起點；起點離照片下緣太近、下面放不下時，畫出來的線起點沿著線往上挪（只影響畫面，不改資料）。
- 路線擠時牌子先縮小、再拿掉難度；放大後路線拉開就恢復成排得下的最大尺寸，縮放時級別有遲滯，不會一會大一會小。
- 只有 `editLayer` 的路線可改；`toLayer()` 輸出的圖層通過 `@climbio/format` 的 `validate`。
- 編號牌位置不看選了哪條路線；編輯時看到的就是最後的結果，只有正在編的路線頭尾照原樣、有把手。

## 6. 最小可跑範例

```bash
npm install @climbio/topokit @climbio/format
```

用靜態伺服器提供頁面（不能用 `file://`），資料用 `@climbio/format` 附的 `examples/topo.json`（照片畫面）、`topo-routes.json`（圖層），並把畫面的 `href` 換成自己的照片：

```html
<script type="module">
  import '/node_modules/@climbio/topokit/element.js';
</script>
<climbio-topo view="topo.json" layers="topo-routes.json" bolts style="height:70vh"></climbio-topo>
```

JS 版（有打包工具）：

```js
import { TopoEditor } from '@climbio/topokit';
const view = await (await fetch('topo.json')).json();
const layer = await (await fetch('topo-routes.json')).json();
const editor = new TopoEditor(document.getElementById('host'), { editLayer: 0 });
editor.setData({ view, layers: [layer] });
editor.addEventListener('change', (e) => console.log(e.detail.layer));
editor.addRoute({ label: 9, name: '新路線' });
editor.setTool('line');
```

`demo.html`：repo 根目錄 `python3 -m http.server 8765`，開 `/topokit/demo.html`（載入 `format/examples` 的範例牆）。右下角是編輯後輸出的圖層。

## 7. 限制與已知取捨

- 需要瀏覽器的 DOM、SVG（`TopoViewer`、`TopoEditor`、元件）；`renderLines`、`readTopo`、`writeLayer`、線段與視角函式可在 Node 執行。
- 照片以 `href` 載入，需能被瀏覽器跨來源讀取；元件讀網址只收 https 或同站。
- `wheel` 預設要按 Ctrl／⌘ 才縮放（Viewer），讓頁面照常捲動。
- 字型固定（系統字），不跟 App 字型；顏色用 CSS 變數 `--tk-sport`、`--tk-sport-on`、`--tk-other`、`--tk-other-on`、`--tk-bg`。
- 外觀對齊龍洞的截圖基準（`baseline/`）；改版面演算法要連同基準重截。

## 8. 驗證

| 內容 | 指令 |
|---|---|
| 版面與龍洞 `TopoLines` 逐項一致、v2 進出（輸出通過 `validate`）、共用線段、縮放 | `node --test topokit/test/unit.test.mjs`（`npm run test:quick` 也會跑） |
| 路線擠時的牌子排版 | `node --test tools/topokit-render.test.mjs` |
| 公開岩場的全部 Topo × 手機寬度 320–768 × 縮放 1–6 倍：牌子不重疊、不壓別條線、不小於 14 像素、不超出照片 | `node tools/topokit-audit.mjs`（需要網路，`--verbose` 列出問題） |
| 瀏覽器：demo、編輯、觸控、資源清理 | 內部 e2e 案例；外部安裝流程 內部 e2e 案例 |
