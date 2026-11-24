import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { blankTiles, open, snapshot, written, menu } from './helpers.js';

test.beforeEach(({ page }) => blankTiles(page));
const appStatus = page => page.locator('#app-status');
async function exportFile(page, id) {
  await menu(page, 'export-open');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator(`#${id}`).click()]);
  await page.locator('#export-dialog .fk-close').click();
  return { name: download.suggestedFilename(), text: await fs.readFile(await download.path(), 'utf8') };
}
async function openFile(page, name, text, mimeType = 'application/json') {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), menu(page, 'file-open')]);
  await chooser.setFiles({ name, mimeType, buffer: Buffer.from(text) });
}

test('a map exported as a file or GeoJSON opens again unchanged', async ({ page }) => {
  await open(page, './?example=meet');
  await written(page);
  const doc = await snapshot(page);
  const json = await exportFile(page, 'export-json');
  expect(json.name).toMatch(/\.json$/);
  expect(JSON.parse(json.text)).toMatchObject({ type: 'pedway-map', src: doc.src });
  const geojson = await exportFile(page, 'export-geojson');
  expect(geojson.name).toMatch(/\.geojson$/);
  const collection = JSON.parse(geojson.text);
  expect(collection.type).toBe('FeatureCollection');
  expect(collection.features.map(f => f.properties.name)).toEqual(doc.map.pins.map(pin => pin.label));

  for (const file of [json, geojson]) {
    await open(page, './');
    await openFile(page, file.name, file.text);
    await expect(appStatus(page)).toContainText(`Opened ${file.name}`);
    await expect.poll(() => snapshot(page)).toEqual(doc);
    await expect(page.locator('#map-title')).toHaveValue(doc.src);
    await written(page);
    // Opening a file is a new history entry.
    await page.goBack();
    await expect(page.locator('#map-title')).toHaveValue('');
  }
});

test('GeoJSON from another tool can be added to the current map', async ({ page }) => {
  await open(page, './?example=meet');
  await written(page);
  const before = await snapshot(page);
  const geojson = JSON.stringify({ type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-87.6278, 41.8837] }, properties: { name: 'Coffee', description: 'Open *early*', 'marker-color': '#2e7d32' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-87.6403, 41.8826] }, properties: { title: 'Ogilvie' } },
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[-87.63, 41.88], [-87.62, 41.88]] }, properties: {} },
  ] });
  await openFile(page, 'coffee.geojson', geojson, 'application/geo+json');
  await expect(page.locator('#geojson-choice')).toBeVisible();
  await page.locator('#geojson-add').click();
  await expect(appStatus(page)).toContainText('Added 2 pins from coffee.geojson. Left out 1 feature that is not a point.');
  await expect(page.locator('.pin-marker')).toHaveCount(before.map.pins.length + 2);
  const after = await snapshot(page);
  expect(after.src).toBe(before.src);
  expect(after.map.pins.slice(-2).map(pin => [pin.label, pin.md, pin.color])).toEqual([['Coffee', 'Open *early*', '#2e7d32'], ['Ogilvie', '', '#c0392b']]);

  // The same file can instead become a new map titled after the file.
  await openFile(page, 'coffee.geojson', geojson, 'application/geo+json');
  await page.locator('#geojson-new').click();
  await expect(page.locator('#map-title')).toHaveValue('coffee');
  await expect(page.locator('.pin-marker')).toHaveCount(2);
});

test('unreadable files are refused and the map stays as it was', async ({ page }) => {
  await open(page, './?example=meet');
  const before = await snapshot(page);
  await openFile(page, 'notes.txt', 'hello', 'text/plain');
  await expect(appStatus(page)).toContainText('Could not open notes.txt: This file is not a Pedway map or GeoJSON file.');
  await openFile(page, 'evil.json', JSON.stringify({ src: 'x', map: { pins: [{ id: 'a', at: 'dp3wq', md: 'x', onclick: 'alert(1)' }] } }));
  await expect(appStatus(page)).toContainText('Unknown pin field: onclick');
  await openFile(page, 'faraway.geojson', JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [2.35, 48.85] }, properties: {} }));
  await expect(appStatus(page)).toContainText('faraway.geojson has no points in the Chicago area. Left out 1 outside the Chicago area.');
  expect(await snapshot(page)).toEqual(before);
});

test('a file dropped on the map opens', async ({ page }) => {
  await open(page, './');
  const text = JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [-87.6278, 41.8837] }, properties: { name: 'Dropped' } });
  await page.evaluate(text => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], 'drop.geojson', { type: 'application/geo+json' }));
    const target = document.getElementById('map');
    for (const type of ['dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, text);
  await expect(page.locator('#map-title')).toHaveValue('drop');
  await expect.poll(async () => (await snapshot(page)).map.pins.map(pin => pin.label)).toEqual(['Dropped']);
});
