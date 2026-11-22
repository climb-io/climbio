// Climbio Lab 戶外天然岩場示範頁：載入 v2 Guidebook 包（/p/ 或本機資料夾），整座岩場一個高斯潑濺 3D（跟紅點貓同一個元件），加上瀏覽器端照片自動認牆疊線。
import { mountCrag3d } from '../../crag3dkit/index.js';
import { renderLines } from '../../topokit/render.js';
import { injectStyle } from '../../topokit/style.js';
import { pickGrade, pickName } from '../../topokit/data.js';

const DEFAULT_PACK_URL = '/p/rw9oa7t1taemt9zj/index.json';
const FALLBACK_REMOTE_PACK_URL = 'https://climbio.app/p/rw9oa7t1taemt9zj/index.json';
const QUERY_LONG = 1200;

const $ = (id) => document.getElementById(id);
const LAB_TEXT = {
  clrModel: '單區 3D 模型', clrComputer: '電腦', clrPhone: '手機', clrZones: '區', clrSize: (mb) => `共 ${mb} MB`, clrFaces: (n) => `${n} 個三角面`,
  clrRecognize: '照片認牆', clrCorrect: '認對', clrHoldout: (a, b) => `留出照 ${a}／${b} 張`, clrWrong: (a, b) => `跨區誤判 ${a}、負例誤報 ${b}`,
  clrProject: '路線投影', clrPx: '像素', clrMedian: '中位誤差',
  clrDefn: '留出照是沒參與建模的現場照片：認對是照片認到正確分區的比例；負例是不屬於任何分區的照片，認成某一區就算誤報；路線投影誤差是投到照片上的路線跟人標的路線差幾個像素。',
};

const state = {
  ready: false,
  packSource: '',
  cragName: '',
  nodes: [],
  zones: [],
  activeZoneIdx: 0,
  highlightedRouteId: null,
  model: null,
  viewer: null,
  lab: null,
  lastLocate: null,
  recogHighlightId: null,
  objectUrls: [],
};

let worker = null;
let workerSeq = 0;
const pendingCalls = new Map();

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.js', import.meta.url));
  worker.onmessage = (ev) => {
    const msg = ev.data || {};
    const slot = pendingCalls.get(msg.id);
    if (!slot) return;
    pendingCalls.delete(msg.id);
    if (msg.ok) slot.resolve(msg);
    else slot.reject(new Error(msg.error || 'Worker 執行失敗'));
  };
  worker.onerror = (err) => {
    setBadge($('workerStatus'), `認牆引擎錯誤：${err.message || '未知錯誤'}`, 'error');
  };
  return worker;
}

function callWorker(op, payload = {}, transfer = []) {
  const w = ensureWorker();
  const id = ++workerSeq;
  return new Promise((resolve, reject) => {
    pendingCalls.set(id, { resolve, reject });
    w.postMessage({ id, op, ...payload }, transfer);
  });
}

function setBadge(el, text, mode = '') {
  if (!el) return;
  el.textContent = text;
  if (mode) el.dataset.state = mode;
  else delete el.dataset.state;
}

function clearObjectUrls() {
  for (const u of state.objectUrls) URL.revokeObjectURL(u);
  state.objectUrls.length = 0;
}

/** 包的內容本身有錯（格式不合、沒有可顯示的分區）：換網址重讀也一樣，不再退回下一個來源 */
class PackDataError extends Error {}

function validateDoc(doc, label) {
  if (!globalThis.ClimbioFormat?.validate) return doc;
  const errs = globalThis.ClimbioFormat.validate(doc);
  if (errs.length) throw new PackDataError(`${label} 格式驗證未通過：${errs.slice(0, 2).join('；')}`);
  return doc;
}

function openFetch(url, opts) {
  return globalThis.ShareTools ? globalThis.ShareTools.open(String(url), opts) : globalThis.fetch(url, opts);
}

function createUrlResolver(indexUrl) {
  const base = new URL('./', new URL(indexUrl, location.href));
  return {
    label: String(indexUrl),
    urlOf: (rel) => new URL(rel, base).href,
    async json(rel, optional = false) {
      const res = await openFetch(new URL(rel, base).href);
      if (!res.ok) {
        if (optional) return null;
        throw new Error(`讀取 ${rel} 失敗（HTTP ${res.status}）`);
      }
      return res.json();
    },
  };
}

