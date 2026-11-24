# Pedway Tools — Implementation Plan

A static web app on GitHub Pages (`https://curtcox.github.io/pedway/`), built and
deployed by GitHub Actions, for getting around the Chicago Pedway, the buildings
and streets it connects, and the CTA/Metra stations next to it.

Status: **draft, with core decisions made (section 7).** ★ marks the chosen options.

---

## 1. Guiding decisions

| Concern | Recommendation |
| --- | --- |
| Runtime style | ★ Native ES modules with no build step, matching Fragment Kit. Dependencies are pinned and vendored under `vendor/`. |
| URL state | Fragment Kit **v0.5.0**, vendored with `tools/vendor-sync.mjs` into `vendor/fragment-kit-v0.5.0/`. |
| Map engine | ★ **Leaflet 1.9.x** with raster tiles (OSM/Carto). It is small, mature, mobile-friendly and needs no build step. MapLibre GL is the alternative if vector styling or rotation matters. |
| Pedway and POI data | ★ Curated **GeoJSON committed to the repo**, built by a data script from OSM (Overpass), CTA/Metra GTFS and the City of Chicago Data Portal, then reviewed by hand. The browser makes no live third-party data calls at runtime. |
| Markdown | `marked` + `DOMPurify`, vendored. Links open in a new tab with `rel="noopener noreferrer"`. |
| Offline | Fragment Kit's offline/PWA worker, so the app keeps working underground with no signal. Pedway reception is poor, which makes this important. |
| CI/CD | Fragment Kit's reusable workflows pinned to immutable refs: `test.yml@v4` and `pages.yml@v2`. |

---

## 2. Document model (what lives in the URL)

The whole map a user shares is one document. It goes through Fragment Kit's
`createUrlState` and is written as `#v1.<lz-string>`.

```jsonc
{
  "src": "",                    // required by the kit's DocumentType; holds the title/notes summary
  "map": {
    "title": "Lunch route from Ogilvie",
    "view": { "c": [41.8837, -87.6278], "z": 17 },   // centre and zoom
    "level": "pedway",                               // "pedway" | "street" | "both"
    "pins": [
      {
        "id": "p1",
        "at": "dp3sncw",                // stored as geohash for compactness; any format is accepted on input
        "label": "Meet here",
        "icon": "star", "color": "#c0392b",
        "md": "Entrance by the **Macy's** escalator.\n[Hours](https://…)"
      }
    ],
    "layers": { "pedway": true, "access": true, "cta": true, "metra": true,
                "food": false, "restroom": true, "museum": false, "park": false, "store": false },
    "gps": false                        // whether to show the live location pin when the link is opened
  }
}
```

* `normalize()` validates every field: bounds-checks coordinates to the Chicago
  area, caps pin count and note length, and allowlists layer keys.
* Settings that belong to the viewer rather than the map (units, preferred
  coordinate format, preferred external app) live in local storage. They do not
  travel in shared links.
* Links too long for a QR code fall back to HashBin publish, if a client ID is
  registered (see the questions), or to file export.

---

## 3. Features → modules

