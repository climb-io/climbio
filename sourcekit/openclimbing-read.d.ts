export type Get = (url: string, signal?: AbortSignal) => Promise<any>;
export type OsmElement = { id: number; type?: string; tags?: Record<string, string>; members?: { type: string; ref: number; role?: string }[]; [key: string]: unknown };
export interface CommonsPhoto { url: string; w: number; h: number; mime: string; spdx: string; page: string; artist: string }
export interface OpenClimbingUnit {
  hierarchy: { id: string; name: string; url: string }[];
  rel: OsmElement;
  kind: 'area' | 'crag';
  name: string;
  routes: OsmElement[];
  views: { title: string; info: CommonsPhoto; lines: { node: OsmElement; points: [number, number][] }[] }[];
  topos: number;
}
/** 判斷網址是否為 OpenClimbing 或 OSM 的 relation。 */
export function isOpenClimbing(url: string): boolean;
/** 解析網址，得到 { type, id }；解析不了回傳 null。 */
export function parseUrl(url: string): { type: string; id: number } | null;
/** 路線節點 tags 裡的 Commons 照片（title、path）。 */
export function photosOf(tags?: Record<string, string>): { title: string; path?: string }[];
/** OpenClimbing 的路線 path 字串轉成 0～1 的點；格式不對回傳空陣列。 */
export function parsePath(path?: string): [number, number][];
/** Commons 授權名稱轉 SPDX；只收 CC 與公眾領域，其他回傳 null。 */
export function spdxOf(name?: string): string | null;
export function commonsInfo(titles: string[], get?: Get, signal?: AbortSignal): Promise<{ info: Map<string, CommonsPhoto>; skipped: number }>;
/** 讀取 OpenClimbing／OSM 岩場及其成員路線與照片；keepEmpty 為真時沒有 Topo 的岩場也保留。 */
export function loadUnits(url: string, options?: { get?: Get; signal?: AbortSignal; keepEmpty?: boolean }): Promise<{ root: { type: string; id: number; name: string; rel: OsmElement }; units: OpenClimbingUnit[]; skipped: number }>;
/** 路線節點 tags 轉成 props（grade、length、style、description）。 */
export function routeProps(tags: Record<string, string>): { grade?: Record<string, string>; length?: number; style?: string; description?: string };
