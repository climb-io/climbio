// Chrome 圖示只接受點陣圖。保留正式紅點貓 SVG 的向量路徑與配色，
// 只調整輸出 viewBox 的透明留白，增加 16px 工具列圖示的有效面積。
// 在 repo 根目錄執行：node tools/extension-icons.mjs
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const source = await readFile(new URL('../design/brand/cats/redpoint-cat.svg', import.meta.url), 'utf8');
const output = new URL('../extension/icons/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 128, height: 128 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${source}`);
  const icon = page.locator('svg');
  const viewBox = await icon.evaluate(element => {
    const { x, y, width, height } = element.getBBox();
    const side = Math.max(width, height) * 1.04; // 四周約 2% 的安全留白
    return `${x + (width - side) / 2} ${y + (height - side) / 2} ${side} ${side}`;
  });
  await icon.evaluate((element, value) => element.setAttribute('viewBox', value), viewBox);
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await writeFile(new URL(`redpoint-cat-${size}.png`, output), await page.screenshot({ omitBackground: true }));
  }
} finally {
  await browser.close();
}
