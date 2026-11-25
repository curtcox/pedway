// Measuring script for docs/map-layers.md ("Downtown GeoJSON base"): fetches the self-hosted base map
// layers and the intersections data set for the downtown box from OpenStreetMap
// (Overpass), clips and simplifies them, and reports what they would cost.
//   node scripts/base-survey.mjs [--cache dir] [--out dir]
// The box is BASE_BOX in src/map-defaults.js; the builders are in base-map.mjs.
// Raw Overpass replies are kept in --cache (default _build/base-survey/raw) so a
// rerun needs no network. The GeoJSON goes to --out (default _build/base-survey);
// nothing is written to data/. Then measure drawing with base-survey-draw.mjs.
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { CHICAGO_BOUNDS } from '../src/map-defaults.js';
import { DATA_DIR, currentId, readSnapshot, geojsonText } from './snapshots.mjs';
import { BASE_QUERIES, BASE_SETTINGS, buildBaseLayers, intersections, vertexCount } from './base-map.mjs';
import { BASE_BOX } from '../src/map-defaults.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const outDir = path.resolve(root, option('--out', '_build/base-survey'));
const cacheDir = path.resolve(root, option('--cache', path.join(outDir, 'raw')));
const [[S, W], [N, E]] = BASE_BOX;
const BOX = `${S},${W},${N},${E}`;
const [[CS, CW], [CN, CE]] = CHICAGO_BOUNDS;
const CITY = `${CS},${CW},${CN},${CE}`;
const ATTRIBUTION = '© OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)';
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

async function overpass(name, query) {
  const file = path.join(cacheDir, `${name}.json`);
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { /* fetch it */ }
  let lastError;
  for (let attempt = 0; attempt < 6; attempt++) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'User-Agent': 'pedway-tools-base-survey' }, body: new URLSearchParams({ data: query }) });
      if (!response.ok) throw new Error(`${endpoint} answered ${response.status}`);
      const text = await response.text();
      const json = JSON.parse(text);
      if (json.remark && !json.elements?.length) throw new Error(json.remark);
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(file, text);
      console.error(`${name}: ${json.elements.length} elements, ${(text.length / 1024).toFixed(0)} KiB`);
      return json;
    } catch (error) {
      lastError = error;
      console.error(`${name}: ${error.message}; retrying`);
      await new Promise(resolve => setTimeout(resolve, 15000 * (attempt + 1)));
    }
  }
  throw lastError;
}


const KX = 111320 * Math.cos(((S + N) / 2) * Math.PI / 180), KY = 110570;
const clean = object => Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined && v !== '' && v !== false));
const feature = (id, properties, geometry) => ({ type: 'Feature', id, properties: clean(properties), geometry });
const QUERIES = { ...BASE_QUERIES,
  // Citywide major roads only: the corners an intersections data set would keep outside downtown.
  'major-city': `[out:json][timeout:180];\nway["highway"~"^(primary|secondary|tertiary|trunk)$"]["name"](${CITY});\nout body geom;` };
const buildLayers = buildBaseLayers;
// --- Report -------------------------------------------------------------------

const gzip = text => zlib.gzipSync(text, { level: 9 }).length;
const kib = bytes => `${(bytes / 1024).toFixed(1)} KiB`;
function measure(name, features) {
  const text = geojsonText({ name, attribution: ATTRIBUTION, features: features.filter(Boolean) });
  return { name, text, features: features.filter(Boolean).length, vertices: features.filter(Boolean).reduce((s, f) => s + vertexCount(f.geometry), 0), bytes: Buffer.byteLength(text), gzip: gzip(text) };
}
function table(title, rows) {
  const total = rows.reduce((t, r) => ({ features: t.features + r.features, vertices: t.vertices + r.vertices, bytes: t.bytes + r.bytes, gzip: t.gzip + r.gzip }), { features: 0, vertices: 0, bytes: 0, gzip: 0 });
  console.log(`\n${title}\n| Layer | Features | Vertices | Raw | gzip -9 |\n| --- | ---: | ---: | ---: | ---: |`);
  for (const r of [...rows, { name: '**Total**', ...total }]) console.log(`| ${r.name} | ${r.features.toLocaleString('en-US')} | ${r.vertices.toLocaleString('en-US')} | ${kib(r.bytes)} | ${kib(r.gzip)} |`);
  return total;
}

