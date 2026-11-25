# Studio 工作紀錄與命令列（給 AI 代理）

AI 代理把工作做到只剩要人判斷的地方，人只答題。進度、題目、判斷、交接筆記都寫在專案資料夾的 `.studio/work/`，**換一個代理先跑 `status` 就能接著做**，不用讀之前的對話。

**預設全部在本機**：使用者在原本用的 AI App（Claude、ChatGPT…）跟代理對話就能做完，代理把題目和證據拿到對話裡問，使用者在對話裡答（見下「在對話裡答題」），不用另外打開 Studio 的收件匣，也不用架任何服務。要跨機器（別台電腦、雲端代理、iPad 上答題）的人才接同步服務，做法跟維護者一樣（見下「同步」）。設計見 [proposals/studio-v4.md](proposals/studio-v4.md)；目前已接上路線書轉換、岩館牆面分享包與 3D 牆工作資料夾；3D 牆每顆要發佈的岩點都要 AI 看過；天然岩場的其他 AI 判斷尚未完整接通。

## Agent 支援範圍與限制

- 任何可執行 Node.js 命令列的 AI Agent 都可使用 `tools/studio.mjs`，不綁定 Claude、Codex 或 Gemini；`AGENTS.md` 是共用規範，`CLAUDE.md` 引用它。
- 路線書：`convert`、`apply`、`status`、`ask`、`answer`、`push`、`pull`，岩場成品由 `tools/guidebook.mjs publish` 發佈。
- 岩館牆面：`tools/wall.mjs` 檢視與修改岩點；`studio.mjs` 產生重複岩點題目、同步交接及發布。
- 3D 牆：`fetch3d`、`status`、`push`、`pull`、`publish`；大檔分段傳輸。`look3d`、`review3d` 讓 AI 逐顆看過要發佈的每一顆岩點（見下表），AI 自己判斷到底；發佈前人在 Studio 試用、回報問題（`resolve3d` 記代理怎麼處理），人只答試用與發佈（照片明顯不夠時另問要不要補拍）。
- 多 Agent 同步採版本檢查：過期 `push` 會拒絕，`pull` 不覆蓋雙方都修改過的本機檔案；衝突仍需人工或 Agent 解決，不是自動合併任意專案檔。
- 目前沒有 Studio 的 MCP server：代理直接跑命令列。
- `doctor` 可檢查環境，但 Claude Code／Codex Cloud 的實際跨環境驗收仍待進行；發布服務的程式碼存在不代表正式端點已部署。

## 牆面岩點檔：AI 檢查是必走的一步

代理替牆面產生或精修岩點檔，一律用 `tools/wall-batch.mjs`（一面或多面都一樣）：偵測 → SAM2 → 匯出牆的分享包 → **AI 檢查**（照 `next` 印的判斷準則看圖：重複、SAM2、抽查、總覽、Volume、Volume 上的岩點，看不準和要刪的放大再看）→ **完成閘門 `verify`**（通過才算做完，同時寫出研究記錄）；**AI 檢查不能跳過**，不中途問人。完整步驟、判斷準則與交付時要回報的項目見 [studio-wall.md](studio-wall.md) 的「代理做牆面：岩點檔的必走流程」。

## 新任務的入口：`start`

入口頁「交給 AI」的四句話（岩館牆面、岩場照片、路線書、3D 牆）都從同一個指令開始：

```bash
node tools/studio.mjs start <gym|crag|book|3d> <資料夾> [照片或路線書…]
```

它看資料夾做到哪，印出下一步要跑的指令、完成標準與回報格式（`tools/studio-start.mjs`）；已經有進度的資料夾直接接到 `wall-batch.mjs next` 或 `status`。做不到的任務會印「卡在：…」，代理照實告訴使用者，不編造結果：`crag`（老岩場資料轉成手機上好讀的紅點貓格式）有路線書的檔案、網頁就走轉換，只有照片目前不支援；`3d` 要先有 3D 重建流程輸出的 `wall.json`。

## 接手

```bash
export CLIMBIO_AGENT=agent:<你的名稱>        # 每筆紀錄記下是誰做的
node tools/studio.mjs status <專案>          # 做到哪、還剩幾題、下一步、最後一段交接筆記
node tools/studio.mjs ask <專案> [--json]    # 還沒答的題目
```

