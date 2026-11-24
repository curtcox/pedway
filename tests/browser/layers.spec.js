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
  await expect(popup.locator('a')).toHaveAttribute('rel', 'noopener noreferrer');
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
