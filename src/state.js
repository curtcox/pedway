import { createUrlState } from '../vendor/fragment-kit-v0.5.0/src/index.js';
import { config } from './config.js';
import { type } from './doc.js';
export { config, type };
export const urlState = createUrlState({ config, type });
