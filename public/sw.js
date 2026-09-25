const CACHE_NAME = 'boxmusic-cache-v4';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/app.css?v=4.0',
  '/js/db.js?v=4.0',
  '/js/player.js?v=4.0',
  '/js/app.js?v=4.0',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // For API streaming & downloads, do not intercept
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // 1. Navigation requests: Instant Cache-First with Stale-While-Revalidate
  // This guarantees 0ms launch time on Android home screen even with zero network or airplane mode!
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match('/index.html', { ignoreSearch: true }).then((cached) => {
        const fetchPromise = fetch(event.request)
          .then((networkRes) => {
            if (networkRes && networkRes.status === 200) {
              const clone = networkRes.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', clone));
            }
            return networkRes;
          })
          .catch(() => null);

        return cached || fetchPromise || caches.match('/', { ignoreSearch: true });
      })
    );
    return;
  }

  // 2. Static Assets: Cache-first, then network, ignore search params
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;

      return fetch(event.request).then((networkRes) => {
        if (networkRes && networkRes.status === 200) {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkRes;
      }).catch(() => {
        // Fallback for image requests
        if (event.request.destination === 'image') {
          return caches.match('/icons/icon.svg');
        }
      });
    })
  );
});
