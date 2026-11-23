#!/usr/bin/env node
// Climbio Studio 的命令列：AI 代理把工作做到只剩要人判斷的地方，進度、題目、判斷、交接筆記都寫在專案資料夾的 .studio/work/，
// 換一個代理跑 status 就能接著做。格式與流程見 docs/studio-work.md；題目怎麼算在 studio/work/ledger.js（命令列、同步服務共用）。
// 預設全部在本機：人在 AI 對話（Claude、ChatGPT…）裡答題，代理用 answer --by human:<名稱> --said "<原話>" 記下；同步服務只給要跨機器的人用。
//
//   node tools/studio.mjs start <gym|crag|book|3d> <資料夾> [輸入…]    新任務的統一入口：看資料夾做到哪，印下一步與完成標準（入口頁「交給 AI」的四句話都從這裡開始）
//   node tools/studio.mjs status <專案> [--json]                       做到哪、還剩幾題、下一步、最後一段交接筆記
//   node tools/studio.mjs ask <專案> [--json] [--all] [--human]         還沒答的題目（--all 連答過的，--human 只列等人答的、附證據照片的路徑，給代理貼到對話裡）；人說要改的會寫出怎麼改
//   node tools/studio.mjs answer <專案> <題目 id> <accept|reject|edit|ok|fix> [--patch patch.json] [--note 文字] [--by human:<名稱> --said "<人的原話>"]
//       代理替人記下對話裡的判斷：--by human:<名稱> 加 --said（人在對話裡答的原話）；不是在終端機自己打的 human 判斷沒有 --said 就不收
//   node tools/studio.mjs note <專案> <文字>                            追加交接筆記
//   node tools/studio.mjs convert <專案> read <路線書…>                 路線書 → .studio/source/ 的大綱與圖
//   node tools/studio.mjs convert <專案> build [原圖…] [--position 緯度,經度]   大綱 → 專案資料夾裡的公開格式 v2 包
//   node tools/studio.mjs apply <專案> <patch.json>                     局部修正成品（格式同 tools/guidebook.mjs apply）
//
// 同步服務（選配，要跨機器才需要；自己的 Firebase 上的雲端函式 studioSync，見 docs/studio-work.md 的「同步」）：金鑰放環境變數 CLIMBIO_STUDIO_KEY（不寫進資料夾；雲端環境改用 Network secret，由環境的代理加上標頭），
// 服務網址可以放 CLIMBIO_STUDIO_URL（雲端環境設一次，下面的 <服務網址> 就可以省略）：
//   node tools/studio.mjs doctor                                        這個環境能不能一起工作：Node、金鑰、連得到服務、建書要的 Chromium
//   node tools/studio.mjs link <專案> <服務網址>                        這個專案接上同步服務（要跨機器交接才需要）
//   node tools/studio.mjs push <專案>                                   檔案（改過的）和工作紀錄推上去；服務上有別人推過的新版本就擋下（先 pull），不蓋掉別人的
//   node tools/studio.mjs pull <專案> [--from [<服務網址>]#<專案 id>] [--theirs]
//                                                                       拉下判斷、筆記和檔案，套用別台記下的人的修正（fix 帶的 patch）；空資料夾加 --from 就是接手別人的專案。
//                                                                       本機改過、服務上也被改的檔案不蓋（列出衝突），--theirs 用服務上的
//   node tools/studio.mjs projects <服務網址> [--json]                  服務上的專案
//
// 3D 重建的照片位置收進 Studio：
//   node tools/studio.mjs frames <資料夾> <frames.json> --model <模型.spz> --images <照片資料夾> --name <名稱> [--attribution 署名]
//       frames.json（每張 position、quaternion rub、intrinsics）→ 公開格式 v2 的 Guidebook 包：模型畫面＋每張照片記著模型上的鏡頭（props.model）；
//       在 Studio 的 Crag「匯入岩場站」收進來，區域圖的 3D 鈕打開 3D 場景
//
// 牆的分享包（index.json 的 type 是 walls）也是一個專案：status、ask 列出可能重複的岩點，代理用 tools/wall.mjs（或 apply）修。
//
// 3D 牆的工作資料夾（wall.json 是 climbio-3d-wall/1，3D 重建流程的輸出）也是一個專案：status、push、pull 照常，大檔分段傳；
// 要發佈的每顆岩點都要 AI 看過（studio/wall3d/review.js，紀錄在 review3d.json），跟人在 Studio 逐顆修同一個標準；看完才出發佈題（照片明顯不夠的合併成一題問人要不要補拍）：
//   node tools/studio.mjs look3d <資料夾> [--all] [--glow|--wide] [--ids 清單.json] [--studio 網址]     無畫面瀏覽器開 Studio 的 3D 牆，還沒看過的岩點一顆一張（左原樣、右加外框），
//                                                                       每 12 張拼成一張總圖（.studio/work/look/sheet-*.jpg，左上角是編號），印出路徑
//   node tools/studio.mjs review3d <資料夾> <判斷.json>               記下 AI 的判斷：[{ "n": 總圖上的編號（或 "id": 岩點 id）, "v": "keep|off|reshape|retake",
//                                                                       "poly": [[x, y]…]（reshape：右半張的像素 0～256；加 "k": true 只改跟牆的交界，不動別顆岩點，照顏色邊界自動貼的用這個）；"v": "add" 配 "fb": 回報 id 在回報畫面描漏掉的岩點, "note": "…"（retake 必填：哪裡的照片不夠） }]
// AI 看完之後、發佈之前要人試用（studio/wall3d/feedback.js，紀錄在 feedback3d.json）：人在 Studio 3D 牆的「試用」步驟點有問題的地方寫一句回報，
// 代理修完記下怎麼處理，人再試用；這一版人按過「試用完」（或在對話裡說試用過沒問題）才出發佈題：
//   look3d 也出還沒處理的回報當時的畫面（.studio/work/look/fb-<回報 id>.jpg，回報的岩點畫上外框、點的位置畫圈）
//   node tools/studio.mjs check3d <資料夾> <model|path>   AI 檢查的前兩階段（岩點之前先看牆）：model 整面牆與牆腳、牆頂、兩端近看；path 沿牆鏡頭由右走到左的畫面（.studio/work/check/）
//   node tools/studio.mjs resolve3d <資料夾> <回報 id> --note "怎麼處理"   代理處理完一筆回報（修岩點照樣用 look3d、review3d；回報 id 在 ask 的題目裡）
//   node tools/studio.mjs try3d <資料夾> [--port 8790] [--days 7] [--site 網址]
//                                                                       一鍵試用，印出連結，點了直接到試用步驟：
//                                                                       接了同步服務的專案先推上去、發試用權杖，連結在手機、別台電腦都能開（--site 的 Studio），回報寫回同步服務，pull 拿回來；
//                                                                       沒接的在本機（127.0.0.1）開伺服器放 Studio 和這個資料夾，回報、試用完、存檔直接寫回資料夾（Ctrl-C 結束）
//   node tools/studio.mjs fetch3d <資料夾> <公開版本 id> [--site 網址]   從已發佈的版本（/p/<id>/ 的基底加 patch）建工作資料夾，接著精修、再發佈
//
// 發佈（公開、收不回）：成品建好、其他題都答完，會出一題「要不要公開發佈」，只能由人在 AI 對話裡答；核准綁在這一版的內容上，改了要重新核准。
//   node tools/studio.mjs publish <牆的分享包>                          人核准過這一版才發：放進開放資料集，是同一個包的新版本；
//                                                                       用同步金鑰（CLIMBIO_STUDIO_KEY）代替 App Check，發佈服務網址可放 CLIMBIO_PUBLISH_URL
//   node tools/studio.mjs publish <3D 牆的工作資料夾> [--gym 岩館] [--origin <上一版 id>] [--studio 網址]
//                                                                       無畫面 Chromium 開 Studio 的 3D 牆（帶同步金鑰代替 App Check）烘焙成成品、發佈，印出岩點貓的連結；
//                                                                       岩館名來自 wall.json 的 gym 或 --gym（原始資料，不推測）；上一版預設是這個專案記的最後一次 fetch3d／publish
//   node tools/studio.mjs approved <專案>                               這一版有沒有人核准發佈（給 tools/guidebook.mjs publish 查）；有的話結束碼 0
//
// 每個指令都可以加 --by agent:<名稱>（或環境變數 CLIMBIO_AGENT）記下是誰做的；人答題用 --by human:<名稱>。
// AI 優先：題目由代理判斷到底（看證據照片），看不準也自己判斷、不交給人；人只在發佈時確認（位置來自原始資料，也只能由人給）。
// 唯一例外是原始資料明顯不夠：代理答 retake（note 寫哪裡不夠），在對話裡問人要不要補拍、補資料。
import './studio-i18n.mjs';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, readdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { join, resolve, relative, dirname, sep, extname } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { SYNC_URL, studioAuth } from './studio-auth.mjs';
import { applyPatch as applyWall3dPatch } from '../studio/wall3d/patch.js';
import { WORK_DIR, HUMAN_ONLY, questionsFromReport, publishQuestion, approval, refresh, isOpen, waitingFor, decide, stateOf, summary, merge, recordId, pendingPatches, hash } from '../studio/work/ledger.js';
import { reasonText } from '../studio/crag/report.js';
import { createService } from '../studio/service.js';
import { cameraFromFrame, modelCamera } from '../studio/scene/cameras.js';
import { copyFileSync } from 'node:fs';

// 雲端環境的網路走 HTTPS_PROXY（Network secret 的金鑰也是代理加的），Node 內建的 fetch 預設不讀它：設了代理就帶 NODE_USE_ENV_PROXY=1 重跑自己
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  process.exit(r.status ?? 1);
}

const RefineGeo = createRequire(import.meta.url)('../studio/wall/geometry.js');
const Wall3dReview = createRequire(import.meta.url)('../studio/wall3d/review.js');
const Wall3dFeedback = createRequire(import.meta.url)('../studio/wall3d/feedback.js');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GUIDEBOOK = join(ROOT, 'tools', 'guidebook.mjs');
const VERSION = readFileSync(join(ROOT, 'version.js'), 'utf8').match(/CLIMBIO_VERSION = '([^']+)'/)?.[1] || '';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const has = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const fail = (msg, code = 2) => { console.error(msg); process.exit(code); };
const readJson = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d);
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 1) + '\n');
const readLines = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const writeLines = (p, list) => writeFileSync(p, list.map(x => JSON.stringify(x) + '\n').join(''));
const now = () => new Date().toISOString();

const json = has('--json'), all = has('--all'), theirs = has('--theirs'), humanOnly = has('--human'), said = flag('--said'), by = flag('--by') || process.env.CLIMBIO_AGENT || 'agent:unnamed';
const gymArg = flag('--gym'), originArg = flag('--origin'), studioArg = flag('--studio');
const portArg = flag('--port'), daysArg = flag('--days'), limitArg = flag('--limit'), idsArg = flag('--ids');
const patchFile = flag('--patch'), note = flag('--note'), position = flag('--position'), from = flag('--from'), site = flag('--site') || 'https://climbio.app';

