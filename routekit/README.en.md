# RouteKit (`@climbio/routekit`)

Chinese: [README.md](README.md)

## 1. Purpose

View routes, set routes and export route images on a wall photo: route holds keep their original color, everything else is grayscale, with start/finish/foot tape and move order drawn on top; tap holds to build a route. Draws on a `<canvas>`; front-end only, no build step.

- **Use it when**: you already have a wall as "photo + hold outlines" (hand-drawn or a holdkit hold pack) and want to show route images in your own page or app, let users set routes, or convert between the circle format (RouteMake) and Climbio public format v2.
- **Do not use it for**: detecting holds (use `holdscan/`); line topos on outdoor photos (use `topokit/`); maps (use `mapkit/`); a full route-viewing UI with transitions (zoom and pan are built in with `zoom: true`; transitions are up to the host).

## 2. License and dependency rules

- License: AGPL-3.0 (`LICENSE`, `NOTICE`).
- May depend on: built-in browser Canvas/DOM APIs. The Web Component uses `HTMLElement`, `customElements`, `fetch`.
- Must not depend on: the Climbio app's `js/`, `holdscan/` (AGPL), `state`, `t()`, DOM element ids, IndexedDB, branding, Firebase. All app state comes in through parameters.
- Kits are independent: no imports from other kits. The link to public format v2 is the data shape only; `format.js` does not validate, use `validate` from `@climbio/format`.
- Does not import the app's code (`js/`) or `holdscan/`; usable on its own.
- How routes are drawn and tapped (anything decidable without app state) lives here, with data passed in: photos and holds go through `RouteScene`, and call `touchGeom()` after a hold outline changes. The app calls drawing functions as `RouteKit.…`; geometry helpers (`inPoly`, `area`, `edgePoint`) can be used directly.

## 3. File map

| File | Responsibility |
|---|---|
| `geometry.js` | Outline (`poly`) geometry: `bbox`, `inPoly`, `area`, `tracePoly`, `holdAt`, `edgePoint`, `stripTip`, `edgeTangent`, `strokeOutside` |
| `labels.js` | Markers: tape positions (`typeLabels`, `drawTypeLabels`), move order (`seqBadges`, `drawSeq`), route-setting outline (`strokeRouteHold`), default style `THEME` |
| `base.js` | Route image base: gray, dimmed color, original-color route layer (`grayOf`, `plainGrayOf`, `mutedOf`, `liftTint`, `tintCard`, `routeLayers`, `routeMask`, `routeLayer`, `drawRouteBase`) |
| `scene.js` | `RouteScene`: photo + holds + caches; created by `scene()` |
| `image.js` | `routeHolds`, `cropAround`, `revealSteps`, `drawRoute`, `renderRouteImage`, `thumbCrop`, `routeThumb` |
| `editor.js` | Route-setting rules (data only, no drawing): `tapHold`, `appendSeq`, `insertSeq`, `popSeq`, `dropSeq`, `clearFeet`, `toggleFeetFree`, `MAX_START`, `startCount` |
| `viewport.js` | Zoom and pan (same gestures and bounds as Hold Cat): `Viewport`, `clampView`, `maxScaleOf`, `fitOf`, `ZOOM_STEPS` |
| `viewer.js` | `RouteViewer` and `RouteEditor`, drawn on a canvas |
| `ui.js` | `EditorUI`, the controls (buttons, type row, order bar, sheet) as a pure UI component: it only draws buttons and forwards actions to a controller |
| `circles.js` | Circle format conversion: `fromCircles`, `toCircles`, `CIRCLE_DIAMETER` |
| `format.js` | Climbio public format v2 conversion: `fromFormat`, `wallView`, `routesLayer`, `wallFiles`, `thumbPathOf` |
| `elements.js` | Web Components `<routekit-viewer>`, `<routekit-editor>`; also exports `loadRoute`, `loadLayer` |
| `index.js`, `index.mjs` | npm entry (CommonJS/ESM): merges the files above (not `elements.js`) |
| `index.d.ts`, `elements.d.ts` | Types |
| `demo.html` | Demo page |

