import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

// appkit/share-tools.js 讀公開格式 v2：收線（路線圖層 → 牆 → 照片）、找牆面（站、岩館、總目錄的組合）、Drive 上的牆（404 標 dead 讓呼叫的人通報）
const require = createRequire(import.meta.url);
const ClimbioFormat = require('../format/format.js'), RouteKit = require('../routekit/format.js');
const { wallView, routesLayer, siteSet, gymSet, directorySet } = require('../functions/open-format.js');
const src = readFileSync(new URL('../appkit/share-tools.js', import.meta.url), 'utf8');

const SITE_URL = 'https://climbio.web.app', PID = 'abcdefgh1234';
const sq = (x, y) => [[x, y], [x + 4, y], [x + 4, y + 4]];
const base = { name: '大牆', w: 40, h: 30, thumb: 'data:image/jpeg;base64,AAAA', holds: [{ id: 'h1', poly: sq(0, 0) }, { id: 'h2', poly: sq(10, 10) }] };
const route = { id: 'r1', name: '白白白', grade: 'V5', author: 'Kant', t: 5, holds: { h1: 's', m1: 't' }, shapes: { h1: { id: 'h1', poly: sq(1, 1), source: 'edited' }, m1: { id: 'm1', poly: sq(20, 20), source: 'manual' } } };
const view = wallView({ pid: PID, base, attribution: 'Kant', t: 5 });
const photo = { type: 'image/jpeg', size: 1000 };
const plain = (x) => JSON.parse(JSON.stringify(x));   // vm 裡做的物件換成這邊的，才能 deepEqual

// pages：網址 → JSON、{ blob }、狀態碼
// hold：這些網址等 release(網址) 才回應（看哪些請求同時在下載）
function make(pages, { hold = [] } = {}) {
  const asked = [], gates = new Map(hold.map(u => { let open; const p = new Promise(r => { open = r; }); return [u, { p, open }]; }));
  const fetch = async (url) => {
    url = String(url); asked.push(url);
    if (gates.has(url)) await gates.get(url).p;
    const f = pages[url];
    if (f === undefined) return { ok: false, status: 404 };
    if (typeof f === 'number') return { ok: false, status: f };
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(f)), blob: async () => f.blob };
  };
  const document = { createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,THUMB' }) };
  const ctx = { fetch, SITE: {}, ClimbioFormat, RouteKit, URL, AbortController, atob, TextEncoder, Uint8Array, navigator: { onLine: true }, document, location: { hostname: 'climbio-dev.web.app', href: 'https://climbio-dev.web.app/' },
    createImageBitmap: async () => ({ width: 40, height: 30, close() {} }), console, Error, AppKit: { photo: { QUALITY: { tiny: 0.75 } } },
    FileReader: class { readAsDataURL(b) { this.result = `data:image/jpeg;base64,${b.name}`; this.onload(); } } };
  ctx.window = ctx.self = ctx;
  vm.runInContext(src, vm.createContext(ctx));
  return { S: ctx.ShareTools, asked, release: (u) => gates.get(u).open() };
}

test('收線：讀路線圖層、它疊的牆和照片；路線自己的外框、畫面沒有的岩點都帶進路線', async () => {
  const layer = routesLayer({ id: 'layer0000000001', pid: PID, href: `${SITE_URL}/w/${PID}/wall.json`, base, routes: [{ route, gym: '原岩明德' }] });
  const { S } = make({ [`${SITE_URL}/r/${PID}/r1/route.json`]: layer, [`${SITE_URL}/w/${PID}/wall.json`]: view, [`${SITE_URL}/w/${PID}/photo.jpg`]: { blob: photo }, [`${SITE_URL}/w/${PID}/thumb.jpg`]: { blob: { name: 'SITE' } } });
  const infos = [];
  const got = await S.fetchShared(S.linkFrom(`${SITE_URL}/r/${PID}/r1/`), { onInfo: x => infos.push(x) }).done;
  assert.deepEqual(plain(got.doc), { author: 'Kant', gym: '原岩明德' });
  assert.deepEqual(plain([got.route.id, got.route.name, got.route.grade, got.route.holds]), ['r1', '白白白', 'V5', { h1: 's', m1: 't' }]);
  assert.deepEqual(plain(got.route.shapes.h1), { id: 'h1', poly: sq(1, 1), source: 'edited' });
  assert.deepEqual(plain(got.route.shapes.m1.poly), sq(20, 20));
  assert.deepEqual([got.base.name, got.base.w, got.base.h, got.base.holds.length, got.base.thumb], ['大牆', 40, 30, 2, 'data:image/jpeg;base64,THUMB']);
  assert.equal(got.photo, photo);
  // 舊的圖層（沒有 props.thumb、preview）：牆到了才讀牆的縮圖，開箱先畫站上的縮圖（下載成 data:，畫布才讀得了像素）
  assert.deepEqual(plain(infos.map(x => Object.keys(x))), [['ownerName', 'route'], ['name', 'thumb', 'w', 'h', 'holds'], ['thumb', 'w', 'h', 'holds']]);
  assert.equal(infos[0].route.name, '白白白');
  assert.equal(infos[2].thumb, 'data:image/jpeg;base64,SITE');
});

