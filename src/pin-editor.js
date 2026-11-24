// Dialog for a pin's label, icon, colour and markdown note, with a live preview.
import { createDialog, element } from '../vendor/fragment-kit-v0.5.0/src/index.js';
import { ICONS, LIMITS, pinLocation, inChicago } from './doc.js';
import { encodeGeohash } from './geo/geohash.js';
import { parseLocation, formatLocation } from './geo/formats.js';
import { getFormat } from './viewer-settings.js';
import { ICON_NAMES, GLYPHS } from './pins.js';
import { renderMarkdown } from './markdown.js';

function field(label, control, hint) {
  const wrapper = element('label', null, { className: 'pin-field' });
  wrapper.append(element('span', label), control);
  if (hint) wrapper.append(element('small', hint));
  return wrapper;
}

export function createPinEditor({ onSave, onDelete }) {
  const ui = createDialog('Pin', { id: 'pin-dialog' });
  const form = element('form', null, { id: 'pin-form', method: 'dialog' });
  const label = element('input', null, { id: 'pin-label', type: 'text', maxlength: LIMITS.label, autocomplete: 'off' });
  const icon = element('select', null, { id: 'pin-icon' });
  for (const name of ICONS) icon.append(element('option', `${GLYPHS[name]}  ${ICON_NAMES[name]}`, { value: name }));
  const color = element('input', null, { id: 'pin-color', type: 'color' });
  const md = element('textarea', null, { id: 'pin-md', rows: 5, maxlength: LIMITS.md, spellcheck: 'true' });
  const preview = element('div', null, { id: 'pin-preview', className: 'pin-note pin-preview', 'aria-live': 'polite', 'aria-label': 'Note preview' });
  const where = element('input', null, { id: 'pin-location', type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'pin-location-error' });
  const whereError = element('p', '', { id: 'pin-location-error', className: 'pin-error', 'aria-live': 'polite' });
  const save = element('button', 'Save', { type: 'submit', id: 'pin-save' });
  const remove = element('button', 'Delete pin', { type: 'button', id: 'pin-delete', className: 'danger' });
  const cancel = element('button', 'Cancel', { type: 'button', id: 'pin-cancel' });
  const row = element('div', null, { className: 'pin-row' });
  row.append(field('Icon', icon), field('Colour', color));
  const buttons = element('div', null, { className: 'pin-buttons' });
  buttons.append(save, cancel, remove);
  form.append(field('Label', label), row,
    field('Note', md, 'Markdown: **bold**, *italic*, [link](https://…), lists. Links open in a new tab.'),
    element('h3', 'Preview', { className: 'pin-preview-heading' }), preview,
    field('Location', where, 'Any format: 41.8837, -87.6278 · 123 N State St · Clark & Lake · 16T DM 47906 36872 · a geohash.'), whereError, buttons);
  ui.body.append(form);

  let pin = null, shownLocation = '';
  where.addEventListener('input', () => { whereError.textContent = ''; where.removeAttribute('aria-invalid'); });
  const refresh = () => { preview.replaceChildren(md.value.trim() ? renderMarkdown(md.value) : element('em', 'No note.')); };
  md.addEventListener('input', refresh);
  form.addEventListener('submit', event => {
    event.preventDefault();
    let at = pin.at;
    if (where.value.trim() !== shownLocation) {
      try {
        const { lat, lon } = parseLocation(where.value);
        if (!inChicago(lat, lon)) throw new Error('Pins must be in the Chicago area.');
        at = encodeGeohash(lat, lon, 9);
      } catch (error) {
        whereError.textContent = error.message; where.setAttribute('aria-invalid', 'true'); where.focus();
        return;
      }
    }
    onSave({ ...pin, at, label: label.value.trim(), icon: icon.value, color: color.value.toLowerCase(), md: md.value });
    ui.dialog.close();
  });
  cancel.onclick = () => ui.dialog.close();
  remove.onclick = () => { onDelete(pin.id); ui.dialog.close(); };

  return { ...ui, open(value) {
    pin = value;
    label.value = pin.label; icon.value = pin.icon; color.value = pin.color; md.value = pin.md;
    const [lat, lon] = pinLocation(pin);
    where.value = shownLocation = formatLocation(lat, lon, getFormat());
    whereError.textContent = ''; where.removeAttribute('aria-invalid');
    refresh(); ui.open(); label.focus();
  } };
}
