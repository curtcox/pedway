import { createShell } from '../vendor/fragment-kit-v0.5.0/src/index.js';
import { config } from './config.js';
import { LOOP_CENTER, DEFAULT_ZOOM, MIN_ZOOM, MAX_ZOOM, CHICAGO_BOUNDS, TILE_URL, TILE_ATTRIBUTION } from './map-defaults.js';

const L = globalThis.L;
const shell = createShell({ config, actions: [
  { label: 'Loop', id: 'recenter', onClick: () => recenter() },
] });
shell.offlineStatus.textContent = '';

const map = L.map('map', {
  center: LOOP_CENTER, zoom: DEFAULT_ZOOM, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM,
  maxBounds: CHICAGO_BOUNDS, maxBoundsViscosity: 0.8,
});
L.tileLayer(TILE_URL, { maxZoom: MAX_ZOOM, attribution: TILE_ATTRIBUTION }).addTo(map);
L.control.scale({ imperial: true, metric: true }).addTo(map);

// Leaflet 1.9 drops a setView made while a zoom animation is running: the
// animation's end restores its own target. Wait for it to finish first.
function recenter() {
  const go = () => map.setView(LOOP_CENTER, DEFAULT_ZOOM);
  if (map._animatingZoom) map.once('zoomend', go); else go();
}

// Exposed for browser tests and debugging.
globalThis.pedway = { map, shell };
document.documentElement.dataset.ready = 'true';
