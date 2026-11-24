// Draws the committed GeoJSON data and the panel that turns each layer on and off.
import { element } from '../vendor/fragment-kit-v0.5.0/src/index.js';
import { DATA_LAYERS } from './data-layers.js';
import { LEVELS } from './doc.js';

export const CTA_COLORS = Object.freeze({ Red: '#c60c30', Blue: '#00a1de', Brown: '#62361b', Green: '#009b3a',
  Orange: '#f9461c', Pink: '#e27ea6', Purple: '#522398', Yellow: '#f9e300' });
const PEDWAY_COLOR = '#1565c0', METRA_COLOR = '#005596';
const ACCESS = { entrance: { color: '#2e7d32', name: 'Entrance' }, elevator: { color: '#6a1b9a', name: 'Elevator' }, station: { color: '#00838f', name: 'Station entrance' } };
const LEVEL_NAMES = { both: 'Streets and Pedway', pedway: 'Pedway focus', street: 'Streets only' };
const WHEELCHAIR = { yes: 'Step-free access', limited: 'Limited step-free access', no: 'No step-free access' };

function osmLink(id) {
  return element('a', 'OpenStreetMap', { href: `https://www.openstreetmap.org/${id}`, target: '_blank', rel: 'noopener noreferrer' });
}
function card(title, lines, osm) {
  const body = element('div', null, { className: 'data-popup' });
  body.append(element('h3', title));
  for (const line of lines.filter(Boolean)) body.append(typeof line === 'string' ? element('p', line) : line);
  const source = element('p', 'Data: ', { className: 'data-source' });
  source.append(osmLink(osm));
  body.append(source);
  return body;
}
function lineChips(lines = []) {
  if (!lines.length) return null;
  const list = element('p', null, { className: 'line-chips' });
  for (const line of lines) {
    const chip = element('span', line, { className: 'line-chip' });
    chip.style.setProperty('--line-color', CTA_COLORS[line] ?? METRA_COLOR);
    if (line === 'Yellow') chip.style.color = '#222';
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
    popup: ({ properties: p }) => card(p.name || ACCESS[p.kind].name, [p.name && ACCESS[p.kind].name, p.level && `Level ${p.level}`,
      p.hours && `Hours: ${p.hours}`, WHEELCHAIR[p.wheelchair]], p.osm) },
  cta: { point: ({ properties: p }) => ({ radius: p.pedway ? 8 : 6, color: CTA_COLORS[p.lines?.[0]] ?? '#333', weight: 3, fillColor: '#fff', fillOpacity: 1 }),
    popup: ({ properties: p }) => card(p.name, [lineChips(p.lines), p.pedway && 'Connects to the Pedway', WHEELCHAIR[p.wheelchair]], p.osm) },
  metra: { point: ({ properties: p }) => ({ radius: p.pedway ? 8 : 6, color: METRA_COLOR, weight: 3, fillColor: '#dbe9f6', fillOpacity: 1 }),
    popup: ({ properties: p }) => card(p.name, [p.lines?.length && `Metra: ${p.lines.join(', ')}`, p.pedway && 'Connects to the Pedway', WHEELCHAIR[p.wheelchair]], p.osm) },
};

export function createDataLayers(L, map, { tiles, onChange, onError, baseUrl = new URL('../data/', import.meta.url) }) {
  const groups = new Map(DATA_LAYERS.map(layer => [layer.key, L.layerGroup()]));
  let state = { layers: {}, level: 'both' };
  const loaded = Promise.all(DATA_LAYERS.map(async layer => {
    const response = await fetch(new URL(layer.file, baseUrl));
    if (!response.ok) throw new Error(`${layer.file}: ${response.status}`);
    const data = await response.json();
    const style = STYLES[layer.key];
    L.geoJSON(data, {
      style: style.style,
      pointToLayer: (feature, at) => L.circleMarker(at, { ...style.point(feature), bubblingMouseEvents: false }),
      onEachFeature: (feature, shape) => {
        shape.bindPopup(() => style.popup(feature), { maxWidth: 260 });
        if (feature.properties.name) shape.bindTooltip(feature.properties.name, { direction: 'top', offset: [0, -6] });
      },
    }).addTo(groups.get(layer.key));
    return [layer.key, data.features.length];
  })).then(Object.fromEntries).catch(error => { onError?.(error); return {}; });

  const visible = key => state.layers[key] && !(state.level === 'street' && (key === 'pedway' || key === 'access'));
  function show(next) {
    state = { layers: { ...next.layers }, level: next.level };
    for (const [key, group] of groups) {
      if (visible(key)) group.addTo(map); else group.remove();
    }
    tiles?.setOpacity(state.level === 'pedway' ? 0.4 : 1);
    panel.sync();
  }

  // The panel: a Leaflet control with a button that opens a list of checkboxes.
  const panel = (() => {
    const Control = L.Control.extend({ options: { position: 'topright' }, onAdd() {
      const box = element('div', null, { className: 'leaflet-bar layers-control' });
      const toggle = element('button', 'Layers', { type: 'button', id: 'layers-open', 'aria-expanded': 'false', 'aria-controls': 'layers-panel' });
      const sheet = element('div', null, { id: 'layers-panel', className: 'layers-panel', hidden: '' });
      const boxes = new Map();
      const heading = element('h3', 'Show on map');
      sheet.append(heading);
      for (const layer of DATA_LAYERS) {
        const input = element('input', null, { type: 'checkbox', id: `layer-${layer.key}`, value: layer.key });
        const swatch = element('span', null, { className: `layer-swatch swatch-${layer.key}`, 'aria-hidden': 'true' });
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
      sheet.append(levelLabel, element('p', 'Data © OpenStreetMap contributors. The Pedway changes with building hours; check signs underground.', { className: 'layers-note' }));
      toggle.onclick = () => { sheet.hidden = !sheet.hidden; toggle.setAttribute('aria-expanded', String(!sheet.hidden)); };
      box.addEventListener('keydown', event => { if (event.key === 'Escape' && !sheet.hidden) { sheet.hidden = true; toggle.setAttribute('aria-expanded', 'false'); toggle.focus(); } });
      box.append(toggle, sheet);
      L.DomEvent.disableClickPropagation(box);
      L.DomEvent.disableScrollPropagation(box);
      this.sync = () => {
        for (const [key, input] of boxes) input.checked = Boolean(state.layers[key]);
        level.value = state.level;
        for (const key of ['pedway', 'access']) boxes.get(key).disabled = state.level === 'street';
      };
      return box;
    } });
    const control = new Control().addTo(map);
    return { sync: () => control.sync?.() };
  })();

  return { show, loaded, groups };
}
