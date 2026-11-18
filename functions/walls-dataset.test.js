const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHandler, createHf, checkFiles, baseUrl } = require('./walls-dataset');
const { createFileHandler, HF_BASE } = require('./projects');

const WID = 'abcdefgh12345678', PID = 'pid0000000000001';
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');
const json = o => Buffer.from(JSON.stringify(o)).toString('base64');
const sq = (x, y, s = 40) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
/** 畫面：n 顆岩點（外框合理）；extra：再多的岩點 [id, poly] */
const view = (n = 2, extra = [], o = {}) => {
  const hs = [...Array.from({ length: n }, (_, i) => [`h${i}`, sq(20 + i * 60, 40)]), ...extra];
  return { climbio: 2, kind: 'view', w: 640, h: 480, nodes: [...hs.map(([id]) => ({ id, type: 'hold' })), { id: 'r1', type: 'route' }],
    marks: hs.map(([id, p]) => ({ node: id, geometry: { type: 'Polygon', coordinates: [[...p, p[0]]] } })), ...o };
};
const files = (v = view(), more = []) => [{ path: `${PID}.jpg`, b64: JPG }, { path: `${PID}.json`, b64: json(v) }, ...more];
const body = (o = {}) => ({ op: 'publishWall', id: WID, name: '測試牆', licenseAccepted: true, files: files(), ...o });

function fakeDb() {
  const docs = new Map();
  const snap = v => ({ exists: v !== undefined, get: k => (v || {})[k] });
  const db = { collection: c => ({ doc: id => ({ get: async () => snap(docs.get(`${c}/${id}`)), set: async v => { docs.set(`${c}/${id}`, structuredClone(v)); } }) }) };
  return { db, docs };
}
function setup() {
  const { db, docs } = fakeDb(), commits = [], store = { text: '', files: new Map() };
  const hf = {
    read: async path => (path === 'walls.jsonl' ? store.text || null : store.files.get(path) || null),
    commit: async (summary, fs) => { commits.push({ summary, paths: fs.map(f => f.path) }); for (const f of fs) { if (f.path === 'walls.jsonl') store.text = f.bytes.toString(); else if (f.path.endsWith('.json')) store.files.set(f.path, f.bytes.toString()); } },
  };
  const handler = createHandler({ db, hf, now: () => 2e12 });
  const call = async (b, ip = '1.1.1.1', method = 'POST') => {
    const res = { statusCode: 200, set() { return this; }, status(c) { this.statusCode = c; return this; }, json(d) { this.data = d; return this; } };
    await handler({ method, body: b, get: k => ({ 'x-forwarded-for': ip }[k.toLowerCase()]) }, res);
    return res;
  };
  return { call, db, docs, commits, store };
}

test('發佈：不登入，寫進 walls/<id>/v1/ 與根目錄的 walls.jsonl；Firestore 只記 datasets，不記擁有者', async () => {
  const { call, docs, commits, store } = setup();
  const r = await call(body({ gym: '測試館', files: files(view(), [{ path: `${PID}.thumb.jpg`, b64: JPG }, { path: `${PID}.edits.json`, b64: json({ holdlab: 1, reviewed: 1, deleted: ['a'], added: ['b', 'c'], flagged: { x: 1, y: 2 } }) }]) }));
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.data, { id: WID, version: 1, current: 1, base: baseUrl(WID, 1) });
  assert.deepEqual(commits[0].paths, [`${PID}.jpg`, `${PID}.json`, `${PID}.thumb.jpg`, `${PID}.edits.json`, 'index.json'].map(p => `walls/${WID}/v1/${p}`).concat('walls.jsonl').filter(p => !p.endsWith('/index.json')));
  const idx = docs.get(`datasets/${WID}`);
  assert.deepEqual([idx.owner, idx.type, idx.name, idx.version, idx.latest, idx.at], ['', 'walls', '測試牆', 1, 1, 2e12]);
  const row = JSON.parse(store.text);
  assert.deepEqual([row.id, row.gym, row.dir, row.w, row.h, row.holds, row.photoBytes, row.license], [WID, '測試館', `walls/${WID}/v1/`, 640, 480, 2, 7, 'CC-BY-SA-4.0']);
  assert.deepEqual(row.edits, { reviewed: true, deleted: 1, added: 2, reshaped: 0, flagged: 2 });
});

test('目錄：新版本換同一牆那一行、其他牆留著、沒有精修記錄 edits 是 null', async () => {
  const { call, store } = setup();
  store.text = JSON.stringify({ id: 'zzzzzzzz', name: '別面' }) + '\n';
  await call(body());
  await call(body({ files: files(view(2, [['h9', sq(400, 300)]])) }));
  const rows = store.text.split('\n').filter(Boolean).map(JSON.parse);
  assert.deepEqual(rows.map(r => r.id), [WID, 'zzzzzzzz']);
  assert.deepEqual([rows[0].version, rows[0].edits], [2, null]);
});

