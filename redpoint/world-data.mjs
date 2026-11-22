// 紅點貓「世界」的資料：OpenClimbing 索引 + Studio 發佈的 Guidebook → 預先合成、分好層的一個檔案（world.json）。
// 雲端函式（functions/world.js）發佈、下架後和每天重寫它（Storage 的 public/world.json）；沒有雲端服務的站，紅點貓在手機上用同一份程式自己合成。
// 檔案 { v, t, books, oc, tree }：
//   books：Guidebook（世界清單的項目原樣）。
//   oc：合併分組後的 OpenClimbing 岩場，只留不能推算的欄位（id、url、source 讀進來才補回；沒有名字的 name 是空字串，畫面用語系補「未命名」）。
//   tree：國家 → 地區 → 岩場，節點的 items 是 worldItemsFrom(books, oc) 的位置（整數），不重複存岩場。
import { groupOpenClimbingCrags, cragDisplayName, UNNAMED_PLACES } from './openclimbing-group.mjs';
import { theCragUrl } from './thecrag-links.mjs';
import { buildWorld, worldItemsFrom } from './world-stacks.mjs';

export const WORLD_VERSION = 2;   // 2：祖先版本不再單獨列一筆，items 的位置跟 1 不同

/** OpenClimbing 索引 JSON → 岩場清單（已合併 500 公尺內相連的區域）。沒有名字的 name 留空，由顯示端補語系文字 */
export function parseOpenClimbing(json) {
  const all = (json.crags || []).map((c) => ({
    id: `osm:relation:${c.id}`,
    osmId: c.id,
    name: cragDisplayName(c.n, c.ap, c.at) || UNNAMED_PLACES[c.id] || '',
    at: c.at,
    routes: c.rc,
    topoRoutes: c.tc, // 索引只計候選 path，不保證 Commons 照片實際可轉換
    pv: c.pv, // 1：climbio/crags 的 openclimbing/<id>/ 有預覽圖
    country: c.cc,
    climbTypes: c.ct,
    areaPath: c.ap,
    url: `https://openclimbing.org/relation/${c.id}`,
    theCragUrl: theCragUrl(c.tcu),
    source: 'openclimbing',
  }));
  return groupOpenClimbingCrags(all);
}

const KEEP = ['osmId', 'name', 'at', 'routes', 'topoRoutes', 'pv', 'country', 'climbTypes', 'areaPath', 'theCragUrl'];
const r5 = (at) => (Array.isArray(at) ? at.map((x) => Math.round(x * 1e5) / 1e5) : at);   // 約 1 公尺，岩場分組與排位置夠用
const pick = (o) => Object.fromEntries(KEEP.filter((k) => o[k] != null && o[k] !== '' && !(Array.isArray(o[k]) && !o[k].length)).map((k) => [k, k === 'at' ? r5(o[k]) : o[k]]));
// 合併的岩場：成員的國家、上層區域跟整組一樣，只存一份
const slim = (c) => (c.members ? { ...pick(c), members: c.members.map((m) => { const { country, areaPath, ...rest } = pick(m); return rest; }) } : pick(c));
const idsOf = (c) => c.members.map((m) => m.osmId).sort((a, b) => a - b);
const full = (c) => {
  if (c.members) {
    const members = c.members.map((m) => full({ country: c.country, areaPath: c.areaPath, ...m }));
    return { ...c, id: `osm:group:${idsOf(c).join(',')}`, url: members[0].url, source: 'openclimbing', members };
  }
  return { ...c, id: `osm:relation:${c.osmId}`, url: `https://openclimbing.org/relation/${c.osmId}`, source: 'openclimbing', name: c.name ?? '' };
};
// 沒有的欄位讀進來時補回原本的樣子（pv、theCragUrl 沒有就是 undefined／空字串）
const restore = (c) => { const o = full(c); if (o.theCragUrl === undefined) o.theCragUrl = ''; return o; };

/** 兩份來源 → world.json 的內容。books：Guidebook（世界清單項目）；ocJson：OpenClimbing 索引；t：產生時間 */
export function buildWorldFile(books = [], ocJson = { crags: [] }, t = Date.now()) {
  const oc = parseOpenClimbing(ocJson);
  const items = worldItemsFrom(books, oc), at = new Map(items.map((it, i) => [it, i]));
  const ref = (n) => ({
    id: n.id, count: n.count, ...(n.at ? { at: r5(n.at) } : {}),
    ...('cc' in n ? { cc: n.cc } : { name: n.name, ...(n.other ? { other: true } : {}) }),
    ...(n.regions ? { regions: n.regions.map(ref) } : { items: n.items.map((it) => at.get(it)) }),
  });
  return { v: WORLD_VERSION, t, books, oc: oc.map(slim), tree: buildWorld(items).map(ref) };
}

/** world.json → { books, oc, tree }（紅點貓原本合成出來的樣子）。不是這個版本的檔案回 null */
export function hydrateWorld(file) {
  if (!file || file.v !== WORLD_VERSION || !Array.isArray(file.books) || !Array.isArray(file.oc) || !Array.isArray(file.tree)) return null;
  const books = file.books, oc = file.oc.map(restore), items = worldItemsFrom(books, oc);
  const node = (n) => {
    const out = { ...n, at: n.at ?? null };
    if (n.regions) {
      out.regions = n.regions.map(node);
      out.items = out.regions.flatMap((r) => r.items);
    } else {
      out.items = (n.items ?? []).map((i) => items[i]).filter(Boolean);
      if ('cc' in n) out.regions = null;
    }
    return out;
  };
  return { books, oc, tree: file.tree.map(node) };
}
