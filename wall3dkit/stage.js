// 岩點貓的 3D 牆：模型取代 2D 的照片，看線、定線照樣用岩點貓的牆頁（js/wall.js、js/edit.js、js/mobile.js）。
// 3D 牆在 App 裡跟一般的牆一樣：正面視角拍一張「照片」（快照），岩點外框是岩點投到這張快照上的範圍，
// 小卡、縮圖、分享圖、路線視角、標籤位置都照 2D 算。牆頁上快照換成即時的模型：2D 的縮放、平移（view）只是裁快照的一塊，
// 這裡用 setViewOffset 把同一塊裁給相機，畫出來跟 2D 一一對上；兩指一起拖轉角度（繞畫面中央那一點），轉完岩點外框照新的角度重投。
// 資料包由 3D 重建流程輸出（wall.json），格式 climbio-3d-wall/1（工作檔）或 climbio-3d-wall/2（烘焙過的成品，見 bakepack.js）。
// English: Hold Cat 3D wall stage: renders the model under the 2D wall view (same crop via setViewOffset), picks holds by raycast.
import { Scene, PerspectiveCamera, OrthographicCamera, WebGLRenderer, WebGLRenderTarget, ShaderMaterial, PlaneGeometry, LinearFilter, Color, Vector2, Vector3, Quaternion, Box3, Raycaster, MeshBasicMaterial, BufferGeometry,
  Float32BufferAttribute, Mesh, DataTexture, UnsignedByteType, NearestFilter, DoubleSide, SRGBColorSpace, MathUtils, GLTFLoader, MeshBVH, acceleratedRaycast } from './vendor/three.js';
import { WalkCam, unpackWalk, tableFor, STEP as WALK_STEP, YAW_MAX, YAW_RATE } from './walkcam.js';

const FORMAT = 'climbio-3d-wall/1';
const FORMAT2 = 'climbio-3d-wall/2';   // 成品包（Climbio Studio 烘焙過：裁切、隱藏、修點、淡出、軌道都做好了，岩點貓只讀不算，見 bake.js）
const SNAP_SIDE = 2048;   // 快照（牆的「照片」）長邊
const SNAP_CAMERA = 'level-holds';   // 快照（正面）鏡頭的規則：改了就換，手機上的快照、岩點外框會重做
const FOV = 50;
const PEEK_YAW = 0.4, PEEK_PITCH = 0.3;   // 偷看：離軌道上的位置最多轉幾弧度（左右約 23°、上下約 17°），放手彈回
const RAIL_STEP = 0.1, RAIL_SMOOTH = 0.5, RAIL_MAX = 1.1, RAIL_FOOT = 0.4;   // 軌道：每格公尺、平滑的 σ（公尺）、離正面最多轉幾弧度、牆腳取離地多高的面
const FADE_NEAR = 0.03, FADE_FAR = 0.15, FADE_ZONE = 1.2;   // 兩端淡出：離最近的岩點幾公尺開始淡、全淡，只在兩端幾公尺內
const EDGE_TOP = 0.12, EDGE_BOTTOM = 0.215;   // 最外側的岩點離畫面左右、上下緣至少這麼遠（畫面寬、高的比例；上下要避開浮著的工具列）
const REACH_PAD = 0.02;   // 目標最多走到最外側岩點外幾公尺
const SNAP_PAD = 0.12;   // 快照四周留給岩點本身大小的邊（公尺）
const OVER_MAX = 0.4;   // 拖過盡頭的橡皮筋：最多多滑幾公尺（越拉阻力越大）
const RAIL_END = 1.5, RAIL_END_ZOOM = 4, RAIL_END_ANGLE = 0.1;   // 兩端進場段多長（公尺）、走到盡頭時至少放大幾倍、盡頭時離那段牆的方向偏幾弧度（約 6°，接近正對）
const RAIL_BLEND = 0.25, ALONG_BLEND_MS = 450;   // 剛站上軌道，換成軌道相機要走多遠（公尺），見 walk
const RAIL_ANGLE = 0.15, RAIL_TURN = 0.8;   // 看的方向：跟著牆的方向再往右偏幾弧度（約 9°）、牆的方向平滑幾公尺（σ，越大轉得越慢）
export const decode = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const RG_FORMAT = 1030;   // three.js 的 RGFormat（three.js 打包時沒匯出）
export const inflate = async (bytes, kind) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream(kind))).arrayBuffer());
// 下載：網路不通、伺服器忙（5xx、429、408；代讀函式第一次叫醒要一陣子）自動重試兩次再放棄，第一次進牆不會一下子就「無法連線」
async function getRetry(url) {
  let last;
  for (let i = 0; i < 3; i++) {
    if (i) await new Promise(ok => setTimeout(ok, 700 * i));
    try {
      const r = await fetch(url, { credentials: 'omit' });   // 公開資料：同源的 /p/<id>/ 轉址到資料集，iOS Safari 帶憑證抓會 Load failed
      if (r.ok) return r;
      last = Object.assign(new Error(`3D wall: ${r.status} ${url}`), { fatal: r.status < 500 && r.status !== 429 && r.status !== 408 });
      if (last.fatal) throw last;
    } catch (e) { last = e; if (e.fatal) throw e; }   // 網路不通（fetch 丟錯）也重試
  }
  throw last;
}
const fetchBytes = async (url) => new Uint8Array(await (await getRetry(url)).arrayBuffer());