test('收線：圖層帶縮圖網址和極小預覽圖：拿到圖層就先畫預覽，牆、縮圖同時下載，牆到了就下載照片', async () => {
  const PREVIEW = 'data:image/jpeg;base64,TINY';
  const layer = routesLayer({ id: 'layer0000000001', pid: PID, href: `${SITE_URL}/w/${PID}/wall.json`, base, routes: [{ route, gym: '' }], thumb: `${SITE_URL}/w/${PID}/thumb.jpg`, preview: PREVIEW });
  assert.deepEqual(ClimbioFormat.validate(layer), []);
  const { S, asked, release } = make({ [`${SITE_URL}/r/${PID}/r1/route.json`]: layer, [`${SITE_URL}/w/${PID}/wall.json`]: view, [`${SITE_URL}/w/${PID}/photo.jpg`]: { blob: photo }, [`${SITE_URL}/w/${PID}/thumb.jpg`]: { blob: { name: 'SITE' } } },
    { hold: [`${SITE_URL}/w/${PID}/wall.json`, `${SITE_URL}/w/${PID}/thumb.jpg`] });
  const infos = [], job = S.fetchShared(S.linkFrom(`${SITE_URL}/r/${PID}/r1/`), { onInfo: x => infos.push(plain(x)) });
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(asked.slice(1).sort(), [`${SITE_URL}/w/${PID}/thumb.jpg`, `${SITE_URL}/w/${PID}/wall.json`]);   // 牆、縮圖同時在下載
  assert.deepEqual([infos.length, infos[0].ownerName, infos[0].route.name, infos[1]], [2, 'Kant', '白白白', { thumb: PREVIEW }]);
  release(`${SITE_URL}/w/${PID}/wall.json`);
  await new Promise(r => setTimeout(r, 10));
  assert.ok(asked.includes(`${SITE_URL}/w/${PID}/photo.jpg`));   // 縮圖還沒到就開始下載照片
  assert.deepEqual([infos[2].name, infos[2].thumb, infos[2].holds.length], ['大牆', PREVIEW, 2]);   // 牆到了：照路線裁切，還是先用預覽圖
  release(`${SITE_URL}/w/${PID}/thumb.jpg`);
  const got = await job.done;
  assert.equal(infos[3].thumb, 'data:image/jpeg;base64,SITE');
  assert.deepEqual([got.route.id, got.base.holds.length, got.photo], ['r1', 2, photo]);
});

test('收線：格式不對、牆對不上照片編號、沒有這條路線都收不了', async () => {
  const layer = routesLayer({ id: 'layer0000000001', pid: PID, href: `${SITE_URL}/w/${PID}/wall.json`, base, routes: [{ route, gym: '' }] });
  const link = { pid: PID, rid: 'r1', src: `${SITE_URL}/r/${PID}/r1/` };
  for (const pages of [
    { [`${link.src}route.json`]: { ...layer, climbio: 1 } },
    { [`${link.src}route.json`]: layer, [`${SITE_URL}/w/${PID}/wall.json`]: { ...view, id: 'zzzzzzzz9999' } },
    { [`${link.src}route.json`]: layer, [`${SITE_URL}/w/${PID}/wall.json`]: { ...view, marks: [{ node: 'h1', geometry: { type: 'Polygon', coordinates: [[[0, 0], [99, 0], [1, 1], [0, 0]]] } }] } },
  ]) await assert.rejects(make(pages).S.fetchShared(link).done);
  await assert.rejects(make({ [`${link.src}route.json`]: layer, [`${SITE_URL}/w/${PID}/wall.json`]: view }).S.fetchShared({ ...link, rid: 'r9' }).done);
});

