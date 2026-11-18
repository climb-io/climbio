// 匯入照片的預先分類與分組（Wall 人工岩場／Crag 戶外岩場共用）：
//   1. 依區域／岩壁自動分組（groupPhotos）：有子資料夾時照資料夾；否則用拍照 GPS 位置＋鏡頭朝向（15m、40°）與拍攝時間（1 分鐘內連拍）自動歸組。
//   2. 畫面內容篩選（classifyImageData）：檢查縮圖像素，挑出「有人物」「有繩索」「非岩壁（大片天空／樹林／文件截圖）」，預設只勾選「乾淨岩壁」進入自動處理。
// 純演算法不依賴 DOM，Node 與瀏覽器都能跑。
import { pickWall, estimateWall, located, local, GROUP_TIME } from './crag/geo.js';

const T = (...a) => globalThis.AppKit.i18n.t(...a);   // 文字在呼叫時才查（語言包載入完才有）

// 用 getter：切換語言後（或載入語言包前就 import）都取得目前語言的字
export const STATUS_LABEL = {
  get clean() { return T('stStatusClean'); },
  get person() { return T('stStatusPerson'); },
  get rope() { return T('stStatusRope'); },
  get 'not-wall'() { return T('stStatusNotWall'); },
};

export const GYM_STYLES = [
  ['', '不限類型'],
  ['boulder', '抱石 Bouldering'],
  ['lead', '先鋒 Leading'],
  ['toprope', '頂繩 Top Rope'],
];

export const aspectText = (deg) => (typeof deg === 'number' && Number.isFinite(deg) ? T('stAspect', Math.round((((deg % 360) + 360) % 360) / 45) % 8) : '');

/** 8 連通分塊：回傳每塊的面積、外框 [x0, y0, x1, y1] */
function connectedBoxes(mask, w, h) {
  const seen = new Uint8Array(w * h), stack = [], out = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, area = 0;
    seen[s] = 1; stack.push(s);
    while (stack.length) {
      const p = stack.pop(), x = p % w, y = (p - x) / w;
      area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    out.push({ x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, area });
  }
  return out;
}

/**
 * 檢查縮圖的 RGBA 像素（建議寬 120～200 px）：
 * - not-wall：大面積天空＋綠植（> 55%）或白底文件截圖（> 68%）
 * - rope：跨越多列（高度 ≥ 32%）、兩側背景一致而中間細長高對比的繩索線條
 * - person：集中的膚色區塊搭配高彩度衣物／裝備區塊（攀登者或確保者）
 * - clean：乾淨岩壁
 */
