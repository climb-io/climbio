// RouteKit 的型別。座標都是照片像素；外框 poly＝[[x, y], …]。
// English: RouteKit type definitions. Coordinates are photo pixels.

export type Point = [number, number];
export type Poly = Point[];
/** s 起攀、h 手點、f 腳點、t 完攀 */
export type HoldType = 's' | 'h' | 'f' | 't';
export interface Hold { id: string; poly: Poly; source?: string; retired?: boolean; [key: string]: unknown }
/** 路線：岩點和角色、出手順序、路線自帶的外框（Climbio 公開格式 v2 的 route 節點用 fromFormat 轉過來） */
export interface Route {
  holds: Record<string, HoldType>;
  seq?: string[];
  shapes?: Record<string, Hold>;
  id?: string; name?: string; grade?: string; author?: string; t?: number;
  /** 膠帶顏色名稱（紅、橙、黃、綠、青、藍、紫、粉、白、黑），岩館的路線用顏色加難度標示 */
  color?: string;
  [key: string]: unknown;
}
export interface Theme { colors: Record<HoldType, string>; font: string; text: { s: string; t: string } }
export interface Box { x0: number; y0: number; x1: number; y1: number }
export type Photo = HTMLImageElement | HTMLCanvasElement | OffscreenCanvas | ImageBitmap;
export type BaseMode = 'gray' | 'dim';
/** 路線岩點外圍一圈角色色的光暈（跟 3D 牆一樣）：roles 是 { 岩點 id: 角色 }，colors 是角色色，dpr 是畫布的裝置像素比 */
export interface Glow { roles: Record<string, string>; colors: Record<string, string>; dpr?: number }
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// geometry
export function bbox(poly: Poly): Box;
export function tracePoly(c: Ctx, poly: Poly): void;
export function inPoly(x: number, y: number, poly: Poly): boolean;
export function area(poly: Poly): number;
export function edgePoint(poly: Poly, dx: number, dy: number, centerEdge?: boolean): Point;
export function stripTip(poly: Poly, dx: number, dy: number, c: Point, w: number): unknown;
export function edgeTangent(poly: Poly, x: number, y: number, R: number): unknown;
export function strokeOutside(c: Ctx, poly: Poly, width: number): void;
/** 點到的岩點：包住 (x, y) 最小的那顆 */
export function holdAt<H extends Hold>(holds: H[], x: number, y: number): H | null;

// labels
export const THEME: Theme;
export function typeLabels(scene: RouteScene, routeHolds: Hold[], route: Route, unit: number, hands?: boolean, theme?: Theme): unknown[];
export function drawTypeLabels(c: Ctx, labels: unknown[], unit: number, theme?: Theme): void;
export function seqBadges(c: Ctx, scene: RouteScene, route: Route, unit: number, labels: unknown[], routeHolds: Hold[]): unknown[];
export function drawSeq(c: Ctx, scene: RouteScene, route: Route, unit: number, labels: unknown[], routeHolds: Hold[], theme?: Theme): void;
export function strokeRouteHold(c: Ctx, poly: Poly, type: HoldType, L: (screen: number, photo: number) => number, theme?: Theme): void;

// base
export function grayOf(img: Photo): HTMLCanvasElement;
export function plainGrayOf(img: Photo): HTMLCanvasElement;
export function mutedOf(img: Photo): HTMLCanvasElement;
export function liftTint(c: Ctx, W: number, H: number, rgb?: number[]): void;
export function tintCard(g: Ctx, S: number): void;
export function routeLayers(routeHolds: Hold[], all: Hold[]): unknown;
export function routeMask(m: Ctx, routeHolds: Hold[], all: Hold[]): (img: Photo) => void;
export function routeLayer(img: Photo, routeHolds: Hold[], all: Hold[], opts?: { tint?: boolean }): unknown;
export function drawRouteBase(c: Ctx, scene: RouteScene, routeHolds: Hold[], opts?: { mode?: BaseMode; tint?: boolean; glow?: Glow }): void;
/** 畫在線條層（螢幕解析度）上的光暈：光暈在下，路線岩點的原色圖層（layer，沒給就不蓋）蓋在上面 */
export function glowAround(c: Ctx, routeHolds: Hold[], roles: Record<string, string>, colors: Record<string, string>, dpr?: number, layer?: { c: CanvasImageSource; x: number; y: number } | null): void;

