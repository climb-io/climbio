# mapkit（`@climbio/mapkit`）

English: [README.en.md](README.en.md)

## 1. 用途

岩場的向量地圖看圖與編輯：岩壁、步道、道路、區域、地名、救援點，標籤自動避讓、比例尺、羅盤；拖曳平移、雙指縮放與旋轉；底圖圖磚（OpenStreetMap、航照、等高線）可開關。編輯：畫線與多邊形、移動與增減頂點、岩壁面朝向、復原／重做，輸出圖層。原生 SVG、純 ES module，沒有建置步驟。

- **該用**：有 Climbio 公開格式 v2 的地圖畫面（經緯度）和圖層，要顯示岩場地圖、讓使用者改岩壁線或區域範圍。
- **不該用**：照片上的路線圖（用 `topokit/`）；室內噴漆牆（用 `routekit/`）；定位、上傳、提交、歷史版本（由使用的 App 負責，本 kit 不連後端，圖磚除外）。

## 2. 授權與依賴規則

- 授權：AGPL-3.0（`LICENSE`、`NOTICE`）；投影、畫面、標籤避讓、畫法、手勢與編輯移植自龍洞，MIT 聲明在 `NOTICE`。`baseline/longdong-map.json` 的底圖含 OpenStreetMap 資料（ODbL）；`world.json` 在自己的 `license` 欄位宣告 CC0-1.0。
- 可以依賴：瀏覽器 DOM／SVG；Web Component 用 `fetch`；底圖用圖磚網址（網路）。純函式（`readMap`、`renderMap`、`declutter`、投影、視角）不需要 DOM，Node 可跑。
- 不可以依賴：Climbio App 的 `js/`、`holdscan/`（AGPL）、App 的 `state`、`t()`、DOM 元素 id、IndexedDB、Firebase、品牌。
- kit 彼此獨立，不 import 其他 kit；資料只靠 Climbio 公開格式 v2 的結構，驗證用 `@climbio/format` 的 `validate`。

## 3. 檔案地圖

| 檔案 | 責任 |
|---|---|
| `index.js` | 入口，re-export 下列各檔 |
| `data.js` | v2 → 地圖模型：`readMap`、`assertMap`、`pickName`、`pathOf`、`centroid`、`BASE_KINDS`、`LINE_KINDS` |
| `render.js` | 地圖模型 → SVG 字串：`renderMap`、`wallLabelAt`、`SECTOR_LABEL_SCALE` |
| `labels.js` | 標籤避讓：`declutter`、`placeLineNames`、`textWidth`、`segmentDistance` |
| `viewport.js` | 投影與視角純函式：`projection`、`toScreen`、`toMap`、`fitRectView`、`zoomAt`、`rotateAt`… |
| `tiles.js` | 底圖圖磚：`SOURCES`、`visibleTiles`、`tileLevel`、等高線處理 |
| `view.js` | `MapViewer`：SVG、手勢、控制鈕、圖磚、事件、`TEXT` 多語介面文字 |
| `editor.js` | `MapEditor`（繼承 `MapViewer`）：頂點編輯、畫線、岩壁面朝向、復原／重做 |
| `style.js` | 元件用的 CSS 字串 `CSS` |
| `element.js` | Web Component `<climbio-map>`（載入即註冊） |
| `world.json` | 世界底圖（v2 地圖畫面），給全世界尺度的地圖用 |
| `index.d.ts`、`element.d.ts` | 型別（手寫） |
| `demo.html` | 示範頁 |
| `test/unit.test.mjs`、`baseline/` | 單元測試；與龍洞 `ScaleMap` 逐項一致的場景、SVG 與截圖基準 |

## 4. 公開 API

經緯度一律 `[經度, 緯度]`；內部平面座標是公尺（x 向東、y 向南）。完整型別見 `index.d.ts`、`element.d.ts`。

### MapViewer

`new MapViewer(host: HTMLElement, options?: ViewerOptions)`，繼承 `EventTarget`。

