// Data snapshots: immutable sets of the map's data files, named by content hash.
// Shared by the browser (loading) and by the scripts (building, checking, staging).
//
//   data/current.json                  { format, version, snapshot: "<id>" }
//   data/snapshots/<id>.json           the snapshot manifest
//   data/store/<layer>/<sha256>.geojson one file per distinct content, never edited
//
// See docs/data-history.md.
import { DATA_LAYERS, DATA_SCHEMA } from './data-layers.js';

export const CURRENT_FORMAT = 'pedway-data-current';
export const SNAPSHOT_FORMAT = 'pedway-data-snapshot';
export const SNAPSHOT_ID = /^\d{4}-\d{2}-\d{2}(-\d{1,3})?$/;
const SHA256 = /^[0-9a-f]{64}$/;
// Optional layers (the self-hosted base map) may be missing from older snapshots.
const REQUIRED_KEYS = DATA_LAYERS.filter(layer => !layer.optional).map(layer => layer.key);

const fail = message => { throw new Error(message); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const storePath = (layer, sha256) => `store/${layer}/${sha256}.geojson`;
export const snapshotPath = id => `snapshots/${id}.json`;

export async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Checks data/current.json and returns the snapshot id it names. */
export function readCurrent(value) {
  if (!plain(value) || value.format !== CURRENT_FORMAT || value.version !== 1) fail('data/current.json is not a Pedway data pointer.');
  if (typeof value.snapshot !== 'string' || !SNAPSHOT_ID.test(value.snapshot)) fail('data/current.json names no valid snapshot.');
  return value.snapshot;
}
export const makeCurrent = id => ({ format: CURRENT_FORMAT, version: 1, snapshot: id });

/**
 * Checks a snapshot manifest's shape. It does not check the files themselves, or
 * whether this app accepts the manifest's schema: see acceptsSchema.
 */
export function validateManifest(manifest, id = manifest?.id) {
  if (!plain(manifest) || manifest.format !== SNAPSHOT_FORMAT || manifest.version !== 1) fail(`Snapshot ${id}: not a Pedway data snapshot.`);
  if (typeof manifest.id !== 'string' || !SNAPSHOT_ID.test(manifest.id)) fail(`Snapshot ${id}: bad id.`);
  if (manifest.id !== id) fail(`Snapshot ${id}: manifest says it is ${manifest.id}.`);
  if (!Number.isInteger(manifest.schema) || manifest.schema < 1) fail(`Snapshot ${id}: schema must be a whole number.`);
  if (manifest.previous !== undefined && (typeof manifest.previous !== 'string' || !SNAPSHOT_ID.test(manifest.previous))) fail(`Snapshot ${id}: bad previous snapshot.`);
  for (const key of ['built', 'osmBase', 'attribution']) {
    if (manifest[key] !== undefined && typeof manifest[key] !== 'string') fail(`Snapshot ${id}: ${key} must be text.`);
  }
  if (manifest.migratedFrom !== undefined && (!Number.isInteger(manifest.migratedFrom) || manifest.migratedFrom >= manifest.schema)) fail(`Snapshot ${id}: migratedFrom must be an older schema.`);
  if (!plain(manifest.files)) fail(`Snapshot ${id}: no files.`);
  for (const [layer, file] of Object.entries(manifest.files)) {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(layer)) fail(`Snapshot ${id}: bad layer name.`);
    if (!plain(file) || !SHA256.test(file.sha256 ?? '')) fail(`Snapshot ${id}: ${layer} needs a sha256.`);
    // The path is derived, never trusted: a manifest cannot point outside the store.
    if (file.path !== storePath(layer, file.sha256)) fail(`Snapshot ${id}: ${layer} path must be ${storePath(layer, file.sha256)}.`);
    if (!Number.isInteger(file.bytes) || file.bytes < 0 || !Number.isInteger(file.features) || file.features < 0) fail(`Snapshot ${id}: ${layer} needs bytes and features counts.`);
  }
  return manifest;
}

/** Whether this version of the app can read a snapshot, and what it is missing if not. */
export function acceptsSchema(manifest) {
  if (!DATA_SCHEMA.accepts.includes(manifest.schema)) return `uses data schema ${manifest.schema}; this app reads ${DATA_SCHEMA.accepts.join(' or ')}`;
  const missing = REQUIRED_KEYS.filter(key => !manifest.files[key]);
  return missing.length ? `has no ${missing.join(', ')} data` : null;
}

/**
 * Loads the current (or a named) snapshot's manifest over HTTP. Resolves with the
 * manifest and file(key), which fetches one layer's file the first time it is asked
 * for, so a single bad file leaves the others usable and unused layers cost nothing.
 * Each file must match its SHA-256 when the browser can hash (secure contexts).
 */
export async function fetchSnapshot(baseUrl, { id = null, fetch = globalThis.fetch } = {}) {
  const json = async (path, options) => {
    const response = await fetch(new URL(path, baseUrl), options);
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    return response.json();
  };
  // current.json changes with each deployment; revalidate it so it never names a snapshot that is gone.
  const snapshot = id ?? readCurrent(await json('current.json', { cache: 'no-cache' }));
  const manifest = validateManifest(await json(snapshotPath(snapshot)), snapshot);
  const problem = acceptsSchema(manifest);
  if (problem) throw new Error(`Data snapshot ${snapshot} ${problem}.`);
  const canHash = Boolean(globalThis.crypto?.subtle);
  const loading = new Map();
  const load = async key => {
    if (!manifest.files[key]) throw new Error(`Data snapshot ${snapshot} has no ${key} data.`);
    const { path, sha256 } = manifest.files[key];
    const response = await fetch(new URL(path, baseUrl));
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    const bytes = await response.arrayBuffer();
    if (canHash && await sha256Hex(bytes) !== sha256) throw new Error(`${key} data does not match its snapshot.`);
    return JSON.parse(new TextDecoder().decode(bytes));
  };
  const file = key => {
    if (!loading.has(key)) loading.set(key, load(key));
    return loading.get(key);
  };
  return { manifest, file, has: key => Boolean(manifest.files[key]) };
}
