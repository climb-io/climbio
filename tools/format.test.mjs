import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

// format/：公開格式的 Schema 與驗證器
const require = createRequire(import.meta.url);
const { VERSION, SCHEMA, validate } = require('../format/format.js');
const read = (f) => JSON.parse(fs.readFileSync(new URL(`../format/${f}`, import.meta.url), 'utf8'));
const copy = (x) => structuredClone(x);
const ex = Object.fromEntries(['wall', 'wall-routes', 'topo', 'topo-routes', 'map', 'set'].map(f => [f, read(`examples/${f}.json`)]));
const wall = ex.wall, routes = ex['wall-routes'], topo = ex.topo, lines = ex['topo-routes'], map = ex.map, set = ex.set;
const holdAt = (d) => d.nodes.findIndex(n => n.type === 'hold');

test('climbio.schema.json 跟 SCHEMA 一樣（改了 format.js 要重新輸出）', () => {
  assert.deepEqual(read('climbio.schema.json'), SCHEMA, 'cd format && node -e "process.stdout.write(JSON.stringify(require(\'./format.js\').SCHEMA, null, 2) + \'\\n\')" > climbio.schema.json');
});

test('樣本都合格，版本號跟套件一致，引用對得上', () => {
  for (const [f, d] of Object.entries(ex)) assert.deepEqual(validate(d), [], f);
  assert.equal(wall.climbio, VERSION);
  assert.equal(Number(read('package.json').version.split('.')[0]), VERSION);
  assert.equal(routes.on, wall.id);
  assert.equal(lines.on, topo.id);
  assert.deepEqual(set.items.map(i => i.id), [map.id, topo.id, lines.id]);
  // 圖層和地圖直接指向組合裡的全域節點，不再複製一份
  const ids = new Set(set.nodes.map(n => n.id));
  for (const m of [...lines.marks, ...map.marks]) if (!m.node.includes('-')) assert.ok(ids.has(m.node), m.node);
});

test('不認得的欄位、type、詞彙略過', () => {
  const d = copy(wall); d.extra = { a: 1 }; d.nodes[0].type = 'whatever'; d.nodes[0].props = { 'mygym:color': 'red' }; d.marks[0].u = 1;
  assert.deepEqual(validate(d), []);
});

test('畫面：相對路徑、https 可以；往上層、根目錄、其他協定、紙本和來源不明不行', () => {
  for (const href of ['photo.jpg', 'media/a-b.jpg', 'https://example.com/a.jpg']) {
    const d = copy(wall); d.href = href; assert.deepEqual(validate(d), [], href);
  }
  for (const href of ['../a.jpg', 'media/../../a.jpg', '/a.jpg', 'http://example.com/a.jpg', 'data:image/jpeg;base64,AA', 'a b.jpg']) {
    const d = copy(wall); d.href = href; assert.deepEqual(validate(d), ['href：格式不對'], href);
  }
  for (const origin of ['paper', 'unknown']) {
    const d = copy(map); d.origin = origin; assert.deepEqual(validate(d), ['origin：要是 self、authorized、personal 其中之一']);
  }
});

test('Drive 包的絕對引用可用於牆面、圖層與世界清單，仍拒絕越界路徑', () => {
  for (const doc of [copy(wall), copy(routes), copy(set)]) {
    if (doc.kind === 'set') doc.items[0].href = 'drive://155rucBALp951T-6trWFXIvmB_hvHDtCN/d85019fd05c2dc13.json';
    else doc.href = 'drive://155rucBALp951T-6trWFXIvmB_hvHDtCN/media/photo.jpg';
    assert.deepEqual(validate(doc), []);
  }
  for (const href of ['drive:///photo.jpg', 'drive://manifest/', 'drive://manifest//photo.jpg', 'drive://manifest/../photo.jpg', 'drive://manifest/a/../../photo.jpg', 'drive://user@manifest/photo.jpg', 'drive://manifest/photo name.jpg', 'drive://manifest/a#fragment']) {
    const doc = copy(wall); doc.href = href;
    assert.deepEqual(validate(doc), ['href：格式不對'], href);
  }
});

