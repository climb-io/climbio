# Climbio

An open climbing platform: two apps for climbers and one workbench for the people who prepare the data. Routes, photos and topos share one open format that people can read, and so can AI.

- **Hold Cat** (`/hold/`, indoor): photograph a wall, get the holds detected, tap holds to set a route, and share a route image or link. No sign-in needed.
- **Redpoint Cat** (`/redpoint/`, outdoor): collect crags from World, then read topos, routes and 3D views offline and log your ascents.
- **Climbio Studio** (`/studio/`): turn photos and existing guidebooks into Guidebooks and publish them.
- **Open format and Kits**: `format/` and every Kit can be used on its own in your site or app; see the layout below.

The production site is **https://climbio.app**. Data stays on your device by default; any site other than climbio.app runs without a backend, so the folder works on any static host (see [docs/open-source.md](docs/open-source.md)).

To contribute: people read [CONTRIBUTING.md](CONTRIBUTING.md); AI agents start with [AGENTS.md](AGENTS.md).

The [website documentation](https://climbio.app/en/guides/) includes the app manuals, Studio guide, crag data resources, open format, and kits. The repository specifications are written in Traditional Chinese. The code identifiers, commands and file paths are in English, and the app UI supports Traditional Chinese, Simplified Chinese, English, Japanese, French, Korean, Spanish and German.


## Run it

There is no build step. Serve the folder with any static server:

You need Node.js 22 or later and Python 3. First time:

```bash
npm ci && npm ci --prefix functions   # test dependencies (the Cloud Functions tests need functions/)
npx playwright install chromium       # Chromium for the browser tests
python3 tools/serve-test.py 8765      # local server; keeps this terminal busy
```

Open http://localhost:8765/hold/. The first screen is the welcome screen; tap the start button and pick a photo of a climbing wall to detect holds and set a route. (Desktop browsers can use the app directly; the layout adapts to the window width.) The local site has no backend, so data stays in that browser.

On Windows, use `python` instead of `python3`. Use the project's server so `.mjs` files have the correct JavaScript content type; otherwise Redpoint Cat and backup tools may fail to load.

In another terminal:

```bash
npm run test:quick                                                              # syntax, language packs, Node tests
npm run test:smoke                                                              # browser smoke tests (start their own server on port 8876; CI runs these too)
```

[docs/development.md](docs/development.md) lists which browser specs to run for which change, and [docs/architecture.md](docs/architecture.md) maps the files and the data flow.

To convert an existing guidebook without opening Studio (for example from an AI agent), use `tools/guidebook.mjs`: read, check, build, apply targeted fixes and validate, each step producing the same `report.json` issue list. See the command-line section of [docs/guidebook-convert-format.md](docs/guidebook-convert-format.md) (Chinese); `npm run eval:convert` compares the fixed conversion cases in `tests/convert/`.

Opened from any host other than the official one, the app runs without a backend: everything is stored on the device. See [docs/open-source.md](docs/open-source.md) to host your own site (rename, icons, optional Firebase backend).

## Layout

| Path | What | License |
|---|---|---|
| `js/`, `hold/index.html`, `css/` | The app (plain scripts loaded in order, shared global scope) | AGPL-3.0 |
| `holdscan/` | On-device hold detection (YOLOv8n via onnxruntime-web) and an optional cloud function | AGPL-3.0 |
| `holdkit/` | Hold outlines, MobileSAM re-tracing, hold data format | AGPL-3.0 |
| `routekit/`, `topokit/`, `mapkit/` | Route viewer/editor, photo topo, crag map | AGPL-3.0 |
| `wall3dkit/`, `crag3dkit/` | Indoor 3D wall and outdoor 3D crag viewers | AGPL-3.0 |
| `sourcekit/`, `appkit/`, `embed/` | Third-party source import, shared app helpers, and iframe embeds | AGPL-3.0 |
| `format/` | Open Format v2 schema and validator | Apache-2.0 |
| `redpoint/`, `studio/`, `lab/` | Outdoor app, Guidebook authoring, and research tools | AGPL-3.0 |
| `backend/`, `functions/`, `firestore.rules`, `storage.rules` | The official site's Firebase backend | AGPL-3.0 |
| `gyms/` | Gym list (OpenStreetMap, ODbL, and Taiwan government open data) | ODbL and others |
| `design/brand/` | The Climbio logo and the cat characters | CC BY 4.0 |

**License boundary:** `format/` (schema and validator) and the route format specification are Apache-2.0, enabling independent implementations. Kits such as `holdkit/` and `routekit/` remain AGPL-3.0: using their source code directly is different from implementing the open format. HoldScan is a separate AGPL-3.0 detection tool, not an npm Kit. See [open-source terms](docs/open-source.md) and [TRADEMARKS.md](TRADEMARKS.md).

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
