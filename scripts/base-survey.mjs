// L0 measuring spike for docs/map-layers.md: fetches the self-hosted base map
// layers and the intersections data set for the downtown box from OpenStreetMap
// (Overpass), clips and simplifies them, and reports what they would cost.
//   node scripts/base-survey.mjs [--cache dir] [--out dir] [--box S,W,N,E]
// Raw Overpass replies are kept in --cache (default _build/base-survey/raw) so a
// rerun needs no network. The GeoJSON goes to --out (default _build/base-survey);
// nothing is written to data/. Then measure drawing with base-survey-draw.mjs.
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { CHICAGO_BOUNDS } from '../src/map-defaults.js';
import { DATA_DIR, currentId, readSnapshot, geojsonText } from './snapshots.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const outDir = path.resolve(root, option('--out', '_build/base-survey'));
const cacheDir = path.resolve(root, option('--cache', path.join(outDir, 'raw')));
// Chicago Ave to Roosevelt Rd, Halsted St to the lake (past the end of Navy Pier).
const [S, W, N, E] = option('--box', '41.8665,-87.6480,41.8975,-87.5950').split(',').map(Number);
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

// --- Geometry: local metres, clipping, simplification, rings ----------------

const KX = 111320 * Math.cos(((S + N) / 2) * Math.PI / 180), KY = 110570;
const metres = (a, b) => Math.hypot((a[0] - b[0]) * KX, (a[1] - b[1]) * KY);   // points are [lon, lat]
const lengthOf = line => line.slice(1).reduce((sum, p, i) => sum + metres(line[i], p), 0);
const inBox = ([x, y]) => x >= W && x <= E && y >= S && y <= N;

function simplify(points, tolerance) {
  if (points.length < 3 || tolerance <= 0) return points;
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = [points[a][0] * KX, points[a][1] * KY], [bx, by] = [points[b][0] * KX, points[b][1] * KY];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let worst = -1, at = -1;
    for (let i = a + 1; i < b; i++) {
      const px = points[i][0] * KX, py = points[i][1] * KY;
      const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const d = Math.hypot(px - ax - t * dx, py - ay - t * dy);
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > tolerance) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return points.filter((_, i) => keep[i]);
}
// A closed ring keeps at least four points (a triangle) after simplification.
function simplifyRing(ring, tolerance) {
  const out = simplify(ring, tolerance);
  return out.length >= 4 ? out : ring.length >= 4 ? ring : null;
}

