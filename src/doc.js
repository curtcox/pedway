// The shareable map document: everything a link carries.
import { encodeGeohash, decodeGeohash, GEOHASH_PATTERN } from './geohash.js';
import { LOOP_CENTER, DEFAULT_ZOOM, MIN_ZOOM, MAX_ZOOM, CHICAGO_BOUNDS } from './map-defaults.js';

export const LAYERS = Object.freeze({
  pedway: true, access: true, cta: true, metra: true, restroom: true,
  food: false, store: false, museum: false, park: false,
});
export const LEVELS = Object.freeze(['both', 'pedway', 'street']);
export const ICONS = Object.freeze(['pin', 'star', 'door', 'train', 'food', 'restroom', 'info', 'flag']);
export const DEFAULT_PIN = Object.freeze({ label: '', icon: 'pin', color: '#c0392b', md: '' });
export const LIMITS = Object.freeze({ title: 120, pins: 200, label: 80, md: 10000, id: 16 });
const ID = /^[A-Za-z0-9_-]+$/, COLOR = /^#[0-9a-f]{6}$/;

const fail = message => { throw new Error(message); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;
function only(value, keys, what) {
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`Unknown ${what} field: ${key}.`);
}
export function inChicago(lat, lon) {
  const [[south, west], [north, east]] = CHICAGO_BOUNDS;
  return lat >= south && lat <= north && lon >= west && lon <= east;
}
function text(value, max, what) {
  if (value === undefined) return '';
  if (typeof value !== 'string') fail(`${what} must be text.`);
  if (value.length > max) fail(`${what} is longer than ${max} characters.`);
  return value;
}

export function defaultMap() {
  return { view: { c: [...LOOP_CENTER], z: DEFAULT_ZOOM }, level: 'both', layers: { ...LAYERS }, pins: [], gps: false };
}

function normalizeView(view = {}) {
  if (!plain(view)) fail('Map view must be an object.');
  only(view, ['c', 'z'], 'view');
  const c = view.c ?? LOOP_CENTER, z = view.z ?? DEFAULT_ZOOM;
  if (!Array.isArray(c) || c.length !== 2 || !c.every(Number.isFinite)) fail('Map centre must be [latitude, longitude].');
  if (!inChicago(c[0], c[1])) fail('Map centre is outside the Chicago area.');
  if (!Number.isInteger(z) || z < MIN_ZOOM || z > MAX_ZOOM) fail(`Zoom must be a whole number from ${MIN_ZOOM} to ${MAX_ZOOM}.`);
  return { c: [round(c[0], 5), round(c[1], 5)], z };
}

function normalizeLayers(layers = {}) {
  if (!plain(layers)) fail('Layers must be an object.');
  only(layers, Object.keys(LAYERS), 'layer');
  const result = { ...LAYERS };
  for (const [key, value] of Object.entries(layers)) {
    if (typeof value !== 'boolean') fail(`Layer ${key} must be true or false.`);
    result[key] = value;
  }
  return result;
}

export function normalizePin(pin) {
  if (!plain(pin)) fail('Each pin must be an object.');
  only(pin, ['id', 'at', 'label', 'icon', 'color', 'md'], 'pin');
  if (typeof pin.id !== 'string' || !ID.test(pin.id) || pin.id.length > LIMITS.id) fail('Pin id must be 1 to 16 letters, digits, - or _.');
  if (typeof pin.at !== 'string' || !GEOHASH_PATTERN.test(pin.at) || pin.at.length < 5) fail(`Pin ${pin.id} needs a geohash location of at least 5 characters.`);
  const { lat, lon } = decodeGeohash(pin.at);
  if (!inChicago(lat, lon)) fail(`Pin ${pin.id} is outside the Chicago area.`);
  const icon = pin.icon ?? DEFAULT_PIN.icon, color = (pin.color ?? DEFAULT_PIN.color).toLowerCase();
  if (!ICONS.includes(icon)) fail(`Pin ${pin.id} has an unknown icon.`);
  if (!COLOR.test(color)) fail(`Pin ${pin.id} colour must look like #rrggbb.`);
  return { id: pin.id, at: pin.at, label: text(pin.label, LIMITS.label, 'Pin label'), icon, color, md: text(pin.md, LIMITS.md, 'Pin note') };
}

export function normalizeMap(map = {}) {
  if (!plain(map)) fail('Map must be an object.');
  only(map, ['view', 'level', 'layers', 'pins', 'gps'], 'map');
  const level = map.level ?? 'both';
  if (!LEVELS.includes(level)) fail('Level must be both, pedway or street.');
  const pins = map.pins ?? [];
  if (!Array.isArray(pins)) fail('Pins must be a list.');
  if (pins.length > LIMITS.pins) fail(`A map can have at most ${LIMITS.pins} pins.`);
  const normalized = pins.map(normalizePin), ids = new Set(normalized.map(pin => pin.id));
  if (ids.size !== normalized.length) fail('Pin ids must be unique.');
  if (map.gps !== undefined && typeof map.gps !== 'boolean') fail('gps must be true or false.');
  return { view: normalizeView(map.view), level, layers: normalizeLayers(map.layers), pins: normalized, gps: map.gps ?? false };
}

export const type = Object.freeze({
  type: 'pedway-map',
  settingsKeys: [],
  fileName: 'pedway-map.json',
  contentType: 'application/json',
  // src is the map's title.
  normalize(value) {
    if (!plain(value)) fail('A map document must be an object.');
    only(value, ['src', 'map'], 'document');
    return { src: text(value.src, LIMITS.title, 'Title'), map: normalizeMap(value.map) };
  },
  isDefault(doc) {
    return JSON.stringify(doc.map) === JSON.stringify(normalizeMap(defaultMap()));
  },
});

export function pinAt(lat, lon, fields = {}) {
  return normalizePin({ ...DEFAULT_PIN, ...fields, at: encodeGeohash(lat, lon, 9) });
}
export function pinLocation(pin) { const { lat, lon } = decodeGeohash(pin.at); return [lat, lon]; }
