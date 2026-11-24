import { expect } from '@playwright/test';

// Serve blank tiles so tests never hit the OpenStreetMap tile servers.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
export async function blankTiles(page) {
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: PNG }));
}
export async function open(page, href = './') {
  await page.goto(href);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
}
export const snapshot = page => page.evaluate(() => pedway.snapshot());
export const build = (page, doc) => page.evaluate(doc => pedway.urlState.build(doc).href, doc);
export async function written(page) {
  await expect.poll(() => new URL(page.url()).hash.startsWith('#v1.')).toBe(true);
  // Fragment Kit debounces URL writes by 300 ms.
  await page.waitForTimeout(400);
  return page.url();
}
// Leaflet fades a closed popup out over 200 ms, so briefly two can exist; the newest is last.
export const popup = page => page.locator('.leaflet-popup').last();
