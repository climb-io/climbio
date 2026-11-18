import test from 'node:test';
import assert from 'node:assert/strict';
import { RouteKit } from './routekit.mjs';

// 看線時路線岩點上原色（routekit/base.js 的 routeLayers）：路線上的 volume 整顆染色，選進路線、鎖在上面的照樣原色
const ctx = RouteKit;
const box = (id, x0, y0, x1, y1) => ({ id, poly: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const vol = box('vol', 100, 100, 400, 400), a = box('a', 150, 150, 190, 190), b = box('b', 300, 300, 340, 340);
const big = box('big', 120, 120, 420, 380);   // 大顆的鎖在 volume 上、一半超出去
const away = box('away', 600, 600, 640, 640), twin = box('twin', 101, 101, 399, 399);   // 遠處的、跟 volume 一樣大的
const ids = (list) => Array.from(list, x => (x.h || x).id);   // riders 是 { h, host }

test('只選 volume：上面的岩點蓋色（大顆、跨出去的也算），遠處的和一樣大的不算', () => {
  const L = ctx.routeLayers([vol], [vol, a, b, big, away, twin]);
  assert.deepEqual([ids(L.base), ids(L.riders), ids(L.on)], [['vol'], ['a', 'b', 'big'], []]);
  assert.ok(L.riders.every(r => r.host === vol));
  assert.deepEqual(ids(L.volumes), ['vol']);
});

test('volume 和上面的一顆都選：選了的那顆補回原色，沒選的照樣蓋色', () => {
  const L = ctx.routeLayers([vol, a], [vol, a, b]);
  assert.deepEqual([ids(L.base), ids(L.riders), ids(L.on)], [['vol'], ['b'], ['a']]);
});

test('沒有疊在一起的路線不受影響', () => {
  const L = ctx.routeLayers([a, away], [vol, a, b, away]);
  assert.deepEqual([ids(L.base), ids(L.riders), ids(L.on)], [['a', 'away'], [], []]);
  assert.deepEqual(ids(L.volumes), []);
});

test('上面沒偵測到岩點的大 volume 也染色（面積是中位數的 8 倍以上）', () => {
  const L = ctx.routeLayers([vol, a], [vol, a, away, box('c', 700, 700, 740, 740)]);
  assert.deepEqual(ids(L.volumes), ['vol']);
});

test('volume 疊在 volume 上：上面的點算最小的那顆，兩顆都染（大的先染）', () => {
  const top = box('top', 120, 120, 260, 260);   // 疊在 vol 上的小 volume，a 在它上面
  const L = ctx.routeLayers([vol, top], [vol, top, a, b, away]);
  assert.deepEqual(Array.from(L.riders, r => [r.h.id, r.host.id]), [['a', 'top'], ['b', 'vol']]);
  assert.deepEqual([ids(L.on), ids(L.volumes)], [['top'], ['vol', 'top']]);
});

test('選進路線、疊在 volume 上的大點（上面沒有點）不染，維持原色', () => {
  const huge = box('huge', 0, 0, 900, 900), mid = box('mid', 100, 100, 400, 400);
  const L = ctx.routeLayers([huge, mid], [huge, mid, away]);
  assert.deepEqual([ids(L.on), ids(L.volumes)], [['mid'], ['huge']]);
});

test('選進路線、疊在 volume 上的小點：上面有重疊偵測到的點也不算 volume', () => {
  const dup = box('dup', 155, 155, 185, 185);   // 疊在 a 上、重疊偵測到的小點
  const L = ctx.routeLayers([vol, a], [vol, a, dup, b, away, box('c', 700, 700, 740, 740)]);
  assert.deepEqual([ids(L.on), ids(L.volumes)], [['a'], ['vol']]);
});

test('只有邊緣壓到 volume 一小塊的不算鎖在上面（外框畫得不準），大半壓在上面的算', () => {
  const edge = box('edge', 380, 200, 440, 240), most = box('most', 360, 260, 420, 300);   // 壓進去三成、六成多
  const L = ctx.routeLayers([vol], [vol, edge, most]);
  assert.deepEqual(ids(L.riders), ['most']);
});
