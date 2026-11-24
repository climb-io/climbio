const { test } = require('node:test');
const assert = require('node:assert/strict');
const { exportDataset, statsOf } = require('./dataset-export');

const row = (id, o = {}) => ({ id, name: id, gym: '', version: 1, holds: 10, routes: 0, photoBytes: 100, edits: null, ...o });
function setup({ rows = [row('p1'), row('p2', { gym: 'G', edits: { reviewed: true, deleted: 1, added: 2, reshaped: 3, flagged: 4 } })], walls = {}, counts = { shared: 2, wallRoutes: 1 }, since } = {}) {
  const docs = new Map(), files = new Map(), commits = [];
  if (since !== undefined) docs.set('datasetExport/state', { at: since });
  files.set('walls.jsonl', rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const snap = v => ({ exists: v !== undefined, get: k => (v || {})[k] });
  const db = {
    doc: p => ({ get: async () => snap(docs.get(p)), set: async v => { docs.set(p, v); } }),
    collection: c => ({
      doc: id => ({ get: async () => snap(c === 'shared' ? walls[id] : undefined) }),
      where: (_, __, at) => ({ get: async () => ({ docs: Object.entries(walls).filter(([, w]) => w.routesDoc && w.routesDoc.t > at).map(([id, w]) => ({ id, get: k => w.routesDoc[k] })) }) }),
    }),
    listCollections: async () => Object.entries(counts).map(([id, n]) => ({ id, count: () => ({ get: async () => ({ data: () => ({ count: n }) }) }) })),
  };
  const hf = { read: async p => files.get(p) ?? null, commit: async (summary, fs) => { commits.push(fs.map(f => f.path)); for (const f of fs) files.set(f.path, f.bytes.toString()); } };
  return { db, hf, docs, files, commits };
}
const route = (t, uid = 'u9') => ({ uid, t, r: JSON.stringify({ nodes: [], marks: [] }) });
const wall = (project, routes, t) => ({ src: { project, path: 'x.json' }, routesDoc: { t, routes } });

test('匯出：只處理上次之後變過的牆，目錄的 routes 換成條數，不寫 routes.json（那是 hf-public 的），記下最新時間', async () => {
  const s = setup({ walls: { w1: wall('p1', { a: route(5), b: route(7) }, 7), w0: wall('p2', { c: route(1) }, 1) }, since: 3 });
  const r = await exportDataset({ db: s.db, hf: s.hf, now: () => 1e12 });
  assert.deepEqual(r, { walls: 1, committed: true });
  assert.deepEqual(s.commits[0].sort(), ['stats.json', 'walls.jsonl']);
  assert.deepEqual(s.files.get('walls.jsonl').split('\n').filter(Boolean).map(l => JSON.parse(l).routes), [2, 0]);
  assert.equal(s.docs.get('datasetExport/state').at, 7);
});

test('統計：目錄加 Hub 用量加各集合文件數；內容沒變就不再 commit', async () => {
  const s = setup();
  const hub = async () => ({ usedStorage: 5e6, downloads: 9 });
  await exportDataset({ db: s.db, hf: s.hf, now: () => 1, hub });
  const st = JSON.parse(s.files.get('stats.json'));
  assert.deepEqual(st.dataset, { walls: 2, versions: 2, holds: 20, routes: 0, photoBytes: 200, gyms: 1, holdlab: { records: 1, reviewed: 1, deleted: 1, added: 2, reshaped: 3, flagged: 4 }, storageBytes: 5e6, downloads: 9 });
  assert.deepEqual(st.firestore, { collections: { shared: 2, wallRoutes: 1 }, documents: 3 });
  const others = { crags: { hf: { read: async () => JSON.stringify({ id: 'c1', files: 12, photos: 10, thumbs: 8, bytes: 5e6 }) + '\n' }, index: 'crags.jsonl', hub: async () => ({ usedStorage: 7e6, downloads: 3 }) },
    walls3d: { hf: { read: async () => null }, index: 'walls3d.jsonl' } };
  const withOthers = await exportDataset({ db: s.db, hf: s.hf, now: () => 1, hub, others });
  assert.equal(withOthers.committed, true);
  const out = JSON.parse(s.files.get('stats.json'));
  assert.deepEqual(out.crags, { items: 1, files: 12, photos: 10, thumbs: 8, bytes: 5e6, storageBytes: 7e6, downloads: 3 });
  assert.deepEqual(out.walls3d, { items: 0, files: 0, photos: 0, thumbs: 0, bytes: 0 });
  s.commits.length = 1;
  await exportDataset({ db: s.db, hf: s.hf, now: () => 1, hub });   // 沒帶岩場又回到原本的數字
  s.commits.length = 1;
  const again = await exportDataset({ db: s.db, hf: s.hf, now: () => 2, hub });
  assert.deepEqual([again.committed, s.commits.length], [false, 1]);
});

test('統計：Hub 查不到用量就不放；沒有任何牆也算得出', () => {
  const st = statsOf({ rows: [], hub: null, collections: {}, t: 1 });
  assert.deepEqual([st.dataset.walls, st.dataset.storageBytes, st.firestore.documents], [0, undefined, 0]);
});
