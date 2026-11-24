import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkData } from '../scripts/check-data.mjs';
import { DATA_LAYERS } from '../src/data-layers.js';
import { DATA_DIR, currentId, readSnapshot, writeSnapshot, listSnapshots, setCurrent } from '../scripts/snapshots.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const current = await readSnapshot(DATA_DIR, await currentId());
const read = async file => JSON.parse(current.texts[DATA_LAYERS.find(layer => layer.file === file).key]);
// A scratch data folder holding a copy of the current snapshot.
async function scratch() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pedway-data-'));
  await writeSnapshot(dir, current.texts, { id: current.manifest.id });
  return dir;
}

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

test('the data check catches broken files and snapshots', async () => {
  const dir = await scratch();
  try {
    const cta = JSON.parse(current.texts.cta);
    cta.features[0].geometry.coordinates = [-74.0, 40.7];
    cta.features[1].properties.extra = 'x';
    cta.features[2].id = cta.features[3].id;
    delete cta.features[4].properties.name;
    const second = await writeSnapshot(dir, { ...current.texts, cta: JSON.stringify(cta) }, { id: '2026-12-03' });
    // The builder never writes broken JSON, so plant a file with a matching hash by hand.
    const { sha256Hex, storePath } = await import('../src/data-snapshot.js');
    const broken = Buffer.from('{not json'), sha = await sha256Hex(broken);
    await fs.writeFile(path.join(dir, storePath('metra', sha)), broken);
    second.files.metra = { path: storePath('metra', sha), sha256: sha, bytes: broken.length, features: 0 };
    // Tamper with a store file, drop another, leave a stray one, and point a manifest at a missing previous.
    await fs.appendFile(path.join(dir, second.files.pedway.path), ' ');
    await fs.rm(path.join(dir, second.files.access.path));
    await fs.writeFile(path.join(dir, 'store/cta/stray.geojson'), '{}');
    await fs.writeFile(path.join(dir, 'snapshots/2026-12-03.json'), JSON.stringify({ ...second, previous: '2026-01-01' }));
    const errors = (await checkData(dir)).join('\n');
    for (const pattern of [/outside Chicago/, /unexpected property extra/, /duplicate id/, /name is required/, /metra [0-9a-f]{12}: not JSON/,
      /pedway\/[0-9a-f]+\.geojson: does not match its hash/, /access\/[0-9a-f]+\.geojson: missing/, /stray\.geojson: not part of any snapshot/,
      /previous snapshot 2026-01-01 does not exist/])
      assert.match(errors, pattern);
    await fs.writeFile(path.join(dir, 'current.json'), JSON.stringify({ format: 'pedway-data-current', version: 1, snapshot: '2030-01-01' }));
    assert.match((await checkData(dir)).join('\n'), /current\.json: names 2030-01-01, which does not exist/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('snapshots share unchanged files, skip unchanged data and are never rewritten', async () => {
  const dir = await scratch();
  try {
    assert.equal(await writeSnapshot(dir, current.texts), null, 'identical data makes no snapshot');
    const poi = JSON.parse(current.texts.poi);
    poi.features.pop();
    const next = await writeSnapshot(dir, { ...current.texts, poi: JSON.stringify(poi) }, { built: new Date('2026-12-03T09:00:00Z'), osmBase: '2026-12-03T08:00:00Z' });
    assert.equal(next.id, '2026-12-03');
    assert.equal(next.previous, current.manifest.id);
    assert.equal(next.files.poi.features, poi.features.length);
    assert.equal(next.files.cta.path, current.manifest.files.cta.path, 'unchanged files are shared');
    assert.notEqual(next.files.poi.path, current.manifest.files.poi.path);
    assert.equal(await currentId(dir), '2026-12-03');
    assert.equal((await fs.readdir(path.join(dir, 'store/cta'))).length, 1);
    // A second build on the same day gets its own id.
    poi.features.pop();
    const again = await writeSnapshot(dir, { ...current.texts, poi: JSON.stringify(poi) }, { built: new Date('2026-12-03T10:00:00Z') });
    assert.equal(again.id, '2026-12-03-2');
    await assert.rejects(writeSnapshot(dir, current.texts, { id: '2026-12-03' }), /never rewritten/);
    await assert.rejects(writeSnapshot(dir, { pedway: current.texts.pedway }), /missing access/);
    assert.deepEqual(await listSnapshots(dir), [current.manifest.id, '2026-12-03', '2026-12-03-2']);
    // Moving the pointer back is a rollback.
    await setCurrent(dir, current.manifest.id);
    assert.equal(await currentId(dir), current.manifest.id);
    await assert.rejects(setCurrent(dir, '2031-01-01'), /no data snapshot 2031-01-01/);
    assert.deepEqual(await checkData(dir), []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('manifests cannot point outside the store, and old schemas are reported, not loaded', async () => {
  const { validateManifest, acceptsSchema } = await import('../src/data-snapshot.js');
  const manifest = current.manifest;
  assert.equal(validateManifest(structuredClone(manifest)).id, manifest.id);
  const evil = structuredClone(manifest);
  evil.files.pedway.path = '../../index.html';
  assert.throws(() => validateManifest(evil), /path must be store\/pedway\//);
  assert.throws(() => validateManifest(manifest, '2020-01-01'), /says it is/);
  assert.equal(acceptsSchema(manifest), null);
  assert.match(acceptsSchema({ ...manifest, schema: 99 }), /uses data schema 99; this app reads 1/);
  const partial = structuredClone(manifest);
  delete partial.files.poi;
  assert.match(acceptsSchema(partial), /has no poi data/);

  const dir = await scratch();
  try {
    const old = { ...structuredClone(manifest), id: '2025-01-01', schema: 99 };
    delete old.previous;
    await fs.writeFile(path.join(dir, 'snapshots/2025-01-01.json'), JSON.stringify(old));
    const warnings = [];
    assert.deepEqual(await checkData(dir, { onWarning: message => warnings.push(message) }), []);
    assert.match(warnings.join('\n'), /2025-01-01 uses data schema 99/);
    await setCurrent(dir, '2025-01-01');
    assert.match((await checkData(dir)).join('\n'), /2025-01-01 is current but uses data schema 99/);
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
