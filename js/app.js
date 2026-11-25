// Climbio 共用核心：常數、語言、儲存（IndexedDB）、復原。
// 依序載入（app → home → profile → add-wall → edit → wall → sync → draw → export → mobile → tour → main），共用同一個全域範圍；載入當下只能用到前面檔案宣告的東西，
// 事件處理、計時器等之後才執行的程式不受限制。啟動與事件綁定放在最後的 main.js。
// English: Shared core: constants, i18n, storage (IndexedDB), undo. Page scripts load in index.html order and share one global scope.
'use strict';
  const $ = (id) => document.getElementById(id);
  const cv = $('cv'), ctx = cv.getContext('2d');
  const { MAX_START, startCount } = RouteKit;   // 起攀最多 2 個，滿了自動切到手點
  // 路線要有起攀和完攀才能按「完成」
  const routeReady = (r) => !!r && Object.values(r.holds).includes('s') && Object.values(r.holds).includes('t');
  const TYPE_COLOR = RouteKit.THEME.colors;
  // 岩點階段的分析在 holdkit/（AGPL-3.0）：
  // 偵測框 → 外框、顏色名稱。岩點資料包的格式見 holdkit 的 SPEC.md
  const { bbox, centroid, tracePoly, simplifyPoly } = HoldKit;
  // 難度系統：v＝VB、V0–V12；font＝法國 Fontainebleau（3–8C）；dan＝日本的段級（10級…1級、初段…六段）。每條路線存原本的文字、記住自己用的那套，不換算（換算有誤差）
  const GRADE_SYS = RouteKit.GRADE_SYS;   // 三套難度系統的清單在 kit（routekit/ui.js），內嵌頁共用
  const GRADES = GRADE_SYS.v;
  // 排序、統計、短句判斷難易用的同一把尺（V 級的位置；段級照常見的對照，各岩館不太一樣，排序夠用）
  const GRADE_RANK = { ...Object.fromEntries(GRADE_SYS.v.map((g, i) => [g, i])), '10級': -0.6, '9級': -0.4, '8級': -0.2, '7級': 0, '6級': 1, '5級': 2, '4級': 3,
    '3級': 4, '2級': 5, '1級': 6, '初段': 7, '二段': 8.5, '三段': 10, '四段': 11.5, '五段': 13, '六段': 14,
    // Fontainebleau 照常見的 V 級對照（3≈VB、4≈V0、6A≈V2、7A≈V6、8A≈V10）
    '3': 0, '4': 1, '4+': 1.5, '5': 2, '5+': 2.5, '6A': 3, '6A+': 4, '6B': 4.5, '6B+': 5, '6C': 5.5, '6C+': 6, '7A': 6.5, '7A+': 7, '7B': 8, '7B+': 9, '7C': 9.5, '7C+': 10,
    '8A': 11, '8A+': 12, '8B': 13, '8B+': 14, '8C': 15 };
  const sysOf = (g) => GRADE_SYS.dan.includes(g) ? 'dan' : GRADE_SYS.font.includes(g) ? 'font' : 'v';
  // 畫面上的難度：段級改用 M PLUS 1 Black 的正體（.dan；窄體斜字沒有漢字）
  const isDan = (g) => sysOf(g) === 'dan';
  const setGrade = (el, g) => { el.textContent = g; el.classList.toggle('dan', isDan(g)); return el; };
  // 新路線用哪一套（記在這台；沒選過的話日文用段級、法文用 Fontainebleau、其他用 V 級）
  const GRADE_SYS_KEY = 'climbio.gradeSys';
  const gradeSys = () => { const v = lsGet(GRADE_SYS_KEY, null); return GRADE_SYS[v] ? v : lang === 'ja' ? 'dan' : lang === 'fr' ? 'font' : 'v'; };
  const GRADE_SYS_LABEL = { v: 'gradeV', font: 'gradeFont', dan: 'gradeDan' };
  const DEFAULT_GRADE = { v: 'V3', font: '6A+', dan: '3級' };
  const MAX_SIDE = 3072;   // 照片存的長邊：小岩點放大到最大也要看得清楚（偵測照樣送 2048）

  // ---------- 語言：繁中、簡中、英、日、法、韓、西、德，只跟瀏覽器語言，沒有手動選擇 ----------
  // 語言包的載入在 AppKit.i18n（js/boot.js 開頭就決定好語言）；lang 是目前的語言
  let lang = AppKit.i18n.lang;
  // 沒有的 key 回傳 key 本身（看得出漏翻）
  const t = AppKit.i18n.t;
  self.climbioT = t;   // samrefine.js、appkit/share-tools.js、backend/ 的訊息也用語言包
  // 這個站的後端（site.js）有沒有這個功能：share 分享路線連結、gyms 找牆面與公開牆的預設岩點、account 登入與同步、stats 完攀與分享統計。沒有的功能不顯示、不連線
  const can = (cap) => !!Backend.caps[cap];
  function applyLang() {
    AppKit.i18n.apply();
    if (self.climbioRefreshText) self.climbioRefreshText();
    document.title = t('app') + (document.documentElement.classList.contains('env-dev') ? ' · ' + t('envDev') : '');
    // 隱私權政策、服務條款是中英同一頁：非中文直接跳到英文那段
    for (const a of document.querySelectorAll('#hmFoot a[href*="privacy.html"], #hmFoot a[href*="terms.html"]')) a.href = a.getAttribute('href').replace(/#en$/, '') + (lang === 'zh' || lang === 'zh-CN' ? '' : '#en');
  }

  const state = {
    wall: null,          // 目前的牆（IndexedDB 紀錄）：{ id, name, createdAt, updatedAt, w, h, thumb, holds, routes, nextId }
    img: null, w: 0, h: 0, imgOf: '',   // imgOf：3D 牆的照片是哪一版快照（w.m3d）
    gray: null, ana: null,
    routeId: null, mode: 'route', selected: null, showAll: false,
    draft: null, cursor: null,   // 正在畫的岩點（影像座標的點）與滑鼠位置
    current: null,               // 路線：最後點過的岩點（D 鍵拿掉它）
    routeView: true,             // 路線：true＝看路線圖、false＝編輯這一條
  };

  // ---------- 手機端儲存（IndexedDB）----------
  // 一面牆分開存，改什麼就只寫那一筆：walls＝牆面（牆名、尺寸、縮圖、排序、路線順序 ro、同步和分享的狀態…）；
  // holds＝我的岩點檔 holds、原始岩點檔 base；routes＝一條路線一筆（鍵是［牆 id, 路線 id］）；images＝照片；
  // thumbs＝路線小圖（鍵是［牆 id, 路線 id］，值 { sig, blob }，只在這台、不同步；定完線就存，路線、牆、照片刪了或換了一起清）。
  // 讀出來組成一個牆面物件（w.holds、w.base、w.routes 照舊）。每份物件記著自己讀出、寫過的樣子（savedOf），
  // 存檔只寫這份物件自己改過的記錄、刪掉自己拿掉的路線：手上那份比較舊，也不會蓋掉別的地方剛存的修改
  const STORES = ['walls', 'holds', 'routes', 'images', 'thumbs'];
  const db = AppKit.idb.opener({
    name: 'climbio-db', version: 4,
    upgrade(d, oldVersion) {
      if (oldVersion < 3) {   // 3 以前的格式：舊資料直接清掉（不做向後相容）
        for (const name of [...d.objectStoreNames]) d.deleteObjectStore(name);
        for (const name of ['walls', 'holds']) d.createObjectStore(name, { keyPath: 'id' });
        d.createObjectStore('routes', { keyPath: ['wall', 'id'] }).createIndex('wall', 'wall');
        d.createObjectStore('images');
      }
      d.createObjectStore('thumbs');   // 4 新增：只加一個儲存區，牆、路線、照片原封不動
    },
    ready: (d) => moveOldDb(d).catch(e => console.warn('舊的牆沒搬完，下次打開再搬', e)),
  });
  // 舊名 spraywall-db 的牆（js/rename.js 的一部分）：新的資料庫還是空的才整份搬過來，在同一個交易裡寫完才刪掉舊的
  async function moveOldDb(d) {
    if (!indexedDB.databases || !(await indexedDB.databases()).some(x => x.name === 'spraywall-db')) return;
    const req = (r) => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
    const empty = (await req(d.transaction('walls').objectStore('walls').count())) === 0;
    const old = await req(indexedDB.open('spraywall-db'));
    if (empty) {
      const stores = STORES.filter(s => old.objectStoreNames.contains(s)), rows = {};
      if (stores.length) {
        const t = old.transaction(stores);   // 所有讀取一次發出去，交易不會中途結束
        await Promise.all(stores.map(async s => {
          const st = t.objectStore(s), [keys, values] = await Promise.all([req(st.getAllKeys()), req(st.getAll())]);
          rows[s] = { inline: st.keyPath !== null, keys, values };
        }));
        await new Promise((ok, no) => {
          const w = d.transaction(stores, 'readwrite');
          for (const s of stores) { const st = w.objectStore(s), r = rows[s]; r.values.forEach((v, i) => (r.inline ? st.put(v) : st.put(v, r.keys[i]))); }
          w.oncomplete = ok; w.onerror = () => no(w.error); w.onabort = () => no(w.error || new Error('transaction aborted'));
        });
      }
    }
    old.close();
    if (empty) indexedDB.deleteDatabase('spraywall-db');
  }
  async function tx(stores, mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(stores, mode);
      const r = fn(...[].concat(stores).map(s => t.objectStore(s)));
      t.oncomplete = () => resolve(r && 'result' in r ? r.result : r);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('transaction aborted'));   // 空間不足等會走 abort
    });
  }
  // 牆面物件 ↔ 各筆記錄
  const hash53 = (str) => AppKit.files.hash53(str).toString(36);   // 內容有沒有變的指紋
  const storeSig = (r) => hash53(JSON.stringify(r));
  function splitWall(w) {
    const { holds, base, routes: all, ...meta } = w, routes = (all || []).filter(r => !r.xfer);   // xfer：從同一面牆別張照片投影過來的路線，只在畫面上，不存
    meta.ro = routes.map(r => r.id);
    meta.sum = routeSum(routes);   // 首頁卡片只要條數、完攀數、最高完攀難度：存在牆面清單裡，首頁不用讀每條路線
    // 3D 牆轉過角度時畫面上的外框是新角度的，存正面的（見 js/wall3d.js）
    return { meta, hold: { id: w.id, holds: (w.m3d && W3D.frontHolds(w)) || holds || [], base: base || null }, routes };
  }
  const sigsOf = (x) => ({ meta: hash53(JSON.stringify(x.meta)), hold: hash53(JSON.stringify(x.hold)), routes: new Map(x.routes.map(r => [r.id, storeSig(r)])) });
  const savedOf = new WeakMap();
  // 一面牆的路線統計：條數、完攀數、完攀過的最高難度（首頁卡片用）
  const routeSum = (routes) => {
    const sent = routes.filter(isSent);
    return { n: routes.length, send: sent.length, best: sent.map(r => r.grade).sort((a, b) => gradeRank(b) - gradeRank(a))[0] || null };
  };
  const sumOf = (w) => w.lite ? w.sum : routeSum(w.routes);   // lite：首頁只讀牆面清單的牆，沒有路線
  function joinWall(meta, hold, routes) {
    const at = new Map((meta.ro || []).map((id, i) => [id, i])), { ro, ...rest } = meta;
    const w = { ...rest, holds: hold ? hold.holds : [], base: hold && hold.base ? hold.base : { holds: [] },
      routes: routes.map(({ wall, ...r }) => r).sort((a, b) => (at.get(a.id) ?? 1e9) - (at.get(b.id) ?? 1e9) || (a.t || 0) - (b.t || 0)) };
    savedOf.set(w, sigsOf(splitWall(w)));
    return w;
  }
  // 內容指紋（公開牆分享用，見 js/sync.js）：牆面檔（牆名、岩館、路線、刪掉的路線、照片版本）和我的岩點檔各一個。
  // 存檔時算好記在 w.sig，判斷還沒同步只要讀牆面清單，不用把每面牆的岩點、路線讀出來重算
  const holdsSig = (w) => hash53(JSON.stringify(w.holds));
  const wallSig = (w) => hash53(JSON.stringify([w.name, w.gym || '', w.routes.filter(r => !r.xfer), (w.deleted && w.deleted.routes) || {}, ...(w.pv ? [w.pv] : []), ...(w.grp ? [w.grp] : []), ...(w.subs ? [Object.keys(w.subs).sort()] : []), ...(w.share ? [`share:${w.share}`] : [])]));
  // 寫一面牆：這份物件第一次寫（新的牆）就全部寫；不然只寫跟它上次讀出、寫過不一樣的記錄
  async function writeWall(w, photo) {
    settleWall(w);
    w.sig = { h: wallSig(w), hh: holdsSig(w) };
    const x = splitWall(w), now = sigsOf(x), was = savedOf.get(w);
    const packed = photo && await AppKit.idb.packBlob(photo);   // 照片存成 ArrayBuffer（iPhone 大 Blob 會存失敗，見 appkit/idb.js）；先讀好再開交易
    return tx(STORES, 'readwrite', (ws, hs, rs, is, ts) => {
      const write = () => {
        if (!was || was.meta !== now.meta) ws.put(x.meta);
        if (!was || was.hold !== now.hold) hs.put(x.hold);
        for (const r of x.routes) if (!was || was.routes.get(r.id) !== now.routes.get(r.id)) rs.put({ ...r, wall: w.id });
        if (was) for (const rid of was.routes.keys()) if (!now.routes.has(rid)) { rs.delete([w.id, rid]); ts.delete([w.id, rid]); }   // 這份自己拿掉的路線
        if (photo) is.put(packed, w.id);
      };
      if (!was) return write();
      // 讀出來之後被刪掉的牆（例如背景補縮圖時刪了）不寫：只寫有變的記錄會讓它復活成沒有路線的半面牆
      const q = ws.count(w.id);
      q.onsuccess = () => { if (q.result) write(); };
    }).then((r) => {
      savedOf.set(w, now);
      return r;
    });
  }
  async function readWalls(id) {
    const q = await tx(['walls', 'holds', 'routes'], 'readonly', (ws, hs, rs) => id === undefined
      ? { metas: ws.getAll(), holds: hs.getAll(), routes: rs.getAll() }
      : { metas: ws.getAll(id), holds: hs.getAll(id), routes: rs.index('wall').getAll(id) });
    const holds = new Map(q.holds.result.map(x => [x.id, x])), routes = new Map();
    for (const r of q.routes.result) routes.set(r.wall, [...(routes.get(r.wall) || []), r]);
    return q.metas.result.map(m => joinWall(m, holds.get(m.id), routes.get(m.id) || []));
  }
  const listWalls = () => readWalls();
  const listMetas = () => tx('walls', 'readonly', s => s.getAll());   // 只有牆面清單（不含岩點、路線）
  // 首頁用：只讀牆面清單，路線、岩點留空（lite），條數與完攀統計看 w.sum（見 sumOf）。還沒存過統計的牆讀一次完整的並補存
  async function listHome() {
    return Promise.all((await listMetas()).map(async (m) => {
      if (m.sum) return { ...m, holds: [], routes: [], lite: 1 };
      const w = await getWall(m.id);
      if (w) tx('walls', 'readwrite', s => s.put({ ...m, sum: routeSum(w.routes) })).catch(() => {});
      return w;
    })).then(ws => ws.filter(Boolean));
  }
  const getRoute = (wallId, rid) => tx('routes', 'readonly', s => s.get([wallId, rid])).then(r => r && (({ wall, ...x }) => x)(r));
  const getWall = (id) => readWalls(id).then(ws => ws[0]);
  const getImage = async (id) => AppKit.idb.unpackBlob(await tx('images', 'readonly', s => s.get(id)));
  // 存檔只存在這台，手動備份才會建立快照。存之前整理原始岩點檔和路線外框（settleWall）
  // 定線中、還沒有起攀和完攀的那條線不寫進本機（離開 app 再回來，牆面頁不會多一張未完成的小卡）：新線略過，原本就有的線存進來編輯前的樣子
  function putWall(w) {
    const r = state.wall === w && !$('editor').hidden && (state.mode === 'route' || state.holdSub) && !state.routeView ? route() : null;
    if (!r || routeReady(r)) return writeWall(w);
    let before = null;
    try { before = (JSON.parse(editStart).routes || []).find(x => x.id === r.id) || null; } catch {}
    if (!routeReady(before)) before = null;
    const all = w.routes;
    w.routes = all.flatMap(x => x !== r ? [x] : before ? [before] : []);   // 同步寫完存檔用的內容就換回來
    try { return writeWall(w); } finally { w.routes = all; }
  }
  // 這台有沒有牆記在 climbio.hasWalls：index.html 一開頭就要知道第一次打開要不要直接是開場畫面（IndexedDB 讀不了那麼早）
  const putNewWall = (w, blob) => { lsSet('climbio.hasWalls', true); return writeWall(w, blob); };
  // 路線小圖（thumbs）：sig＝這條路線的岩點與外框，變了就當沒存；照片換了，這面牆的小圖全清
  const thumbSigOf = (w, r) => JSON.stringify(w.m3d ? [w.m3d, holdsOf(r, w)] : RouteKit.routeHolds(r, w.holds));   // 3D 牆：畫的是模型重投的外框（holdsOf），快照換了也要重畫
  const thumbRange = (id) => IDBKeyRange.bound([id], [id, []]);   // 陣列比字串大：涵蓋這面牆所有路線
  const putThumb = (wid, rid, sig, blob) => tx('thumbs', 'readwrite', s => s.put({ sig, blob }, [wid, rid]));
  const canvasBlob = (c) => new Promise(res => c.toBlob(res, 'image/jpeg', AppKit.photo.QUALITY.thumb));
  const putImage = async (id, blob) => { const packed = await AppKit.idb.packBlob(blob); return tx(['images', 'thumbs'], 'readwrite', (is, ts) => { is.put(packed, id); ts.delete(thumbRange(id)); }); };
  const deleteWallRows = (id) => (window.HoldRefiner && HoldRefiner.forget(id), tx(STORES, 'readwrite', (ws, hs, rs, is, ts) => {
    for (const s of [ws, hs, is]) s.delete(id);
    ts.delete(thumbRange(id));
    const c = rs.index('wall').openKeyCursor(IDBKeyRange.only(id));
    c.onsuccess = () => { const k = c.result; if (k) { rs.delete(k.primaryKey); k.continue(); } };
  }));
  // 3D 牆：刪掉後沒有別的牆用同一包，就把它的檔案從模型快取清掉
  async function deleteWall(id) {
    const metas = await listMetas().catch(() => []), w = metas.find(x => x.id === id);
    await deleteWallRows(id);
    if (w && w.m3d && w.pid && !metas.some(x => x.id !== id && x.pid === w.pid)) await W3D.dropPack(w.pid).catch(() => {});
  }

  // 路線合併用：編號要跨手機不重複；每條記修改時間 t；刪除留紀錄 w.deleted.routes（點和角色 → 刪除時間，合併時才知道要刪）；分享出去的那份留在伺服器上
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const touch = (o) => { o.t = Date.now(); return o; };
  // 一條線一個路線 id：第一次出線時產生，之後誰收、誰再分享都不變；只有出線的人改了會蓋掉（同一個 id、修改時間晚的贏），改別人的線就另存一條新線。
  // 不比對點和角色：一樣的線可以並存，各是各的
  const routeBorn = (r) => parseInt(String(r.id).slice(1, 9), 36) || Infinity;   // 出線時間：路線 id 的前 8 碼（uid 的 Date.now）
  const deadKey = (r) => r.id;   // 刪除紀錄的鑰匙：路線 id
  function buryKey(w, k) {
    w.deleted = { ...(w.deleted || {}), routes: { ...((w.deleted || {}).routes || {}), [k]: Date.now() } };
  }
  const buryRoute = (w, r) => buryKey(w, deadKey(r));
  const lsGet = AppKit.store.get, lsSet = AppKit.store.set;
  // 手機 id：第一次打開時產生，完攀人數、分享數都把一台手機當一個人；跟著本機備份保存，登出不變更
  const DEVICE_KEY = 'climbio.device';
  const OLD_DEVICES_KEY = 'climbio.devices';   // 這台登入前用過的手機 id：登入後換成帳號的，用舊 id 分享出去又收回來的線還是自己的
  // 這台（或同一個帳號）分享過：才去問分享數、完攀人數（沒分享過的不用連到伺服器）
  function deviceId() {
    let d = lsGet(DEVICE_KEY, '');
    if (!d) { d = crypto.randomUUID(); lsSet(DEVICE_KEY, d); }
    return d;
  }

  // ---------- 復原：每次存檔時記下改之前的樣子；連續的修改（拖曳、打字）0.6 秒內算同一步 ----------
  const undo = { stack: [], base: '', at: 0 }, UNDO_MAX = 5;   // 退回 5 步就夠用（每一步是整面牆的快照，大牆一份幾百 KB）
  const wallSnap = (w) => JSON.stringify({ holds: w.holds, routes: w.routes, deleted: w.deleted || null, name: w.name });
  let editStart = '';   // 進來編輯路線／岩點時的樣子（取消時回復）
  let holdStart = '';   // 定線時長按進到岩點編輯時的樣子（在那裡取消只回復這一段）
  function resetUndo() { undo.stack = []; undo.base = state.wall ? wallSnap(state.wall) : ''; undo.at = 0; }
  function undoEdit() {
    const w = state.wall;
    if (!w || !undo.stack.length) return false;
    const prev = JSON.parse(undo.stack.pop());
    w.holds = prev.holds; w.routes = prev.routes; w.deleted = prev.deleted || { routes: {} }; w.name = prev.name;
    undo.base = wallSnap(w); undo.at = 0;
    w.updatedAt = Date.now();
    clearTimeout(saveTimer);
    putWall(w).catch(() => toast(t('saveFailed')));
    touchGeom();
    refreshOpenWall();
    return true;
  }

  let saveTimer = 0;
  function save() {
    if (!state.wall) return;
    settleWall(state.wall);   // 剛點進路線的岩點馬上複製外框
    const now = Date.now(), snap = wallSnap(state.wall);
    if (snap !== undo.base) {
      if (undo.base && now - undo.at > 600) { undo.stack.push(undo.base); if (undo.stack.length > UNDO_MAX) undo.stack.shift(); }
      undo.base = snap; undo.at = now;
    }
    state.wall.updatedAt = Date.now();
    clearTimeout(saveTimer);
    const w = state.wall;
    saveTimer = setTimeout(() => { putWall(w).catch(() => toast(t('saveFailed'))); writeBackXfer(w); }, 300);
    if (self.climbioAutoShare && state.mode !== 'holds') self.climbioAutoShare(w.id);   // 公開牆上定好的線自動公開（js/sync.js）
    if (state.mode === 'holds') $('holdUndo').disabled = !undo.stack.length;   // 單點編輯的復原鈕跟著存檔更新
  }
