// 紅點貓收與送：都是 Climbio 公開格式 v2，沒有自己的格式、不經過伺服器。
//   收：網址（組合、畫面、圖層，例如龍洞的出口 https://longdong.web.app/climbio/longdong.json）、v2 的 JSON 檔或 ZIP。
//       組合沿著 items 往下讀（層數不限），圖層順著 href 讀它的畫面，照片和 3D 模型下載一份存在手機；每份都先過 validate。
//   送：一張 Topo 或一整組打包成 ZIP（index.json 是組合，其他檔案用相對路徑），用系統的分享，不能分享就下載；
//       主網的公開分享把檔案（toFiles）放進 Climbio 的公開資料集，連結是 /p/<組合 id>。
//       公開發佈只允許 origin 為 self 或 authorized；私人朋友互傳或自己的裝置同步可帶 personal，仍須遵守來源授權。
// validate 用全域的 ClimbioFormat（../format/format.js），ZIP 用 AppKit.files（../appkit/files.js），頁面先載入。
// English: only self/authorized photos may be published; private exchanges can include personal collections subject to source rights.

const T = (key, ...args) => globalThis.AppKit?.i18n?.t(key, ...args) ?? key;   // 語言包（i18n/redpoint）：頁面載入；Node 測試沒有 AppKit 就回傳 key

const MAX_DOCS = 2000;
const IMG_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'model/gltf-binary': 'glb', 'model/x-spz': 'spz' };   // 照片和 3D 模型（匯出檔的副檔名）

/** 驗證；不合格就丟錯，訊息列出前幾項原因 */
export function check(doc, where = doc?.id ?? '') {
  const errors = globalThis.ClimbioFormat.validate(doc);
  if (errors.length) throw new Error(T('badFormat', where, errors.slice(0, 3).join('; ')));
  return doc;
}

/** 畫面上顯示的署名：「甲；乙 改編」裡的乙已經是前面署名的人（作者改自己的岩場），就不重複，也不寫「改編」；檔案裡的署名照原樣 */
export function credit(attribution) {
  const parts = String(attribution ?? '').split('；').map((s) => s.trim()).filter(Boolean), seen = new Set();
  return parts.filter((p) => {
    const name = p.replace(/ 改編$/, '');
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  }).join('；');
}

/** 允許公開分享的畫面：自己的或有授權的。私人朋友互傳另走 toFiles({ own: true })，不會放進公開資料集。 */
export const shareable = (doc) => doc?.origin === 'self' || doc?.origin === 'authorized';

/** 只收 https、附近交換收到的包（mem://，見 appkit/share-tools.js 的 open），或同一個網站（測試用） */
function safeUrl(href, base) {
  const url = new URL(href, base);
  if (url.protocol !== 'https:' && url.protocol !== 'mem:' && url.origin !== location.origin) throw new Error(T('httpsOnly', url.href));
  return url;
}
const fetch = (url, opts) => (globalThis.ShareTools ? globalThis.ShareTools.open(String(url), opts) : globalThis.fetch(url, opts));

async function getJson(url, signal, fresh) {
  const res = await fetch(url, { signal, ...(fresh ? { cache: 'no-cache' } : {}) });
  if (!res.ok) throw new Error(T('readFailed', url.href, res.status));
  return res.json();
}


