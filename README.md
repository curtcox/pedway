# pedway

Useful tools for the Chicago Pedway: a map of the Pedway, its entrances, the CTA
and Metra stations beside it and the places along it, with pins and notes you
can share as a link.

Live site: https://curtcox.github.io/pedway/

* Everything on a map travels in its link; maps can also be saved in the
  browser's library or exported as JSON or GeoJSON.
* Search reads coordinates in any common format, Chicago addresses and corners,
  and station, entrance and place names.
* A self-hosted base map of downtown, OpenStreetMap tiles beyond it, and
  latitude/longitude, geohash, USNG and address-grid overlays.
* Works offline after the first visit, including underground.

## Documentation

* [PLAN.md](PLAN.md): design, features and what is still open.
* [docs/data-history.md](docs/data-history.md): data snapshots and building any
  app version with any data.
* [docs/map-layers.md](docs/map-layers.md): map layers, the downtown base map,
  coordinate overlays and the self-contained build.

## Development

No build step: the site is plain ES modules served as static files. Needs
Node 22.12 or later and Python 3 (for the static server).

```sh
npm ci
npm run serve            # http://127.0.0.1:8000/ (no offline copy)
npm run serve:site       # stage the deployable site, with its offline worker, and serve it
npm test                 # unit tests, including the data check
npm run check            # Fragment Kit static checks and vendor integrity
npx playwright install chromium firefox webkit
npm run test:browser     # needs `npm run serve` running; BROWSERS=chromium and MOBILE=false narrow it
```

Data:

```sh
npm run data:build                    # build a new snapshot from OpenStreetMap (review the diff)
npm run data:build -- --only base     # rebuild only some groups: core, poi, base
npm run data:check                    # validate every snapshot
npm run data:list                     # list snapshots; * marks the one data/current.json names
npm run data:use -- 2026-11-24        # point data/current.json at another snapshot
node scripts/data-diff.mjs            # summarise the current snapshot against the one before it
```

Staging and builds:

```sh
npm run stage                          # stage the site into _site
npm run stage -- --data 2026-11-24     # ... with a chosen snapshot
npm run stage -- --self-contained      # ... as a copy that contacts no other server
node scripts/build-at.mjs --app <git ref> --data <id>   # build any app version with any snapshot into _build/
npx playwright test --config tests/compat/playwright.config.js   # check the sites in _build/ run
```

Measurement scripts (write to `_build/` only; see docs/map-layers.md):

```sh
node scripts/base-survey.mjs           # sizes of the downtown base map layers
node scripts/base-survey-draw.mjs      # their drawing time on an emulated, slowed-down phone
node scripts/pmtiles-survey.mjs        # sizes of a citywide PMTiles base; pmtiles-survey-draw.mjs times it
node scripts/pedway-schematic.mjs      # lay out the Pedway schematic prototype
node scripts/grid-survey.mjs "State Street"   # street crossings for calibrating the address grid
```

Vendored dependencies are pinned in `vendor/`, each with its provenance: Fragment
Kit v0.5.0 (without its optional browser AI engine), Leaflet 1.9.4, marked 18.1.2
and DOMPurify 3.4.17. `protomaps-leaflet` is a dev dependency used only by
`pmtiles-survey-draw.mjs`.

## Deployment

Pushes to `main` run `.github/workflows/ci.yml` (**CI and Pages**), which tests
the site and then deploys `_site`, staged by `scripts/stage.mjs`, to GitHub
Pages. Staging also writes `offline-assets.js`, the hashed file list the service
worker uses to keep the site available offline. In the repository settings,
**Pages → Source** must be **GitHub Actions**.

Map data lives in immutable, content-addressed snapshots under `data/`
(`current.json` names the one in use). Staging ships only that snapshot.
`.github/workflows/data-refresh.yml` builds a new snapshot from OpenStreetMap on
the 3rd of each month (or when run by hand) and opens a `data-refresh` pull
request with a summary of what changed; `data-tag.yml` tags it `data-<id>` once
merged. This needs **Settings → Actions → General → Allow GitHub Actions to
create and approve pull requests**. Pull requests opened by the workflow do not
start CI by themselves: run **CI and Pages** on the branch.

## Licence and attribution

Map tiles and all the data in `data/` (the Pedway, entrances, stations, places,
the base map and corners) are © OpenStreetMap contributors, available under the
Open Database License (ODbL).
