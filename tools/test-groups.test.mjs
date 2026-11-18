// 測試分組（tools/test-groups.mjs）：每個測試檔恰好屬於一個產品。新增測試沒歸屬、或兩個產品都認領，就在這裡失敗，
// 不會有測試沒人跑、或只靠完整回歸才跑到。
import test from 'node:test';
import assert from 'node:assert/strict';
import { allTests, ownersOf, filesOf, PRODUCTS } from './test-groups.mjs';

test('每個測試檔恰好屬於一個產品', () => {
  const { unit, e2e } = allTests();
  const bad = [...unit, ...e2e].map(f => [f, ownersOf(f)]).filter(([, o]) => o.length !== 1).map(([f, o]) => `${f}：${o.length ? '重複歸屬 ' + o.join('、') : '沒有歸屬'}`);
  assert.deepEqual(bad, [], '在 tools/test-groups.mjs 把它加進對應的產品');
});

test('filesOf 取得產品的測試，所有產品加起來就是全部', () => {
  const all = allTests(), got = filesOf(...Object.keys(PRODUCTS));
  assert.deepEqual(got.unit.sort(), [...all.unit].sort());
  assert.deepEqual(got.e2e.sort(), all.e2e.map(f => f.slice('tests/e2e/'.length)).sort());
  // 不點名某個 spec 檔：公開版只帶一部分 e2e，檔案不一定在
  const redpoint = filesOf('redpoint').e2e;
  assert.ok(redpoint.every(f => ownersOf(`tests/e2e/${f}`).join() === 'redpoint'));
  assert.ok(filesOf('studio').e2e.every(f => !redpoint.includes(f)));
  assert.throws(() => filesOf('nope'), /沒有這個產品/);
});
