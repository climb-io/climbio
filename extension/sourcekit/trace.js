// 這是 sourcekit/ 的複製（tools/sync-extension.mjs 產生），不要直接改，改 sourcekit/ 再同步。
// 描線（Topo 照片上作者畫的路線 → 線段）的純運算：只看像素，不碰 DOM、不依賴套件，網頁、擴充功能、Node 都能跑。
// 輸入是 { data, width, height }（RGBA，可以先縮小）；輸出的座標乘回原圖。取像素（Blob → 像素）在各自的環境做：Studio 是 studio/crag/trace.js。
// 先找出作者的筆跡：有作者的原始照片時兩張相減（traceDiff，最準，bolt 的小 X 也分得出來）；沒有時挑鮮紅色（traceRed，不抓 bolt，誤判太多）。
// 筆不一定是紅色：紅筆找不到（或比照片上的路線少）時，再找照片上細長、很飽和的其他顏色（tracePen，任何顏色只有這一套）。
// 再來一樣：拿掉白底名牌 → 把虛線的空隙補起來分組 → 夠長的一組細化成骨架 → 取最長的一條路徑 → 簡化成折線，起點放在下面（起攀）。
// English: pure pixel pipeline that turns the pen marks on a topo photo into polylines (red pen, or original-vs-annotated difference).
import { readBadgeText } from './badge-digits.js';


/** 紅筆：色相在紅的附近、很飽和、夠亮（路線書是在手機或電腦上畫的純色，地上的落葉、紅土沒這麼鮮） */
function isRed(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max !== r || max < 150 || (max - min) / max < 0.6) return false;
  const hue = ((g - b) / (max - min)) * 60;   // 紅色那一段：-60～60 度
  return hue <= 16 && hue >= -20;
}
/** 黃筆：有的路書用黃線標接線（連到另一條路線的一段），色相在黃的附近、很飽和、很亮 */
function isYellow(r, g, b) {
  const max = Math.max(r, g), min = Math.min(r, g, b);
  if (max < 180 || (max - min) / max < 0.7 || b > 110) return false;
  const hue = r >= g ? ((g - b) / (r - min)) * 60 : 120 - ((r - b) / (g - min)) * 60;
  return hue >= 38 && hue <= 70;
}
/** 名牌的底：很淡、幾乎沒有顏色（照片暗的時候名牌也會被壓灰一點） */
const isWhite = (r, g, b) => { const max = Math.max(r, g, b); return max > 175 && (max - Math.min(r, g, b)) / max < 0.16; };

/** 連通的一塊塊（8 連通）：回傳每個像素的編號（0 是背景）和每塊的外框、面積 */
function components(mask, w, h) {
  const label = new Int32Array(w * h), boxes = [null];
  const stack = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || label[s]) continue;
    const id = boxes.length, box = { x0: w, y0: h, x1: 0, y1: 0, area: 0 };
    label[s] = id; stack.push(s);
    while (stack.length) {
      const p = stack.pop(), x = p % w, y = (p - x) / w;
      box.area++;
      if (x < box.x0) box.x0 = x; if (x > box.x1) box.x1 = x; if (y < box.y0) box.y0 = y; if (y > box.y1) box.y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (mask[q] && !label[q]) { label[q] = id; stack.push(q); }
      }
    }
    boxes.push(box);
  }
  return { label, boxes };
}

/** 方形結構元素的膨脹：r 像素 */
function dilate(mask, w, h, r) {
  if (r < 1) return mask;
  const row = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) row[y * w + k] = 1;
  }
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
    if (!row[y * w + x]) continue;
    for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) out[k * w + x] = 1;
  }
  return out;
}

/** Zhang-Suen 細化：留下一像素寬的骨架 */
function thin(m, w, h) {
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? m[y * w + x] : 0);
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of [0, 1]) {
      const kill = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!m[y * w + x]) continue;
        const p = [at(x, y - 1), at(x + 1, y - 1), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1), at(x - 1, y + 1), at(x - 1, y), at(x - 1, y - 1)];
        const b = p.reduce((s, v) => s + v, 0);
        if (b < 2 || b > 6) continue;
        let a = 0;
        for (let i = 0; i < 8; i++) if (!p[i] && p[(i + 1) % 8]) a++;
        if (a !== 1) continue;
        if (step === 0 ? p[0] * p[2] * p[4] || p[2] * p[4] * p[6] : p[0] * p[2] * p[6] || p[0] * p[4] * p[6]) continue;
        kill.push(y * w + x);
      }
      for (const i of kill) m[i] = 0;
      if (kill.length) changed = true;
    }
  }
  return m;
}

/** 骨架上最長的一條路：從任一點走到最遠的 a，再從 a 走到最遠的 b，回傳 a→b 的像素 */
function longestPath(m, w, h) {
  const bfs = (start) => {
    const prev = new Int32Array(w * h).fill(-2), queue = [start];
    prev[start] = -1;
    let last = start;
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i], x = p % w, y = (p - x) / w;
      last = p;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (m[q] && prev[q] === -2) { prev[q] = p; queue.push(q); }
      }
    }
    return { last, prev };
  };
  const first = m.findIndex(v => v);
  if (first < 0) return [];
  const a = bfs(first).last, { last: b, prev } = bfs(a);
  const path = [];
  for (let p = b; p !== -1; p = prev[p]) path.push([p % w, (p - (p % w)) / w]);
  return path;
}

