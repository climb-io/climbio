// 內嵌頁 v2 的共用層：能力宣告、請求／回覆（requestId、sessionId、逾時、取消、遲到與重複）、自備資料網址、候選外框驗證、v2 訊息外框
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { RouteKit } from './routekit.mjs';

const E = createRequire(import.meta.url)('../embed/shared/embed.js');
test.afterEach(() => mock.timers.reset());

test('capabilities：未宣告＝沒有；只收 holdEdit／refine／wallEdit', () => {
  assert.equal(E.capsOf(undefined).size, 0);
  assert.deepEqual([...E.capsOf(['refine', 'holdEdit'])], ['refine', 'holdEdit']);
  assert.throws(() => E.capsOf(['fly']), /capabilities/);
  assert.throws(() => E.capsOf('refine'), /capabilities/);
});
const rig = (o = {}) => { const sent = []; let n = 0; return { sent, r: E.createRequests({ send: (t, d) => sent.push([t, d]), newId: () => `id${++n}`, ...o }) }; };
test('請求／回覆：帶 requestId、sessionId；當前回覆成功，重複回覆忽略', async () => {
  const { sent, r } = rig(); const q = r.begin('refineHold', { holdId: 'a' });
  assert.deepEqual(sent[0], ['refineHold', { holdId: 'a', requestId: q.requestId, sessionId: r.sessionId }]);
  assert.equal(r.settle({ requestId: q.requestId, sessionId: r.sessionId, result: [1] }), true);
  assert.deepEqual(await q.result, [1]);
  assert.equal(r.settle({ requestId: q.requestId, sessionId: r.sessionId, result: [2] }), false);
  assert.equal(r.size, 0);
});
test('請求／回覆：錯的 requestId、錯的 sessionId、沒有等待中的請求都忽略；error 回覆讓請求失敗', async () => {
  const { r } = rig(); const q = r.begin('holdEditCommit');
  assert.equal(r.settle({ requestId: 'nope', sessionId: r.sessionId, result: 1 }), false);
  assert.equal(r.settle({ requestId: q.requestId, sessionId: 'other', result: 1 }), false);
  assert.equal(r.settle(null), false);
  assert.equal(r.size, 1);
  r.settle({ requestId: q.requestId, sessionId: r.sessionId, error: '拒絕' });
  await assert.rejects(q.result, /拒絕/);
});
test('換牆或換線：newSession 取消等待中的請求，遲到的舊回覆被忽略；signal 被 abort', async () => {
  const { r } = rig(); const q = r.begin('refineHold'), old = r.sessionId;
  r.newSession();
  await assert.rejects(q.result, /換了牆或路線/);
  assert.equal(q.signal.aborted, true);
  assert.equal(r.settle({ requestId: q.requestId, sessionId: old, result: 1 }), false);
  assert.notEqual(r.sessionId, old);
});
test('逾時有上限：到時間失敗並 abort；超大的 timeoutMs 被夾到 60 秒', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const { r } = rig({ timeoutMs: 1e9 }); const q = r.begin('refineHold');
  const done = assert.rejects(q.result, /逾時/);
  mock.timers.tick(59999); assert.equal(r.size, 1);
  mock.timers.tick(1); await done; assert.equal(q.signal.aborted, true); assert.equal(r.size, 0);
});
test('cancel／cancelAll：清掉等待狀態', async () => {
  const { r } = rig(); const a = r.begin('x'), b = r.begin('y');
  r.cancel(a.requestId); await assert.rejects(a.result, /已取消/);
  r.cancelAll(); await assert.rejects(b.result, /已取消/); assert.equal(r.size, 0);
});
test('自備資料網址：只收 https、沒有帳密；相對網址依 base 補齊；其他協定一律拒絕', () => {
  assert.equal(E.urlV2('https://cdn.example.com/w.json', 'viewUrl'), 'https://cdn.example.com/w.json');
  assert.equal(E.urlV2('w.json', 'viewUrl', 'https://gym.example/app/'), 'https://gym.example/app/w.json');
  for (const bad of ['http://a.com/x', 'javascript:alert(1)', 'data:text/plain,hi', 'blob:https://a.com/1', 'https://u:p@a.com/x', 'ftp://a.com/x', 'x']) assert.throws(() => E.urlV2(bad, 'viewUrl'), /viewUrl/, bad);
});
const res = (o) => ({ ok: true, status: 200, url: 'https://a.com/x', headers: { get: (k) => ({ 'content-length': o.len, 'content-type': 'application/json' })[k] }, arrayBuffer: async () => o.buf || new ArrayBuffer(4), ...o });
test('fetchV2：不帶 cookie、不送 referrer；重導到不安全網址、太大、HTTP 錯誤、網路錯誤都失敗', async () => {
  let opts; const ok = await E.fetchV2('https://a.com/x', 'viewUrl', 100, { f: async (u, o) => { opts = o; return res({}); } });
  assert.equal(ok.buf.byteLength, 4); assert.equal(opts.credentials, 'omit'); assert.equal(opts.referrerPolicy, 'no-referrer');
  await assert.rejects(E.fetchV2('https://a.com/x', 'viewUrl', 100, { f: async () => res({ url: 'http://evil.com/x' }) }), /重導後/);
  await assert.rejects(E.fetchV2('https://a.com/x', 'viewUrl', 100, { f: async () => res({ url: 'https://u:p@evil.com/x' }) }), /重導後/);
  await assert.rejects(E.fetchV2('https://a.com/x', 'viewUrl', 100, { f: async () => res({ len: '101' }) }), /太大/);
  await assert.rejects(E.fetchV2('https://a.com/x', 'viewUrl', 3, { f: async () => res({}) }), /太大/);
  await assert.rejects(E.fetchV2('https://a.com/x', 'viewUrl', 100, { f: async () => res({ ok: false, status: 500 }) }), /HTTP 500/);
  await assert.rejects(E.fetchV2('https://a.com/x', 'viewUrl', 100, { f: async () => { throw new Error('net'); } }), /CORS/);
  await assert.rejects(E.fetchV2('http://a.com/x', 'viewUrl', 100, { f: async () => res({}) }), /https/);
});
test('候選外框驗證：合法通過並四捨五入；NaN、超出照片、頂點太少或太多、太小、佔滿整張都拒絕', () => {
  const C = RouteKit.candidatePoly, sq = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
  assert.deepEqual(C([[10.04, 10], [50, 10], [50, 50.06]], 100, 100), [[10, 10], [50, 10], [50, 50.1]]);
  assert.equal(C(sq(10, 10, 20), 100, 100) !== null, true);
  assert.equal(C([[10, 10], [NaN, 10], [50, 50]], 100, 100), null);
  assert.equal(C([[10, 10], [Infinity, 10], [50, 50]], 100, 100), null);
  assert.equal(C(sq(90, 90, 20), 100, 100), null);
  assert.equal(C(sq(-1, 0, 20), 100, 100), null);
  assert.equal(C([[1, 1], [9, 9]], 100, 100), null);
  assert.equal(C(Array.from({ length: 201 }, (_, i) => [i % 90, (i * 7) % 90]), 100, 100), null);
  assert.equal(C(sq(10, 10, 2), 100, 100), null);
  assert.equal(C(sq(0, 0, 100), 100, 100), null);
  assert.equal(C('x', 100, 100), null);
  assert.equal(C([['a', 1], [2, 3], [4, 5]], 100, 100), null);
});
test('v2 訊息外框：connect 用 v:2；v1 訊息被忽略，v2 訊息才處理；來源固定在第一個 init', async () => {
  const L = {}, sent = [], parent = { postMessage: (m, o) => sent.push([m, o]) };
  const win = { parent, addEventListener: (t, f) => { L[t] = f; } };
  const seen = []; E.connect({ kit: 'routekit', v: 2, handlers: { init: () => seen.push('init'), ping: () => seen.push('ping') }, win, parent });
  assert.deepEqual(sent[0], [{ climbio: 'routekit', v: 2, type: 'ready' }, '*']);
  const msg = (v, type, origin = 'https://gym.example', source = parent) => L.message({ source, origin, data: { climbio: 'routekit', v, type } });
  msg(1, 'init'); msg(2, 'init', 'https://gym.example', {}); await Promise.resolve();
  assert.deepEqual(seen, []);
  msg(2, 'init'); msg(2, 'ping', 'https://evil.example'); msg(2, 'ping'); await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(seen, ['init', 'ping']);
});

