# RouteKit (`@climbio/routekit`)

Chinese: [README.md](README.md)

## 1. Purpose

View routes, set routes and export route images on a wall photo: route holds keep their original color, everything else is grayscale, with start/finish/foot tape and move order drawn on top; tap holds to build a route. Draws on a `<canvas>`; front-end only, no build step.

- **Use it when**: you already have a wall as "photo + hold outlines" (hand-drawn or a holdkit hold pack) and want to show route images in your own page or app, let users set routes, or convert between the circle format (RouteMake) and Climbio public format v2.
- **Do not use it for**: detecting holds (use `holdscan/`); line topos on outdoor photos (use `topokit/`); maps (use `mapkit/`); a full route-viewing UI with zoom, pan and transitions (this kit only does framing and tapping; the host app does the rest).

## 2. License and dependency rules

- License: AGPL-3.0 (`LICENSE`, `NOTICE`).
- May depend on: built-in browser Canvas/DOM APIs. The Web Component uses `HTMLElement`, `customElements`, `fetch`.
- Must not depend on: the Climbio app's `js/`, `holdscan/` (AGPL), `state`, `t()`, DOM element ids, IndexedDB, branding, Firebase. All app state comes in through parameters.
- Kits are independent: no imports from other kits. The link to public format v2 is the data shape only; `format.js` does not validate, use `validate` from `@climbio/format`.
- Does not import the app's code (`js/`) or `holdscan/`; usable on its own.

## 3. File map

| File | Responsibility |
|---|---|
| `geometry.js` | Outline (`poly`) geometry: `bbox`, `inPoly`, `area`, `tracePoly`, `holdAt`, `edgePoint`, `stripTip`, `edgeTangent`, `strokeOutside` |
| `labels.js` | Markers: tape positions (`typeLabels`, `drawTypeLabels`), move order (`seqBadges`, `drawSeq`), route-setting outline (`strokeRouteHold`), default style `THEME` |
| `base.js` | Route image base: gray, dimmed color, original-color route layer (`grayOf`, `plainGrayOf`, `mutedOf`, `liftTint`, `tintCard`, `routeLayers`, `routeMask`, `routeLayer`, `drawRouteBase`) |
| `scene.js` | `RouteScene`: photo + holds + caches; created by `scene()` |
| `image.js` | `routeHolds`, `cropAround`, `revealSteps`, `drawRoute`, `renderRouteImage`, `thumbCrop`, `routeThumb` |
| `editor.js` | Route-setting rules (data only, no drawing): `tapHold`, `appendSeq`, `popSeq`, `dropSeq`, `MAX_START`, `startCount` |
| `viewer.js` | `RouteViewer` and `RouteEditor`, drawn on a canvas |
| `circles.js` | Circle format conversion: `fromCircles`, `toCircles`, `CIRCLE_DIAMETER` |
| `format.js` | Climbio public format v2 conversion: `fromFormat`, `wallView`, `routesLayer`, `wallFiles`, `thumbPathOf` |
| `elements.js` | Web Components `<routekit-viewer>`, `<routekit-editor>`; also exports `loadRoute`, `loadLayer` |
| `index.js`, `index.mjs` | npm entry (CommonJS/ESM): merges the files above (not `elements.js`) |
| `index.d.ts`, `elements.d.ts` | Types |
| `demo.html` | Demo page |

Every `.js` is UMD: in the browser load them in order with `<script>` and they attach to the global `RouteKit`; in Node use `require`. Dependency order: `geometry` -> `labels`, `base` -> `scene`, `image` -> `editor` -> `viewer`, `circles`, `format` -> `elements`.

## 4. Public API

All coordinates are photo pixels. `index.d.ts` and `elements.d.ts` are authoritative for types. Below, `Ctx` is a 2D canvas context and `Photo` is `<img>`/canvas/OffscreenCanvas/ImageBitmap.

### Entry points

- `import RouteKit, { scene, RouteViewer, ... } from '@climbio/routekit'` (`require` also works): the default export and the named exports are the same members.
- `import '@climbio/routekit/elements'`: registers the Web Components (side effect). Loading it server-side (no `HTMLElement`) does nothing; importing the other files never touches `window` or `document`, but drawing has to happen in the browser.

### Geometry (`geometry.js`)

