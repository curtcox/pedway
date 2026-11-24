// The map's data layers: which file each comes from and what its features may hold.
// Shared by the browser and by scripts/check-data.mjs.
const text = { type: 'string' }, yesNo = { values: ['yes', 'no', 'limited'] };
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
]);
