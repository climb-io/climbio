# 內嵌：把 Climbio 的看線、定線畫面放進你的網站或 App

給想用岩點貓的看線、定線畫面、但不想公開自己前端原始碼的岩館網站或 App（網頁或原生）。內嵌頁是靜態頁，**資料只有一種來源：Climbio 官方發佈的網址**。你的 App 只給三個網址，內嵌頁自己讀；定線的結果用訊息傳回你的 App。不用註冊、不用金鑰、不用安裝。設計理由見 [proposals/kit-embed.md](proposals/kit-embed.md)。

## 適合誰

適合願意和岩友一起分享路線的岩館：牆面與路線公開（CC BY-SA 4.0，署名），放在 Climbio 的公開資料集（Hugging Face 的 `climbio/walls`）。路線的做法和岩點貓一樣，岩館 App 和岩點貓看到的是同一面牆、同一批路線。

Climbio 只放牆面與路線；岩館 App 裡的使用者怎麼對應到路線（帳號、完攀紀錄、留言），完全由你的 App 決定，Climbio 不介入。想自己託管內嵌頁的做法見最後的「授權」。

## 固定三步

1. **用 Studio 精修牆面並發布**：`https://climbio.app/studio/wall/` 或 AI 代理的 `node tools/studio.mjs publish`（流程見 [studio-wall.md](studio-wall.md)）。發布後牆面照片與岩點檔公開在 Hugging Face，得到牆的包 id 與牆 id；牆沒有擁有者、不用金鑰，任何人都能發佈新版本；要固定在某一版，`init` 的網址就用那一版的網址（`…/walls/<包 id>/v<版本>/…`），岩點貓現行版由程式自動判定（見 [studio-wall.md](studio-wall.md)）。
2. **App 放內嵌頁，init 給三個官方網址**（下面「最簡整合」）：看線、定線都是同一個內嵌頁，差別只在 `mode`。
3. **路線直接提交，身分是你的網站**：使用者在內嵌頁定好線，App 送 `submit`，內嵌頁就把路線寫進這面公開牆（岩點貓看得到），不需要任何金鑰。路線記在 iframe 所在的網站來源名下（例如 `https://gym.example.com`）：同一個岩館網站上所有人提交的路線都屬於這個網站，這個網站可以更新（同一個 `routeId` 再 `submit`）、刪除（`remove`）自己名下的全部，別的來源改不了。內嵌頁讀到的就是岩點貓看到的那批線。

   提交成功回 `submitted { routeId, routeUrl, layer }`，App 存下 `routeId` 對應自己的使用者；這個對應 Climbio 不管。要大量匯入舊路線，用維護者的 `node tools/wall-routes.mjs put`（見 [gym-agent.md](gym-agent.md)）。

   **有後台的岩館可以自己帶金鑰：** 自己產生一把岩館金鑰（`node tools/wall-routes.mjs keygen <檔案>`，格式 `{ kid, pub, priv }`，備份、不進版控），在 `init` 帶 `key`；`submit`、`remove` 就改用這把金鑰簽章，路線記在 `k:<kid>` 名下，比網站來源難冒充。沒帶 `key` 就用網站來源。`key` 會出現在你的網頁裡（使用者打開開發者工具看得到），所以它防的是「隨便填一個網址」，不是「拿到網頁的人」；原生 App 的 WebView 沒有網站來源，要提交就得帶 `key`。

   **限制：** 身分是網站來源，由瀏覽器提供（外層送 `init` 的 `event.origin`），別的網站冒充不了；但不是密碼學的強身分，腳本直接呼叫 API 的人可以自己填來源。所以提交要過 App Check，每個來源一天有寫入上限，路線內容有驗證，濫用由維護者處理。原生 App 的 WebView 沒有網站來源，要提交得帶 `key`。

## 牆面的處理與之後的更新

整合只是其中一步。對沒有牆面資料的岩館，順序是：

1. **先處理牆面**：牆面照片用 Studio 偵測岩點、精修、檢查，發布到公開資料集（網頁版 `https://climbio.app/studio/wall/`，手機也能做；AI 代理用 `node tools/studio.mjs start gym <資料夾> <照片…>`，照它印的下一步走，流程規則見 [studio-wall.md](studio-wall.md) 的「代理做牆面」）。
2. **再整合 App**：上面的三步。
3. **之後的牆面更新**：
   - 岩點或外框調整：在 Studio 用同一面牆重新發布，成為新版本；刪掉、合併掉的岩點留給舊路線用，舊路線照舊。照片還是同一張時，程式自動判定成為岩點貓看到的現行版（規則見 [studio-wall.md](studio-wall.md)）。
   - 換了照片（重拍）：當成新的一面牆，用新的牆 id；App 的 `init` 換成新牆的網址，舊牆的路線不會自動搬過去。
   - 想固定在某一版：`init` 的網址用那一版的網址（`…/walls/<包 id>/v<版本>/…`），要升級再改網址。