test('發佈：歷代署名沿版本保留（留名不留權）', async () => {
  const { call, docs } = setup();
  await call(body({ files: files(view(2, [], { attribution: '甲' })) }));
  await call(body({ files: files(view(2, [['h9', sq(400, 300)]], { attribution: '乙' })) }), '2.2.2.2');
  await call(body({ files: files(view(2, [['h9', sq(400, 300)], ['h8', sq(500, 300)]], { attribution: '甲' })) }), '3.3.3.3');
  assert.deepEqual(docs.get(`datasets/${WID}`).credits, ['甲', '乙']);
});

test('發佈：內容一樣不寫新版本；改了版本加一；任何人都能發新版本（不認人）', async () => {
  const { call, commits } = setup();
  await call(body());
  const same = await call(body(), '2.2.2.2');
  assert.deepEqual([same.data.version, same.data.same, commits.length], [1, true, 1]);
  const next = await call(body({ files: files(view(2, [['h9', sq(400, 300)]])) }), '3.3.3.3');
  assert.equal(next.data.version, 2);
  assert.equal(commits[1].paths[0], `walls/${WID}/v2/${PID}.jpg`);
});

test('發佈驗證：外框不合理、少掉前一版的岩點、尺寸變、變動超過 30% 都整份拒絕', async () => {
  const { call, docs, commits } = setup();
  assert.equal((await call(body({ files: files(view(2, [['bad', [[0, 0], [5, 5]]]])) }))).statusCode, 400, '外框不合理');
  assert.equal(docs.has(`datasets/${WID}`), false);
  await call(body({ files: files(view(10)) }));
  assert.equal((await call(body({ files: files(view(9)) }))).statusCode, 409, '少一顆');
  assert.equal((await call(body({ files: files(view(10, [], { w: 800 })) }))).statusCode, 409, '尺寸變');
  const moved = k => view(10).marks.map((m, i) => (i < k ? { ...m, geometry: { type: 'Polygon', coordinates: [m.geometry.coordinates[0].map(([x, y]) => [x + 3, y])] } } : m));
  assert.equal((await call(body({ files: files({ ...view(10), marks: moved(4) }) }))).statusCode, 409, '變動 4 顆（超過 30%）');
  assert.equal((await call(body({ files: files({ ...view(10), marks: moved(3) }) }))).statusCode, 200, '變動 3 顆');
  assert.equal(commits.length, 2);
});

test('現行版：最新一個逐顆檢查完了的版本；新版本沒檢查過、現行版檢查過，現行版不換', async () => {
  const { call, docs } = setup();
  const reviewed = [{ path: `${PID}.edits.json`, b64: json({ holdlab: 1, reviewed: 1 }) }];
  const v = (k) => view(2, [['h9', sq(400, 300)], ...Array.from({ length: k }, (_, i) => [`x${i}`, sq(500 + i * 50, 300)])]);
  let r = await call(body({ files: files(view(2)) }));
  assert.deepEqual([r.data.version, r.data.current], [1, 1]);
  r = await call(body({ files: files(v(0), reviewed) }));
  assert.deepEqual([r.data.version, r.data.current], [2, 2], '檢查完了的成為現行版');
  r = await call(body({ files: files(v(1)) }));
  assert.deepEqual([r.data.version, r.data.current], [3, 2], '沒檢查過的不取代');
  const idx = docs.get(`datasets/${WID}`);
  assert.deepEqual([idx.version, idx.latest, idx.reviewed], [2, 3, true]);
  r = await call(body({ files: files(v(2), reviewed) }));
  assert.deepEqual([r.data.version, r.data.current], [4, 4]);
});

test('發佈：要接受授權、檔案路徑與內容照白名單', async () => {
  const { call, commits } = setup();
  assert.equal((await call(body({ licenseAccepted: false }))).statusCode, 400);
  assert.equal((await call(body({ id: 'BAD' }))).statusCode, 400);
  const F = files();
  for (const fs of [
    [F[0]],                                                          // 沒有畫面
    [F[1]],                                                          // 沒有照片
    [...F, { path: '../x.json', b64: json({}) }],                    // 路徑
    [...F, { path: 'photo.jpg', b64: JPG }],                         // 檔名不是 8～40 碼英數
    [...F, { path: 'routes/a.json', b64: json({}) }],
    [F[1], { path: `${PID}.jpg`, b64: json({}) }],                   // 照片不是 JPEG
    [F[0], { path: `${PID}.json`, b64: Buffer.from('{').toString('base64') }],   // json 壞掉
    [...F, F[0]],                                                    // 重複
  ]) assert.equal((await call(body({ files: fs }))).statusCode, 400);
  assert.equal(commits.length, 0);
});

