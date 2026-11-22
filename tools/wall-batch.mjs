#!/usr/bin/env node
// 多面牆一次做完（給 AI 代理）：照片 → Studio Wall 偵測 → SAM2 精修 → 牆的分享包 → AI 檢查 → 一次整理成要人判斷的清單。
// 全程不問人、不停：單面牆失敗會重試，重試還不行就記下來做下一面；人只在最後看一份清單（手機打開網頁，回一段字）。
// 流程規定見 docs/studio-wall.md「代理做牆面：岩點檔的必走流程」。
//
//   node tools/wall-batch.mjs run <工作資料夾> <照片…> [--public]   每面牆：偵測 → SAM2 → 匯出 ZIP 與牆的分享包（resume：做完的牆跳過；失敗的牆重試）。
//                                                             **預設是私有牆**（岩館、客戶的牆面資料不上公開資料集、不進公開 repo）：不會出「要不要公開發佈」；使用者明說這面牆要公開才加 --public
//   node tools/wall-batch.mjs check <工作資料夾>              分級檢查：先自動處理（見 POLICY），再出要 AI 看圖的題目和對照圖（sheets/、sam-sheets/、audit/、overview/）
//   node tools/wall-batch.mjs apply <工作資料夾> <判斷.json>   依代理的判斷修岩點並答題；判斷.json：{ "<牆>": ["ok"|"rm1"|"rm2"|"merge"|"unsure", …]（重複岩點，照 questions.json 的順序）,
//                                                             "<牆>#sam": ["sam"|"keep"|"delete"|"unsure", …]（SAM2 要看的，照 sam-questions.json 的順序）,
//                                                             "<牆>#recheck": ["sam|keep|delete 或 ok|rm1|rm2|merge", …]（放大再看一次，照 recheck.json 的順序，不能再答 unsure）, "<牆>#audit": ["ok"|"bad", …]（抽查，照 audit.json 的順序）, "<牆>#overview": ["ok" 或 看到的系統性問題]}
//   node tools/wall-batch.mjs review <工作資料夾>             整理要人判斷的清單：review/index.html（單檔、手機看）和 review.json；印出總結
//   node tools/wall-batch.mjs resolve <工作資料夾> <牆>:<題 id 或 sam:<岩點 id>> <ok|rm1|rm2|merge|keep|sam> --by human:<名稱> --said "<人的原話>"
//                                                             記下人的判斷（會先照判斷改岩點）；<牆>:publish 是「要不要公開發佈」，答 ok 才記，這個指令不發佈
//   node tools/wall-batch.mjs status <工作資料夾>             每面牆做到哪
//
// 檢查分級（POLICY）：程式自己處理的（SAM2 沒旗標、重複岩點 IoU ≥ 0.70）→ 隨機抽查 → AI 看圖的（SAM2 候選對不上／分數低、其餘重複岩點）→ 只剩 AI 看不準的給人。
//   node tools/wall-batch.mjs next <工作資料夾>               **不知道下一步做什麼就跑這個**：印出現在做到哪、下一步要跑的指令、要看的圖在哪、判斷檔怎麼寫
//   node tools/wall-batch.mjs recheck <工作資料夾>             看不準（unsure）的再看一次：放大、多帶周圍（含整顆 volume）重新出圖，**這一輪不能再答 unsure，要定案**
// **「看不準」不是交給人的出口**：岩點辨識人眼看得出來的，AI 也要看得出來；看不準先放大再看一次（recheck），定案後才算完成。人只負責「要不要公開發佈」。
// 判斷代號：重複岩點 ok＝兩顆是不同的岩點、不用改；rm1／rm2＝拿掉第一顆／第二顆外框；merge＝兩顆是同一顆的兩半，合成一顆（取凸包）；unsure＝看不準，交給人。
// SAM2 要看的：sam＝採用 SAM2 外框、keep＝保留原外框（HoldKit）、delete＝不是岩點／重複／碎片（拿掉）、unsure＝看不準，交給人。**這是本來要人一顆顆檢查的項目，改由代理看圖判斷，不是不檢查。**
// 抽查：ok＝自動處理的對、bad＝錯了（程式還原）。全牆總覽 overview：看有沒有系統性的錯誤（照明燈、貼牆長條外框偏鬆），沒有回 ok。
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname, basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'), require = createRequire(import.meta.url);

/** 哪些程式自己處理、哪些給 AI 看圖、哪些給人：全部寫在這裡，不要讓每個代理自己決定。數字的依據見 docs/studio-wall.md「分級」。 */
const POLICY = {
  samReviewFlags: ['候選對不上', '分數低'],   // SAM2 重描後只有這兩種旗標要 AI 看圖（約 5～7% 的岩點）；其餘（沒旗標、偵測信心低、邊緣不確定）直接採用 SAM2 外框
  dupAutoIou: 0.70,                           // 兩個外框重疊（IoU）到這個值以上就是同一顆：程式自動拿掉比較小的那顆，不問 AI
  auditSam: 12, auditDup: 6,                  // 自動處理的結果，隨機抽幾個給 AI 複查（自動不等於不檢查）；複查有錯的會還原
  audit: { seed: 20261121 },
};
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => { const i = rest.indexOf(name); if (i < 0) return ''; const v = rest[i + 1] || ''; rest.splice(i, 2); return v; };
const fail = (m) => { console.error(m); process.exit(2); };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream' };
const readJson = (f, d = null) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, o) => writeFileSync(f, JSON.stringify(o, null, 1));
const wallsOf = (work) => readdirSync(work).filter(n => existsSync(join(work, n, 'run.json'))).sort();
const chromiumOf = () => { try { return require('playwright').chromium; } catch { fail('要先裝 playwright（npm i）和 Chromium（npx playwright install chromium）'); } };
const tool = (name, ...a) => spawnSync(process.execPath, ['--no-warnings', join(ROOT, 'tools', name), ...a], { encoding: 'utf8', env: { ...process.env, CLIMBIO_AGENT: process.env.CLIMBIO_AGENT || 'agent:claude' }, maxBuffer: 64 << 20 });

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

