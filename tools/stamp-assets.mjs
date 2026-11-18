// 部署時在頁面裡本站的 <script src>、樣式表的 <link href> 後面加 ?v=<版本>：
// 頁面永遠從網路拿最新的，它引用的資源依版本號分開快取（見 appkit/sw.js），頁面和資源永遠同一版，不必靠重新載入對齊。
// 版本號讀 dist/version.js（build-site.sh 已寫好 holdkit 版本）。本機開發沒經過這裡，網址不帶後綴、照常能跑。
// 用法：node tools/stamp-assets.mjs dist
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGES = ['hold/index.html', '3d/index.html'];   // 有版本後綴的頁面（Service Worker 預先快取整版的 App）
const local = (u) => !/^([a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(u) && !u.includes('?');

/** 版本後綴：climbio-v151-hk1.2.0 → ?v=v151-hk1.2.0 */
export const suffix = (version) => '?v=' + version.replace(/^climbio-/, '');

/** 給本站的 script（.js）與 link（.css）網址加版本後綴；其他標籤（圖示、manifest、連結）不動 */
export function stampHtml(html, version) {
  const q = suffix(version);
  return html
    .replace(/(<script\b[^>]*?\bsrc=")([^"]+\.js)(")/g, (m, a, u, z) => local(u) ? a + u + q + z : m)
    .replace(/(<link\b[^>]*?\bhref=")([^"]+\.css)(")/g, (m, a, u, z) => local(u) ? a + u + q + z : m);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] || 'dist';
  const version = readFileSync(join(dir, 'version.js'), 'utf8').match(/CLIMBIO_VERSION\s*=\s*'([^']+)'/)?.[1];
  if (!version) { console.error('讀不到 version.js 的版本號'); process.exit(1); }
  for (const page of PAGES) {
    const file = join(dir, page), html = readFileSync(file, 'utf8'), out = stampHtml(html, version);
    if (out === html) { console.error(`${page} 沒有可加版本後綴的資源`); process.exit(1); }
    writeFileSync(file, out);
    console.log(`${page}：資源網址加上 ${suffix(version)}（${(out.match(/\?v=/g) || []).length} 處）`);
  }
}
