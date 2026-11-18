// 依產品跑測試：node tools/test-product.mjs <產品…> [--e2e]；node tools/test-product.mjs --list
//   預設只跑產品的 Node 測試；--e2e 接著跑產品的瀏覽器案例（Chromium，走共用測試鎖，一次只有一組在跑）
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { filesOf, PRODUCTS, root } from './test-groups.mjs';

const args = process.argv.slice(2), e2e = args.includes('--e2e'), names = args.filter(a => !a.startsWith('--'));
if (args.includes('--list') || !names.length) {
  for (const [k, p] of Object.entries(PRODUCTS)) { const f = filesOf(k); console.log(`${k.padEnd(9)} ${String(f.unit.length).padStart(3)} 個 Node 測試、${String(f.e2e.length).padStart(3)} 個瀏覽器案例  ${p.label}`); }
  process.exit(args.includes('--list') ? 0 : 2);
}
const { unit, e2e: cases } = filesOf(...names);
const run = (cmd, argv) => { const r = spawnSync(cmd, argv, { cwd: root, stdio: 'inherit' }); if (r.status !== 0) process.exit(r.status ?? 1); };
if (unit.length) run(process.execPath, ['--import', './tools/hide-windows.mjs', '--test', '--experimental-test-isolation=none', ...unit]);
if (e2e && cases.length) {
  const lock = existsSync(`${root}tools/e2e.py`);
  run(lock ? 'python3' : 'npx', lock ? ['tools/e2e.py', '--project=android-chromium', ...cases] : ['playwright', 'test', '--project=android-chromium', ...cases]);
}
