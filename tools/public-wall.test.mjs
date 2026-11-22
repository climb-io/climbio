// 公開牆（js/sync.js 的 mergePulled、readPublic）：同一張照片大家看到同一份線；用替身的後端，不連 Firebase。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const profile = readFileSync(new URL('../js/profile.js', import.meta.url), 'utf8');
const sync = readFileSync(new URL('../js/sync.js', import.meta.url), 'utf8');
const line = (src, name) => src.split('\n').find(l => l.includes(`const ${name} =`));
const block = (src, head) => { const i = src.indexOf(head); return src.slice(i, src.indexOf('\n  }\n', i) + 4); };
const section = sync.slice(sync.indexOf('  // ---------- 公開牆'), sync.indexOf("  $('rvClose')"));
const plain = (v) => JSON.parse(JSON.stringify(v));
const id = (ms, tail = 'aaaaa') => 'r' + ms.toString(36) + tail;
const T1 = 1793000000000, T2 = T1 + 60000, T3 = T2 + 60000;

function setup(wall, docs = [], layers = {}, open = null) {
  const reads = [], moved = [], unpub = [], pushed = [], layerReads = [], deleted = [], alerts = [], asks = [], patched = [], answer = { remove: true };
  const ctx = vm.createContext({
    deviceId: () => 'phone', signName: () => 'Kant', hash53: (s) => s, wallSig: (w) => JSON.stringify(w.routes), OLD_DEVICES_KEY: 'devices', lsGet: (k, d) => d, Date, Map, Set, JSON,
    routeReady: () => true, can: () => true, autoShare: () => {}, navigator: { onLine: true },
    state: { wall: open }, $: () => ({ hidden: true }), deleteWall: async (id) => { deleted.push(id); }, showAlert: (msg) => { alerts.push(msg); }, askConfirm: async (msg, o) => { asks.push(msg); return answer.remove; }, patchWall: async (wid, fn) => { const x = { id: wid }; fn(x); patched.push(x); }, repaint: () => {}, t: (k, ...a) => `${k}:${a.join(',')}`, setTimeout, clearTimeout, showHome: () => {}, renderOverview: () => {}, renderShareCount: () => {}, console,
    liveWall: async () => wall, listWalls: async () => [wall], putWall: async () => {},
    pushWall: async (wid, rids) => { pushed.push(...rids); }, shareBody: () => ({}), sharedIn: () => [], wallMode: () => 'public',
    ShareTools: { layerRoutes: async (url, pid) => { layerReads.push(url); const l = layers[url]; if (l === undefined) throw Object.assign(new Error('gone'), { gone: true }); if (l instanceof Error) throw l; return JSON.parse(JSON.stringify(l)); } },
    Backend: { primeShared: async () => {}, listShared: async (pid) => { reads.push(pid); return docs; }, unshareRoutes: async (pid, rids) => { unpub.push(...rids); } },
  });
  const src = [line(app, 'deadKey'), line(profile, 'mineRoute'), line(sync, 'pubRoute'), line(sync, 'pubSig'),
    line(sync, 'isDemoPid'), line(sync, 'localOnly'), line(sync, 'liveIn'), section].join('\n');
  vm.runInContext(`${src}\nthis.api = { mergePulled, pullWall, readPublic, pubSig, pubRoute };`, ctx);
  return { ...ctx.api, reads, moved, unpub, pushed, layerReads, deleted, alerts, asks, patched, answer };
}
const doc = (r, { mine = false } = {}) => ({ rid: r.id, mine, r: JSON.stringify(r), t: r.t });

test('伺服器上的為準：作者改了就換、刪了就拿掉；還沒傳上去的留著；別人的新線記成新的', () => {
  const friend = { id: id(T1), t: 5, name: '新版', author: '朋友', u: 'f', holds: { a: 's', b: 't' } };
  const gone = { id: id(T1, 'bbbbb'), t: 1, author: '朋友', u: 'f', holds: { c: 's', d: 't' } };
  const w = { id: 'w', pid: 'publicwall1', pub: 1, routes: [{ ...friend, name: '舊版', t: 1, own: 0 }, { ...gone, pub: 'x', own: 0 }, { id: id(T2), t: 2, holds: { e: 's', f: 't' } }] };
  const fresh = { id: id(T3), t: 3, author: '路人', u: 'x', holds: { g: 's', h: 't' } };
  const s = setup(w);
  const m = s.mergePulled(w, [doc(friend), doc(fresh)]);
  assert.deepEqual(plain(m.routes.map(r => [r.id, r.name || ''])), [[fresh.id, ''], [friend.id, '新版'], [id(T2), '']]);   // 伺服器上的照路線時間由舊到新，還沒傳上去的接在後面
  assert.deepEqual(plain(m.fresh), [fresh.id]);
  assert.equal(m.routes[0].own, 0);
  assert.equal(m.routes[0].pub, s.pubSig(m.routes[0]));
});

