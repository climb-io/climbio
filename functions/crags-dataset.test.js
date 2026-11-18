const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createHandler, HF_CRAGS } = require('./projects');
const { createHf } = require('./walls-dataset');
const { cragRow, upsertRow, planChanges } = require('./crags-dataset');

const GID = 'abcdefgh12345678';
const sha = b => createHash('sha256').update(b).digest('hex');
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), JPG2 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 9]);
const INDEX = Buffer.from(JSON.stringify({ climbio: 2, kind: 'set', type: 'guidebook' })), PACK = Buffer.from(JSON.stringify({ docs: {} }));
const F = (path, bytes, text) => ({ path, sha256: sha(bytes), size: bytes.length, ...(text ? { b64: bytes.toString('base64') } : {}) });
const files = () => [F('index.json', INDEX, true), F('pack.json', PACK, true), F('p1.jpg', JPG), F('p1.thumb.jpg', JPG2)];
const body = (o = {}) => ({ op: 'publish', hf: true, id: GID, type: 'guidebook', name: '測試岩場', files: files(), locations: [[121.5, 25.1]], attribution: '原作者', ...o });
const day = () => new Date(2e12 + 8 * 3600e3).toISOString().slice(0, 10);

function setup() {
  const docs = new Map(), commits = [], store = { text: '' };
  const snap = (id, v) => ({ id, exists: v !== undefined, get: k => (v || {})[k] });
  const ref = path => ({ path, get: async () => snap(path.split('/').pop(), docs.get(path)), set: async (v, o) => { docs.set(path, structuredClone(o && o.merge ? { ...(docs.get(path) || {}), ...v } : v)); } });
  const db = { recursiveDelete: async r => { for (const k of [...docs.keys()]) if (k === r.path || k.startsWith(r.path + '/')) docs.delete(k); }, collection: c => ({ doc: id => ref(`${c}/${id}`), where: (f, op, v) => ({ limit: () => ({ get: async () => ({ docs: [...docs].filter(([p, d]) => p.startsWith(c + '/') && d[f] === v).map(([p, d]) => snap(p.split('/')[1], d)) }) }) }) }) };
  const hf = {
    lfsBatch: async objs => objs.map(o => ({ oid: o.oid, size: o.size, upload: { href: `https://lfs.example/${o.oid}`, header: { x: '1' } } })),
    read: async () => store.text || null,
    commit: async (summary, fs) => { commits.push(fs.map(f => (f.deleted ? 'del:' : f.oid ? 'lfs:' : 'file:') + f.path)); const i = fs.find(f => f.path.endsWith('.jsonl')); if (i) store.text = i.bytes.toString(); },
  };
  const handler = createHandler({ db, hosts: ['climbio.app'], now: () => 2e12, datasets: { guidebook: hf, wall3d: hf, crag3d: hf } });
  const call = async (b, _ = '') => {
    const res = { statusCode: 200, set() { return this; }, status(c) { this.statusCode = c; return this; }, json(d) { this.data = d; return this; } };
    await handler({ method: 'POST', body: b, get: k => ({ origin: 'https://climbio.app' }[k.toLowerCase()]) }, res);
    return res;
  };
  return { call, docs, commits, store };
}
const prep = (s, o = {}, token) => s.call({ op: 'prepare', id: GID, type: 'guidebook', files: files(), ...o }, token);

const ipKey = (ip = '') => `ip${createHash('sha256').update(ip).digest('hex').slice(0, 16)}`;
test('prepare：不登入；只回要傳的照片，給 Hub 的上傳網址；已發佈的 id 不能再 prepare；每天有位元組上限（按網路來源）', async () => {
  const s = setup();
  const r = await prep(s, {}, 'nobody');
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.data.uploads.map(u => u.path).sort(), ['p1.jpg', 'p1.thumb.jpg']);
  assert.equal(r.data.uploads[0].upload.href.startsWith('https://lfs.example/'), true);
  await s.call(body());
  assert.equal((await prep(s)).statusCode, 409, '沒有擁有者：已發佈的 id 不能再改，更新用新的 id');
  s.docs.set(`publishQuota/${ipKey()}_prepare_${day()}`, { n: 2e9 });
  assert.equal((await prep(s, { id: 'bbbbbbbb12345678', files: [...files(), F('big.jpg', Buffer.from([0xff, 0xd8, 5]))] })).statusCode, 429);
});

