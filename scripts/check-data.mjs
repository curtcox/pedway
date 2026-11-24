// Validates the data snapshots: data/current.json, every manifest in
// data/snapshots/, every file in data/store/ (hash, shape, properties, Chicago
// bounds, size limits) and that no store file is left unreferenced.
//   node scripts/check-data.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHICAGO_BOUNDS } from '../src/map-defaults.js';
import { DATA_LAYERS, POI_CATEGORIES } from '../src/data-layers.js';
import { readCurrent, acceptsSchema, sha256Hex } from '../src/data-snapshot.js';
import { DATA_DIR, listSnapshots, readManifest } from './snapshots.mjs';

const [[S, W], [N, E]] = CHICAGO_BOUNDS;
const MAX_BYTES = 300 * 1024;
const ID = /^[nwr]\d+$/;

function inBounds([lon, lat]) { return Number.isFinite(lat) && Number.isFinite(lon) && lat >= S && lat <= N && lon >= W && lon <= E; }

/** Checks one data file's text against its layer's rules (the current schema). */
export function checkLayerText(layer, text, name = layer.file) {
  const errors = [];
  if (Buffer.byteLength(text) > MAX_BYTES) errors.push(`${name}: larger than ${MAX_BYTES / 1024} KB`);
  let data;
  try { data = JSON.parse(text); } catch (error) { errors.push(`${name}: not JSON (${error.message})`); return errors; }
  if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) { errors.push(`${name}: not a FeatureCollection`); return errors; }
  if (!/OpenStreetMap/.test(data.attribution ?? '')) errors.push(`${name}: attribution missing`);
  if (data.features.length < layer.minFeatures) errors.push(`${name}: only ${data.features.length} features, expected at least ${layer.minFeatures}`);
  const ids = new Set();
  for (const [i, feature] of data.features.entries()) {
    const where = `${name} feature ${feature?.id ?? i}`;
    if (feature?.type !== 'Feature') { errors.push(`${where}: not a Feature`); continue; }
    if (!ID.test(feature.id ?? '')) errors.push(`${where}: id must look like n123, w123 or r123`);
    if (ids.has(feature.id)) errors.push(`${where}: duplicate id`);
    ids.add(feature.id);
    const { geometry, properties } = feature;
    if (geometry?.type !== layer.geometry) { errors.push(`${where}: geometry must be ${layer.geometry}`); continue; }
    const points = geometry.type === 'Point' ? [geometry.coordinates] : geometry.coordinates;
    if (!Array.isArray(points) || (geometry.type === 'LineString' && points.length < 2)) errors.push(`${where}: bad coordinates`);
    else if (!points.every(p => Array.isArray(p) && p.length === 2 && inBounds(p))) errors.push(`${where}: coordinates outside Chicago`);
    if (!properties || typeof properties !== 'object') { errors.push(`${where}: no properties`); continue; }
    for (const [key, check] of Object.entries(layer.properties)) {
      const value = properties[key];
      if (check.required && value === undefined) errors.push(`${where}: ${key} is required`);
      if (value !== undefined && check.values && !check.values.includes(value)) errors.push(`${where}: ${key} is “${value}”`);
      if (value !== undefined && check.type === 'string' && (typeof value !== 'string' || value.length > 200)) errors.push(`${where}: ${key} must be short text`);
      if (value !== undefined && check.type === 'list' && (!Array.isArray(value) || !value.every(v => typeof v === 'string'))) errors.push(`${where}: ${key} must be a list of text`);
      if (value !== undefined && check.type === 'boolean' && typeof value !== 'boolean') errors.push(`${where}: ${key} must be true or false`);
    }
    for (const key of Object.keys(properties)) if (!(key in layer.properties)) errors.push(`${where}: unexpected property ${key}`);
  }
  if (layer.key === 'poi') for (const category of POI_CATEGORIES) {
    const count = data.features.filter(feature => feature?.properties?.category === category.key).length;
    if (count < category.minFeatures) errors.push(`${name}: only ${count} ${category.key} places, expected at least ${category.minFeatures}`);
  }
  return errors;
}

/** Checks every snapshot under dir. Warnings (snapshots this app cannot read) go to onWarning. */
export async function checkData(dir = DATA_DIR, { onWarning = () => {} } = {}) {
  const errors = [];
  let current = null;
  try { current = readCurrent(JSON.parse(await fs.readFile(path.join(dir, 'current.json'), 'utf8'))); }
  catch (error) { errors.push(`current.json: ${error.code === 'ENOENT' ? 'missing' : error.message}`); }
  const ids = await listSnapshots(dir);
  if (!ids.length) errors.push('snapshots: there are none');
  if (current && !ids.includes(current)) errors.push(`current.json: names ${current}, which does not exist`);
  const referenced = new Set(), checked = new Map();
  for (const id of ids) {
    let manifest;
    try { manifest = await readManifest(dir, id); } catch (error) { errors.push(error.message); continue; }
    if (manifest.previous && !ids.includes(manifest.previous)) errors.push(`Snapshot ${id}: previous snapshot ${manifest.previous} does not exist`);
    const problem = acceptsSchema(manifest);
    if (problem && id === current) errors.push(`Snapshot ${id} is current but ${problem}`);
    else if (problem) onWarning(`Snapshot ${id} ${problem}; this app cannot build it.`);
    for (const [key, file] of Object.entries(manifest.files)) {
      referenced.add(file.path);
      if (!checked.has(file.path)) {
        let bytes;
        try { bytes = await fs.readFile(path.join(dir, file.path)); } catch { checked.set(file.path, [`${file.path}: missing`]); }
        if (bytes) {
          const fileErrors = [];
          if (await sha256Hex(bytes) !== file.sha256) fileErrors.push(`${file.path}: does not match its hash`);
          const layer = DATA_LAYERS.find(entry => entry.key === key);
          // Content rules exist only for the schema this app reads.
          if (layer && !problem) fileErrors.push(...checkLayerText(layer, bytes.toString('utf8'), `${key} ${file.sha256.slice(0, 12)}`));
          checked.set(file.path, fileErrors);
        }
      }
      for (const error of checked.get(file.path)) errors.push(`Snapshot ${id}: ${error}`);
    }
    if (!problem) for (const key of Object.keys(manifest.files)) {
      if (!DATA_LAYERS.some(layer => layer.key === key)) errors.push(`Snapshot ${id}: unknown layer ${key}`);
    }
  }
  for (const layer of await fs.readdir(path.join(dir, 'store')).catch(() => [])) {
    for (const name of await fs.readdir(path.join(dir, 'store', layer)).catch(() => [])) {
      if (!referenced.has(`store/${layer}/${name}`)) errors.push(`store/${layer}/${name}: not part of any snapshot`);
    }
  }
  return [...new Set(errors)];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = await checkData(DATA_DIR, { onWarning: message => console.warn(message) });
  for (const error of errors.slice(0, 50)) console.error(error);
  if (errors.length) { console.error(`${errors.length} problem(s).`); process.exit(1); }
  console.log('Data check passed.');
}
