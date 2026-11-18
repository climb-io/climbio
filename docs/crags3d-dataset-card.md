---
license: cc-by-sa-4.0
pretty_name: Climbio Crags 3D
language:
- zh
- en
tags:
- climbing
- bouldering
- 3d
- gaussian-splatting
configs:
- config_name: crags3d
  data_files: crags3d.jsonl
---

# Climbio Crags 3D

天然岩場的 3D 模型（高斯潑濺 .spz）和模型上的路線標記，來自 [Climbio 紅點貓](https://climbio.app/redpoint/) 的 Guidebook。授權 CC BY-SA 4.0。

3D models (Gaussian splats, `.spz`) of natural crags and the route marks on them, from Climbio Redpoint Cat guidebooks. CC BY-SA 4.0.

這個檔案由 Climbio 的程式碼庫維護（`docs/crags3d-dataset-card.md`），不要直接在 Hub 上改。

## 檔案

```
crags3d.jsonl          目錄：每個岩場一行
crags3d/<id>/
  index.json           入口（Climbio Format v2，type: crag3d）：岩場節點與兩個項目
  <模型 id>.json        模型畫面（kind: view，surface: model）：href 指到 .spz，帶 sha256
  <圖層 id>.json        模型上的路線標記（kind: layer，on 指到模型畫面）
  model-<雜湊>.spz      3D 模型（SPZ 壓縮的高斯潑濺）
```

`id` 跟 [climbio/crags](https://huggingface.co/datasets/climbio/crags) 裡同一個岩場的資料夾相同（`origin` 欄位也記著）：Guidebook 裡的模型原樣留著給紅點貓用，這裡是只含 3D 的一份，方便研究下載。

## crags3d.jsonl 的欄位

`id`、`name`、`t`、`version`、`dir`、`files`、`bytes`、`at`（岩場位置）、`license`、`attribution`、`origin`（對應的 Guidebook）。

## 授權與保管

- 依 CC BY-SA 4.0，要署名並以相同方式分享。
- 發佈者下架只是從 Climbio 的清單拿掉，資料集的檔案保留給研究；只有侵權、含可識別的個人、法令要求才移除（會重寫倉庫歷史）。
