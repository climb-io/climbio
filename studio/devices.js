// Studio 的「我的裝置」（appkit/nearby.js 的 devices 模式，app: 'studio'）：配對是所有 App 共用的，連上的是哪個 App 就交換它看得懂的東西。
//   對方是 Studio：整個專案資料夾（含 .studio 裡還沒發佈的進度），Wall、Crag 都一樣；比較新的整份取代
//   對方是岩點貓：岩館專案的牆（照片、岩點外框，跟岩點貓收牆同一種包）；收到的牆放進「從裝置收到」，收過的不覆蓋這裡改的
//   對方是紅點貓：岩場專案的 Guidebook（專案資料夾去掉 .studio 就是公開格式）；收到的照 id 建專案或換成新版
// 從頂列選單打開（shell.js），任何 Studio 頁面都能用：要用的程式到這時才載入。關掉時收到過東西就重新載入頁面，畫面才是新的。
const SS = globalThis.StudioStore, T = (...a) => globalThis.AppKit.i18n.t(...a);
const ROOT = new URL('../', import.meta.url);   // 網站根目錄（studio/ 的上一層）
const SYNCED = `${SS.PRIVATE}/synced.json`;    // 上次同步：{ t（對方給的版本）, at（收下後這裡檔案的最新修改時間）}
const ID = /^[0-9a-z]{8,32}$/;

const loaded = new Map();
const script = (path) => loaded.get(path) || loaded.set(path, new Promise((ok, no) => {
  const src = new URL(path, ROOT).href;
  if ([...document.scripts].some((s) => s.src.split('?')[0] === src)) { ok(); return; }   // 頁面本來就載入了
  const e = Object.assign(document.createElement('script'), { src });
  e.onload = ok; e.onerror = () => { loaded.delete(path); no(new Error(path)); };
  document.head.append(e);
})).get(path);
async function need(...paths) { for (const p of paths) await script(p); }
const NEARBY = ['appkit/nearby.js', 'appkit/share-tools.js'];
const WALL_LIBS = ['format/format.js', 'routekit/format.js', 'appkit/share-tools.js', 'studio/wall/store.js'];

const safePath = (p) => !!p && !p.startsWith('/') && !p.includes('\\') && !p.includes(':') && !p.split('/').some((x) => !x || x === '.' || x === '..');
const bundleBase = (b) => b.url.slice(0, b.url.length - b.entry.length);   // mem://<包>/
const bytesOf = async (b, path) => new Uint8Array(await (await globalThis.ShareTools.open(bundleBase(b) + path)).arrayBuffer());

/** 打得開的最近專案（資料夾沒授權的不算：要使用者點一下，從首頁打開）：[{ e, dir }] */
async function projects(ws) {
  const out = [];
  for (const e of await SS.recent()) {
    if ((ws && e.ws !== ws) || !(await SS.granted(e))) continue;
    try { const dir = await SS.dirOf(e); if (await SS.has(dir, `${SS.PRIVATE}/project.json`)) out.push({ e, dir }); } catch { /* 資料夾不見了 */ }   // 岩館專案發佈前沒有 index.json，看專案設定
  }
  return out;
}
async function readFiles(dir, keep) {
  const out = [];
  for (const f of await SS.files(dir)) if (keep(f.path)) out.push({ path: f.path, bytes: new Uint8Array(await (await SS.read(dir, f.path)).arrayBuffer()) });
  return out;
}
/** 收到的專案放哪裡：已經有這個 id 就寫回原處（沒授權的資料夾寫不進去），沒有就在瀏覽器裡建一個 */
async function target(id, ws, name) {
  const e = await SS.entry(id);
  if (e) {
    if (e.ws !== ws) throw new Error(T('stSyncClash', name));
    if (!(await SS.granted(e))) throw new Error(T('stNoFolderAccess'));
    return { dir: await SS.dirOf(e), local: !!e.local };
  }
  const p = await SS.createLocal(ws, name, { id });
  return { dir: p.dir, local: true };
}

// ---- 對方是 Studio：整個專案 ----
// 版本＝檔案的最新修改時間；剛收下、之後沒再改的，用對方給的版本（不然寫入的時間比較新，下次又送回去）
async function stamp(dir) {
  const m = Math.max(0, ...(await SS.files(dir)).filter((f) => f.path !== SYNCED).map((f) => f.m));
  const s = await SS.readJson(dir, SYNCED).catch(() => null);
  return s && m <= s.at ? s.t : m;
}
const studio = {
  async list() {
    return Promise.all((await projects()).map(async ({ e, dir }) => {
      const t = await stamp(dir);
      return { id: e.id, name: e.name || T('stUntitled'), sub: e.ws === 'gym' ? T('stGym') : T('stCrag'), v: [String(t)], t };
    }));
  },
  async pack(id) {
    const e = await SS.entry(id), dir = await SS.dirOf(e);
    const files = await readFiles(dir, (p) => p !== SYNCED);
    files.push({ path: SYNCED, bytes: new TextEncoder().encode(JSON.stringify({ t: await stamp(dir) })) });
    return { name: e.name, entry: `${SS.PRIVATE}/project.json`, files };
  },
  async take(b) {
    if (b.entry !== `${SS.PRIVATE}/project.json`) return;
    const meta = JSON.parse(new TextDecoder().decode(await bytesOf(b, b.entry)));
    if (!ID.test(meta.id || '') || !['gym', 'crag'].includes(meta.ws)) throw new Error(T('stSyncBad'));
    const { dir, local } = await target(meta.id, meta.ws, meta.name || b.name);
    let sent = 0;
    for (const path of b.files) {
      if (!safePath(path)) throw new Error(T('stSyncBad'));
      if (path === SYNCED) { sent = JSON.parse(new TextDecoder().decode(await bytesOf(b, path))).t || 0; continue; }
      await SS.write(dir, path, await bytesOf(b, path));
    }
    const at = Math.max(0, ...(await SS.files(dir)).filter((f) => f.path !== SYNCED).map((f) => f.m));
    await SS.writeJson(dir, SYNCED, { t: sent, at });
    await SS.open(dir, local);   // 記進最近的專案
  },
};

