// L7 prototype (docs/map-layers.md): a Pedway schematic, like a transit diagram,
// laid out from the snapshot's Pedway, station and access-point data alone.
//   node scripts/pedway-schematic.mjs [--snapshot ID] [--out _build/pedway-schematic] [--gap 60]
// --out docs/x writes there instead; docs/pedway-schematic.svg is one such copy.
// Writes graph.json (the routable "Pedway graph" data set section 4 proposes),
// schematic.json (the laid-out diagram) and schematic.svg, and prints sizes and
// how well the layout did. Nothing goes into data/.
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const outDir = path.resolve(root, option('--out', '_build/pedway-schematic'));
const GAP = Number(option('--gap', '60'));       // join pieces of the Pedway closer than this, in metres
const SNAP = 5;                                   // vertices closer than this are one node, in metres
const STATION_REACH = 120, ENTRANCE_REACH = 20;   // how far a station or entrance may be from the Pedway

const current = JSON.parse(await fs.readFile(path.join(root, 'data/current.json'), 'utf8'));
const snapshotId = option('--snapshot', current.snapshot);
const snapshot = JSON.parse(await fs.readFile(path.join(root, 'data/snapshots', `${snapshotId}.json`), 'utf8'));
const layer = async key => snapshot.files[key] ? JSON.parse(await fs.readFile(path.join(root, 'data', snapshot.files[key].path), 'utf8')).features : [];
const [pedway, access, cta, metra, buildings] = await Promise.all(['pedway', 'access', 'cta', 'metra', 'buildings'].map(layer));

// Local metres around the Loop: x east, y north.
const LAT0 = 41.8837, LON0 = -87.6278, M_LAT = 111_320, M_LON = 111_320 * Math.cos(LAT0 * Math.PI / 180);
const toXY = ([lon, lat]) => [(lon - LON0) * M_LON, (lat - LAT0) * M_LAT];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const started = performance.now();

// ---- 1. Graph from the Pedway ways ----
const nodes = [];   // { id, xy, ll, stops: [], entrances: 0 }
const grid = new Map(), cell = ([x, y]) => `${Math.floor(x / SNAP)},${Math.floor(y / SNAP)}`;
function nodeAt(ll) {
  const xy = toXY(ll), [cx, cy] = cell(xy).split(',').map(Number);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
    for (const n of grid.get(`${cx + dx},${cy + dy}`) ?? []) if (dist(n.xy, xy) <= SNAP) return n;
  const n = { id: nodes.length, xy, ll, stops: [], entrances: 0 };
  nodes.push(n);
  const key = cell(xy);
  grid.set(key, [...(grid.get(key) ?? []), n]);
  return n;
}
let edges = [];     // { a, b, length, level, kind, gap }
for (const f of pedway) {
  const coords = f.geometry.coordinates;
  for (let i = 1; i < coords.length; i++) {
    const a = nodeAt(coords[i - 1]), b = nodeAt(coords[i]);
    if (a !== b) edges.push({ a: a.id, b: b.id, length: dist(a.xy, b.xy), level: f.properties.level, kind: f.properties.kind, gap: false, ways: [f.id] });
  }
}
const rawCounts = { ways: pedway.length, nodes: nodes.length, edges: edges.length };

// ---- 2. Join pieces that OSM leaves apart (passages through buildings it lacks) ----
const parent = nodes.map((_, i) => i), find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
for (const e of edges) parent[find(e.a)] = find(e.b);
const piecesBefore = new Set(nodes.map(n => find(n.id))).size;
const candidates = [];
for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
  if (find(i) === find(j)) continue;
  const d = dist(nodes[i].xy, nodes[j].xy);
  if (d <= GAP) candidates.push({ a: i, b: j, d });
}
candidates.sort((p, q) => p.d - q.d);
let gaps = 0;
for (const c of candidates) {
  if (find(c.a) === find(c.b)) continue;
  parent[find(c.a)] = find(c.b);
  edges.push({ a: c.a, b: c.b, length: c.d, level: 'below', kind: 'gap', gap: true, ways: [] });
  gaps++;
}
const piecesAfter = new Set(nodes.map(n => find(n.id))).size;

