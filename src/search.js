// One search box for every way of naming a place: coordinates in any format,
// Chicago addresses and corners, station and pin names, and, only when asked,
// an OpenStreetMap address lookup.
import { element } from '../vendor/fragment-kit-v0.5.0/src/index.js';
import { parseLocation, formatLocation } from './geo/formats.js';
import { geocode } from './geo/geocode.js';
import { inChicago } from './doc.js';

const norm = text => text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Ranks named places against a query: whole-name starts first, then word starts, then anywhere. */
export function matchNames(places, query, limit = 6) {
  const q = norm(query);
  if (q.length < 2) return [];
  const scored = [];
  for (const place of places) {
    const name = norm(place.name);
    const score = name === q ? 0 : name.startsWith(q) ? 1 : ` ${name}`.includes(` ${q}`) ? 2 : name.includes(q) ? 3 : -1;
    if (score >= 0) scored.push({ place, score });
  }
  return scored.sort((a, b) => a.score - b.score || a.place.name.localeCompare(b.place.name)).slice(0, limit).map(s => s.place);
}

export function createSearch(L, map, { places, onPick }) {
  const form = element('form', null, { className: 'search-form', role: 'search' });
  const input = element('input', null, { type: 'search', id: 'search-input', placeholder: 'Search: address, corner, station, 41.88,-87.63…',
    'aria-label': 'Search for a place', autocomplete: 'off', enterkeyhint: 'search', 'aria-controls': 'search-results', 'aria-autocomplete': 'list' });
  const go = element('button', 'Go', { type: 'submit', id: 'search-go' });
  const results = element('ul', null, { id: 'search-results', className: 'search-results', role: 'listbox', hidden: '' });
  const note = element('p', null, { id: 'search-note', className: 'search-note', hidden: '', 'aria-live': 'polite' });
  form.append(input, go, results, note);

  const Control = L.Control.extend({ options: { position: 'topleft' }, onAdd() {
    const box = element('div', null, { className: 'leaflet-bar search-control' });
    box.append(form);
    L.DomEvent.disableClickPropagation(box);
    L.DomEvent.disableScrollPropagation(box);
    return box;
  } });
  new Control().addTo(map);

  const say = text => { note.textContent = text; note.hidden = !text; };
  function show(list) {
    results.replaceChildren();
    for (const [i, place] of list.entries()) {
      const option = element('li', null, { role: 'option', id: `search-option-${i}` });
      const button = element('button', null, { type: 'button', className: 'search-option' });
      button.append(element('span', place.name, { className: 'search-name' }), element('small', place.detail ?? '', { className: 'search-detail' }));
      button.onclick = () => pick(place);
      option.append(button);
      results.append(option);
    }
    results.hidden = !list.length;
  }
  function pick(place) {
    show([]); say('');
    onPick(place);
  }
  function close() { show([]); say(''); }

  input.addEventListener('input', () => {
    say('');
    show(matchNames(places(), input.value));
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') { close(); }
    if (event.key === 'ArrowDown' && !results.hidden) { event.preventDefault(); results.querySelector('button')?.focus(); }
  });
  results.addEventListener('keydown', event => {
    const buttons = [...results.querySelectorAll('button')], i = buttons.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') { event.preventDefault(); buttons[Math.min(buttons.length - 1, i + 1)]?.focus(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); (i <= 0 ? input : buttons[i - 1]).focus(); }
    if (event.key === 'Escape') { close(); input.focus(); }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query) return;
    // 1. Anything the app can read itself: coordinates, grid addresses, corners.
    try {
      const found = parseLocation(query);
      if (!inChicago(found.lat, found.lon)) { show([]); return say('That place is outside the Chicago area.'); }
      return pick({ name: found.label ?? query, detail: formatLocation(found.lat, found.lon, 'decimal'), lat: found.lat, lon: found.lon });
    } catch { /* not a location format; try names */ }
    // 2. Stations, entrances and pins by name.
    const named = matchNames(places(), query);
    if (named.length === 1 || (named[0] && norm(named[0].name) === norm(query))) return pick(named[0]);
    if (named.length) { show(named); return say('Choose a place.'); }
    // 3. Only now, and only because the user pressed search, ask OpenStreetMap.
    show([]);
    say('Looking up the address at OpenStreetMap…');
    go.disabled = true;
    try {
      const places = (await geocode(query)).filter(p => inChicago(p.lat, p.lon)).map(p => ({ ...p, detail: 'OpenStreetMap' }));
      if (!places.length) say('No match. Try an address like 123 N State St, a corner like Clark & Lake, or coordinates.');
      else if (places.length === 1) pick(places[0]);
      else { show(places); say('Choose a place.'); }
    } catch (error) {
      say(`Address lookup failed: ${error.message} Try a corner like Clark & Lake.`);
    } finally {
      go.disabled = false;
    }
  });
  input.title = 'Addresses the app cannot work out itself are looked up at OpenStreetMap (Nominatim) when you press Go; what you typed is sent there.';
  return { input, form, results, close };
}