// ---- 專案資料夾 ----
function project(dir) {
  if (!dir) fail('要給專案資料夾');
  const p = resolve(dir), work = join(p, WORK_DIR);
  return {
    dir: p, work,
    source: join(p, '.studio', 'source'),
    outline: join(p, '.studio', 'source', 'outline.md'),
    questions: join(work, 'questions'),
    decisions: join(work, 'decisions.jsonl'),
    runs: join(work, 'runs.jsonl'),
    notes: join(work, 'notes.md'),
    state: join(work, 'state.json'),
    remote: join(work, 'remote.json'),
  };
}
/** 3D 牆的工作檔（wall.json 是 climbio-3d-wall/1）；不是就 null */
const wall3dDoc = (P) => { const d = readJson(join(P.dir, 'wall.json'), null); return d?.format === 'climbio-3d-wall/1' ? d : null; };
/** 成品在不在：3D 牆是工作檔齊了（wall.json 和它指到的模型、面標籤），其他是包的入口 index.json */
const built = (P) => { const d = wall3dDoc(P); return d ? existsSync(join(P.dir, d.model)) && existsSync(join(P.dir, d.faces)) : existsSync(join(P.dir, 'index.json')); };
/** 這個專案是哪條線：3D 牆的工作資料夾、牆的分享包（index.json 的 type 是 walls）是岩館牆面，其他是路線書轉換（天然岩場） */
const lineOf = (P) => (wall3dDoc(P) ? 'wall3d' : readJson(join(P.dir, 'index.json'), null)?.type === 'walls' ? 'wall' : 'convert');
const LINE = { convert: '天然岩場（路線書轉換）', wall: '岩館牆面', wall3d: '3D 牆' };
const stepOf = (P) => (built(P) ? 'built' : existsSync(P.outline) ? 'outline' : null);
/** 成品的指紋：包裡的 JSON（入口、畫面、圖層、3D 牆的 wall.json；report.json、發佈時才存的 base-wall.json 不算）照檔名排好的內容。核准發佈綁在這一版上，內容一改就要重新核准 */
function packSig(P) {
  const files = readdirSync(P.dir).filter(n => n.endsWith('.json') && n !== 'report.json' && n !== 'base-wall.json' && statSync(join(P.dir, n)).isFile()).sort();
  const h = createHash('sha256');
  for (const n of files) h.update(n).update('\0').update(readFileSync(join(P.dir, n))).update('\0');
  return h.digest('hex').slice(0, 16);
}

/** 牆的分享包 → 題目：可能是同一顆的岩點（跟 Studio Wall 編輯器同一套判斷，geometry.js 的 dupPairs），證據是照片和兩顆的範圍 */
function wallQuestions(P) {
  const index = readJson(join(P.dir, 'index.json'));
  const docs = (index.items || []).map(i => readJson(join(P.dir, i.href), null)).filter(Boolean);
  for (const d of [...docs]) if (d.kind === 'layer' && d.href && !docs.some(x => x.id === d.href.replace(/\.json$/, ''))) { const v = readJson(join(P.dir, d.href), null); if (v) docs.push(v); }
  const out = [];
  for (const v of docs.filter(d => d.surface === 'photo')) {
    const holds = (v.nodes || []).filter(n => n.type === 'hold' && !n.props?.retired).map(n => {
      const ring = v.marks.find(m => m.node === n.id)?.geometry.coordinates[0] || [];
      return { id: n.id, poly: ring.slice(0, -1) };
    }).filter(h => h.poly.length >= 3);
    const byId = new Map(holds.map(h => [h.id, h]));
    for (const [a, b] of RefineGeo.dupPairs(holds, v.w, v.h)) {
      const pts = [...byId.get(a).poly, ...byId.get(b).poly], xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      out.push({
        id: `q-hold-dup-${v.id}-${a}-${b}`, line: 'wall', kind: 'hold-dup', level: 'check', target: [a, b],
        title: `${v.name || v.id}：岩點 ${a}、${b} 可能是同一顆`, options: ['ok', 'fix'],
        evidence: [{ image: v.href, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(Math.round), size: [v.w, v.h] }],
      });
    }
  }
  return { name: typeof index.name === 'string' ? index.name : Object.values(index.name || {})[0] || '', questions: out };
}
/** 3D 牆的 AI 逐顆檢查紀錄、人試用的回報 */
const review3dPath = (P) => join(P.dir, 'review3d.json');
const feedback3dPath = (P) => join(P.dir, 'feedback3d.json');
/**
 * 3D 牆的工作資料夾 → 題目：要發佈的每顆岩點都要 AI 看過（跟人逐顆修同一個標準，不是看某個數字過門檻），AI 自己判斷到底。
 * 還有沒看過的：一題給代理（look3d 出圖、review3d 記判斷，看完這題就消失）。
 * 人只在發佈時確認；唯一例外是 AI 判斷照片明顯不夠（retake）：合併成一題問人要不要補拍，證據是那幾顆的圖
 */
function wall3dQuestions(P, decisions = []) {
  const doc = wall3dDoc(P), review = readJson(review3dPath(P), null), st = Wall3dReview.status(doc, review), out = [];
  // AI 檢查分三階段，前一階段過了才出下一階段：1 模型完整、切口直、不貼岩點；2 沿牆鏡頭由右走到左看得清每面牆的下半部；3 逐顆岩點。
  // 前兩階段綁在模型與裁切上（模型、面、裁切平面、隱藏的面），換了才重看
  const m3 = hash(JSON.stringify([doc.model, doc.faces, doc.surfaces && doc.surfaces.frame, ((doc.surfaces && doc.surfaces.list) || []).map(x => x.hidden)]));
  const stage1 = { id: `q-model3d-${m3}`, line: 'wall3d', kind: 'model3d', level: 'error', target: [], options: ['ok', 'fix'],
    title: `第一階段（模型）：node tools/studio.mjs check3d ${P.dir} model 出圖，逐張看：模型完整、上下左右的切口是直線、沒有切得太貼岩點（岩點外留一段牆）、牆腳沒有糊掉或不自然的貼圖。沒問題 answer ok；有問題修好（切齊、重建）再出圖` };
  const stage2 = { id: `q-path3d-${m3}`, line: 'wall3d', kind: 'path3d', level: 'error', target: [], options: ['ok', 'fix'],
    title: `第二階段（鏡頭動線）：node tools/studio.mjs check3d ${P.dir} path 出圖，看沿牆鏡頭由右走到左：像人站在牆前，每面牆（內角兩側、cave）的下半部都看得清楚、沒有對著牆外或斜到看不見的位置，最遠點不到的岩點是 0。沒問題 answer ok；有問題修鏡頭再出圖` };
  if (built(P)) {
    if (isOpen(stage1, decisions)) return [stage1];
    if (isOpen(stage2, decisions)) return [stage2];
  }
  if (st.need.length) out.push({
    id: 'q-look3d', line: 'wall3d', kind: 'look3d', level: 'error', target: [], options: ['edit', 'fix'],
    title: `${st.need.length} 顆岩點 AI 還沒看過（要發佈的共 ${st.total} 顆）：node tools/studio.mjs look3d ${P.dir} 出圖，逐張看完用 review3d 記判斷`,
  });
  if (st.retake.length) {
    const notes = [...new Set(st.retake.map(id => review.holds[id].note))];
    out.push({
      id: `q-retake-${hash(st.retake.join())}`, line: 'wall3d', kind: 'retake', level: 'check', target: st.retake, options: ['ok', 'fix'],
      title: `AI 判斷有 ${st.retake.length} 顆岩點附近的照片不夠、看不清（${notes.slice(0, 3).join('；')}${notes.length > 3 ? '…' : ''}）。要補拍這幾處（fix），還是照現在的發佈（ok）？`,
      evidence: st.retake.slice(0, 12).map(id => ({ image: `.studio/evidence/${id}.jpg` })),
    });
  }
  // AI 看完、補拍題答完，才請人試用：還沒處理的回報給代理修；這一版人還沒試用過就問人（在 Studio 按「試用完」也算）
  if (built(P) && !out.some(q => isOpen(q, decisions))) {
    const fb = Wall3dFeedback.status(doc, readJson(feedback3dPath(P), null));
    if (fb.open.length) out.push({
      id: `q-feedback3d-${hash(fb.open.map(x => x.id).join())}`, line: 'wall3d', kind: 'feedback3d', level: 'error', target: fb.open.map(x => x.id), options: ['edit', 'fix'],
      title: `人試用回報了 ${fb.open.length} 個問題：${fb.open.map(x => `${x.id}${x.hold ? `（岩點 ${x.hold}）` : ''}「${x.text}」`).join('；')}。node tools/studio.mjs look3d ${P.dir} 出當時的畫面（「有點沒辦法點」在畫面上描那顆、review3d 寫 add fb；「外框不對」reshape 或 off），修好後 resolve3d 記下怎麼處理`,
      evidence: fb.open.filter(x => existsSync(join(P.work, 'look', `fb-${x.id}.jpg`))).map(x => ({ image: `.studio/work/look/fb-${x.id}.jpg` })),
    });
    else if (!fb.tried) out.push({
      id: `q-trial3d-${Wall3dFeedback.sig(doc)}`, line: 'wall3d', kind: 'trial3d', level: 'check', target: [], options: ['ok', 'fix'],
      title: `請在 Studio 試用這一版：3D 牆頁（/studio/wall3d/）選這個資料夾，到「試用」步驟轉一圈；有問題點那裡寫一句回報，沒問題按「試用完」。${fb.done.length ? `上次回報的 ${fb.done.length} 個問題已處理（${fb.done.map(x => `「${x.text}」→ ${x.done.note}`).join('；')}）。` : ''}也可以在對話裡說試用過沒問題（ok）`,
    });
  }
  return out;
}
const loadQuestions = (P) => (existsSync(P.questions) ? readdirSync(P.questions).filter(f => f.endsWith('.json')).map(f => readJson(join(P.questions, f))) : []);

/** 跑路線書工具；結束碼 1 是「有 error」，不是失敗 */
function guidebook(...a) {
  const r = spawnSync(process.execPath, [GUIDEBOOK, ...a], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0 && r.status !== 1) fail(`tools/guidebook.mjs ${a[0]} 失敗：\n${r.stderr || r.stdout}`, 1);
  return r;
}

/** 現在的問題清單：建好的包用 validate，只有大綱用 check（代理可能直接改過 outline.md，每次重算） */
/** 岩場發佈題的關鍵欄位：國家、署名（大綱的岩場欄位）、位置、區／岩壁／路線／照片數（包的報告）；沒有的寫「沒寫」 */
function cragFacts(P) {
  const md = existsSync(P.outline) ? readFileSync(P.outline, 'utf8') : '';
  const field = (re) => (md.split(/\r?\n/).find(l => re.test(l)) || '').split(/[：:]/).slice(1).join(':').trim();
  const rep = currentReport(P) || {}, c = rep.count || {}, pos = rep.position;
  return [
    `國家：${field(/^\s*(國家|國別|country|cc)\s*[：:]/i) || '沒寫（發佈會停下，要 --country）'}`,
    `署名：${field(/^\s*(署名|作者|編者|author|attribution)\s*[：:]/i) || '沒寫'}`,
    `位置：${pos ? `${pos.lat}, ${pos.lng}` : '沒有'}`,
    [c.areas != null && `${c.areas} 區`, c.walls != null && `${c.walls} 面岩壁`, c.routes != null && `${c.routes} 條路線`, c.photos != null && `${c.photos} 張照片`].filter(Boolean).join('、'),
  ].filter(Boolean).join('；') + '。';
}
function currentReport(P) {
  const step = stepOf(P);
  if (step === 'built') return JSON.parse(guidebook('validate', P.dir, '--json').stdout);
  if (step === 'outline') return JSON.parse(guidebook('check', P.outline, '--json', ...(positionOf(P) ? ['--position', positionOf(P)] : [])).stdout);
  return null;
}