Every `.js` is UMD: in the browser load them in order with `<script>` and they attach to the global `RouteKit`; in Node use `require`. Dependency order: `geometry` -> `labels`, `base` -> `scene`, `image` -> `editor` -> `viewport` -> `viewer`, `circles`, `format` -> `elements`.

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
- `liftTint(ctx, W, H, rgb?)`, `tintCard(ctx, S)`, `routeLayers(routeHolds, all)`, `routeMask(ctx, routeHolds, all)`, `routeLayer(img, routeHolds, all, { tint? })`, `drawRouteBase(ctx, scene, routeHolds, { mode?, tint?, glow? })`: original-color route layer and base. `mode` is `'gray'` (default) or `'dim'`.
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
- `thumbCrop(W, H, routeHolds) -> { sx, sy, side }`, `routeThumb(scene, routeHolds, S = 300, { mode?, route?, theme? }?) -> canvas` (with `crop`): square card, grayscale base by default; `mode: 'dim'` is the dimmed look, and passing `route` adds the glow (same as the view and edit screens; use this for route-list thumbnails).

### Route-setting rules (`editor.js`)

| Name | Signature | Behavior |
|---|---|---|
| `MAX_START` | `number` (2) | Start hold limit |
| `startCount` | `(route) -> number` | Number of start holds on the route |
| `tapHold` | `(route, id, type, { maxStart?, justAdded? }?) -> 'added' \| 'changed' \| 'removed' \| 'full' \| 'ignored'` | Not on the route: add. Different type: change. Same type: remove (also from `seq`). Start slots full: a new hold becomes `h`; a hold already on the route returns `'full'` and is left alone. `maxStart` defaults to 2 (Hold Cat); some gyms require 4. `justAdded` true with same type: `'ignored'` |
| `appendSeq` | `(route, id) -> boolean` | Append a move; a hold not on the route is added as `h` first; returns whether it was newly added |
| `insertSeq` | `(route, id, at) -> boolean` | Insert a move at index `at` of `seq` (0-based, past the end means last); later moves shift; otherwise like `appendSeq` |
| `popSeq` | `(route, added, at?) -> void` | Undo the move at `at` (default the last); if `added` is true and the hold is `h`, remove it too |
| `clearFeet` | `(route) -> number` | Remove every foot hold from the route (and from `seq`); returns how many |
| `toggleFeetFree` | `(route) -> boolean` | Toggle `route.feetFree` (feet free) and return the new state; the field is deleted when off |
| `dropSeq` | `(route, id) -> void` | Remove the hold from `seq` everywhere |

These functions mutate the `route` you pass in.

### Zoom and pan (`viewport.js`)

Same rules as Hold Cat: pinch to zoom, one-finger/mouse drag to pan, double-tap (on empty space when editing) to zoom 2.5x or return to the home view when already zoomed, wheel zoom; the minimum is the whole photo (centered when smaller than the frame), panning never exposes empty edges, and the maximum is 1 photo pixel = 4 screen points (at least 10x); with floating toolbars, `pads()` returns `[top, bottom]` heights so you can pan the extra two bands and reach the topmost and bottommost holds. Releasing a drag never taps a hold.

- `new Viewport(canvas, { w, h }, { onChange, pads?, home?, canZoomAt? })`: gestures live on the canvas; `onChange({ s, k, tx, ty })` is the view (photo coordinates -> canvas, in screen CSS pixels); `enable(on)` turns gestures on/off (off hands the canvas back to the browser); `reset()`, `flyTo(view)`, `zoomTo(s, x, y)`, `zoomStep(+-1)` (steps `ZOOM_STEPS`).
- `clampView(s, tx, ty, { W, H, bw, bh, pads?, maxScale? })`, `maxScaleOf(photoWidth, fittedWidth)`, `fitOf(W, H, photoW, photoH)`: pure functions, usable in Node.
- `zoom: true` on `RouteViewer` / `RouteEditor` (or `setZoom(on)` later) uses it directly: the viewer's home view is the route view, the editor's is the whole photo; `pads` gives the toolbar heights; `onView(view)` is called after zoom/pan; `zoomStep(+-1)`, `resetView()`, `zoomed`.

