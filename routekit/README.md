# RouteKit（`@climbio/routekit`）

English: [README.en.md](README.en.md)

## 1. 用途

在一張牆面照片上看路線、定線、輸出路線圖：路線岩點保留原色、其他灰階，疊上起攀／完攀／腳點膠帶和出手順序；點岩點即可組路線。畫在 `<canvas>` 上，純前端、沒有建置步驟。

- **該用**：已經有「照片＋岩點外框」的牆（人工圈點或 holdkit 岩點資料包），要在自己的網頁或 App 顯示路線圖、讓使用者定線，或在圈點格式（RouteMake）、Climbio 公開格式 v2 之間轉換。
- **不該用**：要偵測岩點（用 `holdscan/`）；戶外照片上的線路圖（用 `topokit/`）；地圖（用 `mapkit/`）；需要縮放、拖曳、轉場的完整看線 UI（這裡只做取景與點選，其餘由使用方做）。

## 2. 授權與依賴規則

- 授權：AGPL-3.0（`LICENSE`、`NOTICE`）。
- 可以依賴：瀏覽器內建的 Canvas／DOM API。Web Component 用 `HTMLElement`、`customElements`、`fetch`。
- 不可以依賴：Climbio App 的 `js/`、`holdscan/`（AGPL）、`state`、`t()`、DOM 元素 id、IndexedDB、品牌、Firebase。App 的狀態一律從參數傳入。
- kit 之間互相獨立：不 import 其他 kit；與公開格式 v2 的對接只靠資料結構，`format.js` 不檢查格式，驗證用 `@climbio/format` 的 `validate`。
- 不引用 App 的程式（`js/`）或 `holdscan/`，可以單獨使用。

## 3. 檔案地圖

| 檔案 | 責任 |
|---|---|
| `geometry.js` | 外框（`poly`）幾何：`bbox`、`inPoly`、`area`、`tracePoly`、`holdAt`、`edgePoint`、`stripTip`、`edgeTangent`、`strokeOutside` |
| `labels.js` | 標示：膠帶位置（`typeLabels`、`drawTypeLabels`）、出手順序（`seqBadges`、`drawSeq`）、定線外框（`strokeRouteHold`）、預設樣式 `THEME` |
| `base.js` | 路線圖的底：灰階、暗彩、路線岩點原色圖層（`grayOf`、`plainGrayOf`、`mutedOf`、`liftTint`、`tintCard`、`routeLayers`、`routeMask`、`routeLayer`、`drawRouteBase`） |
| `scene.js` | `RouteScene`：照片＋岩點＋快取；`scene()` 建立 |
| `image.js` | `routeHolds`、`cropAround`、`revealSteps`、`drawRoute`、`renderRouteImage`、`thumbCrop`、`routeThumb` |
| `editor.js` | 定線規則（只改資料、不碰畫面）：`tapHold`、`appendSeq`、`popSeq`、`dropSeq`、`MAX_START`、`startCount` |
| `viewer.js` | 畫在 canvas 上的 `RouteViewer`、`RouteEditor` |
| `circles.js` | 圈點格式互轉：`fromCircles`、`toCircles`、`CIRCLE_DIAMETER` |
| `format.js` | Climbio 公開格式 v2 互轉：`fromFormat`、`wallView`、`routesLayer`、`wallFiles`、`thumbPathOf` |
| `elements.js` | Web Component `<routekit-viewer>`、`<routekit-editor>`，另匯出 `loadRoute`、`loadLayer` |
| `index.js`、`index.mjs` | npm 入口（CommonJS／ESM）：合併上面各檔（不含 `elements.js`） |
| `index.d.ts`、`elements.d.ts` | 型別 |
| `demo.html` | 示範頁 |

每個 `.js` 都是 UMD：瀏覽器用 `<script>` 依序載入，掛到全域 `RouteKit`；Node 用 `require`。依賴順序：`geometry` → `labels`、`base` → `scene`、`image` → `editor` → `viewer`、`circles`、`format` → `elements`。

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
- `liftTint(ctx, W, H, rgb?)`、`tintCard(ctx, S)`、`routeLayers(routeHolds, all)`、`routeMask(ctx, routeHolds, all)`、`routeLayer(img, routeHolds, all, { tint? })`、`drawRouteBase(ctx, scene, routeHolds, { mode?, tint? })`：路線岩點原色圖層與底。`mode`：`'gray'`（預設）或 `'dim'`。
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
- `thumbCrop(W, H, routeHolds) → { sx, sy, side }`、`routeThumb(scene, routeHolds, S = 300) → canvas`（帶 `crop`）：正方形小卡。

### 定線規則（`editor.js`）

| 名稱 | 簽章 | 行為 |
|---|---|---|
| `MAX_START` | `number`（2） | 起攀上限 |
| `startCount` | `(route) → number` | 路線上起攀的數量 |
| `tapHold` | `(route, id, type, { maxStart?, justAdded? }?) → 'added' \| 'changed' \| 'removed' \| 'full' \| 'ignored'` | 不在路線上就加；類型不同就改；類型相同就拿掉（同時移出 `seq`）。起攀滿了：新的點改成手點，已在路線上的回 `'full'` 且不動。`justAdded` 為真且類型相同：回 `'ignored'` |
| `appendSeq` | `(route, id) → boolean` | 追加一手；不在路線上的先當 `h` 加入；回傳是否新加入 |
| `popSeq` | `(route, added) → void` | 收回最後一手；`added` 為真且該點是 `h` 則一併移除 |
| `dropSeq` | `(route, id) → void` | 把該點從 `seq` 全部移除 |

以上函式直接修改傳入的 `route`。

### 元件（`viewer.js`）

- `new RouteViewer(canvas, { scene, route, theme?, mode? })`：以路線為中心取景；`ResizeObserver` 在尺寸變動時重畫。成員：`setRoute(route)`、`render()`、`destroy()`、唯讀 `routeHolds`。
- `new RouteEditor(canvas, { scene, route, theme?, type?, onChange? })`：整張照片、暗彩底。`type` 為 `s`／`h`／`f`／`t` 或 `n`（追加出手順序）；預設 `s`。canvas 的 `click` 觸發點選：先 `holdAt`（含 `route.shapes`），再 `tapHold`／`appendSeq`，有變動就重畫並呼叫 `onChange(route)`；400 ms 內連點同一顆新加的點不會被拿掉。直接修改傳入的 `route`。成員：`setRoute`、`setType(type)`、`render`、`destroy`（解除 click 與 ResizeObserver）。
- canvas 需有 CSS 尺寸（`clientWidth`／`clientHeight`）；像素尺寸由元件依 `devicePixelRatio` 設定。

### 圈點格式（`circles.js`）

- 圈點 `{ x, y, t, r }`：`x`、`y` 是圈心佔照片寬／高的百分比；`t` 是 `s`／`h`／`t`；`r` 是 1／2／3，直徑佔照片寬 4.5%／7%／10%（`CIRCLE_DIAMETER`）。
- `fromCircles(circles, w, h, { holds? }?) → Route`：圈心對到包住它的岩點；對不到的用 24 邊形外框放進 `shapes`（id 為 `c0`、`c1`…，依圈點順序）；不認得的 `t` 當 `h`；同一顆有多個圈時 `s`、`t` 優先。
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
  - 起攀最多 `MAX_START`（2）顆。
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
- 只做取景與點選；縮放、拖曳、轉場由使用方實作（可直接用同一套繪製函式）。
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
