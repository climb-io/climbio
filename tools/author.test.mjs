// Studio Crag（author/）的邏輯：EXIF → camera、照片歸岩壁、推估牆線、v2 匯出通過 validate、ZIP
import { test } from 'node:test';
import './studio-i18n.mjs';   // Studio 的訊息走語言包，測試載入繁體中文版
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import AppKit from '../appkit/index.mjs';
import { pickWall, estimateWall, lineAspect, distance, local, viewWidth } from '../studio/crag/geo.js';
import * as M from '../studio/crag/model.js';
import { checkAlbumUrl, isAlbumUrl, parseAlbumPage, fileNameFromHeader, fetchAlbum } from '../studio/album.js';
import { classifyImageData, groupPhotos, layoutGroupsMap } from '../studio/classify.js';
import { shownColumns, cellText, cellPatch } from '../studio/crag/table.js';
import { withExif } from '../tests/e2e/exif-jpeg.mjs';
import { placementProblems } from './format-placement.mjs';
const { readExif, toCamera } = AppKit.photo;
globalThis.AppKit = AppKit;   // Studio Crag的 model.js 用瀏覽器的全域 AppKit

const { validate } = createRequire(import.meta.url)('../format/format.js');
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const BASE = [121.9232, 25.1041];
const shot = { model: 'iPhone 15', time: '2026:10:28 10:13:20', offset: '+08:00', focal35: 26, lat: BASE[1], lng: BASE[0], alt: 12, accuracy: 5, heading: 312 };
/** 從 BASE 往東 x、往北 y 公尺 */
const at = (x, y) => local(BASE).from([x, y]);

test('EXIF → camera：位置（經度在前）、高度、誤差、朝向、時間（含時區）、焦距、型號', () => {
  const raw = readExif(withExif(JPEG, shot));
  const cam = toCamera(raw);
  assert.deepEqual(Object.keys(cam).sort(), ['accuracy', 'focal', 'heading', 'model', 'position', 't']);
  assert.ok(Math.abs(cam.position[0] - 121.9232) < 1e-6 && Math.abs(cam.position[1] - 25.1041) < 1e-6);
  assert.equal(cam.position[2], 12);
  assert.equal(cam.accuracy, 5);
  assert.equal(cam.heading, 312);
  assert.equal(cam.t, Date.parse('2026-10-28T10:13:20+08:00'));
  assert.equal(cam.focal, 26);
  assert.equal(cam.model, 'iPhone 15');
});

test('EXIF → camera：磁北加上磁偏角、南半球與西半球是負的、沒有位置就沒有 camera', () => {
  assert.equal(toCamera(readExif(withExif(JPEG, { ...shot, headingRef: 'M', heading: 2 })), { declination: -5 }).heading, 357);
  const sw = toCamera(readExif(withExif(JPEG, { ...shot, lat: -33.5, lng: -70.25 })));
  assert.ok(Math.abs(sw.position[0] + 70.25) < 1e-6 && Math.abs(sw.position[1] + 33.5) < 1e-6);
  assert.equal(toCamera(readExif(JPEG)), undefined);
  assert.deepEqual(readExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), {});
  // 好幾段 EXIF（Safari 重新編碼的 JPEG 會自己多一段）：先讀到的為準
  const twice = toCamera(readExif(withExif(withExif(JPEG, { ...shot, lat: 10, model: 'Other' }), shot)));
  assert.ok(Math.abs(twice.position[1] - 25.1041) < 1e-6);
  assert.equal(twice.model, 'iPhone 15');
  const noHeading = toCamera(readExif(withExif(JPEG, { ...shot, heading: undefined })));
  assert.equal(noHeading.heading, undefined);
});

test('歸岩壁：15 公尺內、朝向 40 度內才算同一面；取最近的', () => {
  const walls = [
    { id: 'a', cameras: [{ position: at(0, 0), heading: 300 }] },
    { id: 'b', cameras: [{ position: at(60, 0), heading: 90 }] },
  ];
  assert.equal(pickWall({ position: at(5, 0), heading: 310 }, walls), 'a');
  assert.equal(pickWall({ position: at(5, 0), heading: 90 }, walls), undefined);   // 位置近、朝向差太多
  assert.equal(pickWall({ position: at(30, 0), heading: 300 }, walls), undefined);  // 太遠
  assert.equal(pickWall({ position: at(55, 0) }, walls), 'b');                      // 沒有朝向只看位置
  assert.equal(pickWall(undefined, walls), undefined);
  assert.ok(Math.abs(distance(at(0, 0), at(3, 4)) - 5) < 0.01);
});

