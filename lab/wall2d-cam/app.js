// 2D 牆相機即時偵測實驗頁：相機／模擬畫面 → Worker（AKAZE 認牆＋單應矩陣＋雙向 LK 光流維持）→ 即時疊合路線岩點外框。
import {
  mainCamera,
  cameraViewport,
  cameraConstraints,
  reversedCameraFrame,
  reverseCameraConstraints,
  firstCameraFrame,
  frameContentSummary,
} from '../../3d/source/holds-3d-camera-view.js';
import { TrackingLog2d } from './tracking-log.js';

const G = globalThis.Wall2dGeometry;
const $ = (id) => document.getElementById(id);

const CAPTURE_LONG_SIDE = 640;
const FEATURE_LONG_SIDE = 1280;
const STALE_MS = 500;
const MIN_PROCESS_INTERVAL_MS = 16; // 追蹤態允許高頻光流（受瀏覽器實際新影格節流）
const SYNC_HOLD_MS = 34; // 同幀對齊等待下限：超過即放行預覽並套用延遲補償，避免畫面卡頓
const SYNC_HOLD_MAX_MS = 70; // 慢的手機照實際處理時間多等一點（上限），疊圖才跟得上同一幀
const CAM_REVERSED_KEY = 'climbio.wall2dCamReversed'; // 這支手機的相機會不會把直／橫寬高反過來（boot.js 開相機前先讀）
const REANCHOR_FRAME_INTERVAL = 40;
const CAM_CACHE_DB = 'climbio-wall2d-cam';
const CAM_CACHE_STORE = 'cameras';

const absNow = () => performance.timeOrigin + performance.now();

function readCamReversed() {
  try {
    return JSON.parse(localStorage.getItem(CAM_REVERSED_KEY) || '{}') || {};
  } catch {
    return {};
  }
}
function saveCamReversed(orientation, reversed) {
  try {
    const all = readCamReversed();
    if (all[orientation] === reversed) return;
    all[orientation] = reversed;
    localStorage.setItem(CAM_REVERSED_KEY, JSON.stringify(all));
  } catch { /* 存不了就下次再判斷 */ }
}

let blurSupported = null;
function supportsCanvasBlur() {
  if (blurSupported !== null) return blurSupported;
  try {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const x = c.getContext('2d', { willReadFrequently: true });
    if (!x || !('filter' in x)) { blurSupported = false; return false; }
    x.filter = 'blur(2px)';
    if (x.filter !== 'blur(2px)') { blurSupported = false; return false; }
    x.fillStyle = '#ffffff';
    x.fillRect(6, 6, 4, 4);
    blurSupported = x.getImageData(4, 8, 1, 1).data[3] > 0;
  } catch {
    blurSupported = false;
  }
  return blurSupported;
}

const glowSrcCanvas = document.createElement('canvas');
const glowDstCanvas = document.createElement('canvas');

const getJson = (url) =>
  fetch(url, { credentials: 'omit' }).then((r) => {
    if (!r.ok) throw new Error(`讀取失敗：${url}（HTTP ${r.status}）`);
    return r.json();
  });

function openCamCache() {
  if (!self.indexedDB) return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(CAM_CACHE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CAM_CACHE_STORE)) {
        db.createObjectStore(CAM_CACHE_STORE, { keyPath: 'wallId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function getCachedCamera(wallId, w, h, photoSize, updatedAt) {
  try {
    const db = await openCamCache();
    if (!db) return null;
    return await new Promise((resolve) => {
      const tx = db.transaction(CAM_CACHE_STORE, 'readonly');
      const req = tx.objectStore(CAM_CACHE_STORE).get(String(wallId));
      req.onsuccess = () => {
        const rec = req.result;
        db.close();
        if (rec && rec.w === w && rec.h === h && rec.photoSize === photoSize && (!updatedAt || rec.updatedAt === updatedAt) && rec.camera) {
          resolve(rec.camera);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => { db.close(); resolve(null); };
    });
  } catch {
    return null;
  }
}

async function putCachedCamera(wallId, w, h, photoSize, updatedAt, camera) {
  try {
    const db = await openCamCache();
    if (!db) return;
    await new Promise((resolve) => {
      const tx = db.transaction(CAM_CACHE_STORE, 'readwrite');
      tx.objectStore(CAM_CACHE_STORE).put({ wallId: String(wallId), w, h, photoSize, updatedAt, camera });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); resolve(); };
    });
  } catch { /* ignore cache write errors */ }
}

async function photoToGray(blob) {
  const bmp = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, FEATURE_LONG_SIDE / Math.max(bmp.width, bmp.height));
    const width = Math.max(1, Math.round(bmp.width * scale));
    const height = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const c = canvas.getContext('2d', { willReadFrequently: true });
    c.drawImage(bmp, 0, 0, width, height);
    const rgba = c.getImageData(0, 0, width, height).data;
    const gray = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      gray[i] = Math.round(0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]);
    }
    return { gray, width, height };
  } finally {
    bmp.close();
  }
}

function setTools(open) {
  document.body.dataset.tools = open ? 'open' : 'closed';
  $('tools-toggle').setAttribute('aria-expanded', String(open));
}

function setStatus(text) {
  $('status').textContent = text;
}

function setNotice(text) {
  $('notice').textContent = text;
}

/** 依目前的牆面、路線與查詢參數決定要繪製的岩點清單與顏色 */
function resolveDisplayedHolds(wall, selectedRouteId, urlRouteMap) {
  if (!wall) return [];
  const holdById = new Map(wall.holds.map((h) => [h.id, h]));
  if (urlRouteMap && urlRouteMap.size) {
    const out = [];
    for (const [id, role] of urlRouteMap) {
      const h = holdById.get(id);
      if (h) out.push({ id: h.id, poly: h.poly, role, color: G.ROLE_COLORS[role] || G.ROLE_COLORS.h });
    }
    return out;
  }
  if (selectedRouteId && selectedRouteId !== '__all__') {
    const r = wall.routes.find((x) => x.id === selectedRouteId);
    if (r) {
      const out = [];
      for (const [id, role] of Object.entries(r.holds)) {
        const h = holdById.get(id);
        if (h) out.push({ id: h.id, poly: h.poly, role, color: G.ROLE_COLORS[role] || G.ROLE_COLORS.h });
      }
      return out;
    }
  }
  return wall.holds.map((h) => ({ id: h.id, poly: h.poly, role: null, color: '#38bdf8' }));
}

/** 依岩點面積（≥ 中位數 8 倍）取得牆面大型量體集合（與岩點貓相同定義） */
function volumeIdsOf(wall) {
  if (!wall) return new Set();
  if (!wall._volumeIds) wall._volumeIds = G.markVolumeHolds(wall.holds);
  return wall._volumeIds;
}

/**
 * 把照片座標的岩點多邊形透過單應矩陣 H（photo → capture）與 cover 視埠映射到螢幕畫布：
 * - 預設（showOutlines = false）：照岩點貓路線圖僅繪製外圍角色光暈，不畫外框線與多餘標籤，大型量體以整個量體光暈為主。
 * - 除錯模式（showOutlines = true）：額外顯示外框線與起攀／完攀標記。
 */
