import { createShell, createQrDialog, HashBinStore, element, download } from '../vendor/fragment-kit-v0.5.0/src/index.js';
import { config, type, urlState } from './state.js';
import { CHICAGO_BOUNDS, MIN_ZOOM, MAX_ZOOM, TILE_URL, TILE_ATTRIBUTION, LOOP_CENTER, DEFAULT_ZOOM } from './map-defaults.js';
import { examples } from './examples.js';
import { createPinLayer } from './pins.js';
import { createPinEditor } from './pin-editor.js';
import { createShare } from './share.js';
import { pinAt, pinLocation, inChicago, LIMITS, LAYERS, LEVELS } from './doc.js';
import { createDataLayers } from './layers.js';
import { createGps } from './gps.js';
import { createSearch } from './search.js';
import { locationView } from './location-view.js';
import { externalLinks } from './external.js';
import { getLayerDefaults, setLayerDefaults } from './viewer-settings.js';

const L = globalThis.L;
// Keep popups clear of the search box and status bar when they auto-pan into view.
L.Popup.mergeOptions({ autoPanPaddingTopLeft: L.point(10, 110), autoPanPaddingBottomRight: L.point(10, 30) });
const status = document.getElementById('app-status');
const title = element('input', null, { id: 'map-title', type: 'text', placeholder: 'Untitled map', 'aria-label': 'Map title', maxlength: 120, autocomplete: 'off' });

let current = type.normalize({ src: '' });
let loadRevision = 0, lastNavigationEvent = location.href;
const fingerprint = doc => JSON.stringify(doc);
let written = fingerprint(current);

const shell = createShell({ config, actions: [
  { label: 'Add pin', id: 'pin-add', onClick: () => placing ? stopPlacing() : startPlacing() },
  { label: 'Share', id: 'share-open', onClick: () => share.open() },
  { label: 'QR code', id: 'qr-open', extra: true, onClick: () => qr.open(urlState.build(snapshot()).href) },
  { label: 'Loop', id: 'recenter', onClick: () => recenter() },
  { label: 'Download', id: 'download', extra: true, onClick: () => download(new Blob([urlState.documents.serialize(snapshot())], { type: 'application/json' }), type.fileName) },
] });
shell.toolbar.prepend(title);
shell.offlineStatus.textContent = '';

const [[south, west], [north, east]] = CHICAGO_BOUNDS;
const map = L.map('map', { center: LOOP_CENTER, zoom: DEFAULT_ZOOM, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, maxBounds: CHICAGO_BOUNDS, maxBoundsViscosity: 0.8, zoomControl: false });
// Search first so it sits at the top left, above zoom and "my location".
const search = createSearch(L, map, { places: () => searchPlaces(), onPick: place => showSearchHit(place) });
L.control.zoom({ position: 'topleft' }).addTo(map);
const tiles = L.tileLayer(TILE_URL, { maxZoom: MAX_ZOOM, attribution: TILE_ATTRIBUTION }).addTo(map);
L.control.scale({ imperial: true, metric: true }).addTo(map);
const pins = createPinLayer(L, map, {
  onEdit: id => { const pin = findPin(id); if (pin) { pins.close(); editor.open(pin); } },
  onMove: (id, lat, lon) => setPins(current.map.pins.map(p => p.id === id ? pinAt(lat, lon, p) : p)),
});
const data = createDataLayers(L, map, { tiles,
  onChange: ({ layers, level, gps: offer }) => setLayers(layers, level, offer),
  onError: () => setStatus('Could not load the Pedway and station data. Pins still work.') });
const gps = createGps(L, map, { setStatus: (...args) => setStatus(...args), onDropPin: (lat, lon) => { gps.stop(); addPin(lat, lon); },
  accessPoints: () => data.features.get('access') });
