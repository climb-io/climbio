import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// 岩館判斷（js/add-wall.js 的 photoGps（EXIF 用 AppKit.photo 讀）、gymAt）：照片裡的拍攝位置 → 300 公尺內最近的岩館
const source = readFileSync(new URL('../js/add-wall.js', import.meta.url), 'utf8');
const file = (url) => JSON.parse(readFileSync(new URL(url, new URL('../hold/', import.meta.url)), 'utf8'));   // 從岩點貓的頁面讀 ../gyms/index.json、../gyms/<國碼>.json
const AppKit = { photo: createRequire(import.meta.url)('../appkit/photo.js') };
const ctx = vm.createContext({ AppKit, fetch: async (url) => ({ ok: true, json: async () => file(url) }), t: (k) => k, DataView, String, Number, Math, Map, Set, Promise, Error });
vm.runInContext(source.slice(source.indexOf('  const GYM_NEAR'), source.indexOf('  // 裁切：原圖先縮到長邊')), ctx);
const gps = (buf) => ctx.photoGps({ slice: () => ({ arrayBuffer: async () => buf }) });   // 像照片檔：只讀開頭

// 做一張只有 EXIF 的 JPEG：IFD0 只有 GPS 指標，GPS IFD 有南北、緯度、東西、經度
function jpeg(lat, lon, { le = true, gps = true } = {}) {
  const b = new DataView(new ArrayBuffer(200)), w16 = (o, v) => b.setUint16(o, v, le), w32 = (o, v) => b.setUint32(o, v, le);
  const t = 12;   // TIFF 開頭：FFD8、FFE1、長度、"Exif\0\0"
  b.setUint16(0, 0xFFD8); b.setUint16(2, 0xFFE1); b.setUint16(4, 180); b.setUint32(6, 0x45786966);
  b.setUint16(t, le ? 0x4949 : 0x4D4D); w16(t + 2, 42); w32(t + 4, 8);
  w16(t + 8, 1); w16(t + 10, gps ? 0x8825 : 0x0110); w16(t + 12, 4); w32(t + 14, 1); w32(t + 18, 26);
  const g = 26, dms = (v) => { const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60); return [d, m, Math.round(((a - d) * 60 - m) * 60 * 10000)]; };
  const ent = (i, id, type, n, val) => { const e = t + g + 2 + i * 12; w16(e, id); w16(e + 2, type); w32(e + 4, n); if (type === 2) b.setUint8(e + 8, val.charCodeAt(0)); else w32(e + 8, val); };
  w16(t + g, 4);
  const rat = (o, v) => { const [d, m, s] = dms(v); w32(t + o, d); w32(t + o + 4, 1); w32(t + o + 8, m); w32(t + o + 12, 1); w32(t + o + 16, s); w32(t + o + 20, 10000); };
  ent(0, 1, 2, 2, lat < 0 ? 'S' : 'N'); ent(1, 2, 5, 3, 80); ent(2, 3, 2, 2, lon < 0 ? 'W' : 'E'); ent(3, 4, 5, 3, 104);
  rat(80, lat); rat(104, lon);
  return b.buffer;
}

test('讀得出照片的拍攝位置：Intel、Motorola 位元組順序，南緯西經是負的', async () => {
  for (const le of [true, false]) {
    const c = await gps(jpeg(25.10832, 121.51453, { le }));
    assert.ok(Math.abs(c.lat - 25.10832) < 1e-5 && Math.abs(c.lon - 121.51453) < 1e-5, JSON.stringify(c));
  }
  const s = await gps(jpeg(-33.8688, -151.2093));
  assert.ok(s.lat < 0 && s.lon < 0);
});

test('沒有位置：沒有 GPS 指標、不是 JPEG 都回 null', async () => {
  assert.equal(await gps(jpeg(25, 121, { gps: false })), null);
  assert.equal(await gps(new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]).buffer), null);
});

test('300 公尺內最近的岩館；太遠、沒有位置就是空的', async () => {
  assert.equal(await ctx.gymAt({ lat: 25.10832, lon: 121.51453 }), '原岩明德');   // iPhone 實測的照片，29 公尺
  assert.equal(await ctx.gymAt({ lat: 24.92988, lon: 121.50704 }), '');   // 6.6 公里外
  assert.equal(await ctx.gymAt(null), '');
});

test('台灣岩館的順序：從北到南，同系列整組放在最北那間的位置、組內從北到南；gyms/tw.json 照這個順序', async () => {
  const { northToSouth } = await import('./gym-order.mjs');
  const list = [{ name: '南', lat: 22 }, { name: '原岩新店', lat: 24.97, series: '原岩' }, { name: '北', lat: 25.2 }, { name: '紅石新竹', lat: 24.78, series: '紅石' },
    { name: '原岩明德', lat: 25.1, series: '原岩' }, { name: '紅石士林', lat: 25.08, series: '紅石' }, { name: '中', lat: 24.1 }];
  assert.deepEqual(northToSouth(list).map(g => g.name), ['北', '原岩明德', '原岩新店', '紅石士林', '紅石新竹', '中', '南']);
  const { readFileSync } = await import('node:fs');
  const src = JSON.parse(readFileSync(new URL('./gyms/tw.json', import.meta.url), 'utf8')), out = JSON.parse(readFileSync(new URL('../gyms/tw.json', import.meta.url), 'utf8'));
  assert.deepEqual(out.map(g => g[0]), northToSouth(src).map(g => g.name));
});
