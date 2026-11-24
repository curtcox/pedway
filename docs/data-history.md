# Data history plan

Status: **H1 done** (2026-11-24); H2–H4 proposed. It follows M7 in [PLAN.md](../PLAN.md).
See [H1 as built](#h1-as-built) at the end.

## Goal

At any time, someone must be able to build the complete app from:

1. **just the repository**, with no network at build time: no Overpass, no
   HashBin, no npm registry beyond what `npm ci` already needs for tests; or
2. **the repository plus HashBin**, when old data files have been pruned from
   the working tree and only their hashes stay in the repo.

The data may be old. "Complete" means every feature works with that data.
OpenStreetMap map tiles are the one exception: they come from the tile servers
at runtime and are never stored, because OSM's tile policy forbids bulk
downloads.

App code and data should change **independently**. A data refresh should not
need an app change, an app change should not need fresh data, and either one
should roll back on its own.

## Where things stood before H1

* `data/*.geojson` is overwritten in place by each refresh. Older data exists
  only in git history, tied to whichever app commit it shipped with.
* The app loads fixed paths (`data/pedway.geojson`, …), so app and data versions
  are fixed together by the commit.
* Pages builds with a depth-1 checkout, so the deploy can only ever see the
  current data.
* HashBin publishing is not set up: there is no client ID yet (PLAN.md §8.1).

## Measured sizes (2026-11-24)

| Item | Raw | gzip -9 | Notes |
| --- | ---: | ---: | --- |
| `pedway.geojson` | 83,106 B | 10,044 B | 333 features |
| `access.geojson` | 20,805 B | 2,503 B | 122 features |
| `cta.geojson` | 28,660 B | 4,187 B | 143 stations |
| `metra.geojson` | 25,722 B | 4,227 B | 129 stations |
| `poi.geojson` | 180,571 B | 25,949 B | 797 places |
| **One derived snapshot, S** | **338,864 B (331 KiB)** | **46,273 B (45 KiB)** | all five files |
| Raw Overpass reply, places | 816,755 B | 125,895 B | measured |
| Raw Overpass replies, all, R | ≈ 3–5 MiB (estimate) | ≈ 0.5–0.8 MiB | Pedway and station replies not yet measured; Phase 3 measures them |
| Staged site (`_site`) | 1.4 MiB | | including the current data |
| `vendor/` | 2.0 MiB | | Fragment Kit 1.4 MiB, Leaflet 0.4 MiB |
| `.git` today | 2.4 MiB | | 20 commits |

The first automated refresh (2026-11-24) changed 2 of the 5 files, with 15 lines
changed. The one-feature-per-line format keeps monthly diffs this small.

## GitHub limits that matter

| Limit | Value | Our headroom |
| --- | --- | --- |
| Single file in git | warning at 50 MiB, blocked at 100 MiB | largest is 176 KiB, about 290× under the warning; `check-data` already caps data files at 300 KB |
| Repository size | recommended under 1 GB, strongly recommended under 5 GB | see the projection below |
| Push | 2 GB per push | not a concern |
| Pages site | published site at most 1 GB; soft bandwidth limit of 100 GB/month; 10-minute deploy timeout | site is 1.4 MiB and stays that size if history is not deployed |
| Release assets | each under 2 GiB; no limit on total size or bandwidth | good for raw inputs and bundles |
| Actions artifacts | kept at most 90 days | **not archival**: never rely on them for history |

These are GitHub's published limits as of late 2026. The plan stays far enough
under them that small changes to the limits would not matter. Git LFS is not
needed.

## Design

### 1. Content-addressed snapshots in the repo

```
data/
  current.json                       {"snapshot": "2026-11-24"}  ← the only file a refresh "moves"
  snapshots/
    2026-11-24.json                  snapshot manifest (≈1.5 KB)
    2026-12-03.json
  store/
    pedway/<sha256>.geojson          one blob per distinct file content, never edited
    poi/<sha256>.geojson
    …
  raw/                               (not in git; see section 4)
```

A **snapshot manifest** records everything needed to rebuild and check one snapshot:

```jsonc
{
  "format": "pedway-data-snapshot", "version": 1,
  "id": "2026-11-24",
  "schema": 1,                                   // data schema, see section 2
  "built": "2026-11-24T13:40:00Z",
  "osmBase": "2026-11-24T13:20:00Z",             // Overpass timestamp_osm_base
  "builder": { "commit": "1e288e0", "script": "scripts/build-data.mjs" },
  "previous": "2026-11-03",
  "attribution": "© OpenStreetMap contributors, ODbL 1.0",
  "files": {
    "pedway": { "path": "store/pedway/9f2c….geojson", "sha256": "9f2c…", "bytes": 83106, "features": 333,
                "cid": "…" },                    // HashBin CID, once published (Phase 4)
    "poi":    { … }
  },
  "raw": {                                       // Phase 3: where the Overpass replies live
    "poi": { "sha256": "…", "bytes": 816755, "release": "data-2026-11-24", "cids": ["…"] }
  }
}
```

* Files are named by their SHA-256, so a file that did not change in a month
  (Metra stations usually) is stored once and shared by every snapshot that
  includes it.
* `data/store` files are never edited or renamed, only added, so any old
  manifest stays valid.
* Each data refresh commit is tagged `data-<id>`.
* `check-data` validates every snapshot: the manifest's shape, that every
  hash matches, and that each file passes the per-layer checks for the
  manifest's `schema`.

### 2. A data schema version

* `src/data-layers.js` exports `DATA_SCHEMA = { version: 1, accepts: [1] }`.
  The per-layer property rules already there become the definition of schema 1.
* Additive changes, such as a new optional property or a new place kind, keep
  the version. Incompatible ones (renaming, removing, re-typing, or a new
  required property) bump it.
* **Rule:** an app accepts the current schema and the one before it (`accepts: [N-1, N]`), or ships a
  pure migration in `scripts/migrate-data.mjs` that stage applies. Then
  app and data never have to land in the same commit.

### 3. Loading data through the manifest

* The browser fetches `data/current.json`, then that snapshot's manifest, then
  the files it lists. It checks each file's SHA-256 with `crypto.subtle`
  (≈340 KB, a few milliseconds) and refuses a schema it does not accept. The dev
  server at the repo root and the deployed site then work the same way.
* `scripts/stage.mjs` copies **only** the selected snapshot, its manifest and a
  generated `current.json` into `_site/data/`. By default that is the snapshot
  `data/current.json` names; `--data <id>` picks another. So the site, and the
  offline worker's cache, stay at one snapshot (about 340 KB) however long
  the history grows.
* Optional, later: a `?data=<id>` link to view an older snapshot, served from
  `_site/data/snapshots/` but left out of the offline manifest.

### 4. Raw Overpass replies: GitHub Releases, not git

The raw replies let a future build script rebuild old snapshots with new logic.
They are about 10× the size of the derived files, and the derived files are
enough to build the app. So:

* Each refresh attaches `raw-<id>.tar.gz` (≈0.5–0.8 MiB) and
  `data-<id>.tar.gz` (the derived snapshot, ≈45 KiB) to a GitHub Release
  tagged `data-<id>`.
* The manifest records each raw file's SHA-256, so a downloaded copy can be
  checked.
* Releases have no total-size limit, survive history rewrites, and are not part of every clone.

### 5. HashBin as a mirror (Phase 4, needs a client ID)

What the vendored HashBin SDK v0.6.0 shows: content is addressed by CID and the
client checks it (`verifyCID`); aliases resolve a name to a CID; uploads are
limited per authorization (`maxUploadBytes` defaults to **1 MiB**); and
storage is **paid and time-limited** (`spendingLimit`, `maxRetentionMonths`,
`max_cost_cents`).

So HashBin can be a mirror, but **not the only copy** of anything:

* Each store file is uploaded and its CID goes in the manifest. Then the
  manifest is uploaded, and the alias `pedway-data` points at the newest one.
* Raw replies over 1 MiB are split into 1 MiB parts listed in order under `cids`.
* `stage --from-hashbin` fetches any store file missing from the working tree
  by CID, checks it, and stages as usual. This is the "repo + HashBin" build:
  the repo keeps every manifest (≈1.5 KB each), so it always knows what to fetch
  and how to check it.
* Renewal: a scheduled job re-saves CIDs before they expire, within a
  spending limit. If it ever lapses, git and Releases still hold everything.
* CI needs a HashBin token stored as a repository secret. That is the one new
  secret this plan adds, so it is the last phase.

### 6. Building any combination

`scripts/build-at.mjs --app <git ref> --data <snapshot id> [--from-hashbin] [--out dir]`

1. Creates a `git worktree` for the app ref.
2. Reads the snapshot manifest and its files from the **current** checkout's
   `data/` (or HashBin), not the old ref's, so newer data can go into an older
   app and the other way round.
3. Checks the app's `DATA_SCHEMA.accepts` against the snapshot's schema,
   migrating if a migration exists, and stops with a clear message otherwise.
4. Runs that ref's `stage.mjs` into `--out`.

App refs from before this plan, which have no manifest loader, are built from
their own commit's data only. That is a known limit of history before Phase 1.

### 7. How each kind of change flows

| Change | What it touches | CI checks | Rollback |
| --- | --- | --- | --- |
| Monthly data refresh | adds `store/` blobs, a `snapshots/` manifest, moves `current.json` | data check on all snapshots; the browser tests on the new snapshot | move `current.json` back (one line) |
| App change, same schema | `src/`, tests | the browser tests on the current **and the oldest accepted** snapshot | revert the code; data untouched |
| App change needing new data | builder and schema bump with `accepts: [N-1, N]` or a migration; the next refresh produces schema N | as above, plus migration unit tests | revert the code; old snapshots still load |
| Drop an old schema | `accepts` loses N-1, only after `current.json` is on N | the data check lists snapshots that are no longer buildable by HEAD (warning, not failure) | — |

## Space projection

Assume 12 refreshes a year. **Checkout** is the working tree, which grows
with every distinct file content in `data/store`. **`.git`** is the packed
history.

**Derived snapshots (in git):**

* Checkout, worst case (all five files change every month):
  12 × 331 KiB = **3.9 MiB/year**. Typical case (Metra and CTA unchanged): 12 × ≈280 KiB ≈ 3.3 MiB/year.
* `.git`, worst case (no delta compression, zlib only):
  12 × 45 KiB = **0.53 MiB/year**. With deltas, as in the first refresh
  (15 changed lines), it is closer to 10–30 KiB a month, or **0.1–0.4 MiB/year**.
  Files named by hash can defeat git's path-based delta pairing, so the
  worst-case figure is the one to plan with.
* With data size doubling over a decade (OSM keeps adding places), the 10-year
  checkout total is about **60 MiB** at worst, and `.git` about **8 MiB**.

**Raw replies, if they were kept in git instead of Releases:**

* Uncompressed: 12 × 3–5 MiB = 36–60 MiB/year of checkout, or **360–600 MiB per decade**,
  close to the 1 GB recommendation. Rejected.
* Gzipped: 12 × 0.5–0.8 MiB = 6–10 MiB/year in both checkout and `.git` (gzip
  defeats delta compression), or 60–100 MiB per decade. Workable, but it doubles
  the repo for data no build needs. Releases are better.

**App history:** about 1 MiB/year of `.git` (code changes plus occasional
vendor upgrades of 0.5–2 MiB each), or about 10 MiB per decade.

**Totals after 10 years (worst case, raw replies in Releases):**

| | Checkout | `.git` |
| --- | ---: | ---: |
| Today | ≈4 MiB | 2.4 MiB |
| + derived data history | ≤60 MiB | ≤8 MiB |
| + app history | ≈2 MiB | ≈10 MiB |
| **10 years** | **≈66 MiB** | **≈20 MiB** |
| GitHub recommended limit | 1 GB | 1 GB |

**Pages site:** it stays at ≈1.5 MiB, because only one snapshot is deployed.
Deploying all history for `?data=` would add ≤3.9 MiB a year, still far below 1 GB,
but it must stay out of the offline cache.

**Releases:** 12 × (0.5–0.8 + 0.05) MiB ≈ **7–10 MiB/year**, with no limit.

**HashBin:** the new bytes each month are the changed store files (≤331 KiB),
plus a manifest (≈1.5 KB), plus raw parts (≈0.5–0.8 MiB if mirrored), so
≤1.2 MiB a month. If *k* months of history are kept, monthly cost ≈ *k* × 1.2 MiB × (price per MiB-month).
HashBin's prices are not in the SDK; fill this in from its price list before
choosing *k*.

**When to act:** if the checkout ever passes **250 MiB**, or any file passes
25 MiB, thin the in-tree store to the last 24 monthly snapshots plus one per
quarter before that. Pruned blobs stay reachable through git history, Releases
and HashBin, and their manifests stay in the tree. At these growth rates that
is decades away.

## Phases

| Phase | Work | Done when |
| --- | --- | --- |
| **H1** Snapshots | `DATA_SCHEMA`; manifest format; `data/store` + `snapshots/` + `current.json`; move today's files into the store; `build-data.mjs` writes a snapshot and moves the pointer; `check-data` checks every snapshot; browser loader with hash and schema checks; `stage.mjs --data`; the refresh workflow tags `data-<id>` | `npm run stage -- --data <any id>` builds a working site offline; the refresh PR only adds files plus a one-line pointer move |
| **H2** Independence | `build-at.mjs`; migration hook; CI job that runs the browser tests against the oldest accepted snapshot | an older app ref builds with today's data, and today's app with the oldest accepted snapshot, both from a fresh clone with no network |
| **H3** Raw inputs | `build-data.mjs --save-raw`; refresh attaches `raw-<id>.tar.gz` and `data-<id>.tar.gz` to a `data-<id>` Release; `build-data.mjs --from-release <id>` rebuilds a snapshot from stored raw replies; measure R | a snapshot rebuilt from its Release's raw replies matches its manifest hashes |
| **H4** HashBin mirror | needs a client ID and a CI secret; upload store files, manifests and raw parts; `pedway-data` alias; `stage --from-hashbin`; renewal job | with `data/store` deleted, `stage --from-hashbin --data <id>` builds the same site byte for byte |

H1 is the core and needs no new service. H2 and H3 can follow in either
order. H4 waits on PLAN.md §8.1.

## Decisions needed

1. Keep raw Overpass replies at all, and if so in Releases (recommended), in git
   gzipped, or only on HashBin?
2. How many months HashBin should keep, once its price is known.
3. Whether to offer `?data=<id>` for viewing older data in the browser, or keep
   history for builds only.

## H1 as built

* `src/data-snapshot.js` holds the formats and the browser loader;
  `scripts/snapshots.mjs` reads, writes and lists snapshots on disk;
  `DATA_SCHEMA = { version: 1, accepts: [1] }` is in `src/data-layers.js`.
* The first snapshot is **2026-11-24**: the files that were in `data/` at commit
  `bbb170c`, moved into `data/store/` byte for byte (same SHA-256). It has no
  `osmBase` because the Overpass timestamps of that build were not kept. Earlier
  data (2026-11-23, before places existed) was not imported. It lacks `poi`, so
  schema 1 could not read it. It is still in git history at `2e9b9e5`.
* Snapshot ids are the build date in UTC, with `-2`, `-3`… for more builds that
  day. A build whose files all match the current snapshot writes nothing.
  `osmBase` is the oldest `timestamp_osm_base` among the Overpass replies used.
* Manifests are pretty-printed JSON. The `path` of each file is *derived* from
  layer and hash, and a manifest giving any other path is rejected. So a
  manifest can never point the browser or stage outside `store/`.
* The browser fetches `current.json` with `cache: 'no-cache'`, because it
  changes per deployment. Manifests and store files are immutable. Hashes are
  checked wherever `crypto.subtle` exists (HTTPS and localhost). On plain-HTTP
  LAN testing they are skipped. A file that fails its hash is left out and the
  status bar says so.
* About shows the snapshot id and its OpenStreetMap date.
* `check-data` checks `current.json`, every manifest, every store file (hash,
  and content rules for snapshots this app reads, each distinct file once),
  that every `previous` exists, and that no store file is unreferenced.
  Snapshots on a schema this app does not read are warnings, unless current.
* Commands: `npm run data:list`, `npm run data:use -- <id>` (move the pointer, e.g. to roll
  back), `npm run stage -- --data <id>`, `node scripts/data-diff.mjs [from to]`.
* The refresh workflow detects new (untracked) files, names the PR after the
  snapshot, and copies its additions over the newest main. `data-tag.yml` tags
  `data-<id>` when `current.json` first names a snapshot on main.

