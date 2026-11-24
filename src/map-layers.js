// Every layer the map can show, in one list: where its features come from, which
// section of the Layers panel it sits in, which pane it draws in and when it shows.
// See docs/map-layers.md. Shared by the browser and the unit tests.
import { DATA_LAYERS, POI_CATEGORIES } from './data-layers.js';

// The Layers panel's sections, in order.
export const LAYER_GROUPS = Object.freeze([
  { key: 'transit', title: 'Pedway and transit' },
  { key: 'places', title: 'Places' },
  { key: 'coords', title: 'Coordinates' },
]);

// Panes fix the stacking order whichever layers are on. Leaflet's own panes are
// tilePane 200, overlayPane 400 (the data shapes), markerPane 600 and popupPane 700.
export const PANES = Object.freeze([
  { name: 'coords-lines', zIndex: 380 },
  { name: 'coords-labels', zIndex: 450 },
]);

// Places crowd the map when zoomed out, so they appear from this zoom in.
export const POI_MIN_ZOOM = 15;
const title = key => DATA_LAYERS.find(layer => layer.key === key).title;

// source.kind: 'snapshot' is a file in the data snapshot (source.file names its
// layer key; source.category picks one place category out of poi).
// default: whether the layer is on in a new map. streetHides: the "Streets only"
// view hides it without switching it off.
export const MAP_LAYERS = Object.freeze([
  { key: 'pedway', group: 'transit', title: title('pedway'), source: { kind: 'snapshot', file: 'pedway' }, default: true, streetHides: true },
  { key: 'access', group: 'transit', title: title('access'), source: { kind: 'snapshot', file: 'access' }, default: true, streetHides: true },
  { key: 'cta', group: 'transit', title: title('cta'), source: { kind: 'snapshot', file: 'cta' }, default: true },
  { key: 'metra', group: 'transit', title: title('metra'), source: { kind: 'snapshot', file: 'metra' }, default: true },
  ...POI_CATEGORIES.map(category => ({ key: category.key, group: 'places', title: category.title, color: category.color,
    source: { kind: 'snapshot', file: 'poi', category: category.key }, default: category.key === 'restroom', minZoom: POI_MIN_ZOOM })),
].map(Object.freeze));

/** The layer keys a map document holds, with each one's default. */
export const LAYER_DEFAULTS = Object.freeze(Object.fromEntries(MAP_LAYERS.map(layer => [layer.key, layer.default])));

// Coordinate overlays: drawn from code alone (src/overlays/), kept in the document's
// overlays field rather than layers. All are off in a new map.
export const OVERLAYS = Object.freeze([
  { key: 'latlon', title: 'Latitude and longitude', color: '#b91c1c' },
  { key: 'geohash', title: 'Geohash', color: '#0f766e' },
  { key: 'usng', title: 'USNG', color: '#1d4ed8' },
  { key: 'grid', title: 'Address grid and corners', color: '#92400e' },
].map(Object.freeze));
export const OVERLAY_DEFAULTS = Object.freeze(Object.fromEntries(OVERLAYS.map(overlay => [overlay.key, false])));
