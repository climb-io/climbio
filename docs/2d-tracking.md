# 2D 牆相機即時追蹤（可行性評估、實驗頁與接口規格）

本文件評估「僅憑一張 2D 牆面照片與岩點外框（`wall.json`），在手機瀏覽器本機即時認牆並將路線岩點疊回相機畫面」的可行性，並記錄實驗頁 `/lab/wall2d-cam/` 的實作、比對資料格式、量測數據、邊界防護與預計給岩點貓的接口。

## 可行性結論：**有條件可行**

在瀏覽器本機使用共用 OpenCV 4.10.0 WASM（`redpoint/vendor/opencv-4.10.0.js`），以 **「網格分層 AKAZE 粗篩＋精對 → `USAC_MAGSAC` 單應矩陣（Homography）＋ 幾何與空間分布防呆驗證 → 雙向 LK 光流維持 ＋ 空網格角點補充 ＋ 定期零漂移重錨」** 的管線，**已確認在技術與效能上可行**，不需伺服器、不需深度學習推論模型、不上傳影像，且每面牆的相機比對資料僅約 **144 KB**（不含影像）。

成立條件與限制如下：

1. **牆面近似單一主平面**：單應矩陣假設岩壁為平面；若牆面有大幅度多段折角（例如大角度 Roof／Cave 同時入鏡）或大顆立體 Volume（Volume）於大斜角側拍時，僅能精準對齊特徵佔比最高的平面，另一折面或高凸頂端會有視差偏移。
2. **比對資料須隨換線更新**：若岩館更換岩點或大幅更動壁面貼紙，舊的 `camera-*.json` 特徵會與現場不符，須隨新照片重新產生（在瀏覽器端即可算出，亦可用腳本預先建立）。
3. **本輪僅完成合成與模擬驗證，尚未實機現場測試**：手機實機面對真實岩牆時的自動對焦拉風箱、玻璃／燈管反光、手持運動模糊、iOS Safari／Android Chrome 實機熱降頻，仍須在手機實機上完成最終驗收。

---

## 實驗頁與運作流程

實驗頁位於 `/lab/wall2d-cam/`（`index.html`、`boot.js`、`app.js`、`style.css`、`manifest.json`），追蹤本身是通用元件 ArKit（[arkit/README.md](../arkit/README.md)：`view.js`、`tracker-worker.js`、`geometry.js`、`overlay.js`、`camera.js`、`tracking-log.js`、`view.css`），實驗頁只是接上開發工具的殼。岩點貓（正式版、測試版）整合 2D 牆的「AR 看線」（`js/edit.js`）。

```text
相機影格 (requestVideoFrameCallback 驅動；VideoFrame 轉移給 Worker，I420／NV12 直接取 Y 平面當灰階) / 模擬串流 (canvas 擷取)
  │  擷取尺寸長邊 640 px（認牆、重錨）；光流在 Worker 內縮成長邊 480 px，回報的單應矩陣換回 640 座標
  │
  ├─► [先開相機優先顯示] ?auto=1 於 boot.js 先行請求 getUserMedia，取得串流後立即畫出預覽，
  │                      OpenCV WASM 與比對資料（及岩點貓預載）於背景載入完成後才疊線
  │
  ├─► [有有效追蹤錨點] 雙向 LK 光流 (480 長邊, 15×15, 3 層金字塔, 10 次迭代, 最多 90 點, 雙向誤差 ≤ 1.5 px)
  │        └─► RANSAC 單應矩陣 ＋ 幾何／分布驗證
  │        └─► 8×6 空網格 Shi-Tomasi 補點 (映射回照片座標)
  │        └─► 背景 Worker 每 40～45 幀非同步 AKAZE 重錨修正漂移，不阻塞光流（失敗且 < 90 幀暫保留光流）
  │
  └─► [未定位 / 掉追蹤 (冷卻 180 ms)] 網格分層 AKAZE (查詢 ≤ 900 點)
           ├─► 多牆自動認牆時：前 320 點粗篩取前 2 面候選牆
           ├─► 精對 (Lowe ratio 0.78 ＋ 參考特徵一對一去重)
           └─► USAC_MAGSAC 單應矩陣 ＋ 凸四邊形／條件數／覆蓋率驗證
  │
  ▼
同幀對齊 (pendingSync 同一影格＋同一單應矩陣同時落畫；逾時 34 ms 放行並套用速度外推延遲補償)
  └─► 2D Canvas 僅繪製角色外圍柔和光暈（起攀綠、手點藍、腳點黃、完攀紅；大型 Volume 以整個 Volume 光暈為主，無外框線與 S/T 標籤）
  └─► 失去定位或超過 500 ms 未更新：立即清空畫布並隱藏光暈 (data-located="false")
```

