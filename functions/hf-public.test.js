const { test } = require('node:test');
const assert = require('node:assert/strict');
const { publishPublic, routesLayer, uHash, INDEX } = require('./hf-public');

const PACK = 'abcdefgh12345678', PID = 'wall00000001';
const frag = (id, extra = []) => JSON.stringify({ nodes: [{ id, type: 'route', t: 5 }, ...extra], marks: [{ node: 'h1', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }] });
function fakeDb(docs) {
  const doc = (c, id) => ({ get: async () => { const v = docs[`${c}/${id}`]; return { exists: v !== undefined, get: (k) => (v || {})[k] }; } });
  return { collection: (c) => ({ doc: (id) => doc(c, id) }) };
}
function fakeHf({ conflicts = 0, files = {} } = {}) {
  const st = { files: { ...files }, head: 'c0', commits: [], conflicts };
  return { st,
    read: async (p) => st.files[p] ?? null,
    head: async () => st.head,
    commit: async (summary, fs, { parentCommit } = {}) => {
      if (st.conflicts > 0) { st.conflicts--; st.head = `c${st.commits.length + 100}`; throw Object.assign(new Error('hub conflict'), { status: 409, conflict: true }); }
      assert.equal(parentCommit, st.head);
      for (const f of fs) { if (f.deleted) delete st.files[f.path]; else st.files[f.path] = f.bytes.toString(); }
      st.commits.push({ summary, paths: fs.map(f => (f.deleted ? '-' : '+') + f.path) }); st.head = `c${st.commits.length}`;
    } };
}
const base = (routes, extra = {}) => ({
  [`shared/${PID}`]: { name: '測試牆', gym: '測試館', src: { project: PACK, path: `${PID}.json` }, activeAt: 120, publishedAt: 30 },
  [`datasets/${PACK}`]: { type: 'walls', version: 3 },
  ...(routes ? { [`wallRoutes/${PID}`]: { routes } } : {}), ...extra,
});

test('公開一面有路線的牆：同一個 commit 寫 routes.json（圖層，作者只有雜湊）和 index 的那一行', async () => {
  const hf = fakeHf();
  await publishPublic({ db: fakeDb(base({ r1: { uid: 'k:secret-kid', t: 50, r: frag('r1') }, r2: { uid: 'o:https://gym.example', t: 90, r: frag('r2') } })), hf, pid: PID, now: () => 7 });
  assert.equal(hf.st.commits.length, 1);
  assert.deepEqual(hf.st.commits[0].paths.sort(), [`+${INDEX}`, `+walls/${PACK}/routes.json`].sort());
  const index = JSON.parse(hf.st.files[INDEX]);
  assert.deepEqual(index.walls, [{ id: `${PACK}/${PID}`, name: '測試牆', gym: '測試館', v: 3, rt: 90, n: 2, t: 120 }]);
  assert.equal(index.t, 7);
  const layer = JSON.parse(hf.st.files[`walls/${PACK}/routes.json`]);
  assert.equal(layer.kind, 'layer'); assert.equal(layer.on, PID);
  assert.equal(layer.href, `https://huggingface.co/datasets/climbio/walls/resolve/main/walls/${PACK}/current/${PID}.json`);
  const route = layer.nodes.find(n => n.id === 'r1');
  assert.equal(route.props.u, uHash('k:secret-kid'));
  assert.equal(JSON.stringify(layer).includes('secret-kid'), false);   // 原始身分不進公開檔
});

test('路線更新（條數沒變）也更新 rt；路線全刪了就刪 routes.json，index 的 n 變 0', async () => {
  const hf = fakeHf();
  await publishPublic({ db: fakeDb(base({ r1: { uid: 'u', t: 10, r: frag('r1') } })), hf, pid: PID });
  await publishPublic({ db: fakeDb(base({ r1: { uid: 'u', t: 99, r: frag('r1') } })), hf, pid: PID });
  assert.equal(JSON.parse(hf.st.files[INDEX]).walls[0].rt, 99);
  await publishPublic({ db: fakeDb(base(null)), hf, pid: PID });
  assert.equal(`walls/${PACK}/routes.json` in hf.st.files, false);
  assert.deepEqual(JSON.parse(hf.st.files[INDEX]).walls[0], { id: `${PACK}/${PID}`, name: '測試牆', gym: '測試館', v: 3, rt: 0, n: 0, t: 120 });
  // 本來就沒有 routes.json：不送刪除（刪不存在的檔 Hub 會報錯）
  const before = hf.st.commits.length;
  await publishPublic({ db: fakeDb(base(null)), hf, pid: PID });
  assert.equal(hf.st.commits[before].paths.some(p => p.startsWith('-')), false);
});