// ---------- run ----------
/** 一面牆跑一次：偵測 → SAM2（失敗不算整面失敗，記下來）→ 匯出 ZIP 與牆的分享包。回傳摘要；拋錯＝這次整面失敗要重試 */
async function runOne(chromium, base, photo, dir, { sam = true, samCapMs }) {
  const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu'] });
  try {
    const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    await page.addInitScript(() => localStorage.setItem('climbio.installDismissedAt', String(Date.now())));
    await page.goto(`${base}/studio/wall/`);
    await page.waitForSelector('#addFiles', { state: 'attached' });
    await page.setInputFiles('#addFiles', photo);
    await page.waitForFunction(() => /#[^/]+\/[^/]+/.test(location.hash), null, { timeout: 5 * 60_000 });
    await page.waitForTimeout(1500);
    const stat = () => page.evaluate(() => { const w = P.walls[0]; return { id: w.id, holds: w.n, toLook: w.look, w: w.w, h: w.h }; });
    const out = { detected: await stat(), sam: 'skipped' };
    if (sam) {
      try {
        await page.evaluate(() => { window.__done = false; window.__err = null; refineWall(P.walls[0]).then(() => { window.__done = true; }, (e) => { window.__err = String((e && e.stack) || e); window.__done = true; }); });
        const ok = page.locator('.ak-dialog button').last();
        await ok.waitFor({ timeout: 60_000 }); await ok.click();
        await page.waitForFunction(() => window.__done, null, { timeout: samCapMs, polling: 2000 });
        const err = await page.evaluate(() => window.__err);
        out.sam = err ? `failed: ${err.slice(0, 200)}` : 'done';
      } catch (e) { out.sam = `failed: ${e.message.slice(0, 200)}`; }
      if (out.sam !== 'done') throw new Error(`SAM2 ${out.sam}`);   // SAM2 沒跑完就整面重來（偶發的檔案系統錯誤，重來通常就過）
    }
    await page.evaluate(() => P.flush());
    out.final = await stat();
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.evaluate(() => exportWall(P.walls[0]))]);
    await dl.saveAs(join(dir, 'export.zip'));
    // 牆的分享包（studio.mjs status／ask、wall.mjs 吃的格式）
    const pack = await page.evaluate(async () => {
      await shareLibs();
      const w = P.walls[0], d = await P.data(w.id), hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => (b % 16).toString(16)).join('');
      const thumb = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; P.thumb(w).then(b => r.readAsDataURL(b), rej); });
      const fs = await ShareTools.wallPackage({ id: hex(16), layerId: hex(16), pid: hex(16), name: w.name, gym: '', w: w.w, h: w.h, thumb, holds: d.holds, routes: [], photo: await P.photo(w), attribution: 'Climbio Studio Wall', version: 1, t: Date.now() });
      const b64 = (u) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
      return { files: fs.map(f => ({ path: f.path, b64: b64(f.bytes) })), samLeft: d.holds.filter(h => h.sam && !h.sam.pick).length, samAuto: d.holds.filter(h => h.sam && h.sam.pick === 'auto').length, samInfo: d.holds.filter(h => h.sam && !h.sam.pick).map(h => ({ id: h.id, sam: h.sam.poly, iou: h.sam.iou, flags: h.sam.flags })) };
    });
    rmSync(join(dir, 'pack'), { recursive: true, force: true }); mkdirSync(join(dir, 'pack'), { recursive: true });
    for (const f of pack.files) writeFileSync(join(dir, 'pack', f.path), Buffer.from(f.b64, 'base64'));
    out.samLeft = pack.samLeft; out.samAuto = pack.samAuto; writeJson(join(dir, 'sam.json'), pack.samInfo);
    return out;
  } finally { await browser.close(); }
}

async function run() {
  const tries = +flag('--tries') || 3, i = rest.indexOf('--no-sam'), noSam = i >= 0; if (noSam) rest.splice(i, 1);
  const pi = rest.indexOf('--public'), isPublic = pi >= 0; if (isPublic) rest.splice(pi, 1);
  const [work, ...photos] = rest;
  if (!work || !photos.length) fail('用法：node tools/wall-batch.mjs run <工作資料夾> <照片…>');
  mkdirSync(work, { recursive: true });
  const chromium = chromiumOf(), server = await serve(), base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const photo of photos) {
      const name = basename(photo, extname(photo)), dir = join(work, name); mkdirSync(dir, { recursive: true });
      const prev = readJson(join(dir, 'run.json'), {});
      if (prev.state === 'done') { console.log(`${name}：做過了，跳過`); continue; }
      copyFileSync(photo, join(dir, `source${extname(photo)}`));
      const log = { name, state: 'running', tries: 0, errors: [], public: isPublic };
      for (let t = 1; t <= tries; t++) {
        log.tries = t; writeJson(join(dir, 'run.json'), log);
        const t0 = Date.now();
        try {
          const est = Math.max(15, 20 + (prev.holds || 700) * 2.5 / 60);   // 分鐘：預設照 700 顆算，先給寬一點
          const r = await runOne(chromium, base, resolve(photo), dir, { sam: !noSam, samCapMs: est * 60_000 });
          Object.assign(log, r, { state: 'done', secs: Math.round((Date.now() - t0) / 1000) }); writeJson(join(dir, 'run.json'), log);
          console.log(`${name}：完成（${r.final.holds} 顆，SAM2 ${r.sam}，第 ${t} 次）`); break;
        } catch (e) { log.errors.push(`第 ${t} 次：${e.message.slice(0, 300)}`); console.log(`${name}：第 ${t} 次失敗：${e.message.slice(0, 120)}`); }
      }
      if (log.state !== 'done') { log.state = 'failed'; writeJson(join(dir, 'run.json'), log); console.log(`${name}：重試 ${tries} 次還是失敗，記下來繼續做下一面`); }
    }
  } finally { server.close(); }
  status();
}

function status() {
  const work = rest[0]; if (!work) fail('用法：node tools/wall-batch.mjs status <工作資料夾>');
  for (const n of wallsOf(work)) {
    const r = readJson(join(work, n, 'run.json')), q = readJson(join(work, n, 'questions.json'), null), d = readJson(join(work, n, 'decisions.json'), null);
    console.log(`${n}：${r.state}${r.final ? `，${r.final.holds} 顆，SAM2 ${r.sam}${r.samLeft != null ? `（外框不一致 ${r.samLeft} 顆，要看圖判斷）` : ''}` : ''}${q ? `；AI 檢查 ${q.length} 題${d ? '，已判斷' : '，還沒判斷'}` : ''}${r.errors?.length ? `；錯誤 ${r.errors.length} 次` : ''}`);
  }
}

// ---------- check（出題與對照圖）----------
const packOf = (work, n) => join(work, n, 'pack');
const viewOf = (pack) => readdirSync(pack).filter(f => /^[0-9a-f]{16}\.json$/.test(f)).map(f => readJson(join(pack, f))).find(d => d?.surface === 'photo');
const polyOf = (pack, view, id) => readJson(join(pack, `${view.id}.json`)).marks.find(m => m.node === id)?.geometry.coordinates[0].slice(0, -1);