function createFileMapResolver(fileList) {
  clearObjectUrls();
  const byName = new Map();
  for (const f of fileList) {
    const baseName = f.name.split('/').pop();
    byName.set(baseName, f);
  }
  return {
    label: '本機資料夾',
    urlOf(rel) {
      const name = rel.split('/').pop();
      const f = byName.get(name);
      if (!f) throw new Error(`本機資料夾缺少檔案：${name}`);
      const u = URL.createObjectURL(f);
      state.objectUrls.push(u);
      return u;
    },
    async json(rel, optional = false) {
      const name = rel.split('/').pop();
      const f = byName.get(name);
      if (!f) {
        if (optional) return null;
        throw new Error(`本機資料夾缺少 ${name}`);
      }
      return JSON.parse(await f.text());
    },
  };
}

/**
 * 組合裡的 3D 岩場：一個模型（surface: model，.spz）分成幾區。
 * 各區＝從這個模型拍的快照所在的岩壁（照岩壁順序），鏡頭用快照的 props.model.camera；跟紅點貓的 3D 同一套（redpoint/app.js 的 open3d）
 */
function extractCragFromBook(book, childDocs, resolver) {
  const nodes = Array.isArray(book.nodes) ? book.nodes : [];
  const byNode = new Map(nodes.map((n) => [n.id, n]));
  const cragNode = nodes.find((n) => n.type === 'crag');
  const docs = [...childDocs.values()];
  const snapsOf = (modelId) => docs.filter((d) => d.kind === 'view' && d.surface === 'photo'
    && d.props?.model?.id === modelId && byNode.get(d.props.node)?.type === 'wall');
  const model = docs.find((d) => d.kind === 'view' && d.surface === 'model' && snapsOf(d.id).length);
  if (!model) throw new PackDataError('資料包中沒有 3D 岩場模型');

  const layers = docs.filter((d) => d.kind === 'layer' && d.on === model.id);
  const marks = layers.flatMap((l) => l.marks || []);
  const walls = [...new Map(snapsOf(model.id).map((v) => [v.props.node, v])).values()]
    .sort((a, b) => (byNode.get(a.props.node).props?.order ?? 0) - (byNode.get(b.props.node).props?.order ?? 0));

  const zones = walls.map((v) => {
    const wn = byNode.get(v.props.node);
    const routes = nodes
      .filter((n) => n.type === 'route' && n.parent === wn.id)
      .sort((a, b) => (a.props?.order ?? 0) - (b.props?.order ?? 0))
      .map((r, idx) => {
        const mark = marks.find((m) => m.node === r.id);
        const label = mark?.props?.label != null ? String(mark.props.label) : String(r.props?.order ?? idx + 1);
        return { id: r.id, label, name: pickName(r.name, 'zh-Hant') || `路線 ${label}`, grade: pickGrade(r.props?.grade) || '' };
      });
    return {
      nodeId: wn.id,
      slug: wn.props?.slug || wn.id,
      name: pickName(wn.name, 'zh-Hant') || wn.id,
      posterUrl: resolver.urlOf(v.href),
      area: { id: wn.id, name: pickName(wn.name, 'zh-Hant') || wn.id, camera: v.props.model.camera, aspect: v.w / v.h, routes: new Set(routes.map((r) => r.id)) },
      routes,
    };
  });

  return {
    cragName: pickName(cragNode?.name || book.name, 'zh-Hant') || '天然岩場',
    nodes,
    zones,
    model: { url: resolver.urlOf(model.href), marks, sight: layers.find((l) => l.props?.sight)?.props.sight, sky: model.props?.sky },
  };
}

