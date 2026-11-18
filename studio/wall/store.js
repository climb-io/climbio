// Studio Wall 開的牆面專案：一個專案資料夾（../store.js，Wall、Crag 共用的放法），所有改動自動存回去，關掉再開從原處接續。
//   <專案>/index.json              組合（kind: set，type: walls）：列出各分區
//   <專案>/<分區 id>.json           組合（type: room）：列出這個分區完成的牆
//   <專案>/<牆 id>.json、.jpg       畫面（kind: view）：照片和岩點，格式見 format/README.md，任何 App 都讀得懂
//   <專案>/.studio/                 project.json（專案設定與每面牆的狀態）、progress/<牆 id>.json（偵測框、描到哪、要看的旗標）、thumbs/
// 公開的檔案（index.json、分區、各牆）都是從 .studio 的資料產生的。匯出 ZIP、發佈的包另外照每面牆的裁切範圍產生（app.js 的 packageFiles）。
(function (root) {
  'use strict';
  const SS = root.StudioStore, { PRIVATE, write, read, readJson, remove } = SS, { rid } = root.AppKit.files, T = root.AppKit.i18n.t;
  const MAX_SIDE = 3072, THUMB = 360, IMG = SS.IMG;

  // 編碼、雜湊、縮圖用 AppKit.photo
  // iPhone 的 HEIC 照片 Chrome 解不開（Safari 可以）：用 libheif（heic-to 的 CSP 版，LGPL-3.0）解。遇到才從 CDN 下載，先核對雜湊再執行
  const HEIC_TO = ['https://cdn.jsdelivr.net/npm/heic-to@1.6.7/dist/csp/heic-to.js', 'sha384-DGA0VYTCHvs5S5J0YlnqNdEN9cADJ/BEO+Qf26TzGRbsZ/FrWWvEdDdAnLvySm2I'];
  let heicTo = null;
  const loadHeic = () => heicTo || (heicTo = (async () => {
    const r = await fetch(HEIC_TO[0], { integrity: HEIC_TO[1] });
    if (!r.ok) throw new Error(`heic-to HTTP ${r.status}`);
    const u = URL.createObjectURL(await r.blob());
    try { return (await import(u)).heicTo; } finally { URL.revokeObjectURL(u); }
  })().catch(e => { heicTo = null; throw e; }));
  const isHeic = file => /\.hei[cf]$/i.test(file.name || '') || /^image\/hei[cf]/.test(file.type);
  async function scaled(file) {   // 照片轉正、縮到長邊 ≤ 3072 → 畫布
    const native = () => createImageBitmap(file, { imageOrientation: 'from-image' });   // Safari 自己解得開 HEIC，解不開（Chrome）才下載 libheif
    const bmp = isHeic(file) ? await native().catch(async () => (await loadHeic())({ blob: file, type: 'bitmap' })) : await native(), k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
    return c;
  }
  const jpeg = (c, q = 0.92) => new Promise(r => c.toBlob(r, 'image/jpeg', q));   // 重新編碼：照片不帶 EXIF

  // ---- 專案 ----
  // meta（.studio/project.json）：{ v, id, ws: 'gym', name, tag, author, license, gyms: [{ id, name }]（岩館：一個專案可以有好幾間，例如原岩萬華、原岩南港）, zones: [{ id, name, gym（岩館 id） }], walls: [牆], publish（上一版：{ version, url, files }） }
  // 牆：{ id, zone, name, w, h, sha, crop, status, err, n（岩點數）, look（要看的數）, t, pub（登記到找牆面：{ at, gym }）, lid（路線初稿圖層的 id） }
  //   status：queued（等掃描）→ scanned（有偵測框，等描外框）→ done；failed（err 是原因）
  // 牆的進度（.studio/progress/<id>.json）：{ boxes, raw: { 框序號: 描出來的結果 }, holds: [{ id, poly, source, flags, b（哪個框）, dupOk }], volDone }
  const PROGRESS = id => `${PRIVATE}/progress/${id}.json`, THUMBS = id => `${PRIVATE}/thumbs/${id}.jpg`;
  class Project {
    constructor({ id, dir, meta, local }) { this.id = id; this.dir = dir; this.meta = meta; this.local = local; this.cache = new Map(); this.timers = new Map(); this.onSaved = () => {}; }
    get walls() { return this.meta.walls; }
    get zones() { return this.meta.zones; }
    get gyms() { return this.meta.gyms; }
    gym(id) { return this.meta.gyms.find(g => g.id === id); }
    wall(id) { return this.meta.walls.find(w => w.id === id); }
    zone(id) { return this.meta.zones.find(z => z.id === id); }
    // 存專案設定（停手 0.4 秒才寫，連續改只寫一次）
    saveMeta() { this.later('meta', 400, async () => { await SS.saveMeta(this); }); }
    later(key, ms, fn) {
      clearTimeout(this.timers.get(key));
      const run = () => { this.timers.delete(key); this.pending = (this.pending || Promise.resolve()).then(fn).then(() => this.onSaved(), e => this.onSaved(e)); };
      this.timers.set(key, setTimeout(run, ms));
    }
    async flush() { for (const [k, t] of [...this.timers]) { clearTimeout(t); this.timers.delete(k); } await this.saveNow(); }
    async saveNow() { await SS.saveMeta(this); for (const [id, d] of this.cache) if (d.dirty) await this.writeData(id); }
    async data(id) {
      if (!this.cache.has(id)) { let d; try { d = await readJson(this.dir, PROGRESS(id)); } catch (e) { d = {}; } this.cache.set(id, { boxes: null, raw: {}, holds: [], volDone: [], ...d }); }
      return this.cache.get(id);
    }
    // 牆的進度或岩點改了：存進度，完成的牆另外產生公開的畫面檔
    touch(w, { ms = 800 } = {}) {
      w.t = Date.now(); this.saveMeta();
      const d = this.cache.get(w.id); if (d) d.dirty = true;
      this.later('w' + w.id, ms, () => this.writeData(w.id));
    }
    async writeData(id) {
      const d = this.cache.get(id), w = this.wall(id); if (!d || !w) return;
      d.dirty = false;
      const { dirty, ...keep } = d;
      await write(this.dir, PROGRESS(id), JSON.stringify(keep));
      if (w.status === 'done') await write(this.dir, this.path(w, 'json'), JSON.stringify(this.view(w, d)));
    }
    path(w, ext) { return `${w.id}.${ext}`; }
    async photo(w) { return read(this.dir, this.path(w, 'jpg')); }
    async thumb(w) { try { return await read(this.dir, THUMBS(w.id)); } catch (e) { return null; } }

    // ---- 公開格式 ----
    attribution() { return this.meta.author || this.meta.name || 'Climbio Studio'; }
    view(w, d) { return this.viewOf({ id: w.id, name: w.name, t: w.t, href: `${w.id}.jpg`, w: w.w, h: w.h, sha: w.sha, crop: w.crop, holds: d.holds }); }
    // 牆的照片畫面：{ id, name, t, href, w, h, sha?, crop?, holds }
    viewOf(o) {
      const holds = o.holds.filter(h => h.poly && h.poly.length >= 3);
      return {
        climbio: 2, kind: 'view', surface: 'photo', id: o.id, name: o.name, t: o.t, license: this.meta.license,
        attribution: this.attribution(), ...(this.meta.author ? { author: this.meta.author } : {}), origin: 'self',
        href: o.href, w: o.w, h: o.h, mime: 'image/jpeg', ...(o.sha ? { sha256: o.sha } : {}),
        ...(o.crop ? { props: { crop: o.crop } } : {}),
        nodes: holds.map(h => ({ id: h.id, type: 'hold', ...(h.source ? { props: { source: h.source } } : {}) })),
        marks: holds.map(h => ({ node: h.id, geometry: { type: 'Polygon', coordinates: [[...h.poly.map(p => [clampTo(p[0], o.w), clampTo(p[1], o.h)]), [clampTo(h.poly[0][0], o.w), clampTo(h.poly[0][1], o.h)]]] } })),
      };
    }
    // ---- 岩館：一個專案有好幾間（原岩有萬華、中和、南港、新店、明德），分區屬於其中一間 ----
    addGym(name) {
      name = String(name || '').trim() || this.meta.name;
      const g = { id: rid(), name };
      this.gyms.push(g); this.saveMeta(); return g;
    }
    // 還沒有岩館時（第一次加分區、照片）先建一間，名稱是專案名稱
    gymOrFirst(id) { return (id && this.gym(id)) || this.gyms[0] || this.addGym(this.meta.name); }
    async renameGym(g, name) { name = String(name || '').trim(); if (!name || name === g.name) return; g.name = name; await this.flush(); }
    async removeGym(g) { for (const z of this.zones.filter(x => x.gym === g.id)) await this.removeZone(z); this.meta.gyms = this.gyms.filter(x => x !== g); await this.flush(); }

    // ---- 分區 ----
    addZone(name, gymId) {
      name = String(name || '').trim() || T('hlZoneN', this.zones.length + 1);
      const z = { id: rid(), name, gym: this.gymOrFirst(gymId).id };
      this.zones.push(z); this.saveMeta(); return z;
    }
    zoneNamed(name, gymId) { const g = this.gymOrFirst(gymId); return this.zones.find(z => z.name === name && z.gym === g.id) || this.addZone(name, g.id); }
    async renameZone(z, name) { name = String(name || '').trim(); if (!name || name === z.name) return; z.name = name; await this.flush(); }
    async removeZone(z) { for (const w of this.walls.filter(x => x.zone === z.id)) await this.removeWall(w); this.meta.zones = this.zones.filter(x => x !== z); await this.flush(); }

    // ---- 牆 ----
    async addPhoto(file, zone) {   // 照片縮好、轉正，寫進分區資料夾，排進掃描
      const Photo = AppKit.photo, c = await scaled(file), name = file.name.replace(/\.[^.]+$/, ''), blob = await Photo.jpeg(c);
      const w = { id: rid(), zone: zone.id, name, w: c.width, h: c.height, sha: await Photo.sha256(blob), crop: null, status: 'queued', err: '', n: 0, look: 0, t: Date.now(), pub: null };
      await write(this.dir, this.path(w, 'jpg'), blob);
      await write(this.dir, THUMBS(w.id), await AppKit.photo.thumb(c, THUMB));
      this.walls.push(w); this.saveMeta(); return w;
    }
    // 獨立入口：照片直接成為還沒有岩點的完成牆（岩點在編輯器用 SAM2 新增）
    async addBlank(file, zone) {
      const w = await this.addPhoto(file, zone);
      w.status = 'done';
      this.cache.set(w.id, { boxes: null, raw: {}, holds: [], volDone: [], dirty: true });
      await this.writeData(w.id); this.saveMeta(); return w;
    }
    // 已經有岩點的牆（公開格式的畫面、舊的 .holds.json）：照片原樣放進來（座標以它為準），直接是完成的牆
    async addDone(photoFile, { name, holds, crop = null, id = rid() }, zone) {
      const bmp = await createImageBitmap(photoFile), c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0); bmp.close();
      const blob = await AppKit.photo.jpeg(c);
      const w = { id: this.wall(id) ? rid() : id, zone: zone.id, name, w: c.width, h: c.height, sha: await AppKit.photo.sha256(blob), crop, status: 'done', err: '', n: holds.length, look: 0, t: Date.now(), pub: null };
      await write(this.dir, this.path(w, 'jpg'), blob);
      await write(this.dir, THUMBS(w.id), await AppKit.photo.thumb(c, THUMB));
      this.walls.push(w);
      this.cache.set(w.id, { boxes: null, raw: {}, holds: holds.map(h => ({ ...h, flags: [] })), volDone: [], dirty: true });
      await this.writeData(w.id); this.saveMeta(); return w;
    }
    renameWall(w, name) { name = String(name || '').trim(); if (!name || name === w.name) return; w.name = name; this.touch(w, { ms: 0 }); return this.flush(); }
    moveWall(w, zone) { if (w.zone === zone.id) return; w.zone = zone.id; this.touch(w, { ms: 0 }); return this.flush(); }
    async removeWall(w) {
      for (const p of [this.path(w, 'jpg'), this.path(w, 'json'), PROGRESS(w.id), THUMBS(w.id)]) await remove(this.dir, p);
      this.meta.walls = this.walls.filter(x => x !== w); this.cache.delete(w.id);
      this.saveMeta();
    }
  }
  const clampTo = (v, max) => Math.round(Math.min(max, Math.max(0, v)) * 10) / 10;

  // 選的資料夾（StudioStore.claim）：是 Wall 專案就開；不是專案就建一個，裡面的照片照子資料夾分區（第一層的照片放在跟資料夾同名的分區）
  const NEW = { tag: '', author: '', license: 'CC-BY-SA-4.0', gyms: [], zones: [], walls: [] };
  const wallOf = p => { if (p.meta.ws !== 'gym') throw new Error(T('hlNotWall')); return new Project(p); };
  async function openDir(dir) {
    const c = await SS.claim(dir);
    if (c.meta) return { project: wallOf(await SS.open(c.dir)) };
    return { project: wallOf(await SS.create(c.dir, 'gym', dir.name, { meta: NEW })), photos: c.photos.map(p => ({ zone: p.dir || dir.name, file: p.file })) };
  }
  const createLocal = async name => wallOf(await SS.createLocal('gym', name, { meta: NEW }));
  const reopen = async e => wallOf(await SS.reopen(e));

  const IMG_RE = /\.(jpe?g|png|webp|hei[cf])$/i;
  root.RefineStore = { IMG_RE, openDir, createLocal, reopen, scaled, jpeg, IMG };
})(globalThis);
