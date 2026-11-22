// 兩個代理交接（端到端）：本機跑同步服務（functions/studio-sync.js 同一份程式，資料庫、儲存空間是假的），
// 代理甲、乙各在自己的資料夾用命令列 tools/studio.mjs：甲推上去、乙接手修好推上去、甲還拿著舊版本推會被擋下、
// 兩邊都改了同一個檔案時不蓋掉、人在收件匣核准後才能發佈
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { createServer, request } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const Feedback3d = require('../studio/wall3d/feedback.js');
const Review3d = require('../studio/wall3d/review.js');
const { createHandler } = require('../functions/studio-sync.js');
const RouteKit = require('../routekit/format.js');
const KEY = 'k'.repeat(40);
const sq = (x, y, r) => [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]];

/** 假的 Firestore 與 Storage（只要同步服務用到的） */
function fakeStore() {
  const docs = new Map(), files = new Map();
  const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === 'object' && !Array.isArray(v) && a?.[k] && typeof a[k] === 'object' ? merge(a[k], v) : v; return o; };
  const doc = (path) => ({ id: path.split('/').pop(), get: async () => ({ exists: docs.has(path), data: () => structuredClone(docs.get(path)) }), set: async (v, o) => { docs.set(path, o?.merge ? merge(docs.get(path) || {}, v) : structuredClone(v)); }, delete: async () => { docs.delete(path); }, collection: (n) => coll(`${path}/${n}`) });
  const coll = (path) => ({ doc: (id) => doc(`${path}/${id}`), get: async () => ({ docs: [...docs.keys()].filter(p => p.startsWith(path + '/') && p.split('/').length === path.split('/').length + 1).map(p => ({ id: p.split('/').pop(), data: () => structuredClone(docs.get(p)), ref: doc(p) })) }) });
  const batch = () => { const ops = []; return { set: (r, v) => ops.push(() => r.set(v)), delete: (r) => ops.push(() => r.delete()), commit: async () => { for (const f of ops) await f(); } }; };
  const bucket = { file: (p) => ({ save: async (d, o) => { files.set(p, { d, t: o.contentType }); }, exists: async () => [files.has(p)], getMetadata: async () => [{ contentType: files.get(p).t }], download: async () => [files.get(p).d] }) };
  return { db: { collection: coll, batch }, bucket };
}

/** 同步服務：雲端函式的 handler 套上 Node 的 http（express 那種 req／res 只做用到的） */
function serve() {
  const { db, bucket } = fakeStore(), handler = createHandler({ db, bucket, key: () => KEY });
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks), u = new URL(req.url, 'http://x');
    const r = { method: req.method, query: Object.fromEntries(u.searchParams), rawBody: raw, body: /json/.test(req.headers['content-type'] || '') && raw.length ? JSON.parse(raw) : undefined, get: k => req.headers[k.toLowerCase()] };
    let code = 200;
    const out = { set(k, v) { res.setHeader(k, v); return out; }, status(c) { code = c; return out; }, json(d) { res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(d)); }, send(d) { res.writeHead(code).end(d); } };
    await handler(r, out);
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok(server)));
}

