// 轉換路線書：大綱（studio/crag/outline.js）、Word／網頁讀出的區塊排成大綱（docread.js 的 toOutline）、原圖換掉路線書的圖（model.js 的 takeOriginal）
import { test } from 'node:test';
import './studio-i18n.mjs';   // Studio 的訊息走語言包，測試載入繁體中文版
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AppKit from '../appkit/index.mjs';
import * as M from '../studio/crag/model.js';
import { fromOutline, parseAspect, findPosition, parseOutline } from '../studio/crag/outline.js';
import { toOutline, headingName, blocksFromPdf } from '../studio/crag/docread.js';
import { parseTable, guessColumns, toRoutes } from '../studio/crag/table.js';

const { validate } = createRequire(import.meta.url)('../format/format.js');
const allValid = (state) => { for (const { path, doc } of M.exportDocs(state)) assert.deepEqual(validate(doc), [], path); };

const SAMPLE = `# 內湖大邱田
來源：https://docs.google.com/document/d/x
署名：楊礎豪
交通：導航到五路財神廟
公車小3到大邱田

## 上攀區
說明：步道北側的岩壁

| 編號 | 名稱 | 難度 | 需要快扣數<br>(不含top anchor) | 路線描述 | 岩壁 |
| --- | --- | --- | --- | --- | --- |
| 1 | 喬溪<br>Chelsea | 5.12c | 3 | 經典外傾大動作路線。 | 懸岩區 |
| 8 | 萌萌裂隙 | 5.10b | 傳攀 | 0.1~3號岩械。 | 萌萌裂隙區 |
| 9 | 澳洲打工度假 | 5.12d? | 傳攀＋2blot | 左斜上經過兩個bolt | 萌萌裂隙區 |

## 抱石區
類型：抱石
![配置圖](images/sketch.png)

### 第一抱石
朝向：東南
![](images/a.jpg)

| 路線名稱 | 級數 | 描述 | FA |
| --- | --- | --- | --- |
| 歡迎光臨 | V3 | 起攀後直上 | 楊礎豪2025/5/14 |
| 環遊世界 | V6 | 向左橫渡 | 楊礎豪2025/5/14 |

![起攀點](images/b.jpg)

### 神秘岩洞
下面有兩個罐子，沒人敢爬這顆石頭。
`;

test('大綱：標題變成岩場、區、岩壁，欄位、表格、圖片放對地方，匯出通過 validate', () => {
  const r = fromOutline(SAMPLE, { t: 1 });
  const { book } = r.state;
  assert.equal(book.name, '內湖大邱田');
  assert.equal(book.attribution, '楊礎豪');
  assert.deepEqual(book.source, { url: 'https://docs.google.com/document/d/x' });
  const node = (name) => book.nodes.find(n => M.text(n.name) === name);
  assert.equal(node('內湖大邱田').type, 'crag');
  assert.equal(node('內湖大邱田').props.approach, '導航到五路財神廟\n公車小3到大邱田');
  assert.equal(node('上攀區').type, 'area');   // 表格有岩壁欄：岩壁開在它底下
  assert.equal(node('懸岩區').type, 'wall');
  assert.equal(node('懸岩區').parent, node('上攀區').id);
  assert.equal(node('第一抱石').props.aspect, 135);
  assert.equal(node('神秘岩洞').type, 'wall');
  assert.equal(node('神秘岩洞').props.description, '下面有兩個罐子，沒人敢爬這顆石頭。');
  const joe = book.nodes.find(n => n.type === 'route' && n.name?.en === 'Chelsea');
  assert.deepEqual(joe.name, { 'zh-Hant': '喬溪', en: 'Chelsea' });
  assert.deepEqual(joe.props, { code: '1', grade: { yds: '5.12c' }, bolts: 3, description: '經典外傾大動作路線。', style: 'sport', order: 1 });
  const crack = node('萌萌裂隙');
  assert.equal(crack.props.style, 'trad');
  assert.equal(crack.parent, node('萌萌裂隙區').id);
  assert.deepEqual([node('澳洲打工度假').props.style, node('澳洲打工度假').props.bolts], ['trad', 2]);
  assert.deepEqual(node('環遊世界').props, { grade: { v: 'V6' }, description: '向左橫渡', fa: '楊礎豪2025/5/14', style: 'boulder', order: 2 });
  assert.deepEqual(r.images.filter(i => !i.overview).map(i => [i.src, i.alt, i.wall]), [['images/a.jpg', '', node('第一抱石').id], ['images/b.jpg', '起攀點', node('第一抱石').id]]);
  // 區或岩場底下的圖是區域圖：掛在那個節點上、標 overview（沒有路線，不描線）
  assert.deepEqual(r.images.filter(i => i.overview).map(i => [i.src, i.alt, node(r.state.book.nodes.find(n => n.id === i.wall).name).type]), [['images/sketch.png', '配置圖', 'area']]);
  assert.deepEqual(r.count, { areas: 2, walls: 4, routes: 5, images: 2, overview: 1 });
  assert.deepEqual(r.warnings, ['沒有找到岩場位置（發佈前一定要有）：在交通寫「入口 緯度, 經度」，或建立後在岩場頁填「岩場位置」']);
  allValid(r.state);
});

