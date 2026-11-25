# Pedway Tools — design and roadmap

A static web app on GitHub Pages (`https://curtcox.github.io/pedway/`), built and
deployed by GitHub Actions, for getting around the Chicago Pedway, the buildings
and streets it connects, and the CTA and Metra stations next to it.

This file describes the app as it is and what is left to do. Two areas have their
own documents:

* [docs/data-history.md](docs/data-history.md): data snapshots, and building any
  app version with any data.
* [docs/map-layers.md](docs/map-layers.md): the layer model, the self-hosted
  downtown base map, coordinate overlays and the self-contained build.

---

## 1. Guiding decisions

| Concern | Decision |
| --- | --- |
| Runtime | Native ES modules with no build step. Dependencies are pinned and vendored under `vendor/`. |
| URL state | Fragment Kit **v0.5.0**, vendored in `vendor/fragment-kit-v0.5.0/` without its optional browser AI engine (`npm run check` verifies the copy). |
| Map engine | **Leaflet 1.9.4.** The downtown base map is drawn from GeoJSON on canvas; OpenStreetMap raster tiles cover the rest of the city. MapLibre GL is not used. |
| Data | **Curated GeoJSON from OpenStreetMap**, built by a script (Overpass), stored in the repo as content-addressed snapshots and refreshed through a reviewed monthly pull request. The browser never calls Overpass. |
| Geocoding | Chicago address-grid model and OSM corners first; OpenStreetMap Nominatim only when the user explicitly presses Go. |
| Transit | Static stations only. Live times are reached through external links. |
| Markdown | marked 18.1.2 + DOMPurify 3.4.17, vendored. |
| Offline | Fragment Kit's verified-cache service worker, plus a cache of map tiles already seen. Pedway reception is poor, so offline use matters. |
| CI/CD | Fragment Kit's reusable workflows pinned to immutable refs: `test.yml@v4` and `pages.yml@v2`. |

---

## 2. Document model (what lives in the URL)

The whole map a user shares is one document (`src/doc.js`). It goes through
Fragment Kit's `createUrlState` and is written as `#v1.<lz-string>`.

```jsonc
{
  "src": "Lunch route from Ogilvie",            // the map's title
  "map": {
    "view": { "c": [41.8837, -87.6278], "z": 16 },  // centre and zoom (11–19)
    "level": "both",                             // "both" | "pedway" (Pedway focus) | "street" (Streets only)
    "base": "both",                              // "both" | "local" | "osm" | "none"; see docs/map-layers.md
    "layers": { "pedway": true, "access": true, "cta": true, "metra": true, "restroom": true,
                "food": false, "store": false, "museum": false, "park": false,
                "green": true, "water": true, "streets": true, "rail": true, "buildings": true, "labels": true },
    "overlays": { "latlon": false, "geohash": false, "usng": false, "grid": false },
    "pins": [
      { "id": "p1", "at": "dp3wmbxyz",           // 9-character geohash
        "label": "Meet here", "icon": "star", "color": "#c0392b",
        "md": "Entrance by the **Macy's** escalator." }
    ],
    "gps": false                                 // offer "Show my location" to whoever opens the link
  }
}
```

* `normalize()` rejects unknown fields, places outside the Chicago box, bad
  types and oversized values (title 120, pins 200, label 80, note 10,000
  characters), so a hostile link cannot inject anything. Missing fields take
  their defaults, so older links stay valid. An unknown field adds "If this map
  was made with a newer version of Pedway Tools, reload the page to update."
* Settings that belong to the viewer rather than the map (preferred coordinate
  format, last layer choices as defaults for new blank maps) live in local
  storage (`src/viewer-settings.js`) and never travel in links.

---

## 3. Source layout