## 牆發佈內嵌頁（放在岩館 App 的後台：上傳一張牆面照片就得到一面牆）

工作人員像更新原本的照片一樣，在**自己的後台**上傳牆面照片，不必跑到 Studio：

```html
<iframe id="wp" src="https://embed.climbio.app/wallpublish/v1/?lang=zh-Hant" style="width:100%;height:560px;border:0" title="牆面照片"></iframe>
```

- 流程：選一張照片（正對牆面、整面入鏡、光線均勻）→ 在這個瀏覽器裡偵測岩點（跟岩點貓新增牆面同一套，第一次要下載約 12 MB 的偵測模型，之後快取）→ 看預覽 → 填牆名稱 → 按發佈。沒有額外的同意步驟；授權就是本文件開頭說的：牆面與路線公開在開放資料集，CC BY-SA 4.0，署名。
- 訊息：外層先註冊 `message` 監聽，收到 `ready` 回 `init { lang?, gym?, name? }`（`gym` 有給就不顯示岩館欄位）；發佈成功收到 `published { walls: [{ id, wallId, name, version, current, base }] }`，失敗或檔案不合格收到 `error { message, status? }`。型別以 [wallpublish/v1/messages.d.ts](../embed/wallpublish/v1/messages.d.ts) 為準。
- **`wallId` 就是路線內嵌頁 `init` 的 `wallId`**：App 把它存在原本放牆面照片的地方。換新照片 = 新的一面牆，換新的 `wallId`，舊牆和它的路線不動。
- **鎖定版本**：人人都能發新版本，要固定在某一版，路線內嵌頁的 `init` 改給那一版的網址（`…/walls/<包 id>/v<版本>/…`，`published` 的 `base` 就是這個資料夾的網址）；別人再發新版本不影響。不需要認領、來源綁定或金鑰。
- **精修（選用）**：想要逐顆更準，岩館的 AI Agent 照 Studio 的流程精修（[gym-onboarding.md](gym-onboarding.md)），用岩館金鑰簽章直接發佈（`node tools/wall-batch.mjs publish <工作資料夾> --gym "<岩館>" --key <金鑰檔>`），不經過這個內嵌頁；也可以 `zip` 打包成 `walls.zip` 丟進這個框（照片或 ZIP 都收）。
- 不認人：不記擁有者、不綁網站，檢查與額度跟 Studio 發佈相同（內容驗證、每個來源每天最多 30 次）。身分是 Climbio 的網頁（App Check），所以要在 `embed.climbio.app` 上用，自己託管的內嵌頁拿不到權杖。

## 資料來源（內嵌頁只收這幾種網址）

| `init` 欄位 | 內容 | 網址 |
|---|---|---|
| `wallId`（最簡單） | `<包 id>/<牆 id>`：只給這個，下面的畫面、照片、整面牆路線圖層的網址由內嵌頁補（畫面和照片直接讀資料集：讀 `walls/<包 id>/current/<牆 id>.json` 與 `.jpg`（發佈時放的現行版），所以換了現行版 App 不用改，也不呼叫 Climbio 的雲端函式；牆還沒有路線就沒有圖層）。下面三列是要自己指定時才用，明確給的優先 | `https://climbio.app/p/<包 id>/<牆 id>.json` 等 |
| `viewUrl` | 牆的畫面（岩點外框，Climbio 公開格式 v2） | `https://huggingface.co/datasets/climbio/walls/resolve/main/walls/<包 id>/current/<牆 id>.json`（現行版；`climbio.app/p/…` 不再導向公開牆） |
| `photoUrl` | 畫面指的那張照片，尺寸要等於畫面的 `w × h`，最大 10 MB | `https://huggingface.co/datasets/climbio/walls/resolve/main/walls/<包 id>/v<版本>/<牆 id>.jpg` |
| `layerUrls`（選給） | 路線圖層（疊在牆上，v2），最大 16 MB | 整面牆 `https://climbio.app/w/<牆 id>/routes.json`；單條 `https://climbio.app/r/<牆 id>/<路線 id>/route.json`（岩點貓的路線連結） |

