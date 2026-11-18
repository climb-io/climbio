import test from 'node:test';
import assert from 'node:assert/strict';
import { RouteKit } from './routekit.mjs';

// 定線的規則（routekit/editor.js）：點岩點加進路線、改類型、拿掉；起攀上限；出手順序
const { tapHold, appendSeq, popSeq, MAX_START } = RouteKit;

test('點一顆：加進來、類型不同就改、類型一樣就拿掉（出手順序裡的也拿掉）', () => {
  const r = { holds: {} };
  assert.equal(tapHold(r, 'a', 'h'), 'added');
  assert.equal(tapHold(r, 'a', 'f'), 'changed');
  assert.deepEqual(r.holds, { a: 'f' });
  appendSeq(r, 'a');
  assert.equal(tapHold(r, 'a', 'f'), 'removed');
  assert.deepEqual(r, { holds: {} });
});

test('剛加進來的同一顆快速點兩下不算拿掉', () => {
  const r = { holds: {} };
  tapHold(r, 'a', 's');
  assert.equal(tapHold(r, 'a', 's', { justAdded: true }), 'ignored');
  assert.deepEqual(r.holds, { a: 's' });
});

test('起攀滿了：新的點改成手點，已在路線上的不動', () => {
  const r = { holds: {} };
  for (let i = 0; i < MAX_START; i++) tapHold(r, 's' + i, 's');
  assert.equal(tapHold(r, 'n', 's'), 'added');
  assert.equal(r.holds.n, 'h');
  assert.equal(tapHold(r, 'n', 's'), 'full');
  assert.equal(r.holds.n, 'h');
});

test('出手順序：追加一手、同一顆可以重複；收回時順便加進來的岩點一起拿掉', () => {
  const r = { holds: { a: 's' } };
  assert.equal(appendSeq(r, 'a'), false);
  assert.equal(appendSeq(r, 'b'), true);
  appendSeq(r, 'a');
  assert.deepEqual(r.seq, ['a', 'b', 'a']);
  popSeq(r, false);
  popSeq(r, true);
  assert.deepEqual(r, { holds: { a: 's' }, seq: ['a'] });
  popSeq(r, false);
  assert.deepEqual(r, { holds: { a: 's' } });
});