// scene
export class RouteScene {
  constructor(img: Photo, holds: Hold[] | (() => Hold[]));
  img: Photo; w: number; h: number; holds: Hold[]; version: number;
  plain(mode?: BaseMode): HTMLCanvasElement;
  readonly muted: HTMLCanvasElement;
  touch(): void;
  release(): void;
  recover(lost: (canvas: HTMLCanvasElement) => boolean): boolean;
  routeLayer(routeHolds: Hold[], opts?: { tint?: boolean }): unknown;
  drawBase(c: Ctx, routeHolds: Hold[], opts?: { mode?: BaseMode; tint?: boolean; glow?: Glow }): void;
  labels(routeHolds: Hold[], route: Route, unit: number, hands?: boolean, theme?: Theme): unknown[];
  prefetch(jobs: { routeHolds: Hold[]; r: Route; unit: number; mode?: BaseMode; tint?: boolean; hands?: boolean }[], alive?: () => boolean): Promise<void>;
}
export function scene(img: Photo, holds: Hold[] | (() => Hold[])): RouteScene;

// image
/** 路線用到的岩點：route.shapes 優先，沒有的用牆上那顆 */
export function routeHolds(route: Route, holds: Hold[]): Hold[];
export function cropAround(routeHolds: Hold[], PW: number, PH: number, aspect: number): { x: number; y: number; w: number; h: number };
export function revealSteps(route: Route, routeHolds: Hold[]): Hold[][];
export function drawRoute(g: Ctx, scene: RouteScene, route: Route, routeHolds: Hold[], opts?: { unit?: number; mode?: BaseMode; tint?: boolean; hands?: boolean; theme?: Theme; glow?: Glow }): void;
/** 原尺寸的路線圖 */
export function renderRouteImage(scene: RouteScene, route: Route, routeHolds: Hold[], opts?: { theme?: Theme }): HTMLCanvasElement;
export function thumbCrop(W: number, H: number, routeHolds: Hold[]): { sx: number; sy: number; side: number };
export function routeThumb(scene: RouteScene, routeHolds: Hold[], S?: number, opts?: { mode?: 'gray' | 'dim'; route?: Route; theme?: Theme }): HTMLCanvasElement & { crop: { sx: number; sy: number; side: number } };

// editor
export const MAX_START: number;
export function startCount(route: Route): number;
export function tapHold(route: Route, id: string, type: HoldType, opts?: { maxStart?: number; justAdded?: boolean }): 'added' | 'changed' | 'removed' | 'full' | 'ignored';
export function appendSeq(route: Route, id: string): boolean;
export function insertSeq(route: Route, id: string, at: number): boolean;
export function popSeq(route: Route, added: boolean, at?: number): void;
export function dropSeq(route: Route, id: string): void;
export function clearFeet(route: Route): number;
export function toggleFeetFree(route: Route): boolean;

// viewport（跟岩點貓一樣的縮放、平移）
/** 視角：s 是比例（1＝整張照片放進框），k 是每個照片像素幾個螢幕點，tx、ty 是照片左上角在框內的位置（螢幕 CSS 像素） */
export interface ViewTransform { s: number; k: number; tx: number; ty: number }
export function clampView(s: number, tx: number, ty: number, geo: { W: number; H: number; bw: number; bh: number; pads?: [number, number]; maxScale?: number; minScale?: number; fitPads?: [number, number] }): { s: number; tx: number; ty: number };
/** 以框內 (px, py) 這一點不動，縮放到 s2 */
export function zoomAround(v: { s: number; tx: number; ty: number }, s2: number, px: number, py: number): { s: number; tx: number; ty: number };
export const MIN_SCALE: number;
export const MAX_SCALE: number;
/** 點兩下放大的倍數、兩下之間最多幾毫秒 */
export const DOUBLE_TAP: number;
export const DOUBLE_MS: number;
export function maxScaleOf(photoWidth: number, fittedWidth: number): number;
export function fitOf(W: number, H: number, photoW: number, photoH: number): { k: number; bw: number; bh: number };
export const ZOOM_STEPS: number[];
export class Viewport {
  constructor(canvas: HTMLCanvasElement, photo: { w: number; h: number }, opts?: { onChange?: (t: ViewTransform) => void; pads?: () => [number, number]; home?: (geo: object) => { s: number; tx: number; ty: number } | null; canZoomAt?: (x: number, y: number) => boolean });
  readonly transform: ViewTransform;
  enabled: boolean;
  enable(on: boolean): void;
  reset(silent?: boolean): void;
  home(): { s: number; tx: number; ty: number };
  flyTo(target: { s: number; tx: number; ty: number }, ms?: number): void;
  zoomTo(s: number, px: number, py: number, animate?: boolean): void;
  zoomStep(dir: 1 | -1): void;
  doubleTap(px: number, py: number): void;
  resized(): void;
  destroy(): void;
}

