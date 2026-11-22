// 岩點報告（studio/wall/report.js）：從精修記錄還原各步、跟答案比的分類與每 100 顆的數字、最後一步標出人改了哪裡。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildRecord } = require('../studio/wall/record.js');
const R = require('../studio/wall/report.js');
const sq = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const W = 2000, H = 1000;

test('跟答案比：可用、切掉一角、太大、多認、漏掉', () => {
  const answers = [sq(100, 100, 100), sq(400, 100, 100), sq(700, 100, 100), sq(1000, 100, 100)];
  const polys = [sq(100, 100, 100), [[400, 100], [500, 100], [500, 160], [400, 160]], sq(680, 80, 140), sq(1500, 500, 50)];
  const g = R.grade(polys, answers, W, H);
  assert.deepEqual(g.kinds, ['ok', 'cut', 'over', 'extra']);
  assert.deepEqual(g.hit, [true, true, true, false]);
  assert.deepEqual(g.per100, { found: 75, ok: 25, extra: 25 });
});

test('一顆答案只配一次：重複框同一顆，多的算多認', () => {
  const g = R.grade([sq(100, 100, 100), sq(102, 100, 100)], [sq(100, 100, 100)], W, H);
  assert.deepEqual(g.kinds, ['ok', 'extra']);
});

test('從精修記錄還原自動偵測與 SAM2，最後一步標出改、刪、補', () => {
  const base = { keep: { poly: sq(100, 100, 100), flags: [] }, bad: { poly: sq(700, 100, 100), flags: [] }, gone: { poly: sq(1000, 100, 100), flags: [] } };
  const holds = [{ id: 'keep', poly: sq(100, 100, 100), sam: { poly: sq(98, 98, 104), pick: 'sam', iou: .9 } }, { id: 'bad', poly: sq(740, 100, 100) }, { id: 'new1', poly: sq(1300, 100, 100) }];
  const record = buildRecord({ id: 'w', sha256: 'x', license: 'CC-BY-SA-4.0', reviewed: false, tools: {}, base, holds, w: W, h: H });
  const stages = R.fromRecord(record, holds);
  assert.deepEqual(stages.map(s => s.id), ['holdscan', 'sam2', 'human']);
  assert.equal(stages[0].polys.length, 3);   // keep、bad（重描前）、gone（刪掉的）
  assert.deepEqual(stages[1].polys[0], sq(98, 98, 104));
  const a = R.analyze(stages, W, H), last = a[2];
  assert.equal(last.answer, true);
  assert.equal(last.reviewed, false);
  assert.deepEqual(last.counts, { kept: 1, edited: 1, manual: 1, deleted: 1 });
  assert.equal(a[0].counts.extra, 1);   // 刪掉的那顆在自動偵測算多認
  assert.equal(a[0].counts.missed, 1);  // 補畫的那顆在自動偵測算漏掉
});

test('沒有精修記錄就沒有報告；開放資料集的比對資料只取外框', () => {
  assert.equal(R.fromRecord(null, []), null);
  assert.equal(R.fromStages({ version: 1, stages: [] }), null);
  const s = R.fromStages({ version: 2, stages: [{ id: 'holdscan', polys: [sq(1, 1, 5)], kinds: ['ok'], per100: {} }, { id: 'ai', polys: [sq(1, 1, 5)] }] });
  assert.deepEqual(s, [{ id: 'holdscan', polys: [sq(1, 1, 5)] }, { id: 'ai', polys: [sq(1, 1, 5)] }]);
});

test('公開格式的畫面：GeoJSON 的環去掉重複的終點，停用的岩點不算', () => {
  const ring = [...sq(0, 0, 10), [0, 0]];
  const view = { nodes: [{ id: 'a', type: 'hold' }, { id: 'b', type: 'hold', props: { retired: true } }], marks: [{ node: 'a', geometry: { type: 'Polygon', coordinates: [ring] } }, { node: 'b', geometry: { type: 'Polygon', coordinates: [ring] } }] };
  assert.deepEqual(R.holdsOf(view), [{ id: 'a', poly: sq(0, 0, 10) }]);
});

test('岩點貓的精修記錄：畫面是原始岩點，人工檢查換上 final、去掉刪掉的、加上手畫的', () => {
  const holds = [{ id: 'a', poly: sq(100, 100, 100) }, { id: 'b', poly: sq(400, 100, 100) }, { id: 'c', poly: sq(700, 100, 100) }];
  const record = { tools: { by: 'phone' }, deleted: [{ id: 'c', poly: sq(700, 100, 100) }], reshaped: [{ id: 'b', poly: sq(400, 100, 100) }], added: ['n'], final: { b: sq(440, 100, 100), n: sq(1300, 100, 100) }, sam: {} };
  const s = R.fromRecord(record, holds);
  assert.deepEqual(s.map(x => x.id), ['holdscan', 'human']);
  assert.deepEqual(s[0].ids, ['a', 'b', 'c']);
  assert.deepEqual(s[1].ids, ['a', 'b', 'n']);
  assert.deepEqual(R.analyze(s, W, H)[1].counts, { kept: 1, edited: 1, manual: 1, deleted: 1 });
});
