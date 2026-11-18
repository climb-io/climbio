// 附近交換（岩點貓、紅點貓）：同一個網路（同一個對外 IP）的手機互相看得到，只幫忙找人和轉送連線訊息（WebRTC 的 offer、answer、ICE）。
// 資料本身走手機之間的 WebRTC，不經過這裡，也不存起來。
// join：登記自己（名稱、哪個 App），回自己的代號和附近的人；poll：續命，收訊息、看附近的人（帶 wait 毫秒就保持開著，有人上線／離開或有訊息才回，最長 HOLD_MAX）；send：傳一則訊息給附近的某個人；leave：離開。
// 房間是對外 IP 的雜湊（IPv6 取前 64 位元）；配對過的裝置另外帶「配對房間」（密鑰的雜湊，只有持有密鑰的人猜得到）：同一個區網但一台走 IPv4、一台走 IPv6 時，IP 房間不同看不到對方，配對房間仍然找得到；只用 Admin SDK 存取 nearby/、nearbyMsgs/，不開放 Firestore 規則。
// poll 保持開著的期間，伺服器用 Firestore 監聽房間和訊息，沒變動不讀不寫；客戶端中途斷線（關頁面）就立刻刪掉自己的文件。
// 超過 TTL 沒有 poll 的人當作離開，由 cleanNearby 每天掃掉。
const { createHash, randomBytes } = require('node:crypto');
const ID = /^[0-9a-z]{12}$/;
const APPS = ['hold', 'redpoint'];
const HOLD_MAX = 55e3, TTL = HOLD_MAX + 15e3, MAX_PEERS = 30, MAX_MSG = 16 * 1024, MAX_PENDING = 60;
const fail = (status, error) => Object.assign(new Error(error), { status });
const newId = () => [...randomBytes(12)].map(x => (x % 36).toString(36)).join('');
const roomOf = ip => createHash('sha256').update(String(ip || '').includes(':') ? String(ip).split(':').slice(0, 4).join(':') : String(ip || '')).digest('hex').slice(0, 24);
const PAIR_ROOM = /^[0-9a-f]{24}$/, DEV = /^[0-9a-f]{16,32}$/;
const pairRoomsOf = (v) => (Array.isArray(v) ? [...new Set(v.filter(x => PAIR_ROOM.test(x || '')))].slice(0, 8) : []);
const clean = s => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 30);

