// 自己架站時換掉使用者看得到的品牌名稱 Climbio（語言包、網站首頁、岩點貓的頁面與安裝資訊、紅點貓與 Studio 的頁面）；App 的角色名（岩點貓等）、字型名稱、程式識別字、小寫的 climbio 不動。
// 用法：node tools/rebrand.mjs <新名稱> [網址]；給網址（例如 https://帳號.github.io/climbio）就一起換掉各頁連結預覽的圖片網址
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const [name, url] = process.argv.slice(2);
if (!name || /['"`\\<>]/.test(name)) throw new Error('用法：node tools/rebrand.mjs <新名稱> [網址]（名稱不能有引號、反斜線、角括號）');
if (url && !/^https:\/\/\S+$/.test(url)) throw new Error('網址要是 https:// 開頭');
const root = new URL('..', import.meta.url);
const FILES = ['index.html', 'hold/index.html', 'hold/manifest.webmanifest', 'hold/manifest-dev.webmanifest', 'redpoint/index.html', 'studio/index.html', ...readdirSync(new URL('i18n/', root), { recursive: true }).filter(f => f.endsWith('.js')).sort().map(f => `i18n/${f}`)];   // 所有語言包（i18n/<app>/<語言>.js）
const NAME = /\bClimbio\b(?! (Display|Dan)\b)/g;   // 字型 Climbio Display、Climbio Dan 是 CSS 裡的名稱，不是產品名
let total = 0;
for (const f of FILES) {
  const p = new URL(f, root);
  let s = readFileSync(p, 'utf8'), n = 0;
  s = s.replace(NAME, () => { n++; return name; });
  if (url && f.endsWith('index.html')) s = s.split('https://climbio.app/').join(url.replace(/\/?$/, '/'));
  writeFileSync(p, s);
  total += n;
  console.log(`${f}：${n} 處`);
}
console.log(`共換掉 ${total} 處 Climbio → ${name}。圖示另外用 tools/brand-icons.mjs 換（見 docs/open-source.md）`);
