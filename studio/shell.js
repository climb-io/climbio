'use strict';
// Climbio Studio 的共用外殼（首頁、Wall、Crag 載入，放在頁首後面）：步驟列、測試版標示、頁首右上的帳號頭像（登入、登出、版本）。
// 步驟的內容、數字與動作由工作區給；這裡只畫，不碰工作區的狀態。
(function (root) {
  const T = (...a) => root.AppKit.i18n.t(...a);   // 文字在呼叫時才查（語言包載入完才有）
  // 步驟列：list＝[{ id, label, note, on }]，點了呼叫 onPick(id)；各工作區共用的步驟（check）可以不給 label
  function steps(nav, list, onPick) {
    nav.replaceChildren(...list.map((s, i) => {
      const b = document.createElement('button'), n = document.createElement('i'), t = document.createElement('span');
      b.type = 'button'; b.className = 'st-step' + (s.on ? ' on' : ''); b.dataset.step = s.id;
      if (s.on) b.setAttribute('aria-current', 'step');
      n.textContent = i + 1; t.textContent = s.label ?? T({ check: 'stStepCheck' }[s.id]); b.append(n, t);
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
    // 有左側導覽的頁面標在導覽的品牌旁（rail 畫），沒有的標在頁首品牌旁
    const badge = () => { if (document.documentElement.classList.contains('st-railed')) return; for (const b of document.querySelectorAll('.st-brand, .st-topbar > .st-crumb')) b.insertAdjacentHTML('afterend', `<span class="st-env">${ENV_LABEL}</span>`); };
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

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const SHELL = document.currentScript && document.currentScript.src, ROOT = new URL('../', SHELL || location.href).href;   // 網站根目錄（shell.js 在 studio/ 裡）
  const ICON = {
    devices: '<circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>',
    lang: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.2-3.6-8.5S9.6 5.9 12 3.5z"/>',
  };
  /**
   * 頁首右上：跟岩點貓、紅點貓同一個頭像與選單（appkit/account.js；Studio 不登入，是空的頭像）。
   * 選單：我的裝置（studio/devices.js，配對所有 App 共用）、換成另一種語言，最底是條款、隱私與版本。
   * 頁面有還沒存的東西時設 StudioShell.flush（打開我的裝置前先存，送出去的是存好的檔案）
   */
  function menu() {
    const A = root.AppKit, box = el('div', 'st-acct'), btn = el('button', 'ak-account-trigger st-avatar'), face = el('span'), list = el('div', 'ak-account-menu st-menu');
    btn.type = 'button'; btn.setAttribute('aria-haspopup', 'true'); btn.setAttribute('aria-label', T('stMenu')); list.hidden = true;
    A.account.avatar(face, null); btn.append(face);
    box.append(btn, list);
    document.getElementById('top').append(box);
    const row = (icon, label, fn) => {
      const b = el('button', 'st-menu-row');
      b.type = 'button';
      b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[icon]}</svg>`;
      b.append(el('span', '', label));
      b.onclick = async () => { list.hidden = true; try { await fn(); } catch (e) { A.ui.toast(e.code || e.message, { ms: 5000 }); } };
      return b;
    };
    const open = () => {
      const rows = el('div', 'st-menu-rows'), foot = el('div');
      if (typeof RTCPeerConnection === 'function') rows.append(row('devices', T('syncDevices'), async () => (await import(new URL('devices.js', SHELL).href)).openDevices({ flush: root.StudioShell.flush })));
      A.account.footer(foot, { version: VERSION, root: ROOT });
      if (DEV) foot.querySelector('.ak-account-footer-version-row').append(el('span', 'st-env', ENV_LABEL));
      list.replaceChildren(rows, foot);
      list.hidden = false;
    };
    btn.onclick = (e) => { e.stopPropagation(); if (list.hidden) open(); else list.hidden = true; };
    document.addEventListener('click', (e) => { if (!box.contains(e.target)) list.hidden = true; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') list.hidden = true; });
  }

  // 長時間的工作（下載、上傳、轉換）：全螢幕過場，做完才關，中間不能操作（Esc 關不掉，關分頁、重新整理先問）。
  // 首頁、Wall、Crag 共用，所有長時間的工作都用這個（Crag 的發佈另有照片飛走的版本，樣子相同）。
  // const b = busy('從 Google Drive 下載「名稱」'); b.step('下載', 3, 40); b.close();
  // leave：只是載入、沒有東西會丟掉（例如 3D 場景載模型）：不擋導覽、不問「確定離開」，載入中照樣能換到別頁
  function busy(title, { leave = false } = {}) {
    const d = document.createElement('dialog'), t = document.createElement('b'), bar = document.createElement('div'), meta = document.createElement('span'), spin = document.createElement('span');
    d.className = 'st-busy'; d.setAttribute('aria-label', title);
    spin.className = 'ak-spin'; bar.className = 'bar'; bar.append(document.createElement('i'));
    meta.className = 'meta'; meta.setAttribute('role', 'status');
    t.textContent = title;
    d.append(spin, t, bar, meta);
    d.addEventListener('cancel', (e) => e.preventDefault());
    const stay = (e) => { e.preventDefault(); e.returnValue = ''; };
    if (!leave) addEventListener('beforeunload', stay);
    document.body.append(d);
    if (leave) { d.classList.add('st-busy-soft'); d.show(); } else d.showModal();
    // AI 處理的結果（例如偵測到的岩點）：照片壓暗，點一顆一顆亮起來；只用真的資料，系統「減少動態效果」時直接全部顯示
    const pic = document.createElement('canvas');
    pic.className = 'pts'; pic.hidden = true;
    d.insertBefore(pic, t);
    let anim = 0;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    return {
      title(text) { t.textContent = text; },
      step(text, n, total) {
        meta.textContent = total ? `${text} ${n}/${total}` : `${text}…`;
        bar.firstChild.style.width = total ? `${(100 * n) / total}%` : '0%';
      },
      /** image：照片（canvas、圖片或 ImageBitmap，有 width、height）；points：照片像素座標的點 [[x, y]…]。回傳點全部亮完的 Promise */
      show(image, points = []) {
        cancelAnimationFrame(anim);
        const k = Math.min(1, 320 / Math.max(image.width, image.height)), w = Math.round(image.width * k), h = Math.round(image.height * k), r = Math.min(devicePixelRatio || 1, 2);
        Object.assign(pic, { width: w * r, height: h * r, hidden: false });
        Object.assign(pic.style, { width: `${w}px`, height: `${h}px` });
        const g = pic.getContext('2d'), accent = getComputedStyle(d).getPropertyValue('--accent').trim() || '#d4ff4f';
        const draw = (n) => {
          g.setTransform(r, 0, 0, r, 0, 0);
          g.globalAlpha = 1; g.drawImage(image, 0, 0, w, h);
          g.fillStyle = 'rgba(0, 0, 0, .55)'; g.fillRect(0, 0, w, h);
          g.fillStyle = accent;
          for (const [x, y] of points.slice(0, n)) { g.beginPath(); g.arc(x * k, y * k, 2.2, 0, 2 * Math.PI); g.fill(); }
        };
        if (reduced || !points.length) { draw(points.length); return Promise.resolve(); }
        const t0 = performance.now(), ms = Math.min(900, 120 + points.length * 8);
        return new Promise((ok) => {
          const tick = (now) => { const f = Math.min(1, (now - t0) / ms); draw(Math.ceil(points.length * f)); if (f < 1) anim = requestAnimationFrame(tick); else ok(); };
          anim = requestAnimationFrame(tick);
        });
      },
      close() { cancelAnimationFrame(anim); removeEventListener('beforeunload', stay); d.close(); d.remove(); },
    };
  }

  // 檢查、發佈兩步的頁面（各工作區同一種樣子）：工作區給內容與動作，這裡只畫。
  // 發佈清單：rows＝[{ id, name, status, tone（'ok'｜'look'｜''）, thumb(pic)：放縮圖, actions: [{ id, label, primary, onClick }] }]
  function pubList(box, rows, empty) {
    box.replaceChildren(...rows.map(r => {
      const row = el('div', 'st-prow'), pic = el('div', 'pic'), info = el('div', 'info'), acts = el('div', 'acts');
      if (r.id) row.dataset.id = r.id;
      info.append(el('div', 'nm', r.name), el('div', 'st ' + (r.tone || ''), r.status || ''));
      for (const a of r.actions || []) {
        const b = el('button', 'btn' + (a.primary ? ' primary' : ''), a.label);
        b.type = 'button'; if (a.id) b.id = a.id; b.onclick = a.onClick;
        acts.append(b);
      }
      row.append(pic, info, acts);
      if (r.thumb) r.thumb(pic);
      return row;
    }));
    if (!rows.length && empty) box.append(el('div', 'st-empty', empty));
  }
  // 檢查清單：items＝[{ title, note, tone（'bad'｜'look'）, onClick }]
  function checks(box, items) {
    box.replaceChildren(...items.map(it => {
      const b = el(it.onClick ? 'button' : 'div', 'st-check ' + (it.tone || 'look'));
      if (it.onClick) { b.type = 'button'; b.onclick = it.onClick; }
      b.append(el('span', 'dot'), el('b', '', it.title));
      if (it.note) b.append(el('small', '', it.note));
      return b;
    }));
    if (!items.length) box.append(el('div', 'st-empty ok', T('stAllChecked')));
  }

  // 發佈狀態（發佈清單一列的 status、tone）：version 是發佈到第幾版（沒有是 0），stale 是之後有沒有改
  const pubStatus = (version, stale) => version ? { status: T(stale ? 'stPubStale' : 'stPubAt', version), tone: stale ? 'look' : 'ok' } : { status: T('stPubNone'), tone: '' };

  // ── 統一導覽（每個 Studio 頁面同一條，Atlas 那種左側導覽；手機是底部一排）：Studio 首頁、交給 AI（首頁教人請 AI 代理做），三條線（岩館、岩場、3D）。
  // 要人判斷的題目由代理在 AI 對話裡問（docs/studio-work.md），Studio 沒有收件匣
  const RAIL = [
    ['home', '', 'stRailHome', '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>'],
    ['ai', '#ai', 'stAi', '<path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8z"/><path d="M18.5 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>'],   // 交給 AI：首頁教人設定代理、交代任務（Studio 沒有給人手動新增的入口）
    ['gym', 'wall/', 'stGym', '<path d="M4 20V4h16v16z"/><circle cx="9" cy="9" r="1.6"/><circle cx="15" cy="11" r="1.6"/><circle cx="10" cy="15.5" r="1.6"/>'],
    ['crag', 'crag/', 'stCrag', '<path d="M3 20l6-12 4 6 3-4 5 10z"/>'],
    ['scene', 'scene/', 'st3d', '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>'],
  ];
  function rail() {
    if (document.querySelector('.st-rail') || !document.body) return;
    const studio = new URL('studio/', ROOT).href, sub = location.href.replace(/[?#].*$/, '').replace(/index\.html$/, '').slice(studio.length).split('/')[0];
    // 現在在哪一條：照頁面的資料夾（3D 牆也算 3D；路線書轉換來的也是岩場）
    const current = { '': 'home', wall: 'gym', crag: 'crag', scene: 'scene', wall3d: 'scene' }[sub];
    const nav = el('nav', 'st-rail');
    nav.setAttribute('aria-label', 'Climbio Studio');
    const brand = el('a', 'st-rail-brand');
    brand.href = studio;
    brand.innerHTML = `<img src="${new URL('icons/brand/climbio-mark.svg', ROOT).href}" alt=""><span>Climbio <em>Studio</em></span>`;
    brand.setAttribute('aria-label', 'Climbio Studio');
    if (DEV) brand.append(el('span', 'st-env', ENV_LABEL));
    nav.append(brand);
    for (const [id, path, key, icon] of RAIL) {
      const a = el('a', 'st-rail-item');
      a.href = path.startsWith('#') ? studio + path : studio + path;
      a.dataset.rail = id;
      a.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>`;
      a.append(el('span', '', T(key)));
      if (id === current) a.setAttribute('aria-current', 'page');
      nav.append(a);
    }
    // 最下面：網站的其他地方（文件、Lab、Climbio 首頁）
    const foot = el('div', 'st-rail-foot');
    for (const [href, key, icon] of [['guides/', 'stRailDocs', '<path d="M5 4h14v16H5z"/><path d="M9 8h6M9 12h6M9 16h4"/>'], ['lab/', 'stRailLab', '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/>'], ['', 'stRailSite', '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.2-3.6-8.5S9.6 5.9 12 3.5z"/>']]) {
      const a = el('a', 'st-rail-item st-rail-small');
      a.href = new URL(href, ROOT).href;
      a.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>`;
      a.append(el('span', '', T(key)));
      foot.append(a);
    }
    nav.append(foot);
    document.body.prepend(nav);
    document.documentElement.classList.add('st-railed');
    crumb(current);
  }
  /**
   * 頁首的麵包屑（Atlas 那種「工具 / 專案」）：工作區的標籤換成這條線的圖示和名稱，後面接「/」和專案名稱；
   * 首頁的頁首（.st-topbar）本來就是麵包屑，不用換
   */
  function crumb(current) {
    const ws = document.querySelector('#top > .st-ws');
    const line = RAIL.find(r => r[0] === current);
    if (!ws || !line) return;
    ws.classList.add('st-crumb');
    ws.innerHTML = `<i><svg viewBox="0 0 24 24" aria-hidden="true">${line[3]}</svg></i>`;
    ws.append(el('span', '', T(line[2])));
    ws.after(el('span', 'st-crumb-sep', '/'));
  }
  // 一執行就畫（shell.js 在 body 最後載入，不等整頁的程式跑完），換頁時導覽不會晚一步才出現
  if (document.body) rail(); else document.addEventListener('DOMContentLoaded', rail);
  // Service Worker：從哪一頁進來都註冊（以前只有首頁註冊，直接打開工作頁的不會有快取）
  if ('serviceWorker' in navigator && SHELL) navigator.serviceWorker.register(new URL('sw.js', SHELL).href).catch(e => console.warn('Service Worker', e));
  // 換頁像同一個 App：游標停在導覽上（手機是按下去的那一刻）就在背景把那一頁整個開好（prerender），點下去直接換上、導覽列不動（view transition）。
  // 只預先開 Studio 自己的頁面（文件、Lab、網站首頁、公開的 /p/ 照常點了才載入）；不支援 Speculation Rules 的瀏覽器照常點了才載入
  if (HTMLScriptElement.supports?.('speculationrules')) {
    const s = document.createElement('script');
    s.type = 'speculationrules';
    s.textContent = JSON.stringify({ prerender: [{ where: { and: [{ selector_matches: '.st-rail a, .st-lib a' }, { href_matches: new URL('studio/*', ROOT).pathname }] }, eagerness: 'moderate' }] });
    document.head.append(s);
  }

  root.StudioShell = { steps, menu, busy, pubList, checks, pubStatus, rail, flush: async () => {} };
})(globalThis);
