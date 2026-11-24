const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePath, parseHomePath, page, routeData, createPageHandler } = require('./route-page');
const { validate } = require('./format');

test('只認 /r/{牆 id}/{路線 id}（結尾斜線可有可無），後面可以接 route.json', () => {
  assert.deepEqual(parsePath('/r/abcdefgh1234/r1/'), { pid: 'abcdefgh1234', rid: 'r1', file: '' });
  assert.deepEqual(parsePath('/r/abcdefgh1234/r1'), { pid: 'abcdefgh1234', rid: 'r1', file: '' });
  assert.deepEqual(parsePath('/r/abcdefgh1234/r1/route.json'), { pid: 'abcdefgh1234', rid: 'r1', file: 'route.json' });
  for (const p of ['/r/abcdefgh1234/r1/photo.jpg', '/r/abc/r1/', '/r/abcdefgh1234/', '/r/abcdefgh1234/a b/', '/r/ABCDEFGH23/r1/', '/x/abcdefgh1234/r1/', '/r/abcdefgh1234/r1/base.gz']) assert.equal(parsePath(p), null, p);
  assert.deepEqual(parseHomePath('/p/abcdefgh12345678/'), { id: 'abcdefgh12345678' });
  assert.deepEqual(parseHomePath('/p/abcdefgh12345678'), { id: 'abcdefgh12345678' });
  for (const p of ['/p/abcdefgh12345678/index.json', '/p/short/', '/p/ABCDEFGH12345678/']) assert.equal(parseHomePath(p), null, p);
});

// 假的資料集：網址 → JSON（讀不到是 null）。一面 2D 牆（兩條路線）、一面 3D 牆（一條片段路線）、一本岩場
const PID = 'abcdefgh1234', P3 = 'zzzzzzzz1234', CRAG = 'cccccccc12345678', WALLS = 'https://huggingface.co/datasets/climbio/walls/resolve/main/', CRAGS = 'https://huggingface.co/datasets/climbio/crags/resolve/main/';
const holdNode = (id) => ({ id, type: 'hold' }), mark = (node, route) => ({ node, ...(route ? { props: { route } } : {}), geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } });
const layer = { climbio: 2, kind: 'layer', id: 'x', on: PID, href: `${WALLS}walls/pack/current/${PID}.json`, t: 9, license: 'CC-BY-SA-4.0',
  nodes: [holdNode('h1'), holdNode('h2'), { id: 'r1', type: 'route', name: '白白白', author: '小明', t: 5, props: { holds: { h1: 's' }, u: 'aa' } }, { id: 'r2', type: 'route', name: '另一條', t: 7, props: { holds: { h2: 's' } } }],
  marks: [mark('h1', 'r1'), mark('h2', 'r2')] };
const frag = JSON.stringify({ nodes: [{ id: 'k1', type: 'route', name: '三維線', t: 3, props: {} }], marks: [] });
const files = {
  [`${WALLS}index/world.json`]: { climbio: 2, kind: 'index', walls: [
    { id: `pack/${PID}`, name: '主牆', gym: '攀岩館', v: 2, rt: 7, n: 2, t: 7 },
    { id: `${P3}/${P3}`, name: '三維牆', gym: '攀岩館', v: 1, rt: 3, n: 1, t: 3, m3d: 1, base: `https://huggingface.co/datasets/climbio/walls3d/resolve/main/walls3d/${P3}/` }] },
  [`${WALLS}walls/pack/routes.json`]: layer,
  [`${WALLS}walls/${P3}/routes.json`]: { climbio: 2, kind: 'routes', wall: P3, t: 3, routes: [{ id: 'k1', t: 3, u: 'bb', r: frag }] },
  [`${CRAGS}crags/${CRAG}/index.json`]: { climbio: 2, kind: 'set', name: '龍洞', nodes: [{ id: 'c', type: 'crag', name: '龍洞' }, { id: 'r', type: 'route' }], items: [] },
};
const get = async (url) => files[url] || null;
const args = { get, origin: 'https://climbio.web.app', pid: PID, rid: 'r1' };

test('route.json：從整面牆的 routes.json 切出這一條（route 節點、它的標記、標記指到的岩點），沒有這條回 null', async () => {
  const d = await routeData(args);
  assert.deepEqual(validate(d), []);
  assert.deepEqual([d.kind, d.on, d.href, d.nodes.map(n => n.id), d.marks.map(m => m.node), d.t], ['layer', PID, `${WALLS}walls/pack/current/${PID}.json`, ['r1', 'h1'], ['h1'], 5]);
  assert.equal(await routeData({ ...args, rid: 'r9' }), null);
  assert.equal(await routeData({ ...args, pid: 'nonexistent1' }), null, '不在 index 的不是公開牆');
});

test('route.json：3D 牆的片段原樣放進圖層，href 指到 3D 牆的入口', async () => {
  const d = await routeData({ ...args, pid: P3, rid: 'k1' });
  assert.deepEqual([d.on, d.href, d.nodes.map(n => n.id)], [P3, `https://huggingface.co/datasets/climbio/walls3d/resolve/main/walls3d/${P3}/index.json`, ['k1']]);
});

