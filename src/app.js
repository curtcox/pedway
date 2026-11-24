import { createShell, createQrDialog, HashBinStore, element, openLibrary, createLibraryPanel } from '../vendor/fragment-kit-v0.5.0/src/index.js';
import { config, type, urlState } from './state.js';
import { CHICAGO_BOUNDS, MIN_ZOOM, MAX_ZOOM, TILE_URL, TILE_ATTRIBUTION, LOOP_CENTER, DEFAULT_ZOOM } from './map-defaults.js';
import { examples } from './examples.js';
import { createPinLayer } from './pins.js';
import { createPinEditor } from './pin-editor.js';
import { createShare } from './share.js';
import { pinAt, pinLocation, inChicago, LIMITS, LAYERS, OVERLAYS, LEVELS, BASES } from './doc.js';
import { createDataLayers, createPanes, POI_KINDS } from './layers.js';
import { tileInsideBox } from './base-map.js';
import { createOverlays } from './overlays/overlays.js';
import { createReadout } from './overlays/readout.js';
import { createCorners, drawCornerLabels } from './overlays/corners.js';
import { createGps } from './gps.js';
import { createSearch } from './search.js';
import { locationView } from './location-view.js';
import { externalLinks } from './external.js';
import { getLayerDefaults, setLayerDefaults, getFormat } from './viewer-settings.js';
import { createFileActions } from './file-actions.js';
import { startOffline } from './offline.js';
import { createAbout } from './about.js';

const L = globalThis.L;
// Keep popups clear of the search box and status bar when they auto-pan into view.
L.Popup.mergeOptions({ autoPanPaddingTopLeft: L.point(10, 110), autoPanPaddingBottomRight: L.point(10, 30) });
const status = document.getElementById('app-status');
const title = element('input', null, { id: 'map-title', type: 'text', placeholder: 'Untitled map', 'aria-label': 'Map title', maxlength: 120, autocomplete: 'off' });

let current = type.normalize({ src: '' });
let loadRevision = 0, lastNavigationEvent = location.href;
const fingerprint = doc => JSON.stringify(doc);
let written = fingerprint(current);
let libraryPanel = null;   // set once the library opens; null where IndexedDB is unavailable

const shell = createShell({ config, actions: [
  { label: 'Add pin', id: 'pin-add', onClick: () => placing ? stopPlacing() : startPlacing() },
  { label: 'Share', id: 'share-open', onClick: () => share.open() },
  { label: 'QR code', id: 'qr-open', extra: true, onClick: () => qr.open(urlState.build(snapshot()).href) },
  { label: 'Loop', id: 'recenter', onClick: () => recenter() },
] });
shell.toolbar.prepend(title);
// Buttons that live only in the More menu.
function menuButton(label, id, onClick) {
  const button = element('button', label, { type: 'button', id });
  button.onclick = () => { shell.drawer.dialog.close(); onClick(); };
  shell.drawer.body.append(button);
  return button;
}

const [[south, west], [north, east]] = CHICAGO_BOUNDS;
// Viewers who ask the system for less motion get a map that jumps instead of gliding.
const still = matchMedia('(prefers-reduced-motion: reduce)').matches, motion = still ? { animate: false } : {};
const map = L.map('map', { center: LOOP_CENTER, zoom: DEFAULT_ZOOM, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, maxBounds: CHICAGO_BOUNDS, maxBoundsViscosity: 0.8, zoomControl: false,
  zoomAnimation: !still, fadeAnimation: !still, markerZoomAnimation: !still, inertia: !still });
// Search first so it sits at the top left, above zoom and "my location".
const search = createSearch(L, map, { places: () => searchPlaces(), onPick: place => showSearchHit(place),
  snapCorner: (label, lat, lon) => corners.snap(label, lat, lon) });
