// studio/dataset-publish.js：岩場公開到開放資料集的用戶端流程（縮圖、只傳改過的、照片直接傳給 Hub、JSON 隨 publish 送出）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishDataset, sha256, thumbPath } from '../studio/dataset-publish.js';

const enc = s => new TextEncoder().encode(s);
const JPG = new Uint8Array([0xff, 0xd8, 1, 2, 3]), JPG2 = new Uint8Array([0xff, 0xd8, 9, 9]);
const files = () => [{ path: 'index.json', bytes: enc('{"a":1}') }, { path: 'pack.json', bytes: enc('{"docs":{}}') }, { path: 'p1.jpg', bytes: JPG }, { path: 'preview.jpg', bytes: JPG2 }];

function setup({ last = { version: 0, files: [] }, hubHas = [] } = {}) {
  const calls = { prepare: null, publish: null, put: [], verify: [], thumbs: 0, progress: [], sent: [] };
  const service = {
    files: async () => last,
    prepare: async (id, type, manifest) => {
      calls.prepare = manifest;
      return { uploads: manifest.filter(m => !m.path.endsWith('.json') && !hubHas.includes(m.path) && (last.hf ? last.files.find(f => f.path === m.path) : null)?.sha256 !== m.sha256)
        .map(m => ({ path: m.path, oid: m.sha256, size: m.size, upload: { href: `https://lfs/${m.path}`, header: { h: '1' } }, verify: { href: `https://lfs/verify/${m.path}`, header: {} } })) };
    },
    publishHf: async o => { calls.publish = o; return { id: o.id, version: (last.version || 0) + 1, url: 'https://hf/index.json', files: o.files.map(f => ({ path: f.path, sha256: f.sha256 })) }; },
  };
  const fetchFn = async (url, o) => { (o.method === 'PUT' ? calls.put : calls.verify).push(url); return { ok: true, status: 200 }; };
  const run = o => publishDataset({ id: 'abcdefgh12345678', name: '岩場', files: files(), locations: [[1, 2]], meta: { attribution: '原作者' }, service, fetchFn,
    thumb: async () => { calls.thumbs++; return JPG2; }, onProgress: (n, t) => calls.progress.push([n, t]), onFile: p => calls.sent.push(p), ...o });
  return { run, calls };
}

test('縮圖的檔名：照片才有，預覽、岩場縮圖、縮圖本身沒有', () => {
  assert.deepEqual(['p1.jpg', 'a.b.png', 'preview.jpg', 'thumb.jpg', 'p1.thumb.jpg', 'index.json'].map(thumbPath), ['p1.thumb.jpg', 'a.b.thumb.jpg', null, null, null, null]);
});

test('第一次：每張照片做縮圖，照片直接傳給 Hub 並 verify，JSON 隨 publish 帶內容，回資料集網址', async () => {
  const { run, calls } = setup();
  const r = await run();
  assert.deepEqual(calls.prepare.map(m => m.path), ['index.json', 'pack.json', 'p1.jpg', 'preview.jpg', 'p1.thumb.jpg']);
  assert.equal(calls.thumbs, 1);
  assert.deepEqual(calls.put.sort(), ['https://lfs/p1.jpg', 'https://lfs/p1.thumb.jpg', 'https://lfs/preview.jpg']);
  assert.equal(calls.verify.length, 3);
  const byPath = Object.fromEntries(calls.publish.files.map(f => [f.path, f]));
  assert.deepEqual([Boolean(byPath['index.json'].b64), Boolean(byPath['p1.jpg'].b64)], [true, false]);
  assert.deepEqual([calls.publish.attribution, calls.publish.locations], ['原作者', [[1, 2]]]);
  assert.deepEqual([r.version, r.url, r.project], [1, 'https://hf/index.json', 'abcdefgh12345678']);
  assert.deepEqual(calls.progress.at(-1), [5, 5]);
  assert.equal(calls.sent.length, 5);
});

test('再發佈（新的專案、origin 指到上一版）：沒改的照片不傳、不重做縮圖；JSON 一律帶內容（新專案在伺服器上沒有上一版）', async () => {
  const sha = async b => sha256(b);
  const tsha = await sha(JPG2);
  const last = { version: 1, hf: true, files: [
    { path: 'index.json', sha256: await sha(enc('{"a":1}')), size: 7 }, { path: 'pack.json', sha256: await sha(enc('{"docs":{}}')), size: 11 },
    { path: 'p1.jpg', sha256: await sha(JPG), size: 5 }, { path: 'p1.thumb.jpg', sha256: tsha, size: 4 }, { path: 'preview.jpg', sha256: await sha(JPG2), size: 4 }] };
  const { run, calls } = setup({ last });
  const f = files(); f[0] = { path: 'index.json', bytes: enc('{"a":2}') };   // 只改入口
  const r = await run({ files: f });
  assert.equal(calls.thumbs, 0);
  assert.deepEqual(calls.put, []);
  const byPath = Object.fromEntries(calls.publish.files.map(x => [x.path, x]));
  assert.deepEqual([Boolean(byPath['index.json'].b64), Boolean(byPath['pack.json'].b64), byPath['p1.thumb.jpg'].sha256], [true, true, tsha]);
  assert.equal(r.version, 2);
});

test('上一版在 Drive（不是資料集）：全部重傳；傳失敗就丟錯、不 publish', async () => {
  const { run, calls } = setup({ last: { version: 3, files: [{ path: 'p1.jpg', id: 'driveid', sha256: await sha256(JPG) }] } });
  await run();
  assert.equal(calls.put.length, 3);
  const bad = setup();
  await assert.rejects(bad.run({ fetchFn: async () => ({ ok: false, status: 500 }) }), e => e.status === 500);
  assert.equal(bad.calls.publish, null);
});
