// The lines and labels of the coordinate overlays, for the part of the map in view.
// Pure functions of the view (bounds in degrees and size in pixels), so they can be
// tested without a browser. Each returns { lines, labels, step }:
//   lines:  [{ points: [[lat, lon], …], major }]
//   labels: [{ lat, lon, text, edge }]  edge: 'top' | 'left' | 'cell' (where it sits)
// See docs/map-layers.md, section 5.
import { encodeGeohash } from '../geo/geohash.js';
import { toUtm, fromUtm, formatUsng } from '../geo/usng.js';
import { gridToLatLon, latLonToGrid, gridNumberLabel, streetOnLine } from '../geo/chicago-grid.js';

// Lines closer than this many pixels apart are too dense; the next coarser step is used.
export const MIN_SPACING = 70;
// Never more than this many lines per direction, or labels in all.
export const MAX_LINES = 40, MAX_LABELS = 150;

const degreesPerPixel = ({ west, east }, { x }) => (east - west) / x;
// Edge labels sit this many pixels inside the top and left edges of the view
// (options.inset), so callers can keep them clear of controls and of each other.
const DEFAULT_INSET = { top: 14, left: 6 };
const inset = (bounds, size, { top, left } = DEFAULT_INSET) => ({ lat: bounds.north - top * (bounds.north - bounds.south) / size.y, lon: bounds.west + left * degreesPerPixel(bounds, size) });
const multiples = (low, high, step) => {
  const out = [];
  for (let v = Math.ceil(low / step) * step; v <= high + 1e-12 && out.length <= MAX_LINES; v += step) out.push(Math.round(v / step) * step);
  return out;
};
const pick = (steps, pixelsPerUnit) => steps.find(step => step * pixelsPerUnit >= MIN_SPACING) ?? steps[steps.length - 1];

// --- Latitude and longitude ------------------------------------------------

const DECIMAL_STEPS = [0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1];
// Seconds and minutes, as degrees.
const DMS_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600].map(s => s / 3600);

function dmsText(value, positive, negative) {
  const hemi = value < 0 ? negative : positive;
  let total = Math.round(Math.abs(value) * 3600);
  const d = Math.floor(total / 3600); total -= d * 3600;
  const m = Math.floor(total / 60), s = total - m * 60;
  return `${d}°${String(m).padStart(2, '0')}′${s ? `${String(s).padStart(2, '0')}″` : ''}${hemi}`;
}
const decimals = step => Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));

/** A latitude/longitude graticule. options.format: 'dms' labels in degrees, minutes, seconds; anything else in decimal degrees. */
export function graticule(bounds, size, { format = 'decimal', inset: edges } = {}) {
  const dms = format === 'dms';
  const perPixel = degreesPerPixel(bounds, size);
  const step = pick(dms ? DMS_STEPS : DECIMAL_STEPS, 1 / perPixel);
  const at = inset(bounds, size, edges);
  const text = (value, pos, neg) => dms ? dmsText(value, pos, neg) : `${value.toFixed(decimals(step))}°`;
  const lats = multiples(bounds.south, bounds.north, step), lons = multiples(bounds.west, bounds.east, step);
  return {
    step,
    lines: [...lats.map(lat => ({ points: [[lat, bounds.west], [lat, bounds.east]] })), ...lons.map(lon => ({ points: [[bounds.south, lon], [bounds.north, lon]] }))],
    labels: [...lats.map(lat => ({ lat, lon: at.lon, text: text(lat, 'N', 'S'), edge: 'left' })),
      ...lons.map(lon => ({ lat: at.lat, lon, text: text(lon, 'E', 'W'), edge: 'top' }))].slice(0, MAX_LABELS),
  };
}

// --- Geohash -------------------------------------------------------------------

