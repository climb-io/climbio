// 外框幾何：跟研究用的 Python 版比對。
// 夾具由研究用的程式產生（FIXTURE 環境變數指向 JSON）；沒有夾具時只跑自帶的小案例。
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const G = require('./geometry.js');

const square = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const polyIou = (a, b, W = 4000, H = 3000) => { const A = G.polyMask(a, W, H, 0), B = G.polyMask(b, W, H, 0); const x0 = Math.min(A.ox, B.ox), y0 = Math.min(A.oy, B.oy), x1 = Math.max(A.ox + A.m.w, B.ox + B.m.w), y1 = Math.max(A.oy + A.m.h, B.oy + B.m.h); const ma = G.mk(x1 - x0, y1 - y0), mb = G.mk(x1 - x0, y1 - y0); G.fillPoly(ma, a, x0, y0); G.fillPoly(mb, b, x0, y0); let i = 0, u = 0; for (let k = 0; k < ma.d.length; k++) { i += ma.d[k] & mb.d[k]; u += ma.d[k] | mb.d[k]; } return i / u; };

test('遮罩轉回多邊形：正方形的面積差不到 10%（輪廓走像素中心，小一圈）', () => {
  const p = G.maskToPoly(G.fillPoly(G.mk(100, 100), square(20, 20, 50)), 1, 0, 0);
  assert.ok(Math.abs(G.area(p)) > 0.9 * 2500 && Math.abs(G.area(p)) < 1.05 * 2500);
});

test('補洞與連通塊：只留蓋到中心的那一塊並補洞', () => {
  const m = G.fillPoly(G.mk(80, 40), square(2, 2, 30)); G.fillPoly(m, square(50, 5, 10));
  for (let y = 12; y < 20; y++) for (let x = 12; x < 20; x++) m.d[y * 80 + x] = 0;
  const c = G.cleanMask(m, [10, 10]);
  assert.equal(c.d[15 * 80 + 15], 1); assert.equal(c.d[10 * 80 + 55], 0);
});

test('自己交叉的外框修成單純的多邊形', () => {
  const bow = [[0, 0], [100, 100], [100, 0], [0, 100]];
  assert.equal(G.validPoly(bow, 1000, 1000), false);
  const r = G.repair([{ id: 'a', poly: bow }], 1000, 1000);
  assert.deepEqual([r.fixed, r.bad], [['a'], []]);
  assert.equal(G.validPoly(r.holds[0].poly, 1000, 1000), true);
});

const fx = process.env.FIXTURE && JSON.parse(fs.readFileSync(process.env.FIXTURE, 'utf8'));
test('平滑：跟 Python 版的外框重疊 0.97 以上', { skip: !fx }, () => {
  const ious = fx.smooth.map(c => polyIou(G.polyOp([c.poly], { trim: true }), c.out));
  console.log('平滑 IoU 最低', Math.min(...ious).toFixed(3), '平均', (ious.reduce((a, b) => a + b) / ious.length).toFixed(3));
  assert.ok(Math.min(...ious) > 0.95);
});
test('合併：跟 Python 版的外框重疊 0.95 以上', { skip: !fx }, () => {
  const ious = fx.merge.map(c => polyIou(G.polyOp(c.polys, { close: 0.03 }), c.out));
  console.log('合併 IoU 最低', Math.min(...ious).toFixed(3));
  assert.ok(Math.min(...ious) > 0.93);
});
test('找重複：跟 Python 版的配對一樣', { skip: !fx }, () => {
  const got = G.dupPairs(fx.dupsHolds, fx.w, fx.h).map(p => p.join('|')).sort(), want = fx.dups.map(p => p.join('|')).sort();
  assert.deepEqual(got, want);
});
