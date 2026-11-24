import { test, expect } from './fixtures.mjs';

const appErrors = new WeakMap();
// 每例使用獨立瀏覽器資料；禁止測試意外連到正式 Firebase 或 LINE。
test.beforeEach(async ({ context, page }) => {
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === 'http://127.0.0.1:8876' || ['data:', 'blob:'].includes(url.protocol)
      ? route.continue() : route.abort();
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => { errors.push(`不應出現原生對話框：${dialog.type()}`); dialog.dismiss(); });
  appErrors.set(page, errors);
});

test.afterEach(async ({ page }) => {
  expect(appErrors.get(page), '頁面執行錯誤').toEqual([]);
});

// 記下首頁、開場畫面有沒有畫出來過（每一格畫面都看）：第一次打開不能先閃一下首頁，有牆的不能閃一下開場畫面
const watchPaint = (page) => page.addInitScript(() => {
  window.painted = { home: false, landing: false };
  const tick = () => {
    const shown = (id) => { const el = document.getElementById(id); return !!el && !document.getElementById('bootSplash') && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0; };   // 啟動畫面還在時什麼都看不到
    if (shown('landing')) painted.landing = true;
    else if (shown('home')) painted.home = true;   // 首頁露出來（開場畫面、啟動畫面蓋住的不算）
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

async function welcome(page) {
  await page.goto('/hold/');
  await expect(page.locator('#ldPlay')).toBeVisible();
  await expect(page.locator('#ldLogin')).toHaveCount(0);   // 開場沒有登入：帳號只用來公開發佈，不是使用門檻
  await expect(page.locator('#ldRecv')).toHaveCount(0);
}

test('啟動畫面：程式還沒載入就先有（內嵌、岩點貓圖示），程式全部 defer；首頁畫好後拿掉', async ({ page }) => {
  const html = await (await page.request.get('/hold/')).text();
  expect(html.indexOf('id="bootSplash"')).toBeGreaterThan(0);
  expect(html.indexOf('id="bootSplash"')).toBeLessThan(html.indexOf('<script src="../js/rename.js"'));   // 在所有 App 程式之前
  // 同步載入修復、錯誤回報、換站網址、設定搬家與語言包；App 主程式維持 defer。
  expect(html.match(/<script src="[^"]+"/g).map(m => m.slice(13, -1))).toEqual(['../appkit/recover.js', '../host-redirect.js', '../js/rename.js', '../appkit/i18n.js', '../js/boot.js']);
  await page.route('**/js/main.js', async route => { await new Promise(r => setTimeout(r, 1500)); await route.continue(); });
  await page.goto('/hold/', { waitUntil: 'commit' });
  await expect(page.locator('#bootSplash svg')).toBeVisible();   // 主程式還沒到，看到的是啟動畫面
  await expect(page.locator('#bootSplash')).toHaveCount(0);   // 首頁畫好才拿掉
});

test('開場的主標、副標三組輪播：品牌圖像配合文案輪替', async ({ page }) => {
  await welcome(page);
  const ps = await page.evaluate(() => t('ldPitch'));
  expect(ps).toHaveLength(3);
  await expect(page.locator('#ldTitle')).toHaveText(ps[0][0]);
  await expect(page.locator('#ldSub')).toHaveText(ps[0][1]);
  await expect(page.locator('#ldTitle')).toHaveText(ps[1][0], { timeout: 15000 });
  await expect(page.locator('#ldSub')).toHaveText(ps[1][1]);
});

test('相簿按鈕選好照片才離開開場，進裁切；開場前不先畫首頁', async ({ page }) => {
  await watchPaint(page);
  await welcome(page);
  expect(await page.evaluate(() => painted.home)).toBe(false);
  expect(await page.locator('#photoInput').getAttribute('capture')).toBeNull();
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = () => new Promise(() => {}); });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(() => $('addLibraryBtn').click())]);
  await expect(page.locator('#landing')).toBeVisible();   // 還在選：開場留著
  await chooser.setFiles('demo/demo.jpg');
  await expect(page.locator('#landing')).toBeHidden();
  await expect(page.locator('#crop')).toBeVisible();
});

