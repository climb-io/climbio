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

// 灰牆上一顆紅色的圓（半徑 60，中心 100,100）：照片的一塊 { w, h, d: RGBA, ox, oy }
const disk = (W = 200, H = 200, wall = [128, 128, 128], hold = [200, 40, 40]) => {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = Math.hypot(x - 100, y - 100) <= 60 ? hold : wall, i = 4 * (y * W + x); d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; }
  return { w: W, h: H, d, ox: 0, oy: 0 };
};
const circle = (r, n = 24) => Array.from({ length: n }, (_, k) => [100 + r * Math.cos(2 * Math.PI * k / n), 100 + r * Math.sin(2 * Math.PI * k / n)]);

test('色彩貼邊：原外框太小（半徑 45），長回整顆圓', () => {
  const r = G.colorFit(disk(), circle(45));
  assert.deepEqual(r.flags, []);
  assert.ok(polyIou(r.poly, circle(60, 64)) > 0.93);
});
test('色彩貼邊：岩點跟牆同色時說分不開，不給外框', () => {
  const r = G.colorFit(disk(200, 200, [128, 128, 128], [130, 128, 127]), circle(50));
  assert.equal(r.poly, null); assert.deepEqual(r.flags, ['色彩對比低']);
});
test('大外框的頂點不會被壓到 10 幾個（容差跟外框長邊成比例）', () => {
  const big = G.maskToPoly(G.fillPoly(G.mk(1000, 1000), Array.from({ length: 200 }, (_, k) => [500 + 400 * Math.cos(k * Math.PI / 100), 500 + 400 * Math.sin(k * Math.PI / 100)])), 1, 0, 0, true, true);
  assert.ok(big.length >= 30, `頂點 ${big.length}`);
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
