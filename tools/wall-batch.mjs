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
//                                                             "<牆>#recheck": ["sam|keep|delete:<理由> 或 ok|rm1|rm2|merge", …]（放大再看一次，照 recheck.json 的順序，不能再答 unsure）, "<牆>#audit": ["ok"|"bad", …]（抽查，照 audit.json 的順序）,
//                                                             "<牆>#overview": [6 格，每格 "ok" 或 { "volumes": [[x0,y0,x1,y1]…], "missing": [[x0,y0,x1,y1]…], "issues": "…" }],
//                                                             "<牆>#shapes": [每個量體一個多邊形 [[x,y]…]（或幾個多邊形的陣列、或 "skip:<理由>"）], "<牆>#shapecheck": ["ok" 或 { "poly": […], "remove": [編號…], "delete": true }]}
//   node tools/wall-batch.mjs shapes <工作資料夾>             總覽回報的量體出放大圖（含座標格線）給代理畫外框（shape-sheets/）
//   node tools/wall-batch.mjs shapecheck <工作資料夾>         新加的量體、漏掉的岩點疊上外框再看一次（shapecheck-sheets/；每輪只看還沒看過的）
//   node tools/wall-batch.mjs onvolume <工作資料夾>           每個大外框（量體、大岩點）一張放大圖，找上面沒有外框的岩點（onvolume-sheets/）
//   node tools/wall-batch.mjs verify <工作資料夾>             **完成的閘門**：每面牆每一步都判斷過、數字寫進 <牆>/result.json、研究記錄寫進 <牆>/pack/<牆 id>.edits.json（發佈時上傳）；沒過就列原因、以 1 結束
//   node tools/wall-batch.mjs reviewed <工作資料夾> <牆> --by human:<名稱> --said "<原話>"   人另外檢查過（可做可不做）：研究記錄多記一筆
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
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, readdirSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname, basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DELETE_REASONS, HOLD_RULES } from './hold-rubric.mjs';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'), require = createRequire(import.meta.url);

/** 哪些程式自己處理、哪些給 AI 看圖、哪些給人：全部寫在這裡，不要讓每個代理自己決定。數字的依據見 docs/studio-wall.md「分級」。 */
const POLICY = {
  samReviewFlags: ['候選對不上', '分數低'],   // SAM2 重描後只有這兩種旗標要 AI 看圖（約 5～7% 的岩點）；其餘（沒旗標、偵測信心低、邊緣不確定）直接採用 SAM2 外框
  dupAutoIou: 0.70,                           // 兩個外框重疊（IoU）到這個值以上就是同一顆：程式自動拿掉比較小的那顆，不問 AI
  auditSam: 12, auditDup: 6,                  // 自動處理的結果，隨機抽幾個給 AI 複查（自動不等於不檢查）；複查有錯的會還原
  audit: { seed: 20261121 },
  surfaceRatio: 3,                            // 面積到中位數的 3 倍以上（量體、大岩點）各出一張放大圖找上面漏掉的岩點：南港漏掉的岩點全部在這種外框裡面
  volumeRatio: 8,                           // 面積到中位數的 8 倍以上算量體：總覽用黃色畫，方便看出哪些量體沒有整顆的外框
  overviewTiles: [3, 2],                      // 全牆總覽切成 3×2 格，每格都要回答（量體、漏掉的岩點、系統性問題）
  deleteReasons: DELETE_REASONS,              // 刪除一定要說是哪一種；說不出來就是岩點，保留（tools/hold-rubric.mjs，3D 牆共用）
};

/** 判斷準則：所有代理照同一份判斷，`next` 每次都印出來。1～3 條跟 3D 牆共用（tools/hold-rubric.mjs）。依據：南港、市民抱石的人工答案（docs/studio-wall.md「判斷準則」） */
const RUBRIC = [
  '判斷準則（所有代理同一份，照順序套用）：',
  ...HOLD_RULES.map((r, i) => `${i + 1} ${r}`),
  '4 外框二選一：選貼著岩點實際邊緣的那個；SAM2 外框包到牆面或旁邊的岩點 → keep；原外框切掉一角 → sam；兩個都差不多 → sam。',
  '5 重複：同一顆兩個外框 → 留比較完整的（rm1／rm2）；同一顆被切成兩半 → merge；量體和它上面的岩點、或兩顆相鄰的岩點 → ok；量體的一個面被切成的碎片和岩點（或和量體）→ 拿掉碎片（rm1／rm2）。抽查只看程式自動處理的那一步對不對，不管別題怎麼判。',
  '6 總覽每格都要逐一找：黃色＝目前的大外框（量體或大岩點）。每個量體都要有一個沿外緣的完整外框；沒有、只蓋一部分、被切成好幾塊（量體上只看到岩點和碎片的綠框）→ 回報 volumes 外接框（一個量體一個框）；完全沒有外框的岩點 → 回報 missing 外接框。座標照圖上的格線（照片像素）；跨格的量體每格報自己看到的那一段，框的邊貼著格線，會自動接起來。',
  '7 畫量體：照放大圖的格線，沿量體外緣依序給頂點（照片像素，順時針或逆時針都可，6～20 點）；量體邊是直線，轉角放頂點；被上面的岩點擋住的邊照量體的直線延伸，量體超出放大圖就照總覽把頂點給到圖外。',
  '8 量體上的岩點：每個大外框（量體、大岩點）各一張放大圖，逐一找上面每一顆岩點（小色塊、螺絲旁的小點也算，照第 1 條判斷），自己沒有外框的回報外接框；圖上其他地方看到沒有外框的岩點也一起報（重複報到同一顆會自動合併）；都有就回 []。',
];
const reasonOf = (d) => { const m = /^delete:(.+)$/.exec(d || ''); return m && POLICY.deleteReasons.includes(m[1]) ? m[1] : null; };
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
    // 跨來源隔離：WASM 才能多執行緒（沒有 WebGPU 時 SAM2 快好幾倍）；credentialless 讓 CDN 的程式庫、模型照常載入
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' });
    res.end(readFileSync(file));
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok(server)));
}

// 跑 SAM2 的瀏覽器（runOne）：Playwright 內建的 Chromium。Windows 上它拿不到 WebGPU（缺 dxcompiler.dll），SAM2 用 WASM；
// 靠 serve() 的跨來源隔離標頭讓 WASM 多執行緒，一面 65 顆的小牆約 20 秒。不改用電腦裡的 Edge／Chrome：
// 實測 Windows 的 Intel 內顯用 WebGPU 載入 SAM2 會一直卡住（sam.js 90 秒後提示改用 WASM，但白等）。Mac 內建的就拿得到 WebGPU

