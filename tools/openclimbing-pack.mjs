#!/usr/bin/env node
// 建 OpenClimbing 岩場的靜態資料：把「點小卡才即時查 OSM、Commons」改成建索引時查好、驗證好。
//
// 用法：node tools/openclimbing-pack.mjs <openclimbing.sqlite> [--cache=<檔案>] [--limit=<岩場數>]
//
// 輸入：data/openclimbing/index.json（候選岩場清單，tools/openclimbing-index.py 產生）＋ OpenClimbing 官方匯出的 SQLite（https://openclimbing.org/export，
//       只讀 climbing_features：岩場、路線與它們的標籤；不讀使用者的攀登紀錄）。
// 做的事：
//   1. 每個岩場（含底下的子岩場）取出有線的照片路線；
//   2. 問 Commons 這些照片：存在、授權是 CC／公眾領域（規則同紅點貓，見 sourcekit/openclimbing-read.js 的 imageInfoOf）；
//   3. 再讀每張照片的網址（HEAD），確定真的讀得到、是圖片；
//   4. 每個岩場寫一個 data/openclimbing/<relation id>/topo.json（紅點貓點小卡時只讀這一個檔，再下載照片），
//      索引只留「至少有一張驗證過的照片」的岩場，tc 改成驗證過的路線數、新增 pc＝驗證過的照片數。
// 照片分四種結果，不混在一起：
//   ok        讀得到（收進去）
//   missing   Commons 上沒有這個檔案、或網址回 404／410、或不是圖片（真的沒有，不收）
//   unlicensed 授權不是 CC／公眾領域（不收）
//   unknown   暫時讀不到（網路中斷、逾時、429、5xx、403）：重試後仍失敗才算；不當成沒有照片，也不收進索引，
//             岩場列在「待補」，結束碼 2；再跑一次同一個指令（同一個 --cache）只重試 unknown。
// English: Pre-verifies OpenClimbing photo topos at index time so the app only downloads photos at tap time.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { imageInfoOf, parsePath, photosOf } from '../sourcekit/openclimbing-read.js';
import { COMMONS_REQUEST_WIDTH } from '../sourcekit/photo-size.js';
import { theCragUrl } from '../redpoint/thecrag-links.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 產出放在 data/openclimbing/（不進版控），版面同開放資料集 climbio/crags 的 openclimbing/：index.json、<id>/topo.json；上傳由人做
const OUT = path.join(ROOT, 'data', 'openclimbing');
const INDEX = path.join(OUT, 'index.json');
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const UA = 'ClimbioIndexBuilder/1.0 (+https://climbio.app)';
const TRIES = 4;

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const dbPath = args.find((a) => !a.startsWith('--'));
if (!dbPath) { console.error('用法：node tools/openclimbing-pack.mjs <openclimbing.sqlite> [--cache=<檔案>] [--limit=<岩場數>]'); process.exit(1); }
const cachePath = flag('cache') ?? path.join(path.dirname(path.resolve(dbPath)), 'openclimbing-pack-cache.json');
const limit = Number(flag('limit') ?? 0) || Infinity;

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const chunk = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, (i + 1) * n));
async function mapLimit(list, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (next < list.length) { const i = next++; await fn(list[i], i); } }));
}

/** 暫時性的失敗（值得重試）：網路、逾時、429、5xx、403（維基的限流有時回 403）；其他 4xx 是真的沒有 */
const transient = (status) => status === 429 || status === 403 || status >= 500;
async function attempt(fn) {
  let why = '';
  for (let i = 0; i < TRIES; i++) {
    try {
      const r = await fn();
      if (!r.retry) return r;
      why = r.why;
      if (i < TRIES - 1) await sleep(Math.max(r.wait ?? 0, 1500 * 2 ** i + Math.random() * 500));
    } catch (e) {
      why = `${e.name === 'TimeoutError' ? '逾時' : '網路'}：${e.message}`;
      if (i < TRIES - 1) await sleep(1500 * 2 ** i + Math.random() * 500);
    }
  }
  return { unknown: why };
}
const retryAfter = (res) => (Number(res.headers.get('retry-after')) || 0) * 1000;

// ── 取出候選 ──
const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
const db = new DatabaseSync(path.resolve(dbPath), { readOnly: true });
const crags = new Map(), kids = new Map(), routesOf = new Map();
for (const row of db.prepare("SELECT osmId, parentId, name, nameRaw, type, tags FROM climbing_features WHERE type IN ('crag','route')").all()) {
  let tags;
  try { tags = JSON.parse(row.tags || '{}'); } catch { continue; }
  if (!tags || typeof tags !== 'object') continue;
  if (row.type === 'crag') {
    crags.set(row.osmId, { id: row.osmId, name: tags.name || row.name || row.nameRaw || '', parentId: row.parentId, tags });
    if (row.parentId != null) kids.set(row.parentId, [...(kids.get(row.parentId) ?? []), row.osmId]);
  } else if (/^route(_bottom)?$/.test(tags.climbing ?? '') && row.parentId != null) {
    routesOf.set(row.parentId, [...(routesOf.get(row.parentId) ?? []), { id: row.osmId, tags }]);
  }
}
db.close();

