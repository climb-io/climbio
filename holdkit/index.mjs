// holdkit 的 ESM 入口（import），內容同 holdkit.js。MobileSAM 重描（samrefine.js）只在瀏覽器用，另外 import '@climbio/holdkit/samrefine.js'。
// English: holdkit ESM entry, same as holdkit.js. The browser-only MobileSAM refiner is a separate import.
import HoldKit from './holdkit.js';
export default HoldKit;
export const {
  VERSION, SAME_DE, COLOR, cropSuggest,
  bbox, centroid, tracePoly, simplifyPoly,
  toLab, repColor, colorName,
  analysis, outlineContext, boxToPoly,
} = HoldKit;
