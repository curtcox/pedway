// UTM and USNG/MGRS on the WGS84 ellipsoid, using Krüger's series to sixth
// order (Karney 2011), which is accurate to well under a millimetre within a zone.
// Chicago is in UTM zone 16, latitude band T: "16T DM 47906 36872".

const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
const n = f / (2 - f), n2 = n * n, n3 = n2 * n, n4 = n3 * n, n5 = n4 * n, n6 = n5 * n;
const A = a / (1 + n) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
const alpha = [0,
  n / 2 - 2 * n2 / 3 + 5 * n3 / 16 + 41 * n4 / 180 - 127 * n5 / 288 + 7891 * n6 / 37800,
  13 * n2 / 48 - 3 * n3 / 5 + 557 * n4 / 1440 + 281 * n5 / 630 - 1983433 * n6 / 1935360,
  61 * n3 / 240 - 103 * n4 / 140 + 15061 * n5 / 26880 + 167603 * n6 / 181440,
  49561 * n4 / 161280 - 179 * n5 / 168 + 6601661 * n6 / 7257600,
  34729 * n5 / 80640 - 3418889 * n6 / 1995840,
  212378941 * n6 / 319334400];
const beta = [0,
  n / 2 - 2 * n2 / 3 + 37 * n3 / 96 - n4 / 360 - 81 * n5 / 512 + 96199 * n6 / 604800,
  n2 / 48 + n3 / 15 - 437 * n4 / 1440 + 46 * n5 / 105 - 1118711 * n6 / 3870720,
  17 * n3 / 480 - 37 * n4 / 840 - 209 * n5 / 4480 + 5569 * n6 / 90720,
  4397 * n4 / 161280 - 11 * n5 / 504 - 830251 * n6 / 7257600,
  4583 * n5 / 161280 - 108847 * n6 / 3991680,
  20648693 * n6 / 638668800];
const e = Math.sqrt(f * (2 - f));
const rad = Math.PI / 180, FALSE_EASTING = 500000, FALSE_NORTHING_SOUTH = 10000000;
const BANDS = 'CDEFGHJKLMNPQRSTUVWX';
const fail = message => { throw new Error(message); };

export function zoneOf(lat, lon) {
  let zone = Math.floor((lon + 180) / 6) + 1;
  if (lon >= 180) zone = 60;
  // Norway and Svalbard exceptions.
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32;
  if (lat >= 72 && lat < 84) {
    if (lon >= 0 && lon < 9) zone = 31; else if (lon >= 9 && lon < 21) zone = 33;
    else if (lon >= 21 && lon < 33) zone = 35; else if (lon >= 33 && lon < 42) zone = 37;
  }
  return zone;
}
export const bandOf = lat => BANDS[Math.min(19, Math.floor((lat + 80) / 8))];

/** Latitude/longitude to UTM. Returns { zone, band, hemisphere, easting, northing }. */
export function toUtm(lat, lon, forceZone) {
  if (!(lat >= -80 && lat <= 84)) fail('UTM covers latitudes from 80°S to 84°N.');
  const zone = forceZone ?? zoneOf(lat, lon);
  const lon0 = (zone - 1) * 6 - 180 + 3;
  const phi = lat * rad, lambda = (lon - lon0) * rad;
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi)));
  const xiP = Math.atan2(t, Math.cos(lambda)), etaP = Math.atanh(Math.sin(lambda) / Math.sqrt(1 + t * t));
  let xi = xiP, eta = etaP;
  for (let j = 1; j <= 6; j++) {
    xi += alpha[j] * Math.sin(2 * j * xiP) * Math.cosh(2 * j * etaP);
    eta += alpha[j] * Math.cos(2 * j * xiP) * Math.sinh(2 * j * etaP);
  }
  const easting = FALSE_EASTING + k0 * A * eta;
  let northing = k0 * A * xi;
  if (lat < 0) northing += FALSE_NORTHING_SOUTH;
  return { zone, band: bandOf(lat), hemisphere: lat < 0 ? 'S' : 'N', easting, northing };
}

