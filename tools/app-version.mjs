#!/usr/bin/env node
// 部署的版本號：只有「App 殼」的內容變了才換新版本號，改首頁、文件、網站頁面不會讓岩點貓、紅點貓、Studio 的使用者更新。
// 為什麼：Service Worker 用版本號當快取名，版本號一變，每個裝了的人都會重新預載整份檔案（見 appkit/sw.js）。
//
//   node tools/app-version.mjs --hash                 印出 App 殼的內容雜湊（build-site.sh 寫進 dist/shell.hash，部署後在 <網站>/shell.hash）
//   node tools/app-version.mjs <網站> <新版本號數字>   印出這次要用的版本號數字：線上 shell.hash 跟這次一樣就沿用線上的版本號，不一樣（或讀不到）就用新的
//     <網站>：climbio（正式版）、climbio-dev、climbio-eric
//
// 雜湊用 git 索引裡的檔案內容（git ls-files -s），不看工作目錄：部署前改寫 version.js、hold/index.html 的版本號不影響結果。
// 預設全部算進去，只排除明確不是 App 殼的路徑（文件、網頁、測試、工具、雲端函式…）：新增的資料夾不會被漏掉，最壞只是多換一次版本號。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/** 不是 App 殼的路徑：改這些不用讓 App 更新 */
export const NOT_SHELL = [
  /^(docs|guides|project|tests|tools|functions|extension|kits|proto|design|stats|gyms|lab|embed|social)\//,
  /^(en|zh-cn|ja|ko|fr|es|de)\//,                      // 首頁、專案頁等各語言的網頁（App 的語言包在 i18n/）
  /^(\.github|\.claude)\//,
  /^(holdkit|holdscan)\/functions\//,                  // 雲端函式
  /(^|\/)[^/]*\.md$/, /\.test\.(m?js)$/,
  /^[^/]+$/,                                           // 根目錄的檔案：只有下面這幾個是 App 用的
];
const ROOT_SHELL = new Set(['sw.js', 'site.js', 'host-redirect.js', 'home-reel.js']);
export const isShell = (path) => ROOT_SHELL.has(path) || !NOT_SHELL.some((re) => re.test(path));

/** lines：git ls-files -s 的輸出（每行 "模式 雜湊 階段\t路徑"）→ App 殼的內容雜湊 */
export function shellHash(lines) {
  const h = createHash('sha256');
  for (const line of lines.filter(Boolean)) {
    const [meta, path] = line.split('\t');
    if (isShell(path)) h.update(`${path}\0${meta.split(' ')[1]}\n`);
  }
  return h.digest('hex');
}
const gitLines = (cwd) => execFileSync('git', ['-c', 'core.quotepath=off', 'ls-files', '-s'], { cwd, encoding: 'utf8', maxBuffer: 64e6 }).split('\n').sort();

/** 線上網站的 { hash, number }（讀不到的欄位是 null） */
export async function live(site, get = fetch) {
  const host = `https://${site}.web.app`;
  const read = async (path) => { try { const r = await get(`${host}/${path}?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) }); return r.ok ? (await r.text()).trim() : null; } catch { return null; } };
  const [hash, versionJs] = await Promise.all([read('shell.hash'), read('version.js')]);
  const number = versionJs && /climbio-v(\d+)/.exec(versionJs)?.[1];
  return { hash: /^[0-9a-f]{64}$/.test(hash || '') ? hash : null, number: number ? Number(number) : null };
}
/** 這次要用的版本號數字：App 殼沒變就沿用線上的，不然用新的 */
export function pick({ now, fresh, online }) {
  return online.hash === now && online.number && online.number <= fresh ? online.number : fresh;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [a, b] = process.argv.slice(2);
  const now = shellHash(gitLines(process.cwd()));
  if (a === '--hash') { process.stdout.write(now + '\n'); }
  else if (/^(climbio|climbio-dev|climbio-eric)$/.test(a || '') && /^\d+$/.test(b || '')) {
    const online = await live(a);
    const n = pick({ now, fresh: Number(b), online });
    console.error(n === Number(b) ? `版本號 ${n}（App 殼有變動或線上讀不到）` : `版本號沿用線上的 ${n}（App 殼沒變）`);
    process.stdout.write(`${n}\n`);
  } else { console.error('用法：node tools/app-version.mjs --hash｜<climbio|climbio-dev|climbio-eric> <新版本號數字>'); process.exit(2); }
}
