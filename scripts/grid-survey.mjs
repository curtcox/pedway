// Surveys where Chicago streets cross, from OpenStreetMap via Overpass, to
// calibrate the address-grid model in src/geo/chicago-grid.js. Run by hand:
//   node scripts/grid-survey.mjs "State Street" > survey-state.json
// It prints every named street crossing the given street, with coordinates.
const base = process.argv[2];
if (!base) { console.error('usage: node scripts/grid-survey.mjs "State Street"'); process.exit(2); }
const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const query = `[out:json][timeout:90];
way["highway"]["name"~"^(North |South |East |West )?${escaped}$"](41.64,-87.95,42.03,-87.52)->.s;
node(w.s)->.n;
way(bn.n)["highway"]["name"]->.x;
.x out body; .n out skel;`;
const response = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST', headers: { 'User-Agent': 'pedway-tools-grid-survey' }, body: new URLSearchParams({ data: query }) });
if (!response.ok) throw new Error(`Overpass ${response.status}`);
const { elements } = await response.json();
const nodes = new Map(elements.filter(e => e.type === 'node').map(e => [e.id, [e.lat, e.lon]]));
const bare = name => name.replace(/^(North|South|East|West) /, '');
const crossings = new Map();
for (const way of elements.filter(e => e.type === 'way')) {
  const name = bare(way.tags.name);
  if (name === base) continue;
  for (const id of way.nodes) if (nodes.has(id)) {
    const list = crossings.get(name) ?? []; list.push(nodes.get(id)); crossings.set(name, list);
  }
}
const out = {};
for (const [name, points] of [...crossings].sort()) {
  const lat = points.reduce((s, p) => s + p[0], 0) / points.length, lon = points.reduce((s, p) => s + p[1], 0) / points.length;
  const spread = Math.max(...points.map(p => Math.hypot((p[0] - lat) * 111000, (p[1] - lon) * 83000)));
  out[name] = { lat: +lat.toFixed(6), lon: +lon.toFixed(6), n: points.length, spreadM: Math.round(spread) };
}
console.log(JSON.stringify(out, null, 1));