test('大綱：區底下沒有岩壁欄的路線收在區（Studio 列在未分配）並提醒；錯的欄位、朝向、來源提醒', () => {
  const r = fromOutline('# 岩場\n來源：docs.google.com/x\n## 區\n署名：某人\n朝向：上面\n| 名稱 | 難度 |\n|---|---|\n| 甲 | 5.9 |\n### 岩壁\n');
  const area = r.state.book.nodes.find(n => n.name === '區');
  assert.equal(area.type, 'area');
  assert.equal(r.state.book.nodes.find(n => n.name === '甲').parent, area.id);
  assert.deepEqual(M.routesOf(r.state, null).map(n => n.name), ['甲']);
  assert.deepEqual(r.warnings, [
    '第 4 行：「署名」要寫在岩場（# 標題）底下',
    '第 5 行：看不懂的朝向「上面」（寫度數或 N、東南這類方位）',
    '來源要是 https 網址：「docs.google.com/x」',
    '沒有找到岩場位置（發佈前一定要有）：在交通寫「入口 緯度, 經度」，或建立後在岩場頁填「岩場位置」',
    '1 條路線放在區底下、還沒分到岩壁：在表格加「岩壁」欄，或建立後在路線清單拖到岩壁',
  ]);
  assert.equal(parseAspect('210'), 210);
  assert.equal(parseAspect('朝南'), 180);
  assert.equal(parseAspect('NW'), 315);
});

test('Word、網頁的區塊排成大綱：書名是岩場、交通與警示收進岩場、忘了設標題的編號段落、圖說、表格的換行', () => {
  const blocks = [
    { t: 'title', text: '內湖大邱田戶外岩場路線書' },
    { t: 'p', text: 'Neihu Daqiutian Climbing' },
    { t: 'h', level: 1, text: '【警示聲明 & 緊急救援】' },
    { t: 'p', text: '請撥119' },
    { t: 'h', level: 1, text: '【車行方式By Car】' },
    { t: 'p', text: '導航到武濟宮' },
    { t: 'img', src: 'images/road.png' },
    { t: 'h', level: 1, text: '【抱石區】' },
    { t: 'img', src: 'images/map.png' },
    { t: 'h', level: 2, text: '1.第一抱石' },
    { t: 'img', src: 'images/a.jpg' },
    { t: 'table', rows: [['路線名稱', '級數'], ['歡迎光臨', 'V3']] },
    { t: 'img', src: 'images/b.jpg' },
    { t: 'p', text: '歡迎光臨起攀點' },
    { t: 'h', level: 2, text: '2.神秘岩洞' },
    { t: 'img', src: 'images/c.jpg' },
    { t: 'p', text: '下面有兩個罐子' },
    { t: 'p', text: '3.沙漏石' },
    { t: 'table', rows: [['名稱', '難度'], ['指尖沙\nFinger', 'V4']] },
  ];
  const o = toOutline(blocks);
  assert.equal(o.text, `# 內湖大邱田
交通：導航到武濟宮

說明：Neihu Daqiutian Climbing
【警示聲明 & 緊急救援】
請撥119

## 抱石區
![](images/map.png)

### 第一抱石
![](images/a.jpg)

| 路線名稱 | 級數 |
| --- | --- |
| 歡迎光臨 | V3 |

![歡迎光臨起攀點](images/b.jpg)

### 神秘岩洞
![](images/c.jpg)
下面有兩個罐子

### 沙漏石

| 名稱 | 難度 |
| --- | --- |
| 指尖沙<br>Finger | V4 |
`);
  assert.equal(o.dropped, 1);
  assert.deepEqual(o.guessed, ['沙漏石']);
  const r = fromOutline(o.text);
  assert.deepEqual(r.count, { areas: 1, walls: 3, routes: 2, images: 3, overview: 1 });
  assert.deepEqual(r.state.book.nodes.find(n => n.type === 'route' && n.props.grade.v === 'V4').name, { 'zh-Hant': '指尖沙', en: 'Finger' });
  assert.equal(headingName('【上攀區Rope Climbing Area】'), '上攀區');
  assert.equal(headingName('10.楓丹白露石'), '楓丹白露石');
  assert.equal(headingName('Slab石'), 'Slab石');
});

