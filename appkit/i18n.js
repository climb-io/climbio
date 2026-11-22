// AppKit i18n：語言包載入。每個 App 一組語言包（i18n/<app>/<語言>.js），共用名詞一組（i18n/common/<語言>.js）；
// 依瀏覽器語言只載入一種語言，沒有手動選擇。語言包檔案由 App 的 Service Worker 一起快取，離線也能切換。
// 瀏覽器用 <script> 載入，掛在全域 AppKit.i18n；Node 用 require。
// English: AppKit i18n: loads one language at a time — the app's pack (i18n/<app>/<lang>.js) plus shared terms (i18n/common/<lang>.js).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.AppKit || (root.AppKit = {})).i18n = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const LANGS = ['zh', 'zh-CN', 'en', 'ja', 'fr', 'ko', 'es', 'de'];
  const COMMON = 'common';
  const packs = {};   // packs[app][語言] = { key: 文字或函式 }
  const cfg = { app: COMMON, langs: LANGS, base: '../i18n/' };
  let lang = 'zh';
  // 頁面載入 i18n.js 的網址帶版本（?v=…，部署時寫入）：語言包用同一個後綴，跟頁面同一版（Service Worker 裡、本機開發沒有）
  const vq = ((typeof document !== 'undefined' && document.currentScript && document.currentScript.src || '').match(/\?v=[^&#]*/) || [''])[0];

  /** 語言包檔案呼叫：AppKit.i18n.add('hold', 'zh', { … }) */
  function add(app, l, dict) { (packs[app] || (packs[app] = {}))[l] = dict; }

  /** 依瀏覽器語言：zh 開頭是中文，其他有語言包的照語言碼，沒有的英文（只有中文的 App 一律中文） */
  function detect(langs = cfg.langs, nav = typeof navigator === 'undefined' ? '' : (navigator.languages && navigator.languages[0]) || navigator.language || '') {
    if (/^zh[-_](?:hans|cn|sg)(?:$|[-_])/i.test(nav) && langs.includes('zh-CN')) return 'zh-CN';
    if (/^zh/i.test(nav) && langs.includes('zh')) return 'zh';
    return langs.find(l => l !== 'zh' && l !== 'zh-CN' && nav.toLowerCase().startsWith(l)) || (langs.includes('en') ? 'en' : langs[0]);
  }
  const appsOf = (app) => [...new Set([COMMON, ...[].concat(app)])];   // app 可以是一個或一串語言包資料夾名（例如 Studio 的共用包加工作區的包）
  const files = (l, app = cfg.app, base = cfg.base) => appsOf(app).map(a => `${base}${a}/${l}.js${vq}`);

  /**
   * 開頁時在 <head> 同步呼叫：記下 App 的設定，決定語言，用 document.write 讓語言包在主程式之前執行完。
   * app：語言包資料夾名（一個，或一串：依序找 key）；langs：這個 App 有的語言；base：i18n/ 的相對網址
   */
  function boot({ app, langs = LANGS, base = '../i18n/' }) {
    Object.assign(cfg, { app: [].concat(app), langs, base });
    lang = detect();
    document.documentElement.lang = htmlLang(lang);
    // 先寫 preload 再寫 script：頁面有 meta CSP 時瀏覽器不預先掃描，不然語言包會一個下載完才抓下一個
    const list = files(lang);
    document.write(list.map(f => `<link rel="preload" as="script" href="${f}">`).join('') + list.map(f => `<script src="${f}"><\/script>`).join(''));
    return lang;
  }

  /** 文字：App 的語言包（有好幾個就依序找）→ 共用名詞；都沒有的回傳 key 本身（看得出漏翻）。函式的值帶參數呼叫 */
  function t(key, ...args) {
    let v;
    for (const a of [...[].concat(cfg.app), COMMON]) if ((v = ((packs[a] || {})[lang] || {})[key]) != null) break;
    return v == null ? key : typeof v === 'function' ? v(...args) : v;
  }
  const htmlLang = (l) => ({ zh: 'zh-Hant', 'zh-CN': 'zh-Hans' }[l] || l);
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

  // 使用說明依 App 當前語言開啟各自的靜態頁面（簡體使用 zh-cn 路徑）。
  const guideUrl = (file) => `../${lang === 'zh' ? '' : lang === 'zh-CN' ? 'zh-cn/' : `${lang}/`}guides/${file}`;
  return { LANGS, add, detect, boot, t, apply, cacheList, guideUrl, packs, get lang() { return lang; } };
});
