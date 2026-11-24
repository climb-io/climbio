// Studio 同步服務（雲端函式 studioSync）：把專案資料夾的工作紀錄（.studio/work/）和檔案放到自己的 Firebase，
// 給不同電腦、雲端的代理用命令列（tools/studio.mjs push／pull）交接同一個專案；人在 AI 對話裡答題，代理記下再推。格式見 docs/studio-work.md。
// 每個人部署到自己的 Firebase 專案；標頭 X-Studio-Key 放同步金鑰（Secret STUDIO_KEY），有金鑰的就是擁有者自己的裝置或代理。
// 設了 STUDIO_GITHUB_REPO（owner/repo）時，同一個標頭也收 GitHub 權杖：對那個 repo 有寫入權限的人（協作者）就算擁有者，
// 各台電腦、各個代理用本機 gh 登入的身分就能同步，不用發金鑰；拿掉協作者就失效。權杖只拿去問 GitHub，不存（只快取雜湊和結果）。
// 不用 Authorization: Bearer：Google 的前端有時把它當成 Google 的身分權杖驗證，請求到不了函式就被擋（401 HTML）。
// 只存、不判斷：題目怎麼算、判斷合不合規則由用戶端（studio/work/ledger.js）決定，這裡只檢查形狀和大小。
//
//   GET                       { ok: true, auth }：服務開了沒、金鑰（或 GitHub 權杖）對不對
//   GET  ?pid=&path=          下載檔案（分段的大檔不行，照 parts 一段一段用 ?pid=&sha= 下載）
//   GET  ?pid=&sha=           照內容下載一段（sha256）；內容不會變，回 Cache-Control: immutable
//   下載都看 Accept-Encoding：收 gzip 就送壓好的（照內容存的壓一次存成 <blob>.gz）
//   PUT  ?pid=&path=          上傳檔案（內容是原始位元組，最多 30 MB）：照內容存（sha256），還不算進專案；push 帶著檔案清單才換上。
//                             超過 30 MB 的檔（3D 模型）用戶端切成幾段各傳一次（雲端函式一次請求最多約 32 MB），清單記 parts
//   POST { op: 'list' }                         專案清單：[{ id, name, line, state, updated, rev }]
//   POST { op: 'push', pid, base, name, line, state, files, questions, decisions, runs, notes }
//        base 是這次推之前看到的版本（rev；新專案不用帶）：跟服務上的不一樣（別的代理在中間推過）就回 409，什麼都不改，先 pull 再推。
//        files 是這次換上的檔案 { 路徑: { sha256, size, parts? } }（parts 是分段的 sha256，照順序接起來是整個檔）（內容先用 PUT 傳好）；題目整份換掉（代理照資料重算的）；判斷、執行紀錄、筆記照 id 合併，不刪；版本加一
//   POST { op: 'pull', pid }                    { project, questions, decisions, runs, notes }；project.files 是檔案清單 { 路徑: { sha256, size } }，project.rev 是版本
//   POST { op: 'trialLink', pid, days? }        擁有者替一個 3D 牆專案發試用權杖（預設 7 天、最多 30 天）：{ token, exp }；只存雜湊，再發一次舊的就失效
//
// 試用權杖（標頭 X-Studio-Trial，連結放在 # 後面，不進伺服器紀錄）：給手機上的人試用一面 3D 牆、回報問題，不用金鑰。只能對發給它的那個專案：
//   GET  ?pid=&path=、?pid=&sha=  下載檔案
//   POST { op: 'pull', pid }       只有 project（檔案清單、版本），沒有題目和判斷
//   POST { op: 'feedback', pid, text }  寫回 feedback3d.json（climbio-3d-feedback/1，200 KB 以內）：換上檔案清單、版本加一，代理 pull 就拿到
//
// Firestore（資料庫 climbio）：studioProjects/{pid}，子集合 questions、decisions、runs、notes；Storage：studio/{pid}/{路徑}
const { createHash, timingSafeEqual, randomBytes } = require('node:crypto');
const { gzipSync } = require('node:zlib');

