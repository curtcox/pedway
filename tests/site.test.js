import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { stage, SHIP, SKIP, CACHE_PREFIX } from '../scripts/stage.mjs';
import { DATA_DIR, currentId, readSnapshot, writeSnapshot } from '../scripts/snapshots.mjs';
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

test('the worker loads the manifest before the kit and keeps the tile cache', async () => {
  const worker = await fs.readFile(path.join(root, 'service-worker.js'), 'utf8');
  assert.match(worker, /importScripts\('offline-assets\.js', 'vendor\/fragment-kit-v0\.5\.0\/src\/offline\/sw-core\.js'\)/);
  assert.match(worker, /extraCaches: \[TILE_CACHE\]/);
  assert.ok(worker.indexOf('FragmentKitOfflineConfig') < worker.indexOf('importScripts'));
  assert.match(worker, new RegExp(`TILE_CACHE = '${CACHE_PREFIX}-`));
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
    for (const entry of SKIP) await assert.rejects(fs.access(path.join(target, entry)));
    // The offline manifest covers every file the page needs, with matching hashes.
    const sandbox = {};
    vm.runInNewContext(await fs.readFile(path.join(target, 'offline-assets.js'), 'utf8'), sandbox);
    const assets = sandbox.OfflineAssets;
    assert.ok(assets.version.startsWith(CACHE_PREFIX + '-'));
    const { manifest } = await readSnapshot(DATA_DIR, await currentId());
    for (const file of ['index.html', 'style.css', 'src/app.js', 'src/offline.js', 'data/current.json', `data/snapshots/${manifest.id}.json`,
      manifest.files.pedway.path.replace(/^/, 'data/'), 'vendor/leaflet-1.9.4/leaflet.js',
      'vendor/leaflet-1.9.4/images/marker-icon.png', 'vendor/fragment-kit-v0.5.0/src/offline/sw-core.js', 'vendor/fragment-kit-v0.5.0/vendor/lz-string-1.5.0.mjs']) {
      assert.ok(assets.assets.includes(file), file);
    }
    assert.ok(!assets.assets.includes('service-worker.js') && !assets.assets.includes('offline-assets.js'));
    assert.ok(!assets.assets.some(file => file.includes('LICENSE')));
    for (const file of assets.assets) {
      assert.equal(createHash('sha256').update(await fs.readFile(path.join(target, file))).digest('hex'), assets.hashes[file], file);
    }
  } finally {
    await fs.rm(path.join(root, out), { recursive: true, force: true });
  }
});

test('staging ships one data snapshot: the current one or the one asked for', async () => {
  const out = path.relative(root, await fs.mkdtemp(path.join(root, '.stage-test-')));
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pedway-stage-data-'));
  try {
    const { manifest, texts } = await readSnapshot(DATA_DIR, await currentId());
    await writeSnapshot(dataDir, texts, { id: manifest.id });
    const poi = JSON.parse(texts.poi);
    poi.features.pop();
    const newer = await writeSnapshot(dataDir, { ...texts, poi: JSON.stringify(poi) }, { id: '2026-12-03' });
    const listing = async () => (await walkData(path.join(root, out, 'data'))).sort();

    await stage(out, { dataDir });
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, out, 'data/current.json'), 'utf8')).snapshot, '2026-12-03');
    assert.deepEqual(await listing(), ['current.json', 'snapshots/2026-12-03.json', ...Object.values(newer.files).map(f => f.path)].sort());

    await stage(out, { dataDir, data: manifest.id });
    assert.equal(JSON.parse(await fs.readFile(path.join(root, out, 'data/current.json'), 'utf8')).snapshot, manifest.id);
    assert.ok(!(await listing()).includes('snapshots/2026-12-03.json'), 'other snapshots stay out of the site');

    await assert.rejects(stage(out, { dataDir, data: '2020-01-01' }), /no data snapshot 2020-01-01/);
    // A snapshot this app cannot read is refused, and the last staged site is left alone.
    const future = { ...newer, id: '2030-01-01', schema: 99 };
    await fs.writeFile(path.join(dataDir, 'snapshots/2030-01-01.json'), JSON.stringify(future));
    await fs.writeFile(path.join(root, out, 'marker'), '');
    await assert.rejects(stage(out, { dataDir, data: '2030-01-01' }), /uses data schema 99/);
    await fs.access(path.join(root, out, 'marker'));
  } finally {
    await fs.rm(path.join(root, out), { recursive: true, force: true });
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

async function walkData(dir, prefix = '') {
  const found = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) found.push(...await walkData(path.join(dir, entry.name), `${prefix}${entry.name}/`));
    else found.push(prefix + entry.name);
  }
  return found;
}

test('staging refuses to write outside the repository', async () => {
  await assert.rejects(stage(os.tmpdir()), /subfolder/);
  await assert.rejects(stage('.'), /subfolder/);
});
