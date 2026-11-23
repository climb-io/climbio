// Studio Wall 的岩點編輯器：一面牆的照片和岩點，選取、長按、圈起來、重描、合併、刪除、裁切範圍。
// RefineEditor.open({ photo, holds, crop, name, boxes, onSave(holds), onCrop(crop) }) ；改動停手 1.5 秒交給 onSave 存檔。
// 手動修正跟岩點貓的單點編輯同一套（docs/app.md「長按」「圈起來」）：頂點把手（擠在一起的併成一個）、拖完剪細尖、圈起來補點或重畫、重描合格就直接換上。
// 重描：這台存過 SAM2 模型（電腦版）用 SAM2 貼齊，否則用 HoldKit 在本機算；整面 SAM2 在 app.js，結果掛在岩點的 sam 上，
// 跟原外框不同的列進要看的，在這裡選「採用 SAM2」或「保留原外框」。
(function (root) {
'use strict';
const $ = id => document.getElementById(id);
const G = RefineGeo;
const T = AppKit.i18n.t;
const loadImage = blob => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(T('hlPhotoOpenFail'))); i.src = URL.createObjectURL(blob); });
const status = msg => { $('saveMsg').textContent = msg || ''; };
// ---- 校正 ----
// 操作：點岩點選取（細的岩點邊緣附近也點得到）、拖曳平移、滾輪縮放。選到岩點：拖頂點、拖邊中點新增頂點、點兩下頂點刪掉；
// Shift 點選或拖出範圍可以多選，選兩顆以上能合併。長按（原地按住 0.5 秒，跟岩點貓一樣）：按在岩點上（或外框外一點點）是選它（太小就放大），
// 按在空白處是打開「圈」：畫一圈補上這顆，放開後自動重描貼齊（不合用就留著畫的圈）。外框只在人動手時才變。
// 觸控（iPad、手機）：雙指開合縮放、平移；「多選」按鈕代替 Shift；手指點的範圍放大（tol）。
const V = { active: false, crop: null, tool: '', lp: 0, redo: [], mouse: null, img: null, ana: null, holds: [], sel: [], vert: -1, hover: null, flaggedOnly: false, scale: 1, tx: 0, ty: 0, drag: null, undo: [], timer: 0, lasso: null, busy: false, dups: new Map(), multi: false, coarse: false, fingers: new Map(), pinch: null, boxes: [] };
const cv = $('cv'), cx = cv.getContext('2d'), TOL = 8;
const handset = document.documentElement.classList.contains('ak-handset');   // 手機版面（appkit/landing.js）：選取後的動作列固定在底部
const holdOf = id => V.holds.find(h => h.id === id);
const tol = px => V.coarse ? px * 2.2 : px;   // 點擊的容許範圍（螢幕像素）：手指比滑鼠粗
const FLAG = { '退回橢圓': () => T('hlFlagEllipse'), '分數低': () => T('hlFlagLowScore'), '偵測信心低': () => T('hlFlagLowConf'), '候選對不上': () => T('hlFlagMismatch'), '邊緣不確定': () => T('hlFlagEdge'), '可能重複': () => T('hlFlagDup'), '與 SAM2 不同': () => T('hlFlagSam') };   // 旗標存在資料裡的是中文值，只在顯示時換語言
const flagText = f => FLAG[f] ? FLAG[f]() : f;
const pending = h => !!(h.sam && !h.sam.pick);   // SAM2 重描跟原外框不同、還沒決定的
const flagsOf = h => [...h.flags, ...(pending(h) ? ['與 SAM2 不同'] : []), ...(V.dups.has(h.id) ? ['可能重複'] : [])];
// 人動了這顆：旗標清掉；SAM2 還沒決定的記成人修的
const settle = h => { h.flags = []; if (pending(h)) h.sam.pick = 'edited'; };
// 裁切範圍外的岩點不算（發佈、要看的都只看範圍裡的）
const inCrop = h => { const c = V.crop; if (!c) return true; const b = bboxOf(h.poly), x = (b[0] + b[2]) / 2, y = (b[1] + b[3]) / 2; return x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h; };
const needLook = () => V.holds.filter(h => inCrop(h) && flagsOf(h).length);
const snap = () => JSON.stringify({ sel: V.sel, holds: V.holds });   // 復原連選取一起還原
const toImg = (x, y) => [(x - V.tx) / V.scale, (y - V.ty) / V.scale];
const toScr = (x, y) => [x * V.scale + V.tx, y * V.scale + V.ty];
const bboxOf = p => { const xs = p.map(q => q[0]), ys = p.map(q => q[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
const round1 = q => [Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10];
function area(p) { let a = 0; for (let i = 0; i < p.length; i++) { const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length]; a += x0 * y1 - x1 * y0; } return Math.abs(a) / 2; }
function inside(p, x, y) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > y) !== (p[j][1] > y) && x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; return c; }
function edgeDist(p, x, y) {   // 點到外框邊的最短距離（影像座標）
  let d = Infinity;
  for (let i = 0; i < p.length; i++) {
    const [ax, ay] = p[i], [bx, by] = p[(i + 1) % p.length], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L));
    d = Math.min(d, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return d;
}
function hit(x, y) {   // 點在裡面的取最小的；沒有就取邊緣 TOL 像素內最近的（細長的岩點也點得到）
  let best = null, ba = Infinity;
  for (const h of V.holds) if (inside(h.poly, x, y)) { const a = area(h.poly); if (a < ba) { ba = a; best = h; } }
  if (best) return best;
  const t = tol(TOL) / V.scale; let bd = t;
  for (const h of V.holds) { const b = bboxOf(h.poly); if (x < b[0] - t || x > b[2] + t || y < b[1] - t || y > b[3] + t) continue; const d = edgeDist(h.poly, x, y); if (d < bd) { bd = d; best = h; } }
  return best;
}
async function open(o) {
  V.name = o.name || ''; V.onSave = o.onSave || null; V.onCrop = o.onCrop || null; V.boxes = o.boxes || [];
  V.sel = []; V.undo = []; V.redo = []; V.lasso = null; V.samImg = null; V.dups = new Map(); V.tool = ''; V.vert = -1; V.flaggedOnly = false; V.crop = o.crop || null; V.ana = null;
  V.img = o.photo instanceof Blob ? await loadImage(o.photo) : o.photo;
  V.holds = o.holds.map(h => ({ ...h, flags: h.flags || [] }));
  V.orig = new Map(o.holds.map(h => [h.id, JSON.stringify(h.poly)]));   // 存檔時用來標「改過形狀」「自己畫的」
  V.active = true; V.changed = false; status('');
  fit(); refreshDups(); refreshSide(); draw();
  const f = needLook(); if (f.length) select(V.dups.has(f[0].id) && !f[0].flags.length && !pending(f[0]) ? [f[0].id, ...V.dups.get(f[0].id)] : [f[0].id], true);
}
async function close() { if (!V.active) return; clearTimeout(V.timer); await save(); V.active = false; V.tool = ''; V.lasso = null; }
function refreshDups() {   // 同一顆被偵測成多個框：開啟、改動後都重算
  V.dups = new Map();
  for (const [a, b] of G.dupPairs(V.holds, V.img.width, V.img.height)) {
    if ((holdOf(a).dupOk || []).includes(b) || (holdOf(b).dupOk || []).includes(a)) continue;
    (V.dups.get(a) || V.dups.set(a, []).get(a)).push(b); (V.dups.get(b) || V.dups.set(b, []).get(b)).push(a);
  }
}
function size() { const r = cv.getBoundingClientRect(); cv.width = r.width * devicePixelRatio; cv.height = r.height * devicePixelRatio; return r; }
function fit() { const r = size(); V.scale = Math.min(r.width / V.img.width, r.height / V.img.height); V.tx = (r.width - V.img.width * V.scale) / 2; V.ty = (r.height - V.img.height * V.scale) / 2; }
function path(p) { cx.beginPath(); p.forEach(([x, y], i) => i ? cx.lineTo(x, y) : cx.moveTo(x, y)); cx.closePath(); }
// HoldKit 外框：一個框（照片座標）→ 外框；整張照片的分析第一次用到才算
function outlineOf(box) {
  V.ana = V.ana || HoldKit.analysis(V.img, V.img.width, V.img.height);
  const poly = HoldKit.simplifyPoly(HoldKit.boxToPoly(box[0], box[1], box[2], box[3], HoldKit.outlineContext(V.ana, [box])));
  return poly && poly.length >= 3 ? poly.map(round1) : null;
}
// 頂點把手（同岩點貓 js/draw.js 的 handleList）：螢幕上離不到 HANDLE_GAP 的連續頂點併成一個（idx＝包含的頂點），拖它時合成一點；
// 放大就分得開。把手不到 3 個（岩點在螢幕上太小）就不放，放大再調。把手之間短於 MIN_EDGE 就不放邊中點
const HANDLE_GAP = 14, MIN_EDGE = 28;
function handleList(poly) {
  const px = 1 / V.scale, groups = [];
  poly.forEach((p, i) => {
    const g = groups[groups.length - 1], f = g && poly[g[0]];
    if (g && Math.hypot(p[0] - f[0], p[1] - f[1]) < HANDLE_GAP * px) g.push(i); else groups.push([i]);
  });
  if (groups.length > 1) {   // 頭尾相接：最後一組離第一組太近就併進去
    const last = groups[groups.length - 1], f = poly[last[0]], g0 = poly[groups[0][0]];
    if (Math.hypot(f[0] - g0[0], f[1] - g0[1]) < HANDLE_GAP * px) groups[0] = groups.pop().concat(groups[0]);
  }
  if (groups.length < 3) return { pts: [], mids: [] };
  const pts = groups.map(idx => { const p = poly[idx[idx.length >> 1]]; return { kind: 'v', i: idx[0], idx, x: p[0], y: p[1] }; });
  const mids = [];
  groups.forEach((g, k) => {
    const i = g[g.length - 1], p = poly[i], q = poly[groups[(k + 1) % groups.length][0]];
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) >= MIN_EDGE * px) mids.push({ kind: 'm', i, x: (p[0] + q[0]) / 2, y: (p[1] + q[1]) / 2 });
  });
  return { pts, mids };
}
// 把手包含好幾個頂點：合成一個放在 p，回傳新的外框和那一點的位置
function mergeHandle(poly, idx, p) {
  const drop = new Set(idx), out = [];
  let at = -1;
  poly.forEach((q, i) => { if (i === idx[0]) { at = out.length; out.push(p); } else if (!drop.has(i)) out.push(q); });
  return { poly: out, i: at };
}
function draw() {
  const k = devicePixelRatio, u = 1 / V.scale;
  cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, cv.width, cv.height);
  cx.setTransform(k * V.scale, 0, 0, k * V.scale, k * V.tx, k * V.ty);
  cx.drawImage(V.img, 0, 0); cx.lineJoin = 'round';
  const c = V.crop;
  if (c) { cx.fillStyle = 'rgba(0,0,0,.55)'; cx.fillRect(0, 0, V.img.width, c.y); cx.fillRect(0, c.y + c.h, V.img.width, V.img.height - c.y - c.h); cx.fillRect(0, c.y, c.x, c.h); cx.fillRect(c.x + c.w, c.y, V.img.width - c.x - c.w, c.h); }
  for (const h of V.holds) {
    const on = V.sel.includes(h.id), look = inCrop(h) && flagsOf(h).length;
    if (V.flaggedOnly && !look && !on) continue;
    cx.globalAlpha = inCrop(h) ? 1 : 0.3;
    path(h.poly);
    if (on) { cx.fillStyle = 'rgba(212,255,79,.22)'; cx.fill(); cx.strokeStyle = '#d4ff4f'; cx.lineWidth = 3 * u; }
    else if (V.hover && V.hover.id === h.id) { cx.fillStyle = 'rgba(255,255,255,.18)'; cx.fill(); cx.strokeStyle = '#fff'; cx.lineWidth = 2.5 * u; }
    else { cx.strokeStyle = look ? '#ffa000' : '#2fd32f'; cx.lineWidth = 2 * u; }
    cx.stroke();
    if (on && pending(h)) { path(h.sam.poly); cx.fillStyle = 'rgba(77,208,225,.16)'; cx.fill(); cx.strokeStyle = '#4dd0e1'; cx.lineWidth = 3 * u; cx.setLineDash([9 * u, 6 * u]); cx.stroke(); cx.setLineDash([]); }   // SAM2 的外框：跟選到的並排比較
  }
  cx.globalAlpha = 1;
  if (!V.holds.length && V.boxes.length) {   // 還沒描外框：先畫掃描到的岩點（虛線框）
    cx.strokeStyle = '#d4ff4f'; cx.lineWidth = 2.5 * u; cx.setLineDash([7 * u, 5 * u]);
    for (const b of V.boxes) cx.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
    cx.setLineDash([]);
  }
  if (V.tool === 'crop') {   // 裁切框：拖邊、拖角調整，框裡拖動整個移動；還沒有框就拖出一個
    const r = V.crop || { x: 0, y: 0, w: V.img.width, h: V.img.height };
    cx.strokeStyle = '#d4ff4f'; cx.lineWidth = 2.5 * u; cx.strokeRect(r.x, r.y, r.w, r.h);
    cx.fillStyle = '#d4ff4f'; for (const [x, y] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]) cx.fillRect(x - 6 * u, y - 6 * u, 12 * u, 12 * u);
  }
  const ep = V.tool || V.lasso ? null : editPoly();
  if (ep && !(V.drag && V.drag.vert && V.drag.moved)) {   // 把手：白色頂點、黃色邊中點（拖的時候收起來，只看外框和放大鏡）
    const { pts, mids } = handleList(ep);
    for (const m of mids) { cx.beginPath(); cx.arc(m.x, m.y, 4 * u, 0, 7); cx.fillStyle = 'rgba(250,204,21,.75)'; cx.fill(); cx.lineWidth = 1.5 * u; cx.strokeStyle = 'rgba(0,0,0,.6)'; cx.stroke(); }
    for (const v of pts) { cx.beginPath(); cx.arc(v.x, v.y, 6.5 * u, 0, 7); cx.fillStyle = v.idx.includes(V.vert) ? '#ff3d6e' : '#fff'; cx.fill(); cx.lineWidth = 2.5 * u; cx.strokeStyle = '#facc15'; cx.stroke(); }
  }
  const lp = V.drag && V.drag.loop;
  if (lp && lp.length > 1) {   // 畫到一半的圈：白線加深色描邊，起點黃點
    cx.lineCap = 'round'; cx.beginPath(); lp.forEach(([x, y], i) => i ? cx.lineTo(x, y) : cx.moveTo(x, y));
    cx.lineWidth = 6 * u; cx.strokeStyle = 'rgba(0,0,0,.55)'; cx.stroke(); cx.lineWidth = 3 * u; cx.strokeStyle = '#fff'; cx.stroke();
    cx.beginPath(); cx.arc(lp[0][0], lp[0][1], 5 * u, 0, 7); cx.fillStyle = '#facc15'; cx.fill(); cx.lineCap = 'butt';
  }
  if (V.drag && V.drag.marquee) { const [a, b] = V.drag.marquee; cx.strokeStyle = '#fff'; cx.lineWidth = u; cx.setLineDash([6 * u, 4 * u]); cx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); cx.setLineDash([]); }
  loupe();
  placeBar();
  toolState();
}
// 拖頂點時手指或游標蓋住頂點：放大鏡在上方（太靠上才換到下方，換邊要多過 40 px，不會上下跳），照原圖像素畫，十字線是頂點會落的位置；
// 比畫面再放大 2.5 倍，畫面已經放很大時最多到照片 1 px＝3 個螢幕點、至少 1.5 倍（同岩點貓）
let loupeBelow = false;
function loupe() {
  const d = V.drag; if (!d || !d.vert || !d.moved) return;
  const p = editPoly(); if (!p || !p[V.vert]) return;
  const R = 60, Z = Math.max(1.5, Math.min(2.5, 3 / V.scale)), k = devicePixelRatio, r = cv.getBoundingClientRect(), [sx, sy] = toScr(...p[V.vert]), [vx, vy] = p[V.vert];
  const up = sy - 60 - 2 * R;
  if (!d.loupe) { loupeBelow = up < 8; d.loupe = true; } else if (loupeBelow ? up >= 48 : up < 8) loupeBelow = !loupeBelow;
  const lx = Math.min(r.width - R - 8, Math.max(R + 8, sx)), ly = loupeBelow ? sy + 60 + R : sy - 60 - R, s = V.scale * Z * k;
  cx.setTransform(1, 0, 0, 1, 0, 0); cx.save();
  cx.beginPath(); cx.arc(lx * k, ly * k, R * k, 0, 7); cx.clip();
  cx.fillStyle = '#111'; cx.fillRect((lx - R) * k, (ly - R) * k, 2 * R * k, 2 * R * k);
  cx.setTransform(s, 0, 0, s, lx * k - vx * s, ly * k - vy * s);
  cx.drawImage(V.img, 0, 0); cx.lineJoin = 'round'; path(p);
  cx.strokeStyle = 'rgba(0,0,0,.5)'; cx.lineWidth = 2.5 / (V.scale * Z); cx.stroke(); cx.strokeStyle = '#facc15'; cx.lineWidth = 1.5 / (V.scale * Z); cx.stroke();
  cx.restore(); cx.setTransform(1, 0, 0, 1, 0, 0);
  cx.strokeStyle = '#fff'; cx.lineWidth = 3 * k; cx.beginPath(); cx.arc(lx * k, ly * k, R * k, 0, 7); cx.stroke();
  cx.lineWidth = 1.5 * k; cx.beginPath(); cx.moveTo((lx - 9) * k, ly * k); cx.lineTo((lx + 9) * k, ly * k); cx.moveTo(lx * k, (ly - 9) * k); cx.lineTo(lx * k, (ly + 9) * k); cx.stroke();
}
// 浮動工具列：跟著選到的岩點走，在旁邊；只放當下用得到的動作
function placeBar() {
  const bar = $('bar'), r = cv.getBoundingClientRect();
  let items = [], poly = null;
  const one = V.sel.length === 1 ? holdOf(V.sel[0]) : null;
  if (V.tool === 'crop') { items = [[T('done'), 'crop', true, 'go'], [T('hlRNoCrop'), 'noCrop', !!V.crop]].filter(x => x[2]); }
  else if (V.lasso) { poly = one ? one.poly : null; items = [[T('cancel'), 'cancel', true]]; }   // 圈的時候只留取消（Esc 也是）
  else if (V.sel.length >= 2) { poly = V.sel.flatMap(id => holdOf(id).poly); items = [[T('hlMerge'), 'merge', true, 'go'], [T('hlNotDup'), 'notDup', V.sel.some(id => (V.dups.get(id) || []).some(o => V.sel.includes(o)))], [T('hlDelete'), 'del', true]].filter(x => x[2]); }
  else if (one && V.vert >= 0) { poly = one.poly; items = [[T('hlDelVertex'), 'del', true, 'go']]; }
  else if (one) {
    poly = one.poly;
    items = pending(one) ? [[T('hlPickSam'), 'pickSam', true, 'go'], [T('hlKeepHk'), 'keepHk', true]]
      : [...(one.flags.length ? [[T('hlOk'), 'accept', true, 'go']] : []), ...(V.dups.has(one.id) ? [[T('hlMergeDup'), 'mergeDup', true, 'go'], [T('hlNotDup'), 'notDup', true]] : [])];
    items.push([T('hlLasso'), 'lasso', true], [V.busy ? T('hlRetracingOne') : T('hlRetrace'), 'retrace', true], [T('hlSmooth'), 'smooth', true], [T('hlDelete'), 'del', true]);
  }
  if (!items.length || V.drag && (V.drag.pan && V.drag.moved || V.drag.vert && V.drag.moved || V.drag.loop)) { bar.classList.remove('on'); return; }
  const sig = items.map(i => i[0]).join('|');
  if (bar.dataset.sig !== sig) { bar.dataset.sig = sig; bar.replaceChildren(...items.map(([t, a, , c]) => { const e = document.createElement('button'); e.textContent = t; if (c) e.className = c; e.onclick = () => act(a).catch(er => flash(er.message)); return e; })); }
  bar.classList.toggle('fix', !poly || handset);   // 手機、沒有岩點可以跟的（裁切、圈新的一顆）由 CSS 固定在底部；電腦、平板跟著外框走
  if (poly && !handset) {
    const b = bboxOf(poly), [x0, y0] = toScr(b[0], b[1]), [x1, y1] = toScr(b[2], b[3]);
    bar.style.left = Math.max(90, Math.min(r.width - 90, (x0 + x1) / 2)) + 'px';
    bar.style.top = Math.max(6, Math.min(r.height - 50, y0 - 58 < 6 ? y1 + 16 : y0 - 58)) + 'px';   // 離外框遠一點（上方 20 px、下方 16 px 的空隙）
  }
  bar.classList.add('on');
}
// 工具列的狀態：目前用的工具亮起來，復原、重做沒東西可以退時停用
function toolState() {
  const on = { crop: V.tool === 'crop', multi: V.multi, all: V.flaggedOnly };
  for (const [a, v] of Object.entries(on)) document.querySelectorAll(`[data-act="${a}"]`).forEach(b => b.classList.toggle('on', v));
  $('undoBtn').disabled = !V.undo.length; $('redoBtn').disabled = !V.redo.length;
}
// 要看的那顆的縮圖（照片裁出岩點和一圈周圍）
function thumbOf(h) {
  const c = document.createElement('canvas'), b = bboxOf(h.poly), s = Math.max(b[2] - b[0], b[3] - b[1]) * 1.8 || 1, cxx = (b[0] + b[2]) / 2, cyy = (b[1] + b[3]) / 2;
  c.width = c.height = 96;
  c.getContext('2d').drawImage(V.img, cxx - s / 2, cyy - s / 2, s, s, 0, 0, 96, 96);
  return c;
}
function refreshSide() {
  const f = needLook();
  const all = V.holds.filter(inCrop).length; $('count').innerHTML = `${T('hlLookCount', f.length)}<small>${T('hlOfTotal', all)}</small>`; $('foldCount').textContent = f.length;
  $('prog').firstChild.style.width = (all ? 100 * (1 - f.length / all) : 100) + '%';
  const list = $('list'); list.replaceChildren();
  for (const h of f.slice(0, 300)) {
    const d = document.createElement('div'), t = thumbOf(h), a = document.createElement('span');
    a.textContent = flagsOf(h).map(flagText).join(T('hlFlagSep'));
    d.append(t, a); if (V.sel.includes(h.id)) d.className = 'sel';
    d.onclick = () => { closeSheet(); select(V.dups.has(h.id) && !h.flags.length && !pending(h) ? [h.id, ...V.dups.get(h.id)] : [h.id], true); };
    list.append(d);
  }
  toolState();
}
function select(ids, center) {
  V.sel = ids.filter(id => holdOf(id)); V.vert = -1; V.lasso = null; cv.style.cursor = 'default';
  if (center && V.sel.length) {
    const b = bboxOf(V.sel.flatMap(id => holdOf(id).poly)), w = b[2] - b[0], h = b[3] - b[1], r = cv.getBoundingClientRect();
    const [x0, y0] = toScr(b[0], b[1]), [x1, y1] = toScr(b[2], b[3]);
    if (center === 'soft') {   // 已經在畫面裡就不動；不在才平移過去，縮放不變
      if (x0 < 20 || y0 < 20 || x1 > r.width - 20 || y1 > r.height - 20) { V.tx += r.width / 2 - (x0 + x1) / 2; V.ty += r.height / 2 - (y0 + y1) / 2; }
    } else if (center === 'small') {   // 長按選到的小岩點（螢幕上比指尖 44 px 小）：移到畫面中間、放大到約畫面寬的 1/3；夠大就不動（同岩點貓）
      const sz = Math.max(w, h);
      if (sz * V.scale < 44) { V.scale = Math.min(12, r.width / 3 / (sz || 1)); V.tx = r.width / 2 - (b[0] + w / 2) * V.scale; V.ty = r.height / 2 - (b[1] + h / 2) * V.scale; }
    } else {
      V.scale = Math.min(r.width / (w * 5), r.height / (h * 5), 6);
      V.tx = r.width / 2 - (b[0] + w / 2) * V.scale; V.ty = r.height / 2 - (b[1] + h / 2) * V.scale;
    }
  }
  refreshSide(); draw();
}
function step(dir, soft) {   // soft＝只換選取、完全不動視角（沒問題、不是重複之後用）；J／K 才置中放大
  const f = needLook();
  // 都確認完了：剛處理完最後一題（沒問題、不是重複…）就取消選取，不然還選著的岩點會跳出一般的合併、刪除工具列；J／K 沒有題目時不動
  if (!f.length) { if (soft) select([], false); return; }
  const at = f.findIndex(h => V.sel.includes(h.id)), next = f[((at < 0 ? (dir > 0 ? -1 : 0) : at) + dir + f.length) % f.length];
  select(V.dups.has(next.id) && !next.flags.length && !pending(next) ? [next.id, ...V.dups.get(next.id)] : [next.id], soft ? false : true);
}
function change(fn) {
  V.undo.push(snap()); if (V.undo.length > 50) V.undo.shift(); V.redo = [];
  fn(); refreshDups(); refreshSide(); draw();
  dirty();
}
const outHolds = () => V.holds.map(h0 => {   // 存出去的岩點：改過形狀記 edited、自己畫的記 manual（App 同一套意思）；flags、dupOk 由存的人決定要不要留
  const h = { ...h0 }, before = V.orig.get(h.id), now = JSON.stringify(h.poly);
  if (before === undefined) h.source = 'manual';
  else if (before !== now && h.source !== 'manual' && !(h.sam && h.sam.pick === 'sam' && now === JSON.stringify(h.sam.poly))) h.source = 'edited';   // 採用 SAM2 的不算人改
  return h;
});
const dirty = () => { V.changed = true; status(T('hlUnsaved')); clearTimeout(V.timer); V.timer = setTimeout(save, 1500); };
async function save() {
  clearTimeout(V.timer);
  if (!V.onSave || !V.changed) return;
  V.changed = false;
  try { status(await V.onSave(outHolds()) || T('hlSaved')); } catch (e) { status(T('hlSaveFail', e.message)); }
}
const newId = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4);
function flash(t) { const m = $('msg'); m.textContent = t; m.style.display = 'block'; clearTimeout(flash.t); flash.t = setTimeout(() => { m.style.display = 'none'; }, 2500); }
// 貼齊一個外框：這台存過 SAM2 模型（電腦版，不會為了這個下載 300 MB）就用 SAM2 以外框當提示描；沒有或描不出來就用 HoldKit 從外接框算
async function fitOutline(poly) {
  if (!handset && root.RefineSam && await RefineSam.isCached()) {
    try {
      await RefineSam.load();
      if (V.samImg !== V.img) { RefineSam.setPhoto(V.img, 'edit'); V.samImg = V.img; }
      const p = await RefineSam.fit(poly);
      if (p && p.length >= 3) return p.map(round1);
    } catch (e) { console.warn('SAM2 重描失敗，改用 HoldKit：', e.message); }
  }
  return outlineOf(bboxOf(poly));
}
// a 有幾成在 b 裡面（在 a 的外接框裡取樣 16×16）
function overlapIn(a, b) {
  const [x0, y0, x1, y1] = bboxOf(a), dx = (x1 - x0) / 16, dy = (y1 - y0) / 16;
  let n = 0, k = 0;
  for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) { const x = x0 + (i + 0.5) * dx, y = y0 + (j + 0.5) * dy; if (!inside(a, x, y)) continue; n++; if (inside(b, x, y)) k++; }
  return n ? k / n : 0;
}
// 「重描」：用目前的外框當提示重算。結果有效、包住原本的中心、不壓到旁邊的岩點（一半以上蓋在這顆上面的不算）、面積是原本的 1/5～5 倍才換上
// （算一步，復原拿得回來）；不合格留著原本的並提示（同岩點貓）。重描途中這顆被改、刪、復原了，晚回來的結果不用。
// auto：畫完圈自動貼齊，靜靜地做（不合格、失敗都留著畫的圈、不提示），換上時併進畫圈那一步，復原一次回到畫圈之前
async function retrace(id, { auto = false } = {}) {
  const h = holdOf(id); if (!h || V.busy) return;
  const before = h.poly, key = JSON.stringify(before), W = V.img.width, H = V.img.height;
  const b = bboxOf(before), mid = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], c = inside(before, ...mid) ? mid : before[0], a0 = area(before);
  V.busy = true; placeBar();
  let poly = null;
  try { poly = await fitOutline(before); } catch (e) { if (!auto) flash(T('hlRetraceFail', e.message)); }
  finally { V.busy = false; }
  const cur = holdOf(id);
  if (!V.active || !cur || JSON.stringify(cur.poly) !== key) { if (V.active) draw(); return; }
  poly = poly && G.trimPolySpikes(poly);
  const others = V.holds.filter(o => o.id !== id && overlapIn(o.poly, before) < 0.5);
  const good = poly && G.validPoly(poly, W, H) && inside(poly, ...c) && area(poly) / a0 > 0.2 && area(poly) / a0 < 5
    && !others.some(o => { const ob = bboxOf(o.poly), oc = [(ob[0] + ob[2]) / 2, (ob[1] + ob[3]) / 2]; return inside(poly, ...oc) || overlapIn(o.poly, poly) > 0.5; });
  if (!good) { if (!auto) flash(T('hlRetraceKept')); draw(); return; }
  if (auto) { cur.poly = poly; refreshDups(); refreshSide(); draw(); dirty(); }
  else change(() => { cur.poly = poly; settle(cur); });
}
// 圈起來：手畫的圈（去掉繞過起點多畫的一段、手抖）就是外框；有選到的岩點就換掉它，沒有就補一顆（同岩點貓 finishLasso）。放開後自動重描貼齊
function finishLasso(loop) {
  const k = V.scale, closed = loop.map(round1), W = V.img.width, H = V.img.height;
  if (closed.length < 6 || area(closed) * k * k < 400) { flash(T('hlLassoSmall')); draw(); return; }   // 畫得太小，多半是手滑；還在圈，可以再畫
  const poly = G.lassoOutline(closed, 1 / k);
  if (!G.validPoly(poly, W, H)) { flash(T('hlLassoFail')); draw(); return; }
  const target = V.lasso && V.lasso.target && holdOf(V.lasso.target);
  let id = target ? target.id : newId();
  V.lasso = null; cv.style.cursor = 'default';
  change(() => {
    if (target) { target.poly = poly; settle(target); } else V.holds.push({ id, poly, source: 'manual', score: 1, flags: [] });
    V.sel = [id]; V.vert = -1;
  });
  retrace(id, { auto: true });
}
function startLasso(target) {
  V.lasso = { target: target || null }; V.vert = -1; V.sel = target ? [target] : []; cv.style.cursor = 'crosshair';
  flash(T(target ? 'hlLassoRedo' : 'hlLassoHint')); refreshSide(); draw();
}
// 長按：按在岩點上（或外框外一點點）選它，太小就放大；按在空白處打開「圈」補一顆（外框只在人動手時才變）
function longPress(p) {
  const h = hit(...p);
  if (h) select([h.id], 'small'); else startLasso(null);
}
const setTool = t => { V.tool = V.tool === t ? '' : t; V.lasso = null; if (V.tool === 'crop') V.sel = []; cv.style.cursor = 'default'; refreshSide(); draw(); };
function delVertex() {   // 刪掉選到的頂點（併在一起的把手整組刪），至少留 3 點
  const one = V.sel.length === 1 ? holdOf(V.sel[0]) : null, ep = one && one.poly; if (!ep) return;
  const g = handleList(ep).pts.find(v => v.idx.includes(V.vert)), drop = new Set(g ? g.idx : [V.vert]);
  if (ep.length - drop.size < 3) { V.vert = -1; draw(); return; }
  change(() => { one.poly = ep.filter((_, i) => !drop.has(i)); settle(one); });
  V.vert = -1; draw();
}
async function act(a) {
  const one = V.sel.length === 1 ? holdOf(V.sel[0]) : null;
  if (a === 'next') step(1); else if (a === 'prev') step(-1);
  else if (a === 'crop') setTool(a);
  else if (a === 'noCrop') { V.crop = null; if (V.onCrop) V.onCrop(null); refreshSide(); draw(); }
  else if (a === 'retrace' && one) await retrace(one.id);
  else if (a === 'lasso' && one) startLasso(one.id);
  else if (a === 'cancel' && V.tool === 'crop') setTool('crop');
  else if (a === 'cancel' && V.lasso) { const t = V.lasso.target; V.lasso = null; cv.style.cursor = 'default'; V.sel = t && holdOf(t) ? [t] : []; refreshSide(); draw(); }   // 從岩點進來的回到它，長按空白處進來的不補
  else if (a === 'cancel') { V.sel = V.tool ? V.sel : []; V.tool = ''; V.vert = -1; cv.style.cursor = 'default'; refreshSide(); draw(); }
  else if (a === 'notDup' && V.sel.length) {
    const keep = (id, o) => V.sel.length === 1 || V.sel.includes(o);
    change(() => { for (const id of V.sel) { const h = holdOf(id), partners = (V.dups.get(id) || []).filter(o => keep(id, o)); h.dupOk = [...new Set([...(h.dupOk || []), ...partners])]; } });
    step(1, true);
  }
  else if (a === 'accept' && one) { change(() => { one.flags = []; one.dupOk = [...new Set([...(one.dupOk || []), ...(V.dups.get(one.id) || [])])]; }); step(1, true); }
  else if (a === 'pickSam' && one && pending(one)) { change(() => { one.poly = one.sam.poly; one.sam.pick = 'sam'; one.flags = []; }); step(1, true); }
  else if (a === 'keepHk' && one && pending(one)) { change(() => { one.sam.pick = 'keep'; one.flags = []; }); step(1, true); }
  else if (a === 'del' && V.vert >= 0 && one) delVertex();
  else if (a === 'del' && V.sel.length) { const ids = new Set(V.sel); change(() => { V.holds = V.holds.filter(h => !ids.has(h.id)); V.sel = []; }); }   // 刪完不跳走，畫面維持原樣
  else if (a === 'smooth' && one) { const p = G.polyOp([one.poly], { trim: true }); if (JSON.stringify(p) === JSON.stringify(one.poly)) flash(T('hlNothingTidy')); else change(() => { one.poly = p; settle(one); }); }
  else if (a === 'merge' || a === 'mergeDup') {
    const ids = one && V.dups.has(one.id) ? [one.id, ...V.dups.get(one.id)] : V.sel;
    if (ids.length >= 2) { const hs = ids.map(holdOf), poly = G.polyOp(hs.map(h => h.poly), { close: 0.03 }); change(() => { const keep = hs.reduce((m, h) => area(h.poly) > area(m.poly) ? h : m); keep.poly = poly; settle(keep); V.holds = V.holds.filter(h => h === keep || !ids.includes(h.id)); V.sel = [keep.id]; }); }
  }
  else if (a === 'redo' && V.redo.length) { V.undo.push(snap()); const o = JSON.parse(V.redo.pop()); V.holds = o.holds; V.sel = o.sel; V.vert = -1; V.lasso = null; refreshDups(); refreshSide(); draw(); dirty(); }
  else if (a === 'undo' && V.undo.length) { V.redo.push(snap()); const o = JSON.parse(V.undo.pop()); V.holds = o.holds; V.sel = o.sel; V.vert = -1; V.lasso = null; refreshDups(); refreshSide(); draw(); dirty(); }
  else if (a === 'all') { V.flaggedOnly = !V.flaggedOnly; refreshSide(); draw(); }
  else if (a === 'multi') { V.multi = !V.multi; refreshSide(); }
}
document.querySelectorAll('[data-act]').forEach(b => b.onclick = () => { closeSheet(); act(b.dataset.act).catch(e => flash(e.message)); });
addEventListener('keydown', e => {
  if (!V.active || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (e.metaKey || e.ctrlKey) {   // ⌘Z／Ctrl+Z 復原、⇧⌘Z／Ctrl+Y 重做
    if (k === 'z' || k === 'y') { e.preventDefault(); act(k === 'y' || e.shiftKey ? 'redo' : 'undo').catch(er => flash(er.message)); }
    return;
  }
  if (k === 'z' && e.shiftKey) { e.preventDefault(); act('redo'); return; }
  if (k === 'escape') { if (V.drag && V.drag.loop) { V.drag = null; draw(); return; } act('cancel'); return; }   // 畫到一半先丟掉這一圈，再按一次離開圈
  const map = { c: 'crop', j: 'next', arrowdown: 'next', k: 'prev', arrowup: 'prev', a: 'accept', x: 'del', delete: 'del', backspace: 'del', z: 'undo', b: 'all', m: 'merge', r: 'retrace', l: 'lasso', d: 'notDup', s: 'smooth' };
  if (map[k]) { e.preventDefault(); const a = map[k]; act(a === 'accept' && V.sel.length === 1 && holdOf(V.sel[0]) && pending(holdOf(V.sel[0])) ? 'keepHk' : a).catch(er => flash(er.message)); }
});
// 可以拖頂點、加頂點的外框：單選的那顆岩點
const editPoly = () => V.sel.length === 1 && holdOf(V.sel[0]) ? holdOf(V.sel[0]).poly : null;
// 螢幕座標碰到哪個把手：頂點容錯 20 px、邊中點 14 px，兩種都在範圍內時選比較近的（同岩點貓 hitHandle）；觸控再放大
function handleAt(x, y) {
  const p = editPoly(); if (!p) return null;
  const { pts, mids } = handleList(p);
  let best = null, bd = Infinity;
  for (const v of pts) { const [sx, sy] = toScr(v.x, v.y), d = Math.hypot(sx - x, sy - y); if (d < tol(20) * (V.coarse ? 0.75 : 1) && d < bd) { bd = d; best = v; } }
  for (const m of mids) { const [sx, sy] = toScr(m.x, m.y), d = Math.hypot(sx - x, sy - y); if (d < tol(14) * (V.coarse ? 0.75 : 1) && d < bd) { bd = d; best = m; } }
  return best;
}
// 裁切框：螢幕座標在框的哪個邊或角（位元：1 左 2 右 4 上 8 下）；框裡面是 16（整個移動）；都不是回 0（拖出新框）
function cropEdge(x, y, r) {
  const [x0, y0] = toScr(r.x, r.y), [x1, y1] = toScr(r.x + r.w, r.y + r.h), H = tol(10); let m = 0;
  if (x > x0 - H && x < x1 + H && y > y0 - H && y < y1 + H) { if (Math.abs(x - x0) < H) m |= 1; if (Math.abs(x - x1) < H) m |= 2; if (Math.abs(y - y0) < H) m |= 4; if (Math.abs(y - y1) < H) m |= 8; if (!m && x > x0 && x < x1 && y > y0 && y < y1) m = 16; }
  return m;
}
function dragCrop(d, q) {
  const W = V.img.width, Hh = V.img.height, MIN = 64, o = d.r, dx = q[0] - d.p[0], dy = q[1] - d.p[1], cl = (v, a, b) => Math.min(b, Math.max(a, v));
  let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
  if (d.crop === 32) { x0 = cl(Math.min(d.p[0], q[0]), 0, W); x1 = cl(Math.max(d.p[0], q[0]), 0, W); y0 = cl(Math.min(d.p[1], q[1]), 0, Hh); y1 = cl(Math.max(d.p[1], q[1]), 0, Hh); if (x1 - x0 < MIN || y1 - y0 < MIN) return V.crop; }
  else if (d.crop === 16) { const nx = cl(o.x + dx, 0, W - o.w), ny = cl(o.y + dy, 0, Hh - o.h); x0 = nx; y0 = ny; x1 = nx + o.w; y1 = ny + o.h; }
  else { if (d.crop & 1) x0 = cl(o.x + dx, 0, x1 - MIN); if (d.crop & 2) x1 = cl(o.x + o.w + dx, x0 + MIN, W); if (d.crop & 4) y0 = cl(o.y + dy, 0, y1 - MIN); if (d.crop & 8) y1 = cl(o.y + o.h + dy, y0 + MIN, Hh); }
  return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
}
function clickSelect(x, y, add) {   // 重疊時同一處再點一下換選下一顆（小到大，最後一顆再點取消選取）
  const hits = V.holds.filter(h => inside(h.poly, x, y)).sort((a, b) => area(a.poly) - area(b.poly)).map(h => h.id), at = hits.length ? hits.indexOf(V.sel[0]) : -1;
  const pick = hits.length ? (at < 0 || V.sel.length !== 1 ? hits[0] : hits[at + 1]) : (hit(x, y) || {}).id;
  if (add) { if (pick) select(V.sel.includes(pick) ? V.sel.filter(i => i !== pick) : [...V.sel, pick], false); return; }
  select(pick ? [pick] : [], false);
}
const local = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
cv.addEventListener('wheel', e => {
  e.preventDefault();
  const [x, y] = local(e), k = Math.exp(-e.deltaY * 0.0015), s = Math.min(12, Math.max(0.05, V.scale * k));
  V.tx = x - (x - V.tx) * s / V.scale; V.ty = y - (y - V.ty) * s / V.scale; V.scale = s; draw();
}, { passive: false });
function endDrag() {   // 放開事件沒送到（右鍵選單、Ctrl＋點擊、視窗失焦、手勢取消）時收掉拖曳，不然白框和平移會卡住、下一次點擊被當成接續
  if (!V.drag) return;
  clearTimeout(V.lp); V.drag = null; cv.style.cursor = V.lasso ? 'crosshair' : 'default'; draw();
}
cv.addEventListener('pointercancel', endDrag);
cv.addEventListener('lostpointercapture', endDrag);
cv.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('blur', endDrag);
// 雙指：開合縮放、一起移動平移（照兩指中點）；第二指放下就取消第一指正在做的（框、畫到一半的圈）
const mid = () => { const [a, b] = [...V.fingers.values()]; return { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1 }; };
function startPinch() {
  clearTimeout(V.lp); V.drag = null; const m = mid(); V.pinch = { ...m, scale: V.scale, tx: V.tx, ty: V.ty }; draw();
}
const capture = e => { try { cv.setPointerCapture(e.pointerId); } catch (er) { /* 指標已經放開 */ } };
cv.addEventListener('gesturestart', e => e.preventDefault());   // Safari：不讓整頁跟著縮放
cv.addEventListener('pointerdown', e => {
  V.coarse = e.pointerType === 'touch';
  if (e.pointerType === 'touch') {
    V.fingers.set(e.pointerId, local(e));
    if (V.fingers.size === 2) { capture(e); startPinch(); return; }
    if (V.fingers.size > 2 || V.pinch) return;
  }
  if (e.button !== 0 || e.ctrlKey) return;   // 只有左鍵；右鍵、中鍵、Mac 的 Ctrl＋點擊（＝右鍵）不動作
  endDrag();
  const [x, y] = local(e), p = toImg(x, y);
  capture(e);
  if (V.tool === 'crop') { const r = V.crop || { x: 0, y: 0, w: V.img.width, h: V.img.height }, m = cropEdge(x, y, r); V.drag = { crop: m || 32, p, r: { ...r } }; return; }
  if (V.lasso) { V.drag = { loop: [round1(p)], last: [x, y], moved: true }; draw(); return; }   // 圈：拖一圈，不平移、不拖頂點
  const hv = handleAt(x, y);
  if (hv) {
    V.drag = { vert: true, hh: hv, snap: snap(), moved: false, x, y };
    V.vert = hv.kind === 'v' ? hv.i : -1;
    V.drag.off = [hv.x - p[0], hv.y - p[1]];   // 頂點不跳到手指下，保持按下時的相對位置
    draw(); return;
  }
  V.vert = -1;
  V.drag = { x, y, tx: V.tx, ty: V.ty, p, moved: false, shift: e.shiftKey || V.multi };
  if (!V.tool && !e.shiftKey && !V.multi && !e.altKey) {   // 長按：原地按住 0.5 秒（拖曳、Shift、Alt 不算）
    const d = V.drag; clearTimeout(V.lp);
    V.lp = setTimeout(() => { if (V.drag !== d || d.moved) return; d.long = true; longPress(p); }, 500);
  }
});
cv.addEventListener('pointermove', e => {
  const [x, y] = local(e);
  if (V.fingers.has(e.pointerId)) V.fingers.set(e.pointerId, [x, y]);
  if (V.pinch) {
    if (V.fingers.size < 2) return;
    const m = mid(), q = V.pinch, s = Math.min(12, Math.max(0.05, q.scale * m.d / q.d));
    V.scale = s; V.tx = m.x - (q.x - q.tx) * s / q.scale; V.ty = m.y - (q.y - q.ty) * s / q.scale; draw(); return;
  }
  if (!V.drag && e.pointerType === 'touch') return;   // 手指沒有懸停
  if (!V.drag && V.tool === 'crop') { const m = cropEdge(x, y, V.crop || { x: 0, y: 0, w: V.img.width, h: V.img.height }); cv.style.cursor = !m ? 'crosshair' : m === 16 ? 'move' : (m & 3 && m & 12) ? 'nwse-resize' : m & 3 ? 'ew-resize' : 'ns-resize'; return; }
  if (!V.drag && V.lasso) return;
  if (!V.drag) {
    const h = hit(...toImg(x, y)), prev = V.hover;
    V.hover = h || null; if ((prev && prev.id) !== (h && h.id)) draw();
    cv.style.cursor = !V.tool && handleAt(x, y) ? 'move' : h ? 'pointer' : 'default';
    return;
  }
  const d = V.drag;
  if (d.crop) { V.crop = dragCrop(d, toImg(x, y)); draw(); return; }
  if (d.loop) { if (Math.hypot(x - d.last[0], y - d.last[1]) < 3) return; d.last = [x, y]; d.loop.push(round1(toImg(x, y))); draw(); return; }   // 每隔 3 個螢幕像素記一點
  if (d.long) return;   // 長按之後手指移動不做事
  if (d.vert) {
    if (!d.moved) {
      if (Math.hypot(x - d.x, y - d.y) < 4) return;
      d.moved = true;
      const h = holdOf(V.sel[0]), hh = d.hh;
      if (hh.kind === 'm') { V.vert = hh.i + 1; h.poly.splice(V.vert, 0, [hh.x, hh.y]); }   // 拖邊中點：插入新頂點
      else if (hh.idx.length > 1) { const m = mergeHandle(h.poly, hh.idx, [hh.x, hh.y]); h.poly = m.poly; V.vert = m.i; }   // 擠在一起的頂點：合成一個再拖
      else V.vert = hh.i;
    }
    const q = toImg(x, y);
    editPoly()[V.vert] = round1([Math.min(V.img.width, Math.max(0, q[0] + d.off[0])), Math.min(V.img.height, Math.max(0, q[1] + d.off[1]))]);
    draw(); return;
  }
  if (!d.moved && Math.hypot(x - d.x, y - d.y) > tol(4)) { d.moved = true; clearTimeout(V.lp); if (d.shift) d.marquee = [d.p, d.p]; else d.pan = true; }
  if (!d.moved) return;
  if (d.marquee) { d.marquee[1] = toImg(x, y); draw(); return; }
  cv.style.cursor = 'grabbing'; V.tx = d.tx + x - d.x; V.ty = d.ty + y - d.y; draw();
});
const liftFinger = e => { V.fingers.delete(e.pointerId); if (V.pinch && !V.fingers.size) V.pinch = null; };
cv.addEventListener('pointercancel', liftFinger);
cv.addEventListener('pointerup', e => {
  const pinching = !!V.pinch; liftFinger(e);
  if (pinching) { V.drag = null; return; }   // 雙指放開：剩下的那指不接著拖
  clearTimeout(V.lp);
  const d = V.drag; V.drag = null; cv.style.cursor = V.lasso ? 'crosshair' : 'default'; if (!d) return;
  if (d.loop) { finishLasso(d.loop); return; }
  if (d.long) { draw(); return; }
  if (d.crop) { const c = V.crop; if (c && c.x <= 0 && c.y <= 0 && c.w >= V.img.width && c.h >= V.img.height) V.crop = null; if (V.onCrop) V.onCrop(V.crop); refreshSide(); draw(); return; }
  if (d.vert) {
    if (d.moved) {
      const h = holdOf(V.sel[0]);
      h.poly = G.trimPolySpikes(h.poly, V.vert);   // 拖完把細尖剪掉（剛拖的這個頂點不動，可能是故意拉尖的）
      V.undo.push(d.snap); if (V.undo.length > 50) V.undo.shift(); V.redo = []; settle(h); V.vert = -1; refreshDups(); refreshSide(); dirty();
    }
    draw(); return;
  }
  if (d.marquee) { const [a, b] = d.marquee, x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]); select(V.holds.filter(h => { const bb = bboxOf(h.poly); return bb[0] >= x0 && bb[2] <= x1 && bb[1] >= y0 && bb[3] <= y1; }).map(h => h.id), false); return; }
  if (!d.moved) clickSelect(d.p[0], d.p[1], d.shift);
  else draw();
});
cv.addEventListener('dblclick', e => {
  const [x, y] = local(e), hv = V.tool || V.lasso ? null : handleAt(x, y);   // 雙擊頂點：刪掉
  if (hv && hv.kind === 'v') { V.vert = hv.i; delVertex(); }
});
addEventListener('resize', () => { if (V.active) { size(); draw(); } });
// 手機的底部面板：要看的清單往上展開；點了清單就收起來，照片回到整個畫面
const closeSheet = () => { if (!handset || !$('side').classList.contains('open')) return; $('side').classList.remove('open'); $('sheetBtn').classList.remove('on'); if (V.active) size(); };
$('sheetBtn').onclick = () => { const on = $('side').classList.toggle('open'); $('sheetBtn').classList.toggle('on', on); };
if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (V.active) { size(); draw(); } }).observe($('stage'));   // 面板展開、收起、手機轉向，照片區的大小跟著變
// 面板收合（記在這台瀏覽器）：收起來照片佔滿，只留一條窄軌顯示還要看幾顆
const foldSide = on => { $('side').classList.toggle('fold', on); $('fold').textContent = on ? '‹' : '›'; try { localStorage.setItem('spray.fold', on ? '1' : ''); } catch (e) { /* 沒有儲存空間就不記 */ } setTimeout(() => { size(); draw(); }, 200); };
$('fold').onclick = () => foldSide(!$('side').classList.contains('fold'));
try { if (localStorage.getItem('spray.fold')) { $('side').classList.add('fold'); $('fold').textContent = '‹'; } } catch (e) { /* 略過 */ }

root.RefineEditor = { open, close, save, get active() { return V.active; }, get crop() { return V.crop; } };
})(globalThis);
