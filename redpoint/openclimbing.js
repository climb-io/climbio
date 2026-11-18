// OpenClimbing（openclimbing.org）／OpenStreetMap 轉換器：讀取 OSM 公開 API 與 Wikimedia Commons，轉換為 Climbio 公開格式 v2。
//   岩場、區域：OSM relation（climbing=crag／area），路線為成員節點（climbing=route／route_bottom）。
//   Topo：節點上的 wikimedia_commons:path 是照片上的線（x,y|x,y，比例座標 0–1）。
//   授權：路線資料為 ODbL（© OpenStreetMap contributors），照片為 CC / 公眾領域（保留署名與授權）。
// English: OpenClimbing / OSM crags and Wikimedia Commons photo-topos converted to Climbio v2 documents.

import { parseUrl, routeProps } from '../sourcekit/openclimbing-read.js';
import { fitImage } from '../sourcekit/photo-size.js';
import { idOf } from '../sourcekit/ids.js';
export { isOpenClimbing, parseUrl, photosOf, parsePath, spdxOf, commonsInfo, loadUnits } from '../sourcekit/openclimbing-read.js';

const T = (key, ...args) => globalThis.AppKit?.i18n?.t(key, ...args) ?? key;   // 語言包（i18n/redpoint）：頁面載入；Node 測試沒有 AppKit 就回傳 key

const CONVERTER = 5;   // 4 → 5：照片統一縮到長邊 1600（見 sourcekit/photo-size.js），已收的岩場下次會重存
const COVER = 'cover.jpg';


/** 內容指紋：SHA-256 取前 12 個位元組（24 個十六進位字元） */
const sha24 = (text) => AppKit.files.sha(text, 12);

export { idOf };


/**
 * 將 units 轉成一個完整的 Climbio v2 組合：
 * 回傳 { id, name, rootDoc, docs: Map<id, doc>, photos: [{ viewId, url, size }], coverUrl, version }
 */
export async function preparePack(loaded, t = Date.now(), { groupIds = null, areaPath = null } = {}) {
  const { root, units } = loaded;
  const rootId = root.rel.id;
  const groupKey = groupIds?.length > 1 ? groupIds.slice().sort((a, b) => a - b).join(',') : '';
  const setId = idOf(groupKey ? `osm:area-group:${groupKey}` : `osm:relation:${rootId}`);
  const cragName = root.name || units[0]?.name || T('unnamedCrag');
  const rootCragNode = idOf(groupKey ? `osm:area-root:${groupKey}` : `osm:crag:${rootId}`);
  const source = { url: `https://www.openstreetmap.org/relation/${rootId}` };
  const osmCredit = { license: 'ODbL-1.0', attribution: '© OpenStreetMap contributors' };
  const routeId = (n) => idOf(`osm:node:${n.id}`);

  const docs = new Map();
  const photos = [];
  const items = [];
  const nodes = [{ id: rootCragNode, type: 'crag', name: cragName, ...(root.rel.tags?.website ? { props: { website: root.rel.tags.website } } : {}) }];

  const seenRoutes = new Set();
  for (const u of units) {
    const unitRelId = u.rel.id;
    const wallNodeId = idOf(`osm:wall:${unitRelId}`);
    const sectionId = groupKey ? idOf(`osm:section:${unitRelId}`) : null;
    if (sectionId) nodes.push({ id: sectionId, type: 'area', parent: rootCragNode, name: u.name,
      props: { sourceUrl: `https://www.openstreetmap.org/relation/${unitRelId}` } });
    nodes.push({ id: wallNodeId, type: 'wall', parent: sectionId || rootCragNode, name: u.name });

    const usedRoutes = new Map(u.views.flatMap((v) => v.lines.map((l) => [l.node.id, l.node])));
    for (const [nid, n] of usedRoutes) {
      if (!seenRoutes.has(nid)) {
        seenRoutes.add(nid);
        nodes.push({
          id: routeId(n),
          type: 'route',
          parent: wallNodeId,
          name: n.tags.name ?? n.tags.ref ?? T('routeN', nodes.length),
          props: { code: `osm/node/${n.id}`, ...routeProps(n.tags) },
        });
      }
    }
    for (const v of u.views) {
      const viewId = idOf(`osm:photo:${unitRelId}:${v.title}`);
      const layerId = idOf(`osm:layer:${unitRelId}:${v.title}`);
      const ordered = [...v.lines].sort((a, b) => a.points[0][0] - b.points[0][0]);
      const viewDoc = {
        climbio: 2, kind: 'view', surface: 'photo', id: viewId, t,
        name: v.title.replace(/^File:/, '').replace(/\.\w+$/, ''),
        href: v.info.url, w: v.info.w, h: v.info.h, mime: v.info.mime ?? 'image/jpeg',
        origin: 'authorized', license: v.info.spdx,
        attribution: `${v.info.artist || 'Wikimedia Commons 貢獻者'}（Wikimedia Commons）`,
        source: { url: v.info.page }, props: { node: wallNodeId },
      };
      const layerDoc = {
        climbio: 2, kind: 'layer', id: layerId, t, on: viewId, href: `${viewId}.json`,
        ...osmCredit, source: groupKey ? { url: `https://www.openstreetmap.org/relation/${unitRelId}` } : source,
        marks: ordered.map((l, i) => ({
          node: routeId(l.node),
          geometry: { type: 'LineString', coordinates: l.points.map(([x, y]) => [Math.round(x * v.info.w * 10) / 10, Math.round(y * v.info.h * 10) / 10]) },
          props: { label: String(i + 1) },
        })),
      };
      docs.set(viewId, viewDoc);
      docs.set(layerId, layerDoc);
      photos.push({ viewId, url: v.info.url, size: { w: v.info.w, h: v.info.h } });
      items.push({ href: `${viewId}.json`, id: viewId }, { href: `${layerId}.json`, id: layerId });
    }
  }

  const version = await sha24(`${CONVERTER}\n${JSON.stringify([root.rel.version, units.map((u) => [u.rel.version, u.views.map((v) => [v.title, v.info.w, v.info.h, v.info.spdx])])])}`);
  const setDoc = {
    climbio: 2, kind: 'set', type: 'crag', id: setId, t, name: cragName,
    ...osmCredit, source: { ...source, version }, props: {
      sourceLabel: 'OpenStreetMap',
      ...(groupKey ? { areaPath, sourceCrags: groupIds.map(id => `https://www.openstreetmap.org/relation/${id}`) } : {}),
    },
    items, nodes,
  };
  docs.set(setId, setDoc);

  return { id: setId, name: cragName, rootDoc: setDoc, docs, photos, coverUrl: photos[0]?.url, version };
}