// Sutherland–Hodgman against the box (convex), for one closed ring.
function clipRing(ring) {
  if (ring.every(inBox)) return ring;
  const edges = [[p => p[0] >= W, (a, b) => cut(a, b, 0, W)], [p => p[0] <= E, (a, b) => cut(a, b, 0, E)],
    [p => p[1] >= S, (a, b) => cut(a, b, 1, S)], [p => p[1] <= N, (a, b) => cut(a, b, 1, N)]];
  let points = ring.slice(0, -1);
  for (const [inside, cross] of edges) {
    const next = [];
    for (let i = 0; i < points.length; i++) {
      const cur = points[i], prev = points[(i + points.length - 1) % points.length];
      if (inside(cur)) { if (!inside(prev)) next.push(cross(prev, cur)); next.push(cur); }
      else if (inside(prev)) next.push(cross(prev, cur));
    }
    points = next;
    if (!points.length) return null;
  }
  return points.length >= 3 ? [...points, points[0]] : null;
}
function cut(a, b, axis, value) {
  const t = (value - a[axis]) / (b[axis] - a[axis]);
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}
// Liang–Barsky per segment; returns the parts of a line inside the box.
function clipLine(line) {
  if (line.every(inBox)) return [line];
  const parts = []; let part = null;
  for (let i = 1; i < line.length; i++) {
    const seg = clipSegment(line[i - 1], line[i]);
    if (!seg) { if (part) parts.push(part); part = null; continue; }
    if (part && part[part.length - 1][0] === seg[0][0] && part[part.length - 1][1] === seg[0][1]) part.push(seg[1]);
    else { if (part) parts.push(part); part = [...seg]; }
    if (seg[1] !== line[i]) { parts.push(part); part = null; }
  }
  if (part) parts.push(part);
  return parts.filter(p => p.length > 1);
}
function clipSegment(a, b) {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - W], [dx, E - a[0]], [-dy, a[1] - S], [dy, N - a[1]]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  const at = t => [a[0] + t * dx, a[1] + t * dy];
  return [t0 === 0 ? a : at(t0), t1 === 1 ? b : at(t1)];
}
// Joins ways (lists of [lon, lat]) end to end into chains; closed chains are rings.
function joinWays(ways) {
  const key = p => `${p[0]},${p[1]}`;
  const pool = ways.map(w => [...w]), chains = [];
  while (pool.length) {
    let chain = pool.pop(), grew = true;
    while (grew && key(chain[0]) !== key(chain[chain.length - 1])) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i], head = key(chain[0]), tail = key(chain[chain.length - 1]);
        if (key(w[0]) === tail) chain = [...chain, ...w.slice(1)];
        else if (key(w[w.length - 1]) === tail) chain = [...chain, ...w.slice(0, -1).reverse()];
        else if (key(w[w.length - 1]) === head) chain = [...w, ...chain.slice(1)];
        else if (key(w[0]) === head) chain = [...w.slice(1).reverse(), ...chain];
        else continue;
        pool.splice(i, 1); grew = true; break;
      }
    }
    chains.push(chain);
  }
  return chains;
}
const geomOf = way => way.geometry?.filter(Boolean).map(g => [g.lon, g.lat]) ?? [];
const closed = ring => ring.length >= 4 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
const signedArea = ring => ring.slice(1).reduce((sum, p, i) => sum + (ring[i][0] * KX) * (p[1] * KY) - (p[0] * KX) * (ring[i][1] * KY), 0) / 2;

/** Polygons ([outer, ...holes] lists) for a closed way or a multipolygon relation. */
function polygonsOf(element) {
  if (element.type === 'way') { const ring = geomOf(element); return closed(ring) ? [[ring]] : []; }
  const rings = role => joinWays(element.members.filter(m => m.type === 'way' && (m.role || 'outer') === role).map(geomOf).filter(g => g.length > 1)).filter(closed);
  const outers = rings('outer'), inners = rings('inner');
  return outers.map(outer => [outer, ...inners.filter(inner => pointInRing(inner[0], outer))]);
}
function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Clips, simplifies and rounds polygons into one GeoJSON geometry, or null. */
function polygonGeometry(polygons, tolerance, minArea = 0) {
  const parts = [];
  for (const [outer, ...holes] of polygons) {
    const o = clipRing(outer);
    if (!o || Math.abs(signedArea(o)) < minArea) continue;
    const so = simplifyRing(o, tolerance);
    if (!so) continue;
    parts.push([so, ...holes.map(clipRing).filter(Boolean).map(h => simplifyRing(h, tolerance)).filter(Boolean)]);
  }
  if (!parts.length) return null;
  return parts.length === 1 ? { type: 'Polygon', coordinates: parts[0] } : { type: 'MultiPolygon', coordinates: parts };
}
function lineGeometry(lines, tolerance) {
  const parts = lines.flatMap(clipLine).map(l => simplify(l, tolerance)).filter(l => l.length > 1);
  if (!parts.length) return null;
  return parts.length === 1 ? { type: 'LineString', coordinates: parts[0] } : { type: 'MultiLineString', coordinates: parts };
}
function roundGeometry(geometry, places) {
  const f = 10 ** places, r = v => Math.round(v * f) / f;
  const walk = c => typeof c[0] === 'number' ? [r(c[0]), r(c[1])] : c.map(walk);
  return { ...geometry, coordinates: walk(geometry.coordinates) };
}
const vertexCount = geometry => { const walk = c => typeof c[0] === 'number' ? 1 : c.reduce((s, x) => s + walk(x), 0); return walk(geometry.coordinates); };
const clean = object => Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined && v !== '' && v !== false));
const feature = (id, properties, geometry) => ({ type: 'Feature', id, properties: clean(properties), geometry });

