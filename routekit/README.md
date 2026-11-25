# RouteKit（`@climbio/routekit`）

English: [README.en.md](README.en.md)

## 1. 用途

在一張牆面照片上看路線、定線、輸出路線圖：路線岩點保留原色、其他灰階，疊上起攀／完攀／腳點膠帶和出手順序；點岩點即可組路線。畫在 `<canvas>` 上，純前端、沒有建置步驟。

- **該用**：已經有「照片＋岩點外框」的牆（人工圈點或 holdkit 岩點資料包），要在自己的網頁或 App 顯示路線圖、讓使用者定線，或在圈點格式（RouteMake）、Climbio 公開格式 v2 之間轉換。
- **不該用**：要偵測岩點（用 `holdscan/`）；戶外照片上的線路圖（用 `topokit/`）；地圖（用 `mapkit/`）；需要轉場的完整看線 UI（縮放、拖曳有，開 `zoom: true`；轉場由使用方做）。

## 2. 授權與依賴規則

- 授權：AGPL-3.0（`LICENSE`、`NOTICE`）。
- 可以依賴：瀏覽器內建的 Canvas／DOM API。Web Component 用 `HTMLElement`、`customElements`、`fetch`。
- 不可以依賴：Climbio App 的 `js/`、`holdscan/`（AGPL）、`state`、`t()`、DOM 元素 id、IndexedDB、品牌、Firebase。App 的狀態一律從參數傳入。
- kit 之間互相獨立：不 import 其他 kit；與公開格式 v2 的對接只靠資料結構，`format.js` 不檢查格式，驗證用 `@climbio/format` 的 `validate`。
- 不引用 App 的程式（`js/`）或 `holdscan/`，可以單獨使用。
- 路線怎麼畫、怎麼點（不看 App 狀態就能決定的）放這裡，資料從參數傳入：照片和岩點用 `RouteScene`，岩點外框改了呼叫 `touchGeom()`。App 呼叫繪製函式寫 `RouteKit.…`，幾何（`inPoly`、`area`、`edgePoint`）可以直接用。

## 3. 檔案地圖

| 檔案 | 責任 |
|---|---|
| `geometry.js` | 外框（`poly`）幾何：`bbox`、`inPoly`、`area`、`tracePoly`、`holdAt`、`edgePoint`、`stripTip`、`edgeTangent`、`strokeOutside` |
| `labels.js` | 標示：膠帶位置（`typeLabels`、`drawTypeLabels`）、出手順序（`seqBadges`、`drawSeq`）、定線外框（`strokeRouteHold`）、預設樣式 `THEME` |
| `base.js` | 路線圖的底：灰階、暗彩、路線岩點原色圖層（`grayOf`、`plainGrayOf`、`mutedOf`、`liftTint`、`tintCard`、`routeLayers`、`routeMask`、`routeLayer`、`drawRouteBase`） |
| `scene.js` | `RouteScene`：照片＋岩點＋快取；`scene()` 建立 |
| `image.js` | `routeHolds`、`cropAround`、`revealSteps`、`drawRoute`、`renderRouteImage`、`thumbCrop`、`routeThumb` |
| `editor.js` | 定線規則（只改資料、不碰畫面）：`tapHold`、`appendSeq`、`insertSeq`、`popSeq`、`dropSeq`、`clearFeet`、`toggleFeetFree`、`MAX_START`、`startCount` |
| `viewport.js` | 縮放、平移（跟岩點貓同一套手勢與邊界）：`Viewport`、`clampView`、`maxScaleOf`、`fitOf`、`ZOOM_STEPS` |
| `viewer.js` | 畫在 canvas 上的 `RouteViewer`、`RouteEditor` |
| `ui.js` | 操作介面（按鈕、類型列、順序列、選單）的純 UI 元件 `EditorUI`：只畫按鈕、把動作轉給控制器 |
| `circles.js` | 圈點格式互轉：`fromCircles`、`toCircles`、`CIRCLE_DIAMETER` |
| `format.js` | Climbio 公開格式 v2 互轉：`fromFormat`、`wallView`、`routesLayer`、`wallFiles`、`thumbPathOf` |
| `elements.js` | Web Component `<routekit-viewer>`、`<routekit-editor>`，另匯出 `loadRoute`、`loadLayer` |
| `index.js`、`index.mjs` | npm 入口（CommonJS／ESM）：合併上面各檔（不含 `elements.js`） |
| `index.d.ts`、`elements.d.ts` | 型別 |
| `demo.html` | 示範頁 |

