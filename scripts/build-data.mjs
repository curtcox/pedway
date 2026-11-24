// Builds data/*.geojson from OpenStreetMap through Overpass. Run by hand or
// from the monthly data-refresh workflow, then review the diff:
//   node scripts/build-data.mjs            # writes data/
//   node scripts/build-data.mjs --cache d  # also keeps raw Overpass replies in d/
// The browser never calls Overpass; it only loads the committed files.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHICAGO_BOUNDS } from '../src/map-defaults.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.join(root, 'data');
const ATTRIBUTION = '© OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)';
const LOOP = '41.868,-87.645,41.895,-87.615';
const [[S, W], [N, E]] = CHICAGO_BOUNDS;
const CITY = `${S},${W},${N},${E}`;
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const cacheDir = process.argv.includes('--cache') ? process.argv[process.argv.indexOf('--cache') + 1] : null;

async function overpass(name, query) {
  if (cacheDir) {
    try { return JSON.parse(await fs.readFile(path.join(cacheDir, `${name}.json`), 'utf8')); } catch { /* fetch it */ }
  }
  let lastError;
  for (let attempt = 0; attempt < 6; attempt++) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'User-Agent': 'pedway-tools-data-build' }, body: new URLSearchParams({ data: query }) });
      if (!response.ok) throw new Error(`${endpoint} answered ${response.status}`);
      const json = await response.json();
      if (cacheDir) { await fs.mkdir(cacheDir, { recursive: true }); await fs.writeFile(path.join(cacheDir, `${name}.json`), JSON.stringify(json)); }
      return json;
    } catch (error) {
      lastError = error;
      console.error(`${name}: ${error.message}; retrying`);
      await new Promise(resolve => setTimeout(resolve, 5000 * (attempt + 1)));
    }
  }
  throw lastError;
}

const round = value => Math.round(value * 1e6) / 1e6;
const metres = (a, b) => Math.hypot((a[0] - b[0]) * 111000, (a[1] - b[1]) * 82800);
const lengthOf = coords => coords.slice(1).reduce((sum, point, i) => sum + metres(coords[i], point), 0);
const collection = (name, features) => ({ type: 'FeatureCollection', name, attribution: ATTRIBUTION, features });
const point = (lat, lon) => ({ type: 'Point', coordinates: [round(lon), round(lat)] });
const below = tags => /^-/.test(tags.level ?? '') || /^-/.test(tags.layer ?? '');
const levelOf = tags => {
  const value = Number.parseFloat(tags.level ?? tags.layer ?? '0');
  return Number.isFinite(value) ? value : 0;
};
const wheel = value => ['yes', 'no', 'limited'].includes(value) ? value : undefined;
const clean = object => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== ''));

// --- Pedway corridors and the doors and lifts on them -----------------------

const PEDWAY_QUERY = `[out:json][timeout:120];
(
 way["name"~"[Pp]edway"](${LOOP});
 way["highway"~"footway|corridor|steps"]["level"~"^-"](${LOOP});
 way["highway"~"footway|corridor|steps"]["tunnel"](${LOOP});
 way["highway"~"footway|corridor|steps"]["layer"~"^-"](${LOOP});
 way["indoor"="corridor"](${LOOP});
)->.w;
.w out body geom;
node(w.w)(if: count_tags() > 0);
out body;`;

// Unnamed underground ways join the Pedway only when they link to a named
// Pedway way within this many hops and are short: stair runs, door passages
// and the last few metres into a building, not whole subway platforms.
const MAX_HOPS = 2, MAX_LINK_M = 120;

