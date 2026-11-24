const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHandler, createHf, checkFiles, baseUrl } = require('./walls-dataset');
const crypto = require('node:crypto');
const { kidOf } = require('./device-key');

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
const body = (o = {}) => ({ op: 'publishWall', source: 'studio', id: WID, name: '測試牆', gym: '測試館', licenseAccepted: true, files: files(), ...o });

function fakeDb() {
  const docs = new Map();
  const snap = v => ({ exists: v !== undefined, get: k => (v || {})[k] });
  const db = { collection: c => ({ where: () => ({ get: async () => ({ docs: [...docs].filter(([k]) => k.startsWith(`${c}/`)).map(([k, v]) => ({ id: k.split('/')[1], get: x => v[x] })) }) }), doc: id => ({ get: async () => snap(docs.get(`${c}/${id}`)), set: async v => { docs.set(`${c}/${id}`, structuredClone(v)); }, update: async v => { docs.set(`${c}/${id}`, { ...docs.get(`${c}/${id}`), ...structuredClone(v) }); } }) }) };
  return { db, docs };
}
function setup(extra = {}) {
  const { db, docs } = fakeDb(), commits = [], store = { text: '', files: new Map() };
  const hf = {
    read: async path => (path === 'walls.jsonl' ? store.text || null : store.files.get(path) || null),
    commit: async (summary, fs) => { commits.push({ summary, paths: fs.map(f => f.path) }); for (const f of fs) { if (f.path === 'walls.jsonl') store.text = f.bytes.toString(); else if (f.path.endsWith('.json')) store.files.set(f.path, f.bytes.toString()); } },
  };
  const handler = createHandler({ db, hf, now: () => 2e12, ...extra });
  const call = async (b, ip = '1.1.1.1', method = 'POST') => {
    const res = { statusCode: 200, set() { return this; }, status(c) { this.statusCode = c; return this; }, json(d) { this.data = d; return this; } };
    await handler({ method, body: b, get: k => ({ 'x-forwarded-for': ip }[k.toLowerCase()]) }, res);
    return res;
  };
  return { call, db, docs, commits, store };
}

test('不是 Studio 發佈的（岩點貓 App 或舊版沒帶 source）：拒絕，什麼都不寫', async () => {
  const s = setup();
  for (const source of [undefined, 'hold', '', 'app']) {
    const r = await s.call(body({ source }));
    assert.equal(r.statusCode, 400); assert.equal(r.data.error, 'studio only');
  }
  assert.deepEqual([s.commits.length, s.docs.size], [0, 0]);
});

test('發佈：不登入，寫進 walls/<id>/v1/ 與根目錄的 walls.jsonl；Firestore 只記 datasets（沒有擁有者）', async () => {
  const { call, docs, commits, store } = setup();
  const r = await call(body({ gym: '測試館', files: files(view(), [{ path: `${PID}.thumb.jpg`, b64: JPG }, { path: `${PID}.edits.json`, b64: json({ holdlab: 1, reviewed: 1, deleted: ['a'], added: ['b', 'c'], flagged: { x: 1, y: 2 } }) }]) }));
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.data, { id: WID, version: 1, current: 1, base: baseUrl(WID, 1) });
  assert.deepEqual(commits[0].paths, [`${PID}.jpg`, `${PID}.json`, `${PID}.thumb.jpg`, `${PID}.edits.json`, 'index.json'].map(p => `walls/${WID}/v1/${p}`).concat('walls.jsonl', ...[`${PID}.jpg`, `${PID}.json`, `${PID}.thumb.jpg`, `${PID}.edits.json`].map(p => `walls/${WID}/current/${p}`)).filter(p => !p.endsWith('/index.json')));
  assert.equal(store.files.get(`walls/${WID}/current/${PID}.json`), store.files.get(`walls/${WID}/v1/${PID}.json`));   // 現行版的固定網址 current/ 跟著發佈寫（同樣的內容）
  const idx = docs.get(`datasets/${WID}`);
  assert.deepEqual([idx.owner, idx.type, idx.name, idx.version, idx.latest, idx.at], ['', 'walls', '測試牆', 1, 1, 2e12]);
  const row = JSON.parse(store.text);
  assert.deepEqual([row.id, row.gym, row.dir, row.w, row.h, row.holds, row.photoBytes, row.license], [WID, '測試館', `walls/${WID}/v1/`, 640, 480, 2, 7, 'CC-BY-SA-4.0']);
  assert.deepEqual(row.edits, { reviewed: true, by: 'human', deleted: 1, added: 2, reshaped: 0, flagged: 2 });   // Studio 人按「逐顆檢查完了」
});

