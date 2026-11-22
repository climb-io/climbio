# Wall3DKit（`@climbio/wall3dkit`）

English: [README.en.md](README.en.md)

## 1. 用途

室內 3D 牆：照片重建的岩館牆面模型，每顆岩點都標好在模型上。這個 Kit 載入牆的資料包、把模型畫在 2D 的定線畫面下面（2D 的縮放、平移換成同一塊裁切）、用射線點岩點，提供沿牆走的鏡頭（左右拖沿牆走、上下拖升降、捏合靠近），也負責作者端把工作檔烘焙成成品包。岩點貓的 3D 牆就是用它（`js/wall3d.js` 是 App 的接線）。

- **該用**：有一面 3D 牆的資料包（`climbio-3d-wall/1` 或 `/2`），要在網頁裡定線、看線、點岩點；或要把工作檔烘焙成別人能直接讀的成品。
- **不該用**：戶外的 3D 岩場（高斯潑濺、路線是 3D 折線，用 `crag3dkit/`）；2D 照片的牆（用 `routekit/`）；從照片建出 3D 模型（這裡只讀、只烘焙，重建在 3D 重建流程）。

## 2. 授權與依賴規則

- 授權：AGPL-3.0（`LICENSE`、`NOTICE`）。`vendor/three.js` 是 three.js r180（MIT，含 GLTFLoader）和 three-mesh-bvh 0.9.18（MIT）打包成的單一模組，授權全文在 `vendor/three-LICENSE.txt`。
- 可以依賴：瀏覽器的 DOM、WebGL、`fetch`、`DecompressionStream`、`createImageBitmap`。烘焙的幾何（`bake.js`）和外框幾何沒有 DOM 依賴，Node 也能用；所有模組在 Node 都載得進來，畫面、WebGL 只在呼叫時才用到。
- 不可以依賴：Climbio App 的 `js/`、`state`、`t()`、DOM 元素 id、IndexedDB、Firebase、品牌；其他 Kit。
- 不做任何上傳、不連後端；資料包的網址由使用方提供。
- 使用方（例如 3D 牆的編輯器）要用 three.js 時從 `vendor/three.js` 拿，同一頁只載一份。

## 3. 檔案地圖

| 檔案 | 責任 |
|---|---|
| `index.js` | 入口：匯出下面各檔的公開 API |
| `stage.js` | 舞台：`loadPack`、`openStage`、`openFront` 讀資料包；`Stage` 畫模型、套 2D 視角、點岩點、投外框、快照、光暈、調角度、沿牆走與飛入；分面、裁切、外框幾何 |
| `walkcam.js` | 沿牆走的鏡頭 `WalkCam`：軌道（`wallPath`）、等距線、左右上下的範圍、最遠距離、跟手、實拍校正（`calibrate`）、成品包的 `packWalk`、`unpackWalk` |
| `bake.js` | 烘焙的純函式：裁切平面切三角形、寫出與讀回標準 glb |
| `bakepack.js` | `bakePack`：工作檔烘焙成成品包（切好的模型、岩點標籤、快照、正面外框、沿牆鏡頭） |
| `vendor/three.js` | three.js 加 three-mesh-bvh 打包成的單一模組（MIT），授權在 `vendor/three-LICENSE.txt` |
| `build-vendor.mjs` | 重建 `vendor/three.js`（連網下載 three.js 與 three-mesh-bvh，用 esbuild 打包，只匯出 `NAMES`） |
| `index.d.ts` | 型別（手寫） |
| `test/` | 單元測試：外框幾何、沿牆鏡頭的成品包、打包的匯出（`unit.test.mjs`）；烘焙（`bake.test.mjs`） |

## 4. 公開 API

座標是模型的 `[x, y, z]`（公尺）；舞台座標是 CSS px。完整型別見 `index.d.ts`。

