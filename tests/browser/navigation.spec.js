import { test, expect } from '@playwright/test';
import { blankTiles, open, snapshot, written, build, openPin, popup } from './helpers.js';

// Never call the real Nominatim from tests: answer from a fixture and count requests.
async function fakeNominatim(page, places = []) {
  const requests = [];
  await page.route('https://nominatim.openstreetmap.org/**', route => {
    requests.push(new URL(route.request().url()));
    route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(places) });
  });
  return requests;
}
test.beforeEach(({ page }) => blankTiles(page));

const loaded = page => page.evaluate(() => pedway.data.loaded);
const center = page => page.evaluate(() => { const c = pedway.map.getCenter(); return { lat: c.lat, lon: c.lng }; });
const metres = (a, b) => Math.hypot((a.lat - b.lat) * 111000, (a.lon - b.lon) * 82800);
async function search(page, text) {
  await page.locator('#search-input').fill(text);
  await page.locator('#search-input').press('Enter');
}

test('pins and stations offer links to other map apps', async ({ page }) => {
  await open(page, './?example=stations');
  await openPin(page, 'clark-lake');
  const links = popup(page).locator('.open-in');
  await links.locator('summary').click();
  for (const app of ['google', 'walk', 'transit', 'apple', 'osm']) {
    const link = links.locator(`a[data-app="${app}"]`);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link).toHaveAttribute('href', /41\.88\d+(%2C|,)-87\.63\d+|mlat=41\.88/);
  }
  await expect(links.locator('a[data-app="transit"]')).toHaveAttribute('href', /travelmode=transit/);
});

test('search reads corners, addresses and coordinates without the network', async ({ page }) => {
  const requests = await fakeNominatim(page);
  await open(page);
  for (const [text, expected] of [
    ['Clark & Lake', { lat: 41.885747, lon: -87.630986 }],
    ['233 S Wacker Dr', { lat: 41.8789, lon: -87.6366 }],
    ['41.8826, -87.6402', { lat: 41.8826, lon: -87.6402 }],
    ['16T DM 47906 36872', { lat: 41.88206, lon: -87.62785 }],
  ]) {
    await search(page, text);
    await expect(page.locator('.leaflet-popup .search-hit').last()).toBeVisible();
    await expect.poll(async () => metres(await center(page), expected), { message: text }).toBeLessThan(40);
  }
  expect(requests).toHaveLength(0);
});

