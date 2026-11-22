const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler, cleanNearby, roomOf } = require('./nearby');

// 最小的記憶體 Firestore：doc().get/set/update/delete、where(欄位, '==' 、'<' 或 'array-contains', 值).get／onSnapshot、size
function fakeDb() {
  const data = {}, listeners = new Set();
  const notify = () => queueMicrotask(() => { for (const l of [...listeners]) l.cb(); });
  const col = name => {
    const rows = () => (data[name] ??= new Map());
    const ref = id => ({ id, get: async () => ({ exists: rows().has(id), data: () => rows().get(id) }), set: async v => { rows().set(id, { ...v }); notify(); },
      update: async v => { rows().set(id, { ...rows().get(id), ...v }); notify(); }, delete: async () => { rows().delete(id); notify(); } });
    const query = (field, op, v) => {
      const get = async () => {
        const docs = [...rows()].filter(([, d]) => (op === '==' ? d[field] === v : op === 'array-contains' ? (d[field] || []).includes(v) : d[field] < v)).map(([id, d]) => ({ id, data: () => d, ref: ref(id) }));
        return { docs, size: docs.length };
      };
      return { get, onSnapshot: cb => { const l = { cb: () => cb({}) }; listeners.add(l); queueMicrotask(l.cb); return () => listeners.delete(l); } };
    };
    return { doc: ref, where: query };
  };
  return { collection: col, listeners };
}
const call = async (handler, ip, body) => {
  let out;
  await handler({ method: 'POST', ip, body }, { set() {}, status(c) { out = { status: c }; return this; }, json(b) { out = { status: out?.status ?? 200, body: b }; } });
  return out;
};

test('同一個網路互相看得到，不同網路看不到', async () => {
  const h = createHandler({ db: fakeDb() });
  const a = (await call(h, '1.2.3.4', { op: 'join', app: 'hold', name: '岩點貓1234' })).body;
  const b = (await call(h, '1.2.3.4', { op: 'join', app: 'hold', name: '岩點貓5678' })).body;
  const c = (await call(h, '9.9.9.9', { op: 'join', app: 'hold', name: '岩點貓0000' })).body;
  assert.deepEqual(b.peers, [{ id: a.id, name: '岩點貓1234', app: 'hold' }]);
  assert.deepEqual(c.peers, []);
  const pa = (await call(h, '1.2.3.4', { op: 'poll', id: a.id })).body;
  assert.deepEqual(pa.peers, [{ id: b.id, name: '岩點貓5678', app: 'hold' }]);
});

test('岩點貓和紅點貓互相看不到；Studio 看得到兩者，也能互傳訊息', async () => {
  const h = createHandler({ db: fakeDb() });
  const x = (await call(h, '1.2.3.4', { op: 'join', app: 'hold', name: 'x' })).body;
  const y = (await call(h, '1.2.3.4', { op: 'join', app: 'redpoint', name: 'y' })).body;
  assert.deepEqual(y.peers, []);
  assert.equal((await call(h, '1.2.3.4', { op: 'send', id: y.id, to: x.id, msg: 1 })).status, 404);
  const s = (await call(h, '1.2.3.4', { op: 'join', app: 'studio', name: 's' })).body;
  assert.deepEqual(s.peers.map(p => p.app).sort(), ['hold', 'redpoint']);
  assert.equal((await call(h, '1.2.3.4', { op: 'send', id: s.id, to: x.id, msg: 1 })).status, 200);
});

test('訊息只有收件人拿得到，拿過就清掉；不同網路不能傳', async () => {
  const h = createHandler({ db: fakeDb() });
  const a = (await call(h, '1.1.1.1', { op: 'join', app: 'hold', name: 'a' })).body.id;
  const b = (await call(h, '1.1.1.1', { op: 'join', app: 'hold', name: 'b' })).body.id;
  const o = (await call(h, '2.2.2.2', { op: 'join', app: 'hold', name: 'o' })).body.id;
  assert.equal((await call(h, '1.1.1.1', { op: 'send', id: a, to: b, msg: { hi: 1 } })).status, 200);
  assert.equal((await call(h, '2.2.2.2', { op: 'send', id: o, to: b, msg: { hi: 2 } })).status, 404);
  assert.deepEqual((await call(h, '1.1.1.1', { op: 'poll', id: a })).body.msgs, []);
  const got = (await call(h, '1.1.1.1', { op: 'poll', id: b })).body.msgs;
  assert.deepEqual(got.map(m => [m.from, m.msg]), [[a, { hi: 1 }]]);
  assert.deepEqual((await call(h, '1.1.1.1', { op: 'poll', id: b })).body.msgs, []);
});

