// The map's data layers: which file each comes from and what its features may hold.
// Shared by the browser and by scripts/check-data.mjs.
const text = { type: 'string' }, yesNo = { values: ['yes', 'no', 'limited'] };
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
]);

// The layers a map shows, in the panel's order: the data files, with poi split by category.
export const MAP_LAYERS = Object.freeze([
  ...DATA_LAYERS.filter(layer => layer.key !== 'poi').map(layer => ({ key: layer.key, title: layer.title, file: layer.key })),
  ...POI_CATEGORIES.map(category => ({ key: category.key, title: category.title, file: 'poi', category: category.key })),
]);
