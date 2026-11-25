// RouteKit 發布包：同一個版本、同一份原始碼，產生 npm 包（npm pack）、可自架的靜態 ZIP 與 SHA256SUMS。
// 用法：node tools/release-routekit.mjs [輸出資料夾]（預設 release-out/，不進版控）。只產生檔案，不發布、不上傳、不推送；
// 發布到 npm 或 GitHub Releases 另行核准。靜態包全是相對資源路徑，放到任何靜態主機都能開（資料要使用方自備，見 SELF-HOSTING.md）。
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = createRequire(import.meta.url)('../appkit/files.js');
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

export async function build(out) {
  const version = JSON.parse(readFileSync(join(root, 'routekit/package.json'), 'utf8')).version;
  let commit = 'unknown';
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, timeout: 15000 }).toString().trim(); } catch (e) { /* 不在 git 裡 */ }
  rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });

  // 1. npm 包：用 package.json 的 files 清單，npm pack 產生 .tgz（有逾時，卡住就失敗）
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const packed = execFileSync(npm, ['pack', join(root, 'routekit'), '--pack-destination', out, '--silent'], { cwd: root, timeout: 120000, shell: process.platform === 'win32' }).toString().trim().split(/\r?\n/).pop();

  // 2. 靜態 ZIP：通用內嵌頁（v2 資料夾，不含 official/ 官方適配層，內含 kit/ 的 Kit 副本，不依賴 Climbio）＋型別／協定＋授權＋對應原始碼說明＋自架說明；全是相對路徑
  const base = join(root, 'embed/routekit/v2'), entries = [];
  for (const p of walk(base)) if (!relative(base, p).split(sep).includes('official')) entries.push({ name: `routekit-embed/${relative(base, p).split(sep).join('/')}`, bytes: readFileSync(p) });
  const add = (name, text) => entries.push({ name: `routekit-embed/${name}`, bytes: Buffer.from(text) });
  for (const [src, name] of [['routekit/index.d.ts', 'types/index.d.ts'], ['LICENSE', 'LICENSE'], ['NOTICE', 'NOTICE']]) entries.push({ name: `routekit-embed/${name}`, bytes: readFileSync(join(root, src)) });
  add('SOURCE.txt', `RouteKit ${version}\nCorresponding source (AGPL-3.0-or-later): https://github.com/climb-io/climbio\nCommit: ${commit}\nnpm: @climbio/routekit@${version} (same source)\n`);
  add('SELF-HOSTING.md', `# RouteKit ${version} self-hosting\n\nPut this folder on any static host and open index.html (inside an iframe or a native WebView). All resource paths are relative.\nThe protocol (v2) is documented in messages.d.ts. Data is yours to provide (inline objects, or https URLs with CORS); this package never calls Climbio services.\nLicense: AGPL-3.0-or-later (see LICENSE and NOTICE). Corresponding source: see SOURCE.txt.\n`);
  const zipName = `routekit-embed-${version}.zip`;
  const zipBlob = await files.zip(entries.map((e) => ({ name: e.name, blob: new Blob([e.bytes]) })));
  writeFileSync(join(out, zipName), Buffer.from(await zipBlob.arrayBuffer()));

  // 3. 校驗：兩個產物的 SHA-256
  const sums = [packed, zipName].map((n) => `${sha256(readFileSync(join(out, n)))}  ${n}`).join('\n') + '\n';
  writeFileSync(join(out, 'SHA256SUMS'), sums);
  return { version, commit, npm: packed, zip: zipName, entries: entries.map((e) => e.name), sums };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = join(root, process.argv[2] || 'release-out');
  const timer = setTimeout(() => { console.error('卡在：發布包產生超過 3 分鐘，已停止；先看 npm pack 是否卡住，再重跑 node tools/release-routekit.mjs'); process.exit(1); }, 180000);
  build(out).then((r) => { clearTimeout(timer); console.log(`${r.npm}\n${r.zip}（${r.entries.length} 個檔）\n${r.sums}`); process.exit(0); })
    .catch((e) => { clearTimeout(timer); console.error(`失敗：${e.message}`); process.exit(1); });
}