- 只收 https 的 `climbio.app`（路徑要在 `/p/`、`/w/`、`/r/`）和 `huggingface.co/datasets/climbio/walls/`；別的主機、http、帶帳號或埠號、別的路徑都回 `error`，而且三個網址只要有一個不合格就都不讀。
- **不收訊息直接帶的資料**（沒有 `view`、`layers`、`photo` 欄位）。
- 內嵌頁不帶 cookie；讀資料的請求不送來源網址（每個請求都設 `referrerPolicy: 'no-referrer'`）；頁面本身的標頭是 `Referrer-Policy: strict-origin`，只在提交時 Google 的 App Check 要驗網站網址，才送出內嵌站自己的來源 `https://embed.climbio.app/`（不是嵌入它的岩館網頁網址）；平常不連任何別的網址（沒有分析、沒有 CDN、沒有字型下載），不記錄。只有你送 `submit` 或 `remove` 時，才會載入 Google 的 App Check 腳本（`gstatic.com`、reCAPTCHA）並連到 Climbio 的雲端函式 `walls`，把路線寫進公開牆；看線、只定線不提交的人不會對外發任何請求。
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
| | `submitted { routeId, routeUrl, layer }` | `submit` 成功：路線已公開在這面牆；`routeUrl` 是這條路線的公開網址 |
| | `removed { results }` | `remove` 的結果：每個路線 id 是 `ok`（已刪）或 `taken`（不是這個網站的） |
| | `limit { max }` | 點下去會超過起攀上限（內嵌頁沒有改資料）：外層可以顯示自己的提示 |
| | `fullscreen { on }` | 進（出）全螢幕，內嵌頁自己做不到時：請外層把 iframe／WebView 放大成整個畫面（或縮回），再用 `setFullscreen` 回報 |
| | `error { message }` | 網址不合格、讀不到、資料不合格、照片太大或尺寸不對 |
| 外層 → 內嵌頁 | `init { wallId（或 viewUrl、photoUrl）, layerUrls?, routeId?, layerId?, viewHref?, options?, key? }` | 第一個訊息；`key` 是選用的岩館金鑰（見上面第 3 步） |
| | `setRoute { routeId? }`、`setType { holdType }`、`setOptions`、`setFullscreen { on }` | 之後的更新 |
| | `submit { name?, grade?, author? }` | 定線：把目前這條路線寫進公開牆（名稱、暱稱最多 20 字，路線要有起攀 s 和完攀 t），回 `submitted` 或 `error` |
| | `remove { routeIds }` | 刪這個網站名下的路線（最多 100 個），回 `removed` |

`routeId`：看線要看哪一條（沒給就是圖層的第一條）；定線要改哪一條（沒給＝新路線）。`layerId`、`viewHref`：`change` 輸出圖層的 `id` 與畫面路徑（沒給就沿用圖層的 id、`viewUrl`）。

### 事件順序與來源檢查

1. **iframe：先註冊 `message` 監聽，再放 `<iframe>`**：`ready` 只送一次，監聽太晚會漏掉。
2. 收到 `ready` 後送 `init`。iframe：第一個 `init` 的 `event.origin` 會被內嵌頁記下，之後只收發這個來源（你的頁面導向別的網站後，不會有人收到你的資料）；只處理 `event.source === iframe.contentWindow` 的訊息。原生 App：直接用橋接。
3. 內嵌頁收到資料先用 `ClimbioFormat.validate` 驗證；不合格回 `error`，內嵌頁不會當掉，等下一個 `init`。

## 行為跟岩點貓一樣，要改只能用選項

