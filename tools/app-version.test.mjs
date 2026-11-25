// 部署的版本號：App 殼沒變就沿用線上的版本號（tools/app-version.mjs）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isShell, shellHash, live, pick } from './app-version.mjs';

const lines = (files) => files.map(([path, blob]) => `100644 ${blob} 0\t${path}`);

test('App 殼：程式、樣式、語言包、各 App 的資料夾；不是：文件、各語言網頁、首頁、測試、工具、雲端函式', () => {
  for (const p of ['hold/index.html', 'js/sync.js', 'css/app.css', 'appkit/sw.js', 'i18n/hold/zh.js', 'redpoint/app.js', 'studio/wall/app.js', 'holdkit/samrefine.js', 'site.js', 'sw.js', 'new-kit/x.js']) assert.equal(isShell(p), true, p);
  for (const p of ['index.html', 'docs/app.md', 'project/index.html', 'en/project/index.html', 'ja/index.html', 'guides/convert/index.html', 'tests/e2e/a.spec.mjs', 'tools/a.mjs', 'functions/walls.js', 'holdkit/functions/index.js', 'holdkit/README.md', 'version.js', 'package.json', 'terms.html', 'gyms/tw.json', 'embed/routekit/v2/app.js', 'js/a.test.mjs']) assert.equal(isShell(p), false, p);
});

test('改首頁、文件、別的語言的網頁：雜湊不變；改 App 的程式或語言包：雜湊變', () => {
  const base = [['hold/index.html', 'a1'], ['js/sync.js', 'b1'], ['index.html', 'c1'], ['docs/app.md', 'd1'], ['en/project/index.html', 'e1'], ['i18n/hold/zh.js', 'f1']];
  const h = shellHash(lines(base));
  const change = (path, blob) => shellHash(lines(base.map(([p, b]) => [p, p === path ? blob : b])));
  assert.equal(change('index.html', 'c2'), h);
  assert.equal(change('docs/app.md', 'd2'), h);
  assert.equal(change('en/project/index.html', 'e2'), h);
  assert.notEqual(change('js/sync.js', 'b2'), h);
  assert.notEqual(change('i18n/hold/zh.js', 'f2'), h);
  assert.notEqual(shellHash(lines([...base, ['css/new.css', 'g1']])), h);   // 新增 App 的檔案
});

test('線上的 shell.hash 跟這次一樣就沿用線上的版本號；不一樣、讀不到、線上比新的還大都用新的', async () => {
  const hash = 'a'.repeat(64);
  assert.equal(pick({ now: hash, fresh: 2600, online: { hash, number: 2511 } }), 2511);
  assert.equal(pick({ now: hash, fresh: 2600, online: { hash: 'b'.repeat(64), number: 2511 } }), 2600);
  assert.equal(pick({ now: hash, fresh: 2600, online: { hash: null, number: 2511 } }), 2600);
  assert.equal(pick({ now: hash, fresh: 2600, online: { hash, number: null } }), 2600);
  assert.equal(pick({ now: hash, fresh: 2600, online: { hash, number: 2700 } }), 2600);   // 不倒退
});

test('讀線上：版本號取 climbio-v 後面的數字（含 -hk 後綴），逾時、錯誤、格式不對都是 null', async () => {
  const hash = 'c'.repeat(64);
  const ok = async (url) => ({ ok: true, text: async () => (url.includes('shell.hash') ? `${hash}\n` : "self.CLIMBIO_VERSION = 'climbio-v2511-hk1.9.0';") });
  assert.deepEqual(await live('climbio', ok), { hash, number: 2511 });
  assert.deepEqual(await live('climbio', async () => { throw new Error('offline'); }), { hash: null, number: null });
  assert.deepEqual(await live('climbio', async () => ({ ok: false, text: async () => '' })), { hash: null, number: null });
  assert.deepEqual(await live('climbio', async (url) => ({ ok: true, text: async () => (url.includes('shell.hash') ? '不是雜湊' : 'x') })), { hash: null, number: null });
});
