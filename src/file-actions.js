// Export the map as a file, and open map or GeoJSON files (picker or drag and drop).
import { createDialog, element, download } from '../vendor/fragment-kit-v0.5.0/src/index.js';
import { ACCEPT, MAX_FILE_BYTES, fileStem, toGeoJSON, readMapFile, geoJSONMap, mergePins, skippedNote } from './files.js';

/** A small modal choice. Resolves the chosen value, or null when dismissed. */
export function choose({ title, message, choices, id }) {
  const ui = createDialog(title, { id });
  ui.body.append(element('p', message));
  const row = element('div', null, { className: 'choice-buttons' });
  ui.body.append(row);
  return new Promise(resolve => {
    let settled = false;
    const settle = value => { if (!settled) { settled = true; ui.destroy(); resolve(value); } };
    for (const { label, value, id: buttonId } of choices) {
      const button = element('button', label, { type: 'button', ...(buttonId ? { id: buttonId } : {}) });
      button.onclick = () => settle(value); row.append(button);
    }
    ui.dialog.addEventListener('close', () => settle(null));
    ui.open();
  });
}

export function createFileActions({ urlState, getSnapshot, getPins, blankMap, openDoc, setPins, setStatus, onLibraryFile, dropTarget }) {
  // Export ---------------------------------------------------------------
  const ui = createDialog('Export this map', { id: 'export-dialog' });
  const json = element('button', 'Map file (.json)', { type: 'button', id: 'export-json' });
  const geojson = element('button', 'GeoJSON (.geojson)', { type: 'button', id: 'export-geojson' });
  const status = element('p', '', { role: 'status', id: 'export-status' });
  ui.body.append(
    element('p', 'A map file holds everything on this map and opens again here with Open file…'), json,
    element('p', 'GeoJSON holds the pins as points with their labels and notes, for geojson.io, QGIS, uMap and other mapping tools. This app can open it again too.'), geojson,
    status);
  json.onclick = () => {
    const doc = getSnapshot();
    download(new Blob([urlState.documents.serialize(doc)], { type: 'application/json' }), fileStem(doc.src) + '.json');
    status.textContent = 'Downloaded the map file.';
  };
  geojson.onclick = () => {
    const doc = getSnapshot();
    download(new Blob([JSON.stringify(toGeoJSON(doc), null, 2)], { type: 'application/geo+json' }), fileStem(doc.src) + '.geojson');
    status.textContent = `Downloaded ${doc.map.pins.length} pin${doc.map.pins.length === 1 ? '' : 's'} as GeoJSON.`;
  };

  // Open -----------------------------------------------------------------
  const input = element('input', null, { type: 'file', id: 'file-open-input', accept: ACCEPT, hidden: '', 'aria-label': 'Open a map or GeoJSON file' });
  document.body.append(input);
  input.onchange = () => { const file = input.files?.[0]; input.value = ''; if (file) void openFile(file); };

  async function openFile(file) {
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('This file is too large to be a map.');
      const result = readMapFile(await file.text(), urlState.documents);
      if (result.kind === 'library') return onLibraryFile();
      if (result.kind === 'map') { openDoc(result.doc); return setStatus(`Opened ${file.name}.`); }
      const note = skippedNote(result.skipped);
      if (!result.pins.length) return setStatus(`${file.name} has no points in the Chicago area. ${note}`.trim());
      if (!result.title) result.title = file.name.replace(/\.(geo)?json$/i, '').slice(0, 120);
      const existing = getPins();
      let action = 'new';
      if (existing.length) {
        const count = `${result.pins.length} pin${result.pins.length === 1 ? '' : 's'}`;
        action = await choose({ title: 'Open GeoJSON', id: 'geojson-choice', message: `${file.name} has ${count}. Add them to this map, or open them as a new map?`,
          choices: [{ label: `Add ${count} to this map`, value: 'add', id: 'geojson-add' }, { label: 'Open as a new map', value: 'new', id: 'geojson-new' }, { label: 'Cancel', value: null }] });
      }
      if (action === 'add') {
        const merged = mergePins(existing, result.pins);
        setPins(merged.pins);
        const dropped = merged.dropped ? ` ${merged.dropped} did not fit under the pin limit.` : '';
        setStatus(`Added ${result.pins.length - merged.dropped} pin${result.pins.length - merged.dropped === 1 ? '' : 's'} from ${file.name}.${dropped} ${note}`.trim());
      } else if (action === 'new') {
        openDoc(geoJSONMap(result, blankMap().map));
        setStatus(`Opened ${file.name}. ${note}`.trim());
      }
    } catch (error) { setStatus(`Could not open ${file.name}: ${error.message}`); }
  }

  // Dropping a file anywhere on the map opens it.
  const hasFile = event => [...(event.dataTransfer?.types ?? [])].includes('Files');
  dropTarget.addEventListener('dragover', event => { if (hasFile(event)) { event.preventDefault(); dropTarget.classList.add('dropping'); } });
  dropTarget.addEventListener('dragleave', () => dropTarget.classList.remove('dropping'));
  dropTarget.addEventListener('drop', event => {
    if (!hasFile(event)) return;
    event.preventDefault(); dropTarget.classList.remove('dropping');
    const file = event.dataTransfer.files?.[0];
    if (file) void openFile(file);
  });

  return { openExport() { status.textContent = ''; ui.open(); }, pick() { input.click(); }, openFile };
}
