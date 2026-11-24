// 開放資料集每天一次的整理（排程 daily 的一步）：更新目錄的路線數、寫統計 stats.json。一次 commit，沒有變就不寫。
//   路線本身不在這裡寫：路線有變動就由 hf-public.js 馬上把 routes.json 和 index 寫進資料集（這裡再寫會用舊格式蓋掉它）
//   walls.jsonl：每面牆的 routes 欄位換成目前的條數
//   stats.json：統計頁（/stats/）讀的數字，從資料集目錄、Hub 的用量、Firestore 各集合的文件數算出，Climbio 的網站讀不用經過任何函式
// 只看上次匯出之後有變的牆（wallRoutes.t），所以每天的讀取量跟當天有多少牆被改成正比，不是跟總數。
const { INDEX, REPO } = require('./walls-dataset');

const STATE = 'datasetExport/state', STATS = 'stats.json';
const sum = (rows, f) => rows.reduce((a, r) => a + (f(r) || 0), 0);

/** 統計：目錄（每面牆一行）加 Hub 用量加各集合的文件數；固定欄位，統計頁照著畫 */
function statsOf({ rows, hub, collections, t, others = {} }) {
  const rec = rows.filter(r => r.edits);
  return {
    t,
    dataset: {
      walls: rows.length, versions: sum(rows, r => r.version), holds: sum(rows, r => r.holds), routes: sum(rows, r => r.routes),
      photoBytes: sum(rows, r => r.photoBytes), gyms: new Set(rows.map(r => r.gym).filter(Boolean)).size,
      holdlab: { records: rec.length, reviewed: rec.filter(r => r.edits.reviewed).length, deleted: sum(rec, r => r.edits.deleted), added: sum(rec, r => r.edits.added), reshaped: sum(rec, r => r.edits.reshaped), flagged: sum(rec, r => r.edits.flagged) },
      ...(hub ? { storageBytes: hub.usedStorage || 0, downloads: hub.downloads || 0 } : {}),
    },
    // 其他資料集（crags、walls3d、crags3d）：{ 名稱: { rows: 目錄的行, hub } } → 筆數、檔案數、圖片數、大小、Hub 用量
    ...Object.fromEntries(Object.entries(others).map(([k, o]) => [k, { items: o.rows.length, files: sum(o.rows, r => r.files), photos: sum(o.rows, r => r.photos), thumbs: sum(o.rows, r => r.thumbs), bytes: sum(o.rows, r => r.bytes), ...(o.hub ? { storageBytes: o.hub.usedStorage || 0, downloads: o.hub.downloads || 0 } : {}) }])),
    firestore: { collections, documents: Object.values(collections).reduce((a, n) => a + n, 0) },
  };
}

async function exportDataset({ db, hf, now = Date.now, hub = async () => null, others = {} }) {   // others：{ 名稱: { hf, index, hub } }，其他資料集的目錄與用量
  const state = await db.doc(STATE).get(), since = state.exists ? state.get('at') || 0 : 0;
  const changed = await db.collection('wallRoutes').where('t', '>', since).get();
  const prev = await hf.read(INDEX), rows = new Map((prev || '').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(r => [r.id, r]));
  const files = [];
  let latest = since, counted = false;
  for (const d of changed.docs) {
    latest = Math.max(latest, d.get('t') || 0);
    const src = (await db.collection('shared').doc(d.id).get()).get('src'), row = src && rows.get(src.project);
    if (!row) continue;   // 還沒進資料集的牆（或不是岩點貓公開牆）
    row.routes = Object.keys(d.get('routes') || {}).length;
    counted = true;
  }
  const list = [...rows.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  const collections = {};
  for (const c of await db.listCollections()) collections[c.id] = (await c.count().get()).data().count;
  const extra = {};
  for (const [k, o] of Object.entries(others)) extra[k] = { rows: String(await o.hf.read(o.index) || '').split('\n').filter(Boolean).map(l => JSON.parse(l)), hub: await (o.hub || (async () => null))().catch(() => null) };
  const stats = statsOf({ rows: list, hub: await hub().catch(() => null), collections, t: now(), others: extra });
  const old = await hf.read(STATS), same = old && JSON.stringify({ ...JSON.parse(old), t: 0 }) === JSON.stringify({ ...stats, t: 0 });
  if (counted || !same) {
    if (counted) files.push({ path: INDEX, bytes: Buffer.from(list.map(r => JSON.stringify(r)).join('\n') + '\n') });
    files.push({ path: STATS, bytes: Buffer.from(JSON.stringify(stats, null, 1)) });
    await hf.commit(`整理 ${new Date(now() + 8 * 3600e3).toISOString().slice(0, 10)}`, files);
  }
  if (latest > since) await db.doc(STATE).set({ at: latest });
  return { walls: changed.docs.length, committed: files.length > 0 };
}

/** Hub 的用量：整個倉庫佔多少、下載幾次（要有讀權杖；查不到就不放） */
const hubInfo = ({ token, repo = REPO, get = fetch }) => async () => {
  const r = await get(`https://huggingface.co/api/datasets/${repo}?expand[]=usedStorage&expand[]=downloads`, { headers: { Authorization: `Bearer ${token()}` } });
  return r.ok ? r.json() : null;
};

module.exports = { exportDataset, statsOf, hubInfo, STATS };
