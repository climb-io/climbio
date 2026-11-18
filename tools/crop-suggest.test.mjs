import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// 自動裁切建議（holdkit 的 cropSuggest）
const HoldKit = createRequire(import.meta.url)('../holdkit/holdkit.js');
const grid = (n, x0, y0, step, sc = 0.9) => Array.from({ length: n }, (_, i) => {
  const x = x0 + (i % 10) * step, y = y0 + Math.floor(i / 10) * step;
  return [x, y, x + 20, y + 20, sc];
});

test('岩點不到 30 顆不給建議', () => {
  assert.equal(HoldKit.cropSuggest(grid(29, 100, 100, 50), 2000, 1500), null);
});

test('框住岩點、往外留照片寬高的 4%，不超出照片', () => {
  const r = HoldKit.cropSuggest(grid(100, 500, 400, 50), 2000, 1500);
  // 分位數 2%／98%：x0 ≈ 500、x1 ≈ 970、y0 ≈ 400、y1 ≈ 870
  assert.deepEqual(r, { x: 420, y: 340, w: 630, h: 590 });
  const edge = HoldKit.cropSuggest(grid(100, 0, 0, 50), 600, 600);
  assert.deepEqual([edge.x, edge.y], [0, 0]);
  assert.ok(edge.x + edge.w <= 600 && edge.y + edge.h <= 600);
});

test('零星的誤判（遠處一兩顆）不會把框拉大；分數低的框夠多時不看', () => {
  const base = grid(100, 500, 400, 50), r = HoldKit.cropSuggest(base, 2000, 1500);
  assert.deepEqual(HoldKit.cropSuggest([...base, [1900, 1400, 1950, 1450, 0.9]], 2000, 1500), r);
  assert.deepEqual(HoldKit.cropSuggest([...base, ...grid(20, 1500, 50, 20, 0.3)], 2000, 1500), r);
});