test('兩個代理交接：甲推上、乙接手修好推上；甲拿舊版本推被擋下、兩邊都改的檔案不蓋；人核准才能發佈', async () => {
  const server = await serve(), url = `http://127.0.0.1:${server.address().port}/studioSync`;
  const env = { ...process.env, CLIMBIO_STUDIO_KEY: KEY, CLIMBIO_STUDIO_URL: url };
  const studio = async (...a) => { try { const { stdout } = await promisify(execFile)(process.execPath, ['tools/studio.mjs', ...a], { encoding: 'utf8', env }); return { out: stdout, status: 0 }; } catch (e) { return { out: `${e.stdout}${e.stderr}`, status: e.code }; } };
  const wall = (...a) => promisify(execFile)(process.execPath, ['tools/wall.mjs', ...a], { encoding: 'utf8' });
  const A = mkdtempSync(join(tmpdir(), 'agent-a-')), B = mkdtempSync(join(tmpdir(), 'agent-b-'));
  try {
    // 甲：一面牆的分享包，h1、h2 疊在一起
    const pack = RouteKit.wallFiles({ pid: 'wallaaaabbbbcccc', name: '東牆', w: 800, h: 600, photo: new Uint8Array([0xff, 0xd8, 1, 2]),
      holds: [{ id: 'h1', poly: sq(100, 100, 20), source: 'detect' }, { id: 'h2', poly: sq(104, 102, 20), source: 'detect' }, { id: 'h3', poly: sq(400, 300, 25), source: 'detect' }] });
    for (const f of pack.files) writeFileSync(join(A, f.path), f.bytes);
    writeFileSync(join(A, 'index.json'), JSON.stringify({ climbio: 2, kind: 'set', type: 'walls', id: 'abcdefgh12345678', name: '東牆', t: 1, license: 'CC-BY-SA-4.0', attribution: 'KK', items: [{ href: pack.entry, id: 'wallaaaabbbbcccc' }] }));
    assert.equal((await studio('link', A, url)).status, 0);
    let r = await studio('push', A, '--by', 'agent:A');
    assert.equal(r.status, 0, r.out);
    const pid = JSON.parse(readFileSync(join(A, '.studio/work/remote.json'), 'utf8')).pid;

    // 乙：空資料夾接手，拿到檔案和題目；修好（停用 h2、答 edit）推上去
    r = await studio('pull', B, '--from', `#${pid}`, '--by', 'agent:B');
    assert.equal(r.status, 0, r.out);
    assert.equal(readFileSync(join(B, 'wallaaaabbbbcccc.jpg')).length, 4);
    const asked = JSON.parse((await studio('ask', B, '--json')).out);
    assert.deepEqual(asked.map(q => q.kind), ['hold-dup']);
    writeFileSync(join(B, 'fix.json'), JSON.stringify([{ op: 'remove', holds: ['h2'] }]));
    await wall('apply', B, join(B, 'fix.json'));
    r = await studio('push', B, '--by', 'agent:B');
    assert.equal(r.status, 0, r.out);

    // 甲還拿著第 1 版：自己也改了同一個檔案（新增 h4），推被擋下，服務上的不變
    writeFileSync(join(A, 'add.json'), JSON.stringify([{ op: 'add', poly: sq(600, 100, 20), id: 'h4' }]));
    await wall('apply', A, join(A, 'add.json'));
    r = await studio('push', A, '--by', 'agent:A');
    assert.equal(r.status, 1);
    assert.match(r.out, /先 node tools\/studio\.mjs pull/);
    // 甲拉：兩邊都改了照片畫面，不蓋掉，列出衝突；--theirs 用乙的
    r = await studio('pull', A, '--by', 'agent:A');
    assert.equal(r.status, 1);
    assert.match(r.out, /wallaaaabbbbcccc\.json/);
    assert.match(readFileSync(join(A, 'wallaaaabbbbcccc.json'), 'utf8'), /"h4"/);   // 甲的改動還在
    r = await studio('pull', A, '--theirs', '--by', 'agent:A');
    assert.equal(r.status, 0, r.out);
    const view = JSON.parse(readFileSync(join(A, 'wallaaaabbbbcccc.json'), 'utf8'));
    assert.equal(view.nodes.find(n => n.id === 'h2').props.retired, true);
    assert.ok(!view.nodes.some(n => n.id === 'h4'));

    // 題目答完只剩發佈：等人；代理不能答。人在乙那邊的 AI 對話裡答「發佈」，乙記下原話推上去，甲拉下來就核准了
    const pub = JSON.parse((await studio('ask', A, '--json')).out);
    assert.deepEqual(pub.map(q => [q.kind, q.waiting]), [['publish', 'human']]);
    assert.equal((await studio('answer', A, pub[0].id, 'ok', '--by', 'agent:A')).status, 2);
    assert.equal((await studio('approved', A)).status, 1);
    r = await studio('push', A, '--by', 'agent:A');
    assert.equal(r.status, 0, r.out);
    assert.equal((await studio('pull', B, '--theirs', '--by', 'agent:B')).status, 0);
    r = await studio('answer', B, pub[0].id, 'ok', '--by', 'human:KK', '--said', '發佈吧');
    assert.equal(r.status, 0, r.out);
    r = await studio('push', B, '--by', 'agent:B');
    assert.equal(r.status, 0, r.out);
    assert.equal((await studio('pull', A, '--by', 'agent:A')).status, 0);
    r = await studio('approved', A);
    assert.equal(r.status, 0, r.out);
    assert.equal(JSON.parse(r.out.trim().split('\n').at(-1)).by, 'human:KK');
  } finally {
    server.close();
    rmSync(A, { recursive: true, force: true });
    rmSync(B, { recursive: true, force: true });
  }
});