test('發佈到資料集：一個 commit（JSON、照片指標、目錄），專案文件標 hf，不查 Drive，網址是資料集', async () => {
  const s = setup();
  const r = await s.call(body());
  assert.equal(r.statusCode, 200);
  assert.deepEqual([r.data.id, r.data.version, r.data.url], [GID, 1, `${HF_CRAGS}crags/${GID}/index.json`]);
  assert.deepEqual(s.commits[0].sort(), [`file:crags/${GID}/index.json`, `file:crags/${GID}/pack.json`, `lfs:crags/${GID}/p1.jpg`, `lfs:crags/${GID}/p1.thumb.jpg`, 'file:crags.jsonl'].sort());
  const doc = s.docs.get(`datasets/${GID}`);
  assert.deepEqual([doc.owner, doc.type, doc.listed, doc.hf, doc.files.length, doc.files.every(f => f.hf && f.sha256 && f.size)], ['', 'guidebook', true, { dir: `crags/${GID}/`, repo: 'crags' }, 4, true]);
  const row = JSON.parse(s.store.text);
  assert.deepEqual([row.id, row.files, row.photos, row.thumbs, row.at, row.attribution, row.license], [GID, 4, 1, 1, [121.5, 25.1], '原作者', 'CC-BY-SA-4.0']);
  assert.equal(s.docs.has(`datasets/${GID}/versions/1`), false);
});

test('Guidebook 的新版本：已發佈的 id 不能改；新 id 加 origin 是新版本，root、lineage 記血緣；origin 要存在', async () => {
  const s = setup();
  const A = GID, B = 'bbbbbbbb12345678', C = 'cccccccc12345678';
  await s.call(body());
  assert.equal((await s.call(body())).statusCode, 409);
  assert.equal((await s.call(body({ id: B, origin: 'zzzzzzzz12345678' }))).statusCode, 400, 'origin 不存在');
  assert.equal((await s.call(body({ id: B, origin: A }))).statusCode, 200);
  assert.equal((await s.call(body({ id: C, origin: B }))).statusCode, 200);
  const pick = id => { const d = s.docs.get(`datasets/${id}`); return [d.origin, d.root, d.lineage]; };
  assert.deepEqual(pick(B), [A, A, [A]]);
  assert.deepEqual(pick(C), [B, A, [A, B]]);
  assert.equal(s.docs.get(`datasets/${A}`).root, undefined, '第一版沒有 root');
  // 留名不留權：歷代署名沿血緣保留（不重複），新版本改署名也留得住前面的
  assert.deepEqual(s.docs.get(`datasets/${A}`).credits, ['原作者']);
  assert.equal((await s.call(body({ id: 'dddddddd12345678', origin: C, attribution: '改編者' }))).statusCode, 200);
  assert.deepEqual(s.docs.get('datasets/dddddddd12345678').credits, ['原作者', '改編者']);
});

test('發佈到資料集的檢查：只收公開的 Guidebook、路徑與種類、內容雜湊要對、JSON 要帶內容', async () => {
  const s = setup();
  assert.equal((await s.call(body({ listed: false }))).statusCode, 400);
  assert.equal((await s.call(body({ type: 'walls' }))).statusCode, 400);   // 牆面走 publishWall，不走這裡
  const bad = [
    files().map(f => (f.path === 'p1.jpg' ? { ...f, path: '../x.jpg' } : f)),
    files().map(f => (f.path === 'p1.jpg' ? { ...f, path: 'x.exe' } : f)),
    files().map(f => (f.path === 'index.json' ? { ...f, sha256: 'a'.repeat(64) } : f)),
    files().map(f => (f.path === 'index.json' ? { ...f, b64: Buffer.from('{').toString('base64'), size: 1, sha256: sha(Buffer.from('{')) } : f)),
    files().filter(f => f.path !== 'index.json'),
    files().map(f => (f.path === 'p1.jpg' ? { ...f, b64: 'AAAA' } : f)),
    [...files(), F('p1.jpg', JPG)],
    files().map(f => (f.path === 'index.json' ? { path: f.path, sha256: f.sha256, size: f.size } : f)),
  ];
  for (const f of bad) assert.equal((await s.call(body({ files: f }))).statusCode, 400);
  assert.equal(s.commits.length, 0);
});

