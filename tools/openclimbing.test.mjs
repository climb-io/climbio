import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fromOpenClimbing, isOpenClimbing, loadUnits, parsePath, parseUrl, preparePack, spdxOf } from '../redpoint/openclimbing.js';

const { validate } = createRequire(import.meta.url)('../format/format.js');

const node = (id, tags, version = 1) => ({ type: 'node', id, version, tags: { climbing: 'route_bottom', ...tags } });
const rel = (id, tags, members, version = 1) => ({ type: 'relation', id, version, tags, members: members.map(([type, ref]) => ({ type, ref, role: '' })) });
const page = (title, license, artist = 'Jan Novák') => ({
  title,
  imageinfo: [{
    thumburl: `https://upload.wikimedia.org/thumb/1600px-${title.slice(5)}`,
    thumbwidth: 1600, thumbheight: 1000, width: 4000, height: 2500, mime: 'image/jpeg',
    descriptionurl: `https://commons.wikimedia.org/wiki/${title}`,
    extmetadata: { LicenseShortName: { value: license }, Artist: { value: artist } },
  }],
});

function mockWorld() {
  const relations = new Map([
    [100, rel(100, { climbing: 'crag', name: 'Eagle Rock' }, [['node', 1001], ['node', 1002]])],
  ]);
  const nodes = new Map([
    [1001, node(1001, { name: 'Sunset Slab', 'climbing:grade:sport': '5.10a', 'climbing:sport': 'yes', 'wikimedia_commons': 'File:Eagle.jpg', 'wikimedia_commons:path': '0.2,0.8|0.25,0.3B|0.28,0.15A' })],
    [1002, node(1002, { name: 'Crack Line', 'climbing:grade:trad': '5.9', 'climbing:trad': 'yes', 'wikimedia_commons': 'File:Eagle.jpg', 'wikimedia_commons:path': '0.5,0.9|0.5,0.2' })],
  ]);
  const commons = { 'File:Eagle.jpg': page('File:Eagle.jpg', 'CC BY-SA 4.0') };

  const get = async (url) => {
    const u = new URL(url);
    if (u.origin === 'https://commons.wikimedia.org') {
      return { query: { pages: Object.fromEntries(u.searchParams.get('titles').split('|').filter((t) => commons[t]).map((t, i) => [i, commons[t]])) } };
    }
    let m;
    if ((m = u.pathname.match(/\/relation\/(\d+)\.json$/))) return { elements: [relations.get(Number(m[1]))] };
    if (u.pathname.endsWith('/relations.json')) return { elements: u.searchParams.get('relations').split(',').map((id) => relations.get(Number(id))) };
    if (u.pathname.endsWith('/nodes.json')) return { elements: u.searchParams.get('nodes').split(',').map((id) => nodes.get(Number(id))) };
    throw new Error(`404: ${url}`);
  };
  return { get };
}

test('redpoint/openclimbing: 識別與解析 OpenClimbing 網址', () => {
  assert.ok(isOpenClimbing('https://openclimbing.org/relation/17457880'));
  assert.ok(isOpenClimbing('https://openclimbing.org/relation/17457880/eagle-rock'));
  assert.ok(isOpenClimbing('https://www.openstreetmap.org/relation/17457880'));
  assert.ok(isOpenClimbing('osm:relation:17457880'));
  assert.ok(!isOpenClimbing('https://climbio.app/p/123/index.json'));

  assert.deepEqual(parseUrl('https://openclimbing.org/relation/17457880'), { type: 'relation', id: 17457880 });
  assert.deepEqual(parseUrl('osm:relation:17457880'), { type: 'relation', id: 17457880 });
});

test('redpoint/openclimbing: preparePack 產出合格 Climbio v2 規格', async () => {
  const { get } = mockWorld();
  const loaded = await loadUnits('https://openclimbing.org/relation/100', { get });
  assert.equal(loaded.units.length, 1);
  assert.equal(loaded.units[0].topos, 1);

  const pack = await preparePack(loaded, 1000);
  assert.ok(pack.id);
  assert.equal(pack.name, 'Eagle Rock');
  assert.equal(pack.docs.size, 3); // set + view + layer

  for (const [id, doc] of pack.docs) {
    const errs = validate(doc);
    assert.deepEqual(errs, [], `文件 ${id} 格式驗證`);
  }

  const setDoc = pack.rootDoc;
  assert.equal(setDoc.kind, 'set');
  assert.equal(setDoc.nodes.length, 4); // crag + wall + 2 routes
  assert.equal(setDoc.props.sourceLabel, 'OpenStreetMap');
  assert.equal(setDoc.attribution, '© OpenStreetMap contributors'); // 不是用來源標籤取代完整署名
});

