import test from 'node:test';
import assert from 'node:assert/strict';
import { autoMergeCandidates } from '../redpoint/auto-merge.mjs';

const source = (id, name) => ({ id, name, url: `https://example.org/${id}` });
const area = (id, name, ancestors) => ({
  id, name, kind: 'set', props: { sourceHierarchy: [...ancestors, source(id, name)] },
});
const longdong = source('longdong', '龍洞');
const school = source('school', '校門口');
const middle = source('middle', '中塔');
const gold = source('gold', '黃金谷');
const a = area('a', '岩壁 A', [longdong, school]);
const b = area('b', '岩壁 B', [longdong, school]);
const c = area('c', '中塔 C', [longdong, middle]);
const d = area('d', '黃金谷 D', [longdong, gold]);
const home = (...docs) => ({ items: docs.map((doc) => ({ id: doc.id })) });

test('完整祖先路徑：可選校門口 A+B，或整個龍洞 A+B+C+D', () => {
  const groups = autoMergeCandidates(home(a, b, c, d), [a, b, c, d]);
  assert.deepEqual(groups.map(({ name, ids }) => ({ name, ids })), [
    { name: '校門口', ids: ['a', 'b'] },
    { name: '龍洞', ids: ['a', 'b', 'c', 'd'] },
  ]);
});

test('同上層但只一個岩場沒有候選；來源缺失不靠名字猜測', () => {
  assert.deepEqual(autoMergeCandidates(home(a, c), [a, c]).map((g) => g.name), ['龍洞']);
  assert.deepEqual(autoMergeCandidates(home(a), [a]), []);
  assert.deepEqual(autoMergeCandidates(home(a, { ...b, props: {} }), [a, { ...b, props: {} }]), []);
});

test('排除已經手動合併的合集和全部成員，不重複合併', () => {
  const merged = { id: 'merged', kind: 'set', props: { merged: true }, items: [{ id: 'a' }, { id: 'b' }] };
  assert.deepEqual(autoMergeCandidates(home(merged, c, d), [merged, a, b, c, d]).map((g) => g.name), ['龍洞']);
  assert.deepEqual(autoMergeCandidates(home(merged, a, b, c), [merged, a, b, c]), []);
});

test('不同來源的同名上層不可混在一起', () => {
  const e = area('e', '岩壁 E', [source('another-longdong', '龍洞'), school]);
  assert.deepEqual(autoMergeCandidates(home(a, e), [a, e]), []);
});
