// Firebase 後端（主網用）：公開牆（路線與開放資料集的索引）、岩館牆面、統計。不登入、不記擁有者（docs/proposals/open-versions.md）：寫自己的線靠裝置金鑰簽章，公開牆靠 App Check。
// site.js 的 SITE.backend 是 'firebase' 才啟用，取代 site.js 預設的空後端 window.Backend；跟後端無關的分享工具在 appkit/share-tools.js。
// 公開的牆只有 Studio 發佈（放進 Climbio 的開放資料集，Hugging Face，雲端函式 datasets、walls 寫入）；Climbio 的伺服器只記索引。App 不上傳牆。
// 每個人的線一條一條存在 Climbio 的 wallRoutes（雲端函式 walls），同一張照片大家的線合在一起看，連結 /r/{照片編號}/{路線 id}/；
// 給身邊的朋友用附近交換（appkit/nearby.js），手機之間直接傳，不經過 Climbio 的伺服器。
// 不碰使用者的 Google Drive：備份是使用者自己存的檔案。
//
// 用法：
//   const { results } = await Backend.shareRoutes({ pid, routes: [{ route }], base }); await Backend.unshareRoutes(pid, [rid])；await Backend.unlistWall(pid)：收回公開
//   await Backend.listShared(pid)（先 primeShared(pids) 可以一次問好幾面牆）
//   紅點貓的公開登記用 Backend.projectCall(op, body)（雲端函式 datasets）
//   const books = await Backend.listGuidebooks()：Climbio Studio 發佈的所有 Guidebook；const world = await Backend.loadWorld()：紅點貓「世界」預先合成的三層樹
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
  // 公開：沒有擁有者。牆由 Studio 發佈；App 的人只把自己的線存到 Climbio（put）。單次請求，不進離線佇列；失敗由下次按分享重試
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
  // 分享同一面牆的線：{ pid, routes: [{ route }]（這次要傳的）, base()→{ w, h, holds }（牆的原始岩點檔，用來省掉跟牆一樣的外框） }
  // 只有 Studio 發佈的公開牆能傳線（牆的照片和岩點只由 Studio 公開到開放資料集 climbio/walls）；手機自己拍的牆丟 code: 'private'，只能朋友互傳。
  //   每個人的線一條一條存在 Climbio 的 wallRoutes（雲端函式 walls 的 put；圖層的片段，每個人只能改自己），讀的人一次拿整面牆（listShared）。
  // 要先有裝置金鑰簽章；公開牆不碰 Drive。
  // 回 { results: { 路線 id: { ok, made } } }
  // 公開牆上一條線存成圖層的片段 { nodes, marks }（跟牆上一樣的外框不存，讀的人用牆的原始岩點檔補；規則在 routekit 的 routesLayer）
  const fragmentOf = (pid, route, b) => { const l = RouteKit.routesLayer({ id: pid, pid, href: `${pid}.json`, w: b.w, h: b.h, holds: b.holds, routes: [route], t: 0 }); return JSON.stringify({ nodes: l.nodes, marks: l.marks }); };
  async function shareRoutes({ pid, routes, base }) {
    needNet();
    const b = await base();
    // 不先問牆有沒有公開（少一次呼叫）：直接傳，牆不是公開牆時伺服器回 404（no wall），丟 code: 'private'
    const out = await putRoutes(pid, { routes: routes.map(x => ({ id: x.route.id, r: fragmentOf(pid, x.route, b) })) }).catch((e) => { throw e.status === 404 ? Object.assign(new Error('這面牆不是公開牆，只能傳給朋友'), { code: 'private' }) : e; });
    return { results: Object.fromEntries(routes.map(x => [x.route.id, out.results[x.route.id] === 'ok' ? { ok: true, made: true } : { ok: false, error: out.results[x.route.id] || 'failed' }])) };
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
  // 3D 牆的一條線（岩點編號、角色、手順，3D 牆另帶修點 e）：牆已經由 Studio 發佈、登記過，這裡只傳線，格式跟 2D 的片段一樣。失敗丟錯（呼叫的人退回把整條線放在連結裡）
  async function shareRoute3d(pid, id, fragment) {
    needNet();
    const out = await putRoutes(pid, { routes: [{ id, r: JSON.stringify(fragment) }] });
    if (out.results[id] !== 'ok') throw Object.assign(new Error(out.results[id] || 'failed'), { code: out.results[id] });
    return true;
  }
  // 讀 3D 牆上大家的某一條線的原始片段（連結 ?m3d=牆&rid=線）；沒有就回 null
  async function routeFragment(pid, rid) {
    needNet();
    const got = await wallRoutes({ pid }), e = (got.fragments || []).find(x => x.rid === rid);
    try { return e ? JSON.parse(e.r) : null; } catch (x) { return null; }
  }
  // 自己刪了、伺服器上還在的公開線：拿掉
  const unshareRoutes = (pid, rids) => putRoutes(pid, { del: rids });
  // 收回自己在這面牆的線（刪掉公開的牆）：整面牆公開了就收不回（沒有擁有者），只拿掉這把金鑰寫的線
  async function unlistWall(pid) {
    needNet();
    if (knownKid()) await signedPost('walls', 'withdraw', { pid });
  }
  // 公開牆上所有人的線：一次請求拿整面牆（primeShared 可以一次問好幾面牆，最多 50 面）。
  // 回 [{ rid, mine, r: 路線 JSON（外框只帶跟牆上不一樣的）, t }]；mine＝這把裝置金鑰分享的（只有它能改、能刪）。
  // 陣列的 published 是 false＝這面牆沒有公開了（擁有者收回、過期、包不見了）
  const primed = new Map();
  // 公開牆的線不經過函式：進 App 只讀一個 index（index/world.json，每面牆一行：v 畫面現行版、rt 路線更新時間、n 路線數），
  // 這面牆有路線才再讀 walls/<包>/routes.json（v2 圖層，route 節點的 props.u 是作者雜湊前 16 碼，跟自己金鑰算的一樣就是自己的）；
  // 都是資料集（Hugging Face）的固定網址，沒有自動同步：要看最新的就再讀（index 一分鐘內只讀一次）
  const HF_WALLS = 'https://huggingface.co/datasets/climbio/walls/resolve/main/';
  let indexMemo = null;
  const loadIndex = (force = false) => {
    if (!force && indexMemo && Date.now() - indexMemo.t < 60000) return indexMemo.p;
    const p = fetch(`${HF_WALLS}index/world.json`, { signal: AbortSignal.timeout(10000) }).then(async (r) => {
      if (!r.ok) throw new Error(`index ${r.status}`);
      const d = await r.json();
      if (!d || !Array.isArray(d.walls)) throw new Error('index format');
      return d;
    });
    indexMemo = { t: Date.now(), p };
    p.catch(() => { if (indexMemo && indexMemo.p === p) indexMemo = null; });
    return p;
  };
  // 回 { published, src: { project, path }, ver, layer, mine: { 路線 id: true } }；index 沒有這面牆＝沒有公開（收回、過期、包不見了）
  async function wallRoutes(body) {
    if (Array.isArray(body.pids)) { const walls = {}; await Promise.all(body.pids.map(async (pid) => { walls[pid] = await wallRoutes({ pid }); })); return { walls }; }
    const row = (await loadIndex()).walls.find(w => w.id.endsWith(`/${body.pid}`));
    if (!row) return { published: false };
    const pack = row.id.slice(0, row.id.indexOf('/')), out = { published: true, src: { project: pack, path: row.m3d ? 'index.json' : `${body.pid}.json` }, ver: row.v || 0, rt: row.rt || 0 };
    if (!row.n) return out;
    const r = await fetch(`${HF_WALLS}walls/${pack}/routes.json`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`routes.json ${r.status}`);
    const layer = await r.json(), me = knownKid() ? await AppKit.files.sha(`k:${knownKid()}`, 8) : '';
    // 3D 牆：{ kind: 'routes', routes: [{ id, t, u, r: 片段字串（帶修點 e） }] }，不併成圖層
    if (row.m3d) {
      if (!layer || !Array.isArray(layer.routes)) throw new Error('routes.json format');
      return { ...out, fragments: layer.routes.filter(x => x && typeof x.id === 'string' && typeof x.r === 'string').map(x => ({ rid: x.id, t: x.t || 0, r: x.r, mine: !!me && x.u === me })) };
    }
    if (!layer || !Array.isArray(layer.nodes) || !Array.isArray(layer.marks) || ClimbioFormat.validate(layer).length) throw new Error('routes.json format');
    return { ...out, layer, mine: Object.fromEntries(layer.nodes.filter(n => n.type === 'route' && me && n.props && n.props.u === me).map(n => [n.id, true])) };
  }
  async function primeShared(pids) {
    needNet();
    await loadIndex(true);   // 進 App、手動重新整理才重讀 index；好幾面牆的路線同一次用同一份
    for (let i = 0; i < pids.length; i += 50) {
      const part = pids.slice(i, i + 50), got = (await wallRoutes({ pids: part })).walls || {};
      for (const pid of part) primed.set(pid, got[pid] || { published: false });
    }
  }
  // 公開牆上所有人的線：回 [{ rid, mine, r: 路線 JSON（外框只帶跟牆上不一樣的）, t }]；mine＝這把裝置金鑰分享的（只有它能改、能刪）。
  // 陣列的 published 是 false＝這面牆沒有公開了
  async function listShared(pid) {
    needNet();
    const got = primed.get(pid) || await wallRoutes({ pid });
    primed.delete(pid);
    const out = [];
    // 一條線的片段 → 只有這條線的圖層（牆的畫面不在這裡，讀的人用自己的原始岩點檔補外框）
    const layerOfFragment = (f) => ({ climbio: 2, kind: 'layer', id: `${pid}routes`, on: pid, href: `${pid}.json`, t: 0, license: 'CC-BY-SA-4.0', nodes: f.nodes, marks: f.marks });
    for (const e of got.fragments || []) {
      let layer; try { layer = layerOfFragment(JSON.parse(e.r)); } catch (x) { continue; }
      if (!Array.isArray(layer.nodes) || !Array.isArray(layer.marks) || ClimbioFormat.validate(layer).length) continue;
      for (const r of RouteKit.fromFormat({}, [layer]).routes) if (r.id === e.rid) out.push({ rid: e.rid, mine: !!e.mine, r: JSON.stringify(r), t: r.t || e.t || 0 });
    }
    if (got.layer) for (const r of RouteKit.fromFormat({}, [got.layer]).routes) out.push({ rid: r.id, mine: !!(got.mine && got.mine[r.id]), r: JSON.stringify(r), t: r.t || 0 });
    out.sort((x, y) => y.t - x.t);   // 新的在前
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
  // 紅點貓進 App 只讀一個 index（資料集 climbio/crags 的 index/redpoint.json，固定網址、不經過函式）：
  // projects＝Climbio Studio 發佈的所有 Guidebook 與 3D 牆（公開專案，每項有版本時間 t 和資料集的網址 url；讀的人自己挑 type，
  // 3D 牆的清單不在這裡，跟 2D 公開牆一起走岩館的牆面清單）；world.v＝世界的三層樹的版本（內容雜湊），世界檔 index/world.<v>.json 變了才重讀。
  // 本機收下的岩場比自己存的 t，新的才另外讀它的資料；沒有自動同步，要最新的就再讀（一分鐘內只讀一次，fresh 不用快取）
  const HF_CRAGS = 'https://huggingface.co/datasets/climbio/crags/resolve/main/';
  let cragsMemo = null;
  const loadCragsIndex = ({ fresh = false } = {}) => {
    needNet();
    if (!fresh && cragsMemo && Date.now() - cragsMemo.t < 60000) return cragsMemo.p;
    const p = fetch(`${HF_CRAGS}index/redpoint.json`, { signal: AbortSignal.timeout(15000), ...(fresh ? { cache: 'no-store' } : {}) }).then(async (response) => {
      if (!response.ok) throw Object.assign(new Error(`index: ${response.status}`), { status: response.status });
      const d = await response.json();
      if (!d || !Array.isArray(d.projects)) throw new Error('index format');
      return d;
    });
    cragsMemo = { t: Date.now(), p };
    p.catch(() => { if (cragsMemo && cragsMemo.p === p) cragsMemo = null; });
    return p;
  };
  async function listProjects(type, opt = {}) {   // fresh：不用快取（發佈後確認世界清單重建了）
    return (await loadCragsIndex(opt)).projects.filter(p => p.type === type);
  }
  const listGuidebooks = (opt) => listProjects('guidebook', opt);
  // 同一本書所有的版本，含不列入世界的（世界清單沒有它們）：每一版的資料夾都有發佈時寫的 versions.json（functions/projects.js）；回跟 listGuidebooks 同樣的列（找不到就是 []）
  async function guidebookVersions(id) {
    needNet();
    const r = await fetch(`${HF_CRAGS}crags/${id}/versions.json`, { signal: AbortSignal.timeout(10000) });
    return r.ok ? ((await r.json()).rows || []) : [];
  }
  // 紅點貓「世界」預先合成好的三層樹（資料集的 index/world.<v>.json，網址帶版本、永遠不變；合成程式在 functions/world.js）：
  // have＝手機上存的那一份的版本（wv）；index 的 world.v 一樣就回 null（不用再抓 140 KB），不一樣才抓新的並記上 wv
  async function loadWorld(have = '') {
    const { world } = await loadCragsIndex();
    if (!world || !world.v) throw Object.assign(new Error('world: no index'), { status: 404 });
    if (have && have === world.v) return null;
    const response = await fetch(`${HF_CRAGS}index/world.${world.v}.json`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Object.assign(new Error(`world: ${response.status}`), { status: response.status });
    return { ...(await response.json()), wv: world.v };
  }

  window.Backend = {
    name: 'firebase', caps: { share: true, gyms: true, account: false, guidebooks: true, walls3d: true },
    projectCall: (op, body) => fnPost('datasets', { op, ...body }, true),
    projectId: FIREBASE.projectId, shareRoutes, unshareRoutes, shareRoute3d, routeFragment, unlistWall, listShared, primeShared, reportWall, listGuidebooks, guidebookVersions, loadWorld,
    appCheckToken,
  };
})();
