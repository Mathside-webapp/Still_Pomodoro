// Static-first cache for full offline access after the first hosted visit.
const CACHE = 'still-offline-v3';
const FILES = [
  './', './index.html', './styles.css', './app.js', './favicon.svg',
  './manifest.webmanifest', './icon-192.png', './icon-512.png'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k.startsWith('still-offline-')).map(k => caches.delete(k)))),
    self.clients.claim()
  ]));
});
self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin) return;
  if(event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => {
      if(response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache=>cache.put('./index.html',copy)); }
      return response;
    }).catch(()=>caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if(response.ok) {const copy=response.clone(); caches.open(CACHE).then(cache => cache.put(event.request,copy));}
    return response;
  })));
});
