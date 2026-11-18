// 研究記錄：小修不記，刪除、新增、重描各記一種，沒有自動結果時不產生記錄。
const test = require('node:test'), assert = require('node:assert/strict');
const { buildRecord } = require('./record.js');

const sq = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const base = {
  keep: { poly: sq(100, 100, 100), flags: [] },
  tweak: { poly: sq(400, 100, 100), flags: ['信心低'] },
  bad: { poly: sq(700, 100, 100), flags: [] },
  gone: { poly: sq(1000, 100, 100), flags: ['信心低'] },
};
const holds = [
  { id: 'keep', poly: sq(100, 100, 100) },
  { id: 'tweak', poly: sq(402, 101, 100) },
  { id: 'bad', poly: sq(740, 100, 100) },
  { id: 'new1', poly: sq(1300, 100, 100) },
];
const o = { id: 'w1', sha256: 'x', license: 'CC-BY-SA-4.0', reviewed: true, tools: { holdkit: '1.9.0' }, w: 2000, h: 1000 };

test('小修不記，大改記重描，刪掉記誤偵測，多出來的記漏偵測', () => {
  const r = buildRecord({ ...o, base, holds });
  assert.deepEqual(r.reshaped.map(x => x.id), ['bad']);
  assert.ok(r.reshaped[0].iou < 0.9);
  assert.deepEqual(r.deleted.map(x => x.id), ['gone']);
  assert.deepEqual(r.added, ['new1']);
  assert.deepEqual(r.flagged, { tweak: ['信心低'], gone: ['信心低'] });
  assert.equal(r.reviewed, true);
});

test('沒有自動結果就沒有記錄', () => {
  assert.equal(buildRecord({ ...o, base: undefined, holds }), null);
  assert.equal(buildRecord({ ...o, base: {}, holds }), null);
});

test('SAM2 跟原外框不同的岩點記人的選擇，一致直接採用的不記', () => {
  const hs = [
    { id: 'keep', poly: sq(100, 100, 100), sam: { poly: sq(101, 100, 100), iou: 0.98, flags: [], pick: 'auto' } },
    { id: 'tweak', poly: sq(402, 101, 100), sam: { poly: sq(430, 100, 100), iou: 0.7, flags: ['邊緣不確定'], pick: 'sam' } },
    { id: 'bad', poly: sq(740, 100, 100), sam: { poly: sq(700, 100, 100), iou: 0.6, flags: [], pick: '' } },
  ];
  const r = buildRecord({ ...o, base, holds: hs });
  assert.deepEqual(Object.keys(r.sam), ['tweak']);
  assert.equal(r.sam.tweak.pick, 'sam');
  assert.equal(r.sam.tweak.iou, 0.7);
});
