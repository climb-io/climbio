// Studio Crag（studio/crag/）的 Topo 與匯入岩場站：照片的圖層（TopoKit 的 writeLayer 寫出來的）存進 Guidebook、通過 validate、完成度、
// 編號牌、刪路線與照片時一起清；匯入任何岩場站（不依賴龍洞）；署名保留
import { test } from 'node:test';
import './studio-i18n.mjs';   // Studio 的訊息走語言包，測試載入繁體中文版
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import * as M from '../studio/crag/model.js';
import { crawl, fromV2, checkUrl, entryOf } from '../studio/crag/site.js';
import { writeLayer, readTopo } from '../topokit/data.js';
import AppKit from '../appkit/index.mjs';

globalThis.AppKit = AppKit;

const { validate } = createRequire(import.meta.url)('../format/format.js');
const allValid = (state) => { for (const { path, doc } of M.exportDocs(state)) assert.deepEqual(validate(doc), [], path); };
const FIXTURE = new URL('../tests/author/longdong/', import.meta.url);

/** 一本 Guidebook：一面岩壁、兩張照片、三條路線 */
function book() {
  const state = M.newBook('測試');
  const wall = M.addWall(state, '東壁');
  const photos = [0, 1].map(() => {
    const v = M.newPhoto({ w: 1000, h: 800 });
    v.props.node = wall;
    state.photos.set(v.id, v);
    state.book.items.push({ href: `${v.id}.json`, id: v.id });
    return v;
  });
  const routes = M.addRoutes(state, [{ name: 'A', parent: wall, props: { style: 'sport' } }, { name: 'B', parent: wall }, { name: 'C', parent: wall }]);
  return { state, wall, photos, routes };
}

/** 照 TopoEditor 的做法寫圖層：路線節點在 Guidebook 裡已經有（known），圖層只放標註和 bolt 節點 */
function draw(state, photoId, routes) {
  const layer = M.topoLayer(state, photoId);
  const known = new Set(M.routes(state).map(r => r.id));
  const idx = 0;
  const current = readTopo({ view: state.photos.get(photoId), layers: [layer], nodes: state.book.nodes }).routes;
  return writeLayer(layer, [...current.filter(r => !routes.some(x => x.id === r.id)), ...routes.map(r => ({ kind: 'other', layer: idx, ...r }))], idx, known);
}

test('Topo：新的圖層疊在照片上（on 是照片畫面），線段指向路線節點，bolt 節點的 name 是位置；存進 Guidebook 後匯出通過 validate', () => {
  const { state, photos: [p1], routes: [a, b] } = book();
  const fresh = M.topoLayer(state, p1.id);
  assert.equal(fresh.on, p1.id);
  assert.match(fresh.id, /^[0-9a-z]{16}$/);
  assert.equal(state.layers.size, 0);   // 第一次存才放進去

  const layer = draw(state, p1.id, [{ id: a, line: [[100, 700], [120, 400], [150, 100]], bolts: { B01: { at: [110, 600] }, B02: { at: [118, 450] }, A01: { at: [150, 90], anchor: true } } }]);
  assert.equal(M.saveLayer(state, layer), 'saved');
  assert.equal(state.layers.get(layer.id), layer);
  // 圖層接在它的照片後面
  const order = state.book.items.map(i => i.id);
  assert.equal(order.indexOf(layer.id), order.indexOf(p1.id) + 1);
  assert.deepEqual(layer.marks.find(m => m.geometry.type === 'LineString').node, a);
  assert.deepEqual(layer.nodes.map(n => [n.type, n.name, n.parent]).sort(), [['anchor', 'A01', a], ['bolt', 'B01', a], ['bolt', 'B02', a]]);
  assert.ok(!layer.nodes.some(n => n.type === 'route'));   // 路線節點只在 Guidebook
  allValid(state);

  // 再存一次（同一個圖層）不會多一個項目；第二條路線
  const again = draw(state, p1.id, [{ id: b, line: [[500, 700], [520, 100]] }]);
  assert.equal(again.id, layer.id);
  M.saveLayer(state, again);
  assert.equal(state.book.items.filter(i => i.id === layer.id).length, 1);
  assert.equal(again.marks.filter(m => m.geometry.type === 'LineString').length, 2);
  allValid(state);

  // 匯出的編號牌是路線在岩壁裡的編號
  const out = M.exportDocs(state).find(d => d.doc.id === layer.id).doc;
  assert.deepEqual(out.marks.filter(m => m.geometry.type === 'LineString').map(m => [m.node, m.props.label]), [[a, '1'], [b, '2']]);
  assert.equal(out.href, `${p1.id}.json`);

  // 清掉所有標註：圖層拿掉
  assert.equal(M.saveLayer(state, { ...again, marks: [], nodes: [] }), 'removed');
  assert.equal(state.layers.size, 0);
  assert.ok(!state.book.items.some(i => i.id === layer.id));
});

