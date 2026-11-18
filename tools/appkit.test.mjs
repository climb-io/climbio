// appkit/ 不碰 DOM 的部分：語言包的挑選與查詢、平台判斷、v2 照片畫面（EXIF → camera 的案例在 author.test.mjs）
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import AppKit from '../appkit/index.mjs';
import { withExif } from '../tests/e2e/exif-jpeg.mjs';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const { i18n, install, photo, landing } = AppKit;

test('載入修復不處理離線或可重試的非同步腳本，必要腳本損壞仍清快取修復一次', async () => {
  const code = readFileSync(new URL('../appkit/recover.js', import.meta.url), 'utf8');
  for (const [online, asyncScript, expected] of [[false, false, 0], [true, true, 0], [true, false, 1]]) {
    const events = {}, removed = [], state = new Map();
    let reloads = 0, unregisters = 0;
    const context = { document: {}, URL, navigator: { onLine: online, serviceWorker: { getRegistrations: async () => [{ unregister: async () => { unregisters++; } }] } },
      caches: { keys: async () => ['hold-v1', 'redpoint-cat-v1', 'hold-models'], delete: async key => removed.push(key) },
      sessionStorage: { getItem: key => state.get(key), setItem: (key, value) => state.set(key, value) },
      location: { href: 'https://example.test/hold/', origin: 'https://example.test', reload: () => { reloads++; } },
      addEventListener: (name, fn) => { events[name] = fn; } };
    context.self = context;
    vm.runInNewContext(code, context);
    events.error({ target: { tagName: 'SCRIPT', src: 'https://example.test/script.js', async: asyncScript } });
    await new Promise(setImmediate);
    assert.equal(reloads, expected);
    assert.equal(unregisters, expected);
    assert.deepEqual(removed, expected ? ['hold-v1', 'redpoint-cat-v1'] : []);
    events.error({ target: { tagName: 'SCRIPT', src: 'https://example.test/script.js', async: asyncScript } });
    await new Promise(setImmediate);
    assert.equal(reloads, expected);
  }
});

test('語言：依瀏覽器語言挑，沒有的用英文；只有中文的 App 一律中文', () => {
  assert.equal(i18n.detect(i18n.LANGS, 'zh-TW'), 'zh');
  assert.equal(i18n.detect(i18n.LANGS, 'ja-JP'), 'ja');
  assert.equal(i18n.detect(i18n.LANGS, 'pt-BR'), 'en');
  assert.equal(i18n.detect(['zh'], 'en-US'), 'zh');
});

test('文字：App 的語言包 → 共用名詞 → key 本身；函式帶參數', () => {
  i18n.add('common', 'zh', { cancel: '取消' });
  assert.equal(i18n.lang, 'zh');
  assert.equal(i18n.t('cancel'), '取消');
  assert.equal(i18n.t('nope'), 'nope');
  i18n.add('common', 'zh', { n: (k) => `${k} 條` });
  assert.equal(i18n.t('n', 3), '3 條');
});

test('語言包可以有好幾個資料夾：依序找 key，都沒有才用共用名詞（Studio 的共用包加工作區的包）', () => {
  const script = `
    globalThis.document = { documentElement: {}, write() {} };
    const { i18n } = require('./appkit/index.js');
    i18n.add('common', 'en', { ok: 'OK' });
    i18n.add('studio', 'en', { save: 'Save', shared: 'from studio' });
    i18n.add('studio-crag', 'en', { route: 'Route', shared: 'from crag' });
    i18n.boot({ app: ['studio', 'studio-crag'], langs: ['zh', 'en'] });
    console.log(JSON.stringify([i18n.lang, i18n.t('save'), i18n.t('route'), i18n.t('shared'), i18n.t('ok'), i18n.t('none'), i18n.cacheList(['studio', 'studio-crag'], '../i18n/', ['zh']).length]));
  `;
  const out = execFileSync(process.execPath, ['--no-warnings', '-e', script], { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env, LANG: 'en_US' } });
  const [lang, save, route, shared, ok, none, files] = JSON.parse(out.trim().split('\n').pop());
  assert.ok(['en', 'zh'].includes(lang));
  if (lang === 'en') assert.deepEqual([save, route, shared, ok, none], ['Save', 'Route', 'from studio', 'OK', 'none']);
  assert.equal(files, 3);   // common、studio、studio-crag 各一個語言
});

test('timing：wait 等指定的時間；fetchTimeout 超過時間就中止，自己給的 signal 優先', async () => {
  const { timing } = AppKit, t0 = Date.now();
  await timing.wait(30);
  assert.ok(Date.now() - t0 >= 25);
  const real = globalThis.fetch;
  globalThis.fetch = (url, opt) => new Promise((ok, no) => opt.signal.addEventListener('abort', () => no(new Error('aborted'))));
  try {
    await assert.rejects(timing.fetchTimeout('http://x', {}, 20), /aborted/);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 5);
    await assert.rejects(timing.fetchTimeout('http://x', { signal: ac.signal }, 5000), /aborted/);
  } finally { globalThis.fetch = real; }
});

