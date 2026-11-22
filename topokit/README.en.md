# TopoKit (`@climbio/topokit`)

Chinese: [README.md](README.md)

## 1. Purpose

View and edit outdoor topos: draw route lines, bolts and number tags (with grade and name) on a crag photo, with zoom and tap-to-select; when editing, draw lines, place bolts, move and delete nodes, fork, undo/redo. Native SVG, plain ES modules, no build step, no backend.

- **Use it when**: you have a crag photo (a Climbio public format v2 "photo view" plus route layers) and want to show the topo or let users draw lines and place bolts.
- **Do not use it for**: hold-based routes on indoor spray walls (use `routekit/`); maps (use `mapkit/`); upload, submission or version history (the host app's job; this kit outputs a layer); data in percentages or an app's legacy format (convert to v2 first).

## 2. License and dependency rules

- License: AGPL-3.0 (`LICENSE`, `NOTICE`); the layout algorithm is ported from Longdong, MIT notice in `NOTICE`.
- May depend on: browser DOM/SVG and `fetch` (only the Web Component uses it, to read URLs). The core (`renderLines`, data conversion, geometry) needs no DOM and runs in Node.
- Must not depend on: the Climbio app's `js/`, `holdscan/` (AGPL), the app's `state`, `t()`, DOM element ids, IndexedDB, Firebase, branding.
- Kits are independent: no imports from other kits. Data is only the Climbio public format v2 shape; validate with `validate` from `@climbio/format`.
- No uploads and no backend; submission and version history belong to the host.

## 3. File map

| File | Responsibility |
|---|---|
| `index.js` | Entry; re-exports the files below |
| `data.js` | v2 <-> route model: `readTopo`, `writeLayer`, `assertView`, `pickName`, `pickGrade`, `newId` |
| `lines.js` | Line rules: shared segments, add point, fork, move shared point, remove point |
| `render.js` | Route model -> SVG string: `renderLines`, `renderReveal` (runs without a DOM) |
| `annotate.js` | Layout: smooth paths, text width and wrapping, `Placer` (tag avoidance) |
| `viewport.js` | Pure functions and constants for zoom, pan, framing, double-tap, swipe |
| `motion.js` | Post-render motion: tags slide to their new spot, notes fade in (used internally by `TopoViewer`) |
| `view.js` | `TopoViewer`: photo + SVG, gestures, zoom buttons, events |
| `editor.js` | `TopoEditor` (extends `TopoViewer`): tools, editing, undo/redo |
| `style.js` | The component CSS string `CSS` |
| `element.js` | Web Component `<climbio-topo>` (registers on load) |
| `index.d.ts`, `element.d.ts` | Types (hand-written) |
| `demo.html` | Demo page |
| `test/unit.test.mjs`, `baseline/` | Unit tests; scenes and screenshot baselines matched to Longdong |

## 4. Public API

All coordinates are photo pixels. Full types are in `index.d.ts` and `element.d.ts`.

### TopoViewer

`new TopoViewer(host: HTMLElement, options?: ViewerOptions)`, extends `EventTarget`.

| Member | Notes |
|---|---|
| `setData({ view, layers?, nodes? })` | Load data; throws if the view is not a v2 photo view or a layer is not on this view |
| `setOptions(partial)` | Update options and redraw |
| `select(id \| undefined)`, `setView(state)`, `zoomBy(ratio, at?)`, `zoomToRect(rect, { keepZoom?, animate? })` | Selection, zoom and pan |
| `state`, `model`, `routes`, `k`, `host`, `options` | Read-only: zoom state, route model, route array, photo pixels per screen pixel |
| `destroy()` | Removes all listeners, the ResizeObserver and timers; fires `destroy` |

Events (`detail`): `ready`, `pick` (`{ id }`), `zoom` (`{ scale }`), `swipe` (`{ step: 1 \| -1 }`, needs the `swipe` option), `swipedown` (needs the `swipe` option), `destroy`.

Options (`ViewerOptions`, all optional):

| Option | Notes |
|---|---|
| `highlight` | Route id drawn in the highlight color |
| `bolts` | `true` for all routes, an array of route ids, or `'zoom'` (all bolts only above 1.8x zoom); default is only the `highlight` route's |
| `boltCodes` | Bolt tags include the position (`x B01`) |
| `names` | `false` hides route names (shown by default) |
| `gradePill` | Number tag carries the grade (default `true`); simplifies automatically when routes are crowded; layout priority: number+grade > name > bolt |
| `naturalEnds` | With bolts, the line end stops before the anchor tag (default `true`) |
| `solo` | Route card: `highlight` gets number and caption, others only a small number |
| `reveal`, `revealWidth` | Grayscale photo with original color around the `highlight` route; band width defaults to 0.14 |
| `crop` | Visible area; defaults to the view's `props.crop`, else the whole photo |
| `fit` | `'contain'` (default), `'cover'`, `'width'` |
| `zoom`, `controls`, `wheel` | Zoom allowed (default `true`), zoom buttons (default `true`), `'ctrl'` (default for Viewer) or `'always'` |
| `swipe` | `true` or `'page'`; horizontal swipe fires `swipe`, a downward swipe while not zoomed fires `swipedown` |
| `interactive`, `ui`, `text`, `lang`, `gradeSystems` | Routes tappable, tag scale, button labels, name language, grade system order |
| `editing` | Editing look (always on for `TopoEditor`) |

### TopoEditor

`new TopoEditor(host, options?: EditorOptions)`, extends `TopoViewer`, adds the options `editLayer` (default 0; an empty layer is created if there is none), `tool`, `keys`, `aim`, `positions(routeId)`, `transform(routes, before, id)`.

- Tools (`Tool`): `'select'`, `'edit'`, `'line'`, `'bolt'`, `'number'`, `'crop'`; `setTool(tool)`.
- Routes and lines: `addRoute({ id?, label?, name?, kind? }) -> id`, `setLine(points)`, `clearRoute()`, `fork(on?)`, `placeAt(point)`, `setBoltPos(pos)`.
- Selection and deletion: `pickPoint(picked)`, `deletePicked()`; read-only `selected`, `editable`, `picked`, `forking`, `canFork`, `nextBoltPos`.
- Crop and pan: `setCrop(rect)`, `cropRect`, `setHand(on)`, `hand`.
- History and output: `undo()`, `redo()`, `clearHistory()`, `canUndo`, `canRedo`, `toLayer() -> Layer` (a copy), `setLayer(layer)` (replaces everything, undoable).
- Events: those of the Viewer plus `change` (`{ layer, reason }`), `history` (`{ canUndo, canRedo }`), `select` (`{ id }`), `selectpoint` (`{ picked }`), `tool` (`{ tool }`), `fork` (`{ on }`), `crop` (`{ crop }`).
- Errors: only routes in the edit layer (`editLayer`) can change; editing a route from the view or another layer throws.

### Data and geometry functions

| Name | Signature |
|---|---|
| `readTopo` | `({ view, layers?, nodes? }, { lang?, gradeSystems? }?) -> TopoModel` |
| `writeLayer` | `(layer, routes, index, known?: Set<string>) -> Layer`; writes edited routes back into a layer |
| `assertView` | `(view) -> void`; throws if not a v2 photo view |
| `pickName`, `pickGrade`, `newId` | Name (by language), grade (by system order), new node id |
| `renderLines` | `(routes, RenderOptions) -> string` (SVG string) |
| `renderReveal` | `(line, { photo, width, id }) -> string` (grayscale-mask SVG; empty string for fewer than two points) |
| `drawnRuns`, `ownRuns`, `segmentAt`, `addLinePoint`, `forkLine`, `moveSharedPoint`, `removeLinePoint` | Shared-segment and editing rules, see `index.d.ts` |
| `smoothPath`, `pathLength`, `pointAlong`, `textWidth`, `wrapText`, `Placer` | Layout helpers |
| `clampView`, `moveView`, `focusView`, `fitSize`, `routeCrop`, `isSketch`, `doubleTapView`, `isDoubleTap`, `swipeStep`, `swipeDown`, `IDENTITY`, `MAX_SCALE`, `DOUBLE_TAP_SCALE`, `DRAG_PX`, `CSS` | Pure view functions and constants |

### Web Component `<climbio-topo>`

`import '@climbio/topokit/element'` (registers on load; does nothing server-side where `HTMLElement` is missing).

| Attribute | Notes |
|---|---|
| `view`, `layers` | URLs of the photo view and layers (`layers` is space-separated); https or same-origin only, relative paths resolve against the page URL; a relative `href` in the view resolves against the view file's URL; a layer's `on` must equal the view's `id` |
| `mode` | `view` (default) or `edit` |
| `tool` | Tool when editing |
| `highlight`, `bolts` (present = all; `bolts="zoom"`), `solo`, `names="false"`, `grade-pill="false"`, `controls="false"`, `wheel="always"` (always on in edit mode), `fit` (`contain`/`cover`/`width`), `swipe` (`swipe="page"`; off in edit mode), `lang` | Map to the options of the same name |

- JS properties: `data` (`{ view, layers, nodes }`; setting it redraws), `viewer` (the current `TopoViewer` or `TopoEditor`), `editor` (the `TopoEditor` when `mode="edit"`, otherwise `undefined`).
- Events: forwards `ready`, `pick`, `zoom`, `swipe`, `swipedown`, `change`, `history`, `select`, `selectpoint`, `tool` (same `detail`); plus `load` (URLs loaded) and `error` (`CustomEvent`, `detail.error`). `crop` and `fork` are not forwarded; use `el.editor.addEventListener`.
- Removing the element from the page detaches all listeners and observers; putting it back rebuilds. Default `display: block; height: 300px`.

## 5. Data format and invariants

Input and output are Climbio public format v2: a photo view (`kind: view`, `surface: photo`) plus route layers (`kind: layer`, `on` is the view id). Vocabulary: `format/VOCABULARY.md`.

| v2 | Drawn as |
|---|---|
| `type: route` node and the `LineString` mark pointing to it | The route's line (first point is the start) |
| Line mark `props.label`, `props.style.stroke` | Number tag text, line color override |
| Route node `props.style` (`sport` blue, others red), `name`, `props.grade` | Line color; grade and name next to the number |
| `Point` mark of a `type: bolt`/`anchor` node (`parent` is the route, `name` is the position `B01`.../`A01`...) | Bolt and anchor tags; mark `props.label` is the material note |
| `Point` mark pointing to a `type: route` node (a route number without a line; ignored and not written when the route has a line) | Number tag centered there; `props.label`, `props.style.stroke`, `props.size` (photo pixels; if present the tag is 1.2x that size and covers a number printed on the photo) |
| View `props.crop` | Visible area; mark coordinates are unaffected |

Invariants:

- v2 has no shared segments; a fork copies the leading points. Segments whose end points are equal count as shared and are drawn once. Code that produces route lines must make collinear routes share one set of points; simplifying each route separately shifts the shared part slightly and every route draws its own.
- Adding a point on a shared segment or moving a shared point moves the forked routes together.
- A route with a drawn line always has a number tag, placed at the first candidate if nothing fits.
- The tag is a route-colored circle (white number) with the grade as a small white label below it (`5.11a` is shortened to `11a`); the circle's top touches the route start. If the start is too close to the photo's bottom edge, the drawn line starts further up the line (display only, data unchanged).
- In crowded topos tags shrink first, then drop the grade; zooming in spreads routes apart and the tags recover to the largest size that fits, with hysteresis so the size never flickers.
- Only routes in `editLayer` can change; the layer from `toLayer()` passes `validate` from `@climbio/format`.
- Tag positions do not depend on which route is selected; what you see while editing is the final result, except the route being edited keeps its ends as-is and shows handles.

## 6. Minimal runnable example

```bash
npm install @climbio/topokit @climbio/format
```

Serve the page from a static server (not `file://`), use `examples/topo.json` (photo view) and `topo-routes.json` (layer) from `@climbio/format`, and replace the view's `href` with your own photo:

```html
<script type="module">
  import '/node_modules/@climbio/topokit/element.js';
</script>
<climbio-topo view="topo.json" layers="topo-routes.json" bolts style="height:70vh"></climbio-topo>
```

JS version (with a bundler):

```js
import { TopoEditor } from '@climbio/topokit';
const view = await (await fetch('topo.json')).json();
const layer = await (await fetch('topo-routes.json')).json();
const editor = new TopoEditor(document.getElementById('host'), { editLayer: 0 });
editor.setData({ view, layers: [layer] });
editor.addEventListener('change', (e) => console.log(e.detail.layer));
editor.addRoute({ label: 9, name: 'New route' });
editor.setTool('line');
```

`demo.html`: from the repo root run `python3 -m http.server 8765` and open `/topokit/demo.html` (loads the sample wall from `format/examples`). The block at the bottom right shows the layer produced by editing.

## 7. Limits and known trade-offs

- `TopoViewer`, `TopoEditor` and the component need a browser DOM and SVG; `renderLines`, `readTopo`, `writeLayer` and the line and view functions run in Node.
- The photo loads from `href` and must be readable cross-origin by the browser; the component only reads https or same-origin URLs.
- By default `wheel` zooms only with Ctrl/Cmd held (Viewer), so the page still scrolls.
- The font is fixed (system font), independent of the app's; colors use the CSS variables `--tk-sport`, `--tk-sport-on`, `--tk-other`, `--tk-other-on`, `--tk-bg`.
- Appearance matches Longdong's screenshot baselines (`baseline/`); changing the layout algorithm means re-shooting the baselines.

## 8. Verification

| What | Command |
|---|---|
| Layout matches Longdong `TopoLines` item by item, v2 round trip (output passes `validate`), shared segments, zoom | `node --test topokit/test/unit.test.mjs` (also part of `npm run test:quick`) |
| Tag layout for crowded routes | `node --test tools/topokit-render.test.mjs` |
| Every topo in the public crags × phone widths 320–768 × zoom 1–6: tags do not overlap, cross other routes, drop below 14 px or leave the photo | `node tools/topokit-audit.mjs` (needs network; `--verbose` lists problems) |
| Browser: demo, editing, touch, cleanup | internal e2e cases; external-install flow internal e2e cases |