// --- Queries ------------------------------------------------------------------

const Q = body => `[out:json][timeout:180];\n${body}`;
const QUERIES = {
  buildings: Q(`(way["building"](${BOX}); rel["building"]["type"="multipolygon"](${BOX}););\nout body geom;`),
  streets: Q(`way["highway"](${BOX});\nout body geom;`),
  water: Q(`(way["natural"="water"](${BOX}); rel["natural"="water"](${BOX}); way["waterway"="riverbank"](${BOX}); way["natural"="coastline"](${BOX}););\nout body geom;`),
  green: Q(`(way["leisure"~"^(park|garden|playground|dog_park)$"](${BOX}); rel["leisure"~"^(park|garden)$"](${BOX});
 way["landuse"~"^(grass|recreation_ground|village_green|flowerbed)$"](${BOX}); way["natural"~"^(wood|scrub|grassland|beach)$"](${BOX}););\nout body geom;`),
  rail: Q(`way["railway"~"^(subway|light_rail|rail|monorail|tram|narrow_gauge)$"](${BOX})->.w;\n.w out body geom;\nrel(bw.w)["route"~"^(subway|light_rail|train|railway)$"];\nout body;`),
  // Citywide major roads only: the corners the intersections data set would keep outside downtown.
  'major-city': Q(`way["highway"~"^(primary|secondary|tertiary|trunk)$"]["name"](${CITY});\nout body geom;`),
};

// --- Layers -------------------------------------------------------------------

const ROAD_CLASS = {
  motorway: 'major', trunk: 'major', primary: 'major', secondary: 'major', tertiary: 'major',
  motorway_link: 'major', trunk_link: 'major', primary_link: 'major', secondary_link: 'major', tertiary_link: 'major',
  residential: 'minor', unclassified: 'minor', living_street: 'minor', road: 'minor',
  service: 'service',
  pedestrian: 'path', footway: 'path', path: 'path', cycleway: 'path', steps: 'path', track: 'path', bridleway: 'path',
};
const below = tags => /^-/.test(tags.level ?? '') || /^-/.test(tags.layer ?? '');
// Footways inside buildings and underground belong to the Pedway layer, not the street map.
const streetWay = tags => ROAD_CLASS[tags.highway] && !tags.indoor && tags.highway !== 'corridor'
  && !(ROAD_CLASS[tags.highway] === 'path' && (below(tags) || tags.tunnel === 'building_passage' || tags.level));
// Sidewalks and crossings repeat the street they belong to; parking aisles and driveways are clutter.
const minorDetail = tags => ['sidewalk', 'crossing', 'traffic_island'].includes(tags.footway)
  || ['parking_aisle', 'driveway', 'drive-through'].includes(tags.service);
const bareName = name => name?.replace(/^(North|South|East|West|N|S|E|W)\.? /, '').replace(/ (Street|Avenue|Drive|Boulevard|Road|Place|Court|Parkway|Plaza|Lane|Way|Terrace)$/, '') ?? null;

