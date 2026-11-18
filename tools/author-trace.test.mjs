// Studio Crag（author/）的描紅線：照片上的紅筆路線（實線、虛線）抓得到，起點在下面；白底名牌的紅字、小記號、不是紅色的線不算
import { test } from 'node:test';
import './studio-i18n.mjs';   // Studio 的訊息走語言包，測試載入繁體中文版
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { traceRed, traceDiff, tracePen, traceDashes, traceBadges, traceTopo } from '../sourcekit/trace.js';
import { DIGIT_CELLS } from '../sourcekit/badge-digits.js';
import { gray, alignScore, warp } from '../studio/crag/trace.js';
import { drawnRuns, ownRuns } from '../topokit/lines.js';
import * as M from '../studio/crag/model.js';
import AppKit from '../appkit/index.mjs';

globalThis.AppKit = AppKit;   // Studio Crag的 model.js 用瀏覽器的全域 AppKit

const { validate } = createRequire(import.meta.url)('../format/format.js');

/** 灰色的「岩壁」上畫東西：line 是 [[x, y]…]，粗 r 像素；dash 是畫幾像素空幾像素 */
function canvas(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([120, 118, 110, 255], i * 4);
  const dot = (x, y, c) => { if (x >= 0 && y >= 0 && x < w && y < h) data.set([...c, 255], (y * w + x) * 4); };
  return {
    image: { data, width: w, height: h },
    line(pts, c, r = 2, dash = 0) {
      let run = 0;
      for (let i = 1; i < pts.length; i++) {
        const [a, b] = [pts[i - 1], pts[i]], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]));
        for (let s = 0; s <= n; s++, run++) {
          if (dash && Math.floor(run / dash) % 2) continue;
          const x = Math.round(a[0] + ((b[0] - a[0]) * s) / n), y = Math.round(a[1] + ((b[1] - a[1]) * s) / n);
          for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) dot(x + dx, y + dy, c);
        }
      }
    },
    box(x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) dot(x, y, c); },
  };
}
const RED = [220, 40, 30];
const lineLength = (l) => l.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - l[i][0], p[1] - l[i][1]), 0);
const near = (p, q, d) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= d;

test('描紅線：實線與虛線各成一條，起點在下面；名牌裡的紅字、小 X、藍線不算', () => {
  const c = canvas(400, 300);
  c.line([[80, 280], [90, 150], [120, 40]], RED);                       // 實線，由下往上
  c.line([[300, 60], [260, 160], [250, 270]], RED, 2, 6);               // 虛線，畫的方向是由上往下
  c.box(140, 250, 230, 275, [250, 250, 250]); c.line([[150, 262], [220, 262]], RED, 3);   // 白底名牌裡的紅字
  c.line([[350, 40], [358, 48]], RED, 1); c.line([[358, 40], [350, 48]], RED, 1);         // bolt 的小 X
  c.line([[180, 60], [200, 200]], [40, 60, 220]);                       // 藍線
  const lines = traceRed(c.image);
  assert.equal(lines.length, 2, JSON.stringify(lines));
  const [solid, dashed] = lines;
  assert.ok(near(solid.points[0], [80, 280], 8) && near(solid.points.at(-1), [120, 40], 8), JSON.stringify(solid));
  assert.ok(near(dashed.points[0], [250, 270], 10) && near(dashed.points.at(-1), [300, 60], 10), JSON.stringify(dashed));
  assert.ok(solid.points.length <= 6, '簡化過的折線');
});

test('描紅線：兩條路線共用起點（V）或頂端（∧）時拆成兩條，各自從下面開始', () => {
  const c = canvas(500, 400);
  c.line([[60, 60], [120, 330], [200, 60]], RED);        // V：同一個起點往兩邊上去
  c.line([[280, 360], [380, 50], [470, 360]], RED);      // ∧：兩邊上來在頂端會合
  const lines = traceRed(c.image);
  assert.equal(lines.length, 4, JSON.stringify(lines));
  for (const { points } of lines) assert.ok(points[0][1] > points.at(-1)[1], JSON.stringify(points));
  const starts = lines.map(l => l.points[0]);
  assert.equal(starts.filter(p => near(p, [120, 330], 25)).length, 2);   // 細化會把尖角削短一點
});

