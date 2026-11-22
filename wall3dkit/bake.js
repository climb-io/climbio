// 3D 牆的烘焙（Climbio Studio 發佈時跑，岩點貓不跑）：把「模型＋Studio 的修改」變成成品——隱藏的面、裁切平面外的部分直接從模型拿掉
// （跨過切面的三角形沿平面切開），輸出標準 glTF 2.0（.glb，貼圖內嵌、不受光），任何 glTF 檢視器都看得到乾淨的牆。
// 手機（岩點貓）只讀成品，不再自己裁切、套修點、算淡出。純函式，不碰 DOM、WebGL（node 也能跑，見 test/bake.test.mjs）。
// English: Studio-side baking: removes hidden/cut geometry, writes a standard .glb; the phone only reads the result.

const dot = (n, p) => n[0] * p[0] + n[1] * p[1] + n[2] * p[2];
const lerp = (a, b, t) => a + (b - a) * t;

// 凸多邊形頂點：{ p: [x,y,z], uv: [u,v], f: 淡出 }。沿「s(p) ≥ 0 的那側」切開，回傳 [留下的 s≥0, 另一側 s<0]（沒有的給空陣列）
function split(poly, s) {
  const pos = [], neg = [], n = poly.length, val = poly.map(v => s(v.p));
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n], sa = val[i], sb = val[(i + 1) % n];
    (sa >= 0 ? pos : neg).push(a);
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb);
      const m = { p: [lerp(a.p[0], b.p[0], t), lerp(a.p[1], b.p[1], t), lerp(a.p[2], b.p[2], t)], uv: [lerp(a.uv[0], b.uv[0], t), lerp(a.uv[1], b.uv[1], t)], f: lerp(a.f, b.f, t) };
      pos.push(m); neg.push(m);
    }
  }
  return [pos.length >= 3 ? pos : [], neg.length >= 3 ? neg : []];
}

// 一個平面的「切掉的那一塊」是凸的：n·p < d（再扣 spare）且每個 bounds 都 ≥ e。把多邊形分成「在塊裡（丟掉）」和「在塊外（留下，可能是好幾塊）」
function outsideOf(poly, q, spare) {
  const keep = [];
  let rest = poly;
  const d = q.d - spare;
  let [inside, out] = split(rest, p => d - dot(q.n, p));   // s ≥ 0 ＝ n·p ≤ d：在切掉的那側
  if (out.length) keep.push(out);
  rest = inside;
  for (const [m, e] of q.bounds || []) {
    if (!rest.length) break;
    [inside, out] = split(rest, p => dot(m, p) - e);   // s ≥ 0 ＝ 在範圍內
    if (out.length) keep.push(out);
    rest = inside;
  }
  return keep;   // rest 是被切掉的，不要
}

// 把一個三角形（或凸多邊形）照所有裁切平面切完，回傳留下的凸多邊形們。spare(q)：這個平面對這個面讓出多少（岩點的面不被自動切面切到岩點間距內）
export function clipPolygon(poly, planes, spare = () => 0) {
  let pieces = [poly];
  for (const q of planes) {
    const sp = spare(q), next = [];
    for (const p of pieces) next.push(...outsideOf(p, q, sp));
    pieces = next;
    if (!pieces.length) break;
  }
  return pieces;
}

