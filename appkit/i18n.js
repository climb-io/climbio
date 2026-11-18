// AppKit i18n：語言包載入。每個 App 一組語言包（i18n/<app>/<語言>.js），共用名詞一組（i18n/common/<語言>.js）；
// 依這台的設定或瀏覽器語言只載入一種語言，切換時才載入別的。語言包檔案由 App 的 Service Worker 一起快取，離線也能切換。
// 瀏覽器用 <script> 載入，掛在全域 AppKit.i18n；Node 用 require。
// English: AppKit i18n: loads one language at a time — the app's pack (i18n/<app>/<lang>.js) plus shared terms (i18n/common/<lang>.js).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.AppKit || (root.AppKit = {})).i18n = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const LANGS = ['zh', 'en', 'ja', 'fr', 'ko', 'es', 'de'];
  const COMMON = 'common';
  const packs = {};   // packs[app][語言] = { key: 文字或函式 }
  const cfg = { app: COMMON, key: '', langs: LANGS, base: '../i18n/' };
  let lang = 'zh';
  // 頁面載入 i18n.js 的網址帶版本（?v=…，部署時寫入）：語言包用同一個後綴，跟頁面同一版（Service Worker 裡、本機開發沒有）
  const vq = ((typeof document !== 'undefined' && document.currentScript && document.currentScript.src || '').match(/\?v=[^&#]*/) || [''])[0];

  /** 語言包檔案呼叫：AppKit.i18n.add('hold', 'zh', { … }) */
  function add(app, l, dict) { (packs[app] || (packs[app] = {}))[l] = dict; }

  /** 依瀏覽器語言：zh 開頭是中文，其他有語言包的照語言碼，沒有的英文（只有中文的 App 一律中文） */
  function detect(langs = cfg.langs, nav = typeof navigator === 'undefined' ? '' : (navigator.languages && navigator.languages[0]) || navigator.language || '') {
    if (/^zh/i.test(nav) && langs.includes('zh')) return 'zh';
    return langs.find(l => l !== 'zh' && nav.toLowerCase().startsWith(l)) || (langs.includes('en') ? 'en' : langs[0]);
  }
  /** 這台選的語言（存在 localStorage 的 key）；沒選過是 'auto' */
  function setting() {
    try { const v = cfg.key && localStorage.getItem(cfg.key); return cfg.langs.includes(v) ? v : 'auto'; } catch (e) { return 'auto'; }
  }
  const appsOf = (app) => [...new Set([COMMON, ...[].concat(app)])];   // app 可以是一個或一串語言包資料夾名（例如 Studio 的共用包加工作區的包）
  const files = (l, app = cfg.app, base = cfg.base) => appsOf(app).map(a => `${base}${a}/${l}.js${vq}`);

  /**
   * 開頁時在 <head> 同步呼叫：記下 App 的設定，決定語言，用 document.write 讓語言包在主程式之前執行完。
   * app：語言包資料夾名（一個，或一串：依序找 key）；key：記住使用者選擇的 localStorage key；langs：這個 App 有的語言；base：i18n/ 的相對網址
   */
  function boot({ app, key = '', langs = LANGS, base = '../i18n/' }) {
    Object.assign(cfg, { app: [].concat(app), key, langs, base });
    const s = setting();
    lang = s === 'auto' ? detect() : s;
    document.documentElement.lang = htmlLang(lang);
    for (const f of files(lang)) document.write(`<script src="${f}"><\/script>`);
    return lang;
  }
  /** 換語言：沒載入過的語言包才去抓；key 有設定時記住選擇（'auto'＝跟瀏覽器） */
  async function use(choice) {
    const l = choice === 'auto' ? detect() : choice;
    await Promise.all(appsOf(cfg.app).filter(a => !(packs[a] || {})[l]).map(a => load(`${cfg.base}${a}/${l}.js${vq}`)));
    if (cfg.key) try { choice === 'auto' ? localStorage.removeItem(cfg.key) : localStorage.setItem(cfg.key, choice); } catch (e) { /* 私密瀏覽：只在這次有效 */ }
    lang = l;
    return l;
  }
  const load = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = reject; document.head.append(s);
  });

  /** 文字：App 的語言包（有好幾個就依序找）→ 共用名詞；都沒有的回傳 key 本身（看得出漏翻）。函式的值帶參數呼叫 */
  function t(key, ...args) {
    let v;
    for (const a of [...[].concat(cfg.app), COMMON]) if ((v = ((packs[a] || {})[lang] || {})[key]) != null) break;
    return v == null ? key : typeof v === 'function' ? v(...args) : v;
  }
  const htmlLang = (l) => ({ zh: 'zh-Hant' }[l] || l);
  /** 把 data-i18n（文字）、data-i18n-aria、data-i18n-title、data-i18n-ph（placeholder）、data-i18n-content（meta）、data-i18n-html（固定 HTML）換成目前語言 */
  function apply(scope = document) {
    if (scope === document) document.documentElement.lang = htmlLang(lang);
    for (const el of scope.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of scope.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
    for (const el of scope.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
    for (const el of scope.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh);
    for (const el of scope.querySelectorAll('[data-i18n-content]')) el.setAttribute('content', t(el.dataset.i18nContent));   // <meta content>
    for (const el of scope.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);   // 語言包裡的固定 HTML（<code>、<strong>、<a>）；只放自己寫的字串，不放使用者輸入
  }
  /** Service Worker 要快取的語言包（全部語言，離線時也能切換） */
  const cacheList = (app, base = '../i18n/', langs = LANGS) => langs.flatMap(l => files(l, app, base));

  return { LANGS, add, detect, setting, boot, use, t, apply, cacheList, packs, get lang() { return lang; } };
});
