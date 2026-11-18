// 路線合併（js/sync.js 的 mergeRoutes）：收線、收下新線共用；只跑合併邏輯，不連 Firebase。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const sync = readFileSync(new URL('../js/sync.js', import.meta.url), 'utf8');
const line = (src, name) => src.split('\n').find(l => l.includes(`const ${name} =`));
const block = (src, head) => { const i = src.indexOf(head); return src.slice(i, src.indexOf('\n  }\n', i) + 4); };
function setup() {
  const ctx = vm.createContext({});
  vm.runInContext(`${line(app, 'deadKey')}\n${line(sync, 'liveIn')}\n${block(sync, '  function mergeRoutes(')}\nthis.mergeRoutes = mergeRoutes;`, ctx);
  return { mergeRoutes: ctx.mergeRoutes };
}
const id = (ms, tail = 'aaaaa') => 'r' + ms.toString(36) + tail;
const T1 = 1793000000000, T2 = T1 + 60000;

test('同一個 id：修改時間晚的贏', () => {
  const { mergeRoutes } = setup();
  const w = { id: 'w', routes: [{ id: id(T1), t: 1, grade: 'V3', holds: { a: 's' } }] };
  mergeRoutes(w, [{ id: id(T1), t: 2, grade: 'V4', holds: { a: 's' } }]);
  assert.deepEqual(JSON.parse(JSON.stringify(w.routes.map(r => r.grade))), ['V4']);
});

test('點和角色都一樣、id 不同：不比對，都留著', () => {
  const { mergeRoutes } = setup();
  const first = { id: id(T1), t: 5, holds: { a: 's', b: 't' } }, later = { id: id(T2), t: 9, holds: { b: 't', a: 's' }, sent: 1 };
  const w = { id: 'w', routes: [later] };
  mergeRoutes(w, [first]);
  assert.deepEqual(JSON.parse(JSON.stringify(w.routes.map(r => [r.id, r.sent]))), [[later.id, 1], [first.id, null]]);
});

test('同一個 id 對方的版本較新：取代內容，本地的完攀留著', () => {
  const { mergeRoutes } = setup();
  const w = { id: 'w', routes: [{ id: id(T1), t: 1, grade: 'V3', holds: { a: 's' }, sent: 1 }] };
  mergeRoutes(w, [{ id: id(T1), t: 2, grade: 'V4', holds: { a: 's' } }]);
  assert.deepEqual(JSON.parse(JSON.stringify(w.routes.map(r => [r.grade, r.sent]))), [['V4', 1]]);
});

test('id 不同就是不同的線', () => {
  const { mergeRoutes } = setup();
  const w = { id: 'w', routes: [{ id: id(T1), t: 1, holds: { a: 's', b: 't' } }, { id: id(T1, 'bbbbb'), t: 1, holds: {} }] };
  mergeRoutes(w, [{ id: id(T2), t: 1, holds: { a: 'h', b: 't' } }, { id: id(T2, 'ccccc'), t: 1, holds: {} }]);
  assert.equal(w.routes.length, 4);
});

test('刪得比路線新的拿掉；收線排在最前面', () => {
  const { mergeRoutes } = setup();
  const w = { id: 'w', routes: [{ id: id(T1), t: 1, holds: { a: 's' } }], deleted: { routes: { [id(T2, 'ddddd')]: 5 } } };
  mergeRoutes(w, [{ id: id(T2, 'ddddd'), t: 3, holds: { c: 's' } }, { id: id(T2), t: 1, holds: { b: 's' } }], {}, { front: true });
  assert.deepEqual(JSON.parse(JSON.stringify(w.routes.map(r => r.id))), [id(T2), id(T1)]);
});

test('刪除記路線 id：比刪除舊的拿掉，刪除之後才改的留著；同點的別條不受影響', () => {
  const { mergeRoutes } = setup();
  const w = { id: 'w', routes: [], deleted: { routes: { [id(T1)]: 5, [id(T1, 'eeeee')]: 5 } } };
  mergeRoutes(w, [{ id: id(T1), t: 3, holds: { a: 's', b: 't' } }, { id: id(T2), t: 9, holds: { b: 't', a: 's' } }, { id: id(T1, 'eeeee'), t: 6, holds: {} }]);
  assert.deepEqual(JSON.parse(JSON.stringify(w.routes.map(r => r.id))), [id(T2), id(T1, 'eeeee')]);
});

test('點連結收下、復原（got）比刪除晚就留著', () => {
  const { mergeRoutes } = setup();
  const w = { id: 'w', routes: [], deleted: { routes: { [id(T1)]: 5 } } };
  mergeRoutes(w, [{ id: id(T1), t: 3, got: 9, holds: { a: 's' } }]);
  assert.equal(w.routes.length, 1);
});
