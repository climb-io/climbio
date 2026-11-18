// TopoKit 的單元測試（不需要瀏覽器）：v2 資料進出、共用線段與編輯規則、縮放。
// 瀏覽器案例（demo、編輯、清理）在內部 e2e。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { addLinePoint, assertView, clampView, doubleTapView, fitSize, drawnRuns, forkLine, IDENTITY, isDoubleTap, moveSharedPoint, moveView, newId, ownRuns, pickGrade, pickName, readTopo, removeLinePoint, renderLines, renderReveal, routeCrop, swipeStep, swipeDown, segmentAt, writeLayer } from '../index.js';

const require = createRequire(import.meta.url);
const { validate } = require('../../format/format.js');
const example = (f) => JSON.parse(fs.readFileSync(new URL(`../../format/examples/${f}`, import.meta.url), 'utf8'));

// ── v2 資料 ──
test('讀範例：騙人的牆（畫面＋路線圖層＋組合裡的名稱）', () => {
  const view = example('topo.json'), layer = example('topo-routes.json'), set = example('set.json');
  const m = readTopo({ view, layers: [layer], nodes: set.nodes }, { lang: 'zh-Hant' });
  assert.deepEqual(m.photo, { href: view.href, w: view.w, h: view.h });
  assert.deepEqual(m.crop, view.props.crop);
  assert.equal(m.routes.length, 5);
  const z = m.routes.find((r) => r.id === 'tdebo72up4xx11pe');
  assert.equal(z.name, 'Z字');
  assert.equal(z.grade, '5.11a');
  assert.equal(z.kind, 'sport');
  assert.deepEqual(Object.keys(z.bolts).sort(), ['A01', 'A02', 'B01', 'B02', 'B03', 'B04']);
  assert.equal(z.bolts.A01.anchor, true);
  assert.equal(m.routes.find((r) => r.id === 'u0uuqfwa64owtim3').kind, 'other');
  assert.equal(readTopo({ view, layers: [layer], nodes: set.nodes }, { lang: 'en' }).routes.find((r) => r.id === z.id).name, 'Stone Z');
});

test('只收 v2 的照片畫面；圖層要疊在這個畫面上', () => {
  assert.throws(() => assertView({ climbio: 1, kind: 'view', surface: 'photo' }), /v2/);
  assert.throws(() => assertView({ climbio: 2, kind: 'view', surface: 'map', id: 'x' }), /v2/);
  assert.throws(() => assertView({ climbio: 2, kind: 'view', surface: 'photo', id: 'x', href: 'a.jpg', w: 0, h: 5 }), /href/);
  const view = example('topo.json');
  assert.throws(() => readTopo({ view, layers: [{ ...example('topo-routes.json'), on: 'other' }] }), /不是疊在/);
});

test('名稱與難度：語言、系統的選法', () => {
  assert.equal(pickName({ 'zh-Hant': '代溝', en: 'Groove' }, 'en'), 'Groove');
  assert.equal(pickName({ en: 'Groove' }, 'ja'), 'Groove');
  assert.equal(pickName('x', 'en'), 'x');
  assert.equal(pickGrade({ french: '6c', yds: '5.11a' }), '5.11a');
  assert.equal(pickGrade({ v: 'V3' }), 'V3');
  assert.equal(pickGrade({ yds: '5.9', french: '5c' }, ['french']), '5c');
  assert.equal(pickGrade('6c'), '6c');
  assert.match(newId(), /^[0-9a-z]{16}$/);
});

test('readTopo：props.grade 缺漏時 fallback 至 thecrag:grade', () => {
  const view = example('topo.json'), layer = example('topo-routes.json'), set = example('set.json');
  // 模擬舊資料：移除 props.grade，留下 thecrag:grade: '6c'
  const nodes = set.nodes.map((n) => n.id === 'tdebo72up4xx11pe' ? { ...n, props: { ...n.props, grade: undefined, 'thecrag:grade': '6c' } } : n);
  const m = readTopo({ view, layers: [layer], nodes });
  const z = m.routes.find((r) => r.id === 'tdebo72up4xx11pe');
  assert.equal(z.grade, '6c');
});