/**
 * 題目加上給人看的證據：路線所在岩壁的照片（包裡的照片畫面，props.node 是岩壁）、大綱裡那一列的原文。
 * 別台電腦只看得到推上去的檔案，所以照片用專案裡的相對路徑
 */
function withEvidence(P, questions) {
  const book = built(P) ? readJson(join(P.dir, 'index.json')) : null;
  const outline = existsSync(P.outline) ? readFileSync(P.outline, 'utf8').split('\n') : [];
  const photos = new Map();
  for (const i of book?.items || []) {
    const v = typeof i.href === 'string' && i.href.endsWith('.json') && existsSync(join(P.dir, i.href)) ? readJson(join(P.dir, i.href)) : null;
    if (v?.kind === 'view' && v.surface === 'photo' && v.href && v.props?.node) { if (!photos.has(v.props.node)) photos.set(v.props.node, []); photos.get(v.props.node).push(v.href); }
  }
  return questions.map(q => {
    const ev = [];
    const route = book?.nodes.find(n => n.id === q.target[0]);
    for (const href of photos.get(route?.parent) || []) ev.push({ image: href });
    for (const e of q.evidence || []) {
      if (!e.outline) continue;
      // 表格：第 line 行是表頭，下一行是分隔線，之後是第 row 列
      ev.push({ ...e, text: [outline[e.outline.line - 1], outline[e.outline.line + e.outline.row]].filter(Boolean) });
    }
    return ev.length ? { ...q, evidence: ev } : q;
  });
}

/** 依現況重算題目、寫進度；回傳 { questions, decisions, state } */
function sync(P) {
  mkdirSync(P.questions, { recursive: true });
  const line = lineOf(P), t = now(), decisions = readLines(P.decisions), old = loadQuestions(P);
  let name = '', fresh = [];
  if (line === 'wall') ({ name, questions: fresh } = wallQuestions(P));
  else if (line === 'wall3d') { name = wall3dDoc(P).name || ''; fresh = wall3dQuestions(P, decisions); }
  else { const rep = currentReport(P); name = rep?.name || ''; fresh = rep ? withEvidence(P, questionsFromReport(rep, { reasonText })) : []; }
  // 成品建好、其他題都答完：問人要不要公開發佈這一版（只能由人答）
  // 岩場的發佈題把會公開的關鍵欄位寫出來（國家、署名、位置、數量）：人核准時一眼看得出漏了什麼
  if (built(P) && refresh(old, fresh, t).every(q => !isOpen(q, decisions))) fresh.push(publishQuestion({ line, sig: packSig(P), title: `要公開發佈「${name || P.dir}」嗎？${line === 'convert' ? cragFacts(P) : ''}發佈就是公開、收不回` }));
  const questions = refresh(old, fresh, t);
  const keep = new Set(questions.map(q => `${q.id}.json`));
  for (const f of readdirSync(P.questions)) if (!keep.has(f)) rmSync(join(P.questions, f));
  for (const q of questions) writeJson(join(P.questions, `${q.id}.json`), q);
  const state = stateOf({ line, step: line === 'convert' ? stepOf(P) : 'built', built: built(P), name, questions, decisions, now: t });
  writeJson(P.state, state);
  return { questions, decisions, state };
}

function logRun(P, cmd, a, state) {
  mkdirSync(P.work, { recursive: true });
  appendFileSync(P.runs, JSON.stringify({ at: now(), by, cmd, args: a, version: VERSION, result: { open: state.open, total: state.total, errors: state.errors } }) + '\n');
}

// ---- 給人看的輸出 ----
const NEXT = {
  start: (d) => `轉換路線書：node tools/studio.mjs convert ${d} read <路線書檔案…>`,
  build: (d) => `建書：node tools/studio.mjs convert ${d} build`,
  answer: (d) => `AI 先答：node tools/studio.mjs ask ${d} --json 列出等你的題（證據照片 evidence[].file 自己看），每題自己判斷到底（看不準也要選一個），只有原始資料明顯不夠（照片糊、缺頁）才 answer … retake --note 哪裡不夠；人要你改的照做後答 edit`,
  human: (d) => `剩下的等人：node tools/studio.mjs ask ${d} --human 列出題目和證據，在對話裡拿給使用者看、請他答，再 answer … --by human:<名稱> --said "<他的原話>" 記下`,
  publish: (d) => `題目都答完了：使用者在對話裡答「要不要公開發佈」選 ok 就發佈——岩場 node tools/guidebook.mjs publish ${d} [--country 國碼，大綱沒寫「國家：」時要給]、牆和 3D 牆 node tools/studio.mjs publish ${d}；人選了不發佈（reject）就停在這裡，內容改了會再問`,
};
const STEP = { outline: '已讀成大綱', built: '已建成包' };

function lastNote(P) {
  if (!existsSync(P.notes)) return '';
  const parts = readFileSync(P.notes, 'utf8').split(/^(?=## )/m).filter(s => s.trim());
  return parts.at(-1)?.trim() || '';
}

function printQuestions(qs, decisions) {
  for (const q of qs) {
    console.log(`- ${q.id}  [${q.level}]${waitingFor(q, decisions) === 'human' ? '［等人］' : ''} ${q.title}（${q.options.join('／')}${HUMAN_ONLY.has(q.kind) ? '' : '／retake'}）`);
    if (waitingFor(q, decisions) !== 'agent') continue;
    const d = decisions.filter(x => x.q === q.id).at(-1);
    console.log(`    人要你改${d.note ? `：${d.note}` : ''}${d.patch ? `（修正：${JSON.stringify(d.patch)}）` : ''}`);
  }
}

/** 等人答的題目，給代理貼到 AI 對話裡：題目、可以怎麼答、證據（照片給絕對路徑，代理打開來給人看）、AI 說哪裡的資料不夠 */
const CHOICE_TEXT = { ok: '沒問題', fix: '要改（說怎麼改）', edit: '已經自己改好', accept: '採用建議', reject: '不採用' };
function printForHuman(P, list, files) {
  const decisions = readLines(P.decisions);
  list.forEach((q, i) => {
    console.log(`${i + 1}. ${q.title}`);
    console.log(`   可以答：${q.options.map(o => CHOICE_TEXT[o] || o).join('、')}`);
    for (const e of files(q)) { if (e.file) console.log(`   照片：${e.file}`); if (e.text) console.log(`   原文：${e.text.join(' ／ ')}`); }
    const why = decisions.filter(x => x.q === q.id && x.choice === 'retake').at(-1);
    if (why) console.log(`   AI 說資料不夠、要補：${why.note}`);
    console.log(`   記下：node tools/studio.mjs answer ${P.dir} ${q.id} <${q.options.join('|')}> --by human:<名稱> --said "<原話>"`);
  });
}

// ---- 指令 ----
function status(P) {
  const { state } = sync(P);
  logRun(P, 'status', [], state);
  if (json) return console.log(JSON.stringify({ ...state, note: lastNote(P), remote: readJson(P.remote, null) }, null, 1));
  console.log(`${state.name || P.dir}：${LINE[state.line]}，${STEP[state.step] || '還沒開始'}${existsSync(P.remote) ? `（同步：${readJson(P.remote).url}）` : ''}`);
  console.log(`題目：還有 ${state.open} 題（AI 先答 ${state.forAgent}、等人 ${state.forHuman}）${state.errors ? `，${state.errors} 題必須修` : ''}，共 ${state.total} 題`);
  console.log(`下一步：${NEXT[state.next](P.dir)}`);
  const n = lastNote(P);
  if (n) console.log(`\n最後的交接筆記：\n${n}`);
}

function ask(P) {
  const { questions, decisions } = sync(P);
  const list = (all ? questions : questions.filter(q => isOpen(q, decisions))).filter(q => !humanOnly || waitingFor(q, decisions) === 'human');
  // 證據照片給絕對路徑：代理直接打開來看
  const files = (q) => (q.evidence || []).map(e => (e.image ? { ...e, file: join(P.dir, ...e.image.split('/')) } : e));
  if (json) return console.log(JSON.stringify(list.map(q => ({ ...q, evidence: files(q), waiting: waitingFor(q, decisions) })), null, 1));
  if (!list.length) return console.log(humanOnly ? '沒有等人答的題目' : '沒有要答的題目');
  if (humanOnly) return printForHuman(P, list, files);
  printQuestions(list, decisions);
}

/** 套用修正：岩場的包用 tools/guidebook.mjs apply，牆的分享包用 tools/wall.mjs apply（結束碼 1 是岩場還有 error，不是失敗） */
function applyTool(P, file) {
  if (lineOf(P) !== 'wall') return guidebook('apply', P.dir, file);
  const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'wall.mjs'), 'apply', P.dir, file], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) fail(r.stderr || r.stdout, 1);
  return r;
}
/** 套用修正到包；不合格式就停 */
/** 大綱階段人給的位置（對話裡答的位置題）：存在 .studio/position.txt，check／build 沒給 --position 時用它 */
const positionOf = (P) => position || (existsSync(join(P.work, 'position.txt')) ? readFileSync(join(P.work, 'position.txt'), 'utf8').trim() : '');

/** 回 true＝已套用；還沒建成包時只收位置（存起來給 build 用），其餘修正先留著不動，回 false */
function applyPatch(P, patch) {
  if (!built(P)) {
    const pos = (Array.isArray(patch) ? patch : []).find(o => o && o.op === 'position');
    if (pos) { mkdirSync(P.work, { recursive: true }); writeFileSync(join(P.work, 'position.txt'), `${pos.lat},${pos.lng}\n`); }
    return !!pos && patch.every(o => o && o.op === 'position');
  }
  const tmp = join(tmpdir(), `climbio-patch-${process.pid}.json`);
  writeJson(tmp, patch);
  const r = applyTool(P, tmp);
  rmSync(tmp);
  if (r.stderr.trim()) fail(r.stderr, 1);
  return true;
}