| 名稱 | 說明 |
|---|---|
| `loadPack(base)` | 讀資料包的 `wall.json`（`base` 是資料包網址，結尾 `/`） |
| `openStage(base, pack)` | 下載模型、岩點標籤（成品包另有快照、沿牆鏡頭），建出 `Stage` |
| `openFront(base, pack)` | 成品包只靠 `wall.json` 和快照先建一面牆（快照當照片、烘好的正面外框當岩點），模型之後再載；舊資料包回 `null` |
| `openStageWith(pack, get)` | 檔案從別的地方拿（`get(路徑, 是不是 JSON)`）建 `Stage`：例如 Studio 試用剛在瀏覽器裡烘好、還沒發佈的成品 |
| `openStageFrom(data)` | 資料已在記憶體時建 `Stage`（烘焙也用） |
| `Stage` | `mount`、`unmount`、`dispose`、`warm`；`setView(view)` 套 2D 視角；`paint({ holds, mode, colors })` 畫路線；`pick(x, y)` 點岩點；`outlines()`、`frontOutlines()` 外框；`snapshot()`、`viewShot()`；`setEdits(edits)` 修點；沿牆鏡頭：`walk(view, at)`、`flyIn`、`frameTo(ids)`（估的位置看不到這些岩點時，沿路線找看得到的位置與角度）、`flyWalk(to)`、`revealAt(x, y)`（重疊、被擋住的岩點：找露出最多顆的位置）、`seenOf(holds)`、`bestPose`、`angle(dx)`、`settle`、`resetTilt` |
| `WalkCam` | 沿牆鏡頭：`s`、`v`、`d`、`yaw`；過了停點（轉進 cave、側牆）照主牆的左右方向繼續直走、看的點照樣沿牆走（`beyond`），最多走到那段牆最外側的位置，不走進去；`sRange()`、`vRange(s, d)`、`dMax`、`dMin`；`pan`、`zoomAt`、`clamp`、`apply`；`missedHolds(d)` 檢查標準；`calibrate` 實拍校正 |
| `wallPath`、`profile`、`meshesOf`、`loadGlb` | 從模型算軌道（作者端） |
| `packWalk`、`unpackWalk`、`tableFor`、`introEnd` | 沿牆鏡頭寫進成品包、讀回、挑畫面比例最接近的邊界表、進定線停的位置 |
| `bakePack({ doc, glb, faces })` | 工作檔烘焙成成品包，回傳 `{ files: [{ path, bytes }], stats }` |
| `clipPolygon`、`bakeMesh`、`cutOutlines`（修點外框照描的線切網格）、`writeGlb`、`parseGlb`、`sourceTexture` | 烘焙的純函式 |
| `packSurfaces`、`goneHolds`、`holdMargin`、`frameTest`、`frameShader`、`packSig` | 工作檔的分面、不在的岩點、裁切 |
| `hull`、`simplify`、`inside`、`decode`、`inflate`、`u16`、`parseModel` | 小工具 |
| `STEP`、`YAW_MAX`、`YAW_RATE`、`FRAME_MAX`、`FRAME_BOUNDS` | 常數 |

### 鏡頭的標準

沿牆鏡頭的範圍只看模型和岩點資料（`WalkCam.sees` 打射線、`WalkCam.holds` 岩點位置），不針對哪一面牆調參數，每種畫面比例各自算。依優先順序：每顆正面牆上的岩點都點得到（完整出現在可用畫面、離邊 8 公分）；在這之內盡量不露出牆外；最遠距離是牆上還有連續一個畫面寬走過去四邊都是牆；側牆上的岩點靠 ±30° 的角度看。細節見 [docs/3d-wall.md](../docs/3d-wall.md) 的「鏡頭的標準」。

## 5. 資料格式與不變條件

資料包的檔案與欄位寫在 [docs/3d-wall.md](../docs/3d-wall.md)（「成品包」「資料包」）。

- `climbio-3d-wall/1`（工作檔）：`wall.json`（岩點、貼圖空間的岩點標籤、分面、裁切平面、上方與正面方向、授權）、`model-<雜湊>.glb`、`faces-<雜湊>.bin`（每個三角面屬於第幾顆岩點，uint16）。
- `climbio-3d-wall/2`（成品，`bakePack` 產生）：標準 glTF 2.0 的 `wall-<雜湊>.glb`（已切好、不受光），每個面、每個貼圖像素、每顆岩點覆蓋網格的岩點編號（deflate）、`snapshot-<雜湊>.jpg`、`walk-<雜湊>.json`（軌道、牆面深度、各畫面比例的實拍邊界表）；讀的時候不裁切、不算軌道。
- 岩點 id 在同一面牆裡不變；重新輸出同一個模型時 id 照舊。
- 牆面內容（模型、貼圖、岩點）以 CC BY-SA 4.0 公開。

## 6. 最小範例

```js
import { loadPack, openStage } from '@climbio/wall3dkit';

const base = 'https://example.org/walls/abc/';   // 資料包網址，結尾 /
const pack = await loadPack(base);
const stage = await openStage(base, pack);
stage.mount(document.querySelector('#stage'));
stage.setView({ s: 1, tx: 0, ty: 0, bw: stage.snapW });
stage.paint({ holds: { [pack.holds[0].id]: 'start' }, mode: 'dim', colors: { start: '#22c55e' } });
document.querySelector('#stage').addEventListener('click', (e) => console.log('點到', stage.pick(e.offsetX, e.offsetY)));
```

烘焙（作者端，瀏覽器裡跑，要 WebGL 做實拍校正與快照）：

```js
import { bakePack } from '@climbio/wall3dkit';

const { files, stats } = await bakePack({ doc: wallJson, glb, faces });   // files：[{ path, bytes }]，整包放到同一個資料夾
```

## 7. 限制

- `Stage` 照岩點貓的定線畫面設計（2D 視角的 `s`、`tx`、`ty`、`bw`，快照的像素座標）；別的畫面要照這套座標接。
- 一次一面牆、一個模型；手機的記憶體要放得下模型與貼圖。
- 沿牆鏡頭要成品包（`walk`）；舊的工作檔照正面的軌道相機看。
- 拉到最近時，內角裡的少數岩點鏡頭會走進角落，要調角度才看得到。
- 需要 WebGL；沒有 WebGL 的環境只會失敗，不會退回 2D（2D 的退路是快照和外框）。

## 8. 驗證

- 單元測試：`node --test wall3dkit/test/*.test.mjs`（也在 `npm run test:quick` 的 `kit-packages`）。
- 型別檔宣告了每個匯出、`package.json` 列的檔案都在、授權檔齊全、不 import Kit 外面的檔案：`tools/kit-packages.test.mjs`。
