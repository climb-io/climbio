const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHandler, isTestOrigin } = require('./client-errors');

function call(handler, { method = 'POST', origin = 'https://climbio-dev.web.app', body } = {}) {
  const res = { statusCode: 200, headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.statusCode = c; return this; }, send(x) { this.body = x; return this; } };
  handler({ method, body, get: (k) => (k === 'origin' ? origin : undefined) }, res);
  return res;
}

test('只收測試版（開發版、Eric 的站、它們的預覽頻道）；正式版、別的網站不收', () => {
  assert.deepEqual(['https://climbio-dev.web.app', 'https://climbio-eric.web.app', 'https://climbio-dev--pr12-ab3.web.app'].map(isTestOrigin), [true, true, true]);
  assert.deepEqual(['https://climbio.app', 'https://climbio.web.app', 'https://evil.web.app', 'https://climbio-dev.web.app.evil.com', ''].map(isTestOrigin), [false, false, false, false, false]);
  const lines = [], h = createHandler({ log: l => lines.push(l) });
  assert.equal(call(h, { origin: 'https://climbio.app', body: { msg: 'x' } }).statusCode, 403);
  assert.equal(call(h, { method: 'GET' }).statusCode, 405);
  assert.equal(lines.length, 0);
});

test('一筆錯誤寫成 Error Reporting 的紀錄（text/plain 的 JSON 也收）；欄位截短；空的不收', () => {
  const lines = [], h = createHandler({ log: l => lines.push(l) });
  const body = JSON.stringify({ app: 'studio', v: 'v1490', page: '/studio/crag/', msg: 'boom', stack: 'TypeError: boom\n    at f (app.js:1:2)', file: 'https://climbio-dev.web.app/studio/crag/app.js', line: 1, kind: 'error', ua: 'UA', extra: 'x'.repeat(10) });
  assert.equal(call(h, { body }).statusCode, 204);
  const ev = JSON.parse(lines[0]);
  assert.equal(ev['@type'], 'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent');
  assert.deepEqual([ev.severity, ev.message, ev.serviceContext.service, ev.serviceContext.version], ['ERROR', 'TypeError: boom\n    at f (app.js:1:2)', 'web-studio', 'v1490']);
  assert.equal(ev.context.httpRequest.url, 'https://climbio-dev.web.app/studio/crag/');
  assert.equal(ev.extra, undefined);
  assert.equal(call(h, { body: { msg: 'm'.repeat(2000), app: 'BAD APP' } }).statusCode, 204);
  const long = JSON.parse(lines[1]);
  assert.equal(long.message.length, 500);
  assert.equal(long.serviceContext.service, 'web-web');
  assert.equal(call(h, { body: {} }).statusCode, 400);
  assert.equal(call(h, { body: 'not json' }).statusCode, 400);
});
