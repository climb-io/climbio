import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore, open, serve, CHUNK } from '../extension/handoff.js';
import { pullCollected, EXTENSION_ID } from '../redpoint/extension.js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// 擴充（extension/handoff.js）與紅點貓（redpoint/extension.js）用一對假的 port 串起來

/** 一對互相接起來的 port：a 送的 b 收到、b 送的 a 收到（非同步） */
function pair() {
  const mk = () => { const l = [], d = []; return { l, d, onMessage: { addListener: (f) => l.push(f) }, onDisconnect: { addListener: (f) => d.push(f) }, postMessage() {}, disconnect() {} }; };
  const a = mk(), b = mk();
  a.postMessage = (m) => queueMicrotask(() => b.l.forEach((f) => f(structuredClone(m))));
  b.postMessage = (m) => queueMicrotask(() => a.l.forEach((f) => f(structuredClone(m))));
  return { page: a, ext: b };
}
async function bundle(store, id, name, files) {
  const dir = await open(store, ['Climbio', id], () => 5);
  for (const [path, blob] of Object.entries(files)) await dir.put(path, blob);
  await dir.setVersion('v1', name);
}
const connectTo = (store) => () => { const { page, ext } = pair(); serve(ext, store); return page; };

test('擴充的 ID 就是 manifest 的 key 算出來的那個（紅點貓靠它連進擴充）', () => {
  const key = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8')).key;
  const h = createHash('sha256').update(Buffer.from(key, 'base64')).digest().subarray(0, 16);
  assert.equal([...h].map((b) => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15))).join(''), EXTENSION_ID);
});

test('收好的岩場放進暫存：全部寫好（setVersion）才算數；同樣的內容在等紅點貓拿走時看得到指紋', async () => {
  const store = memoryStore();
  const dir = await open(store, ['Climbio', 'crag1']);
  assert.equal(dir.version(), undefined);
  await dir.put('index.json', new Blob(['{}'], { type: 'application/json' }));
  assert.deepEqual(await store.all(), []);   // 還沒 setVersion：不算
  await dir.setVersion('v1', '測試岩場');
  assert.deepEqual((await store.all()).map((b) => [b.id, b.name, b.v, b.files.map((f) => f.path)]), [['crag1', '測試岩場', 'v1', ['index.json']]]);
  assert.equal((await open(store, ['Climbio', 'crag1'])).version(), 'v1');
});

test('紅點貓連進來：列出、一個岩場一塊一塊拿完（大檔分塊），匯入好才通知刪掉', async () => {
  const store = memoryStore();
  const big = new Uint8Array(CHUNK * 2 + 17).map((_, i) => i % 251);
  await bundle(store, 'crag1', '岩場一', { 'index.json': new Blob(['{"a":1}'], { type: 'application/json' }), 'photo.jpg': new Blob([big], { type: 'image/jpeg' }), 'empty.bin': new Blob([]) });
  await bundle(store, 'crag2', '岩場二', { 'index.json': new Blob(['{"b":2}']) });
  const progress = [];
  const got = await pullCollected({ connect: connectTo(store), onProgress: (n, total) => progress.push([n, total]) });
  assert.deepEqual(got.bundles.map((b) => [b.id, b.name, b.v, b.files.length]), [['crag1', '岩場一', 'v1', 3], ['crag2', '岩場二', 'v1', 1]]);
  const photo = got.bundles[0].files.find((f) => f.path === 'photo.jpg').blob;
  assert.equal(photo.type, 'image/jpeg');
  assert.deepEqual(new Uint8Array(await photo.arrayBuffer()), big);
  assert.equal(await got.bundles[0].files.find((f) => f.path === 'index.json').blob.text(), '{"a":1}');
  assert.equal(got.bundles[0].files.find((f) => f.path === 'empty.bin').blob.size, 0);
  assert.equal(progress.at(-1)[0], progress.at(-1)[1]);   // 進度走到 100%
  assert.equal((await store.all()).length, 2);   // 還沒通知：不刪
  await got.ack(['crag1']);
  assert.deepEqual((await store.all()).map((b) => b.id), ['crag2']);   // 只刪匯入成功的
});

test('沒有等著的收藏就是空陣列；擴充沒裝（connect 丟錯、連線斷掉）、擴充回錯誤都丟錯', async () => {
  assert.deepEqual((await pullCollected({ connect: connectTo(memoryStore()) })).bundles, []);
  await assert.rejects(pullCollected({ connect: () => { throw new Error('Could not establish connection'); } }), /Could not establish/);
  const dead = () => { const { page } = pair(); queueMicrotask(() => page.d.forEach((f) => f())); return page; };
  await assert.rejects(pullCollected({ connect: dead, wait: 50 }), /disconnected|timeout/);
  const bad = () => { const { page, ext } = pair(); ext.onMessage.addListener(() => ext.postMessage({ type: 'error', error: 'boom' })); return page; };
  await assert.rejects(pullCollected({ connect: bad }), /boom/);
});
