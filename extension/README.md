# 紅點貓收藏（瀏覽器擴充）

在外站的岩場頁按一下，把路線與 Topo 轉成 Climbio 公開格式 v2，**交給電腦上的紅點貓**：擴充打開一個紅點貓分頁，頁面把資料拿過去存進電腦端的紅點貓（個人收藏）。不用登入、不用 Google Drive。要帶到手機，電腦和手機連同一個 Wi-Fi，用紅點貓的「附近交換」傳過去。

- **進度看得到**：頁面右下角的面板顯示三個步驟（讀取頁面、下載 Topo 圖片、交給紅點貓）各自的張數與總進度條，完成顯示收了什麼，失敗顯示原因。
- 為了快：Topo 照片長邊縮到最多 1600 像素（手機上看夠了，原圖有的好幾 MB）；一個岩場一份，全部收好才交出去，有圖片讀不到的那次不交，再按一次會重收。
- **全部在你的瀏覽器裡做**：讀頁面、抓圖、轉格式，不經過 Climbio 的伺服器，也不需要任何帳號。收好的岩場先放在擴充自己的暫存（IndexedDB `climbio-collect`），紅點貓匯入成功才通知擴充刪掉。
- **來源與授權**：收藏保留原始來源網址與可取得的作者、授權資訊。不同來源及個別圖片可能有不同授權；使用者應依來源授權決定如何使用或分享。
- 目前支援：theCrag 的岩場頁（有路線清單的頁面）。**任何在頁面放 `<link rel="climbio" href="入口.json">` 的網站**（入口是 Climbio 公開格式 v2 的組合，https），以及 OpenClimbing、香港攀岩的岩場頁。

## 語言

擴充功能已內建繁體中文、簡體中文、英文、日文、韓文、法文、西班牙文、德文八種語言，不需要另行下載語言包。名稱、說明、收藏進度、區域勾選和完成／失敗提示依 Chrome 的介面語言顯示；不在八種語言內時顯示英文。語言字串在 `i18n.js`，Chrome 擴充資訊在 `_locales/*/messages.json`。切換 Chrome 介面語言後，重新載入擴充功能即可套用。

## 安裝

說明與下載同時提供於 https://climbio.app/redpoint-collect/ 和 https://climbio-dev.web.app/redpoint-collect/（ZIP 由 `build-site.sh` 從各分支的 `extension/` 打包）。自己開發：

1. Chrome 打開 `chrome://extensions`，開啟「開發人員模式」，「載入未封裝項目」選這個資料夾。擴充的 ID 由 `manifest.json` 的 `key` 固定（`clpjfehckclgenaackpklkceejlbcbnh`），紅點貓靠它連進擴充；自己換了 key 的話，在紅點貓頁面的 localStorage 設 `redpoint.extensionId`。Chrome 線上應用程式商店的版本沒有 `key`（商店不收），ID 由商店決定：拿到後填進 `redpoint/extension.js` 的 `STORE_EXTENSION_ID` 和 `studio/album.js` 的 `STORE_EXT_ID`，紅點貓與 Studio 依序試自行載入版、商店版。上傳商店的 ZIP 要拿掉 manifest 的 `key`。
2. 打開 theCrag 的岩場頁，按工具列的「紅點貓收藏」。收好後擴充自動打開紅點貓分頁（網址 `#collect`），頁面連進擴充把岩場拿過去、全部匯入。
3. 測試別的站（例如開發版）：在擴充的背景頁（`chrome://extensions` → 檢查 service worker）執行 `chrome.storage.local.set({ redpointUrl: 'https://climbio-dev.web.app/redpoint/' })`。
4. 帶到手機：電腦和手機連同一個 Wi-Fi，兩邊都開紅點貓，在「首頁右上頭像 → 同步到其他裝置」配對一次，收藏的岩場就會自動同步到手機（世界頁的「附近交換」是傳給別人，不會傳個人收藏）。

**更新**：擴充的檔案換了（例如 `git pull`），下載新版 ZIP、解壓縮取代舊擴充功能資料夾，再到 `chrome://extensions` 按「重新載入」。已安裝擴充的使用者按下圖示時，擴充會偵測到檔案變了，自己重新載入一次。

## 在紅點貓管理收藏

- 「匯出」先勾選岩場，再下載 `.climbio` 檔。內容包含照片、Topo 與攀爬紀錄，適合換裝置或自行保存；不會把未勾選岩場的資料放進檔案。
- 「匯入」從本機的 `.climbio` 檔選取岩場；其他本機岩場保留。
- 匯出的個人資料檔與分享包用途不同。要分享給其他人，請使用岩場或 Topo 的分享動作；分享包不含個人攀爬紀錄，個人收藏仍須遵守原網站授權，不能分享。

## 檔案

| 檔案 | 內容 |
|---|---|
| `manifest.json` | 擴充的設定：權限、固定的 ID（`key`）、允許哪些網站連進來（`externally_connectable`） |
| `background.js` | 按下圖示後的流程（讀頁面、抓圖、轉格式、交給紅點貓）與進度；紅點貓連進來時的服務 |
| `handoff.js` | 暫存收好的岩場（IndexedDB）、一塊一塊送給紅點貓（`serve`）；測試是 `tools/extension-handoff.test.mjs` |
| `sites.js` | 網站辨識與支援狀態 |
| `climbio-site.js` | 任何網站的 Climbio 格式出口的轉接器：找頁面的 `<link rel="climbio">`、讀各區有幾張 Topo、一個區要存什麼 |
| `hkclimbing.js` | 香港攀岩網站的轉接器：`extractPage` 在頁面裡讀路線文字與照片，`prepare` 轉成 v2（照片畫面）；照片下載好之後 `annotate` 讀號碼牌，標成路線號碼圖層 |
| `openclimbing.js` | OpenClimbing／OpenStreetMap 的轉接器：讀 OSM 與 Wikimedia Commons 的公開 API（路線、照片上的 Topo 線、照片授權） |
| `hash.js` | 內容指紋 |
| `thecrag.js` | `extractPage`（在頁面裡讀資料）、`convert`（轉成 v2 檔案）；轉換器的測試是 `tools/extension-thecrag.test.mjs` |
| `panel.js` | 頁面右下角的進度面板（注入頁面，Shadow DOM） |
| `icons/` | 工具列與擴充功能頁的圖示（16、32、48、128 PNG）：品牌原稿 `design/brand/cats/redpoint-cat.svg`（透明底的紅點貓標誌）渲染的，重新產生用 `node tools/extension-icons.mjs` |

紅點貓這一邊是 `redpoint/extension.js`（`pullCollected`：連進擴充、拿檔案、通知刪除）和 `redpoint/app.js` 的 `receiveCollected`（網址 `#collect` 時執行，全部匯入）。

權限：`activeTab`、`scripting`（只在按下時讀目前這一頁）、`storage`（記哪一個網站要收藏）、`https://image.thecrag.com/*` 等（抓 Topo 圖）。不要 `identity`：沒有登入。

## 加新網站

寫一個新的轉接器：`extractPage`（在頁面裡讀，要能單獨序列化）和 `convert`（回傳 `{ id, files, photos }`），並在 `background.js` 依網域選用。並確認來源與授權資料能妥善保留。