// ---------- run ----------
/** 一面牆跑一次：偵測 → SAM2（失敗不算整面失敗，記下來）→ 匯出 ZIP 與牆的分享包。回傳摘要；拋錯＝這次整面失敗要重試 */
async function runOne(chromium, base, photo, dir, { sam = true, samCapMs }) {
  // 設定檔放硬碟（每次新開一個，跑完刪掉）：Playwright 預設的無痕環境，瀏覽器私有檔案系統放在記憶體，
  // 大照片（南港 3072×2164、500 多顆）SAM2 跑完後讀專案檔會 NotFoundError（Windows 實測）
  const profile = join(dir, '.browser'); rmSync(profile, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(profile, { args: ['--enable-unsafe-webgpu'], acceptDownloads: true, viewport: { width: 1400, height: 900 } });
  const pageErrs = [];
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    page.on('pageerror', (e) => pageErrs.push(String(e.stack || e).slice(0, 400)));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') pageErrs.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
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
        out.sam = err ? `failed: ${err.slice(0, 1200)}` : 'done';
      } catch (e) { out.sam = `failed: ${e.message.slice(0, 600)}`; }
      if (out.sam !== 'done' && pageErrs.length) out.sam += `｜頁面錯誤：${pageErrs.slice(-5).join('｜').slice(0, 1200)}`;
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
      // auto：自動結果（研究記錄的 base：HoldKit 偵測加重描的外框與旗標；sam：每顆 SAM2 重描的外框、旗標、跟原外框的 IoU、程式有沒有直接採用）
      const auto = { tools: { holdkit: HoldKit.VERSION, detector: 'holdscan', sam: 'sam2.1-hiera-base-plus' }, base: d.base || {}, sam: Object.fromEntries(d.holds.filter(h => h.sam).map(h => [h.id, { poly: h.sam.poly, flags: h.sam.flags, iou: h.sam.iou, pick: h.sam.pick }])), sha256: w.sha || '' };
      return { auto, files: fs.map(f => ({ path: f.path, b64: b64(f.bytes) })), samLeft: d.holds.filter(h => h.sam && !h.sam.pick).length, samAuto: d.holds.filter(h => h.sam && h.sam.pick === 'auto').length, samInfo: d.holds.filter(h => h.sam && !h.sam.pick).map(h => ({ id: h.id, sam: h.sam.poly, iou: h.sam.iou, flags: h.sam.flags })) };
    });
    rmSync(join(dir, 'pack'), { recursive: true, force: true }); mkdirSync(join(dir, 'pack'), { recursive: true });
    for (const f of pack.files) writeFileSync(join(dir, 'pack', f.path), Buffer.from(f.b64, 'base64'));
    out.samLeft = pack.samLeft; out.samAuto = pack.samAuto; writeJson(join(dir, 'sam.json'), pack.samInfo); writeJson(join(dir, 'auto.json'), pack.auto);
    return out;
  } catch (e) {   // 哪一步失敗都附上頁面的錯誤（Studio 自己接住的錯誤只印在 console）
    throw new Error(`${e.message.split('\n')[0]}${pageErrs.length ? `｜頁面錯誤：${pageErrs.slice(-6).join('｜').slice(0, 1500)}` : ''}`);
  } finally { await ctx.close(); rmSync(profile, { recursive: true, force: true }); }
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
        } catch (e) { log.errors.push(`第 ${t} 次（${Math.round((Date.now() - t0) / 60000)} 分鐘）：${e.message.slice(0, 2500)}`); console.log(`${name}：第 ${t} 次失敗：${e.message.slice(0, 120)}`); }
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
      for (const f of ['sam-sheets', 'audit-sheets', 'overview', 'shape-sheets', 'shapecheck-sheets', 'recheck-sheets', 'onvolume-sheets']) rmSync(join(dir, f), { recursive: true, force: true });
      for (const f of ['sam-decisions.json', 'sam-left.json', 'audit-decisions.json', 'overview-decisions.json', 'shapes.json', 'shape-decisions.json', 'added.json', 'shapecheck.json', 'shapecheck-decisions.json', 'recheck.json', 'recheck-decisions.json', 'deleted.json', 'result.json', 'onvolume.json', 'onvolume-decisions.json']) rmSync(join(dir, f), { force: true });
      const { review: sr, auto: sa } = samSplit(work, n, pack, view);
      const err2 = applyOps(pack, dir, sa.map(c => ({ op: 'set', id: c.id, poly: polyRound(c.b) }))); if (err2) console.log(`${n}：自動採用 SAM2 失敗：${err2}`);
      rmSync(join(dir, 'ai-log.jsonl'), { force: true });
      logLine(work, n, { step: 'auto-sam', rule: `SAM2 沒有「${POLICY.samReviewFlags.join('」「')}」旗標就採用 SAM2 外框`, ids: sa.map(c => c.id), review: sr.map(c => c.id) });
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
    if (autoDupDone.length) logLine(work, n, { step: 'auto-dup', rule: `重疊 IoU ≥ ${POLICY.dupAutoIou} 拿掉比較小的`, pairs: autoDupDone.map(d => ({ keep: d.keep, drop: d.drop })) });
    if (autoDupDone.length) tool('studio.mjs', 'note', pack, `自動處理（程式）：重複岩點 IoU ≥ ${POLICY.dupAutoIou} 的 ${autoDupDone.length} 對，拿掉比較小的那顆。`);
    // 代理畫的量體和它上面的岩點：準則第 5 條，不是重複，程式直接答 ok
    const vols = new Set(readJson(join(dir, 'added.json'), []).filter(a => a.kind === 'volume').map(a => a.id));
    const onVol = (await questionsOf(work, n)).filter(q => q.target.some(id => vols.has(id)));
    for (const q of onVol) tool('studio.mjs', 'answer', pack, q.id, 'ok', '--note', '代理畫的量體和量體上的岩點，不是重複（判斷準則第 5 條）');
    if (onVol.length) logLine(work, n, { step: 'auto-volume-ok', rule: '代理畫的量體和上面的岩點不是重複（準則第 5 條）', pairs: onVol.map(q => q.target) });
    if (onVol.length) out.push(`量體和上面的岩點 ${onVol.length} 對（程式判不是重複）`);
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

/** 放大圖（含照片像素座標的格線，代理照格線讀座標）：items＝[{ box, polys: [{ p, color, width, label }], title, twin }]。
 *  twin＝左邊只有照片、右邊疊外框（看外框時不會被線蓋住照片）。一張一個檔案 <outDir>/<名稱>.jpg */
