// tools/wall.mjs：AI 代理不開 Studio 改牆的分享包岩點（列出、停用、拿回、新增、換外框），改完通過格式驗證
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const RouteKit = require('../routekit/format.js'), { validate } = require('../format/format.js');
const cli = (...a) => { try { return { out: execFileSync(process.execPath, ['tools/wall.mjs', ...a], { encoding: 'utf8' }), status: 0 }; } catch (e) { return { out: e.stdout + e.stderr, status: e.status }; } };
const sq = (x, y, r) => [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]];

test('命令列 wall：列出岩點、停用與拿回、新增、換外框；外框超出照片、不認得的岩點、重複的 id 都擋下；改完通過格式驗證', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wall-'));
  try {
    const pack = RouteKit.wallFiles({ pid: 'wallaaaabbbbcccc', layerId: 'layeraaabbbbcccc', name: '東牆', w: 800, h: 600, photo: new Uint8Array([0xff, 0xd8]),
      holds: [{ id: 'h1', poly: sq(100, 100, 20), source: 'detect' }, { id: 'h2', poly: sq(300, 300, 30), source: 'detect' }],
      routes: [{ id: 'r1', name: '一號', grade: 'V2', holds: { h1: 's', h2: 't' }, seq: [] }] });
    for (const f of pack.files) writeFileSync(join(dir, f.path), f.bytes);
    writeFileSync(join(dir, 'index.json'), JSON.stringify({ climbio: 2, kind: 'set', type: 'walls', id: 'abcdefgh12345678', name: '東牆', t: 1, license: 'CC-BY-SA-4.0', attribution: 'KK', items: [{ href: pack.entry, id: 'wallaaaabbbbcccc' }] }));
    const view = () => JSON.parse(readFileSync(join(dir, 'wallaaaabbbbcccc.json'), 'utf8'));
    const run = (ops) => { writeFileSync(join(dir, 'patch.json'), JSON.stringify(ops)); return cli('apply', dir, join(dir, 'patch.json')); };

    const list = JSON.parse(cli('holds', dir, '--json').out);
    assert.deepEqual(list[0].holds.map(h => [h.id, h.box, h.retired]), [['h1', [80, 80, 120, 120], false], ['h2', [270, 270, 330, 330], false]]);
    // 拿掉＝停用（路線還指得到）；拿回來
    let r0 = run([{ op: 'remove', holds: ['h1'] }]);
    assert.equal(r0.status, 0, r0.out);
    assert.equal(view().nodes.find(n => n.id === 'h1').props.retired, true);
    assert.equal(run([{ op: 'restore', holds: ['h1'] }]).status, 0);
    assert.equal(view().nodes.find(n => n.id === 'h1').props.retired, undefined);
    // 新增、換外框
    const res = run([{ op: 'add', poly: sq(500, 200, 25), id: 'h3' }, { op: 'set', id: 'h2', poly: sq(310, 300, 28) }]);
    assert.equal(res.status, 0, res.out);
    assert.match(res.out, /新增 wallaaaabbbbcccc h3/);
    const v = view();
    assert.deepEqual(v.nodes.map(n => [n.id, n.props?.source]), [['h1', 'detect'], ['h2', 'edited'], ['h3', 'manual']]);
    assert.deepEqual(v.marks.find(m => m.node === 'h3').geometry.coordinates[0].slice(0, 2), [[475, 175], [525, 175]]);
    assert.deepEqual(validate(v), []);
    // 擋下：超出照片、不認得的岩點、重複的 id
    assert.equal(run([{ op: 'add', poly: sq(790, 10, 30) }]).status, 2);
    assert.equal(run([{ op: 'set', id: 'nope', poly: sq(100, 100, 10) }]).status, 2);
    assert.equal(run([{ op: 'add', poly: sq(100, 400, 10), id: 'h1' }]).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('牆的分享包當專案：可能重複的岩點出題（證據是照片加框），代理修好後問人要不要發佈；沒有人核准不能發佈，內容改了要重新核准', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wall-'));
  const studio = (...a) => { try { return { out: execFileSync(process.execPath, ['tools/studio.mjs', ...a], { encoding: 'utf8', env: { ...process.env, CLIMBIO_STUDIO_KEY: '' } }), status: 0 }; } catch (e) { return { out: e.stdout + e.stderr, status: e.status }; } };
  try {
    const pack = RouteKit.wallFiles({ pid: 'wallaaaabbbbcccc', name: '西牆', w: 800, h: 600, photo: new Uint8Array([0xff, 0xd8]),
      holds: [{ id: 'h1', poly: sq(100, 100, 20), source: 'detect' }, { id: 'h2', poly: sq(104, 102, 20), source: 'detect' }, { id: 'h3', poly: sq(400, 300, 25), source: 'detect' }] });
    for (const f of pack.files) writeFileSync(join(dir, f.path), f.bytes);
    writeFileSync(join(dir, 'index.json'), JSON.stringify({ climbio: 2, kind: 'set', type: 'walls', id: 'abcdefgh12345678', name: '西牆', t: 1, license: 'CC-BY-SA-4.0', attribution: 'KK', items: [{ href: pack.entry, id: 'wallaaaabbbbcccc' }] }));
    const qs = () => JSON.parse(studio('ask', dir, '--json').out);
    // h1、h2 幾乎疊在一起：一題，證據是照片和兩顆的範圍
    let list = qs();
    assert.deepEqual(list.map(q => [q.kind, q.target, q.waiting]), [['hold-dup', ['h1', 'h2'], 'agent']]);
    assert.deepEqual(list[0].evidence[0].box, [80, 80, 124, 122]);
    assert.equal(list[0].evidence[0].image, 'wallaaaabbbbcccc.jpg');
    assert.match(studio('status', dir).out, /岩館牆面/);
    // 沒答完不出發佈題；代理修好（停用 h2）後才問人
    assert.equal(studio('approved', dir).status, 1);
    writeFileSync(join(dir, 'fix.json'), JSON.stringify([{ op: 'remove', holds: ['h2'] }]));
    assert.equal(studio('apply', dir, join(dir, 'fix.json')).status, 0);
    list = qs();
    assert.deepEqual(list.map(q => [q.kind, q.waiting]), [['publish', 'human']]);
    // 代理不能核准；沒核准不能發佈（不用金鑰就先擋下）
    assert.equal(studio('answer', dir, list[0].id, 'ok', '--by', 'agent:bot').status, 2);
    let res = studio('publish', dir);
    assert.equal(res.status, 1);
    assert.match(res.out, /還沒有人核准發佈/);
    // 等人答的題給代理拿到對話裡問：題目和記下的指令
    res = studio('ask', dir, '--human');
    assert.match(res.out, /要公開發佈/);
    assert.match(res.out, /--by human:<名稱> --said/);
    // 人在對話裡核准這一版：代理替人記下要附原話，沒附不收
    res = studio('answer', dir, list[0].id, 'ok', '--by', 'human:KK');
    assert.equal(res.status, 2);
    assert.match(res.out, /--said/);
    assert.equal(studio('answer', dir, list[0].id, 'ok', '--by', 'human:KK', '--said', '好，發佈').status, 0);
    res = studio('approved', dir);
    assert.equal(res.status, 0);
    assert.equal(JSON.parse(res.out.trim()).by, 'human:KK');
    assert.equal(readFileSync(join(dir, '.studio', 'work', 'decisions.jsonl'), 'utf8').trim().split(/\r?\n/).map(l => JSON.parse(l)).at(-1).said, '好，發佈');
    // 內容又改了：要重新核准
    writeFileSync(join(dir, 'fix2.json'), JSON.stringify([{ op: 'add', poly: sq(600, 100, 20), id: 'h4' }]));
    studio('apply', dir, join(dir, 'fix2.json'));
    assert.equal(studio('approved', dir).status, 1);
    assert.deepEqual(qs().map(q => [q.kind, q.waiting]), [['publish', 'human']]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
