# format (@climbio/format)

English | [繁體中文](README.md)

## 1. Purpose

The JSON Schema (draft 2020-12) and validator for Climbio open data format v2. It is centered on a "view" (a photo, a vector drawing, a map or a 3D model). Routes, holds, walls and crags are nodes; frequently changing marks live in layers drawn on top of a view; everything else is a set that composes views.

- Use it to: read, write, publish, import or validate Climbio-format files (sites, extensions, importers, Studio, the apps).
- Do not use it to: render, edit or upload photos (it only validates JSON); or to interpret vocabulary (see [VOCABULARY.md](VOCABULARY.md) for what `type` and `props` mean; the validator does not check most vocabulary).

The full spec is `climbio.schema.json` plus [VOCABULARY.md](VOCABULARY.md). A site that wants Redpoint to import it by URL: see [docs/redpoint-sites.md](../docs/redpoint-sites.md).

## 2. License and dependency rules

- License: Apache-2.0 (`LICENSE`, `NOTICE`). Example photos are not in this folder; each follows the `license` and `attribution` in its file (CC BY-SA 4.0).
- No dependencies, no build step.
- Must not import or reference AGPL code (`js/`, `holdscan/`), Climbio's backend, or any product (`studio/`, `redpoint/`, `hold/`).
- Kits (`sourcekit/`, `routekit/`, ...) are independent of each other; `format/` imports no kit.
- Not copied elsewhere (`tools/sync-extension.mjs` only copies `sourcekit/`).

## 3. File map

| File | Responsibility |
|---|---|
| `format.js` | The only implementation: UMD that builds `SCHEMA`, `validate`, `VERSION`; browsers get the global `ClimbioFormat`, Node uses `require` |
| `index.mjs` | ESM entry; re-exports `format.js` (default plus named exports) |
| `index.d.ts` | TypeScript types (`View`, `Layer`, `Set`, `Node`, `Mark`, `Camera`, ...) |
| `climbio.schema.json` | `SCHEMA` dumped as-is for other languages; regenerate after changing `format.js` (a test compares them) |
| `VOCABULARY.md` | Vocabulary for node `type` and `props` (open; does not affect the validator or the version) |
| `examples/` | Samples: `wall.json`, `wall-routes.json`, `topo.json`, `topo-routes.json`, `map.json`, `set.json`, `wall-photos/`, and the 3D crag `crag3d.json` (the set) with `crag3d-model.json`, `crag3d-overview.json`, `crag3d-wall.json`, `crag3d-routes.json` (no model or photos attached) |
| `package.json`, `LICENSE`, `NOTICE` | Package metadata and license |

## 4. Public API

| Name | Signature | Description |
|---|---|---|
| `VERSION` | `2` | Current format version; the file's `climbio` field must equal it |
| `SCHEMA` | `Record<string, unknown>` | JSON Schema (draft 2020-12), same content as `climbio.schema.json` |
| `validate(doc)` | `(doc: unknown) => string[]` | Returns a list of errors, each `field path: reason`; an empty array means valid |

- Errors: `validate` never throws. A non-object input just yields an error string (`（最上層）：要是 object`, i.e. "top level: must be object").
- Side effects: none. Pure function; no file or network access.
- The schema check runs first; if it reports errors only those are returned. Relation checks (section 5) run only when the schema check passes.
- ESM (`import { validate, SCHEMA, VERSION, default }`), CommonJS (`require`) and browser `<script src="format.js">` (global `ClimbioFormat`) expose the same content.
- Package export paths: `.`, `./climbio.schema.json`, `./package.json`.
- Error messages are in Traditional Chinese.

Types: `Doc = View | Layer | Set`; `View = PhotoView | DrawingView | MapView | ModelView`; `Geometry` is a GeoJSON geometry (`Point`, `MultiPoint`, `LineString`, `MultiLineString`, `Polygon`, `MultiPolygon`).

## 5. Data format and invariants

Three kinds of file, told apart by `kind`:

| `kind` | Required fields | Content |
|---|---|---|
| `view` | `climbio`, `kind`, `id`, `surface`, `t`, `license`, `attribution`, `origin` | An annotatable plane; `surface` is `photo`, `drawing`, `map` or `model` |
| `layer` | common fields plus `on` | Nodes and marks overlaid on the view `on`, using that view's coordinates |
| `set` | common fields | A composition: `items` holds views, layers and sets (nestable); `type` is a free string |

Required fields and coordinate system per `surface`:

| `surface` | Required | Coordinates |
|---|---|---|
| `photo` | `href`, `w`, `h`, `mime` (jpeg / png / webp) | Photo pixels, top-left is `(0, 0)` |
| `drawing` | `w`, `h` | The drawing's own coordinates |
| `map` | none | Longitude/latitude (WGS84), longitude first |
| `model` | `href` (`.glb`, or Gaussian splat `.spz`), `mime` (`model/gltf-binary`, `model/x-spz`) | Model meters, `y` up |

Invariants checked by `validate`:

- `climbio` must be `2`; `origin` must be `self`, `authorized` or `personal` (paper scans and photos of unknown origin have no valid value and never leave the device).
- File id: `[0-9a-z]{12,64}` (new ones use 16 random lowercase characters). Local node id: `[0-9a-z][0-9a-z_-]{0,63}`, unique within the file. Cross-file references use a global id or `fileId#nodeId`.
- `href`: a relative path (no leading `/`, no `..`), an `https://` URL, or `drive://{Drive file id of files.json}/{path inside the pack}`.
- A node's `parent` must resolve (or be a global id) and must not loop back; `geo` and map marks must be within longitude/latitude range.
- A mark's `geometry` is a GeoJSON geometry; polygons are closed; coordinates are inside the view (photo `0..w`, `0..h`; layers and 3D models are not range-checked, since a layer's view is not in the same file).
- A view mark's `node` exists in the same file or is a global id.
- Route `props.holds` roles are `s`, `h`, `f`, `t`; in a view, `holds` must point to nodes of `type: "hold"`; every `props.seq` entry is in `holds`; `props.crop` stays inside the view.
- A set does not contain itself; a layer is not overlaid on itself.
- Unknown fields, `type`s and vocabulary are ignored (by readers and by the validator).

Not done by the validator, so the caller must: check downloaded image size, type and `sha256`; accept only `https` or `drive` links; never render the sender's HTML; show SVG base images as images.

Placement principles (details in `climbio.schema.json` and `VOCABULARY.md`): each fact lives in one place; the node tree and routes go in the set's `nodes`, topo lines and bolts in layers, and hold-wall routes live in the layer (the one exception); the smallest unit to share is a topo, and one pack must be fully usable on its own.

## 6. Minimal runnable example

```js
// npm install @climbio/format, save as check.mjs, run node check.mjs
import { validate } from '@climbio/format';

const view = {
  climbio: 2, kind: 'view', id: 'wall0000000001a', surface: 'photo',
  t: Date.now(), license: 'CC-BY-SA-4.0', attribution: 'Me', origin: 'self',
  href: 'wall.jpg', w: 1600, h: 1200, mime: 'image/jpeg',
  nodes: [{ id: 'h1', type: 'hold' }],
  marks: [{ node: 'h1', geometry: { type: 'Polygon', coordinates: [[[10, 10], [50, 10], [50, 50], [10, 10]]] } }],
};

console.log(validate(view));                        // []
console.log(validate({ ...view, origin: 'x' }));    // ['origin：要是 self、authorized、personal 其中之一']
```

## 7. Limits and known trade-offs

- The validator is a hand-written subset implementation (only the keywords this schema uses), not a general JSON Schema engine. Other languages can use `climbio.schema.json` with their own library, but the relation checks that a schema cannot express (second half of section 5) must be done by the caller.
- Results are strings, with no error codes; match on the field path if code needs to branch.
- `validate` checks one file at a time and does not cross files (whether a layer's view or a set's `items` exist, whether global ids resolve). The cross-file placement check is `tools/format-placement.mjs` (a repo-internal tool, not in the package).
- Coordinate range is checked only for a view's own marks; a layer's range depends on the view underneath, which the validator does not see.
- Same behavior in browsers and Node; no globals required.

## 8. Verification

```bash
node --test tools/format.test.mjs tools/format-placement.test.mjs tools/share-format.test.mjs
```

- `tools/format.test.mjs`: schema equals `climbio.schema.json`, samples are valid, field paths for each kind of error, ids, parents, marks, camera data.
- `tools/format-placement.test.mjs`: crag hierarchy and placement (routes in the set, layers hold only bolts and lines).
- `tools/share-format.test.mjs`: `appkit/share-tools.js` and `functions/open-format.js` reading and writing format v2 (validated with `format.js`).
- After changing `format.js`, regenerate `climbio.schema.json`: `cd format && node -e "process.stdout.write(JSON.stringify(require('./format.js').SCHEMA, null, 2) + '\n')" > climbio.schema.json`. The major version in `package.json` must equal `VERSION` (tested).
- When spec behavior changes, update this file, `README.md` and `VOCABULARY.md` together.
