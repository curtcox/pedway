import { createShell, createQrDialog, HashBinStore, element, download } from '../vendor/fragment-kit-v0.5.0/src/index.js';
import { config, type, urlState } from './state.js';
import { CHICAGO_BOUNDS, MIN_ZOOM, MAX_ZOOM, TILE_URL, TILE_ATTRIBUTION, LOOP_CENTER, DEFAULT_ZOOM } from './map-defaults.js';
import { examples } from './examples.js';
import { createPinLayer } from './pins.js';
import { createShare } from './share.js';

const L = globalThis.L;
const status = document.getElementById('app-status');
const title = element('input', null, { id: 'map-title', type: 'text', placeholder: 'Untitled map', 'aria-label': 'Map title', maxlength: 120, autocomplete: 'off' });

let current = type.normalize({ src: '' });
let loadRevision = 0, lastNavigationEvent = location.href;
const fingerprint = doc => JSON.stringify(doc);
let written = fingerprint(current);

const shell = createShell({ config, actions: [
  { label: 'Share', id: 'share-open', onClick: () => share.open() },
  { label: 'QR code', id: 'qr-open', onClick: () => qr.open(urlState.build(snapshot()).href) },
  { label: 'Loop', id: 'recenter', onClick: () => recenter() },
  { label: 'Download', id: 'download', extra: true, onClick: () => download(new Blob([urlState.documents.serialize(snapshot())], { type: 'application/json' }), type.fileName) },
] });
shell.toolbar.prepend(title);
shell.offlineStatus.textContent = '';

const [[south, west], [north, east]] = CHICAGO_BOUNDS;
const map = L.map('map', { center: LOOP_CENTER, zoom: DEFAULT_ZOOM, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, maxBounds: CHICAGO_BOUNDS, maxBoundsViscosity: 0.8 });
L.tileLayer(TILE_URL, { maxZoom: MAX_ZOOM, attribution: TILE_ATTRIBUTION }).addTo(map);
L.control.scale({ imperial: true, metric: true }).addTo(map);
const pins = createPinLayer(L, map);

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
function snapshot() {
  const center = map.getCenter();
  return type.normalize({ src: title.value, map: { ...current.map,
    view: { c: [clamp(center.lat, south, north), clamp(center.lng, west, east)], z: clamp(Math.round(map.getZoom()), MIN_ZOOM, MAX_ZOOM) } } });
}
function setStatus(message) { status.textContent = message; status.hidden = !message; }

// Leaflet 1.9 drops a setView made while a zoom animation is running: the
// animation's end restores its own target. Wait for it to finish first.
function whenSettled(work) { if (map._animatingZoom) map.once('zoomend', work); else work(); }
function recenter() { whenSettled(() => map.setView(LOOP_CENTER, DEFAULT_ZOOM)); }

function apply(doc) {
  current = type.normalize(doc);
  title.value = current.src;
  document.title = current.src ? `${current.src} — Pedway Tools` : 'Pedway Tools — Chicago Pedway maps';
  pins.render(current.map.pins);
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
    else doc = { src: '' };
    if (revision !== loadRevision) return;
    apply(doc); setStatus('');
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
globalThis.pedway = { map, shell, urlState, snapshot, examples };
document.body.dataset.ready = 'true';
document.documentElement.dataset.ready = 'true';
