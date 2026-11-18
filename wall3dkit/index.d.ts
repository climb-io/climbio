// Wall3DKit 的型別（手寫）。座標是模型的 [x, y, z]（公尺）；舞台座標是 CSS px。
// English: hand-written types for Wall3DKit.
import type { PerspectiveCamera, Vector3, WebGLRenderer, Scene } from './vendor/three.js';

/** 資料包的 wall.json（climbio-3d-wall/1 工作檔或 climbio-3d-wall/2 成品）；欄位見 README 的「資料格式」 */
export interface WallPack {
  format: 'climbio-3d-wall/1' | 'climbio-3d-wall/2';
  name?: string;
  holds: { id: string; position: [number, number, number]; off?: 0 | 1 }[];
  [key: string]: unknown;
}

/** 2D 的視角：快照縮放 s、平移 tx、ty（舞台座標），bw：s=1 時快照在舞台上的寬，min：最小縮放 */
export interface View { s: number; tx: number; ty: number; bw: number; min?: number }

/** 岩點外框：快照像素座標的多邊形 */
export interface Outline { id: string; poly: [number, number][] }

/** 3D 牆的舞台：模型畫在 2D 的牆頁下面，2D 的縮放、平移換成同一塊裁切（或沿牆走的鏡頭） */
export interface Stage {
  pack: WallPack;
  /** 快照（牆的「照片」）的像素大小 */
  snapW: number; snapH: number;
  /** 成品包帶沿牆鏡頭（walk）時是 true */
  readonly along: boolean;
  /** 鏡頭離開正面（轉過角度、沿牆走）時是 true */
  tilted: boolean;
  /** 沿牆走的鏡頭（成品包帶 walk 時才有） */
  wc?: WalkCam;
  /** 這份資料包的樣子（模型、隱藏的面、裁切、不是岩點的）：變了就要換新的快照 */
  sig: string;
  /** 掛到舞台（畫布放在 before 前面）、拿掉、釋放 WebGL */
  mount(stage: HTMLElement, before?: Node | null): void;
  unmount(): void;
  dispose(): void;
  /** 先開 WebGL、編好著色器、把模型送上顯示卡，進去時第一格不用等 */
  warm(): void;
  setView(view: View): void;
  /** 路線：{ 岩點 id: 角色 }；mode：gray／dim／photo；colors：角色顏色 */
  paint(opts: { holds: Record<string, string>; mode: 'gray' | 'dim' | 'photo'; colors: Record<string, string> }): void;
  /** 舞台座標 (x, y) 點到的岩點 id；tol 像素內找看得到的岩點中心 */
  pick(x: number, y: number, tol?: number, rank?: ((id: string) => number) | null): string | null;
  /** 每顆岩點投到目前鏡頭的外框；only：只算這些岩點 id */
  outlines(only?: Set<string> | null): Outline[];
  /** 正面角度的外框（存檔用） */
  frontOutlines(only?: Set<string> | null): Outline[];
  /** 牆的「照片」：正面、原色、不畫路線 */
  snapshot(): HTMLCanvasElement;
  /** 目前畫面的樣子（原色、不畫路線，舞台大小） */
  viewShot(): HTMLCanvasElement;
  /** 這台的修點：{ 岩點 id: 修點 }；回傳改到的岩點 id */
  setEdits(edits: Record<string, unknown>): Set<string>;
  /** 一格手勢：2D 這一格的視角換成鏡頭（沿牆走、升降、靠近或轉角度）；at：手指位置 */
  walk(view: View, at?: [number, number] | null): View | null;
  /** 從 v0 飛進沿牆鏡頭的起點（或框住 ids 的位置）；progress 0～1 */
  flyIn(v0: View, progress: number, ids?: string[] | null, at?: [number, number] | null): View | null;
  /** 沿牆走到框住這些岩點的位置，每一格 onFrame；回傳停下來的視角 */
  frameTo(ids: string[], onFrame?: () => void, ms?: number): Promise<View | null>;
  /** 回到正面；本來就在正面回 false */
  resetTilt(): boolean;
  /** 兩指同向左右移 dx 像素：調 ±30° 的角度 */
  angle(dx: number): void;
  /** 放手後彈回，每一格呼叫 step */
  settle(step: () => void): void;
}

