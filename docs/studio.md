# Climbio Studio：現況與架構（開發 Studio 先讀這份）

所有在開發 Studio 的工作階段（人或 AI 代理）以這份對齊。細節在文末的「文件地圖」；**改了 Studio 的架構、分工或規則，同一個提交更新這份**。

## 定位

Studio 是**給 AI 用最順手、給人只留判斷**的資料工作台：AI 代理用命令列把資料做到只剩要人看的地方；人在原本用的 AI App（Claude、ChatGPT…）的對話裡答判斷題，答完就能發佈，資料預設全在本機的專案資料夾。要跨機器交接的人才接同步服務（代理之間用，各台用 GitHub 登入的身分）。Studio 沒有收件匣，人不用打開 Studio 答題。進度、題目、判斷、交接筆記都寫在共享的專案資料夾裡，任何新的代理讀了就能接著做。設計與決定見 [proposals/studio-v4.md](proposals/studio-v4.md)。

Agent 共用入口：`AGENTS.md`（`CLAUDE.md` 引用）、`tools/studio.mjs` CLI、`docs/studio-work.md`。不同 Agent 可共用 CLI 和 `.studio/work/`；目前沒有 Studio 的 MCP server。雲端 Agent 的端到端驗收另行進行，不應標為已驗證。

五條線：**岩館牆面**（`studio/wall/`）、**3D 牆**（`studio/wall3d/`）、**舊路線書轉換**（`tools/guidebook.mjs`＋Crag 的轉換）、**天然路線管理**（`studio/crag/`）、**發佈**（共用）。

## 現況

