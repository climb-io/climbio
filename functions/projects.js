// Climbio 公開的專案（天然岩場 guidebook、3D 牆 wall3d、3D 岩場 crag3d）：檔案全部在開放資料集（Hugging Face，見 crags-dataset.js 的 KINDS），這裡只有索引與權限。
//   projects（HTTP 函式，POST）：prepare（取照片的 Hub 上傳網址）、publish（hf: true，一次 commit 改過的 JSON、照片指標、拿掉的檔案和目錄）、
//     files（專案目前這一版的檔案清單，公開的；沒改的不重傳）；GET 回 { ok } 讓網頁知道服務開了沒。
//     沒有私人發佈：發佈就是公開。不列入世界（listed: false）：檔案照樣在資料集、/p/{id} 照樣打得開，只是世界清單和資料集目錄（crags.jsonl）不列；上一版不列入的，下一版預設也不列入。
//     索引 datasets/{專案 id}（跟公開牆 walls-dataset.js 同一個集合）：{ owner（空字串，不記擁有者）, type, name, version, t, files: [{ path, id, mime, sha256, size, hf }], locations, listed, attribution, hf: { dir, repo }, gym?, cc?, origin? }；
//     origin：上一版的專案 id；root、lineage、credits（歷代署名，留名不留權）。不認人：誰都能接著發下一版，同一本書大家預設看到最新的一版；
//     一次刪很多、改名的大改由 Studio 發成新的一本（沒有 origin，自己一個 root），原本那本不受影響。沒有擁有者，已發佈的 id 不能改，更新是新的專案 id；沒有下架（不當內容由管理者 hidden）。
//     世界的清單是靜態檔（writeWorld，Storage 的 public/projects.json）：發佈、下架後重寫，每天排程再補一次；同一個 origin 的版本排在一起，原創在前、別人的改編在後。
//   /p/{id}：Hosting 的 /p/{id}/{檔} 直接導向資料集（firebase.json 的 redirects），/p/{id}（固定分享網址）的預覽頁是 routePage（route-page.js，只讀資料集）。
//   versions.json：每次發佈，同一本書（同一個 root）每一版的資料夾都重寫一份 { climbio: 2, kind: 'versions', t, rows: [世界清單的一列] }，拿到舊連結的人讀自己那一版的檔就找得到最新的一版（不列入世界的也有）。
const validPosition = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
const { createHash } = require('node:crypto');
const CRAGS = require('./crags-dataset');
const { checkHfFiles, planChanges, cragRow, upsertRow, entryOf, kindOf } = CRAGS;
const ID = /^[0-9a-z]{16}$/, PATH = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/, SHA = /^[0-9a-f]{64}$/;
const ENTRY = 'index.json', PREVIEW = 'preview.jpg', THUMB = 'thumb.jpg', LIST_MAX = 300;
const MIME = { json: 'application/json', jpg: 'image/jpeg', jpeg: 'image/jpeg', glb: 'model/gltf-binary', spz: 'model/x-spz', png: 'image/png', webp: 'image/webp', bin: 'application/octet-stream' };
const OPEN_TYPES = ['wall3d', 'guidebook', 'crag3d'];   // 不認人的類型（發佈不登入、不記 owner）
const HLL = require('./hll');
const { clientIp } = require('./client-ip');
const OTHERS_MAX = 5, LINEAGE_MAX = 50, CREDITS_MAX = 20;   // credits：這面牆歷代版本的署名（留名不留權）
const MAX_FILES = 5000, DAILY_PUBLISH = 50, VERSIONS = 'versions.json';
/** 岩場在地圖上的位置：照片拍照位置（[經度, 緯度]）的平均，小數 5 位（約 1 公尺）；沒有就是 undefined */
const center = (ps) => (ps.length ? [0, 1].map((i) => Math.round((ps.reduce((a, p) => a + p[i], 0) / ps.length) * 1e5) / 1e5) : undefined);
const fail = (status, error) => Object.assign(new Error(error), { status });
const dayKey = ms => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);
const mimeOf = path => MIME[(path.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase()];


/** 最近 30 天每天約略不重複的機器數：stat 是 { hll: { 'YYYY-MM-DD': base64 草圖 } }（早期 projectFiles 記的，現在不再記），草圖取聯集（不同天的雜湊不同，等於各天相加） */
const DL_DAYS = 30, NEW_MS = 7 * 864e5;
const downloads = (stat, nowMs) => {
  const from = dayKey(nowMs - DL_DAYS * 864e5);
  let regs = HLL.newRegs();
  for (const [k, v] of Object.entries((stat && stat.hll) || {})) if (k >= from) regs = HLL.merge(regs, HLL.decode(v));
  return HLL.estimate(regs);
};
/**
 * 同一面牆、同一本書的版本排序（不認人的類型）：
 *   Guidebook：最新的在前（大改會變成另一本書，同一本裡的都是小改，最新的就是大家該看的）；
 *   3D 牆：最近 30 天下載最多的在前，同分新的在前；發佈不到 7 天的新版本視為至少排在第 3 位（讓它有機會被看到）；都沒有下載就是最新在前。
 */
function rankVersions(group, stats, nowMs) {
  const dl = new Map(group.map(d => [d.id, downloads(stats.get(d.id), nowMs)])), third = [...dl.values()].sort((a, b) => b - a)[2] || 0;
  const eff = d => (nowMs - (d.get('t') || 0) < NEW_MS ? Math.max(dl.get(d.id), third) : dl.get(d.id));
  const newest = (a, b) => (b.get('t') || 0) - (a.get('t') || 0);
  const guidebook = group.some(d => d.get('type') === 'guidebook');
  return group.slice().sort((a, b) => (guidebook ? newest(a, b) : eff(b) - eff(a) || newest(a, b))).map(d => ({ d, dl: dl.get(d.id) }));
}

/** 所有公開的專案（世界清單的內容）：新到舊；同一個岩場（同一個 root，沒有的用 origin、自己）的版本排在一起，位置在最新那一版出現的地方；組內原創在前、改編在後。3D 牆每面牆只列排序第一的版本（rankVersions），附 versions 版本數與 dl 下載數 */
async function listPublic({ db, now = Date.now }) {
  const snap = await db.collection('datasets').orderBy('t', 'desc').limit(LIST_MAX).get();
  const stats = new Map();
  const sc = db.collection('projectStats');
  if (typeof sc.get === 'function') for (const d of (await sc.get()).docs) stats.set(d.id, { hll: d.get('hll') || {} });
  const groups = new Map();
  for (const d of snap.docs.filter(d => d.get('listed') !== false && d.get('hf') && d.get('hidden') !== true)) {   // hidden：管理者手動藏起來（重複、不當），發佈者重發也不會恢復
    const key = d.get('root') || d.get('origin') || d.id;
    groups.set(key, [...(groups.get(key) || []), d]);
  }
  const rank = d => (d.get('origin') ? 1 : 0);
  return [...groups.values()].flatMap(g => (OPEN_TYPES.includes(g[0].get('type')) ? [openRow(g, stats, now())] : g.sort((a, b) => rank(a) - rank(b)).map(d => rowOut({ d, extra: {} }))));
}
/** 不認人的類型的一組版本 → 世界清單的一列：排序第一的版本，附 versions、dl、root、others（其他版本） */
function openRow(g, stats, nowMs) {
  const brief = ({ d, dl }) => ({ id: d.id, name: d.get('name') || '', t: d.get('t') || 0, dl, url: hfBase(d.get('hf')) + d.get('hf').dir + ENTRY, lineage: d.get('lineage') || [] });
  const r = rankVersions(g, stats, nowMs);
  return rowOut({ d: r[0].d, extra: { versions: g.length, dl: r[0].dl, root: r[0].d.get('root') || r[0].d.id, lineage: r[0].d.get('lineage') || [], credits: r[0].d.get('credits') || [], ...(r.length > 1 ? { others: r.slice(1, 1 + OTHERS_MAX).map(brief) } : {}) } });
}
/** 同一本書（同一個 root）所有的版本（含剛發佈的 doc、不含管理者藏起來的）→ 每一版資料夾裡的 versions.json（最多 LINEAGE_MAX 版，其餘舊的不更新） */
async function versionFiles({ db, doc, root, hf, now }) {
  const [first, rest] = root === doc.id ? [null, { docs: [] }] : await Promise.all([db.collection('datasets').doc(root).get(), db.collection('datasets').where('root', '==', root).limit(LIST_MAX).get()]);
  const group = [first, ...rest.docs].filter(x => x && x.exists && x.id !== doc.id && x.get('hf') && x.get('hidden') !== true && x.get('type') === doc.get('type')).concat(doc);
  return groupFiles({ db, group, hf, now });
}
/** 一組版本（同一本書）→ 每一版資料夾的 versions.json（內容都一樣：這本書世界清單的那一列） */
async function groupFiles({ db, group, hf, now }) {
  const stats = new Map();
  await Promise.all(group.map(async g => { const s = await db.collection('projectStats').doc(g.id).get(); if (s.exists) stats.set(g.id, { hll: s.get('hll') || {} }); }));
  const bytes = Buffer.from(JSON.stringify({ climbio: 2, kind: 'versions', t: now, rows: [openRow(group, stats, now)] }));
  return group.filter(g => (g.get('hf').repo || 'crags') === hf).sort((a, b) => (b.get('t') || 0) - (a.get('t') || 0)).slice(0, LINEAGE_MAX)
    .map(g => ({ path: `${g.get('hf').dir}${VERSIONS}`, bytes }));
}
function rowOut({ d, extra }) {
  const base = hfBase(d.get('hf')) + d.get('hf').dir, files = d.get('files') || [], at = center(d.get('locations') || []);
  const img = p => files.some(f => f.path === p) && base + p;
  return { id: d.id, type: d.get('type'), name: d.get('name') || '', t: d.get('t') || 0, url: base + ENTRY, ...(img(PREVIEW) ? { preview: img(PREVIEW) } : {}), ...(img(THUMB) ? { thumb: img(THUMB) } : {}), ...(at ? { at } : {}), ...(d.get('cc') ? { cc: d.get('cc') } : {}), ...(d.get('gym') ? { gym: d.get('gym') } : {}), ...(d.get('listed') === false ? { listed: false } : {}), ...extra };
}

/**
 * 世界的清單做成靜態檔：Storage 的 ${WORLD_FILE}（所有公開專案，不分 type，讀的人自己挑；不用登入、不經過雲端函式，CDN 留 5 分鐘）；網址直接是資料集。
 * 發佈、下架之後和每天排程重寫一次。
 * save(路徑, 內容, 快取) 由 index.js 接 Storage。
 */
const { WORLD_BUILT_FILE } = require('./world');
const WORLD_FILE = 'public/projects.json', WORLD_CACHE = 'public, max-age=300';
async function writeWorld({ db, save, now, buildWorld, publishIndex }) {
  const projects = await listPublic({ db, now });
  await save(WORLD_FILE, JSON.stringify({ projects }), WORLD_CACHE);
  // 紅點貓的世界：預先合成的三層樹（壓縮存放）。合成失敗（例如抓不到 OpenClimbing 索引）就留著上一份，不影響上面的清單
  const world = buildWorld ? await buildWorld(projects).catch(e => { console.error('world.json', e); return null; }) : null;
  if (world) await save(WORLD_BUILT_FILE, world, WORLD_CACHE, { gzip: true });
  // 客戶端讀的是資料集的 index/redpoint.json（hf-world.js）；上面兩個 Storage 檔是舊版 App 還在讀的，之後拿掉
  if (publishIndex) await publishIndex({ projects, world }).catch(e => console.error('index/redpoint.json', e));
}

/** 上一版在資料集的檔案（路徑 → sha256）；不是資料集的專案（Drive）沒有 */
const oldShas = old => new Map(old.exists && old.get('hf') ? (old.get('files') || []).map(f => [f.path, f.sha256]) : []);
const HF_CHECK = { fail, mimeOf, PATH, SHA, ENTRY, maxFiles: MAX_FILES };

function createHandler({ db, now = Date.now, saveWorld, datasets = {}, registerWall = null }) {   // datasets：type → Hub 寫入（walls-dataset.js 的 createHf），沒給的 type 不能發佈；driveAlive 只有分享照片（redpoint-photos.js）用
  // 不認人（docs/proposals/open-versions.md）：不登入、文件不記 owner，額度按網路來源算；更新＝用新的 id、origin 指到上一版
  const keyOf = (req) => `ip${createHash('sha256').update(clientIp(req)).digest('hex').slice(0, 16)}`;
  const project = id => db.collection('datasets').doc(id);
  /** 讀專案文件；同一個集合裡公開牆（type: walls）的文件不是專案，不能經過這裡改或下架 */
  const read = async id => { const d = await project(id).get(); if (d.exists && d.get('type') === 'walls') throw fail(409, 'not a project'); return d; };
  // 重寫世界的靜態清單；寫不成不讓發佈失敗（每天排程會補寫）
  const refreshWorld = async () => { if (saveWorld) await saveWorld().catch(e => console.error('writeWorld', e)); };
  const ops = {
    // 岩場上傳到資料集的第一步：回 Hub 的 LFS 上傳網址（瀏覽器直接傳照片給 Hub）。files：[{ path, sha256, size }]；沒改的（sha256 跟上一版一樣）、JSON（隨 publish 帶）不用傳。
    // 每個帳號每天最多準備 MAX.prepareDaily 位元組，免得有人只傳不發佈、把倉庫塞滿
    async prepare(body, req) {
      const key = keyOf(req);
      const kind = kindOf(body.type), hf = kind && datasets[body.type];
      if (!ID.test(body.id || '') || !kind) throw fail(400, 'bad id');
      if (!hf) throw fail(501, 'dataset off');
      const files = checkHfFiles((body.files || []).map(f => ({ ...f, b64: undefined })), { ...HF_CHECK, kind }).filter(f => !f.text);
      const old = await read(body.id);
      if (old.exists) throw fail(409, 'exists');   // 沒有擁有者：已發佈的 id 不能再改，更新要用新的 id
      const prev = oldShas(old), need = files.filter(f => prev.get(f.path) !== f.sha256);
      const bytes = need.reduce((a, f) => a + f.size, 0), qref = db.collection('publishQuota').doc(`${key}_prepare_${dayKey(now())}`), q = await qref.get();
      if ((q.exists ? q.get('n') : 0) + bytes > CRAGS.MAX.prepareDaily) throw fail(429, 'daily limit');
      const objs = await hf.lfsBatch(need.map(f => ({ oid: f.sha256, size: f.size })));
      await qref.set({ n: (q.exists ? q.get('n') : 0) + bytes, at: now() });
      return { uploads: objs.filter(o => o.upload).map(o => ({ path: need.find(f => f.sha256 === o.oid).path, oid: o.oid, size: o.size, upload: o.upload, ...(o.verify ? { verify: o.verify } : {}) })) };
    },
    async publish(body, req) {
      const key = keyOf(req);
      if (!ID.test(body.id || '')) throw fail(400, 'bad id');
      const kind = kindOf(body.type), hf = kind && datasets[body.type];
      if (!kind) throw fail(400, 'bad type');
      if (body.hf !== true) throw fail(400, 'dataset only');
      let listed = body.listed !== false;   // 不列入世界：發佈的人選的
      if (!hf) throw fail(501, 'dataset off');
      const name = String(body.name || '').trim();
      if (!name || name.length > 80) throw fail(400, 'bad name');
      if (body.origin !== undefined && !ID.test(body.origin)) throw fail(400, 'bad origin');
      const gym = String(body.gym || '').trim();
      if (gym.length > 80) throw fail(400, 'bad gym');
      const cc = String(body.cc || '').toLowerCase();   // 國家（ISO 3166-1 alpha-2）：世界的第一層分組，沒給就沒有
      if (cc && !/^[a-z]{2}$/.test(cc)) throw fail(400, 'bad cc');
      const locations = body.locations || [];
      if (!Array.isArray(locations) || locations.length > MAX_FILES || !locations.every(validPosition)) throw fail(400, 'bad locations');
      // 版本屬於哪一面牆（root）：origin 那一版的 root（沒有就是 origin 自己）；不認人的類型 origin 要是同類型、已發佈的專案
      let root, lineage, credits, lineageCut = false;
      if (body.origin) {
        const par = await read(body.origin);
        if (!par.exists || par.get('type') !== body.type) throw fail(400, 'bad origin');
        root = par.exists ? par.get('root') || par.get('origin') || par.id : body.origin;
        if (par.get('listed') === false && body.listed !== true) listed = false;   // 上一版不列入世界，下一版預設也不列入（要列入得明確給 listed: true）
        // 血緣：從 root 到 origin 的專案 id（紅點貓只自動更新收下那一版的後代）；太長只留最近的
        if (par.exists) { credits = [...new Set([...(par.get('credits') || (par.get('attribution') ? [par.get('attribution')] : [])), String(body.attribution || '')])].filter(Boolean).slice(-CREDITS_MAX); const chain = [...(par.get('lineage') || (par.get('root') ? [par.get('root')] : [])), par.id]; lineage = chain.slice(-LINEAGE_MAX); lineageCut = chain.length > LINEAGE_MAX; }
      }
      const old = await read(body.id), id = body.id;
      if (old.exists) throw fail(409, 'exists');
      const qref = db.collection('publishQuota').doc(`${key}_project_${dayKey(now())}`), q = await qref.get();
      if ((q.exists ? q.get('n') : 0) >= DAILY_PUBLISH) throw fail(429, 'daily limit');
      // 照片已經由瀏覽器直接傳到 Hub，這裡一次 commit 改過的 JSON、照片指標、拿掉的檔案和目錄
      const fresh = checkHfFiles(body.files, { ...HF_CHECK, kind });
      if (fresh.some(f => f.path === VERSIONS)) throw fail(400, 'reserved name');   // versions.json 是伺服器寫的
      const prev = oldShas(old), { fresh: changed, gone } = planChanges(fresh, prev);
      const version = (old.exists ? old.get('version') || 0 : 0) + 1, t = now();
      const attribution = String(body.attribution || '');
      if (!credits && attribution) credits = [attribution];
      const row = cragRow({ id, name, t, version, files: fresh, locations, attribution, origin: body.origin, gym, cc, kind });
      const url = `${hfBase({ repo: kind.name })}${kind.dir}${id}/${ENTRY}`, sent = fresh.map(f => ({ path: f.path, sha256: f.sha256 }));
      // 什麼都沒改（檔案、名稱、位置）：不 commit、不加版本
      if (old.exists && !changed.length && !gone.length && old.get('name') === name && JSON.stringify(old.get('locations') || []) === JSON.stringify(locations) && old.get('attribution') === attribution && (old.get('cc') || '') === cc) return { id, version: old.get('version'), url, files: sent, same: true };
      const text = listed ? await hf.read(kind.index) : '';   // 不列入世界的不寫進資料集目錄
      if (changed.some(f => f.text && !f.bytes)) throw fail(400, 'missing content');
      const data = { owner: '', type: body.type, name, version, t, files: fresh.map(f => entryOf(id, f, kind)), locations, listed, attribution, hf: { dir: `${kind.dir}${id}/`, repo: kind.name }, ...(old.exists && old.get('hidden') ? { hidden: true } : {}), ...(gym ? { gym } : {}), ...(cc ? { cc } : {}), ...(credits ? { credits } : {}), ...(body.origin ? { origin: body.origin, root, ...(lineage ? { lineage } : {}), ...(lineageCut ? { lineageCut: true } : {}) } : {}) };
      // 一個 commit 全部寫完：改過的檔案、資料集目錄，以及這本書每一版資料夾裡的 versions.json（最新的一版從任何一版的舊連結都找得到）
      const versions = await versionFiles({ db, doc: { id, exists: true, get: k => data[k] }, root: root || id, hf: kind.name, now: t });
      await hf.commit(`發佈 ${id} v${version}`, [
        ...changed.map(f => (f.bytes ? { path: `${kind.dir}${id}/${f.path}`, bytes: f.bytes } : { path: `${kind.dir}${id}/${f.path}`, oid: f.sha256, size: f.size })),
        ...gone.map(p => ({ path: `${kind.dir}${id}/${p}`, deleted: true })),
        ...(listed ? [{ path: kind.index, bytes: Buffer.from(upsertRow(text, row)) }] : []),
        ...versions,
      ]);
      await project(id).set(data);
      await qref.set({ n: (q.exists ? q.get('n') : 0) + 1, at: t });
      // 3D 牆跟公開牆同一套清單（gymWalls／gymIndex，gym-walls.js）：登記進去，找牆面才看得到、路線數才算得出來
      if (body.type === 'wall3d' && gym && listed && registerWall) await registerWall({ id, name, gym, root: root || id }).catch(e => console.error('registerWall3d', id, e));
      await refreshWorld();
      return { id, version, url, files: sent, ...(listed ? {} : { listed: false }) };
    },
    // 專案目前這一版的檔案（{ version, files }，公開的，誰都能讀）；還沒發佈過是第 0 版、沒有檔案
    async files(body, req) {
      if (!ID.test(body.id || '')) throw fail(400, 'bad id');
      const old = await read(body.id);
      if (!old.exists) return { version: 0, files: [] };
      if (old.get('type') !== body.type) throw fail(400, 'type changed');   // 不認人的類型：公開的檔案清單誰都能讀（拿來比對哪些檔案 Hub 已經有）
      return { version: old.get('version') || 0, hf: true, files: (old.get('files') || []).map(f => ({ path: f.path, sha256: f.sha256, size: f.size })) };
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
      if (!e.status) console.error('datasets', e);
      res.status(e.status || 500).json({ error: e.status ? e.message : 'server error' });
    }
  };
}

/** 開放資料集（Hugging Face climbio/walls，datasets 函式寫的）：這裡不收、不存，/p/{id}/{檔} 導向資料集（路徑帶版本，發佈後不再改） */
const HF_BASE = 'https://huggingface.co/datasets/climbio/walls/resolve/main/';
/** 天然岩場（guidebook）的開放資料集 climbio/crags：每個岩場一個資料夾 crags/{id}/（不分版本，網址固定，歷史在 git），datasets 文件的 hf.dir 指到它；網址直接給 Hugging Face */
const HF_CRAGS = 'https://huggingface.co/datasets/climbio/crags/resolve/main/';
/** datasets 文件的 hf：{ dir, repo? }，repo 是倉庫簡稱（crags｜walls3d｜crags3d），沒有就是 crags；回那個倉庫的檔案網址前綴 */
const hfBase = hf => `https://huggingface.co/datasets/climbio/${(hf && hf.repo) || 'crags'}/resolve/main/`;

module.exports = { HF_BASE, HF_CRAGS, hfBase, writeWorld, WORLD_FILE, listPublic, createHandler, ENTRY };
