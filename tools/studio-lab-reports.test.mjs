// 3D 牆（studio/wall3d/report.js）、天然岩場（studio/crag/lab-report.js）的報告：量測檔 → 報告框架的步驟卡，數字照檔案、不寫死
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const W3 = require('../studio/wall3d/report.js');
const FB = require('../studio/wall3d/feedback.js');
await import('../studio/crag/lab-report.js');   // studio/crag/ 是 ES 模組的資料夾：這個檔掛在 globalThis
const CR = globalThis.ClimbioCragLabReport;
const T = (k, ...a) => (a.length ? `${k}(${a.join(',')})` : k);

// 同一面室內牆的兩次真實量測：照片選 165 張建模（過門檻）、只用影片每 2 秒取 1 張（原圖解析度描邊；有候選沒留下）
const PHOTO = {
  sfm: { inputImages: 165, models: [{ registeredImages: 165, points3D: 75665, meanReprojectionErrorPx: 0.9228 }], seconds: { features: 213.8, matching: 1303.7, mapping: 177.3 } },
  fusion: { detections: 42046, candidateHolds3Views: 1122, seconds: 51.1 },
  surface: { holds: 1122, observations: 40214, seconds: 73.1 },
  validation: { medianIoU: 0.8121, anchorInsideMaskRate: 0.9596, holdoutUndetected: 131, heldoutPairs: 1488 },
};
const VIDEO = {
  sfm: { inputImages: 277, models: [{ registeredImages: 273, points3D: 73987, meanReprojectionErrorPx: 0.6409 }], seconds: { features: 405.7, matching: 794.4, mapping: 101.1 } },
  fusion: { detections: 48033, candidateHolds3Views: 2130, seconds: 79.7 },
  surface: { holds: 1606, observations: 46831, seconds: 96.4 },
  validation: { medianIoU: 0.7819, anchorInsideMaskRate: 0.9524, holdoutUndetected: 243, heldoutPairs: 1027 },
};

test('3D 牆的報告：量測五步的數字照檔案（不是門檻）；有 AI 逐顆檢查就多一步，沒看完、等人的標出來', () => {
  const r = W3.build(PHOTO, T);
  assert.deepEqual(r.steps.map(s => [s.name, s.value]), [['w3rShoot', '165'], ['w3rDetect', '42,046'], ['w3rModel', '75,665'], ['w3rVote', '1,122'], ['w3rCheck', '81%']]);
  assert.deepEqual(r.steps[2].lines.map(l => l.text), ['w3rReproj(0.92)', 'w3rMinutes(30)']);
  assert.equal(r.steps[3].lines.length, 1);   // 候選全部留下
  assert.deepEqual(r.steps[4].lines.map(l => [l.text, l.tone]), [['w3rAnchors(96)', undefined], ['w3rUndetected(131)', 'warn']]);
  assert.equal(r.defn, 'w3rDefn(1,488)');
  assert.deepEqual(W3.build(VIDEO, T).steps[3].lines[1], { text: 'w3rDropped(524)', tone: 'warn' });
  const ai = W3.build(null, T, { total: 1098, looked: 1096, need: ['a', 'b'], retake: ['c'], off: 30, reshaped: 120 });
  assert.deepEqual(ai.steps.map(s => [s.name, s.value]), [['w3rAi', '1,096/1,098']]);
  assert.deepEqual(ai.steps[0].lines.map(l => [l.text, l.tone]), [['w3rAiOff(30)', undefined], ['w3rAiReshaped(120)', undefined], ['w3rAiRetake(1)', 'warn'], ['w3rAiLeft(2)', 'bad']]);
  assert.equal(ai.defn, '');
});