test('3D 牆手機試用連結：擁有者發權杖，拿權杖只能讀這個專案、寫回回報；代理 pull 拿回回報出題', async () => {
  const server = await serve(), url = `http://127.0.0.1:${server.address().port}/studioSync`;
  const env = { ...process.env, CLIMBIO_STUDIO_KEY: KEY, CLIMBIO_STUDIO_URL: url };
  const studio = async (...a) => { try { const { stdout } = await promisify(execFile)(process.execPath, ['tools/studio.mjs', ...a], { encoding: 'utf8', env }); return { out: stdout, status: 0 }; } catch (e) { return { out: `${e.stdout}${e.stderr}`, status: e.code }; } };
  const stages = async (dir) => {   // AI 檢查的前兩階段（模型、鏡頭動線）：代理看完 check3d 的圖自己答
    for (const k of ['model3d', 'path3d']) {
      const q = JSON.parse((await studio('ask', dir, '--json')).out);
      assert.deepEqual(q.map(x => x.kind), [k]);
      assert.equal((await studio('answer', dir, q[0].id, 'ok', '--by', 'agent:A')).status, 0);
    }
  };
  const A = mkdtempSync(join(tmpdir(), 'agent-a-'));
  try {
    const holds = [{ id: 'h1', position: [0, 0, 0], faceCount: 9 }];
    writeFileSync(join(A, 'wall.json'), JSON.stringify({ format: 'climbio-3d-wall/1', id: 'wallaaaabbbbcccc', name: '明德', model: 'model-1.glb', faces: 'faces-1.bin', holds, surfaces: { list: [], frame: { planes: [] } } }));
    writeFileSync(join(A, 'model-1.glb'), 'glb'); writeFileSync(join(A, 'faces-1.bin'), 'faces');
    const doc3 = JSON.parse(readFileSync(join(A, 'wall.json'), 'utf8'));
    writeFileSync(join(A, 'review3d.json'), JSON.stringify({ ...Review3d.empty(), holds: { h1: { v: 'keep', by: 'agent:t', at: '', sig: Review3d.sig(doc3, 'h1') } } }));   // AI 都看過了
    await stages(A);
    assert.equal((await studio('link', A, url)).status, 0);
    const r = await studio('try3d', A, '--no-bake', '--site', 'https://climbio-dev.web.app', '--by', 'agent:A');
    assert.equal(r.status, 0, r.out);
    const m = /\/studio\/wall3d\/\?app#sync=([0-9a-z]{16})&t=([A-Za-z0-9_-]+)(?:&u=[^&]+)?&step=try/.exec(r.out);
    assert.ok(m, r.out);
    const [, pid, token] = m, trial = { 'X-Studio-Trial': token, 'Content-Type': 'application/json' };
    const post = (body, headers = trial) => fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const pulled = await (await post({ op: 'pull', pid })).json();
    assert.deepEqual(Object.keys(pulled.project.files).sort(), ['faces-1.bin', 'model-1.glb', 'review3d.json', 'wall.json']);
    assert.equal(pulled.questions, undefined);   // 拿權杖的看不到題目和判斷
    assert.equal(await (await fetch(`${url}?pid=${pid}&path=faces-1.bin`, { headers: trial })).text(), 'faces');
    // 越權：推、發新權杖、別的專案、壞掉的回報都不行
    assert.equal((await post({ op: 'push', pid, name: 'x', line: 'wall3d', base: pulled.project.rev })).status, 403);
    assert.equal((await post({ op: 'trialLink', pid })).status, 403);
    assert.equal((await post({ op: 'pull', pid: 'zzzzzzzzzzzzzzzz' })).status, 401);
    assert.equal((await post({ op: 'feedback', pid, text: '{"format":"x"}' })).status, 400);
    assert.equal((await post({ op: 'pull', pid }, { 'X-Studio-Trial': 'wrong', 'Content-Type': 'application/json' })).status, 401);
    // 手機回報一筆
    const fb = Feedback3d.add(null, { hold: 'h1', point: [0, 0, 0], camera: [0, 0, 1, 0, 0, 0, 1], aspect: 1, text: '這顆光暈太大' });
    assert.equal((await post({ op: 'feedback', pid, text: JSON.stringify(fb) })).status, 200);
    // 代理 pull 拿回來，出題給代理處理；本機在那之後改過的工作檔（服務上沒動）不能被蓋回舊版
    const mine = JSON.parse(readFileSync(join(A, 'wall.json'), 'utf8')); mine.name = '明德（本機改過）'; writeFileSync(join(A, 'wall.json'), JSON.stringify(mine));
    assert.equal((await studio('pull', A, '--by', 'agent:A')).status, 0);
    assert.equal(JSON.parse(readFileSync(join(A, 'wall.json'), 'utf8')).name, '明德（本機改過）');
    const qs = JSON.parse((await studio('ask', A, '--json')).out);
    assert.deepEqual(qs.map(q => q.kind), ['feedback3d']);
    assert.match(qs[0].title, /這顆光暈太大/);
    // 再發一次：舊權杖失效
    await studio('try3d', A, '--no-bake', '--site', 'https://climbio-dev.web.app', '--by', 'agent:A');
    assert.equal((await post({ op: 'pull', pid })).status, 401);
  } finally {
    server.close();
    rmSync(A, { recursive: true, force: true });
  }
});

