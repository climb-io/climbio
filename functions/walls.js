// 岩點貓公開牆：登記到找牆面的「索引」、收回、過期、刪除、列出自己發佈的牆、大家的線（HTTP 函式 walls）。
// 牆的照片和畫面在開放資料集（walls-dataset.js 寫進 Hugging Face 的 climbio/walls），這裡只登記哪面牆在哪個包的哪個檔：
// shared/{牆 id} 記 { name, gym, src: { project, path }, publishedAt, activeAt }（只有這個函式寫；規則不讓 App 寫）。
// 岩館的公開牆面清單（gym-walls.js）給 App 收牆。
// 岩點貓公開牆的線：一面牆一份文件 wallRoutes/{牆 id}：{ routes: { 路線 id: { uid, t, r: 路線 JSON 字串 } }, t }（只有這個函式寫）。
// 每個身分只能改、刪自己的線（put、withdraw），讀（routes，不用登入）一次回整面牆；牆沒有擁有者，下架只有維護者（unpublish）。
// 另外每天把 90 天沒有任何更新（shared/{牆 id}.activeAt：發佈、改線都會更新）的公開牆從找牆面拿掉（expire），資料集留著給研究。
// 岩館字串：`岩館#標籤#標籤`，第一段是岩館名稱（對得上岩館清單），後面是分區、教練等標籤；最多 30 個字（路線的 gym 規則上限）。

const { createHash } = require('node:crypto');
const { verifyRequest, KID } = require('./device-key');
const { clientIp } = require('./client-ip');
const PID = /^[0-9a-z]{8,40}$/, PROJECT = /^[0-9a-z]{16}$/, PATH = /^[0-9a-z]{8,40}\.json$/;
const RID = /^[0-9a-z]{1,40}$/;
const MAX_PIDS = 50, MAX_PUT = 100, MAX_ROUTE_CHARS = 24000, MAX_WALL_ROUTES = 1000, MAX_WALL_CHARS = 800000, DAILY_PUTS = 600, DAILY_PUBLISH = 60, EXPIRE_MS = 90 * 864e5;   // 90 天沒有任何更新（發佈、改線）的公開牆自動從找牆面拿掉（資料集的檔案留著給研究）
// 網站來源（內嵌頁 iframe 提交路線用，docs/embed.md）：https 的網站來源，或本機測試的 http://localhost、127.0.0.1；不收帶帳密、路徑的網址
const SITE = /^(https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?|http:\/\/(localhost|127\.0\.0\.1))(:\d{1,5})?$/;
const fail = (status, error) => Object.assign(new Error(error), { status });
const dayKey = ms => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);
const validGym = g => typeof g === 'string' && g.length >= 1 && g.length <= 30 && !/[\u0000-\u001f]/.test(g) && g.split('#').every(x => x.trim() === x && x.length);

