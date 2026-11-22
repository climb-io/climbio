import test from 'node:test';
import assert from 'node:assert/strict';
import { RouteKit } from './routekit.mjs';

// 縮放、平移的視角規則（routekit/viewport.js）：跟岩點貓同一套邊界
const { clampView, maxScaleOf, fitOf, ZOOM_STEPS } = RouteKit;
const geo = (W, H, pw, ph, pads = [0, 0]) => { const f = fitOf(W, H, pw, ph); return { W, H, bw: f.bw, bh: f.bh, pads, maxScale: maxScaleOf(pw, f.bw) }; };

test('整張照片放進框（contain）：比例 1；寬的照片上下置中、窄的左右置中', () => {
  const g = geo(400, 600, 3000, 2000);                       // 橫的照片在直的框裡：寬 400、高約 267，上下大片空白
  assert.deepEqual([g.bw, Math.round(g.bh)], [400, 267]);
  const v = clampView(1, -50, 0, g);
  assert.deepEqual([v.s, v.tx, Math.round(v.ty)], [1, 0, 167]);   // 左右剛好填滿所以不能拖、上下置中
});

test('比例最小 1（不能比整張照片小）；最大是 1 個照片像素＝4 個螢幕點（至少 10 倍）', () => {
  const g = geo(400, 600, 3000, 2000);
  assert.equal(clampView(0.3, 0, 0, g).s, 1);
  assert.equal(maxScaleOf(3072, 400), 4 * 3072 / 400);             // 高解析的牆：30.72 倍
  assert.equal(maxScaleOf(800, 400), 10);                          // 小照片：至少 10 倍
  assert.equal(clampView(999, 0, 0, g).s, g.maxScale);
});

test('放大後不讓邊緣露出空白：左上角不能往右下拖過框的邊，右下角不能往左上拖進框', () => {
  const g = geo(400, 600, 3000, 2000), s = 3, w = g.bw * s, h = g.bh * s;   // 1200×800，框 400×600
  assert.deepEqual([clampView(s, 100, 100, g).tx, clampView(s, 100, 100, g).ty], [0, 0]);     // 太靠右下：左邊、上邊都貼框，不露出空白
  const lo = clampView(s, -9999, -9999, g);
  assert.deepEqual([lo.tx, lo.ty], [400 - w, 600 - h]);            // 拖到最右下：右邊、下邊貼住框
});

test('上下有浮動工具列（pads）時可以多拖那兩段：最上、最下的岩點拖得到工具列外面', () => {
  const pads = [60, 90], g = geo(400, 600, 3000, 2000, pads), s = 3, h = g.bh * s;
  const top = clampView(s, 0, 9999, g), bottom = clampView(s, 0, -9999, g);
  assert.equal(top.ty, 60);                                        // 上緣最多到上工具列的下面
  assert.equal(bottom.ty, 600 - 90 - h);                           // 下緣最多到下工具列的上面
  const none = geo(400, 600, 3000, 2000);                          // 沒有工具列就貼框
  assert.equal(clampView(s, 0, 9999, none).ty, 0);
});

test('縮放按鈕的階梯跟岩點貓一樣', () => {
  assert.deepEqual(ZOOM_STEPS, [1, 1.5, 2, 3, 4, 6, 8, 10]);
});