| Name | Signature | Notes |
|---|---|---|
| `bbox` | `(poly) -> { x0, y0, x1, y1 }` | Bounding box |
| `inPoly` | `(x, y, poly) -> boolean` | Point-in-outline test |
| `area` | `(poly) -> number` | Area |
| `tracePoly` | `(ctx, poly) -> void` | Traces the path and calls `closePath` |
| `holdAt` | `(holds, x, y) -> Hold \| null` | Smallest hold containing the point |
| `edgePoint` | `(poly, dx, dy, centerEdge?) -> [x, y]` | Edge point along a direction |
| `stripTip`, `edgeTangent`, `strokeOutside` | see `index.d.ts` | Tape tip, edge tangent, outside stroke |

### Markers (`labels.js`)

| Name | Signature |
|---|---|
| `THEME` | `{ colors: { s, h, f, t }, font, text: { s, t } }`, default style |
| `typeLabels` | `(scene, routeHolds, route, unit, hands?, theme?) -> label[]` |
| `drawTypeLabels` | `(ctx, labels, unit, theme?) -> void` |
| `seqBadges`, `drawSeq` | `(ctx, scene, route, unit, labels, routeHolds[, theme])`, move order |
| `strokeRouteHold` | `(ctx, poly, type, L, theme?) -> void`; `L(screen, photo)` converts screen pixels to photo pixels |

### Base (`base.js`) and RouteScene (`scene.js`)

- `grayOf(img)`, `plainGrayOf(img)`, `mutedOf(img)` -> canvas: grayscale, grayscale (luminance squeezed plus cool gray), dimmed color.
- `liftTint(ctx, W, H, rgb?)`, `tintCard(ctx, S)`, `routeLayers(routeHolds, all)`, `routeMask(ctx, routeHolds, all)`, `routeLayer(img, routeHolds, all, { tint? })`, `drawRouteBase(ctx, scene, routeHolds, { mode?, tint? })`: original-color route layer and base. `mode` is `'gray'` (default) or `'dim'`.
- `scene(img, holds)` -> `RouteScene`; `holds` is an array or a function returning one. `new RouteScene(img, holds)` is equivalent.

`RouteScene` members:

| Member | Notes |
|---|---|
| `img`, `w`, `h`, `holds`, `version` | Photo, size, holds, outline version (incremented by `touch()`) |
| `plain(mode?)`, `muted` | Shared base, photo-sized, one per wall, computed on first use |
| `routeLayer(routeHolds, { tint? })` | Original-color layer for route holds (only as large as their bounding box); keeps the latest 3 |
| `drawBase(ctx, routeHolds, { mode?, tint? })` | Draws base + route layer |
| `labels(routeHolds, route, unit, hands?, theme?)` | Tape positions, cache of 60 |
| `prefetch(jobs, alive?)` -> `Promise<void>` | Pre-draws likely next routes while idle, yielding after each |
| `touch()` | Outlines changed; invalidates caches |
| `release()` | Drops the shared base and layers |
| `recover(lost)` -> boolean | Redraws after the system cleared canvases (iOS background) |

### Route image (`image.js`)

- `routeHolds(route, holds) -> Hold[]`: holds a route uses; `route.shapes` wins, otherwise the wall's hold; ids found in neither are skipped.
- `cropAround(routeHolds, PW, PH, aspect) -> { x, y, w, h }`: framing centered on the route with room for labels, never outside the photo.
- `revealSteps(route, routeHolds) -> Hold[][]`: order in which holds light up (start and feet, hands in move order, finish).
- `drawRoute(ctx, scene, route, routeHolds, { unit?, mode?, tint?, hands?, theme? })`: the ctx must already have the photo-coordinate transform set.
- `renderRouteImage(scene, route, routeHolds, { theme? }) -> canvas`: full-size route image, no branding.
- `thumbCrop(W, H, routeHolds) -> { sx, sy, side }`, `routeThumb(scene, routeHolds, S = 300) -> canvas` (with `crop`): square card.

### Route-setting rules (`editor.js`)

| Name | Signature | Behavior |
|---|---|---|
| `MAX_START` | `number` (2) | Start hold limit |
| `startCount` | `(route) -> number` | Number of start holds on the route |
| `tapHold` | `(route, id, type, { maxStart?, justAdded? }?) -> 'added' \| 'changed' \| 'removed' \| 'full' \| 'ignored'` | Not on the route: add. Different type: change. Same type: remove (also from `seq`). Start slots full: a new hold becomes `h`; a hold already on the route returns `'full'` and is left alone. `justAdded` true with same type: `'ignored'` |
| `appendSeq` | `(route, id) -> boolean` | Append a move; a hold not on the route is added as `h` first; returns whether it was newly added |
| `popSeq` | `(route, added) -> void` | Undo the last move; if `added` is true and the hold is `h`, remove it too |
| `dropSeq` | `(route, id) -> void` | Remove the hold from `seq` everywhere |