async function getBlob(url, signal, fresh, onProgress) {
  const res = await fetch(url, { signal, ...(fresh ? { cache: 'no-cache' } : {}) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const size = Number(res.headers.get('content-length')) || 0;
  if (!onProgress || !size || !res.body) return res.blob();
  const reader = res.body.getReader(), parts = [];   // 大檔案（3D 模型 20 MB 以上）邊下載邊回報，不然計數停在最後一個檔案很久，看起來像當掉
  let got = 0;
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    parts.push(r.value);
    got += r.value.length;
    onProgress(got, size);
  }
  return new Blob(parts, { type: res.headers.get('content-type') ?? '' });
}

const JSON_JOBS = 12, PHOTO_JOBS = 4;

/** 同時進行的數量上限 */
function limiter(n) {
  let active = 0;
  const wait = [];
  const next = () => {
    while (active < n && wait.length) {
      active++;
      wait.shift()();
    }
  };
  return (fn) => new Promise((ok, bad) => {
    wait.push(() => fn().then(ok, bad).finally(() => (active--, next())));
    next();
  });
}

/**
 * 從網址讀進來：回傳 { root, docs: Map<id, doc>, photos: Map<畫面 id, Blob>,
 *   preview?: Blob（合成預覽圖）, skipped: [說明], total }。
 * root 是第一份檔案；讀不到的照片照樣收畫面（之後連網看），不合格的檔案跳過並列在 skipped。
 * 每個檔案經過公開網址要一點時間（/p/ 轉到開放資料集），所以全部平行讀：目錄一層層同時讀（12 個一起），照片一發現就開始下載（4 張一起），
 * 不等目錄讀完；預覽圖（一張圖含入口照片和每張照片的小圖）在讀到第一份檔案時就先下載。
 * 開箱畫面用的回呼：onRoot(root, 網址)（讀到第一份就叫）、onPreview(Blob)（預覽圖到了）、
 * onPhoto(畫面 id, Blob, 第幾張, 共幾張)（好一張叫一次）、onProgress(畫面 id, 已下載, 總共)（照片、模型下載中，伺服器有給長度才叫）；ZIP 只有 onBytes(0–1)。signal 取消下載。
 * 入口（第一份）的 props.pack = { href } 指到合併檔：pack.json（{ docs: { 檔名: 文件 } }）
 * 一次讀回同一層所有的 JSON；沒有 pack 的舊專案、pack 讀不到都照逐檔讀。
 * ready：Promise，讀到第一份檔案後等它完成才開始讀其餘檔案與照片（拒絕就中止）；沒給就不等。
 * 更新收過的岩場時：fresh 讓 JSON 不用瀏覽器的快取；keep(畫面) 回 true 的照片手機裡已經有同一張，不下載（不在回傳裡）。
 */
export async function fromUrl(href, { signal, fresh = false, keep = async () => false, ready = null, onRoot = () => {}, onPreview = () => {}, onPhoto = () => {}, onBytes = () => {}, onProgress = () => {} } = {}) {
  const start = safeUrl(href, location.href);
  if (/\.zip$/i.test(start.pathname)) return fromFiles([new File([await zipBlob(start, signal, onBytes)], 'topo.zip', { type: 'application/zip' })]);
  const docs = new Map(), photos = new Map(), skipped = [], seen = new Set(), tasks = [];
  const json = limiter(JSON_JOBS), pics = limiter(PHOTO_JOBS);
  let root, rootDir, pack, preview, fatal, done = 0, found = 0, hint = 0;
  const spawn = (p) => tasks.push(p.catch((e) => { fatal ??= e; }));
  const optional = (url) => getBlob(url, signal, fresh).catch((e) => { if (e.name === 'AbortError') throw e; });   // 預覽圖、入口照片讀不到就算了

  const photoJob = (doc) => (doc.surface === 'model' ? (fn) => fn() : pics)(async () => {   // 3D 模型（20 MB 以上）不佔照片的 4 格名額：一發現就開始下載，跟照片同時進行，不排到最後
    try {
      if (await keep(doc)) return void onPhoto(doc.id, null, ++done, Math.max(hint, found));
      photos.set(doc.id, await getBlob(new URL(doc.href), signal, fresh, (got, size) => onProgress(doc.id, got, size)));
      onPhoto(doc.id, photos.get(doc.id), ++done, Math.max(hint, found));
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      skipped.push(T('photoNotDownloaded', doc.href));
    }
  });

  const visit = async (url) => {
    if (seen.has(url.href) || seen.size > MAX_DOCS) return;
    seen.add(url.href);
    let doc;
    try {
      const name = url.pathname.split('/').pop(), packed = pack && url.href.startsWith(rootDir.href) && !url.href.slice(rootDir.href.length).includes('/') ? pack.docs[name] : null;
      doc = check(packed ?? await json(() => getJson(url, signal, fresh)), name);
    } catch (e) {
      if (!root || e.name === 'AbortError') throw e;
      skipped.push(e.message);
      return;
    }
    if (!root) {
      root = doc;
      rootDir = new URL('./', url);
      const href = root.props?.pack?.href;
      if (typeof href === 'string') {   // 合併檔讀不到或格式不對就逐檔讀（之後的文件照舊）
        const got = await getJson(safeUrl(href, url), signal, fresh).catch((e) => { if (e.name === 'AbortError') throw e; });
        if (got && typeof got.docs === 'object' && got.docs) pack = got;
      }
      hint = root.kind === 'set' ? root.props?.preview?.count ?? root.items.filter((i) => i.props?.tile != null).length : 1;
      onRoot(root, url.href);
      const p = root.props?.preview?.href;
      if (typeof p === 'string') preview = optional(safeUrl(p, url)).then((b) => (b && onPreview(b), b));
      await ready;   // 使用者確認前只讀目錄和預覽圖，照片等確認後才下載
    }
    if (docs.has(doc.id)) return;
    docs.set(doc.id, doc);
    if (doc.kind === 'set') for (const item of doc.items) spawn(visit(safeUrl(item.href, url)));
    if (doc.kind === 'layer' && doc.href) spawn(visit(safeUrl(doc.href, url)));
    if (doc.kind === 'view' && (doc.surface === 'photo' || doc.surface === 'model')) {
      // 存成絕對網址：沒下載到的照片（3D 模型一樣）之後照網址讀
      const view = { ...doc, href: safeUrl(doc.href, url).href };
      docs.set(view.id, view);
      found++;
      spawn(photoJob(view));
    }
  };

  spawn(visit(start));
  for (let i = 0; i < tasks.length; i++) await tasks[i];
  if (fatal) throw fatal;
  return { root, docs, photos, preview: await preview, skipped, total: found };
}

/** ZIP 一次下載，邊下載邊回報比例（伺服器沒給長度就不回報） */
async function zipBlob(url, signal, onBytes) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(T('readFailed', url.href, res.status));
  const size = Number(res.headers.get('content-length')) || 0;
  if (!size || !res.body) return res.blob();
  const reader = res.body.getReader(), parts = [];
  let got = 0;
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    parts.push(r.value);
    got += r.value.length;
    onBytes(got / size);
  }
  return new Blob(parts);
}