async function renderZooms(chromium, pack, view, items, outDir, { max = [1100, 820], pad = 60, step = 0, name = (i) => String(i).padStart(2, '0') } = {}) {
  rmSync(outDir, { recursive: true, force: true }); mkdirSync(outDir, { recursive: true });
  if (!items.length) return;
  const jpg = readFileSync(join(pack, view.href)).toString('base64');
  const browser = await chromium.launch(), page = await browser.newPage();
  try {
    await page.setContent('<body></body>');
    const urls = await page.evaluate(async ({ items, jpg, w, h, max, pad, step }) => {
      const img = new Image(); await new Promise(r => { img.onload = r; img.src = 'data:image/jpeg;base64,' + jpg; });
      const nice = (s) => [10, 20, 25, 50, 100, 200, 500].find(v => v >= s) || 500;
      return items.map((it, n) => {
        const [x0, y0, x1, y1] = it.box, sx = Math.max(0, Math.floor(x0 - pad)), sy = Math.max(0, Math.floor(y0 - pad)), ex = Math.min(w, Math.ceil(x1 + pad)), ey = Math.min(h, Math.ceil(y1 + pad));
        const sw = ex - sx, sh = ey - sy, panes = it.twin ? 2 : 1, k = Math.min(max[0] / panes / sw, max[1] / sh), M = 46, G = 10, pw = sw * k;
        const cv = document.createElement('canvas'); cv.width = Math.round(M + panes * pw + (panes - 1) * G + 8); cv.height = Math.round(M + sh * k + 30);
        const g = cv.getContext('2d'); g.fillStyle = '#111'; g.fillRect(0, 0, cv.width, cv.height);
        const st = step || nice(Math.max(sw, sh) / 12);
        for (let p = 0; p < panes; p++) {
          const ox = M + p * (pw + G), X = (x) => ox + (x - sx) * k, Y = (y) => M + (y - sy) * k;
          g.drawImage(img, sx, sy, sw, sh, ox, M, pw, sh * k);
          g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,.4)'; g.fillStyle = '#fff'; g.font = '12px sans-serif';
          for (let x = Math.ceil(sx / st) * st; x <= ex; x += st) { g.beginPath(); g.moveTo(X(x), M); g.lineTo(X(x), M + sh * k); g.stroke(); g.fillText(String(x), X(x) - 12, M - 6); }
          for (let y = Math.ceil(sy / st) * st; y <= ey; y += st) { g.beginPath(); g.moveTo(ox, Y(y)); g.lineTo(ox + pw, Y(y)); g.stroke(); if (!p) g.fillText(String(y), 2, Y(y) + 4); }
          if (it.twin && !p) continue;
          g.save(); g.beginPath(); g.rect(ox, M, pw, sh * k); g.clip();
          for (const s of it.polys || []) {
            g.beginPath(); s.p.forEach(([x, y], j) => g[j ? 'lineTo' : 'moveTo'](X(x), Y(y))); g.closePath(); g.lineWidth = s.width || 2; g.strokeStyle = s.color; g.stroke();
            if (s.label != null) { const cx = s.p.reduce((a, q) => a + q[0], 0) / s.p.length, cy = s.p.reduce((a, q) => a + q[1], 0) / s.p.length; g.font = 'bold 15px sans-serif'; const t = String(s.label), tw = g.measureText(t).width; g.fillStyle = 'rgba(0,0,0,.75)'; g.fillRect(X(cx) - tw / 2 - 3, Y(cy) - 10, tw + 6, 19); g.fillStyle = s.color; g.fillText(t, X(cx) - tw / 2, Y(cy) + 5); }
          }
          g.restore();
        }
        g.fillStyle = '#fff'; g.font = '15px sans-serif'; g.fillText(`${it.tag ?? `#${n}`}　${it.title || ''}`, 6, cv.height - 9);
        return cv.toDataURL('image/jpeg', 0.9);
      });
    }, { items, jpg, w: view.w, h: view.h, max, pad, step });
    for (const [i, u] of urls.entries()) writeFileSync(join(outDir, `${name(i)}.jpg`), Buffer.from(u.split(',')[1], 'base64'));
  } finally { await browser.close(); }
}

