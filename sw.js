const CACHE_STATIC = 'altintakip-static-v1';
const CACHE_RUNTIME = 'altintakip-runtime-v1';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icons/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_STATIC);
    await cache.addAll(STATIC_ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map(k => {
        if (![CACHE_STATIC, CACHE_RUNTIME].includes(k)) {
          return caches.delete(k);
        }
      })
    );
    await self.clients.claim();
  })());
});

function isStaticRequest(req) {
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return false;
  const path = url.pathname;
  return STATIC_ASSETS.includes(path);
}

function isPriceAPI(req) {
  const url = new URL(req.url);
  return (
    url.hostname.endsWith('exchangerate.host') ||
    url.hostname.endsWith('frankfurter.app')
  );
}

// Cache-first for static, network-first for price APIs.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  if (isStaticRequest(req)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      const cache = await caches.open(CACHE_STATIC);
      cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  if (isPriceAPI(req)) {
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
      } catch (e) {
        const cached = await cache.match(req);
        if (cached) return cached;
        return new Response(JSON.stringify({ error: 'offline' }), {
          headers: { 'Content-Type': 'application/json' }, status: 503
        });
      }
    })());
    return;
  }
});