/** 起攀圈：線的開頭繞著一個小圈打轉時，換成圈的中心（就是起攀點） */
function startCircle(path, r) {
  let k = 0;
  while (k < path.length && Math.hypot(path[k][0] - path[0][0], path[k][1] - path[0][1]) <= r) k++;
  const head = path.slice(0, k);
  // 繞圈：開頭這段走的長度比它的跨度長很多
  let walked = 0;
  for (let i = 1; i < head.length; i++) walked += Math.hypot(head[i][0] - head[i - 1][0], head[i][1] - head[i - 1][1]);
  const span = head.length ? Math.hypot(head.at(-1)[0] - head[0][0], head.at(-1)[1] - head[0][1]) : 0;
  if (head.length < 8 || walked < span * 1.3) return path;
  const c = [head.reduce((s, p) => s + p[0], 0) / head.length, head.reduce((s, p) => s + p[1], 0) / head.length];
  return [c, ...path.slice(k)];
}

/**
 * 兩條路線共用起點（V）或共用頂端（∧）時會描成一條：最低點（或最高點）在中間、兩端都離它夠遠，就從那裡拆成兩條，各自從下面開始。
 * path 的第一點是比較低的一端
 */
function splitFork(path, far) {
  let lo = 0, hi = 0;
  path.forEach((p, i) => { if (p[1] > path[lo][1]) lo = i; if (p[1] < path[hi][1]) hi = i; });
  const [a, b] = [path[0], path[path.length - 1]];
  if (lo > 0 && lo < path.length - 1 && path[lo][1] - a[1] > far && path[lo][1] - b[1] > far) return [path.slice(0, lo + 1).reverse(), path.slice(lo)];
  if (hi > 0 && hi < path.length - 1 && a[1] - path[hi][1] > far && b[1] - path[hi][1] > far) return [path.slice(0, hi + 1), path.slice(hi).reverse()];
  return [path];
}

/**
 * 共線：好幾條路線共用一段（下面共起點、上面共終點）時，一塊筆跡裡不只一條路。
 * 骨架 m（一像素寬）上，由下往上的端點到端點的最短路徑（y 不會往下超過 tol）都是候選的路線；
 * 一條一條挑「蓋到最多還沒蓋到的骨架」的，直到剩下的都很短（細化留下的小毛刺）為止。回傳每條由下往上的像素 [[x, y]…]
 */
function coverPaths(m, w, h, diag) {
  const nbrs = (p) => {
    const x = p % w, y = (p - x) / w, r = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if ((dx || dy) && nx >= 0 && ny >= 0 && nx < w && ny < h && m[ny * w + nx]) r.push(ny * w + nx);
    }
    return r;
  };
  const pixels = [];
  for (let p = 0; p < m.length; p++) if (m[p]) pixels.push(p);
  // 端點：環繞一圈只有一段相連的像素
  const ends = pixels.filter(p => {
    const x = p % w, y = (p - x) / w, ring = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]].map(([dx, dy]) => (x + dx >= 0 && y + dy >= 0 && x + dx < w && y + dy < h ? m[(y + dy) * w + x + dx] : 0));
    let a = 0;
    for (let i = 0; i < 8; i++) if (!ring[i] && ring[(i + 1) % 8]) a++;
    return a === 1 || (a === 0 && ring.some(Boolean));
  });
  const yOf = (p) => (p - (p % w)) / w, tol = diag * 0.02, minRise = diag * 0.1;
  const candidates = [];
  for (const s of ends) {
    // 從 s 往外廣度優先，prev 記路徑
    const prev = new Map([[s, -1]]), queue = [s];
    for (let i = 0; i < queue.length; i++) for (const q of nbrs(queue[i])) if (!prev.has(q)) { prev.set(q, queue[i]); queue.push(q); }
    for (const t of ends) {
      if (t === s || !prev.has(t) || yOf(s) - yOf(t) < minRise) continue;   // s 在下、t 在上
      const path = [];
      for (let p = t; p !== -1; p = prev.get(p)) path.push(p);   // t → s
      path.reverse();   // s（下）→ t（上）
      let top = Infinity, dip = 0;
      for (const p of path) { top = Math.min(top, yOf(p)); dip = Math.max(dip, yOf(p) - top); }
      if (dip <= tol) candidates.push(path);
    }
  }
  const left = new Set(pixels), chosen = [];
  while (candidates.length) {
    let best = -1, gain = 0;
    for (const [i, c] of candidates.entries()) { const g = c.filter(p => left.has(p)).length; if (g > gain) { gain = g; best = i; } }
    if (best < 0 || gain < diag * 0.03) break;
    for (const p of candidates[best]) left.delete(p);
    chosen.push(candidates.splice(best, 1)[0]);
  }
  // 共線的路徑要共用同一組點（topokit/lines.js：兩端座標相同的線段視為共用，只畫一次）：
  // 依每個像素被哪些路徑走過把路徑切段，同一段（像素一樣）只簡化一次，各路徑接起來；交界的像素兩邊都有
  const users = new Map();
  chosen.forEach((path, k) => { for (const p of path) (users.get(p) ?? users.set(p, []).get(p)).push(k); });
  const sig = (p) => users.get(p).join();
  const memo = new Map();
  const run = (pixels, first) => {
    const key = `${first ? 's' : ''}${pixels.join()}`;
    if (!memo.has(key)) {
      const line = pixels.map(p => [p % w, yOf(p)]);
      memo.set(key, simplify(first ? startCircle(line, diag * 0.05) : line, diag * 0.006));
    }
    return memo.get(key);
  };
  return chosen.map((path) => {
    const line = [];
    for (let a = 0; a < path.length - 1;) {
      let b = a;
      while (b + 1 < path.length && sig(path[b + 1]) === sig(path[a])) b++;
      if (b === a) b = a + 1;
      const part = run(path.slice(a, b + 1), a === 0);
      line.push(...(line.length ? part.slice(1) : part));
      a = b;
    }
    return line;
  });
}

