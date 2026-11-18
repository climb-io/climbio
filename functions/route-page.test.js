const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePath, page, routeData, createPageHandler } = require('./route-page');
const { validate } = require('./format');

test('只認 /r/{牆 id}/{路線 id}（結尾斜線可有可無），後面可以接 route.json', () => {
  assert.deepEqual(parsePath('/r/abcdefgh1234/r1/'), { pid: 'abcdefgh1234', rid: 'r1', file: '' });
  assert.deepEqual(parsePath('/r/abcdefgh1234/r1'), { pid: 'abcdefgh1234', rid: 'r1', file: '' });
  assert.deepEqual(parsePath('/r/abcdefgh1234/r1/route.json'), { pid: 'abcdefgh1234', rid: 'r1', file: 'route.json' });
  for (const p of ['/r/abcdefgh1234/r1/photo.jpg', '/r/abc/r1/', '/r/abcdefgh1234/', '/r/abcdefgh1234/a b/', '/r/ABCDEFGH23/r1/', '/x/abcdefgh1234/r1/', '/r/abcdefgh1234/r1/base.gz']) assert.equal(parsePath(p), null, p);
});

// 假的 Firestore：shared/{pid}、wallRoutes/{pid}
const snap = (d) => ({ exists: !!d, data: () => d, get: (k) => d && d[k] });
const frag = JSON.stringify({ nodes: [{ id: 'h1', type: 'hold' }, { id: 'r1', type: 'route', name: '白白白', t: 5, props: { holds: { h1: 's' } } }], marks: [{ node: 'h1', geometry: { type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 4], [0, 0]]] } }, { node: 'r1', geometry: { type: 'Point', coordinates: [1, 1] } }] });
const docs = { 'shared/abcdefgh1234': { owner: 'u1', src: { project: 'wallproject00001', path: 'abcdefgh1234.json' } }, 'wallRoutes/abcdefgh1234': { routes: { r1: { uid: 'u1', t: 5, r: frag } } } };
const db = { collection: (name) => ({ doc: (id) => ({ get: async () => snap(docs[`${name}/${id}`]) }) }) };
const args = { origin: 'https://climbio.web.app', pid: 'abcdefgh1234', rid: 'r1' };

test('route.json：這條路線疊在牆上的圖層，href 指到牆；沒有這條回 null', async () => {
  const d = await routeData({ db, ...args });
  assert.deepEqual(validate(d), []);
  assert.deepEqual([d.kind, d.on, d.href, d.nodes.map(n => n.id)], ['layer', 'abcdefgh1234', 'https://climbio.web.app/p/wallproject00001/abcdefgh1234.json', ['h1', 'r1']]);
  assert.equal(await routeData({ db, ...args, rid: 'r9' }), null);
});

test('頁面：標題、說明跳脫 HTML，轉進 App 收這條線', () => {
  const html = page({ origin: 'https://climbio.web.app', pid: 'abcdefgh1234', rid: 'r1', title: '<b>"V5"</b>', description: 'a&b',
    image: { url: 'https://x/y.jpg', width: 1200, height: 630 } });
  assert.match(html, /og:title" content="&lt;b&gt;&quot;V5&quot;&lt;\/b&gt;"/);
  assert.match(html, /og:description" content="a&amp;b"/);
  assert.match(html, /location\.replace\("https:\/\/climbio\.web\.app\/\?p=abcdefgh1234&r=r1"\)/);
  assert.match(html, /summary_large_image/);
  assert.doesNotMatch(html, /http-equiv="refresh"/);   // Facebook 的爬蟲會跟著 meta refresh 走，拿不到預覽圖
  // 轉進 App 之前先下載路線圖層：網址、fetch 設定（預設的 cors、同源才帶憑證）跟 App 的 fetchShared 一樣，換頁後照樣下載（keepalive）
  assert.deepEqual(JSON.parse(/<script>(\[.*?\])\.forEach\(function\(u\)\{try\{fetch\(u,\{keepalive:true\}\)/.exec(html)[1]), [
    'https://climbio.web.app/r/abcdefgh1234/r1/route.json']);
});

test('連結預覽頁：標題是路線的名稱，圖是岩點貓；沒有這條線用預設標題', async () => {
  const handler = createPageHandler({ db, hosts: ['climbio.web.app'] });
  const get = (path) => new Promise(resolve => { const res = { headers: {}, set(k, v) { this.headers[k] = v; return this; }, status() { return this; }, send(b) { resolve(b); }, redirect(c, u) { resolve(u); } }; handler({ path, get: k => (k === 'host' ? 'climbio.web.app' : undefined) }, res); });
  const ok = await get('/r/abcdefgh1234/r1/');
  assert.match(ok, /og:title" content="白白白"/);
  assert.match(ok, /og:image" content="https:\/\/climbio\.web\.app\/icons\/cats\/hold-cat-512\.png"/);
  assert.match(await get('/r/abcdefgh1234/r9/'), /og:title" content="Climbio"/);
});

test('連結的網域：設定裡的站用自己的網域，不認得的導回第一個站', async () => {
  const handler = createPageHandler({ db: {}, hosts: ['my-wall.web.app', 'my-wall-dev.web.app'] });
  const go = (host) => new Promise(resolve => handler({ path: '/', get: k => (k === 'host' ? host : undefined) }, { redirect: (status, url) => resolve([status, url]) }));
  assert.deepEqual(await go('my-wall-dev.web.app'), [302, 'https://my-wall-dev.web.app/']);
  assert.deepEqual(await go('climbio.web.app'), [302, 'https://my-wall.web.app/']);
});
