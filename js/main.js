// 啟動：事件綁定、操作示範、第一次使用的導覽、版本更新檢查。最後載入，前面檔案的東西都可以直接用。
// English: Startup and event wiring, navigation, update check. Loaded last, so it may use everything declared before it.
'use strict';
  // ---------- 綁定 ----------
  buildDial();

  attachEditorUi();   // 定線的操作介面（RouteKit.EditorUI）接上控制器
  for (const b of document.querySelectorAll('.outline-btn')) b.onclick = toggleShowAll;
  for (const b of document.querySelectorAll('.base-btn')) b.onclick = () => toggleBase();
  $('delHold').onclick = deleteSelected;
  $('holdLasso').onclick = () => { if (!cancelLasso()) setLasso(true); };   // 手機單點編輯：圈起來（js/edit.js 的 finishLasso）
  $('holdRetrace').onclick = () => retraceSelected();   // 單點編輯：用目前的外框重描這一顆
  // 刪除路線（定線畫面右上的垃圾桶）：直接刪，不跳確認；自己的公開線大家都沒了（見 dropLine）；提示裡按「復原」放回來（見 keepLine）
  $('edDelRoute').onclick = () => {
    const r = route(); if (!r) return;
    const w = state.wall, rs = sortedRoutes(), i = rs.indexOf(r), at = w.routes.indexOf(r);
    w.routes = w.routes.filter(x => x !== r); rs.splice(i, 1);
    dropLine(w, r);
    const next = rs[Math.min(i, rs.length - 1)];
    state.routeId = next ? next.id : null; save();
    editStart = '';   // 刪了就不算「取消」能回復的修改
    addEventListener('popstate', () => toast(t('deleted'), { action: { label: t('undo'), run: () => {
      if (state.wall !== w) return;
      w.routes.splice(Math.min(at, w.routes.length), 0, r); keepLine(w, r);
      state.routeId = r.id; save();
      if (!$('editor').hidden) setMode('route'); else renderOverview();
    } } }), { once: true });   // 等回到上一頁再顯示（換頁會收掉提示）
    if (next) history.back();   // 回到看路線圖，顯示相鄰的那條
    else history.go(-2);        // 沒有路線了：回牆面頁
  };
  // 完成：結束編輯回到路線圖（跟返回鍵一樣，沒加任何點的新路線不存）
  // 編輯岩點時按完成：畫到一半的岩點夠 3 點就加進去
  $('edMenuBtn').onclick = (e) => {
    e.stopPropagation();
    $('edMenuBtn').disabled = false;
    $('edMenu').hidden = !$('edMenu').hidden;
  };
  document.addEventListener('click', (e) => { if (!$('edMenu').hidden && !$('edMenu').contains(e.target)) $('edMenu').hidden = true; });
  // 看路線圖右上的「⋯」：相機看線、灰階／暗彩、編輯路線、分享；選了一項或點別的地方就收起來
  const vwMenu = (open) => { $('vwMenu').hidden = !open; $('vwMore').setAttribute('aria-expanded', String(open)); };
  $('vwMore').onclick = (e) => { e.stopPropagation(); vwMenu($('vwMenu').hidden); };
  $('vwMenu').addEventListener('click', () => vwMenu(false));
  document.addEventListener('click', (e) => { if (!$('vwMenu').hidden && !$('vwMenu').contains(e.target)) vwMenu(false); });
  // 取消：回到進來編輯前的樣子（有改過先確認；ask＝false：已經問過了）
  async function cancelEdit(ask = true) {
    const w = state.wall; if (!w) return;
    const start = state.holdSub ? holdStart : editStart;   // 定線時長按進來的岩點編輯：只回復這一段，回到定線
    const r = route(), blank = state.mode === 'route' && !state.holdSub && !!r && !Object.keys(r.holds).length;   // 路線上沒有任何點：沒有東西可丟，直接離開
    if (start && wallSnap(w) !== start) {
      if (ask && !blank && !await askConfirm(t(state.mode === 'holds' ? 'discardHolds' : 'discardEdit'), { ok: t('btnDiscard'), danger: true })) return;
      if (state.wall !== w) return;
      const prev = JSON.parse(start);
      w.holds = prev.holds; w.routes = prev.routes; w.deleted = prev.deleted || { routes: {} }; w.name = prev.name;
      save(); touchGeom();   // 存檔時改之前的樣子會記進復原，取消後還能用 Z 拿回來
      for (const k of ['selected', 'current', 'hover']) state[k] = null;
    }
    state.draft = null; state.cursor = null;
    leaving = true;
    history.back();
  }
  $('edCancel').onclick = () => cancelEdit();
  // 返回手勢離開還沒有起攀、完攀的路線（js/wall.js 的 popstate 擋下來）：問要不要放棄這次的修改，放棄就跟按「取消」一樣
  leaveIncomplete = async () => { if (await askConfirm(t('needEndsAsk'), { ok: t('btnDiscard'), danger: true })) cancelEdit(false); };
  // 看路線圖：點名稱直接修改（跟牆面名稱一樣）
  $('wallName').onchange = (e) => {
    if (!state.wall) return;
    if (isPublic(state.wall)) { e.target.value = state.wall.name; return; }   // 公開牆不能改名
    state.wall.name = e.target.value.trim() || state.wall.name; e.target.value = state.wall.name; save();
  };
  $('wallName').onkeydown = (e) => { if (e.key === 'Enter') e.target.blur(); };
  $('backBtn').onclick = () => history.back();
  $('wallFabBtn').onclick = startNewRoute;   // 「＋」就是新路線（不展開）
  // 牆面選單：長按首頁的牆面小卡或牆面頁的橫幅（同一份選單）
  let menuWall = null;
  async function openWallMenu(w, card) {
    if (w.lite) w = (await getWall(w.id).catch(() => null)) || w;   // 首頁的牆沒讀路線：選單的動作要完整的牆
    menuWall = w;
    // 公開牆（Studio 發佈的）不能改名、加照片，只能刪除：大家看到同一份
    $('renameWallBtn').hidden = $('addPhotoBtn').hidden = isPublic(w);
    openCardMenu('wallSheet', card);
  }
  AppKit.gesture.longPress($('wallList'), { item: '.wall-card:not(.pending)', rightClick: true, onHold: (el) => { if (el.wall) openWallMenu(el.wall, el); } });
  AppKit.gesture.longPress($('wallHero'), { item: '.wall-photo', rightClick: true, onHold: () => { if (state.wall) openWallMenu(state.wall, $('wallHero')); } });
  // 牆面照片點一下：新路線（跟「＋」一樣）；長按是上面的選單，手指移動是捲動，都不算點
  {
    let down = null;
    $('wallHero').addEventListener('pointerdown', (e) => { down = e.isPrimary && e.target.closest('.wall-photo') ? { x: e.clientX, y: e.clientY, at: e.timeStamp } : null; });
    $('wallHero').addEventListener('pointerup', (e) => {
      const d = down; down = null;
      if (d && e.timeStamp - d.at <= 300 && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= 10) startNewRoute();
    });
  }
  // 對沒打開的牆（首頁）要用到牆面頁的功能：先打開那面牆
  const openedWall = async (w) => { if (state.wall !== w) await openWall(w.id); return state.wall && state.wall.id === w.id ? state.wall : null; };
  const hasFind = can('gyms') || SITE.directory;   // 有總目錄就找得到別的站的牆
  if (hasFind) $('findBtn').onclick = () => openFind(); else $('findBtn').remove();
  $('findBack').onclick = findBack;
  $('findGym').onclick = findBack;
  $('findSearch').oninput = () => { find.q = $('findSearch').value.trim(); renderFind(); };   // 打字就依館名（沒有再依牆名）找，結果少就直接攤開卡片
  new IntersectionObserver((es) => { if (es.some(e => e.isIntersecting) && !$('find').hidden) loadFind(false); }).observe($('findMore'));   // 捲到底載入下一頁
  // 選單關掉（返回那一層退回去）之後才做，不然兩次返回疊在一起
  // fn(w)：選單是哪面牆的（打開選單時記下，關掉選單後就清掉）
  const afterMenu = (fn) => () => {
    const w = menuWall || state.wall; menuWall = null;
    if (menuLayer()) { addEventListener('popstate', () => setTimeout(() => fn(w), 0), { once: true }); dismissMenu(); } else { dismissMenu(); fn(w); }
  };
  $('wallSheetCancel').onclick = () => { menuWall = null; dismissMenu(); };
  $('wallSheet').onclick = (e) => { if (e.target === $('wallSheet')) { menuWall = null; dismissMenu(); } };
  $('renameWallBtn').onclick = afterMenu(async (w) => {
    if (!w) return;
    if (state.wall === w) { $('wallName').focus(); $('wallName').select(); return; }
    const v = (await askText({ title: t('renameWall'), value: w.name, ok: t('done'), max: 40 }) || '').trim();
    if (!v || v === w.name) return;
    w.name = v; await patchWall(w.id, (r) => { r.name = v; }).catch(() => toast(t('saveFailed')));
    showHome();
  });
  // 增加照片：選位置（上、下、左、右）
  $('addPhotoBtn').onclick = afterMenu((w) => { if (w) openSideSheet(w); });
  for (const [id, side] of [['sideUp', 'up'], ['sideDown', 'down'], ['sideLeft', 'left'], ['sideRight', 'right']]) $(id).onclick = () => chooseSide(side);
  $('sideCancel').onclick = dismissMenu;
  $('sideSheet').onclick = (e) => { if (e.target === $('sideSheet')) dismissMenu(); };
  $('deleteWallBtn').onclick = afterMenu(async (w) => {
    // 所有刪除都是本地動作。
    if (!w) return;
    const open = state.wall === w;
    if (open) { clearTimeout(saveTimer); await putWall(w).catch(() => {}); }
    hiddenWalls.add(w.id);
    const commit = () => { clearTimeout(timer); pendingDeletes.delete(commit); if (!hiddenWalls.delete(w.id)) return; return removeWall(w); };
    const timer = setTimeout(commit, 5500);
    pendingDeletes.add(commit);
    const undo = () => toast(t('deleted'), { action: { label: t('undo'), run: () => { clearTimeout(timer); pendingDeletes.delete(commit); hiddenWalls.delete(w.id); showHome(); } } });
    // 牆面頁：回首頁（popstate 會重畫列表，這面先不顯示；首頁會收掉提示，所以等回到首頁再顯示）；首頁：直接重畫
    if (open) { history.back(); addEventListener('popstate', undo, { once: true }); }
    else { await showHome(); undo(); }
  });
  // 刪掉但還能復原的牆：首頁先不顯示；離開 App 時馬上真的刪
  const pendingDeletes = new Set();
  addEventListener('pagehide', () => { for (const c of pendingDeletes) c(); pendingDeletes.clear(); });
  // 刪掉一面牆：路線連同完攀一起刪，統計（climbio.stats）不動；備份的內容保留。
  // 公開分享過的牆同時收回公開（擁有者整面牆都收回，收了這面牆的人下次讀的時候會移除它；其他人只拿掉自己的線）；離線等失敗不擋刪除，雲端上的留著
  async function removeWall(w) {
    if (w.share === 'public' && !localOnly(w) && can('share')) await Backend.unlistWall(w.pid).catch(e => console.warn('收回公開失敗', e));
    await deleteWall(w.id).catch(() => {});
    welcomeAgain();
  }
  window.addEventListener('pagehide', () => { if (state.wall) putWall(state.wall).catch(() => {}); });

  $('homeMenuBtn').onclick = (e) => { e.stopPropagation(); toggleHomeMenu(); };
  // 點選單外面只關選單，不觸發底下的按鈕（不然退回選單這一層會跟底下開的頁面搶返回紀錄）
  document.addEventListener('click', (e) => { if (!$('homeMenu').hidden && !$('homeMenu').contains(e.target)) { e.stopPropagation(); e.preventDefault(); dismissMenu(); } }, true);
  // 頁面自己的版本寫在 <meta name="app-version">（跟頁面一起從網路拿，不會像 version.js 被 HTTP 快取拿到舊的而一直提示更新）
  const PAGE_VERSION = (document.querySelector('meta[name="app-version"]') || {}).content || self.CLIMBIO_VERSION;
  AppKit.account.footer($('hmFoot'), { version: PAGE_VERSION, versionButton: true, showUpdateStatus: true });
  applyLang();   // 要在選單底部建好之後：隱私、條款連結依語言加 #en
  history.replaceState({ s: 'home' }, '');
  renderAccount();
  // 申請持久保存：空間不足時瀏覽器不會把牆面、照片清掉
  if (navigator.storage && navigator.storage.persist) navigator.storage.persisted().then(p => p || navigator.storage.persist()).catch(() => {});
  showHome().then(async () => {
    document.getElementById('bootSplash')?.remove();   // 拿掉 hold/index.html 的啟動畫面
    // Service Worker 第一次安裝要下載整版檔案：等首頁畫好、瀏覽器閒下來才開始，不跟首屏搶頻寬
    if ('serviceWorker' in navigator && location.protocol === 'https:') { if (self.requestIdleCallback) requestIdleCallback(registerSW, { timeout: 3000 }); else setTimeout(registerSW, 1000); }
    if (!PCLAND) setTimeout(prefetchModels, 2000);   // 偵測、重描的模型在背景先下載好（只存不載入），第一次拍照不用等
    // 岩館目錄（兩個小檔，冷請求要 2、3 秒）閒下來先讀（只有接後端的主網；其他站按了才連外）：第一次按「找牆面」不用等，同時存成下次的快取；失敗不吭聲，按「找牆面」時會重讀並說原因
    if (can('gyms')) { const go = () => { if (!findPre) preloadFind().p.catch(() => {}); }; setTimeout(() => { if (self.requestIdleCallback) requestIdleCallback(go, { timeout: 5000 }); else go(); }, 4000); }   // 等首屏、Service Worker 和模型下載先跑
    if (SITE.listed && SITE.directory && SITE.directory !== SITE.url && !PCLAND) ShareTools.registerSite(SITE.directory);   // 登記進總目錄，別的站找得到這裡的牆（總目錄自己的站不送：總目錄每天的複查列進自己）   // 岩點偵測在手機上做：開場畫面出來後在背景準備好模型
    // 點了路線連結（?p=照片編號&r=路線 id）：直接開始接收

    const href = location.href;   // 先記下來：網址列清掉 ?p= 之後就讀不到了
    const c = /[?&](p|wall|person|shares|gym)=/.test(location.search) && ShareTools.linkFrom(href);
    if (W3D.linkOf(href) && !PCLAND) { history.replaceState({ s: 'home' }, '', location.pathname); hideWelcome(); showHome().then(() => W3D.receive(href)); }   // 3D 牆的私人連結
    else if (c && PCLAND) { openHref = href; history.replaceState({ s: 'home' }, '', location.pathname); showLanding(); }   // 電腦：不收，連結卡換成這條線的連結
    else if (c) { openHref = href; history.replaceState({ s: 'home' }, '', location.pathname); leaveInApp(href).then(() => openRecv(href)); }
    else {
      if (!PCLAND) welcomeBoot();   // 手機：第一次打開是開場畫面
    }
  });
  // App 開著時點路線連結（manifest 的 launch_handler：focus-existing）：不重新載入，連結從 launchQueue 進來；先退回首頁再接收。
  // 打開 App 那次也會進來一次，上面已經處理過
  if ('launchQueue' in window && !PCLAND) {
    const key = (u) => { const c = ShareTools.linkFrom(u); return c ? c.pid + '/' + c.rid : ''; };
    let boot = key(location.href), boot3d = location.href;
    launchQueue.setConsumer(async ({ targetURL }) => {
      if (W3D.linkOf(targetURL)) {
        const again = targetURL === boot3d; boot3d = '';
        if (again) return;
        const n = (history.state && history.state.n) || 0;
        if (n) await new Promise(res => { addEventListener('popstate', res, { once: true }); history.go(-n); });
        return W3D.receive(targetURL);
      }
      const k = key(targetURL), again = k === boot; boot = '';
      if (!k || again) return;
      const n = (history.state && history.state.n) || 0;
      if (n) await new Promise(res => { addEventListener('popstate', res, { once: true }); history.go(-n); });
      openHref = targetURL; openRecv(targetURL);
    });
  }

  // 單點編輯的復原：岩點物件會換新，照 id 選回同一顆
  $('holdUndo').onclick = () => {
    const id = state.selected && state.selected.id;
    if (!undoEdit()) return;
    if (holdView) holdView.lassoed = false;   // 復原後可以再圈
    state.selected = state.wall.holds.find(h => h.id === id) || null;
    refreshUi(); render();
  };
  $('holdDone').onclick = () => history.back();   // 單點編輯的完成：回到定線（跟返回一樣）
  // 長按路線小卡的選單：編輯、重新命名、刪除
  let sheetRoute = null;
  openRouteSheet = (rid, card) => {
    sheetRoute = { rid, cv: card.querySelector('.rc-thumb') };
    $('rsName').hidden = true; $('rsMain').hidden = $('rsDanger').hidden = false; $('routeSheetCancel').textContent = t('cancel');
    const r = state.wall && state.wall.routes.find(x => x.id === rid);
    $('rsRename').hidden = !r || !mineRoute(r);   // 別人的線不改名
    if (r && !mineRoute(r) && isPublic(state.wall)) $('rsDanger').hidden = true;   // 公開牆上別人的線不能刪：大家看到同一份
    openCardMenu('routeSheet', card);
  };
  // 重新命名：選單換成輸入框（按完成、Enter 或點外面都存起來）
  const rsRoute = () => state.wall && sheetRoute && state.wall.routes.find(x => x.id === sheetRoute.rid);
  function rsSave() {
    const r = rsRoute(); if ($('rsName').hidden || !r) return;
    const v = $('rsName').value.trim();
    if (v !== (r.name || '')) { r.name = v; touch(r); save(); renderOverview(); }
  }
  $('rsRename').onclick = () => {
    const r = rsRoute(); if (!r) return;
    closeCardMenu(); openLayer('routeSheet');   // 要打字：用畫面下方的選單，鍵盤跳出來時輸入框才看得到
    $('rsMain').hidden = $('rsDanger').hidden = true; $('rsName').hidden = false; $('routeSheetCancel').textContent = t('done');
    $('rsName').value = r.name || ''; $('rsName').focus(); $('rsName').select();
  };
  $('rsName').onkeydown = (e) => { if (e.key === 'Enter') { rsSave(); dismissMenu(); } };
  let rsTimer = 0;
  $('rsName').oninput = () => { clearTimeout(rsTimer); rsTimer = setTimeout(rsSave, 400); };   // 打字停一下就存：用返回手勢關掉選單也不會不見
  $('routeSheetCancel').onclick = () => { rsSave(); dismissMenu(); };
  $('routeSheet').onclick = (e) => { if (e.target === $('routeSheet')) { rsSave(); dismissMenu(); } };
  $('rsEdit').onclick = afterMenu(() => { const s = sheetRoute; if (s) { openRouteFrom(s.rid, s.cv); enterRouteEdit({ fromWall: true }); } });
  // 刪除：直接刪，不跳確認；提示裡按「復原」放回來（跟定線畫面的刪除一樣）
  $('rsDel').onclick = afterMenu(() => {
    const w = state.wall, r = sheetRoute && w && w.routes.find(x => x.id === sheetRoute.rid); if (!r) return;
    const at = w.routes.indexOf(r);
    w.routes.splice(at, 1); dropLine(w, r);
    if (state.routeId === r.id) state.routeId = null;
    save(); renderOverview();
    toast(t('deleted'), { action: { label: t('undo'), run: () => {
      if (state.wall !== w) return;
      w.routes.splice(Math.min(at, w.routes.length), 0, r); keepLine(w, r);
      save(); renderOverview();
    } } });
  });

  // ---------- 第一次使用的導覽卡片 ----------
  // 第一次打開 App 顯示（點連結進來的先處理接收，下次打開再顯示）；看完或略過後記在 localStorage。
  // 算一層返回：手機返回鍵會關掉導覽
  // 操作示範兩段從頭播（等選單那一層退掉再開，不然返回事件會把示範關掉）
  $('helpBtn').onclick = () => {
    dismissMenu();
    window.open(AppKit.i18n.guideUrl('hold-manual.html'), '_blank', 'noopener,noreferrer');
  };
  $('hmAcct').onclick = (e) => {   // 點最上面的姓名改暱稱；等選單那一層返回退完才開對話框，不然退掉選單的返回會把剛開的對話框關掉
    const ask = () => askSign().then(renderAccount);
    if (menuLayer()) { addEventListener('popstate', () => setTimeout(ask, 0), { once: true }); dismissMenu(); } else { dismissMenu(); ask(); }
  };
  // 難度系統：V 級／段級，按一下切換（只影響之後新出的路線）
  // 難度系統：跟語言一樣用選的（目前的打勾）
  const gradeOpts = Object.keys(GRADE_SYS).map(sys => {
    const b = document.createElement('button'); b.className = 'sheet-btn grade-opt'; b.dataset.sys = sys;
    const tick = document.createElement('template'); tick.innerHTML = '<svg><use href="#i-check"/></svg>';
    b.append(document.createElement('span'), tick.content.firstChild);
    b.onclick = () => { dismissMenu(); lsSet(GRADE_SYS_KEY, sys); $('gradeSysVal').textContent = t(GRADE_SYS_LABEL[sys]); };
    return b;
  });
  $('gradeOpts').append(...gradeOpts);
  $('gradeSysBtn').onclick = () => {
    for (const b of gradeOpts) { b.firstChild.textContent = t(GRADE_SYS_LABEL[b.dataset.sys]); b.setAttribute('aria-pressed', b.dataset.sys === gradeSys()); }
    $('homeMenu').hidden = true; openLayer('gradeSheet');
  };
  $('gradeCancel').onclick = dismissMenu;
  $('gradeSheet').onclick = (e) => { if (e.target === $('gradeSheet')) dismissMenu(); };

  // ---------- 版本 ----------
  // 開 App 時頁面是從網路拿的最新版（Service Worker 網路優先，見 hold/sw.js），資源網址帶同一個版本，不需要重新載入來對齊。
  // 這裡只處理「開著不動」和「加到主畫面的 App 從背景回來（不會重新載入）」：回到前景、恢復網路時問伺服器現在是哪一版（間隔至少 1 分鐘，
  // 只抓很小的 version.js，不經過 Service Worker）；版本不同就在首頁標題列下面出現「有新版本　更新」，按了才重新載入，不自動打斷使用者
  try { sessionStorage.removeItem('climbio.resume'); } catch (e) { /* 忽略 */ }
  function registerSW() {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});   // updateViaCache: 'none'：sw.js 和 version.js 不用 HTTP 快取，新版馬上發現
    // 檢查的結果顯示在首頁「⋯」最下面的版本號下方（有新版顯示是哪一版、什麼時候檢查的；失敗顯示原因；已是最新不顯示）
    const updateBar = AppKit.update.create({ host: $('updateSlot'), apply: () => reload() });
    const checkVersion = async () => {
      const at = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      try {
        const txt = await (await fetch(`../version.js?check=${Date.now()}`, { cache: 'no-store' })).text();
        const m = txt.match(/CLIMBIO_VERSION\s*=\s*'([^']+)'/);
        if (!m) { $('updInfo').textContent = t('verCheckBad', at); return false; }
        const newer = m[1] !== PAGE_VERSION;
        $('updInfo').textContent = newer ? t('verNewer', m[1].replace(/^climbio-/, ''), at) : '';
        if (newer) updateBar.show();
        return newer;
      } catch (e) { $('updInfo').textContent = t('verCheckFail', at, e.message || String(e)); return false; }
    };
    const reload = async () => {   // 頁面是網路優先拿的新版；先把正在編輯的牆存好
      clearTimeout(saveTimer);
      if (state.wall) await putWall(state.wall).catch(() => {});
      location.reload();
    };
    $('versionBtn').onclick = async () => {
      $('updInfo').textContent = t('verChecking');
      if (await checkVersion()) reload();
    };
    checkVersion();
    AppKit.update.watch(checkVersion);   // 回到前景、恢復網路時再問一次（間隔至少 1 分鐘）
  }

  // 長按出現的系統選單（選字、存圖、複製連結）一律擋掉；輸入框保留，才能貼上
  document.addEventListener('contextmenu', (e) => { if (!e.target.closest('input, textarea, [contenteditable]')) e.preventDefault(); });

  // 重描輪廓（holdkit 的 HoldRefiner）：訊息用語言包；照片特徵存 IndexedDB climbio-sam；整面牆送 retrace 雲端函式（要登入 Google），沒登入或沒有雲端就在手機上分析照片、重描
  HoldRefiner.configure({ t: self.climbioT, db: 'climbio-sam', modelCache: MODELS_CACHE,
    cloudUrl: () => RETRACE_URL, appCheck: cloudAppCheck });
  // 定線中（重新整理後回到定線）馬上準備長按要用的解碼器和照片特徵
  if (state.mode === 'route' && !state.routeView) warmSam();
