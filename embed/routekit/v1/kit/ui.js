// RouteKit ui：定線、看線的操作介面（純 UI 元件）——上方圓鈕（取消、暗彩／黑白、顯示所有岩點、縮放、全畫面、完成）、
// 下方類型列（起攀、手點、完攀、腳點、順序）、順序列、底部選單。岩點貓定線頁、內嵌頁（iframe／WebView）、以後的 3D 內嵌頁用同一份。
// 它只畫按鈕、轉述按下的動作給「控制器」，不存檔、不同步、不分享、不認識 App 的狀態：
//   控制器（controller）＝ RouteEditor／RouteViewer，或任何實作同一組方法的物件（例如 3D 牆的舞台）：
//     type、setType(t)、setMode(base)、showAll、setShowAll(on)、zoomStep(dir)、
//     canUndoSeq、undoSeq()、orderInfo、orderInsertAfter(n)、orderRemove(n)、orderClear()、orderEndInsert()、toggleFeetFree({ clear? })
//   路線（getRoute()）：{ holds, feetFree?, seq? }。起攀／完攀的規則、順序的規則都在控制器（editor.js），這裡不重算。
// 用法：const ui = RouteKit.EditorUI.mount(hostEl, { mode: 'edit', lang, onDone, onCancel, onBase, onFullscreen, onLimit, ... });
//   const ed = new RouteKit.RouteEditor(canvas, { ..., pads: () => ui.pads(canvas), ...ui.hooks, onChange: () => { ...; ui.update(); } });
//   ui.attach(ed, () => route);   之後狀態變了呼叫 ui.update()；ui.setOptions({ ... })；ui.destroy()
// 瀏覽器用 <script> 載入，掛在全域 RouteKit.EditorUI；Node 載得進來（只有 mount 要 DOM）。
// English: RouteKit ui: the route-setting / route-viewing controls as a pure UI component (top round buttons, type row, order bar, sheet).
// It only draws buttons and forwards actions to a controller (RouteEditor/RouteViewer or anything with the same methods); it never saves, syncs or shares.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else Object.assign(root.RouteKit || (root.RouteKit = {}), factory());
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const TYPES = ['s', 'h', 't', 'f', 'n'];
  // 內建文字：繁體中文、英文；宿主（岩點貓有八種語言）用 strings 覆蓋，值可以是字串或函式
  const STR = {
    zh: { cancel: '取消', base: '黑白／暗彩', heat: '顯示所有岩點', zout: '縮小', zin: '放大', fs: '全畫面', done: '完成', undo: '復原', orderEnd: '結束插入',
      prev: '上一條', next: '下一條', s: '起攀', h: '手點', t: '完攀', f: '腳點', n: '順序', feetFree: '不限腳', orderAt: (n) => `第 ${n} 手之後插入`, orderFirst: '插在最前面', orderCount: (n) => `共 ${n} 手`, orderHint: '依序點出手的岩點',
      delMove: (n) => `刪掉第 ${n} 手`, feetAsk: '開不限腳會清掉已標的腳點', feetGo: '清掉並不限腳', seqAsk: '清除這條路線的出手順序？', seqClear: '清除順序' },
    en: { cancel: 'Cancel', base: 'Grayscale / dimmed color', heat: 'Show all holds', zout: 'Zoom out', zin: 'Zoom in', fs: 'Fullscreen', done: 'Done', undo: 'Undo', orderEnd: 'End insert',
      prev: 'Previous route', next: 'Next route', s: 'Start', h: 'Hand', t: 'Top', f: 'Foot', n: 'Order', feetFree: 'Any feet', orderAt: (n) => `Insert after move ${n}`, orderFirst: 'Insert at the start', orderCount: (n) => `${n} moves`, orderHint: 'Tap the holds in move order',
      delMove: (n) => `Delete move ${n}`, feetAsk: 'Turning on "any feet" clears the foot holds already marked', feetGo: 'Clear and allow any feet', seqAsk: 'Clear this route\'s move order?', seqClear: 'Clear order' },
  };
  const ICON = {
    cancel: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    base: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/></svg>',
    heat: '<svg viewBox="0 0 24 24"><path d="M7 5c4-2 9 0 11 3s1 9-3 11-10 1-12-3S3 7 7 5z" stroke-dasharray="3 2.5"/></svg>',   // 跟岩點貓牆面頁「顯示所有岩點」同一個圖示（虛線的岩點外框）
    zout: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
    zin: '<svg viewBox="0 0 24 24"><path d="M5 12h14M12 5v14"/></svg>',
    fs: '<svg class="in" viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg><svg class="out" viewBox="0 0 24 24"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
    done: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    undo: '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
    prev: '<svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>',
  };
  const CSS = `
.rk-ui { --rk-s: #22c55e; --rk-h: #3b82f6; --rk-t: #ef4444; --rk-f: #facc15; --rk-n: #f4f4f4; --rk-pill: rgba(15, 20, 18, .68); --rk-fg: #fff; --rk-accent: #b8f200; --rk-on-accent: #0a0a0a;
  position: absolute; inset: 0; z-index: 3; pointer-events: none; overflow: hidden; color: var(--rk-fg); font: 600 13px/1 system-ui, -apple-system, "PingFang TC", "Noto Sans TC", sans-serif; }
.rk-ui * { box-sizing: border-box; }
.rk-ui > * { pointer-events: auto; }
.rk-ui [hidden] { display: none !important; }
.rk-pill { display: flex; gap: 4px; padding: 4px; border-radius: 999px; background: var(--rk-pill); color: var(--rk-fg); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.rk-ui button { flex: none; min-width: 36px; height: 36px; padding: 0 10px; border: 0; border-radius: 999px; background: transparent; color: inherit; font: inherit; display: inline-flex; align-items: center; justify-content: center; gap: 5px; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.rk-ui button:focus-visible { outline: 2px solid #fff; outline-offset: -2px; }
.rk-ui button:disabled { opacity: .35; cursor: default; }
.rk-ui button svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.rk-ui button[aria-pressed="true"] { background: rgba(255, 255, 255, .22); }
.rk-top { position: absolute; max-width: calc(100% - 12px); top: max(6px, env(safe-area-inset-top)); right: max(6px, env(safe-area-inset-right)); }
.rk-slot { display: contents; }   /* 宿主塞進來的元素（例如難度）；位置見 slot() */
/* 小畫面只是預覽：只有一顆進全螢幕的小圖示，其他工具（和縮放、定線）進了全螢幕才有 */
.rk-only-full, .rk-only-edit { display: none !important; }
/* 手機（觸控）有雙指縮放，不放縮放鈕；滑鼠才有 */
@media (pointer: coarse) { .rk-ui button.rk-zin.rk-only-full, .rk-ui button.rk-zout.rk-only-full { display: none !important; } }
.rk-full .rk-only-full:not([hidden]), .rk-full.rk-edit .rk-only-edit:not([hidden]) { display: inline-flex !important; }
.rk-fs .out { display: none; }
.rk-fs[aria-pressed="true"] .in { display: none; }
.rk-fs[aria-pressed="true"] .out { display: block; }
.rk-ui:not(.rk-full) .rk-top { padding: 2px; opacity: .8; }
.rk-ui:not(.rk-full) .rk-fs { min-width: 30px; height: 30px; padding: 0 5px; }
/* 定線全螢幕：左取消、右邊 暗彩／顯示所有岩點（電腦還有縮放）、完成，每顆是 46 px 的圓鈕（底色 .35），不包在一條膠囊裡；中間留給宿主（例如難度）*/
.rk-edit.rk-full .rk-top { left: var(--rk-inset-x, max(12px, env(safe-area-inset-left))); right: var(--rk-inset-x, max(12px, env(safe-area-inset-right))); top: var(--rk-inset-top, max(12px, env(safe-area-inset-top))); max-width: none; gap: 10px; align-items: center; background: none; backdrop-filter: none; -webkit-backdrop-filter: none; padding: 0; }
.rk-edit.rk-full .rk-mid { display: contents; }
.rk-edit.rk-full .rk-top button { min-width: 46px; width: 46px; height: 46px; padding: 0; background: rgba(14, 14, 15, .35); }
.rk-edit.rk-full .rk-top .rk-base { margin-left: auto; color: var(--rk-accent); }   /* 暗彩是定線的預設：圖示螢光綠、不鋪底 */
.rk-edit.rk-full .rk-top .rk-base[aria-pressed="true"] { color: #fff; }
.rk-edit.rk-full .rk-top .rk-heat[aria-pressed="true"], .rk-edit.rk-full .rk-top .rk-done { background: var(--rk-accent); color: var(--rk-on-accent); }   /* 開著的、完成：螢光綠 */
.rk-edit.rk-full .rk-top .rk-done:disabled { opacity: .35; }
.rk-fson .rk-fs { display: none !important; }
/* 下方：一整列類型（色點＋字，選中的鋪底色塊會滑過去），復原在上面一顆 */
.rk-bottom { position: absolute; bottom: max(14px, calc(env(safe-area-inset-bottom) + 6px)); left: max(8px, env(safe-area-inset-left)); right: max(8px, env(safe-area-inset-right)); margin: 0 auto; max-width: var(--rk-bottom-w, 520px); display: flex; flex-direction: column; align-items: stretch; gap: 6px; pointer-events: none; }
.rk-bottom > * { pointer-events: auto; }
.rk-undo { align-self: flex-end; min-width: 44px; height: 44px !important; padding: 0 !important; background: var(--rk-pill) !important; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.rk-types { position: relative; gap: 4px; padding: 5px; background: rgba(14, 14, 15, .6); }
.rk-types .rk-type { flex: 1 1 0; min-width: 0; height: 48px; padding: 0 6px; gap: 5px; position: relative; font-size: 14px; font-weight: 500; }
.rk-slide { position: absolute; top: 5px; bottom: 5px; left: 0; width: 0; border-radius: 999px; background: color-mix(in srgb, currentColor 22%, transparent); pointer-events: none; transition: left .22s, width .22s, color .22s; }
@media (prefers-reduced-motion: reduce) { .rk-slide { transition: none; } }
.rk-type i { width: 11px; height: 11px; flex: none; border-radius: 50%; background: var(--c); display: inline-grid; place-items: center; color: #0a0a0a; font: 700 8px/1 system-ui, sans-serif; font-style: normal; }
.rk-type span { opacity: .65; transition: opacity .15s; }
.rk-type[aria-pressed="true"] span { opacity: 1; font-weight: 700; }
.rk-type.limit { animation: rk-shake .35s; }
@keyframes rk-shake { 20%, 60% { transform: translateX(-3px); } 40%, 80% { transform: translateX(3px); } }
@media (prefers-reduced-motion: reduce) { .rk-type.limit { animation: none; outline: 2px solid var(--c); } }
.rk-type.free { opacity: .6; }
@media (max-width: 420px) { .rk-types .rk-type { gap: 3px; font-size: 12.5px; } }
@media (max-width: 300px) { .rk-ui button { min-width: 32px; height: 32px; padding: 0 7px; } .rk-type span { display: none; } }
.rk-nav { align-self: center; align-items: center; gap: 6px; padding: 4px; }
.rk-nav button { min-width: 44px; height: 44px; padding: 0; }
.rk-navcount { min-width: 64px; text-align: center; font-variant-numeric: tabular-nums; }
.rk-view .rk-types, .rk-view [data-rk="undo"] { display: none !important; }   /* 看路線圖：下面只有上一條、下一條 */
/* 順序列：現在的手數（插入中寫「第 N 手之後插入」）、結束插入；只在順序模式出現 */
.rk-order { position: absolute; left: 50%; transform: translateX(-50%); bottom: 120px; align-items: center; padding: 4px 4px 4px 14px; gap: 6px; }
.rk-ask { position: absolute; inset: 0; background: rgba(0, 0, 0, .55); display: flex; align-items: flex-end; justify-content: center; z-index: 5; }
.rk-askbox { width: min(100%, 420px); margin: 0 8px calc(8px + env(safe-area-inset-bottom)); display: grid; gap: 6px; }
.rk-ui .rk-askbox button { height: 48px; border-radius: 14px; background: #1c2320; color: #fff; font-size: 15px; }
.rk-ui .rk-askbox button.danger { color: #ff6b6b; }
.rk-askbox p { margin: 0 4px 2px; color: #cfd6d1; font: 600 14px/1.3 system-ui, sans-serif; }
`;
  const TEMPLATE = `
<div class="rk-top rk-pill" data-rk="top" hidden>
  <button data-rk="cancel" class="rk-cancel rk-only-edit">${ICON.cancel}</button>
  <span class="rk-slot" data-rk="slot-start"></span>
  <span class="rk-mid">
    <button data-rk="base" class="rk-base rk-only-full" aria-pressed="false">${ICON.base}</button>
    <button data-rk="heat" class="rk-heat rk-only-edit" aria-pressed="false">${ICON.heat}</button>
    <button data-rk="zout" class="rk-zout rk-only-full">${ICON.zout}</button>
    <button data-rk="zin" class="rk-zin rk-only-full">${ICON.zin}</button>
    <button data-rk="fs" class="rk-fs" aria-pressed="false">${ICON.fs}</button>
  </span>
  <span class="rk-slot" data-rk="slot-end"></span>
  <button data-rk="done" class="rk-done rk-only-edit">${ICON.done}</button>
</div>
<div class="rk-order rk-pill" data-rk="order" hidden><span data-rk="orderinfo"></span><button data-rk="orderend" hidden></button></div>
<div class="rk-ask" data-rk="ask" hidden><div class="rk-askbox" data-rk="askbox" role="dialog"></div></div>
<div class="rk-bottom" data-rk="bottom" hidden>
  <button data-rk="undo" class="rk-undo rk-only-edit" hidden>${ICON.undo}</button>
  <div class="rk-nav rk-pill" data-rk="nav" hidden>
    <button data-rk="prev" class="rk-prev">${ICON.prev}</button><span class="rk-navcount" data-rk="navcount"></span><button data-rk="next" class="rk-next">${ICON.next}</button>
  </div>
  <div class="rk-types rk-pill" data-rk="types">
    <i class="rk-slide" data-rk="slide"></i>
    ${TYPES.map((k) => `<button class="rk-type" data-type="${k}" aria-pressed="false" style="--c: var(--rk-${k})"><i>${k === 'n' ? '1' : ''}</i><span></span></button>`).join('')}
  </div>
</div>`;

  /**
   * 掛上操作介面。cfg：
   *   mode 'edit'｜'view'；lang 'zh'｜'en'；strings 覆蓋文字；base 'dim'｜'gray'；
   *   controls（有沒有按鈕，預設 true）、foot、order、heat（定線的腳點、順序、顯示所有岩點有沒有）、zoom（縮放鈕有沒有）、fullscreen（全畫面鈕有沒有）、
   *   top（有沒有上方那一列，預設 true；宿主自己有上方列時關掉）、nav（看路線圖：有沒有下面的上一條／下一條，預設 false，用 setNav 給序號）、
   interactive（false＝小畫面預覽：只有一顆進全螢幕的小圖示）、fullscreenOn（目前是不是全螢幕）、maxStart（給 onLimit 的 max）、colors（s、h、t、f 的顏色）、
   *   onDone()、onCancel()、onBase(next 'dim'｜'gray')、onFullscreen()、onLimit()、onPrev()、onNext()
   */
  function mount(host, cfg = {}) {
    const doc = host.ownerDocument;
    if (!doc.querySelector('style[data-rk-ui]')) { const st = doc.createElement('style'); st.dataset.rkUi = ''; st.textContent = CSS; (doc.head || doc.documentElement).append(st); }
    const o = { mode: 'edit', lang: 'zh', strings: {}, base: 'dim', controls: true, top: true, nav: false, foot: true, order: true, heat: true, zoom: true, fullscreen: false, interactive: true, fullscreenOn: false, colors: {}, ...cfg };
    const el = doc.createElement('div'); el.className = 'rk-ui'; el.innerHTML = TEMPLATE; host.append(el);
    const $ = (k) => el.querySelector(`[data-rk="${k}"]`), typeBtn = (k) => el.querySelector(`.rk-type[data-type="${k}"]`);
    let ctl = null, getRoute = () => null, pickedType = cfg.type && TYPES.includes(cfg.type) ? cfg.type : 's';
    const t = (k, ...a) => { let v = typeof cfg.t === 'function' ? cfg.t(k, ...a) : undefined; if (v !== undefined) return v; v = o.strings[k] !== undefined ? o.strings[k] : (STR[o.lang] || STR.zh)[k]; return typeof v === 'function' ? v(...a) : v; };
    const edit = () => o.mode === 'edit', route = () => getRoute() || { holds: {} };

    function applyText() {
      el.lang = o.lang === 'en' ? 'en' : 'zh-Hant';
      for (const k of ['cancel', 'base', 'heat', 'zout', 'zin', 'fs', 'done', 'undo', 'prev', 'next']) $(k).setAttribute('aria-label', t(k));
      $('orderend').textContent = t('orderEnd');
      for (const k of TYPES) { const b = typeBtn(k); b.setAttribute('aria-label', t(k)); b.querySelector('span').textContent = t(k); }
    }
    function applyColors() { for (const k of ['s', 'h', 't', 'f']) if (o.colors[k]) el.style.setProperty(`--rk-${k}`, o.colors[k]); }
    // 浮在畫面上的工具列蓋住的高度（上、下）：縮放時照片可以多拖那兩段，最上、最下的岩點拖得到工具列外面
    function pads(canvas) {
      const r = canvas.getBoundingClientRect(), covered = (k, side) => {
        const e = $(k); if (e.hidden) return 0;
        const b = e.getBoundingClientRect();
        return Math.max(0, side === 'top' ? b.bottom - r.top : r.bottom - b.top);
      };
      return [covered('top', 'top'), covered('bottom', 'bottom')];
    }
    // 切類型：色塊像一滴顏料流到新的按鈕——前緣先衝過去、拉長壓扁，後緣再跟上回彈；到了色點跳一下（減少動態時直接到位）
    const calm = () => !!(doc.defaultView && doc.defaultView.matchMedia && doc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches);
    let shownType = null;
    function slideTo(k, anim) {
      const btn = typeBtn(k), p = $('slide');
      if (!btn || btn.hidden || !btn.offsetWidth) return;
      const box = (b) => ({ left: `${b.offsetLeft}px`, width: `${b.offsetWidth}px`, x: b.offsetLeft, w: b.offsetWidth });
      const from = shownType && typeBtn(shownType), a = TYPES.indexOf(shownType), b = TYPES.indexOf(k);
      const fb = from && from.offsetWidth ? box(from) : null, tb = box(btn);
      p.style.color = getComputedStyle(btn).getPropertyValue('--c'); p.style.left = tb.left; p.style.width = tb.width;
      shownType = k;
      if (!anim || a < 0 || a === b || calm() || !fb || !p.animate) return;
      const right = b > a, ms = 280 + 30 * Math.abs(b - a), leadX = Math.min(fb.x, tb.x), leadW = Math.max(fb.x + fb.w, tb.x + tb.w) - leadX;
      const overW = Math.max(20, tb.w - 4);
      p.animate([
        { left: fb.left, width: fb.width, transform: 'scaleY(1)', easing: 'cubic-bezier(.5,0,.7,.4)' },
        { left: `${leadX}px`, width: `${leadW}px`, transform: 'scaleY(.82)', offset: .42, easing: 'cubic-bezier(.2,.7,.3,1)' },
        { left: `${right ? tb.x + 4 : tb.x}px`, width: `${overW}px`, transform: 'scaleY(1.08)', offset: .78, easing: 'ease-in-out' },
        { left: tb.left, width: tb.width, transform: 'scaleY(1)' },
      ], { duration: ms });
      const dot = btn.querySelector('i');
      if (dot && dot.animate) dot.animate([{ scale: 1, rotate: '0deg' }, { scale: 1, rotate: '0deg', offset: .35 }, { scale: 1.5, rotate: right ? '14deg' : '-14deg', offset: .6 }, { scale: .9, rotate: right ? '-6deg' : '6deg', offset: .82 }, { scale: 1, rotate: '0deg' }], { duration: ms + 120, easing: 'ease-out' });
    }
    function update(anim) {
      el.classList.toggle('rk-full', !!o.interactive); el.classList.toggle('rk-edit', edit()); el.classList.toggle('rk-fson', !!o.fullscreenOn);
      el.classList.toggle('rk-view', !edit());
      $('top').hidden = !o.controls || !o.top;
      $('nav').hidden = !(o.nav && !edit());
      $('bottom').hidden = !(o.controls && o.interactive && ((edit() && ctl) || (!edit() && o.nav)));
      $('base').setAttribute('aria-pressed', String(o.base === 'gray'));
      $('fs').setAttribute('aria-pressed', String(!!o.fullscreenOn));
      $('fs').hidden = !o.fullscreen;
      for (const k of ['zin', 'zout']) $(k).hidden = !o.zoom;
      if (!edit() || !ctl) return;
      const r = route(), n = (x) => Object.values(r.holds).filter((v) => v === x).length;
      $('done').disabled = !(n('s') && n('t'));   // 跟岩點貓一樣：有起攀也有完攀才能完成
      typeBtn('f').hidden = !o.foot; typeBtn('n').hidden = !o.order;
      if (ctl.type !== undefined && typeBtn(ctl.type).hidden) pickType('s');   // 選著的類型被關掉了：回到起攀
      const cur = ctl.type !== undefined ? ctl.type : pickedType;
      for (const x of TYPES) typeBtn(x).setAttribute('aria-pressed', String(x === cur));
      const u = $('undo'); u.hidden = !(ctl.type === 'n'); u.disabled = !ctl.canUndoSeq;
      const free = !!r.feetFree, fb = typeBtn('f'); fb.querySelector('span').textContent = free ? t('feetFree') : t('f'); fb.classList.toggle('free', free);
      paintOrder();
      $('heat').hidden = !(edit() && o.heat);
      $('heat').setAttribute('aria-pressed', String(!!ctl.showAll));
      slideTo(cur, anim);
    }
    // 看路線圖的路線切換：index 從 0 起、total 條；total 少於 2 條就不顯示
    let navInfo = { index: 0, total: 0 };
    function paintNav() {
      $('navcount').textContent = navInfo.total ? `${navInfo.index + 1} / ${navInfo.total}` : '';
      $('prev').disabled = navInfo.index <= 0; $('next').disabled = navInfo.index >= navInfo.total - 1;
    }
    function paintOrder() {
      const bar = $('order'), c = ctl;
      if (!c || !c.orderInfo || !edit()) { bar.hidden = true; return; }
      const i = c.orderInfo;
      bar.hidden = !(o.controls && o.interactive && c.type === 'n');
      $('orderinfo').textContent = i.insertAt !== null ? (i.insertAt ? t('orderAt', i.insertAt) : t('orderFirst')) : (i.len ? t('orderCount', i.len) : t('orderHint'));
      $('orderend').hidden = i.insertAt === null;
      if (!bar.hidden) bar.style.bottom = `${Math.round(host.getBoundingClientRect().bottom - $('bottom').getBoundingClientRect().top + 8)}px`;   // 疊在類型列上面
      $('undo').disabled = !i.canUndo;
    }
    function pickType(k, fromRule, anim = true) {
      pickedType = k;
      if (!fromRule && ctl && ctl.setType) ctl.setType(k);   // 規則自動換的（起攀滿了），控制器已經換好了
      for (const x of TYPES) typeBtn(x).setAttribute('aria-pressed', String(x === k));
      update(anim);
    }
    // 底部的選單（不用瀏覽器的對話框：iframe 裡可能被擋）：title 一行說明，items＝[{ label, danger?, run }]
    function ask(title, items) {
      const box = $('askbox'); box.replaceChildren();
      if (title) { const p = doc.createElement('p'); p.textContent = title; box.append(p); }
      for (const it of [...items, { label: t('cancel') }]) {
        const b = doc.createElement('button'); b.textContent = it.label; if (it.danger) b.className = 'danger';
        b.onclick = () => { $('ask').hidden = true; if (it.run) it.run(); };
        box.append(b);
      }
      $('ask').hidden = false;
    }
    $('ask').addEventListener('click', (e) => { if (e.target === $('ask')) $('ask').hidden = true; });
    // 順序模式長按有編號的岩點：在它最後一個編號之後插入，或刪掉它的某一手
    function askOrder({ nums }) {
      ask(null, [...(nums[0] === 1 ? [{ label: t('orderFirst'), run: () => ctl.orderInsertAfter(0) }] : []), { label: t('orderAt', nums[nums.length - 1]), run: () => ctl.orderInsertAfter(nums[nums.length - 1]) },
        ...nums.map((n) => ({ label: t('delMove', n), danger: true, run: () => ctl.orderRemove(n) }))]);
    }
    // 不限腳：長按腳點切換；路線上已經有腳點時，開了會清掉，問過才開
    function toggleFeetFree() {
      if (!ctl || !ctl.toggleFeetFree) return;
      const r = ctl.toggleFeetFree();
      if (r === 'confirm') ask(t('feetAsk'), [{ label: t('feetGo'), danger: true, run: () => { ctl.toggleFeetFree({ clear: true }); update(); } }]);
      else update();
    }
    function flash() {   // 起攀按鈕抖一下
      const b = typeBtn('s');
      b.classList.remove('limit'); void b.offsetWidth; b.classList.add('limit');
    }

    // ---- 按鈕 ----
    $('cancel').onclick = () => cfg.onCancel && cfg.onCancel();
    $('done').onclick = () => { if (!$('done').disabled && cfg.onDone) cfg.onDone(); };
    $('base').onclick = () => { const next = o.base === 'gray' ? 'dim' : 'gray'; if (cfg.onBase) cfg.onBase(next); else { o.base = next; if (ctl && ctl.setMode) ctl.setMode(next); update(); } };
    $('fs').onclick = () => cfg.onFullscreen && cfg.onFullscreen();
    $('prev').onclick = () => { if (cfg.onPrev) cfg.onPrev(); };
    $('next').onclick = () => { if (cfg.onNext) cfg.onNext(); };
    $('undo').onclick = () => { if (ctl && ctl.undoSeq) { ctl.undoSeq(); update(); } };
    $('heat').onclick = () => { if (!ctl || !ctl.setShowAll) return; ctl.setShowAll(!ctl.showAll); update(); };
    $('orderend').onclick = () => { if (ctl) ctl.orderEndInsert(); };
    $('zin').onclick = () => ctl && ctl.zoomStep && ctl.zoomStep(1);
    $('zout').onclick = () => ctl && ctl.zoomStep && ctl.zoomStep(-1);
    for (const b of el.querySelectorAll('.rk-type')) b.onclick = () => {
      if (!ctl || !edit()) return;
      const ty = b.dataset.type;
      if (ty === 'f' && route().feetFree) return;   // 不限腳：不能選腳點（長按切回指定腳點）
      if (ty === 'n' && ctl.type === 'n') {   // 已經在順序模式又按一次：問要不要清除這條路線的順序
        if (route().seq) ask(t('seqAsk'), [{ label: t('seqClear'), danger: true, run: () => { ctl.orderClear(); update(); } }]);
        return;
      }
      pickType(ty);
    };
    { // 長按腳點：不限腳
      const fb = typeBtn('f'); let timer = 0;
      const stop = () => { clearTimeout(timer); timer = 0; };
      fb.addEventListener('pointerdown', () => { stop(); delete fb.dataset.held; timer = setTimeout(() => { timer = 0; fb.dataset.held = '1'; toggleFeetFree(); }, 520); });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) fb.addEventListener(ev, stop);
      fb.addEventListener('click', (e) => { if (fb.dataset.held) { delete fb.dataset.held; e.stopImmediatePropagation(); } }, true);
    }
    const onResize = () => { if (shownType) { const k = shownType; shownType = null; slideTo(k, false); } };
    (doc.defaultView || window).addEventListener('resize', onResize);

    applyText(); applyColors(); paintNav();
    for (const x of TYPES) typeBtn(x).setAttribute('aria-pressed', String(x === pickedType));
    update();

    return {
      el,
      /** 給 RouteEditor 的回呼：規則自動換了類型、順序有變、要問順序、起攀滿了 */
      hooks: { onType: (k) => pickType(k, true), onOrder: () => paintOrder(), onOrderAsk: (m) => askOrder(m), onLimit: () => { flash(); if (cfg.onLimit) cfg.onLimit(); } },
      attach(controller, routeGetter) { ctl = controller; getRoute = routeGetter || (() => null); update(); },
      detach() { ctl = null; getRoute = () => null; update(); },
      update: (anim) => update(!!anim),
      refreshText: applyText,
      /** 宿主的元素放進上方列：start＝取消鈕右邊（例如難度）、end＝完成鈕左邊（例如刪除路線） */
      slot(where, node) { $(where === 'end' ? 'slot-end' : 'slot-start').append(node); },
      /** 看路線圖的路線切換：目前第幾條（從 0 起）、共幾條 */
      setNav(info) { navInfo = { index: info.index, total: info.total }; paintNav(); },
      pads,
      pickType,
      get type() { return pickedType; },
      setOptions(n = {}) {
        for (const k of ['mode', 'base', 'controls', 'top', 'nav', 'foot', 'order', 'heat', 'zoom', 'fullscreen', 'interactive', 'fullscreenOn']) if (k in n) o[k] = n[k];
        if (n.lang === 'zh' || n.lang === 'en') { o.lang = n.lang; applyText(); }
        if (n.strings) { o.strings = n.strings; applyText(); }
        if (n.colors) { o.colors = n.colors; applyColors(); }
        update();
      },
      destroy() { (doc.defaultView || window).removeEventListener('resize', onResize); el.remove(); },
    };
  }

  return { EditorUI: { mount, STR, TYPES } };
});
