// 畫 Topo：一張照片用 TopoKit 的 TopoEditor 畫線、放 bolt。選的是這面岩壁（照片的 props.node）的路線，
// 加上圖層上已經有的別面岩壁的路線；編輯後的圖層交給 onSave（App 存成這張照片的圖層）。
// 版面跟龍洞手機版一樣，電腦和手機同一套：照片佔滿，控制浮在上面。左上是目前的路線（編號＋名稱，點了打開路線清單），
// 左下選工具（畫線、Bolt；再按一次回到調整），右下是分岔（畫線時）、復原、刪除選到的點。Bolt 跟線分開：平常只看線、只改線，
// 按 Bolt 才顯示 bolt、放 bolt 與確保站（上面一排選 Bolt／確保站）。放大鏡：手指按住瞄準、拖點時（滑鼠也是）顯示。
// 平常是「調整」：點別條線換成那條路線、點這條的線插一個點、拖點移動；這條還沒有線才在空白處一直加點（或按著 Shift）。
// 照片下面一排整本的照片（照岩壁排），點了或按 [ ] 換照片。快捷鍵整個畫面都有效（不用游標停在照片上）：
// L 畫線、B Bolt、A 確保站、V／Esc 調整、F 分岔、Z 復原、Y 重做、Delete 刪除點、↑↓ 換路線、[ ] 換照片。
import { TopoEditor } from '../../topokit/index.js';
import * as M from './model.js';

const T = (...a) => globalThis.AppKit.i18n.t(...a);

const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const BOLT_ID = /^A(\d+)$/;

