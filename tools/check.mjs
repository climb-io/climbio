import { execFileSync } from 'node:child_process';
// 部署前的語法檢查（GitHub Actions 的 Deploy Pages 會先跑這個，有錯就不部署）：
// 頁面沒有內嵌的程式；各個 .js 檔（含 js/ 的 App 程式）只編譯不執行。本機也可以跑：node tools/check.mjs
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { posix } from 'node:path';

// 開發版（預設）：只有會讓頁面壞掉的項目擋部署（語法、內嵌程式、跨檔重複宣告、程式用到卻不存在的 key），
// 按下縮放、各語言跟 zh 不一致、跟共用名詞重複、離線清單缺檔只警告。正式版用 --strict（npm run check:strict），全部都擋
const strict = process.argv.includes('--strict') || process.env.CLIMBIO_STRICT_CHECK === '1';
let failed = 0, warned = 0;
const soft = (msg) => { if (strict) { failed++; console.error(`FAIL ${msg}`); } else { warned++; console.warn(`WARN ${msg}`); } };
function check(name, code) {
  try { new vm.Script(code, { filename: name }); console.log(`ok   ${name}`); }
  catch (e) { failed++; console.error(`FAIL ${name}\n${e.stack.split('\n').slice(0, 5).join('\n')}`); }
}
// 頁面不能有內嵌的程式（<script> 沒有 src 的、onclick 這類屬性）：內容安全政策（CSP）不執行，岩點貓開頁要做的放 js/boot.js
for (const page of ['index.html', '404.html', 'hold/index.html', 'studio/index.html', 'studio/wall/index.html', 'studio/crag/index.html', 'about.html', 'privacy.html', 'terms.html', '3d/index.html', 'en/index.html', ...readdirSync('guides').filter(f => f.endsWith('.html')).map(f => 'guides/' + f), ...readdirSync('en/guides').map(f => 'en/guides/' + f)]) {
  const html = readFileSync(page, 'utf8');
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>|\son[a-z]+=["']/g)) {
    failed++; console.error(`FAIL ${page} 第 ${html.slice(0, m.index).split('\n').length} 行有內嵌的程式`);
  }
}
// 岩點貓的程式：清單只寫在 hold/index.html（依序載入、共用全域範圍），這裡和 hold/sw.js 的 SHELL 都照它核對。各自檢查語法
// English: hold/index.html is the single source of the script list and order; all page scripts share one global scope.
const fromHold = (u) => posix.normalize(`hold/${u}`);   // hold/ 裡寫的相對網址 → repo 裡的路徑
const PAGE_JS = [...readFileSync('hold/index.html', 'utf8').matchAll(/<script (?:defer )?src="([^"]+)"/g)].map(m => fromHold(m[1]));
const WORKER_JS = ['holdscan/browser/holdscan.js', 'holdscan/browser/worker.js', 'holdscan/core/detect-core.js', 'holdkit/ort.js', 'holdkit/samworker.js'];
for (const f of [...PAGE_JS, ...WORKER_JS, '3d/boot.js', '3d/app.js', 'sw.js', 'appkit/sw.js', 'hold/sw.js', 'studio/sw.js', 'studio/shell.js', 'studio/i18n-boot.js', ...['functions/index.js'].filter(existsSync)]) check(f, readFileSync(f, 'utf8'));
// 跨檔重複宣告：頂層的 let／const／class 同名，後載入的那個檔整個不會執行。照載入順序接成一份只編譯，報出是哪兩個檔
{
  const parts = PAGE_JS.map(f => ({ f, code: readFileSync(f, 'utf8') + '\n;\n' }));
  try { new vm.Script(parts.map(p => p.code).join(''), { filename: 'page' }); console.log(`ok   頁面的 ${PAGE_JS.length} 個程式沒有跨檔重複宣告`); }
  catch (e) {
    const line = Number((e.stack.match(/page:(\d+)/) || [])[1]) || 0, name = (e.message.match(/'([^']+)'/) || [])[1];
    let at = 0, file = '?', where = '?';
    for (const p of parts) { const n = p.code.split('\n').length - 1; if (line <= at + n) { file = p.f; where = `${p.f} 第 ${line - at} 行`; break; } at += n; }
    const first = name && PAGE_JS.find(f => f !== file && new RegExp(`^[ \\t]*(?:let|const|class|var|function|async function)\\s+${name}\\b`, 'm').test(readFileSync(f, 'utf8')));
    failed++; console.error(`FAIL 跨檔重複宣告：${e.message}（${where}${first ? `；先宣告在 ${first}` : ''}）`);
  }
}
// hold/sw.js 的 SHELL（離線快取）要有頁面的每個程式和 Worker 用的檔，不然離線打不開
{
  const shell = new Set([...(readFileSync('hold/sw.js', 'utf8').match(/const SHELL = \[([\s\S]*?)\];/) || [, ''])[1].matchAll(/'([^']+)'/g)].map(m => fromHold(m[1])));
  const missing = [...PAGE_JS, ...WORKER_JS].filter(f => !shell.has(f));
  if (missing.length) soft(`hold/sw.js 的 SHELL 少了：${missing.join('、')}`); else console.log('ok   hold/sw.js 的 SHELL 有頁面和 Worker 的每個程式');
}
// 語言包（i18n/<app>/<語言>.js，共用名詞在 i18n/common/）：同一個 App 各語言的 key 要一樣，函式的參數個數也要一樣；少了就不部署
const LANG_PACKS = ['zh', 'en', 'ja', 'fr', 'ko', 'es', 'de'];
const loadPack = (f) => {
  const code = readFileSync(f, 'utf8');
  check(f, code);
  let pack = null;
  try { new vm.Script(code).runInNewContext({ AppKit: { i18n: { add: (app, l, dict) => { pack = dict; } } } }); } catch (e) { /* 語法錯誤上面已經報了 */ }
  return pack;
};
// 清單（例如分享短句 cap*）各語言長度可以不同：只要都是有內容的清單
const shape = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k,
  typeof v === 'function' ? `fn${v.length}` : Array.isArray(v) ? (v.length ? 'list' : 'empty') : typeof v === 'object' ? Object.keys(v).sort().join(',') : 'str']));
