import { createConfig } from '../vendor/fragment-kit-v0.5.0/src/index.js';

export const config = createConfig({
  slug: 'pedway',
  name: 'Pedway Tools',
  storagePrefix: 'pedway',
  canonicalOrigin: 'https://curtcox.github.io/pedway/',
  recoveryOrigin: 'https://curtcox.github.io/pedway/',
  repo: 'curtcox/pedway',
  docs: 'https://github.com/curtcox/pedway#readme',
  gallery: 'examples.html',
  hashbinClientId: '',
  documentType: 'pedway-map',
});
