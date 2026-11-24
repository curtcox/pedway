// Builds a new data snapshot from OpenStreetMap through Overpass and points
// data/current.json at it (see docs/data-history.md). Run by hand or from the
// monthly data-refresh workflow, then review the diff:
//   node scripts/build-data.mjs            # adds data/snapshots/<today>.json and its store files
//   node scripts/build-data.mjs --cache d  # also keeps raw Overpass replies in d/
//   node scripts/build-data.mjs --only poi # rebuild the places; other files come from the current snapshot
//   node scripts/build-data.mjs --only base  # rebuild the base map and intersections (docs/map-layers.md)
//   --only takes a comma-separated list of poi and base.
// Nothing is written when OpenStreetMap's answer matches the current snapshot.
// The browser never calls Overpass; it only loads the committed files.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { CHICAGO_BOUNDS } from '../src/map-defaults.js';
import { DATA_DIR, currentId, readSnapshot, writeSnapshot, geojsonText } from './snapshots.mjs';
import { BASE_QUERIES, buildBase } from './base-map.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const ATTRIBUTION = '© OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)';
const LOOP = '41.868,-87.645,41.895,-87.615';
const [[S, W], [N, E]] = CHICAGO_BOUNDS;
const CITY = `${S},${W},${N},${E}`;
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const ATTEMPTS = 9;
const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
const cacheDir = option('--cache'), only = option('--only');

