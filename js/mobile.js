// 手機介面：看路線圖左右滑動、安裝到主畫面的提示。
// English: Mobile UI: swipe between route images, add-to-home-screen prompt.
'use strict';
  // ---------- 看路線圖左右滑動：照片一比一跟手，放開後以彈簧吸附 ----------
  const SWIPE_EDGE = 24, SWIPE_GAP = 12;
  const swipeCommitDistance = () => Math.min(110, stageEl.clientWidth * 0.25);
  const reducedMotion = AppKit.ui.reducedMotion;
  let swipeFrame = 0, swipeOffset = 0;
  const swipePages = new Map();
  function placeSwipe(off) {
    swipeOffset = ovShift = off;
    cv.style.transform = `translate(${view.tx + off}px, ${view.ty}px) scale(${view.s})`;
    ovCv.style.transform = off ? `translateX(${off}px)` : '';
    if (state.w3d) state.w3d.shift(off);
    for (const [d, page] of swipePages) page.style.transform = `translateX(${off + d * (stageEl.clientWidth + SWIPE_GAP)}px)`;
  }
  function resetRouteSwipe() {
    cancelAnimationFrame(swipeFrame); swipeFrame = 0;
    for (const page of swipePages.values()) page.remove();
    swipePages.clear(); placeSwipe(0); hideSwipeHint(); resetPullDown();
    if (gesture?.swipe) { delete gesture.swipe; gesture.moved = true; }
  }
  // 每個方向只畫一次，拖曳和吸附每格只改 transform，不重算岩點或複製整張照片。
  function prepareSwipePage(d) {
    const r = neighborRoute(d), rl = r ? null : relayOf(d);
    if ((!r && !rl) || swipePages.has(d)) return;
    const page = document.createElement('canvas'), dpr = devicePixelRatio || 1, W = stageEl.clientWidth, H = stageEl.clientHeight;
    page.className = 'swipe-page'; page.setAttribute('aria-hidden', 'true');
    page.width = Math.round(W * dpr); page.height = Math.round(H * dpr);
    page.style.width = `${W}px`; page.style.height = `${H}px`;
    const g = page.getContext('2d');
    if (rl) {   // 同一面牆的下一張照片：先放它的縮圖（填滿），放開才打開那張
      const im = rl.img, iw = im.naturalWidth, ih = im.naturalHeight, k = iw ? Math.max(W / iw, H / ih) : 0;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (k) g.drawImage(im, (W - iw * k) / 2, (H - ih * k) / 2, iw * k, ih * k);
    } else {
      const f = routeFit(r), k = view.bw * f.s / state.w;   // 下一條用它自己的路線視角，換頁後直接就位
      g.setTransform(dpr * k, 0, 0, dpr * k, dpr * f.tx, dpr * f.ty);
      RouteKit.drawRoute(g, state.scene, r, holdsOf(r), { unit: labelUnit(r), mode: baseMode(), tint: baseMode() !== 'dim', hands: true, tape: baseMode() !== 'dim', glow: baseMode() === 'dim' ? { roles: r.holds, colors: RouteKit.THEME.colors, dpr, outline: false } : undefined });
    }
    swipePages.set(d, page); stageEl.append(page);
  }
  function settleRouteSwipe(d, velocity) {
    cancelAnimationFrame(swipeFrame);
    const target = -d * (stageEl.clientWidth + SWIPE_GAP), wall = state.wall, rid = state.routeId;
    let x = swipeOffset, v = Math.max(-3000, Math.min(3000, velocity * 1000)), previous = performance.now();
    const finish = () => {
      resetRouteSwipe();
      if (d && relayOf(d)) { openRelay(d); return; }   // 接到同一面牆的下一張照片
      if (d) { stepRoute(d, { paged: true }); draw(ctx); cancelAnimationFrame(raf); }   // 已經同步畫好，不再讓 render 排的那次重畫
    };   // 已經同步畫好，不再讓 render 排的那次重畫
    if (reducedMotion()) { finish(); return; }
    const frame = now => {
      if (state.wall !== wall || state.routeId !== rid || state.mode !== 'route' || !state.routeView || $('editor').hidden) { resetRouteSwipe(); return; }
      // 臨界阻尼彈簧的解析解，掉幀時也不會數值爆開；保留放手瞬間的速度。
      const dt = Math.min((now - previous) / 1000, 0.064), omega = 22, delta = x - target, b = v + omega * delta, decay = Math.exp(-omega * dt);
      x = target + (delta + b * dt) * decay;
      v = (v - omega * b * dt) * decay; previous = now;
      placeSwipe(x);
      if (Math.abs(x - target) < 0.5 && Math.abs(v) < 8) finish();
      else swipeFrame = requestAnimationFrame(frame);
    };
    swipeFrame = requestAnimationFrame(frame);
  }
  // 下一條的難度（有名稱就加在下面）從要進來的那一邊跟著手指滑進來，不用箭頭；拖到放開就會切換時變螢光綠
  function showSwipeHint(d) {
    const r = neighborRoute(d) || (relayOf(d) || {}).r, hint = $('swipeHint');
    if (!r) return;
    hint.replaceChildren(Object.assign(document.createElement('b'), { textContent: r.grade }));
    if (r.name) hint.append(Object.assign(document.createElement('span'), { textContent: r.name }));
    hint.className = `swipe-hint ${d > 0 ? 'next' : 'prev'}`;
    hint.style.setProperty('--p', 0);
    hint.hidden = false;
  }
  // 看路線圖往下拉：整個畫面跟著手往下、變淡，拉夠遠（或快速往下撥）放開就回牆面頁，不夠就彈回去
  const PULL_DISTANCE = 110, PULL_FLICK = 0.6;
  function pullDown(dy) {
    const y = Math.max(0, dy) * 0.7;
    stageEl.style.transition = 'none'; stageEl.style.translate = `0 ${y}px`; stageEl.style.opacity = String(1 - Math.min(0.5, y / 400));
  }
  function resetPullDown() {
    if (!stageEl.style.translate && !stageEl.style.opacity) return;
    stageEl.style.transition = 'translate .2s ease-out, opacity .2s ease-out'; stageEl.style.translate = ''; stageEl.style.opacity = '';
    setTimeout(() => { stageEl.style.transition = ''; }, 220);
  }
  function hideSwipeHint() { $('swipeHint').hidden = true; $('swipeHint').classList.remove('armed'); }

  // 放大鏡：在手指上方（太靠上就放下方）畫手指下面那一小塊，比畫面再放大 2.5 倍（畫面已經放很大時最多到照片 1 px＝3 個螢幕點，
  // 但至少比畫面大 1.5 倍）；選到的岩點外框和十字標出頂點
  const LOUPE = 120;
  let loupeBelow = false;
  // poly：要描出來的外框（選到的岩點）
  function showLoupe(cx, cy, x, y, poly, k) {
    const el = $('loupe'), dpr = devicePixelRatio || 1, n = Math.round(LOUPE * dpr);
    if (el.width !== n) { el.width = el.height = n; }
    // 放在手指上方，太靠上才換到下方；換邊要多過 40px，手指在交界附近移動時不會上下跳
    const up = cy - LOUPE - 60;
    if (el.hidden) loupeBelow = up < 8; else if (loupeBelow ? up >= 48 : up < 8) loupeBelow = !loupeBelow;
    el.hidden = false;
    el.style.left = `${Math.min(innerWidth - LOUPE - 8, Math.max(8, cx - LOUPE / 2))}px`;
    el.style.top = `${loupeBelow ? cy + 60 : up}px`;
    const g = el.getContext('2d'), z = Math.max(k * 1.5, Math.min(k * 2.5, 3)) * dpr;   // 照片 1 px 在放大鏡裡幾個裝置像素
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#000'; g.fillRect(0, 0, n, n);
    g.setTransform(z, 0, 0, z, n / 2 - x * z, n / 2 - y * z);
    g.drawImage(state.img, 0, 0);
    g.lineJoin = 'round';
    g.beginPath(); poly.forEach(([px, py], i) => i ? g.lineTo(px, py) : g.moveTo(px, py)); g.closePath();
    g.lineWidth = 2.5 * dpr / z; g.strokeStyle = 'rgba(0,0,0,.5)'; g.stroke();
    g.lineWidth = 1.5 * dpr / z; g.strokeStyle = '#facc15'; g.stroke();
    g.setTransform(1, 0, 0, 1, 0, 0);
    const c = n / 2, r = 9 * dpr;
    g.lineWidth = 1.5 * dpr; g.strokeStyle = '#fff';
    g.beginPath(); g.moveTo(c - r, c); g.lineTo(c + r, c); g.moveTo(c, c - r); g.lineTo(c, c + r); g.stroke();
  }

  const stageEl = $('stage');
  const pts = new Map();   // pointerId → {x, y}
  let gesture = null;      // { mode: 'pan'|'pinch', ... }
  let holdLoupeFrame = 0;
  function followHoldLoupe(g) {
    if (gesture !== g || state.mode !== 'holds' || !state.holdSub) { $('loupe').hidden = true; return; }
    const r = cv.getBoundingClientRect(), k = r.width / state.w;
    // 手指移開後放大鏡改看手指下面（放開時改編輯那一點），外框跟著換成那裡的岩點
    if (g.aim) { g.x = (g.cx - r.left) / k; g.y = (g.cy - r.top) / k; }
    const under = g.aim ? pressHold(g.x, g.y) : state.selected;   // 長按在沒有岩點的地方：放大鏡只看位置
    showLoupe(g.cx, g.cy, g.x, g.y, under ? under.poly : [], k);
    holdLoupeFrame = requestAnimationFrame(() => followHoldLoupe(g));
  }
  const local = (e) => { const r = stageEl.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  stageEl.addEventListener('pointerdown', (e) => {
    // 第一根手指（isPrimary）按下時其他手指都已離開：上一輪沒收到放開（系統長按選單吃掉）就清掉，不然手勢一直卡在長按、拖不動也縮放不了
    if (e.isPrimary && pts.size) {
      pts.clear(); gesture = null;
      cancelAnimationFrame(holdLoupeFrame); $('loupe').hidden = true;
      if (state.lassoPts) { state.lassoPts = null; render(); }
    }
    if (gesture &&(gesture.mode === 'vertex' || gesture.mode === 'hold' || gesture.mode === 'lasso')) return;   // 單點操作時忽略第二根手指
    if (state.lasso && state.mode === 'holds' && state.holdSub && pts.size === 0) {   // 圈起來：一根手指畫一圈，不拖照片、不拖頂點
      pts.set(e.pointerId, local(e));
      try { stageEl.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件沒有真的指標 */ }
      const r = cv.getBoundingClientRect(), k = r.width / state.w, clamp = (v, m) => Math.min(m, Math.max(0, v));
      const at = (ev) => [clamp((ev.clientX - r.left) / k, state.w), clamp((ev.clientY - r.top) / k, state.h)];
      gesture = { mode: 'lasso', id: e.pointerId, moved: true, loop: [at(e)], at, last: [e.clientX, e.clientY] };
      state.lassoPts = gesture.loop; suppressClick = true; render();
      return;
    }
    const hh = pts.size === 0 ? hitHandle(e.clientX, e.clientY) : null;
    pts.set(e.pointerId, local(e));
    try { stageEl.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件沒有真的指標 */ }
    if (hh) {
      // 真的拖動了才算改形狀；只是點一下（小岩點點中央常會碰到頂點）照一般點擊處理，重疊時才換得到下一顆
      gesture = { mode: 'vertex', id: e.pointerId, hold: state.selected, hh, i: hh.i, moved: false, x0: e.clientX, y0: e.clientY };
      suppressClick = false;
      return;
    }
    if (pts.size === 1) {
      suppressClick = false;
      const p = local(e);
      if (state.w3d && state.mode === 'route' && e.pointerType === 'mouse' && (e.button === 2 || (e.button === 0 && (e.shiftKey || e.altKey)))) {   // 3D 牆：滑鼠左鍵拖曳跟手機單指一樣沿著牆走；右鍵、Shift／Alt＋左鍵左右拖是調角度（跟兩指同向左右移一樣；舊資料包是偷看、放手彈回）
        gesture = { mode: 'turn3d', id: e.pointerId, sx: p.x, sy: p.y, lx: p.x, ly: p.y, moved: false };
      } else gesture = { mode: 'pan', sx: p.x, sy: p.y, tx: view.tx, ty: view.ty, moved: false };
      const canPress = e.pointerType !== 'mouse' || (e.button === 0 && !e.shiftKey && !e.altKey);
      // 定線長按：觸控或滑鼠左鍵按住就進單點編輯（見 enterHoldEdit）；拖曳後不啟動，修飾鍵與右鍵留給移動照片、旋轉模型。
      if (state.mode === 'route' && !state.routeView && canPress) {
        const g0 = gesture, cx = e.clientX, cy = e.clientY;
        const still = () => gesture === g0 && !g0.moved && pts.size === 1 && state.wall && state.mode === 'route' && !state.routeView;
        const at = () => { const rect = cv.getBoundingClientRect(); return { x: (cx - rect.left) * (state.w / rect.width), y: (cy - rect.top) * (state.h / rect.height) }; };
        const inside = ({ x, y }) => !!state.w3d || (x >= 0 && y >= 0 && x <= state.w && y <= state.h);   // 照片外面不算（3D 牆轉角度後畫面會超出正面快照，照射線判斷）
        setTimeout(() => {
          if (!still()) return;
          const { x, y } = at();
          if (!inside({ x, y })) return;
          g0.moved = true; suppressClick = true;   // 放開時不算點擊
          if (holdLocked()) return;   // 背景還在描外框：還不能改岩點
          const pressed = pressHold(x, y);
          if (pressed && state.addType === 'n' && route() && route().seq && route().seq.includes(pressed.id)) { seqHoldAsk(pressed); return; }   // 順序模式長按有編號的岩點：選插入位置
          const g = gesture = { mode: 'hold', id: e.pointerId, sx: cx, sy: cy, cx, cy, x, y, moved: true };
          enterHoldEdit(pressed, x, y);
          followHoldLoupe(g);
        }, 500);
      }
      // 看路線圖、沒比路線視角放大時可以左右滑；螢幕左右邊緣起滑的留給系統的返回手勢
      if (state.mode === 'route' && state.routeView && !routeZoomed() && e.clientX > SWIPE_EDGE && e.clientX < innerWidth - SWIPE_EDGE) {
        const caught = !!swipeFrame;
        cancelAnimationFrame(swipeFrame); swipeFrame = 0;
        gesture.sx -= swipeOffset;
        gesture.moved = caught;
        gesture.swipe = { lock: caught ? 'h' : null, d: 0, dx: swipeOffset, armed: false, samples: [{ x: e.clientX, t: e.timeStamp }] };
        reveal = null; tagIn = 0;
        stageEl.classList.remove('slide-next', 'slide-prev');
        if (caught) suppressClick = true;
      }
    } else if (pts.size === 2) {
      if (gesture && gesture.swipe) resetRouteSwipe();   // 第二根手指：改成縮放，取消左右滑
      const [a, b] = [...pts.values()];
      gesture = { mode: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, ang: Math.atan2(b.y - a.y, b.x - a.x), moved: true };
      Object.assign(gesture, { d0: gesture.d, mx0: gesture.mx, my0: gesture.my, ang0: gesture.ang, kind: state.w3d && state.mode === 'route' ? '' : 'zoom' });   // 改岩點時不轉角度（外框是這個角度的）
    }
  });
  let pinchFrame = 0;
  function applyPinch() {
    pinchFrame = 0;
    if (!gesture || gesture.mode !== 'pinch' || pts.size < 2) return;
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, ang = Math.atan2(b.y - a.y, b.x - a.x);
      const twist = (x) => (x > Math.PI ? x - 2 * Math.PI : x < -Math.PI ? x + 2 * Math.PI : x);
      // 3D 牆：兩指先分辨調角度或其他（中點移動平移、捏合縮放，跟 2D 一樣）；一次手勢只做一種，走近和轉身不互相拉扯。
      // 沿牆鏡頭：兩指同向左右移（中點橫移、兩指距離幾乎不變）＝調角度（stage.angle，放手保留）；舊資料包：扭轉＝偷看（放手彈回）
      const along = state.w3d && state.w3d.along, zoomed = Math.abs(Math.log(d / gesture.d0)) > 0.06, mdx = mx - gesture.mx0, mdy = my - gesture.my0;
      if (!gesture.kind) gesture.kind = along ? (!zoomed && Math.abs(mdx) > 14 && Math.abs(mdx) > Math.abs(mdy) * 1.5 ? 'angle' : zoomed || Math.hypot(mdx, mdy) > 14 ? 'zoom' : '')
        : Math.abs(twist(ang - gesture.ang0)) > 0.15 && d > 40 ? 'turn' : zoomed || Math.hypot(mdx, mdy) > 14 ? 'zoom' : '';
      if (gesture.kind !== 'zoom') {
        if (gesture.kind === 'angle') { state.w3d.angle(mx - gesture.mx); W3D.walk(); }
        if (gesture.kind === 'turn') { state.w3d.turn(twist(ang - gesture.ang) * Math.max(240, $('stage').clientHeight) / Math.PI, 0); W3D.follow(); }   // 扭轉的角度直接是轉的角度（turn 每像素轉 π／畫面高）
        gesture.mx = mx; gesture.my = my; gesture.d = d; gesture.ang = ang;
        return;
      }
      if (state.w3d && state.w3d.wc) state.w3d.wc.coarse = true;   // 捏合中範圍用粗刻度算，放手後回細的（walkcam.js 的 COARSE_D）
      if (gesture.d > 0) zoomAt(view.s * d / gesture.d, mx, my);
      setView(view.s, view.tx + mx - gesture.mx, view.ty + my - gesture.my);
      W3D.walk();   // 3D 牆：鏡頭跟著往那裡走
      gesture.d = d; gesture.mx = mx; gesture.my = my; gesture.ang = ang;
  }
  stageEl.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || !gesture) return;
    pts.set(e.pointerId, local(e));
    if (gesture.mode === 'lasso') {
      if (e.pointerId !== gesture.id || Math.hypot(e.clientX - gesture.last[0], e.clientY - gesture.last[1]) < 3) return;   // 每隔 3 個螢幕像素記一點
      gesture.last = [e.clientX, e.clientY]; gesture.loop.push(gesture.at(e)); render();
      return;
    }
    if (gesture.mode === 'hold') {
      gesture.cx = e.clientX; gesture.cy = e.clientY;
      if (Math.hypot(e.clientX - gesture.sx, e.clientY - gesture.sy) > 8) gesture.aim = true;
      return;
    }
    if (gesture.mode === 'vertex') {
      if (e.pointerId !== gesture.id) return;
      if (!gesture.moved) {
        if (Math.hypot(e.clientX - gesture.x0, e.clientY - gesture.y0) < 4) return;
        gesture.moved = true;
        const hh = gesture.hh, h = gesture.hold;
        if (hh.kind === 'm') { gesture.i = hh.i + 1; h.poly.splice(gesture.i, 0, [hh.x, hh.y]); }   // 拖邊中點：插入新頂點
        else if (hh.idx.length > 1) { const m = mergeHandle(h.poly, hh.idx, [hh.x, hh.y]); h.poly = m.poly; gesture.i = m.i; }   // 擠在一起的頂點：合成一個再拖
      }
      const rect = cv.getBoundingClientRect(), k = rect.width / state.w;
      const x = Math.min(state.w, Math.max(0, (e.clientX - rect.left) / k)), y = Math.min(state.h, Math.max(0, (e.clientY - rect.top) / k));
      gesture.hold.poly[gesture.i] = [+x.toFixed(1), +y.toFixed(1)];
      touchGeom(); render();
      showLoupe(e.clientX, e.clientY, x, y, gesture.hold.poly, k);
      return;
    }
    if (gesture.mode === 'turn3d') {
      if (e.pointerId !== gesture.id) return;
      const p = pts.get(e.pointerId), dx = p.x - gesture.lx, dy = p.y - gesture.ly;
      if (!gesture.moved && Math.hypot(p.x - gesture.sx, p.y - gesture.sy) < 5) return;
      gesture.moved = true; gesture.lx = p.x; gesture.ly = p.y;
      if (state.w3d.along) { state.w3d.angle(dx); W3D.walk(); } else { state.w3d.turn(dx, dy); W3D.follow(); }
      return;
    }
    if (gesture.mode === 'pinch') {
      if (pts.size >= 2 && !pinchFrame) pinchFrame = requestAnimationFrame(applyPinch);   // 兩指的 pointermove 是一指一個事件：用到一半的位置判斷會把平移誤判成縮放，所以每畫面只算一次，用兩指最新的位置
    } else if (gesture.mode === 'pan' && gesture.swipe) {
      const p = pts.get(e.pointerId), dx = p.x - gesture.sx, dy = p.y - gesture.sy, sw = gesture.swipe;
      // 直向拖曳沒有作用，所以不鎖死直向：起手偏直、斜著滑，橫向夠了照樣換線
      if (!sw.lock) {
        if (Math.hypot(dx, dy) > 8) gesture.moved = true;
        if (dy > 12 && dy > Math.abs(dx) * 1.5) { sw.lock = 'v'; sw.t0 = e.timeStamp; sw.y0 = dy; gesture.moved = true; }   // 明顯往下：下拉回牆面頁
      }
      if (sw.lock === 'v') { sw.dy = dy; pullDown(dy); return; }
      if (!sw.lock) {
        if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy)) return;
        sw.lock = 'h'; gesture.moved = true;
      }
      sw.dx = dx;
      sw.samples.push({ x: e.clientX, t: e.timeStamp });
      while (sw.samples.length > 2 && e.timeStamp - sw.samples[0].t > 100) sw.samples.shift();
      const d = dx < 0 ? 1 : -1, can = !!neighborRoute(d) || !!relayOf(d);
      if (d !== sw.d) { sw.d = d; if (can) { prepareSwipePage(d); showSwipeHint(d); } else hideSwipeHint(); }
      // 有相鄰路線時一比一跟手；首尾使用漸進阻力，拉越遠越難拉。
      const width = stageEl.clientWidth, distance = Math.min(Math.abs(dx), width + SWIPE_GAP);
      placeSwipe(can ? Math.sign(dx) * distance : dx * 0.32 / (1 + Math.abs(dx) / (width * 0.55)));
      $('swipeHint').style.setProperty('--p', can ? Math.min(1, Math.abs(dx) / swipeCommitDistance()).toFixed(3) : 0);
      const armed = can && Math.abs(dx) >= swipeCommitDistance();
      if (armed !== sw.armed) $('swipeHint').classList.toggle('armed', (sw.armed = armed));
    } else if (gesture.mode === 'pan') {
      const p = pts.get(e.pointerId), dx = p.x - gesture.sx, dy = p.y - gesture.sy;
      if (!gesture.moved && Math.hypot(dx, dy) > 8) gesture.moved = true;
      // 照片比框大才拖得動（通常是放大時；框剛變小還沒重排時也能拖）
      // 3D 牆：每一格照這一格的位移拖、鏡頭跟著往畫面中央那一點走（走近後快照的範圍變小，照起點算會拖不動）
      if (state.w3d && state.mode === 'route') {
        if (gesture.moved) { setView(view.s, view.tx + p.x - (gesture.lx ?? gesture.sx), view.ty + p.y - (gesture.ly ?? gesture.sy)); W3D.walk([p.x, p.y]); gesture.lx = p.x; gesture.ly = p.y; }
        return;
      }
      const st = stageEl.getBoundingClientRect(), [pt, pb] = editPads(), over = view.bw * view.s > st.width + 1 || view.bh * view.s + pt + pb > st.height + 1;
      if (gesture.moved && over) setView(view.s, gesture.tx + dx, gesture.ty + dy);
    }
  });
  // 電腦版 Esc：取消圈起來（畫到一半先丟掉這一圈；沒在畫就離開圈起來）
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || state.mode !== 'holds' || !state.holdSub || !state.lasso || document.querySelector('.ak-dialog')) return;
    e.preventDefault();
    if (gesture && gesture.mode === 'lasso') { pts.clear(); gesture = null; state.lassoPts = null; render(); return; }
    cancelLasso();
  });
  const endPointer = (e) => {
    if (!pts.has(e.pointerId)) return;
    if (pinchFrame) { cancelAnimationFrame(pinchFrame); applyPinch(); }
    if (pts.size === 1) W3D.endZoom();   // 最後一指放開：範圍換回精確值（放手這一刻算，不等下一次拖動）
    const last = pts.get(e.pointerId);
    pts.delete(e.pointerId);
    if (gesture && gesture.mode === 'lasso' && e.pointerId === gesture.id) {
      const loop = gesture.loop; state.lassoPts = null; render();
      if (e.type === 'pointerup') finishLasso(loop);
    }
    if (gesture && gesture.mode === 'hold' && e.pointerId === gesture.id) {
      cancelAnimationFrame(holdLoupeFrame); $('loupe').hidden = true;
      if (gesture.aim && e.type === 'pointerup') { const r = cv.getBoundingClientRect(), k = r.width / state.w; retargetHold((e.clientX - r.left) / k, (e.clientY - r.top) / k); }
    }
    if (gesture && gesture.mode === 'pan' && gesture.swipe && gesture.swipe.lock === 'v') {
      const sw = gesture.swipe, dy = sw.dy || 0, v = (dy - sw.y0) / Math.max(1, e.timeStamp - sw.t0);
      if (e.type === 'pointerup' && pts.size === 0 && (dy >= PULL_DISTANCE || (dy >= 50 && v >= PULL_FLICK))) { resetPullDown(); history.back(); }
      else resetPullDown();
    }
    if (gesture && gesture.mode === 'pan' && gesture.swipe && gesture.swipe.lock === 'h') {
      // 放開：拖得夠遠，或快速往同方向撥（至少 30px、0.5 px/ms）就切換；最後往反方向撥回就不切換
      const sw = gesture.swipe;
      sw.samples.push({ x: e.clientX, t: e.timeStamp });
      const recent = sw.samples.filter(s => e.timeStamp - s.t <= 100);
      const end = recent[recent.length - 1];
      let first = end, motion = 0;
      for (let i = recent.length - 2; i >= 0; i--) {
        const delta = recent[i + 1].x - recent[i].x;
        if (delta && motion && Math.sign(delta) !== motion) break;
        if (delta) motion = Math.sign(delta);
        first = recent[i];
      }
      const v = first && end !== first ? (end.x - first.x) / Math.max(1, e.timeStamp - first.t) : 0;
      const dir = sw.dx < 0 ? 1 : -1;
      const reversed = Math.sign(v) === -Math.sign(sw.dx) && Math.abs(v) >= 0.15;
      const commit = e.type === 'pointerup' && pts.size === 0 && dir === sw.d && (!!neighborRoute(dir) || !!relayOf(dir)) && !reversed
        && (Math.abs(sw.dx) >= swipeCommitDistance() || (Math.abs(sw.dx) >= 30 && Math.sign(v) === Math.sign(sw.dx) && Math.abs(v) >= 0.5));
      hideSwipeHint();
      settleRouteSwipe(commit ? dir : 0, e.type === 'pointerup' ? v : 0);
    }
    if (gesture && gesture.mode === 'vertex' && e.pointerId === gesture.id) $('loupe').hidden = true;
    if (gesture && gesture.mode === 'vertex' && e.pointerId === gesture.id && gesture.moved) {
      const h = gesture.hold;
      h.poly = despike(h.poly, gesture.i);   // 拖完把細尖剪掉（剛拖的這個頂點不動）
      if (h.source === 'detect') h.source = 'edited';   // 改過形狀的偵測岩點，重新偵測時保留
      touch(h);
      touchGeom(); save(); render();
    }
    if (gesture && gesture.moved) suppressClick = true;   // 拖曳、縮放或拖頂點後放開，不算點擊
    // 3D 牆：轉角度、縮放、拖曳放開了，整面牆的岩點外框照新的鏡頭重投（途中只重投路線上的）
    // 偷看（扭轉、滑鼠拖）放手：彈回正對牆面的位置
    if (gesture && !pts.size && (gesture.kind === 'turn' || (gesture.mode === 'turn3d' && gesture.moved && !state.w3d.along))) W3D.settle();
    else if (gesture && !pts.size && gesture.mode === 'turn3d' && gesture.moved) W3D.retrace();
    else if (gesture && (gesture.mode === 'pinch' || (gesture.mode === 'pan' && gesture.moved && !gesture.swipe)) && !pts.size) { if (state.w3d && state.w3d.over) W3D.settle(); else W3D.retrace(); }   // 拖過盡頭放手：鏡頭彈回（settle 完會重投）
    if (pts.size === 1 && gesture && gesture.mode === 'pinch') {
      if (gesture.kind === 'turn') W3D.settle();   // 扭轉放開一指就算偷看結束
      const p = [...pts.values()][0];   // 剩一指：接著平移
      gesture = { mode: 'pan', sx: p.x, sy: p.y, tx: view.tx, ty: view.ty, moved: true };
    } else if (pts.size === 0) gesture = null;
  };
  stageEl.addEventListener('pointerup', endPointer);
  // 定線、改岩點都用長按：擋掉系統選單（長按成立時已切到岩點頁，只看定線會漏掉）
  stageEl.addEventListener('contextmenu', (e) => { if (!state.routeView || state.w3d) e.preventDefault(); });
  stageEl.addEventListener('pointercancel', endPointer);
  let wheelTimer = 0;
  stageEl.addEventListener('wheel', (e) => {
    const w3dRoute = state.w3d && state.mode === 'route';
    const mouseWheel = matchMedia('(any-hover: hover) and (any-pointer: fine)').matches && !e.shiftKey && Math.abs(e.deltaY) >= Math.abs(e.deltaX);
    const zoom = e.ctrlKey || e.metaKey || mouseWheel || (w3dRoute && !e.shiftKey && Math.abs(e.deltaY) >= Math.abs(e.deltaX));
    if (!zoom && view.s === 1 && !w3dRoute) return;   // 沒放大時一般滾輪照常捲頁面
    e.preventDefault();
    const p = local(e);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? stageEl.clientHeight : 1;
    if (zoom) zoomAt(view.s * Math.exp(-e.deltaY * unit * (e.ctrlKey || e.metaKey ? 0.01 : 0.0025)), p.x, p.y);
    else setView(view.s, view.tx - e.deltaX, view.ty - e.deltaY);
    if (w3dRoute) {
      if (zoom && state.w3d.wc) state.w3d.wc.coarse = true;   // 縮放途中範圍用粗刻度（見 walkcam.js 的 COARSE_D）
      W3D.walk();
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => { W3D.endZoom(); W3D.retrace(); }, 140);
    }
  }, { passive: false });
  // iOS Safari 的手勢事件：擋掉整頁縮放
  for (const t of ['gesturestart', 'gesturechange']) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
  const STEPS = RouteKit.ZOOM_STEPS;   // 縮放鈕的檔位（kit 的同一份）
  const center = () => [stageEl.clientWidth / 2, stageEl.clientHeight / 2];
  $('zoomIn').onclick = () => zoomAt(STEPS.find(z => z > view.s + 0.01) || maxScale(), ...center());
  $('zoomOut').onclick = () => zoomAt([...STEPS].reverse().find(z => z < view.s - 0.01) || zoomFloor(), ...center());
  // 照片框大小變了就重排（保留縮放）：視窗大小、手機網址列收合，還有切換岩點頁／路線頁時下方面板高度不同。
  // 照片框大小變了就重排（例如打開岩點頁時面板變高），不然 100% 的照片下緣會超出框又拖不動
  const relayout = () => {
    const st = $('stage');
    if ($('editor').hidden || (st.clientWidth === view.layoutW && st.clientHeight === view.layoutH)) return;
    layoutStage();
  };
  if ('ResizeObserver' in window) new ResizeObserver(relayout).observe($('stage'));
  window.addEventListener('resize', relayout);
  // 平板轉向：首頁和牆面頁的欄數會變，瀏覽器只保留捲動距離，畫面會跳到別張卡片。捲動停下時記住頂端那張卡片（一半以上在標題列下面的第一張），
  // 寬度變了就捲回讓它停在同一個高度（在最上面時不記，照樣停在最上面）。鍵盤彈出只變高度，不動
  let scrollAnchor = null, anchorTimer = 0, anchorW = innerWidth;
  const listCards = () => !$('home').hidden ? $('wallList').querySelectorAll('.wall-card') : !$('wall').hidden ? $('routeList').querySelectorAll('.route-card') : [];
  addEventListener('scroll', () => {
    clearTimeout(anchorTimer);
    anchorTimer = setTimeout(() => {
      const el = scrollY > 0 && [...listCards()].find(c => { const r = c.getBoundingClientRect(); return r.top + r.height / 2 > 80; });
      scrollAnchor = el ? { el, top: el.getBoundingClientRect().top } : null;
    }, 150);
  }, { passive: true });
  window.addEventListener('resize', () => {
    if (innerWidth === anchorW) return;
    anchorW = innerWidth; clearTimeout(anchorTimer);
    const a = scrollAnchor;
    if (a && a.el.isConnected && [...listCards()].includes(a.el)) scrollBy(0, a.el.getBoundingClientRect().top - a.top);
  });

  // ---------- 加到主畫面：建議，不是門檻（手機瀏覽器就是完整的 App）----------
  // 還沒裝的時候，第一次出完一條新路線之後，首頁下方出現「加到主畫面」（instBar），按了直接裝：Android 的 Chrome 跳原生安裝，
  // iPhone 跳一行步驟（分享 → 加入主畫面 → 右上角「新增」），其他瀏覽器說 ⋮ 的位置；內建瀏覽器才打開安裝說明（請用 Safari／Chrome）。按 × 之後這台不再出現。
  // 平台、Android 的安裝事件、裝過／按掉了（記在這台：climbio.installed、climbio.installDismissedAt）都在 AppKit.install
  const MADE_KEY = 'climbio.madeRoute';   // 這台出過一條新路線（js/wall.js 的 routeMade）
  const inst = AppKit.install.track({
    dismissedKey: 'climbio.installDismissedAt', installedKey: 'climbio.installed', onChange: () => renderInstall(),
    // 重新安裝（Android 刪除主畫面 App 不會清除資料；iPhone 會）：一次性情境提示重新開始。收到的牆保留（點朋友的連結、再裝 App 要看得到）
    // 裝好了，請從主畫面打開
    onInstalled: () => { $('ldDone').hidden = false; $('ldInstall').hidden = true; },
  });
  const { ios: isIos, android: isAndroid, inApp } = inst;
  let openHref = '';   // 點朋友的連結進來時的網址（js/main.js 記下來）
  // 在 Messenger、IG 等 App 的內建瀏覽器點開分享連結：收下的線會存在那個瀏覽器裡，不會進自己的 Climbio。
  // Android 交給系統（裝了 App 就開 App，不然是預設瀏覽器）；iPhone 沒辦法自動跳，先提示改用 Safari 開啟。兩種都照常在這裡收線
  function leaveInApp(href) {
    if (!inApp) return Promise.resolve();
    // 頁面載完才交給系統：載入途中換頁會打斷 load（收線比首頁更早開始，這裡可能在載入中被呼叫）
    if (isAndroid) return new Promise((res) => { const go = () => { location.href = inst.intentUrl(href); res(); }; if (document.readyState === 'complete') go(); else addEventListener('load', go, { once: true }); });
    return isIos ? showAlert(t('inAppRecvIos')) : Promise.resolve();
  }
  const PCLAND = document.documentElement.classList.contains('pcland');   // 電腦：只有介紹頁＋連結卡（index.html 開頭判斷）
  // index.html 開頭先藏起首頁、亮出介紹頁（lite-boot）；這裡接手，之後由 showLanding／hideLanding 管
  if (PCLAND) { $('home').hidden = true; $('landing').hidden = false; document.body.classList.add('ld-open'); }
  document.documentElement.classList.remove('lite-boot');
  // 安裝說明：蓋在首頁上面，左上 × 關掉
  async function showLanding() {
    if (PCLAND) {
      $('landing').hidden = false; document.body.classList.add('ld-open'); landingShot(); pcLink();
      return;
    }
    $('landing').hidden = false; $('landing').classList.add('over'); document.body.classList.add('ld-open');
    openOverlay('landing', hideLanding);
    renderInstall(); landingShot();
  }
  // 僅用舊示範牆的資料播放介紹動畫，不建立或匯入示範牆。
  // 示範畫面：示範牆「螢光紅」裁到路線附近，灰階的底，路線岩點照順序一顆顆亮起，最後貼上膠帶短句；停一下再重來
  let shotRun = 0;
  // 主標、副標三組（想定線的岩友、岩點貓、找岩友挑戰）輪播：示範畫面每從頭亮一次就淡出換下一組
  let pitchAt = 0;
  function showPitch(next = false) {
    const set = () => {
      const ps = t('ldPitch'), [title, sub] = ps[pitchAt % ps.length];
      $('ldTitle').textContent = title;
      $('ldSub').textContent = sub;
      $('landing').classList.remove('pitch-out');
    };
    if (!next) return set();
    pitchAt++; $('landing').classList.add('pitch-out'); setTimeout(set, 300);
  }
  showPitch();
  // 示範牆：資料（含 323 px 的縮圖）和清晰照片各只下載一次；js/boot.js 在開場時已先 preload，這裡接著用
  let demoWallJob = null, demoWallPhotoJob = null;
  const demoWallData = () => demoWallJob || (demoWallJob = fetch('../demo/demo.json').then(r => r.json()).catch((e) => { demoWallJob = null; throw e; }));
  const demoWallPhoto = () => demoWallPhotoJob || (demoWallPhotoJob = AppKit.photo.load('../demo/demo.jpg').catch((e) => { demoWallPhotoJob = null; throw e; }));
  // 舊版五隻岩點貓的展示位置，僅供動畫使用。
  const DEMO_CAST = { 'hcat-lulu': ['lulu', 662, 1562, 0.27, 0], 'hcat-jianjian': ['jianjian', 210, 1455, 0.28, -12], 'hcat-tiaotiao': ['tiaotiao', 118, 1205, 0.24, -10], 'hcat-dongdong': ['dongdong', 1128, 1335, 0.29, 16], 'hcat-yuanyuan': ['yuanyuan', 955, 1800, 0.28, 8] };
  // 縮圖放大成跟清晰照片一樣的座標（岩點座標是照片的），先讓開場的三個畫面有東西可以演
  async function previewOf(d) {
    const th = new Image(); th.src = d.wall.thumb; await th.decode();
    const c = document.createElement('canvas'); c.width = d.wall.w; c.height = d.wall.h;
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(th, 0, 0, c.width, c.height);
    return c;
  }
  async function landingShot() {
    const run = ++shotRun, c = $('ldShot'), g = c.getContext('2d'), CW = 600, CH = 600;
    if (PCLAND && openHref) {
      $('ldSharedInfo').hidden = false;
      $('landing').classList.add('is-shared');
    }
    c.width = CW; c.height = CH;
    let d, img;
    if (!PCLAND && $('landing').classList.contains('welcome')) {   // 手機開場：示範資料一到先用小預覽跑，清晰版好了再換，不等 460 KB 的照片
      try { d = await demoWallData(); img = await previewOf(d); } catch (e) { return; }
      if (run !== shotRun) return;
      const src = { img };
      demoWallPhoto().then(full => { src.img = full; }, () => {});
      return welcomeScenes(run, d, src);
    }
    try { [d, img] = await Promise.all([demoWallData(), demoWallPhoto()]); }
    catch (e) { return; }
    if (run !== shotRun) return;
    if (PCLAND) return pcScenes(run, d, { img });
    const r = d.wall.routes.find(x => x.name === '螢光紅') || d.wall.routes[0], hs = holdsOf(r, d.wall);
    const b = hs.map(h => bbox(h.poly)).reduce((a, x) => ({ x0: Math.min(a.x0, x.x0), y0: Math.min(a.y0, x.y0), x1: Math.max(a.x1, x.x1), y1: Math.max(a.y1, x.y1) }));
    const W = d.wall.w, H = d.wall.h, A = CW / CH, cw = Math.min(W, H * A, Math.max((b.x1 - b.x0) * 1.25, (b.y1 - b.y0) * 1.25 * A)), ch = cw / A;   // 裁出跟畫面同比例、剛好放進路線的一塊
    const sx = Math.max(0, Math.min(W - cw, (b.x0 + b.x1 - cw) / 2)), sy = Math.max(0, Math.min(H - ch, (b.y0 + b.y1 - ch) / 2)), k = CW / cw;
    const color = document.createElement('canvas'); color.width = CW; color.height = CH; color.getContext('2d').drawImage(img, sx, sy, cw, ch, 0, 0, CW, CH);
    const gray = document.createElement('canvas'); gray.width = CW; gray.height = CH; const gg = gray.getContext('2d'); gg.drawImage(color, 0, 0);
    const id = gg.getImageData(0, 0, CW, CH), px = id.data;
    for (let i = 0; i < px.length; i += 4) { const y = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) * 0.72; px[i] = px[i + 1] = px[i + 2] = y; }
    gg.putImageData(id, 0, 0);
    const steps = RouteKit.revealSteps(r, hs), STEP = 0.32;
    const pt = d.wall.routes && t('capOpen'); $('ldTape').textContent = Array.isArray(pt) ? pt[0] : '';
    const loop = (t0) => {
      if (run !== shotRun || $('landing').hidden) return;
      const s = (performance.now() - t0) / 1000, end = 0.5 + steps.length * STEP + 0.25;
      g.drawImage(gray, 0, 0);
      steps.forEach((st, i) => {
        const a = Math.max(0, Math.min(1, (s - 0.5 - i * STEP) / 0.25)); if (!a) return;
        g.save(); g.globalAlpha = a; g.beginPath();
        for (const h of st) h.poly.forEach(([x, y], j) => g[j ? 'lineTo' : 'moveTo']((x - sx) * k, (y - sy) * k));
        g.clip(); g.drawImage(color, 0, 0); g.restore();
      });
      $('ldTape').classList.toggle('on', s > end);
      if (s > end + 2.4) { showPitch(true); return requestAnimationFrame(() => loop(performance.now())); }   // 看一下，換一組文案，再從頭亮一次
      requestAnimationFrame(() => loop(t0));
    };
    loop(performance.now());
  }
  // 開場的三個畫面，跟三組文案一對一：0 定線：暗彩的牆，手指一顆顆點路線岩點，照類型框起來；
  // 1 掃描：整面牆的岩點由上往下浮出，接著五位主角岩點貓醒來；2 挑戰：路線分享卡（灰階的底、路線岩點照順序亮起、膠帶短句），蓋下完攀爪印。
  // 每個畫面演在一個舞台（sceneStage）；live() 變成 false 就停
  const wait = AppKit.timing.wait;
  // src.img：目前用的照片（開場先用縮圖放大的預覽，清晰照片好了換成它）；各畫面開始時、定線畫面每點一顆岩點時才讀，所以換上去不用重來
  function demoScenes(d, src) {
    const W = d.wall.w, H = d.wall.h, by = (f) => { let k, v; return () => (src.img === k ? v : (v = f(k = src.img))); };
    const grayOf = by(RouteKit.grayOf), mutedOf = by(RouteKit.mutedOf);
    const r = d.wall.routes.find(x => x.name === '螢光紅') || d.wall.routes[0], hs = holdsOf(r, d.wall), order = RouteKit.revealSteps(r, hs).flat();
    const b = hs.map(h => bbox(h.poly)).reduce((a, x) => ({ x0: Math.min(a.x0, x.x0), y0: Math.min(a.y0, x.y0), x1: Math.max(a.x1, x.x1), y1: Math.max(a.y1, x.y1) }));
    const crop = (A) => {   // 跟畫面同比例、剛好放進路線的一塊
      const cw = Math.min(W, H * A, Math.max((b.x1 - b.x0) * 1.25, (b.y1 - b.y0) * 1.25 * A)), ch = cw / A;
      return { sx: Math.max(0, Math.min(W - cw, (b.x0 + b.x1 - cw) / 2)), sy: Math.max(0, Math.min(H - ch, (b.y0 + b.y1 - ch) / 2)), cw, ch };
    };
    const trace = (ctx, poly) => { ctx.beginPath(); poly.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); };
    return [
      async (st, live) => {   // 定線
        const { host, c, g, finger } = st;
        const box = host.getBoundingClientRect(); c.width = 600; c.height = Math.round(600 * box.height / box.width);
        const { sx, sy, cw, ch } = crop(c.width / c.height), k = c.width / cw, css = box.width / c.width, marks = [];
        const draw = () => {
          g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(mutedOf(), sx, sy, cw, ch, 0, 0, c.width, c.height);
          g.setTransform(k, 0, 0, k, -sx * k, -sy * k); g.lineJoin = 'round';
          for (const h of marks) RouteKit.strokeRouteHold(g, h.poly, r.holds[h.id], (v) => v / (k * css));
        };
        draw(); finger.hidden = false;
        for (const h of order) {
          if (!live()) return;
          const q = bbox(h.poly);
          Object.assign(finger.style, { left: `${((q.x0 + q.x1) / 2 - sx) * k * css}px`, top: `${((q.y0 + q.y1) / 2 - sy) * k * css}px` });
          await wait(300); finger.classList.add('press'); marks.push(h); draw(); await wait(110); finger.classList.remove('press');
        }
        await wait(1000); finger.hidden = true;
      },
      async (st, live) => {   // 掃描：整面牆
        const { host, c, g, fx } = st;
        c.width = 600; c.height = Math.round(600 * H / W); fx.width = c.width; fx.height = c.height;
        g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(grayOf(), 0, 0, c.width, c.height); g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, 0, c.width, c.height);
        await wait(300); if (!live()) return;
        await HoldCat.reveal({ base: c, fx, img: src.img, holds: d.wall.holds, w: W, dur: 1100, onCount: () => {} });
        if (!live()) return;
        await HoldCat.wake({ host, rect: { left: 0, top: host.clientHeight - c.clientHeight, width: c.clientWidth, height: c.clientHeight }, img: src.img, holds: d.wall.holds, w: W, base: c, cast: DEMO_CAST });   // 牆貼著下緣
        await wait(300);
      },
      async (st, live) => {   // 挑戰：分享卡
        const { host, c, g } = st;
        c.width = c.height = 600;
        const { sx, sy, cw, ch } = crop(1), k = c.width / cw;
        g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(grayOf(), sx, sy, cw, ch, 0, 0, 600, 600); RouteKit.tintCard(g, 600);
        st.tape.textContent = t('capSet').find(x => !/[，？！、。,?!]/.test(x)) || '';   // 膠帶短句挑沒有標點的 st.tape.classList.remove('on');
        await wait(300);
        for (const h of order) {
          if (!live()) return;
          g.save(); g.setTransform(k, 0, 0, k, -sx * k, -sy * k); trace(g, h.poly); g.clip(); g.drawImage(src.img, 0, 0); g.restore();
          await wait(110);
        }
        st.tape.classList.add('on'); await wait(600); if (!live()) return;
        await HoldCat.celebrate({ host, rect: { left: 0, top: 0, width: host.clientWidth, height: host.clientHeight }, src: c, w: cw,
          holds: hs.map(h => ({ poly: h.poly.map(([x, y]) => [x - sx, y - sy]) })) });
        await wait(600); st.tape.classList.remove('on');
      },
    ];
  }
  // 舞台：放畫布的框（裡面有畫布和膠帶），加上手指和效果層
  function sceneStage(host) {
    const c = host.querySelector('canvas');
    const finger = document.createElement('i'); finger.className = 'st-finger ld-finger'; finger.hidden = true;
    finger.innerHTML = '<b class="st-tip"></b><span class="st-bob"><svg class="st-hand"><use href="#i-hand"/></svg></span>';
    const fx = document.createElement('canvas'); fx.className = 'ld-fx';
    host.append(finger, fx);
    // tintCard reads these pixels on every loop of the route demo.
    return { host, c, g: c.getContext('2d', { willReadFrequently: true }), fx, finger, tape: host.querySelector('.ld-tape'),
      clear: () => fx.getContext('2d').clearRect(0, 0, fx.width, fx.height), remove: () => { finger.remove(); fx.remove(); } };
  }
  const stopCats = (host) => { if (host.querySelector('.hc-layer')) HoldCat.stop(); };   // 只收開場自己的岩點貓：收掉開場時分析畫面可能正在演
  // 手機開場：三組文案輪流，各自的版面（landing 的 data-pitch），演完淡出換下一組
  async function welcomeScenes(run, d, src) {
    const live = () => run === shotRun && !$('landing').hidden && $('landing').classList.contains('welcome');
    const scenes = demoScenes(d, src), st = sceneStage($('ldShot').parentElement);
    for (let i = pitchAt % scenes.length; live(); i = (i + 1) % scenes.length) {
      $('landing').dataset.pitch = i; pitchAt = i; showPitch();
      st.clear();
      await scenes[i](st, live);
      if (!live()) break;
      $('landing').classList.add('pitch-out'); await wait(320); stopCats(st.host);
    }
    st.remove(); stopCats(st.host);
  }
  // 電腦：三組文案並排成三欄（像雜誌的全版廣告），各配手機開場的同一個畫面；輪流演，演完停在最後一格。
  // 第四欄是同樣大小的連結卡（網址和複製鈕），標題是「用手機打開」
  async function pcScenes(run, d, src) {
    const live = () => run === shotRun && !$('landing').hidden;
    const feats = t('ldPitch').map(([title, sub], i) => {
      const f = document.createElement('article'); f.className = 'ld-feat';
      f.innerHTML = `<div class="ld-pic"><canvas></canvas><span class="ld-tape"></span></div><b class="ld-num">0${i + 1}</b><h2></h2><p></p>`;
      f.querySelector('h2').textContent = title; f.querySelector('p').textContent = sub;
      return f;
    });
    const card = document.createElement('article'); card.className = 'ld-feat ld-linkcard';
    card.innerHTML = '<div class="ld-pic"></div><b class="ld-num" aria-hidden="true">00</b><h2></h2>';
    card.firstChild.append($('ldLinkContent'));
    card.querySelector('h2').textContent = t(openHref ? 'pcRecv' : 'pcScan').replace(/，/g, '\n');   // 跟其他欄的主標一樣不用標點，換行分段
    $('ldFeats').replaceChildren(...feats, card);
    const scenes = demoScenes(d, src), stages = feats.map(f => sceneStage(f.querySelector('.ld-pic')));
    stages.forEach((st, i) => i && scenes[i](st, () => false));   // 還沒輪到的先畫好第一格（live 是 false：畫完底就停）
    for (let i = 0; live(); i = (i + 1) % scenes.length) {
      feats.forEach((f, j) => f.classList.toggle('on', j === i));
      stages[i].clear();
      await scenes[i](stages[i], live);
      await wait(1500);
    }
  }
  // 電腦的連結卡：平常是 App 的網址；點朋友的連結進來就是那條線（複製到手機打開直接收線）
  function pcLink() {
    $('ldInstall').hidden = true; $('ldLink').hidden = false;
    const recv = !!openHref, target = new URL(openHref || './', location.href);
    target.searchParams.delete('pc'); target.searchParams.delete('openExternalBrowser');
    $('ldLinkTitle').textContent = t(recv ? 'pcRecv' : 'pcScan');
    // 預覽頁轉過來的長網址（/?p=…&r=…）還原成短的 /r/照片編號/路線 id/
    const c = recv && !target.searchParams.get('wall') && ShareTools.linkFrom(target.href);
    $('ldLinkUrl').value = c && c.pid ? `${location.origin}/r/${c.pid}/${encodeURIComponent(c.rid)}/` : target.href;
  }
  $('ldLinkCopy').onclick = async () => {
    try { await navigator.clipboard.writeText($('ldLinkUrl').value); toast(t('shareCopied')); }
    catch (e) { $('ldLinkUrl').focus(); $('ldLinkUrl').select(); }   // 剪貼簿權限被拒時仍可手動複製完整網址。
  };
  function hideLanding() {
    document.documentElement.classList.remove('welcome-boot');
    ++shotRun;
    stopCats($('ldShot').parentElement);
    if (PCLAND) return;   // 電腦只有介紹頁
    $('landing').hidden = true; document.body.classList.remove('ld-open');
    closeOverlay('landing');
  }
  // 開場：共用品牌圖像與文字介紹，下方提供「開始拍」和「找牆面」
  function showWelcome() {
    $('landing').classList.add('welcome'); $('landing').classList.remove('over');
    $('landing').hidden = false; document.body.classList.add('ld-open');
    landingShot();
  }
  let welcomeGone = false;   // 讀牆面清單的時候開場畫面已經被關掉（例如點了連結、收線）：讀完就不再打開
  function hideWelcome() { welcomeGone = true; $('landing').classList.remove('welcome'); hideLanding(); }
  // 打開 App：沒登入、這台還沒有牆（第一次打開、登出後）是開場畫面
  // again：登出清掉資料後再來一次（之前關過開場畫面也照樣打開）；啟動時不重設，開頁後、讀清單前就被關掉的不再打開
  // index.html 一開頭猜這台沒有牆就先亮出開場畫面（welcome-boot）；這裡讀完清單再決定，猜錯就收起來
  async function welcomeBoot({ again = false } = {}) {
    try {
      if (again) welcomeGone = false;
      const walls = (await listWalls().catch(() => [])).filter(w => !isDemoPid(w.pid));
      if (walls.length) hideWelcome();
      else if (!welcomeGone) showWelcome();
    } finally { document.documentElement.classList.remove('welcome-boot'); }
  }
  // 還沒有牆：新增牆面中途離開（裁切取消、照片讀不了）、刪光了，回到開場畫面（跟重新打開一樣）；這台記得沒有牆就馬上蓋上，不先露出空的首頁
  function welcomeAgain() {
    if (!lsGet('climbio.hasWalls', false)) document.documentElement.classList.add('welcome-boot');
    welcomeBoot({ again: true });
  }
  // 「開始拍」：新增牆面（系統選單拍照或選照片），選好照片才關開場（新增牆面那裡）
  $('ldPlay').onclick = () => addWall();
  // 使用者取消拍照或選檔後留在開場，可再次拍照或改用「找牆面」。
  // 「找牆面」：還沒有牆的人先看別人公開的牆，收一面下來就有牆了；返回回到開場畫面（js/wall.js 的 popstate）
  $('ldFind').hidden = !(can('gyms') || SITE.directory);
  $('ldFind').onclick = async () => { hideWelcome(); await showHome(); openFind(); };
  $('ldClose').onclick = hideLanding;
  $('instGo').onclick = async () => {
    if (await inst.prompt()) return;
    if (inApp) return showLanding();   // 內建瀏覽器裝不了：說明請用 Safari／Chrome 打開（Android 多一顆「用 App 打開」）
    showAlert(isIos ? `${t('ldIos1')} → ${t('ldIos2')} → ${t('ldIos3')}「${t('iosAdd')}」` : t('installMenu'));
  };
  $('instX').onclick = () => inst.dismiss();
  $('ldGo').onclick = async () => {
    if (!await inst.prompt()) showAlert(t('installMenu'));
  };
  // 出完一條新路線（js/wall.js）：之後首頁下方提示加到主畫面
  function routeMade() { if (!lsGet(MADE_KEY, false)) { lsSet(MADE_KEY, true); renderInstall(); } }
  // 首頁下方的「加到主畫面」和安裝說明的內容
  // 同步自己的其他裝置：出過路線後在首頁提示一次（可關閉）；配對過、不支援、或正在顯示「加到主畫面」時不顯示。入口一直在「更多」選單（hmSync）
  function renderSyncHint() {
    $('syncHintBar').hidden = PCLAND || !lsGet(MADE_KEY, false) || lsGet('climbio.syncHintX', false) === true || AppKit.nearby.paired() > 0 || !AppKit.nearby.supported() || !$('instBar').hidden;
  }
  $('syncHintGo').onclick = () => { lsSet('climbio.syncHintX', true); renderSyncHint(); openNearby('devices'); };
  $('syncHintBtnX').onclick = () => { lsSet('climbio.syncHintX', true); renderSyncHint(); };
  function renderInstall() {
    $('instBar').hidden = PCLAND || !inst.offer || !lsGet(MADE_KEY, false);
    renderSyncHint();
    const ios = isIos && !inApp, inAppMode = (isIos || isAndroid) && inApp;
    const openApp = inAppMode && isAndroid;   // Android 的內建瀏覽器：用 intent 交給系統，裝了 App 就開 App
    $('ldIos').hidden = !ios;
    // Chrome 的安裝事件可能晚到；Android 先顯示按鈕，按下時才決定原生安裝或手動教學。
    $('ldGo').hidden = !(isAndroid || inst.canPrompt) || inAppMode;
    const txt = inAppMode ? t(isIos ? 'inAppIos' : 'inAppAndroid') : !ios && !isAndroid && !inst.canPrompt ? t('installMenu') : '';
    $('ldMenu').hidden = !txt; $('ldMenu').textContent = txt;
    $('ldOpenApp').hidden = !openApp;
    if (openApp) $('ldOpenApp').href = inst.intentUrl(openHref || location.href);
  }
  renderInstall();

  // ---------- iPhone 主畫面 App 的返回手勢：從左緣往右拖，這頁跟著手指移開，底下的上一頁從左邊滑出來（iOS 原生的換頁）----------
  // 只有自己記畫面時才有（js/wall.js 的 ownStack，系統沒有上一頁可退）；拖得回去的：牆面頁 → 首頁、路線圖 → 牆面頁
  const EDGE_BACK = 20, EDGE_PARALLAX = 0.3;
  let edge = null;
  function edgePages() {
    const top = history.state && history.state.s, prev = prevPage();
    if (top === 'wall' && prev === 'home' && !$('wall').hidden && $('editor').hidden) return { top: $('wall'), under: $('home'), scroll: homeScroll };
    if (top === 'view' && prev === 'wall' && !$('editor').hidden && state.routeView && !routeZoomed()) return { top: $('editor'), under: $('wall'), scroll: wallScroll };
    return null;
  }
  function edgePlace(dx) {
    const W = innerWidth, p = Math.max(0, Math.min(1, dx / W));
    edge.pg.top.style.transform = `translateX(${p * W}px)`;
    edge.pg.under.style.setProperty('--edge-x', `${-EDGE_PARALLAX * W * (1 - p)}px`);
    edge.shade.style.opacity = (0.3 * (1 - p)).toFixed(3);
  }
  function edgeBegin() {
    const { top, under, scroll } = edge.pg;
    edge.on = true; edge.y = document.scrollingElement.scrollTop;
    if (top.id === 'editor') { HoldCat.stop(); renderOverview(); }   // 分享鈕的小點先收掉；底下的牆面頁照現在的路線和紀錄畫好
    top.classList.add('edge-top');
    if (top.id === 'wall') top.scrollTop = edge.y;   // 牆面頁改成自己捲動的一層，畫面停在原本捲到的地方
    under.hidden = false; under.classList.add('edge-under');
    document.scrollingElement.scrollTop = scroll;   // 上一頁捲回離開時的位置，放手後就是這個樣子
    edge.shade = Object.assign(document.createElement('div'), { className: 'edge-shade' });
    document.body.append(edge.shade);
  }
  function edgeClear(g) {
    g.pg.top.classList.remove('edge-top', 'edge-settle'); g.pg.top.style.transform = '';
    g.pg.under.classList.remove('edge-under', 'edge-settle'); g.pg.under.style.removeProperty('--edge-x');
    g.shade.remove();
  }
  function edgeEnd(e) {
    const g = edge; edge = null;
    if (!g || !g.on) return;
    const now = e.timeStamp, recent = g.samples.filter(s => now - s.t <= 100), first = recent[0], last = g.samples[g.samples.length - 1];
    const v = first && last !== first ? (last.x - first.x) / Math.max(1, last.t - first.t) : 0;
    const commit = e.type === 'touchend' && v > -0.2 && (g.dx > innerWidth / 3 || (g.dx > 20 && v > 0.3));
    edge = g; g.pg.top.classList.add('edge-settle'); g.pg.under.classList.add('edge-settle'); g.shade.classList.add('edge-settle');
    edgePlace(commit ? innerWidth : 0); edge = null;
    document.body.classList.add('flying');   // 收尾動畫中不接受觸控
    setTimeout(() => {
      document.body.classList.remove('flying');
      if (!commit) {
        g.pg.under.hidden = true;
        edgeClear(g);
        document.scrollingElement.scrollTop = g.y;
        return;
      }
      // 返回由 App 照常處理（藏起這頁、更新上一頁）；處理完再拿掉位移，這頁不會先跳回來
      addEventListener('popstate', () => edgeClear(g), { once: true });
      userBack();
    }, 280);
  }
  document.addEventListener('touchstart', (e) => {
    edge = null;
    if (!ownStack || e.touches.length !== 1 || swipeFrame || document.body.classList.contains('flying') || tipBusy()) return;
    const t = e.touches[0];
    if (t.clientX > EDGE_BACK) return;
    const pg = edgePages();
    if (pg) edge = { pg, x0: t.clientX, y0: t.clientY, dx: 0, on: false, samples: [{ x: t.clientX, t: e.timeStamp }] };
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!edge) return;
    if (e.touches.length !== 1) { edgeEnd(e); return; }
    const t = e.touches[0], dx = t.clientX - edge.x0, dy = t.clientY - edge.y0;
    if (!edge.on) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > dx) { edge = null; return; }   // 偏直向：照常捲動
      if (dx < 8) return;
      edgeBegin();
    }
    e.preventDefault();
    edge.dx = Math.max(0, dx);
    edge.samples.push({ x: t.clientX, t: e.timeStamp });
    while (edge.samples.length > 2 && e.timeStamp - edge.samples[0].t > 100) edge.samples.shift();
    edgePlace(edge.dx);
  }, { passive: false });
  document.addEventListener('touchend', edgeEnd);
  document.addEventListener('touchcancel', edgeEnd);