L.control.zoom({ position: 'topleft' }).addTo(map);
// CORS tiles can be kept by the offline worker without the quota cost of opaque responses.
// With the downtown map on, tiles wholly inside its box are never fetched (options.skipInsideBox).
const MaskedTiles = L.TileLayer.extend({
  _isValidTile(coords) {
    if (this.options.skipInsideBox && tileInsideBox(L, this._map, coords, this.getTileSize().x)) return false;
    return L.TileLayer.prototype._isValidTile.call(this, coords);
  },
});
// The data layers add the tiles when the map's base needs them.
const tiles = new MaskedTiles(TILE_URL, { maxZoom: MAX_ZOOM, attribution: TILE_ATTRIBUTION, crossOrigin: true });
map.attributionControl.addAttribution(TILE_ATTRIBUTION);
L.control.scale({ imperial: true, metric: true }).addTo(map);
const pins = createPinLayer(L, map, {
  onEdit: id => { const pin = findPin(id); if (pin) { pins.close(); editor.open(pin); } },
  onMove: (id, lat, lon) => setPins(current.map.pins.map(p => p.id === id ? pinAt(lat, lon, p) : p)),
});
createPanes(map);
const latlonFormat = () => getFormat() === 'dms' ? 'dms' : 'decimal';
// Street corners from the intersections data, once it has loaded (data is created below).
const corners = createCorners(() => data.features.get('intersections') ?? []);
const overlays = createOverlays(L, map, { latlonFormat, extras: { grid: group => drawCornerLabels(L, map, group, () => data.features.get('intersections') ?? []) } });
const readout = createReadout(L, map, { latlonFormat, corner: (lat, lon) => corners.describe(lat, lon) });
const data = createDataLayers(L, map, { tiles, overlays, readout,
  onChange: ({ layers, level, gps: offer, overlays: on, base }) => setLayers(layers, level, offer, on, base),
  onError: () => setStatus('Some map data could not be loaded. Pins still work.') });
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
    ...named('poi', p => `${POI_KINDS[p.kind] ?? p.kind}${p.pedway ? ', on the Pedway' : ''}`),
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
    map.setView(target, zoom, motion);
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
// Layer, overlay and view choices go into the link and become this viewer's default for new maps.
function setLayers(layers, level, offer = current.map.gps, on = current.map.overlays, base = current.map.base) {
  current = type.normalize({ ...current, src: title.value, map: { ...current.map, layers, level, gps: offer, overlays: on, base } });
  data.show(current.map);
  setLayerDefaults({ layers: current.map.layers, level: current.map.level, overlays: current.map.overlays, base: current.map.base });
  changed();
}
function blankMap() {
  const { layers, level, overlays: on, base } = getLayerDefaults();
  const known = (record, defaults) => Object.fromEntries(Object.keys(defaults).filter(key => typeof record?.[key] === 'boolean').map(key => [key, record[key]]));
  return { src: '', map: { layers: known(layers, LAYERS), overlays: known(on, OVERLAYS), level: LEVELS.includes(level) ? level : 'both',
    base: BASES.includes(base) ? base : 'both' } };
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
function recenter() { whenSettled(() => map.setView(LOOP_CENTER, DEFAULT_ZOOM, motion)); }

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
  libraryPanel?.changed();
  if (fingerprint(doc) === written) return;
  written = fingerprint(doc); current = doc;
  urlState.write(doc);
}
map.on('moveend', changed);
title.addEventListener('input', changed);

const store = new HashBinStore({ config, type });
async function navigate(href = location.href) {
  const revision = ++loadRevision; urlState.cancel(); setStatus(''); libraryPanel?.cancelLoad();
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
    // Links and CIDs are logged in the library's Recent list; examples and blank maps are not.
    const record = intent.kind === 'source' || intent.kind === 'cid';
    void libraryPanel?.opened(current, record ? { kind: intent.kind === 'cid' ? 'cid' : 'link', source: intent.cid } : { record: false });
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

// Opens a map from a file or the library as a new history entry, so Back returns to the previous map.
function openDoc(doc) {
  ++loadRevision; urlState.cancel(); stopPlacing();
  apply(doc);
  history.pushState(null, '', urlState.build(current).href);
  lastNavigationEvent = location.href;
}

// Library: named maps with history, kept in this browser (IndexedDB).
try {
  const library = await openLibrary({ config, type, describe: doc => doc.src || `Untitled map with ${doc.map.pins.length} pin${doc.map.pins.length === 1 ? '' : 's'}` });
  libraryPanel = createLibraryPanel({ library, store, urlState, getSnapshot: snapshot, shell, container: shell.toolbar,
    onLoad: async doc => { openDoc(doc); setStatus(''); } });
  // Save and Library sit in the toolbar, and in More on phones so the toolbar keeps to one row.
  // Save as… is always in More.
  const { saveButton, saveAsButton, openButton, statusEl } = libraryPanel;
  saveButton.title = 'Save this map in this browser’s library';
  saveButton.classList.add('fk-mobile-extra'); openButton.classList.add('fk-mobile-extra');
  menuButton('Save', 'library-save-menu', () => saveButton.click()).classList.add('mobile-only');
  shell.drawer.body.append(saveAsButton);
  menuButton('Library', 'library-open-menu', () => openButton.click());
  saveAsButton.addEventListener('click', () => shell.drawer.dialog.close(), { capture: true });
  // The header shows this status on phones, where the status bar moves into More.
  statusEl.setAttribute('data-fk-primary-status', '');
  shell.status.prepend(statusEl);
} catch (error) {
  shell.draftStatus.textContent = 'Library unavailable: ' + error.message;
}

const files = createFileActions({ urlState, getSnapshot: snapshot, getPins: () => current.map.pins, blankMap, setPins, setStatus,
  // A file is a new map: unbind it from any library entry unless it matches a saved one.
  openDoc: doc => { openDoc(doc); void libraryPanel?.opened(current, { record: false }); },
  dropTarget: map.getContainer(),
  onLibraryFile: () => {
    if (!libraryPanel) return setStatus('That is a library export, and the library is not available in this browser.');
    libraryPanel.openLibraryDialog(); libraryPanel.openImport();
  } });
menuButton('Open file…', 'file-open', () => files.pick());
menuButton('Export…', 'export-open', () => files.openExport());

const offline = startOffline({ shell, setStatus, menuButton });
const about = createAbout();
void data.loaded.then(() => {
  about.setData(data.snapshot);
  // Corner labels and the nearest corner need the intersections data.
  overlays.redraw('grid'); readout.update();
});
menuButton('About', 'about-open', () => about.open());
await navigate();

// Exposed for browser tests and debugging.
globalThis.pedway = { map, shell, urlState, snapshot, examples, pins, data, overlays, readout, gps, search, files, offline, get library() { return libraryPanel; } };
document.body.dataset.ready = 'true';
document.documentElement.dataset.ready = 'true';