test('別人的 commit 先進去（衝突）：重讀 index 重寫，別面牆的行不被蓋掉', async () => {
  const other = { climbio: 2, kind: 'index', walls: [{ id: 'zzzzzzzzzzzzzzzz/other', name: '別面', gym: 'G', v: 1, rt: 0, n: 0 }] };
  const hf = fakeHf({ conflicts: 2, files: { [INDEX]: JSON.stringify(other) } });
  await publishPublic({ db: fakeDb(base({ r1: { uid: 'u', t: 5, r: frag('r1') } })), hf, pid: PID });
  assert.equal(hf.st.commits.length, 1);
  assert.deepEqual(JSON.parse(hf.st.files[INDEX]).walls.map(w => w.id), [`${PACK}/${PID}`, 'zzzzzzzzzzzzzzzz/other']);
  await assert.rejects(publishPublic({ db: fakeDb(base(null)), hf: fakeHf({ conflicts: 9 }), pid: PID }), /conflict/);   // 衝突一直不停就放棄（Firestore 已經寫了，下次再補）
});

test('收回、過期（沒有登記）：從 index 拿掉；路線圖層合併不同路線的岩點只留一份', async () => {
  const hf = fakeHf();
  await publishPublic({ db: fakeDb(base({ r1: { uid: 'u', t: 5, r: frag('r1') } })), hf, pid: PID });
  await publishPublic({ db: fakeDb({ [`shared/${PID}`]: { name: '測試牆' } }), hf, pid: PID });   // 收回：shared 只剩名稱
  assert.deepEqual(JSON.parse(hf.st.files[INDEX]).walls, []);
  assert.equal(`walls/${PACK}/routes.json` in hf.st.files, false);
  const layer = routesLayer({ pid: PID, pack: PACK, name: 'n', gym: 'g', t: 1, routes: {
    r1: { uid: 'a', r: frag('r1', [{ id: 'h1', type: 'hold' }]) }, r2: { uid: 'b', r: frag('r2', [{ id: 'h1', type: 'hold' }]) } } });
  assert.equal(layer.nodes.filter(n => n.id === 'h1').length, 1);
});

test('3D 牆也在 index：m3d、base 指到 walls3d 的資料夾；路線的片段（帶修點 e）原樣放，不併成圖層', async () => {
  const hf = fakeHf();
  const frag3 = (id) => JSON.stringify({ nodes: [{ id, type: 'route', t: 5 }], marks: [], e: { h1: { c: 1, p: [0, 0, 1] } } });
  const docs = base({ r1: { uid: 'k:secret', t: 70, r: frag3('r1') } }, { [`datasets/${PACK}`]: { type: 'wall3d', version: 0, hf: { repo: 'walls3d', dir: `walls3d/${PACK}/` } } });
  await publishPublic({ db: fakeDb(docs), hf, pid: PID });
  const row = JSON.parse(hf.st.files[INDEX]).walls[0];
  assert.deepEqual(row, { id: `${PACK}/${PID}`, name: '測試牆', gym: '測試館', v: 0, rt: 70, n: 1, t: 120, m3d: 1, base: `https://huggingface.co/datasets/climbio/walls3d/resolve/main/walls3d/${PACK}/` });
  const file = JSON.parse(hf.st.files[`walls/${PACK}/routes.json`]);
  assert.deepEqual([file.kind, file.wall, file.routes.length], ['routes', PID, 1]);
  assert.equal(file.routes[0].r, frag3('r1'));   // 片段原樣（帶 e）
  assert.equal(file.routes[0].u, uHash('k:secret'));
  assert.equal(JSON.stringify(file).includes('k:secret'), false);
});