/** 一批「兩顆可能重複」的格子 → 每格一張對照圖（左原圖、右畫上外框：紅＝第一顆、青＝第二顆）。回傳 [{ i, dataUrl }]，也可以拼成大張的對照表 */
async function renderCells(chromium, pack, view, cells, { sheetDir, legend = '左：原圖　右：外框（紅＝第一顆、青＝第二顆）', per = 12, max = [360, 240], pad = 18, cols = 3 } = {}) {
  const jpg = readFileSync(join(pack, view.href)).toString('base64');
  const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  try {
    await page.setContent('<body></body>');
    const urls = await page.evaluate(async ({ cells, jpg, w, h, max, pad }) => {
      const img = new Image(); await new Promise(r => { img.onload = r; img.src = 'data:image/jpeg;base64,' + jpg; });
      return cells.map(c => {
        const [x0, y0, x1, y1] = c.box, sx = Math.max(0, x0 - pad), sy = Math.max(0, y0 - pad), sw = Math.min(w, x1 + pad) - sx, sh = Math.min(h, y1 + pad) - sy, k = Math.min(max[0] / sw, max[1] / sh);
        const cv = document.createElement('canvas'); cv.width = sw * k * 2 + 6; cv.height = sh * k; const g = cv.getContext('2d');
        g.drawImage(img, sx, sy, sw, sh, 0, 0, sw * k, sh * k); g.drawImage(img, sx, sy, sw, sh, sw * k + 6, 0, sw * k, sh * k);
        for (const [p, col] of [[c.a, '#ff3b3b'], [c.b, '#25e6ff']]) { g.beginPath(); p.forEach(([x, y], j) => g[j ? 'lineTo' : 'moveTo']((x - sx) * k + sw * k + 6, (y - sy) * k)); g.closePath(); g.lineWidth = 2; g.strokeStyle = col; g.stroke(); }
        return cv.toDataURL('image/jpeg', 0.85);
      });
    }, { cells, jpg, w: view.w, h: view.h, max, pad });
    if (sheetDir) {
      mkdirSync(sheetDir, { recursive: true });
      const PER = per;
      for (let s = 0; s * PER < cells.length; s++) {
        const part = urls.slice(s * PER, (s + 1) * PER).map((u, j) => `<div style="margin:4px"><div style="color:#fff;font:14px sans-serif">#${s * PER + j}　${legend}</div><img src="${u}"></div>`).join('');
        await page.setContent(`<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols},auto);width:1500px">${part}</body>`);
        await page.waitForLoadState('load'); await page.screenshot({ path: join(sheetDir, `${String(s).padStart(2, '0')}.png`), fullPage: true });
      }
    }
    return urls;
  } finally { await browser.close(); }
}

async function questionsOf(work, n) {
  const pack = packOf(work, n), r = tool('studio.mjs', 'ask', pack, '--json');
  let qs = []; try { const j = JSON.parse(r.stdout); qs = Array.isArray(j) ? j : j.questions || []; } catch { /* 沒題 */ }
  return qs.filter(q => q.kind === 'hold-dup' && q.waiting !== 'human');   // 代理答過 unsure、等人答的不算還沒判斷
}
const questionsOfSync = (work, n) => { try { const j = JSON.parse(tool('studio.mjs', 'ask', packOf(work, n), '--json').stdout); return (Array.isArray(j) ? j : j.questions || []).filter(q => q.kind === 'hold-dup' && q.waiting !== 'human'); } catch { return []; } };
const cellOf = (pack, view, q) => ({ box: q.evidence[0].box, a: polyOf(pack, view, q.target[0]), b: polyOf(pack, view, q.target[1]) });

/** SAM2 重描後的分級：要看的（旗標有 POLICY.samReviewFlags）、自動採用的（其餘）。回傳對照格：a＝現在的外框、b＝SAM2 的外框 */
function samSplit(work, n, pack, view) {
  const info = readJson(join(work, n, 'sam.json'), []), live = liveIds(pack, view), review = [], auto = [];
  for (const h of info) {
    if (!live.has(h.id)) continue;
    const a = polyOf(pack, view, h.id); if (!a) continue;
    const pts = [...a, ...h.sam], xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const cell = { id: h.id, a, b: h.sam, flags: h.flags, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(Math.round) };
    (h.flags.some(f => POLICY.samReviewFlags.includes(f)) ? review : auto).push(cell);
  }
  return { review, auto };
}

// ---- 程式自己處理的部分 ----
const inPoly = (x, y, p) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, yi] = p[i], [xj, yj] = p[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
/** 兩個外框的 IoU 和各自的面積（逐點取樣） */
function overlap(a, b) {
  const xs = [...a, ...b].map(p => p[0]), ys = [...a, ...b].map(p => p[1]); let A = 0, B = 0, I = 0;
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y += 0.5) for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x += 0.5) { const ia = inPoly(x, y, a), ib = inPoly(x, y, b); if (ia) A++; if (ib) B++; if (ia && ib) I++; }
  return { iou: I / (A + B - I || 1), A, B };
}
const rngOf = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const sample = (list, k, seed) => { const r = rngOf(seed), a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, k); };
const polyRound = (p) => p.map(q => q.map(v => Math.round(v * 10) / 10));
const applyOps = (pack, dir, ops) => { if (!ops.length) return ''; const pf = join(dir, `patch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`); writeJson(pf, ops); const r = tool('wall.mjs', 'apply', pack, pf); rmSync(pf, { force: true }); return r.status === 0 ? '' : (r.stderr || r.stdout).slice(0, 200); };

