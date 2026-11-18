import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// routekit／holdkit／format／appkit 的 npm 套件：import、require 拿到一樣的東西，型別檔宣告了每個匯出，伺服器端（沒有 DOM）載入不會壞
const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, root), 'utf8');
const pkgs = [
  { dir: 'routekit', cjs: 'routekit/index.js', esm: 'routekit/index.mjs', dts: 'routekit/index.d.ts' },
  { dir: 'holdkit', cjs: 'holdkit/holdkit.js', esm: 'holdkit/index.mjs', dts: 'holdkit/index.d.ts' },
  { dir: 'format', cjs: 'format/format.js', esm: 'format/index.mjs', dts: 'format/index.d.ts' },
  { dir: 'appkit', cjs: 'appkit/index.js', esm: 'appkit/index.mjs', dts: 'appkit/index.d.ts' },
];

for (const p of pkgs) {
  test(`${p.dir}：ESM 的具名匯出跟 require 的一樣，型別檔都有宣告`, async () => {
    const cjs = require(fileURLToPath(new URL(p.cjs, root))), esm = await import(new URL(p.esm, root));
    assert.deepEqual(Object.keys(esm).filter(k => k !== 'default').sort(), Object.keys(cjs).sort());
    assert.equal(esm.default, cjs);
    const dts = read(p.dts);
    for (const k of Object.keys(cjs)) assert.match(dts, new RegExp(`export (declare )?(function|const|class|type|interface) ${k}\\b`), `${p.dts} 少了 ${k}`);
  });
  test(`${p.dir}：package.json 列的檔案都在`, () => {
    const pkg = JSON.parse(read(`${p.dir}/package.json`));
    for (const f of pkg.files.filter(f => !f.includes('*'))) assert.ok(fs.existsSync(new URL(`${p.dir}/${f}`, root)), `${p.dir}/${f}`);
    for (const e of Object.values(pkg.exports).flatMap(v => typeof v === 'string' ? [v] : Object.values(v)).filter(v => !v.includes('*')))
      assert.ok(fs.existsSync(new URL(`${p.dir}/${e}`, root)), `${p.dir}/${e}`);
  });
}

test('holdkit 套件的版本跟 holdkit.js 的 VERSION 一樣', () => {
  assert.equal(JSON.parse(read('holdkit/package.json')).version, require(fileURLToPath(new URL('holdkit/holdkit.js', root))).VERSION);
});

test('伺服器端載入 Web Component、MobileSAM 重描不會壞', () => {
  assert.deepEqual(require(fileURLToPath(new URL('routekit/elements.js', root))), {});
  require(fileURLToPath(new URL('holdkit/samrefine.js', root)));
  assert.equal(typeof globalThis.HoldRefiner.configure, 'function');
});

// topokit：純 ES module（沒有 require 入口），型別檔宣告了每個匯出，package.json 列的檔案都在，伺服器端（沒有 DOM）載入不會壞
test('topokit：型別檔宣告了每個匯出', async () => {
  const esm = await import(new URL('topokit/index.js', root));
  const dts = read('topokit/index.d.ts');
  for (const k of Object.keys(esm)) assert.match(dts, new RegExp(`export (declare )?(function|const|class|type|interface) ${k}\\b`), `topokit/index.d.ts 少了 ${k}`);
});

test('topokit：package.json 列的檔案都在，授權檔齊全', () => {
  const pkg = JSON.parse(read('topokit/package.json'));
  assert.equal(pkg.type, 'module');
  for (const f of pkg.files.filter(f => !f.includes('*'))) assert.ok(fs.existsSync(new URL(`topokit/${f}`, root)), `topokit/${f}`);
  for (const e of Object.values(pkg.exports).flatMap(v => typeof v === 'string' ? [v] : Object.values(v)).filter(v => !v.includes('*')))
    assert.ok(fs.existsSync(new URL(`topokit/${e}`, root)), `topokit/${e}`);
  assert.match(read('topokit/NOTICE'), /MIT License/, 'NOTICE 要保留龍洞的 MIT 聲明');
});

test('伺服器端載入 topokit 的 Web Component 不會壞', async () => {
  assert.equal((await import(new URL('topokit/element.js', root))).TopoElement, undefined);
});

// topokit 自己的單元測試（v2 資料進出、共用線段、縮放）
await import(new URL('topokit/test/unit.test.mjs', root));

// crag3dkit：同 topokit 的做法（純 ES module、型別檔、授權檔、伺服器端載入）；播放器靠 WebGL，在瀏覽器測
test('crag3dkit：型別檔宣告了每個匯出', async () => {
  const esm = await import(new URL('crag3dkit/index.js', root));
  const dts = read('crag3dkit/index.d.ts');
  for (const k of Object.keys(esm)) assert.match(dts, new RegExp(`export (declare )?(function|const|class|type|interface) ${k}\\b`), `crag3dkit/index.d.ts 少了 ${k}`);
});

