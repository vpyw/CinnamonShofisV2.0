// Caché solo de archivos de la aplicación. Los datos se consultan en Firebase.
const CACHE_NAME = 'cinnamonshofis-cloud-v2';
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './cloud.js', './firebase-config.js',
  './favicon.svg', './icon-192.png', './icon-512.png', './manifest.webmanifest'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(k =>
      (k.startsWith('cinnamonshofis-app-') || k.startsWith('cinnamonshofis-cloud-')) && k !== CACHE_NAME
    ).map(k => caches.delete(k)))),
    self.clients.claim()
  ]));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Preferir versión más reciente; offline solo muestra interfaz y datos en caché del SDK.
  event.respondWith(fetch(request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(request, copy)));
    }
    return response;
  }).catch(() => caches.match(request).then(cached => cached || caches.match('./index.html'))));
});
