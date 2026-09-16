const CACHE = 'xixi-v7-effects1';
const CORE = [
  './', './index.html', './refresh.html', './styles.css', './config.js', './app.js',
  './manifest.webmanifest', './favicon.svg',
  './assets/hotel-window.jpg', './assets/cozy-bedroom.jpg', './assets/default-person.jpg'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('xixi-') && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      const request = event.request.mode === 'navigate'
        ? new Request(event.request, { cache: 'no-store' })
        : event.request;
      const response = await fetch(request);
      if (response.ok) {
        try {
          const cache = await caches.open(CACHE);
          await cache.put(event.request, response.clone());
        } catch {
          // A full cache must not hide a successful network response.
        }
      }
      return response;
    } catch {
      return (await caches.match(event.request)) ||
        (event.request.mode === 'navigate' ? await caches.match('./index.html') : null) ||
        Response.error();
    }
  })());
});
