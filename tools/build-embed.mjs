// 產生內嵌頁自給自足的資料夾：把各 Kit 的檔案與 embed/shared/ 複製到 embed/<kit>/v1/kit/，內嵌頁全用相對路徑，
// 整個資料夾放到任何靜態主機都能跑（見 docs/embed.md）。產物會提交，改了 Kit 或共用程式跑 node tools/build-embed.mjs；
// --check 只檢查產物有沒有跟上（測試用）。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
/** 每個內嵌頁需要的檔案：[來源, 複製到 kit/ 的檔名]。檔名要跟該頁 index.html 的 <script> 一樣 */
export const KITS = {
  routekit: [
    ['format/format.js', 'format.js'],
    ...['geometry', 'labels', 'base', 'scene', 'image', 'fit', 'editor', 'viewport', 'viewer', 'ui'].map(n => [`routekit/${n}.js`, `${n}.js`]),
    ['routekit/format.js', 'routekit-format.js'],
    ['embed/shared/embed.js', 'embed.js'],
    ['routekit/LICENSE', 'LICENSE'], ['routekit/NOTICE', 'NOTICE'],
  ],
  // 牆發佈：照片 → 在瀏覽器偵測岩點（holdscan 的 Worker 用相對路徑載入 ../../holdkit/ort.js、../core/detect-core.js，所以保留資料夾結構）→ 打包成牆 → 發佈；
  // 也收精修後的 walls.zip（解 ZIP 用 appkit 的 files.js）
  wallpublish: [
    ['format/format.js', 'format.js'], ['appkit/files.js', 'files.js'], ['appkit/photo.js', 'photo.js'], ['routekit/format.js', 'routekit-format.js'], ['embed/shared/embed.js', 'embed.js'],
    ['holdkit/holdkit.js', 'holdkit/holdkit.js'], ['holdkit/ort.js', 'holdkit/ort.js'],
    ['holdscan/browser/holdscan.js', 'holdscan/browser/holdscan.js'], ['holdscan/browser/worker.js', 'holdscan/browser/worker.js'], ['holdscan/core/detect-core.js', 'holdscan/core/detect-core.js'],
    ['LICENSE', 'LICENSE'], ['NOTICE', 'NOTICE'],
  ],
};

/** 每個 Kit 的內嵌頁資料夾（版本）：同一份 Kit 檔案複製到每個資料夾的 kit/ */
export const PAGES = { routekit: ['routekit/v2'], wallpublish: ['wallpublish/v1'] };

export function outputs() {
  const out = [];
  for (const [kit, files] of Object.entries(KITS)) for (const dir of PAGES[kit]) for (const [src, name] of files) out.push({ path: `embed/${dir}/kit/${name}`, bytes: readFileSync(new URL(src, root)) });
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check'), stale = [];
  for (const { path, bytes } of outputs()) {
    const file = new URL(path, root);
    if (check) { if (!existsSync(file) || !readFileSync(file).equals(bytes)) stale.push(path); continue; }
    mkdirSync(new URL('./', file), { recursive: true }); writeFileSync(file, bytes);
  }
  if (stale.length) { console.error(`內嵌頁的 kit/ 沒跟上，執行 node tools/build-embed.mjs：\n${stale.join('\n')}`); process.exit(1); }
  console.log(check ? '內嵌頁的 kit/ 是最新的' : '已產生內嵌頁的 kit/');
}
