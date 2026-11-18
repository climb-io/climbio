# Firebase 權限驗證

[English](README.en.md)

沿用 Node 內建測試器，使用官方 Firebase Emulator 與 Rules 測試 SDK。所有資料只寫入 `127.0.0.1` 上的 `demo-climbio-acceptance`，不使用真實帳號或正式專案，不部署規則。

需要 Node.js 22 以上與 Java 21 以上；8080、9199 埠須可用。在儲存庫根目錄執行：

```sh
npm ci --prefix tests/rules
npm test --prefix tests/rules
```

受測規則直接讀取儲存庫的 `firestore.rules`、`storage.rules`，不另建替身規則。身分使用測試 SDK 產生的 Google／匿名 token claims；這驗證 Rules 授權，不能代替真實 OAuth、匿名登入、部署狀態或 App 同步整合。

案例使用本人、其他 Google 帳號、同 UID 的匿名帳號、匿名帳號與未驗證身分，驗證舊 Firebase 同步路徑皆不可讀寫或列出；`public/projects.json` 可公開讀取，但不可由 App 寫入、刪除或列出目錄；其他 `public/` 檔案與舊 `topos/` 路徑不可直接讀寫。分享資料、底圖、岩館索引、私有統計與 Studio 專案索引（`datasets`）也不可由 App 直接存取。備份流程見 [備份與復原](../../docs/backup.md)。

可用 `RULES_STORAGE_FILE` 指定另一份待比較的 Storage 規則；`RULES_REPO_ROOT` 指定受測儲存庫根目錄。這些參數只影響測試載入，不修改來源規則。測試結束關閉 Emulator；測試資料不匯出至正式系統。