test('太久沒 poll 的人看不到；代號不對網路回 410；太大的訊息拒絕', async () => {
  let t = 1e6;
  const h = createHandler({ db: fakeDb(), now: () => t });
  const a = (await call(h, '1.1.1.1', { op: 'join', app: 'hold', name: 'a' })).body.id;
  const b = (await call(h, '1.1.1.1', { op: 'join', app: 'hold', name: 'b' })).body.id;
  assert.equal((await call(h, '5.5.5.5', { op: 'poll', id: a })).status, 410);
  assert.equal((await call(h, '1.1.1.1', { op: 'send', id: a, to: b, msg: 'x'.repeat(20000) })).status, 413);
  t += 80e3;
  await call(h, '1.1.1.1', { op: 'poll', id: a });
  assert.deepEqual((await call(h, '1.1.1.1', { op: 'poll', id: a })).body.peers, []);
  assert.equal((await call(h, '1.1.1.1', { op: 'send', id: a, to: b, msg: 1 })).status, 404);
});

test('離開、不合法的名稱與 App、非 POST', async () => {
  const h = createHandler({ db: fakeDb() });
  assert.equal((await call(h, '1.1.1.1', { op: 'join', app: 'x', name: 'a' })).status, 400);
  assert.equal((await call(h, '1.1.1.1', { op: 'join', app: 'hold', name: '<>' })).status, 400);
  const a = (await call(h, '1.1.1.1', { op: 'join', app: 'hold', name: 'a' })).body.id;
  await call(h, '1.1.1.1', { op: 'leave', id: a });
  assert.equal((await call(h, '1.1.1.1', { op: 'poll', id: a })).status, 410);
  assert.equal((await call(h, '1.1.1.1', null)).status, 400);
});

test('IPv6 同一個 /64 同一個房間；清理掃掉過期的', async () => {
  assert.equal(roomOf('2001:db8:1:2:aaaa::1'), roomOf('2001:db8:1:2:bbbb::9'));
  assert.notEqual(roomOf('2001:db8:1:3::1'), roomOf('2001:db8:1:2::1'));
  const db = fakeDb();
  const h = createHandler({ db, now: () => 1000 });
  const a = (await call(h, '1.1.1.1', { op: 'join', app: 'hold', name: 'a' })).body.id;
  await cleanNearby(db, 1000 + 61e3);
  assert.equal((await db.collection('nearby').doc(a).get()).exists, false);
});

test('配對房間：IP 房間不同也找得到、傳得到；沒有同一個配對房間就不行', async () => {
  const h = createHandler({ db: fakeDb() });
  const room = 'a'.repeat(24);
  const a = (await call(h, '1.1.1.1', { op: 'join', app: 'hold', name: 'a', pairRooms: [room, 'bad'] })).body;
  const b = (await call(h, '2001:db8:1:2::5', { op: 'join', app: 'hold', name: 'b', pairRooms: [room] })).body;
  const c = (await call(h, '3.3.3.3', { op: 'join', app: 'hold', name: 'c', pairRooms: ['b'.repeat(24)] })).body;
  assert.deepEqual(b.peers.map(p => p.id), [a.id]);
  assert.deepEqual(b.peers[0].via, [room]);   // 客戶端靠 via 知道是哪個配對房間找到的
  assert.equal(c.peers.length, 0);
  assert.deepEqual((await call(h, '1.1.1.1', { op: 'poll', id: a.id })).body.peers.map(p => p.id), [b.id]);
  assert.equal((await call(h, '1.1.1.1', { op: 'send', id: a.id, to: b.id, msg: { hi: 1 } })).status, 200);
  assert.deepEqual((await call(h, '2001:db8:1:2::5', { op: 'poll', id: b.id })).body.msgs.map(m => m.msg), [{ hi: 1 }]);
  assert.equal((await call(h, '3.3.3.3', { op: 'send', id: c.id, to: a.id, msg: { hi: 2 } })).status, 404);
});

test('同一台裝置（dev）重新加入：上一個分身馬上清掉，也不會出現在自己的附近的人裡', async () => {
  const h = createHandler({ db: fakeDb() });
  const dev = 'ab'.repeat(8);
  const a1 = (await call(h, '1.1.1.1', { op: 'join', app: 'hold', name: 'x', dev })).body;
  const b = (await call(h, '1.1.1.1', { op: 'join', app: 'hold', name: 'y', dev: 'cd'.repeat(8) })).body;
  assert.deepEqual(b.peers.map(p => p.id), [a1.id]);
  const a2 = (await call(h, '1.1.1.1', { op: 'join', app: 'hold', name: 'x', dev })).body;   // 同一台重新載入
  assert.deepEqual(a2.peers.map(p => p.id), [b.id]);
  assert.deepEqual((await call(h, '1.1.1.1', { op: 'poll', id: b.id })).body.peers.map(p => p.id), [a2.id]);   // 舊的不見了
  assert.equal((await call(h, '1.1.1.1', { op: 'poll', id: a1.id })).status, 410);
});

