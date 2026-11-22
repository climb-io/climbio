#!/usr/bin/env node
// 路線書轉換的命令列工具：AI 代理、腳本不用操作 Studio 畫面，就能把路線書轉成 Climbio 公開格式 v2，並拿到要人確認的問題清單。
// 跟 Climbio Studio 的「轉換路線書」用同一份程式（studio/crag/convert.js 讀檔、outline.js 轉換、report.js 問題清單）；
// 要讀照片像素的步驟（換原圖、描紅線）在無畫面的 Chromium 裡跑 Studio 本身，結果跟在 Studio 按「建立」一樣。
//
//   node tools/guidebook.mjs read <路線書…> --out <資料夾>      Word、PDF、網頁、ZIP、大綱 → 資料夾裡的 outline.md、圖檔、report.json
//   node tools/guidebook.mjs check <outline.md> [--json]        大綱 → 問題清單（圖檔照大綱所在的資料夾找）；有 error 結束碼是 1
//   node tools/guidebook.mjs build <outline.md> [原圖…] --out <資料夾> [--position 緯度,經度]
//                                                               建成一本：照片放進岩壁、換原圖、描紅線；輸出公開格式 v2 的包（index.json、各檔、照片）與 report.json
//   node tools/guidebook.mjs rerun <資料夾> --out <資料夾>     用原始檔重跑轉換：資料夾是發佈的 source/（或含 source/ 的包）；照 convert.json 選同樣的檔案、
//                                                               大綱換成 outline.md、填同樣的位置，再按建立（跟 build 一樣在無畫面的 Chromium 跑 Studio）
//   node tools/guidebook.mjs apply <包資料夾> <patch.json>      局部修正：只改點名的路線，其他 id 不變；改完重新驗證
//   node tools/guidebook.mjs validate <包資料夾> [--json]       每份 JSON 過格式驗證，加上轉換的底線（每條路線有線或記號、有岩場位置）
//   node tools/guidebook.mjs prompt                             給 AI 的提示（請 AI 把路線書整理成大綱）
//   node tools/guidebook.mjs fetch <岩場站網址> --out <資料夾>    任何岩場站的 v2 出口 → 資料夾裡的公開格式 v2 包（跟 Studio「匯入岩場站」收到的一樣，含照片）
//   node tools/guidebook.mjs publish <包資料夾> [--country 國碼] [--new-book] [--unlisted] [--position 緯度,經度] [--studio <網址>]
//                                                               發佈：這一版要有人核准（tools/studio.mjs 的「要不要公開發佈」人在 AI 對話裡答 ok，綁在這一版的內容上）。
//                                                               在無畫面的 Chromium 開主網的 Studio（帶同步金鑰代替 App Check），收進這本、按發佈，印出公開連結。
//                                                               --country：國家（大綱沒寫「國家：」時要給）。已經發佈過的書（同 id 或同名）接著發成它最新一版的下一版；
//                                                               一次刪很多的大改 Studio 會發成新的一本、名稱要不同。真的是另一本同名的岩場才加 --new-book（發成獨立的一本）。
//                                                               --position 填岩場位置（來源沒有位置時；由人提供，不推測）。要身分（gh 登入的 repo 協作者，或 CLIMBIO_STUDIO_KEY；服務網址可用 CLIMBIO_STUDIO_URL 改）
//
// patch.json：一個陣列，依序做（Studio 畫面上人能改的，這裡都改得到）：
//   { "op": "move", "routes": [id…], "to": 岩壁 id }                       路線換岩壁（接在最後）
//   { "op": "set", "id": 節點 id, "name": …, "parent": 上層 id 或 null, "props": { 欄位: 值或 null } }   改名稱、欄位、上層（岩壁移進區域、路線排順序用 props.order）
//   { "op": "add", "type": "route"|"wall"|"area", "name": …, "parent": 上層 id, "props": {…}, "id"?: 自己給 }   新增節點（印出新的 id）
//   { "op": "remove", "routes": [id…] } 或 { "op": "remove", "nodes": [id…] }   刪路線（連圖層的線與 bolt）；刪岩壁、區域（底下的移到上一層，岩壁上還有照片要先 photo 移走）
//   { "op": "photo", "photos": [照片 id…], "to": 岩壁 id }                    照片換岩壁
//   { "op": "shape", "node": 岩壁或區域 id, "geometry": GeoJSON 或 null }      地圖上的牆線（LineString，岩壁在左手邊、面朝右手邊）、岩石或區域（Polygon）；null 拿掉
//   { "op": "shape", "trail": true, "geometry": LineString }                  加一條步道
//   { "op": "line", "photo": 照片 id, "route": 路線 id, "points": [[x, y]…] 或 null, "bolts"?: [[x, y]…] }
//                                                                             路線在照片上的線（照片像素，由下往上）；有給 bolts 就換掉這條的 bolt（由下往上 B01…）；points 是 null 拿掉線和 bolt
//   { "op": "position", "lat": 緯度, "lng": 經度 }                            岩場位置
// 用法與流程見 docs/guidebook-convert-format.md 的「命令列」。
import './studio-i18n.mjs';   // Studio 的訊息走語言包（命令列用繁體中文）
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join, basename, relative, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import AppKit from '../appkit/index.mjs';
import { fromOutline, AI_PROMPT, parseCountry } from '../studio/crag/outline.js';
import { readBookFiles, assetKey, findAsset, BOOK_IMAGE, OUTLINE } from '../studio/crag/convert.js';
import { outlineReport, bookReport, reportLines } from '../studio/crag/report.js';
import { WALL_TYPES, exportDocs, tidyAttribution } from '../studio/crag/model.js';
import { crawl, fromV2 } from '../studio/crag/site.js';
import { spawnSync } from 'node:child_process';
import { SYNC_URL, studioAuth } from './studio-auth.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const { validate } = createRequire(import.meta.url)('../format/format.js');

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const has = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const fail = (msg, code = 2) => { console.error(msg); process.exit(code); };
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 1) + '\n');
const show = (rep, json) => {
  const { lines, ok } = reportLines(rep);
  console.log(json ? JSON.stringify(rep, null, 1) : lines.join('\n'));
  return ok;
};

