const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseDataPath, siteData, gymData, routesData, sharedData, sendSiteData } = require('./site-data');
const { HF_BASE } = require('./projects');
const { validate } = require('./format');

test('只認 /climbio.json、/w/gym/{岩館}.json、/w/{牆 id}/routes.json、thumb.jpg', () => {
  assert.deepEqual(parseDataPath('/climbio.json'), { kind: 'site' });
  assert.deepEqual(parseDataPath(`/w/gym/${encodeURIComponent('原岩明德')}.json`), { kind: 'gymWalls', gym: '原岩明德' });
  assert.deepEqual(parseDataPath('/w/abcdefgh1234/routes.json'), { kind: 'wall', pid: 'abcdefgh1234', file: 'routes.json' });
  assert.deepEqual(parseDataPath('/w/abcdefgh1234/thumb.jpg'), { kind: 'wall', pid: 'abcdefgh1234', file: 'thumb.jpg' });
  for (const p of ['/w/abc/routes.json', '/w/abcdefgh1234/wall.json', '/w/abcdefgh1234/photo.jpg', '/w/abcdefgh1234/base.gz', '/w/gym/%E0.json', '/w/gym/.json', `/w/gym/${'x'.repeat(61)}.json`, '/climbio.json/x', '/r/abcdefgh1234/r1/']) assert.equal(parseDataPath(p), null, p);
});

// 假的 Firestore：gymIndex/all、gymWalls、shared/{pid}、wallRoutes/{pid}
const snap = (id, d) => ({ id, exists: !!d, get: (k) => d && d[k] });
function fakeDb({ index, walls = {}, shared = {}, wallRoutes = {}, datasets = {} }) {
  return { collection: (name) => {
    if (name === 'gymIndex') return { doc: () => ({ get: async () => snap('all', index) }) };
    if (name === 'gymWalls') return { doc: (id) => ({ get: async () => snap(id, walls[id]) }), where: (_f, _op, gym) => ({ orderBy: () => ({ limit: () => ({ get: async () => ({
      docs: Object.entries(walls).filter(([, w]) => w.gym === gym).sort((a, b) => b[1].t - a[1].t).map(([id, w]) => snap(id, w)) }) }) }) }) };
    const data = name === 'shared' ? shared : name === 'datasets' ? datasets : wallRoutes;
    return { doc: (id) => ({ get: async () => snap(id, data[id]) }) };
  } };
}
const origin = 'https://climbio.web.app';
const SRC = { project: 'wallproject00001', path: 'aaaaaaaa0001.json' };

test('climbio.json：站的組合，有公開牆面的岩館最新的在前；通過驗證', async () => {
  const db = fakeDb({ index: { gyms: { 紅石士林: { n: 1, t: 5 }, 原岩明德: { n: 2, t: 20 } } } });
  const d = await siteData({ db, origin, listed: true });
  assert.deepEqual(validate(d), []);
  assert.deepEqual([d.kind, d.type, d.name, d.props], ['set', 'site', 'Climbio', { url: origin, listed: true }]);
  assert.deepEqual(d.items, [{ href: `w/gym/${encodeURIComponent('原岩明德')}.json`, name: '原岩明德', t: 20, props: { walls: 2 } },
    { href: `w/gym/${encodeURIComponent('紅石士林')}.json`, name: '紅石士林', t: 5, props: { walls: 1 } }]);
  assert.equal((await siteData({ db: fakeDb({}), origin })).items.length, 0);
});

test('岩館的牆面：組合，一面牆一項，最新的在前，只有這間岩館的；縮圖在資料集；有線讀路線圖層，沒有線讀資料集裡發佈的入口', async () => {
  const hf = 'walls/wallproject00001/v2/';
  const db = fakeDb({ walls: {
    aaaaaaaa0001: { gym: '原岩明德', name: '大牆', n: 3, t: 10, src: SRC, hf },
    bbbbbbbb0002: { gym: '原岩明德', name: '小牆', n: 0, t: 30, src: { project: 'wallproject00002', path: 'bbbbbbbb0002.json' }, hf: 'walls/wallproject00002/v1/' },
    cccccccc0003: { gym: '紅石士林', name: '別間', n: 1, t: 40, src: SRC, hf } } });
  const d = await gymData({ db, gym: '原岩明德', origin });
  assert.deepEqual(validate(d), []);
  assert.deepEqual([d.type, d.name], ['walls', '原岩明德']);
  assert.deepEqual(d.items.map(x => [x.id, x.href, x.props.thumb, x.props.routes]), [
    ['bbbbbbbb0002', `${HF_BASE}walls/wallproject00002/v1/bbbbbbbb0002.json`, `${HF_BASE}walls/wallproject00002/v1/bbbbbbbb0002.thumb.jpg`, 0],
    ['aaaaaaaa0001', `${origin}/w/aaaaaaaa0001/routes.json`, `${HF_BASE}${hf}aaaaaaaa0001.thumb.jpg`, 3]]);
});

