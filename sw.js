const CACHE_STATIC = 'altintakip-static-v3';
const CACHE_RUNTIME = 'altintakip-runtime-v3';

const STATIC_ASSETS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_STATIC);
    try { await cache.addAll(STATIC_ASSETS); } catch(e) {}
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
  try {
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return false;
    const path = url.pathname.replace(self.location.pathname, '');
    return STATIC_ASSETS.includes(url.pathname) || STATIC_ASSETS.includes(path) || STATIC_ASSETS.includes(url.pathname.slice(1));
  } catch {
    return false;
  }
}

function isRateAPI(req) {
  const url = new URL(req.url);
  return (
    url.hostname === 'cdn.jsdelivr.net' ||
    url.hostname.endsWith('exchangerate.host') ||
    url.hostname.endsWith('frankfurter.app')
  );
}

// Cache-first for static, network-first for rates with cache fallback.
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

  if (isRateAPI(req)) {
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