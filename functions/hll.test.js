const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { newRegs, add, merge, estimate, encode, decode } = require('./hll');

const h = s => createHash('sha256').update(s).digest('hex');

test('每天不重複機器數：重複的只算一次，估計值在誤差內', () => {
  const regs = newRegs();
  assert.equal(estimate(regs), 0);
  for (let i = 0; i < 10; i++) add(regs, h(`m${i}`));
  for (let i = 0; i < 10; i++) add(regs, h(`m${i}`));   // 同一批再來一次
  assert.equal(estimate(regs), 10);
  const big = newRegs();
  for (let i = 0; i < 5000; i++) add(big, h(`machine-${i}`));
  const e = estimate(big);
  assert.ok(e > 4300 && e < 5700, `估計 ${e}`);
});

test('合併與編碼：兩天的草圖取聯集；編碼後讀回一樣；壞資料當空的', () => {
  const a = newRegs(), b = newRegs();
  for (let i = 0; i < 100; i++) add(a, h(`a${i}`));
  for (let i = 0; i < 100; i++) add(b, h(`b${i}`));
  const both = merge(a, b), e = estimate(both);
  assert.ok(e > 170 && e < 230, `聯集 ${e}`);
  assert.deepEqual([...decode(encode(a))], [...a]);
  assert.equal(estimate(decode('xx')), 0);
});