test('編輯後寫回圖層：沒動的標註原樣保留，輸出通過 validate', () => {
  const view = example('topo.json'), layer = example('topo-routes.json'), set = example('set.json');
  const m = readTopo({ view, layers: [layer], nodes: set.nodes });
  const same = writeLayer(layer, m.routes, 0, new Set(set.nodes.filter((n) => n.type === 'route').map((n) => n.id)));
  assert.deepEqual(same.marks.map((x) => x.node).sort(), layer.marks.map((x) => x.node).sort());
  assert.deepEqual(validate(same), []);
  // 加一個點、新路線與 bolt
  const routes = addLinePoint(m.routes, 'tdebo72up4xx11pe', [1500, 150], 40);
  routes.push({ id: newId(), label: '9', kind: 'sport', name: '新路線', layer: 0, line: [[100, 1000], [200, 800]], bolts: { B01: { at: [150, 900] }, A01: { at: [210, 790], anchor: true } } });
  const out = writeLayer(layer, routes, 0, new Set(set.nodes.filter((n) => n.type === 'route').map((n) => n.id)));
  assert.deepEqual(validate(out), [], validate(out).join('\n'));
  assert.equal(out.marks.find((x) => x.node === 'tdebo72up4xx11pe').geometry.coordinates.at(-1)[0], 1500);
  const added = out.nodes.filter((n) => n.parent === routes.at(-1).id);
  assert.deepEqual(added.map((n) => [n.type, n.name]).sort(), [['anchor', 'A01'], ['bolt', 'B01']]);
  // 讀回來一樣
  const back = readTopo({ view, layers: [out], nodes: set.nodes });
  assert.equal(back.routes.find((r) => r.id === routes.at(-1).id).label, '9');
  assert.equal(back.routes.find((r) => r.id === routes.at(-1).id).kind, 'sport');
});

// ── 共用線段與編輯規則 ──
const a = { id: 'a', line: [[100, 900], [120, 600], [100, 300]] };
const b = { id: 'b', line: forkLine(a.line, 1).concat([[300, 200]]) };
test('共用線段：分岔複製前段，共用的線段只畫一次、獨有的線段各自成一條', () => {
  assert.deepEqual(forkLine(a.line, 1), [[100, 900], [120, 600]]);
  const runs = drawnRuns([['a', a.line], ['b', b.line]]);
  assert.equal(runs.get('a')[0].length, 3);
  assert.deepEqual(runs.get('b'), [[[120, 600], [300, 200]]]);
  assert.deepEqual(ownRuns([['a', a.line], ['b', b.line]]).get('a'), [[[120, 600], [100, 300]]]);
  assert.deepEqual(drawnRuns([['a', [[1, 1], [2, 2]]], ['b', [[2, 2], [1, 1]]]]).get('b'), []);
});

test('點在線段中間：插進那一段（共用的線段兩條一起插入），其他地方接在線尾', () => {
  assert.equal(segmentAt(a.line, [112, 760], 20), 0);
  assert.equal(segmentAt(a.line, [500, 760], 20), -1);
  assert.equal(segmentAt(a.line, [100, 900], 20), -1, '在把手上不算');
  const next = addLinePoint([a, b], 'a', [112, 760], 20);
  assert.equal(next[0].line.length, 4);
  assert.equal(next[1].line.length, 4, '分岔的路線一起插入，兩條線不會分開');
  assert.deepEqual(addLinePoint([a], 'a', [500, 100], 20)[0].line.at(-1), [500, 100]);
});

test('移動、刪除共用的點：分岔的路線一起動，bolt 不動', () => {
  const withBolt = { ...a, bolts: { B01: { at: [120, 600] } } };
  const moved = moveSharedPoint([withBolt, b], [120, 600], [130, 610]);
  assert.deepEqual(moved[0].line[1], [130, 610]);
  assert.deepEqual(moved[1].line[1], [130, 610]);
  assert.deepEqual(moved[0].bolts.B01.at, [120, 600]);
  const removed = removeLinePoint([a, b], 'a', 1);
  assert.equal(removed[0].line.length, 2);
  assert.equal(removed[1].line.length, 2);
});

