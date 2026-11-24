import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeGeohash, decodeGeohash } from '../src/geo/geohash.js';
import { type, defaultMap, normalizeMap, pinAt, pinLocation, LAYERS, LIMITS } from '../src/doc.js';
import { examples } from '../src/examples.js';
import { createConfig, createUrlState } from '../vendor/fragment-kit-v0.5.0/src/index.js';

test('geohash matches published reference values', () => {
  assert.equal(encodeGeohash(57.64911, 10.40744, 11), 'u4pruydqqvj');
  assert.equal(encodeGeohash(42.6, -5.6, 5), 'ezs42');
  const { lat, lon, error } = decodeGeohash('u4pruydqqvj');
  assert.ok(Math.abs(lat - 57.64911) <= error.lat && Math.abs(lon - 10.40744) <= error.lon);
  assert.throws(() => decodeGeohash('dp3a'), /Invalid geohash/);
  assert.throws(() => encodeGeohash(91, 0), /out of range/);
});

test('a 9-character geohash keeps a pin within a few metres', () => {
  const pin = pinAt(41.88385, -87.62755, { id: 'a' });
  const [lat, lon] = pinLocation(pin);
  assert.ok(Math.abs(lat - 41.88385) < 0.00003 && Math.abs(lon - -87.62755) < 0.00003);
});

test('an empty document normalizes to the default map and counts as default', () => {
  const doc = type.normalize({ src: '' });
  assert.deepEqual(doc.map, defaultMap());
  assert.equal(type.isDefault(doc), true);
  assert.equal(type.isDefault(type.normalize({ src: 'Title only' })), true);
  assert.equal(type.isDefault(type.normalize({ src: '', map: { level: 'street' } })), false);
});

test('normalization fills pin and layer defaults and rounds the view', () => {
  const doc = type.normalize({ src: 'x', map: { view: { c: [41.883712345, -87.627812345], z: 17 }, layers: { food: true }, pins: [{ id: 'p1', at: 'dp3wnph5u' }] } });
  assert.deepEqual(doc.map.view, { c: [41.88371, -87.62781], z: 17 });
  assert.deepEqual(doc.map.layers, { ...LAYERS, food: true });
  assert.deepEqual(doc.map.pins[0], { id: 'p1', at: 'dp3wnph5u', label: '', icon: 'pin', color: '#c0392b', md: '' });
});

test('normalization rejects bad or hostile input', () => {
  const bad = [
    [{ src: 1 }, /Title must be text/],
    [{ src: '', extra: 1 }, /Unknown document field/],
    [{ src: '', map: { view: { c: [40.7, -74.0], z: 16 } } }, /outside the Chicago area/],
    [{ src: '', map: { view: { z: 25 } } }, /Zoom/],
    [{ src: '', map: { layers: { casinos: true } } }, /Unknown layer field/],
    [{ src: '', map: { layers: { food: 'yes' } } }, /true or false/],
    [{ src: '', map: { level: 'roof' } }, /Level/],
    [{ src: '', map: { pins: [{ id: 'a', at: 'u4pruydqq' }] } }, /outside the Chicago area/],
    [{ src: '', map: { pins: [{ id: '<b>', at: 'dp3wnph5u' }] } }, /Pin id/],
    [{ src: '', map: { pins: [{ id: 'a', at: 'dp3w' }] } }, /at least 5/],
    [{ src: '', map: { pins: [{ id: 'a', at: 'dp3wnph5u', icon: 'skull' }] } }, /unknown icon/],
    [{ src: '', map: { pins: [{ id: 'a', at: 'dp3wnph5u', color: 'red' }] } }, /#rrggbb/],
    [{ src: '', map: { pins: [{ id: 'a', at: 'dp3wnph5u', onclick: 'x' }] } }, /Unknown pin field/],
    [{ src: '', map: { pins: [{ id: 'a', at: 'dp3wnph5u' }, { id: 'a', at: 'dp3wnph5v' }] } }, /unique/],
    [{ src: '', map: { pins: [{ id: 'a', at: 'dp3wnph5u', md: 'x'.repeat(LIMITS.md + 1) }] } }, /longer than/],
    [{ src: '', map: { pins: Array.from({ length: LIMITS.pins + 1 }, (_, i) => ({ id: 'p' + i, at: 'dp3wnph5u' })) } }, /at most/],
  ];
  for (const [input, message] of bad) assert.throws(() => type.normalize(input), message, JSON.stringify(input).slice(0, 80));
});

test('normalizing twice changes nothing', () => {
  for (const example of examples) {
    const once = type.normalize(example.document);
    assert.deepEqual(type.normalize(once), once);
    assert.deepEqual(normalizeMap(once.map), once.map);
  }
});

test('links round-trip through Fragment Kit URL state', () => {
  const config = createConfig({ slug: 'pedway', name: 'Pedway Tools', storagePrefix: 'pedway', canonicalOrigin: 'https://curtcox.github.io/pedway/',
    recoveryOrigin: 'https://curtcox.github.io/pedway/', repo: 'curtcox/pedway', docs: 'https://github.com/curtcox/pedway', gallery: 'examples.html', documentType: 'pedway-map' }, { document: null });
  const urlState = createUrlState({ config, type, location: null, history: null });
  for (const example of examples) {
    const doc = type.normalize(example.document);
    const { href } = urlState.build(doc);
    assert.match(href, /^https:\/\/curtcox\.github\.io\/pedway\/#v1\./);
    const intent = urlState.parse(href);
    assert.equal(intent.kind, 'source');
    assert.deepEqual(intent.doc, doc);
  }
  assert.throws(() => urlState.parse('https://curtcox.github.io/pedway/#v1.invalid!'));
  assert.equal(urlState.parse('https://curtcox.github.io/pedway/?example=stations').kind, 'example');
});

test('example ids are unique and every example is valid', () => {
  assert.equal(new Set(examples.map(example => example.id)).size, examples.length);
  for (const example of examples) assert.doesNotThrow(() => type.normalize(example.document));
});

test('the document’s layers are exactly the map’s layers, with the same defaults', async () => {
  const { LAYER_DEFAULTS } = await import('../src/map-layers.js');
  assert.deepEqual(LAYERS, LAYER_DEFAULTS);
});

test('an unknown field says the map may come from a newer version', () => {
  assert.throws(() => type.normalize({ src: '', map: { overlays: {} } }), /Unknown map field: overlays\. If this map was made with a newer version/);
});
