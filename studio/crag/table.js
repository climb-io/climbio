// 路線表格：從 Google 試算表、Excel 複製的文字（Tab 分隔）或 CSV 讀成路線。只處理文字，不碰狀態與畫面。
//   parseTable(文字) → 列；guessColumns(列) → { header, columns }（每欄對應到哪個欄位）；toRoutes(列, 對應) → 路線
//   路線表格（步驟「路線清單」）的欄位：COLUMNS、shownColumns；一格的文字與改了之後的路線：cellText、cellPatch
import { GRADE_SYSTEMS, text, withText } from './model.js';

const T = (...a) => globalThis.AppKit.i18n.t(...a);   // 文字在呼叫時才查（Node 測試也載入這個檔）

/** 表格的欄位（key 對應路線的 props，name 和 wall 例外） */
export const fields = () => [
  ['name', T('cgName')], ['grade', T('cgGrade')], ['style', T('cgStyle')], ['length', T('cgLength')], ['pitches', T('cgPitches')], ['bolts', T('cgBolts')],
  ['description', T('cgDesc')], ['fa', T('cgFa')], ['setter', T('cgSetter')], ['code', T('cgCode')], ['wall', T('cgWall')],
];

const HEADERS = {
  name: ['名稱', '路線', '路線名稱', '路線名', '中文名', 'name', 'route', 'routename', 'title'],
  grade: ['難度', '等級', '級數', 'grade', 'difficulty', 'yds', 'french', '法式', 'font', 'v'],
  style: ['類型', '型式', '種類', '攀登方式', 'style', 'type', 'kind'],
  length: ['長度', '高度', '公尺', 'length', 'height', 'm', 'meters'],
  pitches: ['繩距', '段數', 'pitches', 'pitch'],
  bolts: ['bolt', 'bolts', 'bolt數', '快扣', '快扣數', '扣數', 'quickdraws', 'qd'],
  description: ['說明', '描述', '備註', '介紹', 'description', 'notes', 'note', 'comment'],
  fa: ['首攀', '首攀者', 'fa', 'firstascent'],
  setter: ['定線', '定線者', '開線', '開線者', 'setter', 'bolter', 'equipper'],
  code: ['代號', '編號', 'code', 'id', 'number', 'no', '#'],
  wall: ['岩壁', '分區', '牆', 'wall', 'sector', 'crag', 'area'],
};
const norm = (s) => s.toLowerCase().replace(/[\s_\-.:：（）()]/g, '');
const HEADER_OF = new Map(Object.entries(HEADERS).flatMap(([k, list]) => list.map(h => [norm(h), k])));
// 欄名不完全一樣時（「需要快扣數（不含 top anchor）」「路線描述」）：找欄名裡的關鍵字，取最靠後的那個（中文的複合詞重點在後面），一樣後面取長的
const HEADER_WORDS = [...HEADER_OF].filter(([w]) => w.length >= 2 && (/[^\x00-\x7f]/.test(w) || w.length >= 4));
function headerOf(cell) {
  const c = norm(cell);
  if (HEADER_OF.has(c)) return HEADER_OF.get(c);
  let best, end = -1;
  for (const [w, k] of HEADER_WORDS) {
    const at = c.lastIndexOf(w);
    if (at >= 0 && (at + w.length > end || (at + w.length === end && w.length > best[0].length))) { best = [w, k]; end = at + w.length; }
  }
  return best?.[1];
}

export const STYLE_WORDS = {
  sport: ['sport', '運動', '運動攀登', '運攀', 's', 'bolted', 'leading', 'lead', '先鋒', '先鋒攀登'],
  trad: ['trad', '傳統', '傳統攀登', '傳攀', 't', 'traditional'],
  boulder: ['boulder', '抱石', 'b', 'bouldering'],
  toprope: ['toprope', '頂繩', 'tr', 'top rope', 'top-rope'],
  mixed: ['mixed', '混合'],
  aid: ['aid', '人工', '人工攀登'],
  ice: ['ice', '冰攀'],
  dws: ['dws', '深水', '深水抱石', 'deepwatersolo'],
};
const STYLE_OF = new Map(Object.entries(STYLE_WORDS).flatMap(([k, list]) => list.map(w => [norm(w), k])));

