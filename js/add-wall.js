// 新增牆面：拍照或選照片、裁切、消除、事後修照片、分析畫面、偵測框轉岩點輪廓、整面牆重描。
// 依序載入（app → home → profile → add-wall → edit → wall → sync → draw → export → mobile → tour → main），共用同一個全域範圍；載入當下只能用到前面檔案宣告的東西，
// 事件處理、計時器等之後才執行的程式不受限制。啟動與事件綁定放在最後的 main.js。
// English: Add a wall: take/pick a photo, crop, erase, photo fixes, analysis screen, detection boxes to hold outlines, whole-wall retrace.
'use strict';
  // ---------- 新增牆面：拍照或選照片 → 裁切 → 偵測 ----------
  // 首頁「＋」的新增牆面、開場的「開始拍」：先在 App 裡選拍照或相簿。拍照用 App 自己的相機（16:9，長邊 1920；系統相機不能選 16:9），
  // 要更高畫質選相簿。
  // 按下就叫醒雲端、在背景下載長按用的解碼器（拍照、選照片的時間剛好蓋過）
  let addTo = null;   // 「增加照片」：{ wall: 組合裡的任一面牆, side: -1 左／1 右 }；新增牆面（＋）時是 null
  // 「＋」的拍照、相簿是兩顆按鈕，開場的「開始拍」直接開相機
  function addWall(library = false) {
    addTo = null;
    warmDetect(); warmRefiner();   // 偵測模型先下載，重描的解碼器（16.5 MB）等它好了再下載，不搶頻寬
    if (library === true) $('photoInput').click(); else openCamera();
  }
  $('addWallBtn').onclick = () => addWall();
  $('addLibraryBtn').onclick = () => addWall(true);
  // ---------- 增加照片：同一面牆的另一張（上攀牆很高、牆很寬，一張拍不完） ----------
  // 新照片是自己的一面牆，跟原本的記上同一個 grp（js/wall.js 的跨照片路線用它）。組合只往一個方向排（axis：h 左右、v 上下），
  // 新照片加在最前（左、上）或最後（右、下）；位置由使用者選，照片並排接上（沒有對齊）
  const SIDE_AXIS = { left: 'h', right: 'h', up: 'v', down: 'v' }, isFirstSide = (side) => side === 'left' || side === 'up';
  let sideWall = null;   // 位置選單開著時：原本的牆
  // 位置選單：現在的照片縮小放中間（組合就照排列方向放整排），四邊是可以加的位置；組合只開同方向的兩邊
  async function openSideSheet(w) {
    sideWall = w;
    const axis = w.grp ? w.grp.axis || 'h' : '';
    for (const [side, id] of [['up', 'sideUp'], ['down', 'sideDown'], ['left', 'sideLeft'], ['right', 'sideRight']]) $(id).hidden = !!axis && axis !== SIDE_AXIS[side];
    const box = $('sideWalls');
    box.dataset.axis = axis || 'h';
    box.replaceChildren(...(await Promise.all((w.grp ? w.grp.ids : [w.id]).map(id => id === w.id ? w : getWall(id).catch(() => null)))).filter(Boolean).map(x => {
      const img = document.createElement('img'); img.src = x.thumbHi || x.thumb || BLANK_IMG; img.alt = ''; img.style.aspectRatio = `${x.w || 4} / ${x.h || 3}`;
      return img;
    }));
    for (const id of LAYERS) $(id).hidden = true;
    openLayer('sideSheet');
  }
  function chooseSide(side) {
    if (sideWall) addPhotoTo(sideWall, side);
  }
  function addPhotoTo(w, side) {
    addTo = { wall: w, side };
    warmDetect(); warmRefiner();
    for (const id of LAYERS) $(id).hidden = true;
    openLayer('addSheet');   // 同一層返回
  }
  // 新照片 n 併進 home 所在的組合（沒有組合就新建），放在最前或最後：並排，n 的原點接在鄰居的邊上，照片大小不同就等比縮放成同高（左右）或同寬（上下）
  async function joinGroup(home, n, side) {
    const old = home.grp, axis = SIDE_AXIS[side], ids = old ? old.ids : [home.id], first = isFirstSide(side), edgeId = ids[first ? 0 : ids.length - 1];
    if (old && (old.axis || 'h') !== axis) throw new Error('組合的排列方向不同');
    const edge = edgeId === home.id ? home : await getWall(edgeId);
    if (!edge) throw new Error('組合的邊緣照片不在這台');
    let link;
    const [a, b] = first ? [n, edge] : [edge, n];
    if (axis === 'h') { const s = b.h / a.h; link = { a: a.id, b: b.id, H: [s, 0, -a.w * s, 0, s, 0, 0, 0, 1], dx: a.w, dy: 0 }; }
    else { const s = b.w / a.w; link = { a: a.id, b: b.id, H: [s, 0, 0, 0, s, -a.h * s, 0, 0, 1], dx: 0, dy: a.h }; }
    const grp = { id: old ? old.id : newPid(), axis, ids: first ? [n.id, ...ids] : [...ids, n.id], links: [...(old ? old.links : []), link] };
    n.grp = grp; n.updatedAt = Date.now();
    await putWall(n);
    for (const id of ids) {
      const x = id === home.id ? home : id === edgeId ? edge : await getWall(id).catch(() => null);
      if (!x) continue;
      x.grp = grp; x.updatedAt = Date.now();
      await putWall(x);
    }
    if (state.wall === n) { renderGrpStrip(n); loadRelays(n); }
  }
  // 沒有相機介面的瀏覽器退回系統相機
  const openCamera = () => { if (navigator.mediaDevices?.getUserMedia) openShotCam(); else { $('cameraInput').click(); dismissMenu(); } };
  $('addCamera').onclick = openCamera;
  $('addLibrary').onclick = () => { $('photoInput').click(); dismissMenu(); };
  $('addCancel').onclick = dismissMenu;
  $('addSheet').onclick = (e) => { if (e.target === $('addSheet')) dismissMenu(); };
  // 岩館：pos 是 Promise<位置或 null>
  const gymOfPos = (pos) => pos.then(gymAt).catch((err) => { console.warn('gymAt', err); return ''; });
  // ---------- App 自己的相機：16:9 的影片串流，長邊 1920 ----------
  let shotStream = null;
  function stopShotCam() {
    if (shotStream) shotStream.getTracks().forEach(tr => tr.stop());
    shotStream = null; $('shotVideo').srcObject = null; $('shotCam').hidden = true;
  }
  async function openShotCam() {
    try {
      shotStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, aspectRatio: { ideal: 16 / 9 } }, audio: false });
      const v = $('shotVideo'); v.srcObject = shotStream; await v.play();
    } catch (err) { stopShotCam(); $('cameraInput').click(); dismissMenu(); return; }   // 沒授權、不支援：退回系統相機
    for (const id of LAYERS) $(id).hidden = true;
    $('shotCam').hidden = false;
    openOverlay('shotCam', stopShotCam);
  }
  $('shotClose').onclick = () => { stopShotCam(); closeOverlay('shotCam'); };
  $('shotSnap').onclick = async () => {
    const v = $('shotVideo');
    if (!v.videoWidth) return;
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    stopShotCam();
    gymNear = gymOfPos(hereNow());   // 人在現場：用目前位置找岩館
    await closeOverlay('shotCam');
    openCrop(c); hideWelcome();
  };
  for (const id of ['photoInput', 'cameraInput']) $(id).onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    gymNear = gymOfPos(photoGps(f).then(c => c || (id === 'cameraInput' ? hereNow() : null)));
    try { await startCrop(f); hideWelcome(); } catch (err) { welcomeAgain(); showAlert(t('badPhoto')); }   // 裁切畫面接好才收開場，解碼時不露出空首頁
  };

  // 岩館：牆面的 w.gym 是岩館清單（gyms/）的名稱，空的＝其他。用照片裡的拍攝位置（EXIF GPS；
  // Android 的瀏覽器拿不到，iPhone 拿得到），沒有位置只有 App 選單的「拍照」（人一定在現場）才用目前位置，相簿的照片不猜；GYM_NEAR 公尺內最近的一間就是這面牆的岩館，也加在牆名上；判斷不到就不填，不讓使用者選或改（岩點貓的牆多半是朋友互傳，有沒有岩館都不重要）。位置只在這台比對，不送出
  const GYM_NEAR = 300;
  let gymNear = null, gymIndex = null;
  // 岩館清單每個國家一個檔（gyms/<國碼>.json，[名稱, 緯度, 經度]），gyms/index.json 是各國岩館的範圍：只載入位置所在的國家
  const gymFiles = new Map();
  const load = (url) => fetch(url).then(r => { if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json(); });
  // i：在檔案裡的順序（台灣的檔已經從北到南、同系列放一起排好，見 docs/gyms.md），沒有定位時照它列
  const gymCountry = (cc) => gymFiles.get(cc) || gymFiles.set(cc, load(`../gyms/${cc}.json`).then(a => a.map(([name, lat, lon], i) => ({ name, lat, lon, cc, i })))
    .catch((err) => { gymFiles.delete(cc); throw err; })).get(cc);
  // c：位置（只要範圍包住它的國家）；沒給就是全部國家（搜尋用）
  async function gyms(c) {
    const index = await (gymIndex || (gymIndex = load('../gyms/index.json').catch((err) => { gymIndex = null; throw err; })));
    const ccs = new Set(index.filter(([, s, w, n, e]) => !c || (c.lat >= s && c.lat <= n && c.lon >= w && c.lon <= e)).map(([cc]) => cc));
    return (await Promise.all([...ccs].map(gymCountry))).flat();
  }
  const gymLabel = (g) => g || t('gymOther');
  // 沒有定位時的順序：台灣的照檔案順序（從北到南、同系列放一起）排在前面，其他國家照名稱
    function hereNow() {
    if (!navigator.geolocation) return Promise.resolve(null);
    return new Promise(res => navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lon: p.coords.longitude }), () => res(null), { timeout: 15000, maximumAge: 60000 }));
  }
  const gymMeters = (c, g) => Math.hypot(g.lat - c.lat, (g.lon - c.lon) * Math.cos(c.lat * Math.PI / 180)) * 111320;
  async function gymAt(c) {
    if (!c) return '';
    const best = (await gyms(c)).reduce((a, g) => (gymMeters(c, g) < (a ? gymMeters(c, a) : GYM_NEAR) ? g : a), null);
    return best ? best.name : '';
  }
  // 照片的拍攝位置（EXIF 的 GPS，AppKit.photo）：EXIF 在檔案開頭的 APP1，讀前 128 KB 就夠
  async function photoGps(f) {
    try { const { lat, lng } = AppKit.photo.readExif(await f.slice(0, 131072).arrayBuffer()); return Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng) ? { lat, lon: lng } : null; }
    catch (err) { return null; }   // EXIF 壞掉：當作沒有位置
  }
  // 裁切：原圖先縮到長邊 4096（裁完再縮到 MAX_SIDE），框的座標用原圖像素。
  // 畫布佔滿整個區域，照片可以縮放、平移（兩指捏合；電腦用觸控板捏合或 Ctrl＋滾輪，滾輪平移），細部才拉得準：
  // 畫面座標 = 照片座標 × k × view.s ＋ (view.ox, view.oy)；k＝剛好放進去的比例
  // 照片四周留 CROP_PAD：照片邊緣不貼著畫布邊緣，角落整圈都按得到。
  const crop = { src: null, rect: null, k: 1, drag: null, view: { s: 1, ox: 0, oy: 0 }, cw: 0, ch: 0 };
  const CROP_MAX = 4096, HANDLE = 32, CROP_ZOOM = 8, CROP_PAD = 20;
  async function startCrop(file) {
    const c = await AppKit.photo.toCanvas(file, CROP_MAX);
    openCrop(c);
  }
  function openCrop(c) {
    crop.src = c;
    crop.rect = { x: 0, y: 0, w: c.width, h: c.height };
    $('cropDone').disabled = false;
    $('crop').hidden = false;
    history.pushState({ s: 'crop' }, '');
    layoutCrop(true);
  }
  // 裁好的照片（長邊最多 MAX_SIDE）：按 ✓ 用的裁法
  function cropCanvas(src, r) {
    const s = Math.min(1, MAX_SIDE / Math.max(r.w, r.h)), c = document.createElement('canvas');
    c.width = Math.round(r.w * s); c.height = Math.round(r.h * s);
    c.getContext('2d').drawImage(src, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    return c;
  }

  function layoutCrop(reset = false) {
    if (!crop.src) return;
    const st = $('cropStage'), cvs = $('cropCv'), W = st.clientWidth, H = st.clientHeight;
    if (W <= 2 * CROP_PAD || H <= 2 * CROP_PAD) return;
    crop.cw = W; crop.ch = H;
    crop.k = Math.min((W - 2 * CROP_PAD) / crop.src.width, (H - 2 * CROP_PAD) / crop.src.height);
    if (reset) crop.view = { s: 1, ox: 0, oy: 0 };
    clampCropView();
    const dpr = window.devicePixelRatio || 1;
    cvs.style.width = W + 'px'; cvs.style.height = H + 'px';
    cvs.width = Math.round(W * dpr); cvs.height = Math.round(H * dpr);
    drawCrop();
  }
  // 照片比畫面小的方向置中，比畫面大的方向最多拖到照片邊緣離畫布邊緣 CROP_PAD
  function clampCropView() {
    const v = crop.view, sc = crop.k * v.s, iw = crop.src.width * sc, ih = crop.src.height * sc, P = CROP_PAD;
    v.ox = iw <= crop.cw - 2 * P ? (crop.cw - iw) / 2 : Math.min(P, Math.max(crop.cw - P - iw, v.ox));
    v.oy = ih <= crop.ch - 2 * P ? (crop.ch - ih) / 2 : Math.min(P, Math.max(crop.ch - P - ih, v.oy));
  }
  // 以畫面上的 (cx, cy) 為中心縮放到 s 倍
  function zoomCrop(s, cx, cy) {
    const v = crop.view, s1 = Math.min(CROP_ZOOM, Math.max(1, s)), f = s1 / v.s;
    v.ox = cx - (cx - v.ox) * f; v.oy = cy - (cy - v.oy) * f; v.s = s1;
    clampCropView(); drawCrop();
  }
  function drawCrop() {
    const cvs = $('cropCv'), g = cvs.getContext('2d'), dpr = cvs.width / crop.cw;
    const v = crop.view, sc = crop.k * v.s, dw = crop.src.width * sc, dh = crop.src.height * sc;
    const r = { x: crop.rect.x * sc + v.ox, y: crop.rect.y * sc + v.oy, w: crop.rect.w * sc, h: crop.rect.h * sc };
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, crop.cw, crop.ch);
    g.imageSmoothingQuality = 'high';
    g.drawImage(crop.src, v.ox, v.oy, dw, dh);
    g.fillStyle = 'rgba(0,0,0,.6)';
    g.beginPath(); g.rect(v.ox, v.oy, dw, dh); g.rect(r.x, r.y, r.w, r.h); g.fill('evenodd');
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1;
    g.beginPath();
    for (const t of [1 / 3, 2 / 3]) {
      g.moveTo(r.x + r.w * t, r.y); g.lineTo(r.x + r.w * t, r.y + r.h);
      g.moveTo(r.x, r.y + r.h * t); g.lineTo(r.x + r.w, r.y + r.h * t);
    }
    g.stroke();
    g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.strokeRect(r.x, r.y, r.w, r.h);
    g.lineWidth = 4; g.lineCap = 'round';
    const L = Math.min(22, r.w / 3, r.h / 3);
    for (const [cx, cy, sx, sy] of [[r.x, r.y, 1, 1], [r.x + r.w, r.y, -1, 1], [r.x, r.y + r.h, 1, -1], [r.x + r.w, r.y + r.h, -1, -1]]) {
      g.beginPath(); g.moveTo(cx + sx * L, cy); g.lineTo(cx, cy); g.lineTo(cx, cy + sy * L); g.stroke();
    }
  }
  // 一指：拖角落改大小；沒放大時拖框內移動框，放大時拖其他地方平移照片；兩指：捏合縮放＋平移
  const cropCv = $('cropCv'), cropPts = new Map();
  const cropXY = (e) => { const b = cropCv.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  function startCropPinch() {
    const [a, b] = [...cropPts.values()];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, v = crop.view;
    crop.drag = { mode: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: v.s,
      ix: (mid.x - v.ox) / (crop.k * v.s), iy: (mid.y - v.oy) / (crop.k * v.s) };   // 兩指中間對到照片的哪一點
  }
  cropCv.addEventListener('pointerdown', (e) => {
    const p = cropXY(e);
    cropPts.set(e.pointerId, p);
    try { cropCv.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件 */ }
    if (cropPts.size === 2) { startCropPinch(); drawCrop(); return; }
    if (cropPts.size > 2) return;
    const v = crop.view, sc = crop.k * v.s, r = crop.rect;
    const X = (x) => x * sc + v.ox, Y = (y) => y * sc + v.oy;
    const corners = { nw: [r.x, r.y], ne: [r.x + r.w, r.y], sw: [r.x, r.y + r.h], se: [r.x + r.w, r.y + r.h] };
    let mode = null, best = HANDLE;
    for (const [name, [x, y]] of Object.entries(corners)) { const d = Math.hypot(p.x - X(x), p.y - Y(y)); if (d < best) { best = d; mode = name; } }
    // 沒放大：拖框內移動框；放大時拖角落以外的地方都是平移照片（框通常蓋滿整張，不然拖不動）
    if (!mode && v.s < 1.01 && p.x > X(r.x) && p.x < X(r.x + r.w) && p.y > Y(r.y) && p.y < Y(r.y + r.h)) mode = 'move';
    if (!mode) mode = 'pan';
    crop.drag = { mode, id: e.pointerId, px: p.x, py: p.y, r0: { ...r }, ox: v.ox, oy: v.oy };
  });
  cropCv.addEventListener('pointermove', (e) => {
    if (!cropPts.has(e.pointerId)) return;
    const p = cropXY(e);
    cropPts.set(e.pointerId, p);
    const d = crop.drag; if (!d) return;
    if (d.mode === 'pinch') {
      if (cropPts.size < 2) return;
      const [a, b] = [...cropPts.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, v = crop.view;
      v.s = Math.min(CROP_ZOOM, Math.max(1, d.s0 * Math.hypot(a.x - b.x, a.y - b.y) / d.d0));
      v.ox = mid.x - d.ix * crop.k * v.s; v.oy = mid.y - d.iy * crop.k * v.s;
      clampCropView(); drawCrop();
      return;
    }
    if (e.pointerId !== d.id) return;
    if (d.mode === 'pan') {
      crop.view.ox = d.ox + p.x - d.px; crop.view.oy = d.oy + p.y - d.py;
      clampCropView(); drawCrop();
      return;
    }
    const sc = crop.k * crop.view.s, W = crop.src.width, H = crop.src.height;
    const dx = (p.x - d.px) / sc, dy = (p.y - d.py) / sc, r0 = d.r0;
    const min = Math.max(W, H) * 0.08;
    let { x, y, w, h } = r0;
    if (d.mode === 'move') {
      x = Math.min(W - w, Math.max(0, r0.x + dx)); y = Math.min(H - h, Math.max(0, r0.y + dy));
    } else {
      let x0 = r0.x, y0 = r0.y, x1 = r0.x + r0.w, y1 = r0.y + r0.h;
      if (d.mode.includes('w')) x0 = Math.min(x1 - min, Math.max(0, x0 + dx));
      if (d.mode.includes('e')) x1 = Math.max(x0 + min, Math.min(W, x1 + dx));
      if (d.mode.includes('n')) y0 = Math.min(y1 - min, Math.max(0, y0 + dy));
      if (d.mode.includes('s')) y1 = Math.max(y0 + min, Math.min(H, y1 + dy));
      x = x0; y = y0; w = x1 - x0; h = y1 - y0;
    }
    crop.rect = { x, y, w, h };
    drawCrop();
  });
  // 放開：兩指剩一指時不接著拖（免得框跳一下），全部放開才結束
  const endCropDrag = (e) => {
    cropPts.delete(e.pointerId);
    if (crop.drag && (crop.drag.mode === 'pinch' || crop.drag.id === e.pointerId)) { crop.drag = null; }
  };
  cropCv.addEventListener('pointerup', endCropDrag);
  cropCv.addEventListener('pointercancel', endCropDrag);
  // 觸控板捏合（瀏覽器當成 Ctrl＋滾輪）或 Ctrl＋滾輪縮放；放大時一般滾輪平移
  cropCv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = cropXY(e);
    if (e.ctrlKey || e.metaKey) zoomCrop(crop.view.s * Math.exp(-e.deltaY * 0.01), p.x, p.y);
    else if (crop.view.s > 1) { crop.view.ox -= e.deltaX; crop.view.oy -= e.deltaY; clampCropView(); drawCrop(); }
  }, { passive: false });
  // 點兩下：放大 2.5 倍／回到整張
  cropCv.addEventListener('dblclick', (e) => { const p = cropXY(e); zoomCrop(crop.view.s > 1.01 ? 1 : 2.5, p.x, p.y); });
  $('cropRotate').onclick = () => {
    const s = crop.src, c = document.createElement('canvas');
    c.width = s.height; c.height = s.width;
    const g = c.getContext('2d'); g.translate(c.width, 0); g.rotate(Math.PI / 2); g.drawImage(s, 0, 0);
    const r = crop.rect;   // 框跟著順時針轉
    crop.rect = { x: s.height - r.y - r.h, y: r.x, w: r.h, h: r.w };
    crop.src = c;
    layoutCrop(true);
  };
  $('cropCancel').onclick = () => history.back();
  $('cropDone').onclick = async () => {
    if (!crop.src) return;   // 已經按過、裁切畫面還在等掃描畫面換上
    const r = crop.rect, c = cropCanvas(crop.src, r);
    crop.src = null;
    // 掃描畫面先出來（照片預覽在背景轉檔，裁切畫面留到換上掃描），畫好了馬上送偵測，等雲端的時候才等定位、做縮圖、存檔：按完成到看到掃描不會停一下
    const photo = URL.createObjectURL(await new Promise(res => photoPreview(c).toBlob(res, 'image/jpeg', AppKit.photo.QUALITY.preview)));
    setWallPhoto(photo); openScan(null); $('crop').hidden = true;
    await new Promise(res => requestAnimationFrame(() => setTimeout(res, 0)));
    const pre = localDetect(c);
    pre.catch(() => {});   // 失敗交給 runDetect 處理（它拿到時才 await）
    const gym = gymNear && await Promise.race([gymNear, new Promise(res => setTimeout(res, 2000, ''))]);   // 定位通常在裁切時就好了；還沒好不讓人等
    gymNear = null;
    const join = addTo; addTo = null;
    if (join) scanAuto = false;   // 增加照片：偵測完不自動進定線
    const g = join ? join.wall.gym : gym, w = newWallRecord(c, g, undefined, uniqueWallName(g, await takenWallNames()));
    scanWall = w;
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', AppKit.photo.QUALITY.crop));
    try { await putNewWall(w, blob); } catch (err) { /* 存不了也先讓人用 */ }
    if (join) await joinGroup(join.wall, w, join.side).catch((err) => { console.warn('增加照片', err); toast(t('saveFailed')); });
    showWall(w, c, { detect: true, photo, pre });
  };

  // ---------- 分析畫面（新增牆面裁切完、重新偵測）：灰階照片＋掃描線，偵測到的岩點由上往下用原本的顏色亮起、數字跳到 N ----------
  // 偵測完就出現下一步（可以定線；新增牆面演完醒來自動進定線）；重描、整理外框在背景做，做完還停在這裡就換上最後的外框。偵測完（或失敗）之前不能關掉
  // scanAuto：新增牆面（裁切完就打開分析畫面）——岩點醒來演完就自動進定線；牆面頁重新偵測、示範牆不自動
  let scanWall = null, scanLit = false, scanPopping = false, scanStale = false, scanT0 = 0, scanAuto = false;
  const SCAN_BLANK = '\u00a0';   // 偵測還沒有數字時留空（不顯示符號），高度才不會跳
  const SCAN_MIN = 500;   // 偵測已經做完（自動裁切時先做了）也掃一下再浮出岩點
  const scanOn = (w) => !$('scan').hidden && scanWall === w;
  function openScan(w) {
    const open = !$('scan').hidden;
    if (!open) scanAuto = !w;   // 新增牆面：照片還沒存成牆就先打開（w 是 null）
    scanWall = w; scanLit = scanPopping = scanStale = false; scanT0 = performance.now();
    $('scan').classList.remove('done', 'fail'); $('scan').hidden = false;
    $('scanClose').hidden = true;
    $('scanN').textContent = SCAN_BLANK;
    $('scanErr').hidden = $('scanActs').hidden = $('scanRetry').hidden = $('scanOk').hidden = true;
    if (!open) $('scanImg').src = w && state.img ? photoPreview(state.img).toDataURL('image/jpeg', AppKit.photo.QUALITY.thumb) : $('wallPhoto').src;   // 新增牆面時掃描畫面已經先開著（底圖是完整照片的預覽）；牆面頁的照片可能還是首頁的縮圖（4:3 置中裁切），跟岩點的座標對不上，重新偵測用完整照片
    HoldCat.stop();
    for (const c of [$('scanCv'), $('scanFx')]) c.getContext('2d').clearRect(0, 0, c.width, c.height);
  }
  function closeScan() { if ($('scan').hidden) return; $('scan').hidden = true; scanWall = null; HoldCat.stop(); }
  // 偵測到的岩點由上往下帶果凍回彈浮出來，接著幾顆岩點醒來（js/holdcat.js）；已經亮過就直接換成目前的外框
  function scanResult(w) {
    if (!scanOn(w)) return false;
    if (scanPopping) { scanStale = true; return true; }   // 岩點還在浮出來：演完再換上新的外框
    $('scan').classList.add('done');
    const img = $('scanImg'), dpr = devicePixelRatio || 1, first = !scanLit;
    for (const c of [$('scanCv'), $('scanFx')]) { c.width = Math.round(img.clientWidth * dpr); c.height = Math.round(img.clientHeight * dpr); }
    scanLit = true; scanPopping = first; scanStale = false;
    HoldCat.reveal({ base: $('scanCv'), fx: $('scanFx'), img: state.img, holds: w.holds, w: state.w, dur: first ? 1500 : 0, onCount: n => { $('scanN').textContent = n; } }).then(r => {
      scanPopping = false;
      if (r.cancelled || !scanOn(w)) return;
      if (scanStale) scanResult(w);
      $('scanActs').hidden = $('scanOk').hidden = $('scanClose').hidden = false;
      const woke = first && !r.instant ? HoldCat.wake({ host: $('scanPic'), rect: { left: 0, top: 0, width: img.clientWidth, height: img.clientHeight }, img: state.img, holds: w.holds, w: state.w, base: $('scanCv'), cast: {} }) : Promise.resolve();
      // 新增牆面：演完自動進定線（還開著別的選單，例如選岩館，就留在這裡，按「定第一條線」）
      if (first && scanAuto && w.holds.length) woke.then(() => { if (scanOn(w) && !scanPopping && !document.querySelector('.sheet-backdrop:not([hidden])')) { closeScan(); startNewRoute(); } });
    });
    return true;
  }
  function scanFail(w, msg) {
    if (!scanOn(w)) return false;
    $('scan').classList.add('fail');
    $('scanErr').textContent = msg; $('scanErr').hidden = $('scanRetry').hidden = $('scanClose').hidden = false;
    return true;
  }
  $('scanClose').onclick = $('scanOk').onclick = closeScan;
  $('scanRoute').onclick = () => { closeScan(); startNewRoute(); };
  $('scanRetry').onclick = () => { if (scanWall) detectHolds(); };
  window.addEventListener('resize', () => { if (!$('crop').hidden) layoutCrop(); });

  async function openWall(id) {
    lsSet(OPENED_KEY, { ...lsGet(OPENED_KEY, {}), [id]: Date.now() });
    let [w, blob] = await Promise.all([getWall(id), getImage(id)]);
    if (!w) return showHome();
    const gone = async () => {   // 雲端也沒有、或照片壞了：打不開，問要不要刪掉（removeWall 在 main.js）
      if (await askConfirm(t('wallNoPhoto'), { ok: t('btnDelete'), danger: true })) await removeWall(w, true);
      return showHome();
    };
    if (!blob) return gone();
    // 之前留下的空路線（沒有任何岩點）清掉
    const empty = w.routes.filter(r => !Object.keys(r.holds).length);
    if (empty.length) {
      w.routes = w.routes.filter(r => Object.keys(r.holds).length);
      for (const r of empty) buryRoute(w, r);
      putWall(w).catch(() => {});
    }
    let canvas;
    try { canvas = await blobToCanvas(blob); } catch (e) { return gone(); }   // 照片讀不出來（例如雲端上那份是壞的）
    showWall(w, canvas, { detect: !w.holds.length });
    readPublic(id);   // 公開牆：讀大家的線（js/sync.js；牆打開了才讀，讀完改的是畫面上這份）
  }

  // 牆面頁的照片預覽（縮到長邊 1400）
  function photoPreview(c) {
    const ps = Math.min(1, 1400 / Math.max(c.width, c.height)), pc = document.createElement('canvas');
    pc.width = Math.round(c.width * ps); pc.height = Math.round(c.height * ps);
    pc.getContext('2d').drawImage(c, 0, 0, pc.width, pc.height);
    return pc;
  }
  // 同一面牆的幾張照片：牆面頁橫幅下照左右排的小圖，點了換到那張（這台沒有的照片不列）
  async function renderGrpStrip(w) {
    const box = $('grpStrip');
    box.hidden = true; box.replaceChildren();
    if (!w.grp) return;
    const ws = (await Promise.all(w.grp.ids.map(id => id === w.id ? w : getWall(id).catch(() => null)))).filter(Boolean);
    if (state.wall !== w || ws.length < 2) return;
    grpMembers = ws; renderOverview();   // 小卡列整組的路線
    box.replaceChildren(...ws.map(x => {
      const b = document.createElement('button'), img = document.createElement('img');
      img.src = x.thumbHi || x.thumb || ''; img.alt = x.name || '';
      b.append(img); b.setAttribute('aria-current', x.id === w.id);
      b.onclick = () => { if (x.id !== w.id) openWall(x.id); };
      return b;
    }));
    box.hidden = false;
  }
  function setWallPhoto(src) {
    const old = $('wallPhoto').src;
    if (old !== src && old.startsWith('blob:')) URL.revokeObjectURL(old);
    $('wallPhoto').src = src;
  }
  function showWall(w, c, { detect, photo, pre }) {   // pre：已經送出的偵測（新增牆面裁完就送了）
    state.wall = w; state.img = c; state.w = c.width; state.h = c.height; state.imgOf = w.m3d || '';
    W3D.show(w);
    loadRelays(w); renderGrpStrip(w);
    $('samProg').hidden = true;
    // photo：剛做好的預覽網址（新增牆面時已經轉好）。沒有的先放首頁卡片的縮圖（同樣 4:3 置中裁），預覽在背景編碼好再換上：
    // 同步編碼要幾十到幾百毫秒，進牆面的轉場會等它
    if (photo) setWallPhoto(photo);
    else {
      setWallPhoto(w.thumbHi || w.thumb || BLANK_IMG);
      photoPreview(c).toBlob(b => { if (b && state.wall === w && state.img === c) setWallPhoto(URL.createObjectURL(b)); }, 'image/jpeg', AppKit.photo.QUALITY.preview);
    }
    if (history.state && history.state.s === 'find') { $('find').hidden = true; history.replaceState({ s: 'home' }, ''); }   // 從找牆面打開：返回回首頁（牆已經在首頁了）
    if (!$('editor').hidden) { /* 照片接力：編輯畫面開著，沿用目前這一層 */ }
    else if (history.state && (history.state.s === 'crop' || history.state.s === 'wall')) history.replaceState({ s: 'wall', id: w.id }, '');
    else history.pushState({ s: 'wall', id: w.id }, '');
    state.selected = null; state.draft = null; state.cursor = null; state.current = null; state.routeId = sortedRoutes()[0]?.id ?? null;
    resetUndo();
    cv.width = state.w; cv.height = state.h;
    state.scene = RouteKit.scene(c, () => w.holds); state.ana = null;
    if (!$('home').hidden) homeScroll = document.scrollingElement.scrollTop;
    $('home').hidden = true; $('wall').hidden = false;
    $('wallName').value = w.name;
    hideToast();
    window.scrollTo(0, 0);
    state.mode = 'route';
    renderOverview();
    if (detect) detectHolds({ pre });
    else if (!w.from && w.untraced && !traceFailed.has(w.id)) resumeTrace();   // 上次重描到一半 App 被關掉：補描剩下的
    else if (!w.from && !wallDetected(w)) detectHolds();   // 上次沒偵測成（例如沒網路），打開就再偵測
  }
  // 分析用的縮圖：只有辨識岩點時才用到，需要時才建（收到的牆資料包都算好了就不用建）
  function ana() { if (!state.ana) buildAnalysis(); return state.ana; }
  function buildAnalysis() { state.ana = HoldKit.analysis(state.img, state.w, state.h); }

  // ---------- 偵測框 → 岩點輪廓（holdkit 的 boxToPoly）----------
  // 每個框各自分辨「岩點」和「牆」，取包含框中央最多的連通區域的凸包；抓不到合理區域時退回框的內切橢圓。
  // 整張的 Lab 第一次用到時算好、存在 state.ana.lab
  function outlineContext(boxes) { return HoldKit.outlineContext(ana(), boxes); }
  function boxToPoly(x0, y0, x1, y1, octx) { return HoldKit.boxToPoly(x0, y0, x1, y1, octx); }

  // 偵測排隊：模型一次只跑一張；正在偵測的牆記在 detectingWall，離開那面牆不會擋到下一面
  let detectChain = Promise.resolve(), detectingWall = null;
  // 這面牆偵測成功過嗎？有偵測出來的岩點也算（收到的牆沒有 w.detected）
  const wallDetected = (w) => !!w.detected || w.holds.some(h => h.source === 'detect' || h.source === 'edited');
  // 這面牆還在算（偵測、重描）：原始岩點檔還沒定
  const computing = (w) => detectingWall === w;
  function detectHolds(opts) {
    const w = state.wall;
    if (!w || detectingWall === w) return;
    detectingWall = w;
    openScan(w);   // 偵測、重描、整理都做完才能編輯：掃描畫面蓋住整個畫面
    detectChain = detectChain.then(() => runDetect(w, opts)).finally(() => {
      if (detectingWall === w) detectingWall = null;
      if (lockHint === w) { lockHint = null; $('samProg').hidden = true; }
    });
  }
  // 兩個框重疊的比例（交集／聯集）
  const boxIoU = (a, b) => {
    const iw = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), ih = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
    if (iw <= 0 || ih <= 0) return 0;
    const i = iw * ih; return i / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i);
  };
  // 岩點偵測（holdscan，AGPL-3.0）：在手機上偵測（holdscan/browser/，第一次下載模型約 12 MB，之後瀏覽器快取；照片不離開手機），回傳照片座標的框。
  const RETRACE_URL = SITE.cloud?.retrace || '';   // holdkit 的整面牆重描（index.html 設定給 HoldRefiner）
  // 雲端加速（重描）：不用登入，只帶 App Check 權杖，伺服器按網路來源每天限 30 次（一間岩館一天 30 次）
  const cloudAppCheck = async (forceRefresh = false) => (Backend.appCheckToken ? Backend.appCheckToken(forceRefresh) : '');
  // 選了照片就先準備偵測：手機上偵測先下載、載入模型；重描的雲端執行個體也先開機（偵測、重描連模型一起載入）。
  // 使用者裁切的這幾秒蓋過下載和冷啟動。GET 不帶照片、不算偵測次數，回什麼都不用管（no-cors）
  function warmDetect() {
    warmLocalDetect();
    if (navigator.onLine === false) return;
    if (RETRACE_URL) fetch(RETRACE_URL, { mode: 'no-cors' }).catch(() => {});
  }
  const loadHoldScan = () => ShareTools.loadScript('../holdscan/browser/holdscan.js');
  // ---------- 大檔下載：頁面負責，存進跟 Service Worker 共用的模型快取 ----------
  // 快取名稱同 hold/sw.js 的 MODELS（'hold-models' 加版本號結尾的 -hk<holdkit 版本>）；Service Worker 只讀、命中就給（離線也一樣），
  // 所以第一次造訪（還沒被 Service Worker 控制）、不支援 Service Worker、本機開發都照樣下載並存起來，不會下載兩次。
  // 順序：偵測模型（含偵測用的 onnxruntime）→ 重描的解碼器（warmRefiner），不並行搶頻寬；只存完整下載完的檔案；存之前先看有沒有（快取被清掉就自動重新下載）
  const MODELS_CACHE = 'hold-models' + ((((document.querySelector('meta[name="app-version"]') || {}).content) || '').match(/-hk[^-]+$/) || [''])[0];
  let downloadTail = Promise.resolve();
  const detectModelJob = {};   // 下載中或已完成的偵測模型（失敗就清掉，下次重試）
  const modelProgress = (pct) => detStatus('detDownload', pct);
  // size：解壓後的大小（約略）。主網壓縮傳輸（br），收到的是解壓後的位元組，標頭的長度對不上，進度改用它算
  async function downloadToCache(url, { integrity, onProgress, size = 0 } = {}) {
    const cache = self.caches ? await caches.open(MODELS_CACHE).catch(() => null) : null;
    if (!cache || await cache.match(url).catch(() => null)) return;   // 沒有 Cache API：交給 Worker 自己下載
    const res = await fetch(url, { priority: 'low', ...(integrity ? { integrity } : {}) });   // 低優先：背景預先下載時不跟照片、路線搶頻寬
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    const total = res.headers.get('content-encoding') ? 0 : +res.headers.get('content-length') || 0, rd = res.body.getReader(), parts = [];   // 壓縮傳輸的檔案長度跟收到的不同：不比長度
    const of = total || size;
    let got = 0;
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      parts.push(value); got += value.length;
      if (onProgress && of) onProgress(Math.min(99, Math.floor(got * 100 / of)));
    }
    if (total && got !== total) throw new Error(`incomplete ${url}`);
    await cache.put(url, new Response(new Blob(parts), { headers: { 'Content-Type': res.headers.get('content-type') || 'application/octet-stream' } })).catch(() => {});
  }
  // 偵測模型和它的 onnxruntime（holdkit/ort.js 的 ortFiles）下載好才算準備好；同時只有一個，失敗可再呼叫重試
  function detectModelReady() {
    if (!detectModelJob.p) {
      const run = async () => {
        await loadHoldScan();
        HoldScan.configure({ cache: MODELS_CACHE });   // Worker 先讀這個快取
        await downloadToCache(new URL('../holdscan/models/freeclimbs.onnx', location.href).href, { onProgress: modelProgress, size: 12.4e6 });
        modelProgress(100);   // 下載完：數字位置收掉百分比
        await ShareTools.loadScript('../holdkit/ort.js');
        for (const [url, integrity] of ortFiles()) await downloadToCache(url, { integrity });
      };
      detectModelJob.p = (downloadTail = downloadTail.then(run));
      downloadTail = downloadTail.catch(() => {});
      detectModelJob.p.catch(() => { detectModelJob.p = null; });
    }
    return detectModelJob.p;
  }
  // 新增牆面時載入偵測模型（下載是打開 App 就在背景做的 prefetchModels，還沒好就接著同一個下載）
  const warmLocalDetect = () => detectModelReady().catch(() => {}).then(() => window.HoldScan?.warm()).catch(() => {});   // 背景下載失敗不打斷操作；腳本已載入時仍讓 Worker 重試，錯誤留到實際偵測時回報
  // 重描的解碼器（16.5 MB）排在偵測模型之後；沒網路、偵測失敗也照樣叫醒（用到時再重試）
  // 重描的解碼器（16.5 MB）、編碼器（28 MB，雲端不能用時在這台分析照片）排在偵測模型之後；同時只有一個，失敗可再呼叫重試
  const refinerModelJob = {};
  function refinerModelsReady() {
    if (!refinerModelJob.p) {
      const run = async () => {
        await downloadToCache(new URL('../holdkit/models/mobilesam-decoder.onnx', location.href).href);
        await downloadToCache(new URL('../holdkit/models/mobilesam-encoder.onnx', location.href).href);
      };
      refinerModelJob.p = (downloadTail = downloadTail.then(run));
      downloadTail = downloadTail.catch(() => {});
      refinerModelJob.p.catch(() => { refinerModelJob.p = null; });
    }
    return refinerModelJob.p;
  }
  // 打開 App 就在背景預先下載全部模型（js/main.js）：只存進快取，不載入（不佔看線、定線的 CPU 和記憶體）；省流量模式不下載
  function prefetchModels() {
    if (navigator.connection?.saveData || navigator.onLine === false) return;
    detectModelReady().catch(() => {});
    if (window.HoldRefiner) refinerModelsReady().catch(() => {});
  }
  // 新增牆面、進入定線時才載入重描的模型（還在下載就接著同一個下載）
  const warmRefiner = () => { if (window.HoldRefiner) detectModelReady().catch(() => {}).then(() => refinerModelsReady().catch(() => {})).then(() => HoldRefiner.warm()); };
  async function localDetect(src) {
    await detectModelReady().catch(e => { if (!window.HoldScan) throw e; });   // 腳本沒載入就回報原始下載錯誤；只有模型下載失敗時交給 Worker 重試
    detStatus('detFinding');
    try { return await HoldScan.detect(src); }
    catch (e) { throw e.download ? Object.assign(new Error(t('detDownloadFail')), { offline: navigator.onLine === false }) : e; }
  }
  // 偵測的進度：模型還在下載時，掃描畫面的數字位置顯示下載百分比（單位換成「下載偵測模型」），開始偵測就換回岩點數
  function detStatus(key, pct) {
    const down = key === 'detDownload' && pct > 0 && pct < 100 && !$('scan').hidden && !$('scan').classList.contains('done');
    $('scanUnit').textContent = t(down ? 'detDownload' : 'holdsUnit');
    if (down) $('scanN').textContent = pct + '%'; else if ($('scanN').textContent.endsWith('%')) $('scanN').textContent = SCAN_BLANK;
  }
  // opts.pre：已經送出的偵測
  // 偵測（holdscan）→ 依顏色描的外框在掃描畫面亮起，可以開始定線 → 背景整面牆重描，換上最後的外框。
  // 背景還在算時（computing）不能改岩點（長按提示還在描）；路線用到的岩點外框跟著換（路線自帶外框還是計算結果的會跟著更新）。
  // 重描失敗就留著顏色描的外框（提示原因）
  async function runDetect(w, opts = {}) {
    if (state.wall !== w) return;   // 排隊時已經離開這面牆
    const img = state.img;
    try {
      const r = await (opts.pre || localDetect(img));
      if (state.wall !== w) return;   // 偵測途中離開了這面牆
      // 保留手動加的岩點與路線用到的岩點；偵測結果中心落在保留岩點內的略過
      const used = new Set(w.routes.flatMap(rt => Object.keys(rt.holds)));
      const kept = w.holds.filter(h => used.has(h.id) || h.source !== 'detect');
      const octx = outlineContext(r.boxes);
      const fresh = [];
      for (const [x0, y0, x1, y1] of r.boxes) {
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        if (kept.some(h => inPoly(cx, cy, h.poly))) continue;
        const h = touch({ id: uid('h'), poly: simplifyPoly(boxToPoly(x0, y0, x1, y1, octx)), source: 'detect' });
        fresh.push({ h, box: [x0, y0, x1, y1] });
      }
      w.holds = kept.concat(fresh.map(f => f.h));
      w.base = { holds: [] }; w.baseLocal = 1;   // 原始岩點檔換成這次的結果（在這台算的，算完由這台上傳）
      w.untraced = Object.fromEntries(fresh.map(({ h, box }) => [h.id, box]));
      save();
      if (scanOn(w)) await pause(SCAN_MIN - (performance.now() - scanT0));
      if (!scanResult(w)) toast(t('found', fresh.length));
      refreshUi(); render();
      await finishDetect(w, img);
    } catch (e) {
      // 沒網路：只說需要網路（不加「偵測失敗：」），網路回來時自動再偵測一次（見下面的 online）
      const offline = (e && e.offline) || navigator.onLine === false;
      const msg = offline ? t('detOffline') : e && e.quota ? e.message : t('detectFailed') + (e && e.message ? e.message : e);
      detectOffline = offline ? w : null;
      if (state.wall === w && !scanFail(w, msg)) toast(msg);
    }
  }
  // 因為沒網路沒偵測成的牆：網路回來時還開著這面牆（或停在分析畫面）就自動重新偵測
  let detectOffline = null;
  addEventListener('online', () => {
    const w = detectOffline; detectOffline = null;
    if (!w || state.wall !== w || wallDetected(w)) return;
    detectHolds();
  });

  // 偵測之後的整面牆重描。w.untraced：{ 岩點 id: 偵測框 }，還沒重描的岩點（每批描好就刪掉、存檔），
  // App 在中途被關掉的話，下次打開牆面只補描剩下的（resumeTrace）
  const traceFailed = new Set();   // 這次開著 App 時雲端重描失敗過的牆：打開時不再補描（重開 App 才再試）
  async function finishDetect(w, img) {
    const byId = new Map(w.holds.map(h => [h.id, h]));
    const items = Object.entries(w.untraced || {}).filter(([id]) => byId.get(id)?.source === 'detect').map(([id, box]) => ({ id, poly: byId.get(id).poly, box }));
    let traceErr = null;
    if (items.length) await traceHolds(w, img, items).catch(e => { traceErr = e; });
    if (traceErr) traceFailed.add(w.id); else { delete w.untraced; traceFailed.delete(w.id); }   // 雲端失敗就留著依顏色描的外框，下次開 App 打開這面牆再試雲端；描過、改過的不重描
    w.detected = 1;   // 偵測成功過：之後選單不再顯示「重新偵測」
    if (state.wall !== w) { putWall(w).catch(() => {}); return; }
    // 雲端失敗：不在手機上一顆顆描整面牆（幾百顆要幾分鐘），只在背景分析一次照片，之後按「重描」只要解碼（約 0.6 秒）
    if (traceErr) HoldRefiner.hasEmb(w.id).then(has => has || HoldRefiner.traceWall(img, w.id, [])).catch(() => { /* 按「重描」時再分析 */ });
    save();
    scanResult(w);
    if (traceErr) toast(t('refineFailed') + (traceErr.message || traceErr));
    refreshUi(); render();
  }
  // 打開牆面時接著補描（不蓋掃描畫面；補完之前跟偵測中一樣不能改岩點）
  function resumeTrace() {
    const w = state.wall, img = state.img;
    if (!w || detectingWall === w) return;
    detectingWall = w;
    detectChain = detectChain.then(() => state.wall === w && finishDetect(w, img)).catch(() => {}).finally(() => {
      if (detectingWall === w) detectingWall = null;
      if (lockHint === w) { lockHint = null; $('samProg').hidden = true; }
    });
  }

  // ---------- 整面牆重描輪廓（holdkit 的 HoldRefiner）：照片和這些岩點送雲端（retrace），換上 MobileSAM 描的外框 ----------
  // 照片特徵跟著存在這台（每面牆一份），之後長按改外框只在手機上解碼。items：[{ id, poly, box }]（box＝偵測框）
  // 送出後外框改過的不換
  // 外框一批一批回來，每批馬上換上（分析畫面、牆面頁跟著重畫）
  async function traceHolds(w, img, items) {
    const sent = new Map(items.map(i => [i.id, JSON.stringify(i.poly)]));
    const byId = new Map(w.holds.map(h => [h.id, h]));
    const size = ({ box: [x0, y0, x1, y1] }) => (x1 - x0) * (y1 - y0);   // 大的先描：大岩點、volume 依顏色描的外框最常不對
    await HoldRefiner.traceWall(img, w.id, items.slice().sort((a, b) => size(b) - size(a)), undefined, { localFallback: false, onHolds: (part) => {
      for (const { id, poly } of part) {
        const h = byId.get(id);
        if (h && poly && poly.length >= 3 && h.source === 'detect' && JSON.stringify(h.poly) === sent.get(id)) h.poly = simplifyPoly(poly);
        if (w.untraced) delete w.untraced[id];
      }
      putWall(w).catch(() => {});   // 描到哪存到哪：中途關掉 App，下次只補剩下的
      if (state.wall !== w) return;
      touchGeom(); scanResult(w); render();
    } });
  }