預設收起工具並提供滿版預覽（`?ui=2&auto=1&wall=…&route=…` 行為與 `/3d/` 一致）；`auto=1` 時不顯示載入說明、開始按鈕，也不顯示右上的「工具」（`boot.js` 設 `data-embed`，出錯時也不出現；岩點貓的使用者看不到開發工具），直接請求並顯示相機畫面，OpenCV Worker 跟開相機同時載入，比對資料與 OpenCV 好了才開始追蹤疊光暈。直接打開實驗頁（沒有 `auto=1`）時點右上角「工具」可切換目標牆面（自動認牆／指定牆）、切換路線或顯示全部岩點、開啟「除錯外框」（預設關閉，供對齊檢視外框與 S/T 標記）、啟動內建「模擬測試」（9 秒平移／縮放／遮擋掉追蹤／恢復週期）、選取本機測試照片或影片、標記偏移／掉點，以及複製／下載追蹤紀錄 JSON。

---

## 相機比對資料格式與產生方法

比照 `docs/3d-tracking.md` 的 `climbio-3d-tracking/2` 與 `climbio-3d-tracking-camera/1`，將「只含幾何特徵、不含照片」的資料獨立成小檔：

### 1. 目錄檔 `climbio-2d-tracking/1`（`lab/wall2d-cam/manifest.json`）

記錄可用牆面清單、對應的 `wall.json`（與選填路線檔）、相機比對檔檔名、位元組大小、`sha256`、`photoW`/`photoH`、岩點數與特徵總數，`containsImages` 固定為 `false`。

### 2. 單牆相機比對檔 `climbio-2d-tracking-camera/1`（`camera-<wall>-<sha12>.json`）

| 欄位 | 說明 |
|---|---|
| `schema` | 固定 `"climbio-2d-tracking-camera/1"` |
| `wall` | 牆面識別字（對應 `manifest.json` 的 `wall`） |
| `photoW`, `photoH` | 對應 `wall.json` 岩點外框所依據的照片座標寬高（例如原岩萬華 2F 為 `3072×2461`） |
| `featureW`, `featureH` | 萃取特徵時使用的縮放尺寸（長邊 `1280 px`） |
| `detector`, `threshold`, `descriptorBytes` | `"AKAZE"`、`0.0005`、`61` |
| `coarseCount` | 前段全域均勻粗篩點數（預設 `320`） |
| `references[0]` | `{ id: "frontal", n: 1600, xy, desc }`：`xy` 為正規化 `[0..1]` 照片座標之 `Float32Array` Base64（`8n` bytes），`desc` 為 `Uint8Array` Base64（`61n` bytes） |

- **正規化座標設計**：`xy` 儲存 `[0..1]` 相對座標而非固定像素，因此即使發佈照片為了網路傳輸縮成 `1600×1282`（如 `demo/wanhua-wall.jpg`），而 `wall.json` 的多邊形座標仍為 `3072×2461`，載入時乘回 `photoW × photoH` 即可無縫對齊。
- **空間分層抽樣**：將影像切為 `8×6` 網格抽樣（最多保留 `1600` 點），並確保前 `320` 點平均分布於全牆，兼顧「近拍局部不失特徵」與「多牆快速粗篩」。
- **檔案大小**：目前已產生的 `camera-wanhua-054fe054d10b.json` 與 `camera-demo-dc4c1f20452d.json` 均為 **144.0 KB**（`147,427`–`147,439` bytes），不含任何圖片像素。
- **產生方法**：執行 `node tools/build-wall2d-camera.mjs`（透過無頭瀏覽器載入與執行期完全相同的 `redpoint/vendor/opencv-4.10.0.js` 與 `arkit/tracker-worker.js` 產出並計算 `sha256`）。另外 Worker 亦支援 `build_camera` 指令，可直接於使用者瀏覽器本機對未預建的新牆照片現場算出比對資料。

