#!/usr/bin/env node
// 已公開的牆「再精修、再發佈」的一條龍（給 AI 代理，可重複做多次）：
// 公開牆每個版本最多改動 30% 的岩點、新版本要帶這一版真正算出來的研究記錄、App 看的現行版要 reviewed、
// 路線登記在照片編號、Hold Lab 的比對資料也要跟著換。這些以前各自手動做、很容易漏，這支工具把它們串起來並檢查。
//
//   node tools/wall-republish.mjs plan <牆包 id> <新外框.json> <輸出資料夾> [--first 岩點 id,…] [--retire id,…] [--unretire id,…] [--agent 名稱] [--method 說明]
//       讀資料集上這面牆的最新版當底稿；新外框.json 是 { 岩點 id: [[x,y]…] }（只放有改的，沒有的 id 就新增）；
//       --first：優先放進最前面的版本（例如路線用到的岩點，這樣路線最早就完整）；--retire／--unretire：停用／改回有效
//       自動切成多個版本（每版 ≤ 30%），寫成 <輸出資料夾>/pack_v<N>/（可以直接給 studio.mjs publish）；
//       只有最後一版帶「逐顆檢查完了」的記錄（reviewed 要人同意，加 --reviewed 才寫，沒加就不寫）。
//   node tools/wall-republish.mjs publish <輸出資料夾> --by human:<名稱> --said "<原話>"
//       依序回答題目（重複岩點先由 AI 看圖答，這裡只記人核准發佈）、發佈每一版；任何一版失敗就停。
//   node tools/wall-republish.mjs stages <牆包 id>
//       有 research/hold-lab/<牆包 id>/ 的牆：把比對資料的「AI 檢查」階段換成現行版的有效岩點（要 HF 權杖：CLIMBIO_HF_TOKEN，或檔案 CLIMBIO_HF_TOKEN_FILE）
//   node tools/wall-republish.mjs check <牆包 id> [<照片編號>]
//       發佈後的一致性檢查：現行版＝最新版、記錄的數字跟畫面一致、每條公開路線的岩點都有效、路線登記在照片編號、比對資料的顆數對得上。有問題以 1 結束並列出。
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const { buildRecord } = require('../studio/wall/record.js');
const { checkVersion, MAX_CHANGE_SHARE } = require('../functions/wall-check.js');
const HF = 'https://huggingface.co/datasets/climbio/walls/resolve/main/';
const WALLS_FN = process.env.CLIMBIO_WALLS_URL || 'https://asia-east1-firebase-climbio.cloudfunctions.net/walls';
const die = (m) => { console.error(m); process.exit(1); };

// ---------- 純函式（有測試）----------
const ringOf = (p) => { const r = p.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]); return [[...r, r[0]]]; };
const same = (a, b) => a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);
export const polysOf = (view) => Object.fromEntries(view.marks.map(m => [m.node, m.geometry.coordinates[0].slice(0, -1)]));
export const retiredOf = (view) => new Set(view.nodes.filter(n => n.type === 'hold' && n.props && n.props.retired).map(n => n.id));

/** 每一步最多改幾顆：跟發佈端（functions/wall-check.js）同一個算法，再留 0 顆餘裕 */
export const stepLimit = (size) => Math.max(3, Math.ceil(MAX_CHANGE_SHARE * size));

/**
 * 把一次精修切成多個版本（每版相對前一版改動 ≤ 30%）。
 * prev：前一版的畫面；next：{ id: poly }；retire／unretire：id 清單；first：優先順序（先改這些）。
 * 回傳 [view…]（每個是完整畫面，依序發佈）。同一顆岩點不會被拆成兩次改。
 */
