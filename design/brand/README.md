# Climbio 品牌原稿

母品牌 Logo 與兩款現行手機 App 角色的可編輯 SVG。產品為岩點貓、紅點貓與 Climbio Studio（Wall／Crag 工作區）。Studio 沿用母品牌 Logo，不另設角色。規範見 [docs/brand.md](../../docs/brand.md)。

- `logo/`：母品牌（綠藍雙岩塊）`climbio-mark.svg`（圖形主檔）、`climbio-horizontal-light.svg`／`-dark.svg`（淺底／深底橫式）、`climbio-stacked.svg`（直式）、`climbio-mark-monochrome.svg`（單色）。
- `icons/`：母品牌的 App Icon `app-icon-light.svg`、`app-icon-maskable.svg`。
- `cats/`：兩款手機 App 角色 `hold-cat.svg`（岩點貓）、`redpoint-cat.svg`（紅點貓）；`hold-cat-wordmark.svg`、`redpoint-cat-wordmark.svg` 分別是岩點貓、紅點貓 App 裡的角色加 Climbio 橫式 Logo；紅點貓字樣沿用相同向量字，改用戶外配色。`cats/icons/` 是兩款手機 App 的 App Icon 與 maskable。
- [holdcats.md](holdcats.md)：岩點貓家族五位主角的設計規格和設定圖。
- [preview.html](preview.html)：品牌預覽；[motion-preview/](motion-preview/README.md)：果凍岩點貓動畫預覽。

產品用的圖示與內嵌符號一律由 `node tools/brand-icons.mjs` 從這裡產生，不手改衍生檔。品牌色在 `css/brand-tokens.css`。要另外的 PNG 素材時，在 repo 根目錄執行 `node design/brand/render-assets.mjs`。

## 授權與二創

Logo 與貓咪角色的設計與美術以 **CC BY 4.0** 授權（見 [LICENSE](LICENSE)）：任何人都可以用、改、二創、商業使用，只要標示「Climbio Logo 與貓咪角色 © Climbio｜CC BY 4.0｜https://climbio.app」。用「Climbio」名稱與 Logo 代表官方服務的請求見 [TRADEMARKS.md](../../TRADEMARKS.md)。

二創時留著下面幾個特徵，大家就認得出是岩點貓；其他都歡迎改（表情、姿勢、配色、各岩館的版本、新的家族成員）：

- 身體是一顆岩點的外形，平塗、沒有描邊和漸層，後面有往右下錯位的深色背層。
- 耳朵中間鏤空；身上有一個鏤空的螺絲孔。
- 白臉的外形全家一樣，只換眼睛和嘴巴。
- 牆上的岩點醒來才長出耳朵和臉。
