import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { blankTiles, open, openPin, menu } from './helpers.js';

test.beforeEach(({ page }) => blankTiles(page));
// Without fades, popups are fully opaque when axe checks their contrast.
test.use({ contextOptions: { reducedMotion: 'reduce' } });

// Fails on any WCAG 2.2 A/AA problem axe finds, and lists them readably.
async function audit(page, include) {
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
  if (include) builder = builder.include(include);
  const { violations } = await builder.analyze();
  const report = violations.map(v => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.slice(0, 5).map(n => n.target.join(' ')).join('\n  ')}`);
  expect(report, report.join('\n')).toEqual([]);
}

test('the map page has no WCAG A/AA problems', async ({ page }) => {
  await open(page, './?example=stations');
  await page.evaluate(() => pedway.data.loaded);
  await audit(page);
});

test('the layers panel, a pin popup and the pin editor have no WCAG A/AA problems', async ({ page }) => {
  await open(page, './?example=meet');
  await page.evaluate(() => pedway.data.loaded);
  await page.locator('#layers-open').click();
  await audit(page, '.layers-control');
  await page.keyboard.press('Escape');
  await openPin(page, 'meet');
  await audit(page, '.leaflet-popup');
  await page.locator('.leaflet-popup .pin-edit').click();
  await expect(page.locator('#pin-dialog')).toBeVisible();
  await audit(page, '#pin-dialog');
});

test('data popups have no WCAG A/AA problems', async ({ page }) => {
  await open(page, './?example=stations');
  await page.evaluate(() => pedway.data.loaded);
  for (const name of ['Clark/Lake', 'Millennium Station']) {
    await page.evaluate(name => {
      for (const key of ['cta', 'metra']) pedway.data.groups.get(key).eachLayer(geo => geo.eachLayer(shape => {
        if (shape.feature.properties.name === name) shape.openPopup();
      }));
    }, name);
    await expect(page.locator('.leaflet-popup .data-popup h3').last()).toHaveText(name);
    await audit(page, '.leaflet-popup');
  }
});

test('the share, export and more dialogs have no WCAG A/AA problems', async ({ page }) => {
  await open(page, './?example=stations');
  await page.locator('#share-open').click();
  await expect(page.locator('dialog[open]')).toBeVisible();
  await audit(page, 'dialog[open]');
  await page.keyboard.press('Escape');
  await menu(page, 'export-open');
  await expect(page.locator('#export-dialog')).toBeVisible();
  await audit(page, '#export-dialog');
});

test('the examples page has no WCAG A/AA problems', async ({ page }) => {
  await page.goto('./examples.html');
  await expect(page.locator('a').first()).toBeVisible();
  await audit(page);
});

test('the about dialog explains data, privacy and keyboard use', async ({ page }) => {
  await open(page);
  await menu(page, 'about-open');
  const dialog = page.locator('#about-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('OpenStreetMap');
  await expect(dialog).toContainText('Keyboard');
  for (const link of await dialog.locator('a').all()) await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await audit(page, '#about-dialog');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('reduced motion turns off map animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  expect(await page.evaluate(() => [pedway.map.options.zoomAnimation, pedway.map.options.fadeAnimation])).toEqual([false, false]);
  await page.locator('.leaflet-control-zoom-in').click();
  expect(await page.evaluate(() => pedway.map._animatingZoom)).toBeFalsy();
});

test('pins and the search suggestions can be reached and used with the keyboard', async ({ page }) => {
  await open(page, './?example=meet');
  const marker = page.locator('.leaflet-marker-icon.pin-marker').first();
  await expect(marker).toHaveAttribute('tabindex', '0');
  await expect(marker).toHaveAttribute('role', 'button');
  await marker.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.leaflet-popup .pin-popup')).toBeVisible();
  await page.locator('#search-input').fill('Clark');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.search-option').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#search-input')).toBeFocused();
  await expect(page.locator('#search-results')).toBeHidden();
});
