const CACHE_NAME = 'sau-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/unit',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

self.addEventListener('fetch', (event) => {
  // Strategy: Network First, Fallback to Cache
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match('/unit');
      })
    );
    return;
  }

  // Cache tiles (Leaflet/CARTO) for offline usage
  if (event.request.url.includes('basemaps.cartocdn.com') || event.request.url.includes('tile.openstreetmap.org')) {
     event.respondWith(
       caches.match(event.request).then((cachedResponse) => {
         if (cachedResponse) return cachedResponse;
         return fetch(event.request).then((networkResponse) => {
           const cacheCopy = networkResponse.clone();
           caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cacheCopy));
           return networkResponse;
         });
       })
     );
     return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
