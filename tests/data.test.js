import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkData } from '../scripts/check-data.mjs';
import { DATA_LAYERS } from '../src/data-layers.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = async file => JSON.parse(await fs.readFile(path.join(root, 'data', file), 'utf8'));

test('the committed data passes the data check', async () => {
  assert.deepEqual(await checkData(), []);
});

test('the Pedway data covers the Loop and links to its main stations', async () => {
  const pedway = await read('pedway.geojson');
  const km = pedway.features.reduce((sum, f) => sum + f.geometry.coordinates.slice(1).reduce((s, [lon, lat], i) => {
    const [lon0, lat0] = f.geometry.coordinates[i];
    return s + Math.hypot((lat - lat0) * 111, (lon - lon0) * 82.8);
  }, 0), 0);
  // The City describes the Pedway as about five miles; OSM maps every branch and stair.
  assert.ok(km > 7 && km < 20, `Pedway is ${km.toFixed(1)} km`);
  const cta = await read('cta.geojson'), metra = await read('metra.geojson');
  const connected = list => list.features.filter(f => f.properties.pedway).map(f => f.properties.name);
  for (const name of ['Clark/Lake', 'Lake', 'Washington']) assert.ok(connected(cta).includes(name), name);
  assert.ok(connected(metra).includes('Millennium Station'));
  const clarkLake = cta.features.find(f => f.properties.name === 'Clark/Lake');
  assert.deepEqual(clarkLake.properties.lines, ['Blue', 'Brown', 'Green', 'Orange', 'Pink', 'Purple']);
});

test('the data check catches broken files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pedway-data-'));
  try {
    for (const layer of DATA_LAYERS) await fs.copyFile(path.join(root, 'data', layer.file), path.join(dir, layer.file));
    const cta = JSON.parse(await fs.readFile(path.join(dir, 'cta.geojson'), 'utf8'));
    cta.features[0].geometry.coordinates = [-74.0, 40.7];
    cta.features[1].properties.extra = 'x';
    cta.features[2].id = cta.features[3].id;
    delete cta.features[4].properties.name;
    await fs.writeFile(path.join(dir, 'cta.geojson'), JSON.stringify(cta));
    await fs.writeFile(path.join(dir, 'metra.geojson'), '{not json');
    await fs.rm(path.join(dir, 'access.geojson'));
    const errors = (await checkData(dir)).join('\n');
    for (const pattern of [/outside Chicago/, /unexpected property extra/, /duplicate id/, /name is required/, /metra.geojson: not JSON/, /access.geojson: missing/])
      assert.match(errors, pattern);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('places sort into categories, skip private toilets and unnamed shops, and stay near the Pedway', async () => {
  const { poiCategory, buildPoi } = await import('../scripts/build-data.mjs');
  assert.deepEqual(poiCategory({ amenity: 'cafe' }), ['food', 'cafe']);
  assert.deepEqual(poiCategory({ shop: 'chemist' }), ['store', 'pharmacy']);
  assert.deepEqual(poiCategory({ place: 'square' }), ['park', 'plaza']);
  assert.equal(poiCategory({ amenity: 'toilets', access: 'private' }), null);
  assert.equal(poiCategory({ shop: 'shoes' }), null);
  const vertices = [[41.8837, -87.6278]];
  const poi = buildPoi([
    { type: 'node', id: 1, lat: 41.8838, lon: -87.6278, tags: { amenity: 'cafe', name: 'Below', level: '-1' } },
    { type: 'node', id: 2, lat: 41.8860, lon: -87.6278, tags: { amenity: 'cafe', name: 'Up the street' } },
    { type: 'node', id: 3, lat: 41.8900, lon: -87.6278, tags: { amenity: 'cafe', name: 'Too far' } },
    { type: 'node', id: 4, lat: 41.8840, lon: -87.6279, tags: { amenity: 'toilets' } },
    { type: 'node', id: 5, lat: 41.8840, lon: -87.6279, tags: { shop: 'convenience' } },
    { type: 'way', id: 6, center: { lat: 41.8826, lon: -87.6280 }, tags: { leisure: 'park', name: 'Plaza Park' } },
  ], vertices);
  assert.deepEqual(poi.features.map(f => f.id), ['n1', 'n2', 'w6', 'n4']);
  assert.equal(poi.features[0].properties.pedway, true);
  assert.equal(poi.features[1].properties.pedway, undefined);
  assert.equal(poi.features[3].properties.category, 'restroom');
});

test('the data diff lists added, removed and changed features for the refresh pull request', async () => {
  const { diffFeatures, summarize } = await import('../scripts/data-diff.mjs');
  const fc = features => JSON.stringify({ type: 'FeatureCollection', features });
  const a = { type: 'Feature', id: 'n1', properties: { name: 'Clark/Lake' } };
  const b = { type: 'Feature', id: 'n2', properties: { name: 'Lake' } };
  const c = { type: 'Feature', id: 'n3', properties: { kind: 'entrance' } };
  const diff = diffFeatures(fc([a, b]), fc([{ ...a, properties: { name: 'Clark / Lake' } }, c]));
  assert.deepEqual([diff.before, diff.after, diff.added.length, diff.removed.length, diff.changed.length], [2, 2, 1, 1, 1]);
  const markdown = summarize([{ file: 'cta.geojson', diff }, { file: 'metra.geojson', diff: diffFeatures(fc([a]), fc([a])) }]);
  assert.match(markdown, /\| cta\.geojson \| 2 \| 2 \| 1 \| 1 \| 1 \|/);
  assert.match(markdown, /Added: entrance \(n3\)/);
  assert.match(markdown, /Removed: Lake \(n2\)/);
  assert.match(markdown, /Changed: Clark \/ Lake \(n1\)/);
  assert.doesNotMatch(markdown, /### metra/);
});

test('line chips and place colours keep text and markers readable', async () => {
  const { CTA_COLORS, textOn } = await import('../src/layers.js');
  const { POI_CATEGORIES } = await import('../src/data-layers.js');
  const luminance = hex => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  // WCAG 1.4.3: chip text is small, so it needs 4.5:1.
  for (const [line, color] of Object.entries({ ...CTA_COLORS, Metra: '#005596' })) assert.ok(contrast(color, textOn(color)) >= 4.5, line);
  // WCAG 1.4.11: place markers sit on light map tiles and need 3:1 against white.
  for (const { key, color } of POI_CATEGORIES) assert.ok(contrast(color, '#ffffff') >= 3, key);
});
