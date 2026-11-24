#!/usr/bin/env node
// Copies only the files the site needs into an output folder for GitHub Pages.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const SHIP = [
  'index.html', 'examples.html', 'style.css', 'examples.css', 'icon.svg', 'src', 'data',
  'vendor/leaflet-1.9.4', 'vendor/marked-18.1.2', 'vendor/dompurify-3.4.17',
  'vendor/fragment-kit-v0.5.0/src',
  'vendor/fragment-kit-v0.5.0/vendor',
  'vendor/fragment-kit-v0.5.0/LICENSE',
];

export async function stage(out) {
  const target = path.resolve(root, out);
  if (target === root || !target.startsWith(root + path.sep)) throw new Error('Stage into a subfolder of the repository.');
  await fs.rm(target, { recursive: true, force: true });
  for (const entry of SHIP) await fs.cp(path.join(root, entry), path.join(target, entry), { recursive: true, errorOnExist: true });
  await fs.writeFile(path.join(target, '.nojekyll'), '');
  return target;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('Staged ' + await stage(process.argv[2] ?? '_site'));
}
