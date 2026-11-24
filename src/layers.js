// Draws the committed GeoJSON data and the panel that turns each layer on and off.
import { element } from '../vendor/fragment-kit-v0.5.0/src/index.js';
import { DATA_LAYERS, MAP_LAYERS, POI_CATEGORIES } from './data-layers.js';
import { LEVELS } from './doc.js';
import { externalLinks } from './external.js';

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
// Places crowd the map when zoomed out, so they appear from this zoom in.
export const POI_MIN_ZOOM = 15;
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
const POI_KEYS = new Set(POI_CATEGORIES.map(category => category.key));

export function createDataLayers(L, map, { tiles, onChange, onError, baseUrl = new URL('../data/', import.meta.url) }) {
  const groups = new Map(MAP_LAYERS.map(layer => [layer.key, L.layerGroup()]));
  const features = new Map(DATA_LAYERS.map(layer => [layer.key, []]));
  let state = { layers: {}, level: 'both', gps: false };
  // Each file loads on its own, so one that fails leaves the others on the map.
  const loaded = Promise.allSettled(DATA_LAYERS.map(async layer => {
    const response = await fetch(new URL(layer.file, baseUrl));
    if (!response.ok) throw new Error(`${layer.file}: ${response.status}`);
    const data = await response.json();
    features.set(layer.key, data.features);
    const style = STYLES[layer.key];
    // Places go into one group per category; every other file is one group.
    for (const target of MAP_LAYERS.filter(entry => entry.file === layer.key)) {
      L.geoJSON(data, {
        filter: feature => !target.category || feature.properties.category === target.category,
        style: style.style,
        pointToLayer: (feature, at) => L.circleMarker(at, { ...style.point(feature), bubblingMouseEvents: false }),
        onEachFeature: (feature, shape) => {
          shape.bindPopup(() => style.popup(feature), { maxWidth: 260 });
          if (feature.properties.name) shape.bindTooltip(feature.properties.name, { direction: 'top', offset: [0, -6] });
        },
      }).addTo(groups.get(target.key));
    }
    return [layer.key, data.features.length];
  })).then(results => {
    const failed = results.filter(result => result.status === 'rejected');
    if (failed.length) onError?.(failed[0].reason);
    return Object.fromEntries(results.filter(result => result.status === 'fulfilled').map(result => result.value));
  });

  const visible = key => state.layers[key] && !(state.level === 'street' && (key === 'pedway' || key === 'access'))
    && !(POI_KEYS.has(key) && map.getZoom() < POI_MIN_ZOOM);
  function show(next) {
    state = { layers: { ...next.layers }, level: next.level, gps: Boolean(next.gps) };
    for (const [key, group] of groups) {
      if (visible(key)) group.addTo(map); else group.remove();
    }
    tiles?.setOpacity(state.level === 'pedway' ? 0.4 : 1);
    panel.sync();
  }
  map.on('zoomend', () => show(state));

  // The panel: a Leaflet control with a button that opens a list of checkboxes.
  const panel = (() => {
    const Control = L.Control.extend({ options: { position: 'topright' }, onAdd() {
      const box = element('div', null, { className: 'leaflet-bar layers-control' });
      const toggle = element('button', 'Layers', { type: 'button', id: 'layers-open', 'aria-expanded': 'false', 'aria-controls': 'layers-panel' });
      const sheet = element('div', null, { id: 'layers-panel', className: 'layers-panel', hidden: '' });
      const boxes = new Map();
      const heading = element('h3', 'Show on map');
      sheet.append(heading);
      const placesNote = element('p', `Zoom in to see places.`, { className: 'layers-note', id: 'layers-zoom-note' });
      for (const layer of MAP_LAYERS) {
        if (layer.file === 'poi' && !sheet.querySelector('#layers-places')) sheet.append(element('h3', 'Places', { id: 'layers-places' }), placesNote);
        const input = element('input', null, { type: 'checkbox', id: `layer-${layer.key}`, value: layer.key });
        const swatch = element('span', null, { className: `layer-swatch swatch-${layer.file}`, 'aria-hidden': 'true' });
        if (layer.category) swatch.style.background = POI_COLORS[layer.category];
        const label = element('label', null, { className: 'layer-option', for: `layer-${layer.key}` });
        label.append(input, swatch, element('span', layer.title));
        input.onchange = () => onChange({ ...state, layers: { ...state.layers, [layer.key]: input.checked } });
        boxes.set(layer.key, input);
        sheet.append(label);
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
        level.value = state.level;
        offer.checked = state.gps;
        for (const key of ['pedway', 'access']) boxes.get(key).disabled = state.level === 'street';
        placesNote.hidden = map.getZoom() >= POI_MIN_ZOOM;
      };
      return box;
    } });
    const control = new Control().addTo(map);
    return { sync: () => control.sync?.() };
  })();

  return { show, loaded, groups, features };
}
