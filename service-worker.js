/* ==========================================================
   service-worker.js — HisulArena PWA Service Worker
   Strategy: Cache-first for shell assets, network-first for JSON
   ========================================================== */

const CACHE_NAME   = 'hisularena-v1';
const CACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/cards.json',
  '/css/global.css',
  '/css/home.css',
  '/css/games.css',
  '/js/cards-loader.js',
  '/js/utils.js',
  '/games/memory.html',
  '/games/war.html',
  '/games/betting.html',
  '/assets/icons/icon.svg',
];

/* --- Install: pre-cache shell assets --- */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Pre-caching shell assets');
      return cache.addAll(CACHE_ASSETS);
    })
  );
  self.skipWaiting();
});

/* --- Activate: clean up old caches --- */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => {
            console.log('[SW] Deleting old cache:', k);
            return caches.delete(k);
          })
      )
    )
  );
  self.clients.claim();
});

/* --- Fetch: cache-first for assets, network-first for cards.json --- */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip cross-origin requests (fonts, etc.)
  if (url.origin !== self.location.origin) return;

  // Network-first for cards.json so updates are reflected
  if (url.pathname.endsWith('cards.json')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Cache-first for everything else
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        // Only cache successful GET responses
        if (request.method !== 'GET' || !response.ok) return response;

        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        return response;
      });
    })
  );
});
