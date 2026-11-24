const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createHandler, expire, validGym, EXPIRE_MS } = require('./walls');

const K1 = '1'.repeat(32), K2 = '2'.repeat(32), PID = 'abcdefgh1234', NOW = 2e12, DAY = new Date(NOW + 8 * 3600e3).toISOString().slice(0, 10);
const THUMB_LEFTOVER = 'data:image/jpeg;base64,AAAA', PROJECT = 'wallproject00001', SRC = { project: PROJECT, path: `${PID}.json` };
// Wall 專案發佈的包（projects.js 的索引）：牆的入口在裡面
const PACKAGE = { owner: '', version: 1, files: ['index.json', `${PID}.json`, 'layer0000001.json'] };   // datasets/{包 id}：公開牆在開放資料集
const body = (o = {}) => ({ op: 'publish', source: 'studio', pid: PID, name: '牆', gym: '原岩萬華#B區', src: SRC, ...o });

function setup(extra = {}) {
  const docs = new Map([[`datasets/${PROJECT}`, PACKAGE]]), files = new Map(), calls = [];
  const snap = (id, v) => ({ id, exists: v !== undefined, get: k => (v || {})[k] });
  // 這個集合自己的文件（不含子集合的）
  const own = name => [...docs].filter(([p]) => p.startsWith(name + '/') && p.split('/').length === name.split('/').length + 1);
  const coll = name => ({
    doc: id => (assert.ok(!String(id).includes('/'), `Firestore 文件 id 不能有斜線：${id}`), { get: async () => snap(id, docs.get(`${name}/${id}`)), set: async v => { docs.set(`${name}/${id}`, v); }, update: async v => { docs.set(`${name}/${id}`, { ...docs.get(`${name}/${id}`), ...v }); }, delete: async () => { docs.delete(`${name}/${id}`); } }),
    get: async () => ({ docs: own(name).map(([p, d]) => snap(p.split('/').pop(), d)) }),
    where: (f, op, v) => ({ limit: () => ({ get: async () => ({ docs: own(name).filter(([, d]) => (op === '<' ? d[f] < v : d[f] === v)).map(([p, d]) => snap(p.split('/')[1], d)) }) }) }),
  });
  const db = { collection: coll, runTransaction: async fn => fn({ get: ref => ref.get(), set: (ref, v) => { ref.set(v); }, delete: ref => { ref.delete(); } }) };
  let now = NOW, checked = true, owner = false;
  const refreshGym = async pid => { calls.push(['refresh', pid]); };
  // 簽章驗證換成假的：auth.kid 就是這把金鑰（真的驗證在 device-key.test.js）
  const handler = createHandler({ db, now: () => now, refreshGym, appChecked: async () => checked, isOwner: async () => owner, verify: (op, b) => b.auth.kid, ...extra });
  // who：裝置金鑰（寫線、收回自己的線要簽）；同時當網路來源
  const call = async (b, who = K1) => {
    const res = { statusCode: 200, set() {}, status(c) { this.statusCode = c; return this; }, json(d) { this.data = d; return this; } };
    await handler({ method: 'POST', body: ['put', 'withdraw'].includes(b.op) ? { ...b, auth: { kid: who } } : b, get: k => ({ 'x-forwarded-for': who }[k.toLowerCase()]) }, res);
    return res;
  };
  return { call, docs, files, calls, refreshGym, tick: ms => { now += ms; }, db, now: () => now, appCheck: v => { checked = v; }, asOwner: v => { owner = v; } };
}

test('岩館字串：用 # 分層、最多 30 字、每層不能是空的', () => {
  for (const g of ['原岩萬華', '原岩萬華#B區', '原岩萬華#二教練#B區']) assert.equal(validGym(g), true, g);
  for (const g of ['', '#B區', '原岩萬華#', '原岩萬華##B區', ' 原岩', 'x'.repeat(31), 5, null]) assert.equal(validGym(g), false, String(g));
});

test('發佈：不登入、不記擁有者，只記索引，Climbio 不存照片、縮圖、訓練副本', async () => {
  const { call, docs, files } = setup();
  assert.deepEqual((await call(body())).data, { pid: PID });
  assert.deepEqual(docs.get(`shared/${PID}`), { name: '牆', gym: '原岩萬華#B區', src: SRC, publishedAt: NOW, activeAt: NOW });
  assert.equal(files.size, 0);
  assert.equal((await call(body({ thumb: THUMB_LEFTOVER, training: { w: 1, h: 1 } }), K2)).statusCode, 200);   // 舊欄位直接忽略，不存；任何人都能再發
  assert.equal(files.size, 0);
});