test('描紅線：共線——下面共起點、上面共終點的三條路線，只在照片上路線比找到的線多時拆開；共用起點的，頂端在左邊的排前面；黃色接線也算', () => {
  const c = canvas(400, 600);
  c.line([[100, 570], [110, 340], [80, 40]], RED);                      // 甲：直上
  c.line([[100, 570], [110, 340], [300, 200], [300, 40]], RED);         // 乙：跟甲共起點，後半段往右上去
  c.line([[220, 570], [240, 380], [300, 200], [300, 40]], RED);         // 丙：自己起攀，跟乙共頂端
  assert.equal(traceRed(c.image).length < 3, true);                     // 沒給路線數：維持「一塊一條」
  const lines = traceRed(c.image, 1, 3);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map(l => [Math.round(l.points[0][0] / 20) * 20, Math.round(l.points.at(-1)[0] / 20) * 20]), [[100, 80], [100, 300], [220, 300]]);
  // 共用的一段是同一組點：topokit 看兩端座標相同的線段就只畫一次（不是每條各畫一遍）
  const pairs = lines.map((l, i) => [i, l.points]);
  const total = pairs.reduce((n, [, l]) => n + lineLength(l), 0);
  const drawn = [...drawnRuns(pairs).values()].flat().reduce((n, r) => n + lineLength(r), 0);
  assert.ok(drawn < total * 0.85, `共用的段要只畫一次：${Math.round(drawn)} / ${Math.round(total)}`);
  assert.ok([...ownRuns(pairs).values()].every(r => r.length >= 1), '每條路線都還有自己獨有的一段');
  assert.equal(traceRed(c.image, 1, 2).length < 3, true);               // 路線只有兩條：不硬拆成三條
  // 黃色的接線：紅線抓不到足夠的路線時，把黃筆也算進去
  const y = canvas(400, 600), YELLOW = [250, 205, 20];
  y.line([[100, 570], [110, 40]], RED);
  y.line([[260, 570], [270, 40]], RED);
  y.line([[110, 360], [265, 200]], YELLOW);                             // 連到另一條的黃線：甲的接線
  assert.equal(traceRed(y.image, 1, 2).length, 2);
  assert.equal(traceRed(y.image, 1, 3).length >= 2, true);
});

test('原圖相減：照片上的路線比找到的線多（共線）時也拆開，共用的一段是同一組點', () => {
  const orig = canvas(400, 600);
  const ann = canvas(400, 600);
  ann.line([[100, 570], [110, 340], [80, 40]], RED);
  ann.line([[100, 570], [110, 340], [300, 200], [300, 40]], RED);
  ann.line([[220, 570], [240, 380], [300, 200], [300, 40]], RED);
  assert.equal(traceDiff(ann.image, orig.image).length < 3, true);
  const lines = traceDiff(ann.image, orig.image, 1, 3);
  assert.equal(lines.length, 3);
  const pairs = lines.map((l, i) => [i, l.points]);
  const total = pairs.reduce((n, [, l]) => n + lineLength(l), 0);
  const drawn = [...drawnRuns(pairs).values()].flat().reduce((n, r) => n + lineLength(r), 0);
  assert.ok(drawn < total * 0.85, `共用的段要只畫一次：${Math.round(drawn)} / ${Math.round(total)}`);
});

test('描紅線：縮小後找的座標乘回原圖；沒有紅線時是空的', () => {
  const c = canvas(200, 150);
  c.line([[40, 140], [60, 20]], RED);
  const [line] = traceRed(c.image, 4);
  assert.ok(near(line.points[0], [160, 560], 16) && near(line.points.at(-1), [240, 80], 16), JSON.stringify(line));
  assert.deepEqual(traceRed(canvas(200, 150).image), []);
});

