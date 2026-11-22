// Studio 的工作區分界與介面文字規範（docs/studio-design.md「工作區的分界」、docs/style.md 第 7 節）
import test from 'node:test';
import './studio-i18n.mjs';   // Studio 的訊息走語言包，測試載入繁體中文版
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const files = (dir) => readdirSync(new URL(`../${dir}`, import.meta.url), { recursive: true }).filter(f => /\.(js|html|css)$/.test(f) && !/vendor|\.test\./.test(f)).map(f => `${dir}/${f}`);

test('Studio 介面沒有 emoji 與裝飾符號', () => {
  const bad = /[\u{1F300}-\u{1FAFF}✨✅❌★✕✖⭐]/u;
  for (const f of [...files('studio/crag'), ...files('studio/wall'), ...files('studio/intake'), 'studio/home.js', 'studio/index.html', 'studio/classify.js']) {
    read(f).split('\n').forEach((l, i) => assert.doesNotMatch(l, bad, `${f}:${i + 1}`));
  }
});

test('首頁匯入：home.js 不判斷是哪個工作區，工作區的設定在各自資料夾的 intake.js', () => {
  const home = read('studio/home.js');
  assert.doesNotMatch(home, /ws === 'crag'/, 'home.js 走 intake/workspaces.js 的介面');
  for (const [ws, dir] of [['crag', 'crag'], ['gym', 'wall']]) assert.match(read(`studio/${dir}/intake.js`), new RegExp(`id: '${ws}'`));
});
