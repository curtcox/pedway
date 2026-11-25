# Map layers

How the map is split into independent layers, how the self-hosted downtown base
map and the coordinate overlays work, and how a copy that contacts no other
server is built. Part of [PLAN.md](../PLAN.md); the data files live in the
snapshot store described in [data-history.md](data-history.md).

## Goals

1. Every layer can be shown and hidden on its own: the base map (water, parks,
   buildings, streets, rail, labels), the Pedway and transit, places, and
   coordinate overlays.
2. Downtown is drawn from self-hosted data, not tiles, so the site works with no
   external server, including offline underground. OpenStreetMap raster tiles
   cover the rest of the city.
3. Each data layer is its own file with its own hash, refreshed and cached on its
   own, and loaded only when needed.
4. The viewer can show latitude/longitude, geohash, USNG and Chicago address-grid
   coordinates on the map.

## Decisions

| Question | Decision |
| --- | --- |
| How far the self-hosted base reaches | **Downtown**, with OpenStreetMap tiles beyond it. A citywide self-hosted base was measured and rejected for now ([PMTiles](#citywide-base-from-pmtiles-no-go-for-now)). |
| Map engine | **Leaflet 1.9.4**, drawing the base as GeoJSON on canvas renderers. MapLibre GL (~800 KB) and self-rendered raster tiles (heavy tooling, tens of MB per zoom range) were rejected. |
| Where layer and overlay choices live | **In the link**, like data layers. The viewer's last choice is the default for new blank maps. |
| What "intersections" shows | A live nearest-corner readout, corner labels thinned by zoom, and address-grid lines with their numbers. |

## The layer model

`src/map-layers.js` is the registry, shared by the browser and the unit tests
(which hold the document's `LAYERS` equal to the registry's `LAYER_DEFAULTS`):

* `LAYER_GROUPS`, the Layers panel's sections: *Base map*, *Pedway and transit*,
  *Places*, *Coordinates*.
* `MAP_LAYERS`, each with `key`, `group`, `title`, `source` (`snapshot`, naming a
  data file and, for places, a category), `default`, and optionally `pane`,
  `minZoom` (places appear from zoom 15) and `streetHides` (hidden by the
  *Streets only* view without being switched off).
* `BASE_MODES` and `OVERLAYS` (below).
* `PANES`, which fix the stacking order whichever layers are on, bottom to top:
  OpenStreetMap tiles (Leaflet's `tilePane`, 200), base land 210, green 220,
  water 230, streets 240, rail 250, buildings 260, base labels 350, coordinate
  lines 380, data shapes (`overlayPane`, 400), coordinate labels 450, markers and
  pins (600), popups (700).

The data files' schemas are in `src/data-layers.js` (`DATA_LAYERS`). The loader
(`src/data-snapshot.js`) fetches and hash-checks each file the first time it is
asked for. The base-map layers are `lazy`: fetched the first time they are shown.
The Pedway, entrances, stations, places and `intersections` load at startup,
because search, the readout, **Nearest entrance** and About need them.
`intersections` and the base-map layers are `optional`, so snapshots without them
still load.

## Downtown base map

### Area

**Chicago Ave to Roosevelt Rd, Halsted St to past the end of Navy Pier**:
`BASE_BOX` in `src/map-defaults.js`, `41.8665,-87.6480,41.8975,-87.5950`,
4.4 × 3.4 km.

### Layers and their data

All come from OpenStreetMap through Overpass at build time, clipped to the box
(`scripts/base-map.mjs`, used by `build-data.mjs --only base`). Coordinates have 6
decimal places; buildings are simplified to 0.5 m and everything else to 1 m. A
feature's `id` (`w123`, `r456`) names its OSM object, so these files carry no
`osm` property.

| Layer | OSM source | Features | Raw / gzip | Notes |
| --- | --- | ---: | ---: | --- |
| `water` | `natural=water`, `waterway=riverbank` | 65 | 46 / 10 KiB | Lake Michigan is a water relation (1205149); no coastline assembly needed. |
| `green` | `leisure=park`, `landuse=grass`, `leisure=garden` | 637 | 262 / 50 KiB | Areas under 200 m² dropped (most downtown "gardens" are planters). |
| `buildings` | `building=*` | 3,270 | 946 / 162 KiB | `name`, `levels`, and `pedway: true` when a Pedway vertex is inside the outline or within 8 m (151 buildings). |
| `streets` | `highway=*` except sidewalks, crossings, traffic islands, parking aisles, driveways, drive-throughs and footways inside buildings | 854 | 586 / 127 KiB | Ways with identical properties merged end to end. `name`, `class` (major / minor / service / path), `bridge`, `tunnel`, `layer`, `oneway`. Lower-level streets such as Lower Wacker are drawn dashed. |
| `rail` | `railway=subway\|light_rail\|rail` plus route relations | 624 | 127 / 13 KiB | `kind` (elevated, subway, surface), `railway`, `lines`. |
| `labels` | derived from streets, water, green and named buildings | 1,939 | 350 / 37 KiB | Precomputed points with `text`, `kind`, `angle`, `rank` and `minZoom`, since Leaflet has no line-label placement. |
| `intersections` | street crossings | 649 | 107 / 12 KiB | `streets` (normalised as `chicago-grid.js` names them), `rank` (`major` when both streets are arterials, from OSM's primary/secondary/tertiary plus a list of grid arterials, so the rank does not drift with retagging). |

`check-data` caps each layer: 300 KB by default; buildings 1.2 MB, streets
800 KB, labels 500 KB.

`pedway: true` is right for the Cultural Center, Macy's, Daley Center, City Hall,
both Prudential Plazas, Aon Center, Illinois Center and Block 37. Known rough
edges: a few buildings by the river (Marina City, House of Blues) are marked
because OSM tags Riverwalk passages there as Pedway, and the Thompson Center is
not, because OSM's Pedway ways stop at Clark/Lake.

### Drawing

`src/base-map.js` draws land (the box), green space, water, streets, rail and
buildings on one canvas renderer per pane, non-interactive, so taps reach the
Pedway, stations and the map. Street widths grow with zoom; buildings on the
Pedway are tinted blue. Labels are DOM markers chosen by rank and `minZoom`,
skipping any that would overlap one already placed (at most 150), redrawn on
`moveend`. They are created as elements, not HTML strings, because the page's
CSP refuses inline `style` attributes and street labels need a rotation.

### Base choice

*Base map* is the first section of the Layers panel: a **Map** choice
(`map.base`) and one switch per base layer (`map.layers.green` … `labels`, all on
by default).

| `map.base` | Shows |
| --- | --- |
| `both` (default) | The downtown map, with OpenStreetMap tiles beyond it. A `TileLayer` subclass skips tiles wholly inside the box, so in the Loop no tile is fetched. |
| `local` | The downtown map only; never contacts the tile server. |
| `osm` | OpenStreetMap tiles everywhere. |
| `none` | Neither: only the data shapes. |

Tiles wait until the manifest says whether the snapshot has a downtown map. With
a snapshot that lacks one, `both` falls back to tiles everywhere and the panel
says why. *Pedway focus* dims every base pane as well as the tiles.

## Coordinate overlays

Four overlays under **Coordinates**, all off in a new map and kept in
`map.overlays` (`latlon`, `geohash`, `usng`, `grid`), in links, GeoJSON exports
and the viewer's defaults. `src/overlays/grids.js` computes lines and labels from
the view alone (pure functions, tested in `tests/grids.test.js`);
`src/overlays/overlays.js` draws lines in `coords-lines` (one SVG renderer,
padded by half the view so pans do not uncover line ends) and labels in
`coords-labels`, redrawing on `moveend`.

Each overlay picks the finest step whose lines are at least 70 px apart, with at
most 40 lines per direction and 150 labels:

| Overlay | Lines | Labels | Steps |
| --- | --- | --- | --- |
| **Latitude and longitude** | Graticule | Values on the top and left edges, in the viewer's format (decimal or DMS) | 0.0001° to 1°; for DMS, 1″ to 1° |
| **Geohash** | Cell boundaries | Each cell's hash | Precision chosen so cells fit their labels |
| **USNG** | UTM grid lines in the view's zone (16T), sampled because they curve slightly in lat/lon | Grid digits on the edges; the zone and 100 km square lead the first top label (`16T DM 48`) | 10 m to 100 km |
| **Address grid and corners** | Address-grid lines from the calibrated model | Grid numbers with street names (`800 W · Halsted St`); corner names from `intersections`, major corners from zoom 14 and all from 17, skipping overlaps | 100 (a block) to 8000 |

Each overlay's edge labels get their own row below the search box and column right
of the zoom buttons, so they sit clear of the controls and of each other.

### Readout

`src/overlays/readout.js` is a bottom-left control showing the map centre (marked
by a cross), or the pointer with a mouse except over the map's controls, in every
coordinate system whose overlay is on, each with a **Copy** button. Its *Nearest*
row (`src/overlays/corners.js`) names the nearest `intersections` corner within
150 m (`Clark & Lake, 40 m NE`) and otherwise falls back to the grid model's
`describeGrid`. The readout is the text alternative for the overlays: it is in
the tab order and announces through a polite live region once the map settles.

A searched corner (`Clark & Lake`) moves to where the data has it. Outside the
box the grid model names the nearest corner (within about 30 m in and near the
Loop, 150 m at worst). The 3,759 citywide major corners (96 KiB gzip) could be
added as a lazy file if that proves too rough.

The pin popup's format picker stays a viewer setting; turning on an overlay does
not change it.

## Self-contained build

`npm run stage -- --self-contained` stages a copy whose `src/deployment.js` says
`SELF_CONTAINED = true` and whose Content Security Policy names no other host, so
the browser refuses any outside request that slips through. In that copy:

* no tile layer exists; the base choice offers only the downtown map or none, and
  links asking for `both` or `osm` show the downtown map alone;
* search reads coordinates, addresses, corners and names as usual, and says it
  cannot look anything else up instead of asking Nominatim;
* HashBin links explain that they need the full site.

About lists every host the full site may contact and when (`EXTERNAL_HOSTS` in
`src/deployment.js`), or says the copy contacts none:

| Host | Used for |
| --- | --- |
| `tile.openstreetmap.org` | Tiles outside downtown (`both`) or everywhere (`osm`) |
| `nominatim.openstreetmap.org` | Addresses the app cannot work out itself, only after **Go** |
| `256t.us` | Opening a map saved to HashBin |

Overpass is used only at build time. The *Open in…* links are ordinary links the
viewer chooses to follow. Fonts are system fonts and icons inline SVG.

`tests/browser/self-contained.spec.js` stages the copy, blocks every request to
another origin and fails if any is made, with all four overlays on, zoomed out
past the box, searching, and opening a HashBin link.

Share links name `curtcox.github.io/pedway` (`canonicalOrigin` in
`src/config.js`); a copy hosted elsewhere would set its own.

## Measurements behind the decisions

All measured on Chromium (Playwright) with Pixel 7 emulation and the CPU slowed
4×, median of 3 runs, in milliseconds. Emulation on a desktop CPU is only an
estimate; a check on a real mid-range phone is still to do.

### Downtown GeoJSON base

`node scripts/base-survey.mjs` fetches and clips the base layers into
`_build/base-survey/`; `node scripts/base-survey-draw.mjs` times drawing them.

| Copy of the data | Features | Raw | gzip |
| --- | ---: | ---: | ---: |
| Everything OSM has | 21,618 | 4.93 MiB | 673 KiB |
| … with 5 decimals and coarser simplification | 21,617 | 4.59 MiB | 527 KiB |
| **As built** (no sidewalks, crossings etc., small green areas dropped, streets merged) | **7,389** | **2.27 MiB** | **401 KiB** |
| Low-zoom copy (big buildings, major streets) | 4,144 | 0.99 MiB | 140 KiB |

| Copy | Zoom | First draw | Pan 300 px | Zoom in one step |
| --- | ---: | ---: | ---: | ---: |
| As built | 14 | 444 | 167 | 116 |
| **As built** | **16** | **370** | **150** | **167** |
| As built | 18 | 278 | 67 | 105 |
| Everything | 16 | 601 | 194 | 216 |
| Low-zoom copy | 14 | 292 | 115 | 67 |

* Leaving out detail matters; precision does not. Sidewalks, crossings and parking
  aisles were 9,166 of 14,214 street ways.
* Streets and buildings are most of the drawing cost; labels add 20–30 ms.
* The low-zoom copy saves about 150 ms at zoom 14, not worth a second copy of
  every file. If real phones prove slower, the next step is splitting the base
  files into about 1 km squares and adding only those in view, since Leaflet's
  canvas renderer projects every feature it holds on each zoom.

### Citywide base from PMTiles: no-go for now

`node scripts/pmtiles-survey.mjs` reads the Protomaps daily planet build (OSM
data in the protomaps basemap schema, max zoom 15) with HTTP range requests and
writes one archive per area and max zoom; `--no-fetch` stops after the
directories. `node scripts/pmtiles-survey-draw.mjs` times protomaps-leaflet 5.1.0
(a devDependency for this measurement only) drawing them, with the site's CSP
without outside hosts and every request to another origin refused. None was made.

| Archive | Tiles | Size (already gzip) |
| --- | ---: | ---: |
| City (`41.6445,-87.9401,42.0230,-87.5240`), zooms 0–13 | 197 | 7.4 MiB |
| City, zooms 0–14 | 677 | 19.2 MiB |
| City, zooms 0–15 | 2,510 | 58.8 MiB |
| Downtown box, zooms 0–15 | 52 | 2.5 MiB |

| Archive | Zoom | First draw | Pan 300 px | Zoom in one step |
| --- | ---: | ---: | ---: | ---: |
| City 0–15 | 14 | 747 | 94 | 312 |
| City 0–15 | 16 | 774 | 169 | 233 |
| City 0–14 | 16 | 813 | 154 | 220 |
| Downtown 0–15 | 16 | 778 | 189 | 254 |

* It works with no outside host: protomaps-leaflet draws labels with system fonts,
  needs no `eval`, and is 37 KiB gzip.
* It is about twice as slow as the GeoJSON base (0.78 s against 0.37 s at zoom 16).
* The downtown archive is six times the GeoJSON base, because every zoom stores
  the geometry again and the schema carries detail the app does not draw.
* It does not fit the offline worker: the Cache API refuses `206 Partial Content`,
  so the worker would have to download the whole archive (19–59 MiB, against a
  ~1.5 MB precache budget) and answer ranges itself. Unpacked into `z/x/y.mvt`
  files, tiles could only be cached on use, gaining nothing offline over the OSM
  tiles.
* It does not fit the data store: each base refresh would add a 19–59 MiB blob to
  git history.

Revisit if the site must work offline or with no third party across the whole
city. Then: zooms 0–14, overzoomed above; unpacked to `z/x/y.mvt` and cached on
use; hosted outside git (a Release asset or a separate Pages branch) with its hash
in the snapshot manifest; built from the Protomaps planet as the script does, or
with Planetiler from a Geofabrik extract.

## Pedway schematic

A transit-style diagram of the Pedway is planned as a separate *view*, not a base
layer. `node scripts/pedway-schematic.mjs` builds a prototype from the snapshot:
[pedway-schematic.svg](pedway-schematic.svg).

How it lays out the diagram:

1. Vertices within 5 m become one node.
2. Pieces of the Pedway within 60 m of each other are joined with a dashed *gap*
   edge, for passages OSM lacks.
3. Stations marked `pedway` and access points attach to their nearest node (120 m
   and 20 m at most). Named `pedway: true` buildings label the node nearest their
   middle.
4. Edges shorter than 30 m are merged, then chains of unmarked nodes become one
   edge.
5. A force layout pulls edges toward multiples of 45° and lengths of 70–260 m,
   pushes nodes apart, and keeps a weak pull to their real position.
6. Labels go right or left of their mark and are skipped when they would overlap.

| Result | |
| --- | ---: |
| Pedway pieces, before and after joining gaps ≤ 60 m | 20 → 11 |
| Stations on the Pedway placed | all 13 |
| Diagram nodes, edges | 137, 134 |
| Edges within 3° of a multiple of 45° | 99 of 134 |
| Labels placed: stations, buildings | 12 of 13, 42 of 54 |
| `graph.json` (lengths, levels, OSM way ids) | 17 KiB raw, 4 KiB gzip |
| `schematic.svg` | 32 KiB raw, 5 KiB gzip |
| Build time | about 0.1–0.2 s |

Size and speed are no concern: the diagram can be built with the snapshot and
drawn as static SVG. The data is the problem: Union Station, LaSalle Street, Van
Buren, Monroe, Jackson, Ogilvie and the Merchandise Mart stand alone, and the
Thompson Center is missing. Some of that is true (Union Station is not on the
Pedway), some is missing data, and a diagram makes the gaps far more visible than
the map does.

Next steps, in order:

1. Review the gaps against the City's Pedway map and fix what is missing in OSM,
   so the diagram is one connected network where the Pedway really is one.
2. Replace the force layout with an octilinear grid layout, and place labels
   against lines as well as labels.
3. Add a *Diagram* view (a page or panel beside the map, reached from the Layers
   panel) that shows the SVG, with stations and entrances that open the same place
   on the map.
4. Ship `graph.json` as an optional, lazy snapshot layer if routing hints are
   wanted.

## Risks

* **Phone performance.** See the measurements above; real-phone check pending.
* **Two base maps at the box edge.** The downtown style does not match OSM's tile
  style. Mitigations available: a soft fade at the box edge, or the `local`
  choice.
* **Older links and offline copies.** A link using a field an older version does
  not know is refused with "If this map was made with a newer version of Pedway
  Tools, reload the page to update."
* **Size creep.** Per-layer `maxBytes` in `check-data`, and the content-addressed
  store keeps unchanged layers free.

## Still open

1. **How often to rebuild the base map.** The monthly refresh rebuilds only
   `core,poi` and keeps the base files from the current snapshot: the monthly run
   is already near its 60-minute limit on busy Overpass days, and the base adds
   five large queries. Rebuild the base by running *Data refresh* by hand with
   `groups` including `base`. Until then, `pedway: true` on buildings reflects the
   Pedway as of the last base build.
2. **Publish the self-contained copy as a second site?** It is a build option
   for now.
3. **Pedway schematic:** the steps above.
