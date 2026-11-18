// 轉換路線書的問題清單：Studio 的轉換預覽與命令列 tools/guidebook.mjs 顯示同一份，AI 和人看的是同一張清單。
// 只看資料（大綱轉出的結果、公開格式 v2 的組合與圖層），不碰畫面；文字走語言包（全域 AppKit.i18n）。
// English: the issue list for guidebook conversion, shared by the Studio preview and tools/guidebook.mjs.
//
// 報告：{ name, count, position, issues: [{ level, code, message, … }], routes: [{ id, name, wall, at, status, reasons }] }
//   level：error（不修不能發佈或建立）、check（要人看一眼）
//   路線 status：ok、check（reasons 說原因：unassigned 還沒分到岩壁、stub 沒描出線只放了記號、no-topo 沒有任何照片上的線）
//   at：這條路線來自大綱的哪裡（{ line, row }），只在報告裡，不寫進公開格式
import { STUB, WALL_TYPES } from './model.js';

const T = (...a) => AppKit.i18n.t(...a);
const name = (n) => (n == null ? '' : typeof n === 'string' ? n : (n['zh-Hant'] ?? Object.values(n)[0] ?? ''));
const isWall = (n) => n && WALL_TYPES.includes(n.type);

/** 大綱轉出的結果（outline.js 的 fromOutline）→ 報告；missing：找不到的圖檔名；position：另外填了岩場位置就不報缺位置 */
export function outlineReport(r, { missing = [], position } = {}) {
  const { book } = r.state;
  const issues = r.warnings.filter(w => w !== T('cdNoCragPosition')).map(message => ({ level: 'check', code: 'outline', message }));
  if (missing.length) issues.push({ level: 'error', code: 'missing-images', files: missing, message: T('cgMissingImages', missing.slice(0, 5).join(T('cgListSep')) + (missing.length > 5 ? '…' : '')) });
  const at = r.position?.position || position;
  if (!at) issues.push({ level: 'error', code: 'no-position', message: T('cdNoCragPosition') });
  const byId = new Map(book.nodes.map(n => [n.id, n]));
  const routes = book.nodes.filter(n => n.type === 'route').map(n => {
    const reasons = isWall(byId.get(n.parent)) ? [] : ['unassigned'];
    return { id: n.id, name: name(n.name), wall: name(byId.get(n.parent)?.name), at: r.lines?.get(n.id), status: reasons.length ? 'check' : 'ok', reasons };
  });
  return { name: name(book.name), count: r.count, position: at ? { lat: at[1], lng: at[0] } : null, issues, routes };
}

/**
 * 建好的書（公開格式 v2 的組合，與它的圖層；Studio 存的圖層還留著 author:stub）→ 報告。
 * photos：照片的 view（有拍攝位置也算有位置）；at：路線 id → 大綱的位置（建書前另外對過名稱）
 */
export function bookReport({ book, layers = [], photos = [], at = new Map() }) {
  const byId = new Map(book.nodes.map(n => [n.id, n]));
  const marks = new Map();   // 路線 id → 'line'（真的線或號碼）或 'stub'
  for (const l of layers) for (const m of l.marks || []) {
    if (!m.node || !byId.has(m.node)) continue;
    const kind = m.props?.[STUB] ? 'stub' : 'line';
    if (marks.get(m.node) !== 'line') marks.set(m.node, kind);
  }
  const crag = book.nodes.find(n => n.type === 'crag');
  const pos = crag?.geo?.coordinates || photos.find(v => v.camera?.position)?.camera.position;
  const issues = pos ? [] : [{ level: 'error', code: 'no-position', message: T('cdNoPosition') }];
  const routes = book.nodes.filter(n => n.type === 'route').map(n => {
    const reasons = [];
    if (!isWall(byId.get(n.parent))) reasons.push('unassigned');
    if (marks.get(n.id) === 'stub') reasons.push('stub');
    else if (!marks.has(n.id)) reasons.push('no-topo');
    return { id: n.id, name: name(n.name), wall: name(byId.get(n.parent)?.name), at: at.get(n.id), status: reasons.length ? 'check' : 'ok', reasons };
  });
  const count = (type) => book.nodes.filter(n => n.type === type).length;
  return { name: name(book.name), count: { areas: count('area'), walls: WALL_TYPES.reduce((k, t) => k + count(t), 0), routes: routes.length, photos: photos.length }, position: pos ? { lat: pos[1], lng: pos[0] } : null, issues, routes };
}

/** 路線的原因代碼 → 給人看的文字 */
export const reasonText = (code) => T({ unassigned: 'cdRouteUnassigned', stub: 'cdRouteStub', 'no-topo': 'cdRouteNoTopo' }[code]);

/** 報告 → 給人看的幾行文字（命令列印出來的）；有 error 時 ok 是 false */
export function reportLines(rep) {
  const c = rep.count, out = [`${rep.name}：${[T('cgNAreas', c.areas), T('cgNWalls', c.walls), T('cgNRoutes', c.routes), (c.photos ?? c.images) ? T('cgNPhotos', c.photos ?? c.images) : ''].filter(Boolean).join(T('cgListSep'))}`];
  for (const i of rep.issues) out.push(`- ${i.message}`);
  const check = rep.routes.filter(r => r.status !== 'ok');
  for (const r of check) out.push(`- ${[r.wall, r.name].filter(Boolean).join(' / ')}：${r.reasons.map(reasonText).join(T('cgListSep'))}${r.at ? `（${T('cdLineAt', r.at.line, r.at.row)}）` : ''}`);
  return { lines: out, ok: !rep.issues.some(i => i.level === 'error') };
}