test('發佈新版本後重算岩館清單（用到這個包的牆）；重算失敗不影響發佈', async () => {
  const seen = [], a = setup({ refreshGyms: async id => { seen.push(id); } });
  assert.equal((await a.call(body())).statusCode, 200);
  assert.deepEqual(seen, [WID]);
  const b = setup({ refreshGyms: async () => { throw new Error('firestore down'); } }), log = console.error; console.error = () => {};
  try { const r = await b.call(body()); assert.deepEqual([r.statusCode, r.data.version], [200, 1]); } finally { console.error = log; }
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

test('checkFiles：大小上限與路徑白名單跳脫', () => {
  assert.throws(() => checkFiles([files()[1], { path: `${PID}.jpg`, b64: Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(8e6)]).toString('base64') }]), e => e.status === 400);
  assert.throws(() => checkFiles([{ path: `${PID}/jpg`, b64: JPG }, files()[1]]), e => e.status === 400);
  assert.throws(() => checkFiles([files()[0], { path: `${PID}Xjson`, b64: Buffer.from('not json').toString('base64') }]), e => e.status === 400);
});

test('Studio 發佈的公開牆一定要有岩館名稱', async () => {
  const { call } = setup();
  assert.equal((await call(body({ gym: '' }))).statusCode, 400);
  assert.equal((await call(body({ gym: undefined }))).statusCode, 400);
});

test('不認人：不用金鑰，任何人都能發佈新版本；Firestore 不記擁有者；舊牆留著的 ownerKid 被拿掉', async () => {
  const { call, docs } = setup();
  assert.equal((await call(body())).statusCode, 200);
  assert.equal(docs.get(`datasets/${WID}`).ownerKid, undefined);
  docs.set(`datasets/${WID}`, { ...docs.get(`datasets/${WID}`), ownerKid: 'x'.repeat(32) });   // 舊牆
  const r = await call(body({ files: files(view(3)) }), '2.2.2.2');   // 另一個人、沒有簽章
  assert.equal(r.statusCode, 200); assert.equal(r.data.version, 2); assert.equal(r.data.owner, undefined);
  assert.equal(docs.get(`datasets/${WID}`).ownerKid, undefined);
  assert.equal((await call({ op: 'transferWall', id: WID, newKid: 'x'.repeat(32) })).data.error, 'bad op');   // 轉交已經拿掉
});

test('現行版自動判定：照片換了（指紋不同）的新版本照樣存成新版本，但岩點貓看到的現行版不換', async () => {
  const { call, docs } = setup();
  assert.equal((await call(body())).data.current, 1);
  const other = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]).toString('base64');
  const r = await call(body({ files: [{ path: `${PID}.jpg`, b64: other }, { path: `${PID}.json`, b64: json(view(3)) }] }));
  assert.equal(r.statusCode, 200); assert.equal(r.data.version, 2); assert.equal(r.data.current, 1);
  assert.deepEqual([docs.get(`datasets/${WID}`).version, docs.get(`datasets/${WID}`).latest], [1, 2]);
  const same = await call(body({ files: files(view(3)) }));   // 照片同一張：成為現行版
  assert.equal(same.data.version, 3); assert.equal(same.data.current, 3);
});


