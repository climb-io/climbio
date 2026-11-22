# 品牌視覺規範

> **現行入口（2026-11-16）**：母品牌 Climbio ＋ **兩個 App（岩點貓／紅點貓）＋一個正式 Studio（Crag Guidebook）＋ Climbio Lab 研究入口**；Wall 和 3D 工具保留技術路徑，但不視為已完成的正式 Studio 工作區。
> **Climbio Studio 直接使用母品牌正式 Logo，沒有獨立 Logo、沒有 Crag、Wall 分別的 Logo**。目標版面與工作區規範見 [studio-design.md](studio-design.md)。
> 只有岩點貓、紅點貓具備獨立角色圖示；Studio 與各工作區使用 Climbio 母品牌識別。

品牌唯一原稿在 [design/brand/](../design/brand/)。所有已確認 SVG 必須直接引用，不重新生成輪廓、字形、耳朵或五官。介面元件與操作見 [style.md](style.md)。

## V3 正式產品識別

| 產品 | 識別方式 | 場景 |
|---|---|---|
| Climbio | 綠藍雙岩塊＋小寫 Climbio 字標 | 母品牌與開放平台 |
| 岩點貓／Hold Cat | 正式綠色岩點貓 SVG | 室內手機 App |
| 紅點貓／Redpoint Cat | 正式深海藍 Bolt 貓 SVG | 戶外手機 App |
| **Climbio Studio** | **直接重用 Climbio 母品牌 Logo**＋排版文字 Studio | 專業桌面／iPad 工作台 |
| Wall | 無獨立 Logo，僅研究工具名稱 | Climbio Lab：岩點偵測與精修 |
| Crag | 無獨立 Logo，僅工作區名稱 | Studio 內的 Guidebook 編輯 |