// ── 縮放與裁切 ──
test('縮放：限制在 1 到上限、放大後邊緣不離開舞台、雙指的點留在手指下、點兩下放大再回來', () => {
  const stage = { w: 400, h: 300 };
  assert.deepEqual(clampView({ scale: 9, x: 0, y: 0 }, stage, stage).scale, 6);
  assert.deepEqual(clampView({ scale: 1, x: 50, y: 50 }, stage, stage), { scale: 1, x: 0, y: 0 });
  const v = moveView(IDENTITY, { x: 40, y: 30 }, { x: 40, y: 30 }, 2, stage, stage);
  assert.equal(v.scale, 2);
  assert.equal(v.x, -40, '手指下的點不動');
  assert.equal(doubleTapView(IDENTITY, { x: 0, y: 0 }, stage, stage).scale, 2.5);
  assert.deepEqual(doubleTapView(v, { x: 0, y: 0 }, stage, stage), IDENTITY);
  assert.equal(isDoubleTap({ at: { x: 0, y: 0 }, time: 0 }, { at: { x: 5, y: 5 }, time: 200 }), true);
  assert.equal(isDoubleTap({ at: { x: 0, y: 0 }, time: 0 }, { at: { x: 5, y: 5 }, time: 600 }), false);
});

test('路線卡片的裁切：沒有標記是原範圍，路線整條在範圍內', () => {
  const base = { x: 0, y: 0, w: 2000, h: 1500 };
  assert.deepEqual(routeCrop(base, undefined), base);
  const r = { id: 'r', line: [[800, 1200], [850, 700], [800, 300]] };
  const c = routeCrop(base, r);
  for (const [x, y] of r.line) assert.ok(x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h);
  assert.ok(c.w < base.w);
});

test('灰階遮罩：沿著線疊回原色的照片，線不到兩點時不畫', () => {
  const photo = { href: 'a&b.jpg', w: 400, h: 300 };
  const svg = renderReveal([[10, 290], [200, 20]], { photo, width: 50, id: 'm1' });
  assert.match(svg, /<mask id="m1" maskUnits="userSpaceOnUse" x="0" y="0" width="400" height="300">/);
  assert.deepEqual([...svg.matchAll(/stroke-width="([0-9.]+)"/g)].map((m) => Number(m[1])), [50, 35, 22.5]);
  assert.match(svg, /<image href="a&amp;b.jpg" x="0" y="0" width="400" height="300" preserveAspectRatio="none" mask="url\(#m1\)">/);
  assert.equal(renderReveal([[10, 10]], { photo, width: 50, id: 'm1' }), '');
  assert.equal(renderReveal(undefined, { photo, width: 50, id: 'm1' }), '');
});

test('往下滑：往下夠遠、比左右多、照片沒有跟著縱移才算', () => {
  const o = { x: 0, y: 0 };
  assert.equal(swipeDown(o, { x: 5, y: 100 }, 0), true);
  assert.equal(swipeDown(o, { x: 0, y: -100 }, 0), false);
  assert.equal(swipeDown(o, { x: 0, y: 50 }, 0), false);
  assert.equal(swipeDown(o, { x: 80, y: 100 }, 0), false);
  assert.equal(swipeDown(o, { x: 0, y: 100 }, 5), false);
});

test('左右滑：橫向夠遠、比上下多、照片沒有跟著橫移才換路線', () => {
  const o = { x: 0, y: 0 };
  assert.equal(swipeStep(o, { x: -60, y: 5 }, 0), 1);
  assert.equal(swipeStep(o, { x: 60, y: -5 }, 0), -1);
  assert.equal(swipeStep(o, { x: 30, y: 0 }, 0), undefined);
  assert.equal(swipeStep(o, { x: 60, y: 50 }, 0), undefined);
  assert.equal(swipeStep(o, { x: 60, y: 0 }, 5), undefined);
});

