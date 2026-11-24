// Draws a map document's pins. Editing arrives in M2; notes show as plain text until then.
import { element } from '../vendor/fragment-kit-v0.5.0/src/index.js';
import { pinLocation } from './doc.js';

const GLYPHS = { pin: '●', star: '★', door: '⇲', train: 'T', food: '🍴', restroom: 'WC', info: 'i', flag: '⚑' };

function icon(L, pin) {
  const node = element('span', GLYPHS[pin.icon] ?? GLYPHS.pin, { className: 'pin-icon', 'data-icon': pin.icon });
  node.style.setProperty('--pin-color', pin.color);
  return L.divIcon({ html: node, className: 'pin-marker', iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -14] });
}

function popup(pin) {
  const body = element('div', null, { className: 'pin-popup' });
  body.append(element('h3', pin.label || 'Pin'));
  if (pin.md) body.append(element('p', pin.md, { className: 'pin-note' }));
  return body;
}

export function createPinLayer(L, map) {
  const group = L.layerGroup().addTo(map);
  return {
    group,
    render(pins) {
      group.clearLayers();
      for (const pin of pins) {
        L.marker(pinLocation(pin), { icon: icon(L, pin), title: pin.label || 'Pin', alt: pin.label || 'Pin', keyboard: true })
          .bindPopup(popup(pin)).addTo(group);
      }
    },
  };
}
