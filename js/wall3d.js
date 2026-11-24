// 3D 牆：私人連結（/hold/?m3d=<牆 id>，可帶 &r=<路線>）打開時下載資料包（在 Climbio 的公開資料集，經索引從 /p/<牆 id>/ 讀）、在這台建一面牆，
// 之後跟一般的牆一樣在首頁、牆頁看線定線。牆的「照片」是正面快照，岩點外框是岩點投到快照上的範圍；
// 牆頁上快照換成即時的模型（wall3dkit/stage.js），點選用射線，兩指一起拖轉角度。
// 分享路線：整條線壓縮在連結的 r= 參數，收到的人打開就是同一面牆加上這條線（連結就是這個網址）。
// English: Hold Cat 3D walls: private pack link → local wall; the wall page renders the model instead of the photo.
'use strict';
const W3D = (() => {
  const PID = /^[0-9a-z]{16}$/;
  const stages = new Map();   // 牆 id → Promise<Stage>（這次打開 App 只載一次）
  const ready = new Map();    // 牆 id → 載好的 Stage（進定線時同步知道 3D 好了沒）
  const front = new Map();    // 牆 id → 正面的岩點外框（轉過角度時 w.holds 換成新角度的，存檔用這份）
  const base = (pid) => `https://huggingface.co/datasets/climbio/walls3d/resolve/main/walls3d/${pid}/`;   // Studio 發佈的資料包：檔案在公開資料集 climbio/walls3d，固定網址直接讀（不經過函式）
  // 版本號放進網址：Service Worker 照版本快取（js/、hold/sw.js），換版本就換新的程式
  const stageModule = () => import(new URL(`../wall3dkit/stage.js?v=${encodeURIComponent(self.CLIMBIO_VERSION)}`, location.href.split(/[?#]/)[0]).href);
  function stageOf(pid, pack = null) {
    if (!stages.has(pid)) {
      const job = stageModule().then(async (m) => m.openStage(base(pid), pack || await m.loadPack(base(pid))));
      job.then((st) => ready.set(pid, st), () => stages.delete(pid));
      stages.set(pid, job);
    }
    return stages.get(pid);
  }
  const b64url = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); };
  const unb64url = (s) => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
  const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  // 這條線用到的岩點的修點
  const editsOf = (w, r) => Object.fromEntries(w.holds.filter(h => h.m3 && r.holds[h.id]).map(h => [h.id, h.m3]));
  // 傳到 Climbio 的一條線：跟 2D 公開牆的線同一種圖層片段（岩點編號、角色、手順都在路線節點裡），3D 牆另帶修點 e
  function fragment(w, r) {
    const e = editsOf(w, r), l = RouteKit.routesLayer({ id: w.pid, pid: w.pid, href: 'index.json', w: w.w, h: w.h, holds: [], routes: [r] });
    return { nodes: l.nodes, marks: l.marks, ...(Object.keys(e).length ? { e } : {}) };
  }
  // 傳上去之後的短連結：跟 2D 公開牆的線同一種 /r/牆 id/路線 id/（預覽頁，打開後進 3D 牆）
  const shortLink = (w, r) => `${location.origin}/r/${w.pid}/${encodeURIComponent(r.id)}/`;
  // 路線連結：名稱、難度、岩點與角色、手順，加上路線用到的岩點的修點（deflate-raw＋base64url）。沒傳到伺服器（沒網路、不能分享）時用這個
  async function link(w, r) {
    const e = editsOf(w, r);
    const doc = { n: r.name || '', g: r.grade || '', h: r.holds, ...(r.seq ? { q: r.seq } : {}), ...(r.feetFree ? { f: 1 } : {}), ...(Object.keys(e).length ? { e } : {}) };
    const packed = b64url(await pipe(new TextEncoder().encode(JSON.stringify(doc)), new CompressionStream('deflate-raw')));
    return `${location.origin}${location.pathname}?m3d=${w.pid}&r=${packed}`;
  }
  const HOLD_ID = /^[0-9a-z]{1,40}$/;
  const validM3 = (m) => !!m && Array.isArray(m.c) && m.c.length === 7 && m.c.every(Number.isFinite)
    && Array.isArray(m.p) && m.p.length >= 3 && m.p.length <= 64 && m.p.every(q => Array.isArray(q) && q.length === 2 && q.every(v => Number.isFinite(v) && v > -1 && v < 2));
  // 收到的路線：先收下修點（改這面牆的岩點，沒有的補上），再檢查岩點與角色
  async function unpack(text, w) {
    return fromDoc(JSON.parse(new TextDecoder().decode(await pipe(unb64url(text), new DecompressionStream('deflate-raw')))), w);
  }
  // 短連結的線：從 Climbio 讀那條線的片段（路線節點＋修點 e），轉成連結裡一樣的內容再檢查、收下
  async function fetchRoute(pid, rid, w) {
    const f = await Backend.routeFragment(pid, rid), n = f && Array.isArray(f.nodes) ? f.nodes.find(x => x && x.id === rid && x.type === 'route') : null;
    if (!n) throw new Error('no route');
    const p = n.props || {};
    const g = p.grade && typeof p.grade === 'object' ? p.grade.v || p.grade.dan || p.grade.font || '' : '';   // 難度在節點裡是 { v: 'V3' }／{ dan }／{ font }
    return fromDoc({ n: n.name || '', g, h: p.holds, ...(p.seq ? { q: p.seq } : {}), ...(p['climbio:feetFree'] ? { f: 1 } : {}), ...(f.e ? { e: f.e } : {}) }, w);
  }
  async function fromDoc(d, w) {
    if (!d || typeof d.h !== 'object' || Array.isArray(d.h)) throw new Error('bad route');
    const e = d.e && typeof d.e === 'object' && !Array.isArray(d.e) ? Object.entries(d.e).filter(([id, m]) => HOLD_ID.test(id) && validM3(m)) : [];
    if (e.length) await adopt(w, e);
    const ids = new Set(w.holds.map(h => h.id)), roles = new Set(['s', 'h', 'f', 't']);
    if (!Object.entries(d.h).every(([id, k]) => ids.has(id) && roles.has(k))) throw new Error('bad route');
    const seq = Array.isArray(d.q) && d.q.every(id => ids.has(id)) ? d.q : null;
    return { name: String(d.n || '').slice(0, 80), grade: String(d.g || '').slice(0, 24), holds: d.h, ...(seq ? { seq } : {}), ...(d.f === 1 ? { feetFree: true } : {}) };
  }
  // 收下修點：套到模型上，算出正面的外框存進這面牆
  async function adopt(w, e) {
    for (const [id, m3] of e) {
      const h = w.holds.find(x => x.id === id);
      if (h) { h.m3 = { c: m3.c, p: m3.p }; touch(h); } else w.holds.push(touch({ id, poly: [], source: 'manual', m3: { c: m3.c, p: m3.p } }));
    }
    const stage = await stageOf(w.pid), edits = w.holds.filter(h => h.m3).map(h => ({ id: h.id, m3: h.m3 }));
    stage.resetTilt();
    const ids = stage.setEdits(edits), fr = new Map(stage.frontOutlines(ids).map(h => [h.id, h.poly]));
    stage.editSig = JSON.stringify(edits);
    for (const h of w.holds) if (fr.has(h.id)) h.poly = fr.get(h.id);
    w.holds = w.holds.filter(h => h.poly.length >= 3);   // 套不上的（從這面牆的模型看不到）不留
  }
  const linkOf = (href) => {
    const u = new URL(href), pid = u.searchParams.get('m3d');
    const rid = u.searchParams.get('rid') || '';
    return PID.test(pid || '') ? { pid, r: u.searchParams.get('r') || '', rid: HOLD_ID.test(rid) ? rid : '' } : null;
  };
  // 牆面卡片、首頁的縮圖：快照裁到岩點的範圍（四周留一點邊），不要整張快照（牆外、天花板、地板的灰色佔掉大半）
  // 卡片那一塊（快照的像素）：Studio 烘焙開場影片的第一格也照這個框（wall3dkit/bakepack.js 的 bakeIntro）
  function cardRect(holds, W, H) {
    const pts = holds.filter(h => h.poly && h.poly.length).flatMap(h => h.poly);
    if (!pts.length) return null;
    const b = bbox(pts), pad = 0.05 * Math.max(b.x1 - b.x0, b.y1 - b.y0);
    return [Math.max(0, Math.floor(b.x0 - pad)), Math.max(0, Math.floor(b.y0 - pad)), Math.min(W, Math.ceil(b.x1 + pad)), Math.min(H, Math.ceil(b.y1 + pad))];
  }
  function cardPhoto(snap, holds) {
    const r = cardRect(holds, snap.width, snap.height);
    if (!r) return snap;
    const [x0, y0, x1, y1] = r, c = document.createElement('canvas'); c.width = x1 - x0; c.height = y1 - y0;
    c.getContext('2d').drawImage(snap, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
    return c;
  }
  const jpeg = (c) => new Promise((ok, no) => c.toBlob(b => b ? ok(b) : no(new Error('snapshot')), 'image/jpeg', AppKit.photo.QUALITY.crop));
  // 第一次打開這面牆：快照當照片、正面外框當岩點，存成一面牆。
  // 成品包：只讀 wall.json 和快照就建好（不等模型），模型同時在背景下載、處理（存進這台，之後打開不用再下載）
  async function create(pid) {
    const m = await stageModule(), pack = await m.loadPack(base(pid)), fr = await m.openFront(base(pid), pack);
    const stage = fr ? null : await stageOf(pid, pack), snap = fr ? fr.snapshot : stage.snapshot(), blob = await jpeg(snap), name = fr ? fr.name : stage.pack.name;
    const w = { ...newWallRecord(snap, '', pid), ...(name ? { name } : {}), m3d: fr ? fr.sig : stage.sig, detected: 1 };
    w.holds = (fr ? fr.outlines : stage.outlines()).map(h => ({ ...h, source: 'detect' }));
    if (fr) stageOf(pid, pack).catch(() => {});
    Object.assign(w, wallThumbs(cardPhoto(snap, w.holds)));
    await putNewWall(w, blob);
    return w;
  }
  // 資料包換了（重新輸出、在 Climbio Studio 改了隱藏的面或不是岩點的）：快照、岩點外框照新的重做；路線、修點留著
  async function refresh(w, stage) {
    stage.resetTilt();
    const edits = w.holds.filter(h => h.m3).map(h => ({ id: h.id, m3: h.m3 }));
    stage.setEdits(edits); stage.editSig = JSON.stringify(edits);
    const snap = stage.snapshot(), blob = await jpeg(snap), had = new Map(w.holds.map(h => [h.id, h]));
    w.holds = stage.outlines().map(h => had.has(h.id) ? touch({ ...had.get(h.id), poly: h.poly }) : { ...h, source: 'detect' });
    Object.assign(w, { w: snap.width, h: snap.height, ...wallThumbs(cardPhoto(snap, w.holds)), m3d: stage.sig });
    front.delete(w.id);
    await putImage(w.id, blob); await putWall(w);
  }
  const refreshing = new Map();   // 牆 id → 正在重做的 Promise（同一面牆一次只做一個，做完再比對一次）
  async function current(w) {
    const stage = await stageOf(w.pid);
    while (refreshing.has(w.pid)) await refreshing.get(w.pid).catch(() => {});
    if (w.m3d !== stage.sig) {
      const job = refresh(w, stage);
      refreshing.set(w.pid, job);
      try { await job; } finally { refreshing.delete(w.pid); }
    }
    return stage;
  }
  // 配對的裝置之間同步 3D 牆（附近交換）：模型不用傳（兩台各自從發佈處下載），只傳這面牆的 id 和路線（含修點）；路線 id 照舊，已經有的不重複加
  function packRoutes(w) {
    const routes = w.routes.filter(r => r.holds && Object.values(r.holds).includes('s') && Object.values(r.holds).includes('t')).map(r => {
      const e = Object.fromEntries(w.holds.filter(h => h.m3 && r.holds[h.id]).map(h => [h.id, h.m3]));
      return { id: r.id, t: r.t || 0, n: r.name || '', g: r.grade || '', h: r.holds, ...(r.seq ? { q: r.seq } : {}), ...(r.feetFree ? { f: 1 } : {}), ...(Object.keys(e).length ? { e } : {}), ...(r.own ? { own: 1 } : {}), ...(r.sent ? { s: 1 } : {}) };
    });
    return { m3d: w.pid, name: w.name || '', routes };
  }
  async function takeRoutes(doc) {
    if (!doc || !PID.test(doc.m3d || '') || !Array.isArray(doc.routes)) throw new Error('bad m3d');
    let w = await wallOf(doc.m3d);
    if (!w) w = await create(doc.m3d);
    let changed = false;
    let counted = false;
    for (const d of doc.routes.slice(0, 500)) {
      if (!d || typeof d.id !== 'string') continue;
      const old = w.routes.find(r => r.id === d.id), dt = Number.isFinite(d.t) && d.t ? d.t : 0;
      try {
        if (!old) { const x = await fromDoc(d, w); w.routes.push(touch({ id: d.id, ...x, own: d.own ? 1 : 0, ...(dt ? { t: dt } : {}) })); changed = true; }
        else if (dt > (old.t || 0)) { const x = await fromDoc(d, w); delete old.seq; delete old.feetFree; Object.assign(old, x, { t: dt }); changed = true; }   // 對方改過這條線（名稱、難度、岩點、順序）：用比較新的
      } catch (e) { console.warn('3D 路線略過', e); continue; }
      const mine = w.routes.find(r => r.id === d.id);
      if (d.s && mine && !isSent(mine)) { mine.sent = 1; const g = mine.grade || '?'; stats[g] = (stats[g] || 0) + 1; changed = counted = true; }   // 完攀只增不減（跟 applyRecords 一樣）
    }
    if (counted) lsSet(STATS_KEY, stats);
    if (changed) await putWall(w);
    return w;
  }
  // 收到 3D 牆的連結：沒有這面牆就下載，帶了路線就加進來（同樣的點和角色已經有就打開那條）
  // 這台的哪一面牆：牆 id、目前的版本編號，或跟過的舊版本編號（w.was）都算同一面
  async function wallOf(pid) {
    const m = (await listMetas().catch(() => [])).find(x => x.id === pid || x.pid === pid || (x.was || []).includes(pid));
    return m ? getWall(m.id) : null;
  }
  // 自動跟新版（跟 2D 公開牆一樣：打開牆、回到前景時問，同一面牆至少隔 5 分鐘）：每次 Studio 發佈都是新的版本編號，
  // 這面牆的岩館清單（找牆面同一份）裡同一面牆的最新版，沿著 patch.json 的 parent 往回找得到這台的版本，就是它的新版。
  // 換成新版：版本編號換掉、舊的記在 was，資料包換了照 current 重做快照與外框，路線、修點留著
  const asked = new Map();
  async function followNewer(w) {
    if (!w || !w.m3d || navigator.onLine === false || Date.now() - (asked.get(w.id) || 0) < 5 * 60 * 1000) return false;
    asked.set(w.id, Date.now());
    const get = async (u) => { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error(r.status); return r.json(); };
    const gym = (await get(new URL('index.json', base(w.pid)).href)).gym;
    if (!gym) return false;
    const mine = new Set([w.pid, ...(w.was || [])]);
    const items = (await ShareTools.gymWalls('https://climbio.app', gym)).filter(x => x.m3d && PID.test(x.pid || '') && !mine.has(x.pid)).sort((a, b) => (b.t || 0) - (a.t || 0));   // 找牆面的同一份 index
    for (const x of items) {
      let id = x.pid;
      for (let hop = 0; hop < 30 && id; hop++) {
        const parent = await get(new URL('patch.json', base(id)).href).then(p => p.parent, () => null);
        if (!parent) break;
        if (mine.has(parent)) {
          const old = w.pid;
          w.was = [...(w.was || []), old].slice(-20); w.pid = x.pid; touch(w);
          await putWall(w);
          listMetas().then(ms => { if (!ms.some(m => m.id !== w.id && m.pid === old)) return dropPack(old); }).catch(() => {});   // 舊版的舞台與模型快取沒有別的牆用就清掉（由 dropPack 一併 dispose）
          return true;
        }
        id = parent;
      }
    }
    return false;
  }
  async function receive(href) {
    const c = linkOf(href);
    if (!c) return false;
    toast(t('loading'), { busy: true });
    try {
      let w = await wallOf(c.pid);
      if (!w) w = await create(c.pid);   // 已經有這面牆：直接打開，資料包換過沒有在背景比對（show），牆頁不用等模型
      let rid = null;
      if (c.r || c.rid) {
        const x = c.r ? await unpack(c.r, w) : await fetchRoute(c.pid, c.rid, w), r = touch({ id: uid('r'), ...x, own: 0 });
        w.routes.push(r); rid = r.id;
        await putWall(w);
      }
      hideToast();
      await openWall(w.id);
      if (rid && state.wall && state.wall.id === w.id) openRoute(rid);
    } catch (e) {
      hideToast(); console.error(e); showAlert(t('shareNotFound'));
    }
    return true;
  }
  // 打開一面牆：3D 牆先在背景載好模型（只載資料，不開 WebGL）；換到別的牆就把上一面的 3D 關掉
  // 資料包換過就在背景重做快照，做好了重新打開這面牆；已經在看線、定線就原地換上新的快照
  function show(w) {
    leave();
    if (!w.m3d) return;
    const was = w.m3d;
    for (const [pid, job] of stages) if (pid !== w.pid) job.then(s => s.dispose(), () => {});   // 別面牆的 WebGL 放掉（一次只留一個）
    followNewer(w).catch(e => { console.warn('3D 牆新版沒查到', e); return false; }).then(() => current(w)).then(async (stage) => {
      if (w.m3d === was && state.wall === w && $('editor').hidden) setTimeout(() => stage.warm(), 0);   // 背景暖機：進看線、定線不用再等
      if (w.m3d === was || state.wall !== w) return;
      return $('editor').hidden ? openWall(w.id) : swapPhoto(w);
    }).catch((e) => { console.warn('3D 牆背景載入失敗（進定線時再試）', e); });   // 背景預載失敗不跳「無法連線」：使用者還沒要用，進看線、定線時再試一次
  }
  // 外框、尺寸已經是新快照的：照片和 RouteScene 跟著換，畫面照新的尺寸重排，標籤、小卡才對得上
  async function swapPhoto(w) {
    const c = await blobToCanvas(await getImage(w.id));
    if (state.wall !== w) return;
    state.scene.release(); state.img = c; state.w = c.width; state.h = c.height; state.imgOf = w.m3d;
    cv.width = state.w; cv.height = state.h;
    state.scene = RouteKit.scene(c, () => w.holds); state.ana = null;
    layoutStage(true); showRouteFit();
    if (state.w3d) scope(); else render();
  }
  // 進看線、定線（編輯畫面）才開 3D；回到牆面頁（路線卡片）就關掉，WebGL 一起釋放
  // 沿牆鏡頭的牆：從 2D 的畫面（從牆面卡片放大進來時是卡片的樣子，見 flyFrom）飛進牆前（stage.flyIn）。3D 第一格跟拿掉 2D 在同一個工作裡，不會黑一下。
  // 第一次打開（模型還沒載好）先蓋上「3D 準備中」，好了才飛進去：使用者知道要等，不會以為好了、定線才發現不順
  // 飛進牆前：慢慢起步、慢慢停（cubic-bezier(.4, 0, .2, 1)，編輯頁展開用同一條）
  const FLY_MS = 1400, FLY_EASE = [0.4, 0, 0.2, 1];
  const ease = (x) => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    const [x1, y1, x2, y2] = FLY_EASE, B = (t, p1, p2) => 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3;
    let a = 0, b = 1; for (let i = 0; i < 24; i++) { const m = (a + b) / 2; if (B(m, x1, x2) < x) a = m; else b = m; }
    return B((a + b) / 2, y1, y2);
  };
  let fly = null, wait = null, flying = false;
  function enter() {
    const w = state.wall;
    if (!w || !w.m3d || state.w3d) return;
    if (!ready.has(w.pid) && !wait) {
      wait = preparing();
      const f = fitAll(); setView(f.s, f.tx, f.ty);   // 準備中蓋在下面的 2D 照片：整面牆（不要停在編輯頁剛開時的某個局部），3D 好了從這個樣子飛進牆前
    }
    stageOf(w.pid).then((stage) => {
      const f = fly, wt = wait; fly = null; wait = null;
      if (state.wall !== w || $('editor').hidden || state.w3d) { if (wt) wt.close(); return; }
      stage.resetTilt(); front.delete(w.id);
      stage.mount($('stage'), cv); stage.setView(view);
      state.w3d = stage;
      if (!stage.along) {
        const c = still(); scope(); c.ready(); if (wt) wt.close();
        const r = route();
        if (state.mode === 'route' && !state.routeView && r && !Object.keys(r.holds).length) introZoom();
        return;
      }
      flying = true; cv.style.visibility = 'hidden';
      stage.renderer.domElement.style.visibility = 'hidden';   // 剛掛上的 3D 畫面還在家的位置（正面），第一次進入時主執行緒忙著量鏡頭，會停在那一格：飛進的第一格畫好才顯示
      const t0 = performance.now();
      const r = route(), ids = state.routeView && r && Object.keys(r.holds).length ? Object.keys(r.holds) : null;   // 看線：飛到框住這條路線的位置
      let landed = false;
      const land = (v1) => {
        if (landed) return; landed = true; clearTimeout(dog);
        flying = false; cv.style.visibility = ''; if (stage.renderer) stage.renderer.domElement.style.visibility = '';
        if (state.w3d !== stage) return;
        if (!v1) { along(stage); return; }   // 2D 畫面還沒排好（量不到）：照舊從畫面中央那一點換成沿牆鏡頭
        walking = true; setView(v1.s, v1.tx, v1.ty); walking = false; inside = { s: view.s, tx: view.tx, ty: view.ty };
        Object.assign(stage.glide, inside);
        along(stage);
      };
      // 飛進去出錯、或主執行緒卡住太久沒結束：不能讓畫面停在全黑（2D 已藏、3D 還沒顯示），直接降到沿牆鏡頭的位置
      const dog = setTimeout(() => { console.warn('3D 飛進逾時，直接就位'); land(null); }, FLY_MS + 6000);
      stage.flyIn(f ? f.v0 : { ...view }, f ? f.progress : () => ease((performance.now() - t0) / FLY_MS), ids, f && f.at).then(land, (e) => { console.warn('3D 飛進失敗', e); land(null); });
      if (wt) wt.close();
      scope();
    }, (e) => { if (wait) { wait.close(); wait = null; } fly = null; console.warn(e); if (state.wall === w && !$('editor').hidden) toast(t('netOffline')); });   // 真的要用 3D 了還是載不到：才提示
  }
  // 模型還沒載好：舞台上蓋著「3D 準備中」（2D 的照片在下面），途中不能操作；等的時候示範調角度的手勢（手機兩指同向左右移，滑鼠右鍵左右拖）
  function preparing() {
    const el = document.createElement('div'), sp = document.createElement('i'), tx = document.createElement('span'), demo = document.createElement('div'), hint = document.createElement('small'), mouse = matchMedia('(hover: hover) and (pointer: fine)').matches;
    el.className = 'w3d-wait'; tx.textContent = t('w3dPreparing'); demo.className = 'w3d-demo'; demo.append(document.createElement('b')); if (!mouse) demo.append(document.createElement('b')); hint.textContent = t(mouse ? 'w3dAngleHintMouse' : 'w3dAngleHint');
    el.append(sp, tx, demo, hint); $('stage').append(el);
    for (const k of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel', 'click', 'contextmenu']) el.addEventListener(k, e => e.stopPropagation());
    return { close() { el.classList.add('out'); setTimeout(() => el.remove(), 300); } };
  }
  // 換成 3D 的那一下（沒有沿牆鏡頭的舊資料包）：把舞台現在的樣子（2D 的照片）拍下來蓋著，3D 畫好了才淡出
  function still() {
    const st = $('stage'), el = document.createElement('div'), c = document.createElement('canvas'), dpr = devicePixelRatio || 1;
    const sr = st.getBoundingClientRect(), r = cv.getBoundingClientRect();
    c.width = Math.round(sr.width * dpr); c.height = Math.round(sr.height * dpr); Object.assign(c.style, { width: '100%', height: '100%' });
    c.getContext('2d').drawImage(cv, (r.left - sr.left) * dpr, (r.top - sr.top) * dpr, r.width * dpr, r.height * dpr);
    el.className = 'w3d-still'; el.append(c); st.append(el);
    const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 300); };
    return { ready() { requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(close))); } };
  }
  // 從牆面卡片進定線（js/wall.js 的 startNewRoute，在 enter 之後同一個工作裡呼叫）：3D 已經載好才接手——
  // 3D 第一格畫成卡片的樣子（卡片那一塊正好在卡片的位置上），飛進牆前；編輯頁看得到的範圍同時從卡片展開。還沒載好（蓋著準備中）回 null
  function flyFrom(from, card) {
    const w = state.wall, stage = w && w.m3d && ready.get(w.pid);
    if (!stage || !stage.along || state.w3d || wait || !view.bw || !card.naturalWidth) return null;
    // 卡片的圖是哪一塊：長寬比跟快照一樣就是整張快照（牆面頁的大圖），不然是岩點範圍那一塊（cardPhoto）
    const r = Math.abs(card.naturalWidth / card.naturalHeight - w.w / w.h) < 0.01 ? [0, 0, w.w, w.h] : cardRect(w.holds, w.w, w.h);
    if (!r) return null;
    const st = $('stage').getBoundingClientRect();
    // 照 object-fit 放進卡片：快照（照片的像素）的原點在畫面上的位置 (ox, oy)、每像素 sc 點
    const cw = r[2] - r[0], ch = r[3] - r[1], sc = getComputedStyle(card).objectFit === 'contain' ? Math.min(from.width / cw, from.height / ch) : Math.max(from.width / cw, from.height / ch);
    const ox = from.left + from.width / 2 - (r[0] + cw / 2) * sc, oy = from.top + from.height / 2 - (r[1] + ch / 2) * sc;
    // 換成舞台上的 2D 畫面（快照像素 × bw·s／快照寬 ＋ t）
    const K = sc * w.w / stage.snapW, t0 = performance.now();
    fly = { v0: { ...view, s: K * stage.snapW / view.bw, tx: ox - st.left, ty: oy - st.top }, at: [from.left + from.width / 2 - st.left, from.top + from.height / 2 - st.top], progress: () => ease((performance.now() - t0) / FLY_MS) };
    return { ms: FLY_MS, easing: `cubic-bezier(${FLY_EASE.join(',')})` };
  }
  // 沿牆走的鏡頭：一進來就換成沿牆的（快照的畫面動畫換過去，不等第一次摸畫面），停了再重投外框
  function along(stage) {
    const t0 = performance.now(), tick = () => {
      if (state.w3d !== stage) return;
      walk();
      if (performance.now() - t0 < 500) requestAnimationFrame(tick); else retrace();
    };
    requestAnimationFrame(tick);
  }
  // 標籤閃開的岩點只算這個角度看得到的：被擋住的岩點投到畫面上會跟看得到的疊在一起，標籤被推開
  function scope() {
    const w = state.wall, vis = state.w3d.visibleIds();
    state.scene.holds = () => w.holds.filter(h => vis.has(h.id));
    touchGeom(); render();
  }
  function leave() {
    if (!state.w3d) return;
    untilt();
    const w = state.wall; if (state.scene && w) { state.scene.holds = () => w.holds; touchGeom(); }
    state.w3d.unmount(); state.w3d = null;   // 顯示卡上的東西留著（暖過的），下次進來直接用；換別面牆時才放掉（show）
  }
  // 轉角度、走近、拖曳：岩點外框換成這個角度投到畫面上的（標籤、手順、路線範圍跟著走）；存檔還是正面的。
  // 途中每格重投整面牆（stage.outlines 只投候選點，幾毫秒），放手再整理一次（scope）
  let following = 0;
  function follow() {
    if (following) return;
    following = requestAnimationFrame(() => { following = 0; retrace(false); });
  }
  function retrace(done = true) {
    const w = state.wall, stage = state.w3d;
    if (done) { cancelAnimationFrame(following); following = 0; }
    if (!w || !stage || !stage.tilted) return;
    if (!front.has(w.id)) front.set(w.id, new Map(w.holds.map(h => [h.id, h.poly])));
    const now = new Map(stage.outlines(null, !done).map(h => [h.id, h.poly]));   // 途中只算畫面裡的，放手那一次整面牆
    for (const h of w.holds) if (now.has(h.id)) h.poly = now.get(h.id);
    if (done) scope(); else { touchGeom(); render(); }
  }
  // 放大、拖曳：鏡頭像人往畫面中央那一點走近、對著它（stage.walk），水平線不變；途中只重投路線上的岩點，手指放開再全部重投。改岩點時不動
  // 縮放結束：範圍從粗刻度換回精確值。精確的範圍要上萬次射線，第一次算放在放手這一刻，不要等到下一次拖動才卡一下
  function endZoom() {
    const stage = state.w3d;
    if (!stage || !stage.wc || !stage.wc.coarse) return;
    stage.wc.coarse = false; stage.wc.clamp(); walk();
  }
  // 畫面中央拖到牆外：退回上一個中央還在牆上的視角（左右滑到牆的盡頭就停）
  let walking = false, inside = null;
  // at：手指在畫面（#stage）上的位置，沿牆走的鏡頭讓手指底下那一點跟著手指
  function walk(at = null) {
    const stage = state.w3d;
    if (!stage || walking || flying || state.mode !== 'route') return;
    const n = stage.walk(view, at);
    if (n === false) { if (inside) { walking = true; setView(inside.s, inside.tx, inside.ty); walking = false; } return; }
    if (!n) { inside = { s: view.s, tx: view.tx, ty: view.ty }; return; }
    walking = true; setView(n.s, n.tx, n.ty); walking = false; inside = { s: view.s, tx: view.tx, ty: view.ty };
    Object.assign(stage.glide, inside);   // 畫面框被夾住時以實際的為準，下一格才不會當成手指拖了
    follow();   // 途中只重投路線上的岩點；整面牆在手指放開時重投（mobile.js），拖到一半停一下不會卡
  }
  // 看線（js/wall.js 的 showRouteFit）：沿牆走的鏡頭直接走到框住這條路線的位置（不用 2D 的縮放，2D 的縮放換算成沿牆走會亂掉）。不是沿牆鏡頭回 false
  function frame(r) {
    const stage = state.w3d, ids = r && Object.keys(r.holds);
    if (!stage || !stage.along || !stage.glide || flying || !ids || !ids.length) return !!(stage && stage.along && flying);   // 飛進來的途中：飛完就停在路線（enter 給了 ids）
    stage.frameTo(ids, follow).then((v) => {
      if (state.w3d !== stage || !v) return;
      walking = true; setView(v.s, v.tx, v.ty); walking = false; inside = { s: view.s, tx: view.tx, ty: view.ty };
      Object.assign(stage.glide, inside); retrace();
    });
    return true;
  }
  // 偷看放手：鏡頭彈回軌道上的位置，途中重投路線上的岩點，停了再全部重投
  function settle() {
    const stage = state.w3d;
    if (!stage) return;
    stage.settle(follow).then(() => { if (state.w3d === stage) retrace(); });
  }
  // 換線、離開牆頁：轉回正面
  function untilt() {
    const w = state.wall, stage = state.w3d, was = w && front.get(w.id);
    inside = null;
    if (!stage) return;
    if (stage.along && stage.glide && !$('editor').hidden) {   // 沿牆走的鏡頭：鏡頭留在牆前（接著 frame 走到下一條線），外框先換回正面的（存檔、畫小圖用）
      if (was) { for (const h of w.holds) if (was.has(h.id)) h.poly = was.get(h.id); front.delete(w.id); }
      return;
    }
    if (!stage.resetTilt()) return;
    if (was) { for (const h of w.holds) if (was.has(h.id)) h.poly = was.get(h.id); front.delete(w.id); scope(); }
  }
  // 修點：改過外框或補上的岩點記著修點（h.m3：當時的角度＋多邊形），每次畫之前比對，變了就從原始的重套
  // （復原、取消、刪掉、收到連結都只是改 w.holds）；改到的岩點外框照目前角度重投，正面的留著存檔
  function sync() {
    const w = state.wall, stage = state.w3d;
    if (!w || !stage) return;
    const edits = w.holds.filter(h => h.m3).map(h => ({ id: h.id, m3: h.m3 })), sig = JSON.stringify(edits);
    if (sig === (stage.editSig || '[]')) return;
    stage.editSig = sig;
    const ids = stage.setEdits(edits);
    if (!ids.size) return;
    const now = new Map(stage.outlines(ids).map(h => [h.id, h.poly])), fr = new Map(stage.frontOutlines(ids).map(h => [h.id, h.poly])), was = front.get(w.id);
    for (const h of w.holds) if (ids.has(h.id)) {
      if (now.has(h.id)) h.poly = now.get(h.id);
      if (was && fr.has(h.id)) was.set(h.id, fr.get(h.id));
    }
    scope();
  }
  // 離開單點編輯：這顆改了外框（或是剛補的），記下修點
  function edited(h, start) {
    if (!state.w3d || !h || !state.wall.holds.includes(h)) return;
    const was = start && JSON.parse(start).holds.find(x => x.id === h.id);
    if (was && JSON.stringify(was.poly) === JSON.stringify(h.poly)) return;
    h.m3 = state.w3d.editSpec(h.poly); touch(h); save();
  }
  // 補點的形狀：從按的地方依顏色長出一塊（跟按的那一點顏色接近、半徑 90 個螢幕點內），用它的範圍當框，
  // 照 2D 偵測岩點描外框的方法（HoldKit.boxToPoly：框外一圈是牆，分出岩點的顏色取最大的連通區域）描出來。(x, y)、others 是照片座標
  function grow(x, y, others) {
    const stage = state.w3d;
    if (!stage) return null;
    const shot = stage.viewShot(), { data, width: W, height: H } = shot, k = view.bw * view.s / state.w;
    const sx = Math.round(view.tx + x * k), sy = Math.round(view.ty + y * k);
    if (sx < 1 || sy < 1 || sx >= W - 1 || sy >= H - 1) return null;
    let r0 = 0, g0 = 0, b0 = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const i = ((sy + dy) * W + sx + dx) * 4; r0 += data[i]; g0 += data[i + 1]; b0 += data[i + 2]; }
    r0 /= 9; g0 /= 9; b0 /= 9;
    const R = 90, seen = new Uint8Array(W * H), stack = [sy * W + sx];
    let x0 = sx, y0 = sy, x1 = sx, y1 = sy, n = 0;
    seen[sy * W + sx] = 1;
    while (stack.length) {
      const p = stack.pop(), px = p % W, py = (p / W) | 0;
      n++; x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      for (const q of [p - 1, p + 1, p - W, p + W]) {
        const qx = q % W, qy = (q / W) | 0;
        if (q < 0 || q >= W * H || seen[q] || Math.abs(qx - px) > 1 || Math.hypot(qx - sx, qy - sy) > R) continue;
        seen[q] = 1;
        const i = q * 4;
        if (Math.hypot(data[i] - r0, data[i + 1] - g0, data[i + 2] - b0) < 40) stack.push(q);
      }
    }
    if (n < 30) { x0 = sx - 12; x1 = sx + 12; y0 = sy - 12; y1 = sy + 12; }   // 顏色長不出來：按的地方附近一小塊
    const m = Math.max(4, 0.15 * Math.max(x1 - x0, y1 - y0));
    const toS = (b) => [view.tx + b.x0 * k, view.ty + b.y0 * k, view.tx + b.x1 * k, view.ty + b.y1 * k];
    const ctx = HoldKit.outlineContext({ data, w: W, h: H, s: 1 }, others.map(h => toS(bbox(h.poly))));
    const poly = HoldKit.boxToPoly(Math.max(0, x0 - m), Math.max(0, y0 - m), Math.min(W - 1, x1 + m), Math.min(H - 1, y1 + m), ctx)
      .map(([px, py]) => [+((px - view.tx) / k).toFixed(1), +((py - view.ty) / k).toFixed(1)]);
    return poly.length >= 3 && validAddedOutline(poly, x, y, others) ? poly : null;
  }
  // 3D 的重疊選點：點到的地方射線穿過好幾顆、或附近有被大岩點擋住的小點，沿牆鏡頭轉到露出最多顆的角度、走近一點（stage.revealAt），
  // 停了重投外框再交給 2D 的候選圓點選（js/edit.js openOverlapPick）。回傳 Promise：候選的岩點（兩顆以上）和回程要的鏡頭；不是重疊回 null
  function reveal(x, y) {
    const stage = state.w3d, k = view.bw * view.s / state.w;
    if (!stage || !stage.along || !stage.glide || flying) return Promise.resolve(null);
    const r = stage.revealAt(view.tx + x * k, view.ty + y * k);
    if (!r) return Promise.resolve(null);
    const wc = stage.wc, back = { s: wc.s, v: wc.v, d: wc.d, yaw: wc.yaw || 0 };
    const done = () => {
      const holds = r.ids.map(id => state.wall.holds.find(h => h.id === id)).filter(h => h && h.poly && h.poly.length >= 3);
      return holds.length >= 2 ? { holds, back } : null;
    };
    if (!r.to) return Promise.resolve(done());
    return stage.flyWalk(r.to, follow, 420).then((v) => {
      if (state.w3d !== stage || !v) return null;
      walking = true; setView(v.s, v.tx, v.ty); walking = false; inside = { s: view.s, tx: view.tx, ty: view.ty };
      Object.assign(stage.glide, inside); retrace();
      return done();
    });
  }
  // 選好（或取消）重疊的岩點：飛回點之前的位置和角度
  function flyBack(back) {
    const stage = state.w3d;
    if (!stage || !back) return;
    stage.flyWalk(back, follow, 360).then((v) => {
      if (state.w3d !== stage || !v) return;
      walking = true; setView(v.s, v.tx, v.ty); walking = false; inside = { s: view.s, tx: view.tx, ty: view.ty };
      Object.assign(stage.glide, inside); retrace();
    });
  }
  const frontHolds = (w) => { const was = front.get(w.id); return was && w.holds.map(h => was.has(h.id) ? { ...h, poly: was.get(h.id) } : h); };
  // 照片座標 (x, y) 點到的岩點（牆頁上的 2D 程式都用照片座標）
  function holdAt(x, y) {
    const stage = state.w3d, k = view.bw * view.s / state.w;
    const rank = (id) => { const h = state.wall.holds.find(o => o.id === id); return h && RouteKit.inPoly(x, y, h.poly) ? RouteKit.area(h.poly) : null; };   // 點在外框裡的，外框小的優先（同 2D）
    const id = stage.pick(view.tx + x * k, view.ty + y * k, 22, rank);
    return id ? state.wall.holds.find(h => h.id === id) || null : null;
  }
  // 刪牆：這面牆的資料包（模型、面標籤、快照、鏡頭表）從模型快取拿掉，不然手機上的檔案只增不減；記憶體裡的舞台也放掉。呼叫端先確認沒有別的牆用同一包
  async function dropPack(pid) {
    const job = stages.get(pid); stages.delete(pid); ready.delete(pid);
    if (job) job.then(s => s.dispose(), () => {});
    if (!self.caches) return;
    const hk = ((((document.querySelector('meta[name="app-version"]') || {}).content) || '').match(/-hk[^-]+$/) || [''])[0];
    const c = await caches.open('hold-models' + hk), prefix = base(pid);
    await Promise.all((await c.keys()).filter(r => r.url.startsWith(prefix)).map(r => c.delete(r)));
  }
  // 回到前景：正在看的 3D 牆也問一次有沒有新版（看線、定線中不換）
  document.addEventListener('visibilitychange', () => {
    const w = state.wall;
    if (document.visibilityState !== 'visible' || !w || !w.m3d || !$('editor').hidden) return;
    followNewer(w).then(ok => { if (ok && state.wall === w && $('editor').hidden) show(w); }, () => {});
  });
  const warmed = async (w) => { const job = w && stages.get(w.pid); return !!job && !!(await job).warmed; };   // 測試用：背景暖機做完了沒
  return { enabled: true, dropPack, warmed, linkOf, receive, show, enter, flyFrom, frame, leave, sync, edited, grow, follow, retrace, settle, untilt, walk, endZoom, frontHolds, holdAt, reveal, flyBack, link, fragment, shortLink, packRoutes, takeRoutes };
})();
