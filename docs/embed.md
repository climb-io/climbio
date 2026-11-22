# 內嵌：把 Climbio 的看線、定線畫面放進你的網站或 App

給想用岩點貓的看線、定線畫面、但不想公開自己前端原始碼的岩館網站或 App（網頁或原生）。內嵌頁是靜態頁，**資料只有一種來源：Climbio 官方發佈的網址**。你的 App 只給三個網址，內嵌頁自己讀；定線的結果用訊息傳回你的 App。不用註冊、不用金鑰、不用安裝。設計理由見 [proposals/kit-embed.md](proposals/kit-embed.md)。

## 適合誰

適合願意和岩友一起分享路線的岩館：牆面與路線公開（CC BY-SA 4.0，署名），放在 Climbio 的公開資料集（Hugging Face 的 `climbio/walls`）。路線的做法和岩點貓一樣，岩館 App 和岩點貓看到的是同一面牆、同一批路線。

Climbio 只放牆面與路線；岩館 App 裡的使用者怎麼對應到路線（帳號、完攀紀錄、留言），完全由你的 App 決定，Climbio 不介入。想自己託管內嵌頁的做法見最後的「授權」。

## 固定三步

1. **用 Studio 精修牆面並發布**：`https://climbio.app/studio/wall/` 或 AI 代理的 `node tools/studio.mjs publish`（流程見 [studio-wall.md](studio-wall.md)）。發布後牆面照片與岩點檔公開在 Hugging Face，得到牆的包 id 與牆 id；發佈金鑰是這面牆的擁有者（換代理的做法見 [gym-agent.md](gym-agent.md)）。
2. **App 放內嵌頁，init 給三個官方網址**（下面「最簡整合」）：看線、定線都是同一個內嵌頁，差別只在 `mode`。
3. **路線和岩點貓一樣**：路線寫進這面公開牆（作者金鑰簽章），路線 id 不變、依修改時間更新；岩館 App 用固定的牆 id 和一把固定的代發金鑰寫入（`node tools/wall-routes.mjs put`，見 [gym-agent.md](gym-agent.md)）。內嵌頁讀到的就是岩點貓看到的那批線。

## 資料來源（內嵌頁只收這幾種網址）

| `init` 欄位 | 內容 | 網址 |
|---|---|---|
| `viewUrl`（必給） | 牆的畫面（岩點外框，Climbio 公開格式 v2） | `https://climbio.app/p/<包 id>/<牆 id>.json`（導向現行版） |
| `photoUrl`（必給） | 畫面指的那張照片，尺寸要等於畫面的 `w × h`，最大 10 MB | `https://huggingface.co/datasets/climbio/walls/resolve/main/walls/<包 id>/v<版本>/<牆 id>.jpg` |
| `layerUrls`（選給） | 路線圖層（疊在牆上，v2），最大 16 MB | 整面牆 `https://climbio.app/w/<牆 id>/routes.json`；單條 `https://climbio.app/r/<牆 id>/<路線 id>/route.json`（岩點貓的路線連結） |

- 只收 https 的 `climbio.app`（路徑要在 `/p/`、`/w/`、`/r/`）和 `huggingface.co/datasets/climbio/walls/`；別的主機、http、帶帳號或埠號、別的路徑都回 `error`，而且三個網址只要有一個不合格就都不讀。
- **不收訊息直接帶的資料**（沒有 `view`、`layers`、`photo` 欄位）。
- 內嵌頁不帶 cookie、不送來源網址，不連任何別的網址（沒有分析、沒有 CDN、沒有字型下載），不記錄，不寫入 Climbio 後端。
- 這些網址都允許跨網域讀取，列出岩館的牆用 `https://climbio.app/w/gym/<岩館>.json`。

## 兩種外層

| 外層 | 怎麼用 | 訊息怎麼傳 |
|---|---|---|
| **網頁**（任何框架） | 放一個 `<iframe>`，大小自己設（`width`、`height`、CSS 都行，畫面跟著框調整）；要用瀏覽器的全螢幕加 `allow="fullscreen"` | `postMessage` |
| **原生 App**（iOS、Android、React Native、Flutter） | 用 WebView 直接開內嵌頁的網址（不放進 iframe） | 內嵌頁往原生橋接送：`window.ReactNativeWebView.postMessage`、`webkit.messageHandlers.climbio.postMessage`（iOS WKWebView）、`ClimbioBridge.postMessage`（Android `addJavascriptInterface`）、`flutter_inappwebview` 的 `climbio` handler；原生端用 `window.climbioReceive(訊息物件或 JSON 字串)` 傳入。橋接傳 JSON |

