// 牆面頁、編輯畫面、返回鍵、提示、縮放與平移、首頁卡片。
// 依序載入（app → home → profile → add-wall → edit → wall → sync → draw → export → mobile → tour → main），共用同一個全域範圍；載入當下只能用到前面檔案宣告的東西，
// 事件處理、計時器等之後才執行的程式不受限制。啟動與事件綁定放在最後的 main.js。
// English: Wall page, edit screen, back button, hints, zoom and pan, home cards.
'use strict';
  // ---------- 牆面頁 ----------
  function renderOverview() {
    const w = state.wall; if (!w) return;

    $('wallTitle').textContent = w.name;
    // 同一面牆的幾張照片：小卡列整組的所有路線（不分照片），各自畫在家那張；換照片只換上面的圖
    const ws = grpWalls(w), all = ws.flatMap(m => m.routes.filter(r => !r.xfer)), n = all.length;
    $('routeTools').hidden = n < 2;   // 兩條以上才有篩選、進度條和排序
    renderProgBar(w, all); renderListTools();
    let list = ws.flatMap(m => sortedRoutes(m).filter(r => !r.xfer && passFilter(r, m)).map(r => [m, r]));
    if (ws.length > 1 && SORT_CMP[routeSort]) list = list.sort((a, b) => SORT_CMP[routeSort](a[1], b[1]));
    // 小卡分批畫（上千條一次畫會卡好幾秒）：一批 ROW_CHUNK 條，捲到接近底部才畫下一批；同一面牆、同樣的排序篩選重畫時沿用已畫的條數
    let sec = null;
    rows = list.map(([m, r]) => {
      let head = null;
      if (routeSort !== 'added' && r.grade !== sec) {   // 依難度排序：每個難度一段
        sec = r.grade;
        head = document.createElement('h3'); head.className = 'grade-sec';
        head.textContent = t('routeSec', r.grade, list.filter(x => x[1].grade === r.grade).length); head.classList.toggle('dan', isDan(r.grade));
      }
      return { id: r.id, build: () => (head ? [head, routeCard(m, r)] : [routeCard(m, r)]) };
    });
    const key = `${thumbKey(w)}|${routeSort}|${routeFilter}`;
    if (rowsKey !== key) { rowsKey = key; rowsShown = ROW_CHUNK; }
    // 新增路線用右下角的「＋」；還沒有路線時提示一下
    const hint = document.createElement('p'); hint.className = 'list-hint'; hint.textContent = t(n ? 'routesNoMatch' : 'routesEmpty');
    const hidden = (hiddenLines.get(w.id) || []).length, tail = [];
    if (hidden) { const b = document.createElement('button'); b.className = 'hidden-lines'; b.textContent = t('hiddenN', hidden); b.onclick = () => showHidden(w); tail.push(b); }
    const out = rows.slice(0, rowsShown).flatMap(x => x.build());
    $('routeList').replaceChildren(...(out.length || tail.length ? [...out, ...tail] : [hint]));
    watchMore();
    queueThumbs();
  }
  let rows = [], rowsShown = 0, rowsKey = '';
  const ROW_CHUNK = 60;
  const moreObs = new IntersectionObserver((es) => { if (es.some(e => e.isIntersecting)) showMoreRows(); }, { rootMargin: '1200px 0px' });
  const moreMark = Object.assign(document.createElement('div'), { className: 'route-more' });
  // 還有沒畫的小卡：在清單最後放一個記號，捲到接近才畫下一批
  function watchMore() {
    moreObs.disconnect(); moreMark.remove();
    if (rowsShown >= rows.length) return;
    const hid = $('routeList').querySelector('.hidden-lines');
    if (hid) hid.before(moreMark); else $('routeList').append(moreMark);
    moreObs.observe(moreMark);
  }
  function showMoreRows(upTo = rowsShown + ROW_CHUNK) {
    if (rowsShown >= rows.length) return;
    const from = rowsShown; rowsShown = Math.min(rows.length, upTo);
    moreMark.before(...rows.slice(from, rowsShown).flatMap(x => x.build()));
    watchMore(); queueThumbs();
  }
  // 這條路線的小卡一定要畫出來（從路線圖回牆面要飛回它的小卡）
  function showRouteRow(id) { const i = rows.findIndex(x => x.id === id); if (i >= rowsShown) rowsShown = Math.min(rows.length, i + 1); }
  // 完攀／未完攀篩選和下面的細進度條（跟首頁牆面小卡下緣的一樣）：兩類都有才能篩，一條都還沒爬就不放進度條
  function renderProgBar(w, rs = w.routes) {
    const sent = rs.filter(isSent).length, cnt = { send: sent, none: rs.length - sent }, unsent = rs.length - sent;
    const chips = $('rfChips'), bar = $('progBar');
    chips.hidden = $('routeTools').hidden || !sent || !unsent;
    if (chips.hidden) routeFilter = '';
    for (const b of chips.querySelectorAll('[data-filter]')) b.querySelector('b').textContent = b.dataset.filter === 'sent' ? sent : unsent;
    bar.hidden = cnt.none === rs.length;
    bar.replaceChildren(...(bar.hidden ? [] : [wallBar(w, cnt, 'p' + w.id)]));
  }
  // 這台有的組合照片（照組合的順序）；目前這張用打開的那份。換照片時沿用上次讀的，renderGrpStrip 讀完會更新
  let grpMembers = [];
  const grpWalls = (w) => w.grp && grpMembers.some(x => x.id !== w.id && x.grp && x.grp.id === w.grp.id) ? grpMembers.map(x => x.id === w.id ? w : x) : [w];
  const thumbKey = (w) => w.grp ? w.grp.id : w.id;
  // 路線小卡：上面是這條路線的小圖（灰階牆面＋彩色岩點，裁到路線附近），下面大字難度和名稱，右上角紀錄標記
  function routeCard(w, r) {
    const b = document.createElement('button'); b.className = 'route-card'; b.dataset.id = r.id;
    // 小圖是圖片（不是畫布）：iOS 把 App 放到背景時會清掉畫布的內容，圖片不會
    const cv = document.createElement('img'); cv.className = 'rc-thumb'; cv.alt = ''; cv.draggable = false; cv.src = BLANK_IMG;
    const tx = document.createElement('span'); tx.className = 'rc-text';
    const g = setGrade(document.createElement('b'), r.grade); g.classList.add('rc-grade');
    const nm = document.createElement('span'); nm.className = 'rc-name'; nm.textContent = r.name || ''; nm.hidden = !r.name;
    tx.append(g, nm);
    b.append(cv, tx);
    if (!mineRoute(r)) { const a = document.createElement('span'); a.className = 'rc-sub'; a.textContent = r.author || t('rvSomeone'); tx.append(a); }   // 別人出的才放出線者（沒署名的寫「朋友」）：沒有名字＝自己出的
    const lm = logMark(r); if (lm) b.append(lm);
    if ((freshLines.get(w.id) || new Set()).has(r.id)) { const f = document.createElement('span'); f.className = 'rc-fresh'; f.textContent = t('freshTag'); b.append(f); }
    b.onclick = () => w === state.wall ? openRouteFrom(r.id, cv) : openWall(w.id).then(() => { if (state.wall && state.wall.id === w.id) openRoute(r.id); });   // 別張照片的路線：換到那張再開
    const hit = cachedThumb(w, r);
    if (hit) { cv.src = hit.url; cv.crop = hit.crop; } else { cv.dataset.todo = 1; if (w !== state.wall) cv.src = w.thumbHi || w.thumb || BLANK_IMG; }   // 別張照片的小圖還沒畫好：先放那張照片的縮圖，不留空白
    return b;
  }
  // 小圖存在 IndexedDB 的 thumbs（js/app.js；定完線、第一次畫好就存）：打開牆面一次讀出這面牆的全部，岩點和外框沒變就直接用。
  // 沒存或變了的才在背景一張一張畫（轉場結束後），畫好存回去。記憶體只留目前這面牆：路線 id → { sig, url, crop }
  const thumbCache = new Map();
  let thumbWall = null; const thumbLoaded = new Set();   // thumbWall：小圖屬於哪一面牆（組合是整組一份）；thumbLoaded：已經讀過 IndexedDB 的照片
  function cachedThumb(w, r) {
    if (thumbWall !== thumbKey(w)) { thumbWall = thumbKey(w); thumbLoaded.clear(); for (const e of thumbCache.values()) URL.revokeObjectURL(e.url); thumbCache.clear(); }
    const e = thumbCache.get(r.id);
    return e && e.sig === thumbSigOf(w, r) ? e : null;
  }
  function setThumb(w, r, sig, blob) {
    const old = thumbCache.get(r.id);
    if (old) URL.revokeObjectURL(old.url);
    const e = { sig, url: URL.createObjectURL(blob), crop: RouteKit.thumbCrop(w.w || state.w, w.h || state.h, holdsOf(r, w)) };
    thumbCache.set(r.id, e);
    return e;
  }
  // 畫一張、存起來（牆面頁和個人資料「我的線」都讀這份）；JPEG 編碼交給 toBlob 在背景做
  async function drawThumb(w, r, c = drawRouteThumb(w, r)) {
    if (w.m3d && w.m3d !== state.imgOf) return null;   // 3D 牆在背景重做快照：外框已經是新的、照片還是舊的，畫出來會對不上，等重新打開牆面再畫
    const sig = thumbSigOf(w, r), blob = await canvasBlob(c);
    if (!blob) return null;
    putThumb(w.id, r.id, sig, blob).catch(() => {});
    return state.wall === w && thumbWall === thumbKey(w) ? setThumb(w, r, sig, blob) : null;
  }
  async function loadThumbs(w, cur = w) {
    const range = thumbRange(w.id);
    const q = await tx('thumbs', 'readonly', s => ({ keys: s.getAllKeys(range), vals: s.getAll(range) })).catch(() => null);
    if (!q || state.wall !== cur || thumbWall !== thumbKey(cur)) return;
    const saved = new Map(q.keys.result.map((k, i) => [k[1], q.vals.result[i]]));
    for (const r of w.routes) { const v = saved.get(r.id); if (v && v.sig === thumbSigOf(w, r) && !cachedThumb(w, r)) setThumb(w, r, v.sig, v.blob); }
  }
  const foreignScenes = new Map();   // 組合裡別張照片的 RouteScene（畫小圖用，換牆就丟）
  async function drawForeignThumb(m, r, cur) {
    let sc = foreignScenes.get(m.id);
    if (!sc) {
      if (foreignScenes.size > 3) foreignScenes.clear();
      const blob = await getImage(m.id);
      if (!blob) return null;
      sc = RouteKit.scene(await blobToCanvas(blob), () => m.holds); foreignScenes.set(m.id, sc);
    }
    if (state.wall !== cur) return null;
    const sig = thumbSigOf(m, r), blob = await canvasBlob(drawRouteThumb(m, r, sc));
    if (!blob) return null;
    putThumb(m.id, r.id, sig, blob).catch(() => {});
    return state.wall === cur && thumbWall === thumbKey(cur) ? setThumb(m, r, sig, blob) : null;
  }
  let thumbBusy = false, scrollAt = 0;
  addEventListener('scroll', () => { scrollAt = performance.now(); }, { passive: true });
  async function queueThumbs() {
    if (thumbBusy) return; thumbBusy = true;
    const show = (cv, e) => { delete cv.dataset.todo; cv.src = e.url; cv.crop = e.crop; cv.classList.add('in'); };
    const todo = () => {   // 先畫看得到的（快速捲動時不從最上面一張張畫）
      if (!state.wall || $('wall').hidden) return null;
      const all = $('routeList').querySelectorAll('.rc-thumb[data-todo]');
      for (const c of all) { const b = c.getBoundingClientRect(); if (b.bottom > -200 && b.top < innerHeight + 600) return c; }
      return all[0] || null;
    };
    const ownerOf = (cv) => { const id = cv.closest('.route-card').dataset.id; for (const m of grpWalls(state.wall)) { const r = m.routes.find(x => x.id === id); if (r) return [m, r]; } return []; };   // 只有這張照片的路線畫得出小圖；別張的要先在那張打開過
    try {
      const w = state.wall;
      if (w && thumbWall === thumbKey(w)) for (const m of grpWalls(w)) if (!thumbLoaded.has(m.id)) { thumbLoaded.add(m.id); await loadThumbs(m, w); }
      for (let cv; (cv = todo()) && state.scene;) {
        const [m, r] = ownerOf(cv), hit = r && cachedThumb(m, r);
        if (hit || !r) { if (hit) show(cv, hit); else delete cv.dataset.todo; continue; }
        if (m !== w) {   // 別張照片的路線還沒有小圖：讀那張照片現畫一張（畫好存起來，之後直接讀）
          const e = await drawForeignThumb(m, r, w).catch(() => null);
          if (e && cv.isConnected) show(cv, e); else delete cv.dataset.todo;
          continue;
        }
        while (document.body.classList.contains('flying') || performance.now() - scrollAt < 160) await pause(50);   // 轉場中、手指還在捲的時候先不畫：一張要 30–90 ms，會卡住好幾格
        if (state.wall !== w || cv.dataset.todo === undefined || !cv.isConnected) continue;   // 等的時候離開了這面牆
        const e = await drawThumb(w, r);
        if (e && cv.isConnected) show(cv, e); else delete cv.dataset.todo;
        await pause(0);
      }
    } finally { thumbBusy = false; }
  }
  // 路線小卡（300×300）：src＝照片的 RouteScene，預設是打開的這面牆；個人資料畫別的牆的路線時另外讀（routeThumbsOf）
  const drawRouteThumb = (w, r, src = state.scene) => RouteKit.routeThumb(src, holdsOf(r, w));
  // 往下捲、橫幅捲出畫面後，標題列顯示牆名
  addEventListener('scroll', () => { if (!$('wall').hidden) $('wall').classList.toggle('hero-gone', $('wallHero').getBoundingClientRect().bottom < 60); }, { passive: true });
  // 轉場共用：一張圖（img 或 canvas）從 from 飛到 to（畫面座標），飛完拿掉；hide＝飛的時候先藏起來的目標（飛完再顯示）、page＝同時淡入的頁面。
  // 頁面淡入時右下的「＋」不跟著淡（路線圖和牆面頁同一個位置都有「＋」，淡入看起來像閃一下）；keep＝其他不淡入的元素、
  // over＝飛的圖底下要露出來的元素（例如小卡上的紀錄標記：飛的時候就在，不要等圖拿掉才跳出來）。
  // 飛的時候整頁不接受觸控（body.flying）：動畫跑到一半又點，前一個轉場會被硬收掉、畫面跳一下
  // 同一時間只有一個轉場：新的開始前，上一個立刻收掉（飛的圖拿掉、藏起來的顯示回來、淡入停掉），不會兩個疊在一起。
  // 切到背景動畫不跑時，1 秒後也一定收尾
  const reduceMotion = AppKit.ui.reducedMotion;
  let flyStop = null;
  const stopFly = () => { if (flyStop) flyStop(); };
  function fadeIn(page, keep) {
    keep = keep.filter(k => k && page.contains(k));
    const els = [], walk = (n) => { for (const c of n.children) if (!keep.includes(c)) (keep.some(k => c.contains(k)) ? walk(c) : els.push(c)); };
    walk(page);
    return els.map(e => e.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' }));
  }
  // 路線圖上 r（畫面座標）那一塊的樣子（照片層＋標籤層）；剛開的路線圖下一格才畫好，所以下一格再抓
  // grow：page（全螢幕）從飛的起點長出來：內容跟飛的圖同一個縮放（to 那一塊疊在 from 上），看得到的範圍從 from 展開到全螢幕；
  // 飛的圖（色調跟 page 不同）同時淡掉，卡片就像直接變成那一頁，不會停在上面再淡
  function growFrom(page, frames) {
    page.style.willChange = 'transform, clip-path';   // 全螢幕層先提升成合成層，縮放和裁切不用每格重繪整頁
    const a = page.animate(frames, { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
    a.finished.then(() => { page.style.willChange = ''; }, () => { page.style.willChange = ''; });
    return a;
  }
  function flyBetween(el, from, to, r0, r1, { grow = false, hide = null, page = null, enter = false, keep = [], over = [], done = null } = {}) {
    stopFly();
    el.className = 'hero-fly';
    Object.assign(el.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px` });
    document.body.append(el); document.body.classList.add('flying');
    if (hide) hide.style.visibility = 'hidden';
    if (enter) page.classList.add('entering');
    // 只動 transform（合成層）和 clip-path（只重繪），不動 left／top／width／height：版面固定在 to，
    // 等比縮放後用 clip-path 裁成 r 的長寬比、圓角除以縮放比，每一格都不觸發 layout
    const radii = (rad) => { const v = rad.split(' ').map(parseFloat); return v.length === 1 ? [v[0], v[0], v[0], v[0]] : v; };
    // grow：終點超出螢幕的那一圈（頁面沒有的部分）只剩縮圖、色調比頁面亮：起點完整保留（跟小卡一樣），隨轉場逐步裁掉，不留一條亮邊
    const off = grow ? { l: Math.max(0, -to.left), r: Math.max(0, to.left + to.width - innerWidth), t: Math.max(0, -to.top), b: Math.max(0, to.top + to.height - innerHeight) } : { l: 0, r: 0, t: 0, b: 0 };
    // 每一格分開算兩件事：內容（to 那一塊等比放大、置中蓋滿 r）和看得到的範圍（畫面座標的長方形），都從起點直線走到終點。
    // 直接內插 transform 和 clip-path 的話，裁切是在縮放前的座標裡走，乘上一路變的縮放比，四個邊到的時間不一樣（先到高度、再到寬度，像兩段）
    const N = 16, mix = (a, b, p) => a + (b - a) * p;
    const fit = (r) => { const k = Math.max(r.width / to.width, r.height / to.height); return { k, x: r.left + r.width / 2 - k * to.width / 2, y: r.top + r.height / 2 - k * to.height / 2 }; };
    const c0 = fit(from), c1 = fit(to), ra0 = radii(r0), ra1 = radii(r1);
    const win1 = { left: to.left + off.l, top: to.top + off.t, right: to.left + to.width - off.r, bottom: to.top + to.height - off.b };
    const frames = (ox, oy, w, h, end, rEnd) => Array.from({ length: N + 1 }, (_, i) => {
      const p = i / N, k = mix(c0.k, c1.k, p), x = mix(c0.x, c1.x, p), y = mix(c0.y, c1.y, p);   // to 的左上角落在畫面 (x, y)、放大 k 倍
      const L = mix(from.left, end.left, p), T = mix(from.top, end.top, p), R = mix(from.left + from.width, end.right, p), B = mix(from.top + from.height, end.bottom, p);
      const tx = x - k * (to.left - ox), ty = y - k * (to.top - oy);   // 元素自己的左上角（版面在 ox, oy）放大後落在畫面的位置
      const rad = ra0.map((v, j) => mix(v, rEnd[j], p) / k + 'px').join(' ');
      return { offset: p, transformOrigin: '0 0', transform: `translate(${tx - ox}px, ${ty - oy}px) scale(${k})`,
        clipPath: `inset(${(T - ty) / k}px ${w - (R - tx) / k}px ${h - (B - ty) / k}px ${(L - tx) / k}px round ${rad})` };
    });
    const anims = [el.animate(frames(to.left, to.top, to.width, to.height, win1, ra1), { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' })];
    if (grow) anims.push(growFrom(page, frames(0, 0, innerWidth, innerHeight, { left: 0, top: 0, right: innerWidth, bottom: innerHeight }, [0, 0, 0, 0])), el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-out', fill: 'forwards' }));
    else if (page && !enter) anims.push(...fadeIn(page, [page.querySelector('.rfab'), ...keep]));
    for (const o of over) o.style.zIndex = 41;   // .hero-fly 是 40
    let timer = 0, enterTimer = 0;
    const stop = () => {
      if (flyStop !== stop) return;
      flyStop = null; clearTimeout(timer);
      for (const a of anims) a.cancel();
      el.remove(); document.body.classList.remove('flying');
      if (hide) hide.style.visibility = '';
      for (const o of over) o.style.zIndex = '';
      if (enter) { clearTimeout(enterTimer); page.classList.remove('entering'); }
      if (grow) render();
      if (done) done();
    };
    flyStop = stop;
    timer = setTimeout(stop, 1000);
    anims[0].finished.then(() => {
      if (flyStop !== stop) return;
      el.remove(); document.body.classList.remove('flying'); if (hide) hide.style.visibility = '';
      for (const o of over) o.style.zIndex = '';
      if (enter) enterTimer = setTimeout(() => page.classList.remove('entering'), 400);
      if (grow) render();   // 長出來的途中頁面是縮小的，線寬照縮小的尺寸算（看起來很粗）：到位後照真的大小重畫
      flyStop = null; clearTimeout(timer);
      if (done) done();
    }, () => {});
  }
  // 卡片（路線小卡的小圖、首頁的照片）在畫面外就先捲到看得到，回傳它的位置
  function revealRect(el) {
    let r = el.getBoundingClientRect();
    if (r.bottom < 70 || r.top > innerHeight - 20) { el.scrollIntoView({ block: 'center' }); r = el.getBoundingClientRect(); }
    return r;
  }
  // 從路線小卡進入路線圖：路線圖從小卡長出來（小卡裁的那一塊對齊小卡，展開到全螢幕），小圖疊在上面跟著走、很快淡掉
  function openRouteFrom(id, cv) {
    const from = cv.getBoundingClientRect(), crop = cv.crop;
    stopFly();
    cardMorph = !!crop && !reduceMotion();
    try { openRoute(id); } finally { cardMorph = false; }
    if (!crop || reduceMotion()) return;
    const fly = document.createElement('canvas'); fly.width = fly.height = 300; fly.getContext('2d').drawImage(cv, 0, 0, 300, 300);
    const c = $('cv').getBoundingClientRect(), k = c.width / state.w, to = { left: c.left + crop.sx * k, top: c.top + crop.sy * k, width: crop.side * k, height: crop.side * k };
    // 這條第一次開：底圖（照片原尺寸）要現算，放在動畫第一格會卡住好幾格；先畫好再開始長
    draw(ctx);
    // 小卡裁的那一塊（正方形）放到路線視角會超出螢幕左右（直的路線）：長的途中照片不被畫面框裁掉，超出的部分也看得到，
    // 小卡的範圍就一路對得上，不會像頁面邊緣掃過去
    $('stage').style.overflow = 'visible';
    // 上方工具、完攀鈕不跟著頁面縮放（毛玻璃圓鈕在縮放、裁切中會閃）：長完才淡入
    const vw = $('vw'); vw.style.opacity = '0';
    flyBetween(fly, from, to, '18px', '4px', { grow: true, page: $('editor'), done: () => {
      $('stage').style.overflow = ''; vw.style.opacity = '';
      vw.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
    } });
  }
  // 從首頁卡片進入牆面：卡片的照片放大飛到橫幅的位置，下面的內容淡入往上
  async function openWallFrom(id, img) {
    const from = img.getBoundingClientRect(), src = img.currentSrc || img.src;
    stopFly();
    await openWall(id);
    if ($('wall').hidden || reduceMotion()) return;
    const target = $('wallPhoto');
    flyBetween(Object.assign(document.createElement('img'), { src, alt: '' }), from, target.getBoundingClientRect(), '18px', '20px', { hide: target, page: $('wall'), enter: true });
  }

  // 牆面頁右下「＋」：直接開一條新路線、進定線
  function startNewRoute() {
    if (!state.wall) return;
    // 新路線先保留在這台；使用者按分享連結才確認暱稱與公開授權。
    const r = newRoute(), card = $('wallPhoto'), from = card.getBoundingClientRect(), src = card.currentSrc || card.src, top = document.scrollingElement.scrollTop;
    save();
    openRoute(r.id, { edit: true });
    if (reduceMotion()) return;
    // 3D 牆（模型載好了）：3D 從卡片的樣子飛進牆前（W3D.flyFrom），編輯頁看得到的範圍同時從卡片展開到全螢幕（頁面本身不縮放，畫面只有 3D 在動）
    const fly = state.wall.m3d && from.bottom > 60 && src && W3D.flyFrom(from, card);
    if (!fly) { $('editor').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' }); return; }
    const ed = $('editor'), bars = [...ed.querySelectorAll('.ed-top, .ed-bottom')], rad = getComputedStyle($('wallHero')).borderTopLeftRadius;
    for (const b of bars) b.style.opacity = '0';   // 工具列飛完才淡入
    // 展開途中牆面頁留在下面（還沒展開到的地方不是一片黑），展開完再藏起來；途中不接受觸控
    const wall = $('wall'); wall.hidden = false; wall.inert = true; document.scrollingElement.scrollTop = top; document.body.classList.add('flying');
    const a = ed.animate([{ clipPath: `inset(${from.top}px ${innerWidth - from.right}px ${innerHeight - from.bottom}px ${from.left}px round ${rad})` }, { clipPath: 'inset(0px 0px 0px 0px round 0px)' }], { duration: fly.ms, easing: fly.easing });
    const end = () => {
      document.body.classList.remove('flying'); wall.inert = false;
      if (!ed.hidden) { wall.hidden = true; document.scrollingElement.scrollTop = 0; }
      for (const b of bars) { b.style.opacity = ''; b.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' }); }
    };
    a.finished.then(end, end);
  }

  // ---------- 編輯畫面（全螢幕）----------
  // 牆面頁捲到哪裡：進編輯（牆面頁藏起來，頁面捲回最上面）前記下來，回來時先捲回去再量小卡的位置
  let wallScroll = 0;
  let cardMorph = false;   // 從路線小卡進來：整頁從小卡長出來（openRouteFrom），不另外在頁面裡飛
  function openEditor(mode) {
    if (!state.wall) return;
    const lateral = !$('editor').hidden;
    if (!$('wall').hidden) wallScroll = document.scrollingElement.scrollTop;
    $('wall').hidden = true; $('editor').hidden = false;
    shownBase = '';   // 剛打開：畫布上還是上一次的畫面，不做換底色的轉場
    state.routeView = mode === 'route';
    lastViewing = null;   // 重新進來：顯示所有岩點回到關
    if (lateral) history.replaceState({ s: history.state.s }, '');   // 照片接力：編輯畫面一直開著，返回紀錄不多疊一層
    else history.pushState({ s: mode === 'route' ? 'view' : 'edit' }, '');
    view.layoutW = view.layoutH = -1;
    layoutStage(true);
    if (mode === 'holds') { editStart = wallSnap(state.wall); resetUndo(); }   // 岩點頁的復原只退這一段的修改
    setMode(mode);
    layoutStage(true);   // 切換模式後下方面板高度不同，依實際的框大小再排一次
    // 3D 牆看路線圖：從整面牆平滑地飛到路線視角（跟 2D 一樣不是直接跳過去）；3D 還在載入時先飛快照，鏡頭一直是正面
    if (state.wall.m3d && state.routeView && !reduceMotion() && !cardMorph) { const to = { s: view.s, tx: view.tx, ty: view.ty }, from = fitAll(); if (Math.abs(from.s - to.s) > 0.01) { setView(from.s, from.tx, from.ty); flyTo(to.s, to.tx, to.ty, null, 650); } }
    W3D.enter();
  }
  function closeEditor(fly = true) {
    if ($('editor').hidden) return;
    if (state.addType === 'n') hideToast();
    HoldCat.stop();
    if (state.draft) { state.draft = null; state.cursor = null; }
    state.selected = null; state.hover = null;
    if (state.mode === 'route') { settleEdit(); dropEmptyRoute(); }
    W3D.leave();
    stopFly();
    // 從路線圖回牆面：路線那一塊（小圖裁的範圍）從路線圖上的位置飛回它的小卡
    const w = state.wall, r = route();
    let back = null;
    if (fly && w && r && state.mode === 'route' && state.routeView && state.scene && !reduceMotion()) {
      // 飛回去的圖：存好的小圖；還沒畫好（小卡還沒輪到、剛改完的線）就現在畫一張，順便存起來
      const th = cachedThumb(w, r), drawn = !th && drawRouteThumb(w, r);
      if (drawn) drawThumb(w, r, drawn);
      const fly = th ? Object.assign(document.createElement('img'), { src: th.url, alt: '' }) : drawn, cr = th ? th.crop : drawn.crop;
      const c = $('cv').getBoundingClientRect(), k = c.width / state.w;
      back = { id: r.id, fly, from: { left: c.left + cr.sx * k, top: c.top + cr.sy * k, width: cr.side * k, height: cr.side * k } };
    }
    $('editor').hidden = true; $('wall').hidden = false;
    if (state.wall) putWall(state.wall).catch(() => {});
    if (r) showRouteRow(r.id);
    renderOverview(); document.scrollingElement.scrollTop = wallScroll;   // 先捲回進去前的位置，飛回小卡才會落在對的地方
    const card = back && $('routeList').querySelector(`.route-card[data-id="${back.id}"] .rc-thumb`);
    if (card) {
      const to = revealRect(card), fly = back.fly;
      const rc = card.closest('.route-card'), rad = getComputedStyle(rc).borderTopLeftRadius;   // 小圖本身沒有圓角：四角是小卡切出來的，飛到時就要一樣圓
      flyBetween(fly, back.from, to, '4px', rad, { hide: card, page: $('wall'), keep: [rc], over: [...rc.querySelectorAll('.log-mark')] });
    }
  }
  // 路線：先開路線圖（看），需要時再進編輯（多一層返回）
  function openRoute(id, { edit = false } = {}) {
    state.routeId = id;
    const inEdit = !$('editor').hidden && history.state && history.state.s === 'edit';   // 定線時接力到相鄰照片：同一層接著定
    openEditor('route');
    if (edit) enterRouteEdit({ fromWall: inEdit }); else showRouteFit();
  }
  let editNew = null;   // 這次編輯的是還沒有岩點的新路線（路線 id）：完成、回到同一條時分享鈕亮起小點（刪掉了就不亮）
  let editFork = null;   // 改別人的線：改的是另存的這條新線，{ id: 新線, from: 原本那條 }
  // fromWall：從牆面頁路線小卡的筆進來：取代路線圖那一層，完成或返回直接回牆面頁
  function enterRouteEdit({ fromWall = false } = {}) {
    if (!route()) return;
    if (isPublic(state.wall) && !mineRoute(route())) return;   // 公開牆只能修改自己的路線
    warmSam();
    HoldCat.stop();
    editNew = Object.keys(route().holds).length ? null : route().id;
    editStart = wallSnap(state.wall);   // 另存新線之前：取消時新線一起拿掉
    editFork = null;
    const r = route();
    if (!mineRoute(r)) {   // 別人的線不改：另存一條自己的新線來改（沒改就拿掉，見 settleEdit）
      const { author, u, pub, own, got, ...x } = r, w = state.wall;
      const f = touch({ ...JSON.parse(JSON.stringify(x)), id: uid('r'), name: '' });
      w.routes.splice(w.routes.indexOf(r) + 1, 0, f);
      state.routeId = f.id; editFork = { id: f.id, from: r.id };
      save(); resetUndo(); editFork.snap = wallSnap(w);
    }
    state.routeView = false;
    history[fromWall ? 'replaceState' : 'pushState']({ s: 'edit' }, '');
    setMode('route');
    setAddType(Object.keys(route().holds).length ? 'h' : 's');   // 新路線從起攀開始，修改時預設手點
  }
  // 離開定線：未修改的別人路線不保留副本；自己的修改僅存本機，使用者按分享後才發佈
  function settleEdit() {
    const w = state.wall, f = editFork, r = route();
    editFork = null;
    if (!w || !r) return;
    const from = f && r.id === f.id && w.routes.find(x => x.id === f.from);
    if (from && wallSnap(w) === f.snap) { w.routes.splice(w.routes.indexOf(r), 1); state.routeId = from.id; save(); return; }
  }
  function stepRoute(d, { paged = false } = {}) {
    const rs = sortedRoutes(), i = rs.findIndex(r => r.id === state.routeId), j = i + d;
    if (i >= 0 && (j < 0 || j >= rs.length) && relayOf(d)) { openRelay(d); return; }
    if (i < 0 || j < 0 || j >= rs.length) return;
    HoldCat.stop();
    W3D.untilt();
    state.routeId = rs[j].id;
    setMode('route');
    showRouteFit();
    refreshXfer();
    if (paged) { reveal = null; tagIn = 0; return; }   // 跟手翻頁已完成，不再重播進場
    // 新的一條從切換的方向滑進來
    const st = $('stage');
    st.classList.remove('slide-next', 'slide-prev');
    void st.offsetWidth;
    st.classList.add(d > 0 ? 'slide-next' : 'slide-prev');
    startReveal();
  }
  // 換路線時岩點照出手順序一顆顆亮起（約 1 秒）：先蓋上灰階的底，再一組一組淡出；岩點都出來了，標籤（S／T、腳點、順序編號）才淡入
  let reveal = null, tagIn = 0;
  function startReveal() {
    reveal = null; tagIn = 0;
    const r = route();
    if (calm() || !r || !state.routeView || !state.scene) return;
    const holds = holdsOf(r);
    if (holds.length < 2) return;
    const gray = state.scene.plain(baseMode());
    const steps = RouteKit.revealSteps(r, holds);
    reveal = { rid: r.id, t0: performance.now() + 180, steps, gray, step: Math.min(0.165, 0.75 / steps.length), pad: Math.max(state.w, state.h) / 400 };
    render();
  }
  function drawReveal(c) {
    const R = reveal, t = (performance.now() - R.t0) / 1000, FADE = 0.27;
    let left = false;
    R.steps.forEach((hs, i) => {
      const a = Math.min(1, Math.max(0, (t - i * R.step) / FADE));
      if (a >= 1) return;
      left = true;
      c.save(); c.globalAlpha = 1 - a; c.beginPath();
      for (const h of hs) { const b = bbox(h.poly); c.rect(b.x0 - R.pad, b.y0 - R.pad, b.x1 - b.x0 + 2 * R.pad, b.y1 - b.y0 + 2 * R.pad); }
      c.clip(); c.drawImage(R.gray, 0, 0); c.restore();
    });
    if (left) { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (state.wall) draw(ctx); }); } else { reveal = null; tagIn = performance.now(); }
    return left;
  }
  // 標籤淡入的透明度（0.3 秒）；淡完回 1
  function tagAlpha() {
    if (!tagIn) return 1;
    const a = (performance.now() - tagIn) / 300;
    if (a >= 1) { tagIn = 0; return 1; }
    cancelAnimationFrame(raf); raf = requestAnimationFrame(() => draw(ctx));
    return Math.max(0, a);
  }
  $('stage').addEventListener('animationend', () => $('stage').classList.remove('slide-next', 'slide-prev'));
  const neighborRoute = (d) => {
    const rs = sortedRoutes(), i = rs.findIndex(r => r.id === state.routeId);
    return i < 0 ? null : rs[i + d] || null;
  };
  // 同一面牆的幾張照片（w.grp）：換線到這張的頭尾再往外，接到相鄰那張（照片接力）。打開牆時先讀好左右最近、有路線的那張
  const relays = new Map();   // 方向（-1／1）→ { w, r: 要打開的路線, img: 縮圖 }
  async function loadRelays(w) {
    relays.clear();
    if (!w || !w.grp) return;
    const ids = w.grp.ids, i = ids.indexOf(w.id);
    for (const d of [-1, 1]) for (let j = i + d; i >= 0 && j >= 0 && j < ids.length; j += d) {
      const x = await getWall(ids[j]).catch(() => null);
      if (state.wall !== w) return;
      if (!x || !x.routes.length) continue;
      const rs = sortedRoutes(x), img = new Image();
      img.src = x.thumbHi || x.thumb || '';
      relays.set(d, { w: x, r: d > 0 ? rs[0] : rs[rs.length - 1], img });
      break;
    }
  }
  const relayOf = (d) => neighborRoute(d) ? null : relays.get(d) || null;
  // ---------- 跨照片的路線：路線存在起攀那張（家）；別張照片的岩點寫成「照片編號#岩點 id」，外框換算到家那張的座標存 ----------
  const farKey = (k) => k.includes('#');
  // 同一面牆裡照片 from → to 的 3×3（依列排）：沿著 grp.links 接起來；只有位移的連結用平移（b 的原點在 a 的座標＝dx、dy）
  function grpH(grp, from, to) {
    const mul = (A, B) => Array.from({ length: 9 }, (_, i) => { const r = (i / 3) | 0, c = i % 3; return A[3 * r] * B[c] + A[3 * r + 1] * B[3 + c] + A[3 * r + 2] * B[6 + c]; });
    const inv = (m) => { const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = f * g - d * i, C = d * h - e * g, det = a * A + b * B + c * C; return [A, c * h - b * i, b * f - c * e, B, a * i - c * g, c * d - a * f, C, b * g - a * h, a * e - b * d].map(v => v / det); };
    const step = (l) => l.H || [1, 0, -l.dx, 0, 1, -l.dy, 0, 0, 1];   // a → b
    const T = new Map([[from, [1, 0, 0, 0, 1, 0, 0, 0, 1]]]), q = [from];
    while (q.length) {
      const a = q.shift();
      for (const l of grp.links) {
        const b = l.a === a ? l.b : l.b === a ? l.a : null;
        if (!b || T.has(b)) continue;
        T.set(b, mul(l.a === a ? step(l) : inv(step(l)), T.get(a))); q.push(b);
      }
    }
    return T.get(to) || null;
  }
  const mapPoly = (H, poly) => poly.map(([x, y]) => { const z = H[6] * x + H[7] * y + H[8]; return [Math.round((H[0] * x + H[1] * y + H[2]) / z * 10) / 10, Math.round((H[3] * x + H[4] * y + H[5]) / z * 10) / 10]; });
  // 把路線換到另一張照片：岩點 id 換成那張照片看的寫法、外框照對齊換座標（from、to：照片編號）
  function moveRoute(r, grp, from, to) {
    const H = grpH(grp, from, to);
    if (!H) return null;
    const key = (k) => farKey(k) ? (k.startsWith(to + '#') ? k.slice(to.length + 1) : k) : `${from}#${k}`;
    const holds = {}, shapes = {};
    for (const [k, v] of Object.entries(r.holds)) holds[key(k)] = v;
    for (const [k, x] of Object.entries(r.shapes || {})) shapes[key(k)] = { ...x, id: key(k), poly: mapPoly(H, x.poly) };
    return { ...JSON.parse(JSON.stringify(r)), holds, shapes, ...(r.seq ? { seq: r.seq.map(key) } : {}) };
  }
  // 這面牆上投影過來的路線（xfer＝家那張的照片編號）改了：換回家那張的寫法存回去
  async function writeBackXfer(w) {
    for (const r of w.routes.filter(x => x.xfer && w.grp)) {
      const home = await getWall(r.xfer).catch(() => null), back = home && moveRoute(r, w.grp, w.id, home.id);
      if (!back) continue;
      delete back.xfer;
      const i = home.routes.findIndex(x => x.id === r.id);
      if (i >= 0 && JSON.stringify(home.routes[i]) === JSON.stringify(back)) continue;
      if (i >= 0) home.routes[i] = back; else home.routes.push(back);
      home.updatedAt = Date.now();
      await putWall(home).catch(() => toast(t('saveFailed')));
    }
  }
  // 「接到相鄰照片」的按鈕：看線時路線有那邊照片的岩點（或這條是從那邊投影過來的）才出；定線時相鄰照片都出（自己的線）
  function refreshXfer() {
    const w = state.wall, r = state.mode === 'route' && route(), ids = w && w.grp ? w.grp.ids : [], i = w ? ids.indexOf(w.id) : -1, dirs = new Set();
    if (r && i >= 0) {
      if (!state.routeView) { if (mineRoute(r)) for (const d of [-1, 1]) if (ids[i + d]) dirs.add(d); }
      else for (const p of [...Object.keys(r.holds).filter(farKey).map(k => k.split('#')[0]), ...(r.xfer ? [r.xfer] : [])]) { const j = ids.indexOf(p); if (j >= 0 && j !== i) dirs.add(Math.sign(j - i)); }
    }
    $('xferPrev').hidden = !dirs.has(-1); $('xferNext').hidden = !dirs.has(1);
    for (const id of ['xferPrev', 'xferNext']) $(id).dataset.axis = w && w.grp && w.grp.axis === 'v' ? 'v' : 'h';   // 上下排的組合：按鈕在上下邊
  }
  $('xferPrev').onclick = () => openXfer(-1, { edit: !state.routeView });
  $('xferNext').onclick = () => openXfer(1, { edit: !state.routeView });
  // 在相鄰照片上看（或接著定）這條路線：打開那張，路線投影過去當暫時的一條
  async function openXfer(d, { edit = false } = {}) {
    const w = state.wall, r = route(), ids = w && w.grp && w.grp.ids, to = ids && ids[ids.indexOf(w.id) + d];
    if (!r || !to) return;
    const home = r.xfer || w.id, src = r.xfer ? moveRoute(r, w.grp, w.id, home) : r, grp = w.grp;
    await openWall(to);
    const x = state.wall;
    if (!x || x.id !== to) return;
    if (to !== home) {
      const t2 = moveRoute(src, grp, home, to);
      if (!t2) return;
      t2.xfer = home; x.routes = x.routes.filter(y => y.id !== r.id).concat(t2);
    }
    openRoute(r.id, { edit });
  }
  async function openRelay(d) {
    const x = relays.get(d);
    if (!x) return;
    await openWall(x.w.id);
    if (state.wall && state.wall.id === x.w.id) openRoute(x.r.id);
  }
  $('editRouteBtn').onclick = () => { $('edMenu').hidden = true; enterRouteEdit(); };
  $('edBack').onclick = () => history.back();

  // ---------- 返回鍵／返回手勢：首頁 ← 牆面頁 ← 編輯（裁切也算一層）----------
  let leaveIncomplete = () => {};   // js/main.js 接上
  let leaving = false;   // 按「取消」離開定線（已經回到進來前的樣子）：返回時不再檢查起攀、完攀
  // App 自己呼叫的返回（按 ✓、取消、關選單…）記下時間：新手關卡只擋使用者的返回手勢／返回鍵，不擋這些
  let selfBack = 0;
  // iPhone 主畫面的 App：不留瀏覽紀錄，App 自己記一疊畫面（pages）。系統的返回手勢是拿上一頁的截圖滑過來，用起來像網頁；
  // 沒有上一頁就不會出現，返回改由 App 自己跟手的手勢（js/mobile.js 的 edgeBack）。Safari、Android 照常用瀏覽紀錄
  const ownStack = document.documentElement.classList.contains('ios-app');
  const pages = [history.state];
  const nativeReplace = history.replaceState.bind(history);
  let histBack = history.back.bind(history), histGo = history.go.bind(history), histPush = history.pushState.bind(history), histReplace = nativeReplace;
  if (ownStack) {
    histPush = (st, title, url) => { pages.push(st); nativeReplace(st, title, url); };
    histReplace = (st, title, url) => { pages[pages.length - 1] = st; nativeReplace(st, title, url); };
    histGo = (n) => {
      const i = Math.max(0, pages.length - 1 + Math.min(0, n)), st = pages[i];
      if (i === pages.length - 1) return;
      pages.length = i + 1; nativeReplace(st, '');
      setTimeout(() => dispatchEvent(new PopStateEvent('popstate', { state: st })), 0);   // 跟真的返回一樣晚一拍才通知
    };
    histBack = () => histGo(-1);
  }
  // 上一層是哪個畫面（只有自己記畫面時才知道）；edgeBack 放手時用 userBack 返回，跟系統的返回手勢一樣不算 App 自己的返回
  const prevPage = () => ownStack && pages.length > 1 ? ((pages[pages.length - 2] && pages[pages.length - 2].s) || 'home') : null;
  const userBack = () => histBack();
  history.back = () => { selfBack = performance.now(); histBack(); };
  history.go = (n) => { if (n < 0) selfBack = performance.now(); histGo(n); };
  // iPhone 從右緣向左滑是瀏覽器的「前進」，會回到剛退出的那一層；App 只有返回，前進一律退回去（Android 沒有前進手勢）
  // 每一層記著深度 n，深度變大就是前進；退回去造成的那次 popstate 也整個略過（其他 popstate 監聽都在這之後加）
  let depth = (history.state && history.state.n) || 0, undoForward = false;
  history.pushState = (st, title, url) => { histPush({ ...st, n: ++depth }, title, url); if (navigator.userActivation && !navigator.userActivation.isActive) guardBack(); };
  history.replaceState = (st, title, url) => histReplace({ ...st, n: depth }, title, url);
  // 沒有使用者操作就推進去的一層（點連結打開路線），Android Chrome 的返回會整個跳過、直接離開 App：
  // 用 CloseWatcher 接住返回手勢，一次退一層，直到回到首頁
  let backWatch = null, guarding = false;
  function guardBack() {
    guarding = depth > 0;
    if (!guarding || backWatch || typeof CloseWatcher !== 'function') return;
    try { backWatch = new CloseWatcher(); } catch (e) { return; }
    backWatch.onclose = () => { backWatch = null; userBack(); };
  }
  window.addEventListener('popstate', () => setTimeout(() => {   // 等下面的返回處理完（depth 更新、可能又推一層）
    if (!guarding) return;
    if (!depth && backWatch) { backWatch.destroy(); backWatch = null; }
    guardBack();
  }));
  window.addEventListener('popstate', (e) => {
    const n = (e.state && e.state.n) || 0;
    if (undoForward) { undoForward = false; e.stopImmediatePropagation(); return; }
    if (n > depth) { undoForward = true; e.stopImmediatePropagation(); histGo(depth - n); return; }
    depth = n;
    // iPhone 的返回手勢（Safari 的截圖、主畫面 App 的 edgeBack）邊滑邊露出上一頁（卡片已經在原位）：放開後不再飛回卡片，不然卡片會閃一下
    const fly = !(isIos && !selfBack);
    selfBack = 0;
    if (overlayBack()) return;   // 對話框那一層
    const s = (e.state && e.state.s) || 'home';
    stopFly();   // 上一個轉場還沒跑完就按返回：先收掉，不跟返回的轉場疊在一起
    const fromFind = !$('find').hidden;
    for (const id of LAYERS) $(id).hidden = true;
    if (fromFind && s !== 'find') welcomeAgain();   // 沒有牆的人從開場進找牆面、什麼都沒收就返回：回到開場畫面
    if (s === 'menu') { history.back(); return; }   // 選單已經關了留下的一層：跳過
    closeShare(); closeRecv(); closeScan();
    if (!$('crop').hidden && s !== 'crop') { crop.src = null; $('crop').hidden = true; welcomeAgain(); }
    const canceled = leaving; leaving = false;
    // 增加照片後在牆面頁按返回：退到的那一層是原本那張照片，畫面還是新照片，換回原本那張
    if (s === 'wall' && e.state.id && state.wall && e.state.id !== state.wall.id && $('editor').hidden && !$('wall').hidden) { openWall(e.state.id); return; }
    if (!$('editor').hidden) {
      if (state.holdSub && s === 'edit') { leaveHoldEdit(); return; }   // 從定線長按進來的岩點編輯 → 回到定線
      // 返回手勢離開定線，但路線有點、還沒有起攀和完攀（「完成」按不下去的狀態）：留在定線，問要不要放棄這次的修改（按「取消」離開的不擋）
      const r = route();
      if (!canceled && s !== 'edit' && state.mode === 'route' && !state.routeView && !state.holdSub && r && Object.keys(r.holds).length && !routeReady(r)) {
        history.pushState({ s: 'edit' }, '');
        leaveIncomplete();
        return;
      }
      if (s === 'view' && state.mode === 'route' && !state.routeView) {   // 編輯 → 路線圖
        settleEdit();
        if (dropEmptyRoute()) { history.back(); return; }   // 沒加任何點：不存，直接回牆面頁
        W3D.untilt();   // 3D 牆定線時走近、轉過：轉回正面再看整條路線（小圖也用正面的外框畫）
        state.routeView = true; setMode('route'); showRouteFit(true);
        if (route() && Object.keys(route().holds).length) drawThumb(state.wall, route());   // 定完線就存小圖
        if (editNew && editNew === state.routeId && route() && Object.keys(route().holds).length) { routeMade(); }
        editNew = null;   // 定線新手關卡（0.6 秒後接著跑）在的話就不浮出
        return;
      }
      if (s !== 'edit' && s !== 'view') closeEditor(fly);
    }
    if (s === 'home' && ($('home').hidden || $('home').classList.contains('edge-under'))) {   // edge-under：返回手勢已經把首頁露出來了
      if (state.wall) putWall(state.wall).catch(() => {});
      // 從牆面回首頁：橫幅的照片飛回這面牆的卡片
      const ph = $('wallPhoto'), back = fly && !$('wall').hidden && state.wall && ph.src && !reduceMotion()
        ? { id: state.wall.id, from: ph.getBoundingClientRect() } : null;
      // 首頁先顯示、等列出牆面才開始飛：中間那幾格內容先藏著（標題列除外），不會先整頁出現、再變透明淡入
      if (back) $('home').classList.add('pre-fly');
      showHome().finally(() => $('home').classList.remove('pre-fly')).then(() => {
        const img = back && document.querySelector(`#wallList .wall-card[data-id="${back.id}"] img`);
        if (!img) return;
        const to = revealRect(img);
        // 飛的圖用卡片自己那張（4:3 裁好的縮圖）：橫幅是原圖裁 4:3，跟它一樣；用原圖的話直式、很寬的照片最後換回卡片時會閃一下
        flyBetween(Object.assign(document.createElement('img'), { src: img.currentSrc || img.src, alt: '' }), back.from, to, '20px', '18px', { hide: img, page: $('home'), keep: [$('home').querySelector('.bar')] });   // 標題列（logo）不淡入：回首頁時已經先顯示了，淡入會先消失再出現
      });
    }
  });

  // ---------- 提示（AppKit.ui）：action＝{ label, run } 提示右邊多一顆按鈕（例如刪除後的「復原」），顯示 5 秒；busy 轉圈不自動消失 ----------
  const { toast, hideToast } = AppKit.ui;

  // ---------- 縮放與平移：兩指縮放／一指拖曳（放大時）／觸控板捏合或 Ctrl＋滾輪 ----------
  // 圖片先依框的大小「剛好放進去」（base），再用 transform 疊上縮放 view.s 與位移 view.tx/ty。
  // 點擊座標用 getBoundingClientRect 換算，會自動算進 transform。
  const MAX_SCALE = 10;
  const view = { s: 1, tx: 0, ty: 0, bw: 0, bh: 0 };
  let suppressClick = false;
  // 舞台大小由 CSS 決定（編輯畫面除了上下工具列都是舞台），照片等比塞進去
  function layoutStage(reset = false) {
    if (!state.img) return;
    const stage = $('stage'), W = stage.clientWidth, H = stage.clientHeight;
    if (!W || !H) return;
    if (typeof resetRouteSwipe === 'function') resetRouteSwipe();
    // 重排前記住畫面中心對到照片的哪一點，重排後放回中心（保留縮放）
    // 中心要用舊的框大小算：平板轉向時框已經變了，用新的會讓放大的地方跑掉
    const keep = !reset && view.bw > 0;
    const cx = keep ? (view.layoutW / 2 - view.tx) / (view.bw * view.s) : 0.5, cy = keep ? (view.layoutH / 2 - view.ty) / (view.bh * view.s) : 0.5;
    const [bw, bh, ft, FH] = baseSize(W, H);
    const resized = bw !== view.bw || bh !== view.bh;
    view.bw = bw; view.bh = bh; view.layoutW = W; view.layoutH = H;
    cv.style.width = bw + 'px'; cv.style.height = bh + 'px';
    const s = keep ? view.s : 1;
    setView(s, W / 2 - cx * bw * s, ft + FH / 2 - cy * bh * s);
    if (resized) render();   // 照片大小變了但縮放、位移剛好沒變（例如收起側欄）：setView 不會重畫線條層
  }
  // 照片 100% 時的大小：等比放進舞台扣掉 fitPads 的範圍。回傳 [寬, 高, 範圍上緣, 範圍高]
  function baseSize(W, H) {
    const aspect = state.w / state.h, [ft, fb, fx] = fitPads(), FH = H - ft - fb, FW = W - 2 * fx;
    return FW / aspect > FH ? [FH * aspect, FH, ft, FH] : [FW, FW / aspect, ft, FH];
  }
  // 換模式後工具列不同（電腦寬度看路線圖沒有工具列、定線有），照片 100% 的大小跟著變就重排（保留縮放）
  function refitStage() {
    const st = $('stage');
    if (state.img && view.bw && Math.abs(baseSize(st.clientWidth, st.clientHeight)[0] - view.bw) > 0.5) layoutStage();
  }
  // 照片最大放大到 1 個照片像素＝4 個螢幕點（至少 10 倍）：高解析的牆小岩點很多，10 倍還小到調不了外框
  const baseMaxScale = () => RouteKit.maxScaleOf(state.w || 0, view.bw || Infinity);   // 算法在 kit（routekit/viewport.js）
  // 一般的放大（飛到岩點、貼合路線）照這個上限。3D 牆另外有硬上限：最小縮放已經放大了（填滿畫面），鏡頭走近時裁切的放大倍數也跟著變大，
  // 上限要乘上最小縮放，不然拖、捏合時 3D 算出的視角被夾住、跟手指對不上
  const maxScale = baseMaxScale;
  const hardMaxScale = () => baseMaxScale() * (state.wall && state.wall.m3d ? minScale() : 1);
  // 定線、單點編輯（手機）：上下浮著的工具列蓋住照片一截。可以拖的範圍多留這兩段，照片最上、最下的岩點都拖得到工具列外面點得到
  function editPads() {
    if ($('editor').hidden || state.routeView) return [0, 0];
    if (editorUi && state.mode === 'route') return editorUi.pads($('stage'));   // 定線：上下浮著的是 kit 操作介面（RouteKit.EditorUI）的列
    const st = $('stage').getBoundingClientRect(), top = $('editor').querySelector('.ed-top'), bot = $('editor').querySelector('.ed-bottom');
    return [Math.max(0, top.getBoundingClientRect().bottom - st.top), Math.max(0, st.bottom - bot.getBoundingClientRect().top)];
  }
  // 電腦寬度的 2D 照片：100% 時整張放在上下工具列中間、左右讓開右邊的縮放鈕（兩邊各讓一樣寬，照片照樣置中），不被蓋住。
  // 手機畫面小，照樣塞滿舞台、工具列浮在上面。回傳 [上, 下, 左右各讓多少]
  function fitPads() {
    if (!matchMedia('(min-width: 900px)').matches || (state.wall && state.wall.m3d)) return [0, 0, 0];
    const z = document.querySelector('#editor .photo-zoom').getBoundingClientRect();
    return [...editPads(), z.width ? $('stage').getBoundingClientRect().right - z.left + 12 : 0];
  }
  // 最小的縮放：3D 牆的快照是整個模型的正面，岩點只佔其中一塊（很寬的牆在直的手機上上下大片空白）。
  // 最小就放到岩點範圍填滿畫面（跟 2D 照片一樣是使用者的工作區，不用手動放大；超出的左右再拖）。範圍用正面時的外框（轉角度後外框會換，這裡存第一次的）
  const homeBoxes = new Map();
  let routeFloor = Infinity;   // 看路線圖目前這條路線（組）的路線視角倍數：比填滿畫面的最小縮放小就以它為最小縮放
  function holdsBox() {
    const w = state.wall, key = w.id + '|' + (w.m3d || '');
    if (!homeBoxes.has(key)) { const hs = w.holds.filter(h => h.poly && h.poly.length); homeBoxes.set(key, hs.length ? bbox(hs.flatMap(h => h.poly)) : null); }
    return homeBoxes.get(key);
  }
  function minScale() {
    if (!state.wall || !state.wall.m3d || !view.bw) return 1;
    const st = $('stage'), b = holdsBox(), k = view.bw / state.w;
    if (!b) return 1;
    const fill = Math.max(1, Math.min(st.clientHeight / ((b.y1 - b.y0) * k), baseMaxScale()));
    return state.routeView ? Math.max(1, Math.min(fill, routeFloor)) : fill;   // 看路線圖：路線比畫面寬時整條放進畫面，最小縮放降到那個倍數（見 fitBox）   // 岩點的高度填滿畫面；寬度超出的左右拖
  }
  // 縮小的下限：手機照 minScale（岩點高度填滿畫面，寬的牆左右拖）。電腦的畫面寬，3D 牆還有空間就能縮到整個岩點範圍放進畫面（寬度也放得下）為止，
  // 但不比 0.25 倍小；起始視角（fitAll）照舊是 minScale，只有縮放的下限放寬。看路線圖維持路線視角的規則
  function zoomFloor() {
    const m = minScale();
    if (!state.wall || !state.wall.m3d || state.routeView || !view.bw || !matchMedia('(min-width: 900px)').matches) return m;
    const b = holdsBox(); if (!b) return m;
    const st = $('stage'), k = view.bw / state.w, wide = st.clientWidth / Math.max(1, (b.x1 - b.x0) * k);
    return Math.min(m, Math.max(0.25, wide));
  }
  // 整面牆的視角（最小縮放、岩點範圍置中）
  function fitAll() {
    const st = $('stage'), s = minScale(), b = state.wall && state.wall.m3d ? holdsBox() : null, k1 = view.bw / state.w * s;
    return b ? clampView(s, st.clientWidth / 2 - (b.x0 + b.x1) / 2 * k1, st.clientHeight / 2 - (b.y0 + b.y1) / 2 * k1)
      : clampView(s, (st.clientWidth - view.bw * s) / 2, (st.clientHeight - view.bh * s) / 2);
  }
  // 縮放、位移套上邊界：圖比框小時置中，比框大時不讓邊緣露出空白（上下多留工具列蓋住的那段）
  function clampView(s, tx, ty) {
    const stage = $('stage'), W = stage.clientWidth, H = stage.clientHeight, pads = editPads();
    const lo = state.w3d && state.w3d.tilted && state.w3d.along ? 0 : zoomFloor();   // 沿牆走的鏡頭：裁切固定（快照高度＝畫面高度），可能比 2D 的最小縮放還小
    // 3D 牆走近、轉過角度後，快照外面也畫得出牆：拖到快照的邊碰到畫面中央為止
    // （正面快照只框到岩點外一小圈，鏡頭走到最外側、最高、最低的岩點時目標會落在快照外面；範圍放寬一個快照的大小，不然拖到那裡就卡住）
    if (state.w3d && state.w3d.tilted) {
      s = Math.min(hardMaxScale(), Math.max(lo, s));
      const w = view.bw * s, h = view.bh * s;
      return { s, tx: Math.min(W / 2 + w, Math.max(W / 2 - 2 * w, tx)), ty: Math.min(H / 2 + h, Math.max(H / 2 - 2 * h, ty)) };
    }
    // 其餘（縮放下限、邊界、置中、工具列讓出的範圍）是 kit 的同一份：routekit/viewport.js 的 clampView，內嵌頁的縮放平移也用它
    return RouteKit.clampView(s, tx, ty, { W, H, bw: view.bw, bh: view.bh, pads, maxScale: hardMaxScale(), minScale: lo, fitPads: fitPads() });
  }
  // 看路線圖的起始視角（路線視角）：路線（所在那一組）的岩點剛好放進畫面（四周留邊、上面避開標題），最多放大到照片填滿畫面，路線放中間。
  // 橫的照片在直的手機上不會上下大片黑邊；很寬的路線放大得少，最寬就是整張照片
  // 路線視角分組：照左右滑的順序把相鄰路線併成一組，共用整組岩點範圍的視角，同一組滑動時照片大小、位置都不變。
  // 併進來後組裡每條都還保留自己視角至少 GROUP_KEEP 的放大才併，範圍差很多的路線（大牆的不同區）照樣各自放大；沒有岩點的路線看整張、自成一組
  const GROUP_KEEP = 0.7;
  // 路線視角：路線岩點加上起攀、完攀的標籤（圓和膠帶）都放進畫面，標籤不會被畫面邊緣切掉。
  // 標籤的大小（labelUnit）要看只有岩點的視角（holdFit），不然標籤算大小時又回頭問視角，繞圈
  function routeFit(r) {
    const b = r && view.bw ? groupBox(r, true) : null;
    return b ? fitBox(b) : fitAll();
  }
  function holdFit(r) {
    const b = r && view.bw ? groupBox(r) : null;
    return b ? fitBox(b) : fitAll();
  }
  // 路線所在那一組的岩點範圍、把範圍放進畫面的視角：算法在 kit（routekit/fit.js，內嵌頁看路線同一份），這裡只接岩點貓的資料（路線順序、別張照片的岩點、標籤、邊界）
  function groupBox(r, withLabels = false) {
    return RouteKit.groupBox(sortedRoutes(), r, {
      holdsOf: q => holdsOf(q).filter(h => !farKey(h.id)),   // 別張照片的岩點不算進視角
      labelRects: withLabels ? (hs, q) => placeTypeLabels(hs, q, labelUnit(q), true).flatMap(l => l.foot ? [l.rect] : [l.rect, l.tape]) : null,
      fit: b => fitBox(b),
    });
  }
  // 把照片上的範圍 b（四周留邊、上面避開標題）放進畫面的視角，最多放大到照片填滿畫面
  function fitBox(b) {
    const st = $('stage'), top = parseFloat(getComputedStyle($('vwBack')).top) + 52;   // 返回鈕和標題那一列（含安全區）
    const f = RouteKit.fitBoxIn(b, { W: st.clientWidth, H: st.clientHeight, bw: view.bw, bh: view.bh, maxScale: maxScale() }, { photoW: state.w, topInset: top });
    if (state.routeView) routeFloor = f.s;
    return clampView(f.s, f.tx, f.ty);
  }
  // 3D 牆進定線一條還沒有點的新線：從整面牆飛近（不然一進來太小，要自己放大才能選點）。
  // 飛到最近定的那條線（自己的、有點、出線最晚）的路線視角；還沒定過就是牆的中央、照片的高度填滿畫面
  function introZoom() {
    const last = state.wall.routes.filter(q => q.id !== state.routeId && mineRoute(q) && holdsOf(q).length).sort((a, b) => routeBorn(b) - routeBorn(a))[0];
    const to = last ? fitBox(bbox(holdsOf(last).flatMap(h => h.poly))) : fitAll();
    flyTo(to.s, to.tx, to.ty, null, 700);   // 只放大、鏡頭不走近：還是正面的鏡頭，看線的路線視角、修點照常
  }
  const routeZoomed = () => view.s > routeFit(route()).s + 0.01;   // 看路線圖比路線視角放得更大（左右滑、返回手勢讓給拖曳）
  function showRouteFit(fly = false) {
    if (!state.routeView) return;
    if (W3D.frame(route())) return;   // 3D 牆沿牆走的鏡頭：鏡頭走到框住路線的位置
    const f = routeFit(route());
    if (fly) flyTo(f.s, f.tx, f.ty); else setView(f.s, f.tx, f.ty);
  }
  function setView(s, tx, ty) {
    ({ s, tx, ty } = clampView(s, tx, ty));
    const moved = s !== view.s || tx !== view.tx || ty !== view.ty;
    view.s = s; view.tx = tx; view.ty = ty;
    if (moved) viewMoved();   // 線條層：縮放、拖曳中整層跟著變形，停下再重畫（見 draw.js）
    cv.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    view.min = minScale();
    if (state.w3d) state.w3d.setView(view);
    $('zoomV').textContent = Math.round(s * 100) + '%';
    placeHoldActions();
  }
  // 手機單點編輯：復原、刪除的膠囊浮在選到的岩點下方（下面放不下就放上方），跟著縮放、拖曳、改形狀移動；岩點移出畫面時停在畫面邊緣
  function placeHoldActions() {
    const el = $('holdActions'), h = state.selected;
    if (state.mode !== 'holds' || !(h || state.lasso) || el.hidden) return;
    const st = $('stage').getBoundingClientRect(), k = view.bw * view.s / state.w;
    const w = el.offsetWidth, ht = el.offsetHeight, gap = 18, top = Math.max(st.top + 70, $('samProg').hidden ? 0 : $('samProg').getBoundingClientRect().bottom + 12), bottom = st.bottom - 26 - ht;
    if (state.lasso) { el.style.left = `${Math.round(st.right - 12 - w)}px`; el.style.top = `${Math.round(bottom)}px`; return; }
    const b = bbox(h.poly), cx = st.left + view.tx + (b.x0 + b.x1) / 2 * k, y0 = st.top + view.ty + b.y0 * k, y1 = st.top + view.ty + b.y1 * k;
    const below = y1 + gap, above = y0 - gap - ht, fits = (y) => y >= top && y <= bottom;
    const y = fits(below) ? below : fits(above) ? above : Math.min(bottom, Math.max(top, below));
    el.style.left = `${Math.round(Math.min(st.right - 12 - w, Math.max(st.left + 12, cx - w / 2)))}px`;
    el.style.top = `${Math.round(y)}px`;
  }
  // 選到的岩點在螢幕上比指尖（44 px）小：平滑地移到畫面中間、放大到約畫面寬的 1/3；已經夠大就不動，點相鄰的岩點畫面才不會一直跳
  let focusAnim = 0;
  function focusHold(h) {
    if (state.mode !== 'holds') return;
    const W = $('stage').clientWidth, b = bbox(h.poly);
    const k = view.bw * view.s / state.w, size = Math.max(b.x1 - b.x0, b.y1 - b.y0) * k;
    if (size >= 44 || !size) return;
    flyView(Math.min(maxScale(), view.s * (W / 3) / size), (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
  }
  // 點空白處開始畫新的岩點：還沒放大（不到 2 倍）就以第一點為中心放大到 2 倍，後面的點比較好點準
  function focusDraft(x, y) {
    if (state.mode !== 'holds' || view.s >= 1.99) return;
    flyView(Math.min(maxScale(), 2), x, y);
  }
  // 平滑地把照片座標 (cx, cy) 移到畫面中間、縮放到 s1
  function flyView(s1, cx, cy) {
    const st = $('stage'), W = st.clientWidth, H = st.clientHeight, k1 = view.bw * s1 / state.w;
    flyTo(s1, W / 2 - cx * k1, H / 2 - cy * k1);
  }
  // 平滑地縮放、移動到 (s, tx, ty)（進出岩點編輯、選到小岩點）；done：停下時呼叫
  function flyTo(s, tx, ty, done, ms = 360) {
    const from = { s: view.s, tx: view.tx, ty: view.ty }, to = { s, tx, ty };
    const dur = AppKit.ui.reducedMotion() ? 0 : ms, t0 = performance.now();
    cancelAnimationFrame(focusAnim);
    const step = () => {
      const p = dur ? Math.min(1, (performance.now() - t0) / dur) : 1, e = 1 - (1 - p) ** 3;
      setView(from.s + (to.s - from.s) * e, from.tx + (to.tx - from.tx) * e, from.ty + (to.ty - from.ty) * e);
      renderLines();
      if (p < 1) focusAnim = requestAnimationFrame(step); else if (done) done();
    };
    step();
  }
  function zoomAt(s, px, py) {   // px, py：框內座標，縮放時這一點不動
    const k = Math.min(hardMaxScale(), Math.max(state.w3d && state.w3d.tilted && state.w3d.along ? 0 : zoomFloor(), s)) / view.s;   // 沿牆走的鏡頭：裁切固定，縮放交給鏡頭（見 clampView）
    const v = RouteKit.zoomAround(view, view.s * k, px, py);   // 以 (px, py) 這一點不動縮放（kit 的同一份）
    setView(v.s, v.tx, v.ty);
  }
  // ---------- 首頁卡片 ----------
  // 正方形照片、名稱疊在下緣、右上角進度環（完攀幾成）
  function wallCard(w) {
    const b = document.createElement('button'); b.className = 'wall-card'; b.dataset.id = w.id;
    const img = document.createElement('img'); img.src = w.thumbHi || w.thumb; img.alt = ''; img.draggable = false; img.dataset.wid = w.id;
    const meta = document.createElement('span'); meta.className = 'meta';
    const name = document.createElement('span'); name.className = 'name';
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = w.name; name.append(nm);
    const sub = document.createElement('span'); sub.className = 'sub';
    meta.append(name, sub);
    b.append(img, meta);
    // 名稱旁邊：這面牆完攀過的最高難度；副標：狀態（新線、還在磨、全清、還差幾條）；下緣：細進度條
    const cnt = logCounts(w), best = bestGrade(w);
    if (best) name.append(setGrade(Object.assign(document.createElement('b'), { className: 'best' }), best));
    wallSub(w, cnt, sub);
    if (cnt.none < sumOf(w).n) b.append(wallBar(w, cnt));
    if (sharedPublic(w)) {
      const mark = document.createElement('i'); mark.className = 'pub-mark';
      mark.setAttribute('role', 'img'); mark.setAttribute('aria-label', t('sharePublic'));
      mark.innerHTML = '<svg><use href="#i-globe"/></svg>'; b.append(mark);
    }
    b.onclick = () => openWallFrom(w.id, img);
    b.wall = w;   // 長按選單用
    return b;
  }
  function toggleShowAll() {
    state.showAll = !state.showAll;
    pressBtns('.outline-btn', state.showAll);
    if (editorUi) editorUi.update();
    render();
  }