/** 讀資料包的 wall.json（base：資料包網址，結尾 /） */
export declare function loadPack(base: string): Promise<WallPack>;
/** 下載模型、岩點標籤（成品包另有快照、沿牆鏡頭），建出舞台 */
export declare function openStage(base: string, pack: WallPack): Promise<Stage>;
/** 成品包只靠 wall.json 和快照就能先建一面牆（快照當照片、烘好的正面外框當岩點）；舊資料包回 null */
export declare function openFront(base: string, pack: WallPack): Promise<{ sig: string; name: string; snapshot: HTMLCanvasElement; outlines: Outline[] } | null>;
/** 資料已經在記憶體：glb、每個面的岩點編號、貼圖標籤（uint16 位元組）、每個面的分面 */
export declare function openStageFrom(data: { pack: WallPack; glb: Uint8Array; faces: Uint8Array; labels: Uint8Array; surfaces: Uint8Array }): Promise<Stage>;
export declare function packSig(pack: WallPack): string;
/** 工作檔的分面：每個三角面第幾面（uint8） */
export declare function packSurfaces(pack: WallPack): Promise<Uint8Array>;
/** 不在的岩點（標 off、大部分在隱藏的面、地面、天花板上、被切掉）在 pack.holds 裡的位置 */
export declare function goneHolds(pack: WallPack, faceLabels: Uint16Array, faceSurfaces: Uint8Array): Set<number>;
/** 岩點的面離裁切平面要讓開多遠（公尺） */
export declare function holdMargin(pack: WallPack): number;
/** 點在不在裁切範圍裡 */
export declare function frameTest(pack: WallPack): (p: [number, number, number], hold?: boolean) => boolean;
/** 讓材質照裁切平面丟掉外面的部分（著色器） */
export declare function frameShader(pack: WallPack, outside?: string, hold?: string): ((shader: unknown) => void) & { set(planes: unknown[]): void };
export declare const FRAME_MAX: number;
export declare const FRAME_BOUNDS: number;
export declare function decode(b64: string): Uint8Array;
export declare function inflate(bytes: Uint8Array, kind: 'deflate' | 'deflate-raw' | 'gzip'): Promise<Uint8Array>;
export declare function u16(bytes: Uint8Array): Uint16Array;
/** glb 位元組讀成 three.js 的 glTF */
export declare function parseModel(glb: Uint8Array): Promise<{ scene: Scene; [key: string]: unknown }>;
/** 2D 凸包、精簡到最多 max 點、點在多邊形裡 */
export declare function hull(pts: [number, number][]): [number, number][];
export declare function simplify(poly: [number, number][], max: number): [number, number][];
export declare function inside(x: number, y: number, poly: [number, number][]): boolean;

/** 沿牆鏡頭的軌道（wallPath 從模型算，unpackWalk 從成品包讀） */
export interface WallPathData {
  right: Vector3; f: Vector3; up: Vector3; flip: 1 | -1;
  X: Float32Array; Y: Float32Array; n: number; bin: number; smin: number; smax: number;
  [key: string]: unknown;
}
/** 實拍邊界表（每種畫面比例一張） */
export interface WalkTable { aspect: number; step: number; s0: number; levels: number[]; lo: (number | null)[][]; hi: (number | null)[][]; sa: number[]; sb: number[]; top: number; bottom: number }

