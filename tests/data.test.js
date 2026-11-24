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
