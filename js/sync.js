// Climbio 分享：本機路線、公開連結、附近交換與公開牆讀取。帳號不負責跨裝置同步。
// 依序載入（app → home → profile → add-wall → edit → wall → sync → draw → export → mobile → tour → main），共用同一個全域範圍；載入當下只能用到前面檔案宣告的東西。
// English: Sharing and sync: Google account, share routes, share screen, per-account device sync, receiving shares.
'use strict';
  // ---------- 分享：新線只留在手機；按分享才批次傳送，私人列表與公開牆共用底圖 ----------
  // 路線保留既有 id，成功才記內容指紋及分享方式；失敗不排入重試佇列。
  // r.pub＝跟伺服器上那份一樣的內容指紋（傳上去或讀下來時記），r.own＝伺服器上這條是目前的帳號傳的（只有它能改、能刪）。
  // 讀公開牆見 pullWall
  // 沒有帳號（docs/proposals/open-versions.md）：名字只有暱稱（附近交換、分享用）
  function renderAccount() {
    $('hmName').textContent = AppKit.nearby.nickname() || t('signNone');
    AppKit.account.avatar($('homeAvatar'), null); AppKit.account.avatar($('hmAvatar'), null);
  }
  // 分享出去的線的連結。公開的：/r/{照片編號}/{路線 id}/（線存在 Climbio 的 wallRoutes，伺服器組出那條線的圖層，牆的畫面在 Climbio 的公開資料集裡）；
  // 連結本身就是固定網址（牆 id＋路線 id）
  const wallBase = (w) => `/r/${w.pid}/`;
  const routeLink = (w, r) => location.origin + `${wallBase(w)}${encodeURIComponent(r.id)}/`;
  const newPid = () => AppKit.files.rid(16);
  // 分享出去的路線都帶出線者（author）：自己出的用目前署名，收到的人看得到是誰出的；
  // 自己出的另外帶 u＝這台的手機 id：分享出去又收回來，「我的紀錄」照樣算是自己定的線（簽名改了也一樣）
  // 分享出去的線只帶這張照片的岩點：跨照片的路線（同一面牆別張照片的岩點「照片編號#岩點 id」）別人的手機不一定有那張照片
  const pubRoute = (r) => { const { pub, own, got, sharedMode, sent, ...x } = r, keep = (k) => !k.includes('#'), pick = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => keep(k))); if (Object.keys(x.holds || {}).some(k => !keep(k))) { x.holds = pick(x.holds); x.shapes = pick(x.shapes); if (x.seq) x.seq = x.seq.filter(keep); } return mineRoute(r) ? { ...x, author: signName(), u: deviceId() } : x; };
  const pubSig = (r) => hash53(JSON.stringify(['pack', pubRoute(r)]));   // 'pack'：一面牆一個分享包（之前分公開、私人兩個），分享過的線下次分享時放進新的包

  let shareCtx = null, shareBusy = false, shareLink = '';
  // 進行中的狀態只用 toast（不放進分享畫面，畫面高度才不會跳）；錯誤訊息放在畫面上
  const shStatus = (text, busy = false) => { if (busy) { toast(text, { busy: true }); text = ''; } $('shStatus').textContent = text; };
  function closeShare() { $('shareDialog').hidden = true; shareCtx = null; previewVersion++; routeBase = null; return closeOverlay('shareDialog'); }
  const BLANK_IMG = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';   // 透明的 1×1，給還沒有內容的 img
  // 分享畫面只有一頁：路線圖預覽、兩顆分享目標（圖片、連結）；尺寸、風格由路線自動決定。
  // 圖片只在本機產圖，不上傳；連結只給 Studio 公開牆，要把自己的線公開傳出去：沒同意過條款、沒有簽名就先出現簽名面板，填好才傳。
  // 左上是 × 離開
  // 舊版內建範例牆僅允許本機圖片分享；3D 牆由 W3D 產生不需伺服器的路線連結。
  const CONSENT_KEY = 'climbio.shareOk';   // 第一次分享路線連結在設定畫面說明（公開的路線進開放資料集、不能收回）並請使用者同意
  const pendingRoutes = w => !isPublic(w) ? [] : w.routes.filter(r => mineRoute(r) && routeReady(r) && r.pub !== pubSig(r));
  async function pendingShares(id = null) {
    const walls = new Map((await listWalls()).map(w => [w.id, w]));
    if (state.wall) walls.set(state.wall.id, state.wall);
    return [...walls.values()].filter(w => !hiddenWalls.has(w.id) && (!id || w.id === id)).flatMap(w => pendingRoutes(w).map(r => ({ id: w.id, rid: r.id })));
  }
  // 暱稱必填：公開的路線帶著出線者
  const updateShareSetup = () => { $('shAgree').disabled = !$('shSignature').value.trim(); };
  // ---------- 附近交換（appkit/nearby.js）：同一個網路的朋友互相看得到，確認後自由挑牆面互傳。一面牆＝照片、岩點、這面牆上的所有路線（公開格式 v2 的分享包），
  // 收下是安靜的（跟收連結同一個 saveSnap，只留在這台，不算公開牆），回首頁看得到 ----------
  const hex16 = (text) => AppKit.files.sha(text, 8);
  async function nearbyPack(pid, trusted) {
    const w = (await listWalls()).find(x => x.pid === pid);
    if (!w) throw new Error(t('shareNotFound'));
    if (w.m3d) return { name: w.name || '', entry: 'm3d.json', files: [{ path: 'm3d.json', bytes: new TextEncoder().encode(JSON.stringify(W3D.packRoutes(w))) }] };   // 3D 牆：只有配對的裝置之間傳（list 只在 trusted 時放），只傳路線
    const id = await hex16(`${deviceId()}:${pid}`), b = { name: w.name, w: w.w, h: w.h, thumb: w.thumb || '', t: w.createdAt || 0, ...w.base };
    const layerId = await hex16(`${id}:routes`);
    // 自己的另一台（配對的裝置）：連完攀的記錄、哪些線是我出的一起帶（路線本身不含這些）
    const records = trusted ? [{ path: 'records.json', bytes: new TextEncoder().encode(JSON.stringify({ sent: w.routes.filter(isSent).map(r => r.id), mine: w.routes.filter(mineRoute).map(r => r.id) })) }] : [];
    return ShareTools.wallBundle({ id, layerId, pid, name: w.name || '', gym: w.gym || '', w: b.w, h: b.h, thumb: b.thumb, holds: b.holds, routes: w.routes.filter(routeReady).map(pubRoute),
      photo: await asJpeg(await getImage(w.id)), attribution: signName(), version: Date.now(), t: b.t }, records);
  }
  async function nearbyTake(b, trusted) {
    if (b.entry === 'm3d.json') {
      if (!trusted) throw new Error('not trusted');
      await W3D.takeRoutes(JSON.parse(await (await ShareTools.open(b.url)).text()));
      if (!$('home').hidden) showHome();
      return;
    }
    const got = await ShareTools.fetchWall(b.url, b.id);
    const w = await saveSnap({ pid: b.id, name: b.name, gym: got.gym, nearby: true }, { ...got.base, name: got.base.name || b.name, routes: got.routes }, got.photo);
    if (trusted && (b.files || []).includes('records.json')) await applyRecords(w, JSON.parse(await (await ShareTools.open(b.url.replace(/[^/]+$/, 'records.json'))).text()));
    if (!$('home').hidden) showHome();
  }
  // 配對的裝置傳來的記錄：只增不減（完攀的留著、刪除不同步）；我出的線在這台也是我的
  async function applyRecords(w, rec) {
    const wall = await liveWall(w.id);
    if (!wall) return;
    const sent = new Set(Array.isArray(rec.sent) ? rec.sent : []), mine = new Set(Array.isArray(rec.mine) ? rec.mine : []);
    let changed = false, counted = false;
    for (const r of wall.routes) {
      if (mine.has(r.id) && !r.own) { r.own = 1; changed = true; }
      if (sent.has(r.id) && !isSent(r)) { r.sent = 1; const g = r.grade || '?'; stats[g] = (stats[g] || 0) + 1; changed = counted = true; }
    }
    if (counted) lsSet(STATS_KEY, stats);
    if (changed) await putWall(wall);
  }
  // 配對時交換裝置金鑰（公開牆上的身分）：兩台配對就是同一個人。這台還沒有金鑰就用對方的；兩台各有一把就都留著（`climbio.deviceKey.more`），
  // 兩台都能改兩把金鑰寫的線（backend/firebase.js 的 putRoutes 會換另一把重試）；新的線各自用自己的主金鑰
  const KEY_LS = 'climbio.deviceKey', MORE_LS = 'climbio.deviceKey.more';
  const readKeys = () => {
    const out = [];
    try { const main = JSON.parse(localStorage.getItem(KEY_LS)); if (main && main.kid) out.push(main); } catch (e) { /* 沒有 */ }
    try { for (const k of JSON.parse(localStorage.getItem(MORE_LS)) || []) if (k && k.kid && k.jwk && !out.some(x => x.kid === k.kid)) out.push(k); } catch (e) { /* 沒有 */ }
    return out;
  };
  const sharePair = async () => { try { const keys = readKeys(); return { deviceKey: keys.length ? JSON.stringify(keys[0]) : null, deviceKeys: keys.map(k => JSON.stringify(k)) }; } catch (e) { return {}; } };
  const takePair = async (data) => {
    try {
      const got = [...(data && Array.isArray(data.deviceKeys) ? data.deviceKeys : []), ...(data && typeof data.deviceKey === 'string' ? [data.deviceKey] : [])].slice(0, 8)
        .map(x => { try { const k = JSON.parse(x); return k && typeof k.kid === 'string' && /^[0-9a-f]{32}$/.test(k.kid) && k.jwk && typeof k.jwk.d === 'string' && typeof k.jwk.x === 'string' && typeof k.jwk.y === 'string' ? { kid: k.kid, jwk: k.jwk } : null; } catch (e) { return null; } }).filter(Boolean);
      const mine = readKeys();
      if (!mine.length && got.length) { localStorage.setItem(KEY_LS, JSON.stringify(got[0])); mine.push(got[0]); }
      const more = [...mine.slice(1)];
      for (const k of got) if (!mine.some(x => x.kid === k.kid) && !more.some(x => x.kid === k.kid)) more.push(k);
      if (more.length) localStorage.setItem(MORE_LS, JSON.stringify(more));
    } catch (e) { /* 存不了就各用各的 */ }
  };
  const nearbyAdapter = {
    app: 'hold', label: () => t('app'), suggested: '',
    list: async (trusted) => (await listWalls()).filter(w => (trusted ? !isDemoPid(w.pid) : !localOnly(w)) && w.base && w.base.holds).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .map(w => ({ id: w.pid, name: w.name || '', img: w.nearbyThumb || w.thumbHi || w.thumb || '', sub: t('routesN', w.routes.filter(routeReady).length), v: w.routes.filter(routeReady).flatMap(r => [`${r.id}:${r.t || 0}`, ...(trusted && isSent(r) ? [`${r.id}:sent`] : [])]) })),   // 內容＝可傳的路線（id:修改時間）；配對的裝置另外帶完攀（id:sent），對方沒有就補傳
    pack: nearbyPack, take: nearbyTake, sharePair, takePair,
  };
  const openNearby = (mode = 'send', pick) => AppKit.nearby.start(mode, pick ? { ...nearbyAdapter, pick } : nearbyAdapter);   // 'send'：傳給別人；'devices'：我的裝置（配對、自動同步）；pick：傳給別人時先選好的牆（id 清單）
  AppKit.nearby.bind($('findNearby'), 'send', nearbyAdapter);
  AppKit.nearby.bind($('hmSync'), 'devices', nearbyAdapter, () => { $('homeMenu').hidden = true; });
  // 同意過條款（簽名是同意時填的，沒簽名就用 Google 名稱）：連結可以直接傳，不用再問
  const setupDone = () => !!AppKit.nearby.nickname();   // 條款寫在授權裡（CC BY-SA 4.0），不再另外同意；只要有暱稱（出線者署名）
  // ctx：{ kind: 'wall', id: 牆 id, route: 路線 id }＝分享路線；{ setup: true, … }＝分享路線前先填簽名
  async function openShare(ctx) {
    const sharingWall = state.wall && state.wall.id === ctx.id ? state.wall : null;
    const m3d = !!ctx.route && !!sharingWall?.m3d;   // 3D 牆：路線跟 2D 一樣傳到 Climbio、連結很短；傳不上去（沒網路、不能分享）退回把整條線壓在連結裡（js/wall3d.js）
    // 路線連結只給 Studio 發佈的公開牆（牆已經在開放資料集，連結只傳這條線）和 3D 牆；手機自己拍的牆、舊版範例牆只有圖片，要給朋友走附近交換。
    const linkable = !!ctx.route && (m3d || isPublic(sharingWall));
    const ask = !!ctx.setup;
    shareCtx = ctx; shareLink = '';
    closeRadials(); $('edMenu').hidden = true; $('homeMenu').hidden = true;
    $('shTitle').textContent = t(ctx.route ? 'shareRoute' : 'signInTitle');
    const card = $('shareDialog').querySelector('.share-card');
    card.classList.toggle('is-route', !!ctx.route && !ask);
    $('shSignedOut').hidden = true;
    shStatus('');
    $('shareDialog').hidden = false; $('shareDialog').querySelector('.share-card').scrollTop = 0; openOverlay('shareDialog', closeShare);
    const routeUi = !!ctx.route && !ask;
    $('shPrev').hidden = $('shTo').hidden = !routeUi;
    if (routeUi) renderPreview();
    $('shSend').hidden = !linkable;   // 兩顆分享目標一直都在；後端不能分享路線連結的站只有圖片
    if (ask) return sharePanel();
    if (m3d) {   // 3D 牆的路線連結整條線都在網址裡
      const r = state.wall.routes.find(v => v.id === ctx.route), url = r && (setupDone() ? await share3d(state.wall, r) : await W3D.link(state.wall, r));   // 簽名、條款還沒好：先給長連結，按分享時才問
      if (url && shareCtx === ctx) shareLink = url;
      return;
    }
    if (ctx.route) { if (linkable && !m3d && setupDone()) await ensureShared(ctx); return; }   // 設定好了就先在背景傳，按連結時多半已經好了
  }
  // 分享說明（第一次分享）：標題、簽名、同意條款，按鈕是「分享」
  function sharePanel() {
    $('shSignedOut').hidden = false;
    $('shSignHead').textContent = t('sharePublic');
    $('shSignature').value = signName(); updateShareSetup();
    $('shLegalPre').textContent = t('legalPreShare');
  }
  $('shSignature').oninput = updateShareSetup;
  // 簽名填好、同意條款：記下來，接著分享
  $('shAgree').onclick = async () => {
    const signature = $('shSignature').value.trim();
    if (!signature) return;
    if (!AppKit.nearby.setNickname(signature)) return;
    lsSet(CONSENT_KEY, true);
    fileCache.clear();
    if (shareCtx) openShare({ ...shareCtx, setup: false });
  };

  // 分享一面牆：這面牆裡自己的待分享路線（新建或改了）一次送出（Backend.shareRoutes：只傳這幾條線到 Climbio，只限 Studio 發佈的公開牆）。
  // 不比對路線是否一樣；回傳第一個失敗（沒有就 null）。
  // 牆面卡片右上的地球：公開的牆（自己公開分享過，或收來的公開牆；只在手機的不標）
  const sharedPublic = (w) => !!w && !localOnly(w) && !!w.pub;
  // Backend.shareRoutes 的參數：牆的照片和岩點不傳（牆只由 Studio 發佈），只帶原始岩點檔給路線片段省掉跟牆一樣的外框
  const shareBody = (w) => ({ pid: w.pid, base: async () => ({ name: w.name, w: w.w, h: w.h, thumb: w.thumb || '', t: w.createdAt || 0, ...w.base }) });
  async function pushWall(id, rids) {
    const w = await liveWall(id);
    if (!isPublic(w)) return null;   // 不是 Studio 的公開牆：不傳（手機自己拍的牆不會上傳）
    const list = [];
    let failed = null;
    for (const r of w.routes) {
      if (!rids.includes(r.id) || !mineRoute(r) || !routeReady(r) || r.pub === pubSig(r)) continue;
      list.push(r);
    }
    if (!list.length) return failed;
    const sigs = new Map(list.map(r => [r.id, pubSig(r)]));
    const { results } = await Backend.shareRoutes({ ...shareBody(w), routes: list.map(r => ({ route: pubRoute(r) })) });
    const ok = Object.keys(results).filter(rid => results[rid].ok);
    for (const rid of Object.keys(results)) {
      const x = results[rid];
      if (!x.ok) failed = failed || new Error(x.error);
    }
    await patchWall(w.id, (x) => {
      if (ok.length) { x.share = 'public'; x.pub = 1; }
      for (const y of x.routes) if (ok.includes(y.id)) { y.pub = sigs.get(y.id); y.own = 1; }
    });
    return failed;
  }
  // 公開牆上定好的線（有起攀、完攀）就公開：存線後等一下自動傳（沒網路、沒暱稱就先留著，下次存線或開牆再傳）；自己的線隨時可以刪，刪了就從公開牆拿掉（dropLine）。
  // 改完停 30 秒才傳（編輯中每動一下不傳）；離開畫面（切到背景）馬上傳。測試用 climbioShareDelay 縮短
  let autoTimer = 0, autoId = '';
  function autoShare(id, now = false) {
    clearTimeout(autoTimer);
    autoId = id;
    autoTimer = setTimeout(async () => {
      try {
        if (navigator.onLine === false || !AppKit.nearby.nickname()) return;
        const w = await liveWall(id);
        if (!w || !isPublic(w) || shareBusy) return;
        const rids = pendingRoutes(w).map(r => r.id);
        if (rids.length) await pushWall(id, rids);
      } catch (e) { console.warn('公開牆上的線沒傳上去', e); }
    }, now ? 0 : self.climbioShareDelay ?? 30000);
  }
  self.climbioAutoShare = autoShare;
  addEventListener('online', () => { if (state.wall) autoShare(state.wall.id); });   // 連上網就補傳
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && autoTimer && autoId) autoShare(autoId, true); });   // 切到背景：有等著傳的就現在傳
  // 新增、修改與重新命名先存本機；公開牆上定好的線由 autoShare 自動公開。
  // 刪除：記刪除紀錄；自己傳過的公開線馬上從公開牆拿掉
  function dropLine(w, r) {
    buryRoute(w, r);
    if (isPublic(w) && r.pub && mineRoute(r)) Backend.unshareRoutes(w.pid, [r.id]).catch(e => console.warn('公開牆上的線沒拿掉', e));
    else if (w.m3d && r.shared3) Backend.unshareRoutes(w.pid, [r.id]).catch(e => console.warn('3D 牆上傳過的線沒拿掉', e));
  }
  // 復原：放回本機，下次存線時自動公開最新版本
  function keepLine(w, r) {
    r.got = Date.now(); delete r.pub;
  }
  // 沒網路：不傳路線連結（圖片照樣可以分享），連上後下次存線再自動公開
  function waitNet() { hideToast(); shStatus(t('shareOffline')); }
  const netFail = (e) => e && (e.code === 'offline' || e.code === 'storage/retry-limit-exceeded');
  // 使用者進入分享畫面時準備連結；公開牆上的線存線後自動傳（autoShare）。
  // 公開分享要先登入 Google：沒登入要先問，按了才跳 Google 的視窗（瀏覽器只讓點擊時跳）：
  // 背景傳碰到就先停著，等使用者按連結（interactive＝true）再問；公開牆上別人的線不需要登入，不會問
  async function ensureShared(ctx, interactive = false) {
    if (shareBusy) return;
    if (navigator.onLine === false) return waitNet();
    shareBusy = true;
    try {
      const w = await liveWall(ctx.id);
      if (!w) { closeShare(); return; }
      const byWall = new Map();
      for (const x of await pendingShares(ctx.id)) byWall.set(x.id, [...(byWall.get(x.id) || []), x.rid]);
      let failed = null;
      for (const [id, rids] of byWall) {
        try { failed = (await pushWall(id, rids)) || failed; }
        catch (e) { failed = failed || e; }
      }
      const r = (await liveWall(ctx.id)).routes.find(x => x.id === ctx.route);
      hideToast(); shStatus('');
      if (shareCtx === ctx && r && r.pub) await renderShare();
      if (failed) throw failed;
    } catch (e) {
      hideToast();
      if (netFail(e)) { if (navigator.onLine === false) waitNet(); else shStatus(t('shareTimeout')); }
      else if (e.code === 'quota' || e.code === 'timeout') shStatus(e.message);
      else shStatus(t('publishFailed') + (e.message || e));
    } finally { shareBusy = false; }
  }
  // 3D 牆的一條線傳到 Climbio（跟 2D 公開牆的線同一個地方，每天匯出到開放資料集），回短連結；傳不上去就回整條線在網址裡的長連結
  async function share3d(w, r) {
    if (can('share') && Backend.shareRoute3d && navigator.onLine !== false) {
      try {
        await Backend.shareRoute3d(w.pid, r.id, W3D.fragment(w, r));
        patchWall(w.id, (x) => { const y = x.routes.find(v => v.id === r.id); if (y) y.shared3 = 1; });
        return W3D.shortLink(w, r);
      } catch (e) { console.warn('3D 路線沒傳到 Climbio，改用長連結', e); }
    }
    return W3D.link(w, r);
  }
  async function renderShare() {
    const ctx = shareCtx; if (!ctx) return;
    const w = await liveWall(ctx.id), r = w && w.routes.find(x => x.id === ctx.route);
    if (!r || !r.pub) return;
    const link = routeLink(w, r);
    if (shareCtx !== ctx) return;
    shareLink = link;
  }
  // 改牆面的欄位：正在看的牆用畫面上那份改，免得稍後存檔蓋掉
  async function patchWall(id, fn) {
    const w = await liveWall(id);
    if (!w) return null;
    fn(w);
    await putWall(w);
    return w;
  }
  const liveWall = async (id) => state.wall && state.wall.id === id ? state.wall : getWall(id).catch(() => null);
  // Storage 上的照片一律是 JPEG（匯入的牆面檔可能是 PNG 等其他格式）
  // redo：JPEG 也重新壓一次（匯入的照片可能帶 EXIF：GPS、拍攝時間、手機型號，canvas 重新壓過就不會帶）
  const asJpeg = (blob, redo = false) => !blob || (blob.type === 'image/jpeg' && !redo) ? Promise.resolve(blob) : AppKit.photo.reencode(blob, AppKit.photo.QUALITY.full);
  // ---------- 分享資料的本地合併 ----------
  // 帳號不再同步本地資料；分享接收仍使用下列內容合併工具。
  const cleanHolds = (hs) => (Array.isArray(hs) ? hs : []).filter(h => h && typeof h.id === 'string' && Array.isArray(h.poly) && h.poly.length >= 3);
  // 路線合併（收線用這個）：同一個 id 修改時間晚的贏；只有一邊有的加進來（front：排在最前面）；
  // 刪得比路線新的不要（點連結收下、復原記 got，比刪除晚就留著）
  const liveIn = (del) => (r) => !(del[deadKey(r)] >= Math.max(r.t || 0, r.got || 0));
  function mergeRoutes(w, routes, deleted = {}, { front = false } = {}) {
    const del = { ...((w.deleted && w.deleted.routes) || {}) };
    for (const [rid, t] of Object.entries(deleted)) if (!(del[rid] >= t)) del[rid] = t;
    const byId = new Map(w.routes.map(r => [r.id, r])), added = [];
    for (const r of routes) {
      if (!r || typeof r.id !== 'string' || !r.holds || typeof r.holds !== 'object') continue;
      const cur = byId.get(r.id);
      if (!cur) { byId.set(r.id, r); added.push(r); }
      else if ((r.t || 0) > (cur.t || 0)) byId.set(r.id, cur.sent ? { ...r, sent: 1 } : r);   // 完攀只在這台，對方的版本不帶
    }
    const all = front ? [...added, ...w.routes.map(r => byId.get(r.id))] : [...w.routes.map(r => byId.get(r.id)), ...added];
    w.routes = all.filter(liveIn(del));
    w.deleted = { ...(w.deleted || {}), routes: del };
  }
  $('shBack').onclick = () => closeShare();
  // 連結：一行邀請句＋連結，不附圖片（收到圖片的 App 常把文字和連結丟掉）；Facebook、Messenger 等用預覽頁的 og:image 做成連結卡片。
  // 對方點連結就會打開 App 接收。不能分享的瀏覽器改成複製兩行文字
  // 這面牆還沒設定好就先選分享方式；好了：連結已經傳好就直接分享，還沒就在這次點擊裡傳（可能要先登入 Google），傳完 iPhone 常不讓接著分享，提示再按一次
  $('shSend').onclick = async () => {
    const ctx = shareCtx, w = ctx && await liveWall(ctx.id), r = w && w.routes.find(v => v.id === ctx.route);
    if (!r) return;
    const direct = !!w.m3d && !can('share');   // 3D 牆不能分享的站：連結直接由模型建立，不上傳
    if (!direct && !setupDone(w)) return openShare({ ...ctx, setup: true });
    let waited = false;
    if (!shareLink && !direct) {
      waited = true;
      if (w.m3d) { shareLink = await share3d(w, r); if (shareCtx !== ctx) return; }
      else {
        await ensureShared(ctx, true);
        if (shareCtx !== ctx) return;
      }
    }
    if (!shareLink && w.m3d) shareLink = await W3D.link(w, r);
    if (!shareLink) return;
    const how = await AppKit.share.sendLink(shareLink, { strictGesture: waited });   // 連結分享只送連結，內容由預覽頁呈現；個人化只在圖片
    if (how === 'blocked') toast(t('shareReady'));
    else if (how === 'copied') toast(t('shareCopied'));
  };
  // 圖片：系統分享限時動態尺寸的圖片（網頁沒辦法直接把檔案交給 IG 等指定的 App，在選單裡挑），只在本機產圖，不上傳
  $('shMedia').onclick = () => shareRouteImage();
  let prevUrl = '', previewVersion = 0;
  async function renderPreview() {
    const version = ++previewVersion, ctx = shareCtx, key = routeKey(), wall = state.wall;
    const current = () => previewVersion === version && shareCtx === ctx && !!ctx && state.wall === wall && routeKey() === key;
    const ready = fileCache.get(key);
    if (ready) { showPrev(ready); $('shPrev').classList.remove('busy'); return; }
    $('shPrev').classList.add('busy');
    // 先讓畫面畫出來再產圖：產圖是一大段同步繪製，低階手機要等它畫完；過時的預覽不再產圖
    await nextPaint();
    if (!current()) return;
    try {
      const file = await prepareRouteFile();
      if (!current()) return;
      showPrev(file);
      await $('shPrevImg').decode().catch(() => {});   // 解碼好才收掉產圖中的樣子，新圖彈出來時已經看得到
      if (!current()) return;
    } catch (e) {
      if (current() && e.name === 'AbortError') { afterVisible(renderPreview); return; }   // 產圖途中切到背景（iOS 可能清掉畫布）：回來重做
      if (current()) shStatus(e.message || String(e));
    } finally {
      if (current()) $('shPrev').classList.remove('busy');
    }
  }
  const nextPaint = () => new Promise(res => requestAnimationFrame(() => setTimeout(res)));
  const afterVisible = (fn) => { if (!document.hidden) return fn(); const back = () => { if (document.hidden) return; document.removeEventListener('visibilitychange', back); fn(); }; document.addEventListener('visibilitychange', back); };
  function showPrev(blob) {
    URL.revokeObjectURL(prevUrl); prevUrl = URL.createObjectURL(blob);
    $('shPrevImg').src = $('shGlow').src = prevUrl;   // 背景的光暈用同一張圖
  }
  const holdBackup = import('../appkit/backup-ui.mjs').then(({ createBackupUI }) => createBackupUI({
    app: 'hold', database: db, stores: STORES,
    nicknameSuggestion: () => '',
    preferences: k => ['device', 'devices', 'deviceKey', 'deviceKey.more', 'gradeSys', 'hasWalls', 'installDismissedAt', 'installed', 'lang', 'lastGrade', 'madeRoute', 'opened', 'routeSort', 'shareOk', 'sign', 'signAt', 'nickname', 'nicknameAt', 'spot', 'stats'].some(name => k === `climbio.${name}`) || k.startsWith('climbio.tour.') || k.startsWith('climbio.tip.'),
    afterRestore: () => { clearTimeout(saveTimer); state.wall = null; },
    flush: async () => { clearTimeout(saveTimer); if (state.wall) await putWall(state.wall); await Promise.all([...pendingDeletes].map(c => c())); },
  }));
  $('hmBackup').onclick = async () => { $('homeMenu').hidden = true; await (await holdBackup).backup(); };
  $('hmRestore').onclick = async () => { $('homeMenu').hidden = true; await (await holdBackup).restore(); };

  // ---------- 接收分享：點了朋友傳來的連結 → 全螢幕開箱 → 揭曉 → 飛進路線圖；存成自己的一面牆（之後不會跟著更新） ----------
  // 開箱：上面「誰傳來一條線」，中間一張正方形的卡片（裁到路線附近），照片先是模糊的縮圖、下載越多越清楚，下面岩點數從 0 跳上去。
  // 揭曉：照片轉灰階，路線岩點照出手順序一顆顆亮起，難度從上面落下，貼上膠帶短句（收到的線那一組；收過同一面牆是「更新了 N 條線」），
  // 輕震，出現「看這條線」（整面牆是「看這面牆」）；揭曉中點一下直接跳到最後。
  let recvJob = null, rvGen = 0;
  const rvStatus = (text) => { $('rvStatus').textContent = text; };
  // 接收畫面沒有自己的瀏覽紀錄（從首頁打開時返回就退出 App）：Android 的返回手勢用 CloseWatcher 接住，
  // 當成按 ×
  let rvWatch = null;
  function rvGuard(on) {
    if (rvWatch) { rvWatch.onclose = null; rvWatch.destroy(); rvWatch = null; }
    if (!on || typeof CloseWatcher !== 'function') return;
    try { rvWatch = new CloseWatcher(); } catch (e) { return; }
    rvWatch.onclose = () => { rvWatch = null; if (!$('recvPage').hidden) closeRecv(); };
  }
  function closeRecv() {
    rvGuard(false);
    if (recvJob) { recvJob.cancel(); recvJob = null; }
    rvGen++;
    $('recvPage').hidden = true;
  }
  function rvReset() {
    rvGen++;
    $('rvBox').hidden = $('rvGo').hidden = $('rvAsk').hidden = true; $('rvBox').className = 'rv-box';
    for (const id of ['rvFrom', 'rvAv', 'rvGrade', 'rvName', 'rvTape']) $(id).textContent = '';
    $('rvCount').textContent = '0'; rvStatus('');
    // Set the readback hint on first creation, before tintCard uses rvPic.
    for (const id of ['rvPic', 'rvColor']) { const c = $(id); c.getContext('2d', { willReadFrequently: id === 'rvPic' }).clearRect(0, 0, c.width, c.height); }
    $('rvPic').style.filter = '';
    return rvGen;
  }
  // 點了連結：本來就是要收，直接開始
  async function openRecv(link) {
    closeRecv(); rvReset();
    $('recvPage').hidden = false; rvGuard(true);
    return recvConnect(link);
  }
  // 確認：「Kant Kang 傳來一條線」、難度和名稱、哪面牆；收下才開箱
  // 傳來的人：名字（簽名）的第一個字放在螢光綠圓圈裡（不用 Google 頭像，簽名可以不公開身分）
  function rvAvatar(el, name) {
    el.textContent = [...(name || '?')][0].toUpperCase();
  }
  // title：換掉「誰傳來的」那一行（找牆面收的公開牆面不是誰傳來的）
  function rvAsk({ owner, route, wallName, title = '' }) {
    rvAvatar($('rvAskAv'), owner || wallName);
    $('rvAskFrom').textContent = title || t(route ? 'rvFromRoute' : 'rvFromWall', owner || t('rvSomeone'));
    setGrade($('rvAskGrade'), route ? route.grade : ''); $('rvAskName').textContent = route ? route.name || '' : wallName || '';
    $('rvAskWall').textContent = route ? wallName || '' : '';
    $('rvAsk').hidden = false;
    return new Promise(res => {
      $('rvAskYes').onclick = () => { $('rvAsk').hidden = true; res(true); };
      $('rvAskNo').onclick = () => { $('rvAsk').hidden = true; closeRecv(); res(false); };
    });
  }
  async function recvConnect(input) {
    if (recvJob) { recvJob.cancel(); recvJob = null; }   // 停掉前一次嘗試
    const c = ShareTools.linkFrom(input);
    if (!c) { closeRecv(); toast(t('recvBadCode')); return; }
    if (c.wall && !c.rid) return recvWallLink(c.wall);
    // 一條線：路線連結（c.pid）一開始就知道是哪面牆；分享包的連結（c.wall：路線圖層）讀到圖層才知道。
    // 手上有這面牆（牆 id 就是照片編號）：收過這條線、或是自己出的就直接打開；沒有這條就只下載路線（照片、岩點檔已經有）
    let mine = c.pid ? await liveWall(c.pid) : null;
    const opened = async () => {
      const have = mine && mine.routes.find(r => r.id === c.rid);
      if (have) { closeRecv(); await openWall(mine.id); openRoute(have.id); }
      return !!have;
    };
    if (await opened()) return;
    // 點連結直接開箱，不再多問一次是否收下。
    const box = unbox(c.rid);
    const onInfo = (x) => {
      if (!x.route) return box.info(x);
      box.info({ ownerName: x.ownerName, routes: [x.route], name: mine ? mine.name : '' });
    };
    const showMine = () => box.info({ thumb: mine.thumb, w: mine.w, h: mine.h, holds: mine.holds });
    if (mine) showMine();
    // 預覽頁（同源）轉進來時留下它查到的路線圖層：網址對得上這條連結才用，只用一次
    let given = null;
    try {
      const h = JSON.parse(sessionStorage.getItem('climbio.handoff') || 'null');
      if (h && c.src && h.url === `${c.src}route.json`) given = h.doc;
      sessionStorage.removeItem('climbio.handoff');
    } catch (e) { /* 沒有就照常下載 */ }
    const job = ShareTools.fetchShared(c, { given, onProgress: box.progress, onInfo, havePhoto: !!mine, needBase: !mine,
      have: async (pid) => { mine = await liveWall(pid); if (mine) showMine(); return !!mine; } });
    recvJob = job;
    let got;
    try { got = await job.done; } catch (e) {
      if (recvJob !== job) return;
      recvJob = null; box.show(); box.fail(e.message || String(e));
      return;
    }
    if (recvJob !== job) return;
    recvJob = null;
    if (await opened()) return;
    // 分享包的連結：那個人在這面牆的其他線一起收（連結那條是主角）；記住圖層，之後打開這面牆時檢查更新
    const others = c.wall ? (got.routes || []).filter(r => r.id !== got.route.id) : [];
    const sub = c.wall ? { url: c.wall, ids: [got.route.id, ...others.map(r => r.id)] } : null;
    await box.reveal({ snap: { pid: c.pid || got.pid, name: got.base && got.base.name, gym: got.doc.gym, got: [got.route.id], ...(sub ? { sub } : {}) }, wall: { ...(got.base || {}), routes: [got.route, ...others] }, photo: got.photo });
  }
  // 找牆面：收下別人公開的整面牆（照片、原始岩點檔、所有公開路線），直接收下並開箱
  async function recvWall(x) {
    closeRecv(); rvReset();
    $('recvPage').hidden = false; rvGuard(true);
    const title = x.gym ? t('rvGymWall', x.gym) : x.title || x.name;   // 牆的連結沒有岩館：標題用組合的名稱或牆名
    const box = unbox(null);
    box.info({ ownerName: '', pending: true, name: x.name, title, routes: [], thumb: x.thumb });   // 清單帶來的縮圖先顯示（模糊），照片下載好才變清楚
    box.progress(0.2);
    let got;
    try { got = await ShareTools.fetchWall(x.href, x.pid, x.thumb); }
    catch (e) {
      if (e.dead && Backend.reportWall) Backend.reportWall(x.pid).catch(() => {});   // 發佈的包裡讀不到了：通報，後端查過才把這面牆從清單拿掉
      box.fail(e.message || String(e)); return null;
    }
    box.info({ ownerName: got.attribution || '', title: got.attribution ? '' : title, thumb: got.base.thumb, w: got.base.w, h: got.base.h, holds: got.base.holds || [] });
    const grp = got.photos ? await recvSiblings(got.photos, x, box).catch(e => { console.warn('同一面牆的其他照片沒收到', e); return null; }) : null;
    box.progress(1);
    return box.reveal({ snap: { pid: x.pid, name: x.name, gym: x.gym }, wall: { ...got.base, name: x.name || got.base.name, routes: got.routes, ...(grp ? { grp } : {}) }, photo: got.photo });
  }
  // 牆的連結：組合（同一面牆的幾張照片）就從第一張開始收、其他張跟著收；牆畫面或路線圖層就收那一面（有 props.photos 一樣整組收）
  async function recvWallLink(url) {
    let x;
    try {
      const d = await (await fetch(url)).json();
      if (d && d.kind === 'set' && d.type === 'photos' && !ClimbioFormat.validate(d).length && d.items && d.items[0]) {
        const i = d.items[0]; x = { pid: i.id, href: new URL(i.href, url).href, name: String(i.name || d.name || ''), gym: '', title: typeof d.name === 'string' ? d.name : '' };
      } else if (d && (d.kind === 'view' || d.kind === 'layer')) x = { pid: d.kind === 'layer' ? d.on : d.id, href: url, name: typeof d.name === 'string' ? d.name : '', gym: '' };
    } catch (e) { x = null; }
    if (!x) { closeRecv(); toast(t('recvBadCode')); return; }
    await recvWall(x);   // 開箱畫面的「看這面牆」打開它
  }
  // 同一面牆的其他照片：讀組合，其他張各收成一面牆（已經有的只補 grp），回傳這組的 grp
  async function recvSiblings(url, x, box) {
    const set = await ShareTools.wallPhotos(url);
    if (!set.items.some(i => i.pid === x.pid)) return null;
    const grp = { id: set.id, ids: set.items.map(i => i.pid), links: set.links }, others = set.items.filter(i => i.pid !== x.pid);
    for (const [k, i] of others.entries()) {
      box.progress(0.2 + 0.8 * (k + 1) / (others.length + 1));
      const old = await liveWall(i.pid);
      if (old) { if (!old.grp) { old.grp = grp; await putWall(old); } continue; }
      const got = await ShareTools.fetchWall(i.href, i.pid);
      await saveSnap({ pid: i.pid, name: i.name, gym: x.gym }, { ...got.base, name: i.name || got.base.name, routes: got.routes, grp }, got.photo);
    }
    return grp;
  }
  // ---------- 找牆面：有牆的岩館讀總目錄（各站合起來；讀不到就只看這個站），是一顆顆岩點泡泡；點開才同時讀有這間岩館的站的牆面，合起來最新的在前，畫面一次排 30 面，捲到底再排 ----------
  // 泡泡大小是牆面數，離手機近的在前（沒有定位：台灣的岩館從北到南、同系列放一起〔gyms/tw.json 的順序〕，其他的最新的在前）；手機 300 公尺內有牆的岩館直接展開
  const find = { gym: '', index: [], all: null, after: 0, done: false, busy: false, gen: 0, seq: 0, q: '', tw: new Map(), dist: new Map(), key: '' };
  const FIND_FLAT_MAX = 12, FIND_FLAT_GYMS = 6, FIND_WALL_SEARCH_MAX = 20;   // 全部牆不超過 12 面：不放泡泡，直接攤開；搜尋到 6 間以內也攤開；找牆名最多讀 20 間
  // 岩館目錄 + 台灣順序檔（泡泡的排序）：兩份同時讀；按下後同時讀（5 分鐘內再進來直接用）
  let findPre = null;
  const FIND_CACHE = 'climbio.findBase';   // 上次讀到的岩館目錄：下次打開先用它畫，同時重讀（目錄的冷請求要 2、3 秒）
  const loadFindBase = async () => {
    const [index, twl] = await Promise.all([findGyms(false), gymCountry('tw').catch(() => [])]);
    const tw = new Map(twl.map(g => [g.name, g.i]));
    lsSet(FIND_CACHE, { index, tw: [...tw] });
    return { index, tw };
  };
  const preloadFind = () => (findPre = { t: Date.now(), p: loadFindBase().catch((e) => { findPre = null; throw e; }) });
  // 有「找牆面」按鈕的站，開啟後閒下來先讀（js/main.js）；沒讀好就按了，按下去時才讀。5 分鐘內再進來直接用
  // 泡泡順序：有定位就離得近的在前；沒有：台灣的岩館從北到南、同系列放一起（gyms/tw.json 的順序），其他的最新的在前
  function sortFind() {
    const rank = (x) => find.tw.get(x.gym.split('#')[0]) ?? Infinity, far = (x) => find.dist.has(x.gym) ? find.dist.get(x.gym) : Infinity;
    find.index.sort(find.dist.size ? (a, b) => far(a) - far(b) || b.t - a.t : (a, b) => (rank(a) === rank(b) ? b.t - a.t : rank(a) < rank(b) ? -1 : 1));
  }
  const fmtDist = (m) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);
  const distOf = (g) => (find.dist.has(g) && find.dist.get(g) < 5e5 ? ` · ${fmtDist(find.dist.get(g))}` : '');
  async function openFind() {
    homeScroll = document.scrollingElement.scrollTop;
    $('home').hidden = true; $('find').hidden = false; document.scrollingElement.scrollTop = 0;
    history.pushState({ s: 'find' }, '');
    const gen = ++find.gen; find.gym = ''; find.index = []; find.q = ''; find.key = ''; find.dist = new Map(); $('findSearch').value = '';
    $('find').classList.remove('in-gym', 'flat'); $('findList').replaceChildren(); $('findBubbles').replaceChildren(); $('findCount').textContent = '';
    $('findMsg').hidden = false; $('findMsg').textContent = t('loading');
    const here = hereNow();   // 定位最多等 15 秒：泡泡不等它，先出來
    const warm = findPre && Date.now() - findPre.t < 300000, pre = warm ? findPre : preloadFind();
    const old = warm ? null : lsGet(FIND_CACHE, null);   // 上次的目錄先畫出來，新的回來再換
    if (old && old.index) { find.index = old.index.map(x => ({ ...x })); find.tw = new Map(old.tw); sortFind(); renderFind(); }
    try { const base = await pre.p; if (gen !== find.gen) return; find.index = base.index.map(x => ({ ...x })); find.tw = base.tw; }
    catch (e) { if (gen === find.gen && !(old && old.index)) $('findMsg').textContent = e.message || String(e); if (!(old && old.index)) return; }
    if (gen !== find.gen) return;
    sortFind(); find.key = ''; renderFind();
    // 3D 牆與多站的牆數（要讀 Firebase 的清單，冷啟動要 1 秒多）：回來再補數字、重排，不擋第一次出現
    findGyms(true).then((full) => { if (gen !== find.gen) return; find.index = full; sortFind(); if (!find.gym) renderFind(); }).catch((e) => console.warn('完整岩館清單讀不到', e));
    const c = await here;
    if (!c || gen !== find.gen || find.gym) return;
    find.dist = new Map((await gyms(c).catch(() => [])).map(g => [g.name, gymMeters(c, g)]));
    if (gen !== find.gen || find.gym) return;
    sortFind(); find.key = ''; await renderFind();
    const first = find.index[0];
    if (first && !$('find').classList.contains('flat') && !find.q && find.dist.has(first.gym) && find.dist.get(first.gym) <= GYM_NEAR) showFindGym(first.gym);
  }
  // 要放什麼：搜尋有字就依館名（沒有館名符合、岩館不多時依牆名）；沒有字就看牆的總數，很少就全部攤開、不用先點泡泡
  async function renderFind() {
    if (find.gym) return;
    const q = find.q.toLowerCase(), list = find.index, seq = ++find.seq;
    const byName = q ? list.filter(x => x.gym.toLowerCase().includes(q)) : list, total = byName.reduce((n, x) => n + x.n, 0);
    const flat = q ? (byName.length && byName.length <= FIND_FLAT_GYMS ? byName : null) : (list.length && total <= FIND_FLAT_MAX ? byName : null);
    if (flat) return renderFlat(flat, seq, '');
    if (q && !byName.length && list.length && list.length <= FIND_WALL_SEARCH_MAX) return renderFlat(list, seq, q);
    drawBubbles(byName);
  }
  // 攤開：每間岩館一段（館名＋距離），底下是它的牆面卡片
  async function renderFlat(gyms, seq, wallQ) {
    const key = `${gyms.map(x => `${x.gym}:${x.n}`).join('|')}#${wallQ}`;
    if (key === find.key) return;
    const home = ShareTools.homeSite();
    const [lists, mine] = await Promise.all([Promise.all(gyms.map(x => gymWallsFrom(x.sites.length ? x.sites : [{ url: home, name: '' }], x.gym).catch(() => []))), listWalls()]);
    if (seq !== find.seq || find.gym) return;
    find.key = key;
    const have = new Set(mine.map(w => w.id)), out = [];
    gyms.forEach((x, i) => {
      const ws = wallQ ? lists[i].filter(w => (w.name || '').toLowerCase().includes(wallQ.toLowerCase())) : lists[i];
      if (!ws.length) return;
      const group = document.createElement('section'); group.className = 'find-group' + (ws.length > 1 ? ' multiple' : '');
      const h = document.createElement('h2'); h.className = 'find-sec'; h.textContent = x.gym + distOf(x.gym);
      const cards = document.createElement('div'); cards.className = 'find-group-walls';
      cards.append(...ws.map(w => findCard(w, have.has(w.pid))));
      group.append(h, cards); out.push(group);
    });
    $('find').classList.add('flat'); $('findBubbles').replaceChildren(); $('findList').replaceChildren(...out);
    $('findCount').textContent = ''; $('findMsg').hidden = out.length > 0; $('findMsg').textContent = t(find.q ? 'findNone' : 'findEmpty');
  }
  function drawBubbles(list = find.index) {
    find.key = ''; $('find').classList.remove('flat'); $('findList').replaceChildren();
    $('findCount').textContent = list.length ? t('findGyms', list.length) : '';
    $('findMsg').hidden = list.length > 0; $('findMsg').textContent = t('findNone');
    $('findBubbles').replaceChildren(...list.map((x, i) => {
      const b = document.createElement('button'); b.className = 'find-bubble';
      b.style.setProperty('--d', `${84 + Math.min(x.n, 10) * 6}px`); b.style.setProperty('--delay', `${-i * 0.7}s`);
      const nm = document.createElement('b'); nm.textContent = x.gym;
      const n = document.createElement('span'); n.textContent = t('wallsN', x.n) + distOf(x.gym);
      const blob = document.createElement('i'); blob.append(nm, n); b.append(blob); b.onclick = () => showFindGym(x.gym);
      return b;
    }));
  }
  function showFindGym(g) { find.gym = g; $('find').classList.add('in-gym'); document.scrollingElement.scrollTop = 0; loadFind(true); }
  // 返回：展開的岩館回到泡泡，泡泡回首頁
  function findBack() { if (!find.gym) return history.back(); find.gen++; find.gym = ''; find.key = ''; $('find').classList.remove('in-gym'); $('findList').replaceChildren(); renderFind(); }
  async function loadFind(reset) {
    if (reset) { find.gen++; find.all = null; find.after = 0; find.done = find.busy = false; $('findList').replaceChildren(); }
    $('findGym').textContent = find.gym;
    if (!find.gym || find.busy || find.done) return;
    const gen = find.gen; find.busy = true;
    if (!$('findList').children.length) { $('findMsg').hidden = false; $('findMsg').textContent = t('loading'); }
    try {
      const gym = find.gym, entry = find.index.find(g => g.gym === gym);
      const [all, mine] = await Promise.all([find.all || gymWallsFrom(entry ? entry.sites : [{ url: ShareTools.homeSite(), name: '' }], gym), listWalls()]);
      if (gen !== find.gen) return;
      find.all = all;
      const have = new Set(mine.map(w => w.id)), list = all.slice(find.after, find.after + 30);
      $('findList').append(...list.map(x => findCard(x, have.has(x.pid))));
      find.after += list.length;
      find.done = find.after >= all.length;
      $('findMsg').hidden = $('findList').children.length > 0; $('findMsg').textContent = t('findEmpty');
    } catch (e) {
      if (gen !== find.gen) return;
      $('findMsg').hidden = false; $('findMsg').textContent = e.message || String(e);
    } finally { if (gen === find.gen) find.busy = false; }
  }
  // 有牆的岩館：總目錄和這個站自己的一起讀、合起來（總目錄讀不到、還沒收這個站時，至少看得到自己的牆）；Studio 發佈的 3D 牆跟 2D 的公開牆同一份清單
  async function findGyms(full = true) {
    const home = ShareTools.homeSite(), self = { url: home, name: '' };
    const [dir, mine] = await Promise.allSettled([SITE.directory ? ShareTools.directoryGyms(SITE.directory) : [], ShareTools.siteGyms(home)]);
    if (dir.status === 'rejected' && mine.status === 'rejected') throw mine.reason;
    const byGym = new Map((dir.status === 'fulfilled' ? dir.value : []).map(g => [g.gym, { ...g, sites: [...g.sites] }]));
    for (const g of mine.status === 'fulfilled' ? mine.value : []) {
      const x = byGym.get(g.gym);
      if (!x) byGym.set(g.gym, { ...g, sites: [self] });
      else if (!x.sites.some(s => s.url === home)) { x.sites.push(self); x.n += g.n; x.t = Math.max(x.t, g.t); }
    }
    // 同一面牆（照片編號相同）可能在兩個站都有：有一個以上的站時，牆數照列表的算法（同編號只算一面）
    if (!full) return [...byGym.values()];   // 第一次畫泡泡：不等多站牆數，回來再補
    const multi = new Set([...byGym.values()].filter(x => x.sites.length > 1).map(x => x.gym));
    await Promise.all([...multi].map(async (gym) => {
      const x = byGym.get(gym);
      try { x.n = (await gymWallsFrom(x.sites, gym)).length; } catch (e) { multi.delete(gym); console.warn('牆數讀不到', gym, e); }
    }));
    return [...byGym.values()];
  }
  // 有這間岩館的站一起問；一站讀不到不影響其他站。同一面牆（照片編號相同）出現在兩個站，留比較新的
  async function gymWallsFrom(sites, gym) {
    const lists = await Promise.allSettled(sites.map(s => ShareTools.gymWalls(s.url, gym).then(ws => ws.map(w => ({ ...w, gym, n: w.routes, site: s.url, siteName: s.name })))));
    if (lists.length && lists.every(r => r.status === 'rejected')) throw lists[0].reason;
    const byPid = new Map();
    for (const w of lists.flatMap(r => (r.status === 'fulfilled' ? r.value : []))) if ((!w.m3d || W3D.enabled) && (!byPid.has(w.pid) || byPid.get(w.pid).t < w.t)) byPid.set(w.pid, w);
    return [...byPid.values()].sort((a, b) => b.t - a.t);
  }
  // 卡片：照片、牆名、公開路線數（別的站的牆加上站名）；已經有這面牆就寫「已收下」，點了直接打開
  function findCard(x, have) {
    const b = document.createElement('button'); b.className = 'wall-card'; b.dataset.id = x.pid;
    const img = document.createElement('img'); img.alt = ''; img.draggable = false; img.loading = 'lazy'; img.decoding = 'async'; if (x.thumb) img.src = x.thumb;   // 一次排 30 張：畫面外的縮圖不先下載、解碼不擋主執行緒
    const meta = document.createElement('span'); meta.className = 'meta';
    const name = document.createElement('span'); name.className = 'name';
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = x.name; name.append(nm);
    const sub = document.createElement('span'); sub.className = 'sub';
    sub.textContent = have ? t('findHave') : x.siteName && x.site !== ShareTools.homeSite() ? `${t('routesN', x.n)} · ${x.siteName}` : t('routesN', x.n);
    meta.append(name, sub); b.append(img, meta);
    b.onclick = () => have ? openWall(x.pid) : x.m3d ? W3D.receive(`${location.origin}${location.pathname}?m3d=${x.pid}`) : recvWall(x);
    return b;
  }
  // 開箱的畫面：info()／progress() 邊下載邊畫，reveal({ snap, wall, photo }) 存檔、揭曉，按「看這條線」後打開（回傳 Promise）
  // hidden：先不顯示（還在問要不要收下），show() 再打開
  function unbox(rid, { hidden = false } = {}) {
    const gen = rvReset(), alive = () => gen === rvGen;
    $('recvPage').hidden = false; if (!rvWatch) rvGuard(true); $('rvBox').hidden = hidden;
    const pic = $('rvPic'), col = $('rvColor'), S = 640;
    pic.width = pic.height = col.width = col.height = S;
    let W = 0, H = 0, crop = null, holds = [], route = null, owner = '', counted = -1, picSeq = 0;
    // 正方形的裁切：路線岩點（沒有就整張）的範圍加一圈，不超出照片
    const cropOf = () => {
      const hs = route ? holdsOf(route, { holds }) : [];
      if (!hs.length) { const side = Math.min(W, H); return { sx: (W - side) / 2, sy: (H - side) / 2, side }; }
      const b = hs.map(h => bbox(h.poly)).reduce((a, x) => ({ x0: Math.min(a.x0, x.x0), y0: Math.min(a.y0, x.y0), x1: Math.max(a.x1, x.x1), y1: Math.max(a.y1, x.y1) }));
      const side = Math.min(W, H, Math.max(b.x1 - b.x0, b.y1 - b.y0) * 1.3 + Math.max(W, H) * 0.06);
      return { sx: Math.max(0, Math.min(W - side, (b.x0 + b.x1 - side) / 2)), sy: Math.max(0, Math.min(H - side, (b.y0 + b.y1 - side) / 2)), side };
    };
    const drawCrop = (g, img, k = 1) => g.drawImage(img, crop.sx * k, crop.sy * k, crop.side * k, crop.side * k, 0, 0, S, S);
    // 傳來的是一條線時，卡片的底跟路線圖一樣（灰階＋冷灰，RouteKit.tintCard）：下載中的縮圖就這樣畫，
    // 揭曉時不會先彩色再閃成灰，飛進路線圖時也不會有一塊顏色不同的方塊
    const countUp = (n) => { const t0 = performance.now(); const tick = () => { if (!alive()) return; const p = Math.min(1, (performance.now() - t0) / 1400); $('rvCount').textContent = Math.round(n * (1 - (1 - p) ** 3)); if (p < 1) requestAnimationFrame(tick); }; tick(); };
    const loadImg = AppKit.photo.load;
    return {
      show() { if (alive()) $('rvBox').hidden = false; },
      info(x) {
        if (!alive()) return;
        if ('ownerName' in x) {
          owner = x.ownerName; route = (x.routes || []).find(r => r.id === rid) || null;
          $('rvAv').style.visibility = x.pending ? 'hidden' : '';   // 出線者還沒讀到（先到的預覽）：圓圈先空著，別先放牆名的字再換成署名的字
          if (!x.pending) rvAvatar($('rvAv'), owner || x.name);
          $('rvFrom').textContent = x.title || t(route ? 'rvFromRoute' : 'rvFromWall', owner || t('rvSomeone'));
          $('rvBox').classList.add('has-from');
        }
        // 先到的極小預覽圖沒有岩點（牆還沒到）：取中間的正方形；牆到了才照路線裁切。晚到的圖不蓋掉後來的
        if (x.thumb) {
          if (x.holds) { W = x.w; H = x.h; holds = x.holds; crop = cropOf(); }
          if (x.holds && holds.length !== counted) countUp(counted = holds.length);
          const seq = ++picSeq;
          loadImg(x.thumb).then(im => {
            if (!alive() || seq !== picSeq) return;
            const g = pic.getContext('2d', { willReadFrequently: true }), side = Math.min(im.width, im.height);
            if (crop) drawCrop(g, im, im.width / W); else g.drawImage(im, (im.width - side) / 2, (im.height - side) / 2, side, side, 0, 0, S, S);
            if (rid) RouteKit.tintCard(g, S); $('rvBox').classList.add('has-pic');
          });
        }
      },
      // 照片由模糊變清楚：下載進度 0.5（有縮圖）時很糊，越接近 1 越清楚
      progress(p) { if (alive()) pic.style.filter = `blur(${Math.round((1 - p) * 28)}px)`; },
      fail(msg) { if (alive()) { rvStatus(msg); $('rvBox').classList.add('failed'); } },
      async reveal({ snap, wall, photo, onSaved }) {
        let before, w;
        try {
          before = await liveWall(snap.pid);
          w = await saveSnap(snap, wall, photo);
        } catch (e) {   // IndexedDB 存不了（空間不足、瀏覽器不允許）丟出的錯誤常是 null：不顯示的話畫面會停在開箱
          console.warn('收下的牆存不了', e);
          this.fail(t('saveFailed')); return null;
        }
        const oldIds = new Set(before ? before.routes.map(r => r.id) : []);
        if (!alive()) return null;
        if (onSaved) onSaved();
        const inc = (wall.routes || []).find(r => r.id === rid);
        W = w.w; H = w.h; holds = w.holds; route = inc ? w.routes.find(r => r.id === rid) || null : null; crop = cropOf();
        const url = URL.createObjectURL(photo || await getImage(w.id));
        const img = await loadImg(url).finally(() => URL.revokeObjectURL(url));   // 載入後就放掉整張照片的 blob
        if (!alive()) return null;
        // 灰階的底＋彩色的路線岩點一步一步亮起（整面牆維持彩色）
        const g = pic.getContext('2d', { willReadFrequently: true }); drawCrop(g, img);
        const color = document.createElement('canvas'); color.width = color.height = S; drawCrop(color.getContext('2d'), img);
        if (route) RouteKit.tintCard(g, S);
        pic.style.filter = 'blur(0)'; $('rvBox').classList.add('has-pic');
        const k = S / crop.side, hs = route ? holdsOf(route, { holds }) : [];
        const steps = route ? RouteKit.revealSteps(route, hs) : [];
        const STEP = steps.length ? Math.min(0.2, 1.4 / steps.length) : 0, FADE = 0.25;
        let skip = false;
        $('rvBox').onclick = () => { skip = true; };
        const cg = col.getContext('2d');
        const frame = (time) => {
          cg.clearRect(0, 0, S, S);
          steps.forEach((st, i) => {
            const a = skip ? 1 : Math.max(0, Math.min(1, (time - i * STEP) / FADE)); if (!a) return;
            cg.save(); cg.globalAlpha = a; cg.beginPath();
            for (const h of st) h.poly.forEach(([x, y], j) => cg[j ? 'lineTo' : 'moveTo']((x - crop.sx) * k, (y - crop.sy) * k));
            cg.clip(); cg.drawImage(color, 0, 0); cg.restore();
          });
        };
        await pause(450);   // 照片先清楚一下
        await new Promise(res => { const t0 = performance.now(), end = steps.length * STEP + FADE;
          const tick = () => { if (!alive()) return res(); const s = (performance.now() - t0) / 1000; frame(s); if (skip || s >= end) res(); else requestAnimationFrame(tick); }; tick(); });
        if (!alive()) return null;
        // 難度落下、膠帶短句
        const added = before ? w.routes.filter(r => !oldIds.has(r.id)).length : 0;
        if (route) { setGrade($('rvGrade'), route.grade); $('rvName').textContent = route.name || ''; }
        $('rvBox').classList.add('titled');
        const more = (wall.routes || []).length - (route ? 1 : 0);
        const cap = before ? t('rvUpdated', added) : route && more > 0 ? t('rvMore', more) : (() => { const p = t('capOpen'); return p[Math.floor(Math.random() * p.length)]; })();
        AppKit.shareImage.loadFonts('full', '', cap, lang);
        $('rvTape').textContent = cap; $('rvTape').style.fontFamily = `"cb ${AppKit.shareImage.capFont(lang)[1]}", var(--font)`;
        await pause(skip ? 0 : 350);
        $('rvBox').classList.add('taped'); buzz([12, 40, 18]);
        $('rvGo').textContent = t(route ? 'rvGoRoute' : 'rvGoWall'); $('rvGo').hidden = false;
        $('rvBox').onclick = null;
        // 按「看這條線」：牆面先在底下打開，卡片飛到路線圖上那一塊
        await new Promise(res => { $('rvGo').onclick = res; });
        if (!alive()) return null;
        await openWall(w.id);
        const fly = document.createElement('canvas'); fly.width = fly.height = S;
        const fg = fly.getContext('2d'); fg.drawImage(pic, 0, 0); fg.drawImage(col, 0, 0);
        Object.assign(fly.style, { position: 'fixed', visibility: 'hidden' });
        const r = $('rvCard').getBoundingClientRect(); fly.getBoundingClientRect = () => r; fly.crop = crop;
        closeRecv();
        if (route) openRouteFrom(route.id, fly);
        return { w, rid: route && route.id };
      },
    };
  }
  // 收到的路線：手上有這張照片的牆（牆 id 就是照片編號）就加進那面——路線自帶外框，我的岩點檔不動；
  // 路線用 id 對（新的加進來、兩邊都有的以修改時間晚的為準）。沒有就建一面新牆：原始岩點檔照收，我的岩點檔從它複製，岩館用分享的人那面牆的（snap.gym）。
  // w.from＝收過別人的線（首頁「收到的」篩選）
  // snap.got：這次算「重新收下」的路線 id（沒給＝全部；只有使用者點的那條才蓋過刪除紀錄）；snap.sub：{ url: 路線圖層, ids: 圖層裡的路線 id }，記進 w.subs 之後檢查更新
  async function saveSnap(snap, inc, photo) {
    const clean = cleanWall({ ...inc, id: snap.pid, routes: inc.routes || [] }), now = Date.now();
    const subs = snap.sub ? { subs: { [snap.sub.url]: { ids: snap.sub.ids } } } : {};
    // 停用的岩點（牆主人公開過、之後刪掉或合併掉）：只放在原始岩點檔（別人的路線外框從那裡補），我的岩點檔不放，新路線點不到
    const retired = new Set((inc.holds || []).filter(h => h && h.retired).map(h => h.id));
    const all = cleanHolds(clean.holds).map(h => ({ id: h.id, poly: h.poly, source: SOURCES.includes(h.source) ? h.source : 'detect' })), holds = all.filter(h => !retired.has(h.id));
    const routes = clean.routes.filter(r => r && typeof r.id === 'string' && r.holds && typeof r.holds === 'object').map(({ pub, own, sent, ...r }) => {
      // 遠端內容不能宣告自己是本人的路線；owned 只來自登入後的本人發佈清單。
      const received = { ...r, own: snap.owned ? 1 : 0, ...(!snap.got || snap.got.includes(r.id) ? { got: now } : {}) };
      return received;
    });
    // 存檔會補齊路線外框；先做同樣的整理，才記已發佈基準，避免存完立即變成待分享。
    settleWall({ holds, routes });
    for (const r of routes) r.pub = pubSig(r);
    const old = await liveWall(snap.pid);
    if (old) {
      const w = old;
      mergeRoutes(w, routes, {}, { front: true });   // 新收到的排在最前面
      Object.assign(w, { from: 1, updatedAt: now }, clean.grp && !w.grp ? { grp: clean.grp } : {});
      if (snap.sub) w.subs = { ...(w.subs || {}), ...subs.subs };
      await putWall(w);   // 馬上存（不走延遲存檔）：揭曉後重新打開牆面讀的是存好的這份
      if (state.wall === w) { resetUndo(); refreshOpenWall(); }
      if (!snap.nearby) pullWall(w.id).catch(e => console.warn('公開牆沒讀到', e));
      return w;
    }
    const top = all.reduce((m, h) => Math.max(m, +String(h.id).replace(/\D/g, '') || 0), 0);
    const w = { ...clean, id: snap.pid, pid: snap.pid, name: clean.name || snap.name || '', gym: String(snap.gym || '').slice(0, 30), holds, base: { holds: all.map(h => ({ id: h.id, poly: h.poly, ...(retired.has(h.id) ? { retired: true } : {}) })) },
      createdAt: now, updatedAt: now, nextId: top + 1, detected: 1, routes, from: 1, ...subs,
      ...(snap.owned && snap.pack ? { pack: snap.pack, share: 'public' } : {}) };
    const jpeg = await asJpeg(photo);
    // 首頁小卡的高解析縮圖收下時就做好：不然回首頁才在背景補做，小卡會先是糊的小縮圖再換一次
    try { const c = await blobToCanvas(jpeg), url = hiThumb(c, c.width, c.height), nearby = nearbyThumb(c, c.width, c.height);
      c.width = c.height = 0;
      if (url) { w.thumbHi = url; w.thumbHiKey = hiKey(jpeg); }
      if (nearby) { w.nearbyThumb = nearby; w.nearbyThumbKey = hiKey(jpeg); } }
    catch (e) { /* 做不出來就交給首頁背景補做（fillHiThumbs） */ }
    await putNewWall(w, jpeg);
    return w;
  }
  // ---------- 同一面牆別人分享的線：新的提示收下 ----------
  // 唯一保留的舊資料相容識別：舊版範例牆不顯示、不雲端同步、不發佈；絕不自動刪除 IndexedDB 資料。
  const isDemoPid = (pid) => pid === 'climbiodemo2';
  // 只留在這台的牆：舊版範例牆、3D 牆（js/wall3d.js：3D 用連結分享，不上傳、不同步）
  const localOnly = (w) => isDemoPid(w.pid) || !!w.m3d;
  // ---------- 公開牆：同一張照片大家看到同一份線（listShared：每個人的線存在 Climbio 的 wallRoutes，索引記著誰有、各自的版本，只下載有變的） ----------
  // 打開那面牆時只讀那一面、首頁下拉時讀全部，不在背景讀；同一面 5 分鐘內不重讀（下拉不算）。
  // 伺服器上的為準：作者改了就換、刪了就拿掉；自己還沒傳上去的留著，讀完接著傳；刪掉（別人的線＝隱藏）比線新的不放進來
  const isPublic = (w) => !!w && !!w.pub && !localOnly(w) && can('share');
  // 收來的牆（w.from）還沒有 w.pub：要先問一次伺服器有沒有人公開，有才記成公開牆（pullWall）；沒有就什麼都不動
  const watchable = (w) => !!w && !localOnly(w) && can('share') && (!!w.pub || !!w.from);
  // 牆 id → 讀的時間／隱藏的別人的線／這次打開 App 後新出現的別人的線（路線 id）
  const pulledAt = new Map(), hiddenLines = new Map(), freshLines = new Map();
  // 讀到的線合進這面牆（不連網路）：回傳 { routes, hidden: 隱藏的別人的線, gone: 自己刪了、伺服器上還在的路線 id, fresh: 新出現的別人的線 }
  function mergePulled(w, docs) {
    const live = liveIn((w.deleted && w.deleted.routes) || {}), local = new Map(w.routes.map(r => [r.id, r]));
    const mineOnServer = docs.some(d => d.mine);   // 自己的圖層在公開牆上：才拿伺服器的當準（私人的牆、收回公開的，自己的線不在上面）
    const out = [], hidden = [], gone = [], fresh = [], onServer = new Set(), base = new Map(((w.base && w.base.holds) || []).map(h => [h.id, h]));
    // 清單的順序是「舊到新」（預設排序再倒過來變成新的在前）；伺服器回來的是新的在前，所以照路線時間由舊到新排好再合進來
    for (const d of [...docs].sort((a, b) => (a.t || 0) - (b.t || 0))) {
      let s; try { s = JSON.parse(d.r); } catch (e) { continue; }
      if (!s || !s.holds || typeof s.holds !== 'object') continue;
      const shapes = { ...(s.shapes || {}) };   // 圖層只帶跟牆上不一樣的外框：其他用這面牆的原始岩點檔補
      for (const k of Object.keys(s.holds)) if (!shapes[k] && base.has(k)) shapes[k] = { id: k, poly: base.get(k).poly.map(q => q.slice()) };
      s = { ...s, shapes, id: d.rid, own: d.mine ? 1 : 0 }; s.pub = pubSig(s);
      onServer.add(d.rid);
      const l = local.get(d.rid);
      const x0 = l && d.mine && l.pub && l.pub !== pubSig(l) && (l.t || 0) >= (s.t || 0) ? { ...l, own: 1 }   // 有已發佈基準，且自己改了還沒傳上去
        : l && l.got ? { ...s, got: l.got } : s;
      const x = l && l.sent ? { ...x0, sent: 1 } : x0;   // 完攀只在這台，伺服器上的不帶
      if (!live(x)) { if (d.mine) gone.push(d.rid); else hidden.push(x); continue; }
      if (!l && !d.mine) fresh.push(d.rid);
      out.push(x);
    }
    for (const l of w.routes) if (!onServer.has(l.id) && (!l.pub || (mineRoute(l) && (l.pub !== pubSig(l) || !mineOnServer)))) out.push(l);   // 還沒傳上去的；傳過、伺服器上沒有了的是作者刪了
    return { routes: out, hidden, gone, fresh };
  }
  // 收過的分享包圖層（w.subs：{ 圖層網址: { ids } }）：私人分享也回頭檢查。已經在公開牆裡的（listShared 讀過的）不再讀
  const subsOf = (w) => Object.keys((w && w.subs) || {});
  // 牆主人更新了公開牆（版本變了）：重讀牆的岩點，換進這面牆。只動沒人改過的：我自己刪掉的岩點不放回來，我改過、自己畫的照舊；
  // 牆主人停用的岩點從我的岩點檔拿掉（舊路線自帶外框，原始岩點檔留著補別人的舊路線）；牆主人新增的加進來。照片換了（尺寸不同）就不動
  function applyPublicHolds(w, base) {
    const had = new Set(((w.base && w.base.holds) || []).map(h => h.id)), retired = new Set(base.holds.filter(h => h.retired).map(h => h.id)), mine = new Map(w.holds.map(h => [h.id, h]));
    const before = JSON.stringify([w.holds, w.base]), same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    w.base = { holds: base.holds.map(h => ({ id: h.id, poly: h.poly, ...(retired.has(h.id) ? { retired: true } : {}) })) };
    w.holds = w.holds.filter(h => !retired.has(h.id));
    for (const h of base.holds) {
      if (retired.has(h.id)) continue;
      const m = mine.get(h.id);
      if (!m) { if (!had.has(h.id)) w.holds.push({ id: h.id, poly: h.poly.map(q => q.slice()), source: SOURCES.includes(h.source) ? h.source : 'detect' }); }
      else if (m.source === 'detect' && !same(m.poly, h.poly)) m.poly = h.poly.map(q => q.slice());
    }
    settleWall(w);
    return !same([w.holds, w.base], JSON.parse(before));
  }
  async function refreshHolds(w, docs) {
    const got = await ShareTools.fetchHolds(new URL(`/p/${docs.src.project}/${docs.src.path}`, SITE.url).href, w.pid);
    if (got.base.w === w.w && got.base.h === w.h) applyPublicHolds(w, got.base);
    w.viewVer = docs.ver;
  }
  async function pullWall(id) {
    const w0 = await liveWall(id);
    if (!w0 || navigator.onLine === false || (!watchable(w0) && !subsOf(w0).length)) return;
    const docs = isPublic(w0) || (can('share') && !localOnly(w0)) ? await Backend.listShared(w0.pid) : [];   // 收過分享的牆也問：有人公開就是公開牆
    if (docs.published === false && w0.from && w0.pub && !localOnly(w0)) return dropWithdrawn(w0);   // 擁有者收回了：這面牆跟著移除
    const read = new Set(docs.map(d => d.src).filter(Boolean)), subs = {};
    for (const url of subsOf(w0).filter(u => !read.has(u))) {
      try {
        const routes = await ShareTools.layerRoutes(url, w0.pid);
        subs[url] = routes.map(r => r.id);
        for (const r of routes) docs.push({ rid: r.id, mine: false, r: JSON.stringify(r), t: r.t || 0 });
      } catch (e) { if (e.gone) subs[url] = null; else console.warn('收過的分享沒讀到', e); }   // 作者拿掉了：不再檢查，那個人的線一起拿掉
    }
    const w = await liveWall(id);
    if (!w || (state.wall === w && !$('editor').hidden)) return;   // 定線、看線中不換掉路線
    const was = wallSig(w);
    let holdsChanged = false;
    if (w.from && !w.pack && docs.src && docs.ver && w.viewVer !== docs.ver) { try { await refreshHolds(w, docs); holdsChanged = true; } catch (e) { console.warn('公開牆的岩點沒讀到', e); } }   // 收來的牆，牆主人發了新版
    if (!w.pub && docs.length) w.pub = 1;
    // 訂閱的圖層：作者刪掉的線（上次有、這次沒有）先拿掉（自己改過另存的不動），再合併：作者刪了又出一條同點的新線時，留的是新的
    let subsChanged = false;
    for (const [url, ids] of Object.entries(subs)) {
      const now = new Set(ids || []), gone = ((w.subs && w.subs[url] && w.subs[url].ids) || []).filter(x => !now.has(x));
      if (gone.length) w.routes = w.routes.filter(r => !gone.includes(r.id) || mineRoute(r));
      if (ids) w.subs[url] = { ids }; else delete w.subs[url];
      subsChanged = true;
    }
    const m = mergePulled(w, docs);
    w.routes = m.routes; hiddenLines.set(w.id, m.hidden);
    if (w.pulled) { const f = freshLines.get(w.id) || new Set(); for (const rid of m.fresh) f.add(rid); freshLines.set(w.id, f); }
    if (state.wall === w && state.routeId && !w.routes.some(r => r.id === state.routeId)) state.routeId = null;
    if (wallSig(w) !== was || !w.pulled || subsChanged || holdsChanged) { w.pulled = 1; await putWall(w); }
    repaint(w);
    if (m.gone.length && isPublic(w)) Backend.unshareRoutes(w.pid, m.gone).catch(e => console.warn('公開牆上刪掉的線沒拿掉', e));   // 自己刪了、公開牆上還在的線：拿掉
  }
  // 擁有者收回了公開（改私人、刪掉牆、90 天沒更新自動下架）：收來的牆先不動，自動跳出清單問一次，想移除的一鍵全部移除（連同路線，完攀統計不動）；
  // 想留著的（可能有自己定的線）選保留，這幾面牆之後不再當公開牆讀。正在看的先不動，下次再讀
  let withdrawn = [], withdrawnTimer = 0, withdrawnAsking = new Set();
  function dropWithdrawn(w) {
    if ((state.wall && state.wall.id === w.id) || withdrawnAsking.has(w.id) || withdrawn.some(x => x.id === w.id)) return;
    withdrawn.push(w);
    clearTimeout(withdrawnTimer);
    withdrawnTimer = setTimeout(askWithdrawn, 400);
  }
  async function askWithdrawn() {
    const list = withdrawn; withdrawn = [];
    if (!list.length) return;
    for (const w of list) withdrawnAsking.add(w.id);
    try {
      if (await askConfirm(t('wallsWithdrawn', list.map(w => w.name || '—').join('、')), { ok: t('wallsRemoveAll'), danger: true })) {
        for (const w of list) { await deleteWall(w.id); pulledAt.delete(w.id); hiddenLines.delete(w.id); freshLines.delete(w.id); }
      } else for (const w of list) await patchWall(w.id, (x) => { x.pub = 0; });
      repaint(list[0]);
    } finally { for (const w of list) withdrawnAsking.delete(w.id); }
  }
  // 讀完、傳完：正在看的頁面重畫
  function repaint(w) {
    if (!w) return;
    if (!$('home').hidden) showHome();
    if (state.wall && state.wall.id === w.id && !$('wall').hidden) renderOverview();
  }
  async function readPublic(only, { force = false } = {}) {
    if (!can('share') || navigator.onLine === false) return;
    const ws = (only ? [await liveWall(only).catch(() => null)].filter(Boolean) : await listWalls().catch(() => []))
      .filter(w => (watchable(w) || (subsOf(w).length && !localOnly(w))) && (force || Date.now() - (pulledAt.get(w.id) || 0) >= 60 * 1000));   // 讀的是 CDN 快取的 GET（一分鐘，全部人共用），一分鐘讀一次不增加雲端函式呼叫
    if (ws.filter(isPublic).length > 1) await Backend.primeShared(ws.filter(isPublic).map(w => w.pid)).catch(e => console.warn('公開牆的索引沒讀到', e));   // 好幾面牆：一次問完哪些圖層有變
    for (const w of ws) {
      pulledAt.set(w.id, Date.now());
      await pullWall(w.id).catch(e => { pulledAt.delete(w.id); console.warn('公開牆沒讀到', e); });
      if (isPublic(w)) autoShare(w.id);   // 之前定好、還沒公開的線（舊版要按分享、當時沒網路或沒暱稱）：開牆讀完就補傳
    }
  }
  // 顯示隱藏的別人的線：比刪除晚，放回來
  function showHidden(w) {
    for (const r of hiddenLines.get(w.id) || []) { w.routes.push(r); keepLine(w, r); }
    hiddenLines.delete(w.id); save(); renderOverview();
  }
  $('rvClose').onclick = closeRecv;

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { restoreCanvases().then(shareResume); if (state.wall && watchable(state.wall)) readPublic(state.wall.id, { force: true }).catch(() => {}); } });
  // 回到前景時分享畫面還開著：預覽還沒好（或在背景中斷）的，畫布復原後再做一次
  function shareResume() {
    if ($('shareDialog').hidden || !shareCtx || !shareCtx.route || $('shPrev').hidden) return;
    if (!fileCache.has(routeKey())) renderPreview();
  }
  // iOS 把 App 放到背景時可能清掉 canvas 的內容（回來路線圖變黑）：回到前景時快取的底圖、岩點彩色範圍都重畫（路線小卡的小圖是圖片，不受影響），
  // 照片、灰階也被清掉的話從手機裡的照片重建
  const lostCanvas = (c) => { try { return c.getContext('2d').getImageData(0, 0, 1, 1).data[3] === 0; } catch (e) { return false; } };
  async function restoreCanvases() {
    const w = state.wall;
    if (!w || !state.img) return;
    const grayLost = state.scene.recover(lostCanvas); shownBaseKey = '';
    if (lostCanvas(state.img) || grayLost) {
      const blob = await getImage(w.id).catch(() => null);
      if (!blob || state.wall !== w) return;
      const c = await blobToCanvas(blob);
      if (state.wall !== w) return;
      state.scene.release(); state.img = c; state.scene = RouteKit.scene(c, () => w.holds); state.ana = null;
    }
    if (!$('editor').hidden) render();
  }