每個 `.js` 都是 UMD：瀏覽器用 `<script>` 依序載入，掛到全域 `RouteKit`；Node 用 `require`。依賴順序：`geometry` → `labels`、`base` → `scene`、`image` → `editor` → `viewport` → `viewer`、`circles`、`format` → `elements`。

## 4. 公開 API

座標一律是照片像素。型別細節以 `index.d.ts`、`elements.d.ts` 為準。以下 `Ctx` 是 2D canvas context，`Photo` 是 `<img>`／canvas／OffscreenCanvas／ImageBitmap。

### 入口

- `import RouteKit, { scene, RouteViewer, … } from '@climbio/routekit'`（也可 `require`）：default 與具名匯出同一批成員。
- `import '@climbio/routekit/elements'`：註冊 Web Component（有副作用）。伺服器端（無 `HTMLElement`）載入時什麼都不做；其他檔案 import 不碰 `window`、`document`，畫圖要在瀏覽器。

### 幾何（`geometry.js`）

| 名稱 | 簽章 | 說明 |
|---|---|---|
| `bbox` | `(poly) → { x0, y0, x1, y1 }` | 外接框 |
| `inPoly` | `(x, y, poly) → boolean` | 點是否在外框內 |
| `area` | `(poly) → number` | 面積 |
| `tracePoly` | `(ctx, poly) → void` | 在 ctx 上描出路徑並 `closePath` |
| `holdAt` | `(holds, x, y) → Hold \| null` | 包住該點最小的那顆岩點 |
| `edgePoint` | `(poly, dx, dy, centerEdge?) → [x, y]` | 沿方向找外框邊緣的點 |
| `stripTip`、`edgeTangent`、`strokeOutside` | 見 `index.d.ts` | 膠帶尖端、邊緣切線、外框外側描邊 |

### 標示（`labels.js`）

| 名稱 | 簽章 |
|---|---|
| `THEME` | `{ colors: { s, h, f, t }, font, text: { s, t } }`，預設樣式 |
| `typeLabels` | `(scene, routeHolds, route, unit, hands?, theme?) → label[]` |
| `drawTypeLabels` | `(ctx, labels, unit, theme?) → void` |
| `seqBadges`、`drawSeq` | `(ctx, scene, route, unit, labels, routeHolds[, theme])`，出手順序 |
| `strokeRouteHold` | `(ctx, poly, type, L, theme?) → void`，`L(screen, photo)` 把螢幕像素換成照片像素 |

### 底圖（`base.js`）與 RouteScene（`scene.js`）

- `grayOf(img)`、`plainGrayOf(img)`、`mutedOf(img)` → canvas：灰階、灰階（壓亮度加冷灰）、暗彩。
- `liftTint(ctx, W, H, rgb?)`、`tintCard(ctx, S)`、`routeLayers(routeHolds, all)`、`routeMask(ctx, routeHolds, all)`、`routeLayer(img, routeHolds, all, { tint? })`、`drawRouteBase(ctx, scene, routeHolds, { mode?, tint?, glow? })`：路線岩點原色圖層與底。`mode`：`'gray'`（預設）或 `'dim'`。
- `scene(img, holds)` → `RouteScene`；`holds` 可以是陣列或回傳陣列的函式。`new RouteScene(img, holds)` 同。

`RouteScene` 成員：

| 成員 | 說明 |
|---|---|
| `img`、`w`、`h`、`holds`、`version` | 照片、尺寸、岩點、外框版本號（`touch()` 會遞增） |
| `plain(mode?)`、`muted` | 共用的底，照片大小、整面牆各一張，第一次用到才算 |
| `routeLayer(routeHolds, { tint? })` | 路線岩點原色圖層（只有路線岩點外接框那麼大），留最近 3 條 |
| `drawBase(ctx, routeHolds, { mode?, tint? })` | 畫底＋路線圖層 |
| `labels(routeHolds, route, unit, hands?, theme?)` | 膠帶位置，快取 60 筆 |
| `prefetch(jobs, alive?)` → `Promise<void>` | 閒置時預畫接下來可能看的路線，每畫一條讓出 |
| `touch()` | 外框改了，讓快取失效 |
| `release()` | 放掉共用底與圖層 |
| `recover(lost)` → boolean | 系統清掉 canvas（iOS 背景）後重畫 |