test('Topo：每張照片各自一個圖層，同一條路線可以在好幾張；完成度是畫過線的路線', () => {
  const { state, photos: [p1, p2], routes: [a, b, c] } = book();
  M.saveLayer(state, draw(state, p1.id, [{ id: a, line: [[1, 2], [3, 4]] }, { id: b, bolts: { B01: { at: [5, 5] } } }]));
  M.saveLayer(state, draw(state, p2.id, [{ id: a, line: [[10, 20], [30, 40]] }]));
  assert.equal(M.layersOn(state, p1.id).length, 1);
  assert.equal(M.layersOn(state, p2.id).length, 1);
  assert.notEqual(M.layersOn(state, p1.id)[0].id, M.layersOn(state, p2.id)[0].id);
  const done = M.drawn(state);
  assert.deepEqual([...done.get(a)].sort(), [p1.id, p2.id].sort());
  assert.equal(done.has(b), false);   // 只有 bolt 不算畫過線
  assert.equal(done.has(c), false);
  allValid(state);

  // 編號：排序後跟著變
  M.moveRoutes(state, [c], state.book.nodes.find(n => n.id === a).parent, a);
  assert.deepEqual([a, b, c].map(id => M.routeNumber(state, id)), ['2', '3', '1']);   // 編號是字串（自己填的可以是 568A）
  const layer = structuredClone(M.layersOn(state, p1.id)[0]);
  assert.equal(M.syncLabels(state, layer), true);
  assert.equal(layer.marks.find(m => m.node === a).props.label, '2');
  assert.equal(M.syncLabels(state, layer), false);
});

test('路線編號：大區域從 1 開始；沒有區域時整個岩場一路編，有區域時各區各自從 1', () => {
  const state = M.newBook('測試');
  const w1 = M.addWall(state, '甲壁'), w2 = M.addWall(state, '乙壁'), w3 = M.addWall(state, '丙壁');
  const [a, b, c, d, e] = M.addRoutes(state, [
    { name: 'A', parent: w1 }, { name: 'B', parent: w1 }, { name: 'C', parent: w2 }, { name: 'D', parent: w2 }, { name: 'E', parent: w3 }]);
  M.setSettings(state, { numbering: 'area' });
  assert.deepEqual([a, b, c, d, e].map(id => M.routeNumber(state, id)), ['1', '2', '3', '4', '5']);   // 沒有區域：整個岩場一路編

  const area = { id: 'area0000000001', type: 'area', name: '東區' };
  state.book.nodes.push(area);
  for (const w of [w2, w3]) state.book.nodes.find(n => n.id === w).parent = area.id;
  assert.deepEqual([a, b, c, d, e].map(id => M.routeNumber(state, id)), ['1', '2', '1', '2', '3']);   // 甲壁在區域外自成一組，東區從 1

  M.setSettings(state, { numbering: 'wall' });
  assert.deepEqual([a, b, c, d, e].map(id => M.routeNumber(state, id)), ['1', '2', '1', '2', '1']);
});

