# 岩館清單

`gyms/` 是全球室內岩館的名稱與座標，每個國家一個檔 `gyms/<國碼>.json`（`[[名稱, 緯度, 經度], …]`，國碼是 ISO 3166-1 小寫，座標到小數 4 位約 10 公尺）；`gyms/index.json` 是各國岩館的範圍（`[國碼, 南, 西, 北, 東]`，按 10 度的格子分開、往外多 0.3 度約 30 公里）。

App 只載入位置所在的國家（範圍包住位置的那幾國，國界附近會載到隔壁國家）：

- 新增牆面：300 公尺內最近的一間就是這面牆的岩館。
- 岩館選單：30 公里內的依距離排；搜尋時才載入全部國家，從全部岩館找名稱。
- 找牆面：附近岩館的距離。

位置只在手機上比對，不送出。Service Worker 安裝時只存 `gyms/index.json`，國家的檔第一次用到時下載並存起來。

## 順序

台灣的檔（`gyms/tw.json`）從北到南排，同一個系列（`tools/gyms/tw.json` 的 `series`，例如原岩、角、紅石、double 8、WUSA、iClimb、B-plus）放在一起：整組放在它最北那間該在的位置，組內再從北到南（`tools/gym-order.mjs`）。App 沒有定位時照這個順序列（岩館選單的搜尋結果、找牆面的泡泡），Studio 的岩館建議清單也是；有定位時照舊近的在前。新增台灣岩館時，同一個系列的記得填 `series`。其他國家照 OpenStreetMap 的資料，沒有特別排。

## 來源

`node tools/gyms.mjs` 產生，不要手改 `gyms/`：

- **台灣**：自己整理的 `tools/gyms/tw.json`（簡稱、門牌、館方地址來源、座標用的資料集）。座標是館方公布的門牌對縣市政府的門牌位置開放資料（政府資料開放授權條款第 1 版）；宜蘭縣沒有公開門牌座標，用 OpenStreetMap 上同一個門牌的點。台灣的 OpenStreetMap 岩館不收（過時、缺漏）。岩館開關、搬家改這個檔再重新產生。
- **其他國家**：OpenStreetMap（ODbL）裡 `sport=climbing`、`leisure=sports_centre／fitness_centre／sports_hall` 而且有名稱的；所在國家用 Overpass 查行政區，不在任何國家的放 `zz`。

不能用 Google 地圖、TGOS、國土測繪中心的 API 或其他授權不允許再散布的資料。出處標在 `about.html` 的頁尾。

`gyms/` 和 `tools/gyms/` 是從 OpenStreetMap 衍生的資料庫，不適用 repo 的 AGPL-3.0，以 ODbL 1.0 提供（`gyms/LICENSE`）。

## 名稱就是識別

牆面的 `w.gym`、分享的路線、找牆面都用名稱認岩館，所以名稱不能變：

- `tools/gyms/osm.json` 記 OSM 編號（`n`／`w`／`r` 開頭）對 `[名稱, 國碼]`，重新產生時沿用（OSM 改名也不變）。
- 新的岩館跟別的同名，加城市「名稱（城市）」：OSM 有 `addr:city` 就用，沒有就查所在的行政區；還是同名再加編號。

## 更新

```bash
node tools/gyms.mjs
```

從 Overpass 下載（約 2.6 MB；伺服器忙會自動等一下重試），新的岩館要查國家和城市，幾分鐘到十幾分鐘；也可以 `--osm 下載好的.json`。產生後看 diff：消失的多半是 OSM 上刪掉或改了標籤，沒問題就提交。
