import test from 'node:test';
import assert from 'node:assert/strict';
import { RouteKit } from './routekit.mjs';

// 定線的規則（routekit/editor.js）：點岩點加進路線、改類型、拿掉；起攀上限；出手順序
const { tapHold, appendSeq, insertSeq, popSeq, toggleFeetFree, clearFeet, MAX_START } = RouteKit;

test('點一顆：加進來、類型不同就改、類型一樣就拿掉（出手順序裡的也拿掉）', () => {
  const r = { holds: {} };
  assert.equal(tapHold(r, 'a', 'h'), 'added');
  assert.equal(tapHold(r, 'a', 'f'), 'changed');
  assert.deepEqual(r.holds, { a: 'f' });
  appendSeq(r, 'a');
  assert.equal(tapHold(r, 'a', 'f'), 'removed');
  assert.deepEqual(r, { holds: {} });
});

test('起攀上限可以設（maxStart）：預設 2（岩點貓），有的岩館規定 4；滿了新的點變手點、已在路線上的不能改成起攀', () => {
  const r = { holds: {} };
  for (const id of ['a', 'b', 'c', 'd']) assert.equal(tapHold(r, id, 's', { maxStart: 4 }), 'added');
  assert.equal(RouteKit.startCount(r), 4);
  assert.equal(tapHold(r, 'e', 's', { maxStart: 4 }), 'added');                 // 滿了：新的點變手點
  assert.equal(r.holds.e, 'h');
  assert.equal(tapHold(r, 'e', 's', { maxStart: 4 }), 'full');                  // 已在路線上的手點不能改成起攀
  assert.equal(r.holds.e, 'h');
  assert.equal(tapHold(r, 'a', 's', { maxStart: 4 }), 'removed');               // 拿掉一個，又有位置
  assert.equal(tapHold(r, 'e', 's', { maxStart: 4 }), 'changed');
  const d = { holds: {} };                                                      // 沒給 maxStart 還是 2
  tapHold(d, 'a', 's'); tapHold(d, 'b', 's'); tapHold(d, 'c', 's');
  assert.deepEqual(d.holds, { a: 's', b: 's', c: 'h' });
});

test('剛加進來的同一顆快速點兩下不算拿掉', () => {
  const r = { holds: {} };
  tapHold(r, 'a', 's');
  assert.equal(tapHold(r, 'a', 's', { justAdded: true }), 'ignored');
  assert.deepEqual(r.holds, { a: 's' });
});

test('起攀滿了：新的點改成手點，已在路線上的不動', () => {
  const r = { holds: {} };
  for (let i = 0; i < MAX_START; i++) tapHold(r, 's' + i, 's');
  assert.equal(tapHold(r, 'n', 's'), 'added');
  assert.equal(r.holds.n, 'h');
  assert.equal(tapHold(r, 'n', 's'), 'full');
  assert.equal(r.holds.n, 'h');
});

test('出手順序：追加一手、同一顆可以重複；收回時順便加進來的岩點一起拿掉', () => {
  const r = { holds: { a: 's' } };
  assert.equal(appendSeq(r, 'a'), false);
  assert.equal(appendSeq(r, 'b'), true);
  appendSeq(r, 'a');
  assert.deepEqual(r.seq, ['a', 'b', 'a']);
  popSeq(r, false);
  popSeq(r, true);
  assert.deepEqual(r, { holds: { a: 's' }, seq: ['a'] });
  popSeq(r, false);
  assert.deepEqual(r, { holds: { a: 's' } });
});

test('出手順序：插在中間，後面的手順順延；收回指定位置的那一手', () => {
  const r = { holds: { a: 's', b: 'h', d: 'h' }, seq: ['a', 'b', 'd'] };
  assert.equal(insertSeq(r, 'c', 2), true);
  assert.deepEqual(r.seq, ['a', 'b', 'c', 'd']);
  assert.equal(r.holds.c, 'h');
  assert.equal(insertSeq(r, 'b', 0), false);
  assert.deepEqual(r.seq, ['b', 'a', 'b', 'c', 'd']);
  assert.equal(insertSeq(r, 'a', 99), false);
  assert.deepEqual(r.seq, ['b', 'a', 'b', 'c', 'd', 'a']);
  popSeq(r, false, 0);
  popSeq(r, true, 2);
  assert.deepEqual(r.seq, ['a', 'b', 'd', 'a']);
  assert.equal(r.holds.c, undefined);
});

