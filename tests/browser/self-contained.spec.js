// A self-contained copy (stage --self-contained, docs/map-layers.md L6) contacts no
// server but its own: every other request fails this test.
import { test, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stage } from '../../scripts/stage.mjs';
import { computeCID } from '../../vendor/fragment-kit-v0.5.0/src/core/cid.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const TYPES = { html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', geojson: 'application/geo+json', svg: 'image/svg+xml', png: 'image/png' };
let server, site, base;

test.setTimeout(90000);
test.beforeAll(async ({}, info) => {
  site = await stage(`.stage-test-self-${process.pid}-${info.workerIndex}`, { selfContained: true });
  server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const file = path.join(site, decodeURIComponent(url.pathname.slice(1)) || 'index.html');
    if (!file.startsWith(site)) { response.writeHead(403); return response.end(); }
    try {
      const body = await fs.readFile(file);
      response.writeHead(200, { 'Content-Type': TYPES[path.extname(file).slice(1)] ?? 'application/octet-stream' });
      response.end(body);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
});
test.afterAll(async () => {
  await new Promise(resolve => { server?.closeAllConnections(); server?.close(resolve); });
  if (site?.startsWith(root)) await fs.rm(site, { recursive: true, force: true });
});

test('the self-contained copy names no other host and draws everything from its own files', async ({ page, context }) => {
  const outside = [];
  await context.route(url => !url.href.startsWith(base) && !url.protocol.startsWith('data') && !url.protocol.startsWith('blob'), route => {
    outside.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  const html = await fs.readFile(path.join(site, 'index.html'), 'utf8');
  expect(html).not.toMatch(/Content-Security-Policy[^>]*https:/);
  expect(await fs.readFile(path.join(site, 'src/deployment.js'), 'utf8')).toContain('SELF_CONTAINED = true');

  // Every overlay on, zoomed out past the downtown box: still nothing from outside.
  await page.goto(base);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const href = await page.evaluate(() => pedway.urlState.build({ src: '', map: { base: 'both', overlays: { latlon: true, geohash: true, usng: true, grid: true } } }).href);
  await page.goto(href);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(async () => { await pedway.data.loaded; await pedway.data.baseMap.ready(); });
  await expect(page.locator('.leaflet-base-streets-pane canvas')).toBeAttached();
  await expect(page.locator('.leaflet-tile-pane .leaflet-layer')).toHaveCount(0);
  expect(await page.evaluate(() => pedway.data.features.get('pedway').length)).toBeGreaterThan(100);
  await expect(page.locator('.coord-usng').first()).toBeAttached();
  await expect(page.locator('.corner-label').first()).toBeAttached();
  await page.evaluate(() => { pedway.map.setZoom(12, { animate: false }); });
  await page.waitForTimeout(300);

  // The panel offers only the downtown map or none.
  await page.locator('#layers-open').click();
  await expect(page.locator('#base-mode option')).toHaveText(['Downtown map only (no outside servers)', 'None']);
  await expect(page.locator('#base-mode')).toHaveValue('local');
  // WebKit does not focus a tapped button, so close the panel the way it opened.
  await page.locator('#layers-open').click();
  await expect(page.locator('#layers-panel')).toBeHidden();

  // Search works offline-style and never asks OpenStreetMap.
  await page.locator('#search-input').fill('Clark & Lake');
  await page.locator('#search-go').click();
  await expect(page.locator('.search-hit h3')).toHaveText('Clark St & Lake St');
  await page.locator('#search-input').fill('1060 W Addison St Wrigley');
  await page.locator('#search-go').click();
  await expect(page.locator('#search-note')).toContainText('contacts no other server');

  // HashBin links explain themselves rather than fetching.
  await page.goto(base + '#' + await computeCID('a saved map'.repeat(10)));
  await expect(page.locator('#app-status')).toContainText('cannot open maps saved to HashBin');
  expect(outside).toEqual([]);
});