照 `status` 的「下一步」做；做完一段用 `note` 留交接筆記（做了什麼、卡在哪、下一步），再結束。

## 在對話裡答題（預設）

人只在發佈時確認。等人答的題只有這幾種：要不要發佈、岩場位置（原始資料沒有就只能由人給）、代理判斷原始資料明顯不夠的（答 `retake`：照片糊、缺頁，要不要補拍或補資料）、3D 牆發佈前的試用（`trial3d`：人在 Studio 試用這一版，見下表的 3D 牆）。代理在對話裡問使用者：

1. `node tools/studio.mjs ask <專案> --human` 列出等人答的題：題目、可以怎麼答、證據照片的路徑（代理打開照片放進對話）、AI 說哪裡的資料不夠。
2. 代理把題目和證據原樣拿給使用者看，一次一題或一次列完；「要不要公開發佈」要寫清楚發佈就是公開、收不回，以及發的是哪一版的什麼內容。
3. 使用者在對話裡親口答了，代理才記下：`node tools/studio.mjs answer <專案> <題目 id> <選項> --by human:<使用者名稱> --said "<他的原話>"`。原話跟著判斷存在 `decisions.jsonl` 的 `said`。
4. 使用者沒答、答得不清楚、或答的跟題目對不上，就再問，不替他選；代理自己判斷不了的題不能用 `human:` 記。

命令列擋兩件事：代理用 `agent:` 答只能由人答的題會被擋下；不是在終端機自己打的 `human:` 判斷（沒有 TTY，例如代理執行）沒附 `--said` 不收。核准綁在這一版的內容上（題目 id 帶成品的指紋），內容改了就要重新問。

## 指令（`tools/studio.mjs`）