test('牆發佈的內嵌頁（source: embed）跟 Studio 一樣能發佈', async () => {
  const s = setup();
  const r = await s.call(body({ source: 'embed' }));
  assert.deepEqual([r.statusCode, r.data.version], [200, 1]);
});

// ---- agent 發佈：岩館金鑰簽章（不要 App Check）----
const b64u = buf => Buffer.from(buf).toString('base64url');
function agentKey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }), jwk = publicKey.export({ format: 'jwk' });
  return { privateKey, pub: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, kid: kidOf(jwk) };
}
/** 簽這次發佈（簽的訊息跟 device-key.js 一樣：[op, 牆 id, ts, nonce, [檔案雜湊], []]） */
function signed(key, b, { ts = 2e12, nonce = 'nonce' + Math.random().toString(36).slice(2, 10) } = {}) {
  const sha = x => crypto.createHash('sha256').update(x).digest('hex');
  const sig = sha(b.files.map(f => `${f.path}:${sha(Buffer.from(f.b64, 'base64'))}`).sort().join('\n'));
  const msg = JSON.stringify(['publishWall', b.id, ts, nonce, [sig], []]);
  return { ...b, source: 'agent', auth: { kid: key.kid, pub: key.pub, ts, nonce, sig: b64u(crypto.sign('sha256', Buffer.from(msg), { key: key.privateKey, dsaEncoding: 'ieee-p1363' })) } };
}

test('agent 發佈：金鑰簽章對了就發佈，版本記下金鑰（commit 與文件），同一面牆再發是新版本', async () => {
  const s = setup(), key = agentKey();
  const r = await s.call(signed(key, body()));
  assert.deepEqual([r.statusCode, r.data.version], [200, 1]);
  assert.match(s.commits[0].summary, new RegExp(`金鑰 ${key.kid.slice(0, 8)}`));
  assert.equal(s.docs.get(`datasets/${WID}`).kid, key.kid);
  const r2 = await s.call(signed(key, body({ files: files(view(3)) })));
  assert.deepEqual([r2.statusCode, r2.data.version], [200, 2]);
});

test('agent 發佈：簽章錯、內容被改、重放、時間差太多、沒簽章都拒絕', async () => {
  const s = setup(), key = agentKey(), other = agentKey();
  const ok = signed(key, body());
  assert.equal((await s.call({ ...ok, auth: { ...ok.auth, sig: signed(other, body()).auth.sig } })).statusCode, 401);   // 別把金鑰的簽章
  assert.equal((await s.call({ ...ok, files: files(view(5)) })).statusCode, 401);   // 簽完改了內容
  assert.equal((await s.call({ ...body(), source: 'agent' })).statusCode, 401);   // 沒簽章
  assert.equal((await s.call(signed(key, body(), { ts: 2e12 - 3600e3 }))).data.error, 'stale');
  assert.equal((await s.call(ok)).statusCode, 200);
  assert.equal((await s.call(ok)).statusCode, 401);   // 同一個簽章不能再用
  assert.equal(s.commits.length, 1);
});

test('agent 發佈：被封鎖的金鑰 403；每把金鑰每天也有上限（換 IP 也一樣）', async () => {
  const s = setup(), blocked = agentKey(), key = agentKey();
  s.docs.set(`deviceKeys/${blocked.kid}`, { blocked: true });
  assert.equal((await s.call(signed(blocked, body()))).statusCode, 403);
  const wall = i => body({ id: `aaaaaaaaaaaaaa${String(i).padStart(2, '0')}` });   // 每次一面新牆
  for (let i = 0; i < 30; i++) assert.equal((await s.call(signed(key, wall(i)), `9.9.${i}.1`)).statusCode, 200, `第 ${i + 1} 次`);
  const r = await s.call(signed(key, wall(30)), '8.8.8.8');
  assert.deepEqual([r.statusCode, r.data.error], [429, 'daily limit']);
});
