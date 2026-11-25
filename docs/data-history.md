# Data history

How the map's data is stored, versioned and staged, so that app code and data
change **independently** and any app version can be built with any compatible
snapshot. Part of [PLAN.md](../PLAN.md).

Status: snapshots, the schema version, migrations and `build-at` are in place
(H1, H2). Keeping raw Overpass replies (H3) and a HashBin mirror (H4) remain.

## Goal

At any time, someone must be able to build the complete app from:

1. **just the repository**, with no network at build time: no Overpass, no
   HashBin, no npm registry beyond what `npm ci` already needs for tests; or
2. **the repository plus HashBin**, if old data files are ever pruned from the
   working tree and only their hashes stay in the repo (H4).

The data may be old. "Complete" means every feature works with that data.
OpenStreetMap raster tiles are the one exception: they come from the tile
servers at runtime and are never stored, because OSM's tile policy forbids bulk
downloads.

A data refresh needs no app change, an app change needs no fresh data, and
either rolls back on its own.

## Layout

```
data/
  current.json                       {"format": "pedway-data-current", "version": 1, "snapshot": "<id>"}
  snapshots/<id>.json                one manifest per snapshot
  store/<layer>/<sha256>.geojson     one file per distinct content, never edited or renamed
```

`src/data-snapshot.js` holds the formats and the browser loader;
`scripts/snapshots.mjs` reads, writes and lists snapshots on disk.

A **manifest** records everything needed to rebuild and check one snapshot:

```jsonc
{
  "format": "pedway-data-snapshot", "version": 1,
  "id": "2026-11-24-2",
  "schema": 1,                                   // data schema (below)
  "built": "2026-11-24T16:13:32.746Z",
  "osmBase": "2026-05-31T22:37:44Z",             // oldest Overpass timestamp_osm_base among the replies used
  "builder": { "commit": "0fa9673730da", "script": "scripts/build-data.mjs --only base" },
  "previous": "2026-11-24",
  "attribution": "© OpenStreetMap contributors, ODbL 1.0 (…)",
  "files": {
    "pedway": { "path": "store/pedway/e9c1….geojson", "sha256": "e9c1…", "bytes": 83106, "features": 333 },
    …
  }
}
```

* Snapshot ids are the build date in UTC, with `-2`, `-3`… for more builds that
  day. A build whose files all match the current snapshot writes nothing.
* Files are named by their SHA-256, so a file that did not change (Metra stations,
  usually, or the whole base map between base rebuilds) is stored once and shared
  by every snapshot that includes it.
* A file's `path` is *derived* from layer and hash; a manifest giving any other
  path is rejected, so a manifest can never point the browser or `stage` outside
  `store/`.
* Manifests are pretty-printed JSON, and GeoJSON has one feature per line, so
  monthly diffs stay small.

`npm run data:check` validates `current.json`, every manifest, every store file
(hash, and content rules for snapshots this app reads, each distinct file once),
that every `previous` exists, and that no store file is unreferenced. Snapshots
on a schema this app does not read are warnings, unless current.

## Data schema

* `src/data-layers.js` exports `DATA_SCHEMA = { version: 1, accepts: [1] }` and
  the per-layer property rules that define schema 1.
* Additive changes, such as a new optional property or a new optional layer, keep
  the version. Incompatible ones (renaming, removing or re-typing a property, or a
  new required one) bump it.
* **Rule:** an app accepts the current schema and the one before it
  (`accepts: [N-1, N]`), or ships a migration. Then app and data never have to land
  in the same commit.
* Layers marked `optional` (`intersections` and the six base-map layers) may be
  missing from a snapshot, so `2026-11-24`, which predates them, stays readable.

### Migrations

`scripts/migrate-data.mjs`: `MIGRATIONS[n]` turns the file texts of a schema-*n*
snapshot into schema *n*+1, as a pure function; `mapProperties` helps write
them. There are none yet. `stage.mjs` and `build-at.mjs` migrate an older snapshot
up to a schema the app reads; the migrated manifest records `migratedFrom`, and
changed files get their own hashes. Data newer than the app is refused with a
message, since migrations only go up.

## Loading in the browser

