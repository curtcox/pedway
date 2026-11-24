// One place to parse and format locations in every supported style.
import { parseLatLon, formatDecimal, formatDms } from './latlon.js';
import { encodeGeohash, decodeGeohash, GEOHASH_PATTERN } from './geohash.js';
import { parseUsng, formatUsng, parseUtm, formatUtm } from './usng.js';
import { parseGridLocation, describeGrid } from './chicago-grid.js';
import { CHICAGO_BOUNDS } from '../map-defaults.js';

export const FORMATS = Object.freeze([
  { id: 'decimal', name: 'Latitude, longitude', example: '41.883720, -87.627810' },
  { id: 'dms', name: 'Degrees, minutes, seconds', example: '41°53′01.4″N 087°37′40.1″W' },
  { id: 'geohash', name: 'Geohash', example: 'dp3wmbxqk' },
  { id: 'usng', name: 'USNG / MGRS', example: '16T DM 47911 37056' },
  { id: 'utm', name: 'UTM', example: '16T 447911mE 4637056mN' },
  { id: 'grid', name: 'Chicago address grid', example: 'State St & Washington St' },
]);
export const FORMAT_IDS = Object.freeze(FORMATS.map(format => format.id));
export const DEFAULT_FORMAT = 'decimal';

const inChicago = ({ lat, lon }) => {
  const [[south, west], [north, east]] = CHICAGO_BOUNDS;
  return lat >= south && lat <= north && lon >= west && lon <= east;
};

/** Formats a point in the given style. */
export function formatLocation(lat, lon, format = DEFAULT_FORMAT) {
  switch (format) {
    case 'decimal': return formatDecimal(lat, lon);
    case 'dms': return formatDms(lat, lon);
    case 'geohash': return encodeGeohash(lat, lon, 9);
    case 'usng': return formatUsng(lat, lon);
    case 'utm': return formatUtm(lat, lon);
    case 'grid': return inChicago({ lat, lon }) ? describeGrid(lat, lon).label : 'Outside Chicago';
    default: throw new Error(`Unknown location format: ${format}.`);
  }
}

function geohash(text) {
  const prefixed = /^geohash:\s*(\S+)$/i.exec(text);
  const value = (prefixed ? prefixed[1] : text).toLowerCase();
  if (!GEOHASH_PATTERN.test(value) || (!prefixed && value.length < 5)) return null;
  const { lat, lon } = decodeGeohash(value);
  return { lat, lon, explicit: Boolean(prefixed) };
}

// Each parser returns a point, or null when the text is clearly not in its format.
const PARSERS = [
  ['grid', text => parseGridLocation(text)],
  ['usng', text => parseUsng(text)],
  ['utm', text => parseUtm(text)],
  ['decimal', text => {
    const point = parseLatLon(text);
    if (!point) return null;
    // "-87.62, 41.88": longitude first, which is what GeoJSON and some tools write.
    const swapped = { lat: point.lon, lon: point.lat };
    if (!inChicago(point) && Math.abs(point.lon) <= 90 && inChicago(swapped)) return swapped;
    return point;
  }],
  ['geohash', text => {
    const point = geohash(text);
    return point && (point.explicit || inChicago(point)) ? point : null;
  }],
];

/**
 * Parses any supported location. Returns { lat, lon, format, label? }.
 * Throws with a readable message when nothing matches or the text is malformed.
 * When several formats could read the text, the first reading inside Chicago wins.
 */
export function parseLocation(input) {
  const text = String(input ?? '').trim();
  if (!text) throw new Error('Enter a location.');
  const found = [];
  let firstError = null;
  for (const [format, parse] of PARSERS) {
    try {
      const point = parse(text);
      if (point) found.push({ lat: point.lat, lon: point.lon, format, ...(point.label ? { label: point.label } : {}) });
    } catch (error) { firstError ??= error; }
  }
  const best = found.find(inChicago) ?? found[0];
  if (best) return best;
  if (firstError) throw firstError;
  throw new Error(`Could not read “${text.length > 60 ? text.slice(0, 57) + '…' : text}” as a location. Try 41.8837, -87.6278, an address like 123 N State St, or a corner like Clark & Lake.`);
}
