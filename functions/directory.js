// 總目錄：找牆面找得到別人架的站（格式見 docs/route-format.md 的「總目錄」）。Hosting 把 /dir/** 轉給雲端函式 siteDirectory。
//   POST /dir/register { url }：站自己登記（App 打開時每台手機一週最多送一次；總目錄自己的站不送，由每天的複查補上）。去讀 {url}/climbio.json（站的組合）驗證
//     （https、通過 @climbio/format 的 validate、type: site、props.listed: true、props.url 就是自己）才收進 dirSites/{站代號}；同一站 6 小時內驗過就不再讀。
//     每天最多讀同一站 4 次、全部 200 次（dirRate/{站代號}、dirRate/all）：不看請求的 IP（x-forwarded-for 用戶端能偽造），只限制能造成的讀取和寫入
//   GET  /dir/gyms.json：總目錄的組合（type: directory），一項是一個站的一間岩館（那個站的岩館清單），從 dirIndex/all 讀
// 每天重新驗證所有站（refreshDirectory）：連續 7 天讀不到、或改成 listed: false 就移除；封鎖的站（blocked: true，手動設）不收
const { createHash } = require('node:crypto');
const { validate } = require('./format');
const { directorySet } = require('./open-format');
const DAY = 864e5, RECHECK = 6 * 3600e3, MAX_FAILS = 7, SITE_LIMIT = 4, DAY_LIMIT = 200, MAX_BYTES = 256 * 1024;
const siteId = (url) => createHash('sha256').update(url).digest('hex').slice(0, 24);

// 只收 https 的網域（不帶路徑），不收 IP、localhost、內部網域
function siteOrigin(text) {
  let u;
  try { u = new URL(String(text || '')); } catch (e) { return null; }
  const h = u.hostname;
  if (u.protocol !== 'https:' || u.username || u.password || (u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) return null;
  if (!h.includes('.') || /^[\d.]+$/.test(h) || h.includes(':') || /(^|\.)(localhost|local|internal|test|example|invalid)$/.test(h)) return null;
  return u.origin;
}

// 讀站的 climbio.json：格式對、listed、網址就是自己才回 { url, name, gyms: [{ gym, n, t, href }] }；不然丟錯（code：unreachable、invalid、unlisted）
// 岩館清單（href）只收同一個站的
async function checkSite(url, fetchImpl = fetch) {
  let res, text;
  try {
    res = await fetchImpl(`${url}/climbio.json`, { redirect: 'error', signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } });
    text = res.ok ? await res.text() : '';
  } catch (e) { throw Object.assign(new Error('unreachable'), { code: 'unreachable' }); }
  if (!res.ok) throw Object.assign(new Error('unreachable'), { code: 'unreachable' });
  let d = null;
  try { d = text.length <= MAX_BYTES ? JSON.parse(text) : null; } catch (e) { d = null; }
  const p = (d && d.props) || {};
  if (!d || validate(d).length || d.kind !== 'set' || d.type !== 'site' || siteOrigin(p.url) !== url) throw Object.assign(new Error('invalid'), { code: 'invalid' });
  if (p.listed !== true) throw Object.assign(new Error('unlisted'), { code: 'unlisted' });
  const gyms = (d.items || []).map(x => ({ gym: x.name, n: x.props && x.props.walls, t: x.t || 0, href: new URL(x.href, `${url}/climbio.json`).href }))
    .filter(g => typeof g.gym === 'string' && g.gym && g.gym.length <= 60 && Number.isSafeInteger(g.n) && g.n > 0 && g.href.startsWith(`${url}/`))
    .slice(0, 2000);
  return { url, name: (typeof d.name === 'string' ? d.name : '').slice(0, 60) || new URL(url).hostname, gyms };
}

// 所有站合成一份：每個站的每間岩館一項（同一間岩館在很多站就有很多項），最新的在前
async function rebuildIndex(db, now) {
  const docs = (await db.collection('dirSites').get()).docs.filter(d => !d.get('blocked'));
  const gyms = docs.flatMap(d => (d.get('gyms') || []).map(g => ({ ...g, site: d.get('name') }))).sort((a, b) => b.t - a.t);
  const index = { gyms, t: now };
  await db.collection('dirIndex').doc('all').set(index);
  return index;
}