// ---- 3. Stations and entrances onto the nearest node ----
const nearest = (ll, reach) => {
  const xy = toXY(ll);
  let best = null, bestD = reach;
  for (const n of nodes) { const d = dist(n.xy, xy); if (d <= bestD) { best = n; bestD = d; } }
  return best;
};
const stations = new Map();
for (const [system, features] of [['CTA', cta], ['Metra', metra]]) {
  for (const f of features.filter(f => f.properties.pedway)) {
    const n = nearest(f.geometry.coordinates, STATION_REACH);
    if (!n) continue;
    const key = `${system}:${f.properties.name}`;
    if (stations.has(key)) { stations.get(key).lines.push(...f.properties.lines); continue; }
    const stop = { name: f.properties.name, system, lines: [...f.properties.lines], node: n.id };
    stations.set(key, stop); n.stops.push(stop);
  }
}
for (const f of access) {
  const n = nearest(f.geometry.coordinates, ENTRANCE_REACH);
  if (n) n.entrances++;
}
// Named Pedway buildings, labelled once at the node nearest their middle.
const centroid = g => { const ring = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0]; return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length]; };
const places = [];
for (const f of buildings.filter(f => f.properties.pedway && f.properties.name)) {
  const n = nearest(centroid(f.geometry), 40);
  if (n && !n.stops.length && !n.place) { n.place = f.properties.name; places.push(n); }
}

// ---- 4a. Merge the ends of short edges, so a station complex becomes a few nodes ----
const MERGE = Number(option('--merge', '30'));
const alias = new Map(), real = id => alias.has(id) ? real(alias.get(id)) : id;
for (const e of [...edges].sort((p, q) => p.length - q.length)) {
  if (e.length >= MERGE) break;
  const a = byIdOf(real(e.a)), b = byIdOf(real(e.b));
  if (a === b || (a.stops.length && b.stops.length) || dist(a.xy, b.xy) >= MERGE) continue;
  const [into, from] = b.stops.length || (b.place && !a.place) ? [b, a] : [a, b];
  if (!into.stops.length && !from.stops.length) into.xy = [(into.xy[0] + from.xy[0]) / 2, (into.xy[1] + from.xy[1]) / 2];
  into.stops.push(...from.stops); into.entrances += from.entrances; into.place ??= from.place;
  from.stops = []; from.entrances = 0; from.place = undefined;
  alias.set(from.id, into.id);
}
function byIdOf(id) { return nodes[id]; }
edges = edges.map(e => ({ ...e, a: real(e.a), b: real(e.b) })).filter(e => e.a !== e.b);
places.splice(0, places.length, ...nodes.filter(n => n.place));

// ---- 4. Contract chains: keep junctions, ends, stops, entrances and places ----
const keep = n => n.stops.length || n.entrances || n.place;
function adjacency() {
  const adj = new Map(nodes.map(n => [n.id, []]));
  edges.forEach((e, i) => { adj.get(e.a).push(i); adj.get(e.b).push(i); });
  return adj;
}
for (let changed = true; changed;) {
  changed = false;
  // Drop short dead ends that lead nowhere marked.
  let adj = adjacency();
  const dead = new Set();
  for (const n of nodes) {
    const list = adj.get(n.id);
    if (list.length === 1 && !keep(n) && edges[list[0]].length < 25) { dead.add(list[0]); changed = true; }
  }
  if (dead.size) { edges = edges.filter((_, i) => !dead.has(i)); adj = adjacency(); }
  // Merge the two edges of an unmarked degree-2 node into one.
  for (const n of nodes) {
    const list = adj.get(n.id);
    if (list.length !== 2 || keep(n)) continue;
    const [e1, e2] = list.map(i => edges[i]);
    if (!e1 || !e2 || e1 === e2 || e1.level !== e2.level && !(e1.gap || e2.gap)) continue;
    const other1 = e1.a === n.id ? e1.b : e1.a, other2 = e2.a === n.id ? e2.b : e2.a;
    if (other1 === other2) continue;
    edges[list[0]] = { a: other1, b: other2, length: e1.length + e2.length, level: e1.gap ? e2.level : e1.level, kind: e1.kind === e2.kind ? e1.kind : 'corridor', gap: e1.gap && e2.gap, ways: [...e1.ways, ...e2.ways] };
    edges[list[1]] = null;
    edges = edges.filter(Boolean);
    adj = adjacency();
    changed = true;
  }
}
// Remove parallel edges.
const seenPairs = new Set();
edges = edges.filter(e => { const k = [Math.min(e.a, e.b), Math.max(e.a, e.b)].join('-'); if (seenPairs.has(k)) return false; seenPairs.add(k); return true; });
const used = new Set(edges.flatMap(e => [e.a, e.b]));
const kept = nodes.filter(n => used.has(n.id));