```
index.html
src/
  app.js                 bootstraps the kit shell, map and URL state
  doc.js                 DocumentType: normalize, isDefault, schema
  map/
    map.js               Leaflet setup, pan/zoom, level toggle, fit-to-pins
    layers.js            loads data/*.geojson; one toggleable layer group per category
    pins.js              user pins: add, drag, edit, delete, popups
    gps.js               geolocation watch, accuracy circle, follow mode
  geo/
    formats.js           parse and format dispatcher with auto-detect
    latlon.js            decimal, DMS, "41.88N 87.63W"
    geohash.js           encode and decode
    usng.js              UTM/USNG conversion (WGS84; Chicago is zone 16T)
    chicago-grid.js      Chicago address grid: addresses, corners ("Clark & Lake"), grid numbers
    geocode.js           street addresses: grid first, optional Nominatim fallback
  notes/
    markdown.js          marked + DOMPurify rendering
    editor.js            pin note editor with live preview
  ui/
    search.js            one box that accepts any location format
    settings.js          layer toggles, display format, external-app choice
    external.js          "Open in Google Maps / Apple Maps / OSM / Transit" links
    library.js           Fragment Kit local library (save and load named maps)
data/
  pedway.geojson         corridors (LineString) with level and hours properties
  access.geojson         street-to-pedway access points: building, hours, elevator yes/no
  cta.geojson            L stations, lines, ADA status, pedway-connected flag
  metra.geojson          Ogilvie, Union, Millennium, Van Buren and LaSalle stations
  poi.geojson            food, store, restroom, museum, park, … with a category tag
  intersections.json     downtown intersection index used for cross-street lookup
scripts/
  build-data.mjs         Overpass + GTFS + Data Portal → normalised GeoJSON
  check-data.mjs         schema and bounds validation (runs in CI)
tests/                   node:test unit tests and Playwright browser tests
```

### Requirement mapping

1. **Send and receive links.** `createUrlState` plus the kit's share dialog
   (copy, QR, shorten, HashBin). Opening a link restores the view, pins and layers.
2. **Load and save maps.** The kit's local library (IndexedDB) for named maps
   with history, plus JSON/GeoJSON file export and import. GeoJSON export lets
   pins open in other GIS tools.
3. **Markdown pin notes.** An editor with preview, sanitised rendering, embedded
   links and optional images. Notes are size-limited so the URL stays usable.
4. **Interest-point settings.** One toggle per layer group, persisted per viewer.
   A shared map can override the defaults.
5. **Location formats.** Lat/lon, geohash, USNG, street addresses and cross
   streets. Every one is accepted in search, can be shown for any point, and can
   be copied in any format from a pin's menu.
6. **GPS.** `navigator.geolocation.watchPosition`, used only after the user taps
   it. Shows an accuracy circle and a "drop pin here" action. Underground GPS is
   unreliable, so the UI says so and offers "snap to nearest access point".
7. **View, pan and zoom.** Leaflet with a street/pedway level toggle.
8. **External apps.** Google Maps universal URLs (`/maps/search/?api=1` and
   `/maps/dir/?api=1&travelmode=transit|walking`), Apple Maps, OSM and the CTA
   site. Each opens in a new tab or app.

---

## 4. Data sourcing

The Pedway has no official, maintained GIS dataset. This is the riskiest part of
the project.

1. Pull from OSM: `indoor=corridor`, `level<0` and `highway=footway` +
   `tunnel=yes` inside the Loop bounding box. Also pull entrances tagged as pedway.
2. Cross-check against the City's published Pedway map PDF. Only coordinates and
   topology are traced; artwork is not copied. Fix gaps by hand.
3. Stations come from CTA GTFS `stops.txt` (L stations with ADA flags) and Metra GTFS.
4. POIs come from Overpass by category and are clipped to about 400 m from the
   pedway or the Loop.
5. Intersections come from Chicago Data Portal street centerlines, reduced to
   intersection points with both street names.
6. `build-data.mjs` runs on demand and on a monthly scheduled Action that opens
   a PR with the diff. Data is never refreshed silently.
7. Attribution for ODbL (OSM) and the City's terms is shown in an About panel.

---

## 5. CI/CD

* `.github/workflows/ci.yml` calls `curtcox/Tools-for-pages-with-state-in-URL-fragments/.github/workflows/test.yml@v4`
  for unit tests, the data check and Playwright on chromium, firefox and webkit.
* `.github/workflows/pages.yml` calls `pages.yml@v2` with a staging command that
  copies an allowlist (`index.html src vendor data`) into `_site` and a verify
  marker. It runs on push to `main`.
* `.github/workflows/data-refresh.yml` runs the monthly data rebuild and opens a PR.
* `node scripts/file-sizes.mjs` enforces size limits, including the data files.
* The repo needs **Settings → Pages → Source: GitHub Actions** turned on. That
  step is for the repo owner.