test('寫回圖層：沒動的小數座標照原樣，不因為存檔而移動', () => {
  const view = { climbio: 2, kind: 'view', surface: 'photo', id: 'v', href: 'x.jpg', w: 2560, h: 1711 };
  const layer = { climbio: 2, kind: 'layer', id: 'l', on: 'v', nodes: [{ id: 'a', type: 'route' }, { id: 'a-b01', type: 'bolt', parent: 'a', name: 'B01' }], marks: [{ node: 'a', geometry: { type: 'LineString', coordinates: [[100.352, 1500.6789], [120.5, 200.25]] } }, { node: 'a-b01', geometry: { type: 'Point', coordinates: [110.1234, 800.5] } }] };
  const { routes } = readTopo({ view, layers: [layer] });
  const out = writeLayer(layer, routes, 0);
  assert.deepEqual(out.marks.find((m) => m.node === 'a').geometry.coordinates, [[100.352, 1500.6789], [120.5, 200.25]]);
  assert.deepEqual(out.marks.find((m) => m.geometry.type === 'Point').geometry.coordinates, [110.1234, 800.5]);
});

test('reserved 的範圍不放編號：同一條線，保留線上放編號的位置，編號改放別處', () => {
  const photo = { w: 1000, h: 1000 };
  const routes = [{ id: 'a', label: '7', kind: 'sport', layer: 0, line: [[500, 900], [500, 100]] }];
  const badge = (svg) => { const m = svg.match(/<g class="topo-badge"><rect x="([\d.-]+)" y="([\d.-]+)" width="([0-9.]+)" height="([0-9.]+)"/); return m && { x: +m[1], y: +m[2], w: +m[3], h: +m[4] }; };
  const free = badge(renderLines(routes, { photo, k: 1, highlight: 'a', solo: true }));
  assert.ok(free);
  const hole = { x: free.x - 5, y: free.y - 5, w: free.w + 10, h: free.h + 10 };
  const moved = badge(renderLines(routes, { photo, k: 1, highlight: 'a', solo: true, reserved: [hole] }));
  assert.ok(moved, '選到的路線一定要標');
  assert.ok(moved.x + moved.w <= hole.x || hole.x + hole.w <= moved.x || moved.y + moved.h <= hole.y || hole.y + hole.h <= moved.y, '編號和保留的範圍重疊');
});

test('照片等比放入或鋪滿直橫舞台，鋪滿後可拖曳到照片邊界', () => {
  const stage = { w: 412, h: 839 }, size = fitSize(stage, 3 / 4, 'cover');
  assert.deepEqual(size, { w: 629.25, h: 839 });
  assert.deepEqual(fitSize(stage, 3 / 4, 'width'), { w: 412, h: 412 / .75 });
  assert.deepEqual(fitSize(stage, 16 / 9, 'width'), { w: 412, h: 412 / (16 / 9) });
  assert.deepEqual(fitSize(stage, 1 / 3, 'width'), { w: 412, h: 1236 });
  assert.deepEqual(fitSize(stage, 3 / 4), { w: 412, h: 412 / .75 });
  assert.deepEqual(fitSize({ w: 839, h: 412 }, 3 / 4, 'cover'), { w: 839, h: 839 / .75 });
  assert.deepEqual(clampView({ scale: 1, x: 999, y: 999 }, stage, size), { scale: 1, x: (size.w - stage.w) / 2, y: 0 });
});

test('線的頭尾照資料畫：不修掉尾巴的彎勾、不自動接到確保站', () => {
  const hook = { id: 'r', kind: 'sport', line: [[100, 900], [110, 500], [120, 210], [190, 205]], bolts: { A01: { at: [400, 200], anchor: true } } };
  const svg = renderLines([hook], { photo: { w: 1000, h: 1000 }, k: 1, naturalEnds: true });
  const d = svg.match(/class="topo-line" d="([^"]+)"/)[1];
  assert.match(d, /190[ ,]205\s*$/);   // 線尾還是資料的最後一點
  assert.doesNotMatch(d, /400/);        // 沒接到確保站
});