// ---- 5. Octilinear layout: snap every edge to a multiple of 45°, keep geography loosely ----
const pos = new Map(kept.map(n => [n.id, [...n.xy]]));
const UNIT = 70; // shortest edge in the diagram, in metres of the original
const snapAngle = (dx, dy) => Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
const target = e => Math.max(UNIT, Math.min(e.length * 0.8, 260));
for (let iter = 0; iter < 600; iter++) {
  const rate = 0.25 * (1 - iter / 700);
  const move = new Map(kept.map(n => [n.id, [0, 0]]));
  for (const e of edges) {
    const pa = pos.get(e.a), pb = pos.get(e.b), dx = pb[0] - pa[0], dy = pb[1] - pa[1];
    const angle = snapAngle(dx, dy), len = target(e);
    const want = [Math.cos(angle) * len, Math.sin(angle) * len];
    const fx = (want[0] - dx) / 2, fy = (want[1] - dy) / 2;
    move.get(e.a)[0] -= fx; move.get(e.a)[1] -= fy;
    move.get(e.b)[0] += fx; move.get(e.b)[1] += fy;
  }
  // Nodes keep apart.
  for (let i = 0; i < kept.length; i++) for (let j = i + 1; j < kept.length; j++) {
    const p = pos.get(kept[i].id), q = pos.get(kept[j].id), d = dist(p, q) || 0.01;
    if (d >= UNIT * 0.9) continue;
    const push = (UNIT * 0.9 - d) / 2, ux = (q[0] - p[0]) / d, uy = (q[1] - p[1]) / d;
    move.get(kept[i].id)[0] -= ux * push; move.get(kept[i].id)[1] -= uy * push;
    move.get(kept[j].id)[0] += ux * push; move.get(kept[j].id)[1] += uy * push;
  }
  // A weak pull back to where things really are.
  for (const n of kept) { const p = pos.get(n.id), m = move.get(n.id); m[0] += (n.xy[0] * 1.6 - p[0]) * 0.02; m[1] += (n.xy[1] * 1.6 - p[1]) * 0.02; }
  for (const n of kept) { const p = pos.get(n.id), m = move.get(n.id); p[0] += m[0] * rate; p[1] += m[1] * rate; }
}
const layoutMs = performance.now() - started;

// ---- 6. How well it did ----
const angleOff = e => { const pa = pos.get(e.a), pb = pos.get(e.b), a = Math.atan2(pb[1] - pa[1], pb[0] - pa[0]); return Math.abs(a - snapAngle(pb[0] - pa[0], pb[1] - pa[1])) * 180 / Math.PI; };
const octilinear = edges.filter(e => angleOff(e) <= 3).length;
function crossings(where) {
  let count = 0;
  const ccw = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const e = edges[i], f = edges[j];
    if (e.a === f.a || e.a === f.b || e.b === f.a || e.b === f.b) continue;
    const [p1, p2, p3, p4] = [where(e.a), where(e.b), where(f.a), where(f.b)];
    if (Math.sign(ccw(p1, p2, p3)) * Math.sign(ccw(p1, p2, p4)) < 0 && Math.sign(ccw(p3, p4, p1)) * Math.sign(ccw(p3, p4, p2)) < 0) count++;
  }
  return count;
}
const byId = new Map(nodes.map(n => [n.id, n]));
const crossGeo = crossings(id => byId.get(id).xy), crossLayout = crossings(id => pos.get(id));

