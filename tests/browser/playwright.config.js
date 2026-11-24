import { defineConfig, devices } from '@playwright/test';

const browsers = (process.env.BROWSERS ?? 'chromium,firefox,webkit').split(',').filter(Boolean);
const projects = browsers.flatMap(name => {
  const desktop = { chromium: devices['Desktop Chrome'], firefox: devices['Desktop Firefox'], webkit: devices['Desktop Safari'] }[name];
  const list = [{ name, use: { ...desktop } }];
  if (process.env.MOBILE !== 'false' && name !== 'firefox') {
    list.push({ name: `${name}-mobile`, use: name === 'webkit' ? { ...devices['iPhone 13'] } : { ...devices['Pixel 7'] } });
  }
  return list;
});

export default defineConfig({
  testDir: '.',
  outputDir: '../../test-results',
  retries: process.env.CI ? 1 : 0,
  // page.route cannot see requests a service worker makes in Firefox and WebKit, so
  // the worker stays off except in offline.spec.js, which serves its own staged site.
  use: { baseURL: process.env.FRAGMENT_KIT_BASE_URL ?? 'http://127.0.0.1:8000/', serviceWorkers: 'block' },
  projects,
});