async function check() {
  const work = rest[0]; if (!work) fail('用法：node tools/wall-batch.mjs check <工作資料夾>');
  const chromium = chromiumOf();
  for (const n of wallsOf(work)) {
    if (readJson(join(work, n, 'run.json')).state !== 'done') { console.log(`${n}：還沒做完，跳過`); continue; }
    const dir = join(work, n), pack = packOf(work, n), view = viewOf(pack), first = !existsSync(join(dir, 'sam-questions.json')), audit = first ? [] : readJson(join(dir, 'audit.json'), []);
    const out = [];
    // 1 SAM2（第一次才做）：沒旗標的直接採用 SAM2 外框，候選對不上、分數低的給 AI 看圖。要先做，因為採用新外框會改變哪些岩點互相重疊
    if (first) {
      for (const f of ['sam-sheets', 'audit-sheets', 'overview']) rmSync(join(dir, f), { recursive: true, force: true });
      for (const f of ['sam-decisions.json', 'sam-left.json', 'audit-decisions.json', 'overview-decisions.json']) rmSync(join(dir, f), { force: true });
      const { review: sr, auto: sa } = samSplit(work, n, pack, view);
      const err2 = applyOps(pack, dir, sa.map(c => ({ op: 'set', id: c.id, poly: polyRound(c.b) }))); if (err2) console.log(`${n}：自動採用 SAM2 失敗：${err2}`);
      if (sa.length) tool('studio.mjs', 'note', pack, `自動處理（程式）：SAM2 重描後沒有「${POLICY.samReviewFlags.join('」「')}」旗標的 ${sa.length} 顆，直接採用 SAM2 外框（人工通常沿用 SAM2 外框）；${sr.length} 顆有旗標，交給 AI 看圖。`);
      writeJson(join(dir, 'sam-questions.json'), sr.map(({ id, box }) => ({ id, box })));
      if (sr.length) await renderCells(chromium, pack, view, sr, { sheetDir: join(dir, 'sam-sheets'), legend: '左：原圖　右：紅＝原外框、青＝SAM2 外框', per: 18, max: [250, 170] });
      for (const c of sample(sa, POLICY.auditSam, POLICY.audit.seed + 1)) audit.push({ kind: 'sam', id: c.id, orig: c.a, a: c.a, b: c.b, box: c.box });
      out.push(`SAM2：程式採用 ${sa.length} 顆、AI 看圖 ${sr.length} 顆`);
    }
    // 2 重複岩點（每次都重算：採用新外框、套用判斷之後，可能出現新的重疊）：IoU ≥ 門檻的程式自己處理（拿掉比較小的），其餘出題給 AI 看圖
    for (const f of ['sheets']) rmSync(join(dir, f), { recursive: true, force: true }); rmSync(join(dir, 'decisions.json'), { force: true });
    let qs = await questionsOf(work, n); const autoDup = [];
    for (const q of qs) {
      const a = polyOf(pack, view, q.target[0]), b = polyOf(pack, view, q.target[1]), o = overlap(a, b);
      if (o.iou >= POLICY.dupAutoIou) autoDup.push({ q, drop: o.A >= o.B ? q.target[1] : q.target[0], keep: o.A >= o.B ? q.target[0] : q.target[1] });
    }
    const dropped = new Set(), ops = [];
    for (const d of autoDup) if (!dropped.has(d.keep) && !dropped.has(d.drop)) { dropped.add(d.drop); ops.push({ op: 'remove', holds: [d.drop] }); }
    const err1 = applyOps(pack, dir, ops); if (err1) console.log(`${n}：自動處理重複岩點失敗：${err1}`);
    const autoDupDone = autoDup.filter(d => dropped.has(d.drop));
    if (autoDupDone.length) tool('studio.mjs', 'note', pack, `自動處理（程式）：重複岩點 IoU ≥ ${POLICY.dupAutoIou} 的 ${autoDupDone.length} 對，拿掉比較小的那顆。`);
    qs = await questionsOf(work, n);
    writeJson(join(dir, 'questions.json'), qs.map(q => ({ id: q.id, target: q.target, box: q.evidence[0].box })));
    if (qs.length) await renderCells(chromium, pack, view, qs.map(q => cellOf(pack, view, q)), { sheetDir: join(dir, 'sheets') });
    if (first) for (const d of sample(autoDupDone, POLICY.auditDup, POLICY.audit.seed)) audit.push({ kind: 'dup', drop: d.drop, keep: d.keep, a: polyOf(pack, view, d.drop) || [], b: polyOf(pack, view, d.keep), box: d.q.evidence[0].box });
    out.push(`重複岩點：程式處理 ${autoDupDone.length} 對、AI 看圖 ${qs.length} 題`);
    if (first) {
      writeJson(join(dir, 'audit.json'), audit.map(({ a, b, ...x }) => x));
      if (audit.length) await renderCells(chromium, pack, view, audit, { sheetDir: join(dir, 'audit-sheets'), legend: '抽查：左：原圖　右：紅＝處理前（sam＝原外框；dup＝被拿掉的）、青＝處理後（sam＝SAM2 外框；dup＝留下的）', per: 18, max: [250, 170] });
      await renderOverview(chromium, pack, view, join(dir, 'overview'));
      out.push(`抽查 ${audit.length} 個、全牆總覽 3×2 張`);
    }
    console.log(`${n}：${first ? '' : '（第二輪，採用新外框後又出現的重複岩點）'}${out.join('；')}。下一步：node tools/wall-batch.mjs next ${work}`);
  }
}

/** 全牆總覽：照片分成 3×2 張，疊上現在的外框（綠），看有沒有系統性的錯誤（照明燈被當岩點、長方形外框、貼牆長條外框偏鬆） */
async function renderOverview(chromium, pack, view, outDir) {
  mkdirSync(outDir, { recursive: true });
  const jpg = readFileSync(join(pack, view.href)).toString('base64'), polys = readJson(join(pack, `${view.id}.json`)), gone = new Set(polys.nodes.filter(n => n.props?.retired).map(n => n.id));
  const all = polys.marks.filter(m => !gone.has(m.node)).map(m => m.geometry.coordinates[0]);
  const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  try {
    await page.setContent('<body></body>');
    const urls = await page.evaluate(async ({ jpg, all, w, h }) => {
      const img = new Image(); await new Promise(r => { img.onload = r; img.src = 'data:image/jpeg;base64,' + jpg; });
      const out = [];
      for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
        const sx = c * w / 3, sy = r * h / 2, sw = w / 3, sh = h / 2, k = Math.min(1300 / sw, 860 / sh), cv = document.createElement('canvas'); cv.width = sw * k; cv.height = sh * k;
        const g = cv.getContext('2d'); g.drawImage(img, sx, sy, sw, sh, 0, 0, sw * k, sh * k); g.lineWidth = 2; g.strokeStyle = '#27e06b';
        for (const p of all) { g.beginPath(); p.forEach(([x, y], i) => g[i ? 'lineTo' : 'moveTo']((x - sx) * k, (y - sy) * k)); g.closePath(); g.stroke(); }
        out.push(cv.toDataURL('image/jpeg', 0.88));
      }
      return out;
    }, { jpg, all, w: view.w, h: view.h });
    for (const [i, u] of urls.entries()) writeFileSync(join(outDir, `${i + 1}.jpg`), Buffer.from(u.split(',')[1], 'base64'));
  } finally { await browser.close(); }
}

// ---------- apply（照判斷修岩點、答題）----------
const hull = pts => { pts = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), h = []; for (const p of pts) { while (h.length >= 2 && cr(h.at(-2), h.at(-1), p) <= 0) h.pop(); h.push(p); } const n = h.length + 1; for (const p of pts.slice(0, -1).reverse()) { while (h.length >= n && cr(h.at(-2), h.at(-1), p) <= 0) h.pop(); h.push(p); } h.pop(); return h; };
const liveIds = (pack, view) => new Set(readJson(join(pack, `${view.id}.json`)).nodes.filter(n => n.type === 'hold' && !n.props?.retired).map(n => n.id));
const NOTE = { ok: '看照片是不同的岩點，外框互相重疊但各自對應一顆', rm1: '兩個外框蓋的是同一顆，第一顆外框比較差或只是一角，拿掉第一顆', rm2: '兩個外框蓋的是同一顆，第二顆外框比較差或只是一角，拿掉第二顆', merge: '兩個外框各蓋到同一顆岩點的一部分，合成一顆（取兩個外框的凸包）' };

