// Every site in _build/ (from scripts/build-at.mjs) must load, show its data and throw no errors.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { blankTiles } from '../browser/helpers.js';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)), process.env.COMPAT_DIR ?? '_build');
const builds = fs.existsSync(root) ? fs.readdirSync(root).filter(name => fs.existsSync(path.join(root, name, 'build-info.json'))) : [];

test('there is at least one build to check', () => {
  expect(builds.length, `run scripts/build-at.mjs into ${root} first`).toBeGreaterThan(0);
});

for (const name of builds) {
  const info = JSON.parse(fs.readFileSync(path.join(root, name, 'build-info.json'), 'utf8'));
  test(`${name}: app ${info.app.commit.slice(0, 7)} with ${info.data ? `data ${info.data.snapshot}` : 'no data'}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await blankTiles(page);
    await page.goto(`./${name}/`);
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    // Apps from before M4's layers have data files but do not draw them.
    const counts = await page.evaluate(() => globalThis.pedway?.data?.loaded ?? null);
    if (info.data && counts) {
      const expected = info.app.kind === 'snapshot' ? ['pedway', 'access', 'cta', 'metra', 'poi'] : Object.keys(counts);
      for (const layer of expected) expect(counts[layer], layer).toBeGreaterThan(0);
      if (info.app.kind === 'snapshot') expect(await page.evaluate(() => pedway.data.snapshot.id)).toBe(info.data.snapshot);
    }
    await expect(page.locator('#app-status')).not.toContainText(/could not|Could not/);
    expect(errors).toEqual([]);
  });
}
