// 離線包分組：同一個來源上層區域、位置相近的岩場放進同一包，一次下載。
// 只用來源自己標的上層區域（areaPath），不靠 GPS 推測行政階層。
// 一包太大時（Topo 路線數超過上限）沿地圖長軸、依路線數對切，像把大岩場分成幾個區下載。
export const MAX_LINK_METERS = 500;
export const MAX_PACK_TOPO = 100;
// 同 openclimbing.js 的 fromOpenClimbingGroup 上限。原本 12：Yzeron - Historique 這種 35 個小岩場、路線才 89 條的區域被切成（1/4）～（4/4）四包，
// 名稱一樣、看起來就是同一個地方。下載量由 MAX_PACK_TOPO 管，岩場數放寬到 40，只有路線真的多才切
export const MAX_PACK_CRAGS = 40;

const distance = (a, b) => Math.hypot(
  (a[0] - b[0]) * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180),
  a[1] - b[1],
) * 111320;
// 來源沒有標出、但大家一看就知道的地區：只用在顯示名稱，不改分組（分組仍只看來源的上層區域）。
// bbox = [西經度, 南緯度, 東經度, 北緯度]
const REGIONS = [{ name: 'Fontainebleau', bbox: [2.3, 48.25, 2.8, 48.5] }];
const regionOf = (at) => Array.isArray(at)
  ? REGIONS.find(r => at[0] >= r.bbox[0] && at[0] <= r.bbox[2] && at[1] >= r.bbox[1] && at[1] <= r.bbox[3])?.name : undefined;
const withRegion = (label, region) => (region && !label.includes(region) ? `${region} · ${label}` : label);

// 來源沒有名稱、也沒有上層區域的岩場：以 OpenClimbing 的 id 對照附近的城鎮名（索引更新後有新的就補一行）
export const UNNAMED_PLACES = { 19668219: 'Eskoriatza', 21419912: 'Airolo' };

// 區域或岩場的顯示名稱：純編號（56、147）前面加上層區域；沒名稱用上層區域；這兩種再冠上地區名
export function cragDisplayName(name, areaPath, at) {
  const area = areaPath?.filter(Boolean).at(-1);
  if (name && !/^[\d\s.\-–/]+$/.test(name)) return name;
  const label = name ? (area ? `${area} ${name.trim()}` : name) : area || '';
  return area ? withRegion(label, regionOf(at)) : label;
}
const topoOf = (list) => list.reduce((s, c) => s + (c.topoRoutes || 0), 0);

// 單一連結：500 公尺內相連的岩場算同一塊
function components(list) {
  const seen = new Set(), out = [];
  for (const start of list) {
    if (seen.has(start)) continue;
    seen.add(start);
    const comp = [start];
    for (let i = 0; i < comp.length; i++) {
      for (const other of list) {
        if (!seen.has(other) && distance(comp[i].at, other.at) <= MAX_LINK_METERS) { seen.add(other); comp.push(other); }
      }
    }
    out.push(comp);
  }
  return out;
}

// 超過上限就沿較長的軸排序，在路線數最平衡的地方切成兩半，各自再檢查
function split(list, cap) {
  if (list.length < 2 || (topoOf(list) <= cap && list.length <= MAX_PACK_CRAGS)) return [list];
  const lon = list.map(c => c.at[0]), lat = list.map(c => c.at[1]);
  const wide = (Math.max(...lon) - Math.min(...lon)) * Math.cos(lat[0] * Math.PI / 180) >= Math.max(...lat) - Math.min(...lat);
  const axis = wide ? 0 : 1;
  const sorted = list.slice().sort((a, b) => a.at[axis] - b.at[axis] || a.osmId - b.osmId);
  const total = topoOf(sorted);
  let best = 1, bestGap = Infinity, run = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    run += sorted[i].topoRoutes || 0;
    const gap = Math.abs(total / 2 - run);
    if (gap < bestGap) { bestGap = gap; best = i + 1; }
  }
  return [...split(sorted.slice(0, best), cap), ...split(sorted.slice(best), cap)];
}

export function groupOpenClimbingCrags(crags, cap = MAX_PACK_TOPO) {
  const areas = new Map();
  for (const crag of crags) {
    const path = crag.areaPath?.filter(Boolean) ?? [];
    if (!path.length || !Array.isArray(crag.at)) continue;
    const key = JSON.stringify([crag.country?.toLowerCase() ?? '', path]);
    if (!areas.has(key)) areas.set(key, []);
    areas.get(key).push(crag);
  }
  const packOf = new Map();
  for (const list of areas.values()) {
    for (const comp of components(list)) {
      const parts = split(comp, cap);
      for (const [index, part] of parts.entries()) {
        const members = part.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
        const path = members[0].areaPath.filter(Boolean);
        const ids = members.map(m => m.osmId).sort((a, b) => a - b);
        const pack = {
          id: 'osm:group:' + ids.join(','),
          name: withRegion(path[path.length - 1], regionOf(members[0].at)) + (parts.length > 1 ? `（${index + 1}/${parts.length}）` : ''),
          at: [members.reduce((s, c) => s + c.at[0], 0) / members.length,
            members.reduce((s, c) => s + c.at[1], 0) / members.length],
          country: members[0].country,
          areaPath: path,
          routes: members.reduce((s, m) => s + (m.routes || 0), 0),
          topoRoutes: topoOf(members),
          url: members[0].url,
          members,
        };
        for (const m of members) packOf.set(m, pack);
      }
    }
  }
  const result = [], emitted = new Set();
  for (const crag of crags) {
    const pack = packOf.get(crag);
    if (!pack) { result.push(crag); continue; }
    if (pack.members.length === 1) { emitted.add(pack); result.push(crag); continue; }
    if (!emitted.has(pack)) { emitted.add(pack); result.push(pack); }
  }
  return result;
}
