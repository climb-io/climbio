---
license: cc-by-sa-4.0
pretty_name: Climbio Walls 3D
language:
- zh
- en
tags:
- climbing
- bouldering
- 3d
- gltf
configs:
- config_name: walls3d
  data_files: walls3d.jsonl
---

# Climbio Walls 3D

室內岩館牆面的 3D 資料：用多張照片重建的模型、面標籤、岩點標註、沿牆鏡頭，是 [Climbio](https://climbio.app) Studio 3D Lab 發佈的成品。授權 CC BY-SA 4.0。

3D models of indoor climbing walls reconstructed from photos, with face labels, hold annotations and a walking camera path, published from Climbio Studio 3D Lab. CC BY-SA 4.0.

這個檔案由 Climbio 的程式碼庫維護（`docs/walls3d-dataset-card.md`），不要直接在 Hub 上改。

## 快速使用

```python
from huggingface_hub import hf_hub_download, snapshot_download
import pandas as pd

walls = pd.read_json(hf_hub_download("climbio/walls3d", "walls3d.jsonl", repo_type="dataset"), lines=True)
snapshot_download("climbio/walls3d", repo_type="dataset", allow_patterns=[walls.dir[0] + "*"])   # 只抓一面牆
```

## 檔案

```
walls3d.jsonl          目錄：每面牆一行
walls3d/<id>/
  index.json           入口（Climbio Format v2，type: wall3d，pack 指到 wall.json）
  wall.json            牆的資料（岩點、面、修點、設定）
  wall-<雜湊>.glb      岩面模型（glTF）
  faces-<雜湊>.bin、labels-<雜湊>.bin、overlay-<雜湊>.bin   面的分割、標籤、岩點疊圖
  snapshot-<雜湊>.jpg  正面快照；intro-<雜湊>.jpg 與 .bin 是進場畫面
  walk-<雜湊>.json     沿牆鏡頭的軌道
  <名>.thumb.jpg       每張照片的縮圖（長邊 480 像素）；thumb.jpg 是牆的縮圖
```

網址固定、不分版本；牆更新時直接換檔案，歷史在這個倉庫的 git 紀錄裡。格式細節見 Climbio 程式碼庫的 `docs/3d-wall.md`。

## walls3d.jsonl 的欄位

`id`、`name`、`gym`、`t`、`version`、`dir`、`files`、`bytes`、`photos`（圖片檔數）、`thumbs`、`license`、`attribution`、`origin`。

## 授權與保管

- 依 CC BY-SA 4.0，要署名並以相同方式分享。
- 發佈者下架只是從 Climbio 的清單拿掉，資料集的檔案保留給研究；只有侵權、含可識別的個人、法令要求才移除（會重寫倉庫歷史）。照片裡可能有人，發現請到 https://climbio.app 回報。
