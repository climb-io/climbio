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
    lang: 'zh-Hant', dir: '', home: '首頁', siteNav: '網站導覽', siteDocs: '文件', all: '所有元件', otherLabel: 'English', otherLang: 'en',
    indexTitle: 'Climbio 元件', indexLead: '這些是 Climbio 已開放的功能。可以先看效果；想讓自己的 AI Agent 改進或應用它們，直接從 GitHub 專案開始。',
    indexNote: '技術規格、安裝方式及授權條件統一放在 GitHub；網站只展示用途與效果。',
    what: '這是什麼', points: '能做什麼', demo: '線上範例', install: '安裝', example: '最小範例', notes: '授權與限制',
    openDemo: '看線上範例', github: '在 GitHub 看原始碼', noNpm: '尚未發佈到 npm', docs: '給 AI 讀的說明在 GitHub 的 README.md',
    eyebrow: 'Climbio 開放元件', next: '一起改善這項工具', join: '想讓自己的 AI Agent 加入開發？把 Climbio GitHub 專案交給它，技術規格、授權和工作規則都從原始碼取得。', explore: '查看 GitHub 專案', participate: '了解怎麼參與',
    demoTitle: '線上範例', suffix: '｜Climbio 元件', indexSuffix: '｜Climbio',
  },
  en: {
    lang: 'en', dir: 'en/', home: 'Home', siteNav: 'Site navigation', siteDocs: 'Docs', all: 'All kits', otherLabel: '繁體中文', otherLang: 'zh-Hant',
    indexTitle: 'Climbio kits', indexLead: 'Explore the tools Climbio makes available. See what they do, then start from GitHub if you want your own AI agent to build on them.',
    indexNote: 'Technical specifications, installation and licenses are documented on GitHub. These pages focus on what each tool does.',
    what: 'What it is', points: 'What it does', demo: 'Live demo', install: 'Install', example: 'Minimal example', notes: 'License and limits',
    openDemo: 'See the live demo', github: 'View source on GitHub', noNpm: 'Not published to npm yet', docs: 'Machine-readable docs are the README.md files on GitHub',
    eyebrow: 'Open Climbio tools', next: 'Help improve this tool', join: 'Want to contribute with your own AI agent? Start with the Climbio GitHub project. Source code, technical requirements and licensing live there.', explore: 'Explore on GitHub', participate: 'How to join',
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
<link rel="stylesheet" href="${up}css/site-nav.css">
<link rel="stylesheet" href="${up}css/pages.css">
</head>
<body class="site-page">
<header class="site-header">
  <a class="site-brand" href="${up}${u.dir}"><picture><source media="(max-width: 600px)" srcset="${up}icons/brand/climbio-mark.svg"><img src="${up}icons/brand/climbio-horizontal-light.svg" alt="Climbio" width="110" height="30"></picture></a>
  <nav class="site-nav" aria-label="${esc(u.siteNav)}"><a href="${up}${u.dir}">${esc(u.home)}</a><a href="${up}studio/">Studio</a><a href="${up}lab/${u.dir}">Lab</a><a href="${up}${u.dir}guides/" aria-current="true">${esc(u.siteDocs)}</a><a class="site-language" href="${up}kits/${otherHere}${name}" hreflang="${u.otherLang}" lang="${u.otherLang}">${esc(u.otherLabel)}</a></nav>
</header>
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
    <span class="pg-eyebrow">${esc(u.eyebrow)}</span>
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
${c.points.map((p) => `      <article class="pg-card"><h3>${esc(p.h)}</h3><p>${esc(p.p)}</p></article>`).join('\n')}
    </div>
  </section>
${demo}  <section class="pg-section" aria-labelledby="next">
    <h2 id="next">${esc(u.next)}</h2>
    <p>${esc(u.join)}</p>
    <div class="pg-actions"><a class="pg-btn primary" href="${REPO}/${k.folder}">${esc(u.explore)}</a><a class="pg-btn" href="${up}${u.dir}project/">${esc(u.participate)}</a></div>
  </section>`;
  return shell(lang, { title: k.name + u.suffix, description: c.tagline, file: k.id, body });
}

function indexPage(lang, kits) {
  const u = UI[lang], up = lang === 'zh' ? '../' : '../../';
  const body = `  <div class="pg-hero">
    <h1>${esc(u.indexTitle)}</h1>
    <p class="pg-lead">${esc(u.indexLead)}</p>
  </div>
  <section class="pg-section" aria-labelledby="list">
    <h2 id="list">${esc(u.all)}</h2>
    <div class="pg-rows">
${kits.map((k) => `      <a class="pg-row" href="${k.id}.html"><span><strong>${esc(k.name)}</strong><small>${esc(k[lang].tagline)}</small></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></a>`).join('\n')}
    </div>
    <p class="pg-note">${esc(u.indexNote)} <a href="${up}${u.dir}project/">${esc(u.participate)}</a></p>
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
