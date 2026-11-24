import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { blankTiles, open, snapshot, written, build } from './helpers.js';

test.beforeEach(({ page }) => blankTiles(page));

const hasCorners = page => page.evaluate(async () => { await pedway.data.loaded; return Boolean(pedway.data.snapshot?.files.intersections); });
const labels = (page, key) => page.locator(`.leaflet-coords-labels-pane .coord-${key}`);
async function switchOn(page, key) {
  if (await page.locator('#layers-panel').isHidden()) await page.locator('#layers-open').click();
  await page.locator(`#overlay-${key}`).check();
}

test('each coordinate overlay draws its grid and shows the map centre in the readout', async ({ page }) => {
  await open(page);
  await expect(page.locator('#coord-readout')).toBeHidden();
  await expect(page.locator('#layers-coords')).toHaveText('Coordinates');

  await switchOn(page, 'latlon');
  await expect(labels(page, 'latlon').first()).toBeAttached();
  await expect(page.locator('#readout-latlon')).toHaveText(/^41\.8\d{4}, -87\.6\d{4}$/);
  await expect(page.locator('#coord-readout')).toBeVisible();
  await expect(page.locator('#map')).toHaveClass(/show-centre/);
  await expect(page.locator('#coord-readout-where')).toHaveText('Map centre');

  await switchOn(page, 'geohash');
  await expect(labels(page, 'geohash').first()).toHaveText(/^dp3w/);
  await expect(page.locator('#readout-geohash')).toHaveText(/^dp3w[0-9b-hjkmnp-z]{4}$/);

  await switchOn(page, 'usng');
  await expect(labels(page, 'usng').first()).toHaveText(/^16T DM \d{1,3}$/);
  await expect(page.locator('#readout-usng')).toHaveText(/^16T DM 4\d{4} 3\d{4}$/);

  await switchOn(page, 'grid');
  await expect(labels(page, 'grid').filter({ hasText: 'State St' }).first()).toBeAttached();
  await expect(page.locator('#readout-grid')).not.toBeEmpty();

  expect((await snapshot(page)).map.overlays).toEqual({ latlon: true, geohash: true, usng: true, grid: true });
  await page.locator('#overlay-geohash').uncheck();
  await expect(labels(page, 'geohash')).toHaveCount(0);
  await expect(page.locator('#readout-geohash')).toBeHidden();
});

test('overlays travel in the link, and become this viewer’s default for new maps', async ({ page }) => {
  await open(page);
  await open(page, await build(page, { src: 'Grid', map: { overlays: { usng: true } } }));
  await expect(labels(page, 'usng').first()).toBeAttached();
  await expect(page.locator('#readout-usng')).toBeVisible();
  await page.locator('#layers-open').click();
  await expect(page.locator('#overlay-usng')).toBeChecked();
  await page.locator('#overlay-latlon').check();
  const href = await written(page);
  expect(new URL(href).hash).toMatch(/^#v1\./);

  const blank = await page.context().newPage();
  await blankTiles(blank);
  await open(blank);
  expect((await snapshot(blank)).map.overlays).toMatchObject({ usng: true, latlon: true });
  await expect(labels(blank, 'latlon').first()).toBeAttached();
});

test('the grid redraws as the map moves and keeps its readout current', async ({ page }) => {
  await open(page);
  await open(page, await build(page, { src: '', map: { overlays: { usng: true } } }));
  const before = await page.locator('#readout-usng').textContent();
  await page.evaluate(() => pedway.map.panBy([300, 0], { animate: false }));
  await expect(page.locator('#readout-usng')).not.toHaveText(before);
  await page.evaluate(() => pedway.map.setZoom(12, { animate: false }));
  // Zoomed out, the lines are 10 km apart and labelled with one digit.
  await expect(labels(page, 'usng').filter({ hasText: /^\d$/ }).first()).toBeAttached();
  await expect(page.locator('#coord-readout-live')).toContainText('USNG 16T');
});

test('the readout and the coordinates section have no WCAG A/AA problems', async ({ page }) => {
  await open(page);
  await open(page, await build(page, { src: '', map: { overlays: { latlon: true, geohash: true, usng: true, grid: true } } }));
  await page.locator('#layers-open').click();
  const { violations } = await new AxeBuilder({ page }).include('#coord-readout').include('.layers-control')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([]);
});

test('the address grid labels real corners from the data, and the readout names the nearest one', async ({ page }) => {
  await open(page);
  test.skip(!await hasCorners(page), 'this data snapshot has no intersections (an older one, in the compat job)');
  await open(page, await build(page, { src: '', map: { overlays: { grid: true }, view: { c: [41.88372, -87.62783], z: 17 } } }));
  await page.evaluate(() => pedway.data.loaded);
  await expect(page.locator('.corner-label').filter({ hasText: /^State & Washington$/ })).toHaveCount(1);
  await expect(page.locator('#readout-grid')).toHaveText(/^State & Washington(, \d+ m [NSEW]{1,2})?$/);
  await page.evaluate(() => pedway.map.setZoom(13, { animate: false }));
  await expect(page.locator('.corner-label')).toHaveCount(0);
});

test('a searched corner lands where the data has it', async ({ page }) => {
  await open(page);
  test.skip(!await hasCorners(page), 'this data snapshot has no intersections (an older one, in the compat job)');
  const corner = await page.evaluate(() => pedway.data.features.get('intersections')
    .find(f => f.properties.streets.includes('Clark') && f.properties.streets.includes('Lake')).geometry.coordinates);
  await page.locator('#search-input').fill('Clark & Lake');
  await page.locator('#search-go').click();
  await expect(page.locator('.search-hit h3')).toHaveText('Clark St & Lake St');
  // The popup may pan the map, so read where the search marker is, not the map centre.
  const at = await page.evaluate(() => { let found; pedway.map.eachLayer(layer => { if (layer.options?.className === 'search-marker') found = layer.getLatLng(); }); return found; });
  expect(Math.abs(at.lat - corner[1])).toBeLessThan(0.00002);
  expect(Math.abs(at.lng - corner[0])).toBeLessThan(0.00002);
});
