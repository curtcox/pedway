import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { blankTiles, open, snapshot, written, menu } from './helpers.js';

test.beforeEach(({ page }) => blankTiles(page));
const status = page => page.locator('#library-status');

test('maps save to the library with history, survive a reload and reopen', async ({ page }) => {
  await open(page, './?example=meet');
  await written(page);
  const first = await snapshot(page);
  // Save on an unsaved map asks for a name; an empty name comes from the title.
  await page.locator('#library-save').click();
  await expect(page.locator('#library-save-as-dialog')).toBeVisible();
  await page.locator('#library-save-as-confirm').click();
  await expect(status(page)).toContainText(`Saved as “${first.src}”`);

  await page.locator('#map-title').fill('Meet-up, second try');
  await expect(status(page)).toContainText('Unsaved changes');
  await page.locator('#library-save').click();
  await expect(status(page)).toContainText('Saved to');
  const second = await snapshot(page);

  // A fresh, blank page still has the library.
  await open(page, './');
  await expect(page.locator('#map-title')).toHaveValue('');
  await menu(page, 'library-open-menu');
  const card = page.locator('#library-list .fk-entries .fk-entry', { hasText: first.src });
  await expect(card).toContainText('2 revisions');
  await card.getByRole('button', { name: 'History', exact: true }).click();
  await page.locator('#library-list > .fk-entry').last().getByRole('button', { name: 'Open', exact: true }).click();
  await expect(status(page)).toContainText(`Opened “${first.src}”`);
  expect(await snapshot(page)).toEqual(first);
  await expect(page.locator('.pin-marker')).toHaveCount(first.map.pins.length);
  // The link now holds the opened map, and Back returns to the blank one.
  await written(page);
  await page.goBack();
  await expect(page.locator('#map-title')).toHaveValue('');
  await page.goForward();
  await expect(page.locator('#map-title')).toHaveValue(first.src);

  // Open loads the newest revision.
  await menu(page, 'library-open-menu');
  await page.locator('#library-list .fk-entries .fk-entry').getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.locator('#map-title')).toHaveValue(second.src);
  await expect.poll(() => snapshot(page)).toEqual(second);
});

test('a library export opened as a file goes to the library import', async ({ page, browser }) => {
  await open(page, './?example=stations');
  await written(page);
  const doc = await snapshot(page);
  await menu(page, 'library-save-as');
  await page.locator('#library-save-as-name').fill('Trains');
  await page.locator('#library-save-as-confirm').click();
  await expect(status(page)).toContainText('Saved as “Trains”');
  await menu(page, 'library-open-menu');
  await page.locator('#library-export-open').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#library-export-download').click()]);
  const file = await download.path();
  expect(await fs.readFile(file, 'utf8')).toContain('fragment-kit-library');

  const fresh = await browser.newContext({ ...test.info().project.use, serviceWorkers: 'block' });
  const other = await fresh.newPage();
  try {
    await blankTiles(other);
    await open(other, './');
    const [chooser] = await Promise.all([other.waitForEvent('filechooser'), menu(other, 'file-open')]);
    await chooser.setFiles(file);
    await expect(other.locator('#library-import-dialog')).toBeVisible();
    await other.locator('#library-import-file').setInputFiles(file);
    await other.locator('#library-import-preview').click();
    await expect(other.locator('#library-import-dialog .fk-entry', { hasText: 'Trains' })).toContainText('New');
    await other.locator('#library-import-commit').click();
    await expect(other.locator('#library-import-status')).toContainText('Imported 1 document');
    await other.locator('#library-import-dialog .fk-close').click();
    await other.locator('#library-list .fk-entries .fk-entry', { hasText: 'Trains' }).getByRole('button', { name: 'Open', exact: true }).click();
    await expect.poll(() => snapshot(other)).toEqual(doc);
  } finally { await fresh.close(); }
});