function createHandler({ db, refreshGym, publishRoutes = async () => {}, appChecked = async () => true, isOwner = async () => false, now = Date.now, verify = verifyRequest }) {   // verify：驗裝置金鑰簽章（測試可換）
  // 沒有帳號、沒有擁有者（公開＝人人可編輯、可發佈，docs/proposals/open-versions.md）：發佈、通報靠 App Check 與網路來源的每日上限；
  // 寫自己的線（put、withdraw）靠裝置金鑰簽章（要 App Check，deviceKeys/{kid}.blocked 的金鑰拒絕）。回 { uid }
  const keyOf = req => `ip${createHash('sha256').update(clientIp(req)).digest('hex').slice(0, 16)}`;
  const writer = async (op, body, req) => {
    // 內嵌頁的 iframe 提交：身分是 iframe 所在的網站來源（瀏覽器給的 event.origin，iframe 帶上來），記成 o:<網站來源>；同一個岩館網站上所有人提交的路線都在這個身分下，
    // 這個網站可以更新、刪除自己名下所有路線，別的來源改不了。不是密碼學的強身分（腳本直接呼叫可以自己填來源），靠 App Check、每天上限、內容驗證擋濫用，
    // deviceKeys/site<指紋>.blocked 的來源拒絕。只開放 put（不開放 withdraw）
    if (body.site !== undefined) {
      if (op !== 'put') throw fail(400, 'bad site op');
      if (typeof body.site !== 'string' || !SITE.test(body.site)) throw fail(400, 'bad site');
      if (!(await appChecked(req))) throw fail(401, 'app check');
      const k = await db.collection('deviceKeys').doc(`site${createHash('sha256').update(body.site).digest('hex').slice(0, 28)}`).get();
      if (k.exists && k.get('blocked')) throw fail(403, 'blocked');
      return { uid: `o:${body.site}` };
    }
    if (!body.auth) throw fail(401, 'no key');
    if (!(await appChecked(req))) throw fail(401, 'app check');
    const kid = verify(op, body, now()), k = await db.collection('deviceKeys').doc(kid).get();
    if (k.exists && k.get('blocked')) throw fail(403, 'blocked');   // 黑名單：在 Firestore deviceKeys/{kid} 設 blocked: true 就擋掉
    return { uid: `k:${kid}` };
  };
  // 公開資料（Hugging Face 的 routes.json 和 index，hf-public.js）跟著寫：失敗不影響這次提交（Firestore 已經寫了），之後任何一次變動或維護者的 syncPublic 會補上
  const pub = async (pid) => { try { await publishRoutes(pid); } catch (e) { console.warn('公開資料沒寫進資料集', pid, e && e.message); } };
  const shared = pid => db.collection('shared').doc(pid);
  const wallRoutes = pid => db.collection('wallRoutes').doc(pid);
  // 把索引拿掉，連同這面牆所有人的線（讀的人看到「沒有公開」，收了這面牆的人就把它移除）
  const retire = async (pid, doc) => { await shared(pid).set({ name: doc.get('name') || '' }); await wallRoutes(pid).delete(); await refreshGym(pid); await pub(pid); };
  // 在交易裡改這面牆的線：fn(routes) 直接改傳進去的 map；回 { changed: 條數變了 }。沒有任何線了就刪掉文件
  const change = (pid, fn) => db.runTransaction(async (tx) => {
    const ref = wallRoutes(pid), snap = await tx.get(ref), routes = { ...((snap.exists && snap.get('routes')) || {}) }, before = Object.keys(routes).length;
    fn(routes);
    const n = Object.keys(routes).length;
    if (n) tx.set(ref, { routes, t: now() }); else if (snap.exists) tx.delete(ref);
    return { changed: n !== before };
  });
  // 入口要在已經發佈的包裡（先發佈專案，再登記牆）；包不記擁有者
  const checkSrc = async (src) => {
    if (!src || !PROJECT.test(src.project || '') || !PATH.test(src.path || '')) throw fail(400, 'bad src');
    const pkg = await db.collection('datasets').doc(src.project).get();   // 公開牆都在開放資料集（walls-dataset.js）
    if (!pkg.exists || !(pkg.get('files') || []).includes(src.path)) throw fail(400, 'not in project');
    return { project: src.project, path: src.path };   // 讀的人一律走 /p/（轉到開放資料集）
  };
  const ops = {
    async publish(body, req) {
      if (!(await appChecked(req))) throw fail(401, 'app check');
      if (body.source !== 'studio') throw fail(400, 'studio only');   // 找牆面的入口只登記 Studio 發佈的牆；岩點貓 App 不登記
      if (!PID.test(body.pid || '')) throw fail(400, 'bad pid');
      const name = String(body.name || '').trim();
      if (!name || name.length > 60) throw fail(400, 'bad name');
      if (body.gym !== '' && !validGym(body.gym)) throw fail(400, 'bad gym');   // 空的＝其他：登記了（別人收得到、看得到大家的線），但不列進找牆面
      if (!body.src || !PROJECT.test(body.src.project || '') || !PATH.test(body.src.path || '')) throw fail(400, 'bad src');
      const src = await checkSrc(body.src);
      const qref = db.collection('publishQuota').doc(`${keyOf(req)}_${dayKey(now())}`), q = await qref.get();
      if ((q.exists ? q.get('n') : 0) >= DAILY_PUBLISH) throw fail(429, 'daily limit');
      await qref.set({ n: (q.exists ? q.get('n') : 0) + 1, at: now() });
      await shared(body.pid).set({ name, gym: body.gym, src, publishedAt: now(), activeAt: now() });
      await refreshGym(body.pid);   // 找牆面的索引跟著更新
      await pub(body.pid);
      return { pid: body.pid };
    },
    // 拿掉自己在這面牆的線（岩點貓把牆改成私人、或刪掉公開的牆）。可重複呼叫
    async withdraw(body, req) {
      const u = await writer('withdraw', body, req);
      if (!PID.test(body.pid || '')) throw fail(400, 'bad pid');
      if ((await change(body.pid, (routes) => { for (const [k, x] of Object.entries(routes)) if (x.uid === u.uid) delete routes[k]; })).changed) { await refreshGym(body.pid); await pub(body.pid); }   // 只拿掉自己的線；整面牆公開了就收不回
      return { ok: true };
    },
    // 傳自己在這面牆的線：routes: [{ id, r: 路線 JSON 字串 }] 新增或更新，del: [路線 id] 刪除；只能動自己的線（別人的回 taken）。牆要先有人發佈
    async put(body, req) {
      const u = await writer('put', body, req);
      if (!PID.test(body.pid || '')) throw fail(400, 'bad pid');
      const set = body.routes === undefined ? [] : body.routes, del = body.del === undefined ? [] : body.del;
      if (!Array.isArray(set) || !Array.isArray(del) || set.length + del.length === 0 || set.length + del.length > MAX_PUT || !del.every(id => RID.test(id || ''))) throw fail(400, 'bad routes');
      const add = new Map();
      for (const x of set) {
        let o = null;
        if (x && RID.test(x.id || '') && typeof x.r === 'string' && x.r.length <= MAX_ROUTE_CHARS) try { o = JSON.parse(x.r); } catch (e) { o = null; }
        // 一條線存成圖層的片段 { nodes, marks }（3D 牆的線另帶 e；App 的 fragmentOf；site-data、route-page、dataset-export 都這樣讀）：要有這條線自己的 route 節點
        if (!o || !Array.isArray(o.nodes) || !Array.isArray(o.marks) || !o.nodes.some(n => n && n.id === x.id && n.type === 'route')) throw fail(400, 'bad route');
        // 3D 牆的線多一個 e：這條線用到的岩點的修點（{ 岩點 id: { c, p } }，收的人套到模型上）；只收物件，內容由收的人的 App 檢查
        if (o.e !== undefined && (!o.e || typeof o.e !== 'object' || Array.isArray(o.e) || Object.keys(o.e).length > 200)) throw fail(400, 'bad route');
        add.set(x.id, x.r);
      }
      const doc = await shared(body.pid).get();
      if (!doc.exists || !doc.get('src')) throw fail(404, 'no wall');
      const qref = db.collection('putQuota').doc(`${createHash('sha256').update(u.uid).digest('hex').slice(0, 28)}_${dayKey(now())}`), q = await qref.get(), used = q.exists ? q.get('n') : 0;
      if (used >= DAILY_PUTS) throw fail(429, 'daily limit');   // 一個帳號（或金鑰）一天的更新次數
      await qref.set({ n: used + 1, at: now() });
      await shared(body.pid).update({ activeAt: now() });   // 有人更新路線就延後下架
      const results = {};
      const out = await change(body.pid, (routes) => {
        for (const [rid, r] of add) {
          const cur = routes[rid];
          if (cur && cur.uid !== u.uid) { results[rid] = 'taken'; continue; }
          routes[rid] = { uid: u.uid, t: now(), r }; results[rid] = 'ok';
        }
        for (const rid of del) {
          const cur = routes[rid];
          results[rid] = cur && cur.uid !== u.uid ? 'taken' : 'ok';
          if (cur && cur.uid === u.uid) delete routes[rid];
        }
        const all = Object.values(routes);
        if (all.length > MAX_WALL_ROUTES || all.reduce((s, x) => s + x.r.length, 0) > MAX_WALL_CHARS) throw fail(413, 'wall full');
      });
      if (out.changed) await refreshGym(body.pid);   // 條數變了才重算找牆面（只改線不用）
      await pub(body.pid);   // 路線新增、更新、刪除都馬上寫進資料集（旁邊的人重新整理就看得到）
      return { ok: true, results };
    },
    // 手動下架：只有維護者（X-Studio-Key）；岩館想收回就聯絡維護者。跟過期一樣拿掉找牆面的入口和所有人的線，
    // 開放資料集裡已經公開的檔案留著（授權已經給出去）。重新用 Studio 發佈同一個牆 id 就回來。可重複呼叫
    // 維護者：把所有公開牆的現況補寫進資料集（routes.json 和 index），一面牆一個 commit；回寫了幾面
    async syncPublic(body, req) {
      if (!(await isOwner(req))) throw fail(401, 'maintainer only');
      let n = 0;
      for (const d of (await db.collection('shared').get()).docs) if (d.get('src')) { await publishRoutes(d.id); n++; }
      return { n };
    },
    async unpublish(body, req) {
      if (!PID.test(body.pid || '')) throw fail(400, 'bad pid');
      if (!(await isOwner(req))) throw fail(401, 'maintainer only');
      const doc = await shared(body.pid).get();
      if (!doc.exists || !doc.get('src')) return { removed: false };
      await retire(body.pid, doc);
      return { removed: true };
    },
    // 這面牆所有人的線（不用登入；帶自己的裝置金鑰才標 mine）：{ published, src: { project, path }, ver, routes: [{ rid, mine, r, t }] }，新的在前；
    // 給 pids（最多 50 面）就一次回 { walls: { 牆 id: 同上 } }。published 是 false＝這面牆沒有公開（下架、過期、包不見了）
    async routes(body, req) {
      const many = Array.isArray(body.pids), pids = many ? body.pids : [body.pid];
      if (!pids.length || pids.length > MAX_PIDS || !pids.every(p => PID.test(p || ''))) throw fail(400, 'bad pid');
      const kid = KID.test(body.kid || '') ? `k:${body.kid}` : '';   // 不登入的岩友：只標哪些線是這把金鑰的（不給寫入權，所以不用簽章）
      const one = async (pid) => {
        const doc = await shared(pid).get();
        if (!doc.exists || !doc.get('src')) return { published: false, routes: [] };
        const w = await wallRoutes(pid).get(), src = doc.get('src'), ds = await db.collection('datasets').doc(src.project).get();
        return { published: true, src: { project: src.project, path: src.path }, ver: ds.exists ? ds.get('version') || 0 : 0,   // src、ver：牆的畫面在哪、現在第幾版（讀的人看版本變了才重讀岩點）
          routes: Object.entries((w.exists && w.get('routes')) || {}).map(([rid, x]) => ({ rid, mine: !!kid && x.uid === kid, r: x.r, t: x.t || 0 })).sort((a, b) => b.t - a.t) };
      };
      const list = await Promise.all(pids.map(one));
      return many ? { walls: Object.fromEntries(pids.map((p, i) => [p, list[i]])) } : list[0];
    },
    // App 收牆讀不到（/p/ 回 404）：通報。入口檔還在開放資料集的包裡就不動，不在（包下架了、換掉了）才把索引拿掉
    async report(body, req) {
      if (!(await appChecked(req))) throw fail(401, 'app check');
      if (!PID.test(body.pid || '')) throw fail(400, 'bad pid');
      const doc = await shared(body.pid).get();
      if (!doc.exists || !doc.get('src')) return { removed: false };
      const { project, path } = doc.get('src'), ds = await db.collection('datasets').doc(project).get();
      if (ds.exists && (ds.get('files') || []).includes(path)) return { removed: false, checked: true };   // 開放資料集的牆不會消失（Climbio 不因發佈者要求刪除），不用查
      await retire(body.pid, doc);
      return { removed: true };
    },
  };
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    try {
      const op = ops[req.body && req.body.op];
      if (!op) throw fail(400, 'bad op');
      res.json(await op(req.body, req));
    } catch (e) {
      if (!e.status) console.error('walls', e);
      res.status(e.status || 500).json({ error: e.status ? e.message : 'server error', ...(e.extra || {}) });
    }
  };
}

// 每天把 90 天沒有任何更新（activeAt：發佈、改線都會更新）的公開牆從找牆面拿掉：岩館換線之後，舊的牆對使用者沒意義；上傳者只要更新就延後。
// 只拿掉入口與線（跟手動下架一樣），資料集（照片、岩點、路線的匯出）留著給研究
async function expire({ db, refreshGym, publishRoutes = async () => {}, now = Date.now }) {
  const snap = await db.collection('shared').where('activeAt', '<', now() - EXPIRE_MS).limit(200).get();
  for (const d of snap.docs) if (d.get('src')) { await db.collection('shared').doc(d.id).set({ name: d.get('name') || '' }); await db.collection('wallRoutes').doc(d.id).delete(); await refreshGym(d.id); await publishRoutes(d.id).catch((e) => console.warn('公開資料沒寫進資料集', d.id, e && e.message)); }
  return snap.docs.length;
}

module.exports = { createHandler, expire, validGym, EXPIRE_MS };
