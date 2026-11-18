// 首頁的流動（index.html、en/index.html 共用）：
//   1. 真實岩牆：用岩點貓公開牆的真實資料（原岩萬華 2F，demo/wanhua-wall.json 的岩點外框、wanhua-routes.json 的路線）畫岩點貓的路線圖——掃出岩點、路線的岩點留彩色、線從起攀流到完攀
//   2. 整頁一條線：經過每一章的標題（像一條路線經過岩點），捲到哪裡亮到哪裡
//   3. 開發者：同一份資料兩種讀法，點 JSON 裡的岩點 id，左邊的牆上同一顆亮起來（沒人操作時自己一顆一顆走）
// 「減少動態效果」時不播動畫，直接畫完成的樣子。資料讀不到時保留原本的照片，不影響入口。
// English: homepage motion. Draws the demo wall route from the open-format example files, the page-long flow line, and the human/AI dual view.
(() => {
  const ROOT = document.documentElement.dataset.root || '';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const visible = (node, fn, margin = '0px') => {
    if (!('IntersectionObserver' in window)) { fn(); return; }
    const io = new IntersectionObserver((es) => { if (es.some(e => e.isIntersecting)) { io.disconnect(); fn(); } }, { rootMargin: margin, threshold: 0.25 });
    io.observe(node);
  };

  // ---- 頁首：在深色首屏上換深色 ----
  const top = document.querySelector('.home-top'), hero = document.querySelector('.hero');
  if (top && hero) {
    const dark = () => top.classList.toggle('on-dark', hero.getBoundingClientRect().bottom > top.offsetHeight);
    addEventListener('scroll', dark, { passive: true });
    dark();
  }

  // ---- 示範牆 ----
  const centroid = (ring) => { let x = 0, y = 0; for (const [px, py] of ring) { x += px; y += py; } return [x / ring.length, y / ring.length]; };
  /** 一面牆的路線圖：底圖灰階變暗，路線的岩點用原色（照片剪成岩點的形狀），一條線依高度從起攀接到完攀 */
  function wallSvg(view, route, { label }) {
    const holds = new Map(view.marks.filter(m => m.geometry?.type === 'Polygon').map(m => [m.node, m.geometry.coordinates[0]]));
    const roles = route.props.holds, ids = Object.keys(roles).filter(id => holds.has(id));
    const pts = ids.map(id => [id, ...centroid(holds.get(id))]);
    const xs = pts.map(p => p[1]), ys = pts.map(p => p[2]), pad = 170;
    const box = [Math.max(0, Math.min(...xs) - pad), Math.max(0, Math.min(...ys) - pad)];
    const vb = [box[0], box[1], Math.min(view.w, Math.max(...xs) + pad) - box[0], Math.min(view.h, Math.max(...ys) + pad) - box[1]];
    const uid = Math.random().toString(36).slice(2, 7), href = ROOT + 'demo/wanhua-wall.jpg';
    const svg = el('svg', { class: 'wall-svg', viewBox: vb.join(' '), preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': label });
    const defs = el('defs');
    const gray = el('filter', { id: `g${uid}` });
    gray.append(el('feColorMatrix', { type: 'saturate', values: '0' }), Object.assign(el('feComponentTransfer'), {}));
    gray.lastChild.append(el('feFuncR', { type: 'linear', slope: '.5' }), el('feFuncG', { type: 'linear', slope: '.5' }), el('feFuncB', { type: 'linear', slope: '.5' }));
    const clip = el('clipPath', { id: `c${uid}` });
    for (const id of ids) clip.append(el('polygon', { points: holds.get(id).map(p => p.join(',')).join(' ') }));
    const scan = el('linearGradient', { id: `s${uid}`, x1: 0, y1: 1, x2: 0, y2: 0 });
    scan.append(el('stop', { offset: '0', 'stop-color': '#B6F000', 'stop-opacity': '0' }), el('stop', { offset: '.9', 'stop-color': '#B6F000', 'stop-opacity': '.35' }), el('stop', { offset: '1', 'stop-color': '#fff', 'stop-opacity': '.8' }));
    defs.append(gray, clip, scan);
    svg.append(defs, el('image', { href, x: 0, y: 0, width: view.w, height: view.h, filter: `url(#g${uid})` }));
    // 掃描：所有岩點依高度（下往上）一顆顆亮起，再退成灰
    const all = el('g');
    for (const [id, ring] of holds) {
      const [, cy] = centroid(ring);
      const p = el('polygon', { class: 'hold', points: ring.map(q => q.join(',')).join(' '), 'data-h': id });
      p.style.setProperty('--d', (0.1 + 1.1 * (1 - (cy - vb[1]) / vb[3])).toFixed(2));
      all.append(p);
    }
    const sweep = el('rect', { class: 'scan', x: vb[0], y: vb[1] + vb[3] * 0.7, width: vb[2], height: vb[3] * 0.3 });
    sweep.setAttribute('fill', `url(#s${uid})`);
    sweep.style.transformBox = 'fill-box';
    const color = el('image', { class: 'route-color', href, x: 0, y: 0, width: view.w, height: view.h, 'clip-path': `url(#c${uid})` });
    const outline = el('g');
    for (const id of ids) outline.append(el('polygon', { class: 'route-hold', points: holds.get(id).map(q => q.join(',')).join(' ') }));
    // 線：起攀 → 依高度往上 → 完攀（起攀以下的是腳點，不接）
    const start = pts.find(p => roles[p[0]] === 's') || pts.reduce((a, b) => (b[2] > a[2] ? b : a));
    const order = [start, ...pts.filter(p => p !== start && p[2] < start[2] && roles[p[0]] !== 't').sort((a, b) => b[2] - a[2]), ...pts.filter(p => roles[p[0]] === 't')];
    const d = order.map((p, i) => {
      if (!i) return `M${p[1]} ${p[2]}`;
      const q = order[i - 1], my = (q[2] + p[2]) / 2;
      return `C${q[1]} ${my} ${p[1]} ${my} ${p[1]} ${p[2]}`;
    }).join(' ');
    const line = el('path', { class: 'route-line', d }), pulse = el('path', { class: 'route-pulse', d, pathLength: 260 });
    const tag = (p, text) => { const t = el('text', { class: 'role', x: p[1] + 60, y: p[2] + 20 }); t.textContent = text; return t; };
    const top = order[order.length - 1];
    svg.append(all, sweep, color, outline, line, pulse, tag(start, 'S'), tag(top, 'T'));
    return { svg, line, holds: all };
  }
  function play(host, built) {
    const len = built.line.getTotalLength();
    built.line.style.strokeDasharray = `${len}`;
    built.line.style.strokeDashoffset = `${len}`;
    if (reduce) { host.classList.add('done'); return; }
    visible(host, () => host.classList.add('play'));
  }

  // ---- 開發者：同一份資料兩種讀法 ----
  function dual(pane, code, view, route, label) {
    const built = wallSvg(view, route, { label });
    pane.querySelector('img')?.remove();
    pane.append(built.svg);
    pane.classList.add('done');
    const json = JSON.stringify(route, null, 2);
    const esc = (s) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    code.innerHTML = esc(json)
      .replace(/"(\w+)":/g, '<span class="k">"$1"</span>:')
      .replace(/: "([^"]*)"/g, ': <span class="s">"$1"</span>')
      .replace(/<span class="k">"(h[0-9a-z]{6,})"<\/span>/g, '<button type="button" class="jid" data-h="$1">"$1"</button>');
    const ids = [...code.querySelectorAll('.jid')];
    const pick = (id) => {
      for (const b of ids) b.classList.toggle('on', b.dataset.h === id);
      for (const p of built.holds.querySelectorAll('.hold')) p.classList.toggle('pick', p.dataset.h === id);
    };
    let i = 0, timer = 0;
    const stop = () => { clearInterval(timer); timer = 0; };
    for (const b of ids) {
      b.addEventListener('click', () => { stop(); pick(b.dataset.h); });
      b.addEventListener('mouseenter', () => { stop(); pick(b.dataset.h); });
      b.addEventListener('focus', () => { stop(); pick(b.dataset.h); });
    }
    built.svg.addEventListener('click', (e) => {
      const id = e.target.closest?.('[data-h]')?.dataset.h;
      if (!id || !ids.some(b => b.dataset.h === id)) return;
      stop(); pick(id);
      ids.find(b => b.dataset.h === id)?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    });
    if (!reduce && ids.length) visible(pane, () => { timer = setInterval(() => pick(ids[i++ % ids.length].dataset.h), 1400); });
  }

  Promise.all(['wanhua-wall.json', 'wanhua-routes.json'].map(f => fetch(`${ROOT}demo/${f}`).then(r => (r.ok ? r.json() : Promise.reject(new Error(`${f} ${r.status}`))))))
    .then(([view, layer]) => {
      const route = layer.nodes.find(n => n.type === 'route');
      const stage = document.querySelector('[data-wall-stage]');
      if (stage) {
        const built = wallSvg(view, route, { label: stage.querySelector('img')?.alt || '' });
        stage.querySelector('img')?.remove();
        stage.append(built.svg);
        play(stage, built);
      }
      const pane = document.querySelector('[data-wall-dual]'), code = document.querySelector('[data-route-json]');
      if (pane && code) dual(pane, code, view, route, pane.querySelector('img')?.alt || '');
      spine();
    })
    .catch((err) => console.warn("示範牆資料", err));

  const outdoor = document.querySelector('.app-card.outdoor');
  if (outdoor && !reduce) visible(outdoor, () => outdoor.classList.add('play'));

  // ---- 整頁一條線：經過每一章的標題，捲到哪裡亮到哪裡 ----
  const main = document.querySelector('main.home');
  const marks = [...document.querySelectorAll('[data-flow-node]')];
  let svg, lit, nodes = [], total = 0, stops = [];
  function spine() {
    if (!main || marks.length < 2) return;
    const mr = main.getBoundingClientRect(), pad = parseFloat(getComputedStyle(main).paddingLeft) || 20;
    const x = Math.max(8, Math.round(pad * 0.42)), amp = Math.max(4, pad * 0.28);
    const pts = marks.map(m => { const r = m.getBoundingClientRect(); return [x, r.top - mr.top + Math.min(r.height / 2, 28)]; });
    const end = main.scrollHeight - 40;
    let d = `M${x} ${pts[0][1]}`;
    const all = [...pts, [x, end]];
    for (let i = 1; i < all.length; i++) {
      const [, y0] = all[i - 1], [, y1] = all[i], dy = y1 - y0, s = i % 2 ? amp : -amp;
      d += ` C${x + s} ${y0 + dy * 0.35} ${x - s} ${y0 + dy * 0.65} ${x} ${y1}`;
    }
    if (!svg) {
      svg = el('svg', { class: 'flow-spine', 'aria-hidden': 'true' });
      const g = el('linearGradient', { id: 'spineGrad', x1: 0, y1: 0, x2: 0, y2: 1, gradientUnits: 'objectBoundingBox' });
      g.append(el('stop', { offset: '0', 'stop-color': '#B6F000' }), el('stop', { offset: '1', 'stop-color': '#0FADEA' }));
      const defs = el('defs'); defs.append(g);
      svg.append(defs, el('path', { class: 'track' }), lit = el('path', { class: 'lit' }));
      if (!reduce) svg.append(el('path', { class: 'pulse' }));
      main.prepend(svg);
      addEventListener('scroll', progress, { passive: true });
    }
    svg.setAttribute('height', main.scrollHeight);
    svg.setAttribute('viewBox', `0 0 ${mr.width} ${main.scrollHeight}`);
    svg.style.height = `${main.scrollHeight}px`;
    for (const p of svg.querySelectorAll('path')) p.setAttribute('d', d);
    total = lit.getTotalLength();
    lit.style.strokeDasharray = `${total}`;
    nodes.forEach(n => n.remove());
    nodes = pts.map(([nx, ny]) => { const c = el('circle', { class: 'node', cx: nx, cy: ny, r: 6 }); svg.append(c); return c; });
    stops = pts.map(p => p[1]);
    progress();
  }
  function progress() {
    if (!svg) return;
    const mr = main.getBoundingClientRect(), head = innerHeight * 0.62 - mr.top;
    const y = reduce ? Infinity : head;
    const ratio = Math.max(0, Math.min(1, (y - stops[0]) / ((main.scrollHeight - 40) - stops[0])));
    lit.style.strokeDashoffset = `${total * (1 - ratio)}`;
    nodes.forEach((n, i) => n.classList.toggle('on', stops[i] <= y));
  }
  let resize = 0;
  addEventListener('resize', () => { cancelAnimationFrame(resize); resize = requestAnimationFrame(spine); });
  // 不用 requestAnimationFrame：分頁在背景時它不跑，線就一直沒畫
  addEventListener('load', spine);
  if (document.fonts?.ready) document.fonts.ready.then(spine);
})();