const lengthOf = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

/** Ramer–Douglas–Peucker 簡化 */
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  let far = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((b[0] - a[0]) * (a[1] - pts[i][1]) - (a[0] - pts[i][0]) * (b[1] - a[1])) / len;
    if (d > far) { far = d; idx = i; }
  }
  if (far <= eps) return [a, b];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
}

/** 找的時候照片縮到長邊幾像素（夠看清筆跡、手機也跑得動） */
export const TRACE_EDGE = 1200;

/**
 * image：{ data, width, height }（RGBA，可以先縮小）；scale：縮小倍率（原圖寬 ÷ image.width），回傳的座標乘回原圖。
 * expected：照片上有幾條路線（有的話，找到的線比它少時會試著拆開共線）。
 * 回傳 [{ points: [[x, y]…] }]，照起點由左到右排；起點是比較低的那一端。
 */
/**
 * 虛線（短而細的亮段一段一段排成一列）：mask 上的連通塊裡挑出「細長的短線段」（長是對角線的 0.8～6%、寬 0.12～1.2%、長寬比 2 以上），
 * 把方向一致、首尾相接的串成鏈（每段最多接兩個鄰居），整條鏈長度、間距都差不多的、至少 4 段才算一條線。回傳每條鏈的點（mask 像素座標，依鏈的順序）
 */
function dashChains(mask, w, h, diag) {
  const { label, boxes } = components(mask, w, h), n = boxes.length;
  const acc = Array.from({ length: n }, () => ({ a: 0, x: 0, y: 0, xx: 0, yy: 0, xy: 0 }));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const id = label[y * w + x];
    if (!id) continue;
    const m = acc[id]; m.a++; m.x += x; m.y += y; m.xx += x * x; m.yy += y * y; m.xy += x * y;
  }
  const dashes = [];
  for (let id = 1; id < n; id++) {
    const m = acc[id];
    if (m.a < 8) continue;
    const cx = m.x / m.a, cy = m.y / m.a, vxx = m.xx / m.a - cx * cx, vyy = m.yy / m.a - cy * cy, vxy = m.xy / m.a - cx * cy;
    const tr = vxx + vyy, det = Math.sqrt(Math.max(0, (vxx - vyy) ** 2 / 4 + vxy * vxy)), l1 = tr / 2 + det, l2 = Math.max(0, tr / 2 - det);
    const len = Math.sqrt(12 * l1), wid = Math.sqrt(12 * l2), ang = 0.5 * Math.atan2(2 * vxy, vxx - vyy);   // 主軸方向（弧度）
    if (len < diag * 0.008 || len > diag * 0.06 || wid < diag * 0.0012 || wid > diag * 0.012 || len < wid * 2) continue;
    dashes.push({ cx, cy, len, ang, ux: Math.cos(ang), uy: Math.sin(ang) });
  }
  // 候選連結：中心連線跟兩段的方向都夾角不大、頭尾間距不超過 2 倍段長；每段最多留最近的兩個
  const cos = Math.cos(0.55);   // 約 31 度
  const links = dashes.map(() => []);
  for (let i = 0; i < dashes.length; i++) for (let j = i + 1; j < dashes.length; j++) {
    const a = dashes[i], b = dashes[j], dx = b.cx - a.cx, dy = b.cy - a.cy, d = Math.hypot(dx, dy);
    if (d < (a.len + b.len) / 2 * 0.9 || d > (a.len + b.len) * 1.2) continue;   // 中心距：頭尾剛好相接到空隙兩倍
    if (Math.abs(a.ux * b.ux + a.uy * b.uy) < Math.cos(0.6)) continue;
    if (Math.abs((dx * a.ux + dy * a.uy) / d) < cos || Math.abs((dx * b.ux + dy * b.uy) / d) < cos) continue;
    links[i].push([d, j]); links[j].push([d, i]);
  }
  const keep = links.map((l, i) => new Set(l.sort((p, q) => p[0] - q[0]).slice(0, 2).map(([, j]) => j)));
  const edges = [];   // 兩邊都選了對方才連
  for (let i = 0; i < dashes.length; i++) for (const j of keep[i]) if (j > i && keep[j].has(i)) edges.push([i, j]);
  const next = dashes.map(() => []);
  for (const [i, j] of edges) { next[i].push(j); next[j].push(i); }
  const seen = new Set(), chains = [];
  for (let s = 0; s < dashes.length; s++) {
    if (seen.has(s) || next[s].length > 1) continue;   // 從鏈的一端開始走
    const chain = []; let prev = -1, cur = s;
    while (cur !== -1 && !seen.has(cur)) { seen.add(cur); chain.push(cur); const nx = next[cur].find(q => q !== prev); prev = cur; cur = nx ?? -1; }
    if (chain.length < 4) continue;
    const lens = chain.map(i => dashes[i].len).sort((p, q) => p - q), med = lens[lens.length >> 1];
    if (lens.some(v => v < med * 0.5 || v > med * 1.7)) continue;   // 長短差太多的不是同一條虛線
    // 間距也要均勻（岩石紋理上的亮點串起來間距亂），而且整條夠長（路線不會只有一小截）
    const gaps = chain.slice(1).map((v, k) => Math.hypot(dashes[v].cx - dashes[chain[k]].cx, dashes[v].cy - dashes[chain[k]].cy)), gm = [...gaps].sort((p, q) => p - q)[gaps.length >> 1];
    if (gaps.some(g => g < gm * 0.5 || g > gm * 1.9) || gaps.reduce((t, g) => t + g, 0) < diag * 0.12) continue;
    chains.push(chain.map(i => dashes[i]));
  }
  // 鏈的點：每段的中心，頭尾再各往外延伸半段（線真正的起訖）
  const out = (a, b) => { const d = Math.hypot(a.cx - b.cx, a.cy - b.cy) || 1; return [a.cx + ((a.cx - b.cx) / d) * a.len / 2, a.cy + ((a.cy - b.cy) / d) * a.len / 2]; };
  return chains.map(c => [out(c[0], c[1]), ...c.map(d => [d.cx, d.cy]), out(c.at(-1), c.at(-2))]);
}

