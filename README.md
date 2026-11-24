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
npm run data:build       # rebuild data/*.geojson from OpenStreetMap (review the diff)
npm run data:check       # validate data/*.geojson
node scripts/data-diff.mjs  # summarise data/ changes against git HEAD
```

Vendored dependencies are pinned in `vendor/`: Fragment Kit v0.5.0, synced
without its optional browser AI engine, and Leaflet 1.9.4 (see its PROVENANCE.md).

Pushes to `main` run `.github/workflows/ci.yml`, which tests the site and then
deploys `_site` (built by `scripts/stage.mjs`) to GitHub Pages. Staging also writes
`offline-assets.js`, the hashed file list the service worker uses to keep the
site available offline. In the repository
settings, set **Pages → Source** to **GitHub Actions** before the first deploy.

`.github/workflows/data-refresh.yml` rebuilds `data/` from OpenStreetMap on the
3rd of each month (or when run by hand) and opens a `data-refresh` pull request
with a summary of what changed. It needs **Settings → Actions → General → Allow
GitHub Actions to create and approve pull requests**. Pull requests opened by the
workflow do not start CI by themselves: run **CI and Pages** on the branch.

`tests/browser/a11y.spec.js` runs axe-core against the page, popups and dialogs
and fails on any WCAG 2.2 A/AA problem it finds.

Map tiles and the Pedway, entrance, station and place data in `data/` are © OpenStreetMap
contributors, available under the Open Database License (ODbL).