test('不限腳：切換路線旗標，關掉時不留欄位', () => {
  const r = { holds: { a: 's' } };
  assert.equal(toggleFeetFree(r), true);
  assert.equal(r.feetFree, true);
  assert.equal(toggleFeetFree(r), false);
  assert.deepEqual(r, { holds: { a: 's' } });
});

test('清掉腳點：路線上的腳點與它在順序裡的編號都拿掉', () => {
  const r = { holds: { a: 's', f1: 'f', f2: 'f', b: 'h' }, seq: ['a', 'f1', 'b', 'f1'] };
  assert.equal(clearFeet(r), 2);
  assert.deepEqual(r, { holds: { a: 's', b: 'h' }, seq: ['a', 'b'] });
  assert.equal(clearFeet(r), 0);
});

test('起攀加滿就切到手點（岩點貓和內嵌頁共用同一條規則 nextType），其他類型不變', () => {
  const r = { holds: {} };
  tapHold(r, 'a', 's');
  assert.equal(RouteKit.nextType(r, 's'), 's');                  // 只有 1 個起攀：還是起攀
  tapHold(r, 'b', 's');
  assert.equal(RouteKit.nextType(r, 's'), 'h');                  // 第 2 個加進去：切到手點（預設上限 2）
  assert.equal(RouteKit.nextType(r, 's', 4), 's');               // 有的岩館規定 4：還沒滿
  assert.equal(RouteKit.nextType(r, 't'), 't');                  // 完攀、腳點、順序不受影響
});

