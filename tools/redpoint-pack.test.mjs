// 合併檔（pack.json）：發佈把所有 JSON 合起來，紅點貓匯入一次讀回，請求數從「每個檔案一次」降到幾次；
// 沒有 pack 的舊專案、pack 讀不到都照逐檔讀，結果一樣
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import AppKit from '../appkit/index.mjs';
import * as M from '../studio/crag/model.js';
import * as P from '../studio/crag/publish.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });   // 假的 fetch 只在這個測試裡有效，不留給同一個程序裡後面的測試
import { fromUrl, fromFiles } from '../redpoint/io.js';
globalThis.AppKit = AppKit;
await import('../i18n/studio-crag-data/zh.js');   // 岩壁名稱（cdWallN）在這個語言包；沒載入時 newBook／addPhoto 會取不到文字

const { validate } = createRequire(import.meta.url)('../format/format.js');
globalThis.ClimbioFormat = { validate };
globalThis.location = { href: 'https://x.test/redpoint/' };
const BASE = 'https://x.test/p/pack00000000001/';

/** 一本兩張照片、每張有特徵點檔的 Guidebook：{ plain, packed, a, b }，兩種發佈方式的 { files: Map<檔名, Uint8Array>, docs, images } */
async function published() {
  const state = M.newBook('測試岩場');
  state.book.attribution = 'KK';
  const a = M.newPhoto({ name: 'a', w: 640, h: 480, sha256: 'a'.repeat(64), raw: {} });
  const b = M.newPhoto({ name: 'b', w: 640, h: 480, sha256: 'b'.repeat(64), raw: {} });
  M.addPhoto(state, a);
  M.addPhoto(state, b);
  const docs = P.publishDocs(state, { validate });
  const images = [
    { path: a.href, blob: new Blob([new Uint8Array([0xff, 0xd8, 1])]) }, { path: b.href, blob: new Blob([new Uint8Array([0xff, 0xd8, 2])]) },
  ];
  const pack = async (d, i) => {
    const files = new Map();
    for (const { path, doc } of d) files.set(path, new TextEncoder().encode(JSON.stringify(doc)));
    for (const { path, blob } of i) files.set(path, new Uint8Array(await blob.arrayBuffer()));
    return { files, docs: d, images: i };
  };
  return { plain: await pack(docs, images), packed: await pack(...Object.values(await P.withPack(docs, images))), a, b };
}

/** 假的網站：照檔名回內容，記下被讀的網址；broken 裡的檔名回 404 */
function serve(files, broken = []) {
  const reads = [];
  globalThis.fetch = async (url) => {
    const name = String(url).slice(BASE.length);
    reads.push(name);
    const data = files.get(name);
    return data && !broken.includes(name) ? new Response(data) : new Response('no', { status: 404 });
  };
  return reads;
}

const photoBytes = (r) => Object.fromEntries([...r.photos].map(([id, blob]) => [id, blob.size]));

test('withPack：入口多 props.pack；只發佈入口和 pack.json，pack.json 有除了入口以外的每份 JSON；圖檔原樣回傳', async () => {
  const { plain, packed: { docs, images } } = await published();
  const entry = docs[0].doc, pack = docs.at(-1).doc;
  assert.equal(docs.length, 2, '只有入口和 pack.json');
  assert.deepEqual(entry.props.pack, { href: 'pack.json' });
  assert.equal(docs.at(-1).path, 'pack.json');
  assert.deepEqual(Object.keys(pack.docs), plain.docs.slice(1).map((d) => d.path));
  assert.equal(pack.features, undefined);
  assert.equal(images.length, 2);
  for (const doc of Object.values(pack.docs)) assert.deepEqual(validate(doc), []);
  assert.deepEqual(validate(entry), []);
});


test('匯入有 pack 的專案：JSON 不再逐檔讀，只讀入口、pack.json 和照片；結果跟逐檔讀的一樣', async () => {
  const { plain, packed: withPack } = await published();
  const readsPlain = serve(plain.files);
  const old = await fromUrl(`${BASE}index.json`);
  const readsPack = serve(withPack.files);
  const got = await fromUrl(`${BASE}index.json`);
  assert.equal(readsPack.filter((n) => n.endsWith('.json')).length, 2, '只有 index.json、pack.json');
  assert.ok(readsPack.length < readsPlain.length, `${readsPack.length} < ${readsPlain.length}`);
  assert.deepEqual(photoBytes(got), photoBytes(old));
  assert.deepEqual([...got.docs.keys()].sort(), [...old.docs.keys()].sort());
});

test('匯入：沒有 pack 的舊專案逐檔讀，照樣收齊；手機已經有的照片（keep）不下載', async () => {
  const { plain, packed: { files } } = await published();
  serve(plain.files);
  const got = await fromUrl(`${BASE}index.json`);
  assert.equal(got.photos.size, 2);
  const reads = serve(files);
  const kept = await fromUrl(`${BASE}index.json`, { keep: async () => true });
  assert.equal(kept.photos.size, 0);
  assert.ok(!reads.some((n) => /^[0-9a-z]{16}\.jpg$/.test(n)));
});

test('從檔案匯入（擴充收藏的 ZIP）：合併檔 pack.json 不是 Climbio 文件，不檢查、不列為有問題', async () => {
  const { packed: { files } } = await published();
  assert.ok(files.has('pack.json'));
  const got = await fromFiles([...files].map(([name, bytes]) => new File([bytes], name, { type: name.endsWith('.json') ? 'application/json' : 'image/jpeg' })));
  assert.deepEqual(got.skipped, []);
  assert.equal(got.root.kind, 'set');
  assert.equal(got.photos.size, 0);   // 打包後的照片檔名與畫面的 href 不同層級時不在這裡驗證，這裡只管 pack.json
});
