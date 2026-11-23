// 分享的共用工具，不需要任何後端：收線（從任何網址讀路線圖層、牆和照片，Climbio 公開格式 v2，見 format/README.md 和 docs/route-format.md）、
// 解析路線連結、gzip 壓縮。後端（backend/）和 App 都用這裡的網路檢查與錯誤。
//
// 用法：
//   const job = ShareTools.fetchShared(ShareTools.linkFrom(連結), { onInfo, onProgress, havePhoto, needBase }); const { doc, route, base, photo } = await job.done;
//   ShareTools.linkFrom(text) → { pid, rid, src }
//   await ShareTools.gzip(text) → Uint8Array；await ShareTools.gunzip(bytes) → text（gzip；不壓縮的 ZIP 打包在 AppKit.files.zip）
//   分享包：await ShareTools.wallPackage({ id, layerId, pid, name, gym, w, h, thumb, holds, routes, photo, attribution, version, t }) → [{ path, bytes }]
//   站的公開牆面：await ShareTools.siteGyms(site) → [{ gym, n, t }]；await ShareTools.gymWalls(site, gym) → [{ pid, name, thumb, routes, t, href }]；
//   const { base, photo, routes } = await ShareTools.fetchWall(href, pid)；const { base } = await ShareTools.fetchHolds(href, pid)（只讀岩點，不下載照片）；ShareTools.homeSite() → 這個站的網址
//   總目錄：await ShareTools.directoryGyms(dir) → [{ gym, n, t, sites: [{ url, name }] }]；ShareTools.registerSite(dir) 登記這個站（一週最多一次）
// English: Backend-free sharing tools: fetch Climbio format v2 routes and walls from any https URL, link parsing, gzip.
(() => {
  'use strict';
  const PID_RE = /^[0-9a-z]{8,40}$/, RID_RE = /^[0-9a-z]{1,40}$/;
  const T = (k, ...a) => (self.climbioT ? self.climbioT(k, ...a) : k);   // 訊息在語言包（i18n/<語言>.js），用 js/app.js 的 t()

  // ---------- 網路：要用網路的動作先看有沒有連上，沒連上馬上回「無法連線」（不送出去等：Storage 會重試好幾分鐘、Firestore 的寫入會等到連上） ----------
  const offlineError = () => Object.assign(new Error(T('netOffline')), { code: 'offline' });
  const needNet = () => { if (navigator.onLine === false) throw offlineError(); };

  // ---------- 外部程式：用到才載入 ----------
  const scripts = {};
  function loadScript(src, integrity) {
    if (!scripts[src]) scripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      if (integrity) { s.integrity = integrity; s.crossOrigin = 'anonymous'; }
      s.src = src; s.onload = resolve;
      s.onerror = () => { delete scripts[src]; s.remove(); reject(new Error(T('netLoadFail'))); };
      document.head.append(s);
    });
    return scripts[src];
  }

  const cancelledError = () => Object.assign(new Error('cancelled'), { name: 'AbortError' });

  // ---------- 讀公開格式（Climbio 公開格式 v2）：路線圖層、牆（照片畫面）、組合；每份都先過 ClimbioFormat.validate ----------
  const MAX_PHOTO = 10 * 1024 * 1024;
  // 跟 fetch 一樣回 Response：mem:// 是附近交換收到的包，其他網址直接 fetch
  async function open(url, opts = {}) {
    if (new URL(url).protocol === 'mem:') return memOpen(url);
    return fetch(url, opts);
  }
  // 附近交換收到的包（appkit/nearby.js）放在記憶體：mem://<包>/<路徑>，收下後用同一套收線流程讀，讀完就丟掉
  const mem = new Map(), MEM_TYPES = { json: 'application/json', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', bin: 'application/octet-stream', gz: 'application/gzip', zip: 'application/zip', glb: 'model/gltf-binary', spz: 'model/x-spz' };
  const memPut = (bid, path, bytes) => mem.set(`${bid}/${path}`, bytes);
  const memDrop = (bid) => { for (const k of [...mem.keys()]) if (k.startsWith(`${bid}/`)) mem.delete(k); };
  function memOpen(url) {
    const u = new URL(url), key = `${u.host}${decodeURIComponent(u.pathname)}`, bytes = mem.get(key);
    if (!bytes) return new Response('', { status: 404 });
    return new Response(bytes, { headers: { 'Content-Type': MEM_TYPES[key.split('.').pop().toLowerCase()] || 'application/octet-stream' } });
  }
  // Climbio Studio 發佈的包（/p/{專案 id}/…）回 404：標 dead，呼叫的人通報，後端確認後拿掉索引
  const PUBLISHED = /^\/p\/[0-9a-z]{16}\//;
  const REMOTE = /^(https|mem):\/\//;   // 收的網址：https 或附近交換收到的包
  const isDead = (url) => { const u = new URL(url); return PUBLISHED.test(u.pathname); };
  async function get(url, signal) {
    let res;
    try { res = await open(url, { signal }); }
    catch (e) { throw signal && signal.aborted ? cancelledError() : Object.assign(new Error(`${T('netOffline')} (${e && e.message || e})`), { net: true }); }
    if (res.status === 404) throw Object.assign(new Error(T('shareNotFound')), { dead: isDead(url) });
    if (res.status === 403 || res.status === 429) throw Object.assign(new Error(`${T('netOffline')} (${res.status})`), { status: res.status });
    if (!res.ok) throw Object.assign(new Error(`${T('netOffline')} (${res.status})`), { status: res.status });
    return res;
  }
  // kind：要的種類（view、layer、set）；不合格式都當成找不到
  async function getDoc(url, kind, signal) {
    if (!/^mem:/.test(url)) needNet();
    const d = await (await get(url, signal)).json().catch(() => null);
    if (!d || d.kind !== kind || ClimbioFormat.validate(d).length) throw new Error(T('shareNotFound'));
    return d;
  }
  const resolve = (href, base) => new URL(href, base).href;
  async function getPhoto(view, viewUrl, signal) {
    const url = resolve(view.href, viewUrl);
    if (!REMOTE.test(url)) throw new Error(T('shareNotFound'));
    const photo = await (await get(url, signal)).blob();
    if (photo.size > MAX_PHOTO || !/^image\//.test(photo.type)) throw new Error(T('shareNotFound'));
    return photo;
  }
  const dataUrl = (blob) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(blob); });
  // 縮圖（首頁小卡、開箱的卡片）：從照片做，長邊 480
  async function thumbOf(photo) {
    const b = await createImageBitmap(photo), s = 480 / Math.max(b.width, b.height), c = document.createElement('canvas');
    c.width = Math.round(b.width * s); c.height = Math.round(b.height * s);
    c.getContext('2d').drawImage(b, 0, 0, c.width, c.height); b.close();
    return c.toDataURL('image/jpeg', AppKit.photo.QUALITY.tiny);
  }
  const nameOf = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? String(Object.values(v)[0] || '') : '');
  // 牆（照片畫面）＋路線圖層 → App 的原始岩點檔 { name, w, h, thumb, holds } 和路線
  function wallOf(view, layers) {
    const d = RouteKit.fromFormat(view, layers);
    if (!d.holds.length && !d.routes.length) throw new Error(T('shareNotFound'));
    return { base: { name: nameOf(view.name), w: d.w, h: d.h, thumb: '', holds: d.holds }, routes: d.routes.filter(r => RID_RE.test(r.id)) };
  }

  // 收到的人：讀分享的路線（路線圖層）、它疊的牆、照片（手上沒有這張照片才下載）。needBase：要建新的牆才給原始岩點檔。
  // onInfo：先拿到的資料給接收畫面先畫，依序是路線 { ownerName, route }（拿到圖層就有）、極小預覽圖 { thumb }（圖層的 props.preview）、
  // 原始岩點檔 { name, thumb, w, h, holds }（牆到了；thumb 是已經到的縮圖或預覽圖）、縮圖 { thumb, w, h, holds }（比牆晚到才有）。
  // 拿到圖層後牆、縮圖（圖層的 props.thumb；舊的圖層沒有就等牆的 props.thumb）同時下載，牆到了就開始下載照片。
  // 收線不用登入、不連 Firebase：從連結那台伺服器讀。任何網域的連結都收
  // 連結是分享包裡的一條線（{ wall: 路線圖層的網址, rid }）時照片編號看圖層疊在哪面牆；have(pid)＝手上有沒有這面牆（有就不下載照片、不給原始岩點檔）
  function fetchShared({ src, wall, pid, rid }, { onProgress = () => {}, onInfo = () => {}, havePhoto = false, needBase = true, have = null } = {}) {
    const ac = new AbortController();
    let wantPic = needBase && !havePhoto;
    // 站上的縮圖先下載成 data: 網址：別的網域的圖直接畫進畫布，畫布就不能再讀（開箱卡片要讀像素做灰階）
    let thumb = '';
    const thumbFrom = (url) => get(url, ac.signal).then(r => r.blob()).then(dataUrl).then(x => (thumb = x)).catch(() => '');
    const done = (async () => {
      const layerUrl = wall || `${src}route.json`, layer = await getDoc(layerUrl, 'layer', ac.signal);
      const viewUrl = resolve(layer.href || '', layerUrl), lp = layer.props || {};
      if (wall && PID_RE.test(layer.on || '')) { pid = layer.on; if (have && await have(pid)) { havePhoto = true; needBase = wantPic = false; } }
      if (layer.on !== pid || !layer.href) throw new Error(T('shareNotFound'));
      const first = RouteKit.fromFormat({}, [layer]).routes.find(r => r.id === rid);   // 牆還沒到：岩點的外框之後才有
      if (!first) throw new Error(T('shareNotFound'));
      const view = getDoc(viewUrl, 'view', ac.signal);
      let thumbJob = wantPic && typeof lp.thumb === 'string' ? thumbFrom(resolve(lp.thumb, layerUrl)) : null;
      onInfo({ ownerName: first.author, route: first });
      const preview = wantPic && /^data:image\/(jpeg|png|webp);base64,/.test(lp.preview || '') ? lp.preview : '';
      if (preview) onInfo({ thumb: preview });
      onProgress(0.2);
      const v = await view;
      if (v.id !== pid || v.surface !== 'photo') throw new Error(T('shareNotFound'));
      const { base, routes } = wallOf(v, [layer]), route = routes.find(r => r.id === rid);
      if (!route) throw new Error(T('shareNotFound'));
      const photo = havePhoto ? null : getPhoto(v, viewUrl, ac.signal);
      if (photo) photo.catch(() => {});   // 失敗在下面 await 時才丟出
      if (!thumbJob && wantPic && v.props && typeof v.props.thumb === 'string') thumbJob = thumbFrom(resolve(v.props.thumb, viewUrl));
      const doc = { author: route.author, gym: String(lp.gym || '') }, shown = thumb;
      if (needBase) onInfo({ name: base.name, thumb: shown || preview, w: base.w, h: base.h, holds: base.holds });
      if (thumbJob && !shown && await thumbJob) onInfo({ thumb, w: base.w, h: base.h, holds: base.holds });
      onProgress(0.5);
      const pic = photo && await photo;
      if (pic && needBase) base.thumb = await thumbOf(pic);
      onProgress(1);
      return { pid, doc, route, routes, base: needBase ? base : null, photo: pic };
    })();
    done.catch(() => ac.abort());   // 失敗了：還在下載的縮圖、照片一起停
    return { done, cancel: () => ac.abort() };
  }
  // ---------- 一面牆的分享包（跟 Climbio Studio 的 Wall 發佈的包同一種，公開放進開放資料集，見 docs/sharing.md）----------
  // index.json（組合 type: walls，一項指到路線圖層）、{照片編號}.json（牆的照片畫面）、{照片編號}.jpg、{照片編號}.thumb.jpg、{layerId}.json（這個人在這面牆的路線圖層）。
  // 只有圖層跟路線有關：其他檔案只跟照片、原始岩點檔、牆名有關，改路線時內容不變（不重傳）。version 寫在圖層的 props，讀的人看得出是不是最新版
  const bytesOf = (o) => new TextEncoder().encode(JSON.stringify(o));
  async function wallPackage({ id, layerId, pid, name = '', gym = '', w, h, thumb = '', holds = [], routes = [], photo, attribution = '', version = 1, t = 0 }) {
    const pic = /^data:image\/jpeg;base64,/.test(thumb) ? Uint8Array.from(atob(thumb.split(',')[1]), c => c.charCodeAt(0)) : null;
    const pack = RouteKit.wallFiles({ pid, layerId, name, gym, w, h, holds, routes, photo: new Uint8Array(await photo.arrayBuffer()), thumb: pic, attribution, t, layer: { props: { 'climbio:version': version } } });
    const index = { climbio: 2, kind: 'set', type: 'walls', id, name: name || 'Climbio', t, license: pack.view.license, attribution: pack.view.attribution,
      items: [{ href: pack.entry, id: pid, ...(name ? { name } : {}), t }] };
    return [{ path: 'index.json', bytes: bytesOf(index) }, ...pack.files];
  }

  /** 附近交換的一面牆（nearby 的 pack 用）：分享包加上入口，extra 是另外要帶的檔案（例如配對裝置才有的 records.json）。回 { name, entry, files } */
  async function wallBundle(o, extra = []) {
    return { name: o.name || '', entry: `${o.layerId}.json`, files: [...await wallPackage(o), ...extra] };
  }

  // 一個路線圖層裡的線（收過的分享回頭檢查更新）：圖層要疊在 pid 這面牆上；外框只帶跟牆上不一樣的。讀不到（作者拿掉了）丟 { gone: true }
  async function layerRoutes(url, pid) {
    let layer;
    try { layer = await getDoc(url, 'layer'); }
    catch (e) { if (e.dead) e.gone = true; throw e; }
    if (layer.on !== pid) throw Object.assign(new Error(T('shareNotFound')), { gone: true });
    return RouteKit.fromFormat({}, [layer]).routes.filter(r => RID_RE.test(r.id));
  }
  // QR 的兩個程式庫放在同源（appkit/qr/，CSP 不收 CDN 的程式）
  const lib = (name) => new URL(`../appkit/qr/${name}`, location.href).href;
  const QR_LIB = [lib('qrcode.js')], JSQR_LIB = [lib('jsQR.js')];
  // ---------- QR code ----------
  // level：容錯等級（中間要放 logo 用 'H'）
  async function qrDataURL(text, cell = 8, level = 'M') {
    await loadScript(...QR_LIB);
    const q = qrcode(0, level);
    q.addData(text); q.make();
    return q.createDataURL(cell, 2);
  }

  // 用相機掃 QR：有 BarcodeDetector（Android Chrome）就用，否則（iOS）用 jsQR 逐格解
  // accept：要收的文字（預設都收）
  async function scan(video, onText, accept = (text) => !!text) {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    let stopped = false, timer = 0;
    const stop = () => { stopped = true; clearTimeout(timer); stream.getTracks().forEach(tr => tr.stop()); video.srcObject = null; };
    try {
      video.srcObject = stream; video.setAttribute('playsinline', ''); video.muted = true;
      await video.play();
      let bd = null, fallback = null;
      try {
        if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats()).includes('qr_code')) bd = new BarcodeDetector({ formats: ['qr_code'] });
      } catch (e) { /* 部分瀏覽器有介面但不能使用，改用 jsQR */ }
      const loadFallback = async () => {
        await loadScript(...JSQR_LIB);
        const c = document.createElement('canvas'), cx = c.getContext('2d', { willReadFrequently: true });
        const read = (x, y, w, h) => {
          const k = Math.min(1, 640 / Math.max(w, h));
          c.width = Math.round(w * k); c.height = Math.round(h * k);
          cx.drawImage(video, x, y, w, h, 0, 0, c.width, c.height);
          const r = jsQR(cx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: 'dontInvert' });
          return r && r.data;
        };
        return () => {
          const w = video.videoWidth, h = video.videoHeight;
          if (video.readyState < 2 || !w || !h) return null;
          // 中央取景區保留細節，避免平板上的小 QR 隨整張畫面縮小而糊掉；再掃全幅以涵蓋邊緣。
          const side = Math.round(Math.min(w, h) / 2);
          return read((w - side) / 2, (h - side) / 2, side, side) || read(0, 0, w, h);
        };
      };
      if (!bd) fallback = await loadFallback();
      const detect = async () => {
        if (bd) {
          try { const r = await bd.detect(video); return r[0] && r[0].rawValue; }
          catch (e) { bd = null; }
        }
        if (!fallback) fallback = await loadFallback();
        return fallback();
      };
      const tick = async () => {
        if (stopped) return;
        const text = await detect().catch(() => null);
        if (stopped) return;
        if (text && accept(text)) { stop(); onText(text); } else timer = setTimeout(tick, 200);
      };
      tick();
    } catch (e) { stop(); throw e; }
    return stop;
  }

  // ---------- 壓縮（gzip）：岩點、路線的 JSON 大約剩三分之一 ----------
  const pipe = async (data, t) => new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(t)).arrayBuffer());
  const gzip = (text) => pipe(text, new CompressionStream('gzip'));
  const gunzip = async (bytes) => new TextDecoder().decode(await pipe(bytes, new DecompressionStream('gzip')));

  // 從貼上的文字取出分享的路線：路線連結 /r/{照片編號}/{路線 id}/，或 App 網址 ?p=照片編號&r=路線 id（任何網域）。
  // src＝這條線在哪台伺服器（路線連結的資料夾，後面接 route.json：路線圖層）；本機預覽沒有雲端函式，改讀開發版
  const DEV_SITE = 'https://climbio-dev.web.app';
  const SHORT_WALL = /^[\w-]{8,40}\/[\w.-]{1,64}$/;
  function linkFrom(text) {
    const m = String(text || '').match(/https?:\/\/\S+/);
    if (!m) return null;
    try {
      const u = new URL(m[0]), p = u.pathname.match(/^\/r\/([^/]+)\/([^/]+)/), wall = u.searchParams.get('wall');
      // 牆的連結（?wall＝公開格式的牆畫面、路線圖層，或同一面牆的幾張照片的組合）；再帶 r＝圖層裡的那一條線（分享一條線）
      // 短連結 ?wall=專案id/檔名：補成這個站的 /p/專案id/檔名（分享牆面用，網址短）
      const full = SHORT_WALL.test(wall || '') ? `${/^(localhost|127\.0\.0\.1)$/.test(u.hostname) ? DEV_SITE : u.origin}/p/${wall}` : wall;
      if (wall) return REMOTE.test(full) ? { wall: full, ...(RID_RE.test(u.searchParams.get('r') || '') ? { rid: u.searchParams.get('r') } : {}) } : null;
      const pid = p ? p[1] : u.searchParams.get('p'), rid = p ? decodeURIComponent(p[2]) : u.searchParams.get('r');
      if (!PID_RE.test(pid || '') || !RID_RE.test(rid || '')) return null;
      const site = /^(localhost|127\.0\.0\.1)$/.test(u.hostname) ? DEV_SITE : u.origin;
      return { pid, rid, src: `${site}/r/${pid}/${rid}/` };
    } catch (e) { return null; }   // 不是網址
  }

  // ---------- 站的公開牆面（找牆面；docs/route-format.md 的「牆面清單」）：不用登入、不用後端，任何站都能讀 ----------
  // site＝站的網址（https://…，含子路徑、結尾不帶 /）：App 所在資料夾（/hold/）的上一層。本機預覽沒有雲端函式，讀開發版
  const homeSite = () => (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? DEV_SITE : new URL('../', location.href).href.replace(/\/$/, ''));
  const count = (x, k) => (x.props && Number.isSafeInteger(x.props[k]) ? x.props[k] : 0);
  // 找牆面一次開頁會把同一份清單讀好幾次（泡泡、牆數、卡片）：一分鐘內同一份只下載一次，失敗不留
  const listMemo = new Map();
  const memoList = (key, load, ttl = 60000) => {
    const hit = listMemo.get(key);
    if (hit && Date.now() - hit.t < ttl) return hit.p;
    const p = load().catch((e) => { listMemo.delete(key); throw e; });
    listMemo.set(key, { t: Date.now(), p });
    return p;
  };
  // 站（組合 type: site）→ 有公開牆面的岩館
  const siteGyms = (site) => memoList(`site ${site}`, async () => {
    const d = await getDoc(`${site}/climbio.json`, 'set');
    return (d.items || []).filter(x => typeof x.name === 'string').map(x => ({ gym: x.name, n: count(x, 'walls'), t: x.t || 0 }));
  });
  // 岩館的公開牆面（組合 type: walls）→ 一面牆一項；href＝從哪裡收（路線圖層或牆），縮圖網址照清單的網址解析
  const gymWalls = (site, gym) => memoList(`gym ${site} ${gym}`, async () => {
    // Split the project-reader response from cached lists that still contain direct Drive links.
    const url = `${site}/w/gym/${encodeURIComponent(gym)}.json?read=project`, d = await getDoc(url, 'set');
    return (d.items || []).filter(x => PID_RE.test(x.id || '')).map(x => {
      const thumb = x.props && typeof x.props.thumb === 'string' ? x.props.thumb : '';
      return { pid: x.id, name: nameOf(x.name), thumb: !thumb || /^data:image\//.test(thumb) ? thumb : resolve(thumb, url), routes: count(x, 'routes'), t: x.t || 0, href: resolve(x.href, url), ...(x.props && x.props.model === '3d' ? { m3d: 1 } : {}) };
    });
  });
  // 收整面牆：href 是路線圖層（再讀它疊的牆）或直接是牆
  // thumbUrl：清單帶來的縮圖網址，跟圖層同時下載當這面牆的縮圖，不用等整張照片下載完再解碼縮小
  // 路線圖層或牆的網址 → { d: 讀到的那份, view: 牆的畫面, viewUrl }；先過 validate，id、照片畫面不對丟 shareNotFound
  async function readWallDocs(href, pid) {
    if (!PID_RE.test(pid || '') || !REMOTE.test(href || '')) throw new Error(T('shareNotFound'));
    if (!/^mem:/.test(href)) needNet();
    const d = await (await get(href)).json().catch(() => null);
    if (!d || ClimbioFormat.validate(d).length || !['view', 'layer'].includes(d.kind)) throw new Error(T('shareNotFound'));
    const viewUrl = d.kind === 'layer' ? resolve(d.href || '', href) : href, view = d.kind === 'layer' ? await getDoc(viewUrl, 'view') : d;
    if (view.id !== pid || view.surface !== 'photo' || (d.kind === 'layer' && d.on !== pid)) throw new Error(T('shareNotFound'));
    return { d, view, viewUrl };
  }
  // 只讀牆的原始岩點檔（不下載照片）：{ base: { name, w, h, holds }（停用的岩點帶 retired） }
  async function fetchHolds(href, pid) {
    const { view } = await readWallDocs(href, pid);
    return { base: wallOf(view, []).base };
  }
  async function fetchWall(href, pid, thumbUrl = '') {
    const thumbJob = /^data:image\//.test(thumbUrl) ? Promise.resolve(thumbUrl) : REMOTE.test(thumbUrl) ? get(thumbUrl).then(r => r.blob()).then(dataUrl).catch(() => '') : Promise.resolve('');
    const { d, view, viewUrl } = await readWallDocs(href, pid);
    const { base, routes } = wallOf(view, d.kind === 'layer' ? [d] : []), photo = await getPhoto(view, viewUrl);
    base.thumb = (await thumbJob) || await thumbOf(photo);
    const photos = view.props && typeof view.props.photos === 'string' ? resolve(view.props.photos, viewUrl) : '';
    return { base, photo, routes, photos, gym: String((d.props && d.props.gym) || ''), attribution: nameOf(d.attribution || view.attribution) };
  }
  // 同一面牆的幾張照片（組合 type: photos）→ { id, items: [{ pid, href, name }]（照左右排）, links: [{ a, b, H?, dx, dy }] }
  async function wallPhotos(url) {
    const d = await getDoc(url, 'set');
    if (d.type !== 'photos') throw new Error(T('shareNotFound'));
    const items = (d.items || []).filter(x => PID_RE.test(x.id || '')).map(x => ({ pid: x.id, href: resolve(x.href, url), name: nameOf(x.name) }));
    const ids = new Set(items.map(x => x.pid)), num = v => Number.isFinite(v) ? v : 0;
    const links = ((d.props && d.props.links) || []).filter(l => l && ids.has(l.a) && ids.has(l.b))
      .map(l => ({ a: l.a, b: l.b, ...(Array.isArray(l.H) && l.H.length === 9 && l.H.every(Number.isFinite) ? { H: l.H } : {}), dx: num(l.dx), dy: num(l.dy) }));
    return { id: d.id, items, links };
  }

  // ---------- 總目錄（docs/route-format.md 的「總目錄」）：一項是一個站的一間岩館；dir＝總目錄的網址（site.js 的 SITE.directory） ----------
  // → [{ gym, n, t, sites: [{ url: 站的網址, name }] }]，同一間岩館的站合在一起
  async function directoryGyms(dir) {
    const d = await getDoc(`${dir}/dir/gyms.json`, 'set'), byGym = new Map();
    for (const x of d.items || []) {
      const m = typeof x.name === 'string' && /^(https:\/\/.+)\/w\/gym\/[^/]+\.json$/.exec(resolve(x.href, `${dir}/dir/gyms.json`));
      if (!m) continue;
      const g = byGym.get(x.name) || { gym: x.name, n: 0, t: 0, sites: [] };
      g.n += count(x, 'walls'); g.t = Math.max(g.t, x.t || 0); g.sites.push({ url: m[1], name: String((x.props && x.props.site) || '') });
      byGym.set(x.name, g);
    }
    return [...byGym.values()];
  }
  // 登記這個站：每台手機一週最多送一次，只送網址；總目錄自己去讀這個站的 climbio.json 驗證（props.listed: true 才收）
  const DIR_KEY = 'climbio.dirAt', WEEK = 7 * 864e5;
  function registerSite(dir) {
    if (navigator.onLine === false) return;
    let at = 0;
    try { at = Number(localStorage.getItem(DIR_KEY)) || 0; } catch (e) { /* 儲存空間不可用：照送 */ }
    if (Date.now() - at < WEEK) return;
    try { localStorage.setItem(DIR_KEY, String(Date.now())); } catch (e) { /* 同上 */ }
    fetch(`${dir}/dir/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: homeSite() }) }).catch(() => {});
  }

  // 手機精修的記錄，格式同開放資料集的 edits.json（docs/walls-dataset-card.md）：base 是原始岩點檔，mine 是我的岩點檔（source：detect、edited、manual）。
  // 公開的牆畫面維持原始岩點檔；final 帶改過、手畫的岩點的最後外框。沒有任何修改回 null。
  function phoneEdits({ pid, base = [], mine = [], license = 'CC-BY-SA-4.0' }) {
    const at = new Map(base.map(h => [h.id, h])), now = new Set(mine.map(h => h.id));
    const deleted = base.filter(h => !now.has(h.id)).map(h => ({ id: h.id, poly: h.poly })), reshaped = [], added = [], final = {};
    for (const h of mine) {
      if (h.source === 'manual' && !at.has(h.id)) { added.push(h.id); final[h.id] = h.poly; }
      else if (h.source === 'edited' && at.has(h.id)) { reshaped.push({ id: h.id, poly: at.get(h.id).poly }); final[h.id] = h.poly; }
    }
    if (!deleted.length && !reshaped.length && !added.length) return null;
    return { holdlab: 1, wall: pid, license, reviewed: false, tools: { by: 'phone' }, flagged: {}, deleted, reshaped, added, final, sam: {} };
  }

  window.ShareTools = { T, open, memPut, memDrop, needNet, offlineError, cancelledError, loadScript, qrDataURL, scan, PID_RE, RID_RE, fetchShared, layerRoutes, wallPackage, wallBundle, phoneEdits, gzip, gunzip, linkFrom, homeSite, siteGyms, gymWalls, fetchWall, fetchHolds, wallPhotos, directoryGyms, registerSite };
})();
