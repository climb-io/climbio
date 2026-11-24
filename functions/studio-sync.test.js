// Studio 同步服務（studio-sync.js）：金鑰、推上拉下、題目整份換掉、判斷合併、檔案、路徑檢查
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHandler, validPath, keyMatches, githubMember } = require('./studio-sync');

const KEY = 'k'.repeat(40), PID = 'abcdefgh12345678';

/** 假的 Firestore：路徑 → 資料；支援 set（merge）、get、子集合、batch */
function fakeDb() {
  const docs = new Map();
  const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === 'object' && !Array.isArray(v) && a?.[k] && typeof a[k] === 'object' ? merge(a[k], v) : v; return o; };
  const doc = (path) => ({
    id: path.split('/').pop(), path,
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path), id: path.split('/').pop() }),
    set: async (v, o) => { docs.set(path, o?.merge ? merge(docs.get(path) || {}, v) : v); },
    delete: async () => { docs.delete(path); },
    collection: (n) => coll(`${path}/${n}`),
  });
  const coll = (path) => ({
    doc: (id) => doc(`${path}/${id}`),
    get: async () => ({ docs: [...docs.keys()].filter(p => p.startsWith(path + '/') && p.split('/').length === path.split('/').length + 1).map(p => ({ id: p.split('/').pop(), data: () => docs.get(p), ref: doc(p) })) }),
  });
  const batch = () => { const ops = []; return { set: (ref, v) => ops.push(() => ref.set(v)), delete: (ref) => ops.push(() => ref.delete()), commit: async () => { for (const f of ops) await f(); } }; };
  return { docs, collection: coll, batch };
}
function fakeBucket() {
  const files = new Map();
  const miss = (p) => { if (!files.has(p)) throw Object.assign(new Error('No such object'), { code: 404 }); };   // 跟 Cloud Storage 一樣：沒有的檔回 code 404
  return { files, file: (p) => ({ save: async (data, o) => { files.set(p, { data, type: o.contentType }); }, exists: async () => [files.has(p)], getMetadata: async () => { miss(p); return [{ contentType: files.get(p).type }]; }, download: async () => { miss(p); return [files.get(p).data]; } }) };
}
function setup(key = KEY, member) {
  const db = fakeDb(), bucket = fakeBucket(), handler = createHandler({ db, bucket, key: () => key, member, now: () => 1000 });
  const call = async ({ method = 'POST', body, query = {}, auth = KEY, raw, type, headers: extra = {} }) => {
    const headers = { 'x-studio-key': auth || '', 'content-type': type, ...extra };
    const res = { statusCode: 200, headers: { Vary: 'Origin' }, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.statusCode = c; return this; }, json(d) { this.data = d; return this; }, send(d) { this.data = d; return this; } };
    await handler({ method, body, query, rawBody: raw, get: k => headers[k.toLowerCase()] }, res);
    return res;
  };
  return { db, bucket, call };
}
const q = (id, extra = {}) => ({ id, line: 'convert', kind: 'route-line', level: 'check', target: [], title: id, options: ['ok', 'edit', 'fix'], since: 't', seen: 't', ...extra });
const d = (id, qid, choice = 'ok') => ({ id, q: qid, choice, by: 'human:kk', at: '2026-01-01T00:00:00Z' });

test('金鑰：沒設定時服務關著；金鑰錯的不能讀寫；GET 告訴用戶端金鑰對不對', async () => {
  const off = setup('');
  assert.equal((await off.call({ body: { op: 'list' } })).statusCode, 503);
  const { call } = setup();
  assert.equal((await call({ body: { op: 'list' }, auth: 'wrong' })).statusCode, 401);
  assert.equal((await call({ body: { op: 'list' }, auth: '' })).statusCode, 401);
  assert.deepEqual((await call({ method: 'GET', auth: 'wrong' })).data, { ok: true, auth: false });
  assert.deepEqual((await call({ method: 'GET' })).data, { ok: true, auth: true });
});

