// 已發佈 Guidebook 的版本紀錄（studio/crag/versions.js）：同一本書的版本、每一版跟上一版差在哪裡
import test from 'node:test';
import assert from 'node:assert/strict';
import { versionsOf, diffVersions, counts, isEmpty, show, bigChange } from '../studio/crag/versions.js';

/** 一本小書：岩場 → 岩壁 → 兩條路線，一張照片上畫了兩條線（第一條帶一顆鉤環），地圖上一條牆線 */
function book() {
  const root = { kind: 'set', type: 'guidebook', id: 'book1', name: '測試岩場', attribution: '甲', license: 'CC-BY-SA-4.0',
    nodes: [
      { id: 'crag', type: 'crag', name: '測試岩場' },
      { id: 'w1', type: 'wall', parent: 'crag', name: '大岩壁', props: { order: 1 } },
      { id: 'r1', type: 'route', parent: 'w1', name: '第一條', props: { order: 1, grade: { yds: '5.10a' }, bolts: 3 } },
      { id: 'r2', type: 'route', parent: 'w1', name: '第二條', props: { order: 2, grade: { yds: '5.11b' } } },
    ] };
  const docs = new Map([
    ['v1', { kind: 'view', surface: 'photo', id: 'v1', name: '照片一', sha256: 'aaa' }],
    ['l1', { kind: 'layer', id: 'l1', on: 'v1', nodes: [{ id: 'r1-b01', type: 'bolt', parent: 'r1' }], marks: [
      { node: 'r1', geometry: { type: 'LineString', coordinates: [[1, 9], [2, 1]] } },
      { node: 'r1-b01', geometry: { type: 'Point', coordinates: [1.5, 5] } },
      { node: 'r2', geometry: { type: 'LineString', coordinates: [[5, 9], [6, 1]] } },
    ] }],
    ['m', { kind: 'view', surface: 'map', id: 'm', marks: [{ node: 'w1', geometry: { type: 'LineString', coordinates: [[121, 25], [121.001, 25]] } }] }],
  ]);
  return { root, docs };
}

test('版本清單：同一本書的各版照時間排，第幾版、從哪一版改的', () => {
  const rows = [
    { id: 'x', root: 'x', name: '別本', t: 5 },
    { id: 'a', root: 'a', name: '大邱田', t: 10, dl: 4, lineage: [], others: [
      { id: 'c', t: 30, dl: 0, lineage: ['a', 'b'] },
      { id: 'b', t: 20, dl: 1, lineage: ['a'] },
    ] },
  ];
  const g = versionsOf(rows, ['', 'c']);   // 從新的那一版也找得到整本
  assert.equal(g.name, '大邱田');
  assert.deepEqual(g.versions.map(v => [v.n, v.id, v.origin]), [[1, 'a', ''], [2, 'b', 'a'], [3, 'c', 'b']]);
  assert.equal(versionsOf(rows, ['zzz']), null);
});

test('一模一樣的兩版：沒有差異', () => {
  const d = diffVersions(book(), book());
  assert.ok(isEmpty(counts(d)), JSON.stringify(counts(d)));
});

test('改了什麼：路線的欄位、新增與刪掉的路線、照片、線、地圖、署名都抓得到，照片換了 id 也照 sha256 對上', () => {
  const a = book(), b = book();
  const r1 = b.root.nodes.find(n => n.id === 'r1');
  r1.props.grade = { yds: '5.10b' }; r1.name = '第一條（改）';
  b.root.nodes = b.root.nodes.filter(n => n.id !== 'r2');
  b.root.nodes.push({ id: 'r3', type: 'route', parent: 'w1', name: '新路線', props: { order: 2 } });
  b.root.attribution = '甲；乙 改編';
  // 照片換了 id（改編的匯入會換），sha256 一樣；鉤環移了位置、第二條的線拿掉；多一張照片
  const v = b.docs.get('v1'); b.docs.delete('v1'); b.docs.set('v9', { ...v, id: 'v9' });
  const l = b.docs.get('l1'); l.on = 'v9'; l.marks = l.marks.filter(m => m.node !== 'r2'); l.marks[1].geometry = { type: 'Point', coordinates: [1.5, 6] };
  b.docs.set('v2', { kind: 'view', surface: 'photo', id: 'v2', name: '照片二', sha256: 'bbb' });
  b.docs.get('m').marks[0].geometry.coordinates[1] = [121.002, 25];

  const d = diffVersions(a, b), c = counts(d);
  assert.deepEqual(c.routes, [1, 1, 1]);   // 新增 r3、刪掉 r2、改了 r1
  const ch = d.nodes.changed.find(n => n.id === 'r1');
  assert.deepEqual(ch.fields.map(f => f.key).sort(), ['grade', 'name']);
  assert.equal(show(ch.fields.find(f => f.key === 'grade').to), '5.10b');
  assert.deepEqual(d.photos.added.map(p => p.name), ['照片二']);
  assert.equal(d.photos.removed.length, 0, '換了 id 的同一張照片不算刪掉');
  assert.deepEqual(d.lines.changed.map(x => x.name), ['第一條（改）']);   // 鉤環移了＝這條路線的線改了
  assert.deepEqual(d.lines.removed.map(x => x.route), ['r2']);
  assert.equal(c.map, 1);
  assert.deepEqual(d.info.map(i => i.key), ['attribution']);
});

test('第一版：全部算新增，不列「改了署名」', () => {
  const d = diffVersions(null, book()), c = counts(d);
  assert.deepEqual(c.routes, [2, 0, 0]);
  assert.equal(c.info, 0);
  assert.equal(c.map, 0);
});

test('大改：一次刪超過 3 條路線（或 10%）、2 面岩壁、3 張照片才算，小改照舊接在後面', () => {
  const many = () => {
    const b = book();
    for (let i = 3; i <= 40; i++) b.root.nodes.push({ id: `r${i}`, type: 'route', parent: 'w1', name: `路線${i}` });
    for (let i = 2; i <= 8; i++) b.docs.set(`v${i}`, { kind: 'view', surface: 'photo', id: `v${i}`, name: `照片${i}`, sha256: `s${i}` });
    return b;
  };
  const a = many();
  assert.deepEqual(bigChange(null, a), [], '第一版沒有上一版');
  const small = many();
  small.root.nodes = small.root.nodes.filter(n => !['r3', 'r4', 'r5', 'r6'].includes(n.id));   // 40 條刪 4 條：沒超過 10%
  small.docs.delete('v2');
  assert.deepEqual(bigChange(a, small), []);
  const big = many();
  big.root.nodes = big.root.nodes.filter(n => !/^r(1\d)$/.test(n.id));   // 刪 10 條
  for (const k of ['v2', 'v3', 'v4', 'v5']) big.docs.delete(k);
  assert.deepEqual(bigChange(a, big), [{ kind: 'routes', n: 10 }, { kind: 'photos', n: 4 }]);
});