test('登記到找牆面：只收 Studio 發佈的牆，岩點貓 App（沒帶 source）一律拒絕', async () => {
  const s = setup();
  const r = await s.call(body({ source: undefined }));
  assert.equal(r.statusCode, 400); assert.equal(r.data.error, 'studio only');
});

test('發佈：沒有 App Check、格式不對、入口不在已發佈的包裡都拒絕，什麼都不寫', async () => {
  const { call, docs, files, appCheck } = setup();
  appCheck(false);
  assert.equal((await call(body())).statusCode, 401);
  appCheck(true);
  for (const bad of [{ pid: 'x' }, { name: '' }, { gym: '#' }, { gym: 'x'.repeat(31) }, { src: { project: 'x', path: 'y.json' } }, { src: null }, { src: { project: PROJECT, path: 'nothere00001.json' } }, { src: { project: 'nopackage000001', path: `${PID}.json` } }]) {
    assert.equal((await call(body(bad))).statusCode, 400, JSON.stringify(bad).slice(0, 50));
  }
  assert.equal(docs.size, 1); assert.equal(files.size, 0);
});

test('發佈：一個網路來源一天有上限', async () => {
  const { call } = setup();
  assert.equal((await call(body())).statusCode, 200);
  for (let i = 0; i < 59; i++) assert.equal((await call(body({ pid: `wall${String(i).padStart(8, '0')}` }))).statusCode, 200);
  assert.equal((await call(body({ pid: 'wallover00001' }))).statusCode, 429);
  assert.equal((await call(body({ pid: 'wallover00001' }), K2)).statusCode, 200);   // 別的來源不受影響
});

const route = (id, extra = {}) => JSON.stringify({ nodes: [{ id, type: 'route', t: 1 }], marks: [], ...extra });   // 圖層的片段
const put = (routes, del) => ({ op: 'put', pid: PID, ...(routes ? { routes: routes.map(id => ({ id, r: route(id) })) } : {}), ...(del ? { del } : {}) });

test('公開牆的線：牆要先發佈；每個人（金鑰）只能改、刪自己的；讀不用登入，一次回整面牆', async () => {
  const { call, docs, calls, tick } = setup();
  assert.equal((await call(put(['r1']), K2)).statusCode, 404);   // 牆還沒發佈
  await call(body());
  assert.deepEqual((await call(put(['r1', 'r2']))).data, { ok: true, results: { r1: 'ok', r2: 'ok' } });
  tick(5);
  assert.deepEqual((await call(put(['r3', 'r1']), K2)).data, { ok: true, results: { r3: 'ok', r1: 'taken' } });   // 別人的 r1 不能動
  assert.deepEqual(Object.keys(docs.get(`wallRoutes/${PID}`).routes).sort(), ['r1', 'r2', 'r3']);
  assert.deepEqual(docs.get(`wallRoutes/${PID}`).routes.r3, { uid: `k:${K2}`, t: NOW + 5, r: route('r3') });
  assert.deepEqual((await call(put(null, ['r2', 'r3']), K2)).data, { ok: true, results: { r2: 'taken', r3: 'ok' } });   // 刪別人的也不行
  assert.deepEqual(Object.keys(docs.get(`wallRoutes/${PID}`).routes).sort(), ['r1', 'r2']);
  const r = (await call({ op: 'routes', pid: PID, kid: K2 })).data;
  assert.deepEqual([r.published, r.routes.map(x => [x.rid, x.mine, x.r])], [true, [['r1', false, route('r1')], ['r2', false, route('r2')]]]);
  assert.deepEqual([r.src, r.ver], [SRC, 1]);   // 牆的畫面在哪、第幾版：讀的人版本變了才重讀岩點
  assert.equal(r.owner, undefined, '沒有擁有者');
  assert.deepEqual((await call({ op: 'routes', pid: 'nowall000001' })).data, { published: false, routes: [] });
  const many = (await call({ op: 'routes', pids: [PID, 'nowall000001'], kid: K1 })).data.walls;   // 一次問好幾面
  assert.deepEqual([many[PID].routes.map(x => x.mine), many.nowall000001.published], [[true, true], false]);
  assert.equal((await call({ op: 'routes', pids: Array(51).fill(PID) })).statusCode, 400);
  assert.equal((await call({ op: 'routes', pids: [] })).statusCode, 400);
  assert.equal((await call({ ...put(['r9']) }, K1)).statusCode, 200);
  assert.equal(calls.filter(c => c[0] === 'refresh').length, 5);   // 發佈、第一個人傳線、第二個人多一條、第二個人刪掉一條、r9 各更新一次找牆面
  const n = calls.length;
  await call(put(['r1']));   // 自己的線改內容：條數沒變，不更新找牆面
  assert.equal(calls.length, n);
});

