import { test, expect } from './fixtures.mjs';

// routekit/demo.html：其他 App 用 RouteKit 的樣子（不載入 App 本體）——看路線畫得出來、定線點岩點會改路線 JSON
test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:8876' ? route.continue() : route.abort());
});

test('RouteViewer 畫出路線圖，RouteEditor 點岩點加進路線並同步給 Viewer', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/routekit/demo.html');
  await expect.poll(() => page.evaluate(() => !!window.routekitDemo)).toBe(true);
  expect(await page.evaluate(() => typeof self.AppKit === 'undefined' && typeof self.state === 'undefined')).toBe(true);   // 不依賴 App
  const painted = (id) => page.evaluate((id) => {
    const c = document.getElementById(id), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4 * 97) if (d[i]) n++;
    return n;
  }, id);
  expect(await painted('viewer')).toBeGreaterThan(100);
  expect(await painted('editor')).toBeGreaterThan(100);
  // <routekit-viewer>：圈點轉回來的路線跟原本的一樣（腳點變手點），畫得出來
  expect(await page.evaluate(() => JSON.stringify(routekitDemo.wc.route.holds) === JSON.stringify(Object.fromEntries(Object.entries(routekitDemo.draft.holds).map(([id, t]) => [id, t === 'f' ? 'h' : t]))))).toBe(true);
  expect(await page.evaluate(() => { const c = routekitDemo.wc.shadowRoot.querySelector('canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4 * 97) if (d[i]) n++; return n; })).toBeGreaterThan(100);
  // 點一顆不在路線上的岩點（取外框的中心，確定點得到的就是它）；定線畫布在下面，先捲到畫面裡
  await page.locator('#types button[data-type="f"]').click();
  await page.locator('#editor').scrollIntoViewIfNeeded();
  const target = await page.evaluate(() => {
    const { scene, editor, draft } = routekitDemo, mid = (h) => { const b = RouteKit.bbox(h.poly); return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]; };
    const h = scene.holds.find(h => !draft.holds[h.id] && RouteKit.holdAt(scene.holds, ...mid(h)) === h);
    const [x, y] = mid(h), r = editor.canvas.getBoundingClientRect(), dpr = editor.canvas.width / r.width;
    return { id: h.id, cx: r.left + (x * editor.t.k + editor.t.tx) / dpr, cy: r.top + (y * editor.t.k + editor.t.ty) / dpr };
  });
  await page.mouse.click(target.cx, target.cy);
  expect(await page.evaluate((id) => [routekitDemo.draft.holds[id], routekitDemo.viewer.route.holds[id], JSON.parse(document.getElementById('out').textContent).holds[id]], target.id)).toEqual(['f', 'f', 'f']);
  await page.waitForTimeout(500);   // 不算快速點兩下
  await page.mouse.click(target.cx, target.cy);
  expect(await page.evaluate((id) => routekitDemo.draft.holds[id], target.id)).toBeUndefined();
  await page.screenshot({ path: testInfo.outputPath('routekit-demo.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('<routekit-viewer src route-id>：圖層有好幾條路線時畫指定的那條；loadLayer 一次拿到全部', async ({ page }) => {
  await page.goto('/routekit/demo.html');
  await expect.poll(() => page.evaluate(() => !!window.routekitDemo)).toBe(true);
  const jpeg = Buffer.from(await page.evaluate(async () => {
    const cv = Object.assign(document.createElement('canvas'), { width: 400, height: 300 });
    const g = cv.getContext('2d'); g.fillStyle = '#887766'; g.fillRect(0, 0, 400, 300);
    return [...new Uint8Array(await (await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.9))).arrayBuffer())];
  }));
  const rect = (x, y) => [[x, y], [x + 40, y], [x + 40, y + 40], [x, y + 40]];
  const ring = (p) => [[...p, p[0]].map(q => q)];
  const holds = [[50, 220], [120, 160], [200, 100], [280, 60]];
  const view = { climbio: 2, kind: 'view', surface: 'photo', id: 'wallwallwall0001', t: 1, license: 'CC-BY-SA-4.0', attribution: 'x', href: 'photo.jpg', w: 400, h: 300,
    nodes: holds.map((_, i) => ({ id: `h${i}`, type: 'hold', t: 1 })), marks: holds.map(([x, y], i) => ({ node: `h${i}`, geometry: { type: 'Polygon', coordinates: ring(rect(x, y)) } })) };
  const route = (id, name, hs) => ({ id, type: 'route', name, t: 1, props: { grade: { v: 'V3' }, 'climbio:color': '藍', holds: hs } });
  const layer = { climbio: 2, kind: 'layer', id: 'layerlayer000001', on: view.id, href: 'wall.json', t: 1, license: 'CC-BY-SA-4.0', attribution: 'x',
    nodes: [route('r1', '第一條', { h0: 's', h1: 't' }), route('r2', '第二條', { h2: 's', h3: 't' })] };
  await page.route('**/__t/*', r => {
    const f = new URL(r.request().url()).pathname.split('/').pop();
    if (f === 'photo.jpg') return r.fulfill({ contentType: 'image/jpeg', body: jpeg });
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(f === 'wall.json' ? view : layer) });
  });
  const got = await page.evaluate(async () => {
    const { loadLayer, loadRoute } = RouteKit;
    const all = await loadLayer('/__t/layer.json'), two = await loadRoute('/__t/layer.json', 'r2');
    return { names: all.routes.map(r => [r.name, r.grade, r.color]), picked: two.route.name, holds: two.holds.length };
  });
  expect(got).toEqual({ names: [['第一條', 'V3', '藍'], ['第二條', 'V3', '藍']], picked: '第二條', holds: 4 });
  const painted = await page.evaluate(async () => {
    const el = document.createElement('routekit-viewer');
    el.style.height = '300px'; el.setAttribute('route-id', 'r2'); el.setAttribute('src', '/__t/layer.json');
    document.body.append(el);
    await new Promise((ok, bad) => { el.addEventListener('load', ok); el.addEventListener('error', () => bad(new Error('load'))); });
    const d = el.canvas.getContext('2d').getImageData(0, 0, el.canvas.width, el.canvas.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4 * 97) if (d[i]) n++;
    return { route: el.data.route.name, n };
  });
  expect(painted.route).toBe('第二條');
  expect(painted.n).toBeGreaterThan(100);
});