* The app fetches `data/current.json` (with `cache: 'no-cache'`, since it changes
  per deployment), then that snapshot's manifest, then each layer's file the first
  time it is needed. Manifests and store files are immutable.
* Each file's SHA-256 is checked with `crypto.subtle` wherever it exists (HTTPS
  and localhost; on plain-HTTP LAN testing it is skipped). A file that fails its
  hash, or a schema the app does not accept, is left out and the status bar says
  so. Files load independently, so one failure does not blank the others.
* About shows the snapshot id and its OpenStreetMap date.

## Staging

`scripts/stage.mjs` copies **only** one snapshot, its manifest and a generated
`current.json` into `_site/data/`: the snapshot `data/current.json` names, or
`--data <id>`. The site and its offline cache therefore stay at one snapshot
(2.7 MiB raw, 457 KiB gzip today) however long the history grows.

## Building any combination

`node scripts/build-at.mjs --app <ref> [--data <id>] [--out <dir>]` checks the app
out into a temporary `git worktree`, writes the chosen snapshot from *this*
checkout into that app's `data/`, runs that app's own `scripts/stage.mjs`, and
copies the result to `--out` (default `_build/<ref>-<id>`) with a
`build-info.json` (app ref and commit, snapshot, schema, migration, and the
commit that did the build). It needs neither the network nor `npm`, and always
removes the worktree. It handles three kinds of app version, by what the checkout
contains:

* **snapshot** (with `src/data-snapshot.js`): reads that version's own
  `DATA_SCHEMA.accepts` and layer list, and writes a snapshot, migrated if
  needed.
* **flat** (with `src/data-layers.js` but no snapshots; commits `4d46e3e`, "M4",
  the first app to draw data, to `3726887`, "M7", the last before snapshots):
  writes `data/<layer>.geojson` for that version's layers. These apps came before
  schema versions; their data is schema 1.
* **none** (earlier commits): the app shows no data, so none is written.

So every commit since the first scaffold builds with today's data.
`node scripts/snapshots.mjs oldest` prints the oldest snapshot this app reads.

**CI** (`compat` job in `ci.yml`, full-history checkout) builds M7 and M4 with
today's data and HEAD with the oldest snapshot it reads;
`tests/compat/builds.spec.js` serves each build and checks it loads, draws every
layer and throws no errors. When the oldest readable snapshot is not the current
one, the job points `current.json` at it and runs the Chromium browser suite.
The job does not gate the deploy: a compatibility break should be fixed, but it
does not make the current site wrong. Browser tests that need the base map skip
on snapshots without it.

## Refreshing