const PID = /^[0-9a-z]{16}$/, RID = /^[A-Za-z0-9._-]{1,120}$/;
const SEGMENT = /^[A-Za-z0-9À-￿][A-Za-z0-9À-￿ ._()-]{0,120}$/;
const MAX_FILE = 30 << 20, MAX_BIG = 2 * 1024 ** 3, MAX_PARTS = 100, MAX_LIST = 2000, MAX_JSON = 200 << 10, BATCH = 400;
const fail = (status, error) => Object.assign(new Error(error), { status });

/** 檔案在專案裡的路徑：相對路徑，每段不能是 . 開頭以外的怪字元；.studio/source/ 底下的可以，.studio/work/ 不行（工作紀錄走 JSON） */
function validPath(p) {
  if (typeof p !== 'string' || p.length > 300 || p.startsWith('.studio/work/')) return false;
  const parts = p.split('/');
  return parts.every((s, i) => SEGMENT.test(s) || (i === 0 && s === '.studio'));
}
const small = (x) => JSON.stringify(x ?? null).length <= MAX_JSON;
const SHA = /^[0-9a-f]{64}$/;
/** 照內容存的檔案：studio/{pid}/blobs/{sha256} */
const blobOf = (pid, sha256) => `studio/${pid}/blobs/${sha256}`;
/** push 帶的檔案清單：{ 路徑: { sha256, size, parts? } }；30 MB 以內是一段，比較大的要分段（每段 30 MB 以內） */
function fileList(files) {
  if (files === undefined) return {};
  if (!files || typeof files !== 'object' || Array.isArray(files) || Object.keys(files).length > MAX_LIST) throw fail(400, 'files');
  for (const [path, f] of Object.entries(files)) {
    const parts = f?.parts;
    const okParts = parts === undefined || (Array.isArray(parts) && parts.length >= 2 && parts.length <= MAX_PARTS && parts.every(p => SHA.test(p)));
    if (!validPath(path) || !f || !SHA.test(f.sha256 || '') || !Number.isInteger(f.size) || f.size < 0 || f.size > (parts ? MAX_BIG : MAX_FILE) || !okParts) throw fail(400, `files ${path}`);
  }
  return Object.fromEntries(Object.entries(files).map(([path, f]) => [path, { sha256: f.sha256, size: f.size, ...(f.parts ? { parts: [...f.parts] } : {}) }]));
}
/** 一筆紀錄（題目、判斷、執行紀錄、筆記）：要有合法的 id，不能太大 */
function records(list, name) {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length > MAX_LIST) throw fail(400, `${name} 要是陣列`);
  for (const x of list) if (!x || typeof x !== 'object' || !RID.test(x.id || '') || !small(x)) throw fail(400, `${name} 的紀錄不合格式`);
  return list;
}

/** 請求帶的同步金鑰（標頭 X-Studio-Key）對不對；沒設定金鑰時一律不對。發佈的函式 datasets 也用它認擁有者的代理（代替瀏覽器才拿得到的 App Check） */
function keyMatches(want, got) {
  if (!want || !got) return false;
  const a = createHash('sha256').update(want).digest(), b = createHash('sha256').update(got).digest();
  return timingSafeEqual(a, b);
}

const GH_TOKEN = /^(gh[pousr]_[A-Za-z0-9]{20,251}|github_pat_[A-Za-z0-9_]{20,251})$/;

/**
 * GitHub 權杖 → 這個人對 repo（owner/repo）有沒有寫入權限（GET /repos/{repo} 的 permissions.push）。
 * 沒設 repo、不像 GitHub 權杖的一律 false；結果照權杖的雜湊快取（有權限 10 分鐘、沒有 1 分鐘），GitHub 連不上就當沒有、不快取
 */
