/* Pedway Tools offline worker.
 * Fragment Kit's worker caches every file of the site, checked against the
 * SHA-256 manifest that scripts/stage.mjs writes to offline-assets.js. On top of
 * that, map tiles the viewer has already looked at are kept, so the map still
 * draws underground. Tiles are never fetched ahead of time (OpenStreetMap's tile
 * policy forbids bulk downloads). */
const TILE_CACHE = 'pedway-tiles-v1';
const TILE_HOST = 'https://tile.openstreetmap.org/';
const TILE_LIMIT = 3000;               // about 50 MB at typical tile sizes
const TILE_FRESH = 7 * 24 * 3600e3;    // re-fetch tiles older than a week when online
const TILE_TIMEOUT = 4000;             // then fall back to an older copy

self.FragmentKitOfflineConfig = { extraCaches: [TILE_CACHE] };
importScripts('offline-assets.js', 'vendor/fragment-kit-v0.5.0/src/offline/sw-core.js');

let puts = 0;
async function trim(cache) {
  const keys = await cache.keys();
  // Cache keys come back in insertion order, so the oldest go first.
  for (const request of keys.slice(0, Math.max(0, keys.length - TILE_LIMIT))) await cache.delete(request);
}
async function tile(request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request.url);
  const age = cached ? Date.now() - Number(cached.headers.get('x-pedway-cached') ?? 0) : Infinity;
  if (cached && age < TILE_FRESH) return cached;
  const network = fetch(request.url, { mode: 'cors', credentials: 'omit' }).then(async response => {
    // Only readable (CORS) responses are kept: opaque ones cost megabytes of quota each.
    if (response.ok && response.type === 'cors') {
      const headers = new Headers(response.headers);
      headers.set('x-pedway-cached', String(Date.now()));
      await cache.delete(request.url);
      await cache.put(request.url, new Response(await response.clone().blob(), { status: 200, headers }));
      if (++puts % 50 === 0) await trim(cache);
    }
    return response;
  });
  if (!cached) return network;
  const timeout = new Promise(resolve => setTimeout(() => resolve(cached), TILE_TIMEOUT));
  return Promise.race([network.catch(() => cached), timeout]);
}
self.addEventListener('fetch', event => {
  if (event.request.method === 'GET' && event.request.url.startsWith(TILE_HOST)) event.respondWith(tile(event.request));
});