const subtree = (id) => {   // 岩場自己加底下的子岩場（跟紅點貓原本讀 OSM 關係樹一樣，最多 400 個）
  const out = [], seen = new Set();
  for (let level = [id]; level.length && out.length < 400;) {
    const fresh = level.filter((x) => crags.has(x) && !seen.has(x));
    fresh.forEach((x) => seen.add(x));
    out.push(...fresh);
    level = fresh.flatMap((x) => kids.get(x) ?? []);
  }
  return out;
};
const linesOf = (route) => photosOf(route.tags).map((p) => ({ title: p.title, points: parsePath(p.path) })).filter((l) => l.points.length);

const todo = index.crags.slice(0, limit).map((entry) => ({ entry, units: subtree(entry.id) }));
const titles = new Set();
for (const { units } of todo) for (const u of units) for (const r of routesOf.get(u) ?? []) for (const l of linesOf(r)) titles.add(l.title);
console.error(`岩場 ${todo.length}、候選照片 ${titles.size} 張`);

// ── 驗證照片（有快取：ok／missing／unlicensed 不重查，unknown 重試） ──
const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {};
const save = () => fs.writeFileSync(cachePath, JSON.stringify(cache));
const pending = [...titles].filter((t) => !cache[t] || cache[t].s === 'unknown');
console.error(`要查 ${pending.length} 張（其餘用快取）`);