export function planVersions({ prev, next, retire = [], unretire = [], first = [] }) {
  const ids = [...new Set([...first, ...Object.keys(next), ...retire, ...unretire])];
  const rank = new Map(first.map((id, i) => [id, i]));
  ids.sort((a, b) => (rank.has(a) ? rank.get(a) : 1e9) - (rank.has(b) ? rank.get(b) : 1e9));
  const ret = new Set(retire), unret = new Set(unretire);
  let cur = JSON.parse(JSON.stringify(prev)); const out = [];
  while (ids.length) {
    const size = cur.nodes.filter(n => n.type === 'hold').length, limit = stepLimit(size), view = JSON.parse(JSON.stringify(cur));
    const nodes = new Map(view.nodes.map(n => [n.id, n])); let n = 0, todo = [];
    const poly = polysOf(view);
    while (ids.length && n < limit) {
      const id = ids.shift(); todo.push(id);
      const node = nodes.get(id) || (() => { const x = { id, type: 'hold' }; view.nodes.push(x); nodes.set(id, x); return x; })();
      if (ret.has(id)) node.props = { ...(node.props || {}), retired: true };
      if (unret.has(id) && node.props) { delete node.props.retired; if (!Object.keys(node.props).length) delete node.props; }
      if (next[id]) { const m = { node: id, geometry: { type: 'Polygon', coordinates: ringOf(next[id]) } }, i = view.marks.findIndex(k => k.node === id); if (i >= 0) view.marks[i] = m; else view.marks.push(m); }
      const before = poly[id], after = view.marks.find(k => k.node === id).geometry.coordinates[0].slice(0, -1);
      if (!before || !same(before, after) || retiredOf(cur).has(id) !== retiredOf(view).has(id)) n++;
    }
    if (n === 0) { cur = view; continue; }   // 這一輪都沒有真的改（跟前一版一樣）
    checkVersion(view, cur);   // 發佈端同一套驗證：外框合理、不少岩點、變動 ≤ 30%
    out.push(view); cur = view;
  }
  return out;
}

/** 這一系列精修的研究記錄：base＝系列開始前的有效岩點（自動結果的替身），holds＝最後的有效岩點；不寫 final（讓報告用 reshaped 還原前後） */
export function recordFor({ base, final, sha256, tools, reviews = [], reviewed = false, flagged = {} }) {
  const retB = retiredOf(base), retF = retiredOf(final), pb = polysOf(base), pf = polysOf(final);
  const baseMap = {};
  for (const n of base.nodes) if (n.type === 'hold' && !retB.has(n.id)) baseMap[n.id] = { poly: pb[n.id], flags: flagged[n.id] || [] };
  const holds = final.nodes.filter(n => n.type === 'hold' && !retF.has(n.id)).map(n => ({ id: n.id, poly: pf[n.id] }));
  const rec = buildRecord({ id: final.id, sha256, license: final.license || 'CC-BY-SA-4.0', reviewed, tools, base: baseMap, holds, w: final.w, h: final.h });
  if (rec) rec.reviews = reviews;
  return rec;
}

// ---------- 網路 ----------
const getJson = async (url) => { const r = await fetch(url, { signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json(); };
const getBytes = async (url) => { const r = await fetch(url, { signal: AbortSignal.timeout(120000), redirect: 'follow' }); if (!r.ok) throw new Error(`${url} ${r.status}`); return Buffer.from(await r.arrayBuffer()); };
const bust = () => `?x=${Date.now()}`;
const latestOf = async (pack) => {
  const rows = (await (await fetch(`${HF}walls.jsonl${bust()}`)).text()).split('\n').filter(Boolean).map(l => JSON.parse(l));
  const row = rows.find(r => r.id === pack) || die(`目錄裡沒有牆 ${pack}`); return row;
};
async function postWalls(body) { const r = await fetch(WALLS_FN, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) }); return r.json(); }

