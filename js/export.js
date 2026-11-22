// Climbio 輸出：分享的路線圖（限時動態、貼文；滿版、卡片）。
// 依序載入（app → home → profile → add-wall → edit → wall → sync → draw → export → mobile → tour → main），共用同一個全域範圍；載入當下只能用到前面檔案宣告的東西。
// English: Export: shareable route images (Climbio layout).
'use strict';
  // ---------- 輸出 ----------
  // 版面（滿版、卡片、字型、署名）在 appkit/share-image.js，紅點貓共用；這裡只畫岩點貓的底圖、給路線的範圍
  // 路線圖：fmt＝'story'（IG 限時動態 9:16）、'post'（貼文 4:5）
  async function routeImage(fmt, { current = () => true } = {}) {
    const r = route();
    return AppKit.shareImage.make({
      size: { w: state.w, h: state.h }, base: () => routeBaseCanvas(r), focus: exportHolds(r).map(h => bbox(h.poly)),
      grade: r.grade, name: r.name || '', by: routeAuthor(r), fmt, logo: AppKit.shareImage.symbolLogo($('i-brand-mark')), lang, current,
    });
  }
  // 原尺寸的路線圖（底圖、路線岩點、標籤）只跟路線有關：換尺寸直接沿用，不再重畫整張（低階手機要將近一秒）。
  // 只留目前這一張（照片大小的畫布很佔記憶體），關掉分享畫面就放掉
  // 3D 牆：分享圖畫的是正面快照，用正面外框（W3D.frontHolds）；還沒有正面外框就退回目前的外框
  const exportHolds = (r) => { const f = state.wall.m3d && W3D.frontHolds(state.wall); return f ? RouteKit.routeHolds({ holds: r.holds }, f) : holdsOf(r); };
  let routeBase = null;
  function routeBaseCanvas(r) {
    const key = JSON.stringify([state.scene.version, state.wall.holds.length, r.holds, r.seq, exportHolds(r).map(h => h.poly)]);
    if (routeBase && routeBase.key === key && routeBase.img === state.img) return routeBase.canvas;
    const c = RouteKit.renderRouteImage(state.scene, r, exportHolds(r));
    routeBase = { key, img: state.img, canvas: c };
    return c;
  }
  // 自己出的路線用共用暱稱；別人的作者資訊保留原樣。
  const routeAuthor = (r) => mineRoute(r) ? signName() : r.author;
  const SIGN_KEY = 'climbio.sign', SIGN_AT = 'climbio.signAt'; // 僅供舊備份格式辨識
  const signName = () => AppKit.nearby.nickname() || '';
  async function askSign() {
    if (!await AppKit.nearby.ensureNickname({ edit: true, suggested: '' })) return false;
    fileCache.clear();
    return true;
  }
  const canShareFiles = () => AppKit.share.canShareFiles();
  // iOS 要求 navigator.share 在點擊當下呼叫，先 await 產圖會被擋（NotAllowedError）。
  // 所以圖片依路線內容快取：內容沒變就直接分享；第一次產圖後被擋，就提示再按一次。
  // 每條路線、每個簽名各留一份（最多 12 份，舊的先丟）：換回來不用重做
  const fileCache = new Map();
  const cacheFile = (key, file) => { fileCache.delete(key); fileCache.set(key, file); while (fileCache.size > 12) fileCache.delete(fileCache.keys().next().value); return file; };
  // 預覽和「圖片」都是限時動態尺寸
  const routeKey = () => { const r = route(); return r ? JSON.stringify([state.wall.id, r.id, r.grade, r.name, r.holds, r.seq, routeAuthor(r)]) : ''; };
  // 被擋（iOS 要求在點擊當下分享）回 false，讓呼叫端提示再按一次；其餘情況（分享、取消、改成下載）都算完成
  const shareFile = async (file) => (await AppKit.share.sendFile(file, { strictGesture: true })) !== 'blocked';
  // 路線的分享鈕：分享畫面（登入了連結帶路線；沒登入只分享路線圖，連結是 App 首頁）
  $('shareBtn').onclick = () => { $('edMenu').hidden = true; shareRoute(); };
  const shareRoute = () => {
    if (!state.wall || !route()) return;
    openShare({ kind: 'wall', id: state.wall.id, route: route().id });
  };
  // 同一內容共用進行中的產圖；過時的工作不排隊。
  const preparingFiles = new Map();
  function prepareRouteFile() {
    const key = routeKey();
    if (fileCache.has(key)) return Promise.resolve(fileCache.get(key));
    if (preparingFiles.has(key)) return preparingFiles.get(key);
    const wall = state.wall;
    const current = () => !!shareCtx && state.wall === wall && routeKey() === key;   // 關掉分享畫面就不畫了
    const job = makeRouteFile(key, current).finally(() => preparingFiles.delete(key));
    preparingFiles.set(key, job);
    return job;
  }
  async function makeRouteFile(key, current) {
    // 產圖途中切到背景：iOS 可能清掉畫布，做出來的可能是黑圖，不留（回來再做）
    let hid = document.hidden;
    const onHide = () => { if (document.hidden) hid = true; };
    document.addEventListener('visibilitychange', onHide);
    const x = await routeImage('story', { current }).finally(() => document.removeEventListener('visibilitychange', onHide));
    if (!current() || hid) throw new DOMException('預覽已更新', 'AbortError');
    return cacheFile(key, new File([x.blob], x.name, { type: x.blob.type }));
  }
  // 圖片：只在本機產圖，不上傳、不附連結
  async function shareRouteImage() {
    const key = routeKey(), ctx = shareCtx;
    try {
      const file = fileCache.get(key) || await prepareRouteFile();
      if (shareCtx === ctx && routeKey() === key) sendFile(file);
    } catch (e) {
      if (shareCtx === ctx && routeKey() === key && e.name !== 'AbortError') shStatus(e.message || String(e));
    }
  }
  async function sendFile(file) {
    // 不等待別的非同步工作，保留 iPhone 分享所需的點擊授權
    if (!canShareFiles()) return AppKit.share.download(file, file.name, 1000);   // 不能分享檔案的瀏覽器（部分電腦）：改成下載
    if (!(await shareFile(file))) toast(t('shareReady'));
  }
