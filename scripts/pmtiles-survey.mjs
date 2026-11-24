// L7 measuring spike, part 1 (docs/map-layers.md): how big a self-hosted PMTiles
// base map would be for all of Chicago, and for the downtown box, by zoom.
//   node scripts/pmtiles-survey.mjs [--planet URL] [--out _build/pmtiles-survey] [--no-fetch]
// Reads the Protomaps daily planet build (protomaps basemap schema, the one
// protomaps-leaflet styles) with HTTP range requests: the header, the directories
// that cover the two boxes, then the tiles themselves, which it writes into one
// local archive per box and max zoom. Nothing goes into data/.
// --no-fetch only sums tile sizes from the directories (a few MB of transfer).
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { BASE_BOX } from '../src/map-defaults.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const outDir = path.resolve(root, option('--out', '_build/pmtiles-survey'));
const fetchTiles = !process.argv.includes('--no-fetch');

// [south, west, north, east]. The city box is the bounding box of the city limits.
const BOXES = {
  downtown: BASE_BOX.flat(),
  city: [41.6445, -87.9401, 42.0230, -87.5240],
};
const MAX_ZOOMS = [13, 14, 15];

// ---- PMTiles v3: tile ids, directories, header ----

function zxyToTileId(z, x, y) {
  let acc = 0;
  for (let i = 0; i < z; i++) acc += 4 ** i;
  const n = 2 ** z, xy = [x, y];
  let d = 0;
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (xy[0] & s) > 0 ? 1 : 0, ry = (xy[1] & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) { xy[0] = s - 1 - xy[0]; xy[1] = s - 1 - xy[1]; }
      [xy[0], xy[1]] = [xy[1], xy[0]];
    }
  }
  return acc + d;
}

function tilesInBox([south, west, north, east], z) {
  const n = 2 ** z;
  const tx = lon => Math.floor((lon + 180) / 360 * n);
  const ty = lat => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n); };
  const out = [];
  for (let x = tx(west); x <= tx(east); x++) for (let y = ty(north); y <= ty(south); y++) out.push({ z, x, y, id: zxyToTileId(z, x, y) });
  return out;
}

function readVarint(buf, pos) {
  let value = 0, shift = 0, byte;
  do { byte = buf[pos.i++]; value += (byte & 0x7f) * 2 ** shift; shift += 7; } while (byte & 0x80);
  return value;
}

function writeVarint(out, value) {
  while (value >= 0x80) { out.push((value % 0x80) | 0x80); value = Math.floor(value / 0x80); }
  out.push(value);
}

const decompress = (buf, kind) => kind === 2 ? zlib.gunzipSync(buf) : kind === 1 ? buf : (() => { throw new Error(`compression ${kind} not handled`); })();

function parseDirectory(buf) {
  const pos = { i: 0 }, n = readVarint(buf, pos), entries = [];
  let last = 0;
  for (let i = 0; i < n; i++) { last += readVarint(buf, pos); entries.push({ tileId: last }); }
  for (const e of entries) e.runLength = readVarint(buf, pos);
  for (const e of entries) e.length = readVarint(buf, pos);
  entries.forEach((e, i) => {
    const v = readVarint(buf, pos);
    e.offset = v === 0 && i > 0 ? entries[i - 1].offset + entries[i - 1].length : v - 1;
  });
  return entries;
}

function serializeDirectory(entries) {
  const out = [];
  writeVarint(out, entries.length);
  let last = 0;
  for (const e of entries) { writeVarint(out, e.tileId - last); last = e.tileId; }
  for (const e of entries) writeVarint(out, e.runLength);
  for (const e of entries) writeVarint(out, e.length);
  entries.forEach((e, i) => writeVarint(out, i > 0 && e.offset === entries[i - 1].offset + entries[i - 1].length ? 0 : e.offset + 1));
  return zlib.gzipSync(Buffer.from(out), { level: 9 });
}

const u64 = (buf, at) => Number(buf.readBigUInt64LE(at));
function parseHeader(buf) {
  if (buf.subarray(0, 7).toString() !== 'PMTiles' || buf[7] !== 3) throw new Error('not a PMTiles v3 archive');
  return {
    rootOffset: u64(buf, 8), rootLength: u64(buf, 16), metadataOffset: u64(buf, 24), metadataLength: u64(buf, 32),
    leafOffset: u64(buf, 40), leafLength: u64(buf, 48), dataOffset: u64(buf, 56), dataLength: u64(buf, 64),
    internalCompression: buf[97], tileCompression: buf[98], tileType: buf[99], minZoom: buf[100], maxZoom: buf[101],
  };
}

