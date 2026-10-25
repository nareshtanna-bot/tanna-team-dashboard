/*
 * Offline shell for the installed app (iPhone Home Screen, Mac Dock).
 * - App files (HTML, CSS, JS, icons, the committed example seed) are cached so the app opens offline.
 * - Every /api/* request is network-only and is never written to the cache. Live tasks, money,
 *   health, and section data only ever come from the network.
 * - Redirected responses (for example a Vercel sign-in redirect) and non-same-origin responses are never cached.
 */
const CACHE = 'mission-control-v7';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './tasks.css',
  './inbox.css',
  './app.js',
  './tasks.js',
  './inbox.js',
  './lib/sections.js',
  './lib/privacy.js',
  './lib/tasks.js',
  './lib/headlines.js',
  './manifest.json',
  './status.json',
  './outputs/manifest.json',
  './vendor/chart.umd.min.js',
  './vendor/marked.umd.js',
  './icon.svg',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function cacheable(response) {
  return Boolean(response && response.ok && response.type === 'basic' && !response.redirected);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Data: network only, never cached. The page shows its own offline message.
  if (url.pathname.includes('/api/')) return;

  // App files: network first, cached copy offline. The cache key drops the query string
  // (the page adds ?t= to bust caches), so one copy is kept per file.
  const key = url.origin + url.pathname;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (cacheable(response)) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(key, copy));
        }
        return response;
      })
      .catch(() => caches.match(key, { ignoreSearch: true })
        .then((cached) => cached || (request.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
