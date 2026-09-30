// Budgeteer service worker: makes the app installable with a proper offline page
// (self-contained, so it needs nothing else from the cache).
// It never touches /api/ or /uploads/ — budget data and auth responses are not cached.
// Bump CACHE when the precached files change; old caches are deleted on activate.

const CACHE = 'budgeteer-v1'
const OFFLINE_URL = '/offline.html'
const PRECACHE = [OFFLINE_URL]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

// ── Caching ──────────────────────────────────────────────────────────────────

// Pages always come from the network (index.html is no-store, so a deploy shows up
// at once); the offline page is served only when the network is unreachable.
// Every other request is left alone: /api/ and /uploads/ are never cached here,
// and the hashed /assets/ are already kept by the browser's HTTP cache.
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)))
})

// ── Push ─────────────────────────────────────────────────────────────────────
// Reserved for the Web Push reminder channel (push and notificationclick handlers).
