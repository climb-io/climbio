// holdkit 的型別。座標都是照片像素；外框 poly＝[[x, y], …]。岩點資料包格式見 SPEC.md。
// English: holdkit type definitions. Coordinates are photo pixels; hold pack format in SPEC.md.

export type Point = [number, number];
export type Poly = Point[];
/** 偵測框 [x0, y0, x1, y1]（可以多帶分數） */
export type DetectBox = [number, number, number, number, ...number[]];
export type Lab = [number, number, number];
export interface HoldPackHold { id: string; poly: Poly; source: 'detect' | 'edited' | 'manual'; t?: number; [key: string]: unknown }
/** 岩點資料包 v2 */
export interface HoldPack { w: number; h: number; thumb: string; holds: HoldPackHold[]; [key: string]: unknown }
/** 分析用縮圖：RGBA 像素、大小、縮放比例（照片 × s＝縮圖） */
export interface Analysis { data: Uint8ClampedArray | Uint8Array; w: number; h: number; s: number }
export interface OutlineContext { [key: string]: unknown }
type AnyCanvas = { getContext(type: '2d'): any };

export const VERSION: string;
/** 同色判斷的 ΔE 門檻 */
export const SAME_DE: number;
/** 顏色名稱 → RGB */
export const COLOR: Record<string, [number, number, number]>;
export function bbox(poly: Poly): { x0: number; y0: number; x1: number; y1: number };
export function centroid(poly: Poly): Point;
export function tracePoly(c: CanvasRenderingContext2D, poly: Poly): void;
export function simplifyPoly(poly: Poly): Poly;
export function toLab(data: ArrayLike<number>, n: number): Float32Array;
/** 代表色；用到的像素不到 3 個回傳 0 */
export function repColor(lab: ArrayLike<number>, n: number, use: (pixel: number) => boolean): Lab | 0;
export function colorName(lab: Lab): string;
/** img：照片（瀏覽器的 img／canvas；Node 傳 createCanvas，或直接自己組 Analysis） */
export function analysis(img: CanvasImageSource | unknown, W: number, H: number, createCanvas?: (w: number, h: number) => AnyCanvas): Analysis;
export function outlineContext(ana: Analysis, boxes: DetectBox[]): OutlineContext;
/** 偵測框 → 岩點外框（凸包；失敗時是框的內切橢圓） */
export function boxToPoly(x0: number, y0: number, x1: number, y1: number, ctx: OutlineContext): Poly;
/** 偵測框 → 建議的裁切範圍（照片像素）；偵測不到 30 顆是 null */
export function cropSuggest(boxes: DetectBox[], W: number, H: number): { x: number; y: number; w: number; h: number } | null;

declare const HoldKit: {
  VERSION: typeof VERSION; SAME_DE: typeof SAME_DE; COLOR: typeof COLOR;
  bbox: typeof bbox; centroid: typeof centroid; tracePoly: typeof tracePoly; simplifyPoly: typeof simplifyPoly;
  toLab: typeof toLab; repColor: typeof repColor; colorName: typeof colorName;
  analysis: typeof analysis; outlineContext: typeof outlineContext; boxToPoly: typeof boxToPoly; cropSuggest: typeof cropSuggest;
};
export default HoldKit;