test('岩點貓公開牆（wallRoutes）：路線的片段併成一個圖層，href 指到資料集裡發佈的包；路線連結只給那一條；沒有這種牆回 null', async () => {
  const frag = (id, t) => JSON.stringify({ nodes: [{ id: 'm1', type: 'hold' }, { id, type: 'route', t, props: { holds: { h1: 's', m1: 't' } } }], marks: [{ node: 'm1', geometry: { type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 4], [0, 0]]] } }, { node: id, geometry: { type: 'Point', coordinates: [1, 1] } }] });
  const data = { shared: { abcdefgh1234: { src: { project: 'wallproject00001', path: 'layer0000001.json' } } }, wallRoutes: { abcdefgh1234: { routes: { r1: { uid: 'u1', t: 5, r: frag('r1', 5) }, r2: { uid: 'u2', t: 9, r: frag('r2', 9) } } } } };
  const db = fakeDb({ ...data, walls: { abcdefgh1234: { gym: 'g', hf: 'walls/wallproject00001/v2/' } } });
  const all = await routesData({ db, origin, pid: 'abcdefgh1234' });
  assert.deepEqual(validate(all), []);
  assert.deepEqual([all.kind, all.on, all.href, all.t], ['layer', 'abcdefgh1234', `${HF_BASE}walls/wallproject00001/v2/abcdefgh1234.json`, 9]);
  assert.deepEqual(all.nodes.map(n => n.id), ['m1', 'r2', 'r1']);   // 共用的岩點節點只放一次，路線最新的在前
  assert.equal(all.marks.length, 4);
  const one = await routesData({ db, origin, pid: 'abcdefgh1234', rid: 'r1' });
  assert.deepEqual([one.nodes.map(n => n.id), one.t, one.id === all.id], [['m1', 'r1'], 5, false]);
  assert.equal(await routesData({ db, origin, pid: 'abcdefgh1234', rid: 'r9' }), null);
  assert.equal(await routesData({ db: fakeDb({ shared: { abcdefgh1234: { owner: 'u1' } }, wallRoutes: data.wallRoutes, walls: { abcdefgh1234: { gym: 'g', hf: 'x/' } } }), origin, pid: 'abcdefgh1234' }), null, '擁有者收回了（沒有 src）：這面牆沒有公開');
});

test('路線圖層帶先下載用的位置：縮圖（資料集網址）、照片（牆的畫面旁的 jpg）、岩館；沒登記在清單的牆只有照片；3D 牆都沒有', async () => {
  const frag = JSON.stringify({ nodes: [{ id: 'r1', type: 'route', t: 5, props: { holds: { h1: 's' } } }], marks: [] });
  const wallRoutes = { abcdefgh1234: { routes: { r1: { uid: 'u1', t: 5, r: frag } } } };
  const listed = { abcdefgh1234: { gym: '原岩明德', hf: 'walls/wallproject00001/v2/' } };
  const withHint = await routesData({ db: fakeDb({ shared: { abcdefgh1234: { src: SRC } }, wallRoutes, walls: listed }), origin, pid: 'abcdefgh1234', rid: 'r1' });
  assert.deepEqual(validate(withHint), []);
  assert.deepEqual(withHint.props, { gym: '原岩明德', thumb: `${HF_BASE}walls/wallproject00001/v2/abcdefgh1234.thumb.jpg`, photo: `${HF_BASE}walls/wallproject00001/v2/abcdefgh1234.jpg` });
  assert.equal(withHint.href, `${HF_BASE}walls/wallproject00001/v2/abcdefgh1234.json`, '有登記的牆：畫面直接指到資料集，不經 /p/ 轉址');
  const bare = await routesData({ db: fakeDb({ shared: { abcdefgh1234: { src: SRC } }, wallRoutes }), origin, pid: 'abcdefgh1234', rid: 'r1' });
  assert.equal(bare, null, '沒登記在清單（收回或過期）的牆不是公開牆');
  const m3d = await routesData({ db: fakeDb({ shared: { abcdefgh1234: { src: { project: 'wallproject00001', path: 'index.json' } } }, wallRoutes, walls: { abcdefgh1234: { ...listed.abcdefgh1234, m3d: 1, repo: 'walls3d' } } }), origin, pid: 'abcdefgh1234', rid: 'r1' });
  assert.deepEqual(m3d.props, { gym: '原岩明德' });
  assert.ok(m3d.href.endsWith('/walls3d/resolve/main/walls/wallproject00001/v2/index.json'), '3D 牆也直接指到資料集');
});