async function loadFromResolver(resolver) {
  setBadge($('packStatus'), `正在載入 ${resolver.label}…`);
  const book = validateDoc(await resolver.json('index.json'), 'index.json');
  const childDocs = new Map();

  const packHref = book.props?.pack?.href;
  const packed = packHref ? await resolver.json(packHref, true) : null;
  if (packed?.docs) {
    for (const [path, doc] of Object.entries(packed.docs)) {
      validateDoc(doc, path);
      childDocs.set(doc.id, doc);
    }
  } else {
    for (const it of book.items || []) {
      const doc = validateDoc(await resolver.json(it.href), it.href);
      childDocs.set(doc.id, doc);
    }
  }

  const parsed = extractCragFromBook(book, childDocs, resolver);

  if (state.viewer) {
    state.viewer.destroy();
    state.viewer = null;
  }

  state.packSource = resolver.label;
  state.cragName = parsed.cragName;
  state.nodes = parsed.nodes;
  state.zones = parsed.zones;
  state.model = parsed.model;
  state.activeZoneIdx = 0;
  state.highlightedRouteId = null;

  const labHref = book.props?.lab?.href;
  const lab = labHref ? await resolver.json(labHref) : null;
  state.lab = lab;

  renderZoneTabs();
  await mountCrag(0);
  renderLabSections(lab, resolver);

  const totalRoutes = state.zones.reduce((acc, z) => acc + z.routes.length, 0);
  setBadge(
    $('packStatus'),
    `已載入 ${state.cragName}：${state.zones.length} 個分區・${totalRoutes} 條路線`,
    'ready'
  );

  const bundle = lab?.bundleHref ? await resolver.json(lab.bundleHref) : null;
  showRecognize(!!bundle);
  if (bundle) {
    setBadge($('workerStatus'), '正在初始化 OpenCV WASM 與搜尋包…');
    const res = await callWorker('set_bundle', { bundle });
    setBadge($('workerStatus'), `認牆引擎就緒（${res.wallCount} 區特徵包）`, 'ready');
    // 自動以第一張留出測試照預跑一次示範，打開即見認牆疊線成果
    if (lab?.testPhotos?.length) {
      await runSamplePhoto(lab.testPhotos[0], resolver, 0);
    }
  }

  state.ready = true;
  document.body.dataset.ready = 'true';
}

function renderZoneTabs() {
  const wrap = $('zoneTabs');
  wrap.replaceChildren();
  state.zones.forEach((z, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'crag-zone-btn';
    btn.role = 'tab';
    btn.dataset.zoneSlug = z.slug;
    btn.setAttribute('aria-selected', idx === state.activeZoneIdx ? 'true' : 'false');
    const nameSpan = document.createElement('span');
    nameSpan.textContent = z.name;
    const countEl = document.createElement('small');
    countEl.textContent = `${z.routes.length}`;
    btn.append(nameSpan, countEl);
    btn.addEventListener('click', () => { selectZone(idx); });
    wrap.append(btn);
  });
}