test('自己改了還沒傳上去的留著；自己刪了、伺服器上還在的要刪；別人的線刪過就是隱藏，收下（got）比刪除晚就回來', () => {
  const mine = { id: id(T1), t: 9, name: '改過', holds: { a: 's', b: 't' } }, gone = { id: id(T2), t: 1, holds: { c: 's', d: 't' } };
  const hid = { id: id(T3), t: 1, author: '朋友', u: 'f', holds: { e: 's', f: 't' } }, back = { id: id(T3, 'ccccc'), t: 1, author: '朋友', u: 'f', holds: { g: 's', h: 't' } };
  const w = { id: 'w', pid: 'publicwall1', pub: 1, routes: [{ ...mine, own: 1, pub: 'old' }, { ...back, got: 9, own: 0 }],
    deleted: { routes: { [gone.id]: 5, [hid.id]: 5, [back.id]: 5 } } };
  const s = setup(w);
  const m = s.mergePulled(w, [doc({ ...mine, t: 3, name: '伺服器' }, { mine: true }), doc(gone, { mine: true }), doc(hid), doc(back)]);
  assert.deepEqual(plain(m.routes.map(r => [r.id, r.name || ''])), [[back.id, ''], [mine.id, '改過']]);   // 路線時間由舊到新
  assert.deepEqual(plain(m.gone), [gone.id]);
  assert.deepEqual(plain(m.hidden.map(r => r.id)), [hid.id]);
});

test('同點的線不比對：大家的、自己的都留著', () => {
  const first = { id: id(T1), t: 1, author: '朋友', u: 'f', holds: { a: 's', b: 't' } }, later = { id: id(T2), t: 9, holds: { b: 't', a: 's' } };
  const w = { id: 'w', pid: 'publicwall1', pub: 1, routes: [{ ...later, sent: 1 }] };
  const s = setup(w);
  const m = s.mergePulled(w, [doc(first)]);
  assert.deepEqual(plain(m.routes.map(r => [r.id, r.sent])), [[first.id, null], [later.id, 1]]);
});

test('伺服器的版本取代本地時，本地的完攀留著；分享出去的內容不帶完攀', () => {
  const friend = { id: id(T1), t: 5, name: '新版', author: '朋友', u: 'f', holds: { a: 's', b: 't' } };
  const w = { id: 'w', pid: 'publicwall1', pub: 1, routes: [{ ...friend, name: '舊版', t: 1, own: 0, sent: 1 }] };
  const s = setup(w);
  const m = s.mergePulled(w, [doc(friend)]);
  assert.deepEqual(plain(m.routes.map(r => [r.name, r.sent])), [['新版', 1]]);
  assert.equal('sent' in plain(s.pubRoute({ ...friend, sent: 1 })), false);
});

test('讀完只合併本地：自己刪了的線從公開牆拿掉、不上傳待分享路線；同一面 5 分鐘內不重讀，下拉可以', async () => {
  const pending = { id: id(T1), t: 2, holds: { a: 's', b: 't' } }, gone = { id: id(T2), t: 1, holds: { c: 's', d: 't' } };
  const w = { id: 'w', pid: 'publicwall1', pub: 1, routes: [pending], deleted: { routes: { [gone.id]: 5 } } };
  const s = setup(w, [doc(gone, { mine: true })]);
  await s.readPublic();
  await s.readPublic();
  assert.deepEqual(plain(s.reads), ['publicwall1']);
  assert.deepEqual(plain(s.unpub), [gone.id]);   // 自己刪了、公開牆上還在：告訴伺服器拿掉（5 分鐘內不重讀）
  assert.deepEqual(plain(s.pushed), []);
  await s.readPublic(undefined, { force: true });
  assert.equal(s.reads.length, 2);
});

