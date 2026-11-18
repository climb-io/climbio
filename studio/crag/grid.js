// 路線表格的操作：點一下格子就編輯（放開時；拖過別格或 Shift 是選一塊）；長按（或點編號那格）選整列（按著拖換位置由 app.js 的 SortableJS 做）；
// Enter 存了往下、Tab 往右、Esc 取消、Alt＋Enter 換行；沒在編輯時方向鍵移動、直接打字蓋掉、Delete 清空；
// Ctrl＋C／V 複製貼上（Tab 分隔，跟 Google 試算表互通；編輯中貼上多格也一樣）；Ctrl＋D 用第一列往下填；Ctrl＋Z 復原；Alt＋↑↓ 把選到的列往上、往下移。
// 畫面由 app.js 畫：每面岩壁一個 tbody[data-wall]，每列 tr[data-row]（路線 id，或 add:<岩壁 id> 是最後一列「新增路線」），每格 td[data-k]。
// 改的內容一次交給 apply([{ row, k, text }])，畫面重畫後 App 呼叫 paint() 把選取、編輯框放回去。
import { parseTable } from './table.js';

const T = (...a) => globalThis.AppKit.i18n.t(...a);

export class Grid {
  /** root：表格所在的捲動區；h：{ off()（true 時不當試算表編輯，例如手機）、keys()（顯示的欄位）、text(row, k)、apply(changes)、undo() } */
  constructor(root, h) {
    this.root = root; this.h = h;
    this.at = null; this.anchor = null; this.editing = false; this.before = '';
    this.input = Object.assign(document.createElement('textarea'), { className: 'grid-input', spellcheck: false, rows: 1, ariaLabel: T('cgCell') });
    this.input.wrap = 'off';
    this.input.addEventListener('keydown', (e) => this.key(e));
    this.input.addEventListener('input', () => { if (!this.editing) this.edit(false, this.input.value); else { this.grow(); this.renderPick(); } });
    this.input.addEventListener('compositionstart', () => { if (!this.editing) this.edit(false, ''); });
    this.input.addEventListener('copy', (e) => { if (this.editing) return; e.preventDefault(); e.clipboardData.setData('text/plain', this.copyText()); });
    this.input.addEventListener('cut', (e) => { if (this.editing) return; e.preventDefault(); e.clipboardData.setData('text/plain', this.copyText()); this.clear(); });
    this.input.addEventListener('paste', (e) => {
      const t = e.clipboardData.getData('text/plain');
      if (this.editing && !/[\t\n]/.test(t.trim())) return;   // 一格的字：照常貼進輸入框
      e.preventDefault();
      if (this.editing) { this.editing = false; this.closePick(); }
      this.paste(t);
    });
    // 存檔後表格重畫會把輸入框拿下來再放回去：那時的 blur 不算離開（不然剛打的字會被當成一次存檔）
    this.input.addEventListener('blur', () => { if (this.editing && this.input.isConnected && !this.moving) this.commit(null); });
    root.addEventListener('mousedown', (e) => this.down(e));
    root.addEventListener('mouseover', (e) => {
      if (!this.dragging || !(e.buttons & 1)) return;
      const p = this.posOf(e.target);
      if (p && (p.row !== this.at?.row || p.k !== this.at?.k)) { this.cancelHold(); this.at = p; this.paint(); }   // 拖過別格：選一塊
    });
    document.addEventListener('mousemove', (e) => { const p = this.press; if (p && !p.held && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6) this.cancelHold(); });
    document.addEventListener('mouseup', () => this.up());
    // 選單跟著格子（捲動時）
    root.addEventListener('scroll', () => this.placePick(), { passive: true });
    window.addEventListener('resize', () => this.placePick());
  }

  /** 看得到的列（搜尋藏起來的不算） */
  rows() { return [...this.root.querySelectorAll('tr[data-row]')].filter(r => !r.hidden && !r.closest('[hidden]')); }
  /** 選取範圍裡的路線 id */
  selectedRows() {
    if (!this.at || !this.anchor) return [];
    const [r0, r1] = this.range();
    return r0 < 0 ? [] : this.rows().slice(r0, r1 + 1).map(r => r.dataset.row).filter(x => !x.startsWith('add:'));
  }
  cell(p) { return p && this.root.querySelector(`tr[data-row="${CSS.escape(p.row)}"] td[data-k="${p.k}"]`); }
  posOf(target) {
    const td = target.closest?.('td[data-k]');
    return td && this.root.contains(td) ? { row: td.parentElement.dataset.row, k: td.dataset.k } : null;
  }
  /** 新增路線的那列只能填名稱 */
  editable(p) { return !p.row.startsWith('add:') || p.k === 'name'; }

