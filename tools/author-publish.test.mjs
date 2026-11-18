// Studio Crag（studio/crag/）的發佈：發佈的檔案組成（跟匯出一樣、每份過 validate）、拿掉 camera、擋下來源不能公開的照片、
// 版本號、雲端函式的呼叫
import { test } from 'node:test';
import './studio-i18n.mjs';   // Studio 的訊息走語言包，測試載入繁體中文版
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import AppKit from '../appkit/index.mjs';
import * as M from '../studio/crag/model.js';
import * as P from '../studio/crag/publish.js';
import { createService } from '../studio/service.js';
import { withExif } from '../tests/e2e/exif-jpeg.mjs';
const { readExif } = AppKit.photo;
globalThis.AppKit = AppKit;   // Studio Crag的 model.js 用瀏覽器的全域 AppKit

const { validate } = createRequire(import.meta.url)('../format/format.js');
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const shot = { model: 'iPhone 15', time: '2026:10:28 10:13:20', offset: '+08:00', focal35: 26, lat: 25.1041, lng: 121.9232, alt: 12, accuracy: 5, heading: 312 };

/** 一本有兩張照片（一張有拍照資料）、一條路線的 Guidebook，加上照片檔 */
function book() {
  const state = M.newBook('測試岩場');
  state.book.attribution = 'KK';
  const a = M.newPhoto({ name: 'a', w: 640, h: 480, sha256: 'a'.repeat(64), raw: readExif(withExif(JPEG, shot)) });
  const b = M.newPhoto({ name: 'b', w: 640, h: 480, sha256: 'b'.repeat(64), raw: {} });
  M.addPhoto(state, a);
  M.addPhoto(state, b);
  M.addRoutes(state, [{ name: '第一條', parent: a.props.node, props: { grade: { yds: '5.10a' } } }]);
  const images = [{ path: a.href, blob: new Blob([new Uint8Array([0xff, 0xd8, 1])]) }, { path: b.href, blob: new Blob([new Uint8Array([0xff, 0xd8, 2])]) }];
  return { state, a, b, images };
}

test('發佈的檔案：跟匯出一樣（組合、地圖、照片畫面），每份過 validate；拍照位置與方向（camera）照原樣公開', () => {
  const { state } = book();
  const docs = P.publishDocs(state, { validate });
  assert.deepEqual(docs.map(d => d.path), M.exportDocs(state).map(d => d.path));
  assert.deepEqual(docs.map(d => d.doc), M.exportDocs(state).map(d => d.doc));
  assert.equal(docs[0].path, 'index.json');
  assert.equal(docs.filter(d => d.doc.camera).length, 1);
  for (const { path, doc } of docs) assert.deepEqual(validate(doc), [], path);
  // 格式不對就丟錯
  assert.throws(() => P.publishDocs(state, { validate: () => ['壞了'] }), /格式不對：index.json 壞了/);
});

test('發佈的設定存在組合的 author:publish：匯出、發佈的檔案裡沒有', () => {
  const { state } = book();
  assert.deepEqual(P.publishState(state), { consent: false });
  P.setPublishState(state, { consent: true });
  P.setPublishState(state, { version: 3, url: 'u', files: [] });
  assert.deepEqual(P.publishState(state), { consent: true, version: 3, url: 'u', files: [] });
  assert.equal(P.publishDocs(state, { validate })[0].doc.props['author:publish'], undefined);
  P.clearPublished(state);
  assert.deepEqual(P.publishState(state), { consent: true });
});

test('來源不能公開的畫面（origin 不是 self／authorized）擋下並列出', () => {
  const { state, b } = book();
  assert.deepEqual(P.blocked(state), []);
  b.origin = 'paper';
  delete state.map.origin;
  assert.deepEqual(P.blocked(state).map(x => x.id).sort(), [b.id, state.map.id].sort());
  assert.equal(P.blocked(state).find(x => x.id === b.id).name, 'b');
});

test('同意畫面的內容：照片、路線、Topo、岩壁、有拍照資料的照片', () => {
  const { state } = book();
  assert.deepEqual(P.summary(state), { photos: 2, routes: 1, topos: 0, walls: 1, cameras: 1 });
});