// The oldest OpenStreetMap timestamp among the replies used, recorded as the snapshot's osmBase.
let osmBase;
const noteBase = json => {
  const base = json?.osm3s?.timestamp_osm_base;
  if (typeof base === 'string' && (!osmBase || base < osmBase)) osmBase = base;
  return json;
};
async function overpass(name, query) {
  if (cacheDir) {
    try { return noteBase(JSON.parse(await fs.readFile(path.join(cacheDir, `${name}.json`), 'utf8'))); } catch { /* fetch it */ }
  }
  let lastError;
  // Public Overpass servers are often busy: back off patiently (about 9 minutes in all) rather than hammer them.
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'User-Agent': 'pedway-tools-data-build' }, body: new URLSearchParams({ data: query }) });
      if (!response.ok) throw new Error(`${endpoint} answered ${response.status}`);
      const json = await response.json();
      if (cacheDir) { await fs.mkdir(cacheDir, { recursive: true }); await fs.writeFile(path.join(cacheDir, `${name}.json`), JSON.stringify(json)); }
      return noteBase(json);
    } catch (error) {
      lastError = error;
      console.error(`${name}: ${error.message}; retrying`);
      if (attempt < ATTEMPTS - 1) await new Promise(resolve => setTimeout(resolve, Math.min(90, 15 * (attempt + 1)) * 1000));
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

// --- Places: food, restrooms, stores, museums and parks near the Pedway ------

const NEAR = '41.862,-87.652,41.900,-87.608';
const POI_QUERY = `[out:json][timeout:180];
(
 nwr["amenity"~"^(restaurant|cafe|fast_food|food_court|ice_cream|toilets|pharmacy|arts_centre)$"](${NEAR});
 nwr["shop"~"^(supermarket|convenience|department_store|mall|chemist|greengrocer|bakery|deli)$"](${NEAR});
 nwr["tourism"~"^(museum|gallery)$"](${NEAR});
 nwr["leisure"~"^(park|garden)$"](${NEAR});
 nwr["place"="square"](${NEAR});
);
out center tags;`;

// Places farther than this from any Pedway vertex are left out, which keeps the
// file small and the map about the Pedway rather than the whole city.
// A place counts as "on the Pedway" when it is this close to a corridor, or a
// little farther when OpenStreetMap puts it below street level.
const POI_RADIUS_M = 400, ON_PEDWAY_M = 30, ON_PEDWAY_BELOW_M = 90;

export function poiCategory(tags) {
  const { amenity, shop, tourism, leisure, place } = tags;
  if (['restaurant', 'cafe', 'fast_food', 'food_court', 'ice_cream'].includes(amenity)) return ['food', amenity];
  if (['bakery', 'deli'].includes(shop)) return ['food', shop];
  if (amenity === 'toilets') return tags.access === 'private' || tags.access === 'no' ? null : ['restroom', 'toilets'];
  if (amenity === 'pharmacy' || shop === 'chemist') return ['store', 'pharmacy'];
  if (['supermarket', 'convenience', 'department_store', 'mall', 'greengrocer'].includes(shop)) return ['store', shop];
  if (['museum', 'gallery'].includes(tourism)) return ['museum', tourism];
  if (amenity === 'arts_centre') return ['museum', 'arts_centre'];
  if (['park', 'garden'].includes(leisure)) return ['park', leisure];
  if (place === 'square') return ['park', 'plaza'];
  return null;
}

export function buildPoi(elements, pedwayVertices) {
  // A coarse grid over the Pedway vertices makes the distance test fast.
  const cell = ([lat, lon]) => `${Math.floor(lat / 0.004)},${Math.floor(lon / 0.005)}`;
  const grid = new Map();
  for (const vertex of pedwayVertices) grid.set(cell(vertex), [...(grid.get(cell(vertex)) ?? []), vertex]);
  const nearest = at => {
    const [row, col] = cell(at).split(',').map(Number);
    let best = Infinity;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++)
      for (const vertex of grid.get(`${row + dr},${col + dc}`) ?? []) best = Math.min(best, metres(vertex, at));
    return best;
  };
  const seen = new Set();
  const features = elements.flatMap(e => {
    const tags = e.tags ?? {}, lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
    const found = poiCategory(tags);
    if (!found || lat === undefined) return [];
    const [category, kind] = found;
    // Restrooms are useful unnamed; anything else without a name is hard to find on the ground.
    if (!tags.name && category !== 'restroom') return [];
    const distance = nearest([lat, lon]);
    if (distance > POI_RADIUS_M) return [];
    const key = `${category}|${tags.name ?? ''}|${Math.round(lat * 2000)}|${Math.round(lon * 2000)}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      type: 'Feature', id: `${e.type[0]}${e.id}`,
      properties: clean({ category, kind, name: tags.name, hours: tags.opening_hours, level: tags.level,
        wheelchair: wheel(tags.wheelchair), pedway: distance <= (below(tags) ? ON_PEDWAY_BELOW_M : ON_PEDWAY_M) || undefined,
        osm: `${e.type}/${e.id}` }),
      geometry: point(lat, lon),
    }];
  }).sort((a, b) => a.properties.category.localeCompare(b.properties.category) || a.id.localeCompare(b.id));
  return collection('poi', features);
}

const CTA_LINES = ['Red', 'Blue', 'Brown', 'Green', 'Orange', 'Pink', 'Purple', 'Yellow'];
const ctaLine = tags => CTA_LINES.find(line => new RegExp(`\\b${line}\\b`, 'i').test(`${tags.name ?? ''} ${tags.ref ?? ''}`));
const metraLine = tags => (tags.ref || tags.name?.replace(/^Metra\s*/i, '').replace(/\s*[:(].*$/, '').replace(/\s*Line$/i, '').trim()) || null;

function builderCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 12);
  try { return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch { return undefined; }
}

const GROUPS = ['poi', 'base'];

async function main() {
  const built = {};
  let vertices, kept = {};
  const groups = only ? only.split(',') : GROUPS;
  if (!groups.length || groups.some(group => !GROUPS.includes(group))) throw new Error(`--only takes ${GROUPS.join(' and/or ')}, or leave it out to rebuild every file.`);
  if (only) {
    ({ texts: kept } = await readSnapshot(DATA_DIR, await currentId()));
    vertices = JSON.parse(kept.pedway).features.flatMap(f => f.geometry.coordinates.map(([lon, lat]) => [lat, lon]));
  } else {
    const raw = await overpass('pedway', PEDWAY_QUERY);
    let pedway;
    ({ pedway, access: built.access, vertices } = buildPedway(raw.elements));
    built.pedway = pedway;
    built.cta = buildStations('cta', (await overpass('cta', stationQuery('CTA'))).elements, vertices, ctaLine);
    built.metra = buildStations('metra', (await overpass('metra', stationQuery('Metra'))).elements, vertices, metraLine);
  }
  if (groups.includes('poi')) built.poi = buildPoi((await overpass('poi', POI_QUERY)).elements, vertices);
  if (groups.includes('base')) {
    const raw = {};
    for (const [name, query] of Object.entries(BASE_QUERIES)) raw[name] = await overpass(name, query);
    Object.assign(built, buildBase(raw, vertices.map(([lat, lon]) => [lon, lat])));
  }
  const texts = { ...kept, ...Object.fromEntries(Object.entries(built).map(([key, data]) => [key, geojsonText(data)])) };
  for (const [key, data] of Object.entries(built)) console.log(`${key}: ${data.features.length} features, ${(texts[key].length / 1024).toFixed(0)} KB`);
  if (built.pedway) {
    const km = built.pedway.features.reduce((sum, f) => sum + lengthOf(f.geometry.coordinates.map(([lon, lat]) => [lat, lon])), 0) / 1000;
    console.log(`Pedway length: ${km.toFixed(1)} km`);
  }
  if (built.poi) {
    const counts = Object.groupBy(built.poi.features, f => f.properties.category);
    console.log('Places: ' + Object.entries(counts).map(([category, list]) => `${category} ${list.length}`).join(', '));
  }
  const manifest = await writeSnapshot(DATA_DIR, texts, { osmBase, attribution: ATTRIBUTION,
    builder: { commit: builderCommit(), script: 'scripts/build-data.mjs' + (only ? ` --only ${only}` : '') } });
  console.log(manifest ? `Wrote snapshot ${manifest.id}; data/current.json now names it.` : 'OpenStreetMap data is unchanged; no new snapshot.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
