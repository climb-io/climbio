// 內嵌頁的路線提交與刪除：把一條路線直接寫進 Climbio 的公開牆（雲端函式 walls 的 put），做法跟岩點貓分享路線一樣，但身分是「iframe 所在的網站來源」：
// 預設沒有金鑰：路線記在 o:<網站來源> 名下，同一個岩館網站上所有人提交的路線都屬於這個網站，這個網站能更新、刪除自己名下的全部（見 docs/embed.md）。
// 有後台的岩館可以自己產生金鑰（{ kid, pub, priv }，同岩點貓的裝置金鑰），在 init 帶進來：路線改記在 k:<kid> 名下，用這把金鑰簽章（比網站來源難冒充；金鑰會出現在岩館的網頁裡）。
// 網站來源是瀏覽器給的（外層送 init 時的 event.origin），別的網站冒充不了；要有 App Check 權杖（reCAPTCHA Enterprise，使用者看不到）。
// 只有外層送 submit 或 remove 時才載入 Google 的 App Check 腳本並連到雲端函式；看線、只定線不提交的人，這頁不會對外發任何請求。
(function () {
  'use strict';
  const FN = 'https://asia-east1-firebase-climbio.cloudfunctions.net/walls';
  const FB = 'https://www.gstatic.com/firebasejs/11.10.0/';
  const FIREBASE = {
    apiKey: 'AIzaSyC9HfQIuqdnZEldqmrh9uWQ-ME6QhH3KvE', projectId: 'firebase-climbio', storageBucket: 'firebase-climbio.appspot.com',
    messagingSenderId: '1094091546433', appId: '1:1094091546433:web:8e30c9c1fa94cb67360bc0',
  };
  const APP_CHECK_KEY = '6Le1EgouAAAAAPjGak4NxYZYRfrDFN1LV5Y7Rt3q';   // 公開的網站金鑰（跟 backend/firebase.js 同一把；控制台要把 embed.climbio.app 加進網域）

  // App Check 權杖：只在要提交時載入；拿不到就丟錯（函式會回 401，提交失敗）
  let checkJob = null;
  const appCheckToken = async () => {
    checkJob ||= (async () => {
      const [app, ac] = await Promise.all(['firebase-app', 'firebase-app-check'].map((n) => import(FB + n + '.js')));
      const a = app.initializeApp(FIREBASE);
      return { ac, check: ac.initializeAppCheck(a, { provider: new ac.ReCaptchaEnterpriseProvider(APP_CHECK_KEY), isTokenAutoRefreshEnabled: true }) };
    })().catch((e) => { checkJob = null; throw e; });
    const f = await checkJob;
    return (await f.ac.getToken(f.check, false)).token;
  };

  // ---- 岩館自己的金鑰（選用）：ECDSA P-256，簽的訊息跟 functions/device-key.js 的 message 一樣 [op, 牆 id, ts, nonce, routes, del] ----
  const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const kidOf = async (x, y) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${x}.${y}`)))].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  async function loadKey(k) {
    if (!k || typeof k !== 'object' || !k.pub || !k.priv || typeof k.kid !== 'string') throw new Error('key 要是 { kid, pub, priv }（岩館金鑰檔的內容）');
    if (await kidOf(k.pub.x, k.pub.y) !== k.kid) throw new Error('key 的 kid 跟公鑰對不上');
    try { return { kid: k.kid, pub: { kty: 'EC', crv: 'P-256', x: k.pub.x, y: k.pub.y }, priv: await crypto.subtle.importKey('jwk', { ...k.priv, key_ops: ['sign'], ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']) }; }
    catch (e) { throw new Error('key 的私鑰讀不起來'); }
  }
  async function signAuth(key, pid, body, skew) {
    const ts = Date.now() + skew, nonce = b64u(crypto.getRandomValues(new Uint8Array(12)));
    const sig = b64u(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key.priv, new TextEncoder().encode(JSON.stringify(['put', pid, ts, nonce, body.routes === undefined ? [] : body.routes, body.del === undefined ? [] : body.del]))));
    return { kid: key.kid, pub: key.pub, ts, nonce, sig };
  }

  // site：外層的網站來源（https://網站），key：岩館自己的金鑰（選用）；兩個都沒有（原生 App 的 WebView 又沒帶金鑰）就不能提交
  async function put(site, pid, { routes, del }, key = null, skew = 0) {
    const k = key ? await loadKey(key) : null;
    if (!k && (typeof site !== 'string' || !site || site === 'null')) throw new Error('提交要在 iframe 裡（身分是外層的網站來源），或在 init 帶岩館的 key；原生 App 的 WebView 沒有網站來源，要帶 key');
    const body = { ...(routes ? { routes } : {}), ...(del ? { del } : {}) };
    const r = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Firebase-AppCheck': await appCheckToken() }, body: JSON.stringify({ op: 'put', pid, ...body, ...(k ? { auth: await signAuth(k, pid, body, skew) } : { site }) }), signal: AbortSignal.timeout(60000) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return j.results || {};
    if (k && j.error === 'stale' && !skew && Number.isFinite(j.now)) return put(site, pid, { routes, del }, key, j.now - Date.now());   // 時鐘差太多：照伺服器的時間重簽一次
    throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status });
  }

  window.RouteSubmit = { put, FN };
})();
