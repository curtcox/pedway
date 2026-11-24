// Reads and writes data snapshots on disk (see src/data-snapshot.js and docs/data-history.md).
//   node scripts/snapshots.mjs                 list snapshots, marking the current one
//   node scripts/snapshots.mjs use <id>        point data/current.json at another snapshot
//   node scripts/snapshots.mjs oldest          print the oldest snapshot this app can read
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_LAYERS, DATA_SCHEMA } from '../src/data-layers.js';
import { makeCurrent, readCurrent, validateManifest, acceptsSchema, sha256Hex, storePath, snapshotPath, SNAPSHOT_FORMAT, SNAPSHOT_ID } from '../src/data-snapshot.js';

const root = fileURLToPath(new URL('..', import.meta.url));
export const DATA_DIR = path.join(root, 'data');

const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const writeJson = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');

export async function currentId(dir = DATA_DIR) {
  return readCurrent(await readJson(path.join(dir, 'current.json')));
}
export async function setCurrent(dir, id) {
  await readManifest(dir, id);
  await writeJson(path.join(dir, 'current.json'), makeCurrent(id));
}
export async function listSnapshots(dir = DATA_DIR) {
  const names = await fs.readdir(path.join(dir, 'snapshots')).catch(() => []);
  return names.filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)).filter(id => SNAPSHOT_ID.test(id)).sort();
}
export async function readManifest(dir, id) {
  if (!SNAPSHOT_ID.test(id ?? '')) throw new Error(`“${id}” is not a snapshot id (YYYY-MM-DD).`);
  let manifest;
  try { manifest = await readJson(path.join(dir, snapshotPath(id))); } catch (error) {
    throw new Error(error.code === 'ENOENT' ? `There is no data snapshot ${id}.` : `Snapshot ${id}: ${error.message}`);
  }
  return validateManifest(manifest, id);
}
/** A snapshot's manifest and file texts, each checked against its hash. */
export async function readSnapshot(dir, id) {
  const manifest = await readManifest(dir, id);
  const texts = {};
  for (const [layer, file] of Object.entries(manifest.files)) {
    const bytes = await fs.readFile(path.join(dir, file.path));
    if (await sha256Hex(bytes) !== file.sha256) throw new Error(`Snapshot ${id}: ${file.path} does not match its hash.`);
    texts[layer] = bytes.toString('utf8');
  }
  return { manifest, texts };
}

// One feature per line keeps diffs between snapshots readable and small.
export function geojsonText({ name, attribution, features }) {
  return `{"type":"FeatureCollection","name":${JSON.stringify(name)},"attribution":${JSON.stringify(attribution)},"features":[\n${features.map(f => JSON.stringify(f)).join(',\n')}\n]}\n`;
}

/** The manifest entries for these texts: path, hash, size and feature count per layer. */
export async function describeFiles(texts, layers = Object.keys(texts)) {
  const files = {};
  for (const layer of layers) {
    const bytes = Buffer.from(texts[layer], 'utf8');
    const sha256 = await sha256Hex(bytes);
    files[layer] = { path: storePath(layer, sha256), sha256, bytes: bytes.length, features: JSON.parse(texts[layer]).features.length };
  }
  return files;
}