function buildLayers(raw, pedwayVertices, settings) {
  const { tolerance, places } = settings;
  const out = {};
  const finish = (geometry, id, properties) => geometry ? feature(id, settings.noOsm ? { ...properties, osm: undefined } : properties, roundGeometry(geometry, places)) : null;

  // Buildings, with pedway: true when a Pedway vertex is inside or within 8 m of the outline.
  const nearPedway = (polygons) => {
    const ring = polygons[0]?.[0]; if (!ring) return false;
    const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
    const pad = 0.0001, box = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
    return pedwayVertices.some(v => v[0] >= box[0] && v[0] <= box[2] && v[1] >= box[1] && v[1] <= box[3]
      && (pointInRing(v, ring) || ring.some((p, i) => i && distanceToSegment(v, ring[i - 1], p) < 8)));
  };
  out.buildings = raw.buildings.elements.flatMap(e => {
    const polygons = polygonsOf(e);
    const levels = Number.parseInt(e.tags['building:levels'], 10);
    const f = finish(polygonGeometry(polygons, tolerance.buildings, settings.minBuildingArea), `${e.type[0]}${e.id}`, {
      name: e.tags.name, levels: Number.isFinite(levels) ? levels : undefined, pedway: nearPedway(polygons) || undefined, osm: `${e.type}/${e.id}` });
    return f ? [f] : [];
  });

  const streets = raw.streets.elements.filter(e => e.type === 'way' && streetWay(e.tags) && (!settings.majorOnly || ROAD_CLASS[e.tags.highway] === 'major') && !(settings.dropDetail && minorDetail(e.tags)));
  out.streets = streets.flatMap(e => {
    const area = e.tags.area === 'yes' && closed(geomOf(e));
    const f = finish(area ? polygonGeometry([[geomOf(e)]], tolerance.streets) : lineGeometry([geomOf(e)], tolerance.streets), `w${e.id}`, {
      name: e.tags.name, class: ROAD_CLASS[e.tags.highway], bridge: e.tags.bridge ? 'yes' : undefined,
      tunnel: e.tags.tunnel && e.tags.tunnel !== 'no' ? 'yes' : undefined, layer: e.tags.layer && e.tags.layer !== '0' ? Number(e.tags.layer) || undefined : undefined,
      oneway: e.tags.oneway === 'yes' || undefined, osm: `way/${e.id}` });
    return f ? [f] : [];
  });
  if (settings.merge) out.streets = mergeLines(out.streets);

  // Water: lakes and the river as polygons, plus Lake Michigan closed from the coastline.
  const waterElements = raw.water.elements.filter(e => e.tags?.natural !== 'coastline');
  out.water = waterElements.flatMap(e => {
    const f = finish(polygonGeometry(polygonsOf(e), tolerance.water, 20), `${e.type[0]}${e.id}`, { name: e.tags.name, kind: e.tags.water ?? e.tags.waterway ?? 'water', osm: `${e.type}/${e.id}` });
    return f ? [f] : [];
  });
  const coast = raw.water.elements.filter(e => e.tags?.natural === 'coastline').map(geomOf);
  const lake = lakeFromCoastline(coast);
  if (lake.length) out.water.unshift(finish(polygonGeometry(lake.map(r => [r]), tolerance.water), 'lake', { name: 'Lake Michigan', kind: 'lake', osm: 'coastline' }));

  out.green = raw.green.elements.flatMap(e => {
    const f = finish(polygonGeometry(polygonsOf(e), tolerance.green, settings.minGreenArea ?? 30), `${e.type[0]}${e.id}`, {
      name: e.tags.name, kind: e.tags.leisure ?? e.tags.landuse ?? e.tags.natural, osm: `${e.type}/${e.id}` });
    return f ? [f] : [];
  });

  // Rail, with the CTA lines and Metra lines whose route relations use each way.
  const linesByWay = new Map();
  for (const rel of raw.rail.elements.filter(e => e.type === 'relation')) {
    const name = /CTA|Chicago Transit/i.test(`${rel.tags.network} ${rel.tags.operator}`) ? (rel.tags.colour && rel.tags.name?.match(/^(\w+) Line/)?.[1] || rel.tags.ref)
      : /Metra/i.test(`${rel.tags.network} ${rel.tags.operator}`) ? (rel.tags.ref ?? rel.tags.name) : null;
    if (!name) continue;
    for (const m of rel.members.filter(m => m.type === 'way')) linesByWay.set(m.ref, new Set([...(linesByWay.get(m.ref) ?? []), name]));
  }
  out.rail = raw.rail.elements.filter(e => e.type === 'way' && !['yard', 'siding', 'spur', 'crossover'].includes(e.tags.service) || (e.type === 'way' && linesByWay.has(e.id))).flatMap(e => {
    const kind = e.tags.railway === 'subway' || e.tags.tunnel ? 'subway' : e.tags.bridge || e.tags.layer > 0 ? 'elevated' : 'surface';
    const f = finish(lineGeometry([geomOf(e)], tolerance.rail), `w${e.id}`, { kind, railway: e.tags.railway, lines: linesByWay.has(e.id) ? [...linesByWay.get(e.id)].sort() : undefined, osm: `way/${e.id}` });
    return f ? [f] : [];
  });

  out.labels = labelPoints(out, places);
  return out;
}

