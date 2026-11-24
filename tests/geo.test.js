import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLatLon, formatDecimal, formatDms, formatHemisphere } from '../src/geo/latlon.js';
import { toUtm, fromUtm, formatUtm, parseUtm, formatUsng, parseUsng } from '../src/geo/usng.js';
import { gridToLatLon, latLonToGrid, parseGridLocation, describeGrid, findStreet } from '../src/geo/chicago-grid.js';
import { parseLocation, formatLocation, FORMATS } from '../src/geo/formats.js';

// Ground distance in metres between two points (equirectangular is fine at city scale).
function metres(a, b) {
  const rad = Math.PI / 180, x = (b.lon - a.lon) * rad * Math.cos((a.lat + b.lat) / 2 * rad), y = (b.lat - a.lat) * rad;
  return Math.hypot(x, y) * 6371000;
}
const near = (actual, expected, tolerance, what = '') =>
  assert.ok(metres(actual, expected) <= tolerance, `${what} is ${metres(actual, expected).toFixed(1)} m away (allowed ${tolerance} m)`);

test('decimal, hemisphere and degree-minute-second spellings all parse', () => {
  const expected = { lat: 41.883722, lon: -87.627806 };
  for (const text of [
    '41.883722, -87.627806', '41.883722 -87.627806', '41.883722;-87.627806', '+41.883722,-87.627806',
    '41.883722N 87.627806W', '41.883722° N, 87.627806° W', 'N41.883722 W87.627806', 'N 41.883722 W 87.627806',
    '41°53′01.4″N 87°37′40.1″W', '41°53\'01.4"N 087°37\'40.1"W', '41 53 1.4 N 87 37 40.1 W', '41d53m1.4sN 87d37m40.1sW',
    '41°53.0233′N 87°37.6684′W', '41 53.0233 N, 87 37.6684 W', '87.627806W 41.883722N',
  ]) near(parseLatLon(text), expected, 3, text);
});

test('coordinates are read from map links and geo: URIs', () => {
  const expected = { lat: 41.8837, lon: -87.6278 };
  for (const text of [
    'geo:41.8837,-87.6278', 'geo:41.8837,-87.6278?z=17',
    'https://www.google.com/maps/@41.8837,-87.6278,17z',
    'https://www.google.com/maps/search/?api=1&query=41.8837%2C-87.6278',
    'https://maps.apple.com/?ll=41.8837,-87.6278',
    'https://www.openstreetmap.org/?mlat=41.8837&mlon=-87.6278#map=17/41.88/-87.62',
    'https://www.openstreetmap.org/#map=17/41.8837/-87.6278',
  ]) near(parseLatLon(text), expected, 1, text);
});

test('latitude/longitude parsing rejects non-coordinates and out-of-range values', () => {
  for (const text of ['', 'State St', 'dp3wmbxqk', '41.88', '123 N State St', '41°75′N 87°W']) assert.equal(parseLatLon(text), null, text);
  assert.throws(() => parseLatLon('91, 95'), /Latitude/);
  assert.throws(() => parseLatLon('41, 181'), /Longitude/);
  assert.equal(parseLatLon('41.8N 87.6N'), null);
});

test('latitude/longitude formatters round-trip', () => {
  for (const [lat, lon] of [[41.88372, -87.62781], [-33.8568, 151.2153], [0.00001, -0.00001]]) {
    near(parseLatLon(formatDecimal(lat, lon)), { lat, lon }, 0.2);
    near(parseLatLon(formatDms(lat, lon)), { lat, lon }, 3.5);
    near(parseLatLon(formatHemisphere(lat, lon)), { lat, lon }, 1);
  }
  assert.equal(formatDms(41.883722, -87.627806), '41°53′01.4″N 087°37′40.1″W');
  assert.equal(formatDecimal(-0.0000001, 0), '0.000000, 0.000000');
});

// Reference values computed with PROJ 9.9 (cs2cs EPSG:4326 → EPSG:326zz / 327zz).
const UTM_REFERENCES = [
  { lat: 41.88206, lon: -87.62785, zone: 16, easting: 447906.936, northing: 4636872.166 },
  { lat: 42.0195, lon: -87.6902, zone: 16, easting: 442856.586, northing: 4652171.687 },
  { lat: 51.5007, lon: -0.1246, zone: 30, easting: 699567.540, northing: 5709427.563 },
  { lat: -33.8568, lon: 151.2153, zone: 56, easting: 334900.570, northing: 6252288.753 },
];