test('put 的檢查：沒簽章、格式不對、太大、一次太多、牆太滿都拒絕，什麼都不寫；一把金鑰一天有上限', async () => {
  const { call, docs, tick } = setup();
  await call(body());
  const bad = [{ pid: 'x' }, { routes: [] }, { routes: 'x' }, { routes: [{ id: 'A!', r: route('A!') }] }, { routes: [{ id: 'r1', r: 'not json' }] }, { routes: [{ id: 'r1', r: route('other') }] },
    { routes: [{ id: 'r1', r: JSON.stringify({ id: 'r1', holds: { a: 's' } }) }] }, { routes: [{ id: 'r1', r: JSON.stringify({ nodes: [{ id: 'r1', type: 'hold' }], marks: [] }) }] }, { routes: [{ id: 'r1', r: route('r1', { x: 'y'.repeat(25000) }) }] },
    { routes: Array.from({ length: 101 }, (_, i) => ({ id: `r${i}`, r: route(`r${i}`) })) }, { routes: undefined, del: ['A!'] }];
  for (const b of bad) assert.equal((await call({ ...put(['r1']), ...b })).statusCode, 400, JSON.stringify(b).slice(0, 60));
  assert.equal(docs.has(`wallRoutes/${PID}`), false);
  const fill = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`f${i}`, { uid: `k:${K2}`, t: 1, r: route(`f${i}`) }]));
  docs.set(`wallRoutes/${PID}`, { routes: fill });
  assert.equal((await call(put(['new1']))).statusCode, 413);
  assert.equal(Object.keys(docs.get(`wallRoutes/${PID}`).routes).length, 1000);
  docs.delete(`wallRoutes/${PID}`);
  docs.set(`putQuota/${createHash('sha256').update(`k:${K1}`).digest('hex').slice(0, 28)}_${DAY}`, { n: 600 });
  assert.equal((await call(put(['r1']))).statusCode, 429);
  tick(864e5);
  assert.equal((await call(put(['r1']))).statusCode, 200);
});

test('岩館是空的（其他）也能發佈：登記了，要不要列進找牆面由清單決定', async () => {
  const { call, docs } = setup();
  assert.equal((await call(body({ gym: '', training: undefined, n: 1 }))).statusCode, 200);
  assert.equal(docs.get(`shared/${PID}`).gym, '');
});

test('通報失效連結：要 App Check；資料集有這面牆就不動；資料集沒有（索引是殘留）才拿掉索引和所有人的線', async () => {
  const { call, docs, calls, appCheck } = setup();
  await call(body()); docs.set(`wallRoutes/${PID}`, { routes: {} });
  appCheck(false);
  assert.equal((await call({ op: 'report', pid: PID })).statusCode, 401);
  appCheck(true);
  assert.deepEqual((await call({ op: 'report', pid: PID })).data, { removed: false, checked: true });
  docs.delete(`datasets/${PROJECT}`);
  assert.deepEqual((await call({ op: 'report', pid: PID }, K2)).data, { removed: true });
  assert.deepEqual(docs.get(`shared/${PID}`), { name: '牆' });   // 索引欄位拿掉，牆名還在
  assert.equal(docs.has(`wallRoutes/${PID}`), false);   // 所有人的線一起拿掉
  assert.deepEqual(calls.filter(c => c[0] === 'refresh').map(c => c[1]), [PID, PID]);   // 發佈一次、拿掉一次
  assert.deepEqual((await call({ op: 'report', pid: PID })).data, { removed: false });   // 已經沒有索引
  assert.equal((await call({ op: 'report', pid: 'bad' })).statusCode, 400);
});

