// 在暫存資料夾的副本上改名，不動 repo 裡的檔案
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
test('改名換掉品牌名稱與連結預覽圖片網址，App 的角色名、字型名稱、程式識別字、小寫網域不動；語言包照樣能檢查', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rebrand-'));
  try {
    for (const f of ['index.html', 'en/index.html', 'zh-cn/index.html', 'ja/index.html', 'ko/index.html', 'fr/index.html', 'es/index.html', 'de/index.html', 'hold', 'redpoint/index.html', 'studio/index.html', 'studio/manifest.webmanifest', 'studio/scene/index.html', 'i18n', 'tools/rebrand.mjs']) cpSync(join(repo, f), join(dir, f), { recursive: true });
    execFileSync(process.execPath, ['tools/rebrand.mjs', 'Boulder Pad', 'https://me.github.io/pad'], { cwd: dir, stdio: 'pipe' });
    const html = readFileSync(join(dir, 'hold/index.html'), 'utf8'), home = readFileSync(join(dir, 'index.html'), 'utf8'), zh = readFileSync(join(dir, 'i18n/hold/zh.js'), 'utf8');
    for (const f of readdirSync(join(dir, 'i18n'), { recursive: true }).filter(f => f.endsWith('.js'))) assert.doesNotMatch(readFileSync(join(dir, 'i18n', f), 'utf8'), /\bClimbio\b(?! (Display|Dan)\b)/, `${f} 還有沒換掉的 Climbio`);
    assert.match(html, /<meta property="og:site_name" content="Boulder Pad">/);
    assert.match(html, /<title>岩點貓<\/title>/);   // App 名稱是角色名，不跟著換
    assert.match(html, /content="https:\/\/me\.github\.io\/pad\/icons\/cats\/hold-cat-512\.png"/);
    const redpoint = readFileSync(join(dir, 'redpoint/index.html'), 'utf8'), studio = readFileSync(join(dir, 'studio/index.html'), 'utf8');
    const enHome = readFileSync(join(dir, 'en/index.html'), 'utf8');
    assert.match(redpoint, /content="https:\/\/me\.github\.io\/pad\/icons\/cats\/redpoint-cat-512\.png"/);
    assert.match(studio, /<meta property="og:title" content="Boulder Pad Studio">/);
    assert.doesNotMatch(redpoint + studio + enHome, /https:\/\/climbio\.app\//);
    assert.doesNotMatch(html + home + enHome + zh, /\bClimbio\b(?! (Display|Dan))/);
    assert.equal(JSON.parse(readFileSync(join(dir, 'studio/manifest.webmanifest'), 'utf8')).name, 'Boulder Pad Studio');
    assert.match(zh, /app: '岩點貓'/);
    assert.equal(JSON.parse(readFileSync(join(dir, 'hold/manifest.webmanifest'), 'utf8')).name, '岩點貓');
    assert.throws(() => execFileSync(process.execPath, ['tools/rebrand.mjs', "It's"], { cwd: dir, stdio: 'pipe' }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('加版本號：version.js 和 hold/index.html 一起加 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bump-'));
  try {
    for (const f of ['hold', 'version.js', 'tools/bump-version.mjs']) cpSync(join(repo, f), join(dir, f), { recursive: true });
    const n = Number(readFileSync(join(dir, 'version.js'), 'utf8').match(/climbio-v(\d+)/)[1]);
    execFileSync(process.execPath, ['tools/bump-version.mjs'], { cwd: dir, stdio: 'pipe' });
    assert.match(readFileSync(join(dir, 'version.js'), 'utf8'), new RegExp(`'climbio-v${n + 1}'`));
    assert.match(readFileSync(join(dir, 'hold/index.html'), 'utf8'), new RegExp(`content="climbio-v${n + 1}"`));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
