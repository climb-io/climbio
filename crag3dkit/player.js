// 紅點貓的 3D 岩場：一個岩場一個高斯潑濺模型（Climbio v2 的 surface: model 畫面，.spz），分成幾區（岩壁），路線是疊在模型上的 3D 折線。
// 手機只播放，不算：各區的鏡頭（各區快照的 props.model.camera）、路線被岩壁擋住的表（圖層的 props.sight）都在作者端算好。
// - 進場：先鋪那一區的快照（手機的比例），小卡直接放大到最後的畫面，路線和編號牌馬上淡入（畫在快照上面另一層）；鏡頭站在拍快照的位置、視角一樣，模型畫好後快照淡出換成 3D 看不出差別。
// - 沿著岩壁：整段岩壁是一條連續的軌道，左右拖岩壁跟著手指走，放開後照手指的速度往前滑、越來越慢，停在哪裡就是哪裡（像在岩場裡走，不拉回某一區）。放大時只在這一區裡順勢滑。
//   區只是位置的名稱（上方顯示最近那面岩壁）和鏡頭沿途的定點；路線照看得到畫，不分區。放大時只在這一區裡左右移，推過邊緣就先縮回整區再滑到那一區。電腦的換區鈕、方向鍵滑到那一區的整區畫面，遠的久一點。
// - 在區裡：上下拖往上下看、兩指捏合往手指的地方縮放、兩指扭轉換角度、點兩下放大到點的地方（再點兩下回整區）；電腦右鍵拖曳轉角度、滾輪往游標的地方縮放、雙擊同點兩下。相機只停在人站得到的地方（正面左右各 60°、上下有限、離岩壁 1.5–18 m）。
// - 擋住：每個路線點、每個方向查表（離被擋住的地方多遠），看的人比那裡遠就不畫那一段；露出不到三成的整條不畫、不標編號。
// - 路線跟紅點貓的 2D Topo 一樣（TopoKit 的顏色、2.8 px 粗、選到 4 px）、編號牌是看板（號碼＋難度），放在路線起點的正下方（號碼是路線顏色的小圓、難度是圓下面的半透明小白籤；不擋岩壁，圓心對齊起點，起點太近的只畫號碼），都畫在模型上面；號碼只有一排、位置固定（放大縮小不變），起點太近的只畫號碼。
// English: Redpoint 3D crag: Gaussian-splat crag model, snapshot poster cross-fades to live 3D, continuous slide between areas, precomputed occlusion table.
import { Scene, PerspectiveCamera, WebGLRenderer, Vector3, MathUtils, SRGBColorSpace, ShaderMaterial, BufferGeometry, Float32BufferAttribute, Mesh, DataTexture, LinearFilter, DoubleSide, SparkRenderer, SplatMesh, GLTFLoader, MeshBasicMaterial } from './vendor/three-splat.js';
import { injectStyle } from './style.js';
import { pickGrade, pickName } from './text.js';
import { readSight, routeVisibility } from './sight.js';

const SKY = ['#dfe6ec', '#dfe6ec', '#dfe6ec'], TAP_PX = 24, FILL = 3, TURN = Math.PI / 3, TILT_UP = 0.55, TILT_DOWN = 0.45, NEAR = 1.5, ZOOM_OUT = 1.15, LIFT = 4, DASH = 0.25, HIDDEN = 0.45;
const DIM_MS = 120, LINE_W = 2.8, LINE_W_ON = 4, POSTER_MS = 450, FADE_MS = 320, MIN_SEEN = 0.3, CALM_FRAMES = 3, SETTLE_MAX_MS = 5000;   // 潑濺排好＝Spark 沒在排、也不用重排，連續 CALM_FRAMES 格（每台手機排序速度不同，不能用固定時間猜）；SETTLE_MAX_MS 只是防卡住的上限
// 鏡頭的動作：進場拉開；放開後順勢滑（越來越慢、最快每秒幾公尺），停在哪裡就是哪裡；路線照看得到畫（不分區）；電腦的左右鈕、方向鍵往前往後走 WALK_M 公尺；點兩下放大到 1/ZOOM_IN 倍
const INTRO_HOLD_MS = 500, INTRO_FLY_MS = 2000, FRAME_ASPECT = 0.75, ZOOMED = 0.95, PUSH_PX = 48, GLIDE_MS = 420, MAX_SPEED = 6, WALK_M = 5, FAR_K = 1.6, CROWD_PX = 18, GO_MS = 700, GO_MS_PER_M = 80, GO_MAX_MS = 1800, ZOOM_MS = 500, ZOOM_IN = 0.4, DOUBLE_MS = 320;
const easeInOut = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** 鏡頭 { position, target } → 繞 target 的姿勢 { target, az, pol, dist } */
const poseOf = (c) => {
  const target = new Vector3(...c.target), off = new Vector3(...c.position).sub(target), dist = off.length();
  return { target, az: Math.atan2(off.x, off.z), pol: Math.acos(MathUtils.clamp(off.y / dist, -1, 1)), dist };
};
const mix = (a, b, t) => ({ target: a.target.clone().lerp(b.target, t), az: a.az + wrap(b.az - a.az) * t, pol: a.pol + (b.pol - a.pol) * t, dist: a.dist * (b.dist / a.dist) ** t });

/**
 * host 裡畫岩場。url：.spz 網址；marks：模型上路線的 LineString 標註（props.sight 是遮擋表）；sight：規格（圖層的 props.sight）；nodes：路線節點；
 * areas：[{ id, name, camera, aspect, routes: Set(路線 id) }]（照岩壁順序）；start：打開第幾區；poster：那一區快照的網址（模型畫好前先鋪著，填滿畫面，跟 3D 進場的第一個畫面一樣）；
 * url、background：網址，或還在讀的 Promise；
 * intro：第一次進這個岩場：{ camera, aspect }，全區快照（岩場封面）拍的鏡頭；卡片放大成那張全區快照（poster），模型好了在同一個位置換成 3D，停一下再飛進 start 那一區；
 * sky：背景漸層；onPick(id | null)；onArea(第幾區)。快照鋪好就回傳 { highlight(id), go(第幾區), route(路線 id：走過去再 onPick), area()（目前第幾區）, posterRect(), destroy() }，模型在背景載入。
 */
