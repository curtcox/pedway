// The self-hosted downtown map (docs/map-layers.md, "Downtown base map") and the base map choice.
import { test, expect } from '@playwright/test';
import { blankTiles, open, snapshot, build, written } from './helpers.js';

const hasBase = page => page.evaluate(async () => { await pedway.data.loaded; return pedway.data.baseMap.available; });
// Counts tile requests, answering each with a blank tile.
async function countTiles(page) {
  const seen = [];
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
  await page.route('https://tile.openstreetmap.org/**', route => { seen.push(route.request().url()); return route.fulfill({ contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: PNG }); });
  return seen;
}
const onMap = (page, key) => page.evaluate(key => pedway.map.hasLayer(key === 'labels' ? pedway.data.baseMap.labelGroup : pedway.data.baseMap.groups.get(key)), key);

test('by default the downtown map draws from the data, and no tiles are fetched inside its box', async ({ page }) => {
  const tiles = await countTiles(page);
  await open(page);
  test.skip(!await hasBase(page), 'this data snapshot has no downtown map (an older one, in the compat job)');
  await page.evaluate(() => pedway.data.baseMap.ready());
  for (const key of ['green', 'water', 'streets', 'rail', 'buildings', 'labels']) expect(await onMap(page, key), key).toBe(true);
  await expect(page.locator('.leaflet-base-buildings-pane canvas')).toBeAttached();
  await expect(page.locator('.base-label').first()).toBeAttached();
  expect(tiles).toEqual([]);
  expect((await snapshot(page)).map.base).toBe('both');

  // Zoomed out past the box, tiles fill in around it.
  await page.evaluate(() => { pedway.map.setZoom(12, { animate: false }); });
  await expect.poll(() => tiles.length).toBeGreaterThan(0);
});

test('the base map choice switches between the downtown map, tiles and neither, and travels in the link', async ({ page }) => {
  const tiles = await countTiles(page);
  await open(page);
  test.skip(!await hasBase(page), 'this data snapshot has no downtown map');
  await page.locator('#layers-open').click();
  await expect(page.locator('#layers-base')).toHaveText('Base map');

  await page.locator('#base-mode').selectOption('osm');
  await expect.poll(() => tiles.length).toBeGreaterThan(0);
  expect(await onMap(page, 'streets')).toBe(false);
  await expect(page.locator('#layer-buildings')).toBeDisabled();

  await page.locator('#base-mode').selectOption('local');
  expect(await page.evaluate(() => pedway.map.hasLayer(pedway.data.baseMap.groups.get('streets')))).toBe(true);
  expect(await page.evaluate(() => document.querySelectorAll('.leaflet-tile-pane .leaflet-layer').length)).toBe(0);
  const before = tiles.length;
  await page.evaluate(() => { pedway.map.setZoom(12, { animate: false }); });
  await page.waitForTimeout(300);
  expect(tiles.length, 'local never asks OpenStreetMap for tiles').toBe(before);

  await page.locator('#base-mode').selectOption('none');
  expect(await onMap(page, 'streets')).toBe(false);
  const href = await written(page);
  const fresh = await page.context().newPage();
  await blankTiles(fresh);
  await open(fresh, href);
  expect((await snapshot(fresh)).map.base).toBe('none');
  expect(await onMap(fresh, 'buildings')).toBe(false);
});

test('base layers switch on their own, and Pedway focus dims the whole base', async ({ page }) => {
  await blankTiles(page);
  await open(page);
  test.skip(!await hasBase(page), 'this data snapshot has no downtown map');
  await page.locator('#layers-open').click();
  await page.locator('#layer-buildings').uncheck();
  expect(await onMap(page, 'buildings')).toBe(false);
  expect(await onMap(page, 'streets')).toBe(true);
  expect((await snapshot(page)).map.layers.buildings).toBe(false);
  await page.locator('#layer-labels').uncheck();
  await expect(page.locator('.base-label')).toHaveCount(0);

  await page.locator('#layer-level').selectOption('pedway');
  const opacity = name => page.evaluate(name => getComputedStyle(pedway.map.getPane(name)).opacity, name);
  expect(Number(await opacity('base-streets'))).toBeLessThan(0.5);
  await page.locator('#layer-level').selectOption('both');
  expect(Number(await opacity('base-streets'))).toBe(1);
});

test('an older link without a base choice opens with the downtown map', async ({ page }) => {
  await blankTiles(page);
  await open(page);
  const href = await build(page, { src: 'Old', map: { layers: { cta: false } } });
  await open(page, href);
  expect((await snapshot(page)).map.base).toBe('both');
  expect((await snapshot(page)).map.layers).toMatchObject({ cta: false, streets: true, buildings: true });
});