function createHandler({ db, now = Date.now }) {
  const peers = db.collection('nearby'), msgs = db.collection('nearbyMsgs');
  const me = async (id, room) => {
    if (!ID.test(id || '')) throw fail(400, 'bad id');
    const snap = await peers.doc(id).get();
    if (!snap.exists || snap.data().room !== room) throw fail(410, 'gone');
    return snap.data();
  };
  // 附近的人：同一個 IP 房間的，加上跟我有同一個配對房間的（配對過的裝置，不管 IP 房間是不是一樣）
  const around = async (room, id, app, pairRooms = []) => {
    const mine = (await peers.doc(id).get()).data()?.dev || '';
    const seen = new Map(), ok = d => d.id !== id && d.data().app === app && d.data().seen > now() - TTL && !(mine && d.data().dev === mine);   // 同一台裝置的分身也不算「附近的人」
    for (const d of (await peers.where('room', '==', room).get()).docs) if (ok(d)) seen.set(d.id, { id: d.id, name: d.data().name });
    for (const pr of pairRooms) for (const d of (await peers.where('pairRooms', 'array-contains', pr).get()).docs) if (ok(d)) {
      const e = seen.get(d.id) || { id: d.id, name: d.data().name };
      seen.set(d.id, { ...e, via: [...(e.via || []), pr] });   // via：是哪個配對房間找到的（配對的裝置，客戶端據此知道是哪一台）
    }
    return [...seen.values()].slice(0, MAX_PEERS);
  };
  const shares = (a, b) => (a.pairRooms || []).some(x => (b.pairRooms || []).includes(x));
  const ops = {
    async join(body, room) {
      if (!APPS.includes(body.app)) throw fail(400, 'bad app');
      const name = clean(body.name);
      if (!name) throw fail(400, 'bad name');
      const pairRooms = pairRoomsOf(body.pairRooms);
      const dev = DEV.test(body.dev || '') ? body.dev : '';
      // 代號只有原本那台裝置（dev 相同）才能沿用；代號在房間清單裡別人看得到，不能讓別人帶著它來覆寫收件匣
      let id = newId();
      if (ID.test(body.id || '')) {
        const old = await peers.doc(body.id).get();
        if (!old.exists || (dev && old.data().dev === dev)) id = body.id;
      }
      if (dev) for (const d of (await peers.where('dev', '==', dev).get()).docs) if (d.id !== id) await d.ref.delete();   // 同一台裝置重新打開／重新載入：上一個分身不用等過期，馬上拿掉（不然「傳給別人」會看到自己）
      await peers.doc(id).set({ room, pairRooms, app: body.app, name, dev, seen: now() });
      return { id, room: room.slice(0, 4), peers: await around(room, id, body.app, pairRooms) };   // room：網路代號（診斷用：兩支手機的代號不一樣就是不同網路，看不到對方）
    },
    // wait：最長保持開著幾毫秒（0＝馬上回）；sig：客戶端手上的附近的人（代號串），跟現在不同或有訊息就馬上回
    async poll(body, room, ctx = {}) {
      const self = await me(body.id, room);
      await peers.doc(body.id).update({ seen: now() });   // 每個人每輪都會寫一次 seen；下面的監聽忽略只有 seen 變動，避免同房的人互相喚醒（O(N²) 讀取）
      const pairRooms = self.pairRooms || [], deadline = now() + Math.min(Math.max(+body.wait || 0, 0), HOLD_MAX);
      const sigOf = list => list.map(p => p.id).sort().join(',');
      const queries = [msgs.where('to', '==', body.id), peers.where('room', '==', room), ...pairRooms.map(pr => peers.where('pairRooms', 'array-contains', pr))];
      let dirty = false, wake = () => {};
      const sigOfDoc = d => { const v = d.data(); return JSON.stringify([v.room, v.app, v.name, v.dev, v.pairRooms]); };
      const unsubs = await Promise.all(queries.map((q, i) => new Promise(ok => {
        let first = true;
        const known = new Map();   // 對方文件的內容（不含 seen）：只有 seen 變了不算有人上線／離開
        const stop = q.onSnapshot(snap => {
          if (first) { first = false; if (i) (snap.docs || []).forEach(d => known.set(d.id, sigOfDoc(d))); ok(stop); return; }
          let change = !i || !snap.docChanges || !snap.docs;   // 訊息的監聽、或拿不到變動明細：保守當作有變
          if (!change) for (const c of snap.docChanges()) {
            const sg = c.type === 'removed' ? null : sigOfDoc(c.doc);
            if (known.get(c.doc.id) !== sg) change = true;
            if (sg === null) known.delete(c.doc.id); else known.set(c.doc.id, sg);
          }
          if (change) { dirty = true; wake(); }
        }, () => { first = false; dirty = true; wake(); ok(() => {}); });
      })));
      try {
        for (;;) {
          dirty = false;
          const snap = await msgs.where('to', '==', body.id).get();
          const list = snap.docs.map(d => d.data()).sort((a, b) => a.t - b.t).map(({ from, msg, t }) => ({ from, msg, t }));
          const nearbyNow = await around(room, body.id, self.app, pairRooms);
          if (list.length || sigOf(nearbyNow) !== body.sig || ctx.aborted || now() >= deadline) {
            if (!ctx.aborted) await Promise.all(snap.docs.map(d => d.ref.delete()));   // 客戶端已斷線就不刪：訊息留著，等它重連再收（過期由 cleanNearby 掃）
            return { peers: nearbyNow, msgs: list };
          }
          if (!dirty) await new Promise(ok => { const t = setTimeout(ok, Math.max(deadline - now(), 0)); wake = () => { clearTimeout(t); ok(); }; if (ctx.closed) ctx.closed.then(() => { clearTimeout(t); ok(); }); });
        }
      } finally {
        unsubs.forEach(u => u());
        if (ctx.aborted) await peers.doc(body.id).delete().catch(() => {});   // 客戶端中途斷線（關頁面）：不用等過期
      }
    },
    async send(body, room) {
      const self = await me(body.id, room);
      if (!ID.test(body.to || '')) throw fail(400, 'bad id');
      const toSnap = await peers.doc(body.to).get(), to = toSnap.exists ? toSnap.data() : null;
      if (!to || to.app !== self.app || to.seen < now() - TTL || !(to.room === self.room || shares(self, to))) throw fail(404, 'peer gone');   // 同一個 IP 房間，或有同一個配對房間
      const text = JSON.stringify(body.msg ?? null);
      if (text.length > MAX_MSG) throw fail(413, 'too large');
      if ((await msgs.where('to', '==', body.to).get()).size >= MAX_PENDING) throw fail(429, 'busy');
      await msgs.doc(`${now()}-${newId()}`).set({ to: body.to, from: body.id, t: now(), msg: JSON.parse(text) });
      return { ok: true };
    },
    async leave(body, room) {
      await me(body.id, room);
      await peers.doc(body.id).delete();
      return { ok: true };
    },
  };
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    try {
      const op = ops[req.body && req.body.op];
      if (!op) throw fail(400, 'bad op');
      const ctx = { aborted: false };
      ctx.closed = new Promise(ok => { if (res.on) res.on('close', () => { if (!res.writableEnded) ctx.aborted = true; ok(); }); });
      res.json(await op(req.body, roomOf(req.ip), ctx));
    } catch (e) {
      if (!e.status) console.error('nearby', e);
      res.status(e.status || 500).json({ error: e.status ? e.message : 'server error' });
    }
  };
}

async function cleanNearby(db, nowMs) {
  for (const [name, field] of [['nearby', 'seen'], ['nearbyMsgs', 't']]) {
    const snap = await db.collection(name).where(field, '<', nowMs - 60e3).get();
    await Promise.all(snap.docs.map(d => d.ref.delete()));
  }
}

module.exports = { createHandler, cleanNearby, roomOf, TTL, HOLD_MAX };
