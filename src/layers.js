// Draws the committed GeoJSON data and the panel that turns each layer on and off.
import { element } from '../vendor/fragment-kit-v0.5.0/src/index.js';
import { DATA_LAYERS, POI_CATEGORIES } from './data-layers.js';
import { MAP_LAYERS, LAYER_GROUPS, PANES, POI_MIN_ZOOM, OVERLAYS } from './map-layers.js';
import { LEVELS } from './doc.js';
import { externalLinks } from './external.js';
import { fetchSnapshot } from './data-snapshot.js';

export const CTA_COLORS = Object.freeze({ Red: '#c60c30', Blue: '#00a1de', Brown: '#62361b', Green: '#009b3a',
  Orange: '#f9461c', Pink: '#e27ea6', Purple: '#522398', Yellow: '#f9e300' });
const PEDWAY_COLOR = '#1565c0', METRA_COLOR = '#005596';
const ACCESS = { entrance: { color: '#2e7d32', name: 'Entrance' }, elevator: { color: '#6a1b9a', name: 'Elevator' }, station: { color: '#00838f', name: 'Station entrance' } };
const LEVEL_NAMES = { both: 'Streets and Pedway', pedway: 'Pedway focus', street: 'Streets only' };
const POI_COLORS = Object.fromEntries(POI_CATEGORIES.map(category => [category.key, category.color]));
export const POI_KINDS = Object.freeze({ restaurant: 'Restaurant', cafe: 'Café', fast_food: 'Fast food', food_court: 'Food court',
  ice_cream: 'Ice cream', bakery: 'Bakery', deli: 'Deli', toilets: 'Restroom', pharmacy: 'Pharmacy', supermarket: 'Grocery store',
  convenience: 'Convenience store', department_store: 'Department store', mall: 'Shopping centre', greengrocer: 'Produce',
  museum: 'Museum', gallery: 'Gallery', arts_centre: 'Arts centre', park: 'Park', garden: 'Garden', plaza: 'Plaza' });
export { POI_MIN_ZOOM };
const WHEELCHAIR = { yes: 'Step-free access', limited: 'Limited step-free access', no: 'No step-free access' };

function osmLink(id) {
  return element('a', 'OpenStreetMap', { href: `https://www.openstreetmap.org/${id}`, target: '_blank', rel: 'noopener noreferrer' });
}
function card(title, lines, osm, at) {
  const body = element('div', null, { className: 'data-popup' });
  body.append(element('h3', title));
  for (const line of lines.filter(Boolean)) body.append(typeof line === 'string' ? element('p', line) : line);
  const source = element('p', 'Data: ', { className: 'data-source' });
  source.append(osmLink(osm));
  if (at) body.append(externalLinks(at[1], at[0], title));
  body.append(source);
  return body;
}
// Black or white text, whichever reads better on the colour (WCAG relative luminance).
export function textOn(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#111111' : '#ffffff';
}
function lineChips(lines = []) {
  if (!lines.length) return null;
  const list = element('p', null, { className: 'line-chips' });
  for (const line of lines) {
    const chip = element('span', line, { className: 'line-chip' });
    const color = CTA_COLORS[line] ?? METRA_COLOR;
    chip.style.setProperty('--line-color', color);
    chip.style.color = textOn(color);
    list.append(chip);
  }
  return list;
}

const STYLES = {
  pedway: { style: feature => ({ color: feature.properties.level === 'above' ? '#ef6c00' : PEDWAY_COLOR, weight: feature.properties.kind === 'steps' ? 3 : 5,
      opacity: 0.85, dashArray: feature.properties.kind === 'steps' ? '4 4' : null, lineCap: 'round' }),
    popup: ({ properties: p }) => card(p.name || 'Pedway', [
      p.kind === 'steps' ? 'Stairs' : { below: 'Below street level', street: 'At street level', above: 'Above street level' }[p.level],
      p.hours && `Hours: ${p.hours}`, WHEELCHAIR[p.wheelchair]], p.osm) },
  access: { point: ({ properties: p }) => ({ radius: 5, color: '#fff', weight: 1.5, fillColor: ACCESS[p.kind].color, fillOpacity: 1 }),
    popup: ({ properties: p, geometry }) => card(p.name || ACCESS[p.kind].name, [p.name && ACCESS[p.kind].name, p.level && `Level ${p.level}`,
      p.hours && `Hours: ${p.hours}`, WHEELCHAIR[p.wheelchair]], p.osm, geometry.coordinates) },
  cta: { point: ({ properties: p }) => ({ radius: p.pedway ? 8 : 6, color: CTA_COLORS[p.lines?.[0]] ?? '#333', weight: 3, fillColor: '#fff', fillOpacity: 1 }),
    popup: ({ properties: p, geometry }) => card(p.name, [lineChips(p.lines), p.pedway && 'Connects to the Pedway', WHEELCHAIR[p.wheelchair]], p.osm, geometry.coordinates) },
  metra: { point: ({ properties: p }) => ({ radius: p.pedway ? 8 : 6, color: METRA_COLOR, weight: 3, fillColor: '#dbe9f6', fillOpacity: 1 }),
    popup: ({ properties: p, geometry }) => card(p.name, [p.lines?.length && `Metra: ${p.lines.join(', ')}`, p.pedway && 'Connects to the Pedway', WHEELCHAIR[p.wheelchair]], p.osm, geometry.coordinates) },
  poi: { point: ({ properties: p }) => ({ radius: 5, color: '#fff', weight: 1.5, fillColor: POI_COLORS[p.category], fillOpacity: 1 }),
    popup: ({ properties: p, geometry }) => card(p.name || POI_KINDS[p.kind] || 'Place', [p.name && (POI_KINDS[p.kind] ?? p.kind),
      p.pedway && 'On or beside the Pedway', p.level && `Level ${p.level}`, p.hours && `Hours: ${p.hours}`, WHEELCHAIR[p.wheelchair],
      p.category === 'restroom' && 'Restrooms in buildings keep the building’s hours and may be for customers only.'], p.osm, geometry.coordinates) },
};