test('redpoint/openclimbing: 官方 bolt、anchor、piton、sling、unfinished 及虛線標記不應丟棄整條線', () => {
  assert.deepEqual(parsePath('0.682,0.823|0.642,0.453B:|0.557,0.177A'),
    [[0.682, 0.823], [0.642, 0.453], [0.557, 0.177]]);
  assert.deepEqual(parsePath('0.1,0.2P|0.3,0.4S|0.5,0.6U'),
    [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]]);
  assert.deepEqual(parsePath('0.1,0.2B|1.1,0.5A'), []);
  assert.deepEqual(parsePath('0.1,0.2B|nonsense'), []);
  assert.deepEqual(parsePath('0.1,0.2'), []);
});

const topoCounts = (loaded) => ({
  photoCount: loaded.units.reduce((sum, u) => sum + u.views.length, 0),
  routeCount: new Set(loaded.units.flatMap((u) => u.views.flatMap((v) => v.lines.map((l) => l.node.id)))).size,
});

test('redpoint/openclimbing: 候選路線即使有 path，缺少 Commons 照片仍不可宣稱 Topo', async () => {
  const { get: source } = mockWorld();
  const get = async url => url.startsWith('https://commons.wikimedia.org/')
    ? { query: { pages: { '-1': { title: 'File:Eagle.jpg', missing: true } } } }
    : source(url);
  const loaded = await loadUnits('https://openclimbing.org/relation/100', { get });
  assert.equal(topoCounts(loaded).photoCount, 0);
  assert.equal(topoCounts(loaded).routeCount, 0);
});

test('redpoint/openclimbing: 可用照片數與標線路線數只在解析和授權後計算', async () => {
  const { get } = mockWorld();
  const loaded = await loadUnits('https://openclimbing.org/relation/100', { get });
  assert.equal(topoCounts(loaded).photoCount, 1);
  assert.equal(topoCounts(loaded).routeCount, 2);
});

test('redpoint/openclimbing: 六個 Block 能合成單一區域包且每個 Block 保留來源與照片授權', async () => {
  const { get } = mockWorld();
  const original = await loadUnits('https://openclimbing.org/relation/100', { get });
  const first = original.units[0];
  const second = {
    ...first, rel: { ...first.rel, id: 200, tags: { ...first.rel.tags, name: 'Block 2' } },
    name: 'Block 2',
    routes: first.routes.map(n => ({ ...n, id: n.id + 10000 })),
    views: first.views.map(v => ({ ...v,
      lines: v.lines.map(l => ({ ...l, node: { ...l.node, id: l.node.id + 10000 } })) })),
  };
  const loaded = { root: { ...original.root, name: 'Sass de Bèita' },
    units: [{ ...first, name: 'Block 1' }, second] };
  const pack = await preparePack(loaded, 1000, { groupIds: [100, 200], areaPath: ['Sass de Bèita'] });
  assert.equal(pack.rootDoc.name, 'Sass de Bèita');
  assert.equal(pack.rootDoc.nodes.filter(n => n.type === 'area').length, 2);
  assert.equal(pack.rootDoc.items.filter(i => i.id && pack.docs.get(i.id)?.kind === 'view').length, 2);
  assert.equal(pack.rootDoc.props.sourceCrags.length, 2);
  assert.ok(pack.rootDoc.nodes.some(n => n.name === 'Block 1'));
  assert.ok(pack.rootDoc.nodes.some(n => n.name === 'Block 2'));
  for (const doc of pack.docs.values()) assert.deepEqual(validate(doc), [], `Invalid ${doc.kind} ${doc.id}`);
  const layers = [...pack.docs.values()].filter(d => d.kind === 'layer');
  assert.equal(layers.length, 2);
  assert.deepEqual(layers.map(l => l.source.url), [
    'https://www.openstreetmap.org/relation/100',
    'https://www.openstreetmap.org/relation/200',
  ]);
  assert.ok([...pack.docs.values()].filter(d => d.kind === 'view').every(v => v.license === 'CC-BY-SA-4.0'));
});