test('全自動：照片照順序、線由左到右，依序配給這面岩壁還沒畫線的路線；多的線算沒配到；已經畫過的路線不動', () => {
  const state = M.newBook('x');
  const wall = M.addWall(state, '冰山石');
  const [p1, p2, p3] = [0, 1, 2].map(() => {
    const v = M.newPhoto({ w: 1000, h: 800 });
    v.props.node = wall; state.photos.set(v.id, v); state.book.items.push({ href: `${v.id}.json`, id: v.id });
    return v;
  });
  const [a, b, c, d] = M.addRoutes(state, ['長征', '有樹真好', '彈弓', '熱身三'].map(name => ({ name, parent: wall, props: { style: 'boulder' } })));
  // 熱身三已經在第三張畫好了
  const done = M.topoLayer(state, p3.id);
  done.marks.push({ node: d, geometry: { type: 'LineString', coordinates: [[1, 2], [3, 4]] } });
  M.saveLayer(state, done);
  const line = (x, bolts) => ({ points: [[x, 700], [x + 10, 100]], ...(bolts ? { bolts, anchors: [[x - 5, 90], [x + 15, 90]] } : {}) });
  const res = M.autoTopo(state, [[p1.id, [line(100), line(500, [[503, 600], [507, 300]])]], [p2.id, [line(200), line(300)]], [p3.id, [line(50)]]]);
  assert.deepEqual({ drawn: res.drawn, left: res.left }, { drawn: 3, left: 2 });
  const on = (photo) => M.layersOn(state, photo.id)[0].marks.filter(m => m.geometry.type === 'LineString').map(m => [m.node, m.geometry.coordinates[0][0], m.props?.label]);
  assert.deepEqual(on(p1), [[a, 100, '1'], [b, 500, '2']]);
  assert.deepEqual(on(p2), [[c, 200, '3']]);
  assert.deepEqual(on(p3), [[d, 1, undefined]]);
  // bolt：路線底下的 bolt 節點，由下往上 B01、B02，Point 標註
  const l1 = M.layersOn(state, p1.id)[0];
  const bolts = l1.nodes.filter(n => n.type === 'bolt');
  assert.deepEqual(bolts.map(n => [n.parent, n.name]), [[b, 'B01'], [b, 'B02']]);
  assert.deepEqual(bolts.map(n => l1.marks.find(m => m.node === n.id).geometry.coordinates), [[503, 600], [507, 300]]);
  assert.deepEqual(l1.nodes.filter(n => n.type === 'anchor').map(n => [n.parent, n.name, l1.marks.find(m => m.node === n.id).geometry.coordinates]), [[b, 'A01', [495, 90]], [b, 'A02', [515, 90]]]);
  for (const { path, doc } of M.exportDocs(state)) assert.deepEqual(validate(doc), [], path);
  // 再跑一次：都畫過了，什麼都不配
  assert.equal(M.autoTopo(state, [[p1.id, [line(100)]]]).drawn, 0);
});

test('全自動：照片附了拍到的路線就只在這幾條裡配，前面照片的線少了不會把後面擠掉；用過的提示拿掉', () => {
  const state = M.newBook('x');
  const wall = M.addWall(state, '陽光牆');
  const [p1, p2] = [0, 1].map(() => {
    const v = M.newPhoto({ w: 1000, h: 800 });
    v.props.node = wall; state.photos.set(v.id, v); state.book.items.push({ href: `${v.id}.json`, id: v.id });
    return v;
  });
  const [a, b, c, d] = M.addRoutes(state, ['甲', '乙', '丙', '丁'].map(name => ({ name, parent: wall })));
  // 第一張拍到甲乙丙但只找到一條線；第二張拍到丁
  p1.props.routes = [a, b, c]; p2.props.routes = [d];
  const line = (x) => ({ points: [[x, 700], [x + 10, 100]] });
  const res = M.autoTopo(state, [[p1.id, [line(100)]], [p2.id, [line(200)]]]);
  assert.deepEqual({ drawn: res.drawn, left: res.left, stubs: res.stubs }, { drawn: 2, left: 0, stubs: 2 });
  const on = (photo) => M.layersOn(state, photo.id)[0].marks.map(m => m.node);
  // 乙、丙沒描出線：這張照片拍到它們，補短線段記號（紅點貓才有東西可以點）
  assert.deepEqual(on(p1), [a, b, c]);
  assert.deepEqual(on(p2), [d]);
  assert.ok(!p1.props.routes && !p2.props.routes);
  assert.deepEqual(res.photos.sort(), [p1.id, p2.id].sort());
});

