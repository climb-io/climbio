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
export function drawRouteBase(c: Ctx, scene: RouteScene, routeHolds: Hold[], opts?: { mode?: BaseMode; tint?: boolean }): void;

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
  drawBase(c: Ctx, routeHolds: Hold[], opts?: { mode?: BaseMode; tint?: boolean }): void;
  labels(routeHolds: Hold[], route: Route, unit: number, hands?: boolean, theme?: Theme): unknown[];
  prefetch(jobs: { routeHolds: Hold[]; r: Route; unit: number; mode?: BaseMode; tint?: boolean; hands?: boolean }[], alive?: () => boolean): Promise<void>;
}
export function scene(img: Photo, holds: Hold[] | (() => Hold[])): RouteScene;

// image
/** 路線用到的岩點：route.shapes 優先，沒有的用牆上那顆 */
export function routeHolds(route: Route, holds: Hold[]): Hold[];
export function cropAround(routeHolds: Hold[], PW: number, PH: number, aspect: number): { x: number; y: number; w: number; h: number };
export function revealSteps(route: Route, routeHolds: Hold[]): Hold[][];
export function drawRoute(g: Ctx, scene: RouteScene, route: Route, routeHolds: Hold[], opts?: { unit?: number; mode?: BaseMode; tint?: boolean; hands?: boolean; theme?: Theme }): void;
/** 原尺寸的路線圖 */
export function renderRouteImage(scene: RouteScene, route: Route, routeHolds: Hold[], opts?: { theme?: Theme }): HTMLCanvasElement;
export function thumbCrop(W: number, H: number, routeHolds: Hold[]): { sx: number; sy: number; side: number };
export function routeThumb(scene: RouteScene, routeHolds: Hold[], S?: number): HTMLCanvasElement & { crop: { sx: number; sy: number; side: number } };

// editor
export const MAX_START: number;
export function startCount(route: Route): number;
export function tapHold(route: Route, id: string, type: HoldType, opts?: { maxStart?: number; justAdded?: boolean }): 'added' | 'changed' | 'removed' | 'full' | 'ignored';
export function appendSeq(route: Route, id: string): boolean;
export function popSeq(route: Route, added: boolean): void;
export function dropSeq(route: Route, id: string): void;

// viewer
export interface ViewOptions { scene: RouteScene; route: Route; theme?: Theme }
export class RouteViewer {
  constructor(canvas: HTMLCanvasElement, opts: ViewOptions & { mode?: BaseMode });
  canvas: HTMLCanvasElement; scene: RouteScene; route: Route; mode: BaseMode;
  readonly routeHolds: Hold[];
  setRoute(route: Route): void;
  render(): void;
  destroy(): void;
}
export class RouteEditor {
  /** route 會被直接修改；type 的 n＝追加出手順序 */
  constructor(canvas: HTMLCanvasElement, opts: ViewOptions & { type?: HoldType | 'n'; onChange?: (route: Route) => void });
  canvas: HTMLCanvasElement; scene: RouteScene; route: Route; type: HoldType | 'n';
  readonly routeHolds: Hold[];
  setRoute(route: Route): void;
  setType(type: HoldType | 'n'): void;
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
  routeLayers: typeof routeLayers; routeMask: typeof routeMask; routeLayer: typeof routeLayer; drawRouteBase: typeof drawRouteBase;
  RouteScene: typeof RouteScene; scene: typeof scene;
  routeHolds: typeof routeHolds; cropAround: typeof cropAround; revealSteps: typeof revealSteps; drawRoute: typeof drawRoute;
  renderRouteImage: typeof renderRouteImage; thumbCrop: typeof thumbCrop; routeThumb: typeof routeThumb;
  MAX_START: typeof MAX_START; startCount: typeof startCount; tapHold: typeof tapHold; appendSeq: typeof appendSeq;
  popSeq: typeof popSeq; dropSeq: typeof dropSeq;
  RouteViewer: typeof RouteViewer; RouteEditor: typeof RouteEditor;
  CIRCLE_DIAMETER: typeof CIRCLE_DIAMETER; fromCircles: typeof fromCircles; toCircles: typeof toCircles; fromFormat: typeof fromFormat; wallView: typeof wallView; routesLayer: typeof routesLayer; wallFiles: typeof wallFiles; thumbPathOf: typeof thumbPathOf;
};
export default RouteKit;
