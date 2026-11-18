import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { RouteKit } from './routekit.mjs';

const source = readFileSync(new URL('../js/draw.js', import.meta.url), 'utf8');
const ctx = vm.createContext({ RouteKit,  state: { w: 1000, h: 1000 }, bbox: poly => ({
  x0: Math.min(...poly.map(p => p[0])), y0: Math.min(...poly.map(p => p[1])),
  x1: Math.max(...poly.map(p => p[0])), y1: Math.max(...poly.map(p => p[1])),
}) });
vm.runInContext(source.slice(0, source.indexOf('  // ---------- 繪製')), ctx);
const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
function outline(x, y, polys) {
  const holds = polys.map(poly => ({ poly })), result = ctx.fallbackHoldOutline(x, y, holds);
  assert.ok(ctx.validAddedOutline(result, x, y, holds), '備援框須包含長按位置、留在照片內且不與任何既有岩點相交');
  return ctx.bbox(result);
}

test('沒有既有岩點與靠近照片四角時仍保留有效的補點範圍', () => {
  for (const [x, y] of [[500, 500], [1, 1], [999, 1], [1, 999], [999, 999], [0, 0], [1000, 0], [0, 1000], [1000, 1000]]) outline(x, y, []);
});

test('參考最近岩點的長寬，不被遠處大量岩點變成固定正方形', () => {
  const b = outline(500, 500, [box(440, 450, 460, 550), ...Array.from({ length: 20 }, (_, i) => box(i * 30, 10, i * 30 + 20, 30))]);
  assert.equal(b.x1 - b.x0, 20);
  assert.equal(b.y1 - b.y0, 100);
});

test('左右、上下及斜角的密集岩點會讓備援框自動退讓', () => {
  const vertical = outline(500, 500, [box(440, 470, 490, 530), box(510, 470, 560, 530)]);
  assert.ok(vertical.x1 - vertical.x0 < vertical.y1 - vertical.y0);
  const horizontal = outline(500, 500, [box(470, 440, 530, 490), box(470, 510, 530, 560)]);
  assert.ok(horizontal.x1 - horizontal.x0 > horizontal.y1 - horizontal.y0);
  outline(500, 500, [box(505, 505, 555, 555), box(445, 445, 495, 495)]);
});

test('長按位置在斜邊或凹形外接框內，也能在真正的輪廓空隙補點', () => {
  outline(500, 510, [[[450, 450], [550, 450], [450, 550]]]);
  outline(500, 500, [[[450, 450], [550, 450], [550, 470], [470, 470], [470, 530], [550, 530], [550, 550], [450, 550]]]);
});

test('不同方向與距離的鄰點不會被備援框框住', () => {
  for (let i = 1; i <= 100; i++) {
    const polys = Array.from({ length: 6 }, (_, j) => {
      const a = j * Math.PI / 3 + i / 10, d = 15 + i % 50;
      const x = 500 + Math.cos(a) * d, y = 500 + Math.sin(a) * d;
      return box(x - 3, y - 4, x + 3, y + 4);
    });
    outline(500, 500, polys);
  }
});

test('用示範牆的實際輪廓比較，原方框重疊的位置改成互不相交的備援框', t => {
  const { wall } = JSON.parse(readFileSync(new URL('../demo/demo.json', import.meta.url), 'utf8'));
  ctx.state.w = wall.w; ctx.state.h = wall.h;
  try {
    const sizes = wall.holds.map(h => { const b = ctx.bbox(h.poly); return Math.max(b.x1 - b.x0, b.y1 - b.y0); }).sort((a, b) => a - b);
    const size = sizes[Math.floor(sizes.length / 2)];
    let cases = 0, oldOverlaps = 0;
    for (let y = 50; y < wall.h; y += 100) for (let x = 50; x < wall.w; x += 100) {
      if (wall.holds.some(h => RouteKit.inPoly(x, y, h.poly) || ctx.edgeDist(x, y, h.poly) === 0)) continue;
      cases++;
      const x0 = Math.max(0, Math.min(wall.w - size, x - size / 2)), y0 = Math.max(0, Math.min(wall.h - size, y - size / 2));
      if (!ctx.validAddedOutline(box(x0, y0, x0 + size, y0 + size), x, y, wall.holds)) oldOverlaps++;
      const poly = ctx.fallbackHoldOutline(x, y, wall.holds);
      assert.ok(ctx.validAddedOutline(poly, x, y, wall.holds), `${x}, ${y} 必須與既有輪廓分開`);
    }
    assert.ok(oldOverlaps > 0);
    t.diagnostic(`示範牆 ${cases} 個空白位置：原方框有 ${oldOverlaps} 處不合格，自適應框全部合格`);
  } finally { ctx.state.w = ctx.state.h = 1000; }
});