// ---- 7. Output ----
const round = v => Math.round(v * 1e6) / 1e6;
const graph = {
  format: 'pedway-graph', version: 1, snapshot: snapshotId, attribution: snapshot.attribution,
  nodes: kept.map(n => ({ id: n.id, ll: n.ll.map(round), ...(n.stops.length ? { stops: n.stops.map(s => `${s.system}:${s.name}`) } : {}), ...(n.entrances ? { entrances: n.entrances } : {}), ...(n.place ? { place: n.place } : {}) })),
  edges: edges.map(e => ({ a: e.a, b: e.b, m: Math.round(e.length), level: e.level, ...(e.gap ? { gap: true } : {}), ...(e.kind === 'steps' ? { steps: true } : {}), ways: e.ways })),
};
const LEVEL_COLOR = { below: '#2f6db5', above: '#d9822b', street: '#5a9e5a' };
const xs = [...pos.values()].map(p => p[0]), ys = [...pos.values()].map(p => p[1]);
const PAD = 160, minX = Math.min(...xs) - PAD, maxY = Math.max(...ys) + PAD, width = Math.max(...xs) + PAD - minX, height = maxY - (Math.min(...ys) - PAD);
const sx = id => (pos.get(id)[0] - minX).toFixed(1), sy = id => (maxY - pos.get(id)[1]).toFixed(1);
const placed = [];
// A label at (x, y) of n characters, to the right of its mark or, failing that, to the left; null when both overlap.
function labelAt(x, y, text, size) {
  const w = text.length * size * 0.56, h = size * 1.2;
  for (const [lx, anchor] of [[x + 16, 'start'], [x - 16 - w, 'end']]) {
    const box = [lx, y - h / 2, lx + w, y + h / 2];
    if (placed.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
    placed.push(box);
    return { x: anchor === 'start' ? lx : lx + w, anchor };
  }
  return null;
}
const stationText = n => n.stops.map(s => `${s.name} (${s.system === 'CTA' ? s.lines.join(', ') : 'Metra'})`).join(' · ');
const stationLabels = kept.filter(n => n.stops.length).map(n => ({ n, text: stationText(n), at: labelAt(+sx(n.id), +sy(n.id), stationText(n), 22) }));
const placeLabels = places.filter(n => used.has(n.id) && !n.stops.length).map(n => ({ n, at: labelAt(+sx(n.id), +sy(n.id), n.place, 17) }));
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const svg = [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width.toFixed(0)} ${(height + 90).toFixed(0)}" font-family="system-ui, sans-serif">`,
  `<title>Chicago Pedway schematic (prototype)</title>`,
  `<rect width="100%" height="100%" fill="#fbfaf7"/>`,
  ...edges.map(e => `<line x1="${sx(e.a)}" y1="${sy(e.a)}" x2="${sx(e.b)}" y2="${sy(e.b)}" stroke="${LEVEL_COLOR[e.level] ?? '#888'}" stroke-width="${e.gap ? 5 : 9}" stroke-linecap="round"${e.gap ? ' stroke-dasharray="4 10"' : ''}/>`),
  ...kept.filter(n => n.entrances && !n.stops.length).map(n => `<circle cx="${sx(n.id)}" cy="${sy(n.id)}" r="6" fill="#fff" stroke="#333" stroke-width="3"/>`),
  ...placeLabels.map(({ n, at }) => `<circle cx="${sx(n.id)}" cy="${sy(n.id)}" r="4" fill="#333"/>` + (at ? `<text x="${at.x.toFixed(1)}" y="${(+sy(n.id) + 6).toFixed(1)}" text-anchor="${at.anchor}" font-size="17" fill="#555">${esc(n.place)}</text>` : '')),
  ...stationLabels.map(({ n, text, at }) => `<rect x="${(+sx(n.id) - 12).toFixed(1)}" y="${(+sy(n.id) - 12).toFixed(1)}" width="24" height="24" rx="6" fill="#fff" stroke="#111" stroke-width="4"/>` + (at ? `<text x="${at.x.toFixed(1)}" y="${(+sy(n.id) + 7).toFixed(1)}" text-anchor="${at.anchor}" font-size="22" font-weight="600" fill="#111">${esc(text)}</text>` : '')),
  `<g font-size="20" fill="#333" transform="translate(30 ${(height + 30).toFixed(0)})">`,
  ...Object.entries(LEVEL_COLOR).map(([level, color], i) => `<line x1="${i * 220}" y1="0" x2="${i * 220 + 40}" y2="0" stroke="${color}" stroke-width="9"/><text x="${i * 220 + 50}" y="7">${level === 'below' ? 'Below ground' : level === 'above' ? 'Above ground' : 'Street level'}</text>`),
  `<line x1="660" y1="0" x2="700" y2="0" stroke="#2f6db5" stroke-width="5" stroke-dasharray="4 10"/><text x="710" y="7">Gap in the data</text>`,
  `<circle cx="900" cy="0" r="6" fill="#fff" stroke="#333" stroke-width="3"/><text x="915" y="7">Entrance</text>`,
  `<text x="0" y="45" font-size="16" fill="#666">Prototype, not to scale. ${esc(snapshot.attribution)}. Snapshot ${snapshotId}.</text></g>`,
  `</svg>`,
].join('\n');