### Components (`viewer.js`)

- `new RouteViewer(canvas, { scene, route, theme?, mode?, glow? })`: frames around the route; `glow: true` draws a role-colored glow around the route holds (dimmed base, route holds in original color, a faint halo plus a thin role-colored outline on each route hold, no hand tape; off by default; with glow on, volumes are not tinted: route holds are told apart by the glow, holds without it are not on the route); a `ResizeObserver` redraws on size change. Members: `setRoute(route)`, `setMode(mode)`, `render()`, `destroy()`, read-only `routeHolds`.
- **Hold Cat and the embed share the same rules**: overlapping-hold picking (`holdsUnder`, `overlapSpots`, `pickOverlap`, drawn by `drawOverlapPick`), the show-all-holds heat map (`holdUse`, `heatLevel`, drawn by `strokeHoldOutline`), switching to hand holds when starts are full (`nextType`), and move-order add / insert / delete / undo (`orderSession`). `RouteEditor` uses all of them; the host only draws buttons and dialogs via `onType`, `onOrder` / `onOrderAsk`, `heatRoutes` / `setShowAll`, `toggleFeetFree`.
- **Long-press to draw freehand (touch)**: `RouteEditor` option `draw: true` (or `setDrawMode(on)`): on touch / pen, long-press an empty spot and keep the finger down to trace around a hold, with a magnifier; on release the trail is simplified into a polygon (`freehandPoly`: ends joined, Douglas-Peucker, at most 20 vertices, `null` if too small) and added to the route as the route's own outline (`route.shapes`), same rules as tapping a hold. A mouse never triggers it.
- `new RouteEditor(canvas, { scene, route, theme?, type?, mode?, glow?, maxStart?, onChange?, onLimit?, onType?, onOrder?, onOrderAsk?, heatRoutes?, showAll? })`: whole photo, dimmed base by default (`mode: 'gray'` for grayscale). `type` is `s`/`h`/`f`/`t` or `n` (append move order); default `s`. A canvas `click` runs `holdAt` (including `route.shapes`), then `tapHold`/`appendSeq`; on change it redraws and calls `onChange(route)`. Tapping a just-added hold again within 400 ms does not remove it. Mutates the `route` you pass. `maxStart` (start hold limit, default 2; some gyms require 4): when full, a new hold becomes a hand hold, and a hold already on the route cannot become a start hold (nothing changes and `onLimit()` is called). Members: `setRoute`, `setMode(mode)`, `setType(type)`, `undoSeq()` (takes back the most recent move added in order mode, repeatable; returns whether anything was undone), `canUndoSeq`, `setMaxStart(n)`, `render`, `destroy` (removes the click listener and ResizeObserver).
- The canvas needs a CSS size (`clientWidth`/`clientHeight`); the pixel size is set by the component from `devicePixelRatio`.

### Controls UI (`ui.js`, a pure UI component)

The route-setting / route-viewing buttons: round buttons on top (cancel, dimmed/grayscale, show all holds, zoom, fullscreen, done), the type row at the bottom (start, hand, top, foot, order), the order bar and the bottom sheet. Hold Cat's route page, the embed page (iframe/WebView) and the future 3D embed all use this one component, so there is one style and one set of rules. **It only draws buttons and forwards actions to a controller; it never saves, syncs or shares, and knows nothing about app state.**