| 指令 | 做什麼 |
|---|---|
| `status <專案> [--json]` | 重算題目、寫 `state.json`，印出進度與下一步 |
| `ask <專案> [--json] [--all] [--human]` | 還沒答的題目（`--all` 連答過的；`--human` 只列等人答的，附證據照片路徑，給代理拿到對話裡問） |
| `answer <專案> <題目 id> <accept\|reject\|edit\|ok> [--patch p.json] [--note 文字] [--by human:<名稱> --said "<原話>"]` | 答一題；`--patch` 先套用修正（格式同 `tools/guidebook.mjs apply`），`accept` 套用題目的建議；代理替人記對話裡的判斷要加 `--by human:` 和 `--said` |
| `note <專案> <文字>` | 追加交接筆記 |
| `convert <專案> read <路線書…>` | 路線書 → `.studio/source/` 的大綱與圖（`tools/guidebook.mjs read`） |
| `convert <專案> build [原圖…] [--position 緯度,經度]` | 大綱 → 專案資料夾裡的公開格式 v2 包（`tools/guidebook.mjs build`） |
| `apply <專案> <patch.json>` | 局部修正包，其他 id 不變 |
| `link <專案> <服務網址>` | 接上同步服務（要跨機器交接才需要） |
| `push <專案>` | 改過的檔案和工作紀錄推上去（先合併服務上別台記下的判斷） |
| `pull <專案> [--from <服務網址>#<專案 id>]` | 拉下判斷、筆記、檔案，套用別台記下的人的修正（`fix` 帶的 `patch`，記一筆 `edit`）；空資料夾加 `--from` 就是接手 |
| `projects [<服務網址>]` | 服務上的專案與接手指令 |
| `publish <牆的分享包>` | 牆的分享包（`index.json` 的 `type` 是 `walls`）放進開放資料集，是同一個包的新版本；帶同步金鑰代替 App Check。**要有人核准這一版**：成品建好、其他題都答完，會出一題「要不要公開發佈」（`kind` 是 `publish`，只能由人在對話裡答；題目 id 帶著成品內容的指紋，內容改了就是新的一題、要重新核准），人答「發佈」（ok）才放行。
| `approved <專案>` | 這一版有沒有人核准發佈（給 `tools/guidebook.mjs publish` 查）：印出核准的判斷，有的話結束碼 0 |
| （牆的分享包當專案） | `status`、`ask` 也收牆的分享包：可能是同一顆的岩點（跟 Studio Wall 編輯器同一套判斷）出題，證據是照片和兩顆的範圍（`evidence[].box`、`size`，代理放大到那一塊給人看）；代理用 `tools/wall.mjs` 或 `apply` 修，答 ok 是不是同一顆 |發佈服務網址可放 `CLIMBIO_PUBLISH_URL`。岩場用 `node tools/guidebook.mjs publish`（無畫面瀏覽器開 Studio、帶同步金鑰，見 [guidebook-convert-format.md](guidebook-convert-format.md) 的「命令列」）；3D 牆見下一列 |
| （3D 牆的工作資料夾當專案） | `wall.json` 是 `climbio-3d-wall/1` 的資料夾（3D 重建流程的輸出）：`status`、`push`、`pull` 照常；**發佈的標準是每顆岩點都檢查過，跟人在 Studio 逐顆修同一個結果**（不是某個數字過門檻）。**AI 檢查分三階段，前一階段過了才出下一題**（前兩階段綁在模型、面、裁切平面、隱藏的面上，換了才重看）：1 模型——`check3d <資料夾> model` 出整面牆正面、低處、左右斜看與牆腳、牆頂、兩端的近看，看模型完整、上下左右的切口是直線（抱石墊切成直線）、切口離最外側的岩點留一段牆、牆腳沒有糊掉或不自然的貼圖，沒問題 `answer … ok`；2 鏡頭動線——`check3d <資料夾> path` 出岩點貓的沿牆鏡頭（直的手機畫面）由右走到左、最遠和中間兩個距離、平視和看下半部各一排，像人站在牆前，每面牆（內角兩側、cave）的下半部都看得清楚、沒有對著牆外，最遠點不到的岩點要 0；3 逐顆岩點（下面的 `look3d`）。`look3d <資料夾>`：無畫面瀏覽器開 Studio 的 3D 牆（`studio/wall3d/app.js` 的 `shots`），還沒看過的岩點一顆一張（左原樣、右是同一畫面加上這顆範圍的邊線，從這顆的正面看；轉角、側牆、Volume 下被別的牆面擋住時改試它自己的法線、牆的正面、再靠近一點，取第一個看得到這顆的），每 12 張拼成總圖（`.studio/work/look/`，本機的工作檔不同步）。代理逐張看完（判斷準則跟岩館牆共用 `tools/hold-rubric.mjs`，`look3d` 印出來；邊線要貼著岩點邊緣），判斷寫成 JSON 給 `review3d <資料夾> <判斷.json>`：keep 是岩點、邊線貼齊；off 不是岩點，一定要寫 `why`（貼紙、膠帶、商標、陰影、螺絲孔、反光、牆板、碎片、重複，模型上看不到的寫「看不到」），說不出是哪一種就 keep → `wall.json` 的 `holds[].off`，理由記在 `review3d.json`；reshape 範圍不對 → 附右半張的多邊形，照那張圖的鏡頭記成修點（`edits` 的 `m3`，跟人在 Studio 修外框同一種資料），之後要再看一次；看不準也要自己選最可能的那個，不交給人；只有那一區照片明顯不夠、糊到認不出才 retake（附哪裡不夠），合併成一題只能由人答的「要不要補拍」（`retake`，證據是那幾顆的圖，放 `.studio/evidence/`）。紀錄在 `review3d.json`（`studio/wall3d/review.js`）：每顆記判斷當時的狀態，之後又改了（人在 Studio 改的也算）就要重看。還有沒看過的，`status` 出一題給代理（`look3d`），看完消失。`look3d --glow` 看的是最終結果：烘好的成品、沿牆鏡頭走到框住這顆的位置（看線同一個 `frameTo`），左邊原樣、右邊點選後（底圖暗彩、這顆原色加光暈），從整個畫面裁出這顆附近放大；光暈要剛好包住整顆、外圈平順，溢出、缺一塊、亮到不是岩點的都不過。`--wide` 看 Volume 的全形：鏡頭退遠一點、裁大一點，只亮到一部分的 Volume 也看得到整個外形；Volume 的邊大多是直線，重描時照直線描到角（三角形就三個點），同一顆 Volume 被拆成好幾顆的碎塊 `off`（`off` 連修過的外框一起拿掉，不會從 Volume 搶走面）。修過外框的岩點烘焙時網格照描的線切開（`wall3dkit/bake.js` 的 `cutOutlines`），光暈和點選的範圍就是描的線，不會變成貼圖像素或三角面的鋸齒。人回報「有點沒辦法點」（Volume 上的小點、漏掉的岩點）：在回報時的畫面（`fb-<回報 id>.jpg`，Studio 的標準鏡頭）描整顆，`review3d` 寫 `{ "v": "add", "fb": "<回報 id>", "poly": [[x, y]…] }`（像素 0～512），補成新的岩點，之後照樣 `look3d` 看光暈。AI 在光暈圖上看到沒偵測到的岩點、Volume（調暗時跟牆一樣灰），寫 `{ "v": "add", "n": 圖的編號, "poly": [[x, y]…] }`，像素跟 reshape 一樣是右半張的。一顆 Volume 被拆成好幾顆、修點收走大部分的面之後，剩下的碎塊沒有光暈，要 `off`。範圍邊線看不出光暈的問題，發佈前要用 `--glow` 全部看過（`--all` 重看已看過的，`--limit N` 試跑）。都看過（有補拍題的話人也答了）先請人試用（`studio/wall3d/feedback.js`，紀錄在 `feedback3d.json`，跟著同步）：人在 Studio 3D 牆的「試用」步驟看到的跟發佈後在岩點貓定線一樣：工作檔在瀏覽器裡烘成成品（跟發佈同一份 `bakePack`），用岩點貓同一個舞台與沿牆鏡頭（從整面牆飛進牆前，拖曳沿牆走、捏合或滾輪靠近、兩指左右或滑鼠右鍵調角度，放手彈回）；只看、不改，點有問題的岩點（亮它的光暈，跟定線一樣底圖換暗彩）或牆上點不到的地方，點的地方旁邊（避開那顆岩點）只有兩個選項：有點沒辦法點（`cantPick`：Volume 上的小點、漏掉的岩點，代理在回報畫面描那顆、`add`）、外框不對（`outline`：光暈溢出、缺一塊、兩顆連在一起、不是岩點，代理 `reshape`／`off`），一點就回報，記下當時的鏡頭；右上平常只有一顆「回報 N」，點開才列出還沒處理的；還沒處理的回報出一題給代理（`feedback3d`），`look3d` 另出回報時的畫面（`.studio/work/look/fb-<回報 id>.jpg`，岩點上色、點的位置畫圈），被回報的岩點也放進總圖照樣 `review3d`，處理完 `resolve3d <資料夾> <回報 id> --note "怎麼處理"`。回報都處理了、這一版人還沒試用過就出一題等人答（`trial3d`）：人在 Studio 按「試用完」（記下這一版的指紋：不是岩點、修點、隱藏的面、裁切平面），或在對話裡說試用過沒問題；之後內容又改了就要再試用。試用過才出發佈題。一鍵試用 `try3d <資料夾>` 印出連結，點了直接到試用步驟：先用無畫面 Chromium 烘好成品放在 `trial/`（`manifest.json` 記這一版的 sig，`--no-bake` 不烘），試用直接打開這份最後的樣子，不在手機上烘（工作檔改過、對不上才現場烘）；沒接同步服務的在本機（127.0.0.1）開伺服器放 Studio 和這個資料夾（`#src=/work3d/`），回報、試用完、存檔直接寫回資料夾；接了同步服務的先推上去、發試用權杖（同步服務的 `trialLink`，預設 7 天，只存雜湊、再發一次舊的失效），連結（`/studio/wall3d/?app#sync=<專案>&t=<權杖>&step=try`）手機、別台電腦都能開，權杖只能讀這個專案、寫回回報，代理 `pull` 拿回來。Studio 的 3D 牆有重建量測（四份 `*-summary.json`）或 `review3d.json` 時多一個「報告」步驟：量測五步加「AI 逐顆看」（看過幾顆、拿掉、重描、照片不夠、還沒看）。發佈時烘的 `成品/` 不同步。`fetch3d <資料夾> <公開版本 id>` 從已發佈的版本（`/p/<id>/` 的基底加 `patch.json`）建工作資料夾，跟 Studio 的固定連結 `#p=` 同一套（`studio/wall3d/patch.js`）。`publish <資料夾> [--gym 岩館] [--origin <上一版 id>]`：人核准過才發；無畫面 Chromium 開 Studio 的 3D 牆烘焙成成品、帶同步金鑰發佈，印出岩點貓的連結；上一版預設是這個專案記的最後一次 `fetch3d`／`publish`。要金鑰本身交給瀏覽器，金鑰放在 Network secret 的雲端環境發佈不了 |
| `node tools/wall.mjs holds <牆的分享包>`、`apply <牆的分享包> <patch.json>` | 不開 Studio 看、改牆的岩點：列出每顆的 id 與外接框（照片像素）；`remove`（停用：已公開的岩點別人的路線還指得到）、`restore`、`add`（外框，來源記 manual）、`set`（換外框，來源記 edited）。改完過格式驗證才寫入，再用上面的 `publish` 發成同一個包的新版本 |
| `node tools/guidebook.mjs apply <岩場的包> <patch.json>` | 不開 Studio 改岩場：路線、岩壁、區域的新增與修改、照片換岩壁、地圖的牆線與區域、照片上的線與 bolt（操作見 [guidebook-convert-format.md](guidebook-convert-format.md) 的「命令列」） |
| `frames <資料夾> <frames.json> --model <模型> --images <照片資料夾> --name <名稱>` | 3D 重建的照片位置（每張 position、quaternion rub、intrinsics）做成 v2 Guidebook 包：模型畫面＋每張照片記著模型上的鏡頭；Crag「匯入岩場站」收進來，頁首「3D 場景」打開 |
| `doctor [--json]` | 這個環境能不能一起工作：Node、金鑰、連得到服務、金鑰對不對、建書要的 Chromium；缺的會說怎麼補 |