async function register({ db, url, now, fetchImpl }) {
  const day = Math.floor(now / DAY), rates = [[db.collection('dirRate').doc(siteId(url)), SITE_LIMIT], [db.collection('dirRate').doc('all'), DAY_LIMIT]];
  const allowed = await db.runTransaction(async tx => {
    const used = await Promise.all(rates.map(async ([ref]) => { const r = await tx.get(ref); return r.exists && r.get('day') === day ? r.get('n') || 0 : 0; }));
    if (rates.some(([, limit], i) => used[i] >= limit)) return false;
    rates.forEach(([ref], i) => tx.set(ref, { day, n: used[i] + 1 }));
    return true;
  });
  if (!allowed) return { status: 429, body: { error: 'too many' } };
  const ref = db.collection('dirSites').doc(siteId(url)), old = await ref.get();
  if (old.exists && old.get('blocked')) return { status: 403, body: { error: 'blocked' } };
  if (old.exists && !old.get('fails') && now - (old.get('checkedAt') || 0) < RECHECK) return { status: 200, body: { ok: true } };
  let site;
  try { site = await checkSite(url, fetchImpl); }
  catch (e) {
    if (e.code === 'unlisted' && old.exists) { await ref.delete(); await rebuildIndex(db, now); }
    return { status: 400, body: { error: e.code || 'invalid' } };
  }
  await ref.set({ ...site, checkedAt: now, fails: 0 });
  await rebuildIndex(db, now);
  return { status: 200, body: { ok: true } };
}

// 每天：重新讀每一站；讀不到記一次，連續 7 次就移除；改成不列出的移除
// self＝總目錄自己的站：它的 App 不向自己登記，不在清單裡就在這裡補讀
async function refreshDirectory({ db, now, fetchImpl, self }) {
  const docs = (await db.collection('dirSites').get()).docs;
  if (self && !docs.some(d => d.id === siteId(self))) {
    try { await db.collection('dirSites').doc(siteId(self)).set({ ...await checkSite(self, fetchImpl), checkedAt: now, fails: 0 }); }
    catch (e) { console.error('總目錄讀不到自己的站', e.code || e); }
  }
  for (const d of docs) {
    if (d.get('blocked')) continue;
    try { await d.ref.set({ ...await checkSite(d.get('url'), fetchImpl), checkedAt: now, fails: 0 }); }
    catch (e) {
      const fails = (d.get('fails') || 0) + 1;
      if (e.code === 'unlisted' || fails >= MAX_FAILS) await d.ref.delete();
      else await d.ref.set({ fails }, { merge: true });
    }
  }
  return rebuildIndex(db, now);
}

function createDirectoryHandler({ db, fetchImpl }) {
  return async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') { res.set({ 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '3600' }); return res.status(204).send(''); }
    try {
      if (req.path === '/dir/gyms.json' && req.method === 'GET') {
        const d = await db.collection('dirIndex').doc('all').get(), host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
        return res.set('Cache-Control', 'public, max-age=3600').json(directorySet({ origin: `https://${host}`, gyms: (d.exists && d.get('gyms')) || [] }));
      }
      if (req.path === '/dir/register' && req.method === 'POST') {
        res.set('Cache-Control', 'no-store');
        const url = siteOrigin(req.body && req.body.url);
        if (!url) return res.status(400).json({ error: 'invalid url' });
        const r = await register({ db, url, now: Date.now(), fetchImpl });
        return res.status(r.status).json(r.body);
      }
      return res.set('Cache-Control', 'no-store').status(404).json({ error: 'not found' });
    } catch (e) {
      console.error('總目錄失敗', e);
      return res.set('Cache-Control', 'no-store').status(500).json({ error: 'unavailable' });
    }
  };
}

module.exports = { siteOrigin, checkSite, rebuildIndex, register, refreshDirectory, createDirectoryHandler };