| 項目 | 狀態 | 在哪裡 |
|---|---|---|
| 工作紀錄 `.studio/work/`、命令列 `tools/studio.mjs` | 已上線 | [studio-work.md](studio-work.md) |
| 在 AI 對話裡答題（預設，不用架服務）：`ask --human` 列題目與證據，人答了代理用 `answer --by human: --said` 記下原話 | 已上線 | `tools/studio.mjs`、`studio/work/ledger.js` |
| 自架同步服務（雲端函式 `studioSync`） | 已上線（主網的已部署） | `functions/studio-sync.js` |
| 雲端代理（Codex Cloud、Claude Code 雲端）一起工作 | 工具與流程已做；雲端環境的設定待使用者完成後實測 | `tools/studio.mjs doctor` |
| 會出題的線 | 路線書轉換（含岩場站 `guidebook fetch` 收進來的包）、岩館牆面（牆的分享包：可能重複的岩點）、3D 牆（工作資料夾：只有發佈題；AI 題還沒定，3D 的檢查還在各自的畫面） | |
| 外觀：固定深色、細線、浮動膠囊工具列（階段 A） | 已上線 | `css/brand-tokens.css` 的 `studio`、`studio/shell.css`、`studio/chrome.css` |
| 3D 場景 `/studio/scene/`：模型＋每張照片的相機視錐（細白線），點一個飛到那張拍的位置、照片淡入，下方照片膠卷（階段 B 的 3D 部分） | 已上線（開放資料集的大砲岩 64 張 `#src=dapao`、原岩明德 165 張 `#src=mingde`，頁首切換） | `studio/scene/` |
| Crag 區域圖上的照片視錐（拍照位置＋朝向的扇形，點了打開那張照片） | 已上線 | `studio/crag/map.js`、`geo.js` 的 `photoWedge` |
| 從 Crag 專案打開 3D 場景（頁首「3D 場景」，有模型、照片記著模型鏡頭 `props.model` 才出現） | 已上線 | `studio/scene/#crag=<專案 id>` |
| 3D 重建的照片位置收進 Studio（`tools/studio.mjs frames`：frames.json → v2 包，Crag「匯入岩場站」收進來） | 已上線 | `tools/studio.mjs` |
| 代理發佈（協作者的 GitHub 身分或同步金鑰代替 App Check；`tools/studio.mjs publish` 發佈牆的分享包，無畫面 Studio 發佈岩場、3D 牆也帶同一個身分） | 已上線 | `functions/index.js`、`studio/service.js` |
| 首頁三條線（岩館、岩場、3D）各一張卡：輸入 → AI → 你判斷三步、工作區色的按鈕（階段 C）；路線書是岩場的一種來源，轉出來的就是岩場 | 已上線 | `studio/index.html` |
| AI 判斷到底：題目由 AI 看證據照片判斷，看不準也自己判斷；人只在發佈時確認，另外只有原始資料明顯不夠（AI 答 `retake`）時問要不要補拍、補資料（代理在對話裡問）；岩館牆、路線書、3D 牆同一套 | 已上線 | `studio/work/ledger.js` 的 `waitingFor` |
| 統一導覽：每個 Studio 頁面同一條左側導覽（首頁、交給 AI、岩館、岩場、3D），寬螢幕帶名稱，手機是底部一排；岩館、岩場兩頁是那條線的作品清單（進行中、已發佈；路線書轉換來的在岩場、標「路線書」），新的作品由 AI 代理做（首頁的「交給 AI」） | 已上線 | `studio/shell.js` 的 `rail` |
| 報告共用一個框架：岩館牆的岩點報告（Studio Wall 發佈前、已公開的牆、Hold Lab）、Lab 的 3D 牆與天然岩場量測，同一種步驟卡，數字從資料讀 | 已上線（3D 牆、天然岩場在 Studio 裡還沒有發佈前的報告：工作資料夾沒有量測檔） | `studio/report-frame.js`、[studio-wall.md](studio-wall.md) 的「岩點報告」 |
| 首頁主畫面：岩館（原岩明德 3D 牆）和天然岩場（大砲岩 3D）交替，各有「打開 3D」進 3D 場景 | 已上線（目前是 3D 的渲染圖；即時 3D 還沒放） | `studio/hero/` |
| 同步服務傳大檔：超過 24 MB 的檔（3D 模型）分段傳、照內容一段一段下載 | 已上線 | `functions/studio-sync.js`、`tools/studio.mjs` 的 push／pull |
| 多個代理不互相蓋掉：同步服務的專案有版本，推要帶上次看到的版本（別人推過就擋下、什麼都不改）；檔案照內容存、推成功才換上；拉的時候本機改過、服務上也改了的檔案不蓋（列出衝突，`--theirs` 用服務上的） | 已上線 | `functions/studio-sync.js`、`tools/studio.mjs` 的 push／pull |
| 真人核准發佈：成品建好、其他題答完出「要不要公開發佈」，只能由人在對話裡答，核准綁在這一版的內容上；牆、岩場的發佈指令都只認這筆判斷。岩館牆面也出題：可能重複的岩點（照片放大加框） | 已上線 | `studio/work/ledger.js` 的 `publishQuestion`、`approval`，`tools/studio.mjs` |
| AI 的工具補齊：岩場的 `guidebook apply` 做得到畫面上能改的（新增節點、改上層、照片換岩壁、地圖形狀、照片上的線與 bolt、刪岩壁區域）；岩館的 `tools/wall.mjs` 看、改牆的分享包岩點（停用、新增、換外框），改完用 `studio.mjs publish` 發佈 | 已上線（岩場發佈 `guidebook.mjs publish`、3D 牆發佈 `studio.mjs publish` 都在無畫面瀏覽器開 Studio、帶同步金鑰；3D 牆的 `fetch3d` 從公開版本建工作資料夾） | `tools/guidebook.mjs`、`tools/wall.mjs` |
| 交給 AI：Studio 給 AI 代理做事、人來確認，沒有給人手動新增的入口；首頁教人設定代理（把 GitHub 專案交給它）、交代任務（四句可以複製的話）、打開代理做好的專案資料夾確認；匯入的程式留著給代理的工具（隱藏的 `#addInput`、`#import=`）；天然岩場的人工編輯（區域圖、路線圖、路線表格）保留給確認時修正 | 已上線（公開的 GitHub 版要等下一次快照才有岩館牆、Studio 專案的代理工具） | `studio/home.js`、`studio/index.html` 的 `#aiBox` |
| AI 工作時的點雲過場：`StudioShell.busy` 的 `show(照片, 點)`，偵測到的岩點一顆顆亮起來（只用真的資料；Wall 加牆面照片在用） | 已上線 | `studio/shell.js` |
| 岩館牆面、3D 牆（AI 逐顆看過每顆要發佈的岩點）的題目已接通；天然路線完整 AI 判斷尚未完成 | 部分完成 | [proposals/studio-v4.md](proposals/studio-v4.md) 的「分階段」 |

## 同時進行的開發