const areaOf = (p) => { let s = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return Math.abs(s / 2); };
const boxOf = (p) => { const xs = p.map(q => q[0]), ys = p.map(q => q[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(Math.round); };
/** 現在還在的岩點外框 [{ id, p, area }]，和「量體」的面積門檻（中位數 × POLICY.volumeRatio） */
function livePolys(pack, view) {
  const doc = readJson(join(pack, `${view.id}.json`)), gone = new Set(doc.nodes.filter(n => n.props?.retired).map(n => n.id));
  const list = doc.marks.filter(m => !gone.has(m.node) && doc.nodes.some(n => n.id === m.node && n.type === 'hold')).map(m => { const p = m.geometry.coordinates[0].slice(0, -1); return { id: m.node, p, area: areaOf(p) }; });
  const sorted = list.map(x => x.area).sort((a, b) => a - b), med = sorted[sorted.length >> 1] || 1;
  return { list, volumeMin: med * POLICY.volumeRatio };
}
const tilesOf = (view) => { const [C, R] = POLICY.overviewTiles, out = []; for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) out.push({ tile: out.length + 1, box: [Math.round(c * view.w / C), Math.round(r * view.h / R), Math.round((c + 1) * view.w / C), Math.round((r + 1) * view.h / R)] }); return out; };

/** 全牆總覽：照片分成 3×2 格，疊上現在的外框（綠＝岩點、黃＝量體），格線是照片像素座標。每格回答：沒有完整外框的量體、完全漏掉的岩點、系統性的錯誤 */
async function renderOverview(chromium, pack, view, outDir) {
  const { list, volumeMin } = livePolys(pack, view), tiles = tilesOf(view);
  await renderZooms(chromium, pack, view, tiles.map(t => ({ box: t.box, tag: `第 ${t.tile} 格`, title: `綠＝岩點、黃＝大外框（面積 ≥ 中位數 ${POLICY.volumeRatio} 倍：量體或大岩點）；回答 volumes／missing／issues`, polys: list.map(x => x.area >= volumeMin ? { p: x.p, color: '#ffd21f', width: 3 } : { p: x.p, color: '#27e06b' }) })), outDir, { max: [1400, 960], pad: 0, step: 100, name: (i) => String(i + 1) });
  writeJson(join(outDir, 'tiles.json'), tiles);
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
const okBox = (b, view) => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) && b[0] >= 0 && b[1] >= 0 && b[2] <= view.w && b[3] <= view.h && b[2] - b[0] >= 4 && b[3] - b[1] >= 4;
const near = (a, b, gap = 30) => a[0] <= b[2] + gap && b[0] <= a[2] + gap && a[1] <= b[3] + gap && b[1] <= a[3] + gap;
/** 同一個量體報了兩次（重疊三成以上），或跨格被切成兩半（兩個框各貼著同一條格線）→ 合成一個框；相鄰的不同量體不合併 */
function mergeBoxes(boxes, view) {
  const [C, R] = POLICY.overviewTiles, xs = Array.from({ length: C - 1 }, (_, i) => (i + 1) * view.w / C), ys = Array.from({ length: R - 1 }, (_, i) => (i + 1) * view.h / R), E = 15;
  const ar = (b) => (b[2] - b[0]) * (b[3] - b[1]), inter = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const split = (a, b) => xs.some(x => ((Math.abs(a[2] - x) <= E && Math.abs(b[0] - x) <= E) || (Math.abs(b[2] - x) <= E && Math.abs(a[0] - x) <= E)) && Math.min(a[3], b[3]) > Math.max(a[1], b[1]))
    || ys.some(y => ((Math.abs(a[3] - y) <= E && Math.abs(b[1] - y) <= E) || (Math.abs(b[3] - y) <= E && Math.abs(a[1] - y) <= E)) && Math.min(a[2], b[2]) > Math.max(a[0], b[0]));
  const same = (a, b) => inter(a, b) / Math.min(ar(a), ar(b)) >= 0.3 || split(a, b);
  const out = [];
  for (const b of boxes) { let cur = [...b]; for (let i = out.length - 1; i >= 0; i--) if (same(out[i], cur)) { const o = out.splice(i, 1)[0]; cur = [Math.min(o[0], cur[0]), Math.min(o[1], cur[1]), Math.max(o[2], cur[2]), Math.max(o[3], cur[3])]; } out.push(cur); }
  return out;
}
const ellipse = ([x0, y0, x1, y1]) => Array.from({ length: 16 }, (_, i) => [Math.round(((x0 + x1) / 2 + (x1 - x0) / 2 * Math.cos(i * Math.PI / 8)) * 10) / 10, Math.round(((y0 + y1) / 2 + (y1 - y0) / 2 * Math.sin(i * Math.PI / 8)) * 10) / 10]);
const newId = () => Array.from({ length: 12 }, () => '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 36)]).join('');
const addAdded = (work, n, items) => writeJson(join(work, n, 'added.json'), [...readJson(join(work, n, 'added.json'), []), ...items]);

/** 總覽：每格一個回答。missing（完全沒有外框的岩點）→ 照外接框加一個橢圓外框，之後 shapecheck 再看；volumes（沒有完整外框的量體）→ shapes 放大畫外框 */
function applyOverview(work, n, list) {
  const pack = packOf(work, n), view = viewOf(pack), T = POLICY.overviewTiles[0] * POLICY.overviewTiles[1];
  if (existsSync(join(work, n, 'overview-decisions.json'))) fail(`${n}#overview：已經套用過（漏掉的岩點已經加上）；要重做先跑 check 重來`);
  if (!Array.isArray(list) || list.length !== T) fail(`${n}#overview：總覽有 ${T} 格，要每格一個回答（"ok" 或 { volumes, missing, issues }）`);
  const vols = [], miss = [], issues = [];
  list.forEach((x, i) => {
    if (x === 'ok') return;
    if (typeof x === 'string') { issues.push(`第 ${i + 1} 格：${x}`); return; }
    if (!x || typeof x !== 'object') fail(`${n}#overview 第 ${i + 1} 格：要 "ok" 或 { volumes, missing, issues }`);
    for (const k of ['volumes', 'missing']) for (const b of x[k] || []) { if (!okBox(b, view)) fail(`${n}#overview 第 ${i + 1} 格 ${k}：外接框要是照片內的 [x0,y0,x1,y1]：${JSON.stringify(b)}`); (k === 'volumes' ? vols : miss).push(b.map(Math.round)); }
    if (x.issues && x.issues !== 'ok') issues.push(`第 ${i + 1} 格：${x.issues}`);
  });
  const add = miss.map(b => ({ id: newId(), kind: 'hold', box: b, poly: ellipse(b) }));
  const err = applyOps(pack, join(work, n), add.map(a => ({ op: 'add', id: a.id, poly: a.poly }))); if (err) fail(`${n}#overview：加漏掉的岩點失敗：${err}`);
  addAdded(work, n, add.map(({ poly, ...a }) => a));
  const shapes = mergeBoxes(vols, view).map(box => ({ kind: 'volume', box }));
  writeJson(join(work, n, 'shapes.json'), shapes); rmSync(join(work, n, 'shape-decisions.json'), { force: true });
  writeJson(join(work, n, 'overview-decisions.json'), list);
  const line = `量體沒有完整外框 ${shapes.length} 個、漏掉的岩點 ${add.length} 顆（先加橢圓外框）${issues.length ? `；系統性問題：${issues.join('；')}` : ''}`;
  tool('studio.mjs', 'note', pack, `全牆總覽（代理，${T} 格逐格看）：${line}。`);
  console.log(`${n}#overview：${line}`);
}

/** 總覽回報的量體：出放大圖（左照片、右疊現在的外框，都有座標格線），代理照格線畫量體外框 */
async function shapesCmd() {
  const work = rest[0]; if (!work) fail('用法：node tools/wall-batch.mjs shapes <工作資料夾>');
  const chromium = chromiumOf();
  for (const n of wallsOf(work)) {
    const items = readJson(join(work, n, 'shapes.json'), []); if (!items.length) continue;
    const pack = packOf(work, n), view = viewOf(pack), { list, volumeMin } = livePolys(pack, view);
    await renderZooms(chromium, pack, view, items.map(s => ({ box: s.box, twin: true, title: '畫量體外框：照格線給頂點（照片像素）；左＝照片、右＝現在的外框（黃＝量體、綠＝岩點）', polys: list.filter(x => near(boxOf(x.p), s.box, 0)).map(x => ({ p: x.p, color: x.area >= volumeMin ? '#ffd21f' : '#27e06b' })) })), join(work, n, 'shape-sheets'), { max: [1600, 900], pad: Math.max(60, ...items.map(s => 0.3 * Math.max(s.box[2] - s.box[0], s.box[3] - s.box[1]))) });
    console.log(`${n}：量體 ${items.length} 個，放大圖在 ${join(work, n, 'shape-sheets')}（#號＝shapes.json 的順序）；判斷寫在 "${n}#shapes"：每個一個多邊形 [[x,y]…]，一張圖有好幾個量體就給多邊形的陣列，不是量體答 "skip:<理由>"`);
  }
}
const isPoly = (p) => Array.isArray(p) && p.length >= 3 && p.every(q => Array.isArray(q) && q.length === 2 && q.every(Number.isFinite));
function applyShapes(work, n, list) {
  const items = readJson(join(work, n, 'shapes.json'), []), pack = packOf(work, n), view = viewOf(pack);
  if (!Array.isArray(list) || list.length !== items.length) fail(`${n}#shapes：量體有 ${items.length} 個，判斷給了 ${list?.length} 個，要一個一個`);
  const add = []; let skip = 0;
  list.forEach((x, i) => {
    if (typeof x === 'string' && /^skip:.+/.test(x)) { skip++; return; }
    const polys = isPoly(x) ? [x] : Array.isArray(x) && x.length && x.every(isPoly) ? x : fail(`${n}#shapes #${i}：要多邊形 [[x,y]…]、多邊形的陣列，或 "skip:<理由>"`);
    for (const p of polys) { if (p.some(([x2, y2]) => x2 < 0 || y2 < 0 || x2 > view.w || y2 > view.h)) fail(`${n}#shapes #${i}：頂點超出照片`); add.push({ id: newId(), kind: 'volume', box: boxOf(p), poly: polyRound(p) }); }
  });
  const err = applyOps(pack, join(work, n), add.map(a => ({ op: 'add', id: a.id, poly: a.poly }))); if (err) fail(`${n}#shapes：加量體失敗：${err}`);
  addAdded(work, n, add.map(({ poly, ...a }) => a));
  writeJson(join(work, n, 'shape-decisions.json'), list);
  tool('studio.mjs', 'note', pack, `量體（代理）：總覽回報 ${items.length} 處，放大照格線畫外框：加 ${add.length} 個、不是量體 ${skip} 處。`);
  console.log(`${n}#shapes：加量體 ${add.length} 個、略過 ${skip} 處；下一步跑 shapecheck 疊上外框再看一次`);
}

/** 量體上的岩點：每個大外框（面積 ≥ 中位數 × POLICY.surfaceRatio）一張放大圖，黃＝這個大外框、綠＝上面已經有的外框；代理回報沒有外框的岩點 */
async function onvolumeCmd() {
  const work = rest[0]; if (!work) fail('用法：node tools/wall-batch.mjs onvolume <工作資料夾>');
  const chromium = chromiumOf();
  for (const n of wallsOf(work)) {
    const pack = packOf(work, n), view = viewOf(pack), { list } = livePolys(pack, view), sorted = list.map(x => x.area).sort((a, b) => a - b), med = sorted[sorted.length >> 1] || 1;
    const items = list.filter(x => x.area >= med * POLICY.surfaceRatio).map(x => ({ id: x.id, box: boxOf(x.p) }));
    writeJson(join(work, n, 'onvolume.json'), items); rmSync(join(work, n, 'onvolume-decisions.json'), { force: true });
    await renderZooms(chromium, pack, view, items.map(it => ({ box: it.box, twin: true, title: '量體上的岩點：黃＝這個大外框、綠＝已經有的外框；沒有自己外框的岩點回報外接框', polys: [...list.filter(x => x.id !== it.id && near(boxOf(x.p), it.box, 0)).map(x => ({ p: x.p, color: '#27e06b' })), { p: list.find(x => x.id === it.id).p, color: '#ffd21f', width: 3 }] })), join(work, n, 'onvolume-sheets'), { max: [1600, 900], pad: 30 });
    console.log(`${n}：大外框 ${items.length} 個，圖在 ${join(work, n, 'onvolume-sheets')}（#號＝onvolume.json 的順序）；判斷寫在 "${n}#onvolume"：每個一個陣列，沒有外框的岩點給外接框 [[x0,y0,x1,y1]…]，都有就 []`);
  }
}
function applyOnvolume(work, n, list) {
  const items = readJson(join(work, n, 'onvolume.json'), []), pack = packOf(work, n), view = viewOf(pack);
  if (!Array.isArray(list) || list.length !== items.length) fail(`${n}#onvolume：大外框有 ${items.length} 個，判斷給了 ${list?.length} 個，要一個一個（都有外框就 []）`);
  const boxes = [];
  list.forEach((x, i) => { if (!Array.isArray(x)) fail(`${n}#onvolume #${i}：要陣列（沒有就 []）`); for (const b of x) { if (!okBox(b, view)) fail(`${n}#onvolume #${i}：外接框要是照片內的 [x0,y0,x1,y1]：${JSON.stringify(b)}`); const r = b.map(Math.round); if (!boxes.some(o => near(o, r, 0) && Math.min(o[2], r[2]) - Math.max(o[0], r[0]) > 0.5 * Math.min(o[2] - o[0], r[2] - r[0]) && Math.min(o[3], r[3]) - Math.max(o[1], r[1]) > 0.5 * Math.min(o[3] - o[1], r[3] - r[1]))) boxes.push(r); } });   // 相鄰的大外框報到同一顆只加一次
  const add = boxes.map(b => ({ id: newId(), kind: 'hold', box: b, poly: ellipse(b) }));
  const err = applyOps(pack, join(work, n), add.map(a => ({ op: 'add', id: a.id, poly: a.poly }))); if (err) fail(`${n}#onvolume：加岩點失敗：${err}`);
  addAdded(work, n, add.map(({ poly, ...a }) => a));
  writeJson(join(work, n, 'onvolume-decisions.json'), list);
  tool('studio.mjs', 'note', pack, `量體上的岩點（代理）：大外框 ${items.length} 個逐一放大看，加了 ${add.length} 顆沒有外框的岩點（先加橢圓外框，再疊上去看一次）。`);
  console.log(`${n}#onvolume：大外框 ${items.length} 個，加 ${add.length} 顆；下一步跑 shapecheck 疊上外框再看一次`);
}

/** 新加的外框（量體、漏掉的岩點）疊上去再看一次：黃＝新加的、綠＝蓋在裡面的舊外框（有編號，量體的碎片可以拿掉）。只看還沒看過的（added.json 沒有 checked） */
async function shapecheckCmd() {
  const work = rest[0]; if (!work) fail('用法：node tools/wall-batch.mjs shapecheck <工作資料夾>');
  const chromium = chromiumOf();
  for (const n of wallsOf(work)) {
    const done = new Set(readJson(join(work, n, 'added.json'), []).filter(a => !uncheckedOf(join(work, n)).some(u => u.id === a.id)).map(a => a.id));   // 上一輪看過的先記成 checked，下面重寫 shapecheck.json 後才不會又算沒看過
    writeJson(join(work, n, 'added.json'), readJson(join(work, n, 'added.json'), []).map(a => done.has(a.id) ? { ...a, checked: true } : a));
    const added = uncheckedOf(join(work, n)); if (!added.length) continue;
    const pack = packOf(work, n), view = viewOf(pack), { list } = livePolys(pack, view), byId = new Map(list.map(x => [x.id, x])), items = [];
    for (const a of added) {
      const me = byId.get(a.id); if (!me) continue;
      const inner = list.filter(x => x.id !== a.id && (() => { const b = boxOf(x.p), c = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; return inPoly(c[0], c[1], me.p) || (a.kind === 'hold' && near(b, boxOf(me.p), 0)); })()).map(x => x.id);
      items.push({ id: a.id, kind: a.kind, inner });
    }
    writeJson(join(work, n, 'shapecheck.json'), items); rmSync(join(work, n, 'shapecheck-decisions.json'), { force: true });
    await renderZooms(chromium, pack, view, items.map(it => ({ box: boxOf(byId.get(it.id).p), twin: true, title: `${it.kind === 'volume' ? '新加的量體' : '新加的岩點（橢圓）'}：黃＝新外框、綠＝裡面的舊外框（編號）`, polys: [...it.inner.map((id, j) => ({ p: byId.get(id).p, color: '#27e06b', label: j + 1 })), { p: byId.get(it.id).p, color: '#ffd21f', width: 3 }] })), join(work, n, 'shapecheck-sheets'), { max: [1600, 900], pad: 40 });
    console.log(`${n}：新加的外框 ${items.length} 個，圖在 ${join(work, n, 'shapecheck-sheets')}；判斷寫在 "${n}#shapecheck"：對了 "ok"；要改 { "poly": [[x,y]…] }；裡面的舊外框是量體碎片或重複 { "remove": [編號…] }；不是岩點 { "delete": true }`);
  }
}
function applyShapecheck(work, n, list) {
  const items = readJson(join(work, n, 'shapecheck.json'), []), pack = packOf(work, n), ops = [], count = { ok: 0, poly: 0, remove: 0, delete: 0 };
  if (!Array.isArray(list) || list.length !== items.length) fail(`${n}#shapecheck：要看的有 ${items.length} 個，判斷給了 ${list?.length} 個，要一個一個`);
  list.forEach((x, i) => {
    const it = items[i];
    if (x === 'ok') { count.ok++; return; }
    if (!x || typeof x !== 'object') fail(`${n}#shapecheck #${i}：要 "ok" 或 { poly, remove, delete }`);
    if (x.delete) { ops.push({ op: 'remove', holds: [it.id] }); count.delete++; return; }
    if (x.poly) { if (!isPoly(x.poly)) fail(`${n}#shapecheck #${i}：poly 要是 [[x,y]…]`); ops.push({ op: 'set', id: it.id, poly: polyRound(x.poly) }); count.poly++; }
    for (const k of x.remove || []) { const id = it.inner[k - 1]; if (!id) fail(`${n}#shapecheck #${i}：沒有編號 ${k}`); ops.push({ op: 'remove', holds: [id] }); count.remove++; }
  });
  const err = applyOps(pack, join(work, n), ops); if (err) fail(`${n}#shapecheck：套用失敗：${err}`);
  writeJson(join(work, n, 'shapecheck-decisions.json'), list);
  const seen = new Set(items.map(it => it.id)); writeJson(join(work, n, 'added.json'), readJson(join(work, n, 'added.json'), []).map(a => seen.has(a.id) ? { ...a, checked: true } : a));
  const line = `對 ${count.ok}、改外框 ${count.poly}、拿掉裡面的碎片或重複 ${count.remove}、不是岩點 ${count.delete}`;
  tool('studio.mjs', 'note', pack, `新加的外框再看一次（代理）：${items.length} 個：${line}。`);
  console.log(`${n}#shapecheck：${line}`);
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
    if (d === 'delete' || d === 'unsure') left.push(id);   // 要刪的也先不刪：放大再看一次、說出理由才刪（誤刪真岩點是 AI 檢查最大的錯）
  });
  addRecheck(work, n, left.map(id => ({ kind: 'sam', id })));
  if (ops.length) { const pf = join(work, n, `patch-sam-${Date.now()}.json`); writeJson(pf, ops); const ap = tool('wall.mjs', 'apply', pack, pf); rmSync(pf, { force: true }); if (ap.status !== 0) console.log(`${n}#sam：apply 失敗：${(ap.stderr || ap.stdout).slice(0, 200)}`); }
  writeJson(join(work, n, 'sam-left.json'), left); writeJson(join(work, n, 'sam-decisions.json'), list);
  const line = `採用 SAM2 ${count.sam}、保留原外框 ${count.keep}、要刪（放大再確認）${count.delete}、看不準（放大再看）${count.unsure}、已被拿掉 ${count.handled}`;
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
  const FN = { sam: applySam, recheck: applyRecheck, audit: applyAudit, overview: applyOverview, shapes: applyShapes, shapecheck: applyShapecheck, onvolume: applyOnvolume };
  for (const key of Object.keys(all)) {
    const [n, step = 'dup'] = key.split('#');
    if (!existsSync(join(work, n, 'run.json'))) fail(`${key}：沒有這面牆（${join(work, n)}）`);
    if (step !== 'dup' && !FN[step]) fail(`${key}：不認得 #${step}`);
    logged(work, n, step, all[key], () => step === 'dup' ? applyDup(work, n, all[key]) : FN[step](work, n, all[key]));
  }
}

