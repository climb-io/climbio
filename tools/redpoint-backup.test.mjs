import { withPack } from './collection-pack-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { convert } from '../extension/thecrag.js';
import { exportCrags, importCrag, itemId, readCrags } from '../appkit/crags.mjs';

const { validate } = createRequire(import.meta.url)('../format/format.js');
const check = (doc, where) => {
  const errors = validate(doc);
  if (errors.length) throw new Error(`${where} 不合格：${errors[0]}`);
  return doc;
};

const page = (url, name, topo) => ({ url, name, sections: {}, groups: ['左'], routes: [
  { id: '1', num: '1', name: '甲', grade: '5.10a', gradeContext: 'US', style: 'sport', length: null, bolts: null, pitches: null, stars: 0, description: '', group: 0 }],
topos: [{ id: topo, w: 100, h: 100, image: 'https://image.example.com/a', marks: [{ route: '1', points: '10 90,20 10' }] }] });

function fakeLocal() {
  const docs = new Map(), photos = new Map(), home = [], collected = {};
  return { docs, photos, home, collected, getDoc: async (id) => docs.get(id), putDocs: async (list) => list.forEach((d) => docs.set(d.id, d)),
    getPhoto: async (id) => photos.get(id), putPhoto: async (id, blob) => photos.set(id, blob), addToHome: async (set) => home.push(set.id),
    getCollected: async (id) => collected[id], setCollected: async (id, v) => { collected[id] = v; } };
}

/** 把 convert 的結果直接存進 local（跟收下一個岩場一樣的資料），回傳岩場 id */
async function collect(local, url, name, topo = '9') {
  const out = convert(page(url, name, topo), { [topo]: { w: 100, h: 100 } }, 10, 'v1');
  const docs = out.files.map((f) => f.json).filter((d) => d && d.kind && d.id);
  await local.putDocs(docs.map((d) => check(d, d.id)));
  for (const d of docs) if (d.kind === 'view' && d.surface === 'photo') await local.putPhoto(d.id, new Blob(['jpeg'], { type: 'image/jpeg' }));
  await local.addToHome(docs.find((d) => d.kind === 'set'));
  return out.id;
}

const zip = async (files) => files;   // 不真的壓縮：打包的內容就是檔案清單
const allDocs = (local) => [...local.docs.values()];
const setsOf = (local) => allDocs(local).filter((d) => d.kind === 'set');

test('匯出：多個岩場一個 ZIP，每個岩場一個資料夾（index.json、畫面、照片）；個人收藏（personal）照樣放進去', async () => {
  const local = fakeLocal();
  const a = await collect(local, 'https://www.thecrag.com/a', '甲岩場'), b = await collect(local, 'https://www.thecrag.com/b', '乙岩場', '10');
  const r = await exportCrags(setsOf(local), { docs: allDocs(local), photoOf: local.getPhoto, zip });
  assert.deepEqual([r.crags.length, r.empty.length, r.left], [2, 0, 0]);
  const names = r.blob.map((f) => f.name);
  for (const id of [a, b]) {
    assert.ok(names.includes(`${id}/index.json`));
    assert.ok(names.some((n) => n.startsWith(`${id}/`) && n.endsWith('.jpg')), '照片在岩場資料夾裡');
  }
  const view = JSON.parse(await r.blob.find((f) => f.name.startsWith(`${a}/`) && /\.json$/.test(f.name) && f.name !== `${a}/index.json`).blob.text());
  assert.equal(view.origin, 'personal');
});

test('匯出：只選一個岩場就只有那一個；沒有 origin 的照片不放進去，整個岩場都沒有就略過、全部都沒有就說明', async () => {
  const local = fakeLocal();
  const a = await collect(local, 'https://www.thecrag.com/a', '甲岩場'), b = await collect(local, 'https://www.thecrag.com/b', '乙岩場', '10');
  const one = await exportCrags(setsOf(local).filter((s) => s.id === a), { docs: allDocs(local), photoOf: local.getPhoto, zip });
  assert.ok(one.blob.every((f) => f.name.startsWith(`${a}/`)));

  const inB = new Set(setsOf(local).find((s) => s.id === b).items.map(itemId));
  const docs = allDocs(local).map((d) => (d.kind === 'view' && inB.has(d.id) ? { ...d, origin: undefined } : d));
  const r = await exportCrags(setsOf(local), { docs, photoOf: local.getPhoto, zip });
  assert.deepEqual(r.crags.map((s) => s.id), [a]);
  assert.deepEqual(r.empty.map((s) => s.id), [b]);
  assert.ok(r.left > 0);
  await assert.rejects(() => exportCrags(setsOf(local).filter((s) => s.id === b), { docs, photoOf: local.getPhoto, zip }), /只留在這支手機/);
});

