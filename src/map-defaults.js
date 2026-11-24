// The Loop, centred near State & Washington, where most of the Pedway runs.
export const LOOP_CENTER = Object.freeze([41.8837, -87.6278]);
export const DEFAULT_ZOOM = 16;
export const MIN_ZOOM = 11;
export const MAX_ZOOM = 19;
// Generous box around the city; keeps panning from drifting far away.
export const CHICAGO_BOUNDS = Object.freeze([[41.60, -88.00], [42.10, -87.45]]);
// The self-hosted base map covers this box: Chicago Ave to Roosevelt Rd, Halsted St
// to past the end of Navy Pier (docs/map-layers.md).
export const BASE_BOX = Object.freeze([[41.8665, -87.6480], [41.8975, -87.5950]]);
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';
