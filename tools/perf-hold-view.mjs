#!/usr/bin/env node
// 岩點貓看線、定線的效能基準（共用 kit 前後各量一次，退步就不合併）：
//   node tools/perf-hold-view.mjs [--holds 700] [--throttle 4]
// 在瀏覽器（Pixel 7 尺寸、可降 CPU 速度）開一面合成的大牆（預設 700 顆岩點、一條 60 點的路線），量：
//   setView（縮放、平移每一幀）、clampView、完整 render、routeFit（路線視角）、定線的 refreshUi（含共用操作介面）。
// 數字只拿來比「同一台機器、同一份資料」改動前後；先啟動測試伺服器：python tools/serve-test.py（port 8876）。
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = process.cwd().replaceAll(String.fromCharCode(92), '/') + '/';   // 在 repo 根目錄執行
const { chromium, devices } = require(`${root}node_modules/playwright`);
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? Number(process.argv[i + 1]) : d; };
const N = arg('holds', 700), THROTTLE = arg('throttle', 4);

const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'], locale: 'zh-TW' });
const page = await ctx.newPage();
await page.addInitScript(() => localStorage.setItem('climbio.installDismissedAt', String(Date.now())));
await page.goto('http://127.0.0.1:8876/hold/');
await page.waitForFunction(() => typeof window.HoldRefiner === 'object' && typeof putWall === 'function');
await page.evaluate(async (N) => {
  const data = await (await fetch('/demo/demo.json')).json();
  const photo = await (await fetch('/demo/demo.jpg')).blob();
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const W = data.wall.w, H = data.wall.h, holds = [];
  for (let i = 0; i < N; i++) {   // 不規則的小多邊形（8 個頂點）散在整面牆
    const cx = 40 + rnd() * (W - 80), cy = 40 + rnd() * (H - 80), r = 12 + rnd() * 22;
    holds.push({ id: `p${i}`, source: 'detect', poly: Array.from({ length: 8 }, (_, j) => [+(cx + r * (0.8 + 0.4 * rnd()) * Math.cos(j * Math.PI / 4)).toFixed(1), +(cy + r * (0.8 + 0.4 * rnd()) * Math.sin(j * Math.PI / 4)).toFixed(1)]) });
  }
  const ids = holds.slice(0, 60).map((h) => h.id), rh = Object.fromEntries(ids.map((id, i) => [id, i === 0 ? 's' : i === 59 ? 't' : 'h']));
  const w = { ...data.wall, id: 'perf', detected: 1, holds, routes: [{ id: 'r1', name: '大牆', grade: 'V3', holds: rh, t: Date.now(), own: 1 }], createdAt: Date.now(), updatedAt: Date.now() };
  await putWall(w); await putImage(w.id, photo);
  hideWelcome(); await openWall(w.id);
  openRoute('r1');
}, N);
const cdp = await ctx.newCDPSession(page);
if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
await page.waitForTimeout(1500);

const measure = () => page.evaluate(() => {
  const time = (f, n) => { f(); const t = performance.now(); for (let i = 0; i < n; i++) f(i); return +((performance.now() - t) / n).toFixed(4); };
  const out = { holds: state.wall.holds.length };
  out['clampView (ms)'] = time((i) => clampView(1 + (i % 40) / 10, -(i % 300), -(i % 200)), 3000);
  out['setView 縮放平移一幀 (ms)'] = time((i) => setView(1.5 + (i % 30) / 10, -(i % 400), -(i % 300)), 200);
  out['render 完整重畫 (ms)'] = time(() => render(), 30);
  out['routeFit 路線視角 (ms)'] = time(() => routeFit(route()), 100);
  return out;
});
const view = await measure();
await page.evaluate(() => { history.back(); });
await page.waitForTimeout(500);
await page.evaluate(() => openRoute('r1', { edit: true }));
await page.waitForTimeout(1500);
const edit = await page.evaluate(() => {
  const time = (f, n) => { f(); const t = performance.now(); for (let i = 0; i < n; i++) f(i); return +((performance.now() - t) / n).toFixed(4); };
  return { '定線 refreshUi (ms)': time(() => refreshUi(), 100), '定線 render (ms)': time(() => render(), 30), '定線 setView (ms)': time((i) => setView(2 + (i % 20) / 10, -(i % 300), -(i % 200)), 100) };
});
console.log(JSON.stringify({ throttle: THROTTLE, '看路線圖': view, '定線': edit }, null, 1));
await b.close();
