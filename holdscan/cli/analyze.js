#!/usr/bin/env node
// 離線分析一面牆：照片 → 岩點資料包（holdkit SPEC.md），跟 App 同一套流程：偵測（holdscan）→ 依顏色描外框（holdkit）→
// MobileSAM 整面牆重描（holdkit/functions/sam.js）→ 整理外框（functions/tidy.js）。照片固定、不讓使用者自己加圖的網站，每面牆跑一次就好。
// --routes：圈點格式的路線（例如 RouteMake：[{ id, name, grade, author, holds: [{ x, y, t, r }] }]，或包成 { routes: [...] }），圈圈中心沒有對到偵測到的岩點，
//   就用圈圈的範圍當提示多描一顆；輸出多一個 routes（RouteKit 路線：holds 是岩點 id → s／h／t）。
// 用法：cd holdscan/cli && npm install && node analyze.js 照片.jpg [--routes routes.json] [--size 1280] > holds.json
// 記憶體約 1 GB；SAM_CPUS 是重描的解碼 Worker 數（預設 2）。
// English: offline wall analysis: photo -> hold pack, same pipeline as the app; optional circle routes (e.g. RouteMake) mapped onto the holds.
'use strict';
const path = require('path');
const fs = require('fs');
// 雲端函式的程式（偵測、重描）在別的資料夾，依賴用這裡裝的 node_modules
process.env.NODE_PATH = [path.join(__dirname, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
require('module').Module._initPaths();
process.env.SAM_CPUS = process.env.SAM_CPUS || '2';

const sharp = require('sharp');
const { detect } = require('../functions/handler.js');
const Core = require('../core/detect-core.js');
const HoldKit = require('../../holdkit/holdkit.js');
const { refineAll } = require('../../holdkit/functions/sam.js');
const { tidy } = require('../../functions/tidy.js');
const { fromCircles, CIRCLE_DIAMETER } = require('../../routekit/circles.js');
const { inPoly } = require('../../routekit/geometry.js');

const SAM_SIDE = 1024;

function args(argv) {
  const o = { photo: null, routes: null, size: Core.MODEL_SIZE };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--routes') o.routes = argv[++i];
    else if (argv[i] === '--size') o.size = Number(argv[++i]);
    else if (!o.photo) o.photo = argv[i];
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!o.photo) throw new Error('usage: node analyze.js photo.jpg [--routes routes.json] [--size 1280|2048|2560]');
  if (!Core.SIZES.includes(o.size)) throw new Error(`--size must be one of ${Core.SIZES.join(', ')}`);
  return o;
}

// 分析用縮圖（holdkit.analysis 的結果，長邊 1200），Node 用 sharp 解碼
async function analysisOf(buf, W, H) {
  const s = Math.min(1, 1200 / Math.max(W, H)), w = Math.round(W * s), h = Math.round(H * s);
  const data = await sharp(buf).removeAlpha().resize(w, h, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
  return { data, w, h, s };
}

async function analyze({ photo, routes: routesFile, size }) {
  const buf = fs.readFileSync(photo);
  const parsed = routesFile ? JSON.parse(fs.readFileSync(routesFile, 'utf8')) : [];
  const circleRoutes = Array.isArray(parsed) ? parsed : parsed.routes;   // 路線陣列，或 { routes: [...] }
  if (!Array.isArray(circleRoutes) || !circleRoutes.every(r => Array.isArray(r.holds))) throw new Error('--routes: expected [{ holds: [{ x, y, t, r }] }]');
  const { boxes, w: W, h: H } = await detect(buf, size);
  const octx = HoldKit.outlineContext(await analysisOf(buf, W, H), boxes);
  const holds = boxes.map(([x0, y0, x1, y1], i) => ({
    id: `h${i + 1}`, poly: HoldKit.simplifyPoly(HoldKit.boxToPoly(x0, y0, x1, y1, octx)), source: 'detect', box: [x0, y0, x1, y1],
  }));
  // 圈點沒有對到岩點：圈圈範圍當框，重描時一起切
  let extra = 0;
  for (const r of circleRoutes) for (const c of r.holds) {
    const x = c.x / 100 * W, y = c.y / 100 * H;
    if (holds.some(h => inPoly(x, y, h.poly))) continue;
    const d = (CIRCLE_DIAMETER[c.r] || CIRCLE_DIAMETER[2]) * W / 2, box = [x - d, y - d, x + d, y + d];
    holds.push({ id: `c${++extra}`, poly: HoldKit.boxToPoly(...box, octx), source: 'detect', box });
  }
  // MobileSAM 重描：照片縮到長邊 1024，框跟著縮；切不出來的留顏色描的外框
  const k = SAM_SIDE / Math.max(W, H);
  const jpeg = await sharp(buf).removeAlpha().resize(Math.round(W * k), Math.round(H * k), { fit: 'fill' }).jpeg({ quality: 92 }).toBuffer();
  const traced = await refineAll(jpeg, holds.map(h => ({ id: h.id, box: h.box.map(v => v * k), c: [(h.box[0] + h.box[2]) / 2 * k, (h.box[1] + h.box[3]) / 2 * k] })));
  const byId = new Map(traced.holds.map(t => [t.id, t.poly]));
  for (const h of holds) {
    const p = byId.get(h.id);
    if (p && p.length >= 3) h.poly = HoldKit.simplifyPoly(p.map(([x, y]) => [+(x / k).toFixed(1), +(y / k).toFixed(1)]));
    delete h.box;
  }
  // 整理外框：同一顆框兩次的合併、相鄰互相吃進去的切開；圈點用到的不刪
  const used = new Set();
  for (const r of circleRoutes) for (const c of r.holds) {
    const x = c.x / 100 * W, y = c.y / 100 * H;
    for (const h of holds) if (inPoly(x, y, h.poly)) used.add(h.id);
  }
  const t = tidy(holds.map(h => ({ ...h, fixed: 0, keep: used.has(h.id) ? 1 : 0 })), W);
  const gone = new Set(t.removed);
  const out = holds.filter(h => !gone.has(h.id)).map(h => ({ ...h, poly: t.polys[h.id] || h.poly }));
  const pack = { w: W, h: H, thumb: '', holds: out };
  if (routesFile) pack.routes = circleRoutes.map(({ holds: circles, ...meta }) => ({ ...meta, ...fromCircles(circles, W, H, { holds: out }) }));
  return pack;
}

if (require.main === module) {
  analyze(args(process.argv.slice(2))).then((pack) => {
    process.stdout.write(JSON.stringify(pack) + '\n');
    process.exit(0);   // 重描的解碼 Worker 還開著
  }, (e) => { console.error(e.message || e); process.exit(1); });
}

module.exports = { analyze };
