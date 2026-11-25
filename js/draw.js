// Climbio 繪製：幾何、路線圖的底圖、岩點彩色範圍、標籤。
// 依序載入（app → home → profile → add-wall → edit → wall → sync → draw → export → mobile → tour → main），共用同一個全域範圍；載入當下只能用到前面檔案宣告的東西。
// English: Drawing: edit-screen outlines and handles, route base modes (gray / muted), hold file cleanup; route images use RouteKit.
'use strict';
  // ---------- 幾何 ----------
  // 外框幾何、路線的標示與底圖在 routekit/（看路線、定線、路線圖輸出的共用模組，不依賴 App 的狀態）：幾何直接取出來用，繪製都寫 RouteKit.…
  const { inPoly, area, edgePoint } = RouteKit;
  // 圈起來：手畫的圈變成外框。去掉繞過起點多畫的那一段，前後各 2 點平均掉手抖，再省掉偏差不到 px（螢幕上約 1 px）的點；
  // 不交給模型、不削成粗略的多邊形，畫的是什麼形狀就是什麼形狀
  function lassoOutline(pts, px) {
    const d0 = (p) => Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]), far = Math.max(...pts.map(d0));
    let end = pts.length, near = Infinity;
    for (let i = pts.length >> 1; i < pts.length; i++) if (d0(pts[i]) < near) { near = d0(pts[i]); end = i + 1; }   // 後半段最靠近起點的地方：之後是多畫的
    const raw = near < far * 0.25 ? pts.slice(0, end) : pts, n = raw.length;
    if (n < 5) return raw;
    const avg = raw.map((_, i) => [0, 1, 2, 3, 4].reduce((s, k) => { const q = raw[(i + k - 2 + n) % n]; return [s[0] + q[0] / 5, s[1] + q[1] / 5]; }, [0, 0]));
    const seg = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0; return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
    const dp = (list) => {   // Douglas–Peucker：留頭尾，中間偏差最大的超過 px 就留下、兩邊再分
      let worst = 0, at = 0;
      for (let i = 1; i < list.length - 1; i++) { const d = seg(list[i], list[0], list[list.length - 1]); if (d > worst) { worst = d; at = i; } }
      return worst <= px ? [list[0], list[list.length - 1]] : [...dp(list.slice(0, at + 1)).slice(0, -1), ...dp(list.slice(at))];
    };
    let opp = 0;
    avg.forEach((p, i) => { if (Math.hypot(p[0] - avg[0][0], p[1] - avg[0][1]) > Math.hypot(avg[opp][0] - avg[0][0], avg[opp][1] - avg[0][1])) opp = i; });
    const out = [...dp(avg.slice(0, opp + 1)).slice(0, -1), ...dp([...avg.slice(opp), avg[0]]).slice(0, -1)];
    return out.map(p => [+p[0].toFixed(1), +p[1].toFixed(1)]);
  }
  // 外框上的細尖：往外伸出去又折回來（或往內切進去）的一小段——根部寬度不到這段長度的 1/6、整段很薄、不到整顆的 8%——剪掉，
  // 多半是 MobileSAM 沿著縫隙、陰影多描了一條，或拖頂點時旁邊的頂點留在外面拉成一根針。正常的尖角（20° 以上）和有寬度的凸塊不動。
  // keep：不能剪掉的頂點（剛拖的那個，可能是故意拉尖的）
  function despike(poly, keep = -1) {
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    let p = poly, kept = keep >= 0 ? poly[keep] : null;
    for (let pass = 0; pass < 12; pass++) {
      const n = p.length, whole = area(p);
      let cut = null;
      for (let i = 0; i < n && !cut; i++) for (let k = 1; k <= 3 && n - k >= 4 && !cut; k++) {
        const seg = Array.from({ length: k + 2 }, (_, j) => p[(i + j) % n]), a = seg[0], b = seg[k + 1];
        if (kept && seg.slice(1, -1).includes(kept)) continue;
        let L = 0; for (let j = 0; j <= k; j++) L += d(seg[j], seg[j + 1]);
        const c = d(a, b);
        if (c * 6 <= L && area(seg) <= c * L / 2 && area(seg) < whole * 0.08) cut = new Set(Array.from({ length: k }, (_, j) => (i + 1 + j) % n));
      }
      if (!cut) break;
      p = p.filter((_, i) => !cut.has(i));
    }
    return p === poly ? poly : p;
  }
  function validAddedOutline(poly, x, y, others) {
    if (!Array.isArray(poly) || poly.length < 3 || poly.some(p => !Array.isArray(p) || p.length !== 2
      || !p.every(Number.isFinite) || p[0] < 0 || p[1] < 0 || p[0] > state.w || p[1] > state.h)
      || !area(poly) || (!inPoly(x, y, poly) && edgeDist(x, y, poly) > 0)) return false;
    const b = bbox(poly);
    // 單點辨識只接受未與既有岩點相交的輪廓；包含、交叉和共邊都保留方框讓使用者調整。
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const intersects = (a, b, c, d) => Math.max(a[0], b[0]) >= Math.min(c[0], d[0]) && Math.max(c[0], d[0]) >= Math.min(a[0], b[0])
      && Math.max(a[1], b[1]) >= Math.min(c[1], d[1]) && Math.max(c[1], d[1]) >= Math.min(a[1], b[1])
      && cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0;
    if (poly.some((a, i) => poly.some((c, j) => j > i + 1 && !(i === 0 && j === poly.length - 1)
      && intersects(a, poly[(i + 1) % poly.length], c, poly[(j + 1) % poly.length])))) return false;
    return !others.some(h => {
      const q = h.poly, hb = bbox(q);
      if (b.x1 < hb.x0 || b.x0 > hb.x1 || b.y1 < hb.y0 || b.y0 > hb.y1) return false;
      return poly.some(p => inPoly(...p, q)) || q.some(p => inPoly(...p, poly))
        || poly.some((a, i) => q.some((c, j) => intersects(a, poly[(i + 1) % poly.length], c, q[(j + 1) % q.length])));
    });
  }
  function fallbackHoldOutline(x, y, holds) {
    const nearby = holds.map(h => ({ h, b: bbox(h.poly), d: edgeDist(x, y, h.poly) })).sort((a, b) => a.d - b.d);
    const ref = nearby[0]?.b, size = Math.min(state.w, state.h) / 20;
    const w = Math.min(state.w, ref ? ref.x1 - ref.x0 : size), h = Math.min(state.h, ref ? ref.y1 - ref.y0 : size);
    let x0 = Math.max(0, Math.min(state.w - w, x - w / 2)), y0 = Math.max(0, Math.min(state.h - h, y - h / 2));
    let x1 = x0 + w, y1 = y0 + h;
    const rect = () => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    for (const { h: other, b } of nearby) {
      if (validAddedOutline(rect(), x, y, [other])) continue;
      // 往鄰點與長按位置之間退讓，保留包含長按位置且面積最大的矩形。
      const cuts = [];
      if (b.x0 > x) cuts.push([x0, y0, (x + b.x0) / 2, y1]);
      if (b.x1 < x) cuts.push([(x + b.x1) / 2, y0, x1, y1]);
      if (b.y0 > y) cuts.push([x0, y0, x1, (y + b.y0) / 2]);
      if (b.y1 < y) cuts.push([x0, (y + b.y1) / 2, x1, y1]);
      cuts.sort((a, b) => (b[2] - b[0]) * (b[3] - b[1]) - (a[2] - a[0]) * (a[3] - a[1]));
      if (cuts.length) [x0, y0, x1, y1] = cuts[0];
    }
    let poly = rect();
    if (!validAddedOutline(poly, x, y, holds) && nearby.length) {
      // 斜邊或凹形的外接框可能包住長按位置；退進最近輪廓距離內，避免用外接框誤判空隙。
      const radius = Math.max(...poly.map(p => Math.hypot(p[0] - x, p[1] - y)));
      const scale = Math.min(1, nearby[0].d / (2 * radius));
      poly = poly.map(p => [x + (p[0] - x) * scale, y + (p[1] - y) * scale]);
    }
    return poly;
  }
  // 點在岩點裡面就選它（重疊時選面積最小的）；都沒有就選邊界距離在 tol 內最近的那顆
  function hitHold(x, y, tol = 0) {
    if (state.w3d) return W3D.holdAt(x, y);   // 3D 牆：從相機打射線，被擋住的不算
    const hs = tapHolds();
    let best = RouteKit.holdAt(hs, x, y);
    if (best || !tol) return best;
    let bestD = tol;
    for (const h of hs) {
      const b = bbox(h.poly);
      if (x < b.x0 - tol || x > b.x1 + tol || y < b.y0 - tol || y > b.y1 + tol) continue;
      const d = edgeDist(x, y, h.poly);
      if (d < bestD) { bestD = d; best = h; }
    }
    return best;
  }
  // 長按要改哪一顆：按在岩點裡面就是那顆。按在框外：想重描的岩點外框常常沒框滿，按在框外一點點——
  // 離邊緣 12 個螢幕 px 內就是那顆；24 px 內時看補點的方框：被擠到短邊不到 24 px（比指尖還小的方框）也算那顆，
  // 不然照常補一顆沒框到的（密集的牆上漏掉的岩點常常就貼在別顆旁邊）
  // 大岩點（volume，面積是一般岩點中位數的 8 倍以上；大一點的一般岩點約 4～7 倍）：按在裡面、離邊緣夠遠（螢幕 28 px 或短邊的 15%），是要在 volume 上補一顆沒框到的岩點；
  // 按在邊緣附近才是改 volume 本身
  let medArea = { key: '', v: Infinity };   // 岩點面積的中位數：岩點變了才重算（放大鏡每格都會問）
  function medianArea() {
    const hs = tapHolds(), key = `${state.scene && state.scene.version}|${hs.length}`;
    if (medArea.key !== key) { const a = hs.map(h => area(h.poly)).sort((p, q) => p - q); medArea = { key, v: a[a.length >> 1] || Infinity }; }
    return medArea.v;
  }
  function volumeAt(x, y) {
    const px = state.w / cv.getBoundingClientRect().width, hs = tapHolds(), med = medianArea();
    return hs.find(h => { const b = bbox(h.poly); return area(h.poly) >= med * 8 && inPoly(x, y, h.poly) && edgeDist(x, y, h.poly) > Math.max(28 * px, 0.15 * Math.min(b.x1 - b.x0, b.y1 - b.y0)); }) || null;
  }
  function pressHold(x, y) {
    if (state.w3d) return hitHold(x, y);   // 3D 牆：射線點到的那顆，沒有就補一顆
    const hit = hitHold(x, y);
    if (hit) return hit === volumeAt(x, y) ? null : hit;   // 按在 volume 裡面（上面沒有別的岩點）：補點
    const px = state.w / cv.getBoundingClientRect().width, near = hitHold(x, y, 24 * px);
    if (!near || edgeDist(x, y, near.poly) <= 12 * px) return near;
    const f = bbox(fallbackHoldOutline(x, y, state.wall.holds));
    return Math.min(f.x1 - f.x0, f.y1 - f.y0) < 24 * px ? near : null;
  }
  // 點在裡面的所有岩點，面積小的在前
  const holdsUnder = (x, y, hs = tapHolds()) => state.w3d ? [] : RouteKit.holdsUnder(hs, x, y);   // 規則在 kit（geometry.js），內嵌頁用同一份
  // 岩點頁點選用：點在裡面的所有岩點；都沒有就是邊界距離在 tol 內最近的那顆
  function holdsAt(x, y, tol) {
    const inside = holdsUnder(x, y, state.wall.holds);
    if (inside.length) return inside;
    const h = hitHold(x, y, tol);
    return h ? [h] : [];
  }
  function edgeDist(x, y, poly) { return RouteKit.edgeDist(x, y, poly); }

  // ---------- 繪製 ----------
  const route = () => state.wall && state.wall.routes.find(r => r.id === state.routeId) || null;
  // 路線排序：預設＝新的在最上面（w.routes 是新增順序，倒過來）、難度高→低、難度低→高；只影響顯示
  //（牆面頁列表、看路線圖左右切換）。選擇記在這支手機
  const SORT_KEY = 'climbio.routeSort', SORTS = ['added', 'gradeDesc', 'gradeAsc', 'pos'];
  let routeSort = (() => { try { const v = localStorage.getItem(SORT_KEY); return SORTS.includes(v) ? v : 'added'; } catch (e) { return 'added'; } })();
  const gradeRank = (g) => g in GRADE_RANK ? GRADE_RANK[g] : 99;
  const SORT_CMP = {   // 同難度維持新增順序
    gradeAsc: (a, b) => gradeRank(a.grade) - gradeRank(b.grade),
    gradeDesc: (a, b) => gradeRank(b.grade) - gradeRank(a.grade),
  };
  // 路線清單的篩選（只影響清單，不影響左右滑）：'' 全部、sent（完攀）、unsent（沒爬過）
  let routeFilter = '';
  const passFilter = (r, w = state.wall) => {
    if (!routeFilter || !w) return true;
    return isSent(r) === (routeFilter === 'sent');
  };
  const SORT_NEXT = { added: 'gradeAsc', gradeAsc: 'gradeDesc', gradeDesc: 'pos', pos: 'added' };
  function renderListTools() {
    for (const b of document.querySelectorAll('.rf-chips [data-filter]')) b.setAttribute('aria-pressed', b.dataset.filter === routeFilter);
    const lbl = t('sortRoutes') + '：' + t('sort' + routeSort[0].toUpperCase() + routeSort.slice(1));
    for (const b of document.querySelectorAll('.list-tools [data-sort]')) {
      b.dataset.v = routeSort; b.title = lbl; b.setAttribute('aria-label', lbl);
      b.querySelector('use').setAttribute('href', '#i-sort-' + { added: 'added', gradeAsc: 'asc', gradeDesc: 'desc', pos: 'pos' }[routeSort]);
    }
  }
  function rerenderLists() { renderListTools(); if (!$('wall').hidden) renderOverview(); }
  for (const b of document.querySelectorAll('.rf-chips [data-filter]')) b.onclick = () => { routeFilter = routeFilter === b.dataset.filter ? '' : b.dataset.filter; rerenderLists(); };
  for (const b of document.querySelectorAll('.list-tools [data-sort]')) b.onclick = () => {
    routeSort = SORT_NEXT[routeSort] || 'added';
    try { localStorage.setItem(SORT_KEY, routeSort); } catch (e) { /* 忽略 */ }
    toast(t('sort' + routeSort[0].toUpperCase() + routeSort.slice(1)));
    rerenderLists();
  };
  const sortedRoutes = (w = state.wall) => {
    const rs = w ? w.routes.slice() : [], cmp = routeSort === 'pos' ? posCmp(w) : SORT_CMP[routeSort];
    rs.reverse();
    return cmp ? rs.sort(cmp) : rs;   // sort 是穩定的，同難度新的在前
  };
  // 位置（左→右）：起攀岩點的中心（沒有起攀就整條的中心）在照片上的左右；同一面牆的幾張照片照片之間的順序由照片接力接起來
  function posCmp(w) {
    const byId = new Map(w.holds.map(h => [h.id, h])), xs = new Map();
    const x = (r) => {
      if (xs.has(r.id)) return xs.get(r.id);
      const ids = Object.keys(r.holds), st = ids.filter(id => r.holds[id] === 's'), pts = (st.length ? st : ids).flatMap(id => ((r.shapes && r.shapes[id]) || byId.get(id) || {}).poly || []);
      const v = pts.length ? pts.reduce((s, p) => s + p[0], 0) / pts.length : Infinity;
      xs.set(r.id, v); return v;
    };
    return (a, b) => x(a) - x(b);
  }

  // 打開的牆：照片和它的快取（共用的底、路線圖層、標籤位置）在 state.scene（routekit/scene.js）
  // 回首頁、換照片：放掉跟照片一樣大的畫布（共用的底、分析，每張幾十 MB），手機的畫布記憶體才不會被吃滿；開牆時重建
  function releaseCanvases() {
    if (state.scene) state.scene.release();
    state.scene = state.ana = null; shownBaseKey = '';
  }
  // 岩點外框改了（拖頂點、重描、補點、刪點）：底圖、標籤位置之後重算
  const touchGeom = () => { if (state.scene) state.scene.touch(); };
  // 路線圖的底有兩種（分享的圖一律灰階）：gray＝灰階（壓亮度再上一層冷灰）、dim＝暗彩（整張照片調暗、保留顏色）。
  // 看路線圖、定線各記一個選擇（存在這台，離開、重開都保留）：預設看路線圖灰階（只亮路線岩點最清楚）、定線暗彩（選點要看得到其他岩點的顏色）；
  // 路線小卡、收線卡片固定灰階（進看路線圖也是灰階，飛進去不會變色）
  const BASE_KEY = 'climbio.bases';
  const bases = (() => { try { const v = JSON.parse(localStorage.getItem(BASE_KEY)); return { view: v.view === 'dim' ? 'dim' : 'gray', set: v.set === 'gray' ? 'gray' : 'dim' }; } catch (e) { return { view: 'gray', set: 'dim' }; } })();
  const saveBases = () => { try { localStorage.setItem(BASE_KEY, JSON.stringify(bases)); } catch (e) { /* 忽略 */ } };
  const setting = () => !!state.wall && state.mode === 'route' && !state.routeView && !$('editor').hidden;
  const baseOf = (set) => bases[set ? 'set' : 'view'];
  const baseMode = () => baseOf(setting());
  let shownBase = '';   // 畫面上的路線底現在是哪一種（換的時候做轉場）
  // ---------- 原始岩點檔與路線外框 ----------
  // 原始岩點檔 w.base = { holds: [{ id, poly }] }：只收計算的結果（偵測、重描、整理），不混入手動調整；分批算完的先後不影響內容。
  // 我的岩點檔 w.holds：從原始的來，自己補點、修框、刪點（source：detect＝還是計算的結果、edited＝改過形狀、manual＝自己畫的）。
  // 路線自帶用到的外框 r.shapes = { 岩點 id: { id, poly, source } }，不參照任何岩點檔：點進路線時從我的岩點檔複製；
  // 還是計算結果（detect）的跟著計算更新，手動改過的不動。存檔前整理一次（settleWall）
  const samePoly = (a, b) => a === b || (a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]));
  const copyPoly = (poly) => poly.map(p => p.slice());
  const shapeOf = (h) => ({ id: h.id, poly: copyPoly(h.poly), source: h.source });
  function settleWall(w) {
    const base = w.base || (w.base = { holds: [] }), at = new Map(base.holds.map(b => [b.id, b])), mine = new Map();
    for (const h of w.holds || []) {
      mine.set(h.id, h);
      if (h.source !== 'detect') continue;
      const b = at.get(h.id);
      if (!b) base.holds.push({ id: h.id, poly: copyPoly(h.poly) });
      else if (!samePoly(b.poly, h.poly)) b.poly = copyPoly(h.poly);
    }
    for (const r of w.routes || []) {
      const s = r.shapes || (r.shapes = {});
      for (const id of Object.keys(s)) if (!r.holds[id]) delete s[id];
      for (const id of Object.keys(r.holds)) {
        const h = mine.get(id), cur = s[id];
        if (!h) continue;
        if (!cur || (cur.source === 'detect' && h.source === 'detect' && !samePoly(cur.poly, h.poly))) s[id] = shapeOf(h);
      }
    }
  }
  // 計算拿掉的岩點（整理合併、更新輪廓刪掉重複的）也從原始岩點檔拿掉
  function dropBase(w, ids) {
    if (!w.base || !ids.size) return;
    w.base.holds = w.base.holds.filter(b => !ids.has(b.id));
  }
  // 路線用到的岩點：路線自帶的外框（還沒複製的，例如剛點進來，先用我的岩點檔那顆）
  // 3D 牆的岩點固定（資料包），外框跟著角度重投：不用路線自帶的外框（r.shapes，存的是正面的）
  const holdsOf = (r, w = state.wall) => RouteKit.routeHolds(w.m3d ? { holds: r.holds } : r, w.holds);
  // 點得到的岩點：我的岩點檔；定線時再加上這條路線自帶、我的岩點檔沒有的（才能把它從路線拿掉）
  function tapHolds() {
    const r = state.mode === 'route' && route(), hs = state.wall.holds;
    if (!r || !r.shapes) return hs;
    const ids = new Set(hs.map(h => h.id)), extra = Object.values(r.shapes).filter(x => !ids.has(x.id));
    return extra.length ? hs.concat(extra) : hs;
  }
  for (const el of document.querySelectorAll('.sw-slot')) el.innerHTML = typeSwatch(el.dataset.type);
  // 標籤位置（記在 state.scene）。hands：手點也貼短膠帶（看路線圖固定開，匯出不貼），長度跟腳點一樣
  const placeTypeLabels = (routeHolds, r, unit, hands = false) => state.scene.labels(routeHolds, r, unit, hands);
  // 說明列用的顏色小圓點
  function typeSwatch(type) { return type === 'n' ? '<i class="dot seq-dot">1</i>' : `<i class="dot" style="background:${TYPE_COLOR[type] || TYPE_COLOR.h}"></i>`; }
  // 看路線圖時，背景先畫好左右兩條路線的底圖、排好標籤，滑第一下不用同步算；每畫一條就讓出來，換了路線或離開就停掉重來
  let prefetchGen = 0, shownBaseKey = '';
  const pause = (ms = 0) => AppKit.timing.wait(ms);
  async function prefetchNeighbors() {
    const gen = ++prefetchGen, wall = state.wall;
    const alive = () => gen === prefetchGen && state.wall === wall && state.mode === 'route' && state.routeView;
    // 轉場中（body.flying）先不畫：每條是照片原尺寸的重畫，放在轉場途中會卡住好幾格；落地後再等一下（工具淡入）才開始
    do await pause(200); while (document.body.classList.contains('flying'));
    if (!alive()) return;
    const mode = baseMode();
    await state.scene.prefetch([neighborRoute(1), neighborRoute(-1)].filter(Boolean).map(r => ({ routeHolds: holdsOf(r, wall), r, unit: labelUnit(r), mode, tint: mode !== 'dim', hands: true })), alive);
  }
  // 畫面上的線條層（#ov）：跟 #stage 一樣大、螢幕解析度；座標換成照片座標，畫的程式不用改
  const ovCv = $('ov'), ovCtx = ovCv.getContext('2d');
  // 縮放、拖曳時不每格重畫（岩點多時很慢）：線條層先照「上次畫的時候」到現在的變化整層平移縮放，手停 0.1 秒再重畫清楚的
  let ovView = null, ovSettle = 0;
  // 左右滑路線時線條層跟著照片水平移動的距離（mobile.js 的 placeSwipe 設）：滑到一半重畫也保留，標籤才不會跳回原位
  let ovShift = 0;
  function viewMoved(composite = false) {
    // 定線（沒開「顯示所有岩點」）只有路線岩點的外框和標籤，每格照新的比例重畫很輕：外框粗細不會在縮放中被拉粗、停手才變細
    if (!composite && state.mode === 'route' && !state.routeView && !state.showAll && state.img && state.wall) { renderLines(); return; }
    if (ovView) {
      const k = view.s / ovView.s;
      ovCv.style.transform = `translate(${view.tx - ovView.tx * k}px, ${view.ty - ovView.ty * k}px) scale(${k})`;
    }
    clearTimeout(ovSettle);
    if (!composite) ovSettle = setTimeout(render, 100);
  }
  function overlay() {
    const st = $('stage'), dpr = devicePixelRatio || 1, W = Math.round(st.clientWidth * dpr), H = Math.round(st.clientHeight * dpr);
    if (ovCv.width !== W || ovCv.height !== H) { ovCv.width = W; ovCv.height = H; }
    ovCtx.setTransform(1, 0, 0, 1, 0, 0); ovCtx.clearRect(0, 0, W, H);
    ovView = { s: view.s, tx: view.tx, ty: view.ty }; ovCv.style.transform = ovShift ? `translateX(${ovShift}px)` : '';
    const k = view.bw * view.s / state.w;
    ovCtx.setTransform(dpr * k, 0, 0, dpr * k, dpr * view.tx, dpr * view.ty);
    // 看得到的照片範圍（照片座標）：外面的岩點不畫，放大拖曳時才不會每格都畫整面牆
    ovCtx.vis = { x0: -view.tx / k, y0: -view.ty / k, x1: (st.clientWidth - view.tx) / k, y1: (st.clientHeight - view.ty) / k };
    return ovCtx;
  }
  const offView = (o, poly) => { const v = o.vis; if (!v) return false; const b = bbox(poly); return b.x1 < v.x0 || b.x0 > v.x1 || b.y1 < v.y0 || b.y0 > v.y1; };
  // 畫面上的編輯畫面（分享的路線圖是 RouteKit.renderRouteImage）
  // 定線時顯示所有岩點的熱圖：這面牆的其他路線各用了每顆岩點幾次（不含正在定的這條）。定線中其他路線不會變，條數或這條換了才重算
  let heatMemo = null;
  const heatLevel = RouteKit.heatLevel;   // 0＝沒用過（白框），用過的 1 次起跳、最多那顆是 1（kit 的同一份）
  function holdUse(w, r) {
    const rid = r ? r.id : null;
    if (heatMemo && heatMemo.w === w && heatMemo.rid === rid && heatMemo.n === w.routes.length) return heatMemo;
    return (heatMemo = { w, rid, n: w.routes.length, ...RouteKit.holdUse(w.routes, r) });   // 次數的算法在 kit（editor.js），內嵌頁用同一份
  }
  function draw(c0, { lines = false, light = false } = {}) {   // light：重疊選點縮回前只畫路線細框，照片和線條交給合成層縮放
    let c = c0;
    if (state.w3d) W3D.sync();   // 修點變了（改外框、補點、復原、刪掉）先套到模型上
    const W = state.w, H = state.h;
    // 線寬用「螢幕像素」（手機縮小顯示也看得清楚）
    const sp = screenPx();
    const L = (screen) => screen * sp;
    let revealing = false;
    const r = route(), holds = state.wall.holds;
    const routeHolds = r ? holdsOf(r) : [];
    const highlight = state.mode === 'route' && routeHolds.length > 0;
    const gray = highlight;   // 路線的底（灰階或暗彩，見 baseMode）：路線有點才換；定線一進來還是原本的照片，選了第一個點才調暗
    if (!lines) {
      // 底圖：整面牆共用的底＋路線岩點的原色圖層（都記在 state.scene）；滑鼠移動、縮放只重畫線條層
      const sc = state.scene, mode = baseMode(), tint = mode !== 'dim' && !!state.routeView;   // 灰階看線：volume 染色；暗彩不染，靠光暈
      const key = [sc.version, gray, mode, tint, routeHolds.map(h => h.id).join(',')].join('|');
      c.clearRect(0, 0, W, H);
      // 3D 牆：底圖是下面的模型（2D 畫布留空），路線岩點原色＋角色色光暈（看線、定線一樣）
      if (state.w3d) state.w3d.paint({ holds: r ? r.holds : {}, mode: gray ? mode : 'photo', colors: TYPE_COLOR });
      else if (gray) sc.drawBase(c, routeHolds, { mode, tint }); else c.drawImage(state.img, 0, 0);
      if (reveal && reveal.rid === state.routeId && state.routeView && gray && !state.w3d) revealing = drawReveal(c);
      if (key !== shownBaseKey) { shownBaseKey = key; prefetchNeighbors(); }
      shownBase = gray ? baseMode() : '';
    }
    c = overlay();   // 之後的線條、標籤都畫在線條層
    c.lineJoin = 'round';
    // 暗彩時路線岩點外圈有角色色光暈（跟 3D 牆一樣；灰階沒有；寬度照螢幕點算；光暈在下、路線岩點原色圖層再蓋上去）；3D 牆的光暈在模型上做
    if (!light && highlight && baseMode() === 'dim' && !state.w3d && !revealing) RouteKit.glowAround(c, routeHolds, r.holds, TYPE_COLOR, devicePixelRatio || 1, state.scene.routeLayer(routeHolds, { tint: false }));
    if (!light && (state.mode === 'holds' || (state.showAll && !state.routeView))) {
      // 大螢幕（電腦）上照片放得很大，線跟著加粗一點：手機 1 倍，最多 1.5 倍
      const big = Math.min(1.5, Math.max(1, Math.min(innerWidth, innerHeight) / 560));
      // 沒放大時（一次看整面牆、岩點很多）細細淡淡的，看得到岩點本身；放大到 4 倍才是完整粗細。選到的那顆照樣粗
      const heat = state.mode === 'route' ? holdUse(state.wall, r) : null;
      for (const h of holds) {
        if (state.mode === 'holds' && state.holdSub && h !== state.selected) continue;
        if (highlight && r.holds[h.id]) continue;
        if (offView(c, h.poly)) continue;
        RouteKit.strokeHoldOutline(c, h.poly, { k: heat ? RouteKit.heatLevel(heat, h.id) : 0, sel: h === state.selected, viewScale: view.s, big, L });   // 外框和熱圖的畫法在 kit（labels.js），內嵌頁用同一份
      }
    }
    if (!highlight) { drawHover(c); drawHandles(c); drawLasso(c); drawDraft(c); drawOverlapPick(c); return; }
    // 看路線頁（跟分享的圖一樣）：岩點不畫框（只靠彩色），起攀、完攀、腳點用世界盃膠帶樣式的標籤；編輯路線時照樣畫框，方便點選。
    // 螢幕上標籤大小照路線視角時的螢幕大小算（手機縮小顯示也看得清楚）；放大時跟著照片一起放大，像真的貼在牆上，位置不會跳
    if (state.routeView) {
      if (revealing) return;   // 岩點還在亮起：先不畫標籤
      if (state.w3d && (state.w3d.tilted || routeZoomed())) return;   // 3D 牆放大、走近：標籤是平面的，換角度會跑來跑去，回到路線視角才畫
      // 暗彩：光暈外再描一圈角色色的細外框（岩點外側），看得出是哪些點（跟定線一樣的畫法）
      const glowOn = baseMode() === 'dim' && !state.w3d;
      if (glowOn) for (const h of routeHolds) RouteKit.strokeRouteHold(c, h.poly, r.holds[h.id], (s) => L(s * 0.4));
      const lu = labelUnit();
      const labels = placeTypeLabels(routeHolds, r, lu, true);
      c.save(); c.globalAlpha = tagAlpha(); if (!glowOn) RouteKit.drawTypeLabels(c, labels, lu); RouteKit.drawSeq(c, state, r, lu, labels, routeHolds); c.restore();   // 暗彩有光暈外框，就不貼膠帶標示
    }
    else {
      // 定線：外框用固定的細螢幕線寬（不隨縮放變：岩點小的時候才不會一圈外框把岩點蓋滿）
      if (!state.w3d) for (const h of routeHolds) RouteKit.strokeRouteHold(c, h.poly, r.holds[h.id], (s) => L(s * 0.65));
      RouteKit.drawSeq(c, state, r, labelUnit(), [], routeHolds);
    }
    drawHover(c); drawDraft(c); drawOverlapPick(c);
  }
  // 重疊岩點的選擇：候選以外調暗，每顆一個顏色畫框，各自會選到的地方放一個同色圓點
  function drawOverlapPick(c) {
    const p = state.overlapPick, v = c.vis, r = route(), sp = screenPx();
    if (!p?.ready || !v) return;
    RouteKit.drawOverlapPick(c, { img: state.img, holds: p.holds, spots: p.spots, preferred: p.preferred, neighbors: p.neighbors, vis: v, L: (s) => s * sp, routeHolds: r ? holdsOf(r) : [], route: r });   // 畫法在 kit（labels.js），內嵌頁用同一份
  }
  // 同色預覽的候選：白色虛線框（外面一圈深色，淺色岩點上也看得到）
  // 選取的岩點（岩點模式）：頂點畫成白色把手，邊的中點畫成小點（拖它可新增頂點）
  // px：一個螢幕像素等於幾個影像像素。螢幕上離不到 HANDLE_GAP 的連續頂點併成一個把手（idx＝包含的頂點），
  // 拖它時這幾個頂點合成一個；放大就分得開，可以一個一個調。把手不到 3 個（岩點在螢幕上太小）就不放，放大再調。
  // 把手之間在螢幕上短於 MIN_EDGE 就不放中點（兩頂點太近，不再新增）
  const MIN_EDGE = 28, HANDLE_GAP = 14;   // 螢幕 px：頂點離不到 HANDLE_GAP 才併成一個白點（小岩點放大後就分得開）
  function handleList(h, px) {
    const poly = h.poly, groups = [];
    poly.forEach((p, i) => {
      const g = groups[groups.length - 1], f = g && poly[g[0]];
      if (g && Math.hypot(p[0] - f[0], p[1] - f[1]) < HANDLE_GAP * px) g.push(i); else groups.push([i]);
    });
    if (groups.length > 1) {   // 頭尾相接：最後一組離第一組太近就併進去
      const last = groups[groups.length - 1], f = poly[last[0]], g0 = poly[groups[0][0]];
      if (Math.hypot(f[0] - g0[0], f[1] - g0[1]) < HANDLE_GAP * px) groups[0] = groups.pop().concat(groups[0]);
    }
    if (groups.length < 3) return { pts: [], mids: [] };
    const pts = groups.map(idx => { const p = poly[idx[idx.length >> 1]]; return { kind: 'v', i: idx[0], idx, x: p[0], y: p[1] }; });
    const mids = [];
    groups.forEach((g, k) => {
      const i = g[g.length - 1], p = poly[i], q = poly[groups[(k + 1) % groups.length][0]];
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) >= MIN_EDGE * px) mids.push({ kind: 'm', i, x: (p[0] + q[0]) / 2, y: (p[1] + q[1]) / 2 });
    });
    return { pts, mids };
  }
  // 把手包含好幾個頂點：合成一個放在 p，回傳新的外框和那一點的位置
  function mergeHandle(poly, idx, p) {
    const drop = new Set(idx), out = [];
    let at = -1;
    poly.forEach((q, i) => { if (i === idx[0]) { at = out.length; out.push(p); } else if (!drop.has(i)) out.push(q); });
    return { poly: out, i: at };
  }
  // 圈起來：手指畫到一半的圈（白線加深色描邊，起點用黃點標出），放開前一直畫在照片上
  function drawLasso(c) {
    const p = state.lassoPts;
    if (!p || p.length < 2) return;
    const px = screenPx();
    c.save(); c.lineJoin = 'round'; c.lineCap = 'round';
    c.beginPath(); p.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.lineWidth = 6 * px; c.strokeStyle = 'rgba(0,0,0,0.55)'; c.stroke();
    c.lineWidth = 3 * px; c.strokeStyle = '#fff'; c.stroke();
    c.beginPath(); c.arc(p[0][0], p[0][1], 5 * px, 0, Math.PI * 2); c.fillStyle = '#facc15'; c.fill();
    c.restore();
  }
  function drawHandles(c) {
    const h = state.selected;
    if (state.mode !== 'holds' || !h || state.draft || !state.wall.holds.includes(h)) return;
    const px = screenPx();
    const { pts, mids } = handleList(h, px);
    c.save();
    for (const m of mids) {
      c.beginPath(); c.arc(m.x, m.y, 4 * px, 0, Math.PI * 2);
      c.fillStyle = 'rgba(250,204,21,0.75)'; c.fill(); c.lineWidth = 1.5 * px; c.strokeStyle = 'rgba(0,0,0,0.6)'; c.stroke();
    }
    for (const v of pts) {
      c.beginPath(); c.arc(v.x, v.y, 6.5 * px, 0, Math.PI * 2);
      c.fillStyle = '#fff'; c.fill(); c.lineWidth = 2.5 * px; c.strokeStyle = '#facc15'; c.stroke();
    }
    c.restore();
  }
  // 按下的位置有沒有碰到把手：先找頂點，再找邊中點（螢幕像素容錯）
  function hitHandle(clientX, clientY) {
    const h = state.selected;
    if (state.mode !== 'holds' || !h || state.draft) return null;
    const rect = cv.getBoundingClientRect(), k = rect.width / state.w;
    const x = (clientX - rect.left) / k, y = (clientY - rect.top) / k;
    const { pts, mids } = handleList(h, 1 / k);
    // 頂點容錯 20 px、邊中點 14 px，兩種都在範圍內時選比較近的（小岩點的中點很靠近頂點）
    let best = null, bd = Infinity;
    for (const v of pts) { const d = Math.hypot(v.x - x, v.y - y); if (d < 20 / k && d < bd) { bd = d; best = v; } }
    for (const m of mids) { const d = Math.hypot(m.x - x, m.y - y); if (d < 14 / k && d < bd) { bd = d; best = m; } }
    return best;
  }
  // 一個螢幕像素等於幾個影像像素（含縮放）；編輯畫面沒顯示時退回依照片大小
  // 照片在畫面上的寬度用版面算（畫布寬 × 縮放），不量 getBoundingClientRect：
  // 轉場時整頁還在 transform 縮小（例如從路線小卡長大成路線圖），量到的寬度很小，標籤會先畫得很大再縮回來
  function screenPx() {
    const w = view.bw * view.s;
    return w ? state.w / w : Math.max(state.w, state.h) / 1000;
  }
  // 路線的標籤大小（畫面、左右滑的下一頁、背景預排共用，標籤快取才對得上）：路線視角時是固定的螢幕大小，照片單位跟畫面縮放無關
  const labelUnit = (r = route()) => { const u = Math.max(state.w, state.h) / 1000; return view.bw ? Math.max(u, state.w / (view.bw * holdFit(r).s) * 0.85) : u; };
  function drawHover(c) {
    const h = state.hover;
    if (!h || !state.wall.holds.includes(h)) return;
    if (state.mode === 'route' && state.routeView) return;
    if (state.mode === 'route') {   // 路線頁：有顏色的路線岩點和剛點過的那顆不蓋白框，切換時看得到顏色
      const r = route();
      if (h === state.current || (r && r.holds[h.id])) return;
    }
    const sp = screenPx();
    c.lineJoin = 'round';
    c.beginPath(); tracePoly(c, h.poly);
    c.lineWidth = 5.5 * sp; c.strokeStyle = 'rgba(0,0,0,0.32)'; c.stroke();
    c.lineWidth = 2.6 * sp; c.strokeStyle = 'rgba(255,255,255,0.8)'; c.stroke();
  }
  let raf = 0;
  function render() {
    if (!state.img) return;
    placeHoldActions();   // 岩點改了形狀，膠囊跟著移
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { if (state.wall) draw(ctx); });
  }
  // 程式帶動的平移縮放（自動放大選到的小岩點）：每格照新的比例重畫線條，不用整層放大（線會變粗變糊，停下來才變細，看起來像閃一下）
  function renderLines(light = false) {
    if (!state.img || !state.wall) return;
    clearTimeout(ovSettle);
    draw(ctx, { lines: true, light });
  }