/** 資料夾裡所有的檔案（相對路徑） */
const walk = (dir, base = dir) => readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p, base) : [relative(base, p).split(sep).join('/')]; });

/** 大綱所在的資料夾裡的圖：跟 Studio 一樣照路徑、檔名（不分大小寫）對到大綱的圖 */
function folderAssets(dir) {
  const assets = new Map();
  for (const rel of walk(dir).filter(f => BOOK_IMAGE.test(f))) {
    const k = assetKey(rel), file = join(dir, rel);
    assets.set(k, file);
    if (!assets.has(k.split('/').pop())) assets.set(k.split('/').pop(), file);
  }
  return assets;
}

/** 大綱 → { r（fromOutline 的結果）, rep（報告）, assets, used（大綱用到、找得到的圖：[src, 檔案]）} */
function checkOutline(file, position) {
  const dir = dirname(resolve(file)), assets = folderAssets(dir);
  const r = fromOutline(readFileSync(file, 'utf8'));
  const local = r.images.filter(i => !/^https:\/\//.test(i.src));
  const missing = local.filter(i => !i.overview && !findAsset(assets, i.src)).map(i => i.src);
  const used = local.map(i => [i.src, findAsset(assets, i.src)]).filter(([, f]) => f);
  return { r, rep: outlineReport(r, { missing, position }), used };
}

const parsePos = (s) => {
  const m = String(s || '').match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m || Math.abs(+m[1]) > 90 || Math.abs(+m[2]) > 180) fail(`位置要寫成「緯度,經度」：${s}`);
  return [Number(m[2]), Number(m[1])];
};

// ---- read：路線書 → outline.md 和圖 ----
async function read(files, out) {
  if (!files.length || !out) fail('用法：node tools/guidebook.mjs read <路線書…> --out <資料夾>');
  const list = files.map(f => new File([readFileSync(f)], basename(f)));
  const got = await readBookFiles(list);
  if (!got.text) fail(`讀不到路線書的文字：${files.join('、')}`, 1);
  mkdirSync(out, { recursive: true });
  const written = new Set();
  for (const [k, blob] of got.assets) {
    if (written.has(blob)) continue;   // 同一張圖另外用檔名當鍵：只寫完整路徑那份（先放進去的）
    written.add(blob);
    const p = join(out, k);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, Buffer.from(await blob.arrayBuffer()));
  }
  if (got.map) writeJson(join(out, 'map.geojson'), got.map);
  writeFileSync(join(out, 'outline.md'), got.text);
  for (const n of got.notes) console.log(`· ${n}`);
  const { rep } = checkOutline(join(out, 'outline.md'));
  writeJson(join(out, 'report.json'), rep);
  console.log(`寫好 ${join(out, 'outline.md')}（${written.size} 張圖${got.map ? '、map.geojson' : ''}）、report.json`);
  return show(rep, false);
}

// ---- build：在無畫面的 Chromium 跑 Studio 的轉換 ----
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.onnx': 'application/octet-stream', '.txt': 'text/plain' };

/** 這個 repo 的靜態伺服器（只給這次轉換用，結束就關） */
function serve() {
  const server = createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok(server)));
}

/** 路線 id → 大綱的位置：建書是在瀏覽器裡重新轉一次（id 不同），用「岩壁／路線名稱」對回來；同名的照順序 */
function outlinePlaces(r, book) {
  const key = (nodes, n) => `${nodes.get(n.parent)?.name ?? ''}\u0000${typeof n.name === 'string' ? n.name : JSON.stringify(n.name)}`;
  const src = new Map(r.state.book.nodes.map(n => [n.id, n])), dst = new Map(book.nodes.map(n => [n.id, n]));
  const queue = new Map();
  for (const n of r.state.book.nodes.filter(n => n.type === 'route')) { const k = key(src, n); if (!queue.has(k)) queue.set(k, []); queue.get(k).push(r.lines.get(n.id)); }
  const at = new Map();
  for (const n of book.nodes.filter(n => n.type === 'route')) { const q = queue.get(key(dst, n)); if (q?.length) at.set(n.id, q.shift()); }
  return at;
}