test('Service Worker 的快取清單：每種語言的共用名詞和 App 的語言包', () => {
  const list = i18n.cacheList('hold');
  assert.equal(list.length, i18n.LANGS.length * 2);
  assert.ok(list.includes('../i18n/common/ja.js') && list.includes('../i18n/hold/de.js'));
});

test('平台：iPadOS 用 Mac 的 UA 靠觸控點分辨、LINE 內建瀏覽器；intent 網址拿掉 openExternalBrowser', () => {
  globalThis.navigator ??= {};
  const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
  assert.equal(install.platform(mac, 5).ios, true);
  assert.equal(install.platform(mac, 0).ios, false);
  assert.equal(install.platform('Mozilla/5.0 (Linux; Android 14) Line/15.0', 5).inApp, true);
  assert.equal(install.intentUrl('https://climbio.web.app/r/a/b/?openExternalBrowser=1'), 'intent://climbio.web.app/r/a/b/#Intent;scheme=https;end');
});

test('電腦版工具的手機介紹頁：有觸控、螢幕短邊小於 600 才是手機（轉橫也算；iPad、折疊機的內螢幕、觸控筆電、電腦不算）', () => {
  const phone = (w, h, touch = 5, coarse = true) => [landing.isPhone({ touch, coarse, w, h }), landing.isPhone({ touch, coarse, w: h, h: w })];
  // 手機（CSS 像素的螢幕大小）：直的、橫的都是手機
  for (const [name, w, h] of [['iPhone SE', 375, 667], ['iPhone 16', 393, 852], ['iPhone 16 Pro Max', 440, 956], ['Pixel 7', 412, 915], ['Galaxy S24 Ultra', 384, 832],
    ['Galaxy Z Fold 外螢幕', 344, 882], ['Pixel Fold 外螢幕', 411, 797], ['Galaxy Z Flip', 412, 919]]) assert.deepEqual(phone(w, h), [true, true], name);
  // 平板、折疊機的內螢幕：直的、橫的都照常打開工具
  for (const [name, w, h] of [['iPad mini', 744, 1133], ['iPad', 820, 1180], ['iPad Air 13', 1024, 1366], ['iPad Pro 11', 834, 1210], ['iPad Pro 13', 1032, 1376],
    ['Galaxy Z Fold 內螢幕', 690, 829], ['Pixel Fold 內螢幕', 701, 841], ['Galaxy Tab S9', 800, 1280]]) assert.deepEqual(phone(w, h), [false, false], name);
  // iPadOS 的 Safari 用電腦的 UA，但有觸控點、主要指標是手指
  assert.equal(landing.isPhone({ touch: 5, coarse: false, w: 744, h: 1133 }), false);
  assert.equal(landing.isPhone({ touch: 10, coarse: false, w: 1920, h: 1080 }), false);
  assert.equal(landing.isPhone({ touch: 0, coarse: false, w: 390, h: 844 }), false);   // 沒有觸控（電腦把視窗拉窄）
});

test('v2 照片畫面：origin 預設自己拍的，紙本傳 null；有位置才帶 camera', () => {
  const raw = photo.readExif(withExif(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { model: 'iPhone 15', time: '2026:10:28 10:13:20', focal35: 26, lat: 25.1, lng: 121.9, alt: 12, heading: 10, headingRef: 'M' }));
  const v = photo.view({ id: 'p1', w: 4, h: 3, license: 'CC-BY-SA-4.0', attribution: '我', raw, declination: -5 });
  assert.equal(v.origin, 'self');
  assert.equal(v.href, 'p1.jpg');
  assert.deepEqual(v.camera.position, [121.9, 25.1, 12]);
  assert.equal(v.camera.heading, 5);
  const paper = photo.view({ id: 'p2', w: 4, h: 3, license: 'CC-BY-SA-4.0', origin: null });
  assert.equal('origin' in paper, false);
  assert.equal('camera' in paper, false);
});

test('檔案：ZIP 打包再解開內容不變、中文檔名保留，safeName 擋掉路徑字元，不是 ZIP 就丟錯', async () => {
  const { files } = AppKit;
  const out = await files.unzip(await files.zip([{ name: '岩場/index.json', blob: new Blob(['{"a":1}']) }, { name: 'p.jpg', blob: new Blob([new Uint8Array([0xff, 0xd8, 1, 2])]) }]));
  assert.deepEqual(out.map(x => x.name), ['岩場/index.json', 'p.jpg']);
  assert.equal(await out[0].blob.text(), '{"a":1}');
  assert.deepEqual([...new Uint8Array(await out[1].blob.arrayBuffer())], [0xff, 0xd8, 1, 2]);
  assert.equal(files.safeName('../a/b:c?.zip'), '_a_b_c_.zip');
  assert.equal(files.safeName('...'), '未命名');
  assert.match(files.rid(8), /^[0-9a-z]{8}$/);
  await assert.rejects(files.unzip(new Blob(['not a zip file, long enough to scan for the end header....'])), /不是 ZIP/);
});