兩種的訊息內容完全一樣。

## 訊息

所有訊息是 `{ climbio: 'routekit', v: 1, type, … }`，只認 `routekit` 與 `v: 1`。內容欄位不要叫 `type`（會跟外框撞名）。型別以 [messages.d.ts](../embed/routekit/v1/messages.d.ts) 為準。

| 方向 | `type` | 說明 |
|---|---|---|
| 內嵌頁 → 外層 | `ready` | 載入完成，只送一次 |
| | `change { layer, routeId }` | 定線改了：v2 圖層，只有這條路線 |
| | `done { layer, routeId }` | 定線完成（右上的勾） |
| | `cancel` | 定線取消（左上的叉），路線回到打開時的樣子 |
| | `route { routeId }` | 看線：使用者按下面的上一條、下一條換了路線 |
| | `limit { max }` | 點下去會超過起攀上限（內嵌頁沒有改資料）：外層可以顯示自己的提示 |
| | `fullscreen { on }` | 進（出）全螢幕，內嵌頁自己做不到時：請外層把 iframe／WebView 放大成整個畫面（或縮回），再用 `setFullscreen` 回報 |
| | `error { message }` | 網址不合格、讀不到、資料不合格、照片太大或尺寸不對 |
| 外層 → 內嵌頁 | `init { viewUrl, photoUrl, layerUrls?, routeId?, layerId?, viewHref?, options? }` | 第一個訊息 |
| | `setRoute { routeId? }`、`setType { holdType }`、`setOptions`、`setFullscreen { on }` | 之後的更新 |

`routeId`：看線要看哪一條（沒給就是圖層的第一條）；定線要改哪一條（沒給＝新路線）。`layerId`、`viewHref`：`change` 輸出圖層的 `id` 與畫面路徑（沒給就沿用圖層的 id、`viewUrl`）。

### 事件順序與來源檢查

1. **iframe：先註冊 `message` 監聽，再放 `<iframe>`**：`ready` 只送一次，監聽太晚會漏掉。
2. 收到 `ready` 後送 `init`。iframe：第一個 `init` 的 `event.origin` 會被內嵌頁記下，之後只收發這個來源（你的頁面導向別的網站後，不會有人收到你的資料）；只處理 `event.source === iframe.contentWindow` 的訊息。原生 App：直接用橋接。
3. 內嵌頁收到資料先用 `ClimbioFormat.validate` 驗證；不合格回 `error`，內嵌頁不會當掉，等下一個 `init`。

## 行為跟岩點貓一樣，要改只能用選項

內嵌頁和岩點貓的定線、看線**用同一份規則**（RouteKit 的 `geometry.js`、`editor.js`、`labels.js`、`viewer.js`，兩邊都呼叫，不各寫一份），所以預設行為一樣：
- 點岩點加進路線、類型一樣再點就拿掉、剛加進來 0.4 秒內再點不算拿掉；起攀加滿（預設 2 個）就自動切到手點（類型列的色塊跟著滑過去）、起攀滿了還選起攀去點已在路線上的岩點不改並送 `limit`。
- 定線還沒選點是原本的照片、選了第一個點才調暗；看線的底預設黑白、定線預設暗彩。
- 點到好幾顆重疊的地方（全螢幕、可縮放時）自動放大那一塊，候選換回原本的顏色、各畫一個顏色的框和圓點，點哪顆選哪顆，點候選以外取消並飛回原本的位置。
- 「顯示所有岩點」鈕（熱圖）：每顆畫外框，其他路線用過的照次數畫成粉紅到洋紅、越多越粗；其他路線來自 `layerUrls` 的圖層。
- 順序模式：每次點選追加一手；長按有編號的岩點，選「在第 n 手之後插入」或「刪掉第 n 手」；順序列顯示共幾手、插入中、結束插入；復原一路收回；已在順序模式再按一次「順序」可以清除整條。
- 長按腳點切換「不限腳」：路線上有腳點時要確認才清掉，開了不能再選腳點。
- 小畫面只是預覽，點一下進全螢幕；全螢幕才有工具、縮放平移和定線。