test('全自動：沒描出線的路線補短線段記號（標 author:stub、有編號牌、位置平均排開）；只補確定拍在這張照片上的', () => {
  const state = M.newBook('x');
  // 這面岩壁只有一張照片：整面的路線都補
  const wall = M.addWall(state, '單張牆');
  const v = M.newPhoto({ w: 1000, h: 800 });
  v.props.node = wall; state.photos.set(v.id, v); state.book.items.push({ href: `${v.id}.json`, id: v.id });
  const [a, b] = M.addRoutes(state, ['甲', '乙'].map(name => ({ name, parent: wall })));
  // 這面岩壁有兩張照片、沒有提示：不知道路線在哪張，不補
  const wall2 = M.addWall(state, '兩張牆');
  for (let i = 0; i < 2; i++) { const x = M.newPhoto({ w: 1000, h: 800 }); x.props.node = wall2; state.photos.set(x.id, x); state.book.items.push({ href: `${x.id}.json`, id: x.id }); }
  M.addRoutes(state, [{ name: '丙', parent: wall2 }]);
  const res = M.autoTopo(state, []);
  assert.equal(res.stubs, 2);
  const marks = M.layersOn(state, v.id)[0].marks.filter(m => m.geometry.type === 'LineString');
  assert.deepEqual(marks.map(m => [m.node, m.props?.[M.STUB], m.props?.label, m.geometry.coordinates.length]), [[a, true, '1', 2], [b, true, '2', 2]]);
  assert.deepEqual(marks.map(m => m.geometry.coordinates[0][0]), [333, 667]);
  assert.equal([...state.photos.values()].filter(x => x.props.node === wall2).every(x => !M.layersOn(state, x.id).length), true);
  for (const { path, doc } of M.exportDocs(state)) assert.deepEqual(validate(doc), [], path);
  // 再跑一次：都有標註了，不重複補
  assert.equal(M.autoTopo(state, []).stubs, 0);
});