// viewer
export interface ViewOptions { scene: RouteScene; route: Route; theme?: Theme; zoom?: boolean; pads?: () => [number, number]; onView?: (t: ViewTransform | null) => void }
export class RouteViewer {
  constructor(canvas: HTMLCanvasElement, opts: ViewOptions & { mode?: BaseMode; glow?: boolean });
  canvas: HTMLCanvasElement; scene: RouteScene; route: Route; mode: BaseMode;
  readonly routeHolds: Hold[];
  setRoute(route: Route): void;
  setMode(mode: BaseMode): void;
  setZoom(on: boolean): void;
  zoomStep(dir: 1 | -1): void;
  resetView(): void;
  readonly zoomed: boolean;
  render(): void;
  destroy(): void;
}
/** 重疊岩點的選擇、熱圖、出手順序（岩點貓和內嵌頁共用的規則） */
export function edgeDist(x: number, y: number, poly: Poly): number;
/** 手畫的軌跡 → 簡化的多邊形外框（限制在 W×H 的照片裡，頭尾自動接起來）；畫得太小回傳 null */
export function freehandPoly(pts: [number, number][], W: number, H: number, opts?: { minTol?: number; minSize?: number; maxN?: number }): Poly | null;
export function holdsUnder(holds: Hold[], x: number, y: number): Hold[];
export function prepareOverlapPick(candidates: Hold[], all: Hold[], size: { w: number; h: number; width: number; height: number }): { holds: Hold[]; neighbors: Hold[]; spots: ReturnType<typeof overlapSpots>; k: number; cx: number; cy: number };
export function overlapSpots(cands: Hold[], W: number, H: number, neighbors?: Hold[]): Map<Hold, { x: number; y: number; d?: number; anchor?: Point }>;
export function pickOverlap(cands: Hold[], spots: Map<Hold, { x: number; y: number }>, x: number, y: number, radius: number, direct?: Hold | null): Hold | null;
export function nextType(route: Route, type: HoldType | 'n', maxStart?: number): HoldType | 'n';
export function holdUse(routes: Route[], current?: Route | null): { use: Map<string, number>; max: number };
export function heatLevel(heat: { use: Map<string, number>; max: number }, id: string): number;
/** 熱圖外框、重疊候選的畫法（L：螢幕像素 → 照片單位） */
export function heatColor(k: number, a: number | string): string;
export function strokeHoldOutline(c: CanvasRenderingContext2D, poly: Poly, o: { k?: number; sel?: boolean; viewScale?: number; big?: number; L: (screenPx: number) => number }): void;
export function drawOverlapPick(c: CanvasRenderingContext2D, o: { img: CanvasImageSource; holds: Hold[]; spots: Map<Hold, { x: number; y: number; anchor?: Point }>; preferred?: Hold | null; neighbors?: Hold[]; vis: { x0: number; y0: number; x1: number; y1: number }; L: (screenPx: number) => number; routeHolds?: Hold[]; route?: Route | null; theme?: unknown }): void;
export interface OrderSession {
  reset(): void; insertAt(route: Route): number | null; canUndo(route: Route | null): boolean; tap(route: Route, id: string): number; undo(route: Route): boolean;
  numbers(route: Route | null, id: string): number[]; startInsert(route: Route, n: number): void; endInsert(): void; remove(route: Route, n: number): void; clear(route: Route): void;
}
export function orderSession(): OrderSession;