test('發佈：每天上限（按網路來源）；Hugging Face 失敗回 502 且不留索引', async () => {
  const s = setup();
  const key = ip => `ip${require('node:crypto').createHash('sha256').update(ip).digest('hex').slice(0, 16)}`;
  s.docs.set(`publishQuota/${key('1.1.1.1')}_dataset_${new Date(2e12 + 8 * 3600e3).toISOString().slice(0, 10)}`, { n: 30 });
  assert.equal((await s.call(body(), '1.1.1.1')).statusCode, 429);
  assert.equal((await s.call(body(), '9.9.9.9')).statusCode, 200, '別的網路來源不受影響');
  const { db, docs } = fakeDb();
  const handler = createHandler({ db, hf: { read: async () => null, commit: async () => { throw Object.assign(new Error('hub failed'), { status: 502 }); } } });
  const res = { set() { return this; }, status(c) { this.statusCode = c; return this; }, json(d) { this.data = d; return this; } };
  await handler({ method: 'POST', body: body(), get: () => '' }, res);
  assert.equal(res.statusCode, 502);
  assert.equal(docs.has(`datasets/${WID}`), false);
});

test('Hugging Face 寫入：JSON 放 commit、JPEG 走 LFS（batch、PUT、lfsFile）；失敗丟 502', async () => {
  const calls = [];
  const get = async (url, o) => {
    calls.push({ url, o });
    if (url.endsWith('/info/lfs/objects/batch')) return { ok: true, json: async () => ({ objects: JSON.parse(o.body).objects.map(x => ({ oid: x.oid, actions: { upload: { href: 'https://lfs.example/put', header: { x: '1' } } } })) }) };
    return { ok: true };
  };
  const hf = createHf({ token: () => 'tok', get });
  await hf.commit('摘要', [{ path: 'walls/x/v1/a.jpg', bytes: Buffer.from('ab') }, { path: 'walls/x/v1/a.json', bytes: Buffer.from('{}') }]);
  assert.deepEqual(calls.map(c => c.url), ['https://huggingface.co/datasets/climbio/walls.git/info/lfs/objects/batch', 'https://lfs.example/put', 'https://huggingface.co/api/datasets/climbio/walls/commit/main']);
  assert.equal(calls[0].o.headers.Authorization, 'Bearer tok');
  const lines = calls[2].o.body.split('\n').map(JSON.parse);
  assert.deepEqual([lines[0].key, lines[1].key, lines[1].value.path, lines[1].value.size, lines[2].key, lines[2].value.content], ['header', 'lfsFile', 'walls/x/v1/a.jpg', 2, 'file', Buffer.from('{}').toString('base64')]);
  assert.equal(lines[1].value.oid, require('node:crypto').createHash('sha256').update('ab').digest('hex'));
  const bad = createHf({ token: () => 't', get: async () => ({ ok: false, status: 403, text: async () => 'no' }) });
  await assert.rejects(bad.commit('x', [{ path: 'a.json', bytes: Buffer.from('{}') }]), e => e.status === 502);
  await assert.rejects(bad.commit('x', [{ path: 'a.jpg', bytes: Buffer.from('1') }]), e => e.status === 502);
});

test('checkFiles：大小上限', () => {
  assert.throws(() => checkFiles([files()[1], { path: `${PID}.jpg`, b64: Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(8e6)]).toString('base64') }]), e => e.status === 400);
});

test('讀取：/p/<id>/<檔> 由 datasets 文件推出資料夾，導向資料集，不讀 Drive、不存副本', async () => {
  const { call, db } = setup();
  await call(body());
  const kept = new Map();
  const handler = createFileHandler({ db, readDrive: async () => { throw new Error('不該讀 Drive'); }, store: { get: async id => kept.get(id) || null, put: async (id, b) => { kept.set(id, b); } } });
  const res = { statusCode: 200, headers: {}, set(k, v) { this.headers[k.toLowerCase()] = v; return this; }, type() { return this; }, status(c) { this.statusCode = c; return this; }, send() { return this; }, end() { return this; }, redirect(c, u) { this.statusCode = c; this.location = u; return this; } };
  await handler({ method: 'GET', path: `/p/${WID}/${PID}.jpg`, headers: {}, get: () => '', query: {} }, res);
  assert.deepEqual([res.statusCode, res.location], [302, `${HF_BASE}walls/${WID}/v1/${PID}.jpg`]);
  assert.equal(kept.size, 0);
  await handler({ method: 'GET', path: `/p/${WID}/other.jpg`, headers: {}, get: () => '', query: {} }, res);
  assert.equal(res.statusCode, 404);
});
