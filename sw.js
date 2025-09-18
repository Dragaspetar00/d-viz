const CACHE_STATIC = 'altintakip-static-v4';
const CACHE_RUNTIME = 'altintakip-runtime-v4';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_STATIC);
    try {
      await cache.addAll([
        './',
        'index.html',
        'styles.css',
        'app.js',
        'manifest.webmanifest',
        'icons/icon.svg'
      ]);
    } catch (e) {}
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => {
      if (![CACHE_STATIC, CACHE_RUNTIME].includes(k)) return caches.delete(k);
    }));
    await self.clients.claim();
  })());
});

// Same-origin static: cache-first
// Rate APIs: network-first with cache fallback
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // External rate APIs
  const isRateAPI =
    url.hostname.endsWith('exchangerate.host') ||
    url.hostname.endsWith('frankfurter.app');

  if (isRateAPI) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_RUNTIME);
      try {
        const netRes = await fetch(req);
        if (netRes && netRes.ok) {
          cache.put(req, netRes.clone());
          return netRes;
        }
        const cached = await cache.match(req);
        if (cached) return cached;
        return netRes;
      } catch {
        const cached = await cache.match(req);
        if (cached) return cached;
        return new Response(JSON.stringify({ error: 'offline' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 503
        });
      }
    })());
    return;
  }

  if (sameOrigin && ['document','script','style','image','font'].includes(req.destination)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      const cache = await caches.open(CACHE_STATIC);
      cache.put(req, res.clone());
      return res;
    })());
  }
});