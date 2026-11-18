#!/usr/bin/env node
// 路線書轉換的固定測試組：每個案例跑一次完整轉換（tools/guidebook.mjs 的 read → build），印出數字並和 expected.json 比較。
// 改轉換程式（讀檔、大綱、描線、換原圖）前後各跑一次，看數字變好還是變壞。
//
//   npm run eval:convert                         跑 tests/convert/ 的案例；跟 expected.json 不同時結束碼是 1
//   node tools/eval-convert.mjs --cases <資料夾>  跑別處的案例（例如真實的路線書，放在 repo 外，不進版控）
//   node tools/eval-convert.mjs --update          把這次的數字寫成 expected.json（確認變好了才寫）
//
// 案例是一個資料夾：outline.md（大綱）或一份路線書檔（.pdf、.docx、.html、.zip，先 read 成大綱），大綱用到的圖，
// originals/ 裡是作者的原圖（選用，建立時換上）。
import { readdirSync, existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const at = args.indexOf('--cases'), update = args.includes('--update');
const root = resolve(at >= 0 ? args[at + 1] : fileURLToPath(new URL('../tests/convert/', import.meta.url)));
const TOOL = fileURLToPath(new URL('guidebook.mjs', import.meta.url));
const run = (...a) => { try { return { out: execFileSync(process.execPath, [TOOL, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), status: 0 }; } catch (e) { return { out: `${e.stdout || ''}${e.stderr || ''}`, status: e.status }; } };

/** 報告 → 要比較的數字 */
const numbers = (rep) => {
  const why = (code) => rep.routes.filter(r => r.reasons.includes(code)).length;
  return {
    areas: rep.count.areas, walls: rep.count.walls, routes: rep.count.routes, photos: rep.count.photos ?? rep.count.images,
    ok: rep.routes.filter(r => r.status === 'ok').length, unassigned: why('unassigned'), stub: why('stub'), noTopo: why('no-topo'),
    errors: rep.issues.filter(i => i.level === 'error').length,
  };
};

const cases = readdirSync(root).filter(d => statSync(join(root, d)).isDirectory()).sort();
const rows = [];
let bad = 0;
for (const name of cases) {
  const dir = join(root, name), tmp = mkdtempSync(join(tmpdir(), `convert-${name}-`));
  try {
    let outline = join(dir, 'outline.md');
    if (!existsSync(outline)) {
      const src = readdirSync(dir).filter(f => /\.(pdf|docx|html?|zip)$/i.test(f)).map(f => join(dir, f));
      if (!src.length) { console.error(`${name}：沒有 outline.md，也沒有路線書檔`); bad++; continue; }
      const r = run('read', ...src, '--out', join(tmp, 'read'));
      outline = join(tmp, 'read', 'outline.md');
      if (!existsSync(outline)) { console.error(`${name}：讀不到路線書\n${r.out}`); bad++; continue; }
    }
    const originals = existsSync(join(dir, 'originals')) ? readdirSync(join(dir, 'originals')).map(f => join(dir, 'originals', f)) : [];
    const pack = join(tmp, 'pack'), b = run('build', outline, ...originals, '--out', pack);
    const rep = existsSync(join(pack, 'report.json')) ? JSON.parse(readFileSync(join(pack, 'report.json'), 'utf8')) : JSON.parse(run('check', outline, '--json').out);
    const got = numbers(rep), file = join(dir, 'expected.json');
    const want = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    const diff = want ? Object.keys(got).filter(k => got[k] !== want[k]) : [];
    if (update) writeFileSync(file, JSON.stringify(got, null, 1) + '\n');
    else if (!want || diff.length) bad++;
    rows.push({ name, got, want, diff });
    if (b.status === 1 && !existsSync(join(pack, 'report.json'))) console.error(`${name}：建立失敗\n${b.out}`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

const keys = ['areas', 'walls', 'routes', 'photos', 'ok', 'unassigned', 'stub', 'noTopo', 'errors'];
console.log(['案例', ...keys].join('\t'));
for (const r of rows) console.log([r.name, ...keys.map(k => (r.diff.includes(k) ? `${r.got[k]}（預期 ${r.want[k]}）` : r.got[k]))].join('\t') + (r.want || update ? '' : '\t（沒有 expected.json）'));
if (update) console.log(`寫好 ${rows.length} 份 expected.json`);
process.exit(bad && !update ? 1 : 0);
