# 接自己的 Firebase 後端

**部署範圍**：岩點貓與紅點貓的公開內容儲存在 Climbio 開放資料集（Hugging Face）；備份由使用者匯出 `.climbio` 檔，「我的裝置」透過附近直連同步。Firebase 提供公開索引、App Check 與必要雲端函式。

只放靜態網站的話不用看這份（見 [open-source.md](open-source.md) 的「架自己的站」）。要支援官方式公開發佈、路線連結、公開牆面或附近交換的連線服務，才需要接後端。

## 設定

1. 建一個 Firebase 專案，`.firebaserc` 的 `default`、`web` 換成它。
2. **Firestore** 建一個具名資料庫 `climbio`（地區自選；程式裡的名稱是 `backend/firebase.js` 的 `DB`、functions 的 `getFirestore('climbio')`，`firebase.json` 的規則也指定這個資料庫）。
3. **Storage（舊版相容用途）** 用專案的預設儲存區（雲端函式自動用它，不用設定）；瀏覽器要直接下載照片和資料包，CORS 照 `storage-cors.json` 設：`gcloud storage buckets update gs://<儲存區> --cors-file=storage-cors.json`。
4. **Authentication** 不用開：沒有登入、沒有帳號，公開牆的寫入靠裝置金鑰簽章與 App Check，發佈靠 App Check 與網路來源的每日上限。
5. `backend/firebase.js` 的 `FIREBASE` 換成自己專案的網頁設定（含 `authDomain`、`storageBucket`）；`APP_CHECK_KEY` 留空（要用見下面的 App Check）。
5b. **Studio 的第二份設定**：`studio/backend.js` 仍有一份 `asia-east1-firebase-climbio` 雲端函式網址（`SERVICE`），自架時換成自己的專案；否則公開發佈請求會連到官方後端。
5c. **雲端函式的 Secret 與資料集倉庫**：`functions/` 需要 `HF_TOKEN`（Hugging Face 寫入權杖）Secret（`firebase functions:secrets:set`）；`functions/crags-dataset.js`、`functions/walls-dataset.js` 的 `repo` 寫的是官方組織（`climbio/crags`、`climbio/walls` 等），自架要改成自己有寫入權限的倉庫，否則發佈會失敗。
6. `site.js` 的 `MAIN` 列表和 `url` 改成自己的網域；`cloud` 的網址填自己部署的函式，或留空不用。
7. **內容安全政策**：依 `hold/index.html` 的 `Content-Security-Policy` 設定 Firebase App Check、reCAPTCHA 與必要資源允許來源；自架網域須與後端允許來源一致。`index.html` 不放內嵌程式，啟動程式放在 `js/boot.js`。
8. **站台網域**：`functions/site.js` 的 `HOSTS` 換成自己的網域（第一個是正式站的主要網址，只有它列進總目錄）。路線連結、照片網址、公開牆面資料用它產生網址，也是 `climbio` 雲端函式允許的來源；不在清單裡的網域一律導回第一個。
9. 偵測、重描函式的允許來源：`holdscan/functions/index.js`、`holdkit/functions/index.js` 的 `ORIGINS` 加上自己的網域（沒部署這兩個就不用改）。

## 部署

- **網站**：`./build-site.sh && npx firebase-tools deploy --only hosting --project web`。`build-site.sh` 只打包版控裡的檔案（雲端函式和只在雲端用的模型不打包），版本號加上 holdkit 版本，換 holdkit 時 Service Worker 才會清掉舊模型；再由 `tools/stamp-assets.mjs` 把 `hold/index.html`、`3d/index.html` 和 Studio 各頁裡本站的程式、樣式表網址加上 `?v=版本`（見 architecture.md 的「更新與離線」），並一併打包 `/redpoint-collect/` 與 `extension/` 的 zip。沒經過 `build-site.sh` 的站不帶後綴，照常能用，只是資源都走網路優先。`firebase.json` 的 `site` 換成自己的 Hosting 網站名稱。部署前跑 `node tools/bump-version.mjs`，版本號沒變，已安裝的 App 不會更新。
- **規則**：`npx firebase-tools deploy --only firestore:rules,storage --project web`。
- **雲端函式**（`firebase.json` 分兩個 codebase，地區 asia-east1，可以改）：
  - `climbio`（`functions/`）：每日清理、路線連結的預覽頁 `routePage`（`/r/**`、`/climbio.json`、`/w/**` 轉址要它先上線）、附近交換 `nearby`（`site.js` 的 `SITE.cloud.nearby`；不部署就留空，附近交換只剩掃 QR code 連線）、預算開關、總目錄。`cd functions && npm install && cd .. && npx firebase-tools deploy --only functions:climbio --project web`。
  - `climbio` 裡的 Studio 同步服務 `studioSync` 和發佈的 `datasets`（擁有者的代理用同步金鑰代替 App Check；選用的 `STUDIO_GITHUB_REPO` 讓某個 repo 的協作者用自己的 GitHub 權杖代替金鑰，見 studio-work.md）要 Secret `STUDIO_KEY`（`functions:secrets:set STUDIO_KEY`；沒設定時整個 `functions:climbio` 部署會失敗）。只要同步服務的人只部署它：`--only functions:climbio:studioSync`，見 [studio-work.md](studio-work.md) 的「同步」。
  - `holdkit/functions`（重描 `retrace` 的雲端版）：Climbio 自己沒有部署（重描全在手機上算，已刪除雲端函式）；自架要用的人照 `holdkit/README.md`，不在 `firebase.json` 裡。
