#!/usr/bin/env node
// 路線書轉換的命令列工具：AI 代理、腳本不用操作 Studio 畫面，就能把路線書轉成 Climbio 公開格式 v2，並拿到要人確認的問題清單。
// 跟 Climbio Studio 的「轉換路線書」用同一份程式（studio/crag/convert.js 讀檔、outline.js 轉換、report.js 問題清單）；
// 要讀照片像素的步驟（換原圖、描紅線）在無畫面的 Chromium 裡跑 Studio 本身，結果跟在 Studio 按「建立」一樣。
//
//   node tools/guidebook.mjs read <路線書…> --out <資料夾>      Word、PDF、網頁、ZIP、大綱 → 資料夾裡的 outline.md、圖檔、report.json
//   node tools/guidebook.mjs check <outline.md> [--json]        大綱 → 問題清單（圖檔照大綱所在的資料夾找）；有 error 結束碼是 1
//   node tools/guidebook.mjs build <outline.md> [原圖…] --out <資料夾> [--position 緯度,經度]
//                                                               建成一本：照片放進岩壁、換原圖、描紅線；輸出公開格式 v2 的包（index.json、各檔、照片）與 report.json
//   node tools/guidebook.mjs apply <包資料夾> <patch.json>      局部修正：只改點名的路線，其他 id 不變；改完重新驗證
//   node tools/guidebook.mjs validate <包資料夾> [--json]       每份 JSON 過格式驗證，加上轉換的底線（每條路線有線或記號、有岩場位置）
//   node tools/guidebook.mjs prompt                             給 AI 的提示（請 AI 把路線書整理成大綱）
//
// patch.json：[{ "op": "move", "routes": [id…], "to": 岩壁 id }, { "op": "set", "id": 節點 id, "name": …, "props": { 欄位: 值或 null } },
//              { "op": "remove", "routes": [id…] }, { "op": "position", "lat": 緯度, "lng": 經度 }]
// 用法與流程見 docs/guidebook-convert-format.md 的「命令列」。
import './studio-i18n.mjs';   // Studio 的訊息走語言包（命令列用繁體中文）
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve, join, basename, relative, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import AppKit from '../appkit/index.mjs';
import { fromOutline, AI_PROMPT } from '../studio/crag/outline.js';
import { readBookFiles, assetKey, findAsset, BOOK_IMAGE } from '../studio/crag/convert.js';
import { outlineReport, bookReport, reportLines } from '../studio/crag/report.js';
import { WALL_TYPES } from '../studio/crag/model.js';

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
  const { chromium } = await import('playwright');
  const server = await serve(), browser = await chromium.launch();
  try {
    const page = await (await browser.newContext({ locale: 'zh-TW', acceptDownloads: true, viewport: { width: 1280, height: 800 } })).newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/studio/crag/#book`);
    const seen = new Set();
    const files = [[basename(file), resolve(file), 'text/markdown'], ...used.map(([, f]) => [basename(f), f]), ...extras.map(f => [basename(f), resolve(f)])]
      .filter(([name]) => !seen.has(name.toLowerCase()) && seen.add(name.toLowerCase()))
      .map(([name, f, mimeType]) => ({ name, mimeType: mimeType || MIME[extname(f).toLowerCase()] || 'application/octet-stream', buffer: readFileSync(f) }));
    await page.locator('#bkInput').setInputFiles(files);
    await page.waitForFunction(() => document.querySelector('#bookDlg').dataset.step === 'check');
    if (position) await page.locator('#bkPos').fill(position);
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
    const rep = bookReport({ book, layers: docs.filter(d => d.kind === 'layer' && inBook(d)), photos: docs.filter(d => d.surface === 'photo' && inBook(d)), at: outlinePlaces(r, book) });
    // 匯出：Studio 發佈對話框的「匯出 ZIP」（每份都先過 validate）
    await page.locator('#bkPublish').click();
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
  const rep = bookReport({ book, layers: all.filter(d => d.kind === 'layer'), photos: all.filter(d => d.surface === 'photo'), at });
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
  const changed = new Set([ENTRY]);
  for (const p of patch) {
    if (p.op === 'move') {
      const wall = node(p.to);
      if (!WALL_TYPES.includes(wall.type)) fail(`${p.to} 不是岩壁`);
      for (const id of p.routes) route(id).parent = p.to;
    } else if (p.op === 'set') {
      const n = node(p.id);
      if (p.name !== undefined) n.name = p.name;
      for (const [k, v] of Object.entries(p.props || {})) { n.props ||= {}; if (v === null) delete n.props[k]; else n.props[k] = v; }
    } else if (p.op === 'remove') {
      const gone = new Set(p.routes.map(id => route(id).id));
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
  return show(rep, false);
}

// ---- 指令 ----
const cmd = args.shift();
const json = has('--json'), out = flag('--out'), position = flag('--position');
let ok = true;
if (cmd === 'prompt') console.log(AI_PROMPT);
else if (cmd === 'read') ok = await read(args, out);
else if (cmd === 'check') {
  if (!args[0]) fail('用法：node tools/guidebook.mjs check <outline.md> [--json]');
  ok = show(checkOutline(args[0], position && parsePos(position)).rep, json);
} else if (cmd === 'build') ok = await build(args[0], args.slice(1), out, position);
else if (cmd === 'apply') ok = apply(args[0], args[1]);
else if (cmd === 'validate') {
  if (!args[0]) fail('用法：node tools/guidebook.mjs validate <包資料夾> [--json]');
  ok = show(packReport(args[0]).rep, json);
} else fail('用法：node tools/guidebook.mjs read|check|build|apply|validate|prompt …（說明在檔案開頭）');
process.exit(ok ? 0 : 1);