test('頁面：標題、說明跳脫 HTML，轉進 App 收這條線', () => {
  const html = page({ origin: 'https://climbio.web.app', pid: PID, rid: 'r1', title: '<b>"V5"</b>', description: 'a&b', image: { url: 'https://x/y.jpg', width: 1200, height: 630 } });
  assert.match(html, /og:title" content="&lt;b&gt;&quot;V5&quot;&lt;\/b&gt;"/);
  assert.match(html, /og:description" content="a&amp;b"/);
  assert.ok(html.includes('<h1>&lt;b&gt;&quot;V5&quot;&lt;/b&gt;</h1><p>a&amp;b</p>'), '轉進 App 前先畫出標題與預留版面');
  assert.match(html, new RegExp(`location\\.replace\\("https://climbio\\.web\\.app/\\?p=${PID}&r=r1"\\)`));
  assert.match(html, /summary_large_image/);
  assert.doesNotMatch(html, /http-equiv="refresh"/);   // Facebook 的爬蟲會跟著 meta refresh 走，拿不到預覽圖
  assert.deepEqual(JSON.parse(/<script>(\[.*?\])\.forEach\(function\(u\)\{try\{fetch\(u,\{keepalive:true\}\)/.exec(html)[1]), [`https://climbio.web.app/r/${PID}/r1/route.json`]);
});

const call = (handler, path, query = {}) => new Promise(resolve => {
  const res = { headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.code = c; return this; }, type() { return this; }, json: (b) => resolve({ json: b }), send: (b) => resolve({ html: b, code: res.code, headers: res.headers }), redirect: (c, u) => resolve({ redirect: u }) };
  handler({ path, query, get: () => 'climbio.web.app' }, res);
});
const handler = createPageHandler({ hosts: ['climbio.web.app'], get });

test('路線預覽頁：標題是路線名稱，說明有岩館、牆、岩點數、定線者，圖是牆的縮圖；3D 牆的線打開後進 3D 牆；沒有這條線用預設標題', async () => {
  const ok = (await call(handler, `/r/${PID}/r1/`)).html;
  assert.match(ok, /og:title" content="白白白"/);
  assert.ok(ok.includes('og:description" content="攀岩館・主牆・1 顆岩點・定線 小明"'));
  assert.ok(ok.includes(`og:image" content="${WALLS}walls/pack/current/${PID}.thumb.jpg"`));
  assert.match((await call(handler, `/r/${PID}/r9/`)).html, /og:title" content="Climbio"/);
  const m3 = (await call(handler, `/r/${P3}/k1/`)).html;
  assert.ok(m3.includes(`location.replace("https://climbio.web.app/hold/?m3d=${P3}&rid=k1")`));
  assert.ok(m3.includes(`og:image" content="https://huggingface.co/datasets/climbio/walls3d/resolve/main/walls3d/${P3}/thumb.jpg"`));
});

test('route.json 路徑：回圖層、允許跨網域；沒有這條回 404', async () => {
  const r = await call(handler, `/r/${PID}/r1/route.json`);
  assert.equal(r.json.kind, 'layer');
  assert.deepEqual((await call(handler, `/r/${PID}/r9/route.json`)).json, { error: 'not found' });
});

test('牆的預覽頁 /r/{牆 id}/：名稱、岩館、路線數；沒有這面牆轉回首頁', async () => {
  const w = (await call(handler, `/r/${PID}/`)).html;
  assert.ok(w.includes('og:description" content="攀岩館・2 條路線・岩點貓"'));
  assert.ok(w.includes(`var u="https://climbio.web.app/hold/?wall=pack/${PID}.json"`), 'LINE 的內建瀏覽器改用手機瀏覽器開（分享頁共用的轉址寫法）');
  assert.equal((await call(handler, '/r/nonexistent1/')).redirect, 'https://climbio.web.app/');
});

test('固定分享網址 /p/{id}：岩場的預覽頁轉到紅點貓並帶 at；3D 牆轉到岩點貓；沒有這個專案回 404', async () => {
  const c = (await call(handler, `/p/${CRAG}/`)).html;
  assert.match(c, /og:title" content="龍洞"/);
  assert.ok(c.includes(`var u="https://climbio.web.app/redpoint/?topo=${encodeURIComponent(`${CRAGS}crags/${CRAG}/index.json`)}"`));
  const w = (await call(handler, `/p/${P3.padEnd(16, '0')}/`));
  assert.equal(w.code, 404);
  files[`${WALLS}index/world.json`].walls.push({ id: 'q/qqqqqqqqqqqqqqqq', name: '3D 牆', gym: '攀岩館', n: 0, m3d: 1, base: 'https://huggingface.co/datasets/climbio/walls3d/resolve/main/walls3d/qqqqqqqqqqqqqqqq/' });
  const m = (await call(handler, '/p/qqqqqqqqqqqqqqqq/')).html;
  assert.ok(m.includes('var u="https://climbio.web.app/hold/?m3d=qqqqqqqqqqqqqqqq"'));
});
