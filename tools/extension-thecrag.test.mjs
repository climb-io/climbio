import test from 'node:test';
import { previewProps } from '../sourcekit/preview-sheet.js';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { convert, parsePoints, idOf, pageVersion, setIdOf } from '../extension/thecrag.js';

const { validate } = createRequire(import.meta.url)('../format/format.js');

// 自己編的資料，結構跟 theCrag 岩場頁讀出來的一樣（不放別人的內容）
const page = () => ({
  url: 'https://www.thecrag.com/zh_hans/climbing/example/test-crag', name: '測試岩場 Test Crag',
  geo: [110.5228, 24.7155],
  sections: { description: '全天日晒\n說明文字', access: '請停車付費', approach: '怎么去\n沿小路走 200 公尺' },
  groups: ['Left 左側', 'Right 右側'],
  routes: [
    { id: '101', num: '1', name: '甲 A', grade: '5.11a', gradeContext: 'US', style: 'sport', length: [20, 'm'], bolts: 8, pitches: 1, stars: 2, description: '首攀: 某人, 2006', group: 0 },
    { id: '102', num: '2', name: '乙 B', grade: '6c', gradeContext: 'FR', style: 'trad', length: [30, 'm'], bolts: null, pitches: 3, stars: 0, description: '', group: 0 },
    { id: '103', num: '1', name: '丙 C', grade: '', gradeContext: '', style: '', length: null, bolts: null, pitches: null, stars: 0, description: '', group: 1 },
  ],
  topos: [
    { id: '900', w: 480, h: 320, image: 'https://image.example.com/1000x667/aa', marks: [
      { route: '101', points: '100 300,110 200,90 100 label,80 50 belay' }, { route: '102', points: '200 300,210 100' }, { route: '999', points: '1 1,2 2' }] },
    { id: '901', w: 240, h: 320, image: 'https://image.example.com/x', marks: [{ route: '103', points: '10 10,20 20' }] },
  ],
});

test('點座標：照圖片大小換算，belay 記下位置，少於兩點不是線', () => {
  assert.deepEqual(parsePoints('10 20,30 40 label,50 60 belay', 2), { line: [[20, 40], [60, 80], [100, 120]], belays: [[100, 120]] });
  assert.deepEqual(parsePoints('10 20', 1), { line: [], belays: [] });
  assert.deepEqual(parsePoints('1 2 belay,3 4,5 6 belay,5 6', 1).belays, [[1, 2], [5, 6]]);
  assert.deepEqual(parsePoints('0 0 lbvnd Pods%20x', 1), { line: [], belays: [] });
});

test('轉出的檔案都合格，origin 是 personal，授權與來源保留', () => {
  const out = convert(page(), { 900: { w: 1000, h: 667 } }, 1);
  assert.deepEqual(out.files.map((f) => f.path), ['index.json', `${idOf('thecrag:topo:900')}.json`, `${idOf('thecrag:layer:900')}.json`]);
  for (const f of out.files) assert.deepEqual(validate(f.json), [], f.path);
  const [set, view, layer] = out.files.map((f) => f.json);
  assert.equal(view.origin, 'personal');
  assert.equal(view.license, 'NOASSERTION');   // 授權不替 theCrag 的內容宣告（extension/thecrag.js 的 LICENSE）
  assert.equal(set.props.sourceLabel, 'theCrag');
  assert.equal(set.props.attributionStatus, 'unverified');
  assert.equal(set.attribution, '', '未查明個別作者時不使用假署名');
  assert.equal(view.attribution, '', '照片的原作者未知時保持空白');
  assert.equal(view.source.url, page().url);
  assert.equal(layer.on, view.id);
  assert.deepEqual(set.items.map((i) => i.id), [view.id, layer.id]);
  assert.deepEqual(out.photos, [{ path: `${view.id}.jpg`, url: 'https://image.example.com/1000x667/aa' }]);
});

test('節點樹：岩場 → 分區 → 路線；路線資料對得上，沒有的欄位不寫', () => {
  const set = convert(page(), { 900: { w: 1000, h: 667 } }, 1).files[0].json;
  const crag = set.nodes.find((n) => n.type === 'crag');
  assert.deepEqual(crag.geo, { type: 'Point', coordinates: [110.5228, 24.7155] }, '岩場的位置（導航用）');
  assert.equal(crag.props.approach, '怎么去\n沿小路走 200 公尺');
  assert.equal(crag.props['thecrag:access'], '請停車付費');
  const sectors = set.nodes.filter((n) => n.type === 'sector');
  assert.deepEqual(sectors.map((n) => [n.name, n.parent === crag.id]), [['Left 左側', true], ['Right 右側', true]]);
  const [a, b, c] = set.nodes.filter((n) => n.type === 'route');
  assert.equal(a.parent, sectors[0].id);
  assert.deepEqual(a.props, { code: 'thecrag/101', grade: { yds: '5.11a' }, 'thecrag:grade': '5.11a', 'thecrag:system': 'US', style: 'sport', length: 20, bolts: 8, 'thecrag:stars': 2, order: 1, description: '首攀: 某人, 2006' });
  assert.deepEqual(b.props, { code: 'thecrag/102', grade: { french: '6c' }, 'thecrag:grade': '6c', 'thecrag:system': 'FR', style: 'trad', length: 30, pitches: 3, order: 2 });
  assert.deepEqual(c.props, { code: 'thecrag/103', order: 1 });
  assert.equal(c.parent, sectors[1].id);
});