function answer(P, id, choice) {
  if (!id || !choice) fail('用法：node tools/studio.mjs answer <專案> <題目 id> <accept|reject|edit|ok|fix> [--patch patch.json] [--note 文字] [--by human:<名稱> --said "<人的原話>"]');
  // 人的判斷：在終端機自己打（有 TTY）不用 --said；代理替人記下對話裡的回答一定要附原話，才查得到是人答的、答了什麼
  if (by.startsWith('human:') && !said && !process.stdin.isTTY) fail('代理替人記判斷要加 --said "<人在對話裡答的原話>"（先把題目和證據拿給人看，人親口答了才記；不能代人決定）');
  const { questions } = sync(P);
  const q = questions.find(x => x.id === id) || fail(`沒有這題（或問題已經不在）：${id}`);
  const patch = patchFile ? readJson(resolve(patchFile)) : undefined;
  const now1 = choice !== 'fix';   // fix 是交給代理改：patch 留著，由 pull 的代理套用；其他的現在就套用
  let d;
  try { d = decide(q, { choice, by, note, patch, applied: now1, said }, now()); } catch (e) { fail(e.message); }
  if (d.patch && now1) applyPatch(P, d.patch);
  mkdirSync(P.work, { recursive: true });
  appendFileSync(P.decisions, JSON.stringify(d) + '\n');
  const { state, questions: after, decisions } = sync(P);
  logRun(P, 'answer', [id, choice], state);
  const still = after.find(x => x.id === id);
  console.log(still && isOpen(still, decisions) && choice !== 'fix' ? `記下了，但 ${id} 的問題還在，這題重新打開` : `記下了：${id} → ${choice}`);
  console.log(`還有 ${state.open} 題`);
}

function addNote(P, text) {
  if (!text) fail('用法：node tools/studio.mjs note <專案> <文字>');
  mkdirSync(P.work, { recursive: true });
  appendFileSync(P.notes, `## ${now()} ${by}\n\n${text.trim()}\n\n`);
  console.log(`寫進 ${P.notes}`);
}

function convert(P, step, rest) {
  if (step === 'read') {
    if (!rest.length) fail('用法：node tools/studio.mjs convert <專案> read <路線書…>');
    if (stepOf(P)) fail(`${P.dir} 已經有大綱或包了；要重來先換一個空資料夾`);
    mkdirSync(P.source, { recursive: true });
    const r = guidebook('read', ...rest.map(f => resolve(f)), '--out', P.source);
    process.stdout.write(r.stdout);
  } else if (step === 'build') {
    if (!existsSync(P.outline)) fail(`還沒有大綱：先 convert ${P.dir} read <路線書…>`);
    const r = guidebook('build', P.outline, ...rest.map(f => resolve(f)), '--out', P.dir, ...(positionOf(P) ? ['--position', positionOf(P)] : []));
    process.stdout.write(r.stdout);
    if (r.status !== 0 && !built(P)) fail(r.stderr || '建書失敗', 1);
  } else fail('用法：node tools/studio.mjs convert <專案> read|build …');
  const { state } = sync(P);
  logRun(P, `convert ${step}`, rest, state);
  console.log(`題目：還有 ${state.open} 題，共 ${state.total} 題；下一步：${NEXT[state.next](P.dir)}`);
}

function apply(P, file) {
  if (!file) fail('用法：node tools/studio.mjs apply <專案> <patch.json>');
  if (!built(P)) fail('還沒建成包');
  const r = applyTool(P, resolve(file));
  if (r.stderr.trim()) fail(r.stderr, 1);
  process.stdout.write(r.stdout);
  const { state } = sync(P);
  logRun(P, 'apply', [file], state);
}