async function build(file, extras, out, position) {
  if (!file || !out) fail('用法：node tools/guidebook.mjs build <outline.md> [原圖…] --out <資料夾> [--position 緯度,經度]');
  const { r, rep: pre, used } = checkOutline(file, position && parsePos(position));
  const blocking = pre.issues.filter(i => i.level === 'error');
  if (blocking.length) { show(pre, false); fail('先修好上面的 error 再建立', 1); }
  const seen = new Set();
  const files = [[basename(file), resolve(file), 'text/markdown'], ...used.map(([, f]) => [basename(f), f]), ...extras.map(f => [basename(f), resolve(f)])]
    .filter(([name]) => !seen.has(name.toLowerCase()) && seen.add(name.toLowerCase()))
    .map(([name, f, mimeType]) => ({ name, mimeType: mimeType || MIME[extname(f).toLowerCase()] || 'application/octet-stream', buffer: readFileSync(f) }));
  return runStudio({ files, r, out, position });
}

// ---- rerun：用發佈的原始檔（source/）重跑轉換 ----
async function rerun(dir, out) {
  if (!dir || !out) fail('用法：node tools/guidebook.mjs rerun <source 資料夾或含 source/ 的包> --out <資料夾>');
  const src = existsSync(join(dir, 'source', 'convert.json')) ? join(dir, 'source') : dir;
  if (!existsSync(join(src, 'convert.json'))) fail(`${dir} 沒有 convert.json（轉換路線書發佈的岩場才有 source/）`);
  const rec = JSON.parse(readFileSync(join(src, 'convert.json'), 'utf8'));
  const at = (p) => join(src, basename(p));
  const missing = rec.files.map(f => f.path).filter(p => !existsSync(at(p)));
  if (missing.length) fail(`少了原始檔：${missing.join('、')}`, 1);
  // 沒有 outline.md（沒按過建立的原始檔）就用 Studio 讀檔讀到的大綱
  const text = rec.outline && existsSync(at(rec.outline)) ? readFileSync(at(rec.outline), 'utf8') : undefined;
  // 照原檔名選（Studio 的提示、新專案的 source/ 都跟第一次一樣）；檔案大，用路徑給
  const files = rec.files.map(f => ({ name: f.name, path: at(f.path) }));
  return runStudio({ files, text, out, position: rec.position || '' });
}

