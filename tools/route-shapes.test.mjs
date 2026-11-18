import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { RouteKit } from './routekit.mjs';

// 原始岩點檔、我的岩點檔、路線自帶外框（js/draw.js 的 settleWall、tapHolds；routekit/image.js 的 routeHolds）
const source = readFileSync(new URL('../js/draw.js', import.meta.url), 'utf8');
function load(wall, cur = null, mode = 'route') {
  const ctx = vm.createContext({ RouteKit,  state: { wall, mode }, route: () => cur });
  vm.runInContext(source.slice(source.indexOf('  // ---------- 原始岩點檔與路線外框'), source.indexOf("  for (const el of document.querySelectorAll('.sw-slot'))")), ctx);
  return ctx;
}
const box = (x, s = 10) => [[x, 0], [x + s, 0], [x + s, s], [x, s]];
const plain = v => JSON.parse(JSON.stringify(v));

test('計算的結果進原始岩點檔；點進路線時複製外框', () => {
  const a = { id: 'a', poly: box(0), source: 'detect' }, m = { id: 'm', poly: box(50), source: 'manual' };
  const r = { id: 'r', holds: { a: 'h', m: 's' } };
  const w = { holds: [a, m], routes: [r] };
  load(w).settleWall(w);
  assert.deepEqual(plain(w.base.holds), [{ id: 'a', poly: box(0) }], '只有計算的（detect）進原始岩點檔');
  assert.deepEqual(plain(r.shapes.a), { id: 'a', poly: box(0), source: 'detect' });
  assert.equal(r.shapes.m.source, 'manual');
  assert.notEqual(r.shapes.a.poly, a.poly, '外框是複本，拖頂點原地改我的岩點檔不會動到路線');
});

test('重描更新還是計算結果的岩點：原始岩點檔、路線裡沒手動改過的都跟著換；手動改過的不進原始岩點檔，也不動路線', () => {
  const a = { id: 'a', poly: box(0), source: 'detect' }, b = { id: 'b', poly: box(20), source: 'detect' };
  const r = { id: 'r', holds: { a: 'h', b: 'h' } }, w = { holds: [a, b], routes: [r] };
  const ctx = load(w);
  ctx.settleWall(w);
  a.poly = box(0, 12);   // 重描（計算）
  b.poly = box(20, 14); b.source = 'edited';   // 手動修框
  ctx.settleWall(w);
  assert.deepEqual(plain(w.base.holds.find(h => h.id === 'a').poly), box(0, 12));
  assert.deepEqual(plain(w.base.holds.find(h => h.id === 'b').poly), box(20), '手動改的不混進原始岩點檔');
  assert.deepEqual(plain(r.shapes.a.poly), box(0, 12));
  assert.deepEqual(plain(r.shapes.b.poly), box(20), '路線保留點進去時的外框');
});

test('從我的岩點檔刪掉的岩點，路線照樣看得到、點得到；拿出路線才丟掉外框', () => {
  const a = { id: 'a', poly: box(0), source: 'detect' };
  const r = { id: 'r', holds: { a: 'h' } }, w = { holds: [a], routes: [r] };
  let ctx = load(w, r);
  ctx.settleWall(w);
  w.holds = [];
  ctx.settleWall(w);
  assert.deepEqual(plain(RouteKit.routeHolds(r, w.holds).map(h => h.id)), ['a']);
  assert.deepEqual(plain(ctx.tapHolds().map(h => h.id)), ['a'], '定線時點得到，才能從路線拿掉');
  assert.equal(load(w, r, 'holds').tapHolds().length, 0, '岩點編輯只看我的岩點檔');
  assert.equal(w.base.holds.length, 1, '原始岩點檔不跟著刪');
  delete r.holds.a;
  ctx.settleWall(w);
  assert.deepEqual(plain(r.shapes), {});
});

test('還沒複製外框的路線岩點先用我的岩點檔那顆；計算拿掉的岩點也從原始岩點檔拿掉', () => {
  const a = { id: 'a', poly: box(0), source: 'detect' }, w = { holds: [a], routes: [] };
  const ctx = load(w);
  assert.equal(RouteKit.routeHolds({ holds: { a: 'h' } }, w.holds)[0], a);
  ctx.settleWall(w);
  ctx.dropBase(w, new Set(['a']));
  assert.equal(w.base.holds.length, 0);
});
