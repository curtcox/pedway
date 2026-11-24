// Share dialog: the current map's link, ready to copy or hand to the system share sheet.
import { createDialog, element } from '../vendor/fragment-kit-v0.5.0/src/index.js';

export function createShare({ urlState, getSnapshot, onQr, navigator = globalThis.navigator }) {
  const ui = createDialog('Share this map', { id: 'share-dialog' });
  const field = element('textarea', null, { readonly: '', 'aria-label': 'Share link', id: 'share-link', rows: 4 });
  const copy = element('button', 'Copy link', { type: 'button', id: 'share-copy' });
  const system = element('button', 'Share…', { type: 'button', id: 'share-system' });
  const qr = element('button', 'QR code', { type: 'button', id: 'share-qr' });
  const status = element('p', '', { role: 'status', id: 'share-status' });
  const note = element('p', 'Everything on the map travels inside the link itself. Nothing is uploaded.', { className: 'share-note' });
  system.hidden = typeof navigator?.share !== 'function';
  let href = '';
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(href); status.textContent = 'Copied.'; }
    catch { field.focus(); field.select(); status.textContent = 'Select the link and copy it.'; }
  };
  system.onclick = async () => {
    try { await navigator.share({ title: document.title, url: href }); }
    catch (error) { if (error?.name !== 'AbortError') status.textContent = error.message; }
  };
  qr.onclick = () => { ui.dialog.close(); onQr(href); };
  ui.body.append(note, field, copy, system, qr, status);
  return { ...ui, open() { href = urlState.build(getSnapshot()).href; field.value = href; status.textContent = ''; ui.open(); } };
}