test('Topo：刪路線時圖層上的線段與 bolt 一起清；刪照片時圖層一起刪', () => {
  const { state, photos: [p1, p2], routes: [a, b] } = book();
  M.saveLayer(state, draw(state, p1.id, [{ id: a, line: [[1, 2], [3, 4]], bolts: { B01: { at: [2, 3] } } }, { id: b, line: [[5, 6], [7, 8]] }]));
  M.saveLayer(state, draw(state, p2.id, [{ id: b, line: [[5, 6], [7, 8]] }]));
  const l1 = M.layersOn(state, p1.id)[0].id;
  const touched = M.removeRoutes(state, [a]);
  assert.deepEqual(touched, [l1]);
  const left = state.layers.get(l1);
  assert.deepEqual(left.marks.map(m => m.node), [b]);
  assert.deepEqual(left.nodes, []);
  allValid(state);

  const l2 = M.layersOn(state, p2.id)[0].id;
  assert.deepEqual(M.removePhotos(state, [p2.id]), [l2]);
  assert.equal(state.layers.has(l2), false);
  assert.ok(!state.book.items.some(i => i.id === l2 || i.id === p2.id));
  // 刪岩壁：照片和圖層的 id 都回傳（檔案由 App 刪）
  const wall = state.photos.get(p1.id).props.node;
  assert.deepEqual(M.deleteWall(state, wall).sort(), [p1.id, l1].sort());
  assert.equal(state.layers.size, 0);
  allValid(state);
});

test('署名：自己建立的地圖、照片、圖層跟著 Guidebook 換；匯入的不動', () => {
  const { state, photos: [p1], routes: [a] } = book();
  M.saveLayer(state, draw(state, p1.id, [{ id: a, line: [[1, 2], [3, 4]] }]));
  const imported = { ...M.newPhoto({ w: 10, h: 10, attribution: 'KK' }), derivedFrom: { url: 'https://example.org/climbio/x.json', id: 'xxxxxxxxxxxx' } };
  state.photos.set(imported.id, imported);
  M.setAttribution(state, '小明');
  assert.equal(state.book.attribution, '小明');
  assert.equal(state.map.attribution, '小明');
  assert.equal(p1.attribution, '小明');
  assert.equal(M.layersOn(state, p1.id)[0].attribution, '小明');
  assert.equal(imported.attribution, 'KK');
  // 新的圖層照 Guidebook 的署名與授權
  const fresh = M.topoLayer(state, imported.id);
  assert.equal(fresh.attribution, '小明');
  assert.equal(fresh.license, 'CC-BY-SA-4.0');
});

