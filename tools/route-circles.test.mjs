import test from 'node:test';
import assert from 'node:assert/strict';
import { RouteKit } from './routekit.mjs';

// 圈點格式的路線（routekit/circles.js，例如 RouteMake 的 { x, y, t, r }）和 RouteKit 路線互轉
const { fromCircles, toCircles, inPoly } = RouteKit;
const W = 1000, H = 800;
const square = (id, x, y, s) => ({ id, poly: [[x, y], [x + s, y], [x + s, y + s], [x, y + s]] });
const holds = [square('a', 100, 100, 50), square('b', 300, 300, 70), square('big', 500, 400, 300), square('small', 600, 500, 40)];

test('圈圈中心對到包住它的岩點（大岩點上的小點對到小的那顆），起攀、完攀優先', () => {
  const route = fromCircles([
    { x: 12.5, y: 15.625, t: 's', r: 2 },   // a 的中心
    { x: 33.5, y: 41.875, t: 'h', r: 2 },   // b
    { x: 62, y: 65, t: 't', r: 1 },         // small（也在 big 裡）
    { x: 12, y: 15, t: 'h', r: 1 },         // 又點到 a：起攀不被蓋掉
  ], W, H, { holds });
  assert.deepEqual(route, { holds: { a: 's', b: 'h', small: 't' } });
});

test('圈心偏在岩點外：圈圈範圍內取最近的岩點，範圍外才用圓形外框', () => {
  // r=1：直徑 45、半徑 22.5。a 的右邊緣在 x=150：圈心 x=160（距 10）對到 a，x=190（距 40）對不到
  const near = fromCircles([{ x: 16, y: 15.625, t: 'h', r: 1 }], W, H, { holds });
  assert.deepEqual(near, { holds: { a: 'h' } });
  const far = fromCircles([{ x: 19, y: 15.625, t: 'h', r: 1 }], W, H, { holds });
  assert.deepEqual(Object.keys(far.shapes), ['c0']);
});

test('對不到岩點（或沒給岩點）的用圓形外框放進 shapes，大小照 r', () => {
  const route = fromCircles([{ x: 90, y: 10, t: 'x', r: 3 }], W, H, { holds });
  assert.deepEqual(route.holds, { c0: 'h' });   // 不認得的 t 當手點
  const p = route.shapes.c0.poly, xs = p.map(q => q[0]);
  assert.ok(inPoly(900, 80, p));
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 100) < 1);   // 直徑＝照片寬 10%
});

test('路線 → 圈點：外接框中心、最接近的大小；腳點當手點', () => {
  const circles = toCircles({ holds: { a: 's', b: 'f', big: 't' } }, holds, W, H);
  assert.deepEqual(circles, [
    { x: 12.5, y: 15.63, t: 's', r: 1 },
    { x: 33.5, y: 41.88, t: 'h', r: 2 },
    { x: 65, y: 68.75, t: 't', r: 3 },
  ]);
  assert.deepEqual(fromCircles(circles, W, H, { holds }).holds, { a: 's', b: 'h', big: 't' });
});
