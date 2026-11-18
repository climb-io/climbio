// 香港攀岩網站（hongkongclimbing.com，WordPress）的轉接器：extractPage 在頁面裡讀資料（只讀使用者已經打開的這一頁），prepare 轉成 Climbio 公開格式 v2。
// 網站的路線是文字（「1) 路線名 *** F6b」後面接說明與「F.A.」首攀），Topo 的線畫在照片裡面（不是向量），所以只收照片畫面、不放路線圖層。
// 網站內容有著作權（作者提供免費下載、列印、個人使用，不能商用散布），所以畫面的 origin 是 personal、署名不填，跟 theCrag 一樣只存進使用者自己的 Drive。
import { sha24 } from './hash.js';
import { PREVIEW, previewProps } from './sourcekit/preview-sheet.js';
import { idOf } from './thecrag.js';
import { TOPO_EDGE, fitSize, isUsableSize } from './sourcekit/photo-size.js';
import { traceBadges } from './sourcekit/trace.js';

/** 轉出來的內容改了就加一，已經收藏的岩場下次存會重存 */
const CONVERTER = 2;   // 1 → 2：照片上印的號碼牌讀出來，標成路線號碼
/** 在岩場頁執行：回傳純 JSON { url, name, sections, groups, routes, photos }。要能單獨序列化後注入頁面，不能用外面的任何東西 */
export function extractPage() {
  const root = document.querySelector('.entry-content');
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const out = { url: location.href.split('#')[0], name: clean(document.querySelector('h1.entry-title')?.textContent) || clean(document.title), sections: {}, groups: [], routes: [], photos: [] };
  if (!root) return out;
  const GRADE = /^(?:F\d[abc]?[+-]?|V(?:\d{1,2}|B)[+-]?|E\d|HVS|VS|HS|5\.\d{1,2}[a-d]?[+-]?|\d[abc]\+?)[,.]?$/;
  const FA = /^(?:F\.?\s?F\.?\s?A|F\.?\s?A|First ascent)\b\.?:?\s*/i;
  const ROUTE = /^\(?(\d{1,3}[a-z]?|[A-Z])\)\s*(\S.*)$/;
  const title = (rest) => {
    const tokens = clean(rest).replace(/\*+/g, ' ').split(' ').filter(Boolean);
    const at = tokens.findIndex((t, i) => i > 0 && GRADE.test(t));
    return { name: (at < 0 ? tokens : tokens.slice(0, at)).join(' ').replace(/\s*[-–]$/, ''), grade: at < 0 ? '' : tokens.slice(at).join(' ').replace(/^[-–]\s*/, ''), stars: (rest.match(/\*+/) || [''])[0].length };
  };
  const GENERIC = /^(routes?|problems?|climbs?|warning|notes?|topos?)$/i;
  const SECTION = { approach: /^(approach|access|getting there|how to get)/i, description: /^(general|about|introduction|overview)/i };
  let group = null, kind = null;   // group：目前的小標題（岩壁、石頭）；kind：目前在讀的是交通還是說明
  for (const el of root.children) {
    if (/^H[1-6]$/.test(el.tagName)) {
      const name = clean(el.textContent);
      if (!name) continue;
      kind = Object.keys(SECTION).find((k) => SECTION[k].test(name)) || null;
      if (kind || GENERIC.test(name)) { group = null; continue; }   // 交通、說明、「Routes」這類不是岩壁名稱的標題
      out.groups.push(name); group = out.groups.length - 1;
      continue;
    }
    for (const img of el.querySelectorAll('img')) {
      const [w, h] = (img.dataset.origSize || '').split(',').map(Number);
      const url = (img.closest('a')?.href || img.dataset.origFile || img.src || '').replace(/\?.*$/, '');
      if (w > 0 && h > 0 && url && !out.photos.some((p) => p.url === url)) out.photos.push({ url, w, h, group });
    }
    if (el.tagName !== 'P') continue;
    const lines = el.innerHTML.split(/<br\s*\/?>/i).map((l) => clean(l.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;|&rsquo;/g, '’'))).filter(Boolean);
    if (!lines.length) continue;
    const m = lines[0].match(ROUTE);
    if (m && m[2].length > 1) {
      const fa = lines.slice(1).find((l) => FA.test(l));
      out.routes.push({ num: m[1], ...title(m[2]), description: lines.slice(1).filter((l) => !FA.test(l)).join('\n'), fa: fa ? fa.replace(FA, '') : '', group });
    } else if (!/^(download|share this|like this)/i.test(lines[0])) {
      const key = group === null ? (kind || 'description') : null;
      if (key) out.sections[key] = out.sections[key] ? `${out.sections[key]}\n${lines.join('\n')}` : lines.join('\n');
    }
  }
  return out;
}

const STYLE_OF = (grade) => (/^V/i.test(grade) ? 'boulder' : /^F/i.test(grade) ? 'sport' : /^(E\d|HVS|VS|HS)/i.test(grade) ? 'trad' : undefined);
const gradeProps = (grade) => {
  const first = grade.split(',')[0].trim();
  if (/^F\d/i.test(first)) return { french: first.slice(1) };
  if (/^V(\d|B)/i.test(first)) return { v: first.toUpperCase() };
  return undefined;
};

const routeIdOf = (page, r) => idOf(`hkclimbing:route:${page.url}:${r.group}:${r.num}:${r.name}`);

/** 圖片 Blob → { data, width, height }（RGBA）；service worker 沒有 DOM，用 OffscreenCanvas */
async function decodePixels(blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), g = canvas.getContext('2d', { willReadFrequently: true });
    g.drawImage(bitmap, 0, 0);
    return g.getImageData(0, 0, bitmap.width, bitmap.height);
  } finally { bitmap.close(); }
}