// ---- 對方是岩點貓：岩館專案的牆 ----
const hex16 = (text) => globalThis.AppKit.files.sha(text, 8);
const wallId = (w) => w.nearbyPid || w.id;   // 收來的牆沿用岩點貓的牆 id，送回去才是同一面
async function gymProjects() { await need(...WALL_LIBS); return Promise.all((await projects('gym')).map(({ e }) => globalThis.RefineStore.reopen(e, { quiet: true }))); }
const hold = {
  async list() {
    const out = [];
    for (const p of await gymProjects()) for (const w of p.walls.filter((x) => x.status === 'done')) {
      // 內容：岩點貓給的路線版本；這裡改過岩點（收下之後）就多一項，岩點貓沒有就會收
      const v = [...(w.nearbyV || []), ...(!w.nearbyPid || w.t > (w.nearbyAt || 0) ? [`studio:${w.t}`] : [])];
      out.push({ id: wallId(w), name: w.name || '', sub: p.meta.name || '', v });
    }
    return out;
  },
  async pack(id) {
    for (const p of await gymProjects()) {
      const w = p.walls.find((x) => wallId(x) === id);
      if (!w) continue;
      const d = await p.data(w.id), pack = await hex16(`studio:${id}`), layer = await hex16(`studio:${id}:layer`);
      const thumb = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; p.thumb(w).then((x) => r.readAsDataURL(x), no); });
      return globalThis.ShareTools.wallBundle({ id: pack, layerId: layer, pid: id, name: w.name || '', gym: '', w: w.w, h: w.h, thumb, holds: d.holds, routes: [], photo: await p.photo(w), attribution: '', version: Date.now(), t: w.t });
    }
    throw new Error(T('stSyncBad'));
  },
  async take(b) {
    if (!/\.json$/.test(b.entry || '') || b.entry === 'm3d.json') return;   // 3D 牆的路線不是牆
    const got = await globalThis.ShareTools.fetchWall(b.url, b.id), v = got.routes.map((r) => `${r.id}:${r.t || 0}`);
    const all = await gymProjects();
    for (const p of all) {
      const have = p.walls.find((w) => w.nearbyPid === b.id);
      if (have) { have.nearbyV = v; p.saveMeta(); await p.flush(); return; }   // 收過了：不覆蓋這裡改的，也不動 t／nearbyAt 讓精修外框仍會回傳
    }
    const p = all.find((x) => x.meta.nearby) || await globalThis.RefineStore.createLocal(T('stNearbyProject'));
    if (!p.meta.nearby) { p.meta.nearby = true; p.saveMeta(); }
    const w = await p.addDone(got.photo, { name: got.base.name || b.name || T('stUntitled'), holds: got.base.holds || [] }, p.zoneNamed(got.gym || T('stNearbyProject')));
    w.nearbyPid = b.id; w.nearbyV = v;
    p.touch(w, { ms: 0 }); w.nearbyAt = w.t; await p.flush();
  },
};

// ---- 對方是紅點貓：岩場專案的 Guidebook（組合的 t 是版本，兩邊一樣） ----
const redpoint = {
  async list() {
    const out = [];
    for (const { e, dir } of await projects('crag')) {
      const book = await SS.readJson(dir, 'index.json').catch(() => null);   // 還沒有 Guidebook 的岩場專案不送
      if (book) out.push({ id: book.id, name: e.name || T('stUntitled'), sub: T('stCrag'), v: [String(book.t || 0)], t: book.t || 0 });
    }
    return out;
  },
  async pack(id) {
    const e = await SS.entry(id);
    return { name: e.name, entry: 'index.json', files: await readFiles(await SS.dirOf(e), (p) => !p.startsWith(`${SS.PRIVATE}/`)) };
  },
  async take(b) {
    if (b.entry !== 'index.json') return;   // 攀登記錄不是岩場
    const book = JSON.parse(new TextDecoder().decode(await bytesOf(b, 'index.json')));
    if (book.climbio !== 2 || book.kind !== 'set' || book.type !== 'guidebook' || !ID.test(book.id || '')) return;   // Topo（單張照片）不是 Guidebook
    const { dir, local } = await target(book.id, 'crag', book.name || b.name);
    for (const path of b.files) {
      if (!safePath(path) || path.startsWith(`${SS.PRIVATE}/`)) throw new Error(T('stSyncBad'));
      if (path !== 'logs.json') await SS.write(dir, path, await bytesOf(b, path));
    }
    await SS.open(dir, local);
  },
};

const BY_APP = { studio, hold, redpoint };

/** 打開「我的裝置」；flush：先把頁面上還沒存的寫進去（送出去的是存好的檔案） */
export async function openDevices({ flush } = {}) {
  await need(...NEARBY);
  if (flush) await flush();
  let got = 0;
  const pick = (app) => BY_APP[app] || studio;
  return globalThis.AppKit.nearby.start('devices', {
    app: 'studio', label: 'Studio',
    list: (trusted, app) => pick(app).list(),
    pack: (id, trusted, app) => pick(app).pack(id),
    take: async (b, trusted, app) => { if (!trusted) throw new Error(T('stSyncBad')); await pick(app).take(b); got++; },
    onClose: () => { if (got) location.reload(); },
  });
}