// 修點的外框照描的線切開網格：修點是從一個鏡頭描的多邊形，每條邊跟鏡頭位置定出一個平面，跨過外框的三角形沿這些平面切開，
// 切出來的小塊照重心投影在不在多邊形裡分給這顆或外面。這樣光暈和點選的範圍就是描的線（量體的直線邊是直線），
// 不會變成貼圖像素或三角面的鋸齒（量體的邊在側面，一個像素拉得很長）。
// cuts：[{ idx, faces（要看的面，原本的編號）, eye（鏡頭位置）, rays（多邊形每個頂點從鏡頭出去的方向）, poly（畫面座標）, project(p)→[x,y]|null, guests（裝在上面、留給自己的岩點編號） }]，座標都在模型的座標系。
// 回傳新的 positions/uvs/fade/index/faceLabels，和 parent（每個新三角形是原本第幾個）、inside（每個新三角形落在哪顆修點的外框裡，0 是都不在）
export function cutOutlines({ positions, uvs, fade, index, faceLabels, cuts, inside: within }) {
  const P = Array.from(positions), UV = Array.from(uvs), FD = fade ? Array.from(fade) : new Array(positions.length / 3).fill(0);
  const I = Array.from(index), L = Array.from(faceLabels), parent = L.map((_, f) => f), ins = new Array(L.length).fill(0);
  const kids = new Map();   // 原本的面 → 現在的面（切過的變好幾個）
  const get = (i) => ({ p: [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], uv: [UV[i * 2], UV[i * 2 + 1]], f: FD[i], k: i });
  const add = (v) => { if (v.k !== undefined) return v.k; const k = P.length / 3; P.push(...v.p); UV.push(...v.uv); FD.push(v.f); v.k = k; return k; };
  for (const c of cuts) {
    const n = c.poly.length, planes = [];
    for (let e = 0; e < n; e++) {
      const a = c.rays[e], b = c.rays[(e + 1) % n], nn = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const [x0, y0] = c.poly[e], [x1, y1] = c.poly[(e + 1) % n];
      planes.push({ n: nn, d: dot(nn, c.eye), box: [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)] });
    }
    const todo = [...c.faces].flatMap(f => kids.get(f) || [f]);
    for (const f of todo) {
      const v = [0, 1, 2].map(j => get(I[f * 3 + j]));
      if (v[0].k === v[1].k || v[1].k === v[2].k || v[0].k === v[2].k) continue;   // 隱藏的面
      const s = v.map(x => c.project(x.p));
      if (s.some(x => !x)) continue;
      const inV = s.map(([x, y]) => within(x, y, c.poly));
      const bx = [Math.min(s[0][0], s[1][0], s[2][0]), Math.min(s[0][1], s[1][1], s[2][1]), Math.max(s[0][0], s[1][0], s[2][0]), Math.max(s[0][1], s[1][1], s[2][1])];
      const cross = planes.filter(q => q.box[0] <= bx[2] && q.box[2] >= bx[0] && q.box[1] <= bx[3] && q.box[3] >= bx[1]);
      const L0 = L[f], label = (inP) => inP ? ((c.guests && c.guests.has(L0)) ? L0 : c.idx) : (L0 === c.idx ? 0 : L0);
      if (inV[0] === inV[1] && inV[1] === inV[2] && !cross.length) { L[f] = label(inV[0]); if (inV[0]) ins[f] = c.idx; continue; }
      let pieces = [v];
      for (const q of cross) pieces = pieces.flatMap(p => split(p, x => dot(q.n, x) - q.d).filter(x => x.length >= 3));
      const tris = [];
      for (const p of pieces) for (let k = 1; k < p.length - 1; k++) tris.push([p[0], p[k], p[k + 1]]);
      const orig = parent[f], list = kids.get(orig) || [f];
      tris.forEach((t, j) => {
        const g = j === 0 ? f : L.length;
        const ctr = [0, 1, 2].map(a => (t[0].p[a] + t[1].p[a] + t[2].p[a]) / 3), sc = c.project(ctr), inP = !!sc && within(sc[0], sc[1], c.poly);
        const lab = label(inP);
        if (j > 0) { I.push(0, 0, 0); L.push(lab); parent.push(orig); ins.push(0); list.push(g); } else L[g] = lab;
        I[g * 3] = add(t[0]); I[g * 3 + 1] = add(t[1]); I[g * 3 + 2] = add(t[2]);
        if (inP) ins[g] = c.idx;
      });
      kids.set(orig, list);
    }
  }
  return { positions: Float32Array.from(P), uvs: Float32Array.from(UV), fade: Float32Array.from(FD), index: Uint32Array.from(I), faceLabels: Uint16Array.from(L), parent: Uint32Array.from(parent), inside: Uint32Array.from(ins) };
}

// 自動的切面（地面、天花板、外緣拉直）切口外半個岩點間距內不切岩點，Studio 的切線（cut）照切：跟 stage.js 的 frameTest 同一條規則
const sparesHolds = (q) => q.kind !== 'cut';

// 烘焙網格：positions(3)、uvs(2)、fade（每個頂點，可省略）、index、faceLabels（每個三角形第幾顆岩點，0＝牆面）、planes、margin（岩點間距的一半）。
// 回傳新的 positions/uvs/fade/index/faceLabels，和 origin（每個新三角形是原來第幾個）：隱藏的面（index 縮成一點的）和切掉的拿掉，岩點的面照讓出岩點間距切
export function bakeMesh({ positions, uvs, fade, index, faceLabels, planes, margin = 0 }) {
  const tris = index.length / 3;
  const outP = [], outUV = [], outF = [], outI = [], outL = [], outO = [], map = new Map();
  const vertex = (v, orig) => {   // 原本的頂點沿用（共用），新切出來的各自一份
    if (orig !== undefined && map.has(orig)) return map.get(orig);
    const k = outP.length / 3;
    outP.push(v.p[0], v.p[1], v.p[2]); outUV.push(v.uv[0], v.uv[1]); outF.push(v.f);
    if (orig !== undefined) map.set(orig, k);
    return k;
  };
  const get = (i) => ({ p: [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]], uv: [uvs[i * 2], uvs[i * 2 + 1]], f: fade ? fade[i] : 0 });
  let removed = 0, clipped = 0;
  for (let f = 0; f < tris; f++) {
    const a = index[f * 3], b = index[f * 3 + 1], c = index[f * 3 + 2];
    if (a === b || b === c || a === c) { removed++; continue; }   // 隱藏的面
    const label = faceLabels[f], va = get(a), vb = get(b), vc = get(c);
    const spare = (q) => label && sparesHolds(q) ? margin : 0;
    // 整個三角形都在所有切塊外：原樣留下（最常見，不切）
    const pieces = clipPolygon([va, vb, vc], planes, spare);
    if (pieces.length === 1 && pieces[0].length === 3 && pieces[0].every((v, k) => v === [va, vb, vc][k])) {
      outI.push(vertex(va, a), vertex(vb, b), vertex(vc, c)); outL.push(label); outO.push(f); continue;
    }
    if (!pieces.length) { removed++; continue; }
    clipped++;
    for (const poly of pieces) {
      const ids = poly.map(v => vertex(v, v === va ? a : v === vb ? b : v === vc ? c : undefined));
      for (let k = 1; k < ids.length - 1; k++) { outI.push(ids[0], ids[k], ids[k + 1]); outL.push(label); outO.push(f); }
    }
  }
  return { positions: Float32Array.from(outP), uvs: Float32Array.from(outUV), fade: Float32Array.from(outF), index: Uint32Array.from(outI), faceLabels: Uint16Array.from(outL), origin: Uint32Array.from(outO), removed, clipped };
}

