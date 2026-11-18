import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { RouteKit } from './routekit.mjs';

// 圈起來（js/draw.js 的 polyIoU、lassoBox）
const source = readFileSync(new URL('../js/draw.js', import.meta.url), 'utf8');
const ctx = vm.createContext({ RouteKit });
vm.runInContext(source.slice(source.indexOf('  // ---------- 幾何 ----------'), source.indexOf('  // 外框上的細尖')), ctx);
const sq = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];

test('polyIoU：相同是 1、不相交是 0、錯開一半是 1/3', () => {
  assert.ok(ctx.polyIoU(sq(0, 0, 100), sq(0, 0, 100)) > 0.999);
  assert.equal(ctx.polyIoU(sq(0, 0, 50), sq(200, 200, 50)), 0);
  const half = ctx.polyIoU(sq(0, 0, 100), sq(50, 0, 100));   // 交集 50×100、聯集 150×100
  assert.ok(Math.abs(half - 1 / 3) < 0.05, String(half));
});

test('polyIoU：手畫的圈（縮 15%）跟實際外框重疊約 0.72，貼齊後 > 0.9 才算貼得上', () => {
  const actual = sq(0, 0, 100), rough = sq(7.5, 7.5, 85);
  const k = ctx.polyIoU(actual, rough);
  assert.ok(k > 0.7 && k < 0.75, String(k));
});

test('lassoBox：外接框加 4% 的邊，夾在照片裡', () => {
  assert.deepEqual([...ctx.lassoBox([[100, 100], [300, 100], [300, 200], [100, 200]], 1000, 1000)], [92, 92, 308, 208]);
  assert.deepEqual([...ctx.lassoBox([[2, 2], [498, 2], [498, 98]], 500, 100)], [0, 0, 500, 100], '超出照片的邊夾住');
});
