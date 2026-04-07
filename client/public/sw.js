const CACHE_NAME = 'sau-v3';
const STATIC_ASSETS = [
  '/unit',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

// ── Install: precache critical assets ─────────────────────────────────────────
self.addEventListener('install', (event) => {
  self.skipWaiting(); // Activate new SW immediately
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).catch(err => console.warn('[SAU-SW] Precache failed:', err))
  );
});

// ── Activate: clean old caches ────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.log('[SAU-SW] Suppression ancien cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim()) // Take control of all clients immediately
  );
});

// ── Fetch: Smart caching strategies ───────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Strategy 1: Network-first for API calls (dynamic data)
  if (url.pathname.startsWith('/api/') || url.hostname.includes('render.com') || url.hostname.includes('onrender.com')) {
    event.respondWith(networkFirstWithTimeout(request, 8000));
    return;
  }

  // Strategy 2: Cache-first for map tiles (bandwidth heavy)
  if (
    url.hostname.includes('basemaps.cartocdn.com') ||
    url.hostname.includes('tile.openstreetmap.org') ||
    url.hostname.includes('router.project-osrm.org')
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Strategy 3: Stale-while-revalidate for static assets (JS, CSS, fonts)
  if (
    request.destination === 'style' ||
    request.destination === 'script' ||
    request.destination === 'font' ||
    request.destination === 'image'
  ) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Strategy 4: Network-first for navigation (pages)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/unit').then(r => r || fetch(request)))
    );
    return;
  }

  // Default: try cache then network
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});

// ── Background Sync: offline reports ─────────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sau-sync-reports') {
    event.waitUntil(syncOfflineReports());
  }
});

async function syncOfflineReports() {
  const db = await openDB();
  const reports = await getFromDB(db, 'offline_reports');
  
  for (const report of reports) {
    try {
      const response = await fetch(`/api/alerts/${report.missionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: report.status, report: report.reportData }),
      });
      if (response.ok) {
        await deleteFromDB(db, 'offline_reports', report.id);
        console.log('[SAU-SW] ✅ Rapport synchronisé:', report.missionId);
      }
    } catch (e) {
      console.warn('[SAU-SW] ⚠️ Sync échouée pour rapport:', report.missionId);
    }
  }
}

// ── Push Notifications ────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  
  const options = {
    body: data.body || 'Nouvelle alerte SAU',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
    vibrate: [200, 100, 200, 100, 200],
    tag: 'sau-alert',
    requireInteraction: true,
    data: { url: data.url || '/unit' },
    actions: [
      { action: 'open', title: '🚒 Ouvrir' },
      { action: 'dismiss', title: 'Ignorer' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || '🚨 ALERTE SAU', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      const url = event.notification.data?.url || '/unit';
      const client = clients.find((c) => c.url.includes('/unit'));
      if (client) {
        client.focus();
        client.navigate(url);
      } else {
        self.clients.openWindow(url);
      }
    })
  );
});

// ── Caching strategy helpers ───────────────────────────────────────────────────
async function networkFirstWithTimeout(request, timeout) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const networkResponse = await fetch(request, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    // Cache successful responses
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    clearTimeout(timeoutId);
    // Fallback to cache if available
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const networkResponse = await fetch(request);
  if (networkResponse.ok) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, networkResponse.clone());
  }
  return networkResponse;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkPromise = fetch(request).then((networkResponse) => {
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  }).catch(() => cached);

  return cached || networkPromise;
}

// ── Minimal IndexedDB helpers for offline reports ─────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('sau-offline', 1);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore('offline_reports', { keyPath: 'id' });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

function getFromDB(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function deleteFromDB(db, storeName, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
