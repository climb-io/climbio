// Studio 任務的統一入口：node tools/studio.mjs start <gym|crag|book|3d> <資料夾> [輸入…]
// 入口頁「交給 AI」的四句話都從這裡開始；任何代理照它印的做，不用自己猜該讀哪份文件。
// 做法跟 wall-batch.mjs next 一樣：看資料夾做到哪，印出下一步要跑的指令、完成的標準、人只答哪些題；做不到的照實說卡在哪。
// 這裡只判斷狀態與印指令（plan 是純函式，有測試）；岩館牆面直接交給 wall-batch.mjs next。
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const TYPES = {
  gym: '岩館牆面照片 → 岩點檔',
  crag: '老岩場路線書（檔案、網頁）→ 手機上好讀的紅點貓格式（Guidebook）',
  book: '路線書（Word、PDF、網頁）→ Guidebook',
  '3d': '3D 牆的工作資料夾（wall.json）→ 發佈',
};

/** 所有任務共通的收工標準與回報（每次都印） */
export const DONE = [
  '最大原則：AI 把工作完整做完，最後結果交給人驗收。完成的標準：AI 能判斷的都自己判斷到底（看不準就放大照片再看，定案），不留「請人複核」的清單；人只答 `node tools/studio.mjs ask <專案> --human` 列出的題（通常只有「要不要公開發佈」、岩場位置、照片明顯不夠要不要補拍）。',
  '驗收要讓人在原本的 AI App 直接看：已部署雲端的給測試站網址；沒部署的在本機開伺服器給 http://127.0.0.1:<埠>/… 連結（3D 牆用 try3d）；單頁能看完的整理成單檔發成 Artifact。連結先自己打開驗證，寫清楚是哪一版（docs/agent-acceptance.md）。',
  '回報最前面寫：驗收連結、最終數量或結果、專案資料夾的完整路徑；等人答的題放後面；做不到的寫「卡在：…」，不要編造結果、不要說「已完成」。',
];

/**
 * 依任務類型與資料夾狀態算下一步。
 * @param {{type: string, dir: string, inputs: string[], exists: (p: string) => boolean}} o
 * @returns {{lines: string[], run?: string[]}}  run：要代為執行的命令（不給就只印 lines）
 */
export function plan({ type, dir, inputs = [], exists }) {
  const has = (...p) => exists(join(dir, ...p));
  const q = (s) => (/\s/.test(s) ? JSON.stringify(s) : s);
  const photos = inputs.length ? inputs.map(q).join(' ') : '<照片…>';
  const L = [];
  if (!TYPES[type]) return { lines: [`不認得任務類型「${type}」。可用：${Object.keys(TYPES).join('、')}`] };
  L.push(`任務：${TYPES[type]}　資料夾：${dir}`);

  if (type === 'gym') {
    if (hasWalls(exists, dir)) return { lines: L.concat(DONE), run: ['wall-batch.mjs', 'next', dir] };   // 做過的資料夾：next 印現在做到哪
    if (!inputs.length) L.push(`還沒有任何牆：把牆面照片的路徑接在後面再跑一次：node tools/studio.mjs start gym ${q(dir)} <照片…>`);
    else L.push(`下一步：node tools/wall-batch.mjs run ${q(dir)} ${photos}`, `之後每一步都只跑：node tools/wall-batch.mjs next ${q(dir)}（它會印下一步和判斷準則）；做完的標準只有一個：node tools/wall-batch.mjs verify ${q(dir)} 通過。規則在 docs/studio-wall.md「代理做牆面」。`);
    return { lines: L.concat(DONE) };
  }

  if (type === 'book') {
    if (has('index.json')) return { lines: L.concat('包已建好：接手、答題、發佈照 status 的「下一步」。', ...DONE), run: ['studio.mjs', 'status', dir] };
    if (has('.studio', 'source', 'outline.md')) {
      L.push(`下一步：node tools/studio.mjs convert ${q(dir)} build [原圖…]（大綱有問題先改 .studio/source/outline.md；問題清單用 node tools/guidebook.mjs check ${q(join(dir, '.studio', 'source', 'outline.md'))}）`);
    } else {
      const src = inputs.length ? inputs.map(q).join(' ') : '<路線書…>';
      L.push(`下一步：node tools/studio.mjs convert ${q(dir)} read ${src}`, '讀出大綱後請照 `node tools/guidebook.mjs prompt` 的提示把它整理好，再 build。');
    }
    L.push('建好後跑：node tools/studio.mjs status ' + q(dir) + '（題目、下一步）；發佈用 node tools/guidebook.mjs publish，需要人核准這一版。');
    return { lines: L.concat(DONE) };
  }

  if (type === '3d') {
    if (has('wall.json')) return { lines: L.concat('3D 牆工作資料夾已有 wall.json：照 status 的「下一步」做（look3d 逐顆看、review3d 記判斷、try3d 給人試用、publish）。', ...DONE), run: ['studio.mjs', 'status', dir] };
    L.push('卡在：資料夾裡沒有 wall.json。3D 牆要先有「3D 重建流程」的輸出（`climbio-3d-wall/1` 資料夾），這個倉庫的命令列不負責從影片或照片重建。',
      '做法：請使用者提供已重建好的資料夾；若是從已發佈的牆接手，用 `node tools/studio.mjs fetch3d <資料夾> <公開版本 id>`。不要用別的方式編造模型。');
    return { lines: L.concat(DONE) };
  }

  // crag：老岩場資料 → 紅點貓格式（Guidebook v2）。有路線書的檔案、網頁或大綱就走轉換流程；只有照片沒有任何文字資料，轉換沒有東西可讀
  if (has('index.json') || has('.studio', 'source', 'outline.md') || inputs.some(x => !IMAGE.test(x))) return plan({ type: 'book', dir, inputs, exists });
  L.push('目前不支援：只有照片、沒有路線書的檔案或網頁（照片不能由命令列自動分岩壁、描路線）。',
    '請使用者提供舊路線書的檔案（Word、PDF）或網頁連結，再跑 `start crag <資料夾> <檔案或網址>`；先不要自己用照片硬做。如實告訴使用者這點，不要說已完成。');
  return { lines: L.concat(DONE) };
}

const IMAGE = /\.(jpe?g|png|heic|webp)$/i;
const hasWalls = (exists, dir) => exists(join(dir, 'walls')) || ['run.json', 'questions.json'].some(f => exists(join(dir, f)));
export const fsExists = existsSync;
