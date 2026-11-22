// Climbio Studio 的專案資料夾：Wall、Crag 都是同一種資料夾，這裡管放在哪裡、怎麼讀寫、最近開過哪些；內容由工作區決定。
//   放在哪裡：能選資料夾的瀏覽器（電腦版 Chrome、Edge）放在使用者選的資料夾；不能選的（iPad 的 Safari）放在瀏覽器的私有檔案系統（OPFS）的「Climbio Studio/<專案 id>/」
//   <專案>/index.json        最上層的組合（Wall 是 type: walls，Crag 是 type: guidebook），id 就是專案 id
//   <專案>/<id>.json         其他的組合、畫面、圖層，都在同一層、用 id 命名；照片是 <id>.jpg（或照片畫面 href 的副檔名）
//   <專案>/.studio/          Studio 自己用的：project.json（{ v, id, ws, name, ... 工作區的設定 }）、進度、縮圖；不進 ZIP、不發佈
// 資料夾去掉 .studio 就是匯出的 ZIP，也是發佈出去的內容，任何讀 Climbio 公開格式的 App 都讀得懂。
// IndexedDB「climbio-studio」：recent（最近的專案；資料夾的授權存在這裡，下次免選）、inbox（首頁交給工作區的檔案與選項）。
(function (root) {
  'use strict';
  const PRIVATE = '.studio', PROJECT = `${PRIVATE}/project.json`, LOCAL = 'Climbio Studio';
  const IMG = /\.(jpe?g|png|webp|hei[cf])$/i;
  const T = (...a) => root.AppKit.i18n.t(...a);   // 文字在呼叫時才查
  const { rid } = root.AppKit.files;   // appkit/files.js 先載入

  // ---- IndexedDB ----
  const db = root.AppKit.idb.opener({   // appkit/idb.js 先載入：連線被關掉會自動重開
    name: 'climbio-studio', version: 2,
    upgrade: (d) => { for (const s of ['inbox', 'recent']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); },
  });
  const tx = async (store, mode, fn) => {
    const t = (await db()).transaction(store, mode), r = fn(t.objectStore(store));
    await new Promise((res, rej) => { t.oncomplete = res; t.onerror = t.onabort = () => rej(t.error || new Error(T('stDbFailed'))); });
    return r && r.result;
  };

  // ---- 檔案 ----
  const sub = (dir, name, create) => dir.getDirectoryHandle(name, { create });
  async function walk(dir, path, create = true) {   // 'a/b/c.json' → [資料夾, 檔名]
    const parts = path.split('/'); let d = dir;
    for (const p of parts.slice(0, -1)) d = await sub(d, p, create);
    return [d, parts[parts.length - 1]];
  }
  async function write(dir, path, data) {
    const [d, n] = await walk(dir, path), fh = await d.getFileHandle(n, { create: true });
    if (!fh.createWritable) return writeSync(fh, data);
    const w = await fh.createWritable(); await w.write(data); await w.close();
  }
  // 沒有 createWritable（舊的 Safari）：OPFS 的檔案交給 Worker 用同步存取寫（opfs-worker.js）
  const WORKER = new URL('opfs-worker.js', document.currentScript.src).href;
  let wk = null, wn = 0;
  const waits = new Map();
  async function writeSync(fh, data) {
    const path = await (await navigator.storage.getDirectory()).resolve(fh);
    if (!path) throw new Error(T('stCannotSave'));
    if (!wk) { wk = new Worker(WORKER); wk.onmessage = ({ data: m }) => { const f = waits.get(m.id); waits.delete(m.id); if (m.err) f.rej(new Error(m.err)); else f.res(); }; }
    const id = ++wn;
    return new Promise((res, rej) => { waits.set(id, { res, rej }); wk.postMessage({ id, path, data: typeof data === 'string' || data instanceof Blob ? data : new Blob([data]) }); });
  }
  async function read(dir, path) { const [d, n] = await walk(dir, path, false); return (await d.getFileHandle(n)).getFile(); }
  const readJson = async (dir, path) => JSON.parse(await (await read(dir, path)).text());
  const writeJson = (dir, path, doc) => write(dir, path, JSON.stringify(doc));
  async function remove(dir, path) { try { const [d, n] = await walk(dir, path, false); await d.removeEntry(n); } catch (e) { if (e.name !== 'NotFoundError') throw e; } }
  async function has(dir, path) { try { await read(dir, path); return true; } catch (e) { return false; } }
  // 所有檔案（含子資料夾、.studio）：[{ path, size, m（修改時間）}]
  async function files(dir, prefix = '') {
    const out = [];
    for await (const [n, h] of dir.entries()) {
      if (h.kind === 'directory') out.push(...await files(h, `${prefix}${n}/`));
      else { const f = await h.getFile(); out.push({ path: prefix + n, size: f.size, m: f.lastModified }); }
    }
    return out;
  }
  // 第一層的檔名（不含 .studio 這類點開頭的）
  async function names(dir) { const out = []; for await (const [n, h] of dir.entries()) if (h.kind === 'file' && !n.startsWith('.')) out.push(n); return out; }

  // ---- 專案 ----
  // 打開的專案：{ id, ws, dir, meta（.studio/project.json）, local }；meta 改了呼叫 saveMeta
  const canPickDir = typeof showDirectoryPicker === 'function';
  const pick = () => showDirectoryPicker({ id: 'climbio-studio', mode: 'readwrite' });
  const metaIn = async dir => (await has(dir, PROJECT)) ? readJson(dir, PROJECT) : null;
  const localRoot = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(LOCAL, { create: true });
  async function create(dir, ws, name, { id = rid(), local = false, meta = {} } = {}) {
    await writeJson(dir, PROJECT, { v: 1, id, ws, name, ...meta });
    return open(dir, local);
  }
  // 瀏覽器裡的專案：先要求持續保存，瀏覽器才不會在空間不夠時清掉
  async function createLocal(ws, name, opt = {}) {
    if (navigator.storage.persist) await navigator.storage.persist().catch(() => false);
    const id = opt.id || rid();
    return create(await (await localRoot()).getDirectoryHandle(id, { create: true }), ws, name, { ...opt, id, local: true });
  }
  async function open(dir, local = false, { quiet = false } = {}) {   // quiet：不記進最近的專案（同步時讀一下，不改「繼續編輯」的順序）
    const meta = await readJson(dir, PROJECT), p = { id: meta.id, ws: meta.ws, dir, meta, local };
    if (!quiet) await remember(p);
    return p;
  }
  const saveMeta = p => writeJson(p.dir, PROJECT, p.meta);
  // 最近的專案：{ id, ws, name, at, local, src, book（轉換路線書來的岩場專案） } 加資料夾的 handle（local 的照 id 在 OPFS 找）；src 是匯入的來源網址（同一個來源不重複匯入）
  const remember = p => tx('recent', 'readwrite', s => s.put({ id: p.id, ws: p.meta.ws, name: p.meta.name, at: Date.now(), ...(p.local ? { local: true } : { dir: p.dir }), ...(p.meta.src ? { src: p.meta.src } : {}), ...(p.meta.book ? { book: true } : {}) }, p.id));
  const recent = async () => (await tx('recent', 'readonly', s => s.getAll()) || []).sort((a, b) => b.at - a.at);
  const entry = id => tx('recent', 'readonly', s => s.get(id));
  const forget = id => tx('recent', 'readwrite', s => s.delete(id));
  async function removeLocal(id) { await (await localRoot()).removeEntry(id, { recursive: true }).catch(e => { if (e.name !== 'NotFoundError') throw e; }); await forget(id); }
  // 資料夾的授權要使用者點一下才能要回來（瀏覽器規定）：granted(e) 不用點就打得開
  const granted = async e => e.local || await e.dir.queryPermission({ mode: 'readwrite' }) === 'granted';
  // 使用者選的資料夾：是專案就開（或裡面的「Climbio Studio」是）；有照片（第一層或子資料夾）就把專案建在裡面的「Climbio Studio」，照片交給工作區匯入；空的就直接當專案
  // → { dir: 專案放的資料夾, meta: 已經是專案的設定（不是就 null）, photos: [{ dir: 子資料夾名稱或 '', file }] }
  async function claim(dir) {
    const meta = await metaIn(dir);
    if (meta) return { dir, meta, photos: [] };
    let inner = null; try { inner = await dir.getDirectoryHandle(LOCAL); } catch (e) { /* 沒有 */ }
    const im = inner && await metaIn(inner);
    if (im) return { dir: inner, meta: im, photos: [] };
    const photos = await photosIn(dir);
    return photos.length ? { dir: await dir.getDirectoryHandle(LOCAL, { create: true }), meta: null, photos } : { dir, meta: null, photos };
  }
  async function photosIn(dir) {
    const out = [];
    for await (const [name, h] of dir.entries()) {
      if (name.startsWith('.')) continue;
      if (h.kind === 'file' && IMG.test(name)) out.push({ dir: '', file: await h.getFile() });
      else if (h.kind === 'directory') for await (const [n2, h2] of h.entries()) if (h2.kind === 'file' && IMG.test(n2)) out.push({ dir: name, file: await h2.getFile() });
    }
    return out;
  }
  // 最近的專案的資料夾（不打開、不改最近的順序）；沒授權的資料夾照樣給，用之前先 granted
  async function dirOf(e) { return e.local ? (await localRoot()).getDirectoryHandle(e.id) : e.dir; }
  async function reopen(e, opt) {
    if (e.local) return open(await (await localRoot()).getDirectoryHandle(e.id), true, opt);
    if (!(await granted(e)) && await e.dir.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error(T('stNoFolderAccess'));
    return open(e.dir, false, opt);
  }

  // ---- 收件匣：首頁掃描過、選好要自動處理的項目，交給工作區頁面接手（檔案、資料夾 handle 都能存）----
  // 檔案存成 ArrayBuffer：Safari 從 IndexedDB 取回存進去的 File，換頁後讀到的內容是空的。
  // 每個檔案各存一筆（<id>/<序號>）：一筆有大小上限（Chrome 約 130 MB），整包原始檔放在同一筆會存不進去
  const inbox = {
    async put(rec) {
      const id = rid(8), { items, ...rest } = rec;
      for (const [i, it] of (items || []).entries()) {
        const one = { dir: it.dir, name: it.file.name, type: it.file.type, buf: await it.file.arrayBuffer() };
        await tx('inbox', 'readwrite', s => s.put(one, `${id}/${i}`));
      }
      await tx('inbox', 'readwrite', s => s.put({ ...rest, ...(items ? { n: items.length } : {}), t: Date.now() }, id));
      return id;
    },
    async take(id) {
      const rec = await tx('inbox', 'readonly', s => s.get(id));
      if (!rec) return null;
      const { n, ...out } = rec;
      if (n != null) {
        out.items = [];
        for (let i = 0; i < n; i++) {
          const it = await tx('inbox', 'readonly', s => s.get(`${id}/${i}`));
          out.items.push({ dir: it.dir, file: new File([it.buf], it.name, { type: it.type }) });
        }
      }
      await tx('inbox', 'readwrite', s => { s.delete(id); for (let i = 0; i < (n || 0); i++) s.delete(`${id}/${i}`); });
      return out;
    },
  };

  root.StudioStore = { PRIVATE, IMG, write, writeJson, read, readJson, remove, has, names, files, canPickDir, pick, metaIn, claim, create, createLocal, open, saveMeta, remember, recent, entry, forget, removeLocal, granted, dirOf, reopen, inbox };
})(globalThis);