test('Topo：線照圖片大小換算，路線在別處的、沒有圖的 Topo 略過，belay 是確保站', () => {
  const out = convert(page(), { 900: { w: 1000, h: 667 } }, 1);   // 901 沒有圖
  const [set, view, layer] = out.files.map((f) => f.json);
  assert.equal(out.files.length, 3);
  const routeIds = set.nodes.filter((n) => n.type === 'route').map((n) => n.id);
  assert.equal(view.props.node, set.nodes.find((n) => n.type === 'sector').id);
  const lines = layer.marks.filter((m) => m.geometry.type === 'LineString');
  assert.deepEqual(lines.map((m) => [m.node, m.props.label]), [[routeIds[0], '1'], [routeIds[1], '2']]);
  assert.deepEqual(lines[0].geometry.coordinates[0], [208.3, 625]);
  const anchor = layer.nodes[0];
  assert.deepEqual([anchor.type, anchor.name, anchor.parent], ['anchor', 'A01', routeIds[0]]);
  assert.deepEqual(layer.marks.find((m) => m.node === anchor.id).geometry, { type: 'Point', coordinates: [166.7, 104.2] });
});

test('頁面只標了路線、沒畫線的 Topo：照樣收照片畫面（掛在路線多的那區），沒有圖層', () => {
  const p = page();
  p.topos[1].marks = [{ route: '103', points: '' }];
  const out = convert(p, { 900: { w: 1000, h: 667 }, 901: { w: 480, h: 640 } }, 1);
  const [set, , , view] = out.files.map((f) => f.json);
  assert.deepEqual(out.files.map((f) => f.path).filter((x) => x.includes(idOf('thecrag:layer:901'))), []);
  assert.equal(view.id, idOf('thecrag:topo:901'));
  assert.equal(view.props.node, set.nodes.filter((n) => n.type === 'sector')[1].id);
  assert.equal(out.photos.length, 2);
  for (const f of out.files) assert.deepEqual(validate(f.json), [], f.path);
  assert.ok(set.items.some((i) => i.id === view.id) && !set.items.some((i) => i.id === idOf('thecrag:layer:901')));
});

test('同一條路線在同一張 Topo 畫了兩條線：確保站各自一個節點，id 不重複', () => {
  const p = page();
  p.topos[0].marks.push({ route: '101', points: '300 300,310 200,320 50 belay' });
  const layer = convert(p, { 900: { w: 1000, h: 667 } }, 1).files[2].json;
  assert.deepEqual(validate(layer), []);
  assert.deepEqual(layer.nodes.map((n) => n.name), ['A01', 'A02']);
  assert.equal(new Set(layer.nodes.map((n) => n.id)).size, 2);
  assert.equal(layer.nodes[0].parent, layer.nodes[1].parent);
});

test('座標空間是「寬高 ÷ viewScale」：點超過 data-width 也在圖片內；同一條線畫兩次只留一條', () => {
  const p = page();
  p.topos[0].viewScale = 0.5;   // 空間 960×640，圖片 1000 像素寬 → 每單位 1000/960
  p.topos[0].marks = [{ route: '101', points: '900 600,950 10 belay' }, { route: '101', points: '900 600,950 10 belay' }];
  const layer = convert(p, { 900: { w: 1000, h: 667 } }, 1).files[2].json;
  assert.deepEqual(validate(layer), []);
  assert.equal(layer.marks.filter((m) => m.geometry.type === 'LineString').length, 1);
  assert.deepEqual(layer.marks[0].geometry.coordinates[0], [937.5, 625]);
});

test('一條路線有好幾個確保站（多繩距）：各自一個節點，由下往上', () => {
  const p = page();
  p.topos[0].marks = [{ route: '101', points: '10 90,10 60 belay,12 30,12 5 belay' }];
  const layer = convert(p, { 900: { w: 1000, h: 667 } }, 1).files[2].json;
  assert.deepEqual(layer.nodes.map((n) => n.name), ['A01', 'A02']);
  assert.deepEqual(validate(layer), []);
});