test('找牆面：站、岩館的組合；總目錄同一間岩館的站合在一起', async () => {
  const gyms = [{ gym: '原岩明德', n: 2, t: 9 }];
  const walls = [{ pid: PID, name: '大牆', thumb: 'data:image/jpeg;base64,AAAA', routes: 3, t: 9, href: `${SITE_URL}/w/${PID}/routes.json` },
    { pid: 'bbbbbbbb0002', name: 'Drive', thumb: `${SITE_URL}/w/bbbbbbbb0002/thumb.jpg`, routes: 0, t: 5, href: 'drive://155rucBALp951T-6trWFXIvmB_hvHDtCN/d85019fd05c2dc13.json' }];
  const other = 'https://gym.climbing.tw';
  const { S } = make({
    [`${SITE_URL}/climbio.json`]: siteSet({ origin: SITE_URL, listed: true, gyms }),
    [`${SITE_URL}/w/gym/${encodeURIComponent('原岩明德')}.json?read=project`]: gymSet({ origin: SITE_URL, gym: '原岩明德', walls }),
    [`${SITE_URL}/dir/gyms.json`]: directorySet({ origin: SITE_URL, gyms: [
      { gym: '原岩明德', n: 2, t: 9, href: `${SITE_URL}/w/gym/x.json`, site: 'Climbio' }, { gym: '原岩明德', n: 1, t: 12, href: `${other}/w/gym/x.json`, site: '岩館A' }] }),
  });
  assert.deepEqual(plain(await S.siteGyms(SITE_URL)), [{ gym: '原岩明德', n: 2, t: 9 }]);
  assert.deepEqual(plain(await S.gymWalls(SITE_URL, '原岩明德')), walls);
  assert.deepEqual(plain(await S.directoryGyms(SITE_URL)), [{ gym: '原岩明德', n: 3, t: 12, sites: [{ url: SITE_URL, name: 'Climbio' }, { url: other, name: '岩館A' }] }]);
});

test('找牆面（Climbio 官方站）：只讀一個 index，岩館、各岩館的牆都從它分；3D 牆帶 m3d 和資料夾，別的站照開放格式讀', async () => {
  const HF = 'https://huggingface.co/datasets/climbio/walls/resolve/main/', P2 = 'pack000000000001', PM = 'pack3d0000000001';
  const index = { climbio: 2, kind: 'index', t: 1, walls: [
    { id: `${P2}/${PID}`, name: '大牆', gym: '原岩明德', v: 3, rt: 8, n: 3, t: 9 },
    { id: `${PM}/${PM}`, name: '3D 牆', gym: '原岩明德', v: 0, rt: 0, n: 0, t: 12, m3d: 1, base: `https://huggingface.co/datasets/climbio/walls3d/resolve/main/walls3d/${PM}/` },
    { id: 'pack000000000002/ccccccccc003', name: '別間', gym: '別間館', v: 1, rt: 0, n: 0, t: 2 }] };
  const { S, asked } = make({ [`${HF}index/world.json`]: index });
  assert.deepEqual(plain(await S.siteGyms('https://climbio.app')), [{ gym: '原岩明德', n: 2, t: 12 }, { gym: '別間館', n: 1, t: 2 }]);
  const walls = plain(await S.gymWalls('https://climbio.app', '原岩明德'));
  assert.deepEqual(walls, [
    { pid: PM, name: '3D 牆', thumb: `https://huggingface.co/datasets/climbio/walls3d/resolve/main/walls3d/${PM}/thumb.jpg`, routes: 0, t: 12, href: `https://huggingface.co/datasets/climbio/walls3d/resolve/main/walls3d/${PM}/index.json`, m3d: 1 },
    { pid: PID, name: '大牆', thumb: `${HF}walls/${P2}/current/${PID}.thumb.jpg`, routes: 3, t: 9, href: `${HF}walls/${P2}/routes.json` }]);   // 有路線：從路線圖層收；最新的在前
  assert.equal(asked.filter(u => u.endsWith('index/world.json')).length, 1);   // 岩館清單和牆面清單共用同一份 index
  assert.deepEqual(asked.filter(u => !u.endsWith('index/world.json')), []);
});