test('原圖相減：路線書的圖減掉原圖，抓到線（含原圖本來就有的紅色地方）、一串 bolt 和頂端並排的確保站、只標確保站的路線；名牌的字不算；對齊後的相關係數分得出同一次快門（裁切、縮小過的也是），原圖照單應性對齊', () => {
  // 原圖：有紋路的岩壁，右下有一塊紅色的東西（抱石墊）
  const w = 400, h = 300, orig = { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = Math.round(70 + x / 5 + 25 * Math.sin(y / 20));
    orig.data.set(x > 320 && y > 240 ? [210, 40, 40, 255] : [v, v - 4, v - 10, 255], (y * w + x) * 4);
  }
  const ann = { data: orig.data.slice(), width: w, height: h };
  const dot = (x, y, c) => { if (x >= 0 && y >= 0 && x < w && y < h) ann.data.set([...c, 255], (y * w + x) * 4); };
  const stroke = (pts, c, r) => { for (let i = 1; i < pts.length; i++) { const [a, b] = [pts[i - 1], pts[i]], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])); for (let s = 0; s <= n; s++) { const x = Math.round(a[0] + ((b[0] - a[0]) * s) / n), y = Math.round(a[1] + ((b[1] - a[1]) * s) / n); for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) dot(x + dx, y + dy, c); } } };
  stroke([[80, 280], [100, 40]], [235, 45, 35], 2);                                   // 抱石路線
  const x = (cx, cy) => { stroke([[cx - 3, cy - 3], [cx + 3, cy + 3]], RED, 0); stroke([[cx + 3, cy - 3], [cx - 3, cy + 3]], RED, 0); };
  for (const y of [250, 190, 130, 70]) x(250, y);   // 一串 bolt
  x(243, 30); x(257, 30);                            // 頂端並排的確保站
  x(340, 60); x(353, 60);                            // 只標了確保站的傳統攀路線
  const marked = gray(ann, 1);   // 畫了線和 bolt 的還是同一次快門
  for (let y = 270; y <= 290; y++) for (let x = 120; x <= 220; x++) dot(x, y, [235, 235, 235]);   // 名牌
  for (const x of [130, 145, 160, 175, 190, 205]) stroke([[x, 276], [x + 6, 284]], RED, 1);
  const lines = traceDiff(ann, orig);
  assert.equal(lines.length, 3, JSON.stringify(lines));
  const [boulder, sport, trad] = lines;
  assert.ok(near(boulder.points[0], [80, 280], 10) && !boulder.bolts, JSON.stringify(boulder));
  const r10 = (pts) => pts.map(([x, y]) => [Math.round(x / 10), Math.round(y / 10)]);
  assert.deepEqual(r10(sport.bolts), [[25, 25], [25, 19], [25, 13], [25, 7]]);
  assert.deepEqual(r10(sport.anchors), [[24, 3], [26, 3]]);
  assert.deepEqual(trad.points, []);
  assert.deepEqual(r10(trad.anchors), [[34, 6], [35, 6]]);
  assert.equal(trad.bolts, undefined);
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  assert.ok(alignScore(marked, gray(orig, 1), I) > 0.9);
  const other = { data: orig.data.slice().reverse(), width: w, height: h };
  assert.ok(alignScore(gray(other, 1), gray(orig, 1), I) < 0.5);
  assert.equal(alignScore(marked, gray(orig, 1), [1, 0, 300, 0, 1, 0, 0, 0, 1]), -1);   // 重疊不到一半
  // 路線書的圖是原圖裁出 (100, 50) 起 200×200、縮成一半：H 把它的座標換成原圖的
  const crop = warp(orig, [2, 0, 100, 0, 2, 50, 0, 0, 1], 100, 100, 1, 1);
  assert.deepEqual([...crop.data.slice((10 * 100 + 10) * 4, (10 * 100 + 10) * 4 + 3)], [...orig.data.slice(((50 + 21) * w + 100 + 21) * 4, ((50 + 21) * w + 100 + 21) * 4 + 3)]);
  assert.ok(alignScore(gray(crop, 1), gray(orig, 1), [2, 0, 100, 0, 2, 50, 0, 0, 1]) > 0.9);
  assert.ok(alignScore(gray(crop, 1), gray(orig, 1), [2, 0, 140, 0, 2, 20, 0, 0, 1]) < 0.7);   // 對錯位置
});

test('區域圖（配置圖）掛在區或岩場上：不描線、不補記號，匯出照樣合格', () => {
  const state = M.newBook('x');
  const wall = M.addWall(state, '岩壁');
  M.addRoutes(state, [{ name: '甲', parent: wall }]);
  const crag = { id: 'crag000000000001', type: 'crag', name: '岩場' };
  state.book.nodes.push(crag);
  const v = M.newPhoto({ w: 1000, h: 800 });
  M.addPhoto(state, v, crag.id);
  assert.equal(M.isOverview(state, v), true);
  const res = M.autoTopo(state, [[v.id, [{ points: [[100, 700], [110, 100]] }]]]);
  assert.deepEqual({ drawn: res.drawn, stubs: res.stubs }, { drawn: 0, stubs: 0 });
  assert.equal(M.layersOn(state, v.id).length, 0);
  for (const { path, doc } of M.exportDocs(state)) assert.deepEqual(validate(doc), [], path);
});

