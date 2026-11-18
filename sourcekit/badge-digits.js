// 號碼牌上白色號碼的辨識（0～9，一個字一個字比對樣板）：不依賴套件、不碰 DOM，網頁、擴充功能、Node 都能跑。
// 樣板是 16×24 的格子（每格 0～f 的灰階），來源：
//   0、2～9：Liberation Sans Bold（SIL Open Font License 1.1）的字形縮成 16×24；
//   1：從路線書的號碼牌取平均（Liberation 的 1 有底座，路線書的 1 沒有，會被認成 3）。
// 量過：香港攀岩 2025 年 Miniguide 的 171 個號碼牌，讀到的數字落在該頁路線編號裡的有 91%。字型不同的號碼牌讀不準；呼叫的人要拿頁面上的路線編號對照，對不上就不要用。
// English: tiny template matcher for the white digits on route-number badges (Liberation Sans Bold rasters, OFL-1.1, plus an averaged "1").

const GW = 16, GH = 24;
/** 樣板的格子資料（測試用：把數字畫成號碼牌看讀不讀得回來） */
export const DIGIT_CELLS = {
  0: { aspect: 0.667, cells: '00027adfffb72000001affffffffa300019ffffffffffa1007ffffdaadffff700afffe5003bfffc24efff800006ffff68ffff400004ffffaaffff400001cfffaafffa000000affffcfffa000000affffffffa000000affffffffa000000affffffffa000000affffffffa000000affffcfffa000000affffafffa000000affffaffff400001cfffa7ffff400004ffff84efff800006fffe408fffe5003bfffa003efffdaadfffe50008ffffffffff8000018dffffffd8100000039dffda50000' },
  1: { aspect: 0.44, cells: '0000000000cdfffe0000000022defffe000000128affffff00000167efffffff445589eeffffffffaaaaccefffffffffffffffffffffffffddddddddeeffffff2222222278ffffff0000000056ffffff0000000057ffffff0000000057ffffff0000000057ffffff0000000057ffffff0000000057ffffff0000000057ffffff0000000057ffffff0000000057ffffff0000000057ffffff0000000057ffffff0000000057ffffff0000000067ffffff0000000067ffffff0000000057ffffff' },
  2: { aspect: 0.679, cells: '00038bffffb83000005dffffffffd60003effffffffffe503dffffdaacffffd37ffffb3002bffff8affff500005ffffa37aa8100004ffffa00000000004ffffa00000000006ffffa0000000002cfffd3000000002affff8000000002affffc200000005dffffd400000004dffffd500000005cffffb30000001affffd8100000006fffff5000000002bffffa000000002cfffe50000000008ffff90000000000dffffcaaaaaaaaaaffffffffffffffffffffffffffffffffffffffffffffffff' },
  3: { aspect: 0.684, cells: '00028aefffc93000003affffffffd60003cffffffffffe602affffcaacffffd35ffffd4003affff89fffd400003dfffa358a8000000bfffa00000000000bfffa00000000005efff50000000005dfffa2000004bbbeffe810000005fffffa3000000005fffffb8400000004bbbdfffe810000000003affff800000000002bfffd001530000008ffffaabf90000008ffffcfffd3000008ffff8ffffa30017efffd3dffffcaabfffff804cfffffffffffb3004cfffffffffa2000028aefffca7100' },
  4: { aspect: 0.782, cells: '000000009ffff80000000003effff80000000008fffff8000000004dfffff800000001cffdfff800000006ffc8fff80000001bff7afff80000006ffb1afff8000002bff60afff8000007ffc10afff800004efe500afff80000aff9000afff80003efe4000afff80008ff80000afff8005efd30000afff800cffa55555cfffa55ffffffffffffffffffffffffffffffffffffffffffffffff555555555cfffa55000000000afff800000000000afff800000000000afff800000000000afff800' },
  5: { aspect: 0.696, cells: '0affffffffffffa00affffffffffffa00affffffffffffa00afff855555555302cfff500000000005ffff500000000005fffb000000000005fffb000000000005fffb048aa8520005fffecffffffd6005ffffffffffffe507fffffffffffffc2afffe81003affffa35554000002cfffd000000000009ffff000000000008ffff000000000008ffff003530000009ffffffff9000003efffccfffe71004cffff88fffffbaacffffc205effffffffffb20006dffffffffc40000039cfffea82000' },
  6: { aspect: 0.667, cells: '000028cfffca50000005cfffffffd600006efffffffffe5002cffffcacffffd307fffe72029ffff73cfff800002aa8857ffff40000000000afffc10000000000afffa025aaa73000dfffa4cfffffd500ffffccfffffffe81ffffffdaacfffff7fffffc5002bffffafffff600003cfffeffffd3000008ffffdfffa0000005ffffafffd3000005ffff8ffff4000008ffff4efff800003cfffe08fffe7202bffffa03effffcacffffd5008ffffffffffe600017dfffffffd600000039cfffc83000' },
  7: { aspect: 0.673, cells: 'ffffffffffffffffffffffffffffffffffffffffffffffffbbbbbbbbbbbcfffe00000000002afff800000000007fffc20000000004effe50000000000afff700000000005effc20000000002cfff80000000001afffc20000000005ffff700000000009fffc20000000003dfff600000000008fffc20000000003dfff900000000007ffff60000000001bfffe30000000004ffffa00000000005ffffa00000000008ffff600000000008ffff500000000008ffff500000000008ffff50000000' },
  8: { aspect: 0.684, cells: '00039cffffc83000006dffffffffd50006effffffffffe503dfffd8559ffffc28ffff70001affff5afffc100004efff8afffb000000bfff88fffb000003efff53dfff70001afffc207fffd8559fffe50017cfffffffea5000018fffffffc510002affffffffffa204bfffb5446bfffb3cfffb200002cfff8ffff8000000afffdffff80000008ffffffff80000008ffffffff8000000afffecfffe500005efffa8ffffd6558dffff718effffffffffe81006dffffffffd60000039cffffc93000' },
  9: { aspect: 0.667, cells: '00038bfffda72000005dffffffffa30005effffffffffb103dffffdaadffff808ffffb3005efffd3cffff500007ffff8ffffc100003dfffaffffa000000afffdffffa000000affffffffc100001cffffbffff600005fffff8ffffb3003bfffff3dffffdaadffffff04cfffffffd9ffff004cfffffc55ffff000259aa5208ffff00000000000afffa00000000003dfffa588aa200008fffe57ffff92027efff803dffffcacffffe3005effffffffff800006dfffffffd71000005acfffc930000' }
};
const TEMPLATES = Object.entries(DIGIT_CELLS).map(([digit, t]) => ({ digit: Number(digit), aspect: t.aspect, v: Float32Array.from(t.cells, (c) => parseInt(c, 16) / 15) }));

