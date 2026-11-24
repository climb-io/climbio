// 公開牆的開放資料集：按「公開」的牆（照片、岩點、Wall 精修記錄；路線之後由排程補）寫進 Hugging Face 的公開資料集 climbio/walls，
// 誰都能免登入讀（huggingface.co 的 resolve 網址有跨網域標頭）；Climbio 保管、不因發佈者要求刪除（見 docs/studio-holdlab.md）。
//   POST { op: 'publishWall', id（包 id）, name, gym（必填）, licenseAccepted: true, files: [{ path, b64 }] }：不登入、不記擁有者、不用金鑰（只有 Studio 發佈，source 標記），額度按網路來源，內容照 wall-check.js 驗證；
//     任何人都能發佈新版本，每次是新的一版；岩點貓看到哪一版由程式自動判定（見 publishWall 的「現行版」：驗證過、照片沒換、逐顆檢查完了才換）；
//     檔案路徑只收 index.json、<id>.json（照片畫面）、<id>.jpg（照片）、<id>.thumb.jpg（縮圖）、<id>.edits.json（Wall 精修記錄），<id> 是 8～40 碼小寫英數；
//     寫到 walls/<包 id>/v<版本>/；版本每次加一，舊版本留著；內容跟上一版完全一樣就不寫、回上一版。
//   索引：Firestore datasets/{id}（{ owner: '', type: 'walls', name, version（現行版）, latest（最新版）, reviewed, at, files, sig }；現行版是最新一個逐顆檢查完了的版本，沒有就是最新的）是 Climbio 唯一保存的資料；
//     /p/{id}/… 由它推出資料夾 walls/{id}/v{版本}/，導向資料集（projectFiles），找牆面與收牆的程式不用改。
//   資料集根目錄的 walls.jsonl 是整份目錄（每面牆一行，見 rowOf）：每次發佈跟檔案放進同一個 commit，研究者只下載這一個檔就能挑要哪些牆。
//   GET 回 { ok }。HF 權杖（Secret HF_TOKEN）只在這裡用，寫入範圍只有這個倉庫。
const { createHash } = require('node:crypto');
const { checkVersion } = require('./wall-check');
const { clientIp } = require('./client-ip');

const REPO = 'climbio/walls', ID = /^[0-9a-z]{16}$/, NAME = '[0-9a-z]{8,40}', DAILY = 30;
const MAX = { photo: 8e6, thumb: 1e6, json: 4e6, edits: 4e6, total: 20e6 }, MAX_FILES = 20;
const fail = (status, error) => Object.assign(new Error(error), { status });
const dayKey = ms => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);
const baseUrl = (id, version) => `https://huggingface.co/datasets/${REPO}/resolve/main/walls/${id}/v${version}/`;
const sha = (bytes, algo = 'sha256') => createHash(algo).update(bytes).digest('hex');
const INDEX = 'walls.jsonl', LICENSE = 'CC-BY-SA-4.0';
/** 現行版的固定網址 walls/{包 id}/current/{檔}：跟 v{版本}/ 同樣的檔案，客戶端直接讀（不用查現行版是哪一版、不經過函式）。
 *  二進位檔在同一個 commit 用 LFS 指到同一個物件（內容雜湊相同），不多佔空間；files：[{ path, bytes }] */
const currentCopies = (id, files) => files.map(f => (isText(f.path) ? { path: `walls/${id}/current/${f.path}`, bytes: f.bytes } : { path: `walls/${id}/current/${f.path}`, oid: sha(f.bytes), size: f.bytes.length }));
const isText = path => /\.(json|jsonl|md)$/.test(path);   // 文字放在 commit 裡；JPEG 這類二進位檔 Hub 只收 LFS