- 網站、規則、雲端函式各自部署；同一個專案的開發站和正式站共用規則與函式。

## 防濫用

公開分享不用登入，靠下面幾層擋：

| 防護 | 擋什麼 | 在哪裡 |
|---|---|---|
| 舊版 `share` 每個帳號每天新增 100 條線 | 單一帳號灌路線 | 雲端函式 `share` |
| 內容檢查判為可疑的照片不公開 | 不當照片 | `routePage`、找牆面（見 sharing.md） |
| 超過預算停止上傳 | 費用失控 | 雲端函式 `budgetGuard` → `config/uploads.off`（`share` 等函式看它）（`functions/budget.js`） |
| App Check | 腳本直接打 Firestore、Storage、花錢的雲端函式 | `backend/firebase.js` 的 `APP_CHECK_KEY`＋控制台強制執行；函式自己檢查 |

### 超過預算停止上傳

1. Google Cloud 控制台 → 帳單 → 預算與快訊 → 建立預算：範圍選自己的專案，金額是每月上限；「管理通知」勾選連結 Pub/Sub 主題 `projects/<專案>/topics/billing-budget`（部署 `budgetGuard` 時自動建立）。
2. 部署 `budgetGuard`：`npx firebase-tools deploy --only functions:climbio:budgetGuard --project web`。
3. 花費到了預算，`config/uploads.off` 變成 true：舊版規則不收分享路線和牆名、相容 App 分享前先看（說「分享暫時停止」）、預覽圖回 503。下個月花費歸零的通知來了自動恢復；要提早恢復就把預算調高，或把 `config/uploads` 的 `off` 改成 false。本機資料與配對裝置交換、偵測、重描不受影響。

### Hosting 保留的版本數

Hosting 預設永遠保留舊版本，很快會超過免費的儲存空間。只留最近 5 版：

```bash
curl -X PATCH -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: <專案>" -H "Content-Type: application/json" "https://firebasehosting.googleapis.com/v1beta1/sites/<站名>/channels/live?updateMask=retainedReleaseCount" -d '{"retainedReleaseCount":5}'
```

### App Check

1. Google Cloud 控制台 → Security → reCAPTCHA 建立網頁金鑰（計分型），網域填自己的網域、`localhost`、`127.0.0.1`；Firebase 控制台 → App Check 選 reCAPTCHA Enterprise，填這把金鑰。
2. 金鑰填進 `backend/firebase.js` 的 `APP_CHECK_KEY`，確認分享、收線、同步都正常。
3. App Check 的「指標」裡已驗證的請求接近 100% 後，Cloud Firestore、Cloud Storage 各按「強制執行」。還沒更新的舊版 App 會被擋，要等大家換到新版。
4. 花錢的雲端函式（自架的重描 `retrace`）一律檢查 App Check 權杖（標頭 `X-Firebase-AppCheck`），沒有就回 401；再按網路來源限流：每個來源每天 30 次（一間岩館一天），超額回 429。沒設 App Check 的後端用不了這個函式。先部署能取得權杖的 App 版本，再開啟函式強制驗證。

## Hosting 的快取標頭（踩過的坑）

- 要「每次都問伺服器有沒有新的」的檔案（HTML、JS、CSS、語言包）用 `Cache-Control: public, max-age=0, must-revalidate`，**不要用 `no-cache`**：Firebase Hosting 的 CDN 對標 `no-cache` 的檔案不回 304，每次重新驗證都整份重下載（Service Worker 預載整份檔案、每次部署都要重載一遍）。2026-11-24 用預覽頻道實測：`max-age=0`、`public, max-age=0, must-revalidate` 回 304，`no-cache`、`public, no-cache` 回 200。
- 版本號只在 App 殼（`tools/app-version.mjs`）有變動時才換：改首頁、文件、各語言網頁的部署，`version.js` 不變，使用者不會更新。

## 排程

只有一個排程函式 `daily`（每天 04:30 台北時間，`functions/index.js`）：依序清附近交換的過期資料、下架 90 天沒動靜的公開牆、補寫紅點貓 index、更新資料集的目錄路線數與 `stats.json`；一步失敗不擋後面的，最後有失敗就標失敗。預算通知 `budgetGuard` 是 Pub/Sub 事件，不是排程。