const packs = {};   // packs[app][語言]
for (const app of readdirSync('i18n')) {
  packs[app] = {};
  for (const l of LANG_PACKS.filter(l => existsSync(`i18n/${app}/${l}.js`))) packs[app][l] = loadPack(`i18n/${app}/${l}.js`);
  const zh = packs[app].zh;
  if (!zh) { failed++; console.error(`FAIL i18n/${app}/ 沒有 zh.js`); continue; }
  for (const l of Object.keys(packs[app]).filter(l => l !== 'zh' && packs[app][l])) {
    const a = shape(zh), b = shape(packs[app][l]), bad = [];
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k]) bad.push(`${k}（zh ${a[k] || '沒有'}／${l} ${b[k] || '沒有'}）`);
    if (bad.length) soft(`i18n/${app}/${l}.js 跟 zh 不一致：\n  ${bad.join('\n  ')}`);
    else console.log(`ok   i18n/${app}/${l}.js 的 key 跟 zh 一致`);
  }
}
// App 的語言包不能重複共用名詞的 key（共用名詞只放一份）
for (const app of Object.keys(packs).filter(a => a !== 'common' && packs[a].zh && packs.common.zh)) {
  const dup = Object.keys(packs[app].zh).filter(k => k in packs.common.zh);
  if (dup.length) soft(`i18n/${app}/ 跟共用名詞重複：${dup.join('、')}`);
}
// App 的程式和 HTML 用到的 key（t('…')、T('…')、data-i18n*="…"）都要在語言包裡（App 的或共用名詞）；岩點貓看 hold/index.html 載入的程式，紅點貓看它自己的幾個檔
// holdkit/samrefine.js 的訊息也用語言包（HoldRefiner.configure 的 t）
const PACK_SOURCES = { hold: ['hold/index.html', ...PAGE_JS], redpoint: ['redpoint/index.html', ...['app.js', 'io.js', 'openclimbing.js', 'auto-merge.mjs'].map(f => `redpoint/${f}`)],
  // Studio：共用包加各工作區的包（頁面用 studio/i18n-boot.js 載入）；Crag 分成「介面」與「資料」兩個包
  studio: ['studio/index.html', ...['home', 'shell', 'backend', 'album', 'classify', 'store', 'publisher', 'service'].map(f => `studio/${f}.js`), ...['group-map', 'lightbox', 'workspaces'].map(f => `studio/intake/${f}.js`)],
  'studio-crag': ['studio/crag/index.html', ...['app', 'table', 'grid', 'topo', 'site', 'map', 'geo', 'dom', 'intake', 'match', 'match-worker', 'pair', 'trace'].map(f => `studio/crag/${f}.js`)],
  'studio-crag-data': ['model', 'outline', 'docread', 'ai-prompt', 'publish', 'store'].map(f => `studio/crag/${f}.js`),
  'studio-wall': ['studio/wall/index.html', ...['app', 'editor', 'geometry', 'sam', 'store'].map(f => `studio/wall/${f}.js`)],
  'studio-wall3d': ['studio/wall3d/index.html', 'studio/wall3d/app.js'],
  'studio-convert': ['studio/convert/index.html', 'studio/convert/convert.js'],
};
for (const [app, sources] of Object.entries(PACK_SOURCES)) {
  if (!packs[app]?.zh || !packs.common.zh) continue;
  const used = new Set();
  for (const f of sources) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\b[tT]\('([A-Za-z0-9_]+)'\s*[,)]/g)) used.add(m[1]);
    for (const m of src.matchAll(/data-i18n(?:-aria|-title|-ph|-html|-content)?="([A-Za-z0-9_]+)"/g)) used.add(m[1]);
  }
  const missing = [...used].filter(k => !(k in packs[app].zh) && !(k in packs.common.zh));
  if (missing.length) { failed++; console.error(`FAIL ${app} 的語言包裡沒有這些 key：${missing.join('、')}`); }
  else console.log(`ok   ${app} 程式用到的 ${used.size} 個 key 都在語言包裡`);
}
// 按下縮一下一律用 scale 屬性：:active 改 transform 會蓋掉元素自己用 transform 做的定位（置中、圖釘），按下就跳位，放開時不在按鈕上點擊也不算
const STYLE_FILES = execFileSync('git', ['ls-files', '*.css', '*.html'], { encoding: 'utf8' }).split('\n')
  .filter(f => f && !/(^|\/)(vendor|node_modules|tests|kits)\//.test(f));
const pressBad = [];
for (const f of STYLE_FILES) {
  const css = readFileSync(f, 'utf8');
  for (const m of css.matchAll(/([^{}]*:active[^{}]*)\{([^{}]*)\}/g)) {
    if (/transform\s*:[^;}]*scale\(/.test(m[2])) pressBad.push(`${f}:${css.slice(0, m.index + m[0].indexOf(m[1].trim())).split('\n').length} ${m[1].trim().split('\n').pop()}`);
  }
}
if (pressBad.length) soft(`按下時用 transform: scale()，改用 scale 屬性：\n  ${pressBad.join('\n  ')}`);
else console.log(`ok   ${STYLE_FILES.length} 個樣式檔按下縮放都用 scale 屬性`);
if (warned) console.warn(`\n${warned} 項警告（開發版不擋；發布正式版前用 --strict 會擋，要先修）`);
if (failed) { console.error(`\n${failed} 項檢查沒通過，不部署`); process.exit(1); }
