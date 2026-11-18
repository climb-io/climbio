import test from 'node:test';
import { previewProps } from '../sourcekit/preview-sheet.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { loadAreas, prepare, discover } from '../extension/climbio-site.js';

const { validate } = createRequire(import.meta.url)('../format/format.js');
const DIR = new URL('../tests/author/longdong/', import.meta.url);
/** 龍洞的公開資料（測試用的一份）：照網址最後的檔名讀 */
const get = async (url) => JSON.parse(fs.readFileSync(new URL(url.split('/').pop(), DIR), 'utf8'));
const ROOT = 'https://longdong.web.app/climbio/longdong.json';
const clone = (x) => structuredClone(x);

test('讀出口有哪些區，各區有幾張 Topo（有畫線的照片）', async () => {
  const areas = await loadAreas({ get, root: ROOT });
  assert.ok(areas.length >= 1);
  const gate = areas.find((a) => a.id === '8fvwwwwu33h0ou39');
  assert.equal(gate.name, '校門口');
  assert.equal(gate.views.length, 2);
  assert.equal(gate.topos, 2);
  assert.ok(areas.every((a) => a.topos <= a.views.length));
});

test('一個區要存的東西：index.json 加入口小圖、Topo 的照片和圖層原樣，照片網址是絕對的；都過 validate', async () => {
  const areas = await loadAreas({ get, root: ROOT });
  const out = await prepare(areas.find((a) => a.id === '8fvwwwwu33h0ou39'));
  assert.deepEqual(out.files.map((f) => f.path).sort(), ['2e26idbcphon06ov.json', '5jm32u7rwub1me46.json', 'index.json', 'lisp3mi8clzxhqmo.json', 'wi8csu5srq8qmox4.json']);
  const index = out.files.find((f) => f.path === 'index.json').json;
  assert.deepEqual(index.props.preview, previewProps(2));
  assert.equal(index.props.thumb, undefined, '不另存縮圖：只有合成預覽圖');
  assert.deepEqual(index.items.filter((i) => i.props?.tile != null).map((i) => i.props.tile), [0, 1], '照片在預覽圖上的格子');
  assert.equal(index.items.length, 4);
  for (const f of out.files) assert.deepEqual(validate(f.json), [], f.path);
  assert.deepEqual(out.photos.map((p) => p.url), ['https://longdong.web.app/climbio/lisp3mi8clzxhqmo.webp', 'https://longdong.web.app/climbio/2e26idbcphon06ov.webp']);
  assert.deepEqual(out.sheet, { path: 'preview.jpg', urls: out.photos.map((p) => p.url) });
  const views = out.files.filter((f) => f.json.kind === 'view');
  assert.ok(views.every((v) => v.json.origin === 'self'), '網站自己的照片，紅點貓可以分享');
});

test('沒有 Topo 的不收：沒有畫線的照片連同圖層、地圖都拿掉；整區都沒有就沒有照片、沒有入口小圖', async () => {
  const areas = await loadAreas({ get, root: ROOT });
  const gate = clone(areas.find((a) => a.id === '8fvwwwwu33h0ou39'));
  const layer = gate.docs.find((d) => d.doc.kind === 'layer');
  layer.doc.marks = [];   // 第一張的圖層沒有畫線
  const view = gate.docs.find((d) => d.doc.id === layer.doc.on);
  const out = await prepare(gate);
  assert.ok(!out.files.some((f) => f.path === view.href || f.path === layer.href), '沒有線的照片和它的圖層都不收');
  assert.equal(out.photos.length, 1);

  const none = areas.find((a) => a.topos === 0);
  if (none) {
    const empty = await prepare(none);
    assert.deepEqual([empty.photos, empty.sheet], [[], null]);
    assert.equal('props' in empty.files[0].json && empty.files[0].json.props?.preview, false);
  }
});

test('內容指紋：同樣的資料永遠一樣，資料一變（新增一條線）就不一樣', async () => {
  const areas = await loadAreas({ get, root: ROOT });
  const gate = areas.find((a) => a.id === '8fvwwwwu33h0ou39');
  const a = (await prepare(gate)).version, b = (await prepare(gate)).version;
  assert.match(a, /^[0-9a-f]{24}$/);
  assert.equal(a, b);
  const changed = clone(gate);
  const l = changed.docs.find((d) => d.doc.kind === 'layer');
  l.doc.marks.push({ geometry: { type: 'LineString', coordinates: [[1, 1], [2, 2]] } });
  assert.notEqual((await prepare(changed)).version, a);
});

test('找支援紅點貓收藏的頁面：<link rel="climbio"> 的絕對網址，只收 https', (t) => {
  // 測試檔共用一個程序（--experimental-test-isolation=none）：結束時還原全域的 location、document，不能刪掉別的測試檔設的
  const saved = { location: globalThis.location, document: globalThis.document };
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; } });
  const page = (href, base = 'https://longdong.web.app/about') => {
    globalThis.location = { href: base };
    globalThis.document = { querySelector: () => (href == null ? null : { getAttribute: () => href }) };
    return discover();
  };
  assert.equal(page('/climbio/longdong.json'), 'https://longdong.web.app/climbio/longdong.json');
  assert.equal(page('https://example.com/c.json'), 'https://example.com/c.json');
  assert.equal(page('http://example.com/c.json'), null, '不是 https 不收');
  assert.equal(page('javascript:alert(1)'), null);
  assert.equal(page(null), null, '沒有 link 就是不支援');
});

test('入口底下沒有再分區、照片直接放在入口：入口自己是一個區', async () => {
  const root = 'https://example.com/c/index.json';
  const docs = {
    [root]: { climbio: 2, kind: 'set', id: 'rootrootrootroot', name: '小岩場', items: [{ href: 'v.json' }, { href: 'l.json' }] },
    'https://example.com/c/v.json': { climbio: 2, kind: 'view', surface: 'photo', id: 'viewviewviewview', href: 'v.jpg', w: 10, h: 10, mime: 'image/jpeg' },
    'https://example.com/c/l.json': { climbio: 2, kind: 'layer', id: 'layerlayerlayerr', on: 'viewviewviewview', marks: [{ geometry: { type: 'LineString', coordinates: [[1, 1], [2, 2]] } }] },
  };
  const areas = await loadAreas({ root, get: async (u) => docs[u] });
  assert.equal(areas.length, 1);
  assert.equal(areas[0].topos, 1);
});
