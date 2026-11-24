const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HOSTS, ORIGINS, isPreview } = require('./site');


test('主站網域：climbio.app 是主要網址，climbio.web.app 也是正式站，開發版共用資料；都是允許的來源', () => {
  assert.equal(HOSTS[0], 'climbio.app');
  assert.ok(HOSTS.includes('climbio.web.app') && HOSTS.includes('climbio-dev.web.app'));
  for (const o of ['https://climbio.app', 'https://climbio.web.app', 'https://climbio-dev.web.app']) assert.ok(ORIGINS.includes(o), o);
  assert.ok(!ORIGINS.includes('https://evil.example'));
  assert.ok(isPreview('https://climbio--pr1-abc.web.app') && isPreview('https://climbio-dev--x.web.app') && !isPreview('https://evil--x.web.app'));
});
