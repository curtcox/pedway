# pedway
Useful tools for the Chicago Pedway.

Live site: https://curtcox.github.io/pedway/ · Roadmap: [PLAN.md](PLAN.md)

## Development

No build step: the site is plain ES modules served as static files.

```sh
npm ci
npm run serve            # http://127.0.0.1:8000/
npm test                 # unit tests
npm run check            # Fragment Kit static checks and vendor integrity
npx playwright install chromium firefox webkit
npm run test:browser     # needs `npm run serve` running
```

Vendored dependencies are pinned in `vendor/`: Fragment Kit v0.5.0, synced
without its optional browser AI engine, and Leaflet 1.9.4 (see its PROVENANCE.md).

Pushes to `main` run `.github/workflows/ci.yml`, which tests the site and then
deploys `_site` (built by `scripts/stage.mjs`) to GitHub Pages. In the repository
settings, set **Pages → Source** to **GitHub Actions** before the first deploy.

Map data © OpenStreetMap contributors.
