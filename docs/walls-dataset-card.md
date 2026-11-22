---
license: cc-by-sa-4.0
pretty_name: Climbio Walls
language:
- zh
- en
tags:
- climbing
- hold-detection
- instance-segmentation
- bouldering
configs:
- config_name: walls
  data_files: walls.jsonl
---

# Climbio Walls

攀岩牆面的開放資料集：使用者在 [Climbio](https://climbio.app) 按「公開」的牆面照片、自動偵測的岩點外框、Wall 的人工精修記錄，以及大家在岩點貓定的路線。授權 CC BY-SA 4.0。

Open dataset of climbing-wall photos, detected hold outlines, human corrections from Climbio's Wall, and routes set in the Climbio app. CC BY-SA 4.0.

這個檔案（`README.md`）由 Climbio 的程式碼庫維護（`docs/walls-dataset-card.md`），不要直接在 Hub 上改。

## 快速使用

**先只下載目錄**，再決定要哪些牆：

```python
from huggingface_hub import hf_hub_download
import pandas as pd

walls = pd.read_json(hf_hub_download("climbio/walls", "walls.jsonl", repo_type="dataset"), lines=True)
reviewed = walls[walls.edits.apply(lambda e: bool(e and e["reviewed"]))]   # 人工逐顆檢查過的牆
```

`dir` 是這面牆最新版本的資料夾。只下載要的牆（不會抓到舊版本）：

```python
from huggingface_hub import snapshot_download

snapshot_download("climbio/walls", repo_type="dataset",
                  allow_patterns=[row.dir + "*" for row in reviewed.itertuples()] + ["walls.jsonl"])
```

## 檔案

```
walls.jsonl                      目錄：每面牆一行（最新版本）
stats.json                       統計（https://climbio.app/stats/ 讀這個檔）
walls/<牆包 id>/v<版本>/
  <牆 id>.jpg                    照片
  <牆 id>.thumb.jpg              縮圖
  <牆 id>.json                   Climbio Format v2 的牆（kind: view）：照片大小 w、h，nodes 裡 type 為 hold 的是岩點，帶外框多邊形
  <牆 id>.edits.json             精修記錄（Studio Wall 或岩點貓公開的牆，有修改才有）
  <圖層 id>.json                 路線圖層（岩點貓公開的牆有；內容固定、不含路線）
  index.json                     這個包的入口
walls/<牆包 id>/routes.json      大家在岩點貓定的路線（每天更新一次；不分版本；不含帳號）
research/hold-lab/<牆包 id>/       同一張照片各處理步驟（手機偵測、MobileSAM、SAM2、人工修正）的岩點外框與跟人工答案的比較；只有做過這項比較的牆才有
  stages.json                    各步驟的岩點外框，每顆外框的好壞（可用、切掉一角、外框太大、多認、漏掉），以及每 100 顆真實岩點裡外框可直接用幾顆；人工做了什麼（沒動、微調、重畫、手畫、刪除）
  photo.jpg                      比較用的照片（長邊 1600）
  summary.json                   有哪些步驟
                                 Hold Lab 展示頁（https://climbio.app/lab/hold-lab/）與 Studio Wall 的報告讀各步外框，數字自己重算
```

版本只增不減：同一面牆再發佈就是新的 `v<版本>/`，舊的留著。要最新的看 `walls.jsonl` 的 `dir`。

## walls.jsonl 的欄位

| 欄位 | 意義 |
|---|---|
| `id` | 牆包 id（資料夾名） |
| `name`、`gym` | 牆名、岩館（沒有就是空字串） |
| `version`、`t`、`dir` | 最新版本、發佈時間（毫秒）、資料夾 |
| `w`、`h` | 照片寬高（像素） |
| `holds` | 岩點數 |
| `photoBytes`、`photoSha256` | 照片大小、雜湊 |
| `edits` | 沒精修過是 `null`；否則 `{ reviewed, deleted, added, reshaped, flagged }`：是否逐顆檢查完、各類修正的數量 |
| `routes` | 匯出的路線數 |
| `license` | `CC-BY-SA-4.0` |

## edits.json：怎麼當訓練資料

只記「自動結果跟最後結果的差異」，不記編輯過程。

- 牆的 `<牆 id>.json` 是**最後結果**（人工修過之後）。自動結果 = 最後結果，拿掉 `added` 列的岩點，加回 `deleted` 的岩點（`{ id, poly }`，外框是自動的），再把 `reshaped` 的岩點外框換成它帶的自動外框（`{ id, poly, iou }`）。
- `deleted`：誤偵測（自動有、人工刪掉）。`added`：漏偵測（人工補的岩點 id 列表）。`reshaped`：外框不準（重疊 IoU 低於 0.9）；小修不記。三者都沒有的岩點就是自動結果跟最後結果一致。
- `flagged`：`{ 岩點 id: 旗標 }`，自動結果標為「要看」的岩點，沒改的也留著，用來校準信心。
- **`reviewed` 為 true 的牆，沒被改的岩點才能當正確答案**；沒有 `reviewed` 的牆，沒改的岩點只代表「沒人看過」。
- `tools` 記偵測與 SAM 模型版本，`sha256` 是照片雜湊。
- **手機精修**（岩點貓已不再上傳牆，只有以前公開的牆有這種記錄；現在的牆都由 Studio 發佈）：從岩點貓公開的牆，作者自己改過、手畫、刪掉的岩點也記成 edits.json（`tools.by` 是 `phone`，`reviewed` 一定是 false）。這種牆的 `<牆 id>.json` 維持自動結果，不是最後結果：`deleted` 帶自動外框，`reshaped` 的 `poly` 是自動外框，`added` 是手畫岩點 id，`final` 是 `{ 岩點 id: 最後外框 }`（改過的和手畫的）。

## 資料的來源與保管

- 收錄使用者主動確認公開的牆面；未公開的本機牆面不在資料集中。公開前確認「我有權公開」及開放授權。
- Climbio 保管公開的檔案，不因發佈者要求刪除；只有侵權、含可識別的個人、法令要求才移除（會重寫倉庫歷史）。
- 照片裡可能有人。發現請到 https://climbio.app 回報，我們會移除。
