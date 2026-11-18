// OpenClimbing（openclimbing.org）／OpenStreetMap 的轉接器：資料都是開放的，不是爬網頁，是讀 OSM 的公開 API 和 Wikimedia Commons。
//   岩場、區域：OSM 的 site 關係（climbing=crag／area），路線是成員節點（climbing=route_bottom：名稱、各種難度、長度、wikimedia_commons 照片）。
//   Topo：路線的 wikimedia_commons:path 是照片上的線（「x,y|x,y」，x、y 是照片寬高的比例）；一張照片上有很多條路線的線就是一張 Topo。
//   照片：Wikimedia Commons 的檔案，逐張有授權（只收 CC 與公眾領域，寫進畫面的 license 與 attribution）。
// 路線資料是 ODbL（© OpenStreetMap contributors）；一個岩場一個 Drive 資料夾；沒有 Topo（沒有線的照片）的不收。
import { sha24 } from './hash.js';
import { PREVIEW, previewProps } from './sourcekit/preview-sheet.js';
import { idOf } from './thecrag.js';
import { routeProps } from './sourcekit/openclimbing-read.js';
export { parseUrl, photosOf, parsePath, spdxOf, commonsInfo, loadUnits } from './sourcekit/openclimbing-read.js';   // 讀取在 sourcekit/（紅點貓共用，改那邊再同步：tools/sync-extension.mjs）

/** 轉出來的內容改了就加一，已經收藏的岩場下次存會重存 */
const CONVERTER = 5;   // 4 → 5：加合併檔 pack.json 與資料夾說明


/**
 * 一個岩場要存的東西（只有有線的照片，沒有 Topo 就沒有）：{ id, name, files: [{ path, json }], photos: [{ path, url }], cover, version }。
 * 路線資料 ODbL；照片的授權與作者照 Commons；畫面的 origin 是 authorized（CC 授權），紅點貓可以分享（要保留署名）。
 */
export async function prepare(unit, t = Date.now()) {
  const { rel } = unit;
  const setId = idOf(`osm:relation:${rel.id}`), cragNode = idOf(`osm:crag:${rel.id}`);
  const source = { url: `https://www.openstreetmap.org/relation/${rel.id}` };
  const osmCredit = { license: 'ODbL-1.0', attribution: '© OpenStreetMap contributors' };
  const routeId = (n) => idOf(`osm:node:${n.id}`);
  const usedRoutes = new Map(unit.views.flatMap((v) => v.lines.map((l) => [l.node.id, l.node])));
  const nodes = [{ id: cragNode, type: 'crag', name: unit.name, ...(rel.tags?.website ? { props: { website: rel.tags.website } } : {}) },
    ...[...usedRoutes.values()].map((n, i) => ({ id: routeId(n), type: 'route', parent: cragNode, name: n.tags.name ?? n.tags.ref ?? `路線 ${i + 1}`, props: { code: `osm/node/${n.id}`, ...routeProps(n.tags) } }))];
  const files = [], photos = [], items = [];
  for (const v of unit.views) {
    const viewId = idOf(`osm:photo:${rel.id}:${v.title}`), layerId = idOf(`osm:layer:${rel.id}:${v.title}`);
    const ext = v.info.mime === 'image/png' ? 'png' : 'jpg', path = `${viewId}.${ext}`;
    const ordered = [...v.lines].sort((a, b) => a.points[0][0] - b.points[0][0]);   // 編號牌由左到右
    files.push({ path: `${viewId}.json`, json: { climbio: 2, kind: 'view', surface: 'photo', id: viewId, t, name: v.title.replace(/^File:/, '').replace(/\.\w+$/, ''), href: path, w: v.info.w, h: v.info.h, mime: v.info.mime ?? 'image/jpeg',
      origin: 'authorized', license: v.info.spdx, attribution: `${v.info.artist || 'Wikimedia Commons 貢獻者'}（Wikimedia Commons）`, source: { url: v.info.page }, props: { node: cragNode } } });
    files.push({ path: `${layerId}.json`, json: { climbio: 2, kind: 'layer', id: layerId, t, on: viewId, href: `${viewId}.json`, ...osmCredit, source,
      marks: ordered.map((l, i) => ({ node: routeId(l.node), geometry: { type: 'LineString', coordinates: l.points.map(([x, y]) => [Math.round(x * v.info.w * 10) / 10, Math.round(y * v.info.h * 10) / 10]) }, props: { label: String(i + 1) } })) } });
    photos.push({ path, url: v.info.url, size: { w: v.info.w, h: v.info.h } });
    items.push({ href: `${viewId}.json`, id: viewId, props: { tile: photos.length - 1 } }, { href: `${layerId}.json`, id: layerId });
  }
  const version = await sha24(`${CONVERTER}\n${JSON.stringify([rel.version, [...usedRoutes.values()].map((n) => [n.id, n.version]), unit.views.map((v) => [v.title, v.info.w, v.info.h, v.info.spdx]), unit.hierarchy])}`);
  files.unshift({ path: 'index.json', json: { climbio: 2, kind: 'set', type: unit.kind, id: setId, t, name: unit.name, ...osmCredit, source: { ...source, version }, props: { sourceLabel: 'OpenStreetMap', ...(unit.hierarchy?.length ? { sourceHierarchy: unit.hierarchy } : {}), ...(photos.length ? { preview: previewProps(photos.length) } : {}) }, items, nodes } });
  return { id: setId, name: unit.name, files, photos, sheet: photos.length ? { path: PREVIEW, urls: photos.map((p) => p.url) } : null, version };
}
