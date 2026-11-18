import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../holdkit/samrefine.js', import.meta.url), 'utf8');
function setup() {
  const messages = [], workers = [];
  let fail = false;
  class Worker {
    constructor() { workers.push(this); }
    postMessage(message) {
      messages.push(message.type);
      queueMicrotask(() => this.onmessage({ data: { id: message.id, ...(fail ? { error: '測試下載失敗' } : { dl: 1, load: 1 }) } }));
    }
    terminate() {}
  }
  const context = { Worker, URL, navigator: { userAgent: 'Mobile' },
    document: { currentScript: { src: 'https://example.test/holdkit/samrefine.js' } }, setTimeout, clearTimeout };
  vm.runInNewContext(source, context);
  context.HoldRefiner.configure({ cloudUrl: 'https://example.test/retrace', idToken: async () => 't' });
  return { api: context.HoldRefiner, messages, workers, fail: value => { fail = value; } };
}

test('預先下載載入解碼器，不要求照片', async () => {
  const s = setup(); await s.api.warm();
  assert.deepEqual(s.messages, ['init', 'initEnc']);
  assert.equal(s.api.stats.load, 1);
});

test('預先下載連編碼器一起載入（有沒有雲端都一樣），只載入一次', async () => {
  const s = setup();
  await Promise.all([s.api.warm(), s.api.warm()]);
  await s.api.warm();
  assert.deepEqual(s.messages, ['init', 'initEnc']);
});

test('偵測與定線連續要求預下載，只建立一個 Worker 並初始化一次', async () => {
  const s = setup();
  await Promise.all([s.api.warm(), s.api.warm(), s.api.warm()]);
  await s.api.warm();
  assert.deepEqual(s.messages, ['init', 'initEnc']);
  assert.equal(s.workers.length, 1);
});

test('背景下載失敗不阻斷操作，下次觸發會重新下載', async () => {
  const s = setup(); s.fail(true); await s.api.warm();
  s.fail(false); await s.api.warm();
  assert.deepEqual(s.messages, ['init', 'init', 'initEnc']);
  assert.equal(s.api.stats.load, 1);
});

test('同一張照片、同一個提示的重描共用一次（長按還沒成立就先算的那次）；提示不同就另外算', async () => {
  const s = setup(), img = { width: 2000, height: 1500 }, poly = [[10, 10], [60, 10], [60, 50], [10, 50]];
  const a = s.api.refine(img, 'w1', poly), b = s.api.refine(img, 'w1', poly.map(p => p.slice()));
  const c = s.api.refine(img, 'w1', null, () => {}, { point: [30, 30] });
  assert.equal(a, b);
  assert.notEqual(a, c);
  await Promise.allSettled([a, c]);   // 測試環境沒有 IndexedDB、雲端：算不出來，不留著失敗的結果
  const d = s.api.refine(img, 'w1', poly);
  assert.notEqual(d, a);
  await d.catch(() => {});
});
