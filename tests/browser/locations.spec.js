import { test, expect } from '@playwright/test';
import { blankTiles, open, snapshot, written, popup, here, openPin } from './helpers.js';

test.beforeEach(({ page }) => blankTiles(page));

const pinLatLon = (page, id) => page.evaluate(async id => {
  const { decodeGeohash } = await import('./src/geo/geohash.js');
  const pin = pedway.snapshot().map.pins.find(p => p.id === id);
  const { lat, lon } = decodeGeohash(pin.at);
  return { lat, lon };
}, id);
const metres = (a, b) => Math.hypot((a.lat - b.lat) * 111000, (a.lon - b.lon) * 82800);

test('a pin popup shows its location in the chosen format, remembered by this browser only', async ({ page }) => {
  await open(page, './?example=stations');
  await openPin(page, 'clark-lake');
  // Opening the popup may pan the map, which rightly updates the link: read it after.
  const href = await written(page);
  const view = popup(page).locator('.location-view');
  await expect(view.locator('.location-value')).toHaveText(/^41\.885\d+, -87\.630\d+$/);

  await view.locator('.location-format').selectOption('usng');
  await expect(view.locator('.location-value')).toHaveText(/^16T DM \d{5} \d{5}$/);
  await view.locator('.location-format').selectOption('grid');
  await expect(view.locator('.location-value')).toHaveText('Clark St & Lake St');
  await view.locator('.location-copy').click();
  await expect(view.locator('.location-copy')).toHaveText(/Copied|Copy failed/);

  // The choice is a viewer setting: it survives a reload but never enters the link.
  expect(await here(page)).toBe(href);
  await open(page, href);
  await openPin(page, 'ogilvie');
  await expect(popup(page).locator('.location-format')).toHaveValue('grid');
  await expect(popup(page).locator('.location-value')).toHaveText(/Canal St|Clinton St|Madison St|Washington St|\d+ [NSEW]/);
});

test('Copy puts the shown location on the clipboard', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Only Chromium lets tests read the clipboard.');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page, './?example=stations');
  await openPin(page, 'washington');
  await popup(page).locator('.location-format').selectOption('geohash');
  await popup(page).locator('.location-copy').click();
  await expect(popup(page).locator('.location-copy')).toHaveText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^dp3w[0-9b-hjkmnp-z]{5}$/);
});

test('typing a location in the pin editor moves the pin', async ({ page }) => {
  await open(page, './?example=stations');
  await written(page);
  await openPin(page, 'washington');
  await popup(page).locator('.pin-edit').click();
  const field = page.locator('#pin-location');
  await expect(field).toHaveValue(/^41\.883\d+, -87\.627\d+$/);

  for (const [text, expected] of [
    ['Clark & Lake', { lat: 41.885747, lon: -87.630986 }],
    ['233 S Wacker Dr', { lat: 41.8789, lon: -87.6366 }],
    ['16T DM 47906 36872', { lat: 41.88206, lon: -87.62785 }],
    ['41°53′01.4″N 87°37′40.1″W', { lat: 41.883722, lon: -87.627806 }],
  ]) {
    if (!(await page.locator('#pin-dialog').isVisible())) {
      await openPin(page, 'washington');
      await popup(page).locator('.pin-edit').click();
    }
    await field.fill(text);
    await page.locator('#pin-save').click();
    await expect(page.locator('#pin-dialog')).toBeHidden();
    expect(metres(await pinLatLon(page, 'washington'), expected)).toBeLessThan(30);
  }
  const doc = await snapshot(page), href = await written(page);
  // A fresh tab: re-opening the current URL in place is not a real load under mobile emulation.
  const fresh = await page.context().newPage();
  await blankTiles(fresh);
  await open(fresh, href);
  expect((await snapshot(fresh)).map.pins).toEqual(doc.map.pins);
});

test('an unreadable or out-of-town location is refused and the editor stays open', async ({ page }) => {
  await open(page, './?example=stations');
  const before = (await snapshot(page)).map.pins.find(p => p.id === 'ogilvie').at;
  await openPin(page, 'ogilvie');
  await popup(page).locator('.pin-edit').click();
  const field = page.locator('#pin-location');

  await field.fill('somewhere nice');
  await page.locator('#pin-save').click();
  await expect(page.locator('#pin-dialog')).toBeVisible();
  await expect(page.locator('#pin-location-error')).toContainText('Could not read');
  await expect(field).toHaveAttribute('aria-invalid', 'true');

  await field.fill('40.7128, -74.0060');
  await expect(page.locator('#pin-location-error')).toBeHidden();
  await page.locator('#pin-save').click();
  await expect(page.locator('#pin-location-error')).toContainText('Chicago area');

  await page.locator('#pin-cancel').click();
  expect((await snapshot(page)).map.pins.find(p => p.id === 'ogilvie').at).toBe(before);
});
