// ArKit 的型別（AR 看線：相機即時認牆、追蹤，把路線岩點疊回相機畫面）
// English: Type declarations for ArKit.

/** 岩點角色：s 起攀、h 手點、f 腳點、t 完攀 */
export type HoldRole = 's' | 'h' | 'f' | 't';

/** 一條路線：[岩點 id, 角色, 出手順序（進場動畫的先後，可省略）] */
export interface ArRoute {
  id: string;
  holds: Array<[string, HoldRole, number?]>;
  /** 排了出手順序的手點（岩點 id），岩點之間畫一條流動的細虛線 */
  seq?: string[];
}

export interface ArViewOptions {
  /** 找元素的地方（預設 document）：要有 #stage、#live-video、#live-preview、#overlay-canvas */
  root?: Document | Element;
  /** 寫狀態 attribute（data-running、data-located、data-error、data-ar-focus）的元素，預設 document.body；樣式在 view.css，宿主加 data-arkit */
  host?: HTMLElement;
  /** wall（牆 id）、route（岩點id:角色,…）、auto=1（一進來就開相機） */
  params?: URLSearchParams;
  /** 相機比對資料目錄（climbio-2d-tracking/1）的網址，預設頁面同一層的 manifest.json */
  manifestUrl?: string;
  /** OpenCV 4.10.0 的 js，預設 /redpoint/vendor/opencv-4.10.0.js */
  opencvUrl?: string;
  /** 把控制介面掛在 window.wall2dTest（預設 true，測試與實驗頁用） */
  exposeTest?: boolean;
}

export interface ArViewState {
  running: boolean;
  ready: boolean;
  located: boolean;
  sourceKind: 'camera' | 'sim' | 'media';
  overlayStyle: 'ar' | 'outline';
  arRoutes: number;
  arIndex: number;
  arDrag: number;
  arHolds: number;
  /** 疊圖畫一次的時間（ms，移動平均） */
  overlayMs: number;
  /** 畫面上的外框用的單應矩陣（照片 → 擷取影像，含延遲補償），跟顯示中的那一幀對齊 */
  overlayH: number[] | null;
  pose: { wallId: string; H: number[]; width: number; height: number; inliers: number } | null;
  frames: number;
  videoFrame: boolean;
  [key: string]: unknown;
}

export interface ArView {
  readonly state: ArViewState;
  /** 整面牆可以換的路線、目前第幾條、起攀／完攀標籤文字 */
  setRoutes(routes: ArRoute[], index?: number, labels?: { s?: string; t?: string } | null): void;
  /** 拖到相鄰路線的比例 -1..1（正＝下一條）：這條變淡、下一條浮現 */
  setDrag(p: number): void;
  /** 換到第 index 條：舊的淡出，新的照出手順序一顆顆鎖定 */
  showRoute(index: number, dir?: number): void;
  setShowOutlines(on: boolean): void;
  startSimulation(): void;
  stop(): void;
  report(): unknown;
}

/** 開始 AR 檢視（相機、追蹤 Worker、同一格落地的預覽與 AR 疊圖） */
export declare function createArView(options?: ArViewOptions): Promise<ArView>;
/** 載入失敗時顯示原因 */
export declare function showArViewError(err: unknown): void;

export interface ArOverlayHold { id: string; role: HoldRole | null; poly: number[][]; step?: number; color: string }
export interface ArOverlay {
  switchRoute(prevHolds: ArOverlayHold[], dir: number, now?: number): void;
  locked(now?: number): void;
  setDrag(p: number): void;
  readonly drag: number;
  animating(now?: number): boolean;
  draw(ctx: CanvasRenderingContext2D, opts: {
    stageW: number; stageH: number; dpr: number; M: number[];
    photo: { w: number; h: number };
    current: ArOverlayHold[]; neighbor?: ArOverlayHold[] | null;
    labels?: { s?: string; t?: string } | null; volumes?: Set<string>; seq?: string[] | null;
    source?: CanvasImageSource; now?: number;
  }): void;
}
/** AR 外觀的畫法（只負責畫）：G 是 Geometry */
export declare function createArOverlay(G: typeof Geometry, options?: { reducedMotion?: boolean }): ArOverlay;

export declare function mainCamera(devices: MediaDeviceInfo[]): MediaDeviceInfo | undefined;
/** 先問權限、再開主鏡頭（後置相機）；開到別顆就先關掉再開主鏡頭，不會兩顆同時開著 */
export declare function openMainCamera(
  open: (extra: MediaTrackConstraints) => Promise<MediaStream>,
  options?: { savedId?: string; enumerate?: () => Promise<MediaDeviceInfo[]>; timeoutMs?: number },
): Promise<{ stream: MediaStream; mainId: string }>;
export declare function cameraViewport(width: number, height: number, frameWidth: number, frameHeight: number): { x: number; y: number; width: number; height: number; visibleWidthFraction: number; visibleHeightFraction: number };
export declare function cameraConstraints(width: number, height: number): MediaTrackConstraints & { aspectRatio: { ideal: number } };
export declare function reversedCameraFrame(constraints: MediaTrackConstraints, width: number, height: number): boolean;
export declare function reverseCameraConstraints(constraints: MediaTrackConstraints): MediaTrackConstraints;
export declare function firstCameraFrame(video: HTMLVideoElement, timeoutMs?: number): Promise<{ width: number; height: number; [key: string]: unknown }>;
export declare function frameContentSummary(image: ImageData): { brightFraction: number; bounds: number[] | null; suspectedInset: boolean };

/** 追蹤紀錄（climbio-2d-tracking-log/1） */
export declare class TrackingLog2d {
  constructor(context: Record<string, unknown>);
  report(): unknown;
}

/** 單應矩陣、驗證、外推、牆面與路線解析 */
export declare const Geometry: {
  ROLE_COLORS: Record<HoldRole, string>;
  applyHomography(H: number[], x: number, y: number): [number, number] | null;
  invert3x3(m: number[]): number[] | null;
  mul3x3(a: number[], b: number[]): number[];
  extrapolateHomography(Hprev: number[], Hcurr: number[], alpha: number, refW?: number, refH?: number): number[] | null;
  parseRouteParam(raw: string | null): Map<string, HoldRole>;
  [name: string]: unknown;
};
/** 追蹤 Worker 的網址 */
export declare const trackerWorkerUrl: string;