test('三種畫面：照片要有圖檔，向量圖要有大小，地圖用經緯度', () => {
  const photo = copy(wall); delete photo.href;
  assert.deepEqual(validate(photo), ['href：缺少']);
  const drawing = { climbio: 2, kind: 'view', surface: 'drawing', id: 'a1b2c3d4e5f6g7h8', t: 0, license: 'CC-BY-SA-4.0', attribution: 'x', origin: 'self', w: 1000, h: 600,
    marks: [{ geometry: { type: 'Polygon', coordinates: [[[10, 10], [900, 10], [900, 500], [10, 10]]] }, props: { style: { fill: '#ccc' } } }] };
  assert.deepEqual(validate(drawing), []);
  drawing.marks[0].geometry.coordinates[0][1] = [1001, 10];
  assert.deepEqual(validate(drawing), ['marks[0].geometry：座標超出範圍']);
  const m = copy(map); m.marks[0].geometry = { type: 'Point', coordinates: [25.1, 121.9] };
  assert.deepEqual(validate(m), ['marks[0].geometry：座標超出範圍']);
});

test('版本、種類、必填欄位錯了會指出欄位', () => {
  const v1 = copy(wall); v1.climbio = 1;
  assert.deepEqual(validate(v1), ['climbio：要是 2']);
  const noLicense = copy(wall); delete noLicense.license; delete noLicense.attribution;
  assert.deepEqual(validate(noLicense), ['license：缺少', 'attribution：缺少']);
  const noOn = copy(routes); delete noOn.on;
  assert.deepEqual(validate(noOn), ['on：缺少']);
  assert.ok(validate(null).length && validate([]).length && validate('x').length && validate({ ...copy(set), kind: 'route' }).length);
});

test('id：檔案 id 小寫英數至少 12 碼；本地節點 id 檔案內不能重複', () => {
  for (const id of ['short', 'ABCDEFGHIJKLMNOP', 'longdong/jag38d']) { const d = copy(set); d.id = id; assert.deepEqual(validate(d), ['id：格式不對'], id); }
  const d = copy(wall); d.nodes.push(copy(d.nodes[0]));
  assert.deepEqual(validate(d), [`nodes[${d.nodes.length - 1}].id：重複的 ${d.nodes[0].id}`]);
});

test('上層：找得到或是全域 id，不能繞回自己', () => {
  const d = copy(set);
  d.nodes.push({ id: 'x', parent: 'nope' });
  assert.deepEqual(validate(d), [`nodes[${d.nodes.length - 1}].parent：這個檔案沒有 nope，外部節點要寫全域 id 或「檔案id#節點id」`]);
  d.nodes[d.nodes.length - 1].parent = 'climbiodemo1#h1';
  assert.deepEqual(validate(d), []);
  const c = copy(set); c.nodes[0].parent = c.nodes[1].id;
  assert.ok(validate(c).some(e => e.endsWith('上層繞回自己')));
});

test('標註：指向的節點要存在或是全域 id，多邊形要封閉，座標在照片內', () => {
  const d = copy(wall), i = holdAt(d);
  d.marks[0].node = 'nope';
  assert.deepEqual(validate(d), ['marks[0].node：這個檔案沒有 nope']);
  d.marks[0].node = 'abcdefghijkl1234';
  assert.deepEqual(validate(d), []);
  const ring = d.marks[i].geometry.coordinates[0];
  ring[ring.length - 1] = [1, 1];
  assert.deepEqual(validate(d), [`marks[${i}].geometry：多邊形的第一點和最後一點要相同`]);
  const t = copy(topo); t.props.crop.w = t.w + 1;
  assert.deepEqual(validate(t), ['props.crop：超出畫面範圍']);
});