test('匯入岩場站：不依賴龍洞（任何網址、任何站的詞彙），網址相對於各自的檔案；只收 https', async () => {
  const BASE = 'https://crag.example.org/data/climbio/site.json';
  const files = {
    'https://crag.example.org/data/climbio/site.json': { climbio: 2, kind: 'set', type: 'crag', id: 'site000000000001', name: '小岩場', t: 5, license: 'CC-BY-4.0', attribution: '小岩場協會', source: { url: 'https://crag.example.org/guide' }, items: [{ href: 'walls/east.json' }],
      nodes: [{ id: 'crag000000000001', type: 'crag', name: '小岩場', props: { 'crag:permit': true } }] },
    'https://crag.example.org/data/climbio/walls/east.json': { climbio: 2, kind: 'set', type: 'area', id: 'east000000000001', items: [{ href: 'p.json' }, { href: 'l.json' }],
      nodes: [{ id: 'wall000000000001', type: 'wall', parent: 'crag000000000001', name: '東壁' },
        { id: 'rout000000000001', type: 'route', parent: 'wall000000000001', name: '一號', props: { grade: { french: '6a' }, 'crag:stars': 3 } },
        { id: 'rout000000000002', type: 'route', parent: 'wall000000000001', name: '二號' }] },
    'https://crag.example.org/data/climbio/walls/p.json': { climbio: 2, kind: 'view', surface: 'photo', id: 'phot000000000001', t: 7, attribution: '阿華', license: 'CC-BY-4.0', origin: 'self', href: 'p.jpg', mime: 'image/jpeg', w: 100, h: 80 },
    'https://crag.example.org/data/climbio/walls/l.json': { climbio: 2, kind: 'layer', id: 'layr000000000001', on: 'phot000000000001', t: 8, attribution: '阿華', license: 'CC-BY-4.0',
      marks: [{ node: 'rout000000000001', geometry: { type: 'LineString', coordinates: [[10, 70], [20, 10]] } }] },
  };
  const asked = [];
  const src = await crawl(BASE, async (url) => { asked.push(url); return structuredClone(files[url]); });
  assert.deepEqual(asked, Object.keys(files));
  const { state, images } = fromV2(src, 1);
  assert.equal(state.book.name, '小岩場');
  assert.deepEqual(state.book.derivedFrom, { url: BASE, id: 'site000000000001', t: 5 });
  assert.equal(state.book.license, 'CC-BY-4.0');
  assert.equal(state.book.attribution, '小岩場協會');
  assert.deepEqual(state.book.source, { url: 'https://crag.example.org/guide' });   // 原始資料的連結跟著走
  const r1 = state.book.nodes.find(n => n.id === 'rout000000000001');
  assert.deepEqual(r1.props, { grade: { french: '6a' }, 'crag:stars': 3, order: 1 });
  assert.equal(state.book.nodes.find(n => n.id === 'crag000000000001').props['crag:permit'], true);
  assert.deepEqual(images.map(i => i.url), ['https://crag.example.org/data/climbio/walls/p.jpg']);
  const [photo] = state.photos.values();
  assert.equal(photo.props.node, 'wall000000000001');
  assert.deepEqual([photo.attribution, photo.license], ['阿華', 'CC-BY-4.0']);
  assert.deepEqual(photo.derivedFrom, { url: 'https://crag.example.org/data/climbio/walls/p.json', id: 'phot000000000001', t: 7 });
  const [layer] = state.layers.values();
  assert.equal(layer.on, photo.id);
  assert.deepEqual(layer.derivedFrom, { url: 'https://crag.example.org/data/climbio/walls/l.json', id: 'layr000000000001', t: 8 });
  assert.deepEqual(M.drawn(state).get('rout000000000001'), new Set([photo.id]));
  allValid(state);

  // 接著編：匯入的圖層就是這張照片要編的圖層，畫第二條路線，原本的線與署名都在
  assert.equal(M.topoLayer(state, photo.id), layer);
  M.saveLayer(state, draw(state, photo.id, [{ id: 'rout000000000002', line: [[50, 70], [60, 5]] }]));
  const edited = M.layersOn(state, photo.id)[0];
  assert.deepEqual(edited.marks.map(m => m.node), ['rout000000000001', 'rout000000000002']);
  assert.equal(edited.attribution, '阿華');
  allValid(state);

  // 只收 https；項目指到 http 也不收
  assert.throws(() => checkUrl('http://crag.example.org/site.json'), /https/);
  assert.equal(checkUrl('http://127.0.0.1:8876/x.json', 'http://127.0.0.1:8876'), 'http://127.0.0.1:8876/x.json');
  await assert.rejects(crawl('http://crag.example.org/site.json', async () => ({})), /https/);
  await assert.rejects(crawl(BASE, async () => ({ climbio: 2, kind: 'set', id: 'aaaaaaaaaaaa', items: [{ href: 'http://evil.example/x.json' }] })), /https/);
  await assert.rejects(crawl(BASE, async () => ({ climbio: 1, id: 'x' })), /不是 Climbio v2/);
});

test('匯入岩場站：龍洞的出口放在別的網址一樣讀得懂', async () => {
  const BASE = 'https://mirror.example.net/longdong/climbio/longdong.json';
  const src = await crawl(BASE, async (url) => JSON.parse(readFileSync(new URL(url.slice(url.lastIndexOf('/') + 1), FIXTURE), 'utf8')));
  const { state, images } = fromV2(src);
  assert.equal(state.book.derivedFrom.url, BASE);
  assert.ok(images.every(i => i.url.startsWith('https://mirror.example.net/longdong/climbio/')));
  assert.equal(M.walls(state).length, 11);
  allValid(state);
});

