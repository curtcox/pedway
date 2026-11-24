// Builds the site from any version of the app with any data snapshot, using only
// the repository: no Overpass, no HashBin, no npm. See docs/data-history.md (H2).
//
//   node scripts/build-at.mjs --app <git ref> [--data <snapshot id>] [--out <dir>]
//
// The app is checked out into a temporary git worktree. The data always comes
// from *this* checkout's data/ folder, so newer data can go into an older app and
// the other way round. Migrations come from this checkout too, since it knows
// every schema up to now. The result is that app's own staging output, plus
// build-info.json saying what went in.
//
// App versions come in three kinds:
//   snapshot  (data history H1 on) the snapshot is written in, migrated to a schema the app reads
//   flat      (M4 to M7) the snapshot's files are written as data/<layer>.geojson
//   none      (M0 to M3) the app shows no data, so none is written
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DATA_DIR, currentId, materialize, geojsonText } from './snapshots.mjs';
import { dataForApp, MIGRATIONS } from './migrate-data.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const exists = file => fs.access(file).then(() => true, () => false);

/** What kind of data an app version expects, and which schemas and layers it reads. */
export async function appKind(appDir) {
  if (await exists(path.join(appDir, 'src/data-snapshot.js'))) {
    const { DATA_SCHEMA, DATA_LAYERS } = await import(pathToFileURL(path.join(appDir, 'src/data-layers.js')).href);
    return { kind: 'snapshot', accepts: [...DATA_SCHEMA.accepts], layers: DATA_LAYERS.map(layer => layer.key), files: DATA_LAYERS };
  }
  if (await exists(path.join(appDir, 'src/data-layers.js'))) {
    // Flat-file apps came before schema versions; their data matches schema 1.
    const { DATA_LAYERS } = await import(pathToFileURL(path.join(appDir, 'src/data-layers.js')).href);
    return { kind: 'flat', accepts: [1], layers: DATA_LAYERS.map(layer => layer.key), files: DATA_LAYERS };
  }
  return { kind: 'none', accepts: [], layers: [], files: [] };
}

/** Writes the chosen data into an app checkout, in the layout that app reads. */
async function writeData(appDir, app, ready) {
  const dataDir = path.join(appDir, 'data');
  await fs.rm(dataDir, { recursive: true, force: true });
  if (app.kind === 'snapshot') return materialize(dataDir, ready.manifest, ready.texts, { schema: ready.schema, migratedFrom: ready.migratedFrom });
  await fs.mkdir(dataDir, { recursive: true });
  for (const layer of app.files) await fs.writeFile(path.join(dataDir, layer.file), geojsonText(JSON.parse(ready.texts[layer.key])));
  return null;
}

export async function buildAt({ app: ref, data = null, out, dataDir = DATA_DIR, repo = root, migrations = MIGRATIONS, log = () => {} }) {
  if (!ref) throw new Error('--app needs a git ref, such as HEAD, main, a tag or a commit.');
  if (!out) throw new Error('--out needs a folder for the built site.');
  const commit = (() => {
    try { return git(['rev-parse', '--verify', `${ref}^{commit}`], repo); } catch { throw new Error(`There is no commit “${ref}” in this repository. A shallow clone may need git fetch --unshallow.`); }
  })();
  const target = path.resolve(out);
  if (await exists(target) && (await fs.readdir(target)).length) throw new Error(`${out} is not empty.`);
  const id = data ?? await currentId(dataDir);
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'pedway-build-'));
  const appDir = path.join(work, 'app');
  try {
    git(['worktree', 'add', '--quiet', '--detach', appDir, commit], repo);
    const app = await appKind(appDir);
    log(`App ${ref} (${commit.slice(0, 12)}) reads ${app.kind === 'none' ? 'no data' : `${app.kind} data, schema ${app.accepts.join(' or ')}`}.`);
    let ready = null;
    if (app.kind !== 'none') {
      ready = await dataForApp(dataDir, id, { accepts: app.accepts, layers: app.layers, migrations });
      await writeData(appDir, app, ready);
      log(`Data snapshot ${id}, schema ${ready.manifest.schema}${ready.steps.length ? `, migrated to schema ${ready.schema}` : ''}.`);
    }
    // That version's own staging script stages into its own checkout.
    execFileSync(process.execPath, ['scripts/stage.mjs', '_site'], { cwd: appDir, stdio: ['ignore', 'pipe', 'pipe'] });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(path.join(appDir, '_site'), target, { recursive: true });
    const info = {
      app: { ref, commit, kind: app.kind },
      data: ready ? { snapshot: id, schema: ready.manifest.schema, ...(ready.migratedFrom !== undefined ? { migratedTo: ready.schema } : {}), osmBase: ready.manifest.osmBase } : null,
      builtWith: (() => { try { return git(['rev-parse', 'HEAD'], repo); } catch { return undefined; } })(),
      built: new Date().toISOString(),
    };
    await fs.writeFile(path.join(target, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
    return info;
  } finally {
    try { git(['worktree', 'remove', '--force', appDir], repo); } catch { /* already gone */ }
    await fs.rm(work, { recursive: true, force: true });
    try { git(['worktree', 'prune'], repo); } catch { /* nothing to prune */ }
  }
}

function options(args) {
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i].replace(/^--/, '');
    if (!['app', 'data', 'out'].includes(name) || args[i + 1] === undefined) throw new Error('Usage: node scripts/build-at.mjs --app <git ref> [--data <snapshot id>] [--out <dir>]');
    result[name] = args[i + 1];
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const opts = options(process.argv.slice(2));
    opts.out ??= path.join('_build', `${(opts.app ?? 'app').replace(/[^\w.-]+/g, '-')}-${opts.data ?? 'current'}`);
    const info = await buildAt({ ...opts, log: message => console.log(message) });
    console.log(`Built ${opts.out}`);
    if (info.data === null) console.log('That app version shows no map data.');
  } catch (error) {
    console.error(error.stderr?.toString().trim() || error.message);
    process.exit(1);
  }
}