test('表格：欄名不完全一樣時找關鍵字（最靠後的）', () => {
  const rows = parseTable('編號\t名稱\t需要快扣數(不含top anchor)\t路線描述\n1\t喬溪\t3\t好');
  assert.deepEqual(guessColumns(rows).columns, ['code', 'name', 'bolts', 'description']);
  assert.deepEqual(toRoutes(rows, guessColumns(rows))[0], { name: '喬溪', props: { code: '1', bolts: 3, description: '好' } });
});

test('原圖換掉路線書的圖：Topo 搬到原圖、座標照對位（單應性）換過去，排在原來的位置，路線書的圖拿掉', () => {
  globalThis.AppKit = AppKit;   // model.js 的 newPhoto 用瀏覽器的全域 AppKit
  const r = fromOutline('# 岩場\n## 石頭\n| 名稱 | 難度 |\n|---|---|\n| 甲 | V1 |\n');
  const s = r.state, wall = M.walls(s)[0].id, route = M.routes(s)[0].id;
  const guide = M.newPhoto({ name: '路線書', w: 700, h: 1000 });
  M.addPhoto(s, guide, wall);
  const layer = M.topoLayer(s, guide.id);
  layer.marks.push({ node: route, geometry: { type: 'LineString', coordinates: [[100, 900], [350, 100]] } });
  M.saveLayer(s, layer);
  const other = M.newPhoto({ name: '別張', w: 800, h: 600 });
  M.addPhoto(s, other, wall);
  const original = M.newPhoto({ name: '原圖', w: 2100, h: 3000 });
  M.addPhoto(s, original);   // 沒有位置：先開一面新的岩壁
  assert.equal(M.walls(s).length, 2);
  assert.deepEqual(M.takeOriginal(s, guide.id, original.id, [3, 0, 0, 0, 3, 0, 0, 0, 1]), [layer.id]);
  assert.equal(s.photos.has(guide.id), false);
  assert.equal(original.props.node, wall);
  assert.equal(M.walls(s).length, 1);   // 空掉的岩壁拿掉
  assert.deepEqual(s.book.items.slice(1).map(i => i.id), [original.id, layer.id, other.id]);
  assert.equal(layer.on, original.id);
  assert.deepEqual(layer.marks[0].geometry.coordinates, [[300, 2700], [1050, 300]]);
  assert.deepEqual([...M.drawn(s).get(route)], [original.id]);
  allValid(s);
});

const cli = (...a) => { try { return { out: execFileSync(process.execPath, ['tools/guidebook.mjs', ...a], { encoding: 'utf8' }), status: 0 }; } catch (e) { return { out: e.stdout, status: e.status }; } };

