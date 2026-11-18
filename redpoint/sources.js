// 資料來源與授權頁：語言跟紅點貓同一個設定（climbio.lang），文字在 i18n/redpoint；有連結、粗體的段落放 HTML（語言包自己的字串）。
// English: sources & licenses page: same language setting as the app; strings from the Redpoint pack.
(function () {
  const t = (k) => AppKit.i18n.t(k);
  document.title = t('srcDocTitle');
  document.querySelector('.pg-top nav').setAttribute('aria-label', t('srcNavAria'));
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
})();
