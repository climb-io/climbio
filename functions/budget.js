// 超過預算就停止上傳：Google Cloud 的預算通知（Pub/Sub 主題 billing-budget，一天好幾則，帶這個月目前的花費）
// 寫到 config/uploads { off, cost, budget, t }。off 時上傳類函式回 503；
// 下個月花費歸零的通知來了自動恢復。登入與備份不停
const uploadsRef = (db) => db.collection('config').doc('uploads');

// 預算通知的內容 → 寫進 config/uploads 的值；格式不對回 null（不動開關）
function budgetState(msg, now) {
  const cost = Number(msg && msg.costAmount), budget = Number(msg && msg.budgetAmount);
  if (!Number.isFinite(cost) || !Number.isFinite(budget) || budget <= 0) return null;
  return { off: cost >= budget, cost, budget, t: now };
}

// 寫 Firestore 的開關（雲端函式看這個）
async function applyBudget(db, msg, now) {
  const s = budgetState(msg, now);
  if (!s) { console.warn('看不懂的預算通知', JSON.stringify(msg)); return null; }
  if (s.off) console.warn(JSON.stringify({ uploadsOff: s }));
  await uploadsRef(db).set(s);
  return s;
}

const uploadsOff = async (db) => (await uploadsRef(db).get()).get('off') === true;
// 包住上傳類的 HTTP 函式：停止上傳時回 503
const whenUploadsOn = (db, handler) => async (req, res) => {
  if (await uploadsOff(db)) return res.set('Cache-Control', 'no-store').status(503).json({ error: 'uploads paused' });
  return handler(req, res);
};

module.exports = { budgetState, applyBudget, uploadsOff, whenUploadsOn };
