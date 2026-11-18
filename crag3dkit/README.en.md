# Crag3DKit (`@climbio/crag3dkit`)

[English](README.en.md) | 繁體中文：[README.md](README.md)

## 1. Purpose

Play and read outdoor 3D crags: take a Gaussian-splat (`.spz`) or mesh (`.glb`) crag model plus 3D routes drawn on it (with number and grade tags), and let readers stand on the trail, see the whole wall, walk along it and tap routes. The data are Climbio format v2 `surface: model` views plus a route layer (see "3D crags" in [format/VOCABULARY.md](../format/VOCABULARY.md)).

- **Use it for**: playing a 3D crag model with routes in a web page or app; or finding a crag's model, walls and cameras in v2 documents.
- **Do not use it for**: outdoor topos on 2D photos (use `topokit/`); indoor 3D walls (use `wall3dkit/`, a different format); building a 3D model from photos (this only plays; it neither reconstructs nor computes the 3D route positions); editing routes (there is no editing).

## 2. License and dependency rules

- License: AGPL-3.0 (`LICENSE`, `NOTICE`). `vendor/three-splat.js` is three.js r180 (MIT) and Spark 2.4.0 (MIT) bundled into one module; the full licenses are in `vendor/three-splat-LICENSE.txt`.
- May depend on: browser DOM, WebGL2, WebAssembly (Spark's sorting), `fetch`, `DecompressionStream`. Reading and occlusion tables (`read.js`, `sight.js`, `text.js`) have no DOM dependency and also run in Node.
- Must not depend on: the Climbio app's `js/`, `state`, `t()`, DOM element ids, IndexedDB, Firebase, branding; other kits (kits are independent and do not import each other, so the name and grade pickers are a separate copy).
- No uploads, no backend; model and photo URLs come from the caller.
- The page's CSP must allow WebAssembly (`wasm-unsafe-eval`) and blob workers (Spark needs both).

## 3. File map

| File | Responsibility |
|---|---|
| `index.js` | Entry: reading, occlusion tables, name/grade pickers and styles are exported directly; `mountCrag3d` loads the player on first call (three.js and Spark, about 3 MB) |
| `player.js` | The player `mountCrag3d`: camera, gestures, routes and number tags, occlusion, loading and fade-in |
| `read.js` | `readCrag3d`, `sharedModelId`: find the model, routes, walls with cameras and the overview in v2 documents |
| `sight.js` | Occlusion tables: `readSight` (decode), `routeVisibility` (is each point visible from a position) |
| `text.js` | `pickName`, `pickGrade` (same rules as TopoKit) |
| `style.js` | The style string `CSS` and `injectStyle` |
| `vendor/three-splat.js` | three.js plus Spark bundled into one module (MIT); licenses in `vendor/three-splat-LICENSE.txt` |
| `build-vendor.mjs` | Rebuild `vendor/three-splat.js` (downloads three.js and Spark, bundles with esbuild, exports only the names `player.js` imports) |
| `index.d.ts` | Types (handwritten) |
| `test/unit.test.mjs` | Unit tests: reading the format, occlusion tables, name and grade |

## 4. Public API

Coordinates are model `[x, y, z]` in metres, y up. Full types in `index.d.ts`.

| Name | Description |
|---|---|
| `mountCrag3d(host, options)` | Draw a 3D crag in `host`; returns the player as soon as the opening snapshot (`poster`) is laid down, the model loads in the background. Options: `url` (model URL or a Promise), `mime`, `background` (the splat backdrop for a mesh), `marks`, `sight`, `nodes`, `areas` (in wall order), `start`, `intro` (first visit: the camera of the overview snapshot), `poster`, `sky`, `onPick(route id \| null)`, `onArea(index)` |
| Player | `highlight(id)` lights a route, `go(i)` walks to wall i, `route(id)` walks in front of a route then calls `onPick`, `walk(n)` along the wall forward or back, `area()`, `posterRect()`, `destroy()` |
| `readCrag3d(docs, modelId, { lang })` | From all the crag's v2 documents find `{ model, layers, marks, sight, nodes, owners, areas, overview }`; `null` if there is no such model view |
| `sharedModelId(views)` | The model id when every topo is a snapshot of the same model, otherwise `null` |
| `readSight(b64)`, `routeVisibility({ table, spec, pts, from, fill, out })` | Decode an occlusion table; is each route point visible from `from` (returns `{ vis, seen }`) |
| `pickName(name, lang)`, `pickGrade(grade, systems)` | Name and grade pickers |
| `CSS`, `injectStyle(host)` | Styles; override the line colours with the CSS variables `--c3d-sport`, `--c3d-sport-on`, `--c3d-other`, `--c3d-other-on` |

## 5. Data format and invariants

The format is described under "3D crags" in [format/VOCABULARY.md](../format/VOCABULARY.md); samples are in `format/examples/crag3d*.json`. Invariants the player relies on:

- The model view is `surface: model` with `href` pointing at `.spz` (`mime: model/x-spz`) or `.glb` (`mime: model/gltf-binary`); each file at most 25 MB (the Climbio open dataset limit).
- Routes are `LineString`s in the model layer in model coordinates; an occlusion table must have as many points as its coordinates, and the layer's `props.sight` is the spec. No table means no occlusion.
- One snapshot per wall (`props.model` holds the model id and camera), ordered by the wall node's `props.order`; the crag (or area) node may carry an overview snapshot, which adds the opening that flies from the whole crag into the first wall.
- One model per crag: 3D is used only when every topo with routes is a snapshot of the same model (`sharedModelId`).

## 6. Minimal runnable example

Read a crag:

```js
import { readCrag3d } from '@climbio/crag3dkit';

// docs: all v2 documents of the crag (set, views, layers); modelId: the id of the model view
const crag = readCrag3d(docs, modelId, { lang: 'en' });
// crag.areas[0]: { id, name, camera, aspect, routes, snapshot }
```

Play it:

```js
import { mountCrag3d } from '@climbio/crag3dkit';

const player = await mountCrag3d(document.querySelector('#view'), {
  url: modelUrl, mime: crag.model.mime, marks: crag.marks, sight: crag.sight, nodes: crag.nodes,
  areas: crag.areas, poster: crag.areas[0].snapshot.href, onPick: (id) => console.log('picked', id),
});
player.route('sample3dr2');   // walk in front of the second route
```

## 7. Limits and known trade-offs

- Playback only: it does not build models from photos, compute 3D route positions or edit routes.
- One model at a time; several models per crag (one per area) are not defined yet.
- A splat model has to fit in phone memory: the author side crops and shrinks it; Android's point budget is about one million, so the player turns level of detail (LoD) off and the model must fit that budget.
- Route positions in 3D (with occlusion tables) are computed on the author side; the player only draws the data, so fix the data if a position is off.
- Number tags, grade tags and lines are fixed screen pixels: on wide screens (width greater than height) they scale with the host element's height (from 640 px up, at most 1.9×); portrait and small windows keep the original size. This is computed once at mount and not recomputed when the window is resized later.
- Needs WebGL2 and WebAssembly; without WebGL it just fails and does not fall back to 2D (the 2D fallback is the wall snapshots and TopoKit).

## 8. Verification

- Unit tests: `node --test crag3dkit/test/unit.test.mjs` (also part of `kit-packages` in `npm run test:quick`).
- Types declare every export, the files listed in `package.json` exist, licenses are complete: `tools/kit-packages.test.mjs`.
- Sample data are valid: `tools/format.test.mjs` (`format/examples/crag3d*.json`).
- The player itself is verified in a browser: Redpoint's 3D crag (`redpoint/`) uses it; after changing the player, try it at phone size.