/** 誰檢查完的：AI 代理流程的記錄有 ai（reviews 裡有人就是 ai+human）；Studio 的人按「逐顆檢查完了」是 human；沒檢查完不寫 */
const reviewBy = (rec) => !rec.reviewed ? {} : { by: rec.ai ? ((rec.reviews || []).some(r => String(r.by).startsWith('human:')) ? 'ai+human' : 'ai') : 'human' };
/** 目錄的一行（walls.jsonl）：研究者靠它不下載照片就知道每面牆有什麼。files：[{ path, kind, bytes }]；edits.json 沒有就是沒精修過 */
function rowOf({ id, name, gym, version, t, files }) {
  const get = f => files.find(x => x.path === f);
  const view = files.find(f => f.kind === 'json' && f.path !== 'index.json' && (() => { try { return JSON.parse(f.bytes).kind === 'view'; } catch (e) { return false; } })());
  const v = view ? JSON.parse(view.bytes) : {}, edits = files.find(f => f.kind === 'edits'), photo = files.find(f => f.kind === 'photo');
  const rec = edits ? JSON.parse(edits.bytes) : null, n = k => (rec && rec[k] ? (Array.isArray(rec[k]) ? rec[k].length : Object.keys(rec[k]).length) : 0);   // flagged 是 { 岩點 id: 旗標 }，其他是陣列
  return { id, name, gym: gym || '', version, t, dir: `walls/${id}/v${version}/`, w: v.w || 0, h: v.h || 0,
    holds: (v.nodes || []).filter(x => x.type === 'hold').length, photoBytes: photo ? photo.bytes.length : 0, photoSha256: photo ? sha(photo.bytes) : '',
    edits: rec ? { reviewed: !!rec.reviewed, ...reviewBy(rec), deleted: n('deleted'), added: n('added'), reshaped: n('reshaped'), flagged: n('flagged') } : null, routes: 0, license: LICENSE };
}
/** 目錄換一行（沒有就加）；其他行原樣留著，按牆 id 排序 */
function upsertRow(text, row) {
  const rows = String(text || '').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.id !== row.id);
  rows.push(row);
  return rows.sort((a, b) => (a.id < b.id ? -1 : 1)).map(r => JSON.stringify(r)).join('\n') + '\n';
}

/** 路徑的種類；不在白名單回 null */
function kindOf(path) {
  if (typeof path !== 'string') return null;
  if (path === 'index.json') return 'json';
  for (const [kind, re] of [['thumb', `^${NAME}\\.thumb\\.jpg$`], ['photo', `^${NAME}\\.jpg$`], ['edits', `^${NAME}\\.edits\\.json$`], ['json', `^${NAME}\\.json$`]]) if (new RegExp(re).test(path)) return kind;
  return null;
}

/** 檢查並解開要發佈的檔案：路徑照白名單、照片是 JPEG、json 解得開、至少有一張照片和一個畫面；回 [{ path, kind, bytes }] */
function checkFiles(files) {
  if (!Array.isArray(files) || !files.length || files.length > MAX_FILES) throw fail(400, 'bad files');
  const seen = new Set();
  let total = 0;
  const out = files.map(f => {
    const path = f && f.path, kind = kindOf(path);
    if (!kind || seen.has(path)) throw fail(400, `bad path ${path}`);
    seen.add(path);
    if (typeof f.b64 !== 'string') throw fail(400, `bad content ${path}`);
    const bytes = Buffer.from(f.b64, 'base64');
    total += bytes.length;
    if (!bytes.length || bytes.length > MAX[kind]) throw fail(400, `bad size ${path}`);
    if ((kind === 'photo' || kind === 'thumb') && !(bytes[0] === 0xff && bytes[1] === 0xd8)) throw fail(400, `${path} is not jpeg`);
    if (path.endsWith('.json')) { try { JSON.parse(bytes.toString('utf8')); } catch (e) { throw fail(400, `bad json ${path}`); } }
    return { path, kind, bytes };
  });
  if (total > MAX.total) throw fail(400, 'too big');
  if (!out.some(f => f.kind === 'photo')) throw fail(400, 'no photo');
  if (!out.some(f => f.kind === 'json' && f.path !== 'index.json')) throw fail(400, 'no wall json');
  return out;
}

/** Hugging Face 的寫入：一次 commit 放進所有檔案（commit API，NDJSON）。JSON 直接放在 commit 裡；JPEG 這類二進位檔 Hub 只收 LFS：
 *  先用 LFS batch 取得上傳網址、PUT 內容，再在 commit 裡用 lfsFile 指到 sha256 */