/** The size in degrees of a geohash cell of this many characters. */
export function geohashCellSize(precision) {
  const bits = 5 * precision;
  return { lat: 180 / 2 ** Math.floor(bits / 2), lon: 360 / 2 ** Math.ceil(bits / 2) };
}
/** Geohash cell boundaries, each cell labelled with its hash, at the finest precision whose cells are big enough to label. */
export function geohashGrid(bounds, size, { precision: fixed } = {}) {
  const perPixel = degreesPerPixel(bounds, size);
  let precision = fixed ?? 1;
  // Cells must be wide enough for their label (about 9 px per character) and not too many.
  for (let p = 1; p <= 9 && !fixed; p++) {
    const cell = geohashCellSize(p);
    const count = ((bounds.north - bounds.south) / cell.lat + 1) * ((bounds.east - bounds.west) / cell.lon + 1);
    if (cell.lon / perPixel < Math.max(MIN_SPACING, 9 * p + 12) || count > MAX_LABELS) break;
    precision = p;
  }
  const cell = geohashCellSize(precision);
  // Boundaries are multiples of the cell size counted from -90 and -180.
  const lats = multiples(bounds.south + 90, bounds.north + 90, cell.lat).map(v => v - 90);
  const lons = multiples(bounds.west + 180, bounds.east + 180, cell.lon).map(v => v - 180);
  const rowStarts = [Math.floor((bounds.south + 90) / cell.lat) * cell.lat - 90, ...lats.filter(v => v > bounds.south)];
  const colStarts = [Math.floor((bounds.west + 180) / cell.lon) * cell.lon - 180, ...lons.filter(v => v > bounds.west)];
  const labels = [];
  for (const south of rowStarts) for (const west of colStarts) {
    const lat = south + cell.lat / 2, lon = west + cell.lon / 2;
    if (labels.length < MAX_LABELS) labels.push({ lat, lon, text: encodeGeohash(lat, lon, precision), edge: 'cell' });
  }
  return {
    step: precision,
    lines: [...lats.map(lat => ({ points: [[lat, bounds.west], [lat, bounds.east]] })), ...lons.map(lon => ({ points: [[bounds.south, lon], [bounds.north, lon]] }))],
    labels,
  };
}

// --- USNG ------------------------------------------------------------------------

const USNG_STEPS = [10, 100, 1000, 10000, 100000];
// Grid lines are straight in UTM but slightly curved in latitude/longitude, so each is sampled.
const SAMPLES = 6;

/** The USNG (UTM) grid in the zone of the view's centre, labelled with grid digits at the edges. */
export function usngGrid(bounds, size, { inset: edges } = {}) {
  const centre = { lat: (bounds.south + bounds.north) / 2, lon: (bounds.west + bounds.east) / 2 };
  const { zone, hemisphere } = toUtm(centre.lat, centre.lon);
  const corners = [[bounds.south, bounds.west], [bounds.south, bounds.east], [bounds.north, bounds.west], [bounds.north, bounds.east]].map(([lat, lon]) => toUtm(lat, lon, zone));
  const minE = Math.min(...corners.map(c => c.easting)), maxE = Math.max(...corners.map(c => c.easting));
  const minN = Math.min(...corners.map(c => c.northing)), maxN = Math.max(...corners.map(c => c.northing));
  const step = pick(USNG_STEPS, size.x / (maxE - minE));
  const digits = 5 - Math.round(Math.log10(step));
  const gridText = value => step >= 100000 ? '' : String(Math.floor((value % 100000) / step)).padStart(digits, '0');
  const sample = (from, to) => Array.from({ length: SAMPLES + 1 }, (_, i) => from + (to - from) * i / SAMPLES);
  const point = (e, n) => { const { lat, lon } = fromUtm(zone, hemisphere, e, n); return [lat, lon]; };
  const eastings = multiples(minE, maxE, step), northings = multiples(minN, maxN, step);
  const at = inset(bounds, size, edges);
  const labels = [];
  // The zone and 100 km square ("16T DM") lead the first label along the top edge.
  const square = formatUsng(centre.lat, centre.lon, 1).split(' ').slice(0, 2).join(' ');
  for (const e of eastings) {
    // Where this easting line crosses the top edge of the view.
    const n = toUtm(at.lat, bounds.west, zone).northing;
    const [lat, lon] = point(e, n);
    const text = [labels.length ? '' : square, gridText(e)].filter(Boolean).join(' ');
    if (text && labels.length < MAX_LABELS) labels.push({ lat: at.lat, lon, text, edge: 'top' });
  }
  if (!labels.length) labels.push({ lat: at.lat, lon: at.lon, text: square, edge: 'top-start' });
  for (const n of northings) {
    const e = toUtm(bounds.south, at.lon, zone).easting;
    const [lat] = point(e, n);
    if (gridText(n) && labels.length < MAX_LABELS) labels.push({ lat, lon: at.lon, text: gridText(n), edge: 'left' });
  }
  return {
    step, zone,
    lines: [...eastings.map(e => ({ points: sample(minN, maxN).map(n => point(e, n)), major: e % (step * 10) === 0 })),
      ...northings.map(n => ({ points: sample(minE, maxE).map(e => point(e, n)), major: n % (step * 10) === 0 }))],
    labels,
  };
}

