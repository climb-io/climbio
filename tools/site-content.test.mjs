import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
const locales = ['', 'en/', 'zh-cn/', 'ja/', 'ko/', 'fr/', 'es/', 'de/'];

test('八語文件首頁只提供人類使用與專案入口', () => {
  for (const prefix of locales) {
    const doc = read(prefix + 'guides/index.html');
    const project = read(prefix + 'project/index.html');
    assert.match(doc, /href="\.\.\/project\/"/, prefix + ' missing project entry');
    assert.doesNotMatch(doc, /href="[^"]*\/kits\//, prefix + ' developer kit in docs');
    assert.doesNotMatch(doc, /href="[^"]*redpoint-sites\//, prefix + ' integration in docs');
    assert.match(project, /github\.com\/climb-io\/climbio\/blob\/main\/docs\/gym-onboarding\.md/, prefix + ' missing onboarding guide');
  }
});

test('Kit 網站示範用途，安裝命令和程式範例留在 GitHub', () => {
  const names = ['format','routekit','topokit','crag3dkit','wall3dkit','mapkit','holdkit','holdscan','sourcekit','appkit'];
  for (const prefix of ['kits/','kits/en/']) {
    for (const name of names) {
      const page = read(prefix + name + '.html');
      assert.doesNotMatch(page, /<section[^>]*aria-labelledby="install"/);
      assert.doesNotMatch(page, /<pre[\s>]/);
      assert.match(page, /github\.com\/climb-io\/climbio/);
    }
  }
  const generator = read('tools/build-kits.mjs');
  assert.doesNotMatch(generator, /c\.(install|example|notes)/);
});

test('收藏入口不在網站串接和路線書轉換頁重複出現', () => {
  assert.doesNotMatch(read('redpoint-sites/index.html'), /href="[^"]*redpoint-collect\//);
  const conversion = read('guides/convert/index.html');
  assert.doesNotMatch(conversion, /href="[^"]*redpoint-collect\//);
  assert.doesNotMatch(conversion, /id="promptCli"/);
  assert.match(conversion, /raw\.githubusercontent\.com\/climb-io\/climbio/);
});
