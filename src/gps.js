// "My location": watches the device position only after the user asks, draws it
// with its accuracy circle, follows it until the map is dragged, and offers to
// drop a pin there or jump to the nearest Pedway entrance.
import { element } from '../vendor/fragment-kit-v0.5.0/src/index.js';
import { inChicago } from './doc.js';

const metres = (a, b) => Math.hypot((a[0] - b[0]) * 111000, (a[1] - b[1]) * 82800);
// Underground, phones often report a stale or street-level fix far from the truth.
export const ROUGH_M = 60;

/** Nearest feature to a point among GeoJSON point features, with its distance in metres. */
export function nearest(features, lat, lon) {
  let best = null;
  for (const feature of features) {
    const [flon, flat] = feature.geometry.coordinates;
    const distance = metres([lat, lon], [flat, flon]);
    if (!best || distance < best.distance) best = { feature, distance };
  }
  return best;
}

export function createGps(L, map, { setStatus, onDropPin, accessPoints, geolocation = () => navigator.geolocation }) {
  const layer = L.layerGroup();
  const circle = L.circle([0, 0], { radius: 1, color: '#1a73e8', weight: 1, fillOpacity: 0.12, interactive: false });
  const dot = L.circleMarker([0, 0], { radius: 7, color: '#fff', weight: 2, fillColor: '#1a73e8', fillOpacity: 1, interactive: false, className: 'gps-dot' });
  layer.addLayer(circle).addLayer(dot);
  let watch = null, fix = null, follow = true, source = null;

  const button = element('button', '◎', { type: 'button', id: 'gps-toggle', title: 'Show my location', 'aria-label': 'Show my location', 'aria-pressed': 'false' });
  const Control = L.Control.extend({ options: { position: 'topleft' }, onAdd() {
    const box = element('div', null, { className: 'leaflet-bar gps-control' });
    box.append(button);
    L.DomEvent.disableClickPropagation(box);
    return box;
  } });
  new Control().addTo(map);
  button.onclick = () => (watch === null ? start() : stop());
  map.on('dragstart', () => { follow = false; });

  const dropButton = element('button', 'Drop pin here', { type: 'button', id: 'gps-drop' });
  const nearButton = element('button', 'Nearest entrance', { type: 'button', id: 'gps-nearest' });
  const stopButton = element('button', 'Stop', { type: 'button', id: 'gps-stop' });
  dropButton.onclick = () => { if (fix) onDropPin(fix.lat, fix.lon); };
  nearButton.onclick = () => {
    if (!fix) return;
    const found = nearest(accessPoints(), fix.lat, fix.lon);
    if (!found) return setStatus('The entrance data has not loaded.', stopButton);
    const [lon, lat] = found.feature.geometry.coordinates;
    follow = false;
    map.setView([lat, lon], Math.max(map.getZoom(), 18), map.options.zoomAnimation ? {} : { animate: false });
    const name = found.feature.properties.name ?? ({ elevator: 'Elevator', station: 'Station entrance' }[found.feature.properties.kind] ?? 'Entrance');
    setStatus(`${name}, about ${Math.round(found.distance)} m away. `, dropButton, stopButton);
  };

  function report() {
    const accuracy = Math.round(fix.accuracy);
    if (!inChicago(fix.lat, fix.lon)) return setStatus(`You seem to be outside Chicago (±${accuracy} m). `, stopButton);
    const rough = fix.accuracy > ROUGH_M ? ' Location is rough; underground GPS is often wrong, so check for signs.' : '';
    setStatus(`You are here (±${accuracy} m).${rough} `, dropButton, nearButton, stopButton);
  }
  function update(position) {
    const { latitude: lat, longitude: lon, accuracy } = position.coords;
    const first = !fix;
    fix = { lat, lon, accuracy };
    circle.setLatLng([lat, lon]).setRadius(accuracy);
    dot.setLatLng([lat, lon]);
    layer.addTo(map);
    if (inChicago(lat, lon) && (first || follow)) map.setView([lat, lon], first ? Math.max(map.getZoom(), 17) : map.getZoom(), map.options.zoomAnimation ? {} : { animate: false });
    report();
  }
  function failed(error) {
    const reason = { 1: 'Location permission was refused. You can allow it in your browser settings.',
      2: 'Your location is not available here. Underground, try again near an entrance.', 3: 'Finding your location took too long.' }[error.code] ?? error.message;
    if (error.code === 1 || !fix) { stop(); setStatus(reason); } else setStatus(`${reason} Showing the last known position. `, dropButton, nearButton, stopButton);
  }
  function start() {
    source = geolocation();
    if (!source) return setStatus('This browser cannot share your location.');
    if (!window.isSecureContext) return setStatus('Location needs a secure (https) page.');
    follow = true;
    button.setAttribute('aria-pressed', 'true');
    button.classList.add('active');
    setStatus('Finding your location… ', stopButton);
    watch = source.watchPosition(update, failed, { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 });
  }
  function stop() {
    if (watch !== null) source?.clearWatch(watch);
    watch = null; fix = null;
    layer.remove();
    button.setAttribute('aria-pressed', 'false');
    button.classList.remove('active');
    setStatus('');
  }
  stopButton.onclick = stop;
  return { start, stop, get fix() { return fix; }, get active() { return watch !== null; } };
}
