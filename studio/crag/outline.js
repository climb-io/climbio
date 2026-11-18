// 路線書大綱：任何格式的路線書先整理成一份 Markdown，再變成一本 Guidebook。只處理文字，不碰狀態與畫面，Node 也能跑。
//   標題：# 岩場、## 區、### 岩壁（層數不限；底下還有標題的是區，其他是岩壁）
//   「欄位：值」：來源、署名、授權、難度系統（寫在岩場）、交通、說明、朝向、類型（底下路線的預設類型）、排列（路線表格照照片由右至左或由左至右列，底下的岩壁照這個）；不是欄位的段落當說明
//   表格（| 分隔或 Tab 分隔）：路線，欄位跟貼上路線一樣（table.js）；有「岩壁」欄就放進這個標題底下同名的岩壁
//   圖片 ![說明](檔名或 https 網址)：岩壁的照片（路線書的圖或原始照片）；放在區或岩場底下的是區域圖（配置圖、全景），沒有路線，紅點貓顯示在區域照片
// 寫法見 docs/guidebook-convert.md；Word、網頁匯出檔自動轉成大綱見 docread.js。
import { newBook, newId, addRoutes, setCragPosition, LICENSE } from './model.js';
import { parseTable, guessColumns, toRoutes, parseStyle } from './table.js';

export { AI_PROMPT, AI_MAP_PROMPT } from './ai-prompt.js';
const T = (...a) => AppKit.i18n.t(...a);   // 文字在呼叫時才查語言包（Node 測試、命令列也能用）

const KEYS = {
  source: ['來源', '原始資料', '出處', 'source', 'url'],
  attribution: ['署名', '作者', '編者', 'author', 'attribution'],
  license: ['授權', 'license'],
  grade: ['難度系統', 'gradesystem', 'grading'],
  approach: ['交通', '怎麼到', '前往方式', 'approach', 'access'],
  description: ['說明', '介紹', '描述', '備註', 'description', 'notes', 'note'],
  aspect: ['朝向', '方位', '面向', 'aspect', 'facing'],
  style: ['類型', '攀登方式', 'style', 'type'],
  order: ['排列', '排序', '路線順序', 'order', 'direction'],
};
const CRAG_ONLY = { source: () => T('cdFieldSource'), attribution: () => T('cdFieldAttribution'), license: () => T('cdFieldLicense'), grade: () => T('cdFieldGrade') };   // 警告裡的欄位名稱（解析的關鍵字在 KEYS）
const norm = (s) => s.toLowerCase().replace(/[\s_\-.]/g, '');
const KEY_OF = new Map(Object.entries(KEYS).flatMap(([k, list]) => list.map(w => [norm(w), k])));
const COMPASS = { n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315, 北: 0, 東北: 45, 東: 90, 東南: 135, 南: 180, 西南: 225, 西: 270, 西北: 315 };

/** 朝向：度數，或 N、NE、東南、朝南這類方位；看不懂是 undefined */
export function parseAspect(value) {
  const v = value.trim().replace(/^朝/, '').replace(/\s*(度|°)$/, '').toLowerCase();
  if (/^\d+(\.\d+)?$/.test(v)) return Number(v) % 360;
  return COMPASS[v.replace(/[向面方]$/, '')];
}