- `const ui = RouteKit.EditorUI.mount(host, { mode, lang, strings, base, controls, foot, order, heat, zoom, fullscreen, interactive, fullscreenOn, colors, type, onDone, onCancel, onBase, onFullscreen, onLimit })`: `host` must be a positioned container (the component fills it; empty areas do not block gestures). `strings` overrides texts (string or function; Traditional Chinese and English built in).
- **Controller** (`ui.attach(controller, () => route)`): `RouteEditor`, `RouteViewer`, or anything with the same methods (e.g. a 3D wall stage): `type`, `setType`, `setMode`, `showAll`, `setShowAll`, `zoomStep`, `canUndoSeq`, `undoSeq`, `orderInfo`, `orderInsertAfter`, `orderRemove`, `orderClear`, `orderEndInsert`, `toggleFeetFree`. The rules (start limit, order, any feet) live in the controller; the component does not recompute them.
- Editor callbacks: `new RouteEditor(canvas, { ..., pads: () => ui.pads(canvas), ...ui.hooks, onChange: () => { ...; ui.update(); } })`.
- "Done" needs both a start and a top hold; the start button shows no (n/limit) counter.
- Methods: `update()`, `setOptions({...})`, `pickType(t)`, `detach()`, `destroy()`; elements carry `data-rk` and `rk-` classes (styles are injected by `ui.js`; variables `--rk-s`, `--rk-h`, `--rk-t`, `--rk-f`).

### Circle format (`circles.js`)

- A circle is `{ x, y, t, r }`: `x`, `y` are the center as a percentage of photo width/height; `t` is `s`/`h`/`t`; `r` is 1/2/3, diameter 4.5%/7%/10% of photo width (`CIRCLE_DIAMETER`).
- `fromCircles(circles, w, h, { holds? }?) -> Route`: a circle center maps to the hold containing it, else to the nearest hold within the circle's radius (half its diameter); circles with no hold in range become 24-gon outlines in `shapes` (ids `c0`, `c1`... in circle order); unknown `t` becomes `h`; when several circles hit one hold, `s` and `t` win.
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
  - At most `MAX_START` (2) start holds, changeable with `maxStart` (some gyms require 4).
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
- Only framing and tapping by default; zoom and pan with `zoom: true`; transitions are up to the host (the same drawing functions can be used directly).
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

## 9. Embed (iframe and native apps)

Sites and apps that do not want to open-source their front end embed the screen hosted at climbio.app with an `<iframe>` (web) or a WebView (iOS, Android, React Native, Flutter) instead of bundling the kit (AGPL-3.0 only requires front ends that bundle the kit to be open). General approach and security rules: [docs/embed.md](../docs/embed.md) (Traditional Chinese); the types in [embed/routekit/v1/messages.d.ts](../embed/routekit/v1/messages.d.ts) are the source of truth.

