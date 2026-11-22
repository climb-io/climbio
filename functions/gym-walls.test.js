const { test } = require('node:test');
const assert = require('node:assert/strict');
const { updateGymWall, updateGymWallsOf, dropGymWall, rebuildGymIndex, registerWall3d } = require('./gym-walls');

// 以文件路徑模擬 Firestore（只做到 gym-walls.js 用到的部分）；gymIndex 的 merge 只做一層 gyms
function database(extra = {}) {
  const data = new Map(Object.entries(extra));
  const snap = (path, v) => ({ exists: v !== undefined, get: k => k.split('.').reduce((o, p) => o && o[p], v || {}), id: path.split('/')[1] });
  const doc = (path) => ({
    get: async () => snap(path, data.get(path)),
    set: async (v, o) => {
      if (!o || !o.merge) return void data.set(path, v);
      const gyms = { ...((data.get(path) || {}).gyms || {}) };
      for (const [g, x] of Object.entries(v.gyms)) if (x && x.n) gyms[g] = x; else delete gyms[g];
      data.set(path, { gyms });
    },
    delete: async () => { data.delete(path); } });
  const rows = (col) => [...data].filter(([p]) => p.startsWith(`${col}/`)).map(([p, v]) => snap(p, v));
  const walls = () => rows('gymWalls');
  const query = (rows) => ({
    get: async () => ({ docs: rows }),
    count: () => ({ get: async () => ({ data: () => ({ count: rows.length }) }) }),
    orderBy: () => ({ limit: () => ({ get: async () => ({ docs: rows.slice().sort((a, b) => b.get('t') - a.get('t')).slice(0, 1) }) }) }),
  });
  return { data, collection: name => ({
    doc: id => doc(`${name}/${id}`),
    where: (f, op, v) => query(rows(name).filter(w => w.get(f) === v)),
    select: () => ({ get: async () => ({ docs: walls() }) }),
  }) };
}
const PID = 'abcdefgh1234', PROJECT = 'wallproject00001';
const SHARED = { owner: 'u1', name: '朋友的牆', gym: '原岩明德', src: { project: PROJECT, path: `${PID}.json` }, publishedAt: 5, activeAt: 7 };
const DATASET = { owner: 'u1', version: 2, files: [`${PID}.json`] };
const world = (extra = {}) => database({ [`shared/${PID}`]: SHARED, [`datasets/${PROJECT}`]: DATASET, ...extra });

test('列出：岩館、牆名用發佈的，路線數和最後活動時間算公開的線，清單帶 src 和資料集的資料夾', async () => {
  const db = world({ [`wallRoutes/${PID}`]: { routes: { r1: { t: 9 }, r2: { t: 12 } }, t: 12 } });
  await updateGymWall({ db, pid: PID });
  assert.deepEqual(db.data.get(`gymWalls/${PID}`), { gym: '原岩明德', name: '朋友的牆', n: 2, t: 12, src: { project: PROJECT, path: `${PID}.json` }, hf: `walls/${PROJECT}/v2/` });
});

test('包發佈新版本：用到這個包的牆重算，清單的資料夾換成現行版；別的包的牆不動', async () => {
  const db = world({ 'gymWalls/otherwall001': { gym: '原岩明德', t: 9, hf: 'walls/otherproject0001/v1/', src: { project: 'otherproject0001', path: 'x.json' } } });
  await updateGymWall({ db, pid: PID });
  assert.equal(db.data.get(`gymWalls/${PID}`).hf, `walls/${PROJECT}/v2/`);
  db.data.set(`datasets/${PROJECT}`, { ...DATASET, version: 3 });   // 發佈了第 3 版
  await updateGymWallsOf({ db, project: PROJECT });
  assert.equal(db.data.get(`gymWalls/${PID}`).hf, `walls/${PROJECT}/v3/`);
  assert.equal(db.data.get('gymWalls/otherwall001').hf, 'walls/otherproject0001/v1/');
});

test('沒有線的牆也列出，時間用最後活動（發佈、改線）', async () => {
  const db = world();
  await updateGymWall({ db, pid: PID });
  assert.deepEqual([db.data.get(`gymWalls/${PID}`).n, db.data.get(`gymWalls/${PID}`).t], [0, 7]);
});

