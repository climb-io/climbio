import test from 'node:test';
import { previewProps } from '../sourcekit/preview-sheet.js';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadUnits, parsePath, parseUrl, photosOf, prepare, spdxOf } from '../extension/openclimbing.js';

const { validate } = createRequire(import.meta.url)('../format/format.js');

const OSM = 'https://api.openstreetmap.org/api/0.6';
const node = (id, tags, version = 1) => ({ type: 'node', id, version, tags: { climbing: 'route_bottom', ...tags } });
const rel = (id, tags, members, version = 1) => ({ type: 'relation', id, version, tags, members: members.map(([type, ref]) => ({ type, ref, role: '' })) });
const page = (title, license, artist = '<a href="x">Jan Novák</a>') => ({ title, imageinfo: [{ thumburl: `https://upload.wikimedia.org/thumb/1600px-${title.slice(5)}`, thumbwidth: 1600, thumbheight: 1000, width: 4000, height: 2500, mime: 'image/jpeg',
  descriptionurl: `https://commons.wikimedia.org/wiki/${title}`, extmetadata: { LicenseShortName: { value: license }, Artist: { value: artist } } }] });

/** 自己編的資料（結構跟 OSM、Commons 的回應一樣）：區域底下三個岩場，一個有 Topo、一個照片授權不行、一個沒有線 */
function world({ routeVersion = 1 } = {}) {
  const relations = new Map([
    [10, rel(10, { climbing: 'area', name: '測試區域' }, [['relation', 11], ['relation', 12], ['relation', 13]])],
    [11, rel(11, { climbing: 'crag', name: '左岩壁', website: 'https://example.org/left' }, [['node', 101], ['node', 102], ['node', 103]])],
    [12, rel(12, { climbing: 'crag', name: '右岩壁' }, [['node', 201]])],
    [13, rel(13, { climbing: 'crag', name: '沒有線的岩壁' }, [['node', 301]])],
  ]);
  const nodes = new Map([
    [101, node(101, { name: '乙', 'climbing:grade:uiaa': '5+', 'climbing:grade:french': '5c', 'climbing:length': '20', 'climbing:sport': 'yes', 'wikimedia_commons': 'File:Left wall.jpg', 'wikimedia_commons:path': '0.5,0.9|0.52,0.2' }, routeVersion)],
    [102, node(102, { name: '甲', 'wikimedia_commons': 'File:Left wall.jpg', 'wikimedia_commons:path': '0.2,0.9|0.25,0.5:|0.24,0.1' })],
    [103, node(103, { name: '沒有照片的路線' })],
    [201, node(201, { name: '丙', 'wikimedia_commons': 'File:Right wall.jpg', 'wikimedia_commons:path': '0.3,0.9|0.3,0.1' })],
    [301, node(301, { name: '丁', 'wikimedia_commons': 'File:Plain.jpg' })],   // 有照片沒有線
  ]);
  const commons = { 'File:Left wall.jpg': page('File:Left wall.jpg', 'CC BY-SA 4.0'), 'File:Right wall.jpg': page('File:Right wall.jpg', 'All rights reserved') };
  const calls = [];
  const get = async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (u.origin === 'https://commons.wikimedia.org') return { query: { pages: Object.fromEntries(u.searchParams.get('titles').split('|').filter((t) => commons[t]).map((t, i) => [i, commons[t]])) } };
    let m;
    if ((m = u.pathname.match(/\/relation\/(\d+)\.json$/))) return { elements: [relations.get(Number(m[1]))] };
    if (u.pathname.endsWith('/relations.json')) return { elements: u.searchParams.get('relations').split(',').map((id) => relations.get(Number(id))) };
    if (u.pathname.endsWith('/nodes.json')) return { elements: u.searchParams.get('nodes').split(',').map((id) => nodes.get(Number(id))) };
    throw new Error(`沒有這個網址：${url}`);
  };
  return { get, calls };
}

