// 部署時在頁面裡本站的 <script src>、樣式表的 <link href> 後面加 ?v=<版本>：
// 頁面永遠從網路拿最新的，它引用的資源依版本號分開快取（見 appkit/sw.js），頁面和資源永遠同一版，不必靠重新載入對齊。
// 也在 <head> 最前面加上這些資源的 <link rel="preload">：頁面有 <meta http-equiv="Content-Security-Policy"> 時 Chrome 不做預先掃描，
// 程式會一支下載完才開始下一支（Studio 首頁冷啟動 5 秒）；preload 放在 CSP 之前照樣並行下載，CSP 也照樣生效。
// 版本號讀 dist/version.js（build-site.sh 已寫好 holdkit 版本）。本機開發沒經過這裡，網址不帶後綴、照常能跑。
// 用法：node tools/stamp-assets.mjs dist
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 有版本後綴的頁面：岩點貓、3D 預先快取整版；Studio 的頁面邊用邊存（studio/sw.js）
export const PAGES = ['hold/index.html', '3d/index.html', ...['', 'wall/', 'crag/', 'wall3d/', 'scene/'].map(d => `studio/${d}index.html`)];
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

/** 頁面裡本站的程式、樣式（已加版本後綴）→ 插在 <meta charset> 後面的 preload（模組用 modulepreload），讓它們一開始就並行下載 */
export function preloadHtml(html) {
  const tags = [], seen = new Set();
  const add = (tag, u) => { if (!seen.has(u)) { seen.add(u); tags.push(tag); } };
  for (const m of html.matchAll(/<script\b([^>]*?)\bsrc="([^"]+\.js\?v=[^"]+)"[^>]*>/g)) add(/type="module"/.test(m[0]) ? `<link rel="modulepreload" href="${m[2]}">` : `<link rel="preload" as="script" href="${m[2]}">`, m[2]);
  for (const m of html.matchAll(/<link\b[^>]*?\brel="stylesheet"[^>]*?\bhref="([^"]+\.css\?v=[^"]+)"[^>]*>/g)) add(`<link rel="preload" as="style" href="${m[1]}">`, m[1]);
  if (!tags.length) return html;
  const block = tags.join('\n') + '\n', at = html.match(/<meta charset="[^"]*">\n?/i);
  return at ? html.replace(at[0], at[0] + block) : html.replace(/<head>\n?/i, (h) => h + block);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] || 'dist';
  const version = readFileSync(join(dir, 'version.js'), 'utf8').match(/CLIMBIO_VERSION\s*=\s*'([^']+)'/)?.[1];
  if (!version) { console.error('讀不到 version.js 的版本號'); process.exit(1); }
  for (const page of PAGES) {
    const file = join(dir, page), html = readFileSync(file, 'utf8'), out = preloadHtml(stampHtml(html, version));
    if (out === html) { console.error(`${page} 沒有可加版本後綴的資源`); process.exit(1); }
    writeFileSync(file, out);
    console.log(`${page}：資源網址加上 ${suffix(version)}（${(out.match(/\?v=/g) || []).length} 處）`);
  }
}
