// 岩館、岩場兩條線自己的頁面：這條線的作品清單。新的作品由 AI 代理做（首頁的「交給 AI」），這裡沒有匯入的入口。
//   進行中：這台記得的專案（StudioStore.recent），只列這條線的；點了打開（資料夾的授權在點擊時要回來）。
//   已發佈：開放資料集裡這條線的作品——岩館讀公開牆的目錄（climbio/walls 的 walls.jsonl），岩場讀公開專案清單（Backend.listGuidebooks）。
//           讀不到（離線、沒接後端）就不顯示這一段，不擋進行中的。上次讀到的存在 localStorage，先畫它、讀到新的再換（換頁回來不會空一下）。
//   路線書轉換來的岩場也是岩場，列在岩場、標「路線書」：進行中的看專案的 book（轉換時記的）；已發佈的看岩場目錄（climbio/crags 的 crags.jsonl）
//           裡帶原始檔（source）的，同一本的任何一版是就算（跟「轉換路線書」說明頁同一條規則）。
//   都沒有：一句說明＋「交給 AI」（回首頁看怎麼請 AI 代理做）。
// StudioLibrary.render(容器, { line: 'gym'|'crag', open(專案紀錄) })；用到 StudioStore、AppKit.i18n（studio 語言包）。
(function (root) {
  'use strict';
  const WALLS = 'https://huggingface.co/datasets/climbio/walls/resolve/main/', CRAGS = 'https://huggingface.co/datasets/climbio/crags/resolve/main/';
  const ICON = {
    gym: '<path d="M4 20V4h16v16z"/><circle cx="9" cy="9" r="1.6"/><circle cx="15" cy="11" r="1.6"/><circle cx="10" cy="15.5" r="1.6"/>',
    crag: '<path d="M3 20l6-12 4 6 3-4 5 10z"/>',
  };
  const T = (...a) => root.AppKit.i18n.t(...a);
  const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter(k => k != null)); return e; };
  const day = (t) => new Intl.DateTimeFormat(root.AppKit.i18n.lang === 'en' ? 'en' : 'zh-Hant', { dateStyle: 'medium' }).format(t);

  /** 這條線進行中的專案 */
  const mine = (r, line) => r.ws === (line === 'gym' ? 'gym' : 'crag');

  /** 已發佈的作品 → [{ name, sub, t, href, thumb? }]（新到舊）；讀不到回 null */
  async function published(line) {
    try {
      if (line === 'gym') {
        const res = await fetch(`${WALLS}walls.jsonl`, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) return null;
        const rows = (await res.text()).split('\n').filter(Boolean).map(l => JSON.parse(l));
        return rows.sort((a, b) => b.t - a.t).map(w => ({ name: w.name || T('stUntitled'), sub: [w.gym, T('stLibHolds', w.holds)].filter(Boolean).join(' · '), t: w.t, href: `${new URL('wall/', base()).href}#r=${w.id}` }));
      }
      if (line === 'crag' && root.Backend?.listGuidebooks) {
        const [rows, books] = await Promise.all([root.Backend.listGuidebooks(), converted()]);
        const isBook = (p) => [p.id, p.root, ...(p.others || []).map(o => o.id)].some(id => books.has(id));
        // 點了進編輯（不是紅點貓的分享頁）：這本書所有版本的 id 用來找這台已有的專案，沒有就匯入最新的一版（用開放資料集的網址，每一版都讀得到）
        return rows.map(p => {
          const all = [p, ...(p.others || [])], last = all.reduce((a, b) => ((b.t || 0) > (a.t || 0) ? b : a));
          return { name: p.name || T('stUntitled'), sub: [isBook(p) && T('stBook'), p.versions > 1 && T('stLibVersions', p.versions)].filter(Boolean).join(' · '), t: last.t, ids: [...new Set([p.root, ...all.map(x => x.id)].filter(Boolean))], entry: last.url || new URL(`p/${last.id}/index.json`, new URL('../', base())).href, thumb: p.thumb || p.preview };
        }).sort((a, b) => b.t - a.t);
      }
    } catch (e) { console.warn('已發佈的清單讀不到', e); }
    return null;
  }
  /** 路線書轉換來的岩場（岩場目錄裡帶原始檔的）：id 的 Set；讀不到就當沒有 */
  async function converted() {
    try {
      const res = await fetch(`${CRAGS}crags.jsonl`, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) return new Set();
      return new Set((await res.text()).split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.source).map(r => r.id));
    } catch { return new Set(); }
  }
  /** Studio 的根網址（studio/） */
  const base = () => new URL(location.href.replace(/(studio\/).*$/, '$1'));

  function card({ icon, name, sub, thumb, href, onClick }) {
    const fig = el('i', { className: 'lib-icon', ariaHidden: 'true' });
    fig.innerHTML = `<svg viewBox="0 0 24 24">${icon}</svg>`;
    // 縮圖在開放資料集：頁面的 CSP 不讓 <img> 直接讀別的網域，用 fetch（connect-src 允許）拿成 blob 再換上；讀不到就留圖示
    if (thumb) fetch(thumb).then(r => (r.ok ? r.blob() : null)).then(b => { if (b) fig.replaceWith(el('img', { className: 'lib-thumb', src: URL.createObjectURL(b), alt: '' })); }).catch(() => {});
    const body = [fig, el('b', { textContent: name }), el('small', { textContent: sub })];
    const a = href ? el('a', { className: 'lib-card', href }, ...body) : el('button', { type: 'button', className: 'lib-card', onclick: onClick }, ...body);
    // 同一頁只換 #（岩館頁打開公開牆的 #r=）：頁面只在載入時看網址，換好再重新載入
    if (href && new URL(href, location.href).pathname === location.pathname) a.onclick = () => setTimeout(() => location.reload(), 0);
    return el('li', {}, a);
  }

  async function render(host, { line, open }) {
    const SS = root.StudioStore, ws = line === 'gym' ? 'gym' : 'crag';
    host.dataset.studioWs = ws;
    const head = el('header', { className: 'lib-head' }, el('h1', { textContent: T(line === 'gym' ? 'stGym' : 'stCrag') }), el('p', { textContent: T(`stLibIntro_${line}`) }));
    const going = el('section', { className: 'lib-sec', hidden: true }, el('h2', { textContent: T('stLibInProgress') }), el('ul', { className: 'lib-list' }));
    const done = el('section', { className: 'lib-sec', hidden: true }, el('h2', { textContent: T('stLibPublished') }), el('ul', { className: 'lib-list' }));
    const add = el('a', { className: 'btn primary', href: new URL('#ai', base()).href, textContent: T('stAi') });   // 新的作品由 AI 代理做：連到首頁的「交給 AI」
    const empty = el('div', { className: 'lib-empty', hidden: true }, el('p', { textContent: T(`stLibEmpty_${line}`) }), add);
    host.replaceChildren(head, going, done, empty);

    const rows = (await SS.recent().catch(() => [])).filter(r => (r.local || SS.canPickDir) && mine(r, line));
    going.querySelector('ul').replaceChildren(...rows.map(r => card({ icon: ICON[line], name: r.name || T('stUntitled'), sub: [r.book && T('stBook'), r.local ? T('stThisDevice') : r.dir?.name, day(r.at)].filter(Boolean).join(' · '), onClick: () => open(r) })));
    going.hidden = !rows.length;
    empty.hidden = !!rows.length;
    // 已發佈的清單要問網路（開放資料集、後端）：先畫上次存的，換頁回來不會空一下；問到了再換成新的
    const KEY = `climbio.studio.published.${line}`;
    const show = (pub) => {
      if (!pub?.length) return;
      const sig = JSON.stringify(pub);
      if (done.dataset.sig === sig) return;   // 跟畫著的一樣：不重畫（縮圖不重抓）
      done.dataset.sig = sig;
      done.querySelector('ul').replaceChildren(...pub.map(p => card({ icon: ICON[line], name: p.name, sub: [p.sub, day(p.t)].filter(Boolean).join(' · '), thumb: p.thumb, href: p.href, onClick: p.ids && (() => openPublished(p)) })));
      done.hidden = false;
      empty.hidden = true;
    };
    try { show(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch { /* 私密瀏覽、壞掉的紀錄：等網路 */ }
    const pub = await published(line);
    if (!pub) return;
    try { localStorage.setItem(KEY, JSON.stringify(pub)); } catch { /* 存不下：下次再問網路 */ }
    show(pub);
  }

  /** 這台有沒有這本書（任何一版的 id）的岩場專案：自己發佈的、之前匯入的；有就回專案 id（最近用的那個） */
  async function localOf(ids) {
    const SS = root.StudioStore, idOf = (u) => /\/(?:p|crags)\/([0-9a-z]{16})\//.exec(u || '')?.[1];   // 網站的 /p/<id>/ 或開放資料集的 crags/<id>/
    for (const e of await SS.recent().catch(() => [])) {
      if (e.ws !== 'crag' || !(await SS.granted(e))) continue;
      const book = await SS.dirOf(e).then(d => SS.readJson(d, 'index.json')).catch(() => null);
      const pub = book?.props?.['author:publish'] || {};
      const its = [pub.project, pub.root, book?.props?.root, idOf(book?.derivedFrom?.url), idOf(e.src)].filter(Boolean);
      if (its.some(id => ids.includes(id))) return e.id;
    }
    return '';
  }
  /** 已發佈的岩場進編輯：這台已經有這本書的專案就打開它；沒有就匯入最新的一版成新專案（Crag 的 #site=，同一本不會匯入兩次） */
  async function openPublished(p) {
    const crag = new URL('crag/', base()).href, have = await localOf(p.ids);
    location.href = have ? `${crag}#${have}` : `${crag}#site=${encodeURIComponent(p.entry)}`;
  }

  /** 打開一個進行中的專案：資料夾的授權只能在點擊時要回來；找不到資料夾就從清單拿掉 */
  async function openRecent(r, toast) {
    const SS = root.StudioStore;
    try {
      if (!(await SS.granted(r)) && await r.dir.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error(T('stNoFolderAccess'));
      location.href = new URL(`${r.ws === 'gym' ? 'wall' : 'crag'}/#${r.id}`, base()).href;
    } catch (e) { toast(e.name === 'NotFoundError' ? T('stFolderMissing') : e.message); if (e.name === 'NotFoundError') await SS.forget(r.id); }
  }

  root.StudioLibrary = { render, openRecent, mine, localOf };
})(globalThis);
