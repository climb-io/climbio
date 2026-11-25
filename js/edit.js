// 定線與岩點編輯：點擊、類型、畫岩點（多邊形）。
// 依序載入（app → home → profile → add-wall → edit → wall → sync → draw → export → mobile → tour → main），共用同一個全域範圍；載入當下只能用到前面檔案宣告的東西，
// 事件處理、計時器等之後才執行的程式不受限制。啟動與事件綁定放在最後的 main.js。
// English: Route setting and hold editing: taps, hold types, drawing hold polygons.
'use strict';
  // ---------- 點擊 ----------
  // 點擊容錯（螢幕像素）：路線模式寬鬆好選；岩點模式小一點，密的牆也點得到空白處新增
  const hitTol = (rect) => (state.mode === 'holds' ? 6 : 12) * state.w / rect.width;
  // 點擊掛在外框 #stage 上：按下時外框會抓住指標（縮放／拖曳用），滑鼠的 click 事件會送到外框而不是 canvas
  let editorUi = null;   // 定線的操作介面（RouteKit.EditorUI），下面的「出手順序、類型」那一段掛上
  let lastTap = { t: 0, x: 0, y: 0 };

  // 點兩下（看路線圖、定線點空白處）：以點的地方為中心放大 2.5 倍；已經放大了就復原（看路線圖回到路線視角，定線回到放大前、沒有就整張）
  let zoomBack = null;
  function dblZoom(ev) {
    const w3 = state.w3d;
    if (w3 && w3.along && w3.tilted && w3.wc) {   // 沿牆走的鏡頭：以點的地方為中心靠近 2.5 倍；已經靠近了就退回最遠
      const r = $('stage').getBoundingClientRect(), px = ev.clientX - r.left, py = ev.clientY - r.top;
      const K = w3.wc.d > w3.wc.dMax * 0.8 ? 2.5 : w3.wc.d / w3.wc.dMax, t0 = performance.now(), T = 300;
      if (Math.abs(K - 1) < 0.01) return;
      let done = 0;
      w3.wc.coarse = true;   // 動畫途中距離每格都在變：範圍用粗刻度算（見 walkcam.js 的 COARSE_D），走完回細的
      const tick = (now) => {
        const e = Math.min(1, (now - t0) / T), want = Math.pow(K, 1 - (1 - e) ** 3), kf = want / Math.pow(K, done);
        done = Math.log(want) / Math.log(K);
        setView(view.s * kf, px - (px - view.tx) * kf, py - (py - view.ty) * kf); W3D.walk([px, py]);
        if (e < 1) requestAnimationFrame(tick); else { W3D.endZoom(); W3D.retrace(); }
      };
      requestAnimationFrame(tick);
      return;
    }
    let home = state.routeView ? routeFit(route()) : zoomBack || fitAll();
    if (view.s > home.s + 0.01 || state.w3d?.tilted) {   // 3D 牆走近過、轉過：先回到正面的鏡頭
      if (state.w3d?.tilted) { W3D.untilt(); if (state.routeView) home = routeFit(route()); }
      zoomBack = null; flyTo(home.s, home.tx, home.ty); return;
    }
    zoomBack = state.routeView ? null : { s: view.s, tx: view.tx, ty: view.ty };
    const r = $('stage').getBoundingClientRect(), px = ev.clientX - r.left, py = ev.clientY - r.top;
    const s = Math.min(maxScale(), view.s * RouteKit.DOUBLE_TAP), k = s / view.s;   // 點兩下放大的倍數（kit 的同一份）
    flyTo(s, px - (px - view.tx) * k, py - (py - view.ty) * k, () => { W3D.walk(); W3D.retrace(); });
  }
  $('stage').addEventListener('click', (ev) => {
    if (suppressClick) { suppressClick = false; return; }
    if (!state.wall) return;
    if (state.mode === 'route' && state.routeView) {   // 看路線圖：點兩下放大／復原；點一下＝收起右下的工具
      const now = ev.timeStamp;   // 事件發生的時間：主執行緒忙的時候，處理第二下時已經過了 350 毫秒也照樣算點兩下
      if (now - lastTap.t < RouteKit.DOUBLE_MS && Math.hypot(ev.clientX - lastTap.x, ev.clientY - lastTap.y) < 40) { dblZoom(ev); lastTap.t = 0; }
      else lastTap = { t: now, x: ev.clientX, y: ev.clientY };
      return;
    }
    const rect = cv.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * (state.w / rect.width), y = (ev.clientY - rect.top) * (state.h / rect.height);
    if (state.overlapPick) { pickOverlap(x, y, ev); return; }
    if (!state.w3d && (x < 0 || y < 0 || x > state.w || y > state.h)) return;   // 點在照片外的黑邊（3D 牆走近、轉角度後畫面會超出正面快照的範圍，照射線判斷）
    const hit = hitHold(x, y, hitTol(rect));
    state.hover = null;
    if (state.mode === 'holds') {
      // 單點編輯只操作這一顆，避免誤選旁邊的岩點；點離它遠一點的地方（螢幕 48 px 以外）＝完成，跟按 ✓ 一樣
      if (state.holdSub && state.selected) { if (!inPoly(x, y, state.selected.poly) && edgeDist(x, y, state.selected.poly) > 48 * state.w / rect.width) history.back(); return; }
      if (state.draft) { draftTap(x, y, rect); return; }
      // 重疊的岩點：再點一下換選下一顆（小到大），最後一顆再點取消選取
      const list = holdsAt(x, y, hitTol(rect));
      if (list.length) {
        const i = list.indexOf(state.selected), next = i + 1 < list.length ? list[i + 1] : null;
        state.selected = next;
        state.overlap = next && list.length > 1 ? { h: next, i: list.indexOf(next) + 1, n: list.length } : null;
        refreshUi(); render(); if (next) focusHold(next); return;
      }
      state.selected = null; state.draft = [[x, y]];   // 點空白處：開始畫
      refreshUi(); render(); focusDraft(x, y);
      return;
    }
    if (hit && !state.routeView && state.w3d && !state.overlapBusy) {   // 3D：被擋住的點看不到外框，先轉角度、走近讓它們露出來再選
      state.overlapBusy = true;
      W3D.reveal(x, y).then((r) => {
        state.overlapBusy = false;
        if (r && openOverlapPick(r.holds, r.back)) return;
        if (r && r.back) W3D.flyBack(r.back);
        cycleRouteHold(hit); const rt = route(); tapFx(ev.clientX, ev.clientY, (rt && rt.holds[hit.id]) || '');
      }, () => { state.overlapBusy = false; });
      return;
    }
    if (hit && !state.routeView && !state.w3d && openOverlapPick(holdsUnder(x, y), null, hit)) return;
    if (hit && !state.routeView) { cycleRouteHold(hit); const r = route(); tapFx(ev.clientX, ev.clientY, (r && r.holds[hit.id]) || ''); return; }
    if (!hit && !state.routeView) {   // 定線：快速點兩下空白處，放大／復原（跟看路線一樣）
      const now = ev.timeStamp;
      if (now - lastTap.t < RouteKit.DOUBLE_MS && Math.hypot(ev.clientX - lastTap.x, ev.clientY - lastTap.y) < 40) { lastTap.t = 0; dblZoom(ev); }
      else lastTap = { t: now, x: ev.clientX, y: ev.clientY };
    }
  });
  // 定線點到重疊的岩點：放大那一塊、選好（或點候選以外取消）就回到原本的縮放和位置
  function openOverlapPick(list, back3d = null, preferred = null) {
    if (list.length < 2) return false;
    const st = $('stage');
    const pick = RouteKit.prepareOverlapPick(list, back3d ? [] : tapHolds(), { w: state.w, h: state.h, width: st.clientWidth, height: st.clientHeight });
    const active = state.overlapPick = { ...pick, preferred, back: { s: view.s, tx: view.tx, ty: view.ty }, back3d, ready: !!back3d };
    if (back3d) { buzz(4); render(); return true; }   // 3D：鏡頭已經轉到看得到每一顆的位置（W3D.reveal），不再放大
    flyView(Math.min(maxScale(), pick.k / (view.bw / state.w)), pick.cx, pick.cy, () => {
      if (state.overlapPick === active) { active.ready = true; renderLines(); }
    }, true);
    buzz(4);
    return true;
  }
  function pickOverlap(x, y, ev) {
    const p = state.overlapPick, direct = state.w3d ? null : hitHold(x, y);
    if (!p.ready) return;
    const h = RouteKit.pickOverlap(p.holds, p.spots, x, y, 16 * screenPx(), direct);
    state.overlapPick = null;
    if (h) {
      cycleRouteHold(h, p.back3d ? render : null);
      const r = route(); tapFx(ev.clientX, ev.clientY, (r && r.holds[h.id]) || '');
    }
    if (p.back3d) { W3D.flyBack(p.back3d); if (!h) render(); return; }
    renderLines(true);
    flyTo(p.back.s, p.back.tx, p.back.ty, render, undefined, true);
  }
  // 相機看線（正式版、測試版都有）：3D 牆載入 /3d/?ui=2&auto=1&wall=…&route=…；
  // 2D 牆載入 /lab/wall2d-cam/?ui=2&auto=1&wall=…&route=… 並透過同源 postMessage 傳入本機牆面與照片
  // 3D 牆要有相機比對資料（/3d/manifest.json 的 wall）才能看線：沒有的不放入口，不給一定打不開的按鈕
  let cam3dWalls = null, cam3dPromise = null;
  const load3dTracking = () => cam3dPromise || (cam3dPromise = fetch('/3d/manifest.json', { credentials: 'omit' })
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => { cam3dWalls = new Set([m?.wall].filter(Boolean)); })
    .catch(() => { cam3dPromise = null; }));
  const trackable = (w) => !!w && (!w.m3d || !!cam3dWalls?.has(w.pid));
  const syncCamEntry = () => {
    const show = $('editor').classList.contains('viewing') && trackable(state.wall);
    $('camTrackBtn').hidden = $('vwCam').hidden = !show;
  };
  let preloadWall2dCam = () => {};
  {
    // 在岩點貓裡蓋一層全螢幕的追蹤頁，不換頁：返回（左上、返回手勢）就收掉，相機跟著關（iframe 換成空白頁）
    let camSession = 0, camPayload = null;
    let wall2dStaticPreloaded = false, wall2dHeavyPreloaded = false, wall2dManifestPromise = null;
    const preloadedWallIds = new Set();
    // 先放進 HTTP 快取，按下相機看線時不用等下載：看路線圖時只抓小的頁面程式；
    // 打開「⋯」（要用的機會大）才抓 OpenCV（約 10 MB）和這面牆的比對資料，省流量模式不先抓
    preloadWall2dCam = (w, heavy = false) => {
      if (!w || w.m3d) return;
      if (!wall2dStaticPreloaded) {
        wall2dStaticPreloaded = true;
        const urls = [
          '/lab/wall2d-cam/',
          '/lab/wall2d-cam/style.css',
          '/lab/wall2d-cam/boot.js',
          '/lab/wall2d-cam/geometry.js',
          '/lab/wall2d-cam/app.js',
          '/lab/wall2d-cam/tracking-log.js',
          '/lab/wall2d-cam/wall2d-worker.js',
          '/3d/source/holds-3d-camera-view.js',
        ];
        for (const u of urls) fetch(u, { credentials: 'omit' }).catch(() => {});
      }
      if (!heavy || navigator.connection?.saveData) return;
      if (!wall2dHeavyPreloaded) {
        wall2dHeavyPreloaded = true;
        fetch('/redpoint/vendor/opencv-4.10.0.js', { credentials: 'omit' }).catch(() => {});
        wall2dManifestPromise = fetch('/lab/wall2d-cam/manifest.json', { credentials: 'omit' })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
      }
      const wallId = w.pid || w.id;
      if (!wallId || preloadedWallIds.has(wallId) || !wall2dManifestPromise) return;
      preloadedWallIds.add(wallId);
      wall2dManifestPromise.then((manifest) => {
        const entry = manifest?.walls?.find((e) => e.wall === wallId);
        if (!entry) return;
        const base = `${location.origin}/lab/wall2d-cam/`;
        if (entry.camera?.url) fetch(new URL(entry.camera.url, base).href, { credentials: 'omit' }).catch(() => {});
        if (entry.wallJson) fetch(new URL(entry.wallJson, base).href, { credentials: 'omit' }).catch(() => {});
        if (entry.routesJson) fetch(new URL(entry.routesJson, base).href, { credentials: 'omit' }).catch(() => {});
      }).catch(() => {});
    };
    $('vwMore')?.addEventListener('click', () => {
      if (state.wall && !state.wall.m3d) preloadWall2dCam(state.wall, true);
    });
    const hideCam = () => { camSession++; camPayload = null; $('camView').hidden = true; $('camFrame').src = 'about:blank'; };
    const closeCam = () => { hideCam(); return closeOverlay('camView'); };
    const sendWall2dData = async (session) => {
      const p = camPayload;
      if (!p || session !== camSession || $('camView').hidden) return;
      const win = $('camFrame').contentWindow;
      if (!win) return;
      let photo = await (p.photoPromise || getImage(p.id).catch(() => null));
      if (!photo && p.img && typeof p.img.toBlob === 'function') {
        photo = await new Promise((res) => p.img.toBlob(res, 'image/jpeg', 0.92));
      }
      if (session !== camSession || $('camView').hidden || $('camFrame').contentWindow !== win) return;
      win.postMessage({
        type: 'climbio-wall2d-data',
        wallId: p.wallId,
        name: p.name,
        w: p.w,
        h: p.h,
        updatedAt: p.updatedAt,
        holds: p.holds,
        photo,
      }, location.origin);
    };
    $('camFrame').addEventListener('load', () => {
      if (camPayload && !$('camView').hidden) sendWall2dData(camSession);
    });
    window.addEventListener('message', (ev) => {
      if (ev.origin !== location.origin || ev.source !== $('camFrame').contentWindow) return;
      if (ev.data?.type === 'climbio-wall2d-request' && camPayload) sendWall2dData(camSession);
    });
    $('camTrackBtn').onclick = $('vwCam').onclick = () => {
      const w = state.wall, r = w && w.routes.find(x => x.id === state.routeId);
      if (!r) return;
      const routeParam = encodeURIComponent(Object.entries(r.holds).map(([id, k]) => `${id}:${k}`).join(','));
      ++camSession;
      if (w.m3d) {
        camPayload = null;
        $('camFrame').src = `${location.origin}/3d/?ui=2&auto=1&wall=${encodeURIComponent(w.pid)}&route=${routeParam}`;
      } else {
        const wallId = w.pid || w.id;
        const byId = new Map();
        for (const h of (w.holds || [])) byId.set(h.id, { id: h.id, poly: h.poly });
        for (const h of holdsOf(r, w)) if (!byId.has(h.id)) byId.set(h.id, { id: h.id, poly: h.poly });
        camPayload = {
          id: w.id,
          wallId,
          name: w.name || '',
          w: state.w || w.w,
          h: state.h || w.h,
          updatedAt: w.updatedAt || 0,
          holds: [...byId.values()],
          img: state.img,
          photoPromise: getImage(w.id).catch(() => null),
        };
        $('camFrame').src = `${location.origin}/lab/wall2d-cam/?ui=2&auto=1&wall=${encodeURIComponent(wallId)}&route=${routeParam}`;
      }
      $('camView').hidden = false;
      openOverlay('camView', hideCam);
    };
    $('camClose').onclick = () => closeCam();
  }
  const pressBtns = (sel, on) => { for (const b of document.querySelectorAll(sel)) b.setAttribute('aria-pressed', on); };   // 定線上方和看路線圖上方各有一顆，狀態一起換
  // 路線的底切換灰階／暗彩（只在這一頁、只在畫面上看；分享的圖一律灰階）：手機按上方的圓鈕或快速點兩下（看路線圖在路線視角時、定線點空白處），電腦按空白鍵
  function toggleBase(mode = baseMode() === 'dim' ? 'gray' : 'dim') {
    bases[setting() ? 'set' : 'view'] = mode; saveBases();
    baseSwap();
    pressBtns('.base-btn', mode === 'dim');
    if (editorUi) editorUi.setOptions({ base: mode });
    render();
  }
  // 底色換了（灰階↔暗彩：按圓鈕、點兩下、看路線圖↔定線）：舊的畫面先複製一張蓋在上面，從手指剛按的地方挖一個圓、越擴越大，
  // 新的底色從那裡漫開，邊上跟著一圈淡淡的光環。在 render() 之前呼叫（那時照片畫布上還是舊的）
  let lastTouch = { x: 0, y: 0, t: -1e9 };
  addEventListener('pointerdown', (e) => { lastTouch = { x: e.clientX, y: e.clientY, t: performance.now() }; }, { capture: true, passive: true });
  function baseSwap() {
    if (calm() || !cv.width || $('editor').hidden) return;
    const old = document.createElement('canvas'); old.width = cv.width; old.height = cv.height;
    old.getContext('2d').drawImage(cv, 0, 0);
    old.style.cssText = cv.style.cssText; old.className = 'base-swap';
    const r = cv.getBoundingClientRect(), W = cv.offsetWidth, H = cv.offsetHeight, k = W / r.width;
    const recent = performance.now() - lastTouch.t < 1500, cx = recent ? lastTouch.x : r.left + r.width / 2, cy = recent ? lastTouch.y : r.top + r.height / 2;
    const x = (cx - r.left) * k, y = (cy - r.top) * k, R = Math.hypot(Math.max(x, W - x), Math.max(y, H - y));
    cv.after(old);
    const ring = document.createElement('i'); ring.className = 'base-ring'; document.body.append(ring);
    const t0 = performance.now(), ms = 650;
    const step = (now) => {
      const a = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - a, 3), rr = R * e;
      old.style.clipPath = `path(evenodd, "M0 0H${W}V${H}H0Z M${x - rr} ${y}a${rr} ${rr} 0 1 0 ${2 * rr} 0a${rr} ${rr} 0 1 0 ${-2 * rr} 0Z")`;
      const sr = rr / k;
      Object.assign(ring.style, { left: `${cx - sr}px`, top: `${cy - sr}px`, width: `${2 * sr}px`, height: `${2 * sr}px`, opacity: String(1 - a) });
      if (a < 1) requestAnimationFrame(step); else { old.remove(); ring.remove(); }
    };
    requestAnimationFrame(step);
  }
  // 定線長按：單點編輯（手機唯一改岩點的地方）。外框只在使用者動手時才變：已有的岩點選起來給人拖頂點、按「重描」；
  // 漏掉的岩點直接進「圈起來」，畫一圈才補上（3D 牆沒有圈，照舊先放方框、依顏色長成岩點）。
  // 從定線長按進來前的縮放、位置：回到定線時平滑地回到這裡
  let holdView = null;
  // 3D 牆是模型快照，外框直接編輯；一般照片（含舊版留在本機的牆）走正常重描流程。
  const noModel = (w) => !!w?.m3d;
  function enterHoldEdit(hit, x, y) {
    holdStart = wallSnap(state.wall); state.holdSub = true;
    holdView = { s: view.s, tx: view.tx, ty: view.ty };
    history.pushState({ s: 'hold' }, '');
    setMode('holds');
    if (hit && !state.wall.holds.includes(hit)) {   // 路線自帶、我的岩點檔沒有的那顆：先複製進我的岩點檔再改
      hit = touch({ id: hit.id, poly: copyPoly(hit.poly), source: hit.source });
      state.wall.holds.push(hit);
    }
    hit = pickHold(hit, x, y);
    buzz(12); refreshUi(); render();
    // 以長按的位置為中心放大：照片上這一點留在指尖下（碰到照片邊緣才會偏）；要圈的漏網岩點以一般岩點的大小估
    const b = hit && bbox(hit.poly), med = medianArea();
    const size = (b ? Math.max(b.x1 - b.x0, b.y1 - b.y0) : Number.isFinite(med) ? Math.sqrt(med) : Math.min(state.w, state.h) / 20) * view.bw / state.w;
    const s1 = Math.min(maxScale(), Math.max(2, view.s, $('stage').clientWidth / 3 / size));
    const k0 = view.bw * view.s / state.w, k1 = view.bw * s1 / state.w;
    flyTo(s1, view.tx + x * (k0 - k1), view.ty + y * (k0 - k1));
  }
  function pickHold(hit, x, y) {
    if (hit) {
      holdView.picked = { h: hit, poly: hit.poly, source: hit.source };
      state.selected = hit; resetUndo();
      return hit;
    }
    const host = volumeAt(x, y);   // 補在 volume 上：新的這顆可以蓋在這顆 volume 上
    holdView.host = host;
    if (!state.w3d) { state.selected = null; resetUndo(); setLasso(true); return null; }   // 照片：圈起來才補上（finishLasso）
    hit = touch({ id: uid('h'), poly: fallbackHoldOutline(x, y, state.wall.holds.filter(h => h !== host)), source: 'manual' });
    state.wall.holds.push(hit);
    holdView.added = hit.id;
    state.selected = hit;
    touchGeom();
    save();
    resetUndo();   // 補上這顆不算一步（不要就按取消）
    growAddedHold(hit, x, y);
    return hit;
  }
  // 長按後手指移到別處才放開：收回剛才那一點的補點或重算，改編輯放開的這一點（畫面不動）。
  // 換一個 holdView，還在算的舊結果就不會再套用
  function retargetHold(x, y) {
    if (!state.holdSub || !holdView || (!state.w3d && (x < 0 || y < 0 || x > state.w || y > state.h))) return;
    const w = state.wall, { added, picked, host, ...v } = holdView;
    w.holds = w.holds.filter(h => h.id !== added);
    if (picked) { picked.h.poly = picked.poly; picked.h.source = picked.source; }
    holdView = v;
    setLasso(false);
    pickHold(pressHold(x, y), x, y);
    touchGeom(); save();
    buzz(12); refreshUi(); render();
  }
  // 3D 牆補點：等放大到這顆（岩點在畫面上夠大）再從畫面依顏色描出岩點，方框慢慢長成它（不用模型）
  async function growAddedHold(h, x, y) {
    const w = state.wall, before = h.poly, session = holdView;
    const alive = () => state.wall === w && state.mode === 'holds' && state.holdSub && holdView === session && state.selected === h && w.holds.includes(h);
    await pause(450);
    if (!alive() || h.poly !== before) return;
    const others = state.scene.holds.filter(o => o !== h && o !== session.host), poly = W3D.grow(x, y, others);
    if (poly && alive() && h.poly === before) morphPoly(h, despike(simplifyPoly(poly)), 500, alive, () => { touch(h); touchGeom(); save(); refreshUi(); render(); });
  }
  // 外框從 h.poly 平滑變成 to（兩邊各沿著邊等距取 32 點、對齊起點再內插），ok() 不成立（例如使用者動了）就停；最後換成 to 本身
  function morphPoly(h, to, ms, ok, done) {
    const N = 32, ring = (poly) => {
      const segs = poly.map((p, i) => { const q = poly[(i + 1) % poly.length]; return [p, q, Math.hypot(q[0] - p[0], q[1] - p[1])]; });
      const len = segs.reduce((a, s) => a + s[2], 0), out = [];
      let si = 0, acc = 0;
      for (let k = 0; k < N; k++) {
        const d = len * k / N;
        while (acc + segs[si][2] < d && si < segs.length - 1) { acc += segs[si][2]; si++; }
        const [p, q, l] = segs[si], f = l ? (d - acc) / l : 0;
        out.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]);
      }
      return out;
    };
    const turn = (poly) => poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);   // 正負＝繞的方向
    const a = ring(h.poly);
    let b = ring(Math.sign(turn(h.poly)) !== Math.sign(turn(to)) ? to.slice().reverse() : to);
    const s0 = b.reduce((best, p, i) => Math.hypot(p[0] - a[0][0], p[1] - a[0][1]) < Math.hypot(b[best][0] - a[0][0], b[best][1] - a[0][1]) ? i : best, 0);
    b = b.slice(s0).concat(b.slice(0, s0));
    const t0 = performance.now(); let last = null;
    const step = (now) => {
      if (!ok() || (last && h.poly !== last)) return;
      const f = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - f, 3);
      if (f >= 1) { h.poly = to.map(p => p.slice()); done(); return; }
      h.poly = last = a.map((p, i) => [p[0] + (b[i][0] - p[0]) * e, p[1] + (b[i][1] - p[1]) * e]);
      touchGeom(); render(); requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  // 上方的進度條：下載模型、跟雲端要照片特徵（frac 是 null＝不知道還要多久）
  function samProgress(text, frac) {
    $('samProg').hidden = false;
    $('samProgText').textContent = text;
    $('samProg').classList.toggle('indet', frac == null);
    if (frac != null) $('samProgBar').style.width = `${Math.round(frac * 100)}%`;
    placeHoldActions();
  }
  // 背景還在重描、整理外框（computing）時長按：不進單點編輯，上方顯示還在描，算完自動收起（detectHolds）
  let lockHint = null;
  function holdLocked() {
    const w = state.wall;
    if (!computing(w)) return false;
    lockHint = w; samProgress(t('tracingWall'), null); buzz(8);
    return true;
  }
  // 「重描」鈕：用目前的外框當提示跑一次 MobileSAM。結果輪廓有效、包住原本的中心、不壓到旁邊的岩點（蓋在上面的、所在的 volume 不算）、
  // 面積是原本的 1/5～5 倍才換上（算一步，復原拿得回原本的）；不合格就留著原本的並提示
  // auto：畫完圈自動貼齊（finishLasso）：靜靜地做——不合格、失敗都保留畫的圈、不提示；換上時併進畫圈那一步，復原一次回到畫圈之前
  let retracing = false;
  async function retraceSelected({ auto = false } = {}) {
    const R = window.HoldRefiner, w = state.wall, h = state.selected;
    if (!R || !w || !h || retracing || noModel(w) || !state.holdSub) return;
    const before = h.poly, session = holdView, original = JSON.stringify(before);
    const current = () => state.wall === w && state.mode === 'holds' && state.holdSub && holdView === session
      && state.selected === h && w.holds.includes(h) && h.poly === before && JSON.stringify(before) === original;
    const c = centroid(before), [x, y] = inPoly(c[0], c[1], before) ? c : before[0];
    const others = w.holds.filter(o => o !== h && o !== session?.host && inside(o.poly, before) < 0.5), a0 = area(before);
    const good = (p) => !!p && validAddedOutline(p, x, y, others) && area(p) / a0 > 0.2 && area(p) / a0 < 5;
    retracing = true; refreshUi(); buzz(8);
    samProgress(t('refining'), null);
    try {
      const result = await R.refine(state.img, w.id, before, (text, frac) => { if (current()) samProgress(text, frac); });
      $('samProg').hidden = true;
      if (!current()) return;
      const poly = result && despike(simplifyPoly(result));
      if (!good(poly)) { if (!auto) toast(t('refineKept')); return; }
      if (auto) undo.at = Date.now();   // 跟畫圈那一步併成一步（save() 在 600 ms 內的變動不另開一步）
      h.poly = poly;
      if (h.source === 'detect') h.source = 'edited';
      touch(h); touchGeom(); save(); buzz(8);
    } catch (e) {
      $('samProg').hidden = true;
      if (current() && !auto) toast(t('refineFailed') + (e.message || e));
    } finally { retracing = false; if (state.wall === w) { refreshUi(); render(); } }
  }
  // 單點編輯：圈起來（手機）。按膠囊的「圈」，或長按沒有岩點的地方，手指在照片上畫一圈：畫的圈（去掉繞過起點多畫的一段、手抖）
  // 就是外框，有選到的岩點就換掉它（算一步，復原拿得回來），沒有就補一顆新的。放開後自動用圈當提示重描貼齊（retraceSelected 的 auto），
  // 貼不上（模型沒備好、結果不合格）就留著畫的圈；之後還能按「重描」再來一次
  function setLasso(on) {
    state.lasso = !!on && state.mode === 'holds' && state.holdSub;
    state.lassoPts = null;
    $('holdLasso').setAttribute('aria-pressed', String(state.lasso));
    $('holdLasso').setAttribute('aria-label', t(state.lasso ? 'lassoCancel' : 'lasso'));   // 圈的時候這顆是「取消」（×）
    $('holdLasso').querySelector('use').setAttribute('href', state.lasso ? '#i-plus' : '#i-lasso');
    $('holdActions').classList.toggle('lassoing', state.lasso);
    refreshUi();
    render();
  }
  // 取消「圈起來」（× 鈕、電腦版 Esc）：有選到岩點（從它進來重畫外框的）回到調整它；沒有（長按空白處進來的）就整個離開單點編輯
  function cancelLasso() {
    if (!state.lasso) return false;
    if (state.selected) setLasso(false); else history.back();
    return true;
  }
  function finishLasso(loop) {
    const w = state.wall, h = state.selected;
    if (!w || !state.holdSub || state.mode !== 'holds') return;
    const k = view.bw * view.s / state.w, closed = loop.map(p => [+p[0].toFixed(1), +p[1].toFixed(1)]);
    if (closed.length < 6 || area(closed) * k * k < 400) { toast(t('lassoSmall')); return; }   // 畫得太小，多半是手滑
    const poly = lassoOutline(closed, 1 / k);
    if (!validAddedOutline(poly, poly[0][0], poly[0][1], [])) { toast(t('lassoFail')); return; }   // 有效、在照片裡、不自己交叉
    if (h) {
      h.poly = poly;
      if (h.source === 'detect') h.source = 'edited';
      touch(h); touchGeom(); save();
    } else {
      const n = touch({ id: uid('h'), poly, source: 'manual' });
      w.holds.push(n); holdView.added = n.id; state.selected = n;
      touchGeom(); save();
      resetUndo();   // 補上這顆不算一步（不要就按取消）
    }
    if (holdView) holdView.lassoed = true;   // 圈完了：膠囊裡的「圈」收起來（不然像是還要再圈一次），要重畫就復原
    setLasso(false); buzz(8);
    retraceSelected({ auto: true });   // 手指畫的圈多半歪歪的：用圈當提示貼齊岩點的邊（模型還沒備好就不貼，維持畫的圈）
  }
  // a 有幾成在 b 裡面（在 a 的外接框裡取樣 16×16）
  function inside(a, b) {
    const { x0, y0, x1, y1 } = bbox(a), dx = (x1 - x0) / 16, dy = (y1 - y0) / 16;
    let n = 0, hit = 0;
    for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) {
      const x = x0 + (i + 0.5) * dx, y = y0 + (j + 0.5) * dy;
      if (!inPoly(x, y, a)) continue;
      n++; if (inPoly(x, y, b)) hit++;
    }
    return n ? hit / n : 0;
  }
  function leaveHoldEdit() {
    $('samProg').hidden = true;
    setLasso(false);
    const w = state.wall, added = holdView && w.holds.find(h => h.id === holdView.added);
    const picked = holdView && holdView.picked && w.holds.includes(holdView.picked.h) ? holdView.picked.h : null, r = route();
    if (picked && r && r.holds[picked.id] && r.shapes) { r.shapes[picked.id] = shapeOf(picked); save(); }   // 改的這顆：只換這條路線的外框，別的路線不動
    W3D.edited(added || picked, holdStart);
    state.holdSub = false; holdStart = '';
    setMode('route');
    if (added && route() && !route().holds[added.id]) cycleRouteHold(added);
    if (holdView) { const v = holdView; holdView = null; flyTo(v.s, v.tx, v.ty); }
  }
  // 定線：點岩點用目前選的類型（下方按鈕）加進路線；已在路線上、類型不同就改成目前的類型，類型一樣就拿掉（規則在 RouteKit.tapHold）。
  // 剛加進來的同一顆在 0.4 秒內又被點到（不小心快速點兩下）：不算拿掉，不然點了等於沒點（新手關卡會卡住）
  let holdTapAt = { id: null, t: 0 };
  function cycleRouteHold(hit, redraw = render) {
    const r = route() || newRoute();
    state.current = hit;
    if (state.addType === 'n') return seqTap(r, hit, redraw);
    const now = performance.now(), res = RouteKit.tapHold(r, hit.id, state.addType || 'h', { justAdded: holdTapAt.id === hit.id && now - holdTapAt.t < 400 });
    if (res === 'ignored') return;
    if (res === 'full') { setAddType('h', true); editorUi.hooks.onLimit(); toast(t('startMax', MAX_START)); return; }   // 起攀滿了：已在路線上的不動
    if (res !== 'removed') holdTapAt = { id: hit.id, t: now };
    if (RouteKit.nextType(r, state.addType, MAX_START) !== state.addType) setAddType('h', true);   // 起攀滿了：之後新的點是手點
    touch(r); save(); refreshUi(); redraw?.();
  }
  // 出手順序：每次點選都追加一手。順序列、類型列、不限腳的長按、上方的取消／完成／暗彩／顯示所有岩點都是 kit 的操作介面 RouteKit.EditorUI
  // （內嵌頁用同一份），這裡只提供「控制器」：把按下的動作接到岩點貓的狀態（state.addType、路線、存檔）。
  // 長按有編號的岩點：接下來點的岩點插在它最後一個編號之後（seqSession 的 startInsert），按「結束插入」才回到接在最後。
  const seqSession = RouteKit.orderSession();   // 規則（追加、插入、刪除、復原）在 kit（editor.js），內嵌頁用同一份
  function seqTap(r, hit, redraw = render) { seqSession.tap(r, hit.id); touch(r); save(); refreshUi(); redraw?.(); }
  // 順序模式長按有編號的岩點：選在它最後一個編號之後插入，或刪掉它的某一手；回傳有沒有處理（沒有編號就交給單點編輯）
  function seqHoldAsk(hit) {
    const r = route(), nums = seqSession.numbers(r, hit.id);
    if (!nums.length) return false;
    buzz(12);
    editorUi.hooks.onOrderAsk({ id: hit.id, nums });
    return true;
  }
  function applyAddType(k) {
    if (state.addType === 'n' && k !== 'n') seqSession.reset();   // 離開順序模式：別的類型會改順序，復原紀錄作廢
    state.addType = k;
  }
  // 規則自動換了類型（起攀滿了、不限腳切掉腳點）、換路線時重設：介面跟著換（anim＝色塊滑過去）
  function setAddType(k, anim) { applyAddType(k); if (editorUi) editorUi.pickType(k, true, !!anim); }
  const routeCtl = {
    get type() { return state.addType || 'h'; },
    setType(k) { applyAddType(k); },   // 介面自己會換
    get showAll() { return !!state.showAll; },
    setShowAll(on) { if (!!state.showAll !== !!on) toggleShowAll(); },
    zoomStep() { /* 岩點貓的縮放鈕是頁面右側的 .photo-zoom */ },
    get canUndoSeq() { return seqSession.canUndo(route()); },
    undoSeq() { const r = route(); if (r && seqSession.undo(r)) { touch(r); save(); } refreshUi(); render(); return true; },
    get orderInfo() { const r = route(); return { len: r && r.seq ? r.seq.length : 0, insertAt: seqSession.insertAt(r), canUndo: seqSession.canUndo(r) }; },
    orderInsertAfter(n) { seqSession.startInsert(route(), n); refreshUi(); },
    orderEndInsert() { seqSession.endInsert(); refreshUi(); },
    orderRemove(n) { const r = route(); seqSession.remove(r, n); touch(r); save(); refreshUi(); render(); },
    orderClear() { const r = route(); if (!r) return; seqSession.clear(r); touch(r); save(); refreshUi(); render(); },
    // 不限腳：長按腳點切換這條路線不限腳；路線上已經有腳點時，開了會清掉，介面問過（{ clear: true }）才開
    toggleFeetFree({ clear = false } = {}) {
      const r = route() || newRoute();
      if (!r.feetFree && Object.values(r.holds).includes('f')) {
        if (!clear) return 'confirm';
        RouteKit.clearFeet(r); seqSession.reset();
      }
      RouteKit.toggleFeetFree(r);
      touch(r); save(); buzz(12); refreshUi(); render();
      return r.feetFree ? 'on' : 'off';
    },
  };
  // 介面的文字：照岩點貓目前的語言（t）；沒對到的鍵用 kit 內建
  function editorText(k, ...a) {
    const m = { cancel: 'cancel', base: 'baseToggle', heat: 'showHolds', zout: 'zoomOut', zin: 'zoomIn', done: 'done', undo: 'undo', orderEnd: 'seqEnd', s: 'start', h: 'hand', t: 'top', f: 'foot', n: 'seq', feetFree: 'feetFree',
      orderAt: 'seqInsertAt', orderFirst: 'seqInsertFirst', orderCount: 'seqMove', delMove: 'seqDelete', feetAsk: 'feetClearAsk', feetGo: 'feetClear', seqAsk: 'seqClearAsk', seqClear: 'seqClear' };
    return m[k] ? t(m[k], ...a) : undefined;
  }
  editorUi = RouteKit.EditorUI.mount($('editor'), {
    mode: 'edit', controls: false, zoom: false, fullscreen: false, interactive: true, heat: true, foot: true, order: true, base: 'dim', t: editorText,
    onDone: () => { if (state.draft && state.draft.length >= 3) finishDraft(); history.back(); },
    onCancel: () => cancelEdit(),
    onBase: (b) => toggleBase(b),
    onPrev: () => stepRoute(-1), onNext: () => stepRoute(1),   // 看路線圖的上一條、下一條
  });
  // 所有頁面程式載完才接上控制器（main.js 開頭呼叫）：介面一接上就會讀路線，route() 在後面的檔案裡
  function attachEditorUi() {
    editorUi.attach(routeCtl, () => route());
    self.climbioRefreshText = () => editorUi.refreshText();   // 切語言（app.js 的 applyLang）：介面文字重畫
    editorUi.slot('start', $('rGrade'));      // 難度轉盤：取消鈕右邊
  }
  // 介面的狀態跟著岩點貓（只在定線、不是看路線圖時出現；單點編輯有自己的膠囊）
  function syncEditorUi() {
    if (!editorUi) return;
    const editingRoute = state.mode === 'route' && !state.routeView && !$('editor').hidden;
    if (editingRoute && route() && route().feetFree && state.addType === 'f') applyAddType('h');   // 不限腳就不再選腳點，切回手點
    const viewing = state.mode === 'route' && state.routeView && !$('editor').hidden;   // 看路線圖：上方是岩點貓自己的 #vw，下面的上一條／下一條用 kit 的
    $('editor').classList.toggle('rk-routing', editingRoute);
    editorUi.setOptions({ mode: viewing ? 'view' : 'edit', controls: editingRoute || viewing, top: editingRoute, nav: viewing, base: baseMode() });
    if (viewing) { const rs = sortedRoutes(), i = rs.indexOf(route()); editorUi.setNav({ index: Math.max(0, i), total: rs.length }); }
    editorUi.update();
  }
  // 滑鼠移到岩點上：亮框＋手指游標（觸控不需要）
  cv.addEventListener('pointermove', (ev) => {
    if (ev.pointerType !== 'mouse' || !state.wall || ev.buttons) return;
    const rect = cv.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * (state.w / rect.width), y = (ev.clientY - rect.top) * (state.h / rect.height);
    if (state.draft) { cv.style.cursor = 'crosshair'; state.cursor = [x, y]; state.hover = null; render(); return; }
    if (hitHandle(ev.clientX, ev.clientY)) { cv.style.cursor = 'grab'; if (state.hover) { state.hover = null; render(); } return; }
    const hit = hitHold(x, y, hitTol(rect));
    cv.style.cursor = hit ? 'pointer' : (state.mode === 'holds' ? 'crosshair' : 'default');
    if (hit !== state.hover) { state.hover = hit; render(); }
  });
  cv.addEventListener('pointerleave', () => { if (state.hover || state.cursor) { state.hover = null; state.cursor = null; render(); } });

  // ---------- 畫岩點（多邊形）----------
  // 畫岩點中點一下（或放大鏡瞄準後放開）：點回第一點就完成，否則加一個點；還沒開始畫就從這一點開始
  function draftTap(x, y, rect) {
    if (!state.draft) { state.selected = null; state.draft = [[x, y]]; }
    else if (state.draft.length >= 3 && Math.hypot(x - state.draft[0][0], y - state.draft[0][1]) < 14 * state.w / rect.width) { finishDraft(); return; }
    else state.draft.push([x, y]);
    refreshUi(); render();
  }
  function finishDraft() {
    const d = state.draft, w = state.wall;
    if (!d || d.length < 3) return;
    const h = touch({ id: uid('h'), poly: d.map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]), source: 'manual' });
    w.holds.push(h);
    state.draft = null; state.cursor = null; state.selected = h;
    save(); refreshUi(); render();
  }
  function cancelDraft() { if (!state.draft) return; state.draft = null; state.cursor = null; refreshUi(); render(); }
  function undoDraft() {
    if (!state.draft) return;
    state.draft.pop();
    if (!state.draft.length) state.draft = null;
    refreshUi(); render();
  }
  function drawDraft(c) {
    const d = state.draft; if (!d || !d.length) return;
    const px = state.w / cv.getBoundingClientRect().width;   // 一個螢幕像素等於幾個影像像素（含縮放）
    c.save();
    c.lineJoin = c.lineCap = 'round';
    const path = () => { c.beginPath(); c.moveTo(d[0][0], d[0][1]); for (const [x, y] of d.slice(1)) c.lineTo(x, y); };
    if (d.length >= 3) { path(); c.closePath(); c.fillStyle = 'rgba(250,204,21,0.18)'; c.fill(); }
    path(); if (state.cursor) c.lineTo(...state.cursor);
    c.lineWidth = 5 * px; c.strokeStyle = 'rgba(0,0,0,0.6)'; c.stroke();
    c.lineWidth = 2.5 * px; c.strokeStyle = '#facc15'; c.stroke();
    d.forEach(([x, y], i) => {
      c.beginPath(); c.arc(x, y, (i === 0 && d.length >= 3 ? 9 : 5) * px, 0, Math.PI * 2);
      c.fillStyle = i === 0 ? '#facc15' : '#fff'; c.fill();
      c.lineWidth = 2 * px; c.strokeStyle = 'rgba(0,0,0,0.7)'; c.stroke();
    });
    c.restore();
  }
  $('draftUndo').onclick = undoDraft;
  $('draftCancel').onclick = cancelDraft;
  $('draftDone').onclick = finishDraft;
  // 長按改外框用的解碼器和這面牆的照片特徵（holdkit 的 HoldRefiner）：偵測時、進入定線時在背景準備；
  // 這台沒有這面牆的照片特徵（收到的分享、別台偵測的）就跟雲端要一次，之後長按不用等
  function warmSam() {
    const R = window.HoldRefiner, w = state.wall, img = state.img;   // samrefine.js 在主程式之後才載入
    if (!R || (w && noModel(w))) return;
    warmRefiner();
    if (!w || !img || computing(w) || navigator.onLine === false) return;
    R.hasEmb(w.id).then(has => { if (!has && state.wall === w && !computing(w)) R.traceWall(img, w.id, []).catch(() => { /* 長按時再試 */ }); });
  }
  function deleteSelected() {
    if (!state.selected) return;
    const w = state.wall, h = state.selected, id = h.id, at = w.holds.indexOf(h);
    w.holds = w.holds.filter(x => x !== h);
    const r = state.holdSub && route();   // 定線時刪掉：這條路線也拿掉；別的路線自帶外框，不受影響
    const type = r && r.holds[id], seq = r && r.seq && [...r.seq], added = holdView && holdView.added === id;
    if (type) { delete r.holds[id]; RouteKit.dropSeq(r, id); seqSession.reset(); touch(r); }
    state.selected = null; save();
    if (state.holdSub) {   // 單點編輯刪掉那一顆：回到定線；提示裡按「復原」放回來（路線上的類型、順序一起）
      addEventListener('popstate', () => toast(t('deleted'), { action: { label: t('undo'), run: () => {
        if (state.wall !== w || route() !== r || w.holds.some(x => x.id === id)) return;
        w.holds.splice(Math.min(at, w.holds.length), 0, h);
        touchGeom();
        if (type) { r.holds[id] = type; if (seq) r.seq = seq; touch(r); }
        save();
        if (added) cycleRouteHold(h); else { refreshUi(); render(); }   // 這次才補上的：照完成時一樣加進路線
      } } }), { once: true });   // 等回到定線再顯示（換頁會收掉提示）
      history.back(); return;
    }
    refreshUi(); render();
  }

  // 難度轉盤（定線時在上方）：左右滑或點旁邊的難度切換，一次只看得到前後幾個；選的難度記在這台，下一條新路線沿用。
  // 滑過每一格輕震一下。程式捲動（換路線）不算使用者選的，不改記住的難度
  // 轉盤照這條路線用的難度系統排（段級的字比較寬，一格也寬一點）
  const LAST_GRADE_KEY = 'climbio.lastGrade';
  const lastGrade = () => { const g = lsGet(LAST_GRADE_KEY, null), sys = gradeSys(); return g in GRADE_RANK && sysOf(g) === sys ? g : DEFAULT_GRADE[sys]; };
  // 轉盤本體在 kit（RouteKit.gradeDial，內嵌頁共用）；這裡只管記住、存進路線
  let dial = null;
  function buildDial() {
    dial = RouteKit.gradeDial($('rGrade'), { sys: gradeSys(), token: () => state.routeId, onTick: () => buzz(3), onPick: (g, rid) => { if (state.routeId === rid) pickGrade(g); } });   // 停下來時換了路線就不算
  }
  const setDial = (g) => { if (dial) dial.setValue(g, false, gradeSys()); };
  function pickGrade(g) {
    lsSet(LAST_GRADE_KEY, g);
    const r = route();
    if (r && r.grade !== g) { r.grade = g; touch(r); save(); }
    refreshUi();
  }
  function newRoute() {
    const w = state.wall;
    const r = touch({ id: uid('r'), name: '', grade: lastGrade(), holds: {} });
    w.routes.push(r); state.routeId = r.id;
    return r;
  }
  // 沒有任何岩點的路線不存（例如點了「新路線」又沒加點就返回）；回傳有沒有刪掉
  function dropEmptyRoute() {
    const w = state.wall, r = route();
    if (!w || !r || Object.keys(r.holds).length) return false;
    const rs = sortedRoutes(), i = rs.indexOf(r);
    w.routes.splice(w.routes.indexOf(r), 1); rs.splice(i, 1);
    buryRoute(w, r);
    const next = rs[Math.min(i, rs.length - 1)];
    state.routeId = next ? next.id : null;
    save();
    return true;
  }

  let lastViewing = null;
  function setMode(m) {
    if (typeof resetRouteSwipe === 'function') resetRouteSwipe();
    state.mode = m; state.selected = null; state.draft = null; state.cursor = null; state.current = null;
    state.overlapPick = null;
    const viewing = m === 'route' && state.routeView;
    if (state.addType === 'n' && (m !== 'route' || viewing)) hideToast();
    $('viewPanel').hidden = !viewing;
    $('routePanel').hidden = !(m === 'route' && !viewing);
    $('holdPanel').hidden = m !== 'holds';
    pressBtns('.base-btn', baseMode() === 'dim');
    // 顯示所有岩點只在定線有效，看路線圖↔定線、重新進來都回到關
    if (state.showAll && viewing !== lastViewing) { state.showAll = false; pressBtns('.outline-btn', false); }
    lastViewing = viewing;
    $('edDelRoute').hidden = !(m === 'route' && !viewing);
    if (typeof refreshXfer === 'function') refreshXfer();
    // 看路線圖：照片滿版，上下工具列收掉，改用浮在照片上的控制（見 index.html 的 #vw）
    $('editor').classList.toggle('viewing', viewing);
    // 看路線圖：返回｜分享、⋯（編輯、刪除）；編輯路線：取消｜完成（改的東西隨時存，取消＝回到進來編輯前的樣子）
    const editing = !viewing;   // 編輯路線、岩點：左上取消、右上完成
    $('edMenuBtn').hidden = $('shareBtn').hidden = !viewing; $('edMenu').hidden = true;   // 看路線圖：分享直接放在上方
    {
      $('camTrackBtn').hidden = !(viewing && trackable(state.wall));
      $('vwCam').hidden = !(viewing && trackable(state.wall));   // 看路線圖右上「⋯」選單裡（#vw）
      if (viewing && state.wall?.m3d && !cam3dWalls) { const w = state.wall; load3dTracking().then(() => { if (state.wall === w) syncCamEntry(); }); }
      if (viewing && trackable(state.wall) && !state.wall.m3d) setTimeout(() => preloadWall2dCam(state.wall), 0);
    }
    $('vwMenu').hidden = true; $('vwMore').setAttribute('aria-expanded', 'false');
    // 公開牆只能修改、刪除自己的路線；別人的線在私人牆（收來的）可以改（另存成自己的）、刪，但不改名
    const cur = route(), lockedPub = !!cur && isPublic(state.wall) && !mineRoute(cur);
    $('vwEdit').hidden = $('vwDel').hidden = lockedPub || !cur; $('vwRename').hidden = !cur || !mineRoute(cur);
    $('edBack').hidden = editing;
    $('edCancel').hidden = !(editing && m === 'holds');   // 定線的取消、完成在操作介面（RouteKit.EditorUI）；單點編輯：取消在左上，完成在岩點旁的膠囊裡（#holdDone）
    $('rGrade').hidden = !(m === 'route' && !viewing);   // 定線：難度在上方
    $('viewTitle').hidden = !viewing;                     // 看路線圖：難度＋名稱（點名稱直接改）
    $('edTitle').hidden = viewing;

    if (m === 'route' && !route() && state.wall.routes.length) state.routeId = sortedRoutes()[0].id;
    if (shownBase && m === 'route' && shownBase !== baseMode()) baseSwap();   // 看路線圖↔定線：底色換了
    refreshUi(); refitStage(); render();
  }

  function refreshUi() {
    const w = state.wall; if (!w) return;
    renderLogBtns();
    if (!$('wall').hidden) renderOverview();
    // 沒選取、沒在畫的時候不顯示提示；使用說明獨立在說明頁面
    const ov = state.selected && state.overlap && state.overlap.h === state.selected ? state.overlap : null;
    $('holdHint').textContent = ov && !state.draft ? t('hintOverlap', ov.i, ov.n) : '';   // 只留重疊的第幾顆（不放操作說明）
    $('holdHint').hidden = !$('holdHint').textContent;
    $('delHold').disabled = !state.selected;
    $('holdRetrace').hidden = !state.selected || state.lasso || noModel(w) || !window.HoldRefiner;
    $('holdRetrace').disabled = retracing;
    $('holdLasso').hidden = !state.lasso && !!(holdView && holdView.lassoed);   // 圈完、還沒復原：不顯示
    $('holdUndo').disabled = !undo.stack.length;
    $('draftBar').hidden = !state.draft;
    $('holdActions').hidden = !!state.draft;
    placeHoldActions();
    if (state.draft) {
      $('draftInfo').textContent = t('draftInfo', state.draft.length);
      $('draftDone').disabled = state.draft.length < 3;
    }
    const r = route();
    syncEditorUi();
    setDial(r ? r.grade : lastGrade());
    if (r) {
      setGrade($('viewGrade'), r.grade); setGrade($('vwGrade'), r.grade);
      $('vwFeet').hidden = !r.feetFree;
      if (document.activeElement !== $('routeTitle')) $('routeTitle').value = r.name || '';
    }
    const has = !!(r && Object.keys(r.holds).length);
    $('shareBtn').disabled = !has;
    const rs = sortedRoutes(), idx = rs.indexOf(r);
    $('vwCount').textContent = r && rs.length > 1 ? `${idx + 1}/${rs.length}` : '';

    $('edTitle').textContent = state.mode === 'route' && !r ? t('routes') : '';
  }
