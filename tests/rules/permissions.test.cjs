const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const repo = resolve(process.env.RULES_REPO_ROOT || resolve(__dirname, '../..'));
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { ref, uploadBytes, getBytes, listAll, deleteObject } = require('firebase/storage');
const { doc, setDoc, getDoc, updateDoc, deleteDoc, collection, getDocs, query, limit, collectionGroup } = require('firebase/firestore');
let env;
const google = uid => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'google.com' } });
const anonymous = () => env.authenticatedContext('anonymous-test', { firebase: { sign_in_provider: 'anonymous' } });
const identities = [
  ['本人', () => google('alice')], ['其他 Google 帳號', () => google('bob')],
  ['同 UID 的匿名帳號', () => env.authenticatedContext('alice', { firebase: { sign_in_provider: 'anonymous' } })],
  ['匿名帳號', anonymous], ['未驗證', () => env.unauthenticatedContext()],
];
const bytes = new Uint8Array([1, 2, 3]);
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-climbio-acceptance',
    storage: { host: '127.0.0.1', port: 9199, rules: readFileSync(process.env.RULES_STORAGE_FILE || resolve(repo, 'storage.rules'), 'utf8') },
    firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync(resolve(repo, 'firestore.rules'), 'utf8') },
  });
  await env.withSecurityRulesDisabled(async context => {
    for (const file of ['photo.jpg', 'wall.gz', 'holds.gz', 'base.gz']) {
      await uploadBytes(ref(context.storage(), `walls/alice/privatewall/${file}`), bytes, { contentType: file.endsWith('jpg') ? 'image/jpeg' : 'application/gzip' });
    }
    await uploadBytes(ref(context.storage(), 'bases/publicwall/photo.jpg'), bytes, { contentType: 'image/jpeg' });
    for (const file of ['public/projects.json', 'public/other.json', 'public/nested/projects.json']) {
      await uploadBytes(ref(context.storage(), file), bytes, { contentType: 'application/json' });
    }
    await uploadBytes(ref(context.storage(), 'topos/offtopo1234567890/topo.zip'), bytes, { contentType: 'application/zip' });
    await setDoc(doc(context.firestore(), 'users/alice/walls/privatewall'), { name: '僅供隔離測試的私人牆' });
    await setDoc(doc(context.firestore(), 'shared/publicwall/routes/route1'), { owner: 'alice', name: '測試分享' });
    await setDoc(doc(context.firestore(), 'sends/private/routes/route1'), { n: 1 });
    await setDoc(doc(context.firestore(), 'datasets/abcdefgh12345678'), { owner: 'alice', type: 'guidebook', name: '測試 Guidebook', version: 1, t: 1, files: [] });
    await setDoc(doc(context.firestore(), 'datasets/abcdefgh12345678/versions/1'), { name: '測試 Guidebook', t: 1, files: [] });
    await setDoc(doc(context.firestore(), 'gymWalls/publicwall'), { gym: '原岩明德', name: '公開牆', n: 1, t: 1 });
    await setDoc(doc(context.firestore(), 'gymIndex/all'), { gyms: { 原岩明德: { n: 1, t: 1 } } });
  });
});
after(async () => { await env?.cleanup(); });

// 帳號同步不經過 Firebase；舊路徑對本人也關閉，避免重新開放遺留資料。
for (const [name, context] of identities) {
  test(`Storage：${name}不可讀寫或列出舊同步檔`, async () => {
    const st = context().storage();
    for (const file of ['photo.jpg', 'wall.gz', 'holds.gz', 'base.gz']) {
      const item = ref(st, `walls/alice/privatewall/${file}`);
      await assertFails(getBytes(item));
      await assertFails(uploadBytes(item, bytes, { contentType: file.endsWith('jpg') ? 'image/jpeg' : 'application/gzip' }));
      await assertFails(deleteObject(item));
    }
    await assertFails(listAll(ref(st, 'walls/alice/privatewall')));
    await assertFails(uploadBytes(ref(st, 'walls/alice/privatewall/secret.txt'), bytes, { contentType: 'text/plain' }));
  });
  test(`Firestore：${name}不可讀寫或列出舊同步牆`, async () => {
    const fs = context().firestore(), wall = doc(fs, 'users/alice/walls/privatewall');
    await assertFails(getDoc(wall));
    await assertFails(getDocs(collection(fs, 'users/alice/walls')));
    await assertFails(setDoc(wall, { name: '不應寫入' }));
    await assertFails(setDoc(doc(fs, 'users/alice/walls/newwall'), { name: '不應建立' }));
    await assertFails(deleteDoc(wall));
  });
  test(`Storage：${name}可讀世界清單，但不可寫入、刪除或列出目錄`, async () => {
    const st = context().storage(), world = ref(st, 'public/projects.json');
    assert.deepEqual(new Uint8Array(await assertSucceeds(getBytes(world))), bytes);
    await assertFails(uploadBytes(world, bytes, { contentType: 'application/json' }));
    await assertFails(deleteObject(world));
    await assertFails(listAll(ref(st, 'public')));
  });
  test(`Storage：${name}不可直接讀寫其他公開路徑或舊 Topo`, async () => {
    const st = context().storage();
    for (const file of ['public/other.json', 'public/nested/projects.json', 'topos/offtopo1234567890/topo.zip']) {
      const item = ref(st, file);
      await assertFails(getBytes(item));
      await assertFails(uploadBytes(item, bytes, { contentType: file.endsWith('zip') ? 'application/zip' : 'application/json' }));
      await assertFails(deleteObject(item));
    }
    await assertFails(uploadBytes(ref(st, 'public/new.json'), bytes, { contentType: 'application/json' }));
  });
}