test('目錄與差異：planChanges、cragRow、upsertRow', () => {
  const fs = [{ path: 'index.json', sha256: 'a', size: 1 }, { path: 'x.jpg', sha256: 'b', size: 9 }, { path: 'x.thumb.jpg', sha256: 'c', size: 2 }, { path: 'thumb.jpg', sha256: 'd', size: 2 }];
  const { fresh, gone } = planChanges(fs, new Map([['index.json', 'a'], ['x.jpg', 'old'], ['gone.jpg', 'z']]));
  assert.deepEqual([fresh.map(f => f.path), gone], [['x.jpg', 'x.thumb.jpg', 'thumb.jpg'], ['gone.jpg']]);
  const row = cragRow({ id: GID, name: 'n', t: 1, version: 3, files: fs, locations: [], attribution: '' });
  assert.deepEqual([row.files, row.bytes, row.photos, row.thumbs, row.at], [4, 14, 2, 1, null]);
  const text = upsertRow(upsertRow('', { id: 'b' }), { id: 'a', n: 1 });
  assert.deepEqual(text.split('\n').filter(Boolean).map(l => JSON.parse(l).id), ['a', 'b']);
  assert.deepEqual(upsertRow(text, { id: 'a', n: 2 }).split('\n').filter(Boolean).map(l => JSON.parse(l)), [{ id: 'a', n: 2 }, { id: 'b' }]);
});

test('Hub：commit 支援指標與刪檔，lfsBatch 回要傳的網址', async () => {
  const calls = [];
  const get = async (url, o) => {
    calls.push({ url, body: o && o.body });
    if (!url.endsWith('/batch')) return { ok: true };
    return { ok: true, json: async () => ({ objects: JSON.parse(o.body).objects.map((x, i) => ({ ...x, actions: i ? {} : { upload: { href: 'u', header: {} }, verify: { href: 'v', header: {} } } })) }) };
  };
  const hf = createHf({ token: () => 't', repo: 'climbio/crags', get });
  const out = await hf.lfsBatch([{ oid: 'a', size: 1 }, { oid: 'b', size: 2 }]);
  assert.deepEqual(out.map(o => [o.oid, !!o.upload, !!o.verify]), [['a', true, true], ['b', false, false]]);
  assert.equal(calls[0].url, 'https://huggingface.co/datasets/climbio/crags.git/info/lfs/objects/batch');
  await hf.commit('x', [{ path: 'a.jpg', oid: 'o', size: 5 }, { path: 'b.jpg', deleted: true }, { path: 'c.json', bytes: Buffer.from('{}') }]);
  const lines = calls[1].body.split('\n').map(JSON.parse);
  assert.deepEqual(lines.slice(1).map(l => [l.key, l.value.path]), [['lfsFile', 'a.jpg'], ['deletedFile', 'b.jpg'], ['file', 'c.json']]);
  assert.equal(calls[1].url, 'https://huggingface.co/api/datasets/climbio/crags/commit/main');
});

test('國家 cc：小寫兩個字母才收，寫進專案文件、目錄與世界清單；新版本（新專案、origin 指到上一版）可以換國家', async () => {
  const s = setup();
  const bad = await s.call(body({ cc: 'TWN' }));
  assert.equal(bad.statusCode, 400);
  const r = await s.call(body({ cc: 'TW' }));
  assert.equal(r.statusCode, 200);
  assert.equal(s.docs.get(`datasets/${GID}`).cc, 'tw');
  assert.equal(JSON.parse(s.store.text).cc, 'tw');
  const moved = await s.call(body({ id: 'bbbbbbbb12345678', origin: GID, cc: 'jp' }));
  assert.equal(moved.statusCode, 200);
  assert.equal(s.docs.get('datasets/bbbbbbbb12345678').cc, 'jp');
});