test('匯入岩場站：交通圖（purpose: approach）不併進岩壁地圖，原樣另存、照樣發佈；只有一張岩壁地圖時名稱與範圍照原本的', async () => {
  const BASE = 'https://crag.example.org/g/guidebook.json';
  const files = {
    'guidebook.json': { climbio: 2, kind: 'set', type: 'guidebook', id: 'book000000000001', name: '測試岩場', t: 1, license: 'CC-BY-SA-4.0', attribution: '作者',
      nodes: [{ id: 'crag000000000001', type: 'crag', name: '測試岩場' }, { id: 'wall000000000001', type: 'wall', name: '一號壁', parent: 'crag000000000001' }],
      items: [{ href: 'map.json', id: 'map0000000000001' }, { href: 'way.json', id: 'way0000000000001' }] },
    'map.json': { climbio: 2, kind: 'view', surface: 'map', id: 'map0000000000001', name: '岩場地圖', t: 1, license: 'CC-BY-SA-4.0', attribution: '作者', origin: 'self',
      props: { node: 'crag000000000001', bounds: [121, 25, 121.01, 25.01], home: [121.002, 25.002, 121.008, 25.008] },
      marks: [{ node: 'wall000000000001', geometry: { type: 'LineString', coordinates: [[121.004, 25.005], [121.005, 25.005]] } }] },
    'way.json': { climbio: 2, kind: 'view', surface: 'map', id: 'way0000000000001', name: '交通', t: 1, license: 'ODbL-1.0', attribution: '© OpenStreetMap 貢獻者', origin: 'authorized',
      props: { purpose: 'approach', bounds: [120.99, 24.99, 121.02, 25.02] }, nodes: [{ id: 'p', type: 'poi', name: '停車場', props: { kind: 'parking' } }],
      marks: [{ geometry: { type: 'LineString', coordinates: [[121, 25], [121.01, 25]] }, props: { kind: 'route' } }, { node: 'p', geometry: { type: 'Point', coordinates: [121, 25] } }] },
  };
  const src = await crawl(BASE, async (url) => structuredClone(files[url.slice(url.lastIndexOf('/') + 1)]));
  const { state } = fromV2(src);
  assert.equal(state.map.marks.length, 1, '岩壁地圖只有自己的標註');
  assert.deepEqual(state.map.props.home, [121.002, 25.002, 121.008, 25.008]);
  assert.equal(state.map.name, '岩場地圖');
  const [way] = state.extras.values();
  assert.equal(way.license, 'ODbL-1.0');
  assert.equal(way.props.purpose, 'approach');
  assert.ok(state.book.items.some((i) => i.id === way.id));
  const out = M.exportDocs(state).map((d) => d.doc);
  const published = out.find((d) => d.props?.purpose === 'approach');
  assert.equal(published.attribution, '© OpenStreetMap 貢獻者');
  assert.equal(published.marks.length, 2);
  allValid(state);
});

test('改編別人的版本：原本的署名拿不掉，只能加上自己的', async () => {
  const { markOrigin, originAttribution, ownAttribution } = M;
  const state = M.newBook('大邱田', 1);
  state.book.attribution = 'A';
  markOrigin(state);
  assert.equal(originAttribution(state), 'A');
  assert.equal(ownAttribution(state), '');
  M.setAttribution(state, 'B');
  assert.equal(state.book.attribution, 'A；B 改編');
  assert.equal(ownAttribution(state), 'B');
  M.setAttribution(state, '');
  assert.equal(state.book.attribution, 'A');
  assert.ok(!M.exportDocs(state).some(({ doc }) => JSON.stringify(doc).includes('author:')));   // 原本的署名只記在本機
  const own = M.newBook('自己的', 1);
  M.setAttribution(own, 'C');
  assert.equal(own.book.attribution, 'C');
  assert.equal(originAttribution(own), undefined);
});

test('分享連結換成岩場的入口：?topo= 取出網址，其他原樣', () => {
  const entry = 'https://climbio.app/p/abcdefgh12345678/index.json';
  assert.equal(entryOf(`https://climbio-dev.web.app/redpoint/?topo=${encodeURIComponent(entry)}`), entry);
  assert.equal(entryOf(entry), entry);
});