// ---------- plan ----------
async function plan(rest) {
  const [pack, file, out] = rest; if (!pack || !file || !out) die('用法：plan <牆包 id> <新外框.json> <輸出資料夾> [--first …] [--retire …] [--unretire …] [--reviewed --by human:<名稱> --said "<原話>"]');
  const flag = (n) => { const i = rest.indexOf(n); return i < 0 ? '' : rest[i + 1] || ''; }, list = (n) => flag(n).split(',').filter(Boolean);
  const next = JSON.parse(readFileSync(file, 'utf8')), row = await latestOf(pack), dir = `${HF}${row.dir}`;
  const index = await getJson(`${dir}index.json${bust()}`), layerHref = index.items[0].href, layer = await getJson(`${dir}${layerHref}${bust()}`);
  const view = await getJson(`${dir}${layer.href}${bust()}`), jpg = await getBytes(`${dir}${view.href}`), thumb = await getBytes(`${dir}${view.props.thumb}`);
  const views = planVersions({ prev: view, next, retire: list('--retire'), unretire: list('--unretire'), first: list('--first') });
  if (!views.length) die('沒有任何改動');
  const reviewed = rest.includes('--reviewed'), reviews = reviewed ? [{ by: flag('--by'), kind: 'human', said: flag('--said') }] : [];
  if (reviewed && (!/^human:/.test(flag('--by')) || !flag('--said'))) die('--reviewed 要帶 --by human:<名稱> 和 --said "<原話>"：逐顆檢查完了是人的判斷，代理不替人按');
  const sha256 = createHash('sha256').update(jpg).digest('hex'), tools = { by: 'agent', agent: flag('--agent') || process.env.CLIMBIO_AGENT || 'agent:claude', method: flag('--method') || '精修後再發佈', base: `v${row.version}（精修前）` };
  const resolved = resolve(out); mkdirSync(resolved, { recursive: true });
  views.forEach((v, i) => {
    const d = join(resolved, `pack_v${row.version + 1 + i}`); rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true });
    const last = i === views.length - 1;
    writeFileSync(join(d, 'index.json'), JSON.stringify(index)); writeFileSync(join(d, layerHref), JSON.stringify(layer));
    writeFileSync(join(d, `${v.id}.json`), JSON.stringify(v)); writeFileSync(join(d, v.href), jpg); writeFileSync(join(d, v.props.thumb), thumb);
    // 每一版都帶這一版算出來的記錄（相對精修前）；只有最後一版 reviewed，現行版才會換成它
    const rec = recordFor({ base: view, final: v, sha256, tools, reviewed: reviewed && last, reviews: last ? reviews : [] });
    if (rec) writeFileSync(join(d, `${v.id}.edits.json`), JSON.stringify(rec));
    console.log(`${d}：改動 ${new Set(Object.keys(next)).size ? '' : ''}${v.nodes.length} 顆岩點的畫面，${last ? (reviewed ? '最後一版（reviewed，現行版會換成它）' : '最後一版（沒帶 --reviewed：現行版不會換）') : '中間版本'}`);
  });
  console.log(`共 ${views.length} 版（v${row.version + 1} 到 v${row.version + views.length}）。下一步：node tools/wall-republish.mjs publish ${out} --by human:<名稱> --said "<原話>"`);
}

// ---------- publish ----------
function studio(args) {   // 每個子行程最多 3 分鐘，逾時就當失敗
  const r = spawnSync(process.execPath, ['--no-warnings', new URL('./studio.mjs', import.meta.url).pathname, ...args], { encoding: 'utf8', timeout: 180000, killSignal: 'SIGKILL' });
  return { ok: r.status === 0, text: `${r.stdout || ''}${r.stderr || ''}${r.error ? `\n${r.error.message}` : ''}`.trim() };
}
async function publishAll(rest) {
  const [out] = rest, flag = (n) => { const i = rest.indexOf(n); return i < 0 ? '' : rest[i + 1] || ''; };
  const by = flag('--by'), said = flag('--said');
  if (!out || !/^human:/.test(by) || !said) die('用法：publish <輸出資料夾> --by human:<名稱> --said "<原話>"（發佈就是公開、收不回，要有人在對話裡同意；代理不替人答）');
  const packs = readdirSync(out).filter(n => /^pack_v\d+$/.test(n)).sort((a, b) => +a.slice(6) - +b.slice(6));
  for (const p of packs) {
    const dir = join(resolve(out), p);
    // 還沒答的題目：重複岩點之類要 AI 先看圖答（這裡不替答），只剩「要不要公開發佈」才由人核准
    const asks = JSON.parse(studio(['ask', dir, '--json']).text.split('\n').filter(l => l.startsWith('[') || l.startsWith('{')).join('') || '[]'), qs = Array.isArray(asks) ? asks : asks.questions || [];
    const open = qs.filter(q => q.kind !== 'publish');
    if (open.length) die(`${p} 還有 ${open.length} 題 AI 要先答（${open.map(q => q.id).join('、')}）：看圖後 node tools/studio.mjs answer ${dir} <題 id> <答案>，再重跑 publish`);
    const q = qs.find(x => x.kind === 'publish');
    if (q) { const a = studio(['answer', dir, q.id, 'ok', '--by', by, '--said', said]); if (!a.ok) die(`${p} 記核准失敗：${a.text}`); }
    const r = studio(['publish', dir]); console.log(r.text.split('\n').slice(-2).join('\n')); if (!r.ok) die(`${p} 發佈失敗，後面的版本不發`);
  }
  console.log('都發佈了。接著：node tools/wall-republish.mjs stages <牆包 id>（有比對資料的牆）、再 node tools/wall-republish.mjs check <牆包 id>');
}