---

## 低階 Android 實機效能（2026-11-25）

手機：OPPO CPH2339（MediaTek MT6833、3.7 GB、Chrome 157）。追蹤用假相機串流（canvas `captureStream` 畫萬華牆並平移縮放，走跟真相機相同的 VideoFrame 路徑），開啟時間用真的後鏡頭。

| 項目 | 改動前 | 改動後 |
|---|---|---|
| 主執行緒擷取一幀（`drawImage`＋`getImageData`） | 約 65 ms（每幀卡住主執行緒） | 不在主執行緒做；Worker 取 VideoFrame Y 平面約 2 ms |
| Worker 每幀處理 p50 | 61 ms | 29.5 ms |
| 疊圖延遲 p50 / p95 | 89.5 / 115 ms | 40 / 57 ms |
| AR 疊圖畫一次（灰底、原色岩點、霓虹外框） | — | 2–3 ms（畫面 58–60 FPS、追蹤 18–23 Hz） |
| 20 秒內處理的影格數 | 169 | 313 |
| 相鄰幀外框角點位移 p95（越小越穩） | 11.6 px | 6.5 px |
| 開相機到 OpenCV 就緒 | 約 2.8 秒 | 約 1.1 秒 |

- 慢的原因：Android Chrome 把相機畫面畫進可讀回的 canvas 再 `getImageData` 很貴，跟擷取尺寸無關（640、480 長邊都約 65 ms）；`createImageBitmap` 後再讀回也一樣（約 50 ms）。`new VideoFrame(video)` 的格式是 I420，`copyTo` 約 1.6 ms。
- LK 光流的成本：640 長邊、21×21 視窗、140 點約 26 ms／次（雙向兩次）；480 長邊、15×15、10 次迭代、90 點約 12 ms／次。補角點（`goodFeaturesToTrack`）640 長邊約 29 ms、480 長邊約 17 ms，改成點數夠就不補。
- 這支手機要求直的寬高時第一幀是橫的，舊版每次開都要關掉重開（約 0.8 秒）；現在判斷過一次就記在 `localStorage`（`climbio.wall2dCamReversed`），`boot.js` 下次直接用對的寬高開。
- 私人牆第一次打開要在手機上算比對資料（AKAZE，1280 長邊）約 2.5 秒，算好存在 IndexedDB（`climbio-wall2d-cam`），之後不再算。
- 預覽和送去追蹤的影像只從 `<video>` 拿一次（同一格）：以前分兩次拿，偶爾差一格，移動中外框會跳 5–30 px；改完後對準測試（p95 < 3 px）12 次全過。iPhone 的 Safari 不用 VideoFrame（建了之後預覽會變黑）。
- 疊圖跟影格同步：Worker 結果回來前先留著這一幀的預覽（等待上限依實際處理時間 34–70 ms）；超過才放行，晚到的結果照移動速度外推到現在再畫，不畫回舊位置。

## 實驗量測結果

紀錄格式為 `climbio-2d-tracking-log/1`（`arkit/tracking-log.js`），欄位、百分比統計（`p50`/`p95`/`max`）、最近 240 筆序列／診斷摘要與隱私限制（不含照片、影格像素、音訊或相機 `deviceId`/`groupId`）皆比照 `docs/3d-tracking.md`。

### A. 單幀定位與嚴苛條件測試（真實 `arkit/tracker-worker.js` + OpenCV 4.10.0 WASM）

在桌面無頭 Chromium 對 `demo/wanhua-wall.jpg`（254 個岩點多邊形）與 `demo/demo.jpg`（94 個岩點多邊形）施加透視變形、縮放、光影與遮擋，並開啟多牆自動認牆（`targetWall: 'auto'`）：

