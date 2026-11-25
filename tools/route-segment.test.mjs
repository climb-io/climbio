import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RouteKit } from './routekit.mjs';

// 分段播放的切段（routekit/image.js 的 segmentSeq）：段長由路線長度和岩點重複決定，沒有段長參數
const { segmentSeq, segmentFrame } = RouteKit;

const covers = (seq, parts) => {
  assert.equal(parts[0].from, 0);
  assert.equal(parts.at(-1).to, seq.length);
  parts.forEach((p, i) => {
    assert.ok(p.to > p.from);
    if (i) assert.equal(p.from, parts[i - 1].to);
  });
};

test('沒有手順是空的；8 手以內不切', () => {
  assert.deepEqual(segmentSeq(undefined), []);
  assert.deepEqual(segmentSeq([]), []);
  assert.deepEqual(segmentSeq(['a', 'b', 'a']), [{ from: 0, to: 3 }]);
  assert.equal(segmentSeq(Array.from({ length: 8 }, (_, i) => 'h' + i)).length, 1);
  assert.equal(segmentSeq.length, 1);   // 不接受段長
});

test('超過 8 手就切開，每段都接得上', () => {
  const seq = Array.from({ length: 9 }, (_, i) => 'h' + i);
  const parts = segmentSeq(seq);
  assert.ok(parts.length >= 2);
  covers(seq, parts);
});

test('近距離重複不被切開，遠距離重複不放在同一段', () => {
  const seq = Array.from({ length: 18 }, (_, i) => 'h' + i);
  seq[7] = seq[5];   // 索引 5、7：中間只隔 1 手，理想的 6 手切點會從中間切開
  assert.deepEqual(segmentSeq(seq), [{ from: 0, to: 5 }, { from: 5, to: 11 }, { from: 11, to: 18 }]);
  const far = Array.from({ length: 16 }, (_, i) => 'h' + i);
  far[10] = far[0];
  for (const p of segmentSeq(far)) assert.ok(!(p.from <= 0 && p.to > 10), '第 1 手和第 11 手不該在同一段');
});

// 紅膠帶 V7（原岩萬華 2F，qob3734416nc / rmvroyfsmc7cq3）：51 手、47 顆，3 顆重複
const RED = ['hmvroy3dpdeu90', 'hmvroy3f719h03', 'hmvroy3e98pxnr', 'hmvroy3fdta7i6', 'hmvroy39l0jam6', 'hmvroy3fitu1ro', 'hmvroy3ebn6b3z', 'hmvroy3eth4s2g', 'hmvroy3bpqua7s', 'hmvroy3cvk4jt9', 'hmvroy3bosh62f', 'hmvroy3cgxf10p', 'hmvroy3e6zket3', 'hmvroy3fas9kq7', 'hmvroy3c2h4st8', 'hmvroy3fdta7i6', 'hmvrp8zsc1r62k', 'hmvroy399styq2', 'hmvroy3f0s6x14', 'hmvrpb943aii0v', 'hmvroy3fc0i447', 'hmvroy3fgyp268', 'hmvroy3e1dvhhp', 'hmvroy3fk427oy', 'hmvroy3b0c299e', 'hmvroy3ereuja1', 'hmvroy3essxirh', 'hmvroy3fhf8mdr', 'hmvroy3crenyek', 'hmvroy3f611vto', 'hmvroy3fnjl010', 'hmvroy3er3byy0', 'hmvroy3ff4l24w', 'hmvroy3ct0ejhf', 'hmvroy3flzsciw', 'hmvroy37gr2kkj', 'hmvrpgckek821n', 'hmvroy3frpn3u9', 'hmvroy3fqcpr84', 'hmvrpj3av7lnar', 'hmvroy3fo8pqsi', 'hmvroy39l0jam6', 'hmvroy3chx7o3a', 'hmvroy39vab94d', 'hmvroy39l0jam6', 'hmvroy3ejij1lc', 'hmvroy3exa4gz5', 'hmvroy3eth4s2g', 'hmvroy3agb3fax', 'hmvroy3dhgopur', 'hmvroy39282g35'];

test('紅膠帶 V7：51 手切成 7 段，近的重複留在一起、遠的分開', () => {
  assert.equal(RED.length, 51);
  assert.equal(new Set(RED).size, 47);
  const parts = segmentSeq(RED);
  assert.deepEqual(parts, [
    { from: 0, to: 7 }, { from: 7, to: 14 }, { from: 14, to: 21 }, { from: 21, to: 29 },
    { from: 29, to: 37 }, { from: 37, to: 45 }, { from: 45, to: 51 },
  ]);
  const holds = { [RED[0]]: 's', [RED.at(-1)]: 't' };
  for (const id of RED) if (!holds[id]) holds[id] = 'h';
  const near = segmentFrame({ holds, seq: RED }, 5);
  assert.deepEqual(near.numbers.hmvroy39l0jam6, [42, 45]);   // 第 5 手那次在更前面，這一段不標
  assert.equal(near.numbers.hmvroy39l0jam6.includes(5), false);
  const first = segmentFrame({ holds, seq: RED }, 0);
  assert.deepEqual(first.futureAnchors, [RED.at(-1)]);   // 完攀還沒到，留著當結尾
  assert.equal(first.current[0], RED[0]);
  // 三顆重複岩點的遠距離兩次都不在同一段
  const at = (id) => parts.filter((p) => RED.slice(p.from, p.to).includes(id)).map((p) => p.from);
  assert.deepEqual(at('hmvroy3fdta7i6'), [0, 14]);       // 第 4、16 手
  assert.deepEqual(at('hmvroy39l0jam6'), [0, 37]);       // 第 5 手，以及第 42、45 手（同一段）
  assert.deepEqual(at('hmvroy3eth4s2g'), [7, 45]);       // 第 8、48 手
});

test('內嵌頁的 segment 只是開關，沒有段長或秒數選項', () => {
  const app = readFileSync(new URL('../embed/routekit/v2/app.js', import.meta.url), 'utf8');
  const types = readFileSync(new URL('../embed/routekit/v2/messages.d.ts', import.meta.url), 'utf8');
  assert.match(app, /params\.get\('segment'\) === '1'/);
  assert.match(types, /segment\?: boolean/);
  assert.doesNotMatch(app, /segmentSize|segmentMs|segmentAuto|固定段長/);
  assert.doesNotMatch(types, /segmentSize|segmentMs|moves\?:/);
});