export class RouteEditor {
  /** route 會被直接修改；type 的 n＝追加出手順序 */
  constructor(canvas: HTMLCanvasElement, opts: ViewOptions & { type?: HoldType | 'n'; mode?: BaseMode; glow?: boolean; maxStart?: number; onChange?: (route: Route) => void; onLimit?: () => void; onType?: (type: HoldType | 'n') => void; onOrder?: (info?: { added?: number }) => void; onOrderAsk?: (m: { id: string; nums: number[] }) => void; heatRoutes?: Route[] | (() => Route[]); showAll?: boolean; draw?: boolean });
  canvas: HTMLCanvasElement; scene: RouteScene; route: Route; type: HoldType | 'n';
  readonly routeHolds: Hold[];
  setRoute(route: Route): void;
  setType(type: HoldType | 'n'): void;
  setMaxStart(maxStart?: number): void;
  /** 顯示所有岩點（熱圖）：其他路線（heatRoutes）用過的照次數畫成粉紅到洋紅 */
  setShowAll(on: boolean): void; showAll: boolean;
  /** 觸控長按沒有岩點的地方，手指不放直接畫一圈（有放大鏡），放開簡化成多邊形，以 route.shapes 的外框加進路線 */
  setDrawMode(on: boolean): void; setHeatRoutes(routes: Route[]): void;
  /** 出手順序（type 'n'）：長按有編號的岩點會呼叫 onOrderAsk，外層問過再呼叫 orderInsertAfter／orderRemove */
  readonly orderInfo: { len: number; insertAt: number | null; canUndo: boolean }; readonly canUndoSeq: boolean;
  undoSeq(): boolean; orderInsertAfter(n: number): void; orderEndInsert(): void; orderRemove(n: number): void; orderClear(): void;
  /** 不限腳：路線上有腳點、要開時回傳 'confirm'，外層問過再用 { clear: true } 呼叫 */
  toggleFeetFree(opts?: { clear?: boolean }): 'confirm' | 'on' | 'off';
  setZoom(on: boolean): void;
  zoomStep(dir: 1 | -1): void;
  resetView(): void;
  readonly zoomed: boolean;
  setMode(mode: BaseMode): void;
  render(): void;
  destroy(): void;
}

// circles（圈點格式，例如 RouteMake）
/** x、y：圈圈中心佔照片寬／高的百分比；r：1 小、2 中、3 大 */
export interface Circle { x: number; y: number; t: 's' | 'h' | 't' | string; r: 1 | 2 | 3 | number }
export const CIRCLE_DIAMETER: Record<1 | 2 | 3, number>;
export function fromCircles(circles: Circle[], w: number, h: number, opts?: { holds?: Hold[] }): Route;
export function toCircles(route: Route, holds: Hold[], w: number, h: number): { x: number; y: number; t: 's' | 'h' | 't'; r: 1 | 2 | 3 }[];

// format（Climbio 公開格式 v2：牆＝照片畫面、路線＝疊在牆上的圖層；不檢查格式，先用 @climbio/format 的 validate）
export function fromFormat(view: object, layers?: object[]): { w: number; h: number; holds: Hold[]; routes: Route[] };
/** 牆 → 照片畫面（holds 是原始岩點檔的岩點；href 是照片、thumb 是縮圖的路徑或網址） */
export function wallView(wall: { pid: string; name?: string; w: number; h: number; holds?: Hold[]; href: string; thumb?: string; attribution?: string; t?: number; license?: string; author?: string; sha256?: string; props?: object }): object;
/** 路線 → 疊在牆上的圖層（holds 是畫面上的岩點：路線自帶的外框跟它一樣就不寫） */
export function routesLayer(layer: { id: string; pid: string; href: string; w: number; h: number; holds?: Hold[]; routes?: Route[]; gym?: string; thumb?: string; props?: object; attribution?: string; name?: string; t?: number; license?: string; author?: string }): object;
/** 一面牆發佈的檔案：畫面 `{pid}.json`、照片 `{pid}.jpg`、縮圖 `{pid}.thumb.jpg`、圖層 `{layerId}.json`（沒給 layerId 就沒有圖層）。畫面與圖層的 props.thumb 指到縮圖 */
export function wallFiles(wall: { pid: string; layerId?: string; name?: string; w: number; h: number; holds?: Hold[]; routes?: Route[]; gym?: string; photo: Uint8Array; thumb?: Uint8Array | null; attribution?: string; t?: number; view?: object; layer?: object }): { files: { path: string; bytes: Uint8Array }[]; view: object; layer: object | null; entry: string; thumbPath: string };
/** 縮圖在包裡的路徑 */
export function thumbPathOf(pid: string): string;

