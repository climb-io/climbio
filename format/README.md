# format（@climbio/format）

[English](README.en.md) | 繁體中文

## 1. 用途

Climbio 公開資料格式 v2 的 JSON Schema（draft 2020-12）與驗證器：以「畫面」（照片、向量圖、地圖、3D 模型）為中心，路線、岩點、岩壁、岩場都是節點，常變更的標註放在疊在畫面上的圖層，其他東西是畫面的組合。

- 該用：讀寫、發佈、匯入、驗證 Climbio 格式的檔案（站台、擴充功能、匯入器、Studio、App）。
- 不該用：要渲染、編輯、上傳照片（這裡只驗證 JSON）；要解讀詞彙（`type`、`props` 的意義看 [VOCABULARY.md](VOCABULARY.md)，驗證器不檢查多數詞彙）。

人類可讀的完整規格是本資料夾的 `climbio.schema.json` 加 [VOCABULARY.md](VOCABULARY.md)；網站想讓紅點貓用網址匯入見 [docs/redpoint-sites.md](../docs/redpoint-sites.md)。

## 2. 授權與依賴規則

- 授權：Apache-2.0（`LICENSE`、`NOTICE`）。樣本照片不在本資料夾，各依檔案內的 `license`、`attribution`（CC BY-SA 4.0）。
- 沒有任何相依套件、沒有建置步驟。
- 不可以 import 或引用 AGPL 的程式（`js/`、`holdscan/`）、Climbio 的後端或任何產品（`studio/`、`redpoint/`、`hold/`）。
- 其他 kit（`sourcekit/`、`routekit/`…）彼此獨立；`format/` 不 import 任何 kit。
- 沒有被複製到別處（`tools/sync-extension.mjs` 只複製 `sourcekit/`）。

## 3. 檔案地圖

| 檔案 | 責任 |
|---|---|
| `format.js` | 唯一的實作：UMD，建立 `SCHEMA`、`validate`、`VERSION`；瀏覽器掛全域 `ClimbioFormat`，Node 用 `require` |
| `index.mjs` | ESM 入口，轉出 `format.js` 的內容（default 加具名匯出） |
| `index.d.ts` | TypeScript 型別（`View`、`Layer`、`Set`、`Node`、`Mark`、`Camera`…） |
| `climbio.schema.json` | `SCHEMA` 原樣輸出給其他語言用；改了 `format.js` 要重新輸出，測試會比對 |
| `VOCABULARY.md` | 節點 `type` 與 `props` 的詞彙（開放，不影響驗證器與版本） |
| `examples/` | 樣本：`wall.json`、`wall-routes.json`、`topo.json`、`topo-routes.json`、`map.json`、`set.json`、`wall-photos/`、3D 岩場 `crag3d.json`（組合）加 `crag3d-model.json`、`crag3d-overview.json`、`crag3d-wall.json`、`crag3d-routes.json`（不附模型和照片） |
| `package.json`、`LICENSE`、`NOTICE` | 套件設定與授權 |

## 4. 公開 API

| 名稱 | 簽章 | 說明 |
|---|---|---|
| `VERSION` | `2` | 目前的格式版本，檔案的 `climbio` 欄位必須等於它 |
| `SCHEMA` | `Record<string, unknown>` | JSON Schema（draft 2020-12），內容同 `climbio.schema.json` |
| `validate(doc)` | `(doc: unknown) => string[]` | 回傳錯誤清單，每項是 `欄位路徑：原因`；空陣列就是合格 |

- 錯誤：`validate` 不丟例外；輸入不是物件也只回傳錯誤字串（`（最上層）：要是 object`）。
- 副作用：無。純函式，不讀檔、不連網。
- 先照 Schema 檢查，Schema 有錯就只回 Schema 的錯；Schema 合格才做關聯檢查（見第 5 節）。
- ESM（`import { validate, SCHEMA, VERSION, default }`）、CommonJS（`require`）、瀏覽器 `<script src="format.js">`（全域 `ClimbioFormat`）三種載入方式內容相同。
- 套件匯出路徑：`.`、`./climbio.schema.json`、`./package.json`。

型別：`Doc = View | Layer | Set`；`View = PhotoView | DrawingView | MapView | ModelView`；`Geometry` 是 GeoJSON 幾何（`Point`、`MultiPoint`、`LineString`、`MultiLineString`、`Polygon`、`MultiPolygon`）。

## 5. 資料格式與不變條件

三種檔案，以 `kind` 區分：

| `kind` | 必要欄位 | 內容 |
|---|---|---|
| `view` | `climbio`、`kind`、`id`、`surface`、`t`、`license`、`attribution`、`origin` | 可標註的平面；`surface` 是 `photo`、`drawing`、`map`、`model` |
| `layer` | 共用欄位加 `on` | 疊在畫面 `on` 上的節點與標註，座標用那個畫面的 |
| `set` | 共用欄位 | 組合：`items` 放畫面、圖層、組合，可以再組合；`type` 是自由字串 |

`view` 的 `surface` 各自的必填欄位與座標系：