test('Firestore：匿名、Google 都不能讀岩館公開牆面清單和索引（App 改讀公開牆面檔）', async () => {
  for (const c of [anonymous(), google('alice')]) {
    await assertFails(getDoc(doc(c.firestore(), 'gymWalls/publicwall')));
    await assertFails(getDocs(query(collection(c.firestore(), 'gymWalls'), limit(30))));
    await assertFails(getDoc(doc(c.firestore(), 'gymIndex/all')));
  }
});
test('Firestore：私有完攀統計不可讀', async () => assertFails(getDoc(doc(anonymous().firestore(), 'sends/private/routes/route1'))));
// 分享資料（公開牆、私人清單、底圖、上傳開關）只經過雲端函式 share：App 不管什麼身分都不能直接讀寫
for (const [name, context] of [['作者', () => google('alice')], ['其他 Google 帳號', () => google('bob')], ['匿名', anonymous], ['未驗證', () => env.unauthenticatedContext()]]) {
  test(`Firestore：${name}不能直接讀寫分享資料`, async () => {
    const fs = context().firestore();
    await assertFails(getDoc(doc(fs, 'shared/publicwall/routes/route1')));
    await assertFails(getDocs(query(collection(fs, 'shared/publicwall/routes'), limit(100))));
    await assertFails(getDocs(query(collectionGroup(fs, 'routes'), limit(100))));
    await assertFails(getDoc(doc(fs, 'shared/publicwall')));
    await assertFails(setDoc(doc(fs, 'shared/publicwall/routes/route9'), { owner: 'alice', r: '{}', t: 1 }));
    await assertFails(updateDoc(doc(fs, 'shared/publicwall/routes/route1'), { name: '改' }));
    await assertFails(deleteDoc(doc(fs, 'shared/publicwall/routes/route1')));
    await assertFails(setDoc(doc(fs, 'shared/newwall1234'), { owner: 'alice', name: '牆' }));
    await assertFails(getDoc(doc(fs, 'config/uploads')));
    await assertFails(setDoc(doc(fs, 'config/uploads'), { off: false }));
  });
  test(`Storage：${name}不能直接讀寫分享的底圖`, async () => {
    const st = context().storage();
    await assertFails(getBytes(ref(st, 'bases/publicwall/photo.jpg')));
    await assertFails(uploadBytes(ref(st, 'bases/newpublicwall/photo.jpg'), bytes, { contentType: 'image/jpeg' }));
    await assertFails(deleteObject(ref(st, 'bases/publicwall/photo.jpg')));
  });
}
// Climbio Studio 發佈的專案索引：只有雲端函式寫，網頁、App 都不能直接讀寫（建立的人也不行，發佈、下架都走函式）
for (const [name, context] of [['建立的人', () => google('alice')], ['其他 Google 帳號', () => google('bob')], ['匿名', anonymous], ['未驗證', () => env.unauthenticatedContext()]]) {
  test(`Firestore：${name}不可讀發佈的專案索引與舊版本`, async () => {
    await assertFails(getDoc(doc(context().firestore(), 'datasets/abcdefgh12345678')));
    await assertFails(getDoc(doc(context().firestore(), 'datasets/abcdefgh12345678/versions/1')));
    await assertFails(getDocs(query(collection(context().firestore(), 'datasets'), limit(10))));
  });
  test(`Firestore：${name}不可寫、不可刪發佈的專案索引`, async () => {
    await assertFails(setDoc(doc(context().firestore(), 'datasets/abcdefgh12345678'), { owner: 'alice', name: '改', version: 2, t: 2, files: [] }));
    await assertFails(setDoc(doc(context().firestore(), 'datasets/newbook12345678/versions/1'), { name: '新', t: 1, files: [] }));
    await assertFails(deleteDoc(doc(context().firestore(), 'datasets/abcdefgh12345678')));
  });
}