// ---- 同步服務 ----
// 網址與身分見 studio-auth.mjs：同步金鑰或 GitHub 權杖（gh 登入的 repo 協作者）；都沒有就不帶標頭（雲端環境的 Network secret 由代理加上）
const URL_ENV = SYNC_URL, KEY = () => studioAuth().key;
const serviceUrl = (u) => u || URL_ENV;
const keyHeader = () => (KEY() ? { 'X-Studio-Key': KEY() } : {});
const NO_KEY = '身分不對或沒帶：先 gh auth login（帳號要是 repo 的協作者），或設環境變數 CLIMBIO_STUDIO_KEY（部署時設的 STUDIO_KEY）；雲端環境用 Network secret，標頭 X-Studio-Key、網站是同步服務的網域';
/** 呼叫同步服務；下載檔案回 Buffer，其他回 JSON（失敗時多一個 status） */
async function call(url, { method = 'POST', body, query, raw, type } = {}) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(query || {})) u.searchParams.set(k, v);
  let res;
  try {
    res = await fetch(u, { method, headers: { ...keyHeader(), 'Content-Type': type || 'application/json' }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  } catch (e) { fail(`連不上同步服務 ${url}：${e.message}`, 1); }
  if (res.status === 401) fail(NO_KEY, 1);
  if (method === 'GET' && (query?.path || query?.sha)) { if (!res.ok) fail(`下載 ${query.path || query.sha} 失敗：HTTP ${res.status}`, 1); return Buffer.from(await res.arrayBuffer()); }
  const j = await res.json().catch(() => ({}));
  return res.ok ? j : Object.assign(j, { status: res.status });
}
const remoteOf = (P) => readJson(P.remote, null) || fail(`${P.dir} 還沒接上同步服務：node tools/studio.mjs link ${P.dir} <服務網址>`);
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
// 雲端函式一次請求最多約 32 MB：比這大的檔（3D 模型）切成幾段各傳一次，清單記 parts，下載時一段一段拿回來接起來
const PART = 24 << 20;
const MIME = { '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.md': 'text/markdown', '.geojson': 'application/geo+json', '.glb': 'model/gltf-binary' };
/** 專案資料夾裡要同步的檔案（工作紀錄走 JSON，不當檔案傳） */
function projectFiles(P) {
  const walk = (d) => readdirSync(d).flatMap(n => { const f = join(d, n); return statSync(f).isDirectory() ? walk(f) : [f]; });
  return walk(P.dir).map(f => relative(P.dir, f).split(sep).join('/')).filter(p => !p.startsWith(`${WORK_DIR}/`) && !p.startsWith('.git/') && !p.startsWith('成品/'));   // 成品/ 是 3D 牆發佈時烘的，從工作檔重烘得出來
}
/** 交接筆記 ↔ 一段一筆（同步時照段落合併；段落開頭是「## 時間 誰」） */
const noteRecords = (text) => text.split(/^(?=## )/m).map(s => s.trim()).filter(s => s.startsWith('## ')).map(s => ({ id: `n-${hash(s)}`, at: s.slice(3).split(' ')[0], text: s }));
const withIds = (list) => list.map(x => (x.id ? x : { id: recordId(x), ...x }));

function link(P, url) {
  url ||= URL_ENV;
  if (!url || !/^https?:\/\//.test(url)) fail('用法：node tools/studio.mjs link <專案> <服務網址>');
  mkdirSync(P.work, { recursive: true });
  const old = readJson(P.remote, null);
  const remote = { url, pid: old?.url === url ? old.pid : randomBytes(10).toString('hex').slice(0, 16) };
  writeJson(P.remote, remote);
  console.log(`接上 ${url}（專案 id ${remote.pid}）`);
}

async function push(P) {
  const remote = remoteOf(P), { questions, decisions, state } = sync(P);
  const cur = await call(remote.url, { body: { op: 'pull', pid: remote.pid } });
  if (cur.status && cur.status !== 404) fail(`同步服務回 ${cur.status}：${cur.error || ''}`, 1);
  // 服務上的版本比上次同步的新：別的代理推過，先拉下來（推了會蓋掉別人的）
  const rev = cur.project?.rev || 0;
  if (cur.project && rev !== (remote.rev || 0)) fail(`服務上有別人推過的新版本（第 ${rev} 版，你上次同步的是第 ${remote.rev || 0} 版）：先 node tools/studio.mjs pull ${P.dir}，再推`, 1);
  const have = cur.project?.files || {}, files = {}, synced = {};
  let sent = 0;
  for (const path of projectFiles(P)) {
    const buf = readFileSync(join(P.dir, path)), h = sha(buf);
    synced[path] = h;
    if (have[path]?.sha256 === h) continue;
    const chunks = [];
    for (let i = 0; i < buf.length || !chunks.length; i += PART) chunks.push(buf.subarray(i, i + PART));
    const parts = [];
    for (const chunk of chunks) {
      const r = await call(remote.url, { method: 'PUT', query: { pid: remote.pid, path }, raw: chunk, type: chunks.length > 1 ? 'application/octet-stream' : MIME[extname(path).toLowerCase()] || 'application/octet-stream' });
      if (r.status) fail(`上傳 ${path} 失敗：${r.status} ${r.error || ''}`, 1);
      parts.push(r.sha256);
    }
    files[path] = { sha256: h, size: buf.length, ...(parts.length > 1 ? { parts } : {}) };
    sent++;
  }
  // 別台記下的判斷先合併再推，服務上的才是全部
  const ds = merge(withIds(decisions), cur.decisions || []);
  const counts = summary(questions, ds);   // 別台記下的也算進去
  const body = { op: 'push', pid: remote.pid, ...(cur.project ? { base: rev } : {}), files, name: state.name || '', line: state.line, state: { ...state, ...counts, publishable: state.step === 'built' && counts.open === 0 }, questions, decisions: ds, runs: withIds(readLines(P.runs)), notes: existsSync(P.notes) ? noteRecords(readFileSync(P.notes, 'utf8')) : [] };
  const r = await call(remote.url, { body });
  if (r.status === 409) fail(`推上去之前別人剛推過（服務上是第 ${r.rev} 版）：什麼都沒改；先 node tools/studio.mjs pull ${P.dir}，再推`, 1);
  if (r.status) fail(`推上去失敗：${r.status} ${r.error || ''}`, 1);
  writeJson(P.remote, { ...remote, rev: r.rev, synced: { ...(remote.synced || {}), ...synced } });
  logRun(P, 'push', [], state);
  console.log(`推上去了：${sent} 個檔案、${questions.length} 題（還有 ${state.open} 題）`);
  if (ds.length > decisions.length) console.log(`服務上有 ${ds.length - decisions.length} 筆別台記下的判斷還沒拉下來：node tools/studio.mjs pull ${P.dir}`);
}

async function pull(P) {
  if (!existsSync(P.remote)) {
    const m = /^(https?:\/\/[^#]+)?#([0-9a-z]{16})$/.exec(from || '');
    if (!m) fail(`${P.dir} 還沒接上同步服務：加 --from <服務網址>#<專案 id>（設了 CLIMBIO_STUDIO_URL 可以只寫 #<專案 id>；node tools/studio.mjs projects 列出專案）`);
    mkdirSync(P.work, { recursive: true });
    writeJson(P.remote, { url: serviceUrl(m[1]), pid: m[2] });
  }
  const remote = remoteOf(P);
  const got = await call(remote.url, { body: { op: 'pull', pid: remote.pid } });
  if (got.status) fail(`同步服務回 ${got.status}：${got.error || ''}`, 1);
  // 檔案：服務上的換掉本機的；但本機在上次同步之後也改過、兩邊不一樣的不蓋（衝突），列出來（--theirs 用服務上的）
  let files = 0;
  const synced = { ...(remote.synced || {}) }, clash = [];
  for (const [path, f] of Object.entries(got.project.files || {})) {
    const local = join(P.dir, ...path.split('/'));
    if (!local.startsWith(P.dir + sep)) continue;
    const mine = existsSync(local) ? sha(readFileSync(local)) : '';
    if (mine === f.sha256) { synced[path] = mine; continue; }
    // 只有本機在上次同步之後改過（服務上還是那時的）：留本機的，推的時候再上去。不然手機試用回報（服務上只換 feedback3d.json）一拉就把本機的修正蓋回舊版
    if (mine && synced[path] && mine !== synced[path] && f.sha256 === synced[path]) continue;
    // 兩邊都改過，或沒同步過、兩邊又不一樣：衝突，不蓋
    if (mine && (!synced[path] || mine !== synced[path]) && !theirs) { clash.push(path); continue; }
    mkdirSync(dirname(local), { recursive: true });
    const data = f.parts ? Buffer.concat(await Promise.all(f.parts.map(p => call(remote.url, { method: 'GET', query: { pid: remote.pid, sha: p } })))) : await call(remote.url, { method: 'GET', query: { pid: remote.pid, path } });
    if (sha(data) !== f.sha256) fail(`下載 ${path} 內容對不上（sha256 不同），沒有寫入：再 pull 一次`, 1);
    writeFileSync(local, data);
    synced[path] = f.sha256;
    files++;
  }
  // 有衝突時不記新版本：推的時候會擋下，先處理衝突
  writeJson(P.remote, { ...remote, synced, ...(clash.length ? {} : { rev: got.project.rev || 0 }) });
  mkdirSync(P.work, { recursive: true });
  const before = readLines(P.decisions).length;
  writeLines(P.decisions, merge(withIds(readLines(P.decisions)), got.decisions));
  writeLines(P.runs, merge(withIds(readLines(P.runs)), got.runs));
  const notes = new Map([...(existsSync(P.notes) ? noteRecords(readFileSync(P.notes, 'utf8')) : []), ...got.notes].map(n => [n.id, n]));
  if (notes.size) writeFileSync(P.notes, [...notes.values()].sort((a, b) => (a.at < b.at ? -1 : 1)).map(n => `${n.text}\n\n`).join(''));
  const fresh = readLines(P.decisions).length - before;
  // 人要改的修正（別台記下、fix 帶的 patch）：套用到包，記一筆 edit（代理只是照做）
  const { questions } = sync(P);
  let applied = 0;
  for (const d of pendingPatches(questions, readLines(P.decisions))) {
    if (!applyPatch(P, d.patch)) continue;
    appendFileSync(P.decisions, JSON.stringify(decide(questions.find(x => x.id === d.q), { choice: 'edit', by, note: `套用 ${d.id}`, patch: d.patch, applied: true }, now())) + '\n');
    applied++;
  }
  const { state } = sync(P);
  logRun(P, 'pull', [], state);
  console.log(`拉下來了：${files} 個檔案、${fresh} 筆新的判斷，套用 ${applied} 個修正；還有 ${state.open} 題（AI 先答 ${state.forAgent}、等人 ${state.forHuman}）`);
  if (clash.length) {
    console.log('這些檔案你在本機改過、服務上也被別人改了，沒有蓋掉：');
    for (const x of clash) console.log(`  ${x}`);
    console.log(`要用服務上的：node tools/studio.mjs pull ${P.dir} --theirs（你的改動要重做）；處理完才能推`);
    process.exitCode = 1;
  }
  if (applied) console.log(`記得推上去：node tools/studio.mjs push ${P.dir}`);
}

async function projects(url) {
  url = serviceUrl(url);
  const r = await call(url, { body: { op: 'list' } });
  if (r.status) fail(`同步服務回 ${r.status}：${r.error || ''}`, 1);
  if (json) return console.log(JSON.stringify(r.projects, null, 1));
  for (const p of r.projects) console.log(`- ${p.id}  ${p.name}（還有 ${p.state?.open ?? '?'} 題：AI 先答 ${p.state?.forAgent ?? '?'}、等人 ${p.state?.forHuman ?? '?'}）  接手：node tools/studio.mjs pull <空資料夾> --from ${url === URL_ENV ? '' : url}#${p.id}`);
  if (!r.projects.length) console.log('沒有專案');
}

// ---- 3D 重建的照片位置 → v2 包 ----
const newId = () => randomBytes(12).toString('hex').replace(/[^0-9a-z]/g, '').slice(0, 16).padEnd(16, '0');
function frames(dir, file) {
  const model = flag('--model'), images = flag('--images'), name = flag('--name'), attribution = flag('--attribution') || '';
  if (!dir || !file || !model || !images || !name) fail('用法：node tools/studio.mjs frames <資料夾> <frames.json> --model <模型.spz> --images <照片資料夾> --name <名稱> [--attribution 署名]');
  const list = readJson(resolve(file)) || fail(`讀不到 ${file}`);
  const out = resolve(dir);
  mkdirSync(out, { recursive: true });
  if (existsSync(join(out, 'index.json'))) fail(`${out} 已經有 index.json；換一個空資料夾`);
  const t = Date.now(), head = { climbio: 2, t, license: 'CC-BY-SA-4.0', attribution };
  const book = { ...head, kind: 'set', type: 'guidebook', id: newId(), name, nodes: [], items: [] }, crag = newId(), wall = newId();
  book.nodes.push({ id: crag, type: 'crag', name }, { id: wall, type: 'wall', parent: crag, name, props: { order: 1 } });
  const ext = extname(model).toLowerCase(), mv = { ...head, kind: 'view', surface: 'model', id: newId(), name, origin: 'self', href: '', mime: ext === '.glb' ? 'model/gltf-binary' : 'model/x-spz', props: { node: crag } };
  mv.href = `${mv.id}${ext}`;
  copyFileSync(resolve(model), join(out, mv.href));
  writeJson(join(out, `${mv.id}.json`), mv);
  book.items.push({ href: `${mv.id}.json`, id: mv.id });
  let n = 0;
  for (const f of list) {
    const src = join(resolve(images), `${f.name}.jpg`);
    if (!existsSync(src)) { console.log(`· 沒有照片 ${f.name}.jpg，略過`); continue; }
    const v = { ...head, kind: 'view', surface: 'photo', id: newId(), name: f.name, origin: 'self', href: '', w: f.intrinsics.width, h: f.intrinsics.height, mime: 'image/jpeg', props: { node: wall, model: modelCamera(cameraFromFrame(f), mv.id) } };
    v.href = `${v.id}.jpg`;
    copyFileSync(src, join(out, v.href));
    writeJson(join(out, `${v.id}.json`), v);
    book.items.push({ href: `${v.id}.json`, id: v.id });
    n++;
  }
  writeJson(join(out, 'index.json'), book);
  const { validate } = createRequire(import.meta.url)('../format/format.js');
  const bad = [book, ...book.items.map(i => readJson(join(out, i.href)))].flatMap(d => validate(d).map(e => `${d.id} ${e}`));
  if (bad.length) fail(`做好的包不合格式：\n${bad.join('\n')}`, 1);
  console.log(`寫好 ${out}：模型、${n} 張照片（每張記著模型上的鏡頭）；用 Studio 的 Crag「匯入岩場站」收進來`);
}

// ---- 發佈 ----
const PUBLISH_URL = process.env.CLIMBIO_PUBLISH_URL || 'https://asia-east1-firebase-climbio.cloudfunctions.net/datasets';
/** 牆的分享包裡伺服器收的檔案（functions/walls-dataset.js）：index.json、<id>.json、<id>.jpg、<id>.thumb.jpg、<id>.edits.json */
const WALL_FILE = /^(index\.json|[0-9a-z]{8,40}(\.json|\.jpg|\.thumb\.jpg|\.edits\.json))$/;
const nameText = (n) => (typeof n === 'string' ? n : n?.['zh-Hant'] ?? Object.values(n || {})[0] ?? '');

/** 這一版有沒有人核准發佈（「要不要公開發佈」人在對話裡答 ok）；沒有就停，說怎麼拿到核准 */
function approvedOrFail(P) {
  const { questions, decisions } = sync(P);
  return approval(questions, decisions) || fail(`這一版還沒有人核准發佈：node tools/studio.mjs ask ${P.dir} --human 把「要不要公開發佈」拿給使用者看，他在對話裡答發佈才記 ok（--by human:<名稱> --said "<原話>"）；只能由人答，內容改了要重新核准`, 1);
}

async function publish(dir) {
  if (!dir) fail('用法：node tools/studio.mjs publish <牆的分享包資料夾或 3D 牆的工作資料夾>（人核准過這一版）');
  if (lineOf(project(dir)) === 'wall3d') return publish3d(project(dir));
  const P = project(dir), root = P.dir, index = readJson(join(root, 'index.json'), null) || fail(`${root} 沒有 index.json`);
  if (index.type !== 'walls') fail(`${root} 不是牆的分享包（index.json 的 type 是 ${index.type}）；岩場用 node tools/guidebook.mjs publish，3D 用 Studio 發佈`);
  const ok = approvedOrFail(P);
  const names = readdirSync(root).filter(n => WALL_FILE.test(n));
  const docs = names.filter(n => n.endsWith('.json') && n !== 'index.json').map(n => readJson(join(root, n)));
  const gym = docs.map(d => d?.props?.gym).find(g => typeof g === 'string' && g) || '';
  if (!gym) fail('牆的畫面沒有岩館名稱（props.gym）：公開牆一定要有岩館名稱，補上再發佈');
  const files = names.map(path => ({ path, bytes: new Uint8Array(readFileSync(join(root, path))) }));
  const service = createService({ url: PUBLISH_URL, studioKey: async () => KEY() });   // 不用發佈金鑰：牆沒有擁有者，任何人都能發佈新版本
  let res;
  try { res = await service.publishWall({ id: index.id, name: nameText(index.name), gym, files }); } catch (e) { fail(`發佈失敗：${e.status ? `${e.status} ` : ''}${e.message}`, 1); }
  logRun(P, 'publish', [], readJson(P.state, {}));
  console.log(`發佈了「${nameText(index.name)}」（${index.id}）第 ${res.version} 版：${files.length} 個檔案；擁有者金鑰 ${res.owner || '無'}；核准的人 ${ok.by}（${ok.at}）`);
  console.log(`https://huggingface.co/datasets/climbio/walls/tree/main/walls/${index.id}/v${res.version}`);
}

/** 從已發佈的 3D 牆版本建工作資料夾：基底（原模型、原始岩點與分面）加那一版的 patch（studio/wall3d/patch.js，跟 Studio 的固定連結同一套） */
async function fetch3d(P, pid) {
  if (!/^[0-9a-z]{16}$/.test(pid || '')) fail('用法：node tools/studio.mjs fetch3d <資料夾> <公開版本 id> [--site 網址]');
  if (existsSync(join(P.dir, 'wall.json'))) fail(`${P.dir} 已經有 wall.json：換一個空資料夾`);
  const get = async (name) => { const r = await fetch(`${site}/p/${pid}/${name}`); if (!r.ok) fail(r.status === 404 ? `${pid} 沒有 ${name}（要有 patch 的版本才能接著精修）` : `下載 ${name} 失敗：HTTP ${r.status}`, 1); return Buffer.from(await r.arrayBuffer()); };
  const patch = JSON.parse(await get('patch.json')), base = await get('base-wall.json'), doc = JSON.parse(base);
  mkdirSync(P.dir, { recursive: true });
  writeFileSync(join(P.dir, doc.model), await get(`base-${doc.model}`));
  writeFileSync(join(P.dir, doc.faces), await get(`base-${doc.faces}`));
  writeFileSync(join(P.dir, 'base-wall.json'), base);
  writeFileSync(join(P.dir, 'wall.json'), JSON.stringify(applyWall3dPatch(doc, patch)));
  const { state } = sync(P);
  logRun(P, 'fetch3d', [pid], state);   // 下一次發佈的 origin 接在這一版後面
  console.log(`建好了「${doc.name || pid}」的工作資料夾（從 ${pid}）：${P.dir}`);
}

/** 無畫面 Chromium 開 Studio 的 3D 牆、放工作檔；回傳 { browser, page, errors }（用完要 browser.close()） */
async function openStudio3d(P, names) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch(), errors = [];
  try {
    const page = await (await browser.newContext({ locale: 'zh-TW', viewport: { width: 1280, height: 800 } })).newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${studioArg || site}/studio/wall3d/`);
    await page.locator('#files').setInputFiles(names.map(n => join(P.dir, n)));
    await page.waitForFunction(() => document.querySelector('#gate')?.hidden || !document.querySelector('#gateErr')?.hidden, null, { timeout: 10 * 60_000 });
    if (await page.locator('#gateErr').isVisible()) throw new Error(`打不開工作檔：${await page.locator('#gateErr').textContent()}`);
    return { browser, page, errors };
  } catch (e) { await browser.close(); throw e; }
}

/**
 * AI 看圖：還沒看過的岩點（--all 全部）一顆一張，存在 .studio/work/look/<id>.jpg，每 12 張拼成一張總圖（左上角編號 #n）；
 * index.json 記每顆的編號、總圖、鏡頭（AI 重描的多邊形照這個鏡頭變成修點）。圖是本機的工作檔，不同步
 */
const SHOT = 256, GLOW_SHOT = 320, PER_SHEET = 12;
async function look3d(P) {
  const doc = wall3dDoc(P);
  if (!doc) fail(`${P.dir} 不是 3D 牆的工作資料夾（要有 wall.json，format 是 climbio-3d-wall/1）`);
  const st = Wall3dReview.status(doc, readJson(review3dPath(P), null));
  const fbOpen = Wall3dFeedback.status(doc, readJson(feedback3dPath(P), null)).open, exp = Wall3dReview.exported(doc);
  // 人回報的岩點也出圖，代理照樣用 review3d 重描、拿掉
  const lim = Number(limitArg) || 0;   // --limit N：只拍前 N 顆（試跑量時間、看效果）
  const extra = idsArg ? readJson(resolve(idsArg), []) : [];   // --ids 清單.json：只拍這些岩點（例如換了角度才看得到的）
  const ids = (extra.length ? extra.filter(id => exp.includes(id)) : all ? exp : [...new Set([...st.need, ...fbOpen.map(x => x.hold)].filter(id => id && exp.includes(id)))]).slice(0, lim || undefined);   // 給了 --ids 就只拍那些
  if (!ids.length && !fbOpen.length) { console.log(`要發佈的 ${st.total} 顆岩點 AI 都看過了${st.retake.length ? `；${st.retake.length} 顆 AI 判斷照片不夠，等人決定要不要補拍（ask --human）` : ''}`); return; }
  const dir = join(P.work, 'look');
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const wide = has('--wide'), glow = has('--glow') || wide, shotSize = glow ? GLOW_SHOT : SHOT;   // --glow：看點選後的光暈（烘好的成品、沿牆鏡頭），不是範圍邊線
  const index = { size: shotSize, at: now(), glow, holds: {} }, sheets = [];
  const S = await openStudio3d(P, ['wall.json', doc.model, doc.faces]).catch(e => fail(e.message, 1));
  try {
    for (let k = 0; k < ids.length; k += PER_SHEET) {
      const res = await S.page.evaluate(async ([batch, size, start, per, glow, wide]) => {
        const src = document.querySelector('script[type="module"][src*="app.js"]').src;   // 同一個網址（含版本參數）才是頁面上那一份模組
        const m = await import(src), list = glow ? await m.glowShots(batch, size, wide) : await m.shots(batch, size);
        const cols = 3, c = Object.assign(document.createElement('canvas'), { width: cols * size * 2, height: Math.ceil(per / cols) * size }), g = c.getContext('2d');
        g.fillStyle = '#0e0e0f'; g.fillRect(0, 0, c.width, c.height);
        const imgs = await Promise.all(list.map(s => (s.jpg ? new Promise(r => { const im = new Image(); im.onload = () => r(im); im.src = s.jpg; }) : null)));
        list.forEach((s, j) => {
          const x = (j % cols) * size * 2, y = Math.floor(j / cols) * size;
          if (imgs[j]) g.drawImage(imgs[j], x, y);
          g.strokeStyle = '#555'; g.strokeRect(x + 0.5, y + 0.5, size * 2 - 1, size - 1);
          g.fillStyle = '#000'; g.fillRect(x, y, 70, 26); g.font = 'bold 20px sans-serif'; g.fillStyle = '#fff'; g.fillText(`#${start + j + 1}`, x + 6, y + 20);
        });
        return { list, sheet: c.toDataURL('image/jpeg', 0.85) };
      }, [ids.slice(k, k + PER_SHEET), shotSize, k, PER_SHEET, glow, wide]);
      const sheet = `sheet-${String(sheets.length + 1).padStart(3, '0')}.jpg`, b64 = (u) => Buffer.from(u.split(',')[1], 'base64');
      writeFileSync(join(dir, sheet), b64(res.sheet)); sheets.push(join(dir, sheet));
      res.list.forEach((s, j) => {
        if (s.jpg) writeFileSync(join(dir, `${s.id}.jpg`), b64(s.jpg));
        index.holds[s.id] = { n: k + j + 1, sheet, ...(s.empty ? { empty: true } : { c: s.c, a: s.a, ...(s.crop ? { crop: s.crop } : {}), ...(s.std ? { std: s.std } : {}), ...(s.via ? { via: s.via } : {}) }) };
      });
    }
    // 人試用回報的畫面：照回報時的鏡頭，回報的岩點上色、點的位置畫圈
    if (fbOpen.length) {
      const got = await S.page.evaluate(async (items) => {
        const src = document.querySelector('script[type="module"][src*="app.js"]').src;
        return (await import(src)).trialShots(items);
      }, fbOpen);
      for (const s of got) writeFileSync(join(dir, `fb-${s.id}.jpg`), Buffer.from(s.jpg.split(',')[1], 'base64'));
    }
    if (S.errors.length) fail(`Studio 出錯：\n${S.errors.join('\n')}`, 1);
  } finally { await S.browser.close(); }
  writeJson(join(dir, 'index.json'), index);
  const empty = Object.values(index.holds).filter(h => h.empty).length;
  if (fbOpen.length) {
    console.log(`人試用回報的 ${fbOpen.length} 個問題（回報時的畫面，岩點上色、點的位置畫紅圈）：`);
    for (const x of fbOpen) console.log(`  ${x.id}${x.hold ? `（岩點 ${x.hold}）` : ''}「${x.text}」 ${join(dir, `fb-${x.id}.jpg`)}`);
    console.log(`修好後記下：node tools/studio.mjs resolve3d ${P.dir} <回報 id> --note "怎麼處理"`);
    sync(P);   // 題目的證據換成剛出的畫面
    if (!ids.length) return;
  }
  console.log(`出了 ${ids.length} 顆岩點的圖、${sheets.length} 張總圖（每格左邊原樣、右邊是${glow ? '岩點貓點選後的樣子：底圖暗彩、這顆原色加光暈' : '外框'}，左上角是編號）：`);
  if (glow) console.log(`光暈的標準：光暈要剛好包住這一顆整顆岩點、外圈平順。光暈溢到牆面或別顆、只亮一部分、亮到的不是岩點、中間挖洞或缺一塊、形狀怪（尖角、碎片、條紋）都不算過：不是岩點 off，範圍不對 reshape（poly 是右半張的像素 0～${shotSize}，沿岩點邊緣描）`);
  for (const f of sheets) console.log(`  ${f}`);
  if (empty) console.log(`${empty} 顆在模型上沒有範圍（看不到，沒有圖）：判斷 off`);
  console.log(`逐張看完，每顆都要有判斷，寫成 JSON 陣列 [{ "n": 編號, "v": "keep|off|reshape|retake", "poly": [[x,y]…], "note": "…" }]，跑 node tools/studio.mjs review3d ${P.dir} <判斷.json>`);
  console.log('標準跟人在 Studio 逐顆修一樣，從嚴：右半張的邊線要貼著岩點邊緣。膠帶、貼紙、商標、螺絲孔、陰影、牆板碎片、同一顆被拆開的碎塊 off；邊線偏移、溢到牆面或別顆、只圍到一部分、凹處被填滿的 reshape（poly 是右半張的像素 0～256，沿岩點邊緣描）。看不準也要自己判斷（不交給人）；只有這一區的照片明顯不夠、糊到認不出才 retake，note 寫哪裡不夠');
}

