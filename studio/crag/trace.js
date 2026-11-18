// Studio 的描線：取像素（瀏覽器的 canvas）與兩張照片的對齊；描線的純運算在 sourcekit/trace.js（紅點貓收藏共用）。
import { TRACE_EDGE, traceRed, traceDiff, traceTopo } from '../../sourcekit/trace.js';
export { TRACE_EDGE, traceRed, traceDiff };

/** 瀏覽器：圖檔的像素，縮到長邊 edge（或指定的 w、h） */
async function pixels(blob, { edge = TRACE_EDGE, w, h } = {}) {
  const bitmap = await createImageBitmap(blob);
  const k = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  w ??= Math.round(bitmap.width * k); h ??= Math.round(bitmap.height * k);
  const cv = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const image = g.getImageData(0, 0, w, h);
  cv.width = cv.height = 0;
  return image;
}

/** 瀏覽器：圖檔縮到長邊 TRACE_EDGE 再找紅筆；座標換成照片畫面的像素（photoW 是照片畫面的寬） */
export async function traceBlob(blob, photoW, expected = 0) {
  const image = await pixels(blob), scale = photoW / image.width;
  // 線（紅筆；不是紅的、白虛線交給 tracePen）；找不到線的號碼牌至少標出起點（at、size、color），照左到右跟線一起排
  const { lines, badges } = traceTopo(image, scale, expected);
  const tags = badges.filter(b => b.line === null).map(b => ({ points: [], at: b.point, size: b.size, color: b.color, text: b.text }));
  const start = (l) => (l.at ?? l.points[0])[0];
  return [...lines, ...tags].sort((a, b) => start(a) - start(b));
}

/**
 * 瀏覽器：路線書的圖減掉作者的原始照片（expected：照片上有幾條路線，同 traceRed）。原圖照 H（路線書畫面座標 → 原圖畫面座標，pair.js 找的）對齊到路線書的圖再相減，
 * 所以路線書的圖裁切、縮放、轉一點都可以；回傳的座標是原圖畫面的像素（annotatedW、originalW 是兩張畫面的寬）
 */
export async function traceDiffBlobs(annotated, original, H, annotatedW, originalW, expected = 0) {
  const a = await pixels(annotated), k = annotatedW / a.width;
  const o = await pixels(original, { edge: 2 * TRACE_EDGE });
  const lines = traceDiff(a, warp(o, H, a.width, a.height, k, o.width / originalW), k, expected);
  const at = (p) => applyH(H, p).map(Math.round);
  return lines.map(l => ({ points: l.points.map(at), ...(l.bolts ? { bolts: l.bolts.map(at) } : {}), ...(l.anchors ? { anchors: l.anchors.map(at) } : {}) }));
}

/** 單應性 H（3×3，列優先）作用在一點 */
export const applyH = (H, [x, y]) => { const w = H[6] * x + H[7] * y + H[8]; return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w]; };

/**
 * 原圖對齊到路線書的圖：回傳跟路線書的像素一樣大（w×h）的影像，每個像素照 H 到原圖取樣（取不到的是透明）。
 * k：路線書畫面座標 ÷ 像素；ko：原圖像素 ÷ 原圖畫面座標
 */
export function warp(o, H, w, h, k, ko) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [X, Y] = applyH(H, [(x + 0.5) * k, (y + 0.5) * k]);
    const ox = Math.floor(X * ko), oy = Math.floor(Y * ko);
    if (ox < 0 || oy < 0 || ox >= o.width || oy >= o.height) continue;
    const p = (y * w + x) * 4, q = (oy * o.width + ox) * 4;
    out[p] = o.data[q]; out[p + 1] = o.data[q + 1]; out[p + 2] = o.data[q + 2]; out[p + 3] = 255;
  }
  return { data: out, width: w, height: h };
}

/** 瀏覽器：灰階的小圖，給 alignScore 比：{ v, red（紅筆的像素）, w, h, k（像素 ÷ 畫面座標） }；viewW 是照片畫面的寬 */
export async function grayBlob(blob, width, viewW) {
  const image = await pixels(blob, { edge: width });
  return gray(image, image.width / viewW);
}
export function gray({ data, width, height }, k) {
  const v = new Float32Array(width * height), red = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < v.length; i++, p += 4) {
    v[i] = 0.3 * data[p] + 0.59 * data[p + 1] + 0.11 * data[p + 2];
    red[i] = isMarkColor(data[p], data[p + 1], data[p + 2]) ? 1 : 0;
  }
  return { v, red, w: width, h: height, k };
}

/**
 * 兩張是不是同一次快門：原圖照 H 對齊到路線書的圖後，灰階的相關係數（-1～1，紅筆的像素不算；重疊不到一半是 -1）。
 * 同一張裁切、縮放、加了標註、調了亮度的大約 0.8 以上；同一面岩壁的連拍、換個位置拍的低很多
 */
export function alignScore(g, o, H) {
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const i = y * g.w + x;
    if (g.red[i]) continue;
    const [X, Y] = applyH(H, [(x + 0.5) / g.k, (y + 0.5) / g.k]);
    const ox = Math.floor(X * o.k), oy = Math.floor(Y * o.k);
    if (ox < 0 || oy < 0 || ox >= o.w || oy >= o.h) continue;
    const a = g.v[i], b = o.v[oy * o.w + ox];
    n++; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b;
  }
  if (n < g.w * g.h * 0.5) return -1;
  const cov = sab / n - (sa / n) * (sb / n), va = saa / n - (sa / n) ** 2, vb = sbb / n - (sb / n) ** 2;
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : -1;
}
/** 紅筆的顏色（粗分，給 alignScore 排除筆跡） */
const isMarkColor = (r, g, b) => r > 120 && r - g > 60 && r - b > 50;
