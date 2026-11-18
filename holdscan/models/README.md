# 岩點偵測模型（ONNX）

`freeclimbs.onnx` 由 [jwlarocque/yolov8n-freeclimbs-detect-2](https://huggingface.co/jwlarocque/yolov8n-freeclimbs-detect-2)
的 `.pt` 權重以 Ultralytics 匯出（opset 17、輸入尺寸可變），未重新訓練。

- **來源**：John LaRocque 以 Ultralytics YOLOv8n 在 freeclimbs v2 資料集（自家牆、spray wall 的岩點，單一類別）微調。
  資料集作者尚未公開，所以訓練資料無法在這裡列出或重現；權重作者公布的成績（freeclimbs v2 test）：精確 0.961、召回 0.942、mAP50 0.988。
- **為什麼是 AGPL-3.0**：YOLOv8 的程式與預訓練權重是 Ultralytics 以 AGPL-3.0 授權，從它微調的權重也只能用 AGPL-3.0
  （權重作者在模型卡說明過，早期誤標 MIT 已更正）。所以 `holdscan/` 和整個 App 是 AGPL-3.0；
  Kit（`holdkit/`、`routekit/`）保持獨立，不引用這個模型。
- 著作權：Copyright (c) 2024 John LaRocque（權重）；匯出與前後處理見 `holdscan/NOTICE`。

重新匯出（先把上面的 `.pt` 權重下載到 `weights/jwlarocque/`）：

```bash
.venv/bin/python -c "from ultralytics import YOLO; YOLO('weights/jwlarocque/yolov8n-freeclimbs-detect-2.pt').export(format='onnx', imgsz=1280, opset=17, dynamic=True)"
```

輸入 `images` [1, 3, S, S] float32（RGB、0–1、左上對齊補灰 114）；輸出 `output0` [1, 5, N] = cx, cy, w, h, score。
