export interface DigitTemplate { aspect: number; cells: string }
/** 數字樣板（16x24 格，每格 0～f 灰階）；測試用。 */
export const DIGIT_CELLS: Record<number, DigitTemplate>;
/** 讀一個號碼牌上的白色號碼：牌子中心 (cx, cy)、邊長 size；沒有字或字太小回傳空字串。 */
export function readBadgeText(image: { data: Uint8ClampedArray | Uint8Array; width: number; height: number }, cx: number, cy: number, size: number): string;