  down(e) {
    const num = e.target.closest?.('td.num');
    let p = this.posOf(e.target);
    if (!p && num && this.root.contains(num)) p = { row: num.parentElement.dataset.row, k: this.h.keys()[0] };
    if (!p || e.button !== 0 || this.h.off?.()) return;
    if (this.editing && !num && p.row === this.at?.row && p.k === this.at?.k) return;   // 編輯中的格子：照常點（移游標）
    e.preventDefault();
    const prev = this.selectedRows();
    if (this.editing) this.commit(null);
    this.at = p;
    if (!e.shiftKey || !this.anchor) this.anchor = p;
    this.dragging = !num;
    this.press = { x: e.clientX, y: e.clientY, shift: e.shiftKey, prev, row: p.row };
    this.paint();
    if (num) this.hold();
    else this.press.timer = setTimeout(() => this.hold(), 450);
  }
  cancelHold() { if (this.press && !this.press.held) { clearTimeout(this.press.timer); this.press.timer = null; this.press.moved = true; } }
  /** 長按：選整列（按的那列在原本選的範圍裡，就是那幾列；接著拖就一起搬） */
  hold() {
    const p = this.press;
    if (!p) return;
    p.held = true;
    this.dragging = false;
    const keys = this.h.keys(), ids = this.rows().map(r => r.dataset.row);
    const [a, b] = p.prev.length > 1 && p.prev.includes(p.row) ? [p.prev[0], p.prev.at(-1)] : [p.shift ? this.anchor.row : p.row, p.row];
    const [i, j] = [ids.indexOf(a), ids.indexOf(b)];
    this.anchor = { row: ids[Math.min(i, j)], k: keys[0] };
    this.at = { row: ids[Math.max(i, j)], k: keys.at(-1) };
    this.paint(false);   // 選整列不捲動（不然按著的地方會跑掉）
  }
  /** 放開：沒長按、沒拖過別格、沒按 Shift，就是點一下：編輯這格 */
  up() {
    const p = this.press;
    this.press = null;
    this.dragging = false;
    if (!p) return;
    clearTimeout(p.timer);
    if (!p.held && !p.moved && !p.shift && this.at && this.at.row === p.row) this.edit(true);
  }

  /** 把選取、編輯框放回畫面上（重畫之後也呼叫）；選到的列不見了就取消 */
  paint(scroll = true) {
    for (const td of this.root.querySelectorAll('td.cur, td.in')) td.classList.remove('cur', 'in');
    if (this.at && (!this.cell(this.at) || !this.rows().some(r => r.dataset.row === this.at.row))) { this.at = this.anchor = null; this.editing = false; }
    if (!this.editing) this.closePick();
    this.h.selected?.();
    if (!this.at) { this.input.remove(); return; }
    const [r0, r1, k0, k1] = this.range();
    const rows = this.rows(), keys = this.h.keys();
    for (let i = r0; i <= r1; i++) for (let j = k0; j <= k1; j++) this.cell({ row: rows[i].dataset.row, k: keys[j] })?.classList.add('in');
    const td = this.cell(this.at);
    td.classList.add('cur');
    if (this.input.parentElement !== td) {
      // 搬到新的格子（重畫後）：搬的時候瀏覽器會發 blur，那不算離開；清單跟著搬
      const [from, to] = [this.input.selectionStart, this.input.selectionEnd];
      this.moving = true;
      td.append(this.input);
      if (this.editing) this.input.setSelectionRange(from, to);
      setTimeout(() => { this.moving = false; });
    }
    this.input.classList.toggle('on', this.editing);
    if (!this.editing) this.input.value = '';
    if (document.activeElement !== this.input) this.input.focus({ preventScroll: true });
    if (scroll) td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.placePick();
  }