```
index.html, style.css        the app page
examples.html, examples.css  gallery of example maps (src/examples.js)
service-worker.js            offline worker (Fragment Kit's, plus a tile cache)
src/
  app.js                     bootstraps the kit shell, map, URL state, library and dialogs
  config.js                  Fragment Kit config (canonical origin, HashBin client id)
  deployment.js              SELF_CONTAINED flag and the external hosts About lists
  doc.js                     the map document: defaults, limits, normalize
  map-defaults.js            Loop centre, zoom limits, Chicago box, base-map box, tile URL
  map-layers.js              layer registry: groups, panes, layers, base modes, overlays
  data-layers.js             data file schemas and DATA_SCHEMA
  data-snapshot.js           snapshot formats and the browser loader (hash and schema checks)
  layers.js                  draws the data layers and builds the Layers panel
  base-map.js                the self-hosted downtown base map (canvas) and its labels
  overlays/                  coordinate overlays: grids.js (pure), overlays.js, readout.js, corners.js
  geo/                       latlon, geohash, usng, chicago-grid, formats (dispatcher), geocode (Nominatim)
  pins.js, pin-editor.js     pin markers and the edit dialog
  markdown.js                marked + DOMPurify rendering
  search.js                  the search box
  gps.js                     My location
  external.js                "Open in…" links
  files.js, file-actions.js  JSON and GeoJSON export and import
  share.js                   the share dialog
  location-view.js           a point in the viewer's format, with copy
  offline.js                 service worker registration and status
  about.js                   the About dialog
  viewer-settings.js         per-viewer settings in local storage
data/                        snapshots: current.json, snapshots/, store/ (docs/data-history.md)
scripts/                     data build and check, staging, snapshots, build-at, surveys
tests/                       node:test unit tests; Playwright suites in tests/browser and tests/compat
vendor/                      Fragment Kit, Leaflet, marked, DOMPurify, each with its provenance
docs/                        design documents
```

---

## 4. Features

### Links, sharing and saving

* The link always holds the current map: `#v1.…` is rewritten as the map moves
  and the title changes. `?example=<id>` opens an example once and is replaced.
  HashBin CID links (`#<cid>`) load read-only from `256t.us`. A broken link shows
  an error and keeps the current map.
* **Share** is the app's own dialog (copy, the system share sheet, QR), not the
  kit's: the kit's adds a "Run on open" option that means nothing for maps, and
  its shortener goes through a third-party proxy. On phones, **QR code** is in
  **More**.
* **Library:** Fragment Kit's IndexedDB library. **Save** and **Library** are in
  the toolbar (in **More** on phones); **Save as…** is in More. Names and
  descriptions stay in the browser. Library export and import come from the kit.
  If IndexedDB is missing, as in some private windows, the status bar says so and
  the rest of the app works.
