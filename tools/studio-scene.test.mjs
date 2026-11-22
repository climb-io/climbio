// Studio 3D 場景的相機換算（studio/scene/cameras.js）：四元數轉向、視角、視錐、飛到照片的鏡頭、整區鏡頭
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rotate, cameraFromFrame, cameraFromView, cameraFromColmap, camerasFrom, upright, turn, modelCamera, frustum, viewOf, overview, stripOrder } from '../studio/scene/cameras.js';

const near = (a, b, eps = 1e-6) => a.every((x, i) => Math.abs(x - b[i]) < eps);
const frame = (q, extra = {}) => ({ name: 'IMG_1', position: [1, 2, 3], quaternion: q, intrinsics: { width: 720, height: 1280, fx: 943.376, fy: 943.376, cx: 360, cy: 640 }, ...extra });

test('四元數：單位四元數不轉；繞 y 轉 90° 把往前（-z）轉成往左（-x）', () => {
  assert.ok(near(rotate([0, 0, 0, 1], [1, 2, 3]), [1, 2, 3]));
  const s = Math.SQRT1_2;
  assert.ok(near(rotate([0, s, 0, s], [0, 0, -1]), [-1, 0, 0]));
});

test('照片 → 相機：rub 座標的相機往 -z 看，垂直視角照焦距算，比例是寬／高', () => {
  const c = cameraFromFrame(frame([0, 0, 0, 1], { cover: 0.5 }));
  assert.ok(near(c.forward, [0, 0, -1]) && near(c.up, [0, 1, 0]) && near(c.right, [1, 0, 0]));
  assert.ok(Math.abs(c.fov - 2 * Math.atan(640 / 943.376) * 180 / Math.PI) < 1e-9);
  assert.equal(c.aspect, 720 / 1280);
  assert.equal(c.cover, 0.5);
});

test('視錐：四角在前方 depth 公尺的平面上，上下張開的角度就是垂直視角', () => {
  const c = cameraFromFrame(frame([0, 0, 0, 1])), f = frustum(c, 2);
  assert.ok(near(f.apex, [1, 2, 3]));
  for (const p of f.corners) assert.ok(Math.abs(p[2] - (3 - 2)) < 1e-9);
  const [tl, , , bl] = f.corners, half = Math.atan((tl[1] - bl[1]) / 2 / 2) * 2 * 180 / Math.PI;
  assert.ok(Math.abs(half - c.fov) < 1e-9);
  assert.ok(tl[0] < f.corners[1][0]);   // 左上在右上的左邊
});

test('飛到照片：站在拍照的位置、看拍照的方向；整區鏡頭在相機群外面、往它們看', () => {
  const c = cameraFromFrame(frame([0, 0, 0, 1])), v = viewOf(c, 10);
  assert.ok(near(v.position, [1, 2, 3]) && near(v.target, [1, 2, -7]));
  assert.equal(v.fov, c.fov);
  const cams = [c, cameraFromFrame(frame([0, 0, 0, 1], { name: 'IMG_2', position: [11, 2, 3] }))], o = overview(cams);
  assert.ok(o.position[1] > 2 && o.position[2] > 3);   // 在相機上方、背後（相機往 -z 看）
  assert.ok(o.target[2] < 3);
});

test('照片畫面的模型鏡頭（props.model）↔ 相機：來回一樣；不是這個模型的、沒有鏡頭的不算', () => {
  const s = Math.SQRT1_2, c = cameraFromFrame(frame([0, s, 0, s]));   // 往 -x 看
  const view = { id: 'v1', name: 'IMG_1', w: 720, h: 1280, props: { model: modelCamera(c, 'm1') } };
  assert.deepEqual(view.props.model.camera.target, [1 - 10, 2, 3]);
  const back = cameraFromView(view, 'm1');
  assert.ok(near(back.position, c.position) && near(back.forward, c.forward, 1e-4) && near(back.up, [0, 1, 0], 1e-4));
  assert.equal(back.aspect, 720 / 1280);
  assert.ok(Math.abs(back.fov - c.fov) < 0.01);
  assert.equal(cameraFromView(view, 'other'), null);
  assert.equal(cameraFromView({ id: 'v2', props: {} }, 'm1'), null);
});

test('COLMAP 照片（climbio-wall3d-frames/1）→ 相機：位置是 -Rᵀt，往前是 R 的第三列、上方是第二列的反向', () => {
  const s = Math.SQRT1_2, R = [[s, 0, -s], [0, 1, 0], [s, 0, s]], t = [1, 2, 3];   // 繞 y 轉 45°
  const c = cameraFromColmap({ name: 'IMG_9.jpg', R, t, camera: { width: 1600, height: 900, f: 1200, cx: 800, cy: 450 } });
  assert.ok(near(c.position, [-(s * 1 + s * 3), -2, -(-s * 1 + s * 3)]));
  assert.ok(near(c.forward, [s, 0, s]) && near(c.up, [0, -1, 0]) && near(c.right, [s, 0, -s]));
  assert.equal(c.name, 'IMG_9'); assert.equal(c.file, 'IMG_9.jpg');
  assert.ok(Math.abs(c.fov - 2 * Math.atan(450 / 1200) * 180 / Math.PI) < 1e-9 && Math.abs(c.aspect - 16 / 9) < 1e-9);
  assert.equal(camerasFrom({ format: 'climbio-wall3d-frames/1', frames: [{ name: 'a.jpg', R, t, camera: { width: 4, height: 3, f: 2 } }] }).length, 1);
  assert.equal(camerasFrom([frame([0, 0, 0, 1])])[0].name, 'IMG_1');
  assert.throws(() => camerasFrom({ format: 'other' }));
});

