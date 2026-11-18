// 匯入的分組預覽：各岩壁的相對位置（照片的拍照位置與朝向）。
import { layoutGroupsMap } from '../classify.js';
import { el } from '../crag/dom.js';

const T = (...a) => globalThis.AppKit.i18n.t(...a);   // 文字在呼叫時才查

export function renderGroupMap(box, groups) {
  if (!box) return;
  const layout = groups ? layoutGroupsMap(groups) : null;
  if (!layout || !layout.walls.length) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  box.hidden = false;
  const W = 680, H = 210, padX = 56, padY = 34;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const sEl = (tag, attrs = {}) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    return e;
  };
  const { minX, maxX, minY, maxY, spanX, spanY } = layout.bounds;
  const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
  const scale = Math.min((W - padX * 2) / spanX, (H - padY * 2) / spanY);
  const toScreen = ([x, y]) => [W / 2 + (x - midX) * scale, H / 2 - (y - midY) * scale];

  // 指北針與比例尺
  const compass = sEl('text', { x: W - 16, y: 22, 'text-anchor': 'end', fill: '#64748b', 'font-size': '12', 'font-weight': '700' });
  compass.textContent = T('stNorthUp');
  svg.append(compass);

  const rawStepM = 64 / scale;
  const stepM = rawStepM <= 3 ? 2 : rawStepM <= 7 ? 5 : rawStepM <= 15 ? 10 : rawStepM <= 35 ? 20 : 50;
  const barPx = Math.round(stepM * scale);
  const bx1 = W - 16, bx0 = bx1 - barPx, by = H - 14;
  svg.append(
    sEl('line', { x1: bx0, y1: by, x2: bx1, y2: by, stroke: '#64748b', 'stroke-width': 2 }),
    sEl('line', { x1: bx0, y1: by - 4, x2: bx0, y2: by + 4, stroke: '#64748b', 'stroke-width': 1.5 }),
    sEl('line', { x1: bx1, y1: by - 4, x2: bx1, y2: by + 4, stroke: '#64748b', 'stroke-width': 1.5 }),
  );
  const scaleTxt = sEl('text', { x: (bx0 + bx1) / 2, y: by - 6, 'text-anchor': 'middle', fill: '#64748b', 'font-size': '11' });
  scaleTxt.textContent = `${stepM} m`;
  svg.append(scaleTxt);

  const COLORS = ['#0284c7', '#0d9488', '#d97706', '#7c3aed', '#e11d48', '#2563eb', '#059669', '#ea580c'];
  for (const [wi, w] of layout.walls.entries()) {
    const color = COLORS[wi % COLORS.length];
    const [x0, y0] = toScreen(w.p0);
    const [x1, y1] = toScreen(w.p1);
    const [cx, cy] = toScreen(w.center);

    // 拍照點與視線虛線
    for (const cam of w.cameras) {
      const [sx, sy] = toScreen([cam.x, cam.y]);
      svg.append(
        sEl('line', { x1: sx, y1: sy, x2: cx, y2: cy, stroke: color, 'stroke-opacity': 0.22, 'stroke-width': 1, 'stroke-dasharray': '3 3' }),
        sEl('circle', { cx: sx, cy: sy, r: 2.6, fill: color, 'fill-opacity': 0.45 }),
      );
    }

    const g = sEl('g', { class: 'gm-wall', 'data-wall-idx': w.index });
    // 確保螢幕上岩壁線段至少有 18px 長度好辨識
    let lx0 = x0, ly0 = y0, lx1 = x1, ly1 = y1;
    const segLen = Math.hypot(lx1 - lx0, ly1 - ly0);
    if (segLen < 18) {
      const ux = segLen > 0.5 ? (lx1 - lx0) / segLen : 1;
      const uy = segLen > 0.5 ? (ly1 - ly0) / segLen : 0;
      lx0 = cx - ux * 9; ly0 = cy - uy * 9;
      lx1 = cx + ux * 9; ly1 = cy + uy * 9;
    }
    g.append(sEl('line', { class: 'wall-seg', x1: lx0, y1: ly0, x2: lx1, y2: ly1, stroke: color, 'stroke-width': 4, 'stroke-linecap': 'round' }));

    // 岩壁正面朝向短線（指向攀爬面／拍照側）
    if (typeof w.aspect === 'number') {
      const rad = (w.aspect * Math.PI) / 180;
      const nx = cx + Math.sin(rad) * 8;
      const ny = cy - Math.cos(rad) * 8;
      g.append(sEl('line', { x1: cx, y1: cy, x2: nx, y2: ny, stroke: color, 'stroke-width': 2.2, 'stroke-linecap': 'round' }));
    }

    const labelText = w.aspectLabel ? `${w.name} (${w.aspectLabel})` : w.name;
    const pillW = Math.max(48, labelText.length * 11 + 12);
    const py = cy - 16;
    g.append(
      sEl('rect', { x: cx - pillW / 2, y: py - 10, width: pillW, height: 18, rx: 9, fill: '#ffffff', stroke: color, 'stroke-width': 1.5 }),
    );
    const txt = sEl('text', { x: cx, y: py + 3, 'text-anchor': 'middle', fill: '#0f172a', 'font-size': '11.5', 'font-weight': '700' });
    txt.textContent = labelText;
    g.append(txt);

    g.addEventListener('click', () => {
      const card = document.querySelector(`#groups .gcard[data-group-idx="${w.index}"]`);
      if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      card.classList.add('flash');
      setTimeout(() => card.classList.remove('flash'), 1200);
    });
    svg.append(g);
  }

  const head = el('div', { className: 'gm-head' },
    el('span', { textContent: T('stAreaCount', layout.walls.length) }),
  );
  box.replaceChildren(head, svg);
}
