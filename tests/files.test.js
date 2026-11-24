import test from 'node:test';
import assert from 'node:assert/strict';
import { type, pinAt, LIMITS } from '../src/doc.js';
import { toGeoJSON, fromGeoJSON, geoJSONMap, mergePins, readMapFile, fileStem, skippedNote } from '../src/files.js';
import { config } from '../src/config.js';
import { createUrlState, openLibrary, memoryBackend } from '../vendor/fragment-kit-v0.5.0/src/index.js';

const urlState = createUrlState({ config, type });
const sample = type.normalize({ src: 'Lunch route', map: {
  view: { c: [41.8853, -87.6301], z: 17 }, level: 'pedway', gps: true,
  layers: { cta: false, food: true },
  pins: [
    pinAt(41.88385, -87.62755, { id: 'p1', label: 'Meet here', icon: 'star', color: '#1e88e5', md: 'By the **escalator**.' }),
    pinAt(41.8826, -87.6403, { id: 'ogilvie', label: 'Ogilvie' }),
  ] } });

test('GeoJSON export reopens as the same map', () => {
  const geojson = JSON.parse(JSON.stringify(toGeoJSON(sample)));
  assert.equal(geojson.type, 'FeatureCollection');
  const [lon, lat] = geojson.features[0].geometry.coordinates;
  assert.ok(Math.abs(lon - -87.62755) < 3e-5 && Math.abs(lat - 41.88385) < 3e-5);
  assert.equal(geojson.features[0].properties.name, 'Meet here');
  assert.equal(geojson.features[0].properties['marker-color'], '#1e88e5');
  const read = fromGeoJSON(geojson);
  assert.deepEqual(read.pins, sample.map.pins);
  assert.deepEqual(geoJSONMap(read, {}), sample);
});

test('GeoJSON from other tools becomes pins, leaving out what cannot be a pin', () => {
  const read = fromGeoJSON({ type: 'FeatureCollection', name: 'Coffee', features: [
    { type: 'Feature', id: 7, geometry: { type: 'Point', coordinates: [-87.6278, 41.8837] }, properties: { title: 'Café', description: 'Open early', 'marker-color': '#0a0' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-87.63, 41.88, 180] }, properties: null },
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[-87.63, 41.88], [-87.62, 41.88]] }, properties: {} },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-73.98, 40.75] }, properties: { name: 'New York' } },
    { type: 'Feature', geometry: null, properties: {} },
  ] });
  assert.equal(read.title, 'Coffee');
  assert.equal(read.meta, null);
  assert.deepEqual(read.pins.map(pin => [pin.id, pin.label, pin.md, pin.color, pin.icon]),
    [['7', 'Café', 'Open early', '#00aa00', 'pin'], ['p1', '', '', '#c0392b', 'pin']]);
  assert.deepEqual(read.skipped, { notPoint: 2, outside: 1, tooMany: 0 });
  assert.equal(skippedNote(read.skipped), 'Left out 2 features that are not points, 1 outside the Chicago area.');
  // Without saved view settings, the map centres on the pins.
  const doc = geoJSONMap(read, { level: 'street' });
  assert.equal(doc.map.level, 'street');
  assert.ok(Math.abs(doc.map.view.c[0] - 41.88185) < 0.001);
  assert.throws(() => fromGeoJSON({ type: 'Topology' }), /no features/);
});

test('a damaged pedway member still keeps the pins', () => {
  const geojson = toGeoJSON(sample);
  geojson.pedway.view = { c: [0, 0], z: 99 };
  const doc = geoJSONMap(fromGeoJSON(geojson), {});
  assert.equal(doc.map.pins.length, 2);
  assert.equal(doc.map.view.z, 16);
});

test('imports stop at the pin limit', () => {
  const features = Array.from({ length: LIMITS.pins + 5 }, () => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [-87.63, 41.88] }, properties: {} }));
  const read = fromGeoJSON({ type: 'FeatureCollection', features });
  assert.equal(read.pins.length, LIMITS.pins);
  assert.equal(read.skipped.tooMany, 5);
  assert.equal(new Set(read.pins.map(pin => pin.id)).size, LIMITS.pins);
});

test('adding pins to a map renames clashing ids and respects the limit', () => {
  const merged = mergePins(sample.map.pins, [pinAt(41.88, -87.63, { id: 'p1', label: 'Other' }), pinAt(41.88, -87.63, { id: 'p9' })]);
  assert.deepEqual(merged.pins.map(pin => pin.id), ['p1', 'ogilvie', 'p2', 'p9']);
  assert.equal(merged.pins[2].label, 'Other');
  assert.equal(merged.dropped, 0);
  const full = Array.from({ length: LIMITS.pins - 1 }, (_, i) => pinAt(41.88, -87.63, { id: 'x' + i }));
  assert.equal(mergePins(full, sample.map.pins).dropped, 1);
});

test('map files are recognised by what they contain', () => {
  const saved = urlState.documents.serialize(sample);
  assert.deepEqual(readMapFile(saved, urlState.documents), { kind: 'map', doc: sample });
  assert.equal(readMapFile(JSON.stringify(toGeoJSON(sample)), urlState.documents).kind, 'geojson');
  assert.deepEqual(readMapFile('{"format":"fragment-kit-library","version":1}', urlState.documents), { kind: 'library' });
  assert.throws(() => readMapFile('not json', urlState.documents), /not a Pedway map/);
  assert.throws(() => readMapFile('[1,2]', urlState.documents), /not a Pedway map/);
  assert.throws(() => readMapFile(JSON.stringify({ src: '', map: { evil: 1 } }), urlState.documents), /Unknown map field/);
  assert.throws(() => readMapFile(JSON.stringify({ src: 'x', format: 'hashbin-diagram', version: 1, type: 'other-app' }), urlState.documents), /not pedway-map/);
});

test('file names come from the title', () => {
  assert.equal(fileStem('Lunch route from Ogilvie!'), 'lunch-route-from-ogilvie');
  assert.equal(fileStem('Café ☕'), 'cafe');
  assert.equal(fileStem(''), 'pedway-map');
});

test('maps round-trip through the library', async () => {
  const library = await openLibrary({ config, type, backend: memoryBackend(), channel: null });
  const { entry } = await library.saveAs({ doc: sample, name: 'Lunch' });
  const loaded = await library.load(entry.head);
  assert.deepEqual(loaded.doc, sample);
  library.close?.();
});
