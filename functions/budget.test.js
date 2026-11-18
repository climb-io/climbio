const { test } = require('node:test');
const assert = require('node:assert/strict');
const { budgetState, applyBudget, whenUploadsOn } = require('./budget');

function fakeDb(start) {
  let doc = start;
  return { doc: () => doc, collection: () => ({ doc: () => ({
    get: async () => ({ get: (k) => doc && doc[k] }), set: async (v) => { doc = v; },
  }) }) };
}

test('花費到了預算就停止上傳，沒到就開著；格式不對不動', () => {
  assert.deepEqual(budgetState({ costAmount: 49.9, budgetAmount: 50 }, 1), { off: false, cost: 49.9, budget: 50, t: 1 });
  assert.equal(budgetState({ costAmount: 50, budgetAmount: 50 }, 1).off, true);
  assert.equal(budgetState({ costAmount: 0, budgetAmount: 50 }, 1).off, false);   // 下個月歸零：自動恢復
  for (const m of [null, {}, { costAmount: 'x', budgetAmount: 50 }, { costAmount: 1, budgetAmount: 0 }]) assert.equal(budgetState(m, 1), null);
});

test('預算通知寫進 config/uploads；看不懂的不寫', async () => {
  const db = fakeDb({ off: false });
  await applyBudget(db, { costAmount: 60, budgetAmount: 50 }, 2);
  assert.deepEqual(db.doc(), { off: true, cost: 60, budget: 50, t: 2 });
  await applyBudget(db, { nope: 1 }, 3);
  assert.equal(db.doc().t, 2);
});

test('停止上傳時，上傳類的函式回 503、不執行', async () => {
  const res = () => { const r = { headers: {}, set(k, v) { r.headers[k] = v; return r; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
  let ran = 0;
  const handler = async (req, r) => { ran++; return r.status(200).json({ ok: true }); };
  const off = res(); await whenUploadsOn(fakeDb({ off: true }), handler)({}, off);
  assert.equal(off.code, 503); assert.equal(ran, 0);
  const on = res(); await whenUploadsOn(fakeDb(undefined), handler)({}, on);
  assert.equal(on.code, 200); assert.equal(ran, 1);
});