/** 對一題做判斷：改岩點（patch）→ 記答案。by／said 給人的判斷用 */
function decideOne(pack, view, q, d, { by = '', said = '' } = {}) {
  const [a, b] = q.target, ans = (choice, note) => tool('studio.mjs', 'answer', pack, q.id, choice, '--note', note, ...(by ? ['--by', by, '--said', said] : []));
  if (d === 'unsure') return by ? 'skip' : (ans('unsure', '兩個外框都只蓋到岩點的一部分，看不出是同一顆還是兩顆，交給人判斷'), 'unsure');
  if (d === 'ok') { ans('ok', NOTE.ok); return 'ok'; }
  const alive = liveIds(pack, view);
  if (!alive.has(a) || !alive.has(b)) { ans('ok', '其中一顆在前面的題目已經處理（拿掉或合併），這題不用再改'); return 'handled'; }
  const ops = d === 'rm1' ? [{ op: 'remove', holds: [a] }] : d === 'rm2' ? [{ op: 'remove', holds: [b] }]
    : [{ op: 'set', id: a, poly: hull([...polyOf(pack, view, a), ...polyOf(pack, view, b)]).map(p => p.map(v => Math.round(v * 10) / 10)) }, { op: 'remove', holds: [b] }];
  const pf = join(dirname(pack), `patch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`); writeJson(pf, ops);
  const ap = tool('wall.mjs', 'apply', pack, pf); rmSync(pf, { force: true });
  if (ap.status !== 0) return `apply 失敗：${(ap.stderr || ap.stdout).slice(0, 120)}`;
  ans('ok', `${NOTE[d]}（已用 wall.mjs apply 改好）`);   // 改完這題通常已經消失，答不進去沒關係，判斷記在交接筆記
  return d;
}

/** 抽查：ok＝自動處理的對；bad＝錯了，還原（sam 換回原外框、dup 把被拿掉的拿回來）。bad 的比例寫進交接筆記，太高要通知（audit-failed.json） */
function applyAudit(work, n, list) {
  const items = readJson(join(work, n, 'audit.json')); if (!items) { console.log(`${n}：沒有 audit.json，先跑 check`); return; }
  if (list.length !== items.length) fail(`${n}#audit：抽查有 ${items.length} 個，判斷給了 ${list.length} 個，要一個一個`);
  const pack = packOf(work, n), ops = [];
  list.forEach((d, i) => { if (!['ok', 'bad'].includes(d)) fail(`${n}#audit #${i}：不認得判斷 ${d}`); if (d !== 'bad') return; const it = items[i]; ops.push(it.kind === 'sam' ? { op: 'set', id: it.id, poly: polyRound(it.orig) } : { op: 'restore', holds: [it.drop] }); });
  const err = applyOps(pack, join(work, n), ops); if (err) console.log(`${n}#audit：還原失敗：${err}`);
  const bad = list.filter(d => d === 'bad').length, rate = items.length ? bad / items.length : 0;
  writeJson(join(work, n, 'audit-decisions.json'), list); writeJson(join(work, n, 'audit-result.json'), { total: items.length, bad, rate });
  tool('studio.mjs', 'note', pack, `抽查（代理）：自動處理的結果抽 ${items.length} 個看圖，錯 ${bad} 個（${Math.round(rate * 100)}%），錯的已還原。`);
  console.log(`${n}#audit：抽 ${items.length}、錯 ${bad}（${Math.round(rate * 100)}%）${rate > 0.25 ? '　⚠ 錯太多：自動規則在這面牆可能不準，交付時要告訴使用者' : ''}`);
}
function applyOverview(work, n, list) {
  const pack = packOf(work, n), note = (list || []).filter(x => x && x !== 'ok').join('；');
  writeJson(join(work, n, 'overview-decisions.json'), list);
  tool('studio.mjs', 'note', pack, `全牆總覽（代理）：${note ? `看到系統性問題：${note}` : '沒有看到系統性問題'}。`);
  console.log(`${n}#overview：${note || 'ok'}`);
}

/** SAM2 不一致的判斷：sam＝把外框換成 SAM2 的、keep＝不動；unsure 留給人（記進 sam-left.json） */
function applySam(work, n, list) {
  const qs = readJson(join(work, n, 'sam-questions.json')); if (!qs) { console.log(`${n}：沒有 sam-questions.json，先跑 check`); return; }
  if (list.length !== qs.length) fail(`${n}#sam：題目有 ${qs.length} 題，判斷給了 ${list.length} 個，要一題一個`);
  const pack = packOf(work, n), view = viewOf(pack), info = new Map(readJson(join(work, n, 'sam.json'), []).map(h => [h.id, h])), live = liveIds(pack, view), ops = [], count = { sam: 0, keep: 0, delete: 0, unsure: 0, handled: 0 }, left = [];
  list.forEach((d, i) => {
    if (!['sam', 'keep', 'delete', 'unsure'].includes(d)) fail(`${n}#sam #${i}：不認得判斷 ${d}`);
    const id = qs[i].id;
    if (!live.has(id)) { count.handled++; return; }
    count[d]++;
    if (d === 'sam') ops.push({ op: 'set', id, poly: info.get(id).sam.map(p => p.map(v => Math.round(v * 10) / 10)) });
    if (d === 'delete') ops.push({ op: 'remove', holds: [id] });
    if (d === 'unsure') left.push(id);
  });
  addRecheck(work, n, left.map(id => ({ kind: 'sam', id })));
  if (ops.length) { const pf = join(work, n, `patch-sam-${Date.now()}.json`); writeJson(pf, ops); const ap = tool('wall.mjs', 'apply', pack, pf); rmSync(pf, { force: true }); if (ap.status !== 0) console.log(`${n}#sam：apply 失敗：${(ap.stderr || ap.stdout).slice(0, 200)}`); }
  writeJson(join(work, n, 'sam-left.json'), left); writeJson(join(work, n, 'sam-decisions.json'), list);
  const line = `採用 SAM2 ${count.sam}、保留原外框 ${count.keep}、拿掉 ${count.delete}、交給人 ${count.unsure}、已被拿掉 ${count.handled}`;
  tool('studio.mjs', 'note', pack, `AI 檢查（代理）：SAM2 有「${POLICY.samReviewFlags.join('」「')}」旗標的 ${qs.length} 顆，看照片逐顆判斷：${line}`);
  console.log(`${n}#sam：${line}`);
}

/** 看不準的記進 recheck.json（不是交給人，是放大再看一次） */
function addRecheck(work, n, items) {
  if (!items.length) return;
  const f = join(work, n, 'recheck.json'), cur = readJson(f, []), key = (x) => x.kind + ':' + (x.id || x.qid);
  for (const it of items) if (!cur.some(c => key(c) === key(it))) cur.push(it);
  writeJson(f, cur); rmSync(join(work, n, 'recheck-decisions.json'), { force: true });
}