// ---------- stages ----------
async function stages(rest) {
  const [pack] = rest; if (!pack) die('用法：stages <牆包 id>');
  const url = `${HF}research/hold-lab/${pack}/stages.json${bust()}`, r = await fetch(url); if (!r.ok) return console.log('這面牆沒有 Hold Lab 比對資料，不用更新。');
  const d = await r.json(), row = await latestOf(pack), dir = `${HF}walls/${pack}/current/`;
  const index = await getJson(`${dir}index.json${bust()}`), layer = await getJson(`${dir}${index.items[0].href}${bust()}`), view = await getJson(`${dir}${layer.href}${bust()}`);
  const ret = retiredOf(view), polys = polysOf(view), live = view.nodes.filter(n => n.type === 'hold' && !ret.has(n.id)).map(n => polys[n.id].map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]));
  const ai = d.stages.find(s => s.id === 'ai'); if (!ai) die('比對資料沒有 ai 階段，格式不對');
  ai.count = live.length; ai.polys = live; d.note = `ai 階段換成 v${row.version} 的有效岩點（${new Date().toISOString().slice(0, 10)}）`;
  const tok = process.env.CLIMBIO_HF_TOKEN || (process.env.CLIMBIO_HF_TOKEN_FILE && readFileSync(process.env.CLIMBIO_HF_TOKEN_FILE, 'utf8').trim()) || die('要 HF 權杖：CLIMBIO_HF_TOKEN，或檔案 CLIMBIO_HF_TOKEN_FILE');
  const { createHf } = require('../functions/walls-dataset');
  const hf = createHf({ token: () => tok });
  await hf.commit(`研究比對資料 ${pack}：AI 檢查階段換成 v${row.version} 的有效岩點`, [{ path: `research/hold-lab/${pack}/stages.json`, bytes: Buffer.from(JSON.stringify(d)) }]);
  console.log(`比對資料已更新：AI 檢查 ${live.length} 顆（v${row.version}）`);
}