function pedwayWays(elements) {
  const ways = elements.filter(e => e.type === 'way' && e.geometry?.length > 1);
  const named = way => /pedway/i.test(way.tags.name ?? '');
  const excluded = way => /riverwalk|wacker/i.test(way.tags.name ?? '') || way.tags.highway === 'service' || way.tags.access === 'private';
  const byNode = new Map();
  ways.forEach((way, i) => way.nodes.forEach(id => byNode.set(id, [...(byNode.get(id) ?? []), i])));
  const chosen = new Set(ways.flatMap((way, i) => named(way) && !excluded(way) ? [i] : []));
  let frontier = [...chosen];
  for (let hop = 1; hop <= MAX_HOPS; hop++) {
    const next = [];
    for (const i of frontier) for (const id of ways[i].nodes) for (const j of byNode.get(id)) {
      const way = ways[j];
      if (chosen.has(j) || excluded(way) || !below(way.tags)) continue;
      if (lengthOf(way.geometry.map(g => [g.lat, g.lon])) > MAX_LINK_M) continue;
      chosen.add(j); next.push(j);
    }
    frontier = next;
  }
  return [...chosen].map(i => ways[i]);
}

function buildPedway(elements) {
  const ways = pedwayWays(elements);
  const features = ways.map(way => {
    const coords = way.geometry.map(g => [g.lat, g.lon]);
    const level = levelOf(way.tags);
    return {
      type: 'Feature', id: `w${way.id}`,
      properties: clean({
        kind: way.tags.highway === 'steps' ? 'steps' : 'corridor',
        level: level < 0 ? 'below' : level > 0 ? 'above' : 'street',
        name: /pedway/i.test(way.tags.name ?? '') ? undefined : way.tags.name,
        hours: way.tags.opening_hours,
        wheelchair: wheel(way.tags.wheelchair),
        osm: `way/${way.id}`,
      }),
      geometry: { type: 'LineString', coordinates: coords.map(([lat, lon]) => [round(lon), round(lat)]) },
    };
  }).sort((a, b) => a.id.localeCompare(b.id));

  const onPedway = new Set(ways.flatMap(way => way.nodes));
  const access = elements.filter(e => e.type === 'node' && onPedway.has(e.id)).flatMap(node => {
    const t = node.tags;
    const kind = t.highway === 'elevator' ? 'elevator' : t.railway === 'subway_entrance' ? 'station' : t.entrance && t.entrance !== 'emergency' ? 'entrance' : null;
    if (!kind) return [];
    return [{
      type: 'Feature', id: `n${node.id}`,
      properties: clean({
        kind, name: t.name ?? t.ref, level: t.level, hours: t.opening_hours,
        wheelchair: wheel(t.wheelchair), elevator: kind === 'elevator' ? 'yes' : undefined,
        osm: `node/${node.id}`,
      }),
      geometry: point(node.lat, node.lon),
    }];
  }).sort((a, b) => a.id.localeCompare(b.id));

  return { pedway: collection('pedway', features), access: collection('access', access), vertices: ways.flatMap(w => w.geometry.map(g => [g.lat, g.lon])) };
}

// --- Stations ----------------------------------------------------------------

const stationQuery = network => `[out:json][timeout:120];
(
 node["railway"="station"]["network"~"${network}"](${CITY});
 node["railway"="station"]["operator"~"${network}"](${CITY});
 way["railway"="station"]["network"~"${network}"](${CITY});
 way["railway"="station"]["operator"~"${network}"](${CITY});
)->.s;
.s out center tags;
rel["route"~"subway|light_rail|train"]["network"~"${network}"](${CITY})->.r;
.r out tags;
node(r.r)(${CITY});
out skel;
.r out skel;`;

