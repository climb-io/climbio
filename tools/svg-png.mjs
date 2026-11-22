// SVG 轉 PNG（給 tools/social-cover.py 在沒有 cairo 的機器上用，例如 Windows）：用已經裝的 Playwright Chromium 照原尺寸畫出來
// 用法：node tools/svg-png.mjs <svg> <寬> <高> <輸出.png>
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [svg, w, h, out] = process.argv.slice(2);
const width = Number(w), height = Number(h);
const browser = await chromium.launch();
const timer = setTimeout(() => { console.error('svg-png：逾時 60 秒'); process.exit(1); }, 60000);
try {
  const page = await browser.newPage({ viewport: { width, height } });
  const src = 'data:image/svg+xml;base64,' + readFileSync(svg).toString('base64');
  await page.setContent(`<html><body style="margin:0;background:transparent"><img src="${src}" style="width:${width}px;height:${height}px;display:block"></body></html>`);
  await page.waitForFunction(() => document.images[0].complete);
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width, height } });
} finally { clearTimeout(timer); await browser.close(); }
