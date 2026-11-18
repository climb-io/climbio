import test from 'node:test';
import assert from 'node:assert/strict';
import { RouteKit } from './routekit.mjs';

// 腳點的短膠帶（routekit/labels.js 的 typeLabels）
globalThis.document ??= { createElement: () => ({ getContext: () => ({ measureText: () => ({ width: 10 }) }) }) };
function labels(polys, unit = 1) {
  const holds = polys.map((poly, i) => ({ id: String(i), poly }));
  return RouteKit.typeLabels({ w: 300, h: 300, holds }, holds, { holds: Object.fromEntries(holds.map(h => [h.id, 'f'])) }, unit);
}
const box = (x, y, size) => [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];

test('微小、細長、凹形腳點的短膠帶緊貼輪廓且向外延伸，縮放後也一致', () => {
  const polys = [box(60, 60, 1), [[130, 60], [131, 60], [131, 100], [130, 100]], [[180, 180], [200, 180], [200, 185], [185, 185], [185, 200], [180, 200]]];
  for (const unit of [0.5, 1, 3]) labels(polys, unit).forEach((label, i) => {
    const dx = Math.cos(label.a), dy = Math.sin(label.a);
    const edge = Math.max(...polys[i].map(([x, y]) => x * dx + y * dy));
    const clearance = label.sx * dx + label.sy * dy - edge;
    assert.ok(Math.abs(clearance) < 1e-8, `腳點 ${i} 的膠帶必須貼齊輪廓，不留縫也不壓進岩點`);
  });
});

test('照片四角的腳點標示留在照片範圍內', () => {
  for (const poly of [box(0, 0, 2), box(298, 0, 2), box(0, 298, 2), box(298, 298, 2)]) {
    const [{ rect }] = labels([poly]);
    assert.ok(rect.x0 >= 0 && rect.y0 >= 0 && rect.x1 <= 300 && rect.y1 <= 300);
  }
});

test('平直岩點的膠帶貼在邊的中間，不只碰到角落', () => {
  const [label] = labels([box(100, 100, 20)]);
  assert.ok(Math.abs(label.sx - 110) < 1e-8);
  assert.ok(Math.abs(label.sy - 120) < 1e-8);
});