/** 在無畫面的 Chromium 開 Studio 的轉換：選檔（files：有 buffer 的直接給，有 path 的照 name 複製到暫存資料夾再選）、可換掉大綱（text）、填位置、按建立，匯出包與 report.json */
async function runStudio({ files: picked, text, r, out, position }) {
  const { chromium } = await import('playwright');
  const server = await serve(), browser = await chromium.launch(), tmp = mkdtempSync(join(tmpdir(), 'climbio-rerun-'));   // 選的檔案瀏覽器用到才讀，暫存檔留到最後
  try {
    const page = await (await browser.newContext({ locale: 'zh-TW', acceptDownloads: true, viewport: { width: 1280, height: 800 } })).newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/studio/crag/#convert`);
    // 用路徑選檔時檔名就是磁碟上的名字：原始檔照原檔名複製到暫存資料夾（大檔不能用 buffer 給）
    const files = picked.map(f => { if (!f.path) return f; const p = join(tmp, f.name); copyFileSync(f.path, p); return p; });
    await page.locator('#bkInput').setInputFiles(files);
    await page.waitForFunction(() => document.querySelector('#bookDlg').dataset.step === 'check');
    if (text !== undefined) { await page.locator('#bkAdv').evaluate(d => { d.open = true; }); await page.locator('#bkText').fill(text); await page.waitForTimeout(500); }
    if (position) await page.locator('#bkPos').fill(position);
    r ||= fromOutline(await page.locator('#bkText').inputValue());
    console.log(`· ${await page.locator('#bkSum').textContent()}`);
    await page.locator('#bkGo').click();
    await page.waitForFunction(() => document.querySelector('#bookDlg').dataset.step !== 'make', null, { timeout: 30 * 60_000 });
    if (await page.locator('#bookDlg').getAttribute('data-step') !== 'done') fail(`建立失敗：${await page.locator('.ak-toast').textContent().catch(() => '')}${errors.length ? `\n${errors.join('\n')}` : ''}`, 1);
    console.log(`· ${await page.locator('#bkDoneMsg').textContent()}`);
    // Studio 存的檔（還留著 author:stub，分得出真的線和記號）
    const docs = await page.evaluate(async () => {
      const dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Climbio Studio')).getDirectoryHandle(location.hash.slice(1).split('/')[0]);
      const all = [];
      for await (const [n, h] of dir.entries()) if (h.kind === 'file' && n.endsWith('.json')) all.push(JSON.parse(await (await h.getFile()).text()));
      return all;
    });
    const book = docs.find(d => d.kind === 'set'), inBook = (d) => book.items.some(i => i.id === d.id);
    const rep = bookReport({ book, layers: docs.filter(d => d.kind === 'layer' && inBook(d)), photos: docs.filter(d => d.surface === 'photo' && inBook(d)), map: docs.find(d => d.surface === 'map' && inBook(d)), at: outlinePlaces(r, book) });
    // 匯出：Studio 發佈頁的「匯出 ZIP」（每份都先過 validate）；按「發佈」到發佈頁時會一起打開發佈對話框，先關掉
    await page.locator('#bkPublish').click();
    await page.keyboard.press('Escape');
    const download = page.waitForEvent('download');
    await page.locator('#pubExport').click();
    const zip = readFileSync(await (await download).path());
    mkdirSync(out, { recursive: true });
    for (const e of await AppKit.files.unzip(new Blob([zip]))) {
      const p = join(out, e.name);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, Buffer.from(await e.blob.arrayBuffer()));
    }
    writeJson(join(out, 'report.json'), rep);
    console.log(`寫好 ${out}（index.json 與 ${book.items.length} 份畫面、圖層）、report.json`);
    return show(rep, false);
  } finally {
    await browser.close();
    server.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- 包：讀、驗證、局部修正 ----
const ENTRY = 'index.json';
function loadPack(dir) {
  if (!existsSync(join(dir, ENTRY))) fail(`${dir} 沒有 ${ENTRY}`);
  const book = JSON.parse(readFileSync(join(dir, ENTRY), 'utf8'));
  // 包裡的檔案是組合列出的那些（report.json、patch.json 這類旁邊的檔案不算）
  const paths = (book.items || []).map(i => i.href).filter(h => typeof h === 'string' && h.endsWith('.json'));
  const docs = new Map([[ENTRY, book], ...paths.map(p => { if (!existsSync(join(dir, p))) fail(`${dir} 少了 ${p}`, 1); return [p, JSON.parse(readFileSync(join(dir, p), 'utf8'))]; })]);
  return { docs, book };
}

function packReport(dir) {
  const { docs, book } = loadPack(dir);
  const problems = [...docs].flatMap(([path, doc]) => validate(doc).map(e => `${path} ${e}`));
  const old = existsSync(join(dir, 'report.json')) ? JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')) : null;
  const at = new Map((old?.routes || []).filter(r => r.at).map(r => [r.id, r.at]));
  const all = [...docs.values()];
  const rep = bookReport({ book, layers: all.filter(d => d.kind === 'layer'), photos: all.filter(d => d.surface === 'photo'), map: all.find(d => d.surface === 'map'), at });
  // 包裡的記號已經拿掉 author:stub：上一份報告說是記號、而且線還在原處的，照舊算記號
  const stubs = new Set((old?.routes || []).filter(r => r.reasons?.includes('stub')).map(r => r.id));
  for (const r of rep.routes) if (stubs.has(r.id) && !r.reasons.includes('no-topo')) { r.reasons.push('stub'); r.status = 'check'; }
  rep.issues.unshift(...problems.map(message => ({ level: 'error', code: 'invalid', message })));
  return { rep, docs, book };
}

function apply(dir, patchFile) {
  if (!dir || !patchFile) fail('用法：node tools/guidebook.mjs apply <包資料夾> <patch.json>');
  const { docs, book } = loadPack(dir);
  const patch = JSON.parse(readFileSync(patchFile, 'utf8'));
  if (!Array.isArray(patch)) fail('patch.json 要是一個陣列');
  const node = (id) => book.nodes.find(n => n.id === id) || fail(`找不到節點：${id}`);
  const route = (id) => { const n = node(id); if (n.type !== 'route') fail(`${id} 不是路線`); return n; };
  const wall = (id) => { const n = node(id); if (!WALL_TYPES.includes(n.type)) fail(`${id} 不是岩壁`); return n; };
  const pathOf = (id) => book.items.find(i => i.id === id)?.href;
  const docOf = (test, what) => [...docs].find(([, d]) => test(d)) || fail(`找不到${what}`);
  const map = () => docOf(d => d.surface === 'map', '地圖畫面');
  const photo = (id) => docOf(d => d.surface === 'photo' && d.id === id, `照片：${id}`);
  const changed = new Set([ENTRY]), added = [];
  const newId = () => AppKit.files.rid(16);
  // 上層不能是自己或自己底下的（不然樹斷掉）
  const underOf = (id, top) => { for (let n = book.nodes.find(x => x.id === id), g = 0; n && g < 100; n = book.nodes.find(x => x.id === n.parent), g++) if (n.id === top) return true; return false; };
  const dropRoutes = (gone) => {
    book.nodes = book.nodes.filter(n => !gone.has(n.id));
    for (const [path, doc] of docs) {
      if (doc.kind !== 'layer') continue;
      const drop = new Set((doc.nodes || []).filter(n => gone.has(n.parent)).map(n => n.id));
      const marks = (doc.marks || []).filter(m => !gone.has(m.node) && !drop.has(m.node));
      if (marks.length === (doc.marks || []).length && !drop.size) continue;
      doc.marks = marks;
      if (doc.nodes) doc.nodes = doc.nodes.filter(n => !drop.has(n.id));
      changed.add(path);
    }
  };
  for (const p of patch) {
    if (p.op === 'move') {
      wall(p.to);
      for (const id of p.routes) route(id).parent = p.to;
    } else if (p.op === 'set') {
      const n = node(p.id);
      if (p.name !== undefined) n.name = p.name;
      if (p.parent === null) delete n.parent;
      else if (p.parent !== undefined) { node(p.parent); if (underOf(p.parent, n.id)) fail(`${p.parent} 在 ${n.id} 底下，不能當它的上層`); n.parent = p.parent; }
      for (const [k, v] of Object.entries(p.props || {})) { n.props ||= {}; if (v === null) delete n.props[k]; else n.props[k] = v; }
    } else if (p.op === 'add') {
      if (!['route', 'wall', 'area'].includes(p.type)) fail(`add 的 type 只能是 route、wall、area：${JSON.stringify(p)}`);
      if (!p.name) fail(`add 要有名稱：${JSON.stringify(p)}`);
      if (p.parent) { const up = node(p.parent); if (p.type === 'route' ? !WALL_TYPES.includes(up.type) : up.type === 'route' || WALL_TYPES.includes(up.type)) fail(`${p.parent} 不能當${p.type}的上層`); }
      const id = p.id || newId();
      if (book.nodes.some(n => n.id === id)) fail(`id 已經有了：${id}`);
      book.nodes.push({ id, type: p.type, name: p.name, ...(p.parent ? { parent: p.parent } : {}), ...(p.props ? { props: p.props } : {}) });
      added.push(`${p.type} ${id} ${typeof p.name === 'string' ? p.name : JSON.stringify(p.name)}`);
    } else if (p.op === 'remove') {
      if (p.routes) dropRoutes(new Set(p.routes.map(id => route(id).id)));
      for (const id of p.nodes || []) {
        const n = node(id);
        if (n.type === 'route') { dropRoutes(new Set([id])); continue; }
        if (n.type === 'crag') fail('岩場節點不能刪');
        const photos = [...docs.values()].filter(d => d.surface === 'photo' && d.props?.node === id);
        if (photos.length) fail(`${id} 上還有 ${photos.length} 張照片：先用 photo 移到別面岩壁`);
        for (const c of book.nodes) if (c.parent === id) { if (n.parent) c.parent = n.parent; else delete c.parent; }
        book.nodes = book.nodes.filter(x => x.id !== id);
        const [mp, md] = map();
        if (md.marks.some(m => m.node === id)) { md.marks = md.marks.filter(m => m.node !== id); changed.add(mp); }
      }
    } else if (p.op === 'photo') {
      wall(p.to);
      for (const id of p.photos) { const [path, doc] = photo(id); doc.props = { ...doc.props, node: p.to }; changed.add(path); }
    } else if (p.op === 'shape') {
      const [mp, md] = map();
      if (p.trail) md.marks.push({ geometry: p.geometry, props: { kind: 'trail' } });
      else {
        const n = node(p.node);
        if (!WALL_TYPES.includes(n.type) && !['area', 'crag'].includes(n.type)) fail(`${p.node} 不是岩壁、區域`);
        md.marks = md.marks.filter(m => m.node !== p.node);
        if (p.geometry) md.marks.push({ node: p.node, geometry: p.geometry });
      }
      changed.add(mp);
    } else if (p.op === 'line') {
      const [, pic] = photo(p.photo), r = route(p.route);
      const inPhoto = (q) => Array.isArray(q) && q.length === 2 && q[0] >= 0 && q[1] >= 0 && q[0] <= pic.w && q[1] <= pic.h;
      for (const q of [...(p.points || []), ...(p.bolts || [])]) if (!inPhoto(q)) fail(`點不在照片裡（${pic.w}×${pic.h}）：${JSON.stringify(q)}`);
      if (p.points && p.points.length < 2) fail('線至少兩點');
      let entry = [...docs].find(([, d]) => d.kind === 'layer' && d.on === p.photo);
      if (!entry) {
        if (!p.points) continue;
        const id = newId(), layer = { climbio: 2, kind: 'layer', id, on: p.photo, t: Date.now(), license: book.license, attribution: book.attribution || '', nodes: [], marks: [] };
        const at = book.items.findIndex(i => i.id === p.photo);
        book.items.splice(at + 1, 0, { href: `${id}.json`, id });
        entry = [`${id}.json`, layer];
        docs.set(...entry);
      }
      const [lp, layer] = entry;
      layer.nodes ||= []; layer.marks ||= [];
      const mine = (layer.nodes || []).filter(x => x.parent === r.id).map(x => x.id);
      const dropBolts = !p.points || p.bolts;
      layer.marks = layer.marks.filter(m => m.node !== r.id && !(dropBolts && mine.includes(m.node)));
      if (dropBolts) layer.nodes = layer.nodes.filter(x => !mine.includes(x.id));
      if (p.points) {
        // 線上的號碼：這條在岩壁裡的順序（Studio 預設的「每面岩壁從 1 開始」）
        const sibs = book.nodes.filter(x => x.type === 'route' && x.parent === r.parent);
        layer.marks.push({ node: r.id, geometry: { type: 'LineString', coordinates: p.points }, props: { label: String(sibs.indexOf(r) + 1) } });
        (p.bolts || []).forEach((q, i) => {
          const b = { id: newId(), type: 'bolt', name: `B${String(i + 1).padStart(2, '0')}`, parent: r.id };
          layer.nodes.push(b);
          layer.marks.push({ node: b.id, geometry: { type: 'Point', coordinates: q } });
        });
      }
      changed.add(lp);
    } else if (p.op === 'position') {
      const crag = book.nodes.find(n => n.type === 'crag') || fail('這本沒有岩場節點');
      crag.geo = { type: 'Point', coordinates: parsePos(`${p.lat},${p.lng}`) };
    } else fail(`不認得的操作：${JSON.stringify(p)}`);
  }
  const problems = [...changed].flatMap(path => validate(docs.get(path)).map(e => `${path} ${e}`));
  if (problems.length) fail(`改完不合格式，沒有寫入：\n${problems.join('\n')}`, 1);
  for (const path of changed) writeJson(join(dir, path), docs.get(path));
  const { rep } = packReport(dir);
  writeJson(join(dir, 'report.json'), rep);
  console.log(`改了 ${[...changed].join('、')}`);
  for (const line of added) console.log(`新增 ${line}`);
  return show(rep, false);
}

// ---- fetch：岩場站的 v2 出口 → 資料夾裡的包（跟 Studio「匯入岩場站」同一份程式：site.js 的 crawl、fromV2） ----
async function fetchSite(url, outDir) {
  if (!url || !outDir) fail('用法：node tools/guidebook.mjs fetch <岩場站網址> --out <資料夾>');
  const getJson = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`${u}：HTTP ${r.status}`); return r.json(); };
  let src;
  try { src = await crawl(url, getJson); } catch (e) { fail(`讀不到岩場站：${e.message}`, 1); }
  const { state, images } = fromV2(src);
  mkdirSync(outDir, { recursive: true });
  const docs = exportDocs(state);
  for (const { path, doc } of docs) writeJson(join(outDir, path), doc);
  const hrefOf = new Map(docs.filter(d => d.doc.surface === 'photo').map(d => [d.doc.id, d.doc.href]));
  let n = 0;
  for (const img of images) {
    const href = hrefOf.get(img.id);
    if (!href) continue;
    const r = await fetch(img.url);
    if (!r.ok) fail(`下載照片失敗：${img.url}：HTTP ${r.status}`, 1);
    writeFileSync(join(outDir, href), Buffer.from(await r.arrayBuffer()));
    n++;
  }
  const { rep } = packReport(outDir);
  writeJson(join(outDir, 'report.json'), rep);
  console.log(`收好 ${outDir}：${docs.length} 份 JSON、${n} 張照片（${state.book.name ? (typeof state.book.name === 'string' ? state.book.name : Object.values(state.book.name)[0]) : ''}）`);
  return show(rep, false);
}