function createHf({ token, repo = REPO, get = fetch }) {
  const auth = () => ({ Authorization: `Bearer ${token()}` });
  const bad = async (what, r) => { console.error(what, r.status, (await r.text()).slice(0, 300)); throw fail(502, 'hub failed'); };
  const LFS = { 'Content-Type': 'application/vnd.git-lfs+json', Accept: 'application/vnd.git-lfs+json' };
  /** LFS batch：objs [{ oid, size }] → [{ oid, size, upload?: { href, header }, verify?: { href, header } }]；沒有 upload＝倉庫已經有這份內容 */
  async function lfsBatch(objs) {
    const out = [];
    for (let i = 0; i < objs.length; i += 200) {   // 一次問 200 個
      const part = objs.slice(i, i + 200);
      const r = await get(`https://huggingface.co/datasets/${repo}.git/info/lfs/objects/batch`, { method: 'POST', headers: { ...auth(), ...LFS },
        body: JSON.stringify({ operation: 'upload', transfers: ['basic'], hash_algo: 'sha256', objects: part.map(o => ({ oid: o.oid, size: o.size })) }) });
      if (!r.ok) await bad('HF lfs batch', r);
      for (const o of (await r.json()).objects || []) {
        if (o.error) { console.error('HF lfs', o.error); throw fail(502, 'hub failed'); }
        out.push({ oid: o.oid, size: o.size, ...(o.actions && o.actions.upload ? { upload: o.actions.upload } : {}), ...(o.actions && o.actions.verify ? { verify: o.actions.verify } : {}) });
      }
    }
    return out;
  }
  async function lfsVerify(o) {
    const v = await get(o.verify.href, { method: 'POST', headers: { ...(o.verify.header || {}), 'Content-Type': LFS['Content-Type'] }, body: JSON.stringify({ oid: o.oid, size: o.size }) });
    if (!v.ok) await bad('HF lfs verify', v);
  }
  async function lfsUpload(objs) {   // 伺服器自己傳（內容在記憶體）
    for (const o of await lfsBatch(objs.map(x => ({ oid: x.oid, size: x.bytes.length })))) {
      if (!o.upload) continue;
      const put = await get(o.upload.href, { method: 'PUT', headers: o.upload.header || {}, body: objs.find(x => x.oid === o.oid).bytes });
      if (!put.ok) await bad('HF lfs put', put);
      if (o.verify) await lfsVerify(o);
    }
  }
  return {
    lfsBatch,
    /** 倉庫現在最新的 commit（寫入時用 parentCommit 確認沒有別的 commit 先進去） */
    async head() {
      const r = await get(`https://huggingface.co/api/datasets/${repo}`, { headers: auth() });
      if (!r.ok) await bad('HF head', r);
      return (await r.json()).sha;
    },
    /** 資料夾裡的檔案：[{ path, size, oid? }]（oid 是 LFS 的 sha256；文字檔沒有） */
    async tree(dir) {
      const r = await get(`https://huggingface.co/api/datasets/${repo}/tree/main/${dir}`, { headers: auth() });
      if (!r.ok) await bad('HF tree', r);
      return (await r.json()).filter(x => x.type === 'file').map(x => ({ path: x.path, size: x.size, ...(x.lfs && x.lfs.oid ? { oid: x.lfs.oid, size: x.lfs.size || x.size } : {}) }));
    },
    /** 讀資料集裡的一個文字檔；不在回 null */
    async read(path) {
      const r = await get(`https://huggingface.co/datasets/${repo}/resolve/main/${path}`, { headers: { ...auth(), 'Cache-Control': 'no-cache' } });
      if (r.status === 404) return null;
      if (!r.ok) await bad('HF read', r);
      return r.text();
    },
    /** 一個 commit：files 的每一項是 { path, bytes }（文字放進 commit，二進位先走 LFS）、{ path, oid, size }（內容已經由別人傳到 LFS）或 { path, deleted: true } */
    async commit(summary, files, { parentCommit } = {}) {
      const bin = files.filter(f => f.bytes && !isText(f.path)).map(f => ({ ...f, oid: sha(f.bytes) }));
      if (bin.length) await lfsUpload(bin);
      const lines = [{ key: 'header', value: { summary, ...(parentCommit ? { parentCommit } : {}) } }, ...files.map(f => (f.deleted ? { key: 'deletedFile', value: { path: f.path } }
        : f.bytes && isText(f.path) ? { key: 'file', value: { path: f.path, encoding: 'base64', content: f.bytes.toString('base64') } }
        : { key: 'lfsFile', value: { path: f.path, algo: 'sha256', oid: f.oid || bin.find(b => b.path === f.path).oid, size: f.size || f.bytes.length } }))];
      const r = await get(`https://huggingface.co/api/datasets/${repo}/commit/main`, { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/x-ndjson' }, body: lines.map(l => JSON.stringify(l)).join('\n') });
      if (r.status === 409 || r.status === 412) throw Object.assign(fail(409, 'hub conflict'), { conflict: true });   // parentCommit 不是最新的：呼叫的人重讀重寫
      if (!r.ok) await bad('HF commit', r);
    },
  };
}

// refreshGyms(包 id)：發佈後重算用到這個包的岩館公開牆清單（gym-walls.js），清單才指到新的現行版
function createHandler({ db, hf, now = Date.now, refreshGyms = null }) {
  const wall = id => db.collection('datasets').doc(id);
  // 不認人（docs/proposals/open-versions.md）：不登入、不記 owner；額度按網路來源；內容由 wall-check.js 驗證
  const keyOf = req => `ip${sha(clientIp(req)).slice(0, 16)}`;
  const ops = {
    async publishWall(body, req) {
      // 公開牆只由 Climbio Studio 或牆發佈的內嵌頁（embed/wallpublish）發佈；岩點貓 App 不上傳牆（舊版 App 沒帶標記，在這裡擋掉）。標記不是驗證（這裡不認人），只讓 App 不能意外把牆傳上來
      if (body.source !== 'studio' && body.source !== 'embed') throw fail(400, 'studio only');
      if (!ID.test(body.id || '')) throw fail(400, 'bad id');
      const name = String(body.name || '').trim();
      if (!name || name.length > 80) throw fail(400, 'bad name');
      if (body.licenseAccepted !== true) throw fail(400, 'license not accepted');
      const gym = String(body.gym || '').trim();
      if (!gym || gym.length > 60) throw fail(400, 'bad gym');   // Studio 發佈的公開牆一定有岩館名稱
      const files = checkFiles(body.files), old = await wall(body.id).get();
      const sig = sha(files.map(f => `${f.path}:${sha(f.bytes)}`).sort().join('\n'));
      if (old.exists && old.get('sig') === sig) { const v = old.get('version'); return { id: body.id, version: v, base: baseUrl(body.id, v), same: true }; }   // 跟現行版一樣：不寫新版本
      // 內容驗證：外框合理、不少掉前一版的岩點、尺寸不變、變動不超過 30%；前一版的畫面從資料集讀
      const viewFile = files.find(f => f.kind === 'json' && f.path !== 'index.json' && (() => { try { return JSON.parse(f.bytes).kind === 'view'; } catch (e) { return false; } })());
      if (!viewFile) throw fail(400, 'no view');
      const latest = old.exists ? old.get('latest') || old.get('version') || 0 : 0;
      let prev = null;
      if (latest) {
        const text = await hf.read(`walls/${body.id}/v${latest}/${viewFile.path}`);
        if (!text) throw fail(409, 'previous version unreadable');
        prev = JSON.parse(text);
      }
      checkVersion(JSON.parse(viewFile.bytes), prev);
      const qref = db.collection('publishQuota').doc(`${keyOf(req)}_dataset_${dayKey(now())}`), q = await qref.get();
      if ((q.exists ? q.get('n') : 0) >= DAILY) throw fail(429, 'daily limit');
      const version = latest + 1, t = now(), dir = `walls/${body.id}/v${version}/`;
      const row = rowOf({ id: body.id, name, gym, version, t, files }), idx = await hf.read(INDEX), keep = idx && idx.split('\n').filter(Boolean).map(l => JSON.parse(l)).find(r => r.id === body.id);
      if (keep) row.routes = keep.routes || 0;
      // 現行版（岩點貓看到的那一版）自動判定：內容驗證過了（上面 checkVersion）、照片還是同一張（指紋一樣），而且是最新一個「逐顆檢查完了」（edits.json 的 reviewed）的版本；
      // 沒有檢查過的版本照樣存成新版本（用固定網址指到它），但新版本沒檢查過、現行版檢查過，或照片換了，現行版不換
      const reviewed = !!row.edits?.reviewed, photoSame = !old.get('photoSha') || old.get('photoSha') === row.photoSha256,   // 跟現行版的照片比（舊資料沒有指紋就不擋）
         becomes = photoSame && (reviewed || !old.get('reviewed'));
      await hf.commit(`公開 ${body.id} v${version}`, [...files.map(f => ({ path: dir + f.path, bytes: f.bytes })), { path: INDEX, bytes: Buffer.from(upsertRow(idx, row)) }, ...(becomes ? currentCopies(body.id, files) : [])]);
      // 留名不留權：歷代署名（畫面的 attribution）沿版本保留，不重複
      const credits = [...new Set([...(old.get('credits') || []), String(JSON.parse(viewFile.bytes).attribution || '')])].filter(Boolean).slice(-20);
      await wall(body.id).set({ owner: '', type: 'walls', name, latest: version, credits, ...(becomes ? { version, at: t, files: files.map(f => f.path), sig, reviewed, photoSha: row.photoSha256 } : { version: old.get('version'), at: old.get('at'), files: old.get('files'), sig: old.get('sig'), reviewed: !!old.get('reviewed'), photoSha: old.get('photoSha') || '' }) });
      await qref.set({ n: (q.exists ? q.get('n') : 0) + 1, at: t });
      if (refreshGyms) try { await refreshGyms(body.id); } catch (e) { console.error('gym list refresh', body.id, e); }   // 發佈已成功；清單沒更新由日誌查，下次發佈或牆面變動會重算
      return { id: body.id, version, current: becomes ? version : old.get('version'), base: baseUrl(body.id, version) };
    },
  };
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.method === 'GET') return res.json({ ok: true });
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    try {
      const op = ops[req.body && req.body.op];
      if (!op) throw fail(400, 'bad op');
      res.json(await op(req.body, req));
    } catch (e) {
      if (!e.status) console.error('walls dataset', e);
      res.status(e.status || 500).json({ error: e.status ? e.message : 'server error' });
    }
  };
}

module.exports = { createHandler, createHf, checkFiles, kindOf, baseUrl, rowOf, upsertRow, isText, REPO, INDEX, LICENSE };
