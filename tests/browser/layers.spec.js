import { test, expect } from '@playwright/test';
import { blankTiles, open, snapshot, written, build } from './helpers.js';

test.beforeEach(({ page }) => blankTiles(page));

const loaded = page => page.evaluate(() => pedway.data.loaded);
const onMap = (page, key) => page.evaluate(key => pedway.map.hasLayer(pedway.data.groups.get(key)), key);
async function openPanel(page) {
  await page.locator('#layers-open').click();
  await expect(page.locator('#layers-panel')).toBeVisible();
}

test('Pedway, entrance and station data load and draw on the map', async ({ page }) => {
  await open(page);
  const counts = await loaded(page);
  expect(counts.pedway).toBeGreaterThan(100);
  expect(counts.cta).toBeGreaterThan(100);
  expect(counts.metra).toBeGreaterThan(50);
  expect(counts.access).toBeGreaterThan(20);
  for (const key of ['pedway', 'access', 'cta', 'metra']) expect(await onMap(page, key)).toBe(true);
  await expect(page.locator('path.leaflet-interactive').first()).toBeAttached();
});

test('a station popup lists its lines and its Pedway connection', async ({ page }) => {
  await open(page);
  await loaded(page);
  await page.evaluate(() => {
    pedway.data.groups.get('cta').eachLayer(geo => geo.eachLayer(shape => {
      if (shape.feature.properties.name === 'Clark/Lake') shape.openPopup();
    }));
  });
  const popup = page.locator('.data-popup');
  await expect(popup.locator('h3')).toHaveText('Clark/Lake');
  await expect(popup.locator('.line-chip')).toHaveText(['Blue', 'Brown', 'Green', 'Orange', 'Pink', 'Purple']);
  await expect(popup).toContainText('Connects to the Pedway');
  await expect(popup.locator('.data-source a')).toHaveAttribute('rel', 'noopener noreferrer');
});

test('turning layers off updates the map and the link, and the link restores them', async ({ page }) => {
  await open(page, './?example=stations');
  await loaded(page);
  await openPanel(page);
  await page.locator('#layer-metra').uncheck();
  await page.locator('#layer-access').uncheck();
  expect(await onMap(page, 'metra')).toBe(false);
  expect(await onMap(page, 'access')).toBe(false);
  expect(await onMap(page, 'cta')).toBe(true);
  expect((await snapshot(page)).map.layers).toMatchObject({ metra: false, access: false, cta: true, pedway: true });

  const href = await written(page);
  const fresh = await page.context().newPage();
  await blankTiles(fresh);
  await open(fresh, href);
  await loaded(fresh);
  expect(await onMap(fresh, 'metra')).toBe(false);
  expect(await onMap(fresh, 'cta')).toBe(true);
  await fresh.locator('#layers-open').click();
  await expect(fresh.locator('#layer-metra')).not.toBeChecked();
});

test('layer choices become this viewer’s default for new maps, but shared links keep their own', async ({ page }) => {
  await open(page);
  await loaded(page);
  await openPanel(page);
  await page.locator('#layer-cta').uncheck();
  await page.locator('#layer-level').selectOption('pedway');

  const blank = await page.context().newPage();
  await blankTiles(blank);
  await open(blank);
  await loaded(blank);
  expect(await onMap(blank, 'cta')).toBe(false);
  expect((await snapshot(blank)).map.level).toBe('pedway');

  const shared = await build(blank, { src: 'Shared', map: { layers: { cta: true }, level: 'both' } });
  await open(blank, shared);
  expect(await onMap(blank, 'cta')).toBe(true);
  expect((await snapshot(blank)).map.level).toBe('both');
});

test('the view setting focuses on the Pedway or hides it', async ({ page }) => {
  await open(page);
  await loaded(page);
  await openPanel(page);
  const tileOpacity = () => page.evaluate(() => Number(getComputedStyle(document.querySelector('.leaflet-tile-pane .leaflet-layer')).opacity));

  await page.locator('#layer-level').selectOption('pedway');
  await expect.poll(tileOpacity).toBeLessThan(0.5);
  expect(await onMap(page, 'pedway')).toBe(true);

  await page.locator('#layer-level').selectOption('street');
  await expect.poll(tileOpacity).toBe(1);
  expect(await onMap(page, 'pedway')).toBe(false);
  expect(await onMap(page, 'access')).toBe(false);
  expect(await onMap(page, 'cta')).toBe(true);
  await expect(page.locator('#layer-pedway')).toBeDisabled();
  // The layer stays switched on, so it comes back with the Pedway view.
  expect((await snapshot(page)).map.layers.pedway).toBe(true);
  await page.locator('#layer-cta').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#layers-panel')).toBeHidden();
  await expect(page.locator('#layers-open')).toBeFocused();
});

