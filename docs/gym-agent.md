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

用公開路線寫入（作者金鑰簽章，見 [sharing.md](sharing.md) 的編輯權限）發佈到同一面牆，路線 id 不變、依修改時間更新。

岩館的 App 有很多使用者時，用**一把固定的代發金鑰**簽章（同一把金鑰發的線只有它能更新、刪除），每條線的 `author` 帶各自的岩友暱稱、`u` 是固定的代發 id。沒有網頁可以拿 App Check 權杖，所以代發要有擁有者身分（金鑰由 Climbio 維護者核發）。工具：`node tools/wall-routes.mjs`（`keygen` 產生金鑰、`put` 寫入或更新、`del` 刪除、`unpublish` 下架整面牆）。每面牆上限 1000 條、一把金鑰一天 600 次寫入、一次最多 100 條。

## 擁有者與接手

公開牆的擁有者是**發佈金鑰**（一個檔案，沒有帳號）：第一次用 Studio 或 `node tools/studio.mjs publish` 發佈時產生，之後重新發佈、下架、轉交都用同一把。岩館換 AI 代理：新代理 `node tools/wall-routes.mjs kid --key <金鑰檔>` 取得 kid，現在的擁有者執行 `node tools/wall-routes.mjs transfer <包 id> <新 kid>`（或直接把金鑰檔交過去）。細節見 [studio-wall.md](studio-wall.md)。

## 下架

牆 90 天沒有任何更新（發佈或寫線）會自動從找牆面拿掉；要提早下架由擁有者執行 `node tools/wall-routes.mjs unpublish <牆 id> --key <金鑰檔>`（Studio 發佈清單也有「下架」；維護者也可以）：拿掉入口和所有人的線，資料集已公開的檔案留著，重新用 Studio 發佈同一個牆 id 就回來。
