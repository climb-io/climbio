// Studio Crag（studio/crag/）的路線清單：貼上表格與 CSV 辨認欄位、路線的新增／移動／排序／刪除、匯入岩場站（龍洞的出口）的轉換、匯出通過 validate
import { test } from 'node:test';
import './studio-i18n.mjs';   // Studio 的訊息走語言包，測試載入繁體中文版
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import * as M from '../studio/crag/model.js';
import { parseTable, guessColumns, toRoutes, parseGrade, parseStyle, parseNumber, decodeText } from '../studio/crag/table.js';
import { crawl, fromV2 } from '../studio/crag/site.js';
import * as P from '../studio/crag/publish.js';

const { validate } = createRequire(import.meta.url)('../format/format.js');
const FIXTURE = new URL('../tests/author/longdong/', import.meta.url);   // 龍洞岩場站出口裁小的一份（兩個區、每個分區兩條路線＋Topo 用到的）
const BASE = 'https://longdong.web.app/climbio/longdong.json';
const fixtureJson = async (url) => JSON.parse(readFileSync(new URL(url.slice(url.lastIndexOf('/') + 1), FIXTURE), 'utf8'));
const allValid = (state) => { for (const { path, doc } of M.exportDocs(state)) assert.deepEqual(validate(doc), [], path); };

test('貼上試算表：Tab 分隔、第一列是標題時照欄名對應，引號裡的換行留著', () => {
  const rows = parseTable('名稱\t難度\t類型\t長度\tBolt 數\t說明\n第一外角\t5.10a\t運動\t18m\t7\t"左邊\n起攀"\n小生物\t5.7\t傳統\t12\t\t\n');
  assert.equal(rows.length, 3);
  assert.equal(rows[1][5], '左邊\n起攀');
  const map = guessColumns(rows);
  assert.equal(map.header, true);
  assert.deepEqual(map.columns, ['name', 'grade', 'style', 'length', 'bolts', 'description']);
  const routes = toRoutes(rows, map);
  assert.deepEqual(routes[0], { name: '第一外角', props: { grade: { yds: '5.10a' }, style: 'sport', length: 18, bolts: 7, description: '左邊\n起攀' } });
  assert.deepEqual(routes[1], { name: '小生物', props: { grade: { yds: '5.7' }, style: 'trad', length: 12 } });
});

test('沒有標題列：看內容猜（難度、類型、數字依序是長度和 bolt 數、文字是名稱）；CSV 的逗號與分號、BOM', () => {
  const rows = parseTable('﻿"Z字, 上段",5.11a,sport,25,9\nV槽,5.10b,sport,20,8\n');
  assert.deepEqual(rows[0], ['Z字, 上段', '5.11a', 'sport', '25', '9']);
  const map = guessColumns(rows);
  assert.equal(map.header, false);
  assert.deepEqual(map.columns, ['name', 'grade', 'style', 'length', 'bolts']);
  assert.equal(toRoutes(rows, map).length, 2);
  assert.deepEqual(parseTable('a;b;c\n1;2;3'), [['a', 'b', 'c'], ['1', '2', '3']]);
  // 欄位對應可以手動改：把第 4 欄改成繩距
  const fixed = toRoutes(rows, { header: false, columns: ['name', 'grade', '', 'pitches', ''] });
  assert.deepEqual(fixed[1], { name: 'V槽', props: { grade: { yds: '5.10b' }, pitches: 20 } });
  // 抱石：V 級和 Font 大寫
  const b = parseTable('Route\tGrade\tWall\nCrimp\tV4\t大石頭\nSlab\t6A+\t大石頭');
  const bm = guessColumns(b);
  assert.deepEqual(bm.columns, ['name', 'grade', 'wall']);
  assert.deepEqual(toRoutes(b, bm).map(r => [r.props.grade, r.wall]), [[{ v: 'V4' }, '大石頭'], [{ font: '6A+' }, '大石頭']]);
});

test('難度、類型、數字的辨認', () => {
  assert.deepEqual(parseGrade('5.11A'), { yds: '5.11a' });
  assert.deepEqual(parseGrade('v3'), { v: 'V3' });
  assert.deepEqual(parseGrade('6c+'), { french: '6c+' });
  assert.deepEqual(parseGrade('6c+', 'font'), { font: '6C+' });
  assert.deepEqual(parseGrade('初段'), { dan: '初段' });
  assert.deepEqual(parseGrade('VI+', 'uiaa'), { uiaa: 'VI+' });
  assert.equal(parseGrade(' '), undefined);
  assert.equal(parseStyle('頂繩'), 'toprope');
  assert.equal(parseStyle('Top Rope'), 'toprope');
  assert.equal(parseStyle('Highball'), 'highball');
  assert.equal(parseNumber('1,200 m'), 1200);
  assert.equal(parseNumber('3.6', true), 4);
  assert.equal(parseNumber('?'), undefined);
  assert.equal(decodeText(new Uint8Array([0xa4, 0xa4, 0xa4, 0xe5])), '中文');   // Big5
  assert.equal(decodeText(new TextEncoder().encode('中文')), '中文');
});