function apply() {
  const [work, file] = rest; if (!work || !file) fail('用法：node tools/wall-batch.mjs apply <工作資料夾> <判斷.json>');
  const all = readJson(resolve(file)); if (!all) fail(`讀不到 ${file}`);
  for (const n of Object.keys(all)) {
    if (n.endsWith('#sam')) { applySam(work, n.slice(0, -4), all[n]); continue; }
    if (n.endsWith('#recheck')) { applyRecheck(work, n.slice(0, -8), all[n]); continue; }
    if (n.endsWith('#audit')) { applyAudit(work, n.slice(0, -6), all[n]); continue; }
    if (n.endsWith('#overview')) { applyOverview(work, n.slice(0, -9), all[n]); continue; }
    const qs = readJson(join(work, n, 'questions.json')); if (!qs) { console.log(`${n}：沒有 questions.json，先跑 check`); continue; }
    if (all[n].length !== qs.length) fail(`${n}：題目有 ${qs.length} 題，判斷給了 ${all[n].length} 個，要一題一個`);
    const pack = packOf(work, n), view = viewOf(pack), count = {};
    all[n].forEach((d, i) => { if (!['ok', 'rm1', 'rm2', 'merge', 'unsure'].includes(d)) fail(`${n} #${i}：不認得判斷 ${d}`); const r = decideOne(pack, view, { id: qs[i].id, target: qs[i].target }, d); if (r === 'unsure') addRecheck(work, n, [{ kind: 'dup', qid: qs[i].id, target: qs[i].target }]); count[r] = (count[r] || 0) + 1; if (/失敗/.test(r)) console.log(`${n} #${i}：${r}`); });
    const line = Object.entries(count).map(([k, v]) => `${k} ${v}`).join('、');
    tool('studio.mjs', 'note', pack, `AI 檢查（代理）：${qs.length} 題可能重複的岩點，看照片逐題判斷：${line}（ok＝不同岩點保留、rm＝拿掉重複外框、merge＝合成一顆、unsure＝交給人、handled＝前面已處理）`);
    writeJson(join(work, n, 'decisions.json'), all[n]);
    console.log(`${n}：${line}`);
  }
}

// ---------- recheck（看不準的放大再看一次，定案）----------
async function recheck() {
  const work = rest[0]; if (!work) fail('用法：node tools/wall-batch.mjs recheck <工作資料夾>');
  const chromium = chromiumOf();
  for (const n of wallsOf(work)) {
    const items = readJson(join(work, n, 'recheck.json'), []), pack = packOf(work, n), view = viewOf(pack), live = liveIds(pack, view), cells = [], keep = [];
    for (const it of items) {
      if (it.kind === 'sam') { if (!live.has(it.id)) continue; const info = readJson(join(work, n, 'sam.json'), []).find(h => h.id === it.id), a = polyOf(pack, view, it.id); if (!info || !a) continue; const pts = [...a, ...info.sam], xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); cells.push({ a, b: info.sam, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(Math.round) }); keep.push(it); }
      else { const [x, y] = it.target; if (!live.has(x) || !live.has(y)) continue; const a = polyOf(pack, view, x), b = polyOf(pack, view, y), pts = [...a, ...b], xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); cells.push({ a, b, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(Math.round) }); keep.push(it); }
    }
    rmSync(join(work, n, 'recheck-sheets'), { recursive: true, force: true }); rmSync(join(work, n, 'recheck-decisions.json'), { force: true });
    writeJson(join(work, n, 'recheck.json'), keep);
    if (cells.length) await renderCells(chromium, pack, view, cells, { sheetDir: join(work, n, 'recheck-sheets'), legend: '再看一次（放大、含周圍）：紅＝第一顆／原外框、青＝第二顆／SAM2 外框；沒有「看不準」，要定案', per: 4, max: [640, 460], pad: 70, cols: 2 });
    console.log(`${n}：要再看一次 ${cells.length} 件${cells.length ? `，大圖在 ${join(work, n, 'recheck-sheets')}（#號對應 recheck.json 的順序）；判斷寫在 "${n}#recheck"，sam 類答 sam|keep|delete，重複岩點類答 ok|rm1|rm2|merge，不能答 unsure` : ''}`);
  }
}
function applyRecheck(work, n, list) {
  const items = readJson(join(work, n, 'recheck.json'), []); if (list.length !== items.length) fail(`${n}#recheck：要再看的有 ${items.length} 件，判斷給了 ${list.length} 個，要一個一個`);
  const pack = packOf(work, n), view = viewOf(pack), count = {}, ops = [], info = new Map(readJson(join(work, n, 'sam.json'), []).map(h => [h.id, h]));
  items.forEach((it, i) => {
    const d = list[i];
    if (d === 'unsure') fail(`${n}#recheck #${i}：這一輪不能再答 unsure：放大看過了就要定案；真的分不出來，保留原樣（sam 類答 keep、重複岩點答 ok）並照實寫在交付說明`);
    if (it.kind === 'sam') {
      if (!['sam', 'keep', 'delete'].includes(d)) fail(`${n}#recheck #${i}：sam 類要答 sam|keep|delete`);
      if (d === 'sam') ops.push({ op: 'set', id: it.id, poly: polyRound(info.get(it.id).sam) });
      if (d === 'delete') ops.push({ op: 'remove', holds: [it.id] });
      count['sam:' + d] = (count['sam:' + d] || 0) + 1;
    } else {
      if (!['ok', 'rm1', 'rm2', 'merge'].includes(d)) fail(`${n}#recheck #${i}：重複岩點要答 ok|rm1|rm2|merge`);
      const r = decideOne(pack, view, { id: it.qid, target: it.target }, d); count['dup:' + r] = (count['dup:' + r] || 0) + 1;
    }
  });
  const err = applyOps(pack, join(work, n), ops); if (err) console.log(`${n}#recheck：apply 失敗：${err}`);
  writeJson(join(work, n, 'recheck-decisions.json'), list); writeJson(join(work, n, 'sam-left.json'), []);
  const line = Object.entries(count).map(([k, v]) => `${k} ${v}`).join('、');
  tool('studio.mjs', 'note', pack, `放大再看一次（代理）：看不準的 ${items.length} 件，放大、含周圍重新看圖後定案：${line}`);
  console.log(`${n}#recheck：${line}`);
}