test('推估牆線：沿鏡頭方向推 15 公尺、寬度是視角乘距離，點由左到右（岩壁面朝右手邊），朝向是鏡頭的反方向', () => {
  const est = estimateWall([{ camera: { position: BASE, heading: 0, focal: 26 } }], 15);
  const plane = local(BASE);
  const [a, b] = est.line.map(plane.to);
  const half = viewWidth(15, 26) / 2;
  assert.ok(Math.abs(a[0] + half) < 0.05 && Math.abs(b[0] - half) < 0.05, `寬度 ${b[0] - a[0]}`);
  assert.ok(Math.abs(a[1] - 15) < 0.05 && Math.abs(b[1] - 15) < 0.05);
  assert.equal(est.aspect, 180);
  assert.equal(lineAspect(est.line), 180);
  // 直拍比較窄；兩張並排的照片，牆線蓋住兩張
  const portrait = estimateWall([{ camera: { position: BASE, heading: 0, focal: 26 }, portrait: true }], 15);
  assert.ok(distance(...portrait.line) < distance(...est.line));
  const two = estimateWall([{ camera: { position: BASE, heading: 90 } }, { camera: { position: at(0, -10), heading: 90 } }], 20);
  assert.equal(two.aspect, 270);
  assert.ok(distance(...two.line) > viewWidth(20, 26) + 9);
  assert.equal(estimateWall([{ camera: { position: BASE } }]), undefined);
  // 預設推 5 公尺
  assert.ok(Math.abs(local(BASE).to(estimateWall([{ camera: { position: BASE, heading: 0 } }]).line[0])[1] - 5) < 0.05);
});

test('拍照位置誤差超過 10 公尺就不用：不歸岩壁、不畫牆線，改照拍攝時間歸岩壁', () => {
  assert.equal(pickWall({ position: BASE, heading: 0, accuracy: 196 }, [{ id: 'a', cameras: [{ position: BASE, heading: 0 }] }]), undefined);
  assert.equal(pickWall({ position: BASE, heading: 0 }, [{ id: 'a', cameras: [{ position: BASE, heading: 0, accuracy: 20 }] }]), undefined);
  assert.equal(pickWall({ position: BASE, heading: 0, accuracy: 10 }, [{ id: 'a', cameras: [{ position: BASE, heading: 0, accuracy: 4.7 }] }]), 'a');
  assert.equal(estimateWall([{ camera: { position: BASE, heading: 0, accuracy: 12 } }]), undefined);
  const state = M.newBook('x');
  const good = addShot(state, 0, 0, 300, { time: '2026:10:28 10:13:20' });
  const bad = addShot(state, 300, 0, 300, { time: '2026:10:28 10:13:40', accuracy: 196 });
  assert.notEqual(bad, good);
  assert.equal(M.wallLine(state, bad), undefined);
  const badId = M.photosOf(state, bad)[0].id;
  assert.equal(M.placeByTime(state, [badId]), 1);
  assert.equal(state.photos.get(badId).props.node, good);
  assert.equal(state.photos.get(badId).camera.accuracy, 196);   // 拍照資料照原樣留著
  assert.equal(M.walls(state).length, 1);
  // 附近沒有準的照片：一分鐘內連拍的不準照片歸同一面，隔太久的另外一面
  const lone = ['11:00:10', '11:00:40', '11:03:20'].map(t => addShot(state, 900, 0, 0, { time: `2026:10:28 ${t}`, accuracy: 300 }));
  const ids = lone.map(w => M.photosOf(state, w)[0].id);
  assert.equal(M.placeByTime(state, ids), 1);
  assert.equal(state.photos.get(ids[1]).props.node, state.photos.get(ids[0]).props.node);
  assert.notEqual(state.photos.get(ids[2]).props.node, state.photos.get(ids[0]).props.node);
});