test('路線：新增接在最後、拖到別面岩壁、在岩壁裡排序、批次移動與刪除；順序存在 props.order，匯出通過 validate', () => {
  const state = M.newBook('測試岩場', 1761620000000);
  const w1 = M.addWall(state), w2 = M.addWall(state, '東壁');
  const [a, b, c] = M.addRoutes(state, [
    { name: 'A', parent: w1, props: { grade: { yds: '5.9' }, style: 'sport', bolts: 6 } },
    { name: 'B', parent: w1, props: { grade: { yds: '5.10a' } } },
    { name: 'C', props: {} },
  ]);
  assert.match(a, /^[0-9a-z]{16}$/);
  const names = (w) => M.routesOf(state, w).map(r => r.name);
  const orders = (w) => M.routesOf(state, w).map(r => r.props.order);
  assert.deepEqual(names(w1), ['A', 'B']);
  assert.deepEqual(names(null), ['C']);
  assert.deepEqual(orders(w1), [1, 2]);

  M.moveRoutes(state, [c], w1, a);          // 還沒分配的拖到 A 前面
  assert.deepEqual(names(w1), ['C', 'A', 'B']);
  assert.deepEqual(orders(w1), [1, 2, 3]);
  assert.deepEqual(names(null), []);
  M.moveRoutes(state, [c], w1);             // 拖到最後
  assert.deepEqual(names(w1), ['A', 'B', 'C']);
  M.moveRoutes(state, [a, c], w2);          // 多選移到東壁
  assert.deepEqual(names(w2), ['A', 'C']);
  assert.deepEqual(orders(w1), [1]);
  assert.deepEqual(orders(w2), [1, 2]);

  // 編輯：名稱、欄位、換岩壁（接到最後）；順序留著
  M.updateRoute(state, b, { name: 'B2', props: { grade: { french: '6a' }, length: 15 }, parent: w2 });
  assert.deepEqual(names(w2), ['A', 'C', 'B2']);
  assert.deepEqual(M.routesOf(state, w2)[2].props, { grade: { french: '6a' }, length: 15, order: 3 });
  // 同名同岩壁是重複
  assert.equal(M.findDuplicate(state, ' a ', w2)?.id, a);
  assert.equal(M.findDuplicate(state, 'A', w1), undefined);
  assert.equal(M.findDuplicate(state, 'A', w2, a), undefined);

  for (const { path, doc } of M.exportDocs(state)) assert.deepEqual(validate(doc), [], path);
  const set = M.exportDocs(state)[0].doc;
  assert.deepEqual(set.nodes.filter(n => n.type === 'route').map(n => [n.name, n.parent === w2, n.props.order]), [['A', true, 1], ['B2', true, 3], ['C', true, 2]]);

  // 刪除岩壁：路線改成還沒分配；刪除路線後重新編號
  M.deleteWall(state, w2);
  assert.deepEqual(names(null), ['A', 'C', 'B2']);
  M.removeRoutes(state, [c]);
  assert.deepEqual(names(null), ['A', 'B2']);
  assert.deepEqual(orders(null), [1, 2]);
  // 合併岩壁：路線接在後面
  M.moveRoutes(state, [a], w1);
  const w3 = M.addWall(state);
  M.addRoutes(state, [{ name: 'D', parent: w3 }]);
  M.mergeWalls(state, w3, w1);
  assert.deepEqual(names(w1), ['A', 'D']);
  assert.equal(M.walls(state).some(w => w.id === w3), false);
  allValid(state);
});

