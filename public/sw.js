// Service worker de 333 Barbería: recibe las notificaciones push y abre la agenda al tocarlas.
// No guarda nada en caché para que siempre se vea la información actualizada.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || '333 Barbería', {
    body: d.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { url: d.url || '/?app=1' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/?app=1';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if ('focus' in w) {
        try { await w.navigate(url); } catch { /* algunos navegadores no dejan navegar */ }
        return w.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});

// Sin caché: todo va directo a la red.
self.addEventListener('fetch', () => {});
