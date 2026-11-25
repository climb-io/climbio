// RouteKit 發布包：npm 包與靜態 ZIP 同版本、檔案齊全、全是相對資源、校驗碼吻合；npm 包在乾淨資料夾能安裝使用
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from './release-routekit.mjs';

const files = createRequire(import.meta.url)('../appkit/files.js');
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

test('發布包：版本一致、ZIP 的 script 都在且是相對路徑、校驗碼吻合、npm 包乾淨安裝可用', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rk-release-'));
  try {
    const r = await build(join(dir, 'out'));
    assert.match(r.npm, new RegExp(`^climbio-routekit-${r.version.replaceAll('.', '\.')}\.tgz$`));
    for (const line of r.sums.trim().split('\n')) { const [h, n] = line.split(/\s+/); assert.equal(createHash('sha256').update(readFileSync(join(dir, 'out', n))).digest('hex'), h, n); }
    const z = await files.unzip(new Blob([readFileSync(join(dir, 'out', r.zip))]));
    const names = new Set(z.map((e) => e.name)), html = await z.find((e) => e.name === 'routekit-embed/index.html').blob.text();
    for (const need of ['LICENSE', 'NOTICE', 'SOURCE.txt', 'SELF-HOSTING.md', 'types/index.d.ts', 'messages.d.ts', 'kit/viewport.js']) assert.ok(names.has(`routekit-embed/${need}`), need);
    const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(srcs.length > 5);
    for (const s of srcs) { assert.ok(!/^([a-z]+:)?\/\//i.test(s) && !s.startsWith('/'), `${s} 要是相對路徑`); assert.ok(names.has(`routekit-embed/${s}`), `${s} 不在 ZIP 裡`); }
    // 乾淨專案安裝 npm 包，require／import 都能用到 LongPress
    const proj = join(dir, 'proj'); execFileSync(process.execPath, ['-e', `require('fs').mkdirSync(${JSON.stringify(proj)})`]);
    writeFileSync(join(proj, 'package.json'), '{"name":"x","private":true,"type":"module"}');
    execFileSync(NPM, ['install', '--no-audit', '--no-fund', '--silent', join(dir, 'out', r.npm)], { cwd: proj, timeout: 120000, shell: process.platform === 'win32' });
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', "import K, { LongPress, candidatePoly } from '@climbio/routekit'; console.log(typeof LongPress, typeof K.LongPress, typeof candidatePoly)"], { cwd: proj, timeout: 30000 }).toString().trim();
    assert.equal(out, 'function function function');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