每個指令都可加 `--by agent:<名稱>`（或環境變數 `CLIMBIO_AGENT`）；人透過命令列答題用 `--by human:<名稱>`。大綱階段的問題直接改 `.studio/source/outline.md`，再答 `edit`。

## 資料夾

| 路徑 | 內容 |
|---|---|
| `index.json`、`<id>.json`、照片 | 成品：公開格式 v2 的包（建好之後才有） |
| `.studio/source/` | 路線書讀出來的大綱（`outline.md`）與圖 |
| `.studio/work/state.json` | 進度：`step`（`outline`、`built`）、`open`、`total`、`errors`、`humanOnly`、`publishable`、`next`；由下面三份算出，可以重算 |
| `.studio/work/questions/<id>.json` | 要判斷的題目，一題一份 |
| `.studio/work/decisions.jsonl` | 判斷，一筆一行 |
| `.studio/work/runs.jsonl` | 每次執行一行：時間、誰、指令、版本、結果數字 |
| `.studio/work/notes.md` | 交接筆記，每段以 `## <時間> <誰>` 開頭 |
| `.studio/work/remote.json` | 接的同步服務：`{ url, pid }`（金鑰不寫進資料夾） |

題目一題一份、判斷一筆一行：代理產生題目和人答題可以同時進行，同步時不會互相蓋掉。

