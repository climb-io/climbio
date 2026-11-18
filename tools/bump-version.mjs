// 自己架的站（沒有部署流程寫入版本號）每次更新前跑一次：version.js 和 hold/index.html 的版本號一起加 1，
// Service Worker 才知道有新版本、提示使用者更新。用法：node tools/bump-version.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url), FILES = ['version.js', 'hold/index.html'];
const n = Number((readFileSync(new URL('version.js', root), 'utf8').match(/climbio-v(\d+)/) || [])[1]);
if (!n) throw new Error('version.js 讀不到版本號');
for (const f of FILES) {
  const p = new URL(f, root), s = readFileSync(p, 'utf8');
  if (!s.includes(`climbio-v${n}`)) throw new Error(`${f} 的版本號跟 version.js 不一樣`);
  writeFileSync(p, s.split(`climbio-v${n}`).join(`climbio-v${n + 1}`));
}
console.log(`版本 v${n} → v${n + 1}`);