// Named places the search box can find without the network.
function searchPlaces() {
  const named = (key, detail) => (data.features.get(key) ?? []).filter(f => f.properties.name)
    .map(f => ({ name: f.properties.name, detail: detail(f.properties), lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] }));
  return [
    ...current.map.pins.filter(pin => pin.label).map(pin => { const [lat, lon] = pinLocation(pin); return { name: pin.label, detail: 'Pin on this map', lat, lon }; }),
    ...named('cta', p => `CTA ${p.lines?.join(', ') ?? ''}`.trim()),
    ...named('metra', p => `Metra ${p.lines?.join(', ') ?? ''}`.trim()),
    ...named('access', p => ({ elevator: 'Pedway elevator', station: 'Station entrance' }[p.kind] ?? 'Pedway entrance')),
  ];
}
const searchMarker = L.circleMarker([0, 0], { radius: 10, color: '#d81b60', weight: 3, fillOpacity: 0.15, className: 'search-marker' });
function showSearchHit(place) {
  stopPlacing();
  const body = element('div', null, { className: 'search-hit' });
  const drop = element('button', 'Drop pin here', { type: 'button', id: 'search-drop' });
  drop.onclick = () => { searchMarker.remove(); addPin(place.lat, place.lon); };
  body.append(element('h3', place.name), locationView(place.lat, place.lon), drop, externalLinks(place.lat, place.lon, place.name));
  searchMarker.setLatLng([place.lat, place.lon]).bindPopup(body, { maxWidth: 280 }).addTo(map);
  whenSettled(() => {
    const zoom = Math.max(map.getZoom(), 18), target = L.latLng(place.lat, place.lon);
    if (map.getCenter().distanceTo(target) < 1 && map.getZoom() === zoom) return searchMarker.openPopup();
    // Open the popup once the map has arrived, so it does not shift under the user's finger.
    map.once('moveend', () => searchMarker.openPopup());
    map.setView(target, zoom);
  });
}
const editor = createPinEditor({
  onSave: pin => { setPins(current.map.pins.map(p => p.id === pin.id ? pin : p)); pins.open(pin.id); },
  onDelete: id => setPins(current.map.pins.filter(p => p.id !== id)),
});

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
function snapshot() {
  const center = map.getCenter();
  return type.normalize({ src: title.value, map: { ...current.map,
    view: { c: [clamp(center.lat, south, north), clamp(center.lng, west, east)], z: clamp(Math.round(map.getZoom()), MIN_ZOOM, MAX_ZOOM) } } });
}
function setStatus(message, ...extra) { status.replaceChildren(message, ...extra); status.hidden = !message; }

// Pins: every change replaces the list, redraws, and writes the URL.
const findPin = id => current.map.pins.find(pin => pin.id === id);
function setPins(list) {
  current = type.normalize({ ...current, src: title.value, map: { ...current.map, pins: list } });
  pins.render(current.map.pins);
  changed();
}
// Layer and view choices go into the link and become this viewer's default for new maps.
function setLayers(layers, level, offer = current.map.gps) {
  current = type.normalize({ ...current, src: title.value, map: { ...current.map, layers, level, gps: offer } });
  data.show(current.map);
  setLayerDefaults({ layers: current.map.layers, level: current.map.level });
  changed();
}
function blankMap() {
  const { layers, level } = getLayerDefaults();
  const known = Object.fromEntries(Object.keys(LAYERS).filter(key => typeof layers?.[key] === 'boolean').map(key => [key, layers[key]]));
  return { src: '', map: { layers: known, level: LEVELS.includes(level) ? level : 'both' } };
}
function nextId() {
  const ids = new Set(current.map.pins.map(pin => pin.id));
  let n = current.map.pins.length + 1;
  while (ids.has('p' + n)) n++;
  return 'p' + n;
}
function addPin(lat, lon) {
  stopPlacing();
  if (!inChicago(lat, lon)) return setStatus('Pins must be in the Chicago area.');
  if (current.map.pins.length >= LIMITS.pins) return setStatus(`A map can have at most ${LIMITS.pins} pins.`);
  const pin = pinAt(lat, lon, { id: nextId() });
  setPins([...current.map.pins, pin]);
  editor.open(findPin(pin.id));
}

