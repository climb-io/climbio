# 給岩館 AI Agent：和 Climbio 共享牆與路線

岩館有 Agent 和後端時，照下面做。沒有的，直接用 Studio 發佈公開。要把岩點貓的看線、定線畫面放進自己的 App，固定先用 Studio 精修並發布牆面，再照 [embed.md](embed.md) 的三步做：路線和岩點貓一樣寫進同一面公開牆，用固定的牆 id 與代發金鑰更新（下面第三節），App 用 `<iframe>` 或 WebView 載入內嵌頁、`init` 給網址；App 的使用者如何對應到路線，由 App 自己決定。適合願意和岩友一起分享路線的岩館（牆面與路線公開，CC BY-SA 4.0）。格式與端點的完整規格在 [route-format.md](route-format.md)；資料是 Climbio 公開格式 v2（[format/README.md](../format/README.md)）。

## 一、讓岩點貓、紅點貓看到你的牆

做法一（最簡單）：用 Studio 把牆發佈公開，就完成了。

做法二（牆在自己的站）：

1. 在 `https://<你的站>/climbio.json` 放一個 `type: site` 的組合，`props.url` 是站的網址、`props.listed: true`，每間有公開牆面的岩館一項（`href` 指到岩館清單，清單裡一項是一面牆）。檔案要過 `ClimbioFormat.validate`，https，回 `Access-Control-Allow-Origin: *`。
2. 登記一次：`POST https://climbio.app/dir/register`，內容 `{ "url": "https://<你的站>" }`。總目錄自動驗證，不用帳號、不用審核；每天自動複查，連續 7 天讀不到或改成 `listed: false` 才移除。

## 二、拿到岩友在你的牆上定的路線

分享就是全部公開：牆公開了，岩友在這面牆定好的路線存線後就自動公開（可以刪自己的路線）（CC BY-SA 4.0，署名暱稱），沒有別的選項、不逐條同意。

- 整面牆：`GET https://climbio.app/w/<牆 id>/routes.json`（每天更新一次，快取十分鐘）。
- 單條：`GET https://climbio.app/r/<牆 id>/<路線 id>/route.json`。

兩者都是公開格式 v2 的路線圖層，用 `ClimbioFormat.validate` 檢查。牆 id 就是牆畫面的 `id`，各處同一個。顯示時依 CC BY-SA 4.0 署名。

## 三、把你的路線給岩點貓的使用者

**最簡單：用內嵌頁直接提交**（不需要任何金鑰）：使用者在內嵌的定線畫面定好線，你的 App 送 `submit`，路線就寫進這面公開牆，身分是你的網站來源，你的網站可以更新、刪除自己名下的全部路線。做法見 [embed.md](embed.md)。

下面的代發金鑰是給**大量匯入舊路線、由維護者操作**的做法，一般整合用不到。用公開路線寫入（作者金鑰簽章，見 [sharing.md](sharing.md) 的編輯權限）發佈到同一面牆，路線 id 不變、依修改時間更新。

有很多使用者的 App 大量匯入時，用**一把固定的代發金鑰**簽章（同一把金鑰發的線只有它能更新、刪除），每條線的 `author` 帶各自的岩友暱稱、`u` 是固定的代發 id。沒有網頁可以拿 App Check 權杖，所以代發要有維護者身分（代發金鑰由 Climbio 維護者核發）。工具：`node tools/wall-routes.mjs`（`keygen` 產生金鑰、`put` 寫入或更新、`del` 刪除、`unpublish` 下架整面牆）。每面牆上限 1000 條、一把金鑰一天 600 次寫入、一次最多 100 條。

## 牆面的處理與更新

要整合的第一步常常是先處理牆面：照片用 Studio 偵測岩點、精修、檢查後發布（命令列：`node tools/studio.mjs start gym <資料夾> <照片…>`，照它印的下一步走）。之後牆面有調整，在 Studio 用同一面牆重新發布就是新版本，舊路線照舊；換了照片就當成新的一面牆（新的牆 id），App 要切換到新 id。完整說明見 [embed.md](embed.md) 的「牆面的處理與之後的更新」。

## 牆沒有擁有者

牆不記擁有者、不用發佈金鑰：任何人用 Studio 都能發佈新版本，岩點貓看到哪一版由程式自動判定（見 [studio-wall.md](studio-wall.md)）。岩館換 AI 代理不用交接牆；路線的代發金鑰（上面的 `keygen`）換一把就好。想固定在某一版，內嵌的網址用那一版的網址。

## 下架

牆 90 天沒有任何更新（發佈或寫線）會自動從找牆面拿掉；要提早下架請聯絡維護者（`node tools/wall-routes.mjs unpublish <牆 id>`）：拿掉入口和所有人的線，資料集已公開的檔案留著，重新用 Studio 發佈同一個牆 id 就回來。