test('命令列 check：印出數量與問題清單（找不到的圖檔、沒有岩場位置、還沒分到岩壁的路線），報告的路線帶著大綱的行號', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guidebook-'));
  try {
    writeFileSync(join(dir, 'a.jpg'), 'x');
    writeFileSync(join(dir, 'book.md'), `# 岩場
## 石頭
![](a.jpg)
![](missing.jpg)
| 名稱 | 難度 |
|---|---|
| 甲 | V1 |
## 區
### 子
| 名稱 | 難度 |
|---|---|
| 乙 | V2 |
`);
    let { out, status } = cli('check', join(dir, 'book.md'));
    assert.equal(status, 1);
    assert.equal(out, `岩場：1 區、2 面岩壁、2 條路線、2 張照片
- 找不到這些圖檔，一起選進來：missing.jpg
- 沒有找到岩場位置（發佈前一定要有）：在交通寫「入口 緯度, 經度」，或建立後在岩場頁填「岩場位置」
- 大綱沒寫國家（岩場底下寫「國家：tw」）：紅點貓的世界照國家分組，發佈前要補上
`);
    writeFileSync(join(dir, 'book.md'), `# 岩場
交通：入口 25.13473, 121.51491
## 區
| 名稱 | 難度 |
|---|---|
| 甲 | V1 |
| 乙 | V2 |
### 子
| 名稱 | 難度 |
|---|---|
| 丙 | V3 |
`);
    ({ out, status } = cli('check', join(dir, 'book.md'), '--json'));
    assert.equal(status, 0);   // 還沒分到岩壁只是要看一眼，不擋
    const rep = JSON.parse(out);
    assert.deepEqual(rep.position, { lat: 25.13473, lng: 121.51491 });
    assert.deepEqual(rep.routes.map(r => [r.name, r.status, r.reasons, r.at]), [['甲', 'check', ['unassigned'], { line: 4, row: 1 }], ['乙', 'check', ['unassigned'], { line: 4, row: 2 }], ['丙', 'ok', [], { line: 9, row: 1 }]]);
    assert.match(cli('prompt').out, /路線書大綱/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('命令列 apply：局部修正只改點名的路線（其他 id、其他檔案不動），刪路線連圖層的線與 bolt 一起拿掉；validate 報沒有線的路線', () => {
  globalThis.AppKit = AppKit;
  const r = fromOutline(`# 岩場
交通：入口 25.13473, 121.51491
## 東壁
| 名稱 | 難度 |
|---|---|
| 甲 | 5.10a |
| 乙 | 5.11a |
## 西壁
| 名稱 | 難度 |
|---|---|
| 丙 | 5.9 |
`);
  const s = r.state, [east, west] = M.walls(s).map(w => w.id), [a, b, c] = M.routes(s).map(n => n.id);
  const photo = M.newPhoto({ name: '東壁', w: 800, h: 1000 });
  M.addPhoto(s, photo, east);
  M.autoTopo(s, [[photo.id, [{ points: [[100, 900], [120, 100]] }, { points: [[400, 900], [420, 100]], bolts: [[410, 500]] }]]]);
  const dir = mkdtempSync(join(tmpdir(), 'guidebook-'));
  try {
    for (const { path, doc } of M.exportDocs(s)) writeFileSync(join(dir, path), JSON.stringify(doc));
    const layerFile = M.exportDocs(s).find(d => d.doc.kind === 'layer').path, photoFile = M.exportDocs(s).find(d => d.doc.surface === 'photo').path;
    const before = (p) => readFileSync(join(dir, p), 'utf8'), photoBefore = before(photoFile);
    let { out, status } = cli('validate', dir, '--json');
    assert.equal(status, 0);
    assert.deepEqual(JSON.parse(out).routes.map(x => [x.name, x.reasons]), [['甲', []], ['乙', []], ['丙', ['no-topo']]]);
    writeFileSync(join(dir, 'patch.json'), JSON.stringify([{ op: 'move', routes: [c], to: east }, { op: 'set', id: a, props: { description: '直上' } }, { op: 'remove', routes: [b] }]));
    ({ status } = cli('apply', dir, join(dir, 'patch.json')));
    assert.equal(status, 0);
    const book = JSON.parse(before('index.json')), layer = JSON.parse(before(layerFile));
    assert.deepEqual(book.nodes.filter(n => n.type === 'route').map(n => [n.id, n.parent]), [[a, east], [c, east]]);
    assert.equal(book.nodes.find(n => n.id === a).props.description, '直上');
    assert.ok(book.nodes.some(n => n.id === west));
    assert.deepEqual(layer.marks.map(m => m.node), [a]);   // 乙的線和 bolt 都拿掉
    assert.deepEqual(layer.nodes || [], []);
    assert.equal(before(photoFile), photoBefore);   // 沒點名的檔案一個字都不動
    writeFileSync(join(dir, 'bad.json'), JSON.stringify([{ op: 'move', routes: [a], to: a }]));
    assert.equal(cli('apply', dir, join(dir, 'bad.json')).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('命令列 apply：Studio 畫面能做的都做得到——新增岩壁、區域與路線、改上層、照片換岩壁、地圖的牆線區域步道、照片上畫線放 bolt、刪區域；改完都通過格式驗證', () => {
  globalThis.AppKit = AppKit;
  const r = fromOutline(`# 岩場
交通：入口 25.13473, 121.51491
## 東壁
| 名稱 | 難度 |
|---|---|
| 甲 | 5.10a |
| 乙 | 5.11a |
`);
  const s = r.state, [east] = M.walls(s).map(w => w.id), [a, b] = M.routes(s).map(n => n.id);
  const p1 = M.newPhoto({ name: '東壁', w: 800, h: 1000 }), p2 = M.newPhoto({ name: '西壁', w: 600, h: 900 });
  M.addPhoto(s, p1, east); M.addPhoto(s, p2, east);
  const dir = mkdtempSync(join(tmpdir(), 'guidebook-'));
  const at = (x, y) => [121.5 + x / 1e5, 25.1 + y / 1e5];
  try {
    for (const { path, doc } of M.exportDocs(s)) writeFileSync(join(dir, path), JSON.stringify(doc));
    const read = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const run = (ops) => { writeFileSync(join(dir, 'patch.json'), JSON.stringify(ops)); return cli('apply', dir, join(dir, 'patch.json')); };
    // 新增區域、岩壁（自己給 id）、路線；東壁移進區域
    let res = run([{ op: 'add', type: 'area', name: '北區', id: 'area0000000000001' }, { op: 'add', type: 'wall', name: '西壁', parent: 'area0000000000001', id: 'wall0000000000001' },
      { op: 'add', type: 'route', name: '丙', parent: 'wall0000000000001', props: { grade: { yds: '5.9' } }, id: 'rout0000000000001' }, { op: 'set', id: east, parent: 'area0000000000001' }]);
    assert.equal(res.status, 0, res.out);
    assert.match(res.out, /新增 route rout0000000000001 丙/);
    let book = read('index.json');
    assert.deepEqual(['北區', '西壁', '丙'].map(n => book.nodes.find(x => x.name === n).parent), [book.nodes.find(x => x.type === 'crag')?.parent, 'area0000000000001', 'wall0000000000001']);
    assert.equal(book.nodes.find(x => x.id === east).parent, 'area0000000000001');
    // 上層不能是自己底下的
    assert.equal(run([{ op: 'set', id: 'area0000000000001', parent: east }]).status, 2);
    // 照片換岩壁、地圖的牆線與區域、步道
    const line = [at(0, 0), at(30, 0)], ring = [at(-50, -50), at(80, -50), at(80, 50), at(-50, 50), at(-50, -50)];
    res = run([{ op: 'photo', photos: [p2.id], to: 'wall0000000000001' }, { op: 'shape', node: 'wall0000000000001', geometry: { type: 'LineString', coordinates: line } },
      { op: 'shape', node: 'area0000000000001', geometry: { type: 'Polygon', coordinates: [ring] } }, { op: 'shape', trail: true, geometry: { type: 'LineString', coordinates: [at(-60, -60), at(0, 0)] } }]);
    assert.equal(res.status, 0, res.out);
    book = read('index.json');
    const photoFile = book.items.find(i => i.id === p2.id).href, mapFile = book.items.find(i => read(i.href).surface === 'map').href;
    assert.equal(read(photoFile).props.node, 'wall0000000000001');
    const map = read(mapFile);
    assert.deepEqual(map.marks.find(m => m.node === 'wall0000000000001').geometry.coordinates, line);
    assert.equal(map.marks.find(m => m.node === 'area0000000000001').geometry.type, 'Polygon');
    assert.equal(map.marks.filter(m => m.props?.kind === 'trail').length, 1);
    // 照片上畫線、放 bolt：這張還沒有圖層就開一個，接在照片後面；超出照片的點擋下
    assert.equal(run([{ op: 'line', photo: p2.id, route: 'rout0000000000001', points: [[100, 880], [700, 50]] }]).status, 2);
    res = run([{ op: 'line', photo: p2.id, route: 'rout0000000000001', points: [[100, 880], [140, 400], [160, 50]], bolts: [[120, 700], [140, 400]] }]);
    assert.equal(res.status, 0, res.out);
    book = read('index.json');
    const li = book.items.findIndex(i => i.id === p2.id) + 1, layer = read(book.items[li].href);
    assert.equal(layer.on, p2.id);
    assert.deepEqual(layer.marks.filter(m => m.geometry.type === 'LineString').map(m => [m.node, m.props.label]), [['rout0000000000001', '1']]);
    assert.deepEqual(layer.nodes.map(n => [n.type, n.name, n.parent]), [['bolt', 'B01', 'rout0000000000001'], ['bolt', 'B02', 'rout0000000000001']]);
    // 改線不動 bolt；拿掉線連 bolt 一起
    run([{ op: 'line', photo: p2.id, route: 'rout0000000000001', points: [[100, 880], [160, 50]] }]);
    assert.equal(read(book.items[li].href).nodes.length, 2);
    run([{ op: 'line', photo: p2.id, route: 'rout0000000000001', points: null }]);
    assert.deepEqual(read(book.items[li].href).marks, []);
    // 刪區域：底下的岩壁移到上一層；岩壁上還有照片不能刪
    assert.equal(run([{ op: 'remove', nodes: ['wall0000000000001'] }]).status, 2);
    res = run([{ op: 'remove', nodes: ['area0000000000001'] }]);
    assert.equal(res.status, 0, res.out);
    book = read('index.json');
    assert.ok(!book.nodes.some(n => n.id === 'area0000000000001'));
    assert.equal(book.nodes.find(n => n.id === east).parent, undefined);   // 北區在最上層：東壁跟著回到最上層
    assert.ok(!read(mapFile).marks.some(m => m.node === 'area0000000000001'));
    assert.deepEqual(book.nodes.filter(n => n.type === 'route').map(n => n.id).sort(), [a, b, 'rout0000000000001'].sort());
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('找原圖的配對規則：本身還有更大原圖的不當原圖，同一張原圖先配最大的路線書圖（特寫留著），一張配到好幾張原圖用最大的，一對一', async () => {
  const { choosePairs } = await import('../studio/crag/pair.js');
  const P = (id, w, h) => ({ id, w, h });
  const full = P('full', 2000, 1500), crop = P('crop', 600, 800), orig = P('orig', 2560, 1920), other = P('other', 800, 600), orig2 = P('orig2', 2560, 1920);
  const pick = (v) => choosePairs(v).map(p => `${p.guide.id}>${p.original.id}`).sort();
  // 特寫（crop）同時像路線書的整張（full）和原圖：整張換成原圖，特寫留著
  assert.deepEqual(pick([{ guide: crop, original: full, score: 0.97 }, { guide: full, original: orig, score: 0.93 }, { guide: crop, original: orig, score: 0.9 }, { guide: other, original: orig2, score: 0.85 }]), ['full>orig', 'other>orig2']);
  // 兩張原圖都像同一張路線書的圖（幾乎一樣的連拍）：分數高的
  assert.deepEqual(pick([{ guide: other, original: orig, score: 0.91 }, { guide: other, original: orig2, score: 0.97 }]), ['other>orig2']);
  // 使用者的照片裡有縮小的副本：配給最大的原圖
  const copy = P('copy', 2100, 1576);
  assert.deepEqual(pick([{ guide: other, original: copy, score: 0.95 }, { guide: other, original: orig, score: 0.9 }]), ['other>orig']);
});

test('排列：一面岩壁有好幾張表時，每張表是它前面那張照片拍到的路線（照排列轉成由左到右）；文件裡「Right to left 右至左」那行自動變成排列欄位', () => {
  const outline = `# 小岩場
排列：由右至左

## 陽光牆
![一](a.jpg)

| 名稱 | 難度 |
| --- | --- |
| 甲 | 5.10a |
| 乙 | 5.10b |

![二](b.jpg)

| 名稱 | 難度 |
| --- | --- |
| 丙 | 5.11a |
`;
  const r = fromOutline(outline);
  const name = (id) => M.text(r.state.book.nodes.find(n => n.id === id).name);
  assert.deepEqual(r.images.map(i => [i.src, i.routes.map(name)]), [['a.jpg', ['乙', '甲']], ['b.jpg', ['丙']]]);
  // 由左到右：照原順序；只有一張表：不分組
  const ltr = fromOutline(outline.replace('由右至左', '由左至右'));
  assert.deepEqual(ltr.images[0].routes.map(id => M.text(ltr.state.book.nodes.find(n => n.id === id).name)), ['甲', '乙']);
  // 表格只有一張：不分組，照片只有一張時整面的路線都是它的
  assert.equal(fromOutline(outline.replace(/\n!\[二\].*\n\n\| 名稱 \| 難度 \|\n\| --- \| --- \|\n\| 丙 \| 5.11a \|\n/s, '')).images[0].routes.length, 2);
  assert.ok(fromOutline(outline.replace('由右至左', '亂寫')).warnings.some(w => w.includes('看不懂的排列')));
  const blocks = [{ t: 'title', text: '小岩場' }, { t: 'p', text: 'Right to left 右至左' }, { t: 'h', level: 1, text: '陽光牆' }, { t: 'img', src: 'a.jpg' }];
  assert.match(toOutline(blocks).text, /^# 小岩場\n排列：由右至左\n/);
  assert.ok(!toOutline(blocks).text.includes('Right to left'));
});

test('排列：只有一張照片的岩壁，整面的路線都是它拍到的（照排列）；同一張照片後面的第二張表是照片上沒有畫線的路線', () => {
  const name = (r, id) => M.text(r.state.book.nodes.find(n => n.id === id).name);
  const one = fromOutline('# 岩場\n排列：由右至左\n\n## 岩壁\n![](a.jpg)\n\n| 名稱 |\n| --- |\n| 甲 |\n| 乙 |\n');
  assert.deepEqual(one.images[0].routes.map(id => name(one, id)), ['乙', '甲']);
  const two = fromOutline('# 岩場\n\n## 岩壁\n![](a.jpg)\n\n| 名稱 |\n| --- |\n| 甲 |\n\n| 名稱 |\n| --- |\n| 直上變化 |\n\n![](b.jpg)\n\n| 名稱 |\n| --- |\n| 丙 |\n');
  assert.deepEqual(two.images.map(i => i.routes.map(id => name(two, id))), [['甲'], ['丙']]);
  assert.deepEqual(M.routesOf(two.state, two.state.book.nodes.find(n => n.type === 'wall').id).map(x => M.text(x.name)), ['甲', '直上變化', '丙']);
});

test('岩場資訊：原始資料只收 https、空的清掉；交通寫在岩場節點上，沒有岩場節點的書不能寫', () => {
  const r = fromOutline('# 岩場\n來源：https://example.com/a\n交通：導航到停車場\n\n## 岩壁\n');
  assert.equal(M.sourceOf(r.state), 'https://example.com/a');
  assert.equal(M.approachOf(r.state), '導航到停車場');
  assert.equal(M.setSource(r.state, 'http://example.com'), false);
  assert.equal(M.sourceOf(r.state), 'https://example.com/a');
  assert.equal(M.setSource(r.state, 'https://example.com/b'), true);
  assert.equal(M.sourceOf(r.state), 'https://example.com/b');
  M.setSource(r.state, '');
  assert.equal(r.state.book.source, undefined);
  M.setApproach(r.state, '開車到入口\n走 10 分鐘');
  assert.equal(M.cragOf(r.state).props.approach, '開車到入口\n走 10 分鐘');
  M.setApproach(r.state, '');
  assert.equal(M.approachOf(r.state), '');
  allValid(r.state);
  const blank = M.newBook('空的');
  M.setApproach(blank, '不會存');
  assert.equal(M.approachOf(blank), '');
});

test('岩壁地圖（GeoJSON）：岩壁線照名稱放進地圖畫面，步道與地點一起；對不到的岩壁、壞的檔案提醒；匯出通過 validate', () => {
  const line = (a, b) => ({ type: 'LineString', coordinates: [a, b] });
  const geo = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { wall: ' 陽光牆 ' }, geometry: line([121.5, 25.1], [121.5003, 25.1002]) },
    { type: 'Feature', properties: { wall: '不存在的牆' }, geometry: line([121.5, 25.1], [121.5001, 25.1]) },
    { type: 'Feature', properties: { kind: 'trail' }, geometry: line([121.4995, 25.0995], [121.5, 25.1]) },
    { type: 'Feature', properties: { kind: 'place', name: '入口' }, geometry: { type: 'Point', coordinates: [121.499, 25.099] } },
    { type: 'Feature', properties: {}, geometry: line([0, 0], [1, 1]) },
  ] };
  const r = fromOutline('# 岩場\n\n## 陽光牆\n\n| 名稱 |\n| --- |\n| 甲 |\n', { map: geo });
  const wall = r.state.book.nodes.find(n => n.type === 'wall').id;
  const marks = r.state.map.marks;
  assert.equal(marks.filter(m => m.node === wall).length, 1);
  assert.equal(marks.filter(m => m.props?.kind === 'trail').length, 1);
  assert.equal(r.state.map.nodes.filter(n => n.type === 'poi').length, 1);
  assert.equal(marks.length, 3);
  assert.ok(marks.filter(m => m.geometry.type === 'LineString').every(m => m.props['author:manual']));
  assert.ok(r.warnings.some(w => w.includes('不存在的牆')));
  // 畫面範圍：移動範圍包住步道與入口、一開始的畫面只對岩壁、縮小時寬高都放得進畫面
  const { bounds, home, fit } = r.state.map.props;
  assert.equal(fit, 'contain');
  assert.ok(bounds[0] < 121.499 && bounds[2] > 121.5003 && bounds[1] < 25.099 && bounds[3] > 25.1002, JSON.stringify(bounds));
  assert.ok(home[0] > bounds[0] && home[0] < 121.5 && home[2] > 121.5003 && home[1] > 25.0995 && home[3] < 25.101, JSON.stringify(home));
  allValid(r.state);
  assert.ok(fromOutline('# 岩場\n\n## 牆\n', { map: { type: 'Feature' } }).warnings.some(w => w.includes('不是 GeoJSON')));
  assert.equal(fromOutline('# 岩場\n\n## 牆\n').state.map.marks.length, 0);
});

test('岩場位置：從文字抓「緯度, 經度」：交通說明裡入口附近優先，其次交通、說明、岩壁說明；範圍不對的不收；都沒有就提醒', () => {
  const pos = (md) => { const r = fromOutline(md); return { at: M.cragPosition(r.state), from: r.position?.from, warn: r.warnings.some(w => w.includes('沒有找到岩場位置')) }; };
  // 墾丁：交通寫了入口座標，岩壁說明也有「位置」：用入口
  assert.deepEqual(pos('# 墾丁\n交通：岩場入口 21.9301894, 120.8265521（導航）\n## 神秘森林\n說明：位置 21.9320446, 120.8282285\n'), { at: [120.8265521, 21.9301894], from: '岩場交通說明裡的入口', warn: false });
  // 入口不在座標前面：交通裡的第一組
  assert.equal(pos('# 岩場\n交通：先到路邊 25.13473, 121.51491\n').from, '岩場交通說明');
  // 只有岩壁寫了位置：用第一個找到的（小數不到 3 位的不當座標）
  assert.deepEqual(pos('# 岩場\n## 甲壁\n說明：位置 25.10, 121.60 附近\n## 乙壁\n說明：位置 25.11111, 121.61111\n'), { at: [121.61111, 25.11111], from: '「乙壁」的說明', warn: false });
  // 緯度超過 90 不收；沒有座標：提醒
  assert.equal(findPosition(parseOutline('# 岩場\n交通：120.8265521, 21.9301894\n').sections), undefined);
  assert.deepEqual(pos('# 岩場\n交通：開車\n'), { at: undefined, from: undefined, warn: true });
  allValid(fromOutline('# 岩場\n交通：入口 25.13473, 121.51491\n').state);
});

test('給 AI 的提示只有 ai-prompt.js 一份（沒有 import，說明頁直接讀）；outline.js 轉出同一份；教學頁和對話框的連結對得上', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../studio/crag/ai-prompt.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^import /m);
  const mod = await import('../studio/crag/ai-prompt.js'), out = await import('../studio/crag/outline.js');
  assert.equal(out.AI_PROMPT, mod.AI_PROMPT);
  assert.equal(out.AI_MAP_PROMPT, mod.AI_MAP_PROMPT);
  assert.match(mod.AI_PROMPT, /緯度, 經度/);
  assert.match(mod.AI_MAP_PROMPT, /GeoJSON/);
  assert.match(readFileSync(new URL('../guides/convert/convert.js', import.meta.url), 'utf8'), /\.\.\/\.\.\/studio\/crag\/ai-prompt\.js/);
  assert.match(readFileSync(new URL('../studio/crag/index.html', import.meta.url), 'utf8'), /href="\.\.\/convert\/"/);
});

test('PDF 的文字：路線標題、首攀、小型大寫的標題、換行的連字號', () => {
  const at = (str, x, y, h = 8) => ({ str, x, y, w: str.length * h * 0.5, h });
  const page = { w: 420, h: 595, items: [
    at('Lion Rock', 40, 560, 16),
    at('GeneRaL', 40, 540, 14),
    at('A fine crag with prob', 40, 520), at('-', 120, 520),
    at('ably good rock.', 40, 510),
    at('(1)', 40, 480, 10), at('Gweilo', 60, 480, 10), at('***', 100, 480, 10), at('F5+', 120, 480, 10),
    at('A classic climb.', 40, 470),
    at('F.A. M. Lancaster (1993)', 40, 460),
    at('2 - Wards Groove', 40, 440, 10), at('**', 120, 440, 10), at('HVS 5b, F6b', 140, 440, 10),
    at('Original line.', 40, 430),
    at('7', 200, 14, 10),
  ] };
  const blocks = blocksFromPdf([page]);
  assert.deepEqual(blocks.map(b => b.t), ['title', 'h', 'p', 'table']);
  assert.equal(blocks[1].text, 'General');
  assert.equal(blocks[2].text, 'A fine crag with probably good rock.');
  assert.deepEqual(blocks[3].rows.slice(1), [
    ['1', 'Gweilo', 'F5+', 'A classic climb.', 'M. Lancaster (1993)'],
    ['2', 'Wards Groove', 'HVS 5b, F6b', 'Original line.', ''],
  ]);
  assert.equal(fromOutline(toOutline(blocks).text).count.routes, 2);
});