---

## 6. Milestones

| # | Deliverable | Done when |
| --- | --- | --- |
| M0 | Scaffold: package.json, vendored kit and Leaflet, empty map, both workflows | The Pages URL shows a pannable map of the Loop |
| M1 | URL state: DocumentType, view/pins/layers in the fragment, share dialog | A link round-trips in all three browsers |
| M2 | Pins: add, drag, label, icon, markdown notes | Notes render sanitised; links open externally |
| M3 | Location formats: parsers and formatters with tests for every format | Known reference points convert in both directions within tolerance |
| M4 | Data v1: pedway, access points, CTA/Metra, plus layer toggles | Layers toggle and persist; data check passes in CI |
| M5 | GPS, external apps, search box | Works on a phone over HTTPS |
| M6 | Save/load library, file import/export, offline worker | Works in airplane mode after the first visit |
| M7 | POI categories, data-refresh Action, polish, accessibility pass | axe finds no WCAG 2.2 A/AA problems; places toggle; the refresh opens a PR |

---

## 7. Decisions (2026-11-23)

* Map engine: **Leaflet + raster tiles.**
* Data: **curated GeoJSON committed to the repo**, refreshed through a monthly PR.
* Geocoding: **Chicago grid first, Nominatim fallback.** The fallback follows
  Nominatim's usage policy: at most 1 request per second, cached results, and
  requests made only when the user explicitly searches. The UI says the typed
  address is sent to OpenStreetMap.
* Transit: **static stations only in v1.** Live times are reached through external links.

### M1 notes (2026-11-23)

* Shareable state is `{ src: title, map: { view, level, layers, pins, gps } }`
  (`src/doc.js`). Pins store a 9-character geohash. Normalization rejects
  unknown fields, places outside Chicago and oversized notes, so a hostile link
  cannot inject anything.
* Links: `#v1.…` fragments are written as the map moves and the title changes.
  `?example=<id>` links are replaced once. HashBin CID links (`#<cid>`) load
  read-only from `256t.us`. A broken link shows an error and keeps the current map.
* The app uses its own small share dialog (copy, the system share sheet, QR) instead of
  Fragment Kit's: the kit's version adds a "Run on open" option that means
  nothing for maps, and its link shortener goes through a third-party proxy.
* Fragment Kit's browser contract suites assume a text editor, local drafts and
  the library, so they are deferred to M6. Until then, `tests/browser/links.spec.js`
  covers the same link guarantees.
* Level and layer settings are stored and round-trip, but have no controls until M4.

### M2 notes (2026-11-23)

* Pins: use **Add pin** then tap the map, use **Place at map centre** from the keyboard, or right-click
  or long-press the map. Drag a pin to move it. **Edit** in a pin's popup opens a
  dialog for label, icon, colour and a markdown note with a live preview.
* Notes are rendered by marked 18.1.2 and sanitised by DOMPurify 3.4.17 (both
  vendored). Only http(s), mailto and tel links survive, and they open in a new tab with
  `rel="noopener noreferrer"`. Images become links rather than loading, so a shared map
  cannot track whoever opens it. Task-list checkboxes are shown read-only.
* On phones, **QR code** moves into **More**; Share still offers it.

### M3 notes (2026-11-23)

* Formats live in `src/geo/`: `latlon.js`, `geohash.js`, `usng.js` (UTM and
  USNG/MGRS), `chicago-grid.js` and the `formats.js` dispatcher. `parseLocation`
  tries every format and prefers a reading inside Chicago, so `-87.63, 41.88`
  (longitude first) and `Clark & Lake` both land in the right place.
* Lat/lon input accepts decimal, hemisphere letters, degrees-minutes(-seconds),
  `geo:` URIs and Google/Apple/OSM map links.
* UTM uses Krüger's series and matches PROJ 9.9 to the millimetre; the tests hold
  PROJ reference values.
