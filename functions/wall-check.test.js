const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkVersion, validPoly } = require('./wall-check');

const W = 1000, H = 800;
const sq = (x, y, s = 40) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const view = (holds, o = {}) => ({ kind: 'view', w: W, h: H, nodes: holds.map(([id, , retired]) => ({ id, type: 'hold', ...(retired ? { props: { retired: true } } : {}) })),
  marks: holds.map(([id, poly]) => ({ node: id, geometry: { type: 'Polygon', coordinates: [[...poly, poly[0]]] } })), ...o });
const ten = () => Array.from({ length: 10 }, (_, i) => [`h${i}`, sq(50 + i * 60, 100)]);
const status = fn => { try { fn(); return 200; } catch (e) { return e.status; } };

test('外框合理：點數、範圍、面積、自交', () => {
  assert.equal(validPoly(sq(10, 10), W, H), true);
  assert.equal(validPoly([[0, 0], [10, 0]], W, H), false, '少於 3 點');
  assert.equal(validPoly(sq(990, 10, 40), W, H), false, '超出照片');
  assert.equal(validPoly(sq(10, 10, 2), W, H), false, '太小');
  assert.equal(validPoly(sq(10, 10, 700), W, H), false, '超過照片的 4 成');
  assert.equal(validPoly([[0, 0], [40, 40], [40, 0], [0, 40]], W, H), false, '自己交叉');
});

test('第一版只看外框是否合理', () => {
  assert.deepEqual(checkVersion(view(ten()), null), { holds: 10, changed: 10 });
  assert.equal(status(() => checkVersion(view([['a', [[0, 0], [1, 1]]]]), null)), 400);
  assert.equal(status(() => checkVersion({ kind: 'set' }, null)), 400);
});

test('新版本：不能少掉前一版的岩點，刪掉的要標成停用', () => {
  const prev = view(ten());
  assert.equal(status(() => checkVersion(view(ten().slice(1)), prev)), 409, '少一顆');
  const retired = ten().map(([id, p], i) => (i === 0 ? [id, p, true] : [id, p]));
  assert.equal(checkVersion(view(retired), prev).changed, 1, '標成 retired 算一個變動');
});

test('新版本：照片尺寸要一樣；變動超過 30% 拒絕（至少允許 3 顆）', () => {
  const prev = view(ten());
  assert.equal(status(() => checkVersion(view(ten(), { w: 1200 }), prev)), 409);
  const moved = n => ten().map(([id, p], i) => (i < n ? [id, sq(p[0][0] + 5, p[0][1] + 5)] : [id, p]));
  assert.equal(checkVersion(view(moved(3)), prev).changed, 3);
  assert.equal(status(() => checkVersion(view(moved(4)), prev)), 409);
  assert.equal(checkVersion(view([...ten(), ['n1', sq(700, 400)]]), prev).changed, 1, '新增一顆');
});