// --- Chicago address grid ----------------------------------------------------------

// Grid numbers: 800 is a mile, 400 a half mile, 100 a block.
const ADDRESS_STEPS = [100, 200, 400, 800, 1600, 3200, 8000];

/** Chicago address-grid lines (from the calibrated model in chicago-grid.js), labelled with their numbers and street names. */
export function addressGrid(bounds, size, { inset: edges } = {}) {
  const corners = [[bounds.south, bounds.west], [bounds.south, bounds.east], [bounds.north, bounds.west], [bounds.north, bounds.east]].map(([lat, lon]) => latLonToGrid(lat, lon));
  const minNs = Math.min(...corners.map(c => c.ns)), maxNs = Math.max(...corners.map(c => c.ns));
  const minEw = Math.min(...corners.map(c => c.ew)), maxEw = Math.max(...corners.map(c => c.ew));
  const step = pick(ADDRESS_STEPS, size.x / (maxEw - minEw));
  const sample = (from, to) => Array.from({ length: SAMPLES + 1 }, (_, i) => from + (to - from) * i / SAMPLES);
  const point = (ns, ew) => { const { lat, lon } = gridToLatLon(ns, ew); return [lat, lon]; };
  const name = (runs, at) => {
    const street = streetOnLine(runs, at);
    const number = at === 0 ? '0' : runs === 'ns' ? gridNumberLabel(at, 'E', 'W') : gridNumberLabel(at, 'N', 'S');
    return street ? `${number} · ${street}` : number;
  };
  const ews = multiples(minEw, maxEw, step), nss = multiples(minNs, maxNs, step);
  const at = inset(bounds, size, edges);
  const labels = [];
  // Lines with a fixed east/west number run north–south: label them along the top edge.
  for (const ew of ews) {
    const ns = latLonToGrid(at.lat, bounds.west).ns;
    if (labels.length < MAX_LABELS) labels.push({ lat: at.lat, lon: point(ns, ew)[1], text: name('ns', ew), edge: 'top' });
  }
  for (const ns of nss) {
    const ew = latLonToGrid(bounds.south, at.lon).ew;
    if (labels.length < MAX_LABELS) labels.push({ lat: point(ns, ew)[0], lon: at.lon, text: name('ew', ns), edge: 'left' });
  }
  return {
    step,
    lines: [...ews.map(ew => ({ points: sample(minNs, maxNs).map(ns => point(ns, ew)), major: ew % 800 === 0 })),
      ...nss.map(ns => ({ points: sample(minEw, maxEw).map(ew => point(ns, ew)), major: ns % 800 === 0 }))],
    labels,
  };
}