// 1) Commons：檔案在不在、授權；titles 可能被正規化或轉址，照回應的對照找回原標題
await mapLimit(chunk(pending, 40), 2, async (part) => {
  const q = new URLSearchParams({ action: 'query', format: 'json', prop: 'imageinfo', redirects: '1',
    iiprop: 'url|size|mime|extmetadata', iiurlwidth: String(COMMONS_REQUEST_WIDTH), titles: part.join('|') });
  const r = await attempt(async () => {
    const res = await fetch(`${COMMONS}?${q}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
    if (!res.ok) return transient(res.status) ? { retry: true, why: `Commons HTTP ${res.status}`, wait: retryAfter(res) } : { unknown: `Commons HTTP ${res.status}` };
    const json = await res.json();
    if (json.error) return { retry: true, why: `Commons ${json.error.code}` };
    return { json };
  });
  if (r.unknown) { for (const t of part) cache[t] = { s: 'unknown', why: r.unknown }; return; }
  const map = new Map();
  for (const n of r.json.query?.normalized ?? []) map.set(n.from, n.to);
  const redirect = new Map((r.json.query?.redirects ?? []).map((x) => [x.from, x.to]));
  const pages = new Map(Object.values(r.json.query?.pages ?? {}).map((p) => [p.title, p]));
  for (const t of part) {
    const first = map.get(t) ?? t;
    const page = pages.get(redirect.get(first) ?? first);
    const i = page?.imageinfo?.[0];
    if (!page || page.missing !== undefined || !i) { cache[t] = { s: 'missing', why: 'Commons 沒有這個檔案' }; continue; }
    const info = imageInfoOf(i);
    cache[t] = info ? { s: 'pre', info } : { s: 'unlicensed', why: i.extmetadata?.LicenseShortName?.value ?? '' };
  }
});

// 2) 照片網址真的讀得到（HEAD；不支援就讀前 1 KB）
const reading = [...titles].filter((t) => cache[t]?.s === 'pre');
let done = 0;
await mapLimit(reading, 6, async (t) => {
  const url = cache[t].info.url;
  const r = await attempt(async () => {
    let res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(45000) });
    if (res.status === 405 || res.status === 501) res = await fetch(url, { headers: { 'User-Agent': UA, Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(45000) });
    if (res.status === 404 || res.status === 410) return { missing: `照片網址 HTTP ${res.status}` };
    if (!res.ok && res.status !== 206) return transient(res.status) ? { retry: true, why: `照片 HTTP ${res.status}`, wait: retryAfter(res) } : { missing: `照片網址 HTTP ${res.status}` };
    const type = res.headers.get('content-type') ?? '';
    return /^image\//i.test(type) ? { ok: true } : { missing: `照片網址不是圖片（${type || '沒有 content-type'}）` };
  });
  cache[t] = r.ok ? { s: 'ok', info: cache[t].info } : r.missing ? { s: 'missing', why: r.missing } : { s: 'unknown', why: r.unknown };
  if (++done % 200 === 0) { save(); console.error(`  照片 ${done}／${reading.length}`); }
});
save();

// ── 寫每個岩場的檔案、更新索引 ──
const KEEP = /^(name|ref|description|length|climbing:length|climbing:(sport|trad|boulder|toprope|mixed|ice)|climbing:grade:[a-z_]+)$/;
const slim = (tags) => Object.fromEntries(Object.entries(tags).filter(([k]) => KEEP.test(k)));
const stats = { ok: 0, missing: 0, unlicensed: 0, unknown: 0 };
for (const t of titles) stats[cache[t]?.s ?? 'unknown']++;

const kept = [], dropped = [], pendingCrags = [];
fs.mkdirSync(OUT, { recursive: true });
const written = new Set();
for (const { entry, units } of todo) {
  const rootCrag = crags.get(entry.id);
  const outUnits = [], routeIds = new Set();
  let unknown = 0, photos = 0;
  for (const id of units) {
    const crag = crags.get(id);
    const byTitle = new Map();
    for (const route of routesOf.get(id) ?? []) {
      for (const l of linesOf(route)) {
        const c = cache[l.title];
        if (c?.s === 'ok') byTitle.set(l.title, [...(byTitle.get(l.title) ?? []), { node: { id: route.id, tags: slim(route.tags) }, points: l.points }]);
        else if (!c || c.s === 'unknown') unknown++;
      }
    }
    const views = [...byTitle].map(([title, lines]) => ({ title, info: cache[title].info, lines }));
    if (!views.length) continue;
    photos += views.length;
    for (const v of views) for (const l of v.lines) routeIds.add(l.node.id);
    outUnits.push({ rel: { id, version: null, tags: { name: crag.name, climbing: crag.tags.climbing } }, name: crag.name || `relation ${id}`, kind: crag.tags.climbing === 'area' ? 'area' : 'crag', views });
  }
  if (photos) {
    const file = path.join(OUT, String(entry.id), 'topo.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const data = { v: 1, root: { type: 'relation', id: entry.id, name: rootCrag?.name ?? entry.n ?? '', rel: { id: entry.id, version: null, tags: { ...(rootCrag?.tags.website ? { website: rootCrag.tags.website } : {}), name: rootCrag?.name ?? '' } } }, units: outUnits };
    fs.writeFileSync(file, JSON.stringify(data));
    written.add(String(entry.id));
    const tcu = theCragUrl(rootCrag?.tags['climbing:url:thecrag']);   // 外站連結也在建索引時查好，點小卡不再即時問 OSM
    const { tcu: _old, ...rest } = entry;
    kept.push({ ...rest, tc: routeIds.size, pc: photos, ...(tcu ? { tcu } : {}) });
    if (unknown) pendingCrags.push({ id: entry.id, name: entry.n, unknown, partial: true });
  } else if (unknown) pendingCrags.push({ id: entry.id, name: entry.n, unknown, partial: false });
  else dropped.push({ id: entry.id, name: entry.n });
}
const partial = limit !== Infinity;   // --limit 只是試跑：不動索引、不清舊檔
if (!partial) for (const f of fs.readdirSync(OUT)) if (/^\d+$/.test(f) && !written.has(f)) fs.rmSync(path.join(OUT, f, 'topo.json'), { force: true });

// 索引：驗證過才留；待補的岩場（暫時讀不到）這次先不放，下次補查後才進來
kept.sort((a, b) => b.tc - a.tc);
const byCountry = new Map();
for (const c of kept) {
  const k = c.cc ?? 'zz', v = byCountry.get(k) ?? { cc: k, crags: 0, topoRoutes: 0, routes: 0 };
  v.crags++; v.topoRoutes += c.tc; v.routes += c.rc || 0; byCountry.set(k, v);
}
const next = {
  ...index,
  verified: new Date().toISOString().slice(0, 10),
  countries: [...byCountry.values()].sort((a, b) => b.topoRoutes - a.topoRoutes),
  total: { crags: kept.length, topoRoutes: kept.reduce((s, c) => s + c.tc, 0) },
  crags: kept,
};
if (!partial) fs.writeFileSync(INDEX, JSON.stringify(next));

console.log(JSON.stringify({
  photos: stats,
  crags: { kept: kept.length, dropped: dropped.length, pending: pendingCrags.length },
  unknownReasons: Object.entries(Object.values(cache).filter((c) => c.s === 'unknown').reduce((m, c) => (m[c.why] = (m[c.why] ?? 0) + 1, m), {})),
  pending: pendingCrags.slice(0, 30),
  droppedSample: dropped.slice(0, 10),
}, null, 2));
if (stats.unknown) { console.error('有照片暫時讀不到（unknown）：再跑一次同樣的指令只會重試這些'); process.exitCode = 2; }
