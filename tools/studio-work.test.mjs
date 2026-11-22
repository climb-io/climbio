// Studio 工作紀錄（studio/work/ledger.js）：題目 id 穩定、判斷後開關、只能由人答的題、進度
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { questionsFromReport, refresh, isOpen, waitingFor, decide, summary, stateOf, merge, pendingPatches } from '../studio/work/ledger.js';

const rep = {
  name: '測試岩場',
  issues: [{ level: 'error', code: 'no-position', message: '沒有岩場位置' }, { level: 'check', code: 'outline', message: '第 3 行沒有設成標題' }],
  routes: [
    { id: 'r1', name: '小線', wall: '小石頭', reasons: ['unassigned', 'no-topo'], at: { line: 16, row: 1 } },
    { id: 'r2', name: '大線', wall: '大石頭', reasons: [] },
  ],
};

test('問題清單 → 題目：同一份報告每次算出同樣的 id，一個原因一題', () => {
  const a = questionsFromReport(rep), b = questionsFromReport(structuredClone(rep));
  assert.deepEqual(a.map(q => q.id), b.map(q => q.id));
  assert.equal(a.length, 4);
  assert.equal(a.find(q => q.kind === 'position').level, 'error');
  assert.deepEqual(a.find(q => q.kind === 'position').options, ['edit', 'fix']);
  assert.deepEqual(a.filter(q => q.target[0] === 'r1').map(q => q.kind).sort(), ['route-line', 'route-wall']);
});

test('重算：留著第一次出現的時間，問題不在了的題目拿掉', () => {
  const first = refresh([], questionsFromReport(rep), 't1');
  const fixed = { ...rep, routes: [{ ...rep.routes[0], reasons: ['no-topo'] }] };
  const second = refresh(first, questionsFromReport(fixed), 't2');
  assert.equal(second.find(q => q.kind === 'route-line').since, 't1');
  assert.equal(second.find(q => q.kind === 'route-line').seen, 't2');
  assert.ok(!second.some(q => q.kind === 'route-wall'));
});

test('判斷：ok 之後不再出現；edit 之後問題還在就重新打開', () => {
  let qs = refresh([], questionsFromReport(rep), '2026-01-01T00:00:00Z');
  const line = qs.find(q => q.kind === 'route-line'), wall = qs.find(q => q.kind === 'route-wall');
  const ds = [decide(line, { choice: 'ok', by: 'human:kk' }, '2026-01-01T00:01:00Z'), decide(wall, { choice: 'edit', by: 'agent:a' }, '2026-01-01T00:01:00Z')];
  assert.equal(isOpen(line, ds), false);
  assert.equal(isOpen(wall, ds), false);
  qs = refresh(qs, questionsFromReport(rep), '2026-01-01T00:02:00Z');
  assert.equal(isOpen(qs.find(q => q.kind === 'route-line'), ds), false);
  assert.equal(isOpen(qs.find(q => q.kind === 'route-wall'), ds), true);
});

test('不合規則的判斷丟錯：位置只能由人答、error 不能 ok、沒有建議不能 accept、by 要有身分', () => {
  const qs = questionsFromReport(rep), pos = qs.find(q => q.kind === 'position'), line = qs.find(q => q.kind === 'route-line');
  assert.throws(() => decide(pos, { choice: 'edit', by: 'agent:a' }, 't'), /只能由人答/);
  assert.doesNotThrow(() => decide(pos, { choice: 'edit', by: 'human:kk' }, 't'));
  assert.throws(() => decide(pos, { choice: 'ok', by: 'human:kk' }, 't'), /不能選/);
  assert.throws(() => decide(line, { choice: 'accept', by: 'agent:a' }, 't'), /沒有建議/);
  assert.throws(() => decide(line, { choice: 'ok', by: 'someone' }, 't'), /by/);
  const withProposal = { ...line, proposal: { label: '移到小石頭', patch: [] }, options: ['accept', 'reject', 'ok', 'edit'] };
  assert.equal(decide(withProposal, { choice: 'accept', by: 'agent:a' }, 't').choice, 'accept');
});

