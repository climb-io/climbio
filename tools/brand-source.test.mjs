import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('Logo、PWA 向量與動畫模板必須由確認素材產生，不容許手改分岔', () => {
  execFileSync(process.execPath, ['tools/brand-icons.mjs', '--check'], { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'pipe' });
});