| 成員 | 說明 |
|---|---|
| `setData({ view, layers?, nodes? })` | 載入資料；不是 v2 地圖畫面（`surface: map`）時丟錯 |
| `set(options)` | 更新選項並重畫 |
| `getView() → { center, metersPerPixel, rotation } \| undefined`、`setView({ center, metersPerPixel, rotation? })` | 畫面（中心經緯度、每像素幾公尺、旋轉度數順時針） |
| `focus({ node? \| points?, tight? })`、`zoomBy(factor)`、`home()` | 取景到節點或點、縮放、回到一開始的畫面 |
| `toScreen(lngLat) → [x, y]`、`toLngLat([x, y]) → [lng, lat]` | 座標換算（放在地圖上的圖釘用） |
| `render()` | 重畫 |
| `model`、`labels`、`options` | 唯讀：地圖模型、最近一次畫出的名稱與地點（螢幕座標）、選項 |
| `destroy()` | 解除所有事件監聽、ResizeObserver、計時器 |

事件（`detail`）：`pick`（`{ node, line? }`，點到岩壁或石頭）、`tap`（`{ at, metersPerPixel }`，`at` 是 `[經度, 緯度]`）、`view`（同 `getView()`，拖動、縮放、框大小改變時發）、`areapress`（`{ node }`，區域）、`locate`、`error`（`detail` 是錯誤）。

選項（`ViewerOptions`，皆可省略）：

| 選項 | 說明 |
|---|---|
| `lang`、`text`、`aria` | 名稱與介面文字語言（`zh`、`en`、`ja`）、覆蓋介面文字、無障礙名稱 |
| `dim` | 區域節點 id：其他區域變淡 |
| `hideAreas`、`hide` | 不畫區域、不畫的節點 id（也點不到） |
| `walls`、`sectorLabels` | 畫岩壁（預設 `true`）、放大後標分區名稱（`true` 或分區 id 陣列） |
| `selected` | 選中的岩壁 `{ node, line? }` |
| `basemap` | `{ osm, ortho, contours }`：OpenStreetMap、國土測繪中心航照、1/5000 地形圖等高線與海岸線 |
| `marks`、`here`、`pin`、`draft` | 回報位置、目前位置與誤差圈 `{ at, accuracy }`、圖釘、正在畫的線 `{ points, closed? }` |
| `attribution` | 右下角版權標示，預設是畫面的 `attribution` |
| `controls` | `false`：不放羅盤、縮放鈕、比例尺 |
| `locate` | 顯示「回到我的位置」按鈕，按了發 `locate`（定位由 App 做、結果放 `here`） |
| `rotate` | `false`：兩指只縮放、移動 |
| `flat` | `true`：陸地與國界用螢幕座標畫；全世界尺度的底圖用，每次重畫都重算 |
| `minScale` | 最多放大到每像素幾公尺，預設 0.05 |
| `dblclick` | `'home'`：點兩下回到一開始的畫面（預設是放大） |

### MapEditor

`new MapEditor(host, options?: EditorOptions)`，繼承 `MapViewer`，多出選項 `picking`（受控模式：點地圖一律發 `tap`）、`layer`（要接著改的圖層，沿用 id、license、attribution）、`license`。

- 一次改一個節點：`edit({ node, closed?, faces? })`；多邊形或線依節點原本的標註。
- 形狀：`rings`（唯讀）、`select(index)`、`draw()`、`finish()`、`cancel()`、`flip(index?)`（線反過來）、`removeRing(index?)`、`removeVertex(vertex, index?) → boolean`（多邊形至少三點、線至少兩點，否則不刪並回 `false`）。
- 歷史與輸出：`undo()`、`redo()`、`canUndo`、`canRedo`、`layer`（輸出的圖層：改過的節點各一個標註）。
- 受控模式：`setEdit({ rings, closed, selected?, faces? } \| undefined)`，形狀由 App 給，修改發 `editstart`、`editchange`（`{ rings }`）、`select`。
- 事件：繼承 Viewer 的，另有 `change`（`{ layer, node }`）、`history`（`{ canUndo, canRedo }`）、`select`（`{ index }`）、`editstart`、`editchange`。
- 輔助：`faceTrail(line, trails)`、`wallFaces(line)`、`nearestOnSegment(p, a, b)`、`newId()`。