- Studio 的母標誌來源：\`design/brand/logo/climbio-mark.svg\`；字標來源 \`climbio-horizontal-light.svg\`／\`-dark.svg\`。不新增任何更動幾何的 Studio Logo。
- Studio 安裝圖示需要時可重用母品牌 \`design/brand/icons/app-icon-light.svg\`／maskable 原稿；**無獨立工作區 App Icon**。
- Studio Shell 使用共同布局、控制元件、選取／撤銷／儲存與發布流程，工作區僅切換領域工具和內容。
- 岩點貓與紅點貓的原始 SVG、PWA 圖示、路線語意色及原有動畫規範不變。


### 現行產品入口

| 路由 | 名稱 | 用途 |
|---|---|---|
| \`/hold/\` | 岩點貓 | 保留岩點貓 |
| \`/redpoint/\` | 紅點貓 | 保留紅點貓 |
| \`/studio/\` | Climbio Studio | Crag（\`/studio/crag/\`）工作區 |

Studio 是一個 PWA（範圍 \`/studio/\`，圖示用母品牌），已取代 \`/find/\`、\`/author/\`。

## 正式原稿與衍生檔

| 資產 | 唯一設計來源 | 現有衍生檔 |
|---|---|---|
| 母品牌 Logo | \`design/brand/logo/climbio-mark.svg\`、\`climbio-horizontal-light.svg\`、\`climbio-horizontal-dark.svg\` | \`icons/brand/\`：首頁 favicon、橫式 Logo、靜態頁 |
| 母品牌 App Icon | \`design/brand/icons/app-icon-light.svg\` | \`icons/brand/favicon-64.png\`、\`apple-touch-icon-180.png\`、\`app-icon-light-512.png\` |
| 手機 App 角色 SVG | \`design/brand/cats/<id>.svg\` | \`icons/cats/<id>.svg\` |
| 手機 App 的 PWA 圖示 | \`design/brand/cats/icons/<id>-app-icon.svg\`、\`<id>-maskable.svg\` | \`icons/cats/<id>-192.png\`、\`-512.png\`、\`-maskable-192.png\`、\`-maskable-512.png\`、\`-180.png\` |
| 岩點貓橫式 Logo | \`design/brand/cats/hold-cat-horizontal.svg\` | \`i-app-wordmark\` |
| 紅點貓橫式 Logo | \`design/brand/cats/redpoint-cat-horizontal.svg\` | \`icons/cats/redpoint-cat-horizontal.svg\` |
| 岩點貓分享署名 | \`design/brand/cats/hold-cat-wordmark.svg\` | \`i-wordmark\`、Canvas 輸出 |

\`<id>\` 為 \`hold-cat\`、\`redpoint-cat\`。原版角色的圖形已由使用者確認，不能因新 Studio 設計而更動。岩點貓保留不規則寬岩點、鏤空耳朵、偏左白臉、五官、螺絲孔與深綠背層；紅點貓保留 Bolt 貓及珊瑚紅點。不得再生成替代角色，也不得以其他示意貓頭充當品牌原稿。

### 測試環境的 App 辨識

- 正式的岩點貓／紅點貓 Logo、SVG、PNG 均維持原稿；**不得為測試版修改正式素材**。
- `climbio-dev`、`climbio-eric` 打包時由 `tools/dev-app-icons.py` 從原始 PNG 產生帶有橘色 `DEV` 標籤的獨立安裝圖示，輸出到 `dist/icons/dev/`；保留角色圖形與 Android maskable 安全範圍。
- 測試版 PWA 名稱、iOS 加入主畫面名稱與分頁標題為「岩點貓 DEV／紅點貓 DEV」，兩個 App 內仍顯示「測試版」提示；正式站保持原名稱與圖示。
- 測試版預覽與正式版不得共用安裝圖示；iOS 已加到主畫面的舊 App 可能需刪除捷徑重新加入，系統才會更新圖示。

### 首頁社群分享封面

- 首頁八種語言共用一張 1200×630 JPG 社群封面，使用首頁現有的真實戶外岩場照片 `demo/reel/crag-guidebook.webp` 與**官方** `icons/brand/climbio-horizontal-dark.svg`，不重畫角色與 Logo。
- 封面由 `tools/social-cover.py` 在網站打包時產生為 `dist/social/climbio-home.jpg`，**原始照片與正式 App icon 不修改**。部署流程在生成之前準備 Pillow／CairoSVG。
- `og:image`、`twitter:image` 都使用該 JPEG 的正式絕對 URL；首頁使用 `summary_large_image`，提供 Open Graph 的尺寸、格式與替代文字。翻譯頁共用無語言障礙的主視覺，文字由各頁的 `og:title`／`og:description` 提供。
- `tools/social-meta.mjs` 必須保留首頁的封面設定，不能被重新產生 meta 的工具覆寫成 512×512 方形 App 圖示。

## 母品牌明暗模式、網站小圖示與社群頭像

Climbio 母品牌的 Logo 在淺／深模式下都保留**正式綠藍雙岩塊**形狀與顏色；只改背景、語意色與橫式字標的文字版本。色彩以 \`css/brand-tokens.css\` 為唯一來源。

| 場景 | 背景 | 表面（卡片） | 主要文字 | 次要文字 | 邊框 |
| --- | --- | --- | --- | --- | --- |
| 母品牌 Light | \`#F7F9FB\` | \`#FFFFFF\` | \`#08263A\` | \`#47687B\` | \`#DCE6ED\` |
| 母品牌 Dark | \`#0E1722\` | \`#172636\` | \`#F7F9FB\` | \`#B5C8D3\` | \`#344D61\` |

- 母品牌官網 \`climbio.app\` 跟隨 \`prefers-color-scheme\`，使用 \`css/brand-appearance.css\` 的頁面語意色；不將官網設定直接傳給手機 App。Logo 綠 \`#B6F000\`／藍 \`#0FADEA\` 不改色、不重畫。
- 首頁的橫式標誌：淺色背景用 \`climbio-horizontal-light.svg\`；深色背景用 \`climbio-horizontal-dark.svg\`。兩種均為正式原稿。
- **網站小 Logo／favicon**：使用 \`icons/brand/favicon-brand.svg\`，以固定深藍色 \`#0E1722\` 小方形底、官方雙岩塊為圖形，避免瀏覽器分頁在淺色／深色主題下辨識不清。小圖示不加文字，優先測 16／32／64px。
- **Google／社群帳號頭像**：\`design/brand/icons/social-avatar-dark.svg\`，固定深藍色 \`#0E1722\` 圓形底、原稿等比縮放，輸出 1024×1024 PNG 時保留圓形裁切安全距離。
- Climbio Studio 沿用母品牌 Logo 與語意色；Crag 為正式工作區，Wall 是 Lab 研究工具。三欄共用 Shell 仍是目標規格，不可視為已實作。
- **岩點貓維持固定深色**（\`#0E0E0F\`、操作色 \`#D4FF4F\`），**紅點貓維持固定淺色**（\`#F7F9FB\`、深海藍操作色）；**Climbio Studio 固定深色**（跟岩點貓同一組深色，見 studio-design.md）；三者不因系統模式切換而改色。
- 深色主要操作底可用 \`#0FADEA\` 配 \`#08263A\` 字，需符合 WCAG AA 一般文字對比 4.5:1、重要圖形 3:1；螢光綠仍作品牌點綴，不直接作淺底小字。
- 驗收涵蓋首頁 light/dark、不同手機寬度、16/32px favicon、圓形帳號頭像，以及兩款 App 不受影響的回歸測試。

## 配色

\`css/brand-tokens.css\` 是唯一品牌色源；室內／戶外主題可提供兩個手機 App 和 Studio 工作區內的領域輔助色，**Studio 共享 Shell 不因工作區切換而改變控制佈局**。

| 用途 | 色碼 |
|---|---|
| 母品牌 Logo 綠／藍 | \`#B6F000\`／\`#0FADEA\` |
| 母品牌深海文字／淺底 | \`#08263A\`／\`#F7F9FB\` |
| 岩點貓室內背景 | \`#0E0E0F\` |
| 岩點貓 Logo 前層／背層 | \`#A4DC2A\`／\`#709F39\` |
| 岩點貓白臉／五官 | \`#F7F8F4\`／\`#233238\` |
| 室內 UI 操作色 | **\`#D4FF4F\`** |
| 戶外背景／深海藍／背層 | \`#F7F9FB\`／\`#0B4A6B\`／\`#2E8CC9\` |
| 紅點貓紅點 | \`#FF6B6B\`（角色點綴，不代表安全狀態） |

Logo 綠與路線類型、起攀、手點、腳點、完攀等語意色分開；無障礙不以顏色作唯一判斷依據。

## 字體與首頁

首頁以六幕照片介紹岩點貓、Studio Wall、Studio Crag、紅點貓收藏、紅點貓和 Climbio。每幕一張照片和一段文字，前五幕各有一個圖示入口。Studio Wall 與 Studio Crag 共用正式 Climbio 圖形。Climbio 圖形也用在結尾的 Studio 入口。Hold Lab、3D Lab 和文件分別用岩點辨識框、立體岩塊和帶書籤的手冊圖形，搭配相同的圓角底色。

首頁依裝置語言進入繁中或英文。第六幕先顯示 Climbio 文案，接著在同一張照片上展開岩點貓、紅點貓、紅點貓收藏、Studio、文件、Hold Lab、3D Lab 和 GitHub 的入口。Studio、Lab、文件沿用紅點貓的淺底、深海藍與圓角介面，共用 `css/site-nav.css` 的導覽。開放格式、路線 JSON 與 RouteKit 範例集中在文件的「開發資源」。

## 縮放、PWA 安全區與無障礙

- 等比縮放；主視覺四周至少留圖形寬度 12%，獨立母品牌圖形最小 32px，角色至少 48px。
- PWA any 與 maskable 需分開驗證；maskable 安全圓及 Apple Touch Icon 的裁切、透明度按既有 \`tools/brand-icons.test.mjs\` 驗證。
- Logo 的替代文字為「Climbio」；在 Studio 旁已寫「Climbio Studio」時，重複裝飾可用空 alt，但不得誤認為各工作區有品牌 Logo。
- 文字至少 4.5:1、必要圖形 3:1；支援鍵盤／觸控及 \`prefers-reduced-motion\`。

## 角色動畫、分享與產生流程

靜態母品牌 Logo 不變形、不動畫。岩點貓的動畫規範見 [mascot-motion.md](mascot-motion.md) 及 [holdcat.md](holdcat.md)；這是 App 角色，不是 Studio Logo 動畫。分享時讓照片、路線及作者是主角，不增加大型品牌浮水印。

執行 \`node tools/brand-icons.mjs\` 由原稿生成衍生檔；\`--check\` 檢查 SVG 不分岔。不得直接修改 \`icons/\` 內的生成品，也不應為 Studio 新增獨立畫過的雙岩塊。正式上線前需執行品牌、首頁、PWA、所有原 App 的回歸測試。

## Ownership / Review / Exit

產品負責人確認 Climbio Studio 的對外名稱及工作區分工。品牌 reviewer 核對唯一 SVG／字標及現行 App 不受影響；UX reviewer 驗證首頁輪播及 Studio／Lab 分界；工程 reviewer 核對格式、路由及資料保護。

**現況（2026-11-12）**：`/studio/` 已有統一入口、manifest 與 Crag、Wall 工作區；Shared Studio Shell 的完整三欄版面仍屬目標設計。