* **Files:** **Export…** writes the map file (the kit's `.json` envelope) or
  GeoJSON, where pins are points with `name`, `description`, `marker-color`,
  `icon` and `geohash`, and a `pedway` foreign member holds the title, view,
  base, layers and overlays so the app can rebuild the whole map. **Open file…**
  and drag-and-drop read either format. GeoJSON from other tools keeps only points
  inside Chicago, up to the pin limit, and says what it left out. If the current
  map has pins, the app asks whether to add to them or open a new map. Opening a
  file or a library entry adds a history entry, so Back returns to the previous
  map.
* HashBin publishing is hidden until there is a client ID (§8).

### Pins and notes

* **Add pin** then tap the map, **Place at map centre** from the keyboard, or
  right-click / long-press the map. Drag a pin to move it. **Edit** in its popup
  opens a dialog for label, location (any format), icon, colour and a markdown
  note with live preview.
* Notes are sanitised: only http(s), mailto and tel links survive, and they open
  in a new tab with `rel="noopener noreferrer"`. Images become links, so a shared
  map cannot track whoever opens it. Task-list checkboxes are read-only.

### Locations

* Formats live in `src/geo/`. `parseLocation` tries every format and prefers a
  reading inside Chicago, so `-87.63, 41.88` (longitude first) and `Clark & Lake`
  both land in the right place.
* Lat/lon accepts decimal, hemisphere letters, degrees-minutes(-seconds), `geo:`
  URIs and Google, Apple and OSM map links. UTM and USNG/MGRS use Krüger's series
  and match PROJ to the millimetre; the tests hold PROJ reference values.
* The **Chicago grid** is a calibrated model: piecewise-linear profiles along
  State and Madison measured from OSM crossings (`scripts/grid-survey.mjs`), with
  the grid's slight rotation. It is within about 30 m at test crossings across the
  city (≈120 m on the far West Side). Addresses (`233 S Wacker Dr`), corners
  (`Clark & Lake`, `63rd/Halsted`) and grid numbers (`1200 S, 800 W`) work for
  about 160 named streets plus every numbered South Side street. Downtown, the
  `intersections` data gives exact corners.
* Each pin popup shows its location with a format picker and **Copy**. The chosen
  format is a viewer setting.

### Map layers

The **Layers** panel (top right) has four sections built from the registry in
`src/map-layers.js`: *Base map*, *Pedway and transit*, *Places* and
*Coordinates*, plus a **View** choice: *Streets and Pedway*, *Pedway focus*
(dims the base map) and *Streets only* (hides the Pedway and its entrances
without switching them off). Choices go into the link and become this viewer's
defaults for new blank maps. Details: [docs/map-layers.md](docs/map-layers.md).

* **Pedway, entrances and lifts, CTA and Metra stations.** Station popups list
  lines, step-free access and whether the station connects to the Pedway.
* **Places:** *Food and coffee*, *Restrooms*, *Groceries and pharmacies*,
  *Museums and galleries* and *Parks and plazas*, each its own layer, shown from
  zoom 15 ("Zoom in to see places" further out).
* **Base map:** the self-hosted downtown map, with OpenStreetMap tiles beyond it
  by default.
* **Coordinates:** latitude/longitude, geohash, USNG and address-grid overlays,
  with a readout of the map centre in each.
* While placing a pin, data shapes ignore taps so the tap reaches the map.

### Search

The box (top left) reads, in order: any location format (no network); then
station, entrance, place and pin names from the loaded data, suggested as
you type; then, only after **Go** or Enter, an OpenStreetMap Nominatim lookup.
Nominatim is bounded to the Chicago box, spaced at least 1.1 s apart, cached for
the session, and results outside Chicago are dropped. The input's tooltip says
typed addresses are sent to OpenStreetMap. A hit opens a popup with the location
in the viewer's format, **Drop pin here** and **Open in…**.

### My location

**◎** (under the zoom buttons) starts `watchPosition` only on tap. It draws a dot
with an accuracy circle and follows you until you drag the map. The status bar
offers **Drop pin here**, **Nearest entrance** and **Stop**. Fixes worse than
±60 m warn that underground GPS is often wrong. Refusal, unavailability,
timeouts, non-HTTPS pages and places outside Chicago each get their own message.
A map whose `gps` flag is set (Layers panel, "Offer show my location…") shows a
**Show my location** button and never requests location by itself.

### Open in…

On pins, stations, entrances and search hits: Google Maps (place, walking and
transit directions), Apple Maps and OpenStreetMap, in a new tab. There is no CTA
link: its trip planner takes no coordinates.

### Offline

`service-worker.js` loads the kit's verified-cache worker; `scripts/stage.mjs`
writes its SHA-256 manifest (`offline-assets.js`). Everything the site needs,
including the current data snapshot and the downtown base map, is precached:
about 4.1 MiB raw, 0.8 MiB gzip. A new deployment waits until the viewer taps
**Reload** in the status bar; **Repair offline copy** is in More.

Map tiles are requested with CORS. The worker keeps tiles the viewer has seen
(at most 3,000, about 50 MB) and reuses them for a week. It never downloads tiles
ahead of time, because OpenStreetMap's tile policy forbids bulk downloads, so
areas outside downtown that have not been viewed are blank offline. Nominatim
needs a connection; every other search works offline.

The dev server at the repo root has no offline manifest and shows "Offline copy
unavailable"; use `npm run serve:site` to try the real thing.

### Accessibility

`tests/browser/a11y.spec.js` runs axe-core 4.14.0 on the page, the Layers panel,
popups, the pin editor, share, export and About dialogs, the readout and the
examples page, and fails on any WCAG 2.2 A/AA violation. Beyond what axe checks:

* Line chips pick black or white text by contrast; a unit test holds every chip at
  4.5:1 and every place colour at 3:1 against white.
* Search suggestions are a plain list of buttons with a live count.
* `prefers-reduced-motion` turns off Leaflet's zoom, fade, marker and inertia
  animations and animated recentring.
* Map controls, markers and the map itself have a visible focus ring; popup close
  buttons are 32 px.
* The coordinate readout is the text alternative for the overlays.

### About

In **More**: what the app is, the data snapshot and its OpenStreetMap date, ODbL
attribution, how to fix data on OSM, what is sent where (privacy), every other
server the site may contact, and keyboard use. Data files load independently, so
one missing file does not blank the others; the status bar says which could not
be loaded.

---

## 5. Data

All data comes from OpenStreetMap through Overpass (`npm run data:build`). OSM
already carries station names, step-free tags and the route relations used to
work out each station's lines, so CTA/Metra GTFS and the City Data Portal are not
used. Snapshots, schemas and refreshes are described in
[docs/data-history.md](docs/data-history.md); the base map and corners in
[docs/map-layers.md](docs/map-layers.md).

* **Pedway** (333 ways, about 11 km): every way named "Pedway" in the Loop, plus
  unnamed underground ways within two hops of one and under 120 m (stairs, door
  passages). OSM maps each side branch and stair, so this is more than the City's
  "about five miles" of corridor. Growing through *all* connected underground ways
  would add 15 km of subway platforms and garages, so it is not done. Riverwalk
  and Lower Wacker are excluded by name.
* **Entrances and lifts** (122): entrances, lifts and subway entrances on those
  ways. Hours and building names are filled only where OSM has them, which is
  rarely.
* **Stations:** 143 CTA and 129 Metra, citywide. A line serves a station when its
  stop is within 80 m of the nearest stop of any line. A station connects to the
  Pedway when a Pedway vertex is within 90 m. Known rough edges: Monroe (Blue) and
  Harold Washington Library also list the Red line one block away, and Union
  Station counts as connected because OSM tags passages near it "Pedway".
* **Places** (796): within 400 m of a Pedway vertex and named, except restrooms.
  *Groceries and pharmacies* means supermarkets, convenience and department
  stores, malls and pharmacies, not every shop; private restrooms are dropped. A
  place within 30 m of a corridor (90 m when OSM puts it below street level) is
  marked "On or beside the Pedway".
* **Downtown base map and corners:** water, green space, streets, rail, buildings
  (with `pedway: true` on the 151 the Pedway reaches), label points and 649
  street corners.
* `npm run data:check` (also run by the unit tests) validates every snapshot:
  manifest shape, hashes, schema per layer from `src/data-layers.js`, ids, Chicago
  bounds, per-layer size limits, a minimum feature count per layer and place
  category (so one vanishing from OSM fails CI), and OSM attribution.
* Attribution (ODbL) is in the map's attribution control and in About.

---

## 6. CI/CD and tests

* `.github/workflows/ci.yml` (**CI and Pages**), on every push, pull request and
  by hand:
  * `test` calls Fragment Kit's `test.yml@v4`: `npm test` and `npm run check`,
    then one job per browser running `tests/browser` on Chromium, Firefox and
    WebKit, with Pixel 7 and iPhone 13 emulation for Chromium and WebKit.
  * `deploy` (pushes to `main` only, after `test`) calls `pages.yml@v2`, which
    runs `node scripts/stage.mjs _site` and publishes it, checking for the
    `pedway-tools-app` marker.
  * `compat` builds older app versions with today's data and today's app with
    the oldest snapshot it reads (docs/data-history.md). It does not gate the
    deploy.
* `.github/workflows/data-refresh.yml` and `data-tag.yml`: the monthly data
  refresh pull request and its tag (docs/data-history.md).
* `scripts/stage.mjs` copies an allowlist (`SHIP`) into `_site`, leaving out kit
  files the site never loads (`src/ai`, the second jsQR build, HashBin SDK 0.6,
  Leaflet's source map), and writes the offline manifest.
* Playwright blocks service workers by default, because `page.route` cannot see
  worker requests in Firefox or WebKit. `tests/browser/offline.spec.js` stages
  the site, serves it under `/pedway/`, goes offline and checks the map, data and
  seen tiles, and that a tampered cache entry is never served.
* Browser tests mock geolocation, Nominatim and tile requests, so CI never calls
  those services. They wait until the link holds the current map rather than
  using fixed delays, and read `location.href` because `page.url()` misses
  `replaceState` under mobile emulation.
* Fragment Kit's browser contract suites are not used: they assume a text editor
  and drafts. `tests/browser/links.spec.js` covers the same link guarantees.
* The repo needs **Settings → Pages → Source: GitHub Actions**.

---

## 7. Known limitations

* The Pedway has no official, maintained GIS dataset. OSM's Pedway is 20 separate
  pieces; some gaps are real, some are missing data (the Thompson Center is not
  connected). Entrance hours are rarely mapped.
* "Works on a phone" is tested with Pixel 7 and iPhone 13 emulation, and the
  downtown base map's drawing time with a 4× CPU slowdown. It has not been checked
  on a real mid-range phone.
* Outside downtown the map relies on OpenStreetMap tiles; unseen areas are blank
  offline.

---

## 8. Still open

1. **HashBin publishing** needs a registered client ID. Until there is one, long
   maps fall back to file export, and the data mirror (data-history H4) waits.
2. **Domain:** a custom domain, or `curtcox.github.io/pedway` (the default)?
3. **Data history:** keep raw Overpass replies in Releases (H3) and mirror
   snapshots to HashBin (H4). See [docs/data-history.md](docs/data-history.md).
4. **Pedway diagram view:** fix the Pedway's gaps in OSM, then add a schematic
   view. See [docs/map-layers.md](docs/map-layers.md#pedway-schematic).
5. **Base map refresh cadence,** and whether to publish the self-contained build
   as a second site. See [docs/map-layers.md](docs/map-layers.md#still-open).
6. **Real-phone check** of drawing time and GPS behaviour.
7. **Entrance data quality:** hours and building names for access points.