async function writeStore(dir, texts, files) {
  for (const [layer, file] of Object.entries(files)) {
    const target = path.join(dir, file.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    // Store files are immutable: an existing one already holds exactly these bytes.
    await fs.writeFile(target, texts[layer], { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  }
}

/**
 * Writes one snapshot (manifest, store files and current.json) into a fresh data
 * folder, such as a staged site. `manifest` supplies the id and metadata; the files
 * are described anew from `texts`, so migrated texts get their own hashes.
 */
export async function materialize(dir, manifest, texts, { schema = manifest.schema, layers = Object.keys(texts), migratedFrom } = {}) {
  const files = await describeFiles(texts, layers);
  await writeStore(dir, texts, files);
  const out = validateManifest({ ...manifest, schema, files, ...(migratedFrom !== undefined ? { migratedFrom } : {}) }, manifest.id);
  await fs.mkdir(path.join(dir, 'snapshots'), { recursive: true });
  await writeJson(path.join(dir, snapshotPath(out.id)), out);
  await writeJson(path.join(dir, 'current.json'), makeCurrent(out.id));
  return out;
}

/** The oldest snapshot this version of the app can read without migrating, or null. */
export async function oldestAccepted(dir = DATA_DIR) {
  for (const id of await listSnapshots(dir)) if (!acceptsSchema(await readManifest(dir, id))) return id;
  return null;
}

/** Today's id, with -2, -3… when a snapshot already exists for the day. */
export async function nextId(dir, date = new Date()) {
  const day = date.toISOString().slice(0, 10), taken = new Set(await listSnapshots(dir));
  if (!taken.has(day)) return day;
  for (let n = 2; n < 1000; n++) if (!taken.has(`${day}-${n}`)) return `${day}-${n}`;
  throw new Error(`Too many snapshots on ${day}.`);
}

/**
 * Adds a snapshot holding these file texts and points data/current.json at it.
 * Returns null, writing nothing, when every file matches the current snapshot.
 */
export async function writeSnapshot(dir, texts, { id = null, built = new Date(), osmBase, builder, attribution } = {}) {
  const missing = DATA_LAYERS.map(layer => layer.key).filter(key => typeof texts[key] !== 'string');
  if (missing.length) throw new Error(`A snapshot needs every layer; missing ${missing.join(', ')}.`);
  const previous = await currentId(dir).catch(() => undefined);
  const files = await describeFiles(texts, DATA_LAYERS.map(layer => layer.key));
  if (previous) {
    const old = await readManifest(dir, previous);
    if (old.schema === DATA_SCHEMA.version && DATA_LAYERS.every(layer => old.files[layer.key]?.sha256 === files[layer.key].sha256)) return null;
  }
  const snapshot = id ?? await nextId(dir, built);
  if ((await listSnapshots(dir)).includes(snapshot)) throw new Error(`Snapshot ${snapshot} already exists; snapshots are never rewritten.`);
  await writeStore(dir, texts, files);
  const manifest = validateManifest({
    format: SNAPSHOT_FORMAT, version: 1, id: snapshot, schema: DATA_SCHEMA.version,
    built: built.toISOString(), ...(osmBase ? { osmBase } : {}), ...(builder ? { builder } : {}),
    ...(previous ? { previous } : {}), ...(attribution ? { attribution } : {}), files,
  }, snapshot);
  await fs.mkdir(path.join(dir, 'snapshots'), { recursive: true });
  await writeJson(path.join(dir, snapshotPath(snapshot)), manifest);
  await writeJson(path.join(dir, 'current.json'), makeCurrent(snapshot));
  return manifest;
}

async function main() {
  const [command, id] = process.argv.slice(2);
  if (command === 'use') {
    await setCurrent(DATA_DIR, id);
    console.log(`data/current.json now names ${id}.`);
    return;
  }
  if (command === 'oldest') {
    const oldest = await oldestAccepted();
    if (!oldest) throw new Error('No snapshot uses a schema this app reads.');
    console.log(oldest);
    return;
  }
  if (command) throw new Error('Usage: node scripts/snapshots.mjs [use <id> | oldest]');
  const current = await currentId().catch(() => null);
  for (const snapshot of await listSnapshots()) {
    const manifest = await readManifest(DATA_DIR, snapshot);
    const features = Object.entries(manifest.files).map(([layer, file]) => `${layer} ${file.features}`).join(', ');
    console.log(`${snapshot === current ? '*' : ' '} ${snapshot}  schema ${manifest.schema}  ${features}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main().catch(error => { console.error(error.message); process.exit(1); });
