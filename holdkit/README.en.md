# holdkit

中文：[README.md](README.md)

## 1. Purpose

Hold-stage analysis for climbing walls: detection box to hold outline, MobileSAM outline refinement, color names, suggested crop. The hold pack format ([SPEC.md](SPEC.md)) lives here too.

- **Use it when**: you have hold detection boxes (`[x0, y0, x1, y1]` in photo pixels) and need hold outlines (`poly`), color names, or a suggested crop; or you want to host your own MobileSAM refinement service.
- **Do not use it for**: photo to detection boxes (that is `holdscan/`, AGPL-3.0; holdkit neither contains nor calls it), drawing routes (`routekit/`), or general image processing.

## 2. License and dependency rules

- AGPL-3.0 (`LICENSE`). Third-party components (MobileSAM, Acly's ONNX export, ONNX Runtime): see `NOTICE`, `models/README.md`, `models/LICENSE-MobileSAM`.
- May import: browser / Node built-ins and files in this folder. `holdkit.js` has no dependencies at all.
- Must not import: `holdscan/` or the app's `js/` (AGPL-3.0), or other kits (kits are independent).
- No app `state`, no DOM element ids, no branding; photos, boxes and outlines are passed in as arguments.
- `functions/` (the cloud refinement service) has its own `package.json` and dependencies (express, onnxruntime-node, sharp, ...) and is not part of the npm package.

## 3. File map

| Path | Responsibility |
|---|---|
| `holdkit.js` | Analysis functions: outlines, colors, crop suggestion. UMD: browser global `HoldKit`, Node `require` |
| `index.mjs`, `index.d.ts` | ESM entry (named exports identical to `holdkit.js`) and types |
| `samrefine.js`, `samrefine.d.ts` | Browser-only MobileSAM refinement (global `HoldRefiner`); has side effects on load |
| `samworker.js` | Worker running the MobileSAM decoder (CPU) |
| `ort.js` | Loads onnxruntime-web from jsDelivr after checking SRI hashes; Workers call `importScripts` then `await loadOrt()` |
| `models/` | `mobilesam-decoder.onnx` (16 MB, downloaded by the browser), `mobilesam-encoder.onnx` (28 MB, used by the cloud; downloaded by the browser when there is no cloud), `README.md`, `LICENSE-MobileSAM` |
| `functions/` | Cloud refinement `retrace`: `handler.js` (platform independent), `index.js` (Firebase), `server.js` (plain Node server), `sam.js`, `decode.js` |
| `Dockerfile` | Container image for `server.js` |
| `SPEC.md` | Hold pack v2 format |

The npm package (`@climbio/holdkit`) ships these `files`: `holdkit.js`, `index.mjs`, `index.d.ts`, `samrefine.js`, `samrefine.d.ts`, `samworker.js`, `ort.js`, `models/mobilesam-decoder.onnx`, `models/mobilesam-encoder.onnx`, `models/README.md`, `models/LICENSE-MobileSAM`, `SPEC.md`, `README.md`, `README.en.md`, `LICENSE`, `NOTICE`. `functions/` is not included.

## 4. Public API

All coordinates are photo pixels; an outline `poly` is `[[x, y], ...]`.

### 4.1 `HoldKit` (`holdkit.js`; `import HoldKit from '@climbio/holdkit'` or named imports)

| Name | Signature | Notes |
|---|---|---|
| `VERSION` | `string` | Matches the `package.json` version (currently `1.9.0`) |
| `SAME_DE` | `number` | Color-difference threshold for "same color" selection, 14 |
| `COLOR` | `Record<string, [r, g, b]>` | Color name to representative RGB. Keys are Chinese: 白 (white), 灰 (gray), 黑 (black), 黃 (yellow), 橙 (orange), 紅 (red), 粉 (pink), 紫 (purple), 藍 (blue), 蒂芬妮 (teal), 綠 (green); callers translate for display |
| `bbox(poly)` | `{ x0, y0, x1, y1 }` | Bounding box of an outline |
| `centroid(poly)` | `[x, y]` | Mean of the vertices (not the area centroid) |
| `tracePoly(ctx, poly)` | `void` | `moveTo` / `lineTo` / `closePath` on a Canvas 2D context; does not `beginPath` or fill |
| `simplifyPoly(poly)` | `Poly` | Merges vertices closer than 8% of the hold size, then Douglas-Peucker (deviation under 3.5%); polys with 4 points or fewer are returned as is |
| `toLab(data, n)` | `Float32Array` (3 numbers per pixel) | RGBA pixels to Lab; the returned **L is multiplied by 0.5** |
| `repColor(lab, n, use)` | `[L, a, b] \| 0` | Median of the more saturated half of the pixels where `use(pixelIndex)` is true; returns integers with **L restored to the true value**; returns `0` when fewer than 3 pixels qualify |
| `colorName([L, a, b])` | `string` | Representative color to a `COLOR` key. L must be the true value, so multiply `toLab` output by 2 |
| `analysis(img, W, H, createCanvas?)` | `{ data, w, h, s }` | Analysis thumbnail: long edge at most 1200, `s` = thumbnail / photo. `img` is a `CanvasImageSource`. The default canvas is `document.createElement('canvas')`, or `OffscreenCanvas` without `document`; in Node pass `createCanvas` (e.g. node-canvas), or build an object of the same shape yourself |
| `outlineContext(ana, boxes)` | `OutlineContext` | Whole-image Lab (computed once and cached on `ana.lab`) plus per-pixel box coverage; share one per photo |
| `boxToPoly(x0, y0, x1, y1, ctx)` | `Poly` | Detection box to outline (convex hull, coordinates rounded to 1 decimal). Does not throw: when the box is under 5 px on the thumbnail, fewer than 30 hold pixels are found, or the largest region is under 10% of the box, it returns the inscribed ellipse (20 points, 90% radius) |
| `cropSuggest(boxes, W, H)` | `{ x, y, w, h } \| null` | Suggested crop (the wall area). `null` for fewer than 30 boxes; uses only boxes with score `boxes[i][4]` >= 0.4 when there are at least 10 of them, otherwise all boxes; takes the 2% / 98% quantiles per side, then pads 4% of the photo width / height |

Types (`index.d.ts`): `Point`, `Poly`, `DetectBox` (`[x0, y0, x1, y1, ...number[]]`), `Lab`, `HoldPackHold`, `HoldPack`, `Analysis`, `OutlineContext`.

### 4.2 `HoldRefiner` (`samrefine.js`, browser only; `import '@climbio/holdkit/samrefine.js'`)

Attaches to `globalThis.HoldRefiner` on load (a Node `require` does not throw, but it is unusable without a DOM).

| Name | Signature | Notes |
|---|---|---|
| `configure(cfg)` | returns the current config | Call before first use. `t(key, ...args)` message translator (built-in English if omitted); `db` IndexedDB name (default `holdkit-sam`); `cloudUrl` (a URL, or a function returning one; empty means no cloud this time), `idToken(forceRefresh?)`, `appCheck(forceRefresh?)` for cloud refinement; `base` URL of the holdkit folder (where `samworker.js` and `ort.js` live; defaults to the folder of the `<script>` that loaded `samrefine.js`, required when imported through a bundler); `decoder`, `encoder` model URLs (default `models/mobilesam-decoder.onnx`, `models/mobilesam-encoder.onnx` under `base`); `modelCache` Cache API name (models are stored only after a complete download and read first next time) |
| `traceWall(src, key, items, status?, { onHolds?, localFallback? })` | `Promise<{ id, poly \| null }[]>` | Refines a whole wall: in the cloud when there is one; otherwise (empty `cloudUrl`, no `idToken`, or the cloud still failing after retries, e.g. over quota) the Worker downloads the encoder (once), analyzes the photo and decodes hold by hold. `localFallback: false`: when there is a cloud and it fails, throw instead of tracing the whole wall on this device (an empty `items` still analyzes the photo here). A `key` whose cloud call failed is not sent to the cloud again while the page stays open (`traceWall` and `refine` analyze the photo on this device; a whole-wall trace with `localFallback: false` throws `samCloudFailed`); `forget(key)`, `clear()` or a reload tries the cloud again. `src` is a canvas / image / ImageBitmap; `key` identifies the photo (e.g. the wall id; the photo features are stored in IndexedDB under it); `items` = `[{ id, poly, box? }]` (`box` is the prompt box, defaulting to the bounds of `poly`; an empty array means "features only"). With the cloud the photo is uploaded as a JPEG with its long edge scaled to 1024; `onHolds(part)` receives a batch every 0.3 s; resolves only when everything is traced, with `poly: null` for holds that could not be cut out |
| `refine(src, key, poly, status?, { box?, point? })` | `Promise<Poly \| null>` | Refines one hold (Worker, decoder only). The prompt is the bounds of `poly`, or `box`, or `point: [x, y]` (for a hold the detector missed; pass `null` for `poly`). If the photo has no stored features it asks the cloud first. The same photo and same prompt share one Promise. One hold at a time, queued in order |
| `warm()` | `void` | Downloads and loads the decoder, then the encoder (for analyzing photos locally when the cloud is unavailable), in the background; never throws |
| `hasEmb(key)` | `Promise<boolean>` | Whether features for this photo are stored |
| `forget(key)` | `Promise<void>` | Deletes one photo's features |
| `clear()` | `Promise<void>` | Deletes all of them |
| `stats` | object | `download`, `load`, `decode` (latest), `decodes`, `cloud` (cloud timings) |

`status(text, progress)`: `progress` is 0 to 1 or `null`; reported while downloading the model and while waiting for features from the cloud.

Errors (`Error.message`):
- `HoldRefiner: base not configured`: `base` could not be determined.
- Offline: with the cloud, `traceWall` throws the `samOffline` message and sends nothing when `navigator.onLine === false`.
- `retrace: stream cut`, `retrace: no embedding`, `retrace: bad embedding`: the cloud response was incomplete or malformed.
- HTTP failures are thrown as `HTTP <status>` errors. `traceWall` refreshes the token once on 401 and resends; the daily quota (429 `{ "error": "quota" }`) is not retried and throws the `samQuota` message; other failures (including other 429s, 500, a cut stream) are retried up to 3 times (3, 6, 12 s apart); `HTTP 400`, `401` and `413` are not retried; holds already traced are not resent. A single request times out after 290 s.
- Decoder timeout: the `samTimeout` message.

Side effects: writes IndexedDB (int8 photo features, about 1 MB per photo), creates a Worker, downloads models, calls `fetch` on `cloudUrl` when using the cloud.

### 4.3 Cloud refinement HTTP interface (`functions/`)

`POST <cloudUrl>`

- Headers: the Firebase build (`index.js`) verifies `X-Firebase-AppCheck` and rate-limits by hashed network origin; it does not require an account token. For self-hosted `AUTH=key`, send `Authorization: Bearer <API_KEY>`. 
- Body: `{ "img": "<JPEG base64, long edge 1024>", "holds": [{ "id", "box": [x0, y0, x1, y1], "c": [cx, cy] }] }` (coordinates are in the uploaded photo; `holds` may be empty; at most 3000 holds; request limit about 6 MB).
- Response: `{ "holds": [{ "id", "poly" }], "emb": { "q": "<base64, 256x64x64 uint8>", "lo": [256], "sc": [256], "w", "h" }, "ms": {...} }`; each channel is `lo + q * sc` (int8 quantization).
- `Accept: application/x-ndjson`: one JSON per line, first `{ "emb" }`, then a batch `{ "holds": [...] }` every 0.3 s, finally `{ "ms" }`; an error mid-stream is `{ "error" }`, and a missing final line means the stream was cut. `HoldRefiner.traceWall` uses this.
- Status codes: 401 not signed in, 429 daily quota exceeded (Firebase build: 30 per account per day, `{ "error": "quota" }`), 400 bad request, 413 photo too large, 405 method other than GET / POST / OPTIONS, 500 refinement failed.
- `GET` on the same URL warms the instance and returns 204 (no data, no auth).
- Photos are processed in memory only; never stored or logged.

Self-hosting (`functions/server.js`, no Firebase needed; at least 4 GB RAM):

```bash
docker build -t holdkit-retrace .
docker run -p 8080:8080 -e API_KEY=your-secret -e ORIGINS=https://your-site holdkit-retrace
# Without Docker: cd functions && npm install && API_KEY=your-secret node server.js
```

| Environment variable | Meaning |
|---|---|
| `AUTH` | `key` (default; `Authorization: Bearer` must equal `API_KEY`), `firebase` (ID token) or `none` (local or private network only) |
| `API_KEY` | Secret for `AUTH=key` |
| `ORIGINS` | Sites allowed to call cross-origin, comma separated; `*` allows all |
| `SAM_CPUS` | Encoder threads and decode Workers; set to the vCPUs you have (default 8) |
| `PORT` | Default 8080 |

On the app side, set `cloudUrl` in `configure` to your endpoint. The Firebase build uses App Check and a 30-requests-per-network-origin daily quota (`functions/retrace-auth.js`); separately deployed `AUTH=key` servers use their configured credentials.

## 5. Data format and invariants

Hold pack v2 (full spec in `SPEC.md`):

```json
{ "w": 4032, "h": 3024, "thumb": "data:image/jpeg;base64,…",
  "holds": [ { "id": "h12", "poly": [[812.5, 640.1], [850, 652.3], [838.2, 700]], "source": "detect", "t": 1760000000000 } ] }
```

- Coordinates are full-size photo pixels with the origin at the top-left; `w` and `h` are the photo size; `thumb` is a `data:image/...` URL with a 480 px long edge and may be an empty string.
- `holds[].id`: a string unique within the wall (routes refer to holds by it); `poly`: at least 3 points, at most 1 decimal; `source`: `detect`, `edited` or `manual`; `t`: last-modified milliseconds, optional.
- The outline is the hold: when displaying a route the whole outline keeps the photo's own colors, with no per-pixel hold test.
- Readers ignore fields they do not know; bump the version when a field's meaning or the structure changes.
- Lab: the L from `toLab` is halved (shadows and highlights are less likely to count as different colors); the output of `repColor` and the input of `colorName` use the true L.
- Photo features (`emb`) are stored one per photo in IndexedDB under the caller's `key`; their `w` and `h` must match the photo thumbnail size used for refinement, otherwise they are treated as corrupt.

## 6. Minimal runnable example

Node (ESM; no canvas needed because the analysis thumbnail is built by hand; after `npm install @climbio/holdkit` save as `demo.mjs` and run `node demo.mjs`; expected output `12 紅 null`):

```js
import HoldKit from '@climbio/holdkit';

const W = 200, H = 200, data = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const inside = (x - 100) ** 2 + (y - 100) ** 2 < 40 ** 2;
  data.set(inside ? [205, 30, 40, 255] : [200, 200, 195, 255], (y * W + x) * 4);   // red hold on a gray wall
}
const ana = { data, w: W, h: H, s: 1 };
const box = [55, 55, 145, 145];
const ctx = HoldKit.outlineContext(ana, [box]);
const poly = HoldKit.simplifyPoly(HoldKit.boxToPoly(...box, ctx));
const lab = HoldKit.toLab([205, 30, 40, 255], 1);
console.log(poly.length, HoldKit.colorName([lab[0] * 2, lab[1], lab[2]]), HoldKit.cropSuggest([box], W, H));
```

Browser (put the package folder on your site; `analysis` takes a canvas):

```html
<script src="holdkit/holdkit.js"></script>
<script src="holdkit/samrefine.js"></script>
<script>
  const ana = HoldKit.analysis(photoCanvas, W, H);
  const octx = HoldKit.outlineContext(ana, boxes);
  const holds = boxes.map(([x0, y0, x1, y1], i) => ({ id: `h${i}`, source: 'detect',
    poly: HoldKit.simplifyPoly(HoldKit.boxToPoly(x0, y0, x1, y1, octx)) }));

  // Optional: MobileSAM refinement (needs a refinement service at cloudUrl)
  HoldRefiner.configure({ base: '/holdkit/', cloudUrl: RETRACE_URL, idToken: () => token });
  const res = await HoldRefiner.traceWall(photoCanvas, 'wall-1', holds.map((h, i) => ({ id: h.id, poly: h.poly, box: boxes[i] })),
    undefined, { onHolds: (part) => draw(part) });
  const one = await HoldRefiner.refine(photoCanvas, 'wall-1', holds[0].poly);
</script>
```

## 7. Limits and known trade-offs

- **Canvas**: `analysis` needs a canvas (browser `<canvas>`, Worker `OffscreenCanvas`, Node's node-canvas, or a hand-built object); `boxToPoly` and the rest are pure computation.
- **MobileSAM refinement is optional**: the Worker (`samworker.js`), the ORT loader (`ort.js`, which loads onnxruntime-web from jsDelivr and needs network access) and the decoder model must all be served from your site (`configure({ base })`); the photo features must be produced by a refinement service (host `functions/` yourself or use Climbio's cloud). Without one, do not call `HoldRefiner`; outlines still work.
- Decoding is CPU only (phone GPUs gave wrong results in testing); one hold at a time, queued.
- Browser vs Node: `samrefine.js` works in the browser only (needs `document`, `Worker`, IndexedDB); `holdkit.js` runs in both.
- `boxToPoly` falls back to an ellipse for low-contrast boxes where the hold matches the wall color; whether to re-run recognition is the app's call (results are fixed per version; a changed algorithm changes results across versions).
- The models exceed jsDelivr's per-file limit, so the app downloads the whole folder by git tag (`v1.x.x`) instead of using a CDN.

## 8. Verification

| Check | Command |
|---|---|
| Package exports consistent (ESM named exports equal CJS, type file declares every export, files listed in `files` exist, versions match, server-side load does not break) | `node --test tools/kit-packages.test.mjs` |
| Crop suggestion | `node --test tools/crop-suggest.test.mjs` |
| Refinement preload (`sam-preload`) | `node --test tools/sam-preload.test.mjs` |
| External page: install the package only, outlines, suggested crop, color (needs a Playwright browser) | internal e2e cases |
| All quick checks | `node tools/check.mjs && node --test tools/*.test.mjs` |
