// 外部資料來源的 id：同樣的來源字串永遠得到同樣的 16 碼 id（cyrb53 加兩個 seed），再存一次就是更新同一份。
// 擴充功能和紅點貓都要從同一個來源算出同一個 id（例如同一個 OSM 岩場），所以算法只放這一份，不要各寫一個。
// English: deterministic ids for imported sources; the same source string gives the same id in the extension and in the app.

/** cyrb53：字串 → 53 位元的整數；seed 不同就是不同的雜湊 */
const h53 = (s, seed) => {
  let a = 0xdeadbeef ^ seed, b = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677); }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return 4294967296 * (2097151 & b) + (a >>> 0);
};

/** 來源字串（例如 `osm:relation:123`）→ 16 碼小寫英數 id */
export const idOf = (seed) => (h53(seed, 1).toString(36).padStart(11, '0') + h53(seed, 2).toString(36).padStart(11, '0')).slice(0, 16);
