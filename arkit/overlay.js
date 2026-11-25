// AR 看線的疊圖：岩點貓用的外觀（細霓虹外框＋柔光、起攀／完攀瞄準框、認到牆的鎖定掃描、換線時照出手順序一顆顆鎖定）。
// 只負責畫：哪條線、拖到哪、何時換線由 view.js 轉交（岩點貓用 postMessage 送來，見 arkit/README.md「換線」）。
// 效能：每次重畫只做一次半解析度模糊（光暈），其餘都是線條；動畫只在換線、鎖定的那一下要求連續重畫。
// English: AR overlay renderer — neon hold contours with soft bloom, lock-on brackets for start/top, wall lock scan, staggered route reveal.

const LOCK_MS = 750;        // 認到牆：牆面四角框收攏＋掃描線
const OUT_MS = 220;         // 換線：舊路線淡出
const HOLD_IN_S = 0.32;     // 每顆岩點描完外框的時間
const ACCENT = '#d4ff4f';   // 岩點貓的操作色（鎖定框、掃描線）

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeOut = (x) => 1 - (1 - x) ** 3;

export function createArOverlay(G, { reducedMotion = false } = {}) {
  const glowSrc = document.createElement('canvas');
  const glowDst = document.createElement('canvas');
  let blurOk = null;
  const canBlur = () => {
    if (blurOk !== null) return blurOk;
    try { const c = document.createElement('canvas').getContext('2d'); c.filter = 'blur(2px)'; blurOk = c.filter === 'blur(2px)'; } catch { blurOk = false; }
    return blurOk;
  };

  // 換線、鎖定的動畫狀態（時間用 performance.now()）
  let routeT0 = -1e9;       // 目前路線開始顯示（進場動畫的起點）
  let outgoing = null;      // { holds, t0, dir } 換線時淡出的上一條
  let lockT0 = -1e9;        // 最近一次認到牆
  let drag = 0;             // 拖到相鄰路線的比例（-1..1，正＝下一條）

  const api = {
    /** 換線：舊的淡出、新的照出手順序進場；dir 是換線方向（+1 下一條、-1 上一條） */
    switchRoute(prevHolds, dir, now = performance.now()) {
      outgoing = reducedMotion || !prevHolds?.length ? null : { holds: prevHolds, t0: now, dir: dir || 1 };
      routeT0 = reducedMotion ? -1e9 : now + (outgoing ? 90 : 0);
      drag = 0;
    },
    /** 第一次（或掉追蹤後再次）認到牆 */
    locked(now = performance.now()) {
      if (reducedMotion) return;
      lockT0 = now;
      routeT0 = now + 260;
    },
    setDrag(p) { drag = Math.max(-1, Math.min(1, Number(p) || 0)); },
    get drag() { return drag; },
    /** 還有動畫在跑：呼叫端要每一幀重畫 */
    animating(now = performance.now()) {
      if (drag) return true;
      if (now - lockT0 < LOCK_MS) return true;
      if (outgoing && now - outgoing.t0 < OUT_MS + 200) return true;
      return now - routeT0 < 1500;   // 進場：最多 0.85 秒排完順序＋每顆 0.32 秒
    },
    /**
     * 畫一幀。
     * current／neighbor：[{ id, role, poly, step, color }]（neighbor 是拖曳中露出的相鄰路線，可省略）
     * M：照片座標 → 畫面（CSS px）的 3×3 單應矩陣；photo：{ w, h }；labels：{ s, t }；volumes：Set
     * source：跟疊圖一樣大的彩色相機畫面（預覽畫布）。給了就把路線岩點用原本的顏色畫回來——
     * 相機畫面本身由 CSS 轉成灰階、調暗（style.css），路線岩點在灰底上跳出來（跟岩點貓看路線圖一樣）
     */
    draw(ctx, { stageW, stageH, dpr, M, photo, current, neighbor, labels, volumes, seq, source, now = performance.now() }) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const project = (holds) => {
        const out = [];
        for (const h of holds || []) {
          const pts = [];
          let ok = true;
          for (const [px, py] of h.poly) {
            const p = G.applyHomography(M, px, py);
            if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) { ok = false; break; }
            pts.push(p);
          }
          if (!ok || pts.length < 3) continue;
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, cx = 0, cy = 0, per = 0;
          for (let i = 0; i < pts.length; i++) {
            const [x, y] = pts[i], [nx, ny] = pts[(i + 1) % pts.length];
            if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
            cx += x; cy += y; per += Math.hypot(nx - x, ny - y);
          }
          // 畫面外很遠的不畫（省時間，也避免很大的路徑）
          if (x1 < -80 || y1 < -80 || x0 > stageW + 80 || y0 > stageH + 80) continue;
          out.push({ ...h, pts, box: [x0, y0, x1, y1], c: [cx / pts.length, cy / pts.length], per, vol: volumes?.has(h.id) });
        }
        out.sort((a, b) => Number(b.vol) - Number(a.vol));   // Volume 先畫，上面的點蓋在上面
        return out;
      };

      // 每一層：{ holds, alpha, prog(h) }，prog 是這顆的進場進度 0..1
      const layers = [];
      const steps = Math.max(1, ...(current || []).map((h) => (h.step ?? 0) + 1));
      const stepS = Math.min(0.11, 0.85 / steps);
      const tIn = (now - routeT0) / 1000;
      const dragK = Math.abs(drag);
      if (outgoing) {
        const k = clamp01((now - outgoing.t0) / OUT_MS);
        if (k >= 1) outgoing = null;
        else layers.push({ holds: project(outgoing.holds), alpha: 1 - easeOut(k), prog: () => 1, out: true });
      }
      layers.push({
        holds: project(current),
        alpha: 1 - 0.7 * dragK,
        prog: (h) => (reducedMotion ? 1 : clamp01((tIn - (h.step ?? 0) * stepS) / HOLD_IN_S)),
      });
      if (neighbor?.length && dragK > 0.01) layers.push({ holds: project(neighbor), alpha: 0.55 * easeOut(dragK), prog: () => 1, ghost: true });

      if (source) drawColor(ctx, layers, source, dpr);
      drawLock(ctx, M, photo, now);
      drawGlow(ctx, layers, dpr, now);
      for (const L of layers) drawLayer(ctx, L, labels, now);
      if (seq?.length && !dragK) drawPath(ctx, layers[layers.length - 1], seq, now);
    },
  };

  // 路線岩點用原本的顏色：把彩色的相機畫面剪成岩點的形狀畫上去（進場中的岩點照進度淡入）。
  // 已經進場完的岩點合成一個剪裁路徑只畫一次，整面牆再多點也只多一次 drawImage
  function drawColor(ctx, layers, source, dpr) {
    const w = source.width / dpr, h = source.height / dpr;
    for (const L of layers) {
      if (L.alpha <= 0.01) continue;
      const done = [];
      for (const hd of L.holds) {
        const p = L.prog(hd);
        if (p <= 0) continue;
        if (p >= 1) { done.push(hd); continue; }
        ctx.save();
        ctx.globalAlpha = L.alpha * easeOut(p);
        trace(ctx, hd.pts);
        ctx.clip();
        ctx.drawImage(source, 0, 0, w, h);
        ctx.restore();
      }
      if (!done.length) continue;
      ctx.save();
      ctx.globalAlpha = L.alpha;
      ctx.beginPath();
      for (const hd of done) {
        ctx.moveTo(hd.pts[0][0], hd.pts[0][1]);
        for (let i = 1; i < hd.pts.length; i++) ctx.lineTo(hd.pts[i][0], hd.pts[i][1]);
        ctx.closePath();
      }
      ctx.clip('nonzero');
      ctx.drawImage(source, 0, 0, w, h);
      ctx.restore();
    }
  }

  // 光暈：外框描在半解析度畫布、模糊一次，再以「變亮」疊上（霓虹的泛光）
  function drawGlow(ctx, layers, dpr, now) {
    const pw = ctx.canvas.width, ph = ctx.canvas.height;
    if (!canBlur()) {
      ctx.save();
      for (const L of layers) for (const h of L.holds) {
        const a = L.alpha * easeOut(L.prog(h));
        if (a <= 0.01) continue;
        ctx.globalAlpha = 0.8 * a;
        ctx.shadowBlur = 10 * dpr;
        ctx.shadowColor = h.color;
        ctx.strokeStyle = h.color;
        ctx.lineWidth = 2.4;
        trace(ctx, h.pts);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    const k = 2, gw = Math.max(1, Math.ceil(pw / k)), gh = Math.max(1, Math.ceil(ph / k));
    if (glowSrc.width !== gw || glowSrc.height !== gh) { glowSrc.width = glowDst.width = gw; glowSrc.height = glowDst.height = gh; }
    const sc = glowSrc.getContext('2d'), dc = glowDst.getContext('2d');
    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.clearRect(0, 0, gw, gh);
    sc.setTransform(dpr / k, 0, 0, dpr / k, 0, 0);
    sc.lineJoin = 'round';
    let any = false;
    for (const L of layers) for (const h of L.holds) {
      const p = L.prog(h);
      const a = L.alpha * easeOut(p);
      if (a <= 0.01) continue;
      any = true;
      const flash = p < 1 ? 1 + 1.4 * Math.sin(Math.PI * p) : 1;   // 描完的那一下亮一點
      sc.globalAlpha = Math.min(1, a * (h.vol ? 0.55 : 0.9) * flash);
      sc.strokeStyle = h.color;
      sc.lineWidth = h.vol ? 4 : 5;
      trace(sc, h.pts);
      sc.stroke();
    }
    if (!any) return;
    dc.setTransform(1, 0, 0, 1, 0, 0);
    dc.clearRect(0, 0, gw, gh);
    dc.filter = `blur(${(3.2 * dpr / k).toFixed(2)}px)`;
    dc.drawImage(glowSrc, 0, 0);
    dc.filter = 'none';
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.95;
    ctx.drawImage(glowDst, 0, 0, pw, ph);
    ctx.restore();
  }

  // 岩點本身：很淡的角色色底、外框（描出來的進場）、白色的芯；起攀、完攀加瞄準框與小標籤
  function drawLayer(ctx, L, labels, now) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const h of L.holds) {
      const p = L.prog(h);
      if (p <= 0 || L.alpha <= 0.01) continue;
      const a = L.alpha;
      const e = easeOut(p);
      // 底色：讓岩點本身看得清楚，只染一點點
      ctx.globalAlpha = a * e * (h.vol ? 0.05 : 0.08);
      ctx.fillStyle = h.color;
      trace(ctx, h.pts);
      ctx.fill();
      // 外框：進場時沿著外框描一圈；底下先描一圈深色，亮的牆面上也看得清楚
      if (p < 1) ctx.setLineDash([h.per * e, h.per + 1]);
      ctx.globalAlpha = a * 0.45;
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = h.vol ? 3.6 : 4.2;
      trace(ctx, h.pts);
      ctx.stroke();
      ctx.globalAlpha = a * (L.ghost ? 0.75 : 0.95);
      ctx.strokeStyle = h.color;
      ctx.lineWidth = h.vol ? 1.6 : 2;
      trace(ctx, h.pts);
      ctx.stroke();
      ctx.globalAlpha = a * 0.6 * e;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.setLineDash([]);
      if (!L.ghost && !L.out && (h.role === 's' || h.role === 't')) drawBrackets(ctx, h, a, p, labels, now);
    }
    ctx.restore();
  }

  // 瞄準框：四個角往岩點收攏（進場），之後很慢地呼吸
  function drawBrackets(ctx, h, a, p, labels, now) {
    const [x0, y0, x1, y1] = h.box;
    const w = x1 - x0, hh = y1 - y0;
    const breathe = reducedMotion ? 0 : Math.sin(now / 520) * 1.2;
    const pad = 5 + (1 - easeOut(p)) * 14 + breathe;
    const arm = Math.max(5, Math.min(13, Math.min(w, hh) * 0.32 + 3));
    const L = x0 - pad, T = y0 - pad, R = x1 + pad, B = y1 + pad;
    ctx.globalAlpha = a * easeOut(p);
    ctx.strokeStyle = h.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(L, T + arm); ctx.lineTo(L, T); ctx.lineTo(L + arm, T);
    ctx.moveTo(R - arm, T); ctx.lineTo(R, T); ctx.lineTo(R, T + arm);
    ctx.moveTo(R, B - arm); ctx.lineTo(R, B); ctx.lineTo(R - arm, B);
    ctx.moveTo(L + arm, B); ctx.lineTo(L, B); ctx.lineTo(L, B - arm);
    ctx.stroke();
    const text = (h.role === 's' ? labels?.s : labels?.t) || (h.role === 's' ? 'START' : 'TOP');
    ctx.font = '700 10px ui-monospace, "SF Mono", "Roboto Mono", system-ui, sans-serif';
    const tw = ctx.measureText(text).width + 12, th = 17;
    const cx = (L + R) / 2;
    // 起攀的標籤在下面、完攀在上面（跟爬的方向一致），貼著框
    const ty = h.role === 's' ? B + 5 : T - 5 - th;
    ctx.globalAlpha = a * easeOut(clamp01(p * 1.6 - 0.6));
    ctx.fillStyle = 'rgba(6, 10, 14, 0.72)';
    roundRect(ctx, cx - tw / 2, ty, tw, th, 4);
    ctx.fill();
    ctx.strokeStyle = h.color;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, ty + th / 2 + 0.5);
  }

  // 排了出手順序的路線：岩點之間一條流動的細虛線
  function drawPath(ctx, L, seq, now) {
    const byId = new Map(L.holds.map((h) => [h.id, h]));
    const pts = seq.map((id) => byId.get(id)).filter((h) => h && L.prog(h) >= 1).map((h) => h.c);
    if (pts.length < 2) return;
    ctx.save();
    ctx.globalAlpha = 0.5 * L.alpha;
    ctx.strokeStyle = '#e8fff6';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([2, 7]);
    ctx.lineDashOffset = reducedMotion ? 0 : -now / 45;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
    ctx.restore();
  }

  // 認到牆：牆面的四個角框從外面收到牆的四角、一條掃描線由下往上掃過，然後淡掉
  function drawLock(ctx, M, photo, now) {
    const t = (now - lockT0) / LOCK_MS;
    if (t < 0 || t >= 1 || !photo?.w) return;
    const corners = [[0, 0], [photo.w, 0], [photo.w, photo.h], [0, photo.h]].map(([x, y]) => G.applyHomography(M, x, y));
    if (corners.some((c) => !c || !Number.isFinite(c[0]))) return;
    const cx = corners.reduce((s, c) => s + c[0], 0) / 4, cy = corners.reduce((s, c) => s + c[1], 0) / 4;
    const grow = 1 + 0.12 * (1 - easeOut(clamp01(t / 0.55)));
    const q = corners.map(([x, y]) => [cx + (x - cx) * grow, cy + (y - cy) * grow]);
    const fade = 1 - clamp01((t - 0.55) / 0.45);
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineCap = 'round';
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.95 * fade;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const p = q[i], a = q[(i + 3) % 4], b = q[(i + 1) % 4];
      const arm = (u) => { const dx = u[0] - p[0], dy = u[1] - p[1], d = Math.hypot(dx, dy) || 1, l = Math.min(34, d * 0.22); return [p[0] + dx / d * l, p[1] + dy / d * l]; };
      const pa = arm(a), pb = arm(b);
      ctx.moveTo(pa[0], pa[1]); ctx.lineTo(p[0], p[1]); ctx.lineTo(pb[0], pb[1]);
    }
    ctx.stroke();
    // 掃描線：照片座標由下往上，跟著牆的透視
    const sy = photo.h * (1 - easeOut(clamp01(t / 0.8)));
    const l = G.applyHomography(M, 0, sy), r = G.applyHomography(M, photo.w, sy);
    if (l && r) {
      ctx.globalAlpha = 0.7 * fade;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = ACCENT;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(l[0], l[1]);
      ctx.lineTo(r[0], r[1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  return api;
}

function trace(c, pts) {
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.closePath();
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