/** 白色虛線：很亮、幾乎沒有顏色的細段串成的線（路線書常用白虛線）；參數同 traceRed；blocked 是不用看的範圍 [{ x, y, size }]（號碼牌裡白色的字不是虛線）。回傳 [{ points }]，起點在下面、由左到右排 */
export function traceDashes(image, scale = 1, blocked = []) {
  const { data, width: w, height: h } = image, diag = Math.hypot(w, h), mask = new Uint8Array(w * h);
  // 縮小後細虛線會混進背景變灰，所以亮度門檻放寬（185），改用脊線（兩側都暗得多）擋掉大片的亮區；真正的把關是串成鏈的規則
  const d = Math.max(2, Math.round(diag * 0.0035));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = (y * w + x) * 4, max = Math.max(data[p], data[p + 1], data[p + 2]), min = Math.min(data[p], data[p + 1], data[p + 2]);
    if (min >= 185 && (max - min) / max < 0.2 && ridge(data, w, h, x, y, d, 35)) mask[y * w + x] = 1;
  }
  for (const b of blocked) for (let y = Math.max(0, Math.floor(b.y - b.size * 0.7)); y <= Math.min(h - 1, Math.ceil(b.y + b.size * 0.7)); y++) mask.fill(0, y * w + Math.max(0, Math.floor(b.x - b.size * 0.7)), y * w + Math.min(w, Math.ceil(b.x + b.size * 0.7) + 1));
  const px = ([x, y]) => [Math.round((x + 0.5) * scale), Math.round((y + 0.5) * scale)];
  return dashChains(mask, w, h, diag)
    .map(c => (c[0][1] < c.at(-1)[1] ? [...c].reverse() : c))
    .map(c => ({ points: simplify(c, diag * 0.004).map(px) }))
    .sort((a, b) => a.points[0][0] - b.points[0][0]);
}

/**
 * 號碼牌（路線起點的小標籤：純色的圓角方塊，裡面有白色的號碼）：偵測不出線的時候，至少標出路線的起點位置。
 * 純色（鮮豔或接近黑色、周圍 3×3 幾乎沒有變化）的連通塊，大小約對角線的 1.2～5%、接近正方形、填滿七成以上，裡面有白色的字。
 * 回傳 [{ point: [x, y], size, color, text }]（座標乘 scale 回原圖，size 是邊長，color 是牌子的顏色 '#rrggbb'，text 是讀到的號碼，讀不到是空字串；
 * 號碼是用樣板比對的（badge-digits.js），不是每個都對：要拿頁面上的路線編號對照，對不上就不要用），由左到右排；不認號碼（沒有文字辨識），配給路線靠順序（同描線）
 */
