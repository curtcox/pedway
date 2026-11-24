// Street corners from the intersections data set (docs/map-layers.md, L3): the
// nearest corner for the readout, exact positions for searched corners, and corner
// labels for the address-grid overlay. Where the data has no corner (outside the
// base box, or an older snapshot without it), callers fall back to the grid model.

// Points are [lon, lat]; distances in metres, close enough for a few hundred metres downtown.
const KX = 82950, KY = 110570;
const metres = (lat1, lon1, lat2, lon2) => Math.hypot((lon1 - lon2) * KX, (lat1 - lat2) * KY);
const DIRECTIONS = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];
/** "Clark & Lake" from ["Clark", "Lake"]: up to three names. */
export const cornerName = streets => streets.slice(0, 3).join(' & ');
// The street name in "Clark St" or "N. State Street", as the data set keeps it ("Clark", "State").
const bare = name => name.trim().replace(/^(North|South|East|West|N|S|E|W)\.?\s+(?=\S+\s)/i, '')
  .replace(/\s+(St|Street|Ave|Avenue|Av|Dr|Drive|Blvd|Boulevard|Rd|Road|Pl|Place|Ct|Court|Pkwy|Parkway|Plaza|Ln|Lane|Way|Ter|Terrace)\.?$/i, '').toLowerCase();

/** corners() returns the intersections features loaded so far (an empty list until they arrive). */
export function createCorners(corners) {
  /** The nearest corner within `within` metres: { name, distance, direction, lat, lon }, or null. */
  function nearest(lat, lon, within = 150) {
    let best = null;
    for (const feature of corners()) {
      const [x, y] = feature.geometry.coordinates;
      const distance = metres(lat, lon, y, x);
      if (distance <= within && (!best || distance < best.distance)) best = { feature, distance, lat: y, lon: x };
    }
    if (!best) return null;
    // The direction from the corner to the point.
    const angle = Math.atan2((lat - best.lat) * KY, (lon - best.lon) * KX);
    const direction = DIRECTIONS[(Math.round(angle / (Math.PI / 4)) + 8) % 8];
    return { name: cornerName(best.feature.properties.streets), distance: Math.round(best.distance), direction, lat: best.lat, lon: best.lon };
  }
  return {
    nearest,
    /** Readout text: "Clark & Lake", or "Clark & Lake, 40 m NE" when the point is not at the corner. */
    describe(lat, lon) {
      const found = nearest(lat, lon);
      if (!found) return null;
      return found.distance < 15 ? found.name : `${found.name}, ${found.distance} m ${found.direction}`;
    },
    /**
     * The data's position for a corner the grid model placed: label like "Clark St & Lake St",
     * at about lat/lon. Returns { lat, lon } within 300 m, or null.
     */
    snap(label, lat, lon) {
      const names = label.split('&').map(bare);
      if (names.length !== 2) return null;
      let best = null;
      for (const feature of corners()) {
        const streets = feature.properties.streets.map(name => name.toLowerCase());
        if (!names.every(name => streets.includes(name))) continue;
        const [x, y] = feature.geometry.coordinates;
        const distance = metres(lat, lon, y, x);
        if (distance <= 300 && (!best || distance < best.distance)) best = { lat: y, lon: x, distance };
      }
      return best && { lat: best.lat, lon: best.lon };
    },
  };
}

/**
 * Adds corner labels in view to an overlay group: major corners from zoom 14, every
 * corner from 17, each kept only where it does not overlap one already placed.
 */
export function drawCornerLabels(L, map, group, corners, { limit = 80 } = {}) {
  const zoom = map.getZoom();
  if (zoom < 14) return 0;
  const bounds = map.getBounds();
  const placed = [];
  let count = 0;
  const ranked = corners().filter(feature => zoom >= 17 || feature.properties.rank === 'major')
    .sort((a, b) => (a.properties.rank === 'major' ? 0 : 1) - (b.properties.rank === 'major' ? 0 : 1));
  for (const feature of ranked) {
    if (count >= limit) break;
    const [lon, lat] = feature.geometry.coordinates;
    if (!bounds.contains([lat, lon])) continue;
    const text = cornerName(feature.properties.streets);
    const p = map.latLngToContainerPoint([lat, lon]);
    // The label sits just above and right of the corner: about 6.5 px per character, 14 px high.
    const box = { left: p.x + 4, top: p.y - 18, right: p.x + 8 + text.length * 6.5, bottom: p.y - 2 };
    if (placed.some(o => box.left < o.right && box.right > o.left && box.top < o.bottom && box.bottom > o.top)) continue;
    placed.push(box);
    const html = document.createElement('span');
    html.textContent = text;
    L.marker([lat, lon], { pane: 'coords-labels', interactive: false, keyboard: false,
      icon: L.divIcon({ className: 'coord-label coord-grid corner-label', html: html.outerHTML, iconSize: null }) }).addTo(group);
    count++;
  }
  return count;
}