* The Chicago grid is a calibrated model, not a lookup table: piecewise-linear
  profiles along State and Madison measured from OSM crossings
  (`scripts/grid-survey.mjs`), with the grid's slight rotation included. It is
  within about 30 m at test crossings across the city (≈120 m on the far West Side,
  where Lake St drifts off its nominal 200 N). Addresses (`233 S Wacker Dr`),
  corners (`Clark & Lake`, `63rd/Halsted`) and bare grid numbers (`1200 S, 800 W`)
  work for about 160 named streets plus every numbered South Side street. This
  replaces the separate `intersections.js` index for now; M4's data can add
  exact corners for the Pedway area if the model ever falls short.
* Nominatim fallback for addresses on streets the grid does not know is deferred
  to M5 with the search box, since it is the only network call and needs the
  explicit-search UI.
* UI: each pin popup shows its location with a format picker and Copy button.
  The chosen format is a viewer setting (local storage, `src/viewer-settings.js`)
  and never enters links. The pin editor has a Location field that accepts any
  format and refuses unreadable or out-of-town places.
* Browser tests now wait until the link holds the current map instead of a fixed
  delay, and read `location.href` because `page.url()` misses `replaceState` under
  mobile emulation.

### M4 notes (2026-11-23)

* Data comes from OpenStreetMap only (`npm run data:build`, Overpass). That is
  simpler than also parsing CTA/Metra GTFS, and OSM already carries station
  names, step-free tags and the route relations used to work out each station's
  lines. GTFS stays an option if OSM's station data proves stale.
* **Pedway:** every way named "Pedway" in the Loop, plus unnamed underground
  ways within two hops of one and under 120 m (stairs, door passages). That is
  11 km, against the City's "about five miles" of corridor, because OSM maps
  each side branch and stair. Growing through *all* connected underground ways
  added 15 km of subway platforms and garages, so it was rejected. Riverwalk and
  Lower Wacker are excluded by name.
* **Access points** are entrances, lifts and subway entrances on those ways
  (122). The plan's per-door building and hours fields are filled only where
  OSM has them, which is rarely; better access data is a data-quality follow-up.
* **Stations:** 143 CTA and 129 Metra stations citywide. A line serves a station
  when its stop is within 80 m of the nearest stop of any line. A station
  "connects to the Pedway" when a Pedway vertex is within 90 m. Known rough
  edges: Monroe (Blue) and Harold Washington Library also list the Red line one
  block away, and Union Station counts as connected because of passages OSM
  tags "Pedway" near it.
* `npm run data:check` (and the unit tests) validates every file: schema per
  layer from `src/data-layers.js`, ids, Chicago bounds, 300 KB limit and OSM
  attribution.
* **Layers panel** (top right): one checkbox per data layer and a View choice.
  *Pedway focus* fades the street tiles, and *Streets only* hides the Pedway and
  its entrances without switching those layers off. Choices go into the link
  and also become this viewer's default for new blank maps (local storage).
  Shared links keep their own settings. POI layers (food, restroom, …) keep
  their place in the document for M7.
* While placing a pin, data shapes ignore taps so the tap reaches the map.

### M5 notes (2026-11-23)

* **Search box** (top left) reads, in order: any location format from M3 (no
  network); then station, entrance and pin names from the loaded data,
  suggested as you type; then, only after the user presses Go or Enter, an
  OpenStreetMap Nominatim lookup. Nominatim is bounded to the Chicago box, spaced
  at least 1.1 s apart, cached for the session, and results outside Chicago are
  dropped. The input's tooltip says that typed addresses are sent to
  OpenStreetMap. A hit opens a popup with the location in the viewer's format,
  **Drop pin here** and **Open in…** links. The CSP's `connect-src` now allows
  `nominatim.openstreetmap.org`.