function findBadges(image) {
  const { data, width: w, height: h } = image, diag = Math.hypot(w, h), mask = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = (y * w + x) * 4, r = data[p], g = data[p + 1], b = data[p + 2], max = Math.max(r, g, b), min = Math.min(r, g, b);
    const vivid = max > 120 && (max - min) / max > 0.6, dark = max < 60;
    if (!vivid && !dark) continue;
    let flat = true;   // 周圍 3×3 幾乎沒有變化（照片的紋理、樹葉不會）
    for (let dy = -1; dy <= 1 && flat; dy++) for (let dx = -1; dx <= 1; dx++) { const q = ((y + dy) * w + x + dx) * 4; if (Math.abs(data[q] - r) + Math.abs(data[q + 1] - g) + Math.abs(data[q + 2] - b) > 40) { flat = false; break; } }
    if (flat) mask[y * w + x] = 1;
  }
  const { label, boxes } = components(mask, w, h), out = [];
  for (let id = 1; id < boxes.length; id++) {
    const box = boxes[id], bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1, size = Math.max(bw, bh);
    if (size < diag * 0.012 || size > diag * 0.05 || Math.min(bw, bh) < size * 0.7 || box.area < bw * bh * 0.55) continue;
    // 裡面有白色的字：外框內、不屬於這一塊的亮像素
    let white = 0;
    for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) {
      const p = (y * w + x) * 4;
      if (label[y * w + x] !== id && Math.min(data[p], data[p + 1], data[p + 2]) > 170) white++;
    }
    if (white < bw * bh * 0.04) continue;
    let sr = 0, sg = 0, sb = 0, n = 0;   // 牌子本體的平均色（原牌子的顏色：橘綠紅黑多半是難度的分級）
    for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) if (label[y * w + x] === id) { const p = (y * w + x) * 4; sr += data[p]; sg += data[p + 1]; sb += data[p + 2]; n++; }
    const hex = (v) => Math.round(v / n).toString(16).padStart(2, '0');
    out.push({ x: (box.x0 + box.x1) / 2 + 0.5, y: (box.y0 + box.y1) / 2 + 0.5, size, color: `#${hex(sr)}${hex(sg)}${hex(sb)}` });
  }
  return out;
}

export function traceBadges(image, scale = 1) {
  return findBadges(image).map(({ x, y, size, color }) => ({ point: [Math.round(x * scale), Math.round(y * scale)], size: Math.round(size * scale), color, text: readBadgeText(image, x, y, size) })).sort((a, b) => a.point[0] - b.point[0]);
}

/**
 * 一張 Topo 照片：線（traceRed，紅筆之外交給 tracePen）加號碼牌（traceBadges）。號碼牌是這張照片有幾條路線的線索：
 * 每個號碼牌配一條起點（較低的一端）在它附近的線；找不到線的號碼牌 line 是 null——至少標出起點位置，比什麼都沒有好。
 * 回傳 { lines, badges: [{ point, size, line }] }：line 是 lines 的索引或 null；badges 由左到右排。座標都乘過 scale。
 */
export function traceTopo(image, scale = 1, expected = 0) {
  const badges = traceBadges(image, scale), lines = traceRed(image, scale, expected);
  const reach = Math.hypot(image.width, image.height) * scale * 0.06, used = new Set();
  for (const b of badges) {
    let best = null, bestD = reach;
    lines.forEach((l, i) => { const d = Math.hypot(l.points[0][0] - b.point[0], l.points[0][1] - b.point[1]); if (!used.has(i) && d < bestD) { best = i; bestD = d; } });
    if (best !== null) used.add(best);
    b.line = best;
  }
  return { lines, badges };
}

const MAX_TURN = 6;
const AXES = [[1, 0], [0, 1], [1, 1], [1, -1]];
/** (x, y) 是不是脊線：某個方向上，兩邊離 d 像素的顏色都跟它差 t（預設 55）以上 */
function ridge(data, w, h, x, y, d, t = 55) {
  const p = (y * w + x) * 4;
  for (const [dx, dy] of AXES) {
    const [x1, y1, x2, y2] = [x + dx * d, y + dy * d, x - dx * d, y - dy * d];
    if (x1 < 0 || y1 < 0 || x1 >= w || y1 >= h || x2 < 0 || y2 < 0 || y2 >= h || x2 >= w) continue;
    const q = (y1 * w + x1) * 4, u = (y2 * w + x2) * 4;
    if (Math.hypot(data[p] - data[q], data[p + 1] - data[q + 1], data[p + 2] - data[q + 2]) > t && Math.hypot(data[p] - data[u], data[p + 1] - data[u + 1], data[p + 2] - data[u + 2]) > t) return true;
  }
  return false;
}
/**
 * 任何顏色的筆（沒有原圖、筆不是紅的：白、黃、洋紅、青…）：筆跡是「比周圍突出的細長鮮色」。
 *   跟周圍（方框平均）差很多、而且是鮮豔的顏色或純白的像素是候選；寬的天空、白牆、大片葉子跟周圍差不多，不會被選到
 *   候選依色相分成幾群（白另外一群），每一群各自照 traceRed 的流程描線，再合併：線太像已有的線（同一條被不同群描到）就丟掉
 * 參數同 traceRed；expected 有給時，合併的結果不超過它（多的是雜訊，保留最長的幾條）。
 */