test('3D 牆、3D 岩場放進自己的資料集：資料夾、目錄檔、專案文件的 hf.repo 與網址都照類型；大檔上限放寬', async () => {
  const { KINDS } = require('./crags-dataset');
  const { HF_CRAGS: _ } = require('./projects');
  const s = setup();
  const GLB = Buffer.alloc(30e6, 7);   // 超過一般岩場的單檔 25 MB
  const pack = [F('index.json', INDEX, true), F('wall.json', PACK, true), { path: 'wall-1.glb', sha256: sha(GLB), size: GLB.length }];
  const r = await s.call(body({ type: 'wall3d', files: pack, gym: '原岩明德' }));
  assert.equal(r.statusCode, 200);
  assert.equal(r.data.url, `https://huggingface.co/datasets/climbio/walls3d/resolve/main/walls3d/${GID}/index.json`);
  assert.deepEqual(s.commits[0].sort(), [`file:walls3d/${GID}/index.json`, `file:walls3d/${GID}/wall.json`, `lfs:walls3d/${GID}/wall-1.glb`, 'file:walls3d.jsonl'].sort());
  assert.deepEqual([s.docs.get(`datasets/${GID}`).type, s.docs.get(`datasets/${GID}`).hf], ['wall3d', { dir: `walls3d/${GID}/`, repo: 'walls3d' }]);
  assert.equal(JSON.parse(s.store.text).gym, '原岩明德');
  // 一般岩場的單檔上限還是 25 MB
  const big = await s.call(body({ id: 'bbbbbbbb12345678', files: [F('index.json', INDEX, true), { path: 'p.jpg', sha256: sha(GLB), size: GLB.length }] }));
  assert.equal(big.statusCode, 400);
  assert.deepEqual(Object.keys(KINDS), ['guidebook', 'wall3d', 'crag3d']);
});

test('3D 牆發佈不認人：不登入也能 prepare、publish，文件不記 owner；已發佈的 id 不能再改，更新用新的 id（origin 指到上一版）', async () => {
  const s = setup();
  const pack = [F('index.json', INDEX, true), F('wall.json', PACK, true), F('base-model.glb', JPG), F('faces-1.bin', JPG2)];   // 成品有 .bin
  const open = (o = {}) => body({ type: 'wall3d', files: pack, gym: '原岩明德', ...o });
  const none = 'nobody';   // 沒有登入：不需要
  assert.equal((await s.call({ op: 'prepare', id: GID, type: 'wall3d', files: pack }, none)).statusCode, 200);
  const r = await s.call(open(), none);
  assert.equal(r.statusCode, 200);
  assert.equal(s.docs.get(`datasets/${GID}`).owner, '');
  // 已發佈的 id：prepare、publish 都不行（沒有擁有者，不能蓋掉別人的）
  assert.equal((await s.call({ op: 'prepare', id: GID, type: 'wall3d', files: pack }, none)).statusCode, 409);
  assert.equal((await s.call(open(), none)).statusCode, 409);
  // 更新：新的 id，origin 指到上一版
  const NEXT = 'bbbbbbbb12345678';
  assert.equal((await s.call(open({ id: NEXT, origin: GID }), none)).statusCode, 200);
  assert.equal(s.docs.get(`datasets/${NEXT}`).origin, GID);
  // files：不認人類型的檔案清單誰都能讀（比對 Hub 已有的檔案）
  assert.deepEqual((await s.call({ op: 'files', id: GID, type: 'wall3d' }, none)).data.files.map(f => f.path).sort(), ['base-model.glb', 'faces-1.bin', 'index.json', 'wall.json']);
});

test('.bin 只有 3D 的成品收；岩場（guidebook）還是不收', async () => {
  const s = setup();
  assert.equal((await s.call(body({ files: [F('index.json', INDEX, true), F('x.bin', JPG)] }))).statusCode, 400);
});
