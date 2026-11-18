# mapkit (`@climbio/mapkit`)

Chinese: [README.md](README.md)

## 1. Purpose

View and edit vector crag maps: walls, trails, roads, areas, place names and rescue points, with automatic label avoidance, scale bar and compass; drag to pan, pinch to zoom and rotate; base-map tiles (OpenStreetMap, orthophoto, contours) can be toggled. Editing: draw lines and polygons, move and add/remove vertices, wall facing, undo/redo, output as a layer. Native SVG, plain ES modules, no build step.

- **Use it when**: you have a Climbio public format v2 map view (longitude/latitude) with layers and want to show a crag map or let users edit wall lines or area outlines.
- **Do not use it for**: route lines on photos (use `topokit/`); indoor spray walls (use `routekit/`); positioning, upload, submission or version history (the host app's job; this kit talks to no backend except for tiles).

## 2. License and dependency rules

- License: AGPL-3.0 (`LICENSE`, `NOTICE`); projection, view, label avoidance, drawing, gestures and editing are ported from Longdong, MIT notice in `NOTICE`. `baseline/longdong-map.json` contains OpenStreetMap data (ODbL); `world.json` declares CC0-1.0 in its own `license` field.
- May depend on: browser DOM/SVG; the Web Component uses `fetch`; the base map uses tile URLs (network). Pure functions (`readMap`, `renderMap`, `declutter`, projection, view) need no DOM and run in Node.
- Must not depend on: the Climbio app's `js/`, `holdscan/` (AGPL), the app's `state`, `t()`, DOM element ids, IndexedDB, Firebase, branding.
- Kits are independent: no imports from other kits. Data is only the Climbio public format v2 shape; validate with `validate` from `@climbio/format`.

## 3. File map

| File | Responsibility |
|---|---|
| `index.js` | Entry; re-exports the files below |
| `data.js` | v2 -> map model: `readMap`, `assertMap`, `pickName`, `pathOf`, `centroid`, `BASE_KINDS`, `LINE_KINDS` |
| `render.js` | Map model -> SVG string: `renderMap`, `wallLabelAt`, `SECTOR_LABEL_SCALE` |
| `labels.js` | Label avoidance: `declutter`, `placeLineNames`, `textWidth`, `segmentDistance` |
| `viewport.js` | Projection and view pure functions: `projection`, `toScreen`, `toMap`, `fitRectView`, `zoomAt`, `rotateAt`... |
| `tiles.js` | Base-map tiles: `SOURCES`, `visibleTiles`, `tileLevel`, contour processing |
| `view.js` | `MapViewer`: SVG, gestures, controls, tiles, events, `TEXT` UI strings in several languages |
| `editor.js` | `MapEditor` (extends `MapViewer`): vertex editing, drawing, wall facing, undo/redo |
| `style.js` | The component CSS string `CSS` |
| `element.js` | Web Component `<climbio-map>` (registers on load) |
| `world.json` | World base map (a v2 map view) for world-scale maps |
| `index.d.ts`, `element.d.ts` | Types (hand-written) |
| `demo.html` | Demo page |
| `test/unit.test.mjs`, `baseline/` | Unit tests; scenes, SVG and screenshot baselines matched item by item to Longdong's `ScaleMap` |

## 4. Public API

Longitude/latitude is always `[lng, lat]`; the internal plane coordinates are meters (x east, y south). Full types are in `index.d.ts` and `element.d.ts`.

### MapViewer

`new MapViewer(host: HTMLElement, options?: ViewerOptions)`, extends `EventTarget`.

| Member | Notes |
|---|---|
| `setData({ view, layers?, nodes? })` | Load data; throws if the view is not a v2 map view (`surface: map`) |
| `set(options)` | Update options and redraw |
| `getView() -> { center, metersPerPixel, rotation } \| undefined`, `setView({ center, metersPerPixel, rotation? })` | View (center lng/lat, meters per pixel, rotation in degrees clockwise) |
| `focus({ node? \| points?, tight? })`, `zoomBy(factor)`, `home()` | Frame a node or points, zoom, return to the initial view |
| `toScreen(lngLat) -> [x, y]`, `toLngLat([x, y]) -> [lng, lat]` | Coordinate conversion (for pins placed over the map) |
| `render()` | Redraw |
| `model`, `labels`, `options` | Read-only: map model, names and places drawn last time (screen coordinates), options |
| `destroy()` | Removes all listeners, the ResizeObserver and timers |

Events (`detail`): `pick` (`{ node, line? }`, a wall or rock was tapped), `tap` (`{ at, metersPerPixel }`, `at` is `[lng, lat]`), `view` (same as `getView()`, fired on pan, zoom and frame resize), `areapress` (`{ node }`, an area), `locate`, `error` (`detail` is the error).

Options (`ViewerOptions`, all optional):

| Option | Notes |
|---|---|
| `lang`, `text`, `aria` | Language for names and UI text (`zh`, `en`, `ja`), UI text overrides, accessible name |
| `dim` | Area node id: other areas are faded |
| `hideAreas`, `hide` | Do not draw areas; node ids not drawn (also not tappable) |
| `walls`, `sectorLabels` | Draw walls (default `true`); label sectors when zoomed in (`true` or an array of sector ids) |
| `selected` | Selected wall `{ node, line? }` |
| `basemap` | `{ osm, ortho, contours }`: OpenStreetMap, NLSC orthophoto, 1/5000 topographic contours and coastline |
| `marks`, `here`, `pin`, `draft` | Reported positions, current position with accuracy circle `{ at, accuracy }`, pin, line being drawn `{ points, closed? }` |
| `attribution` | Credit at the bottom right; defaults to the view's `attribution` |
| `controls` | `false`: no compass, zoom buttons or scale bar |
| `locate` | Show the "back to my location" button; pressing it fires `locate` (the app does the positioning and passes the result in `here`) |
| `rotate` | `false`: two fingers only zoom and pan |
| `flat` | `true`: draw land and borders in screen coordinates; for world-scale base maps, recomputed on every redraw |
| `minScale` | Maximum zoom in meters per pixel, default 0.05 |
| `dblclick` | `'home'`: double-click returns to the initial view (default is zoom in) |

### MapEditor

`new MapEditor(host, options?: EditorOptions)`, extends `MapViewer`, adds the options `picking` (controlled mode: taps always fire `tap`), `layer` (a layer to continue editing; keeps its id, license, attribution) and `license`.

- Edit one node at a time: `edit({ node, closed?, faces? })`; polygon or line follows the node's existing marks.
- Shapes: `rings` (read-only), `select(index)`, `draw()`, `finish()`, `cancel()`, `flip(index?)` (reverse a line), `removeRing(index?)`, `removeVertex(vertex, index?) -> boolean` (polygons keep at least three points, lines two; otherwise nothing is removed and it returns `false`).
- History and output: `undo()`, `redo()`, `canUndo`, `canRedo`, `layer` (output layer: one mark per edited node).
- Controlled mode: `setEdit({ rings, closed, selected?, faces? } \| undefined)`; the app supplies the shape and changes fire `editstart`, `editchange` (`{ rings }`) and `select`.
- Events: those of the Viewer plus `change` (`{ layer, node }`), `history` (`{ canUndo, canRedo }`), `select` (`{ index }`), `editstart`, `editchange`.
- Helpers: `faceTrail(line, trails)`, `wallFaces(line)`, `nearestOnSegment(p, a, b)`, `newId()`.

### Data, drawing, layout, view, tiles (pure functions and constants)

| Name | Notes |
|---|---|
| `readMap(view, layers?, nodes?) -> MapModel`, `assertMap(view)` | Read v2; `assertMap` throws for anything that is not a map view |
| `pickName(name, lang)`, `pathOf(line, close?)`, `centroid(ring)`, `BASE_KINDS`, `LINE_KINDS` | Name, SVG path, centroid, supported `props.kind` values |
| `renderMap(model, view, frame, options) -> { svg, labels }`, `wallLabelAt(lines)`, `SECTOR_LABEL_SCALE` | Map as an SVG string |
| `declutter(...)`, `placeLineNames(...)`, `textWidth`, `segmentDistance` | Label avoidance |
| `projection(origin)`, `toScreen`, `toMap`, `mapTransform`, `fitRectView`, `focusView`, `clampView`, `clampScale`, `maxScale`, `panBy`, `zoomAt`, `rotateAt`, `dashLength`, `rectOf`, `MIN_SCALE`, `STEP` | Projection and view |
| `SOURCES`, `visibleTiles(proj, view, frame, source, options?)`, `tileLevel`, `keepContours`, `contourTile(href)` | Tile sources and visible tiles |
| `TEXT`, `LINE_HIT_PX`, `CSS` | UI strings, hit radius, styles |

### Web Component `<climbio-map>`

`import '@climbio/mapkit/element'` (registers on load; does nothing where `HTMLElement` is missing).

| Attribute | Notes |
|---|---|
| `view`, `layers` | URLs of the map view and layers (`layers` is space-separated); https or same-origin only; a layer's `on` must equal the view's `id` |
| `mode` | `view` (default) or `edit` |
| `lang` (default `zh`), `dim`, `basemap` (space-separated `osm`/`ortho`/`contours`), `no-walls`, `locate`, `dblclick="home"`, `controls="false"` | Map to the options of the same name |
| `no-rotate`, `flat`, `min-scale` | Map to `rotate: false`, `flat`, `minScale`; not in the observed list, so changing them later does not apply immediately; set them before the element is created |

- JS properties: `data` (`{ view, layers, nodes }`; setting it updates and fires `ready`), `viewer` (`MapViewer`, or `MapEditor` when `mode="edit"`).
- Events: forwards `view`, `tap`, `pick`, `areapress`, `locate`, `error`, `change`, `history`, `select` (same `detail`); plus `ready` (after data loads). `editstart` and `editchange` are not forwarded; use `el.viewer.addEventListener`.
- Removing the element from the page detaches all listeners and observers; putting it back rebuilds. Default `display: block; height: 300px`.

## 5. Data format and invariants

Input and output are Climbio public format v2: a map view (`kind: view`, `surface: map`, coordinates `[lng, lat]`) plus layers (`kind: layer`). Vocabulary: the "map" section of `format/VOCABULARY.md`.

| v2 | Drawn as |
|---|---|
| Polygon with no node, `props.kind` `land`, `building` or `parking` | Land, buildings, parking |
| Line or polygon with no node, `props.kind` `border` | Country border (constant thin width) |
| Line with no node, `props.kind` `highway`, `tunnel`, `road` or `trail` | Roads (at least real width), tunnels and trails (dashed) |
| Line with no node, `props.kind` `route` | Suggested driving route (thick line over roads, arrows along the drawing direction) |
| Polygon of an `area` or `crag` node; mark `props.style` (`fill`, `stroke`), `props.labelAt` | Area and its name |
| Polygon of a `sector` or `wall` node | Boulders (individual rocks; tapping inside fires `pick`) |
| Line of a `sector` or `wall` node; mark `props.style.stroke` | Wall (along the base); drawing direction sets facing (right-hand side) |
| `Point` of a `poi` node, `props.kind` `rescue`, `parking`, `first-aid`, `boat`, `helicopter`, `hazard`, `place` or `line-name` | Rescue point (`props.label` is the number), parking, first aid, boat, helicopter, hazard, place name (`props.tone`), road name along a line (`props.line`) |
| View `props.bounds`, `extent`, `home` (`[west, south, east, north]`) | Pan limit, base-map data extent, initial view |

Invariants:

- Names are picked by `lang`, falling back to Chinese then English; names may live in `nodes` (for example in a combined file) instead of being copied into the view.
- For a node with marks in several layers, the last layer's shape wins (an edited wall overrides the original).
- Polygons have at least three points, lines at least two.
- The output layer contains only edited nodes, one mark each; the layer passes `validate` from `@climbio/format`.
- A new wall faces the nearest trail by default.

## 6. Minimal runnable example

```bash
npm install @climbio/mapkit @climbio/format
```

Serve the page from a static server (not `file://`) and use `examples/map.json` from `@climbio/format` (a map view whose wall lines are in `marks`):

```html
<script type="module">
  import '/node_modules/@climbio/mapkit/element.js';
</script>
<climbio-map view="map.json" lang="en" basemap="ortho" style="height:70vh"></climbio-map>
```

JS version (with a bundler):

```js
import { MapEditor } from '@climbio/mapkit';
const view = await (await fetch('map.json')).json();
const editor = new MapEditor(document.getElementById('host'), { lang: 'en' });
editor.setData({ view });
editor.edit({ node: 'wall-node-id' });          // replace with the id of a wall/sector node in the view
editor.flip();                                   // face the other side
editor.addEventListener('change', (e) => console.log(e.detail.layer));
```

`demo.html`: from the repo root run `python3 -m http.server 8765` and open `/mapkit/demo.html` (loads the Longdong map from `baseline/longdong-map.json`). You can toggle base maps and pick a sector to edit its wall (drag vertices, press a midpoint on an edge to add a vertex, right-click to delete a vertex, draw, reverse, undo/redo); the output layer is shown below.

## 7. Limits and known trade-offs

- Needs a browser DOM and SVG; the pure functions run in Node.
- Base-map tiles (OpenStreetMap, NLSC orthophoto, contours) are optional external services and need network access; without `basemap` or a connection, your own data still displays and edits. Each source has its own credit, shown at the bottom right.
- World-scale base maps need `flat`, otherwise Android Chrome's GPU drawing places the base map in the wrong spot; `flat` recomputes coordinates on every redraw, so use it only for base maps with few points.
- Colors use CSS variables: `--mk-brand` (line being drawn or edited), `--mk-sea`, `--mk-land`, `--mk-route`; for crag maps without sea, set `--mk-sea` equal to `--mk-land`.
- Appearance matches the Longdong `ScaleMap` baselines (`baseline/`); changing the drawing means regenerating the baselines.

## 8. Verification

| What | Command |
|---|---|
| Layout matches Longdong `ScaleMap` item by item, v2 reading, layers overriding old shapes, view zoom, wall facing | `node --test mapkit/test/unit.test.mjs` (also part of `npm run test:quick`) |
| Browser: demo viewing and editing, base-map tiles, cleanup | internal e2e cases; external-install flow internal e2e cases |
