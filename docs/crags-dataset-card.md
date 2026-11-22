---
license: cc-by-sa-4.0
pretty_name: Climbio Crags
language:
- zh
- en
tags:
- climbing
- bouldering
- guidebook
- topo
configs:
- config_name: crags
  data_files: crags.jsonl
---

# Climbio Crags

天然岩場的開放資料集：岩壁照片、路線線條（Topo）、岩場的位置與結構。這是 [Climbio 紅點貓](https://climbio.app/redpoint/) 的 Guidebook，授權 CC BY-SA 4.0。

Open dataset of natural crags: wall photos, topo lines, and crag structure and location, as published in the Climbio Redpoint Cat guidebooks. CC BY-SA 4.0.

這個檔案由 Climbio 的程式碼庫維護（`docs/crags-dataset-card.md`），不要直接在 Hub 上改。

## 快速使用

```python
from huggingface_hub import hf_hub_download, snapshot_download
import pandas as pd

crags = pd.read_json(hf_hub_download("climbio/crags", "crags.jsonl", repo_type="dataset"), lines=True)
snapshot_download("climbio/crags", repo_type="dataset", allow_patterns=[crags.dir[0] + "*"])   # 只抓一個岩場
```

紅點貓直接讀 `crags/<id>/index.json`，所有檔案都在同一個資料夾，用相對路徑互相指。

## 檔案

```
crags.jsonl            目錄：每個岩場一行
stats.json             統計（在 climbio/walls 的 stats.json，https://climbio.app/stats/ 讀它）
crags/<id>/
  index.json           入口（Climbio Format v2，kind: set，type: guidebook）：岩場、岩壁、Topo 的清單
  <id>.json            岩壁（kind: view，照片與岩點）、Topo（kind: layer，路線線條）…，格式見 docs/route-format.md
  <id>.jpg …           照片
  <id>.thumb.jpg …     每張照片的縮圖（長邊 480 像素）
  preview.jpg、thumb.jpg  預覽圖與縮圖
  source/              轉換路線書的原始檔（只有從路線書轉換的岩場有）：轉換時選的檔案、按建立時的大綱 outline.md、
                       換成原圖的那張路線書圖 fig-*、轉換紀錄 convert.json；App 不讀，拿來重跑轉換（tools/guidebook.mjs rerun）
openclimbing/index.json  OpenClimbing 岩場的索引（紅點貓的世界）
openclimbing/<OSM relation id>/
  topo.json            岩場的 Topo：路線、線條、Commons 照片的資訊（建索引時已驗證授權與網址）
  preview.jpg、thumb.jpg  預覽圖與縮圖
  credits.json         每張照片的標題、作者、授權、Commons 頁面
```

`openclimbing/` 不適用上面的 CC BY-SA 4.0：路線與岩場來自 OpenStreetMap（© OpenStreetMap contributors，ODbL 1.0），照片只收 Wikimedia Commons 上 CC 與公眾領域的，作者與授權逐張記在 `credits.json`。

網址固定（沒有版本資料夾）；岩場更新時直接換檔案，歷史版本在這個倉庫的 git 紀錄裡（可用 `revision=` 指定 commit）。

## crags.jsonl 的欄位

| 欄位 | 意義 |
|---|---|
| `id` | 岩場包 id（資料夾名） |
| `name`、`t` | 名稱、最後更新時間（毫秒） |
| `dir` | 資料夾，例如 `crags/<id>/` |
| `files`、`bytes`、`photos` | 檔案數、總大小、圖片檔數（含 `preview.jpg`、`thumb.jpg`，不含每張照片的縮圖） |
| `thumbs` | 縮圖數（每張照片一張） |
| `at` | 岩場位置 `[經度, 緯度]`（沒有是 `null`） |
| `license`、`attribution` | 授權、署名（原作者；改編的會註明） |
| `origin` | 改編自哪個岩場包（原創是空字串） |
| `source` | 有原始檔（`source/`）時才有：`{ files, bytes }`；上面的 `files`、`bytes`、`photos` 不含原始檔 |

## 授權與署名

- 依 CC BY-SA 4.0，要標示 `attribution`（每個岩場自己的署名，通常是原作者）並以相同方式分享。
- Climbio 已取得原作者同意，轉成開放格式公開。
- 照片裡可能有人。發現請到 https://climbio.app 回報，我們會移除。
- 發佈者下架只是從 Climbio 的清單拿掉，資料集的檔案保留給研究；只有侵權、含可識別的個人、法令要求才移除（會重寫倉庫歷史）。
