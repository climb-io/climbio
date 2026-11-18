'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { clientIp } = require('./client-ip');

const req = (xff, ip) => ({ get: k => (k.toLowerCase() === 'x-forwarded-for' ? xff : undefined), ip });

test('只認 x-forwarded-for 的最後一欄，前面客戶端填的不算', () => {
  assert.equal(clientIp(req('9.9.9.9, 1.2.3.4')), '1.2.3.4');
  assert.equal(clientIp(req('1.2.3.4')), '1.2.3.4');
  assert.equal(clientIp(req('6.6.6.6, 7.7.7.7, 1.2.3.4')), clientIp(req('1.1.1.1, 1.2.3.4')));
});

test('沒有標頭就用 req.ip', () => {
  assert.equal(clientIp(req(undefined, '5.5.5.5')), '5.5.5.5');
  assert.equal(clientIp({ get: () => undefined }), '');
});
