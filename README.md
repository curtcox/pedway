# pedway
Useful tools for the Chicago Pedway.

Live site: https://curtcox.github.io/pedway/ · Roadmap: [PLAN.md](PLAN.md)

## Development

No build step: the site is plain ES modules served as static files.

```sh
npm ci
npm run serve            # http://127.0.0.1:8000/
npm run serve:site       # stage the deployable site (with its offline worker) and serve it
npm test                 # unit tests
npm run check            # Fragment Kit static checks and vendor integrity
npx playwright install chromium firefox webkit
npm run test:browser     # needs `npm run serve` running
npm run data:build       # build a new data snapshot from OpenStreetMap (review the diff)
npm run data:build -- --only base   # rebuild just the downtown base map and corners (or core, poi)
npm run data:check       # validate every data snapshot
npm run data:list        # list snapshots; * marks the one data/current.json names
npm run data:use -- 2026-11-24   # point data/current.json at another snapshot
npm run stage -- --data 2026-11-24   # stage the site with a chosen snapshot
npm run stage -- --self-contained   # stage a copy that contacts no other server (no tiles, address lookup or HashBin)
node scripts/data-diff.mjs  # summarise the current snapshot against the one before it
node scripts/build-at.mjs --app <git ref> --data <id>   # build any app version with any snapshot into _build/
npx playwright test --config tests/compat/playwright.config.js   # check the sites in _build/ run
node scripts/base-survey.mjs        # measure the self-hosted base map layers (docs/map-layers.md, L0)
node scripts/base-survey-draw.mjs   # time drawing them on an emulated, slowed-down phone
```

Vendored dependencies are pinned in `vendor/`: Fragment Kit v0.5.0, synced
without its optional browser AI engine, and Leaflet 1.9.4 (see its PROVENANCE.md).

Pushes to `main` run `.github/workflows/ci.yml`, which tests the site and then
deploys `_site` (built by `scripts/stage.mjs`) to GitHub Pages. Staging also writes
`offline-assets.js`, the hashed file list the service worker uses to keep the
site available offline. In the repository
settings, set **Pages → Source** to **GitHub Actions** before the first deploy.

Map data lives in immutable, content-addressed snapshots under `data/`
(`current.json` names the one in use; see [docs/data-history.md](docs/data-history.md)).
Staging ships only that snapshot. `.github/workflows/data-refresh.yml` builds a
new snapshot from OpenStreetMap on the 3rd of each month (or when run by hand)
and opens a `data-refresh` pull request with a summary of what changed;
`data-tag.yml` tags it `data-<id>` once merged. It needs **Settings → Actions → General → Allow
GitHub Actions to create and approve pull requests**. Pull requests opened by the
workflow do not start CI by themselves: run **CI and Pages** on the branch.

`tests/browser/a11y.spec.js` runs axe-core against the page, popups and dialogs
and fails on any WCAG 2.2 A/AA problem it finds.

The map has independent layers: a self-hosted downtown base map drawn from the data
(water, parks, streets, rail, buildings and labels), OpenStreetMap tiles beyond it,
the Pedway and transit, places, and lat/long, geohash, USNG and address-grid
overlays. See [docs/map-layers.md](docs/map-layers.md).

Map tiles and all the data in `data/` (the Pedway, entrances, stations, places, the base map and corners) are © OpenStreetMap
contributors, available under the Open Database License (ODbL).
