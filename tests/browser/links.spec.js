import { test, expect } from '@playwright/test';
import { blankTiles, open, snapshot, build, written } from './helpers.js';

test.beforeEach(({ page }) => blankTiles(page));

test('an example link is replaced once by a self-contained map link', async ({ page }) => {
  await open(page, './?example=stations');
  const href = await written(page);
  expect(new URL(href).searchParams.has('example')).toBe(false);
  await expect(page.locator('#map-title')).toHaveValue('Pedway train connections');
  await expect(page.locator('.pin-marker')).toHaveCount(4);
  await expect(page).toHaveTitle(/^Pedway train connections — Pedway Tools/);
});

test('title edits and map moves are written to the URL and survive a reload', async ({ page }) => {
  await open(page);
  await page.locator('#map-title').fill('Coffee run');
  await page.evaluate(() => pedway.map.setView([41.8826, -87.6402], 17, { animate: false }));
  await expect.poll(async () => (await snapshot(page)).map.view).toEqual({ c: [41.8826, -87.6402], z: 17 });
  const href = await written(page);
  const before = await snapshot(page);

  await open(page, href);
  expect(await snapshot(page)).toEqual(before);
  await expect(page.locator('#map-title')).toHaveValue('Coffee run');
});

test('the share link opens the same map in a new tab', async ({ page, context }) => {
  await open(page, './?example=meet');
  await written(page);
  const expected = await snapshot(page);
  await page.locator('#share-open').click();
  await expect(page.locator('#share-dialog')).toBeVisible();
  const href = await page.locator('#share-link').inputValue();
  expect(new URL(href).hash).toMatch(/^#v1\./);

  const other = await context.newPage();
  await blankTiles(other);
  await open(other, href);
  expect(await snapshot(other)).toEqual(expected);
  await expect(other.locator('.pin-marker')).toHaveCount(1);
});

test('a link pasted into the address bar loads in place', async ({ page }) => {
  await open(page);
  const doc = { src: 'Pasted', map: { view: { c: [41.8857, -87.6308], z: 18 }, pins: [{ id: 'cl', at: 'dp3wmcj1y', label: 'Clark/Lake' }] } };
  const href = await build(page, doc);
  await page.evaluate(href => { location.hash = new URL(href).hash; }, href);
  await expect(page.locator('#map-title')).toHaveValue('Pasted');
  await expect(page.locator('.pin-marker')).toHaveCount(1);
  expect((await snapshot(page)).map.view).toEqual({ c: [41.8857, -87.6308], z: 18 });
});

test('a broken link reports an error and keeps the current map', async ({ page }) => {
  await open(page, './?example=stations');
  await written(page);
  await page.evaluate(() => { location.hash = '#v1.invalid!'; });
  await expect(page.locator('#app-status')).toBeVisible();
  await expect(page.locator('#app-status')).not.toBeEmpty();
  await expect(page.locator('#map-title')).toHaveValue('Pedway train connections');
  await expect(page.locator('.pin-marker')).toHaveCount(4);
});

test('a link to a place outside Chicago is refused', async ({ page }) => {
  await open(page);
  const href = await build(page, { src: 'Loop' });
  const url = new URL(href);
  // Hand-build a v1 link the app's own builder would never produce.
  const payload = await page.evaluate(async () => {
    const { compress } = await import('./vendor/fragment-kit-v0.5.0/src/index.js');
    return compress(JSON.stringify({ format: 'hashbin-diagram', version: 1, type: 'pedway-map', src: 'NYC', map: { view: { c: [40.7, -74.0], z: 15 } } }));
  });
  url.hash = 'v1.' + payload;
  await open(page, url.href);
  await expect(page.locator('#app-status')).toContainText('outside the Chicago area');
});

test('an unknown example is reported, not replaced by a default', async ({ page }) => {
  await open(page, './?example=nope');
  await expect(page.locator('#app-status')).toContainText('no example map called');
  expect(new URL(page.url()).searchParams.get('example')).toBe('nope');
});

test('pin text is shown as text, never as HTML', async ({ page }) => {
  await open(page);
  const doc = { src: '<img src=x onerror=alert(1)>', map: { pins: [{ id: 'x', at: 'dp3wmbxqh', label: '<b>bold</b>', md: '<script>alert(1)</script>' }] } };
  await open(page, await build(page, doc));
  await page.locator('.pin-marker').click();
  await expect(page.locator('.pin-popup h3')).toHaveText('<b>bold</b>');
  await expect(page.locator('.pin-note')).toHaveText('<script>alert(1)</script>');
  expect(await page.locator('.pin-popup b, .pin-popup script').count()).toBe(0);
});

test('the examples page links open the map page', async ({ page }) => {
  await page.goto('./examples.html');
  await expect(page.locator('.fk-gallery-card')).toHaveCount(3);
  const href = await page.getByRole('link', { name: 'Open Pedway train connections' }).getAttribute('href');
  const url = new URL(href, page.url());
  expect(url.pathname).not.toMatch(/examples\.html$/);
  await open(page, url.href);
  await expect(page.locator('.pin-marker')).toHaveCount(4);
});