/** 路線表格照照片的哪個方向列：由右至左、right to left 是 'rtl'，由左至右、left to right 是 'ltr'；看不懂是 undefined */
export function parseOrder(value) {
  const v = String(value).toLowerCase();
  if (/右\s*(至|到|→|->)\s*左|right\s*(to|->)\s*left|rtl/.test(v)) return 'rtl';
  if (/左\s*(至|到|→|->)\s*右|left\s*(to|->)\s*right|ltr/.test(v)) return 'ltr';
  return undefined;
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*$/;
const IMAGE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const FIELD = /^[-*]?\s*([^：:|#!]{1,12})[：:]\s*(.*)$/;
const SEPARATOR = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;

/** Markdown 表格（| 分隔）的幾行 → Tab 分隔的文字給 parseTable；格子裡的 <br> 是換行（加引號） */
function pipeRows(lines) {
  return lines.filter(l => !SEPARATOR.test(l.trim())).map(l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => {
    const v = c.trim().replace(/\\\|/g, '|').replace(/\t/g, ' ').replace(/<br\s*\/?>/gi, '\n');
    return v.includes('\n') || v.startsWith('"') ? `"${v.replace(/"/g, '""')}"` : v;
  }).join('\t')).join('\n');
}

/**
 * 大綱文字 → { crag, sections, warnings }：
 *   crag：{ name, source, attribution, license, grade }
 *   sections：每個標題 { key, level, name, parent（上一層的 key）, props, style, tables（列）, images: [{ src, alt, line }], line }
 */
export function parseOutline(src) {
  const lines = String(src).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const crag = { name: '' };
  const sections = [], warnings = [], stack = [];
  let cur = null, field = null, block = null;
  const flush = () => {
    if (!block) return;
    const rows = parseTable(block.pipe ? pipeRows(block.lines) : block.lines.join('\n'));
    rows.line = block.line;   // 表格在大綱的第幾行：同一面岩壁有好幾張表時，用它找表格前面的那張照片
    if (cur) cur.tables.push(rows); else warnings.push(T('cdTableNoHeading', block.line));
    block = null;
  };
  for (const [i, raw] of lines.entries()) {
    const t = raw.trim();
    const isPipe = t.startsWith('|'), isTab = raw.includes('\t') && !HEADING.test(t);
    if (block && (block.pipe ? isPipe : isTab)) { block.lines.push(raw); continue; }
    flush();
    if (isPipe || isTab) { block = { pipe: isPipe, lines: [raw], line: i + 1 }; field = null; continue; }
    const h = t.match(HEADING);
    if (h) {
      const level = h[1].length;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      cur = { key: sections.length, level, name: h[2].replace(/\*\*/g, '').trim(), parent: stack[stack.length - 1]?.key, props: {}, tables: [], images: [], line: i + 1 };
      if (cur.parent === undefined) {
        if (crag.name) warnings.push(T('cdSecondTop', i + 1, cur.name));
        else crag.name = cur.name;
      }
      sections.push(cur); stack.push(cur);
      field = null;
      continue;
    }
    if (!t) { field = null; continue; }
    let rest = t;
    for (const m of t.matchAll(IMAGE)) {
      rest = rest.replace(m[0], '').trim();
      if (cur) cur.images.push({ src: m[2], alt: m[1].trim(), line: i + 1 });
      else warnings.push(T('cdImageNoHeading', i + 1));
    }
    if (!rest || /^<!--.*-->$/.test(rest)) continue;
    if (!cur) { warnings.push(T('cdBeforeHeading', i + 1)); continue; }
    const f = rest.match(FIELD), key = f && KEY_OF.get(norm(f[1]));
    if (key) { field = key; setField(cur, key, f[2].trim(), crag, warnings, i + 1); continue; }
    // 接在交通、說明後面的行是同一段（例如多行的交通）；其他段落當說明
    const k = field === 'approach' ? 'approach' : 'description';
    cur.props[k] = cur.props[k] ? `${cur.props[k]}\n${rest}` : rest;
    field = k;
  }
  flush();
  if (!crag.name) warnings.push(T('cdNoCragName'));
  return { crag, sections, warnings };
}

function setField(sec, key, value, crag, warnings, line) {
  if (!value) return;
  if (CRAG_ONLY[key] && sec.parent !== undefined) { warnings.push(T('cdCragOnly', line, CRAG_ONLY[key]())); return; }
  if (CRAG_ONLY[key]) crag[key] = key === 'grade' ? value.toLowerCase() : value;
  else if (key === 'style') sec.style = parseStyle(value);
  else if (key === 'order') {
    const o = parseOrder(value);
    if (!o) warnings.push(T('cdBadOrder', line, value));
    else sec.order = o;
  } else if (key === 'aspect') {
    const a = parseAspect(value);
    if (a === undefined) warnings.push(T('cdBadAspect', line, value));
    else sec.props.aspect = a;
  } else sec.props[key] = sec.props[key] ? `${sec.props[key]}\n${value}` : value;
}

/**
 * 岩場位置：從文字找「緯度, 經度」（路線書常寫「岩場入口 21.93, 120.82」「位置 21.93, 120.82」）。
 * 優先順序：岩場交通說明裡「入口」附近的、岩場交通說明裡的第一組、岩場說明、各岩壁說明裡的第一組；座標的範圍不對（緯度超過 90）的不收。
 * 回傳 { position: [經度, 緯度], from: 說明這組座標從哪裡來 } 或 undefined
 */
const COORD = /(?<![\d.])(-?\d{1,2}\.\d{3,})\s*[,，、]\s*(-?\d{1,3}\.\d{3,})(?!\d)/g;
export function findPosition(sections) {
  const top = sections.find(s => s.parent === undefined);
  const at = (text, near) => {
    for (const m of String(text || '').matchAll(COORD)) {
      const lat = Number(m[1]), lng = Number(m[2]);
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
      if (near && !/入口|停車|登山口|trailhead|parking/i.test(text.slice(Math.max(0, m.index - 14), m.index))) continue;
      return [Math.round(lng * 1e7) / 1e7, Math.round(lat * 1e7) / 1e7];
    }
    return undefined;
  };
  const tries = [
    [top?.props.approach, true, T('cdFromApproachEntrance')], [top?.props.approach, false, T('cdFromApproach')], [top?.props.description, false, T('cdFromDescription')],
    ...sections.filter(s => s !== top).map(s => [s.props.description, false, T('cdFromSection', s.name)]),
  ];
  for (const [text, near, from] of tries) { const position = at(text, near); if (position) return { position, from }; }
  return undefined;
}

/** 沒寫類型的路線：V、Font 難度是抱石，有 bolt 數的是運動攀登 */
const guessStyle = (p) => (p.grade?.v || p.grade?.font ? 'boulder' : p.bolts ? 'sport' : undefined);

/**
 * 岩壁地圖（GeoJSON FeatureCollection，座標是 [經度, 緯度]）放進這本的地圖畫面：
 *   LineString 的 properties.wall 是岩壁的名稱（大綱的標題）：牆底線，畫線的方向決定面朝（岩壁在左手邊、面朝右手邊）；
 *   LineString 的 properties.kind 是 trail（步道）或 route（建議行進路線）；
 *   Point 的 properties.name 是地點，properties.kind 是 place、parking 等 poi 的種類
 * 畫出來的線當成手動畫的，之後加照片也不重算。名稱對不到岩壁的提醒
 */
function applyMap(state, geo, warnings) {
  if (geo?.type !== 'FeatureCollection' || !Array.isArray(geo.features)) { warnings.push(T('cdMapNotGeoJson')); return; }
  const key = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
  const wallByName = new Map(state.book.nodes.filter(n => n.type === 'wall').map(n => [key(n.name), n.id]));
  const { map } = state;
  let lines = 0;
  for (const { geometry: g, properties: p = {} } of geo.features) {
    const ok = (c) => Array.isArray(c) && c.length >= 2 && c.every(x => Number.isFinite(x));
    if (g?.type === 'LineString' && g.coordinates.length >= 2 && g.coordinates.every(ok)) {
      const mark = { geometry: { type: 'LineString', coordinates: g.coordinates.map(([x, y]) => [x, y]) }, props: { 'author:manual': true } };
      if (p.wall !== undefined) {
        const wall = wallByName.get(key(p.wall));
        if (!wall) { warnings.push(T('cdMapWallUnmatched', p.wall)); continue; }
        mark.node = wall;
      } else if (['trail', 'route'].includes(p.kind)) mark.props.kind = p.kind;
      else continue;
      map.marks.push(mark); lines++;
    } else if (g?.type === 'Point' && ok(g.coordinates) && p.name) {
      const id = newId();
      (map.nodes ||= []).push({ id, type: 'poi', name: String(p.name), props: { kind: p.kind || 'place' } });
      map.marks.push({ node: id, geometry: { type: 'Point', coordinates: g.coordinates.slice(0, 2) } });
    }
  }
  if (!lines) { warnings.push(T('cdMapNoLines')); return; }
  // 畫面範圍：能移動的範圍（步道、入口都在裡面，外加一點邊界）、一開始的畫面（岩壁）、縮小時寬高都放得進畫面
  // （沒寫 fit 時縮小只看上下，直立的手機看不到整張的寬）
  const coords = (ms) => ms.flatMap(m => (m.geometry.type === 'Point' ? [m.geometry.coordinates] : m.geometry.coordinates));
  const grow = (list, meters) => {
    const [w, e, s, n] = [Math.min(...list.map(c => c[0])), Math.max(...list.map(c => c[0])), Math.min(...list.map(c => c[1])), Math.max(...list.map(c => c[1]))];
    const dLat = meters / 110574, dLng = meters / (111320 * Math.cos(((s + n) / 2) * Math.PI / 180));
    return [w - dLng, s - dLat, e + dLng, n + dLat].map(x => Math.round(x * 1e7) / 1e7);
  };
  const walls = new Set(wallByName.values()), wallMarks = map.marks.filter(m => walls.has(m.node));
  map.props = { ...map.props, bounds: grow(coords(map.marks), 30), home: grow(coords(wallMarks.length ? wallMarks : map.marks), 25), fit: 'contain' };
}

/**
 * 大綱 → 一本 Guidebook 的狀態，加上要放進去的圖片 [{ src, alt, wall（岩壁節點 id） }]、提醒、數量，
 * 和每個節點來自大綱的哪裡（lines：節點 id → { line（標題或表格在第幾行）, row（表格的第幾列路線） }，給問題清單 report.js 對回原文）。
 * 節點：最上層是岩場（crag），底下還有標題、或表格有「岩壁」欄的是區（area），其他是岩壁（wall）。
 * 放在區底下、沒有岩壁欄的路線收在區底下（Studio 的路線清單列在「未分配」，拖到岩壁）
 */
export function fromOutline(src, { t = Date.now(), grade: fallback = 'yds', map } = {}) {
  const { crag, sections, warnings } = parseOutline(src);
  const state = newBook(crag.name || T('cdBookUntitled'), t);
  const { book } = state;
  book.attribution = crag.attribution || '';
  book.license = crag.license || LICENSE;
  if (crag.source) {
    if (/^https:\/\//.test(crag.source)) book.source = { url: crag.source };
    else warnings.push(T('cdSourceNotHttps', crag.source));
  }
  const grade = crag.grade || fallback;
  if (crag.grade) book.props['author:grade'] = grade;
  const top = sections.find(s => s.parent === undefined);
  const hasChild = new Set(sections.map(s => s.parent).filter(p => p !== undefined));
  const id = new Map(), images = [], order = new Map(), lines = new Map();
  let areaImages = 0, loose = 0;
  const addNode = (type, name, parent, props = {}) => {
    const n = (order.get(parent) || 0) + 1;
    order.set(parent, n);
    const node = { id: newId(), type, name, props: { ...(type === 'crag' ? {} : { order: n }), ...props } };
    if (parent) node.parent = parent;
    book.nodes.push(node);
    return node.id;
  };
  const styleOf = (s) => { for (let x = s; x; x = sections[x.parent]) if (x.style) return x.style; return undefined; };
  const orderOf = (s) => { for (let x = s; x; x = sections[x.parent]) if (x.order) return x.order; return undefined; };
  for (const s of sections) {
    if (s.parent === undefined && s !== top) continue;   // 第二個最上層的標題（已提醒）
    const tables = s.tables.map(rows => { const map = guessColumns(rows); return { routes: toRoutes(rows, map, grade), map, rows }; });
    const routes = tables.flatMap(x => x.routes);
    const byColumn = routes.some(r => r.wall);
    const type = s === top ? 'crag' : hasChild.has(s.key) || byColumn ? 'area' : 'wall';
    const nid = addNode(type, s.name, id.get(s.parent), s.props);
    id.set(s.key, nid);
    lines.set(nid, { line: s.line });
    for (const x of tables) if (x.rows.length && !x.map.columns.includes('name')) warnings.push(T('cdNoNameColumn', s.name));
    const style = styleOf(s);
    const childWall = new Map();
    const wallFor = (name, line) => {
      const k = name.trim().toLowerCase();
      if (!childWall.has(k)) { childWall.set(k, addNode('wall', name.trim(), nid)); lines.set(childWall.get(k), { line }); }
      return childWall.get(k);
    };
    const ids = tables.map(x => x.routes.map((r, row) => {
      const props = { ...r.props };
      props.style ||= style || guessStyle(props);
      if (!props.style) delete props.style;
      if (!r.wall && type !== 'wall') loose++;
      const rid = addRoutes(state, [{ name: r.name, parent: r.wall ? wallFor(r.wall, x.rows.line) : nid, props }])[0];
      lines.set(rid, { line: x.rows.line, row: row + 1 });
      return rid;
    }));
    // 一面岩壁有好幾張表：每張表是它前面那張照片拍到的路線（照片附上由左到右的路線，描線時只在這幾條裡配）
    const grouped = type === 'wall' && s.tables.length > 1, sole = type === 'wall' && !grouped && s.images.length === 1;   // 只有一張照片：整面岩壁的路線都是它拍到的
    for (const img of s.images) {
      if (type !== 'wall') { areaImages++; images.push({ src: img.src, alt: img.alt, wall: nid, overview: true }); continue; }
      const at = grouped ? s.tables.findIndex(rows => rows.line > img.line && !s.images.some(o => o.line > img.line && o.line < rows.line)) : -1;
      const covered = at >= 0 ? ids[at] : sole ? ids.flat() : undefined;
      images.push({ src: img.src, alt: img.alt, wall: nid, ...(covered?.length ? { routes: orderOf(s) === 'rtl' ? [...covered].reverse() : covered } : {}) });
    }
  }
  const found = findPosition(sections);
  if (found) setCragPosition(state, found.position);
  else warnings.push(T('cdNoCragPosition'));
  if (map) applyMap(state, map, warnings);
  if (loose) warnings.push(T('cdLooseRoutes', loose));
  const count = (type) => book.nodes.filter(n => n.type === type).length;
  return { state, images, warnings, lines, position: found, count: { areas: count('area'), walls: count('wall'), routes: count('route'), images: images.length - areaImages, overview: areaImages } };
}