/** 研究記錄：每一步的題目（照片座標、岩點 id）和代理的判斷、這一步新加的外框，按時間記進 <牆>/ai-log.jsonl；發佈時整份進 edits.json */
const AGENT = process.env.CLIMBIO_AGENT || 'agent:claude';
const STEP_ITEMS = { dup: 'questions.json', sam: 'sam-questions.json', recheck: 'recheck.json', audit: 'audit.json', overview: 'overview/tiles.json', shapes: 'shapes.json', shapecheck: 'shapecheck.json', onvolume: 'onvolume.json' };
const logLine = (work, n, o) => appendFileSync(join(work, n, 'ai-log.jsonl'), JSON.stringify({ at: new Date().toISOString(), agent: AGENT, ...o }) + '\n');
function logged(work, n, step, decisions, fn) {
  const items = readJson(join(work, n, STEP_ITEMS[step]), []), before = readJson(join(work, n, 'added.json'), []).length;
  fn();
  const added = readJson(join(work, n, 'added.json'), []).slice(before);
  logLine(work, n, { step, items, decisions, ...(added.length ? { added } : {}) });
}

function applyDup(work, n, list) {
  {
    const all = { [n]: list };
    const qs = readJson(join(work, n, 'questions.json')); if (!qs) { console.log(`${n}：沒有 questions.json，先跑 check`); return; }
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
    console.log(`${n}：要再看一次 ${cells.length} 件${cells.length ? `，大圖在 ${join(work, n, 'recheck-sheets')}（#號對應 recheck.json 的順序）；判斷寫在 "${n}#recheck"，sam 類答 sam|keep|delete:<理由>（${POLICY.deleteReasons.join('／')}），重複岩點類答 ok|rm1|rm2|merge，不能答 unsure` : ''}`);
  }
}
function applyRecheck(work, n, list) {
  const items = readJson(join(work, n, 'recheck.json'), []); if (list.length !== items.length) fail(`${n}#recheck：要再看的有 ${items.length} 件，判斷給了 ${list.length} 個，要一個一個`);
  const pack = packOf(work, n), view = viewOf(pack), count = {}, ops = [], deleted = [], info = new Map(readJson(join(work, n, 'sam.json'), []).map(h => [h.id, h]));
  items.forEach((it, i) => {
    const d = list[i];
    if (d === 'unsure') fail(`${n}#recheck #${i}：這一輪不能再答 unsure：放大看過了就要定案；真的分不出來，保留原樣（sam 類答 keep、重複岩點答 ok）`);
    if (it.kind === 'sam') {
      const why = reasonOf(d);
      if (!['sam', 'keep'].includes(d) && !why) fail(`${n}#recheck #${i}：sam 類要答 sam|keep|delete:<理由>（理由是 ${POLICY.deleteReasons.join('／')} 其中一個；說不出理由就是岩點，答 keep 或 sam）`);
      if (d === 'sam') ops.push({ op: 'set', id: it.id, poly: polyRound(info.get(it.id).sam) });
      if (why) { ops.push({ op: 'remove', holds: [it.id] }); deleted.push({ id: it.id, reason: why }); }
      const k = why ? 'delete' : d; count['sam:' + k] = (count['sam:' + k] || 0) + 1;
    } else {
      if (!['ok', 'rm1', 'rm2', 'merge'].includes(d)) fail(`${n}#recheck #${i}：重複岩點要答 ok|rm1|rm2|merge`);
      const r = decideOne(pack, view, { id: it.qid, target: it.target }, d); count['dup:' + r] = (count['dup:' + r] || 0) + 1;
    }
  });
  const err = applyOps(pack, join(work, n), ops); if (err) console.log(`${n}#recheck：apply 失敗：${err}`);
  writeJson(join(work, n, 'recheck-decisions.json'), list); writeJson(join(work, n, 'sam-left.json'), []); writeJson(join(work, n, 'deleted.json'), deleted);
  const line = Object.entries(count).map(([k, v]) => `${k} ${v}`).join('、');
  tool('studio.mjs', 'note', pack, `放大再看一次（代理）：看不準的 ${items.length} 件，放大、含周圍重新看圖後定案：${line}`);
  console.log(`${n}#recheck：${line}`);
}

// ---------- next（下一步是什麼：所有代理照這個做，不用自己讀文件決定）----------
/** 新加、還沒疊上去再看過的外框（舊的工作資料夾沒有 checked：在 shapecheck.json 又有判斷的算看過） */
function uncheckedOf(dir) {
  const sc = existsSync(join(dir, 'shapecheck-decisions.json')) ? new Set(readJson(join(dir, 'shapecheck.json'), []).map(it => it.id)) : new Set();
  return readJson(join(dir, 'added.json'), []).filter(a => !a.checked && !sc.has(a.id));
}
/** 這面牆 AI 檢查還缺哪些判斷（空陣列＝AI 都做完了，可以整理給人） */
function nextTodo(work, n) {
  const dir = join(work, n), need = [];
  if (!existsSync(join(dir, 'questions.json'))) return ['還沒跑 check'];
  const count = (f) => (readJson(join(dir, f), []) || []).length, has = (f) => !!readJson(join(dir, f), null);
  if (count('questions.json') && !has('decisions.json')) need.push(`重複岩點 ${count('questions.json')} 題（sheets/）`);
  if (count('sam-questions.json') && !has('sam-decisions.json')) need.push(`SAM2 要看的 ${count('sam-questions.json')} 顆（sam-sheets/）`);
  if (count('audit.json') && !has('audit-decisions.json')) need.push(`抽查 ${count('audit.json')} 個（audit-sheets/）`);
  if (!has('overview-decisions.json')) need.push(`全牆總覽 ${POLICY.overviewTiles[0] * POLICY.overviewTiles[1]} 格（overview/，每格一個回答："ok" 或 { volumes, missing, issues }）`);
  if (count('recheck.json') && !has('recheck-decisions.json')) need.push(existsSync(join(dir, 'recheck-sheets')) ? `放大再看 ${count('recheck.json')} 件（recheck-sheets/），判斷寫 "${n}#recheck"，不能再答 unsure，刪除要寫 delete:<理由>` : `看不準和要刪的 ${count('recheck.json')} 件要放大再看：先跑 node tools/wall-batch.mjs recheck ${work}`);
  if (need.length) return need;
  if (count('shapes.json') && !has('shape-decisions.json')) return [existsSync(join(dir, 'shape-sheets')) ? `畫量體外框 ${count('shapes.json')} 個（shape-sheets/），判斷寫 "${n}#shapes"` : `總覽回報 ${count('shapes.json')} 個量體沒有完整外框：先跑 node tools/wall-batch.mjs shapes ${work}`];
  const fresh = uncheckedOf(dir), sc = readJson(join(dir, 'shapecheck.json'), []);
  if (fresh.length) return [existsSync(join(dir, 'shapecheck-sheets')) && sc.length && !has('shapecheck-decisions.json') && sc.every(it => fresh.some(a => a.id === it.id)) ? `新加的外框再看一次 ${sc.length} 個（shapecheck-sheets/），判斷寫 "${n}#shapecheck"` : `新加了 ${fresh.length} 個外框（量體、漏掉的岩點）：先跑 node tools/wall-batch.mjs shapecheck ${work}`];
  if (!has('onvolume-decisions.json')) return [existsSync(join(dir, 'onvolume-sheets')) && has('onvolume.json') ? `量體上的岩點 ${count('onvolume.json')} 個大外框（onvolume-sheets/），判斷寫 "${n}#onvolume"` : `量體、大岩點上的岩點要逐一放大找：先跑 node tools/wall-batch.mjs onvolume ${work}`];
  const open = questionsOfSync(work, n).length; if (open) need.push(`採用新外框、修岩點之後又出現 ${open} 題重複岩點：重跑 check（只重算重複岩點）`);
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
    const run = todo.flatMap(([, t]) => t).find(x => /先跑 node|重跑 check|還沒跑 check/.test(x));
    console.log('下一步：先跑要出圖的指令；圖出好的，逐張看圖判斷，把全部牆的判斷寫進同一個 JSON，一次 apply：');
    for (const [n, t] of todo) console.log(`- ${n}：${t.join('；')}\n    資料夾 ${join(work, n)}`);
    console.log(`判斷檔格式：{ "<牆>": ["ok|rm1|rm2|merge|unsure"…，照 questions.json], "<牆>#sam": ["sam|keep|delete|unsure"…，照 sam-questions.json], "<牆>#audit": ["ok|bad"…，照 audit.json],
  "<牆>#overview": [每格 "ok" 或 { "volumes": [[x0,y0,x1,y1]…], "missing": [[x0,y0,x1,y1]…], "issues": "…" }], "<牆>#recheck": ["sam|keep|delete:<理由> 或 ok|rm1|rm2|merge"…],
  "<牆>#shapes": [多邊形 [[x,y]…] 或多邊形的陣列 或 "skip:<理由>"], "<牆>#shapecheck": ["ok" 或 { "poly": […], "remove": [編號…], "delete": true }], "<牆>#onvolume": [每個大外框一個陣列：沒有外框的岩點 [[x0,y0,x1,y1]…]，都有就 []] }`);
    console.log(RUBRIC.join('\n'));
    console.log('圖很多時，可以把不同牆、不同張數分給子代理各看一部分（子代理也要拿到上面的判斷準則），最後合併成一個 JSON。不用問使用者；看不準的寫 unsure，會放大再看。');
    console.log(run ? '（有要先出圖的，先跑那個指令，再跑 next）' : `寫好後：node tools/wall-batch.mjs apply ${work} <判斷.json>`); return;
  }
  const gate = verifyAll(work, { quiet: true });
  if (gate.fail.length) { console.log(`下一步：完成閘門沒過：\n${gate.fail.map(x => `- ${x}`).join('\n')}`); return; }
  const rv = join(work, 'review', 'review.json');
  if (!existsSync(rv)) { console.log(`下一步：node tools/wall-batch.mjs review ${work}`); return; }
  const r = readJson(rv), left = r.items.length;
  console.log(left ? `下一步：把 ${join(work, 'review', 'index.html')} 發成 Artifact 給使用者（${left} 件要人判斷）；使用者回覆後逐項 resolve，再重跑 review 確認。` : `全部做完，完成閘門通過，沒有要人判斷的。交付時照 node tools/wall-batch.mjs verify ${work} 印的數字回報（每面牆也在 <牆>/result.json）。`);
}