function writeHeader(h) {
  const buf = Buffer.alloc(127);
  buf.write('PMTiles', 0); buf[7] = 3;
  [h.rootOffset, h.rootLength, h.metadataOffset, h.metadataLength, h.leafOffset, h.leafLength, h.dataOffset, h.dataLength,
    h.addressed, h.entries, h.contents].forEach((v, i) => buf.writeBigUInt64LE(BigInt(v), 8 + i * 8));
  buf[96] = 1; buf[97] = 2; buf[98] = h.tileCompression; buf[99] = h.tileType; buf[100] = h.minZoom; buf[101] = h.maxZoom;
  const [south, west, north, east] = h.box;
  [west, south, east, north].forEach((v, i) => buf.writeInt32LE(Math.round(v * 1e7), 102 + i * 4));
  buf[118] = Math.min(h.maxZoom, 14);
  buf.writeInt32LE(Math.round((west + east) / 2 * 1e7), 119); buf.writeInt32LE(Math.round((south + north) / 2 * 1e7), 123);
  return buf;
}

// Tiles sorted by id, each { id, data }. Repeated contents are stored once; runs
// of equal neighbours share an entry. Leaves only when the root would not fit.
function buildArchive(tiles, { box, minZoom, maxZoom, tileCompression, tileType, metadata }) {
  const chunks = [], seen = new Map(), entries = [];
  let dataLength = 0;
  for (const t of tiles) {
    const hash = crypto.createHash('sha256').update(t.data).digest('hex');
    let stored = seen.get(hash);
    if (!stored) { stored = { offset: dataLength, length: t.data.length }; seen.set(hash, stored); chunks.push(t.data); dataLength += t.data.length; }
    const prev = entries.at(-1);
    if (prev && prev.offset === stored.offset && prev.tileId + prev.runLength === t.id) prev.runLength++;
    else entries.push({ tileId: t.id, runLength: 1, offset: stored.offset, length: stored.length });
  }
  let rootDir = serializeDirectory(entries), leafDir = Buffer.alloc(0);
  for (let size = 4096; rootDir.length > 16384 - 127; size *= 2) {
    const leaves = [], rootEntries = [];
    let leafLength = 0;
    for (let i = 0; i < entries.length; i += size) {
      const leaf = serializeDirectory(entries.slice(i, i + size));
      rootEntries.push({ tileId: entries[i].tileId, runLength: 0, offset: leafLength, length: leaf.length });
      leaves.push(leaf); leafLength += leaf.length;
    }
    rootDir = serializeDirectory(rootEntries); leafDir = Buffer.concat(leaves);
  }
  const meta = zlib.gzipSync(Buffer.from(JSON.stringify(metadata)), { level: 9 });
  const header = { rootOffset: 127, rootLength: rootDir.length };
  header.metadataOffset = 127 + rootDir.length; header.metadataLength = meta.length;
  header.leafOffset = header.metadataOffset + meta.length; header.leafLength = leafDir.length;
  header.dataOffset = header.leafOffset + leafDir.length; header.dataLength = dataLength;
  Object.assign(header, { addressed: tiles.length, entries: entries.length, contents: seen.size, box, minZoom, maxZoom, tileCompression, tileType });
  return Buffer.concat([writeHeader(header), rootDir, meta, leafDir, ...chunks]);
}

// ---- Reading the remote archive ----

let transferred = 0;
async function range(url, offset, length) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
      if (res.status !== 206) throw new Error(`HTTP ${res.status} for a range of ${url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length !== length) throw new Error(`short read: ${buf.length} of ${length}`);
      transferred += length;
      return buf;
    } catch (error) {
      if (attempt >= 4) throw error;
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
}

async function latestPlanet() {
  for (let back = 0; back < 10; back++) {
    const day = new Date(Date.now() - back * 86400000).toISOString().slice(0, 10).replaceAll('-', '');
    const url = `https://build.protomaps.com/${day}.pmtiles`;
    const res = await fetch(url, { method: 'HEAD' });
    if (res.ok) return url;
  }
  throw new Error('no Protomaps planet build in the last 10 days; pass --planet URL');
}

function findEntry(entries, id) {
  let lo = 0, hi = entries.length - 1, best = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (entries[mid].tileId <= id) { best = mid; lo = mid + 1; } else hi = mid - 1; }
  return best < 0 ? null : entries[best];
}

async function openRemote(url) {
  const head = await range(url, 0, 16384);
  const header = parseHeader(head);
  const rootDir = parseDirectory(decompress(head.subarray(header.rootOffset, header.rootOffset + header.rootLength), header.internalCompression));
  const metadata = JSON.parse(decompress(await range(url, header.metadataOffset, header.metadataLength), header.internalCompression));
  const leaves = new Map();
  // Where a tile's bytes are in the archive, or null when the archive lacks it.
  async function locate(id) {
    let entries = rootDir;
    for (let depth = 0; depth < 4; depth++) {
      const e = findEntry(entries, id);
      if (!e) return null;
      if (e.runLength > 0) return id < e.tileId + e.runLength ? { offset: header.dataOffset + e.offset, length: e.length } : null;
      const key = e.offset;
      if (!leaves.has(key)) leaves.set(key, range(url, header.leafOffset + e.offset, e.length).then(b => parseDirectory(decompress(b, header.internalCompression))));
      entries = await leaves.get(key);
    }
    throw new Error('directories nested too deep');
  }
  return { header, metadata, locate };
}

