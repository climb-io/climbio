// 重建 vendor/three.js：three.js 0.180.0（含 GLTFLoader）與 three-mesh-bvh 0.9.18 用 esbuild 打包成單一 ES module，只匯出 NAMES。
// NAMES 是 Wall3DKit 自己（stage.js、walkcam.js、bakepack.js）加上使用方（例如 3D 牆的編輯器）要的名稱：同一頁只載一份 three.js。
// 用法：node wall3dkit/build-vendor.mjs [輸出檔]（預設 vendor/three.js；要連網下載套件，在暫存資料夾裡裝，不動專案的 node_modules）。
// 換版本時改下面的 THREE、BVH，並更新 vendor/three-LICENSE.txt 的授權全文與版本。
// English: rebuild vendor/three.js (three.js + GLTFLoader + three-mesh-bvh bundled with esbuild, exporting NAMES only). Needs network.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const THREE = '0.180.0', BVH = '0.9.18';
export const NAMES = ['Box3', 'BufferAttribute', 'BufferGeometry', 'Color', 'DataTexture', 'DoubleSide', 'Float32BufferAttribute', 'GLTFLoader', 'LinearFilter',
  'MathUtils', 'Matrix4', 'Mesh', 'MeshBVH', 'MeshBasicMaterial', 'NearestFilter', 'OrthographicCamera', 'PerspectiveCamera', 'PlaneGeometry', 'Quaternion',
  'Raycaster', 'RedFormat', 'SRGBColorSpace', 'Scene', 'ShaderMaterial', 'UnsignedByteType', 'Vector2', 'Vector3', 'WebGLRenderTarget', 'WebGLRenderer', 'acceleratedRaycast'];
const FROM = { GLTFLoader: 'three/examples/jsm/loaders/GLTFLoader.js', MeshBVH: 'three-mesh-bvh', acceleratedRaycast: 'three-mesh-bvh' };

if (import.meta.url === `file://${process.argv[1]}`) {
  const here = path.dirname(new URL(import.meta.url).pathname), out = path.resolve(process.argv[2] || path.join(here, 'vendor/three.js'));
  // Kit 自己 import 的名稱都要在 NAMES 裡
  for (const f of ['stage.js', 'walkcam.js', 'bakepack.js']) {
    const m = readFileSync(path.join(here, f), 'utf8').match(/import \{([^}]+)\} from '\.\/vendor\/three\.js'/);
    for (const n of m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : []) if (!NAMES.includes(n)) throw new Error(`${f} 用到的 ${n} 不在 NAMES`);
  }
  const groups = {};
  for (const n of NAMES) (groups[FROM[n] ?? 'three'] ??= []).push(n);
  const dir = mkdtempSync(path.join(tmpdir(), 'wall3dkit-vendor-'));
  const run = (cmd, args) => execFileSync(cmd, args, { cwd: dir, stdio: 'inherit' });
  writeFileSync(path.join(dir, 'package.json'), '{"name":"vendor-build","private":true,"type":"module"}\n');
  run('npm', ['install', '--no-audit', '--no-fund', `three@${THREE}`, `three-mesh-bvh@${BVH}`, 'esbuild']);
  writeFileSync(path.join(dir, 'entry.js'), Object.entries(groups).map(([from, list]) => `export { ${list.join(', ')} } from '${from}';`).join('\n') + '\n');
  run('npx', ['esbuild', 'entry.js', '--bundle', '--format=esm', '--minify', '--outfile=out.js']);
  copyFileSync(path.join(dir, 'out.js'), out);
  console.log(`${out} 已重建（three ${THREE}、three-mesh-bvh ${BVH}，匯出 ${NAMES.length} 個名稱）。確認 vendor/three-LICENSE.txt 的版本與授權全文，再實際打開一面 3D 牆。`);
}
