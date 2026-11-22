// 岩壁地圖：mapkit 的 MapEditor（岩壁、步道、區域、地名都是向量，底圖可以開關）。
// app.js 只用這裡的 WallMap：setData、select、fit、frame、setSketch、alignSketch、setEditing；事件 pick（點到岩壁，或點空白處取消選取）、sketch（對準過的示意圖），
// 編輯模式（步驟列的「區域圖」）另外發 editstart（一次修改開始：App 記復原點）、shape（改過的形狀，停手才發）、remove（刪掉一個形狀）、draw（畫好的新形狀）、undo、
// shapeselect（選到的形狀是哪個節點，右邊的區域清單跟著亮）；App 用 selectNode(id) 從清單選地圖上的形狀、startDraw(kind, id) 替還沒有形狀的節點畫。
// 底圖（航照、等高線、OpenStreetMap）一開始都不開，在左上的底圖選單開，或按 A（航照）、T（等高線）。
// 編輯的形狀是地圖畫面的標註：岩壁（線）、岩石（多邊形，也是岩壁節點）、區域（多邊形）、步道（線，props.kind trail）；其他（陸地、道路）不能改。
// 示意圖（例如手畫的岩場配置）是蓋在地圖上的半透明圖片，跟著地圖的平移、縮放、旋轉；對準時拖曳移動、拖右上角旋轉縮放。
// 照片的視錐（有拍照位置和朝向的照片）畫在上面一層 canvas：1px 細線的扇形，選到的岩壁的照片亮起來；點扇形（沒點到形狀時）發 photo（打開那張照片）。
// Studio Crag的岩壁節點是 type wall：交給 mapkit 時當成分區（sector）畫，Guidebook 本身不改。
import { MapEditor, SOURCES, LINE_HIT_PX, segmentDistance, toScreen } from '../../mapkit/index.js';
import { local } from './geo.js';

const WEDGE_PX = 34, WEDGE_HIT_PX = 16, WEDGE_APEX_PX = 9;

const T = (...a) => globalThis.AppKit.i18n.t(...a);

const BASEMAPS = [['osm', 'OpenStreetMap'], ['ortho', T('cgBaseAerial')], ['contours', T('cgBaseContours')]];
const ICON = {
  fit: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  layers: '<svg viewBox="0 0 24 24"><path d="M12 4l9 5-9 5-9-5z"/><path d="M3 14l9 5 9-5"/></svg>',
  sketch: '<svg viewBox="0 0 24 24"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>',
};
const M_PER_DEG = 111320;

/** 點地圖：畫新形狀時照常加點（mapkit 發 tap），其他交給 WallMap 判斷點到哪個形狀 */
class WallEditor extends MapEditor {
  render() {
    super.render();
    this.onRender?.();
  }

  onTap(p) {
    if (this.options.picking) return super.onTap(p);
    this.dispatchEvent(new CustomEvent('hit', { detail: p }));
  }
}

const KIND_LABEL = { rock: T('cgKindRock'), wall: T('cgKindWall'), area: T('cgKindArea'), trail: T('cgKindTrail') };
/** 標註的形狀 → [[經緯度]…] 的清單（多邊形不重複第一點） */
function ringsOf(g) {
  if (g.type === 'Polygon') return [g.coordinates[0].slice(0, -1)];
  if (g.type === 'MultiPolygon') return g.coordinates.map(q => q[0].slice(0, -1));
  if (g.type === 'LineString') return [g.coordinates];
  if (g.type === 'MultiLineString') return g.coordinates;
  return [];
}
/** 改過的 rings → 形狀（照原本是不是多塊：一塊的多邊形、線維持單一的型別） */
export function geometryOf(rings, closed, multi) {
  if (closed) return multi || rings.length > 1 ? { type: 'MultiPolygon', coordinates: rings.map(r => [[...r, r[0]]]) } : { type: 'Polygon', coordinates: [[...rings[0], rings[0][0]]] };
  return multi || rings.length > 1 ? { type: 'MultiLineString', coordinates: rings } : { type: 'LineString', coordinates: rings[0] };
}
/** 點 pt 在多邊形 ring 裡面嗎（螢幕座標） */
const inRing = (pt, ring) => ring.reduce((inside, a, i) => {
  const b = ring[(i + 1) % ring.length];
  return (a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0] ? !inside : inside;
}, false);
const ringArea = (r) => Math.abs(r.reduce((sum, [x, y], k) => { const [x2, y2] = r[(k + 1) % r.length]; return sum + x * y2 - x2 * y; }, 0));