await fs.mkdir(outDir, { recursive: true });
const graphText = JSON.stringify(graph);
await fs.writeFile(path.join(outDir, 'graph.json'), graphText);
await fs.writeFile(path.join(outDir, 'schematic.svg'), svg + '\n');
const gz = s => zlib.gzipSync(s, { level: 9 }).length, kib = n => `${(n / 1024).toFixed(1)} KiB`;
console.log(`Snapshot ${snapshotId}, ${Math.round(layoutMs)} ms in all.\n`);
console.log('| Step | Count |\n| --- | ---: |');
console.log(`| Pedway ways | ${rawCounts.ways} |`);
console.log(`| Nodes, edges (vertices ${SNAP} m apart merged) | ${rawCounts.nodes}, ${rawCounts.edges} |`);
console.log(`| Separate pieces before and after joining gaps ≤ ${GAP} m | ${piecesBefore} → ${piecesAfter} (${gaps} gap edges) |`);
console.log(`| Stations on the Pedway placed | ${stations.size} of ${cta.filter(f => f.properties.pedway).length + metra.filter(f => f.properties.pedway).length} features |`);
console.log(`| Entrances within ${ENTRANCE_REACH} m of the Pedway | ${kept.reduce((s, n) => s + n.entrances, 0)} of ${access.length} access points |`);
console.log(`| Short edges merged (< ${MERGE} m) | ${alias.size} |`);
console.log(`| Labels placed without overlap: stations, buildings | ${stationLabels.filter(l => l.at).length} of ${stationLabels.length}, ${placeLabels.filter(l => l.at).length} of ${placeLabels.length} |`);
console.log(`| Diagram nodes, edges | ${kept.length}, ${edges.length} |`);
console.log(`| Edges within 3° of a multiple of 45° | ${octilinear} of ${edges.length} |`);
console.log(`| Edge crossings, real geometry → diagram | ${crossGeo} → ${crossLayout} |`);
console.log(`\n| File | Raw | gzip -9 |\n| --- | ---: | ---: |`);
console.log(`| graph.json | ${kib(graphText.length)} | ${kib(gz(graphText))} |`);
console.log(`| schematic.svg | ${kib(svg.length)} | ${kib(gz(svg))} |`);