test('收整面牆：從路線圖層收（牆和公開路線）；從 Studio 發佈的包裡的牆收（/p/，沒有路線）', async () => {
  const layer = routesLayer({ id: 'layer0000000002', pid: PID, href: 'wall.json', base, routes: [{ route, gym: '' }] });
  let got = await make({ [`${SITE_URL}/w/${PID}/routes.json`]: layer, [`${SITE_URL}/w/${PID}/wall.json`]: view, [`${SITE_URL}/w/${PID}/photo.jpg`]: { blob: photo } }).S.fetchWall(`${SITE_URL}/w/${PID}/routes.json`, PID);
  assert.deepEqual([got.base.holds.length, plain(got.routes.map(r => r.id)), got.photo], [2, ['r1'], photo]);
  const pkg = `${SITE_URL}/p/wallproject00001/`, published = { ...view, href: `${PID}.jpg` };
  const { S, asked } = make({ [`${pkg}${PID}.json`]: published, [`${pkg}${PID}.jpg`]: { blob: photo } });
  got = await S.fetchWall(`${pkg}${PID}.json`, PID);
  assert.deepEqual([got.base.name, got.base.holds.length, got.routes.length, got.photo], ['大牆', 2, 0, photo]);
  assert.deepEqual(plain(asked), [`${pkg}${PID}.json`, `${pkg}${PID}.jpg`]);
});

test('發佈的包回 404：標 dead（通報用）；其他網址的 404、伺服器錯誤不標', async () => {
  let e = await make({}).S.fetchWall(`${SITE_URL}/p/wallproject00001/${PID}.json`, PID).catch(x => x);
  assert.equal(e.dead, true);
  e = await make({ [`${SITE_URL}/p/wallproject00001/${PID}.json`]: 502 }).S.fetchWall(`${SITE_URL}/p/wallproject00001/${PID}.json`, PID).catch(x => x);
  assert.ok(e instanceof Error && !e.dead);
  e = await make({}).S.fetchWall(`${SITE_URL}/w/${PID}/routes.json`, PID).catch(x => x);
  assert.ok(e instanceof Error && !e.dead);
});

test('分享包（放上個人 Drive 的一面牆）：每個檔都合格式；讀回來的牆和路線跟原本一樣；只有圖層跟路線有關', async () => {
  const { S } = make({});
  const pack = (routes, version = 1) => S.wallPackage({ id: 'pack000000000001', layerId: 'layer00000000001', pid: PID, name: '大牆', gym: '原岩明德', w: base.w, h: base.h, thumb: 'data:image/jpeg;base64,/9g=',
    holds: base.holds, routes, photo: { arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 1]).buffer }, attribution: 'Kant', version, t: 7 });
  const files = await pack([route]), text = (f) => JSON.parse(new TextDecoder().decode(f.bytes)), at = (path) => files.find(f => f.path === path);
  assert.deepEqual(plain(files.map(f => f.path)), ['index.json', `${PID}.json`, `${PID}.jpg`, `${PID}.thumb.jpg`, 'layer00000000001.json']);
  const index = text(at('index.json')), v = text(at(`${PID}.json`)), layer = text(at('layer00000000001.json'));
  for (const d of [index, v, layer]) assert.deepEqual(ClimbioFormat.validate(d), []);
  assert.deepEqual([index.type, index.items[0].href, index.items[0].id, v.href, v.props.thumb, layer.on, layer.href, layer.props.gym, layer.props['climbio:version']],
    ['walls', 'layer00000000001.json', PID, `${PID}.jpg`, `${PID}.thumb.jpg`, PID, `${PID}.json`, '原岩明德', 1]);
  assert.deepEqual([...at(`${PID}.thumb.jpg`).bytes], [0xff, 0xd8]);
  const back = RouteKit.fromFormat(v, [layer]);
  assert.deepEqual(plain(back.holds), base.holds);
  assert.deepEqual(plain([back.routes[0].id, back.routes[0].name, back.routes[0].grade, back.routes[0].holds, back.routes[0].shapes.h1.poly, back.routes[0].shapes.m1.poly]), ['r1', '白白白', 'V5', { h1: 's', m1: 't' }, sq(1, 1), sq(20, 20)]);
  // 加一條線：只有圖層的內容變
  const more = await pack([route, { id: 'r2', t: 9, holds: { h2: 's' }, shapes: { h2: { id: 'h2', poly: sq(10, 10) } } }], 2), same = (a, b) => a.bytes.length === b.bytes.length && a.bytes.every((x, i) => x === b.bytes[i]);
  assert.deepEqual(plain(more.map((f, i) => same(f, files[i]))), [true, true, true, true, false]);
  assert.equal(text(more[4]).marks.some(m => m.props.route === 'r2'), false);   // 外框跟牆上一樣的不寫
});

