#!/usr/bin/env node
// Copies only the files the site needs into an output folder for GitHub Pages,
// then writes the offline manifest (offline-assets.js) for the service worker.
//   node scripts/stage.mjs [out] [--data <snapshot id>]
// Of the data, only one snapshot is staged: the one data/current.json names, or
// --data's. Its files are checked against their hashes, and staging stops if this
// version of the app cannot read the snapshot's schema.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateOffline } from '../vendor/fragment-kit-v0.5.0/tools/offline-assets.mjs';
import { walk } from '../vendor/fragment-kit-v0.5.0/tools/lib.mjs';
import { acceptsSchema, makeCurrent, snapshotPath } from '../src/data-snapshot.js';
import { DATA_DIR, currentId, readSnapshot } from './snapshots.mjs';

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

/** Writes one snapshot into out/data, laid out as in the repository. */
export async function stageData(target, { data = null, dataDir = DATA_DIR } = {}) {
  const id = data ?? await currentId(dataDir);
  const { manifest } = await readSnapshot(dataDir, id);
  const problem = acceptsSchema(manifest);
  if (problem) throw new Error(`Data snapshot ${id} ${problem}.`);
  const out = path.join(target, 'data');
  await fs.mkdir(path.join(out, 'snapshots'), { recursive: true });
  await fs.copyFile(path.join(dataDir, snapshotPath(id)), path.join(out, snapshotPath(id)));
  for (const file of Object.values(manifest.files)) {
    await fs.mkdir(path.dirname(path.join(out, file.path)), { recursive: true });
    await fs.copyFile(path.join(dataDir, file.path), path.join(out, file.path));
  }
  await fs.writeFile(path.join(out, 'current.json'), JSON.stringify(makeCurrent(id), null, 2) + '\n');
  return manifest;
}

export async function stage(out, { data = null, dataDir = DATA_DIR } = {}) {
  const target = path.resolve(root, out);
  if (target === root || !target.startsWith(root + path.sep)) throw new Error('Stage into a subfolder of the repository.');
  // Check the data before touching the output folder, so a bad --data leaves it as it was.
  const id = data ?? await currentId(dataDir);
  const problem = acceptsSchema((await readSnapshot(dataDir, id)).manifest);
  if (problem) throw new Error(`Data snapshot ${id} ${problem}.`);
  await fs.rm(target, { recursive: true, force: true });
  const skip = new Set(SKIP.map(entry => path.join(root, entry)));
  for (const entry of SHIP) {
    await fs.cp(path.join(root, entry), path.join(target, entry), { recursive: true, errorOnExist: true, filter: source => !skip.has(source) });
  }
  await stageData(target, { data, dataDir });
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
    console.log('Staged ' + await stage(args[0] ?? '_site', { data }) + ` with data snapshot ${data ?? await currentId()}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
