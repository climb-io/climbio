// mapkit 的單元測試（node --test，npm run test:quick 經 tools/kit-packages.test.mjs 跑）：
// v2 資料讀取、圖層蓋掉舊形狀；畫面的縮放與範圍；岩壁朝向。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { arrowGap } from '../render.js';
import { readMap, renderMap, TEXT, faceTrail, wallFaces, clampView, zoomAt, toScreen, toMap, maxScale, MIN_SCALE } from '../index.js';

const dir = new URL('../baseline/', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, dir), 'utf8');
const view = JSON.parse(read('longdong-map.json'));

test('讀 v2 地圖畫面：底圖、區域、分區、地點、範圍；不是地圖畫面就丟錯', () => {
  const m = readMap(view);
  assert.deepEqual(Object.keys(m.base).sort(), ['building', 'highway', 'land', 'parking', 'road', 'trail', 'tunnel']);
  assert.equal(m.areas.length, 9);
  assert.ok(m.walls.length > 30);
  assert.equal(m.pois.filter((p) => p.kind === 'rescue').length, 14);
  // 經度在前：東邊的 x 比較大，北邊的 y 比較小
  const [e] = m.proj.project([121.93, 25.11]), [w] = m.proj.project([121.91, 25.11]);
  const [, n] = m.proj.project([121.92, 25.12]), [, so] = m.proj.project([121.92, 25.10]);
  assert.ok(e > w && n < so);
  assert.ok(m.bounds.maxW > m.bounds.w, '底圖資料比移動範圍寬');
  assert.throws(() => readMap({ ...view, surface: 'photo' }), /地圖畫面/);
});

test('圖層裡的節點形狀蓋掉畫面上的（改過的岩壁）', () => {
  const wall = view.marks.find((k) => view.nodes.find((n) => n.id === k.node)?.type === 'sector');
  const line = [[121.9215, 25.1128], [121.9216, 25.1129]];
  const layer = { climbio: 2, kind: 'layer', id: 'abcdefghijkl0000', on: view.id, marks: [{ node: wall.node, geometry: { type: 'MultiLineString', coordinates: [line] } }] };
  const m = readMap(view, [layer]);
  assert.deepEqual(m.walls.filter((w) => w.id === wall.node).map((w) => w.lngLat), [[line]]);
});

test('畫面：縮放限制在範圍內，平面 ↔ 螢幕互為反函數', () => {
  const m = readMap(view), frame = { w: 375, h: 700 };
  const v = clampView({ cx: 0, cy: 0, s: 999, r: 0.3 }, m.bounds, frame);
  assert.equal(v.s, maxScale(m.bounds, frame));
  assert.equal(clampView({ ...v, s: 0.0001 }, m.bounds, frame).s, MIN_SCALE);
  const p = [123.4, -56.7], back = toMap(v, frame, toScreen(v, frame, p));
  assert.ok(Math.abs(back[0] - p[0]) < 1e-9 && Math.abs(back[1] - p[1]) < 1e-9);
  // 以一點為中心縮放：那一點底下的地圖位置不動
  const at = { x: 100, y: 200 }, before = toMap(v, frame, [at.x, at.y]), after = toMap(zoomAt(v, frame, at, v.s / 2), frame, [at.x, at.y]);
  assert.ok(Math.hypot(after[0] - before[0], after[1] - before[1]) < 1e-9);
});

test('岩壁朝向：岩壁面朝右手邊；新畫的線朝向最近的步道', () => {
  // 往北走（y 變小），右手邊是東：朝向 90 度
  assert.equal(wallFaces([[0, 0], [0, -10]])[0].bearing, 90);
  const trail = [[[20, 10], [20, -20]]];
  assert.deepEqual(faceTrail([[0, 0], [0, -10]], trail), [[0, 0], [0, -10]], '步道在東邊：不用反過來');
  assert.deepEqual(faceTrail([[0, -10], [0, 0]], trail), [[0, 0], [0, -10]], '步道在東邊、線往南畫：反過來');
});

