import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 一般使用者的四個入口：每種語言都要進到對應頁；收藏工具只有首頁和文件首頁直接連。
const origin = 'https://climbio.app/';
const root = new URL('../', import.meta.url);
const locales = ['', 'en/', 'zh-cn/', 'ja/', 'ko/', 'fr/', 'es/', 'de/'];
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const links = (path) => [...read(path).matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)]
  .map((m) => new URL(m[1], new URL(path, origin)).pathname);

test('一般使用者入口：八語首頁與文件首頁各自連到同語言的收藏頁', () => {
  for (const locale of locales) {
    const collect = '/' + locale + 'redpoint-collect/';
    const home = links(locale + 'index.html');
    const docs = links(locale + 'guides/index.html');
    const manual = links(locale + 'guides/redpoint-manual.html');

    assert.equal(home.filter((path) => path === collect).length, 2, locale + ' 首頁兩種版位');
    assert.equal(docs.filter((path) => path === collect).length, 1, locale + ' 文件首頁');
    assert.equal(manual.filter((path) => path.includes('/redpoint-collect/')).length, 0, locale + ' 使用手冊沒有第三個入口');
    for (const expected of ['/hold/', '/' + locale + 'guides/friends.html', '/redpoint/', collect]) {
      assert.ok(home.includes(expected), locale + ' 首頁缺少 ' + expected);
    }
    read(locale + 'redpoint-collect/index.html');
    read(locale + 'guides/friends.html');
  }
});
