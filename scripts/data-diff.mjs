// Summarises how one data snapshot differs from another, as Markdown for the
// data-refresh pull request:
//   node scripts/data-diff.mjs > summary.md            # current snapshot against the one before it
//   node scripts/data-diff.mjs <from-id> <to-id>
import { fileURLToPath } from 'node:url';
import { DATA_LAYERS } from '../src/data-layers.js';
import { DATA_DIR, currentId, readManifest, readSnapshot } from './snapshots.mjs';

const SHOWN = 15;

const label = feature => feature.properties?.name || feature.properties?.kind || feature.id;
const parse = text => { try { return JSON.parse(text).features ?? []; } catch { return []; } };

/** Compares two FeatureCollection texts by feature id. */
export function diffFeatures(beforeText, afterText) {
  const before = new Map(parse(beforeText).map(f => [f.id, f])), after = new Map(parse(afterText).map(f => [f.id, f]));
  const added = [...after.values()].filter(f => !before.has(f.id));
  const removed = [...before.values()].filter(f => !after.has(f.id));
  const changed = [...after.values()].filter(f => before.has(f.id) && JSON.stringify(before.get(f.id)) !== JSON.stringify(f));
  return { before: before.size, after: after.size, added, removed, changed };
}

function names(list) {
  const shown = list.slice(0, SHOWN).map(f => `${label(f)} (${f.id})`).join(', ');
  return list.length > SHOWN ? `${shown}, and ${list.length - SHOWN} more` : shown;
}

/** Markdown for a set of { file, diff } entries. */
export function summarize(entries, { from, to } = {}) {
  const lines = [`Monthly rebuild of the map data from OpenStreetMap${to ? `: snapshot **${to}**${from ? `, compared with ${from}` : ''}` : ''}. Review before merging: OSM edits can remove or move Pedway corridors.`, '',
    '| File | Before | After | Added | Removed | Changed |', '| --- | ---: | ---: | ---: | ---: | ---: |'];
  for (const { file, diff } of entries) lines.push(`| ${file} | ${diff.before} | ${diff.after} | ${diff.added.length} | ${diff.removed.length} | ${diff.changed.length} |`);
  for (const { file, diff } of entries) {
    if (!diff.added.length && !diff.removed.length && !diff.changed.length) continue;
    lines.push('', `### ${file}`);
    if (diff.added.length) lines.push(`* Added: ${names(diff.added)}`);
    if (diff.removed.length) lines.push(`* Removed: ${names(diff.removed)}`);
    if (diff.changed.length) lines.push(`* Changed: ${names(diff.changed)}`);
  }
  // A pull request opened with the workflow's token does not start other workflows.
  lines.push('', 'CI does not run on its own for this pull request: run **CI and Pages** on the `data-refresh` branch from the Actions tab, or close and reopen the pull request.');
  return lines.join('\n') + '\n';
}

async function main() {
  let [from, to] = process.argv.slice(2);
  to ??= await currentId();
  from ??= (await readManifest(DATA_DIR, to)).previous;
  const after = await readSnapshot(DATA_DIR, to), before = from ? await readSnapshot(DATA_DIR, from) : { texts: {} };
  const entries = DATA_LAYERS.map(({ key, file }) => ({ file, diff: diffFeatures(before.texts[key] ?? '', after.texts[key] ?? '') }));
  process.stdout.write(summarize(entries, { from, to }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
