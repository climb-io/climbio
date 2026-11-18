// TopoKit 的排版（topokit/render.js）：gradePill 的路線名稱一律在編號牌下面或旁邊，不跑到牌子上面
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderLines } from '../topokit/render.js';

const placed = (svg) => ({
  pill: Number(/topo-badge[^>]*><rect x="[\d.]+" y="([\d.]+)"/.exec(svg)[1]),
  name: Number(/<tspan[^>]*y="([\d.]+)"[^>]*>測試路線</.exec(svg)[1]),
});

test('起點貼著照片底邊：名稱不放在編號牌上面（看的時候、編輯的時候都一樣）', () => {
  for (const start of [400, 470]) {
    const routes = [{ id: 'a', label: '1', grade: '5.10a', name: '測試路線', kind: 'sport', line: [[200, start], [210, 300], [200, 100]] }];
    for (const editing of [false, true]) {
      const { pill, name } = placed(renderLines(routes, { photo: { w: 400, h: 500 }, k: 1, highlight: 'a', editing }));
      assert.ok(name > pill, `起點 ${start}、editing=${editing}：名稱 ${name} 在牌子 ${pill} 上面`);
    }
  }
});

test('編輯時換選別條路線：每個編號牌的位置都不變', () => {
  const routes = [
    { id: 'a', label: '1', grade: '5.10a', kind: 'sport', line: [[100, 400], [110, 250], [100, 100]] },
    { id: 'b', label: '2', grade: '5.11b', kind: 'sport', line: [[130, 400], [140, 250], [150, 100]] },
    { id: 'c', label: '3', grade: '5.9', kind: 'sport', line: [[160, 380], [170, 250], [160, 120]] },
  ];
  const pills = (highlight) => [...renderLines(routes, { photo: { w: 300, h: 450 }, k: 1, highlight, editing: true }).matchAll(/data-route="(\w)"[^>]*><g class="topo-badge[^>]*><rect x="([\d.]+)" y="([\d.]+)"/g)].map(([, id, x, y]) => `${id}:${x},${y}`).sort();
  const base = pills('a');
  assert.equal(base.length, 3);
  assert.deepEqual(pills('b'), base);
  assert.deepEqual(pills('c'), base);
});