test('openclimbing.org 的網址：岩場、區域是 relation；節點（單一路線）也認得，之後擋掉', () => {
  assert.deepEqual(parseUrl('https://openclimbing.org/relation/17457880'), { type: 'relation', id: 17457880 });
  assert.deepEqual(parseUrl('https://openclimbing.org/relation/17457880/hostivarska-skalka?x=1#a'), { type: 'relation', id: 17457880 });
  assert.deepEqual(parseUrl('https://openclimbing.org/node/5'), { type: 'node', id: 5 });
  assert.equal(parseUrl('https://openclimbing.org/'), null);
  assert.equal(parseUrl('not a url'), null);
});

test('照片上的線：比例座標，虛線當連續，超出範圍或不到兩點不算；一個元素可以有好幾張照片', () => {
  assert.deepEqual(parsePath('0.682,0.823|0.642,0.453|0.557,0.177'), [[0.682, 0.823], [0.642, 0.453], [0.557, 0.177]]);
  assert.deepEqual(parsePath('0.1,0.9:|0.2,0.1'), [[0.1, 0.9], [0.2, 0.1]]);
  assert.deepEqual(parsePath('0.1,0.9'), []);
  assert.deepEqual(parsePath('0.1,1.5|0.2,0.1'), []);
  assert.deepEqual(parsePath(undefined), []);
  assert.deepEqual(photosOf({ wikimedia_commons: 'File:A.jpg', 'wikimedia_commons:path': '0,0|1,1', 'wikimedia_commons:2': 'File:B.jpg', 'wikimedia_commons:2:path': '0,1|1,0', name: 'x' }),
    [{ title: 'File:A.jpg', path: '0,0|1,1' }, { title: 'File:B.jpg', path: '0,1|1,0' }]);
});

test('Commons 的授權：CC、CC0、公眾領域才收，換成 SPDX；其他不收', () => {
  assert.deepEqual(['CC BY-SA 4.0', 'CC BY 3.0', 'CC BY-SA 2.5', 'CC0', 'CC0 1.0 Universal', 'Public domain', 'PD-old', 'GFDL', 'All rights reserved', 'CC BY-NC 4.0', ''].map(spdxOf),
    ['CC-BY-SA-4.0', 'CC-BY-3.0', 'CC-BY-SA-2.5', 'CC0-1.0', 'CC0-1.0', 'LicenseRef-PD', 'LicenseRef-PD', null, null, null, null]);
});

test('讀區域：每個有路線的岩場是一個 unit；有線又授權可以的照片才是 Topo；授權不行的記張數', async () => {
  const { get } = world();
  const { root, units, skipped } = await loadUnits('https://openclimbing.org/relation/10', { get, keepEmpty: true });
  assert.deepEqual([root.type, root.id, root.name], ['relation', 10, '測試區域']);
  assert.deepEqual(units.map((u) => [u.name, u.routes.length, u.topos]), [['左岩壁', 3, 1], ['右岩壁', 1, 0], ['沒有線的岩壁', 1, 0]]);
  assert.equal(skipped, 1, '右岩壁的照片授權不行');
  assert.equal(units[0].views[0].lines.length, 2);
});

test('讀岩場：直接一個 unit；節點（單一路線）不是岩場', async () => {
  const { get } = world();
  const one = await loadUnits('https://openclimbing.org/relation/11', { get });
  assert.deepEqual(one.units.map((u) => u.name), ['左岩壁']);
  await assert.rejects(loadUnits('https://openclimbing.org/node/101', { get }), (e) => e.guide === true);
});