function drawHoldOverlays(ctx, stageW, stageH, dpr, pose, wall, selectedRouteId, urlRouteMap, showOutlines = false) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, stageW, stageH);
  if (!pose || !wall) return;

  const holds = resolveDisplayedHolds(wall, selectedRouteId, urlRouteMap);
  if (!holds.length) return;

  const vp = cameraViewport(stageW, stageH, pose.width, pose.height);
  const scaleX = vp.width / pose.width;
  const scaleY = vp.height / pose.height;
  // 複合矩陣：Stage = A_vp * H_photo_to_capture
  const A = [scaleX, 0, vp.x, 0, scaleY, vp.y, 0, 0, 1];
  const M = G.mul3x3(A, pose.H);

  const volumes = volumeIdsOf(wall);
  const projected = [];
  for (const h of holds) {
    const pts = [];
    let valid = true;
    for (const [px, py] of h.poly) {
      const sp = G.applyHomography(M, px, py);
      if (!sp) {
        valid = false;
        break;
      }
      pts.push(sp);
    }
    if (!valid || pts.length < 3) continue;
    projected.push({ ...h, pts, isVolume: volumes.has(h.id) });
  }
  if (!projected.length) return;

  // 大型量體先畫，再畫一般岩點；挖空內部時整個量體一起挖空，保留整個量體外圍光暈
  projected.sort((a, b) => Number(b.isVolume) - Number(a.isVolume));

  const trace = (targetCtx, pts) => {
    targetCtx.beginPath();
    targetCtx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) targetCtx.lineTo(pts[i][0], pts[i][1]);
    targetCtx.closePath();
  };

  const showAll = !urlRouteMap?.size && selectedRouteId === '__all__';

  if (!showOutlines) {
    const pw = ctx.canvas.width;
    const ph = ctx.canvas.height;
    if (supportsCanvasBlur()) {
      const k = 2;
      const gw = Math.max(1, Math.ceil(pw / k));
      const gh = Math.max(1, Math.ceil(ph / k));
      if (glowSrcCanvas.width !== gw || glowSrcCanvas.height !== gh) {
        glowSrcCanvas.width = gw;
        glowSrcCanvas.height = gh;
        glowDstCanvas.width = gw;
        glowDstCanvas.height = gh;
      }
      const sc = glowSrcCanvas.getContext('2d');
      const dc = glowDstCanvas.getContext('2d');
      sc.setTransform(1, 0, 0, 1, 0, 0);
      sc.clearRect(0, 0, gw, gh);
      sc.setTransform(dpr / k, 0, 0, dpr / k, 0, 0);
      for (const h of projected) {
        sc.fillStyle = showAll ? '#38bdf8' : h.color;
        trace(sc, h.pts);
        sc.fill();
      }
      const passes = [
        { sigma: 4.0 * dpr, alpha: 0.9, repeat: 1 },
        { sigma: 1.6 * dpr, alpha: 0.95, repeat: 2 },
      ];
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      for (const pass of passes) {
        dc.setTransform(1, 0, 0, 1, 0, 0);
        dc.clearRect(0, 0, gw, gh);
        dc.filter = `blur(${pass.sigma.toFixed(2)}px)`;
        dc.drawImage(glowSrcCanvas, 0, 0);
        dc.filter = 'none';
        ctx.globalAlpha = pass.alpha;
        for (let r = 0; r < pass.repeat; r++) {
          ctx.drawImage(glowDstCanvas, 0, 0, pw, ph);
        }
      }
      ctx.restore();
    } else {
      // iOS 舊版不支援 Canvas 2D filter 時退回 shadowBlur，同樣只留外圍光暈
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const [blur, alpha] of [[14, 0.85], [6, 0.95], [6, 0.95]]) {
        ctx.shadowBlur = blur * dpr;
        ctx.globalAlpha = alpha;
        for (const h of projected) {
          const col = showAll ? '#38bdf8' : h.color;
          ctx.shadowColor = col;
          ctx.fillStyle = col;
          trace(ctx, h.pts);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // 挖空岩點與大型量體內部，只保留外圍柔和光暈、讓真實岩點保持清晰可見
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    for (const h of projected) {
      trace(ctx, h.pts);
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  // 除錯外框模式（預設關閉）
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const h of projected) {
    trace(ctx, h.pts);
    if (showAll) {
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      ctx.fillStyle = h.color + '26';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.strokeStyle = h.color;
      ctx.lineWidth = 2.8;
      ctx.stroke();

      if (h.role === 's' || h.role === 't') {
        let cx = 0, cy = 0;
        for (const [x, y] of h.pts) { cx += x; cy += y; }
        cx /= h.pts.length;
        cy /= h.pts.length;
        const badge = h.role === 's' ? 'S' : 'T';
        ctx.fillStyle = h.color;
        ctx.beginPath();
        ctx.arc(cx, cy, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#090d12';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(badge, cx, cy + 0.5);
      }
    }
  }
}

async function main() {
  const params = new URLSearchParams(location.search);
  const autoStart = params.get('auto') === '1';
  const paramWall = params.get('wall');
  const urlRouteMap = G.parseRouteParam(params.get('route'));
  if (autoStart) {
    document.documentElement.dataset.auto = '1';
    document.body.dataset.auto = '1';
  }

  let parentWallResolve = null;
  const parentWallPromise = new Promise((resolve) => { parentWallResolve = resolve; });
  let parentWallData = null;
  window.addEventListener('message', (ev) => {
    if (ev.origin !== location.origin || ev.source !== window.parent) return;
    if (ev.data?.type === 'climbio-wall2d-data' && !parentWallData) {
      parentWallData = ev.data;
      parentWallResolve?.(ev.data);
    }
  });

  const wallsById = new Map();
  let defaultWallId = 'wanhua';
  let pendingBuild = null;
  let buildingCamera = false;

  const log = new TrackingLog2d({
    build: null,
    manifest: {
      walls: [],
      loadMs: 0,
    },
    device: {
      userAgent: navigator.userAgent,
      language: navigator.language,
      screen: [innerWidth, innerHeight],
      devicePixelRatio,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    },
    storage: localStorage,
  });

  const stage = $('stage');
  const video = $('live-video');
  const preview = $('live-preview');
  const previewCtx = preview.getContext('2d', { alpha: false });
  const overlay = $('overlay-canvas');
  const overlayCtx = overlay.getContext('2d');
  const capture = document.createElement('canvas');
  const captureCtx = capture.getContext('2d', { willReadFrequently: true });

  // 模擬器畫布（僅在「模擬測試」或載入測試照片／影片時作為替代訊號源，不影響正常相機模式）
  const simCanvas = document.createElement('canvas');
  const simCtx = simCanvas.getContext('2d');
  let simSource = null; // { kind: 'sweep'|'photo'|'video', bmp?, videoEl?, step, startedAt, gtH }
  let simBitmapPromise = null;

  let targetWallId = paramWall || 'auto';
  let selectedRouteId = '';
  let showOutlines = false;
  let running = false;
  let sourceKind = 'camera'; // 'camera' | 'sim' | 'media'
  let ready = false;
  let busy = false;
  let worker = null;
  let reanchorWorker = null;
  let reanchorWorkerReady = false;
  let reanchorBusy = false;
  let lastReanchorFrame = -Infinity;
  let pendingReanchorCopy = null;
  let stream = null;
  let generation = 0;
  let trackingEpoch = 0;
  let pose = null;
  let poseAt = 0;
  let poseHistory = [];
  let pendingSync = null;
  let lastSyncedFrameId = -1;
  let overlayDirty = false;
  let lastSent = 0;
  let lastTick = performance.now();
  let lastInputFrame = null;
  let lastPreviewFrame = null;
  let frameClock = null;
  let videoCallback = null;
  let videoFrames = 0;
  let frames = 0;
  let errors = 0;
  let requestedAspect = null;
  let shapeBusy = false;
  let selectedCamera = '';
  let autoCameraId = '';
  let cameraDevices = [];
  const cameraProfiles = new Map();
  const snapPool = [document.createElement('canvas'), document.createElement('canvas')];
  let snapIdx = 0;
  let useVideoFrame = typeof VideoFrame === 'function';
  let procEma = 0;
  let prewarm = null;
  const runtimeUrl = new URL('../../redpoint/vendor/opencv-4.10.0.js', location.href).href;
  const timingMarks = {
    bootAt: window.__wall2dBootAt || null,
    startAt: null,
    gumCallAt: window.__wall2dGumCallAt || null,
    gumResolveAt: window.__wall2dGumResolveAt || null,
    firstPreviewAt: null,
    workerStartAt: null,
    workerReadyAt: null,
    firstPoseAt: null,
  };

  function populateWallSelect() {
    const sel = $('wall-select');
    sel.replaceChildren(new Option('自動認牆（全部）', 'auto'));
    for (const w of wallsById.values()) {
      sel.add(new Option(w.name, w.wallId));
    }
    sel.value = targetWallId;
  }

  function populateRouteSelect(wallId) {
    const sel = $('route-select');
    if (urlRouteMap.size) {
      sel.replaceChildren(new Option(`指定路線（${urlRouteMap.size} 顆）`, '__url__'));
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    const wall = wallsById.get(wallId) || wallsById.get(defaultWallId);
    sel.replaceChildren();
    if (wall) {
      for (const r of wall.routes) {
        const count = Object.keys(r.holds).length;
        const label = [r.grade, r.name || '路線'].filter(Boolean).join(' ') + `（${count} 顆）`;
        sel.add(new Option(label, r.id));
      }
      sel.add(new Option(`全部岩點（${wall.holds.length} 顆）`, '__all__'));
      if (!selectedRouteId || (!wall.routes.some((r) => r.id === selectedRouteId) && selectedRouteId !== '__all__')) {
        selectedRouteId = wall.routes[0]?.id || '__all__';
      }
      sel.value = selectedRouteId;
    }
  }

  populateWallSelect();
  populateRouteSelect(paramWall || defaultWallId);

  function syncUi() {
    document.body.dataset.running = String(running);
    $('camera-toggle').textContent = running && sourceKind === 'camera' ? '關閉相機' : '開啟相機';
    $('sim-toggle').textContent = running && sourceKind !== 'camera' ? '停止模擬' : '模擬測試';
    $('mark-drift').disabled = !running;
    $('mark-loss').disabled = !running;
  }

  function stop(statusText = '已停止') {
    generation++;
    if (videoCallback !== null && video.cancelVideoFrameCallback) {
      video.cancelVideoFrameCallback(videoCallback);
    }
    videoCallback = null;
    frameClock = null;
    lastInputFrame = null;
    lastPreviewFrame = null;
    pendingSync = null;
    dropReanchorCopy();
    poseHistory = [];
    procEma = 0;
    lastSyncedFrameId = -1;
    overlayDirty = false;
    running = false;
    ready = false;
    busy = false;
    reanchorWorkerReady = false;
    reanchorBusy = false;
    lastReanchorFrame = -Infinity;
    buildingCamera = false;
    pose = null;
    for (const w of wallsById.values()) {
      w._inWorker = false;
      w._inReanchorWorker = false;
    }
    document.body.dataset.located = 'false';
    worker?.terminate();
    worker = null;
    reanchorWorker?.terminate();
    reanchorWorker = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    video.pause();
    video.srcObject = null;
    if (simSource?.videoEl) {
      simSource.videoEl.pause();
      simSource.videoEl.src = '';
    }
    simSource = null;
    overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
    previewCtx.clearRect(0, 0, preview.width, preview.height);
    log.end();
    setStatus(statusText);
    $('camera-toggle').disabled = false;
    $('sim-toggle').disabled = false;
    $('pick-media-btn').disabled = false;
    $('camera-device').disabled = false;
    syncUi();
  }

  function ensureStageCanvasSize() {
    const rect = stage.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const pw = Math.max(1, Math.round(rect.width * dpr));
    const ph = Math.max(1, Math.round(rect.height * dpr));
    if (preview.width !== pw || preview.height !== ph) {
      preview.width = pw;
      preview.height = ph;
      overlay.width = pw;
      overlay.height = ph;
      lastPreviewFrame = null;
      overlayDirty = true;
    }
    return { rect, dpr, pw, ph };
  }

  function recordFirstPreview() {
    if (timingMarks.firstPreviewAt !== null) return;
    timingMarks.firstPreviewAt = absNow();
    log.firstPreview();
    if (timingMarks.startAt !== null) {
      log.setTimings({
        bootToGumCallMs: timingMarks.bootAt && timingMarks.gumCallAt ? Math.round(timingMarks.gumCallAt - timingMarks.bootAt) : null,
        gumDurationMs: timingMarks.gumCallAt && timingMarks.gumResolveAt ? Math.round(timingMarks.gumResolveAt - timingMarks.gumCallAt) : null,
        gumToFirstPreviewMs: timingMarks.gumResolveAt ? Math.round(timingMarks.firstPreviewAt - timingMarks.gumResolveAt) : null,
        startToFirstPreviewMs: Math.round(timingMarks.firstPreviewAt - timingMarks.startAt),
      });
    }
  }

  function drawPreviewSurface(sourceEl, srcW, srcH, frameKey) {
    if (!sourceEl || !srcW || !srcH) return false;
    if (frameKey && frameKey === lastPreviewFrame) return false;
    const { pw, ph } = ensureStageCanvasSize();
    lastPreviewFrame = frameKey;
    const vp = cameraViewport(pw, ph, srcW, srcH);
    previewCtx.drawImage(sourceEl, vp.x, vp.y, vp.width, vp.height);
    recordFirstPreview();
    return true;
  }

  function renderCurrentOverlay(poseToDraw, now) {
    const { rect, dpr } = ensureStageCanvasSize();
    const fresh = running && !!poseToDraw && (now - poseAt <= STALE_MS);
    if (document.body.dataset.located !== String(fresh)) {
      document.body.dataset.located = String(fresh);
    }
    if (fresh) {
      const matchedWall = wallsById.get(poseToDraw.wallId);
      drawHoldOverlays(overlayCtx, rect.width, rect.height, dpr, poseToDraw, matchedWall, selectedRouteId, urlRouteMap, showOutlines);
      overlayDirty = false;
      return true;
    }
    if (overlay.width && overlay.height) {
      overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
      overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
    }
    overlayDirty = false;
    return false;
  }

  function compensatedPose(now) {
    if (!pose || poseHistory.length < 2) return pose;
    const curr = poseHistory[poseHistory.length - 1];
    const prev = poseHistory[poseHistory.length - 2];
    if (!curr || !prev || curr.pose.wallId !== prev.pose.wallId) return pose;
    const dt = curr.at - prev.at;
    const elapsed = now - curr.at;
    if (dt < 8 || dt > 120 || elapsed <= 0 || elapsed > 120) return pose;
    const alpha = Math.min(1.2, elapsed / dt);
    const Hpred = G.extrapolateHomography(prev.pose.H, curr.pose.H, alpha, curr.pose.width, curr.pose.height);
    return Hpred ? { ...curr.pose, H: Hpred } : pose;
  }

  // 把一個影格交給 Worker。相機畫面優先用 VideoFrame（轉移給 Worker，Worker 直接取 Y 平面當灰階），
  // 不用 canvas 的 drawImage＋getImageData：低階 Android 在主執行緒讀回一次約 65 ms，預覽和疊圖都會被拖慢。
  // 不支援、影格有旋轉或 Worker 讀不出來時改回 canvas 擷取。wantReanchor 時另外留一份給重錨 Worker
  function captureForWorker(sourceEl, srcW, srcH, wantReanchor) {
    const scale = Math.min(1, CAPTURE_LONG_SIDE / Math.max(srcW, srcH));
    const capW = Math.max(1, Math.round(srcW * scale));
    const capH = Math.max(1, Math.round(srcH * scale));
    if (useVideoFrame && sourceEl === video) {
      let frame = null;
      try {
        frame = new VideoFrame(video);
      } catch {
        useVideoFrame = false;
      }
      if (frame) {
        if ((frame.rotation || 0) !== 0 || frame.flip || frame.displayWidth !== srcW || frame.displayHeight !== srcH) {
          frame.close();
          useVideoFrame = false;
        } else {
          return {
            msg: { frame, capW, capH },
            transfer: [frame],
            reanchor: wantReanchor ? { frame: frame.clone(), capW, capH } : null,
          };
        }
      }
    }
    if (capture.width !== capW || capture.height !== capH) {
      capture.width = capW;
      capture.height = capH;
    }
    captureCtx.drawImage(sourceEl, 0, 0, capW, capH);
    const image = captureCtx.getImageData(0, 0, capW, capH);
    return {
      msg: { image, capW, capH },
      transfer: [image.data.buffer],
      reanchor: wantReanchor ? { image: new ImageData(new Uint8ClampedArray(image.data), capW, capH), capW, capH } : null,
    };
  }

  function dropReanchorCopy() {
    pendingReanchorCopy?.frame?.close();
    pendingReanchorCopy = null;
  }

  function sendFrame(sourceEl, srcW, srcH, frameKey, now, wantReanchor) {
    const frameId = ++frames;
    let cap = captureForWorker(sourceEl, srcW, srcH, wantReanchor);
    try {
      worker.postMessage({ type: 'frame', ...cap.msg, frameId, epoch: trackingEpoch }, cap.transfer);
    } catch (err) {
      // 這個瀏覽器不能把 VideoFrame 轉移給 Worker：之後都用 canvas 擷取
      if (!cap.msg.frame) throw err;
      cap.msg.frame.close();
      cap.reanchor?.frame?.close();
      useVideoFrame = false;
      cap = captureForWorker(sourceEl, srcW, srcH, wantReanchor);
      worker.postMessage({ type: 'frame', ...cap.msg, frameId, epoch: trackingEpoch }, cap.transfer);
    }
    dropReanchorCopy();
    if (cap.reanchor) pendingReanchorCopy = { frameId, epoch: trackingEpoch, wallId: pose?.wallId, ...cap.reanchor };
    lastInputFrame = frameKey;
    busy = true;
    lastSent = now;
    return frameId;
  }

  function processSourceFrame(sourceEl, srcW, srcH, frameKey, now) {
    if (!running || !sourceEl || !srcW || !srcH) return false;
    const hasWorkerWall = Array.from(wallsById.values()).some((w) => w._inWorker);
    const isFreshTracking = !!pose && (now - poseAt <= STALE_MS);
    const canDispatch = ready && !busy && !buildingCamera && hasWorkerWall && frameKey !== lastInputFrame && (now - lastSent >= MIN_PROCESS_INTERVAL_MS);

    if (isFreshTracking && canDispatch && !pendingSync) {
      // 同幀對齊：先截下此影格並送給 Worker，單應矩陣回來後在同一時脈一起畫預覽與疊圖
      const snap = snapPool[snapIdx ^= 1];
      if (snap.width !== srcW || snap.height !== srcH) {
        snap.width = srcW;
        snap.height = srcH;
      }
      snap.getContext('2d', { alpha: false }).drawImage(sourceEl, 0, 0, srcW, srcH);
      const wantReanchor = reanchorWorkerReady && !reanchorBusy && (pose.needsAnchor || frames + 1 - lastReanchorFrame >= REANCHOR_FRAME_INTERVAL);
      const frameId = sendFrame(sourceEl, srcW, srcH, frameKey, now, wantReanchor);
      pendingSync = { frameId, epoch: trackingEpoch, canvas: snap, srcW, srcH, capturedAt: now, frameKey };
      return true;
    }

    if (!pendingSync) {
      drawPreviewSurface(sourceEl, srcW, srcH, frameKey);
      if (isFreshTracking) {
        renderCurrentOverlay(compensatedPose(now), now);
      }
    }

    if (canDispatch) sendFrame(sourceEl, srcW, srcH, frameKey, now, false);
    return false;
  }

  async function listCameras(token) {
    const devices = await navigator.mediaDevices.enumerateDevices();
    if (token !== generation) return;
    cameraDevices = devices.filter((d) => d.kind === 'videoinput');
    const sel = $('camera-device');
    sel.replaceChildren(new Option('自動選擇主鏡頭', ''), ...cameraDevices.map((d) => new Option(d.label || '相機鏡頭', d.deviceId)));
    sel.value = selectedCamera;
    sel.hidden = cameraDevices.length < 2;
  }

  function attachVideoFrameLoop(token) {
    if (videoCallback !== null && video.cancelVideoFrameCallback) {
      video.cancelVideoFrameCallback(videoCallback);
      videoCallback = null;
    }
    if (!video.requestVideoFrameCallback) return;
    const onVideoFrame = (now, meta) => {
      if (!running || token !== generation) return;
      videoFrames++;
      frameClock = {
        serial: (frameClock?.serial ?? 0) + 1,
        at: Number.isFinite(meta.presentationTime) && Math.abs(now - meta.presentationTime) < 1000 ? meta.presentationTime : now,
      };
      if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
        processSourceFrame(video, video.videoWidth, video.videoHeight, `frame:${frameClock.serial}`, performance.now());
      }
      videoCallback = video.requestVideoFrameCallback(onVideoFrame);
    };
    videoCallback = video.requestVideoFrameCallback(onVideoFrame);
  }

  async function openCamera(token) {
    const constraints = cameraConstraints(stage.clientWidth || innerWidth, stage.clientHeight || innerHeight);
    requestedAspect = constraints.aspectRatio.ideal;
    let chosenId = selectedCamera || autoCameraId;
    const profileKey = (id) => `${id}/${requestedAspect < 1 ? 'portrait' : 'landscape'}`;
    const orientation = requestedAspect < 1 ? 'portrait' : 'landscape';
    const profile = chosenId ? cameraProfiles.get(profileKey(chosenId)) : null;
    // 這支手機上次判斷過會反過來，就直接用反過來的寬高開，不用先開錯再重開（低階機重開一次約 0.8 秒）
    let corrected = profile?.reversed ?? readCamReversed()[orientation] === true;
    let usedConstraints = corrected ? reverseCameraConstraints(constraints) : constraints;

    const request = (deviceId) => {
      timingMarks.gumCallAt = absNow();
      return navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { ...usedConstraints, ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }) },
      }).then((s) => {
        timingMarks.gumResolveAt = absNow();
        return s;
      });
    };

    let opened = null;
    const early = window.__wall2dEarlyCamera;
    if (early) {
      delete window.__wall2dEarlyCamera;
      if (!chosenId && !!early.reversed === corrected) {
        const res = await early.promise;
        if (token !== generation) { res.stream?.getTracks().forEach((t) => t.stop()); return null; }
        if (res.error) throw res.error;
        timingMarks.gumResolveAt = window.__wall2dGumResolveAt || absNow();
        opened = res.stream;
      } else {
        early.promise.then((res) => res.stream?.getTracks().forEach((t) => t.stop())).catch(() => {});
      }
    }

    if (!opened) {
      // 若已授與權限且裝置清單已有標籤，直接選定主鏡頭，避免開錯鏡頭再重開一次
      if (!chosenId && navigator.mediaDevices?.enumerateDevices) {
        try {
          const devs = await Promise.race([
            navigator.mediaDevices.enumerateDevices(),
            new Promise((r) => setTimeout(() => r(null), 20)),
          ]);
          if (token !== generation) return null;
          if (devs) {
            const p = mainCamera(devs.filter((d) => d.kind === 'videoinput'));
            if (p?.deviceId) chosenId = p.deviceId;
          }
        } catch { /* ignore */ }
      }
      opened = await request(chosenId);
      if (token !== generation) { opened.getTracks().forEach((t) => t.stop()); return null; }
    }

    stream = opened;
    running = true;
    errors = 0;
    lastSent = 0;
    syncUi();

    const attachAndPlay = async (mediaStream) => {
      const track = mediaStream.getVideoTracks()[0];
      const before = track.getSettings();
      const caps = track.getCapabilities?.();
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      video.srcObject = mediaStream;
      attachVideoFrameLoop(token);
      if (caps?.zoom && caps.zoom.min <= 1 && caps.zoom.max >= 1) {
        track.applyConstraints({ ...track.getConstraints(), advanced: [{ zoom: 1 }] }).catch((err) => log.error(err));
      }
      const wait = firstCameraFrame(video);
      const startAt = performance.now();
      await Promise.all([video.play(), wait]);
      const frame = await wait;
      if (token === generation && running && timingMarks.firstPreviewAt === null && video.readyState >= 2 && video.videoWidth) {
        drawPreviewSurface(video, frame.width, frame.height, frameClock ? `frame:${frameClock.serial}` : 'first-frame');
      }
      log.event('camera_first_frame', {
        requestedSize: [usedConstraints.width.ideal, usedConstraints.height.ideal],
        beforeSettingsSize: [before.width, before.height],
        videoSize: [frame.width, frame.height],
        waitMs: Math.round(performance.now() - startAt),
      });
      return frame;
    };

    let frame = await attachAndPlay(opened);
    if (token !== generation) { opened.getTracks().forEach((t) => t.stop()); return null; }

    if (reversedCameraFrame(constraints, frame.width, frame.height)) {
      const deviceId = chosenId || opened.getVideoTracks()[0].getSettings().deviceId;
      opened.getTracks().forEach((t) => t.stop());
      video.pause();
      video.srcObject = null;
      corrected = !corrected;
      usedConstraints = corrected ? reverseCameraConstraints(constraints) : constraints;
      opened = await request(deviceId);
      if (token !== generation) { opened.getTracks().forEach((t) => t.stop()); return null; }
      stream = opened;
      frame = await attachAndPlay(opened);
      if (token !== generation) { opened.getTracks().forEach((t) => t.stop()); return null; }
      if (reversedCameraFrame(constraints, frame.width, frame.height)) {
        const error = new Error('相機輸出的方向不正確，請重新開啟相機。');
        error.name = 'CameraOrientationError';
        throw error;
      }
    }

    const active = opened.getVideoTracks()[0].getSettings().deviceId;
    if (!selectedCamera && active) autoCameraId = active;
    if (active) cameraProfiles.set(profileKey(active), { reversed: corrected });
    saveCamReversed(orientation, corrected);
    $('camera-device').value = chosenId || active || '';

    // 背景列舉鏡頭；若目前不是主鏡頭再無縫切換，不阻塞首幀顯示
    listCameras(token).then(async () => {
      if (token !== generation || !running || chosenId) return;
      const primary = mainCamera(cameraDevices);
      if (primary && primary.deviceId !== active) {
        const switched = await request(primary.deviceId);
        if (token !== generation || !running) { switched.getTracks().forEach((t) => t.stop()); return; }
        opened.getTracks().forEach((t) => t.stop());
        stream = switched;
        autoCameraId = primary.deviceId;
        $('camera-device').value = primary.deviceId;
        await attachAndPlay(switched);
      }
    }).catch((err) => log.error(err));

    const settings = opened.getVideoTracks()[0].getSettings();
    log.event('camera_view', {
      requestedAspectRatio: requestedAspect,
      requestedSize: [usedConstraints.width.ideal, usedConstraints.height.ideal],
      actualSize: [settings.width, settings.height],
      videoSize: [frame.width, frame.height],
      coordinateCorrection: corrected,
    });
    return opened;
  }

  function syncWallsToWorker() {
    if (reanchorWorker && reanchorWorkerReady) {
      for (const w of wallsById.values()) {
        if (w.camera && !w._inReanchorWorker) {
          w._inReanchorWorker = true;
          reanchorWorker.postMessage({
            type: 'add_wall',
            wall: { wallId: w.wallId, name: w.name, camera: w.camera },
          });
        }
      }
    }
    if (!worker || !ready) return;
    for (const w of wallsById.values()) {
      if (w.camera && !w._inWorker) {
        w._inWorker = true;
        worker.postMessage({
          type: 'add_wall',
          wall: { wallId: w.wallId, name: w.name, camera: w.camera },
        });
      }
    }
    if (pendingBuild && !buildingCamera) {
      const b = pendingBuild;
      pendingBuild = null;
      buildingCamera = true;
      worker.postMessage({
        type: 'build_camera',
        id: b.wallId,
        wallId: b.wallId,
        name: b.name,
        gray: b.gray,
        width: b.width,
        height: b.height,
        fullWidth: b.fullWidth,
        fullHeight: b.fullHeight,
        register: true,
        _meta: { photoSize: b.photoSize, updatedAt: b.updatedAt },
      }, [b.gray.buffer]);
      // 注意：_meta 不包含二進位資料，保留給 camera_built 快取使用
      pendingBuildMeta = { wallId: b.wallId, w: b.fullWidth, h: b.fullHeight, photoSize: b.photoSize, updatedAt: b.updatedAt };
    }
  }
  let pendingBuildMeta = null;

  function startReanchorWorker(token) {
    if (reanchorWorker || token !== generation || !running) return;
    reanchorWorker = new Worker(new URL('./wall2d-worker.js', import.meta.url));
    reanchorWorker.onmessage = ({ data }) => {
      if (token !== generation || !running) return;
      if (data.type === 'ready') {
        reanchorWorkerReady = true;
        syncWallsToWorker();
        worker?.postMessage({ type: 'set_bg_reanchor', enabled: true });
        return;
      }
      if (data.type === 'reanchor_result') {
        reanchorBusy = false;
        if (!data.matched || data.epoch !== trackingEpoch || data.inliers < 20 || data.medianError > 3.5) return;
        const flowInv = G.invert3x3(data.flowH);
        if (!flowInv) return;
        const w = wallsById.get(data.wallId);
        if (!w) return;
        const delta = G.homographyCornerDelta(data.flowH, data.H, w.photoW, w.photoH, CAPTURE_LONG_SIDE, CAPTURE_LONG_SIDE);
        if (delta !== null && delta > 30) return;
        const C = G.mul3x3(flowInv, data.H);
        worker?.postMessage({ type: 'apply_anchor', epoch: data.epoch, wallId: data.wallId, C });
      }
    };
    reanchorWorker.onerror = () => {
      reanchorWorkerReady = false;
      reanchorBusy = false;
      worker?.postMessage({ type: 'set_bg_reanchor', enabled: false });
    };
    const initWalls = [];
    for (const w of wallsById.values()) {
      if (w.camera) {
        w._inReanchorWorker = true;
        initWalls.push({ wallId: w.wallId, name: w.name, camera: w.camera });
      }
    }
    reanchorWorker.postMessage({
      type: 'init',
      runtimeUrl,
      targetWall: 'auto',
      walls: initWalls,
    });
  }

  // 相機看線一打開就先載入 OpenCV（約 1 秒），跟開相機同時進行；相機好了 startWorker 直接接手
  function prewarmWorker() {
    if (prewarm || worker) return;
    const w = new Worker(new URL('./wall2d-worker.js', import.meta.url));
    const p = { worker: w, ready: false, failed: false, startAt: absNow() };
    w.onmessage = ({ data }) => { if (data.type === 'ready') p.ready = true; };
    w.onerror = () => { p.failed = true; };
    w.postMessage({ type: 'init', runtimeUrl, targetWall: targetWallId, walls: [], bgReanchor: false });
    prewarm = p;
  }

  function startWorker(token) {
    let pre = prewarm;
    prewarm = null;
    if (pre?.failed) {
      pre.worker.terminate();
      pre = null;
    }
    timingMarks.workerStartAt = pre ? pre.startAt : absNow();
    worker = pre ? pre.worker : new Worker(new URL('./wall2d-worker.js', import.meta.url));
    const onWorkerMessage = ({ data }) => {
      if (token !== generation) return;
      if (data.type === 'ready') {
        ready = true;
        timingMarks.workerReadyAt = absNow();
        log.ready();
        syncWallsToWorker();
        setStatus('尋找牆面…');
        return;
      }
      if (data.type === 'wall_added') {
        return;
      }
      if (data.type === 'camera_built') {
        buildingCamera = false;
        const w = wallsById.get(data.id);
        if (w) {
          w.camera = data.camera;
          w._inWorker = true;
          if (reanchorWorker && reanchorWorkerReady && !w._inReanchorWorker) {
            w._inReanchorWorker = true;
            reanchorWorker.postMessage({
              type: 'add_wall',
              wall: { wallId: w.wallId, name: w.name, camera: w.camera },
            });
          }
          const m = pendingBuildMeta;
          if (m && m.wallId === data.id) {
            putCachedCamera(m.wallId, m.w, m.h, m.photoSize, m.updatedAt, data.camera);
            pendingBuildMeta = null;
          }
        }
        return;
      }
      busy = false;
      if (data.type === 'frame_error') {
        // Worker 讀不出 VideoFrame：之後改用 canvas 擷取，這一幀放掉
        useVideoFrame = false;
        pendingSync = null;
        dropReanchorCopy();
        log.event('video_frame_fallback', { error: data.error });
        return;
      }
      if (data.type === 'error') {
        buildingCamera = false;
        pendingSync = null;
        dropReanchorCopy();
        log.error(data.error);
        pose = null;
        poseHistory = [];
        if (!ready || ++errors >= 3) {
          document.body.dataset.error = 'true';
          stop('追蹤程式執行失敗');
        }
        return;
      }
      if (data.type === 'pose') {
        if (data.epoch !== trackingEpoch) {
          if (pendingSync && pendingSync.epoch !== data.epoch) pendingSync = null;
          dropReanchorCopy();
          return;
        }
        fpsProcessed++;
        errors = 0;
        const prevPose = pose;
        let cornerDeltaPx = null;
        if (data.pose && prevPose && prevPose.wallId === data.pose.wallId) {
          cornerDeltaPx = G.homographyCornerDelta(
            prevPose.H, data.pose.H,
            data.pose.photoW, data.pose.photoH,
            data.pose.width, data.pose.height
          );
        }
        pose = data.pose;
        poseAt = lastSent;
        const now = performance.now();
        const latency = now - lastSent;
        if (pose) {
          if (timingMarks.firstPoseAt === null) {
            timingMarks.firstPoseAt = absNow();
            if (timingMarks.startAt !== null) {
              log.setTimings({
                startToReadyMs: timingMarks.workerReadyAt ? Math.round(timingMarks.workerReadyAt - timingMarks.startAt) : null,
                startToFirstPoseMs: Math.round(timingMarks.firstPoseAt - timingMarks.startAt),
              });
            }
          }
          if (!poseHistory.length || poseHistory[poseHistory.length - 1].pose.wallId !== pose.wallId) {
            poseHistory = [{ pose, at: lastSent, frameId: data.frameId }];
          } else {
            poseHistory.push({ pose, at: lastSent, frameId: data.frameId });
            if (poseHistory.length > 2) poseHistory.shift();
          }
          if (!reanchorWorker) startReanchorWorker(token);
          if (pendingReanchorCopy && pendingReanchorCopy.frameId === data.frameId && reanchorWorker && reanchorWorkerReady && !reanchorBusy && (pose.needsAnchor || data.frameId - lastReanchorFrame >= REANCHOR_FRAME_INTERVAL)) {
            reanchorBusy = true;
            lastReanchorFrame = data.frameId;
            const c = pendingReanchorCopy;
            pendingReanchorCopy = null;
            reanchorWorker.postMessage({
              type: 'reanchor_frame',
              image: c.image,
              frame: c.frame,
              capW: c.capW,
              capH: c.capH,
              wallId: pose.wallId,
              frameId: data.frameId,
              epoch: data.epoch,
              flowH: pose.H,
            }, c.frame ? [c.frame] : [c.image.data.buffer]);
          }
        } else {
          poseHistory = [];
        }
        dropReanchorCopy();
        if (data.mode === 'tracking' && Number.isFinite(data.processingMs)) {
          procEma = procEma ? procEma * 0.8 + data.processingMs * 0.2 : data.processingMs;
        }

        if (pendingSync && pendingSync.frameId === data.frameId && pendingSync.epoch === data.epoch) {
          // 同一幀的影像與單應矩陣在同一繪製時脈落地，消除移動延遲
          drawPreviewSurface(pendingSync.canvas, pendingSync.srcW, pendingSync.srcH, pendingSync.frameKey);
          pendingSync = null;
          lastSyncedFrameId = data.frameId;
          renderCurrentOverlay(pose, now);
        } else {
          // 預覽已經放行、畫面是比這個結果更新的影格：照移動速度外推到現在再畫，不畫回舊位置
          if (pendingSync && pendingSync.epoch !== data.epoch) pendingSync = null;
          renderCurrentOverlay(compensatedPose(now), now);
        }

        log.frame({
          pose,
          mode: data.mode,
          latency,
          processingMs: data.processingMs,
          cornerDeltaPx,
          diagnostics: data.diagnostics,
        });
        if (pose) {
          if (targetWallId === 'auto' && $('route-select').dataset.lastWall !== pose.wallId) {
            $('route-select').dataset.lastWall = pose.wallId;
            populateRouteSelect(pose.wallId);
          }
          setStatus(`${data.mode === 'tracking' ? '追蹤中' : '已定位'} · ${pose.wallName}`);
          $('latency').textContent = `${Math.round(latency)} ms`;
          $('inliers').textContent = `${pose.inliers} 點 / ${pose.medianError.toFixed(1)} px`;
        } else {
          setStatus('尋找牆面…');
          $('latency').textContent = '—';
          $('inliers').textContent = '—';
        }
      }
    };
    worker.onmessage = onWorkerMessage;
    worker.onerror = (e) => {
      buildingCamera = false;
      log.error(e.message);
      document.body.dataset.error = 'true';
      stop('追蹤程式載入失敗');
    };
    if (pre) {
      // 預先載入的 Worker 沒有牆面：ready 後由 syncWallsToWorker 補進去
      if (pre.ready) onWorkerMessage({ data: { type: 'ready' } });
      return;
    }
    const initWalls = [];
    for (const w of wallsById.values()) {
      if (w.camera) {
        w._inWorker = true;
        initWalls.push({ wallId: w.wallId, name: w.name, camera: w.camera });
      }
    }
    worker.postMessage({
      type: 'init',
      runtimeUrl,
      targetWall: targetWallId,
      walls: initWalls,
      bgReanchor: false,
    });
  }

  async function startCamera() {
    if (running && sourceKind === 'camera') { stop('相機已關閉'); return; }
    if (running) stop();
    if (!navigator.mediaDevices?.getUserMedia) {
      document.body.dataset.error = 'true';
      setStatus('相機需要 HTTPS');
      return;
    }
    delete document.body.dataset.error;
    const token = ++generation;
    sourceKind = 'camera';
    timingMarks.startAt = timingMarks.bootAt || absNow();
    timingMarks.bootAt = null;
    timingMarks.firstPreviewAt = null;
    timingMarks.workerStartAt = null;
    timingMarks.workerReadyAt = null;
    timingMarks.firstPoseAt = null;
    setTools(false);
    $('camera-toggle').disabled = true;
    $('sim-toggle').disabled = true;
    $('camera-device').disabled = true;
    setStatus('請允許後置相機');
    log.begin(targetWallId, 'camera');
    try {
      const opened = await openCamera(token);
      if (!opened) return;
      stream = opened;
      const track = stream.getVideoTracks()[0];
      log.stream(track.getSettings());
      track.addEventListener('ended', () => { if (token === generation && running) stop('相機中斷'); });
      for (const kind of ['mute', 'unmute']) {
        track.addEventListener(kind, () => { if (token === generation) log.event(`camera_${kind}`, { muted: track.muted }); });
      }
      setStatus('載入 OpenCV 追蹤程式…');
      syncUi();
      $('camera-toggle').disabled = false;
      $('sim-toggle').disabled = false;
      $('camera-device').disabled = false;
      startWorker(token);
    } catch (err) {
      if (token !== generation) return;
      delete document.documentElement.dataset.auto;
      delete document.body.dataset.auto;
      document.body.dataset.error = 'true';
      log.error(err);
      stop(err.name === 'NotAllowedError' ? '相機權限未開啟' : err.name === 'CameraOrientationError' ? err.message : '無法開啟相機');
    }
  }

  async function loadSimBitmap() {
    if (!simBitmapPromise) {
      simBitmapPromise = fetch('../../demo/wanhua-wall.jpg')
        .then((r) => r.blob())
        .then((b) => createImageBitmap(b));
    }
    return simBitmapPromise;
  }

  async function startSimulation(customSource = null) {
    if (running && sourceKind !== 'camera' && !customSource) { stop('模擬已停止'); return; }
    if (running) stop();
    const token = ++generation;
    sourceKind = customSource ? 'media' : 'sim';
    running = true;
    errors = 0;
    lastSent = 0;
    setStatus('載入模擬影像與 OpenCV…');
    syncUi();
    log.begin(targetWallId, sourceKind);

    if (customSource) {
      simSource = customSource;
    } else {
      const bmp = await loadSimBitmap();
      if (token !== generation) return;
      simCanvas.width = 640;
      simCanvas.height = 480;
      simSource = { kind: 'sweep', bmp, startedAt: performance.now(), step: 0, occluded: false };
    }
    log.stream({ width: simCanvas.width, height: simCanvas.height, frameRate: 30, facingMode: 'simulation' });
    startWorker(token);
  }

  function drawSimFrame(now) {
    if (!simSource) return null;
    if (simSource.kind === 'photo') {
      const bmp = simSource.bmp;
      const scale = Math.min(1, 640 / Math.max(bmp.width, bmp.height));
      const w = Math.round(bmp.width * scale);
      const h = Math.round(bmp.height * scale);
      if (simCanvas.width !== w || simCanvas.height !== h) { simCanvas.width = w; simCanvas.height = h; }
      simCtx.drawImage(bmp, 0, 0, w, h);
      return { width: w, height: h, key: `photo:${simSource.id}:${Math.floor(now / 120)}` };
    }
    if (simSource.kind === 'video') {
      const v = simSource.videoEl;
      if (v.readyState < 2 || !v.videoWidth) return null;
      const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
      const w = Math.round(v.videoWidth * scale);
      const h = Math.round(v.videoHeight * scale);
      if (simCanvas.width !== w || simCanvas.height !== h) { simCanvas.width = w; simCanvas.height = h; }
      simCtx.drawImage(v, 0, 0, w, h);
      return { width: w, height: h, key: `vid:${v.currentTime.toFixed(3)}` };
    }
    // 合成平移＋縮放＋遮擋測試序列（9 秒週期：0-5.5s 掃視，5.5-7s 全遮擋掉追蹤，7-9s 恢復重定位）
    const w = simCanvas.width, h = simCanvas.height;
    const bmp = simSource.bmp;
    const tSec = ((now - simSource.startedAt) / 1000) % 9;
    simSource.step++;
    simCtx.fillStyle = '#181c22';
    simCtx.fillRect(0, 0, w, h);
    if (tSec >= 5.5 && tSec < 7.0) {
      simSource.occluded = true;
      // 模擬整個人站在鏡頭前遮住牆面
      simCtx.fillStyle = '#22262e';
      simCtx.fillRect(w * 0.05, h * 0.05, w * 0.9, h * 0.95);
    } else {
      simSource.occluded = false;
      const phase = tSec < 5.5 ? tSec / 5.5 : 0.35;
      const zoom = 1.08 + 0.18 * Math.sin(phase * Math.PI);
      const panX = (phase - 0.5) * w * 0.22;
      const panY = Math.sin(phase * Math.PI * 2) * h * 0.06;
      const drawW = w * zoom;
      const drawH = (bmp.height / bmp.width) * drawW;
      const dx = (w - drawW) / 2 - panX;
      const dy = (h - drawH) / 2 - panY;
      simCtx.drawImage(bmp, dx, dy, drawW, drawH);
    }
    return { width: w, height: h, key: `sim:${simSource.step}` };
  }

  async function adjustCamera() {
    if (!running || sourceKind !== 'camera' || shapeBusy || requestedAspect === null) return;
    const shape = cameraConstraints(stage.clientWidth, stage.clientHeight);
    if ((shape.aspectRatio.ideal >= 1) === (requestedAspect >= 1)) return;
    shapeBusy = true;
    log.event('camera_orientation_changed');
    stop();
    try { await startCamera(); } finally { shapeBusy = false; }
  }

  new ResizeObserver(() => {
    adjustCamera().catch((err) => log.error(err));
  }).observe(stage);

  let fpsAt = performance.now();
  let fpsFrames = 0;
  let fpsProcessed = 0;

  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(1000, now - lastTick);
    lastTick = now;

    ensureStageCanvasSize();

    let sourceEl = null;
    let srcW = 0;
    let srcH = 0;
    let frameKey = null;

    if (running) {
      const syncHold = procEma ? Math.min(SYNC_HOLD_MAX_MS, Math.max(SYNC_HOLD_MS, procEma * 1.25 + 6)) : SYNC_HOLD_MS;
      if (pendingSync && now - pendingSync.capturedAt > syncHold) {
        drawPreviewSurface(pendingSync.canvas, pendingSync.srcW, pendingSync.srcH, pendingSync.frameKey);
        pendingSync = null;
        overlayDirty = true;
      }

      if (sourceKind === 'camera') {
        if (!video.requestVideoFrameCallback && video.readyState >= 2 && video.videoWidth && video.videoHeight) {
          sourceEl = video;
          srcW = video.videoWidth;
          srcH = video.videoHeight;
          frameKey = `time:${video.currentTime}`;
          processSourceFrame(sourceEl, srcW, srcH, frameKey, now);
        } else if (video.readyState >= 2 && video.videoWidth) {
          sourceEl = video;
        }
      } else if (simSource) {
        const info = drawSimFrame(now);
        if (info) {
          sourceEl = simCanvas;
          srcW = info.width;
          srcH = info.height;
          frameKey = info.key;
          videoFrames++;
          processSourceFrame(sourceEl, srcW, srcH, frameKey, now);
        }
      }
    }

    const fresh = running && !!pose && now - poseAt <= STALE_MS;
    if (!fresh && (document.body.dataset.located === 'true' || overlayDirty)) {
      renderCurrentOverlay(null, now);
    } else if (fresh && (overlayDirty || (pendingSync === null && lastSyncedFrameId !== frames && sourceKind === 'camera' && !video.requestVideoFrameCallback))) {
      renderCurrentOverlay(compensatedPose(now), now);
    }

    if (running) {
      log.tick({ dt, rendered: fresh, visible: fresh, videoFrames });
      videoFrames = 0;
    }

    if (fresh || (running && sourceEl)) fpsFrames++;
    if (now - fpsAt >= 1000) {
      const sec = (now - fpsAt) / 1000;
      $('fps').textContent = running ? `${Math.round(fpsFrames / sec)} FPS` : '—';
      $('hz').textContent = running ? `${(fpsProcessed / sec).toFixed(1)} Hz` : '—';
      fpsAt = now;
      fpsFrames = 0;
      fpsProcessed = 0;
    }
  }

  $('tools-toggle').onclick = () => setTools(document.body.dataset.tools !== 'open');
  $('camera-toggle').onclick = () => startCamera();
  $('sim-toggle').onclick = () => startSimulation();
  $('outline-toggle').onclick = () => {
    showOutlines = !showOutlines;
    $('outline-toggle').setAttribute('aria-pressed', String(showOutlines));
    overlayDirty = true;
    renderCurrentOverlay(pose, performance.now());
  };
  $('camera-device').onchange = () => {
    selectedCamera = $('camera-device').value;
    if (running && sourceKind === 'camera') { stop(); startCamera(); }
  };
  $('wall-select').onchange = () => {
    targetWallId = $('wall-select').value;
    populateRouteSelect(targetWallId === 'auto' ? defaultWallId : targetWallId);
    trackingEpoch++;
    pose = null;
    poseHistory = [];
    pendingSync = null;
    overlayDirty = true;
    worker?.postMessage({ type: 'set_target', targetWall: targetWallId });
    log.variant(targetWallId);
  };
  $('route-select').onchange = () => {
    selectedRouteId = $('route-select').value;
    overlayDirty = true;
    renderCurrentOverlay(pose, performance.now());
  };
  $('pick-media-btn').onclick = () => $('pick-media-input').click();
  $('pick-media-input').onchange = async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    if (file.type.startsWith('video/')) {
      const v = document.createElement('video');
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.src = URL.createObjectURL(file);
      await v.play();
      await startSimulation({ kind: 'video', videoEl: v });
    } else {
      const bmp = await createImageBitmap(file);
      await startSimulation({ kind: 'photo', bmp, id: Date.now() });
    }
  };
  for (const [id, kind] of [['mark-drift', 'drift'], ['mark-loss', 'missing_outline']]) {
    $(id).onclick = () => {
      log.mark(kind);
      setNotice('已記錄問題時間點');
    };
  }
  $('copy-log').onclick = async () => {
    const text = log.text();
    log.persist();
    try {
      await navigator.clipboard.writeText(text);
      setNotice('紀錄已複製，可貼到對話');
    } catch {
      $('log-text').value = text;
      $('log-dialog').showModal();
      $('log-text').select();
    }
  };
  $('close-log').onclick = () => $('log-dialog').close();
  $('download-log').onclick = () => {
    const url = URL.createObjectURL(new Blob([log.text()], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'climbio-2d-tracking.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  window.addEventListener('error', (e) => log.error(e.message));
  window.addEventListener('unhandledrejection', (e) => log.error(e.reason));
  window.addEventListener('pagehide', () => { stop(); log.persist(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && running) stop(); });

  window.wall2dTest = {
    get state() {
      return {
        running,
        ready,
        sourceKind,
        targetWallId,
        selectedRouteId,
        showOutlines,
        overlayStyle: showOutlines ? 'outline' : 'glow',
        located: !!pose && performance.now() - poseAt <= STALE_MS,
        pose: pose ? structuredClone(pose) : null,
        frames,
        wallCount: wallsById.size,
        urlRouteCount: urlRouteMap.size,
        cameraReady: Array.from(wallsById.values()).some((w) => !!w.camera),
        videoFrame: useVideoFrame,
        syncHoldMs: procEma ? Math.min(SYNC_HOLD_MAX_MS, Math.max(SYNC_HOLD_MS, procEma * 1.25 + 6)) : SYNC_HOLD_MS,
        timings: { ...timingMarks },
      };
    },
    setShowOutlines: (on) => {
      showOutlines = !!on;
      $('outline-toggle').setAttribute('aria-pressed', String(showOutlines));
      overlayDirty = true;
      renderCurrentOverlay(pose, performance.now());
    },
    startSimulation: () => startSimulation(),
    stop: () => stop('已停止'),
    report: () => log.report(),
  };

  async function loadWalls() {
    const wallLoadStart = performance.now();
    const manifest = await getJson('./manifest.json');
    defaultWallId = manifest.defaultWall || 'wanhua';
    log.data.build = manifest.build;

    const entries = paramWall ? manifest.walls.filter((e) => e.wall === paramWall) : manifest.walls;
    if (entries.length) {
      await Promise.all(
        entries.map(async (entry) => {
          const [camera, rawWall, rawRoutes] = await Promise.all([
            getJson(entry.camera.url),
            getJson(entry.wallJson),
            entry.routesJson ? getJson(entry.routesJson) : Promise.resolve(null),
          ]);
          const parsed = G.parseWallData(rawWall, rawRoutes);
          wallsById.set(entry.wall, {
            wallId: entry.wall,
            name: entry.name || parsed.name || entry.wall,
            photoW: parsed.w,
            photoH: parsed.h,
            holds: parsed.holds,
            routes: parsed.routes,
            camera,
            _inWorker: false,
          });
        })
      );
      log.data.wallManifest = {
        walls: entries.map((w) => ({
          wall: w.wall,
          cameraBytes: w.camera.bytes,
          holds: w.holds,
          featurePoints: w.featurePoints,
        })),
        loadMs: Math.round(performance.now() - wallLoadStart),
      };
    }

    if (paramWall && !wallsById.has(paramWall)) {
      if (window.parent === window) {
        throw new Error(`找不到指定的牆面資料：${paramWall}`);
      }
      window.parent.postMessage({ type: 'climbio-wall2d-request', wallId: paramWall }, location.origin);
      const data = await Promise.race([
        parentWallPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`找不到指定的牆面資料：${paramWall}`)), 12000)),
      ]);
      const parsed = G.parseWallData({ id: data.wallId, name: data.name, w: data.w, h: data.h, holds: data.holds || [] });
      const wallEntry = {
        wallId: paramWall,
        name: parsed.name || paramWall,
        photoW: parsed.w,
        photoH: parsed.h,
        holds: parsed.holds,
        routes: parsed.routes,
        camera: null,
        _inWorker: false,
      };
      wallsById.set(paramWall, wallEntry);
      const photoSize = data.photo?.size || 0;
      const updatedAt = data.updatedAt || 0;
      const cached = await getCachedCamera(paramWall, parsed.w, parsed.h, photoSize, updatedAt);
      if (cached) {
        wallEntry.camera = cached;
      } else {
        if (!data.photo) throw new Error('找不到牆面照片');
        const { gray, width, height } = await photoToGray(data.photo);
        pendingBuild = {
          wallId: paramWall,
          name: wallEntry.name,
          gray,
          width,
          height,
          fullWidth: parsed.w,
          fullHeight: parsed.h,
          photoSize,
          updatedAt,
        };
      }
      log.data.wallManifest = {
        walls: [{ wall: paramWall, holds: parsed.holds.length }],
        loadMs: Math.round(performance.now() - wallLoadStart),
      };
    }

    populateWallSelect();
    populateRouteSelect(paramWall || defaultWallId);
    $('camera-toggle').disabled = false;
    $('sim-toggle').disabled = false;
    $('pick-media-btn').disabled = false;
    if (!running) setStatus(`就緒（已載入 ${wallsById.size} 面牆）`);
    document.body.dataset.ready = 'true';
    syncUi();
    syncWallsToWorker();
  }

  requestAnimationFrame(tick);
  syncUi();

  if (autoStart) {
    prewarmWorker();
    startCamera();
    loadWalls().catch((err) => {
      document.body.dataset.error = 'true';
      setTools(true);
      log.error(err);
      stop(`載入失敗：${err.message || err}`);
    });
  } else {
    await loadWalls();
    // 實驗頁待命時先在背景預載 OpenCV WASM 進快取，按下開啟相機時不用再等下載
    fetch(runtimeUrl, { cache: 'force-cache' }).catch(() => {});
  }
}

main().catch((err) => {
  document.body.dataset.error = 'true';
  setTools(true);
  $('tools-toggle').onclick = () => setTools(document.body.dataset.tools !== 'open');
  $('status').textContent = `載入失敗：${err.message || err}`;
  console.error(err);
});