/** UTM to latitude/longitude. */
export function fromUtm(zone, hemisphere, easting, northing) {
  if (!Number.isInteger(zone) || zone < 1 || zone > 60) fail('UTM zone must be 1 to 60.');
  const xi = (hemisphere === 'S' ? northing - FALSE_NORTHING_SOUTH : northing) / (k0 * A);
  const eta = (easting - FALSE_EASTING) / (k0 * A);
  let xiP = xi, etaP = eta;
  for (let j = 1; j <= 6; j++) {
    xiP -= beta[j] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etaP -= beta[j] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const tauP = Math.sin(xiP) / Math.sqrt(Math.sinh(etaP) ** 2 + Math.cos(xiP) ** 2);
  // Newton's method for tau = tan(phi).
  let tau = tauP;
  for (let i = 0; i < 6; i++) {
    const sigma = Math.sinh(e * Math.atanh(e * tau / Math.sqrt(1 + tau * tau)));
    const tauI = tau * Math.sqrt(1 + sigma * sigma) - sigma * Math.sqrt(1 + tau * tau);
    const dTau = (tauP - tauI) / Math.sqrt(1 + tauI * tauI)
      * (1 + (1 - e * e) * tau * tau) / ((1 - e * e) * Math.sqrt(1 + tau * tau));
    tau += dTau;
    if (Math.abs(dTau) < 1e-12) break;
  }
  const lat = Math.atan(tau) / rad;
  const lon = (zone - 1) * 6 - 180 + 3 + Math.atan2(Math.sinh(etaP), Math.cos(xiP)) / rad;
  return { lat, lon };
}

export function formatUtm(lat, lon) {
  const { zone, band, easting, northing } = toUtm(lat, lon);
  return `${zone}${band} ${Math.floor(easting)}mE ${Math.floor(northing)}mN`;
}

// "16T 447906 4636872", "16T 447906mE 4636872mN", "16N 447906 4636872" (N = northern hemisphere band).
const UTM = /^\s*(\d{1,2})\s*([C-HJ-NP-X])\s+(\d{3,7}(?:\.\d+)?)\s*m?\s*E?\s*[,\s]\s*(\d{1,8}(?:\.\d+)?)\s*m?\s*N?\s*$/i;
export function parseUtm(input) {
  const m = UTM.exec(String(input));
  if (!m) return null;
  const zone = Number(m[1]), band = m[2].toUpperCase();
  if (zone < 1 || zone > 60) fail('UTM zone must be 1 to 60.');
  return fromUtm(zone, band >= 'N' ? 'N' : 'S', Number(m[3]), Number(m[4]));
}

// --- USNG / MGRS --------------------------------------------------------

const COLUMNS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
const ROWS = 'ABCDEFGHJKLMNPQRSTUV';
const columnLetters = zone => COLUMNS[(zone - 1) % 3];
const rowOffset = zone => (zone % 2 === 0 ? 5 : 0);

/** Latitude/longitude to USNG, e.g. "16T DM 47906 36872". digits per coordinate: 1–5 (5 = 1 m). */
export function formatUsng(lat, lon, digits = 5) {
  const { zone, band, easting, northing } = toUtm(lat, lon);
  const column = columnLetters(zone)[Math.floor(easting / 100000) - 1];
  const row = ROWS[(Math.floor(northing / 100000) + rowOffset(zone)) % 20];
  const scale = 10 ** (5 - digits);
  const e = String(Math.floor((easting % 100000) / scale)).padStart(digits, '0');
  const nn = String(Math.floor((northing % 100000) / scale)).padStart(digits, '0');
  return `${zone}${band} ${column}${row} ${e} ${nn}`;
}

// The lowest northing of each latitude band, used to pick the right 2,000 km cycle.
function bandMinNorthing(zone, band) {
  const lat = -80 + BANDS.indexOf(band) * 8;
  const lon0 = (zone - 1) * 6 - 180 + 3;
  // Sample the band's lower edge across the zone and take the smallest northing.
  let min = Infinity;
  for (const dl of [-3, 0, 3]) min = Math.min(min, toUtm(lat, lon0 + dl, zone).northing);
  return min;
}

const USNG = /^\s*(\d{1,2})\s*([C-HJ-NP-X])\s*([A-HJ-NP-Z])\s*([A-HJ-NP-V])\s*((?:\d\s*)*)$/i;
/** Parses USNG/MGRS such as "16T DM 47906 36872", "16TDM4790636872" or "16T DM 479 368". Returns the centre of the square. */
export function parseUsng(input) {
  const m = USNG.exec(String(input));
  if (!m) return null;
  const zone = Number(m[1]), band = m[2].toUpperCase(), column = m[3].toUpperCase(), row = m[4].toUpperCase();
  const digits = m[5].replace(/\s+/g, '');
  if (zone < 1 || zone > 60) fail('USNG zone must be 1 to 60.');
  if (digits.length % 2 || digits.length > 10) fail('USNG needs the same number of easting and northing digits (up to 5 each).');
  const columnIndex = columnLetters(zone).indexOf(column);
  if (columnIndex < 0) fail(`Square letter ${column} is not used in zone ${zone}.`);
  const half = digits.length / 2, scale = 10 ** (5 - half);
  const within = half ? [Number(digits.slice(0, half)) * scale, Number(digits.slice(half)) * scale] : [0, 0];
  const easting = (columnIndex + 1) * 100000 + within[0] + scale / 2;
  let northing = ((ROWS.indexOf(row) - rowOffset(zone) + 20) % 20) * 100000 + within[1] + scale / 2;
  const hemisphere = band >= 'N' ? 'N' : 'S';
  const min = bandMinNorthing(zone, band) - 100000;
  while (northing < min) northing += 2000000;
  return fromUtm(zone, hemisphere, easting, northing);
}
