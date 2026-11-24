# Map layers plan

Status: **L0–L6 done** (2026-11-24); L7 (optional) proposed. See [L0 results](#l0-results) and [As built](#as-built).
It follows M7 in [PLAN.md](../PLAN.md) and builds on the snapshot store from [data-history.md](data-history.md).
Phases are L0–L7; ★ marks the chosen options.

## Goal

1. Split the map into **layers that can be shown and hidden on their own**:
   the base map (water, parks, buildings, streets, rail, labels), the Pedway
   and transit data that already exists, places, and new **coordinate
   overlays**.
2. Draw a **self-hosted, non-tile base map** of downtown, so the site works
   with no external server, including offline underground. OpenStreetMap
   raster tiles stay as an optional layer for the rest of the city.
3. Let each layer be **served and refreshed on its own**: its own file, its
   own hash, loaded only when it is turned on.
4. Let the viewer show and hide four **coordinate systems**: latitude and
   longitude, geohash, USNG, and Chicago intersections and cross streets.

## Decisions (2026-11-24)

| Question | Decision |
| --- | --- |
| How far the self-hosted base map reaches | ★ **Downtown, with OSM tiles as a fallback.** Self-host the Pedway area and its surroundings, fully offline. Keep `tile.openstreetmap.org` as an optional layer for the rest of the city. |
| Map engine | ★ **Stay on Leaflet 1.9.4.** Draw the self-hosted base as GeoJSON on canvas renderers. MapLibre GL is not adopted. |
| Where coordinate overlay choices live | ★ **In the link**, like data layers. The viewer's last choice is the default for new blank maps. |
| What "intersections" shows | ★ **All three:** a live nearest-corner readout, corner labels thinned by zoom, and address-grid street lines with their numbers. |

## Where things stand

* One raster layer, `L.tileLayer(TILE_URL)` in `src/app.js`, is always on.
  *Pedway focus* only changes its opacity (`src/layers.js`, `show()`).
* Data layers (`src/data-layers.js`: `DATA_LAYERS`, `MAP_LAYERS`) are drawn in
  Leaflet's default `overlayPane`, all in one SVG renderer. Every file is
  fetched at startup, even when its layer is off.
* External runtime hosts: `tile.openstreetmap.org` (tiles, CSP `img-src`),
  `nominatim.openstreetmap.org` (address search after an explicit Go) and
  `256t.us` (HashBin read links). Build time also uses Overpass.
* Offline: the service worker keeps tiles the viewer has seen (at most 3,000)
  and never prefetches them. Areas not yet seen are blank offline.
* Coordinates are already parsed and formatted in every system the overlays
  need (`src/geo/`): `decodeGeohash` returns cell bounds, `toUtm`/`fromUtm` and
  `formatUsng` cover USNG, and `chicago-grid.js` has `gridToLatLon`,
  `latLonToGrid` and `describeGrid` (nearest corner from a calibrated model,
  within about 30 m in the Loop).

## 1. The layer model

Every layer is described in one registry, `src/map-layers.js`, which replaces
`MAP_LAYERS` and today's hard-coded tile layer:

```js
{ key: 'buildings', group: 'base', title: 'Buildings',
  source: { kind: 'snapshot', file: 'buildings' },   // or 'raster' | 'computed'
  pane: 'base-buildings', minZoom: 15, default: true,
  interactive: false, offline: 'precache' }          // or 'on-use' | 'never'
```

* **Kinds of source**
  * `snapshot`: a GeoJSON file in the data snapshot (the Pedway, stations,
    places, and the new base layers). Content-addressed, so each refreshes on
    its own.
  * `raster`: an external XYZ tile URL (OpenStreetMap today). The only kind that
    needs a third-party host.
  * `computed`: drawn from code alone (the lat/long, geohash, USNG and grid-line
    overlays). No data and no network.
* **Groups**, which are also the Layers panel's sections: *Base map*,
  *Pedway and transit*, *Places*, *Coordinates*.
* **Panes** give a fixed stacking order no matter which layers are on, from
  bottom to top: raster tiles (200), water and land (250), parks (260),
  rail (270), streets (280), buildings (290), base labels (350), coordinate
  lines (380), data shapes (400, today's `overlayPane`), coordinate labels
  (450), markers and pins (600), popups (700). Each base pane gets its own
  `L.canvas({ pane })` renderer, since thousands of polygons are much faster on
  canvas than SVG.
* **Lazy loading.** A layer's file is fetched the first time it is shown, not at
  startup. Search still needs stations, entrances and places, so those keep
  loading at startup. The manifest's hashes are still checked for each file.
* **Opacity, not just on/off.** *Pedway focus* becomes "dim the base group to
  40 %", which now works for the self-hosted base as well as the tiles.

## 2. Non-tile base map

### Options evaluated

| Option | What it is | Offline | Extra dependency | Build tooling | Verdict |
| --- | --- | --- | --- | --- | --- |
| **A. GeoJSON on canvas** ★ | One GeoJSON file per base layer, clipped to downtown, drawn by Leaflet's canvas renderer | Fully, precached | none | the existing Overpass builder | **Chosen for downtown.** Same pipeline, store, checks and diffs as the data that exists. |
| B. Self-hosted vector tiles | One PMTiles archive read with HTTP range requests, drawn with `protomaps-leaflet` | Awkward: the worker must cache range responses | protomaps-leaflet (~100 KB) | Planetiler (Java) or tippecanoe | **Kept for later** (L7) if the self-hosted area ever needs to cover the whole city. |
| C. Self-rendered raster tiles | Our own PNG tiles rendered from OSM data | Yes, but large | none | a renderer (Mapnik or similar) | Rejected: heavy tooling, tens of MB per zoom range, no styling at runtime. |
| D. MapLibre GL | WebGL vector map | Yes | ~800 KB | as B | Rejected (see Decisions). |
| E. Pedway schematic | A non-geographic diagram of Pedway corridors and stations, like a transit map | Yes | none | a graph layout step | Interesting as a separate *view*, not a base layer. Listed under L7. |

### Self-hosted area

The box is **Chicago Ave to Roosevelt Rd, Halsted St to past the end of Navy
Pier**: `41.8665,-87.6480,41.8975,-87.5950`, 4.4 × 3.4 km. L0 measured it and
kept it (see [L0 results](#l0-results)). Outside the box, the OSM raster layer (if on) draws
the map. Inside it, the raster layer is hidden by default when the self-hosted
base is on, so the two do not draw the same streets twice.

### Base layers and their data

All come from OpenStreetMap through Overpass at build time, clipped to the box.

| Layer (file) | OSM source | Geometry | Notes |
| --- | --- | --- | --- |
| `water` | `natural=water`, `waterway=riverbank` | Polygon | Lake Michigan is an OSM `natural=water` relation (1205149) and there is no coastline way in the box, so no coastline assembly is needed. Its full geometry makes the raw reply 4.6 MiB at build time; clipped, the lake is 4 KB. |
| `green` | `leisure=park`, `landuse=grass`, `leisure=garden` | Polygon | Areas under 200 m² dropped (most of OSM's 948 downtown "gardens" are planters). Overlaps the *Parks and plazas* place points, which stay as points. |
| `buildings` | `building=*` | Polygon | Properties: `name`, `levels`, and **`pedway: true`** when a Pedway vertex is inside the outline or within 8 m of it (151 of 3,270 buildings). Simplified to 0.5 m. The largest file. |
| `streets` | `highway=*` except footways inside buildings, sidewalks, crossings, traffic islands, parking aisles, driveways and drive-throughs | LineString | Ways with identical properties are merged end to end (14,214 ways → 854 features). Properties: `name`, `class` (major / minor / service / path), `bridge`, `tunnel`, `layer`. Lower Wacker and other lower-level streets drawn dashed under their upper level. |
| `rail` | `railway=subway|light_rail|rail` plus `route=subway|train` relations | LineString | Properties: `kind` (elevated, subway, surface), `lines` (CTA colours, Metra lines). Also offered on its own as **CTA and Metra lines** in *Pedway and transit*. |
| `labels` | derived from `streets`, `water`, `green` and named buildings | Point | Precomputed label points: one per street segment between corners, with `text`, `angle`, `rank` and `minZoom`. Leaflet has no line-label placement, so the build picks positions and the browser only thins them for collisions. |

Each new file is an additive change to `DATA_LAYERS`, so `DATA_SCHEMA` stays at
version 1 and older apps ignore the new files (`stage` already copies only the
layers an app knows).

## 3. Serving layers independently

* **One file per layer** in `data/store/<layer>/<sha256>.geojson`, listed in
  the snapshot manifest. A refresh that changes only `buildings` adds one blob
  and leaves every other layer's hash and cache entry alone.
* **Per-layer size limits.** `check-data`'s single 300 KB cap becomes a
  `maxBytes` per layer in `DATA_LAYERS`. L0 sizes: buildings 946 KiB, streets
  586 KiB, labels 358 KiB, green 262 KiB, rail 128 KiB, water 46 KiB. Proposed
  caps: 1.2 MB for buildings, 800 KB for streets, 500 KB for labels, 300 KB for
  the rest. No zoom split in L4 (see L0 results).
* **Per-layer refresh.** `build-data.mjs --only <layer>` already exists for
  places. It is extended to every layer, and `--group base` rebuilds the base
  layers together. The base map changes slowly, so the monthly refresh may
  rebuild it quarterly instead; the content-addressed store makes either work.
* **Offline policy per layer** (`offline` in the registry): `precache` (the
  Pedway, stations, access points, places, the self-hosted base and downtown
  intersections: about 416 KiB gzip for the new files, measured in L0), `on-use` (cached the first
  time it is shown) or `never` (external raster tiles keep today's "seen tiles
  only" rule).
* **Layers from elsewhere (later).** A registry entry may name a URL plus a
  SHA-256 instead of a snapshot file, for example a layer published to HashBin
  by CID. The app checks the hash exactly as it does for snapshot files. This
  is not needed for L1–L6.

## 4. New data sets

| Data set | Why | Size | Phase |
| --- | --- | --- | --- |
| The six base layers above | The self-hosted base map | **Measured:** 2.3 MiB raw, 401 KiB gzip together | L4 |
| **`intersections`** | Corner labels, the nearest-corner readout, and exact corners for search. PLAN.md §3 planned it; M3 used the grid model instead. | **Measured:** downtown, every named corner: 649 (392 major), 121 KiB raw. Citywide major × major: 3,759, 694 KiB raw, 96 KiB gzip: two files, the citywide one loaded on use. | L3 |
| `pedway: true` on buildings | Highlights the buildings the Pedway connects: what most visitors actually want to know | a property, no new file | L4 |
| CTA and Metra **line geometry** | Coloured 'L' and Metra lines, especially the elevated Loop | part of `rail` | L4 |
| Pedway graph (optional) | Nodes and edges for routing hints and the schematic view | about 50 KB | L7 |

`intersections` properties: `streets` (two or more names, normalised the way
`chicago-grid.js` names them), `grid` (the address-grid numbers from
`latLonToGrid`), `rank` (`major` when both streets are arterials or on the
half-mile grid; otherwise `minor`), and `osm` (the node id). The build marks a
corner `major` from OSM's `highway=primary|secondary|tertiary` plus a list of
grid arterials (Madison, State, Roosevelt, Chicago, Halsted, …), so the rank
does not drift with OSM retagging.

## 5. Coordinate overlays

Four overlays under **Coordinates** in the Layers panel. The first three are
`computed` layers and need no data or network; the fourth uses
`intersections`. Each redraws on `moveend` for the visible bounds only, and
caps itself at about 60 lines and 150 labels, choosing a coarser interval
rather than drawing more.

| Overlay | Lines | Labels | Interval by zoom |
| --- | --- | --- | --- |
| **Latitude / longitude** | Graticule | Values on the map edges, in the viewer's lat/long format (decimal or DMS) | 0.05° at z11 → 0.0005° at z19; for DMS, 1′ → 1″ steps |
| **Geohash** | Cell boundaries | Each cell's hash, with the shared prefix shown once in the corner | Precision 5 at z11–12, 6 at z13–14, 7 at z15–16, 8 at z17–19 |
| **USNG** | UTM grid lines in zone 16T | 100 km square ID and grid digits on the edges (`DM 47 37`); full designation in the readout | 10 km → 1 km → 100 m → 10 m |
| **Intersections and grid** | Address-grid lines at 800 (1 mile) and 400 (½ mile), and at 100 when zoomed in, from `gridToLatLon` | Grid numbers (`1200 S`, `800 W`) on lines; corner names at `intersections` points (`major` from z14, all from z17), thinned for collisions | 1 mi → ½ mi → 1 block |

* **Readout.** A small panel (bottom left, collapsible) shows the map centre,
  or the pointer on devices with a mouse, in every overlay that is on:
  `41.8837, −87.6278 · dp3wmbx · 16T DM 47911 37056 · State & Washington
  (40 m NE)`. Each value has a Copy button. The nearest corner comes from
  `intersections` where it covers the place, otherwise from `describeGrid`.
  The readout is the accessible text for all four overlays: it is in the tab
  order and announces through a polite live region at most once per settled
  move.
* **Document model.** `map.overlays` is added to `src/doc.js`:
  `{ latlon: false, geohash: false, usng: false, grid: false }`, allowlisted
  and normalised like `layers`. Links without it stay valid. **A link with it
  is refused by app versions before L2** ("Unknown map field: overlays"),
  including an old offline copy until it reloads. That is acceptable but the
  error should say "made with a newer version" (a small change in L1, before
  any new field ships).
* **Base layers in the document.** The base map choice also goes in the link:
  `map.base: 'local' | 'osm' | 'both' | 'none'` (`both`: self-hosted downtown,
  OSM tiles outside it; the default) and the base sub-layers as keys in
  `map.layers` (`buildings`, `streets`, `rail`, …).
* **Pins and overlays together.** The pin popup's format picker stays a viewer
  setting. Turning on an overlay does not change it.

## 6. Independence from external resources

| External resource | When used | After this plan |
| --- | --- | --- |
| `tile.openstreetmap.org` | Every map view | Only for the area outside downtown, and only when the base is `osm` or `both`. |
| `nominatim.openstreetmap.org` | Address search after Go | Unchanged; the grid and `intersections` answer more searches without it. |
| `256t.us` | Opening a HashBin link | Unchanged. |
| Overpass | Data build only | Unchanged; plus the osmdata water polygons if the coastline fallback is needed. |

* **Self-contained build.** `npm run stage -- --self-contained` stages a site
  that names no external host: the CSP drops the three hosts, the registry
  drops `raster` layers, search hides the Nominatim step and HashBin links
  explain they need the full site. For deployments that must not contact a
  third party, such as an intranet.
* **Test.** A browser test opens the staged self-contained site with every
  non-local request blocked, and checks that the downtown base, data layers and
  all four overlays draw with no failed requests.
* **Fonts and icons** stay system fonts and inline SVG, so labels need nothing
  external.
* **Attribution.** Base layers are ODbL derived data, like the existing files;
  the attribution control and About panel name OSM whether or not tiles are on.

## 7. Phases

| # | Deliverable | Done when |
| --- | --- | --- |
| **L0** ✓ | Measuring spike (`scripts/base-survey.mjs`, `scripts/base-survey-draw.mjs`): fetch the six base layers and `intersections` for the proposed box, simplify, and report counts, raw and gzip sizes, and canvas draw time under Pixel 7 emulation with 4× CPU throttling | A table in this file fixes the box, the simplification, any zoom split, and whether the base is precached. **Decision gate** for L4–L5. |
| **L1** ✓ | Layer registry and panes, with no visible change: the tile layer and data layers move into `src/map-layers.js`; lazy loading; the Layers panel is built from the registry, in sections; "made with a newer version" error | Every existing browser test passes; a unit test checks registry order and keys against `doc.js`. |
| **L2** ✓ | Lat/long, geohash and USNG overlays, the readout, and `map.overlays` in links | Overlays round-trip in links in all three browsers; unit tests check line positions against known values (for example, a USNG 1 km line against PROJ); axe passes with the readout open. |
| **L3** ✓ | `intersections` data set, grid lines, corner labels, nearest corner in the readout; search and `describeGrid` prefer exact corners | Corner labels match OSM at test corners; the readout names the right corner within 10 m in the Loop. |
| **L4** ✓ | Base data sets in the snapshot (`water`, `green`, `buildings` with `pedway`, `streets`, `rail`, `labels`), per-layer `maxBytes`, `--only`/`--group` builds, refresh workflow includes them | `data:check` passes; the refresh PR shows per-layer diffs. |
| **L5** ✓ | Self-hosted base drawn on canvas; `map.base` choice; *Pedway focus* dims the whole base group; offline worker precaches the base; raster tiles only outside the box in `both` | Airplane-mode test draws downtown with streets, buildings and water after one visit, with no tile requests inside the box. |
| **L6** ✓ | `stage --self-contained` and its blocked-network test; About lists every external host and when it is used | The self-contained site passes the browser suite with all external requests blocked. |
| **L7** (optional) | Measure PMTiles + protomaps-leaflet for a citywide self-hosted base; prototype the Pedway schematic view | A written go/no-go for each, with sizes. |

L2 needs no new data and can ship first. L3 and L4 are independent of each
other. L5 needs L1 and L4.

## 8. Risks

* **Label clutter and collisions.** Leaflet has no label engine. Mitigation:
  build-time label points with ranks, plus a simple greedy collision pass in
  the browser per redraw, capped per screen.
* **Phone performance.** L0: at 4× CPU slowdown, the downtown base draws in
  about 0.37 s and redraws in about 0.15 s after a pan (see L0 results).
  Acceptable, but still to check on a real phone in L5. If needed, split the
  base files into about 1 km squares and add only the squares in view, since
  Leaflet's canvas renderer projects every feature it holds on each zoom.
* ~~**Lake Michigan coastline.**~~ Resolved in L0: the lake is a water relation.
* **Two base maps at the box edge.** Self-hosted styling will not match OSM's
  tile style exactly. Mitigation: a soft fade at the edge of the box, and the
  `local` choice that shows nothing outside it.
* **Older links and offline copies.** New document fields are refused by older
  versions (see section 5). Mitigation: the clearer error lands in L1, before
  any new field.
* **Size creep.** Mitigation: per-layer `maxBytes` and a total-site budget in
  `check-data`, and the content-addressed store keeps unchanged layers free.

## 9. Still open

1. ~~Confirm the self-hosted box after L0.~~ Kept (L0 results).
2. How often should the base map rebuild? For now the monthly refresh rebuilds
   only `core,poi` (the Pedway, stations and places, as before L4), keeping the base
   files from the current snapshot. The base is rebuilt by running *Data refresh*
   by hand with `groups` set to include `base`. The monthly run was already near
   its 60-minute limit on busy Overpass days, and the base map adds five large
   queries. Until the next base rebuild, `pedway: true` on buildings reflects the
   Pedway as of the last base build.
3. Is a self-contained deployment (L6) wanted as a second published site? It is
   a build option for now (`stage --self-contained`).

## L0 results

Measured 2026-11-24 with `node scripts/base-survey.mjs` (fetches and clips the
data; writes to `_build/base-survey/`, nothing in `data/`) and
`node scripts/base-survey-draw.mjs` (draw times). OSM data as of that day.

### Sizes

Four copies were built from the same Overpass replies:

* **full:** everything OSM has, 6 decimal places, 0.5–1 m simplification.
* **light:** like full, with 5 decimal places and 1.5–3 m simplification.
* **proposed ★:** like full, without sidewalks, crossings, traffic islands,
  parking aisles, driveways, drive-throughs, green areas under 200 m² and `osm`
  ids, and with street ways merged by identical properties.
* **low:** for zooms below 16: buildings of 400 m² or more, major streets only,
  coarser simplification.

| Copy | Features | Vertices | Raw | gzip -9 |
| --- | ---: | ---: | ---: | ---: |
| full | 21,618 | 82,979 | 4.93 MiB | 673 KiB |
| light | 21,617 | 73,685 | 4.59 MiB | 527 KiB |
| **proposed** | **7,389** | **59,490** | **2.27 MiB** | **401 KiB** |
| low | 4,144 | 20,358 | 0.99 MiB | 140 KiB |

| Layer (proposed) | Features | Vertices | Raw | gzip -9 |
| --- | ---: | ---: | ---: | ---: |
| buildings | 3,270 | 25,504 | 946 KiB | 162 KiB |
| streets | 854 | 20,354 | 586 KiB | 127 KiB |
| labels | 1,939 | 1,939 | 358 KiB | 40 KiB |
| green | 637 | 8,384 | 262 KiB | 50 KiB |
| rail | 624 | 1,611 | 128 KiB | 13 KiB |
| water | 65 | 1,698 | 46 KiB | 10 KiB |

What the numbers say:

* **Leaving out detail matters; precision does not.** Downtown OSM geometry is
  already sparse, so rounding to 5 places and coarser simplification
  (light) save only 22 % gzip. Sidewalks, crossings and parking aisles were
  9,166 of 14,214 street ways; dropping them and merging the rest (proposed)
  halves the total.
* **Every file but buildings and streets fits the current 300 KB cap**; those
  two need per-layer `maxBytes` (section 3).
* **Precache it.** Proposed plus downtown intersections is about 416 KiB gzip,
  well under the 1.5 MB budget. The staged site is 1.4 MiB today.
* Raw Overpass replies for the base (buildings, streets, water, green, rail)
  are 19 MiB, about 4× the existing data's. That matters for data-history H3
  (raw replies in Releases), not for the site.

### Drawing time

Chromium (Playwright), Pixel 7 emulation (412 × 839 CSS px), CPU slowed 4×,
canvas renderer per base pane, labels as DOM markers filtered by `minZoom`;
median of 3 runs, in milliseconds. "Pan" is the redraw after a 300 px pan; the
empty map's ~33 ms is two animation frames of waiting, not drawing.

| Copy | Zoom | Layers | Parse JSON | First draw | Pan 300 px | Zoom in one step | Labels drawn |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| low | 14 | all + labels | 13 | 292 | 115 | 67 | 388 |
| proposed | 14 | all + labels | 30 | 444 | 167 | 116 | 384 |
| full | 16 | all + labels | 63 | 601 | 194 | 216 | 135 |
| **proposed** | **16** | **all + labels** | **30** | **370** | **150** | **167** | **136** |
| proposed | 16 | all | 29 | 348 | 134 | 140 | 0 |
| proposed | 18 | all + labels | 29 | 278 | 67 | 105 | 39 |
| proposed | 16 | water | 29 | 37 | 33 | 34 | 0 |
| proposed | 16 | green | 29 | 64 | 34 | 34 | 0 |
| proposed | 16 | rail | 30 | 55 | 33 | 35 | 0 |
| proposed | 16 | streets | 30 | 124 | 67 | 66 | 0 |
| proposed | 16 | buildings | 29 | 148 | 51 | 50 | 0 |
| proposed | 16 | none (empty map) | 29 | 28 | 33 | 34 | 0 |

* Streets and buildings are most of the cost. Labels add 20–30 ms.
* The low copy saves about 150 ms on the first draw at zoom 14. That is not worth
  a second copy of every file in L4. Revisit in L5 if real phones are slower than
  this emulation.
* Emulation on a desktop CPU is only an estimate; L5 includes a check on a real
  mid-range phone.
* The zoom 16 screenshot (`--shot`) shows correct data. It also shows label
  collisions (Upper and Lower Wacker, Kinzie and North Water), so L3 and L5 need
  the collision pass from section 8.

### Decisions

| Question | Decision |
| --- | --- |
| Box | Kept: `41.8665,-87.6480,41.8975,-87.5950`. |
| Water | From `natural=water` relations and ways; Lake Michigan is relation 1205149. No coastline assembly and no osmdata fallback. |
| Street detail | Drop sidewalks, crossings, traffic islands, parking aisles, driveways and drive-throughs; merge ways with identical properties. |
| Green | Drop areas under 200 m². |
| Precision | 6 decimal places, 0.5 m (buildings) and 1 m (others) simplification. Coarser settings save too little to matter. |
| `osm` property | Left out of base layers; the feature `id` (`w123`, `r456`) already names the OSM object. |
| Low-zoom copy | Not in L4. |
| Offline | Precache the base and downtown intersections. Citywide intersections are loaded on use. |
| `pedway` buildings | A Pedway vertex inside or within 8 m: 151 buildings. Spot-check in L4 against the City's Pedway map. |

## As built

### L1 (2026-11-24)

* `src/map-layers.js` holds `LAYER_GROUPS` (the panel's sections), `PANES`
  (stacking order) and `MAP_LAYERS`, each with `group`, `source`, `default`,
  `minZoom` and `streetHides`. `MAP_LAYERS` moved here from `data-layers.js`,
  which keeps only the data files' schemas. A unit test holds the document's
  `LAYERS` equal to the registry's `LAYER_DEFAULTS`.
* `fetchSnapshot` now returns `file(key)`, which fetches and hash-checks one
  layer's file the first time it is asked for. Data layers marked `lazy` load
  the first time they are shown; today's files stay eager because search, the
  nearest-entrance button and the About panel need them. Data layers marked
  `optional` may be missing from a snapshot, so older snapshots stay readable
  once the base layers exist.
* The Layers panel is built from the registry, one heading per group
  (`#layers-transit`, `#layers-places`). The raster tile layer is unchanged until L5.
* An unknown field in a link or file now adds "If this map was made with a newer
  version of Pedway Tools, reload the page to update."

### L2 (2026-11-24)

* `src/overlays/grids.js` computes each overlay's lines and labels from the view
  alone (`graticule`, `geohashGrid`, `usngGrid`, `addressGrid`), so
  `tests/grids.test.js` checks them without a browser: lines fall on multiples
  of the step, USNG lines keep one easting or northing in UTM, geohash cells
  match what `decodeGeohash` returns, and grid lines keep one address number.
  Steps are chosen so lines are at least 70 px apart.
* The address-grid lines (from the calibrated model, labelled `800 W · Halsted
  St`) came forward from L3, since they need no data. L3 adds the
  `intersections` data, corner labels and exact corners.
* `src/overlays/overlays.js` draws lines in `coords-lines` (one SVG renderer,
  padded by half the view so pans do not uncover line ends) and labels in
  `coords-labels`, redrawing on `moveend`. Each overlay's edge labels get their
  own row below the search box and a column right of the zoom buttons, so they
  do not sit on the controls or on each other. The USNG zone and 100 km square
  lead the first top label (`16T DM 48`) instead of a corner label, which
  collided with the location button on phones.
* `src/overlays/readout.js` is a bottom-left control: the map centre (marked by
  a cross) in each system that is on, with Copy buttons, and a polite live
  region updated when the map settles. With a mouse it follows the pointer,
  except over the map's controls.
* `map.overlays` (`latlon`, `geohash`, `usng`, `grid`) is in links, GeoJSON
  exports and the viewer's defaults for new maps.
  `tests/browser/overlays.spec.js` covers drawing, the readout, links, defaults,
  redraws on moving, and axe on the readout and panel.

### L3 and L4 (2026-11-24)

* `scripts/base-map.mjs` builds the base layers and `intersections` from Overpass
  replies; `build-data.mjs` writes them into snapshots (`--only base` rebuilds
  just them, `--only poi,base` both), and `base-survey.mjs` reuses it to measure.
  The box is `BASE_BOX` in `src/map-defaults.js`.
* Snapshot `2026-11-24-2` adds `water`, `green`, `rail`, `streets`, `buildings`,
  `labels` and `intersections` to `2026-11-24`, whose other files it shares. It
  was built from the L0 survey's cached replies.
* All seven are `optional` in `DATA_LAYERS`: a snapshot may lack them, and
  `stage`, `build-at` and `dataForApp` take an `optional` list, so the CI compat
  job still runs this app on `2026-11-24`. The base layers are also `lazy`;
  `intersections` loads at startup, as search and the readout use it.
* `check-data` now takes several geometry types per layer, nested
  coordinates (closed rings, two-point lines), `number` properties, a
  per-layer `maxBytes` and a per-layer id pattern (labels are `l123`).
* **Citywide corners are left out.** Outside the box the grid model still
  names the nearest corner (within about 30 m in and near the Loop, 150 m at
  worst). The 3,759 citywide major corners (96 KiB gzip) can be added as a
  lazy file if that proves too rough.
* `src/overlays/corners.js`: the readout's *Nearest* row names the nearest
  data corner within 150 m (`Clark & Lake, 40 m NE`) and falls back to the grid
  model. With the grid overlay on, major corners are labelled from zoom 14 and
  all of them from 17, skipping any label that would overlap one already
  placed. A searched corner (`Clark & Lake`) moves to where the data has it.
* `pedway: true` buildings (151): the Cultural Center, Macy's, Daley Center,
  City Hall, both Prudential Plazas, Aon Center, Illinois Center and Block 37
  are right. Known rough edges: a few buildings by the river (Marina City, House
  of Blues) are marked because OSM tags Riverwalk passages there as Pedway, and
  the Thompson Center is not, because OSM's Pedway ways stop at Clark/Lake.
* The staged site is now 4.0 MiB raw (about 0.8 MiB gzip), all of it precached.

### L5 (2026-11-24)

* `src/base-map.js` draws land (the box), green space, water, streets, rail and
  buildings on one canvas per pane, non-interactive. Street widths grow with
  zoom. Buildings on the Pedway are tinted blue. Labels are DOM markers placed
  by rank without overlaps (at most 150), redrawn on `moveend`. They are created
  as elements, not HTML strings, because the page's CSP refuses inline `style`
  attributes and street labels need a rotation.
* *Base map* is the first section of the Layers panel: a **Map** choice
  (`map.base`: `both`, the default, is the downtown map with OpenStreetMap
  tiles beyond it; `local` is the downtown map only and never contacts the tile
  server; `osm` is tiles only; `none` is neither) and one switch per base
  layer (`map.layers.green` … `labels`, on by default). Older links without
  these open with the defaults.
* In `both`, a `TileLayer` subclass skips tiles wholly inside the box, so in the
  Loop no tile is fetched at all. Tiles also wait until the manifest says
  whether the snapshot has a downtown map. With an older snapshot, `both` falls
  back to tiles everywhere and the panel says why.
* *Pedway focus* now dims every base pane as well as the tiles.
* `tests/browser/basemap.spec.js` covers drawing, no tile requests inside the
  box, each base choice, per-layer switches, focus dimming and older links.
  The offline test now visits a view across the box's edge and checks, offline,
  that the downtown map draws and seen tiles return with no new tile requests.
  Tests that skip without the base data still pass on `2026-11-24`, as the
  compat job needs.
* Browser tests no longer return the map from `page.evaluate` (`setZoom`
  returns it), because with the base layers it is too deep for Playwright to
  serialize.
* **Not done:** a check on a real mid-range phone. L0's throttled emulation
  measured about 0.37 s to draw and 0.15 s after a pan.

### L6 (2026-11-24)

* `npm run stage -- --self-contained` stages a copy whose
  `src/deployment.js` says `SELF_CONTAINED = true` and whose Content Security
  Policy names no other host, so the browser refuses any outside request that
  slips through. In that copy:
  * no tile layer exists, the base choice offers only the downtown map or none,
    and links asking for `both` or `osm` show the downtown map alone;
  * search reads coordinates, addresses, corners and names as before, and says
    it cannot look anything else up instead of asking Nominatim;
  * HashBin links explain that they need the full site.
* About now has an *Other servers* section listing every host the full site may
  contact and when (`EXTERNAL_HOSTS` in `src/deployment.js`), or saying the copy
  contacts none. The *Open in…* links are ordinary links the viewer chooses to
  follow, so they stay.
* `tests/browser/self-contained.spec.js` stages the copy, blocks every request
  to another origin and fails if any is made, with all four overlays on, zoomed
  out past the box, searching, and opening a HashBin link.
* Share links still name `curtcox.github.io/pedway` (`canonicalOrigin` in
  `src/config.js`). A copy hosted elsewhere would set its own.
* The popup close button grew from 24 to 32 px: axe's target-size check
  sometimes failed on phones when another control sat beside it.
* **Still open:** whether to publish the self-contained copy as a second site.
  Today it is a build option only.
