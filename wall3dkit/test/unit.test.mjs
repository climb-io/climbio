// Wall3DKit 的單元測試：只測不需要 DOM、WebGL 的部分（外框幾何、沿牆鏡頭的成品包、three.js 打包的匯出）。烘焙見 bake.test.mjs，繪製、鏡頭靠瀏覽器測試。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hull, simplify, inside, unpackWalk, tableFor, decode, u16 } from '../index.js';
import * as THREE from '../vendor/three.js';
import { NAMES } from '../build-vendor.mjs';

test('hull：凸包去掉裡面的點，inside 判斷點在多邊形裡', () => {
  const h = hull([[0, 0], [4, 0], [4, 4], [0, 4], [2, 2], [1, 3]]);
  assert.equal(h.length, 4);
  assert.ok(inside(2, 2, h));
  assert.ok(!inside(5, 2, h));
});

test('simplify：多邊形精簡到最多 max 點，還是包住原來的範圍', () => {
  const circle = Array.from({ length: 64 }, (_, i) => [Math.cos(i / 64 * 2 * Math.PI) * 10, Math.sin(i / 64 * 2 * Math.PI) * 10]);
  const s = simplify(circle, 12);
  assert.ok(s.length <= 12 && s.length >= 3);
  assert.ok(inside(0, 0, s));
});

test('unpackWalk、tableFor：讀回沿牆鏡頭的資料，挑畫面比例最接近的邊界表', () => {
  const d = { right: [1, 0, 0], f: [0, 0, 1], up: [0, 1, 0], flip: 1, X: [0, 0.05, 0.1], Y: [0, 0, 0], bin: 0.1, smin: 0, smax: 0.1,
    tables: [{ aspect: 0.46 }, { aspect: 0.56 }, { aspect: 0.62 }] };
  const p = unpackWalk(d);
  assert.equal(p.n, 3);
  assert.equal(p.up.y, 1);
  assert.equal(p.baked, d);
  assert.equal(tableFor(d, 0.5).aspect, 0.46);
  assert.equal(tableFor(d, 0.6).aspect, 0.62);
});

test('decode、u16：base64 解成位元組，再看成 uint16', () => {
  const b = decode(btoa(String.fromCharCode(1, 0, 2, 1)));
  assert.deepEqual([...u16(b)], [1, 258]);
});

test('vendor/three.js 匯出的就是 build-vendor.mjs 的 NAMES，Kit 用到的都在裡面', () => {
  assert.deepEqual(Object.keys(THREE).sort(), [...NAMES].sort());
  for (const f of ['stage.js', 'walkcam.js', 'bakepack.js']) {
    const m = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').match(/import \{([^}]+)\} from '\.\/vendor\/three\.js'/);
    for (const n of m[1].split(',').map((s) => s.trim()).filter(Boolean)) assert.ok(NAMES.includes(n), `${f} 用到的 ${n}`);
  }
});
