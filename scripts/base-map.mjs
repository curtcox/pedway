// The self-hosted base map of downtown (docs/map-layers.md): water, green areas,
// buildings, streets, rail and label points, plus the intersections data set,
// built from OpenStreetMap (Overpass) replies. Used by build-data.mjs, which
// writes them into data snapshots, and by base-survey.mjs, which measures them.
import { BASE_BOX, CHICAGO_BOUNDS } from '../src/map-defaults.js';

const [[S, W], [N, E]] = BASE_BOX;
const BOX = `${S},${W},${N},${E}`;
const [[CS, CW], [CN, CE]] = CHICAGO_BOUNDS;
const CITY = `${CS},${CW},${CN},${CE}`;

// What the snapshot keeps (the "proposed" copy measured in L0): full detail, without
// sidewalks, crossings, parking aisles, driveways, green areas under 200 m² or osm
// ids (a feature's id names its OSM object), with street ways merged by name and class.
export const BASE_SETTINGS = Object.freeze({ places: 6, tolerance: { buildings: 0.5, streets: 1, water: 1, green: 1, rail: 1 }, minBuildingArea: 0,
  dropDetail: true, minGreenArea: 200, merge: true, noOsm: true });

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
export const vertexCount = geometry => { const walk = c => typeof c[0] === 'number' ? 1 : c.reduce((s, x) => s + walk(x), 0); return walk(geometry.coordinates); };
const clean = object => Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined && v !== '' && v !== false));
const feature = (id, properties, geometry) => ({ type: 'Feature', id, properties: clean(properties), geometry });

// --- Queries ------------------------------------------------------------------

const Q = body => `[out:json][timeout:180];\n${body}`;
export const BASE_QUERIES = {
  buildings: Q(`(way["building"](${BOX}); rel["building"]["type"="multipolygon"](${BOX}););\nout body geom;`),
  streets: Q(`way["highway"](${BOX});\nout body geom;`),
  water: Q(`(way["natural"="water"](${BOX}); rel["natural"="water"](${BOX}); way["waterway"="riverbank"](${BOX}););\nout body geom;`),
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

export function buildBaseLayers(raw, pedwayVertices, settings = BASE_SETTINGS) {
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

  // Water: Lake Michigan (an OSM water relation; the box holds no coastline ways), the river and fountains.
  const waterElements = raw.water.elements;
  out.water = waterElements.flatMap(e => {
    const f = finish(polygonGeometry(polygonsOf(e), tolerance.water, 20), `${e.type[0]}${e.id}`, { name: e.tags.name, kind: e.tags.water ?? e.tags.waterway ?? 'water', osm: `${e.type}/${e.id}` });
    return f ? [f] : [];
  });

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
        labels.push(feature(`l${labels.length}`, { text: name, kind: 'street', rank: cls === 'major' ? 1 : cls === 'minor' ? 2 : 3,
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
      labels.push(feature(`l${labels.length}`, { text: f.properties.name, kind, rank: kind === 'building' ? 3 : 2, minZoom }, { type: 'Point', coordinates: [r(x), r(y)] }));
    }
  }
  return labels;
}

// Corners where two or more differently named roads share a node. Dual carriageways
// give several nodes per corner, so nodes naming the same streets within 40 m merge.
export function intersections(elements, { box = true, majorOnly = false } = {}) {
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

const ATTRIBUTION = '© OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)';
const collection = (name, features) => ({ type: 'FeatureCollection', name, attribution: ATTRIBUTION, features });
const byId = (a, b) => a.id.localeCompare(b.id, 'en', { numeric: true });

/** Every named corner in the box, as GeoJSON points with the street names and a major/minor rank. */
export function buildIntersections(streetElements) {
  const features = intersections(streetElements).map(c => feature(`n${c.id}`, { streets: c.streets, rank: c.rank },
    { type: 'Point', coordinates: c.point.map(v => Math.round(v * 1e6) / 1e6) }));
  return collection('intersections', features.sort(byId));
}

/**
 * The base layers and intersections as GeoJSON collections, from the Overpass replies
 * named as in BASE_QUERIES. pedwayVertices are [lon, lat] points of the Pedway.
 */
export function buildBase(raw, pedwayVertices) {
  const layers = buildBaseLayers(raw, pedwayVertices, BASE_SETTINGS);
  const out = {};
  // Labels keep their order (it is their rank order within a street); the rest sort by id for small diffs.
  for (const [name, features] of Object.entries(layers)) out[name] = collection(name, name === 'labels' ? features.filter(Boolean) : features.filter(Boolean).sort(byId));
  out.intersections = buildIntersections(raw.streets.elements);
  return out;
}
