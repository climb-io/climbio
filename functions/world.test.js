const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildWorldJson, fetchOcIndex } = require('./world');
const { writeWorld } = require('./projects');

const index = { crags: [{ id: 1, n: '龍洞', at: [121.9, 25.1], rc: 10, tc: 5, cc: 'tw', ap: ['龍洞'], pv: 1 }] };
const ok = { ok: true, json: async () => index };
const projects = [{ id: 'g1', type: 'guidebook', name: 'Yzeron', url: 'https://x/g1', cc: 'fr', at: [4.5, 45.7] }, { id: 'w1', type: 'wall3d', name: '牆', gym: '館' }];

test('世界檔：只放 Guidebook 與 OpenClimbing 岩場，3D 牆不進去', async () => {
  const file = JSON.parse(await buildWorldJson({ projects, fetchImpl: async () => ok, now: () => 7 }));
  assert.deepEqual([file.v, file.t], [1, 7]);
  assert.deepEqual(file.books.map(b => b.id), ['g1']);
  assert.equal(file.oc.length, 1);
  assert.deepEqual(file.tree.map(c => c.cc).sort(), ['fr', 'tw']);
});

test('抓不到 OpenClimbing 索引就丟錯，不產生沒有岩場的檔', async () => {
  await assert.rejects(fetchOcIndex(async () => ({ ok: false, status: 503 })), /503/);
  await assert.rejects(buildWorldJson({ projects, fetchImpl: async () => ({ ok: false, status: 503 }) }), /503/);
});

test('writeWorld：清單與世界檔各存一份，世界檔壓縮；世界檔失敗不影響清單', async () => {
  const saved = [], db = { collection: () => ({ orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }) }) };
  const save = async (path, data, cache, opts) => saved.push({ path, cache, opts });
  await writeWorld({ db, save, now: () => 1, buildWorld: async () => '{}' });
  assert.deepEqual(saved.map(s => [s.path, !!s.opts?.gzip]), [['public/projects.json', false], ['public/world.json', true]]);
  saved.length = 0;
  await writeWorld({ db, save, now: () => 1, buildWorld: async () => { throw new Error('下載失敗'); } });
  assert.deepEqual(saved.map(s => s.path), ['public/projects.json']);
});
