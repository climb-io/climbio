// retrace 的防濫用（沒有帳號、不用登入，docs/proposals/open-versions.md）：只擋惡意攻擊，所以簡單——
//   Firebase 的 App Check 確認請求來自真的 Climbio 網頁（index.js 驗），再加每個網路來源（IP 的雜湊，不存 IP）每天 IP_LIMIT 次（一間岩館一天 30 次）。
const { createHash } = require('node:crypto');

const IP_LIMIT = 30;
const taipeiDay = (now) => Math.floor((now + 8 * 3600e3) / 864e5);
const ipHash = (req) => createHash('sha256').update(String((req.get && req.get('x-forwarded-for')) || req.ip || '').split(',')[0].trim()).digest('hex').slice(0, 16);

/** 這個請求的識別（網路來源的雜湊） */
const idOf = (req) => `ip:${ipHash(req)}`;

/** 今天還能重描就記一次、回 true（記在 Firestore quota/{id}.retrace: { day, n }，台北時間零點重算） */
async function takeQuota(db, id, now = Date.now(), limit = IP_LIMIT) {
  const ref = db.collection('quota').doc(id), day = taipeiDay(now);
  return db.runTransaction(async (tx) => {
    const q = await tx.get(ref), d = q.exists && q.get('retrace'), used = d && d.day === day ? d.n || 0 : 0;
    if (used >= limit) return false;
    tx.set(ref, { retrace: { day, n: used + 1 } }, { merge: true });
    return true;
  });
}

module.exports = { idOf, takeQuota, IP_LIMIT };
