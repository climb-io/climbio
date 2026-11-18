// theCrag 岩場頁的轉接器：extractPage 在頁面裡讀資料（只讀使用者已經打開的這一頁），convert 把讀到的資料轉成 Climbio 公開格式 v2。
// extractPage 要能單獨序列化後注入頁面（chrome.scripting.executeScript 的 func），所以不能用外面的任何東西。
// 收藏保留原始來源；授權依原始內容與作者標示判定，未逐項查明時不宣稱已確認。

import { sha24 } from './hash.js';
import { idOf } from './sourcekit/ids.js';
import { PREVIEW, previewProps } from './sourcekit/preview-sheet.js';

/** 在 theCrag 岩場頁執行：回傳純 JSON { url, name, sections, groups, routes, topos } */
export function extractPage() {
  const lines = (e) => (e?.textContent || '').split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  const text = (e) => (e?.textContent || '').replace(/\s+/g, ' ').trim();
  const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
  const SECTIONS = { description: /^(描述|Description)$/, access: /^(准入问题|准入問題|Access issues?)/, approach: /^(前往|怎么去|Getting there|Approach)/ };
  const sections = {};
  for (const h2 of document.querySelectorAll('h2')) {
    const kind = Object.keys(SECTIONS).find((k) => SECTIONS[k].test(text(h2)));
    const body = kind && h2.parentElement.querySelector(':scope > .content, :scope > div:not(.comment-more)');
    if (body && !sections[kind]) sections[kind] = lines(body).replace(/^百度地图导航\n?/, '');
  }
  const groups = [], routes = [];
  for (const el of document.querySelectorAll('h3.heading.clearfix, div.route[data-nid]')) {
    if (el.tagName === 'H3') { groups.push(text(el.querySelector('.heading__t')).replace(/回到顶部$/, '').trim()); continue; }
    const tick = parse(el.dataset.routeTick);
    if (!tick) continue;
    routes.push({
      id: String(tick.id), num: text(el.querySelector('.sticky-header .num')), name: tick.name,
      grade: tick.gradeAtom?.grade || text(el.querySelector('.grade')) || '', gradeContext: tick.context || '', style: tick.styleStub || '',
      length: Array.isArray(tick.displayHeight) ? tick.displayHeight : null,
      bolts: tick.bolts ?? null, pitches: Number(tick.pitches) || null, stars: Number(tick.stars) || 0,
      description: lines(el.querySelector('.markdown.desc')), group: groups.length ? groups.length - 1 : null,
    });
  }
  const topos = [...document.querySelectorAll('.phototopo[data-topodata]')].map((el) => {
    const img = el.querySelector('img');
    return {
      id: el.dataset.tid, w: Number(el.dataset.width), h: Number(el.dataset.height), viewScale: Number(el.dataset.viewScale) || 1, image: img?.dataset.big || img?.src || '',
      marks: (parse(el.dataset.topodata) || []).filter((m) => m.type === 'route').map((m) => ({ route: String(m.id), points: m.points || '' })),
    };
  });
  // 岩場的位置：頁面的 place:location meta（導航用）
  const meta = (p) => parseFloat(document.querySelector(`meta[property="${p}"]`)?.content);
  const lat = meta('place:location:latitude'), lon = meta('place:location:longitude');
  // Keep only source-declared ancestors, not guessed URL levels.
  const hierarchy = [];
  const addAncestor = (name, href) => {
    try {
      const u = new URL(href, location.href);
      if (!/(^|\.)thecrag\.com$/i.test(u.hostname) || !u.pathname.includes('/climbing/')) return;
      const url = u.origin + u.pathname.replace(/\/$/, '');
      if (name && !hierarchy.some((x) => x.url === url)) hierarchy.push({ id: url, name, url });
    } catch { /* Ignore malformed breadcrumb entries. */ }
  };
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    const payload = parse(script.textContent);
    const blocks = Array.isArray(payload) ? payload : [payload];
    for (const entry of blocks.flatMap((x) => x?.['@graph'] ?? [x])) {
      if (!String(entry?.['@type'] ?? '').includes('BreadcrumbList')) continue;
      for (const item of [...(entry.itemListElement ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
        addAncestor(item.name ?? item.item?.name, typeof item.item === 'string' ? item.item : item.item?.['@id'] ?? item.item?.url);
      }
    }
  }
  if (!hierarchy.length) for (const a of document.querySelectorAll('nav[aria-label*="breadcrumb" i] a[href], .breadcrumb a[href], [itemtype*="BreadcrumbList"] a[href]')) addAncestor(text(a), a.href);
  const pageName = text(document.querySelector('h1.heading .heading__t'));
  addAncestor(pageName, location.href);
  return { url: location.href.split('#')[0], name: pageName, hierarchy, geo: Number.isFinite(lat) && Number.isFinite(lon) ? [lon, lat] : null, sections, groups, routes, topos };
}

export { idOf };

/** 轉換器的版本：改了轉出來的內容（欄位、換算）就加一，已經收藏的岩場下次存會重存 */
const CONVERTER = 10;   // 9 → 10：加合併檔 pack.json 與資料夾說明
const LICENSE = 'NOASSERTION';

/** 這個岩場頁的 id（同一個網址永遠是同一個） */
export const setIdOf = (page) => idOf(`thecrag:${page.url}`);

/** 內容指紋：讀到的頁面內容加轉換器版本。重複收藏時只比這一個值，一樣就什麼都不用做 */
export const pageVersion = (page) => sha24(`${CONVERTER}\n${JSON.stringify(page)}`);

const STYLE = { sport: 'sport', trad: 'trad', boulder: 'boulder', toprope: 'toprope', mixed: 'mixed', aid: 'aid', ice: 'ice' };
const GRADE_MAP = { US: 'yds', FR: 'french', AU: 'ewbank', ZA: 'ewbank', UIAA: 'uiaa', UK: 'british', V: 'v', Font: 'font' };

/** 「x y,x y label,x y belay」→ { line: [[x, y]…]（乘上 scale）, belays: [[x, y]…]（確保站，由下往上） }；沒有兩點以上就不是線 */
export function parsePoints(points, scale) {
  const line = [], belays = [];
  for (const token of String(points).split(',')) {
    const [x, y, flag] = token.trim().split(/\s+/);
    if (!Number.isFinite(+x) || !Number.isFinite(+y) || x === '' || y === undefined) continue;
    const p = [Math.round(x * scale * 10) / 10, Math.round(y * scale * 10) / 10];
    line.push(p);
    if (flag === 'belay' && !belays.some((b) => b[0] === p[0] && b[1] === p[1])) belays.push(p);
  }
  return { line: line.length >= 2 ? line : [], belays };
}

/**
 * 讀到的資料 → v2 檔案。images：Topo id → { w, h }（下載後圖片的實際大小；沒有圖的 Topo 不轉）。
 * 回傳 { id, files: [{ path, json }], photos: [{ path, url }], sheet }：json 是要存的 v2 檔案，photos 是要下載的圖（path 是存檔檔名），
 * sheet 是合成預覽圖 { path, urls }（urls 是每張照片的網址，依格子順序；呼叫的人下載後用 buildSheet 合成存成 path；沒有照片就是 null）。
 */
export function convert(page, images, t = Date.now(), version) {
  if (!page?.name || !page.routes?.length) throw new Error('這一頁讀不到岩場或路線');
  const setId = setIdOf(page);
  const cragId = idOf(`thecrag:crag:${page.url}`);
  const routeId = (r) => idOf(`thecrag:route:${r.id}`);
  const sectorId = (i) => idOf(`thecrag:sector:${page.url}:${i}`);
  // 原作者未確認時不填假署名；來源名稱與確認狀態在岩場 props，卡片只讀短標籤。
  const common = { climbio: 2, t, license: LICENSE, attribution: '', source: { url: page.url, ...(version ? { version } : {}) } };
  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)));

  const nodes = [{ id: cragId, type: 'crag', name: page.name, ...(page.geo ? { geo: { type: 'Point', coordinates: page.geo } } : {}), props: clean({
    description: page.sections.description, approach: page.sections.approach, 'thecrag:access': page.sections.access,
  }) }];
  // 沒有分區的岩場（只有一面岩壁）：建一個預設的 sector，Topo 和路線掛在它下面，紅點貓才不會把 Topo 當成區域照片
  const defaultSector = page.groups.length === 0 ? idOf(`thecrag:sector:${page.url}:default`) : null;
  if (defaultSector) nodes.push({ id: defaultSector, type: 'sector', parent: cragId, name: page.name });
  page.groups.forEach((name, i) => nodes.push({ id: sectorId(i), type: 'sector', parent: cragId, name, props: { order: i + 1 } }));
  const order = new Map();
  for (const r of page.routes) {
    const n = (order.get(r.group) || 0) + 1;
    order.set(r.group, n);
    const sys = GRADE_MAP[r.gradeContext] || (r.gradeContext ? r.gradeContext.toLowerCase() : 'french');
    nodes.push({ id: routeId(r), type: 'route', parent: r.group === null ? (defaultSector ?? cragId) : sectorId(r.group), name: r.name, props: clean({
      code: `thecrag/${r.id}`,
      grade: r.grade ? { [sys]: r.grade } : undefined,
      'thecrag:grade': r.grade || undefined,
      'thecrag:system': r.gradeContext || undefined,
      style: STYLE[r.style], length: r.length?.[1] === 'm' ? r.length[0] : undefined, bolts: r.bolts ?? undefined,
      pitches: r.pitches > 1 ? r.pitches : undefined, 'thecrag:stars': r.stars || undefined, order: n, description: r.description,
    }) });
  }

  const byId = new Map(page.routes.map((r) => [r.id, r]));
  const files = [], photos = [], items = [];
  for (const topo of page.topos) {
    const img = images[topo.id];
    const marks = topo.marks.filter((m) => byId.has(m.route));
    if (!img || !marks.length || !topo.w) continue;
    // 頁面的座標空間是「寬高 ÷ viewScale」（不是 data-width、data-height），圖片 img.w 像素對應這個空間的寬
    const scale = (img.w * (topo.viewScale || 1)) / topo.w;
    const viewId = idOf(`thecrag:topo:${topo.id}`), layerId = idOf(`thecrag:layer:${topo.id}`);
    const layerNodes = [], layerMarks = [];
    const sectors = new Map(), anchors = new Map();
    const drawn = new Set();
    for (const m of marks) {
      const r = byId.get(m.route), { line, belays } = parsePoints(m.points, scale);
      if (drawn.has(m.route + m.points)) continue;   // 同一條線頁面上畫了兩次
      drawn.add(m.route + m.points);
      sectors.set(r.group, (sectors.get(r.group) || 0) + 1);   // 沒畫線的路線也算：照片照樣掛在路線多的那區
      if (!line.length) continue;
      layerMarks.push({ node: routeId(r), geometry: { type: 'LineString', coordinates: line }, props: { label: r.num } });
      for (const belay of belays) {
        // 一條路線可以有好幾個確保站（多繩距、分支、直上起點）：各自一個節點，A01、A02…
        const n = (anchors.get(r.id) || 0) + 1;
        anchors.set(r.id, n);
        const anchor = `a${n}-${routeId(r)}`;
        layerNodes.push({ id: anchor, type: 'anchor', parent: routeId(r), name: `A${String(n).padStart(2, '0')}` });
        layerMarks.push({ node: anchor, geometry: { type: 'Point', coordinates: belay } });
      }
    }
    const main = [...sectors].sort((a, b) => b[1] - a[1])[0][0];
    files.push({ path: `${viewId}.json`, json: { ...common, kind: 'view', surface: 'photo', id: viewId, href: `${viewId}.jpg`, w: img.w, h: img.h, mime: 'image/jpeg', origin: 'personal',
      props: { node: main === null ? (defaultSector ?? cragId) : sectorId(main) } } });
    photos.push({ path: `${viewId}.jpg`, url: topo.image });
    items.push({ href: `${viewId}.json`, id: viewId, props: { tile: photos.length - 1 } });   // 照片在預覽圖上的第幾格
    // 頁面只標了路線、沒畫線的 Topo：收照片畫面，不放圖層（照片上沒有可以點的路線）
    if (!layerMarks.length) continue;
    files.push({ path: `${layerId}.json`, json: { ...common, kind: 'layer', id: layerId, on: viewId, href: `${viewId}.json`, ...(layerNodes.length ? { nodes: layerNodes } : {}), marks: layerMarks } });
    items.push({ href: `${layerId}.json`, id: layerId });
  }
  files.unshift({ path: 'index.json', json: { ...common, kind: 'set', type: 'crag', id: setId, name: page.name, props: { sourceLabel: 'theCrag', attributionStatus: 'unverified', ...(page.hierarchy?.length ? { sourceHierarchy: page.hierarchy } : {}), ...(photos.length ? { preview: previewProps(photos.length) } : {}) }, items, nodes } });
  return { id: setId, files, photos, sheet: photos.length ? { path: PREVIEW, urls: photos.map((p) => p.url) } : null };
}