// Joins line features with identical properties end to end, one feature per group.
function mergeLines(features) {
  const groups = new Map(), rest = [];
  for (const f of features) {
    if (!f.geometry.type.includes('LineString')) { rest.push(f); continue; }
    const { osm, ...props } = f.properties, key = JSON.stringify(props);
    const g = groups.get(key) ?? { props, ids: [], lines: [] };
    g.ids.push(f.id); g.lines.push(...(f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates));
    groups.set(key, g);
  }
  const merged = [...groups.values()].map(g => {
    const lines = joinWays(g.lines);
    return feature(g.ids[0], g.props, lines.length === 1 ? { type: 'LineString', coordinates: lines[0] } : { type: 'MultiLineString', coordinates: lines });
  });
  return [...merged, ...rest];
}

function distanceToSegment(p, a, b) {
  const [px, py, ax, ay, bx, by] = [p[0] * KX, p[1] * KY, a[0] * KX, a[1] * KY, b[0] * KX, b[1] * KY];
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

// OSM coastlines run with land on the left, so the lake is on the right. Each
// chain that crosses the box is closed by walking the box edge clockwise from
// where it leaves to where the next chain enters.
function lakeFromCoastline(ways) {
  const chains = joinWays(ways).flatMap(clipLine).filter(c => c.length > 1);
  const perimeter = 2 * (E - W) + 2 * (N - S);
  const position = ([x, y]) => {          // clockwise distance from the north-west corner
    const near = (a, b) => Math.abs(a - b) < 1e-9;
    if (near(y, N)) return x - W;
    if (near(x, E)) return (E - W) + (N - y);
    if (near(y, S)) return (E - W) + (N - S) + (E - x);
    if (near(x, W)) return 2 * (E - W) + (N - S) + (y - S);
    return null;
  };
  const corners = [[W, N, 0], [E, N, E - W], [E, S, (E - W) + (N - S)], [W, S, 2 * (E - W) + (N - S)]];
  const open = chains.filter(c => position(c[0]) !== null && position(c[c.length - 1]) !== null);
  const rings = [], used = new Set();
  for (const start of open) {
    if (used.has(start)) continue;
    let ring = [], chain = start;
    for (let guard = 0; guard < open.length + 1; guard++) {
      used.add(chain); ring.push(...chain);
      const exit = position(chain[chain.length - 1]);
      const ahead = p => ((p - exit) % perimeter + perimeter) % perimeter;
      const next = open.filter(c => c === start || !used.has(c)).sort((a, b) => ahead(position(a[0])) - ahead(position(b[0])))[0];
      const gap = ahead(position(next[0]));
      for (const [x, y, p] of [...corners].sort((a, b) => ahead(a[2]) - ahead(b[2]))) if (ahead(p) > 0 && ahead(p) < gap) ring.push([x, y]);
      if (next === start) break;
      chain = next;
    }
    ring.push(ring[0]);
    rings.push(ring);
  }
  return rings;
}

// Label points: one per named street run (ways of the same name joined), placed at
// the middle of its length, plus named water, parks and buildings. Ranks thin them by zoom.
function labelPoints(layers, places) {
  const r = v => Math.round(v * 10 ** places) / 10 ** places;
  const labels = [];
  const byName = new Map();
  for (const f of layers.streets) {
    if (!f.properties.name || f.geometry.type.includes('Polygon')) continue;
    const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const list = byName.get(f.properties.name) ?? []; list.push(...lines.map(l => ({ line: l, cls: f.properties.class }))); byName.set(f.properties.name, list);
  }
  for (const [name, parts] of byName) {
    for (const chain of joinWays(parts.map(p => p.line))) {
      const length = lengthOf(chain);
      if (length < 80) continue;
      const cls = parts.find(p => p.line.some(q => q[0] === chain[1][0] && q[1] === chain[1][1]))?.cls ?? 'minor';
      // One label every 400 m of a long street, so it stays labelled when zoomed in.
      const count = Math.max(1, Math.floor(length / 400));
      for (let k = 0; k < count; k++) {
        let target = length * (k + 0.5) / count, i = 1;
        for (; i < chain.length; i++) { const d = metres(chain[i - 1], chain[i]); if (target <= d) break; target -= d; }
        const a = chain[i - 1], b = chain[Math.min(i, chain.length - 1)], d = metres(a, b) || 1, t = target / d;
        let angle = Math.atan2((b[1] - a[1]) * KY, (b[0] - a[0]) * KX) * 180 / Math.PI;
        if (angle > 90) angle -= 180; if (angle < -90) angle += 180;
        labels.push(feature(`s${labels.length}`, { text: name, kind: 'street', rank: cls === 'major' ? 1 : cls === 'minor' ? 2 : 3,
          angle: Math.round(-angle), minZoom: cls === 'major' ? 14 : cls === 'minor' ? 16 : 17 },
          { type: 'Point', coordinates: [r(a[0] + t * (b[0] - a[0])), r(a[1] + t * (b[1] - a[1]))] }));
      }
    }
  }
  for (const [layer, kind, minZoom] of [['water', 'water', 14], ['green', 'park', 15], ['buildings', 'building', 17]]) {
    for (const f of layers[layer]) {
      if (!f?.properties.name) continue;
      const ring = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0];
      const [x, y] = ring.slice(1).reduce(([sx, sy], p) => [sx + p[0], sy + p[1]], [0, 0]).map(v => v / (ring.length - 1));
      labels.push(feature(`${kind[0]}${f.id}`, { text: f.properties.name, kind, rank: kind === 'building' ? 3 : 2, minZoom }, { type: 'Point', coordinates: [r(x), r(y)] }));
    }
  }
  return labels;
}