declare const RouteKit: {
  bbox: typeof bbox; tracePoly: typeof tracePoly; inPoly: typeof inPoly; area: typeof area; edgePoint: typeof edgePoint;
  stripTip: typeof stripTip; edgeTangent: typeof edgeTangent; strokeOutside: typeof strokeOutside; holdAt: typeof holdAt;
  THEME: typeof THEME; typeLabels: typeof typeLabels; drawTypeLabels: typeof drawTypeLabels; seqBadges: typeof seqBadges;
  drawSeq: typeof drawSeq; strokeRouteHold: typeof strokeRouteHold;
  grayOf: typeof grayOf; plainGrayOf: typeof plainGrayOf; mutedOf: typeof mutedOf; liftTint: typeof liftTint; tintCard: typeof tintCard;
  routeLayers: typeof routeLayers; prepareOverlapPick: typeof prepareOverlapPick; routeMask: typeof routeMask; routeLayer: typeof routeLayer; drawRouteBase: typeof drawRouteBase; glowAround: typeof glowAround;
  RouteScene: typeof RouteScene; scene: typeof scene;
  routeHolds: typeof routeHolds; cropAround: typeof cropAround; revealSteps: typeof revealSteps; drawRoute: typeof drawRoute;
  renderRouteImage: typeof renderRouteImage; thumbCrop: typeof thumbCrop; routeThumb: typeof routeThumb;
  MAX_START: typeof MAX_START; startCount: typeof startCount; tapHold: typeof tapHold; nextType: typeof nextType; holdUse: typeof holdUse; heatLevel: typeof heatLevel; orderSession: typeof orderSession;
  heatColor: typeof heatColor; strokeHoldOutline: typeof strokeHoldOutline; drawOverlapPick: typeof drawOverlapPick;
  edgeDist: typeof edgeDist; freehandPoly: typeof freehandPoly; holdsUnder: typeof holdsUnder; overlapSpots: typeof overlapSpots; pickOverlap: typeof pickOverlap; appendSeq: typeof appendSeq;
  insertSeq: typeof insertSeq; popSeq: typeof popSeq; dropSeq: typeof dropSeq; clearFeet: typeof clearFeet; toggleFeetFree: typeof toggleFeetFree;
  Viewport: typeof Viewport; clampView: typeof clampView; maxScaleOf: typeof maxScaleOf; fitOf: typeof fitOf; ZOOM_STEPS: typeof ZOOM_STEPS; RouteViewer: typeof RouteViewer; RouteEditor: typeof RouteEditor;
  CIRCLE_DIAMETER: typeof CIRCLE_DIAMETER; fromCircles: typeof fromCircles; toCircles: typeof toCircles; fromFormat: typeof fromFormat; wallView: typeof wallView; routesLayer: typeof routesLayer; wallFiles: typeof wallFiles; thumbPathOf: typeof thumbPathOf;
};
export default RouteKit;