test('請求回覆的種類要對：requestId 對得上但 type 不符也忽略', async () => {
  const { r } = rig(); const q = r.begin('refineHold');
  assert.equal(r.settle({ requestId: q.requestId, sessionId: r.sessionId, result: 1 }, 'holdEditCommit'), false);
  assert.equal(r.settle({ requestId: q.requestId, sessionId: r.sessionId, result: 1 }, 'refineHold'), true);
  assert.equal(await q.result, 1);
});
const png = Buffer.from('iVBORw0KGgo=', 'base64').toString('base64');
test('resolveInitV2：自備物件＋Blob；每項只能一種給法', async () => {
  const photo = new Blob([new Uint8Array(3)]), view = { kind: 'view' };
  const r = await E.resolveInitV2({ view, layers: [{ kind: 'layer' }], photo });
  assert.deepEqual([r.view, r.layers.length, r.photo === photo], [view, 1, true]);
  assert.deepEqual((await E.resolveInitV2({ view, photo })).layers, []);
  await assert.rejects(E.resolveInitV2({ view, viewUrl: 'https://a.com/v', photo }), /畫面/);
  await assert.rejects(E.resolveInitV2({ view }), /照片/);
  await assert.rejects(E.resolveInitV2({ view, photo, layers: [], layerUrls: [] }), /layers、layerUrls/);
  await assert.rejects(E.resolveInitV2({ view: 'x', photo }), /view 要是物件/);
  await assert.rejects(E.resolveInitV2({ view, photo, layers: 'x' }), /陣列/);
  await assert.rejects(E.resolveInitV2({ view, photo, layers: Array(51).fill({}) }), /最多 50/);
});
test('resolveInitV2：photoBase64 要有合法 photoType、合法 base64、不超過上限', async () => {
  const view = {};
  const ok = await E.resolveInitV2({ view, photoBase64: png, photoType: 'image/png' });
  assert.equal(ok.photo.type, 'image/png'); assert.equal(ok.photo.size, 8);
  await assert.rejects(E.resolveInitV2({ view, photoBase64: png, photoType: 'image/svg+xml' }), /photoType/);
  await assert.rejects(E.resolveInitV2({ view, photoBase64: 'not base64!', photoType: 'image/png' }), /base64/);
  await assert.rejects(E.resolveInitV2({ view, photoBase64: 'A'.repeat(14 * 1048576), photoType: 'image/png' }), /10 MB/);
});
test('resolveInitV2：網址讀取走 fetchV2（https、相對網址補 base、非 https 整個不讀）', async () => {
  const urls = [], f = async (u) => { urls.push(u); return res({ buf: new TextEncoder().encode(u.endsWith('.json') ? '{"a":1}' : 'jpg').buffer, url: u }); };
  const r = await E.resolveInitV2({ viewUrl: 'v.json', layerUrls: ['l.json'], photoUrl: 'p.jpg' }, { f, base: 'https://gym.example/app/' });
  assert.deepEqual(urls.sort(), ['https://gym.example/app/l.json', 'https://gym.example/app/p.jpg', 'https://gym.example/app/v.json']);
  assert.deepEqual([r.view, r.layers, r.photo.size], [{ a: 1 }, [{ a: 1 }], 3]);
  urls.length = 0;
  await assert.rejects(E.resolveInitV2({ viewUrl: 'https://a.com/v.json', layerUrls: ['http://a.com/l.json'], photoUrl: 'https://a.com/p.jpg' }, { f }), /layerUrls\[0\]/);
  assert.deepEqual(urls, []);
});
