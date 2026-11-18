import test from 'node:test';
import assert from 'node:assert/strict';
import { RouteKit } from './routekit.mjs';

// 停用的岩點（retired）：公開過、之後被刪掉或合併掉，照公開時的外框留在牆的畫面裡，別人的舊路線還指得到它
const sq = (x) => [[x, 0], [x + 10, 0], [x + 10, 10], [x, 10]];
const holds = [{ id: 'h1', poly: sq(0), source: 'detect' }, { id: 'h2', poly: sq(20), retired: true }];

test('wallView 把停用的岩點寫成 props.retired，沒停用的不寫', () => {
  const v = RouteKit.wallView({ pid: 'p1', w: 100, h: 100, holds, href: 'p1.jpg' });
  assert.deepEqual(v.nodes, [{ id: 'h1', type: 'hold', props: { source: 'detect' } }, { id: 'h2', type: 'hold', props: { retired: true } }]);
  assert.equal(v.marks.length, 2);   // 外框留著
});

test('fromFormat 讀回停用旗標；路線外框用得到停用的岩點，但外框本身不帶旗標', () => {
  const view = RouteKit.wallView({ pid: 'p1', w: 100, h: 100, holds, href: 'p1.jpg' });
  const route = { id: 'r1', name: '舊線', grade: 'V1', holds: { h1: 's', h2: 't' }, shapes: {}, author: '', t: 1 };
  const layer = RouteKit.routesLayer({ id: 'l1', pid: 'p1', href: 'p1.json', w: 100, h: 100, holds, routes: [route] });
  const got = RouteKit.fromFormat(view, [layer]);
  assert.deepEqual(got.holds.map(h => [h.id, !!h.retired]), [['h1', false], ['h2', true]]);
  const shapes = got.routes[0].shapes;
  assert.deepEqual(Object.keys(shapes).sort(), ['h1', 'h2']);
  assert.equal(shapes.h2.retired, undefined);
  assert.deepEqual(shapes.h2.poly, sq(20));
});