function buildStations(name, elements, pedwayVertices, lineLabel) {
  const routes = elements.filter(e => e.type === 'relation' && e.tags);
  const skeletons = elements.filter(e => e.type === 'relation' && !e.tags);
  const nodes = new Map(elements.filter(e => e.type === 'node' && !e.tags).map(n => [n.id, [n.lat, n.lon]]));
  // Line name → the stop coordinates of every route relation with that line name.
  const stopsByLine = new Map();
  for (const route of routes) {
    const label = lineLabel(route.tags);
    if (!label) continue;
    const members = skeletons.find(r => r.id === route.id)?.members ?? [];
    const stops = members.filter(m => m.type === 'node' && nodes.has(m.ref)).map(m => nodes.get(m.ref));
    stopsByLine.set(label, [...(stopsByLine.get(label) ?? []), ...stops]);
  }
  const seen = new Set(), kept = [];
  const features = elements.filter(e => (e.type === 'node' || e.type === 'way') && e.tags?.railway === 'station').flatMap(station => {
    const lat = station.lat ?? station.center?.lat, lon = station.lon ?? station.center?.lon;
    const label = station.tags.name;
    if (!label || lat === undefined) return [];
    const at = [lat, lon];
    // The same station is sometimes mapped twice; keep the first.
    if (station.tags.wikidata && seen.has(station.tags.wikidata)) return [];
    if (kept.some(other => other.name === label && metres(other.at, at) < 60)) return [];
    if (station.tags.wikidata) seen.add(station.tags.wikidata);
    kept.push({ name: label, at });
    // A line serves the station when one of its stops is about as close as the nearest stop
    // of any line: downtown, other lines' stations are often only a block away.
    const distances = [...stopsByLine].map(([line, stops]) => [line, Math.min(...stops.map(stop => metres(stop, at)))]);
    const nearest = Math.min(...distances.map(([, d]) => d));
    const lines = distances.filter(([, d]) => d < 300 && d <= nearest + 80).map(([line]) => line).sort();
    const pedway = pedwayVertices.some(vertex => metres(vertex, at) < 90);
    return [{
      type: 'Feature', id: `${station.type[0]}${station.id}`,
      properties: clean({ name: label, lines: lines.length ? lines : undefined, wheelchair: wheel(station.tags.wheelchair), pedway: pedway || undefined, osm: `${station.type}/${station.id}` }),
      geometry: point(lat, lon),
    }];
  }).sort((a, b) => a.properties.name.localeCompare(b.properties.name) || a.id.localeCompare(b.id));
  return collection(name, features);
}

const CTA_LINES = ['Red', 'Blue', 'Brown', 'Green', 'Orange', 'Pink', 'Purple', 'Yellow'];
const ctaLine = tags => CTA_LINES.find(line => new RegExp(`\\b${line}\\b`, 'i').test(`${tags.name ?? ''} ${tags.ref ?? ''}`));
const metraLine = tags => (tags.ref || tags.name?.replace(/^Metra\s*/i, '').replace(/\s*[:(].*$/, '').replace(/\s*Line$/i, '').trim()) || null;

async function main() {
  const raw = await overpass('pedway', PEDWAY_QUERY);
  const { pedway, access, vertices } = buildPedway(raw.elements);
  const cta = buildStations('cta', (await overpass('cta', stationQuery('CTA'))).elements, vertices, ctaLine);
  const metra = buildStations('metra', (await overpass('metra', stationQuery('Metra'))).elements, vertices, metraLine);
  await fs.mkdir(OUT, { recursive: true });
  for (const [file, data] of Object.entries({ pedway, access, cta, metra })) {
    // One feature per line keeps monthly diffs readable.
    const body = `{"type":"FeatureCollection","name":${JSON.stringify(data.name)},"attribution":${JSON.stringify(data.attribution)},"features":[\n${data.features.map(f => JSON.stringify(f)).join(',\n')}\n]}\n`;
    await fs.writeFile(path.join(OUT, `${file}.geojson`), body);
    console.log(`${file}.geojson: ${data.features.length} features, ${(body.length / 1024).toFixed(0)} KB`);
  }
  const km = pedway.features.reduce((sum, f) => sum + lengthOf(f.geometry.coordinates.map(([lon, lat]) => [lat, lon])), 0) / 1000;
  console.log(`Pedway length: ${km.toFixed(1)} km`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