/** AI 檢查的前兩階段出圖：model（模型完整、切口直、不貼岩點）、path（沿牆鏡頭由右走到左，每面牆的下半部看得清楚）。圖在 .studio/work/check/，看完 answer 那一題 */
async function check3d(P, kind) {
  if (!['model', 'path'].includes(kind)) fail('用法：node tools/studio.mjs check3d <資料夾> <model|path>');
  const doc = wall3dDoc(P); if (!doc) fail(`${P.dir} 不是 3D 牆的工作資料夾`);
  const dir = join(P.work, 'check', kind); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const S = await openStudio3d(P, ['wall.json', doc.model, doc.faces]).catch(e => fail(e.message, 1));
  let res;
  try {
    res = await S.page.evaluate(async (kind) => {
      const src = document.querySelector('script[type="module"][src*="app.js"]').src;
      return (await import(src)).checkShots(kind);
    }, kind);
    if (S.errors.length) fail(`Studio 出錯：\n${S.errors.join('\n')}`, 1);
  } finally { await S.browser.close(); }
  res.shots.forEach((x, i) => writeFileSync(join(dir, `${String(i + 1).padStart(2, '0')}-${x.name.replace(/[\s/・]+/g, '-')}.jpg`), Buffer.from(x.jpg.split(',')[1], 'base64')));
  console.log(`出了 ${res.shots.length} 張（${dir}）：`);
  for (const f of readdirSync(dir).sort()) console.log(`  ${join(dir, f)}`);
  if (kind === 'model') console.log('第一階段的標準：模型完整（牆面沒有破洞、缺角）；上下左右的切口在每面牆上是直線、只在轉角轉折，抱石墊切成直線；切口離最外側的岩點留一段牆（不要貼著岩點切）；牆腳、牆頂沒有糊掉、拉長或不自然的貼圖塊。逐張放大看，不自然就修，不交給人');
  else console.log(`第二階段的標準：像人站在牆前由右走到左，平視和低頭都看得到牆；每面牆（內角兩側、cave、側牆）的下半部都在畫面裡、看得清楚；沒有整張對著牆外或斜到看不見牆面。最遠距離 ${res.dMax.toFixed(2)}，點不到的岩點 ${res.missed} 顆（要是 0）`);
  console.log(`看完：沒問題 node tools/studio.mjs answer ${P.dir} <這一階段的題目 id> ok --note "看了什麼"；題目 id 用 ask 看`);
}

