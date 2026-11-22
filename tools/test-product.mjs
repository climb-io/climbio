// 依產品跑測試：node tools/test-product.mjs <產品…> [--e2e]；node tools/test-product.mjs --list
//   預設只跑產品的 Node 測試；--e2e 接著跑產品的瀏覽器案例（Chromium，走共用測試鎖，一次只有一組在跑）
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { filesOf, PRODUCTS, root } from './test-groups.mjs';

const args = process.argv.slice(2), e2e = args.includes('--e2e'), names = args.filter(a => !a.startsWith('--'));
if (args.includes('--list') || !names.length) {
  for (const [k, p] of Object.entries(PRODUCTS)) { const f = filesOf(k); console.log(`${k.padEnd(9)} ${String(f.unit.length).padStart(3)} 個 Node 測試、${String(f.e2e.length).padStart(3)} 個瀏覽器案例  ${p.label}`); }
  process.exit(args.includes('--list') ? 0 : 2);
}
const { unit, e2e: cases } = filesOf(...names);
const run = (cmd, argv) => { const r = spawnSync(cmd, argv, { cwd: root, stdio: 'inherit' }); if (r.status !== 0) process.exit(r.status ?? 1); };
// 不會卡住：每個測試最多 2 分鐘（超過算失敗），跑完就結束（有測試沒關的伺服器、計時器也不等）。
// 測試卡在無窮迴圈時上面的逾時不會觸發：IDLE 毫秒都沒有輸出就整組強制停掉（含子行程，不留空轉的孤兒），印出卡在哪個測試
// 同一個行程跑全部（省記憶體）要 Node 22.8 以上才有，舊版照預設一個檔案一個行程
const IDLE = +process.env.TEST_IDLE_MS || 180000;   // 測試看門狗本身時可以調短
const [major, minor] = process.versions.node.split('.').map(Number);
const shared = major > 22 || (major === 22 && minor >= 8) ? ['--experimental-test-isolation=none'] : [];
const watched = (cmd, argv) => new Promise((done) => {
  const win = process.platform === 'win32', child = spawn(cmd, argv, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: !win });
  let last = '', at = Date.now();
  const seen = (out) => (chunk) => {
    out.write(chunk); at = Date.now();
    const lines = String(chunk).split('\n').map(l => l.trim()).filter(l => /^(# Subtest:|▶|✔|✖|ok |not ok )/.test(l));
    if (lines.length) last = lines.at(-1);
  };
  child.stdout.on('data', seen(process.stdout)); child.stderr.on('data', seen(process.stderr));
  const dog = setInterval(() => {
    if (Date.now() - at < IDLE) return;
    clearInterval(dog);
    console.error(`\n測試卡住：${IDLE / 1000} 秒沒有輸出，強制停掉。最後一行：${last || '（還沒開始）'}`);
    try { if (win) spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f']); else process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  }, 5000);
  child.on('close', (code, sig) => { clearInterval(dog); done(code ?? (sig ? 1 : 0)); });
});
if (unit.length) {
  const code = await watched(process.execPath, ['--import', './tools/hide-windows.mjs', '--import', './tools/test-locale.mjs', '--test', '--test-timeout=120000', '--test-force-exit', ...shared, ...unit]);
  if (code !== 0) process.exit(code);
}
if (e2e && cases.length) {
  const lock = existsSync(`${root}tools/e2e.py`);
  run(lock ? 'python3' : 'npx', lock ? ['tools/e2e.py', '--project=android-chromium', ...cases] : ['playwright', 'test', '--project=android-chromium', ...cases]);
}