// "Add pin" waits for a tap on the map; the status bar offers the map centre for keyboard users.
let placing = false;
const placeHere = element('button', 'Place at map centre', { type: 'button', id: 'pin-place-centre' });
const stopButton = element('button', 'Cancel', { type: 'button', id: 'pin-place-cancel' });
placeHere.onclick = () => { const { lat, lng } = map.getCenter(); addPin(lat, lng); };
stopButton.onclick = () => stopPlacing();
function startPlacing() {
  placing = true; map.getContainer().classList.add('placing');
  document.getElementById('pin-add').setAttribute('aria-pressed', 'true');
  setStatus('Tap the map where the pin should go. ', placeHere, stopButton);
}
function stopPlacing() {
  if (!placing) return;
  placing = false; map.getContainer().classList.remove('placing');
  document.getElementById('pin-add').setAttribute('aria-pressed', 'false');
  setStatus('');
}
map.on('click', event => { if (placing) addPin(event.latlng.lat, event.latlng.lng); });
// Right-click, or a long press on touch screens, drops a pin directly.
map.on('contextmenu', event => addPin(event.latlng.lat, event.latlng.lng));
document.addEventListener('keydown', event => { if (event.key === 'Escape' && placing) stopPlacing(); });

// Leaflet 1.9 drops a setView made while a zoom animation is running: the
// animation's end restores its own target. Wait for it to finish first.
function whenSettled(work) { if (map._animatingZoom) map.once('zoomend', work); else work(); }
function recenter() { whenSettled(() => map.setView(LOOP_CENTER, DEFAULT_ZOOM)); }

function apply(doc) {
  current = type.normalize(doc);
  title.value = current.src;
  document.title = current.src ? `${current.src} — Pedway Tools` : 'Pedway Tools — Chicago Pedway maps';
  pins.render(current.map.pins);
  data.show(current.map);
  whenSettled(() => map.setView(current.map.view.c, current.map.view.z, { animate: false }));
  written = fingerprint(current);
}

// Map moves and title edits update the URL (debounced by Fragment Kit).
function changed() {
  ++loadRevision; lastNavigationEvent = null;
  const doc = snapshot();
  document.title = doc.src ? `${doc.src} — Pedway Tools` : 'Pedway Tools — Chicago Pedway maps';
  if (fingerprint(doc) === written) return;
  written = fingerprint(doc); current = doc;
  urlState.write(doc);
}
map.on('moveend', changed);
title.addEventListener('input', changed);

const store = new HashBinStore({ config, type });
async function navigate(href = location.href) {
  const revision = ++loadRevision; urlState.cancel(); setStatus('');
  try {
    const intent = urlState.parse(href);
    let doc;
    if (intent.kind === 'source') doc = intent.doc;
    else if (intent.kind === 'example') {
      const example = examples.find(value => value.id === intent.id);
      if (!example) throw new Error(`There is no example map called “${intent.id}”.`);
      doc = example.document;
    } else if (intent.kind === 'cid') {
      setStatus('Loading saved map…');
      doc = await store.load(intent.cid);
    } else if (intent.kind === 'publish') throw new Error('Saving to HashBin is not set up for Pedway Tools yet.');
    else doc = blankMap();
    if (revision !== loadRevision) return;
    apply(doc); setStatus('');
    // Never ask for location on load: a map can only offer the button.
    if (current.map.gps && !gps.active) {
      const show = element('button', 'Show my location', { type: 'button', id: 'gps-offer' });
      show.onclick = () => gps.start();
      setStatus('This map suggests showing where you are. ', show);
    }
    if (intent.kind === 'example') history.replaceState(null, '', urlState.build(current).href);
    else if (href !== location.href) {
      const incoming = new URL(href), here = new URL(location.href);
      here.search = incoming.search; here.hash = incoming.hash;
      history.replaceState(null, '', here.href);
    }
  } catch (error) {
    // Keep the current map; never silently fall back to a default.
    if (revision === loadRevision) setStatus(error.message);
  }
}

const share = createShare({ urlState, getSnapshot: snapshot, onQr: href => qr.open(href) });
const qr = createQrDialog({ config, urlState,
  onLoad: outcome => outcome.kind === 'cid' ? navigate(new URL('#' + outcome.cid, location.href).href) : navigate(outcome.href) });

function navigateFromEvent(event) {
  // WebKit fires both popstate and hashchange for one fragment navigation.
  if (event.type === 'hashchange' && event.newURL !== location.href) return;
  if (lastNavigationEvent === location.href) return;
  lastNavigationEvent = location.href;
  void navigate();
}
window.addEventListener('hashchange', navigateFromEvent);
window.addEventListener('popstate', navigateFromEvent);
await navigate();

// Exposed for browser tests and debugging.
globalThis.pedway = { map, shell, urlState, snapshot, examples, pins, data, gps, search };
document.body.dataset.ready = 'true';
document.documentElement.dataset.ready = 'true';
