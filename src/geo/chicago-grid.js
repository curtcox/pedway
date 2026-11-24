// Chicago's address grid. Addresses count from State Street (east/west) and
// Madison Street (north/south), nominally 800 numbers to the mile, though
// downtown blocks and the near South Side are irregular.
//
// The model is two piecewise-linear profiles measured from OpenStreetMap
// crossings (scripts/grid-survey.mjs, © OpenStreetMap contributors, ODbL):
// one along State Street for the north/south number, one along Madison Street
// for the east/west number. The grid is slightly rotated, so each profile also
// carries the drift of the other coordinate. Accuracy is a few tens of metres
// in and near the Loop and usually under 150 m across the city.

// [north (+) / south (−) number, latitude, longitude of State St there]
const NS = [
  [-13800, 41.644578, -87.621855], [-12700, 41.663466, -87.622087], [-11900, 41.678027, -87.622653],
  [-11100, 41.692585, -87.623115], [-10300, 41.707170, -87.623540], [-9500, 41.721709, -87.623732],
  [-8700, 41.736316, -87.624167], [-7900, 41.751014, -87.624593], [-7100, 41.765453, -87.624943],
  [-6300, 41.780060, -87.625367], [-5500, 41.794478, -87.625698], [-4700, 41.809243, -87.626082],
  [-3900, 41.823719, -87.626419], [-3100, 41.838296, -87.626677], [-2600, 41.845593, -87.626860],
  [-2200, 41.852874, -87.627093], [-1800, 41.857831, -87.627223], [-1600, 41.860181, -87.627269],
  [-1200, 41.867419, -87.627444], [-900, 41.870544, -87.627530], [-600, 41.874474, -87.627596],
  [-400, 41.876938, -87.627664], [-300, 41.878211, -87.627695], [-200, 41.879480, -87.627723],
  [-100, 41.880755, -87.627760], [0, 41.882045, -87.627809], [100, 41.883248, -87.627866],
  [150, 41.884489, -87.627902], [200, 41.885755, -87.627936], [400, 41.889259, -87.628007],
  [500, 41.890871, -87.628048], [600, 41.892476, -87.628094], [700, 41.894879, -87.628160],
  [800, 41.896678, -87.628210], [900, 41.899141, -87.628287], [1000, 41.900673, -87.628338],
  // State St ends near Division; further north is Western Ave shifted onto State.
  [1200, 41.903904, -87.628395], [1600, 41.911203, -87.628584], [2400, 41.925781, -87.629022],
  [3200, 41.940346, -87.629449], [4000, 41.954914, -87.629846], [4800, 41.969491, -87.630270],
  [5600, 41.984045, -87.630792], [7600, 42.020411, -87.631556],
];
// [east (+) / west (−) number, latitude of Madison St there, longitude]
const EW = [
  [-6000, 41.880088, -87.774657], [-5600, 41.880251, -87.764858], [-5200, 41.880370, -87.755057],
  [-4800, 41.880490, -87.745272], [-4400, 41.880611, -87.735468], [-4000, 41.880732, -87.725656],
  [-3200, 41.880981, -87.706120], [-2800, 41.881078, -87.696286], [-2400, 41.881166, -87.686432],
  [-2000, 41.881323, -87.676638], [-1800, 41.881398, -87.671746], [-1200, 41.881625, -87.656915],
  [-800, 41.881782, -87.647361], [-600, 41.881847, -87.642672], [-500, 41.881889, -87.639706],
  [-300, 41.881924, -87.635343], [-200, 41.881941, -87.633848], [-100, 41.881984, -87.630875],
  [0, 41.882045, -87.627809], [100, 41.882115, -87.624508], [300, 41.882100, -87.620569],
];
const [, LAT0, LON0] = NS.find(row => row[0] === 0);

