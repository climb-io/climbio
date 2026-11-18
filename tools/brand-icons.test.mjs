import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { PNG } = createRequire(import.meta.url)('playwright-core/lib/utilsBundle');
const root = new URL('../', import.meta.url);
const CATS = ['hold-cat', 'redpoint-cat'];
const read = path => PNG.sync.read(readFileSync(new URL(path, root)));
// 圖上符合條件、但顏色不是底色（左上角那一點）或不是完全不透明的像素數
function stray(png, where) {
  const { width: w, height: h, data } = png, bg = data.slice(0, 4);
  let n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (data[i + 3] !== 255) n++;
    else if (where(x + .5, y + .5, w, h) && (data[i] !== bg[0] || data[i + 1] !== bg[1] || data[i + 2] !== bg[2])) n++;
  }
  return n;
}

test('maskable：角色與裝飾都在 W3C 安全區（中心直徑 80% 的圓）內，圓外只有不透明的底色', () => {
  for (const id of CATS) for (const size of [192, 512]) {
    const png = read(`icons/cats/${id}-maskable-${size}.png`);
    assert.equal(png.width, size);
    assert.equal(stray(png, (x, y, w, h) => Math.hypot(x - w / 2, y - h / 2) > w * .4), 0, `${id}-maskable-${size}`);
  }
});

test('Apple touch icon：實心底色（iOS 會把透明補成黑），四邊各 6% 只有底色，不被 22.37% 圓角切到', () => {
  for (const path of [...CATS.map(id => `icons/cats/${id}-180.png`), 'icons/brand/apple-touch-icon-180.png']) {
    const png = read(path);
    assert.deepEqual([png.width, png.height], [180, 180], path);
    assert.equal(stray(png, (x, y, w, h) => Math.min(x, y, w - x, h - y) < w * .06), 0, path);
  }
});

test('各 App 的一般圖示 192／512 是不透明的正方形', () => {
  for (const id of CATS) for (const size of [192, 512]) {
    const png = read(`icons/cats/${id}-${size}.png`);
    assert.deepEqual([png.width, png.height], [size, size]);
    assert.equal(stray(png, () => false), 0, `${id}-${size}`);
  }
});
