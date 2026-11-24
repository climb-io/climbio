const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHandler, listPublic, writeWorld, WORLD_FILE, HF_CRAGS } = require('./projects');

const GID = 'abcdefgh12345678', NOW = 2e12, HOSTS = ['climbio.web.app', 'climbio-dev.web.app'];

/** 假的 Firestore：路徑 → 資料；doc 可以再接 collection（子集合） */
function fakeDb() {
  const docs = new Map(), calls = [];
  const snap = (id, v) => ({ id, exists: v !== undefined, get: k => (v || {})[k] });
  const ref = (path) => ({
    path,
    get: async () => snap(path.split('/').pop(), docs.get(path)),
    set: async (v, o) => { docs.set(path, structuredClone(o && o.merge ? { ...(docs.get(path) || {}), ...v } : v)); },
    collection: name => coll(`${path}/${name}`),
  });
  const coll = (name) => ({
    doc: id => ref(`${name}/${id}`),
    get: async () => ({ docs: [...docs].filter(([p]) => p.split('/').length === 2 && p.startsWith(name + '/')).map(([p, d]) => snap(p.split('/')[1], d)) }),
    where: (f, op, v) => ({ limit: () => ({ get: async () => ({ docs: [...docs].filter(([p, d]) => p.split('/').length === 2 && p.startsWith(name + '/') && d[f] === v).map(([p, d]) => snap(p.split('/')[1], d)) }) }) }),
    orderBy: (f, dir) => ({ limit: () => ({ get: async () => ({ docs: [...docs].filter(([p]) => p.split('/').length === 2 && p.startsWith(name + '/')).sort(([, a], [, b]) => (dir === 'desc' ? b[f] - a[f] : a[f] - b[f])).map(([p, d]) => snap(p.split('/')[1], d)) }) }) }),
  });
  const db = { collection: coll, recursiveDelete: async r => { calls.push(['recursiveDelete', r.path]); for (const k of [...docs.keys()]) if (k === r.path || k.startsWith(r.path + '/')) docs.delete(k); } };
  return { db, docs, calls };
}

const entry = (path, mime = 'application/json') => ({ path, id: 'hf' + path, mime, sha256: 'a'.repeat(64), size: 10, hf: true });
const project = (o = {}) => ({ owner: '', type: 'guidebook', name: '熱海岩場', version: 1, t: NOW, listed: true, locations: [], hf: { dir: `crags/${GID}/` },
  files: [entry('index.json'), entry('preview.jpg', 'image/jpeg'), entry('thumb.jpg', 'image/jpeg')], ...o });

function setup() {
  const { db, docs, calls } = fakeDb(), world = [];
  const handler = createHandler({ db, now: () => NOW, datasets: {},
    saveWorld: () => writeWorld({ db, save: async (path, data, cache) => world.push({ path, data: JSON.parse(data), cache }) }) });
  const call = async (b, method = 'POST') => {
    const res = { statusCode: 200, headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.statusCode = c; return this; }, json(d) { this.data = d; return this; } };
    await handler({ method, body: b, get: () => '' }, res);
    return res;
  };
  return { call, db, docs, calls, world };
}

test('GET 回 ok（網頁看服務開了沒）；不認得的 op、不是資料集的發佈都拒絕；沒有 unpublish、list', async () => {
  const { call, docs } = setup();
  assert.deepEqual((await call(undefined, 'GET')).data, { ok: true });
  assert.equal((await call({ op: 'nope' })).statusCode, 400);
  assert.equal((await call({ op: 'list' })).statusCode, 400, '不再有 list；世界讀靜態清單');
  assert.equal((await call({ op: 'unpublish', id: GID })).statusCode, 400, '沒有擁有者就沒有下架；不當內容由管理者 hidden');
  assert.equal((await call({ op: 'publish', id: GID, type: 'guidebook', name: 'x', files: [{ path: 'index.json', id: 'driveEntry0001' }] })).statusCode, 400, '不再收 Drive 發佈');
  assert.equal(docs.size, 0);
});