### 路線圖（`image.js`）

- `routeHolds(route, holds) → Hold[]`：路線用到的岩點，`route.shapes` 優先，否則用牆上那顆，兩邊都沒有的略過。
- `cropAround(routeHolds, PW, PH, aspect) → { x, y, w, h }`：以路線為中心、含標籤空間的取景，不超出照片。
- `revealSteps(route, routeHolds) → Hold[][]`：岩點亮起順序（起攀與腳點、手點照出手順序、完攀）。
- `drawRoute(ctx, scene, route, routeHolds, { unit?, mode?, tint?, hands?, theme? })`：ctx 需先設好照片座標轉換。
- `renderRouteImage(scene, route, routeHolds, { theme? }) → canvas`：原尺寸路線圖，不帶品牌。
- `thumbCrop(W, H, routeHolds) → { sx, sy, side }`、`routeThumb(scene, routeHolds, S = 300, { mode?, route?, theme? }?) → canvas`（帶 `crop`）：正方形小卡，預設灰階底；`mode: 'dim'` 是暗彩，再給 `route` 就加光暈（跟看線、定線畫面同一套，內嵌頁的路線清單縮圖用這個）。

### 定線規則（`editor.js`）

| 名稱 | 簽章 | 行為 |
|---|---|---|
| `MAX_START` | `number`（2） | 起攀上限 |
| `startCount` | `(route) → number` | 路線上起攀的數量 |
| `tapHold` | `(route, id, type, { maxStart?, justAdded? }?) → 'added' \| 'changed' \| 'removed' \| 'full' \| 'ignored'` | 不在路線上就加；類型不同就改；類型相同就拿掉（同時移出 `seq`）。起攀滿了：新的點改成手點，已在路線上的回 `'full'` 且不動。`maxStart` 預設 2（岩點貓），有的岩館規定 4。`justAdded` 為真且類型相同：回 `'ignored'` |
| `appendSeq` | `(route, id) → boolean` | 追加一手；不在路線上的先當 `h` 加入；回傳是否新加入 |
| `insertSeq` | `(route, id, at) → boolean` | 插在 `seq` 的 `at` 位置（0 起算，超出就是最後），後面順延；其他同 `appendSeq` |
| `popSeq` | `(route, added, at?) → void` | 收回 `at` 位置的那一手（預設最後一手）；`added` 為真且該點是 `h` 則一併移除 |
| `clearFeet` | `(route) → number` | 拿掉路線上所有腳點（也移出 `seq`），回傳拿掉幾顆 |
| `toggleFeetFree` | `(route) → boolean` | 切換 `route.feetFree`（不限腳），回傳現在是否不限腳；關掉時刪掉欄位 |
| `dropSeq` | `(route, id) → void` | 把該點從 `seq` 全部移除 |

以上函式直接修改傳入的 `route`。

### 縮放、平移（`viewport.js`）

跟岩點貓同一套規則：雙指縮放、一指／滑鼠拖曳平移、點兩下（定線時點空白處）放大 2.5 倍、已放大就回到起始視角、滾輪縮放；最小是整張照片（比框小就置中），放大後不讓邊緣露出空白，最大放大到 1 個照片像素＝4 個螢幕點（至少 10 倍）；上下有浮動工具列時，`pads()` 回傳 `[上, 下]` 高度，可以多拖那兩段，最上、最下的岩點也拖得到工具列外面。拖曳之後放開不會點到岩點。

