// Latitude/longitude in decimal degrees, degrees-minutes(-seconds) and
// hemisphere styles, plus coordinates pulled out of map links and geo: URIs.

const NUM = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)`;
const fail = message => { throw new Error(message); };

function check(lat, lon) {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) fail('Latitude must be between -90 and 90.');
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) fail('Longitude must be between -180 and 180.');
  return { lat, lon };
}

// One coordinate: "41.88", "41 53 1.4", "41°53′01.4″", "41d 53m", with an optional
// N/S/E/W letter before or after. Returns { value, hemi } or null.
const PART = new RegExp(String.raw`^\s*([NSEW])?\s*(${NUM})\s*(?:[°d:\s]\s*(${NUM})?\s*(?:['′m:\s]\s*(${NUM})?\s*(?:["″s]|'')?)?)?\s*([NSEW])?\s*$`, 'i');
function part(text) {
  const m = PART.exec(text.replace(/º/g, '°'));
  if (!m) return null;
  const [, before, d, mins, secs, after] = m;
  if (before && after) return null;
  const hemi = (before || after || '').toUpperCase() || null;
  const degrees = Number(d), minutes = mins === undefined ? 0 : Number(mins), seconds = secs === undefined ? 0 : Number(secs);
  if (minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) return null;
  if ((mins !== undefined || secs !== undefined) && !Number.isInteger(degrees) && degrees !== Math.trunc(degrees)) return null;
  if (secs !== undefined && mins !== undefined && !Number.isInteger(minutes)) return null;
  const sign = d.trim().startsWith('-') ? -1 : 1;
  let value = Math.abs(degrees) + minutes / 60 + seconds / 3600;
  value *= sign;
  if (hemi === 'S' || hemi === 'W') { if (sign < 0) return null; value = -value; }
  return { value, hemi };
}

// Splits "a, b" / "a b" / "41 53 N 87 37 W" into its two coordinates.
function halves(text) {
  const comma = text.split(/\s*[,;]\s*/);
  if (comma.length === 2) return [comma];
  const options = [];
  // Split after a hemisphere letter: "41 53 1 N 87 37 40 W".
  const afterLetter = /^(.*?[NS])\s*(.*)$/i.exec(text);
  if (afterLetter && afterLetter[2]) options.push([afterLetter[1], afterLetter[2]]);
  // Split before a leading hemisphere letter: "N41.8 W87.6".
  const beforeLetter = /^([NS].*?)\s+([EW].*)$/i.exec(text);
  if (beforeLetter) options.push([beforeLetter[1], beforeLetter[2]]);
  // Plain numbers split down the middle: "41 53 1 87 37 40" or "41.88 -87.62".
  const tokens = text.trim().split(/\s+/);
  if (tokens.length % 2 === 0) options.push([tokens.slice(0, tokens.length / 2).join(' '), tokens.slice(tokens.length / 2).join(' ')]);
  return options;
}

/** Parses many latitude/longitude spellings. Returns { lat, lon } or null if the text is not lat/lon. */
export function parseLatLon(input) {
  const text = String(input).trim();
  if (!text) return null;
  const fromLink = linkCoordinates(text);
  if (fromLink) return fromLink;
  if (!/^[\s\dNSEW.,;:°º'"′″dms+-]+$/i.test(text) || !/\d/.test(text)) return null;
  for (const [a, b] of halves(text)) {
    const first = part(a), second = part(b);
    if (!first || !second) continue;
    let lat, lon;
    const ns = h => h === 'N' || h === 'S', ew = h => h === 'E' || h === 'W';
    if (first.hemi && second.hemi && ns(first.hemi) === ns(second.hemi)) continue;
    if ((first.hemi && ew(first.hemi)) || (second.hemi && ns(second.hemi))) { lat = second.value; lon = first.value; }
    else if ((first.hemi && ns(first.hemi)) || (second.hemi && ew(second.hemi))) { lat = first.value; lon = second.value; }
    // No letters: latitude first, unless only the other order makes sense.
    else if (Math.abs(first.value) > 90 && Math.abs(second.value) <= 90) { lat = second.value; lon = first.value; }
    else { lat = first.value; lon = second.value; }
    return check(lat, lon);
  }
  return null;
}

// geo:41.88,-87.62 · …/@41.88,-87.62,17z · ?q=41.88,-87.62 · ?ll= · ?mlat=&mlon= · #map=17/41.88/-87.62
function linkCoordinates(text) {
  let m = new RegExp(String.raw`^geo:(${NUM}),(${NUM})`, 'i').exec(text);
  if (!m && /^https?:\/\//i.test(text)) {
    m = new RegExp(String.raw`[@=](${NUM}),\s*(${NUM})`).exec(decodeURIComponent(text))
      ?? new RegExp(String.raw`mlat=(${NUM}).*?mlon=(${NUM})`).exec(text)
      ?? new RegExp(String.raw`#map=\d+/(${NUM})/(${NUM})`).exec(text);
  }
  return m ? check(Number(m[1]), Number(m[2])) : null;
}

const fixed = (value, places) => value.toFixed(places).replace(/^-(0\.0*)$/, '$1');
export function formatDecimal(lat, lon, places = 6) { return `${fixed(lat, places)}, ${fixed(lon, places)}`; }

function dms(value, positive, negative, width) {
  const hemi = value < 0 ? negative : positive;
  let tenths = Math.round(Math.abs(value) * 36000);
  const d = Math.floor(tenths / 36000); tenths -= d * 36000;
  const m = Math.floor(tenths / 600); tenths -= m * 600;
  const s = (tenths / 10).toFixed(1).padStart(4, '0');
  return `${String(d).padStart(width, '0')}°${String(m).padStart(2, '0')}′${s}″${hemi}`;
}
export function formatDms(lat, lon) { return `${dms(lat, 'N', 'S', 2)} ${dms(lon, 'E', 'W', 3)}`; }
export function formatHemisphere(lat, lon, places = 5) {
  return `${Math.abs(lat).toFixed(places)}°${lat < 0 ? 'S' : 'N'} ${Math.abs(lon).toFixed(places)}°${lon < 0 ? 'W' : 'E'}`;
}