/** 從檔案讀進來：一個 ZIP（index.json 是根），或幾個 JSON 檔 */
export async function fromFiles(files) {
  const entries = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name) || f.type === 'application/zip') entries.push(...(await globalThis.AppKit.files.unzip(f)));
    else entries.push({ name: f.name, blob: f });
  }
  const byName = new Map(entries.map((e) => [e.name, e.blob]));
  const docs = new Map(), photos = new Map(), skipped = [];
  let root;
  for (const e of entries.filter((x) => /\.json$/i.test(x.name))) {
    let doc;
    try {
      const raw = JSON.parse(await e.blob.text());
      if (raw?.docs && typeof raw.docs === 'object' && !raw.climbio) continue;   // 合併檔 pack.json（見 fromUrl）：不是 Climbio 文件，不檢查、不算有問題
      doc = check(raw, e.name);
    } catch (err) {
      skipped.push(err.message);
      continue;
    }
    if (e.name.split('/').pop() === 'index.json') root = doc;
    else root ??= doc;
    if (doc.kind === 'view' && (doc.surface === 'photo' || doc.surface === 'model')) {
      const dir = e.name.includes('/') ? e.name.slice(0, e.name.lastIndexOf('/') + 1) : '';
      const blob = byName.get(dir + doc.href);
      if (blob) photos.set(doc.id, blob.type ? blob : new Blob([blob], { type: doc.mime }));
      else if (!/^https:/.test(doc.href)) skipped.push(T('photoNotInFile', e.name, doc.href));
    }
    docs.set(doc.id, doc);
  }
  if (!root) throw new Error(skipped[0] ?? T('noClimbioFiles'));
  return { root, docs, photos, skipped };
}

/**
 * 打包：start 是要分享的組合或畫面 id；組合沿著 items 往下收，畫面帶上疊在它上面的圖層。
 * docOf(id)、photoOf(id) 讀手機裡的資料；layersOn(畫面 id) 是那張照片的圖層。
 * 回傳 { files: [{ name, blob }]（入口是 index.json）, count, left }：left 是留在手機、沒放進去的照片數（沒有 origin）。
 * 公開分享把這些檔案放進 Climbio 的公開資料集；沒有後端的站壓成一個 ZIP 檔分享。
 */
