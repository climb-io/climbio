// AppKit update：「有新版本　更新」提示條與回到前景時的檢查節奏，岩點貓、紅點貓共用。
// - create({ host, apply })：建一條（預設隱藏）提示條；host 是放進去的容器，不給就浮在畫面下方；按「更新」後按鈕轉圈，apply() 結束（通常是重新載入）
// - watch(fn)：回到前景、恢復網路時呼叫 fn（間隔至少 1 分鐘），App 在 fn 裡自己問「有沒有新版」
// - 提示文字在共用語言包（updateAvailable、update）；樣式在 appkit/ui.css（.ak-update）
// English: AppKit update: shared "new version — Update" bar and the foreground/online re-check cadence.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.AppKit || (root.AppKit = {})).update = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const t = (k, fallback) => { const v = typeof AppKit !== 'undefined' && AppKit.i18n ? AppKit.i18n.t(k) : k; return v === k ? fallback : v; };
  const ICON = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>';

  /** 提示條：回傳 { el, show(), hide() }；按「更新」呼叫 apply（可以是 async）；apply 丟錯就恢復按鈕 */
  function create({ host = null, apply }) {
    const el = document.createElement('div');
    el.className = 'ak-update' + (host ? '' : ' float');
    el.id = 'updateBar'; el.setAttribute('role', 'status'); el.hidden = true;
    el.innerHTML = `${ICON}<span></span><button type="button" id="updateBtn"></button>`;
    const text = el.querySelector('span'), btn = el.querySelector('button');
    const label = () => { text.textContent = t('updateAvailable', '有新版本'); btn.textContent = t('update', '更新'); };
    label();
    btn.onclick = async () => {
      btn.classList.add('busy');
      try { await apply(); } catch (e) { btn.classList.remove('busy'); }
    };
    (host || document.body).append(el);
    return { el, show() { label(); el.hidden = false; }, hide() { el.hidden = true; btn.classList.remove('busy'); } };
  }

  /** 回到前景、恢復網路時呼叫 fn；兩次之間至少 minGap 毫秒（預設 1 分鐘）。回傳取消函式 */
  function watch(fn, { minGap = 60000 } = {}) {
    let last = Date.now();
    const run = () => {
      if (document.visibilityState !== 'visible' || (typeof navigator !== 'undefined' && !navigator.onLine) || Date.now() - last < minGap) return;
      last = Date.now();
      fn();
    };
    document.addEventListener('visibilitychange', run);
    window.addEventListener('online', run);
    return () => { document.removeEventListener('visibilitychange', run); window.removeEventListener('online', run); };
  }

  return { create, watch };
});
