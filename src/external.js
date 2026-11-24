// "Open in" links that hand a point to other map and transit apps. Each opens in
// a new tab, or in the app itself on phones that register these URLs.
import { element } from '../vendor/fragment-kit-v0.5.0/src/index.js';

const fixed = value => value.toFixed(6);
export function externalUrls(lat, lon, label = '') {
  const at = `${fixed(lat)},${fixed(lon)}`;
  const query = new URLSearchParams({ api: '1', query: at });
  const name = label.trim();
  return [
    { id: 'google', name: 'Google Maps', href: `https://www.google.com/maps/search/?${query}` },
    { id: 'walk', name: 'Walk there', href: `https://www.google.com/maps/dir/?${new URLSearchParams({ api: '1', destination: at, travelmode: 'walking' })}` },
    { id: 'transit', name: 'Transit there', href: `https://www.google.com/maps/dir/?${new URLSearchParams({ api: '1', destination: at, travelmode: 'transit' })}` },
    { id: 'apple', name: 'Apple Maps', href: `https://maps.apple.com/?${new URLSearchParams({ ll: at, q: name || at })}` },
    { id: 'osm', name: 'OpenStreetMap', href: `https://www.openstreetmap.org/?mlat=${fixed(lat)}&mlon=${fixed(lon)}#map=18/${fixed(lat)}/${fixed(lon)}` },
  ];
}

export function externalLinks(lat, lon, label) {
  const box = element('details', null, { className: 'open-in' });
  box.append(element('summary', 'Open in…'));
  const list = element('ul');
  for (const { id, name, href } of externalUrls(lat, lon, label)) {
    const item = element('li');
    item.append(element('a', name, { href, target: '_blank', rel: 'noopener noreferrer', 'data-app': id }));
    list.append(item);
  }
  box.append(list);
  return box;
}