  /** 選取範圍：[第一列, 最後一列, 第一欄, 最後一欄]（列、欄的位置） */
  range() {
    const rows = this.rows().map(r => r.dataset.row), keys = this.h.keys();
    const a = [rows.indexOf(this.anchor.row), keys.indexOf(this.anchor.k)], b = [rows.indexOf(this.at.row), keys.indexOf(this.at.k)];
    return [Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  }

  move(dr, dk, extend) {
    const rows = this.rows(), keys = this.h.keys();
    let r = rows.findIndex(x => x.dataset.row === this.at.row), k = keys.indexOf(this.at.k);
    r = Math.max(0, Math.min(rows.length - 1, r + dr));
    k = k + dk;
    if (k >= keys.length && !extend && dk === 1 && r < rows.length - 1) { k = 0; r++; }   // Tab 到最右邊：換到下一列的第一欄
    if (k < 0 && !extend && dk === -1 && r > 0) { k = keys.length - 1; r--; }
    k = Math.max(0, Math.min(keys.length - 1, k));
    this.at = { row: rows[r].dataset.row, k: keys[k] };
    if (!extend) this.anchor = this.at;
    this.paint();
  }

  edit(keep, typed) {
    if (!this.at || !this.editable(this.at)) return;
    this.editing = true;
    this.before = this.h.text(this.at.row, this.at.k);
    this.input.classList.add('on');
    if (typed === undefined) this.input.value = keep ? this.before : '';
    this.grow();
    const n = this.input.value.length;
    this.input.setSelectionRange(n, n);
    this.openPick(keep);
  }

  // ---- 選的欄位（難度、路線種類）：編輯時格子下面出現清單（下面放不下就放上面；放在 body，不會被別的岩壁卡片蓋住），打的字縮小範圍，↑↓ 移動、Enter／Tab／點一下選 ----
  openPick(keep) {
    const all = this.h.choices?.(this.at.k, this.at.row);
    if (!all?.length) return;
    this.pick = { all, hi: -1, box: Object.assign(document.createElement('div'), { className: 'grid-pick' }) };
    this.pick.box.setAttribute('role', 'listbox');
    this.pick.box.addEventListener('mousedown', (e) => {
      const o = e.target.closest('[data-v]');
      e.preventDefault();   // 不讓輸入框失焦
      if (!o) return;
      this.input.value = o.dataset.v;
      this.commit([1, 0]);
    });
    document.body.append(this.pick.box);
    this.renderPick(keep ? this.before : undefined);
    this.placePick();
  }
  placePick() {
    const box = this.pick?.box, td = this.cell(this.at);
    if (!box || !td) return;
    const r = td.getBoundingClientRect(), h = Math.min(260, box.scrollHeight), below = innerHeight - r.bottom - 8;
    box.style.left = `${Math.max(8, Math.min(r.left, innerWidth - box.offsetWidth - 8))}px`;
    box.style.minWidth = `${r.width}px`;
    box.style.top = `${below >= h || below >= r.top ? r.bottom + 2 : Math.max(8, r.top - 2 - h)}px`;
    box.style.maxHeight = `${Math.max(120, Math.min(260, below >= h || below >= r.top ? below : r.top - 10))}px`;
  }
  renderPick(current) {
    const p = this.pick;
    if (!p) return;
    const q = this.input.value.trim().toLowerCase();
    const shown = current !== undefined ? p.all : p.all.filter(o => o.toLowerCase().includes(q));
    p.shown = shown;
    p.hi = current !== undefined ? Math.max(0, shown.indexOf(current)) : shown.length ? 0 : -1;
    p.box.replaceChildren(...shown.map((o, i) => { const d = document.createElement('div'); d.textContent = o; d.dataset.v = o; d.className = i === p.hi ? 'hi' : ''; d.setAttribute('role', 'option'); return d; }));
    p.box.hidden = !shown.length;
    p.box.children[p.hi]?.scrollIntoView({ block: 'nearest' });
  }
  movePick(d) {
    const p = this.pick;
    if (!p?.shown.length) return;
    p.hi = Math.max(0, Math.min(p.shown.length - 1, p.hi + d));
    [...p.box.children].forEach((c, i) => c.classList.toggle('hi', i === p.hi));
    p.box.children[p.hi]?.scrollIntoView({ block: 'nearest' });
  }
  /** Enter、Tab：清單有亮著的就用它 */
  takePick() { const p = this.pick; if (p && p.hi >= 0 && p.shown[p.hi] !== undefined) this.input.value = p.shown[p.hi]; }
  closePick() { this.pick?.box.remove(); this.pick = null; }
  /** 字比格子寬、比格子高才長大（不換行；Alt＋Enter 換的行往下長） */
  grow() {
    const s = this.input.style;
    s.width = '100%'; s.height = 'auto';
    s.width = `${Math.min(this.input.scrollWidth + 2, 480)}px`;
    s.height = `${this.input.scrollHeight}px`;
  }

  /** 存編輯中的格子，再照 step 移動（[列, 欄]；null 不動） */
  commit(step) {
    if (!this.editing) return;
    let value = this.input.value;
    const p = this.at;
    // 選的欄位：打的字不是清單裡的，就用清單裡第一個有這段字的（打「運」存「運動」、打「11b」存「5.11b」）
    const all = this.h.choices?.(p.k, p.row), q = value.trim().toLowerCase();
    if (all && q && !all.includes(value.trim())) value = all.find(o => o.toLowerCase().includes(q)) ?? value;
    this.editing = false;
    this.closePick();
    this.input.classList.remove('on');
    // 新增那列按 Enter：留在新增那列，接著打下一條
    if (step && !(p.row.startsWith('add:') && step[0] === 1)) this.move(...step);
    if (value !== this.before) this.h.apply([{ ...p, text: value }]);
    else this.paint();
  }

  key(e) {
    if (e.isComposing || e.keyCode === 229) return;
    const mod = e.ctrlKey || e.metaKey;
    if (this.editing) {
      if (this.pick && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); this.movePick(e.key === 'ArrowDown' ? 1 : -1); }
      else if (e.key === 'Enter' && e.altKey) { e.preventDefault(); this.input.setRangeText('\n', this.input.selectionStart, this.input.selectionEnd, 'end'); this.grow(); }
      else if (e.key === 'Enter') { e.preventDefault(); this.takePick(); this.commit([e.shiftKey ? -1 : 1, 0]); }
      else if (e.key === 'Tab') { e.preventDefault(); this.takePick(); this.commit([0, e.shiftKey ? -1 : 1]); }
      else if (e.key === 'Escape') { e.preventDefault(); this.editing = false; this.paint(); }
      else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); this.commit(null); this.h.shift?.(e.key === 'ArrowUp' ? -1 : 1); }
      return;
    }
    const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); this.h.shift?.(e.key === 'ArrowUp' ? -1 : 1); }   // 選到的列往上、往下移
    else if (arrows[e.key]) { e.preventDefault(); this.move(...arrows[e.key], e.shiftKey); }
    else if (e.key === 'Tab') { e.preventDefault(); this.move(0, e.shiftKey ? -1 : 1); }
    else if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); this.edit(true); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.clear(); }
    else if (e.key === 'Escape') { this.at = this.anchor = null; this.paint(); }
    else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); this.h.undo(); }
    else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); this.fillDown(); }
    // 其他字元照常打進輸入框（input 事件開始編輯）
  }

  /** 選取範圍的每一格：[[{ row, k }...]...]（新增路線那列不算） */
  block() {
    const [r0, r1, k0, k1] = this.range(), rows = this.rows(), keys = this.h.keys();
    const out = [];
    for (let i = r0; i <= r1; i++) {
      const row = rows[i].dataset.row;
      if (!row.startsWith('add:')) out.push(keys.slice(k0, k1 + 1).map(k => ({ row, k })));
    }
    return out;
  }
  copyText() {
    const q = (v) => (/[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    return this.block().map(r => r.map(p => q(this.h.text(p.row, p.k))).join('\t')).join('\n');
  }
  clear() {
    const changes = this.block().flat().filter(p => p.k !== 'name' && this.h.text(p.row, p.k) !== '').map(p => ({ ...p, text: '' }));
    if (changes.length) this.h.apply(changes);
  }
  fillDown() {
    const b = this.block();
    if (b.length < 2) return;
    const changes = b.slice(1).flatMap(r => r.map((p, j) => ({ ...p, text: this.h.text(b[0][j].row, b[0][j].k) })));
    this.h.apply(changes);
  }

  /** 貼上：從選取的左上角往右、往下蓋過去；超過這面岩壁最後一條的列變成新的路線（加在這面岩壁） */
  paste(textIn) {
    const data = parseTable(textIn).filter(r => r.some(c => c.trim()));
    if (!data.length || !this.at) return;
    const [r0, , k0] = this.range(), rows = this.rows(), keys = this.h.keys();
    const body = rows[r0].parentElement;
    const own = rows.filter(r => r.parentElement === body && !r.dataset.row.startsWith('add:')).map(r => r.dataset.row);
    const start = Math.max(0, own.indexOf(rows[r0].dataset.row) < 0 ? own.length : own.indexOf(rows[r0].dataset.row));
    const changes = [];
    data.forEach((cells, i) => {
      const row = own[start + i] ?? `add:${body.dataset.wall}#${start + i - own.length}`;
      cells.forEach((v, j) => { const k = keys[k0 + j]; if (k) changes.push({ row, k, text: v }); });
    });
    // 選取整塊貼上的範圍
    const last = own[start + data.length - 1];
    this.anchor = { row: own[start] ?? this.at.row, k: keys[k0] };
    this.at = { row: last ?? this.anchor.row, k: keys[Math.min(keys.length - 1, k0 + Math.max(...data.map(r => r.length)) - 1)] };
    this.h.apply(changes);
  }
}