| 線 | 範圍（檔案） | 對齊點 |
|---|---|---|
| **明德 3D 牆**（室內 3D 牆） | `studio/wall3d/`、`wall3dkit/`、岩點貓的 3D 牆 | 已有代理不用資料夾選擇器的檔案輸入與發佈；`studio/wall3d/index.html` 已換成 Studio 深色主題（`data-climbio-theme="studio"`、深色 Logo），3D 工作畫面（`#work`）維持室內深色；目前在改 `wall3dkit/stage.js`（Volume 光暈補洞 `enclosed`、修點 `applyEdit`）與 `js/wall3d.js`（進場、刪牆清快取）；3D 牆的檢查與重描（光暈區域、修點）現在在作者端研究用的程式，之後的「不是岩點／要重描／看不清楚」會變成題目 |
| **大砲岩 3D 岩場**（天然 3D 岩場；Studio 的 `studio/scene/` 只讀它打包的 `crag3dkit/vendor/three-splat.js`，不改那個 Kit） | `crag3dkit/`、紅點貓的 3D 岩場、3D 岩場的發佈、說明頁 `studio/crag3d/`（與 `en/studio/crag3d/`，靜態說明頁，用 `css/pages.css` 跟轉換路線書的說明頁同一種外觀，不是 Studio 的工作畫面）、`guides/shoot-3d.html` 的「岩場 3D 模型：退後拍一套」 | Studio 的天然路線線（`studio/crag/`）之後會讀它的模型畫照片視錐（階段 B）；3D 岩場的檢查（路線位置低分、模型蒙霧破洞）之後照「加一條線出題」變成題目，現在還在作者端的工具裡 |

- Studio 共用層（`studio/shell.*`、`chrome.css`、`studio/work/`、`tools/studio.mjs`、本文件）的改動不碰上面兩條線的檔案；兩條線也不改共用層，要改先在這份寫清楚再改。
- 兩條線要出題時照下面的「加一條線出題」做；它們的檢查（不是岩點、這塊是不是牆、切線）會變成題目。

## 架構

```
人（原本用的 AI App：Claude、ChatGPT…）
  代理在對話裡問等人的題（ask --human），人答了代理記下原話（answer --by human: --said）
        │
人（Studio 畫面，要自己動手改時才開）
  首頁 studio/index.html：交給 AI、繼續編輯、各條線的說明
  各線的編輯器：studio/crag/、studio/wall/、studio/wall3d/
  3D 場景 studio/scene/：模型＋照片視錐，點了飛到那張照片（cameras.js 是換算，scene.js 是畫面）；#crag=<專案 id> 讀 Crag 專案，#src=dapao／mingde 讀開放資料集
同步服務（選配，跨機器的代理交接用；每個人自己的 Firebase：functions/studio-sync.js，GitHub 身分或金鑰放 X-Studio-Key）
        │ push／pull（題目整份換、判斷與紀錄照 id 合併、檔案存 Storage）
專案資料夾（公開格式 v2 的成品＋.studio/）
  .studio/work/：state.json、questions/、decisions.jsonl、runs.jsonl、notes.md、remote.json
        │ 讀寫同一份
AI 工具層（命令列，沒有畫面也能跑）
  tools/studio.mjs：doctor、status、ask、answer、note、convert、apply、link、push、pull、projects
  tools/guidebook.mjs：路線書的 read、check、build、apply、validate
  題目怎麼算：studio/work/ledger.js（命令列、同步服務共用）
        │ 成品
發佈：studio/publisher.js、dataset-publish.js → 雲端函式 datasets → 開放資料集（Hugging Face）
  瀏覽器帶 App Check；代理（命令列、無畫面瀏覽器）帶同步金鑰 X-Studio-Key，伺服器認擁有者
```

## 不能破的規則

