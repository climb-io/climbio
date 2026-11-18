import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { RouteKit } from './routekit.mjs';

const draw = readFileSync(new URL('../js/draw.js', import.meta.url), 'utf8');
const bbox = poly => ({ x0: Math.min(...poly.map(p => p[0])), y0: Math.min(...poly.map(p => p[1])), x1: Math.max(...poly.map(p => p[0])), y1: Math.max(...poly.map(p => p[1])) });
const box = (x, y, size) => [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];
function badges(polys, seq, unit = 1, labels = []) {
  const holds = polys.map((poly, id) => ({ id: String(id), poly }));
  return RouteKit.seqBadges({ measureText: txt => ({ width: txt.length * 5 * unit }) }, { w: 300, h: 300 }, { holds: Object.fromEntries(holds.map(h => [h.id, 'h'])), seq: seq.map(String) }, unit, labels, holds);
}
const overlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

test('微小與細長岩點的重複編號完整位於外框之外，各種縮放皆保留間距', () => {
  for (const poly of [box(100, 100, 1), box(100, 100, 30), [[100, 100], [101, 100], [101, 150], [100, 150]]]) {
    for (const unit of [0.5, 1, 3]) {
      const [badge] = badges([poly], [0, 0, 0, 0], unit);
      assert.equal(badge.txt, '1, 2, 3, 4');
      assert.equal(overlap(badge.rect, bbox(poly)), false);
    }
  }
});

test('照片四角編號留在照片內並避開岩點', () => {
  for (const poly of [box(0, 0, 2), box(298, 0, 2), box(0, 298, 2), box(298, 298, 2)]) {
    const [{ rect }] = badges([poly], [0]);
    assert.ok(rect.x0 >= 0 && rect.y0 >= 0 && rect.x1 <= 300 && rect.y1 <= 300);
    assert.equal(overlap(rect, bbox(poly)), false);
  }
});

test('編號避開相鄰岩點、類型膠帶與其他編號', () => {
  const polys = [box(100, 100, 10), box(110, 80, 10)];
  const labels = [{ foot: true, rect: { x0: 75, y0: 80, x1: 100, y1: 100 } }];
  const result = badges(polys, [0, 1], 1, labels);
  for (const badge of result) {
    for (const poly of polys) assert.equal(overlap(badge.rect, bbox(poly)), false);
    assert.equal(overlap(badge.rect, labels[0].rect), false);
  }
  assert.equal(overlap(result[0].rect, result[1].rect), false);
});


test('多顆完全重合的候選靠近照片邊緣時，帶引線的選點仍各有獨立位置', () => {
  const ctx = vm.createContext({ RouteKit, state: { w: 300, h: 300 }, bbox });
  vm.runInContext(draw.slice(draw.indexOf('  // ---------- 幾何 ----------'), draw.indexOf('  // 兩個多邊形的面積重疊比')), ctx);
  vm.runInContext(draw.slice(draw.indexOf('  function overlapSpots('), draw.indexOf('  // ---------- 繪製')), ctx);
  for (const poly of [box(0, 0, 100), box(200, 200, 100), box(0, 0, 300)]) {
    const cands = Array.from({ length: 20 }, (_, id) => ({ id, poly }));
    const spots = [...ctx.overlapSpots(cands).values()];
    assert.equal(spots.length, 20);
    assert.equal(new Set(spots.map(s => `${s.x},${s.y}`)).size, 20);
    for (const s of spots) assert.ok(s.x > 0 && s.x < 300 && s.y > 0 && s.y < 300);
  }
});

test('同一條路線移動視角時編號不換邊：只跟著岩點走，手順改了才重挑', () => {
  const c = { measureText: txt => ({ width: txt.length * 5 }) }, scene = { w: 300, h: 300 };
  const route = { holds: { a: 'h', b: 'h' }, seq: ['a', 'b'] };
  const at = (b0, b1) => RouteKit.seqBadges(c, scene, route, 1, [], [{ id: 'a', poly: box(...b0, 10) }, { id: 'b', poly: box(...b1, 10) }]);
  const side = (badge, x, y) => [Math.sign(badge.x - (x + 5)), Math.sign(badge.y - (y + 5))];
  const first = at([100, 100], [200, 200]);
  // 第二顆移到第一顆編號原本的右上方：重挑會換邊，記住的方向不換
  const moved = at([100, 100], [112, 82]);
  assert.deepEqual(side(moved[0], 100, 100), side(first[0], 100, 100));
  assert.ok(Math.abs(moved[1].x - (first[1].x - 88)) < 1e-9);
  route.seq = ['b', 'a'];
  assert.equal(at([100, 100], [112, 82]).length, 2);
});
