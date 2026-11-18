// AppKit account: 岩點貓與紅點貓共用的右上頭像、統計摘要和個人資料版面。
// App 僅提供帳號與統計資料；登入、備份、路線計數和選單返回由各 App 負責。
// 不依賴 React，也不儲存任何使用者資料。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.AppKit || (root.AppKit = {})).account = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const node = (tag, className, value) => {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (value !== undefined) e.textContent = String(value);
    return e;
  };
  function avatar(target, user) {
    if (!target) return;
    target.classList.add('ak-account-avatar');
    target.classList.toggle('ak-account-avatar-empty', !user);
    target.classList.toggle('empty', !user);
    target.replaceChildren();
    if (!user) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      svg.innerHTML = '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c.8-3.6 3.8-5.8 7.5-5.8s6.7 2.2 7.5 5.8"/>';
      target.append(svg);
      return;
    }
    const label = String(user.name || user.email || '?');
    target.textContent = Array.from(label)[0].toUpperCase();
    if (user.photo) {
      const img = new Image();
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.onload = () => { if (target.isConnected && target.textContent === Array.from(label)[0].toUpperCase()) target.replaceChildren(img); };
      img.src = user.photo;
    }
  }
  // 數字由 App 算好再填，永不把空資料偽裝成 0。
  function summary(target, values) {
    if (!target) return;
    for (const field of target.querySelectorAll('[data-ak-stat]')) {
      const key = field.dataset.akStat;
      field.textContent = Object.hasOwn(values, key) ? String(values[key]) : '—';
    }
  }
  /** 一排統計方塊（兩個 App 的個人資料用同一個）：[{ label, value }] → <div class="ak-account-details-stats"> */
  function stats(metrics = []) {
    const row = node('div', 'ak-account-details-stats');
    for (const { label, value } of metrics) {
      const item = node('div', 'ak-account-details-stat');
      item.append(node('b', '', value), node('small', '', label));
      row.append(item);
    }
    return row;
  }
  function detail({ title = '個人資料', metrics = [], note = '', groups = [] } = {}) {
    const wrap = node('div', 'ak-account-details');
    wrap.append(node('h2', 'ak-account-details-title', title));
    if (metrics.length) wrap.append(stats(metrics));
    if (note) wrap.append(node('p', 'ak-account-details-note', note));
    for (const group of groups) {
      const section = node('section', 'ak-account-details-section');
      if (group.title) section.append(node('h3', '', group.title));
      if (group.text) section.append(node('p', '', group.text));
      if (group.metrics) section.append(stats(group.metrics));
      wrap.append(section);
    }
    return wrap;
  }

  /**
   * 共用帳號選單底部：條款、隱私、版本。
   * sourcesHref 只給有獨立來源頁的產品；versionButton 讓原有版本檢查事件可沿用。
   */
  function footer(target, { version = '', sourcesHref = '', versionButton = false, showUpdateStatus = false } = {}) {
    if (!target) return null;
    target.classList.add('ak-account-footer');
    const links = node('div', 'ak-account-footer-links');
    function link(href, key, fallback) {
      const a = node('a', '', fallback);
      a.href = href;
      a.dataset.i18n = key;
      const t = typeof globalThis !== 'undefined' && globalThis.AppKit?.i18n?.t(key);
      if (typeof t === 'string' && t !== key) a.textContent = t;
      links.append(a);
    }
    if (sourcesHref) link(sourcesHref, 'sources', '資料來源與授權');
    link('../privacy.html', 'privacy', '隱私權政策');
    link('../terms.html', 'terms', '服務條款');
    const versionLabel = node(versionButton ? 'button' : 'span', 'ak-account-footer-version',
      version ? `Climbio ${String(version).replace(/^climbio-/, '')}` : 'Climbio');
    if (versionButton) { versionLabel.type = 'button'; versionLabel.id = 'versionBtn'; }
    const versionRow = node('div', 'ak-account-footer-version-row');
    versionRow.append(versionLabel);
    target.replaceChildren(links, versionRow);
    let status = null;
    if (showUpdateStatus) {
      status = node('small', 'ak-account-footer-status');
      status.id = 'updInfo';
      target.append(status);
    }
    return { version: versionLabel, status };
  }
  return { avatar, summary, stats, detail, footer };
});