- **畫面和命令列呼叫同一份程式**：路線書轉換在 `studio/crag/convert.js`、問題清單在 `studio/crag/report.js`、題目與判斷在 `studio/work/ledger.js`。新的自動步驟先做成命令列能跑的，再接畫面。
- **AI 判斷到底**：題目由 AI（代理）判斷，看不準也自己判斷，不交給人；人只在發佈時確認。唯一例外是原始資料明顯不夠（照片糊、缺頁），AI 答 `retake` 寫哪裡不夠，代理在對話裡問人要不要補。新的檢查一律先想 AI 怎麼判斷（給它證據照片），不新增要人逐一確認的流程。
- **人只做判斷**：新功能先想「哪些是 AI 自動做、哪些要人判斷」，要人判斷的變成題目（`questionsFromReport` 這類函式產生），不新增要人操作的流程。
- **題目的 id 要穩定**（同一個問題每次重算都是同一題），判斷才接得上；題目一題一份、判斷一筆一行，同步時才不會互相蓋掉。
- **只能由人答**：要不要發佈、位置（原始資料沒有時）、3D 牆要不要補拍（`ledger.js` 的 `HUMAN_ONLY`）；代理只能套用人給的修正。
- **天然岩場的 Guidebook 一定要有位置**：照片的拍攝位置（`camera.position`）→ 岩場節點的 `geo` → 地圖上岩場自己的形狀（岩壁、分區、區域、岩場；道路、陸地不算）的中心（`model.js` 的 `mapCenter`）；都沒有不能發佈（`studio/crag/publish.js` 的 `needsPosition`）。轉換路線書要先寫好岩場節點的 `geo`。位置、路線、署名、授權一律來自原始資料，不由 AI 推測。
- **來源與授權由使用者負責**：工具不為授權新增攔截、題目或檢查（docs/agent-rules.md）。
- **沒有伺服器也能用**：同步服務是選用的；不接時一切在本機資料夾，格式相同。同步服務不判斷，只存。
- **外觀**：固定深色（`data-climbio-theme="studio"`），顏色只用介面變數；1px 細線分隔、不用陰影；工具列用 `.tbar`；工作區色 `--ws`（Crag 層次藍、Wall 室內綠、3D 牆青藍）。未來感只來自真實資料畫出來的東西（照片位置、視錐、點雲、3D），不加只為好看的特效。介面文字照 [style.md](style.md) 第 7 節。
- **工作區分界**：各線的功能只放自己的資料夾；共用的 `studio/shell.*`、`chrome.css`、`store.js`、`publish*.js`、`studio/work/` 不判斷是哪條線（AGENTS.md 的「Studio 的工作區分界」）。

## 加一條線出題（第 3、5 階段照這個做）

1. 把那條線的檢查做成純資料的函式：輸入成品，輸出問題清單（照 `studio/crag/report.js`）。
2. 在 `studio/work/ledger.js` 加「問題清單 → 題目」（`kind`、`options`、`evidence` 指到專案裡的照片），寫單元測試（`tools/studio-work.test.mjs`）。
3. `tools/studio.mjs` 加那條線的 `run` 步驟與 `status` 的判斷（目前 `stepOf`、`currentReport` 只認路線書）。
4. 對話裡怎麼問不用改：`ask --human` 照 `options`、`evidence` 列出；有新的 `kind` 要特別輸入的（像位置）才在 `printForHuman` 加。
5. 更新這份的「現況」、[studio-work.md](studio-work.md) 的 `kind` 清單。

## 驗證

| 改動 | 跑 |
|---|---|
| `studio/work/`、`tools/studio.mjs` | `node --test tools/studio-work.test.mjs tools/studio-handoff.test.mjs tools/studio-wall-cli.test.mjs` |
| `studio/scene/`、`tools/studio.mjs frames` | `node --test tools/studio-scene.test.mjs`、`python tools/e2e.py tests/e2e/studio-scene.spec.mjs`（Crag 入口）；模型要在有 GPU 的瀏覽器看（無畫面 Chromium 畫不出） |
| Crag 地圖的照片視錐 | `python tools/e2e.py tests/e2e/author.spec.mjs -g 視錐` |
| 同步服務 | `node --test functions/studio-sync.test.js`；部署後 `node tools/studio.mjs doctor` |
| Studio 介面 | `npm run test:product -- studio --e2e`，手機與電腦寬度截圖 |

## 文件地圖

| 文件 | 內容 |
|---|---|
| [proposals/studio-v4.md](proposals/studio-v4.md) | 為什麼這樣設計、決定、分階段 |
| [studio-work.md](studio-work.md) | 工作紀錄格式、命令列、同步服務的部署、雲端代理的流程 |
| [studio-design.md](studio-design.md) | 首頁、步驟列、專案資料夾、發佈、品牌與外觀 |
| [studio-crag.md](studio-crag.md)、[studio-wall.md](studio-wall.md) | 天然岩場、岩館牆面的編輯器 |
| [guidebook-convert-format.md](guidebook-convert-format.md) | 路線書轉換的格式與命令列 |
