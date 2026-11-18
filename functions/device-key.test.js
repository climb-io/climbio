const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createHandler } = require('./walls');
const { kidOf, message } = require('./device-key');

const PID = 'abcdefgh1234', NOW = 2e12, PROJECT = 'wallproject00001', SRC = { project: PROJECT, path: `${PID}.json` };

function setup({ appOk = true } = {}) {
  const docs = new Map([[`datasets/${PROJECT}`, { owner: '', version: 1, files: [`${PID}.json`] }]]);
  const snap = (id, v) => ({ id, exists: v !== undefined, get: k => (v || {})[k] });
  const coll = name => ({ doc: id => ({ get: async () => snap(id, docs.get(`${name}/${id}`)), set: async v => { docs.set(`${name}/${id}`, v); }, update: async v => { docs.set(`${name}/${id}`, { ...docs.get(`${name}/${id}`), ...v }); }, delete: async () => { docs.delete(`${name}/${id}`); } }) });
  const db = { collection: coll, runTransaction: async fn => fn({ get: ref => ref.get(), set: (ref, v) => { ref.set(v); }, delete: ref => { ref.delete(); } }) };
  let now = NOW, ok = appOk;
  const handler = createHandler({ db, now: () => now, refreshGym: async () => {}, appChecked: async () => ok });
  const call = async (body, { ip = '1.1.1.1' } = {}) => {
    const res = { statusCode: 200, set() {}, status(c) { this.statusCode = c; return this; }, json(d) { this.data = d; return this; } };
    await handler({ method: 'POST', body, ip, get: () => '' }, res);
    return res;
  };
  return { call, docs, tick: ms => { now += ms; }, block: ok2 => { ok = ok2; } };
}

// 一個「手機」：自己的金鑰，簽出請求（跟 appkit/device-key.js 用同一種格式）
function phone() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pub = publicKey.export({ format: 'jwk' }), kid = kidOf(pub);
  const sign = (op, body, ts = NOW, nonce = crypto.randomBytes(12).toString('base64url')) => {
    const b = { ...body, op, auth: { kid, pub: { kty: 'EC', crv: 'P-256', x: pub.x, y: pub.y }, ts, nonce, sig: '' } };
    b.auth.sig = crypto.sign('sha256', Buffer.from(message(op, b)), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return b;
  };
  return { kid, sign };
}
const route = id => JSON.stringify({ nodes: [{ id, type: 'route', t: 1 }], marks: [] });   // 圖層的片段
const routes = ids => ({ pid: PID, routes: ids.map(id => ({ id, r: route(id) })) });

async function published(s) { await s.call({ op: 'publish', pid: PID, name: '牆', gym: '', src: SRC }); }

test('裝置金鑰：不登入也能寫自己的線，擁有者記成 k:<kid>，同一把金鑰才能改、刪', async () => {
  const s = setup(); await published(s);
  const a = phone(), b = phone();
  assert.deepEqual((await s.call(a.sign('put', routes(['r1', 'r2'])))).data, { ok: true, results: { r1: 'ok', r2: 'ok' } });
  assert.equal(s.docs.get(`wallRoutes/${PID}`).routes.r1.uid, `k:${a.kid}`);
  assert.deepEqual((await s.call(b.sign('put', routes(['r1', 'r3'])))).data, { ok: true, results: { r1: 'taken', r3: 'ok' } });
  assert.deepEqual((await s.call(b.sign('put', { pid: PID, del: ['r2', 'r3'] }))).data, { ok: true, results: { r2: 'taken', r3: 'ok' } });
  const r = (await s.call({ op: 'routes', pid: PID, kid: a.kid })).data;
  assert.deepEqual(r.routes.map(x => [x.rid, x.mine]).sort(), [['r1', true], ['r2', true]]);
  assert.equal((await s.call({ op: 'routes', pid: PID, kid: b.kid })).data.routes.some(x => x.mine), false);
  assert.deepEqual((await s.call(a.sign('withdraw', { pid: PID }))).data, { ok: true });   // 不是擁有者：只拿掉自己的線
  assert.deepEqual(s.docs.get(`wallRoutes/${PID}`), undefined);
});

test('裝置金鑰：簽章不對、內容被改、過期、重放、kid 對不上公鑰、沒有 App Check 都拒絕，什麼都不寫', async () => {
  const s = setup(); await published(s);
  const a = phone(), good = a.sign('put', routes(['r1']));
  const bad = (b, status, error) => s.call(b).then(r => assert.deepEqual([r.statusCode, r.data.error], [status, error]));
  await bad({ ...good, routes: routes(['r2']).routes }, 401, 'bad signature');   // 內容被改
  await bad({ ...a.sign('put', routes(['r1'])), op: 'withdraw' }, 401, 'bad signature');   // 簽的是 put，拿去 withdraw
  await bad(a.sign('put', routes(['r1']), NOW - 6 * 60e3), 401, 'stale');
  await bad(a.sign('put', routes(['r1']), NOW + 6 * 60e3), 401, 'stale');
  const other = phone();
  await bad({ ...good, auth: { ...good.auth, kid: other.kid } }, 401, 'bad key');   // kid 不是這把公鑰的指紋
  await bad({ ...good, auth: { ...good.auth, sig: good.auth.sig.slice(0, -2) + 'AA' } }, 401, 'bad signature');
  await bad({ op: 'put', ...routes(['r1']) }, 401, 'no key');   // 沒簽章
  assert.equal((await s.call(good)).statusCode, 200);
  await bad(good, 401, 'replay');   // 同一個簽章不能再用
  s.block(false);
  await bad(a.sign('put', routes(['r2'])), 401, 'app check');
  assert.deepEqual(Object.keys(s.docs.get(`wallRoutes/${PID}`).routes), ['r1']);
});

test('裝置金鑰：黑名單（deviceKeys/{kid}.blocked）的金鑰不能寫，別把金鑰不受影響；每天有次數上限', async () => {
  const s = setup(); await published(s);
  const a = phone(), b = phone();
  assert.equal((await s.call(a.sign('put', routes(['r1'])))).statusCode, 200);
  s.docs.set(`deviceKeys/${a.kid}`, { blocked: true });
  assert.deepEqual((await s.call(a.sign('put', routes(['r2'])))).data, { error: 'blocked' });
  assert.deepEqual((await s.call(a.sign('withdraw', { pid: PID }))).data, { error: 'blocked' });
  assert.equal((await s.call(b.sign('put', routes(['r3'])))).statusCode, 200);
  for (let i = 1; i < 600; i++) assert.equal((await s.call(b.sign('put', routes(['r3'])))).statusCode, 200, String(i));
  assert.deepEqual((await s.call(b.sign('put', routes(['r3'])))).data, { error: 'daily limit' });
});
