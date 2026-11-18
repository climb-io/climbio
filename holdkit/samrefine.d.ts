// holdkit/samrefine.js（瀏覽器的 MobileSAM 重描，全域 HoldRefiner）的型別。
// English: types for the browser-only MobileSAM refiner (global HoldRefiner).
import type { Poly, DetectBox } from './index';

type Src = HTMLCanvasElement | HTMLImageElement | ImageBitmap;
type Status = (text: string, progress: number | null) => void;
export interface HoldRefinerConfig {
  t?: (key: string, ...args: unknown[]) => string;
  db?: string;
  cloudUrl?: string | null | (() => string | null | undefined);
  idToken?: (() => Promise<string> | string) | null;
  appCheck?: (() => Promise<string> | string) | null;
  /** holdkit 資料夾的網址（samworker.js、ort.js 所在） */
  base?: string | null;
  /** 解碼器模型的網址 */
  decoder?: string | null;
  encoder?: string | null;
  /** Cache API 的名稱：解碼器下載完整才存、下次先讀；不給就不存 */
  modelCache?: string | null;
}
export interface HoldRefiner {
  configure(cfg: HoldRefinerConfig): HoldRefinerConfig;
  traceWall(src: Src, key: string, items: { id: string; poly: Poly; box?: DetectBox }[], status?: Status, opts?: { onHolds?: (part: { id: string; poly: Poly | null }[]) => void }): Promise<{ id: string; poly: Poly | null }[]>;
  refine(src: Src, key: string, poly: Poly | null, status?: Status, opts?: { box?: DetectBox; point?: [number, number] }): Promise<Poly | null>;
  warm(): void;
  hasEmb(key: string): Promise<boolean>;
  forget(key: string): Promise<void>;
  clear(): Promise<void>;
  stats: Record<string, unknown>;
}
declare global { var HoldRefiner: HoldRefiner }
export {};