test('匯入岩場站（龍洞）：區、分區、路線照原本的樹和 id，路線帶代號與 longdong: 詞彙，地圖併成一張，Topo 原樣收進來、保留署名；匯出通過 validate', async () => {
  const src = await crawl(BASE, fixtureJson);
  assert.equal(src.docs.size, 9);
  const { state, images } = fromV2(src, 1761620000000);
  const { book } = state;
  assert.equal(book.name, '龍洞');
  assert.equal(book.attribution, '臺灣戶外攀岩協會（TOCC）固定點更新計畫');
  assert.deepEqual(book.derivedFrom, { url: BASE, id: '4on8pm04b9psonxr', t: src.root.t });
  const count = (type) => book.nodes.filter(n => n.type === type).length;
  assert.deepEqual([count('crag'), count('area'), count('sector')], [1, 2, 11]);
  assert.equal(M.walls(state).length, 11);
  // 樹：分區在區底下、區在岩場底下
  const crag = M.childrenOf(state, null);
  assert.deepEqual(crag.map(n => n.type), ['crag']);
  assert.deepEqual(M.childrenOf(state, crag[0].id).map(n => M.text(n.name)), ['後門', '校門口']);

  // 路線：原本的欄位都在（站的詞彙原樣，不另外換算），補上順序
  const tiger = book.nodes.find(n => n.id === '4hqli7e5lh5665u3');
  assert.deepEqual(tiger.name, { 'zh-Hant': '虎牙', en: 'Tiger’s Tooth' });
  assert.equal(tiger.parent, '601z75spt6esofks');
  assert.equal(tiger.props.code, 'longdong/xwexcv');
  assert.deepEqual(tiger.props.grade, { yds: '5.11b' });
  assert.equal(tiger.props['longdong:safety'], 'green');
  assert.equal(tiger.props['longdong:bolts'].length, 6);
  assert.equal(tiger.props.bolts, undefined);
  const disco = M.routesOf(state, '38hxmpax4oykpdmn');
  assert.deepEqual(disco.map(r => r.props.order), [1, 2]);
  assert.ok(M.routes(state).every(r => r.props.code.startsWith('longdong/')));

  // 地圖：每個分區一段牆線（MultiLineString 只有一段的換成 LineString），之後加照片也不重算
  assert.equal(state.map.marks.length, 11);
  assert.ok(M.wallLine(state, '38hxmpax4oykpdmn').length > 2);
  M.regenerate(state);
  assert.equal(state.map.marks.length, 11);

  // Topo：兩張照片和疊在上面的圖層；照片歸到圖層路線所在的分區
  assert.equal(state.photos.size, 2);
  assert.equal(state.layers.size, 2);
  assert.deepEqual(images.map(i => i.url).sort(), ['https://longdong.web.app/climbio/2e26idbcphon06ov.webp', 'https://longdong.web.app/climbio/lisp3mi8clzxhqmo.webp']);
  const illusion = book.nodes.find(n => M.text(n.name) === '騙人的牆');
  const [photo] = M.photosOf(state, illusion.id);
  assert.equal(photo.name, '騙人的牆');
  assert.equal(photo.sha256, '222146ffab66fc112ef0e102fa75c9d91a06d47fe53afdfef4bbe5c30d82e4e1');
  assert.deepEqual(photo.props.crop, { x: 557.056, y: 0, w: 1389.312, h: 1276.2349 });
  assert.match(photo.id, /^[0-9a-z]{16}$/);
  assert.equal(photo.href, `${photo.id}.webp`);
  assert.equal(images.find(i => i.id === photo.id).url, 'https://longdong.web.app/climbio/2e26idbcphon06ov.webp');
  const layer = [...state.layers.values()].find(l => l.on === photo.id);
  assert.equal(layer.marks.length, 25);
  assert.equal(layer.nodes.length, 20);
  assert.equal(photo.attribution, 'KK');
  assert.deepEqual(photo.derivedFrom, { url: 'https://longdong.web.app/climbio/2e26idbcphon06ov.json', id: '2e26idbcphon06ov', ...(src.docs.get('2e26idbcphon06ov').t ? { t: src.docs.get('2e26idbcphon06ov').t } : {}) });
  assert.equal(layer.attribution, 'KK');
  assert.equal(layer.derivedFrom.url, 'https://longdong.web.app/climbio/wi8csu5srq8qmox4.json');
  assert.equal(state.map.attribution, '臺灣戶外攀岩協會（TOCC）固定點更新計畫');
  assert.equal(state.map.license, 'CC-BY-SA-4.0');
  assert.equal(state.map.derivedFrom.id, 'nffc2kag3yvw9v9k');

  // 改署名只加在 Guidebook 原本的署名後面（拿不掉）；匯入的照片、圖層、地圖不動；改名稱只換中文
  M.setAttribution(state, '小明');
  assert.equal(book.attribution, '臺灣戶外攀岩協會（TOCC）固定點更新計畫；小明 改編');
  assert.equal(photo.attribution, 'KK');
  assert.equal(layer.attribution, 'KK');
  assert.equal(state.map.attribution, '臺灣戶外攀岩協會（TOCC）固定點更新計畫');
  M.renameWall(state, illusion.id, '騙人牆');
  assert.deepEqual(illusion.name, { 'zh-Hant': '騙人牆', en: 'Illusion Wall' });

  allValid(state);
  const docs = M.exportDocs(state);
  assert.deepEqual(docs.map(d => d.path).slice(0, 2), ['index.json', `${state.map.id}.json`]);
  assert.equal(docs.length, 2 + 2 + 2);
  assert.equal(docs.find(d => d.doc.id === photo.id).doc.href, `${photo.id}.webp`);
  assert.equal(docs.find(d => d.doc.id === layer.id).path, `${layer.id}.json`);
  assert.ok(docs[1].doc.marks.every(m => !m.props));   // author:manual 不匯出
});

