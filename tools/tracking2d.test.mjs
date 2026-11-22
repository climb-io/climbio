import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { TrackingLog2d } from '../lab/wall2d-cam/tracking-log.js';

const require = createRequire(import.meta.url);
const G = require('../lab/wall2d-cam/geometry.js');
const root = new URL('../lab/wall2d-cam/', import.meta.url);

test('2D 相機比對資料不含影像，雜湊、大小與特徵數由 manifest 對照', () => {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
  assert.equal(manifest.schema, 'climbio-2d-tracking/1');
  assert.equal(manifest.containsImages, false);
  assert.ok(manifest.walls.length >= 2);

  for (const entry of manifest.walls) {
    const bytes = readFileSync(new URL(entry.camera.url, root));
    assert.equal(bytes.length, entry.camera.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.camera.sha256);

    const cam = JSON.parse(bytes.toString('utf8'));
    assert.equal(cam.schema, 'climbio-2d-tracking-camera/1');
    assert.equal(cam.wall, entry.wall);
    assert.equal(cam.photoW, entry.photoW);
    assert.equal(cam.photoH, entry.photoH);
    assert.equal(cam.detector, 'AKAZE');
    assert.equal(cam.references.length, entry.referenceViews);
    assert.equal(cam.references.reduce((s, r) => s + r.n, 0), entry.featurePoints);

    const ref = cam.references[0];
    const xyBuf = Buffer.from(ref.xy, 'base64');
    const descBuf = Buffer.from(ref.desc, 'base64');
    assert.equal(xyBuf.byteLength, ref.n * 2 * 4);
    assert.equal(descBuf.byteLength, ref.n * cam.descriptorBytes);
  }
});

test('2D 牆與路線解析支援 v2 marks 與 demo wall.holds 兩種格式', () => {
  const wanhuaWall = JSON.parse(readFileSync(new URL('../demo/wanhua-wall.json', import.meta.url), 'utf8'));
  const wanhuaRoutes = JSON.parse(readFileSync(new URL('../demo/wanhua-routes.json', import.meta.url), 'utf8'));
  const parsedWanhua = G.parseWallData(wanhuaWall, wanhuaRoutes);
  assert.equal(parsedWanhua.w, 3072);
  assert.equal(parsedWanhua.h, 2461);
  assert.ok(parsedWanhua.holds.length >= 250);
  assert.equal(parsedWanhua.routes.length, 1);

  const demoWall = JSON.parse(readFileSync(new URL('../demo/demo.json', import.meta.url), 'utf8'));
  const parsedDemo = G.parseWallData(demoWall);
  assert.equal(parsedDemo.w, 1379);
  assert.equal(parsedDemo.h, 2048);
  assert.ok(parsedDemo.holds.length >= 90);
  assert.ok(parsedDemo.routes.length >= 2);

  const routeMap = G.parseRouteParam('hmvroy36pjxvcj:s,hmvroy39282g35:t,bad:x');
  assert.equal(routeMap.size, 2);
  assert.equal(routeMap.get('hmvroy36pjxvcj'), 's');
  assert.equal(routeMap.get('hmvroy39282g35'), 't');
});

test('單應矩陣幾何驗證阻擋局部群聚、鏡像翻轉與極端扭曲', () => {
  const refW = 1000, refH = 800, qW = 640, qH = 480;
  const H_ok = [0.64, 0, 0, 0, 0.6, 0, 0, 0, 1];
  const inlR = [], inlQ = [];
  for (let gy = 0; gy < 4; gy++) {
    for (let gx = 0; gx < 5; gx++) {
      const rx = 100 + gx * 200;
      const ry = 100 + gy * 200;
      inlR.push(rx, ry);
      inlQ.push(rx * 0.64, ry * 0.6);
    }
  }
  assert.equal(G.verifyHomography(H_ok, refW, refH, qW, qH, inlR, inlQ).ok, true);

  // 鏡像翻轉
  const H_flip = [-0.64, 0, 640, 0, 0.6, 0, 0, 0, 1];
  assert.equal(G.verifyHomography(H_flip, refW, refH, qW, qH, inlR, inlQ).ok, false);

  // 重複圖案局部群聚（全部點擠在左上角 20x20）
  const clusR = [], clusQ = [];
  for (let i = 0; i < 20; i++) {
    clusR.push(10 + (i % 5) * 4, 10 + Math.floor(i / 5) * 4);
    clusQ.push((10 + (i % 5) * 4) * 0.64, (10 + Math.floor(i / 5) * 4) * 0.6);
  }
  const clusRes = G.verifyHomography(H_ok, refW, refH, qW, qH, clusR, clusQ);
  assert.equal(clusRes.ok, false);
  assert.equal(clusRes.reason, 'low_spread');
});