// ---------- verify（完成的閘門：所有代理同一個「做完」的標準）----------
/** 每面牆：照片跑完、每一步的判斷都套用了、看不準和要刪的都放大定案、總覽每格都答了、新加的外框都再看過、沒有新冒出來的重複岩點。
 *  通過的寫 <牆>/result.json（交付回報的數字只從這裡抄）。回傳 { pass: [牆], fail: [原因] } */
function verifyAll(work, { quiet = false } = {}) {
  const pass = [], fail2 = [], T = POLICY.overviewTiles[0] * POLICY.overviewTiles[1];
  for (const n of wallsOf(work)) {
    const r = readJson(join(work, n, 'run.json')), dir = join(work, n), why = [];
    if (r.state !== 'done') { fail2.push(`${n}：照片沒跑完（${r.state}${r.errors?.length ? `：${r.errors.at(-1)}` : ''}）`); continue; }
    why.push(...nextTodo(work, n));
    const ov = readJson(join(dir, 'overview-decisions.json'), null); if (ov && ov.length !== T) why.push(`總覽只答了 ${ov.length}／${T} 格`);
    const rc = readJson(join(dir, 'recheck-decisions.json'), null); if (rc && rc.includes('unsure')) why.push('放大再看的還有 unsure');
    if (why.length) { fail2.push(`${n}：${why.join('；')}`); continue; }
    const pack = packOf(work, n), view = viewOf(pack), { list, volumeMin } = livePolys(pack, view), added = readJson(join(dir, 'added.json'), []), liveSet = new Set(list.map(x => x.id));
    const tally = (f) => (readJson(join(dir, f), []) || []).reduce((o, d) => { const k = typeof d === 'string' ? d.replace(/:.*/, '') : 'edit'; o[k] = (o[k] || 0) + 1; return o; }, {});
    const deleted = readJson(join(dir, 'deleted.json'), []).reduce((o, d) => { o[d.reason] = (o[d.reason] || 0) + 1; return o; }, {});
    const audit = readJson(join(dir, 'audit-result.json'), null);
    const res = {
      wall: n, holds: list.filter(x => x.area < volumeMin).length, volumes: list.filter(x => x.area >= volumeMin).length,
      added: { holds: added.filter(a => a.kind === 'hold' && liveSet.has(a.id)).length, volumes: added.filter(a => a.kind === 'volume' && liveSet.has(a.id)).length },
      deleted, dup: tally('decisions.json'), sam: tally('sam-decisions.json'), recheck: tally('recheck-decisions.json'), shapecheck: tally('shapecheck-decisions.json'),
      audit, auditWarn: !!(audit && audit.rate > 0.25), overview: (ov || []).flatMap((x, i) => typeof x === 'string' ? (x === 'ok' ? [] : [`第 ${i + 1} 格：${x}`]) : x.issues && x.issues !== 'ok' ? [`第 ${i + 1} 格：${x.issues}`] : []),
      policy: { volumeRatio: POLICY.volumeRatio, dupAutoIou: POLICY.dupAutoIou, samReviewFlags: POLICY.samReviewFlags },
    };
    writeJson(join(dir, 'result.json'), res);
    const recErr = writeRecord(work, n, res, pack, view); if (recErr) { fail2.push(`${n}：研究記錄寫不出來：${recErr}`); continue; }
    pass.push(n);
    if (!quiet) console.log(`${n}：通過。岩點 ${res.holds}、量體 ${res.volumes}（AI 補畫：岩點 ${res.added.holds}、量體 ${res.added.volumes}）；刪除 ${Object.entries(deleted).map(([k, v]) => `${k} ${v}`).join('、') || '0'}；抽查 ${audit ? `${audit.total} 個錯 ${audit.bad} 個${res.auditWarn ? '（⚠ 超過 25%，交付時要說）' : ''}` : '無'}${res.overview.length ? `；總覽：${res.overview.join('；')}` : ''}`);
  }
  if (!quiet) { for (const f of fail2) console.log(`沒過：${f}`); console.log(fail2.length ? `完成閘門：${fail2.length} 面牆沒過（先跑 next 照它做）` : `完成閘門：${pass.length} 面牆全部通過`); }
  return { pass, fail: fail2 };
}
/** 研究記錄 <牆 id>.edits.json（發佈時跟照片一起進開放資料集）：跟 Studio 的同一套欄位（record.js：base、deleted、reshaped、added、flagged、sam），
 *  加上代理流程的完整過程 ai：判斷準則全文與雜湊、POLICY、每顆 SAM2 的外框、ai-log.jsonl 的每一步（題目、判斷、新加的外框）、result.json。
 *  verify 通過＝檢查完了（reviewed: true，reviews 記 AI）；人另外檢查過用 reviewed 指令加一筆，可做可不做 */