// ---------- check ----------
async function check(rest) {
  const [pack, photo] = rest; if (!pack) die('用法：check <牆包 id> [<照片編號>]');
  const bad = [], ok = (m) => console.log(`✓ ${m}`), no = (m) => { bad.push(m); console.log(`✗ ${m}`); };
  const row = await latestOf(pack), cur = `${HF}walls/${pack}/current/`, latest = `${HF}${row.dir}`;
  const files = (await (await fetch(`https://huggingface.co/api/datasets/climbio/walls/tree/main/walls/${pack}/current`)).json()), lfiles = (await (await fetch(`https://huggingface.co/api/datasets/climbio/walls/tree/main/${row.dir.replace(/\/$/, '')}`)).json());
  const oidMap = (a) => Object.fromEntries(a.map(x => [x.path.split('/').pop(), x.oid]));
  const co = oidMap(files), lo = oidMap(lfiles), diff = Object.keys(lo).filter(k => co[k] !== lo[k]);
  diff.length ? no(`現行版（current/）跟最新版 v${row.version} 不一致：${diff.join('、')}（沒有 reviewed 記錄的新版本不會成為現行版）`) : ok(`現行版 = 最新版 v${row.version}`);
  const index = await getJson(`${cur}index.json${bust()}`), layer = await getJson(`${cur}${index.items[0].href}${bust()}`), view = await getJson(`${cur}${layer.href}${bust()}`);
  const ret = retiredOf(view), live = new Set(view.nodes.filter(n => n.type === 'hold' && !ret.has(n.id)).map(n => n.id));
  let rec = null; try { rec = await getJson(`${cur}${view.id}.edits.json${bust()}`); } catch (e) { /* 沒有 */ }
  if (!rec) no('現行版沒有研究記錄（edits.json）'); else {
    rec.reviewed ? ok('記錄 reviewed: true') : no('記錄沒有 reviewed（現行版不會換成它）');
    rec.tools && rec.tools.by === 'phone' && rec.tools.agent ? no('記錄 tools.by 還是 phone（沿用了舊記錄？）') : ok(`記錄來源 ${rec.tools && rec.tools.by}`);
    const want = { deleted: rec.deleted.length, added: rec.added.length, reshaped: rec.reshaped.length };
    ['deleted', 'added', 'reshaped'].every(k => row.edits && row.edits[k] === want[k]) ? ok(`目錄的修改統計對得上（改 ${want.reshaped}、刪 ${want.deleted}、補 ${want.added}）`) : no(`目錄的修改統計跟記錄不一致：${JSON.stringify(row.edits)} ≠ ${JSON.stringify(want)}（記錄是沿用舊的嗎？）`);
  }
  const pid = photo || view.id, shared = await postWalls({ op: 'routes', pid });
  if (!shared.published) no(`照片編號 ${pid} 沒有登記成公開牆（路線登記在照片編號 ${view.id}，不是包 id）`);
  else {
    shared.src.project === pack ? ok(`${pid} 登記指到這個包，現行第 ${shared.ver} 版`) : no(`${pid} 登記指到別的包 ${shared.src.project}`);
    for (const x of shared.routes) {
      const n = JSON.parse(x.r).nodes.find(k => k.type === 'route'), miss = Object.keys(n.props.holds).filter(h => !live.has(h));
      miss.length ? no(`路線「${n.name || x.rid}」（${n.author || '?'}）用到 ${miss.length} 顆沒有的或停用的岩點：${miss.join('、')}（不要停用別人路線用到的岩點）`) : ok(`路線「${n.name || x.rid}」${Object.keys(n.props.holds).length} 顆岩點都有效`);
      const g = n.props.grade; g && typeof g === 'object' && !Object.values(g).every(v => typeof v === 'string') ? no(`路線「${n.name}」難度格式不對：${JSON.stringify(g)}（put 的 grade 要傳字串 "V7"）`) : 0;
    }
  }
  const lab = await fetch(`${HF}research/hold-lab/${pack}/stages.json${bust()}`);
  if (lab.ok) { const d = await lab.json(), ai = d.stages.find(s => s.id === 'ai'); ai && ai.count === live.size ? ok(`Hold Lab 比對資料 AI 階段 ${ai.count} 顆 = 現行版有效岩點`) : no(`Hold Lab 比對資料 AI 階段 ${ai && ai.count} 顆 ≠ 現行版有效岩點 ${live.size}（跑 stages 更新）`); }
  else ok('沒有 Hold Lab 比對資料（不需要）');
  if (bad.length) { console.log(`\n${bad.length} 項有問題`); process.exit(1); }
  console.log('\n全部一致。（目錄的路線條數每天 05:00 排程更新，不是即時）');
}

const [cmd, ...rest] = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  if (cmd === 'plan') await plan(rest); else if (cmd === 'publish') await publishAll(rest); else if (cmd === 'stages') await stages(rest); else if (cmd === 'check') await check(rest);
  else die('用法：node tools/wall-republish.mjs plan|publish|stages|check …（說明在檔案開頭）');
}
