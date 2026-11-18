// Firebase 後端（主網用）：公開牆（路線與開放資料集的索引）、岩館牆面、統計。不登入、不記擁有者（docs/proposals/open-versions.md）：寫自己的線靠裝置金鑰簽章，公開牆靠 App Check。
// site.js 的 SITE.backend 是 'firebase' 才啟用，取代 site.js 預設的空後端 window.Backend；跟後端無關的分享工具在 appkit/share-tools.js。
// 公開的牆放進 Climbio 的開放資料集（Hugging Face，雲端函式 datasets、walls 寫入）；Climbio 的伺服器只記索引。
// 每個人的線一條一條存在 Climbio 的 wallRoutes（雲端函式 walls），同一張照片大家的線合在一起看，連結 /r/{照片編號}/{路線 id}/；
// 給身邊的朋友用附近交換（appkit/nearby.js），手機之間直接傳，不經過 Climbio 的伺服器。
// 不碰使用者的 Google Drive：備份是使用者自己存的檔案。
//
// 用法：
//   const { results } = await Backend.shareRoutes({ pid, gym, wall, routes: [{ route }], photo, base, signature }); await Backend.unshareRoutes(pid, [rid])；await Backend.unlistWall(pid)：收回公開
//   await Backend.listShared(pid)（先 primeShared(pids) 可以一次問好幾面牆）
//   紅點貓的公開登記用 Backend.projectCall(op, body)（雲端函式 datasets）
//   const books = await Backend.listGuidebooks()：Climbio Studio 發佈的所有 Guidebook（紅點貓的「世界」）
// English: Firebase backend for the main site (window.Backend): public walls, gym walls, stats. No sign-in, no owners.
(() => {
  'use strict';
  if (self.SITE && SITE.backend !== 'firebase') return;
  const FIREBASE = {
    apiKey: 'AIzaSyC9HfQIuqdnZEldqmrh9uWQ-ME6QhH3KvE',
    projectId: 'firebase-climbio',
    storageBucket: 'firebase-climbio.appspot.com',
    messagingSenderId: '1094091546433',
    appId: '1:1094091546433:web:8e30c9c1fa94cb67360bc0',
  };
  const FB = 'https://www.gstatic.com/firebasejs/11.10.0/';
  // App Check（reCAPTCHA Enterprise，使用者看不到）：Firestore、Storage 只收真的從 Climbio 網頁送出的請求，腳本直接打 API 會被拒絕。
  // 金鑰在控制台建立（docs/deploy.md）；空字串＝不載入（自架站沒設 App Check 就留空）。本機預覽用偵錯權杖（console 會印出來，要在控制台登記）
  const APP_CHECK_KEY = '6Le1EgouAAAAAPjGak4NxYZYRfrDFN1LV5Y7Rt3q';
  const { T, needNet, offlineError } = ShareTools;
  let fbp = null;
  // 只載入 App Check：沒有帳號，Firebase 的登入、資料庫、儲存都不用，寫入都走雲端函式
  function firebase() {
    if (!fbp) fbp = (async () => {
      const [app, ac] = await Promise.all(['firebase-app', ...(APP_CHECK_KEY ? ['firebase-app-check'] : [])].map(n => import(FB + n + '.js')));
      const a = app.initializeApp(FIREBASE);
      let check = null;
      if (ac) {
        if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
        check = ac.initializeAppCheck(a, { provider: new ac.ReCaptchaEnterpriseProvider(APP_CHECK_KEY), isTokenAutoRefreshEnabled: true });
      }
      return { app: a, ac, check };
    })().catch((e) => { fbp = null; throw e; });
    return fbp;
  }

  // ---------- 公開牆分享（Climbio 的開放資料集，見 docs/sharing.md）：一個人一面牆一個分享包（ShareTools.wallPackage） ----------
  // 公開的登記索引——雲端函式 datasets 記這個包，walls 登記到找牆面。
  // 公開：沒有擁有者。牆還沒公開時第一個分享的人把牆的照片和畫面放進開放資料集（publish），之後的人只把自己的線存到 Climbio（put）。
  // 包 id 從照片編號算出來（每台裝置都一樣），不用另外記。單次請求，不進離線佇列；失敗由下次按分享重試
  // 超過每天的上限（daily limit）、停止上傳（503）都是 quota：前者換成「今天分享太多次了」
  const fnError = (j, r) => Object.assign(new Error(j.error === 'daily limit' ? T('shareQuota') : j.error || `HTTP ${r.status}`), { status: r.status, code: r.status === 503 || j.error === 'daily limit' ? 'quota' : undefined });
  // ---------- 裝置金鑰：岩友在公開牆寫自己的線不登入（雲端函式 walls 的 put、withdraw 驗簽章；設計見 docs/proposals/device-key-routes.md）----------
  // 第一次要寫時產生 ECDSA P-256 金鑰，存在 localStorage `climbio.deviceKey`（跟著本機備份走，換手機復原後仍能改自己的線）；kid＝公鑰指紋，線的擁有者是 `k:<kid>`
  const KEY_STORE = 'climbio.deviceKey', MORE_STORE = 'climbio.deviceKey.more', ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
  const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const kidOf = async (x, y) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${x}.${y}`)))].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  const knownKid = () => { try { return (JSON.parse(localStorage.getItem(KEY_STORE)) || {}).kid || ''; } catch (e) { return ''; } };   // 已經有金鑰才有；只讀公開牆的人不產生
  let keyJob = null;
  const deviceKey = () => (keyJob ||= (async () => {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY_STORE)); } catch (e) { saved = null; }
    if (saved && saved.jwk && saved.kid) {
      try {
        const priv = await crypto.subtle.importKey('jwk', { ...saved.jwk, key_ops: ['sign'], ext: true }, ECDSA, true, ['sign']);
        if (await kidOf(saved.jwk.x, saved.jwk.y) === saved.kid) return { kid: saved.kid, pub: { kty: 'EC', crv: 'P-256', x: saved.jwk.x, y: saved.jwk.y }, priv };
      } catch (e) { console.warn('裝置金鑰讀不起來，重新產生', e); }
    }
    const pair = await crypto.subtle.generateKey(ECDSA, true, ['sign', 'verify']), jwk = await crypto.subtle.exportKey('jwk', pair.privateKey), kid = await kidOf(jwk.x, jwk.y);
    try { localStorage.setItem(KEY_STORE, JSON.stringify({ jwk, kid })); } catch (e) { console.warn('裝置金鑰存不起來', e); }
    return { kid, pub: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, priv: pair.privateKey };
  })().catch((e) => { keyJob = null; throw e; }));
  // 簽過章的寫入請求（要簽的訊息跟 functions/device-key.js 的 message 一樣）；手機時鐘差太多（伺服器回 stale 和它的時間）就照伺服器的時間重簽一次
  // 配對過的另一台的金鑰（同一個人的其他金鑰）：換它簽，才改得了那把金鑰寫的線
  const moreKeys = async () => {
    const out = [];
    try {
      for (const s of JSON.parse(localStorage.getItem(MORE_STORE)) || []) {
        if (!s || !s.jwk || !s.kid || await kidOf(s.jwk.x, s.jwk.y) !== s.kid) continue;
        out.push({ kid: s.kid, pub: { kty: 'EC', crv: 'P-256', x: s.jwk.x, y: s.jwk.y }, priv: await crypto.subtle.importKey('jwk', { ...s.jwk, key_ops: ['sign'], ext: true }, ECDSA, true, ['sign']) });
      }
    } catch (e) { console.warn('其他裝置金鑰讀不起來', e); }
    return out;
  };
  // 簽一個請求：{ kid, pub, ts, nonce, sig }；簽的是 [op, pid, ts, nonce, routes, del]（跟雲端函式 device-key.js 的 message 一樣）。skew：手機時鐘跟伺服器差多少（毫秒）
  async function signAuth(op, body, skew = 0, key = null) {
    const k = key || await deviceKey(), ts = Date.now() + skew, nonce = b64u(crypto.getRandomValues(new Uint8Array(12)));
    const sig = b64u(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k.priv, new TextEncoder().encode(JSON.stringify([op, body.pid, ts, nonce, body.routes === undefined ? [] : body.routes, body.del === undefined ? [] : body.del]))));
    return { kid: k.kid, pub: k.pub, ts, nonce, sig };
  }
  async function signedPost(name, op, body, skew = 0, key = null) {
    const b = { ...body, op, auth: await signAuth(op, body, skew, key) };
    try { return await fnPost(name, b, true); }
    catch (e) { if (e.stale && !skew && Number.isFinite(e.now)) return signedPost(name, op, body, e.now - Date.now(), key); throw e; }
  }
  async function fnPost(name, body, appCheck = false) {
    let r;
    try { r = await fetch(FN(name), { method: 'POST', headers: { 'Content-Type': 'application/json', ...(appCheck ? { 'X-Firebase-AppCheck': await appCheckToken() } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) }); }
    catch (e) {
      if (e.name === 'TimeoutError' || e.name === 'AbortError') throw Object.assign(new Error(T('shareTimeout')), { code: 'timeout' });
      throw e;
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(fnError(j, r), j.error === 'stale' ? { stale: true, now: j.now } : {});
    return j;
  }
  const hex16 = (text) => AppKit.files.sha(text, 8);
  // 這面牆的分享包：{ id: 包 id, layer: 路線圖層的 id }；只由照片編號算出來，每台裝置、每個人都一樣
  async function sharePack(pid) {
    const id = await hex16(pid);
    return { id, layer: await hex16(`${id}:routes`) };
  }
  const pubSigs = new Map();   // 包 id → 這次打開 App 公開出去的內容簽章
  const sigOf = async (files) => (await Promise.all(files.map(async f => `${f.path}:${[...new Uint8Array(await crypto.subtle.digest('SHA-256', f.bytes))].map(x => x.toString(16).padStart(2, '0')).join('')}`))).join('|');
  const b64Of = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const wallRegs = new Map();    // 照片編號 → 這次打開 App 登記到找牆面的結果：'guest'（別人先發佈了這面牆）或擁有者登記的內容（牆名、岩館）
  // 分享同一面牆的線：{ pid, gym, wall: 牆名, routes: [{ route }]（這次要傳的）,
  //   photo()→照片 JPEG, base()→{ name, w, h, thumb, holds, t }（原始岩點檔）, signature }
  // 牆的照片和畫面只由第一個發佈這面牆的人（擁有者）公開到開放資料集一次（publishBase，Hugging Face 的 climbio/walls），其他人什麼都不傳；
  //   每個人的線一條一條存在 Climbio 的 wallRoutes（雲端函式 walls 的 put；圖層的片段，每個人只能改自己），讀的人一次拿整面牆（listShared）。
  // 要先登入 Google（沒登入丟 code: 'signin'，App 帶使用者去登入）；公開牆不碰 Drive。
  // 回 { results: { 路線 id: { ok, made } } }
  // 公開牆上一條線存成圖層的片段 { nodes, marks }（跟牆上一樣的外框不存，讀的人用牆的原始岩點檔補；規則在 routekit 的 routesLayer）
  const fragmentOf = (pid, route, b) => { const l = RouteKit.routesLayer({ id: pid, pid, href: `${pid}.json`, w: b.w, h: b.h, holds: b.holds, routes: [route], t: 0 }); return JSON.stringify({ nodes: l.nodes, marks: l.marks }); };
  async function shareRoutes({ pid, gym = '', wall = '', routes, photo, base, signature }) {
    needNet();
    const st = await wallRoutes({ pid });   // { published }：牆還沒公開才把牆放進開放資料集；公開了就只傳自己的線
    if (!st.published) await publishBase({ pid, gym, wall, photo, base, signature });
    const b = await base(), out = await putRoutes(pid, { routes: routes.map(x => ({ id: x.route.id, r: fragmentOf(pid, x.route, b) })) });
    return { results: Object.fromEntries(routes.map(x => [x.route.id, out.results[x.route.id] === 'ok' ? { ok: true, made: true } : { ok: false, error: out.results[x.route.id] || 'failed' }])) };
  }
  // 擁有者的包：照片、牆的畫面、縮圖，不放路線（圖層是空的、內容固定，沒有改就一個檔也不傳）；包裡的圖層檔是找牆面收整面牆的入口。
  // 登記到找牆面：這次打開 App 第一次、或牆名、岩館改了才送；別人先發佈了（taken）就當訪客
  async function publishBase({ pid, gym, wall, photo, base, signature }) {
    const pack = await sharePack(pid), entry = `${pack.layer}.json`;
    const b = await base(), name = (wall || b.name || 'Climbio').slice(0, 60);
    const files = await ShareTools.wallPackage({ id: pack.id, layerId: pack.layer, pid, name, gym, w: b.w, h: b.h, thumb: b.thumb, holds: b.holds, routes: [], photo: await photo(),
      attribution: signature || AppKit.nearby.nickname() || 'Climbio', version: 0, t: b.t || 0 });
    // 公開的牆放進開放資料集（雲端函式 datasets 寫進 Hugging Face，不經過 Drive）；這次打開 App 傳過同樣的內容就不再傳，函式看到內容一樣也不寫新版本
    const sig = await sigOf(files);
    if (pubSigs.get(pack.id) !== sig) {
      let res;
      try { res = await fnPost('datasets', { op: 'publishWall', id: pack.id, name, gym, licenseAccepted: true, files: files.map(f => ({ path: f.path, b64: b64Of(f.bytes) })) }, true); }
      catch (e) { if (e.status !== 409) throw e; res = { same: true }; }   // 別人先公開了不同的內容（尺寸、岩點對不上）：用現有的包，只登記到找牆面、傳自己的線
      pubSigs.set(pack.id, sig);
      if (!res.same) wallRegs.delete(pid);
    }
    const reg = JSON.stringify([name, gym]);
    if (wallRegs.get(pid) === reg || wallRegs.get(pid) === 'guest') return;
    await fnPost('walls', { op: 'publish', pid, name, gym, src: { project: pack.id, path: entry } }, true); wallRegs.set(pid, reg);
  }
  // 公開牆的線（Climbio 的 wallRoutes，一次最多 100 條）：routes: [{ id, r: 片段 JSON 字串 }] 新增或更新，del: [路線 id] 刪除；只能動自己的。回 { results: { 路線 id: 'ok' | 'taken' } }
  async function putRoutes(pid, { routes = [], del = [] }) {
    needNet();
    const results = {}, keys = [null, ...await moreKeys()];   // null＝這台的主金鑰；被別人（'taken'）擋下的再換配對來的金鑰試一次
    const send = async (field, list) => {
      let rest = list;
      for (const key of keys) {
        if (!rest.length) break;
        const left = [];
        for (let i = 0; i < rest.length; i += 100) {
          const part = rest.slice(i, i + 100), res = (await signedPost('walls', 'put', { pid, [field]: part }, 0, key)).results;
          for (const x of part) { const id = field === 'routes' ? x.id : x; if (res[id] === 'taken' && key !== keys[keys.length - 1]) left.push(x); else results[id] = res[id]; }
        }
        rest = left;
      }
    };
    await send('routes', routes); await send('del', del);
    return { results };
  }
  // 自己刪了、伺服器上還在的公開線：拿掉
  const unshareRoutes = (pid, rids) => putRoutes(pid, { del: rids });
  // 收回自己在這面牆的線（刪掉公開的牆）：整面牆公開了就收不回（沒有擁有者），只拿掉這把金鑰寫的線
  async function unlistWall(pid) {
    needNet();
    wallRegs.delete(pid);
    if (knownKid()) await signedPost('walls', 'withdraw', { pid });
  }
  // 公開牆上所有人的線：一次請求拿整面牆（primeShared 可以一次問好幾面牆，最多 50 面）。
  // 回 [{ rid, mine, r: 路線 JSON（外框只帶跟牆上不一樣的）, t }]；mine＝這把裝置金鑰分享的（只有它能改、能刪）。
  // 陣列的 published 是 false＝這面牆沒有公開了（擁有者收回、過期、包不見了）
  const primed = new Map();
  const wallRoutes = async (body) => fnPost('walls', { op: 'routes', ...body, ...(knownKid() ? { kid: knownKid() } : {}) });
  async function primeShared(pids) {
    needNet();
    for (let i = 0; i < pids.length; i += 50) {
      const part = pids.slice(i, i + 50), got = (await wallRoutes({ pids: part })).walls || {};
      for (const pid of part) primed.set(pid, got[pid] || { published: false, routes: [] });
    }
  }
  // 一條線的片段 → 只有這條線的圖層（牆的畫面不在這裡，讀的人用自己的原始岩點檔補外框）
  const layerOfFragment = (pid, f) => ({ climbio: 2, kind: 'layer', id: pid, on: pid, href: `${pid}.json`, t: 0, license: 'CC-BY-SA-4.0', nodes: f.nodes, marks: f.marks });
  async function listShared(pid) {
    needNet();
    const got = primed.get(pid) || await wallRoutes({ pid });
    primed.delete(pid);
    const out = [];
    for (const e of got.routes || []) {
      let layer; try { layer = layerOfFragment(pid, JSON.parse(e.r)); } catch (x) { continue; }
      if (!Array.isArray(layer.nodes) || !Array.isArray(layer.marks) || ClimbioFormat.validate(layer).length) continue;
      for (const r of RouteKit.fromFormat({}, [layer]).routes) if (r.id === e.rid) out.push({ rid: e.rid, mine: !!e.mine, r: JSON.stringify(r), t: r.t || e.t || 0 });
    }
    out.published = got.published !== false;
    out.src = got.src || null; out.ver = got.ver || 0;   // 牆的畫面在哪、現在第幾版：版本變了 App 重讀岩點（js/sync.js 的 refreshHolds）
    return out;
  }
  // 雲端函式的 App Check 權杖（標頭 X-Firebase-AppCheck）：重描、偵測、整理外框、預覽圖只收 Climbio 網頁送出的請求。沒設 App Check 或拿不到就空的（函式回 401）
  async function appCheckToken(forceRefresh = false) {
    const f = await firebase();
    if (!f.check) return '';
    try { return (await f.ac.getToken(f.check, forceRefresh)).token; } catch (e) { console.warn('App Check 權杖拿不到', e); return ''; }
  }
  const base64 = (blob) => AppKit.files.base64(blob);
  const FN = (name) => `https://asia-east1-${FIREBASE.projectId}.cloudfunctions.net/${name}`;
  // 公開的牆讀不到（/p/ 回 404）：通報給後端（雲端函式 walls 的 report），後端查過資料集才拿掉索引；要 App Check，不用登入
  async function reportWall(pid) {
    await fnPost('walls', { op: 'report', pid }, true);
  }
  // Climbio Studio 發佈的所有 Guidebook 與 3D 牆（公開專案）：Storage 上的靜態清單 public/projects.json（雲端函式 datasets 在發佈、下架後和每天重寫，見 functions/projects.js 的 writeWorld），
  // 不用登入、不經過雲端函式（沒有冷啟動），CDN 留 5 分鐘。紅點貓的「世界」只要 guidebook，岩點貓的 3D 牆只要 wall3d：讀的人自己挑 type
  async function listProjects(type) {
    needNet();
    const response = await fetch(`https://firebasestorage.googleapis.com/v0/b/${FIREBASE.storageBucket}/o/public%2Fprojects.json?alt=media`, { signal: AbortSignal.timeout(15000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error?.message || `projects: ${response.status}`), { status: response.status });
    return (data.projects || []).filter(p => p.type === type);
  }
  const listGuidebooks = () => listProjects('guidebook');
  // Climbio Studio 發佈的 3D 牆（type wall3d）：找牆面照岩館列出。[{ id, name, gym, t, thumb? }]，新到舊
  const listWalls3d = () => listProjects('wall3d');

  window.Backend = {
    name: 'firebase', caps: { share: true, gyms: true, account: false, guidebooks: true, walls3d: true },
    projectCall: (op, body) => fnPost('datasets', { op, ...body }, true),
    projectId: FIREBASE.projectId, shareRoutes, unshareRoutes, unlistWall, listShared, primeShared, reportWall, listGuidebooks, listWalls3d,
    appCheckToken,
  };
})();
