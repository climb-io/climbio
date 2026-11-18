// @climbio/crag3dkit 的型別。座標是模型的 [x, y, z]（公尺，y 朝上）；資料是 Climbio 公開格式 v2（@climbio/format）的檔案，欄位見 format/VOCABULARY.md 的「3D 岩場」。
// English: types for @climbio/crag3dkit. Coordinates are model [x, y, z] in metres (y up); data are Climbio format v2 documents.

export type Vec3 = [number, number, number];
export type Name = string | Record<string, string>;

export interface Camera {
  position: Vec3;
  target: Vec3;
  /** 垂直視角（度） */
  fov: number;
}

/** v2 的節點（只列用到的欄位） */
export interface Node {
  id: string;
  type: string;
  name?: Name;
  parent?: string;
  props?: Record<string, unknown>;
  [key: string]: unknown;
}

/** 模型上路線的標註：座標是模型的 [x, y, z]，props.sight 是這條路線的遮擋表（base64） */
export interface Mark {
  node?: string;
  geometry: { type: 'LineString'; coordinates: Vec3[] };
  props?: { label?: string | number; sight?: string; style?: { stroke?: string; [key: string]: unknown }; [key: string]: unknown };
}

/** 遮擋表的規格（圖層的 props.sight） */
export interface SightSpec {
  /** 路線點的間距（公尺） */
  step: number;
  /** 方位角格數 */
  az: number;
  /** [起始仰角（度）, 每格度數, 格數] */
  el: [number, number, number];
  /** 距離上限（公尺） */
  dist: number[];
}

/** 一個 v2 檔案（組合、畫面、圖層），只列 readCrag3d 用到的欄位 */
export interface Doc {
  id: string;
  kind: 'set' | 'view' | 'layer';
  surface?: string;
  on?: string;
  w?: number;
  h?: number;
  items?: { id?: string; href?: string }[];
  nodes?: Node[];
  marks?: Mark[];
  props?: Record<string, any>;
  [key: string]: unknown;
}

export interface Area {
  /** 岩壁節點的 id */
  id: string;
  name?: string;
  camera: Camera;
  /** 快照的寬／高 */
  aspect: number;
  /** 這面岩壁的路線節點 id */
  routes: Set<string>;
  /** 這面岩壁的快照（照片畫面） */
  snapshot: Doc;
}

export interface Crag3D {
  model: Doc;
  layers: Doc[];
  marks: Mark[];
  sight?: SightSpec;
  nodes: Node[];
  owners: Doc[];
  areas: Area[];
  overview?: Doc;
}

/** Topo 都是同一個模型的快照時回傳那個模型畫面的 id，否則 null */
export function sharedModelId(views: Doc[]): string | null;
/** 從這個岩場所有的檔案找出 modelId 這個模型和播放需要的東西；找不到模型畫面回 null */
export function readCrag3d(docs: Iterable<Doc>, modelId: string, options?: { lang?: string }): Crag3D | null;

/** 遮擋表：base64 的 deflate（raw）→ 每個點 az×el 個 4 位元的值 */
export function readSight(b64: string): Promise<Uint8Array>;
/** 路線的每個點，從 from 看得到嗎 */
export function routeVisibility(options: { table?: Uint8Array | null; spec?: SightSpec | null; pts: Vec3[]; from: Vec3; fill?: number; out?: Uint8Array }): { vis: Uint8Array; seen: number };

export function pickName(name: Name | undefined, lang?: string): string | undefined;
export function pickGrade(grade: string | Record<string, unknown> | undefined, systems?: string[]): string | undefined;

export const CSS: string;
export function injectStyle(host: Element): void;

export interface MountOptions {
  /** 模型檔網址（.spz 或 .glb），或還在讀的 Promise */
  url: string | Promise<string>;
  mime?: string;
  /** 背景模型（網格加潑濺背景時的潑濺），網址或 Promise */
  background?: string | Promise<string>;
  marks: Mark[];
  sight?: SightSpec;
  nodes: Node[];
  /** 照岩壁順序 */
  areas: { id: string; name?: string; camera: Camera; aspect: number; routes: Set<string> }[];
  /** 打開第幾面（預設 0） */
  start?: number;
  /** 第一次進這個岩場：全區快照拍的鏡頭，模型好了從那裡飛進 start 那一面 */
  intro?: { camera: Camera; aspect: number } | null;
  /** 開場快照的網址：模型畫好前先鋪著 */
  poster: string;
  /** 背景漸層 [上, 地平線, 地面] */
  sky?: [string, string, string?];
  onPick?: (routeId: string | null) => void;
  /** 目前最近的是第幾面（連續的數字，四捨五入） */
  onArea?: (index: number) => void;
}

export interface Crag3DPlayer {
  /** 亮起一條路線（null 取消） */
  highlight(routeId?: string | null): void;
  /** 沿著岩壁走到第幾面 */
  go(index: number): void;
  /** 走到一條路線前面，到了才 onPick */
  route(routeId: string): void;
  /** 沿著岩壁往前（1）或後（-1）走一段 */
  walk(steps: number): void;
  /** 目前最近的是第幾面 */
  area(): number;
  /** 開場快照在畫面上的位置（卡片放大到這裡） */
  posterRect(): { left: number; top: number; width: number; height: number } | null;
  destroy(): void;
}

/** host 裡畫一個 3D 岩場；快照鋪好就回傳，模型在背景載入 */
export function mountCrag3d(host: HTMLElement, options: MountOptions): Promise<Crag3DPlayer>;