- `new Viewport(canvas, { w, h }, { onChange, pads?, home?, canZoomAt? })`：手勢收在畫布上；`onChange({ s, k, tx, ty })` 是視角（照片座標 → 畫布的轉換，螢幕 CSS 像素）；`enable(on)` 開關手勢（關掉時畫布交還給瀏覽器）；`reset()`、`flyTo(視角)`、`zoomTo(s, x, y)`、`zoomStep(±1)`（階梯 `ZOOM_STEPS`）。
- `clampView(s, tx, ty, { W, H, bw, bh, pads?, maxScale? })`、`maxScaleOf(照片寬, 照片放進框的寬)`、`fitOf(W, H, 照片寬, 照片高)`：純函式，Node 也能用。
- `RouteViewer`、`RouteEditor` 的 `zoom: true`（或之後 `setZoom(on)`）直接用它：看線的起始視角是路線視角，定線是整張照片；`pads` 給工具列高度；`onView(視角)` 在縮放、平移後呼叫；`zoomStep(±1)`、`resetView()`、`zoomed`。

### 元件（`viewer.js`）

- `new RouteViewer(canvas, { scene, route, theme?, mode?, glow? })`：以路線為中心取景；`glow: true` 在路線岩點外圍畫一圈角色色的光暈（底變暗、路線岩點原色、外圍一小圈淡光暈，岩點外框用角色色細線描清楚，不貼手點膠帶，預設不畫；開了光暈 volume 就不染色，路線上的點靠光暈分辨，沒有光暈的點不是路線）；`ResizeObserver` 在尺寸變動時重畫。成員：`setRoute(route)`、`setMode(mode)`、`render()`、`destroy()`、唯讀 `routeHolds`。
- **岩點貓、內嵌頁用的是同一份規則**：重疊岩點的選擇（`holdsUnder`、`prepareOverlapPick`、`overlapSpots`、`pickOverlap`，畫法 `drawOverlapPick`）。只替首次觸點下重疊的岩點放提示圓點，量體上其他小岩點以細框顯示，放大後可以直接點。兩邊也共用顯示所有岩點的熱圖（`holdUse`、`heatLevel`，畫法 `strokeHoldOutline`）、起攀滿了切手點（`nextType`）、出手順序的追加／插入／刪除／復原（`orderSession`）；`RouteEditor` 全部用到，外層只畫按鈕和對話框：`onType`（規則換了類型）、`onOrder`／`onOrderAsk`（順序變了、長按有編號的岩點要問插入或刪除）、`heatRoutes`／`setShowAll`、`toggleFeetFree`。
- **觸控長按自由畫**：`RouteEditor` 的 `draw: true`（或 `setDrawMode(on)`）：觸控、手寫筆長按沒有岩點的地方，手指不放沿岩點外緣畫一圈，有放大鏡；放開把軌跡簡化成多邊形（`freehandPoly`：頭尾接起來、Douglas–Peucker 簡化、最多 20 個頂點、畫得太小回傳 `null`），以路線自己的外框（`route.shapes`）加進路線，規則同點岩點。滑鼠不會觸發。
- `new RouteEditor(canvas, { scene, route, theme?, type?, mode?, glow?, maxStart?, onChange?, onLimit?, onType?, onOrder?, onOrderAsk?, heatRoutes?, showAll? })`：整張照片、還沒選點是原本的照片、選了第一個點才換底色，底預設暗彩（`mode: 'gray'` 是灰階）。`type` 為 `s`／`h`／`f`／`t` 或 `n`（追加出手順序）；預設 `s`。canvas 的 `click` 觸發點選：先 `holdAt`（含 `route.shapes`），再 `tapHold`／`appendSeq`，有變動就重畫並呼叫 `onChange(route)`；400 ms 內連點同一顆新加的點不會被拿掉。直接修改傳入的 `route`。`maxStart`（起攀上限，預設 2，有的岩館規定 4）：起攀滿了，新的點改成手點；已在路線上的點不能改成起攀，不動並呼叫 `onLimit()`。成員：`setRoute`、`setMode(mode)`、`setType(type)`、`undoSeq()`（收回順序模式最近加的一手，可一路收回；回傳有沒有收回）、`canUndoSeq`、`setMaxStart(n)`、`render`、`destroy`（解除 click 與 ResizeObserver）。
- canvas 需有 CSS 尺寸（`clientWidth`／`clientHeight`）；像素尺寸由元件依 `devicePixelRatio` 設定。

### 操作介面（`ui.js`，純 UI 元件）