// Linear interpolation over a sorted table, extrapolating from the end segments.
function along(table, x, column) {
  let i = 1;
  while (i < table.length - 1 && x > table[i][0]) i++;
  const [x0, ...a] = table[i - 1], [x1, ...b] = table[i];
  const t = (x - x0) / (x1 - x0);
  return a[column - 1] + t * (b[column - 1] - a[column - 1]);
}
function inverse(table, value, column) {
  const rising = table.at(-1)[column] > table[0][column];
  let i = 1;
  while (i < table.length - 1 && (rising ? value > table[i][column] : value < table[i][column])) i++;
  const a = table[i - 1], b = table[i];
  return a[0] + (value - a[column]) * (b[0] - a[0]) / (b[column] - a[column]);
}

/** Grid numbers (north positive, east positive) to latitude/longitude. */
export function gridToLatLon(ns, ew) {
  return {
    lat: along(NS, ns, 1) + (along(EW, ew, 1) - LAT0),
    lon: along(EW, ew, 2) + (along(NS, ns, 2) - LON0),
  };
}

/** Latitude/longitude to grid numbers, by fixed-point iteration on the model. */
export function latLonToGrid(lat, lon) {
  let ns = inverse(NS, lat, 1), ew = inverse(EW, lon, 2);
  for (let k = 0; k < 6; k++) {
    ns = inverse(NS, lat - (along(EW, ew, 1) - LAT0), 1);
    ew = inverse(EW, lon - (along(NS, ns, 2) - LON0), 2);
  }
  return { ns, ew };
}

// --- Streets -------------------------------------------------------------

// [name, suffix, runs ('ns' = runs north–south, so it has a fixed east/west number), number]
const STREETS = [
  // North–south streets: east (+) / west (−) number.
  ['Columbus', 'Dr', 'ns', 300], ['Michigan', 'Ave', 'ns', 100], ['Wabash', 'Ave', 'ns', 45],
  ['State', 'St', 'ns', 0], ['Dearborn', 'St', 'ns', -36], ['Clark', 'St', 'ns', -100],
  ['LaSalle', 'St', 'ns', -140], ['Wells', 'St', 'ns', -200], ['Franklin', 'St', 'ns', -300],
  ['Wacker', 'Dr', 'ns', -360], ['Canal', 'St', 'ns', -500], ['Clinton', 'St', 'ns', -540],
  ['Jefferson', 'St', 'ns', -600], ['Desplaines', 'St', 'ns', -650], ['Halsted', 'St', 'ns', -800],
  ['Morgan', 'St', 'ns', -1000], ['Racine', 'Ave', 'ns', -1200], ['Ashland', 'Ave', 'ns', -1600],
  ['Wood', 'St', 'ns', -1800], ['Damen', 'Ave', 'ns', -2000], ['Western', 'Ave', 'ns', -2400],
  ['California', 'Ave', 'ns', -2800], ['Kedzie', 'Ave', 'ns', -3200], ['Homan', 'Ave', 'ns', -3400],
  ['Pulaski', 'Rd', 'ns', -4000], ['Kostner', 'Ave', 'ns', -4400], ['Cicero', 'Ave', 'ns', -4800],
  ['Laramie', 'Ave', 'ns', -5200], ['Central', 'Ave', 'ns', -5600], ['Austin', 'Ave', 'ns', -6000],
  ['Harlem', 'Ave', 'ns', -7200],
  // East–west streets: north (+) / south (−) number.
  ['Howard', 'St', 'ew', 7600], ['Touhy', 'Ave', 'ew', 7200], ['Devon', 'Ave', 'ew', 6400],
  ['Peterson', 'Ave', 'ew', 6000], ['Bryn Mawr', 'Ave', 'ew', 5600], ['Foster', 'Ave', 'ew', 5200],
  ['Lawrence', 'Ave', 'ew', 4800], ['Montrose', 'Ave', 'ew', 4400], ['Irving Park', 'Rd', 'ew', 4000],
  ['Addison', 'St', 'ew', 3600], ['Belmont', 'Ave', 'ew', 3200], ['Diversey', 'Pkwy', 'ew', 2800],
  ['Fullerton', 'Ave', 'ew', 2400], ['Armitage', 'Ave', 'ew', 2000], ['North', 'Ave', 'ew', 1600],
  ['Division', 'St', 'ew', 1200], ['Elm', 'St', 'ew', 1150], ['Cedar', 'St', 'ew', 1100],
  ['Oak', 'St', 'ew', 1000], ['Walton', 'St', 'ew', 930], ['Delaware', 'Pl', 'ew', 900],
  ['Chestnut', 'St', 'ew', 860], ['Pearson', 'St', 'ew', 830], ['Chicago', 'Ave', 'ew', 800],
  ['Superior', 'St', 'ew', 730], ['Huron', 'St', 'ew', 700], ['Erie', 'St', 'ew', 660],
  ['Ontario', 'St', 'ew', 630], ['Ohio', 'St', 'ew', 600], ['Grand', 'Ave', 'ew', 530],
  ['Illinois', 'St', 'ew', 500], ['Hubbard', 'St', 'ew', 430], ['Kinzie', 'St', 'ew', 400],
  ['Wacker', 'Dr', 'ew', 300], ['South Water', 'St', 'ew', 300], ['Lake', 'St', 'ew', 200],
  ['Randolph', 'St', 'ew', 150], ['Washington', 'St', 'ew', 100], ['Madison', 'St', 'ew', 0],
  ['Monroe', 'St', 'ew', -100], ['Adams', 'St', 'ew', -200], ['Quincy', 'St', 'ew', -220],
  ['Jackson', 'Blvd', 'ew', -300], ['Van Buren', 'St', 'ew', -400], ['Congress', 'Pkwy', 'ew', -500],
  ['Ida B. Wells', 'Dr', 'ew', -500], ['Harrison', 'St', 'ew', -600], ['Balbo', 'Ave', 'ew', -700],
  ['Polk', 'St', 'ew', -800], ['Taylor', 'St', 'ew', -1000], ['Roosevelt', 'Rd', 'ew', -1200],
  ['Cermak', 'Rd', 'ew', -2200], ['Pershing', 'Rd', 'ew', -3900], ['Garfield', 'Blvd', 'ew', -5500],
  ['Marquette', 'Rd', 'ew', -6600],
];
// Numbered streets on the South Side: 8th St is 800 S, 63rd St is 6300 S, and so on.
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
for (let n = 8; n <= 138; n++) STREETS.push([ordinal(n), 'St', 'ew', -100 * n]);

