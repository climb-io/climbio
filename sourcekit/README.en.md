# sourcekit (@climbio/sourcekit)

English | [繁體中文](README.md)

## 1. Purpose

Pure helpers shared by external data sources (sites, browser extensions, importers): the topo photo size policy, the composite preview-image layout and canvas code, source ids, route tracing and number-badge reading on topo photos, and reading from OpenClimbing / OSM / Wikimedia Commons.

- Use it to: convert an external site's crag into Climbio format v2 (see [format/](../format/README.en.md)), extract route lines from a topo photo, or compute an id that is identical in the extension and in the app for the same source.
- Do not use it to: read, write or validate Climbio files (use `format/`), or draw routes inside the app (use `routekit/`).

## 2. License and dependency rules

- License: AGPL-3.0 (`LICENSE`, `NOTICE`). The digit templates in `badge-digits.js`: 0 and 2-9 are Liberation Sans Bold glyphs (SIL OFL 1.1, Copyright Red Hat, Inc.) shrunk to a 16x24 grid; 1 is an average taken from guidebook number badges. No other third-party code, models or data.
- No dependencies, no build step; ESM (`"type": "module"`).
- May import only files in this folder and standard browser/Node globals. Must not import or reference AGPL code (the app's `js/`, `holdscan/`), products (`studio/`, `redpoint/`, `extension/`), Climbio's backend, or other kits.
- Copied elsewhere: `tools/sync-extension.mjs` copies every `.js` in this folder into `extension/sourcekit/` (an extension packaged as a ZIP cannot import from outside), prepending a one-line "this is a copy" banner. **After changing `sourcekit/`, run `node tools/sync-extension.mjs`**; never edit `extension/sourcekit/` directly. `node tools/sync-extension.mjs --check` only checks whether they are in sync.
- `index.js` re-exports only the pure-computation parts (`photo-size`, `preview-layout`, `trace`, `ids`); `preview-sheet.js` (needs a canvas), `openclimbing-read.js` (does network) and `badge-digits.js` are imported individually.

## 3. File map

| File | Responsibility |
|---|---|
| `index.js` | Re-exports `photo-size`, `preview-layout`, `trace`, `ids` |
| `index.d.ts` | Types: re-exports `ids`, `photo-size`, `preview-layout`, `trace` |
| `ids.js`, `ids.d.ts` | Source string to 16-character id (`idOf`) |
| `pool.js` | `pool(items, n, work)` concurrency pool and `sha256`; also used by the browser extension |
| `photo-size.js`, `photo-size.d.ts` | Topo photo size policy: long-edge max, min, resizing (`fitSize`, `fitImage`, ...) |
| `preview-layout.js`, `preview-layout.d.ts` | Layout constants and position math for the composite `preview.jpg` (no canvas) |
| `preview-sheet.js`, `preview-sheet.d.ts` | Draws the preview with `OffscreenCanvas`, crops the cover photo; also re-exports `preview-layout.js` |
| `trace.js`, `trace.d.ts` | Route tracing: pixels (RGBA) to polylines, plus number-badge detection |
| `badge-digits.js`, `badge-digits.d.ts` | Template matching for the white digits 0-9 on number badges (`readBadgeText`, `DIGIT_CELLS`); used internally by `trace.js` |
| `openclimbing-read.js`, `openclimbing-read.d.ts` | Read-only OpenClimbing / OSM / Wikimedia Commons conversion: crags, routes, topo photos, lines |

## 4. Public API

### ids (`index.js`)

| Name | Signature | Description |
|---|---|---|
| `idOf` | `(seed: string) => string` | The same source string (for example `osm:relation:123`) always gives the same 16-character lowercase alphanumeric id (cyrb53 with two seeds). The extension and the app must compute identical ids, so the algorithm lives only here |

### photo-size (`index.js`)

| Name | Signature | Description |
|---|---|---|
| `TOPO_EDGE` | `number` = 1600 | Max long edge (px) of an external topo photo |
| `MIN_EDGE` | `number` = 800 | Min long edge; smaller images look blurry on a phone and are not collected |
| `COMMONS_REQUEST_WIDTH` | `number` = 1920 | Thumbnail width requested from Commons (Commons serves only standard widths) |
| `QUALITY` | `number` = 0.85 | JPEG quality of resized images |
| `fitSize` | `(w, h, edge = TOPO_EDGE) => { w, h }` | Shrinks the long edge to at most `edge`, never enlarges; returns the input as-is if width or height is not positive |
| `isUsableSize` | `(w, h) => boolean` | Whether the long edge is >= `MIN_EDGE`; missing values count as too small |
| `fitImage` | `(blob: Blob, { edge?, size? }?) => Promise<{ blob, w, h }>` | Resizes: shrinks if over the limit, converts non-JPEG/PNG to JPEG; with `size` it resizes to exactly that size. Needs `createImageBitmap` and `OffscreenCanvas`. Errors: rejects with the `createImageBitmap` error if the image cannot be decoded |

### preview-layout (`index.js`; also re-exported by `preview-sheet.js`)

| Name | Signature | Description |
|---|---|---|
| `PREVIEW` | `'preview.jpg'` | Preview file name |
| `PREVIEW_W`, `COVER_H`, `TILE_W`, `TILE_H`, `TILE_COLS` | `720`, `540`, `120`, `90`, `6` | Layout constants |
| `THUMB`, `THUMB_W`, `THUMB_H` | `'thumb.jpg'`, `240`, `180` | Thumbnail for world-map pins (cover photo only) |
| `COVER_RECT` | `{ x: 0, y: 0, w: 720, h: 540 }` | Cover photo position (top half) |
| `previewSize` | `(n) => { w, h }` | Preview image size for `n` photos |
| `previewProps` | `(n, href = PREVIEW) => PreviewProps` | A set's `props.preview`: `{ href, w, h, count, tile: { w, h, cols, y } }` |
| `tileRect` | `(i) => Rect` | Cell position of the `i`-th (from 0) small tile |

### preview-sheet (import `./preview-sheet.js` directly; needs `OffscreenCanvas`, `createImageBitmap`)

| Name | Signature | Description |
|---|---|---|
| `drawFit` | `(g, bmp, x, y, w, h) => void` | Fills the rectangle with the photo, cropping the excess (centered) |
| `newSheet` | `(n) => { canvas, g }` | Blank preview canvas for `n` photos (background painted) |
| `paintSheet` | `({ g }, i, bmp) => void` | Paints photo `i`; photo 0 also paints the cover |
| `buildSheet` | `(blobs: Blob[], quality = 0.8) => Promise<Blob>` | Decodes photos one at a time, in order, into a preview JPEG |
| `cropCover` | `(blob, preview, quality = 0.88) => Promise<Blob>` | Crops the top half of the preview (`preview.w` x `preview.tile.y`) into a cover JPEG |

### trace (`index.js`)

`image` is `{ data: Uint8ClampedArray | Uint8Array, width, height }` (RGBA; may be pre-shrunk to `TRACE_EDGE`). Output coordinates are multiplied by `scale` to return to the original photo. `expected` is the number of routes expected on the photo (0 means unknown).

| Name | Signature | Description |
|---|---|---|
| `TRACE_EDGE` | `number` = 1200 | Recommended long edge (px) to shrink to before tracing |
| `traceRed` | `(image, scale = 1, expected = 0) => TracedLine[]` | Red pen (plus yellow link lines); falls back to `tracePen` when no red is found or fewer lines than expected |
| `traceDiff` | `(annotated, original, scale = 1, expected = 0) => TracedLine[]` | Annotated photo minus the aligned original: any pen color, also finds bolts and anchors |
| `tracePen` | `(image, scale = 1, expected = 0, report?) => TracedLine[]` | Without an original: thin vivid lines of any color (white only as a fallback); pass an array as `report` to collect diagnostics |
| `traceDashes` | `(image, scale = 1, blocked = []) => TracedLine[]` | White dashed pen; `blocked` is regions to skip `[{ x, y, size }]` (for example number badges) |
| `traceBadges` | `(image, scale = 1) => { point, size, color, text }[]` | Number badges (flat rounded squares with a white number); `text` is the digit string read by template matching, left to right; not OCR |
| `traceTopo` | `(image, scale = 1, expected = 0) => { lines, badges }` | Lines plus badges; each badge is matched to the line whose start is nearest (`badge.line` is an index into `lines`, or `null`) |

`TracedLine = { points: [x, y][], bolts?: [x, y][], anchors?: [x, y][] }`: the start is at the bottom (the climb start); `bolts` run bottom to top, `anchors` left to right; for a route with only anchors marked, `points` is empty.

### badge-digits (import `./badge-digits.js` directly)

| Name | Signature | Description |
|---|---|---|
| `readBadgeText` | `(image, cx, cy, size) => string` | Reads the white digits on a badge (center `cx, cy`, edge `size`, same pixel coordinates); returns `''` if there are no digits or they are too small |
| `DIGIT_CELLS` | `Record<0..9, { aspect, cells }>` | Templates (hex strings of a 16x24 grayscale grid); for tests |

### openclimbing-read (import `./openclimbing-read.js` directly; needs `fetch`)

| Name | Signature | Description |
|---|---|---|
| `isOpenClimbing` | `(url) => boolean` | Whether it is an OpenClimbing / OSM node, way or relation URL, or `osm:relation:<id>` |
| `parseUrl` | `(url) => { type, id } \| null` | Parses a URL; returns `null` on failure, never throws |
| `photosOf` | `(tags) => { title, path }[]` | `wikimedia_commons` photos and line paths from OSM tags |
| `parsePath` | `(path) => [x, y][]` | OpenClimbing line string to points in 0..1; `[]` if any segment is invalid |
| `spdxOf` | `(name) => string \| null` | Commons license name to SPDX; only CC0, public domain, CC BY and CC BY-SA are recognized, otherwise `null` |
| `commonsInfo` | `(titles, get?, signal?) => Promise<{ info: Map, skipped: number }>` | Batch lookup of Commons photo URL, size (computed within `TOPO_EDGE`), license, author; unaccepted licenses count toward `skipped` |
| `loadUnits` | `(url, { get?, signal?, keepEmpty? }?) => Promise<{ root, units, skipped }>` | Reads a relation and the crags, routes and photos beneath it. Errors: throws `Error` (`guide: true`, message "這一頁不是岩場或區域", i.e. "this page is not a crag or area") if the URL is not a relation; throws `Error` if the relation is not found; throws `Error` on a non-2xx HTTP status. `get(url, signal)` defaults to `fetch` and can be injected for tests |
| `routeProps` | `(tags) => props` | OSM route tags to `grade`, `length`, `style`, `description` (absent fields are omitted) |

Side effects: apart from `fitImage`, `preview-sheet.js` (canvas) and `openclimbing-read.js` (network requests), everything is a pure function with no DOM and no storage.

## 5. Data format and invariants

- Source ids: the result of `idOf(seed)` fits the Climbio format file-id rule (16 characters of `[0-9a-z]`); a `seed` looks like `osm:relation:<id>`, and the caller must guarantee that the same source always gets the same string.
- Topo photos: long edge <= 1600 and >= 800; the `w` and `h` written in the document must equal the real image size (`fitImage`'s `size` exists to make the image match already-written coordinates).
- Preview layout: width 720; cover photo on top 720x540 (4:3); tiles below, each 120x90, 6 per row, starting at `y = 540`; a set's `props.preview` and a photo item's `props.tile` are described in `format/VOCABULARY.md`. A site build that uses its own image tool must draw at the positions from `tileRect`.
- Trace coordinates: `points`, `bolts` and `anchors` are original-photo pixels (already multiplied by `scale`), not 0..1.
- Licensed data: only CC0 / public domain / CC BY / CC BY-SA Commons photos are accepted; route data is ODbL (© OpenStreetMap contributors), so keep the attribution in the output.

## 6. Minimal runnable example

The pure-function part, runs on Node 18 or later (`npm install @climbio/sourcekit`, save as demo.mjs):

```js
import { idOf, fitSize, isUsableSize, previewProps, tileRect } from '@climbio/sourcekit';
import { parsePath, isOpenClimbing } from '@climbio/sourcekit/openclimbing-read.js';

console.log(idOf('osm:relation:123'));                  // 16 characters, always the same
console.log(fitSize(3200, 2400), isUsableSize(700, 500));   // { w: 1600, h: 1200 } false
console.log(previewProps(9), tileRect(7));              // preview info and the position of tile 7
console.log(isOpenClimbing('https://openclimbing.org/relation/123'));   // true
console.log(parsePath('0.2,0.9B|0.3,0.5|0.35,0.1A'));    // [[0.2,0.9],[0.3,0.5],[0.35,0.1]]
```

## 7. Limits and known trade-offs

- The pure computation runs in browsers and Node. `fitImage` and `preview-sheet.js` need `createImageBitmap` and `OffscreenCanvas` (available in pages and extension service workers, not in Node). `openclimbing-read.js` needs a global `fetch` (or pass your own `get`).
- Tracing is heuristic: red pen is the most reliable, and `traceDiff` with an original is the most accurate; `tracePen` (any color) can misfire on busy backgrounds. When `expected` is given the result never exceeds it. Have a user confirm the result; do not treat it as ground truth.
- Badge digits come from template matching, not OCR: on the 171 badges of the Hong Kong Climbing 2025 Miniguide, 91% of the digits read fell within that page's route numbers. Different fonts read poorly; the caller must cross-check against the route numbers on the page and discard the result if they do not match.
- `loadUnits` walks at most 400 relations; OSM batches are 500 ids and Commons batches 40 titles per request.
- `package.json` `exports` includes `"./*.js"`, so each file can be imported on its own; there is no `files` field, so npm packs the whole folder.

## 8. Verification

```bash
node --test tools/sourcekit.test.mjs tools/author-trace.test.mjs
node tools/sync-extension.mjs --check
```

- `tools/sourcekit.test.mjs`: `fitSize` and `TOPO_EDGE`, Commons thumbnail and size conversion, `extension/sourcekit` in sync with this folder, preview layout.
- `tools/author-trace.test.mjs`: `trace*` and badge reading.
- Extension tests that use sourcekit: `tools/extension-openclimbing.test.mjs`, `extension-thecrag.test.mjs`, `extension-hkclimbing.test.mjs`, `extension-climbio-site.test.mjs`.
- Run `npm run test:quick` once before committing (it covers the Node tests above and the syntax checks).