定線、看線的按鈕：上方圓鈕（取消、暗彩／黑白、顯示所有岩點、縮放、全畫面、完成）、下方類型列（起攀、手點、完攀、腳點、順序）、順序列、底部選單。岩點貓定線頁、內嵌頁（iframe／WebView）、以後的 3D 內嵌頁都用這一份，樣式和規則只有一套。**只畫按鈕、把按下的動作轉給控制器，不存檔、不同步、不分享、不認識 App 的狀態。**

- `const ui = RouteKit.EditorUI.mount(host, { mode, lang, strings, base, controls, foot, order, heat, zoom, fullscreen, interactive, fullscreenOn, colors, type, onDone, onCancel, onBase, onFullscreen, onLimit })`：`host` 要是定位過的容器（元件鋪滿它，空白處不擋手勢）。`strings` 覆蓋文字（值是字串或函式，內建繁中、英文）。
- **控制器**（`ui.attach(controller, () => route)`）：`RouteEditor`、`RouteViewer`，或任何實作同一組方法的物件（3D 牆的舞台）：`type`、`setType`、`setMode`、`showAll`、`setShowAll`、`zoomStep`、`canUndoSeq`、`undoSeq`、`orderInfo`、`orderInsertAfter`、`orderRemove`、`orderClear`、`orderEndInsert`、`toggleFeetFree`。規則（起攀上限、順序、不限腳）在控制器，元件不重算。
- 給編輯器的回呼：`new RouteEditor(canvas, { ..., pads: () => ui.pads(canvas), ...ui.hooks, onChange: () => { ...; ui.update(); } })`。
- 「完成」要有起攀也有完攀才能按；起攀不顯示 (n/上限)。
- 方法：`update()`、`setOptions({...})`、`pickType(t)`、`detach()`、`destroy()`；元素都有 `data-rk` 與 `rk-` 開頭的 class（樣式隨 `ui.js` 注入，變數 `--rk-s`、`--rk-h`、`--rk-t`、`--rk-f`）。

### 圈點格式（`circles.js`）

- 圈點 `{ x, y, t, r }`：`x`、`y` 是圈心佔照片寬／高的百分比；`t` 是 `s`／`h`／`t`；`r` 是 1／2／3，直徑佔照片寬 4.5%／7%／10%（`CIRCLE_DIAMETER`）。
- `fromCircles(circles, w, h, { holds? }?) → Route`：圈心對到包住它的岩點，沒有包住的取圈圈範圍（半徑＝直徑一半）內最近的岩點；範圍內沒有岩點的用 24 邊形外框放進 `shapes`（id 為 `c0`、`c1`…，依圈點順序）；不認得的 `t` 當 `h`；同一顆有多個圈時 `s`、`t` 優先。
- `toCircles(route, holds, w, h) → Circle[]`：圈心取外接框中心，`r` 取最接近的；`f` 當 `h`；`seq` 不會帶過去。

### Climbio 公開格式 v2（`format.js`）

只轉換、不檢查。

- `fromFormat(view, layers?) → { w, h, holds, routes }`：讀照片畫面（`kind: view`、`surface: photo`）與路線圖層。圖層標註帶 `props.route` 的是該路線自己的外框，放進該路線的 `shapes`；其他路線用牆上那顆。路線欄位：`id`、`name`、`grade`、`holds`、`seq?`、`shapes`、`author`、`t`、`u?`、`color?`。
- `wallView({ pid, name?, w, h, holds?, href, thumb?, attribution?, t?, license?, author?, sha256?, props? }) → view`：牆 → 照片畫面。略過 id 不合法或外框不足三點的岩點；`license` 預設 `CC-BY-SA-4.0`。
- `routesLayer({ id, pid, href, w, h, holds?, routes?, gym?, thumb?, props?, attribution?, name?, t?, license?, author? }) → layer`：路線 → 疊在牆上的圖層。路線自帶外框與畫面上的相同就不寫；不同的寫成帶 `props.route` 的標註；畫面沒有的岩點寫成圖層的 `hold` 節點。
- `wallFiles({ pid, layerId?, name?, w, h, holds?, routes?, gym?, photo, thumb?, attribution?, t?, view?, layer? }) → { files: [{ path, bytes }], view, layer, entry, thumbPath }`：一面牆發佈的檔案（`{pid}.json`、`{pid}.jpg`、`{pid}.thumb.jpg`、`{layerId}.json`）；`photo`、`thumb` 是 `Uint8Array`（JPEG）；沒給 `layerId` 就沒有圖層。
- `thumbPathOf(pid) → string`：`{pid}.thumb.jpg`。

