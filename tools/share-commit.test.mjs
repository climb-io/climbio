// App 端的分享（backend/firebase.js）：牆還沒公開時由第一個分享的人把照片和畫面公開到開放資料集一次（沒有擁有者）（雲端函式 datasets）、登記到找牆面（walls），每個人的線一條一條存在 Climbio（walls 的 put）。
// 只檢查實際的後端程式：Drive、雲端函式、發佈模組都是替身，不連正式的服務。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
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
function setup({ replies = () => null, timeout = false } = {}) {
  const calls = [];
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
      const body = JSON.parse(options.body), name = url.slice(FN.length);
      calls.push({ name, auth: options.headers.Authorization, appCheck: options.headers['X-Firebase-AppCheck'], body });
      if (timeout) throw Object.assign(new Error('逾時'), { name: 'TimeoutError' });
      const given = replies(name, body);
      const [status, data] = given || [200, body.op === 'routes' ? { published: false, routes: [] } : body.op === 'put' ? { ok: true, results: Object.fromEntries([...(body.routes || []).map(x => x.id), ...(body.del || [])].map(id => [id, 'ok'])) } : {}];
      return { ok: status < 300, status, json: async () => data };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(sharing + '\nglobalThis.api = { shareRoutes, unshareRoutes, unlistWall, listShared, primeShared };', sandbox);
  return { calls, api: sandbox.api };
}
const body = (o = {}) => ({ signature: '岩友', pid: PID, gym: '原岩明德', wall: '牆', routes: [{ route: { id: 'r1', t: 3 }, k: 'key' }], photo: async () => 'photo',
  base: async () => ({ name: '牆', w: 10, h: 10, thumb: 'data:image/jpeg;base64,AAAA', holds: [{ id: 'h1', poly: [[0, 0], [1, 0], [1, 1]], source: 'detect' }], t: 5 }), ...o });
const ops = s => s.calls.map(c => `${c.name}.${c.body.op}`);
// 這面牆已經公開了
const published = (name, b) => (b.op === 'routes' ? [200, { published: true, routes: [] }] : null);

test('牆還沒公開（手機自己拍的牆）：什麼都不傳，不上傳照片、不登記、不寫線，丟 code: private', async () => {
  const s = setup();
  await assert.rejects(s.api.shareRoutes(body()), { code: 'private' });
  assert.deepEqual(ops(s), ['walls.routes']);   // 只問了這面牆有沒有公開
  assert.ok(s.calls.every(c => c.auth === undefined), '沒有帳號，沒有 Authorization');
});

test('牆已經公開了：不再傳包、不登記，只把自己的線存到 Climbio；之後改線、加線、刪線一次 put；牆名改了也不重發包', async () => {
  const t = setup({ replies: published });
  await t.api.shareRoutes(body());
  assert.deepEqual(ops(t), ['walls.routes', 'walls.put']);
  t.calls.length = 0;
  await t.api.shareRoutes(body({ routes: [{ route: { id: 'r2', t: 4 }, k: 'k2' }], wall: '新牆名' }));
  assert.deepEqual(ops(t), ['walls.routes', 'walls.put']);
  assert.deepEqual(t.calls[1].body.routes.map(x => x.id), ['r2']);
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

test('讀公開牆：一次請求拿整面牆的線；沒有公開了就標 published false；好幾面牆一次問完', async () => {
  const frag = (id, t) => JSON.stringify({ nodes: [{ id, type: 'route', t }], marks: [] });
  const routes = [{ rid: 'r1', mine: true, r: frag('r1', 3), t: 10 }, { rid: 'r2', mine: false, r: frag('r2', 4), t: 9 }, { rid: 'bad', mine: false, r: 'not json', t: 1 }, { rid: 'r3', mine: false, r: frag('other', 1), t: 1 }];
  // 替身的 fetch 沒有 /w/<牆 id>/shared.json 這條 GET（CDN 快取讀取），所以每面牆都退回 POST 一次
  const s = setup({ replies: (name, b) => (b.op === 'routes' ? [200, b.pid === PID ? { published: true, routes } : { published: false, routes: [] }] : null) });
  const got = await s.api.listShared(PID);
  assert.deepEqual(plain(got), [{ rid: 'r1', mine: true, r: '{"id":"r1","t":3}', t: 3 }, { rid: 'r2', mine: false, r: '{"id":"r2","t":4}', t: 4 }]);   // 壞的、路線 id 對不上的略過
  assert.equal(got.published, true);
  assert.deepEqual(s.calls.map(c => [c.body.op, c.body.pid]), [['routes', PID]]);
  s.calls.length = 0;
  await s.api.primeShared([PID, 'otherwall123']);
  assert.equal((await s.api.listShared(PID)).length, 2);
  const none = await s.api.listShared('otherwall123');
  assert.deepEqual([plain(none), none.published], [[], false]);   // 這面牆沒有公開（過期、包不見了）
  assert.deepEqual(s.calls.map(c => [c.body.op, c.body.pid]), [['routes', PID], ['routes', 'otherwall123']]);
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

test('寫自己的線：put 帶裝置金鑰的簽章（公鑰、時間、亂數）；金鑰存起來，之後同一把；讀線時帶 kid 標哪些是自己的', async () => {
  const s = setup({ replies: published });
  const r = await s.api.shareRoutes(body());
  assert.deepEqual(plain(r.results), { r1: { ok: true, made: true } });
  assert.deepEqual(ops(s), ['walls.routes', 'walls.put']);   // 牆已經公開：不碰資料集、不登記
  const first = s.calls[1], a = first.body.auth;
  assert.equal(first.auth, undefined);
  assert.equal(verifyRequest('put', first.body, first.body.auth.ts), first.body.auth.kid);   // App 簽的章，雲端函式（functions/device-key.js）驗得過
  assert.match(a.kid, /^[0-9a-f]{32}$/);
  assert.deepEqual([a.pub.kty, a.pub.crv, a.sig.length, typeof a.ts, /^[A-Za-z0-9_-]{16}$/.test(a.nonce)], ['EC', 'P-256', 86, 'number', true]);
  await s.api.unshareRoutes(PID, ['r1']);
  const second = s.calls[2].body;
  assert.deepEqual([second.op, second.del, second.auth.kid], ['put', ['r1'], a.kid]);   // 同一把金鑰，簽章不同
  assert.notEqual(second.auth.sig, a.sig);
  await s.api.primeShared([PID]);
  assert.equal(s.calls[3].body.kid, a.kid);   // 已經有金鑰：讀線時帶 kid
});
