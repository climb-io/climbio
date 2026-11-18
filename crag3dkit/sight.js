// 遮擋表：從各個方向看，路線每個點被岩壁擋住的表（作者端算好，格式見 format/VOCABULARY.md「3D 岩場」）。純函式，沒有 DOM、沒有 WebGL，Node 也能跑。
// English: precomputed occlusion tables for route points; pure functions (decode, per-point visibility from a viewpoint).

/** 遮擋表：base64 的 deflate（raw）→ 每個點 az×el 個 4 位元的值（一個位元組放兩個，低 4 位元在前） */
export async function readSight(b64) {
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
}

const deg = (r) => (r * 180) / Math.PI;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * 路線的每個點，從 from 看得到嗎。table 是 readSight 的結果（沒有表就都看得到）；spec 是圖層的 props.sight（{ az, el: [起始仰角, 每格度數, 格數], dist }）；
 * pts：[[x, y, z]…]；from：[x, y, z]；out：選用，寫進這個 Uint8Array（每格都要算時不用每次配一個新的）。看得到的點中間夾著 fill 點以內看不到的，當成看得到：查表 10° 一格，轉角、岩縫附近會零星誤判，放大看就是一小段斷線。
 * 回傳 { vis: Uint8Array（1 看得到）, seen: 看得到的比例 0–1 }
 */
export function routeVisibility({ table, spec, pts, from, fill = 3, out }) {
  const [AZ, [EL0, EL_STEP, EL_N], DIST] = spec ? [spec.az, spec.el, spec.dist] : [1, [0, 1, 1], []];
  const vis = out ?? new Uint8Array(pts.length);
  for (let i = 0; i < pts.length; i++) {
    const dx = from[0] - pts[i][0], dy = from[1] - pts[i][1], dz = from[2] - pts[i][2], d = Math.hypot(dx, dy, dz);
    let ok = true;
    if (table && d > 0) {
      const a = ((Math.round(Math.atan2(dx / d, dz / d) / (2 * Math.PI) * AZ) % AZ) + AZ) % AZ;
      const e = clamp(Math.round((deg(Math.asin(clamp(dy / d, -1, 1))) - EL0) / EL_STEP), 0, EL_N - 1);
      const k = (i * EL_N + e) * AZ + a, v = (table[k >> 1] >> ((k & 1) * 4)) & 15;
      ok = !v || d <= DIST[v - 1];
    }
    vis[i] = ok ? 1 : 0;
  }
  for (let i = 0; i < pts.length;) {
    if (vis[i]) { i++; continue; }
    let j = i;
    while (j < pts.length && !vis[j]) j++;
    if (i > 0 && j < pts.length && j - i <= fill) vis.fill(1, i, j);
    i = j;
  }
  let n = 0;
  for (let i = 0; i < pts.length; i++) n += vis[i];
  return { vis, seen: pts.length ? n / pts.length : 0 };
}