### Web Component（`elements.js`）

| 標籤 | 屬性 | 事件 |
|---|---|---|
| `<routekit-viewer>` | `src`（路線圖層網址）、`route-id`（圖層內哪一條，省略＝第一條）、`mode`（`gray` 預設／`dim`） | `load`、`error`（`ErrorEvent`） |
| `<routekit-editor>` | `src`、`route-id`、`type`（`s`／`h`／`f`／`t`／`n`，預設 `s`） | `load`、`error`、`change`（`detail` 是路線） |

- JS 屬性（property）：`photo`（載好的 `<img>`／canvas）、`holds`、`route`、`theme`、`canvas`（shadow DOM 內的 canvas）。給 `photo` 與 `route` 後才會畫。
- `src` 必須是 https 或同站；讀圖層，再讀圖層 `href` 指到的牆畫面與照片（相對路徑照各自檔案網址解析）；圖層不是 v2 圖層、牆不對應、沒有路線、HTTP 失敗、照片載入失敗都發 `error`。
- 模組另匯出 `loadLayer(src) → Promise<{ photo, holds, routes }>`、`loadRoute(src, routeId?) → Promise<{ photo, holds, route }>`、`RouteKitViewer`、`RouteKitEditor`。
- 預設 `display: block; height: 300px`，用 CSS 改；canvas 可用 `::part(canvas)`。

## 5. 資料格式與不變條件

- 岩點：`{ id, poly: [[x, y], …], source?, retired? }`，`poly` 為照片像素、至少三點（同 holdkit 岩點資料包的 `holds`，見 `holdkit/SPEC.md`）。`retired: true` 是停用的岩點：公開過、之後被刪掉或合併掉，仍留在牆的畫面裡讓別人的舊路線指得到；`fromFormat` 讀出來的路線外框不帶這個欄位，App 的新路線不該讓人點到它。
- 路線（Kit 原生）：`{ holds: { 岩點 id: 's'|'h'|'f'|'t' }, seq?, shapes?, id?, name?, grade?, author?, t?, color? }`。`seq` 是依序出手的岩點 id，同一顆可重複；`shapes` 是路線自帶的外框，優先於牆上的岩點；`color` 是膠帶顏色名稱。
- 不變條件：
  - 起攀最多 `MAX_START`（2）顆，可用 `maxStart` 改（有的岩館規定 4）。
  - `seq` 只含路線上的岩點；岩點被拿掉時同步從 `seq` 移除；`seq` 空了就刪掉該欄位。
  - 岩點外框改了要呼叫 `scene.touch()`，快取才會失效。
  - Kit 原生路線與 v2 路線（圖層裡的 route 節點加標註）不能混用：畫圖、編輯吃原生，存檔、交換用 v2，靠 `fromFormat`／`routesLayer` 轉換。
  - 公開格式的授權欄位由呼叫端負責；`wallView`／`routesLayer` 預設 `CC-BY-SA-4.0`。

## 6. 最小可跑範例

在自己的專案 `npm install @climbio/routekit`，由有打包工具的專案載入（或把檔案放在靜態伺服器上以 ES module 載入）。

```html
<canvas id="c" style="width:100%;height:400px;display:block"></canvas>
<script type="module">
  import { scene, RouteViewer, RouteEditor } from '@climbio/routekit';

  const img = new Image();
  img.src = 'wall.jpg';                      // 同站圖片，或有 CORS 的圖片
  await img.decode();

  const sq = (x, y) => [[x, y], [x + 80, y], [x + 80, y + 80], [x, y + 80]];
  const holds = [{ id: 'a', poly: sq(100, 600) }, { id: 'b', poly: sq(300, 400) }, { id: 'c', poly: sq(450, 150) }];
  const route = { holds: { a: 's', b: 'h', c: 't' }, seq: ['a', 'b', 'c'] };

  const s = scene(img, holds);
  new RouteViewer(document.getElementById('c'), { scene: s, route });
  // 定線：new RouteEditor(canvas, { scene: s, route, type: 'h', onChange: (r) => console.log(r) });
</script>
```

