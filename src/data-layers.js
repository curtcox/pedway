// The map's data layers: which file each comes from and what its features may hold.
// Shared by the browser and by scripts/check-data.mjs.
const text = { type: 'string' }, yesNo = { values: ['yes', 'no', 'limited'] };
const AREA = Object.freeze(['Polygon', 'MultiPolygon']), LINE = Object.freeze(['LineString', 'MultiLineString']);
// The data schema these rules define. Bump `version` for an incompatible change (a
// renamed, removed or re-typed property, or a new required one); additions keep it.
// `accepts` lists the schemas this app can read: keep the previous one until
// data/current.json has moved past it, so app and data never have to change together.
export const DATA_SCHEMA = Object.freeze({ version: 1, accepts: Object.freeze([1]) });
// poi.geojson holds every place category; each one is its own layer on the map, in this order.
// minFeatures guards against a category silently vanishing from OpenStreetMap's answer.
export const POI_CATEGORIES = Object.freeze([
  { key: 'food', title: 'Food and coffee', color: '#c2410c', minFeatures: 100 },
  { key: 'restroom', title: 'Restrooms', color: '#0e7490', minFeatures: 5 },
  { key: 'store', title: 'Groceries and pharmacies', color: '#7c3aed', minFeatures: 20 },
  { key: 'museum', title: 'Museums and galleries', color: '#a21caf', minFeatures: 5 },
  { key: 'park', title: 'Parks and plazas', color: '#15803d', minFeatures: 5 },
]);
export const DATA_LAYERS = Object.freeze([
  { key: 'pedway', file: 'pedway.geojson', geometry: 'LineString', minFeatures: 100, title: 'Pedway',
    properties: { kind: { required: true, values: ['corridor', 'steps'] }, level: { required: true, values: ['below', 'street', 'above'] },
      name: text, hours: text, wheelchair: yesNo, osm: { required: true, ...text } } },
  { key: 'access', file: 'access.geojson', geometry: 'Point', minFeatures: 20, title: 'Entrances and lifts',
    properties: { kind: { required: true, values: ['entrance', 'elevator', 'station'] }, name: text, level: text, hours: text,
      wheelchair: yesNo, elevator: { values: ['yes'] }, osm: { required: true, ...text } } },
  { key: 'cta', file: 'cta.geojson', geometry: 'Point', minFeatures: 100, title: 'CTA ‘L’ stations',
    properties: { name: { required: true, ...text }, lines: { type: 'list' }, wheelchair: yesNo, pedway: { type: 'boolean' }, osm: { required: true, ...text } } },
  { key: 'metra', file: 'metra.geojson', geometry: 'Point', minFeatures: 50, title: 'Metra stations',
    properties: { name: { required: true, ...text }, lines: { type: 'list' }, wheelchair: yesNo, pedway: { type: 'boolean' }, osm: { required: true, ...text } } },
  { key: 'poi', file: 'poi.geojson', geometry: 'Point', minFeatures: 100, title: 'Places',
    properties: { category: { required: true, values: POI_CATEGORIES.map(category => category.key) }, kind: { required: true, ...text },
      name: text, hours: text, level: text, wheelchair: yesNo, pedway: { type: 'boolean' }, osm: { required: true, ...text } } },
  // Optional layers may be missing from a snapshot (older ones have none of them). The
  // base map's are lazy: fetched the first time they are shown. A feature's id names its
  // OSM object, so they carry no osm property. maxBytes overrides the 300 KB default.
  { key: 'intersections', file: 'intersections.geojson', geometry: 'Point', minFeatures: 300, title: 'Corners', optional: true,
    properties: { streets: { required: true, type: 'list' }, rank: { required: true, values: ['major', 'minor'] } } },
  { key: 'water', file: 'water.geojson', geometry: AREA, minFeatures: 10, title: 'Water', optional: true, lazy: true, base: true,
    properties: { name: text, kind: { required: true, ...text } } },
  { key: 'green', file: 'green.geojson', geometry: AREA, minFeatures: 200, title: 'Parks and green space', optional: true, lazy: true, base: true,
    properties: { name: text, kind: { required: true, ...text } } },
  { key: 'rail', file: 'rail.geojson', geometry: LINE, minFeatures: 200, title: 'Rail lines', optional: true, lazy: true, base: true,
    properties: { kind: { required: true, values: ['subway', 'elevated', 'surface'] }, railway: { required: true, ...text }, lines: { type: 'list' } } },
  { key: 'streets', file: 'streets.geojson', geometry: [...LINE, ...AREA], minFeatures: 400, title: 'Streets', optional: true, lazy: true, base: true, maxBytes: 800 * 1024,
    properties: { name: text, class: { required: true, values: ['major', 'minor', 'service', 'path'] }, bridge: { values: ['yes'] }, tunnel: { values: ['yes'] },
      layer: { type: 'number' }, oneway: { type: 'boolean' } } },
  { key: 'buildings', file: 'buildings.geojson', geometry: AREA, minFeatures: 2000, title: 'Buildings', optional: true, lazy: true, base: true, maxBytes: 1200 * 1024,
    properties: { name: text, levels: { type: 'number' }, pedway: { type: 'boolean' } } },
  { key: 'labels', file: 'labels.geojson', geometry: 'Point', minFeatures: 1000, title: 'Labels', optional: true, lazy: true, base: true, maxBytes: 500 * 1024, id: /^l\d+$/,
    properties: { text: { required: true, ...text }, kind: { required: true, values: ['street', 'water', 'park', 'building'] },
      rank: { required: true, type: 'number' }, angle: { type: 'number' }, minZoom: { required: true, type: 'number' } } },
]);
