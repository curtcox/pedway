#!/usr/bin/env node
// Copies only the files the site needs into an output folder for GitHub Pages,
// then writes the offline manifest (offline-assets.js) for the service worker.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateOffline } from '../vendor/fragment-kit-v0.5.0/tools/offline-assets.mjs';
import { walk } from '../vendor/fragment-kit-v0.5.0/tools/lib.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const SHIP = [
  'index.html', 'examples.html', 'style.css', 'examples.css', 'icon.svg', 'service-worker.js', 'src', 'data',
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

export async function stage(out) {
  const target = path.resolve(root, out);
  if (target === root || !target.startsWith(root + path.sep)) throw new Error('Stage into a subfolder of the repository.');
  await fs.rm(target, { recursive: true, force: true });
  const skip = new Set(SKIP.map(entry => path.join(root, entry)));
  for (const entry of SHIP) {
    await fs.cp(path.join(root, entry), path.join(target, entry), { recursive: true, errorOnExist: true, filter: source => !skip.has(source) });
  }
  await fs.writeFile(path.join(target, '.nojekyll'), '');
  const files = (await walk(target)).filter(file => file !== 'service-worker.js' && !NOT_OFFLINE.test(file));
  const config = path.join(target, 'offline.config.json');
  await fs.writeFile(config, JSON.stringify({ prefix: CACHE_PREFIX, files, output: 'offline-assets.js' }));
  try { await generateOffline(config); } finally { await fs.rm(config); }
  return target;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('Staged ' + await stage(process.argv[2] ?? '_site'));
}
