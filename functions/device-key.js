// 裝置金鑰：岩友在公開牆寫自己的路線不用登入。手機第一次要寫時產生一把 ECDSA P-256 金鑰，公鑰指紋（SHA-256 前 32 碼）就是 kid，
// 路線的擁有者記成 `k:<kid>`；每個寫入請求帶公鑰和簽章，伺服器驗過才算。沒有登入帳號，所以防濫用靠：App Check、新金鑰第一天的低額度、
// 每個網路來源的每日總量、管理者封鎖（deviceKeys/{kid}.blocked）。設計見 docs/proposals/device-key-routes.md。
const crypto = require('crypto');

const KID = /^[0-9a-f]{32}$/, B64U = /^[A-Za-z0-9_-]+$/, NONCE = /^[A-Za-z0-9_-]{8,64}$/;
const WINDOW_MS = 5 * 60e3;
const fail = (status, error) => Object.assign(new Error(error), { status });

const kidOf = jwk => crypto.createHash('sha256').update(`${jwk.x}.${jwk.y}`).digest('hex').slice(0, 32);
/** 要簽的訊息：操作、牆、時間、亂數、要寫的線、要刪的線；兩邊都用 JSON.stringify 同一個陣列，順序固定 */
const message = (op, body) => JSON.stringify([op, body.pid, body.auth.ts, body.auth.nonce, body.routes === undefined ? [] : body.routes, body.del === undefined ? [] : body.del]);

const seen = new Map();   // 簽章 → 過期時間：同一個簽章五分鐘內只收一次（每個執行個體各自記，擋重放）

/** 驗一個簽章過的請求，回 kid；不合就丟 { status } */
function verifyRequest(op, body, now = Date.now()) {
  const a = body && body.auth;
  if (!a || typeof a !== 'object' || !KID.test(a.kid || '') || !a.pub || a.pub.kty !== 'EC' || a.pub.crv !== 'P-256') throw fail(401, 'bad key');
  for (const k of ['x', 'y']) if (typeof a.pub[k] !== 'string' || a.pub[k].length !== 43 || !B64U.test(a.pub[k])) throw fail(401, 'bad key');
  if (kidOf(a.pub) !== a.kid) throw fail(401, 'bad key');
  if (!Number.isFinite(a.ts) || Math.abs(now - a.ts) > WINDOW_MS || !NONCE.test(a.nonce || '')) throw Object.assign(fail(401, 'stale'), { extra: { now } });   // 回伺服器的時間，手機時鐘差太多時照它重簽
  if (typeof a.sig !== 'string' || a.sig.length !== 86 || !B64U.test(a.sig)) throw fail(401, 'bad signature');
  let ok = false;
  try { ok = crypto.verify('sha256', Buffer.from(message(op, body)), { key: crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: a.pub.x, y: a.pub.y }, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(a.sig, 'base64url')); } catch (e) { ok = false; }
  if (!ok) throw fail(401, 'bad signature');
  for (const [s, t] of seen) if (t < now) seen.delete(s);
  if (seen.has(a.sig)) throw fail(401, 'replay');
  if (seen.size > 20000) seen.clear();
  seen.set(a.sig, now + WINDOW_MS);
  return a.kid;
}

module.exports = { verifyRequest, kidOf, message, KID, WINDOW_MS };