內嵌頁和岩點貓的定線、看線**用同一份規則**（RouteKit 的 `geometry.js`、`editor.js`、`labels.js`、`viewer.js`，兩邊都呼叫，不各寫一份），所以預設行為一樣：
- 點岩點加進路線、類型一樣再點就拿掉、剛加進來 0.4 秒內再點不算拿掉；起攀加滿（預設 2 個）就自動切到手點（類型列的色塊跟著滑過去）、起攀滿了還選起攀去點已在路線上的岩點不改並送 `limit`。
- 定線還沒選點是原本的照片、選了第一個點才調暗；看線的底預設黑白、定線預設暗彩。
- 點到好幾顆重疊的地方（全螢幕、可縮放時）自動放大那一塊，候選各畫同色的框和圓點，原先點到的候選多一圈提示。Volume 上其他小岩點也會以細框標出，可以直接點。選好或點空白取消都會回到原本的位置。
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
| `baseToggle` | `baseToggle=1` | 不顯示（固定暗彩） | 顯示暗彩／黑白切換鈕；沒開時畫面固定暗彩 |
| `grade` | `grade=1` | 不顯示 | 定線上方的難度轉盤（跟岩點貓同一個元件）；選的難度寫進路線，`submit` 沒帶 `grade` 就用它 |
| `gradeSys` | `gradeSys=font` | `v` | 轉盤用的難度系統：`v`（VB、V0–V12）、`font`（Fontainebleau）、`dan`（段級） |
| `foot` | `foot=0` | 顯示 | 定線有沒有「腳點」（含長按的「不限腳」） |
| `order` | `order=0` | 顯示 | 定線有沒有「順序」 |
| `heat` | `heat=0` | 顯示 | 定線有沒有「顯示所有岩點」鈕（熱圖） |
| `draw` | `draw=0` | 開（只有觸控） | 長按沒有岩點的地方「自由畫」岩點外框（`route.shapes`，不改牆的岩點檔） |
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
  // 只要 Studio 發布後得到的包 id、牆 id；畫面、照片、路線的官方網址由內嵌頁補
  const data = { wallId: '<包 id>/<牆 id>' };
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
3. **看線**：路線頁把路線圖元件換成 `<iframe src="https://embed.climbio.app/routekit/v1/?mode=view" allow="fullscreen">`，先註冊 `message` 監聽，收到 `ready` 送 `init { wallId, routeId }`。每次換路線送 `setRoute { routeId }`。
4. **定線**：同一個 iframe 改 `?mode=edit`（起攀上限預設 2，有的岩館規定 4：加 `&maxStart=4`）。使用者每點一下收到 `change { layer, routeId }`，取 `layer.nodes` 裡路線節點的 `props.holds` 就是目前的路線；按「發布」時才檢查（要有起攀 S 和完攀 T，名稱、難度由外層的表單處理），再用第 2 步的方式寫進這面牆。類型按鈕、暗彩／黑白、全畫面都在內嵌頁裡，外層不用做。
5. **驗證**：換成內嵌後，看線頁的路線與原本一致；定線存出來的路線用看線讀得回來；原生 App 用 WebView 時照上面「兩種外層」改用橋接。

## 授權

內嵌頁是 AGPL-3.0 的程式，由 Climbio 提供，畫面上不放授權標示或原始碼連結（原始碼在公開 repo）。你的網站或 App 只含 `<iframe>`／WebView 與訊息呼叫，不含 Kit 程式，所以不受 AGPL 要求開放前端原始碼；Climbio 不提供商業授權、不簽 CLA。牆面與路線資料是 CC BY-SA 4.0，顯示時要署名。想自己託管同一份靜態檔（控制可嵌入的網域、固定版本）：下載 `embed/routekit/v1/` 資料夾放進自己的靜態主機（建議獨立子網域），保留 `kit/LICENSE`、`kit/NOTICE`，改了程式要依 AGPL-3.0 第 13 條提供原始碼；內嵌頁只收官方資料網址這一點不會因為自己託管而改變。

## 維護

- `embed/routekit/v1/kit/` 是產物：把各 Kit 的檔案與 `embed/shared/embed.js` 複製進去，讓整個資料夾自給自足、全用相對路徑。改了 Kit 或共用程式跑 `node tools/build-embed.mjs`；`node tools/build-embed.mjs --check` 檢查有沒有跟上（`tools/embed.test.mjs` 會擋）。
- 共用程式（訊息外框、來源檢查、原生橋接、官方網址檢查、全畫面）在 `embed/shared/embed.js`；縮放平移是 Kit 的 `routekit/viewport.js`，內嵌頁只寫自己的資料與按鈕。
- 測試：`node --test tools/embed.test.mjs`（外框、來源檢查、原生橋接、官方網址檢查、全畫面），搭配內部 e2e 案例 `tests/e2e/embed.spec.mjs` 驗證跨來源嵌入（官方主機用 `context.route` 攔下回測試資料）。
- 部署：靜態主機是 Firebase Hosting 的第二個站台 `climbio-embed`（`https://climbio-embed.web.app`，設定 `firebase-embed.json`，只有這個站台放行 `frame-ancestors *`，主站維持 `'self'`）。改了內嵌頁或 `kit/` 後：`npx firebase-tools deploy --only hosting --config firebase-embed.json --project web`，再用 `curl -I` 確認標頭、從另一個來源嵌入確認 `ready`。
- 網域：`embed.climbio.app` 已啟用（Cloudflare 的 `embed` CNAME 指到 `climbio-embed.web.app`，要保持 DNS only、不開代理，Firebase 才能自己驗證與發憑證）。