function addShot(state, x, y, heading, extra = {}) {
  const raw = readExif(withExif(JPEG, { ...shot, ...extra, lat: at(x, y)[1], lng: at(x, y)[0], heading }));
  return M.addPhoto(state, M.newPhoto({ name: `p${x}`, w: 2560, h: 1920, sha256: 'a'.repeat(64), raw, attribution: 'KK' }));
}

test('Guidebook：照片自動歸岩壁、移動、拆開、合併、刪除，匯出的組合與畫面都通過 validate', () => {
  const state = M.newBook('測試岩場', 1761620000000);
  M.setAttribution(state, 'KK');
  const w1 = addShot(state, 0, 0, 300), w1b = addShot(state, 5, 0, 310), w2 = addShot(state, 80, 0, 90);
  assert.equal(w1, w1b);
  assert.notEqual(w1, w2);
  assert.equal(M.walls(state).length, 2);
  assert.match(w1, /^[0-9a-z]{16}$/);
  assert.match(state.book.id, /^[0-9a-z]{16}$/);
  assert.equal(M.walls(state)[0].props.aspect, 125);   // 平均朝向 305 的反方向
  assert.equal(state.map.marks.length, 2);

  // 拆開：一張移到新岩壁；再合併回去
  const [p1, p2] = M.photosOf(state, w1).map(v => v.id);
  const w3 = M.movePhotos(state, [p2]);
  assert.equal(M.walls(state).length, 3);
  M.mergeWalls(state, w3, w1);
  assert.equal(M.walls(state).length, 2);
  assert.deepEqual(M.photosOf(state, w1).map(v => v.id), [p1, p2]);
  // 區域圖拖牆線：朝向跟著線、之後改距離也不重算這面
  const line = state.map.marks.find(m => m.node === w2);
  line.geometry = { type: 'LineString', coordinates: [at(100, 10), at(100, -10)] };
  M.setShape(state, line);
  assert.equal(M.walls(state).find(w => w.id === w2).props.aspect, 270);
  M.setSettings(state, { distance: 30 });
  assert.equal(M.walls(state).find(w => w.id === w2).props.aspect, 270);
  assert.deepEqual(M.wallLine(state, w2), [at(100, 10), at(100, -10)]);
  M.renameWall(state, w2, '東壁');
  // 區域圖畫新的：區域、區域裡的岩石（放進那個區域）、步道；刪掉形狀只拿掉標註
  const ring = (x, y, r) => [at(x - r, y - r), at(x + r, y - r), at(x + r, y + r), at(x - r, y + r)];
  const areaId = M.addShape(state, 'area', { type: 'MultiPolygon', coordinates: [[[...ring(300, 0, 50), ring(300, 0, 50)[0]]]] }, '新區');
  const rockId = M.addShape(state, 'rock', { type: 'Polygon', coordinates: [[...ring(300, 0, 5), ring(300, 0, 5)[0]]] }, '大石');
  assert.equal(state.book.nodes.find(n => n.id === rockId).parent, areaId);
  assert.ok(M.walls(state).some(w => w.id === rockId));
  assert.equal(M.addShape(state, 'trail', { type: 'LineString', coordinates: [at(0, 0), at(300, 0)] }), undefined);
  assert.equal(state.map.marks.filter(m => m.props?.kind === 'trail').length, 1);
  M.removeShape(state, state.map.marks.find(m => m.props?.kind === 'trail'));
  assert.equal(state.map.marks.filter(m => m.props?.kind === 'trail').length, 0);
  M.removeShape(state, state.map.marks.find(m => m.node === rockId));
  M.deleteArea(state, areaId);
  assert.equal(state.book.nodes.find(n => n.id === areaId), undefined);
  assert.equal(state.map.marks.find(m => m.node === areaId), undefined);
  assert.equal(state.book.nodes.find(n => n.id === rockId).parent, undefined); // 刪掉區域時保留底下的岩石／岩壁並移回最上層
  M.deleteWall(state, rockId);

  const docs = M.exportDocs(state);
  assert.deepEqual(docs.map(d => d.path), ['index.json', `${state.map.id}.json`, ...[...state.photos.keys()].map(id => `${id}.json`)]);
  for (const { path, doc } of docs) assert.deepEqual(validate(doc), [], path);
  assert.deepEqual(placementProblems(docs), []);   // 放法與連結（format/README.md）：路線在組合、圖層只放 bolt 和線段、不存數得出來的數字
  const [set, map, photo] = docs.map(d => d.doc);
  assert.equal(set.kind, 'set'); assert.equal(set.type, 'guidebook');
  // Studio Crag自己的狀態（author:）不匯出，岩場的設定寫成 props.settings；下載照片前先看的只有合成預覽圖（上半入口照片、下面每張照片的小圖格子），每張照片是第幾格；
  // 岩壁數、路線數不存（從 nodes 數），入口照片也不另存（預覽圖的上半）
  const n = state.photos.size;
  assert.deepEqual(set.props, { preview: { href: 'preview.jpg', w: 720, h: 540 + Math.ceil(n / 6) * 90, count: n, tile: { w: 120, h: 90, cols: 6, y: 540 } }, settings: M.exportSettings(state) });
  assert.deepEqual(Object.keys(set.props.settings).sort(), ['declination', 'distance', 'grade', 'numbering', 'pack']);   // 沒選過欄位（columns）就不寫
  assert.deepEqual(set.items.filter(i => state.photos.has(i.id)).map(i => i.props.tile), [...state.photos.keys()].map((_, i) => i));
  assert.deepEqual(set.nodes.map(n => n.type), ['wall', 'wall']);
  assert.equal(set.nodes[1].name, '東壁');
  assert.equal(map.surface, 'map');
  assert.ok(map.marks.every(m => m.geometry.type === 'LineString' && set.nodes.some(n => n.id === m.node) && !m.props));
  assert.equal(photo.surface, 'photo'); assert.equal(photo.origin, 'self'); assert.equal(photo.attribution, 'KK');
  assert.equal(photo.href, `${photo.id}.jpg`);
  assert.equal(photo.props.node, w1);
  assert.equal(photo.camera.heading, 300);
  // 原本的資料沒被匯出改到
  assert.ok(state.map.marks.find(m => m.node === w2).props['author:manual']);

  // 刪除：空掉的岩壁跟著拿掉
  M.removePhotos(state, M.photosOf(state, w2).map(v => v.id));
  assert.equal(M.walls(state).length, 1);
  assert.equal(state.map.marks.length, 1);
  for (const { path, doc } of M.exportDocs(state)) assert.deepEqual(validate(doc), [], path);
});

