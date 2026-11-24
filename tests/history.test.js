// Data history H2: migrations, and building any app version with any snapshot.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrationPath, migrate, mapProperties, dataForApp } from '../scripts/migrate-data.mjs';
import { DATA_DIR, currentId, readSnapshot, writeSnapshot, describeFiles } from '../scripts/snapshots.mjs';
import { stage } from '../scripts/stage.mjs';
import { buildAt, appKind } from '../scripts/build-at.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const current = await readSnapshot(DATA_DIR, await currentId());

// A pretend schema 2, in which places call their kind "sort"; migration 1 makes it.
const MIGRATIONS = { 1: texts => ({ ...texts, poi: mapProperties(texts.poi, ({ kind, ...rest }) => ({ ...rest, sort: kind })) }) };
const features = text => JSON.parse(text).features;

async function dataDirWith(...snapshots) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pedway-history-'));
  await writeSnapshot(dir, current.texts, { id: current.manifest.id });
  for (const { id, schema, texts } of snapshots) {
    const files = await describeFiles(texts);
    for (const [layer, file] of Object.entries(files)) {
      await fs.mkdir(path.join(dir, path.dirname(file.path)), { recursive: true });
      await fs.writeFile(path.join(dir, file.path), texts[layer]);
    }
    const { previous, ...rest } = current.manifest;
    await fs.writeFile(path.join(dir, `snapshots/${id}.json`), JSON.stringify({ ...rest, id, schema, files }));
  }
  return dir;
}

test('migrations step through schemas until the app can read them, never downward', () => {
  assert.deepEqual(migrationPath(1, [1]), []);
  assert.deepEqual(migrationPath(1, [2], MIGRATIONS), [1]);
  assert.deepEqual(migrationPath(1, [1, 2], MIGRATIONS), []);
  assert.equal(migrationPath(1, [3], MIGRATIONS), null, 'no migration from 2 to 3');
  assert.equal(migrationPath(5, [1], MIGRATIONS), null);
  const { texts, schema, steps } = migrate(current.texts, 1, [2], MIGRATIONS);
  assert.equal(schema, 2);
  assert.deepEqual(steps, [1]);
  assert.equal(texts.cta, current.texts.cta, 'layers a migration leaves alone are untouched');
  const before = features(current.texts.poi), after = features(texts.poi);
  assert.equal(after.length, before.length);
  assert.equal(after[0].properties.sort, before[0].properties.kind);
  assert.equal(after[0].properties.kind, undefined);
  assert.throws(() => migrate(current.texts, 1, [3], MIGRATIONS), /No migration from data schema 1 to 3/);
});

test('staging migrates a snapshot for an app on a newer schema, and says so in the manifest', async () => {
  const out = path.relative(root, await fs.mkdtemp(path.join(root, '.stage-test-')));
  try {
    await assert.rejects(stage(out, { accepts: [2] }), /schema 1; this app reads 2, and there is no migration/);
    await stage(out, { accepts: [2], migrations: MIGRATIONS });
    const manifest = JSON.parse(await fs.readFile(path.join(root, out, `data/snapshots/${current.manifest.id}.json`), 'utf8'));
    assert.equal(manifest.schema, 2);
    assert.equal(manifest.migratedFrom, 1);
    assert.notEqual(manifest.files.poi.sha256, current.manifest.files.poi.sha256, 'migrated files get their own hashes');
    assert.equal(manifest.files.cta.sha256, current.manifest.files.cta.sha256);
    const staged = await fs.readFile(path.join(root, out, 'data', manifest.files.poi.path), 'utf8');
    assert.equal(features(staged)[0].properties.sort, features(current.texts.poi)[0].properties.kind);
    const ready = await dataForApp(DATA_DIR, current.manifest.id, { accepts: [2], layers: ['poi'], migrations: MIGRATIONS });
    assert.deepEqual(Object.keys(ready.texts), ['poi']);
  } finally {
    await fs.rm(path.join(root, out), { recursive: true, force: true });
  }
});

test('build-at builds this commit with a chosen snapshot, outside any working tree', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pedway-build-at-'));
  try {
    const out = path.join(dir, 'site');
    const info = await buildAt({ app: 'HEAD', out });
    assert.equal(info.app.kind, 'snapshot');
    assert.equal(info.data.snapshot, current.manifest.id);
    for (const file of ['index.html', 'offline-assets.js', 'data/current.json', `data/snapshots/${current.manifest.id}.json`, `data/${current.manifest.files.poi.path}`, 'build-info.json']) {
      await fs.access(path.join(out, file));
    }
    assert.equal(JSON.parse(await fs.readFile(path.join(out, 'build-info.json'), 'utf8')).app.commit.length, 40);
    await assert.rejects(buildAt({ app: 'HEAD', out }), /is not empty/);
    await assert.rejects(buildAt({ app: 'no-such-ref-anywhere', out: path.join(dir, 'x') }), /no commit “no-such-ref-anywhere”/);
    await assert.rejects(buildAt({ app: 'HEAD', data: '2020-01-01', out: path.join(dir, 'y') }), /no data snapshot 2020-01-01/);
    // Data newer than the app cannot be migrated down.
    const dataDir = await dataDirWith({ id: '2030-01-01', schema: 9, texts: current.texts });
    await assert.rejects(buildAt({ app: 'HEAD', data: '2030-01-01', dataDir, out: path.join(dir, 'z') }), /schema 9.*newer than the app/);
    await fs.rm(dataDir, { recursive: true, force: true });
    // The temporary worktree is always removed.
    const { execFileSync } = await import('node:child_process');
    assert.equal(execFileSync('git', ['worktree', 'list'], { cwd: root, encoding: 'utf8' }).trim().split('\n').length, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('app kinds are told apart by what the checkout contains', async () => {
  assert.equal((await appKind(root)).kind, 'snapshot');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pedway-kind-'));
  try {
    assert.equal((await appKind(dir)).kind, 'none');
    await fs.mkdir(path.join(dir, 'src'));
    await fs.writeFile(path.join(dir, 'src/data-layers.js'), "export const DATA_LAYERS = [{ key: 'pedway', file: 'pedway.geojson' }];\n");
    assert.deepEqual(await appKind(dir), { kind: 'flat', accepts: [1], layers: ['pedway'], files: [{ key: 'pedway', file: 'pedway.geojson' }] });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
