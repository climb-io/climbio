// 牆發佈內嵌頁的寫入：呼叫雲端函式 datasets 的 publishWall（跟 Studio 發佈同一個伺服器檢查與額度）。
// 要 App Check 權杖（只有 Climbio 的網頁拿得到，reCAPTCHA Enterprise；控制台要把 embed.climbio.app 加進網域），跟路線提交（../../routekit/v1/submit.js）同一套。
(function () {
  'use strict';
  const FN = 'https://asia-east1-firebase-climbio.cloudfunctions.net/datasets';
  const FB = 'https://www.gstatic.com/firebasejs/11.10.0/';
  const FIREBASE = {
    apiKey: 'AIzaSyC9HfQIuqdnZEldqmrh9uWQ-ME6QhH3KvE', projectId: 'firebase-climbio', storageBucket: 'firebase-climbio.appspot.com',
    messagingSenderId: '1094091546433', appId: '1:1094091546433:web:8e30c9c1fa94cb67360bc0',
  };
  const APP_CHECK_KEY = '6Le1EgouAAAAAPjGak4NxYZYRfrDFN1LV5Y7Rt3q';   // 公開的網站金鑰（跟 backend/firebase.js 同一把）

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
  const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

  /** 公開一面牆：files [{ path, bytes }]；回 { id, version, current, base }，失敗丟帶 status 的錯誤（429 今天太多次、503 暫停上傳） */
  async function publishWall({ id, name, gym, files }) {
    const r = await fetch(FN, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Firebase-AppCheck': await appCheckToken() },
      body: JSON.stringify({ op: 'publishWall', source: 'embed', id, name, gym, licenseAccepted: true, files: files.map((f) => ({ path: f.path, b64: b64(f.bytes) })) }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status });
    return j;
  }

  window.WallPublish = { publishWall, FN };
})();
