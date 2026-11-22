// Studio 各頁的語言包載入（頁面不能內嵌程式，所以用這個檔）：data-packs 是 i18n/ 底下的語言包資料夾名（空白分隔），共用名詞（common）自動加上。
// 語言：zh、en 兩種，依瀏覽器語言，沒有手動選擇。
// 要在 appkit/i18n.js 之後、用到文字的程式之前載入。
(() => {
  const me = document.currentScript;
  AppKit.i18n.boot({ app: me.dataset.packs.split(/\s+/).filter(Boolean), langs: ['zh', 'en'], base: new URL('../i18n/', me.src).href });
})();
