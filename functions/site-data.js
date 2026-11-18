// 站的公開牆面（找牆面、收整面牆用；Climbio 公開格式 v2，見 format/README.md 和 docs/route-format.md）：Hosting 把 /climbio.json、/w/** 轉給雲端函式 routePage。
// 不用登入、允許跨網域，任何 App、任何站都能讀：
//   /climbio.json                     站（組合 type: site）：有公開牆面的岩館，一間一項（gymIndex/all）
//   /w/gym/{岩館}.json                岩館的公開牆面（組合 type: walls）：一面牆一項，最新的在前（gymWalls）
//   /w/{牆 id}/routes.json            這面牆公開的路線（疊在牆上的圖層，最新 50 條；路線連結 /r/{牆 id}/{路線 id}/route.json 是同一個圖層裡的那一條）
//   /w/{牆 id}/thumb.jpg              牆的縮圖（導向資料集）
// 牆的照片和畫面在開放資料集（Hugging Face），這裡只有清單與路線。
const { fixedId, siteSet, gymSet } = require('./open-format');
const { HF_BASE } = require('./projects');
const PID = /^[0-9a-z]{8,40}$/;
const LIST_CACHE = 'public, max-age=600', PHOTO_CACHE = 'public, max-age=86400';
const MAX_WALLS = 500, MAX_ROUTES = 50;

// { kind: 'site' } | { kind: 'gymWalls', gym } | { kind: 'wall', pid, file: 'routes.json' | 'thumb.jpg' }；不是這幾種回 null
function parseDataPath(path) {
  if (path === '/climbio.json') return { kind: 'site' };
  let m = /^\/w\/gym\/([^/]+)\.json$/.exec(path || '');
  if (m) {
    let gym = '';
    try { gym = decodeURIComponent(m[1]); } catch (e) { return null; }
    return gym && gym.length <= 60 ? { kind: 'gymWalls', gym } : null;
  }
  m = /^\/w\/([^/]+)\/(routes\.json|thumb\.jpg)$/.exec(path || '');
  return m && PID.test(m[1]) ? { kind: 'wall', pid: m[1], file: m[2] } : null;
}

async function siteData({ db, origin, listed }) {
  const d = await db.collection('gymIndex').doc('all').get();
  const gyms = Object.entries((d.exists && d.get('gyms')) || {}).map(([gym, x]) => ({ gym, n: x.n || 0, t: x.t || 0 })).sort((a, b) => b.t - a.t);
  return siteSet({ origin, listed, gyms });
}
// 一面牆從哪裡收：有公開路線的讀路線圖層（圖層的 href 指到牆）；還沒有路線的讀資料集裡發佈的入口
async function gymData({ db, gym, origin }) {
  const q = await db.collection('gymWalls').where('gym', '==', gym).orderBy('t', 'desc').limit(MAX_WALLS).get();
  const walls = q.docs.map(d => ({ pid: d.id, name: d.get('name') || '', routes: d.get('n') || 0, t: d.get('t') || 0,
    thumb: `${HF_BASE}${d.get('hf')}${d.id}.thumb.jpg`,
    href: (d.get('n') || 0) > 0 ? `${origin}/w/${d.id}/routes.json` : `${HF_BASE}${d.get('hf')}${d.get('src').path}` }));
  return gymSet({ origin, gym, walls });
}
// 岩點貓公開牆的線（wallRoutes，見 walls.js）：每條存的是圖層的片段 { nodes, marks }，併起來就是一個圖層；
// 牆的畫面（照片、岩點）在擁有者發佈的包裡（/p/{專案}/{牆 id}.json），Climbio 不收照片，所以圖層的 href 指到那裡。沒有（不是這種牆、那條線不在）回 null
async function wallRoutesLayer({ db, origin, pid, rid }) {
  const [doc, w] = await Promise.all([db.collection('shared').doc(pid).get(), db.collection('wallRoutes').doc(pid).get()]);
  if (!doc.exists || !doc.get('src') || !w.exists) return null;
  const all = Object.entries(w.get('routes') || {}).map(([id, x]) => ({ id, t: x.t || 0, f: JSON.parse(x.r) }));
  const items = rid ? all.filter(x => x.id === rid) : all.sort((a, b) => b.t - a.t).slice(0, MAX_ROUTES);
  if (!items.length) return null;
  const nodes = new Map(), marks = [];
  for (const { f } of items) {
    for (const n of f.nodes || []) if (!nodes.has(n.id)) nodes.set(n.id, n);
    marks.push(...(f.marks || []));
  }
  return { climbio: 2, kind: 'layer', id: fixedId(origin, pid, rid), on: pid, href: `${origin}/p/${doc.get('src').project}/${pid}.json`, t: Math.max(0, ...items.map(x => Number(x.f.nodes && (x.f.nodes.find(n => n.id === x.id) || {}).t) || 0)),
    license: 'CC-BY-SA-4.0', nodes: [...nodes.values()], marks };
}
// 路線圖層（這面牆公開的路線，或 rid 那一條）；沒有（不是公開牆、那條線不在）回 null
const routesData = ({ db, origin, pid, rid = '' }) => wallRoutesLayer({ db, origin, pid, rid });
// 縮圖：導向資料集裡牆的縮圖；不是公開牆回 none
async function sendThumb(res, { db, pid, none }) {
  const listed = await db.collection('gymWalls').doc(pid).get();
  if (!listed.exists) return none();
  return res.set('Cache-Control', PHOTO_CACHE).redirect(302, `${HF_BASE}${listed.get('hf')}${pid}.thumb.jpg`);
}

async function sendSiteData(res, { db, origin, listed, p }) {
  res.set('Access-Control-Allow-Origin', '*');
  const none = () => res.set('Cache-Control', 'no-store').status(404).json({ error: 'not found' });
  try {
    if (p.kind === 'site') return res.set('Cache-Control', LIST_CACHE).json(await siteData({ db, origin, listed }));
    if (p.kind === 'gymWalls') return res.set('Cache-Control', LIST_CACHE).json(await gymData({ db, gym: p.gym, origin }));
    if (p.file === 'thumb.jpg') return await sendThumb(res, { db, pid: p.pid, none });
    const data = await routesData({ db, origin, pid: p.pid });
    return data ? res.set('Cache-Control', LIST_CACHE).json(data) : none();
  } catch (e) {
    console.error('公開牆面資料失敗', e);
    return res.set('Cache-Control', 'no-store').status(500).json({ error: 'unavailable' });
  }
}

module.exports = { parseDataPath, siteData, gymData, routesData, sendSiteData };
