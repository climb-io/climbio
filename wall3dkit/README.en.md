# Wall3DKit (`@climbio/wall3dkit`)

中文：[README.md](README.md)

## 1. Purpose

Indoor 3D walls: a gym wall reconstructed from photos, with every hold labelled on the model. This kit loads a wall pack, renders the model underneath a 2D route-setting view (the 2D zoom and pan become the same crop), picks holds by raycast, provides a camera that walks along the wall (drag sideways to walk, drag up and down to rise and sink, pinch to move closer), and bakes the author's working files into a finished pack. Hold Cat's 3D walls use it (`js/wall3d.js` is the app's glue).

- **Use it for**: setting and viewing routes on a 3D wall pack (`climbio-3d-wall/1` or `/2`) in a web page and tapping holds; or baking working files into a finished pack that others read as is.
- **Do not use it for**: outdoor 3D crags (Gaussian splats with routes as 3D polylines: use `crag3dkit/`); walls on 2D photos (use `routekit/`); building a 3D model from photos (this kit only reads and bakes; reconstruction is a separate 3D reconstruction pipeline).

## 2. License and dependency rules

- License: AGPL-3.0 (`LICENSE`, `NOTICE`). `vendor/three.js` is three.js r180 (MIT, with GLTFLoader) and three-mesh-bvh 0.9.18 (MIT) bundled into one module; full license texts are in `vendor/three-LICENSE.txt`.
- May depend on: the browser's DOM, WebGL, `fetch`, `DecompressionStream`, `createImageBitmap`. The baking geometry (`bake.js`) and the outline geometry have no DOM dependency and run in Node; every module loads in Node, and the screen and WebGL are only touched when called.
- Must not depend on: the Climbio app's `js/`, `state`, `t()`, DOM element ids, IndexedDB, Firebase or branding; other kits.
- No uploads and no backend; the pack URL comes from the caller.
- Callers that need three.js (for example the 3D wall editor) take it from `vendor/three.js`, so a page loads only one copy.

## 3. File map

| File | Responsibility |
|---|---|
| `index.js` | Entry point: exports the public API of the files below |
| `stage.js` | The stage: `loadPack`, `openStage` and `openFront` read a pack; `Stage` renders the model, applies the 2D view, picks holds, projects outlines, takes snapshots, draws the glow, turns the angle, walks along the wall and flies in; surfaces, cropping and outline geometry |
| `walkcam.js` | The wall-following camera `WalkCam`: the track (`wallPath`), equidistant path, horizontal and vertical ranges, farthest distance, finger tracking, on-screen calibration (`calibrate`), and `packWalk` and `unpackWalk` for the finished pack |
| `bake.js` | Pure baking functions: clip triangles by cropping planes, write and read back a standard glb |
| `bakepack.js` | `bakePack`: bakes working files into a finished pack (cut model, hold labels, snapshot, front outlines, wall-following camera) |
| `vendor/three.js` | three.js plus three-mesh-bvh bundled into one module (MIT); licenses in `vendor/three-LICENSE.txt` |
| `build-vendor.mjs` | Rebuilds `vendor/three.js` (downloads three.js and three-mesh-bvh, bundles with esbuild, exports `NAMES` only) |
| `index.d.ts` | Types (hand-written) |
| `test/` | Unit tests: outline geometry, the wall-following camera's pack data, the bundle's exports (`unit.test.mjs`); baking (`bake.test.mjs`) |

## 4. Public API

Coordinates are model `[x, y, z]` in metres; stage coordinates are CSS px. See `index.d.ts` for full types.

| Name | Description |
|---|---|
| `loadPack(base)` | Reads the pack's `wall.json` (`base` is the pack URL ending in `/`) |
| `openStage(base, pack)` | Downloads the model and hold labels (a finished pack also brings the snapshot and the wall-following camera) and builds a `Stage` |
| `openFront(base, pack)` | Builds a wall from a finished pack's `wall.json` and snapshot alone (the snapshot is the photo, the baked front outlines are the holds) before the model loads; returns `null` for older packs |
| `openStageFrom(data)` | Builds a `Stage` from data already in memory (baking uses it too) |
| `Stage` | `mount`, `unmount`, `dispose`, `warm`; `setView(view)` applies the 2D view; `paint({ holds, mode, colors })` draws a route; `pick(x, y)` picks a hold; `outlines()`, `frontOutlines()`; `snapshot()`, `viewShot()`; `setEdits(edits)` hold fixes; wall-following camera: `walk(view, at)`, `flyIn`, `frameTo(ids)`, `angle(dx)`, `settle`, `resetTilt` |
| `WalkCam` | The wall-following camera: `s`, `v`, `d`, `yaw`; `sRange()`, `vRange(s, d)`, `dMax`, `dMin`; `pan`, `zoomAt`, `clamp`, `apply`; `missedHolds(d)` checks the standard; `calibrate` for on-screen calibration |
| `wallPath`, `profile`, `meshesOf`, `loadGlb` | Compute the track from a model (author side) |
| `packWalk`, `unpackWalk`, `tableFor`, `introEnd` | Write the camera into a finished pack, read it back, pick the bounds table with the closest aspect ratio, and the opening stop position |
| `bakePack({ doc, glb, faces })` | Bakes working files into a finished pack; returns `{ files: [{ path, bytes }], stats }` |
| `clipPolygon`, `bakeMesh`, `writeGlb`, `parseGlb`, `sourceTexture` | Pure baking functions |
| `packSurfaces`, `goneHolds`, `holdMargin`, `frameTest`, `frameShader`, `packSig` | Working-file surfaces, holds that are gone, cropping |
| `hull`, `simplify`, `inside`, `decode`, `inflate`, `u16`, `parseModel` | Small helpers |
| `STEP`, `YAW_MAX`, `YAW_RATE`, `FRAME_MAX`, `FRAME_BOUNDS` | Constants |

### The camera standard

The camera's ranges come only from the model and the hold data (`WalkCam.sees` casts rays, `WalkCam.holds` gives hold positions), with no per-wall tuning, and are computed for each screen aspect ratio. In priority order: every hold on the front wall can be tapped (fully inside the usable screen, at least 8 cm from the edge); within that, show as little outside the wall as possible; the farthest distance still leaves one continuous screen width along the wall with wall on all four edges; holds on side walls are reached by turning up to ±30°. Details are in [docs/3d-wall.md](../docs/3d-wall.md), "鏡頭的標準" (the camera standard).

## 5. Data format and invariants

The pack's files and fields are described in [docs/3d-wall.md](../docs/3d-wall.md) (the finished pack and data pack sections).

- `climbio-3d-wall/1` (working files): `wall.json` (holds, texture-space hold labels, surfaces, cropping planes, up and front directions, license), `model-<hash>.glb`, `faces-<hash>.bin` (which hold each triangle belongs to, uint16).
- `climbio-3d-wall/2` (finished, produced by `bakePack`): a standard glTF 2.0 `wall-<hash>.glb` (already cut, unlit), hold ids per face, per texture pixel and per hold overlay mesh (deflate), `snapshot-<hash>.jpg`, and `walk-<hash>.json` (track, wall depth, on-screen bounds tables per aspect ratio); reading it does no cropping and no track computation.
- Hold ids are stable within a wall; re-exporting the same model keeps them.
- Wall content (model, textures, holds) is published under CC BY-SA 4.0.

## 6. Minimal example

```js
import { loadPack, openStage } from '@climbio/wall3dkit';

const base = 'https://example.org/walls/abc/';   // pack URL, ending in /
const pack = await loadPack(base);
const stage = await openStage(base, pack);
stage.mount(document.querySelector('#stage'));
stage.setView({ s: 1, tx: 0, ty: 0, bw: stage.snapW });
stage.paint({ holds: { [pack.holds[0].id]: 'start' }, mode: 'dim', colors: { start: '#22c55e' } });
document.querySelector('#stage').addEventListener('click', (e) => console.log('picked', stage.pick(e.offsetX, e.offsetY)));
```

Baking (author side, runs in a browser; needs WebGL for on-screen calibration and the snapshot):

```js
import { bakePack } from '@climbio/wall3dkit';

const { files, stats } = await bakePack({ doc: wallJson, glb, faces });   // files: [{ path, bytes }], all in one folder
```

## 7. Limits

- `Stage` follows Hold Cat's route-setting view (the 2D view's `s`, `tx`, `ty`, `bw`, and snapshot pixel coordinates); other screens have to use the same coordinates.
- One wall and one model at a time; the phone has to hold the model and textures in memory.
- The wall-following camera needs a finished pack (`walk`); older working files use the front-facing rail camera.
- Zoomed all the way in, a few holds deep in an inside corner need a turned angle because the camera walks into the corner.
- Needs WebGL; without it, loading fails rather than falling back to 2D (the 2D fallback is the snapshot and outlines).

## 8. Verification

- Unit tests: `node --test wall3dkit/test/*.test.mjs` (also part of `kit-packages` in `npm run test:quick`).
- The type file declares every export, every file listed in `package.json` exists, license files are present, and nothing imports outside the kit: `tools/kit-packages.test.mjs`.