test('進度（AI 優先）：沒建成包先建（大綱有 error 先修）、AI 答完自己能答的、剩下只等人、都答完才能發佈', () => {
  const qs = refresh([], questionsFromReport(rep), 't');
  assert.equal(stateOf({ line: 'convert', step: 'outline', built: false, questions: qs, decisions: [], now: 't' }).next, 'answer');   // 大綱的 error（缺位置以外的）AI 先修
  const noErr = qs.filter(q => q.level !== 'error');
  assert.equal(stateOf({ line: 'convert', step: 'outline', built: false, questions: noErr, decisions: [], now: 't' }).next, 'build');
  const s = stateOf({ line: 'convert', step: 'built', built: true, questions: noErr, decisions: [], now: 't' });
  assert.equal(s.next, 'answer');
  assert.equal(s.publishable, false);
  // AI 答了一題、另一題原始資料不夠（retake）→ 只剩人；看不準不能交給人
  const [a, b] = noErr.filter(q => q.target.length);
  const ds = [decide(a, { choice: 'ok', by: 'agent:a' }, 't2'), decide(b, { choice: 'retake', by: 'agent:a', note: '這頁的照片糊到看不出線' }, 't2')];
  const rest = noErr.filter(q => !q.target.length).map(q => decide(q, { choice: 'ok', by: 'agent:a' }, 't2'));
  const human = stateOf({ line: 'convert', step: 'built', built: true, questions: noErr, decisions: [...ds, ...rest], now: 't2' });
  assert.equal(human.next, 'human');
  assert.equal(human.forHuman, 1);
  assert.equal(waitingFor(b, ds), 'human');
  const done = stateOf({ line: 'convert', step: 'built', built: true, questions: noErr, decisions: [...ds, ...rest, decide(b, { choice: 'ok', by: 'human:kk' }, 't3')], now: 't3' });
  assert.equal(done.publishable, true);
  assert.equal(done.next, 'publish');
  assert.deepEqual(summary(qs, []), { total: 4, open: 4, errors: 1, humanOnly: 1, forAgent: 3, forHuman: 1 });
  assert.throws(() => decide(a, { choice: 'retake', by: 'agent:a' }, 't'), /哪裡的資料不夠/);
  assert.throws(() => decide(a, { choice: 'retake', by: 'human:kk', note: 'x' }, 't'), /不能選/);   // 補資料是 AI 交給人用的
  assert.throws(() => decide(a, { choice: 'unsure', by: 'agent:a', note: 'x' }, 't'), /不認得/);   // 看不準不再交給人
  // 舊紀錄的 unsure：重新等代理自己判斷，不等人
  const old = { id: 'd-old', q: b.id, choice: 'unsure', by: 'agent:a', note: '舊的', at: 't2' };
  assert.equal(waitingFor(b, [old]), 'agent');
});

test('收件匣說要改（fix）：等代理；代理套用人給的修正後記 edit，位置也可以（只是照做）', () => {
  const qs = refresh([], questionsFromReport(rep), '2026-01-01T00:00:00Z');
  const line = qs.find(q => q.kind === 'route-line'), pos = qs.find(q => q.kind === 'position');
  assert.throws(() => decide(line, { choice: 'fix', by: 'human:kk' }, 't'), /怎麼改/);
  const fix = decide(line, { choice: 'fix', by: 'human:kk', note: '線在左邊的裂縫' }, '2026-01-01T00:01:00Z');
  const where = decide(pos, { choice: 'fix', by: 'human:kk', patch: [{ op: 'position', lat: 25, lng: 121 }] }, '2026-01-01T00:01:00Z');
  const ds = [fix, where];
  assert.equal(waitingFor(line, ds), 'agent');
  assert.equal(stateOf({ line: 'convert', step: 'built', built: true, questions: qs, decisions: ds, now: 't' }).next, 'answer');
  assert.deepEqual(pendingPatches(qs, ds).map(d => d.id), [where.id]);
  assert.throws(() => decide(pos, { choice: 'edit', by: 'agent:a', patch: [{ op: 'position', lat: 1, lng: 1 }] }, 't'), /只能由人答/);
  const done = decide(pos, { choice: 'edit', by: 'agent:a', patch: where.patch, applied: true }, '2026-01-01T00:02:00Z');
  assert.deepEqual(pendingPatches(qs, [...ds, done]), []);
  assert.equal(isOpen(pos, [...ds, done]), false);
});

test('合併兩邊的判斷：照 id 去重、照時間排；同一筆內容算出同一個 id', () => {
  const qs = questionsFromReport(rep), line = qs.find(q => q.kind === 'route-line');
  const a = decide(line, { choice: 'ok', by: 'human:kk' }, '2026-01-01T00:02:00Z'), b = decide(line, { choice: 'edit', by: 'agent:a' }, '2026-01-01T00:01:00Z');
  assert.equal(a.id, decide(line, { choice: 'ok', by: 'human:kk' }, '2026-01-01T00:02:00Z').id);
  assert.deepEqual(merge([a], [b, a]).map(d => d.id), [b.id, a.id]);
});

test('要不要公開發佈：只能由人答；核准綁在這一版（指紋）上，代理答不了、人選不要就不算核准', async () => {
  const { publishQuestion, approval } = await import('../studio/work/ledger.js');
  const q = { ...publishQuestion({ line: 'wall', sig: 'abc', title: '發佈嗎' }), since: '2026-01-01T00:00:00Z', seen: '2026-01-01T00:00:00Z' };
  assert.equal(q.id, 'q-publish-abc');
  assert.equal(waitingFor(q, []), 'human');
  assert.throws(() => decide(q, { choice: 'ok', by: 'agent:bot' }, '2026-01-02T00:00:00Z'), /只能由人答/);
  assert.equal(approval([q], []), null);
  const no = decide(q, { choice: 'reject', by: 'human:KK' }, '2026-01-02T00:00:00Z');
  assert.equal(approval([q], [no]), null);
  const yes = decide(q, { choice: 'ok', by: 'human:KK' }, '2026-01-03T00:00:00Z');
  assert.equal(approval([q], [no, yes]).by, 'human:KK');
  assert.equal(decide(q, { choice: 'ok', by: 'human:KK', said: '發佈吧' }, '2026-01-03T00:00:00Z').said, '發佈吧');   // 對話裡答的原話跟著判斷
  assert.throws(() => decide({ ...q, kind: 'route-line' }, { choice: 'reject', by: 'agent:bot', said: '不要' }, '2026-01-03T00:00:00Z'), /said/);
  const next = { ...publishQuestion({ line: 'wall', sig: 'def', title: '發佈嗎' }), since: '2026-01-04T00:00:00Z', seen: '2026-01-04T00:00:00Z' };
  assert.equal(approval([next], [no, yes]), null);   // 內容改了（指紋不同）：要重新核准
});