test('gradePill：分岔路線的編號標在自己分岔出去的線上、靠近分岔點，起點下面只留主線的編號', () => {
  const shared = [[500, 800], [520, 500]];
  const routes = [{ id: 'a', label: '1', grade: '5.10b', kind: 'sport', layer: 0, line: [...shared, [600, 200]] }, { id: 'b', label: '2', grade: '5.12d', kind: 'sport', layer: 0, line: [...shared, [300, 200]] }];
  const svg = renderLines(routes, { photo: { w: 1000, h: 1000 }, k: 1, gradePill: true });
  const [one, two] = [...svg.matchAll(/<g class="topo-badge"><rect x="([0-9.]+)" y="([0-9.]+)" width="([0-9.]+)" height="([0-9.]+)"/g)].map((m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] }));
  assert.ok(one.y > 800 && Math.abs(one.x + one.w / 2 - 500) < 1, '主線在起點下面');
  const [cx, cy] = [two.x + two.w / 2, two.y + two.h / 2];
  assert.ok(cy < 500 && cy > 300 && cx < 500, '分岔的在分岔點以上、往左分出去的線上');
});

test('gradePill：起點相同但沒有共用線段的路線，編號在起點下面一個接一個往下排', () => {
  const routes = [{ id: 'a', label: '1', grade: '5.10b', kind: 'sport', layer: 0, line: [[500, 800], [600, 200]] }, { id: 'b', label: '2', grade: '5.12d', kind: 'sport', layer: 0, line: [[500, 800], [400, 200]] }];
  const svg = renderLines(routes, { photo: { w: 1000, h: 1000 }, k: 1, gradePill: true });
  const [one, two] = [...svg.matchAll(/<g class="topo-badge"><rect x="([0-9.]+)" y="([0-9.]+)" width="([0-9.]+)" height="([0-9.]+)"/g)].map((m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] }));
  for (const b of [one, two]) { assert.ok(b.y > 800, '在起點下面'); assert.ok(Math.abs(b.x + b.w / 2 - 500) < 1, '對齊起點'); }
  assert.ok(two.y >= one.y + one.h && two.y - one.y < one.h * 1.5, '第二個緊接在第一個下面');
});

test('names: false 不顯示路線名稱，難度照樣在編號牌上', () => {
  const routes = [{ id: 'a', label: '1', kind: 'sport', grade: '5.10a', name: '第一外角', line: [[500, 900], [500, 100]] }];
  const opts = { photo: { w: 1000, h: 1000 }, k: 1 };
  assert.match(renderLines(routes, opts), /第一外角/);
  const hidden = renderLines(routes, { ...opts, names: false });
  assert.doesNotMatch(hidden, /第一外角/);
  assert.match(hidden, /5\.10a/);
});

