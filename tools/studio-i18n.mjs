// 測試用：Node 裡載入 Studio 的繁體中文語言包（i18n/studio*/zh.js），讓 Studio 的程式在沒有瀏覽器時也能組出中文訊息。
// 用法：在測試檔最前面 import './studio-i18n.mjs'（要在 import Studio 的程式之前，不過文字是呼叫時才查，順序只影響讀取）。
import { readdirSync } from 'node:fs';
import AppKit from '../appkit/index.mjs';

globalThis.AppKit = AppKit;
// boot 要 document 和 localStorage：只在載入當下假裝有，載完就還原，不影響同一個程序裡的其他測試
const had = { document: 'document' in globalThis, localStorage: 'localStorage' in globalThis }, old = { document: globalThis.document, localStorage: globalThis.localStorage };
globalThis.document = { documentElement: {}, write() {} };
globalThis.localStorage = { getItem: () => 'zh', setItem() {}, removeItem() {} };
const packs = readdirSync(new URL('../i18n/', import.meta.url)).filter((d) => d.startsWith('studio'));
for (const p of packs) await import(`../i18n/${p}/zh.js`);
AppKit.i18n.boot({ app: packs, langs: ['zh', 'en'], base: '../i18n/' });
for (const k of ['document', 'localStorage']) { if (had[k]) globalThis[k] = old[k]; else delete globalThis[k]; }
