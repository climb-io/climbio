import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// site.js 依網域判斷主站：climbio.app、climbio.web.app 是正式站，climbio-dev.web.app 是開發版（也接主網後端），其他網域是自己架的站
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const site = (hostname, path = '/hold/') => {
  const ctx = vm.createContext({ URL, location: { hostname, href: `https://${hostname}${path}` }, localStorage: { getItem: () => null } });
  ctx.window = ctx;
  vm.runInContext(read('site.js'), ctx);
  return ctx.SITE;
};
// 開發版標示（js/boot.js）
const line = (f, s) => read(f).split('\n').find(l => l.includes(s));
const devHosts = vm.runInNewContext(/\[('[^']*',? ?)+\]/.exec(line('js/boot.js', "'climbio-dev.web.app'"))[0]);

test('climbio.app 與 climbio.web.app 都是主站：接 Firebase、列進總目錄，網址和總目錄都是 climbio.app', () => {
  for (const h of ['climbio.app', 'climbio.web.app']) {
    const s = site(h);
    assert.equal(s.backend, 'firebase', h);
    assert.equal(s.listed, true, h);
    assert.equal(s.url, 'https://climbio.app', h);
    assert.equal(s.directory, 'https://climbio.app', h);
    assert.ok(!devHosts.includes(h), h);
  }
});

test('climbio-dev.web.app 是開發版：接主網後端、標示開發版', () => {
  assert.equal(site('climbio-dev.web.app').backend, 'firebase');
  assert.ok(devHosts.includes('climbio-dev.web.app'));
});

test('其他網域是自己架的站：不接後端、不列進總目錄，網址是 App 資料夾的上一層', () => {
  const s = site('my-wall.example', '/climbio/hold/');
  assert.equal(s.backend, 'none');
  assert.equal(s.listed, false);
  assert.equal(s.url, 'https://my-wall.example/climbio');
  assert.deepEqual({ ...s.cloud }, {});
});

