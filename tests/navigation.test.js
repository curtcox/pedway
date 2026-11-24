import test from 'node:test';
import assert from 'node:assert/strict';
import { externalUrls } from '../src/external.js';
import { geocode, nominatimUrl, clearGeocodeCache } from '../src/geo/geocode.js';
import { nearest } from '../src/gps.js';
import { matchNames } from '../src/search.js';

test('external app links carry the point and the right travel modes', () => {
  const urls = Object.fromEntries(externalUrls(41.8857, -87.6308, 'Clark/Lake').map(u => [u.id, new URL(u.href)]));
  assert.equal(urls.google.origin + urls.google.pathname, 'https://www.google.com/maps/search/');
  assert.equal(urls.google.searchParams.get('api'), '1');
  assert.equal(urls.google.searchParams.get('query'), '41.885700,-87.630800');
  assert.equal(urls.walk.searchParams.get('destination'), '41.885700,-87.630800');
  assert.equal(urls.walk.searchParams.get('travelmode'), 'walking');
  assert.equal(urls.transit.searchParams.get('travelmode'), 'transit');
  assert.equal(urls.apple.searchParams.get('ll'), '41.885700,-87.630800');
  assert.equal(urls.apple.searchParams.get('q'), 'Clark/Lake');
  assert.equal(urls.osm.searchParams.get('mlat'), '41.885700');
  assert.match(urls.osm.hash, /^#map=18\/41\.885700\/-87\.630800$/);
  for (const url of Object.values(urls)) assert.equal(url.protocol, 'https:');
});

test('name matching ranks exact, then prefix, then word, then substring', () => {
  const places = ['Washington/Wells', 'Washington', 'Harold Washington Library', 'Lake', 'Clark/Lake', 'Lakeshore East'].map(name => ({ name }));
  assert.deepEqual(matchNames(places, 'washington').map(p => p.name), ['Washington', 'Washington/Wells', 'Harold Washington Library']);
  assert.deepEqual(matchNames(places, 'lake').map(p => p.name), ['Lake', 'Lakeshore East', 'Clark/Lake']);
  assert.deepEqual(matchNames(places, 'clark lake').map(p => p.name), ['Clark/Lake']);
  assert.deepEqual(matchNames(places, 'x'), []);
});

test('nearest finds the closest point feature and its distance', () => {
  const at = (lat, lon, name) => ({ properties: { name }, geometry: { type: 'Point', coordinates: [lon, lat] } });
  const found = nearest([at(41.8857, -87.6308, 'a'), at(41.8837, -87.6278, 'b')], 41.8838, -87.6279);
  assert.equal(found.feature.properties.name, 'b');
  assert.ok(found.distance > 5 && found.distance < 20);
  assert.equal(nearest([], 41.88, -87.63), null);
});

test('Nominatim requests are bounded to Chicago, spaced a second apart and cached', async () => {
  clearGeocodeCache();
  const url = new URL(nominatimUrl('233 S Wacker'));
  assert.equal(url.origin, 'https://nominatim.openstreetmap.org');
  assert.equal(url.searchParams.get('bounded'), '1');
  assert.equal(url.searchParams.get('viewbox'), '-88,42.1,-87.45,41.6');

  let clock = 1000;
  const calls = [], waits = [];
  const fetchImpl = async href => { calls.push([href, clock]); return { ok: true, json: async () => [{ display_name: 'Willis Tower, 233, South Wacker Drive, Loop, Chicago, Cook County, Illinois, 60606, United States', lat: '41.8789', lon: '-87.6359' }] }; };
  const options = { fetchImpl, now: () => clock, wait: async ms => { waits.push(ms); clock += ms; } };
  const first = await geocode('233 S Wacker', options);
  assert.deepEqual(first, [{ name: 'Willis Tower, 233, South Wacker Drive, Loop, Chicago', lat: 41.8789, lon: -87.6359 }]);
  assert.deepEqual(await geocode('  233 s wacker ', options), first);
  assert.equal(calls.length, 1, 'the same query is answered from the cache');
  await geocode('Willis Tower', options);
  assert.equal(calls.length, 2);
  assert.ok(calls[1][1] - calls[0][1] >= 1100, 'requests are at least 1.1 s apart');

  const failing = { ...options, fetchImpl: async () => ({ ok: false, status: 503 }) };
  await assert.rejects(geocode('nowhere', failing), /503/);
  // Failures are not cached, so trying again asks again.
  await assert.rejects(geocode('nowhere', failing), /503/);
});