// ---- publish：在無畫面的 Chromium 用主網的 Studio 發佈（照片合成預覽圖要畫布，Node 做不到） ----
/** 包的國家：--country，沒給就讀原始檔的大綱（source/outline.md 岩場底下的「國家：」）；都沒有回 '' */
function countryOf(dir, given) {
  if (given) return parseCountry(given) || fail(`--country 要是兩個字母的國碼（例如 tw）：${given}`);
  const md = join(dir, 'source', OUTLINE);
  const line = existsSync(md) && readFileSync(md, 'utf8').split(/\r?\n/).find(l => /^\s*(國家|國別|country|cc)\s*[：:]/i.test(l));
  return line ? parseCountry(line.split(/[：:]/).slice(1).join(':')) : '';
}
const VERSIONS_URL = 'https://asia-east1-firebase-climbio.cloudfunctions.net/datasets';
/** 同一本書所有的版本（含不列入世界的）：雲端函式 datasets 的 versions（公開唯讀）；回跟公開清單同樣的列，讀不到是 [] */
async function versionsOf(id) {
  const r = await fetch(VERSIONS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'versions', id }), signal: AbortSignal.timeout(30_000) }).catch(() => null);
  return (r?.ok && (await r.json().catch(() => ({}))).rows) || [];
}
const PROJECTS_URL = 'https://firebasestorage.googleapis.com/v0/b/firebase-climbio.appspot.com/o/public%2Fprojects.json?alt=media';
const WORLD_URL = 'https://firebasestorage.googleapis.com/v0/b/firebase-climbio.appspot.com/o/public%2Fworld.json?alt=media';
/** 發佈後確認紅點貓的世界：公開清單（projects.json）有這一版、國家對，世界的樹（world.json）把它放在那個國家底下；伺服器發佈時就重寫，等最多 3 分鐘 */
async function checkWorld(id, cc) {
  for (let i = 0; i < 36; i++) {
    const rows = (await fetch(PROJECTS_URL, { cache: 'no-store' }).then(r => r.json()).catch(() => ({}))).projects || [];
    const row = rows.find(p => p.id === id || (p.others || []).some(o => o.id === id));
    if (row) {
      if (row.cc !== cc) return `公開清單的國家是「${row.cc || '沒有'}」，不是 ${cc}`;
      const w = await fetch(WORLD_URL, { cache: 'no-store' }).then(r => r.json()).catch(() => null);
      const node = w?.tree?.find(n => n.cc === cc), idx = w?.books?.findIndex(b => b.id === row.id);
      const items = node ? [...(node.items || []), ...(node.regions || []).flatMap(r => r.items || [])] : [];
      if (node && items.includes(idx)) return '';
      if (i > 30) return `世界的樹（world.json）在「${cc}」底下找不到這本`;
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  return '公開清單 3 分鐘內沒有出現這一版';
}

/** 這本在公開清單上是不是已經有了：同一本書（id、root、匯入來源）或同名 → { row, how }；沒有回 null */
async function publishedAlready(book) {
  const rows = ((await fetch(PROJECTS_URL, { cache: 'no-store' }).then(r => r.json()).catch(() => ({}))).projects || []).filter(p => p.type === 'guidebook');
  const ids = [book.id, book.props?.root, /\/(?:p|crags)\/([0-9a-z]{16})\//.exec(book.derivedFrom?.url || '')?.[1]].filter(Boolean);
  const same = rows.find(p => [p.id, p.root, ...(p.others || []).map(o => o.id)].some(id => ids.includes(id)));
  if (same) return { row: same, how: '同一本' };
  for (const id of new Set(ids)) { const [row] = await versionsOf(id); if (row) return { row, how: '同一本（不列入世界）' }; }   // 不列入世界的書不在公開清單上
  const named = rows.find(p => p.name === book.name);
  return named ? { row: named, how: '同名' } : null;
}
async function publish(dir, studio = 'https://climbio.app', position = '', given = '', { newBook = false, unlisted = false } = {}) {
  if (!dir) fail('用法：node tools/guidebook.mjs publish <包資料夾> [--country 國碼] [--unlisted] [--position 緯度,經度] [--studio <網址>]（岩場站先用 fetch 收成資料夾）');
  if (position) parsePos(position);   // 格式不對就停
  // 國家：紅點貓世界的第一層，沒有會被放到最後的「其他」。包裡沒有（Studio 的設定匯出時拿掉），要 --country 或大綱的「國家：」；由來源或人提供，不推測
  const country = countryOf(dir, given);
  if (!country) fail('要國家：加 --country 國碼（例如 tw），或在大綱的岩場底下寫「國家：tw」。國家由原始資料或使用者提供，不推測', 1);
  // 新版還是新書：已經發佈過的（同一本或同名）接在它最新的一版後面發成下一版，世界裡才不會多出一本同名的；--new-book 發成獨立的一本
  const book = JSON.parse(readFileSync(join(dir, ENTRY), 'utf8'));
  const already = newBook ? null : await publishedAlready(book);
  let adopt = null;
  if (already) {
    const group = already.row, head = [group, ...(group.others || [])].sort((a, b) => b.t - a.t)[0];
    adopt = { project: head.id, root: group.root || group.id };
    console.log(`· 更新「${group.name}」（${already.how}）：接在最新的一版 ${head.id} 後面`);
  }
  // 要有人核准這一版（只能由人答；不是代理自己填的名字）
  const check = spawnSync(process.execPath, [join(ROOT, 'tools', 'studio.mjs'), 'approved', dir], { encoding: 'utf8' });
  let ok = null;
  try { ok = JSON.parse(check.stdout.trim().split(/\r?\n/).at(-1)); } catch { /* 下面說原因 */ }
  if (!ok?.ok) fail(`這一版還沒有人核准發佈：node tools/studio.mjs status ${dir} 看題目，把「要不要公開發佈」拿給使用者看（ask --human），他在對話裡答發佈才記 ok（answer … ok --by human:<名稱> --said "<原話>"；內容改了要重新核准）${check.stderr ? ` ${check.stderr}` : ''}`, 1);
  const { key } = studioAuth(), url = SYNC_URL;
  if (!key) fail('要身分：gh auth login（repo 的協作者）或環境變數 CLIMBIO_STUDIO_KEY（發佈函式認它代替 App Check）。無畫面的 Studio 要拿到身分本身，只有 Network secret 的雲端環境發佈不了岩場，在本機發佈');
  // 包的檔案（第一層）和原始檔（source/）包成一個 ZIP 給 Studio 首頁（原生包照路徑收，source/ 跟著進專案）；大，寫成暫存檔用路徑選
  const names = readdirSync(dir).filter(n => statSync(join(dir, n)).isFile() && n !== 'report.json' && !n.startsWith('.'));
  if (!names.includes(ENTRY)) fail(`${dir} 沒有 ${ENTRY}`);
  const srcDir = join(dir, 'source'), srcNames = existsSync(srcDir) ? readdirSync(srcDir).filter(n => statSync(join(srcDir, n)).isFile()) : [];
  const entries = [...names.map(n => ({ name: n, blob: new Blob([readFileSync(join(dir, n))]) })), ...srcNames.map(n => ({ name: `source/${n}`, blob: new Blob([readFileSync(join(srcDir, n))]) }))];
  const tmp = mkdtempSync(join(tmpdir(), 'climbio-publish-')), zipPath = join(tmp, 'pack.zip');
  writeFileSync(zipPath, Buffer.from(await (await AppKit.files.zip(entries)).arrayBuffer()));
  if (srcNames.length) console.log(`· 原始檔 ${srcNames.length} 個（source/）`);
  const approved = ok.by;
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ locale: 'zh-TW', viewport: { width: 1280, height: 800 } });
    // Studio 接了同步服務時發佈會帶這個身分（studio/backend.js 的 studioKey）
    await context.addInitScript(([u, k]) => { localStorage.setItem('climbio.studio.remote', JSON.stringify({ url: u, key: k })); }, [url, key]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const why = async () => `${await page.locator('.ak-toast').last().textContent().catch(() => '')}${errors.length ? `\n${errors.join('\n')}` : ''}`;
    await page.goto(`${studio}/studio/?app`);
    if (adopt) await page.evaluate((p) => sessionStorage.setItem('climbio.studio.adopt', JSON.stringify(p)), adopt);   // Studio 打開這本時接在那一版後面（crag/app.js 的 applyAdopt）
    await page.locator('#addInput').setInputFiles(zipPath);   // 加資料：原生的包直接收成一本
    await page.waitForFunction(() => /^#[0-9a-z]{16}$/.test(location.hash) && document.querySelector('#bookName')?.value, null, { timeout: 30 * 60_000 }).catch(() => null);
    if (!/^#[0-9a-z]{16}$/.test(new URL(page.url()).hash)) fail(`收不進來：${await why()}`, 1);
    console.log(`· 收進來了：${await page.locator('#bookName').inputValue()}`);
    if (position) {   // 岩場位置：區域圖清單最上面那欄（只有有岩場節點的書才有）
      await page.locator('#steps button', { hasText: '區域圖' }).click();
      const field = page.locator('#areas .crag-pos input');
      if (!(await field.count())) fail('這本沒有岩場節點，填不了岩場位置', 1);
      await field.fill(position);
      await field.press('Enter');
      await field.blur();
      console.log(`· 岩場位置：${position}`);
    }
    // 國家：岩場資訊的選單（匯入的包沒有，每次發佈都要設）
    await page.locator('#steps button', { hasText: '岩場資訊' }).click();
    await page.locator('#setCountry').selectOption(country);
    await page.locator('#setCountry').blur();
    console.log(`· 國家：${country}`);
    await page.locator('#steps button', { hasText: '發佈' }).click();
    await page.locator('#pubOpen').click();
    // 不列入世界（--unlisted）：發佈對話框的勾選；沒給就照這本原本的（上一版不列入的照舊不列入）
    if (unlisted && !(await page.locator('#pubUnlisted').isChecked())) { await page.locator('#pubUnlisted').check(); console.log('· 不列入世界'); }
    // 等發佈鈕可以按（檢查完服務、沒有擋下的照片、有位置）；等不到就照訊息說原因（發佈過的本來就有「目前是第 N 版」，不能拿訊息當檢查完）
    await page.waitForFunction(() => { const g = document.querySelector('#pubGo'); return g && (g.hidden || !g.disabled); }, null, { timeout: 60_000 }).catch(() => {});
    if (await page.locator('#pubGo').isHidden() || await page.locator('#pubGo').isDisabled()) fail(`不能發佈：${await page.locator('#pubMsg').textContent()}${await page.locator('#pubBlocked').isVisible() ? `\n擋下的照片：${(await page.locator('#pubBlocked li').allTextContents()).join('、')}` : ''}`, 1);
    await page.locator('#pubGo').click();
    await page.waitForFunction(() => /\/p\/[0-9a-z]{16}/.test(document.querySelector('#pubLink a')?.href || '') || /失敗|failed/i.test(document.querySelector('#pubMsg')?.textContent || ''), null, { timeout: 60 * 60_000 });
    const link = await page.locator('#pubLink a').getAttribute('href').catch(() => '');
    if (!/\/p\/[0-9a-z]{16}/.test(link || '')) fail(`發佈失敗：${await page.locator('#pubMsg').textContent()}${await why()}`, 1);
    console.log(`發佈了：${link}；核准的人 ${approved}（${ok.at}）`);
    // 確認紅點貓的世界：這一版在公開清單上、國家對、世界的樹把它放在那個國家底下
    const id = /\/p\/([0-9a-z]{16})/.exec(link)[1];
    if (await page.locator('#pubUnlisted').isChecked()) {   // 不列入世界：不在公開清單上，改確認伺服器的版本查詢有這一版
      const [row] = await versionsOf(id), ids = row ? [row.id, ...(row.others || []).map(o => o.id)] : [];
      if (!ids.includes(id)) fail('發佈了，但版本查詢（versions）找不到這一版', 1);
      console.log(`不列入世界：世界清單沒有它，拿到連結的人打得開；編輯連結 ${studio}/studio/crag/#edit=${row.root || id}`);
      return true;
    }
    const bad = await checkWorld(id, country);
    if (bad) fail(`發佈了，但世界清單不對：${bad}`, 1);
    console.log(`世界清單：已在「${country}」底下`);
    return true;
  } finally { await browser.close(); rmSync(tmp, { recursive: true, force: true }); }
}

// ---- 指令 ----
const cmd = args.shift();
const json = has('--json'), out = flag('--out'), position = flag('--position'), studioUrl = flag('--studio'), countryFlag = flag('--country');
const newBookFlag = has('--new-book'), unlistedFlag = has('--unlisted');
let ok = true;
if (cmd === 'prompt') console.log(AI_PROMPT);
else if (cmd === 'read') ok = await read(args, out);
else if (cmd === 'check') {
  if (!args[0]) fail('用法：node tools/guidebook.mjs check <outline.md> [--json]');
  ok = show(checkOutline(args[0], position && parsePos(position)).rep, json);
} else if (cmd === 'build') ok = await build(args[0], args.slice(1), out, position);
else if (cmd === 'rerun') ok = await rerun(args[0], out);
else if (cmd === 'apply') ok = apply(args[0], args[1]);
else if (cmd === 'publish') ok = await publish(args[0], studioUrl || undefined, position, countryFlag, { newBook: newBookFlag, unlisted: unlistedFlag });
else if (cmd === 'fetch') ok = await fetchSite(args[0], out);
else if (cmd === 'validate') {
  if (!args[0]) fail('用法：node tools/guidebook.mjs validate <包資料夾> [--json]');
  ok = show(packReport(args[0]).rep, json);
} else fail('用法：node tools/guidebook.mjs read|check|build|rerun|apply|validate|fetch|publish|prompt …（說明在檔案開頭）');
process.exit(ok ? 0 : 1);
