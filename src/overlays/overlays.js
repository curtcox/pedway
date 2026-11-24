// Draws the coordinate overlays (src/overlays/grids.js) on the map and keeps them
// current as it moves. Lines go in the coords-lines pane, under the data shapes;
// labels in coords-labels, above them. Nothing here is interactive.
import { OVERLAYS } from '../map-layers.js';
import { graticule, geohashGrid, usngGrid, addressGrid } from './grids.js';

const escape = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * latlonFormat() names the viewer's latitude/longitude style ('dms' or decimal).
 * extras[key](group, view) may add more to an overlay after its grid, such as corner labels.
 */
export function createOverlays(L, map, { latlonFormat = () => 'decimal', extras = {} } = {}) {
  const renderer = L.svg({ pane: 'coords-lines', padding: 0.5 });
  const groups = new Map(OVERLAYS.map(overlay => [overlay.key, L.layerGroup()]));
  const colors = Object.fromEntries(OVERLAYS.map(overlay => [overlay.key, overlay.color]));
  let on = {};

  const view = (pad = 0) => {
    const b = pad ? map.getBounds().pad(pad) : map.getBounds(), size = map.getSize();
    return { bounds: { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, size: { x: size.x * (1 + 2 * pad), y: size.y * (1 + 2 * pad) } };
  };
  // Labels come from the view itself, so edge labels sit at its edges; lines from a view
  // padded by half on every side, so panning does not uncover their ends. The scale is
  // the same, so both pick the same step.
  // Each overlay's edge labels get their own row and column, clear of the search box,
  // the zoom buttons and each other.
  const edges = key => {
    const row = OVERLAYS.findIndex(overlay => overlay.key === key);
    return { top: 118 + 16 * row, left: 58 };
  };
  function grid(key, { bounds, size }, options = {}) {
    const inset = edges(key);
    switch (key) {
      case 'latlon': return graticule(bounds, size, { format: latlonFormat(), inset });
      case 'geohash': return geohashGrid(bounds, size, options);
      case 'usng': return usngGrid(bounds, size, { inset });
      default: return addressGrid(bounds, size, { inset });
    }
  }
  function draw(key) {
    const group = groups.get(key);
    group.clearLayers();
    const here = view(), labelled = grid(key, here), lined = grid(key, view(0.5), key === 'geohash' ? { precision: labelled.step } : undefined);
    for (const line of lined.lines) {
      L.polyline(line.points, { renderer, interactive: false, color: colors[key], weight: line.major ? 1.6 : 1, opacity: line.major ? 0.8 : 0.6,
        className: `coord-line coord-${key}` }).addTo(group);
    }
    for (const label of labelled.labels) {
      L.marker([label.lat, label.lon], { pane: 'coords-labels', interactive: false, keyboard: false,
        icon: L.divIcon({ className: `coord-label coord-${key} coord-${label.edge}`, html: `<span>${escape(label.text)}</span>`, iconSize: null }) }).addTo(group);
    }
    extras[key]?.(group, here);
  }
  map.on('moveend', () => { for (const key of groups.keys()) if (on[key]) draw(key); });

  return {
    groups,
    /** Shows exactly the overlays switched on in this record. */
    show(next = {}) {
      on = { ...next };
      for (const [key, group] of groups) {
        if (on[key]) { group.addTo(map); draw(key); } else group.remove();
      }
    },
    redraw(key) { if (on[key]) draw(key); },
    get on() { return { ...on }; },
  };
}