### 資料、繪製、版面、視角、圖磚（純函式與常數）

| 名稱 | 說明 |
|---|---|
| `readMap(view, layers?, nodes?) → MapModel`、`assertMap(view)` | 讀 v2；`assertMap` 對不是地圖畫面的丟錯 |
| `pickName(name, lang)`、`pathOf(line, close?)`、`centroid(ring)`、`BASE_KINDS`、`LINE_KINDS` | 名稱、SVG 路徑、重心、支援的 `props.kind` |
| `renderMap(model, view, frame, options) → { svg, labels }`、`wallLabelAt(lines)`、`SECTOR_LABEL_SCALE` | 地圖 SVG 字串 |
| `declutter(…)`、`placeLineNames(…)`、`textWidth`、`segmentDistance` | 標籤避讓 |
| `projection(origin)`、`toScreen`、`toMap`、`mapTransform`、`fitRectView`、`focusView`、`clampView`、`clampScale`、`maxScale`、`panBy`、`zoomAt`、`rotateAt`、`dashLength`、`rectOf`、`MIN_SCALE`、`STEP` | 投影與視角 |
| `SOURCES`、`visibleTiles(proj, view, frame, source, options?)`、`tileLevel`、`keepContours`、`contourTile(href)` | 圖磚來源與可見圖磚 |
| `TEXT`、`LINE_HIT_PX`、`CSS` | 介面文字、命中半徑、樣式 |

### Web Component `<climbio-map>`

`import '@climbio/mapkit/element'`（載入即註冊；沒有 `HTMLElement` 時什麼都不做）。

| 屬性 | 說明 |
|---|---|
| `view`、`layers` | 地圖畫面、圖層的網址（`layers` 空白分隔）；只收 https 或同站；圖層的 `on` 要等於畫面的 `id` |
| `mode` | `view`（預設）或 `edit` |
| `lang`（預設 `zh`）、`dim`、`basemap`（空白分隔 `osm`／`ortho`／`contours`）、`no-walls`、`locate`、`dblclick="home"`、`controls="false"` | 對應同名選項 |
| `no-rotate`、`flat`、`min-scale` | 對應 `rotate: false`、`flat`、`minScale`；不在觀察清單，改屬性不會即時套用，建立元件前設好 |

- JS 屬性：`data`（`{ view, layers, nodes }`；設了就更新並發 `ready`）、`viewer`（`MapViewer`，`mode="edit"` 時是 `MapEditor`）。
- 事件：轉出 `view`、`tap`、`pick`、`areapress`、`locate`、`error`、`change`、`history`、`select`（`detail` 同原事件）；另有 `ready`（資料載入後）。`editstart`、`editchange` 不轉出，要用 `el.viewer.addEventListener`。
- 從頁面拿掉元件時所有監聽與觀察器解除，再放回來會重建。預設 `display: block; height: 300px`。

## 5. 資料格式與不變條件

輸入與輸出是 Climbio 公開格式 v2：地圖畫面（`kind: view`、`surface: map`，座標 `[經度, 緯度]`）加圖層（`kind: layer`）。詞彙見 `format/VOCABULARY.md` 的「地圖」。

