// 公開牆的靜態資料（Hugging Face 的 climbio/walls，客戶端直接讀固定網址，不經過函式、不查資料庫）：
//   index/world.json                  岩點貓進 App 只讀這一個：{ climbio: 2, kind: 'index', t, walls: [{ id: '<包>/<牆>', name, gym, v, rt, n, t }] }
//                                     v＝畫面與照片的現行版，rt＝路線最後更新時間，n＝路線數，t＝最後活動時間（發佈、改線）；本機收下的牆比 v、rt，變了才重讀
//   walls/<包>/routes.json            這面牆現在的路線（Climbio 公開格式 v2 圖層，route 節點的 props.u＝作者雜湊前 16 碼；沒有路線就沒有這個檔）
//                                     3D 牆（資料在 climbio/walls3d）也在 index 裡：m3d: 1、base＝它的資料夾網址；路線存的是帶修點 e 的片段，原樣放進
//                                     { climbio: 2, kind: 'routes', wall, t, routes: [{ id, t, u, r: 片段字串 }] }（不併成圖層，3D 的讀法跟以前一樣）
//   walls/<包>/current/<牆>.*         畫面、照片、縮圖的現行版（發佈時由 walls-dataset.js 同一個 commit 放進去）
// 寫入是 Firestore（交易、擁有者、每日額度）；每次路線有變動就把這面牆的 routes.json 和 index 的那一行寫進同一個 commit（路線新增馬上看得到）。
// index 是讀改寫：用 parentCommit 確認沒有別的 commit 插進來，衝突就重讀重寫（最多 4 次）。
const { createHash } = require('node:crypto');
const { REPO } = require('./walls-dataset');
const { hfBase } = require('./projects');
const { fixedId } = require('./open-format');

const INDEX = 'index/world.json', ORIGIN = 'https://climbio.app';
const resolve = (path) => `https://huggingface.co/datasets/${REPO}/resolve/main/${path}`;
const uHash = (uid) => createHash('sha256').update(String(uid)).digest('hex').slice(0, 16);

/** 讀 index；沒有或壞掉就是空的 */
async function readIndex(hf) {
  try { const d = JSON.parse(await hf.read(INDEX)); if (d && Array.isArray(d.walls)) return d; } catch (e) { /* 空的 */ }
  return { climbio: 2, kind: 'index', walls: [] };
}
const withRow = (index, row) => ({ ...index, walls: [...index.walls.filter(w => w.id !== row.id), ...(row.drop ? [] : [row])].sort((a, b) => (a.id < b.id ? -1 : 1)) });

/** 一個 commit：build(index) → { files, row }；index 的那一行跟檔案一起寫。衝突（別的 commit 先進去了）就重來 */
async function mutate({ hf, build, now = Date.now, tries = 4 }) {
  for (let i = 0; ; i++) {
    const parent = await hf.head(), index = await readIndex(hf), { files, row, summary } = await build(index);
    const next = withRow(index, row);
    try { await hf.commit(summary, [...files, { path: INDEX, bytes: Buffer.from(JSON.stringify({ ...next, t: now() })) }], { parentCommit: parent }); return next; }
    catch (e) { if (!e.conflict || i >= tries - 1) throw e; }
  }
}

/** 3D 牆的路線：片段（帶修點 e）原樣放，不併成圖層 */
function routes3d({ pid, routes, t = 0 }) {
  return { climbio: 2, kind: 'routes', wall: pid, t, routes: Object.entries(routes).map(([id, x]) => ({ id, t: x.t || 0, u: uHash(x.uid), r: x.r })).sort((a, b) => b.t - a.t) };
}

/** 路線圖層：每條路線存的是 { nodes, marks } 片段（walls.js 的 put），併起來就是一個圖層；route 節點帶作者雜湊 props.u */
function routesLayer({ pid, pack, name, gym, routes, t = 0 }) {
  const nodes = new Map(), marks = [];
  for (const [rid, x] of Object.entries(routes)) {
    let f; try { f = JSON.parse(x.r); } catch (e) { continue; }
    for (const n of f.nodes || []) {
      if (n.id === rid && n.type === 'route') nodes.set(n.id, { ...n, props: { ...(n.props || {}), u: uHash(x.uid) } });
      else if (!nodes.has(n.id)) nodes.set(n.id, n);
    }
    marks.push(...(f.marks || []));
  }
  const base = `walls/${pack}/current/${pid}`;
  return { climbio: 2, kind: 'layer', id: fixedId(ORIGIN, pid), on: pid, href: resolve(`${base}.json`), t, license: 'CC-BY-SA-4.0',
    props: { ...(gym ? { gym } : {}), ...(name ? { name } : {}), thumb: resolve(`${base}.thumb.jpg`), photo: resolve(`${base}.jpg`) }, nodes: [...nodes.values()], marks };
}

/** 這面牆現在該怎麼公開（Firestore → index 的一行、routes.json）；不是公開牆（沒登記、沒有資料集）回 drop */
async function stateOf(db, pid) {
  const [shared, doc] = await Promise.all([db.collection('shared').doc(pid).get(), db.collection('wallRoutes').doc(pid).get()]);
  const src = shared.exists && shared.get('src'), gym = shared.exists ? String(shared.get('gym') || '') : '';
  if (!src || !gym) return { drop: true };
  const ds = await db.collection('datasets').doc(String(src.project)).get();
  if (!ds.exists) return { drop: true };
  const routes = doc.exists ? (doc.get('routes') || {}) : {}, list = Object.values(routes);
  const rt = Math.max(0, ...list.map(x => x.t || 0)), m3d = ds.get('type') === 'wall3d', hf = ds.get('hf') || {};
  return { m3d, ...(m3d ? { base: `${hfBase({ repo: hf.repo || 'walls3d' })}${hf.dir || `walls3d/${src.project}/`}` } : {}), pack: String(src.project), name: String(shared.get('name') || '').slice(0, 60), gym, v: ds.get('version') || 0, routes, n: list.length, rt, t: Math.max(rt, Number(shared.get('activeAt')) || 0, Number(shared.get('publishedAt')) || 0) };
}

/** 把這面牆的現況寫到資料集：路線變了、現行版換了、收回、過期之後呼叫。最少一個 commit */
async function publishPublic({ db, hf, pid, now = Date.now }) {
  const s = await stateOf(db, pid);
  return mutate({ hf, now, build: async (index) => {
    const old = index.walls.find(w => w.id.endsWith(`/${pid}`));
    const had = old && old.n > 0;   // 資料集裡有 routes.json 才刪（刪不存在的檔 Hub 會報錯）
    if (s.drop) return { summary: `收回 ${pid}`, files: had ? [{ path: `walls/${old.id.split('/')[0]}/routes.json`, deleted: true }] : [], row: { id: old ? old.id : `-/${pid}`, drop: true } };
    const id = `${s.pack}/${pid}`, path = `walls/${s.pack}/routes.json`;
    const body = s.m3d ? routes3d({ pid, routes: s.routes, t: s.rt }) : routesLayer({ pid, pack: s.pack, name: s.name, gym: s.gym, routes: s.routes, t: s.rt });
    const files = s.n ? [{ path, bytes: Buffer.from(JSON.stringify(body)) }] : had ? [{ path, deleted: true }] : [];
    return { summary: `公開 ${pid}`, files, row: { id, name: s.name, gym: s.gym, v: s.v, rt: s.rt, n: s.n, t: s.t, ...(s.m3d ? { m3d: 1, base: s.base } : {}) } };
  } });
}

module.exports = { INDEX, readIndex, withRow, mutate, routesLayer, routes3d, stateOf, publishPublic, resolve, uHash };
