// Geohash encode/decode (https://en.wikipedia.org/wiki/Geohash).
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
export const GEOHASH_PATTERN = /^[0123456789bcdefghjkmnpqrstuvwxyz]{1,12}$/;

export function encodeGeohash(lat, lon, precision = 9) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) throw new Error('Coordinates are out of range.');
  if (!Number.isInteger(precision) || precision < 1 || precision > 12) throw new Error('Geohash precision must be 1 to 12.');
  const latRange = [-90, 90], lonRange = [-180, 180];
  let hash = '', bits = 0, value = 0, even = true;
  while (hash.length < precision) {
    const range = even ? lonRange : latRange, coordinate = even ? lon : lat, mid = (range[0] + range[1]) / 2;
    value <<= 1;
    if (coordinate >= mid) { value |= 1; range[0] = mid; } else range[1] = mid;
    even = !even;
    if (++bits === 5) { hash += BASE32[value]; bits = 0; value = 0; }
  }
  return hash;
}

/** Returns the cell's centre and its half-size in degrees. */
export function decodeGeohash(hash) {
  if (typeof hash !== 'string' || !GEOHASH_PATTERN.test(hash)) throw new Error('Invalid geohash.');
  const latRange = [-90, 90], lonRange = [-180, 180];
  let even = true;
  for (const char of hash) {
    const value = BASE32.indexOf(char);
    for (let bit = 4; bit >= 0; bit--) {
      const range = even ? lonRange : latRange, mid = (range[0] + range[1]) / 2;
      if ((value >> bit) & 1) range[0] = mid; else range[1] = mid;
      even = !even;
    }
  }
  return { lat: (latRange[0] + latRange[1]) / 2, lon: (lonRange[0] + lonRange[1]) / 2,
    error: { lat: (latRange[1] - latRange[0]) / 2, lon: (lonRange[1] - lonRange[0]) / 2 } };
}
