// 2D 牆相機追蹤共用幾何與資料解析工具（支援瀏覽器全域、Worker importScripts 與 Node require）
// English: Shared 2D homography geometry, sanity verification, and wall/route parsing utilities.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Wall2dGeometry = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ROLE_COLORS = {
    s: '#22c55e',
    h: '#3b82f6',
    f: '#facc15',
    t: '#ef4444',
  };

  /** 套用 3×3 單應矩陣 H（行主序 9 數值）將點 (x, y) 投影到目標座標 */
  function applyHomography(H, x, y) {
    const w = H[6] * x + H[7] * y + H[8];
    if (!Number.isFinite(w) || Math.abs(w) < 1e-9) return null;
    return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
  }

  /** 計算 3×3 矩陣反矩陣；奇異矩陣回傳 null */
  function invert3x3(m) {
    const a = m[0], b = m[1], c = m[2];
    const d = m[3], e = m[4], f = m[5];
    const g = m[6], h = m[7], i = m[8];
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g);
    const G = b * f - c * e, H = -(a * f - c * d), I = a * e - b * d;
    const det = a * A + b * B + c * C;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
    const inv = 1 / det;
    return [A * inv, D * inv, G * inv, B * inv, E * inv, H * inv, C * inv, F * inv, I * inv];
  }

  /** 矩陣乘法 A × B（皆為 3×3 行主序） */
  function mul3x3(A, B) {
    const out = new Array(9);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        out[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[c + 3] + A[r * 3 + 2] * B[c + 6];
      }
    }
    return out;
  }

  /** 計算單應矩陣在參考點 (cx, cy) 的局部雅可比條件數與最大尺度 */
  function homographyJacobian(H, cx, cy) {
    const p0 = applyHomography(H, cx, cy);
    const px = applyHomography(H, cx + 1, cy);
    const py = applyHomography(H, cx, cy + 1);
    if (!p0 || !px || !py) return null;
    const j00 = px[0] - p0[0], j01 = py[0] - p0[0];
    const j10 = px[1] - p0[1], j11 = py[1] - p0[1];
    const tr = j00 * j00 + j01 * j01 + j10 * j10 + j11 * j11;
    const jdet = j00 * j11 - j01 * j10;
    if (!Number.isFinite(tr) || !Number.isFinite(jdet) || jdet <= 1e-8) return null;
    const disc = Math.sqrt(Math.max(0, tr * tr - 4 * jdet * jdet));
    const s1 = Math.sqrt(Math.max(0, (tr + disc) / 2));
    const s2 = Math.sqrt(Math.max(0, (tr - disc) / 2));
    if (s2 < 1e-7) return null;
    return { s1, s2, cond: s1 / s2 };
  }

  /**
   * 驗證單應矩陣 H（從參考照片 [0..refW, 0..refH] 映射到查詢影格 [0..qW, 0..qH]）是否幾何合理：
   * 阻擋重複圖案造成的局部聚集、鏡像翻轉、凹四邊形、極端斜切或平面穿過鏡頭後方。
   */
  function verifyHomography(H, refW, refH, qW, qH, inlRef, inlQuery, opts = {}) {
    const minInliers = opts.minInliers ?? 18;
    const minCoverageQ = opts.minCoverageQ ?? 0.04;
    const minCoverageR = opts.minCoverageR ?? 0.02;
    const minCells = opts.minCells ?? 4;
    const maxCond = opts.maxCond ?? 4.5;
    const maxMedianError = opts.maxMedianError ?? 4.5;

    const count = inlQuery.length / 2;
    if (count < minInliers) return { ok: false, reason: 'few_inliers', inliers: count };
    if (!Array.isArray(H) || H.length !== 9 || !H.every(Number.isFinite)) {
      return { ok: false, reason: 'invalid_matrix', inliers: count };
    }

    // 1. 空間分布檢查（防止重複膠帶／單一岩點群聚誤對）
    let qMinX = Infinity, qMaxX = -Infinity, qMinY = Infinity, qMaxY = -Infinity;
    let rMinX = Infinity, rMaxX = -Infinity, rMinY = Infinity, rMaxY = -Infinity;
    const cells = new Set();
    const errs = [];
    for (let i = 0; i < count; i++) {
      const rx = inlRef[i * 2], ry = inlRef[i * 2 + 1];
      const qx = inlQuery[i * 2], qy = inlQuery[i * 2 + 1];
      if (qx < qMinX) qMinX = qx; if (qx > qMaxX) qMaxX = qx;
      if (qy < qMinY) qMinY = qy; if (qy > qMaxY) qMaxY = qy;
      if (rx < rMinX) rMinX = rx; if (rx > rMaxX) rMaxX = rx;
      if (ry < rMinY) rMinY = ry; if (ry > rMaxY) rMaxY = ry;
      cells.add(`${Math.floor((qx / qW) * 6)}:${Math.floor((qy / qH) * 4)}`);
      const proj = applyHomography(H, rx, ry);
      if (!proj) return { ok: false, reason: 'behind_camera', inliers: count };
      errs.push(Math.hypot(proj[0] - qx, proj[1] - qy));
    }
    const covQ = ((qMaxX - qMinX) * (qMaxY - qMinY)) / Math.max(1, qW * qH);
    const covR = ((rMaxX - rMinX) * (rMaxY - rMinY)) / Math.max(1, refW * refH);
    if (covQ < minCoverageQ || cells.size < minCells) {
      return { ok: false, reason: 'low_spread', inliers: count, coverage: covQ, cells: cells.size };
    }
    if (covR < minCoverageR) {
      return { ok: false, reason: 'low_ref_spread', inliers: count, coverage: covQ };
    }

    errs.sort((a, b) => a - b);
    const medianError = errs[Math.floor(errs.length / 2)] ?? Infinity;
    if (medianError > maxMedianError) {
      return { ok: false, reason: 'high_error', inliers: count, coverage: covQ, medianError };
    }

    // 2. 反向映射查詢四角回參考平面：檢查凸四邊形與正向朝向
    const Hinv = invert3x3(H);
    if (!Hinv) return { ok: false, reason: 'singular', inliers: count, coverage: covQ };
    const qCorners = [[0, 0], [qW, 0], [qW, qH], [0, qH]];
    const rPts = [];
    for (const [x, y] of qCorners) {
      const w = Hinv[6] * x + Hinv[7] * y + Hinv[8];
      if (!Number.isFinite(w) || w <= 1e-4) {
        return { ok: false, reason: 'behind_plane', inliers: count, coverage: covQ };
      }
      rPts.push([(Hinv[0] * x + Hinv[1] * y + Hinv[2]) / w, (Hinv[3] * x + Hinv[4] * y + Hinv[5]) / w]);
    }
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = rPts[i], b = rPts[(i + 1) % 4], c = rPts[(i + 2) % 4];
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(cross) < 1e-3) return { ok: false, reason: 'degenerate', inliers: count, coverage: covQ };
      const s = Math.sign(cross);
      if (!sign) sign = s;
      else if (s !== sign) return { ok: false, reason: 'non_convex', inliers: count, coverage: covQ };
    }
    if (sign < 0) return { ok: false, reason: 'flipped', inliers: count, coverage: covQ };

    // 3. 局部雅可比條件數（阻擋極端剪裁／扭曲）
    const cx = (rPts[0][0] + rPts[1][0] + rPts[2][0] + rPts[3][0]) / 4;
    const cy = (rPts[0][1] + rPts[1][1] + rPts[2][1] + rPts[3][1]) / 4;
    const jac = homographyJacobian(H, cx, cy);
    if (!jac || jac.cond > maxCond || jac.s1 < 0.08 || jac.s1 > 12) {
      return { ok: false, reason: 'extreme_warp', inliers: count, coverage: covQ, cond: jac?.cond ?? null };
    }

    return {
      ok: true,
      Hinv,
      inliers: count,
      coverage: covQ,
      refCoverage: covR,
      cells: cells.size,
      medianError,
      cond: jac.cond,
    };
  }

  /**
   * 量測相鄰兩幀單應矩陣 H1, H2 在影格四角的最大位移（像素），
   * 用於評估追蹤穩定度／抖動。
   */
  function homographyCornerDelta(H1, H2, refW, refH, qW, qH) {
    if (!H1 || !H2) return null;
    // 取參考圖中心與四角（或將查詢圖中心與邊界映回後再重投影）
    const Hinv = invert3x3(H2);
    if (!Hinv) return null;
    const qPts = [[qW * 0.25, qH * 0.25], [qW * 0.75, qH * 0.25], [qW * 0.75, qH * 0.75], [qW * 0.25, qH * 0.75]];
    let maxD = 0;
    for (const [qx, qy] of qPts) {
      const r = applyHomography(Hinv, qx, qy);
      if (!r) continue;
      const p1 = applyHomography(H1, r[0], r[1]);
      if (!p1) continue;
      const d = Math.hypot(p1[0] - qx, p1[1] - qy);
      if (d > maxD) maxD = d;
    }
    return maxD;
  }

  /** 解析 URL `?route=岩點id:角色,…`（角色為 s/h/f/t），格式與 /3d/ 相同 */
  function parseRouteParam(raw) {
    const map = new Map();
    if (!raw) return map;
    for (const item of String(raw).split(',')) {
      const [id, role] = item.split(':');
      if (id && /^[0-9a-zA-Z_-]{1,64}$/.test(id) && role && 'shft'.includes(role)) {
        map.set(id, role);
      }
    }
    return map;
  }

  /**
   * 正規化 Climbio 2D 牆面 JSON（支援 v2 view `marks` 與 `demo.json` 結構 `wall.holds`）。
   * 回傳 { name, w, h, holds: [{ id, poly }], routes: [{ id, name, grade, holds }] }。
   */
  function parseWallData(rawWall, rawRoutes = null) {
    const doc = rawWall?.wall && Array.isArray(rawWall.wall.holds) ? rawWall.wall : rawWall;
    if (!doc || !(doc.w > 0) || !(doc.h > 0)) throw new Error('牆面資料缺少有效寬高');

    let holds = [];
    if (Array.isArray(doc.marks)) {
      const retired = new Set(
        Array.isArray(doc.nodes)
          ? doc.nodes.filter((n) => n?.props?.retired).map((n) => n.id)
          : []
      );
      holds = doc.marks
        .filter((m) => m?.node && !retired.has(m.node) && m.geometry?.type === 'Polygon' && Array.isArray(m.geometry.coordinates?.[0]))
        .map((m) => ({
          id: String(m.node),
          poly: m.geometry.coordinates[0].map((p) => [Number(p[0]), Number(p[1])]),
        }));
    } else if (Array.isArray(doc.holds)) {
      holds = doc.holds
        .filter((h) => h?.id && Array.isArray(h.poly) && h.poly.length >= 3)
        .map((h) => ({
          id: String(h.id),
          poly: h.poly.map((p) => [Number(p[0]), Number(p[1])]),
        }));
    }

    const routes = [];
    const collectRoutes = (src) => {
      if (!src) return;
      if (Array.isArray(src.routes)) {
        for (const r of src.routes) {
          if (r?.id && r.holds && typeof r.holds === 'object') {
            routes.push({
              id: String(r.id),
              name: String(r.name || ''),
              grade: typeof r.grade === 'string' ? r.grade : (r.grade?.v || ''),
              holds: { ...r.holds },
            });
          }
        }
      }
      if (Array.isArray(src.nodes)) {
        for (const n of src.nodes) {
          if (n?.type === 'route' && n.id && n.props?.holds) {
            routes.push({
              id: String(n.id),
              name: typeof n.name === 'string' ? n.name : (n.name?.['zh-Hant'] || n.name?.en || ''),
              grade: n.props.grade?.v || '',
              holds: { ...n.props.holds },
            });
          }
        }
      }
    };
    collectRoutes(doc);
    collectRoutes(rawRoutes);

    return {
      id: String(doc.id || ''),
      name: String(doc.name || ''),
      w: Number(doc.w),
      h: Number(doc.h),
      holds,
      routes,
    };
  }

  /** 計算多邊形面積（鞋帶公式） */
  function polyArea(poly) {
    if (!Array.isArray(poly) || poly.length < 3) return 0;
    let sum = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      sum += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    }
    return Math.abs(sum) * 0.5;
  }

  /**
   * 依岩點貓相同定義標記大型量體（面積 ≥ 牆面所有岩點面積中位數的 8 倍）：
   * 回傳 Set<holdId>，讓疊圖優先以整個量體的光暈為主。
   */
  function markVolumeHolds(holds) {
    const out = new Set();
    if (!Array.isArray(holds) || !holds.length) return out;
    const areas = holds.map((h) => polyArea(h.poly)).filter((a) => a > 0);
    if (!areas.length) return out;
    const sorted = [...areas].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    if (!(median > 0)) return out;
    const cutoff = median * 8;
    for (const h of holds) {
      if (polyArea(h.poly) >= cutoff) out.add(h.id);
    }
    return out;
  }

  /**
   * 依相鄰兩幀單應矩陣（Hprev → Hcurr）做延遲補償外推（alpha ∈ [0, 1.2]）：
   * 當單幀推論尚在進行中、需要先畫預覽影格時，沿前幀速度線性外推增量變換 D。
   * 若矩陣奇異或單步移動過大則安全退回 Hcurr。
   */
  function extrapolateHomography(Hprev, Hcurr, alpha, refW = 640, refH = 480) {
    if (!Hcurr) return null;
    if (!Hprev || !(alpha > 0)) return Hcurr;
    const clamped = Math.min(1.2, alpha);
    const Hinv = invert3x3(Hprev);
    if (!Hinv) return Hcurr;
    const D = mul3x3(Hcurr, Hinv);
    if (!Number.isFinite(D[8]) || Math.abs(D[8]) < 1e-6) return Hcurr;
    const invD8 = 1 / D[8];
    const Dn = D.map((v) => v * invD8);
    // 檢查步進變換是否合理（避免掉追蹤前跳動造成發散）
    const det2 = Dn[0] * Dn[4] - Dn[1] * Dn[3];
    if (!Number.isFinite(det2) || det2 < 0.5 || det2 > 2.0) return Hcurr;
    const maxShift = Math.max(Math.abs(Dn[2]), Math.abs(Dn[5]));
    if (maxShift > Math.max(refW, refH) * 0.25) return Hcurr;
    const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const Da = I.map((id, i) => id + clamped * (Dn[i] - id));
    const Hpred = mul3x3(Da, Hcurr);
    if (!Hpred.every(Number.isFinite)) return Hcurr;
    return Hpred;
  }

  return {
    ROLE_COLORS,
    applyHomography,
    invert3x3,
    mul3x3,
    homographyJacobian,
    verifyHomography,
    homographyCornerDelta,
    polyArea,
    markVolumeHolds,
    extrapolateHomography,
    parseRouteParam,
    parseWallData,
  };
});
