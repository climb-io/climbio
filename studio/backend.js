// Studio 的後端：發佈的雲端函式 datasets 的網址。接不接後端照站台設定 site.js 的 SITE.backend（主網是 'firebase'；自己架的站、公開版預設 'none'）。
// 不接時發佈的網址是空的（發佈對話框顯示「發佈服務還沒開」），專案照樣存在這台電腦、可以匯出 ZIP。Studio 不登入、不記擁有者（docs/proposals/open-versions.md）。
export const enabled = globalThis.SITE?.backend === 'firebase';
export const SERVICE = enabled ? 'https://asia-east1-firebase-climbio.cloudfunctions.net/datasets' : '';
/** 發佈要帶的 App Check 權杖：跟岩點貓、紅點貓同一份（backend/firebase.js 的 Backend.appCheckToken），只有 Climbio 網頁拿得到 */
export const appCheck = async () => (globalThis.Backend?.appCheckToken ? globalThis.Backend.appCheckToken() : '');
/** 代理用無畫面 Studio 發佈時放進來的同步身分（tools/guidebook.mjs、tools/studio.mjs 的 publish 寫在 localStorage）：只在同一來源（同一個 Firebase 專案）發佈時送，不把自架同步金鑰送給別的後端 */
export const studioKey = async () => {
  if (!SERVICE) return '';
  try {
    const r = JSON.parse(localStorage.getItem('climbio.studio.remote'));
    if (!r?.key || !r?.url || new URL(r.url).origin !== new URL(SERVICE).origin) return '';
    return r.key;
  } catch { return ''; }
};
