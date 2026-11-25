// tools/wall-republish.mjs 的純函式：切版本（每版 ≤ 30%）與研究記錄
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { planVersions, recordFor, stepLimit, polysOf, retiredOf } from './wall-republish.mjs';

const require = createRequire(import.meta.url);
const { checkVersion } = require('../functions/wall-check.js');

const sq = (x, y, s = 40) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const ring = (p) => [[...p, p[0]]];
function wall(n, retired = []) {
  const nodes = [], marks = [];
  for (let i = 0; i < n; i++) {
    const id = `h${String(i).padStart(3, '0')}`;
    nodes.push({ id, type: 'hold', ...(retired.includes(id) ? { props: { retired: true } } : {}) });
    marks.push({ node: id, geometry: { type: 'Polygon', coordinates: ring(sq(10 + (i % 20) * 50, 10 + Math.floor(i / 20) * 50)) } });
  }
  return { climbio: 2, kind: 'view', surface: 'photo', id: 'photo0001', w: 2000, h: 1000, license: 'CC-BY-SA-4.0', nodes, marks };
}
const moved = (view, ids, d = 3) => Object.fromEntries(ids.map(id => [id, polysOf(view)[id].map(([x, y]) => [x + d, y + d])]));

test('stepLimit 跟發佈端同一個算法：30%，至少 3', () => {
  assert.equal(stepLimit(10), 3);
  assert.equal(stepLimit(100), 30);
  assert.equal(stepLimit(282), 85);
});

test('整面都改：切成多個版本，每版 ≤ 30%，最後等於全部新外框，且逐版通過發佈端驗證', () => {
  const prev = wall(100), ids = Object.keys(polysOf(prev)), next = moved(prev, ids);
  const views = planVersions({ prev, next });
  assert.equal(views.length, 4);   // 30、30、30、10
  let before = prev;
  for (const v of views) { checkVersion(v, before); before = v; }
  assert.deepEqual(polysOf(views.at(-1)), Object.fromEntries(Object.entries(next).map(([k, v]) => [k, v.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10])])));
});

test('first 的岩點放在最前面的版本（路線最早就完整）', () => {
  const prev = wall(100), ids = Object.keys(polysOf(prev)), next = moved(prev, ids), first = ['h099', 'h098'];
  const [v1] = planVersions({ prev, next, first });
  const p1 = polysOf(v1), p0 = polysOf(prev);
  for (const id of first) assert.notDeepEqual(p1[id], p0[id]);
});

test('停用與改回有效：停用的不改外框也算一個變動；改回有效會拿掉 retired', () => {
  const prev = wall(20, ['h003']);
  const [v] = planVersions({ prev, next: {}, retire: ['h001'], unretire: ['h003'] });
  assert.deepEqual([...retiredOf(v)], ['h001']);
});

test('新增的岩點（prev 沒有的 id）會進畫面', () => {
  const prev = wall(20), [v] = planVersions({ prev, next: { hnew: sq(900, 900) } });
  assert.ok(v.nodes.some(n => n.id === 'hnew') && polysOf(v).hnew);
});

test('沒有任何真的改動：不產生版本', () => {
  const prev = wall(20), same = { h000: polysOf(prev).h000 };
  assert.equal(planVersions({ prev, next: same }).length, 0);
});

test('研究記錄：相對精修前的有效岩點，停用算刪除、新增算補，且不寫 final', () => {
  const base = wall(30, ['h029']), final = JSON.parse(JSON.stringify(base));
  const [v] = planVersions({ prev: base, next: { h000: sq(500, 500, 80), hnew: sq(900, 900) }, retire: ['h001'], unretire: ['h029'] });
  const rec = recordFor({ base, final: v, sha256: 'x', tools: { by: 'agent' }, reviewed: true, reviews: [{ by: 'human:t', kind: 'human', said: 'ok' }] });
  assert.ok(final);
  assert.equal(rec.reviewed, true);
  assert.deepEqual(rec.deleted.map(x => x.id), ['h001']);
  assert.deepEqual(rec.added.sort(), ['h029', 'hnew']);
  assert.deepEqual(rec.reshaped.map(x => x.id), ['h000']);
  assert.equal(rec.final, undefined);
  assert.equal(rec.reviews.length, 1);
});
