// 收下前的確認：ready 完成之前只讀目錄，照片等使用者按「收下」才下載；取消（ready 拒絕）就不下載
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fromUrl } from '../redpoint/io.js';

globalThis.ClimbioFormat = { validate: createRequire(import.meta.url)('../format/format.js').validate };
globalThis.location = { href: 'https://x.test/redpoint/' };
const topo = JSON.parse(readFileSync(new URL('../format/examples/topo.json', import.meta.url), 'utf8'));
const ROOT = 'https://x.test/p/topo.json';

function fakeFetch(log) {
  globalThis.fetch = async (url) => {
    log.push(String(url));
    const json = String(url) === ROOT;
    return new Response(json ? JSON.stringify(topo) : new Uint8Array([1, 2, 3]), { headers: { 'content-type': json ? 'application/json' : 'image/webp' } });
  };
}
const photoCalls = (log) => log.filter((u) => u !== ROOT);

test('ready 完成前不下載照片，完成後才下載', async () => {
  const log = [];
  fakeFetch(log);
  let go;
  const ready = new Promise((ok) => (go = ok));
  let rooted = false;
  const job = fromUrl(ROOT, { ready, onRoot: () => { rooted = true; } });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(rooted, true);
  assert.deepEqual(photoCalls(log), []);
  go(true);
  const got = await job;
  assert.equal(photoCalls(log).length, 1);
  assert.equal(got.photos.size, 1);
});

test('ready 拒絕（使用者取消）就中止，照片一張都沒下載', async () => {
  const log = [];
  fakeFetch(log);
  const ready = Promise.reject(Object.assign(new Error(''), { name: 'AbortError' }));
  await assert.rejects(fromUrl(ROOT, { ready }), { name: 'AbortError' });
  assert.deepEqual(photoCalls(log), []);
});
