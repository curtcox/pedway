// Draws a map document's pins as draggable markers with markdown popups.
import { element } from '../vendor/fragment-kit-v0.5.0/src/index.js';
import { pinLocation, inChicago } from './doc.js';
import { renderMarkdown } from './markdown.js';
import { locationView } from './location-view.js';

export const GLYPHS = Object.freeze({ pin: '●', star: '★', door: '⇲', train: 'T', food: '🍴', restroom: 'WC', info: 'i', flag: '⚑' });
export const ICON_NAMES = Object.freeze({ pin: 'Dot', star: 'Star', door: 'Entrance', train: 'Train', food: 'Food', restroom: 'Restroom', info: 'Info', flag: 'Flag' });

function icon(L, pin) {
  const node = element('span', GLYPHS[pin.icon] ?? GLYPHS.pin, { className: 'pin-icon', 'data-icon': pin.icon, 'aria-hidden': 'true' });
  node.style.setProperty('--pin-color', pin.color);
  return L.divIcon({ html: node, className: 'pin-marker', iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -14] });
}

function popup(pin, onEdit) {
  const body = element('div', null, { className: 'pin-popup', 'data-pin': pin.id });
  body.append(element('h3', pin.label || 'Pin'));
  if (pin.md) { const note = element('div', null, { className: 'pin-note' }); note.append(renderMarkdown(pin.md)); body.append(note); }
  body.append(locationView(...pinLocation(pin)));
  const edit = element('button', 'Edit', { type: 'button', className: 'pin-edit' });
  edit.onclick = () => onEdit(pin.id);
  body.append(edit);
  return body;
}

export function createPinLayer(L, map, { onEdit, onMove }) {
  const group = L.layerGroup().addTo(map), markers = new Map();
  return {
    group,
    render(pins) {
      group.clearLayers(); markers.clear();
      for (const pin of pins) {
        const name = pin.label || 'Pin';
        const marker = L.marker(pinLocation(pin), { icon: icon(L, pin), title: name, alt: name, keyboard: true, draggable: true, autoPan: true })
          .bindPopup(() => popup(pin, onEdit), { minWidth: 200, maxWidth: 300 }).addTo(group);
        marker.getElement()?.setAttribute('data-pin', pin.id);
        marker.on('dragend', () => {
          const { lat, lng } = marker.getLatLng();
          if (inChicago(lat, lng)) onMove(pin.id, lat, lng);
          else marker.setLatLng(pinLocation(pin));
        });
        markers.set(pin.id, marker);
      }
    },
    open(id) { markers.get(id)?.openPopup(); },
    close() { map.closePopup(); },
  };
}