| v2 | 畫成 |
|---|---|
| 沒有節點、`props.kind` 為 `land`、`building`、`parking` 的多邊形 | 陸地、建物、停車場 |
| 沒有節點、`props.kind` 為 `border` 的線或多邊形 | 國界（固定細度） |
| 沒有節點、`props.kind` 為 `highway`、`tunnel`、`road`、`trail` 的線 | 道路（至少畫成實際寬度）、隧道與步道（虛線） |
| 沒有節點、`props.kind` 為 `route` 的線 | 建議行進路線（疊在道路上的粗線，沿線箭頭指向畫線方向） |
| `type: area`、`crag` 節點的多邊形；標註 `props.style`（`fill`、`stroke`）、`props.labelAt` | 區域與名稱 |
| `type: sector`、`wall` 節點的多邊形 | 石頭（一顆顆石塊，點裡面發 `pick`） |
| `type: sector`、`wall` 節點的線；標註 `props.style.stroke` | 岩壁（沿牆底）；畫線方向決定面朝向（右手邊） |
| `type: poi` 的 `Point`，`props.kind` 為 `rescue`、`parking`、`first-aid`、`boat`、`helicopter`、`hazard`、`place`、`line-name` | 救援點（`props.label` 編號）、停車場、急救、船艇、直升機、危險、地名（`props.tone`）、沿線道路名稱（`props.line`） |
| 畫面的 `props.bounds`、`extent`、`home`（`[西, 南, 東, 北]`） | 移動範圍、底圖資料範圍、初始畫面 |

不變條件：

- 名稱依 `lang` 取，沒有就用中文、英文；名稱可放在 `nodes`（例如組合檔），不必複製進畫面。
- 圖層裡有標註的節點，以最後一個圖層的形狀為準（改過的岩壁蓋掉原本的）。
- 多邊形至少三點、線至少兩點。
- 輸出圖層只含改過的節點，每個一個標註；圖層通過 `@climbio/format` 的 `validate`。
- 新的岩壁預設朝向最近的步道。

## 6. 最小可跑範例

```bash
npm install @climbio/mapkit @climbio/format
```

用靜態伺服器提供頁面（不能用 `file://`），資料用 `@climbio/format` 附的 `examples/map.json`（地圖畫面，岩壁線在 `marks`）：

```html
<script type="module">
  import '/node_modules/@climbio/mapkit/element.js';
</script>
<climbio-map view="map.json" lang="zh" basemap="ortho" style="height:70vh"></climbio-map>
```

JS 版（有打包工具）：

```js
import { MapEditor } from '@climbio/mapkit';
const view = await (await fetch('map.json')).json();
const editor = new MapEditor(document.getElementById('host'), { lang: 'en' });
editor.setData({ view });
editor.edit({ node: 'wall-node-id' });          // 換成畫面裡某個 wall／sector 節點的 id
editor.flip();                                   // 岩壁面換到另一側
editor.addEventListener('change', (e) => console.log(e.detail.layer));
```

`demo.html`：repo 根目錄 `python3 -m http.server 8765`，開 `/mapkit/demo.html`（載入 `baseline/longdong-map.json` 的龍洞地圖）。可開關底圖、選分區改岩壁（拖曳頂點、按邊上的中點加頂點、右鍵刪頂點、畫線、反過來、復原／重做），下方是輸出的圖層。

## 7. 限制與已知取捨

- 需要瀏覽器的 DOM、SVG；純函式可在 Node 執行。
- 底圖圖磚（OpenStreetMap、國土測繪中心航照、等高線）是選用的外部服務，需要網路；不開 `basemap`、沒有網路也能顯示與編輯自備資料。圖磚各有版權標示，右下角會顯示。
- 全世界尺度的底圖要開 `flat`，否則 Android Chrome 的 GPU 繪圖會把底圖畫到別處；`flat` 每次重畫都重算座標，只給點不多的底圖用。
- 顏色用 CSS 變數：`--mk-brand`（正在畫、編輯中的線）、`--mk-sea`、`--mk-land`、`--mk-route`；沒有海的岩場地圖把 `--mk-sea` 和 `--mk-land` 設成一樣。
- 外觀對齊龍洞 `ScaleMap` 的基準（`baseline/`）；改畫法要連同基準重產。

## 8. 驗證

| 內容 | 指令 |
|---|---|
| 版面與龍洞 `ScaleMap` 逐項一致、v2 讀取、圖層蓋掉舊形狀、畫面縮放、岩壁朝向 | `node --test mapkit/test/unit.test.mjs`（`npm run test:quick` 也會跑） |
| 瀏覽器：demo 看圖與編輯、底圖圖磚、資源清理 | 內部 e2e 案例；外部安裝流程 內部 e2e 案例 |
