// 紅點貓「世界」的卡堆分層與排列（純函式，不碰畫面）。
// 三層：國家（cc）→ 地區（區域路徑的第一段 ap[0]；Guidebook 是書名）→ 岩場。
//   · 國家的岩場 ≤ SKIP_REGION_MAX 個：不分地區，點國家直接攤開成岩場。
//   · 地區要 ≥ MIN_REGION 個岩場才獨立成疊，不夠的併成該國的「其他」；沒有地區名的也歸「其他」。
//   · 沒有國碼（cc）的岩場歸最外層的「其他」國家，排在最後，不依位置排列。
export const MIN_REGION = 3, SKIP_REGION_MAX = 12;

const mean = (items) => {
  const ps = items.map((i) => i.at).filter((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite));
  return ps.length ? [ps.reduce((a, p) => a + p[0], 0) / ps.length, ps.reduce((a, p) => a + p[1], 0) / ps.length] : null;
};
const node = (id, items, extra = {}) => ({ id, count: items.length, items, at: mean(items), ...extra });

/** 岩場（{ key, cc, area, at }）→ 國家 → 地區 → 岩場；只分組，排進格子用 layout（格子數看畫面寬度） */
export function buildWorld(items) {
  const byCountry = new Map();
  for (const it of items) {
    const cc = String(it.cc ?? '').toLowerCase();
    byCountry.set(cc, [...(byCountry.get(cc) ?? []), it]);
  }
  const countries = [...byCountry].map(([cc, list]) => {
    if (list.length <= SKIP_REGION_MAX) return node(`c:${cc}`, list, { cc, regions: null });
    const byArea = new Map();
    for (const it of list) byArea.set(it.area || '', [...(byArea.get(it.area || '') ?? []), it]);
    const regions = [], rest = [];
    for (const [area, group] of byArea) (area && group.length >= MIN_REGION ? regions.push(node(`r:${cc}:${area}`, group, { name: area })) : rest.push(...group));
    if (rest.length) regions.push(node(`r:${cc}:`, rest, { name: '', other: true }));
    return node(`c:${cc}`, list, { cc, regions });
  });
  return countries;
}

/** 把 Studio Guidebook 與 OpenClimbing 岩場合成 buildWorld 用的扁平清單（Guidebook 在前；同一本書的其他版本各一筆） */
export function worldItemsFrom(books = [], ocCrags = []) {
  return [
    ...books.flatMap((b) => [b, ...(b.others ?? []).map((o) => ({ ...o, at: b.at, cc: b.cc }))]).map((b) => ({ key: `s${b.id}`, cc: b.cc, area: b.name, at: b.at, book: b })),
    ...ocCrags.map((c) => ({ key: `o${c.osmId ?? c.id}`, cc: c.country, area: c.areaPath?.[0], at: c.at, crag: c })),
  ];
}

/** 兩份來源合成國家 → 地區 → 岩場三層樹：只依地理分組，不排格子，也不把所在國家提前 */
export function mergeWorld(books = [], ocCrags = []) {
  return buildWorld(worldItemsFrom(books, ocCrags));
}

const isOther = (n) => n.other || n.cc === '';

/**
 * 依大致的地理位置排進格子：由北到南切成一列一列（每列最多 cols 疊），列內由西到東。
 * 沒有位置的與「其他」排在最後。回傳新的陣列，每個節點多 `row`、`col`（從 0 起）。
 */
export function layout(nodes, cols = 3) {
  const placed = nodes.filter((n) => n.at && !isOther(n)).sort((a, b) => b.at[1] - a.at[1]);
  const rest = nodes.filter((n) => !n.at || isOther(n));
  const rows = Math.ceil(placed.length / cols), out = [];
  for (let r = 0; r < rows; r++) {
    placed.slice(r * cols, r * cols + cols).sort((a, b) => a.at[0] - b.at[0]).forEach((n, c) => out.push({ ...n, row: r, col: c }));
  }
  rest.forEach((n, i) => out.push({ ...n, row: rows + Math.floor(i / cols), col: i % cols }));
  return out;
}

/** 卡堆的厚度（層數 1–6）：岩場越多越厚，對數增長，最多不超過 6 層 */
export const layers = (count) => Math.min(6, Math.max(1, Math.floor(Math.log2(count + 1))));
