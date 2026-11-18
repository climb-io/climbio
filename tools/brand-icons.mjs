// design/brand/ 是唯一設計來源：母品牌（logo/、icons/）與兩款手機 App 角色（cats/）。這裡只複製原稿、加動畫節點與唯一識別字、輸出 PNG，不修改圖形路徑。
// 換成自己的品牌：--brand <資料夾> 用那裡的 mark、wordmark、icon、icon-maskable.svg 換掉岩點貓（hold/index.html 內嵌的 logo 和 icons/cats/hold-cat*，沒有岩點貓的臉，不拆動畫節點）；--out 寫到另一個資料夾，見 docs/open-source.md
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const dir = path => pathToFileURL(path.endsWith('/') ? path : path + '/');
const repo = new URL('../', import.meta.url);
const root = arg('--out') ? dir(arg('--out')) : repo;
const read = path => readFile(new URL(path, root), 'utf8');
const check = process.argv.includes('--check'), png = !process.argv.includes('--no-png');
const brand = arg('--brand') ? dir(arg('--brand')) : null;
const design = path => readFile(new URL(`design/brand/${path}`, repo), 'utf8');
// generic：--brand 資料夾裡換掉岩點貓的檔名；沒給就用 design/brand/ 的原稿
const source = (path, generic) => brand && generic ? readFile(new URL(generic, brand), 'utf8') : design(path);
const mark = await source('cats/hold-cat.svg', 'mark.svg');
const horizontal = await source('cats/hold-cat-wordmark.svg', 'wordmark.svg');
const appHorizontal = await source('cats/hold-cat-horizontal.svg', 'wordmark.svg');
const CATS = ['hold-cat', 'redpoint-cat'];
const cats = {};
for (const id of CATS) {
  const hold = id === 'hold-cat';
  cats[id] = {
    mark: hold ? mark : await design(`cats/${id}.svg`),
    icon: await source(`cats/icons/${id}-app-icon.svg`, hold && 'icon.svg'),
    maskable: await source(`cats/icons/${id}-maskable.svg`, hold && 'icon-maskable.svg'),
  };
}
const parentIcon = await design('icons/app-icon-light.svg');
function artwork(svg, prefix, animate = false) {
  let inner = svg.slice(svg.indexOf('>') + 1, svg.lastIndexOf('</svg>'));
  for (const [, id] of [...inner.matchAll(/id="([^"]+)"/g)]) inner = inner.replaceAll(id, `${prefix}-${id}`);
  if (animate) {
    const start = inner.indexOf('<path d="M323 360');
    const end = inner.lastIndexOf('</g>');
    if (start < 0 || end <= start) throw new Error('確認 SVG 的臉部結構已改變，請檢查動畫分組。');
    const face = inner.slice(start, end).replace(/(<ellipse[^>]*\/>)(<ellipse[^>]*\/>)/, '<g class="mc-eyes">$1$2</g>');
    inner = inner.slice(0, start) + '<g class="mc-face">' + face + '</g>' + inner.slice(end);
  }
  return inner;
}
function symbol(svg, id) {
  const viewBox = svg.match(/viewBox="([^"]+)"/)[1];
  return `<symbol id="${id}" viewBox="${viewBox}">${artwork(svg, id)}</symbol>`;
}
function replaceOnce(text, pattern, replacement) {
  const matches = [...text.matchAll(new RegExp(pattern.source, 'g'))];
  if (matches.length !== 1) throw new Error(`品牌模板必須恰好命中一次，實際為 ${matches.length}：${pattern.source}`);
  return text.replace(pattern, replacement);
}
let index = await read('hold/index.html');
for (const [id, replacement] of [
  ['i-brand-mark', symbol(mark, 'i-brand-mark')],
  ['i-wordmark', symbol(horizontal, 'i-wordmark')],
  ['i-app-wordmark', symbol(appHorizontal, 'i-app-wordmark')],
  ['i-mascot', `<symbol id="i-mascot" viewBox="-80 -80 160 160"><svg x="-68" y="-68" width="136" height="136" viewBox="0 0 1024 1024">${artwork(mark, 'i-mascot', !brand)}</svg></symbol>`],
]) index = replaceOnce(index, new RegExp(`<symbol id="${id}"[^>]*>[\\s\\S]*?</symbol>`), replacement);
index = index.replaceAll('class="wordmark" viewBox="0 0 354 90"', 'class="wordmark" viewBox="0 0 1260 280"');
const outputs = { 'hold/index.html': index, 'icons/cats/redpoint-cat-horizontal.svg': await design('cats/redpoint-cat-horizontal.svg'), 'icons/cats/redpoint-cat-wordmark.svg': await design('cats/redpoint-cat-wordmark.svg') };
for (const name of ['climbio-mark', 'climbio-horizontal-light', 'climbio-horizontal-dark']) outputs[`icons/brand/${name}.svg`] = await design(`logo/${name}.svg`);
for (const id of CATS) outputs[`icons/cats/${id}.svg`] = cats[id].mark;
for (const [path, value] of Object.entries(outputs)) {
  if (check) {
    if (await read(path) !== value) throw new Error(`${path} 與確認素材不同，請執行 node tools/brand-icons.mjs`);
  } else await writeFile(new URL(path, root), value);
}
// Apple touch icon：iOS 不吃透明（補黑底）、自己裁 22.37% 圓角，所以底色鋪滿成直角正方形，圖形以中心等比縮放：
// 貓的 App Icon 幾乎貼邊，縮到 84% 才不會被圓角切到耳朵；母品牌的圖形原本只佔 56% 寬，放大到 1.2 倍。造型不動。
function touchIcon(svg, scale) {
  const [, , w, h] = svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
  const rect = svg.match(/<rect[^>]*\/>/)[0], open = svg.indexOf('>') + 1;
  const art = svg.slice(open, svg.lastIndexOf('</svg>')).replace(rect, '');
  return `${svg.slice(0, open)}${rect.replace(/ rx="[^"]*"/, '')}<g transform="translate(${w / 2} ${h / 2}) scale(${scale}) translate(${-w / 2} ${-h / 2})">${art}</g></svg>`;
}
if (!check && png) {
  const pngs = [[parentIcon, 64, 'icons/brand/favicon-64.png'], [touchIcon(parentIcon, 1.2), 180, 'icons/brand/apple-touch-icon-180.png'], [parentIcon, 192, 'icons/brand/app-icon-light-192.png'], [parentIcon, 512, 'icons/brand/app-icon-light-512.png']];   // 192：Android Chrome 要有 192 和 512 才算可安裝的 App
  for (const id of CATS) {
    const { icon, maskable } = cats[id];
    pngs.push([touchIcon(icon, .84), 180, `icons/cats/${id}-180.png`], [icon, 192, `icons/cats/${id}-192.png`], [icon, 512, `icons/cats/${id}-512.png`],
      [maskable, 192, `icons/cats/${id}-maskable-192.png`], [maskable, 512, `icons/cats/${id}-maskable-512.png`]);
  }
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    for (const [svg, size, path] of pngs) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
      await page.screenshot({ path: new URL(path, root).pathname, omitBackground: true });
    }
  } finally { await browser.close(); }
}