export function classifyImageData(rgba, w, h) {
  const total = w * h;
  if (!rgba || total < 64) return { status: 'clean', label: STATUS_LABEL.clean, clean: true, reasons: [] };

  let sky = 0, green = 0, paper = 0, skinTotal = 0;
  const skinMask = new Uint8Array(total);
  const clothMask = new Uint8Array(total);
  const holdMask = new Uint8Array(total);
  const ropeMask = new Uint8Array(total);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x, p = idx * 4;
      const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b), sat = max ? (max - min) / max : 0;

      // 天空（上半部偏藍亮）與綠植（樹葉、草地）
      if (y < h * 0.65 && b > 135 && b > r + 22 && b >= g - 12) sky++;
      if (g > 65 && g > r * 1.16 && g > b * 1.15 && sat > 0.18) green++;
      if (r > 238 && g > 238 && b > 238) paper++;

      // 膚色（YCbCr 範圍 + RGB 暖色限制）
      const cr = 128 + 0.5 * r - 0.4187 * g - 0.0813 * b;
      const cb = 128 - 0.1687 * r - 0.3313 * g + 0.5 * b;
      if (r > 95 && g > 45 && b > 25 && r > g && (r - min) > 24 && cr >= 138 && cr <= 172 && cb >= 85 && cb <= 122) {
        skinMask[idx] = 1;
        skinTotal++;
      }

      // 鮮豔衣物／安全帽／吊帶（高飽和、非純紅數位筆跡）与室內彩色塑膠岩點
      const isDigitalRed = max === r && r > 180 && g < 45 && b < 45;
      if (!isDigitalRed && max > 75 && sat > 0.48) clothMask[idx] = 1;
      if (!isDigitalRed && max > 65 && sat > 0.34) holdMask[idx] = 1;
    }
  }

  // 繩索偵測：水平方向兩側（±d）都是相近的岩壁背景，而中間像素與兩側同時有明顯色差／亮度差的細線
  for (let y = 1; y < h - 1; y++) {
    for (let x = 3; x < w - 3; x++) {
      const idx = y * w + x, p = idx * 4;
      const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
      // 排除純紅數位畫線（那是路線草稿紅筆，交給 hasRedPen 判斷）
      if (r > 190 && g < 40 && b < 40) continue;
      let hit = false;
      for (const d of [2, 3]) {
        const pl = (idx - d) * 4, pr = (idx + d) * 4;
        const rl = rgba[pl], gl = rgba[pl + 1], bl = rgba[pl + 2];
        const rr = rgba[pr], gr = rgba[pr + 1], br = rgba[pr + 2];
        const bgDiff = Math.abs(rl - rr) + Math.abs(gl - gr) + Math.abs(bl - br);
        if (bgDiff > 75) continue;   // 兩側背景不一致（一般岩稜或陰影交界），不算繩子
        const dl = Math.abs(r - rl) + Math.abs(g - gl) + Math.abs(b - bl);
        const dr = Math.abs(r - rr) + Math.abs(g - gr) + Math.abs(b - br);
        if (dl > 95 && dr > 95) { hit = true; break; }
      }
      if (hit) ropeMask[idx] = 1;
    }
  }

  const reasons = [];
  if ((sky / total > 0.15 && green / total > 0.15 && (sky + green) / total > 0.55) || paper / total > 0.68) reasons.push('not-wall');

  // 繩索連通塊：高度跨越 ≥ 32% 畫面高、高寬比 ≥ 2.2、平均線寬 ≤ 5.5 px
  const ropeBoxes = connectedBoxes(ropeMask, w, h);
  const hasRope = ropeBoxes.some(b => b.h >= h * 0.32 && b.h / Math.max(1, b.w) >= 2.2 && b.area / b.h <= 5.5 && b.area >= Math.max(10, Math.round(h * 0.25)));
  if (hasRope) reasons.push('rope');

  // 人物偵測：整體背景不是暖米色岩牆（skinTotal < 8%），且有集中膚色塊搭配具一定高度／面積的衣物軀幹塊（排除零散小顆塑膠岩點）
  const allClothBoxes = connectedBoxes(clothMask, w, h);
  const allHoldBoxes = connectedBoxes(holdMask, w, h);
  // 室內／人工岩場特徵：牆面上散佈多顆高彩度塑膠岩點（小面積色塊 ≥ 4 顆，且非大面積藍天綠地）
  const holdSpots = allHoldBoxes.filter(b => b.area >= 1 && b.area <= Math.max(35, Math.round(total * 0.025)));
  const indoor = holdSpots.length >= 4 && (sky + green) / total < 0.35;
  if (skinTotal / total < 0.08) {
    const skinBoxes = connectedBoxes(skinMask, w, h).filter(b => b.area >= Math.max(6, Math.round(total * 0.0025)) && b.area <= total * 0.06);
    const minClothArea = Math.max(30, Math.round(total * (indoor ? 0.03 : 0.015)));
    const clothBoxes = allClothBoxes.filter(b => b.area >= minClothArea && b.h >= h * 0.16 && b.area <= total * 0.28);
    const hasPerson = skinBoxes.some(s => clothBoxes.some(c => {
      const cx = (c.x0 + c.x1) / 2, sx = (s.x0 + s.x1) / 2;
      const cy = (c.y0 + c.y1) / 2, sy = (s.y0 + s.y1) / 2;
      return Math.abs(cx - sx) <= w * 0.16 && Math.abs(cy - sy) <= h * 0.32;
    }));
    if (hasPerson) reasons.push('person');
  }

  const status = reasons[0] || 'clean';
  return { status, label: STATUS_LABEL[status], clean: status === 'clean', indoor, reasons };
}

/**
 * 將掃描後的照片項目依「子資料夾 → GPS 位置與鏡頭朝向 → 拍攝時間（1 分鐘內）」自動分組：
 * items: [{ file, dir, camera, time, status, label, clean, red, thumbUrl }]
 * 回傳 groups: [{ id, name, style, note, aspect, items }]
 */