function syncRouteListSelection() {
  for (const btn of $('zoneRouteList').querySelectorAll('.crag-route-item')) {
    const on = btn.dataset.routeId === state.highlightedRouteId;
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

function renderZoneRoutes(zone) {
  $('activeZoneTitle').textContent = `${zone.name}路線`;
  $('activeZoneMeta').textContent = `共 ${zone.routes.length} 條`;
  const ul = $('zoneRouteList');
  ul.replaceChildren();
  for (const r of zone.routes) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'crag-route-item';
    btn.dataset.routeId = r.id;
    btn.setAttribute('aria-pressed', r.id === state.highlightedRouteId ? 'true' : 'false');

    const num = document.createElement('span');
    num.className = 'crag-route-num';
    num.textContent = r.label;
    const name = document.createElement('span');
    name.className = 'crag-route-name';
    name.textContent = r.name;
    const grade = document.createElement('span');
    grade.className = 'crag-route-grade';
    grade.textContent = r.grade;

    btn.append(num, name, grade);
    btn.addEventListener('click', () => {
      state.highlightedRouteId = state.highlightedRouteId === r.id ? null : r.id;
      syncRouteListSelection();
      if (state.viewer) state.viewer.highlight(state.highlightedRouteId);
    });
    li.append(btn);
    ul.append(li);
  }
}

/** 分區按鈕、路線清單跟著目前這一區（滑動岩壁、按分區、認牆後跳過來都走這裡） */
function showZone(idx) {
  const zone = state.zones[idx];
  if (!zone) return;
  state.activeZoneIdx = idx;
  state.highlightedRouteId = null;
  for (const [i, btn] of [...$('zoneTabs').children].entries()) {
    btn.setAttribute('aria-selected', i === idx ? 'true' : 'false');
  }
  renderZoneRoutes(zone);
}

/** 整個岩場一個 3D：先鋪那一區的快照，模型在背景載入 */
async function mountCrag(start) {
  showZone(start);
  const viewer = await mountCrag3d($('modelStage'), {
    ...state.model,
    nodes: state.nodes,
    areas: state.zones.map((z) => z.area),
    start,
    poster: state.zones[start].posterUrl,
    onPick(routeId) {
      state.highlightedRouteId = routeId || null;
      viewer.highlight(state.highlightedRouteId);
      syncRouteListSelection();
      if (routeId) {
        const targetBtn = $('zoneRouteList').querySelector(`[data-route-id="${CSS.escape(routeId)}"]`);
        targetBtn?.scrollIntoView({ block: 'nearest' });
      }
    },
    onArea: showZone,
  });
  state.viewer = viewer;
}

function selectZone(idx) {
  if (!state.zones[idx]) return;
  showZone(idx);
  state.viewer?.go(idx);
}

/** 包裡有認牆搜尋包才顯示認牆區（和導覽的連結），沒有就整段不出現 */
function showRecognize(on) {
  $('recognize').hidden = !on;
  $('navRecognize').hidden = !on;
}

function renderLabSections(lab, resolver) {
  const strip = $('samplePhotoStrip');
  strip.replaceChildren();
  $('benchmark').hidden = !lab;
  $('photoEmpty').textContent = lab?.testPhotos?.length ? '選一張測試照或岩壁照片' : '選一張岩壁照片';

  if (!lab) {
    $('guidePhotosWrap').hidden = true;
    return;
  }

  if (Array.isArray(lab.testPhotos)) {
    lab.testPhotos.forEach((tp, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'crag-sample-btn';
      btn.dataset.sampleId = tp.id;
      btn.setAttribute('aria-pressed', 'false');
      const img = document.createElement('img');
      img.src = resolver.urlOf(tp.thumbHref || tp.href);
      img.alt = tp.label;
      img.loading = 'lazy';
      const cap = document.createElement('span');
      cap.textContent = tp.label;
      btn.append(img, cap);
      btn.addEventListener('click', () => { runSamplePhoto(tp, resolver, idx); });
      strip.append(btn);
    });
  }

  // 實測數據：跟 Studio、Hold Lab 的報告同一個框架（studio/report-frame.js），數字算法在 studio/crag/lab-report.js
  const report = ClimbioCragLabReport.build(lab, (k, ...a) => { const v = LAB_TEXT[k]; return typeof v === 'function' ? v(...a) : v ?? k; });
  ClimbioReportFrame.steps($('labSteps'), report.steps);
  ClimbioReportFrame.notes($('labNotes'), { defn: report.defn });

  const tbody = $('zoneStatsBody');
  tbody.replaceChildren();
  for (const z of lab.zones || []) {
    const tr = document.createElement('tr');
    const cells = [
      z.name,
      `${z.routes} 條`,
      `${((z.modelBytes || 0) / 1e6).toFixed(2)} MB`,
      (z.faces || 0).toLocaleString('en-US'),
      `${z.referenceViews ?? '—'} 張`,
    ];
    for (const c of cells) {
      const td = document.createElement('td');
      td.textContent = c;
      tr.append(td);
    }
    tbody.append(tr);
  }

  const guide = lab.shootingGuide;
  const gGrid = $('guidePhotosGrid');
  gGrid.replaceChildren();
  const cards = [
    ...(guide?.good || []).map((g) => ({ ...g, kind: 'good', badge: '建議拍法' })),
    ...(guide?.avoid || []).map((g) => ({ ...g, kind: 'avoid', badge: '應避免' })),
  ];
  if (cards.length) {
    $('guidePhotosWrap').hidden = false;
    for (const item of cards) {
      const card = document.createElement('article');
      card.className = 'crag-guide-card';
      const img = document.createElement('img');
      img.src = resolver.urlOf(item.href);
      img.alt = item.title;
      img.loading = 'lazy';
      const body = document.createElement('div');
      body.className = 'crag-guide-body';
      const tag = document.createElement('span');
      tag.className = `crag-guide-tag ${item.kind}`;
      tag.textContent = item.badge;
      const h4 = document.createElement('h4');
      h4.textContent = item.title;
      const p = document.createElement('p');
      const m = item.metrics || {};
      const pitchStr = m.pitchDeg != null ? `・俯仰 ${m.pitchDeg}°` : '';
      p.textContent = `清晰度 ${m.sharpness ?? '—'}・岩石佔比 ${Math.round((m.rockRatio || 0) * 100)}%・天空 ${Math.round((m.skyRatio || 0) * 100)}%${pitchStr}`;
      body.append(tag, h4, p);
      card.append(img, body);
      gGrid.append(card);
    }
  } else {
    $('guidePhotosWrap').hidden = true;
  }
}

async function decodeImageToGray(imgUrl) {
  const probe = new Image();
  if (/^https?:/i.test(imgUrl) && new URL(imgUrl, location.href).origin !== location.origin) {
    probe.crossOrigin = 'anonymous';
  }
  probe.decoding = 'sync';
  await new Promise((resolve, reject) => {
    probe.onload = () => resolve();
    probe.onerror = () => reject(new Error('圖片載入失敗'));
    probe.src = imgUrl;
  });
  if (probe.decode) {
    try { await probe.decode(); } catch { /* Safari 已於 onload 完成解碼 */ }
  }
  const displayImg = $('queryImg');
  displayImg.src = imgUrl;
  const fullW = probe.naturalWidth;
  const fullH = probe.naturalHeight;
  const scale = Math.min(1, QUERY_LONG / Math.max(fullW, fullH));
  const w = Math.max(1, Math.round(fullW * scale));
  const h = Math.max(1, Math.round(fullH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(probe, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const gray = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
    gray[i] = Math.round(0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]);
  }
  return { gray, width: w, height: h, fullWidth: fullW, fullHeight: fullH };
}

function renderPhotoOverlay() {
  const svg = $('queryOverlay');
  const box = $('photoBox');
  const res = state.lastLocate;
  if (!res || !res.matched || !res.projectedRoutes?.length) {
    svg.innerHTML = '';
    return;
  }
  box.classList.add('tk');
  injectStyle(box);
  const w = res.fullWidth;
  const h = res.fullHeight;
  const rect = $('queryImg').getBoundingClientRect();
  const displayW = Math.max(rect.width || 480, 240);
  const k = w / displayW;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.innerHTML = renderLines(res.projectedRoutes, {
    photo: { w, h },
    k,
    densityK: k,
    highlight: state.recogHighlightId || undefined,
    interactive: false,
  });
}

function updateRecognitionPanel(res) {
  const ul = $('recogRouteList');
  ul.replaceChildren();
  const jumpBtn = $('jumpMatchedZoneBtn');

  if (!res.matched) {
    $('recogBadge').textContent = '未匹配';
    $('statSector').textContent = '未偵測到已知岩壁分區';
    $('statInliers').textContent = String(res.inliers || 0);
    $('statMs').textContent = `${res.ms ?? 0} ms`;
    $('statRoutes').textContent = '0 條';
    jumpBtn.hidden = true;
    renderPhotoOverlay();
    return;
  }

  $('recogBadge').textContent = '幾何驗證通過';
  $('statSector').textContent = res.sectorName || res.wallName;
  $('statInliers').textContent = `${res.inliers} 點`;
  $('statMs').textContent = `${res.ms} ms`;
  $('statRoutes').textContent = `${res.projectedRoutes.length} 條`;

  const matchIdx = state.zones.findIndex(
    (z) => z.nodeId === res.sectorNodeId || z.name === res.sectorName
  );
  if (matchIdx >= 0) {
    jumpBtn.hidden = false;
    jumpBtn.onclick = () => {
      selectZone(matchIdx);
      $('explorer').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  } else {
    jumpBtn.hidden = true;
  }

  for (const r of res.projectedRoutes) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'crag-route-item';
    btn.dataset.routeId = r.id;
    btn.setAttribute('aria-pressed', r.id === state.recogHighlightId ? 'true' : 'false');

    const num = document.createElement('span');
    num.className = 'crag-route-num';
    if (r.stroke) num.style.background = r.stroke;
    num.textContent = r.label;
    const name = document.createElement('span');
    name.className = 'crag-route-name';
    name.textContent = r.name;
    const grade = document.createElement('span');
    grade.className = 'crag-route-grade';
    grade.textContent = r.grade;

    btn.append(num, name, grade);
    btn.addEventListener('click', () => {
      state.recogHighlightId = state.recogHighlightId === r.id ? null : r.id;
      for (const b of ul.querySelectorAll('.crag-route-item')) {
        b.setAttribute('aria-pressed', b.dataset.routeId === state.recogHighlightId ? 'true' : 'false');
      }
      renderPhotoOverlay();
    });
    li.append(btn);
    ul.append(li);
  }
  renderPhotoOverlay();
}

async function recognizeImageUrl(imgUrl) {
  $('photoEmpty').hidden = true;
  $('photoBox').hidden = false;
  $('queryOverlay').innerHTML = '';
  $('recogBadge').textContent = '辨識中…';
  state.recogHighlightId = null;

  const decoded = await decodeImageToGray(imgUrl);
  const res = await callWorker(
    'locate',
    {
      gray: decoded.gray,
      width: decoded.width,
      height: decoded.height,
      fullWidth: decoded.fullWidth,
      fullHeight: decoded.fullHeight,
    },
    [decoded.gray.buffer]
  );
  state.lastLocate = { ...res, fullWidth: decoded.fullWidth, fullHeight: decoded.fullHeight };
  updateRecognitionPanel(state.lastLocate);
}

async function runSamplePhoto(tp, resolver, activeIdx) {
  for (const [i, btn] of [...$('samplePhotoStrip').children].entries()) {
    btn.setAttribute('aria-pressed', i === activeIdx ? 'true' : 'false');
  }
  await recognizeImageUrl(resolver.urlOf(tp.href));
}

function bindEvents() {
  $('resetViewBtn').addEventListener('click', () => {
    selectZone(state.activeZoneIdx);
  });

  $('pickPackBtn').addEventListener('click', () => {
    $('pickPackInput').click();
  });

  $('pickPackInput').addEventListener('change', async (ev) => {
    const files = ev.target.files;
    if (!files?.length) return;
    try {
      await loadFromResolver(createFileMapResolver(files));
    } catch (err) {
      setBadge($('packStatus'), `本機資料夾載入失敗：${err.message}`, 'error');
    }
  });

  $('uploadPhotoBtn').addEventListener('click', () => {
    $('uploadPhotoInput').click();
  });

  $('uploadPhotoInput').addEventListener('change', async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    for (const btn of $('samplePhotoStrip').children) btn.setAttribute('aria-pressed', 'false');
    const u = URL.createObjectURL(file);
    state.objectUrls.push(u);
    try {
      await recognizeImageUrl(u);
    } catch (err) {
      setBadge($('workerStatus'), `照片辨識失敗：${err.message}`, 'error');
    }
  });

  for (const b of document.querySelectorAll('.copy')) {
    b.addEventListener('click', async () => {
      const target = $(b.dataset.copy);
      if (!target) return;
      const orig = b.textContent;
      try {
        await navigator.clipboard.writeText(target.textContent);
        b.textContent = '已複製';
      } catch {
        b.textContent = '複製失敗，請手動選取';
      }
      setTimeout(() => { b.textContent = orig; }, 1800);
    });
  }

  window.addEventListener('resize', () => {
    if (state.lastLocate?.matched) renderPhotoOverlay();
  });
}

async function boot() {
  bindEvents();
  window.cragLabTest = {
    state,
    selectZone,
    recognizeImageUrl,
  };

  const paramPack = new URLSearchParams(location.search).get('pack');
  const candidates = paramPack ? [paramPack] : [DEFAULT_PACK_URL, FALLBACK_REMOTE_PACK_URL];

  let lastErr = null;
  for (const url of candidates) {
    try {
      await loadFromResolver(createUrlResolver(url));
      return;
    } catch (err) {
      lastErr = err;
      if (err instanceof PackDataError) break;
    }
  }
  setBadge(
    $('packStatus'),
    `尚未連線至預設岩場包（${lastErr?.message || '請以 ?pack= 指定或點選載入本機輸出資料夾'}）`,
    'error'
  );
  document.body.dataset.ready = 'error';
}

boot();
