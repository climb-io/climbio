// 轉換固定測試組的照片與 PDF（合成的，不放第三方的路線書）：node tests/convert/make-fixtures.mjs 重新產生。
// 照片在無畫面的 Chromium 用 canvas 畫：lines 是灰底兩條紅線；original 是示範牆（demo/demo.jpg）轉灰階的原圖，與裁切、調亮、畫上紅線和 bolt 的路線書圖；pdf 是有文字的英文路線書。
import { writeFileSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const out = (p) => new URL(p, import.meta.url);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<canvas></canvas>');
const draw = (fn, arg) => page.evaluate(fn, arg).then(a => Buffer.from(a));
const demo = `data:image/jpeg;base64,${readFileSync(new URL('../../demo/demo.jpg', import.meta.url)).toString('base64')}`;

writeFileSync(out('lines/wall.jpg'), await draw(async () => {
  const cv = Object.assign(document.createElement('canvas'), { width: 800, height: 1000 }), g = cv.getContext('2d');
  g.fillStyle = '#777'; g.fillRect(0, 0, 800, 1000); g.strokeStyle = '#e8281e'; g.lineWidth = 7;
  for (const [x0, x1] of [[200, 240], [600, 560]]) { g.beginPath(); g.moveTo(x0, 950); g.lineTo(x1, 100); g.stroke(); }
  return [...new Uint8Array(await (await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.9))).arrayBuffer())];
}));

const [orig, guide] = await page.evaluate(async (demo) => {
  const src = await createImageBitmap(await (await fetch(demo)).blob());
  const W = 1200, H = Math.round(src.height * W / src.width), C = { x: 0.15, y: 0.2, w: 0.6, h: 0.55 };
  const big = Object.assign(document.createElement('canvas'), { width: W, height: H }), bg = big.getContext('2d');
  bg.filter = 'grayscale(1)'; bg.drawImage(src, 0, 0, W, H);
  const cw = W * C.w, ch = H * C.h, gw = 600, gh = Math.round(ch * gw / cw);
  const small = Object.assign(document.createElement('canvas'), { width: gw, height: gh }), g = small.getContext('2d');
  g.filter = 'brightness(1.1)'; g.drawImage(big, W * C.x, H * C.y, cw, ch, 0, 0, gw, gh); g.filter = 'none';
  g.strokeStyle = '#e8281e'; g.lineWidth = 5; g.beginPath(); g.moveTo(150, 640); g.lineTo(200, 100); g.stroke();
  g.lineWidth = 3;
  for (const y of [560, 440, 320, 200]) { g.beginPath(); g.moveTo(442, y - 8); g.lineTo(458, y + 8); g.moveTo(458, y - 8); g.lineTo(442, y + 8); g.stroke(); }
  const bytes = async (cv) => [...new Uint8Array(await (await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.9))).arrayBuffer())];
  return [await bytes(big), await bytes(small)];
}, demo);
writeFileSync(out('original/originals/IMG_0001.jpg'), Buffer.from(orig));
writeFileSync(out('original/guide.jpg'), Buffer.from(guide));

await page.setContent(`<style>body{font:10px serif;margin:40px} h1{font-size:22px} h2{font-size:16px} p{margin:4px 0}</style>
<h1>Gull Rock</h1><p>Approach: trailhead 22.3017, 114.2654, then follow the coast path for ten minutes.</p>
<h2>North Face</h2><p>Steep rock above the tide line.</p>
<p>1) Seagull *** F6a</p><p>Follow the crack to the top.</p><p>F.A. A. Chan (2001)</p>
<p>2) Low Tide ** F5+</p><p>Only at low tide.</p>
<h2>South Face</h2>
<p>3) Sun Trap * F6b</p><p>Hot in the afternoon.</p>`);
writeFileSync(out('pdf/source.pdf'), await page.pdf({ format: 'A5' }));
await browser.close();
