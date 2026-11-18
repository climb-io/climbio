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