test('室內路線：岩點在畫面上（圖層裡只查角色），出手順序是路線的岩點', () => {
  const d = copy(wall), r = copy(routes.nodes[0]), first = Object.keys(r.props.holds)[0];
  d.nodes.push(r);
  assert.deepEqual(validate(d), []);
  r.props.holds.zz = 'x'; r.props.seq = [first, 'yy'];
  const at = `nodes[${d.nodes.length - 1}].props`;
  assert.deepEqual(validate(d), [`${at}.holds.zz：角色要是 s、h、f、t 其中之一`, `${at}.holds.zz：這個檔案沒有這個岩點`, `${at}.seq：yy 不是這條路線的岩點`]);
  const l = copy(routes); l.nodes[0].props.holds.zz = 'h';
  assert.deepEqual(validate(l), []);
});

test('拍照資料：位置必填、經度在前，角度有範圍', () => {
  const cam = { position: [121.9232, 25.1041, 12], accuracy: 5, heading: 312, pitch: 8, t: 1761620000000, focal: 26, model: 'iPhone 15' };
  const d = copy(topo); d.camera = copy(cam);
  assert.deepEqual(validate(d), []);
  const bad = (patch) => { const x = copy(topo); x.camera = { ...cam, ...patch }; return validate(x); };
  assert.deepEqual(bad({ position: [25.1041, 121.9232] }), ['camera.position：經度在前，經度 ±180、緯度 ±90']);
  assert.deepEqual(bad({ heading: 360 }), ['camera.heading：要小於 360']);
  assert.deepEqual(bad({ pitch: -91 }), ['camera.pitch：不能小於 -90']);
  assert.deepEqual(bad({ position: [121.9] }), ['camera.position：至少 2 項']);
  const none = copy(topo); none.camera = { heading: 10 };
  assert.deepEqual(validate(none), ['camera.position：缺少']);
});

test('組合不放自己、圖層不疊在自己上面', () => {
  const s = copy(set); s.items.push({ href: 'self.json', id: s.id });
  assert.deepEqual(validate(s), [`items[${s.items.length - 1}]：組合不能放自己`]);
  const l = copy(lines); l.on = l.id;
  assert.deepEqual(validate(l), ['on：圖層不能疊在自己上面']);
});

test('組合的項目可以帶 props（列清單用的縮圖、數量），要是物件', () => {
  const d = copy(set);
  d.items[0].props = { thumb: 'thumb.jpg', routes: 3 };
  assert.deepEqual(validate(d), []);
  d.items[0].props = 'x';
  assert.deepEqual(validate(d), ['items[0].props：要是 object']);
});

test('3D 岩場的樣本合格，引用對得上，遮擋表的大小跟路線的點數一致', async () => {
  const names = ['crag3d', 'crag3d-model', 'crag3d-overview', 'crag3d-wall', 'crag3d-routes'];
  const [crag, model, overview, wallSnap, layer] = names.map((f) => read(`examples/${f}.json`));
  for (const [i, d] of [crag, model, overview, wallSnap, layer].entries()) assert.deepEqual(validate(d), [], names[i]);
  assert.deepEqual(crag.items.map((i) => i.id), [overview.id, wallSnap.id, model.id, layer.id]);
  assert.equal(layer.on, model.id);
  assert.equal(overview.props.model.id, model.id);
  assert.equal(wallSnap.props.model.id, model.id);
  const nodes = new Map(crag.nodes.map((n) => [n.id, n]));
  assert.equal(nodes.get(overview.props.node).type, 'crag');
  assert.equal(nodes.get(wallSnap.props.node).type, 'wall');
  const { az, el, dist } = layer.props.sight;
  for (const m of layer.marks) {
    assert.equal(nodes.get(m.node).type, 'route');
    const table = new Uint8Array(await new Response(new Blob([Buffer.from(m.props.sight, 'base64')]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    const n = m.geometry.coordinates.length;
    assert.equal(table.length, Math.ceil(n * el[2] * az / 2), '表的值數 ＝ 點數 × 仰角格 × 方位格');
    for (const b of table) for (const v of [b & 15, b >> 4]) assert.ok(v <= dist.length, '值不能超過距離上限的個數');
  }
});