export function tracePen(image, scale = 1, expected = 0, report) {
  const { data, width: w, height: h } = image, diag = Math.hypot(w, h), d = Math.max(3, Math.round(diag * 0.006) + 1);
  const classes = new Map();   // 色群 → mask
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = (y * w + x) * 4, rr = data[p], g = data[p + 1], b = data[p + 2];
    const max = Math.max(rr, g, b), min = Math.min(rr, g, b), sat = max ? (max - min) / max : 0;
    const white = min > 200 && sat < 0.14, vivid = sat > 0.55 && max > 110;   // white 只是分群的標記
    if (!white && !vivid) continue;
    // 細長的筆：沿著某個方向，兩邊（離 d 像素）的顏色都跟這個像素差很多（脊線）；只有一邊不同的是區塊的邊界（葉子、天空的邊）
    if (!ridge(data, w, h, x, y, d)) continue;
    let key = 'white';
    if (!white) {
      const hue = (max === rr ? ((g - b) / (max - min)) * 60 : max === g ? 120 + ((b - rr) / (max - min)) * 60 : 240 + ((rr - g) / (max - min)) * 60 + 360) % 360;
      key = Math.round(hue / 30) % 12;
    }
    let mask = classes.get(key);
    if (!mask) classes.set(key, mask = new Uint8Array(w * h));
    mask[y * w + x] = 1;
  }
  const near = (a, b) => a.points.every((p) => distToLine(p, b.points) < diag * 0.02 * scale);
  const len = (l) => l.points.slice(1).reduce((t, p, i) => t + Math.hypot(p[0] - l.points[i][0], p[1] - l.points[i][1]), 0);
  /** 一條線的彎折量：各轉折的角度（弧度）加總；手畫的路線平順，樹葉、岩石的邊緣曲折 */
  const turns = (l) => l.points.slice(2).reduce((t, p, i) => { const [a, b] = [l.points[i], l.points[i + 1]], d = Math.abs(Math.atan2(p[1] - b[1], p[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0])); return t + Math.min(d, 2 * Math.PI - d); }, 0);
  // 同一張圖的筆通常同一個顏色：每群只留跟群平均色接近的像素（樹葉、岩石邊緣的雜色是零碎的），各群描線後依「線的總長」排名，只留跟第一名差不多的前幾群（其他是雜訊）
  const groups = [];
  for (const [key, mask] of classes) {
    if (key === 'white') continue;   // 白色另外用虛線偵測（traceDashes）：天空的縫隙、枝葉間的亮點太多，單看顏色不準
    let n = 0; const m = [0, 0, 0];
    for (let i = 0; i < mask.length; i++) if (mask[i]) { n++; for (let c = 0; c < 3; c++) m[c] += data[i * 4 + c]; }
    if (n < diag * 0.1) continue;
    for (let c = 0; c < 3; c++) m[c] /= n;
    for (let i = 0; i < mask.length; i++) if (mask[i] && Math.hypot(data[i * 4] - m[0], data[i * 4 + 1] - m[1], data[i * 4 + 2] - m[2]) > 90) mask[i] = 0;
    let kept = 0, sd = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i]) { kept++; sd += Math.hypot(data[i * 4] - m[0], data[i * 4 + 1] - m[1], data[i * 4 + 2] - m[2]) ** 2; }
    const lines = trace(mask, image, scale, false, expected);
    report?.push({ key, n, kept, mean: m.map(Math.round), std: Math.round(Math.sqrt(sd / Math.max(1, kept))), lines: lines.length, total: Math.round(lines.reduce((t, l) => t + len(l), 0)), turn: +(lines.reduce((t, l) => t + turns(l), 0) / Math.max(1, lines.length)).toFixed(2), sat: +(1 - Math.min(...m) / Math.max(...m)).toFixed(2) });
    // 平均一條線彎折超過 MAX_TURN 弧度的是樹葉、岩石邊緣、雲（量過：筆 0.2～2.6，雜訊 4 以上多數 7～30）
    if (lines.length && lines.reduce((t, l) => t + turns(l), 0) / lines.length <= MAX_TURN) groups.push({ lines, total: lines.reduce((t, l) => t + len(l), 0) });
  }
  const dashed = traceDashes(image, scale, findBadges(image));
  if (dashed.length) groups.push({ lines: dashed, total: dashed.reduce((t, l) => t + len(l), 0) });
  groups.sort((a, b) => b.total - a.total);
  const found = [];
  for (const g of groups.slice(0, 3)) {
    if (g.total < groups[0].total * 0.4) break;
    for (const line of g.lines) if (!found.some((f) => near(line, f) || near(f, line))) found.push(line);
  }
  const kept = expected > 0 && found.length > expected ? found.sort((a, b) => len(b) - len(a)).slice(0, expected) : found;
  return kept.sort((a, b) => a.points[0][0] - b.points[0][0]);
}

export function traceRed(image, scale = 1, expected = 0) {
  const base = traceRedBase(image, scale, expected);
  if (base.length && !(expected > base.length)) return base;
  // 不是（或不只是）紅筆：藍、綠、橘、紫、白虛線…，或每條路線一種顏色，交給 tracePen（任何顏色只有這一套）。
  // 紅筆已經找到夠多的路線就不動；跟紅筆已有的線重疊的不算
  const diag = Math.hypot(image.width, image.height) * scale;
  const extra = tracePen(image, scale, 0).filter((l) => !base.some((b) => l.points.every((p) => distToLine(p, b.points) < diag * 0.02)));
  if (!extra.length) return base;
  const all = sortLines([...base, ...extra], Math.hypot(image.width, image.height), scale);
  return all.length > base.length && (!base.length || all.length <= expected) ? all : base;
}