async function main() {
  const raw = {};
  for (const [name, query] of Object.entries(QUERIES)) raw[name] = await overpass(name, query);
  const { texts } = await readSnapshot(DATA_DIR, await currentId());
  const pedwayVertices = JSON.parse(texts.pedway).features.flatMap(f => f.geometry.coordinates);
  console.log(`Box ${BOX} (${((E - W) * KX / 1000).toFixed(2)} × ${((N - S) * KY / 1000).toFixed(2)} km). Raw Overpass replies:`);
  for (const name of Object.keys(QUERIES)) console.log(`  ${name}: ${raw[name].elements.length} elements, ${kib(JSON.stringify(raw[name]).length)}`);

  const variants = {
    // The full-detail copy, for zoom 16 and in.
    full: { places: 6, tolerance: { buildings: 0.5, streets: 1, water: 1, green: 1, rail: 1 }, minBuildingArea: 0 },
    // A lighter copy to compare: 5 decimal places (about 1 m) and coarser simplification.
    light: { places: 5, tolerance: { buildings: 1.5, streets: 2, water: 3, green: 2, rail: 2 }, minBuildingArea: 0 },
    // The proposal: full detail, without sidewalks, crossings, parking aisles and
    // driveways, green areas under 200 m², or osm ids; streets merged by name and class.
    proposed: BASE_SETTINGS,
    // What zooms below 16 would need: big buildings only, major streets only.
    low: { places: 5, tolerance: { buildings: 3, streets: 4, water: 5, green: 4, rail: 4 }, minBuildingArea: 400, majorOnly: true, minGreenArea: 1000, merge: true, noOsm: true },
  };
  await fs.mkdir(outDir, { recursive: true });
  const results = {};
  for (const [variant, settings] of Object.entries(variants)) {
    const layers = buildLayers(raw, pedwayVertices, settings);
    const rows = Object.entries(layers).map(([name, features]) => measure(name, features));
    results[variant] = { total: table(`### ${variant} (${settings.places} places; tolerance m ${JSON.stringify(settings.tolerance)}${settings.minBuildingArea ? `; buildings ≥ ${settings.minBuildingArea} m²` : ''}${settings.majorOnly ? '; major streets only' : ''})`, rows), rows: rows.map(({ text, ...r }) => r) };
    await fs.mkdir(path.join(outDir, variant), { recursive: true });
    for (const row of rows) await fs.writeFile(path.join(outDir, variant, `${row.name}.geojson`), row.text);
    if (variant === 'full') {
      const b = layers.buildings;
      console.log(`Buildings with pedway: true: ${b.filter(f => f.properties.pedway).length} of ${b.length}; named: ${b.filter(f => f.properties.name).length}.`);
      const lake = layers.water.find(f => f.properties.name === 'Lake Michigan');
      console.log(`Lake Michigan: ${lake ? `${lake.id}, ${vertexCount(lake.geometry)} vertices` : 'missing'}.`);
    }
  }

  // Intersections: every named corner downtown, and major × major corners citywide.
  const downtown = intersections(raw.streets.elements);
  const corners = downtown.map(c => feature(`n${c.id}`, { streets: c.streets, rank: c.rank, osm: `node/${c.id}` }, { type: 'Point', coordinates: c.point.map(v => Math.round(v * 1e6) / 1e6) }));
  const city = intersections(raw['major-city'].elements, { box: false, majorOnly: true });
  const cityRow = measure('intersections-city', city.map(c => feature(`n${c.id}`, { streets: c.streets, rank: c.rank, osm: `node/${c.id}` }, { type: 'Point', coordinates: c.point.map(v => Math.round(v * 1e6) / 1e6) })));
  const downtownRow = measure('intersections', corners);
  console.log(`\n### intersections\n| Set | Corners | Raw | gzip -9 |\n| --- | ---: | ---: | ---: |`);
  console.log(`| Downtown, every named corner (${corners.filter(c => c.properties.rank === 'major').length} major) | ${downtownRow.features} | ${kib(downtownRow.bytes)} | ${kib(downtownRow.gzip)} |`);
  console.log(`| Citywide, major × major | ${cityRow.features} | ${kib(cityRow.bytes)} | ${kib(cityRow.gzip)} |`);
  await fs.writeFile(path.join(outDir, 'full', 'intersections.geojson'), downtownRow.text);
  await fs.writeFile(path.join(outDir, 'survey.json'), JSON.stringify({ box: [S, W, N, E], results, intersections: { downtown: downtownRow.features, city: city.length } }, null, 2));
  console.log(`\nWrote ${path.relative(root, outDir)}/{full,light,proposed,low}/*.geojson and survey.json.`);
}

await main().catch(error => { console.error(error); process.exit(1); });