test('推上、拉下：題目整份換掉，判斷照 id 合併', async () => {
  const { call } = setup();
  const push = (questions, decisions, base) => call({ body: { op: 'push', pid: PID, base, name: '灰岩', line: 'convert', state: { open: questions.length }, questions, decisions, runs: [], notes: [] } });
  const first = await push([q('q-a'), q('q-b')], [d('d-1', 'q-a')]);
  assert.deepEqual([first.statusCode, first.data.rev], [200, 1]);   // 新專案不用帶版本
  assert.equal((await push([q('q-b')], [d('d-2', 'q-b', 'fix')], 1)).statusCode, 200);   // 舊的判斷 d-1 沒帶也不刪
  const r = await call({ body: { op: 'pull', pid: PID } });
  assert.deepEqual(r.data.questions.map(x => x.id), ['q-b']);
  assert.deepEqual(r.data.decisions.map(x => x.id).sort(), ['d-1', 'd-2']);
  assert.equal(r.data.project.name, '灰岩');
  const list = await call({ body: { op: 'list' } });
  assert.deepEqual(list.data.projects.map(p => [p.id, p.name]), [[PID, '灰岩']]);
  assert.equal(list.data.projects[0].state.open, 1);
});

test('不合格式的請求擋下：pid、紀錄 id、沒有的專案、太大的檔案', async () => {
  const { call } = setup();
  assert.equal((await call({ body: { op: 'pull', pid: '../x' } })).statusCode, 400);
  assert.equal((await call({ body: { op: 'pull', pid: PID } })).statusCode, 404);
  assert.equal((await call({ body: { op: 'push', pid: PID, name: 'x', line: 'convert', questions: [{ id: '../../x' }] } })).statusCode, 400);
  assert.equal((await call({ body: { op: 'answer', pid: PID } })).statusCode, 400);   // 沒有收件匣，不收單筆判斷
  assert.equal((await call({ method: 'PUT', query: { pid: PID, path: 'a.jpg' }, raw: Buffer.alloc((30 << 20) + 1) })).statusCode, 413);
});

test('檔案：上傳照內容存，push 帶檔案清單才換上；下載拿回同樣的位元組；工作紀錄、往上層的路徑不收', async () => {
  const { call } = setup();
  const data = Buffer.from('jpeg bytes');
  const up = await call({ method: 'PUT', query: { pid: PID, path: '.studio/source/images/牆.jpg' }, raw: data, type: 'image/jpeg' });
  assert.equal(up.statusCode, 200);
  const up2 = await call({ method: 'PUT', query: { pid: PID, path: 'index.json' }, raw: Buffer.from('{}'), type: 'application/json' });
  const files = { '.studio/source/images/牆.jpg': { sha256: up.data.sha256, size: up.data.size }, 'index.json': { sha256: up2.data.sha256, size: 2 } };
  // 清單指到沒傳過的內容：擋下
  assert.equal((await call({ body: { op: 'push', pid: PID, name: '灰岩', line: 'convert', files: { 'x.json': { sha256: 'a'.repeat(64), size: 1 } } } })).statusCode, 400);
  assert.equal((await call({ body: { op: 'push', pid: PID, name: '灰岩', line: 'convert', files } })).statusCode, 200);
  const pulled = await call({ body: { op: 'pull', pid: PID } });
  assert.deepEqual(Object.keys(pulled.data.project.files).sort(), ['.studio/source/images/牆.jpg', 'index.json']);
  assert.equal(pulled.data.project.files['index.json'].size, 2);
  const down = await call({ method: 'GET', query: { pid: PID, path: '.studio/source/images/牆.jpg' } });
  assert.equal(down.headers['Content-Type'], 'image/jpeg');
  assert.deepEqual(down.data, data);
  for (const p of ['../x.jpg', '/x.jpg', 'a//b.jpg', '.studio/work/state.json', '.git/config', 'a/../b.jpg']) assert.equal(validPath(p), false, p);
  for (const p of ['index.json', 'images/IMG 0001.jpg', '.studio/source/outline.md']) assert.equal(validPath(p), true, p);
});