## 題目與判斷（`studio/work/ledger.js`）

題目：`{ id, line, kind, level, target, title, options, evidence?, proposal?, since, seen }`

- `id` 由種類加節點 id（或內容）算出，同一個問題每次重算都是同一題；問題不在了，題目就拿掉。
- `level`：`error` 不修不能發佈，`check` 要看一眼。
- `kind`（路線書轉換）：`position` 岩場位置、`missing-images` 找不到的圖、`invalid` 格式不合、`outline` 大綱的提醒、`route-wall` 路線沒分到岩壁、`route-line` 路線沒有線或只有記號。
- **AI 判斷到底**：題目先等代理答（`waitingFor` 是 `agent`）；代理看證據照片判斷，看不準也要自己選一個，不交給人。只有原始資料明顯不夠（照片糊到認不出、缺頁）才答 `retake`（只有代理能選、要寫 `note` 哪裡不夠），題目才轉給人（`waitingFor` 是 `human`）。只能由人答的（位置、要不要發佈）一開始就等人。舊紀錄的 `unsure` 會重新等代理判斷。`ask --json` 的證據照片帶 `file`（專案裡的絕對路徑），代理直接打開來看。
- `options`：`ok` 沒問題維持現狀、`edit` 自己修了、`fix` 要改（交給代理：`note` 寫怎麼改，或 `patch` 直接給修正；人在對話裡說要改）、`accept`／`reject` 採用或不採用題目的建議（`proposal.patch`，有建議的題目才有）。`error` 沒有 `ok`。
- `evidence`：給人看的證據，`{ image: 專案裡的照片路徑 }`（路線所在岩壁的照片）、`{ outline, text: [大綱的表頭, 那一列] }`。