// 操作介面（ui.js）：定線、看線的按鈕，純 UI 元件（見 README「操作介面」）
export interface EditorUIController {
  type?: HoldType | 'n'; setType?(t: HoldType | 'n'): void; setMode?(base: BaseMode): void; showAll?: boolean; setShowAll?(on: boolean): void; zoomStep?(dir: 1 | -1): void;
  canUndoSeq?: boolean; undoSeq?(): boolean; orderInfo?: { len: number; insertAt: number | null; canUndo: boolean };
  orderInsertAfter?(n: number): void; orderRemove?(n: number): void; orderClear?(): void; orderEndInsert?(): void; toggleFeetFree?(o?: { clear?: boolean }): 'confirm' | 'on' | 'off';
}
export interface EditorUIOptions {
  mode?: 'edit' | 'view'; top?: boolean; nav?: boolean; lang?: 'zh' | 'en'; strings?: Record<string, string | ((...a: number[]) => string)>; base?: BaseMode; controls?: boolean; foot?: boolean; order?: boolean; heat?: boolean; zoom?: boolean;
  fullscreen?: boolean; interactive?: boolean; fullscreenOn?: boolean; colors?: Partial<Record<'s' | 'h' | 't' | 'f', string>>; type?: HoldType | 'n';
  onDone?(): void; onCancel?(): void; onBase?(next: BaseMode): void; onFullscreen?(): void; onLimit?(): void; onPrev?(): void; onNext?(): void;
}
export interface EditorUI {
  el: HTMLElement; hooks: { onType(t: string): void; onOrder(): void; onOrderAsk(m: { id: string; nums: number[] }): void; onLimit(): void };
  attach(controller: EditorUIController, getRoute?: () => Route | null): void; detach(): void; update(): void; pads(canvas: HTMLCanvasElement): [number, number];
  /** 看路線圖的路線切換：目前第幾條（從 0 起）、共幾條 */
  setNav(info: { index: number; total: number }): void;
  pickType(t: HoldType | 'n'): void; readonly type: HoldType | 'n'; setOptions(o: Partial<EditorUIOptions>): void; destroy(): void;
}
export type GradeSystem = 'v' | 'font' | 'dan';
export const GRADE_SYS: Record<GradeSystem, string[]>;
export function gradeSysOf(g: string): GradeSystem | null;
export interface GradeDial { setSystem(s: GradeSystem): void; setValue(g: string, smooth?: boolean, fallbackSys?: GradeSystem): void; paint(): void; release(): void; readonly system: GradeSystem }
/** 難度轉盤：d 是宿主給的空元素（class grade-dial）；停下來或點了才 onPick(grade, token)，token 是開始滑的當下 cfg.token() 的值 */
export function gradeDial(d: HTMLElement, cfg?: { sys?: GradeSystem; token?: () => unknown; onTick?: () => void; onPick?: (grade: string, token: unknown) => void }): GradeDial;
export const EditorUI: { mount(host: HTMLElement, cfg?: EditorUIOptions): EditorUI; STR: Record<string, Record<string, unknown>>; TYPES: string[] };

// 路線視角（fit.js）：看路線圖的起始取景，岩點貓與內嵌頁同一份算法
export interface FitGeo { W: number; H: number; bw: number; bh: number; maxScale: number }
export interface FitView { s: number; tx: number; ty: number }
/** 把照片上的範圍放進畫面的視角（還沒套邊界）：四周留 side、上面讓出 topInset，最多放大到照片填滿畫面 */
export function fitBoxIn(b: { x0: number; y0: number; x1: number; y1: number }, g: FitGeo, o: { photoW: number; topInset?: number; side?: number }): FitView;
/** 路線所在那一組（相鄰路線範圍差不多就併成一組）的岩點範圍；沒有回傳 null */
export function groupBox(routes: Route[], r: Route, o: { holdsOf(q: Route): { poly: Poly }[]; labelRects?: ((holds: unknown[], q: Route) => { x0: number; y0: number; x1: number; y1: number }[]) | null; fit(box: { x0: number; y0: number; x1: number; y1: number }): { s: number } }): { x0: number; y0: number; x1: number; y1: number } | null;
/** 路線視角；沒有岩點回傳 null（外層用整張照片） */
export function routeFit(scene: RouteScene, routes: Route[], r: Route, g: FitGeo, o?: { topInset?: number; side?: number; holdsOf?(q: Route): unknown[]; fit?(box: { x0: number; y0: number; x1: number; y1: number }): { s: number } }): FitView | null;
export const FIT_KEEP: number;

/** 路線的標籤大小（照片像素）：路線視角時固定的螢幕大小，岩點貓與內嵌頁同一份 */
export function labelUnitOf(scene: RouteScene, routes: Route[], r: Route, g: FitGeo, o?: { topInset?: number; side?: number; holdsOf?(q: Route): unknown[]; fit?(box: { x0: number; y0: number; x1: number; y1: number }): { s: number } }): number;
