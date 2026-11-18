// 天然岩場（Guidebook）發佈到開放資料集 climbio/crags 的純函式：檢查檔案清單、算要提交什麼、目錄的一行（crags.jsonl）。
// 伺服器的流程在 projects.js 的 prepare（取上傳網址）與 publish（hf: true，提交）：
//   1. 瀏覽器算每個檔案的 sha256，問 prepare：二進位檔（照片）要傳的回 Hub 的 LFS 上傳網址，瀏覽器直接傳給 Hub（不經過函式，大岩場幾十到幾百 MB 也行）；
//   2. publish：JSON 直接帶在請求裡（b64），照片只帶 sha256 與大小；伺服器一次 commit：改過的 JSON、照片指標、拿掉的檔案、目錄。沒改的不送。
// 三種開放資料集（專案 type 對到倉庫）：guidebook → climbio/crags（天然岩場）、wall3d → climbio/walls3d（室內 3D 牆）、crag3d → climbio/crags3d（天然岩場的 3D 模型，格式同 3D 牆）；專案 type 維持單數，倉庫跟 walls、crags 一樣用複數。
// 資料夾 {dir}{id}/ 網址固定（紅點貓收過的岩場回來檢查更新用同一個網址），不分版本，歷史在 git。
const { createHash } = require('node:crypto');

const LICENSE = 'CC-BY-SA-4.0';
/** type → { repo（Hub 倉庫）, name（專案文件 hf.repo 的簡稱）, dir（倉庫裡的資料夾）, index（目錄檔）, file/total（單檔與整包的上限，位元組） }；3D 模型很大，上限放寬（照片、模型都由瀏覽器直接傳給 Hub） */
const KINDS = {
  guidebook: { repo: 'climbio/crags', name: 'crags', dir: 'crags/', index: 'crags.jsonl', file: 25e6, total: 600e6 },
  wall3d: { repo: 'climbio/walls3d', name: 'walls3d', dir: 'walls3d/', index: 'walls3d.jsonl', file: 400e6, total: 1.5e9, bin: true },
  crag3d: { repo: 'climbio/crags3d', name: 'crags3d', dir: 'crags3d/', index: 'crags3d.jsonl', file: 400e6, total: 1.5e9, bin: true },
};
const REPO = KINDS.guidebook.repo, INDEX = KINDS.guidebook.index, DIR = KINDS.guidebook.dir;
const MAX = { json: 8e6, prepareDaily: 2e9 };
const kindOf = type => KINDS[type] || null;
const sha1 = s => createHash('sha1').update(s).digest('hex');
const isText = mime => mime === 'application/json';
const isImage = path => /\.(jpe?g|png|webp)$/i.test(path);

/** 檢查並整理發佈的檔案清單（要有入口、路徑、種類、sha256、大小；JSON 要帶內容）：回 [{ path, mime, sha256, size, text, bytes? }]；fail(status, msg) 由呼叫的人給 */
function checkHfFiles(files, { fail, mimeOf, PATH, SHA, ENTRY, maxFiles, kind = KINDS.guidebook }) {
  if (!Array.isArray(files) || !files.length || files.length > maxFiles) throw fail(400, 'bad files');
  const seen = new Set();
  let total = 0;
  const out = files.map(f => {
    const path = f && f.path;
    if (typeof path !== 'string' || !PATH.test(path) || path.includes('..') || seen.has(path)) throw fail(400, `bad path ${path}`);
    seen.add(path);
    const mime = mimeOf(path);
    if (!mime || (mime === 'application/octet-stream' && !kind.bin)) throw fail(400, `bad type ${path}`);   // 3D 的成品有 .bin（面標籤、岩點標籤、疊圖），岩場照片沒有
    if (!SHA.test(f.sha256 || '')) throw fail(400, `bad sha256 ${path}`);
    const size = f.size, text = isText(mime);
    if (!Number.isInteger(size) || size < 1 || size > (text ? MAX.json : kind.file)) throw fail(400, `bad size ${path}`);
    total += size;
    let bytes;
    if (f.b64 !== undefined) {
      if (!text || typeof f.b64 !== 'string') throw fail(400, `bad content ${path}`);
      bytes = Buffer.from(f.b64, 'base64');
      if (bytes.length !== size || createHash('sha256').update(bytes).digest('hex') !== f.sha256) throw fail(400, `content mismatch ${path}`);
      try { JSON.parse(bytes.toString('utf8')); } catch (e) { throw fail(400, `bad json ${path}`); }
    }
    return { path, mime, sha256: f.sha256, size, text, ...(bytes ? { bytes } : {}) };
  });
  if (total > kind.total) throw fail(400, 'too big');
  if (!seen.has(ENTRY)) throw fail(400, 'no index.json');
  return out;
}

/** 這次要動的：改過的（sha256 跟上一版不同、或沒有）與拿掉的（上一版有、這次沒有）。old：上一版 Map(路徑 → sha256) */
function planChanges(files, old) {
  const fresh = files.filter(f => old.get(f.path) !== f.sha256);
  const gone = [...old.keys()].filter(p => !files.some(f => f.path === p));
  return { fresh, gone };
}

/** 目錄的一行（crags.jsonl）：圖片檔數不含每張照片的縮圖（<名>.thumb.jpg） */
function cragRow({ id, name, t, version, files, locations, attribution, origin, gym, cc, kind = KINDS.guidebook }) {
  const thumb = p => p.endsWith('.thumb.jpg');
  return { id, name, t, version, dir: `${kind.dir}${id}/`, ...(gym ? { gym } : {}), ...(cc ? { cc } : {}), files: files.length, bytes: files.reduce((a, f) => a + f.size, 0),
    photos: files.filter(f => isImage(f.path) && !thumb(f.path)).length, at: locations && locations[0] ? locations[0] : null,
    license: LICENSE, attribution: attribution || '', origin: origin || '', thumbs: files.filter(f => thumb(f.path) && f.path !== 'thumb.jpg').length };
}
const upsertRow = (text, row) => {
  const rows = String(text || '').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.id !== row.id);
  rows.push(row);
  return rows.sort((a, b) => (a.id < b.id ? -1 : 1)).map(r => JSON.stringify(r)).join('\n') + '\n';
};
/** 專案文件裡的檔案：id 跟路徑、內容有關（內容變了 id 就變），沒有 Drive */
const entryOf = (id, f, kind = KINDS.guidebook) => ({ path: f.path, id: 'hf' + sha1(`${kind.dir}${id}/${f.path}:${f.sha256}`), mime: f.mime, sha256: f.sha256, size: f.size, hf: true });

module.exports = { REPO, INDEX, DIR, KINDS, kindOf, MAX, checkHfFiles, planChanges, cragRow, upsertRow, entryOf };