// 每一格畫面都看「拍一面牆」有沒有露出來：沒登入、沒有牆時應該直接回開場畫面
const watchEmpty = (page) => page.evaluate(() => {
  window.emptyShown = false;
  const tick = () => {   // 畫面正中間是「拍一面牆」那一塊才算露出來（裁切畫面、開場畫面蓋住的不算）
    const r = $('homeEmpty').getBoundingClientRect(), el = r.height && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (el && $('homeEmpty').contains(el)) emptyShown = true;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

test('相簿選了照片、在裁切取消：回到開場畫面，不露出空的首頁', async ({ page }) => {
  await welcome(page);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(() => $('addLibraryBtn').click())]);
  await chooser.setFiles('demo/demo.jpg');
  await expect(page.locator('#crop')).toBeVisible();
  await watchEmpty(page);
  await page.locator('#cropCancel').tap();
  await expect(page.locator('#crop')).toBeHidden();
  await expect(page.locator('#ldPlay')).toBeVisible();
  expect(await page.evaluate(() => emptyShown)).toBe(false);
});

test('沒登入、刪掉最後一面牆：復原的時間過了回到開場畫面，中間不露出「拍一面牆」', async ({ page }) => {
  await welcome(page);
  await page.evaluate(async () => {
    const data = await (await fetch('/demo/demo.json')).json();
    const photo = await (await fetch('/demo/demo.jpg')).blob();
    const w = { ...data.wall, id: 'e2e-last', createdAt: Date.now(), updatedAt: Date.now() };
    await putWall(w); await putImage(w.id, photo);
    hideWelcome(); await showHome();
  });
  await expect(page.locator('#wallList .wall-card')).toHaveCount(1);
  await watchEmpty(page);
  await page.evaluate(() => { menuWall = homeWalls[0]; $('deleteWallBtn').click(); });
  await expect(page.locator('#wallList .wall-card')).toHaveCount(0);
  await expect(page.locator('#landing')).toBeHidden();   // 還能復原：先留在首頁
  await expect(page.locator('#ldPlay')).toBeVisible({ timeout: 10000 });
  expect(await page.evaluate(() => emptyShown)).toBe(false);
  expect(await page.evaluate(() => listWalls().then(ws => ws.length))).toBe(0);
});

test('取消選照片後留在開場，不出現示範牆收取入口', async ({ page }) => {
  await welcome(page);
  await page.evaluate(() => $('photoInput').dispatchEvent(new Event('cancel')));
  await expect(page.locator('#landing')).toBeVisible();
  await expect(page.locator('#ldDemo')).toHaveCount(0);
  await expect(page.locator('#ldPlay')).toBeVisible();
});

test('手機瀏覽器就是完整的 App：出完第一條線後首頁下方提示加到主畫面，按了直接裝；裝過就不再出現', async ({ page }, testInfo) => {
  await welcome(page);
  await page.evaluate(async () => { hideWelcome(); await showHome(); });
  await expect(page.locator('#addBtn')).toBeVisible();
  await expect(page.locator('#instBar')).toBeHidden();
  await page.evaluate(() => routeMade());
  if (testInfo.project.name === 'android-chromium') {
    await expect(page.locator('#instBar')).toBeHidden();   // Chrome 還沒說可以裝（裝了就不會說）
    await page.evaluate(() => {
      window.prompted = 0;
      const e = new Event('beforeinstallprompt'); e.prompt = async () => { prompted++; }; e.userChoice = Promise.resolve({ outcome: 'accepted' });
      dispatchEvent(e);
    });
    await expect(page.locator('#instBar')).toBeVisible();
    await page.locator('#instGo').tap();
    await expect.poll(() => page.evaluate(() => prompted)).toBe(1);   // 直接跳原生安裝，不經過介紹頁
    await expect(page.locator('#landing')).toBeHidden();
    await page.evaluate(() => dispatchEvent(new Event('appinstalled')));
    await expect(page.locator('#instBar')).toBeHidden();
    await page.reload();
    await page.evaluate(() => dispatchEvent(new Event('beforeinstallprompt')));
    await expect(page.locator('#instBar')).toBeHidden();   // 裝過（在 Chrome 打開也一樣）就不再出現
  } else {
    await expect(page.locator('#instBar')).toBeVisible();
    await page.locator('#instGo').tap();
    await expect(page.locator('.ak-dialog')).toBeVisible();   // 一行步驟，不經過介紹頁
    await expect(page.locator('.ak-dialog')).toContainText('加入主畫面');
    await expect(page.locator('#landing')).toBeHidden();
    await page.locator('.ak-dialog button[value="ok"]').tap();
    await page.locator('#instX').tap();
    await expect(page.locator('#instBar')).toBeHidden();
    await page.reload();
    await expect(page.locator('#instBar')).toBeHidden();   // 關掉後這台不再出現
  }
});

test('LINE 內建瀏覽器顯示外開入口與對應平台說明', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ ...testInfo.project.use, userAgent: `${testInfo.project.use.userAgent} Line/15.0` });
  try {
    await context.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:8876' ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:8876/hold/');
    await page.waitForFunction(() => typeof showLanding === 'function');
    await page.evaluate(() => { hideWelcome(); showLanding(); });
    await expect(page.locator('#ldMenu')).toBeVisible();
    await expect(page.locator('#ldGo')).toBeHidden();
    await expect(page.locator('#ldIos')).toBeHidden();
    if (testInfo.project.name === 'android-chromium') {
      await expect(page.locator('#ldOpenApp')).toBeVisible();
      await expect(page.locator('#ldOpenApp')).toHaveAttribute('href', /^intent:\/\/127\.0\.0\.1:8876\//);
    } else await expect(page.locator('#ldOpenApp')).toBeHidden();
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('Messenger 內建瀏覽器點開分享連結：iPhone 先提示改用 Safari，兩邊都照常收線', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ ...testInfo.project.use, userAgent: `${testInfo.project.use.userAgent} [FBAN/MessengerForiOS;FBAV/480.0]` });
  try {
    await context.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:8876' ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:8876/?p=abcdefgh1234&r=r1');
    if (testInfo.project.name === 'ios-webkit') {
      await expect(page.locator('.ak-dialog')).toBeVisible();
      await expect(page.locator('.ak-dialog')).toContainText('Safari');
      await page.locator('.ak-dialog button[value="ok"]').tap();
    }
    await expect(page.locator('#recvPage')).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