/** 沿牆走的鏡頭：位置 s、高度 v、距離 d、角度 yaw；左右、上下範圍和最遠距離照 README 的「鏡頭的標準」 */
export declare class WalkCam {
  constructor(path: WallPathData, camera: PerspectiveCamera);
  s: number; v: number; d: number; yaw: number; W: number; H: number;
  /** 回程角度（沿牆每個取樣點一個，弧度） */
  auto: Float32Array | number[] | null;
  /** 用模型打射線：從 o 往 dir 看得到牆嗎（給了才照「四邊都是牆」算範圍） */
  sees: ((o: Vector3, dir: Vector3) => boolean) | null;
  /** 岩點的世界座標（給了才照「每顆岩點都點得到」延伸範圍） */
  holds: Vector3[] | null;
  readonly dMax: number;
  readonly dMin: number;
  /** 四邊都是牆的左右範圍（sRange 算過後才有） */
  wallS?: [number, number];
  useTable(t: WalkTable): void;
  resize(W: number, H: number): void;
  /** 左右能走的範圍 */
  sRange(): [number, number];
  /** 位置 s、距離 d 時鏡頭高度的範圍；wall：只看四邊都是牆 */
  vRange(s: number, d: number, wall?: boolean): [number, number] | null;
  clamp(): void;
  pan(dx: number, dy: number, P?: Vector3 | null): void;
  zoomAt(k: number, px: number, py: number, P?: Vector3 | null): void;
  apply(): void;
  /** 標準的檢查：距離 d 時點不到的岩點 */
  missedHolds(d: number): Vector3[];
  /** 實拍校正（作者端）：建邊界表 */
  calibrate(renderer: WebGLRenderer, scene: Scene, opts?: { levels?: number[]; iters?: number; px?: number; top?: number; bottom?: number }): WalkTable;
}
export declare function wallPath(meshes: ReturnType<typeof meshesOf>, up: Vector3, front: Vector3): WallPathData;
export declare function profile(meshes: ReturnType<typeof meshesOf>, up: Vector3, front: Vector3, opts?: { nodes?: number; iters?: number; stiff?: number }): unknown;
export declare function meshesOf(gltf: { scene: Scene }): { pos: Float32Array; uv: Float32Array | null; index: Uint32Array; map: unknown }[];
export declare function loadGlb(url: string, opts?: { maxTex?: number }): Promise<{ scene: Scene; [key: string]: unknown }>;
/** 進定線停的位置：最遠、最接近牆中央，每張邊界表都塞得滿 */
export declare function introEnd(wc: WalkCam, tables: WalkTable[]): { s: number; v: number; d: number };
export declare function packWalk(wc: WalkCam, tables: WalkTable[], intro?: { s: number; v: number; d: number } | null): Record<string, unknown>;
export declare function unpackWalk(d: Record<string, unknown>): WallPathData;
export declare function tableFor(d: { tables: WalkTable[] }, aspect: number): WalkTable;
export declare const STEP: number;
export declare const YAW_MAX: number;
export declare const YAW_RATE: number;

/** 烘焙（作者端，純函式）：裁切平面外的部分拿掉、寫出標準 glb */
export interface Plane { n: [number, number, number]; d: number }
export declare function clipPolygon<T extends { p: [number, number, number] }>(poly: T[], planes: Plane[], spare?: (v: T) => number): T[][];
export declare function bakeMesh(mesh: { positions: Float32Array; uvs: Float32Array; fade?: Float32Array; index: Uint32Array; faceLabels: Uint16Array; planes: Plane[]; margin?: number }): { positions: Float32Array; uvs: Float32Array; fade: Float32Array; index: Uint32Array; faceLabels: Uint16Array; origin: Uint32Array; removed: number; clipped: number };
export declare function parseGlb(bytes: Uint8Array): { json: Record<string, unknown>; bin: Uint8Array };
export declare function sourceTexture(glb: Uint8Array): { image: Uint8Array; mime: string; transform: Record<string, unknown> };
export declare function writeGlb(mesh: { positions: Float32Array; uvs: Float32Array; fade?: Float32Array; index: Uint32Array; image: Uint8Array; mime?: string; transform?: Record<string, unknown>; extras?: Record<string, unknown> | null }): Uint8Array;
/** 工作檔（wall.json＋原模型＋每個面的岩點編號）烘焙成成品包（climbio-3d-wall/2）的所有檔案 */
export declare function bakePack(input: { doc: WallPack; glb: Uint8Array; faces: Uint8Array; progress?: (step: string) => void }): Promise<{ files: { path: string; bytes: Uint8Array }[]; stats: { tris: number; removed: number; clipped: number; glb: number } }>;