/** 記下 AI 的判斷：off、reshape 直接改 wall.json（跟人在 Studio 改的同一份資料），全部記進 review3d.json；retake 的圖留給人看（同步） */
function review3d(P, file) {
  const doc = wall3dDoc(P);
  if (!doc) fail(`${P.dir} 不是 3D 牆的工作資料夾`);
  if (!file) fail('用法：node tools/studio.mjs review3d <資料夾> <判斷.json>');
  const index = readJson(join(P.work, 'look', 'index.json'), null);
  if (!index) fail(`還沒出圖：先跑 node tools/studio.mjs look3d ${P.dir}`);
  const byN = new Map(Object.entries(index.holds).map(([id, h]) => [h.n, id]));
  const list = readJson(resolve(file), null);
  if (!Array.isArray(list)) fail(`${file} 要是 JSON 陣列`);
  const review = readJson(review3dPath(P), null) || Wall3dReview.empty(), exported = new Set(Wall3dReview.exported(doc)), at = now(), count = {}, errs = [];
  const clamp = (x) => +Math.min(Math.max(x / index.size, 0), 1).toFixed(4);
  const fbItems = readJson(feedback3dPath(P), null)?.items || [];
  // 光暈圖是從整個畫面裁出來放大的：右半張的像素換回整個畫面的比例，再換到修點用的標準鏡頭（50°、正方形、沒裁切）
  const toStdOf = (shot) => { const [cx, cy, cs] = shot.crop || [0, 0, 1], [sx, ox, sy, oy] = shot.std || [1, 0, 1, 0]; return ([px, py]) => { const u = cx + clamp(px) * cs, v = cy + clamp(py) * cs, x = sx * (u * 2 - 1) + ox, y = sy * (1 - v * 2) + oy; return [+((x + 1) / 2).toFixed(4), +((1 - y) / 2).toFixed(4)]; }; };
  for (const x of list) {
    if (x.v === 'add' && x.n !== undefined) {
      // 補漏掉的岩點（AI 在光暈圖看到沒偵測到的岩點、量體）：在那張圖的右半張描整顆（像素跟 reshape 一樣），照那張圖的鏡頭變成新的修點
      const shot = index.holds[byN.get(x.n)], poly = x.poly;
      if (!shot || !shot.c || shot.empty) { errs.push(`add #${x.n}：這次 look3d 沒有這張圖`); continue; }
      if (!Array.isArray(poly) || poly.length < 3 || !poly.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) { errs.push(`add #${x.n}：poly 要是右半張的像素，至少三點`); continue; }
      const id = 'p' + randomBytes(5).toString('hex');
      doc.edits = [...(doc.edits || []), { id, m3: { c: shot.c, p: poly.map(toStdOf(shot)), a: shot.a } }];
      review.holds[id] = { v: 'reshape', by, at, sig: Wall3dReview.sig(doc, id), note: x.note || `補上 #${x.n} 圖上漏掉的岩點`, re: 1 };
      count.add = (count.add || 0) + 1;
      console.log(`補上 ${id}（#${x.n} 的圖）`);
      continue;
    }
    if (x.v === 'add') {
      // 補漏掉的岩點（人回報「這裡漏了岩點」）：在回報時的畫面（fb-<回報 id>.jpg，Studio 的標準鏡頭 50°、正方形）描整顆，變成新的修點；之後照樣 look3d 看光暈
      const it = fbItems.find(f => f.id === x.fb), poly = x.poly, size = Number(x.size) || 512;
      if (!it || !it.camera) { errs.push(`add 要 fb：回報 id（${x.fb || '沒給'} 找不到）`); continue; }
      if (!Array.isArray(poly) || poly.length < 3 || !poly.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) { errs.push(`add ${x.fb}：poly 要是回報畫面的像素（0～${size}），至少三點`); continue; }
      const id = 'p' + randomBytes(5).toString('hex'), c = (v) => +Math.min(Math.max(v / size, 0), 1).toFixed(4);
      doc.edits = [...(doc.edits || []), { id, m3: { c: it.camera, p: poly.map(([px, py]) => [c(px), c(py)]), a: 1 } }];
      review.holds[id] = { v: 'reshape', by, at, sig: Wall3dReview.sig(doc, id), note: x.note || `補上回報 ${x.fb} 漏掉的岩點`, re: 1 };
      count.add = (count.add || 0) + 1;
      console.log(`補上 ${id}（回報 ${x.fb}）`);
      continue;
    }
    const id = x.id || byN.get(x.n), shot = index.holds[id];
    if (!id || !shot) { errs.push(`找不到 ${x.id || `#${x.n}`}（要是這次 look3d 出圖的岩點）`); continue; }
    if (!exported.has(id)) { errs.push(`${id} 已經不在要發佈的岩點裡`); continue; }
    if (x.v === 'off') {
      const h = doc.holds.find(h => h.id === id);
      if (h) h.off = 1;   // 原本的岩點標 off；修過的外框也拿掉（不然還會從別顆搶走面，例如量體的碎塊重描成整顆，拿掉後量體挖一個洞）
      doc.edits = (doc.edits || []).filter(e => e.id !== id);   // 補畫的直接拿掉
    } else if (x.v === 'reshape') {
      const poly = x.poly;
      if (shot.empty) { errs.push(`${id}：模型上看不到，不能重描`); continue; }
      if (!Array.isArray(poly) || poly.length < 3 || !poly.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) { errs.push(`${id}：reshape 要有 poly（右半張的像素，至少三點）`); continue; }
      if (shot.crop && !shot.std) { errs.push(`${id}：這張光暈圖是舊版出的（沒有鏡頭換算），重跑 look3d --glow 再描`); continue; }
      doc.edits = [...(doc.edits || []).filter(e => e.id !== id), { id, m3: { c: shot.c, p: poly.map(toStdOf(shot)), a: shot.a, ...(x.k ? { k: 1 } : {}) } }];
    } else if (x.v === 'retake') {
      if (!x.note) { errs.push(`${id}：retake 要寫 note（哪裡的照片不夠）`); continue; }
      if (!shot.empty) { mkdirSync(join(P.dir, '.studio', 'evidence'), { recursive: true }); copyFileSync(join(P.work, 'look', `${id}.jpg`), join(P.dir, '.studio', 'evidence', `${id}.jpg`)); }
    } else if (x.v !== 'keep') { errs.push(`${id}：v 要是 keep、off、reshape、retake（AI 自己判斷到底；只有照片明顯不夠才 retake）`); continue; }
    const re = (review.holds[id]?.re || 0) + (x.v === 'reshape' ? 1 : 0);
    review.holds[id] = { v: x.v, by, at, sig: Wall3dReview.sig(doc, id), ...(x.note ? { note: x.note } : {}), ...(re ? { re } : {}) };
    count[x.v] = (count[x.v] || 0) + 1;
  }
  if (errs.length) fail(`判斷有問題，全部沒有寫入：\n${errs.join('\n')}`);
  if (doc.edits && !doc.edits.length) delete doc.edits;
  writeFileSync(join(P.dir, 'wall.json'), JSON.stringify(doc));
  writeJson(review3dPath(P), review);
  const { state } = sync(P);
  logRun(P, 'review3d', [file], state);
  const st = Wall3dReview.status(doc, review);
  console.log(`記下 ${list.length} 顆（${Object.entries(count).map(([k, n]) => `${k} ${n}`).join('、')}）。要發佈的 ${st.total} 顆：AI 看過 ${st.looked}、還要看 ${st.need.length}（重描的要再看一次）${st.retake.length ? `、照片不夠 ${st.retake.length}` : ''}`);
  if (st.need.length) console.log(`接著跑 node tools/studio.mjs look3d ${P.dir}`);
}

/**
 * 一鍵試用：本機開伺服器（只接 127.0.0.1），/ 是這份 Studio，/work3d/ 是工作資料夾；
 * 連結 /studio/wall3d/#src=/work3d/&step=try 直接打開到試用步驟。只收 wall.json、feedback3d.json 的寫回（PUT），其他唯讀
 */
async function try3d(P) {
  const doc = wall3dDoc(P);
  if (!doc) fail(`${P.dir} 不是 3D 牆的工作資料夾`);
  const remote = readJson(P.remote, null);
  // 先烘好成品放在 trial/（跟發佈同一份）：人打開試用就是最後的樣子，不用在手機上等烘焙
  if (!has('--no-bake')) {
    const t0 = Date.now(), S = await openStudio3d(P, ['wall.json', doc.model, doc.faces]).catch(e => fail(e.message, 1));
    try {
      const pack = await Promise.race([
        S.page.evaluate(async () => (await import(document.querySelector('script[type="module"][src*="app.js"]').src)).trialPack()),   // 頁面上那一份模組（含版本參數）
        new Promise((_, no) => setTimeout(() => no(new Error('烘焙超過 10 分鐘，停掉')), 10 * 60_000)),
      ]);
      const out = join(P.dir, 'trial');
      rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
      for (const [n, b] of Object.entries(pack.files)) writeFileSync(join(out, n), Buffer.from(b, 'base64'));
      writeJson(join(out, 'manifest.json'), { sig: pack.sig, files: Object.keys(pack.files), at: now() });
      console.log(`烘好試用的成品（${Math.round((Date.now() - t0) / 1000)} 秒）：${out}`);
    } catch (e) { fail(`烘不出試用的成品：${e.message}${S.errors.length ? `\n${S.errors.join('\n')}` : ''}`, 1); } finally { await S.browser.close(); }
  }
  if (remote) {
    // 接了同步服務：先推上最新的工作檔，再發這個專案的試用權杖（只能讀這個專案、寫回回報；放在 # 後面，不進伺服器紀錄）
    await push(P);
    const r = await call(remote.url, { body: { op: 'trialLink', pid: remote.pid, ...(daysArg ? { days: Number(daysArg) } : {}) } });
    if (!r.token) fail(`同步服務發不了試用連結：${r.error || r.status}`, 1);
    const u = remote.url === SYNC_URL ? '' : `&u=${encodeURIComponent(remote.url)}`;
    console.log(`試用「${doc.name || doc.id}」（手機、電腦都能開，${new Date(r.exp).toLocaleDateString()} 前有效）：\n${site}/studio/wall3d/?app#sync=${remote.pid}&t=${r.token}${u}&step=try\n回報寫回同步服務：node tools/studio.mjs pull ${P.dir} 拿回來，status 會出題`);
    // 烘過成品之後，無畫面瀏覽器、連線留下的東西會讓 node 好幾分鐘不結束；事情做完就結束（工具不能讓代理卡著等）
    await new Promise(ok => process.stdout.write('', ok));
    process.exit(0);
  }
  const { createServer } = await import('node:http');
  const port = Number(portArg || 8790), WRITABLE = new Set(['wall.json', 'feedback3d.json']);
  const types = { ...MIME, '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.bin': 'application/octet-stream', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname), work = path.startsWith('/work3d/');
    const base = resolve(work ? P.dir : ROOT), rel = work ? path.slice('/work3d/'.length) : path.slice(1);
    let file = resolve(base, rel);
    if (file !== base && !file.startsWith(base + sep)) { res.writeHead(403).end(); return; }
    if (req.method === 'PUT') {
      if (!work || !WRITABLE.has(rel)) { res.writeHead(403).end(); return; }
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          const j = JSON.parse(text);
          if (rel === 'wall.json' && (j.format !== 'climbio-3d-wall/1' || j.id !== doc.id)) throw new Error('不是這面牆');
          if (rel === 'feedback3d.json' && j.format !== Wall3dFeedback.FORMAT) throw new Error('格式不對');
        } catch (e) { res.writeHead(400).end(e.message); return; }
        writeFileSync(file, text);
        console.log(`${new Date().toLocaleTimeString()} 寫回 ${rel}`);
        res.writeHead(204).end();
      });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': types[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
  });
  await new Promise((ok, no) => { server.once('error', no); server.listen(port, '127.0.0.1', ok); }).catch(e => fail(e.code === 'EADDRINUSE' ? `連接埠 ${port} 有別的程式在用：加 --port 換一個` : e.message, 1));
  console.log(`一鍵試用「${doc.name || doc.id}」（Chrome 打開）：\nhttp://127.0.0.1:${port}/studio/wall3d/#src=/work3d/&step=try\n回報、試用完、存檔都寫回 ${P.dir}；試用完按 Ctrl-C 結束`);
}

