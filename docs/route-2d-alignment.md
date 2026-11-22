# 2D 看線、定線：岩點貓與內嵌頁的對齊現況

目標：看路線圖、定線都只有一份實作（RouteKit），岩點貓與內嵌頁（iframe／WebView）都呼叫它；各家不一樣的只有「選項」和「宿主專屬的外殼」（分享、編輯、完攀紀錄、存檔）。

## 已共用（一份程式，兩邊都呼叫）

| 項目 | 在哪 |
|---|---|
| 點岩點的規則（類型、起攀上限、剛加進來不算拿掉）、出手順序、不限腳、熱圖次數 | `routekit/editor.js` |
| 外框、標籤、膠帶、順序標記、熱圖外框的畫法 | `routekit/labels.js` |
| 路線底圖（暗彩、黑白、路線岩點原色）、路線圖輸出（分享圖、縮圖） | `routekit/base.js`、`scene.js`、`image.js` |
| 公開格式 v2 的讀寫 | `routekit/format.js`、`format/` |
| 定線的操作介面：上方圓鈕、類型列、順序列、選單、完成鈕規則 | `routekit/ui.js`（`EditorUI`） |
| 自由畫岩點外框（長按、放大鏡、簡化成多邊形） | `routekit/viewer.js`、`geometry.js` |

## 靜態顯示一致（有測試守著）

同一面牆、同一條路線，岩點貓與內嵌頁畫出來的畫面要一樣：底圖、岩點外框、起攀／完攀膠帶、順序標記、標籤大小。看路線圖用膠帶標籤、岩點不畫外框；定線畫光暈和外框；標籤大小是路線視角時的固定螢幕大小（`routekit/fit.js` 的 `labelUnitOf`，兩邊同一份）。

`tests/e2e/static-parity.spec.mjs` 把岩點貓的按鈕列藏起來、照片回到整張置中，內嵌頁縮到最小，逐像素比對（看路線圖、定線、第二條路線、有出手順序，共 5 種）：平均每色差小於 3.5（0～255）、差超過 24 的像素少於 0.8%。剩下的差異只是取樣（岩點貓用 CSS 縮放畫布、內嵌頁直接畫在畫布上）造成的細微邊緣差；目前約 2.2 與 0.2%～0.35%。樣式、大小、位置錯了就會超過。

## 還是兩套（要對齊）

| 項目 | 岩點貓 | 內嵌頁（RouteKit） |
|---|---|---|
| 縮放、平移的**算法**（邊界、最大縮放、縮放檔位、以一點為中心縮放、點兩下的倍數與間隔） | **已共用**：`routekit/viewport.js`（`clampView`、`maxScaleOf`、`zoomAround`、`ZOOM_STEPS`、`DOUBLE_TAP`、`DOUBLE_MS`），岩點貓的 `js/wall.js`、`js/mobile.js`、`js/edit.js` 呼叫它 | 同左 |
| 縮放、平移的**手勢與動畫**（捏合、拖曳、點兩下、`flyTo`、左右滑、下拉返回） | `js/mobile.js`、`js/wall.js`、`js/edit.js`（跟路線切換、單點編輯、3D 牆的手勢交織） | `routekit/viewport.js` 的 `Viewport` 類別 |
| ~~路線視角（看路線圖一開始的取景）~~ | **已共用**：算法在 `routekit/fit.js`（`fitBoxIn`、`groupBox`、`routeFit`），岩點貓的 `js/wall.js` 與 `RouteViewer.homeView` 都呼叫它 | 同左 |
| 看路線圖畫面 | `js/draw.js`：照片層加線條層（縮放時整層變形、停手重畫）、預先畫鄰近路線 | `RouteViewer.render` 一層畫布 |
| ~~上一條／下一條、路線序號~~ | **已共用**：`routekit/ui.js`（`setNav`、`onPrev`、`onNext`），岩點貓看路線圖下面與內嵌頁看線（圖層不只一條路線時，選項 `nav`）都用它 | 同左，按了送 `route { routeId }` |
| 左右滑換路線（手勢與動畫） | `js/mobile.js`（`placeSwipe`） | 沒有 |
| 看路線圖上方：返回、難度加名稱（可改名）、更多選單、完攀紀錄鈕 | `#vw`（`index.html`、`js/profile.js`） | 沒有（只有黑白切換、縮放、全畫面） |
| 換底色轉場、揭開動畫（reveal） | `js/edit.js` 的 `baseSwap`、`js/wall.js` 的 `drawReveal` | 沒有 |
| 單點編輯（修岩點外框、重描、圈起來） | `js/edit.js`、`js/draw.js` | 沒有（內嵌頁只有點選、自由畫） |
| 3D 牆 | `js/wall3d.js` + `wall3dkit/` | 沒有 |
| 定線的畫面（照片層、線條層、手勢） | `js/wall.js`、`js/draw.js`、`js/mobile.js` | `RouteEditor` |

## 對齊的做法（分步，每步都能獨立部署與退回）

1. ✅ **路線視角（已完成）**：`routeFit`、`groupBox`、`fitBox` 搬進 kit（`routekit/fit.js`），`RouteViewer` 的起始視角與岩點貓都呼叫它；單元測試 `tools/route-fit.test.mjs`。內嵌頁看路線的起始取景因此改成跟岩點貓一樣（最多放大到照片填滿畫面為止、同一組路線共用視角、標籤也放進畫面）。
2. **縮放、平移**：岩點貓的 `setView`、`clampView`、`flyTo` 改用 kit 的 `Viewport`（先補齊：`fitPads`、3D 牆沿牆鏡頭這些岩點貓專屬的邊界用選項接）。
3. 🟡 **看路線圖元件（部分完成）**：下面的上一條／下一條與序號已在 `EditorUI`；上方列（返回、難度加名稱可改名、更多選單、完攀紀錄鈕）和左右滑還沒搬，它們跟岩點貓的改名、分享、完攀紀錄、手勢交織，宿主專屬的部分要用插槽放進去。
4. **畫面層**：照片層加線條層的畫法（縮放時整層變形）進 kit 的 `RouteViewer`／`RouteEditor`，岩點貓的 `js/draw.js` 的路線部分改呼叫它。
5. 單點編輯、3D 牆維持岩點貓專屬（不在內嵌頁範圍），之後 3D 內嵌頁另做。

每一步都要在動手前後量效能（岩點多的牆縮放、拖曳、左右滑的幀時間），退步就不合併。

## 效能把關

岩點貓不能因為合併變慢。基準腳本：`node tools/perf-hold-view.mjs`（要先啟動 `python tools/serve-test.py`；在 repo 根目錄執行），開一面合成的 700 顆岩點大牆，CPU 降速 4 倍，量 `clampView`、`setView`（縮放平移每一幀）、`render`、`routeFit`、定線的 `refreshUi`。合併前後各跑 5 次輪流對照取中位數（`tools/perf-compare.mjs`）。

第 2 步（縮放平移的純算法併進 kit）的結果：`clampView` 0.136 → 0.147 ms、`setView` 3.34 → 3.48 ms（+4%）、`render` 不變、`routeFit` 2.52 → 2.66 ms；沒碰的 `refreshUi` 也差 +9%，所以這些差異都在量測的雜訊裡，沒有可感覺的變化（每幀預算 16 ms）。
