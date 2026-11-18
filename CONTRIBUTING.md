# Contributing

Thanks for helping. Issues and pull requests are welcome in English or Traditional Chinese. 中文版：[CONTRIBUTING.zh-Hant.md](CONTRIBUTING.zh-Hant.md).

## Before you start

- Read [README.en.md](README.en.md) and [docs/README.md](docs/README.md) (Traditional Chinese). Product behavior is specified in `docs/`; if you change behavior, update the matching doc.
- AI coding agents: start with [AGENTS.md](AGENTS.md) (task map, module boundaries, checks) and the README of the Kit you touch.
- Keep each pull request to one change. Do not refactor unrelated code.

## Fix directly, or propose first?

| Change | Can you start coding? |
|---|---|
| A bug with a reproducible case and an agreed expected behavior | Yes: add a test that fails before the fix, then fix it |
| Typos, translations, broken links, more tests | Yes |
| A small performance fix inside an existing public API | Yes, with a before/after measurement |
| A new feature, a new interaction, or a changed default | Open a **feature / design issue** first and wait for a decision |
| The open format, a public Kit API, storage, sync or offline behavior | Open a design issue first and wait for approval |
| Licensing, data rights, secrets, deployment or CI security settings | Propose first; a maintainer decides |

## Versioning

The open format (`format/`) and every Kit's public API follow semantic versioning: an incompatible change bumps the major version and needs an approved design issue; a compatible addition bumps the minor version. App-internal data and unpublished interfaces may change without compatibility shims.

## How contributions are merged

The maintainers develop in a private repository and publish this repository as one snapshot commit per release. Pull requests are reviewed and merged here; CI runs automatically on every pull request with read-only permissions. Merging a pull request does not deploy climbio.app. After a merge, a maintainer re-applies the change in the private repository (crediting you with `Co-authored-by`), so the next snapshot contains it. You do not need to do anything extra, but it means:

- Commit history here is one commit per release, and your pull request's commits may appear squashed into a release snapshot rather than as individual commits. Your authorship is kept in the pull request and in the `Co-authored-by` credit.
- A merged change can take until the next release to appear in the commit history again. If you need to know whether a change has been ported, ask in the pull request.

## Conventions

- The app has no build step and no framework: plain scripts loaded in the order listed in `hold/index.html`, sharing one global scope. A file can only use what earlier files declared while it loads, so startup and event wiring live in `js/main.js` (the last one). When you add a file, add it to `index.html` (the only list of scripts and their order) and to `SHELL` in `sw.js` (offline cache); `tools/check.mjs` reads the list from `index.html`, fails if `SHELL` misses a file, and fails on a top-level `let`/`const`/`class` declared in two files.
- Code comments and test names are in Traditional Chinese. Each app, RouteKit, holdkit and holdscan script starts with a one-line English summary (`// English: …`).
- Internal identifiers use `climbio`: `localStorage`/IndexedDB keys (`climbio.*`, `climbio-db`), `CLIMBIO_*` globals and the version string `climbio-v…`. The old name `spraywall` only remains in `js/rename.js`, which moves data on users' phones from the old names to the new ones. User-visible text always says Climbio.
- Every user-visible string goes into all language packs in `i18n/` (the check script fails if keys differ). Write the product name as `Climbio` in user-visible text.
- Use the CSS variables for brand colors (`--accent` and friends); do not hardcode color values.
- New features should work without a server. A feature that needs the backend goes behind `Backend.caps`; keep Firebase-specific code in `backend/firebase.js`.
- **License boundary:** everything, including every Kit (`holdkit/`, `routekit/`, `topokit/`, `mapkit/`, `appkit/`, `sourcekit/`), is AGPL-3.0. Only `format/` and `docs/route-format.md` are Apache-2.0 and must not import or copy AGPL code or models. Contributions are accepted under the license of the directory they touch (AGPL-3.0, or Apache-2.0 inside `format/`); there is no CLA and no commercial license.
- Do not commit secrets, service-account files, personal data, or photos you do not own.

## Checks

You need Node.js 22 or later and Python 3 (the browser tests serve the app with `python3 tools/serve-test.py`).

```bash
npm ci && npm ci --prefix functions         # test dependencies (the Cloud Functions tests need functions/)
npx playwright install chromium webkit      # once, for the browser tests
npm run test:quick                          # run before every PR
npm run test:e2e -- --project=android-chromium <spec file> [...]   # pick the specs related to your change
```

`docs/development.md` explains which browser specs to run for which change. CI runs `npm run test:quick`, the rules tests and a few Chromium smoke specs (`npm run test:smoke`: saving and reopening the demo wall, RouteKit, sharing and receiving without a backend). The full end-to-end suite takes about 15 minutes and is not run in CI.
Firestore and Storage rules have their own tests (needs Java 21): `npm ci --prefix tests/rules && npm test --prefix tests/rules`. Change `firestore.rules` or `storage.rules` together with a test case.

## Hosting your own site

Fork, rename (`node tools/rebrand.mjs`), and deploy; see [docs/open-source.md](docs/open-source.md). Any site other than climbio.app runs without a backend by default (`backend: 'none'` in `site.js`: data stays on the device, Studio exports ZIP files instead of publishing); to add your own Firebase backend see [docs/deploy.md](docs/deploy.md). Please do not name your site Climbio ([TRADEMARKS.md](TRADEMARKS.md)).