/** 代理處理完人試用的一筆回報：記下怎麼處理（修岩點照樣用 look3d、review3d） */
function resolve3d(P, id) {
  const doc = wall3dDoc(P);
  if (!doc) fail(`${P.dir} 不是 3D 牆的工作資料夾`);
  if (!id || !note) fail('用法：node tools/studio.mjs resolve3d <資料夾> <回報 id> --note "怎麼處理"');
  const fb = readJson(feedback3dPath(P), null);
  if (!fb) fail('這個資料夾沒有人試用的回報（feedback3d.json）');
  try { Wall3dFeedback.resolve(fb, id, by, note); } catch (e) { fail(e.message); }
  writeJson(feedback3dPath(P), fb);
  const { state } = sync(P);
  logRun(P, 'resolve3d', [id], state);
  const st = Wall3dFeedback.status(doc, fb);
  console.log(`記下回報 ${id} 的處理。還沒處理的回報 ${st.open.length} 個${st.open.length ? '' : '；接著請人再試用這一版（status 會出題）'}`);
}

/**
 * 發佈 3D 牆：烘焙在瀏覽器裡跑（wall3dkit/bakepack.js），所以用無畫面 Chromium 開 Studio 的 3D 牆，放工作檔、按發佈。
 * 金鑰要交給瀏覽器（Studio 發佈時帶 X-Studio-Key 代替 App Check），所以要有 CLIMBIO_STUDIO_KEY；用 Network secret 的雲端環境發佈不了
 */
async function publish3d(P) {
  const ok = approvedOrFail(P), doc = wall3dDoc(P);
  if (!KEY()) fail('要身分：gh auth login（repo 的協作者）或環境變數 CLIMBIO_STUDIO_KEY（無畫面的 Studio 要拿到身分本身；只有 Network secret 的雲端環境發佈不了 3D 牆，在本機發佈）');
  const gym = (gymArg || doc.gym || '').trim();
  if (!gym) fail('要岩館名：wall.json 的 gym 或 --gym（來自原始資料，不推測）');
  const runs = readLines(P.runs).filter(r => ['publish', 'fetch3d'].includes(r.cmd) && /^[0-9a-z]{16}$/.test(r.args?.[0] || ''));
  const origin = originArg || runs.at(-1)?.args[0] || '';
  const names = ['wall.json', doc.model, doc.faces, 'base-wall.json', 'thumb.jpg'].filter(n => existsSync(join(P.dir, n)));
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ locale: 'zh-TW', viewport: { width: 1280, height: 800 } });
    await context.addInitScript(([u, k]) => { localStorage.setItem('climbio.studio.remote', JSON.stringify({ url: u, key: k })); }, [URL_ENV, KEY()]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${studioArg || site}/studio/wall3d/`);
    // 上一版：Studio 從這台的發佈紀錄（IndexedDB climbio-wall3d 的 published，studio/published.js）拿 origin
    if (origin) await page.evaluate(([wall, id]) => new Promise((res, rej) => {
      const r = indexedDB.open('climbio-wall3d', 2);
      r.onupgradeneeded = () => { for (const n of ['dirs', 'published']) if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n); };
      r.onsuccess = () => { const t = r.result.transaction('published', 'readwrite'); t.objectStore('published').put({ last: id, list: [{ id, t: Date.now() }] }, wall); t.oncomplete = res; t.onerror = () => rej(t.error); };
      r.onerror = () => rej(r.error);
    }), [doc.id, origin]);
    await page.locator('#files').setInputFiles(names.map(n => join(P.dir, n)));
    await page.waitForFunction(() => document.querySelector('#gate')?.hidden || !document.querySelector('#gateErr')?.hidden, null, { timeout: 10 * 60_000 });
    if (await page.locator('#gateErr').isVisible()) fail(`打不開工作檔：${await page.locator('#gateErr').textContent()}`, 1);
    await page.locator('#publish').click();
    await page.locator('#publishDlg input.field').fill(gym);
    if (await page.locator('#pubGo').isDisabled()) fail(`不能發佈：${await page.locator('#pubMsg').textContent()}`, 1);
    await page.locator('#pubGo').click();
    await page.waitForFunction(() => /m3d=[0-9a-z]{16}/.test(document.querySelector('#pubLink a')?.href || '') || /./.test(document.querySelector('#pubMsg')?.textContent || ''), null, { timeout: 60 * 60_000 });
    const link = await page.locator('#pubLink a').getAttribute('href').catch(() => '');
    const id = /m3d=([0-9a-z]{16})/.exec(link || '')?.[1];
    if (!id) fail(`發佈失敗：${await page.locator('#pubMsg').textContent()}${errors.length ? `\n${errors.join('\n')}` : ''}`, 1);
    logRun(P, 'publish', [id], readJson(P.state, {}));
    console.log(`發佈了「${doc.name || doc.id}」：${link}（版本 ${id}${origin ? `，接在 ${origin} 後面` : ''}）；核准的人 ${ok.by}（${ok.at}）`);
  } finally { await browser.close(); }
}

/** 給其他工具（tools/guidebook.mjs publish）查：這一版有沒有人核准發佈；有的話結束碼 0、印出核准的判斷 */
function approved(P) {
  const { questions, decisions } = sync(P);
  const ok = approval(questions, decisions);
  console.log(JSON.stringify(ok ? { ok: true, by: ok.by, at: ok.at, q: ok.q } : { ok: false }));
  process.exitCode = ok ? 0 : 1;
}

/**
 * 這個環境（本機、Codex Cloud、Claude Code 雲端…）能不能一起工作：一項一行，ok／缺什麼、怎麼補。
 * 雲端環境的網路 allowlist、環境變數（secret）只有使用者能在環境設定裡改，這裡只檢查、說清楚
 */
async function doctor() {
  const rows = [];
  const row = (ok, name, msg) => rows.push({ ok, name, msg });
  const major = +process.versions.node.split('.')[0];
  row(major >= 20, 'Node', major >= 20 ? process.versions.node : `${process.versions.node}，要 20 以上`);
  const who = studioAuth().from;
  row(true, '身分', who ? `用 ${who}` : '機器裡沒有：靠雲端環境的 Network secret 帶（看下面「身分對不對」）；本機先 gh auth login');
  row(true, '服務網址', URL_ENV);
  {
    let r = null, err = '';
    try { r = await (await fetch(URL_ENV, { headers: keyHeader() })).json(); } catch (e) { err = e.cause?.code || e.message; }
    row(!!r?.ok, '連得到服務', r?.ok ? new URL(URL_ENV).host : r ? '服務沒開（Secret STUDIO_KEY 沒設）' : `連不上（${err}）：雲端環境的網路 allowlist 要加 ${new URL(URL_ENV).host}`);
    if (r?.ok) row(!!r.auth, '身分對不對', r.auth ? '對' : NO_KEY);
  }
  let chromium = false;
  try { const { chromium: c } = await import('playwright'); chromium = existsSync(c.executablePath()); } catch { /* 沒裝 playwright */ }
  row(chromium, '建書（選用）', chromium ? 'Chromium 在' : '沒有 Chromium：convert build 要先 npx playwright install chromium（status、ask、answer、pull、push 不用）');
  const need = rows.filter(x => !x.ok && x.name !== '建書（選用）' && x.name !== '服務網址');
  if (json) return console.log(JSON.stringify({ ok: !need.length, checks: rows }, null, 1));
  for (const x of rows) console.log(`${x.ok ? 'ok  ' : '缺  '} ${x.name}：${x.msg}`);
  console.log(need.length ? '\n這個環境還不能一起工作，先補上「缺」的項目' : '\n可以一起工作');
  if (need.length) process.exitCode = 1;
}

/** start <gym|crag|book|3d> <資料夾> [輸入…]：任務的統一入口，印下一步（細節在 tools/studio-start.mjs） */
async function start(a) {
  const [type, dir, ...inputs] = a;
  if (!type || !dir) fail('用法：node tools/studio.mjs start <gym|crag|book|3d> <資料夾> [照片或路線書…]');
  const { plan, fsExists } = await import('./studio-start.mjs');
  const r = plan({ type, dir: resolve(dir), inputs, exists: fsExists });
  console.log(r.lines.join('\n'));
  if (r.run) { console.log(''); const x = spawnSync(process.execPath, [join(ROOT, 'tools', r.run[0]), ...r.run.slice(1)], { stdio: 'inherit' }); process.exitCode = x.status ?? 1; }
}

const cmd = args.shift();
const P = ['projects', 'doctor', 'publish', 'frames', 'start'].includes(cmd) ? null : project(args.shift());
if (cmd === 'start') await start(args);
else if (cmd === 'frames') frames(args[0], args[1]);
else if (cmd === 'doctor') await doctor();
else if (cmd === 'publish') await publish(args.shift());
else if (cmd === 'projects') await projects(args[0]);
else if (cmd === 'link') link(P, args[0]);
else if (cmd === 'push') await push(P);
else if (cmd === 'pull') await pull(P);
else if (cmd === 'status') status(P);
else if (cmd === 'ask') ask(P);
else if (cmd === 'answer') answer(P, args[0], args[1]);
else if (cmd === 'note') addNote(P, args.join(' '));
else if (cmd === 'convert') convert(P, args[0], args.slice(1));
else if (cmd === 'apply') apply(P, args[0]);
else if (cmd === 'approved') approved(P);
else if (cmd === 'fetch3d') await fetch3d(P, args[0]);
else if (cmd === 'look3d') await look3d(P);
else if (cmd === 'check3d') await check3d(P, args.shift());
else if (cmd === 'review3d') review3d(P, args[0]);
else if (cmd === 'resolve3d') resolve3d(P, args[0]);
else if (cmd === 'try3d') await try3d(P);
else fail('用法：node tools/studio.mjs doctor|status|ask|answer|note|convert|apply|link|push|pull|projects|publish|approved|fetch3d|frames …（說明在檔案開頭）');