/** 原圖長邊夠大（>= MIN_EDGE，放大到手機上才看得清線）的照片；太小的不收 */
export const usablePhotos = (page) => page.photos.filter((p) => isUsableSize(p.w, p.h));

/**
 * 一個岩場頁要存的東西（轉接器介面同龍洞、OpenClimbing）：{ id, name, files: [{ path, json }], photos: [{ path, url, size }], sheet, version }。
 * 沒有分小標題的路線、照片掛在一個預設岩壁底下，紅點貓才不會把照片當成區域照片。
 */
export async function prepare(page, t = Date.now()) {
  const setId = idOf(`hkclimbing:${page.url}`), cragId = idOf(`hkclimbing:crag:${page.url}`);
  const version = await sha24(`${CONVERTER}\n${JSON.stringify(page)}`);
  const common = { climbio: 2, t, license: 'NOASSERTION', attribution: '', source: { url: page.url, version } };
  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)));
  const nodes = [{ id: cragId, type: 'crag', name: page.name, props: clean({ description: page.sections.description, approach: page.sections.approach }) }];
  const photosIn = usablePhotos(page);
  const loose = [...page.routes, ...photosIn].some((x) => x.group === null);
  const defaultId = loose || !page.groups.length ? idOf(`hkclimbing:sector:${page.url}:default`) : null;
  if (defaultId) nodes.push({ id: defaultId, type: 'sector', parent: cragId, name: page.name });
  const sectorId = (g) => (g === null ? defaultId : idOf(`hkclimbing:sector:${page.url}:${g}`));
  page.groups.forEach((name, i) => nodes.push({ id: sectorId(i), type: 'sector', parent: cragId, name, props: { order: i + 1 } }));
  const order = new Map();
  for (const r of page.routes) {
    const n = (order.get(r.group) || 0) + 1;
    order.set(r.group, n);
    nodes.push({ id: routeIdOf(page, r), type: 'route', parent: sectorId(r.group), name: r.name, props: clean({
      code: `hkclimbing/${r.num}`, grade: gradeProps(r.grade), 'hkclimbing:grade': r.grade, style: STYLE_OF(r.grade), 'hkclimbing:stars': r.stars || undefined, order: n, description: r.description, fa: r.fa,
    }) });
  }
  const files = [], photos = [], items = [];
  for (const p of photosIn) {
    const viewId = idOf(`hkclimbing:photo:${p.url}`), size = fitSize(p.w, p.h, TOPO_EDGE);
    files.push({ path: `${viewId}.json`, json: { ...common, kind: 'view', surface: 'photo', id: viewId, href: `${viewId}.jpg`, w: size.w, h: size.h, mime: 'image/jpeg', origin: 'personal', props: { node: sectorId(p.group) ?? defaultId } } });
    photos.push({ path: `${viewId}.jpg`, url: p.url, size });
    items.push({ href: `${viewId}.json`, id: viewId, props: { tile: photos.length - 1 } });
  }
  files.unshift({ path: 'index.json', json: { ...common, kind: 'set', type: 'crag', id: setId, name: page.name, props: { sourceLabel: 'Hong Kong Climbing', attributionStatus: 'unverified', ...(photos.length ? { preview: previewProps(photos.length) } : {}) }, items, nodes } });
  const sheet = photos.length ? { path: PREVIEW, urls: photos.map((p) => p.url) } : null;
  return { id: setId, name: page.name, files, photos, sheet, version, annotate: (pics, decode) => annotate(page, files, common, pics, decode) };
}

/**
 * 照片下載好之後（pics：圖片網址 → Blob，已縮到 TOPO_EDGE 以內）：讀照片上印的號碼牌，號碼對得上這一頁的某條路線（同一頁只有一條、數字一樣）的，
 * 標成那條路線的路線號碼（Point 標註，蓋在原牌子上、用原牌子的顏色）。讀不出號碼、對不上、同一個號碼出現兩次的都不標：寧可沒有，不要標錯。
 * 回傳要加進這份收藏的 { files（圖層）, items（放進組合的項目）, marked（標了幾條） }
 */
async function annotate(page, files, common, pics, decode = decodePixels) {
  const out = { files: [], items: [], marked: 0 }, byNum = new Map();
  for (const r of page.routes) (byNum.get(r.num) ?? byNum.set(r.num, []).get(r.num)).push(r);
  for (const view of files.map((f) => f.json).filter((d) => d.kind === 'view')) {
    const photo = page.photos.find((p) => view.href === `${idOf(`hkclimbing:photo:${p.url}`)}.jpg`), blob = photo && pics.get(photo.url);
    if (!blob) continue;
    const seen = new Map();   // 號碼 → 這張照片上讀到的牌子
    for (const b of traceBadges(await decode(blob), 1)) if (b.text) (seen.get(b.text) ?? seen.set(b.text, []).get(b.text)).push(b);
    const marks = [];
    for (const [text, list] of seen) {
      if (list.length !== 1) continue;
      const same = byNum.get(text) ?? [];
      const route = same.length === 1 ? same[0] : same.filter((r) => r.group === photo.group).length === 1 ? same.find((r) => r.group === photo.group) : null;
      if (!route) continue;
      const [b] = list;
      marks.push({ node: routeIdOf(page, route), geometry: { type: 'Point', coordinates: b.point }, props: { label: text, size: b.size, style: { stroke: b.color } } });
    }
    if (!marks.length) continue;
    const layerId = idOf(`hkclimbing:layer:${view.id}`);
    out.files.push({ path: `${layerId}.json`, json: { ...common, kind: 'layer', id: layerId, on: view.id, href: `${view.id}.json`, marks } });
    out.items.push({ href: `${layerId}.json`, id: layerId });
    out.marked += marks.length;
  }
  return out;
}