### 所有可設的參數（一覽，沒列的就是不開放）

選項用三個地方設，後面的蓋掉前面的：**網址參數**（初值，內嵌頁網址的 `?`）→ `init` 的 `options` → 之後的 `setOptions`（隨時換）。預設值就是岩點貓的行為。不合格的值（上限不是非負整數、顏色不是 `#RRGGBB`、字不是 1～2 個字）當作沒給。

| 選項 | 網址參數 | 預設 | 用途 |
|---|---|---|---|
| — | `mode=view｜edit` | `view` | 看線或定線（只能在網址設） |
| — | `type=s｜h｜t｜f｜n` | `s` | 定線一開始選的類型，之後用 `setType`（只能在網址設） |
| — | `tap=fullscreen｜edit` | `fullscreen` | 小畫面點一下進全螢幕，或框夠大直接在原地互動（只能在網址設） |
| `maxStart` | `maxStart=4` | 2（岩點貓） | 起攀點數上限；有的岩館規定 4。滿了新點改成手點、已在路線上的點不能改成起攀（送 `limit`） |
| `foot` | `foot=0` | 顯示 | 定線有沒有「腳點」（含長按的「不限腳」） |
| `order` | `order=0` | 顯示 | 定線有沒有「順序」 |
| `heat` | `heat=0` | 顯示 | 定線有沒有「顯示所有岩點」鈕（熱圖） |
| `nav` | `nav=0` | 顯示 | 看線：圖層裡不只一條路線時，下面有沒有「上一條、下一條」 |
| `draw` | `draw=0` | 開（只有觸控） | 長按沒有岩點的地方「自由畫」岩點外框（`route.shapes`，不改牆的岩點檔） |
| `base` | `base=gray｜dim` | 定線 `dim`、看線 `gray` | 底色：黑白或暗彩 |
| `lang` | `lang=en` | `zh`（繁體中文） | 內嵌頁自己的按鈕和選單文字：`zh`、`en` |
| `colors` | `color-s=22c55e`（`s`、`h`、`t`、`f`） | 岩點貓的顏色（起攀綠、手點藍、完攀紅、腳點黃） | 四種類型的顏色，`#RRGGBB` |
| `labels` | `label-s=起`（`s`、`t`） | `S`、`T` | 起攀、完攀膠帶上的字（1～2 個字） |
| `controls` | `controls=0` | 顯示 | `false`：不畫任何按鈕，全由外層用訊息控制，畫面直接可以互動 |

要新增選項，先確認它是各家真的不一樣的規定（像起攀上限），不是某一家的偏好；新增時一起做：網址參數、`init`／`setOptions`、驗證、`messages.d.ts`、這張表、測試（`tests/e2e/embed.spec.mjs`）。操作介面元件（`RouteKit.EditorUI`）自己還有但內嵌頁尚未開放的參數：`zoom`、`fullscreen`、`strings`。

### 版本

網址有版本（`v1/`），訊息有 `v`。之後不相容的改動新增 `v2/`，`v1/` 保留，不會被打壞。

## 最簡整合（網頁）