test('UTM matches PROJ to the millimetre in both directions', () => {
  for (const ref of UTM_REFERENCES) {
    const utm = toUtm(ref.lat, ref.lon);
    assert.equal(utm.zone, ref.zone);
    assert.ok(Math.abs(utm.easting - ref.easting) < 0.002, `easting ${utm.easting}`);
    assert.ok(Math.abs(utm.northing - ref.northing) < 0.002, `northing ${utm.northing}`);
    near(fromUtm(ref.zone, ref.lat < 0 ? 'S' : 'N', ref.easting, ref.northing), ref, 0.002);
  }
});

test('UTM text formats and parses', () => {
  assert.equal(formatUtm(41.88206, -87.62785), '16T 447906mE 4636872mN');
  for (const text of ['16T 447906.936 4636872.166', '16T 447906.936mE 4636872.166mN', '16t 447906.936, 4636872.166', '16N 447906.936 4636872.166'])
    near(parseUtm(text), { lat: 41.88206, lon: -87.62785 }, 0.01, text);
  near(parseUtm('56H 334900.570 6252288.753'), { lat: -33.8568, lon: 151.2153 }, 0.01);
  assert.equal(parseUtm('16T 447906'), null);
  assert.throws(() => parseUtm('61T 447906 4636872'), /zone/);
});

test('USNG matches the expected grid squares and round-trips at every precision', () => {
  assert.equal(formatUsng(41.88206, -87.62785), '16T DM 47906 36872');
  assert.equal(formatUsng(41.88206, -87.62785, 3), '16T DM 479 368');
  assert.equal(formatUsng(51.5007, -0.1246), '30U XC 99567 09427');
  assert.equal(formatUsng(-33.8568, 151.2153), '56H LH 34900 52288');
  for (const ref of UTM_REFERENCES) {
    for (let digits = 1; digits <= 5; digits++) {
      const text = formatUsng(ref.lat, ref.lon, digits);
      // The parsed point is the centre of the square, so allow half its diagonal.
      near(parseUsng(text), ref, 10 ** (5 - digits) * 0.71 + 0.01, text);
    }
  }
  near(parseUsng('16TDM4790636872'), { lat: 41.88206, lon: -87.62785 }, 1);
  near(parseUsng('16t dm 47906 36872'), { lat: 41.88206, lon: -87.62785 }, 1);
  near(parseUsng('16T DM'), { lat: 41.88206, lon: -87.62785 }, 71000); // a bare 100 km square
  assert.equal(parseUsng('nope'), null);
  assert.throws(() => parseUsng('16T DM 4790 368'), /same number/);
  assert.throws(() => parseUsng('16T SM 47906 36872'), /not used/);
});

// Street crossings from OpenStreetMap that the grid model was not fitted to.
const CROSSINGS = [
  ['Clark St & Lake St', 41.885747, -87.630986, 25],
  ['Wells & Lake', 41.885735, -87.633948, 25],
  ['Michigan Ave & Lake St', 41.88577, -87.624527, 25],
  ['Canal and Lake', 41.885734, -87.639866, 25],
  ['Halsted & Chicago', 41.896404, -87.647748, 25],
  ['Halsted / Belmont', 41.939973, -87.649275, 50],
  ['Halsted St at Addison St', 41.947315, -87.649493, 50],
  ['Western & Addison', 41.946744, -87.688245, 50],
  ['Western Ave & Chicago Ave', 41.89575, -87.686835, 50],
  ['Columbus Dr & Roosevelt Rd', 41.867498, -87.620414, 50],
  ['63rd & Halsted', 41.779773, -87.644793, 50],
  ['Western & 63rd', 41.779229, -87.683662, 50],
  ['Western & 95th', 41.720938, -87.682089, 50],
  ['Halsted & 119th', 41.677814, -87.641903, 50],
  ['Pulaski & Lake', 41.885483, -87.725796, 150],
];

test('the address grid places intersections close to where OpenStreetMap has them', () => {
  for (const [text, lat, lon, tolerance] of CROSSINGS) {
    const found = parseGridLocation(text);
    assert.ok(found, text);
    near(found, { lat, lon }, tolerance, text);
  }
});

