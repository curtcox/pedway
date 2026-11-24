import test from 'node:test';
import assert from 'node:assert/strict';
import { graticule, geohashGrid, geohashCellSize, usngGrid, MIN_SPACING, MAX_LABELS } from '../src/overlays/grids.js';
import { decodeGeohash } from '../src/geo/geohash.js';
import { toUtm } from '../src/geo/usng.js';

// A phone's view of the Loop at about zoom 16 (412 × 839 px), and a wider one at about zoom 12.
const LOOP = { bounds: { south: 41.8780, west: -87.6334, north: 41.8894, east: -87.6224 }, size: { x: 412, y: 839 } };
const CITY = { bounds: { south: 41.80, west: -87.75, north: 41.97, east: -87.57 }, size: { x: 1280, y: 900 } };
const close = (a, b, tolerance, message) => assert.ok(Math.abs(a - b) <= tolerance, `${message}: ${a} vs ${b}`);

test('the graticule picks a round step at least MIN_SPACING pixels apart and labels each line', () => {
  for (const { bounds, size } of [LOOP, CITY]) {
    const grid = graticule(bounds, size);
    const pixels = grid.step * size.x / (bounds.east - bounds.west);
    assert.ok(pixels >= MIN_SPACING, `step ${grid.step} is ${pixels} px apart`);
    for (const line of grid.lines) {
      const [[lat1, lon1], [lat2, lon2]] = line.points;
      const value = lat1 === lat2 ? lat1 : lon1;
      close(value / grid.step, Math.round(value / grid.step), 1e-9, 'lines fall on multiples of the step');
      assert.ok(lat1 === lat2 || lon1 === lon2, 'lines run north–south or east–west');
    }
    assert.equal(grid.labels.length, grid.lines.length);
  }
  const loop = graticule(LOOP.bounds, LOOP.size);
  assert.equal(loop.step, 0.002);
  assert.ok(loop.labels.some(label => label.text === '41.880°'));
  assert.ok(loop.labels.some(label => label.text === '-87.630°'));
});

test('the graticule can label in degrees, minutes and seconds', () => {
  const grid = graticule(LOOP.bounds, LOOP.size, { format: 'dms' });
  assert.ok(grid.step * 3600 >= 5, `step ${grid.step * 3600}″`);
  assert.ok(grid.labels.some(label => /^41°53′\d\d″N$/.test(label.text)), grid.labels.map(l => l.text).join(' '));
  assert.ok(grid.labels.some(label => /^87°37′\d\d″W$/.test(label.text)));
});

test('geohash cells match the cells geohash itself decodes, and their labels fit', () => {
  for (const { bounds, size } of [LOOP, CITY]) {
    const grid = geohashGrid(bounds, size);
    const cell = geohashCellSize(grid.step);
    assert.ok(grid.labels.length > 0 && grid.labels.length <= MAX_LABELS);
    for (const label of grid.labels) {
      assert.equal(label.text.length, grid.step);
      const { lat, lon, error } = decodeGeohash(label.text);
      close(lat, label.lat, 1e-9, 'label sits at its cell centre');
      close(lon, label.lon, 1e-9, 'label sits at its cell centre');
      close(error.lat * 2, cell.lat, 1e-12, 'cell height'); close(error.lon * 2, cell.lon, 1e-12, 'cell width');
    }
    const width = cell.lon * size.x / (bounds.east - bounds.west);
    assert.ok(width >= MIN_SPACING, `cells are ${width} px wide`);
  }
  assert.equal(geohashGrid(LOOP.bounds, LOOP.size).step, 6);
  assert.ok(geohashGrid(LOOP.bounds, LOOP.size).labels.some(label => label.text === 'dp3wnp'));
});

test('USNG lines are straight in UTM: every point on a line has its easting or northing', () => {
  for (const { bounds, size } of [LOOP, CITY]) {
    const grid = usngGrid(bounds, size);
    assert.equal(grid.zone, 16);
    for (const line of grid.lines) {
      const utm = line.points.map(([lat, lon]) => toUtm(lat, lon, 16));
      const sameE = utm.every(p => Math.abs(p.easting - utm[0].easting) < 0.01);
      const sameN = utm.every(p => Math.abs(p.northing - utm[0].northing) < 0.01);
      assert.ok(sameE || sameN, 'a line keeps one easting or one northing');
      const value = sameE ? utm[0].easting : utm[0].northing;
      close(value / grid.step, Math.round(value / grid.step), 1e-6, 'lines fall on multiples of the step');
    }
  }
  const loop = usngGrid(LOOP.bounds, LOOP.size);
  assert.equal(loop.step, 1000);
  assert.equal(loop.labels[0].text, '16T DM 48', 'the first top label names the zone and 100 km square');
  // The view is about 900 m wide around 16T DM 479 372: one 1 km line each way, labelled in two digits.
  assert.ok(loop.labels.some(label => label.text.endsWith(' 48')), loop.labels.map(l => l.text).join(' '));
  assert.ok(loop.labels.some(label => label.text === '37'));
});

test('address-grid lines follow the grid model and name the streets on them', async () => {
  const { addressGrid } = await import('../src/overlays/grids.js');
  const { latLonToGrid } = await import('../src/geo/chicago-grid.js');
  const loop = addressGrid(LOOP.bounds, LOOP.size);
  assert.ok([100, 200].includes(loop.step), `step ${loop.step}`);
  for (const line of loop.lines) {
    const grid = line.points.map(([lat, lon]) => latLonToGrid(lat, lon));
    const sameEw = grid.every(g => Math.abs(g.ew - grid[0].ew) < 0.5), sameNs = grid.every(g => Math.abs(g.ns - grid[0].ns) < 0.5);
    assert.ok(sameEw || sameNs, 'a line keeps one grid number');
  }
  const texts = loop.labels.map(label => label.text);
  assert.ok(texts.includes('0 · State St'), texts.join(' | '));
  assert.ok(texts.includes('0 · Madison St'), texts.join(' | '));
  const city = addressGrid(CITY.bounds, CITY.size);
  assert.ok(city.step >= 800, `step ${city.step}`);
  assert.ok(city.labels.some(label => label.text === '800 W · Halsted St'), city.labels.map(l => l.text).join(' | '));
});