test('匯入帶步道、區域、地點的岩場站地圖（mapkit 的龍洞基準）：57 段牆線、步道、區域都收進岩壁地圖，mapkit 讀得出來；匯出通過 validate', async () => {
  const { readMap } = await import('../mapkit/data.js');
  const base = JSON.parse(readFileSync(new URL('../mapkit/baseline/longdong-map.json', import.meta.url), 'utf8'));
  const inSet = base.nodes.filter(n => n.type !== 'poi');
  const root = { climbio: 2, kind: 'set', type: 'site', id: 'site000000000001', name: '龍洞', license: 'CC-BY-SA-4.0', attribution: base.attribution, nodes: inSet, items: [{ href: `${base.id}.json`, id: base.id }] };
  const map = { ...base, nodes: base.nodes.filter(n => n.type === 'poi') };
  const files = { 'https://example.com/s/site.json': root, [`https://example.com/s/${base.id}.json`]: map };
  const src = await crawl('https://example.com/s/site.json', async (u) => files[u]);
  const { state } = fromV2(src);
  assert.equal(M.walls(state).length, 57);
  assert.ok(state.map.marks.some(m => m.props?.kind === 'trail'));
  assert.equal(state.map.nodes.filter(n => n.type === 'poi').length, 60);
  const model = readMap(state.map, [], state.book.nodes);
  assert.equal(model.walls.length, 57);
  assert.equal(model.areas.length, 9);
  assert.ok(model.lines.trail.length > 0);
  assert.ok(model.pois.length > 0);
  allValid(state);
});

test('岩壁換位置（moveNode）：同一層插在別面前面、接在最後；搬進區域、搬回最上層，兩邊的順序重新編號', () => {
  const state = M.newBook('換位置');
  const [a, b, c] = ['A', 'B', 'C'].map(n => M.addWall(state, n));
  const names = (parent) => M.childrenOf(state, parent).map(n => M.text(n.name));
  M.moveNode(state, c, null, a);
  assert.deepEqual(names(null), ['C', 'A', 'B']);
  M.moveNode(state, c, null);
  assert.deepEqual(names(null), ['A', 'B', 'C']);
  const area = { id: 'area0000000000001', type: 'area', name: '區' };
  state.book.nodes.push(area);
  M.moveNode(state, b, area.id);
  assert.deepEqual(names(area.id), ['B']);
  assert.deepEqual(names(null), ['A', 'C', '區']);
  M.moveNode(state, b, null, a);
  assert.deepEqual(names(null), ['B', 'A', 'C', '區']);
  assert.equal(state.book.nodes.find(n => n.id === b).parent, undefined);
});

test('國家：選了就存、清掉就移除、不在清單的忽略；不隨 props.settings 匯出', () => {
  const state = M.newBook('小岩場', 1);
  assert.equal(M.settings(state).country, '');
  M.setSettings(state, { country: 'tw' });
  assert.equal(M.settings(state).country, 'tw');
  M.setSettings(state, { country: 'zz9' });
  assert.equal(M.settings(state).country, 'tw');
  assert.ok(!('country' in (M.exportDocs(state).find(d => d.path === M.ENTRY).doc.props.settings ?? {})));
  M.setSettings(state, { country: '' });
  assert.equal(M.settings(state).country, '');
});

