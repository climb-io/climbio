// 紅點貓讀公開資料（backend/firebase.js）：進 App 只讀一個 index（資料集的固定網址），世界檔版本沒變就不重抓
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../backend/firebase.js', import.meta.url), 'utf8');
const part = source.slice(source.indexOf('  const HF_CRAGS ='), source.indexOf('  window.Backend = {'));
const HF = 'https://huggingface.co/datasets/climbio/crags/resolve/main/';
const plain = (v) => JSON.parse(JSON.stringify(v));

function setup(files) {
  const calls = [];
  const sandbox = { needNet() {}, AbortSignal, Date, console, Object, Error, fetch: async (url, options = {}) => {
    const path = url.slice(HF.length); calls.push({ path, noStore: options.cache === 'no-store' });
    return files[path] ? { ok: true, status: 200, json: async () => files[path] } : { ok: false, status: 404, json: async () => ({}) };
  } };
  vm.createContext(sandbox);
  vm.runInContext(part + '\nglobalThis.api = { listProjects, loadWorld, loadCragsIndex };', sandbox);
  return { calls, api: sandbox.api };
}
const index = (v) => ({ climbio: 2, kind: 'index', t: 1, world: { v }, projects: [
  { id: 'g1', type: 'guidebook', name: '龍洞', t: 5, url: `${HF}crags/g1/index.json` }, { id: 'w1', type: 'wall3d', name: '3D', t: 6, url: 'u' }] });

test('清單：index 一個請求，兩次讀（挑 type）一分鐘內只讀一次；fresh 不用快取', async () => {
  const s = setup({ 'index/redpoint.json': index('aaaaaaaaaaaa') });
  assert.deepEqual(plain((await s.api.listProjects('guidebook')).map(p => p.id)), ['g1']);
  assert.deepEqual(plain((await s.api.listProjects('wall3d')).map(p => p.id)), ['w1']);
  assert.equal(s.calls.length, 1);
  await s.api.listProjects('guidebook', { fresh: true });
  assert.deepEqual(plain(s.calls.map(c => [c.path, c.noStore])), [['index/redpoint.json', false], ['index/redpoint.json', true]]);
});

test('世界：版本跟手機上存的一樣就回 null、不抓世界檔；不一樣抓帶版本的檔並記上 wv', async () => {
  const world = { v: 1, t: 2, books: [], oc: [], tree: [] };
  const s = setup({ 'index/redpoint.json': index('bbbbbbbbbbbb'), 'index/world.bbbbbbbbbbbb.json': world });
  assert.equal(await s.api.loadWorld('bbbbbbbbbbbb'), null);
  assert.deepEqual(s.calls.map(c => c.path), ['index/redpoint.json']);   // 只有 index
  const got = await s.api.loadWorld('old000000000');
  assert.deepEqual(plain(got), { ...world, wv: 'bbbbbbbbbbbb' });
  assert.deepEqual(s.calls.map(c => c.path), ['index/redpoint.json', 'index/world.bbbbbbbbbbbb.json']);
  assert.deepEqual(plain(await setup({ 'index/redpoint.json': index('bbbbbbbbbbbb'), 'index/world.bbbbbbbbbbbb.json': world }).api.loadWorld()), { ...world, wv: 'bbbbbbbbbbbb' });   // 手機上沒有存：抓
});

test('index 沒有世界（還沒補寫）或世界檔讀不到：丟錯，紅點貓退回在手機上合成', async () => {
  await assert.rejects(setup({ 'index/redpoint.json': { projects: [] } }).api.loadWorld(), { status: 404 });
  await assert.rejects(setup({ 'index/redpoint.json': index('cccccccccccc') }).api.loadWorld(), { status: 404 });
  await assert.rejects(setup({}).api.listProjects('guidebook'), { status: 404 });
});