test('描線：不是紅筆也找得到（藍、綠、橘…）；每條路線一種顏色也各找各的；一大塊的藍天、綠葉不當成筆', () => {
  const BLUE = [30, 90, 230], GREEN = [20, 190, 60], ORANGE = [255, 140, 0];
  // 全部藍筆：沒有紅色，照樣當成路線
  const a = canvas(400, 300);
  a.line([[80, 280], [90, 150], [120, 40]], BLUE);
  a.line([[300, 60], [260, 160], [250, 270]], BLUE, 2, 6);
  const blue = traceRed(a.image);
  assert.equal(blue.length, 2, JSON.stringify(blue));
  assert.ok(near(blue[0].points[0], [80, 280], 8) && near(blue[1].points.at(-1), [300, 60], 10));
  // 三種顏色各一條，即使互相交叉
  const b = canvas(500, 400);
  b.line([[60, 380], [100, 200], [120, 40]], BLUE);
  b.line([[200, 380], [200, 200], [170, 40]], GREEN);
  b.line([[330, 380], [300, 200], [100, 60]], ORANGE);
  const colors = traceRed(b.image, 1, 3);
  assert.equal(colors.length, 3, JSON.stringify(colors));
  // 一大塊藍天、綠色的樹叢不是筆
  const c = canvas(400, 300);
  c.box(0, 0, 399, 120, [70, 130, 230]); c.box(250, 150, 380, 290, [40, 170, 70]);
  assert.equal(traceRed(c.image).length, 0);
  // 紅筆已經夠數，旁邊的藍線不加進來
  const d = canvas(400, 300);
  d.line([[80, 280], [90, 150], [120, 40]], RED); d.line([[300, 280], [290, 150], [260, 40]], RED);
  d.line([[180, 60], [200, 270]], BLUE);
  assert.equal(traceRed(d.image, 1, 2).length, 2);
});

test('原圖相減：筆是藍色也抓得到', () => {
  const orig = canvas(400, 300), ann = canvas(400, 300);
  ann.line([[80, 280], [90, 150], [120, 40]], [30, 90, 230]);
  const lines = traceDiff(ann.image, orig.image, 1, 1);
  assert.equal(lines.length, 1, JSON.stringify(lines));
  assert.ok(near(lines[0].points[0], [80, 280], 10));
});

test('描任何顏色的筆：黃、洋紅、青的線都描得到，起點在下面；灰岩壁上的彎曲雜色邊緣、短碎片不算', () => {
  for (const color of [[240, 210, 20], [235, 20, 230], [20, 200, 200]]) {
    const c = canvas(400, 300);
    c.line([[80, 280], [90, 150], [120, 40]], color, 2);
    c.line([[300, 60], [260, 160], [250, 270]], color, 2, 6);   // 虛線
    c.line([[180, 100], [200, 110]], [200, 40, 40], 2);         // 短碎片
    const lines = tracePen(c.image);
    assert.equal(lines.length, 2, `${color} ${JSON.stringify(lines)}`);
    assert.ok(near(lines[0].points[0], [80, 280], 10) && near(lines[0].points.at(-1), [120, 40], 10), JSON.stringify(lines[0]));
    assert.ok(near(lines[1].points[0], [250, 270], 12) && near(lines[1].points.at(-1), [300, 60], 12), JSON.stringify(lines[1]));
  }
});

test('描任何顏色的筆：expected 給了，雜訊多出來的線被丟掉，留最長的', () => {
  const c = canvas(400, 300);
  c.line([[80, 280], [90, 40]], [240, 210, 20], 2);
  c.line([[300, 280], [310, 60]], [240, 210, 20], 2);
  c.line([[200, 270], [205, 190]], [235, 20, 230], 2);   // 較短的另一色
  assert.equal(tracePen(c.image, 1, 2).length, 2);
});