test('雲端函式：服務沒開（連不上）、暫停（503）、開著；發佈與下架帶登入的 token', async () => {
  const calls = [];
  const fetchFn = (r) => async (url, opt) => { calls.push([url, opt]); return r(); };
  const json = (status, body) => ({ status, ok: status < 300, json: async () => body });
  const svc = (r) => createService({ url: 'https://fn.test/projects', idToken: async () => 'tok', fetchFn: fetchFn(r) });
  assert.equal(await svc(() => { throw new TypeError('Failed to fetch'); }).ping(), 'off');
  assert.equal(await svc(() => json(404, {})).ping(), 'off');
  assert.equal(await svc(() => json(503, {})).ping(), 'paused');
  assert.equal(await svc(() => json(200, { ok: true })).ping(), 'ok');
  assert.equal(await createService({ url: '', idToken: async () => '' }).ping(), 'off');
  const s = svc(() => json(200, { id: 'g', version: 1, url: 'u' }));
  assert.deepEqual(await s.publishHf({ id: 'g', type: 'guidebook', name: '名', files: [{ path: 'index.json', sha256: 'x', size: 1 }] }), { id: 'g', version: 1, url: 'u' });
  const [url, opt] = calls.at(-1);
  assert.equal(url, 'https://fn.test/projects');
  assert.equal(opt.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(opt.body), { op: 'publish', hf: true, id: 'g', type: 'guidebook', name: '名', files: [{ path: 'index.json', sha256: 'x', size: 1 }], locations: [], listed: true });
  await assert.rejects(svc(() => json(403, { error: 'not owner' })).unpublish('g'), (e) => e.status === 403 && e.message === 'not owner');
  // App Check 權杖：有就帶在 X-Firebase-AppCheck，沒有就不帶
  const sent = [];
  const withCheck = (appCheck) => createService({ url: 'https://fn.test/projects', idToken: async () => '', appCheck, fetchFn: async (u, o) => { sent.push(o.headers); return json(200, { version: 0, files: [] }); } });
  await withCheck(async () => 'chk').files('g', 'guidebook');
  await withCheck(async () => '').files('g', 'guidebook');
  assert.equal(sent[0]['X-Firebase-AppCheck'], 'chk');
  assert.equal('X-Firebase-AppCheck' in sent[1], false);
});

test('岩場位置：解析貼上的「緯度, 經度」；發佈時照片有拍攝位置用照片，沒有就用岩場節點的 geo', async () => {
  assert.deepEqual(M.parsePosition('25.1349335,121.5147905'), [121.514791, 25.134934]);
  assert.deepEqual(M.parsePosition(' 25.13, 121.51 '), [121.51, 25.13]);
  for (const bad of ['', '25.1', '121.5, 25.1x', '95, 121', '25, 200']) assert.equal(M.parsePosition(bad), undefined, bad);

  const { state, b, images } = book();
  const sent = [];
  const dataset = async (o) => { sent.push(o.locations); return { version: 1, url: 'u', project: 'p' }; };
  const run = async (state, images) => P.publish({ state, docs: P.publishDocs(state, { validate }), images, dataset });
  // 沒有岩場節點：設不了
  M.setCragPosition(state, [121.5, 25.1]);
  assert.equal(M.cragPosition(state), undefined);
  // 有岩場節點、照片有拍攝位置：用照片的
  state.book.nodes.push({ id: 'crag1', type: 'crag', name: '測試岩場' });
  M.setCragPosition(state, [121.5148, 25.1347]);
  assert.deepEqual(state.book.nodes.at(-1).geo, { type: 'Point', coordinates: [121.5148, 25.1347] });
  await run(state, images);
  assert.deepEqual(sent.at(-1), [[121.9232, 25.1041]]);
  // 照片都沒有拍攝位置：用岩場位置
  const noShot = book();
  noShot.state.book.nodes.push({ id: 'crag1', type: 'crag', name: '測試岩場' });
  delete noShot.a.camera;
  M.setCragPosition(noShot.state, [121.5148, 25.1347]);
  await run(noShot.state, noShot.images);
  assert.deepEqual(sent.at(-1), [[121.5148, 25.1347]]);
  M.setCragPosition(noShot.state, undefined);
  await assert.rejects(run(noShot.state, noShot.images), (e) => e.code === 'no-position');   // 都沒有：天然岩場不能發佈
});

test('天然岩場一定要有位置：沒有照片拍攝位置、岩場節點也沒有 geo 就不能發佈；填了岩場位置就可以', async () => {
  const { state, a, images } = book();
  const run = () => P.publish({ state, docs: P.publishDocs(state, { validate }), images, dataset: async () => ({ version: 1, url: 'u', project: 'p' }) });
  assert.equal(P.needsPosition(state), false);   // a 有拍攝位置
  delete a.camera;
  assert.equal(P.needsPosition(state), true);
  await assert.rejects(run(), (e) => e.code === 'no-position' && e.message === P.NO_POSITION);
  state.book.nodes.push({ id: 'crag1', type: 'crag', name: '測試岩場' });
  M.setCragPosition(state, [121.5, 25.1]);
  assert.equal(P.needsPosition(state), false);
  assert.equal((await run()).version, 1);
});
