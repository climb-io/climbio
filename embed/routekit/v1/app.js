// RouteKit 內嵌頁（v1）：看線、定線。資料一律是 Climbio 官方發佈的公開格式 v2（畫面、照片、路線圖層），外層只給官方網址，內嵌頁自己讀；定線的結果用訊息送回。
// 外層可以是 <iframe>（postMessage）或原生 App 的 WebView（橋接），見 docs/embed.md。
// 工具列、類型列、順序列、選單都是 kit 的 RouteKit.EditorUI（跟岩點貓定線頁同一份），這頁只管訊息、圖層和畫布。
// 小畫面（iframe 在頁面裡）只是預覽：沒有工具蓋在畫面上，點一下就進全螢幕；全螢幕才有工具、縮放平移（跟岩點貓同一套）和定線。
// 外層 → 內嵌頁：init { wallId（或 viewUrl、photoUrl）, layerUrls?, routeId?, layerId?, viewHref?, options?, key? }（三個網址都要是官方網址，見 docs/embed.md）、setRoute { routeId }（空的＝新路線，定線才有）、
//   submit { name?, grade?, author? }（定線：把這條路線寫進 Climbio 公開牆，成功回 submitted，失敗回 error）、remove { routeIds }（刪自己提交的路線，回 removed）、setType { holdType }（s 起攀、h 手點、t 完攀、f 腳點、n 順序）、setOptions { lang?, colors?, labels?, heat?, draw?, maxStart?, controls?, foot?, order? }、setFullscreen { on }（外層放大或縮回 iframe 後同步）。
// 內嵌頁 → 外層：ready、change { layer, routeId }（定線改了：v2 圖層，只有這條路線）、limit { max }（起攀已滿：已在路線上的點不能改成起攀，內嵌頁沒有改路線）、
//   submitted { routeId, routeUrl, layer }（submit 成功）、removed { results }（remove 的結果）、done { layer, routeId }（定線完成，右上的勾）、cancel（取消，左上的叉）、fullscreen { on }（進出全螢幕，內嵌頁自己做不到時請外層把 iframe 放大或縮回）、error { message }。
// 網址參數（顯示選項，init 的 options 和 setOptions 可以覆蓋）：mode=view｜edit、type=s｜h｜t｜f｜n（底固定暗彩＋光暈，看線、定線都一樣，沒有黑白切換；黑白是岩點貓自己的特色）、
//   controls=1（預設）｜0（不顯示按鈕，全由外層用訊息控制；畫面直接可以互動）、foot=1（預設）｜0（定線工具列有沒有腳點）、order=1（預設）｜0（有沒有順序）、maxStart（起攀點數上限，預設 2＝岩點貓；有的岩館規定 4）、
//   tap=fullscreen（預設，小畫面點一下進全螢幕）｜edit（框夠大，直接在原地看線、定線）。
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
  const opts = { lang, colors: fromParams(['s', 'h', 't', 'f'], hex), labels: fromParams(['s', 't'], label), heat: params.get('heat') !== '0', draw: params.get('draw') !== '0', base: 'dim', controls: params.get('controls') !== '0', foot: params.get('foot') !== '0', order: params.get('order') !== '0', maxStart: count(params.get('maxStart')) };
  const inFrame = window.parent !== window, inPlace = params.get('tap') === 'edit';   // 不在 iframe 裡（原生 App 的 WebView、單獨開）整個畫面就是全螢幕
  let S = null, fs = null;   // S：{ scene, wall: { w, h, holds }, view, layerId, viewHref, routes, ctl, current }
  const randomId = () => `embed${Math.random().toString(36).slice(2, 10).padEnd(8, '0')}`;
  const theme = () => ({ ...RouteKit.THEME, colors: { ...RouteKit.THEME.colors, ...opts.colors }, text: { ...RouteKit.THEME.text, ...opts.labels } });
  // 可以互動（工具、縮放、點岩點）：在全螢幕、不在 iframe 裡、tap=edit，或外層自己控制（controls=0）；不然小畫面只是預覽，點一下進全螢幕
  const interactive = () => !inFrame || inPlace || !opts.controls || !!(fs && fs.on);
  const uiState = () => ({ mode, lang: opts.lang, base: opts.base, controls: opts.controls, foot: opts.foot, order: opts.order, heat: opts.heat, interactive: interactive(), fullscreenOn: !!(fs && fs.on) });

  // ---- 操作介面：kit 的 EditorUI（按鈕、類型列、順序列、選單）；規則在控制器（RouteEditor），這頁只接動作 ----
  const ui = RouteKit.EditorUI.mount(document.body, {
    ...uiState(), type: startType, fullscreen: true, colors: theme().colors,   // 全畫面鈕一直在：iframe 請外層放大，原生 WebView 送 fullscreen 給原生端處理
    onDone: () => finish(true), onCancel: () => finish(false), onFullscreen: () => fs && fs.toggle(),
    onLimit: () => link.send('limit', { max: opts.maxStart === undefined ? RouteKit.MAX_START : opts.maxStart }),
  });
  document.querySelector('[data-rk="base"]').hidden = true;   // 底固定暗彩：不給切換黑白（黑白是岩點貓的特色）
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
        ? new RouteKit.RouteEditor(cv, { scene: S.scene, route: S.current, type: startType, mode: opts.base, glow: true, theme: theme(), pads, onView, maxStart: opts.maxStart, draw: opts.draw, onChange: edited, ...ui.hooks, heatRoutes: () => S.routes, groupRoutes: () => S.routes.map((q) => (q.id && q.id === S.current.id ? S.current : q)), topInset })
        : new RouteKit.RouteViewer(cv, { scene: S.scene, route: S.current, mode: opts.base, glow: true, theme: theme(), pads, onView, groupRoutes: () => S.routes, topInset });   // 看線：固定暗彩，跟岩點貓暗彩一樣只用光暈分辨路線岩點（不染色、不畫膠帶）
      S.ctl.setZoom(interactive());
      ui.attach(S.ctl, () => S.current);
    }
    ui.setOptions(uiState());
    ui.update();
  }
  function setOptions(o = {}, repaint = true) {
    if ('controls' in o) opts.controls = !!o.controls;
    if ('maxStart' in o) opts.maxStart = count(o.maxStart);
    if ('foot' in o) opts.foot = !!o.foot;
    if ('order' in o) opts.order = !!o.order;
    if ('heat' in o) opts.heat = !!o.heat;
    if ('draw' in o) opts.draw = !!o.draw;
    if (o.lang === 'zh' || o.lang === 'en') { lang = opts.lang = o.lang; document.documentElement.lang = lang === 'en' ? 'en' : 'zh-Hant'; }
    if (o.colors && typeof o.colors === 'object') { opts.colors = Object.fromEntries(['s', 'h', 't', 'f'].map((k) => [k, hex(o.colors[k])]).filter(([, v]) => v)); applyTheme(); }
    if (o.labels && typeof o.labels === 'object') { opts.labels = Object.fromEntries(['s', 't'].map((k) => [k, label(o.labels[k])]).filter(([, v]) => v)); applyTheme(); }
    if (S && S.ctl) {
      S.ctl.setMode(opts.base);
      if (mode === 'edit') { S.ctl.setMaxStart(opts.maxStart); S.ctl.setDrawMode(opts.draw); }
    }
    ui.setOptions(uiState());
    if (repaint) applyInteractive();
  }

  let initSeq = 0;
  const link = ClimbioEmbed.connect({
    kit: 'routekit',
    handlers: {
      async init(m) {
        const seq = ++initSeq;
        m = await ClimbioEmbed.expandInit(m);
        const data = await ClimbioEmbed.resolveInit(m);   // 只讀官方網址（viewUrl、layerUrls、photoUrl）
        if (seq !== initSeq) return;
        const layers = data.layers;
        check(data.view, 'view');
        layers.forEach((l, i) => check(l, `layers[${i}]`));
        const photo = await ClimbioEmbed.decodePhoto(data.photo), wall = RouteKit.fromFormat(data.view, layers);
        if (seq !== initSeq) { photo.close?.(); return; }
        if (photo.width !== wall.w || photo.height !== wall.h) { photo.close?.(); throw new Error(`照片尺寸 ${photo.width}×${photo.height} 跟畫面的 ${wall.w}×${wall.h} 不一樣`); }
        if (S) { ui.detach(); S.ctl?.destroy(); S.scene?.release(); S.photo?.close?.(); }
        S = { photo, scene: RouteKit.scene(photo, wall.holds), wall, view: data.view, routes: wall.routes, ctl: null, current: null,
          layerId: typeof m.layerId === 'string' ? m.layerId : (layers[0] && layers[0].id) || randomId(),
          viewHref: typeof m.viewHref === 'string' ? m.viewHref : m.viewUrl, key: m.key && typeof m.key === 'object' ? m.key : null };   // key：岩館自己的金鑰（選用，提交、刪除時簽章；不給就用外層的網站來源）
        if (m.options && typeof m.options === 'object') setOptions(m.options, false);   // 路線還沒選，先不畫按鈕
        S.routeId = m.routeId || null;
        select(m.routeId || (mode === 'view' && wall.routes[0] ? wall.routes[0].id : null));
      },
      setRoute(m) { if (!S) throw new Error('還沒有 init'); S.routeId = m.routeId || null; select(S.routeId); },
      setType(m) {
        if (!S || mode !== 'edit') return;
        if (!TYPES.includes(m.holdType)) throw new Error('holdType 要是 s、h、t、f、n');
        ui.pickType(m.holdType);
      },
      // 提交：把定好的這條路線寫進 Climbio 的公開牆，成功回 submitted { routeId, routeUrl, layer }，失敗回 error。名稱、難度、暱稱由外層收，在 submit 帶進來
      async submit(m) {
        if (!S || mode !== 'edit' || !S.current) throw new Error('提交只在定線（mode=edit）可以用');
        const roles = Object.values(S.current.holds || {});
        if (!roles.includes('s') || !roles.includes('t')) throw new Error('路線要有起攀（s）和完攀（t）才能提交');
        const text = (v, n) => (typeof v === 'string' ? [...v.trim()].slice(0, n).join('') : '');
        const route = { ...structuredClone(S.current), name: text(m.name, 20), author: text(m.author, 20), ...(typeof m.grade === 'string' && m.grade ? { grade: m.grade } : {}) };
        const layer = build(route);
        const res = await RouteSubmit.put(link.origin, S.view.id, { routes: [{ id: route.id, r: JSON.stringify({ nodes: layer.nodes, marks: layer.marks }) }] }, S.key);
        if (res[route.id] !== 'ok') throw new Error(`提交失敗：${res[route.id] || 'failed'}`);
        S.current.id = route.id;
        link.send('submitted', { routeId: route.id, routeUrl: `https://climbio.app/r/${S.view.id}/${route.id}/route.json`, layer });
      },
      // 刪除：自己提交的路線（別人的回 taken）；回 removed { results: { 路線 id: 'ok' | 'taken' } }
      async remove(m) {
        if (!S) throw new Error('還沒有 init');
        const ids = Array.isArray(m.routeIds) ? m.routeIds.filter((x) => typeof x === 'string' && x) : [];
        if (!ids.length || ids.length > 100) throw new Error('routeIds 要是 1～100 個路線 id');
        link.send('removed', { results: await RouteSubmit.put(link.origin, S.view.id, { del: ids }, S.key) });
      },
      setOptions(m) { setOptions(m); },
      setFullscreen(m) { if (fs) fs.set(!!m.on); },
    },
  });

  // ---- 全螢幕與手勢 ----
  fs = ClimbioEmbed.fullscreen({ el: document.documentElement, send: link.send, onChange: applyInteractive, host: () => ClimbioEmbed.native() });
  // 小畫面是預覽：點一下進全螢幕（不選岩點）；擋在畫布的 click 之前
  box.addEventListener('click', (e) => { if (!interactive()) { e.stopPropagation(); e.preventDefault(); fs.toggle(); } }, true);
  applyInteractive();
})();