test('白色虛線：一段段的短亮線串成一條，起點在下面；零散的亮點、短的一截不算；tracePen 也用它', () => {
  const c = canvas(1000, 800);
  c.line([[160, 760], [200, 440], [280, 120]], [250, 250, 250], 3, 28);   // 白虛線，由下往上
  c.line([[600, 120], [660, 400], [640, 720]], [250, 250, 250], 3, 28);   // 另一條，畫的方向由上往下
  for (const [x, y] of [[400, 200], [460, 260], [380, 600], [520, 660]]) c.box(x, y, x + 10, y + 8, [250, 250, 250]);   // 零散的亮點
  c.line([[800, 200], [820, 260]], [250, 250, 250], 3, 28);   // 太短的一截
  const lines = traceDashes(c.image);
  assert.equal(lines.length, 2, JSON.stringify(lines));
  assert.ok(near(lines[0].points[0], [160, 760], 30) && near(lines[0].points.at(-1), [280, 120], 30), JSON.stringify(lines[0]));
  assert.ok(near(lines[1].points[0], [640, 720], 30) && near(lines[1].points.at(-1), [600, 120], 30), JSON.stringify(lines[1]));
  assert.equal(tracePen(c.image).length, 2);
  assert.equal(traceDashes(canvas(600, 400).image).length, 0);   // 什麼都沒畫
});

test('號碼牌：純色圓角方塊加白色號碼才算，由左到右；沒有字的純色塊、太大的色塊、岩壁的雜色不算；線找不到的號碼牌 line 是 null', () => {
  const c = canvas(1000, 800);
  const badge = (x, y, col) => { c.box(x, y, x + 30, y + 30, col); c.box(x + 11, y + 6, x + 14, y + 24, [255, 255, 255]); c.box(x + 15, y + 6, x + 18, y + 9, [255, 255, 255]); };   // 方塊加「1」
  badge(160, 740, [240, 130, 30]);    // 這條有線
  badge(600, 740, [30, 160, 110]);    // 這條沒有線
  c.box(400, 100, 430, 130, [30, 160, 110]);   // 純色但沒有字
  c.box(700, 300, 900, 500, [30, 160, 110]);   // 太大的色塊
  const badges = traceBadges(c.image);
  assert.equal(badges.length, 2, JSON.stringify(badges));
  assert.ok(near(badges[0].point, [175, 755], 4) && near(badges[1].point, [615, 755], 4), JSON.stringify(badges));
  const d = canvas(1000, 800);   // 沒有大色塊的另一張：第一個號碼牌上方有一條白虛線
  d.box(160, 740, 190, 770, [240, 130, 30]); d.box(171, 746, 174, 764, [255, 255, 255]); d.box(175, 746, 178, 749, [255, 255, 255]);
  d.box(600, 740, 630, 770, [30, 160, 110]); d.box(611, 746, 614, 764, [255, 255, 255]); d.box(615, 746, 618, 749, [255, 255, 255]);
  d.line([[175, 735], [200, 440], [280, 120]], [250, 250, 250], 3, 28);
  const topo = traceTopo(d.image);
  assert.equal(topo.lines.length, 1, JSON.stringify(topo.lines));
  assert.deepEqual(topo.badges.map(b => b.line), [0, null]);
});

