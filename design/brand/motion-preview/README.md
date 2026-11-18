# 果凍岩點貓動畫預覽

獨立的手機預覽頁，13 個情境逐一重播。只讀取 `../cats/hold-cat.svg` 與 App 共用的 `js/mascot-motion.js`，不載入 App、Firebase、Service Worker 或使用者資料。造型、情境與播放規則見 [mascot-motion.md](../../../docs/mascot-motion.md)。

## 入口與控制

- repo 根目錄執行 `python3 -m http.server 8877`，開啟 `http://127.0.0.1:8877/design/brand/motion-preview/`；參數 `?scene=record&state=sent`（或 `flash`）、`?compare=1`（Sent／Flash 並排）。
- 13 項情境選單；掃描另有五種結果，記錄另有 Sent／Flash／嘗試中。
- 1×／0.5×／0.25×、時間軸、暫停、取消、重播。
- 系統減少動態優先，可用核取方塊模擬；系統要求減少動態時預覽不能強制覆寫。

## 測試

