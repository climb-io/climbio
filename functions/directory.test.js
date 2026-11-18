const { test } = require('node:test');
const assert = require('node:assert/strict');
const { siteOrigin, checkSite, register, refreshDirectory, createDirectoryHandler } = require('./directory');
const { siteSet } = require('./open-format');
const { validate } = require('./format');

test('只收 https 的網域，不帶路徑；不收 IP、localhost、內部網域', () => {
  assert.equal(siteOrigin('https://gym.climbing.tw'), 'https://gym.climbing.tw');
  assert.equal(siteOrigin('https://gym.climbing.tw/'), 'https://gym.climbing.tw');
  for (const u of ['http://gym.climbing.tw', 'https://gym.climbing.tw/app', 'https://gym.climbing.tw/?x=1', 'https://127.0.0.1', 'https://[::1]', 'https://localhost',
    'https://nas.local', 'https://metadata.google.internal', 'https://a@gym.climbing.tw', 'ftp://gym.climbing.tw', '', null]) assert.equal(siteOrigin(u), null, String(u));
});

// 站的 climbio.json（組合 type: site）
const site = ({ name = '岩館A', url = 'https://gym.climbing.tw', listed = true, gyms = [{ gym: '原岩明德', n: 2, t: 5 }, { gym: '沒有牆', n: 0, t: 1 }] } = {}) => ({ ...siteSet({ origin: url, listed, gyms }), name });
const gymHref = (url, gym) => `${url}/w/gym/${encodeURIComponent(gym)}.json`;
const fetchOf = (pages) => async (url) => {
  const body = pages[url];
  if (body === undefined) throw new Error('連不上');
  return { ok: body !== null, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
};

test('讀 climbio.json 驗證：格式、listed、網址就是自己；只留有牆的岩館', async () => {
  const url = 'https://gym.climbing.tw', at = `${url}/climbio.json`;
  assert.deepEqual(await checkSite(url, fetchOf({ [at]: site() })), { url, name: '岩館A', gyms: [{ gym: '原岩明德', n: 2, t: 5, href: gymHref(url, '原岩明德') }] });
  await assert.rejects(checkSite(url, fetchOf({ [at]: site({ listed: false }) })), { code: 'unlisted' });
  await assert.rejects(checkSite(url, fetchOf({ [at]: site({ url: 'https://other.climbing.tw' }) })), { code: 'invalid' });   // 不能替別人登記
  await assert.rejects(checkSite(url, fetchOf({ [at]: '不是 JSON' })), { code: 'invalid' });
  await assert.rejects(checkSite(url, fetchOf({ [at]: { ...site(), climbio: 1 } })), { code: 'invalid' });   // 不認得的版本
  const away = site(); away.items[0].href = 'https://other.climbing.tw/w/gym/x.json';   // 別的站的岩館清單不收
  assert.deepEqual((await checkSite(url, fetchOf({ [at]: away }))).gyms, []);
  await assert.rejects(checkSite(url, fetchOf({ [at]: null })), { code: 'unreachable' });
  await assert.rejects(checkSite(url, fetchOf({})), { code: 'unreachable' });
});

// 假的 Firestore：dirSites、dirIndex、dirRate
function fakeDb() {
  const data = { dirSites: new Map(), dirIndex: new Map(), dirRate: new Map() };
  const docRef = (col, id) => ({
    get: async () => ({ exists: data[col].has(id), get: k => (data[col].get(id) || {})[k], data: () => data[col].get(id) }),
    set: async (v, opt) => { data[col].set(id, opt && opt.merge ? { ...data[col].get(id), ...v } : v); },
    delete: async () => { data[col].delete(id); },
  });
  return {
    data,
    collection: (col) => ({
      doc: (id) => docRef(col, id),
      get: async () => ({ docs: [...data[col].keys()].map(id => ({ ref: docRef(col, id), get: k => data[col].get(id)[k] })) }),
    }),
    runTransaction: async (fn) => fn({ get: (ref) => ref.get(), set: (ref, v) => ref.set(v) }),
  };
}

test('登記：驗過才收、合成總目錄；同一站 6 小時內不再讀；同一站一天最多 4 次、全部 200 次；改成不列出就移除', async () => {
  const db = fakeDb(), a = 'https://gym.climbing.tw', b = 'https://wall.climbing.tw';
  let reads = 0;
  const pages = { [`${a}/climbio.json`]: site(), [`${b}/climbio.json`]: site({ name: '岩館B', url: b, gyms: [{ gym: '原岩明德', n: 1, t: 9 }, { gym: '紅石士林', n: 3, t: 2 }] }) };
  const fetchImpl = async (url) => { reads++; return fetchOf(pages)(url); };
  assert.deepEqual(await register({ db, url: a, now: 1000, fetchImpl }), { status: 200, body: { ok: true } });
  assert.equal((await register({ db, url: b, now: 1000, fetchImpl })).status, 200);
  assert.deepEqual(db.data.dirIndex.get('all').gyms, [
    { gym: '原岩明德', n: 1, t: 9, href: gymHref(b, '原岩明德'), site: '岩館B' },
    { gym: '原岩明德', n: 2, t: 5, href: gymHref(a, '原岩明德'), site: '岩館A' },
    { gym: '紅石士林', n: 3, t: 2, href: gymHref(b, '紅石士林'), site: '岩館B' }]);
  await register({ db, url: a, now: 2000, fetchImpl });
  assert.equal(reads, 2);   // 剛驗過：不再讀
  for (let i = 0; i < 2; i++) await register({ db, url: a, now: 3000, fetchImpl });
  assert.equal((await register({ db, url: a, now: 3000, fetchImpl })).status, 429);   // 同一站今天第 5 次
  assert.equal((await register({ db, url: b, now: 3000, fetchImpl })).status, 200);
  db.data.dirRate.set('all', { day: 0, n: 200 });
  assert.equal((await register({ db, url: b, now: 3000, fetchImpl })).status, 429);   // 全部的上限
  pages[`${a}/climbio.json`] = site({ listed: false });
  assert.equal((await register({ db, url: a, now: 864e5 + 1000, fetchImpl })).status, 400);   // 隔天
  assert.deepEqual(db.data.dirIndex.get('all').gyms.map(g => g.site), ['岩館B', '岩館B']);
});

test('每天重新驗證：讀不到記一次，連續 7 次移除；封鎖的站不列', async () => {
  const db = fakeDb(), a = 'https://gym.climbing.tw';
  await register({ db, url: a, now: 0, fetchImpl: fetchOf({ [`${a}/climbio.json`]: site() }) });
  db.data.dirSites.set('blocked', { url: 'https://bad.climbing.tw', name: '壞', gyms: [{ gym: '原岩明德', n: 9, t: 99 }], blocked: true });
  for (let day = 1; day <= 6; day++) await refreshDirectory({ db, now: day, fetchImpl: fetchOf({}) });
  assert.deepEqual(db.data.dirIndex.get('all').gyms.map(g => g.site), ['岩館A']);   // 讀不到 6 次：還在，封鎖的不列
  await refreshDirectory({ db, now: 7, fetchImpl: fetchOf({}) });
  assert.deepEqual(db.data.dirIndex.get('all').gyms, []);
});

test('每天複查：總目錄自己的站不在清單裡就補讀進來', async () => {
  const db = fakeDb(), self = 'https://climbio.app';
  await refreshDirectory({ db, now: 1, fetchImpl: fetchOf({}), self });   // 讀不到：不收也不丟錯
  assert.deepEqual(db.data.dirIndex.get('all').gyms, []);
  await refreshDirectory({ db, now: 2, fetchImpl: fetchOf({ [`${self}/climbio.json`]: site({ name: '主網', url: self }) }), self });
  assert.deepEqual(db.data.dirIndex.get('all').gyms.map(g => g.site), ['主網']);
});

test('GET /dir/gyms.json：總目錄的組合，通過驗證', async () => {
  const db = fakeDb(), a = 'https://gym.climbing.tw';
  await register({ db, url: a, now: 0, fetchImpl: fetchOf({ [`${a}/climbio.json`]: site() }) });
  let out;
  const res = { set() { return this; }, status() { return this; }, json(v) { out = v; return this; } };
  await createDirectoryHandler({ db })({ method: 'GET', path: '/dir/gyms.json', get: (k) => (k === 'host' ? 'climbio.web.app' : '') }, res);
  assert.deepEqual(validate(out), []);
  assert.equal(out.type, 'directory');
  assert.deepEqual(out.items, [{ href: gymHref(a, '原岩明德'), name: '原岩明德', t: 5, props: { walls: 2, site: '岩館A' } }]);
});