test('Guidebook：沒有位置的照片照拍攝時間歸到一分鐘內最接近的有位置照片的岩壁，匯入順序不影響；太遠的留在自己一面', () => {
  const state = M.newBook('x');
  const noGps = (time) => M.newPhoto({ w: 100, h: 100, raw: { time: Date.parse(time) } });   // readExif 讀到的：只有拍攝時間
  const early = noGps('2026-10-28T10:13:00+08:00'), late = noGps('2026-10-28T10:20:00+08:00');
  M.addPhoto(state, early); M.addPhoto(state, late);
  const near = addShot(state, 0, 0, 300, { time: '2026:10:28 10:13:20' });
  addShot(state, 80, 0, 90, { time: '2026:10:28 10:14:30' });
  assert.equal(M.walls(state).length, 4);
  assert.equal(M.placeByTime(state, [early.id, late.id]), 1);
  assert.equal(early.props.node, near);
  assert.notEqual(late.props.node, near);
  assert.equal(M.walls(state).length, 3);   // early 原本那面空了，拿掉
  assert.equal(early.camera, undefined);
  for (const { path, doc } of M.exportDocs(state)) assert.deepEqual(validate(doc), [], path);
  assert.equal(M.exportDocs(state).find(d => d.doc.id === early.id).doc.props.node, near);
});

