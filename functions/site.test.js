const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HOSTS, ORIGINS, isPreview } = require('./site');
const { createPageHandler } = require('./route-page');

test('主站網域：climbio.app 是主要網址，climbio.web.app 也是正式站，開發版共用資料；都是允許的來源', () => {
  assert.equal(HOSTS[0], 'climbio.app');
  assert.ok(HOSTS.includes('climbio.web.app') && HOSTS.includes('climbio-dev.web.app'));
  for (const o of ['https://climbio.app', 'https://climbio.web.app', 'https://climbio-dev.web.app']) assert.ok(ORIGINS.includes(o), o);
  assert.ok(!ORIGINS.includes('https://evil.example'));
  assert.ok(isPreview('https://climbio--pr1-abc.web.app') && isPreview('https://climbio-dev--x.web.app') && !isPreview('https://evil--x.web.app'));
});

// 假的 Firestore：總目錄的岩館索引是空的
const db = { collection: (name) => ({ doc: () => ({ get: async () => ({ exists: false, get: () => undefined }), set: async () => {} }) }), runTransaction: async (fn) => fn({ get: async () => ({ exists: false }), set: () => {} }) };
const call = (handler, req) => new Promise(resolve => {
  const res = { headers: {}, statusCode: 200, set(k, v) { this.headers[k.toLowerCase()] = v; return this; }, status(c) { this.statusCode = c; return this; },
    type() { return this; }, json(d) { resolve({ ...this, body: d }); }, send(d) { resolve({ ...this, body: d }); }, redirect(c, u) { resolve({ ...this, statusCode: c, location: u }); } };
  handler(req, res);
});

test('climbio.json：climbio.app 列進總目錄；climbio.web.app、開發版不列，網址是自己', async () => {
  const handler = createPageHandler({ db, bucket: {}, safeSearch: null, hosts: HOSTS });
  const site = async (host) => (await call(handler, { path: '/climbio.json', get: k => (k === 'host' ? host : undefined) })).body.props;
  assert.deepEqual(await site('climbio.app'), { url: 'https://climbio.app', listed: true });
  assert.deepEqual(await site('climbio.web.app'), { url: 'https://climbio.web.app', listed: false });
  assert.deepEqual(await site('climbio-dev.web.app'), { url: 'https://climbio-dev.web.app', listed: false });
  assert.deepEqual(await site('evil.example'), { url: 'https://climbio.app', listed: false });
});