test('大檔分段：清單的 parts 每段都要傳過；照內容一段一段下載，整個檔用路徑下載回 413', async () => {
  const { call } = setup();
  const a = Buffer.from('first half '), b = Buffer.from('second half');
  const [pa, pb] = [await call({ method: 'PUT', query: { pid: PID, path: 'model.glb' }, raw: a }), await call({ method: 'PUT', query: { pid: PID, path: 'model.glb' }, raw: b })];
  const whole = { sha256: 'c'.repeat(64), size: a.length + b.length };
  const push = (files) => call({ body: { op: 'push', pid: PID, name: '明德', line: 'wall3d', files } });
  assert.equal((await push({ 'model.glb': { ...whole, parts: [pa.data.sha256, 'd'.repeat(64)] } })).statusCode, 400);   // 有一段沒傳
  assert.equal((await push({ 'model.glb': { ...whole, parts: [pa.data.sha256] } })).statusCode, 400);   // 一段就不用分
  assert.equal((await push({ 'model.glb': { ...whole, size: (30 << 20) + 1 } })).statusCode, 400);   // 太大又沒分段
  assert.equal((await push({ 'model.glb': { ...whole, parts: [pa.data.sha256, pb.data.sha256] } })).statusCode, 200);
  const pulled = await call({ body: { op: 'pull', pid: PID } });
  assert.deepEqual(pulled.data.project.files['model.glb'].parts, [pa.data.sha256, pb.data.sha256]);
  assert.equal((await call({ method: 'GET', query: { pid: PID, path: 'model.glb' } })).statusCode, 413);
  assert.deepEqual((await call({ method: 'GET', query: { pid: PID, sha: pb.data.sha256 } })).data, b);
  assert.equal((await call({ method: 'GET', query: { pid: PID, sha: '../x' } })).statusCode, 400);
  assert.equal((await call({ method: 'GET', query: { pid: PID, sha: 'e'.repeat(64) } })).statusCode, 404);
});

test('金鑰比對（發佈的函式也用它認擁有者的代理）：沒設定或沒帶都不對', () => {
  assert.equal(keyMatches(KEY, KEY), true);
  assert.equal(keyMatches(KEY, 'x'), false);
  assert.equal(keyMatches('', ''), false);
  assert.equal(keyMatches(KEY, ''), false);
});

test('版本：push 要帶上次看到的版本，別人在中間推過就 409、什麼都不改（題目、檔案）；收件匣答題不動版本', async () => {
  const { call } = setup();
  const put = async (path, text) => (await call({ method: 'PUT', query: { pid: PID, path }, raw: Buffer.from(text), type: 'application/json' })).data;
  const push = (base, questions, files) => call({ body: { op: 'push', pid: PID, base, name: '灰岩', line: 'convert', questions, files } });
  const a = await put('index.json', '{"v":1}');
  assert.equal((await push(undefined, [q('q-a')], { 'index.json': a })).data.rev, 1);
  // 代理甲、乙都從第 1 版開始；甲先推
  const b = await put('index.json', '{"v":2}');
  assert.equal((await push(1, [q('q-b')], { 'index.json': b })).data.rev, 2);
  // 乙還以為是第 1 版：擋下，題目、檔案都是甲的
  const c = await put('index.json', '{"v":3}');
  const late = await push(1, [q('q-c')], { 'index.json': c });
  assert.deepEqual([late.statusCode, late.data.error, late.data.rev], [409, 'conflict', 2]);
  const now = await call({ body: { op: 'pull', pid: PID } });
  assert.deepEqual(now.data.questions.map(x => x.id), ['q-b']);
  assert.equal(now.data.project.files['index.json'].sha256, b.sha256);
  assert.equal(String((await call({ method: 'GET', query: { pid: PID, path: 'index.json' } })).data), '{"v":2}');
  // 沒帶版本也算對不上（專案已經有了）
  assert.equal((await push(undefined, [q('q-c')])).statusCode, 409);
  assert.equal((await push(2, [q('q-c')], { 'index.json': c })).data.rev, 3);
});