`.github/workflows/data-refresh.yml` runs on the 3rd of each month and on demand.
It runs `build-data.mjs --only <groups>` (default `core,poi`: the Pedway,
entrances, stations and places; `base` rebuilds the downtown map and corners and
is run by hand, see [map-layers.md](map-layers.md#still-open)), runs the data
check, and if `data/` changed, branches from the newest `main`, copies the new
files over, force-pushes `data-refresh` and opens or updates a pull request whose
body (`scripts/data-diff.mjs`) lists added, removed and changed features per
layer. Actions are pinned to the same commits as Fragment Kit's workflows, and it
uses `gh` rather than a third-party PR action. A PR opened with the workflow token
does not trigger CI, so run **CI and Pages** on the branch by hand.
`data-tag.yml` tags `data-<id>` when `current.json` first names a snapshot on
`main`.

| Change | What it touches | CI checks | Rollback |
| --- | --- | --- | --- |
| Data refresh | adds `store/` blobs and a manifest, moves `current.json` | data check on all snapshots; browser tests on the new snapshot | `npm run data:use -- <previous id>` (one line) |
| App change, same schema | `src/`, tests | browser tests on the current and the oldest accepted snapshot | revert the code; data untouched |
| App change needing new data | builder, plus a schema bump with `accepts: [N-1, N]` or a migration; the next refresh produces schema N | as above, plus migration unit tests | revert the code; old snapshots still load |
| Drop an old schema | `accepts` loses N-1, only after `current.json` is on N | the data check warns about snapshots HEAD can no longer read | — |

## Remaining work

| Phase | Work | Done when |
| --- | --- | --- |
| **H3** Raw inputs | `build-data.mjs --save-raw`; the refresh attaches `raw-<id>.tar.gz` and `data-<id>.tar.gz` to a `data-<id>` Release; `build-data.mjs --from-release <id>` rebuilds a snapshot from stored replies; the manifest records each raw file's SHA-256 | a snapshot rebuilt from its Release's raw replies matches its manifest hashes |
| **H4** HashBin mirror | needs a client ID (PLAN.md §8) and a CI secret; upload store files, manifests and raw parts, recording each CID in the manifest; alias `pedway-data` → newest manifest; `stage --from-hashbin`; a renewal job | with `data/store` deleted, `stage --from-hashbin --data <id>` builds the same site byte for byte |

H3 and H4 are independent. Optional, later: a `?data=<id>` link to view an older
snapshot, served from the site but left out of the offline manifest.

### Raw Overpass replies go to Releases, not git

Raw replies would let a future build script rebuild old snapshots with new logic.
They are far larger than the derived files, which are enough to build the app:
about 0.8 MiB for places alone and an estimated 3–5 MiB for the Pedway, stations
and places together, plus about 19 MiB for the base map (Lake Michigan's full
relation alone is 4.6 MiB). Gzipped, roughly a sixth of that. Releases have no
total-size limit, survive history rewrites and are not part of every clone. In
git they would add 60–100 MiB a decade even gzipped (gzip defeats delta
compression), doubling the repository for data no build needs.

### HashBin as a mirror, never the only copy

The vendored HashBin SDK addresses content by CID and checks it (`verifyCID`);
aliases resolve a name to a CID; uploads are limited per authorization
(`maxUploadBytes` defaults to 1 MiB); and storage is paid and time-limited
(`spendingLimit`, `maxRetentionMonths`, `max_cost_cents`). So raw replies over
1 MiB are split into 1 MiB parts listed in order under `cids`, a scheduled job
re-saves CIDs before they expire within a spending limit, and git and Releases
always keep everything. The repo keeps every manifest, so it always knows what
to fetch from HashBin and how to check it.

### Decisions needed

1. Keep raw Overpass replies at all, and if so in Releases (recommended), in git
   gzipped, or only on HashBin?
2. How many months HashBin should keep, once its price is known. Each month adds
   at most the changed store files plus a manifest, and raw parts if mirrored.
3. Whether to offer `?data=<id>` for viewing older data, or keep history for
   builds only.

## Size budget

| Item | Raw | gzip -9 |
| --- | ---: | ---: |
| Current snapshot, all 12 layers | 2.7 MiB | 457 KiB |
| of which the monthly groups (Pedway, entrances, stations, places) | 331 KiB | 45 KiB |
| of which the base map and corners | 2.4 MiB | 412 KiB |
| Staged site, all precached | 4.1 MiB | 0.8 MiB |
| `.git` today | 4.2 MiB | |

Projection, worst case (every file in a group changes whenever it is rebuilt):

* **Checkout** grows by the monthly groups, 12 × 331 KiB ≈ 3.9 MiB a year, plus
  2.4 MiB per base rebuild (≈9.6 MiB a year if quarterly). With data doubling over
  a decade, about **150–250 MiB after 10 years**. Typical months change only a few
  files, so it is likely far less.
* **`.git`** grows by the gzip sizes or less, since unchanged files are shared and
  changed ones often delta-compress: about 0.5 MiB a year for the monthly groups
  plus 0.4 MiB per base rebuild, and about 1 MiB a year of app history. About
  **30–40 MiB after 10 years**.
* The **Pages site** stays at one snapshot.

GitHub's published limits (single file blocked at 100 MiB, repositories
recommended under 1 GB, Pages sites at most 1 GB, Release assets each under
2 GiB with no total limit, Actions artifacts kept at most 90 days and so **not
archival**) leave ample room; Git LFS is not needed. `check-data` caps each layer
(300 KB default; buildings 1.2 MB, streets 800 KB, labels 500 KB).

**When to act:** if the checkout passes **250 MiB**, or any file passes 25 MiB,
thin the in-tree store to the last 24 monthly snapshots plus one per quarter
before that. Pruned blobs stay reachable through git history, Releases and
HashBin, and their manifests stay in the tree.