| 測試情境 | 目標／辨識牆 | 內點數 | 岩點多邊形誤差 p50 / p95（px，於 640px 寬度） | 推論耗時（ms） |
|---|---|---|---|---|
| 萬華 正面原比例（640×480） | wanhua / wanhua | 532 | 0.12 / 0.18 | 165 |
| 萬華 近拍放大 0.45× | wanhua / wanhua | 241 | 0.15 / 0.33 | 136 |
| 萬華 極近拍角落 0.28×（僅約 8% 面積） | wanhua / wanhua | 49 | 0.63 / 1.16 | 127 |
| 萬華 遠拍縮小 1.4× | wanhua / wanhua | 278 | 0.17 / 0.26 | 133 |
| 萬華 直式手機構圖（360×640） | wanhua / wanhua | 228 | 0.23 / 0.36 | 119 |
| 萬華 側拍水平偏轉 Yaw 30° | wanhua / wanhua | 215 | 0.12 / 0.32 | 129 |
| 萬華 側拍水平偏轉 Yaw 45° | wanhua / wanhua | 155 | 0.19 / 0.43 | 131 |
| 萬華 側拍極限偏轉 Yaw 55° | wanhua / wanhua | 87 | 0.11 / 0.96 | 166 |
| 萬華 仰拍俯仰 Pitch 35° | wanhua / wanhua | 260 | 0.14 / 0.20 | 130 |
| 萬華 偏暗低對比（-55 亮度, ×0.65 對比） | wanhua / wanhua | 302 | 0.15 / 0.24 | 108 |
| 萬華 過曝高對比（+55 亮度, ×1.25 對比） | wanhua / wanhua | 424 | 0.15 / 0.25 | 121 |
| 萬華 強對角陰影漸層（0.45×～1.3×） | wanhua / wanhua | 471 | 0.15 / 0.22 | 107 |
| 萬華 動態模糊（Gaussian 9×9） | wanhua / wanhua | 436 | 0.20 / 0.34 | 113 |
| 萬華 人物遮擋 45% 寬度 | wanhua / wanhua | 244 | 0.12 / 0.22 | 110 |
| 萬華 人物遮擋 65% 寬度 | wanhua / wanhua | 117 | 0.34 / 0.77 | 98 |
| 萬華 複合測試（30° 側拍＋偏暗＋35% 遮擋） | wanhua / wanhua | 101 | 0.12 / 0.28 | 120 |
| 示範牆 正面（430×640） | demo / demo | 546 | 0.21 / 0.25 | 153 |
| 示範牆 側拍 Yaw 35° | demo / demo | 255 | 0.28 / 0.40 | 149 |
| 負例：4×4 重複紋理拼貼（對抗重複圖案） | 拒斥（`insufficient_matches`） | 0 | — | — |
| 負例：鎖定 `demo` 卻輸入 `wanhua` 畫面 | 拒斥（`insufficient_matches`） | 0 | — | — |

- 18/18 正例皆 **100% 認出正確牆面**且中位外框誤差 `< 0.65 px`（95 分位 `≤ 1.16 px`）；2/2 負例 **0 誤報**。

### B. 連續序列與 `/lab/wall2d-cam/` 頁面實測（1× 與 4× CPU 降速）

1. **90 幀連續運鏡序列（75 幀平移＋縮放＋搖晃 ＋ 15 幀 94% 遮擋）**：
   - 可見幀定位成功率：**75 / 75（100%）**
   - 光流每幀耗時：`p50 11.2 ms`、`p95 12.1 ms`
   - 定位／重錨耗時：`p50 131.9 ms`
   - 岩點外框真實誤差：`p50 0.22 px`、`p95 0.31 px`、`max 0.31 px`
   - 遮擋恢復重定位耗時：`141 ms`

2. **`/lab/wall2d-cam/` 頁面 `TrackingLog2d` 實測（9.5 秒模擬掃視，內含 1.5 秒全遮擋）**：

| 指標 | 1× CPU（桌面 Chromium） | 4× CPU 降速（模擬中低階手機） |
|---|---|---|
| 執行期載入（`runtimeReadyAfterStreamMs`） | 210 ms | 220 ms |
| 初次定位（`firstPoseAfterStreamMs`） | 370 ms | 400 ms |
| 追蹤有效影格比例（含 1.5s 遮擋段） | 81.2%（384 / 473） | 76.1%（289 / 380） |
| 外框可見時間比例 | 77.4% | 77.4% |
| 延遲 `latencyMs`（p50 / p95 / max） | 9.9 / 14.9 / 161.6 ms | 14.8 / 28.1 / 176.0 ms |
| Worker 耗時 `processingMs`（p50 / p95 / max） | 7.3 / 12.1 / 157.9 ms | 7.2 / 12.7 / 164.3 ms |
| 特徵重投影誤差 `featureErrorPx`（p50 / p95） | 0.48 / 0.58 px | 0.53 / 0.65 px |
| 繪圖幀率 `renderFps`（p50） | 59.6 FPS | 59.0 FPS |
| 遮擋後重定位（含 1.5s 遮擋期間＋350ms 冷卻） | 1860 ms | 1840 ms |