test('place categories toggle, appear only when zoomed in, and can be found by search', async ({ page }) => {
  await open(page);
  const counts = await loaded(page);
  expect(counts.poi).toBeGreaterThan(100);
  // Restrooms are on by default; food is off.
  expect(await onMap(page, 'restroom')).toBe(true);
  expect(await onMap(page, 'food')).toBe(false);
  await openPanel(page);
  await expect(page.locator('#layers-places')).toHaveText('Places');
  await page.locator('#layer-food').check();
  expect(await onMap(page, 'food')).toBe(true);
  expect((await snapshot(page)).map.layers.food).toBe(true);
  await expect(page.locator('#layers-zoom-note')).toBeHidden();

  await page.evaluate(() => pedway.map.setZoom(14, { animate: false }));
  await expect.poll(() => onMap(page, 'food')).toBe(false);
  await expect(page.locator('#layers-zoom-note')).toBeVisible();
  await expect(page.locator('#layer-food')).toBeChecked();
  await page.evaluate(() => pedway.map.setZoom(16, { animate: false }));
  await expect.poll(() => onMap(page, 'food')).toBe(true);

  // Open a named food place's popup, then find the same place by name.
  const name = await page.evaluate(() => {
    let found = null;
    pedway.data.groups.get('food').eachLayer(geo => geo.eachLayer(shape => {
      if (!found && shape.feature.properties.name) { found = shape.feature.properties.name; shape.openPopup(); }
    }));
    return found;
  });
  await expect(page.locator('.leaflet-popup .data-popup h3').last()).toHaveText(name);
  await expect(page.locator('.leaflet-popup .data-popup .open-in').last()).toBeAttached();
  await page.keyboard.press('Escape');
  await page.locator('#search-input').fill(name);
  await expect(page.locator('.search-option').first()).toContainText(name);
  await expect(page.locator('#search-note')).toContainText('press Down');
});

test('the layers panel scrolls on a short map and closes when the map is tapped', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 420 });
  await open(page);
  await openPanel(page);
  await page.locator('#map-gps').scrollIntoViewIfNeeded();
  await expect(page.locator('#map-gps')).toBeInViewport();
  // Data shapes cover much of the map, so fire the map's own click.
  await page.evaluate(() => pedway.map.fire('click', { latlng: pedway.map.getCenter() }));
  await expect(page.locator('#layers-panel')).toBeHidden();
  await expect(page.locator('#layers-open')).toHaveAttribute('aria-expanded', 'false');
});

test('data loads from the current snapshot, and a file that fails its hash is left out', async ({ page }) => {
  // Serve a tampered CTA file: it must be refused while the other layers still load.
  await page.route('**/data/store/cta/*.geojson', async route => {
    const response = await route.fetch();
    const data = await response.json();
    data.features[0].properties.name = 'Tampered';
    await route.fulfill({ response, body: JSON.stringify(data) });
  });
  await open(page);
  const counts = await loaded(page);
  expect(counts.cta).toBeUndefined();
  expect(counts.pedway).toBeGreaterThan(100);
  await expect(page.locator('#app-status')).toContainText('could not be loaded');
  const snapshot = await page.evaluate(() => pedway.data.snapshot);
  expect(snapshot.id).toMatch(/^\d{4}-\d{2}-\d{2}/);
  expect(Object.keys(snapshot.files)).toEqual(['pedway', 'access', 'cta', 'metra', 'poi']);
});

test('the About dialog names the data snapshot', async ({ page }) => {
  await open(page);
  await loaded(page);
  const id = await page.evaluate(() => pedway.data.snapshot.id);
  await page.locator('.fk-more').click();
  await page.locator('#fk-more-drawer #about-open').click();
  await expect(page.locator('#about-data')).toContainText(`data snapshot ${id}`);
});