test('2D 追蹤紀錄保留初次定位、掉追蹤、過期隱藏與人工標記，不含影像或裝置識別碼', () => {
  let clock = 0;
  const saved = new Map();
  const storage = { getItem: (k) => saved.get(k), setItem: (k, v) => saved.set(k, v) };
  const log = new TrackingLog2d({
    build: 'test',
    manifest: {},
    device: {},
    storage,
    now: () => clock,
    date: () => new Date(clock).toISOString(),
  });
  log.begin('auto', 'camera');
  clock = 100;
  log.stream({ width: 640, height: 480, deviceId: 'secret-device-id' });
  clock = 250;
  log.ready();
  clock = 400;
  const pose = { wallId: 'wanhua', H: [1, 0, 0, 0, 1, 0, 0, 0, 1], inliers: 85, medianError: 0.4, coverage: 0.55 };
  log.frame({ pose, mode: 'localized', latency: 35, processingMs: 28, cornerDeltaPx: null });
  clock = 600;
  log.tick({ dt: 200, rendered: true, visible: true, videoFrames: 5 });
  clock = 720;
  // 先觸發一次過期隱藏（lastFrame.pose 仍在，但已超過有效期限而停止繪製）
  log.tick({ dt: 120, rendered: false, visible: false, videoFrames: 3 });
  clock = 750;
  log.frame({ pose: null, mode: 'searching', latency: 12, processingMs: 8 });
  log.tick({ dt: 30, rendered: false, visible: false, videoFrames: 1 });
  clock = 1150;
  log.frame({ pose, mode: 'localized', latency: 30, processingMs: 24 });
  log.mark('drift');
  clock = 1500;
  log.end();

  const report = JSON.parse(log.text());
  const s = report.sessions[0];
  assert.equal(s.runtimeReadyAfterStreamMs, 150);
  assert.equal(s.firstPoseAfterStreamMs, 300);
  assert.equal(s.settings.deviceId, undefined);
  assert.equal(s.segments[0].losses, 1);
  assert.equal(s.segments[0].staleHides, 1);
  assert.equal(s.segments[0].reacquisitionMs.p50, 400);
  assert.equal(report.notes.containsImages, false);
  assert.equal(report.notes.containsFramePixels, false);
  assert.ok(!log.text().includes('secret-device-id'));
  assert.ok(report.events.some((e) => e.kind === 'user_mark' && e.mark === 'drift'));
});

test('大型量體標記（>= 8x 中位數）與單應矩陣延遲補償外推', () => {
  const holds = [
    { id: 's1', poly: [[0, 0], [10, 0], [10, 10], [0, 10]] }, // 100
    { id: 's2', poly: [[0, 0], [10, 0], [10, 10], [0, 10]] }, // 100
    { id: 's3', poly: [[0, 0], [10, 0], [10, 10], [0, 10]] }, // 100
    { id: 'v1', poly: [[0, 0], [30, 0], [30, 30], [0, 30]] }, // 900 (>= 8*100)
  ];
  const vols = G.markVolumeHolds(holds);
  assert.equal(vols.has('v1'), true);
  assert.equal(vols.has('s1'), false);

  const Hprev = [1, 0, 10, 0, 1, 20, 0, 0, 1];
  const Hcurr = [1, 0, 18, 0, 1, 24, 0, 0, 1];
  const Hhalf = G.extrapolateHomography(Hprev, Hcurr, 0.5, 640, 480);
  assert.ok(Math.abs(Hhalf[2] - 22) < 1e-6);
  assert.ok(Math.abs(Hhalf[5] - 26) < 1e-6);

  // 劇烈跳動超過安全閾值時應退回 Hcurr，避免發散
  const Hjump = [1, 0, 400, 0, 1, 24, 0, 0, 1];
  assert.deepEqual(G.extrapolateHomography(Hprev, Hjump, 1.0, 640, 480), Hjump);
});
