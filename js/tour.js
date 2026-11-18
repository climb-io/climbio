// 真實 App 的單次情境提示。舊教學動畫已移除，不讀取示範牆。
'use strict';
  const TIP_KEY = (name) => `climbio.tip.${name}`;
  const tourReset = () => { for (const n of Object.keys(TIPS)) { try { localStorage.removeItem(TIP_KEY(n)); } catch (e) { /* 不支援儲存 */ } } tipWatch(); };
  // ---------- 小人提示（真實 App）：只在適合的操作畫面顯示一次 ----------
  // 不強迫、各只出現一次（記在這台）；使用者停手 2.5 秒、而且這個畫面已經待了一下才出來，正在操作時不打擾；
  // 一碰畫面就收起來，6 秒後也自己收；播示範、開著選單或對話框時不出現。小人站在右下「＋」的左上，泡泡指著「＋」
  const onWall = () => !$('wall').hidden && $('editor').hidden && !!$('wallFabBtn').offsetParent;   // 「＋」的外框是 fixed，offsetParent 永遠是 null，看裡面的按鈕
  const onView = () => !$('editor').hidden && state.mode === 'route' && state.routeView && !!$('vwFab').offsetParent && $('vwFab').getAttribute('aria-expanded') !== 'true';
  const TIPS = {
    wallPlus: { when: () => onWall() && tipSeenView, text: 'tipWallPlus', at: () => $('wallFabBtn') },   // 看完路線回到牆面頁：按＋自己出線
  };
  let tipLast = performance.now(), tipOn = null, tipSince = { key: '', t: 0 }, tipSeenView = false;
  const tipBusy = () => HoldCat.active() || !!document.querySelector('.sheet-backdrop:not([hidden]), .guide-backdrop:not([hidden]), .ak-dialog[open], #shareDialog:not([hidden]), #recvPage:not([hidden]), #landing:not([hidden]), #homeMenu:not([hidden]), #scan:not([hidden])');
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'scroll']) addEventListener(ev, () => { tipLast = performance.now(); if (tipOn) tipHide(); }, { capture: true, passive: true });
  function tipShow(name) {
    const d = TIPS[name], el = $('appTip'), a = d.at().getBoundingClientRect();
    lsSet(TIP_KEY(name), true);
    $('appTipText').textContent = t(d.text);
    Object.assign(el.style, { right: `${Math.max(12, innerWidth - a.right)}px`, bottom: `${innerHeight - a.top + 10}px` });
    el.hidden = false; el.classList.remove('bye');
    tipOn = { name, timer: setTimeout(tipHide, 6000) };
  }
  function tipHide() {
    if (!tipOn) return;
    clearTimeout(tipOn.timer); tipOn = null;
    const el = $('appTip'); el.classList.add('bye');
    setTimeout(() => { if (!tipOn) el.hidden = true; }, 300);
  }
  // 提示都出現過就停掉計時器（tourReset 清掉已讀時再開）
  let tipTimer = 0;
  function tipWatch() { if (!tipTimer) tipTimer = setInterval(tipTick, 500); }
  function tipTick() {
    if (onView()) tipSeenView = true;
    if (tipOn) { if (!TIPS[tipOn.name].when() || tipBusy()) tipHide(); return; }
    if (Object.keys(TIPS).every(n => lsGet(TIP_KEY(n), false))) { clearInterval(tipTimer); tipTimer = 0; return; }
    const name = Object.keys(TIPS).find(n => !lsGet(TIP_KEY(n), false) && TIPS[n].when());
    if (name !== tipSince.key) tipSince = { key: name || '', t: performance.now() };   // 剛換到這個畫面：先讓人看一下
    const now = performance.now();
    if (!name || tipBusy() || now - tipLast < 2500 || now - tipSince.t < 2500) return;
    tipShow(name);
  }
  tipWatch();
