// 定線與岩點編輯：點擊、類型、畫岩點（多邊形）。
// 依序載入（app → home → profile → add-wall → edit → wall → sync → draw → export → mobile → tour → main），共用同一個全域範圍；載入當下只能用到前面檔案宣告的東西，
// 事件處理、計時器等之後才執行的程式不受限制。啟動與事件綁定放在最後的 main.js。
// English: Route setting and hold editing: taps, hold types, drawing hold polygons.
'use strict';
  // ---------- 點擊 ----------
  // 點擊容錯（螢幕像素）：路線模式寬鬆好選；岩點模式小一點，密的牆也點得到空白處新增
  const hitTol = (rect) => (state.mode === 'holds' ? 6 : 12) * state.w / rect.width;
  // 點擊掛在外框 #stage 上：按下時外框會抓住指標（縮放／拖曳用），滑鼠的 click 事件會送到外框而不是 canvas
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
    const s = Math.min(maxScale(), view.s * 2.5), k = s / view.s;
    flyTo(s, px - (px - view.tx) * k, py - (py - view.ty) * k, () => { W3D.walk(); W3D.retrace(); });
  }
  $('stage').addEventListener('click', (ev) => {
    if (suppressClick) { suppressClick = false; return; }
    if (!state.wall) return;
    if (state.mode === 'route' && state.routeView) {   // 看路線圖：點兩下放大／復原；點一下＝收起右下的工具
      const now = ev.timeStamp;   // 事件發生的時間：主執行緒忙的時候，處理第二下時已經過了 350 毫秒也照樣算點兩下
      if (now - lastTap.t < 350 && Math.hypot(ev.clientX - lastTap.x, ev.clientY - lastTap.y) < 40) { dblZoom(ev); lastTap.t = 0; }
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
    if (hit && !state.routeView && openOverlapPick(holdsUnder(x, y))) return;
    if (hit && !state.routeView) { cycleRouteHold(hit); const r = route(); tapFx(ev.clientX, ev.clientY, (r && r.holds[hit.id]) || ''); return; }
    if (!hit && !state.routeView) {   // 定線：快速點兩下空白處，放大／復原（跟看路線一樣）
      const now = ev.timeStamp;
      if (now - lastTap.t < 350 && Math.hypot(ev.clientX - lastTap.x, ev.clientY - lastTap.y) < 40) { lastTap.t = 0; dblZoom(ev); }
      else lastTap = { t: now, x: ev.clientX, y: ev.clientY };
    }
  });
  // 定線點到重疊的岩點：放大那一塊、選好（或點候選以外取消）就回到原本的縮放和位置
  function openOverlapPick(list) {
    if (list.length < 2) return false;
    const spots = overlapSpots(list), holds = list;
    state.overlapPick = { holds, spots, back: { s: view.s, tx: view.tx, ty: view.ty } };
    const b = bbox([...holds.flatMap(h => h.poly), ...[...spots.values()].map(s => [s.x, s.y])]), st = $('stage'), k = view.bw / state.w;
    flyView(Math.min(maxScale(), st.clientWidth * 0.7 / ((b.x1 - b.x0) * k), st.clientHeight * 0.5 / ((b.y1 - b.y0) * k)), (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    buzz(4); render();
    return true;
  }
  function pickOverlap(x, y, ev) {
    const p = state.overlapPick, radius = 16 * screenPx();
    const dots = p.holds.map(h => ({ h, s: p.spots.get(h) })).map(({ h, s }) => ({ h, d: Math.hypot(x - s.x, y - s.y) })).sort((a, b) => a.d - b.d);
    const h = dots[0].d <= radius ? dots[0].h : p.holds.find(c => inPoly(x, y, c.poly));
    state.overlapPick = null;
    flyTo(p.back.s, p.back.tx, p.back.ty);
    if (!h) { render(); return; }
    cycleRouteHold(h); const r = route(); tapFx(ev.clientX, ev.clientY, (r && r.holds[h.id]) || '');
  }
  const pressBtns = (sel, on) => { for (const b of document.querySelectorAll(sel)) b.setAttribute('aria-pressed', on); };   // 定線上方和看路線圖上方各有一顆，狀態一起換
  // 路線的底切換灰階／暗彩（只在這一頁、只在畫面上看；分享的圖一律灰階）：手機按上方的圓鈕或快速點兩下（看路線圖在路線視角時、定線點空白處），電腦按空白鍵
  function toggleBase(mode = baseMode() === 'dim' ? 'gray' : 'dim') {
    bases[setting() ? 'set' : 'view'] = mode;
    baseSwap();
    pressBtns('.base-btn', mode === 'dim');
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
  // 定線長按：單點編輯（手機唯一改岩點的地方）。漏掉的岩點先給可調整的方框，再用單點提示辨識輪廓；
  // 已有的岩點＝想要這顆但範圍不滿意：先自動重算，比原本好就直接換上（可以復原），不好就留著原本的給使用者自己拖。
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
    // 以長按的位置為中心放大：照片上這一點留在指尖下（碰到照片邊緣才會偏）
    const b = bbox(hit.poly), size = Math.max(b.x1 - b.x0, b.y1 - b.y0) * view.bw / state.w;
    const s1 = Math.min(maxScale(), Math.max(2, view.s, $('stage').clientWidth / 3 / size));
    const k0 = view.bw * view.s / state.w, k1 = view.bw * s1 / state.w;
    flyTo(s1, view.tx + x * (k0 - k1), view.ty + y * (k0 - k1));
  }
  function pickHold(hit, x, y) {
    if (!hit) {
      const host = volumeAt(x, y);   // 補在 volume 上：方框、辨識結果可以蓋在這顆 volume 上
      hit = touch({ id: uid('h'), poly: fallbackHoldOutline(x, y, state.wall.holds.filter(h => h !== host)), source: 'manual' });
      holdView.host = host;
      state.wall.holds.push(hit);
      holdView.added = hit.id;
      state.selected = hit;
      touchGeom();
      save();
      resetUndo();   // 補上這顆不算一步（不要就按取消）
      refineAddedHold(hit, x, y);
    } else {
      holdView.picked = { h: hit, poly: hit.poly, source: hit.source };
      state.selected = hit; resetUndo(); retraceHeldHold(hit, x, y, true);
    }
    return hit;
  }
  // 長按後手指移到別處才放開：收回剛才那一點的補點或重算，改編輯放開的這一點（畫面不動）。
  // 換一個 holdView，還在算的舊結果就不會再套用
  function retargetHold(x, y) {
    if (!state.holdSub || !holdView || (!state.w3d && (x < 0 || y < 0 || x > state.w || y > state.h))) return;
    const w = state.wall, { added, picked, ...v } = holdView;
    w.holds = w.holds.filter(h => h.id !== added);
    if (picked) { picked.h.poly = picked.poly; picked.h.source = picked.source; }
    holdView = v;
    pickHold(pressHold(x, y), x, y);
    touchGeom(); save();
    buzz(12); refreshUi(); render();
  }
  async function refineAddedHold(h, x, y) {
    const R = window.HoldRefiner, w = state.wall, before = h.poly, session = holdView;
    const alive = () => state.wall === w && state.mode === 'holds' && state.holdSub && holdView === session && state.selected === h && w.holds.includes(h);
    const current = () => alive() && h.poly === before;
    if (state.w3d) {   // 3D 牆：等放大到這顆（岩點在畫面上夠大）再從畫面依顏色描出岩點，方框慢慢長成它（不用模型）
      await pause(450);
      if (!current()) return;
      const others = state.scene.holds.filter(o => o !== h && o !== session.host), poly = W3D.grow(x, y, others);
      if (poly && current()) morphPoly(h, despike(simplifyPoly(poly)), 500, alive, () => { touch(h); touchGeom(); save(); refreshUi(); render(); });
      return;
    }
    if (noModel(w)) return;   // 3D 牆由模型幾何處理，不下載 2D 重描模型
    // 拖頂點會原地修改陣列，因此還要比對內容，不能只看參照。
    const original = JSON.stringify(before);
    try {
      const result = await R.refine(state.img, w.id, null, (text, frac) => { if (current()) samProgress(text, frac); }, { point: [x, y] });
      $('samProg').hidden = true;
      const host = session.host, others = w.holds.filter(other => other !== h && other !== host);
      const fits = (p) => validAddedOutline(p, x, y, others) && (!host || area(p) < area(host.poly) * 0.5);   // 補在 volume 上：抓到整顆 volume 的不要
      if (!current() || JSON.stringify(before) !== original || !fits(result)) return;
      const poly = despike(simplifyPoly(result));
      if (!fits(poly)) return;
      h.poly = poly; touch(h);
      touchGeom(); save(); refreshUi(); render();
    } catch (e) {
      $('samProg').hidden = true;
      if (current()) toast(t('refineFailed') + (e.message || e));
    }
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
  // 定線時手指按住還沒到長按（按下 150 ms、沒移動）：先在背景算長按要用的那次重描（跟 retraceHeldHold、refineAddedHold 第一次的提示一樣），
  // 長按成立時拿的是同一份結果（HoldRefiner.refine 同一個提示共用一次），放大動畫做完通常已經算好。一般的點擊不到 150 ms 就放開了，不會算
  function prefetchHoldTrace(x, y, hit = pressHold(x, y)) {
    const R = window.HoldRefiner, w = state.wall;
    if (!R || !w || noModel(w) || computing(w)) return;
    (hit && !bigHold(hit) ? R.refine(state.img, w.id, hit.poly) : R.refine(state.img, w.id, null, () => {}, { point: [x, y] })).catch(() => { /* 長按成立時再算一次、報錯 */ });
  }
  // 大岩點（volume、大顆的，面積是中位數的 4 倍以上）：上面、邊上常貼著別的小岩點，長按時先看按的那一點認出什麼（見 retraceHeldHold）
  const bigHold = (h) => area(h.poly) >= medianArea() * 4;
  // 長按大岩點、按的那一點認出的是另一顆獨立的小岩點：面積不到大岩點的 1/3、不是螺絲孔那麼小一塊、不壓到別的岩點（可以蓋在這顆大岩點上）
  const smallOnBig = (p, big, x, y) => !!p && validAddedOutline(p, x, y, state.wall.holds.filter(o => o !== big))
    && area(p) < area(big.poly) / 3 && area(p) >= medianArea() * 0.15;
  // 改成補這顆小岩點：大岩點留原樣，新的這顆跟長按補點一樣（離開時加進路線），畫面移到它
  function addOnBig(big, poly) {
    holdView.picked = null; holdView.host = big;
    const h = touch({ id: uid('h'), poly, source: 'manual' });
    state.wall.holds.push(h); holdView.added = h.id; state.selected = h;
    touchGeom(); save(); resetUndo(); refreshUi(); render(); buzz(8);
    const b = bbox(poly), st = $('stage'), k = view.bw / state.w;
    flyView(Math.min(maxScale(), Math.max(view.s, st.clientWidth / 3 / (Math.max(b.x1 - b.x0, b.y1 - b.y0) * k))), (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
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
  // 長按已有的岩點：先用原本外框當提示，結果不合格再改用長按的點當提示（點提示有時只抓到螺絲孔那麼小一塊，靠面積擋掉）。
  // 合格＝輪廓有效、包住長按的點、不壓到別的岩點，面積是原本的 1/5～5 倍，而且跟原本的不一樣；換上算一步（復原鈕拿回原本的）
  // first：剛長按選到這顆（不是單點編輯中再長按）；大岩點先看按的那一點是不是另一顆小岩點，是就改成補那顆
  async function retraceHeldHold(h, x, y, first = false) {
    const R = window.HoldRefiner, w = state.wall, before = h.poly, session = holdView, original = JSON.stringify(before);
    const current = () => state.wall === w && state.mode === 'holds' && state.holdSub && holdView === session
      && state.selected === h && w.holds.includes(h) && h.poly === before && JSON.stringify(before) === original;
    const swap = (poly) => {
      h.poly = poly;
      if (h.source === 'detect') h.source = 'edited';
      touch(h); touchGeom(); save(); refreshUi(); render();
      buzz(8);
    };
    if (noModel(w)) return;   // 3D 牆保留模型幾何外框
    samProgress(t('refining'), null);   // 長按還沒成立時就開始算了（prefetchHoldTrace），通常已經算好；第一次要下載模型時進度條跟著顯示
    const others = w.holds.filter(o => o !== h), a0 = area(before), b0 = bbox(before);
    const good = (p) => {
      if (!p || !validAddedOutline(p, x, y, others)) return false;
      const k = area(p) / a0, b = bbox(p);
      const same = k > 0.95 && k < 1.05 && boxIoU([b.x0, b.y0, b.x1, b.y1], [b0.x0, b0.y0, b0.x1, b0.y1]) > 0.95;
      return k > 0.2 && k < 5 && !same;
    };
    try {
      if (first && bigHold(h)) {
        const p = await R.refine(state.img, w.id, null, (text, frac) => { if (current()) samProgress(text, frac); }, { point: [x, y] });
        $('samProg').hidden = true;
        if (!current()) { hideToast(); return; }
        const poly = p && despike(simplifyPoly(p));
        if (smallOnBig(poly, h, x, y)) { hideToast(); addOnBig(h, poly); return; }
      }
      for (const opt of [{}, { point: [x, y] }]) {
        const result = await R.refine(state.img, w.id, before, (text, frac) => { if (current()) samProgress(text, frac); }, opt);
        $('samProg').hidden = true;
        if (!current()) { hideToast(); return; }
        const poly = result && despike(simplifyPoly(result));
        if (!good(poly)) continue;
        hideToast(); swap(poly);
        return;
      }
      hideToast();   // 算出來的沒有比原本好：默默留著原本的
    } catch (e) {
      $('samProg').hidden = true;
      if (current()) toast(t('refineFailed') + (e.message || e)); else hideToast();
    }
  }
  // 單點編輯中再長按這一顆（例如手動拖過頂點之後）：用目前的外框當提示，再跑一次 MobileSAM 重描
  function retraceAgain(x, y) {
    const h = state.selected;
    if (!state.holdSub || !h) return;
    buzz(12); retraceHeldHold(h, x, y);
  }
  // 單點編輯時按在這一顆上（裡面或邊緣附近，跟長按選岩點同一個範圍）
  const onSelected = (x, y) => !!state.selected && (inPoly(x, y, state.selected.poly) || pressHold(x, y) === state.selected);   // 按在這顆裡面（就算是 volume）都是重描
  // 單點編輯：圈起來（手機）。按右下膠囊的「圈」，手指在照片上畫一圈（把整個量體圈在裡面），放開就用圈的外接框當提示交給 MobileSAM
  // 貼齊實際邊界，換掉選到的這一顆（算一步，復原拿得回來）；描偏了（跟圈的重疊不到 6 成）或抓不到就用圈本身（精簡成多邊形），
  // 之後照樣能拖頂點微調。給偵測找不到、或只描到一小塊的大量體用：長按量體補一顆，再圈起整個量體
  function setLasso(on) {
    state.lasso = !!on && state.mode === 'holds' && state.holdSub && !!state.selected;
    state.lassoPts = null;
    $('holdLasso').setAttribute('aria-pressed', String(state.lasso));
    $('holdActions').classList.toggle('lassoing', state.lasso);
    placeHoldActions();
    render();
  }
  async function finishLasso(loop) {
    const w = state.wall, h = state.selected, R = window.HoldRefiner;
    if (!w || !h || !state.holdSub || state.mode !== 'holds') return;
    const k = view.bw * view.s / state.w, closed = loop.map(p => [+p[0].toFixed(1), +p[1].toFixed(1)]);
    if (closed.length < 6 || area(closed) * k * k < 400) { toast(t('lassoSmall')); return; }   // 畫得太小，多半是手滑
    const session = holdView, before = h.poly, drawn = simplifyPoly(closed);
    const current = () => state.wall === w && state.mode === 'holds' && state.holdSub && holdView === session && state.selected === h && w.holds.includes(h) && h.poly === before;
    const ok = (p) => !!p && validAddedOutline(p, p[0][0], p[0][1], []);   // 有效、在照片裡、不自己交叉（量體上有別的岩點，所以不檢查跟它們重疊）
    let poly = null;
    if (R && !noModel(w)) {
      samProgress(t('refining'), null);
      try { poly = await R.refine(state.img, w.id, closed, (text, frac) => { if (current()) samProgress(text, frac); }, { box: lassoBox(closed, state.w, state.h) }); }
      catch (e) { poly = null; }   // 抓不到：用手畫的圈
      $('samProg').hidden = true; hideToast();
      if (!current()) return;
      poly = poly && despike(simplifyPoly(poly));
    }
    const out = ok(poly) && polyIoU(poly, drawn) >= 0.6 ? poly : ok(drawn) ? drawn : null;
    if (!out) { toast(t('lassoFail')); return; }
    h.poly = out;
    if (h.source === 'detect') h.source = 'edited';
    absorbPieces(h, session.host);
    touch(h); touchGeom(); save(); setLasso(false); refreshUi(); render(); buzz(8);
  }
  // 圈起來之後：被新外框包住 7 成以上的別顆是同一顆被切開的碎塊，併進這顆（跟換外框算同一步）。
  // 圈的是大岩點（volume）時，上面的小岩點（不到 1/3，見 smallOnBig）留著。這條路線上碎塊的類型、順序改到這顆；別的路線自帶外框，不受影響
  function absorbPieces(h, host) {
    const w = state.wall, big = bigHold(h), whole = area(h.poly), r = route();
    const pieces = w.holds.filter(o => o !== h && o !== host && inside(o.poly, h.poly) >= 0.7 && (!big || area(o.poly) >= whole / 3));
    if (!pieces.length) return;
    const ids = new Set(pieces.map(o => o.id));
    w.holds = w.holds.filter(o => !ids.has(o.id));
    if (!r) return;
    for (const id of ids) {
      if (!r.holds[id]) continue;
      if (!r.holds[h.id]) r.holds[h.id] = r.holds[id];
      delete r.holds[id]; touch(r);
    }
    if (r.seq) r.seq = r.seq.map(id => ids.has(id) ? h.id : id);
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
  function cycleRouteHold(hit) {
    const r = route() || newRoute();
    state.current = hit;
    if (state.addType === 'n') return seqTap(r, hit);
    const now = performance.now(), res = RouteKit.tapHold(r, hit.id, state.addType || 'h', { justAdded: holdTapAt.id === hit.id && now - holdTapAt.t < 400 });
    if (res === 'ignored') return;
    if (res === 'full') { setAddType('h', true); toast(t('startMax', MAX_START)); return; }   // 起攀滿了：已在路線上的不動
    if (res !== 'removed') holdTapAt = { id: hit.id, t: now };
    if (state.addType === 's' && startCount(r) >= MAX_START) setAddType('h', true);   // 起攀滿了：之後新的點是手點
    touch(r); save(); refreshUi(); render();
  }
  // 出手順序：每次點選都追加一手；短暫提供刪除最後一手的入口，避免連點與撤銷互相衝突。
  function seqTap(r, hit) {
    const added = RouteKit.appendSeq(r, hit.id), expected = [...r.seq], w = state.wall;
    touch(r); save(); refreshUi(); render();
    toast(t('seqMove', r.seq.length), { action: { label: t('remove'), run: () => {
      if (state.wall !== w || route() !== r || state.mode !== 'route' || state.routeView
        || state.addType !== 'n' || JSON.stringify(r.seq) !== JSON.stringify(expected)) return;
      RouteKit.popSeq(r, added);
      touch(r); save(); refreshUi(); render();
    } } });
  }
  function setAddType(k, anim) {
    if (state.addType === 'n' && k !== 'n') hideToast();
    const from = state.addType;
    state.addType = k;
    for (const b of document.querySelectorAll('#typeRow .type-btn')) b.setAttribute('aria-pressed', b.dataset.type === k);
    slideTypePill(from, k, anim);
  }
  // 手機類型列的色塊：像一滴顏料流到新的按鈕——前緣先衝過去、拉長壓扁，後緣再跟上回彈；到了圖示跳一下
  const typePill = $('typePill'), typeBtns = [...document.querySelectorAll('#typeRow .type-btn')], typeKeys = typeBtns.map(b => b.dataset.type);
  const pillBox = (i) => { const el = typeBtns[i]; return el && el.offsetWidth ? { left: `${el.offsetLeft}px`, width: `${el.offsetWidth}px`, x: el.offsetLeft, w: el.offsetWidth } : null; };
  function syncTypePill() {
    const i = typeKeys.indexOf(state.addType), b = pillBox(i);
    if (!b) return;
    typePill.style.left = b.left;
    typePill.style.width = b.width;
    typePill.style.color = getComputedStyle(typeBtns[i]).color;
  }
  function slideTypePill(from, k, anim) {
    const a = typeKeys.indexOf(from), b = typeKeys.indexOf(k), btn = typeBtns[b];
    if (!btn) return;
    typePill.style.setProperty('--i', b);
    typePill.style.color = getComputedStyle(btn).color;
    const fromBox = pillBox(a), toBox = pillBox(b);
    if (toBox) { typePill.style.left = toBox.left; typePill.style.width = toBox.width; }
    if (!anim || a < 0 || a === b || calm() || !fromBox || !toBox) return;
    const right = b > a, ms = 280 + 30 * Math.abs(b - a);
    const leadX = Math.min(fromBox.x, toBox.x), leadW = Math.max(fromBox.x + fromBox.w, toBox.x + toBox.w) - leadX;
    const lead = { left: `${leadX}px`, width: `${leadW}px`, transform: 'scaleY(.82)' };   // 拉長到同時蓋住兩顆
    const overW = Math.max(20, toBox.w - 4), over = { left: `${right ? toBox.x + 4 : toBox.x}px`, width: `${overW}px` };
    typePill.animate([
      { left: fromBox.left, width: fromBox.width, transform: 'scaleY(1)', easing: 'cubic-bezier(.5,0,.7,.4)' },
      { ...lead, offset: .42, easing: 'cubic-bezier(.2,.7,.3,1)' },
      { ...over, transform: 'scaleY(1.08)', offset: .78, easing: 'ease-in-out' },
      { left: toBox.left, width: toBox.width, transform: 'scaleY(1)' },
    ], { duration: ms });
    btn.querySelector('.sw-slot').animate([
      { scale: 1, rotate: '0deg' }, { scale: 1, rotate: '0deg', offset: .35 },
      { scale: 1.5, rotate: right ? '14deg' : '-14deg', offset: .6 }, { scale: .9, rotate: right ? '-6deg' : '6deg', offset: .82 }, { scale: 1, rotate: '0deg' },
    ], { duration: ms + 120, easing: 'ease-out' });
  }
  addEventListener('resize', () => { if (!$('routePanel').hidden) syncTypePill(); });
  for (const b of document.querySelectorAll('#typeRow .type-btn')) b.onclick = () => pickType(b.dataset.type);
  // 選類型；已經在順序模式又按一次「順序」：問要不要清除這條路線的順序
  async function pickType(k) {
    if (k === 'n' && state.addType === 'n') {
      const r = route();
      if (r && r.seq && await askConfirm(t('seqClearAsk'), { ok: t('seqClear'), danger: true })) { delete r.seq; hideToast(); touch(r); save(); refreshUi(); render(); }
      return;
    }
    setAddType(k, true);
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
    if (type) { delete r.holds[id]; RouteKit.dropSeq(r, id); touch(r); }
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
  let dialUser = false, dialSys = '', dialList = GRADES, GD_W = 46;
  function fillDial(sys) {
    if (dialSys === sys) return;
    const d = $('rGrade');
    dialSys = sys; dialList = GRADE_SYS[sys]; GD_W = sys === 'dan' ? 52 : 46;
    d.classList.toggle('dan', sys === 'dan');
    d.replaceChildren(...dialList.map(g => { const b = document.createElement('button'); b.className = 'gd-item'; b.textContent = g; b.onclick = () => { dialUser = true; setDial(g, true); pickGrade(g); }; return b; }));
  }
  function buildDial() {
    const d = $('rGrade');
    fillDial(gradeSys());
    let tick = -1, idle = 0;
    const touchOn = () => { dialUser = true; };
    for (const ev of ['pointerdown', 'touchstart', 'wheel']) d.addEventListener(ev, touchOn, { passive: true });
    d.addEventListener('scroll', () => {
      const i = Math.max(0, Math.min(dialList.length - 1, Math.round(d.scrollLeft / GD_W)));
      paintDial();
      if (!dialUser) return;
      if (i !== tick) { if (tick >= 0) buzz(3); tick = i; }
      const rid = state.routeId;   // 停下來時換了路線就不算
      clearTimeout(idle); idle = setTimeout(() => { tick = -1; if (state.routeId === rid) pickGrade(dialList[i]); else dialUser = false; }, 140);
    }, { passive: true });
  }
  // 照離中間的距離縮小、變淡
  function paintDial() {
    const d = $('rGrade'), c = d.scrollLeft / GD_W;
    [...d.children].forEach((b, i) => { const k = Math.min(2, Math.abs(i - c)); b.style.transform = `scale(${1 - k * 0.2})`; b.style.opacity = 1 - k * 0.35; b.classList.toggle('on', k < 0.5); });
  }
  function setDial(g, smooth = false) {
    const d = $('rGrade');
    if (d.hidden || dialUser && !smooth) return;
    fillDial(g in GRADE_RANK ? sysOf(g) : gradeSys());
    const i = dialList.indexOf(g);
    if (i < 0) return;
    if (Math.abs(d.scrollLeft - i * GD_W) > 1) d.scrollTo({ left: i * GD_W, behavior: smooth ? 'smooth' : 'instant' });
    paintDial();
  }
  function pickGrade(g) {
    dialUser = false;
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
    $('outlineBtn').hidden = !(m === 'route' && !viewing);
    $('baseBtn').hidden = !(m === 'route' && !viewing);   // 定線：灰階／暗彩切換
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
    $('edBack').hidden = editing;
    $('edCancel').hidden = !editing;
    $('edDone').hidden = !editing || m === 'holds';   // 單點編輯：完成在岩點旁的膠囊裡（#holdDone）
    $('rGrade').hidden = !(m === 'route' && !viewing);   // 定線：難度在上方
    $('viewTitle').hidden = !viewing;                     // 看路線圖：難度＋名稱（點名稱直接改）
    $('edTitle').hidden = viewing;

    if (m === 'route' && !route() && state.wall.routes.length) state.routeId = sortedRoutes()[0].id;
    if (shownBase && m === 'route' && shownBase !== baseMode()) baseSwap();   // 看路線圖↔定線：底色換了
    refreshUi(); if (!$('routePanel').hidden) syncTypePill(); refitStage(); render();
  }

  function refreshUi() {
    const w = state.wall; if (!w) return;
    renderLogBtns();
    if (!$('wall').hidden) renderOverview();
    $('edDone').disabled = state.mode === 'route' && !state.routeView && !routeReady(route());
    // 沒選取、沒在畫的時候不顯示提示；使用說明獨立在說明頁面
    const ov = state.selected && state.overlap && state.overlap.h === state.selected ? state.overlap : null;
    $('holdHint').textContent = ov && !state.draft ? t('hintOverlap', ov.i, ov.n) : '';   // 只留重疊的第幾顆（不放操作說明）
    $('holdHint').hidden = !$('holdHint').textContent;
    $('delHold').disabled = !state.selected;
    $('holdUndo').disabled = !undo.stack.length;
    $('draftBar').hidden = !state.draft;
    $('holdActions').hidden = !!state.draft;
    placeHoldActions();
    if (state.draft) {
      $('draftInfo').textContent = t('draftInfo', state.draft.length);
      $('draftDone').disabled = state.draft.length < 3;
    }
    const r = route();
    setDial(r ? r.grade : lastGrade());
    if (r) {
      setGrade($('viewGrade'), r.grade); setGrade($('vwGrade'), r.grade);
      if (document.activeElement !== $('routeTitle')) $('routeTitle').value = r.name || '';
    }
    const has = !!(r && Object.keys(r.holds).length);
    $('shareBtn').disabled = !has;
    const rs = sortedRoutes(), idx = rs.indexOf(r);
    $('viewCount').textContent = r ? `${idx + 1} / ${rs.length}` : '';
    $('vwCount').textContent = r && rs.length > 1 ? `${idx + 1}/${rs.length}` : '';

    $('prevRoute').disabled = idx <= 0; $('nextRoute').disabled = idx < 0 || idx >= rs.length - 1;
    $('edTitle').textContent = state.mode === 'route' && !r ? t('routes') : '';
  }
