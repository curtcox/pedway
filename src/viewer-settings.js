// Settings that belong to whoever is looking at the map, not to the map itself.
// They stay in this browser and never travel in shared links.
import { FORMAT_IDS, DEFAULT_FORMAT } from './geo/formats.js';

const KEY = 'pedway.viewer.v1';
function read() {
  try { const value = JSON.parse(localStorage.getItem(KEY) ?? '{}'); return value && typeof value === 'object' ? value : {}; }
  catch { return {}; }
}
function write(changes) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...read(), ...changes })); } catch { /* private mode: keep it for this page only */ }
}

let format = FORMAT_IDS.includes(read().format) ? read().format : DEFAULT_FORMAT;
export const getFormat = () => format;
export function setFormat(id) {
  if (!FORMAT_IDS.includes(id)) return;
  format = id; write({ format: id });
}

// The layers and view this viewer last chose start every new, blank map.
// A shared link carries its own and overrides these.
export function getLayerDefaults() {
  const { layers, level } = read();
  return { layers: layers && typeof layers === 'object' ? layers : null, level: typeof level === 'string' ? level : null };
}
export function setLayerDefaults({ layers, level }) { write({ layers, level }); }
