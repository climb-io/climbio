# ArKit (`@climbio/arkit`)

中文：[README.md](README.md)

## 1. Purpose

AR route view for climbing walls: point a phone browser's camera at a wall, recognise which wall it is and track the camera on-device, then draw the route holds back onto the live camera image. It needs only one 2D wall photo with hold outlines — no 3D model, no native app. Hold Cat's "AR view" uses it.

- **Use it** when you have a 2D wall photo with hold outlines (or precomputed camera matching data) and want to show a route live through the camera in a web page.
- **Don't use it** for 3D walls (camera localisation lives in `3d/` and uses the 3D model) or to show routes on the photo without a camera (use `routekit/`).

## 2. License and dependency rules

- License: AGPL-3.0 (`LICENSE`, `NOTICE`).
- Loads the OpenCV 4.10.0 WebAssembly build at runtime (Apache-2.0, about 10 MB, not shipped in this folder; defaults to `/redpoint/vendor/opencv-4.10.0.js`, override with `opencvUrl`).
- May depend on: browser DOM, `getUserMedia`, Canvas 2D, Workers, IndexedDB (caches camera matching data computed on-device).
- Must not depend on: the Climbio app's `js/`, `state`, `t()`, Firebase, branding, or other kits.
- Uploads nothing: photos are only used on-device to compute matching data.

## 3. Files

| File | Responsibility |
|---|---|
| `index.js` | Entry: re-exports the public API, `Geometry`, `trackerWorkerUrl` |
| `view.js` | `createArView()`: camera (or test source), tracker worker, frame-synchronous preview and overlay, route switching, logging, dev-tool wiring |
| `view.css` | Stage, camera canvases, greyed camera image once the wall is locked, searching reticle |
| `overlay.js` | `createArOverlay()`: the AR look (drawing only) |
| `tracker-worker.js` | Tracker worker: OpenCV AKAZE wall recognition, homography, bidirectional LK optical flow, background re-anchoring, on-device matching data (`build_camera`) |
| `geometry.js` | Homography, verification, extrapolation, wall/route parsing (browser global `ArKitGeometry`, Worker, Node) |
| `camera.js` | Main-lens selection, cover viewport, swapped width/height handling, first-frame wait (also used by the 3D tracker) |
| `tracking-log.js` | Tracking log `climbio-2d-tracking-log/1` (no images) |

## 4. Usage

### Ready-made page (iframe)

Hold Cat opens a full-screen iframe at `/lab/wall2d-cam/?ui=2&auto=1&wall=<wall id>&route=<hold id>:<role>,…` (`auto=1` opens the camera immediately and hides dev tools). That page is a thin shell over ArKit (`lab/wall2d-cam/app.js`).

- **Wall data**: walls listed in the page's `manifest.json` (`climbio-2d-tracking/1`) are read directly. For private walls the page posts `climbio-wall2d-request` to its parent, which answers with `climbio-wall2d-data` (`wallId`, `name`, `w`, `h`, `holds: [{ id, poly }]`, `photo` Blob, `updatedAt`); matching data is computed on-device and cached in IndexedDB.
- **Route switching** (same-origin `postMessage`):
  - page → parent: `climbio-ar-hello` on start; `climbio-ar-state` (`located`, `running`, `error`) on change.
  - parent → page: `climbio-ar-routes` (`routes: ArRoute[]`, `index`, `labels: { s, t }`); while dragging `climbio-ar-drag` (`p`: -1..1, positive = next); switch with `climbio-ar-index` (`index`, `dir`).
  - Without `climbio-ar-routes`, the page draws the single route from the `route` URL parameter.

### Your own page

Provide `#stage` (with `#live-video`, `#live-preview`, `#overlay-canvas`, `#ar-reticle`), mark the host element with `data-arkit`, load `view.css`:

```js
import { createArView } from '@climbio/arkit';
const view = await createArView({ params: new URLSearchParams('auto=1&wall=wanhua'), manifestUrl: '/walls/manifest.json' });
view.setRoutes([{ id: 'a', holds: [['h1', 's', 0], ['h2', 'h', 1], ['h3', 't', 2]] }], 0, { s: 'Start', t: 'Top' });
view.showRoute(1, 1);
```

Toolbar, status, route select and log dialog elements (ids in `lab/wall2d-cam/index.html`) are wired when present and skipped otherwise.

## 5. Look

- Once the wall is locked the camera image turns grey and darker (display only), and route holds are drawn back in their original colours with thin neon contours, soft bloom and a dark under-stroke so they stay visible on bright walls.
- Start and top holds get breathing brackets and small labels; routes with a move sequence get a flowing dotted line between holds.
- On lock: wall corner brackets close in, a scan line sweeps up, holds trace in by move order; losing tracking for under 1.5 s does not replay it.
- Before lock: a searching reticle (`#ar-reticle`) in the middle.
- Reduced motion disables the animations.

## 6. Camera and performance

- The preview and the image sent to the tracker are always the same camera frame (taken from `<video>` once), so outlines line up; when the worker is slow the preview is released and the overlay uses an extrapolated pose.
- Chromium (Android Chrome etc.) transfers `VideoFrame`s to the worker and reads luma there, no pixel readback on the main thread; Safari on iPhone turns the preview black after creating a VideoFrame, so WebKit uses canvas capture.
- Optical flow runs at 480 px long side, recognition at 640 px; on a low-end Android (OPPO CPH2339) about 30 ms per frame and about 2 ms per overlay draw. Numbers in `docs/2d-tracking.md`.

## 7. Tests

- `node --test tools/tracking2d.test.mjs`: geometry, matching data format, log.
- `npx playwright test --project=android-chromium lab-wall2d-cam.spec.mjs cam-view.spec.mjs`: recognition, alignment while moving (p95 < 3 px), pixel checks of the AR look, Hold Cat route switching.
