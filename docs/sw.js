// Bump CACHE whenever any file below changes, so phones pick up the new version.
const CACHE = 'budget-v13';
const FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'core.js',
  'category-icons.js',
  'nbu-history.js',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser's HTTP cache. Otherwise an update can store the previous
  // version's files under the new cache name and stay stuck on them.
  const fresh = FILES.map((file) => new Request(file, { cache: 'reload' }));
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(fresh)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