function githubMember({ repo, fetch = globalThis.fetch, now = () => Date.now(), max = 500 }) {
  const cache = new Map();
  return async (token) => {
    if (!repo || !GH_TOKEN.test(token || '')) return false;
    const k = createHash('sha256').update(token).digest('hex'), hit = cache.get(k);
    if (hit && hit.until > now()) return hit.ok;
    let ok;
    try {
      const r = await fetch(`https://api.github.com/repos/${repo}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'climbio-studio-sync' } });
      if (r.status >= 500) return false;
      ok = r.ok && (await r.json())?.permissions?.push === true;
    } catch { return false; }
    if (cache.size >= max) cache.delete(cache.keys().next().value);
    cache.set(k, { ok, until: now() + (ok ? 600e3 : 60e3) });
    return ok;
  };
}

const TRIAL_DAYS = 7, TRIAL_MAX = 30, DAY = 864e5;
const sha256Hex = (s) => createHash('sha256').update(s).digest('hex');

/** 標頭 X-Studio-Key 是同步金鑰，或（有 member 時）有權限的 GitHub 權杖 */
const ownerAuth = ({ key, member }) => async (req) => {
  const got = req.get('x-studio-key') || '';
  return keyMatches(key() || '', got) || (!!member && await member(got));
};

function createHandler({ db, bucket, key, member, now = () => Date.now() }) {
  const project = (pid) => db.collection('studioProjects').doc(pid);
  const sub = (pid, name) => project(pid).collection(name);
  const authed = ownerAuth({ key, member });
  const pidOf = (v) => { if (!PID.test(v || '')) throw fail(400, 'pid'); return v; };
  const all = async (pid, name) => (await sub(pid, name).get()).docs.map(d => d.data());

  /** 一次寫很多份（Firestore 一批最多 500） */
  async function writeAll(pid, name, list, { replace = false } = {}) {
    const coll = sub(pid, name);
    const keep = new Set(list.map(x => x.id));
    const ops = list.map(x => b => b.set(coll.doc(x.id), x));
    if (replace) for (const d of (await coll.get()).docs) if (!keep.has(d.id)) ops.push(b => b.delete(d.ref));
    for (let i = 0; i < ops.length; i += BATCH) {
      const b = db.batch();
      for (const op of ops.slice(i, i + BATCH)) op(b);
      await b.commit();
    }
  }

  async function post(body) {
    const op = body && body.op;
    if (op === 'list') {
      const snap = await db.collection('studioProjects').get();
      return { projects: snap.docs.map(d => { const v = d.data(); return { id: d.id, name: v.name || '', line: v.line || '', state: v.state || null, updated: v.updated || 0, rev: v.rev || 0 }; }).sort((a, b) => b.updated - a.updated) };
    }
    const pid = pidOf(body.pid);
    if (op === 'push') {
      if (typeof body.name !== 'string' || body.name.length > 200 || typeof body.line !== 'string' || !small(body.state)) throw fail(400, 'project');
      const questions = records(body.questions, 'questions'), decisions = records(body.decisions, 'decisions'), runs = records(body.runs, 'runs'), notes = records(body.notes, 'notes');
      const doc = await project(pid).get(), cur = doc.exists ? doc.data() : null, rev = cur?.rev || 0;
      // 版本對不上：別的代理在中間推過，這次不能蓋掉（先 pull 拿到別人的，再推）
      if (cur && body.base !== rev) throw Object.assign(fail(409, 'conflict'), { rev });
      const files = fileList(body.files);
      for (const [path, f] of Object.entries(files)) {
        if (cur?.files?.[path]?.sha256 === f.sha256) continue;
        for (const part of f.parts || [f.sha256]) {
          const [there] = await bucket.file(blobOf(pid, part)).exists();
          if (!there) throw fail(400, `file ${path}`);   // 內容（或其中一段）還沒用 PUT 傳上來
        }
      }
      await project(pid).set({ name: body.name, line: body.line, state: body.state || null, updated: now(), rev: rev + 1, ...(Object.keys(files).length ? { files } : {}) }, { merge: true });
      await writeAll(pid, 'questions', questions, { replace: true });
      await writeAll(pid, 'decisions', decisions);
      await writeAll(pid, 'runs', runs);
      await writeAll(pid, 'notes', notes);
      return { ok: true, rev: rev + 1 };
    }
    if (op === 'trialLink') {
      const doc = await project(pid).get();
      if (!doc.exists) throw fail(404, 'no project');
      const days = Math.min(Math.max(Number(body.days) || TRIAL_DAYS, 1), TRIAL_MAX), token = randomBytes(24).toString('base64url'), exp = now() + days * DAY;
      await project(pid).set({ trial: { hash: sha256Hex(token), exp } }, { merge: true });
      trialSeen.clear();   // 舊權杖馬上失效
      return { token, exp };
    }
    if (op === 'pull') {
      const doc = await project(pid).get();
      if (!doc.exists) throw fail(404, 'no project');
      const [questions, decisions, runs, notes] = await Promise.all(['questions', 'decisions', 'runs', 'notes'].map(n => all(pid, n)));
      return { project: { id: pid, ...doc.data() }, questions, decisions, runs, notes };
    }
    throw fail(400, 'op');
  }

  async function putFile(req) {
    const pid = pidOf(req.query.pid), path = req.query.path;
    if (!validPath(path)) throw fail(400, 'path');
    const data = req.rawBody;
    if (!data || data.length > MAX_FILE) throw fail(413, 'size');
    const sha256 = createHash('sha256').update(data).digest('hex');
    await bucket.file(blobOf(pid, sha256)).save(data, { resumable: false, contentType: req.get('content-type') || 'application/octet-stream' });
    return { ok: true, sha256, size: data.length };
  }

  async function getFile(req, res) {
    const pid = pidOf(req.query.pid);
    if (req.query.sha !== undefined) {   // 照內容存的：內容永遠不變，瀏覽器可以一直快取
      if (!SHA.test(req.query.sha || '')) throw fail(400, 'sha');
      return send(req, res, bucket.file(blobOf(pid, req.query.sha)), { immutable: true, gz: `${blobOf(pid, req.query.sha)}.gz` });
    }
    const path = req.query.path;
    if (!validPath(path)) throw fail(400, 'path');
    const doc = await project(pid).get(), entry = doc.exists ? doc.data().files?.[path] : null, sha256 = entry?.sha256 || '';
    if (entry?.parts) throw fail(413, 'parts');   // 大檔一次回不了：照清單的 parts 一段一段下載
    // 照內容存的；更早的檔案存在路徑上
    if (sha256) try { return await send(req, res, bucket.file(blobOf(pid, sha256)), { gz: `${blobOf(pid, sha256)}.gz` }); } catch (e) { if (e.status !== 404) throw e; }
    return send(req, res, bucket.file(`studio/${pid}/${path}`));
  }
  /** 送檔：瀏覽器收 gzip、檔案又壓得小（不是 jpg、png 這類已經壓過的）就送壓好的版本；照內容存的壓一次存成 <blob>.gz，之後直接送 */
  async function send(req, res, f, { immutable = false, gz = null } = {}) {
    const miss = (e) => { if (e?.code === 404) throw fail(404, 'no file'); throw e; };
    const head = (type) => {
      res.set('Content-Type', type);
      res.set('Cache-Control', immutable ? 'private, max-age=31536000, immutable' : 'private, no-store');
      const vary = (res.getHeader && res.getHeader('Vary')) || res.headers?.Vary || '';   // 追加，不能蓋掉 CORS 的 Vary: Origin（不然別的網域快取的回應會被拿來用、被擋）
      res.set('Vary', [vary, 'Accept-Encoding'].filter(Boolean).join(', '));
    };
    const accepts = /\bgzip\b/.test(req.get('accept-encoding') || '');
    if (gz && accepts) {   // 已經壓好的：只抓它，不抓原檔
      const [[meta], z] = await Promise.all([f.getMetadata().catch(miss), bucket.file(gz).download().then(([x]) => x, () => null)]);
      if (z) { head(meta.contentType || 'application/octet-stream'); res.set('Content-Encoding', 'gzip'); return res.status(200).send(z); }
    }
    const [[meta], [data]] = await Promise.all([f.getMetadata(), f.download()]).catch(miss);
    const type = meta.contentType || 'application/octet-stream';
    head(type);
    if (accepts && data.length > 1024 && !/^image\/|zip|gzip/.test(type)) {
      const z = gzipSync(data, { level: 1 });
      if (z.length < data.length * 0.9) {
        if (gz) await bucket.file(gz).save(z, { resumable: false, contentType: 'application/gzip' }).catch(() => {});
        res.set('Content-Encoding', 'gzip'); return res.status(200).send(z);
      }
    }
    res.status(200).send(data);
  }

  /** 試用權杖對不對：是發給這個專案、還沒過期的。對的記 15 秒（試用一次開十幾個檔，不用每個都查資料庫）；不對的不記（剛發的新權杖要馬上能用）；這台發新權杖時清掉（舊的馬上失效，別台最多再認 15 秒） */
  const trialSeen = new Map();
  async function trialOk(req, pid) {
    const got = req.get('x-studio-trial') || '';
    if (!got || !PID.test(pid || '')) return false;
    const k = `${pid}:${sha256Hex(got)}`, hit = trialSeen.get(k);
    if (hit && hit.until > now() && hit.exp > now()) return true;
    const doc = await project(pid).get(), t = doc.exists ? doc.data().trial : null;
    const ok = !!t && t.exp > now() && keyMatches(t.hash, sha256Hex(got));
    if (ok) { if (trialSeen.size > 200) trialSeen.clear(); trialSeen.set(k, { until: now() + 15e3, exp: t.exp }); }
    return ok;
  }
  /** 拿試用權杖的：只能下載、看檔案清單、寫回回報 */
  async function trial(req, res) {
    if (req.method === 'GET') return getFile(req, res);
    const body = req.body || {}, pid = pidOf(body.pid);
    if (req.method === 'POST' && body.op === 'pull') {
      const doc = await project(pid).get();
      if (!doc.exists) throw fail(404, 'no project');
      const { name = '', line = '', rev = 0, files = {} } = doc.data();
      return res.json({ project: { id: pid, name, line, rev, files } });
    }
    if (req.method === 'POST' && body.op === 'feedback') {
      const text = body.text;
      if (typeof text !== 'string' || text.length > MAX_JSON) throw fail(400, 'feedback');
      let j; try { j = JSON.parse(text); } catch (e) { throw fail(400, 'feedback'); }
      if (j?.format !== 'climbio-3d-feedback/1' || !Array.isArray(j.items)) throw fail(400, 'feedback');
      const data = Buffer.from(text, 'utf8'), sha256 = sha256Hex(data);
      await bucket.file(blobOf(pid, sha256)).save(data, { resumable: false, contentType: 'application/json' });
      const doc = await project(pid).get(), cur = doc.data(), rev = (cur.rev || 0) + 1;
      await project(pid).set({ files: { ...(cur.files || {}), 'feedback3d.json': { sha256, size: data.length } }, rev, updated: now() }, { merge: true });
      return res.json({ ok: true, rev });
    }
    throw fail(403, 'trial');
  }

  return async (req, res) => {
    try {
      if (req.method === 'GET' && !req.query.pid) return res.json({ ok: !!key(), auth: await authed(req) });
      if (!key()) throw fail(503, 'off');
      if (!(await authed(req))) {
        if (await trialOk(req, req.method === 'GET' ? req.query.pid : req.body?.pid)) return await trial(req, res);
        throw fail(401, 'key');
      }
      if (req.method === 'GET') return await getFile(req, res);
      if (req.method === 'PUT') return res.json(await putFile(req));
      if (req.method === 'POST') return res.json(await post(req.body));
      throw fail(405, 'method');
    } catch (e) {
      if (!e.status) console.error('studioSync', e);
      res.status(e.status || 500).json({ error: e.status ? e.message : 'server', ...(e.rev !== undefined ? { rev: e.rev } : {}) });
    }
  };
}

module.exports = { createHandler, validPath, keyMatches, githubMember, ownerAuth };