// Corners where two or more differently named roads share a node. Dual carriageways
// give several nodes per corner, so nodes naming the same streets within 40 m merge.
function intersections(elements, { box = true, majorOnly = false } = {}) {
  const ways = elements.filter(e => e.type === 'way' && e.tags?.name && ROAD_CLASS[e.tags.highway] && ROAD_CLASS[e.tags.highway] !== 'path'
    && (!majorOnly || ROAD_CLASS[e.tags.highway] === 'major'));
  const at = new Map(), names = new Map(), major = new Map();
  for (const way of ways) {
    way.nodes.forEach((id, i) => {
      const set = names.get(id) ?? new Set(); set.add(bareName(way.tags.name)); names.set(id, set);
      if (ROAD_CLASS[way.tags.highway] === 'major') major.set(id, (major.get(id) ?? new Set()).add(bareName(way.tags.name)));
      if (way.geometry?.[i]) at.set(id, [way.geometry[i].lon, way.geometry[i].lat]);
    });
  }
  const corners = [];
  for (const [id, set] of names) {
    if (set.size < 2) continue;
    const point = at.get(id);
    if (box && (!point || !inBox(point))) continue;
    const streets = [...set].sort();
    const key = streets.join(' & ');
    const near = point && corners.find(c => c.key === key && metres(c.point, point) < 40);
    if (near) continue;
    corners.push({ key, id, point, streets, rank: (major.get(id)?.size ?? 0) >= 2 ? 'major' : 'minor' });
  }
  return corners;
}

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
    proposed: { places: 6, tolerance: { buildings: 0.5, streets: 1, water: 1, green: 1, rail: 1 }, minBuildingArea: 0,
      dropDetail: true, minGreenArea: 200, merge: true, noOsm: true },
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
      console.log(`Lake Michigan polygon from coastline: ${layers.water[0]?.id === 'lake' ? `yes, ${vertexCount(layers.water[0].geometry)} vertices` : 'no'}.`);
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
