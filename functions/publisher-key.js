// 發佈金鑰：Studio（含命令列、AI 代理）發佈公開牆時用一把 ECDSA P-256 金鑰簽章，伺服器第一次收到就把這面牆的擁有者記成這把金鑰的 kid
// （公鑰指紋，跟裝置金鑰同一種，見 device-key.js）。之後同一面牆的重新發佈、下架、轉交都要同一把金鑰簽章；維護者金鑰（X-Studio-Key）永遠可以代替。
// 沒有帳號：金鑰是一個檔案（{ kid, pub, priv }），誰拿到誰就是擁有者——岩館換 AI 代理，把金鑰檔交過去，或呼叫 transferWall 轉給新的 kid 就接手了。
const crypto = require('crypto');
const { kidOf, KID, WINDOW_MS } = require('./device-key');

const B64U = /^[A-Za-z0-9_-]+$/, NONCE = /^[A-Za-z0-9_-]{8,64}$/;
const fail = (status, error) => Object.assign(new Error(error), { status });

/** 要簽的訊息：操作、牆（包）id、時間、亂數、附帶的值（transferWall 是新的 kid，其他是空字串） */
const message = (op, id, auth, extra = '') => JSON.stringify([op, id, auth.ts, auth.nonce, extra]);

const seen = new Map();   // 簽章 → 過期時間：同一個簽章五分鐘內只收一次（擋重放）

/** 驗簽章，回 kid；不合就丟 { status } */
function verifyPublisher(op, id, auth, extra = '', now = Date.now()) {
  const a = auth;
  if (!a || typeof a !== 'object' || !KID.test(a.kid || '') || !a.pub || a.pub.kty !== 'EC' || a.pub.crv !== 'P-256') throw fail(401, 'bad key');
  for (const k of ['x', 'y']) if (typeof a.pub[k] !== 'string' || a.pub[k].length !== 43 || !B64U.test(a.pub[k])) throw fail(401, 'bad key');
  if (kidOf(a.pub) !== a.kid) throw fail(401, 'bad key');
  if (!Number.isFinite(a.ts) || Math.abs(now - a.ts) > WINDOW_MS || !NONCE.test(a.nonce || '')) throw Object.assign(fail(401, 'stale'), { extra: { now } });
  if (typeof a.sig !== 'string' || a.sig.length !== 86 || !B64U.test(a.sig)) throw fail(401, 'bad signature');
  let ok = false;
  try { ok = crypto.verify('sha256', Buffer.from(message(op, id, a, extra)), { key: crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: a.pub.x, y: a.pub.y }, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(a.sig, 'base64url')); } catch (e) { ok = false; }
  if (!ok) throw fail(401, 'bad signature');
  for (const [s, t] of seen) if (t < now) seen.delete(s);
  if (seen.has(a.sig)) throw fail(401, 'replay');
  if (seen.size > 20000) seen.clear();
  seen.set(a.sig, now + WINDOW_MS);
  return a.kid;
}

module.exports = { verifyPublisher, message, KID };