/** 文字 → 列（字串陣列）。有 Tab 就是試算表複製的，否則是 CSV（逗號或分號）；引號裡可以有分隔符號和換行 */
export function parseTable(src) {
  const textIn = String(src).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const first = textIn.split('\n', 1)[0];
  const sep = textIn.includes('\t') ? '\t' : (first.split(';').length > first.split(',').length ? ';' : ',');
  const rows = [];
  let row = [], cell = '', quoted = false, i = 0;
  while (i < textIn.length) {
    const c = textIn[i];
    if (quoted) {
      if (c === '"' && textIn[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (c === '"') { quoted = false; i++; continue; }
      cell += c; i++; continue;
    }
    if (c === '"' && cell.trim() === '') { quoted = true; cell = ''; i++; continue; }
    if (c === sep) { row.push(cell.trim()); cell = ''; i++; continue; }
    if (c === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += c; i++;
  }
  row.push(cell.trim()); rows.push(row);
  const kept = rows.filter(r => r.some(c => c !== ''));
  const width = Math.max(0, ...kept.map(r => r.length));
  return kept.map(r => [...r, ...Array(width - r.length).fill('')]);
}

const GRADE_RE = [
  [/^5\.\d{1,2}[a-d]?[+-]?(\/[a-d])?$/i, 'yds'],
  [/^v(\d{1,2}|b)([+-]|-\d{1,2})?$/i, 'v'],
  [/^[1-9][abc]?\+?$/i, 'frenchfont'],
  [/^(\d{1,2}級|[初二三四五六]段)$/, 'dan'],
];
const gradeKind = (v) => GRADE_RE.find(([re]) => re.test(v.trim()))?.[1];

/** 難度文字 → { 系統: 值 }。5.11a 是 yds、V3 是 v；6a／6A 照預設系統（不是 french、font 時小寫當 french、大寫當 font）；認不出就用預設系統 */
export function parseGrade(value, fallback = 'yds') {
  const v = value.trim();
  if (!v) return undefined;
  const kind = gradeKind(v);
  if (kind === 'yds') return { yds: v.toLowerCase() };
  if (kind === 'v') return { v: v.toUpperCase() };
  if (kind === 'dan') return { dan: v };
  if (kind === 'frenchfont' && /[a-c]/i.test(v)) {
    const sys = ['french', 'font'].includes(fallback) ? fallback : (/[A-C]/.test(v) ? 'font' : 'french');
    return { [sys]: sys === 'font' ? v.toUpperCase() : v.toLowerCase() };
  }
  return { [GRADE_SYSTEMS.includes(fallback) ? fallback : 'yds']: v };
}

/** 類型文字 → 詞彙（sport、trad……）；認不出的照原樣（小寫） */
export const parseStyle = (value) => STYLE_OF.get(norm(value)) || value.trim().toLowerCase() || undefined;

/** 數字（可以帶 m、公尺、千分位） */
export function parseNumber(value, int) {
  const n = Number(value.replace(/[,\s]|公尺|米|m$/gi, ''));
  if (!value.trim() || !Number.isFinite(n) || n < 0) return undefined;
  return int ? Math.round(n) : n;
}

const share = (values, ok) => { const v = values.filter(Boolean); return v.length ? v.filter(ok).length / v.length : 0; };

/** 猜每欄是什麼：第一列有認得的欄名就當標題；其餘看內容（難度、類型、數字依序當長度與 bolt 數、第一個文字欄當名稱） */
export function guessColumns(rows) {
  const top = rows[0] || [];
  const named = top.map(headerOf);
  const header = rows.length > 1 && named.some(Boolean) && !top.some(c => gradeKind(c) && !HEADER_OF.has(norm(c)));
  const columns = top.map((_, i) => (header ? named[i] || '' : ''));
  const used = new Set(columns.filter(Boolean));
  const body = header ? rows.slice(1) : rows;
  const col = (i) => body.map(r => r[i] || '');
  const assign = (key, test) => {
    if (used.has(key)) return;
    const i = columns.findIndex((c, j) => !c && test(col(j)));
    if (i >= 0) { columns[i] = key; used.add(key); }
  };
  const numeric = (vals) => share(vals, v => parseNumber(v) !== undefined) >= 0.8;
  assign('grade', vals => share(vals, v => gradeKind(v) && !/^\d+$/.test(v)) >= 0.6);
  assign('style', vals => share(vals, v => STYLE_OF.has(norm(v))) >= 0.6);
  assign('length', vals => numeric(vals) && share(vals, v => /m|公尺|米/i.test(v)) >= 0.5);
  assign('length', numeric);
  assign('bolts', numeric);
  assign('name', vals => share(vals, v => parseNumber(v) === undefined) >= 0.6);
  return { header, columns };
}

/** 名稱：兩行、第二行是英文（路線書常見的「喬溪／Chelsea」）就是多語名稱，否則換行當空白 */
function nameOf(v) {
  const [zh, en, ...more] = v.split('\n').map(s => s.trim()).filter(Boolean);
  if (en && !more.length && /^[\x20-\x7e]+$/.test(en) && /[^\x00-\x7f]/.test(zh)) return { 'zh-Hant': zh, en };
  return [zh, en, ...more].filter(Boolean).join(' ');
}

/** 列 → 路線 [{ name, wall?（岩壁名稱）, props }]；沒有名稱的列略過 */
export function toRoutes(rows, { header, columns }, gradeSystem = 'yds') {
  const out = [];
  for (const r of header ? rows.slice(1) : rows) {
    const route = { name: '', props: {} };
    columns.forEach((key, i) => {
      const v = (r[i] || '').trim();
      if (!key || !v) return;
      if (key === 'name') route.name = nameOf(v);
      else if (key === 'wall') route.wall = v;
      else if (key === 'grade') { const g = parseGrade(v, gradeSystem); if (g) route.props.grade = { ...route.props.grade, ...g }; }
      else if (key === 'style') route.props.style = parseStyle(v);
      else if (key === 'length') { const n = parseNumber(v); if (n !== undefined) route.props.length = n; }
      else if (key === 'pitches') { const n = parseNumber(v, true); if (n !== undefined) route.props[key] = n; }
      else if (key === 'bolts') {   // 「傳攀」「傳攀＋2 bolt」：類型寫在 bolt 欄，數字是 bolt 數
        const n = parseNumber(v, true) ?? (v.match(/\d+/) ? Number(v.match(/\d+/)[0]) : undefined);
        if (n !== undefined) route.props.bolts = n;
        const st = [...STYLE_OF].find(([w]) => w.length >= 2 && norm(v).includes(w))?.[1];
        if (st && !route.props.style) route.props.style = st;
      } else route.props[key] = v;
    });
    if (route.name) out.push(route);
  }
  return out;
}

/** CSV 檔的文字：UTF-8，不是的話當 Big5（台灣的 Excel 存的 CSV） */
export function decodeText(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('big5').decode(bytes); }
}

// ---- 路線表格的欄位：名稱照龍洞的路線 Sheet（維護的人最多，不用重新學）；width 是畫面像素 ----
export const COLUMNS = [
  { key: 'number', get label() { return T('cgColNumber'); }, width: 84 },   // 只在「自己填」編號時顯示
  { key: 'name', get label() { return T('cgColName'); }, width: 160 },
  { key: 'grade', get label() { return T('cgGrade'); }, width: 76 },
  { key: 'style', get label() { return T('cgColStyle'); }, width: 84 },
  { key: 'length', get label() { return T('cgColHeight'); }, width: 64 },
  { key: 'pitches', get label() { return T('cgPitches'); }, width: 56 },
  { key: 'bolts', get label() { return T('cgColBolts'); }, width: 68 },
  { key: 'fa', get label() { return T('cgFa'); }, width: 130 },
  { key: 'setter', get label() { return T('cgSetter'); }, width: 110 },
  { key: 'code', get label() { return T('cgCode'); }, width: 110 },
  { key: 'description', get label() { return T('cgColDesc'); }, width: 200 },   // 最少的寬度，其他吃剩下的
];
/** 小岩場一開始看到的欄位；其他欄位有資料才顯示（代號只在設定裡打開才顯示） */
const BASIC = ['grade', 'style', 'length', 'bolts', 'description'];
const AUTO = ['pitches', 'fa', 'setter'];

/** 要顯示的欄位 key（名稱一定有）：岩場設定選過就照設定，否則是基本欄位加上有資料的欄位 */
export function shownColumns(chosen, routes, manual = false) {
  const has = (k) => routes.some(r => r.props?.[k] !== undefined && r.props[k] !== '');
  const want = new Set(Array.isArray(chosen) ? chosen : [...BASIC, ...AUTO.filter(has)]);
  return COLUMNS.filter(c => c.key === 'name' || (c.key === 'number' ? manual : want.has(c.key))).map(c => c.key);
}

// 路線種類的顯示名稱（getter：呼叫時才查文字）；輸入時各語言的名稱和英文別名都收（HEADERS／STYLES）
export const STYLE_LABEL = {
  get sport() { return T('cgStyleSport'); }, get trad() { return T('cgStyleTrad'); }, get boulder() { return T('cgStyleBoulder'); }, get toprope() { return T('cgStyleToprope'); },
  get mixed() { return T('cgStyleMixed'); }, get aid() { return T('cgStyleAid'); }, get ice() { return T('cgStyleIce'); }, get dws() { return T('cgStyleDws'); },
};
/** 這條路線用哪個難度系統：抱石用抱石的系統（岩場用法式就是 Font，其他是 V；岩場本來就用 V、Font 照舊），其他用岩場的 */
export const gradeSysOf = (r, sys) => (r?.props?.style === 'boulder' && !['v', 'font'].includes(sys) ? (sys === 'french' ? 'font' : 'v') : sys);
/** 難度顯示哪個系統：預設系統有就用它，否則第一個 */
const gradeSys = (grade, sys) => (grade && typeof grade === 'object' && !(sys in grade) && Object.keys(grade).length ? Object.keys(grade)[0] : sys);

/** 一格顯示的文字 */
export function cellText(r, key, sys) {
  const p = r.props || {};
  if (key === 'name') return text(r.name);
  if (key === 'grade') return p.grade && typeof p.grade === 'object' ? p.grade[gradeSys(p.grade, gradeSysOf(r, sys))] ?? '' : '';
  if (key === 'style') return p.style ? STYLE_LABEL[p.style] || p.style : '';
  if (key === 'description') return text(p.description);
  return p[key] == null ? '' : String(p[key]);
}

/**
 * 一格改成 value 之後的路線：{ name } 或 { props }（整份）；不合法（名稱空白、數字不對）回傳 null。
 * 難度只換顯示的那個系統，其他系統留著；多語的名稱、說明只換中文
 */
export function cellPatch(r, key, value, sys) {
  const v = value.trim(), props = { ...(r?.props || {}) };
  if (key === 'name') return v ? { name: nameOf(v) } : null;
  if (key === 'grade') {
    sys = gradeSysOf(r, sys);
    const grade = { ...(props.grade && typeof props.grade === 'object' ? props.grade : {}) };
    delete grade[gradeSys(grade, sys)];
    Object.assign(grade, v ? parseGrade(v, sys) : {});
    if (Object.keys(grade).length) props.grade = grade; else delete props.grade;
  } else if (key === 'style') {
    if (v) props.style = parseStyle(v); else delete props.style;
  } else if (['length', 'pitches', 'bolts'].includes(key)) {
    const n = parseNumber(v, key !== 'length');
    if (v && n === undefined) return null;
    if (n === undefined) delete props[key]; else props[key] = n;
  } else if (key === 'description') {
    if (v) props.description = withText(props.description, v); else delete props.description;
  } else if (v) props[key] = v;
  else delete props[key];
  return { props };
}

/** 選難度用的清單（由易到難）；沒有的系統（british）照打的 */
const series = (nums, marks) => nums.flatMap(n => marks.map(m => `${n}${m}`));
export const GRADES = {
  yds: [...Array.from({ length: 10 }, (_, i) => `5.${i}`), ...series([10, 11, 12, 13, 14, 15], ['a', 'b', 'c', 'd']).map(g => `5.${g}`)],
  french: ['3', '4a', '4b', '4c', '5a', '5b', '5c', ...series([6, 7, 8, 9], ['a', 'a+', 'b', 'b+', 'c', 'c+'])],
  font: ['3', '4', '4+', '5', '5+', ...series([6, 7, 8, 9], ['A', 'A+', 'B', 'B+', 'C', 'C+'])],
  uiaa: ['3', '4-', '4', '4+', ...series([5, 6, 7, 8, 9, 10, 11, 12], ['-', '', '+'])],
  v: ['VB', ...Array.from({ length: 18 }, (_, i) => `V${i}`)],
  dan: [...Array.from({ length: 10 }, (_, i) => `${10 - i}級`), '初段', '二段', '三段', '四段', '五段'],
};