| `surface` | 必填 | 座標 |
|---|---|---|
| `photo` | `href`、`w`、`h`、`mime`（jpeg／png／webp） | 照片像素，左上角 `(0, 0)` |
| `drawing` | `w`、`h` | 圖自己的座標 |
| `map` | 無 | 經緯度（WGS84），經度在前 |
| `model` | `href`（`.glb` 或高斯潑濺 `.spz`）、`mime`（`model/gltf-binary`、`model/x-spz`） | 模型公尺，`y` 朝上 |

不變條件（`validate` 會檢查）：

- `climbio` 必須是 `2`；`origin` 必須是 `self`、`authorized`、`personal`（紙本、來源不明的照片沒有可用的值，不出裝置）。
- 檔案 id：`[0-9a-z]{12,64}`（新產生的用 16 碼，隨機、全小寫）；本地節點 id：`[0-9a-z][0-9a-z_-]{0,63}`，檔案內不重複；跨檔案引用寫全域 id 或「檔案id#節點id」。
- `href`：相對路徑（不以 `/` 開頭、不含 `..`）、`https://` 網址或 `drive://{files.json 的 Drive 檔案 id}/{包內相對路徑}`。
- 節點 `parent` 找得到（或是全域 id）、不繞回自己；`geo` 與地圖標註是經緯度範圍內。
- 標註 `geometry` 是 GeoJSON 幾何；多邊形首尾同點；座標在畫面範圍內（照片 `0..w`、`0..h`；圖層與 3D 模型不查範圍，因為圖層的畫面不在這個檔案）。
- 畫面標註的 `node` 在這個檔案找得到，或是全域 id。
- 路線 `props.holds` 的角色是 `s`、`h`、`f`、`t`；畫面內的 `holds` 指到 `type: "hold"` 的節點；`props.seq` 的項目都在 `holds` 裡；`props.crop` 不超出畫面。
- 組合不放自己、圖層不疊在自己上面。
- 不認得的欄位、`type`、詞彙一律略過（讀的人與驗證器都是）。

驗證器不做、呼叫端要自己做：圖檔下載後的大小、類型、`sha256` 檢查；只收 `https` 或 `drive` 連結；不顯示對方 HTML；SVG 底圖當圖片顯示。

放法原則（細節見 `climbio.schema.json` 與 `VOCABULARY.md`）：一個事實只放一處；節點樹與路線放組合的 `nodes`，Topo 線段與 bolt 放圖層，岩點牆的路線在圖層（例外）；分享的最小單位是 Topo，一包要單獨能完整顯示。

## 6. 最小可跑範例

```js
// npm install @climbio/format，存成 check.mjs，node check.mjs
import { validate } from '@climbio/format';

const view = {
  climbio: 2, kind: 'view', id: 'wall0000000001a', surface: 'photo',
  t: Date.now(), license: 'CC-BY-SA-4.0', attribution: 'Me', origin: 'self',
  href: 'wall.jpg', w: 1600, h: 1200, mime: 'image/jpeg',
  nodes: [{ id: 'h1', type: 'hold' }],
  marks: [{ node: 'h1', geometry: { type: 'Polygon', coordinates: [[[10, 10], [50, 10], [50, 50], [10, 10]]] } }],
};

console.log(validate(view));                        // []
console.log(validate({ ...view, origin: 'x' }));    // ['origin：要是 self、authorized、personal 其中之一']
```

## 7. 限制與已知取捨

- 驗證器是手寫的子集實作（只支援本 Schema 用到的關鍵字），不是通用的 JSON Schema 引擎；其他語言用 `climbio.schema.json` 配自己的函式庫，但 Schema 表達不了的關聯檢查（第 5 節後半）要自己做。
- 回傳的是字串清單，沒有錯誤碼；要程式判斷請自行比對欄位路徑。
- `validate` 一次只驗一份檔案，不跨檔案檢查（圖層指到的畫面、組合的 `items` 是否存在、全域 id 是否解析得到）；跨檔案的放法檢查見 `tools/format-placement.mjs`（repo 內部工具，不在套件裡）。
- 座標範圍只對畫面自己的標註檢查；圖層的座標範圍要看底下的畫面，驗證器不查。
- 瀏覽器與 Node 行為相同；沒有需要的全域。

## 8. 驗證

```bash
node --test tools/format.test.mjs tools/format-placement.test.mjs tools/share-format.test.mjs
```

- `tools/format.test.mjs`：Schema 與 `climbio.schema.json` 一致、樣本合格、各種錯誤的欄位路徑、id、上層、標註、拍照資料。
- `tools/format-placement.test.mjs`：岩場層次與放法（路線在組合、圖層只有 bolt 與線段）。
- `tools/share-format.test.mjs`：`appkit/share-tools.js` 與 `functions/open-format.js` 讀寫公開格式 v2（用 `format.js` 驗證）。
- 改了 `format.js` 要重新輸出 `climbio.schema.json`：`cd format && node -e "process.stdout.write(JSON.stringify(require('./format.js').SCHEMA, null, 2) + '\n')" > climbio.schema.json`。`package.json` 的 major 版本必須等於 `VERSION`（測試檢查）。
- 規格行為改了要同步更新本檔、`README.en.md` 與 `VOCABULARY.md`。