- `demo.html`：從 repo 根目錄 `python3 -m http.server 8765`，打開 `/routekit/demo.html`。預設是畫出來的範例牆、不讀其他檔案；`?route=<路線圖層的 https 網址>` 讀分享出去的路線。
- 公開格式的最小流程：`npm install @climbio/routekit @climbio/format`，用 `format` 套件 `examples/wall.json`（畫面）與 `wall-routes.json`（圖層），`RouteKit.fromFormat(wall, [layer])` 取得 `{ w, h, holds, routes }`，再 `scene(照片, holds)` 交給 `RouteViewer`／`RouteEditor`。

## 7. 限制與已知取捨

- 需要瀏覽器的 Canvas 2D；幾何（`geometry.js`）、定線規則（`editor.js`）、格式轉換（`circles.js`、`format.js`）可在 Node 執行，繪圖與元件不行。
- 預設只做取景與點選；縮放、拖曳開 `zoom: true`；轉場由使用方實作（可直接用同一套繪製函式）。
- 照片要能被 canvas 讀取（同站或有 CORS）。Web Component 的 `src` 只收 https 或同站。
- 腳點 `f` 在圈點格式沒有對應，轉出時變手點；`seq` 轉不過去。
- 系統清掉 canvas（iOS 背景）後要呼叫 `scene.recover(lost)` 自行重畫。

## 8. 驗證

| 內容 | 指令 |
|---|---|
| 圈點、定線規則、圖層、外框（Node 邏輯） | `node --test tools/route-circles.test.mjs tools/route-editor.test.mjs tools/route-layers.test.mjs tools/route-shapes.test.mjs` |
| 格式轉換、牆檔案、npm 入口與型別 | `node --test tools/share-format.test.mjs tools/wall-files.test.mjs tools/kit-packages.test.mjs` |
| 瀏覽器（元件、demo） | `npx playwright test routekit.spec.mjs`；外部安裝流程 內部 e2e 案例 |
| 全部快速檢查 | `npm run test:quick` |

## 9. 內嵌（iframe 與原生 App）

不想公開前端原始碼的網站或 App，用 `<iframe>`（網頁）或 WebView（iOS、Android、React Native、Flutter）嵌入 climbio.app 託管的畫面，不打包 Kit（AGPL-3.0 只要求打包了 Kit 的前端開放原始碼）。通用做法與安全規則見 [docs/embed.md](../docs/embed.md)，型別以 [embed/routekit/v1/messages.d.ts](../embed/routekit/v1/messages.d.ts) 為準。

