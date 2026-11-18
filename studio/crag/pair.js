// 找路線書的圖的原圖（同一次快門、比較大的那張）：路線書的圖常是裁切、縮小、調過亮度、畫了紅線的，所以不比整張的長相，改成三步：
//   1. 特徵點（紅點貓的 match.js：AKAZE＋單應性）找候選：每張大的照片跟每張小的比（同一個岩場的照片紋理很像，粗比後做完整比對的放寬到 12 張），內點夠多的前三名
//   2. 原圖裁出對應的區域（多留 15%）再算一次特徵點、比一次：裁到只剩四成的圖也對得很準（線的誤差約 1～2 像素）
//   3. 對齊後逐像素比灰階的相關係數（alignScore）：同一次快門 0.8 以上，同一面岩壁的連拍、換位置拍的低很多；取最高、門檻 SAME
// 用 48 張故意裁切（四成到全張）、縮小（480～1000 px）、轉 3 度、調亮度、畫紅線的大邱田照片定的門檻，連拍的反例最高 0.73。
import { features, match } from './match.js';
import { applyH, alignScore, grayBlob } from './trace.js';

const T = (...a) => globalThis.AppKit.i18n.t(...a);   // 文字在呼叫時才查（Node 測試也載入這個檔）

const SAME = 0.78, COARSE_MIN = 8, FULL_MATCH = 12, REFINED_MIN = 30, MARGIN = 0.15, GUIDE_W = 256, ORIGINAL_W = 640;

/** 兩個 3×3 矩陣相乘（列優先） */
const mul = (A, B) => [0, 1, 2].flatMap(i => [0, 1, 2].map(j => A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]));

/**
 * photos：[{ id, w, h }]（照片畫面）；image(畫面) → 圖檔 Blob；feats(畫面) → 特徵點（match.js 的 features，呼叫的人可以快取）。
 * involve：照片 id 的清單，只找至少一張在裡面的配對（匯入新照片時）；沒給就是全部。notGuides：只能當原圖的照片 id（匯入的、轉換時一起選的：使用者拿來換路線書圖的原圖，裡面常有縮小的副本，不能讓它們搶走原圖）。
 * 回傳 [{ guide, original, H, score }]：guide 是被換掉的那張（比較小），H 把它的畫面座標換成 original 的畫面座標；一張照片只配一次
 */
export async function findOriginals(photos, { image, feats, involve, notGuides = [], onProgress = () => {} }) {
  const proposals = [];
  const inv = (p) => !involve || involve.includes(p.id);
  const smallerThan = (o) => photos.filter(g => g !== o && !notGuides.includes(g.id) && g.w * g.h < o.w * o.h && (inv(o) || inv(g)));
  const big = photos.filter(o => smallerThan(o).length);
  for (const [i, o] of big.entries()) {
    onProgress(T('cgFindOriginals'), i + 1, big.length);
    const smaller = smallerThan(o);
    const refs = [];
    for (const g of smaller) refs.push({ id: g.id, f: await feats(g) });
    const r = await match(await feats(o), refs, { min: COARSE_MIN, top: FULL_MATCH });
    for (const c of r.candidates) proposals.push({ guide: photos.find(p => p.id === c.id), original: o, inliers: c.inliers, H: c.H });
  }
  // 每張小圖最多驗三個候選（內點多的先）
  const byGuide = new Map();
  for (const p of proposals.sort((a, b) => b.inliers - a.inliers)) {
    const list = byGuide.get(p.guide.id) ?? byGuide.set(p.guide.id, []).get(p.guide.id);
    if (list.length < 3) list.push(p);
  }
  const verified = [];
  const grays = new Map();
  const grayOf = async (v, width) => grays.get(`${v.id}:${width}`) ?? grays.set(`${v.id}:${width}`, await grayBlob(await image(v), width, v.w)).get(`${v.id}:${width}`);
  let k = 0;
  for (const list of byGuide.values()) {
    onProgress(T('cgVerifyOriginals'), ++k, byGuide.size);
    for (const p of list) {
      const H = await refine(p, image, feats);
      if (!H) continue;
      const score = alignScore(await grayOf(p.guide, GUIDE_W), await grayOf(p.original, ORIGINAL_W), H);
      if (score >= SAME) verified.push({ guide: p.guide, original: p.original, H, score });
    }
  }
  return choosePairs(verified);
}

/**
 * 驗證過的配對 [{ guide, original, score }] → 一對一的配對。路線書常把同一張照片放兩次（整張和裁切的特寫）：
 * 本身還找得到更大原圖的照片不當原圖（換成它的原圖），同一張原圖配到好幾張時先配最大的那張（整張的），特寫留著；一張配到好幾張原圖時用最大的（使用者的照片裡常有縮小的副本），一樣大的分數高的先
 */
export function choosePairs(verified) {
  const asGuide = new Set(verified.map(v => v.guide.id)), area = (p) => p.w * p.h;
  const used = new Set(), out = [];
  for (const v of verified.filter(v => !asGuide.has(v.original.id)).sort((a, b) => area(b.guide) - area(a.guide) || area(b.original) - area(a.original) || b.score - a.score)) {
    if (used.has(v.guide.id) || used.has(v.original.id)) continue;
    used.add(v.guide.id); used.add(v.original.id);
    out.push(v);
  }
  return out;
}

/** 原圖裁出對應的區域再比一次：回傳精準的 H（路線書畫面 → 原圖畫面），比不出來回 null */
async function refine({ guide, original, H }, image, feats) {
  const cs = [[0, 0], [guide.w, 0], [guide.w, guide.h], [0, guide.h]].map(p => applyH(H, p));
  const xs = cs.map(p => p[0]), ys = cs.map(p => p[1]);
  const mx = (Math.max(...xs) - Math.min(...xs)) * MARGIN, my = (Math.max(...ys) - Math.min(...ys)) * MARGIN;
  const x0 = Math.max(0, Math.min(...xs) - mx), y0 = Math.max(0, Math.min(...ys) - my);
  const x1 = Math.min(original.w, Math.max(...xs) + mx), y1 = Math.min(original.h, Math.max(...ys) + my);
  if (!(x1 - x0 > 50 && y1 - y0 > 50)) return null;
  const bmp = await createImageBitmap(await image(original));
  const k = bmp.width / original.w;   // 圖檔像素 ÷ 畫面座標（存的圖就是畫面的大小，保險起見照算）
  const c = new OffscreenCanvas(Math.round((x1 - x0) * k), Math.round((y1 - y0) * k));
  c.getContext('2d').drawImage(bmp, x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k, 0, 0, c.width, c.height);
  bmp.close();
  const r = await match(await features(await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 }), x1 - x0), [{ id: guide.id, f: await feats(guide) }], { min: REFINED_MIN });
  const best = r.best ?? r.candidates[0];
  return best ? mul([1, 0, x0, 0, 1, y0, 0, 0, 1], best.H) : null;
}