test('匯出再匯入：檔案、照片、origin 都回來，加進首頁；不用 Drive 授權', async () => {
  const src = fakeLocal();
  const a = await collect(src, 'https://www.thecrag.com/a', '甲岩場');
  await collect(src, 'https://www.thecrag.com/b', '乙岩場', '10');
  const { blob } = await exportCrags(setsOf(src), { docs: allDocs(src), photoOf: src.getPhoto, zip });

  const { crags, bad } = await readCrags(blob, check);
  assert.deepEqual([crags.length, bad.length], [2, 0]);
  const dst = fakeLocal();
  const target = crags.find((c) => c.set.id === a);
  const r = await importCrag(target, { check, local: dst });
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(dst.home, [a], '只匯入勾選的岩場');
  assert.ok(dst.docs.has(a) && dst.docs.size > 1, '組合和裡面的畫面都存進手機');
  const views = allDocs(dst).filter((d) => d.kind === 'view');
  assert.ok(views.length > 0 && views.every((v) => v.origin === 'personal'));
  assert.ok(views.every((v) => dst.photos.get(v.id)?.size > 0), '每張照片都存進手機');
  assert.ok(!dst.docs.has(crags.find((c) => c.set.id !== a).set.id), '沒勾選的岩場沒進來');
});

test('匯入：根目錄的 index.json（分享出去的 ZIP）、Drive 下載壓縮的 Climbio 資料夾（好幾層）都找得到岩場；不合格的列在 bad', async () => {
  const src = fakeLocal();
  const a = await collect(src, 'https://www.thecrag.com/a', '甲岩場');
  const { blob } = await exportCrags(setsOf(src), { docs: allDocs(src), photoOf: src.getPhoto, zip });
  const flat = blob.map((f) => ({ ...f, name: f.name.slice(a.length + 1) }));
  assert.equal((await readCrags(flat, check)).crags[0].set.id, a, '岩場資料夾裡的檔案直接放在根目錄');

  const drive = blob.map((f) => ({ ...f, name: `Climbio/${f.name}` })).concat([{ name: '__MACOSX/Climbio/x.json', blob: new Blob(['x']) }, { name: 'Climbio/專案/project.json', blob: new Blob(['{}']) }]);
  const r = await readCrags(drive, check);
  assert.equal(r.crags.length, 1);
  assert.equal(r.crags[0].dir, `Climbio/${a}/`);
  assert.ok(r.crags[0].files.has('index.json'));

  const broken = await readCrags([{ name: 'x/index.json', blob: new Blob(['{"kind":"view"}']) }, { name: 'y/index.json', blob: new Blob(['不是 JSON']) }], check);
  assert.deepEqual(broken.crags, []);
  assert.equal(broken.bad.length, 2);
});

test('匯入：一份檔案不合格只跳過它，照片不在檔案裡列在 skipped，岩場照收', async () => {
  const src = fakeLocal();
  const a = await collect(src, 'https://www.thecrag.com/a', '甲岩場');
  const { blob } = await exportCrags(setsOf(src), { docs: allDocs(src), photoOf: src.getPhoto, zip });
  const noPhoto = blob.filter((f) => !f.name.endsWith('.jpg')).concat([{ name: `${a}/壞掉.json`, blob: new Blob(['{"kind":"layer"}']) }]);
  const { crags } = await readCrags(noPhoto, check), dst = fakeLocal();
  const r = await importCrag(crags[0], { check, local: dst });
  assert.ok(r.skipped.some((s) => /不在檔案裡/.test(s)));
  assert.ok(r.skipped.some((s) => /壞掉\.json/.test(s)));
  assert.deepEqual(dst.home, [a]);
  assert.equal(dst.photos.size, 0);
});
