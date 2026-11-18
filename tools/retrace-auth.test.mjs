// retrace 的防濫用（holdkit/functions/retrace-auth.js）：只靠 App Check（index.js 驗）和每個網路來源每天 IP_LIMIT 次
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { idOf, takeQuota, IP_LIMIT } = require('../holdkit/functions/retrace-auth.js');

const NOW = 2e12;
const fakeDb = () => {
  const docs = new Map();
  const snap = (p) => ({ exists: docs.has(p), get: (k) => (docs.get(p) || {})[k] });
  return { docs, collection: (c) => ({ doc: (id) => ({ path: `${c}/${id}` }) }),
    runTransaction: async (fn) => fn({ get: async (ref) => snap(ref.path), set: (ref, v) => { docs.set(ref.path, { ...(docs.get(ref.path) || {}), ...v }); } }) };
};
const req = (ip) => ({ ip, get: () => '' });

test('識別是網路來源的雜湊（同一個來源一樣、不同來源不同，不存 IP）', () => {
  assert.equal(idOf(req('1.1.1.1')), idOf(req('1.1.1.1')));
  assert.notEqual(idOf(req('1.1.1.1')), idOf(req('2.2.2.2')));
  assert.match(idOf(req('1.1.1.1')), /^ip:[0-9a-f]{16}$/);
  assert.equal(idOf({ get: (h) => (h === 'x-forwarded-for' ? '3.3.3.3, 10.0.0.1' : '') }), idOf(req('3.3.3.3')));
});

test('每個網路來源每天 IP_LIMIT（30）次：用完回 false，別的來源不受影響，隔天重算', async () => {
  const db = fakeDb(), a = idOf(req('1.1.1.1'));
  assert.equal(IP_LIMIT, 30);
  for (let i = 0; i < IP_LIMIT; i++) assert.equal(await takeQuota(db, a, NOW), true, String(i));
  assert.equal(await takeQuota(db, a, NOW), false);
  assert.equal(await takeQuota(db, idOf(req('2.2.2.2')), NOW), true);
  assert.equal(await takeQuota(db, a, NOW + 864e5), true);
});