export async function mountCrag3d(host, { url, mime, background, marks, sight, nodes, areas, start = 0, intro = null, poster, sky = SKY, onPick = () => {}, onArea = () => {} }) {
  host.classList.add('c3d');
  injectStyle(host);
  host.replaceChildren();
  const renderer = new WebGLRenderer({ antialias: false, alpha: true });
  host.style.background = `linear-gradient(${sky[0]}, ${sky[1]} 60%, ${sky[2] ?? sky[1]})`;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  Object.assign(renderer.domElement.style, { position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none', cursor: 'grab' });
  host.append(renderer.domElement);
  const shot = Object.assign(new Image(), { src: poster, alt: '' });
  Object.assign(shot.style, { position: 'absolute', objectFit: 'fill', pointerEvents: 'none', transition: `opacity ${POSTER_MS}ms ease` });
  const veil = Object.assign(new Image(), { src: poster, alt: '' });
  Object.assign(veil.style, { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(28px)', transform: 'scale(1.12)', pointerEvents: 'none', transition: `opacity ${POSTER_MS}ms ease` });
  host.append(veil, shot);
  // 路線、編號牌畫在另一層，疊在快照上面：鏡頭跟快照一樣，所以一進來就畫，不用等模型載好（模型畫在快照下面那層）
  const overlay = new WebGLRenderer({ antialias: false, alpha: true });
  overlay.setPixelRatio(renderer.getPixelRatio());
  overlay.outputColorSpace = SRGBColorSpace;
  Object.assign(overlay.domElement.style, { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', opacity: '0', transition: `opacity ${POSTER_MS}ms ease` });   // 路線只畫在 3D 上：快照上不畫，模型畫好、快照淡掉後才淡入
  host.append(overlay.domElement);
  const lines = new Scene();
  await shot.decode().catch(() => {});

  const scene = new Scene();
  // 不用 LoD（分層細節）：模型是整包載入的，不是 LoD 格式；Android 的點數預算是 100 萬，超過就走 LoD，鏡頭一動整個畫不出來
  const spark = new SparkRenderer({ renderer, enableLod: false });
  scene.add(spark);
  let splat = null, backdrop = null, dead = false;   // splat：主模型（潑濺或網格）；backdrop：網格模型的潑濺背景

  // ── 路線 ──
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const routes = await Promise.all(marks.filter((m) => m.geometry?.type === 'LineString' && m.node && m.geometry.coordinates.length >= 2).map(async (m) => {
    const n = byId.get(m.node), pts = m.geometry.coordinates.map((p) => new Vector3(...p));
    return { id: m.node, label: m.props?.label != null ? String(m.props.label) : undefined, kind: n?.props?.style === 'sport' ? 'sport' : 'other',
      grade: pickGrade(n?.props?.grade), name: pickName(n?.name, 'zh-Hant'), stroke: m.props?.style?.stroke, pts, coords: m.geometry.coordinates,
      table: sight && m.props?.sight ? await readSight(m.props.sight) : null, vis: new Uint8Array(pts.length).fill(1), fade: 0 };
  }));
  const camAt = [0, 0, 0];
  // 每個點看不看得到：在相機前面，而且查表沒有比相機更近的岩壁擋住（純函式在 sight.js）；回傳看得到的比例
  const see = (r) => {
    camAt[0] = cam.position.x; camAt[1] = cam.position.y; camAt[2] = cam.position.z;
    return routeVisibility({ table: r.table, spec: sight, pts: r.coords, from: camAt, fill: FILL, out: r.vis }).seen;
  };
  // ── 相機：整段岩壁是一條軌道（u：0 是第一區、1 是第二區…，中間連續），姿勢＝軌道上那一點的鏡頭加上看的人自己的偏移（轉角度、上下看、遠近）。
  //    鏡頭就站在快照拍的位置，畫面跟快照寬高不同時只改視角，所以快照跟 3D 的畫面一模一樣：進場時快照填滿畫面（看不到快照的邊），再拉開到整區放得進畫面
  const cam = new PerspectiveCamera(50, 1, 0.05, 2000);
  let W = 1, H = 1;
  const base = areas.map((a) => ({ ...a, pose: poseOf(a.camera), half: Math.tan(MathUtils.degToRad(a.camera.fov ?? 50) / 2), aspect: a.aspect ?? 0.75 }));
  const off = { az: 0, pol: 0, zoom: 1, lift: 0 };
  let u = start, vel = 0, anim = null;   // vel：放開後順勢滑（區／秒）；anim：換區、點兩下的鏡頭動畫
  const last = base.length - 1, at = (x) => base[MathUtils.clamp(Math.round(x), 0, last)];
  const areaPose = (x) => {
    const i = MathUtils.clamp(Math.floor(x), 0, last), j = Math.min(i + 1, last);
    return mix(base[i].pose, base[j].pose, x - i);
  };
  const seg = (x) => {   // 軌道上這一段（兩區之間）有幾公尺
    if (!last) return 1;
    const i = MathUtils.clamp(Math.floor(x), 0, last - 1);
    return Math.max(1, base[i].pose.target.distanceTo(base[i + 1].pose.target));
  };
  const along = (a, b) => {   // 軌道上兩點之間有幾公尺
    let m = 0;
    for (let x = Math.min(a, b), end = Math.max(a, b); x < end - 1e-6;) { const nx = Math.min(end, Math.floor(x) + 1); m += (nx - x) * seg(x); x = nx; }
    return m;
  };
  const halfTan = (x) => {   // 垂直半視角的 tan：快照的左右剛好放進畫面；畫面比 3:4 寬時上下至少留到 3:4 的範圍（電腦）
    const b = at(x), h0 = b.half * b.aspect;
    return Math.max(h0 / (W / H), h0 / FRAME_ASPECT);
  };
  const current = () => {
    const p = areaPose(u);
    return { target: p.target.clone().add(new Vector3(0, off.lift, 0)), az: p.az + off.az, pol: p.pol + off.pol, dist: p.dist * off.zoom };
  };
  const place = (p, ht = halfTan(u)) => {
    cam.fov = MathUtils.radToDeg(2 * Math.atan(ht));
    cam.updateProjectionMatrix();
    cam.position.set(Math.sin(p.pol) * Math.sin(p.az), Math.cos(p.pol), Math.sin(p.pol) * Math.cos(p.az)).multiplyScalar(p.dist).add(p.target);
    cam.lookAt(p.target);
    cam.updateMatrixWorld();
  };
  const clampOff = () => {
    u = MathUtils.clamp(u, 0, last);
    const d = areaPose(u).dist, room = Math.max(0, 1 - off.zoom) * d * halfTan(u);   // 放大後上下可以移到整區畫面的上下緣
    off.az = MathUtils.clamp(off.az, -TURN, TURN);
    off.pol = MathUtils.clamp(off.pol, -TILT_UP, TILT_DOWN);
    off.zoom = MathUtils.clamp(off.zoom, NEAR / d, ZOOM_OUT);   // 最多退後一點點：再退就看到模型的邊緣、背景，像在看模型不像站在岩場
    off.lift = MathUtils.clamp(off.lift, -room - LIFT / 2, room + LIFT);
  };
  // ── 線與牌子：場景裡的物件，畫在模型上面（潑濺不寫深度，被擋住的地方查表後不畫） ──
  const css = getComputedStyle(host), color = (v) => css.getPropertyValue(v).trim();
  const palette = { sport: [color('--c3d-sport'), color('--c3d-sport-on')], other: [color('--c3d-other'), color('--c3d-other-on')] };
  const swatch = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const rgb = (c) => { swatch.clearRect(0, 0, 1, 1); swatch.fillStyle = c; swatch.fillRect(0, 0, 1, 1); return [...swatch.getImageData(0, 0, 1, 1).data].slice(0, 3).map((v) => v / 255); };
  // 線：一條連續的帶子（每個點兩側各一個頂點，轉角用兩段方向的平均接起來，不會一段一段），螢幕上固定粗細，跟 TopoKit 的 2D 線一樣粗（2.8 px，選到 4 px）
  const lineMat = (c) => new ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, side: DoubleSide,   // 帶子的三角形朝哪邊看線的走向，兩面都畫
    uniforms: { res: { value: [1, 1] }, width: { value: LW }, color: { value: c }, opacity: { value: 0 } },
    vertexShader: `uniform vec2 res; uniform float width; attribute vec3 prev; attribute vec3 next; attribute float side; attribute float seen; attribute float along; varying float vSeen; varying float vAlong;
      vec2 scr(vec4 c) { return c.xy / c.w * res * 0.5; }
      void main() {
        vSeen = seen; vAlong = along;
        mat4 m = projectionMatrix * modelViewMatrix;
        vec4 a = m * vec4(position, 1.0), p = m * vec4(prev, 1.0), n = m * vec4(next, 1.0);
        if (a.w <= 0.01 || p.w <= 0.01 || n.w <= 0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        vec2 s = scr(a), d1 = s - scr(p), d2 = scr(n) - s;
        d1 = length(d1) > 1e-4 ? normalize(d1) : normalize(d2 + vec2(1e-6)); d2 = length(d2) > 1e-4 ? normalize(d2) : d1;
        vec2 t = normalize(d1 + d2 + vec2(1e-6)), nrm = vec2(-t.y, t.x);
        float k = 1.0 / max(dot(nrm, vec2(-d1.y, d1.x)), 0.5);   // 轉角處加寬，粗細看起來一樣
        gl_Position = vec4((s + nrm * side * width * 0.5 * k) / (res * 0.5) * a.w, a.z, a.w);
      }`,
    // 被擋住的一段（seen 0 的點兩旁，例：內角的線斜著看被旁邊的岩塊擋住）畫成淡色虛線（每 DASH 公尺一段），線不會斷、看得出在岩塊後面
    fragmentShader: `uniform vec3 color; uniform float opacity; varying float vSeen; varying float vAlong;
      void main() {
        if (vSeen > 0.5) { gl_FragColor = vec4(color, opacity); return; }
        if (fract(vAlong / ${DASH.toFixed(3)}) > 0.5) discard;
        gl_FragColor = vec4(color, opacity * ${HIDDEN.toFixed(2)});
      }`,
  });
  const lineGeometry = (pts, own) => {   // own[i]：第 i 段（i → i+1）由這條畫；共用段只有選到時才畫
    const pos = [], prev = [], next = [], side = [], along = [], idx = [];
    let len = 0;
    pts.forEach((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      if (i) len += p.distanceTo(pts[i - 1]);
      for (const sd of [-1, 1]) { pos.push(p.x, p.y, p.z); prev.push(a.x, a.y, a.z); next.push(b.x, b.y, b.z); side.push(sd); along.push(len); }
      if (i) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i, 2 * i - 1, 2 * i + 1);
    });
    const g = new BufferGeometry();
    for (const [k, v, n] of [['position', pos, 3], ['prev', prev, 3], ['next', next, 3], ['side', side, 1], ['along', along, 1]]) g.setAttribute(k, new Float32BufferAttribute(v, n));
    g.setAttribute('seen', new Float32BufferAttribute(new Float32Array(side.length).fill(1), 1));
    g.userData = { all: idx, own: idx.filter((_, k) => own[Math.floor(k / 6)]) };
    g.setIndex(g.userData.own);
    return g;
  };
  // 橫的大螢幕（電腦、iMac）牌子和線依畫面高度放大（最多 1.9 倍），直放的手機、小視窗維持原尺寸：牌子是螢幕上固定像素大小，大螢幕上看起來太小
  const UI = host.clientWidth > host.clientHeight ? Math.min(1.9, Math.max(1, host.clientHeight / 640)) : 1, LW = LINE_W * (1 + (UI - 1) * 0.5), LW_ON = LINE_W_ON * (1 + (UI - 1) * 0.5);
  const FONT = 'system-ui, -apple-system, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif', SS = 2;
  // 編號牌：號碼是路線顏色的實心小圓（白字），難度是圓下面的小白籤（白色半透明圓角底、路線顏色斜體字；縮短：5.9 → .9、5.11a → 11a）
  const pillTexture = (label, grade, c) => {
    const cv = document.createElement('canvas'), x = cv.getContext('2d', { willReadFrequently: true }), d = 19 * UI, gh = grade ? 14 * UI : 0, h = d + (grade ? 2 * UI : 0) + gh;
    const gf = `italic 700 ${10 * UI}px ${FONT}`;
    x.font = gf;
    const gw = grade ? x.measureText(grade).width + 8 * UI : 0, w = Math.ceil(Math.max(d + 1, gw)), hh = Math.ceil(h);
    cv.width = w * SS; cv.height = hh * SS;
    x.scale(SS, SS);
    x.fillStyle = c; x.beginPath(); x.arc(w / 2, d / 2, d / 2 - 0.5 * UI, 0, 2 * Math.PI); x.fill();
    x.textAlign = 'center'; x.textBaseline = 'middle';
    if (label) { x.fillStyle = '#fff'; x.font = `700 ${(String(label).length > 2 ? 9.5 : 11) * UI}px ${FONT}`; x.fillText(label, w / 2, d / 2 + 0.5 * UI); }
    if (grade) {
      const y = d + 2 * UI;
      x.fillStyle = 'rgba(255,255,255,0.75)'; x.beginPath(); x.roundRect((w - gw) / 2, y, gw, gh - UI, (gh - UI) / 2); x.fill();
      x.fillStyle = c; x.font = gf; x.fillText(grade, w / 2, y + (gh - UI) / 2 + 0.5 * UI);
    }
    const tex = new DataTexture(new Uint8Array(x.getImageData(0, 0, cv.width, cv.height).data), cv.width, cv.height);
    tex.flipY = true; tex.minFilter = tex.magFilter = LinearFilter; tex.needsUpdate = true;
    return { tex, w, h: hh };
  };
  const labelMat = (tex, w, h) => new ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false,
    uniforms: { res: { value: [1, 1] }, anchor: { value: new Vector3() }, size: { value: [w, h] }, shift: { value: [0, 0] }, map: { value: tex }, opacity: { value: 0 } },
    vertexShader: `uniform vec2 res; attribute vec2 corner; uniform vec3 anchor; uniform vec2 size; uniform vec2 shift; varying vec2 vUv;
      void main() {
        vec4 v = modelViewMatrix * vec4(anchor, 1.0);
        vec4 c = projectionMatrix * v;
        if (c.w <= 0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        c.xy += (corner * size + 2.0 * shift) / res * c.w;   // shift：往下排的像素（起點下方、同一疊的第幾個）
        vUv = corner * 0.5 + 0.5;
        gl_Position = c;
      }`,
    fragmentShader: 'uniform sampler2D map; uniform float opacity; varying vec2 vUv; void main() { vec4 t = texture2D(map, vUv); gl_FragColor = vec4(t.rgb, t.a * opacity); }',
  });
  const quad = new BufferGeometry();
  quad.setAttribute('corner', new Float32BufferAttribute([-1, -1, 1, -1, -1, 1, 1, 1], 2));
  quad.setAttribute('position', new Float32BufferAttribute(new Array(12).fill(0), 3));
  quad.setIndex([0, 1, 2, 2, 1, 3]);
  const board = (mat, order) => { const m = new Mesh(quad, mat); m.frustumCulled = false; m.renderOrder = order; lines.add(m); return m; };

  // 分叉、合併：共用的一段在每條路線裡座標相同（公開格式的規則），兩端相同的線段只畫一次，歸編號在前的那條
  const order = [...routes].sort((a, b) => Number(a.label) - Number(b.label) || a.id.localeCompare(b.id));
  const segKey = (a, b) => [a, b].map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`).sort().join('|');
  const drawn = new Set();
  for (const r of order) r.own = r.pts.slice(1).map((p, i) => { const k = segKey(r.pts[i], p), mine = !drawn.has(k); drawn.add(k); return mine; });
  // 難度縮短（YDS 去掉開頭的「5」：5.9 → .9、5.11a → 11a、5.10a/b → 10a/b），其他難度系統照原樣
  const shortGrade = (g) => (g ? String(g).replace(/^5\.(?=\d{2})/, '').replace(/^5(?=\.[\d?])/, '') : g);
  // 號碼放在路線最下面、起點的正下方（跟 2D Topo、一般路線書一樣，不擋岩壁），圓心對齊起點的垂直線、圓的上緣接著起點；起點共用（分岔）的放在自己岔出去的第一點上。
  // 只有一排、位置固定（放大縮小不變）：起點跟別條太近、難度籤會疊到的只畫號碼、不寫難度，不用排第二排
  // 太近才省難度：照那一區的整區畫面（手機直式、參考高度 REF_H 像素）換算，兩條起點的難度籤在畫面上真的會疊到才只畫號碼；只算一次，放大縮小不變
  const REF_H = 800, gradeW = (g) => { if (!g) return 0; const x = document.createElement('canvas').getContext('2d'); x.font = `italic 700 10px ${FONT}`; return x.measureText(g).width + 8; };
  for (const r of order) { const first = r.own.findIndex(Boolean); r.at = first > 0 ? first : 0; r.gw = gradeW(shortGrade(r.grade)); }
  const pxPerM = (r) => { const b = base.find((a) => a.routes.has(r.id)) ?? base[0]; return REF_H / (2 * b.pose.dist * b.half); };
  for (const r of order) {
    const p = r.pts[r.at], k = pxPerM(r);
    r.tight = order.some((q) => q !== r && Math.abs(p.y - q.pts[q.at].y) < 1.5 && Math.hypot(p.x - q.pts[q.at].x, p.z - q.pts[q.at].z) * k < (r.gw + q.gw) / 2 + 2);
  }
  const hex = (r, on) => r.stroke ?? palette[r.kind][on ? 1 : 0];
  for (const r of routes) {
    r.lineMat = lineMat(rgb(hex(r, false)));
    r.line3d = new Mesh(lineGeometry(r.pts, r.own), r.lineMat);
    r.line3d.frustumCulled = false; r.line3d.renderOrder = 2;
    lines.add(r.line3d);
    if (r.label != null || r.grade) {
      const g = r.tight ? '' : shortGrade(r.grade), t = pillTexture(r.label, g, hex(r, false)), tOn = pillTexture(r.label, g, hex(r, true));
      r.pill = { off: labelMat(t.tex, t.w, t.h), on: labelMat(tOn.tex, tOn.w, tOn.h), w: t.w, h: t.h };
      for (const m of [r.pill.off, r.pill.on]) { m.uniforms.anchor.value.copy(r.pts[r.at]); m.uniforms.shift.value = [0, -(t.h / 2 - UI)]; }   // 圓的上緣接著路線起點
      r.label3d = board(r.pill.off, 3);
    }
  }
  let highlight;

  const style = () => {
    for (const r of routes) {
      const on = r.id === highlight;
      r.lineMat.uniforms.color.value = rgb(hex(r, on));
      r.lineMat.uniforms.width.value = on ? LW_ON : LW;
      const g = r.line3d.geometry; g.setIndex(on ? g.userData.all : g.userData.own);   // 選到的路線連同共用段整條亮，畫在別條上面
      r.line3d.renderOrder = on ? 2.5 : 2;
      if (r.label3d) r.label3d.material = on ? r.pill.on : r.pill.off;
    }
  };

  // ── 每一格：動畫（進場拉開、換區、點兩下、順勢滑）、哪些路線要畫、查表切掉被擋住的段 ──
  // 第一次進來的全區畫面：站在拍全區快照的地方，快照填滿畫面（畫面比快照寬就上下裁、比較窄就左右裁）；fly.k 0→1 從這裡飛進 start 那一區
  let fly = intro ? { k: 0, t0: 0, pose: poseOf(intro.camera), half: Math.tan(MathUtils.degToRad(intro.camera.fov ?? 50) / 2), aspect: intro.aspect } : null;
  const flyTan = () => Math.min(fly.half, fly.half * fly.aspect / (W / H));
  let onDrawn = null;   // 模型畫出來時叫一次（快照淡出、路線才出來）
  // 停下來後潑濺還在背景排序：一直畫到 Spark 排好（沒在排、不用重排）才停
  let queued = false, lastTime = performance.now(), area = Math.round(u), lastU = u, speed = 0, settling = false, settleSince = 0, calm = 0;
  const kick = () => { settling = true; settleSince = performance.now(); calm = 0; if (!queued) { queued = true; requestAnimationFrame(frame); } };
  const glb = /gltf/.test(mime ?? '') || /\.glb$/i.test(url), needSort = !glb || !!background;   // 只有網格、沒有潑濺背景：不用排
  const one = new Uint8Array(4);
  const painted = () => {   // 畫面中間 9 個點大多讀得到模型（不透明）：排好不等於畫出來，手機上第一格要傳到 GPU 才畫得出來，快照不能先淡掉（淡掉就是一片空白）
    const gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    let n = 0;
    for (const fx of [0.3, 0.5, 0.7]) for (const fy of [0.35, 0.5, 0.65]) { gl.readPixels(Math.round(w * fx), Math.round(h * fy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); if (one[3] > 200) n++; }
    return n >= 5;
  };
  const sorted = () => !needSort || (spark.activeSplats > 0 && !spark.sorting && !spark.sortDirty);   // Spark 排好、畫得出整個模型（載好不等於畫好，手機上要排一會兒）
  function frame(now) {
    queued = false;
    const dt = Math.min(64, now - lastTime); lastTime = now;
    step(now, dt);
    if (fly?.t0) {
      fly.k = Math.min(1, Math.max(0, (now - fly.t0) / INTRO_FLY_MS));
      if (fly.k >= 1) { fly = null; overlay.domElement.style.opacity = '1'; waiting?.(); waiting = null; }
    }
    if (fly) { const k = easeInOut(fly.k); place(mix(fly.pose, current(), k), flyTan() ** (1 - k) * halfTan(u) ** k); } else place(current());
    // 沿著岩壁移動的速度（公尺／秒，平滑過）：還在動就繼續畫（潑濺在背景排序）
    speed += (Math.abs(u - lastU) * seg(u) / Math.max(1, dt) * 1000 - speed) * 0.3; lastU = u;
    const i = Math.round(u);
    if (i !== area) { area = i; if (highlight) { highlight = undefined; style(); onPick(null); } onArea(i); }
    let moving = false;
    // 路線照「看得到」畫，不照屬於哪一區：沒被岩壁擋住（查表露出三成以上）、起點離鏡頭不超過看的距離（一區標準距離，拉遠時跟著變遠）FAR_K 倍（再遠就擠在一起）的都畫，
    // 手機、電腦同一個規則；走到哪裡就看到哪裡的線，不會換一批
    const far = areaPose(u).dist * Math.max(1, off.zoom) * FAR_K;   // 拉遠（電腦版開場、縮小）時看的距離跟著變遠
    const show = new Map();
    for (const r of routes) {
      const seen = see(r), g = r.line3d.geometry.attributes.seen;
      let changed = false;   // 看得到的點沒變就不重傳（每格都傳是白費的 GPU 上傳）
      for (let i = 0; i < r.pts.length; i++) if (g.array[2 * i] !== r.vis[i]) { g.array[2 * i] = g.array[2 * i + 1] = r.vis[i]; changed = true; }
      if (changed) g.needsUpdate = true;
      show.set(r, seen >= MIN_SEEN && cam.position.distanceTo(r.pts[0]) <= far);
    }
    // 擠在一起的不畫：起點在畫面上跟號碼在前（選到的最優先）、已經要畫的那條太近（CROWD_PX 內）就先不畫，走近、間距夠了才出現；
    // 已經藏起來的要拉開到 1.3 倍才再出現，移動時不會一直出現又消失
    const kept = [];
    for (const r of [...order].sort((a, b) => Number(b.id === highlight) - Number(a.id === highlight))) {
      if (!show.get(r)) continue;
      scr.copy(r.pts[r.at]).project(cam);
      const x = (scr.x + 1) / 2 * W, y = (1 - scr.y) / 2 * H, lim = CROWD_PX * UI * (r.crowd ? 1.3 : 1);
      r.crowd = r.id !== highlight && kept.some(([kx, ky]) => Math.abs(kx - x) < lim && Math.abs(ky - y) < 40);
      if (r.crowd) show.set(r, false); else kept.push([x, y]);
    }
    for (const r of routes) {
      const goal = show.get(r) ? 1 : 0;
      r.fade = goal > r.fade ? Math.min(goal, r.fade + dt / FADE_MS) : Math.max(goal, r.fade - dt / FADE_MS);
      if (r.fade !== goal) moving = true;
      const dimGoal = highlight && r.id !== highlight ? 0.6 : 1;   // 選一條時其他路線慢慢變淡（電腦版同時畫很多條，一下子全暗看起來像閃一下）
      r.dim = r.dim == null ? dimGoal : r.dim + (dimGoal - r.dim) * Math.min(1, dt / DIM_MS);
      if (Math.abs(r.dim - dimGoal) < 0.01) r.dim = dimGoal; else moving = true;
      const dim = r.dim;
      r.lineMat.uniforms.opacity.value = r.fade * dim;
      if (r.pill) for (const m of [r.pill.off, r.pill.on]) m.uniforms.opacity.value = r.fade * dim;   // 起點被前面的石頭擋住也照樣標號碼（例：梁大隆 6 號）
    }
    for (const r of routes) for (const m of [r.lineMat, r.pill?.off, r.pill?.on]) if (m) m.uniforms.res.value = [W, H];
    if (splat) renderer.render(scene, cam);
    if (!splat) settling = false;   // 還沒有模型：只有路線層，畫一格就好
    else if (settling || onDrawn) {
      if (!sorted() || (onDrawn && !painted())) calm = 0;
      else if (!calm++ && onDrawn) renderer.getContext().finish();   // 第一次排好、也讀得到模型：等 GPU 把這一格真的畫完（Android 上模型資料傳到 GPU、畫第一格要很久，主程式卡著時 CSS 的淡出淡入照跑，模型還沒出來路線就先出來）
      if (onDrawn && calm >= CALM_FRAMES) { onDrawn(); onDrawn = null; }   // 模型排好、畫出來了：快照才淡掉、路線才出來
      if (calm >= CALM_FRAMES || now - settleSince > SETTLE_MAX_MS) settling = false;
    }
    overlay.render(lines, cam);
    if (moving || anim || vel || fly || onDrawn || settling || speed > 0.05) { queued = true; requestAnimationFrame(frame); }   // 潑濺在背景排序：停下來後畫到穩定為止
  }
  const scr = new Vector3();
  const step = (now, dt) => {
    if (anim) {   // 換區、點兩下：慢慢起步、慢慢停，不衝過頭
      const t = Math.min(1, (now - anim.t0) / anim.ms), p = (anim.ease ?? easeInOut)(t), { from: a, to: b } = anim;
      u = MathUtils.lerp(a.u, b.u, p);
      for (const k of ['az', 'pol', 'lift']) off[k] = MathUtils.lerp(a[k], b[k], p);
      off.zoom = a.zoom * (b.zoom / a.zoom) ** p;
      if (t >= 1) { const then = anim.then; anim = null; then?.(); }
    } else if (vel) {   // 放開後順勢滑，越來越慢，停在哪裡就是哪裡（不拉回某一區）
      u += vel * dt / 1000;
      vel *= Math.exp(-dt / GLIDE_MS);
      const [lo, hi] = range();
      if (u <= lo || u >= hi || Math.abs(vel) * seg(u) < 0.05) vel = 0;
      clampOff();
    }
  };
  const animate = (to, ms, then, ease) => {
    const from = { u, ...off }, keep = { ...off }, { u: tu, ...rest } = to;   // off 只放偏移量，不能混進 u（不然下一次的起點會被舊的 u 蓋掉，鏡頭先跳到別區再滑回來）
    Object.assign(off, rest); u = tu; clampOff();   // 終點先照範圍收好，動畫結束時不會再跳一下
    to = { u, ...off };
    Object.assign(off, keep); u = from.u;
    vel = 0; anim = { from, to, t0: performance.now(), ms, then, ease }; kick();
  };
  // 放大時只在這一區裡左右移：要換區先縮回整區、再沿岩壁滑過去
  let home = Math.round(u);
  const zoomed = () => off.zoom < ZOOMED;
  // 一次拖曳最多到相鄰那一區（相鄰的區看的中心可能只差 1–3 m，例如砲管三區，不然滑一下跳兩區）；放大時只在這一區裡
  const range = () => zoomed() ? [Math.max(0, home - 0.5), Math.min(last, home + 0.5)] : [Math.max(0, home - 1), Math.min(last, home + 1)];
  const toArea = (i) => {
    const to = MathUtils.clamp(i, 0, last);
    if (zoomed()) return animate({ u, az: 0, pol: 0, zoom: 1, lift: 0 }, ZOOM_MS, () => toArea(to));
    if (to === u && !off.az && !off.pol && off.zoom === 1 && !off.lift) return;
    animate({ u: to, az: 0, pol: 0, zoom: 1, lift: 0 }, MathUtils.clamp(GO_MS + along(u, to) * GO_MS_PER_M, GO_MS, GO_MAX_MS));
  };

  // 快照：鏡頭就站在拍快照的地方，照畫面的視角換算大小；手機上剛好填滿（快照是手機的比例），比畫面窄時左右邊緣淡掉
  const posterBox = () => {
    if (fly) { const height = H * fly.half / flyTan(), width = height * fly.aspect; return { left: (W - width) / 2, top: (H - height) / 2, width, height }; }
    const b = base[MathUtils.clamp(start, 0, last)], height = H * b.half / halfTan(start) / off.zoom, width = height * b.aspect;
    return { left: (W - width) / 2, top: (H - height) / 2, width, height };
  };
  // 快照比畫面窄（電腦、橫放）：整個畫面一起模糊等模型（不要中間清楚、兩邊空白）。快照留在跟路線對齊的位置、邊緣淡掉，
  // 兩邊鋪同一張放大、更模糊的；模糊的時候不畫路線（紅線壓在模糊的畫面上太顯眼），模型好了背景變清楚、路線再淡入
  const cover = () => W / H > 0.9 && posterBox().width < W - 1;   // 明顯的橫螢幕才模糊鋪滿（直放的手機寬高比接近快照，差一兩個像素就誤判成橫的）
  const placeShot = () => {
    const p = posterBox(), wide = cover(), fade = wide ? 'linear-gradient(to right, transparent, #000 12%, #000 88%, transparent)' : 'none';
    Object.assign(shot.style, { left: `${p.left}px`, top: `${p.top}px`, width: `${p.width}px`, height: `${p.height}px`, filter: wide ? 'blur(6px)' : '', maskImage: fade, webkitMaskImage: fade });
    veil.hidden = !wide;
  };
  let sized = '';
  const resize = () => {
    const w = host.clientWidth || 1, h = host.clientHeight || 1, key = `${w}x${h}x${devicePixelRatio}`;
    if (key === sized) return;   // 尺寸沒變不重設畫布：重設寬高會清空畫面，下一格才畫回來，看起來閃一下（電腦版點路線浮出說明卡時會觸發）
    sized = key; W = w; H = h;
    placeShot();
    renderer.setSize(W, H, false); overlay.setSize(W, H, false);
    cam.aspect = W / H; cam.updateProjectionMatrix();
    kick();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();
  onArea(u);
  // 模型在背景載入：載好後畫一會兒讓潑濺排好順序（這時 3D 跟快照一模一樣），快照淡出換成 3D，再拉開到整區、路線淡入
  (async () => {
    // 模型：高斯潑濺（.spz），或岩壁用網格（.glb，照片貼圖、不打光）、四周山林天空用潑濺背景（background，被網格擋住的地方不畫）
    const load = async (u, glb) => {
      u = await u;   // url 可以是還在讀的 Promise（模型從手機儲存空間讀出來要一點時間，放大動畫不等它）
      const bytes = await (await fetch(u)).arrayBuffer();
      if (glb) {
        const g = await new GLTFLoader().parseAsync(bytes, '');
        g.scene.traverse((o) => { if (o.isMesh) { const old = o.material; o.material = new MeshBasicMaterial({ map: old.map, side: DoubleSide }); old.dispose(); } });
        return Object.assign(g.scene, { dispose: () => g.scene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.map?.dispose(); o.material.dispose(); } }) });
      }
      const s = new SplatMesh({ fileBytes: bytes });
      scene.add(s); await s.initialized;
      return s;
    };
    const [m, bg] = await Promise.all([load(url, glb), background ? load(background, false) : null]);
    if (dead) { m.dispose?.(); bg?.dispose?.(); return; }
    scene.add(m);
    splat = m; backdrop = bg;
    await Promise.race([new Promise((ok) => { onDrawn = ok; kick(); }), new Promise((ok) => setTimeout(ok, 15000))]);   // 等到畫面上真的看得到模型、排好（15 秒只是防卡住）
    onDrawn = null;
    shot.style.opacity = veil.style.opacity = '0';
    if (!fly && !cover()) overlay.domElement.style.opacity = '1';   // 手機：快照跟 3D 同一個畫面、不模糊，路線跟著快照淡出同時淡入，不用多等一輪
    await new Promise((ok) => setTimeout(ok, POSTER_MS));
    shot.remove(); veil.remove(); kick();
    if (!fly) overlay.domElement.style.opacity = '1';   // 橫螢幕：快照完全淡掉、看得到 3D 的岩壁之後，路線才淡入
    if (fly) { fly.t0 = performance.now() + INTRO_HOLD_MS; kick(); return; }   // 全區停一下再飛進去（飛完才走去指定的岩壁、路線）
    waiting?.(); waiting = null;
  })().catch((e) => { console.warn('3D 模型載入失敗', e); overlay.domElement.style.opacity = '1'; });

  // ── 手勢 ──
  const el = renderer.domElement, ptrs = new Map();
  el.style.touchAction = 'none';   // 手勢全部自己處理：不然手機瀏覽器會把左右滑當成返回上一頁、回彈（滑到頭時畫面轉一下又跑回來），中途搶走手勢也會打斷鏡頭動畫（閃一下）
  let tap = null, lastTap = null, pinch = null, mouseTurn = false, track = [];
  const local = (x, y) => { const r = host.getBoundingClientRect(); return [x - r.left, y - r.top]; };
  const mid = () => { const a = [...ptrs.values()]; return [(a[0][0] + a[1][0]) / 2, (a[0][1] + a[1][1]) / 2, Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]), Math.atan2(a[1][1] - a[0][1], a[1][0] - a[0][0])]; };
  const mPerPx = () => 2 * current().dist * Math.tan(MathUtils.degToRad(cam.fov) / 2) / H;
  // 左右拖：沿著岩壁走（軌道上兩區之間的距離換算成公尺，手指底下的岩壁跟著手指走；放大後一樣）
  let push = 0;   // 放大時推到這一區邊緣外的像素（夠多就換區）
  const slideBy = (dx) => {
    const [lo, hi] = range(), want = u - dx * mPerPx() / seg(u);
    u = MathUtils.clamp(want, lo, hi);
    push = want < lo ? push + dx : want > hi ? push + dx : 0;
  };
  // 畫面上 (x, y) 指到的岩面，相對於目前看的中心：沿著軌道幾區、往上幾公尺（從相機穿過那一點，跟過中心、面向相機的平面相交）
  const aim = (x, y) => {
    const t0 = current().target, ray = new Vector3(x / W * 2 - 1, 1 - y / H * 2, 0.5).unproject(cam).sub(cam.position).normalize();
    const n = cam.position.clone().sub(t0).normalize(), k = t0.clone().sub(cam.position).dot(n) / ray.dot(n);
    if (!(k > 0)) return null;
    const d = cam.position.clone().addScaledVector(ray, k).sub(t0);
    return { du: d.dot(new Vector3().setFromMatrixColumn(cam.matrixWorld, 0)) / seg(u), dy: d.y };
  };
  const zoomAt = (f, x, y) => {   // 往 (x, y) 縮放：手指、游標底下那一點留在原地
    const a = aim(x, y), z0 = off.zoom;
    off.zoom *= f; clampOff();
    if (a) { const k = 1 - off.zoom / z0; u += a.du * k; off.lift += a.dy * k; clampOff(); }
  };
  const doubleTap = (x, y) => {   // 點兩下：放大到點的地方（那一點移到畫面中央）；已經放大就回到這一區的整區畫面
    if (off.zoom < ZOOM_IN * 1.5) return animate({ u: Math.round(u), az: 0, pol: 0, zoom: 1, lift: 0 }, ZOOM_MS);
    const a = aim(x, y);
    animate({ u: u + (a?.du ?? 0), az: off.az, pol: off.pol, zoom: ZOOM_IN, lift: off.lift + (a?.dy ?? 0) }, ZOOM_MS);
  };
  const ac = new AbortController(), on = (t, f, opts = {}) => el.addEventListener(t, f, { signal: ac.signal, ...opts });
  on('contextmenu', (e) => e.preventDefault());
  on('pointerdown', (e) => {
    if (!splat || fly) return;   // 第一次進來的全區飛行中也先不動；模型還沒載好：鏡頭先不動，換成 3D 時才對得上
    if (shot.isConnected) { shot.remove(); veil.remove(); }   // 快照還在淡出（靜止的圖，不跟著鏡頭）：一動就拿掉，不然路線跟著鏡頭走、快照沒動，看起來路線沒貼著岩壁
    el.setPointerCapture(e.pointerId);
    el.style.cursor = 'grabbing';
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    anim = null; vel = 0; push = 0; home = Math.round(u);
    tap = ptrs.size === 1 && e.button === 0 ? [e.clientX, e.clientY] : null;
    mouseTurn = ptrs.size === 1 && e.button === 2;
    pinch = ptrs.size === 2 ? mid() : null;
    track = [[performance.now(), u]];
  });
  on('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const [px, py] = ptrs.get(e.pointerId), dx = e.clientX - px, dy = e.clientY - py;
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (tap && Math.hypot(e.clientX - tap[0], e.clientY - tap[1]) > 8) tap = null;
    if (ptrs.size === 1) {
      if (mouseTurn) { off.az -= dx * 0.005; off.pol -= dy * 0.005; }
      else { slideBy(dx); off.lift += dy * mPerPx(); }
      track.push([performance.now(), u]); if (track.length > 6) track.shift();
    } else if (ptrs.size === 2 && pinch) {
      const m = mid();
      let da = m[3] - pinch[3];
      if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
      if (m[2] > 40) off.az -= da;
      slideBy(m[0] - pinch[0]); off.lift += (m[1] - pinch[1]) * mPerPx();
      if (pinch[2] > 0 && m[2] > 0) zoomAt(pinch[2] / m[2], ...local(m[0], m[1]));
      pinch = m;
    }
    clampOff();
    kick();
  });
  const up = (e) => {
    ptrs.delete(e.pointerId);
    if (!ptrs.size) { mouseTurn = false; el.style.cursor = 'grab'; }
    pinch = ptrs.size === 2 ? mid() : null;
    if (ptrs.size) return;
    if (tap) {
      const [x, y] = local(e.clientX, e.clientY), now = performance.now();
      tap = null;
      const scr = (p) => { const v = p.clone().project(cam); return v.z < 1 ? [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H] : null; };
      let best = null;
      for (const r of routes) if (r.fade > 0.5) for (let i = 0; i < r.pts.length; i++) {
        if (!r.vis[i]) continue;
        const s = scr(r.pts[i]), d = s && Math.hypot(s[0] - x, s[1] - y);
        if (s && (!best || d < best[0])) best = [d, r.id];
      }
      if (lastTap && now - lastTap.t < DOUBLE_MS && Math.hypot(x - lastTap.x, y - lastTap.y) < TAP_PX * 1.5) {   // 點兩下只縮放：第一下選到的路線還原
        onPick(lastTap.before ?? null); lastTap = null; doubleTap(x, y);
      } else {
        lastTap = { t: now, x, y, before: highlight };
        onPick(best && best[0] < TAP_PX ? best[1] : null);
      }
      return;
    }
    if (zoomed() && Math.abs(push) > PUSH_PX) return toArea(home - Math.sign(push));   // 放大時推過這一區的邊緣：縮回整區再滑到那一區
    // 放開：照手指的速度往前滑、越來越慢，停在哪裡就是哪裡（像在岩場裡走，不拉回某一區；拉回去看起來像自己跑回原位）
    const [t0, u0] = track[0] ?? [0, u], v = (u - u0) / Math.max(1, performance.now() - t0) * 1000, vmax = MAX_SPEED / seg(u);
    vel = MathUtils.clamp(v, -vmax, vmax);
    if (Math.abs(vel) * seg(u) < 0.3) vel = 0;
    kick();
  };
  on('pointerup', up);
  on('pointercancel', (e) => { tap = null; up(e); });
  on('wheel', (e) => {
    e.preventDefault();
    if (!splat || fly) return;
    anim = null; vel = 0;
    zoomAt(Math.exp(e.deltaY * (e.ctrlKey ? 0.004 : 0.0012)), ...local(e.clientX, e.clientY));
    kick();
  }, { passive: false });

  // 走到某條路線前面（路線清單點一條）：軌道上看的中心離路線起點（水平）最近的那一點，到了才亮起來；模型還沒載好就等載好再走（快照不跟著鏡頭）
  let waiting = null;
  const toRoute = (id) => {
    const r = routes.find((x) => x.id === id);
    if (!r) return;
    if (!splat || fly) return void (waiting = () => toRoute(id));
    let best = u, bd = Infinity;
    for (let x = 0; x <= last + 1e-9; x += 0.01) {
      const t = areaPose(x).target, d = Math.hypot(t.x - r.pts[0].x, t.z - r.pts[0].z);
      if (d < bd) { bd = d; best = x; }
    }
    const done = () => onPick(id);
    if (Math.abs(best - u) < 0.02 && !zoomed()) return done();
    animate({ u: best, az: 0, pol: 0, zoom: 1, lift: 0 }, MathUtils.clamp(GO_MS + along(u, best) * GO_MS_PER_M, GO_MS, GO_MAX_MS), done);
  };
  const toWall = (i) => (splat && !fly ? toArea(i) : void (waiting = () => toWall(i)));

  return {
    highlight(id) { highlight = id ?? undefined; style(); kick(); },
    go: toWall,
    route: toRoute,   // 換到第幾區的整區畫面：沿著岩壁滑過去，遠的久一點；放大時先縮回整區
    walk(n) {   // 沿著岩壁往前（1）往後（-1）走 WALK_M 公尺（電腦的方向鍵）：連續的步道，不停靠某一區
      if (fly) return;
      const to = MathUtils.clamp((anim?.to.u ?? u) + n * WALK_M / seg(u), 0, last);
      animate({ u: to, ...off }, GO_MS);
    },
    area: () => Math.round(anim?.to.u ?? u),
    posterRect() {   // 快照在畫面上的位置，小卡直接放大到這裡（就是最後的畫面）
      const r = host.getBoundingClientRect(), p = cover() ? { left: 0, top: 0, width: W, height: H } : posterBox();
      return { left: r.left + p.left, top: r.top + p.top, width: p.width, height: p.height };
    },
    destroy() {
      dead = true; ac.abort(); ro.disconnect();
      lines.traverse((x) => { if (x.isMesh) { x.geometry?.dispose(); x.material?.uniforms?.map?.value?.dispose?.(); x.material?.dispose?.(); } });
      for (const r of routes) for (const m of [r.pill?.off, r.pill?.on]) { m?.uniforms?.map?.value?.dispose?.(); m?.dispose?.(); }   // 號碼牌：沒掛在場景上的那組也要放掉
      splat?.dispose?.(); backdrop?.dispose?.(); scene.remove(spark); spark.dispose();   // 排序的 Worker（帶著幾十 MB 的 WASM 記憶體）不會被垃圾回收，一定要停
      for (const r of [renderer, overlay]) { r.dispose(); r.forceContextLoss(); }   // iOS Safari 的 WebGL context 數量有限，進出幾次就用完
      host.replaceChildren();
    },
  };
}