// Fetches many tiles by merging nearby ranges into requests of up to 8 MB.
async function fetchAll(url, located) {
  const sorted = [...located].sort((a, b) => a.offset - b.offset);
  const groups = [];
  for (const t of sorted) {
    const g = groups.at(-1);
    if (g && t.offset <= g.end + 65536 && t.offset + t.length - g.start <= 8 * 2 ** 20) { g.items.push(t); g.end = Math.max(g.end, t.offset + t.length); }
    else groups.push({ start: t.offset, end: t.offset + t.length, items: [t] });
  }
  let next = 0, done = 0;
  const worker = async () => {
    while (next < groups.length) {
      const g = groups[next++];
      const buf = await range(url, g.start, g.end - g.start);
      for (const t of g.items) t.data = buf.subarray(t.offset - g.start, t.offset - g.start + t.length);
      if (++done % 20 === 0) process.stderr.write(`  ${done}/${groups.length} requests, ${(transferred / 2 ** 20).toFixed(1)} MiB\n`);
    }
  };
  await Promise.all([1, 2, 3, 4].map(worker));
}

// ---- Report ----

const kib = n => `${(n / 1024).toFixed(0)} KiB`, mib = n => `${(n / 2 ** 20).toFixed(1)} MiB`;
const size = n => n >= 2 ** 20 ? mib(n) : kib(n);

const planet = option('--planet', null) ?? await latestPlanet();
console.log(`Source: ${planet}`);
const remote = await openRemote(planet);
console.log(`Planet: max zoom ${remote.header.maxZoom}, tile type ${remote.header.tileType} (1 = MVT), tile compression ${remote.header.tileCompression} (2 = gzip)\n`);

await fs.mkdir(outDir, { recursive: true });
const report = { source: planet, boxes: BOXES, rows: [], zooms: {} };
console.log('| Area | Zoom | Tiles | Distinct | Bytes (gzip MVT) | Largest tile |\n| --- | ---: | ---: | ---: | ---: | ---: |');
for (const [area, box] of Object.entries(BOXES)) {
  report.zooms[area] = [];
  for (let z = 0; z <= remote.header.maxZoom; z++) {
    const tiles = tilesInBox(box, z);
    for (const t of tiles) t.at = await remote.locate(t.id);
    const present = tiles.filter(t => t.at), distinct = new Map(present.map(t => [t.at.offset, t.at.length]));
    const bytes = [...distinct.values()].reduce((a, b) => a + b, 0), largest = Math.max(0, ...distinct.values());
    report.zooms[area].push({ z, tiles: present.length, distinct: distinct.size, bytes, largest });
    if (z >= 10) console.log(`| ${area} | ${z} | ${present.length} | ${distinct.size} | ${size(bytes)} | ${kib(largest)} |`);
    box.tiles ??= []; box.tiles.push(...present);
  }
}
console.log(`\nDirectories read: ${mib(transferred)}.`);

if (fetchTiles) {
  const unique = new Map();
  for (const box of Object.values(BOXES)) for (const t of box.tiles) unique.set(t.at.offset, unique.get(t.at.offset) ?? { offset: t.at.offset, length: t.at.length });
  console.error(`Fetching ${unique.size} distinct tiles…`);
  await fetchAll(planet, unique.values());
  console.log(`\n| Archive | Tiles | Archive size | gzip -9 of the whole file | Directories and metadata |\n| --- | ---: | ---: | ---: | ---: |`);
  for (const [area, box] of Object.entries(BOXES)) {
    for (const maxZoom of MAX_ZOOMS) {
      const tiles = box.tiles.filter(t => t.z <= maxZoom).map(t => ({ id: t.id, data: unique.get(t.at.offset).data })).sort((a, b) => a.id - b.id);
      const archive = buildArchive(tiles, { box: box.slice(0, 4), minZoom: 0, maxZoom, tileCompression: remote.header.tileCompression, tileType: remote.header.tileType, metadata: { ...remote.metadata, bounds: undefined } });
      const file = path.join(outDir, `${area}-z${maxZoom}.pmtiles`);
      await fs.writeFile(file, archive);
      const overhead = parseHeader(archive);
      const row = { area, maxZoom, tiles: tiles.length, bytes: archive.length, gzip: zlib.gzipSync(archive, { level: 9 }).length, overhead: overhead.dataOffset };
      report.rows.push(row);
      console.log(`| ${path.relative(root, file)} | ${row.tiles} | ${size(row.bytes)} | ${size(row.gzip)} | ${kib(row.overhead)} |`);
    }
  }
  console.log(`\nTransferred in all: ${mib(transferred)}.`);
}
for (const box of Object.values(BOXES)) delete box.tiles;
await fs.writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
