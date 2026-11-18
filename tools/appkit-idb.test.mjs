// AppKit.idb：Blob 打包（iPhone 大 Blob 存不進去）、連線被關掉後重新開
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { opener, packBlob, unpackBlob, done } = createRequire(import.meta.url)('../appkit/idb.js');

test('packBlob／unpackBlob：Blob 存成 ArrayBuffer、讀回 Blob；舊的直接存的 Blob 與一般資料原樣', async () => {
  const blob = new Blob(['abc'], { type: 'image/jpeg' });
  const packed = await packBlob(blob);
  assert.equal(packed.$blob, true);
  assert.equal(packed.type, 'image/jpeg');
  const back = unpackBlob(packed);
  assert.equal(back.type, 'image/jpeg');
  assert.equal(await back.text(), 'abc');
  assert.equal(unpackBlob(blob), blob);
  assert.equal(unpackBlob(undefined), undefined);
  assert.deepEqual(await packBlob({ a: 1 }), { a: 1 });
});

test('done：IDBRequest 成功與失敗都換成 Promise', async () => {
  const ok = {}, bad = {};
  const p1 = done(ok); ok.result = 7; ok.onsuccess();
  assert.equal(await p1, 7);
  const p2 = done(bad); bad.error = new Error('x'); bad.onerror();
  await assert.rejects(p2, /x/);
});

test('opener：連線共用；被關掉或別的分頁要升級後，下次重新開；升級與 ready 都會呼叫', async () => {
  const opened = [], log = [];
  globalThis.indexedDB = { open(name, version) {
    const req = { result: { name, version }, transaction: 'tx' }; opened.push(req);
    queueMicrotask(() => { req.onupgradeneeded({ oldVersion: 2 }); req.onsuccess(); });
    return req;
  } };
  try {
    const open = opener({ name: 'x', version: 4, upgrade: (db, old, tx) => log.push(['up', db.name, old, tx]), ready: async (db) => log.push(['ready', db.name]) });
    const [a, b] = await Promise.all([open(), open()]);
    assert.equal(a, b);
    assert.equal(opened.length, 1);
    assert.deepEqual(log, [['up', 'x', 2, 'tx'], ['ready', 'x']]);
    a.onclose();
    assert.notEqual(await open(), undefined);
    assert.equal(opened.length, 2);
    let closed = false; opened[1].result.close = () => { closed = true; };
    opened[1].result.onversionchange();
    assert.equal(closed, true);
    await open();
    assert.equal(opened.length, 3);
  } finally { delete globalThis.indexedDB; }
});

test('opener：開失敗不快取，下次再試', async () => {
  let n = 0;
  globalThis.indexedDB = { open() { const req = { error: new Error('blocked') }; n++; queueMicrotask(() => req.onerror()); return req; } };
  try {
    const open = opener({ name: 'x', version: 1 });
    await assert.rejects(open(), /blocked/);
    await assert.rejects(open(), /blocked/);
    assert.equal(n, 2);
  } finally { delete globalThis.indexedDB; }
});