/** OpenClimbing 岩場的資料都在開放資料集 climbio/crags 的 openclimbing/：index.json（索引）、<id>/topo.json（Topo）、<id>/preview.jpg（預覽圖）；redpoint/sw.js 也用這個網址存離線快取 */
export const OC_DATA = 'https://huggingface.co/datasets/climbio/crags/resolve/main/openclimbing/';

/**
 * 岩場的資料：建索引時已經查好、驗證過（tools/openclimbing-pack.mjs），這裡只讀一個靜態檔，不再即時查 OSM、Commons。
 * 回傳 { root, units, skipped }，跟 sourcekit 的 loadUnits 同樣的形狀。
 */
async function loadStatic(url, signal) {
  const at = parseUrl(url);
  if (!at || at.type !== 'relation') throw Object.assign(new Error(T('noTopoOnOC')), { guide: true });
  let res;
  try {
    res = await fetch(`${OC_DATA}${at.id}/topo.json`, { signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('連不上岩場資料（網路中斷）');
  }
  if (res.status === 404) throw Object.assign(new Error(T('noTopoOnOC')), { guide: true });
  if (!res.ok) throw new Error(`讀不到岩場資料（HTTP ${res.status}）`);
  const data = await res.json();
  return { root: data.root, units: data.units, skipped: [] };
}

export async function fromOpenClimbing(url, options = {}) {
  const loaded = await loadStatic(url, options.signal);
  if (!loaded.units.length) throw Object.assign(new Error(T('noTopoOnOC')), { guide: true });
  return downloadPrepared(await preparePack(loaded), url, options);
}

/** 一個區域共用一份離線包；每個 Block 仍是獨立 area/岩壁節點，照片保留各自授權。 */
export async function fromOpenClimbingGroup(group, options = {}) {
  const members = group?.members ?? [];
  if (members.length < 2 || members.length > 40) throw new Error('群組須有 2–40 個來源岩場');   // 同 openclimbing-group.mjs 的 MAX_PACK_CRAGS
  const all = [];
  const skipped = [];
  for (const crag of members) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      const loaded = await loadStatic(crag.url, options.signal);
      all.push(...loaded.units);
      skipped.push(...loaded.skipped);
    } catch (error) {
      // Partial source failure is surfaced explicitly; never silently mark as fully downloaded.
      skipped.push(`${crag.name}：${error.message}`);
    }
  }
  if (!all.length) throw Object.assign(new Error(T('noTopoInArea')), { guide: true });
  const loaded = {
    root: { id: members[0].osmId, name: group.name, rel: all[0].rel },
    units: all,
  };
  const prepared = await preparePack(loaded, Date.now(), {
    groupIds: members.map(m => m.osmId), areaPath: group.areaPath,
  });
  const downloaded = await downloadPrepared(prepared, group.url, options);
  downloaded.skipped.unshift(...skipped);
  return downloaded;
}

async function downloadPrepared(prepared, url, {
  signal, ready = null, onRoot = () => {}, onPreview = () => {}, onPhoto = () => {}, onBytes = () => {},
} = {}) {
  onRoot(prepared.rootDoc, url);
  await ready;   // 使用者確認前不下載照片

  const photos = new Map();
  const skipped = [];
  const total = prepared.photos.length;
  let done = 0;

  // 下載照片（限制並行數為 3）
  // 縮成文件裡寫的大小（w、h）：線的座標照這個大小算
  const getBlob = async (photoUrl, size) => {
    const res = await fetch(photoUrl, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await fitImage(await res.blob(), { size })).blob;
  };

  const poolLimit = 3;
  let active = 0;
  const queue = [...prepared.photos];

  await new Promise((resolve, reject) => {
    if (!queue.length) return resolve();
    let hasFailed = false;

    const next = () => {
      if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      if (hasFailed) return;
      if (done === total) return resolve();
      while (active < poolLimit && queue.length) {
        const item = queue.shift();
        active++;
        getBlob(item.url, item.size).then((blob) => {
          photos.set(item.viewId, blob);
          if (done === 0) onPreview(blob);   // 第一張照片作為卡片開箱預覽
          onPhoto(item.viewId, blob, ++done, total);
          onBytes(done / total);
        }).catch((e) => {
          if (signal?.aborted) { hasFailed = true; return reject(e); }
          skipped.push(T('photoDownloadFailed', item.url, e.message));
          onPhoto(item.viewId, null, ++done, total);
          onBytes(done / total);
        }).finally(() => {
          active--;
          next();
        });
      }
    };
    next();
  });

  return { root: prepared.rootDoc, docs: prepared.docs, photos, skipped };
}
