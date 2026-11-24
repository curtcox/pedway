// Offline copy: registers the service worker and reports its state in the status bar.
import { OfflineClient, element } from '../vendor/fragment-kit-v0.5.0/src/index.js';

export function startOffline({ shell, setStatus, menuButton, navigator = globalThis.navigator }) {
  const label = shell.offlineStatus;
  const show = (text, detail = '') => { label.textContent = text; label.title = detail; };
  let client = null;
  const report = value => {
    if (value?.unsupported) return show('');
    if (value?.ready) return show('Available offline', `Everything this site needs is saved in this browser (${value.count} files). Map tiles you have looked at are kept too.`);
    show('Offline copy incomplete', value?.error ?? `${value?.count ?? 0} of ${value?.total ?? '?'} files saved. Use Repair offline copy in More.`);
  };
  // A new version waits until the viewer chooses to reload; the map itself is safe in the link.
  const onUpdate = registration => {
    // The first install also passes through "waiting" for a moment; only a real update has a controller.
    if (!navigator.serviceWorker.controller) return;
    const reload = element('button', 'Reload', { type: 'button', id: 'offline-reload' });
    reload.onclick = () => {
      if (!registration.waiting) return location.reload();
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
      registration.waiting.postMessage({ type: 'activate-update' });
    };
    setStatus('A new version of Pedway Tools is ready. ', reload);
  };
  const repair = menuButton('Repair offline copy', 'offline-repair', async () => {
    if (!client?.registration) return start();
    show('Repairing offline copy…');
    try { await client.repair(); } catch (error) { show('Offline copy incomplete', error.message); }
  });
  async function start() {
    if (!navigator?.serviceWorker) { repair.hidden = true; return show(''); }
    show('Saving for offline use…', 'Pedway Tools is saving itself in this browser so it works underground with no signal.');
    client = new OfflineClient({ navigator, onStatus: report, onUpdate });
    try { await client.init(); }
    catch (error) { show('Offline copy unavailable', error.message); }
  }
  void start();
  return { get client() { return client; }, start };
}
