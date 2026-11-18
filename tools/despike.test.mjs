import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { RouteKit } from './routekit.mjs';

// 外框上的細尖（js/draw.js 的 despike）：細長的突出剪掉，正常的尖角、凸塊、剛拖的頂點不動
const source = readFileSync(new URL('../js/draw.js', import.meta.url), 'utf8');
const ctx = vm.createContext({ RouteKit,  state: { w: 1000, h: 1000 } });
vm.runInContext(source.slice(0, source.indexOf('  // ---------- 繪製')), ctx);
const box = [[100, 100], [200, 100], [200, 300], [100, 300]];

test('一個頂點拉出去的細針剪掉', () => {
  const p = [[100, 100], [150, 100], [158, 40], [160, 100], [200, 100], [200, 300], [100, 300]];
  assert.deepEqual(ctx.despike(p), [[100, 100], [150, 100], [160, 100], [200, 100], [200, 300], [100, 300]]);
});

test('兩個頂點組成、有一點寬度的細長條也剪掉', () => {
  const p = [[100, 100], [150, 100], [152, 30], [158, 30], [160, 100], [200, 100], [200, 300], [100, 300]];
  assert.equal(ctx.despike(p).length, 6);
});

test('往內切進去的細縫也剪掉', () => {
  const p = [[100, 100], [150, 100], [154, 180], [158, 100], [200, 100], [200, 300], [100, 300]];
  assert.equal(ctx.despike(p).length, 6);
});

test('正常的尖角、有寬度的凸塊、一般的外框不動', () => {
  assert.equal(ctx.despike(box), box);
  const tri = [[0, 0], [300, 0], [150, 400], [140, 380]];   // 細長的三角 volume（約 40° 的角）
  assert.equal(ctx.despike(tri), tri);
  const lobe = [[100, 100], [130, 100], [120, 60], [180, 60], [170, 100], [200, 100], [200, 300], [100, 300]];
  assert.equal(ctx.despike(lobe), lobe);
});

test('剛拖的頂點就算拉成細針也留著；至少留 4 個頂點', () => {
  const p = [[100, 100], [150, 100], [158, 40], [160, 100], [200, 100], [200, 300], [100, 300]];
  assert.equal(ctx.despike(p, 2), p);
  const thin = [[0, 0], [100, 2], [0, 4], [-1, 2]];
  assert.ok(ctx.despike(thin).length >= 4);
});
