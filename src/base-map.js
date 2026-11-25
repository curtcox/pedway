// The self-hosted base map of downtown (docs/map-layers.md, "Downtown base map"): land, green space,
// water, streets, rail and buildings drawn from the data snapshot on canvas, and
// street and place labels placed without overlaps. Nothing here is interactive, so
// taps go through to the Pedway, stations and the map itself.
import { MAP_LAYERS } from './map-layers.js';
import { BASE_BOX } from './map-defaults.js';

export const BASE_COLORS = Object.freeze({ land: '#f2efe9', water: '#aad3df', green: '#cdebb0', building: '#ddd6ce', buildingEdge: '#c4b9ad',
  pedwayBuilding: '#cfdcf0', pedwayBuildingEdge: '#90a9d1', major: '#f7d77e', majorEdge: '#d9b54a', minor: '#ffffff', path: '#8a8a8a', rail: '#666666' });
const LAYERS = MAP_LAYERS.filter(layer => layer.group === 'base');

// Street widths grow with zoom, as a street's real width does.
const streetWidth = (cls, zoom) => {
  const scale = Math.max(0.5, 2 ** ((zoom - 16) / 2));
  return { major: 7, minor: 4.5, service: 2.5, path: 1.2 }[cls] * (cls === 'path' ? 1 : scale);
};
const STYLES = {
  water: () => ({ stroke: false, fillColor: BASE_COLORS.water, fillOpacity: 1 }),
  green: () => ({ stroke: false, fillColor: BASE_COLORS.green, fillOpacity: 1 }),
  buildings: ({ properties: p }) => ({ color: p.pedway ? BASE_COLORS.pedwayBuildingEdge : BASE_COLORS.buildingEdge, weight: 0.7, opacity: 1,
    fillColor: p.pedway ? BASE_COLORS.pedwayBuilding : BASE_COLORS.building, fillOpacity: 1 }),
  streets: ({ properties: p }, zoom) => p.class === 'path'
    ? { color: BASE_COLORS.path, weight: 1.2, opacity: p.tunnel ? 0.3 : 0.8, dashArray: '3 3', fill: false }
    : { color: p.class === 'major' ? BASE_COLORS.major : BASE_COLORS.minor, weight: streetWidth(p.class, zoom), opacity: p.tunnel ? 0.45 : 1,
      lineCap: 'round', lineJoin: 'round', fillColor: BASE_COLORS.minor, fillOpacity: 1, dashArray: p.tunnel ? '6 4' : null },
  rail: ({ properties: p }) => ({ color: BASE_COLORS.rail, weight: p.kind === 'elevated' ? 3 : 2, opacity: p.kind === 'subway' ? 0.35 : 0.9,
    dashArray: p.kind === 'subway' ? '4 4' : null, lineCap: 'butt' }),
};

/**
 * snapshot is the promise of the loaded snapshot (file(key), has(key)). Resolves
 * `available` true when the snapshot has the base map; older snapshots do not.
 */
