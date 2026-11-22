// 測試的語言固定成繁體中文：App 的文字照 navigator.language 挑語言，測試預期的是中文訊息，
// 不能因為執行的機器（CI 的 Linux 是英文）不同而失敗。用法：node --import ./tools/test-locale.mjs --test …
// English: pin navigator.language to zh-TW for tests so message assertions don't depend on the machine's locale.
const me = import.meta.url;
if (!String(process.env.NODE_OPTIONS || '').includes('test-locale')) process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} --import=${me}`.trim();   // 測試啟動的 node 子程序（tools/*.mjs 的命令列）也用同一個語言
const n = globalThis.navigator || {};
Object.defineProperty(globalThis, 'navigator', {
  configurable: true, writable: true,
  value: { hardwareConcurrency: n.hardwareConcurrency, userAgent: n.userAgent, platform: n.platform, language: 'zh-TW', languages: ['zh-TW'] },
});
