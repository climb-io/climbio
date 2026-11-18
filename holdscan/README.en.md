# holdscan

中文：[README.md](README.md)

## 1. Purpose

Hold detection: photo to hold boxes `[x0, y0, x1, y1, score]`. Three ways to use it: the browser build (the model runs on the phone), an HTTP service (cloud or self-hosted), and an offline CLI (photo to hold pack).

- **Use it when**: you want to detect holds in a web page, host your own detection service, or analyze fixed wall photos offline into hold packs.
- **Do not use it for**: outline tracing, colors, MobileSAM refinement (that is `holdkit/`).

## 2. License and dependency rules

- **AGPL-3.0** (`LICENSE`, `NOTICE`): the detection model [jwlarocque/yolov8n-freeclimbs-detect-2](https://huggingface.co/jwlarocque/yolov8n-freeclimbs-detect-2) is fine-tuned from Ultralytics YOLOv8 and can only be used under AGPL-3.0 (see `models/README.md`). Under AGPL-3.0, if you serve a modified version over a network you must let users obtain your source (change the `source` in the response to your repo).
- This folder may read `holdkit/`; the reverse is not allowed: kits such as `holdkit/`, `routekit/` do not reference `holdscan/` or the app's `js/`, so each stays independent.
- Not an npm package (there is no root `package.json`); copy the files you need.
- Dependencies per part:
  - Browser build: `core/detect-core.js`, `holdkit/ort.js` (onnxruntime-web, loaded from jsDelivr after hash verification, so network access is required), the model.
  - Cloud / self-hosted service: `functions/package.json` (express, onnxruntime-node, sharp; the Firebase build also uses firebase-admin and firebase-functions).
  - CLI: `cli/package.json` (onnxruntime-node, sharp), plus the sibling `holdkit/`, `routekit/` and `functions/tidy.js` (the repo-root `functions/`).
- Hold data produced by the CLI is not covered by the AGPL.

## 3. File map

| Path | Responsibility |
|---|---|
| `core/detect-core.js` | Pre- and post-processing (score threshold, duplicate-box removal) shared by the cloud and browser builds; global `HoldDetectCore` (Worker) or `module.exports` (Node) |
| `browser/holdscan.js` | Browser API: global `HoldScan` |
| `browser/worker.js` | Worker: runs detection with onnxruntime-web (CPU), pre/post-processing from `core/detect-core.js` |
| `browser/example.html` | Minimal browser example page |
| `models/freeclimbs.onnx` | Detection model (AGPL-3.0); `models/README.md` covers provenance and re-export |
| `functions/handler.js` | HTTP handling for cloud detection `detect`, plus `detect(buf, size)`; platform independent |
| `functions/index.js` | Firebase wrapper (asia-east1, CPU; auth, App Check, 30 per account per day) |
| `functions/server.js` | Plain Node server wrapper (Docker, Cloud Run, Fly, your own machine) |
| `functions/vendor/` | Copies of `core/` and `models/` placed here at deploy time (without it the repo's `core/` and `models/` are read directly) |
| `cli/analyze.js` | Offline analysis: photo to hold pack |
| `Dockerfile` | Container image for `server.js` |

## 4. Public API

### 4.1 Browser `HoldScan` (`browser/holdscan.js`)

Load with `<script src=".../holdscan.js">`; attaches to `self.HoldScan`.

| Name | Signature | Notes |
|---|---|---|
| `configure({ cache })` | `void` | `cache`: Cache API name for the model; the page downloads it there first and the Worker reads it directly; if unset the Worker downloads it itself |
| `warm()` | `Promise<void>` | Downloads and loads onnxruntime and the model in the background (about 12 MB, then cached by the browser); never rejects (a real detection retries and reports) |
| `detect(canvas, status?)` | `Promise<{ boxes }>` | `boxes`: `[[x0, y0, x1, y1, score], ...]` in `canvas` pixels; `status(key)` receives `'detDownload'` (downloading the model) and `'detFinding'` (detecting). Input size is fixed at 1280 |

Errors: `detect` rejects with an `Error`; `error.download === true` means downloading the model (or loading onnxruntime) failed. If the Worker itself fails to load, every in-flight call rejects and the next call starts a new Worker. Side effects: creates a Worker, `createImageBitmap(canvas)` (ownership transferred), downloads the model.

### 4.2 `HoldDetectCore` (`core/detect-core.js`)

| Name | Notes |
|---|---|
| `MODEL` | `'freeclimbs'` (model file name) |
| `MODEL_SIZE` | `1280` (default input size) |
| `SIZES` | `[1280, 2048, 2560]` (accepted input sizes) |
| `scaleFor(w, h, S = MODEL_SIZE)` | Scale factor `S / max(w, h)` (proportional resize pasted at the top-left, the rest padded with gray 114) |
| `toTensorData(rgba, S = MODEL_SIZE)` | Pre-resized S x S RGBA (pasted top-left) to NCHW float32 (0 to 1), length `3*S*S` |
| `postprocess(data, r)` | Model output `[1, 5, N]` (cx, cy, w, h, score) to boxes `[x0, y0, x1, y1, score]` in photo coordinates, with the score threshold and duplicate removal applied; `r` is the `scaleFor` value |

### 4.3 Node: `functions/handler.js`

| Name | Notes |
|---|---|
| `detect(buf, S = 1280)` | `Promise<{ boxes, w, h, ms }>`. `buf`: JPEG / PNG bytes; decoded and resized with `sharp`, inference with onnxruntime-node (CPU); `w`, `h` are the original photo size. The first call loads the model |
| `createHandler({ verify, takeQuota?, allowOrigin })` | Returns an Express-style `(req, res)`: `verify(req)` returns a uid and must throw on failure (401); `takeQuota(uid)` returning `false` gives 429 (unlimited if omitted); `allowOrigin(origin)` decides CORS |
| `CPUS` | Inference threads (env `DETECT_CPUS`, default 2) |

### 4.4 HTTP interface

`POST <your own URL>` (Climbio no longer runs a public cloud detection endpoint; the site uses the in-browser build on the phone)

- Headers: `Authorization: Bearer <token>`. Deployed as a Firebase function it requires an ID token of a non-anonymous account (anonymous sign-in gets 401) and `X-Firebase-AppCheck`; the self-hosted build with `AUTH=key` uses `API_KEY`.
- Body: `{ "img": "<base64 of a JPEG or PNG>", "size": 1280 }`. `size` is `1280` (default), `2048` or `2560`; larger finds more small holds and is slower. Send the original size, long edge at most 2048 recommended (shrinking and re-compressing on the client misses holds whose score is near the threshold). Images up to 6 MB.
- Response: `{ "model": "freeclimbs-1280", "boxes": [[x0, y0, x1, y1, score], ...], "w", "h", "ms", "source": "<source URL>" }`; boxes are in the received photo's coordinates.
- Status codes: 400 bad request (`img` not a string or `size` not in `SIZES`), 401 auth failed, 413 image too large, 429 daily quota exceeded (Firebase build: 30 per account per day, `{ "error": "quota" }`), 405 method other than POST / GET / OPTIONS, 500 detection failed (details only in the server log).
- `GET` on the same URL warms the instance: loads the model and returns 204 (no photo, no auth, not counted).
- Photos are processed in memory only; never stored, logged or used for training.

Self-hosting (`functions/server.js`, no Firebase needed; at least 2 GB RAM):

```bash
docker build -t holdscan-detect .
docker run -p 8080:8080 -e API_KEY=your-secret -e ORIGINS=https://your-site holdscan-detect
# Without Docker: cd functions && npm install && API_KEY=your-secret node server.js
```

| Environment variable | Meaning |
|---|---|
| `AUTH` | `key` (default; `Authorization: Bearer` must equal `API_KEY`), `firebase` (ID token of a non-anonymous account) or `none` (local or private network only) |
| `API_KEY` | Secret for `AUTH=key` |
| `ORIGINS` | Sites allowed to call cross-origin, comma separated; `*` allows all |
| `DETECT_CPUS` | Inference threads; set to the vCPUs you have (default 2) |
| `PORT` | Default 8080 |

The plain server has no daily quota; for public hosting use `AUTH=key` or rate-limit at a gateway in front.

### 4.5 Offline CLI (`cli/analyze.js`)

```bash
cd holdscan/cli && npm install
node analyze.js wall.jpg [--routes routes.json] [--size 1280|2048|2560] > holds.json
```

| Argument | Notes |
|---|---|
| First non-flag argument | Photo path (required; extra ones throw `unknown argument`) |
| `--size` | Detection input size; must be in `SIZES`; use a larger one for wide-angle phone photos with small holds |
| `--routes` | Circle-format routes (e.g. RouteMake: `[{ id, name, ..., holds: [{ x, y, t, r }] }]`, or `{ routes: [...] }`; `x`, `y` are percentage coordinates, `r` is the circle size) |

- Pipeline: detect, outline by color (holdkit), MobileSAM whole-wall refinement, tidy outlines (`functions/tidy.js`). A circle center that hits no detected hold gets an extra hold traced from the circle's extent (ids `c1`, `c2`, ...).
- Output (stdout, one JSON line): `{ w, h, thumb: '', holds }`, format in `holdkit/SPEC.md`; with `--routes` there is also `routes`, each route's `holds` replaced by hold ids (other fields copied, converted by `routekit/circles.js`), ready to draw with RouteKit.
- Failure: message on stderr, exit code 1 (e.g. `--routes: expected [{ holds: [{ x, y, t, r }] }]`, `--size must be one of ...`).
- Run inside the whole repo, or copy only `holdscan/`, `holdkit/`, `routekit/` and `functions/tidy.js` (relative positions unchanged). If npm warns during `npm install` that the `onnxruntime-node` install script did not run, ignore it.
- Resources: a 1500 px wall with 600+ holds takes about 50 s on an M1 and about 1 GB of memory; `SAM_CPUS` sets the refinement decode Workers (default 2).
- Module export: `require('./analyze.js').analyze({ photo, routes, size })` returns a Promise of the pack object.

## 5. Data format and invariants

- **Box**: `[x0, y0, x1, y1, score]`, `x0 < x1`, `y0 < y1`; coordinates are pixels of the photo (or canvas) received; `score` >= 0.25.
- **Model**: input `images` `[1, 3, S, S]` float32 (RGB, 0 to 1, proportionally resized and pasted top-left, padded with gray 114); output `output0` `[1, 5, N]` = cx, cy, w, h, score; `S` is variable, 1280, 2048 and 2560 are accepted.
- **Post-processing** (`core/detect-core.js`): score threshold 0.25; two boxes count as the same hold when IoU exceeds 0.5, or when 75% of one lies inside another whose area ratio is under 2.5; the higher score is kept. Threshold and de-duplication rules are shared by the cloud build, the browser build and the CLI.
- The browser build downsizes with the browser's canvas and the cloud build with sharp, so results differ by a hold or two.
- The hold pack format of the output is in `holdkit/SPEC.md` (`source` is always `detect`).

## 6. Minimal runnable example

Browser (put these five files on your site as they are, keeping relative positions, then open the page):

```
holdkit/ort.js
holdscan/browser/holdscan.js
holdscan/browser/worker.js
holdscan/core/detect-core.js
holdscan/models/freeclimbs.onnx
```

```html
<script src="holdscan/browser/holdscan.js"></script>
<script>
  HoldScan.warm();   // load in the background before the user picks a photo
  async function run(canvas) {
    const { boxes } = await HoldScan.detect(canvas, (key) => console.log(key));
    return boxes;    // [[x0, y0, x1, y1, score], ...] in canvas coordinates
  }
</script>
```

The version that runs directly in the repo is `browser/example.html`: run `python3 -m http.server 8765` at the repo root, open `http://localhost:8765/holdscan/browser/example.html`, and pick a climbing wall photo to draw the boxes.

Node (after `cd holdscan/functions && npm install`; save as `detect.js` at the repo root, the parent of `holdscan/`):

```js
const fs = require('fs');
const { detect } = require('./holdscan/functions/handler.js');
detect(fs.readFileSync('wall.jpg')).then(({ boxes, w, h }) => { console.log(`${boxes.length} holds in ${w}x${h}`); process.exit(0); });
```

## 7. Limits and known trade-offs

- **External requirements**: the model file (about 12 MB); the browser build must reach jsDelivr to load onnxruntime-web; the CLI and service need Node 22 and `npm install` (`functions/` and `cli/` each have their own `package-lock.json`).
- The browser build is CPU only (wasm, single thread, because the site is not `crossOriginIsolated`) with a fixed 1280 input and no `size` option; only the cloud build and the CLI can use 2048 or 2560.
- `HoldScan` finds `worker.js` through `document.currentScript.src`: load it with a plain `<script src>`, not a dynamic `import` or a bundle.
- The Worker calls `importScripts('../../holdkit/ort.js', '../core/detect-core.js')`, so relative positions must not change.
- The Firebase build (`functions/index.js`) copies `core/` and `models/` into `functions/vendor/` at deploy time; `server.js` and the CLI read the repo's `core/` and `models/` directly when there is no `vendor/`.
- The plain server has no daily quota.
- Raising the score threshold misses holds whose color is close to the wall; lowering it mostly adds text on the wall and hold shadows (checked against real gym photos).
- The model author published freeclimbs v2 test scores but not the training data, so it cannot be reproduced (see `models/README.md`).

## 8. Verification

holdscan has no unit tests; verification is one browser case (needs network: onnxruntime-web loads from jsDelivr and the CLI needs `npm install`; skipped when unreachable; model inference is heavy work, run one at a time):

| Check | Command |
|---|---|
| Browser build: only the five files listed in this README, the example page detects the demo wall; CLI: in a copy with only `holdscan/`, `holdkit/`, `routekit/`, `functions/tidy.js`, photo to hold pack | internal e2e cases |
| Syntax of the Worker and browser files (`holdscan/browser/*.js`, `core/detect-core.js`) | `node tools/check.mjs` |