function traceRedBase(image, scale, expected) {
  const { data, width: w, height: h } = image;
  const red = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) if (isRed(data[p], data[p + 1], data[p + 2])) red[i] = 1;
  const lines = trace(red.slice(), image, scale, false, expected);
  if (!(expected > lines.length)) return lines;
  // 還是少：黃線是接線（連到另一條路線的一段），把黃筆也算進去再找一次，數量更接近（不超過）照片上的路線數才採用
  for (let i = 0, p = 0; i < w * h; i++, p += 4) if (isYellow(data[p], data[p + 1], data[p + 2])) red[i] = 1;
  const more = trace(red, image, scale, false, expected);
  return more.length > lines.length && more.length <= expected ? more : lines;
}

/** 色相 0～360、飽和度 0～1、亮度 0～255 */
function hsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return [0, 0, max];
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, d / max, max];
}

/** 有原始照片：annotated（路線書的圖）、original（對齊縮成同樣大小的原圖）的像素，scale 同 traceRed。回傳 [{ points, bolts?, anchors? }]：bolts 由下往上，anchors（確保站）左到右；只標了確保站的路線 points 是空的 */
export function traceDiff(annotated, original, scale = 1, expected = 0) {
  const { data, width: w, height: h } = annotated, o = original.data;
  const mask = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) if (isMark(data, o, p)) mask[i] = 1;
  let lines = trace(mask.slice(), annotated, scale, true, expected);
  if (lines.length && !(expected > lines.length)) return lines;
  // 還是少：黃筆（接線）也算進去再找一次（同 traceRed），數量更接近（不超過）照片上的路線數才採用
  for (let i = 0, p = 0; i < w * h; i++, p += 4) if (isYellow(data[p], data[p + 1], data[p + 2]) && Math.hypot(data[p] - o[p], data[p + 1] - o[p + 1], data[p + 2] - o[p + 2]) > 70) mask[i] = 1;
  const more = trace(mask.slice(), annotated, scale, true, expected);
  if (more.length > lines.length && more.length <= expected) lines = more;
  if (lines.length && !(expected > lines.length)) return lines;
  // 不是紅筆：跟原圖差很多、而且是飽和的顏色（藍、綠、橘、紫…，任何色相）都算筆跡
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const [, sat, val] = hsv(data[p], data[p + 1], data[p + 2]);
    if (sat >= 0.5 && val >= 110 && Math.hypot(data[p] - o[p], data[p + 1] - o[p + 1], data[p + 2] - o[p + 2]) > 70) mask[i] = 1;
  }
  const any = trace(mask, annotated, scale, true, expected);
  return any.length > lines.length && (!lines.length || any.length <= expected) ? any : lines;
}

/** 作者畫上去的筆跡：跟原圖的顏色差很多，而且是偏紅的鮮豔顏色（路線書都用紅筆；陰影、反光、葉子的差異不算） */
function isMark(data, orig, p) {
  const r = data[p], g = data[p + 1], b = data[p + 2];
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max !== r || max < 110 || (max - min) / max < 0.4) return false;
  const hue = ((g - b) / (max - min)) * 60;
  return hue <= 25 && hue >= -25 && Math.hypot(r - orig[p], g - orig[p + 1], b - orig[p + 2]) > 70;
}

/** 筆跡（mask）→ 線段；withBolts 為真時也把小記號當 bolt */
function trace(red, image, scale, withBolts, expected = 0) {
  const { data, width: w, height: h } = image;
  const white = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) if (isWhite(data[p], data[p + 1], data[p + 2])) white[i] = 1;
  // 白底名牌（寬扁、填滿的白塊）裡的紅字不是路線
  const wc = components(white, w, h);
  for (const box of wc.boxes.slice(1)) {
    const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
    if (box.area < 150 || bw < 2.2 * bh || box.area / (bw * bh) < 0.6) continue;
    for (let y = Math.max(0, box.y0 - 3); y <= Math.min(h - 1, box.y1 + 3); y++) red.fill(0, y * w + Math.max(0, box.x0 - 3), y * w + Math.min(w, box.x1 + 4));
  }
  const diag = Math.hypot(w, h);
  // 補虛線的空隙：膨脹後同一塊的算同一條
  const grown = dilate(red, w, h, Math.max(1, Math.round(diag * 0.006)));
  const { label, boxes } = components(grown, w, h);
  const out = [], lineIds = new Set(), comps = [];
  for (let id = 1; id < boxes.length; id++) {
    const box = boxes[id];
    if (Math.max(box.x1 - box.x0, box.y1 - box.y0) < diag * 0.08) continue;
    // 這塊裡真的有夠多紅色像素（不是膨脹出來的空殼）
    let count = 0;
    for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) if (label[y * w + x] === id && red[y * w + x]) count++;
    if (count < diag * 0.05) continue;
    const bw = box.x1 - box.x0 + 3, bh = box.y1 - box.y0 + 3, m = new Uint8Array(bw * bh);
    for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) if (label[y * w + x] === id) m[(y - box.y0 + 1) * bw + (x - box.x0 + 1)] = 1;
    const skeleton = thin(m, bw, bh);
    comps.push({ skeleton, box, bw, bh });
    const path = longestPath(skeleton, bw, bh).map(([x, y]) => [x + box.x0 - 1, y + box.y0 - 1]);
    if (path.length < 2) continue;
    lineIds.add(id);
    const ordered = path[0][1] < path[path.length - 1][1] ? path.reverse() : path;
    for (const part of splitFork(ordered, diag * 0.12)) {
      const pts = simplify(startCircle(part, diag * 0.05), diag * 0.006);
      if (lengthOf(pts) < diag * 0.1) continue;   // 文字、抱石墊這類短的碎片
      const ys = pts.map(p => p[1]);
      if (Math.max(...ys) - Math.min(...ys) < diag * 0.025) continue;   // 平的一行：名牌上的字（路線一定會往上）
      out.push({ points: pts });
    }
  }
  // 找到的線比照片上的路線少：有路線共用一段（共線），改成找蓋住所有筆跡的由下往上的路徑；數量對不上就維持原樣
  if (expected > out.length) {
    const split = comps.flatMap(({ skeleton, box, bw, bh }) => coverPaths(skeleton, bw, bh, diag)
      .map(line => line.map(([x, y]) => [x + box.x0 - 1, y + box.y0 - 1]))
      .filter(pts => lengthOf(pts) >= diag * 0.1).map(points => ({ points })));
    if (split.length > out.length && split.length <= expected) out.splice(0, out.length, ...split);
  }
  if (withBolts) addBolts(out, red, label, lineIds, w, h, diag);
  const px = ([x, y]) => [Math.round((x + 0.5) * scale), Math.round((y + 0.5) * scale)];
  return sortLines(out.map(l => ({ points: l.points.map(px), ...(l.bolts?.length ? { bolts: l.bolts.map(px) } : {}), ...(l.anchors ? { anchors: l.anchors.map(px) } : {}) })), diag, scale);
}