// ---------- next（下一步是什麼：所有代理照這個做，不用自己讀文件決定）----------
/** 這面牆 AI 檢查還缺哪些判斷（空陣列＝AI 都做完了，可以整理給人） */
function nextTodo(work, n) {
  const dir = join(work, n), need = [];
  if (!existsSync(join(dir, 'questions.json'))) return ['還沒跑 check'];
  const count = (f) => (readJson(join(dir, f), []) || []).length, has = (f) => !!readJson(join(dir, f), null);
  if (count('questions.json') && !has('decisions.json')) need.push(`重複岩點 ${count('questions.json')} 題（sheets/）`);
  if (count('sam-questions.json') && !has('sam-decisions.json')) need.push(`SAM2 要看的 ${count('sam-questions.json')} 顆（sam-sheets/）`);
  if (count('audit.json') && !has('audit-decisions.json')) need.push(`抽查 ${count('audit.json')} 個（audit-sheets/）`);
  if (!has('overview-decisions.json')) need.push('全牆總覽 6 張（overview/）');
  if (count('recheck.json') && !has('recheck-decisions.json')) need.push(`看不準的 ${count('recheck.json')} 件要放大再看一次：先跑 recheck 出大圖（recheck-sheets/），判斷寫 "${n}#recheck"，不能再答 unsure`);
  if (!need.length) { const open = questionsOfSync(work, n).length; if (open) need.push(`採用新外框、修岩點之後又出現 ${open} 題重複岩點：重跑 check（只重算重複岩點）`); }
  return need;
}
function next() {
  const work = rest[0]; if (!work) fail('用法：node tools/wall-batch.mjs next <工作資料夾>');
  const names = wallsOf(work);
  if (!names.length) { console.log(`下一步：node tools/wall-batch.mjs run ${work} <照片…>（還沒有任何牆）`); return; }
  const notDone = names.filter(n => readJson(join(work, n, 'run.json')).state !== 'done');
  if (notDone.length) { console.log(`下一步：node tools/wall-batch.mjs run ${work} <這些牆的照片>：${notDone.join('、')} 還沒做完（狀態 ${notDone.map(n => readJson(join(work, n, 'run.json')).state).join('、')}）`); return; }
  const unchecked = names.filter(n => !existsSync(join(work, n, 'questions.json')));
  if (unchecked.length) { console.log(`下一步：node tools/wall-batch.mjs check ${work}（${unchecked.join('、')} 還沒分級檢查）`); return; }
  const todo = names.map(n => [n, nextTodo(work, n)]).filter(([, t]) => t.length);
  if (todo.length) {
    console.log('下一步：逐張看圖判斷，把全部牆的判斷寫進同一個 JSON，一次 apply：');
    for (const [n, t] of todo) console.log(`- ${n}：${t.join('；')}\n    資料夾 ${join(work, n)}`);
    console.log(`判斷檔格式：{ "<牆>": ["ok|rm1|rm2|merge|unsure"…，照 questions.json], "<牆>#sam": ["sam|keep|delete|unsure"…，照 sam-questions.json], "<牆>#audit": ["ok|bad"…，照 audit.json], "<牆>#overview": ["ok" 或系統性問題的說明] }`);
    console.log('圖很多時，可以把不同牆、不同張數分給子代理各看一部分，最後合併成一個 JSON。不用問使用者，看不準的寫 unsure。');
    console.log(`寫好後：node tools/wall-batch.mjs apply ${work} <判斷.json>`); return;
  }
  const rv = join(work, 'review', 'review.json');
  if (!existsSync(rv)) { console.log(`下一步：node tools/wall-batch.mjs review ${work}`); return; }
  const r = readJson(rv), left = r.items.length;
  console.log(left ? `下一步：把 ${join(work, 'review', 'index.html')} 發成 Artifact 給使用者（${left} 件要人判斷）；使用者回覆後逐項 resolve，再重跑 review 確認。` : '全部做完，沒有要人判斷的。交付時回報每面牆的數字（見 docs/studio-wall.md）。');
}

// ---------- review（一次整理成要人判斷的清單）----------
async function review() {
  const work = rest[0]; if (!work) fail('用法：node tools/wall-batch.mjs review <工作資料夾>');
  const chromium = chromiumOf(), items = [], walls = [];
  for (const n of wallsOf(work)) {
    const r = readJson(join(work, n, 'run.json'));
    if (r.state !== 'done') { walls.push({ wall: n, state: r.state, errors: r.errors }); continue; }
    const pack = packOf(work, n), view = viewOf(pack);
    const todo = nextTodo(work, n);
    if (todo.length) { walls.push({ wall: n, state: `AI 檢查還沒做完：${todo.join('、')}`, holds: r.final.holds }); continue; }   // AI 檢查沒做完不給人看
    const hs = tool('wall.mjs', 'holds', pack).stdout.split('\n')[0] || '', qs = await questionsOf(work, n);
    const asks = JSON.parse(tool('studio.mjs', 'ask', pack, '--human', '--json').stdout || '[]'), humanQs = Array.isArray(asks) ? asks : asks.questions || [];
    const cells = [], urls = cells.length ? await renderCells(chromium, pack, view, cells.map(q => cellOf(pack, view, q))) : [];
    cells.forEach((q, i) => items.push({ no: 0, wall: n, kind: 'hold-dup', id: q.id, title: `${n}：這兩顆外框是同一顆嗎？`, why: (q.why || 'AI 看不準').toString().slice(0, 200), image: urls[i], choices: [['ok', '兩顆是不同的岩點'], ['rm1', '同一顆，拿掉紅色'], ['rm2', '同一顆，拿掉青色'], ['merge', '同一顆被拆成兩半，合成一顆']] }));
    const samLeft = [], samInfo = new Map(readJson(join(work, n, 'sam.json'), []).map(h => [h.id, h]));
    if (samLeft.length) {
      const cellsS = samLeft.map(id => { const a = polyOf(pack, view, id), b = samInfo.get(id).sam, pts = [...a, ...b], xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); return { a, b, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(Math.round) }; });
      const us = await renderCells(chromium, pack, view, cellsS);
      samLeft.forEach((id, i) => items.push({ no: 0, wall: n, kind: 'sam', id, title: `${n}：這顆岩點的外框用哪個？`, why: 'AI 看不準：紅色是原外框、青色是 SAM2 的外框', image: us[i], choices: [['keep', '用紅色（原外框）'], ['sam', '用青色（SAM2）'], ['delete', '不是岩點，拿掉']] }));
    }
    const pub = r.public ? humanQs.find(q => q.kind === 'publish') : null;   // 私有牆（預設）不出發佈題
    walls.push({ wall: n, state: 'done', holds: r.final.holds, afterAi: hs.replace(/^.*（.*?，\d+×\d+）：/, '').trim(), sam: r.sam, samReviewed: (readJson(join(work, n, 'sam-questions.json'), []) || []).length, samLeft: samLeft.length, samAuto: r.samLeft - ((readJson(join(work, n, 'sam-questions.json'), []) || []).length), audit: readJson(join(work, n, 'audit-result.json'), null), overview: (readJson(join(work, n, 'overview-decisions.json'), []) || []).filter(x => x && x !== 'ok'), aiLeft: qs.length + samLeft.length, publish: pub ? { id: pub.id, title: pub.title } : null });
    if (pub) items.push({ no: 0, wall: n, kind: 'publish', id: pub.id, title: pub.title, why: '發佈就是公開、收不回。沒答就不會發佈；答「發佈」才算你核准這一版。', choices: [['ok', '發佈'], ['no', '先不發佈']] });
  }
  items.forEach((it, i) => { it.no = i + 1; });
  mkdirSync(join(work, 'review'), { recursive: true });
  writeJson(join(work, 'review', 'review.json'), { walls, items: items.map(({ image, ...x }) => x) });
  writeFileSync(join(work, 'review', 'index.html'), reviewHtml(walls, items));
  console.log(`整理好了：${items.length} 件要人判斷，${walls.length} 面牆`);
  for (const w of walls) console.log(`- ${w.wall}：${w.state}${w.holds ? `，${w.holds} 顆` : ''}${w.samReviewed != null ? `；SAM2：程式採用 ${w.samAuto + (w.samAuto < 0 ? 0 : 0)} 顆、AI 看圖 ${w.samReviewed} 顆、交給人 ${w.samLeft} 顆` : ''}${w.audit ? `；抽查 ${w.audit.total} 個、錯 ${w.audit.bad} 個` : ''}${w.overview?.length ? `；總覽發現：${w.overview.join('；')}` : ''}`);
  console.log(`手機看：把 ${join(work, 'review', 'index.html')} 發成 Artifact（單檔、圖都內嵌）貼給使用者；使用者回覆後逐項 resolve，格式見檔案頂端`);
}

