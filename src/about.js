// About: what the app is, where its data comes from, what it sends where, and keyboard use.
import { createDialog, element } from '../vendor/fragment-kit-v0.5.0/src/index.js';

const link = (text, href) => element('a', text, { href, target: '_blank', rel: 'noopener noreferrer' });
function paragraph(...parts) {
  const p = element('p');
  p.append(...parts);
  return p;
}
function list(items) {
  const ul = element('ul');
  for (const item of items) { const li = element('li'); li.append(...[item].flat()); ul.append(li); }
  return ul;
}

export function createAbout() {
  const ui = createDialog('About Pedway Tools', { id: 'about-dialog' });
  const dataLine = element('p', 'Loading data…', { id: 'about-data' });
  ui.body.classList.add('about-body');
  ui.body.append(
    element('p', 'Maps for getting around the Chicago Pedway, the buildings it connects and the stations beside it. Add pins and notes, then share the map as a link: everything on it travels in the link itself.'),
    element('h3', 'Data'),
    paragraph('The Pedway, entrances, stations and places come from ', link('OpenStreetMap', 'https://www.openstreetmap.org/copyright'),
      ' (© OpenStreetMap contributors, Open Database License) and are refreshed monthly after review. Map tiles are © OpenStreetMap contributors. '
      + 'The Pedway has no official map data, so some corridors, doors and hours may be out of date. Building hours decide which passages are open: check signs underground.'),
    dataLine,
    paragraph('Spotted a mistake? Fix it on ', link('OpenStreetMap', 'https://www.openstreetmap.org/'), ' and it will reach this map at the next refresh.'),
    element('h3', 'Privacy'),
    list([
      'Maps live in their links and, if you save them, in this browser’s library. There is no account and no tracking.',
      'Your location is used only after you tap ◎, and stays on this device.',
      'Addresses the app cannot work out itself are sent to OpenStreetMap’s Nominatim service, only when you press Go.',
      'Pictures in pin notes are shown as links, so opening a shared map loads nothing from other sites.',
    ]),
    element('h3', 'Keyboard'),
    list([
      'Tab moves between the toolbar, search, map controls, pins and the map. With the map focused, arrow keys pan and + and − zoom.',
      'In search, Down moves into the suggestions and Escape closes them.',
      'Add pin, then Place at map centre, adds a pin without a pointer. Enter on a pin opens its popup.',
      'Escape closes dialogs and the Layers panel.',
    ]),
    paragraph('Source code and the plan: ', link('github.com/curtcox/pedway', 'https://github.com/curtcox/pedway'), '.'),
  );
  /** Names the data snapshot on show, once it has loaded. */
  ui.setData = manifest => {
    if (!manifest) { dataLine.textContent = 'The map data could not be loaded.'; return; }
    const date = text => new Date(text).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    dataLine.textContent = `This map shows data snapshot ${manifest.id}`
      + (manifest.osmBase ? `, from OpenStreetMap as of ${date(manifest.osmBase)}.` : manifest.built ? `, built ${date(manifest.built)}.` : '.');
  };
  return ui;
}