function writeRecord(work, n, res, pack, view) {
  const dir = join(work, n), auto = readJson(join(dir, 'auto.json'), null);
  if (!auto) return '沒有 auto.json（舊版 run 做的牆沒存自動結果，重跑 run）';
  const { buildRecord } = require('../studio/wall/record.js');
  const log = (existsSync(join(dir, 'ai-log.jsonl')) ? readFileSync(join(dir, 'ai-log.jsonl'), 'utf8') : '').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const pick = new Map();
  for (const e of log) {
    if (e.step === 'auto-sam') for (const id of e.ids) pick.set(id, 'auto');
    if (e.step === 'sam' || e.step === 'recheck') e.items.forEach((it, i) => { const d = e.decisions[i]; if ((e.step === 'sam' || it.kind === 'sam') && (d === 'sam' || d === 'keep')) pick.set(it.id, d); });
  }
  const { list } = livePolys(pack, view), holds = list.map(x => ({ id: x.id, poly: x.p, ...(auto.sam[x.id] ? { sam: { ...auto.sam[x.id], pick: pick.get(x.id) || auto.sam[x.id].pick || '' } } : {}) }));
  const doc = readJson(join(pack, `${view.id}.json`)), prev = readJson(join(pack, `${view.id}.edits.json`), null), at = new Date().toISOString();
  const rec = buildRecord({ id: view.id, sha256: auto.sha256, license: doc.license || 'CC-BY-SA-4.0', reviewed: true, tools: auto.tools, base: auto.base, holds, w: view.w, h: view.h });
  if (!rec) return 'auto.json 沒有自動偵測的外框（base）';
  const humans = (prev?.reviews || []).filter(r => String(r.by).startsWith('human:'));
  rec.reviews = [{ by: AGENT, kind: 'ai-verify', at }, ...humans];
  rec.ai = { version: 1, agent: AGENT, verified: true, at, rubric: { sha256: createHash('sha256').update(RUBRIC.join('\n')).digest('hex').slice(0, 16), text: RUBRIC }, policy: POLICY, sam2: auto.sam, log, result: res };
  writeJson(join(pack, `${view.id}.edits.json`), rec);
  return '';
}
/** 人檢查過（可做可不做）：記一筆在研究記錄的 reviews，不改岩點 */
function reviewedCmd() {
  const [work, n] = rest, by = flag('--by'), said = flag('--said');
  if (!work || !n || !by.startsWith('human:') || !said) fail('用法：node tools/wall-batch.mjs reviewed <工作資料夾> <牆> --by human:<名稱> --said "<人說檢查完了的原話>"');
  const pack = packOf(work, n), view = viewOf(pack), f = join(pack, `${view.id}.edits.json`), rec = readJson(f, null);
  if (!rec) fail(`${n}：還沒有研究記錄，先跑 verify`);
  rec.reviews = [...(rec.reviews || []), { by, kind: 'human', at: new Date().toISOString(), said }]; writeJson(f, rec);
  console.log(`${n}：記下 ${by} 檢查過`);
}
function verify() { const work = rest[0]; if (!work) fail('用法：node tools/wall-batch.mjs verify <工作資料夾>'); if (verifyAll(work).fail.length) process.exitCode = 1; }