test('選到的路線，共用的前段（歸別條路線畫）也跟著亮起來', () => {
  const shared = [[500, 800], [520, 500]];
  const routes = [{ id: 'a', label: '1', kind: 'sport', layer: 0, line: [...shared, [600, 200]] }, { id: 'b', label: '2', kind: 'sport', layer: 0, line: [...shared, [300, 200]] }];
  const on = (highlight) => renderLines(routes, { photo: { w: 1000, h: 1000 }, k: 1, highlight }).split('<g class="topo-route').filter((g) => / on"/.test(g)).join('');
  assert.match(on('b'), /500[ ,]800/, '選到 b：共用的起點段（500,800 → 520,500）在亮的那組');
  assert.match(on('b'), /300[ ,]200/);
  assert.match(on('a'), /500[ ,]800/);
  assert.doesNotMatch(on('a'), /300[ ,]200/, '選到 a：b 獨有的後段不跟著亮');
});

test('名稱要嘛每條路線都有、要嘛都沒有：有一條放不下整張都不顯示', () => {
  const photo = { w: 1000, h: 1000 };
  // 兩條各自離得很遠：名稱都放得下
  const apart = [{ id: 'a', label: '1', kind: 'sport', grade: '5.10a', name: '甲路線', line: [[200, 900], [200, 100]] }, { id: 'b', label: '2', kind: 'sport', grade: '5.10b', name: '乙路線', line: [[800, 900], [800, 100]] }];
  const shown = renderLines(apart, { photo, k: 1 });
  assert.ok(shown.includes('甲路線') && shown.includes('乙路線'));
  // 加上一群擠在一起的路線：那群放不下名稱，離得遠的那兩條也不顯示（不會只有幾條有名字）
  const crowd = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, label: String(i + 3), kind: 'sport', grade: '5.11a', name: `擠${i}`, line: [[400 + i * 10, 900], [405 + i * 10, 300]] }));
  const svg = renderLines([...apart, ...crowd], { photo, k: 0.4, densityK: 0.4 });
  const names = ['甲路線', '乙路線', ...crowd.map((r) => r.name)].filter((n) => svg.includes(n));
  assert.ok(names.length === 0 || names.length === 32, `名稱全有或全沒有，實際 ${names.length} 條`);
  assert.equal(names.length, 0);
});

test('bolt 旁邊夠寬就標材質，不管名稱顯不顯示（names: false）', () => {
  const routes = [{ id: 'a', label: '1', kind: 'sport', grade: '5.10a', name: '第一外角', line: [[500, 900], [500, 100]], bolts: { B01: { at: [500, 600], note: '316-TW' } } }];
  const svg = renderLines(routes, { photo: { w: 1000, h: 1000 }, k: 1, bolts: true, names: false });
  assert.match(svg, />316-TW</);
});

test('路線擠：整張先用原尺寸試排，挪位置排得下就不縮；排不下才整張一起縮小再拿掉難度；放大縮小時程度不變；畫了線的路線一定有編號牌', () => {
  // 手機寬的畫面（412×275）看 1600×1067 的照片；路線起點的間距用畫面像素指定
  const photo = { w: 1600, h: 1067 }, k = 1600 / 412;
  const wall = (n, gapPx, extra = []) => [...Array.from({ length: n }, (_, i) => ({ id: `r${i}`, label: String(i + 1), kind: 'sport', grade: '5.13d', line: [[200 + i * gapPx * k, 1000], [200 + i * gapPx * k, 300]] })), ...extra];
  const look = (routes, zoom = 1) => {
    const svg = renderLines(routes, { photo, k: k / zoom, densityK: k });
    const rect = svg.match(/class="topo-badge"><rect [^>]*? width="([^"]+)" height="([^"]+)"/);
    return { height: Math.round(Number(rect[2]) / (k / zoom)), grades: (svg.match(/topo-grade-bg/g) ?? []).length, badges: (svg.match(/class="topo-badge"/g) ?? []).length };
  };
  assert.deepEqual(look(wall(5, 75)), { height: 20, grades: 5, badges: 5 }, '間距夠寬：原尺寸、帶難度');
  assert.deepEqual(look(wall(5, 40)), { height: 20, grades: 5, badges: 5 }, '靠得近但編號牌往下一個接一個排得下：不縮');
  const tight = look(wall(5, 14));
  assert.equal(tight.height, 16, '擠到排不下：整張縮小');
  assert.equal(tight.badges, 5, '縮小了每條都有編號牌');
  assert.deepEqual(look(wall(5, 14), 2), tight, '放大兩倍：牌子一樣小、一樣的內容');
  assert.equal(look(wall(5, 75), 0.5).height, 20, '縮小：一樣是原尺寸');
  // 只有兩條靠在一起、其他都寬：不縮，交給排版挪位置
  const pair = wall(5, 75, [{ id: 'near', label: '7', kind: 'sport', grade: '5.9', line: [[200 - 12 * k, 1000], [200 - 12 * k, 300]] }]);
  assert.deepEqual(look(pair), { height: 20, grades: 6, badges: 6 }, '少數幾條靠近：牌子不縮');
  // 再擠也一樣：畫了線的路線都有編號牌，不能只有線沒有號碼
  for (const [n, g] of [[12, 14], [20, 8], [5, 1]]) assert.equal(look(wall(n, g)).badges, n, `${n} 條擠在一起也都有編號牌`);
  // 路線卡片（solo）不受影響
  const solo = renderLines(wall(21, 4), { photo, k, highlight: 'r10', solo: true });
  assert.match(solo, /5\.13d/);
});