判斷：`{ id, q, choice, by, at, note?, patch?, applied? }`（`id` 由內容算出，兩邊同步時照 id 合併）

- `ok`、`reject` 之後這題不再出現；`accept`、`edit` 之後重算還有同一題，就重新打開（資料要真的改好）；`fix` 之後等代理改（`ask` 會寫「人要你改」），帶 `patch` 的由 `pull` 套用。
- `by` 是 `human:<名稱>` 或 `agent:<名稱>`。代理可以自己答題，判斷會記下是代理答的；**位置、要不要發佈（`position`、`publish`）只能由人答**，位置、署名一律來自原始資料，不由 AI 推測。來源與授權由使用者負責，不出題。
- 題目都答完、包也建好，`state.json` 的 `publishable` 才是 `true`。

## 同步（選配：要跨機器才需要）

只在一台電腦上做、在對話裡答題的人不用接：專案資料夾就是全部，`push`、`pull` 都不用跑。要讓別台電腦、雲端代理接手，才照下面接同步服務，做法跟維護者一樣。代理的身分用本機的 `gh` 登入（repo 的協作者），每台電腦登入過 GitHub 就能同步，不用複製金鑰；金鑰只留給登不了 GitHub 的環境。Studio 沒有收件匣，人一律在 AI 對話裡答。

工作紀錄和檔案放在**自己的** Firebase 專案（雲端函式 `studioSync`，`functions/studio-sync.js`），認一把金鑰（Secret `STUDIO_KEY`）：有金鑰的就是擁有者自己的裝置和代理。設了 `STUDIO_GITHUB_REPO`（`owner/repo`，放 `functions/.env.<專案 id>`）時，同一個標頭也收 GitHub 權杖：對那個 repo 有寫入權限的協作者就算擁有者，各台電腦的代理用本機 `gh` 登入的身分同步，不用發金鑰；拿掉協作者就失效。服務只拿權杖去問 GitHub（`GET /repos/{repo}` 的 `permissions.push`），不存權杖，結果照雜湊快取 10 分鐘。題目一題一份、判斷一筆一行，代理產生題目和人答題同時進行也不會互相蓋掉。Firestore：`studioProjects/{專案 id}`（`rev` 是版本、`files` 是檔案清單）和子集合 `questions`、`decisions`、`runs`、`notes`；Storage：`studio/{專案 id}/blobs/{sha256}`（照內容存）。雲端函式一次請求最多約 32 MB：超過 24 MB 的檔（3D 模型）命令列切成幾段各傳一次，檔案清單記 `parts`（每段的 sha256，照順序接起來是整個檔），下載時照內容一段一段拿（`GET ?pid=&sha=`）、接起來核對 sha256；分段的檔用路徑下載回 413。

**多個代理不互相蓋掉**：

- **推要帶版本**：專案有版本（`rev`），每次 `push` 加一。`push` 帶著上次同步看到的版本（記在 `.studio/work/remote.json`），服務上的比較新（別的代理在中間推過）就擋下：什麼都不改，先 `pull` 再推。
- **檔案跟著推一起換上**：檔案先用 PUT 照內容傳上去，`push` 帶檔案清單成功時才換上；被擋下的推不會動到任何檔案。
- **拉不蓋掉本機的改動**：`pull` 時本機在上次同步之後改過、服務上也被別人改了的檔案不蓋，列出衝突，也不記新版本（所以推不出去）；要用服務上的加 `--theirs`，自己的改動重做。
- 判斷照 id 合併：兩台各自記下的判斷推上去都留著。不接服務的話一切照舊在本機資料夾。

**部署（每個人自己的專案，代理照做即可）**：

1. 建一個 Firebase 專案（要 Blaze 方案才能用雲端函式和 Secret），Firestore 建具名資料庫 `climbio`。
2. 產生金鑰並存成 Secret：`node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`，再 `npx firebase-tools functions:secrets:set STUDIO_KEY --project <專案 id>` 貼上。
3. 只部署這個函式：`cd functions && npm install && cd .. && npx firebase-tools deploy --only functions:climbio:studioSync --project <專案 id>`。
4. 服務網址是 `https://asia-east1-<專案 id>.cloudfunctions.net/studioSync`；`curl` 它要回 `{"ok":true,"auth":false}`。
5. 代理的身分依序用環境變數 `CLIMBIO_STUDIO_KEY=<金鑰>`、`GH_TOKEN`／`GITHUB_TOKEN`、本機 `gh auth token`（`tools/studio-auth.mjs`；GitHub 權杖要服務設了 `STUDIO_GITHUB_REPO`），服務網址沒設 `CLIMBIO_STUDIO_URL` 時用主網的。`node tools/studio.mjs link <專案> <服務網址>`，再 `push`。

