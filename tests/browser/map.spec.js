import { test, expect } from '@playwright/test';

// Serve blank tiles so tests never hit the OpenStreetMap tile servers.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: PNG }));
});

test('shows a map of the Loop that can be panned and zoomed', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.fk-header')).toContainText('Pedway Tools');
  await expect(page.locator('#map .leaflet-tile-loaded').first()).toBeVisible();
  await expect(page.locator('.leaflet-control-attribution')).toContainText('OpenStreetMap');

  const view = () => page.evaluate(() => { const c = pedway.map.getCenter(); return { lat: c.lat, lng: c.lng, zoom: pedway.map.getZoom() }; });
  const start = await view();
  expect(start.lat).toBeCloseTo(41.8837, 3);
  expect(start.lng).toBeCloseTo(-87.6278, 3);

  await page.locator('.leaflet-control-zoom-in').click();
  await expect.poll(async () => (await view()).zoom).toBe(start.zoom + 1);

  await page.evaluate(() => pedway.map.panBy([200, 0], { animate: false }));
  expect((await view()).lng).toBeGreaterThan(start.lng);

  await page.locator('#recenter').click();
  await expect.poll(async () => (await view()).zoom).toBe(start.zoom);
  expect(errors).toEqual([]);
});
