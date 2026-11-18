// 紅點貓收藏：香港攀岩網站的轉接器（extension/hkclimbing.js）把讀到的頁面轉成 v2，通過 format 驗證
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { prepare } from '../extension/hkclimbing.js';
import { DIGIT_CELLS } from '../sourcekit/badge-digits.js';

const { validate } = createRequire(import.meta.url)('../format/format.js');

const PAGE = {
  url: 'https://hongkongclimbing.com/routes/x/', name: 'Fury Wall', sections: { description: '一面岩壁', approach: '沿海岸' },
  groups: ['Left'], photos: [{ url: 'https://i0.wp.com/hongkongclimbing.com/a.jpg', w: 2723, h: 1934, group: null }, { url: 'https://i0.wp.com/hongkongclimbing.com/b.jpg', w: 800, h: 600, group: 0 }, { url: 'https://i0.wp.com/hongkongclimbing.com/small.jpg', w: 700, h: 500, group: 0 }],
  routes: [{ num: '1', name: 'Point Break', grade: 'F6c', stars: 2, description: '動作', fa: 'F. Haden (2015)', group: 0 }, { num: '1', name: 'Sasquatch', grade: 'V6', stars: 3, description: '', fa: '', group: null }],
};

test('香港攀岩：路線、照片、預設岩壁、縮圖大小', async () => {
  const out = await prepare(PAGE, 1);
  const index = out.files.find(f => f.path === 'index.json').json, route = (n) => index.nodes.find(x => x.name === n);
  assert.deepEqual(validate(index), []);
  for (const f of out.files) assert.deepEqual(validate(f.json), [], f.path);
  assert.deepEqual(route('Point Break').props.grade, { french: '6c' });
  assert.equal(route('Point Break').props.fa, 'F. Haden (2015)');
  assert.equal(route('Sasquatch').props.style, 'boulder');
  assert.equal(route('Left').type, 'sector');
  assert.equal(index.nodes.filter(n => n.type === 'sector').length, 2);   // Left 和放沒有小標題內容的預設岩壁
  assert.deepEqual(out.photos.map(p => p.size), [{ w: 1600, h: 1136 }, { w: 800, h: 600 }]);
  assert.equal(out.photos.length, 2);   // 長邊 700 的太小，不收
  assert.equal(index.props.sourceLabel, 'Hong Kong Climbing');
  assert.equal((await prepare(PAGE, 2)).version, out.version);
});

/** 灰底的畫布上畫號碼牌（純色方塊加白色的字，字用樣板的格子） */
function canvasWith(w, h, badges) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([120, 118, 110, 255], i * 4);
  const box = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) data.set([...c, 255], (y * w + x) * 4); };
  for (const [x, y, text, color] of badges) {
    box(x, y, x + 60, y + 60, color);
    const g = DIGIT_CELLS[text], gw = Math.max(6, Math.round(22 * g.aspect)), ox = x + Math.round((60 - gw) / 2);
    for (let gy = 0; gy < 24; gy++) for (let gx = 0; gx < 16; gx++) if (parseInt(g.cells[gy * 16 + gx], 16) >= 8) box(ox + Math.floor((gx * gw) / 16), y + 14 + Math.floor((gy * 32) / 24), ox + Math.floor(((gx + 1) * gw) / 16) - 1, y + 14 + Math.floor(((gy + 1) * 32) / 24) - 1, [255, 255, 255]);
  }
  return { data, width: w, height: h };
}

test('香港攀岩：照片上印的號碼牌讀出來，對得上這一頁的路線才標成路線號碼（蓋在原牌子上、用原牌子的顏色）；號碼重複、對不上的不標', async () => {
  const page = { ...PAGE, groups: [], photos: [PAGE.photos[0]], routes: [
    { num: '1', name: '甲', grade: 'F6a', stars: 0, description: '', fa: '', group: null },
    { num: '2', name: '乙', grade: 'F6b', stars: 0, description: '', fa: '', group: null },
    { num: '3', name: '丙', grade: 'F6c', stars: 0, description: '', fa: '', group: null },
  ] };
  const out = await prepare(page, 1);
  const index = out.files.find(f => f.path === 'index.json').json, ids = Object.fromEntries(index.nodes.filter(n => n.type === 'route').map(n => [n.name, n.id]));
  // 牌子：1（橘）、2（綠）、2 又出現一次（重複）、9（這一頁沒有這條路線）；3 沒有牌子
  const image = canvasWith(1600, 1136, [[200, 900, '1', [240, 130, 30]], [500, 900, '2', [30, 160, 110]], [800, 900, '2', [30, 160, 110]], [1100, 900, '9', [240, 130, 30]]]);
  const extra = await out.annotate(new Map([[PAGE.photos[0].url, {}]]), async () => image);
  assert.equal(extra.files.length, 1);
  const layer = extra.files[0].json;
  assert.deepEqual(layer.marks.map(m => [m.node, m.props.label]), [[ids['甲'], '1']]);   // 2 重複、9 對不上都不標
  assert.deepEqual(layer.marks[0].geometry.coordinates, [231, 931]);
  assert.equal(layer.marks[0].props.size, 59);
  assert.match(layer.marks[0].props.style.stroke, /^#f0/);
  assert.equal(layer.on, out.files.find(f => f.json.kind === 'view').json.id);
  assert.deepEqual(extra.items, [{ href: extra.files[0].path, id: layer.id }]);
  assert.deepEqual(validate(layer), []);
});