const SUFFIXES = new Set(['st', 'street', 'ave', 'av', 'avenue', 'blvd', 'boulevard', 'rd', 'road', 'dr', 'drive',
  'pkwy', 'parkway', 'pl', 'place', 'ct', 'court', 'way', 'ter', 'terrace']);
const DIRECTIONS = { n: 'N', north: 'N', s: 'S', south: 'S', e: 'E', east: 'E', w: 'W', west: 'W' };
const key = name => name.toLowerCase().replace(/[.']/g, '').replace(/\s+/g, ' ').trim();
const BY_NAME = new Map();
for (const [name, suffix, runs, at] of STREETS) {
  const k = key(name);
  BY_NAME.set(k, [...(BY_NAME.get(k) ?? []), { name, suffix, runs, at }]);
}
BY_NAME.set('des plaines', BY_NAME.get('desplaines'));
BY_NAME.set('la salle', BY_NAME.get('lasalle'));

/** Looks up a street name ("N. State St.", "63rd", "Irving Park Road"). Returns matching entries, maybe two for Wacker. */
export function findStreet(text) {
  let words = key(text).split(' ').filter(Boolean);
  if (words.length > 1 && DIRECTIONS[words[0]]) words = words.slice(1);
  let found = BY_NAME.get(words.join(' '));
  if (!found && words.length > 1 && SUFFIXES.has(words.at(-1))) found = BY_NAME.get(words.slice(0, -1).join(' '));
  return found ?? [];
}

export const streetLabel = street => `${street.name} ${street.suffix}`;
/** The known street on a grid line: runs 'ns' with that east/west number, or 'ew' with that north/south number. */
export const streetOnLine = (runs, at) => STREETS.find(([, , r, n]) => r === runs && n === at)?.slice(0, 2).join(' ') ?? null;
export function gridNumberLabel(value, positive, negative) {
  const n = Math.round(Math.abs(value));
  return n === 0 ? '0' : `${n} ${value < 0 ? negative : positive}`;
}

/**
 * Street addresses ("123 N State St", "600 W. Madison") and intersections
 * ("Clark & Lake", "State and Madison", "Lake St at Wells St").
 * Returns { lat, lon, label } or null when the text is not one of those or names an unknown street.
 */
export function parseGridLocation(input) {
  const text = String(input).trim().replace(/(,\s*chicago|\s+chicago,?\s+(il|illinois))\b(,?\s*(il|illinois))?(\s+\d{5})?$/i, '').trim();
  // Bare grid numbers: "150 N, 100 W" or "1200 S 800 W" (0 is allowed without a direction).
  const numbers = /^(\d{1,5})\s*([NS])?\s*[,\s]\s*(\d{1,5})\s*([EW])?$/i.exec(text);
  // "41 N 87 W" is latitude/longitude, so one number must be at least 100.
  if (numbers && (numbers[2] || numbers[1] === '0') && (numbers[4] || numbers[3] === '0') && Math.max(numbers[1], numbers[3]) >= 100) {
    const ns = Number(numbers[1]) * (/s/i.test(numbers[2] ?? '') ? -1 : 1), ew = Number(numbers[3]) * (/w/i.test(numbers[4] ?? '') ? -1 : 1);
    return { ...gridToLatLon(ns, ew), label: `${gridNumberLabel(ns, 'N', 'S')}, ${gridNumberLabel(ew, 'E', 'W')}` };
  }
  const address = /^(\d{1,6})\s+(n|s|e|w|north|south|east|west)\.?\s+(.+)$/i.exec(text);
  if (address) {
    const number = Number(address[1]), direction = DIRECTIONS[address[2].toLowerCase()];
    const runs = direction === 'N' || direction === 'S' ? 'ns' : 'ew';
    const street = findStreet(address[3]).find(s => s.runs === runs);
    if (!street) return null;
    const signed = direction === 'S' || direction === 'W' ? -number : number;
    const point = runs === 'ns' ? gridToLatLon(signed, street.at) : gridToLatLon(street.at, signed);
    return { ...point, label: `${number} ${direction} ${streetLabel(street)}` };
  }
  const corner = /^(.+?)\s*(?:&|\/|@|\+|\band\b|\bat\b)\s*(.+)$/i.exec(text);
  if (corner) {
    const a = findStreet(corner[1]), b = findStreet(corner[2]);
    for (const first of a) for (const second of b) {
      if (first.runs === second.runs) continue;
      const [ns, ew] = first.runs === 'ns' ? [second, first] : [first, second];
      return { ...gridToLatLon(ns.at, ew.at), label: `${streetLabel(first)} & ${streetLabel(second)}` };
    }
  }
  return null;
}

// Within this many grid numbers of a street, a point counts as being on it (~half a short block).
const NEAR = 40;
function nearest(runs, value) {
  let best = null;
  for (const entries of BY_NAME.values()) for (const street of entries) {
    if (street.runs !== runs) continue;
    const distance = Math.abs(street.at - value);
    if (!best || distance < best.distance) best = { street, distance };
  }
  return best;
}

/**
 * Describes a point on the grid: the nearest intersection if it is close,
 * otherwise an approximate address on the nearest known street, and always the raw grid numbers.
 */
export function describeGrid(lat, lon) {
  const { ns, ew } = latLonToGrid(lat, lon);
  const grid = `${gridNumberLabel(ns, 'N', 'S')}, ${gridNumberLabel(ew, 'E', 'W')}`;
  const northSouth = nearest('ns', ew), eastWest = nearest('ew', ns);
  let label = grid;
  if (northSouth.distance <= NEAR && eastWest.distance <= NEAR) label = `${streetLabel(northSouth.street)} & ${streetLabel(eastWest.street)}`;
  else if (northSouth.distance <= NEAR) label = `${Math.round(Math.abs(ns))} ${ns < 0 ? 'S' : 'N'} ${streetLabel(northSouth.street)}`;
  else if (eastWest.distance <= NEAR) label = `${Math.round(Math.abs(ew))} ${ew < 0 ? 'W' : 'E'} ${streetLabel(eastWest.street)}`;
  return { ns, ew, grid, label };
}