export function createBaseMap(L, map, { snapshot, onError }) {
  const renderers = new Map(LAYERS.map(layer => [layer.key, L.canvas({ pane: layer.pane, padding: 0.3 })]));
  const groups = new Map(LAYERS.map(layer => [layer.key, L.layerGroup()]));
  const shapes = new Map();       // key → L.GeoJSON, once loaded
  const loading = new Map();
  // Land under the box, so tiles beneath it never show through between buildings.
  const land = L.rectangle(BASE_BOX, { renderer: L.canvas({ pane: 'base-land' }), stroke: false, fillColor: BASE_COLORS.land, fillOpacity: 1, interactive: false });
  const available = snapshot.then(value => value.has('streets'), () => false);
  let labelFeatures = null, labelGroup = L.layerGroup(), on = {};

  function load(key) {
    if (!loading.has(key)) {
      loading.set(key, snapshot.then(value => value.file(key)).then(data => {
        if (key === 'labels') { labelFeatures = data.features; drawLabels(); return; }
        const style = STYLES[key];
        const layer = L.geoJSON(data, { renderer: renderers.get(key), interactive: false, style: feature => style(feature, map.getZoom()) });
        shapes.set(key, layer);
        layer.addTo(groups.get(key));
      }).catch(error => { loading.delete(key); onError?.(error); }));
    }
    return loading.get(key);
  }

  // Labels: those whose minZoom has been reached, in view, by rank, skipping any that
  // would overlap one already placed. Street labels follow their street's angle.
  function drawLabels() {
    labelGroup.clearLayers();
    if (!on.labels || !labelFeatures) return;
    const zoom = map.getZoom(), bounds = map.getBounds().pad(0.1), placed = [];
    const candidates = labelFeatures.filter(f => f.properties.minZoom <= zoom && bounds.contains([f.geometry.coordinates[1], f.geometry.coordinates[0]]))
      .sort((a, b) => a.properties.rank - b.properties.rank);
    let count = 0;
    for (const feature of candidates) {
      if (count >= 150) break;
      const [lon, lat] = feature.geometry.coordinates, p = map.latLngToContainerPoint([lat, lon]);
      const { text, angle = 0, kind } = feature.properties;
      // The rotated text's bounding box, about 6 px per character and 13 px high, plus a margin.
      const w = text.length * 6 + 8, h = 15, rad = Math.abs(angle) * Math.PI / 180;
      const bw = w * Math.cos(rad) + h * Math.sin(rad), bh = w * Math.sin(rad) + h * Math.cos(rad);
      const box = { left: p.x - bw / 2, right: p.x + bw / 2, top: p.y - bh / 2, bottom: p.y + bh / 2 };
      if (placed.some(o => box.left < o.right && box.right > o.left && box.top < o.bottom && box.bottom > o.top)) continue;
      placed.push(box);
      // An element, not an HTML string: the page's CSP refuses inline style attributes, but not styles set from script.
      const span = document.createElement('span');
      span.textContent = text;
      if (angle) span.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
      L.marker([lat, lon], { pane: 'base-labels', interactive: false, keyboard: false,
        icon: L.divIcon({ className: `base-label base-label-${kind}`, html: span, iconSize: null }) }).addTo(labelGroup);
      count++;
    }
  }
  map.on('moveend', drawLabels);
  map.on('zoomend', () => { const streets = shapes.get('streets'); if (streets) streets.setStyle(feature => STYLES.streets(feature, map.getZoom())); });

  return {
    available,
    groups, labelGroup,
    /** Draws the base layers switched on in `layers` (by key), or none when `show` is false. */
    show(layers, show) {
      on = Object.fromEntries(LAYERS.map(layer => [layer.key, Boolean(show && layers[layer.key])]));
      if (show) land.addTo(map); else land.remove();
      for (const layer of LAYERS) {
        const group = layer.key === 'labels' ? labelGroup : groups.get(layer.key);
        if (!on[layer.key]) { group.remove(); continue; }
        group.addTo(map);
        void load(layer.key);
      }
      drawLabels();
    },
    /** Dims (Pedway focus) or restores the whole base. */
    dim(value) {
      for (const name of ['base-land', ...LAYERS.map(layer => layer.pane)]) {
        const pane = map.getPane(name);
        if (pane) pane.style.opacity = value ? '0.4' : '';
      }
    },
    /** Resolves once every base layer that is on has loaded. */
    ready: () => Promise.all(LAYERS.filter(layer => on[layer.key]).map(layer => load(layer.key))),
  };
}

/** True when a tile lies entirely inside the self-hosted box, so it need not be fetched. */
export function tileInsideBox(L, map, coords, tileSize) {
  const nw = map.unproject([coords.x * tileSize, coords.y * tileSize], coords.z);
  const se = map.unproject([(coords.x + 1) * tileSize, (coords.y + 1) * tileSize], coords.z);
  const [[south, west], [north, east]] = BASE_BOX;
  return nw.lat <= north && se.lat >= south && nw.lng >= west && se.lng <= east;
}
