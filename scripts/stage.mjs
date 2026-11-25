#!/usr/bin/env node
// Copies only the files the site needs into an output folder for GitHub Pages,
// then writes the offline manifest (offline-assets.js) for the service worker.
//   node scripts/stage.mjs [out] [--data <snapshot id>] [--self-contained]
// --self-contained stages a copy that never contacts another server (docs/map-layers.md, "Self-contained build").
// Of the data, only one snapshot is staged: the one data/current.json names, or
// --data's. Its files are checked against their hashes. A snapshot on an older
// schema is migrated (scripts/migrate-data.mjs); staging stops if this version of
// the app cannot read the snapshot even then.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateOffline } from '../vendor/fragment-kit-v0.5.0/tools/offline-assets.mjs';
import { walk } from '../vendor/fragment-kit-v0.5.0/tools/lib.mjs';
import { DATA_LAYERS, DATA_SCHEMA } from '../src/data-layers.js';
import { DATA_DIR, currentId, materialize } from './snapshots.mjs';
import { dataForApp } from './migrate-data.mjs';

const LAYER_KEYS = DATA_LAYERS.map(layer => layer.key);
const OPTIONAL_KEYS = DATA_LAYERS.filter(layer => layer.optional).map(layer => layer.key);

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const SHIP = [
  'index.html', 'examples.html', 'style.css', 'examples.css', 'icon.svg', 'service-worker.js', 'src',
  'vendor/leaflet-1.9.4', 'vendor/marked-18.1.2', 'vendor/dompurify-3.4.17',
  'vendor/fragment-kit-v0.5.0/src',
  'vendor/fragment-kit-v0.5.0/vendor',
  'vendor/fragment-kit-v0.5.0/LICENSE',
];
// Inside the shipped folders, but never loaded by the site.
export const SKIP = [
  'vendor/fragment-kit-v0.5.0/src/ai',                     // optional AI features, not used
  'vendor/fragment-kit-v0.5.0/vendor/jsqr/jsQR.js',        // the kit loads jsQR-fk.js
  'vendor/fragment-kit-v0.5.0/vendor/hashbin-sdk-v0.6.0.mjs', // the kit v0.5.0 loads v0.4.0
  'vendor/leaflet-1.9.4/leaflet.js.map',
];
// Shipped for their licences, but not needed to run offline.
const NOT_OFFLINE = /(^|\/)(LICENSE[^/]*|PROVENANCE\.md|package\.json)$/;
export const CACHE_PREFIX = 'pedway';

/** Writes one snapshot into out/data, laid out as in the repository, migrating it if this app needs that. */
export async function stageData(target, { data = null, dataDir = DATA_DIR, migrations, accepts = DATA_SCHEMA.accepts, prepared = null } = {}) {
  const ready = prepared ?? await dataForApp(dataDir, data ?? await currentId(dataDir), { accepts, layers: LAYER_KEYS, optional: OPTIONAL_KEYS, migrations });
  return materialize(path.join(target, 'data'), ready.manifest, ready.texts, { schema: ready.schema, migratedFrom: ready.migratedFrom });
}
/**
 * Makes a staged copy self-contained: the app is told it may contact no other server
 * (src/deployment.js), and the Content Security Policy names no other host, so the
 * browser itself refuses any request that slips through.
 */
export async function makeSelfContained(target) {
  const flag = path.join(target, 'src/deployment.js');
  const source = await fs.readFile(flag, 'utf8');
  if (!source.includes('export const SELF_CONTAINED = false;')) throw new Error('src/deployment.js no longer declares SELF_CONTAINED = false.');
  await fs.writeFile(flag, source.replace('export const SELF_CONTAINED = false;', 'export const SELF_CONTAINED = true;'));
  for (const page of ['index.html', 'examples.html']) {
    const file = path.join(target, page);
    const html = await fs.readFile(file, 'utf8');
    await fs.writeFile(file, html.replace(/(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")/, (_, open, policy, close) => open + policy.replace(/\s+https:\/\/[^\s;]+/g, '') + close));
  }
}

// `accepts` and `migrations` default to this app's own; tests pass others to try future schemas.
// selfContained stages a copy that contacts no other server (makeSelfContained).
export async function stage(out, { data = null, dataDir = DATA_DIR, migrations, accepts = DATA_SCHEMA.accepts, selfContained = false } = {}) {
  const target = path.resolve(root, out);
  if (target === root || !target.startsWith(root + path.sep)) throw new Error('Stage into a subfolder of the repository.');
  // Check the data before touching the output folder, so a bad --data leaves it as it was.
  const prepared = await dataForApp(dataDir, data ?? await currentId(dataDir), { accepts, layers: LAYER_KEYS, optional: OPTIONAL_KEYS, migrations });
  await fs.rm(target, { recursive: true, force: true });
  const skip = new Set(SKIP.map(entry => path.join(root, entry)));
  for (const entry of SHIP) {
    await fs.cp(path.join(root, entry), path.join(target, entry), { recursive: true, errorOnExist: true, filter: source => !skip.has(source) });
  }
  await stageData(target, { prepared });
  if (selfContained) await makeSelfContained(target);
  await fs.writeFile(path.join(target, '.nojekyll'), '');
  const files = (await walk(target)).filter(file => file !== 'service-worker.js' && !NOT_OFFLINE.test(file));
  const config = path.join(target, 'offline.config.json');
  await fs.writeFile(config, JSON.stringify({ prefix: CACHE_PREFIX, files, output: 'offline-assets.js' }));
  try { await generateOffline(config); } finally { await fs.rm(config); }
  return target;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), at = args.indexOf('--data');
    const data = at >= 0 ? args.splice(at, 2)[1] : null;
    if (at >= 0 && !data) throw new Error('--data needs a snapshot id, such as 2026-11-24.');
    const selfContained = args.includes('--self-contained');
    const out = args.filter(arg => arg !== '--self-contained')[0] ?? '_site';
    console.log('Staged ' + await stage(out, { data, selfContained }) + ` with data snapshot ${data ?? await currentId()}${selfContained ? ', self-contained' : ''}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
