import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { placementProblems } from './format-placement.mjs';

// 公開格式的放法與連結（format/README.md）：龍洞的範例檔（岩場站的出口）就是標準寫法
const examples = readdirSync('format/examples').filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(`format/examples/${f}`, 'utf8')));

test('龍洞的範例檔：路線在組合、圖層只有 bolt 和線段、標註都找得到節點、節點不重複', () => {
  assert.deepEqual(placementProblems(examples), []);
  const layer = JSON.parse(readFileSync('format/examples/topo-routes.json', 'utf8'));
  assert.ok(layer.nodes.length && layer.nodes.every((n) => n.type === 'bolt' || n.type === 'anchor'));   // Topo 圖層沒有路線節點
  const set = JSON.parse(readFileSync('format/examples/set.json', 'utf8'));
  assert.ok(set.nodes.some((n) => n.type === 'route'));
});

test('岩點牆的圖層（路線由岩點序列定義）：路線節點在圖層裡是允許的例外', () => {
  const wall = examples.find((d) => d.kind === 'layer' && d.nodes?.some((n) => n.type === 'route' && n.props?.holds));
  assert.ok(wall);
  assert.deepEqual(placementProblems([wall]), []);
});

test('層次：主區域可以有多個主區域或子區域，子區域有路線和 Topo，岩場可以當主區域也可以當子區域', () => {
  const id = (n) => `${String(n).padStart(2, '0')}aaaaaaaaaaaaaa`;
  const nodes = [
    { id: id(1), type: 'crag' }, { id: id(2), type: 'area', parent: id(1) }, { id: id(3), type: 'area', parent: id(2) },   // 主區域套主區域
    { id: id(4), type: 'sector', parent: id(3) }, { id: id(5), type: 'wall', parent: id(2) },                               // 子區域
    { id: id(6), type: 'route', parent: id(4) },
    { id: id(7), type: 'crag' }, { id: id(8), type: 'route', parent: id(7) },   // 一面牆的小岩場：岩場自己就是子區域，直接有路線
  ];
  const photo = { kind: 'view', surface: 'photo', id: id(9), props: { node: id(7) } };
  assert.deepEqual(placementProblems([{ kind: 'set', id: id(10), nodes }, photo]), []);
  const bad = [{ kind: 'set', id: id(10), nodes: [{ id: id(1), type: 'sector' }, { id: id(2), type: 'area', parent: id(1) }, { id: id(3), type: 'sector', parent: id(1) }, { id: id(4), type: 'route', parent: id(5) }, { id: id(5), type: 'bolt', parent: id(1) }] }];
  const text = placementProblems(bad).join(' ; ');
  for (const part of ['主區域 .*的上層是 sector', '子區域 .*的上層是 sector', '路線 .*的上層是 bolt']) assert.match(text, new RegExp(part));
});

test('放錯會被抓到：Topo 圖層裡放路線節點、重複的節點、找不到的連結、可以數出來的數字', () => {
  const set = { kind: 'set', type: 'guidebook', id: 'aaaaaaaaaaaaaaa1', nodes: [{ id: 'bbbbbbbbbbbbbbb1', type: 'route' }], props: { walls: 1, routes: 1, cover: 'cover.jpg' } };
  const layer = { kind: 'layer', id: 'aaaaaaaaaaaaaaa2', on: 'aaaaaaaaaaaaaaa3', nodes: [{ id: 'bbbbbbbbbbbbbbb1', type: 'route' }, { id: 'x-b01', type: 'bolt', parent: 'ccccccccccccccc9' }],
    marks: [{ node: 'ccccccccccccccc8', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }] };
  const text = placementProblems([set, layer]).join('\n');
  for (const part of ['重複定義', '圖層 aaaaaaaaaaaaaaa2 裡有路線節點', 'parent ccccccccccccccc9 找不到', '找不到的節點 ccccccccccccccc8', 'props.walls', 'props.routes', 'props.cover']) assert.match(text, new RegExp(part.replace(/[.]/g, '\\.')));
});

test('路線號碼：指向路線的 Point 標註（沒有線的路線）是允許的；同一條路線有線又有號碼位置才算問題', () => {
  const id = (n) => `${String(n).padStart(2, '0')}aaaaaaaaaaaaaa`;
  const set = { climbio: 2, kind: 'set', type: 'crag', id: id(1), t: 1, nodes: [{ id: id(2), type: 'crag' }, { id: id(3), type: 'route', parent: id(2) }, { id: id(4), type: 'route', parent: id(2) }] };
  const layer = (marks) => ({ climbio: 2, kind: 'layer', id: id(5), on: id(6), t: 1, marks });
  const point = (node) => ({ node, geometry: { type: 'Point', coordinates: [10, 20] }, props: { label: '1', size: 26 } });
  const line = (node) => ({ node, geometry: { type: 'LineString', coordinates: [[0, 0], [5, 5]] } });
  assert.deepEqual(placementProblems([set, layer([point(id(3)), line(id(4))])]), []);
  assert.equal(placementProblems([set, layer([point(id(3)), line(id(3))])]).length, 1);
});
