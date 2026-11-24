import { defineConfig, devices } from '@playwright/test';

// Serves the sites scripts/build-at.mjs wrote into _build/ (or COMPAT_DIR) and checks each one runs.
const dir = process.env.COMPAT_DIR ?? '_build';
export default defineConfig({
  testDir: '.',
  outputDir: '../../test-results/compat',
  use: { baseURL: 'http://127.0.0.1:8010/', serviceWorkers: 'block' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: `python3 -m http.server 8010 --bind 127.0.0.1 --directory ${dir}`, url: 'http://127.0.0.1:8010/', reuseExistingServer: !process.env.CI, cwd: '../..' },
});
