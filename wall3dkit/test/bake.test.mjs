// 3D 牆烘焙（wall3dkit/bake.js）：裁切平面切三角形、glb 寫出再讀回
import test from 'node:test';
import assert from 'node:assert/strict';
import { clipPolygon, bakeMesh, writeGlb, parseGlb, sourceTexture } from '../bake.js';

const v = (x, y, z, u = 0, w = 0) => ({ p: [x, y, z], uv: [u, w], f: 0 });
const area = (poly) => { let s = 0; for (let i = 1; i < poly.length - 1; i++) { const a = poly[0].p, b = poly[i].p, c = poly[i + 1].p; s += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2; } return s; };
const tri = [v(0, 0, 0), v(2, 0, 0, 1, 0), v(0, 2, 0, 0, 1)];

test('裁切：整個在外面原樣留下，整個在裡面全丟，跨過的切成兩半', () => {
  const left = { n: [1, 0, 0], d: -1 };   // 切掉 x < -1：三角形不受影響
  assert.deepEqual(clipPolygon(tri, [left]), [tri]);
  const all = { n: [1, 0, 0], d: 5 };     // 切掉 x < 5：全丟
  assert.deepEqual(clipPolygon(tri, [all]), []);
  const half = { n: [1, 0, 0], d: 1 };    // 切掉 x < 1：留下 x ≥ 1 的角
  const out = clipPolygon(tri, [half]);
  assert.equal(out.length, 1);
  assert.ok(Math.abs(area(out[0]) - 0.5) < 1e-9);
  assert.ok(out[0].every(q => q.p[0] >= 1 - 1e-9));
  const mid = out[0].find(q => Math.abs(q.p[0] - 1) < 1e-9 && Math.abs(q.p[1]) < 1e-9);
  assert.ok(Math.abs(mid.uv[0] - 0.5) < 1e-9);   // 貼圖座標照比例
});

test('裁切：有 bounds 的平面只切範圍內', () => {
  // 切掉 x < 1，但只在 y ≥ 1 的範圍內
  const q = { n: [1, 0, 0], d: 1, bounds: [[[0, 1, 0], 1]] };
  const out = clipPolygon(tri, [q]);
  const kept = out.reduce((s, p) => s + area(p), 0);
  // 三角形 (0,0)(2,0)(0,2) 面積 2；y≥1 且 x<1 的部分是 (0,1)(1,1)(0,2) 面積 0.5
  assert.ok(Math.abs(kept - 1.5) < 1e-9);
});

test('裁切：岩點的面讓出間距，Studio 的切線（cut）照切', () => {
  const faceLabels = Uint16Array.of(1);
  const base = { positions: Float32Array.of(0, 0, 0, 2, 0, 0, 0, 2, 0), uvs: new Float32Array(6), index: Uint32Array.of(0, 1, 2), faceLabels };
  const auto = bakeMesh({ ...base, planes: [{ n: [1, 0, 0], d: 0.5 }], margin: 1 });   // 自動切面、岩點的面讓 1：d 變 -0.5，不切
  assert.equal(auto.index.length, 3);
  const cut = bakeMesh({ ...base, planes: [{ n: [1, 0, 0], d: 0.5, kind: 'cut' }], margin: 1 });
  assert.ok(cut.index.length >= 3 && cut.positions.length > 9 || cut.clipped === 1);
  const hidden = bakeMesh({ ...base, index: Uint32Array.of(0, 0, 0), planes: [] });
  assert.equal(hidden.index.length, 0);
});

test('glb：寫出再讀回，標準結構', () => {
  const image = new Uint8Array([1, 2, 3, 4, 5]);
  const glb = writeGlb({ positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0), uvs: Float32Array.of(0, 0, 1, 0, 0, 1), fade: Float32Array.of(0, 0.5, 1), index: Uint32Array.of(0, 1, 2), image, extras: { x: 1 } });
  const { json } = parseGlb(glb);
  assert.equal(json.asset.version, '2.0');
  assert.deepEqual(json.extensionsUsed, ['KHR_materials_unlit']);
  assert.equal(json.scenes[0].extras.x, 1);
  assert.deepEqual(json.meshes[0].primitives[0].attributes, { POSITION: 0, TEXCOORD_0: 1, _WALL_FADE: 2 });
  const src = sourceTexture(glb);
  assert.deepEqual([...src.image], [1, 2, 3, 4, 5]);
});