* **My location** (◎ under zoom): `watchPosition` starts only on tap. It draws a
  dot with an accuracy circle and follows you until you drag the map. The status
  bar offers **Drop pin here**, **Nearest entrance** (from `access.geojson`) and
  **Stop**. Fixes worse than ±60 m warn that underground GPS is often wrong.
  Refusal, unavailability, timeouts, non-https pages and places outside Chicago
  each get their own message.
* The document's `gps` flag is now set from the Layers panel ("Offer show my
  location…"). A map opened with it shows a **Show my location** button and
  never requests location by itself.
* **Open in…** on pins, stations, entrances and search hits: Google Maps
  (place, walking and transit directions), Apple Maps and OpenStreetMap, all in a
  new tab with `noopener`. There is no CTA link: its trip planner takes no
  coordinates. The plan's "preferred external app" setting was left out, since
  listing all five links is simpler.
* Popups auto-pan with room for the search box. Browser tests mock geolocation
  and Nominatim, so CI never calls the real service. "Works on a phone over
  HTTPS" is covered by Pixel 7 / iPhone 13 emulation; a check on a real device
  is still to do.

### M6 notes (2026-11-24)

* **Library:** Fragment Kit's IndexedDB library (`openLibrary` and
  `createLibraryPanel`). **Save** and **Library** are in the toolbar; on phones
  they move into **More** so the toolbar stays on one row. **Save as…** is always
  in More. Library names and descriptions stay in the browser and never enter
  links. Library export and import (`fragment-kit-library` files) come from the
  kit. HashBin publishing stays hidden until there is a client ID. If IndexedDB
  is missing, as in some private windows, the status bar says so and the rest of
  the app still works.