These functions mutate the `route` you pass in.

### Components (`viewer.js`)

- `new RouteViewer(canvas, { scene, route, theme?, mode? })`: frames around the route; a `ResizeObserver` redraws on size change. Members: `setRoute(route)`, `render()`, `destroy()`, read-only `routeHolds`.
- `new RouteEditor(canvas, { scene, route, theme?, type?, onChange? })`: whole photo, dimmed base. `type` is `s`/`h`/`f`/`t` or `n` (append move order); default `s`. A canvas `click` runs `holdAt` (including `route.shapes`), then `tapHold`/`appendSeq`; on change it redraws and calls `onChange(route)`. Tapping a just-added hold again within 400 ms does not remove it. Mutates the `route` you pass. Members: `setRoute`, `setType(type)`, `render`, `destroy` (removes the click listener and ResizeObserver).
- The canvas needs a CSS size (`clientWidth`/`clientHeight`); the pixel size is set by the component from `devicePixelRatio`.

### Circle format (`circles.js`)

- A circle is `{ x, y, t, r }`: `x`, `y` are the center as a percentage of photo width/height; `t` is `s`/`h`/`t`; `r` is 1/2/3, diameter 4.5%/7%/10% of photo width (`CIRCLE_DIAMETER`).
- `fromCircles(circles, w, h, { holds? }?) -> Route`: a circle center maps to the hold containing it; unmatched ones become 24-gon outlines in `shapes` (ids `c0`, `c1`... in circle order); unknown `t` becomes `h`; when several circles hit one hold, `s` and `t` win.
- `toCircles(route, holds, w, h) -> Circle[]`: center of the bounding box, nearest `r`; `f` becomes `h`; `seq` is not carried over.

### Climbio public format v2 (`format.js`)

Converts only; does not validate.

- `fromFormat(view, layers?) -> { w, h, holds, routes }`: reads a photo view (`kind: view`, `surface: photo`) and route layers. A layer mark with `props.route` is that route's own outline and goes into that route's `shapes`; other routes use the wall's. Route fields: `id`, `name`, `grade`, `holds`, `seq?`, `shapes`, `author`, `t`, `u?`, `color?`.
- `wallView({ pid, name?, w, h, holds?, href, thumb?, attribution?, t?, license?, author?, sha256?, props? }) -> view`: wall -> photo view. Holds with an invalid id or fewer than three points are skipped; `license` defaults to `CC-BY-SA-4.0`.
- `routesLayer({ id, pid, href, w, h, holds?, routes?, gym?, thumb?, props?, attribution?, name?, t?, license?, author? }) -> layer`: routes -> layer over the wall. A route outline identical to the view's is not written; a different one becomes a mark with `props.route`; holds missing from the view become `hold` nodes in the layer.
- `wallFiles({ pid, layerId?, name?, w, h, holds?, routes?, gym?, photo, thumb?, attribution?, t?, view?, layer? }) -> { files: [{ path, bytes }], view, layer, entry, thumbPath }`: the files published for one wall (`{pid}.json`, `{pid}.jpg`, `{pid}.thumb.jpg`, `{layerId}.json`); `photo` and `thumb` are `Uint8Array` (JPEG); no `layerId` means no layer.
- `thumbPathOf(pid) -> string`: `{pid}.thumb.jpg`.

### Web Components (`elements.js`)

| Tag | Attributes | Events |
|---|---|---|
| `<routekit-viewer>` | `src` (route layer URL), `route-id` (which route in the layer; default: first), `mode` (`gray` default / `dim`) | `load`, `error` (`ErrorEvent`) |
| `<routekit-editor>` | `src`, `route-id`, `type` (`s`/`h`/`f`/`t`/`n`, default `s`) | `load`, `error`, `change` (`detail` is the route) |

- JS properties: `photo` (a loaded `<img>`/canvas), `holds`, `route`, `theme`, `canvas` (inside the shadow DOM). Nothing is drawn until both `photo` and `route` are set.
- `src` must be https or same-origin. The element loads the layer, then the wall view and photo that the layer's `href` points to (relative paths resolve against each file's URL). `error` fires for: not a v2 layer, wall does not match, no route, HTTP failure, photo load failure.
- The module also exports `loadLayer(src) -> Promise<{ photo, holds, routes }>`, `loadRoute(src, routeId?) -> Promise<{ photo, holds, route }>`, `RouteKitViewer`, `RouteKitEditor`.
- Default `display: block; height: 300px`; override with CSS. The canvas is styleable via `::part(canvas)`.