- 網址：`https://embed.climbio.app/routekit/v1/`。iframe 的大小自己設，畫面與按鈕跟著框的大小調整。
- 網址選項：`mode=view｜edit`（預設 view）、`type=s｜h｜t｜f｜n`（定線時點岩點的類型：起攀、手點、完攀、腳點、順序，預設 `s`）、`foot=0`／`order=0`（定線工具列不顯示腳點／順序，預設都顯示）、底固定暗彩加光暈，看線、定線都一樣，沒有黑白切換（黑白是岩點貓自己的特色）、`maxStart=`（起攀點數上限，預設 2＝岩點貓；有的岩館規定 4）、`heat=0`（不顯示「顯示所有岩點」鈕）、`lang=zh｜en`（內嵌頁按鈕與選單的文字）、`color-s／h／t／f=22c55e`（四種類型的顏色）、`label-s／t=起`（起攀、完攀膠帶上的字）、`controls=0`（不顯示按鈕，全由外層用訊息控制，畫面直接可以互動）、`tap=edit`（直接在原地互動，不進全螢幕）。`init` 的 `options` 和 `setOptions` 可以隨時覆蓋。
- **小畫面只是預覽，點一下進全螢幕**（看線、定線都一樣）：預覽沒有工具壓住畫面，只有一顆進全螢幕的小圖示；全螢幕才有工具、縮放平移和定線。iframe 有 `allow="fullscreen"` 就用瀏覽器的全螢幕；不行（iPhone Safari、原生 App）就送 `fullscreen { on }`，外層把 iframe 放大成整個畫面並送 `setFullscreen { on }` 回報（0.7 秒沒回報就原地互動）。框夠大想直接互動：加 `tap=edit`。
- 全螢幕的工具：暗彩／黑白、縮小／放大、結束全螢幕；定線全螢幕上方左取消（叉，路線回到打開時的樣子，送 `cancel`）、右完成（勾，送 `done { layer, routeId }`），在全螢幕就退出，沒有難度、名稱（外層處理）；下方工具列跟岩點貓一樣：起攀（顯示數量與上限）／手點／完攀／腳點／順序，選中的色塊會滑過去（岩點貓沒有的工具不放，再點一次已選的岩點就拿掉）；腳點和順序可用 `foot=0`、`order=0` 關掉（預設都有）。縮放、平移跟岩點貓同一套（見上面「縮放、平移」）。
- 資料一律是 Climbio 官方發佈的公開格式 v2：外層在 `init` 給 `wallId`（或三個官方網址 `viewUrl`、`photoUrl`、`layerUrls`），內嵌頁自己讀，別的網址和訊息直接帶的資料都不收；訊息外框 `{ climbio: 'routekit', v: 1, type, … }`。完整規則見 [docs/embed.md](../docs/embed.md)。
- 內嵌頁 → 外層：`ready`（只送一次）、`done { layer, routeId }`（定線完成）、`cancel`（定線取消）、`change { layer, routeId }`（路線改了：v2 圖層，只有這條路線）、`limit { max }`（起攀已滿：已在路線上的點不能改成起攀，內嵌頁沒有改路線）、`fullscreen { on }`、`error { message }`。
- 外層 → 內嵌頁：`init { wallId（或 viewUrl、photoUrl）, layerUrls?, routeId?, layerId?, viewHref?, options? }`（第一個訊息；`photoUrl` 的照片最大 10 MB，尺寸要等於畫面的 `w × h`）、`setRoute { routeId? }`、`setType { holdType }`（`s`、`h`、`t`、`f`、`n`）、`setOptions { base?, maxStart?, controls?, foot?, order? }`、`setFullscreen { on }`。
- iframe：外層要先註冊 `message` 監聽再放 `<iframe>`；第一個 `init` 的 `event.origin` 會被記下，之後只收發這個來源。原生 App：直接開這個網址，內嵌頁往 `window.ReactNativeWebView`、`webkit.messageHandlers.climbio`、`ClimbioBridge`（Android `addJavascriptInterface`）或 `flutter_inappwebview` 的 `climbio` handler 送，原生端用 `window.climbioReceive(訊息或 JSON 字串)` 傳入。
- 內嵌頁的縮放、平移就是 Kit 的 `zoom`（跟岩點貓同一套）；不輸出圈點格式，要圈點用 `toCircles` 自行換算。

最小範例：

```html
<script>
  addEventListener('message', (e) => {
    const frame = document.getElementById('rk');
    if (e.source !== frame.contentWindow || e.data?.climbio !== 'routekit') return;
    if (e.data.type === 'ready') frame.contentWindow.postMessage({ climbio: 'routekit', v: 1, type: 'init', wallId }, '*');   // 包 id/牆 id，見 docs/embed.md
    if (e.data.type === 'change') save(e.data.layer);
    if (e.data.type === 'fullscreen') {   // 進（出）全螢幕：放大（縮回）iframe，再回報
      frame.classList.toggle('full', e.data.on);
      frame.contentWindow.postMessage({ climbio: 'routekit', v: 1, type: 'setFullscreen', on: e.data.on }, '*');
    }
  });
</script>
<style>
  .rk { width: 100%; height: 480px; border: 0; }
  .rk.full { position: fixed; inset: 0; width: 100%; height: 100%; z-index: 1000; }   /* 小畫面點一下進全螢幕：iframe 放大成整個畫面 */
</style>
<iframe id="rk" class="rk" src="https://embed.climbio.app/routekit/v1/?mode=edit&maxStart=4" allow="fullscreen" title="定線"></iframe>
```

驗證：`node --test tools/embed.test.mjs`（與跨來源嵌入瀏覽器案例）；改了 Kit 或共用程式跑 `node tools/build-embed.mjs`。