test('crag3dkit：package.json 列的檔案都在，授權檔齊全', () => {
  const pkg = JSON.parse(read('crag3dkit/package.json'));
  assert.equal(pkg.type, 'module');
  for (const f of pkg.files.filter(f => !f.includes('*') && !f.endsWith('/'))) assert.ok(fs.existsSync(new URL(`crag3dkit/${f}`, root)), `crag3dkit/${f}`);
  for (const e of Object.values(pkg.exports).flatMap(v => typeof v === 'string' ? [v] : Object.values(v)).filter(v => !v.includes('*')))
    assert.ok(fs.existsSync(new URL(`crag3dkit/${e}`, root)), `crag3dkit/${e}`);
  assert.match(read('crag3dkit/vendor/three-splat-LICENSE.txt'), /three\.js/, '要保留 three.js 的 MIT 授權');
  assert.match(read('crag3dkit/vendor/three-splat-LICENSE.txt'), /Spark|spark/, '要保留 Spark 的 MIT 授權');
});

test('crag3dkit：不 import 別的 Kit 和 App', () => {
  for (const f of ['index', 'player', 'read', 'sight', 'text', 'style']) {
    const code = read(`crag3dkit/${f}.js`);
    assert.doesNotMatch(code, /from ['"]\.\.\//, `crag3dkit/${f}.js 不可以 import Kit 外面的檔案`);
  }
});

// crag3dkit 自己的單元測試（讀格式、遮擋表、名稱與難度）
await import(new URL('crag3dkit/test/unit.test.mjs', root));

// wall3dkit：同 crag3dkit 的做法；繪製、沿牆鏡頭靠 WebGL，沒有自動的瀏覽器案例
test('wall3dkit：型別檔宣告了每個匯出', async () => {
  const esm = await import(new URL('wall3dkit/index.js', root));
  const dts = read('wall3dkit/index.d.ts');
  for (const k of Object.keys(esm)) assert.match(dts, new RegExp(`export (declare )?(function|const|class|type|interface) ${k}\\b`), `wall3dkit/index.d.ts 少了 ${k}`);
});

test('wall3dkit：package.json 列的檔案都在，授權檔齊全', () => {
  const pkg = JSON.parse(read('wall3dkit/package.json'));
  assert.equal(pkg.type, 'module');
  for (const f of pkg.files.filter(f => !f.includes('*') && !f.endsWith('/'))) assert.ok(fs.existsSync(new URL(`wall3dkit/${f}`, root)), `wall3dkit/${f}`);
  for (const e of Object.values(pkg.exports).flatMap(v => typeof v === 'string' ? [v] : Object.values(v)).filter(v => !v.includes('*')))
    assert.ok(fs.existsSync(new URL(`wall3dkit/${e}`, root)), `wall3dkit/${e}`);
  assert.match(read('wall3dkit/vendor/three-LICENSE.txt'), /three\.js authors/, '要保留 three.js 的 MIT 授權');
  assert.match(read('wall3dkit/vendor/three-LICENSE.txt'), /Garrett Johnson/, '要保留 three-mesh-bvh 的 MIT 授權');
});

test('wall3dkit：不 import 別的 Kit 和 App', () => {
  for (const f of ['index', 'stage', 'walkcam', 'bake', 'bakepack']) {
    const code = read(`wall3dkit/${f}.js`);
    assert.doesNotMatch(code, /from ['"]\.\.\//, `wall3dkit/${f}.js 不可以 import Kit 外面的檔案`);
    assert.doesNotMatch(code, /import\(['"`]\.\.\//, `wall3dkit/${f}.js 不可以 import Kit 外面的檔案`);
  }
});

// wall3dkit 自己的單元測試（外框幾何、沿牆鏡頭的成品包、打包的匯出、烘焙）
await import(new URL('wall3dkit/test/unit.test.mjs', root));
await import(new URL('wall3dkit/test/bake.test.mjs', root));

// mapkit：同 topokit 的做法（純 ES module、型別檔、授權檔、伺服器端載入）
test('mapkit：型別檔宣告了每個匯出', async () => {
  const esm = await import(new URL('mapkit/index.js', root));
  const dts = read('mapkit/index.d.ts');
  for (const k of Object.keys(esm)) assert.match(dts, new RegExp(`export (declare )?(function|const|class|type|interface) ${k}\\b`), `mapkit/index.d.ts 少了 ${k}`);
});

test('mapkit：package.json 列的檔案都在，授權檔齊全', () => {
  const pkg = JSON.parse(read('mapkit/package.json'));
  assert.equal(pkg.type, 'module');
  for (const f of pkg.files.filter(f => !f.includes('*'))) assert.ok(fs.existsSync(new URL(`mapkit/${f}`, root)), `mapkit/${f}`);
  for (const e of Object.values(pkg.exports).flatMap(v => typeof v === 'string' ? [v] : Object.values(v)).filter(v => !v.includes('*')))
    assert.ok(fs.existsSync(new URL(`mapkit/${e}`, root)), `mapkit/${e}`);
  assert.match(read('mapkit/NOTICE'), /MIT License/, 'NOTICE 要保留龍洞的 MIT 聲明');
});

test('伺服器端載入 mapkit 的 Web Component 不會壞', async () => {
  assert.equal((await import(new URL('mapkit/element.js', root))).MapElement, undefined);
});

// mapkit 自己的單元測試（v2 資料讀取、畫面、岩壁朝向）
await import(new URL('mapkit/test/unit.test.mjs', root));
