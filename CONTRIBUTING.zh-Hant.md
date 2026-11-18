# 參與貢獻

謝謝你來幫忙。Issue 和 PR 用繁體中文或英文都可以。English: [CONTRIBUTING.md](CONTRIBUTING.md)。

## 開始之前

- 先讀 [README.md](README.md) 和 [docs/README.md](docs/README.md)。產品行為寫在 `docs/`，改了行為就一起改對應的文件。
- 用 AI 寫程式的話：先讓它讀 [AGENTS.md](AGENTS.md)（任務導覽、模組的界線、要跑的檢查）和你要改的 Kit 的 README。
- 一個 PR 只做一件事，不順手重構無關的程式。

## 直接修，還是先提案？

| 改動 | 可以直接寫嗎？ |
|---|---|
| 有重現方式、預期行為沒有爭議的 Bug | 可以：先寫一個修之前會失敗的測試，再修 |
| 錯字、翻譯、壞掉的連結、補測試 | 可以 |
| 公開 API 範圍內的小型效能改善 | 可以，附上改前改後的量測 |
| 新功能、新操作方式、改變預設值 | 先開**功能／設計提案**的 issue，等決定 |
| 開放格式、Kit 的公開 API、儲存、同步、離線的行為 | 先開設計提案，核准後再寫 |
| 授權、資料權利、密鑰、部署、CI 安全設定 | 先提議，由維護者決定 |

## 版本

開放格式（`format/`）和各 Kit 的公開 API 採語意版本：不相容的改動要升主版本，並且要有核准的設計提案；相容的新增升次版本。App 自己的內部資料與沒公開的介面可以直接改，不留相容的程式。

## PR 怎麼合併

維護者在私人的 repo 開發，每次發布把內容整理成這個 repo 的一個快照提交。PR 在這裡審查、合併；每個 PR 都會自動跑 CI（只有讀取權限）。合併 PR 不會更新 climbio.app。合併之後，維護者在私人 repo 重做同樣的改動（用 `Co-authored-by` 標示你），下一個快照才會包含它。你不用多做什麼，只是：

- 這個 repo 的提交歷史是一次發布一個提交，你的提交可能被併進發布的快照；作者資訊留在 PR 和 `Co-authored-by`。
- 合併的改動要到下一次發布才會再出現在提交歷史裡。想知道移植了沒，可以在 PR 裡問。

## 慣例

- App 沒有建置步驟、沒有框架：一般的 script 依 `hold/index.html` 列的順序載入、共用全域範圍。載入當下只能用前面檔案宣告的東西，所以啟動和事件綁定放最後的 `js/main.js`。新增檔案要加進 `index.html`（唯一的載入清單）和 `sw.js` 的 `SHELL`（離線快取）；`tools/check.mjs` 會檢查。
- 程式碼註解和測試名稱用繁體中文。App、RouteKit、holdkit、holdscan 的程式檔開頭有一行英文摘要（`// English: …`）。
- 內部識別字用 `climbio`：`localStorage`／IndexedDB 的鍵（`climbio.*`、`climbio-db`）、`CLIMBIO_*` 全域變數、版本字串 `climbio-v…`。舊名 `spraywall` 只剩 `js/rename.js` 用來搬手機上的舊資料。
- 使用者看得到的文字都放進 `i18n/` 的每一個語言包（key 不一致時檢查會失敗）；產品名稱寫 `Climbio`。
- 品牌色用 CSS 變數（`--accent` 等），不寫死色碼。
- 新功能要在沒有伺服器時也能用；需要後端的功能放在 `Backend.caps` 後面，Firebase 專屬的程式放在 `backend/firebase.js`。
- **授權邊界**：所有程式（包含每個 Kit：`holdkit/`、`routekit/`、`topokit/`、`mapkit/`、`appkit/`、`sourcekit/`）都是 AGPL-3.0。只有 `format/` 和 `docs/route-format.md` 是 Apache-2.0，裡面不能引用或複製 AGPL 的程式或模型。貢獻依你改動的資料夾的授權進來（AGPL-3.0，`format/` 裡是 Apache-2.0）；沒有 CLA，也沒有商業授權。
- 不要提交密鑰、服務帳號檔、個人資料，或不是你擁有的照片。

## 檢查

需要 Node.js 22 以上和 Python 3（瀏覽器測試用 `python3 tools/serve-test.py` 起伺服器）。

```bash
npm ci && npm ci --prefix functions         # 測試用的套件（雲端函式的測試要 functions/ 的套件）
npx playwright install chromium webkit      # 第一次，瀏覽器測試用
npm run test:quick                          # 每個 PR 前都跑
npm run test:e2e -- --project=android-chromium <測試檔> [...]   # 挑跟你改動有關的案例
```

哪些改動要跑哪些瀏覽器案例見 `docs/development.md`。CI 跑 `npm run test:quick`、規則的測試和幾個 Chromium 冒煙案例（`npm run test:smoke`）。完整的端對端測試約 15 分鐘，不在 CI 跑。
Firestore、Storage 規則有自己的測試（要 Java 21）：`npm ci --prefix tests/rules && npm test --prefix tests/rules`。改 `firestore.rules` 或 `storage.rules` 要一起加測試案例。

## 架自己的站

Fork、改名（`node tools/rebrand.mjs`）、部署，見 [docs/open-source.md](docs/open-source.md)。請不要把你的站命名為 Climbio（[TRADEMARKS.md](TRADEMARKS.md)）。climbio.app 以外的站預設不接後端（`site.js` 的 `backend: 'none'`：資料只存在裝置上，Studio 只能匯出 ZIP、不能發佈）；要接自己的 Firebase 後端見 [docs/deploy.md](docs/deploy.md)。