- URL: `https://embed.climbio.app/routekit/v1/`. Size the iframe however you like; the picture and buttons adapt to the frame.
- URL options: `mode=view|edit` (default view), `type=s|h|t|f|n` (hold role when tapping in edit mode: start, hand, top, foot, order; default `s`), `foot=0` / `order=0` (hide foot / order in the edit toolbar, both shown by default), the base is always dimmed color with a glow for viewing and editing, with no grayscale toggle (grayscale stays a Hold Cat feature), `maxStart=` (start hold limit, default 2 as in Hold Cat; some gyms require 4), `heat=0` (hide the show-all-holds button), `lang=zh|en` (text of the embed's buttons and menus), `color-s/h/t/f=22c55e` (the four role colors), `label-s/t=A` (the text on the start / top tape), `controls=0` (hide the buttons; the host drives everything with messages and the picture is directly interactive), `tap=edit` (interact in place, no fullscreen). `options` in `init` and `setOptions` override them at any time.
- **The small frame is a preview; one tap enters fullscreen** (view and edit alike): no tools cover the picture, only a small enter-fullscreen icon; tools, zoom/pan and editing live in fullscreen. With `allow="fullscreen"` on the iframe the browser's fullscreen is used; otherwise (iPhone Safari, native apps) the page sends `fullscreen { on }`, the host enlarges the iframe to the whole screen and answers `setFullscreen { on }` (no answer within 0.7 s: it works in place). For a frame that is big enough, add `tap=edit`.
- Fullscreen tools: dimmed/grayscale, zoom out/in, exit fullscreen; in edit mode the top is like Hold Cat: cancel (cross, the route goes back to how it was when opened, sends `cancel`) at the left, done (check, sends `done { layer, routeId }`) at the right, leaving fullscreen if it is on; no grade or name (the host form handles those); the bottom toolbar matches Hold Cat: start (shows count and limit) / hand / top / foot / order with a color block that slides to the selected one(no tools Hold Cat lacks; tap a selected hold again to remove it); hide foot and order with `foot=0`, `order=0` (both shown by default). Zoom and pan are the same as Hold Cat (see "Zoom and pan" above).
- Data is always Climbio's officially published public format v2: the host gives three official URLs in `init` (`viewUrl`, `photoUrl`, `layerUrls`) and the embed page reads them itself; other URLs and data passed directly in messages are not accepted. Envelope: `{ climbio: 'routekit', v: 1, type, … }`. Full rules: [docs/embed.md](../docs/embed.md).
- Embed → host: `ready` (sent once), `done { layer, routeId }` (edit finished), `cancel` (edit cancelled), `change { layer, routeId }` (route changed: a v2 layer holding just that route), `limit { max }` (start holds are full: a hold already on the route cannot become a start hold; nothing changed), `fullscreen { on }`, `error { message }`.
- Host → embed: `init { viewUrl, photoUrl, layerUrls?, routeId?, layerId?, viewHref?, options? }` (must be first; the photo behind `photoUrl` is up to 10 MB with size equal to the view's `w × h`), `setRoute { routeId? }`, `setType { holdType }` (`s`, `h`, `t`, `f`, `n`), `setOptions { base?, maxStart?, controls?, foot?, order? }`, `setFullscreen { on }`.
- iframe: register the `message` listener before adding the `<iframe>`; the embed pins the `event.origin` of the first `init` and only talks to that origin afterwards. Native app: open the URL directly; the page posts to `window.ReactNativeWebView`, `webkit.messageHandlers.climbio`, `ClimbioBridge` (Android `addJavascriptInterface`) or the `climbio` handler of `flutter_inappwebview`, and the app sends messages with `window.climbioReceive(message or JSON string)`.
- Zoom and pan on the embed page are the kit's `zoom` (same as Hold Cat); it does not output the circle format, convert with `toCircles` yourself.

Minimal example:

```html
<script>
  addEventListener('message', (e) => {
    const frame = document.getElementById('rk');
    if (e.source !== frame.contentWindow || e.data?.climbio !== 'routekit') return;
    if (e.data.type === 'ready') frame.contentWindow.postMessage({ climbio: 'routekit', v: 1, type: 'init', viewUrl, photoUrl, layerUrls }, '*');   // three official URLs, see docs/embed.md
    if (e.data.type === 'change') save(e.data.layer);
    if (e.data.type === 'fullscreen') {   // 進（出）全螢幕：放大（縮回）iframe，再回報
      frame.classList.toggle('full', e.data.on);
      frame.contentWindow.postMessage({ climbio: 'routekit', v: 1, type: 'setFullscreen', on: e.data.on }, '*');
    }
  });
</script>
<style>
  .rk { width: 100%; height: 480px; border: 0; }
  .rk.full { position: fixed; inset: 0; width: 100%; height: 100%; z-index: 1000; }   /* 小畫面點一下進全螢幕：iframe 放大成整個畫面 */
</style>
<iframe id="rk" class="rk" src="https://embed.climbio.app/routekit/v1/?mode=edit&maxStart=4" allow="fullscreen" title="定線"></iframe>
```

Verification: `node --test tools/embed.test.mjs` (plus cross-origin embed browser tests); run `node tools/build-embed.mjs` after changing the kit or shared code.