test('不列出：沒登記、沒有 src（收回了）、沒有岩館、資料集的包不在；原本列著的拿掉', async () => {
  for (const extra of [{ [`shared/${PID}`]: undefined }, { [`shared/${PID}`]: { owner: 'u1', name: '牆' } }, { [`shared/${PID}`]: { ...SHARED, gym: '' } }, { [`datasets/${PROJECT}`]: undefined }]) {
    const db = world();
    for (const [k, v] of Object.entries(extra)) if (v === undefined) db.data.delete(k); else db.data.set(k, v);
    db.data.set(`gymWalls/${PID}`, { gym: '原岩明德' });
    assert.equal(await updateGymWall({ db, pid: PID }), null);
    assert.equal(db.data.has(`gymWalls/${PID}`), false);
  }
});

test('岩館索引：列出時算出那間的牆面數和最新時間；換岩館時舊的那間也重算，沒牆了就拿掉', async () => {
  const db = world();
  db.data.set('gymWalls/otherwall001', { gym: '原岩明德', t: 9 });
  db.data.set(`gymWalls/${PID}`, { gym: '紅石士林', t: 1 });
  db.data.set('gymIndex/all', { gyms: { 紅石士林: { n: 1, t: 1 } } });
  await updateGymWall({ db, pid: PID });
  assert.deepEqual(db.data.get('gymIndex/all'), { gyms: { 原岩明德: { n: 2, t: 9 } } });
});

test('岩館索引：拿掉最後一面牆，那間就從索引消失', async () => {
  const db = database();
  db.data.set(`gymWalls/${PID}`, { gym: '原岩明德', t: 1 });
  db.data.set('gymIndex/all', { gyms: { 原岩明德: { n: 1, t: 1 } } });
  await dropGymWall(db, PID);
  assert.deepEqual(db.data.get('gymIndex/all'), { gyms: {} });
});

test('岩館索引：整份重建只讀岩館和時間', async () => {
  const db = database();
  db.data.set('gymWalls/aaaaaaaa', { gym: '原岩明德', t: 3 }); db.data.set('gymWalls/bbbbbbbb', { gym: '原岩明德', t: 7 }); db.data.set('gymWalls/cccccccc', { gym: '角華山', t: 2 });
  await rebuildGymIndex(db);
  assert.deepEqual(db.data.get('gymIndex/all'), { gyms: { 原岩明德: { n: 2, t: 7 }, 角華山: { n: 1, t: 2 } } });
});

test('3D 牆登記：跟公開牆同一份清單（標 m3d、資料夾用資料集的 hf.dir），同一面牆的舊版本拿掉，清單只留最新那版', async () => {
  const v = (id, extra = {}) => [`datasets/${id}`, { type: 'wall3d', version: 1, hf: { dir: `walls3d/${id}/`, repo: 'walls3d' }, ...extra }];
  const A = 'aaaaaaaaaaaaaaaa', B = 'bbbbbbbbbbbbbbbb';
  const db = database(Object.fromEntries([v(A), v(B)]));
  await registerWall3d({ db, id: A, name: '明德 3D', gym: '原岩明德', root: A, now: () => 100 });
  assert.deepEqual(db.data.get(`gymWalls/${A}`), { gym: '原岩明德', name: '明德 3D', n: 0, t: 100, src: { project: A, path: 'index.json' }, hf: `walls3d/${A}/`, m3d: 1, repo: 'walls3d' });
  await registerWall3d({ db, id: B, name: '明德 3D', gym: '原岩明德', root: A, now: () => 200 });
  assert.equal(db.data.has(`gymWalls/${A}`), false);
  assert.equal(db.data.get(`gymWalls/${B}`).t, 200);
  assert.deepEqual(db.data.get('gymIndex/all').gyms, { 原岩明德: { n: 1, t: 200 } });
});

test('3D 牆沒有岩館：不登記', async () => {
  const db = database({ 'datasets/aaaaaaaaaaaaaaaa': { type: 'wall3d', hf: { dir: 'walls3d/aaaaaaaaaaaaaaaa/' } } });
  await registerWall3d({ db, id: 'aaaaaaaaaaaaaaaa', name: '牆', gym: '', root: 'aaaaaaaaaaaaaaaa' });
  assert.equal(db.data.size, 1);
});
