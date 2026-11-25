// Measuring script, part 2 (docs/map-layers.md, "Downtown GeoJSON base"): how long Leaflet takes to draw
// the base layers that base-survey.mjs wrote, on canvas renderers, in Chromium
// with Pixel 7 emulation and the CPU slowed down.
//   node scripts/base-survey-draw.mjs [--in _build/base-survey] [--throttle 4] [--runs 3]
// Needs `npx playwright install chromium`. Times are medians, in milliseconds.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const inDir = path.resolve(root, option('--in', '_build/base-survey'));
const throttle = Number(option('--throttle', '4')), runs = Number(option('--runs', '3'));
// --shot file.png saves the proposed copy at zoom 16, with labels, to look at.
const shot = option('--shot', null);
const LAYERS = ['water', 'green', 'rail', 'streets', 'buildings'];

// Each scenario: which copy of the data, the zoom, and whether labels are drawn.
const SCENARIOS = [
  { variant: 'low', zoom: 14, labels: true },
  { variant: 'proposed', zoom: 14, labels: true },
  { variant: 'full', zoom: 16, labels: true },
  { variant: 'proposed', zoom: 16, labels: true },
  { variant: 'proposed', zoom: 16, labels: false },
  { variant: 'proposed', zoom: 18, labels: true },
  // One layer at a time at zoom 16, and an empty map for Leaflet's own overhead.
  ...LAYERS.map(name => ({ variant: 'proposed', zoom: 16, labels: false, layers: [name] })),
  { variant: 'proposed', zoom: 16, labels: false, layers: [] },
];

async function texts(variant) {
  const out = {};
  for (const name of [...LAYERS, 'labels']) out[name] = await fs.readFile(path.join(inDir, variant, `${name}.geojson`), 'utf8');
  return out;
}

// Runs in the page. Returns parse, first-draw, pan and zoom times.
async function inPage({ data, zoom, labels, layers }) {
  const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const L = window.L, t = () => performance.now();
  const STYLE = {
    water: { stroke: false, fillColor: '#a9cfe8', fillOpacity: 1 },
    green: { stroke: false, fillColor: '#cfe8c2', fillOpacity: 1 },
    rail: { color: '#777', weight: 2 },
    streets: f => ({ color: f.properties.class === 'major' ? '#f2c76b' : '#ffffff', weight: { major: 6, minor: 4, service: 2, path: 1.5 }[f.properties.class] ?? 2, opacity: 1 }),
    buildings: f => ({ color: '#b8aea4', weight: 0.6, fillColor: f.properties.pedway ? '#c9d7ee' : '#ddd6ce', fillOpacity: 1 }),
  };
  let start = t();
  const parsed = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, JSON.parse(v)]));
  const parse = t() - start;

  const map = L.map('map', { center: [41.8837, -87.6278], zoom, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false, inertia: false });
  window.surveyMap = map;
  document.getElementById('map').style.background = '#f2efe9';
  await frames();
  start = t();
  ['water', 'green', 'rail', 'streets', 'buildings'].filter(name => layers.includes(name)).forEach((name, i) => {
    const pane = map.createPane(`base-${name}`); pane.style.zIndex = 250 + i * 10;
    const renderer = L.canvas({ pane: `base-${name}`, padding: 0.3 });
    L.geoJSON(parsed[name], { renderer, interactive: false, style: STYLE[name] }).addTo(map);
  });
  let labelLayer = null;
  const drawLabels = () => {
    labelLayer?.remove();
    const z = map.getZoom(), bounds = map.getBounds().pad(0.2);
    labelLayer = L.layerGroup(parsed.labels.features.filter(f => f.properties.minZoom <= z && bounds.contains([f.geometry.coordinates[1], f.geometry.coordinates[0]]))
      .map(f => L.marker([f.geometry.coordinates[1], f.geometry.coordinates[0]], { interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'lbl', html: `<span style="transform:rotate(${f.properties.angle ?? 0}deg)">${f.properties.text}</span>`, iconSize: null }) }))).addTo(map);
    return labelLayer.getLayers().length;
  };
  let labelCount = 0;
  if (labels) { labelCount = drawLabels(); map.on('moveend', drawLabels); }
  await frames();
  const first = t() - start;

  const pans = [];
  for (const [dx, dy] of [[300, 0], [0, 300], [-300, 0], [0, -300], [300, 300]]) {
    start = t();
    const moved = new Promise(resolve => map.once('moveend', resolve));
    map.panBy([dx, dy], { animate: false });
    await moved; await frames();
    pans.push(t() - start);
  }
  start = t();
  const zoomed = new Promise(resolve => map.once('zoomend', resolve));
  map.setZoom(zoom + 1, { animate: false });
  await zoomed; await frames();
  const zoomIn = t() - start;
  return { parse, first, pan: pans.sort((a, b) => a - b)[2], zoomIn, labelCount };
}

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const browser = await chromium.launch();
try {
  const leafletJs = path.join(root, 'vendor/leaflet-1.9.4/leaflet.js'), leafletCss = path.join(root, 'vendor/leaflet-1.9.4/leaflet.css');
  console.log(`Chromium, Pixel 7 emulation, CPU throttled ${throttle}×, median of ${runs} runs (ms).\n`);
  console.log('| Copy | Zoom | Layers | Parse JSON | First draw | Pan 300 px | Zoom in one step | Labels drawn |\n| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |');
  for (const scenario of SCENARIOS) {
    const data = await texts(scenario.variant);
    const results = [];
    for (let run = 0; run < runs; run++) {
      const context = await browser.newContext({ ...devices['Pixel 7'] });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await page.setContent('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body,#map{margin:0;height:100%}.lbl span{display:inline-block;white-space:nowrap;font:11px system-ui;color:#333;text-shadow:0 0 2px #fff}</style><div id="map"></div>');
      await page.addStyleTag({ path: leafletCss });
      await page.addScriptTag({ path: leafletJs });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
      results.push(await page.evaluate(inPage, { data, zoom: scenario.zoom, labels: scenario.labels, layers: scenario.layers ?? LAYERS }));
      if (shot && run === 0 && scenario.variant === 'proposed' && scenario.zoom === 16 && scenario.labels) {
        await page.evaluate(async () => {
          const map = window.surveyMap, zoomed = new Promise(resolve => map.once('zoomend', resolve));
          map.setView([41.8837, -87.6278], 16, { animate: false });
          await zoomed; await new Promise(resolve => setTimeout(resolve, 1500));
        });
        await page.screenshot({ path: path.resolve(root, shot) });
      }
      await context.close();
    }
    const m = key => Math.round(median(results.map(r => r[key])));
    console.log(`| ${scenario.variant} | ${scenario.zoom} | ${scenario.layers ? (scenario.layers.join(', ') || 'none (empty map)') : `all${scenario.labels ? ' + labels' : ''}`} | ${m('parse')} | ${m('first')} | ${m('pan')} | ${m('zoomIn')} | ${m('labelCount')} |`);
  }
} finally {
  await browser.close();
}