test('選中岩壁：給 line 只選那一條並標名稱；沒給 line 是整個分區的每一條、不標名稱', () => {
  const two = { climbio: 2, kind: 'view', surface: 'map', id: 'v', props: { bounds: [121.9, 25.1, 121.91, 25.11] },
    nodes: [{ id: 's', type: 'sector', name: '測試分區' }],
    marks: [{ node: 's', geometry: { type: 'MultiLineString', coordinates: [[[121.904, 25.104], [121.905, 25.105]], [[121.906, 25.104], [121.906, 25.106]]] } }] };
  const model = readMap(two);
  const [cx, cy] = model.proj.project([121.905, 25.105]);
  const draw = (selected) => renderMap(model, { cx, cy, s: 1, r: 0 }, { w: 400, h: 400 }, { id: 'mk', lang: 'zh', text: TEXT.zh, walls: true, selected }).svg;
  const count = (svg) => (svg.match(/class="mk-line selected" data-line="s#/g) ?? []).length;
  const one = draw({ node: 's', line: 0 }), all = draw({ node: 's' });
  assert.equal(count(one), 1);
  assert.equal((one.match(/mk-line-label/g) ?? []).length, 1);
  assert.equal(count(all), 2);
  assert.equal((all.match(/mk-line-label/g) ?? []).length, 0);
});

test('hide 的區域、分區不畫；sectorLabels 給分區 id 陣列時只標這些', () => {
  const model = readMap(view);
  const [a, b] = model.walls;
  const area = model.areas[0];
  const [cx, cy] = model.proj.project(a.lngLat[0][0]);
  const draw = (o) => renderMap(model, { cx, cy, s: 0.2, r: 0 }, { w: 2000, h: 2000 }, { id: 'mk', lang: 'zh', text: TEXT.zh, walls: true, ...o }).svg;
  const all = draw({});
  const hidden = draw({ hide: [a.id, area.id] });
  assert.ok(all.includes(`data-line="${a.id}#0"`) && all.includes(`data-node="${area.id}"`));
  assert.ok(!hidden.includes(`data-line="${a.id}#0"`) && !hidden.includes(`data-node="${area.id}"`));
  assert.ok(hidden.includes(`data-line="${b.id}#0"`));
  const labels = (svg) => [...svg.matchAll(/class="mk-sector-label"[^>]*>([^<]*)</g)].map((m) => m[1]);
  const only = labels(draw({ sectorLabels: [a.id] }));
  assert.ok(labels(draw({ sectorLabels: true })).length > 1);
  assert.deepEqual(only, [typeof a.node.name === 'string' ? a.node.name : a.node.name['zh-Hant']]);
});

test('世界地圖：包含陸地與國家邊界（border），可在全球範圍內自由縮放', () => {
  const world = JSON.parse(fs.readFileSync(new URL('../world.json', import.meta.url), 'utf8'));
  const m = readMap(world);
  assert.ok(m.base.land, '要有 land 底圖');
  assert.ok(m.base.border, '要有 border 國家邊界');
  const frame = { w: 390, h: 844 };
  const v = clampView({ cx: 0, cy: 0, s: 999999, r: 0 }, m.bounds, frame);
  // contain 模式下，整個世界都在畫面內
  assert.equal(v.s, maxScale(m.bounds, frame));
  const svg = renderMap(m, v, frame, { id: 'world', lang: 'zh', text: TEXT.zh }).svg;
  assert.ok(svg.includes('class="mk-border"'), 'SVG 應渲染國家邊界');
  assert.ok(svg.includes('class="mk-land"'), 'SVG 應渲染陸地');
});

test('建議路線：沒有節點、props.kind 是 route 的線畫成粗線，箭頭沿線指向畫線的方向；crag 節點的多邊形是區域', () => {
  const doc = { climbio: 2, kind: 'view', surface: 'map', id: 'v', props: { bounds: [121.9, 25.1, 121.91, 25.11] },
    nodes: [{ id: 'c', type: 'crag', name: '測試岩場' }],
    marks: [
      { props: { kind: 'route' }, geometry: { type: 'LineString', coordinates: [[121.902, 25.105], [121.908, 25.105]] } },
      { node: 'c', geometry: { type: 'Polygon', coordinates: [[[121.904, 25.106], [121.906, 25.106], [121.906, 25.108], [121.904, 25.106]]] } },
    ] };
  const model = readMap(doc);
  assert.equal(model.routes.length, 1);
  assert.deepEqual(model.areas.map((a) => a.id), ['c']);
  const [cx, cy] = model.proj.project([121.905, 25.105]);
  const svg = renderMap(model, { cx, cy, s: 1, r: 0 }, { w: 800, h: 400 }, { id: 'mk', lang: 'zh', text: TEXT.zh }).svg;
  assert.ok(svg.includes('class="mk-route"'));
  const arrows = [...svg.matchAll(/mk-route-arrow"[^>]*rotate\(([-\d.]+)\)/g)].map((m) => Number(m[1]));
  assert.ok(arrows.length >= 5, `箭頭 ${arrows.length} 個`);   // 約 600 公尺、每像素 1 公尺：每 70 像素一個
  assert.ok(arrows.every((a) => Math.abs(a) < 1), '由西往東畫：箭頭朝右');
  // 箭頭釘在地圖上：小幅縮放間隔不變（位置不滑動），放大一倍間隔剛好減半（原本的箭頭都還在）
  assert.equal(arrowGap(1), arrowGap(0.9));
  assert.equal(arrowGap(0.5), arrowGap(1) / 2);
});
