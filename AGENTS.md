# Climbio — AI Agent 入口

Climbio 是無建置步驟的 PWA。**只讀任務需要的文件**：照下面「按任務讀文件」找到你的那一列，讀那一列的文件就能動手；不要預先讀完整 docs、歷史提案或別的模組。以現行程式與規格為準。


## 必守規則

- **AI 把工作完整做完，最後結果交給人驗收**：不留人工複核的清單，不確定的放大照片自己定案；驗收連結要能在原本的 AI App 直接打開（雲端的給網址，沒部署的給本機虛擬連結），規則見 [docs/agent-acceptance.md](docs/agent-acceptance.md)。
- **工具和測試不能讓 AI 卡住**：給代理跑的命令列工具、測試、瀏覽器腳本一律會自己結束；要等的步驟（網路、瀏覽器、子行程）都有逾時，卡住時整組停掉、印出卡在哪和下一步，以非 0 結束。新寫的工具照這條做，遇到會卡住的舊工具順手修。
- 只修改需求相關檔案；先查現行實作與真實資料，不憑空推測功能或資料。產品取捨不明才詢問。
- 開放格式 `format/` 與 `docs/route-format.md` 為 Apache-2.0；其餘程式與 Kit 為 AGPL-3.0。不得跨授權複製；公開 API 不相容變更需設計確認及語意版本調整。
- **分享網址能短就不要長**：給人貼、傳的連結只放必要的識別字（id），不把另一條網址整段編碼塞進參數；解析端負責補齊網域與路徑。
- 優先離線及無後端可用；Firebase 專屬邏輯留在後端適配層，能力由 `Backend.caps` 控制。外部輸入須驗證，不寫入秘密。
- 私人照片、路線、備份與同步資料不得用於訓練。匯入資料缺欄位時不自行捏造。
- 程式識別字用英文，內部註解與規格以繁體中文為主；對外 README／網站／Studio 說明維持繁中、英文，App 可見文字同步所有語言包。
- 變更行為同步更新對應文件。提交前跑 `node tools/check.mjs` 和受影響測試；正式發布前跑 `npm run test:quick`。不修改使用者測試資料。
- 網站供人閱讀產品、操作、進度與 AI 參與方式，技術文件及 Agent 專用規格以 GitHub 為唯一來源；修改網站先看 [docs/site-content.md](docs/site-content.md)。

## 按任務讀文件

每一列的文件寫了那個功能自己的規則；測試欄是 `npm run test:product -- <產品>`（加 `--e2e` 跑瀏覽器案例）。一次動到好幾個模組或共用層，才另讀 [docs/agent-rules.md](docs/agent-rules.md)。

| 要做的事 | 只讀 | 測試 |
|---|---|---|
| 岩點貓（拍牆、定線、看線、分享） | [docs/app.md](docs/app.md)、[docs/hold-data.md](docs/hold-data.md) | `hold` |
| 岩點偵測、外框的演算法 | [docs/hold-recognition.md](docs/hold-recognition.md)、[holdkit/README.md](holdkit/README.md) | `hold` |
| 紅點貓 | [docs/redpoint.md](docs/redpoint.md) | `redpoint` |
| 附近交換、裝置配對 | [docs/sharing.md](docs/sharing.md)、[appkit/README.md](appkit/README.md) | `hold`、`redpoint` |
| Studio 的首頁、外殼、設計系統 | [docs/studio.md](docs/studio.md)、[docs/studio-design.md](docs/studio-design.md) | `studio` |
| Studio 岩館牆（含岩點報告、`#p=` 精修公開牆） | [docs/studio-wall.md](docs/studio-wall.md) | `studio` |
| **Studio「交給 AI」的新任務**（岩館牆面、岩場照片、路線書、3D 牆） | **先跑 `node tools/studio.mjs start <gym\|crag\|book\|3d> <資料夾> [輸入…]`**，照它印的做；它印出下一步、完成標準與「卡在」（做不到的不要編造） | `studio` |
| 產生／精修牆面岩點檔（偵測、SAM2、AI 檢查、給人在手機看） | **先跑 `node tools/wall-batch.mjs next <資料夾>`**，照它印的判斷準則和下一步做，**`verify` 通過才算做完**；規則在 [docs/studio-wall.md](docs/studio-wall.md)「代理做牆面」，岩點判斷準則（3D 牆共用）在 `tools/hold-rubric.mjs` | `studio` |
| Studio 岩場（Crag） | [docs/studio-crag.md](docs/studio-crag.md) | `studio` |
| **岩館整合 Climbio**（照片 → 牆面 → 放進岩館 App） | [docs/gym-onboarding.md](docs/gym-onboarding.md)：先一次向館主要齊資料 | `studio` |
| 轉換路線書（資料或程式） | [docs/guidebook-convert-format.md](docs/guidebook-convert-format.md) | `studio` |
| 3D 牆（重建流程、Studio 3D 牆、岩點貓的 3D 牆） | [docs/wall3d-research.md](docs/wall3d-research.md)、[wall3dkit/README.md](wall3dkit/README.md) | `kits`、`studio` |
| 接手 Studio 專案、在對話裡問人答題 | [docs/studio-work.md](docs/studio-work.md)：先跑 `node tools/studio.mjs status <專案>` | `studio` |
| 開放格式 | [format/README.md](format/README.md) | `kits` |
| 改某個 Kit | 該 Kit 的 `README.md` | `kits` |
| 介面、文案、多語系 | [docs/style.md](docs/style.md) | 依模組 |
| 網站頁面 | [docs/site-content.md](docs/site-content.md) | `shared` |
| 寫測試、跑測試 | [docs/testing.md](docs/testing.md)、[docs/development.md](docs/development.md) | 依模組 |
| 架構、跨模組的改動 | [docs/architecture.md](docs/architecture.md)、[docs/agent-rules.md](docs/agent-rules.md) | 依模組 |
| 修一個回報的問題 | issue 內容，再照上面找模組；先寫一個修之前會失敗的最小案例 | 依模組 |
| 自己架站、接自己的後端 | [docs/open-source.md](docs/open-source.md)、[docs/deploy.md](docs/deploy.md) | |
| 外部貢獻 | [CONTRIBUTING.md](CONTRIBUTING.md) | |
| 歷史決策 | [docs/archive/README.md](docs/archive/README.md)，僅需要時搜尋；歷史提案不代表目前已實作 | |