test('每天把 90 天沒有任何更新的公開牆從找牆面拿掉（資料集留著），其他不動；改線會延後', async () => {
  const { call, docs, db, refreshGym } = setup();
  await call(body()); await call(body({ pid: 'newwall00001' }));
  assert.equal(EXPIRE_MS, 90 * 864e5);
  docs.set('shared/oldwall00001', { name: '舊', gym: '爬森', src: SRC, publishedAt: NOW - EXPIRE_MS - 5, activeAt: NOW - EXPIRE_MS - 5 });
  docs.set('shared/busywall0001', { name: '舊但有人改線', gym: '爬森', src: SRC, publishedAt: NOW - EXPIRE_MS - 5, activeAt: NOW - EXPIRE_MS - 5 });
  assert.deepEqual((await call({ op: 'put', pid: 'busywall0001', routes: [{ id: 'r1', r: route('r1') }] })).data.results, { r1: 'ok' });
  assert.equal(docs.get('shared/busywall0001').activeAt, NOW);
  docs.set('shared/oldroutes0001', { name: '沒有索引' }); docs.set('wallRoutes/oldwall00001', { routes: {} });
  assert.equal(await expire({ db, refreshGym, now: () => NOW }), 1);
  assert.deepEqual(docs.get('shared/oldwall00001'), { name: '舊' });
  assert.equal(docs.has('wallRoutes/oldwall00001'), false);
  assert.ok(docs.get(`shared/${PID}`).src);
  assert.ok(docs.get('shared/busywall0001').src, '有人改線就延後');
  assert.ok(docs.get(`datasets/${PROJECT}`), '資料集的文件留著');
});

test('withdraw：只拿掉自己（這把金鑰）的線，整面牆公開了就收不回；可重複呼叫', async () => {
  const { call, docs } = setup();
  await call(body());
  await call(put(['r1', 'r2'])); await call(put(['r3']), K2);
  assert.deepEqual((await call({ op: 'withdraw', pid: PID }, K2)).data, { ok: true });
  assert.deepEqual(Object.keys(docs.get(`wallRoutes/${PID}`).routes).sort(), ['r1', 'r2']);
  assert.ok(docs.get(`shared/${PID}`).src, '牆還在');
  assert.deepEqual((await call({ op: 'withdraw', pid: PID }, K1)).data, { ok: true });   // 第一個發佈的人也收不回整面牆，只拿掉自己的線
  assert.equal(docs.has(`wallRoutes/${PID}`), false);
  assert.ok(docs.get(`shared/${PID}`).src);
  assert.equal((await call({ op: 'withdraw', pid: PID }, K1)).statusCode, 200);
  assert.equal((await call({ op: 'withdraw', pid: 'x' })).statusCode, 400);
});

test('登記公開牆：包不記擁有者；任何人都能登記、更新；包要存在', async () => {
  const { call, docs } = setup();
  assert.equal((await call(body())).statusCode, 200);
  docs.set('datasets/otherproject0001', { ...PACKAGE, owner: '' });
  assert.equal((await call(body({ src: { project: 'otherproject0001', path: SRC.path } }), K2)).statusCode, 200);   // 別人再登記：指到新的版本
  assert.equal(docs.get(`shared/${PID}`).src.project, 'otherproject0001');
});

test('3D 牆的線：帶 e（修點）也收；e 不是物件、太多顆就拒絕；單條上限放寬到 24000 字', async () => {
  const { call, docs } = setup();
  await call(body());
  const one = (id, extra) => ({ op: 'put', pid: PID, routes: [{ id, r: route(id, extra) }] });
  const m3 = { c: [0, 0, 0, 0, 0, 0, 1], p: [[0, 0], [1, 0], [1, 1]] };
  assert.equal((await call(one('r1', { e: { p1: m3 } }))).statusCode, 200);
  assert.equal(JSON.parse(docs.get(`wallRoutes/${PID}`).routes.r1.r).e.p1.c.length, 7);
  for (const e of ['x', null, [m3], Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`p${i}`, m3]))]) assert.equal((await call(one('r2', { e }))).statusCode, 400);
  assert.equal((await call(one('r3', { pad: 'x'.repeat(20000) }))).statusCode, 200);
  assert.equal((await call(one('r4', { pad: 'x'.repeat(24000) }))).statusCode, 400);
});