test('同一條規則只有一份：岩點貓（js/edit.js）和內嵌頁都用 kit 的 nextType，不各寫一份', async () => {
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync(new URL('../js/edit.js', import.meta.url), 'utf8'), /RouteKit\.nextType\(/);
  assert.match(readFileSync(new URL('../routekit/viewer.js', import.meta.url), 'utf8'), /E\.nextType\(/);
});

// 重疊岩點的選擇、熱圖次數、出手順序的編輯工作階段：岩點貓和內嵌頁共用的規則
const box = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
test('重疊岩點：點在裡面的岩點面積小的在前；圓點各自在獨占區；完全重合的改放右側帶引線的選點；點圓點或點在哪顆裡面就選哪顆', () => {
  const big = { id: 'big', poly: box(100, 100, 200, 200) }, small = { id: 'small', poly: box(150, 150, 40, 40) }, same = { id: 'same', poly: box(100, 100, 200, 200) };
  assert.deepEqual(RouteKit.holdsUnder([big, small], 160, 160).map(h => h.id), ['small', 'big']);
  assert.deepEqual(RouteKit.holdsUnder([big, small], 250, 250).map(h => h.id), ['big']);
  const spots = RouteKit.overlapSpots([small, big], 1000, 800);
  assert.ok(RouteKit.inPoly(spots.get(small).x, spots.get(small).y, small.poly));
  assert.ok(RouteKit.inPoly(spots.get(big).x, spots.get(big).y, big.poly) && !RouteKit.inPoly(spots.get(big).x, spots.get(big).y, small.poly));   // 大的圓點不放在小的裡面
  const three = RouteKit.overlapSpots([big, same], 1000, 800);
  assert.ok(three.get(same).anchor || three.get(big).anchor);   // 完全重合的沒有獨占區：有引線
  const s = spots.get(big);
  assert.equal(RouteKit.pickOverlap([small, big], spots, s.x + 3, s.y, 16), big);       // 點圓點
  assert.equal(RouteKit.pickOverlap([small, big], spots, 280, 280, 5), big);            // 不在圓點上：點在哪顆裡面
  assert.equal(RouteKit.pickOverlap([small, big], spots, 20, 20, 5), null);             // 候選以外：取消
});

test('Volume 的候選保留原本兩顆，上面的其他岩點照樣可以直接點', () => {
  const volume = { id: 'volume', poly: box(0, 0, 180, 120) }, first = { id: 'first', poly: box(20, 30, 20, 20) };
  const other = { id: 'other', poly: box(65, 30, 20, 20) }, outside = { id: 'outside', poly: box(176, 70, 20, 20) };
  const wall = [volume, first, other, outside], candidates = RouteKit.holdsUnder(wall, 30, 40);
  const { neighbors, spots } = RouteKit.prepareOverlapPick(candidates, wall, { w: 200, h: 150, width: 400, height: 800 });
  assert.deepEqual(candidates, [first, volume]);
  assert.deepEqual(neighbors, [other]);
  assert.deepEqual([...spots.keys()].map(h => h.id).sort(), ['first', 'volume']);
  const direct = RouteKit.holdAt(wall, 66, 40);
  spots.set(volume, { x: 54, y: 40 });   // 岩點在圓點外，仍在其容錯範圍內。
  assert.equal(RouteKit.pickOverlap(candidates, spots, 66, 40, 16, direct), other);
  assert.equal(RouteKit.pickOverlap(candidates, spots, 55, 40, 16, volume), volume);
});

test('熱圖：其他路線用過每顆幾次（不含正在定的這條），最熱的至少當 3 次算；0＝沒用過', () => {
  const cur = { id: 'cur', holds: { a: 's' } };
  const heat = RouteKit.holdUse([cur, { id: 'x', holds: { a: 's', b: 'h' } }, { id: 'y', holds: { b: 'h' } }, { id: 'z', holds: { b: 't' } }], cur);
  assert.equal(heat.use.get('b'), 3); assert.equal(heat.use.get('a'), 1); assert.equal(heat.max, 3);   // 正在定的 cur 的 a 不算：只有 x 用了 a
  assert.equal(RouteKit.heatLevel(heat, 'b'), 1); assert.equal(RouteKit.heatLevel(heat, 'a'), 0.25); assert.equal(RouteKit.heatLevel(heat, 'zzz'), 0);
});

test('出手順序工作階段：追加、插在第 n 手之後（游標往後一格）、刪掉某一手（手點沒編號就拿掉）、復原一路收回、清除', () => {
  const r = { holds: { a: 's' } }, o = RouteKit.orderSession();
  assert.equal(o.tap(r, 'a'), 1); assert.equal(o.tap(r, 'b'), 2); assert.equal(o.tap(r, 'c'), 3);
  assert.deepEqual(r.seq, ['a', 'b', 'c']); assert.equal(r.holds.b, 'h');                       // 不在路線上的順便當手點
  assert.deepEqual(o.numbers(r, 'b'), [2]);
  o.startInsert(r, 1); assert.equal(o.insertAt(r), 1);
  o.tap(r, 'd'); assert.deepEqual(r.seq, ['a', 'd', 'b', 'c']); assert.equal(o.insertAt(r), 2);   // 插在第 1 手之後，游標往後
  o.endInsert(); assert.equal(o.insertAt(r), null);
  o.remove(r, 3); assert.deepEqual(r.seq, ['a', 'd', 'c']); assert.equal(r.holds.b, undefined);   // 第 3 手 b：手點沒有編號了一起拿掉
  assert.ok(o.undo(r)); assert.deepEqual(r.seq, ['a', 'd', 'b', 'c']); assert.equal(r.holds.b, 'h');   // 復原刪除
  assert.ok(o.undo(r)); assert.deepEqual(r.seq, ['a', 'b', 'c']);                                  // 復原插入
  o.clear(r); assert.equal(r.seq, undefined); assert.equal(o.canUndo(r), false);
});

test('freehandPoly：畫一圈的軌跡簡化成少數頂點，頭尾自動接起來，限制在照片裡，太小回傳 null', () => {
  const pts = [];
  for (let i = 0; i <= 20; i++) pts.push([100 + i * 4, 100 + (i % 2)]);   // 上緣：帶一點手抖
  for (let i = 1; i <= 15; i++) pts.push([180 + (i % 2), 100 + i * 4]);   // 右緣
  for (let i = 1; i <= 20; i++) pts.push([180 - i * 4, 160 + (i % 2)]);   // 下緣
  for (let i = 1; i <= 14; i++) pts.push([100 + (i % 2), 160 - i * 4]);   // 左緣
  const p = RouteKit.freehandPoly(pts, 640, 480);
  assert.ok(p.length >= 4 && p.length <= 8, `頂點 ${p.length}`);
  const b = RouteKit.bbox(p);
  assert.ok(Math.abs(b.x0 - 100) < 3 && Math.abs(b.x1 - 180) < 3 && Math.abs(b.y0 - 100) < 3 && Math.abs(b.y1 - 160) < 3);
  assert.ok(Math.abs(RouteKit.area(p) - 80 * 60) < 400);
  for (const [x, y] of RouteKit.freehandPoly([[-20, -20], [30, -20], [30, 30], [-20, 30]], 640, 480)) assert.ok(x >= 0 && y >= 0);
  assert.equal(RouteKit.freehandPoly([[10, 10], [11, 10], [11, 11]], 640, 480), null);   // 太小
  assert.equal(RouteKit.freehandPoly([[10, 10], [50, 10], [90, 10]], 640, 480), null);   // 一直線（沒有面積）
});
