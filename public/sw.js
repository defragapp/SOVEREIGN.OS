// SOVEREIGN.OS Service Worker — offline-first PWA
const CACHE = 'sovereign-v1';
const STATIC = [
  '/', '/launcher', '/defrag', '/alignment', '/loop', '/compression', '/covenant',
  '/auth/signin', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Network-first for API calls
  if (url.hostname.includes('api.sovereign.os') || url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request).catch(() => new Response(JSON.stringify({ error: { code: 'OFFLINE', message: 'You are offline. Please reconnect.' } }), { status: 503, headers: { 'Content-Type': 'application/json' } })));
    return;
  }
  // Cache-first for static assets
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
    if (res.ok) { const clone = res.clone(); caches.open(CACHE).then(c => c.put(e.request, clone)); }
    return res;
  }).catch(() => caches.match('/') || new Response('Offline', { status: 503 }))));
});