test('分享包的連結：?wall=路線圖層&r=路線 id；收的時候照片編號看圖層疊在哪面牆，手上有那面牆就不下載照片', async () => {
  const layerUrl = `${SITE_URL}/p/pack000000000001/layer00000000001.json`, dir = `${SITE_URL}/p/pack000000000001/`;
  const layer = RouteKit.routesLayer({ id: 'layer00000000001', pid: PID, href: `${PID}.json`, w: base.w, h: base.h, holds: base.holds, routes: [route], gym: '原岩明德' });
  const v = RouteKit.wallView({ pid: PID, name: '大牆', w: base.w, h: base.h, holds: base.holds, href: `${PID}.jpg`, attribution: 'Kant', t: 5 });
  const { S, asked } = make({ [layerUrl]: layer, [`${dir}${PID}.json`]: v, [`${dir}${PID}.jpg`]: { blob: photo } });
  const link = S.linkFrom(`https://climbio.app/hold/?wall=${encodeURIComponent(layerUrl)}&r=r1`);
  assert.deepEqual(plain(link), { wall: layerUrl, rid: 'r1' });
  assert.deepEqual(plain(S.linkFrom(`https://climbio.app/hold/?wall=${encodeURIComponent(layerUrl)}`)), { wall: layerUrl });   // 沒帶 r：整面牆
  const got = await S.fetchShared(link, {}).done;
  assert.deepEqual([got.pid, got.route.id, got.doc.gym, got.base.name, got.photo], [PID, 'r1', '原岩明德', '大牆', photo]);
  asked.length = 0;
  const had = await S.fetchShared(link, { have: async (pid) => pid === PID }).done;
  assert.deepEqual([had.pid, had.route.id, had.base, had.photo], [PID, 'r1', null, null]);
  assert.deepEqual(asked, [layerUrl, `${dir}${PID}.json`]);
  await assert.rejects(S.fetchShared({ wall: layerUrl, rid: 'nope' }, {}).done);
});

test('收一條線也帶回那個人在這面牆的其他線；讀一個圖層的線、作者拿掉了標 gone', async () => {
  const dir = `${SITE_URL}/p/pack000000000001/`, layerUrl = `${dir}layer00000000001.json`, r2 = { id: 'r2', t: 9, holds: { h2: 's' }, shapes: {} };
  const layer = RouteKit.routesLayer({ id: 'layer00000000001', pid: PID, href: `${PID}.json`, w: base.w, h: base.h, holds: base.holds, routes: [route, r2] });
  const v = RouteKit.wallView({ pid: PID, name: '大牆', w: base.w, h: base.h, holds: base.holds, href: `${PID}.jpg`, attribution: 'Kant', t: 5 });
  const { S } = make({ [layerUrl]: layer, [`${dir}${PID}.json`]: v, [`${dir}${PID}.jpg`]: { blob: photo } });
  const got = await S.fetchShared({ wall: layerUrl, rid: 'r1' }, {}).done;
  assert.deepEqual(plain(got.routes.map(r => r.id)), ['r1', 'r2']);
  assert.deepEqual(plain((await S.layerRoutes(layerUrl, PID)).map(r => r.id)), ['r1', 'r2']);
  await assert.rejects(S.layerRoutes(layerUrl, 'otherwall123'), { gone: true });
  await assert.rejects(S.layerRoutes(`${dir}nothere0000001.json`, PID), { gone: true });
});


test('手機精修記錄：改過、手畫、刪掉的岩點各記一筆；最後外框在 final；沒修改回 null', () => {
  const { S } = make({});
  const b = [{ id: 'h1', poly: sq(0, 0) }, { id: 'h2', poly: sq(10, 10) }, { id: 'h3', poly: sq(20, 20) }];
  assert.equal(S.phoneEdits({ pid: PID, base: b, mine: b.map(h => ({ ...h, source: 'detect' })) }), null);
  const rec = plain(S.phoneEdits({ pid: PID, base: b, mine: [
    { id: 'h1', poly: sq(1, 1), source: 'edited' }, { id: 'h3', poly: sq(20, 20), source: 'detect' }, { id: 'm1', poly: sq(5, 5), source: 'manual' }] }));
  assert.deepEqual(rec.deleted, [{ id: 'h2', poly: sq(10, 10) }]);
  assert.deepEqual(rec.reshaped, [{ id: 'h1', poly: sq(0, 0) }]);
  assert.deepEqual(rec.added, ['m1']);
  assert.deepEqual(rec.final, { h1: sq(1, 1), m1: sq(5, 5) });
  assert.equal(rec.tools.by, 'phone');
  assert.equal(rec.reviewed, false);
});
