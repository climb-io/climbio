// 產生元件說明頁（給人看的網頁）：kits/content/<元件>.mjs 的內容 → kits/（繁體中文）與 kits/en/（英文）。
// 內容只寫在 kits/content/，頁面是產物，不手改；改了內容跑 node tools/build-kits.mjs，--check 只檢查產物有沒有跟上（測試用）。
// 給 AI 讀的說明在各元件資料夾的 README.md（繁體中文）與 README.en.md（英文）。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
/** 頁面順序：格式在最前面，其餘依「看圖、編輯、資料、共用層」排 */
export const ORDER = ['format', 'routekit', 'topokit', 'crag3dkit', 'wall3dkit', 'mapkit', 'holdkit', 'holdscan', 'sourcekit', 'appkit'];
const REPO = 'https://github.com/climb-io/climbio/tree/main';

const UI = {
  zh: {
    lang: 'zh-Hant', dir: '', home: '首頁', all: '所有元件', otherLabel: 'English', otherLang: 'en',
    indexTitle: 'Climbio 元件', indexLead: '攀岩資料的格式、看圖、編輯與分享，拆成可以單獨使用的小元件。不需要整個 App、登入或 Firebase。',
    indexNote: '每個元件都能獨立使用，彼此盡量不依賴。除 Format（Apache-2.0）外都是 AGPL-3.0。',
    what: '這是什麼', points: '能做什麼', demo: '線上範例', install: '安裝', example: '最小範例', notes: '授權與限制',
    openDemo: '看線上範例', github: '在 GitHub 看原始碼', noNpm: '尚未發佈到 npm', docs: '給 AI 讀的說明在 GitHub 的 README.md',
    demoTitle: '線上範例', suffix: '｜Climbio 元件', indexSuffix: '｜Climbio',
  },
  en: {
    lang: 'en', dir: 'en/', home: 'Home', all: 'All kits', otherLabel: '繁體中文', otherLang: 'zh-Hant',
    indexTitle: 'Climbio kits', indexLead: 'Climbing data format, viewers, editors and sharing, split into small parts you can use on their own. No Climbio app, login or Firebase needed.',
    indexNote: 'Every kit works on its own and avoids depending on the others. All are AGPL-3.0 except Format (Apache-2.0).',
    what: 'What it is', points: 'What it does', demo: 'Live demo', install: 'Install', example: 'Minimal example', notes: 'License and limits',
    openDemo: 'See the live demo', github: 'View source on GitHub', noNpm: 'Not published to npm yet', docs: 'Machine-readable docs are the README.md files on GitHub',
    demoTitle: 'Live demo', suffix: ' | Climbio kits', indexSuffix: ' | Climbio',
  },
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** 頁面共用外框：lang 是 'zh' 或 'en'；file 是頁面名（index 或元件 id） */
function shell(lang, { title, description, file, body }) {
  const u = UI[lang], up = lang === 'zh' ? '../' : '../../', here = u.dir, otherHere = lang === 'zh' ? 'en/' : '';
  const name = file === 'index' ? '' : `${file}.html`;
  const url = `https://climbio.app/kits/${here}${name}`;
  const ogImg = 'https://climbio.app/icons/brand/app-icon-light-512.png';
  return `<!doctype html>
<html lang="${u.lang}" data-climbio-theme="outdoor">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#F7F9FB">
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Climbio">
<meta property="og:locale" content="${lang === 'en' ? 'en_US' : 'zh_TW'}">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${ogImg}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${ogImg}">
<title>${esc(title)}</title>
<link rel="icon" href="${up}icons/brand/favicon-brand.svg" type="image/svg+xml">
<link rel="alternate" hreflang="zh-Hant" href="https://climbio.app/kits/${name}">
<link rel="alternate" hreflang="en" href="https://climbio.app/kits/en/${name}">
<link rel="stylesheet" href="${up}css/brand-tokens.css">
<link rel="stylesheet" href="${up}css/pages.css">
</head>
<body>
<header class="pg-top"><a class="pg-brand" href="${up}${u.dir}"><img src="${up}icons/brand/climbio-mark.svg" alt=""><span>Climbio</span></a><span class="grow"></span><nav class="pg-nav" aria-label="${esc(u.all)}"><a href="${up}${u.dir}">${esc(u.home)}</a><a href="${up}kits/${here}"${file === 'index' ? ' aria-current="page"' : ''}>${esc(u.all)}</a><a href="${up}kits/${otherHere}${name}" hreflang="${u.otherLang}" lang="${u.otherLang}">${esc(u.otherLabel)}</a></nav></header>
<main class="pg">
${body}
  <footer class="pg-foot"><span>Climbio · ${esc(u.all)}</span><a href="${up}${u.dir}">${esc(u.home)}</a></footer>
</main>
</body>
</html>
`;
}

function kitPage(lang, k) {
  const u = UI[lang], c = k[lang], up = lang === 'zh' ? '../' : '../../';
  const actions = [
    k.demo ? `<a class="pg-btn primary" href="#demo">${esc(u.openDemo)}</a>` : '',
    `<a class="pg-btn${k.demo ? '' : ' primary'}" href="${REPO}/${k.folder}">${esc(u.github)}</a>`,
  ].filter(Boolean).join('');
  const demo = k.demo ? `  <section class="pg-section" aria-labelledby="demo">
    <h2 id="demo">${esc(u.demo)}</h2>
    <iframe class="pg-demo" src="${up}${k.demo}" title="${esc(k.name)} · ${esc(u.demoTitle)}" loading="lazy"></iframe>
  </section>
` : '';
  const body = `  <div class="pg-hero">
    <span class="pg-eyebrow">${esc(k.pkg || u.noNpm)} · ${esc(k.license)}</span>
    <h1>${esc(k.name)}</h1>
    <p class="pg-lead">${esc(c.tagline)}</p>
    <div class="pg-actions">${actions}</div>
  </div>
  <section class="pg-section" aria-labelledby="what">
    <h2 id="what">${esc(u.what)}</h2>
    <p>${esc(c.what)}</p>
  </section>
  <section class="pg-section" aria-labelledby="points">
    <h2 id="points">${esc(u.points)}</h2>
    <div class="pg-grid">
${c.points.map((p, i) => `      <article class="pg-card"><span class="pg-num">${i + 1}</span><h3>${esc(p.h)}</h3><p>${esc(p.p)}</p></article>`).join('\n')}
    </div>
  </section>
${demo}  <section class="pg-section" aria-labelledby="install">
    <h2 id="install">${esc(u.install)}</h2>
    <pre><code>${esc(c.install)}</code></pre>
    <h2 id="example">${esc(u.example)}</h2>
    <pre><code>${esc(c.example)}</code></pre>
  </section>
  <section class="pg-section" aria-labelledby="notes">
    <h2 id="notes">${esc(u.notes)}</h2>
    <p class="pg-note">${esc(c.notes)}</p>
    <p class="pg-muted"><a href="${up}kits/${u.dir}">${esc(u.all)}</a> · <a href="${REPO}/${k.folder}">GitHub</a> · ${esc(u.docs)}</p>
  </section>`;
  return shell(lang, { title: k.name + u.suffix, description: c.tagline, file: k.id, body });
}

function indexPage(lang, kits) {
  const u = UI[lang];
  const body = `  <div class="pg-hero">
    <h1>${esc(u.indexTitle)}</h1>
    <p class="pg-lead">${esc(u.indexLead)}</p>
  </div>
  <section class="pg-section" aria-labelledby="list">
    <h2 id="list">${esc(u.all)}</h2>
    <div class="pg-grid">
${kits.map((k) => `      <article class="pg-card"><h3><a href="${k.id}.html">${esc(k.name)}</a></h3><p>${esc(k[lang].tagline)}</p><p class="pg-muted">${esc(k.license)}${k.pkg ? ' · ' + esc(k.pkg) : ''}</p></article>`).join('\n')}
    </div>
    <p class="pg-note">${esc(u.indexNote)}</p>
  </section>`;
  return shell(lang, { title: u.indexTitle + u.indexSuffix, description: u.indexLead, file: 'index', body });
}

export async function loadKits() {
  const kits = [];
  for (const id of ORDER) kits.push((await import(pathToFileURL(fileURLToPath(new URL(`kits/content/${id}.mjs`, root))).href)).default);
  return kits;
}

/** 全部頁面：{ 路徑（相對 repo 根）: 內容 } */
export async function pages() {
  const kits = await loadKits(), out = {};
  for (const lang of ['zh', 'en']) {
    const dir = `kits/${UI[lang].dir}`;
    out[`${dir}index.html`] = indexPage(lang, kits);
    for (const k of kits) out[`${dir}${k.id}.html`] = kitPage(lang, k);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const all = await pages();
  if (process.argv.includes('--check')) {
    const stale = Object.entries(all).filter(([p, s]) => { try { return readFileSync(new URL(p, root), 'utf8').replace(/\r\n/g, '\n') !== s; } catch { return true; } }).map(([p]) => p);
    if (stale.length) { console.error(`元件說明頁沒跟上 kits/content：${stale.join('、')}（跑 node tools/build-kits.mjs）`); process.exit(1); }
  } else {
    for (const [p, s] of Object.entries(all)) { mkdirSync(new URL('./', new URL(p, root)), { recursive: true }); writeFileSync(new URL(p, root), s); }
    console.log(`已產生 ${Object.keys(all).length} 頁`);
  }
}
