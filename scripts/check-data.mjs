// Validates data/*.geojson: shape, properties, Chicago bounds and size limits.
//   node scripts/check-data.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHICAGO_BOUNDS } from '../src/map-defaults.js';
import { DATA_LAYERS } from '../src/data-layers.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const [[S, W], [N, E]] = CHICAGO_BOUNDS;
const MAX_BYTES = 300 * 1024;
const ID = /^[nwr]\d+$/;

function inBounds([lon, lat]) { return Number.isFinite(lat) && Number.isFinite(lon) && lat >= S && lat <= N && lon >= W && lon <= E; }

export async function checkData(dir = path.join(root, 'data')) {
  const errors = [];
  for (const layer of DATA_LAYERS) {
    const file = path.join(dir, layer.file), name = layer.file;
    let text;
    try { text = await fs.readFile(file, 'utf8'); } catch { errors.push(`${name}: missing`); continue; }
    if (Buffer.byteLength(text) > MAX_BYTES) errors.push(`${name}: larger than ${MAX_BYTES / 1024} KB`);
    let data;
    try { data = JSON.parse(text); } catch (error) { errors.push(`${name}: not JSON (${error.message})`); continue; }
    if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) { errors.push(`${name}: not a FeatureCollection`); continue; }
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
  }
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = await checkData();
  for (const error of errors.slice(0, 50)) console.error(error);
  if (errors.length) { console.error(`${errors.length} problem(s).`); process.exit(1); }
  console.log('Data check passed.');
}
