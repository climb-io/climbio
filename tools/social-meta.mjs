// 為所有獨立頁面補齊社群分享用的 meta（canonical、og:*、twitter:*）。可重複執行。
import fs from 'node:fs';
import path from 'node:path';

const ORIGIN = 'https://climbio.app';
const root = path.resolve(import.meta.dirname, '..');
const SKIP = /^(404|google[0-9a-f]+)\.html$|^(node_modules|dist|docs|tests|design|demo|proto|embed|playwright-report|test-results|functions|holdkit|holdscan|\.atlas-view|extension|backend)\/|baseline\/|(^|\/)demo\.html$|^(mapkit|routekit|topokit)\/demo\.html$/;
const FALLBACK_DESC = {
  '3d/index.html': 'Climbio 3D：在手機上瀏覽岩壁與岩場的 3D 模型，沿岩壁看路線。',
  'privacy.html': 'Climbio 隱私權政策：說明我們收集哪些資料、如何使用與保護。',
  'terms.html': 'Climbio 服務條款：使用岩點貓、紅點貓與相關服務的條件。',
  'studio/wall/index.html': 'Studio Wall：在 Climbio Studio 檢查與修正岩點辨識結果，讓岩點貓越來越準。',
  'studio/wall3d/index.html': 'Climbio Lab 的 3D 岩牆工作台：整理照片、建立並檢查岩牆 3D 模型。',
  'redpoint/sources.html': '紅點貓收錄的岩場資料來源與授權：每份 Topo 與路線資料的出處與使用條件。',
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.relative(root, path.join(dir, e.name)).split(path.sep).join('/');   // Windows 的路徑分隔也換成網址的 /
    if (e.isDirectory()) { if (!SKIP.test(rel + '/')) walk(path.join(dir, e.name), out); }
    else if (e.name.endsWith('.html') && !SKIP.test(rel)) out.push(rel);
  }
  return out;
}
const esc = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const unesc = s => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&amp;/g, '&');

const isHomepage = rel => /^(?:index\.html|(?:zh-cn|en|ja|ko|de|es|fr)\/index\.html)$/.test(rel);
const HOME_IMAGE = '/social/climbio-home.jpg';
const HOME_IMAGE_ALT = 'Climbio official logo and climbers viewing a rock wall';

function imageFor(rel) {
  if (isHomepage(rel)) return HOME_IMAGE;
  if (/^(en\/)?guides\/hold|^hold\//.test(rel)) return '/icons/cats/hold-cat-512.png';
  if (/^(en\/)?guides\/redpoint|^redpoint/.test(rel)) return '/icons/cats/redpoint-cat-512.png';
  return '/icons/brand/app-icon-light-512.png';
}

let changed = 0;
for (const rel of walk(root).sort()) {
  const file = path.join(root, rel);
  let html = fs.readFileSync(file, 'utf8');
  if (!/<head[\s>]/i.test(html)) continue;
  const lang = (html.match(/<html[^>]*\blang="([^"]+)"/i) || [])[1] || 'zh-Hant';
  const title = unesc((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || 'Climbio').trim();
  let desc = (html.match(/<meta name="description" content="([^"]*)"/i) || [])[1];
  desc = desc ? unesc(desc) : FALLBACK_DESC[rel];
  if (!desc) { console.log('缺簡介，略過', rel); continue; }
  const ogTitle = (html.match(/<meta property="og:title" content="([^"]*)"/i) || [])[1];
  const ogDesc = (html.match(/<meta property="og:description" content="([^"]*)"/i) || [])[1];
  const url = ORIGIN + '/' + rel.replace(/index\.html$/, '');
  const block = [
    `<link rel="canonical" href="${url}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Climbio">`,
    `<meta property="og:locale" content="${lang === 'en' ? 'en_US' : 'zh_TW'}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:title" content="${ogTitle ?? esc(title)}">`,
    `<meta property="og:description" content="${ogDesc ?? esc(desc)}">`,
    `<meta property="og:image" content="${ORIGIN}${imageFor(rel)}">`,
    ...(!isHomepage(rel) ? [] : [
      '<meta property="og:image:type" content="image/jpeg">',
      '<meta property="og:image:width" content="1200">',
      '<meta property="og:image:height" content="630">',
      `<meta property="og:image:alt" content="${HOME_IMAGE_ALT}">`,
    ]),
    `<meta name="twitter:card" content="${isHomepage(rel) ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${ogTitle ?? esc(title)}">`,
    `<meta name="twitter:description" content="${ogDesc ?? esc(desc)}">`,
    `<meta name="twitter:image" content="${ORIGIN}${imageFor(rel)}">`,
    ...(!isHomepage(rel) ? [] : [`<meta name="twitter:image:alt" content="${HOME_IMAGE_ALT}">`]),
  ];
  const before = html;
  html = html.replace(/[ \t]*<meta (?:property="og:[^"]*"|name="twitter:[^"]*")[^>]*>\n?/gi, '')
             .replace(/[ \t]*<link rel="canonical"[^>]*>\n?/gi, '');
  if (!/<meta name="description"/i.test(html)) block.unshift(`<meta name="description" content="${esc(desc)}">`);
  const hasDesc = /<meta name="description"[^>]*>/i.test(html);
  const anchor = hasDesc ? /<meta name="description"[^>]*>/i : /<\/title>/i;
  html = html.replace(anchor, m => m + '\n' + block.join('\n'));
  if (html !== before) { fs.writeFileSync(file, html); changed++; }
}
console.log('已更新', changed, '頁');
