// Data schema migrations: how a snapshot on an older schema becomes one a newer
// app can read, without rebuilding it from OpenStreetMap. See docs/data-history.md.
//
// MIGRATIONS[n] turns the file texts of a schema-n snapshot into schema n + 1.
// Each one is a pure function of the texts ({ layer: geojson text }) and must
// return every layer the next schema has. Add one whenever DATA_SCHEMA.version
// is bumped, and keep the old ones: they are how old snapshots stay usable.
// Only upward migrations exist. A newer snapshot cannot be made to fit an older app.
import { geojsonText, readSnapshot } from './snapshots.mjs';

export const MIGRATIONS = Object.freeze({
  // Example, for when schema 2 renames poi.kind to poi.type:
  // 1: texts => ({ ...texts, poi: mapProperties(texts.poi, ({ kind, ...rest }) => ({ ...rest, type: kind })) }),
});

/** The schemas to step through to get from `from` to one in `accepts`, or null if there is no way. */
export function migrationPath(from, accepts, migrations = MIGRATIONS) {
  const steps = [];
  let schema = from;
  while (!accepts.includes(schema)) {
    if (typeof migrations[schema] !== 'function') return null;
    steps.push(schema);
    schema++;
  }
  return steps;
}

/** Migrates texts from schema `from` to the first schema in `accepts` it can reach. */
export function migrate(texts, from, accepts, migrations = MIGRATIONS) {
  const steps = migrationPath(from, accepts, migrations);
  if (!steps) throw new Error(`No migration from data schema ${from} to ${accepts.join(' or ')}.`);
  let result = texts;
  for (const schema of steps) result = migrations[schema](result);
  return { texts: result, schema: from + steps.length, steps };
}

/** Helper for migrations: applies change(properties) to every feature of one GeoJSON text. */
export function mapProperties(text, change) {
  const data = JSON.parse(text);
  for (const feature of data.features) feature.properties = change({ ...feature.properties });
  return geojsonText(data);
}

/**
 * A snapshot's texts, readied for an app that reads `accepts` schemas and the
 * given layers: checked against their hashes, migrated if needed, and trimmed to
 * those layers. Layers listed in `optional` may be missing. Throws, saying why,
 * when the app cannot use the snapshot.
 */
export async function dataForApp(dataDir, id, { accepts, layers, optional = [], migrations = MIGRATIONS }) {
  const { manifest, texts } = await readSnapshot(dataDir, id);
  const required = layers.filter(layer => !optional.includes(layer));
  const missing = required.filter(layer => typeof texts[layer] !== 'string');
  if (missing.length && accepts.includes(manifest.schema)) throw new Error(`Data snapshot ${id} has no ${missing.join(', ')} data.`);
  if (!accepts.includes(manifest.schema) && !migrationPath(manifest.schema, accepts, migrations)) {
    throw new Error(`Data snapshot ${id} uses data schema ${manifest.schema}; this app reads ${accepts.join(' or ')}, and there is no migration${manifest.schema > Math.max(...accepts) ? ' (the data is newer than the app)' : ''}.`);
  }
  const migrated = migrate(texts, manifest.schema, accepts, migrations);
  const absent = required.filter(layer => typeof migrated.texts[layer] !== 'string');
  if (absent.length) throw new Error(`Data snapshot ${id} has no ${absent.join(', ')} data, even after migrating.`);
  return {
    manifest, schema: migrated.schema, steps: migrated.steps,
    texts: Object.fromEntries(layers.filter(layer => typeof migrated.texts[layer] === 'string').map(layer => [layer, migrated.texts[layer]])),
    migratedFrom: migrated.steps.length ? manifest.schema : undefined,
  };
}