test('memo：縮放時編號牌沿用上次的位置（還放得下就不換），沒有 memo 時照這個倍率重新找', () => {
  const photo = { w: 1600, h: 1067 }, k = 1600 / 412;
  const routes = Array.from({ length: 16 }, (_, i) => ({ id: `r${i}`, label: String(i + 1), kind: 'sport', grade: '5.12a', line: [[200 + i * 75, 1000], [200 + i * 75 + (i % 3) * 20, 500], [200 + i * 75, 200]] }));
  const centers = (svg) => new Map([...svg.matchAll(/data-route="([^"]+)"[^>]*><g class="topo-badge[^"]*"><rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g)].map((m) => [m[1], [+m[2] + m[4] / 2, +m[3] + m[5] / 2]]));
  // 一路放大：每一步牌子的中心相對照片移動多少（螢幕像素）
  const drift = (memo) => {
    let prev, worst = 0;
    for (let s = 1; s <= 3; s += 0.25) {
      const kk = k / s, now = centers(renderLines(routes, { photo, k: kk, densityK: k, memo }));
      if (prev) for (const [id, [x, y]] of now) if (prev.has(id)) worst = Math.max(worst, Math.hypot(x - prev.get(id)[0], y - prev.get(id)[1]) / kk);
      prev = now;
    }
    return worst;
  };
  assert.ok(drift(new Map()) < 12, '有 memo：縮放時沒有牌子跳開');
  assert.ok(drift(undefined) > 12, '沒有 memo：會換位置（這個測試有抓到東西）');
});

// ── 路線號碼：只有位置、沒有線的路線（指向路線節點的 Point 標註） ──
const tagView = { climbio: 2, kind: 'view', surface: 'photo', id: 'viewaaaaaaaaaaaa1', href: 'a.jpg', w: 1000, h: 800, license: 'CC0-1.0', attribution: '' };
const tagNodes = [{ id: 'routeaaaaaaaaaa01', type: 'route', name: '路線一' }, { id: 'routeaaaaaaaaaa02', type: 'route' }, { id: 'routeaaaaaaaaaa03', type: 'route' }];
const tagLayer = (marks) => ({ climbio: 2, kind: 'layer', id: 'layeraaaaaaaaaaa1', on: 'viewaaaaaaaaaaaa1', t: 1, license: 'CC0-1.0', attribution: '', marks });

test('路線號碼：讀出位置、號碼、牌子大小、顏色；有線的路線以線為準；找不到節點或不是路線的不收', () => {
  const layer = tagLayer([
    { node: 'routeaaaaaaaaaa01', geometry: { type: 'Point', coordinates: [100, 700] }, props: { label: '3', size: 26, style: { stroke: '#f08020' } } },
    { node: 'routeaaaaaaaaaa02', geometry: { type: 'Point', coordinates: [300, 700] } },
    { node: 'routeaaaaaaaaaa02', geometry: { type: 'LineString', coordinates: [[300, 700], [320, 300]] }, props: { label: '2' } },
    { node: 'zzzzzzzzzzzzzzzz', geometry: { type: 'Point', coordinates: [500, 700] } },
  ]);
  const m = readTopo({ view: tagView, layers: [layer], nodes: tagNodes });
  const r1 = m.routes.find((r) => r.id === 'routeaaaaaaaaaa01'), r2 = m.routes.find((r) => r.id === 'routeaaaaaaaaaa02');
  assert.deepEqual(r1.at, [100, 700]);
  assert.equal(r1.label, '3'); assert.equal(r1.tagSize, 26); assert.equal(r1.stroke, '#f08020');
  assert.equal(r1.line, undefined);
  assert.equal(r2.at, undefined);   // 有線：號碼位置不收
  assert.deepEqual(r2.line, [[300, 700], [320, 300]]);
  assert.equal(m.routes.length, 2);
});

