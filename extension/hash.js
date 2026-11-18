import { sha256 } from './sourcekit/pool.js';

// 內容指紋：文字的 SHA-256 取前 12 個位元組（24 個十六進位字元）。重複收藏時只比這一個值，一樣就什麼都不用做。
export const sha24 = async (text) => (await sha256(new TextEncoder().encode(text))).slice(0, 24);
