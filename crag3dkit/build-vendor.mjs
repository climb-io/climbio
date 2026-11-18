// 重建 vendor/three-splat.js：three.js 0.180.0（含 GLTFLoader）與 Spark 2.4.0（含內嵌的 WebAssembly）用 esbuild 打包成單一 ES module，
// 只匯出 player.js 用到的名稱。用法：node crag3dkit/build-vendor.mjs（要連網下載套件；在暫存資料夾裡裝，不動專案的 node_modules）。
// 換版本時改下面的 THREE、SPARK，並更新 vendor/three-splat-LICENSE.txt 的授權全文與版本。
// English: rebuild vendor/three-splat.js (three.js + GLTFLoader + Spark bundled with esbuild, exporting only what player.js imports). Needs network.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const THREE = '0.180.0', SPARK = '2.4.0';
const here = path.dirname(new URL(import.meta.url).pathname);
const player = readFileSync(path.join(here, 'player.js'), 'utf8');
const names = player.match(/import \{([^}]+)\} from '\.\/vendor\/three-splat\.js'/)[1].split(',').map((s) => s.trim());
const FROM = { GLTFLoader: 'three/examples/jsm/loaders/GLTFLoader.js', SparkRenderer: '@sparkjsdev/spark', SplatMesh: '@sparkjsdev/spark' };
const groups = {};
for (const n of names) (groups[FROM[n] ?? 'three'] ??= []).push(n);

const dir = mkdtempSync(path.join(tmpdir(), 'crag3dkit-vendor-'));
const run = (cmd, args) => execFileSync(cmd, args, { cwd: dir, stdio: 'inherit' });
writeFileSync(path.join(dir, 'package.json'), '{"name":"vendor-build","private":true,"type":"module"}\n');
run('npm', ['install', '--no-audit', '--no-fund', `three@${THREE}`, `@sparkjsdev/spark@${SPARK}`, 'esbuild']);
writeFileSync(path.join(dir, 'entry.js'), Object.entries(groups).map(([from, list]) => `export { ${list.join(', ')} } from '${from}';`).join('\n') + '\n');
run('npx', ['esbuild', 'entry.js', '--bundle', '--format=esm', '--minify', '--outfile=out.js']);
mkdirSync(path.join(here, 'vendor'), { recursive: true });
copyFileSync(path.join(dir, 'out.js'), path.join(here, 'vendor/three-splat.js'));
console.log(`vendor/three-splat.js 已重建（three ${THREE}、Spark ${SPARK}，匯出 ${names.length} 個名稱）。確認 vendor/three-splat-LICENSE.txt 的版本與授權全文，再在手機尺寸實際看一次 3D。`);
