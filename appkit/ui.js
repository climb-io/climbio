// AppKit ui：對話框（確認、提示、輸入、選項、表單）與提示（toast）。不用瀏覽器的 confirm／alert／prompt。
// 樣子在 appkit/ui.css（顏色取自 css/brand-tokens.css）；按鈕用 App 自己的 .btn（.primary、.danger-fill）。
// 文字用共用名詞（AppKit.i18n 的 common 語言包：btnOk、cancel），沒載入時是 key 本身。
// 瀏覽器用 <script> 載入，掛在全域 AppKit.ui。
// English: AppKit ui: app dialogs (confirm, alert, prompt, choices, fields) and toast; styles in appkit/ui.css.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.AppKit || (root.AppKit = {})).ui = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const T = (k) => (root && root.AppKit && root.AppKit.i18n ? root.AppKit.i18n.t(k) : k);
  const opts = { backStack: null };
  /**
   * backStack：App 有自己的返回紀錄時接上（例如 Android 的返回鍵先關對話框）。
   * open(id, onBack) 打開時呼叫，返回時呼叫 onBack；close(id) 關掉時呼叫，回傳 Promise（退完那一層才算關好）
   */
  function configure(o) { Object.assign(opts, o); }

  const DIALOG_ID = 'ak-dialog';
  let current = null;   // 打開中的對話框：{ el, finish }
  const make = (tag, className, text) => {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  };

  /**
   * 對話框。title：粗體標題；text：內文（保留換行）；fields：[{ name, label, value, type, options: [[值, 文字]], placeholder, max, required }]；
   * choices：[{ label, value, danger }]（一列一個選項，點了就關）；body：自己的元素；buttons：[{ label, value, primary, danger }]，value 空的是取消。
   * 回傳 { button, values }（values 是去掉頭尾空白的欄位）；取消（取消鍵、Esc、點外面、返回）是 undefined。
   * 同時只有一個：再開新的，舊的當成取消。
   */
  function ask({ title = '', text = '', fields = [], choices, body = [], buttons = [{ label: T('cancel') }, { label: T('btnOk'), value: 'ok', primary: true }], role = 'dialog' }) {
    if (current) current.finish(undefined, true);   // 換成新的一個：沿用同一層返回紀錄
    const d = make('dialog', 'ak-dialog');
    d.setAttribute('role', role);
    const form = make('form', 'ak-card');
    form.noValidate = true;
    if (title) { const h = make('b', 'ak-title', title); h.id = 'ak-title'; form.append(h); d.setAttribute('aria-labelledby', h.id); }
    if (text) form.append(make('p', 'ak-text', text));
    const inputs = {};
    for (const f of fields) {
      const input = make(f.options ? 'select' : 'input', 'field');
      if (f.options) for (const [v, label] of f.options) input.append(new Option(label, v, false, v === f.value));
      else Object.assign(input, { type: f.type || 'text', value: f.value ?? '', placeholder: f.placeholder || '', autocomplete: 'off' });
      if (f.max) input.maxLength = f.max;
      input.name = f.name;
      inputs[f.name] = input;
      if (f.label) { const l = make('label', 'ak-field', f.label); l.append(input); form.append(l); } else form.append(input);
    }
    form.append(...body);
    const finish = (button, now) => {
      if (current !== state) return;
      current = null;
      const values = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value.trim()]));
      d.close(); d.remove();
      const result = button == null ? undefined : { button, values };
      if (!opts.backStack || now) return state.resolve(result);
      opts.backStack.close(DIALOG_ID).then(() => state.resolve(result));
    };
    const choose = (b) => {
      const empty = b.primary && fields.find(f => f.required && !inputs[f.name].value.trim());
      if (empty) return inputs[empty.name].focus();   // 必填的空著：不關，回到那一格
      finish(b.value || null);
    };
    if (choices) {
      const list = make('div', 'ak-list');
      for (const c of choices) {
        const b = make('button', c.danger ? 'danger' : '', c.label);
        b.type = 'button';
        b.onclick = () => finish(c.value);
        list.append(b);
      }
      form.append(list);
    }
    const row = make('div', 'ak-actions');
    for (const b of buttons) {
      const el = make('button', 'btn' + (b.primary ? ' primary' : b.danger ? ' danger-fill' : ''), b.label);
      el.type = b.primary ? 'submit' : 'button';
      if (b.value) el.value = b.value;
      el.onclick = (e) => { e.preventDefault(); choose(b); };
      row.append(el);
    }
    if (buttons.length) form.append(row);
    form.onsubmit = (e) => { e.preventDefault(); const p = buttons.find(b => b.primary); if (p) choose(p); };
    d.append(form);
    d.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    d.addEventListener('click', (e) => { if (e.target === d) finish(null); });   // 點外面（卡片以外的遮罩）
    d.addEventListener('keydown', (e) => e.stopPropagation());   // 打字不觸發 App 的快捷鍵
    const state = { finish };
    current = state;
    document.body.append(d);
    d.showModal();
    if (opts.backStack) opts.backStack.open(DIALOG_ID, () => finish(null, true));
    const first = Object.values(inputs)[0] || form.querySelector('.ak-actions .primary, .ak-actions .danger-fill');
    // 晚一點再把焦點放到第一格；這段時間使用者已經點了對話框裡別的欄位就不搶回來（不然打的字會跑進第一格）
    if (first) setTimeout(() => {
      const a = document.activeElement;
      if (current === state && !(d.contains(a) && a !== d && a !== first)) first.focus();
    }, 50);
    return new Promise((resolve) => { state.resolve = resolve; });
  }

  /** 關掉打開中的對話框（當成取消），例如對話框裡的清單點了直接去別的地方 */
  function close() { if (current) current.finish(null); }

  /** 確認：回傳 true／false。title 有的話是粗體標題、message 是說明；danger：紅色按鈕（刪除）；cancel: false 只有一個按鈕 */
  async function confirm(message, { title = '', ok = T('btnOk'), danger = false, cancel = true } = {}) {
    const r = await ask({
      title, text: message, role: 'alertdialog',
      buttons: [...(cancel ? [{ label: T('cancel') }] : []), { label: ok, value: 'ok', primary: !danger, danger }],
    });
    return !!r;
  }
  /** 提示：只有一個「確定」 */
  const alert = (message, o = {}) => confirm(message, { ...o, cancel: false });
  /** 輸入一行文字：回傳去掉頭尾空白的文字，取消回傳 null；allowEmpty：可以留空送出 */
  async function prompt({ title, value = '', placeholder = '', ok = T('btnOk'), max = 60, allowEmpty = false }) {
    const r = await ask({ title, fields: [{ name: 'v', value, placeholder, max, required: !allowEmpty }], buttons: [{ label: T('cancel') }, { label: ok, value: 'ok', primary: true }] });
    return r ? r.values.v : null;
  }

  // ---- 提示（toast）：畫面下方一行，幾秒後淡掉；busy 轉圈不自動消失；action＝{ label, run } 右邊多一顆按鈕（例如「復原」），顯示 5 秒 ----
  let toastEl = null, toastTimer = 0;
  function toastBox() {
    if (toastEl) return toastEl;
    toastEl = make('div', 'ak-toast fade');
    toastEl.setAttribute('role', 'status');
    toastEl.append(make('span', 'ak-spin'), make('span', 'ak-toast-text'), make('button', 'ak-toast-act'));
    toastEl.querySelector('.ak-toast-act').type = 'button';
    document.body.append(toastEl);
    return toastEl;
  }
  function hideToast() { clearTimeout(toastTimer); if (toastEl) toastEl.classList.add('fade'); }
  function toast(text, { busy = false, action = null, ms = action ? 5000 : 2600 } = {}) {
    const box = toastBox(), act = box.querySelector('.ak-toast-act');
    box.querySelector('.ak-toast-text').textContent = text;
    box.querySelector('.ak-spin').hidden = !busy;
    act.hidden = !action;
    if (action) { act.textContent = action.label; act.onclick = () => { hideToast(); action.run(); }; }
    box.classList.remove('fade');
    clearTimeout(toastTimer);
    if (!busy) toastTimer = setTimeout(hideToast, ms);
  }

  // ---- 進度條：畫面頂端一條浮著的膠囊（文字＋進度條），不擋畫面；備份、復原、下載這類要等的事共用 ----
  // const p = progress('正在備份…'); p.update('打包中…', 0.4)（frac 不給＝來回跑的條）; p.done('備份已建立', { action: { label, run } }); p.fail('失敗：…')
  let progBox = null, progTimer = 0;
  function progress(text, frac = null) {
    if (!progBox) {
      progBox = make('div', 'ak-prog fade'); progBox.setAttribute('role', 'status');
      const row = make('div', 'ak-prog-row'), bar = make('i'); bar.append(make('b'));
      row.append(make('span', 'ak-prog-ico'), make('span', 'ak-prog-text'), make('button', 'ak-prog-act'));
      progBox.append(row, bar); progBox.querySelector('.ak-prog-act').type = 'button';
      document.body.append(progBox);
    }
    const box = progBox, t = box.querySelector('.ak-prog-text'), b = box.querySelector('.ak-prog b'), act = box.querySelector('.ak-prog-act');
    const set = (txt, f) => { t.textContent = txt; box.classList.toggle('indet', f == null); if (f != null) b.style.width = `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`; };
    clearTimeout(progTimer); box.classList.remove('done', 'bad', 'fade'); act.hidden = true; b.style.width = '0'; set(text, frac);
    const end = (txt, cls, action, ms) => {
      box.classList.remove('indet'); box.classList.add(cls); t.textContent = txt; b.style.width = '100%';
      act.hidden = !action; if (action) { act.textContent = action.label; act.onclick = () => { box.classList.add('fade'); action.run(); }; }
      progTimer = setTimeout(() => box.classList.add('fade'), ms);
    };
    return { update: set, done: (txt, { action = null, ms = action ? 6000 : 3500 } = {}) => end(txt, 'done', action, ms), fail: (txt) => end(txt, 'bad', null, 6000), hide: () => { clearTimeout(progTimer); box.classList.add('fade'); } };
  }

  // 手機鍵盤彈出時，對話框只佔看得到的範圍（iOS 的鍵盤不會縮小版面，只縮 visualViewport）：載入時就跟著，寫進 :root 的 --vv-top／--vv-h（ui.css 用）
  const vv = root && root.visualViewport;
  if (vv && root.document) {
    const style = root.document.documentElement.style;
    const fit = () => { style.setProperty('--vv-top', `${vv.offsetTop}px`); style.setProperty('--vv-h', `${vv.height}px`); };
    vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); fit();
  }

  /** 建一個 SVG 元素（attrs 逐一設成屬性） */
  const svg = (tag, attrs = {}) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };
  /** 使用者要求減少動態（系統設定） */
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  return { configure, ask, close, confirm, alert, prompt, toast, hideToast, progress, svg, reducedMotion };
});
