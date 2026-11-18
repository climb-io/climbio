import test from 'node:test';
import assert from 'node:assert/strict';
import { packBackup, readBackup, restoreBackup } from '../appkit/backup.mjs';
import { collectionGroups, exportCollections } from '../appkit/collection-backup.mjs';

const options = { app: 'hold', stores: ['docs'], preferences: ['log'] };
test('備份完整保存照片、ArrayBuffer、TypedArray 與紀錄，拒絕其他 App 與非允許設定', async () => {
  const value = { photo: new Blob(['photo'], { type: 'image/jpeg' }), bytes: new Uint8Array([1, 2, 255]), buffer: new Uint16Array([500]).buffer, missing: undefined };
  const snapshot = { format: 'climbio-backup', version: 1, app: 'hold', rows: { docs: [{ key: 'a', value }] }, prefs: { log: '{"a":2}' }, groups: [], created: 1 };
  const blob = await packBackup(snapshot), restored = await readBackup(blob, options);
  assert.equal(await restored.rows.docs[0].value.photo.text(), 'photo');
  assert.equal(restored.rows.docs[0].value.photo.type, 'image/jpeg');
  assert.deepEqual(restored.rows.docs[0].value.bytes, value.bytes);
  assert.deepEqual(restored.rows.docs[0].value.buffer, value.buffer);
  assert.ok(Object.hasOwn(restored.rows.docs[0].value, 'missing'));
  assert.equal(restored.prefs.log, snapshot.prefs.log);
  await assert.rejects(readBackup(blob, { ...options, app: 'redpoint' }), /此 App/);
  snapshot.prefs.token = 'forbidden';
  await assert.rejects(readBackup(await packBackup(snapshot), options), /範圍/);
  await assert.rejects(readBackup(new Blob(['broken']), options));
});

test('岩場範圍包含巢狀組合、照片與圖層，其餘資料獨立列出', () => {
  const docs = [{ id: 'home', kind: 'set', items: [{ id: 'a' }] }, { id: 'a', name: '甲', kind: 'set', items: [{ id: 'nested' }] }, { id: 'nested', kind: 'set', items: [{ id: 'photo' }] }, { id: 'photo', kind: 'view' }, { id: 'layer', kind: 'layer', on: 'photo' }];
  const rows = { docs: docs.map(value => ({ key: value.id, value })), meta: [{ key: 'home', value: 'home' }], photos: [{ key: 'photo', value: 1 }, { key: 'other', value: 1 }] };
  const groups = collectionGroups({ rows }, { nameOf: d => d.name || d.id, otherName: '其他' });
  const a = groups.find(g => g.id === 'a');
  assert.ok(a.records.docs.includes('photo'));
  assert.deepEqual(a.records.photos, ['photo']);
  assert.deepEqual(groups.find(g => g.id === 'local-extras').records.photos, ['other']);
});


test('匯出只包含選中的岩場、照片與紀錄，不洩漏其他岩場資料', () => {
  const rows = { docs: [{ key: 'home', value: { id: 'home', items: [{ id: 'a' }, { id: 'b' }] } }, { key: 'a', value: { id: 'a' } }, { key: 'b', value: { id: 'b' } }], photos: [{ key: 'a', value: 'photo-a' }, { key: 'b', value: 'photo-b' }], meta: [{ key: 'home', value: 'home' }, { key: 'sources', value: { a: 'url-a', b: 'url-b' } }, { key: 'mine', value: ['a', 'b'] }] };
  const snapshot = { rows, prefs: { log: JSON.stringify({ a: { r: 1 }, b: { r: 2 } }) }, groups: ['a', 'b'].map(id => ({ id, name: id, records: { docs: [id], photos: [id] } })) };
  const out = exportCollections(snapshot, ['a'], 'log');
  assert.deepEqual(out.rows.docs.map(r => r.key), ['a', 'home']);
  assert.deepEqual(out.rows.docs.find(r => r.key === 'home').value.items, [{ id: 'a' }]);
  assert.deepEqual(out.rows.photos.map(r => r.key), ['a']);
  assert.deepEqual(out.rows.meta.find(r => r.key === 'sources').value, { a: 'url-a' });
  assert.deepEqual(JSON.parse(out.prefs.log), { a: { r: 1 } });
  assert.equal(snapshot.rows.docs.length, 3);
});

test('選擇性復原在備份往返後按複合鍵內容取資料，未勾選的內容與設定不動', async () => {
  const config = { app: 'hold', stores: ['docs', 'routes'], preferences: ['log'] };
  const snapshot = { format: 'climbio-backup', version: 1, app: 'hold', created: 1,
    rows: { docs: [{ key: 'a', value: '甲新版' }, { key: 'b', value: '乙備份' }],
      routes: [{ key: ['a', 'r1'], value: '甲路線' }, { key: ['b', 'r1'], value: '乙路線' }] },
    groups: ['a', 'b'].map(id => ({ id, name: id, records: { docs: [id], routes: [[id, 'r1']] } })), prefs: { log: '備份設定' } };
  const restored = await readBackup(await packBackup(snapshot), config);
  const stores = { docs: new Map([['"a"', '甲舊版'], ['"b"', '乙本機']]), routes: new Map() };
  const db = { transaction() {
    const tx = { objectStore: name => ({ keyPath: null, put: (value, key) => stores[name].set(JSON.stringify(key), value) }) };
    setImmediate(() => tx.oncomplete());
    return tx;
  } };
  const storage = { log: '本機設定' };
  const selected = await restoreBackup(restored, { ...config, db, storage, ids: ['a'] });
  assert.deepEqual(selected.map(g => g.id), ['a']);
  assert.deepEqual([...stores.docs], [['"a"', '甲新版'], ['"b"', '乙本機']]);
  assert.deepEqual([...stores.routes], [['["a","r1"]', '甲路線']]);
  assert.equal(storage.log, '本機設定');
  await assert.rejects(restoreBackup(restored, { ...config, db, storage, ids: ['missing'] }), /找不到勾選/);
});

