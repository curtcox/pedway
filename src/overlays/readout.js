// The coordinate readout: the map centre (or the pointer, with a mouse) in every
// coordinate system whose overlay is on, each with a Copy button. It is also the
// text alternative for the overlays: in the tab order, and announced politely once
// the map settles. See docs/map-layers.md, section 5.
import { element } from '../../vendor/fragment-kit-v0.5.0/src/index.js';
import { OVERLAYS } from '../map-layers.js';
import { formatDecimal, formatDms } from '../geo/latlon.js';
import { encodeGeohash } from '../geo/geohash.js';
import { formatUsng } from '../geo/usng.js';
import { describeGrid } from '../geo/chicago-grid.js';
import { inChicago } from '../doc.js';
import { copyText } from '../location-view.js';

const NAMES = { latlon: 'Lat/long', geohash: 'Geohash', usng: 'USNG', grid: 'Nearest' };

/**
 * latlonFormat() is the viewer's style ('dms' or decimal). corner(lat, lon) may name
 * the nearest corner from better data; it returns text or null, and the grid model is used otherwise.
 */
export function createReadout(L, map, { latlonFormat = () => 'decimal', corner = () => null } = {}) {
  const values = {
    latlon: (lat, lon) => latlonFormat() === 'dms' ? formatDms(lat, lon) : formatDecimal(lat, lon, 5),
    geohash: (lat, lon) => encodeGeohash(lat, lon, 8),
    usng: (lat, lon) => formatUsng(lat, lon),
    grid: (lat, lon) => inChicago(lat, lon) ? corner(lat, lon) ?? describeGrid(lat, lon).label : 'Outside Chicago',
  };
  let on = {}, pointer = null;
  const rows = new Map();
  const box = element('section', null, { className: 'leaflet-bar coord-readout', id: 'coord-readout', 'aria-label': 'Coordinates', hidden: '' });
  const heading = element('p', 'Map centre', { className: 'readout-where', id: 'coord-readout-where' });
  const live = element('p', '', { className: 'visually-hidden', id: 'coord-readout-live', 'aria-live': 'polite' });
  box.append(heading);
  for (const overlay of OVERLAYS) {
    const row = element('div', null, { className: 'readout-row', 'data-key': overlay.key, hidden: '' });
    const value = element('output', '', { className: 'readout-value', id: `readout-${overlay.key}` });
    const copy = element('button', 'Copy', { type: 'button', className: 'readout-copy', 'aria-label': `Copy ${overlay.title}` });
    copy.onclick = async () => { copy.textContent = await copyText(value.textContent) ? 'Copied' : 'Copy failed'; };
    row.append(element('span', NAMES[overlay.key], { className: 'readout-name' }), value, copy);
    rows.set(overlay.key, { row, value, copy });
    box.append(row);
  }
  box.append(live);

  function update({ announce = false } = {}) {
    const any = Object.values(on).some(Boolean);
    box.hidden = !any;
    map.getContainer().classList.toggle('show-centre', any && !pointer);
    if (!any) return;
    const at = pointer ?? map.getCenter();
    heading.textContent = pointer ? 'Pointer' : 'Map centre';
    const spoken = [];
    for (const [key, { row, value, copy }] of rows) {
      row.hidden = !on[key];
      if (!on[key]) continue;
      const text = values[key](at.lat, at.lng);
      if (value.textContent !== text) { value.textContent = text; copy.textContent = 'Copy'; }
      spoken.push(`${NAMES[key]} ${text}`);
    }
    if (announce) live.textContent = `Map centre: ${spoken.join('; ')}.`;
  }
  const Control = L.Control.extend({ options: { position: 'bottomleft' }, onAdd() {
    L.DomEvent.disableClickPropagation(box);
    L.DomEvent.disableScrollPropagation(box);
    return box;
  } });
  new Control().addTo(map);

  map.on('move', () => { if (!pointer) update(); });
  map.on('moveend', () => update({ announce: !pointer }));
  // With a mouse, the readout follows the pointer; it returns to the centre when the pointer leaves.
  if (globalThis.matchMedia?.('(hover: hover) and (pointer: fine)').matches) {
    let frame = 0;
    map.on('mousemove', event => {
      // Over the map's own controls (this readout, the Layers panel) the centre is shown instead.
      pointer = event.originalEvent?.target?.closest?.('.leaflet-control') ? null : event.latlng;
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; update(); });
    });
    map.getContainer().addEventListener('mouseleave', () => { pointer = null; update(); });
  }

  return {
    element: box,
    show(next = {}) { on = { ...next }; update({ announce: true }); },
    update,
  };
}