/** 經緯度範圍 [西, 南, 東, 北] 往外加 pad 公尺（而且至少 min 公尺寬） */
function grow([w, s, e, n], pad, min = 0) {
  const k = Math.cos(((s + n) / 2) * Math.PI / 180) || 1;
  const px = Math.max(pad, (min - (e - w) * M_PER_DEG * k) / 2) / (M_PER_DEG * k);
  const py = Math.max(pad, (min - (n - s) * M_PER_DEG) / 2) / M_PER_DEG;
  return [w - px, s - py, e + px, n + py];
}

function coordsOf(g) {
  if (!g) return [];
  if (g.type === 'Point') return [g.coordinates];
  if (g.type === 'LineString') return g.coordinates;
  if (g.type === 'MultiLineString' || g.type === 'Polygon') return g.coordinates.flat();
  if (g.type === 'MultiPolygon') return g.coordinates.flat(2);
  return [];
}

export class WallMap extends EventTarget {
  /** host：放地圖的元素（要有大小） */
  constructor(host) {
    super();
    this.host = host;
    this.selected = null;
    this.basemap = {};
    this.box = Object.assign(document.createElement('div'), { className: 'wallmap' });
    const tools = Object.assign(document.createElement('div'), { className: 'map-tools' });
    const button = (name, label) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: `map-btn map-${name}`, title: label, innerHTML: ICON[name] });
      b.setAttribute('aria-label', label);
      tools.append(b);
      return b;
    };
    this.layersBtn = button('layers', T('cgBasemap'));
    this.fitBtn = button('fit', T('cgFitAll'));
    this.sketchBtn = button('sketch', T('cgSketch'));
    // 編輯模式（「區域圖」）的工具列：畫新的岩石、岩壁、區域、步道；選到形狀時換邊（岩壁的線）、刪除；畫的時候完成、取消
    // 只有圖示（跟路線圖同一種膠囊）：名稱、快捷鍵在提示裡；復原在最前面，選到形狀才出現換邊、刪除，畫的時候只有完成、取消
    this.editBar = Object.assign(document.createElement('div'), { className: 'tbar map-edit', hidden: true });
    this.editBar.setAttribute('role', 'toolbar');
    this.editBar.setAttribute('aria-label', T('cgMapTools'));
    const tool = (label, key, icon, run, cls = '') => {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: `tbtn ${cls}`.trim(), title: key ? T('cgTipKey', label, key) : label, innerHTML: `<svg viewBox="0 0 24 24">${icon}</svg>` });
      b.setAttribute('aria-label', label);
      b.addEventListener('click', run);
      this.editBar.append(b);
      return b;
    };
    const sep = () => { const x = Object.assign(document.createElement('span'), { className: 'sep' }); this.editBar.append(x); return x; };
    this.undoBtn = tool(T('cgUndo'), 'Ctrl+Z', '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>', () => this.dispatchEvent(new CustomEvent('undo')));
    this.seps = [sep()];
    const DRAW_ICON = {
      rock: '<path d="M5 17l2-8 6-3 6 5-2 7z"/>',
      wall: '<path d="M4 19L10 10l10-5"/><path d="M8 12l-2-2M13 8.5l-1.5-2.5M17 6.5l-1-2.5"/>',
      area: '<path d="M4 6h16v12H4z" stroke-dasharray="3 2.5"/>',
      trail: '<path d="M4 20c3-5 5-3 8-8s5-4 8-6" stroke-dasharray="2 3"/>',
    };
    this.drawBtns = Object.entries(KIND_LABEL).map(([kind, label]) => Object.assign(tool(T('cgDrawKind', label), '', DRAW_ICON[kind], () => this.startDraw(kind)), { kind }));
    this.addVertexBtn = tool(T('cgAddVertex'), '+', '<path d="M12 5v14M5 12h14"/>', () => this.addVertex());
    this.flipShapeBtn = tool(T('cgFlipWall'), '', '<path d="M7 7h12l-3-3M17 17H5l3 3"/>', () => this.flipShape());
    this.removeBtn = tool(T('cgDelete'), 'Delete', '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>', () => this.removeShape(), 'danger');
    this.finishBtn = tool(T('done'), 'Enter', '<path d="M5 12l5 5L20 7"/>', () => this.finishDraw(), 'primary');
    this.cancelBtn = tool(T('cancel'), 'Esc', '<path d="M6 6l12 12M18 6L6 18"/>', () => this.cancelDraw());
    this.editing = false; this.sel = null; this.drawing = null;
    this.onKey = (e) => {
      if (!this.editing || e.target.closest?.('input, textarea, select, [contenteditable], dialog')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); this.dispatchEvent(new CustomEvent('undo')); }
      else if (e.key === 'Enter' && this.drawing) this.finishDraw();
      else if (e.key === 'Enter' && this.aligning) this.alignSketch(false);
      else if (e.key === 'Escape') { if (this.drawing) this.cancelDraw(); else if (this.aligning) this.alignSketch(false); else this.selectShape(null); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel && !this.drawing) { e.preventDefault(); this.removeShape(); }
      else if (!mod && !e.altKey && e.key.toLowerCase() === 'a') this.toggleBase('ortho');
      else if (!mod && !e.altKey && e.key.toLowerCase() === 't') this.toggleBase('contours');
    };
    document.addEventListener('keydown', this.onKey);
    this.sketch = null; this.aligning = false;
    this.sketchLayer = Object.assign(document.createElement('div'), { className: 'map-sketch-layer' });
    this.sketchImg = Object.assign(document.createElement('img'), { alt: '', draggable: false, hidden: true });
    this.sketchTurn = Object.assign(document.createElement('div'), { className: 'map-sketch-turn', hidden: true });
    this.sketchLayer.append(this.sketchImg, this.sketchTurn);
    this.sketchLayer.addEventListener('pointerdown', (e) => this.sketchDown(e));
    this.sketchLayer.addEventListener('pointermove', (e) => this.sketchMove(e));
    this.sketchLayer.addEventListener('pointerup', (e) => this.sketchUp(e));
    this.sketchLayer.addEventListener('pointercancel', () => { this.drag = null; });
    this.sketchLayer.addEventListener('wheel', (e) => { e.preventDefault(); this.editor?.zoomBy(Math.exp(-e.deltaY * 0.002)); }, { passive: false });
    this.menu = Object.assign(document.createElement('div'), { className: 'map-basemaps', hidden: true });
    for (const [key, label] of BASEMAPS) {
      const row = document.createElement('label');
      const box = Object.assign(document.createElement('input'), { type: 'checkbox' });
      box.dataset.base = key;
      box.addEventListener('change', () => this.setBase({ ...this.basemap, [key]: box.checked }));
      row.append(box, label);
      this.menu.append(row);
    }
    this.layersBtn.addEventListener('click', () => { this.menu.hidden = !this.menu.hidden; });
    this.fitBtn.addEventListener('click', () => this.fit());
    this.box.addEventListener('pointerdown', (e) => this.shapeDown(e), { capture: true });
    this.shotLayer = Object.assign(document.createElement('canvas'), { className: 'map-shots' });
    Object.assign(this.shotLayer.style, { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' });
    this.shotLayer.setAttribute('aria-hidden', 'true');
    host.append(this.box, this.shotLayer, this.sketchLayer, tools, this.menu, this.editBar);
  }

  /**
   * map：岩壁地圖（v2 地圖畫面）；nodes：Guidebook 的節點；shots：拍照點 [經度, 緯度]；sketch：沒有 GPS 照片時用示意圖撐開畫布；
   * wedges：照片的視錐 [{ id（照片畫面）, wall（岩壁節點）, position, heading, fov }]（geo.js 的 photoWedge）
   */
  setData({ map, nodes, shots, sketch, wedges = [] }) {
    this.wedges = wedges;
    const pts = [...map.marks.flatMap(m => coordsOf(m.geometry)), ...shots];
    if (!pts.length && sketch) pts.push(...this.sketchCorners(sketch));
    if (!pts.length) { this.data = null; this.build(); return; }
    // 一開始的畫面、「整張」只看岩壁、區域和拍照點；底圖的道路、陸地只決定能移多遠
    const types = new Map([...nodes, ...(map.nodes || [])].map(n => [n.id, n.type]));
    const core = [...map.marks.filter(m => ['wall', 'sector', 'area'].includes(types.get(m.node))).flatMap(m => coordsOf(m.geometry)), ...shots];
    const bbox = (list) => [Math.min(...list.map(p => p[0])), Math.min(...list.map(p => p[1])), Math.max(...list.map(p => p[0])), Math.max(...list.map(p => p[1]))];
    const home = core.length ? core : pts;
    const view = { ...map, props: { ...map.props, home: grow(bbox(home), 20, 120), bounds: grow(bbox(pts), 1500, 4000) } };
    this.points = home;
    this.data = { view, nodes: nodes.map(n => (n.type === 'wall' ? { ...n, type: 'sector' } : n)), shots };
    this.types = types;
    if (this.sel && !map.marks.includes(this.sel.mark)) {
      const nextMark = this.sel.mark.node && map.marks.find(m => m.node === this.sel.mark.node);
      if (nextMark) this.sel = { ...this.sel, mark: nextMark };
      else this.sel = null;
    }
    this.build();
  }

  /** 選到的岩壁：地圖上標出來（看的時候；編輯模式另外選形狀） */
  select(id) {
    this.selected = id;
    this.editor?.set({ selected: id ? { node: id } : undefined });
    this.drawWedges();
  }

  /** 照片的視錐在畫面上：頂點和兩條邊的終點（固定像素長，地圖轉了也對：沿朝向走一公尺再換到畫面上量方向） */
  wedgeShapes() {
    const ed = this.editor;
    if (!ed?.getView()) return [];
    return (this.wedges || []).map(w => {
      const a = ed.toScreen(w.position), plane = local(w.position);
      const edge = (deg) => {
        const r = (deg * Math.PI) / 180, b = ed.toScreen(plane.from([Math.sin(r), Math.cos(r)])), dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy) || 1;
        return [a[0] + (dx / n) * WEDGE_PX, a[1] + (dy / n) * WEDGE_PX];
      };
      return { w, a, l: edge(w.heading - w.fov / 2), r: edge(w.heading + w.fov / 2), m: edge(w.heading) };
    });
  }

  drawWedges() {
    const c = this.shotLayer, w = c.clientWidth, h = c.clientHeight, k = Math.min(devicePixelRatio || 1, 2);
    if (!w || !h) return;
    if (c.width !== Math.round(w * k) || c.height !== Math.round(h * k)) { c.width = Math.round(w * k); c.height = Math.round(h * k); }
    const g = c.getContext('2d');
    g.setTransform(k, 0, 0, k, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(this.host), line = css.getPropertyValue('--text').trim() || '#fff', on = css.getPropertyValue('--accent').trim() || '#d4ff4f';
    // 底圖可能是淺色（向量地圖）或深色（航照）：細線底下先描一圈深色的暈，兩種都看得到
    const path = (s) => {
      g.beginPath();
      g.moveTo(s.l[0], s.l[1]); g.lineTo(s.a[0], s.a[1]); g.lineTo(s.r[0], s.r[1]);
      g.quadraticCurveTo(2 * s.m[0] - (s.l[0] + s.r[0]) / 2, 2 * s.m[1] - (s.l[1] + s.r[1]) / 2, s.l[0], s.l[1]);
    };
    for (const s of this.wedgeShapes()) {
      const hot = !!this.selected && s.w.wall === this.selected;
      path(s); g.strokeStyle = 'rgba(0, 0, 0, .55)'; g.lineWidth = 3; g.stroke();
      path(s); g.strokeStyle = hot ? on : line; g.lineWidth = hot ? 1.5 : 1; g.stroke();
      g.beginPath(); g.arc(s.a[0], s.a[1], 3, 0, 2 * Math.PI); g.fillStyle = 'rgba(0, 0, 0, .55)'; g.fill();
      g.beginPath(); g.arc(s.a[0], s.a[1], 2, 0, 2 * Math.PI); g.fillStyle = hot ? on : line; g.fill();
    }
  }

  /** 點到哪一張照片的視錐：{ id, apex（點在頂點上，就是拍照的位置） }；扇形中間的點或頂點在 WEDGE_HIT_PX 內、最近的；都沒有回 null */
  hitWedge(p) {
    let best = null, bd = WEDGE_HIT_PX;
    for (const s of this.wedgeShapes()) {
      const mid = [(s.a[0] + s.m[0]) / 2, (s.a[1] + s.m[1]) / 2], da = Math.hypot(s.a[0] - p.x, s.a[1] - p.y);
      const d = Math.min(da, Math.hypot(mid[0] - p.x, mid[1] - p.y));
      if (d < bd) { bd = d; best = { id: s.w.id, apex: da <= WEDGE_APEX_PX }; }
    }
    return best;
  }

  /** 縮放到看得到所有岩壁、步道、區域和拍照點 */
  fit() {
    if (this.editor && this.points?.length) this.editor.focus({ points: this.points });
  }

  /** 現在畫面的中心（經緯度）和寬度（公尺）；還沒有地圖時 undefined */
  frame() {
    const v = this.editor?.getView();
    if (!v) return undefined;
    const r = this.host.getBoundingClientRect();
    return { center: v.center, width: Math.min(r.width, r.height) * v.metersPerPixel };
  }

  /** 示意圖：{ w, h, center: [經度, 緯度], width（公尺）, rotation（度，順時針） }，url 是圖檔；null 拿掉 */
  setSketch(sketch, url = '') {
    this.sketch = sketch && { ...sketch, center: [...sketch.center] };
    if (url !== this.sketchImg.getAttribute('src')) this.sketchImg.src = url;
    if (!sketch) this.alignSketch(false);
    this.placeSketch();
  }

  /** 對準模式：示意圖接手拖曳（移動）與右上角的圓點（旋轉縮放），放開時發 sketch */
  alignSketch(on) {
    this.aligning = !!on && !!this.sketch;
    this.sketchLayer.classList.toggle('aligning', this.aligning);
    this.sketchBtn.classList.toggle('on', this.aligning);
    this.sketchBtn.innerHTML = this.aligning ? ICON.check : ICON.sketch;
    const label = this.aligning ? T('cgFinishAlign') : T('cgSketch');
    this.sketchBtn.title = label; this.sketchBtn.setAttribute('aria-label', label);
    this.placeSketch();
  }

  /** 示意圖的左上、右上、左下角（經緯度）：中心加上轉過的半寬、半高 */
  sketchCorners(s = this.sketch) {
    const plane = local(s.center), a = (s.rotation * Math.PI) / 180;
    const hw = s.width / 2, hh = (s.width * s.h) / s.w / 2;
    // 圖的右是東、下是南；順時針轉 a
    const at = (u, v) => plane.from([u * Math.cos(a) - v * Math.sin(a), -(u * Math.sin(a) + v * Math.cos(a))]);
    return [at(-hw, -hh), at(hw, -hh), at(-hw, hh)];
  }

  /** 把圖片擺到三個角在畫面上的位置（跟著地圖的縮放與旋轉） */
  placeSketch() {
    const ed = this.editor, s = this.sketch;
    const show = !!(ed?.getView() && s && this.sketchImg.getAttribute('src'));
    this.sketchImg.hidden = !show;
    this.sketchTurn.hidden = !show || !this.aligning;
    if (!show) return;
    const [p0, p1, p3] = this.sketchCorners().map(q => ed.toScreen(q));
    const m = [(p1[0] - p0[0]) / s.w, (p1[1] - p0[1]) / s.w, (p3[0] - p0[0]) / s.h, (p3[1] - p0[1]) / s.h, p0[0], p0[1]];
    Object.assign(this.sketchImg.style, { width: `${s.w}px`, height: `${s.h}px`, transform: `matrix(${m.join(',')})` });
    // 右上角的圓點留在畫面裡（角落移出地圖時也拿得到）：轉動、縮放照指標相對中心算，圓點的位置不影響結果
    const W = this.sketchLayer.clientWidth, H = this.sketchLayer.clientHeight, k = 20;
    const at = (v, max) => (max > 2 * k ? Math.min(max - k, Math.max(k, v)) : v);
    Object.assign(this.sketchTurn.style, { left: `${at(p1[0], W)}px`, top: `${at(p1[1], H)}px` });
  }

  point(e) {
    const r = this.sketchLayer.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  sketchDown(e) {
    if (!this.aligning || this.drag) return;
    this.sketchLayer.setPointerCapture(e.pointerId);
    const c = this.editor.toScreen(this.sketch.center), p = this.point(e);
    this.drag = e.target === this.sketchTurn
      ? { kind: 'turn', id: e.pointerId, c, v0: [p[0] - c[0], p[1] - c[1]], from: { ...this.sketch } }
      : { kind: 'slide', id: e.pointerId, c, start: p };
  }

  sketchMove(e) {
    const g = this.drag;
    if (!g || g.id !== e.pointerId) return;
    const p = this.point(e);
    if (g.kind === 'slide') {
      this.sketch.center = this.editor.toLngLat([g.c[0] + p[0] - g.start[0], g.c[1] + p[1] - g.start[1]]);
    } else {
      const v = [p[0] - g.c[0], p[1] - g.c[1]], r0 = Math.hypot(...g.v0);
      if (r0 < 1 || Math.hypot(...v) < 1) return;
      const turn = ((Math.atan2(v[1], v[0]) - Math.atan2(g.v0[1], g.v0[0])) * 180) / Math.PI;
      this.sketch.width = Math.max(1, (g.from.width * Math.hypot(...v)) / r0);
      this.sketch.rotation = Math.round(((((g.from.rotation + turn) % 360) + 360) % 360) * 10) / 10;
    }
    g.moved = true;
    this.placeSketch();
  }

  sketchUp(e) {
    const g = this.drag;
    if (!g || g.id !== e.pointerId) return;
    this.drag = null;
    if (!g.moved) return;
    const { center, width, rotation } = this.sketch;
    const round = (x) => Math.round(x * 1e7) / 1e7;
    this.dispatchEvent(new CustomEvent('sketch', { detail: { center: center.map(round), width: Math.round(width * 10) / 10, rotation } }));
  }

  /** 可以改的形狀：[{ mark, kind（rock／wall／area／trail）, closed }]；view：只要岩壁（看的時候只能點岩壁） */
  shapes(view = false) {
    return (this.data?.view.marks ?? []).flatMap((mark) => {
      const g = mark.geometry, closed = /Polygon/.test(g?.type ?? ''), type = this.types.get(mark.node);
      if (!g || g.type === 'Point') return [];
      const kind = ['wall', 'sector'].includes(type) ? (closed ? 'rock' : 'wall') : ['area', 'crag'].includes(type) && closed ? 'area' : mark.props?.kind === 'trail' && !closed ? 'trail' : null;
      return kind && (!view || kind === 'rock' || kind === 'wall') ? [{ mark, kind, closed }] : [];
    });
  }

  /** 螢幕上的 p 點到哪個形狀的哪一塊：線（LINE_HIT_PX 內最近的）優先，再來是包住它的最小多邊形 */
  hitShape(p, view) {
    const ed = this.editor, at = [p.x, p.y];
    let line = null, poly = null;
    for (const s of this.shapes(view)) {
      ringsOf(s.mark.geometry).forEach((r, ring) => {
        const pts = r.map(q => ed.toScreen(q));
        if (s.closed) {
          if (inRing(at, pts) && (!poly || ringArea(pts) < poly.area)) poly = { ...s, ring, area: ringArea(pts) };
          // 點在邊上也算（大區域裡面常被小的岩石、區域蓋住，點它的邊就選得到）
          const edge = Math.min(...pts.map((b, i) => segmentDistance(at, pts[(i + pts.length - 1) % pts.length], b)));
          if (edge <= LINE_HIT_PX && (!line || edge < line.d)) line = { ...s, ring, d: edge };
        } else {
          const d = Math.min(...pts.slice(1).map((b, i) => segmentDistance(at, pts[i], b)));
          if (d <= LINE_HIT_PX && (!line || d < line.d)) line = { ...s, ring, d };
        }
      });
    }
    return line || poly;
  }

  /** 編輯模式：按住牆線本身、朝向箭頭（或按住 Shift 拖曳任何點）時，整條線／整個形狀一起平移；按端點（data-vertex）單獨拉頂點；按中間小圓點（mk-handle-mid）直接新增折點並拉動 */
  shapeDown(e) {
    if (!this.editing || this.drawing || this.aligning || e.button !== 0 || !this.editor) return;
    if (!e.shiftKey && e.target.closest?.('.mk-handle')) return;
    if (e.target.closest?.('.mk-control, button, input, label, a')) return;
    const r = this.box.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    const onSelectedHandle = e.target.closest?.('.mk-handle, .mk-edit-ring.selected, .mk-edit-face');
    const hit = onSelectedHandle && this.sel ? this.sel : this.hitShape(p, false);
    if (!hit) return;
    if (hit.kind === 'area' && !onSelectedHandle && hit.d === undefined) return;
    e.stopPropagation();
    e.preventDefault();
    if (!this.sel || this.sel.mark !== hit.mark || this.sel.ring !== (hit.ring ?? 0)) {
      this.selectShape(hit);
    }
    const s = this.sel;
    if (!s) return;
    const ringIdx = s.ring ?? 0;
    const origRings = ringsOf(s.mark.geometry);
    if (!origRings[ringIdx]) return;
    const origScreen = origRings[ringIdx].map(q => this.editor.toScreen(q));
    let moved = false;
    const round6 = (v) => Math.round(v * 1e6) / 1e6;
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId || !this.editor) return;
      const dx = ev.clientX - r.left - p.x, dy = ev.clientY - r.top - p.y;
      if (!moved && Math.hypot(dx, dy) < 2) return;
      if (!moved) {
        moved = true;
        this.dispatchEvent(new CustomEvent('editstart'));
      }
      const nextRing = origScreen.map(([sx, sy]) => this.editor.toLngLat([sx + dx, sy + dy]).map(round6));
      this.changeShape(origRings.map((ring, idx) => (idx === ringIdx ? nextRing : ring)));
    };
    const up = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /** 編輯模式：開著時點形狀選取、拖頂點、畫新的；關掉時只能點岩壁 */
  setEditing(on) {
    this.editing = !!on;
    this.cancelDraw();
    this.selectShape(null);
    this.syncBar();
  }

  /** 底圖：{ osm, ortho, contours }；底圖選單的勾、工具列的按鈕跟著 */
  setBase(basemap) {
    this.basemap = basemap;
    for (const box of this.menu.querySelectorAll('input[data-base]')) box.checked = !!basemap[box.dataset.base];
    this.editor?.set({ basemap, attribution: this.credits() });
  }
  toggleBase(key) { this.setBase({ ...this.basemap, [key]: !this.basemap[key] }); }

  /** 從清單選：選到這個節點在地圖上的形狀，縮放到看得到它；沒有形狀就只取消選取 */
  selectNode(id) {
    if (this.aligning) this.alignSketch(false);
    const s = this.shapes().find(x => x.mark.node === id);
    this.selectShape(s ? { ...s, ring: 0 } : null);
    if (s && this.editor) this.editor.focus({ points: ringsOf(s.mark.geometry).flat() });
  }

  /** 選一個形狀（{ mark, kind, closed, ring }）來改；null 取消 */
  selectShape(hit) {
    this.sel = hit ? { mark: hit.mark, kind: hit.kind, closed: hit.closed, ring: hit.ring ?? 0 } : null;
    this.applyEdit();
    this.syncBar();
    this.dispatchEvent(new CustomEvent('shapeselect', { detail: { id: this.sel?.mark.node ?? null } }));
  }

  applyEdit() {
    const ed = this.editor, s = this.sel;
    if (!ed) return;
    ed.setEdit(s ? { rings: ringsOf(s.mark.geometry), closed: s.closed, selected: s.ring, faces: s.kind === 'wall' } : undefined);
  }

  syncBar() {
    this.editBar.hidden = !this.editing || !this.editor;
    const drawing = !!this.drawing;
    for (const b of this.drawBtns) b.hidden = drawing;
    this.undoBtn.hidden = drawing;
    for (const x of this.seps) x.hidden = drawing;
    this.addVertexBtn.hidden = drawing || !this.sel;
    this.flipShapeBtn.hidden = drawing || this.sel?.kind !== 'wall';
    this.removeBtn.hidden = drawing || !this.sel;
    this.finishBtn.hidden = this.cancelBtn.hidden = !drawing;
    if (drawing) { this.finishBtn.title = T('cgFinishKindEnter', KIND_LABEL[this.drawing.kind]); this.finishBtn.setAttribute('aria-label', T('cgFinishKind', KIND_LABEL[this.drawing.kind])); }
  }

  /** 在選取的牆線或形狀最長的一段中間新增一個折點（頂點） */
  addVertex() {
    const s = this.sel;
    if (!s || !this.editor) return;
    const rings = ringsOf(s.mark.geometry);
    const ring = rings[s.ring ?? 0];
    if (!ring || ring.length < 2) return;
    const count = s.closed ? ring.length : ring.length - 1;
    let bestIdx = 0, bestLen = -1;
    for (let i = 0; i < count; i++) {
      const a = this.editor.toScreen(ring[i]), b = this.editor.toScreen(ring[(i + 1) % ring.length]);
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (d > bestLen) { bestLen = d; bestIdx = i; }
    }
    const a = ring[bestIdx], b = ring[(bestIdx + 1) % ring.length];
    const round6 = (v) => Math.round(v * 1e6) / 1e6;
    const mid = [round6((a[0] + b[0]) / 2), round6((a[1] + b[1]) / 2)];
    const nextRing = [...ring.slice(0, bestIdx + 1), mid, ...ring.slice(bestIdx + 1)];
    this.dispatchEvent(new CustomEvent('editstart'));
    this.changeShape(rings.map((r, idx) => (idx === (s.ring ?? 0) ? nextRing : r)));
  }

  /** 拖頂點、加頂點時：形狀直接改在標註上（畫面跟著動），停手 0.3 秒才發 shape 讓 App 存 */
  changeShape(rings) {
    const s = this.sel;
    if (!s) return;
    s.mark.geometry = geometryOf(rings, s.closed, /^Multi/.test(s.mark.geometry.type));
    this.redraw();
    clearTimeout(this.shapeTimer);
    this.shapeTimer = setTimeout(() => this.dispatchEvent(new CustomEvent('shape', { detail: { mark: s.mark, kind: s.kind } })), 300);
  }

  flipShape() {
    const s = this.sel;
    if (!s || s.kind !== 'wall') return;
    this.dispatchEvent(new CustomEvent('editstart'));
    this.changeShape(ringsOf(s.mark.geometry).map((r, i) => (i === s.ring ? [...r].reverse() : r)));
  }

  /** 刪掉選到的那塊；形狀只剩這塊就整個拿掉（發 remove） */
  removeShape() {
    const s = this.sel;
    if (!s) return;
    const rings = ringsOf(s.mark.geometry);
    this.dispatchEvent(new CustomEvent('editstart'));
    if (rings.length > 1) { s.ring = 0; this.changeShape(rings.filter((_, i) => i !== this.sel.ring)); this.applyEdit(); return; }
    this.sel = null;
    this.dispatchEvent(new CustomEvent('remove', { detail: { mark: s.mark } }));
  }

  /** 畫新的形狀；node 有給就是替這個（還沒有形狀的）節點畫 */
  startDraw(kind, node) {
    if (this.aligning) this.alignSketch(false);
    this.selectShape(null);
    this.drawing = { kind, node, closed: kind === 'rock' || kind === 'area', points: [] };
    this.editor?.set({ picking: true, draft: { points: [], closed: this.drawing.closed } });
    this.syncBar();
  }

  /** 畫好了：線至少兩點、多邊形三點，發 draw（App 問名稱、加進 Guidebook） */
  finishDraw() {
    const d = this.drawing;
    if (!d) return;
    if (d.points.length < (d.closed ? 3 : 2)) { this.dispatchEvent(new CustomEvent('hint', { detail: d.closed ? T('cgAtLeast3') : T('cgAtLeast2') })); return; }
    this.cancelDraw();
    this.dispatchEvent(new CustomEvent('draw', { detail: { kind: d.kind, node: d.node, geometry: geometryOf([d.points], d.closed, d.kind === 'area') } }));
  }

  cancelDraw() {
    this.drawing = null;
    this.editor?.set({ picking: false, draft: undefined });
    this.syncBar();
  }

  /** 標註改過：重畫底下的地圖（不重建編輯器，畫面位置、選取都留著） */
  redraw() {
    const ed = this.editor;
    if (!ed) return;
    ed.setData({ view: this.data.view, nodes: this.data.nodes });
    this.applyEdit();
  }

  destroy() {
    document.removeEventListener('keydown', this.onKey);
    this.editor?.destroy();
    this.host.replaceChildren();
    this.host.classList.remove('empty');
  }

  /** 版權標示：開著的底圖（作者自己在編輯，不顯示岩場的署名） */
  credits() {
    return [...BASEMAPS.filter(([k]) => this.basemap[k]).map(([k]) => ({ text: SOURCES[k].credit, href: SOURCES[k].href }))]
      .filter((c, i, all) => all.findIndex(x => x.text === c.text) === i);
  }

  /** 換資料時重建 MapEditor（畫面位置、選取、編輯模式留著） */
  build() {
    const before = this.editor?.getView();
    this.editor?.destroy();
    this.editor = null;
    this.host.classList.toggle('empty', !this.data);
    if (!this.data) return;
    const { view, nodes } = this.data;
    const ed = new WallEditor(this.box, { lang: 'zh', basemap: this.basemap, attribution: this.credits(), selected: this.selected ? { node: this.selected } : undefined });
    ed.setData({ view, nodes });
    if (before) ed.setView(before);
    ed.addEventListener('hit', (e) => {
      // 照片的視錐：點在頂點（拍照的位置）一定打開那張照片；點在扇形其他地方，編輯模式的形狀優先；畫新形狀時不看
      const photo = this.drawing ? null : this.hitWedge(e.detail);
      const open = () => queueMicrotask(() => this.dispatchEvent(new CustomEvent('photo', { detail: { id: photo.id } })));
      if (photo?.apex) { open(); return; }
      if (this.editing) {
        const shape = this.hitShape(e.detail, false);
        if (!shape && photo) { open(); return; }
        this.selectShape(shape); return;
      }
      if (photo) { open(); return; }
      const hit = this.hitShape(e.detail, true);
      queueMicrotask(() => this.dispatchEvent(new CustomEvent('pick', { detail: { id: hit?.mark.node ?? null } })));
    });
    ed.addEventListener('tap', (e) => {
      if (!this.drawing) return;
      this.drawing.points.push(e.detail.at.map(v => Math.round(v * 1e6) / 1e6));
      ed.set({ draft: { points: this.drawing.points, closed: this.drawing.closed } });
    });
    ed.addEventListener('editstart', () => this.dispatchEvent(new CustomEvent('editstart')));
    ed.addEventListener('editchange', (e) => this.changeShape(e.detail.rings));
    this.editor = ed;
    ed.onRender = () => { this.placeSketch(); this.drawWedges(); };
    this.placeSketch();
    this.drawWedges();
    if (this.drawing) ed.set({ picking: true, draft: { points: this.drawing.points, closed: this.drawing.closed } });
    this.applyEdit();
    this.syncBar();
  }
}
