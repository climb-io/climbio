// RouteKit 內嵌頁（v2，通用）：看線、定線，不依賴 Climbio——不載入 App Check、不呼叫 Climbio 的服務，放到任何靜態主機都能跑（見 docs/embed.md）。
// 訊息外框：{ climbio: 'routekit', v: 2, type, … }；v1 頁（../v1/）完全不動。外層可以是 <iframe>（postMessage）或原生 App 的 WebView（橋接）。
// 外層 → 內嵌頁：init { view｜viewUrl, layers?｜layerUrls?, photo｜photoBase64＋photoType｜photoUrl, routeId?, layerId?, viewHref?, options?, capabilities? }
//     （畫面是 Climbio 公開格式 v2；內嵌的物件最大 16 MB、照片最大 10 MB；網址只收 https，要開 CORS，不帶 cookie，相對網址以這頁為準）、
//   setRoute { routeId }、setType { holdType }、setOptions {…}、setFullscreen { on }，
//   refineHoldResult { requestId, sessionId, result: [[x,y],…] ｜ error }、holdEditResult { requestId, sessionId, result: { accepted, poly?, reason? } ｜ error }。
// 網址參數 segment=1（看線才有）：有出手順序就分段播放；段長由程式決定，不能指定幾手一段。
// 內嵌頁 → 外層：ready、change／done／cancel／limit／fullscreen／error、
//   longPress { x, y, hitHoldId, routeId, holdType, pointerType, action, sessionId }（只觀察，不傳照片）、
//   refineHold { requestId, sessionId, routeId, holdId, poly, x, y, w, h }（宣告 holdEdit＋refine 才會發）、
//   holdEditCommit { requestId, sessionId, routeId, holdId, poly }（宣告 holdEdit＋wallEdit 才會發）。
// Climbio 官方適配層（只有 Climbio 自己的站台有 official/ 資料夾，通用 ZIP 不含；沒有時下列訊息回 error）：init 可以只給 wallId（"包 id/牆 id"）、key（岩館金鑰）；
//   submit { name?, grade?, author? }（把這條路線寫進 Climbio 公開牆，回 submitted { routeId, routeUrl, layer }）、remove { routeIds }（回 removed { results }）。這頁只在收到這些訊息時才載入 official/official.js。
// capabilities（init 宣告，沒宣告就沒有額外請求）：holdEdit（長按岩點出現調整列）、refine（調整列有「重描」，向外層要候選外框）、wallEdit（候選可「套用」到牆面，外層決定接不接受）。
// 候選外框先經 RouteKit.candidatePoly 驗證（有限數值、照片範圍內、頂點與面積限制），不合格視為失敗；逾時、換牆、換線、取消、遲到或重複的回覆都不會改畫面。
(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  const mode = params.get('mode') === 'edit' ? 'edit' : 'view';
  const TYPES = ['s', 'h', 't', 'f', 'n'], startType = TYPES.includes(params.get('type')) ? params.get('type') : 's';
  const $ = (id) => document.getElementById(id);
  const box = $('box'), cv = $('cv');
  // 上限：非負整數才算數，其他（沒給、負數、不是數字）就是預設
  const count = (v) => { const n = Number(v); return v !== null && v !== undefined && v !== '' && Number.isInteger(n) && n >= 0 ? n : undefined; };
  let lang = params.get('lang') === 'en' ? 'en' : 'zh';   // 語言：繁體中文（預設）或英文，只影響內嵌頁自己的按鈕和選單文字
  // 類型的顏色、起攀／完攀膠帶上的字：網址 color-s=22c55e（s、h、t、f）、label-s=起（s、t，1～2 個字）
  const hex = (v) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(v ?? '').trim()); return m ? `#${m[1].toLowerCase()}` : undefined; };
  const label = (v) => { const c = [...String(v ?? '').trim()]; return c.length >= 1 && c.length <= 2 ? c.join('') : undefined; };
  const fromParams = (names, pick) => Object.fromEntries(names.map((k) => [k, pick(params.get(`${pick === hex ? 'color' : 'label'}-${k}`))]).filter(([, v]) => v !== undefined));
  const opts = { lang, colors: fromParams(['s', 'h', 't', 'f'], hex), labels: fromParams(['s', 't'], label), heat: params.get('heat') !== '0', draw: params.get('draw') !== '0', base: 'dim', baseToggle: params.get('baseToggle') === '1', grade: params.get('grade') === '1', gradeSys: ['v', 'font', 'dan'].includes(params.get('gradeSys')) ? params.get('gradeSys') : 'v', controls: params.get('controls') !== '0', foot: params.get('foot') !== '0', order: params.get('order') !== '0', maxStart: count(params.get('maxStart')), segment: params.get('segment') === '1' };
  const inFrame = window.parent !== window, inPlace = params.get('tap') === 'edit';   // 不在 iframe 裡（原生 App 的 WebView、單獨開）整個畫面就是全螢幕
  let S = null, fs = null;   // S：{ scene, wall: { w, h, holds }, view, layerId, viewHref, routes, ctl, current }
  const randomId = () => `embed${Math.random().toString(36).slice(2, 10).padEnd(8, '0')}`;
  const theme = () => ({ ...RouteKit.THEME, colors: { ...RouteKit.THEME.colors, ...opts.colors }, text: { ...RouteKit.THEME.text, ...opts.labels } });
  // 可以互動（工具、縮放、點岩點）：在全螢幕、不在 iframe 裡、tap=edit，或外層自己控制（controls=0）；不然小畫面只是預覽，點一下進全螢幕
  const interactive = () => !inFrame || inPlace || !opts.controls || !!(fs && fs.on);
  const segmentOn = () => !!(opts.segment && mode === 'view');
  const uiState = () => ({ mode, lang: opts.lang, base: opts.base, controls: opts.controls, foot: opts.foot, order: opts.order, heat: opts.heat, interactive: interactive(), fullscreenOn: !!(fs && fs.on), segment: segmentOn() });

  // ---- 操作介面：kit 的 EditorUI（按鈕、類型列、順序列、選單）；規則在控制器（RouteEditor），這頁只接動作 ----
  const ui = RouteKit.EditorUI.mount(document.body, {
    ...uiState(), type: startType, fullscreen: true, colors: theme().colors,   // 全畫面鈕一直在：iframe 請外層放大，原生 WebView 送 fullscreen 給原生端處理
    onBase: (b) => { opts.base = b; if (S && S.ctl) S.ctl.setMode(b); ui.setOptions({ base: b }); ui.update(); },
    onDone: () => finish(true), onCancel: () => finish(false), onFullscreen: () => fs && fs.toggle(),
    onLimit: () => link.send('limit', { max: opts.maxStart === undefined ? RouteKit.MAX_START : opts.maxStart }),
  });
  const syncBase = () => { document.querySelector('[data-rk="base"]').hidden = !opts.baseToggle; };   // 底預設固定暗彩；外層要才給暗彩／黑白切換鈕
  syncBase();
  // 難度轉盤（選用，只在定線）：跟岩點貓同一個 kit 元件（RouteKit.gradeDial），放在取消鈕右邊；選的難度寫進路線，submit 沒帶 grade 就用它
  const DEFAULT_GRADE = { v: 'V3', font: '6A+', dan: '3級' };
  const gradeEl = document.createElement('div');
  gradeEl.className = 'grade-dial rk-only-edit'; gradeEl.setAttribute('role', 'group');
  ui.slot('start', gradeEl);
  const dial = RouteKit.gradeDial(gradeEl, { sys: opts.gradeSys, token: () => S && S.current, onPick: (g, cur) => { if (S && S.current && S.current === cur) { S.current.grade = g; emit(); } } });   // 停下來時換了路線就不算
  const syncGrade = () => {
    gradeEl.hidden = !(opts.grade && mode === 'edit');
    gradeEl.setAttribute('aria-label', lang === 'en' ? 'Grade' : '難度');
    if (!gradeEl.hidden) { dial.setSystem(opts.gradeSys); if (S && S.current) { if (!S.current.grade) S.current.grade = DEFAULT_GRADE[dial.system]; dial.setValue(S.current.grade, false, opts.gradeSys); } }
  };
  syncGrade();
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-Hant';
  function applyTheme() {
    ui.setOptions({ colors: theme().colors });
    if (S && S.ctl) { S.ctl.theme = theme(); S.scene.touch(); S.ctl.render(); }   // 顏色、膠帶上的字換了：外框、標籤重畫
  }

  function check(doc, what) {
    const errs = ClimbioFormat.validate(doc);
    if (errs.length) throw new Error(`${what} 不是合格的 Climbio 公開格式 v2：${errs[0]}`);
  }
  const onView = (t) => { document.documentElement.dataset.zoom = t ? t.s.toFixed(2) : ''; };   // 目前的放大倍數（給外層、測試看）
  // 互動狀態變了（進出全螢幕）：縮放、平移跟著開關，工具列跟著出現、消失
  function applyInteractive() {
    ui.setOptions(uiState());
    if (S && S.ctl) S.ctl.setZoom(interactive());
  }
  // ---- 路線 ----
  function build(route) {   // 這條路線的 v2 圖層（補上時間與 id）
    route.t = Date.now();
    if (!route.id) route.id = `r${route.t.toString(36)}`;
    return RouteKit.routesLayer({ id: S.layerId, pid: S.view.id, href: S.viewHref, w: S.wall.w, h: S.wall.h, holds: S.wall.holds, routes: [route] });
  }
  function emit() {   // 輸出只有這條路線的 v2 圖層
    const out = { layer: build(S.current), routeId: S.current.id };
    link.send('change', out);
    return out;
  }
  // 取消：路線回到打開時的樣子；完成：把目前的路線再送一次。兩個都結束定線（在全螢幕就退出）
  function finish(ok) {
    if (!S || mode !== 'edit') return;
    if (ok) link.send('done', emit());
    else { select(S.routeId); emit(); link.send('cancel', {}); }
    if (fs && fs.on) fs.toggle();
  }
  function edited() { emit(); ui.update(); }   // 編輯器改了 S.current：輸出、更新按鈕
  function select(routeId) {
    const found = routeId ? S.routes.find((r) => r.id === routeId) : null;
    if (routeId && !found) throw new Error(`圖層裡沒有路線 ${routeId}`);
    if (!found && mode !== 'edit') throw new Error('看線要指定圖層裡的路線');
    S.current = mode === 'edit' ? (found ? structuredClone(found) : { holds: {}, shapes: {} }) : found;   // 編輯器會直接改傳入的路線，所以編輯的是複本
    if (S.ctl) S.ctl.setRoute(S.current);
    else {
      const pads = () => ui.pads(cv);
      const topInset = () => (opts.controls ? 64 : 0);   // 上面讓出的高度：跟岩點貓看路線圖的標題列一樣（返回鈕的 top 12 加 52）
      S.ctl = mode === 'edit'
        ? new RouteKit.RouteEditor(cv, { scene: S.scene, route: S.current, type: startType, mode: opts.base, glow: true, theme: theme(), pads, onView, maxStart: opts.maxStart, draw: opts.draw, onChange: edited, onLongPress, ...holdEditOpts(), ...ui.hooks, heatRoutes: () => S.routes, groupRoutes: () => S.routes.map((q) => (q.id && q.id === S.current.id ? S.current : q)), topInset })
        : new RouteKit.RouteViewer(cv, { scene: S.scene, route: S.current, mode: opts.base, glow: true, theme: theme(), pads, onView, groupRoutes: () => S.routes, topInset, segment: segmentOn(), onSegment: () => ui.update() });   // 看線：固定暗彩，跟岩點貓暗彩一樣只用光暈分辨路線岩點（不染色、不畫膠帶）
      S.ctl.setZoom(interactive());
      ui.attach(S.ctl, () => S.current);
    }
    watchSegment();
    ui.setOptions(uiState());
    ui.update();
    syncGrade();
  }
  function setOptions(o = {}, repaint = true) {
    if ('controls' in o) opts.controls = !!o.controls;
    if ('maxStart' in o) opts.maxStart = count(o.maxStart);
    if ('baseToggle' in o) { opts.baseToggle = !!o.baseToggle; syncBase(); }
    if ('grade' in o) opts.grade = !!o.grade;
    if (['v', 'font', 'dan'].includes(o.gradeSys)) opts.gradeSys = o.gradeSys;
    if ('foot' in o) opts.foot = !!o.foot;
    if ('order' in o) opts.order = !!o.order;
    if ('heat' in o) opts.heat = !!o.heat;
    if ('draw' in o) opts.draw = !!o.draw;
    if ('segment' in o) opts.segment = o.segment === true || o.segment === 1 || o.segment === '1';   // 只是開關，數字不是段長
    if (o.lang === 'zh' || o.lang === 'en') { lang = opts.lang = o.lang; document.documentElement.lang = lang === 'en' ? 'en' : 'zh-Hant'; }
    if (o.colors && typeof o.colors === 'object') { opts.colors = Object.fromEntries(['s', 'h', 't', 'f'].map((k) => [k, hex(o.colors[k])]).filter(([, v]) => v)); applyTheme(); }
    if (o.labels && typeof o.labels === 'object') { opts.labels = Object.fromEntries(['s', 't'].map((k) => [k, label(o.labels[k])]).filter(([, v]) => v)); applyTheme(); }
    if (S && S.ctl) {
      S.ctl.setMode(opts.base);
      if (S.ctl.setSegmented) S.ctl.setSegmented(segmentOn());
      watchSegment();
      if (mode === 'edit') { S.ctl.setMaxStart(opts.maxStart); S.ctl.setDrawMode(opts.draw); S.ctl.setHoldEdit({ lang: opts.lang }); }
    }
    ui.setOptions(uiState());
    syncGrade();
    if (repaint) applyInteractive();
  }

  // 分段播放滑出畫面就停、滑回來再播（跟示範頁的 IntersectionObserver 同一種）。使用者按了暫停之後，play 不會把它打開。
  let segIo = null;
  function watchSegment() {
    if (segIo) { segIo.disconnect(); segIo = null; }
    if (!segmentOn() || !S || !S.ctl || typeof IntersectionObserver !== 'function') return;
    segIo = new IntersectionObserver((entries) => {
      const ctl = S && S.ctl;
      if (!ctl || !ctl.segmentOn) return;
      if (entries.some((e) => e.isIntersecting)) ctl.play(); else ctl.pause();
    });
    segIo.observe(cv);
  }

  // ---- 長按修點（宣告 holdEdit 才有）：調整列、候選外框預覽與驗證都在 kit 的 RouteEditor（holdEdit 選項），這頁只把請求轉成訊息 ----
  const reqs = ClimbioEmbed.createRequests({ send: (type, d) => link.send(type, d), timeoutMs: 15000 });
  const has = (cap) => !!(S && S.caps && S.caps.has(cap));
  const routeIdOf = () => (S && S.current && S.current.id) || null;
  const ask = (type) => (req, signal) => {
    const q = reqs.begin(type, req);
    if (signal) signal.addEventListener('abort', () => reqs.cancelAll('取消'), { once: true });
    return q.result;
  };
  // RouteEditor 的長按通知：只觀察，轉給外層（修點由 kit 自己處理）
  function onLongPress(e) {
    const { type: holdType, ...rest } = e;   // 定線類型改叫 holdType（type 是訊息種類）
    link.send('longPress', { ...rest, holdType, sessionId: reqs.sessionId });
  }
  const holdEditOpts = () => ({ holdEdit: has('holdEdit'), onRefineHold: has('holdEdit') && has('refine') ? ask('refineHold') : null, onHoldEditCommit: has('holdEdit') && has('wallEdit') ? ask('holdEditCommit') : null, lang: opts.lang });

  // 官方適配層：用到才載入（同源的 official/official.js）；通用 ZIP 沒有這個檔，載入失敗就回 error
  let officialJob = null;
  const official = () => (officialJob ||= new Promise((res, rej) => {
    if (window.RouteOfficial) return res(window.RouteOfficial);
    const el = document.createElement('script');
    el.src = new URL('official/official.js', location.href).href;
    el.onload = () => (window.RouteOfficial ? res(window.RouteOfficial) : rej(new Error('官方適配層載入失敗')));
    el.onerror = () => rej(new Error('這個發佈包沒有 Climbio 官方適配層（wallId、submit、remove 只有 Climbio 自己的站台提供）'));
    document.head.appendChild(el);
  })).catch((e) => { officialJob = null; throw e; });
  let initSeq = 0;
  const link = ClimbioEmbed.connect({
    kit: 'routekit', v: 2,
    handlers: {
      async init(m) {
        const seq = ++initSeq;
        if (m.wallId !== undefined) m = (await official()).expand(m);   // 官方資料集的簡寫：展開成網址
        if (seq !== initSeq) return;
        const caps = ClimbioEmbed.capsOf(m.capabilities);
        const data = await ClimbioEmbed.resolveInitV2(m, { base: location.href });   // 自備物件、照片，或 https 網址（viewUrl、layerUrls、photoUrl）
        if (seq !== initSeq) return;
        const layers = data.layers;
        check(data.view, 'view');
        layers.forEach((l, i) => check(l, `layers[${i}]`));
        const photo = await ClimbioEmbed.decodePhoto(data.photo), wall = RouteKit.fromFormat(data.view, layers);
        if (seq !== initSeq) { photo.close?.(); return; }
        if (photo.width !== wall.w || photo.height !== wall.h) { photo.close?.(); throw new Error(`照片尺寸 ${photo.width}×${photo.height} 跟畫面的 ${wall.w}×${wall.h} 不一樣`); }
        if (S && S.ctl && S.ctl.endHoldEdit) S.ctl.endHoldEdit();
        reqs.newSession();
        if (S) { ui.detach(); S.ctl?.destroy(); S.scene?.release(); S.photo?.close?.(); }
        S = { caps, photo, scene: RouteKit.scene(photo, wall.holds), wall, view: data.view, routes: wall.routes, ctl: null, current: null,
          layerId: typeof m.layerId === 'string' ? m.layerId : (layers[0] && layers[0].id) || randomId(),
          key: m.key && typeof m.key === 'object' ? m.key : null,   // 岩館自己的金鑰（選用，提交、刪除時簽章；不給就用外層的網站來源）
          viewHref: typeof m.viewHref === 'string' ? m.viewHref : (typeof m.viewUrl === 'string' ? m.viewUrl : (data.view && data.view.href) || '') };
        if (m.options && typeof m.options === 'object') setOptions(m.options, false);   // 路線還沒選，先不畫按鈕
        S.routeId = m.routeId || null;
        select(m.routeId || (mode === 'view' && wall.routes[0] ? wall.routes[0].id : null));
      },
      setRoute(m) { if (!S) throw new Error('還沒有 init'); if (S.ctl && S.ctl.endHoldEdit) S.ctl.endHoldEdit(); reqs.newSession(); S.routeId = m.routeId || null; select(S.routeId); },
      setType(m) {
        if (!S || mode !== 'edit') return;
        if (!TYPES.includes(m.holdType)) throw new Error('holdType 要是 s、h、t、f、n');
        ui.pickType(m.holdType);
      },
      // 提交：把定好的這條路線寫進 Climbio 公開牆，成功回 submitted { routeId, routeUrl, layer }，失敗回 error。名稱、難度、暱稱由外層收，在 submit 帶進來
      async submit(m) {
        if (!S || mode !== 'edit' || !S.current) throw new Error('提交只在定線（mode=edit）可以用');
        const roles = Object.values(S.current.holds || {});
        if (!roles.includes('s') || !roles.includes('t')) throw new Error('路線要有起攀（s）和完攀（t）才能提交');
        const O = await official();
        const text = (v, n) => (typeof v === 'string' ? [...v.trim()].slice(0, n).join('') : '');
        const route = { ...structuredClone(S.current), name: text(m.name, 20), author: text(m.author, 20), ...(typeof m.grade === 'string' && m.grade ? { grade: m.grade } : S.current.grade ? { grade: S.current.grade } : {}) };
        const layer = build(route);
        const res = await O.put(link.origin, S.view.id, { routes: [{ id: route.id, r: JSON.stringify({ nodes: layer.nodes, marks: layer.marks }) }] }, S.key);
        if (res[route.id] !== 'ok') throw new Error(`提交失敗：${res[route.id] || 'failed'}`);
        S.current.id = route.id;
        link.send('submitted', { routeId: route.id, routeUrl: `https://climbio.app/r/${S.view.id}/${route.id}/route.json`, layer });
      },
      // 刪除：自己提交的路線（別人的回 taken）；回 removed { results: { 路線 id: 'ok' | 'taken' } }
      async remove(m) {
        if (!S) throw new Error('還沒有 init');
        const ids = Array.isArray(m.routeIds) ? m.routeIds.filter((x) => typeof x === 'string' && x) : [];
        if (!ids.length || ids.length > 100) throw new Error('routeIds 要是 1～100 個路線 id');
        const O = await official();
        link.send('removed', { results: await O.put(link.origin, S.view.id, { del: ids }, S.key) });
      },
      setOptions(m) { setOptions(m); },
      setFullscreen(m) { if (fs) fs.set(!!m.on); },
      refineHoldResult(m) { reqs.settle(m, 'refineHold'); },   // 只接受目前 session、還在等、種類對得上的回覆；其他一律忽略
      holdEditResult(m) { reqs.settle(m, 'holdEditCommit'); },
    },
  });

  // ---- 全螢幕與手勢 ----
  fs = ClimbioEmbed.fullscreen({ el: document.documentElement, send: link.send, onChange: applyInteractive, host: () => ClimbioEmbed.native() });
  // 小畫面是預覽：點一下進全螢幕（不選岩點）；擋在畫布的 click 之前
  box.addEventListener('click', (e) => { if (!interactive()) { e.stopPropagation(); e.preventDefault(); fs.toggle(); } }, true);
  applyInteractive();
})();
