// 用公開岩場（開放資料集 climbio/crags）的全部 Topo，檢查 TopoKit 的牌子排版在各種手機寬度、各種縮放倍率下乾不乾淨：
//   node tools/topokit-audit.mjs [--verbose] [--widths 320,360,390,430] [--zooms 1,1.5,2,3,4,6] [--dir 本機資料夾]
// 每個（Topo、寬度、縮放）組合照 TopoViewer 的方式呼叫 renderLines，從輸出的 SVG 量：
//   牌子互相重疊、牌子壓到別條路線的線（分岔、合併的路線除外）、說明壓到牌子或別條線、畫了線卻沒有編號、牌子在畫面上太小、牌子超出照片。
// 資料抓一次放在暫存資料夾（CLIMBIO_AUDIT_CACHE 可改）；只讀公開資料，不寫 repo。
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTopo } from '../topokit/data.js';
import { renderLines } from '../topokit/render.js';
import { overlaps, segmentHitsBox, textWidth } from '../topokit/annotate.js';

const HUB = 'https://huggingface.co/datasets/climbio/crags/resolve/main/';
const CACHE = process.env.CLIMBIO_AUDIT_CACHE ?? join(tmpdir(), 'climbio-topo-audit');
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? dflt : process.argv[i + 1]; };
const WIDTHS = arg('widths', '320,360,390,430,768').split(',').map(Number);
const ZOOMS = arg('zooms', '1,1.5,2,3,4,6').split(',').map(Number);
const DIR = arg('dir', '');
const VERBOSE = process.argv.includes('--verbose');
// 牌子在畫面上的最小高度（螢幕像素）；字太小讀不了
export const MIN_PILL_PX = 14;

async function cached(path) {
  const file = join(CACHE, path.replace(/[/\\]/g, '_'));
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const r = await fetch(HUB + path);
  if (!r.ok) return undefined;
  const text = await r.text();
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, text);
  return JSON.parse(text);
}

/** 本機資料夾（index.json 加每張照片的 JSON，不必有照片）→ 一個岩場 */
function loadDir(dir) {
  const read = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const index = read('index.json');
  const all = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json').map(read);
  const topos = all.filter((d) => d.kind === 'view' && d.surface === 'photo').map((view) => ({
    name: `${view.name ?? view.id}`,
    input: { view, layers: all.filter((d) => d.kind === 'layer' && d.on === view.id), nodes: index.nodes ?? [] },
  }));
  return [{ name: index.name ?? dir, topos }];
}

/** 公開的岩場（不含別人岩場的改編版）→ [{ name, topos: [{ name, input }] }] */
async function loadCrags() {
  if (DIR) return loadDir(DIR);
  mkdirSync(CACHE, { recursive: true });
  const res = await fetch(HUB + 'crags.jsonl');
  const rows = (await res.text()).trim().split('\n').map((l) => JSON.parse(l)).filter((r) => !r.origin);
  const out = [];
  for (const row of rows) {
    const index = await cached(`${row.dir}index.json`);
    let docs = (await cached(`${row.dir}pack.json`))?.docs;
    if (!docs) {
      docs = {};
      for (const it of index.items) { const d = await cached(`${row.dir}${it.href}`); if (d) docs[it.href] = d; }
    }
    const all = Object.values(docs);
    const topos = all.filter((d) => d.kind === 'view' && d.surface === 'photo').map((view) => ({
      name: `${view.name ?? view.id}`,
      input: { view, layers: all.filter((d) => d.kind === 'layer' && d.on === view.id), nodes: index.nodes ?? [] },
    }));
    out.push({ name: row.name, topos });
  }
  return out;
}

const num = (s, name) => Number(new RegExp(`${name}="([-\\d.e]+)"`).exec(s)[1]);