/** Creates the panes in the order PANES gives. Call before anything draws in them. */
export function createPanes(map) {
  for (const { name, zIndex } of PANES) if (!map.getPane(name)) map.createPane(name).style.zIndex = zIndex;
}

// overlays and readout draw the coordinate overlays (src/overlays/); the panel switches them.
export function createDataLayers(L, map, { tiles, overlays, readout, onChange, onError, baseUrl = new URL('../data/', import.meta.url), snapshotId = null }) {
  createPanes(map);
  const groups = new Map(MAP_LAYERS.map(layer => [layer.key, L.layerGroup()]));
  const features = new Map(DATA_LAYERS.map(layer => [layer.key, []]));
  const built = new Map();   // map layer key → promise that its shapes are in its group
  let state = { layers: {}, overlays: {}, level: 'both', gps: false };
  // The data comes from the snapshot data/current.json names. Each file loads and is
  // checked on its own, so one that fails leaves the others on the map.
  let manifest = null;
  const snapshot = fetchSnapshot(baseUrl, { id: snapshotId }).then(value => { manifest = value.manifest; return value; });

  function build(layer) {
    if (built.has(layer.key)) return built.get(layer.key);
    const { file, category } = layer.source;
    const style = STYLES[file];
    const promise = snapshot.then(value => value.file(file)).then(data => {
      features.set(file, data.features);
      L.geoJSON(data, {
        filter: feature => !category || feature.properties.category === category,
        style: style.style,
        pointToLayer: (feature, at) => L.circleMarker(at, { ...style.point(feature), bubblingMouseEvents: false }),
        onEachFeature: (feature, shape) => {
          shape.bindPopup(() => style.popup(feature), { maxWidth: 260 });
          if (feature.properties.name) shape.bindTooltip(feature.properties.name, { direction: 'top', offset: [0, -6] });
        },
      }).addTo(groups.get(layer.key));
      return data.features.length;
    });
    built.set(layer.key, promise);
    return promise;
  }
  // Search, nearest-entrance and the counts the tests read need every data file now, whether
  // or not its layer is shown; layers with lazy: true load the first time they are shown.
  const eager = DATA_LAYERS.filter(layer => !layer.lazy);
  // Optional files the snapshot does not have are skipped; files no layer draws (intersections) are just kept.
  const loaded = snapshot.then(value => Promise.allSettled(eager.filter(data => !data.optional || value.has(data.key)).map(async data => {
    const drawn = MAP_LAYERS.filter(layer => layer.source.file === data.key);
    if (drawn.length) await Promise.all(drawn.map(build));
    else features.set(data.key, (await value.file(data.key)).features);
    return [data.key, features.get(data.key).length];
  }))).then(results => {
    const failed = results.filter(result => result.status === 'rejected');
    if (failed.length) onError?.(failed[0].reason);
    return Object.fromEntries(results.filter(result => result.status === 'fulfilled').map(result => result.value));
  }, error => { onError?.(error); return {}; });

  const visible = layer => state.layers[layer.key] && !(state.level === 'street' && layer.streetHides) && !(layer.minZoom && map.getZoom() < layer.minZoom);
  function show(next) {
    state = { layers: { ...next.layers }, overlays: { ...next.overlays }, level: next.level, gps: Boolean(next.gps) };
    for (const layer of MAP_LAYERS) {
      const group = groups.get(layer.key);
      if (!visible(layer)) { group.remove(); continue; }
      group.addTo(map);
      if (!built.has(layer.key)) build(layer).catch(error => onError?.(error));
    }
    tiles?.setOpacity(state.level === 'pedway' ? 0.4 : 1);
    overlays?.show(state.overlays);
    readout?.show(state.overlays);
    panel.sync();
  }
  map.on('zoomend', () => show(state));

  // The panel: a Leaflet control with a button that opens a list of checkboxes, one section per group.
  const panel = (() => {
    const Control = L.Control.extend({ options: { position: 'topright' }, onAdd() {
      const box = element('div', null, { className: 'leaflet-bar layers-control' });
      const toggle = element('button', 'Layers', { type: 'button', id: 'layers-open', 'aria-expanded': 'false', 'aria-controls': 'layers-panel' });
      const sheet = element('div', null, { id: 'layers-panel', className: 'layers-panel', hidden: '' });
      const boxes = new Map(), overlayBoxes = new Map();
      const placesNote = element('p', 'Zoom in to see places.', { className: 'layers-note', id: 'layers-zoom-note' });
      for (const group of LAYER_GROUPS) {
        const members = MAP_LAYERS.filter(layer => layer.group === group.key);
        if (!members.length && group.key !== 'coords') continue;
        sheet.append(element('h3', group.title, { id: `layers-${group.key}` }));
        if (group.key === 'places') sheet.append(placesNote);
        if (group.key === 'coords') {
          for (const overlay of OVERLAYS) {
            const input = element('input', null, { type: 'checkbox', id: `overlay-${overlay.key}`, value: overlay.key });
            const swatch = element('span', null, { className: 'layer-swatch swatch-coords', 'aria-hidden': 'true' });
            swatch.style.borderColor = overlay.color;
            const label = element('label', null, { className: 'layer-option', for: `overlay-${overlay.key}` });
            label.append(input, swatch, element('span', overlay.title));
            input.onchange = () => onChange({ ...state, overlays: { ...state.overlays, [overlay.key]: input.checked } });
            overlayBoxes.set(overlay.key, input);
            sheet.append(label);
          }
        }
        for (const layer of members) {
          const input = element('input', null, { type: 'checkbox', id: `layer-${layer.key}`, value: layer.key });
          const swatch = element('span', null, { className: `layer-swatch swatch-${layer.source.file ?? layer.key}`, 'aria-hidden': 'true' });
          if (layer.color) swatch.style.background = layer.color;
          const label = element('label', null, { className: 'layer-option', for: `layer-${layer.key}` });
          label.append(input, swatch, element('span', layer.title));
          input.onchange = () => onChange({ ...state, layers: { ...state.layers, [layer.key]: input.checked } });
          boxes.set(layer.key, input);
          sheet.append(label);
        }
      }
      const level = element('select', null, { id: 'layer-level', 'aria-label': 'View' });
      for (const value of LEVELS) level.append(element('option', LEVEL_NAMES[value], { value }));
      level.onchange = () => onChange({ ...state, level: level.value });
      const levelLabel = element('label', null, { className: 'layer-level', for: 'layer-level' });
      levelLabel.append(element('span', 'View'), level);
      const offer = element('input', null, { type: 'checkbox', id: 'map-gps' });
      offer.onchange = () => onChange({ ...state, gps: offer.checked });
      const offerLabel = element('label', null, { className: 'layer-option', for: 'map-gps' });
      offerLabel.append(offer, element('span', 'Offer “show my location” to people who open this link'));
      sheet.append(levelLabel, offerLabel, element('p', 'Data © OpenStreetMap contributors. The Pedway changes with building hours; check signs underground.', { className: 'layers-note' }));
      const setOpen = open => { sheet.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); };
      toggle.onclick = () => setOpen(sheet.hidden);
      box.addEventListener('keydown', event => { if (event.key === 'Escape' && !sheet.hidden) { setOpen(false); toggle.focus(); } });
      // A tap on the map or an opening popup puts the panel away, so it never hides what was tapped.
      map.on('click popupopen', () => setOpen(false));
      box.append(toggle, sheet);
      L.DomEvent.disableClickPropagation(box);
      L.DomEvent.disableScrollPropagation(box);
      this.sync = () => {
        for (const [key, input] of boxes) input.checked = Boolean(state.layers[key]);
        for (const [key, input] of overlayBoxes) input.checked = Boolean(state.overlays[key]);
        level.value = state.level;
        offer.checked = state.gps;
        for (const layer of MAP_LAYERS) if (layer.streetHides) boxes.get(layer.key).disabled = state.level === 'street';
        placesNote.hidden = map.getZoom() >= POI_MIN_ZOOM;
      };
      return box;
    } });
    const control = new Control().addTo(map);
    return { sync: () => control.sync?.() };
  })();

  return { show, loaded, groups, features, get snapshot() { return manifest; } };
}