```html
<script>
  // 三個官方網址：牆的畫面與路線在 climbio.app，照片在 Hugging Face（Studio 發布後得到的包 id、牆 id）
  const data = {
    viewUrl: 'https://climbio.app/p/<包 id>/<牆 id>.json',
    photoUrl: 'https://huggingface.co/datasets/climbio/walls/resolve/main/walls/<包 id>/v<版本>/<牆 id>.jpg',
    layerUrls: ['https://climbio.app/w/<牆 id>/routes.json'],
  };
  // 先註冊 message 監聽，再放 iframe：內嵌頁的 ready 只送一次，監聽太晚會漏掉
  addEventListener('message', (e) => {
    const frame = document.getElementById('rk');
    if (e.source !== frame.contentWindow || e.data?.climbio !== 'routekit') return;
    if (e.data.type === 'ready') frame.contentWindow.postMessage({ climbio: 'routekit', v: 1, type: 'init', ...data, routeId }, '*');   // routeId：看線要看哪一條，定線不給就是新路線
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

## 整合步驟（給 AI：把現有路線頁的路線圖與定線畫面換成內嵌）

目標：現有頁面的版面、帳號、紀錄、資料庫都不動，只把「路線圖」換成看線內嵌、「點照片上的岩點出路線」換成定線內嵌。

1. **牆面**：照上面「固定三步」的第 1 步，用 Studio 精修並發布；沒有岩點外框的牆先用 Studio 偵測。記下包 id、牆 id、照片版本。
2. **路線**：App 的路線用 `{ 岩點 id: 's'｜'h'｜'t' }`（起攀、手點、完攀）記錄。現有資料若是圈點（`x`、`y` 是照片寬高的百分比），用 `RouteKit.fromCircles`（[routekit/README.md](../routekit/README.md)）對到岩點；反過來存回圈點用 `RouteKit.toCircles`。用固定的代發金鑰把路線寫進這面牆（[gym-agent.md](gym-agent.md)），路線 id 固定。
3. **看線**：路線頁把路線圖元件換成 `<iframe src="https://embed.climbio.app/routekit/v1/?mode=view" allow="fullscreen">`，先註冊 `message` 監聽，收到 `ready` 送 `init { viewUrl, photoUrl, layerUrls, routeId }`。每次換路線送 `setRoute { routeId }`。
4. **定線**：同一個 iframe 改 `?mode=edit`（起攀上限預設 2，有的岩館規定 4：加 `&maxStart=4`）。使用者每點一下收到 `change { layer, routeId }`，取 `layer.nodes` 裡路線節點的 `props.holds` 就是目前的路線；按「發布」時才檢查（要有起攀 S 和完攀 T，名稱、難度由外層的表單處理），再用第 2 步的方式寫進這面牆。類型按鈕、暗彩／黑白、全畫面都在內嵌頁裡，外層不用做。
5. **驗證**：換成內嵌後，看線頁的路線與原本一致；定線存出來的路線用看線讀得回來；原生 App 用 WebView 時照上面「兩種外層」改用橋接。

## 授權

內嵌頁是 AGPL-3.0 的程式，由 Climbio 提供，頁面角落有指向原始碼的連結。你的網站或 App 只含 `<iframe>`／WebView 與訊息呼叫，不含 Kit 程式，所以不受 AGPL 要求開放前端原始碼；Climbio 不提供商業授權、不簽 CLA。牆面與路線資料是 CC BY-SA 4.0，顯示時要署名。想自己託管同一份靜態檔（控制可嵌入的網域、固定版本）：下載 `embed/routekit/v1/` 資料夾放進自己的靜態主機（建議獨立子網域），保留 `kit/LICENSE`、`kit/NOTICE` 與原始碼連結，改了程式要公開修改；內嵌頁只收官方資料網址這一點不會因為自己託管而改變。

## 維護

- `embed/routekit/v1/kit/` 是產物：把各 Kit 的檔案與 `embed/shared/embed.js` 複製進去，讓整個資料夾自給自足、全用相對路徑。改了 Kit 或共用程式跑 `node tools/build-embed.mjs`；`node tools/build-embed.mjs --check` 檢查有沒有跟上（`tools/embed.test.mjs` 會擋）。
- 共用程式（訊息外框、來源檢查、原生橋接、官方網址檢查、全畫面）在 `embed/shared/embed.js`；縮放平移是 Kit 的 `routekit/viewport.js`，內嵌頁只寫自己的資料與按鈕。
- 測試：`node --test tools/embed.test.mjs`（外框、來源檢查、原生橋接、官方網址檢查、全畫面），搭配內部 e2e 案例 `tests/e2e/embed.spec.mjs` 驗證跨來源嵌入（官方主機用 `context.route` 攔下回測試資料）。
- 部署：靜態主機是 Firebase Hosting 的第二個站台 `climbio-embed`（`https://climbio-embed.web.app`，設定 `firebase-embed.json`，只有這個站台放行 `frame-ancestors *`，主站維持 `'self'`）。改了內嵌頁或 `kit/` 後：`npx firebase-tools deploy --only hosting --config firebase-embed.json --project web`，再用 `curl -I` 確認標頭、從另一個來源嵌入確認 `ready`。
- 網域：`embed.climbio.app` 已啟用（Cloudflare 的 `embed` CNAME 指到 `climbio-embed.web.app`，要保持 DNS only、不開代理，Firebase 才能自己驗證與發憑證）。
