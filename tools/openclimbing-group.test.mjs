import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { groupOpenClimbingCrags, cragDisplayName, UNNAMED_PLACES, MAX_PACK_CRAGS } from '../redpoint/openclimbing-group.mjs';

// 真實的索引不進 repo：本機 data/openclimbing/index.json 有就用，沒有就從開放資料集下載一份存起來；連不上就略過依賴它的案例
const LOCAL = new URL('../data/openclimbing/index.json', import.meta.url);
const REMOTE = 'https://huggingface.co/datasets/climbio/crags/resolve/main/openclimbing/index.json';
async function loadIndex() {
  if (existsSync(LOCAL)) return JSON.parse(readFileSync(LOCAL, 'utf8'));
  try {
    const res = await fetch(REMOTE, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const text = await res.text();
    mkdirSync(new URL('./', LOCAL), { recursive: true });
    writeFileSync(LOCAL, text);
    return JSON.parse(text);
  } catch { return null; }
}
const index = await loadIndex();
const real = index ? test : (name, fn) => test(name, { skip: '沒有 OpenClimbing 索引（本機沒有、資料集也連不上）' }, fn);
const raw = (index?.crags ?? []).map(c => ({
  name: c.n, osmId: c.id, at: c.at, routes: c.rc, topoRoutes: c.tc,
  country: c.cc, areaPath: c.ap ?? [], url: 'https://openclimbing.org/relation/' + c.id,
}));

real('Sass de Bèita Block 1–6 show as one area pack without losing source IDs', () => {
  const grouped = groupOpenClimbingCrags(raw);
  const sass = grouped.filter(c => c.name === 'Sass de Bèita');
  assert.equal(sass.length, 1);
  assert.equal(sass[0].members.length, 6);
  assert.deepEqual(sass[0].members.map(m => m.name), [
    'Block 1', 'Block 2', 'Block 3', 'Block 4', 'Block 5', 'Block 6',
  ]);
  assert.equal(sass[0].routes, 81);
  assert.equal(sass[0].topoRoutes, 81);
  assert.equal(sass[0].members.reduce((sum, m) => sum + m.topoRoutes, 0), 81);
  const expectedIDs = new Set(raw.map(c => c.osmId));
  const actualIDs = grouped.flatMap(g => g.members?.map(c => c.osmId) ?? [g.osmId]);
  assert.equal(actualIDs.length, raw.length);
  assert.deepEqual(new Set(actualIDs), expectedIDs);
});

test('同上層區域、500 公尺內相連的岩場合併，不看名稱；不同區域、不同國家、太遠的不併', () => {
  const input = [
    { osmId: 1, name: 'Alpha', country: 'it', areaPath: ['A'], at: [12, 46], topoRoutes: 3 },
    { osmId: 2, name: 'Beta', country: 'it', areaPath: ['A'], at: [12.002, 46], topoRoutes: 3 },
    { osmId: 3, name: 'Gamma', country: 'it', areaPath: ['B'], at: [12.0001, 46], topoRoutes: 3 },
    { osmId: 4, name: 'Delta', country: 'it', areaPath: ['A'], at: [12.3, 46], topoRoutes: 3 },
    { osmId: 5, name: 'Frankenjura', country: 'de', areaPath: [], at: [11.2, 49.6], topoRoutes: 3 },
    { osmId: 6, name: 'Alpha', country: 'ch', areaPath: ['A'], at: [12.0001, 46], topoRoutes: 3 },
  ];
  const result = groupOpenClimbingCrags(input);
  assert.equal(result.filter(x => x.members).length, 1);
  assert.deepEqual(result.find(x => x.members).members.map(x => x.osmId), [1, 2]);
  assert.equal(result.length, 5);
});

test('連成一包太大時依路線數沿長軸對切，每包都在上限內、岩場不重複不遺漏', () => {
  const input = Array.from({ length: 20 }, (_, i) => ({
    osmId: i + 1, name: 'R' + i, country: 'fr', areaPath: ['Big'], at: [2 + i * 0.003, 48], topoRoutes: 10,
  }));
  const result = groupOpenClimbingCrags(input, 60);
  assert.ok(result.length >= 4);
  for (const p of result) assert.ok(p.topoRoutes <= 60);
  const ids = result.flatMap(p => p.members?.map(m => m.osmId) ?? [p.osmId]);
  assert.equal(ids.length, 20);
  assert.equal(new Set(ids).size, 20);
});

real('整份索引：每包不超過上限（單一岩場本身超過者除外）', () => {
  const grouped = groupOpenClimbingCrags(raw);
  for (const g of grouped) if (g.members) assert.ok(g.topoRoutes <= 100, g.name);
  const ids = grouped.flatMap(g => g.members?.map(m => m.osmId) ?? [g.osmId]);
  assert.equal(ids.length, raw.length);
  assert.equal(new Set(ids).size, raw.length);
});

test('岩場顯示名稱：純編號前面加上層區域，沒名稱用上層區域，位於已知地區再冠地區名', () => {
  const far = [4.7, 46.9];
  assert.equal(cragDisplayName('56', ['Rocher Canon'], [2.663, 48.462]), 'Fontainebleau · Rocher Canon 56');
  assert.equal(cragDisplayName('56', ['Melin'], far), 'Melin 56');
  assert.equal(cragDisplayName('Affensteine', ['Saxony'], far), 'Affensteine');
  assert.equal(cragDisplayName('', ['Gottardo', 'Suworrow'], far), 'Suworrow');
  assert.equal(cragDisplayName('', [], far), '');
  assert.equal(cragDisplayName('7', [], far), '7');
});

test('Fontainebleau 的大包名稱冠地區名，切開的帶第幾包', () => {
  const input = Array.from({ length: 12 }, (_, i) => ({
    osmId: i + 1, name: 'R' + i, country: 'fr', areaPath: ['Rocher Canon'], at: [2.663 + i * 0.001, 48.462], topoRoutes: 20,
  }));
  const names = groupOpenClimbingCrags(input, 100).map(p => p.name);
  assert.ok(names.length > 1);
  assert.ok(names.every(n => n.startsWith('Fontainebleau · Rocher Canon（')));
});

real('索引裡沒名稱也沒上層區域的岩場，都在 UNNAMED_PLACES 對照表裡', () => {
  for (const c of index?.crags ?? []) if (!c.n && !c.ap?.length) assert.ok(UNNAMED_PLACES[c.id], String(c.id));
});

test('一包的岩場數不超過 MAX_PACK_CRAGS（下載群組的上限），即使路線數很少', () => {
  const input = Array.from({ length: 100 }, (_, i) => ({
    osmId: i + 1, name: `B${i + 1}`, country: 'it', areaPath: ['A'], at: [12 + i * 0.0001, 46], topoRoutes: 1,
  }));
  const result = groupOpenClimbingCrags(input);
  assert.ok(result.every(x => (x.members?.length ?? 1) <= MAX_PACK_CRAGS));
  assert.equal(result.flatMap(x => x.members ?? [x]).length, 100);
});

test('同一區域岩場多但路線少（像 Yzeron - Historique）：合成一包，不切成（1/4）…', () => {
  const input = Array.from({ length: 35 }, (_, i) => ({
    osmId: i + 1, name: `Y${i + 1}`, country: 'fr', areaPath: ['Yzeron - Historique'], at: [4.6 + i * 0.0003, 45.7], topoRoutes: 2,
  }));
  const result = groupOpenClimbingCrags(input);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Yzeron - Historique');
});
