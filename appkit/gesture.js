// AppKit gesture：手勢的共用小工具。目前只有長按：按住不動 0.45 秒呼叫 onHold，手指移動就當作捲動；長按後放開的那個 click 不往下傳。
// 瀏覽器用 <script> 載入，掛在全域 AppKit.gesture；Node 用 require（只是載入，用到的函式要在瀏覽器裡）。
// English: AppKit gesture: long-press detection (hold still 450 ms, moving cancels, the click after a hold is swallowed).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.AppKit || (root.AppKit = {})).gesture = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * 長按：target 是接收 pointerdown 的容器；item 是容器裡的項目選擇器（沒給就是 target 本身），onHold(項目) 在按滿 ms 時呼叫。
   * 按下後移動超過 slop 像素、放開、取消都不算；長按之後放開的那個 click 會被攔下來，不會打開項目；長按時不出現系統選單（contextmenu）。
   * vibrate：震動毫秒數（0 不震）；rightClick：滑鼠右鍵也呼叫 onHold。
   */
  function longPress(target, { item = '', onHold, ms = 450, slop = 8, vibrate = 12, rightClick = false }) {
    let press = null, held = false;
    target.addEventListener('pointerdown', (e) => {
      held = false;
      const el = item ? e.target.closest(item) : target;
      if (!el || press || (e.pointerType === 'mouse' && e.button !== 0)) return;
      press = {
        id: e.pointerId, sx: e.clientX, sy: e.clientY,
        timer: setTimeout(() => { press = null; held = true; if (vibrate && navigator.vibrate) navigator.vibrate(vibrate); onHold(el); }, ms),
      };
    });
    const end = () => { if (press) { clearTimeout(press.timer); press = null; } };
    window.addEventListener('pointermove', (e) => { if (press?.id === e.pointerId && Math.hypot(e.clientX - press.sx, e.clientY - press.sy) > slop) end(); });
    window.addEventListener('pointerup', (e) => { if (press?.id === e.pointerId) end(); });
    window.addEventListener('pointercancel', (e) => { if (press?.id === e.pointerId) end(); });
    // 長按時不出現系統選單；rightClick：滑鼠右鍵直接開同一份動作（觸控的長按照樣只走計時器，避免重複打開）
    target.addEventListener('contextmenu', (e) => {
      const el = item ? e.target.closest(item) : target;
      if (!el) return;
      e.preventDefault();
      if (rightClick && !held && (e.pointerType === 'mouse' || (!e.pointerType && e.button === 2 && matchMedia('(hover: hover) and (pointer: fine)').matches))) onHold(el);
    });
    target.addEventListener('click', (e) => { if (held) { e.stopPropagation(); e.preventDefault(); held = false; } }, true);
  }

  return { longPress };
});
