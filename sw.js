/**
 * LabCal Service Worker
 * Enables PWA installation, instant loading, and 100% offline functionality
 */

const CACHE_NAME = 'labcal-cache-v2';

const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/main.css',
  './css/calendar.css',
  './css/sidebar.css',
  './css/modal.css',
  './css/responsive.css',
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

  // Let the browser handle external API calls (Supabase) and non-GET requests directly
  if (url.origin !== self.location.origin || event.request.method !== 'GET') {
    return;
  }

  // Network-first for app files, so updates are picked up on the next load
  // (stale-while-revalidate served the previous version once after every deploy).
  // The cache is the offline fallback.
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});
