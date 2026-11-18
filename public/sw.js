// Service worker: makes the app installable and quick to open, and lets it start without a connection.
//
// What's cached is the app itself, never data:
// - /api/… always goes to the server (letters, files and sign-in must be current; nothing private is stored here).
// - Pages (navigations) try the network first and fall back to the cached app, so a new version is picked up as
//   soon as it's online, and the app still opens offline (it then says it's offline).
// - Built files under /assets/ have their content hash in the name, so a cached copy is always right: cache first.
// - Icons, the manifest and other files: the cached copy at once, refreshed in the background.
//
// Bump VERSION when this file's caching changes; old caches are deleted when the new worker takes over. A new build
// of the app needs no bump: the page notices a new worker (this file is re-checked on each visit) and offers to reload.
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const SHELL_FILES = ['/', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/apple-touch-icon.png'];
// Hashed build files kept at most; the oldest go first.
const MAX_ASSETS = 80;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(SHELL_FILES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = [SHELL, ASSETS];
      for (const key of await caches.keys()) if (!keep.includes(key)) await caches.delete(key);
      await self.clients.claim();
    })()
  );
});

// The page asks the waiting worker to take over when the person chooses to reload into the new version.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(key);
}

async function networkFirstPage(request) {
  try {
    const response = await fetch(request);
    // Keep the latest app page for offline use (every route serves the same index.html).
    if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
      const cache = await caches.open(SHELL);
      await cache.put('/', response.clone());
    }
    return response;
  } catch {
    return (await caches.match('/')) ?? Response.error();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(ASSETS);
    await cache.put(request, response.clone());
    trim(ASSETS, MAX_ASSETS);
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match(request);
  const fresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached ?? Response.error());
  return cached ?? fresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Data, sign-in (including the Google redirect) and anything else from the server: straight through.
  if (url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') return event.respondWith(networkFirstPage(request));
  if (url.pathname.startsWith('/assets/')) return event.respondWith(cacheFirst(request));
  event.respondWith(staleWhileRevalidate(request));
});