test('search suggests stations and pins by name, and a hit can become a pin', async ({ page }) => {
  await fakeNominatim(page);
  await open(page, './?example=stations');
  await loaded(page);
  await page.locator('#search-input').fill('washington/wa');
  await expect(page.locator('.search-option').first()).toContainText('Washington/Wabash');
  await page.locator('#search-input').press('ArrowDown');
  await expect(page.locator('.search-option').first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.leaflet-popup .search-hit h3').last()).toHaveText('Washington/Wabash');
  await expect(page.locator('#search-results')).toBeHidden();

  await page.locator('#search-drop').last().click();
  await expect(page.locator('#pin-dialog')).toBeVisible();
  await page.locator('#pin-save').click();
  expect((await snapshot(page)).map.pins).toHaveLength(5);

  await search(page, 'Millennium Station');
  await expect(page.locator('.leaflet-popup .search-hit h3').last()).toHaveText('Millennium Station');
});

test('unknown addresses go to OpenStreetMap only when searched, and results stay in Chicago', async ({ page }) => {
  const requests = await fakeNominatim(page, [
    { display_name: 'Art Institute of Chicago, 111, South Michigan Avenue, Loop, Chicago, Cook County, Illinois, United States', lat: '41.8796', lon: '-87.6237' },
  ]);
  await open(page);
  await page.locator('#search-input').fill('Art Institute');
  await page.waitForTimeout(300);
  expect(requests).toHaveLength(0);
  await page.locator('#search-go').click();
  await expect(page.locator('.leaflet-popup .search-hit h3').last()).toHaveText(/^Art Institute of Chicago/);
  expect(requests).toHaveLength(1);
  expect(requests[0].searchParams.get('q')).toBe('Art Institute');
  expect(requests[0].searchParams.get('bounded')).toBe('1');
  await expect.poll(async () => metres(await center(page), { lat: 41.8796, lon: -87.6237 })).toBeLessThan(40);

  // The same search again is answered from the cache.
  await search(page, 'art institute');
  await expect(page.locator('.leaflet-popup .search-hit h3').last()).toHaveText(/^Art Institute of Chicago/);
  expect(requests).toHaveLength(1);
});

test('a search with no match explains what to try', async ({ page }) => {
  await fakeNominatim(page, [{ display_name: 'Springfield', lat: '39.78', lon: '-89.65' }]);
  await open(page);
  await search(page, 'zzz nowhere');
  await expect(page.locator('#search-note')).toContainText('No match');
  await search(page, '40.7128, -74.0060');
  await expect(page.locator('#search-note')).toContainText('outside the Chicago area');
});

test.describe('my location', () => {
  test.use({ geolocation: { latitude: 41.88370, longitude: -87.62780, accuracy: 20 }, permissions: ['geolocation'] });

  test('shows where you are, drops a pin there, and finds the nearest entrance', async ({ page }) => {
    await open(page, './?example=loop');
    await loaded(page);
    await expect(page.locator('#gps-toggle')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#gps-toggle').click();
    await expect(page.locator('#app-status')).toContainText('You are here (±20 m)');
    await expect(page.locator('.gps-dot')).toBeVisible();
    expect(metres(await center(page), { lat: 41.8837, lon: -87.6278 })).toBeLessThan(5);

    await page.locator('#gps-nearest').click();
    await expect(page.locator('#app-status')).toContainText(/about \d+ m away/);

    await page.locator('#gps-drop').click();
    await expect(page.locator('#pin-dialog')).toBeVisible();
    await page.locator('#pin-save').click();
    const [pin] = (await snapshot(page)).map.pins;
    const at = await page.evaluate(async hash => (await import('./src/geo/geohash.js')).decodeGeohash(hash), pin.at);
    expect(metres(at, { lat: 41.8837, lon: -87.6278 })).toBeLessThan(5);
    // Dropping the pin stops tracking.
    await expect(page.locator('#gps-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.gps-dot')).toHaveCount(0);
  });

  test('a rough fix warns that underground GPS is unreliable, and Stop clears it', async ({ page, context }) => {
    await context.setGeolocation({ latitude: 41.8840, longitude: -87.6290, accuracy: 400 });
    await open(page);
    await page.locator('#gps-toggle').click();
    await expect(page.locator('#app-status')).toContainText('underground GPS is often wrong');
    await page.locator('#gps-stop').click();
    await expect(page.locator('#app-status')).toBeHidden();
    await expect(page.locator('.gps-dot')).toHaveCount(0);
  });

  test('a shared map can offer the location button but never asks on its own', async ({ page }) => {
    await open(page);
    const href = await build(page, { src: 'Find me', map: { gps: true } });
    await open(page, href);
    await expect(page.locator('#gps-offer')).toBeVisible();
    await expect(page.locator('.gps-dot')).toHaveCount(0);
    await page.locator('#gps-offer').click();
    await expect(page.locator('#app-status')).toContainText('You are here');
  });

  test('the Layers panel sets whether a map offers location', async ({ page }) => {
    await open(page);
    await page.locator('#layers-open').click();
    await page.locator('#map-gps').check();
    expect((await snapshot(page)).map.gps).toBe(true);
    await written(page);
  });
});

test('refused location permission is explained', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      watchPosition: (ok, fail) => { setTimeout(() => fail({ code: 1, message: 'denied' }), 10); return 1; }, clearWatch() {} } });
  });
  await page.locator('#gps-toggle').click();
  await expect(page.locator('#app-status')).toContainText('Location permission was refused');
  await expect(page.locator('#gps-toggle')).toHaveAttribute('aria-pressed', 'false');
});