test('路線號碼：寫回圖層——只有位置的路線寫成 Point，有線就不寫；沒動的其他標註不變；輸出通過 validate', () => {
  const layer = tagLayer([{ node: 'routeaaaaaaaaaa01', geometry: { type: 'Point', coordinates: [100, 700] }, props: { label: '3', size: 26 } }]);
  const model = readTopo({ view: tagView, layers: [layer], nodes: tagNodes });
  const same = writeLayer(layer, model.routes, 0, new Set(['routeaaaaaaaaaa01', 'routeaaaaaaaaaa02', 'routeaaaaaaaaaa03']));
  assert.deepEqual(same.marks, layer.marks);   // 原樣寫回，props 保留
  const moved = writeLayer(layer, model.routes.map((r) => ({ ...r, at: [120, 690] })), 0, new Set(['routeaaaaaaaaaa01']));
  assert.deepEqual(moved.marks[0].geometry.coordinates, [120, 690]);
  const drawn = writeLayer(layer, model.routes.map((r) => ({ ...r, line: [[100, 700], [110, 300]] })), 0, new Set(['routeaaaaaaaaaa01']));
  assert.deepEqual(drawn.marks.map((m) => m.geometry.type), ['LineString']);   // 有線：Point 拿掉
  const fresh = writeLayer(tagLayer([]), [{ id: 'routeaaaaaaaaaanew', kind: 'other', layer: 0, at: [5, 6], label: '9' }], 0);
  assert.deepEqual(fresh.nodes.map((n) => n.id), ['routeaaaaaaaaaanew']);   // 路線節點補上
  assert.deepEqual(fresh.marks[0].props, { label: '9' });
  for (const l of [same, moved, drawn, fresh]) assert.deepEqual(validate(l), []);
});

test('路線號碼：畫出來——牌子中心就是位置；有牌子大小時蓋成 1.2 倍、跟著照片縮放；沒有號碼畫小圓點', () => {
  const routes = [
    { id: 'a', kind: 'other', label: '3', at: [100, 700], tagSize: 26 },
    { id: 'b', kind: 'other', label: '4', at: [300, 700] },
    { id: 'c', kind: 'other', at: [500, 700] },
  ];
  const svg = renderLines(routes, { photo: { w: 1000, h: 800 }, k: 1 });
  const box = (id) => { const m = svg.match(new RegExp(`data-route="${id}"[^>]*><g class="topo-badge tag[^"]*"><rect x="([0-9.]+)" y="([0-9.]+)" width="([0-9.]+)" height="([0-9.]+)" rx="([0-9.]+)"`)); return m && m.slice(1).map(Number); };
  const [x, y, w, h, rx] = box('a');
  assert.ok(Math.abs(x + w / 2 - 100) < 0.01 && Math.abs(y + h / 2 - 700) < 0.01, '中心在位置');
  assert.ok(Math.abs(w - 26 * 1.2) < 0.01 && w === h && Math.abs(rx - h * 0.3) < 0.01, '原牌子的 1.2 倍、圓角方塊');
  const big = renderLines(routes, { photo: { w: 1000, h: 800 }, k: 3 });
  assert.equal(big.includes('width="31.2"'), true, '照片像素大小不隨 k（放大倍率）變');
  assert.ok(box('b') && box('b')[2] > 20, '手點的是膠囊、依畫面大小');
  assert.equal(box('c'), null);
  assert.ok(svg.includes('cx="500" cy="700"'), '沒有號碼：小圓點');
});