**雲端的代理（Codex Cloud、Claude Code 雲端環境等）**：容器每次都是新的，專案不在 repo 裡，所以照這個做：

1. 環境設定（只有使用者能改，設一次）：環境變數 `CLIMBIO_STUDIO_URL`（服務網址）、`CLIMBIO_AGENT=agent:<這個雲端代理的名稱>`（紀錄上的署名）；網路 allowlist 加服務網址的主機（`asia-east1-<專案 id>.cloudfunctions.net`）；要建書的再裝 Chromium（`npx playwright install chromium`）。金鑰：
   - 環境有代理代填的 secret（Claude Code 雲端環境的 **Network secrets**）就用它：網站填服務網址的主機、標頭名稱 `X-Studio-Key`、前綴清空。金鑰不進容器，命令列沒有 `CLIMBIO_STUDIO_KEY` 時不帶標頭，由代理加上。這樣同步、牆的發佈都行；岩場發佈（`guidebook.mjs publish`）要把金鑰交給無畫面的 Studio，只能在有金鑰環境變數的地方跑。
   - 沒有的（Codex Cloud）：環境變數 `CLIMBIO_STUDIO_KEY` 放 secret。
   - 環境只給自己用：同一個環境的工作階段都帶得到這把金鑰。
2. 開工先跑 `node tools/studio.mjs doctor`，有「缺」的項目就停下來告訴使用者缺什麼，不要重試。
3. `node tools/studio.mjs projects` 找專案，`node tools/studio.mjs pull ~/studio/<專案 id> --from '#<專案 id>'` 拉到 repo 外面的資料夾，照 `status` 做。
4. **結束前一定要 `push`**（容器會被丟掉），並用 `note` 留交接筆記。

**雲端環境實測（每種雲端代理做一次）**：使用者設好上面第 1 步之後，把這段交給那個雲端代理，全部通過才算能一起工作：

1. `node tools/studio.mjs doctor`：每一項都是 ok（建書那項選用）。
2. `node tools/studio.mjs projects` 列得出專案。
3. 挑一個專案 `pull ~/studio/<專案 id> --from '#<專案 id>'`，`status` 看得到題目和最後的交接筆記。
4. `note` 寫一句「<代理名稱> 雲端實測」，`push` 成功。
5. 回到電腦 `pull` 同一個專案，看得到那句筆記。

**代理一路做到只剩人的事**：代理答完自己能答的題、改完「人要你改」的題，接著建包，不在中間停下來回報。只剩等人的題（發佈、位置、代理答 `retake` 的）就在對話裡問使用者（上面的「在對話裡答題」），答完接著做到發佈。使用者不在、這次對話要結束時才是停點：用 `note` 寫做到哪、人答完後下一個指令；接了同步服務的再 `push`。

**流程**：本機——代理做到只剩人的題 → 在對話裡問、`answer … --by human: --said` 記下 → 接著改、建、發佈。接了同步服務——人在哪台的對話裡答，那台的代理記下再 `push`；別台的代理 `pull`（套用人給的修正、看「人要你改」的題目）→ 改完答 `edit`、`push`；別台電腦的代理用 `projects` 找專案，`pull <空資料夾> --from <服務網址>#<專案 id>` 接手。

## 驗證

`node --test tools/studio-work.test.mjs`（題目 id、判斷開關、只能由人答、fix、合併、進度、核准發佈）、`node --test functions/studio-sync.test.js`（金鑰、推上拉下、檔案、路徑、版本）、`node --test tools/studio-handoff.test.mjs`（兩個代理交接的端到端：本機跑同步服務，甲推、乙接手修好推、甲拿舊版本被擋、衝突不蓋、人核准才能發佈）；命令列串接 `tools/guidebook.mjs`，路線書轉換的數字照舊用 `npm run eval:convert` 比較。