test('線停在確保站中間：線最後兩點是這條路線的兩顆確保站（橫著拐一下）就換成兩顆的中間；其他線、別條路線的確保站不動', () => {
  const layer = {
    nodes: [{ id: 'a1', type: 'anchor', parent: 'r1', name: 'A01' }, { id: 'a2', type: 'anchor', parent: 'r1', name: 'A02' }, { id: 'b1', type: 'anchor', parent: 'r2', name: 'A01' }],
    marks: [
      { node: 'r1', geometry: { type: 'LineString', coordinates: [[100, 500], [120, 200], [140, 100], [180, 104]] } },
      { node: 'a1', geometry: { type: 'Point', coordinates: [140, 100] } },
      { node: 'a2', geometry: { type: 'Point', coordinates: [180, 104] } },
      { node: 'r2', geometry: { type: 'LineString', coordinates: [[300, 500], [300, 200], [140, 100]] } },   // 別條路線：終點碰到 r1 的確保站也不算
      { node: 'b1', geometry: { type: 'Point', coordinates: [300, 200] } },
    ],
  };
  assert.equal(M.endAtAnchors(layer), true);
  assert.deepEqual(layer.marks[0].geometry.coordinates, [[100, 500], [120, 200], [160, 102]]);
  assert.deepEqual(layer.marks[3].geometry.coordinates, [[300, 500], [300, 200], [140, 100]]);
  assert.equal(M.endAtAnchors(layer), false);   // 再跑一次不再改
});

test('相鄰路線的起點對齊：左右相鄰、高度差不大的一群截到最高的起點；離得遠或差太多的不動；再跑一次不再改', () => {
  const photo = { w: 1000, h: 1000 };
  const line = (id, c) => ({ node: id, geometry: { type: 'LineString', coordinates: c } });
  const layer = { marks: [
    line('r1', [[100, 800], [100, 100]]),
    line('r2', [[180, 830], [180, 100]]),   // 跟 r1 相鄰、低 30 px：截到 800
    line('r3', [[600, 900], [600, 100]]),   // 離得遠：不動
    line('r4', [[260, 950], [260, 100]]),   // 高度差 150 px（> 4%）：不動
  ] };
  assert.equal(M.alignStarts(layer, photo), true);
  assert.deepEqual(layer.marks[1].geometry.coordinates, [[180, 800], [180, 100]]);
  assert.deepEqual(layer.marks[0].geometry.coordinates, [[100, 800], [100, 100]]);
  assert.deepEqual(layer.marks[2].geometry.coordinates, [[600, 900], [600, 100]]);
  assert.deepEqual(layer.marks[3].geometry.coordinates, [[260, 950], [260, 100]]);
  assert.equal(M.alignStarts(layer, photo), false);
});

