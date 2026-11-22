# Climbio V3 — 開放攀岩平台總提案

> **2026-11-05 最新品牌決策：兩個 Cat Apps + 一個 Climbio Studio（Crag 工作區）+ Open Format + Open Kits。Studio 直接使用 Climbio 母品牌 Logo。** 詳見 [Studio 正式設計規範](../../studio-design.md)。共用 Studio Shell 尚在整合，不表示已發布。
>
> 本文件是 V3 方向提案；**2026-11-12 現況：`/studio/` 與 Crag 已有實作，目標三欄 Shared Shell 尚未完成**，實際功能以現行程式為準。目前實際功能與已上線介面仍依 [architecture](../../architecture.md)、[brand](../../brand.md)、[author](../../studio-crag.md) 等規格為準。

## Goal

讓任何人建立、維護、分享攀岩資料；資料可由使用者自行保存及交換，任何相容平台均可使用公開格式及獨立 Viewer / Editor，而不用依賴 Climbio 帳號或 Firebase。

品牌不再強制「四隻貓＝四個產品」，改為 **2 Apps + 1 Studio（Crag）+ Open Format + Open Kits**。

## 產品組合

| 產品 | 主要使用者 | 核心承諾 | 裝置 |
|---|---|---|---|
| 岩點貓 / Hold Cat | 室內岩友 | 隨手拍照、定線、收線與分享 | 手機 |
| 紅點貓 / Redpoint Cat | 戶外岩友 | 現場找岩壁、看 Topo 與路線 | 手機 |
| **Climbio Studio**（Crag 工作區） | 岩館館主、教練、岩場開發者與 Guidebook 維護者 | 建立岩場地圖、Topo 和 Guidebook | 電腦／iPad |
| Climbio Open Format | 資料作者、跨平台開發者 | 資料標準可攜且與服務商無關 | 通用 |
| Climbio Open Kits | 第三方網站與 App 開發者 | 可獨立組合的 Viewer / Editor | Web 優先 |

**Apps** 是輕量使用、創作及分享入口；**Studio** 是一套共用介面、兩種工作區的資料建立與長期維護工作台；**Format** 定義資料；**Kits** 提供資料呈現及編輯能力。四者不互相強制依賴。

## 核心承諾

1. **Create Anywhere**：手機一條路線到完整 Guidebook 都是可保存的創作。
2. **Own Your Data**：JSON、照片、ZIP、靜態 HTTPS 等儲存及分享方式，不強制使用官方後端。
3. **Use Everywhere**：可獨立整合 Viewer／Editor；元件不綁官方網站。
4. **Improve Together**：公開 Schema、範例、可獨立重用的工具與授權規範。

「任何地方」指符合格式和存取條件的儲存方式；遠端仍需要適當權限、HTTPS、CORS、安全的資源載入及授權。開放原始碼不等於所有照片與第三方 Guidebook 都允許再發布。

## Scope

- 更新品牌架構、產品定位、命名規範、正式首頁的資訊架構。
- 定義 Climbio Studio 的共同操作介面，以及 Crag 工作區的端到端任務和驗收。
- 以 [format/](../../../format/README.md) v2 為唯一共通資料基礎，獨立提供 [routekit](../../../routekit/README.md)、[topokit](../../../topokit/README.md)、[mapkit](../../../mapkit/README.md) 及適合的 holdkit 能力。
- 跨產品保留作者、來源、授權、幾何 ID、相容性及離線能力。
- 建立共享的品質及發布契約，不依賴單一雲端服務。

## Non-Goals

- 不一次重寫兩個手機 App、Studio、資料格式或既有儲存邏輯。
- 獨立專業工具入口已遷移至 \`/studio/\`，後續工作須驗證資料、權限與分享連結相容。
- 不承諾所有格式、平台、儲存供應商已通過相容測試。
- 不將照片 GPS 當作精確岩壁位置；不對外承諾無人工校正的 AI 結果絕對正確。
- Climbio Studio 直接使用母品牌 Logo，不再製作獨立 Logo；未完成的工作台與角色延伸不可當作正式上線功能。

## 成功定義

- 一般岩友能快速找到室內定線或戶外 Topo 工具。
- 館主能從大量照片完成一套可再次維護的牆面資料。
- 岩場維護者能建立地圖、岩壁、路線、Topo 和可更新的 Guidebook。
- 第三方可不用 Climbio 後端，讀取、顯示、編輯並驗證相容資料。
- 使用者離開 Climbio 服務仍可取回、閱讀及再利用有權使用的資料。

## 導覽與後續文件

- [單一 Studio 的 Crag 工作區 UX](studio-ux-v3.md)
- [Open Format / Open Kits 架構](open-platform-v3.md)

## Ownership / Review

- 產品負責人：批准品牌、命名、對外承諾與發布狀態。
- Studio Shell 負責人與 Crag 工作區負責人：共同驗證一致操作與實際工作流程。
- Format / Kit 維護者：公開規格、相容性與獨立整合測試。
- Reviewer：獨立檢查資料保全、介面一致性、授權、安全和測試；不能以文件提案代替實機驗收。

## Milestones / Exit

順序：**批准架構 → 對齊規格 → 沿用正式母品牌 Logo、設計並整合共用 Studio 工作台 → 共通格式及 Kits 驗證 → Preview → 獨立 Review → 分階段發布**。

未經實作與驗收的功能，不可在正式頁面標示為已可用。