test('一個岩場要存的東西：路線、有線的照片與圖層都過 validate；照片授權與作者、路線資料 ODbL；編號牌由左到右', async () => {
  const { get } = world();
  const { units } = await loadUnits('https://openclimbing.org/relation/10', { get });
  const out = await prepare(units[0], 1);
  assert.equal(out.files.length, 3);
  for (const f of out.files) assert.deepEqual(validate(f.json), [], f.path);
  const [set, view, layer] = out.files.map((f) => f.json);
  assert.equal(set.license, 'ODbL-1.0');
  assert.equal(set.attribution, '© OpenStreetMap contributors'); // 法定資料署名仍完整保留
  assert.equal(set.props.sourceLabel, 'OpenStreetMap');
  assert.deepEqual(set.props.preview, previewProps(1));
  assert.equal(set.source.url, 'https://www.openstreetmap.org/relation/11');
  assert.equal(view.origin, 'authorized');
  assert.equal(view.license, 'CC-BY-SA-4.0');
  assert.equal(view.attribution, 'Jan Novák（Wikimedia Commons）');
  assert.deepEqual([view.w, view.h], [1600, 1000]);
  assert.deepEqual(out.photos, [{ path: view.href, url: 'https://upload.wikimedia.org/thumb/1600px-Left wall.jpg', size: { w: 1600, h: 1000 } }]);
  assert.deepEqual(out.sheet, { path: 'preview.jpg', urls: [out.photos[0].url] });
  // 路線：只有畫在照片上的；名稱、難度（各種系統）、長度、風格
  const routes = set.nodes.filter((n) => n.type === 'route');
  assert.deepEqual(routes.map((r) => r.name).sort(), ['乙', '甲']);
  assert.deepEqual(routes.find((r) => r.name === '乙').props, { code: 'osm/node/101', grade: { uiaa: '5+', french: '5c' }, length: 20, style: 'sport' });
  // 線：座標是比例乘照片大小；編號牌由左到右（甲在左邊是 1）
  const marks = layer.marks;
  assert.deepEqual(marks.map((m) => m.props.label), ['1', '2']);
  assert.equal(set.nodes.find((n) => n.id === marks[0].node).name, '甲');
  assert.deepEqual(marks[0].geometry.coordinates[0], [320, 900]);
  assert.equal(layer.license, 'ODbL-1.0');
});

test('內容指紋：同樣的資料一樣；OSM 上路線有新版本就不一樣；沒有 Topo 的岩場沒有照片、沒有入口小圖', async () => {
  const a = await loadUnits('https://openclimbing.org/relation/10', { get: world().get, keepEmpty: true });
  const b = await loadUnits('https://openclimbing.org/relation/10', { get: world().get, keepEmpty: true });
  assert.equal((await prepare(a.units[0])).version, (await prepare(b.units[0])).version);
  const edited = await loadUnits('https://openclimbing.org/relation/10', { get: world({ routeVersion: 2 }).get });
  assert.notEqual((await prepare(edited.units[0])).version, (await prepare(a.units[0])).version);
  const none = await prepare(a.units[2]);
  assert.deepEqual([none.photos, none.sheet], [[], null]);
});

test('區域有很多岩場也只讀幾次：區域一次、底下的岩場一批、路線節點一批、Commons 一批', async () => {
  const { get, calls } = world();
  await loadUnits('https://openclimbing.org/relation/10', { get });
  assert.equal(calls.filter((u) => u.includes('/relation/10.json')).length, 1);
  assert.equal(calls.filter((u) => u.includes('/relations.json')).length, 1);
  assert.equal(calls.filter((u) => u.includes('/nodes.json')).length, 1);
  assert.equal(calls.filter((u) => u.includes('commons.wikimedia.org')).length, 1);
});

test('收藏 OpenClimbing 子岩壁時保留從所選區域到岩壁的來源關係', async () => {
  const { get } = world();
  const result = await loadUnits('https://openclimbing.org/relation/10', { get });
  const wall = result.units.find((u) => u.rel.id === 11);
  assert.deepEqual(wall.hierarchy.map((x) => x.id), ['osm:relation:10', 'osm:relation:11']);
  const saved = await prepare(wall, 1);
  assert.deepEqual(saved.files[0].json.props.sourceHierarchy, wall.hierarchy);
  assert.deepEqual(validate(saved.files[0].json), []);
});