test('匯入網址上的包：只收 https（drive:// 不再收）；有 pack.json 就只請求入口和它；匯出通過 validate', async () => {
  const BASE = 'https://example.com/book/index.json';
  assert.equal(checkUrl(BASE), BASE);
  assert.throws(() => checkUrl('ftp://example.com/x.json'), /https/);
  assert.throws(() => checkUrl('drive://1ManifestId_abc/index.json'), /https/);
  const entry = { climbio: 2, kind: 'set', type: 'guidebook', id: 'ric63u9ewvb3t1dc', name: '雲端岩場', t: 5, license: 'CC-BY-SA-4.0', attribution: '作者', source: { url: 'https://example.com/guide' },
    props: { pack: { href: 'pack.json' } }, items: [{ href: 'p.json', id: 'phot000000000001' }, { href: 'l.json', id: 'layr000000000001' }],
    nodes: [{ id: 'crag000000000001', type: 'crag', name: '雲端岩場' }, { id: 'wall000000000001', type: 'wall', parent: 'crag000000000001', name: '東壁' }, { id: 'rout000000000001', type: 'route', parent: 'wall000000000001', name: '一號' }] };
  const photo = { climbio: 2, kind: 'view', surface: 'photo', id: 'phot000000000001', t: 7, attribution: '作者', license: 'CC-BY-SA-4.0', origin: 'self', href: 'p.jpg', mime: 'image/jpeg', w: 1000, h: 800 };
  const layer = { climbio: 2, kind: 'layer', id: 'layr000000000001', on: 'phot000000000001', t: 8, attribution: '作者', license: 'CC-BY-SA-4.0', marks: [{ node: 'rout000000000001', geometry: { type: 'LineString', coordinates: [[10, 70], [20, 10]] } }] };
  const pack = { docs: { 'p.json': photo, 'l.json': layer } };
  const asked = [];
  const files = { [BASE]: entry, 'https://example.com/book/pack.json': pack };
  const src = await crawl(BASE, async (url) => { asked.push(url); if (!files[url]) throw new Error(`不該請求：${url}`); return structuredClone(files[url]); });
  assert.deepEqual(asked, [BASE, 'https://example.com/book/pack.json']);   // 照片、圖層從 pack.json 拿，不一份一份請求
  const { state, images } = fromV2(src, 1);
  assert.deepEqual(images.map(i => i.url), ['https://example.com/book/p.jpg']);
  const [p] = state.photos.values();
  assert.equal(state.book.attribution, '作者');
  assert.deepEqual(M.drawn(state).get('rout000000000001'), new Set([p.id]));
  allValid(state);
  // pack.json 讀不到：一份一份讀
  const plain = { [BASE]: entry, 'https://example.com/book/p.json': photo, 'https://example.com/book/l.json': layer };
  const asked2 = [];
  await crawl(BASE, async (url) => { asked2.push(url); if (!plain[url]) throw new Error('沒有'); return structuredClone(plain[url]); });
  assert.deepEqual(asked2, [BASE, 'https://example.com/book/pack.json', 'https://example.com/book/p.json', 'https://example.com/book/l.json']);
});

test('匯入別人的包是改編：原署名鎖住只能加上自己的，畫面、圖層換新 id', async () => {
  const BASE = 'https://example.com/book/index.json';
  const entry = { climbio: 2, kind: 'set', type: 'guidebook', id: 'ric63u9ewvb3t1dc', name: '雲端岩場', t: 5, license: 'CC-BY-SA-4.0', attribution: '方翔', source: { url: 'https://example.com/guide' },
    props: { pack: { href: 'pack.json' } }, items: [{ href: 'p.json', id: 'phot000000000001' }, { href: 'l.json', id: 'layr000000000001' }],
    nodes: [{ id: 'crag000000000001', type: 'crag', name: '雲端岩場' }, { id: 'wall000000000001', type: 'wall', parent: 'crag000000000001', name: '東壁' }, { id: 'rout000000000001', type: 'route', parent: 'wall000000000001', name: '一號' }] };
  const photo = { climbio: 2, kind: 'view', surface: 'photo', id: 'phot000000000001', t: 7, attribution: '方翔', license: 'CC-BY-SA-4.0', origin: 'self', href: 'p.jpg', mime: 'image/jpeg', w: 1000, h: 800 };
  const layer = { climbio: 2, kind: 'layer', id: 'layr000000000001', on: 'phot000000000001', t: 8, attribution: '方翔', license: 'CC-BY-SA-4.0', marks: [{ node: 'rout000000000001', geometry: { type: 'LineString', coordinates: [[10, 70], [20, 10]] } }] };
  const files = { [BASE]: entry, 'https://example.com/book/pack.json': { docs: { 'p.json': photo, 'l.json': layer } } };
  const load = async () => crawl(BASE, async (url) => structuredClone(files[url]));
  // 一般匯入（改編）：原署名鎖住，只能加上自己的
  const adapted = fromV2(await load()).state;
  assert.equal(M.originAttribution(adapted), '方翔');
  M.setAttribution(adapted, 'Fang');
  assert.equal(adapted.book.attribution, '方翔；Fang 改編');
  assert.ok([...adapted.photos.keys()].every((id) => id !== 'phot000000000001') && [...adapted.layers.keys()].every((id) => id !== 'layr000000000001'));
  assert.notEqual(adapted.book.id, 'ric63u9ewvb3t1dc');
  allValid(adapted);
});
