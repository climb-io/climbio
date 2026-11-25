# 岩館整合 Climbio：給 AI Agent 的流程

你是替岩館經營者（館主）整合 Climbio 的 AI Agent。館主通常不是工程師：**一開始一次問完需要的資料，之後除了驗收不打擾他**。

目標：岩館 App 的工作人員上傳一張牆面照片，就像更新原本的照片一樣，得到一面互動牆；使用者在 App 裡看線、定線，路線也出現在岩點貓。

## 規則

- 岩館名稱、App 的做法**只用館主給的**，答不出來就給選項和建議，不要編造。
- 牆面與路線是公開的（Climbio 的開放資料集 `climbio/walls`，CC BY-SA 4.0，署名）。這是整合的前提，開頭告知館主一次就好，不用逐項、逐版要授權。
- 只改岩館 App 的路線頁與管理後台；不動帳號、紀錄、資料庫。金鑰、權杖不寫進版控。
- 做不到的寫「卡在：…」，說清楚做到哪、解開後要做什麼；不要說已完成。

## 第 0 步：一次向館主要齊這些

1. **岩館名稱**（公開牆一定要有）。
2. **他們的 App**：網頁、iOS、Android、React Native 還是 Flutter；原始碼在哪裡（你能修改的資料夾或 repo）；哪一頁是路線頁、哪裡是管理後台（工作人員更新牆面照片的地方）；目前牆面照片怎麼存。
3. **使用者與路線怎麼對應**：路線 id 存在他們資料庫的哪個欄位、完攀紀錄怎麼記。Climbio 不管這件事，由他們的 App 決定。
4. **定線規則**：起攀岩點最多幾顆（預設 2，有的岩館是 4）。
5. **怎麼驗收**：他想在哪裡看成果（測試環境網址、測試版 App）。

## 第 1 步：在管理後台放「牆面照片」內嵌頁

細節（訊息、原生 App 的橋接）在 [embed.md](embed.md)「牆發佈內嵌頁」：

```html
<iframe id="wp" src="https://embed.climbio.app/wallpublish/v1/?lang=zh-Hant" style="width:100%;height:560px;border:0" title="牆面照片"></iframe>
```

先註冊 `message` 監聽，收到 `ready` 回 `init { gym: "<岩館名稱>" }`。工作人員選一張牆面照片，瀏覽器裡直接偵測岩點，填牆名稱，按發佈。成功時收到：

```
published { walls: [{ id, wallId, name, version, base }] }
```

**把 `wallId`（「包 id/牆 id」）和 `version` 存在 App 原本放牆面照片的地方**，就像存一張照片的網址。換新照片 = 新的一面牆：工作人員重新上傳，收到新的 `wallId`，換進去；舊牆和它的路線原封不動。

## 第 2 步：路線頁放看線、定線內嵌頁

照 [embed.md](embed.md)：

1. 路線頁放 `<iframe src="https://embed.climbio.app/routekit/v2/?mode=view">`（原生 App 用 WebView 開同一網址）。先註冊 `message` 監聽，收到 `ready` 回 `init { wallId }`；換路線送 `setRoute`。
2. 定線同一個頁面改 `?mode=edit`（起攀上限用第 0 步的答案：`&maxStart=4`）。
3. 使用者定完，App 送 `submit`（名稱、難度、暱稱由 App 收）；成功回 `submitted { routeId, routeUrl }`，**把 `routeId` 存起來對應他們自己的使用者**。刪除用 `remove`。
4. **鎖定版本**（選用）：`init` 預設讀牆的現行版；要固定在發佈的那一版，`init` 改給那一版的網址（`…/walls/<包 id>/v<版本>/…`，做法見 [embed.md](embed.md)），別人再發新版本也不影響。
5. **自備資料、不經過 Climbio**（選用）：要自己存牆面資料、或要長按岩點重描外框時，改放通用版 `routekit/v2/`（可自架，靜態包用 `node tools/release-routekit.mjs` 產生）：`init` 直接帶 `view`／`layers`／照片（或 https 網址），`capabilities` 宣告 `holdEdit`／`refine`／`wallEdit`；重描與牆面修改由你的程式回覆，內嵌頁不保存牆面。細節與訊息見 [embed.md](embed.md)「通用內嵌頁 v2」。

## 第 3 步：驗收

- 後台上傳一張照片 → 得到 `wallId` → 路線頁看得到這面牆、能定線、提交後岩點貓重新整理看得到。
- 回報最前面依序寫：**驗收連結、最終結果（已整合的頁面）、做出的 `wallId`**；館主還要決定的事放後面；做不到的寫「卡在：…」。

## 想要更精準：精修（選用）

瀏覽器裡的偵測是岩點貓新增牆面同一套，看線、定線夠用；岩館想要逐顆更準，由岩館的 AI Agent 照 Studio 的流程精修後再發佈，不用館主去 Studio：

1. 取得原始碼：`git clone https://github.com/climb-io/climbio`，先讀 [AGENTS.md](../AGENTS.md)。
2. 處理牆面（照片 → 岩點檔）：`node tools/studio.mjs start gym <工作資料夾> <照片…>`，照它印的下一步做；之後每一步都只跑 `node tools/wall-batch.mjs next <工作資料夾>`。流程是偵測 → SAM2 精修（每顆三個候選：原外框、SAM2、色彩貼邊）→ 分級檢查 → **你看圖判斷**（三選一、重複、總覽、Volume）→ 最後逐格細看（漏掉的岩點、畫不好的外框、不是岩點的）→ `verify` 通過才算做完。細節與判斷準則在 [studio-wall.md](studio-wall.md)「代理做牆面」。
3. 產生岩館金鑰（一次，存在版控外、備份）：`node tools/wall-routes.mjs keygen <金鑰檔>`。這把金鑰不是註冊過的身分，只是讓每個版本記下是誰發的、可以限額與封鎖。
4. 發佈：`node tools/wall-batch.mjs publish <工作資料夾> --gym "<岩館名稱>" --key <金鑰檔>`（只有通過 `verify` 的牆才會發佈），印出 `wallId` 與版本。精修的牆是新的一面牆（新 `wallId`），要換進 App；沒有 ZIP、不用工作人員再操作。
5. 想保留原本那面牆的路線：在 Studio 網頁版（`https://climbio.app/studio/wall/#p=<包 id>`）開啟已發佈的牆精修後發佈，同一面牆出新版本，`wallId` 不變。

（沒有金鑰、想讓工作人員手動發佈時，改用 `node tools/wall-batch.mjs zip <工作資料夾> --gym "<岩館名稱>"` 打包成 `walls.zip`，丟進牆面照片內嵌頁，照片或 ZIP 都收。）

## 之後

- 牆 90 天沒有任何更新（發佈或寫線）會自動從找牆面拿掉；想提早下架請聯絡維護者。
- 舊路線大量匯入、需要代發金鑰的做法見 [gym-agent.md](gym-agent.md)，一般整合用不到。
