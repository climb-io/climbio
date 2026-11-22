import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const RK = require('../routekit/index.js');

// 路線視角（routekit/fit.js）：岩點貓與內嵌頁同一份算法
const sq = (id, x, y, s = 40) => ({ id, poly: [[x, y], [x + s, y], [x + s, y + s], [x, y + s]] });
const g = { W: 400, H: 800, bw: 400, bh: 300, maxScale: 10 };   // 640×480 的照片放進 400×800 的框：s=1 時 400×300
const fakeScene = (holds) => ({ w: 640, h: 480, holds, labels: () => [] });

test('fitBoxIn：範圍放進畫面（四周留邊、上面讓出工具列），最多放大到最大倍數，不小於 1', () => {
  const small = RK.fitBoxIn({ x0: 300, y0: 200, x1: 340, y1: 240 }, g, { photoW: 640, topInset: 60 });
  assert.equal(small.s, 800 / 300);   // 範圍很小：最多放大到「照片填滿畫面」（這個框裡 800／300）
  const wide = RK.fitBoxIn({ x0: 0, y0: 0, x1: 640, y1: 480 }, g, { photoW: 640, topInset: 60 });
  assert.equal(wide.s, 1);   // 整張照片：寬度（扣掉留邊）放不下，不縮到比 1 小
  const k1 = (g.bw / 640) * small.s;
  assert.ok(Math.abs(small.tx - (g.W / 2 - 320 * k1)) < 1e-9);   // 範圍中心放在框的中央
  assert.ok(Math.abs(small.ty - ((60 + g.H - 32) / 2 - 220 * k1)) < 1e-9);   // 垂直中央在「工具列下面到下緣留邊」之間
});

test('groupBox：相鄰路線的範圍差不多就併成一組，差很多（各自放大）就分開；路線不在 routes 裡或沒有岩點回傳 null', () => {
  const hs = [sq('a', 100, 100), sq('b', 160, 100), sq('c', 500, 400)];
  const r1 = { id: 'r1', holds: { a: 's', b: 't' } }, r2 = { id: 'r2', holds: { a: 's', b: 'h' } }, r3 = { id: 'r3', holds: { c: 's' } }, empty = { id: 'e', holds: {} };
  const holdsOf = (q) => hs.filter((h) => q.holds[h.id]);
  const fit = (b) => RK.fitBoxIn(b, g, { photoW: 640 });
  const box12 = RK.groupBox([r1, r2, r3], r1, { holdsOf, fit });
  assert.deepEqual(box12, RK.groupBox([r1, r2, r3], r2, { holdsOf, fit }));   // r1、r2 同一組：視角一樣
  assert.deepEqual([box12.x0, box12.x1], [100, 200]);
  assert.notDeepEqual(RK.groupBox([r1, r2, r3], r3, { holdsOf, fit }), box12);   // r3 離得遠：自成一組
  assert.equal(RK.groupBox([r1, r2, r3], empty, { holdsOf, fit }), null);
  assert.equal(RK.groupBox([empty], empty, { holdsOf, fit }), null);
});

test('routeFit：一條路線的岩點（含標籤）放進畫面；沒有岩點回傳 null（外層用整張照片）', () => {
  const hs = [sq('a', 100, 100), sq('b', 160, 100)], scene = fakeScene(hs), r = { id: 'r', holds: { a: 's', b: 't' } };
  const f = RK.routeFit(scene, [r], r, g, { topInset: 60 });
  assert.ok(f.s > 1 && f.s <= g.maxScale);
  const withLabels = { ...scene, labels: () => [{ rect: { x0: 100, y0: 20, x1: 140, y1: 60 }, tape: { x0: 100, y0: 0, x1: 140, y1: 20 } }] };
  const f2 = RK.routeFit(withLabels, [r], r, g, { topInset: 60 });
  assert.ok(f2.s <= f.s);   // 標籤也放進畫面：範圍變大，不會放得更大
  assert.equal(RK.routeFit(scene, [{ id: 'e', holds: {} }], { id: 'e', holds: {} }, g), null);
});

// 縮放、平移的邊界（routekit/viewport.js 的 clampView）：岩點貓的 clampView 呼叫它；跟岩點貓原本的算式逐一比對
test('clampView：跟岩點貓原本的邊界算式一致（最小縮放、置中時讓出工具列）', () => {
  const old = (s, tx, ty, { W, H, bw, bh, pads, maxScale, minScale, fitPads }) => {   // 岩點貓 js/wall.js 原本的非 3D 傾斜部分
    s = Math.min(maxScale, Math.max(minScale, s));
    const w = bw * s, h = bh * s, [pt, pb] = pads;
    tx = w <= W ? (W - w) / 2 : Math.min(0, Math.max(W - w, tx));
    const [ft, fb] = fitPads, mid = ft + (H - ft - fb - h) / 2;
    ty = Math.min(Math.max(pt, mid), Math.max(Math.min(H - pb - h, mid), ty));
    return { s, tx, ty };
  };
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 2000; i++) {
    const geo = { W: 300 + rnd() * 800, H: 400 + rnd() * 600, bw: 200 + rnd() * 800, bh: 150 + rnd() * 600, pads: [rnd() * 90, rnd() * 140], maxScale: 4 + rnd() * 20, minScale: rnd() < 0.3 ? 0 : 1 + rnd(), fitPads: rnd() < 0.5 ? [0, 0] : [rnd() * 90, rnd() * 140] };
    const s = rnd() * 30, tx = (rnd() - 0.5) * 3000, ty = (rnd() - 0.5) * 3000;
    assert.deepEqual(RK.clampView(s, tx, ty, geo), old(s, tx, ty, geo));
  }
  // 沒給新選項：跟以前的 kit 一樣（最小 1、整個框置中）
  assert.deepEqual(RK.clampView(0.3, 0, 0, { W: 400, H: 800, bw: 400, bh: 300 }), { s: 1, tx: 0, ty: 250 });
});
test('zoomAround：以框內一點不動縮放', () => {
  const v = { s: 2, tx: -100, ty: -50 }, p = { x: 150, y: 220 };
  const z = RK.zoomAround(v, 4, p.x, p.y);
  assert.equal(z.s, 4);
  assert.ok(Math.abs((p.x - z.tx) / 4 - (p.x - v.tx) / 2) < 1e-9 && Math.abs((p.y - z.ty) / 4 - (p.y - v.ty) / 2) < 1e-9);   // 這一點在照片上的位置沒動
});
