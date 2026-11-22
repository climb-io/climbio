const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifyPublisher, message } = require('./publisher-key');
const { kidOf } = require('./device-key');

function key() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }), pub = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
  return { privateKey, pub, kid: kidOf(pub) };
}
const signed = (k, op, id, extra = '', ts = 2e12, nonce = crypto.randomBytes(12).toString('base64url')) => {
  const auth = { kid: k.kid, pub: k.pub, ts, nonce };
  auth.sig = crypto.sign('sha256', Buffer.from(message(op, id, auth, extra)), { key: k.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return auth;
};

test('發佈金鑰：簽章對、操作和牆都對才過，回 kid', () => {
  const k = key();
  assert.equal(verifyPublisher('publishWall', 'abcdefgh12345678', signed(k, 'publishWall', 'abcdefgh12345678'), '', 2e12), k.kid);
  const a = signed(k, 'transferWall', 'abcdefgh12345678', 'f'.repeat(32));
  assert.equal(verifyPublisher('transferWall', 'abcdefgh12345678', a, 'f'.repeat(32), 2e12), k.kid);
});

test('發佈金鑰：換了操作、牆、轉交對象或簽章都拒絕；過期、重放、公鑰不符也拒絕', () => {
  const k = key(), id = 'abcdefgh12345678';
  assert.throws(() => verifyPublisher('unpublish', id, signed(k, 'publishWall', id), '', 2e12), { status: 401 });
  assert.throws(() => verifyPublisher('publishWall', 'otherotherother00', signed(k, 'publishWall', id), '', 2e12), { status: 401 });
  assert.throws(() => verifyPublisher('transferWall', id, signed(k, 'transferWall', id, 'a'.repeat(32)), 'b'.repeat(32), 2e12), { status: 401 });
  assert.throws(() => verifyPublisher('publishWall', id, signed(k, 'publishWall', id, '', 2e12 - 10 * 60e3), '', 2e12), { status: 401, message: 'stale' });
  const once = signed(k, 'publishWall', id);
  verifyPublisher('publishWall', id, once, '', 2e12);
  assert.throws(() => verifyPublisher('publishWall', id, once, '', 2e12), { status: 401, message: 'replay' });
  const forged = signed(key(), 'publishWall', id); forged.kid = k.kid;   // 別人的公鑰冒用 kid
  assert.throws(() => verifyPublisher('publishWall', id, forged, '', 2e12), { status: 401 });
});
