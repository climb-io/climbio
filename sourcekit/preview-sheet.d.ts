export * from './preview-layout.js';
export interface Sheet { canvas: OffscreenCanvas; g: OffscreenCanvasRenderingContext2D }
/** 照片填滿 (x, y, w, h)、多的裁掉（置中）。 */
export function drawFit(g: OffscreenCanvasRenderingContext2D, bmp: ImageBitmap, x: number, y: number, w: number, h: number): void;
/** n 張照片的預覽圖空白畫布（底色已塗）。 */
export function newSheet(n: number): Sheet;
/** 第 i 張照片畫上去（第 0 張也畫入口照片）。 */
export function paintSheet(sheet: Pick<Sheet, 'g'>, i: number, bmp: ImageBitmap): void;
/** 依序解開照片 Blob，輸出預覽圖 JPEG。 */
export function buildSheet(blobs: Blob[], quality?: number): Promise<Blob>;
/** 預覽圖上半（入口照片）裁成一張 JPEG。 */
export function cropCover(blob: Blob, preview: { w: number; tile: { y: number } }, quality?: number): Promise<Blob>;