// ---- glb 讀寫 ----
const align4 = (n) => (n + 3) & ~3;
export function parseGlb(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('不是 glb');
  let off = 12, json = null, bin = null;
  while (off < bytes.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true), body = bytes.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body)); else if (type === 0x004e4942) bin = body;
    off += 8 + align4(len);
  }
  if (!json) throw new Error('glb 沒有 JSON');
  return { json, bin };
}
// 原模型的貼圖（圖檔原樣拿出來）和放模型的那個節點的變換
export function sourceTexture(glb) {
  const { json, bin } = parseGlb(glb);
  const mesh = json.meshes.findIndex(m => m.primitives.length === 1), tex = json.materials[json.meshes[mesh].primitives[0].material].pbrMetallicRoughness.baseColorTexture.index;
  const img = json.images[json.textures[tex].source], view = json.bufferViews[img.bufferView];
  if (img.bufferView === undefined) throw new Error('貼圖不在 glb 裡');
  const node = json.nodes.find(n => n.mesh === mesh) || {};
  const transform = Object.fromEntries(['matrix', 'translation', 'rotation', 'scale'].filter(k => node[k]).map(k => [k, node[k]]));
  return { image: bin.slice(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength), mime: img.mimeType || 'image/jpeg', transform };
}
// 成品 glb：一個網格、不受光的貼圖材質（KHR_materials_unlit）、頂點的淡出放在自訂屬性 _WALL_FADE（別的檢視器會忽略，岩點貓讀它）
export function writeGlb({ positions, uvs, fade, index, image, mime = 'image/jpeg', transform = {}, extras = null }) {
  const chunks = [], views = [], push = (arr, target) => {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), start = chunks.reduce((s, c) => s + align4(c.byteLength), 0);
    chunks.push(bytes); views.push({ buffer: 0, byteOffset: start, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    return views.length - 1;
  };
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], positions[i + k]); max[k] = Math.max(max[k], positions[i + k]); }
  const n = positions.length / 3, acc = [];
  const attr = (arr, type, comp, extra = {}) => { acc.push({ bufferView: push(arr, 34962), componentType: comp, count: type === 'VEC3' ? arr.length / 3 : type === 'VEC2' ? arr.length / 2 : arr.length, type, ...extra }); return acc.length - 1; };
  const P = attr(positions, 'VEC3', 5126, { min, max }), T = attr(uvs, 'VEC2', 5126), F = attr(fade, 'SCALAR', 5126);
  acc.push({ bufferView: push(index, 34963), componentType: 5125, count: index.length, type: 'SCALAR' });
  const imgView = push(image);
  const json = {
    asset: { version: '2.0', generator: 'Climbio Studio' },
    extensionsUsed: ['KHR_materials_unlit'],
    scene: 0, scenes: [{ nodes: [0], ...(extras ? { extras } : {}) }],
    nodes: [{ mesh: 0, name: 'wall', ...transform }],
    meshes: [{ name: 'wall', primitives: [{ attributes: { POSITION: P, TEXCOORD_0: T, _WALL_FADE: F }, indices: acc.length - 1, material: 0, mode: 4 }] }],
    materials: [{ name: 'wall', doubleSided: true, pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 }, extensions: { KHR_materials_unlit: {} } }],
    textures: [{ source: 0, sampler: 0 }], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    images: [{ bufferView: imgView, mimeType: mime }],
    accessors: acc, bufferViews: views, buffers: [{ byteLength: chunks.reduce((s, c) => s + align4(c.byteLength), 0) }],
  };
  const jb = new TextEncoder().encode(JSON.stringify(json)), jlen = align4(jb.length), blen = json.buffers[0].byteLength;
  const out = new Uint8Array(12 + 8 + jlen + 8 + blen), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, jlen, true); dv.setUint32(16, 0x4e4f534a, true); out.set(jb, 20); out.fill(0x20, 20 + jb.length, 20 + jlen);
  dv.setUint32(20 + jlen, blen, true); dv.setUint32(24 + jlen, 0x004e4942, true);
  let off = 28 + jlen;
  for (const c of chunks) { out.set(c, off); off += align4(c.byteLength); }
  return out;
}
