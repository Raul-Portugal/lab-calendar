/**
 * LabCal Service Worker
 * Enables PWA installation, instant loading, and 100% offline functionality
 */

const CACHE_NAME = 'labcal-cache-v1';

const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/main.css',
  './css/calendar.css',
  './css/sidebar.css',
  './css/modal.css',
  './js/app.js',
  './js/state.js',
  './js/calendar.js',
  './js/drag-drop.js',
  './js/protocols.js',
  './js/protocol-builder.js',
  './js/quotas.js',
  './js/storage.js',
  './js/utils.js',
  './js/sync.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) => {
        return Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              return caches.delete(key);
            }
          })
        );
      })
    ])
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Network-only for external API calls (e.g. Supabase Auth and Database)
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Stale-While-Revalidate for local assets
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Offline fallback if fetch fails
        return cachedResponse;
      });

      return cachedResponse || fetchPromise;
    })
  );
});
