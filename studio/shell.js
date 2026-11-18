'use strict';
// Climbio Studio 的共用外殼（首頁、Wall、Crag 載入，放在頁首後面）：步驟列、測試版標示、頁首右上的帳號頭像（登入、登出、版本）。
// 步驟的內容、數字與動作由工作區給；這裡只畫，不碰工作區的狀態。
(function (root) {
  const T = (...a) => root.AppKit.i18n.t(...a);   // 文字在呼叫時才查（語言包載入完才有）
  // 步驟列：list＝[{ id, label, note, on }]，點了呼叫 onPick(id)
  function steps(nav, list, onPick) {
    nav.replaceChildren(...list.map((s, i) => {
      const b = document.createElement('button'), n = document.createElement('i'), t = document.createElement('span');
      b.type = 'button'; b.className = 'st-step' + (s.on ? ' on' : ''); b.dataset.step = s.id;
      if (s.on) b.setAttribute('aria-current', 'step');
      n.textContent = i + 1; t.textContent = s.label; b.append(n, t);
      if (s.note) { const m = document.createElement('small'); m.textContent = s.note; b.append(m); }
      b.onclick = () => onPick(s.id);
      return b;
    }));
  }

  // 測試版（開發版網站、本機）：品牌旁邊標 Beta，分頁標題加「· Beta」（工作區換標題時也補上）。跟岩點貓（js/boot.js）同一組網址
  const DEV = ['climbio-dev.web.app', 'climbio-dev.firebaseapp.com', 'climbio-eric.web.app', 'localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const ENV_LABEL = location.hostname === 'climbio-eric.web.app' ? 'Beta · Eric' : 'Beta';   // Eric 的平行開發版另外標出來，跟開發版分得出來
  const VERSION = String(root.CLIMBIO_VERSION || '').replace(/^climbio-/, '');   // ../version.js，部署時寫入，例如 v1391
  if (DEV) {
    document.documentElement.classList.add('env-dev');
    const badge = () => { for (const b of document.querySelectorAll('.st-brand')) b.insertAdjacentHTML('afterend', `<span class="st-env">${ENV_LABEL}</span>`); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', badge); else badge();   // Crag 的 shell.js 在頁首前面載入
    const mark = () => { if (!document.title.endsWith(' · Beta')) document.title += ' · Beta'; };
    mark();
    new MutationObserver(mark).observe(document.querySelector('title'), { childList: true });
    // 加到主畫面的名稱：開發版、本機叫「Studio Dev」，climbio-eric 叫「Studio Eric」（正式版不動，還是 manifest.webmanifest 的「Studio」）
    const eric = location.hostname === 'climbio-eric.web.app';
    const link = document.querySelector('link[rel="manifest"]');
    if (link) link.setAttribute('href', link.getAttribute('href').replace(/manifest\.webmanifest$/, eric ? 'manifest-eric.webmanifest' : 'manifest-dev.webmanifest'));
    let apple = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (!apple) { apple = document.createElement('meta'); apple.name = 'apple-mobile-web-app-title'; document.head.append(apple); }
    apple.content = eric ? 'Studio Eric' : 'Studio Dev';
  }

  const DOTS = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>';
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  /**
   * 頁首右上的選單（Studio 不登入）：換成另一種語言、最底是版本。
   */
  function menu() {
    const box = el('div', 'st-acct'), btn = el('button', 'st-avatar'), list = el('div', 'st-menu');
    btn.type = 'button'; btn.setAttribute('aria-haspopup', 'true'); list.hidden = true;
    btn.setAttribute('aria-label', T('stMenu')); btn.innerHTML = DOTS;
    box.append(btn, list);
    document.getElementById('top').append(box);
    const act = (label, fn) => {
      const b = el('button', 'st-menu-row', label);
      b.type = 'button';
      b.onclick = async () => { list.hidden = true; try { await fn(); } catch (e) { AppKit.ui.toast(e.code || e.message, { ms: 5000 }); } };
      return b;
    };
    const open = () => {
      // 語言：顯示另一種語言的名字（名字不進語言包），換完重新載入
      const [other, otherName] = AppKit.i18n.lang === 'en' ? ['zh', '繁體中文'] : ['en', 'English'];
      const foot = el('div', 'st-ver', `Climbio Studio ${VERSION}`);
      if (DEV) foot.append(el('span', 'st-env', ENV_LABEL));
      list.replaceChildren(act(otherName, async () => { await AppKit.i18n.use(other); location.reload(); }), foot);
      list.hidden = false;
    };
    btn.onclick = (e) => { e.stopPropagation(); if (list.hidden) open(); else list.hidden = true; };
    document.addEventListener('click', (e) => { if (!box.contains(e.target)) list.hidden = true; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') list.hidden = true; });
  }

  // 長時間的工作（下載、上傳、轉換）：全螢幕過場，做完才關，中間不能操作（Esc 關不掉，關分頁、重新整理先問）。
  // 首頁、Wall、Crag 共用，所有長時間的工作都用這個（Crag 的發佈另有照片飛走的版本，樣子相同）。
  // const b = busy('從 Google Drive 下載「名稱」'); b.step('下載', 3, 40); b.close();
  function busy(title) {
    const d = document.createElement('dialog'), t = document.createElement('b'), bar = document.createElement('div'), meta = document.createElement('span'), spin = document.createElement('span');
    d.className = 'st-busy'; d.setAttribute('aria-label', title);
    spin.className = 'ak-spin'; bar.className = 'bar'; bar.append(document.createElement('i'));
    meta.className = 'meta'; meta.setAttribute('role', 'status');
    t.textContent = title;
    d.append(spin, t, bar, meta);
    d.addEventListener('cancel', (e) => e.preventDefault());
    const stay = (e) => { e.preventDefault(); e.returnValue = ''; };
    addEventListener('beforeunload', stay);
    document.body.append(d);
    d.showModal();
    return {
      title(text) { t.textContent = text; },
      step(text, n, total) {
        meta.textContent = total ? `${text} ${n}/${total}` : `${text}…`;
        bar.firstChild.style.width = total ? `${(100 * n) / total}%` : '0%';
      },
      close() { removeEventListener('beforeunload', stay); d.close(); d.remove(); },
    };
  }

  root.StudioShell = { steps, menu, busy };
})(globalThis);
