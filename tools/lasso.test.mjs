import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { RouteKit } from './routekit.mjs';

// 圈起來（js/draw.js 的 lassoOutline）：手畫的圈就是外框
const source = readFileSync(new URL('../js/draw.js', import.meta.url), 'utf8');
const ctx = vm.createContext({ RouteKit });
vm.runInContext(source.slice(source.indexOf('  // ---------- 幾何 ----------'), source.indexOf('  // 外框上的細尖')), ctx);
const { inPoly, area } = RouteKit;
// 圓心 (500, 500)、半徑 100 的圈，每 3 度一點；extra 是繞過起點多畫的度數，wobble 是手抖（像素）
const circle = (extra = 0, wobble = 0) => Array.from({ length: Math.round((360 + extra) / 3) }, (_, i) => {
  const a = i * 3 * Math.PI / 180, r = 100 + wobble * Math.sin(i * 2.7);
  return [500 + r * Math.cos(a), 500 + r * Math.sin(a)];
});
const selfCross = (poly) => {
  const cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const n = poly.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    const a = poly[i], b = poly[(i + 1) % n], c = poly[j], d = poly[(j + 1) % n];
    if (cr(a, b, c) * cr(a, b, d) < 0 && cr(c, d, a) * cr(c, d, b) < 0) return true;
  }
  return false;
};

test('lassoOutline：繞過起點多畫的一段剪掉，外框不自己交叉', () => {
  const out = ctx.lassoOutline(circle(40), 1);
  assert.equal(selfCross(out), false);
  assert.ok(Math.abs(area(out) - Math.PI * 1e4) / (Math.PI * 1e4) < 0.03, String(area(out)));
});

test('lassoOutline：形狀跟畫的一樣（每個頂點離圓周不到 2 px），手抖平均掉、點數比畫的少', () => {
  const drawn = circle(0, 1.5), out = ctx.lassoOutline(drawn, 1);
  assert.ok(out.every(([x, y]) => Math.abs(Math.hypot(x - 500, y - 500) - 100) < 2), JSON.stringify(out));
  assert.ok(out.length >= 16 && out.length < drawn.length, String(out.length));
  assert.ok(inPoly(500, 500, out));
});

test('lassoOutline：沒畫回起點也照畫的收起來', () => {
  const open = circle(-60), out = ctx.lassoOutline(open, 1);
  assert.equal(selfCross(out), false);
  assert.ok(area(out) > 0.8 * Math.PI * 1e4 && area(out) < Math.PI * 1e4, String(area(out)));
});