## 5. Data format and invariants

- Hold: `{ id, poly: [[x, y], ...], source?, retired? }`; `retired: true` marks a hold that was published and later deleted or merged away: it stays in the wall view so other people's older routes still resolve, route shapes read by `fromFormat` do not carry the flag, and apps should not let new routes pick it; `poly` is in photo pixels with at least three points (same as `holds` in a holdkit hold pack, see `holdkit/SPEC.md`).
- Route (Kit-native): `{ holds: { holdId: 's'|'h'|'f'|'t' }, seq?, shapes?, id?, name?, grade?, author?, t?, color? }`. `seq` lists hold ids in move order and may repeat a hold; `shapes` are route-specific outlines that win over the wall's holds; `color` is a tape color name.
- Invariants:
  - At most `MAX_START` (2) start holds.
  - `seq` only contains holds on the route; removing a hold also removes it from `seq`; an empty `seq` is deleted.
  - Call `scene.touch()` after outlines change so caches are invalidated.
  - Kit-native routes and v2 routes (route nodes plus marks in a layer) must not be mixed: draw and edit with native, store and exchange with v2, converting through `fromFormat`/`routesLayer`.
  - The license fields of the public format are the caller's responsibility; `wallView`/`routesLayer` default to `CC-BY-SA-4.0`.

## 6. Minimal runnable example

In your own project run `npm install @climbio/routekit`, and load it from a project with a bundler (or serve the files statically and load them as ES modules).

```html
<canvas id="c" style="width:100%;height:400px;display:block"></canvas>
<script type="module">
  import { scene, RouteViewer, RouteEditor } from '@climbio/routekit';

  const img = new Image();
  img.src = 'wall.jpg';                      // same-origin image, or one served with CORS
  await img.decode();

  const sq = (x, y) => [[x, y], [x + 80, y], [x + 80, y + 80], [x, y + 80]];
  const holds = [{ id: 'a', poly: sq(100, 600) }, { id: 'b', poly: sq(300, 400) }, { id: 'c', poly: sq(450, 150) }];
  const route = { holds: { a: 's', b: 'h', c: 't' }, seq: ['a', 'b', 'c'] };

  const s = scene(img, holds);
  new RouteViewer(document.getElementById('c'), { scene: s, route });
  // Route setting: new RouteEditor(canvas, { scene: s, route, type: 'h', onChange: (r) => console.log(r) });
</script>
```

- `demo.html`: from the repo root run `python3 -m http.server 8765` and open `/routekit/demo.html`. By default it uses a drawn sample wall and reads no other files; `?route=<https URL of a route layer>` loads a shared route.
- Minimal public-format flow: `npm install @climbio/routekit @climbio/format`, take `examples/wall.json` (view) and `wall-routes.json` (layer) from the `format` package, call `RouteKit.fromFormat(wall, [layer])` to get `{ w, h, holds, routes }`, then pass `scene(photo, holds)` to `RouteViewer`/`RouteEditor`.

## 7. Limits and known trade-offs

- Drawing needs browser Canvas 2D. Geometry (`geometry.js`), route-setting rules (`editor.js`) and format conversion (`circles.js`, `format.js`) run in Node; drawing and components do not.
- Only framing and tapping; zoom, pan and transitions are up to the host (the same drawing functions can be used directly).
- The photo must be readable by canvas (same-origin or CORS). The Web Component `src` only accepts https or same-origin.
- Foot holds (`f`) have no equivalent in the circle format and become hand holds on export; `seq` is not carried over.
- After the system clears canvases (iOS background), call `scene.recover(lost)` and redraw yourself.

## 8. Verification

| What | Command |
|---|---|
| Circles, route-setting rules, layers, outlines (Node logic) | `node --test tools/route-circles.test.mjs tools/route-editor.test.mjs tools/route-layers.test.mjs tools/route-shapes.test.mjs` |
| Format conversion, wall files, npm entry and types | `node --test tools/share-format.test.mjs tools/wall-files.test.mjs tools/kit-packages.test.mjs` |
| Browser (components, demo) | `npx playwright test routekit.spec.mjs`; external-install flow internal e2e cases |
| Whole quick check | `npm run test:quick` |