test('poll 帶 wait：沒變動就等到時間才回；有人上線或有訊息馬上回；沒有留下監聽', async () => {
  const db = fakeDb(), h = createHandler({ db });
  const a = (await call(h, '1.1.1.1', { op: 'join', app: 'hold', name: 'a' })).body.id;
  const t0 = Date.now();
  const idle = await call(h, '1.1.1.1', { op: 'poll', id: a, sig: '', wait: 80 });
  assert.ok(Date.now() - t0 >= 70 && idle.body.peers.length === 0);
  const waiting = call(h, '1.1.1.1', { op: 'poll', id: a, sig: '', wait: 5000 });
  await new Promise(r => setTimeout(r, 30));
  const b = (await call(h, '1.1.1.1', { op: 'join', app: 'hold', name: 'b' })).body.id;
  const got = await waiting;
  assert.ok(Date.now() - t0 < 1000);
  assert.deepEqual(got.body.peers.map(p => p.id), [b]);
  const waiting2 = call(h, '1.1.1.1', { op: 'poll', id: a, sig: b, wait: 5000 });
  await new Promise(r => setTimeout(r, 30));
  await call(h, '1.1.1.1', { op: 'send', id: b, to: a, msg: { hi: 1 } });
  assert.deepEqual((await waiting2).body.msgs.map(m => m.msg), [{ hi: 1 }]);
  assert.equal(db.listeners.size, 0);
});

test('poll 保持開著時客戶端斷線：自己的文件馬上刪掉', async () => {
  const db = fakeDb(), h = createHandler({ db });
  const a = (await call(h, '1.1.1.1', { op: 'join', app: 'hold', name: 'a' })).body.id;
  let close;
  const res = { writableEnded: false, on(ev, f) { if (ev === 'close') close = f; }, set() {}, status() { return this; }, json() {} };
  const pending = h({ method: 'POST', ip: '1.1.1.1', body: { op: 'poll', id: a, sig: '', wait: 5000 } }, res);
  await new Promise(r => setTimeout(r, 30));
  close();
  await pending;
  assert.equal((await db.collection('nearby').doc(a).get()).exists, false);
  assert.equal(db.listeners.size, 0);
});

test('join 不能拿別人的代號覆寫他的文件；同一台裝置（dev 相同）可以沿用', async () => {
  const db = fakeDb(), h = createHandler({ db });
  const dev = 'a'.repeat(16);
  const a = (await call(h, '1.1.1.1', { op: 'join', app: 'hold', name: 'a', dev })).body.id;
  const evil = (await call(h, '1.1.1.1', { op: 'join', app: 'hold', name: 'evil', id: a, dev: 'b'.repeat(16) })).body.id;
  assert.notEqual(evil, a);
  assert.equal((await db.collection('nearby').doc(a).get()).data().name, 'a');
  const noDev = (await call(h, '1.1.1.1', { op: 'join', app: 'hold', name: 'evil2', id: a })).body.id;
  assert.notEqual(noDev, a);
  assert.equal((await call(h, '1.1.1.1', { op: 'join', app: 'hold', name: 'a2', id: a, dev })).body.id, a);
});

test('poll 保持開著時客戶端斷線：還沒送到的訊息不刪', async () => {
  const db = fakeDb(), h = createHandler({ db });
  const a = (await call(h, '1.1.1.1', { op: 'join', app: 'hold', name: 'a' })).body.id;
  const b = (await call(h, '1.1.1.1', { op: 'join', app: 'hold', name: 'b' })).body.id;
  let close;
  const res = { writableEnded: false, on(ev, f) { if (ev === 'close') close = f; }, set() {}, status() { return this; }, json() {} };
  const pending = h({ method: 'POST', ip: '1.1.1.1', body: { op: 'poll', id: a, sig: b, wait: 5000 } }, res);
  await new Promise(r => setTimeout(r, 30));
  close();
  await call(h, '1.1.1.1', { op: 'send', id: b, to: a, msg: { hi: 1 } });
  await pending;
  assert.equal((await db.collection('nearbyMsgs').where('to', '==', a).get()).size, 1);
});