test('路線號碼（Studio）：全自動找不到線、只找到號碼牌時標出號碼位置；畫過／標過的路線都算畫好；號碼照路線現在的編號；輸出通過 validate', () => {
  const state = M.newBook('x');
  const wall = M.addWall(state, '冰山石');
  const v = M.newPhoto({ w: 1000, h: 800 });
  v.props.node = wall; state.photos.set(v.id, v); state.book.items.push({ href: `${v.id}.json`, id: v.id });
  const [a, b, c] = M.addRoutes(state, ['甲', '乙', '丙'].map(name => ({ name, parent: wall })));
  // 一條線、兩個只有號碼牌的（由左到右）
  const res = M.autoTopo(state, [[v.id, [{ points: [[100, 700], [110, 200]] }, { points: [], at: [300.4, 690.2], size: 26, color: '#f08020' }, { points: [], at: [500, 690] }]]]);
  assert.equal(res.drawn, 3);
  const layer = M.layersOn(state, v.id)[0];
  assert.deepEqual(layer.marks.map(m => [m.node, m.geometry.type]), [[a, 'LineString'], [b, 'Point'], [c, 'Point']]);
  assert.deepEqual(layer.marks[1].geometry.coordinates, [300, 690]);
  assert.deepEqual(layer.marks[1].props, { size: 26, style: { stroke: '#f08020' }, label: '2' });   // 號碼照路線現在的編號
  assert.equal(layer.marks[2].props.label, '3');
  assert.deepEqual([...M.drawn(state).keys()].sort(), [a, b, c].sort());
  assert.equal(M.routeMarkCount(state, v.id), 3);
  // bolt 的 Point 不算路線號碼
  const bolt = { id: 'bolt-b01', type: 'bolt', parent: a, name: 'B01' };
  layer.nodes.push(bolt); layer.marks.push({ node: bolt.id, geometry: { type: 'Point', coordinates: [100, 600] } });
  assert.equal(M.routeMarkCount(state, v.id), 3);
  const docs = M.exportDocs(state);
  for (const { doc } of docs) assert.deepEqual(validate(doc), [], doc.id);
});

/** 把數字（樣板的格子放大）畫成號碼牌：純色圓角方塊上白色的字 */
function badgeWith(c, x, y, text, color = [240, 130, 30]) {
  const S = 60, W = 14, H = 22, gap = 6;   // 牌子 60 像素；每個字 14×22 格子，每格 1 像素
  c.box(x, y, x + S, y + S, color);
  const glyphs = [...text].map(d => { const cells = DIGIT_CELLS[d].cells; return { w: Math.max(6, Math.round(H * DIGIT_CELLS[d].aspect)), cells }; });
  let ox = x + Math.round((S - glyphs.reduce((n, g) => n + g.w + gap, -gap)) / 2);
  for (const g of glyphs) {
    for (let gy = 0; gy < 24; gy++) for (let gx = 0; gx < 16; gx++) if (parseInt(g.cells[gy * 16 + gx], 16) >= 8) c.box(ox + Math.floor((gx * g.w) / 16), y + 14 + Math.floor((gy * 32) / 24), ox + Math.floor(((gx + 1) * g.w) / 16) - 1, y + 14 + Math.floor(((gy + 1) * 32) / 24) - 1, [255, 255, 255]);
    ox += g.w + gap;
  }
}

test('號碼牌上的號碼：樣板畫成牌子讀得回來（單字、兩位數）；Studio 的全自動把讀到號碼的牌子配給編號一樣的路線', () => {
  const c = canvas(1400, 600);
  const texts = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '12'];
  texts.forEach((t, i) => badgeWith(c, 40 + i * 110, 200, t));
  const badges = traceBadges(c.image);
  assert.deepEqual(badges.map(b => b.text), texts);
  assert.ok(badges.every(b => b.color === '#f08220' || /^#f0[0-9a-f]{4}$/.test(b.color)));
  // 全自動：牌子由左到右是 3、1、2（照片上的順序），路線清單是 1、2、3 → 照號碼配，不是照順序
  const state = M.newBook('x');
  const wall = M.addWall(state, '牆');
  const v = M.newPhoto({ w: 1000, h: 800 });
  v.props.node = wall; state.photos.set(v.id, v); state.book.items.push({ href: `${v.id}.json`, id: v.id });
  const [a, b, d] = M.addRoutes(state, ['甲', '乙', '丙'].map(name => ({ name, parent: wall })));
  M.autoTopo(state, [[v.id, [{ points: [], at: [100, 700], text: '3' }, { points: [], at: [300, 700], text: '1' }, { points: [], at: [500, 700], text: '2' }]]]);
  const marks = M.layersOn(state, v.id)[0].marks;
  assert.deepEqual(marks.map(m => [m.node, m.geometry.coordinates[0]]).sort((x, y) => x[1] - y[1]), [[d, 100], [a, 300], [b, 500]]);
});
