// App 端的分享（backend/firebase.js）：牆還沒公開時由第一個分享的人把照片和畫面公開到開放資料集一次（沒有擁有者）（雲端函式 datasets）、登記到找牆面（walls），每個人的線一條一條存在 Climbio（walls 的 put）。
// 只檢查實際的後端程式：Drive、雲端函式、發佈模組都是替身，不連正式的服務。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const { verifyRequest } = createRequire(import.meta.url)('../functions/device-key.js');
import AppKit from '../appkit/index.mjs';
const source = readFileSync(new URL('../backend/firebase.js', import.meta.url), 'utf8');
const sharing = source.slice(source.indexOf('  // ---------- 公開牆分享（Climbio 的開放資料集'), source.indexOf('  // 雲端函式的 App Check 權杖'));
const FN = 'https://asia-east1-demo-test.cloudfunctions.net/', PID = 'wall12345678';
const plain = v => JSON.parse(JSON.stringify(v));
const enc = s => new TextEncoder().encode(s);
const store = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };   // 裝置金鑰存在 localStorage

// replies(函式名, body) → [狀態碼, 內容]；沒給就用預設：routes＝還沒有人發佈過、put＝全部成功，其他回 {}。packs：Drive 上已經有的包（packOf 讀到的）
function setup({ replies = () => null, timeout = false, hf = () => null } = {}) {
  const calls = [], hfCalls = [];
  const sandbox = {
    AppKit,
    SITE: { url: 'https://climbio.app' }, FN: name => FN + name, needNet() {}, appCheckToken: async () => 'app-check', localStorage: store(), T: x => x,
    AbortSignal, console, TextEncoder, crypto, Blob, Date, btoa,
    ClimbioFormat: { validate: () => [] },
    // 圖層的片段：每條線一個 route 節點；讀回來的線只帶 id、t
    RouteKit: { routesLayer: ({ routes }) => ({ nodes: routes.map(r => ({ id: r.id, type: 'route', t: r.t || 0 })), marks: [] }),
      fromFormat: (view, [layer]) => ({ routes: layer.nodes.filter(n => n.type === 'route').map(n => ({ id: n.id, t: n.t })) }) },
    // 包的檔案：內容用字串代替（雜湊就是內容）；圖層的內容跟著路線變，其他的跟著牆名變
    ShareTools: { wallPackage: async ({ layerId, pid, name, routes }) => [{ path: 'index.json', bytes: enc(`index:${name}`) }, { path: `${pid}.json`, bytes: enc('view') }, { path: `${pid}.jpg`, bytes: enc('photo') },
        { path: `${layerId}.json`, bytes: enc(`layer:${routes.map(r => r.id)}`) }],
    },
    fetch: async (url, options = {}) => {
      // 公開牆的路線讀資料集的固定網址（index/world.json、walls/<包>/routes.json），不經過雲端函式
      if (url.startsWith('https://huggingface.co/')) { hfCalls.push(url.slice(url.indexOf('/resolve/main/') + 14)); const d = hf(url.slice(url.indexOf('/resolve/main/') + 14)); return d ? { ok: true, status: 200, json: async () => d } : { ok: false, status: 404, json: async () => null }; }
      const body = JSON.parse(options.body), name = url.slice(FN.length);
      calls.push({ name, auth: options.headers.Authorization, appCheck: options.headers['X-Firebase-AppCheck'], body });
      if (timeout) throw Object.assign(new Error('逾時'), { name: 'TimeoutError' });
      const given = replies(name, body);
      const [status, data] = given || [200, body.op === 'routes' ? { published: false, routes: [] } : body.op === 'put' ? { ok: true, results: Object.fromEntries([...(body.routes || []).map(x => x.id), ...(body.del || [])].map(id => [id, 'ok'])) } : {}];
      return { ok: status < 300, status, json: async () => data };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(sharing + '\nglobalThis.api = { shareRoutes, unshareRoutes, unlistWall, listShared, primeShared, routeFragment };', sandbox);
  return { calls, hfCalls, api: sandbox.api };
}
const body = (o = {}) => ({ signature: '岩友', pid: PID, gym: '原岩明德', wall: '牆', routes: [{ route: { id: 'r1', t: 3 }, k: 'key' }], photo: async () => 'photo',
  base: async () => ({ name: '牆', w: 10, h: 10, thumb: 'data:image/jpeg;base64,AAAA', holds: [{ id: 'h1', poly: [[0, 0], [1, 0], [1, 1]], source: 'detect' }], t: 5 }), ...o });
const ops = s => s.calls.map(c => `${c.name}.${c.body.op}`);
// 這面牆已經公開了
const published = (name, b) => (b.op === 'routes' ? [200, { published: true, routes: [] }] : null);

test('牆還沒公開（手機自己拍的牆）：什麼都不傳，不上傳照片、不登記、不寫線，丟 code: private', async () => {
  const s = setup({ replies: (name, b) => (b.op === 'put' ? [404, { error: 'no wall' }] : null) });
  await assert.rejects(s.api.shareRoutes(body()), { code: 'private' });
  assert.deepEqual(ops(s), ['walls.put']);   // 不先問牆有沒有公開（少一次呼叫）：直接傳，伺服器回 404 就是還沒公開
  assert.ok(s.calls.every(c => c.auth === undefined), '沒有帳號，沒有 Authorization');
});

test('牆已經公開了：不再傳包、不登記，只把自己的線存到 Climbio；之後改線、加線、刪線一次 put；牆名改了也不重發包', async () => {
  const t = setup({ replies: published });
  await t.api.shareRoutes(body());
  assert.deepEqual(ops(t), ['walls.put']);
  t.calls.length = 0;
  await t.api.shareRoutes(body({ routes: [{ route: { id: 'r2', t: 4 }, k: 'k2' }], wall: '新牆名' }));
  assert.deepEqual(ops(t), ['walls.put']);
  assert.deepEqual(t.calls[0].body.routes.map(x => x.id), ['r2']);
  t.calls.length = 0;
  assert.deepEqual(plain(await t.api.unshareRoutes(PID, ['r1', 'r2'])), { results: { r1: 'ok', r2: 'ok' } });
  assert.deepEqual(plain(t.calls.map(c => [c.body.op, c.body.del])), [['put', ['r1', 'r2']]]);
  const taken = setup({ replies: (name, b) => (b.op === 'put' ? [200, { ok: true, results: { r1: 'taken' } }] : published(name, b)) });
  assert.deepEqual(plain((await taken.api.shareRoutes(body())).results), { r1: { ok: false, error: 'taken' } });   // 路線 id 被別人用了
});

test('伺服器說的原因直接回給 App：暫停上傳、每天上限、逾時', async () => {
  await assert.rejects(setup({ replies: () => [503, { error: 'uploads paused' }] }).api.shareRoutes(body()), { message: 'uploads paused', code: 'quota' });
  await assert.rejects(setup({ replies: (n, b) => (b.op === 'put' ? [429, { error: 'daily limit' }] : published(n, b)) }).api.shareRoutes(body()), { message: 'shareQuota', code: 'quota', status: 429 });
  await assert.rejects(setup({ timeout: true }).api.shareRoutes(body()), { code: 'timeout' });
});

test('讀公開牆：進 App 讀一個 index，有路線才讀 routes.json（資料集的固定網址）；沒有公開了就標 published false；好幾面牆共用同一份 index', async () => {
  const node = (id, t, u) => ({ id, type: 'route', t, props: { u } });
  const layer = { climbio: 2, kind: 'layer', on: PID, nodes: [node('r1', 3, 'aaaa'), node('r2', 4, 'bbbb')], marks: [] };
  const index = { walls: [{ id: `packpack00000001/${PID}`, name: '牆', gym: 'G', v: 7, rt: 4, n: 2, t: 4 }, { id: 'packpack00000002/emptywall123', name: '空', gym: 'G', v: 1, rt: 0, n: 0, t: 1 }] };
  const s = setup({ hf: (path) => (path === 'index/world.json' ? index : path === 'walls/packpack00000001/routes.json' ? layer : null) });
  const got = await s.api.listShared(PID);
  assert.deepEqual(plain(got), [{ rid: 'r2', mine: false, r: '{"id":"r2","t":4}', t: 4 }, { rid: 'r1', mine: false, r: '{"id":"r1","t":3}', t: 3 }]);   // 新的在前
  assert.deepEqual([got.published, got.ver, plain(got.src)], [true, 7, { project: 'packpack00000001', path: `${PID}.json` }]);
  assert.deepEqual(s.hfCalls, ['index/world.json', 'walls/packpack00000001/routes.json']);   // 兩個請求，沒有呼叫函式
  assert.deepEqual(s.calls, []);
  s.hfCalls.length = 0;
  await s.api.primeShared([PID, 'emptywall123', 'otherwall123']);   // 手動重新整理才重讀 index：只讀一次，三面牆共用
  assert.equal((await s.api.listShared(PID)).length, 2);
  const empty = await s.api.listShared('emptywall123');
  assert.deepEqual([plain(empty), empty.published], [[], true]);   // 公開但還沒有路線：不用讀 routes.json
  const none = await s.api.listShared('otherwall123');
  assert.deepEqual([plain(none), none.published], [[], false]);   // 這面牆沒有公開（收回、過期、包不見了）
  assert.deepEqual(s.hfCalls, ['index/world.json', 'walls/packpack00000001/routes.json']);
  assert.deepEqual(s.calls, []);
});

test('3D 牆的路線：index 的 m3d 那一行，routes.json 是原樣的片段（帶修點 e），讀路線、短連結讀單條片段都不經過函式', async () => {
  const frag = (id, t) => JSON.stringify({ nodes: [{ id, type: 'route', t }], marks: [], e: { h1: { c: 1 } } });
  const file = { climbio: 2, kind: 'routes', wall: PID, t: 9, routes: [{ id: 'r2', t: 9, u: 'bbbb', r: frag('r2', 9) }, { id: 'r1', t: 3, u: 'aaaa', r: frag('r1', 3) }, { id: 'bad', t: 1, u: 'cccc', r: 'not json' }] };
  const index = { walls: [{ id: `${PID}${PID.slice(0, 4)}/${PID}`.replace(/^.{16}/, 'pack3d0000000001'), name: '3D', gym: 'G', v: 0, rt: 9, n: 3, t: 9, m3d: 1, base: 'b' }] };
  const s = setup({ hf: (path) => (path === 'index/world.json' ? index : path === 'walls/pack3d0000000001/routes.json' ? file : null) });
  const got = await s.api.listShared(PID);
  assert.deepEqual(plain(got.map(x => [x.rid, x.mine, x.t])), [['r2', false, 9], ['r1', false, 3]]);   // 壞的略過，新的在前
  assert.deepEqual([got.published, plain(got.src)], [true, { project: 'pack3d0000000001', path: 'index.json' }]);
  assert.deepEqual(plain(await s.api.routeFragment(PID, 'r1')), { nodes: [{ id: 'r1', type: 'route', t: 3 }], marks: [], e: { h1: { c: 1 } } });   // 修點 e 原樣
  assert.equal(await s.api.routeFragment(PID, 'nope'), null);
  assert.deepEqual(s.calls, []);
});

test('收回：只拿掉自己（這把金鑰）寫的線，整面牆公開了就收不回；沒有金鑰就什麼都不送', async () => {
  const s = setup({ replies: published });
  await s.api.unlistWall(PID);
  assert.deepEqual(s.calls, [], '還沒寫過線、沒有金鑰');
  await s.api.shareRoutes(body());
  s.calls.length = 0;
  await s.api.unlistWall(PID);
  assert.deepEqual(s.calls.map(c => [c.name, c.body.op, c.body.pid]), [['walls', 'withdraw', PID]]);
});

test('寫自己的線：put 帶裝置金鑰的簽章（公鑰、時間、亂數）；金鑰存起來，之後同一把；讀線時用 props.u 標哪些是自己的', async () => {
  let layer = null;   // 金鑰產生之後才知道自己的雜湊
  const s = setup({ replies: published, hf: (path) => (path === 'index/world.json' ? { walls: [{ id: `packpack00000001/${PID}`, name: '牆', gym: 'G', v: 1, rt: 3, n: 2, t: 3 }] } : layer) });
  const r = await s.api.shareRoutes(body());
  assert.deepEqual(plain(r.results), { r1: { ok: true, made: true } });
  assert.deepEqual(ops(s), ['walls.put']);   // 牆已經公開：不碰資料集、不登記、不先問
  const first = s.calls[0], a = first.body.auth;
  assert.equal(first.auth, undefined);
  assert.equal(verifyRequest('put', first.body, first.body.auth.ts), first.body.auth.kid);   // App 簽的章，雲端函式（functions/device-key.js）驗得過
  assert.match(a.kid, /^[0-9a-f]{32}$/);
  assert.deepEqual([a.pub.kty, a.pub.crv, a.sig.length, typeof a.ts, /^[A-Za-z0-9_-]{16}$/.test(a.nonce)], ['EC', 'P-256', 86, 'number', true]);
  await s.api.unshareRoutes(PID, ['r1']);
  const second = s.calls[1].body;
  assert.deepEqual([second.op, second.del, second.auth.kid], ['put', ['r1'], a.kid]);   // 同一把金鑰，簽章不同
  assert.notEqual(second.auth.sig, a.sig);
  // 讀線不用帶 kid、不用簽章：圖層裡每條線的 props.u 是作者雜湊前 16 碼，跟自己金鑰算的一樣就是自己的
  const u = createHash('sha256').update(`k:${a.kid}`).digest('hex').slice(0, 16);
  layer = { climbio: 2, kind: 'layer', on: PID, nodes: [{ id: 'r1', type: 'route', t: 3, props: { u } }, { id: 'r2', type: 'route', t: 2, props: { u: 'someoneelse0000' } }], marks: [] };
  const mine = await s.api.listShared(PID);
  assert.deepEqual(plain(mine.map(x => [x.rid, x.mine])), [['r1', true], ['r2', false]]);   // 雜湊對得上的是自己的
});