test('files：專案目前這一版（路徑、sha256、大小）公開、不用登入；沒發佈過是第 0 版；種類要對', async () => {
  const { call, docs } = setup();
  assert.deepEqual((await call({ op: 'files', id: GID, type: 'guidebook' })).data, { version: 0, files: [] });
  docs.set(`datasets/${GID}`, project());
  const r = (await call({ op: 'files', id: GID, type: 'guidebook' })).data;
  assert.deepEqual([r.version, r.hf, r.files.map(f => f.path)], [1, true, ['index.json', 'preview.jpg', 'thumb.jpg']]);
  assert.equal((await call({ op: 'files', id: GID, type: 'wall3d' })).statusCode, 400);
});

test('世界的清單：網址與預覽圖直接是資料集；不列私人與不在資料集的；同一面（同一個 origin）的版本只列排序第一的，其他放 others', async () => {
  const { db, docs } = fakeDb();
  const id = n => String(n).padStart(16, '0');
  docs.set(`datasets/${id(1)}`, project({ t: NOW, cc: 'tw', hf: { dir: `crags/${id(1)}/` } }));
  docs.set(`datasets/${id(2)}`, project({ t: NOW - 1, listed: false }));
  docs.set(`datasets/${id(3)}`, project({ t: NOW - 2, hf: null, files: [{ path: 'index.json', id: 'driveEntry0001' }] }));
  docs.set(`datasets/${id(4)}`, project({ t: NOW - 3, origin: id(1), hf: { dir: `crags/${id(4)}/` } }));
  docs.set(`datasets/${id(5)}`, project({ t: NOW - 4, origin: id(1), hf: { dir: `crags/${id(5)}/` } }));
  docs.set(`datasets/${id(6)}`, project({ t: NOW - 5, type: 'wall3d', gym: '岩館', locations: [[121, 25], [123, 27]], hf: { dir: `walls3d/${id(6)}/`, repo: 'walls3d' } }));
  const list = await listPublic({ db });
  assert.deepEqual(list.map(p => p.id), [id(1), id(6)], '同一個 origin 只列第一名');
  assert.deepEqual(list[0].others.map(o => o.id), [id(4), id(5)]);
  assert.deepEqual([list[0].url, list[0].preview, list[0].thumb], [`${HF_CRAGS}crags/${id(1)}/index.json`, `${HF_CRAGS}crags/${id(1)}/preview.jpg`, `${HF_CRAGS}crags/${id(1)}/thumb.jpg`]);
  assert.deepEqual([list[1].type, list[1].gym, list[1].at, list[1].url.startsWith('https://huggingface.co/datasets/climbio/walls3d/')], ['wall3d', '岩館', [122, 26], true]);
  assert.deepEqual([list[0].cc, list[1].cc], ['tw', undefined], '國家 cc：有就輸出，沒有就不寫');
});

test('同一個集合裡公開牆的文件不是專案：files 不能碰', async () => {
  const { call, docs } = setup();
  docs.set(`datasets/${GID}`, { owner: '', type: 'walls', name: '牆', version: 1, files: ['a.json'] });
  assert.equal((await call({ op: 'files', id: GID, type: 'guidebook' })).statusCode, 409);
  assert.equal(docs.has(`datasets/${GID}`), true);
});