// ---------- review（一次整理成要人判斷的清單）----------
async function review() {
  const work = rest[0]; if (!work) fail('用法：node tools/wall-batch.mjs review <工作資料夾>');
  const chromium = chromiumOf(), items = [], walls = [];
  verifyAll(work, { quiet: true });   // 寫 result.json；沒過閘門的牆下面 nextTodo 會擋
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
    walls.push({ wall: n, state: 'done', holds: r.final.holds, afterAi: hs.replace(/^.*（.*?，\d+×\d+）：/, '').trim(), sam: r.sam, samReviewed: (readJson(join(work, n, 'sam-questions.json'), []) || []).length, samLeft: samLeft.length, samAuto: r.samLeft - ((readJson(join(work, n, 'sam-questions.json'), []) || []).length), audit: readJson(join(work, n, 'audit-result.json'), null), overview: readJson(join(work, n, 'result.json'), {}).overview || [], aiLeft: qs.length + samLeft.length, publish: pub ? { id: pub.id, title: pub.title } : null });
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

const table = { run, check, recheck, shapes: shapesCmd, shapecheck: shapecheckCmd, onvolume: onvolumeCmd, apply, verify, reviewed: reviewedCmd, review, status, next, resolve: resolveOne };
if (!table[cmd]) fail('用法：node tools/wall-batch.mjs next|run|check|recheck|shapes|shapecheck|apply|verify|review|resolve|status …（不知道做什麼先跑 next；說明在檔案開頭）');
await table[cmd]();
