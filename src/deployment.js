// How this copy of the site was built. `node scripts/stage.mjs --self-contained`
// rewrites this file in the staged copy, so that copy never contacts another
// server: no map tiles, no address lookup, no HashBin (docs/map-layers.md, "Self-contained build").
export const SELF_CONTAINED = false;

// Every server the full site may contact, and when. Shown in About.
export const EXTERNAL_HOSTS = Object.freeze([
  { host: 'tile.openstreetmap.org', use: 'Map tiles outside downtown, or everywhere with the OpenStreetMap base map.' },
  { host: 'nominatim.openstreetmap.org', use: 'Addresses the app cannot work out itself, only when you press Go.' },
  { host: '256t.us', use: 'Opening a map someone saved to HashBin.' },
]);