3. **同幀對齊、背景重錨與移動追蹤對比（30fps 模擬手機運鏡，412×915 螢幕 CSS 像素誤差）**：

| 指標 | 改動前（1× / 4× CPU） | 改動後（1× / 4× CPU） |
|---|---|---|
| 移動中位置誤差 `p50` | `9.15 px` / `12.95 px` | **`0.52 px`** / **`0.31 px`** |
| 移動中位置誤差 `p95` | `24.94 px` / `29.59 px` | **`1.17 px`** / **`1.62 px`** |
| 移動中最大誤差 `max` | `46.77 px` / `48.07 px` | **`2.44 px`** / **`1.88 px`** |
| 點擊「AR 看線」到發起 `getUserMedia`（1× / 4× CPU） | `50 ms` / `81 ms` | **`24 ms`** / **`60 ms`** |
| 相機權限與硬體就緒後到第一格畫面（含 30fps 串流首幀等待） | `266 ms` / `398 ms`（未預載 OpenCV／無早開） | **`268 ms`** / **`348 ms`**（含模擬硬體 `~198 ms`，不被 OpenCV／比對資料阻塞） |

---

## 邊界與誤比對防護

1. **重複圖案抑制（同色岩點、同寬膠帶、螺絲孔陣列）**：
   - **Lowe Ratio Test（`0.78`）＋ Hamming 上限（`140`）**：相同紋理在不同位置會產生距離相近的第一與第二鄰居而被自然篩掉。
   - **參考特徵一對一去重（`bestByTrain`）**：同一顆參考特徵點只接受距離最小的一筆查詢點配對，防止大量重複圖案多對一吸納進 RANSAC。
   - **雙向空間擴散檢核**：要求內點在查詢畫面涵蓋 `≥ 4%` 面積且分布於 `6×4` 網格的 `≥ 4` 格，在參考照片涵蓋 `≥ 2%` 面積，避免全數擠在一顆岩點或一條膠帶上產生病態變換。
   - **幾何合理性閘門（`verifyHomography`）**：對查詢四角反投影回參考平面，檢查皆在鏡頭前方（`w > 1e-4`）、為嚴格凸四邊形且未鏡像翻轉，並檢查局部雅可比條件數 `cond ≤ 4.5`、單幀中位誤差 `≤ 4.5 px`（光流模式收緊至 `≤ 3.5 px`）。
2. **失去定位隱藏過期外框**：
   - 任何一幀光流失敗（存活 `< 16` 點或未過幾何檢查），或主執行緒距上次有效結果超過 `500 ms`（`STALE_MS`），立即清除疊合畫布並將 `data-located` 設為 `"false"`，絕不在畫面上殘留過期位置。
3. **跨牆切換與零漂移**：
   - 鎖定特定牆面或切換目標牆面時立即遞增 `trackingEpoch` 並重置光流狀態；連續追蹤每 `35` 幀或原始 AKAZE 錨點少於 `10` 顆時自動執行重錨，避免長期依賴 `goodFeaturesToTrack` 累積漂移。

---

## 岩點貓整合與接口

仿照 `docs/3d-tracking.md`「接口」的設計，岩點貓（正式版、測試版）看 2D 牆路線圖時，右上「⋯」選單（`#vwCam`）開啟全螢幕 `#camView`／`#camFrame` 載入 `/lab/wall2d-cam/?ui=2&auto=1&wall=<牆 id>&route=<岩點 id>:<角色>,…`。看路線圖時只預先抓追蹤頁的小程式，打開「⋯」才預先抓 OpenCV 與比對資料（省流量模式不抓）。

