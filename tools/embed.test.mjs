import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { outputs } from './build-embed.mjs';
import { readFileSync, existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { connect, decodePhoto, fullscreen, resolveInit, dataUrl } = require('../embed/shared/embed.js');

// 內嵌頁共用的訊息外框（embed/shared/embed.js）：只收父視窗、第一個一定是 init、之後只收發 init 的來源
function setup(handlers) {
  const listeners = [], sent = [], parent = { postMessage: (m, origin) => sent.push({ m, origin }) };
  const win = { addEventListener: (t, f) => t === 'message' && listeners.push(f), parent };
  const api = connect({ kit: 'routekit', handlers, win });
  const post = (data, { source = parent, origin = 'https://gym.example' } = {}) => { for (const f of listeners) f({ data, source, origin }); };
  return { api, sent, post, parent };
}
const msg = (type, more = {}) => ({ climbio: 'routekit', v: 1, type, ...more });
const tick = () => new Promise((r) => setTimeout(r, 0));

test('載入後送 ready（還不知道來源，用 *）；init 之前不送別的', () => {
  const { api, sent } = setup({});
  assert.deepEqual(sent, [{ m: { climbio: 'routekit', v: 1, type: 'ready' }, origin: '*' }]);
  api.send('change', { layer: {} });
  assert.equal(sent.length, 1);
});

test('第一個訊息一定是 init；不是父視窗、不是這個 Kit、版本不對的都不理', async () => {
  const seen = [], { post, api } = setup({ init: (m) => seen.push(['init', m.n]), setType: (m) => seen.push(['setType', m.holdType]) });
  post(msg('setType', { holdType: 's' }));                                 // 還沒 init
  post(msg('init', { n: 1 }), { source: {} });                           // 不是父視窗
  post({ ...msg('init', { n: 2 }), climbio: 'topokit' });                // 別的 Kit
  post({ ...msg('init', { n: 3 }), v: 2 });                              // 版本不對
  await tick();
  assert.deepEqual(seen, []);
  assert.equal(api.origin, null);
  post(msg('init', { n: 4 }));
  await tick();
  assert.deepEqual(seen, [['init', 4]]);
  assert.equal(api.origin, 'https://gym.example');
});

test('init 之後只收發第一個 init 的來源：別的來源的訊息不理，回傳只送給那個來源', async () => {
  const seen = [], { post, api, sent } = setup({ init: () => seen.push('init'), setType: (m) => seen.push(m.holdType) });
  post(msg('init'));
  post(msg('setType', { holdType: 'h' }), { origin: 'https://evil.example' });
  post(msg('setType', { holdType: 't' }));
  await tick();
  assert.deepEqual(seen, ['init', 't']);
  api.send('change', { layer: { a: 1 } });
  assert.deepEqual(sent.at(-1), { m: { climbio: 'routekit', v: 1, type: 'change', layer: { a: 1 } }, origin: 'https://gym.example' });
});

test('處理訊息時丟出的錯誤送 error 給外層；沒有這種處理器的訊息不理', async () => {
  const { post, sent } = setup({ init: () => { throw new Error('壞資料'); } });
  post(msg('init'));
  post(msg('unknown'));
  await tick();
  assert.deepEqual(sent.at(-1).m, { climbio: 'routekit', v: 1, type: 'error', message: '壞資料' });
  assert.equal(sent.length, 2);   // ready 和 error，沒有為 unknown 回任何東西
});

test('來源是 null（sandbox、file:）時回傳用 *，不丟錯', async () => {
  const { post, api, sent } = setup({ init() {} });
  post(msg('init'), { origin: 'null' });
  await tick();
  api.send('change', {});
  assert.equal(sent.at(-1).origin, '*');
});

test('照片：不是 Blob 或超過 10 MB 都拒絕；不是圖片解碼不了', async () => {
  await assert.rejects(decodePhoto(42), /要是 Blob/);
  await assert.rejects(decodePhoto('data:image/png;base64,AAAA'), /要是 Blob/);
  await assert.rejects(decodePhoto(new Blob([new Uint8Array(10 * 1024 * 1024 + 1)])), /10 MB/);
  await assert.rejects(decodePhoto(new Blob([new Uint8Array([1, 2, 3])])), /不是可解碼的圖片|createImageBitmap/);
});

// 資料只有一種來源：官方網址（climbio.app 的 /p/、/w/、/r/，Hugging Face 的 climbio/walls），外層用 init 給 viewUrl、photoUrl、layerUrls
const V = 'https://climbio.app/p/pack/wall.json', P = 'https://huggingface.co/datasets/climbio/walls/resolve/main/walls/pack/v1/wall.jpg';
const L1 = 'https://climbio.app/w/wall/routes.json', L2 = 'https://climbio.app/r/wall/r1/route.json';
const fakeFetch = (files, calls = []) => async (url, opt) => {
  calls.push({ url, opt });
  const f = files[url];
  if (!f) return { ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
  const body = typeof f === 'string' ? new TextEncoder().encode(f) : f;
  return { ok: true, status: 200, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? (typeof f === 'string' ? 'application/json' : 'image/jpeg') : null) }, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
};
test('init 的資料：只讀 viewUrl、layerUrls、photoUrl 這幾個官方網址，不帶 cookie、不送來源網址', async () => {
  const calls = [], files = { [V]: '{"id":"v"}', [L1]: '{"id":"l1"}', [L2]: '{"id":"l2"}', [P]: new Uint8Array([1, 2, 3]) };
  const out = await resolveInit({ viewUrl: V, layerUrls: [L1, L2], photoUrl: P }, fakeFetch(files, calls));
  assert.deepEqual([out.view.id, out.layers.map((l) => l.id), out.photo.size, out.photo.type], ['v', ['l1', 'l2'], 3, 'image/jpeg']);
  assert.deepEqual(calls.map((c) => c.url).sort(), [L1, L2, P, V].sort());
  for (const c of calls) assert.deepEqual([c.opt.credentials, c.opt.referrerPolicy], ['omit', 'no-referrer']);
});
test('init 的資料：layerUrls 可以不給（沒有路線圖層）', async () => {
  const out = await resolveInit({ viewUrl: V, photoUrl: P }, fakeFetch({ [V]: '{"id":"v"}', [P]: new Uint8Array([1]) }));
  assert.deepEqual(out.layers, []);
});
test('init 的資料：只給 wallId，網址由內嵌頁補（照片走 /p/ 導向現行版）；牆還沒有路線也能讀；明確給的網址優先', async () => {
  const W = '0123456789abcdef/wall12345678', calls = [];
  const VW = `https://climbio.app/p/${W}.json`, PW = `https://climbio.app/p/${W}.jpg`, LW = 'https://climbio.app/w/wall12345678/routes.json';
  const files = { [VW]: '{"id":"v"}', [PW]: new Uint8Array([1]), [LW]: '{"id":"l"}' };
  assert.deepEqual((await resolveInit({ wallId: W }, fakeFetch(files, calls))).layers.map((l) => l.id), ['l']);
  assert.deepEqual(calls.map((c) => c.url).sort(), [LW, PW, VW].sort());
  assert.deepEqual((await resolveInit({ wallId: W }, fakeFetch({ [VW]: '{"id":"v"}', [PW]: new Uint8Array([1]) }))).layers, []);
  assert.deepEqual((await resolveInit({ wallId: W, layerUrls: [] }, fakeFetch(files))).layers, []);
  await assert.rejects(resolveInit({ wallId: W, layerUrls: [L1] }, fakeFetch({ [VW]: '{}', [PW]: new Uint8Array([1]) })), /layerUrls\[0\]/);
  await assert.rejects(resolveInit({ wallId: '../x' }, fakeFetch({})), /wallId/);
});
test('init 的資料：訊息直接帶的 view、layers、photo 不收，一定要給網址', async () => {
  await assert.rejects(resolveInit({ view: { id: 'v' }, layers: [], photo: new Blob([]) }, fakeFetch({})), /viewUrl/);
  await assert.rejects(resolveInit({ viewUrl: V, photo: new Blob([]) }, fakeFetch({ [V]: '{}' })), /photoUrl/);
});
test('init 的資料：只收官方網址——別的主機、http、帶帳號或埠號、官方主機上別的路徑、file:、javascript:、blob:、data:、相對網址都擋，而且不讀', async () => {
  const calls = [], f = fakeFetch({}, calls);
  for (const bad of ['https://example.com/p.jpg', 'http://climbio.app/p/x/y.json', 'https://evil.climbio.app/p/x/y.json', 'https://climbio.app.evil.example/p/x/y.json',
    'https://user@climbio.app/p/x/y.json', 'https://climbio.app:8443/p/x/y.json', 'https://climbio.app/studio/', 'https://climbio.app/',
    'https://huggingface.co/datasets/other/data/resolve/main/a.jpg', 'https://huggingface.co/datasets/climbio/walls-evil/a.jpg',
    'file:///etc/passwd', 'javascript:alert(1)', 'blob:https://climbio.app/uuid', 'data:image/png;base64,AAAA'])
    await assert.rejects(resolveInit({ viewUrl: bad, photoUrl: P }, f), /只收Climbio 官方的網址/, bad);
  await assert.rejects(resolveInit({ viewUrl: '/p/x/y.json', photoUrl: P }, f), /完整的網址/);
  assert.equal(calls.length, 0);
  for (const ok of [V, P, L1, L2]) assert.equal(dataUrl(ok, 'x'), ok);
});
test('init 的資料：讀不到、太大、不是 JSON、layerUrls 不是陣列都丟明確的錯', async () => {
  await assert.rejects(resolveInit({ viewUrl: V, photoUrl: P }, fakeFetch({})), /HTTP 404/);
  await assert.rejects(resolveInit({ viewUrl: V, photoUrl: P }, async () => { throw new TypeError('Failed to fetch'); }), /讀不到/);
  await assert.rejects(resolveInit({ viewUrl: V, photoUrl: P }, fakeFetch({ [V]: 'not json', [P]: new Uint8Array([1]) })), /不是 JSON/);
  await assert.rejects(resolveInit({ viewUrl: V, photoUrl: P }, fakeFetch({ [V]: '{}', [P]: new Uint8Array(10 * 1024 * 1024 + 1) })), /太大/);
  await assert.rejects(resolveInit({ viewUrl: V, photoUrl: P, layerUrls: L1 }, fakeFetch({})), /陣列/);
});

// 原生 App 的 WebView：沒有父視窗，往原生橋接送；原生端用 window.postMessage（JSON 字串）或 climbioReceive 傳進來
function native(bridge = {}) {
  const listeners = [], win = { ...bridge, addEventListener: (t, f) => t === 'message' && listeners.push(f) };
  win.parent = win;
  return { win, post: (data) => { for (const f of listeners) f({ data, source: win, origin: 'null' }); } };
}

test('原生 WebView：ready 送到橋接（ReactNativeWebView 是 JSON 字串）；init 之前不送別的', async () => {
  const sent = [], { win, post } = native({ ReactNativeWebView: { postMessage: (s) => sent.push(JSON.parse(s)) } });
  const api = connect({ kit: 'routekit', handlers: { init() {} }, win });
  assert.deepEqual(sent, [msg('ready')]);
  api.send('change', { layer: {} });
  assert.equal(sent.length, 1);
  post(JSON.stringify(msg('init')));
  await tick();
  api.send('change', { layer: { a: 1 } });
  assert.deepEqual(sent.at(-1), msg('change', { layer: { a: 1 } }));
});

test('原生 WebView：各平台的橋接都找得到（iOS、Android、Flutter），訊息可用物件、字串或 climbioReceive 傳進來', async () => {
  const seen = [];
  const ios = [], a = native({ webkit: { messageHandlers: { climbio: { postMessage: (m) => ios.push(m) } } } });
  connect({ kit: 'routekit', handlers: { init: (m) => seen.push(['ios', m.n]) }, win: a.win });
  assert.deepEqual(ios, [msg('ready')]);
  a.post(msg('init', { n: 1 })); await tick();
  const android = [], b = native({ ClimbioBridge: { postMessage: (s) => android.push(JSON.parse(s)) } });
  connect({ kit: 'routekit', handlers: { init: (m) => seen.push(['android', m.n]) }, win: b.win });
  assert.deepEqual(android, [msg('ready')]);
  b.win.climbioReceive(JSON.stringify(msg('init', { n: 2 }))); await tick();
  const flutter = [], c = native({ flutter_inappwebview: { callHandler: (name, m) => flutter.push([name, m]) } });
  connect({ kit: 'routekit', handlers: { init: (m) => seen.push(['flutter', m.n]) }, win: c.win });
  assert.deepEqual(flutter, [['climbio', msg('ready')]]);
  c.win.climbioReceive(msg('init', { n: 3 })); await tick();
  assert.deepEqual(seen, [['ios', 1], ['android', 2], ['flutter', 3]]);
});

test('原生 WebView：不是這個 Kit、版本不對、不是 init 開頭的、壞 JSON 都不理', async () => {
  const seen = [], { win, post } = native({ ClimbioBridge: { postMessage() {} } });
  connect({ kit: 'routekit', handlers: { init: () => seen.push('init'), setType: () => seen.push('setType') }, win });
  post('不是 JSON'); post(JSON.stringify({ ...msg('init'), climbio: 'topokit' })); post(JSON.stringify({ ...msg('init'), v: 2 })); post(JSON.stringify(msg('setType')));
  await tick();
  assert.deepEqual(seen, []);
  post(JSON.stringify(msg('init'))); post(JSON.stringify(msg('setType')));
  await tick();
  assert.deepEqual(seen, ['init', 'setType']);
});

test('iframe：非協定訊息（沒有 climbio、版本不對）就算來自父視窗也不會讓來源被記下', async () => {
  const seen = [], { api, post } = setup({ init: () => seen.push('init') });
  post({ type: 'init' });                                                  // 沒有外框
  post({ climbio: 'routekit', v: 2, type: 'init' });                       // 版本不對
  await tick();
  assert.equal(api.origin, null);
  post(msg('init'), { origin: 'https://gym.example' });
  await tick();
  assert.deepEqual([api.origin, seen], ['https://gym.example', ['init']]);
});

test('全畫面：沒有瀏覽器的全畫面支援（或被拒絕）就送 fullscreen 給外層；外層用 setFullscreen 回報，沒回應 0.7 秒後原地互動', async () => {
  const sent = [], states = [], f = fullscreen({ el: {}, send: (t, d) => sent.push([t, d]), onChange: (v) => states.push(v), doc: null });
  await f.toggle();
  assert.deepEqual([f.on, sent.at(-1)], [false, ['fullscreen', { on: true }]]);   // 還在等外層
  f.set(true);                                                                     // 外層放大了，回報
  assert.deepEqual([f.on, states], [true, [true]]);
  await f.toggle();
  f.set(false);                                                                    // 外層縮回
  assert.deepEqual([f.on, sent.at(-1), states], [false, ['fullscreen', { on: false }], [true, false]]);
  await f.toggle();                                                                // 外層不理：0.7 秒後原地互動
  await new Promise((r) => setTimeout(r, 800));
  assert.deepEqual([f.on, states.at(-1)], [true, true]);
});

test('內嵌頁的 kit/ 跟 Kit 原始檔一致（node tools/build-embed.mjs 產生）', () => {
  for (const { path, bytes } of outputs()) {
    const file = new URL(`../${path}`, import.meta.url);
    assert.ok(existsSync(file), `缺 ${path}`);
    assert.ok(readFileSync(file).equals(bytes), `${path} 沒跟上，執行 node tools/build-embed.mjs`);
  }
});
