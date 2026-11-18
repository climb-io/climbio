// 從本資料夾的 SVG 輸出另外要用的 PNG（透明底，寫在 SVG 旁邊；App 用的圖示由 tools/brand-icons.mjs 產生）。
// 在 repository 根目錄執行：node design/brand/render-assets.mjs
import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const cats = ['hold-cat', 'redpoint-cat'];
const targets = [
  { svg: 'logo/climbio-mark.svg', sizes: [64, 256, 512, 1024], base: 'logo/climbio-mark' },
  { svg: 'logo/climbio-horizontal-light.svg', sizes: [1200], base: 'logo/climbio-horizontal-light' },
  { svg: 'logo/climbio-horizontal-dark.svg', sizes: [1200], base: 'logo/climbio-horizontal-dark' },
  ...cats.map(id => ({ svg: `cats/${id}.svg`, sizes: [256, 512, 1024], base: `cats/${id}` })),
];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const target of targets) {
    const svg = await readFile(join(root, target.svg), 'utf8');
    for (const size of target.sizes) {
      const path = join(root, target.base + '-' + size + '.png');
      await mkdir(dirname(path), { recursive: true });
      const [, , w, h] = svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number), height = Math.round(size * h / w);
      await page.setViewportSize({ width: size, height });
      await page.setContent('<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;padding:0;background:transparent}svg{width:' + size + 'px;height:' + height + 'px;display:block}</style></head><body>' + svg + '</body></html>');
      await page.locator('svg').screenshot({ path, omitBackground: true });
      process.stdout.write(path + '\n');
    }
  }
} finally {
  await browser.close();
}