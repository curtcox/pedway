import { createShell, mountGallery } from '../vendor/fragment-kit-v0.5.0/src/index.js';
import { config, urlState } from './state.js';
import { examples } from './examples.js';

createShell({ config }).offlineStatus.textContent = '';
// Gallery links open the map page, not this one.
const app = new URL('./', location.href).href;
mountGallery({ container: document.getElementById('examples'), catalog: examples, urlState: { build: doc => urlState.build(doc, { url: app }) } });
document.body.dataset.ready = 'true';