function reviewHtml(walls, items) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const wallRows = walls.map(w => `<tr><td>${esc(w.wall)}</td><td>${esc(w.state)}</td><td>${w.holds ?? ''}</td><td>${w.samReviewed != null ? `AI 看 ${w.samReviewed} 顆、要你看 ${w.samLeft} 顆` : ''}</td></tr>`).join('');
  const cards = items.map(it => `<section class="card" data-no="${it.no}"><h2>${it.no}. ${esc(it.title)}</h2>${it.image ? `<img src="${it.image}" alt="">` : ''}<p class="why">${esc(it.why)}</p><div class="opts">${it.choices.map(([k, t]) => `<button data-k="${k}">${esc(t)}</button>`).join('')}</div></section>`).join('');
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>岩點檢查 要你判斷</title>
<style>:root{--bg:#fff;--fg:#1a1a1a;--card:#f4f4f2;--line:#d8d8d4;--acc:#1f7a3d}@media(prefers-color-scheme:dark){:root{--bg:#121513;--fg:#eceeed;--card:#1c211e;--line:#2c332f;--acc:#6bdc8e}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,"Noto Sans TC",sans-serif;padding:16px;max-width:640px;margin:auto}h1{font-size:22px}h2{font-size:17px;margin:0 0 8px}table{width:100%;border-collapse:collapse;font-size:14px;margin:8px 0 16px}td,th{border-bottom:1px solid var(--line);padding:6px 4px;text-align:left}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px;margin:12px 0}img{width:100%;border-radius:8px}.why{color:#888;font-size:14px;margin:6px 0}.opts{display:flex;flex-wrap:wrap;gap:8px}button{font:inherit;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--fg)}button[aria-pressed=true]{background:var(--acc);color:#fff;border-color:var(--acc)}
#out{width:100%;min-height:120px;font:14px monospace;background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:10px;padding:8px;box-sizing:border-box}</style></head><body>
<h1>岩點檢查：要你判斷的 ${items.length} 件</h1><p>AI 已經把能判斷的都做完了，這裡只剩看不準的。每件點一個選項，最下面複製回覆，貼回對話就好。</p>
<table><tr><th>牆</th><th>狀態</th><th>岩點</th><th>SAM2</th></tr>${wallRows}</table>${cards || '<p>沒有要你判斷的。</p>'}
<h2>你的回覆</h2><textarea id="out" readonly placeholder="選完會出現在這裡"></textarea><p><button id="copy">複製回覆</button></p>
<script>const pick={};document.querySelectorAll('.card').forEach(c=>c.querySelectorAll('button').forEach(b=>b.onclick=()=>{c.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed','false'));b.setAttribute('aria-pressed','true');pick[c.dataset.no]=b.dataset.k;out.value=Object.entries(pick).map(([n,k])=>n+' '+k).join('\\n')}));
copy.onclick=async()=>{try{await navigator.clipboard.writeText(out.value);copy.textContent='已複製'}catch(e){out.select();copy.textContent='請手動複製'}}</script></body></html>`;
}

// ---------- resolve（記人的判斷）----------
function resolveOne() {
  const [work, ref, choice] = rest, by = flag('--by'), said = flag('--said');
  if (!work || !ref || !choice) fail('用法：node tools/wall-batch.mjs resolve <工作資料夾> <牆>:<題 id、sam:<岩點 id> 或 publish> <ok|rm1|rm2|merge；sam 題用 keep|sam> --by human:<名稱> --said "<人的原話>"');
  if (!by.startsWith('human:') || !said) fail('人的判斷要帶 --by human:<名稱> 和 --said "<人在對話裡的原話>"：先把清單給人看、人親口答了才記，不替人決定');
  const [n, qid] = [ref.slice(0, ref.indexOf(':')), ref.slice(ref.indexOf(':') + 1)], pack = packOf(work, n), view = viewOf(pack);
  if (qid.startsWith('sam:')) {   // SAM2 外框看不準、人決定的：keep 不動、sam 換成 SAM2 的外框
    const id = qid.slice(4), info = readJson(join(work, n, 'sam.json'), []).find(h => h.id === id);
    if (!info || !['keep', 'sam', 'delete'].includes(choice)) fail(`${n}:${qid}：沒有這顆，或選項不是 keep／sam／delete`);
    if (choice === 'sam') { const pf = join(work, n, `patch-human-${Date.now()}.json`); writeJson(pf, [{ op: 'set', id, poly: info.sam.map(p => p.map(v => Math.round(v * 10) / 10)) }]); const ap = tool('wall.mjs', 'apply', pack, pf); rmSync(pf, { force: true }); if (ap.status !== 0) fail(`apply 失敗：${(ap.stderr || ap.stdout).slice(0, 200)}`); }
    if (choice === 'delete') { const err = applyOps(pack, join(work, n), [{ op: 'remove', holds: [id] }]); if (err) fail(`apply 失敗：${err}`); }
    writeJson(join(work, n, 'sam-left.json'), readJson(join(work, n, 'sam-left.json'), []).filter(x => x !== id));
    tool('studio.mjs', 'note', pack, `人的判斷（${by}，原話「${said}」）：岩點 ${id} 的外框${choice === 'delete' ? '不是岩點，拿掉' : choice === 'sam' ? '用 SAM2' : '用原外框'}`); console.log(`${n}：${id} → ${choice}`); return;
  }
  if (qid === 'publish') {
    const q = JSON.parse(tool('studio.mjs', 'ask', pack, '--human', '--json').stdout || '[]'), qq = (Array.isArray(q) ? q : q.questions || []).find(x => x.kind === 'publish');
    if (!qq) fail(`${n}：沒有等人答的發佈題`);
    if (choice !== 'ok') fail('不發佈就不用記；要核准才答 ok');
    const r = tool('studio.mjs', 'answer', pack, qq.id, 'ok', '--by', by, '--said', said); console.log((r.stdout || r.stderr).trim().split('\n')[0]); console.log('已記下核准；這個指令不發佈，發佈請用 tools/studio.mjs publish');
    return;
  }
  const q = { id: qid, target: qid.replace(/^q-hold-dup-[0-9a-f]{16}-/, '').split('-') };
  console.log(`${n}：${decideOne(pack, view, q, choice, { by, said })}`);
}

const table = { run, check, recheck, apply, review, status, next, resolve: resolveOne };
if (!table[cmd]) fail('用法：node tools/wall-batch.mjs next|run|check|recheck|apply|review|resolve|status …（不知道做什麼先跑 next；說明在檔案開頭）');
await table[cmd]();
