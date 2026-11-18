const { mkdtempSync, writeFileSync, copyFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');
const { spawnSync } = require('node:child_process');
const repo = resolve(process.env.RULES_REPO_ROOT || resolve(__dirname, '../..'));
const dir = mkdtempSync(join(tmpdir(), 'climbio-rules-'));
// emulators:exec 把指令交給系統的 shell：Windows 是 cmd（只認雙引號），其他是 sh
const shellQuote = value => process.platform === 'win32' ? `"${value}"` : "'" + value.replaceAll("'", "'\\''") + "'";
try {
  // CLI 限制規則檔必須在其專案目錄；每次從受測來源複製，沒有第二份維護中的規則。
  copyFileSync(resolve(repo, 'firestore.rules'), join(dir, 'firestore.rules'));
  copyFileSync(process.env.RULES_STORAGE_FILE || resolve(repo, 'storage.rules'), join(dir, 'storage.rules'));
  writeFileSync(join(dir, 'firebase.json'), JSON.stringify({
    storage: { rules: 'storage.rules' }, firestore: { rules: 'firestore.rules' },
    emulators: { singleProjectMode: true, storage: { host: '127.0.0.1', port: 9199 }, firestore: { host: '127.0.0.1', port: 8080 }, ui: { enabled: false } },
  }));
  const result = spawnSync(process.execPath, [resolve(__dirname, 'node_modules/firebase-tools/lib/bin/firebase.js'),
    'emulators:exec', '--project', 'demo-climbio-acceptance', '--only', 'firestore,storage', '--config', join(dir, 'firebase.json'),
    `${shellQuote(process.execPath)} --test --test-concurrency=1 ${shellQuote(join(__dirname, 'permissions.test.cjs'))}`], { stdio: 'inherit', env: process.env, cwd: dir });
  process.exitCode = result.status ?? 1;
} finally { rmSync(dir, { recursive: true, force: true }); }