test('3D 牆的工作資料夾是專案：工作檔齊了就出發佈題（代理不能答），發佈時烘的成品/ 不同步', async () => {
  const server = await serve(), url = `http://127.0.0.1:${server.address().port}/studioSync`;
  const env = { ...process.env, CLIMBIO_STUDIO_KEY: KEY, CLIMBIO_STUDIO_URL: url };
  const studio = async (...a) => { try { const { stdout } = await promisify(execFile)(process.execPath, ['tools/studio.mjs', ...a], { encoding: 'utf8', env }); return { out: stdout, status: 0 }; } catch (e) { return { out: `${e.stdout}${e.stderr}`, status: e.code }; } };
  const stages = async (dir) => {   // AI 檢查的前兩階段（模型、鏡頭動線）：代理看完 check3d 的圖自己答
    for (const k of ['model3d', 'path3d']) {
      const q = JSON.parse((await studio('ask', dir, '--json')).out);
      assert.deepEqual(q.map(x => x.kind), [k]);
      assert.equal((await studio('answer', dir, q[0].id, 'ok', '--by', 'agent:A')).status, 0);
    }
  };
  const A = mkdtempSync(join(tmpdir(), 'agent-a-')), B = mkdtempSync(join(tmpdir(), 'agent-b-'));
  try {
    writeFileSync(join(A, 'wall.json'), JSON.stringify({ format: 'climbio-3d-wall/1', id: 'wallaaaabbbbcccc', name: '明德', model: 'model-1.glb', faces: 'faces-1.bin', holds: [], surfaces: { list: [], frame: { planes: [] } } }));
    writeFileSync(join(A, 'model-1.glb'), 'glb');
    assert.deepEqual(JSON.parse((await studio('ask', A, '--json')).out), []);   // 面標籤還沒有：工作檔不齊，不問發佈
    writeFileSync(join(A, 'faces-1.bin'), 'faces');
    mkdirSync(join(A, '成品'));
    writeFileSync(join(A, '成品', 'wall.json'), '{}');
    await stages(A);
    const st = JSON.parse((await studio('status', A, '--json')).out);
    assert.deepEqual([st.line, st.step, st.next], ['wall3d', 'built', 'human']);
    const trial = JSON.parse((await studio('ask', A, '--json')).out);
    assert.deepEqual(trial.map(q => q.kind), ['trial3d']);   // 發佈前要人在 Studio 試用（代理不能答）
    assert.equal((await studio('answer', A, trial[0].id, 'ok', '--by', 'agent:A')).status, 2);
    const doc = JSON.parse(readFileSync(join(A, 'wall.json'), 'utf8'));
    writeFileSync(join(A, 'feedback3d.json'), JSON.stringify(Feedback3d.markTried(null, doc)));   // 人在 Studio 按「試用完」
    const pub = JSON.parse((await studio('ask', A, '--json')).out);
    assert.deepEqual(pub.map(q => q.kind), ['publish']);
    assert.equal((await studio('answer', A, pub[0].id, 'ok', '--by', 'agent:A')).status, 2);
    assert.equal((await studio('link', A, url)).status, 0);
    assert.equal((await studio('push', A, '--by', 'agent:A')).status, 0);
    const pid = JSON.parse(readFileSync(join(A, '.studio/work/remote.json'), 'utf8')).pid;
    assert.equal((await studio('pull', B, '--from', `#${pid}`, '--by', 'agent:B')).status, 0);
    assert.equal(readFileSync(join(B, 'faces-1.bin'), 'utf8'), 'faces');
    assert.ok(!existsSync(join(B, '成品')));
  } finally {
    server.close();
    rmSync(A, { recursive: true, force: true });
    rmSync(B, { recursive: true, force: true });
  }
});

