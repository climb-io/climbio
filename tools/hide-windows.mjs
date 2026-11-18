// Windows：測試與工具啟動的子程序（git、bash、python、node）預設不開視窗。
// 從沒有主控台的程序（例如 AI 的工具）啟動時，Windows 會替每個子程序開一個新視窗，一直跳到使用者面前；
// child_process 的 windowsHide 預設是 false，這裡把它改成 true。macOS、Linux 沒有這個問題，載入了也不做事。
// 用法：node --import ./tools/hide-windows.mjs --test --experimental-test-isolation=none …（每個測試檔在同一個程序跑，測試執行器自己不開子程序）
// English: on Windows, default child_process windowsHide to true so spawned tools don't pop up console windows.
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';

if (process.platform === 'win32') {
  const isOptions = (v) => v && typeof v === 'object' && !Array.isArray(v);
  // 參數裡的 options 加上 windowsHide；沒有 options 就插在 args 陣列之後、callback 之前
  const hide = (args) => {
    const a = [...args];
    const i = a.findIndex((v, j) => j > 0 && isOptions(v));
    if (i >= 0) a[i] = { windowsHide: true, ...a[i] };
    else {
      const start = Array.isArray(a[1]) ? 2 : 1;
      const cb = a.findIndex((v, j) => j >= start && typeof v === 'function');
      a.splice(cb >= 0 ? cb : Math.max(start, a.length), 0, { windowsHide: true });
    }
    return a;
  };
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork']) {
    const orig = cp[name];
    const wrapped = function (...args) {
      return orig.apply(this, hide(args));
    };
    // exec、execFile 的 promisify 回傳 { stdout, stderr }：保留原本的版本
    if (orig[promisify.custom]) wrapped[promisify.custom] = (...args) => orig[promisify.custom](...hide(args));
    cp[name] = wrapped;
  }
  syncBuiltinESMExports();
}