* **Files** (`src/files.js`, `src/file-actions.js`): **Export…** writes the map
  file (the kit's `.json` envelope) or GeoJSON. In GeoJSON, pins are points with
  `name`, `description`, `marker-color`, `icon` and `geohash`, and a `pedway`
  foreign member holds the title, view and layers, so the app can rebuild the
  whole map from it. **Open file…** and drag-and-drop read either format. GeoJSON
  from other tools keeps only points inside Chicago, up to the pin limit, and
  says what it left out. When the current map has pins, it asks whether to add
  them or open a new map. Opening a library export as a file goes to Library
  import. Opening a file or a library entry adds a history entry, so Back
  returns to the previous map. Drafts were not added: the link already holds the
  current map, and the library holds saved ones.
* **Offline:** `service-worker.js` loads the kit's verified-cache worker.
  `scripts/stage.mjs` writes the SHA-256 manifest (`offline-assets.js`) when it
  stages the site. The manifest is not committed, so the dev server at the repo
  root has no offline copy and shows "Offline copy unavailable". Use
  `npm run serve:site` to try the real thing. Staging now leaves out kit files
  the site never loads: `src/ai`, the second jsQR build, HashBin SDK 0.6 and
  Leaflet's source map. The staged site is 1.4 MB. A new deployment waits until
  the viewer taps **Reload** in the status bar. **Repair offline copy** is in
  More.
* **Tiles:** the map requests tiles with CORS. The worker keeps tiles the viewer
  has already seen (at most 3,000, about 50 MB) and reuses them for a week. It
  never downloads tiles ahead of time, because OpenStreetMap's tile policy
  forbids bulk downloads. Areas you have not viewed are blank offline. Address
  search through Nominatim still needs a connection; every other search works
  offline.
* **Tests:** Playwright now blocks service workers by default, because
  `page.route` cannot see worker requests in Firefox or WebKit.
  `tests/browser/offline.spec.js` stages the site, serves it under `/pedway/`,
  loads it once, goes offline and checks the map, data and seen tiles. It also
  checks that a tampered cache entry is never served. Fragment Kit's contract
  suites are still not used: they assume a text editor and drafts. Firefox runs
  only in CI, because it would not launch in the local sandbox.

### M7 notes (2026-11-24)

* **Places:** `data/poi.geojson`, one file with a `category` on each place, as
  planned. Categories: *Food and coffee* (restaurants, cafés, fast food, food
  courts, bakeries, delis), *Restrooms* (public toilets; private ones dropped),
  *Groceries and pharmacies* (the plan's "store": supermarkets, convenience
  stores, department stores, malls and pharmacies, not every shop), *Museums
  and galleries* and *Parks and plazas*. Places come from Overpass, must be within
  400 m of a Pedway vertex, and need a name unless they are restrooms. A place
  within 30 m of a corridor (90 m when OSM puts it below street level) is marked
  "On or beside the Pedway". The first build has 796 places (176 KB): 645 food,
  56 stores, 53 parks, 24 museums and 18 restrooms; 100 are on the Pedway.
* Each category is its own layer under **Places** in the Layers panel, keyed as
  the document already had them (`food`, `restroom`, `store`, `museum`, `park`).
  Places appear from zoom 15 in; further out the panel says "Zoom in to see
  places". Named places are found by the search box, which is also the keyboard
  route to them.
* `npm run data:build -- --only poi` rebuilds only the places against the
  committed Pedway, so it does not churn the other files. The data check also
  requires a minimum count per category, so one vanishing from OSM fails CI.
* **Data refresh:** `.github/workflows/data-refresh.yml` runs on the 3rd of each
  month and on demand. It rebuilds every file, runs the data check, and, if
  `data/` changed, force-pushes a `data-refresh` branch and opens or updates a
  pull request whose body (`scripts/data-diff.mjs`) lists added, removed and
  changed features per file. Actions are pinned to the same commits as Fragment
  Kit's workflows, and it uses `gh` instead of a third-party PR action. The repo
  owner must allow Actions to create pull requests. A PR opened with the
  workflow token does not trigger CI, so the PR body says how to run it.
* **Accessibility:** `tests/browser/a11y.spec.js` runs axe-core 4.14.0
  (`@axe-core/playwright`, pinned, with `axe-core` held at 4.14.0 by an
  override) on the page, layers panel, pin and data popups, the pin editor,
  share, export and About dialogs, and the examples page, failing on any WCAG
  2.2 A/AA violation. The page already passed; fixes came from checks axe could
  not make:
  * Line chips used white text on Blue, Green, Orange and Pink at 2.7–3.7:1.
    They now pick black or white by contrast (`textOn`), and a unit test holds
    every chip at 4.5:1 and every place colour at 3:1 against white. axe marks
    popup contrast "incomplete" because popups float over the map.
  * Search suggestions were a `listbox` of `option`s holding buttons, which is
    invalid ARIA. They are now a plain list of buttons, and a live note says how
    many there are.
  * `prefers-reduced-motion` turns off Leaflet's zoom, fade, marker and inertia
    animations and animated recentring.
  * Map controls, markers and the map itself get a visible focus ring.
* **About** (in More): what the app is, data sources and ODbL attribution (plan
  §4.7), how to fix data on OSM, what is sent where (privacy), and keyboard use.
* Data files load independently, so one missing file no longer blanks the
  others; the status bar says some data could not be loaded.

## 8. Still open

1. HashBin publishing needs a registered client ID. Until there is one, long
   maps fall back to file export.
2. Custom domain, or `curtcox.github.io/pedway`? The default is the latter.
3. Data history, so any app version can be built with any compatible snapshot
   from the repo alone or the repo plus HashBin: [docs/data-history.md](docs/data-history.md).
   H1 (content-addressed snapshots, schema version, `stage --data`) and H2
   (`build-at.mjs`, migrations, the CI `compat` job) are done; H3 (raw replies in
   Releases) and H4 (HashBin) remain.
4. Map layers: split the map into independent layers, add a self-hosted
   non-tile base map of downtown, and add lat/long, geohash, USNG and
   intersection overlays: [docs/map-layers.md](docs/map-layers.md). L0 (measuring) is done; L1–L7 are proposed.
