// Integrid Service Worker
const CACHE = 'integrid-v1';

// App shell — static files to pre-cache on install
const SHELL = [
  '/index.html',
  '/integrid_time_audit.html',
  '/integrid_weekly_growth.html',
  '/integrid_daily_plan.html',
  '/integrid_12week_push.html',
  '/workbook-storage.js',
  '/manifest.json',
  '/icons/icon.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  // Remove old cache versions
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never intercept: auth, API, admin, login
  if (
    url.pathname.startsWith('/.auth') ||
    url.pathname.startsWith('/api/') ||
    url.pathname === '/admin.html' ||
    url.pathname === '/login.html'
  ) {
    return;
  }

  // Network-first for navigation requests (keeps auth state fresh)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first for all other static assets
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