test('3D 牆與 Guidebook 的版本：每天不重複機器數最多的排第一，新版本（7 天內）至少第 3 位，沒有下載就最新在前；每面只列一個版本，附 others', async () => {
  const { db, docs } = fakeDb();
  const HLL = require('./hll'), { createHash } = require('node:crypto');
  const wall = (id, o = {}) => ({ owner: '', type: 'wall3d', name: '明德', version: 1, t: NOW - 30 * 864e5, listed: true, locations: [], hf: { dir: `walls3d/${id}/`, repo: 'walls3d' }, files: [entry('index.json')], gym: '原岩明德', ...o });
  const day = n => new Date(NOW + 8 * 3600e3 - n * 864e5).toISOString().slice(0, 10);
  const stat = (d, machines) => { const r = HLL.newRegs(); for (let i = 0; i < machines; i++) HLL.add(r, createHash('sha256').update(`${d}-${i}`).digest('hex')); return HLL.encode(r); };
  docs.set('datasets/aaaaaaaaaaaaaaaa', wall('aaaaaaaaaaaaaaaa'));
  docs.set('datasets/bbbbbbbbbbbbbbbb', wall('bbbbbbbbbbbbbbbb', { t: NOW - 20 * 864e5, origin: 'aaaaaaaaaaaaaaaa', root: 'aaaaaaaaaaaaaaaa', lineage: ['aaaaaaaaaaaaaaaa'] }));
  docs.set('datasets/cccccccccccccccc', wall('cccccccccccccccc', { t: NOW - 10 * 864e5, origin: 'bbbbbbbbbbbbbbbb', root: 'aaaaaaaaaaaaaaaa', lineage: ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb'] }));
  let rows = await listPublic({ db, now: () => NOW });
  assert.deepEqual(rows.map(r => [r.id, r.versions, r.dl, r.root]), [['cccccccccccccccc', 3, 0, 'aaaaaaaaaaaaaaaa']], '沒有下載：最新在前，只列一個');
  docs.set('projectStats/aaaaaaaaaaaaaaaa', { hll: { [day(1)]: stat('a', 5), [day(40)]: stat('old', 100) } });   // 40 天前的不算
  docs.set('projectStats/bbbbbbbbbbbbbbbb', { hll: { [day(2)]: stat('b', 3) } });
  rows = await listPublic({ db, now: () => NOW });
  assert.deepEqual(rows.map(r => [r.id, r.dl]), [['aaaaaaaaaaaaaaaa', 5]], '最近 30 天不重複機器最多的排第一');
  assert.deepEqual(rows[0].others.map(o => [o.id, o.dl]), [['bbbbbbbbbbbbbbbb', 3], ['cccccccccccccccc', 0]], 'others 照排序，帶血緣');
  assert.deepEqual(rows[0].others[1].lineage, ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb']);
  docs.set('datasets/dddddddddddddddd', wall('dddddddddddddddd', { t: NOW - 1 * 864e5, origin: 'cccccccccccccccc', root: 'aaaaaaaaaaaaaaaa' }));
  rows = await listPublic({ db, now: () => NOW });
  assert.equal(rows[0].id, 'aaaaaaaaaaaaaaaa', '新版本最多追到第 3 位，不超過下載最多的');
  docs.set('datasets/eeeeeeeeeeeeeeee', wall('eeeeeeeeeeeeeeee', { name: '別面牆' }));
  assert.deepEqual((await listPublic({ db, now: () => NOW })).map(r => r.id).sort(), ['aaaaaaaaaaaaaaaa', 'eeeeeeeeeeeeeeee']);
});

test('世界的清單：同一本書最新的一版排第一（就算舊的下載比較多），舊的放 others', async () => {
  const { db, docs } = fakeDb();
  const A = 'aaaaaaaaaaaaaaaa', B = 'bbbbbbbbbbbbbbbb';
  docs.set(`datasets/${A}`, project({ t: NOW - 5e8, hf: { dir: `crags/${A}/` } }));
  docs.set(`datasets/${B}`, project({ t: NOW - 1e8, hf: { dir: `crags/${B}/` }, origin: A, root: A, lineage: [A] }));
  const rows = await listPublic({ db, now: () => NOW });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, B);
  assert.deepEqual(rows[0].others.map(o => o.id), [A]);
  assert.equal(rows[0].official, undefined);
});