test('Guidebook：沒有位置的照片自己一面岩壁、沒有牆線；改磁偏角重算磁北照片的朝向', () => {
  const state = M.newBook('x');
  const v = M.newPhoto({ w: 100, h: 100, raw: {} });
  const w = M.addPhoto(state, v);
  assert.equal(v.camera, undefined);
  assert.equal(M.wallLine(state, w), undefined);
  addShot(state, 50, 0, 10, { headingRef: 'M' });
  M.setSettings(state, { declination: -5 });
  const mag = [...state.photos.values()].find(p => p.camera);
  assert.equal(mag.camera.heading, 5);
  assert.equal(M.walls(state).find(x => x.id === mag.props.node).props.aspect, 185);
  for (const { path, doc } of M.exportDocs(state)) assert.deepEqual(validate(doc), [], path);
});

test('Google 相簿分享連結：網址檢查、解析相簿標題與照片（去重、拍攝時間排序、=d 原圖網址、撞名編號）与下載', async () => {
  assert.equal(checkAlbumUrl('  https://photos.app.goo.gl/LiGPpAJnJU4Jf7oD9 '), 'https://photos.app.goo.gl/LiGPpAJnJU4Jf7oD9');
  assert.equal(checkAlbumUrl('看看這本 https://photos.google.com/share/AF1Qip_abc123?key=xyz 謝謝'), 'https://photos.google.com/share/AF1Qip_abc123?key=xyz');
  assert.equal(isAlbumUrl('https://photos.app.goo.gl/LiGPpAJnJU4Jf7oD9'), true);
  assert.equal(isAlbumUrl('https://example.com/photos'), false);
  assert.throws(() => checkAlbumUrl('http://photos.app.goo.gl/LiGPpAJnJU4Jf7oD9'), /Google 相簿/);

  const html = `
    <meta property="og:title" content="龍洞音樂廳 &amp; 校門口 · 10月14日">
    <script>
      AF_initDataCallback({data:[
        ["AF1Qip_late",["https://lh3.googleusercontent.com/pw/AP1Gcz_late",4032,3024],null,null,[[],[]],1791958960000,"tz",28800000],
        ["AF1Qip_early1",["https://lh3.googleusercontent.com/pw/AP1Gcz_early1",3024,4032],null,null,[[],[]],1791958956000,"tz",28800000],
        ["AF1Qip_early1",["https://lh3.googleusercontent.com/pw/AP1Gcz_early1",3024,4032],null,null,[[],[]],1791958956000,"tz",28800000],
        ["AF1Qip_early2",["https://lh3.googleusercontent.com/pw/AP1Gcz_early2",3024,4032],null,null,[[],[]],1791958956000,"tz",28800000]
      ]});
    </script>`;
  const parsed = parseAlbumPage(html);
  assert.equal(parsed.title, '龍洞音樂廳 & 校門口');
  assert.deepEqual(parsed.photos.map(p => [p.id, p.name, p.url]), [
    ['AF1Qip_early1', '20261014_142236.jpg', 'https://lh3.googleusercontent.com/pw/AP1Gcz_early1=d'],
    ['AF1Qip_early2', '20261014_142236_2.jpg', 'https://lh3.googleusercontent.com/pw/AP1Gcz_early2=d'],
    ['AF1Qip_late', '20261014_142240.jpg', 'https://lh3.googleusercontent.com/pw/AP1Gcz_late=d'],
  ]);
  assert.equal(fileNameFromHeader('attachment;filename="IMG_20261014_142236.jpg"'), 'IMG_20261014_142236.jpg');
  assert.equal(fileNameFromHeader("attachment; filename*=UTF-8''%E5%B2%A9%E5%A3%81.HEIC"), '岩壁.HEIC');

  const steps = [];
  const res = await fetchAlbum('https://photos.app.goo.gl/LiGPpAJnJU4Jf7oD9', {
    getText: async () => html,
    getBlob: async (u) => ({
      blob: new Blob([withExif(JPEG, shot)], { type: 'image/jpeg' }),
      name: u.includes('early1') ? 'IMG_0001.jpg' : u.includes('early2') ? 'IMG_0001.jpg' : '',
    }),
    onProgress: (k, n, title) => steps.push([k, n, title]),
  });
  assert.equal(res.title, '龍洞音樂廳 & 校門口');
  assert.deepEqual(res.files.map(f => f.name), ['IMG_0001.jpg', 'IMG_0001_2.jpg', '20261014_142240.jpg']);
  assert.equal(steps.at(-1)[0], 3);
  assert.equal(steps.at(-1)[1], 3);
});