test('大檔（3D 模型）：超過一次請求的上限就分段推上去，另一台拉下來一模一樣', async () => {
  const server = await serve(), url = `http://127.0.0.1:${server.address().port}/studioSync`;
  const env = { ...process.env, CLIMBIO_STUDIO_KEY: KEY, CLIMBIO_STUDIO_URL: url };
  const studio = async (...a) => { try { await promisify(execFile)(process.execPath, ['tools/studio.mjs', ...a], { encoding: 'utf8', env }); return 0; } catch (e) { return `${e.stdout}${e.stderr}`; } };
  const A = mkdtempSync(join(tmpdir(), 'agent-a-')), B = mkdtempSync(join(tmpdir(), 'agent-b-'));
  try {
    const pack = RouteKit.wallFiles({ pid: 'wallaaaabbbbcccc', name: '東牆', w: 800, h: 600, photo: new Uint8Array([0xff, 0xd8, 1, 2]), holds: [{ id: 'h1', poly: sq(100, 100, 20), source: 'detect' }] });
    for (const f of pack.files) writeFileSync(join(A, f.path), f.bytes);
    writeFileSync(join(A, 'index.json'), JSON.stringify({ climbio: 2, kind: 'set', type: 'walls', id: 'abcdefgh12345678', name: '東牆', t: 1, license: 'CC-BY-SA-4.0', attribution: 'KK', items: [{ href: pack.entry, id: 'wallaaaabbbbcccc' }] }));
    const big = Buffer.alloc(50 << 20);
    for (let i = 0; i < big.length; i += 4096) big[i] = i % 251;
    writeFileSync(join(A, 'model.glb'), big);
    assert.equal(await studio('link', A, url), 0);
    assert.equal(await studio('push', A, '--by', 'agent:A'), 0);
    const pid = JSON.parse(readFileSync(join(A, '.studio/work/remote.json'), 'utf8')).pid;
    // 服務上記的是分段（每段都在一次請求的上限以內）
    const got = await new Promise((ok, no) => { const req = request(url, { method: 'POST', headers: { 'X-Studio-Key': KEY, 'Content-Type': 'application/json' } }, (res) => { const c = []; res.on('data', x => c.push(x)); res.on('end', () => ok(JSON.parse(Buffer.concat(c)))); }); req.on('error', no); req.end(JSON.stringify({ op: 'pull', pid })); });
    assert.equal(got.project.files['model.glb'].parts.length, 3);
    assert.equal(await studio('pull', B, '--from', `#${pid}`, '--by', 'agent:B'), 0);
    assert.ok(readFileSync(join(B, 'model.glb')).equals(big));
  } finally {
    server.close();
    rmSync(A, { recursive: true, force: true });
    rmSync(B, { recursive: true, force: true });
  }
});