1. **呼叫方式**：
   - `/lab/wall2d-cam/?ui=2&auto=1&wall=<牆 id>&route=<岩點 id>:<角色>,…`（角色為 `s` 起攀、`h` 手點、`f` 腳點、`t` 完攀；`auto=1` 一進入即開相機，不顯示開始按鈕或過渡載入說明，比對資料載好前照常顯示相機畫面）。
   - 本機未預建比對資料的私人 2D 牆：`/lab/wall2d-cam/` 於同源 iframe 送出 `climbio-wall2d-request`，由岩點貓（`js/edit.js`）透過同源 `postMessage` 回傳 `climbio-wall2d-data`（外框多邊形、尺寸與本地照片 `Blob`），再由 Worker 的 `build_camera` 本機計算 `climbio-2d-tracking-camera/1` 並快取於 IndexedDB（`climbio-wall2d-cam`），私人照片不離開裝置。
   - **AR 看線的換線訊息**（同源 `postMessage`，2026-11-25 新增；沒收到時照網址的 `route` 畫一條，舊的呼叫方式照常可用）：
     - 追蹤頁 → 岩點貓：啟動時 `climbio-ar-hello`；`climbio-ar-state`（`located` 認到牆、`running`、`error`），岩點貓據此顯示「對準牆面」、出錯時收起手勢層。
     - 岩點貓 → 追蹤頁：`climbio-ar-routes`（`routes: [{ id, holds: [[岩點 id, 角色, 出手順序]], seq }]`、`index`、`labels: { s, t }` 起攀／完攀標籤文字）；`climbio-ar-drag`（`p`：拖到相鄰路線的比例 -1..1，正＝下一條）；`climbio-ar-index`（`index`、`dir`）換線。
     - 私人牆的 `climbio-wall2d-data` 送整面牆所有路線用到的岩點，換線不用再要資料。3D 追蹤頁沒有這些訊息：岩點貓換線時換網址重新載入。
   - 外觀與動畫在 `arkit/overlay.js`（只負責畫）；認到牆時相機畫面轉灰調暗、路線岩點用原色畫回來（`arkit/view.css`）；「工具」的除錯外框照舊。
2. **資料契約**：
   - 岩點與牆尺寸直接讀取既有牆面資料（支援 `climbio: 2` 的 `marks`＋`nodes` 及 `wall.holds`）。
   - 相機比對資料採用 `climbio-2d-tracking-camera/1`（目錄 `climbio-2d-tracking/1`），不含影像。

---

## 已驗證與未驗證清單

### 已驗證

- `tools/tracking2d.test.mjs`（Node 單元測試）：`manifest.json` 與 `camera-*.json` 的 `sha256`、位元組大小、`containsImages === false`、座標長度；`wanhua-wall.json`／`demo.json`／`?route=` 解析；`verifyHomography` 擋下局部群聚與鏡像翻轉；`markVolumeHolds` 大型 Volume（`≥ 8×` 中位數）標記與 `extrapolateHomography` 延遲補償；`TrackingLog2d` 分段、掉追蹤、過期隱藏與裝置識別碼排除。
- 真實 `arkit/tracker-worker.js`（Chromium OpenCV 4.10.0 WASM）：18 項合成透視／縮放／光影／遮擋／跨牆正例全數通過、2 項負例拒斥、90 幀連續運鏡與重定位量化量測、1× 與 4× CPU 降速即時 `TrackingLog2d` 統計。
- `tests/e2e/lab-wall2d-cam.spec.mjs` 與 `tests/e2e/cam-view.spec.mjs`（Playwright `android-chromium` Pixel 7 與 `ios-webkit` iPhone 13）：頁面啟動、模擬掃視自動認牆與 Canvas 疊圖繪製、遮擋掉追蹤立即隱藏、恢復後重定位；OpenCV WASM 與 `manifest.json` 延遲時相機畫面先出、載好才疊光暈；逐像素驗證岩點內透明無 S/T 標籤、外圍呈角色色光暈、除錯外框開關預設關；移動運鏡位置誤差 `p95 < 3 px`；岩點貓測試版預載與正式版不載入相關程式。

### 未驗證（須手機實機與現場環境驗證）

- 手機實機（iOS Safari / Android Chrome）開啟後置主鏡頭對準真實岩牆（含原岩萬華 2F）之初次定位成功率、畫面映射與肉眼對齊精度。
- 真實岩館多變光源（場館燈具反光、強陰影、白平衡偏移、自動曝光切換）與相機自動對焦晃動下之實際表現。
- 真實極厚凸出岩塊／多面折角牆在側角度站位時的視差對位誤差。
- 面對大量極相似同色空板（幾乎無明顯紋理或僅有重複螺絲孔之單色牆面）時的實拍拒斥率。
