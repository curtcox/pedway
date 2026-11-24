// Street-address lookup through OpenStreetMap's Nominatim, used only when the
// user explicitly searches for something the app cannot read by itself.
// Follows the usage policy (https://operations.osmfoundation.org/policies/nominatim/):
// at most one request per second, results cached, no autocomplete.
import { CHICAGO_BOUNDS } from '../map-defaults.js';

export const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const MIN_INTERVAL_MS = 1100;
const cache = new Map();
let last = 0, queue = Promise.resolve();

export function nominatimUrl(query) {
  const [[south, west], [north, east]] = CHICAGO_BOUNDS;
  return `${NOMINATIM}?${new URLSearchParams({ q: query, format: 'jsonv2', limit: '5', countrycodes: 'us', bounded: '1', viewbox: `${west},${north},${east},${south}` })}`;
}

/** Returns up to five places inside the Chicago area: [{ name, lat, lon }]. */
export function geocode(query, { fetchImpl = fetch, now = () => Date.now(), wait = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const key = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (cache.has(key)) return cache.get(key);
  const result = queue.then(async () => {
    const delay = last + MIN_INTERVAL_MS - now();
    if (delay > 0) await wait(delay);
    last = now();
    const response = await fetchImpl(nominatimUrl(query), { headers: { Accept: 'application/json' }, referrerPolicy: 'strict-origin-when-cross-origin' });
    if (!response.ok) throw new Error(`OpenStreetMap search answered ${response.status}.`);
    const places = await response.json();
    if (!Array.isArray(places)) throw new Error('OpenStreetMap search sent an unexpected reply.');
    return places.map(place => ({ name: String(place.display_name ?? '').replace(/, (Cook County|Illinois|United States)\b.*$/, ''), lat: Number(place.lat), lon: Number(place.lon) }))
      .filter(place => Number.isFinite(place.lat) && Number.isFinite(place.lon));
  });
  queue = result.catch(() => {});
  cache.set(key, result);
  result.catch(() => cache.delete(key));
  return result;
}
export function clearGeocodeCache() { cache.clear(); last = 0; }