test('the grid origin is State & Madison and the model inverts itself', () => {
  near(gridToLatLon(0, 0), { lat: 41.882045, lon: -87.627809 }, 1);
  for (const [ns, ew] of [[0, 0], [150, -100], [-1200, 300], [7600, -2400], [-11900, -800], [3600, -6000]]) {
    const { lat, lon } = gridToLatLon(ns, ew), back = latLonToGrid(lat, lon);
    assert.ok(Math.abs(back.ns - ns) < 0.5 && Math.abs(back.ew - ew) < 0.5, `${ns}, ${ew} → ${back.ns}, ${back.ew}`);
  }
});

test('street addresses parse, including directions, suffixes and a trailing city', () => {
  const cases = [
    ['123 N State St', '123 N State St', [123, 0]],
    ['233 S. Wacker Drive', '233 S Wacker Dr', [-233, -360]],
    ['600 W Madison', '600 W Madison St', [0, -600]],
    ['1060 West Addison Street, Chicago, IL 60613', '1060 W Addison St', [3600, -1060]],
    ['1060 W Addison St Chicago IL', '1060 W Addison St', [3600, -1060]],
    ['5700 S Lake Shore', null],
    ['100 N Nowhere St', null],
  ];
  for (const [text, label, grid] of cases) {
    const found = parseGridLocation(text);
    if (!label) { assert.equal(found, null, text); continue; }
    assert.equal(found.label, label);
    near(found, gridToLatLon(...grid), 0.01, text);
  }
  near(parseGridLocation('1200 S, 800 W'), gridToLatLon(-1200, -800), 0.01);
  assert.equal(parseGridLocation('41 N 87 W'), null);
  assert.deepEqual(findStreet('N. LaSalle St.').map(s => s.at), [-140]);
  assert.deepEqual(findStreet('Wacker').map(s => s.runs).sort(), ['ew', 'ns']);
  assert.equal(findStreet('Irving Park Road')[0].at, 4000);
  assert.equal(findStreet('47th')[0].at, -4700);
});

test('the grid describes points as corners, addresses or grid numbers', () => {
  assert.equal(describeGrid(41.885747, -87.630986).label, 'Clark St & Lake St');
  const onState = gridToLatLon(350, 0);
  assert.equal(describeGrid(onState.lat, onState.lon).label, '350 N State St');
  const onRandolph = gridToLatLon(150, -250);
  assert.equal(describeGrid(onRandolph.lat, onRandolph.lon).label, '250 W Randolph St');
  const offStreet = gridToLatLon(9900, -9900);
  assert.equal(describeGrid(offStreet.lat, offStreet.lon).label, '9900 N, 9900 W');
});

test('every format round-trips through parseLocation within its precision', () => {
  const points = [[41.88372, -87.62781], [41.8786, -87.6359], [41.9484, -87.6553], [41.7943, -87.5907]];
  const tolerance = { decimal: 0.2, dms: 3.5, geohash: 5, usng: 1.5, utm: 1.5, grid: 120 };
  for (const [lat, lon] of points) for (const { id } of FORMATS) {
    const text = formatLocation(lat, lon, id), found = parseLocation(text);
    assert.equal(found.format, id === 'dms' ? 'decimal' : id, `${id}: ${text}`);
    near(found, { lat, lon }, tolerance[id], `${id}: ${text}`);
  }
});

test('parseLocation picks the reading inside Chicago and explains failures', () => {
  assert.equal(parseLocation('Clark & Lake').label, 'Clark St & Lake St');
  near(parseLocation('-87.6278, 41.8837'), { lat: 41.8837, lon: -87.6278 }, 1);
  assert.equal(parseLocation('dp3wmbxqk').format, 'geohash');
  assert.equal(parseLocation('41 N 87 W').format, 'decimal');
  assert.throws(() => parseLocation('ezs42'), /Could not read/); // a geohash in Spain needs the geohash: prefix
  near(parseLocation('geohash:ezs42'), { lat: 42.605, lon: -5.603 }, 3000);
  assert.throws(() => parseLocation(''), /Enter a location/);
  assert.throws(() => parseLocation('banana'), /Clark & Lake/);
  assert.throws(() => parseLocation('16T DM 4790 368'), /same number/);
  assert.equal(formatLocation(40.7128, -74.006, 'grid'), 'Outside Chicago');
  assert.throws(() => formatLocation(41.88, -87.62, 'nope'), /Unknown/);
});