// 分面：每個面是第幾面，隱藏的面不畫、點不到（模型不動，Climbio Studio 可以再打開）。
// 岩點不在：標成不是岩點（off），或大部分的面在隱藏的面、地面、天花板上，或中心被 Studio 的切線切掉。岩點貓與 Studio 都照這條算
export async function packSurfaces(pack) {
  const faces = await inflate(decode(pack.surfaces.faces), 'deflate');
  if (faces.some(s => s >= pack.surfaces.list.length)) throw new Error('3D wall: bad surfaces');
  return faces;
}
export function goneHolds(pack, faceLabels, faceSurfaces) {
  // 地面、天花板上的是墊子上的雜點，不是牆上的岩點
  const hidden = pack.surfaces.list.map(s => s.hidden || s.kind === 'floor' || s.kind === 'ceiling'), n = pack.holds.length, all = new Uint32Array(n + 1), off = new Uint32Array(n + 1), box = frameTest(pack);
  for (let f = 0; f < faceLabels.length; f++) { const i = faceLabels[f]; if (i && i <= n) { all[i]++; if (hidden[faceSurfaces[f]]) off[i]++; } }
  return new Set(pack.holds.flatMap((h, i) => h.off || !box(h.position, true) || (all[i + 1] && off[i + 1] * 2 > all[i + 1]) ? [i] : []));
}
// 裁切平面（holds_3d_surfaces.py 的 frame.planes：地面、天花板、左右，和在 Climbio Studio 切的直線）：切掉 n·p < d 的那側。
// 有 bounds 的（外緣拉直 edge、Studio 的切線 cut；最多 FRAME_BOUNDS 個 [n, d]）只切範圍內（每個都 ≥ d）的，平面才不會延伸出去切到別處。
// 牆是幾個大平面組成的，用平面切，切口在每一面牆上都是直線、只在轉角轉折。切掉的不畫、點不到。
// 自動的切面（地面、天花板、外緣拉直）切口外半個岩點間距內不切岩點：最低一排腳點不會因為抱石墊被切掉，
// 再遠的照切（標籤延伸到墊子上的零星像素才不會浮在切口外）；Studio 的切線（cut）是人決定整塊不要，岩點中心被切掉就不算
const dot3 = (n, p) => n[0] * p[0] + n[1] * p[1] + n[2] * p[2];
const sparesHolds = (q) => q.kind !== 'cut';
// 岩點間距的一半：每顆岩點中心到最近一顆的距離取中位數
export function holdMargin(pack) {
  const P = pack.holds.filter(h => h.position).map(h => h.position), near = P.map((a, i) => Math.min(...P.map((b, j) => i === j ? Infinity : Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]))));
  near.sort((a, b) => a - b);
  return near.length > 1 ? near[near.length >> 1] / 2 : 0;
}
export function frameTest(pack) {
  const planes = pack.surfaces.frame.planes;
  if (!planes.length) return () => true;
  const margin = holdMargin(pack);
  return (p, hold = false) => !planes.some((q) => dot3(q.n, p) < q.d - (hold && sparesHolds(q) ? margin : 0) && (!q.bounds || q.bounds.every(([m, e]) => dot3(m, p) >= e)));
}
// 著色器裡的裁切：裝到材質的 onBeforeCompile（shader）。切掉的：岩點貓不畫（discard），Studio 蓋上顏色（outside 給 GLSL 敘述，用 diffuseColor）。
// hold：這個像素是不是岩點的 GLSL 式子（岩點貓看貼圖標籤；沒給就當不是）。平面放在 uniform 陣列（最多 FRAME_MAX 個），改了平面用 install.set 換 value
export const FRAME_MAX = 32, FRAME_BOUNDS = 4;
// 外框候選點的方向：球面上均勻的 64 個方向（Fibonacci）
// 牆面顏色（線性 RGB）：貼圖縮小後，只取不鮮豔、不暗的像素（岩點五顏六色、陰影和沒拍到的地方偏暗），取各色版的第 65 百分位（中位數比畫面上的牆面暗）
function wallTone(image) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(image, 0, 0, 128, 128);
  const d = x.getImageData(0, 0, 128, 128).data, ch = [[], [], []];
  for (let i = 0; i < d.length; i += 4) {
    const hi = Math.max(d[i], d[i + 1], d[i + 2]), lo = Math.min(d[i], d[i + 1], d[i + 2]);
    if (hi > 110 && hi - lo < 40) for (let k = 0; k < 3; k++) ch[k].push(d[i + k]);
  }
  if (!ch[0].length) throw new Error('3D wall: empty texture');
  const t = new Color().setRGB(...ch.map(a => a.sort((p, q) => p - q)[Math.floor(a.length * 0.65)] / 255), SRGBColorSpace);
  return [t.r, t.g, t.b];
}
const HULL_DIRS =Array.from({ length: 64 }, (_, k) => { const z = 1 - (2 * k + 1) / 64, r = Math.sqrt(1 - z * z), t = k * Math.PI * (3 - Math.sqrt(5)); return [r * Math.cos(t), r * Math.sin(t), z]; });
export function frameShader(pack, outside = 'discard;', hold = 'false') {
  const main = new Float32Array(FRAME_MAX * 4), bounds = new Float32Array(FRAME_MAX * FRAME_BOUNDS * 4), spare = new Float32Array(FRAME_MAX), none = [0, 0, 0, -1e9], margin = holdMargin(pack);
  const set = (planes) => {
    for (let i = 0; i < FRAME_MAX; i++) {
      const q = planes[i];
      main.set(q ? [...q.n, q.d] : none, i * 4); spare[i] = q && sparesHolds(q) ? margin : 0;
      for (let j = 0; j < FRAME_BOUNDS; j++) { const b = q && q.bounds && q.bounds[j]; bounds.set(b ? [...b[0], b[1]] : none, (i * FRAME_BOUNDS + j) * 4); }
    }
  };
  set(pack.surfaces.frame.planes);
  const uniforms = { framePlanes: { value: main }, frameBounds: { value: bounds }, frameSpare: { value: spare } };
  const glsl = `uniform vec4 framePlanes[${FRAME_MAX}];uniform vec4 frameBounds[${FRAME_MAX * FRAME_BOUNDS}];uniform float frameSpare[${FRAME_MAX}];varying vec3 vFramePos;
bool outFrame(vec3 p,bool hold){for(int i=0;i<${FRAME_MAX};i++){if(dot(framePlanes[i].xyz,p)>=framePlanes[i].w-(hold?frameSpare[i]:0.))continue;bool inside=true;
for(int j=0;j<${FRAME_BOUNDS};j++){vec4 b=frameBounds[i*${FRAME_BOUNDS}+j];if(dot(b.xyz,p)<b.w){inside=false;break;}}if(inside)return true;}return false;}\n`;
  const install = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'varying vec3 vFramePos;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFramePos = transformed;');
    shader.fragmentShader = glsl + shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>\nif(outFrame(vFramePos,${hold})){${outside}}`);
  };
  install.set = set;
  return install;
}

export async function loadPack(base) {
  const pack = await (await getRetry(new URL('wall.json', base))).json();
  if (![FORMAT, FORMAT2].includes(pack.format) || !Array.isArray(pack.holds) || !pack.holds.length) throw new Error('3D wall: bad pack');
  if (pack.format === FORMAT2) pack.surfaces = { list: [{ kind: 'wall' }], frame: { planes: [] } };   // 成品已經切好、沒有隱藏的面：下面的流程照走，什麼都不做
  return pack;
}

// 模型、岩點標籤、覆蓋網格。base：資料包的網址（結尾 /）
export async function openStage(base, pack) {
  if (pack.format === FORMAT2) {
    const [glb, faceBytes, labelBytes, overlayBytes, walk] = await Promise.all([fetchBytes(new URL(pack.model, base)), fetchBytes(new URL(pack.faces, base)), fetchBytes(new URL(pack.holdLabels.file, base)), fetchBytes(new URL(pack.holdLabels.overlay, base)),
      pack.walk ? getRetry(new URL(pack.walk.file, base)).then(r => r.json()) : null]);
    if (walk) pack.walkData = walk;   // 沿牆走的鏡頭（Studio 烘焙好的軌道、牆面深度、邊界表），見 walkAlong
    const overlay = u16(await inflate(overlayBytes, 'deflate')), n = pack.holdLabels.holds;   // uint32：n+1 個位移，後面是每顆岩點的面
    const all = new Uint32Array(overlay.buffer.slice(overlay.byteOffset, overlay.byteOffset + overlay.byteLength));
    pack.holdLabels.overlayFaces = { offsets: all.subarray(0, n + 1), faces: all.subarray(n + 1) };
    if (pack.snapshot) {   // 烘焙好的快照（牆的「照片」）：手機不用自己渲染一張
      const bmp = await createImageBitmap(new Blob([await fetchBytes(new URL(pack.snapshot.file, base))], { type: 'image/jpeg' }));
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0); bmp.close();
      pack.snapshot.canvas = c;
    }
    return openStageFrom({ pack, glb, faces: await inflate(faceBytes, 'deflate'), labels: await inflate(labelBytes, 'deflate'), surfaces: new Uint8Array(0) });
  }
  const [glb, faceBytes, labelBytes, surfaces] = await Promise.all([fetchBytes(new URL(pack.model, base)), fetchBytes(new URL(pack.faces, base)),
    inflate(decode(pack.holdLabels.data), 'deflate'), packSurfaces(pack)]);
  return openStageFrom({ pack, glb, faces: faceBytes, labels: labelBytes, surfaces });
}
// 資料已經讀進記憶體：glb 位元組、每個面的岩點編號、貼圖標籤（uint16 的位元組）、每個面的分面（成品包給空的）。Studio 烘焙時也用這個（不掛畫面）
// 這份資料包的樣子（模型＋隱藏的面＋裁切框＋不是岩點的）：變了，存在這台的牆就要換新的快照（js/wall3d.js）
export function packSig(pack) {
  return [pack.scene, pack.model, pack.surfaces.list.map(x => x.hidden ? 1 : 0).join(''), pack.surfaces.frame.planes.map(q => [...q.n, q.d, ...(q.bounds || []).flat(2)].join(',')).join(';'), pack.holds.filter(h => h.off).map(h => h.id).join(','), JSON.stringify(pack.edits || []), SNAP_CAMERA].join(':');
}
// 成品包只靠 wall.json 和快照就能在這台建一面牆（快照當照片、烘好的正面外框當岩點），不用等模型下載、解析；模型之後在背景載。
// 舊的資料包（沒有烘好的快照、外框）回 null，照舊等模型
export async function openFront(base, pack) {
  if (pack.format !== FORMAT2 || !pack.snapshot || !pack.outlines) return null;
  const bmp = await createImageBitmap(new Blob([await fetchBytes(new URL(pack.snapshot.file, base))], { type: 'image/jpeg' }));
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0); bmp.close();
  return { sig: packSig(pack), name: pack.name || '', snapshot: c, outlines: pack.outlines.map(([id, flat]) => ({ id, poly: Array.from({ length: flat.length / 2 }, (_, k) => [flat[k * 2], flat[k * 2 + 1]]) })) };
}
export async function openStageFrom({ pack, glb, faces, labels, surfaces }) {
  const gltf = await parseModel(glb), faceLabels = u16(faces);
  return new Stage(pack, gltf, faceLabels, u16(labels), pack.format === FORMAT2 ? new Uint8Array(faceLabels.length) : surfaces);
}

export const u16 = (b) => new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
export const parseModel = (glb) => new Promise((ok, no) => new GLTFLoader().parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '', ok, no));

class Stage {
  constructor(pack, gltf, faceLabels, labels, faceSurfaces) {
    this.pack = pack;
    // 這份資料包的樣子（模型＋隱藏的面＋裁切框＋不是岩點的）：變了，存在這台的牆就要換新的快照（js/wall3d.js）
    this.sig = packSig(pack);
    this.scene = new Scene(); this.scene.background = new Color('#0e0e0f');
    this.camera = new PerspectiveCamera(FOV, 1, 0.005, 100);
    this.up = new Vector3(...pack.up).normalize();
    // 底色：gray＝灰階壓亮度（2D 的灰階底），dim＝暗彩，photo＝原色
    this.baseMode = { value: 0 };
    this.wallBack = { value: new Color() };
    this.baked = pack.format === FORMAT2;
    const framed = this.baked ? () => {} : frameShader(pack, 'discard;', 'frameHoldAt(vMapUv)');   // 成品已經切好，不用在著色器裡逐像素裁切
    const tune = (shader) => {
      framed(shader);
      Object.assign(shader.uniforms, { frameLabels: { value: this.labelTexture }, frameLabelSize: { value: this.labelSize } });
      shader.fragmentShader = 'uniform sampler2D frameLabels;uniform float frameLabelSize;\nbool frameHoldAt(vec2 uv){vec2 t=texelFetch(frameLabels,ivec2(clamp(floor(uv*frameLabelSize),0.,frameLabelSize-1.)),0).rg*255.;return t.x+t.y*256.>.5;}\n' + shader.fragmentShader;
      shader.uniforms.baseMode = this.baseMode;
      // 兩端沒有岩點的邊：貼圖拉歪、碎邊很雜，往牆面顏色（wallBack，跟牆外的底色同一個）淡出，看起來像牆面自然延伸出去
      shader.uniforms.wallBack = this.wallBack;
      shader.vertexShader = 'attribute float wallFade;varying float vWallFade;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWallFade = wallFade;');
      shader.fragmentShader = 'varying float vWallFade;uniform vec3 wallBack;\n' + shader.fragmentShader.replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, wallBack, frameHoldAt(vMapUv) ? 0. : vWallFade);');
      shader.fragmentShader = 'uniform float baseMode;\n' + shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        float g=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
        if(baseMode>1.5)diffuseColor.rgb=diffuseColor.rgb*.42;
        else if(baseMode>.5)diffuseColor.rgb=vec3(g*.48+.035)+vec3(-.004,.004,.014);`);
    };
    const surfaces = [];
    gltf.scene.traverse(o => { if (o.isMesh) { o.material = new MeshBasicMaterial({ map: o.material.map, side: DoubleSide }); o.material.onBeforeCompile = tune; surfaces.push(o); } });
    if (surfaces.length !== 1) throw new Error('3D wall: one mesh expected');
    this.scene.add(gltf.scene);
    const surface = this.surface = surfaces[0], geometry = surface.geometry;
    if (this.baked) { const f = geometry.getAttribute('_wall_fade'); if (f) geometry.setAttribute('wallFade', f); else geometry.setAttribute('wallFade', new Float32BufferAttribute(new Float32Array(geometry.attributes.position.count), 1)); }
    this.wallTone = wallTone(surface.material.map.image); this.backdrop();
    const tris = (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
    if (faceLabels.length !== tris || faceSurfaces.length !== tris) throw new Error('3D wall: face labels mismatch');
    if (!geometry.index) throw new Error('3D wall: indexed mesh expected');
    // 隱藏的面縮成一點（面的編號不變，岩點標籤照樣對得上；縮成一點的面畫不出來、射線也打不到）
    const hiddenSurface = pack.surfaces.list.map(x => x.hidden), I = geometry.index;
    for (let f = 0; f < tris; f++) if (hiddenSurface[faceSurfaces[f]]) { const a = I.getX(f * 3); I.setX(f * 3 + 1, a); I.setX(f * 3 + 2, a); }
    I.needsUpdate = true;
    geometry.computeVertexNormals();   // 路線岩點打側光用
    geometry.boundsTree = new MeshBVH(geometry, { indirect: true, targetLeafSize: 10 });   // indirect：保留面索引，岩點標籤才對得上
    surface.raycast = acceleratedRaycast;
    gltf.scene.updateMatrixWorld(true);
    this.faceLabels = faceLabels;
    this.surfaces = [surface];
    if (pack.finishing) this.finish(pack.finishing);   // 烘焙過的資料包已經寫進模型
    // 貼圖空間的岩點標籤（每個貼圖像素是第幾顆，16 位元）：外框和點選都看它，邊緣不受三角面大小影響。
    // 貼圖用 RG 兩個位元組（低、高位元組）放一個標籤，跟 labels 共用同一塊記憶體，修點改了 labels 就跟著變
    const size = this.labelSize = pack.holdLabels.size;
    if (labels.length !== size * size) throw new Error('3D wall: label size mismatch');
    // 不在的岩點：標籤清掉（畫不出、點不到、沒有外框）
    this.inFrame = frameTest(pack);
    this.gone = goneHolds(pack, faceLabels, faceSurfaces);
    if (this.gone.size) {
      for (let k = 0; k < labels.length; k++) if (labels[k] && this.gone.has(labels[k] - 1)) labels[k] = 0;
      for (let f = 0; f < tris; f++) if (faceLabels[f] && this.gone.has(faceLabels[f] - 1)) faceLabels[f] = 0;
    }
    this.labels = labels;
    const tex = this.labelTexture = new DataTexture(new Uint8Array(labels.buffer), size, size, RG_FORMAT, UnsignedByteType);
    tex.magFilter = tex.minFilter = NearestFilter; tex.generateMipmaps = false; tex.unpackAlignment = 1; tex.needsUpdate = true;
    this.holds = pack.holds;
    this.index = new Map(pack.holds.map((h, i) => [h.id, i]));
    this.maskMode = { value: 0 };
    this.overlays = this.buildOverlays(pack.holdLabels); this.hullCache = new Map();
    // 正面視角：岩壁朝外的平均方向（打包時估算），水平（跟站著的人一樣不抬頭、不低頭）
    const centers = pack.holds.filter((h, i) => !this.gone.has(i)).map(h => new Vector3(...h.position));
    this.centers = centers;
    this.box = new Box3().setFromPoints(centers).expandByScalar(0.05);
    this.center = this.box.getCenter(new Vector3());
    const ref = new Vector3(...pack.reference.position).sub(this.center).normalize();
    const level = (v) => v.clone().sub(this.up.clone().multiplyScalar(v.dot(this.up))).normalize();
    this.eye = level(pack.front ? new Vector3(...pack.front) : ref);
    this.eyeH = new Vector3(...pack.reference.position).dot(this.up);   // 眼睛的高度：拍照的人拿手機的高度
    this.home();
    this.rail = this.baked ? this.bakedRail(pack.rail) : this.buildRail();
    this.holdPos = pack.holds.filter((h, i) => !this.gone.has(i) && !h.off).map(h => new Vector3(...h.position));
    const hx = this.holdPos.map(p => p.dot(this.rail.right)); this.rail.hxlo = Math.min(...hx); this.rail.hxhi = Math.max(...hx);   // 最外側的岩點：兩端進場段從這裡往內算
    const hy = this.holdPos.map(p => p.dot(this.up)); this.rail.hlo = Math.min(this.rail.hlo, Math.min(...hy) - 0.15); this.rail.hhi = Math.max(this.rail.hhi, Math.max(...hy) + 0.15);   // 上下能走到最高、最低的岩點（牆面的高度範圍不含凸出牆外的岩點）
    this.reach = { xlo: this.rail.hxlo - REACH_PAD, xhi: this.rail.hxhi + REACH_PAD, hlo: Math.min(...hy) - REACH_PAD, hhi: Math.max(...hy) + REACH_PAD };
    if (!this.baked) this.edgeFade(geometry);
    this.buildEdges(geometry);
    this.addFill();
    this.raycaster = new Raycaster();
    this.renderer = null; this.view = null; this.dirty = false; this.off = 0;
    if (pack.edits?.length) this.setEdits([]);   // 資料包裡的修點（Climbio Studio 修的）一開始就套上
  }
  // 邊緣整理：打包時把模型邊緣破碎的頂點移好（不補洞：模型只能來自照片）
  finish(data) {
    const geometry = this.surface.geometry, attr = geometry.attributes.position;
    const ids = new Uint32Array(decode(data.vertices).buffer), pos = new Float32Array(decode(data.positions).buffer);
    if (pos.length !== ids.length * 3 || ids.some(i => i >= attr.count)) throw new Error('3D wall: finishing mismatch');
    for (let i = 0; i < ids.length; i++) attr.setXYZ(ids[i], pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    attr.needsUpdate = true; geometry.computeBoundingBox(); geometry.computeBoundingSphere(); geometry.boundsTree.refit();
  }
  // 每顆岩點一塊覆蓋網格（它的面再往外帶幾圈）：路線上的岩點原色＋角色色的光暈（看線、定線一樣）
  buildOverlays(holdLabels) {
    const as32 = (v) => new Uint32Array(decode(v).buffer), baked = holdLabels.overlayFaces, offsets = baked ? baked.offsets : as32(holdLabels.faceOffsets), faces = baked ? baked.faces : as32(holdLabels.faces);
    this.baseFaces = this.holds.map((h, i) => faces.subarray(offsets[i], offsets[i + 1]));
    return this.holds.map((h, i) => this.overlay(i, this.baseFaces[i], h.faceCount));
  }
  // 這些面組成的網格（覆蓋網格用；貼圖標籤決定哪些像素是岩點）
  faceGeometry(faces) {
    const geometry = this.surface.geometry, P = geometry.attributes.position, UV = geometry.attributes.uv, N = geometry.attributes.normal, I = geometry.index;
    const positions = [], uv = [], normals = [];
    for (const f of faces) for (let j = 0; j < 3; j++) {
      const v = I ? I.getX(f * 3 + j) : f * 3 + j;
      positions.push(P.getX(v), P.getY(v), P.getZ(v)); uv.push(UV.getX(v), UV.getY(v)); normals.push(N.getX(v), N.getY(v), N.getZ(v));
    }
    const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(positions, 3)); g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    return g;
  }
  // 一顆岩點的覆蓋網格：貼圖標籤是這顆的像素畫原色（邊緣取周圍四點的雙線性內插再平均，放大時不見格子鋸齒），
  // 加一點左上方的側光，凸出的形狀更立體；光暈另外在畫面上做（glowMask、glowComposite）
  overlay(i, faces, faceCount) {
    const g = this.faceGeometry(faces);
    const style = { roleColor: { value: new Color('#ffffff') } };
    const mat = new MeshBasicMaterial({ map: this.surface.material.map, transparent: true, depthWrite: false, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    mat.customProgramCacheKey = () => 'hold-label';
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, style, { holdLabelMap: { value: this.labelTexture }, holdIndex: { value: i + 1 }, labelSize: { value: this.labelSize }, maskMode: this.maskMode });
      shader.vertexShader = 'varying vec3 vLitN;\n' + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvLitN = normalize(normalMatrix * normal);');
      shader.fragmentShader = 'varying vec3 vLitN;\n' + shader.fragmentShader;
      shader.fragmentShader = 'uniform vec3 roleColor;uniform sampler2D holdLabelMap;uniform float holdIndex;uniform float labelSize;uniform float maskMode;\n'
        + 'float holdAt(ivec2 p){p=clamp(p,ivec2(0),ivec2(int(labelSize)-1));vec2 t=texelFetch(holdLabelMap,p,0).rg*255.;return abs(t.x+t.y*256.-holdIndex)<.5?1.:0.;}\n'
        + 'float labelWeight(vec2 uv){vec2 p=uv*labelSize-.5;ivec2 i=ivec2(floor(p));vec2 f=fract(p);return mix(mix(holdAt(i),holdAt(i+ivec2(1,0)),f.x),mix(holdAt(i+ivec2(0,1)),holdAt(i+ivec2(1,1)),f.x),f.y);}\n'
        + shader.fragmentShader;
      // maskMode：1＝畫光暈的遮罩（角色色、預乘透明度），2＝岩點編號（交界處的光暈用）
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `vec2 o=vec2(.6/labelSize);float hw=(labelWeight(vMapUv+o)+labelWeight(vMapUv-o)+labelWeight(vMapUv+vec2(o.x,-o.y))+labelWeight(vMapUv+vec2(-o.x,o.y)))*.25;float aa=max(fwidth(hw),.001);
        float fill=smoothstep(.5-aa,.5+aa,hw);if(fill<.01)discard;
        vec3 litN=normalize(gl_FrontFacing?vLitN:-vLitN);float lit=.8+.4*max(dot(litN,normalize(vec3(-.4,.55,.75))),0.);
        if(maskMode>1.5&&fill<.5)discard;
        gl_FragColor=maskMode>1.5?vec4(mod(holdIndex,256.)/255.,floor(holdIndex/256.)/255.,0.,1.):maskMode>.5?vec4(roleColor*fill,fill):vec4(outgoingLight*lit,fill);`);
    };
    const m = new Mesh(g, mat); m.userData = { style, faces }; m.matrix.copy(this.surface.matrixWorld); m.matrixAutoUpdate = false;
    m.renderOrder = 2 + 1 / Math.max(1, faceCount); m.visible = false; this.scene.add(m);
    return m;
  }
  // 修點（岩點貓的單點編輯拖好的多邊形）：edits＝[{ id, m3: { c: [相機位置 3、方向 4], p: [[x, y]…]（快照的比例 0～1） } }]。
  // 只重套變了的岩點：先把那顆還原成原始的，再套新的修點（復原、取消、刪掉都只是換一份 edits）。回傳改到的岩點 id
  // 資料包裡的修點（pack.edits，Studio 修的）跟這台的修點合在一起，同一顆以這台的為準
  setEdits(edits) {
    const mine = new Set(edits.map(e => e.id));
    edits = [...(this.pack.edits || []).filter(e => !mine.has(e.id)), ...edits];
    if (this.fills) { for (const m of this.fills.values()) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); } this.fills = null; }
    const next = new Map(edits.map(e => [e.id, JSON.stringify(e.m3)])), applied = this.applied || (this.applied = new Map());
    const changed = [...next.keys()].filter(id => applied.get(id) !== next.get(id)), removed = [...applied.keys()].filter(id => !next.has(id));
    if (!changed.length && !removed.length) return new Set();
    if (!this.pristine) this.pristine = { labels: this.labels.slice(), faces: this.faceLabels.slice(), n: this.holds.length };
    for (const id of [...removed, ...changed]) if (applied.has(id)) { this.restoreHold(id); applied.delete(id); }
    const m3 = new Map(edits.map(e => [e.id, e.m3]));
    for (const id of changed) if (this.applyEdit(id, m3.get(id))) applied.set(id, next.get(id));
    this.labelTexture.needsUpdate = true; this.invalidate();
    return new Set([...changed, ...removed]);
  }
  // 拿掉一顆岩點的修點：它覆蓋網格範圍內的像素、面標籤回到原始的（這顆改出去的拿回來、清掉的補回去）
  restoreHold(id) {
    const i = this.index.get(id), m = this.overlays[i], P = this.pristine;
    if (i === undefined || !m.userData.edited) return;
    const idx = i + 1, L = this.labels, F = this.faceLabels, s = this.labelSize, UV = m.geometry.attributes.uv;
    let u0 = s, v0 = s, u1 = 0, v1 = 0;
    for (let k = 0; k < UV.count; k++) { const u = UV.getX(k) * s, v = UV.getY(k) * s; u0 = Math.min(u0, u); v0 = Math.min(v0, v); u1 = Math.max(u1, u); v1 = Math.max(v1, v); }
    for (let y = Math.max(0, Math.floor(v0)); y <= Math.min(s - 1, Math.ceil(v1)); y++) for (let x = Math.max(0, Math.floor(u0)); x <= Math.min(s - 1, Math.ceil(u1)); x++) {
      const k = y * s + x, now = L[k], was = P.labels[k];
      if (now === idx && was !== idx) { L[k] = was; this.hullCache.delete(was - 1); } else if (was === idx && now === 0) L[k] = idx;
    }
    for (const f of m.userData.faces) { const now = F[f], was = P.faces[f]; if (now === idx && was !== idx) F[f] = was; else if (was === idx && now === 0) F[f] = idx; }
    m.geometry.dispose(); m.geometry = this.faceGeometry(this.baseFaces[i]); m.userData.edited = false; m.userData.faces = this.baseFaces[i]; this.hullCache.delete(i);
  }
  // 一顆岩點的修點：從記下的角度看得到、投到畫面落在多邊形裡的表面算這顆（貼圖像素逐點判斷，邊界照多邊形走），
  // 原本是這顆、看得到但落在外面的清掉；看不到的那側不動。沒有這顆（補點）就加一顆新的
  applyEdit(id, m3) {
    let i = this.index.get(id);
    if (i === undefined) {
      if (this.holds.length >= 65535) return false;   // 貼圖標籤兩個位元組
      i = this.holds.length; this.holds.push({ id, position: null, faceCount: 1 }); this.baseFaces.push(new Uint32Array(0));
      this.overlays.push(this.overlay(i, [], 1)); this.index.set(id, i);
    }
    const idx = i + 1, W = this.snapW, H = this.snapH, mw = this.surface.matrixWorld;
    const cam = new PerspectiveCamera(FOV, m3.a || W / H, 0.005, 100);   // a：Studio 修的，畫面長寬比跟快照不同（p 照它的畫面算比例）
    cam.position.fromArray(m3.c, 0); cam.quaternion.fromArray(m3.c, 3); cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
    const poly = m3.p.map(([x, y]) => [x * W, y * H]);
    if (poly.length < 3) return false;
    const geo = this.surface.geometry, Pos = geo.attributes.position, UV = geo.attributes.uv, I = geo.index, nv = Pos.count;
    const sx = new Float32Array(nv), sy = new Float32Array(nv), ok = new Uint8Array(nv), v = new Vector3();
    for (let k = 0; k < nv; k++) {
      v.fromBufferAttribute(Pos, k).applyMatrix4(mw).project(cam);
      if (v.z > -1 && v.z < 1) { ok[k] = 1; sx[k] = (v.x + 1) / 2 * W; sy[k] = (1 - v.y) / 2 * H; }
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const M = 0.03 * Math.max(W, H), tris = (I ? I.count : nv) / 3, vid = (f, j) => I ? I.getX(f * 3 + j) : f * 3 + j;
    const s = this.labelSize, L = this.labels, ray = this.raycaster, A = new Vector3(), B = new Vector3(), C = new Vector3(), dir = new Vector3();
    const near = [];
    let count = 0;
    ray.firstHitOnly = true;
    for (let f = 0; f < tris; f++) {
      const a = vid(f, 0), b = vid(f, 1), c = vid(f, 2);
      if (!ok[a] || !ok[b] || !ok[c]) continue;
      const cx = (sx[a] + sx[b] + sx[c]) / 3, cy = (sy[a] + sy[b] + sy[c]) / 3;
      if (cx < x0 - M || cx > x1 + M || cy < y0 - M || cy > y1 + M) continue;
      // 從這個角度看得到：中心沒被別的面擋住
      A.fromBufferAttribute(Pos, a).applyMatrix4(mw); B.fromBufferAttribute(Pos, b).applyMatrix4(mw); C.fromBufferAttribute(Pos, c).applyMatrix4(mw);
      const center = A.add(B).add(C).multiplyScalar(1 / 3), dist = dir.subVectors(center, cam.position).length();
      ray.set(cam.position, dir.normalize());
      const hit = ray.intersectObject(this.surface, false)[0];
      if (hit && hit.faceIndex !== f && hit.distance < dist - 0.003) continue;
      near.push(f);
      if (inside(cx, cy, poly)) { this.faceLabels[f] = idx; count++; } else if (this.faceLabels[f] === idx) this.faceLabels[f] = 0;
      // 這個面在貼圖上的每個像素：重心座標換到畫面，在多邊形裡＝這顆
      const ua = UV.getX(a) * s, va = UV.getY(a) * s, ub = UV.getX(b) * s, vb = UV.getY(b) * s, uc = UV.getX(c) * s, vc = UV.getY(c) * s;
      const det = (vb - vc) * (ua - uc) + (uc - ub) * (va - vc);
      if (Math.abs(det) < 1e-9) continue;
      const tx0 = Math.max(0, Math.floor(Math.min(ua, ub, uc))), tx1 = Math.min(s - 1, Math.ceil(Math.max(ua, ub, uc)));
      const ty0 = Math.max(0, Math.floor(Math.min(va, vb, vc))), ty1 = Math.min(s - 1, Math.ceil(Math.max(va, vb, vc)));
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        const px = tx + 0.5, py = ty + 0.5;
        const w0 = ((vb - vc) * (px - uc) + (uc - ub) * (py - vc)) / det, w1 = ((vc - va) * (px - uc) + (ua - uc) * (py - vc)) / det, w2 = 1 - w0 - w1;
        if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
        const k = ty * s + tx;
        if (inside(w0 * sx[a] + w1 * sx[b] + w2 * sx[c], w0 * sy[a] + w1 * sy[b] + w2 * sy[c], poly)) { if (L[k] !== idx) this.hullCache.delete(L[k] - 1); L[k] = idx; }
        else if (L[k] === idx) L[k] = 0;
      }
    }
    const m = this.overlays[i], faces = new Set([...this.baseFaces[i], ...near]);
    m.geometry.dispose(); m.geometry = this.faceGeometry(faces); m.userData.edited = true; m.userData.faces = [...faces]; this.hullCache.delete(i);
    const h = this.holds[i];
    if (!h.position) {   // 補的岩點：多邊形中心打到的那一點（點不到中心時找最近的岩點用）
      const cxp = poly.reduce((t, p) => t + p[0], 0) / poly.length, cyp = poly.reduce((t, p) => t + p[1], 0) / poly.length;
      ray.setFromCamera(new Vector2(cxp / W * 2 - 1, -cyp / H * 2 + 1), cam);
      const hit = ray.intersectObject(this.surface, false)[0];
      this.holds[i] = { ...h, position: hit ? hit.point.toArray() : cam.position.toArray(), faceCount: Math.max(1, count) };
    }
    ray.firstHitOnly = false;
    return true;
  }
  // 成品包烘焙好的正面外框；套過這台的修點（applied 不是空的）就不能用了，要照現在的重投
  bakedFront() {
    const o = this.pack.outlines;
    if (!this.baked || !o || (this.applied && this.applied.size)) return null;
    return o.map(([id, flat]) => ({ id, poly: Array.from({ length: flat.length / 2 }, (_, k) => [flat[k * 2], flat[k * 2 + 1]]) }));
  }
  // 正面角度的外框（存檔用）
  frontOutlines(only) {
    const cam = this.camera, pos = cam.position.clone(), q = cam.quaternion.clone();
    cam.position.copy(this.homePose.position); cam.quaternion.copy(this.homePose.quaternion);
    const out = this.outlines(only);
    cam.position.copy(pos); cam.quaternion.copy(q); cam.updateMatrixWorld(true); this.applyView();
    return out;
  }
  // 目前角度下，畫面（整張快照）上的多邊形 → 修點記錄
  editSpec(poly) {
    const cam = this.camera, r = (x, n) => +x.toFixed(n);
    return { c: [...cam.position.toArray(), ...cam.quaternion.toArray()].map(x => r(x, 5)), p: poly.map(([x, y]) => [r(x / this.snapW, 4), r(y / this.snapH, 4)]) };
  }
  // 正面的相機：岩點範圍剛好放進快照（快照的長寬比照岩點範圍，長邊 SNAP_SIDE）
  home() {
    const cam = this.camera, eye = this.eye, up = this.up;
    const right = up.clone().cross(eye).normalize(), upv = eye.clone().cross(right);
    // 岩點剛好放進快照：每顆岩點中心往四個角各加 SNAP_PAD 公尺（岩點本身的大小）。不用整個模型的方盒：
    // V 字形的牆方盒的角落離岩點很遠，快照四周會空出一大片、岩點只佔一半
    const corners = [];
    for (const p of this.centers) { const c = p.clone().sub(this.center); for (const sx of [-1, 1]) for (const sy of [-1, 1]) corners.push(c.clone().addScaledVector(right, sx * SNAP_PAD).addScaledVector(upv, sy * SNAP_PAD)); }
    const t = Math.tan(MathUtils.degToRad(FOV / 2));
    let dist = 0, ax = 0, ay = 0;
    for (const c of corners) dist = Math.max(dist, c.dot(eye) + Math.abs(c.dot(upv)) / t);
    dist *= 1.04;
    for (const c of corners) { const z = dist - c.dot(eye); ax = Math.max(ax, Math.abs(c.dot(right)) / z); ay = Math.max(ay, Math.abs(c.dot(upv)) / z); }
    const aspect = MathUtils.clamp(ax / Math.max(ay, 1e-6), 0.5, 2);
    this.snapW = Math.round(aspect >= 1 ? SNAP_SIDE : SNAP_SIDE * aspect); this.snapH = Math.round(aspect >= 1 ? SNAP_SIDE / aspect : SNAP_SIDE);
    cam.fov = FOV; cam.aspect = this.snapW / this.snapH; cam.up.copy(up);
    cam.position.copy(this.center).add(eye.clone().multiplyScalar(dist)); cam.lookAt(this.center);
    cam.clearViewOffset(); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    // 成品包：快照是 Studio 照它那一台的相機拍的，岩點外框也是投到那一張上，相機照記下來的（不重算，補的岩點、不在的岩點不會讓範圍變）
    const bs = this.baked && this.pack.snapshot;
    if (bs) {
      this.snapW = bs.w; this.snapH = bs.h; cam.aspect = bs.w / bs.h;
      cam.position.fromArray(bs.c, 0); cam.quaternion.fromArray(bs.c, 3); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    }
    this.homePose = { position: cam.position.clone(), quaternion: cam.quaternion.clone() }; this.glide = null;
    this.tilted = false;
  }
  // 兩端的淡出：離最近的岩點表面超過 FADE_NEAR 公尺開始往牆面顏色混，FADE_FAR 公尺全部混掉（每個頂點算一次，存在 wallFade 屬性；岩點本身（貼圖標籤）不淡出，大岩點的邊才不會被吃掉）。
  // 只管兩端各 FADE_ZONE 公尺（再往中間漸漸沒有），牆的上下緣、中間照舊
  edgeFade(geometry) {
    const P = geometry.attributes.position, n = P.count, out = new Float32Array(n), right = this.rail.right, lo = this.rail.hxlo, hi = this.rail.hxhi;
    const cell = FADE_FAR, key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`, grid = new Map();
    // 岩點的表面（有岩點標籤的面的頂點）：量到岩點表面的距離，大岩點、長條岩點的邊才不會被淡出吃掉
    const I = geometry.index, seen = new Uint8Array(n), pts = [];
    for (let f = 0; f < this.faceLabels.length; f++) {
      const l = this.faceLabels[f]; if (!l || this.gone.has(l - 1)) continue;
      for (let k = 0; k < 3; k++) { const v = I.getX(f * 3 + k); if (seen[v]) continue; seen[v] = 1; pts.push({ x: P.getX(v), y: P.getY(v), z: P.getZ(v) }); }
    }
    for (const h of pts) { const k = key(h.x, h.y, h.z); (grid.get(k) || grid.set(k, []).get(k)).push(h); }
    const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    for (let i = 0; i < n; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), r = x * right.x + y * right.y + z * right.z;
      const zone = 1 - smooth(FADE_ZONE * 0.5, FADE_ZONE, Math.min(r - lo, hi - r));   // 在兩端 FADE_ZONE 以內才淡出
      if (zone <= 0) continue;
      let best = Infinity;
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        const list = grid.get(`${cx + a},${cy + b},${cz + c}`); if (!list) continue;
        for (const h of list) best = Math.min(best, (h.x - x) ** 2 + (h.y - y) ** 2 + (h.z - z) ** 2);
      }
      out[i] = zone * smooth(FADE_NEAR, FADE_FAR, Math.sqrt(best));
    }
    geometry.setAttribute('wallFade', new Float32BufferAttribute(out, 1));
  }
  // 軌道：牆在水平方向的走勢。沿正面的左右軸每 RAIL_STEP 一格，牆面（不含岩點）水平法向的面積加權和，再平滑 RAIL_SMOOTH；
  // 走近時鏡頭站在那一段牆的正前方，左右滑過轉角跟著轉過去，不會走到牆的側面或背後
  // 牆的邊緣：看得到的部分（淡出一半以內、沒被裁掉的頂點）抽樣約 4000 個點。拖到盡頭時量這些點投到畫面上的位置，
  // 牆的邊貼到畫面邊（跟 2D 照片一樣不露出牆外的空白）；斜看時最外側的點不一定是世界座標最外側的，所以要投影之後量
  buildEdges(geometry) {
    const P = geometry.attributes.position, F = geometry.getAttribute('wallFade'), I = geometry.index, v = new Vector3(), seen = new Uint8Array(P.count), vis = [];
    for (let k = 0; k < I.count; k++) {
      const i = I.getX(k); if (seen[i]) continue; seen[i] = 1;
      if (F && F.getX(i) > 0.5) continue;
      v.fromBufferAttribute(P, i);
      if (!this.inFrame(v.toArray())) continue;
      vis.push(i);
    }
    const stride = Math.max(1, Math.floor(vis.length / 4000)), out = [];
    for (let k = 0; k < vis.length; k += stride) { const i = vis[k]; out.push(P.getX(i), P.getY(i), P.getZ(i)); }
    // 世界座標上左右、上下最外側的點一定放進去（抽樣可能漏掉細細的邊）
    const right = this.rail.right, up = this.up;
    for (const axis of [right, up]) {
      let lo = vis[0], hi = vis[0], l = Infinity, h = -Infinity;
      for (const i of vis) { v.fromBufferAttribute(P, i); const d = v.dot(axis); if (d < l) { l = d; lo = i; } if (d > h) { h = d; hi = i; } }
      for (const i of [lo, hi]) out.push(P.getX(i), P.getY(i), P.getZ(i));
    }
    this.edges = Float32Array.from(out);
  }
  // 牆外的填補：牆的邊緣不整齊（斜的上緣、下緣、內角），拖到邊上畫面會露出牆外的空白，看起來是個模型、不是一面牆。
  // 在模型後面放一大片牆面（顏色跟牆面一樣、細細的顆粒），露出來的地方看起來是牆面接著延伸出去；模型邊緣的淡出（wallFade）混進去的是同樣的顏色
  addFill() {
    const E = this.edges, eye = this.eye, up = this.up, right = up.clone().cross(eye).normalize(), upv = eye.clone().cross(right).normalize();
    if (!E || !E.length) return;
    let back = Infinity; for (let i = 0; i < E.length; i += 3) back = Math.min(back, E[i] * eye.x + E[i + 1] * eye.y + E[i + 2] * eye.z);
    const c = new Color().setRGB(...this.wallTone); c.convertLinearToSRGB();
    const N = 256, px = new Uint8Array(N * N * 4), base = [c.r * 255, c.g * 255, c.b * 255];
    let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      // 細顆粒＋兩層會接起來的緩慢起伏（整數週期，貼磚時接縫看不出來）＋少數小坑
      const low = Math.sin(2 * Math.PI * (x * 3 / N + y * 2 / N)) * 0.012 + Math.sin(2 * Math.PI * (x * 7 / N - y * 5 / N)) * 0.008;
      const v = 1 + low + (rnd() - 0.5) * 0.045 - (rnd() < 0.004 ? 0.07 : 0), o = (y * N + x) * 4;
      px[o] = Math.min(255, base[0] * v); px[o + 1] = Math.min(255, base[1] * v); px[o + 2] = Math.min(255, base[2] * v); px[o + 3] = 255;
    }
    const tex = new DataTexture(px, N, N, 1023, UnsignedByteType);   // RGBAFormat
    tex.wrapS = tex.wrapT = 1000; tex.magFilter = LinearFilter; tex.minFilter = 1008; tex.generateMipmaps = true; tex.colorSpace = SRGBColorSpace; tex.repeat.set(160 / 1.2, 80 / 1.2); tex.needsUpdate = true;   // 1000＝RepeatWrapping、1008＝LinearMipmapLinearFilter
    const mat = new MeshBasicMaterial({ map: tex, side: DoubleSide });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.baseMode = this.baseMode;
      shader.fragmentShader = 'uniform float baseMode;\n' + shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        float g=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
        if(baseMode>1.5)diffuseColor.rgb=diffuseColor.rgb*.42;
        else if(baseMode>.5)diffuseColor.rgb=vec3(g*.48+.035)+vec3(-.004,.004,.014);`);
    };
    const m = this.fill = new Mesh(new PlaneGeometry(160, 80), mat);
    m.matrixAutoUpdate = false; m.matrix.makeBasis(right, upv, eye); m.matrix.setPosition(this.center.clone().addScaledVector(eye, back - 0.25 - this.center.dot(eye)));
    m.frustumCulled = false; m.renderOrder = -2; m.matrixWorldNeedsUpdate = true;
    this.scene.add(m);
  }
  // 成品包裡的軌道（Studio 烘焙時用 buildRail 算好的）：每格的 r、e、d 是 float32 的 base64
  bakedRail(r) {
    const f32 = (b) => new Float32Array(decode(b).buffer), right = this.up.clone().cross(this.eye).normalize();
    return { right, lo: r.lo, hi: r.hi, hlo: r.hlo, hhi: r.hhi, r: f32(r.r), e: f32(r.e), d: f32(r.d) };
  }
  buildRail() {
    const g = this.surface.geometry, P = g.attributes.position, I = g.index, up = this.up, eye = this.eye;
    const right = up.clone().cross(eye).normalize(), a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3();
    const tris = I.count / 3, u = new Float32Array(tris), hf3 = new Float32Array(tris), dep = new Float32Array(tris), wt = new Float32Array(tris);
    let lo = Infinity, hi = -Infinity, hlo = Infinity, hhi = -Infinity;
    for (let f = 0; f < tris; f++) {
      if (this.faceLabels[f]) continue;
      a.fromBufferAttribute(P, I.getX(3 * f)); b.fromBufferAttribute(P, I.getX(3 * f + 1)); c.fromBufferAttribute(P, I.getX(3 * f + 2));
      u[f] = (a.dot(right) + b.dot(right) + c.dot(right)) / 3; dep[f] = (a.dot(eye) + b.dot(eye) + c.dot(eye)) / 3;
      const hf = hf3[f] = (a.dot(up) + b.dot(up) + c.dot(up)) / 3; if (hf < hlo) hlo = hf; if (hf > hhi) hhi = hf;
      n.subVectors(b, a).cross(c.sub(a)); wt[f] = n.length();
      lo = Math.min(lo, u[f]); hi = Math.max(hi, u[f]);
    }
    // 牆腳的走線：離地 RAIL_FOOT 內的牆面，每格取深度中位數，平滑 RAIL_SMOOTH。牆的方向是走線的垂直方向（V 字形的兩邊各自正對），
    // 鏡頭的距離也從牆腳算（頭頂上的外傾不算，人可以站在外傾底下，鏡頭走得進洞前面）
    const len = Math.max(2, Math.ceil((hi - lo) / RAIL_STEP) + 1), deps = Array.from({ length: len }, () => []), body = Array.from({ length: len }, () => []);
    for (let f = 0; f < tris; f++) {
      if (this.faceLabels[f] || !wt[f]) continue;
      const i = Math.round((u[f] - lo) / RAIL_STEP);
      if (hf3[f] <= hlo + RAIL_FOOT) deps[i].push(dep[f]);
      if (hf3[f] >= this.eyeH - 0.5 && hf3[f] <= this.eyeH + 0.3) body[i].push(dep[f]);
    }
    const foot = deps.map(q => (q.length >= 5 ? q.sort((a, b) => a - b)[q.length >> 1] : NaN));
    // 鏡頭的距離從人眼高度附近（眼睛往下 50 cm 到往上 30 cm）最前面那層牆面算（第 95 百分位，往兩側 0.3 m 取最大）：這是鏡頭會撞到的高度；這一層沒有牆就用牆腳
    const bf = body.map((q, i) => (q.length >= 5 ? q.sort((a, b) => a - b)[Math.floor(q.length * 0.95)] : foot[i])), mw = Math.round(0.3 / RAIL_STEP);
    const front = bf.map((_, i) => Math.max(...bf.slice(Math.max(0, i - mw), i + mw + 1).filter(v => !Number.isNaN(v))));
    const sg = RAIL_SMOOTH / RAIL_STEP, w = Math.ceil(3 * sg), d = new Float32Array(len), r = new Float32Array(len), e = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      let dd = 0, ww = 0;
      for (let j = Math.max(0, i - w); j <= Math.min(len - 1, i + w); j++) if (!Number.isNaN(foot[j])) { const k = Math.exp(-((j - i) ** 2) / (2 * sg * sg)); dd += foot[j] * k; ww += k; }
      d[i] = ww ? dd / ww : NaN;
    }
    for (let i = 0; i < len; i++) if (Number.isNaN(d[i])) d[i] = d[[...Array(len).keys()].filter(j => !Number.isNaN(d[j])).sort((p, q) => Math.abs(p - i) - Math.abs(q - i))[0]];
    for (let i = 0; i < len; i++) {
      const slope = (d[Math.min(len - 1, i + 1)] - d[Math.max(0, i - 1)]) / ((Math.min(len - 1, i + 1) - Math.max(0, i - 1)) * RAIL_STEP);
      const t = MathUtils.clamp(Math.atan2(-slope, 1), -RAIL_MAX, RAIL_MAX); r[i] = Math.sin(t); e[i] = Math.cos(t);
    }
    // 站的深度：人眼高度附近最前面的牆面（平滑），不比牆腳裡面
    const fd = new Float32Array(len);
    for (let i = 0; i < len; i++) { let dd = 0, ww = 0; for (let j = Math.max(0, i - w); j <= Math.min(len - 1, i + w); j++) if (Number.isFinite(front[j])) { const k = Math.exp(-((j - i) ** 2) / (2 * sg * sg)); dd += front[j] * k; ww += k; } fd[i] = Math.max(d[i], ww ? dd / ww : d[i]); }
    return { right, lo, hi: lo + (len - 1) * RAIL_STEP, hlo, hhi, r, e, d: fd };
  }
  // 平滑的牆面：視線跟軌道那一段（深度 d、朝外方向 railNormal 的直立平面）的交點。中央打到突出的岩點或凹進去的洞都一樣，左右滑時鏡頭不會跟著上下、前後跳
  railHit(ray) {
    const right = this.rail.right, P = new Vector3();
    let x = ray.origin.dot(right);
    for (let k = 0; k < 8; k++) {
      const n = this.railNormal(x), o = this.railPoint(x), den = ray.direction.dot(n);
      if (Math.abs(den) < 1e-6) return null;
      P.copy(ray.direction).multiplyScalar(o.sub(ray.origin).dot(n) / den).add(ray.origin); x = P.dot(right);
    }
    return P;
  }
  // 看的方向：牆的方向（相對正面的角度）再平滑 RAIL_TURN，左右滑時慢慢轉
  viewAngle(x) {
    const R = this.rail, sg = RAIL_TURN / RAIL_STEP;
    if (R.viewSg !== sg) {
      const n = R.r.length, A = Float32Array.from(R.r, (r, i) => Math.atan2(r, R.e[i])), w = Math.ceil(3 * sg);
      R.view = new Float32Array(n); R.viewSg = sg;
      for (let i = 0; i < n; i++) { let a = 0, ww = 0; for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) { const k = Math.exp(-((j - i) ** 2) / (2 * sg * sg)); a += A[j] * k; ww += k; } R.view[i] = a / ww; }
    }
    const t = MathUtils.clamp((x - R.lo) / RAIL_STEP, 0, R.view.length - 1), i = Math.min(R.view.length - 2, Math.floor(t));
    return R.view[i] + (R.view[i + 1] - R.view[i]) * (t - i);
  }
  // 軌道在左右位置 x 的平滑牆面上的點（水平面上，高度 0）
  railPoint(x) {
    const { right, lo, d } = this.rail, t = MathUtils.clamp((x - lo) / RAIL_STEP, 0, d.length - 1), i = Math.min(d.length - 2, Math.floor(t));
    return right.clone().multiplyScalar(x).addScaledVector(this.eye, d[i] + (d[i + 1] - d[i]) * (t - i));
  }
  // 軌道在左右位置 x（正面左右軸上的公尺）的朝外方向（水平）
  railNormal(x) {
    const { right, lo, r, e } = this.rail, t = MathUtils.clamp((x - lo) / RAIL_STEP, 0, r.length - 1), i = Math.min(r.length - 2, Math.floor(t)), k = t - i;
    return right.clone().multiplyScalar(r[i] + (r[i + 1] - r[i]) * k).addScaledVector(this.eye, e[i] + (e[i + 1] - e[i]) * k).normalize();
  }
  // 像站著的人往那裡走：畫面中央對到的那一點，放大 Z 倍時在地面上水平走近到 1/√Z 的距離，剩下的用裁切放大（等於換長焦）。
  // 鏡頭一直保持水平（不低頭、不抬頭、不歪頭），牆的直線一直是直的；看上看下靠移動畫面框（移軸），那一點留在畫面中央。
  // 高度從正面的高度隨著走近換到眼睛的高度；最近到正面距離的 12%，也不近到那一點出了畫面的上下緣。
  // 回傳新的 2D 視角（那一點留在畫面中央），不用動回傳 null，畫面中央已經在牆外回傳 false
  // 沿牆走的鏡頭（walkcam.js）：成品包帶 walk 時用它，手勢在 2D 的平移、縮放換成沿牆走、升降、靠近，畫面的裁切固定成「快照的高度＝畫面的高度、
  // 左右置中」（鏡頭的視角就是 FOV，跟 Studio 實拍校正時一樣，邊界表才對得上）。畫面四邊都是牆、走到轉角自動靠近，都在 WalkCam 裡
  get along() { return !!this.pack.walkData; }
  walkAlong(view, at = null) {
    const st = this.stage;
    if (!st || !view || !view.bw) return null;
    const W = st.clientWidth, H = st.clientHeight, cam = this.camera, K = H / this.snapH;
    const home = { s: K * this.snapW / view.bw, tx: W / 2 - this.snapW * K / 2, ty: 0 };
    this.view = view;
    if (!this.wc) {
      this.wc = new WalkCam(unpackWalk(this.pack.walkData), cam);
      this.wc.holds = this.holdPos;   // 每顆岩點都要點得到：左右、上下範圍延伸到最外側的岩點（WalkCam.sRange、needCell）
      this.wc.sees = (o, d) => { const rc = this.raycaster; rc.set(o, d); rc.near = 0; rc.far = 30; const h = rc.intersectObjects(this.surfaces, false).find(this.shownHit()); rc.far = Infinity; return !!h; };   // 左右盡頭：畫面邊緣看出去有沒有看得到的牆（跟點擊一樣不算裁掉、淡出的部分；WalkCam.sRange）
    }
    const wc = this.wc;
    if (wc.W !== W || wc.H !== H) { wc.W = W; wc.H = H; wc.far = null; wc.useTable(tableFor(this.pack.walkData, W / H)); }
    if (!this.angles) this.angles = setTimeout(() => { if (this.wc === wc && this.stage) this.planAngles(); }, 1500);   // 回程角度：站上去以後再算（不擋開場）
    let g = this.glide;
    const it = this.pack.walkData.intro;
    if (!g && it && this.introNext) {
      // 剛播完開場（Studio 烘焙的影片停在這個位置）：直接站在那裡，跟影片最後一格一樣
      this.introNext = false;
      wc.s = it.s; wc.v = it.v; wc.d = wc.wide ? Infinity : it.d; wc.clamp(); wc.want = wc.d;   // 起點（Studio 照直的手機算的）；橫的畫面（電腦）從最遠（四邊還都是牆）開始
      g = this.glide = { s: view.s, tx: view.tx, ty: view.ty, pose0: { done: true } };
    } else if (!g) {
      // 剛開始走：畫面中央打到牆的那一點當起點（沿牆位置、高度），距離照目前畫面上牆的大小換算，畫面才接得上
      // 中央不在牆上（2D 拖到快照的空白處）：往外一圈一圈找最近打得到牆的點
      let hit = null;
      for (let r = 0; !hit && r <= Math.max(W, H) / 2; r += 24) for (let a = 0, n = r ? Math.ceil(r / 12) : 1; !hit && a < n; a++) { this.aimRay(view, W / 2 + r * Math.cos(2 * Math.PI * a / n), H / 2 + r * Math.sin(2 * Math.PI * a / n)); hit = this.firstHit(); }
      if (!hit) { this.applyView(); return false; }
      const T = hit.point, p = wc.p, a = T.dot(p.right), b = T.dot(p.f);
      let bi = 0, bd = Infinity; for (let i = 0; i < p.n; i++) { const e = (p.X[i] - a) ** 2 + (p.Y[i] - b) ** 2; if (e < bd) { bd = e; bi = i; } }
      const dep = T.clone().sub(cam.position).dot(cam.getWorldDirection(new Vector3())), K0 = view.bw * view.s / this.snapW;
      wc.s = bi * WALK_STEP; wc.v = T.dot(p.up); wc.d = Infinity; wc.clamp(); wc.want = wc.d;   // 從最遠（整個畫面都是牆的最大範圍）開始
      g = this.glide = { s: view.s, tx: view.tx, ty: view.ty, pose0: { pos: cam.position.clone(), quat: cam.quaternion.clone(), view: { s: view.s, tx: view.tx, ty: view.ty }, s: wc.s, v: wc.v, d: wc.d, t0: performance.now() } };
    } else {
      // 2D 這一格的變化是相似變換：畫面上的點 q 移到 view.t + k·(q − g.t)。挑一個點跟著它走：縮放時是不動點（捏合的中心），只平移時是手指的位置（沒給用畫面中央）。
      // 那一點底下的牆（射線打到的）在鏡頭換位置之後要正好落在它該去的地方（WalkCam.track）：手指按著的東西跟著手指，捏合以兩指中心縮放
      const k = view.s / g.s, T = (q) => [view.tx + k * (q[0] - g.tx), view.ty + k * (q[1] - g.ty)];
      let q = null;
      if (Math.abs(k - 1) > 1e-6) { q = [(view.tx - k * g.tx) / (1 - k), (view.ty - k * g.ty) / (1 - k)]; if (!(Math.abs(q[0] - W / 2) < W && Math.abs(q[1] - H / 2) < H)) q = [W / 2, H / 2]; }
      else if (Math.abs(view.tx - g.tx) > 1e-3 || Math.abs(view.ty - g.ty) > 1e-3) q = at ? [at[0] - (view.tx - g.tx), at[1] - (view.ty - g.ty)] : [W / 2, H / 2];
      const px = q ? T(q)[0] - q[0] : 0, py = q ? T(q)[1] - q[1] : 0;
      if (q) {
        this.raycaster.setFromCamera(new Vector2(q[0] / W * 2 - 1, -q[1] / H * 2 + 1), cam); const h = this.firstHit(), P = h && h.point.clone(), q1 = T(q);
        if (Math.abs(k - 1) > 1e-6) wc.zoomAt(k, q1[0], q1[1], P); else if (!this.endTurn(px)) wc.pan(px, py, P);
      }
      g.fingers = (g.fingers || 0) + Math.hypot(px, py);
    }
    cam.setViewOffset(this.snapW, this.snapH, -home.tx / K, -home.ty / K, W / K, H / K);
    wc.apply(); cam.near = 0.005; cam.far = 100; cam.updateProjectionMatrix();
    let pos = cam.position.clone(), quat = cam.quaternion.clone(), next = { ...view, ...home };
    // 剛站上去：從快照的相機、畫面慢慢換成沿牆的（ALONG_BLEND_MS 毫秒內、或先走 RAIL_BLEND 公尺、距離變 1.35 倍、手指拖了 150 點就換完），不會一下子跳
    const o = g.pose0;
    if (o && !o.done) {
      const t = Math.max(Math.abs(wc.s - o.s) / RAIL_BLEND, Math.abs(wc.v - o.v) / RAIL_BLEND, Math.abs(Math.log(wc.d / o.d)) / 0.3, (g.fingers || 0) / 150, (performance.now() - o.t0) / ALONG_BLEND_MS), w = MathUtils.smoothstep(Math.min(1, t), 0, 1);
      if (t >= 1) o.done = true;
      else {
        const mix = (a, b) => a + (b - a) * w;
        pos = o.pos.clone().lerp(pos, w); quat = o.quat.clone().slerp(quat, w);
        next = { ...next, s: mix(o.view.s, home.s), tx: mix(o.view.tx, home.tx), ty: mix(o.view.ty, home.ty) };
      }
    }
    cam.position.copy(pos); cam.quaternion.copy(quat); cam.updateMatrixWorld(true);
    Object.assign(g, { s: next.s, tx: next.tx, ty: next.ty });
    this.railPose = { position: pos.clone(), quaternion: quat.clone() }; this.orbitTarget = null;
    this.tilted = true;
    return next;
  }
  // 進定線的開場：從 2D 的畫面 v0（快照的相機）飛到沿牆鏡頭的起點（成品包的 walk.intro），鏡頭位置、朝向、視角都跟著同一個進度 progress()（0～1）走。
  // 一路都是正軸的鏡頭（畫面中心就是鏡頭正前方，不偏軸裁切，不會拉斜變形）：起點轉向 v0 畫面中心那一點、視角縮到 v0 的大小，
  // 視角大小等比例變（放大的感覺整段一樣），位置、朝向跟著同一個進度。回傳停下來的 2D 畫面
  // ids：看線時要框住的路線岩點（停在 frameOf 算的位置）；沒給停在 walk.intro
  // at：畫面上要對準的那一點（舞台座標，從卡片進來時是卡片中心）：鏡頭轉向它，畫面框平移讓它留在原處，飛的途中平移慢慢歸零（平移不會拉斜）
  flyIn(v0, progress, ids = null, at = null) {
    const cam = this.camera, st = this.stage;
    this.resetTilt(); this.glide = null; this.introNext = true;
    const v1 = this.walkAlong(v0);   // 先站到停的位置量鏡頭、畫面框
    if (!v1) return Promise.resolve(null);
    const to = ids && this.frameOf(ids);
    if (to) { const wc = this.wc; Object.assign(wc, to); wc.clamp(); wc.want = wc.d; wc.apply(); }
    const g = this.glide, P1 = cam.position.clone(), Q1 = cam.quaternion.clone(), P0 = this.homePose.position.clone();
    const W = st.clientWidth, H = st.clientHeight, sw = this.snapW, sh = this.snapH, tanS = Math.tan(FOV * Math.PI / 360);
    const K0 = v0.bw * v0.s / sw, K1 = v1.bw * v1.s / sw;
    // 起點：v0 畫面中心在快照上的那一點，轉過去正對它；畫面高度（快照像素）照 v0
    const ax = at ? at[0] : W / 2, ay = at ? at[1] : H / 2, cx = (ax - v0.tx) / K0, cy = (ay - v0.ty) / K0, dir = new Vector3((cx / sw * 2 - 1) * tanS * sw / sh, (1 - cy / sh * 2) * tanS, -1).applyQuaternion(this.homePose.quaternion);
    cam.position.copy(P0); cam.lookAt(P0.clone().add(dir)); const Q0 = cam.quaternion.clone();
    const h0 = H / K0 / dir.length(), h1 = H / K1;   // 斜著看的那一點離得遠一點（1／cos）：轉過去正對它，看起來的大小照這個比例
    const viewAt = (h, k) => { const K = H / h; return { ...v0, s: K * sw / v0.bw, tx: -(sw / 2 - W / K / 2) * K + (ax - W / 2) * k, ty: -(sh / 2 - h / 2) * K + (ay - H / 2) * k }; };
    return new Promise((ok) => {
      const step = () => {
        if (!this.stage) return ok(null);
        const e = Math.max(0, Math.min(1, progress()));
        cam.position.lerpVectors(P0, P1, e); cam.quaternion.slerpQuaternions(Q0, Q1, e); cam.updateMatrixWorld(true);
        this.view = viewAt(h0 * (h1 / h0) ** e, 1 - e);
        this.draw();
        if (e < 1) { requestAnimationFrame(step); return; }
        this.view = { ...v1 }; Object.assign(g, { s: v1.s, tx: v1.tx, ty: v1.ty }); this.glide = g; this.tilted = true;
        ok(v1);
      };
      step();
    });
  }
  // 看線：沿牆鏡頭站在哪裡能框住這些岩點（路線）——中間對準岩點範圍的中間，距離剛好放得下整個範圍（上下扣掉工具列、牆頂的留白，四周留 25 公分）
  frameOf(ids) {
    const wc = this.wc, p = wc && wc.p, set = new Set(ids);
    if (!wc || !wc.table) return null;
    let s0 = Infinity, s1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const h of this.pack.holds) {
      if (!set.has(h.id) || !h.position) continue;
      const P = new Vector3(...h.position), a = P.dot(p.right), b = P.dot(p.f); let bi = 0, bd = Infinity;
      for (let i = 0; i < p.n; i++) { const e = (p.X[i] - a) ** 2 + (p.Y[i] - b) ** 2; if (e < bd) { bd = e; bi = i; } }
      const x = bi * WALK_STEP, y = P.dot(p.up); s0 = Math.min(s0, x); s1 = Math.max(s1, x); v0 = Math.min(v0, y); v1 = Math.max(v1, y);
    }
    if (s0 > s1) return null;
    const tan = wc.tan, top = wc.table.top || 0, bottom = wc.table.bottom || 0, use = 1 - top - bottom, pad = 0.25;
    const d = Math.max(((s1 - s0) / 2 + pad) / (tan * wc.W / wc.H), ((v1 - v0) / 2 + pad) / (tan * use), wc.dMin);
    const to = { s: (s0 + s1) / 2, v: (v0 + v1) / 2 + (top - bottom) * d * tan, d };   // 看得到的那一段（工具列和留白之間）的中間對準岩點
    // 照實際的畫面修正：轉角附近鏡頭是斜著看的，沿牆的距離估不準。投影到畫面上，沒放進留白以內就往中間移、往後退，幾次就穩
    const pts = this.pack.holds.filter(h => set.has(h.id) && h.position).map(h => new Vector3(...h.position)), keep = { s: wc.s, v: wc.v, d: wc.d, want: wc.want };
    const yb = -1 + 2 * bottom, yt = 1 - 2 * top, q = new Vector3();
    for (let k = 0; k < 6; k++) {
      Object.assign(wc, to); wc.clamp(); wc.apply(); Object.assign(to, { s: wc.s, v: wc.v, d: wc.d });
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const P of pts) { q.copy(P).project(this.camera); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
      const kx = Math.max(x1 - x0, 1e-3) / 1.7, ky = Math.max(y1 - y0, 1e-3) / ((yt - yb) * 0.85), grow = Math.max(kx, ky);
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2 - (yt + yb) / 2;
      if (grow <= 1.02 && Math.abs(cx) < 0.05 && Math.abs(cy) < 0.05) break;
      to.s += cx * wc.d * tan * wc.W / wc.H; to.v += cy * wc.d * tan; to.d *= Math.max(1, grow);
    }
    Object.assign(wc, keep); wc.apply();
    return to;
  }
  // 看線時換到框住這些岩點的位置：沿牆走過去（位置、高度直線變、距離等比例變，慢起慢停），每一格 onFrame（重投外框）；回傳停下來的 2D 畫面
  frameTo(ids, onFrame, ms = 600) {
    const wc = this.wc, to = this.glide && this.frameOf(ids);
    if (!to) return Promise.resolve(null);
    const a = { s: wc.s, v: wc.v, d: wc.d }, t0 = performance.now(), sm = (x) => x * x * (3 - 2 * x);
    return new Promise((ok) => {
      const step = () => {
        if (!this.stage || this.wc !== wc) return ok(null);
        const u = Math.min(1, (performance.now() - t0) / ms), e = sm(u);
        wc.s = a.s + (to.s - a.s) * e; wc.v = a.v + (to.v - a.v) * e; wc.d = a.d * (to.d / a.d) ** e; wc.clamp(); wc.want = wc.d;
        wc.apply(); this.camera.near = 0.005; this.camera.far = 100; this.railPose = { position: this.camera.position.clone(), quaternion: this.camera.quaternion.clone() };
        this.draw(); if (onFrame) onFrame();
        if (u < 1) { requestAnimationFrame(step); return; }
        ok({ ...this.view });
      };
      step();
    });
  }
  walk(view, at = null) {
    if (this.pack.walkData) return this.walkAlong(view, at);
    const st = this.stage;
    if (!st || !view || !view.bw) return null;
    const W = st.clientWidth, H = st.clientHeight, cam = this.camera, up = this.up, right = this.rail.right, R = this.rail;
    this.view = view;
    if (this.offVec) { cam.position.sub(this.offVec); this.offVec = null; cam.updateMatrixWorld(true); }   // 橡皮筋的位移先拿掉，量位置才不會把它當成真的走到那裡
    // 鏡頭自己記住沿牆的左右位置 x、看的高度 th、放大倍數 Z（照上次給出去的視角算差多少）：
    // 左右照畫面中央那條線打到平滑牆面的位置（一比一跟手），上下只照手指移動的量（斜著看時打到的高度會變，畫面會上下飄），捏合只改 Z
    const center = (v) => { this.aimRay(v, W / 2, H / 2); return this.railHit(this.raycaster.ray); };
    let g = this.glide, xPrev = null, fingerDx = 0, thPrev = null;
    if (!g) {
      const hit = (this.aimRay(view, W / 2, H / 2), this.firstHit());
      if (!hit) { this.applyView(); return false; }   // 中央打不到牆（牆的外面）：不動，呼叫端退回上一個視角
      const T = this.railHit(this.raycaster.ray) || hit.point;
      g = this.glide = { x: T.dot(right), th: T.dot(up), Z: 1, s: view.min || 1, tx: view.tx, ty: view.ty, mpp: 0 };
      g.pose0 = { x: g.x, th: g.th, pos: cam.position.clone(), quat: cam.quaternion.clone(), view: { s: view.s, tx: view.tx, ty: view.ty } };   // 剛站上軌道的樣子（正面快照的相機、畫面）
    } else {
      xPrev = g.x; fingerDx = view.tx - g.tx;   // 這一格手指（畫面）橫向移動的量
      const T = center(view); if (T) g.x = T.dot(right);
      // 橡皮筋：手指往回拉時先把拉過頭的量還回去，牆才開始往回走
      const ov = this.over || 0, want = g.x - xPrev;
      if (ov !== 0 && want * ov < 0) { const eat = Math.min(Math.abs(ov), Math.abs(want)); this.over = ov - Math.sign(ov) * eat; g.x = xPrev + want + Math.sign(ov) * eat; }
      thPrev = g.th;
      g.th -= ((H / 2 - view.ty) / view.s - (H / 2 - g.ty) / g.s) * g.mpp * g.s;
    }
    g.Z = Math.max(1, g.Z * view.s / g.s);
    // 跟 2D 一樣，畫面裡不露出牆外。上下：畫面比牆高就置中（上下留黑），不然畫面上下緣不超過牆的上下緣（照平滑牆面上的高度）。
    // 左右：畫面中間、牆頂、牆底三個高度上，畫面左右邊緣從鏡頭打出去的線都要打得到牆（用模型打），打不到就往畫面中間推到剛好打得到（斜切的角也是這樣消掉）；
    // 只有再推會把岩點推出畫面的另一邊時停住（不漏點）
    const before = cam.position.clone(), q0 = cam.quaternion.clone();
    let p = this.pose(g, view);
    // 手指帶著畫面走：上一格畫面中央那一點（orbitTarget）這一格要正好離開中央「手指移動的量」。鏡頭轉得快的地方（牆的轉角、兩端的進場段）
    // 鏡頭繞著目標轉，牆面移動的量會跟手指差很多（往盡頭衝過頭、反向時拖不動），所以照實際差多少把這一格走的距離縮放回一比一
    if (xPrev !== null && this.orbitTarget && Math.abs(fingerDx) > 2 && g.x !== xPrev) {
      for (let k = 0; k < 2; k++) {
        this.aimRay(p.next, W / 2, H / 2);
        const off = this.orbitTarget.clone().project(cam), ox = (off.x) * W / 2;   // 上一個目標在新畫面上離中央幾個像素
        const ratio = ox / fingerDx;
        if (!(ratio > 0.05)) break;
        if (Math.abs(ratio - 1) < 0.03) break;
        g.x = xPrev + (g.x - xPrev) / Math.min(2.5, Math.max(0.4, ratio));
        p = this.pose(g, view);
      }
    }
    const xWanted = g.x;   // 手指這一格要走到的位置（還沒被盡頭夾住）
    // 牆的邊貼到畫面邊（不露出牆外的空白）：量牆的邊緣抽樣點投到畫面上的位置（斜看、凸出的地方用公尺換算會差幾十個像素）。
    // 左右：牆的左邊不能比畫面左緣更靠右、右邊不能比右緣更靠左；上下：看得到的牆最低的點不能比 EDGE_BOTTOM 更往上（下面浮著工具列，貼到工具列上緣）、
    // 最高的不能比 EDGE_TOP 更往下。牆比畫面小（放得夠小）就置中。範圍的硬上限是牆本身（rail.lo／hi、hlo／hhi），最外側的岩點一定帶得到畫面裡
    const E = this.edges, R0 = this.rail;
    g.x = MathUtils.clamp(g.x, R0.lo, R0.hi); g.th = MathUtils.clamp(g.th, R0.hlo, R0.hhi);
    p = this.pose(g, view);
    const extents = (q) => {   // 抽樣點投到畫面：左、右、（畫面左右範圍內的）上、下
      const M = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse).elements, kk = view.bw * q.s / this.snapW, sw = this.snapW * kk, sh = this.snapH * kk;
      let xl = Infinity, xr = -Infinity, yt = Infinity, yb = -Infinity;
      for (let i = 0; i < E.length; i += 3) {
        const x = E[i], y = E[i + 1], z = E[i + 2], w = M[3] * x + M[7] * y + M[11] * z + M[15];
        if (w < 0.25) continue;   // 貼著鏡頭旁邊的點（斜看時側牆幾乎貼邊）投影會飛到好幾百萬像素，不算
        const sx = q.next.tx + ((M[0] * x + M[4] * y + M[8] * z + M[12]) / w + 1) / 2 * sw;
        if (sx < xl) xl = sx; if (sx > xr) xr = sx;
        if (sx >= 0 && sx <= W) { const sy = q.next.ty + (1 - (M[1] * x + M[5] * y + M[9] * z + M[13]) / w) / 2 * sh; if (sy < yt) yt = sy; if (sy > yb) yb = sy; }
      }
      return { xl, xr, yt, yb };
    };
    if (E && E.length) {
      const ex = (x) => { g.x = x; return extents(this.pose(g, view)); };
      const x0c = g.x, a0 = ex(x0c);
      let x = x0c;
      if (a0.xl > 0 && a0.xr < W) {   // 牆比畫面窄：置中（牆的左右兩邊中間對畫面中間）
        const b0 = ex(x0c + 0.05), sm = ((b0.xl - a0.xl) + (b0.xr - a0.xr)) / 0.1;
        if (Math.abs(sm) > 1) x = x0c + (W / 2 - (a0.xl + a0.xr) / 2) / sm;
      } else if (a0.xl > 0 || a0.xr < W) {
        // 左邊（或右邊）露出牆外：鏡頭往回找，找到牆的邊剛好貼到畫面邊的位置。靠近盡頭時鏡頭一邊走一邊轉（進場段），畫面上的邊動得很慢，
        // 用牛頓法會算不出來，所以一步 0.05 公尺往外找（最多 2 公尺），找不到就停在邊最靠近的那一步
        const dir = a0.xl > 0 ? 1 : -1, bad = (e) => dir > 0 ? e.xl : W - e.xr;   // 左邊露出空白要把鏡頭往右移（牆往左走）；bad ≤ 0 就貼到了
        let best = x0c, bv = bad(a0);
        for (let k = 1; k <= 40; k++) {
          const xc = MathUtils.clamp(x0c + dir * 0.05 * k, R0.lo, R0.hi), v = bad(ex(xc));
          if (v < bv) { bv = v; best = xc; }
          if (v <= 0 || xc === R0.lo || xc === R0.hi) break;
        }
        x = best;
      }
      g.x = MathUtils.clamp(x, R0.lo, R0.hi);
      p = this.pose(g, view);
    }
    const top = EDGE_TOP * H, bot = H * (1 - EDGE_BOTTOM), thStart = g.th;
    for (let it = 0; E && E.length && it < 3; it++) {
      const th0 = g.th; g.th = th0; const a = extents(this.pose(g, view)); g.th = th0 + 0.05; const b = extents(this.pose(g, view)); g.th = th0;
      const st = (b.yt - a.yt) / 0.05, sb = (b.yb - a.yb) / 0.05;   // 高度變 1 公尺，畫面上這兩個點動幾個像素（量出來的，不用公尺換算）
      let th = th0;
      if (a.yt > top && a.yb < bot) th = th0 + ((top + bot) / 2 - (a.yt + a.yb) / 2) / ((st + sb) / 2 || 1);
      else if (a.yt > top && Math.abs(st) > 1) th = th0 + (top - a.yt) / st;
      else if (a.yb < bot && Math.abs(sb) > 1) th = th0 + (bot - a.yb) / sb;
      th = MathUtils.clamp(th, R0.hlo, R0.hhi);
      if (!Number.isFinite(th) || Math.abs(th - th0) < 1e-4) break;
      g.th = th;
    }
    // 手指這一格往上、下拖過頭的量全部拉回來（硬上限）；其他原因的拉回（橫著滑到牆的另一段、那裡的岩點高低不同）一格最多 7 個像素，畫面慢慢靠過去，不會一下子跳
    const step = (thPrev === null ? 0 : Math.abs(thStart - thPrev)) + 7 * g.mpp;
    g.th = thStart + MathUtils.clamp(g.th - thStart, -step, step);
    p = this.pose(g, view);
    // 到了盡頭（上面的夾住把這一格要走的量吃掉了）：吃掉的量累積成橡皮筋，鏡頭沿牆多滑一段（越拉越慢），放手彈回（settle）
    if (xPrev !== null && Math.abs(xWanted - xPrev) > 1e-4) { const e = xWanted - g.x; if (e * (xWanted - xPrev) > 0) { const k = Math.max(0, 1 - Math.abs(this.over || 0) / OVER_MAX); this.over = (this.over || 0) + e * k * k; } }   // over 就是畫面上多滑的公尺數：越拉阻力越大，拉到 OVER_MAX 就拉不動；往回拉 1 比 1 還回去
    // 剛站上軌道：軌道上的相機（站在目標正前方、水平、偏幾度）跟快照的相機（站得遠、對著整面牆中心）位置、角度不同，放大後直接換過去，
    // 第一次摸畫面（長按、拖、捏）整個畫面會跳幾百個像素。從快照的相機慢慢換成軌道的：走（左右、高度）RAIL_BLEND 公尺或放大到 1.35 倍才換完；沒動的時候就是原來的畫面
    const o = g.pose0;
    if (o && !o.done) {
      const t = Math.max(Math.abs(g.x - o.x) / RAIL_BLEND, Math.abs(g.th - o.th) / RAIL_BLEND, Math.abs(Math.log(g.Z)) / 0.3), w = MathUtils.smoothstep(Math.min(1, t), 0, 1);
      if (t >= 1) o.done = true;
      else {
        const mix = (a, b) => a + (b - a) * w;
        p.pos = o.pos.clone().lerp(p.pos, w); p.quat = o.quat.clone().slerp(p.quat, w);
        p.next = { ...p.next, s: mix(o.view.s, p.next.s), tx: mix(o.view.tx, p.next.tx), ty: mix(o.view.ty, p.next.ty) }; p.s = p.next.s;
      }
    }
    cam.position.copy(p.pos); cam.quaternion.copy(p.quat);
    if (this.over) { this.offVec = right.clone().multiplyScalar(this.over); cam.position.add(this.offVec); }
    cam.updateMatrixWorld(true);
    // 下一格：螢幕上一個像素在目標那裡是幾公尺（只用來換算上下拖的量）
    const k = view.bw * p.s / this.snapW;
    Object.assign(g, { s: p.s, tx: p.next.tx, ty: p.next.ty, mpp: 2 * Math.tan(MathUtils.degToRad(FOV / 2)) * p.depth / (this.snapH * k) });
    const next = p.next;
    if (p.pos.distanceTo(before) < 1e-4 && p.quat.angleTo(q0) < 1e-5 && Math.abs(next.s - view.s) < 1e-3 && Math.abs(next.tx - view.tx) < 0.5 && Math.abs(next.ty - view.ty) < 0.5) { this.applyView(); return null; }
    this.orbitTarget = p.T; this.railPose = { position: p.pos.clone(), quaternion: p.quat.clone() };
    this.tilted = true;
    return next;
  }
  // 視角 v（2D 的裁切、位移）下，從鏡頭打向畫面上 (sx, sy) 那一點的線放進 raycaster
  aimRay(v, sx, sy) {
    const cam = this.camera, K = v.bw * v.s / this.snapW;
    cam.setViewOffset(this.snapW, this.snapH, -v.tx / K, -v.ty / K, this.stage.clientWidth / K, this.stage.clientHeight / K); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    const W = this.stage.clientWidth, H = this.stage.clientHeight;
    this.raycaster.setFromCamera(new Vector2(sx / W * 2 - 1, -sy / H * 2 + 1), cam);
  }
  // 沿牆位置 x、看的高度 th、放大倍數 Z → 鏡頭的位置、朝向、2D 視角（目標在畫面中央）。鏡頭會放到這個姿勢上
  pose(g, view) {
    const cam = this.camera, up = this.up, right = this.rail.right, st = this.stage, W = st.clientWidth, H = st.clientHeight;
    const flat = (v) => v.clone().sub(up.clone().multiplyScalar(v.dot(up)));
    const { x, th } = g, home = this.homePose.position, dRef = flat(this.center.clone().sub(home)).length(), homeH = home.dot(up);
    // 兩端的進場段：越接近牆的盡頭，鏡頭自動走得越近（至少 RAIL_END_ZOOM 倍）、角度收回到接近正對那段牆，最左邊走進洞前面看清楚洞裡和內角
    const R = this.rail, ease = (t) => t * t * (3 - 2 * t), eL = ease(MathUtils.clamp((R.hxlo + RAIL_END - x) / RAIL_END, 0, 1)), eR = ease(MathUtils.clamp((x - (R.hxhi - RAIL_END)) / RAIL_END, 0, 1));
    const zEnd = Math.max(1, RAIL_END_ZOOM / (view.min || 1));   // 兩端至少放大到 RAIL_END_ZOOM 倍（相對整張快照）；最小縮放已經放大了的話，兩端就不再多放大
    const Z = Math.max(g.Z, 1 + (zEnd - 1) * Math.max(eL, eR));
    const at = this.railPoint(x), T = at.clone().addScaledVector(up, th);
    // 距離只看 Z；看高處、低處時往後退到那一點在畫面上下緣內；高度從正面的高度隨著走近換到拍照時手機的高度
    const tanV = Math.tan(MathUtils.degToRad(FOV / 2)) * 0.8;
    let dist = dRef / Math.sqrt(Z), h = homeH;
    for (let k = 0; k < 4; k++) { h = this.eyeH + (homeH - this.eyeH) * Math.min(1, dist / dRef); dist = Math.max(dRef / Math.sqrt(Z), dRef * 0.12, Math.abs(th - h) / tanV); }
    // 看的方向只看左右位置 x（每個放大倍數都一樣，放大只是走近）：跟著牆的方向（平滑 RAIL_TURN 公尺，慢慢轉）再往右偏 RAIL_ANGLE，
    // 從正面牆一路滑過去，視角慢慢轉到側面牆，最後從右邊看進左邊的內角，看不到牆的背後
    const base = this.viewAngle(x), a = MathUtils.lerp(base + RAIL_ANGLE, base + RAIL_END_ANGLE, Math.max(eL, eR));   // 進場段收回到接近正對那段牆
    const side = right.clone().multiplyScalar(Math.sin(a)).addScaledVector(this.eye, Math.cos(a));
    const pos = at.clone().addScaledVector(side, dist).addScaledVector(up, h);
    const m = view.min || 1;   // 最小的裁切放大（2D 的最小縮放：3D 牆最小就填滿畫面，不是整張快照）：Z 是相對它的倍數
    const s = m * Math.max(1, Z * dist / dRef);   // 裁切放大只看 Z，左右滑時畫面比例不變
    cam.position.copy(pos); cam.up.copy(up); cam.lookAt(pos.clone().sub(side)); cam.clearViewOffset(); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    const ndc = T.clone().project(cam), u = (ndc.x + 1) / 2 * this.snapW, v = (1 - ndc.y) / 2 * this.snapH, k = view.bw * s / this.snapW;
    return { pos, quat: cam.quaternion.clone(), s, T, depth: dist, next: { ...view, s, tx: W / 2 - u * k, ty: H / 2 - v * k } };
  }
  resetTilt() {
    if (!this.tilted) return false;
    this.camera.position.copy(this.homePose.position); this.camera.quaternion.copy(this.homePose.quaternion); this.camera.updateMatrixWorld(true);
    this.orbitTarget = null; this.railPose = null; this.glide = null; this.over = 0; this.offVec = null; this.turned = 0; if (this.wc) Object.assign(this.wc, { yaw: 0, pass: false, passFrom: null, passK: 0, atEnd: 0 });
    this.tilted = false; this.invalidate();
    return true;
  }
  // 快照：正面、原色、不畫路線（牆的「照片」：小卡、縮圖、分享圖都從它來）
  snapshot() {
    if (this.baked && this.pack.snapshot && this.pack.snapshot.canvas) return this.pack.snapshot.canvas;   // 成品包的快照是烘焙好的
    const r = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    r.outputColorSpace = SRGBColorSpace; r.setPixelRatio(1); r.setSize(this.snapW, this.snapH, false);
    const was = this.baseMode.value, shown = this.overlays.map(m => m.visible);
    this.baseMode.value = 0; this.backdrop(); this.overlays.forEach(m => { m.visible = false; });
    this.camera.clearViewOffset(); this.camera.updateProjectionMatrix();
    r.render(this.scene, this.camera);
    const c = document.createElement('canvas'); c.width = this.snapW; c.height = this.snapH; c.getContext('2d').drawImage(r.domElement, 0, 0);
    this.baseMode.value = was; this.backdrop(); this.overlays.forEach((m, i) => { m.visible = shown[i]; });
    r.dispose(); r.forceContextLoss();
    return c;
  }
  // 每顆岩點投到目前相機（整張快照）上的外框：岩點面的頂點投影取凸包，再精簡到最多 32 點。被擋住、在畫面外的照樣給（點選用射線，不用外框）。
  // 只投每顆的候選點（hullPoints）：整面牆從幾百毫秒降到幾毫秒，走近、拖曳的途中可以每格重投。only：只算這些岩點 id
  outlines(only = null) {
    const bo = this.bakedFront();
    if (bo && !only && !this.tilted) return bo;
    const cam = this.camera, W = this.snapW, H = this.snapH, v = new Vector3(), out = [];
    cam.clearViewOffset(); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    this.overlays.forEach((m, i) => {
      if (only && !only.has(this.holds[i].id)) return;
      const Q = this.hullPoints(i), pts = [], seen = new Set();
      for (let k = 0; k < Q.length; k += 3) {
        v.set(Q[k], Q[k + 1], Q[k + 2]).project(cam); if (v.z < -1 || v.z > 1) continue;
        const x = Math.round((v.x + 1) / 2 * W * 2) / 2, y = Math.round((1 - v.y) / 2 * H * 2) / 2, key = x + ',' + y;
        if (!seen.has(key)) { seen.add(key); pts.push([x, y]); }
      }
      if (pts.length >= 3) out.push({ id: this.holds[i].id, poly: simplify(hull(pts), 32) });
    });
    this.applyView();
    return out;
  }
  // 外框的候選點（世界座標，x,y,z 連著放）：這顆自己標籤的頂點裡，往 HULL_DIRS 每個方向最突出的那一點。
  // 投影後的凸包頂點一定是某個方向最突出的點，所以用這些點取凸包跟用全部頂點幾乎一樣。改外框（修點）時清掉受影響的
  hullPoints(i) {
    let Q = this.hullCache.get(i);
    if (Q) return Q;
    const m = this.overlays[i], P = m.geometry.attributes.position, v = new Vector3(), n = HULL_DIRS.length;
    const best = new Float64Array(n).fill(-Infinity), at = new Float32Array(n * 3);
    for (let k = 0; k < P.count; k++) {
      if (this.labelOf(m, k) !== i + 1) continue;
      v.fromBufferAttribute(P, k).applyMatrix4(m.matrixWorld);
      for (let d = 0; d < n; d++) {
        const [a, b, c] = HULL_DIRS[d], t = a * v.x + b * v.y + c * v.z;
        if (t > best[d]) { best[d] = t; at[d * 3] = v.x; at[d * 3 + 1] = v.y; at[d * 3 + 2] = v.z; }
      }
    }
    const keep = [];
    for (let d = 0; d < n; d++) if (best[d] > -Infinity) keep.push(at[d * 3], at[d * 3 + 1], at[d * 3 + 2]);
    Q = new Float32Array(keep); this.hullCache.set(i, Q);
    return Q;
  }
  // 覆蓋網格第 k 個頂點的貼圖標籤
  labelOf(m, k) {
    const uv = m.geometry.attributes.uv, s = this.labelSize;
    const x = Math.min(s - 1, Math.max(0, Math.floor(uv.getX(k) * s))), y = Math.min(s - 1, Math.max(0, Math.floor(uv.getY(k) * s)));
    return this.labels[y * s + x];
  }
  // 掛到牆頁的舞台（#stage），放在 2D 畫布（#cv）下面
  ensureRenderer() {
    if (this.renderer) return this.renderer;
    const r = this.renderer = new WebGLRenderer({ antialias: true });
    r.outputColorSpace = SRGBColorSpace; r.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    r.domElement.className = 'stage-3d';
    return r;
  }
  // 進定線前先暖機：開 WebGL、編好著色器、把模型與貼圖送上顯示卡（畫在看不見的小畫布上一次），進去時第一格不用卡著等
  warm() {
    if (this.warmed || this.stage) return;
    this.warmed = true;
    try {
      const r = this.ensureRenderer();
      r.setSize(64, 64, false); this.applyView();
      r.render(this.scene, this.camera);
    } catch (e) { console.warn('3D warm-up failed', e); }
  }
  mount(stage, before) {
    this.ensureRenderer();
    stage.insertBefore(this.renderer.domElement, before);
    this.stage = stage;
    this.invalidate();
  }
  unmount() { if (this.renderer) this.renderer.domElement.remove(); this.stage = null; }
  dispose() { this.unmount(); if (this.glow) { for (const k of ['mask', 'a', 'b', 'c', 'd', 'ids']) this.glow[k].dispose(); this.glow = null; } if (this.renderer) { this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer = null; } this.warmed = false; }
  // 牆外的底色＝牆面顏色（照底色模式換算，跟牆面的 shader 一樣），畫面露出牆外時看起來是牆面延伸，不是黑洞
  backdrop() {
    const [r, g, b] = this.wallTone, m = this.baseMode.value, y = r * 0.2126 + g * 0.7152 + b * 0.0722;
    const c = m > 1.5 ? [r, g, b].map(v => v * 0.42) : m > 0.5 ? [y * 0.48 + 0.031, y * 0.48 + 0.039, y * 0.48 + 0.049] : [r, g, b];
    this.scene.background = new Color().setRGB(...c); this.wallBack.value.setRGB(...c); this.invalidate();
  }
  // 2D 的視角：快照縮放 s、平移 tx, ty（舞台座標），bw：s=1 時快照在舞台上的寬
  setView(view) { this.view = { s: view.s, tx: view.tx, ty: view.ty, bw: view.bw, min: view.min }; this.invalidate(); }
  // 左右滑換線時整個舞台跟著手指移
  shift(off) { this.off = off; if (this.renderer) this.renderer.domElement.style.transform = off ? `translateX(${off}px)` : ''; }
  // 路線：{ 岩點 id: 角色 }；mode：gray／dim／photo；colors：角色顏色
  paint({ holds, mode, colors }) {
    this.baseMode.value = mode === 'gray' ? 1 : mode === 'dim' ? 2 : 0; this.backdrop();
    this.overlays.forEach((m, i) => {
      const role = holds[this.holds[i].id];
      m.visible = !!role;
      if (role) { m.userData.style.roleColor.value.set(colors[role] || '#ffffff'); this.fillOf(i).material.uniforms.roleColor.value.set(colors[role] || '#ffffff'); }
    });
    this.invalidate();
  }
  // 量體上裝了別的岩點（被它圍住的面）：光暈當成量體的一部分，不繞著每個洞發光。只畫在光暈的遮罩裡
  fillOf(i) {
    const fills = this.fills || (this.fills = new Map());
    if (!fills.has(i)) {
      const mat = new ShaderMaterial({ uniforms: { roleColor: { value: new Color('#ffffff') }, holdId: { value: new Vector2((i + 1) % 256 / 255, Math.floor((i + 1) / 256) / 255) }, maskMode: this.maskMode },
        side: DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        vertexShader: 'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}', fragmentShader: 'uniform vec3 roleColor;uniform vec2 holdId;uniform float maskMode;void main(){gl_FragColor=maskMode>1.5?vec4(holdId,0.,1.):vec4(roleColor,1.);}' });
      if (this.bigHold === undefined) { const c = this.holds.map(h => h.faceCount).sort((a, b) => a - b); this.bigHold = 5 * c[c.length >> 1]; }
      const m = new Mesh(this.faceGeometry(this.holds[i].faceCount >= this.bigHold ? this.enclosed(i + 1) : []), mat);   // 只有量體（面數是中位數 5 倍以上）上面會裝別的岩點
      m.matrix.copy(this.surface.matrixWorld); m.matrixAutoUpdate = false; m.visible = false; m.renderOrder = 1; this.scene.add(m);
      fills.set(i, m);
    }
    return fills.get(i);
  }
  // 被這顆岩點（標籤 idx）圍住的別的岩點的面：從它的邊往外、只走別的岩點的面，碰到牆面或走太遠（面數超過它的一半）就不算；
  // 牆面不填（之前連牆面一起填，量體的範圍會多出一塊）
  enclosed(idx) {
    const I = this.surface.geometry.index, F = this.faceLabels, tris = F.length;
    if (!this.adjacent) {   // 共用一條邊的面（第一次要用才建）
      const nv = this.surface.geometry.attributes.position.count, edge = new Map(), adj = Array.from({ length: tris }, () => []);
      for (let f = 0; f < tris; f++) for (let j = 0; j < 3; j++) {
        const a = I.getX(f * 3 + j), b = I.getX(f * 3 + (j + 1) % 3), key = Math.min(a, b) * nv + Math.max(a, b), g = edge.get(key);
        if (g === undefined) edge.set(key, f); else { adj[f].push(g); adj[g].push(f); }
      }
      this.adjacent = adj;
    }
    const own = []; for (let f = 0; f < tris; f++) if (F[f] === idx) own.push(f);
    const limit = Math.max(20, own.length >> 1), state = new Uint8Array(tris), out = [];   // 1：走過、2：圍住
    for (const f of own) state[f] = 3;
    for (const f of own) for (const g of this.adjacent[f]) {
      if (state[g]) continue;
      if (!F[g]) continue;
      const seen = [g], stack = [g]; let open = false; state[g] = 1;
      while (stack.length && seen.length <= limit && !open) for (const h of this.adjacent[stack.pop()]) {
        if (state[h]) continue;
        if (!F[h]) { open = true; break; }   // 碰到牆面：沒被圍住
        state[h] = 1; seen.push(h); stack.push(h);
      }
      if (!open && seen.length <= limit) { for (const h of seen) state[h] = 2; out.push(...seen); }
    }
    return out;
  }
  applyView() {
    const v = this.view, st = this.stage;
    if (!v || !st || !v.bw) return;
    const K = v.bw * v.s / this.snapW, W = st.clientWidth, H = st.clientHeight;
    this.camera.setViewOffset(this.snapW, this.snapH, -v.tx / K, -v.ty / K, W / K, H / K);
    this.camera.updateProjectionMatrix();
  }
  invalidate() {
    if (this.dirty) return;
    this.dirty = true;
    requestAnimationFrame(() => { this.dirty = false; this.draw(); });
  }
  draw() {
    const st = this.stage, r = this.renderer;
    if (!st || !r || !this.view) return;
    const W = st.clientWidth, H = st.clientHeight;
    if (!W || !H) return;
    const size = r.getSize(new Vector2());
    if (size.x !== W || size.y !== H) r.setSize(W, H);
    this.applyView();
    const route = this.overlays.some(m => m.visible);
    if (route) this.glowMask();
    r.setRenderTarget(null); r.render(this.scene, this.camera);
    if (route) this.glowComposite();
  }
  // 光暈（畫面上的後製，放大縮小一樣寬）：路線岩點畫成角色色的遮罩（被牆面擋住的不畫；量體上裝的岩點填滿），縮成一半、高斯模糊兩次（橫、直），
  // 從修圓滑的岩點形狀往外漸淡，內外圈都平整，靠在一起的岩點光暈疊在一起；越靠近岩點越亮、帶一點白
  glowSetup() {
    const quadVS = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
    const rt = (opts) => new WebGLRenderTarget(1, 1, { minFilter: LinearFilter, magFilter: LinearFilter, ...opts });
    const blur = new ShaderMaterial({ uniforms: { src: { value: null }, dir: { value: new Vector2() } }, vertexShader: quadVS, depthTest: false, depthWrite: false,
      fragmentShader: 'uniform sampler2D src;uniform vec2 dir;varying vec2 vUv;void main(){vec4 s=vec4(0.);float t=0.;for(int i=-6;i<=6;i++){float w=exp(-float(i*i)/18.);s+=texture2D(src,vUv+dir*float(i))*w;t+=w;}gl_FragColor=s/t;}' });
    const comp = new ShaderMaterial({ uniforms: { glow: { value: null }, shape: { value: null }, ids: { value: null }, mask: { value: null }, reach: { value: new Vector2() } }, vertexShader: quadVS, transparent: true, depthTest: false, depthWrite: false,
      // 內圈：輕微模糊後覆蓋率 0.5 的等高線，是修圓滑的岩點形狀（鋸齒、小洞蓋過去），但不會把兩顆岩點中間的縫填起來；
      // 外圈：大模糊的覆蓋率往外漸淡，兩顆靠近的岩點光暈在縫裡疊在一起。
      // 兩顆岩點貼在一起：遮罩連成一塊，交界不是外圈，光暈會斷在那裡；交界兩側各一小段（約 4 個螢幕點，越靠交界越亮）照岩點編號畫成自己的光暈色，兩圈光暈接起來
      fragmentShader: `uniform sampler2D glow;uniform sampler2D shape;uniform sampler2D ids;uniform sampler2D mask;uniform vec2 reach;varying vec2 vUv;
        float other(vec4 me,vec2 d){vec4 n=texture2D(ids,vUv+d);return n.a>.5&&(abs(n.r-me.r)+abs(n.g-me.g))>.001?1.:0.;}
        void main(){vec4 g=texture2D(glow,vUv);float k=texture2D(shape,vUv).a;float aa=max(fwidth(k),.002);float inside=smoothstep(.5-aa,.5+aa,k);
        vec4 me=texture2D(ids,vUv);float seam=0.;
        if(me.a>.5){for(int i=0;i<12;i++){float t=float(i)*.523599;vec2 d=vec2(cos(t),sin(t))*reach;seam+=other(me,d)+other(me,d*.667)+other(me,d*.333);}seam=smoothstep(0.,.25,seam/36.);}
        vec4 m=texture2D(mask,vUv);vec3 own=m.rgb/max(m.a,.001);
        float a=max(smoothstep(.03,.5,g.a)*(1.-inside),seam*inside)*.9;if(a<.004)discard;
        vec3 c=mix(g.rgb/max(g.a,.001),own,seam*inside);c=mix(c,vec3(1.),.3*a);gl_FragColor=vec4(c,a);
        #include <colorspace_fragment>
        }` });
    const quad = new Mesh(new PlaneGeometry(2, 2), blur), scene = new Scene(); scene.add(quad);
    this.glow = { mask: rt({ depthBuffer: true }), a: rt({ depthBuffer: false }), b: rt({ depthBuffer: false }), c: rt({ depthBuffer: false }), d: rt({ depthBuffer: false }), ids: rt({ depthBuffer: true, minFilter: NearestFilter, magFilter: NearestFilter }), blur, comp, quad, scene, cam: new OrthographicCamera(-1, 1, 1, -1, 0, 1) };
  }
  glowMask() {
    const r = this.renderer, size = r.getDrawingBufferSize(new Vector2());
    if (!this.glow) this.glowSetup();
    const G = this.glow, w = size.x, h = size.y, hw = Math.max(1, Math.round(w / 2)), hh = Math.max(1, Math.round(h / 2));
    if (G.mask.width !== w || G.mask.height !== h) { G.mask.setSize(w, h); G.ids.setSize(w, h); for (const t of [G.a, G.b, G.c, G.d]) t.setSize(hw, hh); }
    // 遮罩：牆面只寫深度（擋住後面的岩點），路線岩點畫角色色
    const bg = this.scene.background, clear = r.getClearAlpha();
    this.scene.background = null; this.maskMode.value = 1; if (this.fill) this.fill.visible = false;
    for (const s of this.surfaces) s.material.colorWrite = false;
    const fills = this.overlays.flatMap((m, i) => m.visible ? [this.fillOf(i)] : []);
    for (const m of fills) m.visible = true;
    r.setRenderTarget(G.mask); r.setClearColor(0x000000, 0); r.clear(); r.render(this.scene, this.camera);
    this.maskMode.value = 2; r.setRenderTarget(G.ids); r.clear(); r.render(this.scene, this.camera);
    for (const m of fills) m.visible = false;
    for (const s of this.surfaces) s.material.colorWrite = true;
    this.scene.background = bg; this.maskMode.value = 0; r.setClearAlpha(clear); if (this.fill) this.fill.visible = true;
    // 模糊縮成一半做：光暈約 6 個螢幕點的標準差（b），岩點形狀約 1.5 點（d）
    G.quad.material = G.blur;
    const blur = (sigma, out, tmp) => {
      const step = sigma * r.getPixelRatio() / 2 / 3;
      G.blur.uniforms.src.value = G.mask.texture; G.blur.uniforms.dir.value.set(step / hw, 0); r.setRenderTarget(tmp); r.render(G.scene, G.cam);
      G.blur.uniforms.src.value = tmp.texture; G.blur.uniforms.dir.value.set(0, step / hh); r.setRenderTarget(out); r.render(G.scene, G.cam);
    };
    blur(6, G.b, G.a); blur(1.5, G.d, G.c);
  }
  glowComposite() {
    const r = this.renderer, G = this.glow;
    G.quad.material = G.comp; G.comp.uniforms.glow.value = G.b.texture; G.comp.uniforms.shape.value = G.d.texture;
    G.comp.uniforms.ids.value = G.ids.texture; G.comp.uniforms.mask.value = G.mask.texture;
    G.comp.uniforms.reach.value.set(4 * r.getPixelRatio() / G.ids.width, 4 * r.getPixelRatio() / G.ids.height);
    r.autoClear = false; r.setRenderTarget(null); r.render(G.scene, G.cam); r.autoClear = true;
  }
  // 目前畫面的樣子（原色、不畫路線，舞台大小）：補點時從這張依顏色描岩點
  viewShot() {
    const r = this.renderer, st = this.stage, W = st.clientWidth, H = st.clientHeight;
    const size = r.getSize(new Vector2());
    if (size.x !== W || size.y !== H) r.setSize(W, H);
    const was = this.baseMode.value, shown = this.overlays.map(m => m.visible);
    this.baseMode.value = 0; this.overlays.forEach(m => { m.visible = false; });
    this.applyView(); r.render(this.scene, this.camera);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(r.domElement, 0, 0, W, H);   // 同一個工作裡讀，畫布還沒被清掉
    this.baseMode.value = was; this.overlays.forEach((m, i) => { m.visible = shown[i]; }); this.invalidate();
    return g.getImageData(0, 0, W, H);
  }
  // 舞台座標 (x, y) 點到的岩點 id：先看貼圖標籤（跟畫出來的外框一致），貼圖說是牆面再看面標籤；
  // 給了 rank(id)（點在它畫出來的外框裡回傳外框面積，不在回傳 null）：射線沿路穿過的岩點裡選 rank 最小的，跟 2D 的牆一樣重疊時選小的；
  // 外框不看遮擋，被前面的牆、大岩點擋住的岩點也有外框，點它的外框要選得到。沒有符合的就照射線打到的第一顆；
  // 都沒點到就找 tol 像素內看得到的岩點中心
  pick(x, y, tol = 22, rank = null) {
    const st = this.stage; if (!st || !this.view) return null;
    const W = st.clientWidth, H = st.clientHeight, cam = this.camera;
    this.applyView(); cam.updateMatrixWorld(true);
    this.raycaster.setFromCamera(new Vector2(x / W * 2 - 1, -y / H * 2 + 1), cam);
    const hits = this.hits();
    if (hits.length) {
      if (rank) {
        let best = null, bestR = Infinity;
        for (const h of hits) { const g = this.holdOfHit(h), r = g && rank(g.id); if (r != null && r < bestR) { bestR = r; best = g; } }
        if (best) return best.id;
      }
      const first = this.holdOfHit(hits[0]); if (first) return first.id;
    }
    // 射線打到牆面、但點在看得到的岩點外框裡（斜著看時外框是岩點投影的凸包，比岩點本身大一圈）：跟 2D 一樣選那顆（外框小的優先）
    if (rank) {
      let best = null, bestR = Infinity;
      for (const [i, h] of this.holds.entries()) { if (this.gone.has(i)) continue; const r = rank(h.id); if (r != null && r < bestR && this.seen(h)) { bestR = r; best = h; } }
      if (best) return best.id;
    }
    let best = tol * tol, id = null;
    const p = new Vector3();
    for (const [i, h] of this.holds.entries()) {
      if (this.gone.has(i)) continue;
      p.set(...h.position).project(cam);
      if (p.z < -1 || p.z > 1) continue;
      const dx = (p.x + 1) / 2 * W - x, dy = (1 - p.y) / 2 * H - y, d = dx * dx + dy * dy;
      if (d < best && this.seen(h)) { best = d; id = h.id; }
    }
    return id;
  }
  hitAt(x, y, W, H) {
    this.raycaster.setFromCamera(new Vector2(x / W * 2 - 1, -y / H * 2 + 1), this.camera);
    return this.firstHit();
  }
  // 射線打到的面上是哪顆岩點：貼圖標籤，貼圖說是牆面再看面標籤
  holdOfHit(hit) {
    if (hit.object !== this.surface) return null;
    if (hit.uv) {
      const s = this.labelSize, u = Math.min(s - 1, Math.max(0, Math.floor(hit.uv.x * s))), v = Math.min(s - 1, Math.max(0, Math.floor(hit.uv.y * s)));
      const h = this.holds[this.labels[v * s + u] - 1]; if (h) return h;
    }
    return this.holds[this.faceLabels[hit.faceIndex] - 1] || null;
  }
  // 射線打到的看得到的面（裁切框外的不畫，也不擋）：hits 由近到遠全部，firstHit 只要第一個
  shownHit() {
    const local = new Vector3(), inv = this.surface.matrixWorld.clone().invert(), s = this.labelSize;
    const onHold = (h) => h.uv && this.labels[Math.min(s - 1, Math.max(0, Math.floor(h.uv.y * s))) * s + Math.min(s - 1, Math.max(0, Math.floor(h.uv.x * s)))] > 0;
    return (h) => this.inFrame(local.copy(h.point).applyMatrix4(inv).toArray(), onHold(h));
  }
  hits() { return this.raycaster.intersectObjects(this.surfaces, false).filter(this.shownHit()); }
  firstHit() { return this.raycaster.intersectObjects(this.surfaces, false).find(this.shownHit()) || null; }
  // 目前相機看得到的岩點 id（中心在畫面裡、沒被牆面擋住）
  // 畫面上看得到的岩點：在目前的畫面框裡（走近後可以移到正面快照的範圍外），中心沒被擋住
  visibleIds() {
    const cam = this.camera, p = new Vector3(), out = new Set();
    this.applyView(); cam.updateMatrixWorld(true);
    for (const [i, h] of this.holds.entries()) {
      if (this.gone.has(i)) continue;
      p.set(...h.position).project(cam);
      if (Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && p.z >= -1 && p.z <= 1 && this.seen(h)) out.add(h.id);
    }
    this.applyView();
    return out;
  }
  // 岩點中心從相機看得到（沒有被牆面擋住）
  seen(h) {
    const target = new Vector3(...h.position), origin = this.camera.position, d = target.clone().sub(origin), dist = d.length();
    this.raycaster.set(origin, d.normalize());
    const hit = this.firstHit();
    return !hit || hit.distance >= dist - 0.01 || (hit.object === this.surface && this.holds[this.faceLabels[hit.faceIndex] - 1] === h);
  }
  // 左右滑到盡頭還繼續滑（內角那邊的岩點只有轉過去才看得到）：多出來的滑動直接當兩指調角度（angle），反方向滑先把角度轉回正面再走。
  // dx>0 是畫面往右＝鏡頭往左。turned：哪一端轉出來的（-1 左、1 右）。回傳這一格是不是拿去調角度了
  endTurn(dx) {
    const wc = this.wc; if (!wc || !wc.table || Math.abs(dx) < 1e-6) return false;
    if (!wc.yaw) this.turned = 0;
    const [lo, hi] = wc.sRange(), at = wc.s <= lo + 1e-3 ? -1 : wc.s >= hi - 1e-3 ? 1 : 0;
    const outward = (e) => (e < 0) === (dx > 0);
    if (this.turned && !outward(this.turned) && Math.sign(wc.yaw) === this.turned) {   // 往回滑：先轉回正面
      const yaw = wc.yaw; this.angle(dx);
      if (Math.sign(wc.yaw) !== Math.sign(yaw)) { wc.yaw = 0; wc.clamp(); this.turned = 0; }
      return true;
    }
    if (!at || !outward(at) || Math.abs(wc.yaw) >= YAW_MAX - 1e-6) return false;
    this.turned = at; this.angle(dx);
    return true;
  }
  // 調角度（沿牆鏡頭）：兩指同向左右移 dx 像素，鏡頭繞看的那一點左右轉，半個畫面寬＝30°，最多 ±30°（WalkCam.orbit）。放手後保留，之後左右滑都帶著這個角度（回程角度加在上面）；換牆、重新進來歸零
  angle(dx) {
    const wc = this.wc, st = this.stage; if (!wc || !st) return;
    wc.yaw = MathUtils.clamp(wc.yaw - dx / (st.clientWidth / 2) * YAW_MAX, -YAW_MAX, YAW_MAX); wc.clamp();
  }
  // 回程角度（WalkCam.auto）：正常角度一路滑過去被別的量體擋住、看不到的岩點，回程換個角度看得到。沿牆每 10 公分在 ±30°（每 10° 一個）裡挑，
  // 看得到最多那些岩點的角度，相鄰位置的角度差也算代價（每差 10° 少算一顆），整條一起挑（動態規劃），再平滑 30 公分、夾住沿牆變化的上限：回程一路平順地轉
  planAngles() {
    const wc = this.wc, p = wc.p, d = wc.d, cam = this.camera, keep = [cam.position.clone(), cam.quaternion.clone(), cam.near, cam.far];
    const hw = Math.atan(wc.tan * wc.W / wc.H) * 0.95, rc = this.raycaster, dv = new Vector3(), nm = new Vector3(), M = this.surface.matrixWorld;
    const H = this.holdPos.map(P => [P.dot(p.right), P.dot(p.f), P.dot(p.up)]);
    const sees = (c, look, i) => {
      const ux = look[0] - c[0], uy = look[1] - c[1], l = Math.hypot(ux, uy), x = H[i][0] - c[0], y = H[i][1] - c[1], fw = (x * ux + y * uy) / l;
      if (fw < 0.1 || Math.abs(Math.atan2((-x * uy + y * ux) / l, fw)) > hw) return false;
      const A = wc.world(c, H[i][2]), L = dv.subVectors(this.holdPos[i], A).length(); rc.set(A, dv.multiplyScalar(1 / L)); rc.far = L + 0.1;
      const h = rc.intersectObject(this.surface, false)[0]; rc.far = Infinity;
      return !h || (h.distance > L - 0.08 && nm.copy(h.face.normal).transformDirection(M).dot(dv) < 0);
    };
    const [lo, hi] = wc.sRange(), at = []; for (let s = lo; s <= hi + 1e-6; s += 0.1) at.push({ s, q: wc.pose(s, d) });
    const seen = new Uint8Array(H.length); for (const { q } of at) for (let i = 0; i < H.length; i++) if (!seen[i] && sees(q.cam, q.look, i)) seen[i] = 1;
    const U = H.map((_, i) => i).filter(i => !seen[i]), Y = [-3, -2, -1, 0, 1, 2, 3].map(k => k * YAW_MAX / 3);
    const score = at.map(({ q }) => Y.map(y => { const c = wc.orbit(q.cam, q.look, d, y); return y ? U.filter(i => sees(c, q.look, i)).length : 0; }));
    let cost = Y.map((_, a) => -score[0][a]); const from = [];
    for (let k = 1; k < at.length; k++) { const back = [], next = Y.map((_, a) => { let b = 0, m = Infinity; Y.forEach((_, c) => { const v = cost[c] + Math.abs(a - c); if (v < m) { m = v; b = c; } }); back.push(b); return m - score[k][a]; }); from.push(back); cost = next; }
    const pick = new Array(at.length); pick[at.length - 1] = cost.indexOf(Math.min(...cost)); for (let k = at.length - 1; k > 0; k--) pick[k - 1] = from[k - 1][pick[k]];
    const n = p.n, raw = new Float32Array(n), r = 0.3 / WALK_STEP, auto = new Float32Array(n);
    for (let i = 0; i < n; i++) { const k = Math.max(0, Math.min(at.length - 1, Math.round((i * WALK_STEP - lo) / 0.1))); raw[i] = Y[pick[k]]; }
    for (let i = 0; i < n; i++) { let a = 0, w = 0; for (let j = Math.max(0, Math.floor(i - 3 * r)); j <= Math.min(n - 1, Math.ceil(i + 3 * r)); j++) { const g = Math.exp(-((j - i) ** 2) / (2 * r * r)); a += raw[j] * g; w += g; } auto[i] = a / w; }
    const m = YAW_RATE / d * WALK_STEP;   // 沿牆變化的上限（WalkCam.yawAt）：往前、往後各夾一次
    for (let i = 1; i < n; i++) auto[i] = Math.max(auto[i - 1] - m, Math.min(auto[i - 1] + m, auto[i]));
    for (let i = n - 2; i >= 0; i--) auto[i] = Math.max(auto[i + 1] - m, Math.min(auto[i + 1] + m, auto[i]));
    wc.auto = U.length ? auto : null; wc.sr = wc.vr = null;
    cam.position.copy(keep[0]); cam.quaternion.copy(keep[1]); cam.near = keep[2]; cam.far = keep[3]; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    this.angleInfo = { hidden: U.length, back: U.filter(i => at.some(({ q }, k) => sees(wc.orbit(q.cam, q.look, d, Y[pick[k]]), q.look, i))).length };
  }
  // 偷看（沒有沿牆鏡頭的舊資料包）：兩指扭轉、滑鼠拖曳繞畫面對到的那一點轉，離軌道上的位置左右最多 PEEK_YAW、上下 PEEK_PITCH，放手由 settle 彈回（鏡頭保持水平不歪頭）
  turn(dx, dy = 0) {
    const st = this.stage; if (!st || !this.view) return;
    const W = st.clientWidth, H = st.clientHeight, cam = this.camera;
    this.applyView(); cam.updateMatrixWorld(true);
    if (!this.orbitTarget) {
      const hit = this.hitAt(W / 2, H / 2, W, H);
      this.orbitTarget = hit ? hit.point.clone() : this.center.clone();
    }
    const pivot = this.orbitTarget, k = Math.PI / Math.max(240, H), base = this.railPose || this.homePose;
    const flat = (v) => v.clone().sub(this.up.clone().multiplyScalar(v.dot(this.up))).normalize();
    const pitch = (v) => Math.asin(MathUtils.clamp(v.dot(this.up), -1, 1));
    const fwd0 = pivot.clone().sub(base.position).normalize(), flat0 = flat(fwd0), po0 = pitch(fwd0);
    const angles = (pos) => { const fwd = pivot.clone().sub(pos).normalize(); return [flat(fwd).angleTo(flat0), Math.abs(pitch(fwd) - po0)]; };
    let offset = cam.position.clone().sub(pivot);
    if (Math.abs(dx) > 1e-5) {
      const qYaw = new Quaternion().setFromAxisAngle(this.up, -dx * k);
      const cand = offset.clone().applyQuaternion(qYaw).add(pivot);
      const [az] = angles(cand), [az0] = angles(cam.position);
      if (az <= PEEK_YAW || az < az0) offset.applyQuaternion(qYaw);
    }
    if (Math.abs(dy) > 1e-5) {
      const right = this.up.clone().cross(offset).normalize();
      if (right.lengthSq() > 0.5) {
        const qPitch = new Quaternion().setFromAxisAngle(right, dy * k);
        const cand = offset.clone().applyQuaternion(qPitch).add(pivot);
        const fwd = pivot.clone().sub(cand).normalize();
        const [, po] = angles(cand), [, pp0] = angles(cam.position);
        if (Math.abs(fwd.dot(this.up)) < 0.94 && (po <= PEEK_PITCH || po < pp0)) offset.applyQuaternion(qPitch);
      }
    }
    cam.position.copy(pivot).add(offset);
    cam.up.copy(this.up);
    cam.lookAt(pivot);
    cam.updateMatrixWorld(true);
    this.tilted = true; this.invalidate();
  }
  // 偷看放手：250 ms 彈回軌道上的位置，每一格呼叫 step（重投外框）
  settle(step) {
    this.over = 0; this.offVec = null;   // 橡皮筋拉過頭的量跟著鏡頭一起彈回軌道上
    const base = this.railPose || this.homePose, cam = this.camera, p0 = cam.position.clone(), q0 = cam.quaternion.clone();
    if (p0.distanceTo(base.position) < 1e-5 && q0.angleTo(base.quaternion) < 1e-5) return Promise.resolve();
    return new Promise((done) => {
      const t0 = performance.now(), tick = (now) => {
        const k = Math.min(1, (now - t0) / 250), e = 1 - (1 - k) ** 3;
        cam.position.lerpVectors(p0, base.position, e); cam.quaternion.slerpQuaternions(q0, base.quaternion, e); cam.updateMatrixWorld(true);
        this.invalidate(); step?.();
        if (k < 1) requestAnimationFrame(tick); else done();
      };
      requestAnimationFrame(tick);
    });
  }
}

export function hull(pts) {
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo.at(-2), lo.at(-1), p) <= 0) lo.pop(); lo.push(p); }
  for (const p of pts.toReversed()) { while (up.length >= 2 && cross(up.at(-2), up.at(-1), p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
// 凸包頂點太多時，拿掉造成面積損失最小的點
export function simplify(poly, max) {
  const p = poly.slice();
  const loss = (i) => { const a = p[(i - 1 + p.length) % p.length], b = p[i], c = p[(i + 1) % p.length]; return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])); };
  while (p.length > max) { let at = 0, min = Infinity; for (let i = 0; i < p.length; i++) { const l = loss(i); if (l < min) { min = l; at = i; } } p.splice(at, 1); }
  return p;
}
export function inside(x, y, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