test('3D 牆的工作資料夾：每顆要發佈的岩點都要 AI 看過才問發佈；off、reshape 改 wall.json，重描的要再看；只有照片不夠才問人要不要補拍', () => {
  const dir = mkdtempSync(join(tmpdir(), 'w3q-'));
  const cli = (...a) => execFileSync(process.execPath, ['tools/studio.mjs', ...a], { encoding: 'utf8' });
  const ask = () => JSON.parse(cli('ask', dir, '--json', '--all'));
  const wall = () => JSON.parse(readFileSync(join(dir, 'wall.json'), 'utf8'));
  const review = (list) => { writeFileSync(join(dir, 'v.json'), JSON.stringify(list)); return cli('review3d', dir, join(dir, 'v.json'), '--by', 'agent:t'); };
  try {
    const holds = ['h1', 'h2', 'h3', 'h4'].map(id => ({ id, position: [0, 0, 0], faceCount: 9 }));
    writeFileSync(join(dir, 'wall.json'), JSON.stringify({ format: 'climbio-3d-wall/1', id: 'wallaaaabbbbcccc', name: '明德', model: 'm.glb', faces: 'f.bin', holds, surfaces: { list: [], frame: { planes: [] } } }));
    writeFileSync(join(dir, 'm.glb'), 'glb'); writeFileSync(join(dir, 'f.bin'), 'faces');
    // AI 檢查分三階段：先模型、再鏡頭動線（代理看 check3d 的圖自己答），過了才逐顆看岩點
    for (const k of ['model3d', 'path3d']) {
      const q = JSON.parse(cli('ask', dir, '--json'));
      assert.deepEqual(q.map(x => x.kind), [k]);
      cli('answer', dir, q[0].id, 'ok', '--by', 'agent:t');
    }
    let qs = ask().filter(q => !['model3d', 'path3d'].includes(q.kind));
    assert.deepEqual(qs.map(q => q.kind), ['look3d']);   // 沒看過：不問發佈
    assert.match(qs[0].title, /^4 顆岩點 AI 還沒看過/);
    // look3d 出的圖（這裡直接放 index.json，出圖要瀏覽器）
    const look = join(dir, '.studio', 'work', 'look'), cam = [0, 0, 1, 0, 0, 0, 1];
    mkdirSync(look, { recursive: true });
    writeFileSync(join(look, 'index.json'), JSON.stringify({ size: 256, holds: Object.fromEntries(holds.map((h, i) => [h.id, { n: i + 1, sheet: 'sheet-001.jpg', c: cam, a: 1 }])) }));
    writeFileSync(join(look, 'h4.jpg'), 'jpg');
    assert.throws(() => review([{ n: 4, v: 'unsure', note: '看不準' }]), /keep、off、reshape、retake/);   // 看不準也要自己判斷
    assert.throws(() => review([{ n: 4, v: 'retake' }]), /retake 要寫 note/);
    review([{ n: 1, v: 'keep' }, { n: 2, v: 'off', why: '貼紙' }, { n: 3, v: 'reshape', poly: [[0, 0], [128, 0], [128, 256]] }, { n: 4, v: 'retake', note: '左下角照片太糊' }]);
    const w = wall();
    assert.equal(w.holds[1].off, 1);
    assert.deepEqual(w.edits, [{ id: 'h3', m3: { c: cam, p: [[0, 0], [0.5, 0], [0.5, 1]], a: 1 } }]);
    qs = ask().filter(q => !['model3d', 'path3d'].includes(q.kind));
    assert.deepEqual(qs.map(q => q.kind).sort(), ['look3d', 'retake']);   // 重描的 h3 要再看一次；h4 照片不夠，問人要不要補拍
    assert.match(qs.find(q => q.kind === 'look3d').title, /^1 顆/);
    const rt = qs.find(q => q.kind === 'retake');
    assert.match(rt.title, /左下角照片太糊/);
    assert.equal(rt.evidence[0].image, '.studio/evidence/h4.jpg');
    review([{ n: 3, v: 'keep' }]);
    assert.equal(JSON.parse(readFileSync(join(dir, 'review3d.json'), 'utf8')).holds.h3.re, 1);
    assert.deepEqual(ask().filter(q => !['model3d', 'path3d'].includes(q.kind)).map(q => q.kind), ['retake']);
    assert.throws(() => cli('answer', dir, rt.id, 'ok', '--by', 'agent:t'), /只能由人|人/);
    cli('answer', dir, rt.id, 'ok', '--by', 'human:kk', '--said', '不用補拍');
    // AI 看完：先請人試用，不直接問發佈
    const open = () => ask().filter(q => !['retake', 'look3d', 'model3d', 'path3d'].includes(q.kind));
    let tq = open();
    assert.deepEqual(tq.map(q => q.kind), ['trial3d']);
    assert.throws(() => cli('answer', dir, tq[0].id, 'ok', '--by', 'agent:t'), /只能由人|人/);
    // 人在 Studio 試用時回報一顆（feedback3d.json 是 Studio 寫的），代理修完記下處理
    let fb = FB.add(null, { hold: 'h1', point: [0, 0, 0], camera: cam, aspect: 1, text: '光暈溢到牆上' });
    writeFileSync(join(dir, 'feedback3d.json'), JSON.stringify(fb));
    tq = open();
    assert.deepEqual(tq.map(q => q.kind), ['feedback3d']);
    assert.match(tq[0].title, /光暈溢到牆上/);
    assert.throws(() => cli('resolve3d', dir, fb.items[0].id), /--note/);
    cli('resolve3d', dir, fb.items[0].id, '--note', '重描外框', '--by', 'agent:t');
    tq = open();
    assert.deepEqual(tq.map(q => q.kind), ['trial3d']);   // 處理完要人再試用
    assert.match(tq[0].title, /光暈溢到牆上」→ 重描外框/);
    // 人在 Studio 按「試用完」：這一版的指紋對得上才問發佈；之後內容又改了就要再試用
    fb = FB.markTried(JSON.parse(readFileSync(join(dir, 'feedback3d.json'), 'utf8')), wall());
    writeFileSync(join(dir, 'feedback3d.json'), JSON.stringify(fb));
    assert.deepEqual(open().map(q => q.kind), ['publish']);
    const w2 = wall(); w2.holds[0].off = 1; writeFileSync(join(dir, 'wall.json'), JSON.stringify(w2));
    assert.deepEqual(open().map(q => q.kind), ['trial3d']);   // 內容改了（拿掉一顆）：要人再試用，不會直接問發佈
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('3D 牆試用的指紋：只看最終決定，順序不同也一樣；改了不是岩點或修點就不同', () => {
  const doc = { holds: [{ id: 'a' }, { id: 'b', off: 1 }], edits: [{ id: 'x', m3: { c: [1], p: [[0, 0]], a: 1 } }, { id: 'c', m3: { c: [2], p: [[1, 1]], a: 1 } }], surfaces: { list: [{}, { hidden: true }], frame: { planes: [] } } };
  const same = { ...doc, edits: [...doc.edits].reverse() };
  assert.equal(FB.sig(doc), FB.sig(same));
  assert.notEqual(FB.sig(doc), FB.sig({ ...doc, holds: [{ id: 'a', off: 1 }, { id: 'b', off: 1 }] }));
  assert.notEqual(FB.sig(doc), FB.sig({ ...doc, edits: [] }));
  const st = FB.status(doc, FB.markTried(FB.add(null, { text: '漏了一顆', point: [0, 0, 0], camera: [], aspect: 1 }), doc));
  assert.deepEqual([st.open.length, st.done.length, st.tried], [1, 0, true]);
});

test('天然岩場：有實測才出認牆、路線投影兩步；有誤判標紅', () => {
  const lab = { zones: [{ modelBytes: 2e6, faces: 1000 }, { modelBytes: 3e6, faces: 500 }], evaluation: { holdoutTotal: 20, holdoutCorrectWall: 19, crossWallFalsePositive: 1, negativeFalsePositive: 0, medianRoutePx: 12 } };
  const r = CR.build(lab, T);
  assert.deepEqual(r.steps.map(s => [s.name, s.value]), [['clrModel', 2], ['clrRecognize', '95%'], ['clrProject', 12]]);
  assert.equal(r.steps[0].lines[0].text, 'clrSize(5.0)');
  assert.equal(r.steps[1].lines[1].tone, 'bad');
  const only = CR.build({ zones: [{ modelBytes: 1e6, faces: 10 }] }, T);
  assert.deepEqual(only.steps.map(s => s.name), ['clrModel']);
  assert.equal(only.defn, '');
});