test('同一頁存兩次得到同樣的 id（更新同一份，不重複）', () => {
  const a = convert(page(), { 900: { w: 1000, h: 667 } }, 1), b = convert(page(), { 900: { w: 1000, h: 667 } }, 2);
  assert.deepEqual(a.files.map((f) => f.json.id), b.files.map((f) => f.json.id));
  assert.match(a.id, /^[0-9a-z]{16}$/);
});

test('內容指紋：同樣的頁面內容永遠一樣，內容一變就不一樣；寫進組合的 source.version', async () => {
  const a = await pageVersion(page());
  assert.match(a, /^[0-9a-f]{24}$/);
  assert.equal(await pageVersion(page()), a);
  const changed = page();
  changed.routes[0].grade = '5.12a';
  assert.notEqual(await pageVersion(changed), a);
  const set = convert(page(), { 900: { w: 1000, h: 667 } }, 1, a).files[0].json;
  assert.equal(set.source.version, a);
  assert.equal(set.id, setIdOf(page()));
  assert.equal('version' in convert(page(), { 900: { w: 1000, h: 667 } }, 1).files[0].json.source, false);
});

test('合成預覽圖：組合的 props.preview、照片項目的 props.tile；沒有照片就沒有', () => {
  const out = convert(page(), { 900: { w: 1000, h: 667 } }, 1);
  assert.deepEqual(out.files[0].json.props.preview, previewProps(1));
  assert.deepEqual(out.files[0].json.items.filter((i) => i.props?.tile != null).map((i) => i.props.tile), [0]);
  assert.deepEqual(out.sheet, { path: 'preview.jpg', urls: [out.photos[0].url] });
  assert.deepEqual(validate(out.files[0].json), []);
  const none = convert(page(), {}, 1);
  assert.equal(none.sheet, null);
  assert.deepEqual(none.files[0].json.props, { sourceLabel: 'theCrag', attributionStatus: 'unverified' });
});

test('頁面沒有位置就不寫 geo', () => {
  const set = convert({ ...page(), geo: null }, { 900: { w: 1000, h: 667 } }, 1).files[0].json;
  assert.equal('geo' in set.nodes.find((n) => n.type === 'crag'), false);
  assert.deepEqual(validate(set), []);
});

test('讀不到岩場或路線就明說', () => {
  assert.throws(() => convert({ ...page(), routes: [] }, {}), /讀不到/);
});

test('沒有分區的岩場：Topo 掛在預設的 sector 下面，不會變成區域照片', () => {
  // 跟 Dead End 一樣：只有路線、沒有 h3 分區標題
  const p = page();
  p.groups = [];
  p.routes = p.routes.map((r) => ({ ...r, group: null }));
  const out = convert(p, { 900: { w: 1000, h: 667 } }, 1);
  for (const f of out.files) assert.deepEqual(validate(f.json), [], f.path);
  const set = out.files[0].json;
  // 應該有一個預設的 sector，type 是 sector 不是 crag
  const sectors = set.nodes.filter((n) => n.type === 'sector');
  assert.equal(sectors.length, 1, '要有一個預設的 sector');
  assert.equal(sectors[0].name, p.name);
  // 所有路線的 parent 都是這個 sector
  const routes = set.nodes.filter((n) => n.type === 'route');
  assert.ok(routes.every((r) => r.parent === sectors[0].id), '路線要掛在預設 sector 下');
  // 所有 Topo 畫面的 props.node 指向 sector，不指向 crag
  const cragNode = set.nodes.find((n) => n.type === 'crag');
  const views = out.files.filter((f) => f.json.kind === 'view').map((f) => f.json);
  assert.ok(views.length > 0, '應該有 Topo 畫面');
  assert.ok(views.every((v) => v.props.node === sectors[0].id), 'Topo 的 props.node 要指向 sector');
  assert.ok(views.every((v) => v.props.node !== cragNode.id), 'Topo 的 props.node 不能指向 crag');
});

test('保存完整來源階層，並保留來源 ID、名稱及網址', () => {
  const p = page();
  p.hierarchy = [
    { id: 'https://www.thecrag.com/climbing/asia', name: '亞洲', url: 'https://www.thecrag.com/climbing/asia' },
    { id: 'https://www.thecrag.com/climbing/asia/taiwan', name: '台灣', url: 'https://www.thecrag.com/climbing/asia/taiwan' },
    { id: p.url, name: p.name, url: p.url },
  ];
  const set = convert(p, {}, 1).files[0].json;
  assert.deepEqual(set.props.sourceHierarchy, p.hierarchy);
  assert.deepEqual(validate(set), []);
  assert.notEqual(pageVersion(p), pageVersion(page()));
});
