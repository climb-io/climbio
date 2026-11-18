// RouteKit.wallFiles：Wall 發佈和岩點貓分享組同一種「一面牆的檔案」：畫面、照片、縮圖、圖層，縮圖的路徑固定、畫面和圖層都指到它
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const RouteKit = require('../routekit/format.js');
const { validate } = require('../format/format.js');

const PID = 'abcdefgh1234', LID = 'layer00000000001';
const holds = [{ id: 'h1', poly: [[10, 10], [60, 10], [60, 60], [10, 60]] }, { id: 'h2', poly: [[100, 100], [150, 100], [150, 150], [100, 150]], source: 'sam' }];
const photo = new Uint8Array([0xff, 0xd8, 1]), thumb = new Uint8Array([0xff, 0xd8, 2]);
const base = { pid: PID, name: '牆', w: 200, h: 200, holds, photo, t: 5 };
const text = (f) => JSON.parse(new TextDecoder().decode(f.bytes));

test('縮圖放在包裡 {牆 id}.thumb.jpg，畫面和圖層的 props.thumb 都指到它', () => {
  const r = RouteKit.wallFiles({ ...base, thumb, layerId: LID, gym: '原岩明德', routes: [{ id: 'r1', grade: 'V3', holds: { h1: 's', h2: 't' }, t: 5 }] });
  assert.equal(r.thumbPath, `${PID}.thumb.jpg`);
  assert.deepEqual(r.files.map(f => f.path), [`${PID}.json`, `${PID}.jpg`, `${PID}.thumb.jpg`, `${LID}.json`]);
  assert.equal(r.view.props.thumb, `${PID}.thumb.jpg`);
  assert.equal(r.layer.props.thumb, `${PID}.thumb.jpg`);
  assert.equal(r.entry, `${LID}.json`);
  for (const d of [r.view, r.layer]) assert.deepEqual(validate(d), []);
  assert.deepEqual([...r.files[2].bytes], [0xff, 0xd8, 2]);
});

test('沒有縮圖、沒有圖層：只有畫面和照片，入口是畫面', () => {
  const r = RouteKit.wallFiles(base);
  assert.deepEqual(r.files.map(f => f.path), [`${PID}.json`, `${PID}.jpg`]);
  assert.equal(r.entry, `${PID}.json`);
  assert.equal(r.view.props, undefined);
  assert.equal(r.layer, null);
});

test('Wall 要帶的欄位：授權、作者、雜湊、裁切等 props、岩點來源；路線初稿的圖層帶名稱與時間', () => {
  const r = RouteKit.wallFiles({ ...base, layerId: LID, routes: [{ id: 'r1', grade: 'V3', holds: { h1: 's', h2: 't' }, t: 5 }],
    view: { license: 'CC-BY-4.0', author: '阿明', sha256: 'a'.repeat(64), props: { photos: 'set.json' } }, layer: { license: 'CC-BY-4.0', author: '阿明', name: '牆', t: 5 } });
  assert.deepEqual([r.view.license, r.view.author, r.view.sha256, r.view.props.photos], ['CC-BY-4.0', '阿明', 'a'.repeat(64), 'set.json']);
  assert.deepEqual(r.view.nodes[1], { id: 'h2', type: 'hold', props: { source: 'sam' } });
  assert.deepEqual([r.layer.name, r.layer.t, r.layer.author, r.layer.nodes[0].props.grade], ['牆', 5, '阿明', { v: 'V3' }]);
  for (const d of [r.view, r.layer]) assert.deepEqual(validate(d), []);
});