/** 起點由左到右排；共用起點的，頂端在左邊的排前面 */
function sortLines(lines, diag, scale) {
  return lines.sort((a, b) => {
    const [pa, pb] = [a.points[0] ?? a.anchors[0], b.points[0] ?? b.anchors[0]], d = pa[0] - pb[0];
    return Math.abs(d) > diag * 0.004 * scale ? d : (a.points.at(-1) ?? pa)[0] - (b.points.at(-1) ?? pb)[0];
  });
}

/** 點到折線的距離 */
function distToLine(p, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]], dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
  }
  return best;
}

/** 小記號（X）→ bolt：不屬於線的小塊、不是實心的點。靠近線的給那條線；其他照左右分串，三個以上、上下排開的一串就是一條只有 bolt 的路線（bolt 連成線） */
function addBolts(lines, mask, grownLabel, lineIds, w, h, diag) {
  const { boxes } = components(mask, w, h);
  const marks = [];
  for (const b of boxes.slice(1)) {
    const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1, span = Math.max(bw, bh);
    if (span < diag * 0.004 || span > diag * 0.03 || Math.min(bw, bh) < span * 0.4 || b.area / (bw * bh) > 0.92) continue;
    const c = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
    if (lineIds.has(grownLabel[Math.round(c[1]) * w + Math.round(c[0])])) continue;   // 線的一部分（箭頭、起攀圈）
    marks.push(c);
  }
  // 名牌上的字：同一列、左右挨著好幾個的是文字，不是 bolt（bolt 是一串由下往上）
  const row = (m) => marks.filter(n => n !== m && Math.abs(n[1] - m[1]) < diag * 0.01 && Math.abs(n[0] - m[0]) < diag * 0.08).length >= 3;
  const kept = marks.filter(m => !row(m));
  const loose = [];
  for (const m of kept) {
    let best, bestD = diag * 0.04;
    for (const l of lines) { const d = distToLine(m, l.points); if (d < bestD) { best = l; bestD = d; } }
    if (best) (best.bolts ||= []).push(m); else loose.push(m);
  }
  loose.sort((a, b) => a[0] - b[0]);
  // 確保站：兩個記號差不多一樣高、左右挨著
  const pair = (a, b) => Math.abs(a[1] - b[1]) < diag * 0.02 && Math.abs(a[0] - b[0]) < diag * 0.06;
  let chain = [];
  // 一串至少三個、上下排開（高比寬大）是一條路線；只有並排的兩個是只標了確保站的路線（傳統攀）；其他是雜訊
  const flush = () => {
    const xs = chain.map(p => p[0]), ys = chain.map(p => p[1]);
    if (chain.length === 2 && pair(...chain)) lines.push({ points: [], bolts: [...chain] });
    else if (chain.length >= 3 && Math.max(...ys) - Math.min(...ys) > Math.max(...xs) - Math.min(...xs)) {
      const pts = [...chain].sort((a, b) => b[1] - a[1]);
      lines.push({ points: pts.map(p => [...p]), bolts: pts });
    }
    chain = [];
  };
  for (const m of loose) { if (chain.length && m[0] - chain.at(-1)[0] > diag * 0.06) flush(); chain.push(m); }
  flush();
  // 由下往上排；最上面兩個並排的是確保站（左到右），其他是 bolt
  for (const l of lines) {
    if (!l.bolts) continue;
    l.bolts.sort((a, b) => b[1] - a[1]);
    const [p, q] = l.bolts.slice(-2);
    if (l.bolts.length >= 2 && pair(p, q)) l.anchors = l.bolts.splice(-2).sort((a, b) => a[0] - b[0]);
  }
}

