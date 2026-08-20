// public/service-worker.js
//
// A service worker is a script the browser can run independently of any open
// tab or window — closer to a background daemon than to page JS. The browser
// decides when to start and stop it. That's exactly why push has to go
// through here: a 'push' event can wake this file even when the app is fully
// closed, because the browser (not your app) owns the service worker's
// lifecycle. Nothing in index.html/app.js runs at that point — only this file.

const CACHE_NAME = 'deadlines-shell-v2';
const APP_SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.json', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Cache-first for the static shell, network for everything else (in
// particular /api/* — task data should never be served stale).
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

// --- Push handling: this is the part that fires with the app fully closed ---

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Reminder', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Reminder';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.taskId ? `task-${data.taskId}` : undefined,
    data: { taskId: data.taskId, url: '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