test('岩場的設定跟著發佈的資料走：匯出寫進 props.settings、通過 validate，另一個人匯入就有一樣的設定；舊資料沒寫就用預設', async () => {
  const BASE = 'https://example.com/p/x/index.json';
  const state = M.newBook('小岩場', 1);
  M.setSettings(state, { numbering: 'manual', grade: 'french', distance: 12, declination: 4, columns: ['name', 'grade', 'number'], pack: ['ortho'] });
  const docs = M.exportDocs(state);
  const entry = docs.find(d => d.path === M.ENTRY).doc;
  assert.deepEqual(entry.props.settings, { numbering: 'manual', grade: 'french', distance: 12, declination: 4, pack: ['ortho'], columns: ['name', 'grade', 'number'] });
  assert.ok(!Object.keys(entry.props).some(k => k.startsWith('author:')));
  allValid(state);
  const files = Object.fromEntries(docs.map(d => [new URL(d.path, BASE).href, d.doc]));
  const open = async (props) => fromV2(await crawl(BASE, async (u) => structuredClone(u === BASE ? { ...entry, props } : files[u]))).state;
  assert.deepEqual(M.settings(await open(entry.props)), { country: '', numbering: 'manual', grade: 'french', distance: 12, declination: 4, pack: ['ortho'], columns: ['name', 'grade', 'number'] });
  // 沒寫設定的舊資料：預設；格式不對的欄位略過
  const { settings: _, ...noSettings } = entry.props;
  assert.equal(M.settings(await open(noSettings)).numbering, 'wall');
  const bad = M.settings(await open({ ...noSettings, settings: { numbering: 'x', grade: 5, distance: 'a', columns: [1], pack: 'z' } }));
  assert.deepEqual([bad.numbering, bad.grade, bad.distance, bad.columns, bad.pack], ['wall', 'yds', 5, undefined, []]);
});


test('匯入帶 3D 模型的岩場：模型畫面、模型上的路線圖層原樣帶著（換新 id），快照的 props.model 指到新的模型；匯出通過 validate', async () => {
  const head = { climbio: 2, t: 1, license: 'CC-BY-SA-4.0', attribution: 'Climbio' };
  const root = { ...head, kind: 'set', type: 'guidebook', id: 'set0000000000001', name: '岩場', nodes: [
    { id: 'crag00000001', type: 'crag', name: '岩場' }, { id: 'wall00000001', type: 'wall', name: '牆', parent: 'crag00000001' },
    { id: 'route0000001', type: 'route', name: '線', parent: 'wall00000001', props: { grade: { yds: '5.10a' }, style: 'sport' } },
  ], items: ['photo00000000001', 'layer00000000001', 'model00000000001', 'mlayer0000000001'].map(id => ({ href: `${id}.json`, id })) };
  const camera = { position: [0, 1.6, -10], target: [0, 2, 0], fov: 50 };
  const files = {
    photo00000000001: { ...head, kind: 'view', surface: 'photo', origin: 'self', id: 'photo00000000001', href: 'photo.jpg', mime: 'image/jpeg', w: 1000, h: 1500, props: { model: { id: 'model00000000001', camera } } },
    layer00000000001: { ...head, kind: 'layer', id: 'layer00000000001', on: 'photo00000000001', href: 'photo00000000001.json', marks: [{ node: 'route0000001', geometry: { type: 'LineString', coordinates: [[500, 1400], [520, 200]] } }] },
    model00000000001: { ...head, kind: 'view', surface: 'model', origin: 'self', id: 'model00000000001', name: '3D', href: 'model-abc.glb', mime: 'model/gltf-binary', props: { node: 'crag00000001' } },
    mlayer0000000001: { ...head, kind: 'layer', id: 'mlayer0000000001', on: 'model00000000001', href: 'model00000000001.json', marks: [{ node: 'route0000001', geometry: { type: 'LineString', coordinates: [[0, 0, 0], [0, 8, 0.5]] } }] },
  };
  const base = 'https://example.com/c/index.json';
  const src = await crawl(base, async (u) => structuredClone(u === base ? root : files[u.split('/').pop().replace('.json', '')]));
  const { state, images, models } = fromV2(src, 1761620000000);
  const model = [...state.extras.values()].find(d => d.surface === 'model');
  assert.ok(model && model.id !== 'model00000000001');
  assert.equal(model.href, `${model.id}.glb`);
  assert.deepEqual(models, [{ id: model.id, url: 'https://example.com/c/model-abc.glb' }]);
  assert.deepEqual(images.map(i => i.url), ['https://example.com/c/photo.jpg']);
  const mlayer = [...state.extras.values()].find(d => d.kind === 'layer');
  assert.equal(mlayer.on, model.id);
  assert.equal(state.layers.size, 1);
  assert.equal([...state.photos.values()][0].props.model.id, model.id);
  const out = M.exportDocs(state);
  assert.ok(out.some(({ doc }) => doc.id === model.id) && out.some(({ doc }) => doc.id === mlayer.id));
  assert.deepEqual(P.blocked(state), []);   // 模型上的圖層沒有 origin，不算來源不明
  allValid(state);
});