/** 遮罩（0/1，w×h）的外框縮成 GW×GH 的格子；沒有任何像素是 null */
function normalize(mask, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (x1 < 0) return null;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, v = new Float32Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    let s = 0, n = 0;
    const ya = y0 + (gy * bh) / GH, yb = y0 + ((gy + 1) * bh) / GH, xa = x0 + (gx * bw) / GW, xb = x0 + ((gx + 1) * bw) / GW;
    for (let y = Math.floor(ya); y < Math.max(Math.ceil(yb), Math.floor(ya) + 1); y++) for (let x = Math.floor(xa); x < Math.max(Math.ceil(xb), Math.floor(xa) + 1); x++) { s += mask[Math.min(h - 1, y) * w + Math.min(w - 1, x)]; n++; }
    v[gy * GW + gx] = s / n;
  }
  return { v, aspect: bw / bh };
}

/** 一個字（正規化後）最像哪個數字 */
function matchGlyph(g) {
  let best = { d: Infinity, digit: -1 };
  for (const t of TEMPLATES) {
    let s = 0;
    for (let i = 0; i < g.v.length; i++) s += (g.v[i] - t.v[i]) ** 2;
    const d = Math.sqrt(s / g.v.length) + 0.35 * Math.abs(Math.log(g.aspect / t.aspect));
    if (d < best.d) best = { d, digit: t.digit };
  }
  return best;
}

/**
 * 讀一個號碼牌上的號碼：image 是 { data, width, height }（RGBA），牌子中心 (cx, cy)、邊長 size（同一個像素座標）。
 * 牌子裡白色（很亮、幾乎沒有顏色）的連通塊就是字，由左到右一個字一個數字；沒有字或字太小（讀不準）回傳空字串。
 */
export function readBadgeText(image, cx, cy, size) {
  const { data, width, height } = image, half = Math.round(size / 2), inset = Math.round(size * 0.16);
  const x0 = Math.max(0, Math.round(cx) - half + inset), y0 = Math.max(0, Math.round(cy) - half + inset), x1 = Math.min(width - 1, Math.round(cx) + half - inset), y1 = Math.min(height - 1, Math.round(cy) + half - inset);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (w < 6 || h < 8) return '';
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = ((y0 + y) * width + x0 + x) * 4, max = Math.max(data[p], data[p + 1], data[p + 2]), min = Math.min(data[p], data[p + 1], data[p + 2]);
    if (min > 165 && (max - min) / max < 0.3) mask[y * w + x] = 1;
  }
  const label = new Int32Array(w * h), glyphs = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || label[s]) continue;
    const id = glyphs.length + 1, stack = [s], pixels = [];
    label[s] = id;
    while (stack.length) {
      const p = stack.pop(), x = p % w, y = (p - x) / w;
      pixels.push(p);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (mask[q] && !label[q]) { label[q] = id; stack.push(q); }
      }
    }
    glyphs.push(pixels);
  }
  return glyphs
    .filter((px) => px.length >= Math.max(6, w * h * 0.02))
    .map((px) => { const m = new Uint8Array(w * h); let sum = 0; for (const p of px) { m[p] = 1; sum += p % w; } return { m, cx: sum / px.length }; })
    .sort((a, b) => a.cx - b.cx)
    .map((g) => { const n = normalize(g.m, w, h); return n ? String(matchGlyph(n).digit) : ''; })
    .join('');
}
