// Studio Wall：精修 Climbio Studio 牆面專案的岩點外框。HoldScan + HoldKit 的偵測外框（快、粗），編輯器（editor.js）用 HoldKit 新增、重描，手畫、平滑、合併、裁切；
// 電腦版另可整面用 SAM2（WebGPU 或 WASM，第一次下載約 300 MB）重描，跟原外框不同的列進待確認，由人選。打開同一個專案資料夾（store.js 的專案），改好的岩點存回去；路線引用的岩點 id 不變。
// 網址：#<專案 id> 看這個專案的牆、#<專案 id>/<牆 id> 直接打開那面牆。
'use strict';
const $ = id => document.getElementById(id);
const T = AppKit.i18n.t;
AppKit.i18n.apply();   // index.html 的 data-i18n
const S = RefineStore, SS = StudioStore, E = RefineEditor;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
let view = '';   // 目前的畫面：start、gate、walls（牆面）、review（岩點）、checks（檢查）、pubs（發佈）
const show = id => { view = id; document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === id)); renderSteps(); };
const holdId = () => 'h' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
let P = null, cur = null;   // 目前的專案、正在精修的牆 { w }
const busy = new Map();    // 牆 id → 進度文字（SAM2 重描中）
const thumbs = new Map();

const centerIn = (b, c) => { const x = (b[0] + b[2]) / 2, y = (b[1] + b[3]) / 2; return !c || (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h); };
const polyBox = p => { const xs = p.map(q => q[0]), ys = p.map(q => q[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
// 要看的：有旗標，或 SAM2 重描跟原外框不同、還沒決定的
const needLook = h => !!(h.flags && h.flags.length) || !!(h.sam && !h.sam.pick);
function counts(w, d) { const hs = d.holds.filter(h => centerIn(polyBox(h.poly), w.crop)); w.n = hs.length; w.look = hs.filter(needLook).length; }
const openErr = e => e.name === 'NotFoundError' ? T('hlOpenNotFound') : e.name === 'NotAllowedError' || e.name === 'SecurityError' ? T('hlOpenDenied') : e.message;
const toast = t => { AppKit.ui.toast(t, { ms: 5000 }); console.warn(t); };

// ---- 打開專案 ----
function gate(text, run) {
  $('gateBtn').textContent = text; $('gateMsg').textContent = ''; show('gate');
  $('gateBtn').onclick = () => run().catch(e => { $('gateMsg').textContent = openErr(e); });
}
// 固定連結 #p=<公開牆的包 id>：不選資料夾，從開放資料集把這面公開牆（照片、岩點）收進瀏覽器的專案接著精修，發佈就是同一個包的新版本。
// 同一個包只收一次（專案 id 記在 localStorage），再開直接回到上次改到的地方
const PUB_BASE = /^http:\/\/(127\.0\.0\.1|localhost)/.test(location.origin) ? 'https://climbio.app' : location.origin;
async function openPublic(id) {
  show('gate'); $('gateBtn').hidden = true; $('gateMsg').textContent = T('hlPubLoading');
  const key = `climbio.wallpub.${id}`;
  try {
    let known = ''; try { known = localStorage.getItem(key) || ''; } catch (e) { /* 沒有儲存空間：每次重收 */ }
    const r = known && await SS.entry(known).catch(() => null);
    if (r && r.ws === 'gym' && await SS.granted(r)) { await openProject(await S.reopen(r)); const w = P.walls.find(x => x.pack && x.pack.project === id); if (w) await openWall(w); return; }
    await shareLibs();
    const base = `${PUB_BASE}/p/${id}/`, set = await (await fetch(`${base}index.json`)).json();
    const item = (set.items || [])[0];
    if (!item || set.type !== 'walls') throw new Error(T('hlPubNotWall'));
    const got = await ShareTools.fetchWall(new URL(item.href, base).href, item.id);
    const all = got.base.holds || [], live = all.filter(h => !h.retired);
    const gym = got.gym || set.name || T('hlZoneWall');
    const proj = await S.createLocal(got.base.name || set.name || T('hlUnnamed'));
    const w = await proj.addDone(got.photo, { name: got.base.name || set.name || T('hlUnnamed'), holds: live }, proj.zoneNamed(gym));
    w.pack = { project: set.id, layer: item.href.replace(/\.json$/, ''), pid: item.id, gym, attribution: got.attribution || set.attribution || '' };
    const d = await proj.data(w.id); d.published = Object.fromEntries(all.map(h => [h.id, h.poly])); d.dirty = true;   // 公開時的外框：之後刪掉的岩點用它停用
    proj.touch(w, { ms: 0 }); w.pubT = w.t; await proj.flush();   // 剛收進來的牆跟公開版一樣：沒改過就不算「有更新」
    try { localStorage.setItem(key, proj.id); } catch (e) { /* 同上 */ }
    await openProject(proj); await openWall(w);
  } catch (e) { console.error(e); $('gateMsg').textContent = openErr(e); }
}
async function boot() {
  const pub = /^#p=([0-9a-z]{16})$/.exec(location.hash);
  if (pub) return openPublic(pub[1]);
  const rep = /^#r=([0-9a-z]{16})$/.exec(location.hash);
  if (rep) return openPublicReport(rep[1]);
  const inb = /^#inbox=(.+)$/.exec(location.hash);
  if (inb) return takeInbox(inb[1]);
  const [pid, wid] = decodeURIComponent(location.hash.slice(1)).split('/');
  if (!pid) { show('start'); StudioLibrary.render($('start'), { line: 'gym', open: (r) => StudioLibrary.openRecent(r, toast) }); return; }
  try {
    const r = await SS.entry(pid);
    if (!r || r.ws !== 'gym') { location.replace('../'); return; }
    const go = async () => { await openProject(await S.reopen(r)); if (wid && P.wall(wid)) await openWall(P.wall(wid)); };
    if (await SS.granted(r)) await go(); else gate(T('hlOpenProject', r.name), go);
  } catch (e) { console.error(e); gate(T('hlGoHome'), async () => { location.href = '../'; }); $('gateMsg').textContent = openErr(e); }
}
async function openProject(p) {
  P = p; $('pName').textContent = p.meta.name;
  P.onSaved = e => { $('saveState').textContent = e ? T('hlSaveFail', e.message) : T('hlSaved'); };
  document.title = `${p.meta.name} · Studio Wall · Climbio Studio`;
  renderWalls(); show('walls');
}

// ---- 步驟列：牆面 → 岩點 → 檢查 → 報告 → 發佈（跟 Crag 同一種；頂列沒有返回，工作區各自獨立）----
const doneWalls = () => P ? P.walls.filter(w => w.status === 'done') : [];
function renderSteps() {
  $('steps').hidden = !P;
  if (!P) return;
  const ws = doneWalls(), look = ws.reduce((n, w) => n + (w.look || 0), 0), on = view === 'review' ? 'holds' : view === 'pubs' ? 'publish' : view === 'checks' ? 'check' : view === 'report' ? 'report' : 'walls';
  StudioShell.steps($('steps'), [
    { id: 'walls', label: T('hlStepWalls'), note: ws.length ? T('hlNWalls', ws.length) : '' },
    { id: 'holds', label: T('hlStepHolds'), note: look ? T('hlLookN', look) : '' },
    { id: 'check' },
    { id: 'report', label: T('hlStepReport') },
    { id: 'publish', label: T('hlStepPublish') },
  ].map(x => ({ ...x, on: x.id === on })), goStep);
}
async function goStep(id) {
  if (!P) return;
  if (id === 'holds') {   // 還在編輯就留著；否則打開要看的第一面（都沒有就第一面）
    if (view === 'review') return;
    const ws = doneWalls(), w = ws.find(x => x.look) || ws[0];
    if (!w) { toast(T('hlNoWalls')); return; }
    await openWall(w); return;
  }
  if (E.active) await E.close();
  cur = null;
  if (id === 'publish') { renderPubs(); show('pubs'); location.hash = P.id; return; }
  if (id === 'check') { renderChecks(); show('checks'); location.hash = P.id; return; }
  if (id === 'report') { show('report'); location.hash = P.id; renderReport(); return; }
  renderWalls(); show('walls'); location.hash = P.id;
}
document.querySelector('#top .st-brand').onclick = async e => { e.preventDefault(); if (E.active) await E.close(); if (P) await P.flush().catch(() => {}); location.href = '../'; };

// ---- 牆的清單：岩館 → 分區 → 牆 ----
function stateText(w) {
  if (busy.has(w.id)) return busy.get(w.id);
  if (w.status !== 'done') return w.status === 'failed' ? T('hlWallFailed', w.err) : T('hlNotDone');
  return w.look ? T('hlLookOf', w.look, w.n) : T('hlHoldsN', w.n);
}
async function setThumb(w, pic) {
  if (!thumbs.has(w.id)) { const f = await P.thumb(w); if (!f) return; thumbs.set(w.id, URL.createObjectURL(f)); }
  pic.style.backgroundImage = `url("${thumbs.get(w.id)}")`;
  const c = w.crop;
  if (c) Object.assign(pic.style, { backgroundSize: `${w.w / c.w * 100}% auto`, backgroundPosition: `${c.w < w.w ? c.x / (w.w - c.w) * 100 : 0}% ${c.h < w.h ? c.y / (w.h - c.h) * 100 : 0}%` });
}
function card(w) {
  const c = el('div', 'card'), pic = el('div', 'pic'), meta = el('div', 'meta');
  c.dataset.id = w.id;
  meta.append(el('div', 'nm', w.name), el('div', 'st' + (w.look ? ' look' : ''), stateText(w)));
  const sam = el('button', 'x', T('hlSamBtn')); sam.onclick = e => { e.stopPropagation(); refineWall(w); }; sam.setAttribute('aria-label', T('hlSamWall'));
  c.append(pic, meta, sam);
  setThumb(w, pic);
  c.onclick = () => openWall(w);
  return c;
}
function renderWalls() {
  if (!P) return;
  const box = $('walls'); box.replaceChildren();
  // 工具列跟 Crag 路線清單同一種（膠囊、圖示鈕）；加入資料＝加牆面照片
  const bar = el('div', 'tbar list-bar'), add = el('button', 'tbtn');
  bar.setAttribute('role', 'toolbar');
  add.id = 'wAdd'; add.title = add.ariaLabel = T('hlAddWall');
  add.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';
  add.onclick = () => $('addFiles').click();
  bar.append(add); box.append(bar);
  for (const g of P.gyms) {
    const zs = P.zones.filter(z => z.gym === g.id);
    if (!zs.length) continue;
    const sec = el('section', 'gym'), gh = el('div', 'ghead');
    gh.append(el('b', '', g.name)); sec.append(gh);
    for (const z of zs) {
      const ws = P.walls.filter(w => w.zone === z.id && w.status === 'done');
      if (!ws.length) continue;
      const zs2 = el('div', 'zone'), head = el('div', 'zhead'), cards = el('div', 'cards');
      head.append(el('b', '', z.name)); cards.append(...ws.map(card)); zs2.append(head, cards); sec.append(zs2);
    }
    box.append(sec);
  }
  if (box.children.length === 1) {   // 還沒有牆：主畫面只有加照片（跟空的 Crag 一樣）
    const start = el('button', 'btn primary', T('hlAddWall')); start.onclick = () => $('addFiles').click();
    box.append(el('div', 'start', start));
  }
}
function updateCard(w) { const c = $('walls').querySelector(`.card[data-id="${w.id}"]`); if (!c) return; c.querySelector('.st').textContent = stateText(w); c.querySelector('.st').className = 'st' + (w.look ? ' look' : ''); }

// ---- 獨立入口：一張照片，HoldScan 偵測 + HoldKit 外框，直接進編輯器檢查、修正偵測 ----
const bboxOf = p => { const xs = p.map(q => q[0]), ys = p.map(q => q[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
// 偵測框 → 岩點外框（HoldKit：每個框各自分辨岩點和牆，取包含框中央最多的連通區域的凸包，抓不到合理區域退回內切橢圓）
function addOutlines(w, d, canvas) {
  const octx = HoldKit.outlineContext(HoldKit.analysis(canvas, w.w, w.h), d.boxes);
  d.boxes.forEach(([x0, y0, x1, y1], i) => {
    const poly = HoldKit.simplifyPoly(HoldKit.boxToPoly(x0, y0, x1, y1, octx));
    if (poly && poly.length >= 3) { const h = { id: holdId(), poly, source: 'detect', flags: [], b: i }; d.holds.push(h); noteBase(d, h); }
  });
}
// 自動結果留一份（record.js 的研究記錄拿它跟最後結果比）；人改過的岩點不更新，所以只記自動的最新結果
const noteBase = (d, h) => { (d.base || (d.base = {}))[h.id] = { poly: h.poly, flags: [...(h.flags || [])] }; };
// ---- 分享用的程式庫（公開格式、岩點貓分享包）：匯出、發佈時才載入 ----
const loadScript = src => new Promise((res, rej) => { const e = Object.assign(document.createElement('script'), { src }); e.onload = res; e.onerror = () => rej(new Error(T('hlLibFail'))); document.head.append(e); });
let libP = null;
const shareLibs = () => libP || (libP = (async () => { for (const f of ['../../format/format.js', '../../routekit/format.js', '../../appkit/share-tools.js']) await loadScript(f); })().catch(e => { libP = null; throw e; }));

// Studio 首頁「加資料」交過來的照片（StudioStore 的收件匣）：{ name, items: [{ dir: 分組名稱, file }] }，分組變成分區
async function takeInbox(key) {
  const rec = await SS.inbox.take(key);
  history.replaceState(null, '', location.pathname);
  if (!rec?.items?.length) { show('start'); return; }
  await addPhotos(rec.items.map(i => i.file), { name: rec.name, zoneOf: new Map(rec.items.map(i => [i.file, i.dir])) });
  if (!P) { show('start'); return; }   // 沒加成功（訊息已經跳出）：回到空白的開始畫面
  if (!location.hash) history.replaceState(null, '', `#${P.id}`);   // 重新整理還在這個專案
}
// 加牆面照片：沒有專案就先建一個（name：專案名稱；zoneOf：照片 → 分區名稱）；每張照片 HoldScan 偵測加 HoldKit 外框，偵測不到岩點的牆留空白（在岩點步驟用 SAM2 或手畫補）
async function addPhotos(files, { name = '', zoneOf = null } = {}) {
  const list = [...files].filter(f => f && S.IMG_RE.test(f.name));
  if (!list.length) { toast(T('hlPickImage')); return; }
  const b = StudioShell.busy(T('hlAddingTitle'));
  let p = P, last = null, empty = 0;
  try {
    p = p || await S.createLocal(name || list[0].name.replace(/\.[^.]+$/, ''));
    const first = () => p.zones[0] || p.addZone(T('hlZoneWall'));
    for (const [i, f] of list.entries()) {
      b.step(T('hlAddingPhoto'), i + 1, list.length);
      const zn = zoneOf?.get(f), zone = zn ? p.zoneNamed(zn) : first();
      const w = await p.addBlank(f, zone);
      b.step(T('hlDetecting'), i + 1, list.length);
      const c = await photoCanvas(p, w), { boxes } = await HoldScan.detect(c), d = await p.data(w.id);
      // 偵測到的岩點在過場上亮起來（最後一張等它亮完再關）
      const shown = b.show(c, boxes.map(([x0, y0, x1, y1]) => [(x0 + x1) / 2, (y0 + y1) / 2]));
      if (boxes.length) { d.boxes = boxes; addOutlines(w, d, c); counts(w, d); } else empty++;
      p.touch(w, { ms: 0 }); last = w;
      if (i === list.length - 1) await shown;
    }
    await p.flush();
  } catch (e) { console.error(e); toast(openErr(e)); }
  finally { b.close(); }
  if (!p || !last) return;
  if (!P) await openProject(p); else { renderWalls(); renderSteps(); }
  if (empty) toast(T('hlNoHolds'));
  if (list.length === 1) await openWall(last);
}
// 還沒有專案：新的一律從 Studio 的「加資料」進（照片照內容交給岩館、岩場）
$('addFiles').onchange = e => { const f = [...e.target.files]; e.target.value = ''; addPhotos(f); };

// ---- 精修一面牆 ----
async function photoCanvas(p, w) {
  const bmp = await createImageBitmap(await p.photo(w)), c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0); bmp.close(); return c;
}
function editorOpts(w, d, img) {
  return {
    photo: img, holds: d.holds, crop: w.crop, name: w.name, boxes: d.holds.length ? [] : (d.boxes || []),
    onSave: async holds => { d.holds = holds.map(({ score, ...h }) => h); counts(w, d); P.touch(w); updateCard(w); renderSteps(); return w.look ? T('hlSavedLook', w.look) : T('hlSaved'); },
    onCrop: crop => { w.crop = crop; w.cropSet = true; counts(w, d); P.touch(w); updateCard(w); },
  };
}
async function openWall(w) {
  if (E.active) await E.close();
  cur = { w }; show('review'); wallState(); location.hash = `${P.id}/${w.id}`;
  const d = await P.data(w.id), img = await photoCanvas(P, w);
  if (!cur || cur.w !== w) return;
  await E.open(editorOpts(w, d, img));
}
function wallState() {
  if (!cur) return;
  const z = P.zone(cur.w.zone); $('wallName').textContent = `${z ? z.name : ''}／${cur.w.name}`;
  $('reviewed').classList.toggle('on', !!cur.w.reviewed); $('reviewed').classList.toggle('primary', !cur.w.reviewed && !cur.w.look); $('reviewed').textContent = cur.w.reviewed ? T('hlReviewedOn') : T('hlReviewedOff');
}
// 人逐顆看完這面牆：沒有這個標記，沒被改的岩點只能算「沒看過」，不能當正確答案
$('reviewed').onclick = () => { if (!cur) return; cur.w.reviewed = cur.w.reviewed ? 0 : Date.now(); P.touch(cur.w, { ms: 0 }); wallState(); };
function stepWall(dir) {
  if (!cur) return;
  const list = P.walls.filter(w => w.status === 'done'), i = list.indexOf(cur.w);
  if (list.length > 1) openWall(list[(i + dir + list.length) % list.length]);
}
$('prevWall').onclick = () => stepWall(-1);
$('nextWall').onclick = () => stepWall(1);
addEventListener('keydown', e => { if (!E.active || /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return; if (e.key === '[') stepWall(-1); else if (e.key === ']') stepWall(1); });
addEventListener('beforeunload', e => { if (P && P.timers.size) { P.flush(); e.preventDefault(); } });

// ---- 公開：一面精修好的牆（照片、岩點、研究記錄）經雲端函式 datasets 寫進開放資料集 climbio/walls（Hugging Face，誰都能免登入讀）；公開後不能收回 ----
const TOOLS = () => ({ holdkit: HoldKit.VERSION, detector: 'holdscan', sam: 'sam2.1-hiera-base-plus' });
const DATASET_URL = 'https://huggingface.co/datasets/climbio/walls/tree/main/walls/';
const enc = o => new TextEncoder().encode(JSON.stringify(o));
// 研究記錄（只算裁切範圍裡的岩點）：發佈時寫進 <牆 id>.edits.json，報告也從它算
function recordOf(w, d) {
  const inCrop = h => centerIn(polyBox(h.poly), w.crop), holds = d.holds.filter(inCrop), base = Object.fromEntries(Object.entries(d.base || {}).filter(([, b]) => inCrop(b)));
  const record = RefineRecord.buildRecord({ id: w.id, sha256: w.sha, license: P.meta.license, reviewed: w.reviewed, tools: TOOLS(), base, holds, w: w.w, h: w.h });
  return { record, holds };
}
// 新的牆：照片、畫面、研究記錄
async function wallJob(w, d) {
  const { record } = recordOf(w, d);
  const z = P.zones.find(x => x.id === w.zone), gym = ((z && P.gym(z.gym)) || P.gyms[0] || { name: P.meta.name }).name;   // 公開牆一定有岩館名稱（分區所屬的那間）
  return { id: w.id, gym, files: [
    { path: `${w.id}.jpg`, bytes: new Uint8Array(await (await P.photo(w)).arrayBuffer()) },
    { path: `${w.id}.json`, bytes: enc(P.view(w, d)) },
    ...(record ? [{ path: `${w.id}.edits.json`, bytes: enc(record) }] : []),
  ] };
}
// 公開過、現在被刪掉或合併掉的岩點：停用（retired），照公開時的外框留在畫面裡，別人的舊路線還指得到；新路線看不到它們
const retiredOf = d => { const now = new Set(d.holds.map(h => h.id)); return Object.entries(d.published || {}).filter(([id]) => !now.has(id)).map(([id, poly]) => ({ id, poly, retired: true })); };
// 岩點貓公開的牆：照岩點貓的分享包格式（同一個包 id、同樣的檔名），所以發佈就是這面牆的新版本；整面都發，岩點貓沒有裁切
async function packJob(w, d) {
  await shareLibs();
  const k = w.pack, thumb = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; P.thumb(w).then(b => r.readAsDataURL(b), rej); });
  const files = await ShareTools.wallPackage({ id: k.project, layerId: k.layer, pid: k.pid, name: w.name, gym: k.gym, w: w.w, h: w.h, thumb, holds: [...d.holds, ...retiredOf(d)], routes: [], photo: await P.photo(w), attribution: k.attribution, version: 0, t: Date.now() });
  return { id: k.project, gym: k.gym, files };
}
let pubUI = null, pubOk = null, pubClaim = null, pubW = null;   // pubW：正在發佈的牆
async function publishUi() {
  if (pubUI) return pubUI;
  const [{ createPublishUI }, pub] = await Promise.all([import('../publish-ui.js'), import('../publisher.js')]);
  pubOk = Object.assign(document.createElement('input'), { type: 'checkbox' });
  pubClaim = Object.assign(document.createElement('label'), { className: 'check' });
  pubClaim.append(pubOk, T('hlPubClaim'));
  pubUI = createPublishUI({
    title: T('hlPubTitle'), visibility: false, after: [pubClaim],
    onCopy: () => { $('saveState').textContent = T('hlCopiedUrl'); },
    async onGo() {
      const w = pubW;
      if (!w.pack && !pubOk.checked) throw new Error(T('hlPubNeedClaim'));   // 已公開的牆（精修）早就聲明過，不再問
      await P.flush();        // 公開的是存好的岩點
      const d = await P.data(w.id), job = w.pack ? await packJob(w, d) : await wallJob(w, d);
      pubUI.run.open({ name: w.name, tiles: [], cover: false });
      let res;
      try { pubUI.run.step(T('hlPubUploading')); res = await pub.publishWall({ id: job.id, name: w.name, gym: job.gym, files: job.files }); }
      finally { pubUI.run.close(); }
      w.pubv = res.version; if (w.pack) d.published = { ...d.published, ...Object.fromEntries(d.holds.map(h => [h.id, h.poly])) };   // 發佈出去的外框，之後刪掉的岩點用它停用
      P.touch(w, { ms: 0 }); w.pubT = w.t; renderPubs();   // 發佈後的編輯才算「有更新」
      pubUI.set({ link: `${DATASET_URL}${job.id}/v${res.version}`, summary: null, message: T('hlPubDone', res.version), go: { hidden: true }, canDown: false });
    },
  });
  return pubUI;
}
async function openPublish(w) {
  pubW = w;
  const ui = await publishUi(), d = await P.data(w.id), on = globalThis.SITE?.backend === 'firebase';
  pubOk.checked = false; pubClaim.hidden = !!w.pack || !on;
  ui.set({
    message: on ? '' : T('stPubOff'), go: { text: w.pubv || w.pack ? T('hlPubUpdate') : T('hlPubGo'), hidden: false, disabled: !on }, canDown: false,
    summary: w.pack ? { intro: T('hlPubPackIntro'), items: [T('hlPubPackItemWall'), T('hlPubPackItemRoutes')] } : { intro: T('hlPubIntro'), items: [
      T('hlPubItemPhoto'),
      d.base && Object.keys(d.base).length ? T('hlPubItemEdits') + (w.reviewed ? '' : T('hlPubNotReviewed')) : T('hlPubItemNoBase'),
      T('hlPubItemLicense'),
    ] },
  });
  ui.open();
}
// 匯出一面牆（不公開）：畫面 <牆 id>.json（Climbio 公開格式 v2，只含裁切範圍裡的岩點）和照片 <牆 id>.jpg 打成 ZIP，
// 就是內嵌頁、別的 App 要的資料（見 docs/embed.md）
async function exportWall(w) {
  try {
    await P.flush();   // 匯出的是存好的岩點
    await shareLibs();
    const d = await P.data(w.id), view = P.view(w, d), errs = ClimbioFormat.validate(view);
    if (errs.length) throw new Error(errs[0]);
    const zip = await AppKit.files.zip([
      { name: `${w.id}.json`, blob: new Blob([JSON.stringify(view, null, 1)], { type: 'application/json' }) },
      { name: `${w.id}.jpg`, blob: await P.photo(w) },
    ]);
    const url = URL.createObjectURL(zip), a = Object.assign(document.createElement('a'), { href: url, download: `${(w.name || w.id).replace(/[\\/:*?"<>|]/g, '_')}.zip` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast(T('hlExported'));
  } catch (e) { console.error(e); toast(T('hlExportFail', e.message)); }
}
// 發佈步驟：每面牆一列，寫發佈到第幾版、之後有沒有改過；右邊是匯出，和（尚未發佈或有更新時）發佈
// 手動下架：拿掉找牆面入口和所有人在這面牆的路線；資料集已公開的檔案留著，重新發佈就回來。只有維護者能下架
async function unpublishUi(w) {
  if (!(await AppKit.ui.confirm(T('hlPubUnpublishAsk', w.name), { ok: T('hlPubUnpublish'), danger: true }))) return;
  try { await (await import('../publisher.js')).unpublishWall(w.pack ? w.pack.pid : w.id); toast(T('hlPubUnpublished')); }
  catch (e) { toast(T('hlPubUnpublishFail', e.status === 403 || e.status === 401 ? T('hlPubNotOwner') : e.message)); }
}
function renderPubs() {
  if (!P) return;
  StudioShell.pubList($('pubs'), doneWalls().map(w => {
    const stale = w.t > (w.pubT || 0), live = !!(w.pubv || w.pack);
    const { status, tone } = w.pack && !w.pubv ? { status: stale ? T('hlPubPackStale') : T('hlPubPackSame'), tone: stale ? 'look' : 'ok' } : StudioShell.pubStatus(w.pubv, stale);
    const actions = [{ label: T('hlReport'), onClick: () => { rpWall = w.id; goStep('report'); } }, { label: T('hlExportZip'), onClick: () => exportWall(w) }];
    if (!live || stale) actions.push({ label: live ? T('hlPubUpdate') : T('hlPubGo'), primary: true, onClick: () => openPublish(w) });   // 發佈過、之後沒改：不給發佈鈕
    if (live) actions.push({ label: T('hlPubUnpublish'), onClick: () => unpublishUi(w) });
    return { id: w.id, name: w.name, status, tone, actions, thumb: pic => setThumb(w, pic) };
  }), T('hlNoWalls'));
}
// 檢查步驟：還有待確認岩點、還沒逐顆檢查完、處理失敗的牆；點了打開那面
function renderChecks() {
  if (!P) return;
  const items = [];
  for (const w of P.walls) {
    if (w.status === 'failed') items.push({ title: w.name, note: T('hlWallFailed', w.err), tone: 'bad' });
    else if (w.status !== 'done') continue;
    else if (w.look) items.push({ title: w.name, note: T('hlLookOf', w.look, w.n), onClick: () => openWall(w) });
    else if (!w.reviewed) items.push({ title: w.name, note: T('hlNotReviewed'), onClick: () => openWall(w) });
  }
  StudioShell.checks($('checks'), items);
}

// ---- 報告：每一步的外框跟最後的岩點比（report.js 算、report-view.js 畫），跟已公開的牆、Lab 的 Hold Lab 頁同一個畫面 ----
// 發佈前：從這面牆的精修記錄算（跟發佈時寫進 <牆 id>.edits.json 的是同一份），所以公開後看到的報告跟這裡一樣
let rpView = null, rpWall = null;
const reportView = () => rpView || (rpView = ClimbioReportView.mount($('rpBox'), T));
async function renderReport() {
  const ws = doneWalls(), head = $('rpHead'), v = reportView();
  head.innerHTML = '';
  if (!ws.length) { v.message(T('hlNoWalls')); return; }
  const w = ws.find(x => x.id === rpWall) || ws[0];
  rpWall = w.id;
  head.append(el('h1', '', w.name));
  if (ws.length > 1) {
    const seg = el('div', 'seg'); seg.setAttribute('role', 'radiogroup');
    for (const x of ws) { const b = el('button', '', x.name); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', x === w); b.onclick = () => { rpWall = x.id; renderReport(); }; seg.append(b); }
    head.append(seg);
  }
  v.message(T('rpLoading'));
  await P.flush();
  const d = await P.data(w.id);
  if (view !== 'report' || rpWall !== w.id) return;
  const { record, holds } = recordOf(w, d);
  await v.show({ photo: await P.photo(w), w: w.w, h: w.h, stages: ClimbioReport.fromRecord(record, holds) });
}
// 已公開的牆 #r=<牆 id>：不用專案，從開放資料集讀（精修記錄或各步比對資料）；上面有到 Studio Wall 接著精修的連結（#p=）
async function openPublicReport(id) {
  show('report'); const v = reportView(), head = $('rpHead');
  try {
    const row = (await ClimbioReport.walls()).find(x => x.id === id);
    if (!row) throw new Error(T('hlPubNotWall'));
    head.innerHTML = '';
    const edit = el('a', 'btn', T('hlReportEdit')); edit.href = `#p=${id}`; edit.onclick = () => setTimeout(() => location.reload(), 0);
    head.append(el('h1', '', row.name || id), edit);
    $('pName').textContent = row.name || id;
    const r = await ClimbioReport.loadPublished(row);
    await v.show(r);
  } catch (e) { console.error(e); v.message(openErr(e)); }
}

// ---- SAM2 重描整面牆：裁切範圍裡每個偵測框重描，換掉對應岩點的外框（岩點 id 不變，路線不受影響；手畫、改過的岩點不動）----
async function refineWall(w) {
  if (busy.has(w.id)) return;
  const d = await P.data(w.id);
  if (!d.boxes || !d.boxes.length) { toast(T('hlNoBoxes')); return; }
  const todoBoxes = d.boxes.filter(b => centerIn(b, w.crop)), est = await RefineSam.estimate(todoBoxes, w.w, w.h);   // 開始前先說要多久、要不要下載
  const ok = await AppKit.ui.confirm(T('hlRefineAsk', todoBoxes.length, Math.max(1, Math.round(est.seconds / 60)), est.gpu) + (await RefineSam.isCached() ? '' : '\n' + T('hlSamAskBody')), { title: T('hlSamWall'), ok: T('hlRefineGo') });
  if (!ok) return;
  const open = E.active && cur && cur.w === w;
  if (open) await E.close();
  const say = t => { busy.set(w.id, t); updateCard(w); $('saveState').textContent = t; };
  try {
    say(T('hlSamLoading'));
    await RefineSam.load((t, f) => say(f && f < 1 ? `${t} ${Math.round(f * 100)}%` : t));
    const c = await photoCanvas(P, w);
    RefineSam.setPhoto(c, 'batch');
    const todo = d.boxes.map((b, i) => i).filter(i => centerIn(d.boxes[i], w.crop)), raw = {};
    await RefineSam.refineBoxes(todo.map(i => d.boxes[i]), (k, n) => say(T('hlRetracing', k, n)), () => !P.wall(w.id), { key: 'batch', onItem: (k, r) => { raw[todo[k]] = r; } });
    const res = RefineSam.flagAll(todo.filter(i => raw[i]).map(i => ({ ...raw[i], flags: [...raw[i].flags], i })));
    for (const r of res) {
      const h = d.holds.find(x => x.b === r.i);
      if (!h) { const n = { id: holdId(), poly: r.poly, source: 'detect', flags: r.flags, b: r.i }; d.holds.push(n); noteBase(d, n); continue; }
      if (h.source !== 'detect' || (h.sam && h.sam.pick && h.sam.pick !== 'auto')) continue;   // 手畫、改過的、人已經決定過的不動
      if (!(d.base && d.base[h.id])) noteBase(d, h);   // 自動結果記 HoldKit 的外框；SAM2 的掛在岩點的 sam 上，跟人的選擇一起進研究記錄
      const iou = RefineRecord.polyIou(h.poly, r.poly, w.w, w.h), look = iou < RefineRecord.SAME || r.flags.length > 0;
      h.sam = { poly: r.poly, flags: r.flags, iou: Math.round(iou * 1000) / 1000, pick: look ? '' : 'auto' };   // 兩個外框一致又沒旗標的直接採用 SAM2，其餘等人確認
      if (!look) h.poly = r.poly;
    }
    counts(w, d); P.touch(w, { ms: 0 });
    if (w.look) toast(T('hlSamDone', w.look));
  } catch (e) { console.error(e); toast(T('hlRefineFail', e.message)); }
  finally { busy.delete(w.id); updateCard(w); $('saveState').textContent = ''; }
  // 跑完有要確認的直接進去看；打不開（例如剛存的檔案還在寫）不影響重描結果，只提示
  if (open || (view === 'walls' && w.look)) await openWall(w).catch(e => { console.error(e); toast(openErr(e)); });
}

boot();
addEventListener('hashchange', () => { const [pid, wid] = decodeURIComponent(location.hash.slice(1)).split('/'); if (P && pid === P.id && !wid && view === 'review') goStep('walls'); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('../sw.js').catch(e => console.warn('Service Worker', e));
if (!StudioShell.menu) fetch('../shell.js', { cache: 'reload' }).catch(() => {});
else StudioShell.menu();
