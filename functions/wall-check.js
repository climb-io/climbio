// 2D 牆（岩點精修）發佈端驗證：不認人，所以只看內容。
// 見 docs/proposals/open-versions.md 的「2D 牆」：外框要合理、不能少掉前一版的岩點、一個版本相對前一版變動有上限、照片尺寸不變。
const MAX_POLY = 500, MIN_AREA = 12, MAX_AREA_SHARE = 0.4, MAX_CHANGE_SHARE = 0.3, MIN_ALLOWED_CHANGES = 3;
const fail = (status, error) => Object.assign(new Error(error), { status });

const area = p => Math.abs(p.reduce((a, [x0, y0], i) => { const [x1, y1] = p[(i + 1) % p.length]; return a + x0 * y1 - x1 * y0; }, 0)) / 2;
const crosses = (a, b, c, d) => {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};
/** 一個外框（不含閉合的最後一點）合不合理：至少 3 點、不超過 500 點、在照片範圍內（容許 2 像素）、面積不太小也不超過照片的 4 成、不自己交叉 */
function validPoly(p, w, h) {
  if (!Array.isArray(p) || p.length < 3 || p.length > MAX_POLY) return false;
  if (!p.every(q => Array.isArray(q) && q.length === 2 && q.every(Number.isFinite) && q[0] >= -2 && q[0] <= w + 2 && q[1] >= -2 && q[1] <= h + 2)) return false;
  const a = area(p);
  if (a < MIN_AREA || a > MAX_AREA_SHARE * w * h) return false;
  for (let i = 0; i < p.length; i++) for (let j = i + 2; j < p.length; j++) {
    if (i === 0 && j === p.length - 1) continue;
    if (crosses(p[i], p[(i + 1) % p.length], p[j], p[(j + 1) % p.length])) return false;
  }
  return true;
}

/** 畫面（kind: 'view'）的岩點：{ id → { poly, retired } }；格式不對丟 400 */
function holdsOf(view) {
  if (!view || view.kind !== 'view' || !Number.isFinite(view.w) || !Number.isFinite(view.h) || !Array.isArray(view.nodes) || !Array.isArray(view.marks)) throw fail(400, 'bad view');
  const out = new Map(), geo = new Map(view.marks.map(m => [m && m.node, m && m.geometry]));
  for (const n of view.nodes) {
    if (!n || n.type !== 'hold') continue;
    const ring = geo.get(n.id)?.coordinates?.[0];
    if (!Array.isArray(ring) || ring.length < 4) throw fail(400, `bad hold ${n.id}`);
    out.set(n.id, { poly: ring.slice(0, -1), retired: !!n.props?.retired });
  }
  return out;
}
const same = (a, b) => a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);

/**
 * 檢查新的一版：view 是這次的畫面，prev 是前一版的畫面（第一版沒有）。
 * 不合理的外框、少掉前一版的岩點（刪除、合併的要標成 retired，外框留著）、照片尺寸不同、變動超過 30%（新增加上改形狀，至少允許 3 顆）都整份拒絕。
 * 回 { holds: 岩點數, changed: 變動數 }。
 */
function checkVersion(view, prev) {
  const now = holdsOf(view);
  for (const [id, h] of now) if (!validPoly(h.poly, view.w, view.h)) throw fail(400, `bad outline ${id}`);
  if (!prev) return { holds: now.size, changed: now.size };
  if (prev.w !== view.w || prev.h !== view.h) throw fail(409, 'photo size changed');
  const before = holdsOf(prev);
  for (const id of before.keys()) if (!now.has(id)) throw fail(409, `hold removed ${id}`);
  let changed = 0;
  for (const [id, h] of now) { const b = before.get(id); if (!b || h.retired !== b.retired || !same(h.poly, b.poly)) changed++; }
  if (changed > Math.max(MIN_ALLOWED_CHANGES, Math.ceil(MAX_CHANGE_SHARE * before.size))) throw fail(409, 'too many changes');
  return { holds: now.size, changed };
}

module.exports = { checkVersion, validPoly, holdsOf, MAX_CHANGE_SHARE };