export class TopoScreen {
  /** root：#topo；image：照片的網址（object URL）；onSave(layer)：每次修改後；onPhoto(id)：換照片；toast(msg)：提示 */
  constructor(root, { state, photoId, image, thumbs, onSave, onPhoto, onPhotoMenu, onAddPhotos, onAutoTrace, toast }) {
    this.onAddPhotos = onAddPhotos; this.onAutoTrace = onAutoTrace;
    this.image = image;
    this.toast = toast;
    this.root = root;
    this.state = state;
    this.photo = state.photos.get(photoId);
    this.thumbs = thumbs;
    this.onSave = onSave;
    this.onPhoto = onPhoto;
    this.anchor = false;
    this.ac = new AbortController();
    const host = root.querySelector('#topoHost');
    const grade = M.settings(state).grade;
    // bolts 跟紅點貓一樣放大才畫全部；有在管理 bolt 編號的岩場（匯入的圖層有 bolt）標位置
    this.editor = new TopoEditor(host, { tool: 'edit', lang: 'zh-Hant', gradeSystems: [grade, ...M.GRADE_SYSTEMS.filter(g => g !== grade)], bolts: [], boltCodes: M.managesBolts(state), keys: { window: true }, aim: 'always', controls: false });
    const layer = structuredClone(M.topoLayer(state, photoId));
    M.syncLabels(state, layer);
    this.editor.setData({ view: { ...this.photo, href: image }, layers: [layer], nodes: state.book.nodes });

    const on = (type, fn) => this.editor.addEventListener(type, fn);
    on('change', (e) => {
      if (this.anchor && e.detail.reason === 'bolt') this.editor.setBoltPos(this.#nextAnchor());
      this.onSave(e.detail.layer);
      this.renderRoutes();
      this.renderPhotos();   // 照片條角落畫了幾條
      this.renderTools();
    });
    for (const type of ['history', 'selectpoint']) on(type, () => this.renderTools());
    // TopoKit 的 V 是「選取」；這裡的選取就是調整。Bolt 只在 Bolt 工具時顯示（放大才畫全部路線的）
    on('tool', (e) => {
      if (e.detail.tool === 'select') { this.editor.setTool('edit'); return; }
      this.editor.setOptions({ bolts: e.detail.tool === 'bolt' ? 'zoom' : [] });
      this.renderTools();
    });
    on('select', () => { if (this.anchor) this.editor.setBoltPos(this.#nextAnchor()); this.renderRoutes(); this.renderTools(); });

    const signal = this.ac.signal;
    for (const s of ['#topoBar', '#topoModes', '#topoChips']) root.querySelector(s).addEventListener('click', (e) => this.#barClick(e), { signal });
    // 左上的路線名稱：打開、關掉路線清單（點清單外面、Esc 也關）
    const side = root.querySelector('#topoSide');
    root.querySelector('#tTitle').addEventListener('click', () => { side.hidden = !side.hidden; if (!side.hidden) this.renderRoutes(); }, { signal });
    root.ownerDocument.addEventListener('pointerdown', (e) => { if (!side.hidden && !e.target.closest?.('#topoSide, #tTitle')) side.hidden = true; }, { signal, capture: true });
    root.querySelector('#topoStrip').addEventListener('click', (e) => {
      if (e.target.closest('.sbtn.add')) { this.onAddPhotos?.(); return; }
      if (e.target.closest('.sbtn.trace')) { this.onAutoTrace?.(); return; }
      const id = e.target.closest('[data-id]')?.dataset.id;
      if (id && id !== this.photo.id) this.onPhoto(id);
    }, { signal });
    // 右鍵：照片移到別面岩壁、刪除（App 的選單）
    root.querySelector('#topoStrip').addEventListener('contextmenu', (e) => {
      const b = e.target.closest('[data-id]');
      if (!b || !onPhotoMenu) return;
      e.preventDefault();
      onPhotoMenu(b.dataset.id, b);
    }, { signal });
    // TopoKit 沒有的快捷鍵：確保站、回到調整、換路線、換照片（打字、對話框裡不算）
    root.ownerDocument.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, select, dialog') || root.ownerDocument.querySelector('dialog[open]')) return;
      const k = e.key;
      const run = { a: () => this.#tool('anchor'), Escape: () => { if (!side.hidden) side.hidden = true; else if (this.editor.tool !== 'edit') this.#tool('edit'); }, ArrowUp: () => this.stepRoute(-1), ArrowDown: () => this.stepRoute(1), '[': () => this.stepPhoto(-1), ']': () => this.stepPhoto(1), PageUp: () => this.stepPhoto(-1), PageDown: () => this.stepPhoto(1) }[k.length === 1 ? k.toLowerCase() : k];
      if (!run) return;
      e.preventDefault();
      run();
    }, { signal });
    for (const list of root.querySelectorAll('#topoRoutes, #topoOthers')) list.addEventListener('click', (e) => {
      const id = e.target.closest('[data-id]')?.dataset.id;
      if (id) { this.pick(id); side.hidden = true; }
    }, { signal: this.ac.signal });

    this.renderPhotos();
    const list = this.#routes();
    const done = M.drawn(state);
    const first = list.find(r => !done.get(r.id)?.has(photoId)) || list[0];
    if (first) this.pick(first.id);
    this.renderRoutes();
    this.renderTools();
  }

  /** 這張照片可以畫的路線：這面岩壁的（照順序），加上圖層上已經有的別面岩壁的 */
  #routes() {
    const own = M.routesOf(this.state, this.photo.props.node);
    const ids = new Set(own.map(r => r.id));
    const extra = this.editor.routes.map(r => r.id).filter(id => !ids.has(id))
      .map(id => this.state.book.nodes.find(n => n.id === id && n.type === 'route')).filter(Boolean);
    return [...own, ...extra];
  }

  /** 選路線：圖層上還沒有就加一條（第一次畫線或放 bolt 才寫進圖層） */
  pick(id) {
    const ed = this.editor;
    if (ed.routes.some(r => r.id === id)) ed.select(id);
    else {
      const r = this.state.book.nodes.find(n => n.id === id);
      const n = M.routeNumber(this.state, id);
      ed.addRoute({ id, ...(n ? { label: String(n) } : {}), name: M.text(r?.name), kind: r?.props?.style === 'sport' ? 'sport' : 'other' });
    }
  }

  /** 路線新增之後（例如從這個畫面新增）：重畫清單，有給 id 就選它 */
  routesChanged(id) {
    this.renderRoutes();
    if (id) this.pick(id);
  }

  /** 換路線（↑↓）：照右邊清單的順序 */
  stepRoute(d) {
    const list = this.#routes();
    if (!list.length) return;
    const i = list.findIndex(r => r.id === this.editor.selected);
    const next = list[Math.max(0, Math.min(list.length - 1, i < 0 ? 0 : i + d))];
    if (next && next.id !== this.editor.selected) this.pick(next.id);
  }

  /** 整本的照片，照岩壁排（岩壁照岩壁表格的順序，同一面照 items 的順序）：[{ wall, photos }] */
  #photoGroups() {
    const all = this.state.book.items.map(i => this.state.photos.get(i.id)).filter(Boolean);
    const order = M.walls(this.state).map(w => w.id);
    const groups = new Map();
    for (const v of all) {
      const k = v.props.node ?? '';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(v);
    }
    return [...groups].sort((a, b) => (order.indexOf(a[0]) + 1 || 1e9) - (order.indexOf(b[0]) + 1 || 1e9)).map(([wall, photos]) => ({ wall, photos }));
  }

  /** 換照片（[ ]、PageUp／PageDown） */
  stepPhoto(d) {
    const all = this.#photoGroups().flatMap(g => g.photos);
    const next = all[all.findIndex(v => v.id === this.photo.id) + d];
    if (next) this.onPhoto(next.id);
  }

  #tool(tool) {
    const ed = this.editor;
    if (tool !== 'edit' && (ed.tool === 'bolt' && this.anchor ? 'anchor' : ed.tool) === tool) tool = 'edit';   // 再按一次：回到調整
    if (tool === 'boltmode') tool = ed.tool === 'bolt' ? 'edit' : 'bolt';   // 左下的 Bolt：開關 bolt 工具（Bolt、確保站都算）
    ed.setTool(tool === 'anchor' ? 'bolt' : tool);
    this.anchor = tool === 'anchor';
    ed.setBoltPos(this.anchor ? this.#nextAnchor() : undefined);
    this.renderTools();
  }

  #nextAnchor() {
    const r = this.editor.routes.find(x => x.id === this.editor.selected);
    const used = new Set(Object.keys(r?.bolts || {}).map(k => Number(k.match(BOLT_ID)?.[1])).filter(Boolean));
    let i = 1;
    while (used.has(i)) i++;
    return `A${String(i).padStart(2, '0')}`;
  }

  #barClick(e) {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const ed = this.editor;
    const tool = b.dataset.tool;
    if (tool) { this.#tool(tool); return; }
    if (b.dataset.sub) {   // Bolt 工具裡選放 Bolt 或確保站
      ed.setTool('bolt');
      this.anchor = b.dataset.sub === 'anchor';
      ed.setBoltPos(this.anchor ? this.#nextAnchor() : undefined);
      this.renderTools();
      return;
    }
    if (b.id === 'tUndo') ed.undo();
    else if (b.id === 'tDel') ed.deletePicked();
    else if (b.id === 'tFork') { ed.fork(); this.renderTools(); }
  }

  renderTools() {
    const ed = this.editor, q = (s) => this.root.querySelector(s);
    if (ed.tool !== 'bolt') this.anchor = false;
    const current = ed.tool === 'bolt' && this.anchor ? 'anchor' : ed.tool;
    for (const b of this.root.querySelectorAll('#topoModes [data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === current || (b.dataset.tool === 'boltmode' && ed.tool === 'bolt')));
    q('#topoChips').hidden = ed.tool !== 'bolt';
    for (const b of this.root.querySelectorAll('#topoChips [data-sub]')) b.setAttribute('aria-pressed', String(b.dataset.sub === current));
    // 左上：目前的路線（編號、名稱）
    const cur = this.#routes().find(x => x.id === ed.selected);
    q('#tTitle').replaceChildren(...(cur ? [el('b', { textContent: M.routeNumber(this.state, cur.id) ?? '·' }), el('span', { textContent: M.text(cur.name) || T('cgUntitled') })] : [el('span', { textContent: T('cgPickRoute') })]),
      Object.assign(document.createElementNS('http://www.w3.org/2000/svg', 'svg'), { innerHTML: '<path d="m6 9 6 6 6-6"/>' }));
    q('#tTitle svg').setAttribute('viewBox', '0 0 24 24');
    q('#tUndo').disabled = !ed.canUndo;
    q('#tDel').hidden = !ed.picked;
    q('#tFork').hidden = ed.tool !== 'line' || (!ed.canFork && !ed.forking);   // 畫線時、有別條路線可以分岔才有（跟龍洞一樣）
    q('#tFork').setAttribute('aria-pressed', String(!!ed.forking));
  }

  /** 照片條：整本的照片照岩壁排，岩壁名稱夾在中間；角落的數字是這張畫了幾條線 */
  renderPhotos() {
    const box = this.root.querySelector('#topoStrip');
    const wallName = (id) => M.text(this.state.book.nodes.find(n => n.id === id)?.name) || T('cgUnassigned');
    const sbtn = (cls, label, d) => Object.assign(el('button', { className: `sbtn ${cls}`, title: label, innerHTML: `<svg viewBox="0 0 24 24">${d}</svg>` }), { ariaLabel: label });
    box.replaceChildren(sbtn('trace', T('cgTraceFromPhotos'), '<path d="M5 20c2-4 1-7 4-9s6-2 7-7" stroke-dasharray="3 3"/><path d="M16 15l3 3 3-6"/>'), ...this.#photoGroups().flatMap(({ wall, photos }) => [
      el('span', { className: 'wall', textContent: wallName(wall) }),
      ...photos.map(v => {
        const b = el('button', { className: `tphoto${v.id === this.photo.id ? ' on' : ''}`, title: `${wallName(wall)}${v.name ? ` · ${v.name}` : ''}` });
        b.dataset.id = v.id;
        b.setAttribute('role', 'option');
        b.setAttribute('aria-selected', String(v.id === this.photo.id));
        if (this.thumbs.has(v.id)) b.append(el('img', { src: this.thumbs.get(v.id), alt: '' }));
        const n = M.routeMarkCount(this.state, v.id);
        if (n) b.append(el('s', { textContent: String(n) }));
        return b;
      }),
    ]), sbtn('add', T('cgAddPhotos'), '<path d="M12 7v10M7 12h10"/><rect x="3" y="3" width="18" height="18" rx="4"/>'));
    box.querySelector('.tphoto.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  renderRoutes() {
    const ed = this.editor, done = M.drawn(this.state);
    const here = new Set(ed.routes.filter(r => r.line?.length >= 2 || r.at).map(r => r.id));
    const grade = M.settings(this.state).grade;
    const item = (r) => {
      const n = M.routeNumber(this.state, r.id);
      const g = r.props?.grade && typeof r.props.grade === 'object' ? (r.props.grade[grade] ?? Object.values(r.props.grade)[0] ?? '') : '';
      const elsewhere = [...(done.get(r.id) || [])].some(p => p !== this.photo.id);
      const mark = here.has(r.id) ? 'here' : elsewhere ? 'elsewhere' : '';
      const b = el('button', { className: 'open' },
        el('span', { className: 'num', textContent: n ? `${n}` : '·' }),
        el('span', { className: 'rname', textContent: M.text(r.name) || T('cgUntitled') }),
        el('span', { className: `drawn ${mark}`, textContent: mark ? '✓' : '', title: mark === 'here' ? (ed.routes.find(x => x.id === r.id)?.at ? T('cgNumberMarked') : T('cgLineDrawn')) : mark ? T('cgMarkedElsewhere') : '' }),
        el('span', { className: 'grade', textContent: g }));
      const li = el('li', { className: `route${r.id === ed.selected ? ' on' : ''}` }, b);
      li.dataset.id = r.id;
      return li;
    };
    const mine = this.#routes();
    this.root.querySelector('#topoRoutes').replaceChildren(...mine.map(item));
    // 照片同時拍到別面岩壁（例如糖果屋和女巫塔在同一張）：從其他岩壁挑路線加進這張照片的圖層
    const have = new Set(mine.map(r => r.id)), name = (w) => M.text(w.name) || T('cgUntitled');
    const others = M.walls(this.state).filter(w => w.id !== this.photo.props.node)
      .map(w => ({ w, routes: M.routesOf(this.state, w.id).filter(r => !have.has(r.id)) })).filter(g => g.routes.length);
    this.root.querySelector('#topoOthersBox').hidden = !others.length;
    this.root.querySelector('#topoOthers').replaceChildren(...others.flatMap(({ w, routes }) => [el('li', { className: 'wallhead', textContent: name(w) }), ...routes.map(item)]));
    this.root.querySelector('#topoRoutes .route.on')?.scrollIntoView({ block: 'nearest' });
  }

  destroy() {
    this.ac.abort();
    this.editor.destroy();
  }
}
