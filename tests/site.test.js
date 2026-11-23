import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { stage, SHIP } from '../scripts/stage.mjs';
import { LOOP_CENTER, CHICAGO_BOUNDS, DEFAULT_ZOOM, MIN_ZOOM, MAX_ZOOM } from '../src/map-defaults.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');

test('every local file referenced by index.html exists', async () => {
  const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map(m => m[1]);
  assert.ok(refs.length >= 5);
  for (const ref of refs) await fs.access(path.join(root, ref));
});

test('the page keeps a self-only script policy and allows map tiles', () => {
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /script-src 'self';/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.match(csp, /img-src [^;]*https:\/\/tile\.openstreetmap\.org/);
});

test('the deploy marker is present', () => {
  assert.match(html, /pedway-tools-app/);
});

test('the default view is the Loop, inside the allowed bounds', () => {
  const [[south, west], [north, east]] = CHICAGO_BOUNDS;
  const [lat, lon] = LOOP_CENTER;
  assert.ok(lat > south && lat < north && lon > west && lon < east);
  assert.ok(MIN_ZOOM <= DEFAULT_ZOOM && DEFAULT_ZOOM <= MAX_ZOOM);
});

test('staging copies the allowlist and leaves out tooling', async () => {
  const out = path.relative(root, await fs.mkdtemp(path.join(root, '.stage-test-')));
  try {
    const target = await stage(out);
    for (const entry of SHIP) await fs.access(path.join(target, entry));
    await fs.access(path.join(target, '.nojekyll'));
    await assert.rejects(fs.access(path.join(target, 'vendor/fragment-kit-v0.5.0/tools')));
    await assert.rejects(fs.access(path.join(target, 'PLAN.md')));
  } finally {
    await fs.rm(path.join(root, out), { recursive: true, force: true });
  }
});

test('staging refuses to write outside the repository', async () => {
  await assert.rejects(stage(os.tmpdir()), /subfolder/);
  await assert.rejects(stage('.'), /subfolder/);
});
