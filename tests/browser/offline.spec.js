// "Works in airplane mode after the first visit": stage the site exactly as it
// deploys, serve it under /pedway/ like GitHub Pages, visit once, go offline, reload.
import { test, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stage } from '../../scripts/stage.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const TYPES = { html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', geojson: 'application/geo+json', svg: 'image/svg+xml', png: 'image/png' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
let server, site, base, down = false;

test.use({ serviceWorkers: 'allow' });
test.setTimeout(120000);
test.beforeAll(async ({}, info) => {
  site = await stage(`.offline-test-${process.pid}-${info.workerIndex}`);
  server = http.createServer(async (request, response) => {
    // "Down" drops the connection, like a network with no signal.
    if (down) return request.socket.destroy();
    const url = new URL(request.url, 'http://localhost');
    if (!url.pathname.startsWith('/pedway/')) { response.writeHead(404); return response.end(); }
    const file = path.join(site, decodeURIComponent(url.pathname.slice('/pedway/'.length)) || 'index.html');
    if (!file.startsWith(site)) { response.writeHead(403); return response.end(); }
    try {
      const body = await fs.readFile(file);
      response.writeHead(200, { 'Content-Type': TYPES[path.extname(file).slice(1)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
      response.end(body);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/pedway/`;
});
test.afterAll(async () => {
  await new Promise(resolve => { server?.closeAllConnections(); server?.close(resolve); });
  if (site?.startsWith(root)) await fs.rm(site, { recursive: true, force: true });
});

test('after one visit the map, its data, the downtown map and seen tiles work in airplane mode', async ({ page, context, browserName }) => {
  let tileRequests = 0;
  await context.route('https://tile.openstreetmap.org/**', route => { tileRequests++; return down ? route.abort('internetdisconnected') : route.fulfill({ contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: PNG }); });
  await page.goto(base + '?example=meet');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#offline-status')).toHaveText('Available offline', { timeout: 60000 });
  // A view across the south edge of the downtown box: the downtown map draws inside it, tiles outside.
  const href = await page.evaluate(() => pedway.urlState.build({ ...pedway.snapshot(), map: { ...pedway.snapshot().map, view: { c: [41.8665, -87.6278], z: 15 } } }).href);
  await page.goto(href);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  // Once the worker controls the page, the tiles it draws are kept.
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect.poll(() => page.evaluate(async () => (await (await caches.open('pedway-tiles-v1')).keys()).length), { timeout: 20000 }).toBeGreaterThan(0);
  const doc = await page.evaluate(() => pedway.snapshot());

  // Playwright's offline mode in Firefox fails navigations before the service worker
  // sees them, which real Firefox does not do; there the dropped server stands in.
  down = true;
  if (browserName !== 'firefox') await context.setOffline(true);
  try {
    const seen = tileRequests;
    await page.goto(href);
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    expect(await page.evaluate(() => pedway.snapshot())).toEqual(doc);
    await expect(page.locator('.pin-marker')).toHaveCount(doc.map.pins.length);
    await expect.poll(() => page.evaluate(() => pedway.data.features.get('pedway')?.length ?? 0)).toBeGreaterThan(10);
    await expect(page.locator('#map .leaflet-tile-loaded').first()).toBeVisible();
    // The downtown map comes from the offline copy too (when the snapshot has one).
    if (await page.evaluate(() => pedway.data.baseMap.available)) {
      await page.evaluate(() => pedway.data.baseMap.ready());
      expect(await page.evaluate(() => pedway.data.baseMap.groups.get('streets').getLayers().length)).toBe(1);
      await expect(page.locator('.leaflet-base-streets-pane canvas')).toBeAttached();
    }
    expect(tileRequests).toBe(seen);
    await expect(page.locator('#app-status')).not.toContainText('could not be loaded');
    // A blank map opens offline too, and the library still works.
    await page.goto(base);
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('#library-save')).toBeAttached();
  } finally { down = false; await context.setOffline(false); }
});

test('a damaged offline file is detected and Repair fetches it again', async ({ page }) => {
  await page.goto(base);
  await expect(page.locator('#offline-status')).toHaveText('Available offline', { timeout: 60000 });
  await page.evaluate(async () => {
    const name = (await caches.keys()).find(name => /^pedway-[0-9a-f]{16}$/.test(name));
    await (await caches.open(name)).put(new URL('style.css', location.href), new Response('tampered'));
  });
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  // A bad copy is never served: the worker refetches it.
  expect(await page.evaluate(() => fetch('style.css').then(response => response.text()))).not.toBe('tampered');
  await page.locator('.fk-more').click();
  await page.locator('#offline-repair').click();
  await expect(page.locator('#offline-status')).toHaveText('Available offline', { timeout: 60000 });
});