test('unpublish：只有維護者身分能下架；拿掉入口和所有人的線，重複呼叫沒事，重新發佈就回來', async () => {
  const { call, docs, calls, asOwner } = setup();
  await call(body());
  docs.set(`wallRoutes/${PID}`, { routes: { r1: { uid: `k:${K1}`, t: 1, r: '{}' } }, t: 1 });
  assert.equal((await call({ op: 'unpublish', pid: PID })).statusCode, 401);   // 不是維護者：拒絕
  assert.ok(docs.get(`shared/${PID}`).src);
  asOwner(true);
  assert.deepEqual((await call({ op: 'unpublish', pid: PID })).data, { removed: true });
  assert.equal(docs.get(`shared/${PID}`).src, undefined);
  assert.equal(docs.has(`wallRoutes/${PID}`), false);
  assert.ok(calls.some(c => c[0] === 'refresh' && c[1] === PID));
  assert.deepEqual((await call({ op: 'unpublish', pid: PID })).data, { removed: false });
  assert.equal((await call(body())).statusCode, 200);   // 重新發佈
  assert.ok(docs.get(`shared/${PID}`).src);
});

test('網站來源身分（內嵌頁 iframe 提交）：同一個網站所有人提交的線都在 o:<來源> 名下，這個網站能更新、刪除自己的全部，別的來源和裝置金鑰動不了', async () => {
  const { call, docs, appCheck } = setup();
  await call(body());
  const A = 'https://gym.example.com', B = 'https://other.example.com';
  const site = (origin, o) => ({ ...put(['s1', 's2']), site: origin, ...o });
  assert.deepEqual((await call(site(A))).data, { ok: true, results: { s1: 'ok', s2: 'ok' } });
  assert.equal(docs.get(`wallRoutes/${PID}`).routes.s1.uid, `o:${A}`);
  assert.deepEqual((await call(site(A))).data.results, { s1: 'ok', s2: 'ok' });   // 同一個網站：更新自己的
  assert.deepEqual((await call(site(B))).data.results, { s1: 'taken', s2: 'taken' });   // 別的網站來源動不了
  assert.deepEqual((await call(put(['s1']), K2)).data.results, { s1: 'taken' });   // 裝置金鑰也不行
  assert.deepEqual((await call({ op: 'put', pid: PID, site: A, del: ['s1'] })).data.results, { s1: 'ok' });   // 這個網站刪自己的
  assert.deepEqual(Object.keys(docs.get(`wallRoutes/${PID}`).routes), ['s2']);
  // 來源不合格、不是 put、沒有 App Check、被擋的來源
  for (const bad of ['null', 'http://evil.com', 'https://a.com/x', 'https://u:p@a.com', '', 5]) assert.equal((await call(site(bad))).data.error, 'bad site', String(bad));
  assert.equal((await call({ op: 'withdraw', pid: PID, site: A })).data.error, 'bad site op');
  appCheck(false);
  assert.equal((await call(site(A))).data.error, 'app check');
  appCheck(true);
  const sha = (await import('node:crypto')).createHash('sha256').update(A).digest('hex').slice(0, 28);
  docs.set(`deviceKeys/site${sha}`, { blocked: true });
  assert.equal((await call(site(A))).statusCode, 403);
  assert.equal((await call(site(B, { routes: [{ id: 's9', r: route('s9') }] }))).statusCode, 200);   // 只擋被封鎖的來源
});

test('公開資料（資料集的 routes.json、index）：每次提交、刪除、收回都馬上寫，條數沒變也寫；寫失敗不影響這次提交；syncPublic 只有維護者', async () => {
  const pubs = [];
  let boom = false;
  const s = setup({ publishRoutes: async (pid) => { pubs.push(pid); if (boom) throw new Error('hub down'); } });
  await s.call(body());
  assert.deepEqual(pubs, [PID]);   // 登記
  assert.equal((await s.call(put(['r1']))).data.results.r1, 'ok');
  assert.equal((await s.call(put(['r1']))).data.results.r1, 'ok');   // 條數沒變（只改內容）
  assert.deepEqual(pubs, [PID, PID, PID]);
  boom = true;
  const failed = await s.call(put(['r2']));
  assert.equal(failed.statusCode, 200);   // Firestore 已經寫了：資料集寫失敗不丟錯
  assert.equal(failed.data.results.r2, 'ok');
  boom = false;
  await s.call({ op: 'withdraw', pid: PID });
  assert.equal(pubs.length, 5);   // 登記、提交 r1 兩次、r2（寫失敗）、收回
  assert.equal((await s.call({ op: 'syncPublic' })).statusCode, 401);
  s.asOwner(true);
  const sync = await s.call({ op: 'syncPublic' });
  assert.deepEqual([sync.statusCode, sync.data.n], [200, 1]);
  assert.equal(pubs.at(-1), PID);
});
