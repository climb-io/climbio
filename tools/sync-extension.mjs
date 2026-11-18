// 把 sourcekit/ 複製進 extension/：擴充功能打包成 ZIP 時只有 extension/ 資料夾，不能往外 import。
// 用法：node tools/sync-extension.mjs（改了來源之後跑一次）；--check 只檢查有沒有同步（測試用）。
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
// 來源資料夾 → 要複製的檔案；複製到 extension/<資料夾>/
const SOURCES = {
  sourcekit: readdirSync(new URL('sourcekit/', root)).filter((f) => f.endsWith('.js')),
};
const banner = (dir) => `// 這是 ${dir}/ 的複製（tools/sync-extension.mjs 產生），不要直接改，改 ${dir}/ 再同步。
`;

const entries = Object.entries(SOURCES).flatMap(([dir, files]) => files.map((f) => [dir, f]));
export const expected = (dir, f) => banner(dir) + readFileSync(new URL(`${dir}/${f}`, root), 'utf8');
export function stale() {
  return entries.filter(([dir, f]) => { try { return readFileSync(new URL(`extension/${dir}/${f}`, root), 'utf8') !== expected(dir, f); } catch { return true; } }).map(([dir, f]) => `${dir}/${f}`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) { const s = stale(); if (s.length) { console.error(`extension 的複製沒同步：${s.join('、')}`); process.exit(1); } }
  else {
    for (const dir of Object.keys(SOURCES)) mkdirSync(new URL(`extension/${dir}/`, root), { recursive: true });
    for (const [dir, f] of entries) writeFileSync(new URL(`extension/${dir}/${f}`, root), expected(dir, f));
    console.log(`已同步 ${entries.map(([dir, f]) => `${dir}/${f}`).join('、')}`);
  }
}
