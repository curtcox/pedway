// Shows a point in the viewer's preferred format, with a format picker and a copy button.
import { element } from '../vendor/fragment-kit-v0.5.0/src/index.js';
import { FORMATS, formatLocation } from './geo/formats.js';
import { getFormat, setFormat } from './viewer-settings.js';

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    // Older browsers and insecure contexts: copy through a temporary text field.
    const field = element('textarea', null, { readonly: '', style: 'position:fixed;opacity:0' });
    field.value = text; document.body.append(field); field.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    field.remove();
    return ok;
  }
}

let counter = 0;
export function locationView(lat, lon) {
  const id = `location-format-${++counter}`;
  const box = element('div', null, { className: 'location-view' });
  const picker = element('select', null, { id, className: 'location-format', 'aria-label': 'Location format' });
  for (const format of FORMATS) picker.append(element('option', format.name, { value: format.id }));
  const value = element('output', '', { className: 'location-value', for: id });
  const copy = element('button', 'Copy', { type: 'button', className: 'location-copy' });
  const show = () => { value.textContent = formatLocation(lat, lon, picker.value); copy.textContent = 'Copy'; };
  picker.value = getFormat();
  picker.onchange = () => { setFormat(picker.value); show(); };
  copy.onclick = async () => { copy.textContent = await copyText(value.textContent) ? 'Copied' : 'Copy failed'; };
  const row = element('div', null, { className: 'location-row' });
  row.append(value, copy);
  box.append(picker, row);
  show();
  return box;
}
