const { test } = require('node:test');
const assert = require('node:assert/strict');
const { publishWorldIndex, INDEX, WORLD, vOf } = require('./hf-world');

function fakeHf({ conflicts = 0, files = {} } = {}) {
  const st = { files: { ...files }, head: 'c0', commits: [], conflicts };
  return { st,
    read: async (p) => st.files[p] ?? null,
    head: async () => st.head,
    tree: async (dir) => Object.keys(st.files).filter(p => p.startsWith(dir + '/')).map(path => ({ path, size: 1 })),
    commit: async (summary, fs, { parentCommit } = {}) => {
      if (st.conflicts > 0) { st.conflicts--; st.head = `c${st.commits.length + 100}`; throw Object.assign(new Error('hub conflict'), { status: 409, conflict: true }); }
      assert.equal(parentCommit, st.head);
      for (const f of fs) { if (f.deleted) delete st.files[f.path]; else st.files[f.path] = f.bytes.toString(); }
      st.commits.push(fs.map(f => (f.deleted ? '-' : '+') + f.path)); st.head = `c${st.commits.length}`;
    } };
}
const projects = [{ id: 'abc', type: 'guidebook', name: '龍洞', t: 5, url: 'https://huggingface.co/datasets/climbio/crags/resolve/main/crags/abc/index.json' }];
const world = (n) => JSON.stringify({ v: 1, t: n, books: [], oc: [], tree: [] });

test('第一次：index（清單加世界的版本）和 world.<v>.json 一個 commit', async () => {
  const hf = fakeHf();
  const r = await publishWorldIndex({ hf, projects, world: world(1), now: () => 9 });
  assert.equal(r.changed, true);
  const v = vOf(world(1));
  assert.deepEqual(hf.st.commits[0].sort(), [`+${INDEX}`, `+${WORLD(v)}`].sort());
  assert.deepEqual(JSON.parse(hf.st.files[INDEX]), { climbio: 2, kind: 'index', t: 9, world: { v }, projects });
});

test('清單和世界都沒變：不 commit；清單變了世界沒變：只寫 index，不重寫世界檔', async () => {
  const hf = fakeHf();
  await publishWorldIndex({ hf, projects, world: world(1) });
  assert.equal((await publishWorldIndex({ hf, projects, world: world(1), now: () => 99 })).changed, false);
  assert.equal(hf.st.commits.length, 1);
  await publishWorldIndex({ hf, projects: [...projects, { id: 'new', type: 'guidebook', name: '新', t: 6, url: 'u' }], world: world(1) });
  assert.deepEqual(hf.st.commits[1], [`+${INDEX}`]);
});

test('世界檔換了：新的放進去，只留上一份，更舊的刪掉；世界合成失敗（world 是 null）沿用上一份的版本', async () => {
  const hf = fakeHf();
  for (const n of [1, 2, 3]) await publishWorldIndex({ hf, projects, world: world(n) });
  const worlds = Object.keys(hf.st.files).filter(p => p.startsWith('index/world.')).sort();
  assert.deepEqual(worlds, [WORLD(vOf(world(2))), WORLD(vOf(world(3)))].sort());
  assert.equal(JSON.parse(hf.st.files[INDEX]).world.v, vOf(world(3)));
  const before = hf.st.commits.length;
  await publishWorldIndex({ hf, projects: [...projects, { id: 'x', type: 'guidebook', name: 'x', t: 7, url: 'u' }], world: null });
  assert.equal(JSON.parse(hf.st.files[INDEX]).world.v, vOf(world(3)));   // 世界沿用
  assert.equal(hf.st.commits.length, before + 1);
  assert.equal((await publishWorldIndex({ hf: fakeHf(), projects, world: null })).changed, false);   // 從沒有過世界檔、這次也沒有：不寫
});

test('別人的 commit 先進去（衝突）：重讀重寫；一直衝突就放棄丟錯', async () => {
  const hf = fakeHf({ conflicts: 2 });
  await publishWorldIndex({ hf, projects, world: world(1) });
  assert.equal(hf.st.commits.length, 1);
  await assert.rejects(publishWorldIndex({ hf: fakeHf({ conflicts: 9 }), projects, world: world(1) }), /conflict/);
});
