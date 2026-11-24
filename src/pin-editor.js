// Dialog for a pin's label, icon, colour and markdown note, with a live preview.
import { createDialog, element } from '../vendor/fragment-kit-v0.5.0/src/index.js';
import { ICONS, LIMITS, pinLocation } from './doc.js';
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
  const where = element('p', '', { id: 'pin-where', className: 'pin-where' });
  const save = element('button', 'Save', { type: 'submit', id: 'pin-save' });
  const remove = element('button', 'Delete pin', { type: 'button', id: 'pin-delete', className: 'danger' });
  const cancel = element('button', 'Cancel', { type: 'button', id: 'pin-cancel' });
  const row = element('div', null, { className: 'pin-row' });
  row.append(field('Icon', icon), field('Colour', color));
  const buttons = element('div', null, { className: 'pin-buttons' });
  buttons.append(save, cancel, remove);
  form.append(field('Label', label), row,
    field('Note', md, 'Markdown: **bold**, *italic*, [link](https://…), lists. Links open in a new tab.'),
    element('h3', 'Preview', { className: 'pin-preview-heading' }), preview, where, buttons);
  ui.body.append(form);

  let pin = null;
  const refresh = () => { preview.replaceChildren(md.value.trim() ? renderMarkdown(md.value) : element('em', 'No note.')); };
  md.addEventListener('input', refresh);
  form.addEventListener('submit', event => {
    event.preventDefault();
    onSave({ ...pin, label: label.value.trim(), icon: icon.value, color: color.value.toLowerCase(), md: md.value });
    ui.dialog.close();
  });
  cancel.onclick = () => ui.dialog.close();
  remove.onclick = () => { onDelete(pin.id); ui.dialog.close(); };

  return { ...ui, open(value) {
    pin = value;
    label.value = pin.label; icon.value = pin.icon; color.value = pin.color; md.value = pin.md;
    const [lat, lon] = pinLocation(pin);
    where.textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)} · geohash ${pin.at}`;
    refresh(); ui.open(); label.focus();
  } };
}
