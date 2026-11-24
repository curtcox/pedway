import { expect } from '@playwright/test';

// Serve blank tiles so tests never hit the OpenStreetMap tile servers.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
export async function blankTiles(page) {
  // The map asks for tiles with CORS so the offline worker can keep them.
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: PNG }));
}
export async function open(page, href = './') {
  // A link that changes only the fragment keeps the page, which is already ready: then wait
  // until the app has opened one more address. A marker on the old page tells the two apart.
  // Going to the address the page is already on opens nothing new, so there is nothing to wait for.
  const before = await page.evaluate(href => {
    window.__opening = true;
    return { count: Number(document.body?.dataset.opens ?? 0), same: new URL(href, location.href).href === location.href };
  }, href).catch(() => ({ count: 0, same: false }));
  await page.goto(href);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  if (!before.same) await page.waitForFunction(count => !window.__opening || Number(document.body.dataset.opens ?? 0) > count, before.count);
}
export const snapshot = page => page.evaluate(() => pedway.snapshot());
export const build = (page, doc) => page.evaluate(doc => pedway.urlState.build(doc).href, doc);
// page.url() can miss history.replaceState under mobile emulation, so ask the page.
export const here = page => page.evaluate(() => location.href);
export async function written(page) {
  // Fragment Kit debounces URL writes, and map moves restart the wait: poll until the link holds the current map.
  await expect.poll(() => page.evaluate(() => {
    try {
      const intent = pedway.urlState.parse(location.href);
      return intent.kind === 'source' && JSON.stringify(intent.doc) === JSON.stringify(pedway.snapshot());
    } catch { return false; }
  })).toBe(true);
  return here(page);
}
// Leaflet fades a closed popup out over 200 ms, so briefly two can exist; the newest is last.
export const popup = page => page.locator('.leaflet-popup').last();
// Opens a pin's popup and waits for its auto-pan to finish, so clicks land in the popup.
export async function openPin(page, id) {
  await page.evaluate(id => pedway.pins.open(id), id);
  await expect(page.locator(`.leaflet-popup .pin-popup[data-pin="${id}"]`).last()).toBeVisible();
  await page.waitForFunction(() => !pedway.map._panAnim?._inProgress && !pedway.map._animatingZoom);
}
// Clicks a button in the More menu (it holds Save as…, Open file…, Export… and, on phones, Library).
export async function menu(page, id) {
  await page.locator('.fk-more').click();
  await page.locator(`#fk-more-drawer #${id}`).click();
}
