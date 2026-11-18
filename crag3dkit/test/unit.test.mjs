// Crag3DKit 的單元測試：只測不需要 DOM、WebGL 的部分（讀格式、遮擋表、名稱與難度）。播放器靠瀏覽器測試。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readCrag3d, sharedModelId, readSight, routeVisibility, pickName, pickGrade } from '../index.js';

const ex = (f) => JSON.parse(fs.readFileSync(new URL(`../../format/examples/${f}.json`, import.meta.url), 'utf8'));
const docs = ['crag3d', 'crag3d-model', 'crag3d-overview', 'crag3d-wall', 'crag3d-routes'].map(ex);
const [, model, overview, wall, layer] = docs;

test('readCrag3d：從範例找出模型、岩壁、路線、全區快照', () => {
  const c = readCrag3d(docs, model.id);
  assert.equal(c.model.id, model.id);
  assert.equal(c.marks.length, 2);
  assert.deepEqual(c.sight, layer.props.sight);
  assert.equal(c.overview.id, overview.id);
  assert.equal(c.areas.length, 1);
  const [a] = c.areas;
  assert.equal(a.name, '範例岩壁');
  assert.equal(a.snapshot.id, wall.id);
  assert.deepEqual(a.camera, wall.props.model.camera);
  assert.equal(a.aspect, 1080 / 2340);
  assert.deepEqual([...a.routes].sort(), ['sample3dr1', 'sample3dr2']);
  assert.equal(readCrag3d(docs, model.id, { lang: 'en' }).areas[0].name, 'Sample wall');
});

test('readCrag3d：找不到模型畫面回 null；岩壁照 props.order 排；沒有全區快照也行', () => {
  assert.equal(readCrag3d(docs, 'nope'), null);
  const set = structuredClone(docs[0]);
  set.nodes.push({ id: 'w0', type: 'wall', parent: 'sample3dcrag', name: 'B', props: { order: 0 } });
  const snap2 = { ...structuredClone(wall), id: 'snap2', props: { node: 'w0', model: wall.props.model } };
  const c = readCrag3d([set, model, wall, snap2, layer], model.id);
  assert.deepEqual(c.areas.map((a) => a.name), ['B', '範例岩壁']);
  assert.equal(c.overview, undefined);
});

test('readCrag3d：節點只讀包著這個模型的組合', () => {
  const other = { ...structuredClone(docs[0]), id: 'otherset', items: [], nodes: [{ id: 'sample3dwall', type: 'wall', name: 'X' }] };
  assert.equal(readCrag3d([...docs, other], model.id).areas[0].name, '範例岩壁');
});

test('sharedModelId：全部是同一個模型的快照才回 id', () => {
  assert.equal(sharedModelId([wall, overview]), model.id);
  assert.equal(sharedModelId([wall, { props: {} }]), null);
  assert.equal(sharedModelId([wall, { props: { model: { id: 'another' } } }]), null);
  assert.equal(sharedModelId([]), null);
});

test('遮擋表：解碼後的大小跟規格一致，路線 2 的第三個點從正面近處看得到、遠處被擋', async () => {
  const { az, el, dist } = layer.props.sight;
  const m2 = layer.marks[1], table = await readSight(m2.props.sight);
  const pts = m2.geometry.coordinates;
  assert.equal(table.length, Math.ceil(pts.length * el[2] * az / 2));
  const at = (d) => routeVisibility({ table, spec: layer.props.sight, pts, from: [pts[2][0], pts[2][1], pts[2][2] + d], fill: 0 }).vis[2];
  assert.equal(at(1), 1, '1 m 以內看得到（擋的距離是 dist[0] = 2 m）');
  assert.equal(at(3), 0, '3 m 以外被擋住');
  assert.equal(dist[0], 2);
  const free = routeVisibility({ table: await readSight(layer.marks[0].props.sight), spec: layer.props.sight, pts: layer.marks[0].geometry.coordinates, from: [0, 5, 20] });
  assert.equal(free.seen, 1);
});

test('遮擋表：夾在看得到的點中間、fill 點以內的點當成看得到；沒有表就都看得到', async () => {
  const { spec = layer.props.sight } = {};
  const m2 = layer.marks[1], table = await readSight(m2.props.sight), pts = m2.geometry.coordinates;
  const from = [pts[2][0], pts[2][1], pts[2][2] + 3];
  assert.equal(routeVisibility({ table, spec, pts, from, fill: 0 }).vis[2], 0);
  assert.equal(routeVisibility({ table, spec, pts, from, fill: 3 }).vis[2], 1);
  assert.equal(routeVisibility({ table: null, spec: null, pts, from }).seen, 1);
  const out = new Uint8Array(pts.length);
  assert.equal(routeVisibility({ table, spec, pts, from, fill: 0, out }).vis, out);
});

test('名稱與難度：語言、系統的取法', () => {
  assert.equal(pickName('a'), 'a');
  assert.equal(pickName({ en: 'E', 'zh-Hant': 'Z' }, 'en'), 'E');
  assert.equal(pickName({ en: 'E', 'zh-Hant': 'Z' }, 'ja'), 'Z');
  assert.equal(pickName({ de: 'D' }, 'ja'), 'D');
  assert.equal(pickName(undefined), undefined);
  assert.equal(pickGrade('5.9'), '5.9');
  assert.equal(pickGrade({ french: '6a', yds: '5.9' }), '5.9');
  assert.equal(pickGrade({ dan: '3' }), '3');
  assert.equal(pickGrade(undefined), undefined);
});

test('伺服器端（沒有 DOM）載入 Kit 不會壞，播放器要呼叫時才載入', async () => {
  const kit = await import('../index.js');
  assert.equal(typeof kit.mountCrag3d, 'function');
});
