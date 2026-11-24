// Map files: the app's own JSON document, and GeoJSON for other mapping tools.
// Pure functions, so they run under node:test as well as in the browser.
import { encodeGeohash, decodeGeohash, GEOHASH_PATTERN } from './geo/geohash.js';
import { ICONS, LIMITS, DEFAULT_PIN, inChicago, normalizePin, pinLocation, type } from './doc.js';

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const ACCEPT = '.json,.geojson,application/json,application/geo+json';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;

/** A file name made from the map's title. */
export function fileStem(title) {
  const stem = String(title ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return stem || 'pedway-map';
}

/** Pins as GeoJSON points. The `pedway` foreign member lets this app reopen the whole map. */
export function toGeoJSON(doc) {
  const { view, level, base, layers, overlays, gps } = doc.map;
  return {
    type: 'FeatureCollection',
    name: doc.src || 'Pedway map',
    pedway: { version: 1, title: doc.src, view, level, base, layers, overlays, gps },
    features: doc.map.pins.map(pin => {
      const [lat, lon] = pinLocation(pin);
      return {
        type: 'Feature', id: pin.id,
        geometry: { type: 'Point', coordinates: [round(lon, 6), round(lat, 6)] },
        properties: { name: pin.label, description: pin.md, 'marker-color': pin.color, icon: pin.icon, geohash: pin.at },
      };
    }),
  };
}

function colour(value) {
  if (typeof value !== 'string') return DEFAULT_PIN.color;
  const short = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value), long = /^#?([0-9a-f]{6})$/i.exec(value);
  if (long) return '#' + long[1].toLowerCase();
  if (short) return '#' + short.slice(1).map(c => c + c).join('').toLowerCase();
  return DEFAULT_PIN.color;
}
const firstText = (...values) => values.find(value => typeof value === 'string') ?? '';

/** Reads points from any GeoJSON object. Returns the pins plus counts of what was left out. */
export function fromGeoJSON(value) {
  const features = value?.type === 'FeatureCollection' ? value.features : value?.type === 'Feature' ? [value] : null;
  if (!Array.isArray(features)) throw new Error('This GeoJSON has no features.');
  const skipped = { notPoint: 0, outside: 0, tooMany: 0 };
  const pins = [], ids = new Set();
  for (const feature of features) {
    const coordinates = feature?.geometry?.type === 'Point' ? feature.geometry.coordinates : null;
    if (!Array.isArray(coordinates) || !Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1])) { skipped.notPoint++; continue; }
    const [lon, lat] = coordinates;
    if (!inChicago(lat, lon)) { skipped.outside++; continue; }
    if (pins.length >= LIMITS.pins) { skipped.tooMany++; continue; }
    const props = plain(feature.properties) ? feature.properties : {};
    // Keep the exact geohash when it still matches the coordinates; otherwise encode them.
    let at = encodeGeohash(lat, lon, 9);
    if (typeof props.geohash === 'string' && GEOHASH_PATTERN.test(props.geohash) && props.geohash.length >= 5) {
      const cell = decodeGeohash(props.geohash);
      if (Math.abs(cell.lat - lat) < 0.0001 && Math.abs(cell.lon - lon) < 0.0001) at = props.geohash;
    }
    const id = String(feature.id ?? '');
    const pin = normalizePin({
      id: /^[A-Za-z0-9_-]{1,16}$/.test(id) && !ids.has(id) ? id : 'tmp' + pins.length, at,
      label: [...firstText(props.name, props.title, props.label)].slice(0, LIMITS.label).join('').trim(),
      md: [...firstText(props.description, props.md, props.notes, props.note)].slice(0, LIMITS.md).join(''),
      icon: ICONS.includes(props.icon) ? props.icon : DEFAULT_PIN.icon,
      color: colour(props['marker-color'] ?? props.color),
    });
    ids.add(pin.id); pins.push(pin);
  }
  const meta = plain(value.pedway) ? value.pedway : null;
  const title = firstText(meta?.title, value.name, value.title).slice(0, LIMITS.title);
  return { title, meta, pins: renumber(pins), skipped };
}

// Temporary ids become the next free p1, p2, …
function renumber(pins, taken = new Set()) {
  const used = new Set([...taken, ...pins.filter(pin => !pin.id.startsWith('tmp')).map(pin => pin.id)]);
  let n = 1;
  return pins.map(pin => {
    if (!pin.id.startsWith('tmp') && !taken.has(pin.id)) return pin;
    while (used.has('p' + n)) n++;
    used.add('p' + n);
    return { ...pin, id: 'p' + n };
  });
}

/** A map document from imported GeoJSON. View and layers come from a Pedway export, or fit the pins. */
export function geoJSONMap({ title, meta, pins }, base = {}) {
  const fitted = { ...base, pins, ...(pins.length ? { view: { c: centre(pins), z: 16 } } : {}) };
  if (!meta) return type.normalize({ src: title, map: fitted });
  const map = { ...base, pins };
  for (const key of ['view', 'level', 'base', 'layers', 'overlays', 'gps']) if (meta[key] !== undefined) map[key] = meta[key];
  // A damaged or edited `pedway` member never blocks the pins themselves.
  try { return type.normalize({ src: title, map }); } catch { return type.normalize({ src: title, map: fitted }); }
}
function centre(pins) {
  const points = pins.map(pinLocation);
  const lat = points.reduce((sum, [value]) => sum + value, 0) / points.length;
  const lon = points.reduce((sum, [, value]) => sum + value, 0) / points.length;
  return [lat, lon];
}

/** Adds imported pins to an existing list, renaming clashing ids. Returns the list and how many did not fit. */
export function mergePins(existing, incoming) {
  const room = Math.max(0, LIMITS.pins - existing.length);
  const taken = new Set(existing.map(pin => pin.id));
  const added = renumber(incoming.slice(0, room).map(pin => taken.has(pin.id) ? { ...pin, id: 'tmp' + pin.id } : pin), taken);
  return { pins: [...existing, ...added], dropped: incoming.length - added.length };
}

/** Works out what a file holds: { kind: 'map', doc } | { kind: 'geojson', … } | { kind: 'library' }. */
export function readMapFile(text, documents) {
  if (text.length > MAX_FILE_BYTES) throw new Error('This file is too large to be a map.');
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('This file is not a Pedway map or GeoJSON file.'); }
  if (value?.format === 'fragment-kit-library') return { kind: 'library' };
  if (value?.type === 'FeatureCollection' || value?.type === 'Feature') return { kind: 'geojson', ...fromGeoJSON(value) };
  if (!plain(value) || typeof value.src !== 'string') throw new Error('This file is not a Pedway map or GeoJSON file.');
  return { kind: 'map', doc: documents.parse(text) };
}

/** One line describing what an import left out, or ''. */
export function skippedNote({ notPoint = 0, outside = 0, tooMany = 0 } = {}) {
  const parts = [];
  if (notPoint) parts.push(`${notPoint} feature${notPoint === 1 ? ' that is not a point' : 's that are not points'}`);
  if (outside) parts.push(`${outside} outside the Chicago area`);
  if (tooMany) parts.push(`${tooMany} over the ${LIMITS.pins}-pin limit`);
  return parts.length ? `Left out ${parts.join(', ')}.` : '';
}