test('GitHub 權杖：repo 的協作者（permissions.push）才算擁有者；結果照雜湊快取，GitHub 壞了不快取；沒設 repo、不像權杖的不問 GitHub', async () => {
  const GOOD = 'ghp_' + 'a'.repeat(36), READ = 'gho_' + 'b'.repeat(36), DOWN = 'github_pat_' + 'c'.repeat(40);
  let t = 0, asked = [], down = true;
  const fetch = async (url, o) => {
    asked.push([url, o.headers.Authorization]);
    const tok = o.headers.Authorization.slice(7);
    if (tok === DOWN && down) return { ok: false, status: 502 };
    return { ok: true, status: 200, json: async () => ({ permissions: { push: tok !== READ } }) };
  };
  const member = githubMember({ repo: 'me/repo', fetch, now: () => t });
  assert.equal(await member(GOOD), true);
  assert.deepEqual(asked[0], ['https://api.github.com/repos/me/repo', `Bearer ${GOOD}`]);
  assert.equal(await member(GOOD), true);
  assert.equal(asked.length, 1, '十分鐘內不再問');
  t = 601e3; await member(GOOD);
  assert.equal(asked.length, 2, '過期再問');
  assert.equal(await member(READ), false, '只能讀的不算');
  assert.equal(await member(DOWN), false);
  down = false;
  assert.equal(await member(DOWN), true, 'GitHub 壞掉那次不快取');
  const n = asked.length;
  assert.equal(await member(KEY), false);
  assert.equal(await member(''), false);
  assert.equal(await githubMember({ repo: '', fetch })(GOOD), false);
  assert.equal(asked.length, n, '不像權杖、沒設 repo 都不問 GitHub');

  const { call } = setup(KEY, member);
  assert.equal((await call({ method: 'GET', auth: GOOD })).data.auth, true);
  assert.equal((await call({ body: { op: 'list' }, auth: GOOD })).statusCode, 200);
  assert.equal((await call({ body: { op: 'list' }, auth: READ })).statusCode, 401);
  assert.equal((await call({ body: { op: 'list' } })).statusCode, 200, '金鑰照樣能用');
});

test('下載：收 gzip 就送壓好的（照內容存的壓一次存成 .gz）、圖片不壓；照內容下載可以一直快取；試用權杖記一下不用每次查', async () => {
  const { call, bucket } = setup();
  const json = Buffer.from(JSON.stringify({ holds: Array.from({ length: 300 }, (_, i) => ({ id: `p${i}`, position: [i, i, i] })) }));
  const up = await call({ method: 'PUT', query: { pid: PID, path: 'wall.json' }, raw: json, type: 'application/json' });
  const img = Buffer.alloc(4000, 7), upi = await call({ method: 'PUT', query: { pid: PID, path: 'snap.jpg' }, raw: img, type: 'image/jpeg' });
  await call({ body: { op: 'push', pid: PID, name: '明德', line: 'wall3d', files: { 'wall.json': { sha256: up.data.sha256, size: json.length }, 'snap.jpg': { sha256: upi.data.sha256, size: img.length } } } });
  const gz = { 'accept-encoding': 'gzip, deflate, br' };
  const a = await call({ method: 'GET', query: { pid: PID, path: 'wall.json' }, headers: gz });
  assert.equal(a.headers['Content-Encoding'], 'gzip');
  assert.equal(a.headers['Cache-Control'], 'private, no-store');   // 路徑下載：同一個路徑內容會換
  assert.deepEqual(require('node:zlib').gunzipSync(a.data), json);
  assert.ok(bucket.files.has(`studio/${PID}/blobs/${up.data.sha256}.gz`));
  const b = await call({ method: 'GET', query: { pid: PID, sha: up.data.sha256 }, headers: gz });
  assert.match(b.headers['Cache-Control'], /immutable/);
  assert.equal(b.headers.Vary, 'Origin, Accept-Encoding');
  assert.deepEqual(require('node:zlib').gunzipSync(b.data), json);
  const plain = await call({ method: 'GET', query: { pid: PID, sha: up.data.sha256 } });   // 不收 gzip 的送原檔
  assert.equal(plain.headers['Content-Encoding'], undefined); assert.deepEqual(plain.data, json);
  const c = await call({ method: 'GET', query: { pid: PID, path: 'snap.jpg' }, headers: gz });
  assert.equal(c.headers['Content-Encoding'], undefined); assert.deepEqual(c.data, img);
  // 試用權杖：記一下不用每次查；換發新權杖後新的馬上能用、舊的馬上失效
  const t1 = (await call({ body: { op: 'trialLink', pid: PID } })).data.token;
  const asTrial = (tok) => call({ method: 'GET', query: { pid: PID, path: 'wall.json' }, auth: '', headers: { 'x-studio-trial': tok } });
  assert.equal((await asTrial(t1)).statusCode, 200);
  assert.equal((await asTrial('x'.repeat(32))).statusCode, 401);
  const t2 = (await call({ body: { op: 'trialLink', pid: PID } })).data.token;
  assert.equal((await asTrial(t2)).statusCode, 200);
  assert.equal((await asTrial(t1)).statusCode, 401);
});