export function groupPhotos(items, { byTime = true } = {}) {
  const prefix = T('stWallPrefix');
  const hasFolders = items.some(it => it.dir && it.dir.trim());

  if (hasFolders) {
    const byDir = new Map();
    for (const it of items) {
      const key = (it.dir || '').trim() || `${prefix} 1`;
      if (!byDir.has(key)) byDir.set(key, []);
      byDir.get(key).push(it);
    }
    let idx = 1;
    return [...byDir.entries()].map(([name, list]) => {
      const est = estimateWall(list.map(x => ({ camera: x.camera, portrait: (x.h || 0) > (x.w || 0) })));
      return {
        id: `g${idx++}`,
        name,
        style: '',
        aspect: est?.aspect,
        note: [aspectText(est?.aspect), T('stPhotoCount', list.length)].filter(Boolean).join(' · '),
        items: list,
      };
    });
  }

  // 沒有子資料夾：用 GPS 位置＋朝向（pickWall）分組，沒位置的照 1 分鐘內拍攝時間歸組（室內與戶外通用）
  const walls = [];   // [{ id, cameras, times, items }]
  const loose = [];
  for (const it of items) {
    if (located(it.camera)) {
      const hit = pickWall(it.camera, walls);
      let g = walls.find(w => w.id === hit);
      if (!g) { g = { id: `g${walls.length + 1}`, cameras: [], times: [], items: [] }; walls.push(g); }
      g.cameras.push(it.camera);
      if (Number.isFinite(it.time)) g.times.push(it.time);
      g.items.push(it);
    } else {
      loose.push(it);
    }
  }

  // 沒 GPS 的照片：先找 1 分鐘內時間最接近的 GPS 分組；沒有就跟前一張 1 分鐘內連拍的歸同一組
  const rest = [];
  for (const it of loose) {
    let best = null, bestDt = GROUP_TIME;
    if (byTime && Number.isFinite(it.time)) {
      for (const g of walls) {
        for (const t of g.times) {
          const dt = Math.abs(t - it.time);
          if (dt <= bestDt) { best = g; bestDt = dt; }
        }
      }
    }
    if (best) {
      best.items.push(it);
      if (Number.isFinite(it.time)) best.times.push(it.time);
    } else {
      rest.push(it);
    }
  }

  let curGroup = null, lastTime = null;
  for (const it of rest) {
    const t = it.time;
    const closeInTime = byTime && Number.isFinite(t) && Number.isFinite(lastTime) && Math.abs(t - lastTime) <= GROUP_TIME;
    if (!curGroup || !closeInTime) {
      curGroup = { id: `g${walls.length + 1}`, cameras: [], times: [], items: [] };
      walls.push(curGroup);
    }
    curGroup.items.push(it);
    if (Number.isFinite(t)) { curGroup.times.push(t); lastTime = t; } else lastTime = null;
  }

  return walls.map((g, i) => {
    const est = estimateWall(g.items.map(x => ({ camera: x.camera, portrait: (x.h || 0) > (x.w || 0) })));
    const gpsCount = g.items.filter(x => located(x.camera)).length;
    return {
      id: g.id,
      name: `${prefix} ${i + 1}`,
      style: '',
      line: est?.line,
      aspect: est?.aspect,
      note: [aspectText(est?.aspect), gpsCount ? T('stNoteGps') : g.items.length > 1 ? T('stNoteBurst') : ''].filter(Boolean).join(' · '),
      items: g.items,
    };
  });
}

/**
 * 匯入前預覽各分組／岩壁的相對位置（平面公尺座標：x 向東、y 向北）：
 * 從每個分組內的照片 EXIF GPS 位置與方位角推估牆線與拍照點，回傳可供 SVG 繪製的相對位置資料。
 */
export function layoutGroupsMap(groups) {
  const rawWalls = [];
  let origin = null;
  for (const [idx, g] of (groups || []).entries()) {
    const active = g.items.filter(x => x.selected !== false);
    const pool = active.length ? active : g.items;
    const shots = pool.filter(x => located(x.camera)).map(x => ({ camera: x.camera, portrait: (x.h || 0) > (x.w || 0) }));
    if (!shots.length) continue;
    if (!origin) origin = shots[0].camera.position;
    const est = estimateWall(shots);
    const meanLng = shots.reduce((s, x) => s + x.camera.position[0], 0) / shots.length;
    const meanLat = shots.reduce((s, x) => s + x.camera.position[1], 0) / shots.length;
    rawWalls.push({
      id: g.id || `g${idx + 1}`,
      index: idx,
      name: g.name || `${T('stWallPrefix')} ${idx + 1}`,
      aspect: est?.aspect,
      aspectLabel: aspectText(est?.aspect),
      lineLngLat: est?.line || null,
      centerLngLat: [meanLng, meanLat],
      shots: shots.map(s => s.camera),
      count: active.length,
    });
  }
  if (!rawWalls.length || !origin) return null;

  const plane = local(origin);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const touch = ([x, y]) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  };

  const walls = rawWalls.map(w => {
    let p0, p1;
    if (w.lineLngLat) {
      p0 = plane.to(w.lineLngLat[0]);
      p1 = plane.to(w.lineLngLat[1]);
    } else {
      const [cx, cy] = plane.to(w.centerLngLat);
      p0 = [cx - 2, cy];
      p1 = [cx + 2, cy];
    }
    const cx = (p0[0] + p1[0]) / 2, cy = (p0[1] + p1[1]) / 2;
    const cameras = w.shots.map(c => {
      const [x, y] = plane.to(c.position);
      touch([x, y]);
      return { x, y, heading: c.heading };
    });
    touch(p0); touch(p1);
    return {
      id: w.id,
      index: w.index,
      name: w.name,
      aspect: w.aspect,
      aspectLabel: w.aspectLabel,
      p0,
      p1,
      center: [cx, cy],
      cameras,
      count: w.count,
    };
  });

  const spanX = Math.max(8, maxX - minX);
  const spanY = Math.max(8, maxY - minY);
  return {
    walls,
    bounds: { minX, maxX, minY, maxY, spanX, spanY },
  };
}