/** 從 SVG 字串取出每個牌子（照片像素的框）與說明 */
function parse(svg, noteFontPx) {
  const badges = [], notes = [];
  for (const g of svg.matchAll(/<g class="topo-route[^"]*" data-route="([^"]*)"[^>]*>(.*?)<\/g>(?=<g class="topo-route|$)/gs)) {
    const id = g[1];
    for (const b of g[2].matchAll(/<g class="topo-badge[^"]*"><rect x="([-\d.e]+)" y="([-\d.e]+)" width="([-\d.e]+)" height="([-\d.e]+)"/g)) badges.push({ id, x: +b[1], y: +b[2], w: +b[3], h: +b[4] });
  }
  for (const g of svg.matchAll(/<g class="topo-route[^"]*" data-route="([^"]*)"[^>]*>(.*?)<\/g>(?=<g class="topo-route|$)/gs)) {
    for (const t of g[2].matchAll(/<text class="topo-note"[^>]*font-size="([-\d.e]+)"[^>]*>(.*?)<\/text>/g)) {
      const fs = +t[1], lines = [...t[2].matchAll(/<tspan x="([-\d.e]+)" y="([-\d.e]+)"[^>]*>(.*?)<\/tspan>/g)];
      if (!lines.length) continue;
      const k = fs / noteFontPx, w = Math.max(...lines.map((l) => textWidth(l[3].replace(/&#39;/g, "'").replace(/&amp;/g, '&'), noteFontPx) * k));
      notes.push({ id: g[1], x: +lines[0][1] - w / 2, y: +lines[0][2] - 6.25 * k, w, h: lines.length * 12.5 * k });
    }
  }
  return { badges, notes };
}

function measure(routes, photo, k, svg, ui) {
  const { badges, notes } = parse(svg, 10 * ui);
  const withLine = routes.filter((r) => r.line?.length >= 2);
  const have = new Set(badges.map((b) => b.id));
  // 分岔、合併的路線（起點或終點座標相同）的線本來就貼在一起，牌子難免靠著對方的線，不算壓線
  const key = (p) => `${p[0]},${p[1]}`, ends = (r) => [key(r.line[0]), key(r.line.at(-1))];
  const forked = (a, b) => { const e = ends(a); return ends(b).some((x) => e.includes(x)); };
  const byId = new Map(withLine.map((r) => [r.id, r]));
  const issues = { missing: [], badgeOverlap: 0, badgeOnLine: 0, noteOverlap: 0, noteOnLine: 0, small: 0, outside: 0 };
  for (const r of withLine) if (!have.has(r.id) && (r.label != null || r.grade)) issues.missing.push(r.label ?? r.id);
  for (let i = 0; i < badges.length; i++) {
    const a = badges[i];
    if (a.h / k < MIN_PILL_PX * ui - 0.01) issues.small++;
    if (a.x < photo.x || a.y < photo.y || a.x + a.w > photo.x + photo.w || a.y + a.h > photo.y + photo.h) issues.outside++;
    for (let j = i + 1; j < badges.length; j++) if (overlaps(a, badges[j], 0)) issues.badgeOverlap++;
    for (const r of withLine) if (r.id !== a.id && !forked(byId.get(a.id), r) && r.line.slice(1).some((p, n) => segmentHitsBox(r.line[n], p, a))) { issues.badgeOnLine++; (issues.where ??= []).push(`${byId.get(a.id).label ?? a.id}→${r.label ?? r.id}@${Math.round(a.x)},${Math.round(a.y)},${Math.round(a.w)}`); break; }
    for (const n of notes) if (overlaps(a, n, 0)) issues.noteOverlap++;
  }
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) if (overlaps(notes[i], notes[j], 0)) issues.noteOverlap++;
    for (const r of withLine) if (r.id !== notes[i].id && !forked(byId.get(notes[i].id), r) && r.line.slice(1).some((p, n) => segmentHitsBox(r.line[n], p, notes[i]))) { issues.noteOnLine++; break; }
  }
  return { ...issues, shown: badges.length, total: withLine.length };
}

export async function audit({ widths = WIDTHS, zooms = ZOOMS, verbose = VERBOSE } = {}) {
  const crags = await loadCrags();
  const total = { cases: 0, bad: 0 };
  const worst = [];
  for (const crag of crags) {
    let cragCases = 0, cragBad = 0, topoCount = 0;
    for (const topo of crag.topos) {
      const model = readTopo(topo.input, { lang: 'zh-Hant' });
      const routes = model.routes.filter((r) => r.line?.length >= 2 || r.at);
      if (!routes.some((r) => r.line?.length >= 2)) continue;
      topoCount++;
      const photo = model.photo, c = model.crop ?? { x: 0, y: 0, w: photo.w, h: photo.h };
      for (const width of widths) {
        const ui = width >= 768 ? 1.5 : 1;
        for (const zoom of zooms) {
          // TopoViewer 的算法：fit=width，一個螢幕像素等於 k 個照片像素
          const k = c.w / (width * zoom);
          const bolts = zoom >= 1.8 || undefined;
          const svg = renderLines(routes, { photo, crop: c, k, ui, naturalEnds: true, bolts, memo: new Map(), interactive: true });
          const m = measure(routes, c, k, svg, ui);
          const bad = m.missing.length + m.badgeOverlap + m.badgeOnLine + m.noteOverlap + m.noteOnLine + m.small + m.outside;
          cragCases++; if (bad) cragBad++;
          if (bad) worst.push({ crag: crag.name, topo: topo.name, width, zoom, bad, ...m });
          if (verbose && bad) console.log(`  ${crag.name}／${topo.name} ${width}px ×${zoom}：`, JSON.stringify(m));
        }
      }
    }
    total.cases += cragCases; total.bad += cragBad;
    console.log(`${crag.name}：${topoCount} 張 Topo，${cragCases} 組，有問題 ${cragBad} 組`);
  }
  const sum = (key) => worst.reduce((a, w) => a + (Array.isArray(w[key]) ? w[key].length : w[key]), 0);
  console.log(`合計 ${total.cases} 組，有問題 ${total.bad} 組｜重疊 ${sum('badgeOverlap')}、壓別條線 ${sum('badgeOnLine')}、說明壓牌子 ${sum('noteOverlap')}、說明壓線 ${sum('noteOnLine')}、缺編號 ${sum('missing')}、太小 ${sum('small')}、超出 ${sum('outside')}`);
  return { total, worst };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('topokit-audit.mjs')) {
  const { total } = await audit();
  process.exitCode = total.bad ? 1 : 0;
}