for (const [locale, htmlLang] of [['zh-TW', 'zh-Hant'], ['en-US', 'en'], ['ja-JP', 'ja']]) test.describe(`瀏覽器語言：${locale}`, () => {
  test.use({ locale });
  test(`開場語言依瀏覽器語言決定，重新載入不變：${locale}`, async ({ page }) => {
    await welcome(page);
    await expect(page.locator('html')).toHaveAttribute('lang', htmlLang);
    const expected = await page.evaluate(() => AppKit.i18n.t('ldPlay'));
    expect(expected).toBeTruthy();
    await expect(page.locator('#ldPlay')).toHaveText(expected);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', htmlLang);
    await expect(page.locator('#ldPlay')).toHaveText(expected);
  });
});

test('一般牆面可存入 IndexedDB，重新載入仍保存路線與照片', async ({ page }) => {
  await welcome(page);
  const fixture = await page.evaluate(async () => {
    const data = await (await fetch('/demo/demo.json')).json();
    const photo = await (await fetch('/demo/demo.jpg')).blob();
    const w = { ...data.wall, id: 'e2e-demo', pid: 'e2e-store-fixture', name: '測試牆', createdAt: Date.now(), updatedAt: Date.now() };
    await putWall(w); await putImage(w.id, photo);
    hideWelcome(); await showHome();
    return { name: w.name, routes: w.routes.length, holds: w.holds.length, bytes: photo.size };
  });
  await expect(page.locator('#wallList')).toContainText(fixture.name);
  await page.locator('#wallList .wall-card').first().tap();
  await expect(page.locator('#wall')).toBeVisible();
  await expect.poll(() => page.locator('#wallPhoto').evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  await page.reload();
  await expect(page.locator('#ldPlay')).toBeHidden();
  await expect(page.locator('#wallList')).toContainText(fixture.name);
  const stored = await page.evaluate(async () => {
    const w = await getWall('e2e-demo'), photo = await getImage('e2e-demo');
    return { name: w.name, routes: w.routes.length, holds: w.holds.length, bytes: photo.size };
  });
  expect(stored).toEqual(fixture);
});

test('未登入、這台已經有牆：重新載入不再顯示開場畫面，首頁右下照常是新增，右上是頭像', async ({ page }) => {
  await welcome(page);
  await page.evaluate(async () => {
    const data = await (await fetch('/demo/demo.json')).json();
    const photo = await (await fetch('/demo/demo.jpg')).blob();
    const w = { ...data.wall, id: 'e2e-demo-ro', pid: 'e2e-reopen-fixture', name: '測試牆', createdAt: Date.now(), updatedAt: Date.now() };
    await putWall(w); await putImage(w.id, photo);
    hideWelcome(); await showHome();
  });
  await watchPaint(page);
  await page.reload();
  await expect(page.locator('#landing')).toBeHidden();
  await expect(page.locator('#ldPlay')).toBeHidden();
  await expect(page.locator('#home')).toBeVisible();
  expect(await page.evaluate(() => painted.landing)).toBe(false);   // 有牆：不閃一下開場畫面
  await expect(page.locator('#addBtn')).toBeVisible();
  await expect(page.locator('#homeMenuBtn')).toBeVisible();
  await page.locator('#homeMenuBtn').tap();
  await expect(page.locator('#hmAcct')).toBeVisible();   // 姓名在最上面（沒設定顯示「未設定」）
  await expect(page.locator('#accountBtn')).toBeHidden();
  await expect(page.locator('#statsBtn')).toBeVisible();
});