test('擁有者收回了公開（讀到沒有公開）：收來的牆自動跳出清單問一次，一鍵全部移除（連路線）；選保留就不再當公開牆讀；自己的牆、正在看的牆、沒說沒公開的不問', async () => {
  const withdrawn = () => Object.assign([], { published: false });
  const received = { id: 'w', pid: 'publicwall1', name: '朋友的牆', pub: 1, from: 1, routes: [{ id: id(T1), t: 1, holds: { a: 's' } }] };
  const wait = () => new Promise(r => setTimeout(r, 450));
  const s = setup(received, withdrawn());
  await s.readPublic(undefined, { force: true }); await wait();
  assert.deepEqual(plain([s.asks, s.deleted, s.patched]), [['wallsWithdrawn:朋友的牆'], ['w'], []]);
  const keep = setup(received, withdrawn());
  keep.answer.remove = false;
  await keep.readPublic(undefined, { force: true }); await wait();
  assert.deepEqual(plain([keep.asks.length, keep.deleted, keep.patched]), [1, [], [{ id: 'w', pub: 0 }]], '保留：不刪，標成不再是公開牆');
  for (const [wall, docs, open] of [[{ ...received, from: undefined }, withdrawn(), null], [received, withdrawn(), received], [received, [], null], [{ ...received, pub: 0, subs: { x: { ids: [] } } }, withdrawn(), null]]) {
    const t = setup(wall, docs, {}, open);
    await t.readPublic(undefined, { force: true }).catch(() => {});
    await wait();
    assert.deepEqual(plain([t.deleted, t.asks]), [[], []]);
  }
});

test('還沒分享的牆、內建示範牆不讀', async () => {
  for (const w of [{ id: 'own', pid: 'ownwall12345', routes: [] }, { id: 'demo', pid: 'climbiodemo2', pub: 1, routes: [] }]) {
    const s = setup(w);
    await s.readPublic(undefined, { force: true });
    assert.equal(s.reads.length, 0);
  }
});

test('收過的分享包圖層（w.subs）：私人的牆也回頭檢查；作者改了就換、加了就收、刪了就拿掉；圖層不在了就停止檢查', async () => {
  const URL1 = 'https://climbio.app/p/aaaaaaaaaaaaaaaa/layer.json';
  const a = { id: id(T1), t: 1, name: '舊', author: '朋友', u: 'f', holds: { a: 's', b: 't' } }, b = { id: id(T2), t: 1, author: '朋友', u: 'f', holds: { c: 's', d: 't' } };
  const w = { id: 'w', pid: 'privatewall1', routes: [a, b], subs: { [URL1]: { ids: [a.id, b.id] } }, base: { holds: [{ id: 'e', poly: [[0, 0], [1, 0], [1, 1]] }] } };
  const c = { id: id(T3), t: 2, author: '朋友', u: 'f', holds: { e: 's', f: 't' }, shapes: {} };
  const s = setup(w, [], { [URL1]: [{ ...a, name: '新', t: 5, shapes: {} }, c] });
  await s.readPublic(undefined, { force: true });
  assert.deepEqual(plain(s.reads), ['privatewall1']);   // 收過分享的牆也問索引（有人公開就變成公開牆）；這裡沒有人公開
  assert.deepEqual(plain(s.layerReads), [URL1]);
  assert.deepEqual(plain(w.routes.map(r => [r.id, r.name || ''])), [[c.id, ''], [a.id, '新']]);   // 路線時間由舊到新
  assert.deepEqual(plain(w.routes[0].shapes.e.poly), [[0, 0], [1, 0], [1, 1]]);   // 外框用這面牆的原始岩點檔補
  assert.deepEqual(plain(w.subs[URL1].ids), [a.id, c.id]);
  const gone = setup(w, [], {});
  await gone.readPublic(undefined, { force: true });
  assert.deepEqual([w.routes.length, Object.keys(w.subs).length], [0, 0]);
});

test('收過的圖層也在公開牆裡（listShared 讀過）：不再讀第二次', async () => {
  const URL1 = 'https://climbio.app/p/aaaaaaaaaaaaaaaa/layer.json', r = { id: id(T1), t: 1, author: '朋友', u: 'f', holds: { a: 's', b: 't' } };
  const w = { id: 'w', pid: 'publicwall1', pub: 1, routes: [r], subs: { [URL1]: { ids: [r.id] } } };
  const s = setup(w, [{ ...doc(r), src: URL1 }], { [URL1]: [r] });
  await s.readPublic(undefined, { force: true });
  assert.deepEqual([s.reads.length, s.layerReads.length, w.routes.length], [1, 0, 1]);
});
