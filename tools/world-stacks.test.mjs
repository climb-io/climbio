import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld, layout, layers, mergeWorld, worldItemsFrom, MIN_REGION, SKIP_REGION_MAX } from '../redpoint/world-stacks.mjs';

const crag = (key, cc, area, at = [2, 48]) => ({ key, cc, area, at });
const many = (n, cc, area, at) => Array.from({ length: n }, (_, i) => crag(`${cc}${area}${i}`, cc, area, at));

test('國家：同一個國碼一疊（不分大小寫），沒有國碼的另成一疊「其他」', () => {
  const world = buildWorld([crag('a', 'FR', 'x'), crag('b', 'fr', 'x'), crag('c', undefined, 'y'), crag('d', 'tw', 'z')]);
  assert.deepEqual(world.map((c) => [c.cc, c.count]).sort(), [['', 1], ['fr', 2], ['tw', 1]]);
});

test(`岩場不超過 ${SKIP_REGION_MAX} 個的國家不分地區；更多的才分，地區要至少 ${MIN_REGION} 個，其餘併成「其他」`, () => {
  const small = buildWorld(many(SKIP_REGION_MAX, 'es', 'a'));
  assert.equal(small[0].regions, null);
  const big = buildWorld([...many(8, 'fr', 'Yzeron'), ...many(MIN_REGION, 'fr', 'Doizieux'), ...many(MIN_REGION - 1, 'fr', 'Melin'), crag('n', 'fr', undefined)])[0];
  assert.deepEqual(big.regions.map((r) => [r.name, r.count, !!r.other]), [['Yzeron', 8, false], ['Doizieux', 3, false], ['', 3, true]]);
  assert.equal(big.regions.reduce((a, r) => a + r.count, 0), big.count);
});

test('排列：由北到南一列一列、列內由西到東；「其他」與沒有位置的排最後；不重疊', () => {
  const at = (lng, lat) => [lng, lat];
  const nodes = [
    { id: 'S', at: at(10, 40), cc: 's' }, { id: 'N-E', at: at(20, 60), cc: 'ne' }, { id: 'N-W', at: at(0, 60), cc: 'nw' },
    { id: 'X', at: null, cc: 'x' }, { id: 'O', at: at(5, 80), cc: '' },
  ];
  const out = layout(nodes, 2);
  assert.deepEqual(out.map((n) => [n.id, n.row, n.col]), [['N-W', 0, 0], ['N-E', 0, 1], ['S', 1, 0], ['X', 2, 0], ['O', 2, 1]]);
  assert.equal(new Set(out.map((n) => `${n.row},${n.col}`)).size, out.length);
  assert.ok(out.every((n) => n.col < 2));
});

test('厚度：岩場越多越厚，最少 1 層、最多 6 層', () => {
  assert.deepEqual([1, 3, 7, 63, 100000].map(layers), [1, 2, 3, 6, 6]);
  assert.ok(layers(300) > layers(10));
});

test('合成：Guidebook 與 OpenClimbing 合成三層樹；樹本身不排格子、不把特定國家提前', () => {
  const books = [
    { id: 'fr1', name: 'Yzeron', at: [4.5, 45.7], cc: 'fr', others: [{ id: 'fr1b', name: 'Yzeron 另一版', url: 'https://ex/b' }] },
  ];
  const oc = [
    { osmId: 1, id: 'osm:1', name: '龍洞', country: 'tw', areaPath: ['龍洞'], at: [121.9, 25.1] },
    ...many(8, 'fr', 'Yzeron', [4.5, 45.7]).map((c, i) => ({ osmId: 100 + i, id: `osm:${100 + i}`, name: c.key, country: c.cc, areaPath: [c.area], at: c.at })),
    ...many(3, 'fr', 'Doizieux', [4.6, 45.5]).map((c, i) => ({ osmId: 200 + i, id: `osm:${200 + i}`, name: c.key, country: c.cc, areaPath: [c.area], at: c.at })),
    ...many(2, 'fr', 'Melin', [4.7, 45.4]).map((c, i) => ({ osmId: 300 + i, id: `osm:${300 + i}`, name: c.key, country: c.cc, areaPath: [c.area], at: c.at })),
  ];
  const items = worldItemsFrom(books, oc);
  assert.equal(items.filter((i) => i.book).length, 2);   // 正本加另一版
  // 另一版是排第一那版的祖先（同一本書的舊版）→ 不另外列一張卡片
  assert.equal(worldItemsFrom([{ ...books[0], lineage: ['fr1b'] }]).length, 1);
  assert.equal(items.filter((i) => i.crag).length, 1 + 8 + 3 + 2);
  assert.equal(items[0].area, 'Yzeron');
  assert.equal(items.find((i) => i.crag?.osmId === 1).area, '龍洞');
  const tree = mergeWorld(books, oc);
  // 清單先放法國書、再放台灣岩場：插入順序是法、台，沒有把台灣提到第一
  assert.deepEqual(tree.map((c) => c.cc), ['fr', 'tw']);
  assert.ok(tree.every((c) => c.row == null && c.col == null));
  const fr = tree[0];
  assert.ok(fr.regions);
  assert.equal(fr.count, 2 + 8 + 3 + 2);   // 書兩筆（含另一版）加上 OpenClimbing
  assert.ok(tree.find((c) => c.cc === 'tw')?.regions == null);
});
