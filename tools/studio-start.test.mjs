import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan, TYPES } from './studio-start.mjs';

// Windows 上 path.join 會用反斜線，比對前統一成斜線
const ex = (...files) => (p) => files.some(f => p.replaceAll('\\', '/').endsWith(f));

test('不認得的類型', () => assert.match(plan({ type: 'x', dir: '/d', exists: ex() }).lines[0], /不認得/));
test('gym 還沒有牆：給 run 指令', () => {
  const r = plan({ type: 'gym', dir: '/d', inputs: ['a.jpg'], exists: ex() });
  assert.match(r.lines.join('\n'), /wall-batch\.mjs run \/d a\.jpg/); assert.equal(r.run, undefined);
});
test('gym 沒有照片也沒有牆：要求照片', () => assert.match(plan({ type: 'gym', dir: '/d', exists: ex() }).lines.join('\n'), /<照片…>/));
test('gym 做過：交給 wall-batch next', () => assert.deepEqual(plan({ type: 'gym', dir: '/d', exists: ex('/d/run.json') }).run, ['wall-batch.mjs', 'next', '/d']));
test('book 三個階段', () => {
  assert.match(plan({ type: 'book', dir: '/d', inputs: ['b.docx'], exists: ex() }).lines.join('\n'), /convert \/d read b\.docx/);
  assert.match(plan({ type: 'book', dir: '/d', exists: ex('/d/.studio/source/outline.md') }).lines.join('\n'), /convert \/d build/);
  assert.deepEqual(plan({ type: 'book', dir: '/d', exists: ex('/d/index.json') }).run, ['studio.mjs', 'status', '/d']);
});
test('3d 沒有 wall.json 要說卡在哪，有就接 status', () => {
  assert.match(plan({ type: '3d', dir: '/d', exists: ex() }).lines.join('\n'), /卡在：資料夾裡沒有 wall\.json/);
  assert.deepEqual(plan({ type: '3d', dir: '/d', exists: ex('/d/wall.json') }).run, ['studio.mjs', 'status', '/d']);
});
test('crag 只有照片：不支援；有路線書就走轉換', () => {
  assert.match(plan({ type: 'crag', dir: '/d', inputs: ['a.jpg'], exists: ex() }).lines.join('\n'), /目前不支援：只有照片/);
  assert.match(plan({ type: 'crag', dir: '/d', inputs: ['old.pdf'], exists: ex() }).lines.join('\n'), /convert \/d read old\.pdf/);
  assert.deepEqual(plan({ type: 'crag', dir: '/d', exists: ex('/d/index.json') }).run, ['studio.mjs', 'status', '/d']);
});
test('每種任務都印完成標準', () => { for (const t of Object.keys(TYPES)) assert.match(plan({ type: t, dir: '/d', exists: ex() }).lines.join('\n'), /不留「請人複核」/); });