test('/w/{牆 id}/thumb.jpg：清單上的牆導向資料集裡的縮圖；不在清單回 404', async () => {
  const send = async (db) => {
    const out = { headers: {} };
    const res = { set(k, v) { Object.assign(out.headers, typeof k === 'object' ? k : { [k]: v }); return res; }, redirect(code, url) { out.redirect = [code, url]; return res; }, status(c) { out.status = c; return res; }, json() { return res; } };
    await sendSiteData(res, { db, origin: 'https://s.example', listed: true, p: { kind: 'wall', pid: 'aaaaaaaa0001', file: 'thumb.jpg' } });
    return out;
  };
  const listed = await send(fakeDb({ walls: { aaaaaaaa0001: { gym: 'g', name: '牆', n: 0, t: 1, src: SRC, hf: 'walls/wallproject00001/v2/' } } }));
  assert.deepEqual(listed.redirect, [302, `${HF_BASE}walls/wallproject00001/v2/aaaaaaaa0001.thumb.jpg`]);
  assert.equal((await send(fakeDb({}))).status, 404);
});

test('岩館的牆面：3D 牆帶 props.model，縮圖和入口在 3D 牆的資料集，通過驗證', async () => {
  const A = 'aaaaaaaaaaaaaaaa', hf = `walls3d/${A}/`;
  const db = fakeDb({ walls: { [A]: { gym: '原岩明德', name: '明德 3D', n: 0, t: 9, m3d: 1, repo: 'walls3d', hf, src: { project: A, path: 'index.json' } } } });
  const d = await gymData({ db, gym: '原岩明德', origin });
  assert.deepEqual(validate(d), []);
  assert.equal(d.items[0].props.model, '3d');
  assert.equal(d.items[0].props.thumb, `https://huggingface.co/datasets/climbio/walls3d/resolve/main/${hf}thumb.jpg`);
  assert.ok(d.items[0].href.endsWith(`${hf}index.json`));
});

test('shared.json：App 讀公開牆的線用（作者只給雜湊、帶版本、新的在前），沒公開的牆 published: false', async () => {
  const db = fakeDb({ shared: { aaaaaaaa0001: { src: SRC } }, datasets: { [SRC.project]: { version: 3 } },
    wallRoutes: { aaaaaaaa0001: { routes: { r1: { uid: 'k:abc', t: 5, r: '{}' }, r2: { uid: 'k:def', t: 9, r: '{}' } } } } });
  const got = await sharedData({ db, pid: 'aaaaaaaa0001' });
  assert.equal(got.published, true); assert.equal(got.ver, 3); assert.deepEqual(got.src, SRC);
  assert.deepEqual(got.routes.map(x => x.rid), ['r2', 'r1']);
  assert.match(got.routes[0].u, /^[0-9a-f]{16}$/); assert.ok(!JSON.stringify(got).includes('k:abc'));
  assert.deepEqual(await sharedData({ db, pid: 'bbbbbbbb0002' }), { published: false, routes: [] });
  assert.deepEqual(parseDataPath('/w/abcdefgh1234/shared.json'), { kind: 'wall', pid: 'abcdefgh1234', file: 'shared.json' });
});
