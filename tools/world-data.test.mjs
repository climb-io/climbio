import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorldFile, hydrateWorld, parseOpenClimbing, WORLD_VERSION } from '../redpoint/world-data.mjs';
import { mergeWorld } from '../redpoint/world-stacks.mjs';

const oc = (id, cc, ap, at, extra = {}) => ({ id, n: `岩場${id}`, at, rc: 10, tc: 5, cc, ap, pv: 1, ...extra });
const index = {
  crags: [
    oc(1, 'tw', ['龍洞'], [121.9, 25.1]),
    oc(2, 'de', ['Frankenjura'], [11.33229, 49.6644], { ct: 'sport', tcu: 'https://www.thecrag.com/climbing/germany/x' }),
    oc(3, 'de', ['Frankenjura'], [11.3325, 49.6646]),   // 與 2 相距不到 500 公尺：合併成一組
    { id: 4, n: '', at: [2, 48], rc: 1, tc: 1, cc: 'fr' },   // 沒有名字
  ],
};
const books = [{ id: 'b1', type: 'guidebook', name: 'Yzeron', url: 'https://x/b1', at: [4.5, 45.7], cc: 'fr', others: [{ id: 'b1b', name: '另一版', url: 'https://x/b1b' }] }];
const strip = (tree) => JSON.stringify(tree, (k, v) => (k === 'items' && Array.isArray(v) ? v.map((i) => i.key) : v));

test('世界檔讀回來跟在手機上合成的結果一樣（樹、岩場、合併分組）', () => {
  const file = JSON.parse(JSON.stringify(buildWorldFile(books, index, 5)));
  assert.equal(file.v, WORLD_VERSION);
  const pack = hydrateWorld(file), ref = mergeWorld(books, parseOpenClimbing(index));
  assert.deepEqual(pack.books, books);
  assert.deepEqual(JSON.parse(strip(pack.tree)).map((c) => [c.cc, c.count]), JSON.parse(strip(ref)).map((c) => [c.cc, c.count]));
  const group = pack.oc.find((c) => c.members);
  assert.equal(group.id, 'osm:group:2,3');
  assert.deepEqual(group.members.map((m) => [m.id, m.country, m.areaPath]), [['osm:relation:2', 'de', ['Frankenjura']], ['osm:relation:3', 'de', ['Frankenjura']]]);
  assert.equal(group.url, 'https://openclimbing.org/relation/2');
  assert.equal(group.members[0].theCragUrl, 'https://www.thecrag.com/climbing/germany/x');
});

test('樹的節點用 items 裡的位置指到同一份岩場物件，不重複存', () => {
  const file = buildWorldFile(books, index, 5), pack = hydrateWorld(JSON.parse(JSON.stringify(file)));
  const de = pack.tree.find((c) => c.cc === 'de');
  assert.equal(de.items.length, 1);
  assert.equal(de.items[0].crag, pack.oc.find((c) => c.members));
  assert.ok(file.tree.every((c) => (c.items ?? c.regions).every((x) => typeof x === 'number' || x.items)));
});

test('沒有名字的岩場名稱留空，由紅點貓用語系補；位置只留約 1 公尺的精度', () => {
  const file = buildWorldFile([], index, 5);
  assert.equal(file.oc.find((c) => c.osmId === 4).name ?? '', '');
  assert.ok(JSON.stringify(file).match(/\d+\.\d{6,}/) === null, '座標不留 5 位小數以後');
});

test('版本不對或結構不全的檔案不讀', () => {
  assert.equal(hydrateWorld({ v: 99, books: [], oc: [], tree: [] }), null);
  assert.equal(hydrateWorld({ v: WORLD_VERSION, books: [] }), null);
  assert.equal(hydrateWorld(null), null);
});