test('轉正：模型座標的上方轉到 y，相機的位置與方向一起轉；已經朝上不轉', () => {
  assert.equal(upright([0, 1, 0]), null); assert.equal(upright(null), null);
  const up = [0.066019, 0.911948, -0.40496], q = upright(up), n = Math.hypot(...up);
  assert.ok(near(rotate(q, up.map(v => v / n)), [0, 1, 0]));
  const c = turn({ position: up, forward: [1, 0, 0], up, right: [0, 0, 1] }, q);
  assert.ok(near(c.position, [0, n, 0]) && near(c.up, [0, n, 0]));
  assert.ok(Math.abs(Math.hypot(...c.forward) - 1) < 1e-9);
});

test('命令列 frames：照片位置 → v2 包（模型畫面＋每張照片的 props.model），全部通過格式驗證；缺照片的略過', async () => {
  const { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { spawnSync } = await import('node:child_process');
  const { createRequire } = await import('node:module');
  const { validate } = createRequire(import.meta.url)('../format/format.js');
  const dir = mkdtempSync(join(tmpdir(), 'climbio-frames-'));
  try {
    mkdirSync(join(dir, 'img'));
    writeFileSync(join(dir, 'img', 'IMG_1.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    writeFileSync(join(dir, 'm.spz'), Buffer.from([1, 2, 3]));
    writeFileSync(join(dir, 'frames.json'), JSON.stringify([frame([0, 0, 0, 1]), frame([0, 0, 0, 1], { name: 'IMG_2' })]));
    const r = spawnSync(process.execPath, ['tools/studio.mjs', 'frames', join(dir, 'out'), join(dir, 'frames.json'), '--model', join(dir, 'm.spz'), '--images', join(dir, 'img'), '--name', '測試'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const read = (p) => JSON.parse(readFileSync(join(dir, 'out', p), 'utf8'));
    const book = read('index.json'), docs = book.items.map(i => read(i.href));
    for (const d of [book, ...docs]) assert.deepEqual(validate(d), [], d.id);
    const model = docs.find(d => d.surface === 'model'), photos = docs.filter(d => d.surface === 'photo');
    assert.equal(photos.length, 1);   // IMG_2 沒有照片
    assert.ok(existsSync(join(dir, 'out', model.href)) && existsSync(join(dir, 'out', photos[0].href)));
    const back = cameraFromView(photos[0], model.id);
    assert.ok(near(back.position, [1, 2, 3]) && near(back.forward, [0, 0, -1], 1e-4));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('膠卷順序：相鄰的照片拍的地方接得上；朝同一面牆的從最左邊開始、圍著拍的從空最大的地方開始繞一圈', () => {
  const cam = (name, position, forward) => { const f = Math.hypot(forward[0], forward[2]); const fw = [forward[0] / f, 0, forward[2] / f]; return { name, position, forward: fw, up: [0, 1, 0], right: [-fw[2], 0, fw[0]] }; };
  // 牆在 z = -5，照片往 -z 看；資料檔的順序亂的，左邊斜拍往右看的照片看的點偏右
  const wall = [cam('c', [0, 1, 0], [0, 0, -1]), cam('a', [-4, 1, 0], [0, 0, -1]), cam('d', [3, 1, 0], [0.3, 0, -1]), cam('b', [-3, 1, 0], [0.4, 0, -1])];
  assert.deepEqual(stripOrder(wall).map(c => c.name), ['a', 'b', 'c', 'd']);
  // 圍著中心拍，缺了一段（角度 200°～320° 沒有照片）：從缺口後開始，每一張在上一張的右手邊
  const ring = [0, 40, 80, 120, 160, 340].map((deg, i) => { const r = deg * Math.PI / 180, p = [Math.sin(r) * 5, 1, Math.cos(r) * 5]; return cam(`r${i}`, p, [-p[0], 0, -p[2]]); });
  const order = stripOrder([...ring].reverse());
  for (let i = 1; i < order.length; i++) {
    const a = order[i - 1], b = order[i], step = [b.position[0] - a.position[0], b.position[2] - a.position[2]];
    assert.ok(step[0] * a.right[0] + step[1] * a.right[2] > 0, `${a.name} → ${b.name} 要往右`);
  }
  assert.equal(order.length, 6);
  assert.deepEqual(stripOrder(wall.slice(0, 2)).map(c => c.name), ['c', 'a']);   // 兩張以下照原本的
});

test('照片看的那一點：射線打到最近的三角面；沒打到是 Infinity；照片離拍的東西的估計是相機群到中心的中位距離', async () => {
  const { rayHit, subjectDistance } = await import('../studio/scene/cameras.js');
  // 兩面牆在 z = -2、z = -5（各一個大三角面），相機在原點往 -z 看
  const wall = (z) => [-10, -10, z, 10, -10, z, 0, 10, z];
  const tris = new Float32Array([...wall(-5), ...wall(-2)]);
  assert.ok(Math.abs(rayHit(tris, [0, 0, 0], [0, 0, -1]) - 2) < 1e-6);
  assert.equal(rayHit(tris, [0, 0, 0], [0, 0, 1]), Infinity);
  const c = (x, z) => ({ position: [x, 0, z] });
  assert.equal(subjectDistance([c(-2, 0), c(2, 0), c(0, 3), c(0, -3)]), 3);   // 距離 2、2、3、3，取中間偏上那個
  assert.equal(subjectDistance([c(0, 0), c(0.1, 0)]), 0.5);   // 至少 0.5
});