export async function toFiles(start, { docOf, photoOf, layersOn, wrap, nodesOf = async () => new Map(), own = false }) {   // own：私人直傳（朋友互傳、我的裝置）；可包含 personal。公開分享必須為 false。
  const out = new Map(), files = [], carried = new Map();   // carried：這包用到的節點（路線、上層的區域），隨著打包，單獨拿到就完整
  let left = 0;
  const all = await nodesOf();   // 這支手機裡所有節點（id → 節點）：路線的名稱、難度在組合的 nodes，不在圖層裡
  const localId = (id) => (typeof id === 'string' ? id.split('#').pop() : id);
  /** 節點連同它的上層一路帶到最上層 */
  const carry = (id) => {
    for (let n = all.get(localId(id)); n && !carried.has(n.id); n = n.parent ? all.get(localId(n.parent)) : undefined) carried.set(n.id, n);
  };
  const add = async (id) => {
    if (out.has(id)) return;
    const doc = await docOf(id);
    if (!doc) return;
    if (doc.kind === 'view') {
      if (!own && !shareable(doc)) return void left++;
      const blob = doc.surface === 'photo' || doc.surface === 'model' ? await photoOf(id) : undefined;
      const name = blob ? `${id}.${IMG_EXT[blob.type] ?? IMG_EXT[doc.mime] ?? 'jpg'}` : undefined;
      if (name) files.push({ name, blob });
      const { features: _, ...props } = doc.props ?? {};   // 舊版收進來的照片帶著特徵點欄位，不再往外傳
      const view = { ...doc, ...(name ? { href: name } : {}), props };
      if (!Object.keys(view.props).length) delete view.props;
      out.set(id, view);
      if (doc.props?.node) carry(doc.props.node);
      for (const l of await layersOn(id)) {
        // 路線節點放在組合（一個事實只放一處）：圖層裡自己畫的路線節點移到打包的組合；岩點牆的圖層（路線由 props.holds 定義）除外
        const own = (l.nodes ?? []).filter((n) => n.type === 'route' && !n.props?.holds);
        for (const n of own) carried.set(n.id, n);
        const layer = { ...l, href: `${id}.json`, nodes: (l.nodes ?? []).filter((n) => !own.includes(n)) };
        if (!layer.nodes.length) delete layer.nodes;
        out.set(l.id, layer);
        // 圖層用到、但不在圖層裡的節點（線段指到的路線、bolt 的上層路線）：從組合找來，連同上層區域
        const defined = new Set([...(l.nodes ?? [])].map((n) => n.id));
        // 線段、路線號碼（沒有線的路線標的 Point）指到的路線；bolt、確保站的 Point 指到的是圖層裡的節點，上層路線在下一行處理
        const boltNode = new Set((l.nodes ?? []).filter((n) => n.type === 'bolt' || n.type === 'anchor').map((n) => n.id));
        for (const m of l.marks ?? []) if (m.node && !defined.has(localId(m.node)) && (m.geometry?.type === 'LineString' || (m.geometry?.type === 'Point' && !boltNode.has(m.node)))) carry(m.node);
        for (const n of l.nodes ?? []) if (n.parent && !defined.has(localId(n.parent))) carry(n.parent);
        for (const n of own) if (n.parent) carry(n.parent);
      }
      return;
    }
    out.set(id, doc);
    if (doc.kind === 'set') for (const item of doc.items) await add(item.id ?? item.href.replace(/\.json$/, ''));
  };
  await add(start);
  const first = out.get(start);
  if (!first) throw new Error(T(left ? 'notShareable' : 'nothingToShare'));
  // 組合只放分享得出去的項目；一張 Topo 包成一個組合，收的人打開 index.json 就有
  const sets = [...out.values()].filter((d) => d.kind === 'set').map((s) => ({ ...s, items: s.items.filter((i) => out.has(i.id ?? i.href.replace(/\.json$/, ''))) }));
  for (const s of sets) out.set(s.id, s);
  const index = first.kind === 'set' ? out.get(start) : wrap([...out.values()]);
  // 最小單位是 Topo，任何子集都要完整：用到的節點（路線的名稱、難度，上層的區域）放進打包的組合，沒有的才補（組合自己已經有的不重複）
  const have = new Set((index.nodes ?? []).map((n) => n.id)), extra = [...carried.values()].filter((n) => !have.has(n.id));
  if (extra.length) index.nodes = [...(index.nodes ?? []), ...extra];
  const docs = [...out.values()].filter((d) => d.id !== index.id);
  for (const d of [index, ...docs]) check(d);
  files.push({ name: 'index.json', blob: new Blob([JSON.stringify(index)], { type: 'application/json' }) });
  for (const d of docs) files.push({ name: `${d.id}.json`, blob: new Blob([JSON.stringify(d)], { type: 'application/json' }) });
  return { files, count: docs.length + 1, left };
}


/** 用系統的分享送連結；不能分享就複製。回傳 'shared'、'copied' 或 'cancelled' */
export const sendLink = async (url) => {
  const how = await globalThis.AppKit.share.sendLink(url);
  if (how === 'failed') throw new Error('clipboard');
  return how;
};

/** 交給系統的分享（手機），不能分享檔案就下載。回傳 'shared'、'cancelled' 或 'downloaded' */
export const send = (blob, filename, title) => globalThis.AppKit.share.sendFile(new File([blob], filename, { type: 'application/zip' }), { title });