test('匯入照片預先分類與分組：挑出有人物、有繩索、非岩壁；依 GPS 與朝向、連拍時間分組', () => {
  const makeRgba = (w, h, fill) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const [r, g, b] = fill(x, y);
      const p = (y * w + x) * 4;
      d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 255;
    }
    return d;
  };
  // 1. 乾淨岩壁（灰色岩面 & 暖色人工岩牆搭配多顆彩色塑膠岩點）
  const clean = classifyImageData(makeRgba(80, 60, () => [110, 112, 115]), 80, 60);
  assert.equal(clean.status, 'clean');
  assert.equal(clean.clean, true);
  assert.equal(clean.indoor, false);

  const gymWall = classifyImageData(makeRgba(80, 60, (x, y) => {
    if ((x >= 12 && x <= 14 && y >= 10 && y <= 12) || (x >= 28 && x <= 30 && y >= 22 && y <= 24)) return [30, 140, 240];
    if ((x >= 48 && x <= 50 && y >= 15 && y <= 17) || (x >= 62 && x <= 64 && y >= 35 && y <= 37)) return [240, 110, 30];
    if (x >= 20 && x <= 25 && y >= 20 && y <= 25) return [195, 150, 120]; // 暖米色牆面局部色塊（不應誤判為人物）
    return [175, 145, 120];
  }), 80, 60);
  assert.equal(gymWall.status, 'clean');
  assert.equal(gymWall.clean, true);
  assert.equal(gymWall.indoor, true);

  // 2. 有人物（岩壁中間有膚色塊與相鄰的高彩度衣服塊）
  const person = classifyImageData(makeRgba(80, 60, (x, y) => {
    if (x >= 35 && x <= 44 && y >= 18 && y <= 25) return [215, 160, 125]; // 膚色
    if (x >= 33 && x <= 46 && y >= 26 && y <= 40) return [30, 140, 240];  // 鮮藍衣服
    return [110, 112, 115];
  }), 80, 60);
  assert.equal(person.status, 'person');
  assert.equal(person.clean, false);

  // 3. 有繩索（跨越多列的垂直高對比細線，兩側為一致岩壁背景）
  const rope = classifyImageData(makeRgba(80, 60, (x, y) => (x === 40 && y >= 5 && y <= 52 ? [240, 235, 60] : [90, 92, 95])), 80, 60);
  assert.equal(rope.status, 'rope');
  assert.equal(rope.clean, false);

  // 4. 非岩壁（大片藍天與綠樹）
  const notWall = classifyImageData(makeRgba(80, 60, (x, y) => (y < 30 ? [110, 175, 240] : [50, 150, 60])), 80, 60);
  assert.equal(notWall.status, 'not-wall');
  assert.equal(notWall.clean, false);

  // 5. groupPhotos：室內／戶外通用，用 GPS＋朝向與連拍時間分組
  const t0 = Date.parse('2026-10-28T10:00:00+08:00');
  const groups = groupPhotos([
    { file: { name: 'a1.jpg' }, camera: { position: at(0, 0), heading: 300, accuracy: 5 }, time: t0 },
    { file: { name: 'a2.jpg' }, camera: { position: at(4, 0), heading: 308, accuracy: 5 }, time: t0 + 10_000 },
    { file: { name: 'b1.jpg' }, camera: { position: at(70, 0), heading: 90, accuracy: 5 }, time: t0 + 120_000 },
    { file: { name: 'b2_nogps.jpg' }, camera: undefined, time: t0 + 140_000 },
  ], { ws: 'crag' });
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(g => [g.name, g.items.length]), [['岩壁 1', 2], ['岩壁 2', 2]]);
  const layout = layoutGroupsMap(groups);
  assert.equal(layout.walls.length, 2);
  assert.ok(layout.walls[1].center[0] > layout.walls[0].center[0] + 50); // 東邊那面岩壁在西邊那面右側超過 50 公尺
});
