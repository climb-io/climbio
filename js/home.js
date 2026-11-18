// 首頁：選單與長按卡片的動作、右下「＋」、繼續爬、找牆、兩欄小卡。
// 依序載入（app → home → profile → add-wall → edit → wall → sync → draw → export → mobile → tour → main），共用同一個全域範圍；載入當下只能用到前面檔案宣告的東西，
// 事件處理、計時器等之後才執行的程式不受限制。啟動與事件綁定放在最後的 main.js。
// English: Home screen: menus and long-press card actions, the + button, continue climbing, find a wall, card grid.
'use strict';
  // ---------- 首頁「⋯」選單、下方選單（語言、攀爬紀錄、個人資料、牆面、路線、岩館）：打開時多一層紀錄，返回鍵先關掉選單 ----------
  // 點外面、取消、選好了：關掉並退回這一層；接著開別的頁面或對話框的（拍照、接收分享、使用說明…）只關選單，
  // 留下的這一層之後返回時跳過。選單換選單（例如「⋯」→ 語言）共用同一層
  const LAYERS = ['homeMenu', 'gradeSheet', 'wallSheet', 'routeSheet', 'gymSheet', 'addSheet', 'sideSheet'];
  const menuLayer = () => !!(history.state && history.state.s === 'menu');
  function openLayer(id) {
    $(id).hidden = false;
    if (!menuLayer()) history.pushState({ s: 'menu' }, '');
  }
  function toggleHomeMenu() {
    if (!$('homeMenu').hidden) return dismissMenu();
    const dev = deviceId(), nPaired = AppKit.nearby.paired('hold');
    $('hmSyncVal').textContent = nPaired ? t('syncPaired').replace('{n}', nPaired) : '';
    $('statsBtn').hidden = true;   // 沒有紀錄就不顯示
    loadTotals().then(v => {
      if (dev !== deviceId()) return;
      AppKit.account.summary($('statsBtn'), v);
      $('statsBtn').hidden = !(v.walls || v.routes || v.set);
    }, () => {});
    renderAccount();
    $('gradeSysVal').textContent = t(GRADE_SYS_LABEL[gradeSys()]);
    openLayer('homeMenu');
  }
  function dismissMenu() {
    for (const id of LAYERS) $(id).hidden = true;
    closeCardMenu();
    if (menuLayer()) history.back();
  }
  // 蓋在畫面上的對話框、彈窗（不在 LAYERS 裡的）：開著時多一層返回紀錄，返回只關最上面那個，底下的畫面不動（不然首頁按返回會直接離開 App）。
  // onBack：被返回關掉時做的事（藏起來、回傳取消）。自己關（按鈕、點外面）用 closeOverlay：退掉那一層（連同疊在上面的），
  // 等退完才 resolve，接著要開新畫面的放在 then 裡（不然新推的一層會被這次的返回退掉）
  // 實作在 appkit/backstack.js（紅點貓共用）；這裡只指定這個 App 的 history state
  const openOverlay = (id, onBack) => AppKit.backstack.open(id, onBack, { s: 'dlg' });
  const closeOverlay = (id) => AppKit.backstack.close(id);
  // 返回時（js/wall.js 的 popstate）先問這裡：是 closeOverlay 自己退的、或返回關掉最上面的對話框，回傳 true，不再當成換頁
  const overlayBack = () => AppKit.backstack.handle();
  // 長按卡片的選單：動作（只有圖示的圓鈕）直接排在被按的那張卡片裡（卡片變暗、螢光綠外框，其他畫面不動、照樣能捲）；點外面或卡片的空白處收起來。
  // 動作就是那份選單（id）裡看得到的按鈕：按了轉按原本的按鈕，選單本身不打開。開著時多一層返回紀錄，返回手勢先收起來
  let cardMenu = null;
  function openCardMenu(id, card) {
    closeCardMenu();
    const acts = document.createElement('span'); acts.className = 'card-acts';
    for (const src of $(id).querySelectorAll('.sheet-btn:not([hidden])')) {
      const b = document.createElement('span'); b.className = 'card-act' + (src.classList.contains('danger') ? ' danger' : ''); b.setAttribute('role', 'button');
      b.append(src.querySelector('svg').cloneNode(true)); b.setAttribute('aria-label', src.lastChild.textContent);   // 只放圖示
      b.onclick = () => src.click();
      acts.append(b);
    }
    acts.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); if (e.target === acts) dismissMenu(); });   // 卡片本身是按鈕：不能打開卡片
    card.classList.add('acting'); card.append(acts);
    cardMenu = { card, acts };
    if (!menuLayer()) history.pushState({ s: 'menu' }, '');
    if (reduceMotion()) return;
    acts.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
    [...acts.children].forEach((b, i) => b.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'none' }],
      { duration: 320, delay: 30 + i * 40, easing: 'cubic-bezier(.34, 1.56, .64, 1)', fill: 'backwards' }));
  }
  function closeCardMenu() {
    const m = cardMenu; if (!m) return;
    cardMenu = null;
    m.acts.remove(); m.card.classList.remove('acting');
  }
  // 按到卡片外面：只收起來，這一下不觸發底下的東西（長按放開的那一下不算：它沒有新的按下）
  let swallowClick = false;
  document.addEventListener('pointerdown', (e) => { swallowClick = false; if (cardMenu && !cardMenu.acts.contains(e.target)) { swallowClick = true; dismissMenu(); } }, true);
  document.addEventListener('click', (e) => { if (swallowClick) { swallowClick = false; e.stopPropagation(); e.preventDefault(); } }, true);

  // ---------- 右下「＋」（首頁、牆面頁、看路線圖共用）----------
  // 按了轉成「×」，功能沿著 1/4 圓彈出來（正上方到正左方，看得到的平均排開，按鈕多就排遠一點）。
  // set：要顯示的那一組（沒寫 data-set 的是 'main'）、'' 收起來；同時只開一個；開著時點外面收起來
  function radial(wrap, set = '') {
    if (typeof wrap === 'string') wrap = $(wrap);
    if ((wrap.dataset.open || '') === set) return;
    if (set) for (const o of document.querySelectorAll('.rfab[data-open]:not([data-open=""])')) if (o !== wrap) radial(o, '');
    wrap.dataset.open = set;
    wrap.querySelector('.rfab-btn').setAttribute('aria-expanded', !!set);
    if (set && wrap.onopen) wrap.onopen(set);
    const all = [...wrap.querySelector('.rarc').children], items = all.filter(b => (b.dataset.set || 'main') === set && !b.hidden);
    const n = items.length, step = n > 1 ? Math.PI / 2 / (n - 1) : 0, R = n > 1 ? Math.max(96, Math.ceil(32 / Math.sin(step / 2))) : 96;
    for (const b of all) b.classList.toggle('on', items.includes(b));
    items.forEach((b, i) => {
      const a = Math.PI / 2 + (n > 1 ? i * step : Math.PI / 4);
      b.style.setProperty('--x', `${Math.round(Math.cos(a) * R) || 0}px`);
      b.style.setProperty('--y', `${-Math.round(Math.sin(a) * R)}px`);
      b.style.transitionDelay = `${i * 0.03}s`;
    });
  }
  const closeRadials = () => { for (const o of document.querySelectorAll('.rfab')) radial(o, ''); };
  for (const w of document.querySelectorAll('.rfab')) {
    if (!w.querySelector('.rarc')) continue;   // 看路線圖的 ✓ 沒有展開的選項
    w.querySelector('.rfab-btn').onclick = () => radial(w, w.dataset.open ? '' : w.setFor ? w.setFor() : 'main');
    // 按了功能就收起來（data-keep 的除外，例如記錄要換成記錄的選項）；label 開檔案選擇也一樣
    w.querySelector('.rarc').addEventListener('click', (e) => { const b = e.target.closest('.rarc-btn'); if (b && !('keep' in b.dataset)) setTimeout(() => radial(w, ''), 0); });
  }
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.rfab')) closeRadials(); }, true);

  // ---------- 首頁 ----------
  // 首頁：所有牆面，長按拖曳排過的照 order；還沒排過的（例如新牆）放最前面，依修改時間
  const hiddenWalls = new Set();
  // 首頁捲到哪裡：進牆面頁（頁面捲回最上面）前記下來，回首頁時捲回去；不然會帶著牆面頁的捲動，卡片少時連最上面的「有新版本」都被標題列蓋掉一截
  let homeScroll = 0;
  async function showHome() {
    if (PCLAND) { $('wall').hidden = $('home').hidden = true; state.wall = null; state.img = null; return showLanding(); }   // 電腦：只有介紹頁
    noteSpot();   // 回首頁前記下剛才停在哪（繼續爬）
    const back = $('home').hidden;
    $('wall').hidden = $('find').hidden = true; $('home').hidden = false; $('editor').hidden = true; closeRadials();
    if (back) document.scrollingElement.scrollTop = homeScroll;
    state.wall = null; state.img = null; state.routeId = null; hideToast(); $('samProg').hidden = true;
    renderSyncHint();
    releaseCanvases();
    let walls = [];
    try { walls = (await listHome()).filter(w => !isDemoPid(w.pid)); lsSet('climbio.hasWalls', walls.length > 0); } catch (e) { /* 不支援 IndexedDB */ }
    walls = walls.filter(w => !hiddenWalls.has(w.id));   // 剛刪掉、還能復原的先不顯示
    walls.sort((a, b) => b.updatedAt - a.updatedAt);
    // 刪除仍可復原時先隱藏空畫面。
    $('homeEmpty').hidden = walls.length > 0 || hiddenWalls.size > 0;
    homeWalls = walls;
    const spot = lsGet(SPOT_KEY, null);
    homeSpot = spot && spot.r ? await getRoute(spot.w, spot.r).catch(() => null) : null;   // 繼續爬要顯示的那條路線（首頁的牆沒讀路線）
    homeMeta();
    renderWallList();
    fillHiThumbs(walls);
  }
  // 首頁上方：繼續爬、搜尋（牆多才出現）
  function homeMeta() {
    const walls = homeWalls.filter(w => !w.pending);
    renderCont(walls);
    $('homeFind').hidden = homeWalls.length <= 6;
    renderGymChips();
    if ($('homeFind').hidden) { homeFilter = 'all'; $('homeSearch').value = ''; }
  }
  // 岩館標籤：接在固定的篩選後面，只列有牆的岩館（依名稱，最後是其他），兩間以上才有；選中的岩館沒有牆了就回到全部
  function renderGymChips() {
    const box = $('findChips');
    for (const b of box.querySelectorAll('[data-f^="g:"]')) b.remove();
    const names = [...new Set(homeWalls.filter(w => !w.pending).map(w => w.gym || ''))].sort((a, b) => !a - !b || a.localeCompare(b, 'zh-Hant'));
    if (names.length > 1) box.append(...names.map(g => Object.assign(document.createElement('button'), { textContent: gymLabel(g) })).map((b, i) => { b.dataset.f = 'g:' + names[i]; return b; }));
    if (!box.querySelector(`[data-f="${CSS.escape(homeFilter)}"]`)) homeFilter = 'all';
    for (const c of box.children) c.setAttribute('aria-pressed', c.dataset.f === homeFilter);
  }
  // 同步下載好一面牆：只換它的卡片（骨架 → 照片淡入），回傳新的卡片
  function homeArrive(w) {
    if ($('home').hidden) return null;
    const i = homeWalls.findIndex(x => x.id === w.id);
    if (i >= 0) homeWalls[i] = w; else homeWalls.push(w);
    $('homeEmpty').hidden = true;
    const old = $('wallList').querySelector(`.wall-card[data-id="${w.id}"]`);
    if (!old) return null;
    const c = wallCard(w); c.classList.add('arrive');
    old.replaceWith(c);
    return c;
  }
  // ---------- 首頁：繼續爬、找牆（搜尋、篩選）、兩欄小卡＋進度環 ----------
  let homeWalls = [], homeFilter = 'all', homeSpot = null;
  const OPENED_KEY = 'climbio.opened';   // 牆 id → 最後打開的時間（只存在這台）：「最近」排序、繼續爬
  // 最後停在哪（只存在這台）：{ w: 牆 id, r: 路線 id（停在牆面頁是 null） }。回首頁、App 切到背景（關掉之前一定會）時記
  const SPOT_KEY = 'climbio.spot';
  function noteSpot() {
    const w = state.wall;
    if (!w || ($('wall').hidden && $('editor').hidden)) return;
    lsSet(SPOT_KEY, { w: w.id, r: !$('editor').hidden && state.mode === 'route' && route() ? state.routeId : null });
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') noteSpot(); });
  const sentFrac = (w) => { const s = sumOf(w); return s.n ? s.send / s.n : 0; };
  function renderWallList() {
    const q = $('homeSearch').value.trim().toLowerCase(), opened = lsGet(OPENED_KEY, {});
    let list = homeWalls.filter(w => (!q || `${w.name || ''} ${w.gym || ''}`.toLowerCase().includes(q))
      && (homeFilter !== 'recv' || w.from) && (homeFilter !== 'todo' || (sumOf(w).n && sentFrac(w) < 1))
      && (!homeFilter.startsWith('g:') || (w.gym || '') === homeFilter.slice(2)));
    const here = new Set(homeWalls.map(w => w.id));   // 同一面牆的幾張照片只放一張卡片：這台有的照片裡中間那張當封面
    list = list.filter(w => { if (!w.grp) return true; const ids = w.grp.ids.filter(id => here.has(id)); return ids[(ids.length - 1) >> 1] === w.id; });
    if (homeFilter === 'recent') list = list.slice().sort((a, b) => (opened[b.id] || 0) - (opened[a.id] || 0));
    $('wallList').replaceChildren(...list.map(w => wallCard(w)));
    if (!list.length && homeWalls.length) { const p = document.createElement('p'); p.className = 'find-none'; p.textContent = t('findNone'); $('wallList').append(p); }
  }
  $('homeSearch').addEventListener('input', renderWallList);
  $('findChips').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    homeFilter = b.dataset.f;
    for (const c of $('findChips').children) c.setAttribute('aria-pressed', c === b);
    renderWallList();
  };
  // 繼續爬：最後停在的路線（停在牆面頁就是那面牆）；沒有就上次打開的牆。
  // 只有牆的卡片要兩面牆以上才顯示（只有一面時就是首頁那張）
  function renderCont(walls) {
    let best = null;
    const spot = lsGet(SPOT_KEY, null), sw = spot && walls.find(x => x.id === spot.w && !x.pending);
    if (sw) best = { w: sw, r: (spot.r && homeSpot && homeSpot.id === spot.r && homeSpot) || null };
    if (best && !best.r && walls.length < 2) best = null;
    if (!best && walls.length >= 2) {
      const opened = lsGet(OPENED_KEY, {}), w = walls.filter(x => opened[x.id]).sort((a, b) => opened[b.id] - opened[a.id])[0];
      if (w) best = { w, r: null };
    }
    $('contCard').hidden = !best;
    if (!best) return;
    const { w, r } = best;
    $('contImg').src = w.thumbHi || w.thumb || BLANK_IMG; $('contImg').dataset.wid = w.id;   // 背景補做好縮圖時跟著換
    setGrade($('contBig'), r ? r.grade : w.name);
    $('contBig').classList.toggle('grade', !!r);
    $('contState').textContent = t('lastOpened');
    $('contWhere').textContent = r ? [r.name, w.name].filter(Boolean).join(' · ') : t('routesN', sumOf(w).n);
    $('contCard').onclick = async () => { await openWall(w.id); if (r && state.wall && state.wall.id === w.id) openRoute(r.id); };
  }
  // 一面牆完攀、沒爬過的條數；牆面頁的進度條、首頁卡片共用
  function logCounts(w) {
    const { n, send } = sumOf(w);
    return { send, none: n - send };
  }
  // 細進度條（首頁卡片下緣、牆面頁共用；key：各自記上次的條數）：上次畫的條數記著，回到首頁時從舊的滑到新的（例如剛完攀一條）
  const barWas = new Map();
  function wallBar(w, cnt, key = w.id) {
    const was = barWas.get(key), bar = document.createElement('span'); bar.className = 'wb';
    barWas.set(key, cnt);
    for (const k of ['send', 'none']) {
      const s = document.createElement('i'); s.dataset.k = k; s.style.flexGrow = (was || cnt)[k]; bar.append(s);
    }
    if (was && ['send', 'none'].some(k => was[k] !== cnt[k])) {
      requestAnimationFrame(() => requestAnimationFrame(() => { for (const s of bar.children) s.style.flexGrow = cnt[s.dataset.k]; }));
    }
    return bar;
  }
  // 首頁卡片的副標：這面牆現在跟你的關係，照優先順序只放一句
  function wallSub(w, cnt, el) {
    const n = sumOf(w).n;
    if (!n) { el.textContent = t('cardEmpty'); return; }
    if (cnt.none === n) { el.textContent = t('cardTodo', n); return; }
    const all = cnt.send === n;
    el.classList.toggle('hot', all);   // 全清：跟新線一樣用螢光綠
    el.textContent = all ? t('cardAll') : t('cardLeft', n - cnt.send);
  }
  // 這面牆完攀過的最高難度（沒有就 null）
  const bestGrade = (w) => sumOf(w).best;
  // 下拉首頁重新整理：列表跟著手指往下（越拉越緊），岩點外圈的環跟著填滿；滿了放開，岩點轉圈直到更新完（登入時重新跟雲端同步），
  // 再平滑地彈回去。移動都用 transform，每一幀畫一次
  (function pullToRefresh() {
    const home = $('home'), el = $('pullHold'), bar = $('pullBar'), C = 2 * Math.PI * 20, ARM = 70, MAX = 120;
    bar.style.strokeDasharray = C;
    let y0 = null, pull = 0, busy = false, raf = 0;
    const paint = () => {
      raf = 0;
      home.style.setProperty('--pull', `${pull}px`);
      el.style.setProperty('--py', `${Math.min(pull, ARM) - 44}px`);
      el.style.opacity = Math.min(1, pull / 30);
      bar.style.strokeDashoffset = C * (1 - Math.min(1, pull / ARM));
      el.classList.toggle('armed', pull >= ARM);
    };
    const set = (v) => { pull = v; if (!raf) raf = requestAnimationFrame(paint); };
    let settleTimer = 0;
    const settle = (v) => {
      clearTimeout(settleTimer); home.classList.add('pull-release'); set(v);
      settleTimer = setTimeout(() => { home.classList.remove('pull-release'); if (!pull) home.classList.remove('pulling'); }, 350);
    };
    home.addEventListener('touchstart', (e) => { y0 = !busy && scrollY <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null; }, { passive: true });
    home.addEventListener('touchmove', (e) => {
      if (y0 == null) return;
      const dy = e.touches[0].clientY - y0;
      if (dy <= 0) { set(0); return; }
      home.classList.add('pulling');
      set(MAX * (1 - Math.exp(-dy / 160)));   // 越拉越緊
    }, { passive: true });
    home.addEventListener('touchend', async () => {
      if (y0 == null) return;
      y0 = null;
      if (pull < ARM) { settle(0); return; }
      busy = true; buzz(10);
      settle(ARM); el.classList.add('spin');
      await Promise.all([showHome(), readPublic(undefined, { force: true }), pause(700)]);   // 下拉也立即重讀公開牆的線、預設岩點檔
      el.classList.remove('spin');
      settle(0);
      busy = false;
    });
  })();
  // ---------- 長按卡片打開選單（首頁的牆面、牆面頁的橫幅和路線；長按手勢是 AppKit.gesture.longPress）----------
