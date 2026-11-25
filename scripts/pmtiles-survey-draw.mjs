// Measuring script, part 2 (docs/map-layers.md, "Citywide base from PMTiles"): how long protomaps-leaflet takes
// to draw the archives pmtiles-survey.mjs wrote, under the same conditions as
// base-survey-draw.mjs: Chromium, Pixel 7 emulation, CPU slowed down, the page's
// own Content Security Policy, and every request to another host refused.
//   node scripts/pmtiles-survey-draw.mjs [--in _build/pmtiles-survey] [--throttle 4] [--runs 3] [--shot file.png]
// The archive is served by a local server that answers HTTP range requests, as
// GitHub Pages does. Times are medians, in milliseconds.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const inDir = path.resolve(root, option('--in', '_build/pmtiles-survey'));
const throttle = Number(option('--throttle', '4')), runs = Number(option('--runs', '3'));
const shot = option('--shot', null);

const SCENARIOS = [
  { archive: 'city-z15', zoom: 12 },
  { archive: 'city-z15', zoom: 14 },
  { archive: 'city-z15', zoom: 16 },
  { archive: 'city-z15', zoom: 18 },
  { archive: 'city-z14', zoom: 16 },
  { archive: 'downtown-z15', zoom: 16 },
];

const FILES = {
  '/leaflet.js': path.join(root, 'vendor/leaflet-1.9.4/leaflet.js'),
  '/leaflet.css': path.join(root, 'vendor/leaflet-1.9.4/leaflet.css'),
  '/protomaps-leaflet.js': path.join(root, 'node_modules/protomaps-leaflet/dist/protomaps-leaflet.js'),
};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; object-src 'none'";
const PAGE = `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<link rel="stylesheet" href="/leaflet.css"><link rel="stylesheet" href="/page.css">
<div id="map"></div><script src="/leaflet.js"></script><script src="/protomaps-leaflet.js"></script>`;

const requests = { range: 0, bytes: 0 };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE); }
  if (url.pathname === '/page.css') { res.writeHead(200, { 'content-type': 'text/css' }); return res.end('html,body,#map{margin:0;height:100%}'); }
  const file = FILES[url.pathname] ?? (/^\/[\w-]+\.pmtiles$/.test(url.pathname) ? path.join(inDir, url.pathname.slice(1)) : null);
  if (!file) { res.writeHead(404); return res.end(); }
  const body = await fs.readFile(file);
  const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream';
  const match = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? '');
  if (match) {
    const start = Number(match[1]), end = Math.min(Number(match[2]), body.length - 1);
    requests.range++; requests.bytes += end - start + 1;
    res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${body.length}`, 'accept-ranges': 'bytes' });
    return res.end(body.subarray(start, end + 1));
  }
  res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes' });
  res.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

// Runs in the page: first draw (until every tile in view is drawn), pans, zoom in.
async function inPage({ archive, zoom }) {
  const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const L = window.L, t = () => performance.now();
  const map = L.map('map', { center: [41.8837, -87.6278], zoom, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false, inertia: false });
  window.surveyMap = map;
  await frames();
  let start = t();
  const layer = window.protomapsL.leafletLayer({ url: `/${archive}.pmtiles`, flavor: 'light', lang: 'en', maxDataZoom: Number(archive.split('-z')[1]) });
  const loaded = () => new Promise(resolve => layer.once('load', resolve));
  let wait = loaded();
  layer.addTo(map);
  await wait; await frames();
  const first = t() - start;
  const pans = [];
  for (const [dx, dy] of [[300, 0], [0, 300], [-300, 0], [0, -300], [300, 300]]) {
    start = t();
    wait = loaded();
    map.panBy([dx, dy], { animate: false });
    // A pan that needs no new tile fires no load; give it a moment.
    await Promise.race([wait, new Promise(resolve => setTimeout(resolve, 3000))]); await frames();
    pans.push(t() - start);
  }
  start = t();
  wait = loaded();
  map.setZoom(zoom + 1, { animate: false });
  await wait; await frames();
  const zoomIn = t() - start;
  return { first, pan: pans.sort((a, b) => a - b)[2], zoomIn };
}

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const browser = await chromium.launch();
try {
  console.log(`Chromium, Pixel 7 emulation, CPU throttled ${throttle}×, median of ${runs} runs (ms).\n`);
  console.log('| Archive | Zoom | First draw | Pan 300 px | Zoom in one step | Range requests | Bytes read |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const scenario of SCENARIOS) {
    const results = [], counts = [];
    for (let run = 0; run < runs; run++) {
      const context = await browser.newContext({ ...devices['Pixel 7'] });
      const outside = [], errors = [];
      await context.route(url => !url.href.startsWith(origin), route => { outside.push(route.request().url()); route.abort(); });
      const page = await context.newPage();
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(origin + '/');
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
      requests.range = 0; requests.bytes = 0;
      results.push(await page.evaluate(inPage, scenario));
      counts.push({ ...requests });
      if (outside.length || errors.length) console.error(`  ${scenario.archive} z${scenario.zoom}: outside requests ${JSON.stringify(outside)}, errors ${JSON.stringify(errors)}`);
      if (shot && run === 0 && scenario.archive === 'city-z15' && scenario.zoom === 16) {
        await page.evaluate(async () => {
          const map = window.surveyMap;
          map.setView([41.8837, -87.6278], 16, { animate: false });
          await new Promise(resolve => setTimeout(resolve, 2500));
        });
        await page.screenshot({ path: path.resolve(root, shot) });
      }
      await context.close();
    }
    const m = key => Math.round(median(results.map(r => r[key])));
    console.log(`| ${scenario.archive} | ${scenario.zoom} | ${m('first')} | ${m('pan')} | ${m('zoomIn')} | ${median(counts.map(c => c.range))} | ${Math.round(median(counts.map(c => c.bytes)) / 1024)} KiB |`);
  }
} finally {
  await browser.close();
  server.close();
}
