import { test, expect } from './fixtures.mjs';
import { createRequire } from 'node:module';
const { wallView, routesLayer } = createRequire(import.meta.url)('../../functions/open-format.js');

// 不接後端的站（主網以外的網域、本機預覽，site.js 的 backend: 'none'、沒有雲端加速）：沒有登入、同步、路線連結，分享只產圖；找牆面只讀總目錄；收別人的線照樣可以；不連 Firebase 和雲端函式
const FRIEND_SITE = 'https://wall.example.org', FRIEND = `${FRIEND_SITE}/r/abcdefgh1234/r1abc/`;
test.beforeEach(async ({ context, page }) => {
  page.outside = []; page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));   // 呼叫這個後端沒有的功能（例如登入）會在這裡出現
  await context.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.origin === 'http://127.0.0.1:8876') return route.continue();
    if (['data:', 'blob:'].includes(u.protocol)) return route.continue();
    if (u.origin === FRIEND_SITE) return route.fulfill(await friendFile(page, u.pathname));
    page.outside.push(u.href);
    return route.abort();
  });
  await page.addInitScript(() => { localStorage.removeItem('climbio.site.main'); localStorage.setItem('climbio.shareOk', 'true'); });
  await page.goto('/hold/');
  await page.waitForFunction(() => typeof openWall === 'function');
  await page.evaluate(() => hideWelcome());
});
// 另一個站分享的線（公開格式 v2）：路線圖層 → 牆（示範牆的照片和岩點）→ 照片、縮圖
// page.layerPics：圖層帶縮圖網址和極小預覽圖（這裡拿示範牆的縮圖當預覽）；page.wallGate：牆等它好了才回
async function friendFile(page, path) {
  const cors = { 'Access-Control-Allow-Origin': '*' };
  if (path.endsWith('.jpg')) return { contentType: 'image/jpeg', headers: cors, body: await (await page.request.get('/demo/demo.jpg')).body() };
  const { wall } = await (await page.request.get('/demo/demo.json')).json(), base = { ...wall, name: '朋友的牆' };
  if (path.endsWith('wall.json')) await page.wallGate;
  const pics = page.layerPics ? { thumb: `${FRIEND_SITE}/w/abcdefgh1234/thumb.jpg`, preview: wall.thumb } : {};
  const doc = path.endsWith('route.json')
    ? routesLayer({ id: 'friendlayer00001', pid: 'abcdefgh1234', href: `${FRIEND_SITE}/w/abcdefgh1234/wall.json`, base, routes: [{ route: { ...wall.routes[0], id: 'r1abc', author: '朋友' }, gym: '' }], ...pics })
    : wallView({ pid: 'abcdefgh1234', base, attribution: '朋友', t: 1 });
  return { contentType: 'application/json', headers: cors, body: JSON.stringify(doc) };
}
const outsideServices = (page) => page.outside.filter(u => !/^https:\/\/(fonts\.(googleapis|gstatic)\.com\/|cdn\.jsdelivr\.net\/npm\/onnxruntime-web@)/.test(u));   // 字型、手機上偵測用的 onnxruntime 不算

test('沒有後端：收別的站分享的線，存成自己的一份', async ({ page }) => {
  await page.evaluate((link) => { recvConnect(link); }, FRIEND);
  await expect(page.locator('#rvAsk')).toBeHidden();
  await page.locator('#rvGo').tap();
  await expect(page.locator('#editor')).toBeVisible();
  await expect.poll(() => page.evaluate(() => state.wall && state.wall.name)).toBe('朋友的牆');
  expect(await page.evaluate(() => route().id)).toBe('r1abc');
  expect(outsideServices(page)).toEqual([]);
});

test('沒有後端：收別的站分享的線，圖層帶極小預覽圖時牆還沒到就先有畫面', async ({ page }) => {
  let open; page.wallGate = new Promise(r => { open = r; }); page.layerPics = true;
  await page.evaluate((link) => { recvConnect(link, { ask: false }); }, FRIEND);
  await expect(page.locator('#rvBox')).toHaveClass(/has-pic/);
  expect(await page.evaluate(() => $('rvFrom').textContent)).toContain('朋友');
  open();
  await page.locator('#rvGo').tap();
  await expect(page.locator('#editor')).toBeVisible();
  expect(await page.evaluate(() => [state.wall.name, route().id])).toEqual(['朋友的牆', 'r1abc']);
  expect(outsideServices(page)).toEqual([]);
});

test('沒有後端：Studio 照 site.js 不登入、不發佈（發佈服務還沒開），照樣能建書、匯出 ZIP，也不連 Firebase', async ({ page }) => {
  await page.goto('/studio/?app');
  await expect(page.locator('#aiBox')).toBeVisible();
  await expect(page.locator('.st-acct')).toHaveCount(1);   // 選單（語言、版本）：Studio 沒有登入
  await page.locator('.st-avatar').click();
  await expect(page.locator('.st-menu')).not.toContainText(/登入|Sign/);
  await page.goto('/studio/crag/#convert');
  await page.locator('#bkInput').setInputFiles([{ name: 'book.md', mimeType: 'text/markdown', buffer: Buffer.from('# 岩場\n交通：入口 25.13473, 121.51491\n## 石頭\n| 名稱 | 難度 |\n|---|---|\n| 甲 | V1 |\n') }]);
  await page.locator('#bkGo').click();
  await expect(page.locator('#bookDlg')).toHaveAttribute('data-step', 'done');
  await page.locator('#bkPublish').click();
  await expect(page.locator('#pubMsg')).toHaveText('發佈服務還沒開');
  await expect(page.locator('#pubGo')).toBeDisabled();
  await expect(page.locator('#pubExport')).toBeVisible();
  expect(page.outside.filter(u => /firebase|gstatic|googleapis|cloudfunctions/.test(u))).toEqual([]);
  expect(page.errors).toEqual([]);
});
